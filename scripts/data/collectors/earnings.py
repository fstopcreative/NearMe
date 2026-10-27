"""
ONS Annual Survey of Hours and Earnings via Nomis (OGL) — "Average pay".

Median gross annual pay of full-time employees who live in the borough
(resident analysis, NM_30_1), with the year before, Greater Manchester and
England for comparison. ASHE is published for local authorities, so towns
show their borough's figure.
"""
import urllib.parse

from lib.common import http, read_csv_text, metric, log, is_region

URL = 'https://www.nomisweb.co.uk/api/v01/dataset/NM_30_1.data.csv?'
GM, ENGLAND = 'E11000001', 'E92000001'


def collect(ctx):
    codes = sorted({a['lad'] for a in ctx.areas} | {GM, ENGLAND})
    q = {'geography': ','.join(codes), 'date': 'latest,latestMINUS1', 'sex': 8, 'item': 2, 'pay': 7, 'measures': 20100,
         'select': 'date_name,geography_code,geography_name,obs_value,obs_status_name'}
    rows = read_csv_text(http(URL + urllib.parse.urlencode(q, safe=','), timeout=120).decode('utf-8-sig'))
    data, names = {}, {}
    for r in rows:
        try:
            data.setdefault(r['GEOGRAPHY_CODE'], {})[int(r['DATE_NAME'])] = int(float(r['OBS_VALUE']))
        except (TypeError, ValueError):
            continue
        names[r['GEOGRAPHY_CODE']] = r['GEOGRAPHY_NAME'].replace(' (Met County)', '')
    year = max(y for v in data.values() for y in v)
    get = lambda code, y=year: data.get(code, {}).get(y)
    out = {}
    for area in ctx.areas:
        code = area['lad']
        now, before = get(code), get(code, year - 1)
        comparison = {names.get(c, c): get(c) for c in (GM, ENGLAND) if c != code and get(c)}
        value = {'annual': now, 'previous': before,
                 'change_pct': round((now - before) / before * 100, 1) if now and before else None,
                 'comparison': comparison} if now else None
        out[area['id']] = {'earnings': metric(
            value, unit='GBP a year', period=f'{year} (ASHE, April; provisional)', source='ashe',
            geography=f"{area['borough']} residents ({'county' if is_region(area) else 'borough-wide'})",
            note='Median gross annual pay of full-time employees living in the area (ONS ASHE, resident analysis).')}
    log(f'earnings: {year}, Trafford £{get("E08000009")}')
    return out
