/*
 * Corelain Near Me — HTML for the data-driven parts of the page.
 * Pure string renderers (no DOM), shared by the browser (area-radar.js) and the
 * build-time prerender (vite.config.js). Every list has an empty state, and a
 * missing value always shows "—".
 */
import { DASH, esc, gbp, num, pct, signed, dateLong, rec, val, caption, tokens, fill, scorecard } from './format.js';

const svg = (paths, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${paths}</svg>`;
export const ICON = {
  house: '<path d="M5 12l-2 0l9 -9l9 9l-2 0"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7"/><path d="M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6"/>',
  shield: '<path d="M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3"/>',
  school: '<path d="M22 9l-10 -4l-10 4l10 4l10 -4v6"/><path d="M6 10.6v5.4a6 3 0 0 0 12 0v-5.4"/>',
  primary: '<path d="M5 18v-6a6 6 0 0 1 6 -6h2a6 6 0 0 1 6 6v6a3 3 0 0 1 -3 3h-8a3 3 0 0 1 -3 -3z"/><path d="M10 6v-1a2 2 0 1 1 4 0v1"/><path d="M9 21v-4a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v4"/><path d="M11 10h2"/>',
  tram: '<path d="M6 4h12"/><path d="M12 4v3"/><path d="M5 9a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v7a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2z"/><path d="M5 13h14"/><path d="M8 18l-2 3"/><path d="M16 18l2 3"/>',
  waves: '<path d="M3 7c3 -2 6 -2 9 0s6 2 9 0"/><path d="M3 12c3 -2 6 -2 9 0s6 2 9 0"/><path d="M3 17c3 -2 6 -2 9 0s6 2 9 0"/>',
  cloudrain: '<path d="M7 18a4.6 4.4 0 0 1 0 -9a5 4.5 0 0 1 11 2h1a3.5 3.5 0 0 1 0 7"/><path d="M11 13v2m0 3v2m4 -5v2m0 3v2"/>',
  droplet: '<path d="M7.502 19.423c2.602 2.105 6.395 2.105 8.996 0c2.602 -2.105 3.262 -5.708 1.566 -8.546l-4.89 -7.26c-.42 -.625 -1.287 -.803 -1.936 -.397a1.376 1.376 0 0 0 -.41 .397l-4.893 7.26c-1.695 2.838 -1.035 6.441 1.567 8.546z"/>',
  dam: '<path d="M14 4h6v16h-6z"/><path d="M3 9c1.5 -1 3 -1 4.5 0s3 1 4.5 0"/><path d="M3 14c1.5 -1 3 -1 4.5 0s3 1 4.5 0"/><path d="M3 20h18"/>',
  layers: '<path d="M12 4l-8 4l8 4l8 -4l-8 -4"/><path d="M4 12l8 4l8 -4"/><path d="M4 16l8 4l8 -4"/>',
  wind: '<path d="M5 8h8.5a2.5 2.5 0 1 0 -2.34 -3.24"/><path d="M3 12h15.5a2.5 2.5 0 1 1 -2.34 3.24"/><path d="M4 16h5.5a2.5 2.5 0 1 1 -2.34 3.24"/>',
  crane: '<path d="M6 21h6"/><path d="M9 21v-18l-6 6h18"/><path d="M9 3l10 6"/><path d="M17 9v4a2 2 0 1 1 -2 2"/>',
  columns: '<path d="M3 21l18 0"/><path d="M3 10l18 0"/><path d="M5 6l7 -3l7 3"/><path d="M4 10l0 11"/><path d="M20 10l0 11"/><path d="M8 14l0 3"/><path d="M12 14l0 3"/><path d="M16 14l0 3"/>',
  users: '<path d="M9 7m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0"/><path d="M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M21 21v-2a4 4 0 0 0 -3 -3.85"/>',
  wall: '<path d="M4 6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z"/><path d="M4 8h16"/><path d="M20 12h-16"/><path d="M4 16h16"/><path d="M9 4v4"/><path d="M14 8v4"/><path d="M8 12v4"/><path d="M16 12v4"/><path d="M11 16v4"/>',
  mail: '<path d="M3 7a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-10z"/><path d="M3 7l9 6l9 -6"/>',
  ruler: '<path d="M3 21h4l13 -13a1.5 1.5 0 0 0 -4 -4l-13 13v4"/><path d="M14.5 5.5l4 4"/><path d="M12 8l-5 -5l-4 4l5 5"/><path d="M7 8l-1.5 1.5"/><path d="M16 12l5 5l-4 4l-5 -5"/><path d="M16 17l-1.5 1.5"/>',
  fb: '<path d="M7 10v4h3v7h4v-7h3l1 -4h-4v-2a1 1 0 0 1 1 -1h3v-4h-3a5 5 0 0 0 -5 5v2h-3"/>',
  agent: '<path d="M5 12l-2 0l9 -9l9 9l-2 0"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7"/><path d="M10 15a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M12 17v4"/>',
  ext: '<path d="M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6"/><path d="M11 13l9 -9"/><path d="M15 4h5v5"/>',
  arrow: '<path d="M5 12l14 0"/><path d="M13 18l6 -6"/><path d="M13 6l6 6"/>',
  map: '<path d="M3 7l6 -3l6 3l6 -3v13l-6 3l-6 -3l-6 3v-13"/><path d="M9 4v13"/><path d="M15 7v13"/>',
  search: '<path d="M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0"/><path d="M21 21l-6 -6"/>',
  stadium: '<path d="M4 7a8 2 0 1 0 16 0a8 2 0 1 0 -16 0"/><path d="M4 7v7c0 1.105 3.582 2 8 2s8 -.895 8 -2v-7"/><path d="M15 16v4c0 .552 -1.343 1 -3 1s-3 -.448 -3 -1v-4"/>',
  home: '<path d="M5 12l-2 0l9 -9l9 9l-2 0"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7"/><path d="M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6"/>',
  briefcase: '<path d="M3 9a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z"/><path d="M8 7v-2a2 2 0 0 1 2 -2h4a2 2 0 0 1 2 2v2"/><path d="M12 12l0 .01"/><path d="M3 13a20 20 0 0 0 18 0"/>',
  info: '<path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0"/><path d="M12 9h.01"/><path d="M11 12h1v4h1"/>',
  chev: '<path d="M6 9l6 6l6 -6"/>',
};
const ico = (name, tone) => `<span class="cr-row-ico" style="--c:var(${tone})">${svg(ICON[name])}</span>`;
const badge = (text, tone = 'neutral', size = 'sm') => `<span class="ax-badge ax-badge--soft ax-badge--${tone} ax-badge--${size}">${esc(text)}</span>`;
const empty = (text) => `<p class="cr-empty">${esc(text)}</p>`;
const ext = (url, label) => `<a class="ax-list__trailing cr-ext" href="${esc(url)}" target="_blank" rel="noopener" aria-label="${esc(label)}">${svg(ICON.ext)}</a>`;
const footLink = (url, label, icon = 'map') => `<a class="cr-radon__link cr-card-foot" href="${esc(url)}" target="_blank" rel="noopener">${svg(ICON[icon])}${esc(label)}<span class="cr-radon__ext">${svg(ICON.ext)}</span></a>`;
const row = (inner, last) => `<li class="ax-list__row" style="padding-inline:0;${last ? 'border-bottom:0;' : ''}">${inner}</li>`;
// labelled progress bar: label · value (+ small meta) over a bar `width`% full
const bar = (label, value, width, tone, meta = '') => `<div><div class="ax-cluster" style="justify-content:space-between;margin-bottom:5px;"><span style="font-size:var(--ax-text-sm);color:var(--ax-text);">${esc(label)}</span><b class="ax-num" style="color:var(--ax-text-strong);font-size:var(--ax-text-sm);">${esc(value)}${meta ? ` <small style="color:var(--ax-text-subtle);font-weight:500;">${esc(meta)}</small>` : ''}</b></div>
  <div class="ax-progress ax-progress--sm"><div class="ax-progress__track"><div class="ax-progress__fill" style="width:${Math.max(0, Math.min(100, width)).toFixed(0)}%;background:var(${tone});"></div></div></div></div>`;

// ── data-m bindings: key → text ──
export function bindings(data) {
  const ap = val(data, 'average_price');
  const g = val(data, 'annual_growth');
  const uk = val(data, 'hpi_uk');
  const rent = val(data, 'average_rent');
  const ten = val(data, 'tenure');
  const pop = val(data, 'population');
  const pay = val(data, 'earnings');
  const rt = val(data, 'routes');
  const cr = rec(data, 'crime_rate');
  const sc = val(data, 'schools');
  const tr = val(data, 'transport_score');
  const sc2 = scorecard(data);
  const ew = cr && cr.comparison && cr.comparison['England and Wales'];
  return {
    average_price: gbp(ap),
    annual_growth: signed(g),
    average_rent: rent ? gbp(rent.monthly) : DASH,
    'tenure.rent': ten ? pct(ten.rent_pct, 0) : DASH,
    'tenure.own': ten ? `${pct(ten.own_pct, 0)} own · ${pct(ten.private_pct, 0)} private · ${pct(ten.social_pct, 0)} social rent` : caption(data, 'tenure'),
    'cap.average_price': caption(data, 'average_price', { short: true }),
    'cap.annual_growth': uk ? `vs UK ${signed(uk.growth)} (UK HPI, ${rec(data, 'hpi_uk').period})` : caption(data, 'annual_growth', { short: true }),
    'cap.average_rent': rent ? `ONS private rents · ${rec(data, 'average_rent').period} · ${(rec(data, 'average_rent').geography || '').replace(' (local authority)', '')}` : caption(data, 'average_rent'),
    'cap.tenure': ten ? `Census 2021 · ${num(ten.households)} households` : caption(data, 'tenure'),
    'pop.geo': rec(data, 'population') ? rec(data, 'population').geography || DASH : DASH,
    'pay.geo': pay ? rec(data, 'earnings').geography : DASH,
    'pay.annual': pay ? gbp(pay.annual) : DASH,
    'pay.sub': pay ? `median a year, full-time${pay.change_pct != null ? ` · ${signed(pay.change_pct)} on ${rec(data, 'earnings').period.slice(0, 4) - 1}` : ''}` : caption(data, 'earnings'),
    'pay.cap': caption(data, 'earnings'),
    'routes.geo': rt ? rec(data, 'routes').geography : 'No timetable data for this area yet',
    'routes.bus_count': rt ? `· ${num(rt.bus_total)} service${rt.bus_total === 1 ? '' : 's'}` : '',
    'routes.cap': rt ? `Trams and buses: TfGM timetable (${(rec(data, 'routes').period || '').replace('Timetable downloaded ', 'downloaded ')}). Trains: National Rail lines checked ${rt.rail_reviewed ? dateLong(rt.rail_reviewed) : 'by hand'}. Busiest services first; school-day buses last.` : caption(data, 'routes'),
    'trend.subtitle': rec(data, 'price_trend') && val(data, 'price_trend')
      ? `Average sold price vs. annual growth — ${rec(data, 'price_trend').period}` : 'No yearly sales series for this area yet',
    'trend.geo': rec(data, 'price_trend') ? (rec(data, 'price_trend').geography || '') : '',
    crime_rate: cr && cr.value != null ? num(cr.value, 1) : DASH,
    'crime.sub': cr && cr.value != null ? `crimes / 1,000 · England & Wales ${num(ew, 1)}` : caption(data, 'crime_rate'),
    'crime.geo': cr && cr.value != null ? `${(cr.geography || '').replace(' (borough-wide)', '')} · ${cr.period}` : DASH,
    'school.score': sc && sc.score != null ? `${num(sc.score, 1)} / 10` : DASH,
    'school.sub': rec(data, 'schools') ? (rec(data, 'schools').geography || '') : DASH,
    'school.count': sc ? `${num(sc.schools)} schools` : DASH,
    'transport.cap': caption(data, 'transport_score', { short: true }),
    'score.overall': sc2.overall == null ? DASH : `${sc2.overall} / 100`,
    'air.period': rec(data, 'air_quality') && val(data, 'air_quality') ? `Defra background · ${(rec(data, 'air_quality').period || '').replace(/ annual mean.*$/, '')} annual mean` : caption(data, 'air_quality'),
    'map.label': data ? (data.kind === 'region' ? `${data.name} · ten boroughs` : data.kind === 'borough' ? `${data.name} borough` : `${data.name}, ${data.postcode}`) : DASH,
    'conservation.cap': caption(data, 'conservation_areas'),
    'dev.cap': [rec(data, 'developments') && rec(data, 'developments').geography,
      val(data, 'development_sites') && `Brownfield register ${rec(data, 'development_sites').geography}`].filter(Boolean).join(' · ') || 'No schemes recorded yet',
    'news.cap': val(data, 'news')
      ? (rec(data, 'news').scope === 'nearby' ? `Latest headlines near ${data.name}`
        : rec(data, 'news').scope === 'regional' ? 'Latest Greater Manchester headlines'
          : `Latest ${data.name} headlines`)
      : 'No matching headlines in the current feeds',
    'journey.total': val(data, 'journey') ? `≈${num(val(data, 'journey').legs.reduce((s, l) => s + l.minutes, 0))} min` : DASH,
    updated: data && data.updated ? dateLong(data.updated) : DASH,
  };
}

// ── KPI change chips ──
function delta(v, dp = 1, unit = '%') {
  if (v == null) return '';
  const up = v >= 0;
  const arrow = up ? '<path d="M6 15l6 -6l6 6"/>' : '<path d="M6 9l6 6l6 -6"/>';
  return `<span class="ax-kpi__delta ax-kpi__delta--${up ? 'up' : 'down'}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${arrow}</svg>${num(Math.abs(v), dp)}${unit}</span>`;
}

const BLOCKS = {
  'kpi.price.change': (d) => {
    const g = val(d, 'annual_growth');
    return g == null ? `<span class="cr-kpi__cmp">${esc(caption(d, 'annual_growth'))}</span>` : `${delta(g)}<span class="cr-kpi__cmp">vs previous 12 months</span>`;
  },
  'kpi.growth.change': (d) => {
    const g = val(d, 'annual_growth');
    const uk = val(d, 'hpi_uk');
    if (g == null || !uk) return `<span class="cr-kpi__cmp">${esc(caption(d, 'annual_growth'))}</span>`;
    return `${delta(g - uk.growth, 1, ' pts')}<span class="cr-kpi__cmp">vs UK ${esc(signed(uk.growth))}</span>`;
  },

  'kpi.rent.change': (d) => {
    const r = val(d, 'average_rent');
    if (!r || r.change_12m == null) return `<span class="cr-kpi__cmp">${esc(caption(d, 'average_rent'))}</span>`;
    return `${delta(r.change_12m)}<span class="cr-kpi__cmp">vs a year earlier</span>`;
  },
  'kpi.tenure.bar': (d) => {
    const t = val(d, 'tenure');
    if (!t) return '';
    const other = Math.max(0, 100 - t.own_pct - t.social_pct - t.private_pct);
    return [['Own', t.own_pct, '--ax-viz-emerald'], ['Private rent', t.private_pct, '--ax-viz-amber'], ['Social rent', t.social_pct, '--ax-viz-violet'], ['Other', other, '--ax-neutral-400']]
      .filter(([, v]) => v > 0).map(([l, v, c]) => `<i style="--w:${v}%;--c:var(${c})" title="${esc(l)} ${pct(v)}"></i>`).join('');
  },

  'score.bars': (d) => {
    const sc = scorecard(d);
    if (!sc.axes.length) return empty('Not enough data for a scorecard yet.');
    const tone = (v) => (v >= 70 ? '--ax-viz-emerald' : v >= 45 ? '--ax-viz-amber' : '--ax-danger-500');
    return sc.axes.map(([k, v]) => bar(k, `${v} / 100`, v, tone(v))).join('');
  },

  'pop.stats': (d) => {
    const p = val(d, 'population');
    if (!p) return empty('Census figures are not available for this area yet.');
    return [[num(p.residents), 'residents'], [num(p.households), 'households'], [num(p.household_size, 2), 'people per home']]
      .map(([v, l]) => `<div><b class="ax-num">${esc(v)}</b><small>${esc(l)}</small></div>`).join('');
  },
  'pop.age': (d) => {
    const p = val(d, 'population');
    if (!p) return '';
    const eng = ((rec(d, 'population').comparison || {}).England) || {};
    return p.age.map((g) => bar(g.label, pct(g.pct), g.pct * 2.5, '--ax-viz-cyan', eng[g.key] != null ? `England ${pct(eng[g.key])}` : '')).join('');
  },

  'pay.bars': (d) => {
    const p = val(d, 'earnings');
    if (!p) return '';
    const rows = [[d.kind === 'region' ? d.name : d.borough, p.annual, '--ax-accent'], ...Object.entries(p.comparison || {}).map(([k, v]) => [k, v, '--ax-viz-violet'])];
    const max = Math.max(...rows.map((r) => r[1]));
    return rows.map(([l, v, c]) => bar(l, gbp(v), (v / max) * 100, c)).join('');
  },
  'pay.afford': (d) => {
    const p = val(d, 'earnings');
    const ap = val(d, 'average_price');
    const r = val(d, 'average_rent');
    if (!p || !p.annual) return '';
    const items = [];
    if (ap) items.push([`${num(ap / p.annual, 1)}×`, 'average price ÷ annual pay']);
    if (r && r.monthly) items.push([pct((r.monthly * 12 / p.annual) * 100, 0), 'of gross pay goes on the average rent']);
    return items.map(([v, l]) => `<div><b class="ax-num">${esc(v)}</b><small>${esc(l)}</small></div>`).join('');
  },

  'routes.trams': (d) => {
    const r = val(d, 'routes');
    if (!r || !r.trams.length) return empty(r ? `No Metrolink stop within 1 km of ${d.name}.` : 'No timetable data yet.');
    return `<ul class="cr-route-list">${r.trams.map((t) => `<li><span class="cr-route-badge cr-route-badge--tram" style="--c:${esc(t.colour || 'var(--ax-viz-amber)')}">${esc(t.line.replace(/ Line$/, ''))}</span>
      <span class="cr-route-ends">${esc(t.from)} <span aria-label="to">↔</span> ${esc(t.to || '')}</span></li>`).join('')}</ul>`;
  },
  'routes.rail': (d) => {
    const r = val(d, 'routes');
    if (!r || !r.rail.length) return empty('No railway station nearby.');
    return `<ul class="cr-route-list">${r.rail.map((st) => `<li class="cr-route-station">
      <span class="cr-route-station__name"><a class="cr-link-title" href="${esc(st.url)}" target="_blank" rel="noopener">${esc(st.name)}</a>${st.distance_mi != null ? ` <small>≈${num(st.distance_mi, 1)} mi</small>` : ''}</span>
      ${st.lines.map((l) => `<span class="cr-route-ends"><b>${esc(l.operator)}</b> ${esc(l.from)} <span aria-label="to">↔</span> ${esc(l.to)}${l.via && l.via.length ? ` <small>via ${esc(l.via.join(', '))}</small>` : ''}</span>`).join('')}
      ${(st.operators || []).map((o) => `<span class="cr-route-ends"><b>${esc(o.operator)}</b> ${esc(o.to)}</span>`).join('')}
      ${!st.lines.length && !(st.operators || []).length ? '<span class="cr-route-ends"><small>See National Rail for services</small></span>' : ''}</li>`).join('')}</ul>`;
  },
  'routes.buses': (d) => {
    const r = val(d, 'routes');
    if (!r || !r.buses.length) return empty(r ? `No bus stop within 1 km of ${d.name}.` : 'No timetable data yet.');
    return `<ul class="cr-route-list">${r.buses.map((b) => `<li data-bus="${esc([b.number, b.from, b.to, ...(b.via || [])].join(' ').toLowerCase())}">
      <span class="cr-route-badge${b.school ? ' cr-route-badge--school' : ''}">${esc(b.number)}</span>
      <span class="cr-route-ends">${esc(b.from)}${b.to ? ` <span aria-label="to">→</span> ${esc(b.to)}` : ''}${b.via && b.via.length ? ` <small>via ${esc(b.via.join(', '))}</small>` : ''}${b.school ? ' <small>· school days</small>' : ''}</span></li>`).join('')}</ul>${r.bus_total > r.buses.length ? `<p class="cr-empty">${num(r.bus_total - r.buses.length)} more services — see the TfGM journey planner.</p>` : ''}`;
  },

  'crime.badge': (d) => {
    const cr = rec(d, 'crime_rate');
    const ew = cr && cr.comparison && cr.comparison['England and Wales'];
    if (!cr || cr.value == null || !ew) return badge(DASH, 'neutral', 'pill');
    return cr.value <= ew ? `<span class="ax-badge ax-badge--soft ax-badge--success ax-badge--pill">Below average</span>`
      : `<span class="ax-badge ax-badge--soft ax-badge--warning ax-badge--pill">Above average</span>`;
  },
  'crime.rows': (d) => {
    const groups = val(d, 'crime_groups');
    if (!groups) return empty('Category rates are not available yet.');
    return groups.map((x) => {
      const w = Math.min(100, (x.rate / (2 * x.england_wales || 1)) * 100);
      return `<div><div class="ax-cluster" style="justify-content:space-between;margin-bottom:5px;"><span style="font-size:var(--ax-text-sm);color:var(--ax-text);">${esc(x.label)}</span><b class="ax-num" style="color:var(--ax-text-strong);font-size:var(--ax-text-sm);">${num(x.rate, 1)} <small style="color:var(--ax-text-subtle);font-weight:500;">/ E&amp;W ${num(x.england_wales, 1)}</small></b></div>
        <div class="ax-progress ax-progress--sm"><div class="ax-progress__track"><div class="ax-progress__fill" style="width:${w.toFixed(0)}%;background:var(--ax-viz-violet);"></div></div></div></div>`;
    }).join('');
  },
  'crime.delta': (d) => {
    const t = tokens(d);
    return t.crime_vs_ew ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${/lower/.test(t.crime_vs_ew) ? 'M6 9l6 6l6 -6' : 'M6 15l6 -6l6 6'}"/></svg>${esc(t.crime_vs_ew)} than England &amp; Wales` : '';
  },

  'school.list': (d) => {
    const s = val(d, 'schools');
    if (!s) return empty('No inspected schools found nearby.');
    if (!s.nearest.length) {
      const m = s.mix;
      const rows = [['Outstanding', m.outstanding, 'success'], ['Good', m.good, 'info'], ['Report card (from Nov 2025)', m.report, 'accent'],
        ['Below Good', m.below, 'warning'], ['No overall grade', m.none, 'neutral']];
      return `<ul class="ax-list ax-list--compact">${rows.map(([l, n, tone], i) => row(
        `<span class="ax-list__content"><span class="ax-list__title">${esc(l)}</span></span><span class="ax-list__trailing">${badge(num(n), tone)}</span>`, i === rows.length - 1)).join('')}</ul>`;
    }
    const tone = (g) => (g === 'Outstanding' || g === 'Exceptional' ? 'success' : /Good|Strong|Expected/.test(g) ? 'info' : /Requires|Inadequate|Needs|Urgent/.test(g) ? 'warning' : 'neutral');
    return `<ul class="ax-list ax-list--compact">${s.nearest.map((x, i) => row(
      `<span class="ax-list__leading">${ico(x.phase === 'Primary' ? 'primary' : 'school', x.phase === 'Primary' ? '--ax-viz-amber' : '--ax-viz-violet')}</span>
       <span class="ax-list__content"><span class="ax-list__title">${esc(x.name)}</span><span class="ax-list__meta">${esc(x.phase)} · ≈${num(x.distance_mi, 1)} mi${x.date ? ' · ' + esc(dateLong(x.date).replace(/^\d+ /, '')) : ''}</span></span>
       <span class="ax-list__trailing">${badge(x.grade === 'No overall grade' ? 'No grade' : x.grade, tone(x.grade))}</span>`, i === s.nearest.length - 1)).join('')}</ul>`;
  },
  'school.legend': (d) => {
    const s = val(d, 'schools');
    if (!s) return '';
    const m = s.mix;
    return [['Outstanding', m.outstanding, '--ax-success-500'], ['Good', m.good, '--ax-info-500'], ['Report card', m.report, '--ax-accent'],
      ['Below Good', m.below, '--ax-warning-500'], ['No grade', m.none, '--ax-neutral-400']]
      .filter(([, n]) => n).map(([l, n, c]) => `<li style="--c:var(${c})"><span>${esc(l)}</span><b>${num(n)}</b></li>`).join('');
  },

  // Under the gauge in the Public Transport card: the score's own four axes and
  // nothing else. Nearest stops and the hand-entered journey legs used to be
  // listed here too, but the tram, train and bus columns beside it now carry
  // that detail (both still feed the FAQ tokens in format.js). "/ 100" is left
  // off because the gauge is already labelled "out of 100".
  'transport.rows': (d) => {
    const t = val(d, 'transport_score');
    if (!t) return empty('No connectivity score for this area yet.');
    return [['Public transport', t.public_transport], ['Walking', t.walking],
      ['Cycling', t.cycling], ['Driving', t.driving]]
      .map(([l, v]) => `<div class="ax-gauge__row"><span class="ax-gauge__row-label">${esc(l)}</span><span class="ax-gauge__row-value ax-num">${num(v)}</span></div>`)
      .join('');
  },

  'flood.badge': (d) => {
    const f = val(d, 'flood_risk');
    const z = val(d, 'flood_zones');
    if (!f && z) {
      const [t, tone] = z.borough ? [z.zone3_nearby ? 'Varies' : 'Low', z.zone3_nearby ? 'warning' : 'success']
        : [['', 'Low', 'Medium', 'High'][z.centre_zone] || 'Low', ['', 'success', 'warning', 'danger'][z.centre_zone] || 'success'];
      return `<span class="ax-badge ax-badge--soft ax-badge--${tone} ax-badge--pill"><span class="ax-badge__dot"></span>${esc(t)}</span>`;
    }
    if (!f) return badge(DASH, 'neutral', 'pill');
    const tone = /very low|low/i.test(f.overall) ? 'success' : /medium/i.test(f.overall) ? 'warning' : 'danger';
    return `<span class="ax-badge ax-badge--soft ax-badge--${tone} ax-badge--pill"><span class="ax-badge__dot"></span>${esc(f.overall)}</span>`;
  },
  'flood.list': (d) => {
    const f = val(d, 'flood_risk');
    const z = val(d, 'flood_zones');
    const zoneRows = z ? [
      z.borough ? null : ['waves', '--ax-viz-cyan', 'Flood zone at the centre', `Zone ${z.centre_zone} · ${['', 'low', 'medium', 'high'][z.centre_zone]} probability (rivers & sea)`,
        badge(`Zone ${z.centre_zone}`, ['', 'success', 'warning', 'danger'][z.centre_zone])],
      ['map', '--ax-viz-violet', z.borough ? 'Flood zone 3 land in the borough' : `Zone 3 land within ${z.radius_km} km`, 'High probability, rivers & sea', badge(z.zone3_nearby ? 'Yes' : 'No', z.zone3_nearby ? 'warning' : 'success')],
      ['map', '--ax-viz-amber', z.borough ? 'Flood zone 2 land in the borough' : `Zone 2 land within ${z.radius_km} km`, 'Medium probability, rivers & sea', badge(z.zone2_nearby ? 'Yes' : 'No', z.zone2_nearby ? 'warning' : 'success')],
      ['cloudrain', '--ax-accent', 'Surface water', 'Varies by street — check the address', `<span style="color:var(--ax-text-subtle);">${DASH}</span>`],
    ].filter(Boolean) : [];
    if (!f) {
      if (!zoneRows.length) return empty(`No flood data for ${d.name} yet. Long-term risk is published per address — use the Environment Agency service below.`);
      return `<ul class="ax-list ax-list--compact">${zoneRows.map(([icon, tone, title, meta, right], i) => row(
        `<span class="ax-list__leading">${ico(icon, tone)}</span><span class="ax-list__content"><span class="ax-list__title">${esc(title)}</span><span class="ax-list__meta">${esc(meta)}</span></span><span class="ax-list__trailing">${right}</span>`,
        i === zoneRows.length - 1)).join('')}</ul>`;
    }
    const icons = { rivers_sea: ['waves', '--ax-viz-cyan'], surface_water: ['cloudrain', '--ax-viz-violet'], groundwater: ['droplet', '--ax-accent'], reservoirs: ['dam', '--ax-viz-amber'] };
    const word = ['', 'Very low', 'Low', 'Medium', 'High'];
    const tone = ['', 'success', 'success', 'warning', 'danger'];
    return `<ul class="ax-list ax-list--compact">${f.levels.map((l, i) => row(
      `<span class="ax-list__leading">${ico(...(icons[l.key] || ['waves', '--ax-viz-cyan']))}</span>
       <span class="ax-list__content"><span class="ax-list__title">${esc(l.label)}</span><span class="ax-list__meta">${esc(l.meta || '')}</span></span>
       ${l.level ? `<span class="ax-list__trailing">${badge(word[l.level], tone[l.level])}</span>` : `<span class="ax-list__trailing" style="color:var(--ax-text-subtle);">${DASH}</span>`}`, i === f.levels.length - 1)).join('')}</ul>
       ${f.note ? `<p class="cr-card-note">${esc(f.note)}</p>` : ''}`;
  },

  'mining.badge': (d) => {
    const c = val(d, 'coal_mining');
    if (!c) return badge(DASH, 'neutral', 'pill');
    const [t, tone] = c.level === 'high' ? ['High risk', 'danger'] : c.level === 'low' ? ['Coalfield', 'warning'] : ['Low', 'success'];
    return `<span class="ax-badge ax-badge--soft ax-badge--${tone} ax-badge--pill"><span class="ax-badge__dot"></span>${t}</span>`;
  },
  'mining.alert': (d) => {
    const t = tokens(d);
    return t.coal_text ? `${esc(d.name)} ${esc(t.coal_text)}. Check a specific property with a coal mining report before buying.` : 'Coal mining data is not available for this area yet.';
  },
  'mining.list': (d) => {
    const c = val(d, 'coal_mining');
    const rd = val(d, 'radon');
    const gr = val(d, 'ground');
    const yes = (b) => badge(b ? 'Yes' : 'No', b ? 'warning' : 'success');
    const rows = [
      ['Coal mining reporting area', c ? (c.partial && c.reporting_area ? badge('Partly', 'warning') : yes(c.reporting_area)) : DASH],
      ['Development high risk area', c ? yes(c.development_high_risk) : DASH],
      ['Radon', rd ? badge(`Class ${rd.class} of ${rd.of}`, rd.class <= 2 ? 'success' : 'warning') : DASH, rd && rd.share],
      ['Natural ground subsidence', gr && gr.natural_subsidence ? badge(gr.natural_subsidence, /low/i.test(gr.natural_subsidence) ? 'success' : 'warning') : DASH,
        gr ? 'BGS GeoSure · generalised 5 km screening' : null],
    ];
    return `<ul class="ax-list ax-list--compact">${rows.map(([l, v, meta], i) => row(
      `<span class="ax-list__content"><span class="ax-list__title">${esc(l)}</span>${meta ? `<span class="ax-list__meta">${esc(meta)}</span>` : ''}</span>
       <span class="ax-list__trailing"${v === DASH ? ' style="color:var(--ax-text-subtle);"' : ''}>${v}</span>`, i === rows.length - 1)).join('')}</ul>`;
  },
  'radon.scale': (d) => {
    const rd = val(d, 'radon');
    const cls = rd ? rd.class : 0;
    return [1, 2, 3, 4, 5, 6].map((n) => `<span${n === cls ? ' class="is-current"' : ''}><i>${n}</i></span>`).join('');
  },
  'radon.value': (d) => {
    const rd = val(d, 'radon');
    return rd ? `Class <b>${rd.class}</b> / ${rd.of}` : `Class <b>${DASH}</b> / 6`;
  },

  'air.bars': (d) => {
    const a = val(d, 'air_quality');
    const items = [['PM2.5', 'pm25', '--ax-viz-emerald'], ['NO₂', 'no2', '--ax-viz-amber'], ['PM10', 'pm10', '--ax-viz-emerald']];
    return items.map(([label, k, c]) => {
      const v = a ? a[k] : null;
      const w = v == null ? 0 : Math.min(100, (v / a.limits[k]) * 100);
      return `<div><div class="ax-cluster" style="justify-content:space-between;margin-bottom:5px;"><span style="font-size:var(--ax-text-sm);color:var(--ax-text);">${label}</span><b class="ax-num" style="color:var(--ax-text-strong);font-size:var(--ax-text-sm);">${v == null ? DASH : num(v, 1) + ' µg/m³'}${v == null ? '' : ` <small style="color:var(--ax-text-subtle);font-weight:500;">/ ${a.limits[k]}</small>`}</b></div>
        <div class="ax-progress ax-progress--sm"><div class="ax-progress__track"><div class="ax-progress__fill" style="width:${w.toFixed(0)}%;background:var(${c});"></div></div></div></div>`;
    }).join('');
  },
  'air.head': (d) => {
    const a = val(d, 'air_quality');
    const q0 = val(d, 'aqma');
    const q = q0 ? { inside: q0.inside || [], nearby: q0.nearby || [] } : null;
    const aq = q && (q.inside.length || (d.kind === 'borough' && q.nearby.length)) ? { name: q.inside[0] || q.nearby[0].name } : null;
    const main = a && a.no2 != null ? `${num(a.no2, 1)} <small style="font-size:var(--ax-text-base);color:var(--ax-text-muted);font-weight:var(--ax-weight-medium);">µg/m³</small>` : DASH;
    return `<div><div class="ax-num" style="font-family:var(--ax-font-display);font-size:var(--ax-text-3xl);font-weight:700;line-height:1;color:var(--ax-text-strong);">${main}</div>
      <small style="color:var(--ax-text-muted);font-size:var(--ax-text-sm);">Background NO₂ annual mean · limit 40</small></div>
      ${aq ? `<span class="ax-badge ax-badge--soft ax-badge--warning ax-badge--pill ax-badge--sm" title="${esc(aq.name)}">AQMA</span>` : ''}`;
  },
  'air.note': (d) => {
    const q0 = val(d, 'aqma');
    const q = q0 ? { inside: q0.inside || [], nearby: q0.nearby || [] } : null;
    const road = val(d, 'aqma_roadside');
    const bits = [];
    if (q && q.inside.length) bits.push(`The centre of ${d.name} is inside the ${q.inside.join(', ')}.`);
    else if (q && q.nearby.length) bits.push(`${d.kind === 'borough' ? 'Declared' : 'Nearby'} air quality management area${q.nearby.length > 1 ? 's' : ''}: ${q.nearby.map((x) => x.name).join(', ')}.`);
    else if (q) bits.push('No air quality management area within 1.5 km.');
    if (road) bits.push(`${road.name}: roadside NO₂ about ${road.roadside_no2} µg/m³ a year.${road.note ? ' ' + road.note : ''}`);
    return esc(bits.join(' ') || (rec(d, 'air_quality') || {}).note || '');
  },

  'dev.table': (d) => {
    const v = val(d, 'developments');
    const bf = val(d, 'development_sites');
    const sites = bf ? bf.sites.slice(0, v && v.schemes ? 4 : 6).map((x) => ({
      name: x.name, meta: `Brownfield register${x.hectares ? ` · ${num(x.hectares, 2)} ha` : ''}${x.permission_date ? ` · permission ${x.permission_date.slice(0, 4)}` : ''}`,
      type: 'Housing site', units: x.homes ? num(x.homes) : null, distance: x.distance_mi != null ? `≈${num(x.distance_mi, 1)} mi` : d.name,
      status: x.status, tone: x.status === 'Permission granted' ? 'success' : x.status === 'Pending decision' ? 'warning' : 'neutral', url: x.url })) : [];
    const all = [...((v && v.schemes) || []), ...sites];
    if (all.length) return all.map((s) => `<tr class="ax-table__row">
      <td class="ax-table__td"><div style="font-weight:var(--ax-weight-medium);color:var(--ax-text-strong);">${s.url ? `<a class="cr-link-title" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>` : esc(s.name)}</div><div style="font-size:var(--ax-text-xs);color:var(--ax-text-subtle);">${esc(s.meta || '')}</div></td>
      <td class="ax-table__td" style="color:var(--ax-text-muted);">${esc(s.type || DASH)}</td>
      <td class="ax-table__td ax-table__td--num"${s.units ? '' : ' style="color:var(--ax-text-subtle);"'}>${esc(s.units || DASH)}</td>
      <td class="ax-table__td ax-table__td--num" style="color:var(--ax-text-muted);">${esc(s.distance || DASH)}</td>
      <td class="ax-table__td">${badge(s.status || DASH, s.tone || 'info')}</td></tr>`).join('');
    if (!v || !v.schemes || !v.schemes.length) return `<tr class="ax-table__row"><td class="ax-table__td" colspan="5">${empty(`No major schemes recorded for ${d.name} yet — search Trafford Council's planning applications for individual proposals.`)}</td></tr>`;
    return v.schemes.map((s) => `<tr class="ax-table__row">
      <td class="ax-table__td"><div style="font-weight:var(--ax-weight-medium);color:var(--ax-text-strong);">${esc(s.name)}</div><div style="font-size:var(--ax-text-xs);color:var(--ax-text-subtle);">${esc(s.meta || '')}</div></td>
      <td class="ax-table__td" style="color:var(--ax-text-muted);">${esc(s.type || DASH)}</td>
      <td class="ax-table__td ax-table__td--num"${s.units ? '' : ' style="color:var(--ax-text-subtle);"'}>${esc(s.units || DASH)}</td>
      <td class="ax-table__td ax-table__td--num" style="color:var(--ax-text-muted);">${esc(s.distance || DASH)}</td>
      <td class="ax-table__td">${badge(s.status || DASH, s.tone || 'info')}</td></tr>`).join('');
  },
  'dev.col': (d) => esc((val(d, 'developments') || {}).distance_label || 'Distance'),
  'dev.stats': (d) => {
    const v = val(d, 'developments');
    const bf = val(d, 'development_sites');
    if ((!v || !v.stats) && bf) {
      return [[num(bf.count), 'brownfield sites', 'map', '--ax-viz-amber'], [bf.homes ? num(bf.homes) : DASH, 'homes capacity', 'home', '--ax-accent'],
        [num(bf.hectares, 1), 'hectares', 'layers', '--ax-viz-cyan'], [num(bf.permissioned), 'with permission', 'briefcase', '--ax-viz-violet']]
        .map(([value, label, icon, tone]) => `<div class="cr-dev__stat"><span class="cr-row-ico" style="--c:var(${tone})">${svg(ICON[icon])}</span><b class="ax-num">${esc(value)}</b><small>${esc(label)}</small></div>`).join('');
    }
    if (!v || !v.stats) return '';
    return v.stats.map((s) => `<div class="cr-dev__stat"><span class="cr-row-ico" style="--c:var(${s.tone})">${svg(ICON[s.icon] || ICON.home)}</span><b class="ax-num">${esc(s.value)}</b><small>${esc(s.label)}</small></div>`).join('');
  },
  'dev.timeline': (d) => {
    const v = val(d, 'developments');
    if (!v || !v.timeline) return '';
    return `<div class="cr-flood-chart__head"><span class="cr-radon__label">${esc(v.timeline_title || 'Milestones')}</span><span class="cr-flood-chart__hint">${esc(v.timeline_hint || '')}</span></div>
      <ol class="cr-tl" aria-label="${esc(v.timeline_title || 'Milestones')}">${v.timeline.map((t) => `<li class="cr-tl__item is-${t.state === 'now' ? 'now' : 'done'}" style="--c:var(${t.tone})"><span class="cr-tl__date">${esc(t.date)}</span><span class="cr-tl__title">${esc(t.title)}</span><span class="cr-tl__meta">${esc(t.meta || '')}</span></li>`).join('')}</ol>`;
  },

  'conservation.alert': (d) => {
    const v = val(d, 'conservation_areas');
    if (!v) return '<p class="ax-alert__title">No conservation data yet</p>';
    if (d.kind === 'borough') return `<p class="ax-alert__title">${num(v.count)} conservation areas in ${esc(d.name)}</p><p class="ax-alert__message">Extra planning controls apply inside each one.</p>`;
    const inside = v.centre_inside || [];
    return inside.length
      ? `<p class="ax-alert__title">Centre is inside the ${esc(inside.join(', '))} Conservation Area</p><p class="ax-alert__message">Extra planning controls apply; check the boundary for a specific address.</p>`
      : `<p class="ax-alert__title">Centre is outside a conservation area</p><p class="ax-alert__message">${num(v.count)} within 1.5 km of the centre of ${esc(d.name)}.</p>`;
  },
  'conservation.list': (d) => {
    const v = val(d, 'conservation_areas');
    const pc = val(d, 'planning_constraints');
    const items = v ? [...v.nearby].sort((a, b) => (d.kind === 'borough' ? a.name.localeCompare(b.name) : 0)).slice(0, d.kind === 'borough' ? 30 : 6) : [];
    const rows = items.map((c) => [`<a class="cr-link-title" href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.name)}</a>`,
      d.kind === 'borough' ? '' : `≈${num(c.distance_mi, 1)} mi`, c.designated ? c.designated.slice(0, 4) : DASH]);
    (pc || []).forEach((p) => rows.push([esc(p.label), esc(p.meta || ''), esc(p.value)]));
    if (!rows.length) return empty('No conservation areas within 1.5 km.');
    return `<ul class="ax-list ax-list--compact${d.kind === 'borough' ? ' cr-ca-scroll' : ''}">${rows.map(([t, meta, v2], i) => row(
      `<span class="ax-list__content"><span class="ax-list__title">${t}</span>${meta ? `<span class="ax-list__meta">${meta}</span>` : ''}</span>
       <span class="ax-list__trailing ax-num" style="color:var(--ax-text-strong);" title="Designated">${v2}</span>`, i === rows.length - 1)).join('')}</ul>`;
  },

  'news.filter': (d) => {
    const v = val(d, 'news') || [];
    const local = v.filter((n) => n.scope !== 'nearby').length;
    const near = v.length - local;
    if (!local || !near) return '';
    const chip = (key, label, n) => `<button type="button" class="cr-chip${key === 'all' ? ' is-active' : ''}" role="radio" aria-checked="${key === 'all'}" data-news-scope="${key}">${esc(label)} <small>${n}</small></button>`;
    return chip('all', 'All', v.length) + chip('local', d.name, local) + chip('nearby', 'Surrounding areas', near);
  },
  'news.list': (d) => {
    const v = val(d, 'news');
    if (!v || !v.length) return empty(`No headlines listed for ${d.name} yet.`);
    return `<div class="cr-news">${v.map((n) => `<article class="cr-news__item" data-scope="${n.scope === 'nearby' ? 'nearby' : 'local'}">
      <a class="cr-news__media" href="${esc(n.url)}" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true"><img src="${esc(n.image)}" alt="" width="640" height="400" loading="lazy" decoding="async"${n.image_external ? ' referrerpolicy="no-referrer"' : ''}><span class="cr-news__source">${esc(n.source)}</span></a>
      <div class="cr-news__body"><div class="cr-news__tags">${badge(n.tag, n.tone || 'accent')}<span class="cr-news__time">${esc(n.date)}</span></div>
        <h3 class="cr-news__title"><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a></h3>
        ${n.excerpt ? `<p class="cr-news__excerpt">${esc(n.excerpt)}</p>` : ''}
        <div class="cr-news__foot"><span>${esc(n.domain)}</span><a class="cr-news__more" href="${esc(n.url)}" target="_blank" rel="noopener" aria-label="Read: ${esc(n.title)}">Read <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON.arrow}</svg></a></div>
      </div></article>`).join('')}</div>`;
  },
  'news.more': (d) => {
    const links = (rec(d, 'news') || {}).feed_links || [];
    return links.length ? `<a class="ax-btn ax-btn--link" href="${esc(links[0].url)}" target="_blank" rel="noopener">Publisher feed</a>` : '';
  },
};

export function block(name, data) {
  const fn = BLOCKS[name];
  return fn && data ? fn(data) : '';
}
export const BLOCK_NAMES = Object.keys(BLOCKS);

// ── FAQ ──
/** Topics with their filled-in questions for one area (topics with no answer are dropped). */
export function faqItems(data, templates) {
  const t = tokens(data);
  return templates.topics.map((topic) => ({
    ...topic,
    qa: topic.items.map((it) => ({ q: fill(it.q, t), a: fill(it.a, t) })).filter((x) => x.q && x.a),
  })).filter((topic) => topic.qa.length);
}

export function faqHtml(data, templates) {
  const topics = faqItems(data, templates);
  const total = topics.reduce((s, x) => s + x.qa.length, 0);
  const tabs = topics.map((x, i) => `
      <button type="button" class="cr-faq__tab${i === 0 ? ' is-active' : ''}" role="tab" id="cr-faq-tab-${x.key}" aria-controls="cr-faq-panel-${x.key}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-faq-tab="${x.key}" style="--c:var(${x.tone})">
        <span class="cr-faq__tab-ico">${svg(ICON[x.icon] || ICON.info)}</span>
        <span class="cr-faq__tab-label">${esc(x.label)}</span>
        <span class="cr-faq__tab-count">${x.qa.length}</span>
      </button>`).join('');
  const panels = topics.map((x, i) => `
      <div class="cr-faq__panel" role="tabpanel" id="cr-faq-panel-${x.key}" aria-labelledby="cr-faq-tab-${x.key}"${i === 0 ? '' : ' hidden'}>
        <h3 class="cr-faq__panel-title">${esc(x.label)}</h3>${x.qa.map((qa, j) => `
        <details class="cr-faq__item"${j === 0 ? ' open' : ''}>
          <summary><h3 class="cr-faq__q">${esc(qa.q)}</h3><svg class="cr-faq__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON.chev}</svg></summary>
          <p class="cr-faq__a">${esc(qa.a)}</p>
        </details>`).join('')}
      </div>`).join('');
  return { total, html: `<div class="cr-faq__tabs" role="tablist" aria-label="FAQ topics" aria-orientation="vertical">${tabs}
    </div>
    <div class="cr-faq__panels">${panels}
    </div>` };
}

/** schema.org Dataset + FAQPage for one area (build-time JSON-LD of the default view). */
export function jsonld(data, templates, siteUrl) {
  const variables = [
    ['average_price', 'Average sold price', 'GBP'], ['annual_growth', 'Annual change in average sold price', 'percent'],
    ['crime_rate', 'Police recorded crimes per 1,000 residents', null], ['transport_score', 'DfT transport connectivity score (overall)', null],
  ].map(([k, name, unit]) => {
    const r = rec(data, k);
    if (!r || r.value == null) return null;
    const value = typeof r.value === 'object' ? r.value.overall : r.value;
    return { '@type': 'PropertyValue', name: `${name} (${r.period})`, value, ...(unit ? { unitText: unit } : {}) };
  }).filter(Boolean);
  const sources = [...new Set(Object.values(data.metrics || {}).filter((r) => r.value != null && r.source && r.source.url && r.status !== 'manual').map((r) => r.source.url))];
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Dataset', '@id': `${siteUrl}/#dataset`,
        name: `${data.name} property market and neighbourhood statistics`,
        description: `House prices, crime, schools, transport, air quality, conservation and mining data for ${data.name}, refreshed automatically from official open data.`,
        creator: { '@id': `${siteUrl}/#org` }, spatialCoverage: { '@type': 'Place', name: `${data.name}, ${data.county}` },
        dateModified: data.updated, isAccessibleForFree: true, license: 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/',
        distribution: { '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${siteUrl}/data/areas/${data.id}.json` },
        isBasedOn: sources, variableMeasured: variables,
      },
      {
        '@type': 'FAQPage', '@id': `${siteUrl}/#faq`,
        mainEntity: faqItems(data, templates).flatMap((x) => x.qa.map((qa) => ({ '@type': 'Question', name: qa.q, acceptedAnswer: { '@type': 'Answer', text: qa.a } }))),
      },
    ],
  };
}

export { scorecard, tokens, caption, val, rec, gbp, num, pct, signed };
