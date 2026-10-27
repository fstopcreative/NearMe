"""
Defra LAQM background maps (FINAL source for "Air quality").

Modelled annual mean NO₂, PM2.5 and PM10 on a 1 km grid, per local authority
(official CSV download). An area value is the mean of the grid squares whose
centre lies within 1.5 km of the area centre; the borough uses every square
and Greater Manchester every square in its ten boroughs.
The maps are projections from a 2021 base year, so the current year is used.
"""
import csv
import io
import math
from datetime import date
from statistics import mean

from lib.common import http, nearest_postcode, metric, log, SOURCES, GM_LADS, is_region

URL = ('https://uk-air.defra.gov.uk/data/laqm-background-maps.php?view=data&bkgrd-la={la}&bkgrd-pollutant={pol}'
       '&bkgrd-year={year}&action=data&year={base}&submit=Download+CSV')
BASE_YEAR = 2021
POLLUTANTS = {'no2': 'Total_NO2', 'pm25': 'Total_PM2.5', 'pm10': 'Total_PM10'}
LIMITS = {'no2': 40, 'pm25': 20, 'pm10': 40}          # UK annual mean limit values (µg/m³)
RADIUS_M = 1500


def grid(la, pol, year):
    text = http(URL.format(la=la, pol=pol, year=year, base=BASE_YEAR)).decode('utf-8', 'replace')
    lines = text.splitlines()
    start = next(i for i, l in enumerate(lines) if l.startswith('Local_Auth_Code'))
    col = f'{POLLUTANTS[pol]}_{str(year)[2:]}'
    cells = []
    for r in csv.DictReader(io.StringIO('\n'.join(lines[start:]))):
        try:
            cells.append((float(r['x']), float(r['y']), float(r[col])))
        except (ValueError, KeyError, TypeError):
            continue                                   # "MISSING" squares
    return cells


def collect(ctx):
    year = min(date.today().year, 2040)
    las = {a['lad'] for a in ctx.areas if not is_region(a)} | (set(GM_LADS) if any(is_region(a) for a in ctx.areas) else set())
    grids = {(la, pol): grid(la, pol, year) for la in las for pol in POLLUTANTS}
    period = f'{year} annual mean (projection from the {BASE_YEAR} base year)'
    out = {}
    for area in ctx.areas:
        val = {}
        if is_region(area):
            for pol in POLLUTANTS:
                cells = [c for la in GM_LADS for c in grids[(la, pol)]]
                val[pol] = round(mean(c[2] for c in cells), 1) if cells else None
            geo = 'Greater Manchester — all 1 km squares in the ten boroughs'
        elif area.get('kind') == 'borough':
            for pol in POLLUTANTS:
                cells = grids[(area['lad'], pol)]
                val[pol] = round(mean(c[2] for c in cells), 1) if cells else None
            geo = f"{area['borough']} — all 1 km squares"
        else:
            np = nearest_postcode(area['centre']['lat'], area['centre']['lng'])
            for pol in POLLUTANTS:
                cells = [c for c in grids[(area['lad'], pol)]
                         if np and math.hypot(c[0] - np['e'], c[1] - np['n']) <= RADIUS_M]
                val[pol] = round(mean(c[2] for c in cells), 1) if cells else None
            geo = f"{area['name']} — 1 km squares within {RADIUS_M / 1000:g} km of the centre"
        val['limits'] = LIMITS
        ok = any(val[p] is not None for p in POLLUTANTS)
        out[area['id']] = {'air_quality': metric(val if ok else None, unit='µg/m³', period=period, geography=geo,
                                                 source='defra',
                                                 note='Modelled background concentrations; roadside levels can be higher.')}
    log(f'air quality: {year}, {len(grids)} grids')
    return out
