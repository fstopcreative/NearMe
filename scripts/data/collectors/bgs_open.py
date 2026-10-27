"""
BGS / UKHSA open geohazard services (Open Government Licence v3.0).

The public ArcGIS endpoints are queried at each configured area centre:

* ``radon`` — the 1 km Indicative Atlas of Radon.  This is a screening
  dataset, not the paid property-level radon report.
* ``ground`` — the six BGS GeoSure 5 km hex-grid themes.  These are a
  deliberately generalised regional overview, so the metric is always marked
  low-confidence and must not be presented as a property survey.

Both services accept WGS84 points and return only attributes; no GIS package
or API key is needed.
"""
import urllib.parse

from lib.common import http_json, metric, log, SOURCES

RADON_QUERY = (
    'https://map.bgs.ac.uk/arcgis/rest/services/SDDS/'
    'Radon_Indicative_Atlas/MapServer/0/query'
)
GEOSURE_ROOT = (
    'https://map.bgs.ac.uk/arcgis/rest/services/GeoIndex_Onshore/'
    'hex_grids/MapServer'
)

RADON_BANDS = {
    1: '<1% of homes above the action level',
    2: '1% to <3% of homes above the action level',
    3: '3% to <5% of homes above the action level',
    4: '5% to <10% of homes above the action level',
    5: '10% to <30% of homes above the action level',
    6: '30% to <100% of homes above the action level',
}

# Layer ids in the public BGS GeoSure 5 km hex-grid MapServer.
GEOSURE_LAYERS = {
    'collapsible_deposits': (2, 'Collapsible deposits'),
    'compressible_ground': (3, 'Compressible ground'),
    'landslides': (4, 'Landslides'),
    'running_sand': (5, 'Running sand'),
    'shrink_swell': (6, 'Shrink–swell'),
    'soluble_rocks': (7, 'Soluble rocks'),
}
SEVERITY = {'Low': 1, 'Moderate': 2, 'Significant': 3}


def point_query(url, lat, lng, fields):
    params = {
        'where': '1=1',
        'geometry': f'{lng},{lat}',
        'geometryType': 'esriGeometryPoint',
        'inSR': 4326,
        'spatialRel': 'esriSpatialRelIntersects',
        'outFields': ','.join(fields),
        'returnGeometry': 'false',
        'f': 'json',
    }
    data = http_json(url + '?' + urllib.parse.urlencode(params))
    if data.get('error'):
        raise RuntimeError(data['error'].get('message') or str(data['error']))
    features = data.get('features') or []
    return features[0].get('attributes', {}) if features else None


def collect(ctx):
    out = {}
    for area in ctx.areas:
        lat, lng = area['centre']['lat'], area['centre']['lng']
        geography = f"1 km grid square at the centre of {area['name']}"

        radon_attr = point_query(RADON_QUERY, lat, lng, ['CLASS_MAX'])
        radon_class = int(radon_attr['CLASS_MAX']) if radon_attr and radon_attr.get('CLASS_MAX') else None
        radon = metric(
            {'class': radon_class, 'of': 6, 'share': RADON_BANDS[radon_class]} if radon_class else None,
            period='Indicative Atlas version 3 (2022)',
            geography=geography,
            source='radon_open',
            status='ok' if radon_class else 'no-data',
            note='Indicative 1 km screening value; use an official address search or property test for a definitive result.',
        )

        hazards = {}
        version = None
        for key, (layer, label) in GEOSURE_LAYERS.items():
            attr = point_query(f'{GEOSURE_ROOT}/{layer}/query', lat, lng,
                               ['CLASS', 'Legend', 'Advisory', 'Notice', 'Version'])
            if not attr:
                continue
            rating = (attr.get('Legend') or '').strip()
            if rating:
                hazards[key] = {'label': label, 'rating': rating}
            version = (attr.get('Version') or version or '').strip() or version

        overall = max((x['rating'] for x in hazards.values()),
                      key=lambda x: SEVERITY.get(x, 0), default=None)
        ground = metric(
            {'natural_subsidence': overall, 'hazards': hazards} if overall else None,
            period=f'GeoSure {version or "v8"} 5 km hex grid',
            geography=f"5 km generalised hexagon containing the centre of {area['name']}",
            source='geosure_open',
            status='low-confidence' if overall else 'no-data',
            note='Regional screening only: the highest of six natural ground-movement themes. Not suitable for site-specific analysis.',
        )
        out[area['id']] = {'radon': radon, 'ground': ground}

    log(f'BGS open: radon and ground screening for {len(out)} areas')
    return out
