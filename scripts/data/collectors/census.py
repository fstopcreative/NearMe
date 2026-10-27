"""
ONS Census 2021 via Nomis (OGL) — the figures behind Trafford Data Lab's
"Population & Households" profile and ONS "How life has changed: Census 2021".

  population  usual residents, households, average household size and broad
              age groups (TS001, TS007A, TS054 total)
  tenure      households by tenure — owned, shared ownership, social rented,
              private rented (TS054): "rent compared with ownership"

Areas add up their 2021 LSOAs (the LSOAs of the area's sales postcodes found by
land_registry.py plus the LSOA at the centre, as transport.py does); the
borough uses its local authority and Greater Manchester its ten boroughs.
Each record carries the borough / England shares for comparison.
"""
import urllib.parse

from lib.common import http, read_csv_text, nearest_postcode, metric, log, GM_LADS, is_region, is_wide

NOMIS = 'https://www.nomisweb.co.uk/api/v01/dataset/{ds}.data.csv?'
ENGLAND = 'E92000001'
PERIOD = 'Census 2021 (21 March 2021)'
AGE_GROUPS = [('0_14', 'Under 15', range(1, 4)), ('15_24', '15–24', range(4, 6)), ('25_44', '25–44', range(6, 10)),
              ('45_64', '45–64', range(10, 14)), ('65', '65 and over', range(14, 19))]
TENURE = {'0': 'households', '1001': 'owned', '1002': 'shared', '1003': 'social', '1004': 'private', '8': 'rent_free'}


def fetch(ds, dim, cats, codes):
    """{geography code: {category: count}} for one Census table (chunked so URLs stay short)."""
    out = {}
    codes = sorted(set(codes))
    for i in range(0, len(codes), 80):
        q = {'date': 'latest', 'geography': ','.join(codes[i:i + 80]), 'measures': 20100, dim: ','.join(cats),
             'select': f'geography_code,{dim},obs_value'}
        for r in read_csv_text(http(NOMIS.format(ds=ds) + urllib.parse.urlencode(q, safe=','), timeout=180).decode('utf-8-sig')):
            out.setdefault(r['GEOGRAPHY_CODE'], {})[r[dim.upper()]] = int(float(r['OBS_VALUE']))
    return out


def tables(codes):
    res = fetch('NM_2021_1', 'c2021_restype_3', ['0'], codes)
    age = fetch('NM_2020_1', 'c2021_age_19', [str(n) for n in range(1, 19)], codes)
    ten = fetch('NM_2072_1', 'c2021_tenure_9', list(TENURE), codes)
    return res, age, ten


def add(rows, codes):
    tot = {}
    for c in codes:
        for k, v in rows.get(c, {}).items():
            tot[k] = tot.get(k, 0) + v
    return tot


def pct(n, d):
    return round(n / d * 100, 1) if d else None


def summarise(res, age, ten):
    if not res.get('0') or not ten.get('0'):
        return None, None
    residents, households = res['0'], ten['0']
    groups = [{'key': key, 'label': label, 'n': sum(age.get(str(b), 0) for b in bands),
               'pct': pct(sum(age.get(str(b), 0) for b in bands), residents)} for key, label, bands in AGE_GROUPS]
    population = {'residents': residents, 'households': households,
                  'household_size': round(residents / households, 2), 'age': groups}
    t = {v: ten.get(k, 0) for k, v in TENURE.items()}
    own, rent = t['owned'] + t['shared'], t['social'] + t['private']
    tenure = {**t, 'own_pct': pct(own, households), 'rent_pct': pct(rent, households),
              'owned_pct': pct(t['owned'], households), 'shared_pct': pct(t['shared'], households),
              'social_pct': pct(t['social'], households), 'private_pct': pct(t['private'], households),
              'rent_free_pct': pct(t['rent_free'], households),
              'renters_per_100_owners': round(rent / own * 100) if own else None}
    return population, tenure


def collect(ctx):
    lsoas = ctx.shared.get('lsoas', {})
    want = {a['id']: [] for a in ctx.areas}
    for area in ctx.areas:
        if is_region(area):
            want[area['id']] = list(GM_LADS)
        elif area.get('kind') == 'borough':
            want[area['id']] = [area['lad']]
        else:
            codes = list(lsoas.get(area['id'], []))
            np = nearest_postcode(area['centre']['lat'], area['centre']['lng'])
            if np and np.get('lsoa') and np['lsoa'] not in codes:
                codes.append(np['lsoa'])
            want[area['id']] = codes
    lads = {a['lad'] for a in ctx.areas if not is_region(a)}
    res, age, ten = tables({c for codes in want.values() for c in codes} | lads | {ENGLAND})
    shares = lambda code: summarise(res.get(code, {}), age.get(code, {}), ten.get(code, {}))
    england = shares(ENGLAND)

    out = {}
    for area in ctx.areas:
        codes = want[area['id']]
        found = [c for c in codes if c in res]
        population, tenure = summarise(add(res, found), add(age, found), add(ten, found))
        if is_region(area):
            geo, cmp_name, cmp = 'Greater Manchester — the ten boroughs', None, (None, None)
        elif area.get('kind') == 'borough':
            geo, cmp_name, cmp = f"{area['borough']} (local authority)", None, (None, None)
        else:
            geo = f"{area['name']} — {len(found)} census LSOA{'s' if len(found) != 1 else ''} (2021)"
            cmp_name, cmp = area['borough'], shares(area['lad'])
        status = 'ok' if is_wide(area) or len(found) >= 3 else 'low-confidence'
        compare_age = {k: {g['key']: g['pct'] for g in v['age']} for k, v in (('England', england[0]), (cmp_name, cmp[0])) if k and v}
        compare_ten = {k: {x: v[x] for x in ('own_pct', 'rent_pct', 'social_pct', 'private_pct')}
                       for k, v in (('England', england[1]), (cmp_name, cmp[1])) if k and v}
        out[area['id']] = {
            'population': metric(population, period=PERIOD, geography=geo, source='census', status=status,
                                 lsoas=None if is_wide(area) else found, comparison=compare_age,
                                 note='Usual residents and households on Census day; age groups from TS007A.'),
            'tenure': metric(tenure, period=PERIOD, geography=geo, source='tenure', status=status, comparison=compare_ten,
                             note='Households by tenure (TS054). "Own" includes shared ownership; "rent" is social plus private rented.'),
        }
    log(f"census: Trafford {out.get('trafford', {}).get('population', {}).get('value', {}) and out['trafford']['population']['value']['residents']} residents")
    return out
