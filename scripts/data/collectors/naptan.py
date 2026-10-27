"""
NaPTAN — DfT's national register of public transport stops (OGL).

  nearest_stops  nearest Metrolink stop and rail station to the area centre,
                 with an estimated walk; bus stops within 400 m; straight-line
                 distance to Manchester city centre (St Peter's Square).

Walking time assumes 4.8 km/h and a 1.3 detour factor on the straight line,
so it is an estimate (shown with "≈").
"""
import csv
import io
import re

from lib.common import http, miles, metric, log

URL = 'https://naptan.api.dft.gov.uk/v1/access-nodes?dataFormat=csv&atcoAreaCodes={codes}'
ATCO_AREAS = ['180', '068']            # Greater Manchester, Warrington
CITY_CENTRE = (53.4781, -2.2433)       # St Peter's Square
SOURCE = {'name': 'NaPTAN — national public transport stops (DfT)', 'url': 'https://beta-naptan.dft.gov.uk/download',
          'licence': 'Open Government Licence v3.0'}


def walk_min(mi):
    return max(1, round(mi * 1.609 * 1.3 / 4.8 * 60))


def station_name(name, kind):
    name = re.sub(r'\s*\((Manchester )?Metrolink\)', '', name, flags=re.I)
    name = re.sub(r'\s+(East|West|North|South|Main|Side)?\s*Entrance.*$', '', name, flags=re.I).strip()
    name = re.sub(r'\s+(Rail Station|Railway Station|Station|Metrolink|Tram Stop)$', '', name, flags=re.I).strip()
    return name + (' Metrolink' if kind == 'metro' else ' station')


def collect(ctx):
    rows = list(csv.DictReader(io.StringIO(http(URL.format(codes=','.join(ATCO_AREAS)), timeout=300).decode('utf-8-sig'))))
    stops = []
    for r in rows:
        if r.get('Status') != 'active':
            continue
        kind = {'TMU': 'metro', 'RSE': 'rail', 'BCT': 'bus'}.get(r['StopType'])
        if not kind:
            continue
        try:
            stops.append((kind, r['CommonName'], float(r['Latitude']), float(r['Longitude'])))
        except ValueError:
            continue
    # rail stations (one point per station, entrances merged) for routes.py
    rail = {}
    for k, n, la, ln in stops:
        if k == 'rail':
            rail.setdefault(station_name(n, 'rail').removesuffix(' station'), (la, ln))
    ctx.shared['rail_stations'] = rail
    out = {}
    for area in ctx.areas:
        c = area['centre']
        near = {}
        for kind in ('metro', 'rail'):
            best = min(((miles(c['lat'], c['lng'], la, ln), n) for k, n, la, ln in stops if k == kind), default=None)
            if best:
                near[kind] = {'name': station_name(best[1], kind), 'distance_mi': round(best[0], 1), 'walk_min': walk_min(best[0])}
        bus = sum(1 for k, n, la, ln in stops if k == 'bus' and miles(c['lat'], c['lng'], la, ln) <= 0.2485)
        value = {**near, 'bus_stops_400m': bus,
                 'city_centre_mi': round(miles(c['lat'], c['lng'], *CITY_CENTRE), 1)}
        out[area['id']] = {'nearest_stops': metric(value, period='Current stop register', source=SOURCE,
                                                   geography=f"From the centre of {area['name']}" if area.get('kind') != 'borough'
                                                   else f"From the centre of {area['name']} borough",
                                                   note='Straight-line distances; walking times are estimates.')}
    log(f'naptan: {len(stops)} active stops')
    return out
