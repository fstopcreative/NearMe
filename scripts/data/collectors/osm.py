"""
OpenStreetMap via the Overpass API (ODbL — "© OpenStreetMap contributors"
is shown with the data).

  places         landmarks near the centre: stations and tram stops, parks,
                 museums, shopping centres, stadiums, libraries, hospitals
Hand-entered lists in scripts/data/manual/ take precedence where they exist.
"""
import json
import time
import urllib.parse

from lib.common import http, miles, metric, log

ENDPOINTS = ['https://z.overpass-api.de/api/interpreter', 'https://overpass-api.de/api/interpreter']
SOURCE = {'name': 'OpenStreetMap (© OpenStreetMap contributors)', 'url': 'https://www.openstreetmap.org/copyright',
          'licence': 'Open Database Licence (ODbL)'}
# (overpass filter, page type, tone, max per type)
KINDS = [
    ('["railway"="station"]["name"]', 'Train station', '--ax-viz-violet', 2),
    ('["railway"="tram_stop"]["name"]', 'Tram stop', '--ax-viz-violet', 2),
    ('["leisure"="park"]["name"]', 'Park', '--ax-viz-emerald', 2),
    ('["tourism"="museum"]["name"]', 'Museum', '--ax-viz-amber', 1),
    ('["shop"="mall"]["name"]', 'Shopping centre', '--ax-viz-cyan', 1),
    ('["leisure"="stadium"]["name"]', 'Stadium', '--ax-accent', 1),
    ('["amenity"="library"]["name"]', 'Library', '--ax-viz-pink', 1),
    ('["amenity"="hospital"]["name"]', 'Hospital', '--ax-danger-500', 1),
]
MAX_PLACES = 8
BBOX = (53.34, -2.50, 53.53, -2.17)      # Trafford and its neighbours, plus central Manchester


def overpass(query):
    last = None
    for attempt in range(3):
        for ep in ENDPOINTS:
            try:
                url = ep + '?' + urllib.parse.urlencode({'data': query})
                raw = http(url, headers={'Accept': 'application/json'}, timeout=120, retries=1)
                return json.loads(raw)['elements']
            except Exception as e:
                last = e
        time.sleep(10 * (attempt + 1))
    raise RuntimeError(f'Overpass unavailable: {last}')


def latlng(e):
    if 'lat' in e:
        return e['lat'], e['lon']
    c = e.get('center') or {}
    return c.get('lat'), c.get('lon')


def address(t):
    street = ' '.join(x for x in (t.get('addr:housenumber'), t.get('addr:street')) if x)
    return ', '.join(x for x in (street, t.get('addr:city') or t.get('addr:suburb'), t.get('addr:postcode')) if x)


def collect(ctx):
    out = {}
    south, west, north, east = BBOX
    parts = ''.join(f'nwr{f}({south},{west},{north},{east});' for f, *_ in KINDS)
    elements = overpass(f'[out:json][timeout:90];({parts});out center tags;')
    for area in ctx.areas:
        c = area['centre']
        radius = 6000 if area.get('kind') in ('borough', 'region') else 2500
        found = []
        for f, kind, tone, cap in KINDS:
            key, value = f.split('"]')[0].strip('["').split('"="')
            items = []
            for e in elements:
                t = e.get('tags', {})
                if t.get(key) != value or not t.get('name'):
                    continue
                lat, lng = latlng(e)
                if lat is None:
                    continue
                distance = miles(c['lat'], c['lng'], lat, lng)
                if distance > radius / 1609.344:
                    continue
                items.append({'name': t['name'], 'addr': address(t) or t.get('addr:place') or area['name'], 'type': kind,
                              'dist_mi': round(distance, 1), 'tone': tone, 'll': f'{lat:.5f},{lng:.5f}'})
            seen, uniq = set(), []
            for it in sorted(items, key=lambda x: x['dist_mi']):
                if it['name'] not in seen:
                    seen.add(it['name']); uniq.append(it)
            found += uniq[:cap]
        found.sort(key=lambda x: x['dist_mi'])
        places = [{**p, 'dist': f"{p['dist_mi']} mi"} for p in found[:MAX_PLACES]]

        out[area['id']] = {
            'places': metric(places or None, period='Current map data', source=SOURCE,
                             geography=f"Within {radius / 1000:g} km of the centre of {area['name']}"),
        }
        log(f"osm {area['id']}: {len(places)} places")
    return out
