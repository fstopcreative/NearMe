"""
planning.data.gov.uk conservation areas (FINAL source for "Conservation area
status"). Lists the conservation areas within 1.5 km of the area centre (all
of them for the borough) and whether the centre itself lies inside one.
"""
import json
import urllib.parse

from lib.common import http_json, circle_wkt, miles, metric, log, is_region, region_only

API = 'https://www.planning.data.gov.uk/entity.json'
RADIUS_M = 1500
ORG = {'Trafford': 347, 'Warrington': 385}


def query(**params):
    params.setdefault('dataset', 'conservation-area')
    params.setdefault('limit', 100)
    return http_json(API + '?' + urllib.parse.urlencode(params)).get('entities', [])


def centroid(wkt):
    nums = [float(x) for x in wkt.replace('(', ' ').replace(')', ' ').replace(',', ' ').split()
            if x.replace('.', '', 1).replace('-', '', 1).isdigit()]
    xs, ys = nums[0::2], nums[1::2]
    return (sum(ys) / len(ys), sum(xs) / len(xs)) if xs else (None, None)


def tidy(e, area):
    lat, lng = centroid(e.get('geometry') or '')
    c = area['centre']
    return {'name': e['name'], 'designated': (e.get('start-date') or '')[:10] or None,
            'distance_mi': round(miles(c['lat'], c['lng'], lat, lng), 1) if lat else None,
            'url': f"https://www.planning.data.gov.uk/entity/{e['entity']}"}


def collect(ctx):
    out = {}
    for area in ctx.areas:
        c = area['centre']
        if is_region(area):
            out[area['id']] = region_only(area, ['conservation_areas'], 'conservation')
            continue
        if area.get('kind') == 'borough':
            ents = query(organisation_entity=ORG[area['borough']])
            inside = []
            geo = f"{area['borough']} — all conservation areas"
        else:
            ents = query(geometry=circle_wkt(c['lat'], c['lng'], RADIUS_M), geometry_relation='intersects')
            inside = [e['name'] for e in query(longitude=c['lng'], latitude=c['lat'])]
            geo = f"{area['name']} — within {RADIUS_M / 1000:g} km of the centre"
        items = sorted((tidy(e, area) for e in ents), key=lambda x: (x['distance_mi'] is None, x['distance_mi'] or 0, x['name']))
        out[area['id']] = {'conservation_areas': metric(
            {'centre_inside': inside, 'nearby': items, 'count': len(items)},
            period='Current designations', geography=geo, source='conservation')}
    log('conservation: done')
    return out
