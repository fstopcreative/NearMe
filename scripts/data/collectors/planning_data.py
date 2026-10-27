"""
planning.data.gov.uk (MHCLG) — open planning datasets, all OGL:

  planning_constraints  listed buildings (Historic England), Article 4 directions,
                        Green Belt, tree preservation zones, scheduled monuments
  development_sites     brownfield land registers (councils' sites suitable for housing)
  flood_zones           Environment Agency Flood Zones 2 and 3 (rivers and the sea)
  aqma                  Defra air quality management areas

Areas use a 1.5 km circle around the centre (1 km for flood zones); the
borough uses its extent. The centre itself is checked for Green Belt, flood
zone and AQMA.
"""
import re
import urllib.parse

from lib.common import http_json, circle_wkt, miles, metric, log, SOURCES, is_region, region_only

API = 'https://www.planning.data.gov.uk/entity.json'
RADIUS_M = 1500
FLOOD_RADIUS_M = 1000
ORG = {'Trafford': 347, 'Warrington': 385}
# Borough extents (WGS84) for borough-wide counts
EXTENT = {'Trafford': 'POLYGON((-2.478 53.357, -2.253 53.357, -2.253 53.480, -2.478 53.480, -2.478 53.357))'}
SRC = {
    'constraints': dict(SOURCES['conservation'], name='Planning Data — listed buildings, Article 4, Green Belt, TPO, scheduled monuments (MHCLG / Historic England)',
                        url='https://www.planning.data.gov.uk/'),
    'brownfield': dict(SOURCES['conservation'], name='Planning Data — brownfield land registers (MHCLG)',
                       url='https://www.planning.data.gov.uk/dataset/brownfield-land'),
    'flood': dict(SOURCES['conservation'], name='Environment Agency Flood Zones 2 and 3 (via Planning Data)',
                  url='https://www.planning.data.gov.uk/dataset/flood-risk-zone'),
    'aqma': dict(SOURCES['conservation'], name='Defra air quality management areas (via Planning Data)',
                 url='https://www.planning.data.gov.uk/dataset/air-quality-management-area'),
}
STATUS = {'permissioned': 'Permission granted', 'not-permissioned': 'No permission yet', 'pending-decision': 'Pending decision'}


def entities(dataset, **params):
    """All current entities (paged)."""
    out, offset = [], 0
    while True:
        p = {'dataset': dataset, 'limit': 500, 'offset': offset, **params}
        d = http_json(API + '?' + urllib.parse.urlencode(p))
        batch = d.get('entities', [])
        out += [e for e in batch if not e.get('end-date')]
        if len(batch) < 500:
            return out
        offset += 500


def point_of(e):
    pt = (e.get('point') or '').replace('POINT (', '').replace(')', '').split()
    return (float(pt[1]), float(pt[0])) if len(pt) == 2 else (None, None)


def dist(area, e):
    lat, lng = point_of(e)
    c = area['centre']
    return round(miles(c['lat'], c['lng'], lat, lng), 1) if lat else None


def collect(ctx):
    out = {}
    for area in ctx.areas:
        c = area['centre']
        if is_region(area):
            out[area['id']] = region_only(area, ['planning_constraints', 'development_sites', 'flood_zones', 'aqma'], SRC['constraints'])
            continue
        borough = area.get('kind') == 'borough'
        if borough:
            zone = EXTENT.get(area['borough']) or circle_wkt(c['lat'], c['lng'], 8000)
            where = dict(geometry=zone, geometry_relation='intersects')
            scope = f"{area['borough']} (borough)"
        else:
            where = dict(geometry=circle_wkt(c['lat'], c['lng'], RADIUS_M), geometry_relation='intersects')
            scope = f"within {RADIUS_M / 1000:g} km of the centre of {area['name']}"
        at_centre = dict(longitude=c['lng'], latitude=c['lat'])

        # ── planning constraints ──
        listed = entities('listed-building', **where)
        grades = {g: sum(1 for e in listed if e.get('listed-building-grade') == g) for g in ('I', 'II*', 'II')}
        a4 = entities('article-4-direction-area', **where)
        tpo = entities('tree-preservation-zone', **where)
        sm = entities('scheduled-monument', **where)
        gb_centre = entities('green-belt', **at_centre)
        gb_near = entities('green-belt', **where)
        top_listed = sorted([e for e in listed if e.get('listed-building-grade') in ('I', 'II*')], key=lambda e: dist(area, e) or 99)[:3]
        rows = [
            {'label': 'Listed buildings', 'meta': ' · '.join(f'Grade {g}: {n}' for g, n in grades.items() if n) or 'None nearby',
             'value': str(len(listed))},
            {'label': 'Green Belt', 'meta': 'Centre of the area' if not borough else 'Land in the borough',
             'value': ('Yes' if gb_centre else 'No') if not borough else ('Yes' if gb_near else 'No')},
            {'label': 'Article 4 directions', 'meta': ', '.join(sorted({e.get('name') or e.get('reference') for e in a4}))[:90] or None,
             'value': str(len(a4))},
            {'label': 'Tree preservation zones', 'meta': None, 'value': str(len(tpo))},
            {'label': 'Scheduled monuments', 'meta': ', '.join(e.get('name', '') for e in sm[:2]) or None, 'value': str(len(sm))},
        ]
        rec = {'planning_constraints': metric(rows, period='Current designations', geography=scope, source=SRC['constraints'],
                                              listed={'total': len(listed), **grades,
                                                      'notable': [{'name': e['name'].title(), 'grade': e.get('listed-building-grade'),
                                                                   'url': e.get('documentation-url')} for e in top_listed]},
                                              green_belt=bool(gb_centre) if not borough else bool(gb_near),
                                              article4=len(a4), tpo=len(tpo), scheduled_monuments=len(sm))}

        # ── brownfield land (development sites) ──
        bf = entities('brownfield-land', **({'organisation_entity': ORG[area['borough']]} if borough and area['borough'] in ORG else where))
        sites = []
        for e in bf:
            homes = e.get('maximum-net-dwellings') or e.get('minimum-net-dwellings')
            try:
                homes = int(float(homes)) if homes not in (None, '') else None
            except ValueError:
                homes = None
            if homes is None:                       # some registers (e.g. Trafford) state capacity in the notes only
                m = re.search(r'(\d[\d,]*)\s*(?:units|dwellings|homes)', e.get('notes') or '', re.I)
                homes = int(m.group(1).replace(',', '')) if m else None
            sites.append({'name': (e.get('site-address') or e.get('name') or 'Brownfield site').strip(), 'ref': e.get('reference'),
                          'homes': homes, 'hectares': float(e['hectares']) if e.get('hectares') else None,
                          'status': STATUS.get(e.get('planning-permission-status'), 'Not stated'),
                          'permission_date': e.get('planning-permission-date') or None,
                          'distance_mi': None if borough else dist(area, e),
                          'url': e.get('site-plan-url') or f"https://www.planning.data.gov.uk/entity/{e['entity']}"})
        sites.sort(key=lambda s: (-(s['homes'] or 0), s['distance_mi'] or 0))
        latest = max((e.get('entry-date') or '' for e in bf), default='')
        rec['development_sites'] = metric({
            'count': len(sites), 'homes': sum(s['homes'] or 0 for s in sites),
            'hectares': round(sum(s['hectares'] or 0 for s in sites), 1),
            'permissioned': sum(1 for s in sites if s['status'] == 'Permission granted'),
            'sites': sites[:8]} if sites else None,
            period=f"Council brownfield land registers (entries up to {latest[:7]})" if latest else 'Council brownfield land registers',
            geography=scope, source=SRC['brownfield'],
            note='Sites councils consider suitable for housing; capacity is the maximum net number of homes where stated.')

        # ── flood zones ──
        fz_centre = entities('flood-risk-zone', **at_centre)
        fz_near = entities('flood-risk-zone', **(where if borough else dict(geometry=circle_wkt(c['lat'], c['lng'], FLOOD_RADIUS_M), geometry_relation='intersects')))
        lv = [int(e.get('flood-risk-level') or 0) for e in fz_centre]
        rec['flood_zones'] = metric({
            'centre_zone': max(lv) if lv else 1,
            'zone2_nearby': sum(1 for e in fz_near if str(e.get('flood-risk-level')) == '2'),
            'zone3_nearby': sum(1 for e in fz_near if str(e.get('flood-risk-level')) == '3'),
            'radius_km': None if borough else FLOOD_RADIUS_M / 1000, 'borough': borough},
            period='Current flood map for planning', source=SRC['flood'],
            geography=scope if borough else f"Centre of {area['name']} and land within {FLOOD_RADIUS_M / 1000:g} km",
            note='Flood Zone 1 = low probability, 2 = medium, 3 = high (rivers and the sea). Surface water risk is not included.')

        # ── air quality management areas ──
        aq_in = entities('air-quality-management-area', **at_centre)
        aq_near = entities('air-quality-management-area', **where)
        rec['aqma'] = metric({
            'inside': [e['name'] for e in aq_in] if not borough else [],
            'nearby': [{'name': e['name'], 'url': e.get('documentation-url')} for e in aq_near]},
            period='Current declarations', geography=scope, source=SRC['aqma'])
        out[area['id']] = rec
    log('planning data: done')
    return out
