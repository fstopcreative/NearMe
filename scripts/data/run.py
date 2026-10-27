#!/usr/bin/env python3
"""
Area Radar data refresh — builds public/data/areas/<area-id>.json.

    python3 scripts/data/run.py                 # all collectors
    python3 scripts/data/run.py --only crime     # one or more (comma-separated)
    python3 scripts/data/run.py --force          # ignore "file unchanged" shortcuts

Every metric is {value, period, geography, source, status, ...}. A collector
that fails keeps the previous values for its metrics (and logs the error), so
one broken source never blanks the site. Files are only rewritten when their
content changes, so the scheduled workflow commits real changes only.
"""
import argparse
import importlib
import json
import os
import sys
import traceback
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.common import DATA_DIR, OUT_DIR, SOURCES, log, metric  # noqa: E402

SCHEMA = 1
# (module, metric keys it writes) — run in this order (transport and census use the LSOAs found by
# land_registry; routes uses the rail stations found by naptan). ukhpi also writes the market keys
# for the Greater Manchester overview, which land_registry leaves out.
COLLECTORS = [
    ('land_registry', ['average_price', 'annual_growth', 'price_trend', 'price_by_type']),
    ('ukhpi', ['hpi_borough', 'hpi_uk', 'average_price', 'annual_growth', 'price_trend', 'price_by_type']),
    ('crime', ['crime_rate', 'crime_groups']),
    ('schools', ['schools']),
    ('transport', ['transport_score']),
    ('census', ['population', 'tenure']),
    ('earnings', ['earnings']),
    ('rents', ['average_rent']),
    ('air_quality', ['air_quality']),
    ('conservation', ['conservation_areas']),
    ('coal', ['coal_mining']),
    ('bgs_open', ['radon', 'ground']),
    ('planning_data', ['planning_constraints', 'development_sites', 'flood_zones', 'aqma']),
    ('osm', ['places']),
    ('naptan', ['nearest_stops']),
    ('routes', ['routes']),
    ('rss_news', ['news']),
]
# collector → collectors that need it to run first (they share data through ctx.shared)
NEEDED_BY = {'land_registry': {'transport', 'census'}, 'naptan': {'routes'}}
# The inverse: which collectors a given one needs in ctx.shared before it can run.
DEPENDS_ON = {}
for _provider, _dependents in NEEDED_BY.items():
    for _d in _dependents:
        DEPENDS_ON.setdefault(_d, set()).add(_provider)
# Hand-entered keys (scripts/data/manual/<id>.json). A manual block with the same key as a
# collector (places) replaces the collected value for that area; the collected
# value is kept under `replaces`, so removing the manual block restores it.
MANUAL_KEYS = ['flood_risk', 'aqma_roadside', 'journey', 'developments', 'places']


class Ctx:
    def __init__(self, config, prev, force):
        self.config = config
        self.areas = config['areas']
        self.prev = prev
        self.force = force
        self.shared = {}


def load_prev():
    prev = {}
    for f in OUT_DIR.glob('*.json'):
        if f.name != 'index.json':
            try:
                prev[f.stem] = json.loads(f.read_text())
            except ValueError:
                pass
    return prev


def manual_metrics(area_id):
    f = DATA_DIR / 'manual' / f'{area_id}.json'
    if not f.exists():
        return {}
    d = json.loads(f.read_text())
    out = {}
    for key, block in d.get('metrics', {}).items():
        if key not in MANUAL_KEYS:
            continue
        out[key] = metric(block.get('value'), period=block.get('period'), geography=block.get('geography'),
                          source=block.get('source', 'editorial'), status='manual', reviewed=d.get('reviewed'))
    return out


def automatic(rec):
    """A previous record without its hand-entered layer: a manual record yields the collected value it replaced."""
    if rec and rec.get('status') == 'manual':
        return rec.get('replaces')
    return rec


def strip_volatile(doc):
    return {k: v for k, v in doc.items() if k != 'updated'}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='')
    ap.add_argument('--force', action='store_true')
    args = ap.parse_args()
    only = {s.strip() for s in args.only.split(',') if s.strip()}

    config = json.loads((DATA_DIR / 'config' / 'areas.json').read_text())
    prev = load_prev()
    ctx = Ctx(config, prev, args.force)
    results = {a['id']: {} for a in ctx.areas}
    failures, skipped = [], []

    for name, keys in COLLECTORS:
        # a skipped collector keeps its previous values, unless another collector has already
        # written that key this run (ukhpi and land_registry share the market keys)
        if only and name not in only and not (NEEDED_BY.get(name, set()) & only):
            for a in ctx.areas:
                for k in keys:
                    old = automatic(prev.get(a['id'], {}).get('metrics', {}).get(k))
                    if old:
                        results[a['id']].setdefault(k, old)
            continue
        # A dependency that failed leaves ctx.shared empty, and the collectors that
        # read it do not notice: census and transport silently fall back to the one
        # LSOA at the area centre and publish figures that are an order of magnitude
        # too small (Old Trafford 17,365 -> 2,051 residents on 2026-10-16). Keep the
        # previous values instead — stale beats wrong.
        broken = DEPENDS_ON.get(name, set()) & set(failures)
        if broken:
            log(f'{name} SKIPPED: needs {", ".join(sorted(broken))}, which failed')
            skipped.append(name)
            for a in ctx.areas:
                for k in keys:
                    old = automatic(prev.get(a['id'], {}).get('metrics', {}).get(k))
                    if old:
                        results[a['id']].setdefault(k, old)
            continue
        log(f'── {name}')
        try:
            mod = importlib.import_module(f'collectors.{name}')
            got = mod.collect(ctx)
            for aid, recs in got.items():
                results[aid].update(recs)
        except Exception as e:                                      # keep the previous values
            failures.append(name)
            log(f'{name} FAILED: {e}')
            traceback.print_exc()
            for a in ctx.areas:
                for k in keys:
                    old = automatic(prev.get(a['id'], {}).get('metrics', {}).get(k))
                    results[a['id']].setdefault(k, old or metric(None, status='error', note=f'{name} failed: {str(e)[:160]}'))

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    changed, index = [], []
    for a in ctx.areas:
        metrics = dict(results[a['id']])
        for k, rec in manual_metrics(a['id']).items():
            # keep the collected value under the hand-entered one, so removing the manual entry
            # brings the automatic value straight back (even on a run that skips that collector)
            if k in metrics and metrics[k].get('status') != 'manual':
                rec['replaces'] = metrics[k]
            metrics[k] = rec
        doc = {
            'schema': SCHEMA, 'id': a['id'], 'name': a['name'], 'kind': a.get('kind', 'area'),
            'borough': a['borough'], 'county': a['county'], 'postcode': a['postcode'], 'centre': a['centre'],
            'metrics': {k: metrics[k] for k in sorted(metrics)},
        }
        old = prev.get(a['id'])
        if old and strip_volatile(old) == doc:
            doc['updated'] = old.get('updated')
        else:
            doc['updated'] = date.today().isoformat()
            (OUT_DIR / f"{a['id']}.json").write_text(json.dumps(doc, ensure_ascii=False, indent=1) + '\n')
            changed.append(a['id'])
        index.append({'id': a['id'], 'name': a['name'], 'kind': doc['kind'], 'postcode': a['postcode'],
                      'updated': doc['updated']})
    idx = {'schema': SCHEMA, 'areas': index, 'sources': SOURCES}
    idx_file = OUT_DIR / 'index.json'
    if not idx_file.exists() or json.loads(idx_file.read_text()) != idx:
        idx_file.write_text(json.dumps(idx, ensure_ascii=False, indent=1) + '\n')
        changed.append('index')
    log(f'changed: {", ".join(changed) or "nothing"}')
    if failures or skipped:
        if failures:
            log(f'collectors with errors (previous values kept): {", ".join(failures)}')
        if skipped:
            log(f'collectors skipped because a dependency failed: {", ".join(skipped)}')
        # Surface it in the Actions run summary; the step still succeeds so the
        # collectors that DID work are committed.
        summary = os.environ.get('GITHUB_STEP_SUMMARY')
        if summary:
            with open(summary, 'a') as fh:
                fh.write('### Area data refresh\n')
                if failures:
                    fh.write(f'- **Failed** (previous values kept): {", ".join(failures)}\n')
                if skipped:
                    fh.write(f'- **Skipped** (dependency failed): {", ".join(skipped)}\n')
        sys.exit(2 if len(failures) == len(COLLECTORS) else 0)


if __name__ == '__main__':
    main()
