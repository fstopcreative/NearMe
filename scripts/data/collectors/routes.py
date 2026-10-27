"""
Public transport routes serving each area.

  routes   trams  Metrolink lines that stop within 1 km of the area centre, with
                  their end points (e.g. Green Line: Altrincham – Bury)
           buses  bus services that stop within 1 km, with where each starts and
                  ends (e.g. 192: Manchester – Stockport – Hazel Grove)
           rail   nearby stations (NaPTAN) and the lines that call there
                  (config/rail-lines.json, checked by hand: TfGM's open GTFS has
                  no National Rail services)

Source: TfGM's open GTFS timetable (OGL), downloaded once a week. Services
are ranked by the number of timetabled journeys calling at the area's stops.
The borough uses every town's stops; Greater Manchester lists the whole tram
network, the busiest bus services and the main city-centre stations.
"""
import csv
import io
import json
import re
import zipfile
from collections import Counter, defaultdict
from datetime import date

from lib.common import CACHE, DATA_DIR, download, miles, metric, log, SOURCES, is_region

URL = 'https://odata.tfgm.com/opendata/downloads/TfGMgtfsnew.zip'
RAIL = DATA_DIR / 'config' / 'rail-lines.json'
RADIUS_MI = 1.0 / 1.609344
RAIL_RADIUS_MI = 2.0
MAX_BUSES = {'area': 25, 'borough': 40, 'region': 30}
LINE_COLOURS = {'Blue': '#0097d7', 'Green': '#6cbe45', 'Navy': '#283a8a', 'Pink': '#e94f8a', 'Purple': '#7b2d8e',
                'Red': '#e30613', 'Yellow': '#f5c400'}
SCHOOL = re.compile(r'\b(school|college|academy|grammar|high)\b', re.I)
TRAM_MAP = 'https://tfgm.com/ways-to-travel/tram/network-map'


def table(z, name):
    return csv.DictReader(io.TextIOWrapper(z.open(name), encoding='utf-8-sig'))


def ends(long_name):
    parts = [p.strip() for p in re.split(r'\s+-\s+', long_name or '') if p.strip()]
    return (parts[0], parts[-1], parts[1:-1]) if len(parts) >= 2 else (long_name, None, [])


def gtfs_path():
    """The timetable zip; the URL never changes, so the cache name carries the ISO week (one download a week)."""
    y, w, _ = date.today().isocalendar()
    name = f'tfgm-gtfs-{y}w{w:02d}.zip'
    path = CACHE / name
    for old in CACHE.glob('tfgm-gtfs-*'):
        if old != path:
            old.unlink()
    if not path.exists():
        download(URL, name).rename(path)
    return path


def rail_for(area, stations, cfg):
    c = area['centre']
    lines = cfg['lines']

    def entry(name, d):
        s = cfg['stations'].get(name, {})
        return {'name': name, 'distance_mi': round(d, 1) if d is not None else None,
                'url': 'https://www.nationalrail.co.uk/stations/' + re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-') + '/',
                'lines': [lines[k] for k in s.get('lines', []) if k in lines], 'operators': s.get('operators', [])}

    if is_region(area):
        return [entry(n, None) for n, s in cfg['stations'].items() if s.get('hub')]
    radius = 4.0 if area.get('kind') == 'borough' else RAIL_RADIUS_MI
    # only stations whose lines are in the config (leaves out e.g. the match-day-only Manchester United halt)
    near = sorted((miles(c['lat'], c['lng'], la, ln), n) for n, (la, ln) in stations.items() if n in cfg['stations'])
    picked = [x for x in near if x[0] <= radius][:12 if area.get('kind') == 'borough' else 3]
    if not picked and near and near[0][0] <= 8:
        picked = near[:1]
    return [entry(n, d) for d, n in picked]


def collect(ctx):
    cfg = json.loads(RAIL.read_text())
    stations = ctx.shared.get('rail_stations', {})
    z = zipfile.ZipFile(gtfs_path())
    agency = {r['agency_id']: r['agency_name'] for r in table(z, 'agency.txt')}
    routes = {r['route_id']: r for r in table(z, 'routes.txt')}
    trip_route = {r['trip_id']: r['route_id'] for r in table(z, 'trips.txt')}
    stops = {r['stop_id']: (r['stop_name'], float(r['stop_lat']), float(r['stop_lon']))
             for r in table(z, 'stops.txt') if r['stop_lat'] and r['stop_lon']}

    # stop → areas whose centre is within the radius (the borough takes every town of its own)
    stop_areas = defaultdict(set)
    towns = [a for a in ctx.areas if a.get('kind', 'area') == 'area']
    for sid, (_, la, ln) in stops.items():
        for a in towns:
            if miles(a['centre']['lat'], a['centre']['lng'], la, ln) <= RADIUS_MI:
                stop_areas[sid].add(a['id'])
                for b in ctx.areas:
                    if b.get('kind') == 'borough' and b['borough'] == a['borough']:
                        stop_areas[sid].add(b['id'])

    trips = defaultdict(lambda: defaultdict(set))          # area → route → trips calling there
    for r in table(z, 'stop_times.txt'):
        hit = stop_areas.get(r['stop_id'])
        if not hit:
            continue
        rid = trip_route.get(r['trip_id'])
        if not rid:
            continue
        for aid in hit:
            trips[aid][rid].add(r['trip_id'])
    all_trips = Counter(trip_route.values())

    out = {}
    for area in ctx.areas:
        counts = Counter(all_trips) if is_region(area) else Counter({rid: len(t) for rid, t in trips[area['id']].items()})
        trams, buses = {}, {}
        for rid, n in counts.most_common():
            r = routes.get(rid)
            if not r or 'Replacement' in (r['route_short_name'] or ''):
                continue
            start, end, via = ends(r['route_long_name'])
            if r['route_type'] == '0':
                line = r['route_short_name']
                t = trams.setdefault(line, {'line': line, 'from': start, 'to': end, 'trips': 0,
                                            'colour': LINE_COLOURS.get(line.split()[0])})
                t['trips'] += n
            else:
                num = r['route_short_name']
                b = buses.setdefault(num, {'number': num, 'from': start, 'to': end, 'via': via, 'operators': [], 'trips': 0,
                                           'school': bool(SCHOOL.search(r['route_long_name'] or ''))})
                b['trips'] += n
                op = agency.get(r['agency_id'])
                if op and op not in b['operators']:
                    b['operators'].append(op)
        kind = area.get('kind', 'area')
        bus_list = sorted(buses.values(), key=lambda b: (b['school'], -b['trips']))
        value = {
            'trams': sorted(trams.values(), key=lambda t: -t['trips']),
            'buses': bus_list[:MAX_BUSES.get(kind, 25)],
            'bus_total': len(buses),
            'rail': rail_for(area, stations, cfg),
            'tram_map': TRAM_MAP,
            'rail_reviewed': cfg.get('reviewed'),
        }
        has = value['trams'] or value['buses'] or value['rail']
        geo = ('Whole Greater Manchester network' if is_region(area) else
               f"Stops within 1 km of each {area['name']} town centre" if kind == 'borough' else
               f"Stops within 1 km of the centre of {area['name']}")
        out[area['id']] = {'routes': metric(
            value if has else None, period=f"Timetable downloaded {date.today().isoformat()}", geography=geo,
            source=SOURCES['gtfs'],
            note='Buses and trams from the TfGM timetable; trains from National Rail (lines checked by hand). '
                 'Ranked by timetabled journeys; school-day services are listed last.')}
        log(f"routes {area['id']}: {len(trams)} tram lines, {len(buses)} bus services, {len(value['rail'])} stations")
    return out
