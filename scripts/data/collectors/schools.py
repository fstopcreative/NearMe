"""
Ofsted management information — state-funded schools, latest inspections
(FINAL source for "School rating"; reports.ofsted.gov.uk publishes the same
judgements as this monthly CSV).

Each school gets one headline:
  · report card (inspections from November 2025) — the most common grade
    across the evaluation areas, e.g. "Expected standard";
  · older graded inspections — Outstanding / Good / Requires improvement /
    Inadequate ("No overall grade" for Sept 2024 – Nov 2025 inspections);
  · ungraded inspections — "School remains Good" etc.
The 0–10 score is Corelain's indicative average of those headlines (method
stored in the JSON). School locations come from postcodes.io.
"""
import re
from collections import Counter
from datetime import datetime
from statistics import mean

from lib.common import govuk_attachments, http, read_csv_text, lookup_postcodes, miles, metric, norm_pc, parse_date, SOURCES, log, GM_LADS, is_region

PAGE = '/government/statistical-data-sets/monthly-management-information-ofsteds-school-inspections-outcomes'
LAS = {'Warrington', 'Cheshire East'} | set(GM_LADS.values())
PHASES = {'Primary', 'Secondary', 'All-through'}
NEAREST, RADIUS_MI = 5, 3.0

OEIF = {'1': ('Outstanding', 10), '2': ('Good', 7.5), '3': ('Requires improvement', 5), '4': ('Inadequate', 2.5)}
REPORT = {'Exceptional': 10, 'Strong standard': 8.5, 'Expected standard': 7, 'Needs attention': 4.5, 'Urgent improvement': 2}
RC_AREAS = ['Inclusion', 'Curriculum and teaching', 'Achievement', 'Attendance and behaviour',
            'Personal development and wellbeing', 'Leadership and governance']
SUB_OEIF = ['Latest OEIF quality of education', 'Latest OEIF behaviour and attitudes',
            'Latest OEIF personal development', 'Latest OEIF effectiveness of leadership and management']
GROUP = {'Outstanding': 'outstanding', 'Good': 'good', 'Requires improvement': 'below', 'Inadequate': 'below'}
METHOD = ('Indicative 0–10 score: Outstanding 10, Good 7.5, Requires improvement 5, Inadequate 2.5; report cards: '
          'Exceptional 10, Strong 8.5, Expected 7, Needs attention 4.5, Urgent improvement 2 (mean of the evaluation areas); '
          'inspections with no overall grade use the mean of their key judgements.')


def latest_csv():
    best = None
    for a in govuk_attachments(PAGE):
        t = a['title']
        if 'latest inspections' not in t or not a['url'].endswith('.csv'):
            continue
        m = re.search(r'(\d{1,2}) (\w+) (\d{4})\s*$', t)
        if not m:
            continue
        try:
            d = datetime.strptime(f'{m.group(1)} {m.group(2)[:3]} {m.group(3)}', '%d %b %Y').date()
        except ValueError:
            continue
        if best is None or d > best[0]:
            best = (d, a['url'])
    return best


def headline(r):
    """(label, score, group, date) for one school row."""
    v = lambda k: (r.get(k) or '').strip()
    nul = lambda k: v(k) in ('', 'NULL')
    if not nul('Curriculum and teaching'):
        grades = [v(k) for k in RC_AREAS if v(k) in REPORT]
        label = Counter(grades).most_common(1)[0][0] if grades else 'Report card'
        return label, round(mean(REPORT[g] for g in grades), 1) if grades else None, 'report', v('Publication date')
    oe = v('Latest OEIF overall effectiveness')
    if oe in OEIF:
        label, score = OEIF[oe]
        ung = v('Ungraded inspection overall outcome')
        when = v('Publication date of latest OEIF graded inspection')
        if 'remains Outstanding' in ung:
            label, score = 'Outstanding', 10
        elif 'remains Good' in ung:
            label, score = 'Good', 7.5
        return label, score, GROUP[label], when
    if oe == 'Not judged':
        subs = [OEIF[v(k)][1] for k in SUB_OEIF if v(k) in OEIF]
        return 'No overall grade', round(mean(subs), 1) if subs else None, 'none', v('Publication date of latest OEIF graded inspection')
    ung = v('Ungraded inspection overall outcome')
    if 'Outstanding' in ung:
        return 'Outstanding', 10, 'outstanding', v('Ungraded inspection publication date')
    if 'Good' in ung:
        return 'Good', 7.5, 'good', v('Ungraded inspection publication date')
    return 'Not yet inspected', None, 'none', ''


def collect(ctx):
    found = latest_csv()
    if not found:
        raise RuntimeError('Ofsted CSV not found on GOV.UK')
    as_at, url = found
    rows = read_csv_text(http(url, timeout=300).decode('latin-1'))
    rows = [r for r in rows if r.get('Local authority') in LAS and r.get('Ofsted phase') in PHASES]
    geo = lookup_postcodes({r['Postcode'] for r in rows})
    schools = []
    for r in rows:
        g = geo.get(norm_pc(r['Postcode']))
        if not g:
            continue
        label, score, group, when = headline(r)
        when = parse_date(when) if when else None
        when = when.isoformat() if when else None
        schools.append({'urn': r['URN'], 'name': r['School name'], 'phase': r['Ofsted phase'], 'la': r['Local authority'],
                        'type': r.get('Type of education'), 'lat': g['lat'], 'lng': g['lng'], 'grade': label,
                        'score': score, 'group': group, 'date': when,
                        'url': (r.get('Web Link (opens in new window)') or '').replace('http://', 'https://')})
    src = dict(SOURCES['ofsted'], file=url)
    period = f"Latest inspections as at {as_at.strftime('%-d %B %Y')}"
    out = {}
    for area in ctx.areas:
        c = area['centre']
        if is_region(area):
            gm = set(GM_LADS.values())
            pool = [s for s in schools if s['la'] in gm]
            listed, geo_label = [], 'All state-funded primary and secondary schools in the ten Greater Manchester boroughs'
        elif area.get('kind') == 'borough':
            pool = [s for s in schools if s['la'] == area['borough']]
            listed, geo_label = [], f"All state-funded primary and secondary schools in {area['borough']}"
        else:
            for s in schools:
                s['_d'] = miles(c['lat'], c['lng'], s['lat'], s['lng'])
            near = sorted((s for s in schools if s['_d'] <= RADIUS_MI), key=lambda s: s['_d'])
            pool = listed = near[:NEAREST]
            geo_label = f"{NEAREST} nearest state primary and secondary schools to the centre of {area['name']}"
        scored = [s['score'] for s in pool if s['score'] is not None]
        mix = Counter(s['group'] for s in pool)
        value = {
            'score': round(mean(scored), 1) if scored else None,
            'schools': len(pool),
            'mix': {k: mix.get(k, 0) for k in ('outstanding', 'good', 'report', 'below', 'none')},
            'nearest': [{'name': s['name'], 'phase': s['phase'], 'distance_mi': round(s['_d'], 1), 'grade': s['grade'],
                         'date': s['date'], 'url': s['url']} for s in listed],
        }
        out[area['id']] = {'schools': metric(value if pool else None, period=period, geography=geo_label, source=src,
                                             method=METHOD, status='ok' if len(scored) >= 3 else 'low-confidence')}
    log(f'schools: {len(schools)} located, file {as_at}')
    return out
