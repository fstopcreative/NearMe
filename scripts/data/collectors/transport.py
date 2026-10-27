"""
DfT Transport Connectivity Metric (FINAL source for "Transport score").

Official 0–100 connectivity scores by LSOA (England & Wales). An area's score
is the mean of its LSOAs (from the sales postcodes matched by land_registry.py,
plus the LSOA at the area centre); the borough uses DfT's own local authority
row and Greater Manchester the mean of its ten borough rows. The ~70 MB .ods is published once a year, so it is only downloaded again
when GOV.UK lists a new file.
"""
from statistics import mean

from lib.common import govuk_attachments, download, nearest_postcode, metric, log, SOURCES, GM_LADS, is_region, is_wide
from lib import ods

PAGE = '/government/publications/transport-connectivity-metric'
COLS = {'overall': 'Overall', 'public_transport': 'Overall (public transport)', 'walking': 'Overall (walking)',
        'cycling': 'Overall (cycling)', 'driving': 'Overall (driving)'}


def latest_file():
    files = [a for a in govuk_attachments(PAGE) if a['url'].endswith('.ods')]
    if not files:
        raise RuntimeError('connectivity .ods not found on GOV.UK')
    return sorted(files, key=lambda a: a['url'])[-1]


def collect(ctx):
    f = latest_file()
    src = dict(SOURCES['tcm'], file=f['url'])
    prev = ctx.prev.get('trafford', {}).get('metrics', {}).get('transport_score')
    lsoas = ctx.shared.get('lsoas', {})
    for area in ctx.areas:                      # add the LSOA at each centre
        np = nearest_postcode(area['centre']['lat'], area['centre']['lng'])
        if np and np.get('lsoa') and not is_wide(area):
            lsoas.setdefault(area['id'], [])
            if np['lsoa'] not in lsoas[area['id']]:
                lsoas[area['id']].append(np['lsoa'])
    reuse = prev and prev.get('source', {}).get('file') == f['url'] and not ctx.force
    reuse = reuse and all(ctx.prev.get(a['id'], {}).get('metrics', {}).get('transport_score', {}).get('value') for a in ctx.areas)
    if reuse and all(ctx.prev.get(a['id'], {}).get('metrics', {}).get('transport_score', {}).get('lsoas') ==
                     sorted(lsoas.get(a['id'], [])) for a in ctx.areas if not is_wide(a)):
        log('transport: file and LSOAs unchanged — reusing previous figures')
        return {a['id']: {'transport_score': ctx.prev[a['id']]['metrics']['transport_score']} for a in ctx.areas}

    path = download(f['url'], 'tcm.ods')
    want = {code for codes in lsoas.values() for code in codes}
    boroughs = {a['borough'] for a in ctx.areas} | set(GM_LADS.values())
    lsoa_rows, lad_rows, head = {}, {}, {}
    for sheet, v in ods.rows(path, sheets=lambda s: s in ('LSOA', 'LAD')):
        if v[0] in ('LSOA21CD', 'LAD22NM'):
            head[sheet] = {h: i for i, h in enumerate(v)}
            continue
        if sheet not in head:
            continue
        h = head[sheet]
        pick = lambda: {k: round(float(v[h[c]]), 1) for k, c in COLS.items() if h.get(c) is not None and v[h[c]] not in (None, '')}
        if sheet == 'LSOA' and v[0] in want:
            lsoa_rows[v[0]] = pick()
        elif sheet == 'LAD' and v[0] in boroughs:
            lad_rows[v[0]] = pick()
    period = f"{f['title'] or 'Transport connectivity metric'}".replace('Connectivity metrics', 'Connectivity metric')
    out = {}
    for area in ctx.areas:
        if is_region(area):
            rows = [lad_rows[n] for n in GM_LADS.values() if n in lad_rows]
            val = {k: round(mean(r[k] for r in rows), 1) for k in COLS} if rows else None
            geo, used = f"Greater Manchester — mean of {len(rows)} borough figures (DfT)", None
        elif area.get('kind') == 'borough':
            val, geo, used = lad_rows.get(area['borough']), f"{area['borough']} (local authority, DfT figure)", None
        else:
            used = sorted(c for c in lsoas.get(area['id'], []) if c in lsoa_rows)
            val = {k: round(mean(lsoa_rows[c][k] for c in used), 1) for k in COLS} if used else None
            geo = f"{area['name']} — mean of {len(used)} LSOA{'s' if len(used) != 1 else ''}"
        out[area['id']] = {'transport_score': metric(val, unit='score out of 100', period=period, geography=geo, source=src,
                                                     lsoas=used, status='ok' if val and (used is None or len(used) >= 3) else 'low-confidence',
                                                     note='Access to jobs, education, healthcare, shops and leisure by walking, '
                                                          'cycling, public transport and driving.')}
    log(f'transport: {len(lsoa_rows)} LSOAs, LAD {list(lad_rows)}')
    return out
