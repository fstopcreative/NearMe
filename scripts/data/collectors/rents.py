"""
ONS Price Index of Private Rents (PIPR) — "Average rent".

Read from the data file behind ONS "Housing prices in your area"
(/visualisations/housingpriceslocal/<LA code>/), which carries the monthly
average private rent for the local authority, by bedrooms and property type,
with the region and country for comparison. Local authority is the lowest
published level, so towns show their borough's figure; Greater Manchester is
the mean of its ten boroughs.
"""
import json
import re
from statistics import mean

from lib.common import http, metric, log, GM_LADS, is_region

URL = 'https://www.ons.gov.uk/visualisations/housingpriceslocal/data/json/{code}.json'
PAGE = 'https://www.ons.gov.uk/visualisations/housingpriceslocal/{code}/'
BEDS = {'one': 'one_bed', 'two': 'two_bed', 'three': 'three_bed', 'four_plus': 'four_or_more_bed'}
TYPES = {'detached': 'detached', 'semi': 'semidetached', 'terraced': 'terraced', 'flat': 'flat_maisonette'}
TREND_MONTHS = 60


def month_label(m):
    from datetime import date
    y, mo = map(int, m.split('-'))
    return date(y, mo, 1).strftime('%B %Y')


def read(code):
    d = json.loads(http(URL.format(code=code), timeout=120))
    p = d['place']
    months = sorted(k[-7:] for k in p if re.fullmatch(r'rental_price_\d{4}-\d\d', k) and p[k] not in (None, 'NA'))
    if not months:
        return None
    m = months[-1]
    pick = lambda prefix, suffix='': p.get(f'{prefix}{suffix}_{m}') if p.get(f'{prefix}{suffix}_{m}') not in ('NA', '') else None
    return {
        'month': m,
        'monthly': pick('rental_price'), 'change_12m': pick('rent12m_change'),
        'by_beds': {k: pick('rental_price_', v) for k, v in BEDS.items()},
        'by_type': {k: pick('rental_price_', v) for k, v in TYPES.items()},
        'trend': [{'month': x, 'rent': p[f'rental_price_{x}']} for x in months[-TREND_MONTHS:]],
        'compare': {o['areanm']: o.get(f'rental_price_{m}') for o in (d.get('region') or {}, d.get('ctry') or {})
                    if o.get('areanm') and o.get(f'rental_price_{m}') not in (None, 'NA')},
    }


def collect(ctx):
    codes = {a['lad'] for a in ctx.areas if not is_region(a)}
    if any(is_region(a) for a in ctx.areas):
        codes |= set(GM_LADS)
    got = {}
    for c in sorted(codes):
        try:
            got[c] = read(c)
        except Exception as e:                    # one missing file must not blank the rest
            log(f'rents {c} failed: {e}')
    out = {}
    for area in ctx.areas:
        if is_region(area):
            parts = [got[c] for c in GM_LADS if got.get(c)]
            v = None
            if parts:
                m = min(x['month'] for x in parts)
                avg = lambda xs: round(mean(xs)) if xs else None
                months = sorted({t['month'] for x in parts for t in x['trend']})
                v = {'month': m, 'monthly': avg([x['monthly'] for x in parts if x['monthly']]),
                     'change_12m': round(mean(x['change_12m'] for x in parts if x['change_12m'] is not None), 1),
                     'by_beds': {k: avg([x['by_beds'][k] for x in parts if x['by_beds'][k]]) for k in BEDS},
                     'by_type': {k: avg([x['by_type'][k] for x in parts if x['by_type'][k]]) for k in TYPES},
                     'trend': [{'month': mo, 'rent': avg([t['rent'] for x in parts for t in x['trend'] if t['month'] == mo])} for mo in months],
                     'compare': parts[0]['compare'],
                     'boroughs': {GM_LADS[c]: got[c]['monthly'] for c in GM_LADS if got.get(c)}}
            geo, src_code = f'Greater Manchester — mean of {len(parts)} borough averages', 'E08000003'
        else:
            v, geo, src_code = got.get(area['lad']), f"{area['borough']} (local authority)", area['lad']
        src = {'name': 'ONS Price Index of Private Rents — Housing prices in your area', 'url': PAGE.format(code=src_code),
               'licence': 'Open Government Licence v3.0'}
        out[area['id']] = {'average_rent': metric(
            v, unit='GBP a month', period=f"{month_label(v['month'])} (provisional)" if v else None, geography=geo, source=src,
            note='Average monthly private rent paid by tenants (ONS PIPR); the latest two months are provisional.')}
    log(f"rents: {len(got)} local authorities, Trafford £{(got.get('E08000009') or {}).get('monthly')}")
    return out
