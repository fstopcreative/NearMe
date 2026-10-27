"""
HM Land Registry Price Paid Data (FINAL source for "Average property value";
also the area-level "Annual growth %", the yearly price trend and prices by
property type).

Data: the public SPARQL endpoint, standard-price sales only (category A —
"additional price paid" sales such as repossessions and buy-to-let portfolio
transfers are left out, as in the UK HPI). Each sale postcode is placed in a
ward / LSOA with postcodes.io, then matched to the areas in config/areas.json.

Windows: the latest month in the data is usually incomplete (late
registrations), so the 12-month window ends at the end of the month before it.
"""
from collections import defaultdict
from datetime import date, timedelta
from statistics import mean, median

from lib.common import (http, read_csv_text, lookup_postcodes, metric, log, month_end, fmt_period_end, norm_pc)

ENDPOINT = 'https://landregistry.data.gov.uk/landregistry/query'
TYPES = {'detached': 'detached', 'semi-detached': 'semi', 'terraced': 'terraced', 'flat-maisonette': 'flat'}
MIN_SALES = 5          # fewer → no figure
LOW_SALES = 30         # fewer → "low-confidence"

QUERY = '''PREFIX lrppi: <http://landregistry.data.gov.uk/def/ppi/>
PREFIX lrcommon: <http://landregistry.data.gov.uk/def/common/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
SELECT ?postcode ?amount ?date ?ptype ?locality ?district WHERE {
  VALUES ?district { %(districts)s }
  ?addr lrcommon:district ?district ; lrcommon:postcode ?postcode .
  OPTIONAL { ?addr lrcommon:locality ?locality }
  ?tx lrppi:propertyAddress ?addr ; lrppi:pricePaid ?amount ; lrppi:transactionDate ?date ;
      lrppi:propertyType ?ptype ; lrppi:transactionCategory lrppi:standardPricePaidTransaction .
  FILTER (?date >= "%(start)s"^^xsd:date && ?date < "%(end)s"^^xsd:date)
  %(extra)s
}'''


def fetch(districts, start, end, extra=''):
    q = QUERY % {'districts': ' '.join(f'"{d}"^^xsd:string' for d in districts),
                 'start': start.isoformat(), 'end': end.isoformat(), 'extra': extra}
    raw = http(ENDPOINT, data={'query': q}, headers={'Accept': 'text/csv'}, timeout=300)
    return read_csv_text(raw.decode('utf-8'))


def load_sales(years):
    today = date.today()
    sales = []
    for y in range(today.year - years, today.year + 1):
        rows = fetch(['TRAFFORD'], date(y, 1, 1), date(y + 1, 1, 1))
        rows += fetch(['WARRINGTON'], date(y, 1, 1), date(y + 1, 1, 1), 'FILTER(STRSTARTS(?postcode, "WA13"))')
        log(f'price paid {y}: {len(rows)} sales')
        for r in rows:
            try:
                sales.append({
                    'pc': norm_pc(r['postcode']), 'price': int(float(r['amount'])),
                    'date': date.fromisoformat(r['date'][:10]),
                    'type': TYPES.get(r['ptype'].rsplit('/', 1)[-1]),
                    'locality': (r.get('locality') or '').upper(), 'district': r['district'].upper(),
                })
            except (ValueError, KeyError):
                continue
    return sales


def in_area(area, s, geo):
    m = area['match']
    if 'lad' in m:
        return geo is not None and geo['lad'] == m['lad']
    if 'wards' in m:
        return geo is not None and geo['ward'] in m['wards']
    return s['locality'] in m['localities'] and s['district'] in m.get('districts', [s['district']])


def geography_label(area):
    m = area['match']
    if 'lad' in m:
        return f"{area['name']} (local authority)"
    if 'wards' in m:
        return f"{area['name']} — wards: {', '.join(m['wards'])}"
    return f"{area['name']} — Land Registry address locality"


def status_for(n):
    return 'ok' if n >= LOW_SALES else 'low-confidence'


def collect(ctx):
    sales = load_sales(years=10)
    geo = lookup_postcodes({s['pc'] for s in sales})
    latest = max(s['date'] for s in sales)
    end = month_end(date(latest.year, latest.month, 1) - timedelta(days=1))   # last complete month
    start12 = date(end.year - 1 + (end.month == 12), end.month % 12 + 1, 1)   # e.g. end 31 Jul 2026 → 1 Aug 2025
    start24 = date(start12.year - 1, start12.month, 1)
    start36 = date(start12.year - 2, start12.month, 1)
    period12 = f'12 months to {fmt_period_end(end)}'
    last_full_year = end.year if end.month == 12 else end.year - 1
    log('price paid window', start12, '→', end, '(latest sale', latest, ')')

    out = {}
    for area in ctx.areas:
        if area.get('kind') == 'region':          # Greater Manchester: UK HPI (ukhpi.py)
            continue
        mine = [s for s in sales if in_area(area, s, geo.get(s['pc']))]
        ctx.shared.setdefault('lsoas', {})[area['id']] = sorted({
            geo[s['pc']]['lsoa'] for s in mine if geo.get(s['pc']) and geo[s['pc']].get('lsoa') and s['date'] >= start36})
        cur = [s['price'] for s in mine if start12 <= s['date'] <= end]
        prev = [s['price'] for s in mine if start24 <= s['date'] < start12]
        g = geography_label(area)
        rec = {}

        if len(cur) >= MIN_SALES:
            rec['average_price'] = metric(round(mean(cur)), unit='GBP', period=period12, geography=g, source='ppd',
                                          status=status_for(len(cur)), sample=len(cur), median=round(median(cur)))
        else:
            rec['average_price'] = metric(None, period=period12, geography=g, source='ppd', status='no-data',
                                          sample=len(cur), note=f'Fewer than {MIN_SALES} sales in the period')

        if len(cur) >= MIN_SALES and len(prev) >= MIN_SALES:
            growth = (mean(cur) - mean(prev)) / mean(prev) * 100
            rec['annual_growth'] = metric(round(growth, 1), unit='%', period=f'{period12} vs previous 12 months',
                                          geography=g, source='ppd', status=status_for(min(len(cur), len(prev))),
                                          sample=len(cur), previous=round(mean(prev)),
                                          note='Change in the average sold price; it moves with the mix of homes sold.')
        else:
            rec['annual_growth'] = metric(None, period=f'{period12} vs previous 12 months', geography=g, source='ppd',
                                          status='no-data', note='Not enough sales in one of the two periods')

        by_year = defaultdict(list)
        for s in mine:
            by_year[s['date'].year].append(s['price'])
        series = [{'year': y, 'average': round(mean(by_year[y])), 'sales': len(by_year[y])}
                  for y in range(last_full_year - 9, last_full_year + 1) if len(by_year[y]) >= MIN_SALES]
        rec['price_trend'] = metric(series or None, unit='GBP', period=f'{last_full_year - 9}–{last_full_year}, calendar years',
                                    geography=g, source='ppd',
                                    status='ok' if series and min(p['sales'] for p in series) >= LOW_SALES else 'low-confidence')

        types = {}
        for key in TYPES.values():
            p36 = [s['price'] for s in mine if s['type'] == key and start36 <= s['date'] <= end]
            p12 = [s['price'] for s in mine if s['type'] == key and start12 <= s['date'] <= end]
            types[key] = {
                'average_3y': round(mean(p36)) if len(p36) >= MIN_SALES else None, 'sales_3y': len(p36),
                'median_12m': round(median(p12)) if len(p12) >= MIN_SALES else None, 'sales_12m': len(p12),
                'low_confidence': len(p36) < LOW_SALES,
            }
        rec['price_by_type'] = metric(types, unit='GBP', period=f'3 years and 12 months to {fmt_period_end(end)}',
                                      geography=g, source='ppd', status='ok')
        out[area['id']] = rec
    unmatched = sum(1 for s in sales if geo.get(s['pc']) is None)
    log(f'price paid: {len(sales)} sales, {unmatched} with an unknown postcode')
    return out
