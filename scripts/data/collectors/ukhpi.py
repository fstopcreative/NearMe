"""
UK House Price Index (FINAL source for "Annual growth %" at local authority
level). Gives the official borough figure and the UK figure the growth KPI is
compared with. Area-level growth comes from land_registry.py.

The Greater Manchester overview takes all of its market figures from here
(the county series of the UK HPI): average price, annual change, a calendar-year
trend (mean of the monthly averages) and the latest average by property type.
"""
from collections import defaultdict
from datetime import date
from statistics import mean

from lib.common import http, read_csv_text, metric, is_region

BASE = 'https://landregistry.data.gov.uk/app/ukhpi/download/new.csv'
REGIONS = {'Trafford': 'trafford', 'Warrington': 'warrington', 'United Kingdom': 'united-kingdom',
           'Greater Manchester': 'greater-manchester'}
TYPES = {'detached': 'Detached houses', 'semi': 'Semi-detached houses', 'terraced': 'Terraced houses',
         'flat': 'Flats and maisonettes'}


def series(region, years=1):
    today = date.today()
    q = (f'?from={today.year - years}-01-01&to={today.year}-12-01'
         f'&location=http%3A%2F%2Flandregistry.data.gov.uk%2Fid%2Fregion%2F{region}'
         '&thm%5B%5D=property_type&in%5B%5D=avg&in%5B%5D=pac&lang=en')
    rows = read_csv_text(http(BASE + q, headers={'Accept-Language': 'en'}).decode('utf-8'))
    return sorted((r for r in rows if r.get('Average price All property types')), key=lambda r: r['Period'])


def month_label(period):
    y, m = map(int, period.split('-'))
    return date(y, m, 1).strftime('%B %Y')


def latest(rows):
    r = rows[-1]
    return {
        'average': int(float(r['Average price All property types'])),
        'growth': float(r['Percentage change (yearly) All property types']),
        'period': month_label(r['Period']),
    }


def region_market(name, rows):
    """average_price, annual_growth, price_trend and price_by_type for a whole county (UK HPI)."""
    r = rows[-1]
    period, geo = month_label(r['Period']), f'{name} (UK HPI county series)'
    by_year = defaultdict(list)
    for x in rows:
        by_year[int(x['Period'][:4])].append(float(x['Average price All property types']))
    last_full = max(y for y, v in by_year.items() if len(v) == 12)
    trend = [{'year': y, 'average': round(mean(by_year[y]))} for y in range(last_full - 9, last_full + 1) if len(by_year[y]) == 12]
    num = lambda k: float(r[k]) if r.get(k) not in (None, '') else None
    types = {key: {'average': round(num(f'Average price {col}')) if num(f'Average price {col}') else None,
                   'growth': num(f'Percentage change (yearly) {col}')} for key, col in TYPES.items()}
    return {
        'average_price': metric(int(float(r['Average price All property types'])), unit='GBP', period=period, geography=geo,
                                source='ukhpi', note='UK HPI mix-adjusted average for the month.'),
        'annual_growth': metric(float(r['Percentage change (yearly) All property types']), unit='%',
                                period=f'{period} vs a year earlier', geography=geo, source='ukhpi'),
        'price_trend': metric(trend or None, unit='GBP',
                              period=f'{trend[0]["year"]}–{trend[-1]["year"]}, mean of monthly averages' if trend else None,
                              geography=geo, source='ukhpi'),
        'price_by_type': metric(types, unit='GBP / %', period=period, geography=geo, source='ukhpi', hpi=True),
    }


def collect(ctx):
    regional = any(is_region(a) for a in ctx.areas)
    rows = {name: series(slug, years=11 if name == 'Greater Manchester' else 1) for name, slug in REGIONS.items()
            if name != 'Greater Manchester' or regional}
    data = {name: latest(r) for name, r in rows.items()}
    uk = data['United Kingdom']
    out = {}
    for area in ctx.areas:
        b = data.get(area['borough'])
        rec = {
            'hpi_borough': metric(b and {'average': b['average'], 'growth': b['growth']}, unit='GBP / %',
                                  period=b and b['period'],
                                  geography=f"{area['borough']} ({'county' if is_region(area) else 'local authority'})", source='ukhpi'),
            'hpi_uk': metric({'average': uk['average'], 'growth': uk['growth']}, unit='GBP / %',
                             period=uk['period'], geography='United Kingdom', source='ukhpi'),
        }
        if is_region(area):
            rec.update(region_market(area['name'], rows[area['name']]))
        out[area['id']] = rec
    return out
