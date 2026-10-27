"""
Mining Remediation Authority (Coal Authority) Data Mine (FINAL source for
"Mining risk"). Checks the area centre — and, for the borough, its extent —
against the Development High Risk Area and Development Low Risk Area layers.
Together these two layers make up the coal mining reporting area.
"""
import json
import urllib.parse

from lib.common import http_json, metric, log

BASE = 'https://services-eu1.arcgis.com/Qn4lKcPDVHNivEyr/arcgis/rest/services/{layer}/FeatureServer/0/query'
BOROUGH_ENVELOPE = {'Trafford': (-2.478, 53.357, -2.253, 53.480), 'Greater Manchester': (-2.731, 53.327, -1.909, 53.686)}


def hits(layer, geometry, gtype):
    p = {'geometry': json.dumps(geometry), 'geometryType': gtype, 'inSR': 4326, 'spatialRel': 'esriSpatialRelIntersects',
         'where': '1=1', 'returnCountOnly': 'true', 'f': 'json'}
    d = http_json(BASE.format(layer=layer) + '?' + urllib.parse.urlencode(p))
    if 'count' not in d:
        raise RuntimeError(f'{layer}: {d}')
    return d['count']


def collect(ctx):
    out = {}
    for area in ctx.areas:
        c = area['centre']
        if area.get('kind') in ('borough', 'region') and area['borough'] in BOROUGH_ENVELOPE:
            x1, y1, x2, y2 = BOROUGH_ENVELOPE[area['borough']]
            geom, gtype = {'xmin': x1, 'ymin': y1, 'xmax': x2, 'ymax': y2, 'spatialReference': {'wkid': 4326}}, 'esriGeometryEnvelope'
            geo = f"{area['borough']} — {'county' if area.get('kind') == 'region' else 'borough'} extent"
        else:
            geom, gtype = {'x': c['lng'], 'y': c['lat'], 'spatialReference': {'wkid': 4326}}, 'esriGeometryPoint'
            geo = f"{area['name']} — area centre"
        high = hits('DevelopmentHighRiskArea', geom, gtype) > 0
        low = hits('DevelopmentLowRiskArea', geom, gtype) > 0
        level = 'high' if high else 'low' if low else 'none'
        out[area['id']] = {'coal_mining': metric(
            {'reporting_area': high or low, 'development_high_risk': high, 'level': level,
             'partial': area.get('kind') in ('borough', 'region')},
            period='Current layers', geography=geo, source='coal',
            note='Check a specific property with a coal mining report before buying.')}
    log('coal: done')
    return out
