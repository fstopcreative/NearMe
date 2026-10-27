"""
Corelain — per-area cover photos for the Area Radar hero.

Run from CRADAR/:  python3 scripts/hero-covers.py
Masters (2–90 MB each) live outside public/ so they are never deployed:
    assets/hero-masters/desktop/<area-id>.png   wide shot
    assets/hero-masters/mobile/<area-id>.png    upright/square shot
With SHARED set (the default), one master per slot stands behind every area:
each is built into the site-wide hero ladder and the manifest is emptied, so
crCover() finds nothing and every area falls back to that art:
    public/images/hero-{1280,1920}.jpg                  16:7, >640px viewports
    public/images/hero-m{640,960,1200}.jpg               4:3, phones
Set SHARED = None for per-area covers instead, which writes
src/data/hero-covers.json plus, for every area that has a master:
    public/images/hero/<area-id>-{800,1200,1440}.jpg    16:7, >640px viewports
    public/images/hero/<area-id>-m{640,960,1200}.jpg     4:3, phones

The hero is a full-bleed `object-fit: cover` box (".cr-hero__img"), so each
master is centre-cropped to the slot's ratio and the browser crops the rest.
The wide ladder stops at 1440px because the hero never renders wider than that
(sizes="…1440px"); on a 2x screen the photo upscales, which the dark overlay
hides. A "<area>-alt" master is an unused second take and is skipped.
Area ids must match src/js/data/areas.js.
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MASTERS = ROOT / 'assets/hero-masters'
OUT = ROOT / 'public/images/hero'
MANIFEST = ROOT / 'src/data/hero-covers.json'
QUALITY = '68'
SLOTS = {                       # folder → (ratio, filename suffix, widths)
    'desktop': (16 / 7, '{w}', [800, 1200, 1440]),
    'mobile': (4 / 3, 'm{w}', [640, 960, 1200]),
}
# One image behind every area's hero, per slot: a graphic of the skyline rather
# than a photographed place, so the same art serves all 19 areas. Each name is
# looked up in that slot's own folder first, then desktop/, so a single wide
# master can cover both. None → per-area covers from the masters instead.
SHARED = {'desktop': 'banner9', 'mobile': 'banner-134'}
# Areas that get their own cover instead of that default. Each id needs a master
# in BOTH desktop/ and mobile/, and lands in the manifest, which is what makes
# crCover() serve it. [] = every area falls back to SHARED; None = every master
# found in the folders. Removing an id (or its masters) returns it to SHARED.
COVERS = []
# The site-wide ladder the head partial preloads: slot → (ratio, name, widths).
SITE_SLOTS = {
    'desktop': (16 / 7, 'hero-{w}', [1280, 1920]),
    'mobile': (4 / 3, 'hero-m{w}', [640, 960, 1200]),
}


def sips(*args):
    subprocess.run(['sips', *args], check=True, capture_output=True)


def size(p):
    out = subprocess.run(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', str(p)],
                         check=True, capture_output=True, text=True).stdout
    d = dict(l.strip().split(': ') for l in out.splitlines() if ': ' in l)
    return int(d['pixelWidth']), int(d['pixelHeight'])


def ladder(master, ratio, out_dir, pattern, widths, tmp):
    """Centre-crop `master` to `ratio`, then write one JPEG per width."""
    w, h = size(master)
    cw, ch = (w, round(w / ratio)) if round(w / ratio) <= h else (round(h * ratio), h)
    sips('-s', 'format', 'jpeg', '-s', 'formatOptions', QUALITY,
         '-c', str(ch), str(cw), str(master), '--out', str(tmp))
    built, total = [], 0.0
    for width in widths:
        dest = out_dir / f'{pattern.format(w=width)}.jpg'
        sips('-s', 'format', 'jpeg', '-s', 'formatOptions', QUALITY,
             '--resampleWidth', str(width), str(tmp), '--out', str(dest))
        kb = dest.stat().st_size / 1024
        total += kb
        built.append(f'{kb:.0f}K')
    return f'{w}x{h} → {cw}x{ch} · ' + ' / '.join(built), total


def find_master(slot, name):
    """The named master in `slot`'s folder, else in desktop/."""
    for folder in (slot, 'desktop'):
        for ext in ('.png', '.jpg', '.jpeg'):
            p = MASTERS / folder / f'{name}{ext}'
            if p.exists():
                return p
    sys.exit(f'missing {(MASTERS / slot / name).relative_to(ROOT)}.png')


def shared(tmp):
    """One master per slot for every area: build the site-wide ladder, empty the manifest."""
    total, used = 0.0, []
    for slot, (ratio, pattern, widths) in SITE_SLOTS.items():
        master = find_master(slot, SHARED[slot])
        used.append(f'{slot} {master.parent.name}/{master.name}')
        line, kb = ladder(master, ratio, OUT.parent, pattern, widths, tmp)
        total += kb
        print(f'  {slot:<10} ({ratio:.2f}:1)  {line}')
    print('\ndefault hero: ' + ' · '.join(used) + f' · {total / 1024:.1f} MB')


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for f in OUT.glob('*.jpg'):
        f.unlink()
    tmp = OUT / '.tmp.jpg'
    if SHARED:
        print('── default hero (every area without its own cover) ' + '─' * 15)
        shared(tmp)
    areas, total, skipped, unlisted = set(), 0.0, [], set()

    for folder, (ratio, pattern, widths) in SLOTS.items():
        src = MASTERS / folder
        if not src.is_dir():
            sys.exit(f'missing {src.relative_to(ROOT)}')
        print(f'── {folder} ({ratio:.2f}:1) ' + '─' * 44)
        for m in sorted(p for p in src.iterdir() if p.suffix.lower() in ('.png', '.jpg', '.jpeg')):
            area = m.stem
            if area.endswith('-alt') or (SHARED and area in SHARED.values()):
                skipped.append(f'{folder}/{m.name}')
                continue
            if COVERS is not None and area not in COVERS:
                unlisted.add(area)
                continue
            areas.add(area)
            line, kb = ladder(m, ratio, OUT, area + '-' + pattern, widths, tmp)
            total += kb
            print(f'  {area:<20} {line}')
    tmp.unlink(missing_ok=True)

    # Single source of truth for "which areas have a cover", read by
    # vite.config.js (head preload) and src/js/data/areas.js (runtime swap).
    MANIFEST.write_text(json.dumps(sorted(areas), indent=2) + '\n')
    print(f'\n{len(areas)} areas · {len(list(OUT.glob("*.jpg")))} files · {total / 1024:.1f} MB'
          f'\nmanifest → {MANIFEST.relative_to(ROOT)}')
    if skipped:
        print('skipped (spare takes): ' + ', '.join(skipped))
    if unlisted:
        print(f'{len(unlisted)} masters are not in COVERS, so those areas use the default: '
              + ', '.join(sorted(unlisted)))
    # A cover is only used when BOTH ladders exist, so flag any half-pair.
    for folder in SLOTS:
        have = {p.stem for p in (MASTERS / folder).iterdir() if p.suffix.lower() in ('.png', '.jpg', '.jpeg')}
        missing = sorted(areas - have - {a + '-alt' for a in areas})
        if missing:
            print(f'NO {folder} master: ' + ', '.join(missing))


if __name__ == '__main__':
    main()
