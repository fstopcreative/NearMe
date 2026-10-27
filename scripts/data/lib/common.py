"""
Shared helpers for the Area Radar data collectors.

Standard library only (no pip installs), so the GitHub Actions job and a local
run need nothing but Python 3.9+.
"""
import csv
import gzip
import hashlib
import io
import json
import math
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[1]           # scripts/data
ROOT = DATA_DIR.parents[1]                               # project root (CRADAR)
CACHE = DATA_DIR / '.cache'                              # git-ignored download cache
OUT_DIR = ROOT / 'public' / 'data' / 'areas'
USER_AGENT = 'CorelainAreaRadar/1.3 (+https://www.corelain.com/; data refresh)'

CACHE.mkdir(exist_ok=True)


def log(*args):
    print('[data]', *args, file=sys.stderr, flush=True)


# ── HTTP ────────────────────────────────────────────────────────────────────
def http(url, *, data=None, headers=None, timeout=120, retries=3, method=None):
    """GET/POST with retries. Returns bytes."""
    hdrs = {'User-Agent': USER_AGENT, 'Accept-Encoding': 'gzip'}
    hdrs.update(headers or {})
    body = data
    if isinstance(data, dict):
        body = urllib.parse.urlencode(data).encode()
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=body, headers=hdrs, method=method)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read()
                if r.headers.get('Content-Encoding') == 'gzip':
                    raw = gzip.decompress(raw)
                return raw
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            last = e
            if isinstance(e, urllib.error.HTTPError) and e.code in (400, 401, 403, 404):
                break
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f'GET {url[:160]} failed: {last}')


def http_json(url, **kw):
    return json.loads(http(url, **kw))


def download(url, name, *, timeout=900):
    """Download a large file into the cache (re-used while the URL is unchanged)."""
    key = name + '.' + hashlib.sha1(url.encode()).hexdigest()[:8]     # stable across runs (str hash() is salted)
    path = CACHE / key
    if path.exists() and path.stat().st_size > 0:
        return path
    log('downloading', url)
    tmp = path.with_suffix('.part')
    req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as r, open(tmp, 'wb') as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
    tmp.rename(path)
    return path


def govuk_attachments(path):
    """Attachments of a GOV.UK publication page via the public Content API."""
    d = http_json('https://www.gov.uk/api/content' + path)
    out = []
    for key in ('attachments', 'documents'):
        for a in (d.get('details', {}).get(key) or []):
            if isinstance(a, dict) and a.get('url'):
                url = a['url'] if a['url'].startswith('http') else 'https://www.gov.uk' + a['url']
                out.append({'title': a.get('title') or '', 'url': url})
    return out


# ── Postcodes (postcodes.io, open data: ONS Postcode Directory) ─────────────
_PC_FILE = CACHE / 'postcodes.json'
_PC = json.loads(_PC_FILE.read_text()) if _PC_FILE.exists() else {}


def norm_pc(pc):
    pc = (pc or '').upper().replace(' ', '')
    return pc[:-3] + ' ' + pc[-3:] if len(pc) > 4 else pc


def lookup_postcodes(postcodes):
    """postcode → {lat, lng, e, n, ward, ward_code, lsoa, lad} (None if unknown). Cached."""
    want = sorted({norm_pc(p) for p in postcodes if p} - set(_PC))
    for i in range(0, len(want), 100):
        batch = want[i:i + 100]
        try:
            res = http_json('https://api.postcodes.io/postcodes', method='POST',
                            data=json.dumps({'postcodes': batch}).encode(),
                            headers={'Content-Type': 'application/json'})
        except RuntimeError as e:
            log('postcodes.io batch failed:', e)
            continue
        for item in res.get('result') or []:
            r = item.get('result')
            _PC[norm_pc(item['query'])] = None if not r else {
                'lat': r['latitude'], 'lng': r['longitude'], 'e': r['eastings'], 'n': r['northings'],
                'ward': r['admin_ward'], 'ward_code': r['codes']['admin_ward'],
                'lsoa': r['codes'].get('lsoa'), 'lad': r['codes']['admin_district'],
            }
        time.sleep(0.2)
    if want:
        _PC_FILE.write_text(json.dumps(_PC))
    return {norm_pc(p): _PC.get(norm_pc(p)) for p in postcodes if p}


def nearest_postcode(lat, lng):
    """Nearest postcode to a point (for eastings/northings and LSOA of an area centre)."""
    key = f'@{lat:.4f},{lng:.4f}'
    if key not in _PC:
        d = http_json(f'https://api.postcodes.io/postcodes?lon={lng}&lat={lat}&radius=2000&limit=1')
        r = (d.get('result') or [None])[0]
        _PC[key] = None if not r else {
            'postcode': r['postcode'], 'e': r['eastings'], 'n': r['northings'], 'ward': r['admin_ward'],
            'lsoa': r['codes'].get('lsoa'), 'lad': r['codes']['admin_district'],
        }
        _PC_FILE.write_text(json.dumps(_PC))
    return _PC[key]


# ── Geometry ────────────────────────────────────────────────────────────────
def miles(lat1, lng1, lat2, lng2):
    r = 3958.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def circle_wkt(lat, lng, radius_m, sides=24):
    """Approximate circle polygon (WGS84 WKT) for "within X metres" queries."""
    pts = []
    for i in range(sides + 1):
        t = 2 * math.pi * (i % sides) / sides
        dlat = (radius_m / 111320) * math.cos(t)
        dlng = (radius_m / (111320 * math.cos(math.radians(lat)))) * math.sin(t)
        pts.append(f'{lng + dlng:.6f} {lat + dlat:.6f}')
    return 'POLYGON((' + ', '.join(pts) + '))'


# ── Metric records ──────────────────────────────────────────────────────────
SOURCES = {
    'ppd': {'name': 'HM Land Registry Price Paid Data', 'url': 'https://landregistry.data.gov.uk/app/ppd',
            'licence': 'Open Government Licence v3.0'},
    'ukhpi': {'name': 'UK House Price Index (HM Land Registry / ONS)', 'url': 'https://landregistry.data.gov.uk/app/ukhpi',
              'licence': 'Open Government Licence v3.0'},
    'crime': {'name': 'Home Office police recorded crime, Community Safety Partnership open data tables',
              'url': 'https://www.gov.uk/government/statistics/police-recorded-crime-open-data-tables',
              'licence': 'Open Government Licence v3.0'},
    'population': {'name': 'ONS mid-year population estimates (Nomis)', 'url': 'https://www.nomisweb.co.uk/',
                   'licence': 'Open Government Licence v3.0'},
    'ofsted': {'name': 'Ofsted management information: state-funded schools, latest inspections',
               'url': 'https://www.gov.uk/government/statistical-data-sets/monthly-management-information-ofsteds-school-inspections-outcomes',
               'licence': 'Open Government Licence v3.0'},
    'tcm': {'name': 'DfT Transport Connectivity Metric', 'url': 'https://www.gov.uk/government/publications/transport-connectivity-metric',
            'licence': 'Open Government Licence v3.0'},
    'defra': {'name': 'Defra LAQM background maps (1 km grid)', 'url': 'https://uk-air.defra.gov.uk/data/laqm-background-home',
              'licence': 'Open Government Licence v3.0'},
    'conservation': {'name': 'Planning Data — conservation areas (MHCLG)', 'url': 'https://www.planning.data.gov.uk/dataset/conservation-area',
                     'licence': 'Open Government Licence v3.0'},
    'coal': {'name': 'Mining Remediation Authority (Coal Authority) Data Mine', 'url': 'https://datamine-cauk.hub.arcgis.com/',
             'licence': 'Open Government Licence v3.0'},
    'flood': {'name': 'Environment Agency — Check long term flood risk', 'url': 'https://check-long-term-flood-risk.service.gov.uk/',
              'licence': 'Open Government Licence v3.0'},
    'planning': {'name': 'Trafford Council planning applications',
                 'url': 'https://www.trafford.gov.uk/planning-and-building-control/step-by-step/search-and-comment-planning-applications/search-planning-application',
                 'licence': 'Council website — entered by hand'},
    'news': {'name': 'Local news (edited list)', 'url': 'https://altrincham.todaynews.co.uk/', 'licence': 'Headlines and links only'},
    'news_rss': {'name': 'Local publisher RSS feeds', 'url': 'https://altrincham.todaynews.co.uk/feed/',
                 'licence': 'Publisher feeds; headlines and links only'},
    'radon_open': {'name': 'UKHSA / BGS Indicative Atlas of Radon (1 km)',
                   'url': 'https://www.bgs.ac.uk/datasets/radon-data-indicative-atlas-of-radon/',
                   'licence': 'Open Government Licence v3.0 · Radon Potential classification © UKHSA · BGS materials © UKRI'},
    'geosure_open': {'name': 'BGS GeoSure 5 km hex grid',
                     'url': 'https://www.bgs.ac.uk/datasets/bgs-geosure-5-km-hex-grid/',
                     'licence': 'Open Government Licence v3.0 · Contains BGS materials © UKRI'},
    'aqma': {'name': 'Trafford Council air quality management areas', 'url': 'https://uk-air.defra.gov.uk/aqma/',
             'licence': 'Open Government Licence v3.0'},
    'tfgm': {'name': 'Transport for Greater Manchester timetables', 'url': 'https://tfgm.com/',
             'licence': 'Entered by hand'},
    'editorial': {'name': 'Corelain editorial list', 'url': 'https://www.corelain.com/', 'licence': 'Links to public pages'},
    'census': {'name': 'ONS Census 2021 (Nomis) — Trafford Data Lab: Population & Households',
               'url': 'https://www.trafforddatalab.io/accessible_graphics/census_2021_population_and_households_infographic.html',
               'licence': 'Open Government Licence v3.0'},
    'tenure': {'name': 'ONS Census 2021, tenure (TS054) — How life has changed: Census 2021',
               'url': 'https://www.ons.gov.uk/visualisations/censusareachanges/E08000009/',
               'licence': 'Open Government Licence v3.0'},
    'ashe': {'name': 'ONS Annual Survey of Hours and Earnings (Nomis)', 'url': 'https://www.nomisweb.co.uk/datasets/asher',
             'licence': 'Open Government Licence v3.0'},
    'pipr': {'name': 'ONS Price Index of Private Rents — Housing prices in your area',
             'url': 'https://www.ons.gov.uk/visualisations/housingpriceslocal/E08000009/',
             'licence': 'Open Government Licence v3.0'},
    'gtfs': {'name': 'TfGM bus and Metrolink timetables (GTFS)', 'url': 'https://odata.tfgm.com/opendata/downloads/TfGMgtfsnew.zip',
             'licence': 'Open Government Licence v3.0 · Contains Transport for Greater Manchester data'},
}

# Greater Manchester's ten boroughs (ONS code → name), for the region view.
GM_LADS = {
    'E08000001': 'Bolton', 'E08000002': 'Bury', 'E08000003': 'Manchester', 'E08000004': 'Oldham',
    'E08000005': 'Rochdale', 'E08000006': 'Salford', 'E08000007': 'Stockport', 'E08000008': 'Tameside',
    'E08000009': 'Trafford', 'E08000010': 'Wigan',
}


def is_region(area):
    return area.get('kind') == 'region'


def is_wide(area):
    """Borough or region: whole-authority figures rather than a circle round the centre."""
    return area.get('kind') in ('borough', 'region')


def region_only(area, keys, source, note=None):
    """Records for metrics that are not compiled for the Greater Manchester overview."""
    note = note or 'Not compiled for the Greater Manchester overview — choose a borough or town.'
    return {k: metric(None, source=source, status='no-data', geography=area['name'], note=note) for k in keys}

STATUSES = ('ok', 'low-confidence', 'manual', 'no-data', 'disabled', 'missing-key', 'unavailable', 'error')


def metric(value, *, period=None, geography=None, source=None, status='ok', **extra):
    """One metric record. `source` is a SOURCES key or a dict (adds e.g. a file URL)."""
    src = SOURCES[source] if isinstance(source, str) else source
    rec = {'value': value, 'period': period, 'geography': geography, 'source': src, 'status': status}
    rec.update({k: v for k, v in extra.items() if v is not None})
    if value is None and status in ('ok', 'low-confidence'):
        rec['status'] = 'no-data'
    return rec


def empty(source, status, note, geography=None):
    return metric(None, source=source, status=status, note=note, geography=geography)


def month_end(d):
    nxt = date(d.year + (d.month == 12), d.month % 12 + 1, 1)
    return nxt - timedelta(days=1)


def fmt_period_end(d):
    return d.strftime('%-d %b %Y') if os.name != 'nt' else d.strftime('%#d %b %Y')


def parse_date(s, fmts=('%Y-%m-%d', '%d/%m/%Y')):
    for f in fmts:
        try:
            return datetime.strptime(s.strip()[:10], f).date()
        except (ValueError, AttributeError):
            pass
    return None


def read_csv_text(text):
    return list(csv.DictReader(io.StringIO(text)))
