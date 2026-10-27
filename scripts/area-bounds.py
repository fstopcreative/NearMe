"""
Corelain — real boundary extents for the Area Radar map.

Run from CRADAR/:  python3 scripts/area-bounds.py
Writes src/data/area-bounds.json: { "<area-id>": [west, south, east, north] }

The map embed used to open at a fixed zoom per area kind, so big areas were cut
off and small ones sat in a sea of nothing. The map component now derives the
zoom from these extents, so the whole area fits whatever size the card is.

Boundaries come from the ONS Open Geography Portal, matching the geographies
the statistics on the page are already built from (scripts/data/config/areas.json):
  match.wards      → Wards (Dec 2024), filtered to the area's local authority
  match.localities → Parishes / non-civil-parished areas (Dec 2024), by area name
  match.lad        → Local Authority Districts (Dec 2024)
  kind: region     → the ten Greater Manchester districts together
"""
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / 'scripts/data/config/areas.json'
OUT = ROOT / 'src/data/area-bounds.json'

BASE = 'https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services'
WARDS = f'{BASE}/Wards_December_2024_Boundaries_UK_BGC/FeatureServer/0/query'
PARISH = f'{BASE}/Parishes_and_Non_Civil_Parished_Areas_December_2024_Boundaries_EW_BGC/FeatureServer/0/query'
LADS = f'{BASE}/Local_Authority_Districts_December_2024_Boundaries_UK_BGC/FeatureServer/0/query'

GM_LADS = ['E08000001', 'E08000002', 'E08000003', 'E08000004', 'E08000005',
           'E08000006', 'E08000007', 'E08000008', 'E08000009', 'E08000010']

# Where the place a map draws is wider than the statistical area, the MAP extent
# is widened to match so the drawn boundary is not cropped. These affect the map
# camera only — the figures on the page keep using the areas.json match rules.
MAP_EXTRA_WARDS = {
    # Timperley South falls in the "Hale Barns & Timperley South" ward, so the
    # statistics count it towards hale-barns, but the suburb Google outlines as
    # "Timperley" includes it. Without it the extent is 3.2 x 2.7 km instead of
    # 4.1 x 6.1 km and the southern third of the suburb sits outside the frame.
    'timperley': ['Hale Barns & Timperley South'],
}


def quoted(values):
    return ', '.join("'" + v.replace("'", "''") + "'" for v in values)


def extent(url, where):
    q = urllib.parse.urlencode({'where': where, 'returnExtentOnly': 'true',
                                'outSR': '4326', 'f': 'json'})
    req = urllib.request.Request(url + '?' + q, headers={'User-Agent': 'CorelainAreaRadar/1.0'})
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.load(r)
    e = d.get('extent')
    if not e or e.get('xmin') is None:
        raise SystemExit(f'no extent for: {where}\n{json.dumps(d)[:300]}')
    return [round(e['xmin'], 5), round(e['ymin'], 5), round(e['xmax'], 5), round(e['ymax'], 5)]


def main():
    cfg = json.loads(CONFIG.read_text())
    out = {}
    for a in cfg['areas']:
        m = a.get('match', {})
        if m.get('region'):
            url, where, how = LADS, f'LAD24CD IN ({quoted(GM_LADS)})', 'ten GM districts'
        elif m.get('wards'):
            wards = m['wards'] + MAP_EXTRA_WARDS.get(a['id'], [])
            extra = f" +{len(wards) - len(m['wards'])} for map" if a['id'] in MAP_EXTRA_WARDS else ''
            url, where, how = WARDS, f"WD24NM IN ({quoted(wards)}) AND LAD24CD = '{a['lad']}'", \
                f"{len(m['wards'])} ward(s){extra}"
        elif m.get('localities'):
            url, where, how = PARISH, f"PARNCP24NM = '{a['name']}'", 'parish'
        elif m.get('lad'):
            url, where, how = LADS, f"LAD24CD = '{m['lad']}'", 'district'
        else:
            print(f'  {a["id"]:<20} SKIPPED (no usable match rule)')
            continue
        b = extent(url, where)
        out[a['id']] = b
        w_km = (b[2] - b[0]) * 111.32 * 0.596      # cos(53.4°)
        h_km = (b[3] - b[1]) * 111.32
        print(f'  {a["id"]:<20} {how:<16} {w_km:5.1f} x {h_km:5.1f} km')

    OUT.write_text(json.dumps(out, indent=1, sort_keys=True) + '\n')
    print(f'\n{len(out)} areas → {OUT.relative_to(ROOT)}')
    missing = [a['id'] for a in cfg['areas'] if a['id'] not in out]
    if missing:
        print('no bounds: ' + ', '.join(missing))


if __name__ == '__main__':
    main()
