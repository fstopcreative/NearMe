/*
 * Corelain — Area Radar hero actions (search, Compare) and the map component.
 * Compare reads the real figures of both areas from /data/areas/<id>.json;
 * a metric without data shows "—" and never wins.
 */
import { AREAS, currentArea, areaHref } from '../data/areas.js';
import { loadArea } from '../radar/load.js';
import { val, rec, gbp, num, signed, scorecard } from '../radar/format.js';
import BOUNDS from '../../data/area-bounds.json';

// ── Fitting the map to the area ──────────────────────────────────────────────
// Areas differ by a factor of ~35 across the pilot (Old Trafford is 1.6 x 1.6 km,
// Greater Manchester 55 x 40 km), so a zoom picked per area KIND either cropped
// the big ones or stranded the small ones. These work back from the real ONS
// extent (src/data/area-bounds.json) to the largest zoom that still fits the
// card, using Google's Web Mercator tile scale: the world is 256px at zoom 0
// and doubles each step.
const WORLD_PX = 256;
const PAD = 0.88;              // keep the boundary off the edges of the frame
const latRad = (deg) => {
  const s = Math.sin((deg * Math.PI) / 180);
  return Math.log((1 + s) / (1 - s)) / 2;
};
function fitZoom(bbox, boxW, boxH) {
  if (!bbox || !boxW || !boxH) return null;
  const [w, s, e, n] = bbox;
  const latFraction = (latRad(n) - latRad(s)) / (2 * Math.PI);
  const lngFraction = ((e - w < 0 ? e - w + 360 : e - w)) / 360;
  if (latFraction <= 0 || lngFraction <= 0) return null;
  const z = Math.min(
    Math.log2((boxH * PAD) / WORLD_PX / latFraction),
    Math.log2((boxW * PAD) / WORLD_PX / lngFraction),
  );
  return Math.max(3, Math.min(17, Math.floor(z)));
}

// ── Hero actions (x-data="crHeroActions()") ──
// Loaded BEFORE {{> scripts}}: vireo.js starts Alpine as soon as it executes,
// so this factory must already be on window when Alpine walks the DOM.

// Each row: how to read the metric from an area JSON, how to show it, which way is better.
const METRICS = [
  { label: 'Average property value', get: (d) => val(d, 'average_price'), fmt: gbp, better: 'high' },
  { label: 'Annual growth', get: (d) => val(d, 'annual_growth'), fmt: (v) => signed(v), better: 'high' },
  { label: 'Average rent (borough, pcm)', get: (d) => (val(d, 'average_rent') || {}).monthly ?? null, fmt: gbp, better: 'low' },
  { label: 'Households renting', get: (d) => (val(d, 'tenure') || {}).rent_pct ?? null, fmt: (v) => num(v, 1) + '%', better: null },
  { label: 'Median pay (borough, full-time)', get: (d) => (val(d, 'earnings') || {}).annual ?? null, fmt: gbp, better: 'high' },
  { label: 'Population (Census 2021)', get: (d) => (val(d, 'population') || {}).residents ?? null, fmt: (v) => num(v), better: null },
  { label: 'Crimes per 1,000 (borough)', get: (d) => val(d, 'crime_rate'), fmt: (v) => num(v, 1), better: 'low' },
  { label: 'School score', get: (d) => (val(d, 'schools') || {}).score ?? null, fmt: (v) => num(v, 1) + ' / 10', better: 'high' },
  { label: 'Transport score', get: (d) => (val(d, 'transport_score') || {}).overall ?? null, fmt: (v) => num(v) + ' / 100', better: 'high' },
  { label: 'Background NO₂ (µg/m³)', get: (d) => (val(d, 'air_quality') || {}).no2 ?? null, fmt: (v) => num(v, 1), better: 'low' },
  { label: 'Area scorecard', get: (d) => (d ? scorecard(d).overall : null), fmt: (v) => v + ' / 100', better: 'high' },
];

window.crHeroActions = () => {
  const area = currentArea();
  return {
    areas: AREAS,
    areaId: area.id,
    query: area.kind === 'borough' || area.kind === 'region' ? '' : area.postcode,
    compareOpen: false,
    compareId: (AREAS.find((a) => a.id !== area.id) || {}).id,
    dataA: null,
    dataB: null,
    loadingA: false,
    loadingB: false,
    init() {
      this.loadThis();
      this.$watch('compareOpen', (open) => open && this.loadCompare());
      this.$watch('compareId', () => this.compareOpen && this.loadCompare());
      // both sides are pickable, so moving "this area" onto the compared one
      // has to push that side somewhere else before either list reloads
      this.$watch('areaId', (id) => {
        if (this.compareId === id) this.compareId = (AREAS.find((a) => a.id !== id) || {}).id;
        this.loadThis();
      });
    },
    loadThis() {
      const id = this.areaId;
      this.loadingA = true;
      loadArea(id).then((d) => {
        if (id === this.areaId) { this.dataA = d; this.loadingA = false; }
      });
    },
    loadCompare() {
      const id = this.compareId;
      this.loadingB = true;
      loadArea(id).then((d) => {
        if (id === this.compareId) { this.dataB = d; this.loadingB = false; }
      });
    },
    toast(title, msg = '', tone = 'success') {
      window.Alpine && window.Alpine.store('toasts').push({ title, msg, tone, ttl: 3000 });
    },
    search() {
      const q = this.query.trim().toLowerCase().replace(/\s+/g, ' ');
      if (!q) return;
      const hit =
        AREAS.find((a) => a.name.toLowerCase() === q) ||
        AREAS.find((a) => a.postcode.toLowerCase().split('-').some((p) => q.startsWith(p.toLowerCase()))) ||
        AREAS.find((a) => a.name.toLowerCase().startsWith(q));
      if (hit) location.href = areaHref(hit);
      else this.toast('No area found', `Nothing matches “${this.query.trim()}”.`, 'warning');
    },
    get areaName() { return (AREAS.find((a) => a.id === this.areaId) || area).name; },
    get compareArea() { return AREAS.find((a) => a.id === this.compareId) || null; },
    get compareHref() { return this.compareArea ? areaHref(this.compareArea) : '#'; },
    get compareRows() {
      if (!this.compareArea) return [];
      const a2 = this.loadingA ? null : this.dataA;
      const b = this.loadingB ? null : this.dataB;
      return METRICS.map((m) => {
        const av = a2 ? m.get(a2) : null;
        const bv = b ? m.get(b) : null;
        const win = !m.better || av == null || bv == null || av === bv ? null : (m.better === 'high') === (av > bv) ? 'a' : 'b';
        const fmt = (v) => (v == null ? '—' : m.fmt(v));
        return { label: m.label, a: fmt(av), b: fmt(bv), win };
      });
    },
    get compareNote() {
      const b = this.dataB;
      const geo = (d) => (rec(d, 'average_price') || {}).period;
      return b && geo(b) ? `Prices: ${geo(b)}. Crime is borough-wide; see each card for sources.` : 'Figures load from the area data files.';
    },
  };
};

// ── Map + nearby places (x-data="crMap()") — places come from the area JSON ──
window.crMap = () => ({
  q: '',
  activeId: null,
  mapType: 'map',
  places: [],
  centre: null,
  areaQuery: '',
  bbox: null,
  boxW: 0,
  boxH: 0,
  zoom: 14,
  init() {
    // Measure the map frame so the fit follows the card, which is two-thirds of
    // the grid on a desktop and full width once the columns collapse.
    const box = this.$refs.mapbox;
    if (box && window.ResizeObserver) {
      const ro = new ResizeObserver(([entry]) => {
        const r = entry.contentRect;
        this.boxW = Math.round(r.width);
        this.boxH = Math.round(r.height);
      });
      ro.observe(box);
    } else if (box) {
      const r = box.getBoundingClientRect();
      this.boxW = Math.round(r.width);
      this.boxH = Math.round(r.height);
    }
    const take = (d) => {
      if (!d) return;
      this.centre = d.centre;
      this.bbox = BOUNDS[d.id] || null;
      // Searching the place BY NAME makes Google outline the area's boundary;
      // a lat,lng query only drops a pin on the centre. The postcode district
      // disambiguates localities that share a name with a landmark
      // ("Old Trafford" is also the stadium and the cricket ground).
      this.areaQuery =
        d.kind === 'region' ? `${d.name}, England`
          : d.kind === 'borough' ? `${d.name}, Greater Manchester, England`
            : `${d.name}, ${d.postcode}, England`;
      this.zoom = d.kind === 'region' ? 10 : d.kind === 'borough' ? 12 : 14;
      this.places = (val(d, 'places') || []).map((p, i) => ({ ...p, id: 'p' + i }));
      this.activeId = null;
    };
    take(window.__crData);
    window.addEventListener('cr:data', (e) => take(e.detail));
  },
  get filtered() { const t = this.q.trim().toLowerCase(); return t ? this.places.filter((p) => (p.name + ' ' + p.addr + ' ' + p.type).toLowerCase().includes(t)) : this.places; },
  get active() { return this.places.find((p) => p.id === this.activeId) || null; },
  // Falls back to the per-kind zoom when the area has no stored extent or the
  // frame has not been measured yet.
  get fittedZoom() { return fitZoom(this.bbox, this.boxW, this.boxH) ?? this.zoom; },
  get embedSrc() {
    const t = this.mapType === 'satellite' ? '&t=k' : this.mapType === 'terrain' ? '&t=p' : '';
    const url = (q, z) => `https://www.google.com/maps?q=${q}&z=${z}&hl=en&output=embed${t}`;
    // A landmark picked from the rail is a point, so pin its exact coordinates.
    if (this.active) return url(this.active.ll, 15);
    // The area itself is a place, not a point — ask for it by name, at the
    // largest zoom that still fits its real extent in the frame.
    if (this.areaQuery) return url(encodeURIComponent(this.areaQuery), this.fittedZoom);
    if (this.centre) return url(`${this.centre.lat},${this.centre.lng}`, this.zoom);
    return '';
  },
});

// ── Nearby-location icons by place type (Tabler outline paths) ──
// Read by the Nearby Locations list via x-html="crPlaceIcons[p.type]".
const PIN = '<path d="M9 11a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"/><path d="M17.657 16.657l-4.243 4.243a2 2 0 0 1 -2.827 0l-4.244 -4.243a8 8 0 1 1 11.314 0"/>';
window.crPlaceIcons = new Proxy({
  'Stadium': '<path d="M4 7a8 2 0 1 0 16 0a8 2 0 1 0 -16 0"/><path d="M4 7v7c0 1.105 3.582 2 8 2s8 -.895 8 -2v-7"/><path d="M15 16v4c0 .552 -1.343 1 -3 1s-3 -.448 -3 -1v-4"/>',
  'Tram stop': '<path d="M6 4h12"/><path d="M12 4v3"/><path d="M5 9a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v7a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2z"/><path d="M5 13h14"/><path d="M8 18l-2 3"/><path d="M16 18l2 3"/><path d="M9 15.5h.01"/><path d="M15 15.5h.01"/>',
  'Cricket ground': '<path d="M11.105 18.79l-1 .992a4.159 4.159 0 0 1 -6.038 -5.715l.157 -.166l8.282 -8.401l1.5 1.5l3.45 -3.391a2.08 2.08 0 0 1 3.057 2.815l-.116 .126l-3.391 3.45l1.5 1.5l-3.668 3.617"/><path d="M10.5 7.5l6 6"/><path d="M11 18a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"/>',
  'Museum': '<path d="M3 21l18 0"/><path d="M3 10l18 0"/><path d="M5 6l7 -3l7 3"/><path d="M4 10l0 11"/><path d="M20 10l0 11"/><path d="M8 14l0 3"/><path d="M12 14l0 3"/><path d="M16 14l0 3"/>',
  'Park': '<path d="M16 5l3 3l-2 1l4 4l-3 1l4 4h-9"/><path d="M15 21l0 -3"/><path d="M8 13l-2 -2"/><path d="M8 12l2 -2"/><path d="M8 21v-13"/><path d="M5.824 16a3 3 0 0 1 -2.743 -3.69a3 3 0 0 1 .304 -4.833a3 3 0 0 1 4.615 -3.707a3 3 0 0 1 4.614 3.707a3 3 0 0 1 .305 4.833a3 3 0 0 1 -2.919 3.695h-4z"/>',
  'Shopping centre': '<path d="M6.331 8h11.339a2 2 0 0 1 1.977 2.304l-1.255 8.152a3 3 0 0 1 -2.966 2.544h-6.852a3 3 0 0 1 -2.965 -2.544l-1.255 -8.152a2 2 0 0 1 1.977 -2.304"/><path d="M9 11v-5a3 3 0 0 1 6 0v5"/>',
}, { get: (icons, type) => icons[type] || PIN }); // unknown types fall back to a pin
