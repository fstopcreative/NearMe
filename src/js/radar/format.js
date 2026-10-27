/*
 * Corelain Near Me — formatting + metric access.
 * Pure functions (no DOM): used in the browser and by the build-time prerender
 * in vite.config.js, so the default page and a live ?area= view render alike.
 */
export const DASH = '—';

export const esc = (t) =>
  String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const nf = (dp = 0) => new Intl.NumberFormat('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const gbp = (v) => (v == null ? DASH : '£' + nf(0).format(v));
export const num = (v, dp = 0) => (v == null ? DASH : nf(dp).format(v));
export const pct = (v, dp = 1) => (v == null ? DASH : nf(dp).format(v) + '%');
export const signed = (v, dp = 1, unit = '%') => (v == null ? DASH : (v > 0 ? '+' : v < 0 ? '−' : '') + nf(dp).format(Math.abs(v)) + unit);
export const dateLong = (iso) => {
  if (!iso) return DASH;
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00Z' : ''));
  return isNaN(d) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

/** Metric record or null. A record with no value (disabled, missing key, no data) counts as missing. */
export const rec = (data, key) => (data && data.metrics && data.metrics[key]) || null;
export const val = (data, key) => {
  const r = rec(data, key);
  return r && r.value != null ? r.value : null;
};

const STATUS_TEXT = {
  'no-data': 'No data for this area yet',
  disabled: 'No source available',
  'missing-key': 'No source available',
  unavailable: 'No source available',
  error: 'Source temporarily unavailable',
};
/** One-line source caption: "HM Land Registry · 12 months to 31 Jul 2026" or why there is no value. */
export function caption(data, key, { short } = {}) {
  const r = rec(data, key);
  if (!r) return STATUS_TEXT['no-data'];
  if (r.value == null) return r.display || STATUS_TEXT[r.status] || STATUS_TEXT['no-data'];
  const name = r.source && r.source.name ? (short ? r.source.name.split(/ [—(]/)[0] : r.source.name) : '';
  const bits = [name, r.period].filter(Boolean);
  if (r.status === 'low-confidence') bits.push('low confidence');
  return bits.join(' · ');
}

/** Flat token map used by data-m bindings and the FAQ templates. Missing → absent. */
export function tokens(data) {
  const t = {};
  if (!data) return t;
  const put = (k, v) => { if (v != null && v !== DASH && v !== '') t[k] = v; };
  put('area', data.name);
  put('postcode', data.postcode);
  put('borough', data.borough);

  const ap = rec(data, 'average_price');
  if (ap && ap.value != null) {
    put('average_price', gbp(ap.value));
    put('average_price_period', ap.period && ap.period.replace(/^12 months/, 'the 12 months'));
    put('sales_12m', num(ap.sample));
  }
  const g = rec(data, 'annual_growth');
  if (g && g.value != null) {
    put('annual_growth', signed(g.value));
    put('growth_word', g.value >= 0 ? 'rose' : 'fell');
    put('growth_abs', pct(Math.abs(g.value)));
  }
  const uk = val(data, 'hpi_uk');
  const ukr = rec(data, 'hpi_uk');
  if (uk) { put('uk_growth', signed(uk.growth)); put('uk_period', ukr.period); put('uk_average', gbp(uk.average)); }
  const hb = val(data, 'hpi_borough');
  if (hb) { put('borough_hpi_growth', signed(hb.growth)); put('borough_hpi_average', gbp(hb.average)); }

  const trend = val(data, 'price_trend');
  if (trend && trend.length > 1) {
    const a = trend[0], b = trend[trend.length - 1];
    put('trend_from', gbp(a.average)); put('trend_to', gbp(b.average));
    put('trend_years', `${a.year}–${b.year}`);
    put('trend_change', pct(((b.average - a.average) / a.average) * 100, 0));
  }
  const types = val(data, 'price_by_type');
  if (types) {
    const parts = [['detached', 'detached homes'], ['semi', 'semi-detached homes'], ['terraced', 'terraced homes'], ['flat', 'flats']]
      .filter(([k]) => types[k] && types[k].average_3y != null)
      .map(([k, label]) => `${label} ${gbp(types[k].average_3y)} (${num(types[k].sales_3y)} sales)`);
    if (parts.length) put('type_list', listJoin(parts));
  }
  const rent = rec(data, 'average_rent');
  if (rent && rent.value && rent.value.monthly) {
    put('rent', gbp(rent.value.monthly));
    put('rent_period', rent.period && rent.period.replace(/ \(provisional\)$/, ''));
    put('rent_geo', rent.geography && rent.geography.replace(/ \(local authority\)$/, ''));
    if (rent.value.change_12m != null) put('rent_change', signed(rent.value.change_12m));
    const b = rent.value.by_beds || {};
    const beds = [['one', 'one-bed'], ['two', 'two-bed'], ['three', 'three-bed'], ['four_plus', 'four-plus-bed']].filter(([k]) => b[k]).map(([k, l]) => `${l} ${gbp(b[k])}`);
    if (beds.length) put('rent_beds', listJoin(beds));
  }
  const ten = val(data, 'tenure');
  if (ten) {
    put('own_pct', pct(ten.own_pct, 0)); put('rent_pct', pct(ten.rent_pct, 0));
    put('private_pct', pct(ten.private_pct, 0)); put('social_pct', pct(ten.social_pct, 0));
    put('households', num(ten.households));
  }
  const popn = val(data, 'population');
  if (popn) {
    put('residents', num(popn.residents)); put('household_size', num(popn.household_size, 2));
    const g = Object.fromEntries(popn.age.map((x) => [x.key, x]));
    if (g['0_14'] && g['65']) { put('under15_pct', pct(g['0_14'].pct, 0)); put('over65_pct', pct(g['65'].pct, 0)); }
  }
  const pay = rec(data, 'earnings');
  if (pay && pay.value && pay.value.annual) {
    put('pay', gbp(pay.value.annual)); put('pay_year', (pay.period || '').slice(0, 4));
    const ap = val(data, 'average_price');
    if (ap) put('price_to_pay', num(ap / pay.value.annual, 1));
    const cmp = pay.value.comparison || {};
    if (cmp.England) put('pay_england', gbp(cmp.England));
  }
  const rt = val(data, 'routes');
  if (rt) {
    if (rt.trams.length) put('tram_lines', listJoin(rt.trams.map((x) => `the ${x.line} (${x.from} – ${x.to})`)));
    const bus = rt.buses.filter((b) => !b.school).slice(0, 4);
    if (bus.length) put('bus_list', listJoin(bus.map((b) => `the ${b.number} (${b.from} – ${b.to})`)));
    const lines = rt.rail.filter((x) => x.lines.length).slice(0, 2);
    if (lines.length) put('rail_lines', listJoin(lines.map((x) => `${x.name} (${x.lines.map((l) => `${l.from} – ${l.to}`).join(', ')})`)));
  }

  const cr = rec(data, 'crime_rate');
  if (cr && cr.value != null) {
    put('crime_rate', num(cr.value, 1));
    put('crime_period', cr.period);
    put('crime_geo', cr.geography && cr.geography.replace(/ \(borough-wide\)$/, ''));
    const ew = cr.comparison && cr.comparison['England and Wales'];
    if (ew != null) {
      put('crime_ew', num(ew, 1));
      const diff = ((cr.value - ew) / ew) * 100;
      put('crime_vs_ew', `${pct(Math.abs(diff), 0)} ${diff <= 0 ? 'lower' : 'higher'}`);
    }
    const man = cr.comparison && cr.comparison.Manchester;
    if (man != null) put('crime_manchester', num(man, 1));
  }
  const groups = val(data, 'crime_groups');
  if (groups) {
    const v = groups.find((x) => x.key === 'violence');
    if (v) { put('violence_rate', num(v.rate, 1)); put('violence_ew', num(v.england_wales, 1)); }
  }

  const sc = val(data, 'schools');
  const scr = rec(data, 'schools');
  if (sc) {
    if (sc.score != null) put('school_score', num(sc.score, 1));
    put('schools_period', scr.period);
    const m = sc.mix || {};
    put('school_mix', listJoin([
      m.outstanding && `${m.outstanding} Outstanding`, m.good && `${m.good} Good`,
      m.report && `${m.report} with a new report card`, m.below && `${m.below} below Good`,
      m.none && `${m.none} with no overall grade`].filter(Boolean)));
    put('schools_count', num(sc.schools));
    if (sc.nearest && sc.nearest.length) {
      put('school_list', listJoin(sc.nearest.slice(0, 3).map((s) => `${s.name} (${s.phase.toLowerCase()}, ${s.grade}, about ${num(s.distance_mi, 1)} miles)`)));
    }
  }

  const tr = val(data, 'transport_score');
  if (tr) {
    put('transport_score', num(tr.overall, 0));
    put('transport_pt', num(tr.public_transport, 0));
    put('transport_walk', num(tr.walking, 0));
    put('transport_period', rec(data, 'transport_score').period);
  }
  const j = val(data, 'journey');
  if (j && j.legs) {
    put('journey_total', num(j.legs.reduce((s, l) => s + l.minutes, 0)));
    put('journey_text', j.legs.map((l) => `${l.detail.toLowerCase()} (about ${l.minutes} minutes)`).join(', then '));
    if (j.note) put('journey_note', j.note);
  }

  const fl = val(data, 'flood_risk');
  if (fl) {
    put('flood_overall', fl.overall.toLowerCase());
    const lv = Object.fromEntries((fl.levels || []).map((l) => [l.key, l.level]));
    const word = (n) => ['', 'very low', 'low', 'medium', 'high'][n] || null;
    if (lv.rivers_sea && lv.surface_water) put('flood_detail', `rivers and the sea ${word(lv.rivers_sea)}, surface water ${word(lv.surface_water)}${lv.groundwater ? `, groundwater ${word(lv.groundwater)}` : ''}`);
  }
  const fz = val(data, 'flood_zones');
  if (fz && !fl) {
    if (fz.borough) {
      put('flood_zone_text', fz.zone3_nearby ? `Parts of ${data.name}, mainly along its rivers and canals, are in Flood Zone 3 (high probability of flooding from rivers and the sea); most of the borough is in Flood Zone 1` : `${data.name} is mostly in Flood Zone 1 (low probability)`);
    } else {
      put('flood_zone_text', `The centre of ${data.name} is in Flood Zone ${fz.centre_zone} (${['', 'low', 'medium', 'high'][fz.centre_zone]} probability of flooding from rivers and the sea), and ${fz.zone3_nearby ? 'some' : 'no'} Zone 3 land lies within ${fz.radius_km} km`);
    }
  }
  const rd = val(data, 'radon');
  if (rd) { put('radon_class', `${rd.class} of ${rd.of}`); put('radon_share', rd.share); }
  const coal = val(data, 'coal_mining');
  if (coal) {
    put('coal_text', coal.level === 'high'
      ? 'is in a Development High Risk Area, where past coal mining may affect the ground'
      : coal.level === 'low'
        ? (coal.partial ? 'is partly within the coal mining reporting area (development low risk)' : 'is within the coal mining reporting area, but outside the Development High Risk Area')
        : 'is outside the coal mining reporting area');
  }

  const aq = val(data, 'air_quality');
  if (aq && aq.no2 != null) {
    put('no2', num(aq.no2, 1)); put('pm25', num(aq.pm25, 1)); put('pm10', num(aq.pm10, 1));
    put('air_period', rec(data, 'air_quality').period);
  }
  const aq0 = val(data, 'aqma');
  const aqma = aq0 ? { inside: aq0.inside || [], nearby: aq0.nearby || [] } : null;
  if (aqma) {
    put('aqma_status', aqma.inside.length ? `The centre of ${data.name} lies inside the ${listJoin(aqma.inside)}`
      : aqma.nearby.length ? `${data.name} is near the ${listJoin(aqma.nearby.map((x) => x.name))}` : `There is no air quality management area within 1.5 km of ${data.name}`);
  }
  const road = val(data, 'aqma_roadside');
  if (road && road.roadside_no2 != null) { put('aqma_name', road.name); put('aqma_no2', num(road.roadside_no2)); }

  const ca = val(data, 'conservation_areas');
  if (ca) {
    put('ca_count', num(ca.count));
    if (ca.centre_inside && ca.centre_inside.length) put('ca_inside', listJoin(ca.centre_inside.map((n) => `${n} Conservation Area`)));
    const near = (ca.nearby || []).filter((c) => !(ca.centre_inside || []).includes(c.name)).slice(0, 3);
    if (near.length) put('ca_nearby', listJoin(near.map((c) => `${c.name}${c.designated ? ` (designated ${c.designated.slice(0, 4)})` : ''}`)));
    put('ca_status', ca.centre_inside && ca.centre_inside.length ? `The centre of ${data.name} lies in the ${listJoin(ca.centre_inside)} Conservation Area` : `The centre of ${data.name} is outside a conservation area`);
  }

  const bf = val(data, 'development_sites');
  if (bf) { put('brownfield_count', num(bf.count)); put('brownfield_homes', num(bf.homes)); put('brownfield_permissioned', num(bf.permissioned)); }
  const pc = rec(data, 'planning_constraints');
  if (pc && pc.listed) {
    put('listed_total', num(pc.listed.total));
    put('listed_grades', listJoin([pc.listed.I && `${pc.listed.I} Grade I`, pc.listed['II*'] && `${pc.listed['II*']} Grade II*`, pc.listed.II && `${pc.listed.II} Grade II`].filter(Boolean)) || 'none');
    if (pc.listed.notable && pc.listed.notable.length) put('listed_notable', listJoin(pc.listed.notable.map((x) => `${x.name} (Grade ${x.grade})`)));
    put('green_belt', pc.green_belt ? (data.kind === 'borough' ? 'Yes — parts of the borough are Green Belt' : `Yes — the centre of ${data.name} is in the Green Belt`) : `No — the centre of ${data.name} is not in the Green Belt`);
    put('article4', num(pc.article4));
    put('planning_scope', pc.geography);
  }
  const ns = val(data, 'nearest_stops');
  if (ns) {
    if (ns.metro) put('metro_stop', `${ns.metro.name} (${num(ns.metro.distance_mi, 1)} miles${ns.metro.walk_min <= 40 ? `, about ${ns.metro.walk_min} minutes on foot` : ''})`);
    if (ns.rail) put('rail_station', `${ns.rail.name} (${num(ns.rail.distance_mi, 1)} miles)`);
    put('bus_stops', num(ns.bus_stops_400m));
    put('city_centre_mi', num(ns.city_centre_mi, 1));
  }
  const dev = val(data, 'developments');
  if (dev && dev.schemes && dev.schemes.length) put('dev_list', listJoin(dev.schemes.map((s) => s.name)));
  const pl = val(data, 'places');
  if (pl && pl.length) put('place_list', listJoin(pl.slice(0, 4).map((p) => `${p.name} (${p.type.toLowerCase()})`)));
  return t;
}

export function listJoin(items) {
  const a = items.filter(Boolean);
  return a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
}

/** Fill "{token}" placeholders; returns null when any token is missing (the item is then left out). */
export function fill(tpl, t) {
  let missing = false;
  const out = tpl.replace(/\{([a-z0-9_]+)\}/g, (_, k) => {
    if (t[k] == null) { missing = true; return ''; }
    return t[k];
  });
  return missing ? null : out;
}

/**
 * Indicative 0–100 scores for the Area Scorecard (higher is better). Each axis
 * appears only when its source has data; the method is shown on the card.
 */
export function scorecard(data) {
  const axes = [];
  const cr = rec(data, 'crime_rate');
  const ew = cr && cr.comparison && cr.comparison['England and Wales'];
  if (cr && cr.value != null && ew) axes.push(['Safety', clamp(100 - (cr.value / ew) * 50)]);
  const sc = val(data, 'schools');
  if (sc && sc.score != null) axes.push(['Schools', clamp(sc.score * 10)]);
  const tr = val(data, 'transport_score');
  if (tr && tr.overall != null) axes.push(['Transport', clamp(tr.overall)]);
  const aq = val(data, 'air_quality');
  if (aq && aq.no2 != null && aq.pm25 != null) axes.push(['Air quality', clamp(100 - ((aq.no2 / 40 + aq.pm25 / 20) / 2) * 100)]);
  const fl = val(data, 'flood_risk');
  const fz = val(data, 'flood_zones');
  if (fl && fl.levels) {
    const worst = Math.max(...fl.levels.map((l) => l.level || 0));
    if (worst) axes.push(['Flood safety', [0, 95, 80, 50, 20][worst]]);
  } else if (fz && !fz.borough) {
    axes.push(['Flood safety', [0, 90, 55, 25][fz.centre_zone] - (fz.zone3_nearby ? 5 : 0)]);
  }
  const coal = val(data, 'coal_mining');
  if (coal) axes.push(['Ground', coal.level === 'high' ? 30 : coal.level === 'low' ? 75 : 90]);
  const overall = axes.length >= 3 ? Math.round(axes.reduce((s, a) => s + a[1], 0) / axes.length) : null;
  return { axes, overall };
}
const clamp = (v) => Math.round(Math.max(0, Math.min(100, v)));
