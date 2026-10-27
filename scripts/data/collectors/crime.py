"""
Police recorded crime — Home Office Community Safety Partnership (CSP) open
data tables (FINAL source for "Crime rating").

Greater Manchester Police has not sent street-level data to police.uk since
2019, so the official figure is borough-wide (the CSP = the local authority).
The Greater Manchester view adds up its ten CSPs (= the GMP force area); the
boroughs are also compared with it. Rates use ONS mid-year population
estimates from Nomis. The latest four
quarters in the file are used, and the CSP file (~50 MB .ods) is only
downloaded again when GOV.UK publishes a new one.
"""
import re
from collections import defaultdict

from lib.common import govuk_attachments, download, http, read_csv_text, metric, log, SOURCES, GM_LADS, is_region
from lib import ods

PAGE = '/government/statistical-data-sets/police-recorded-crime-and-outcomes-open-data-tables'
NOMIS = ('https://www.nomisweb.co.uk/api/v01/dataset/NM_2002_1.data.csv?geography={codes}'
         '&date=latest&gender=0&c_age=200&measures=20100&select=date_name,geography_name,geography_code,obs_value')
EW = 'K04000001'
QUARTER_END = {1: 'June', 2: 'September', 3: 'December', 4: 'March'}

# Card rows: label → (offence groups, subgroup keyword)
ROWS = [
    ('violence', 'Violence & sexual offences', ('Violence against the person', 'Sexual offences'), None),
    ('burglary', 'Burglary', (), 'burglary'),
    ('vehicle', 'Vehicle offences', (), 'vehicle'),
    ('damage', 'Criminal damage & arson', ('Criminal damage and arson',), None),
]


def latest_csp_file():
    best = None
    for a in govuk_attachments(PAGE):
        t = a['title']
        if 'Community Safety Partnership' not in t or not a['url'].endswith('.ods'):
            continue
        years = [int(y) for y in re.findall(r'(20\d\d)', t)]
        if years and (best is None or max(years) > best[0]):
            best = (max(years), a['url'], t)
    if not best:
        raise RuntimeError('CSP table not found on GOV.UK')
    return best[1]


def population(codes):
    rows = read_csv_text(http(NOMIS.format(codes=','.join(codes))).decode('utf-8'))
    return {r['GEOGRAPHY_CODE']: int(r['OBS_VALUE']) for r in rows}, rows[0]['DATE_NAME']


def period_label(fy, q):
    start = int(fy[:4])
    year = start + 1 if q == 4 else start
    return f'12 months to {QUARTER_END[q]} {year}' if q != 4 else f'year ending March {year}'


def collect(ctx):
    url = latest_csp_file()
    lads = ctx.config['compare']['lads']                    # code → CSP name
    csps = set(lads.values())
    pop, pop_year = population(list(lads) + [EW])
    src = dict(SOURCES['crime'], file=url)

    # Reuse the previous result while the file and population year are unchanged
    prev = ctx.prev.get('trafford', {}).get('metrics', {}).get('crime_rate')
    have_all = all(ctx.prev.get(a['id'], {}).get('metrics', {}).get('crime_rate', {}).get('value') is not None for a in ctx.areas)
    if have_all and prev and prev.get('source', {}).get('file') == url and prev.get('population_year') == pop_year and not ctx.force:
        log('crime: CSP file unchanged — reusing previous figures')
        return {a['id']: {k: ctx.prev[a['id']]['metrics'][k] for k in ('crime_rate', 'crime_groups')
                          if k in ctx.prev.get(a['id'], {}).get('metrics', {})} for a in ctx.areas}

    path = download(url, 'crime-csp.ods')
    gm = set(GM_LADS.values())
    counts = defaultdict(lambda: defaultdict(int))          # (fy, q) → key → count
    head = None
    for sheet, v in ods.rows(path, sheets=lambda s: bool(re.match(r'\d{4}_\d{2}$', s or ''))):
        if v[0] == 'Financial Year':
            head = {h: i for i, h in enumerate(v)}
            continue
        if not head or len(v) < len(head):
            continue
        try:
            n = int(float(v[head['Offence Count']]))
            fyq = (v[head['Financial Year']], int(float(v[head['Financial Quarter']])))
        except (TypeError, ValueError):
            continue
        csp, grp, sub = v[head['CSP Name']], v[head['Offence Group']] or '', (v[head['Offence Subgroup']] or '').lower()
        bucket = counts[fyq]
        for scope in ('EW',) + ((csp,) if csp in csps else ()) + (('GM',) if csp in gm else ()):
            bucket[(scope, 'total')] += n
            for key, _, groups, kw in ROWS:
                if grp in groups or (kw and kw in sub):
                    bucket[(scope, key)] += n
    quarters = sorted(counts)[-4:]
    if len(quarters) < 4:
        raise RuntimeError('fewer than four quarters in the CSP table')
    period = period_label(*quarters[-1])
    tot = defaultdict(int)
    for fyq in quarters:
        for k, n in counts[fyq].items():
            tot[k] += n
    code_of = {name: code for code, name in lads.items()}

    pop['GM'] = sum(pop[c] for c in GM_LADS)

    def population_of(scope):
        return pop[EW] if scope == 'EW' else pop['GM'] if scope == 'GM' else pop[code_of[scope]]

    def rate(scope, key):
        return round(tot[(scope, key)] / population_of(scope) * 1000, 1)

    out = {}
    for area in ctx.areas:
        if is_region(area):
            csp, geo, cmp_csp = 'GM', 'Greater Manchester — all ten Community Safety Partnerships', []
        else:
            csp = area['csp']
            geo = f'{csp} Community Safety Partnership (borough-wide)'
            cmp_csp = [c for c in ctx.config['compare']['crime_csp'] if c != csp]
        cmp_gm = {'Greater Manchester': rate('GM', 'total')} if csp in gm else {}
        out[area['id']] = {
            'crime_rate': metric(rate(csp, 'total'), unit='crimes per 1,000 residents', period=period, geography=geo,
                                 source=src, count=tot[(csp, 'total')], population=population_of(csp),
                                 population_year=pop_year,
                                 comparison={'England and Wales': rate('EW', 'total'), **cmp_gm,
                                             **{c: rate(c, 'total') for c in cmp_csp}},
                                 note='Police recorded crime excluding fraud. Greater Manchester Police does not publish '
                                      'street-level data to police.uk, so this is a borough-wide figure.'),
            'crime_groups': metric([{'key': key, 'label': label, 'count': tot[(csp, key)], 'rate': rate(csp, key),
                                     'england_wales': rate('EW', key),
                                     **{c: rate(c, key) for c in cmp_csp}}
                                    for key, label, _, _ in ROWS],
                                   unit='crimes per 1,000 residents', period=period, geography=geo, source=src,
                                   population_year=pop_year),
        }
    log(f'crime: {period}, Trafford rate {out["trafford"]["crime_rate"]["value"]} per 1,000')
    return out
