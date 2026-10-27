/*
 * Corelain — Area Radar dashboard (dashboards/area-radar).
 *
 * Loads /data/areas/<area>.json (built by scripts/data/run.py from official
 * sources), fills the page through src/js/radar/apply.js and draws the charts
 * from the same data. Nothing on the page is hard-coded: a metric without data
 * shows "—". Browser-side live data: the European AQI gauge (Open-Meteo) and
 * Environment Agency flood warnings — both free, keyless, centred on the area.
 */
import { renderChart } from '../plugins/charts.js';
import { currentArea, areaTrail, partyWallHref } from '../data/areas.js';
import { REVIEWS } from '../data/reviews.js';
import { initTracking } from './track.js';
import { loadArea } from '../radar/load.js';
import { apply, wireFaq } from '../radar/apply.js';
import { val, rec, scorecard, gbp, num } from '../radar/format.js';

const cv = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let DATA = null;

function destroy(el) {
  if (el && el._axChart) {
    try { el._axChart.instance.destroy(); } catch {}
    el._axChart.ro && el._axChart.ro.disconnect();
    el._axChart = null;
  }
  if (el) el.innerHTML = '';
}

// Shared bar-chart look (horizontal, one colour per bar, value labels at the end)
const hbar = (cats, colors, { fmt = (v) => num(v, 1), max, height } = {}) => ({
  height: height || Math.max(200, 60 + cats.length * 42), legend: 'none',
  apex: {
    colors,
    plotOptions: { bar: { horizontal: true, distributed: true, borderRadius: 5, borderRadiusApplication: 'end', barHeight: '52%', dataLabels: { position: 'top' } } },
    dataLabels: { enabled: true, offsetX: 34, textAnchor: 'start', formatter: fmt, style: { fontFamily: cv('--ax-font-display'), fontSize: '13px', fontWeight: 700, colors: [cv('--ax-text-strong')] } },
    xaxis: { categories: cats, min: 0, ...(max != null ? { max } : {}), labels: { show: false }, axisBorder: { show: false } },
    yaxis: { labels: { style: { fontFamily: cv('--ax-font-sans'), fontSize: '12px' }, maxWidth: 220 } },
    grid: { xaxis: { lines: { show: true } }, yaxis: { lines: { show: false } }, padding: { right: 48, left: 4 } },
    tooltip: { y: { formatter: fmt, title: { formatter: () => '' } } },
    states: { hover: { filter: { type: 'darken', value: 0.9 } } },
  },
});

// ── Area Charts card: every chart in one place, picked with the filter chips ──
const FLOOD_LEVELS = ['', 'Very low', 'Low', 'Medium', 'High'];
const FLOOD_TONES = ['', '--ax-viz-emerald', '--ax-accent', '--ax-viz-amber', '--ax-danger-500'];
const SCHOOL_KEYS = [['outstanding', 'Outstanding', '--ax-success-500'], ['good', 'Good', '--ax-info-500'], ['report', 'Report card', '--ax-accent'],
  ['below', 'Below Good', '--ax-warning-500'], ['none', 'No grade', '--ax-neutral-400']];
const TYPE_LABELS = { detached: 'Detached', semi: 'Semi-detached', terraced: 'Terraced', flat: 'Flat' };

function trendSeries() {
  const s = val(DATA, 'price_trend') || [];
  const growth = s.map((p, i) => (i === 0 ? null : +(((p.average - s[i - 1].average) / s[i - 1].average) * 100).toFixed(1)));
  return { s, growth };
}

const VIEWS = {
  value: {
    title: 'Property Value Trend',
    sub: (d) => (val(d, 'price_trend') ? `Average sold price vs. annual growth — ${rec(d, 'price_trend').period}` : 'No yearly sales series for this area yet'),
    note: (d) => `${rec(d, 'price_trend')?.source?.name?.startsWith('UK House') ? 'UK HPI mix-adjusted averages' : 'Raw average; it moves with the mix of homes sold'}. ${rec(d, 'price_trend')?.geography || ''} · Source: ${rec(d, 'price_trend')?.source?.name || '—'}.`,
    ok: (d) => (val(d, 'price_trend') || []).length > 1,
    draw(el) {
      const { s, growth } = trendSeries();
      const avgs = s.map((p) => p.average);
      const step = Math.max(...avgs) > 600000 ? 100000 : 50000;
      const lo = Math.floor(Math.min(...avgs) * 0.9 / step) * step;
      const hi = Math.ceil(Math.max(...avgs) * 1.05 / step) * step;
      const gs = growth.filter((g) => g != null);
      const gLo = Math.min(-5, Math.floor(Math.min(...gs) / 5) * 5);
      const gHi = Math.max(10, Math.ceil(Math.max(...gs) / 5) * 5);
      return [`Line chart of the yearly average sold price from ${gbp(avgs[0])} in ${s[0].year} to ${gbp(avgs[avgs.length - 1])} in ${s[s.length - 1].year}, with annual growth columns`,
        renderChart(el, 'line', [{ name: 'Average value', type: 'line', data: avgs }, { name: 'Annual growth', type: 'column', data: growth }], {
          height: 330, legend: 'top',
          apex: {
            colors: [cv('--ax-accent'), cv('--ax-viz-cyan')],
            stroke: { width: [2.5, 0], curve: 'smooth' },
            plotOptions: { bar: { borderRadius: 4, columnWidth: '42%' } },
            xaxis: { categories: s.map((p) => String(p.year)) },
            yaxis: [
              { min: lo, max: hi, tickAmount: Math.min(8, (hi - lo) / step), labels: { formatter: (v) => '£' + Math.round(v / 1000) + 'K' } },
              { opposite: true, min: gLo, max: gHi, tickAmount: (gHi - gLo) / 5 > 8 ? 4 : (gHi - gLo) / 5, labels: { formatter: (v) => Math.round(v) + '%' } },
            ],
            tooltip: { shared: true, intersect: false, y: { formatter: (v, { seriesIndex }) => (v == null ? '—' : seriesIndex === 0 ? gbp(v) : v + '%') } },
          },
        })];
    },
  },
  types: {
    title: 'Prices by Property Type',
    sub: (d) => (rec(d, 'price_by_type')?.hpi ? `UK HPI average by type · ${rec(d, 'price_by_type').period}` : `Average sold price by type, last 3 years · ${(rec(d, 'price_by_type')?.period || '').replace(/^3 years and 12 months to /, 'to ')}`),
    note: (d) => (rec(d, 'price_by_type')?.hpi ? `Annual change by type in the tooltip. Source: UK House Price Index.`
      : 'Bars: 3-year average; the tooltip adds the number of sales. Types with fewer than 5 sales are left out. Source: HM Land Registry Price Paid Data.'),
    ok: (d) => Object.values(val(d, 'price_by_type') || {}).some((x) => (x.average_3y ?? x.average) != null),
    draw(el) {
      const t = val(DATA, 'price_by_type');
      const rows = Object.entries(TYPE_LABELS).map(([k, l]) => [l, t[k] || {}]).filter(([, x]) => (x.average_3y ?? x.average) != null);
      const colors = ['--ax-accent', '--ax-viz-violet', '--ax-viz-cyan', '--ax-viz-amber'].map(cv);
      const o = hbar(rows.map((r) => r[0]), colors, { fmt: gbp });
      o.apex.tooltip = { y: { formatter: (v, { dataPointIndex }) => { const x = rows[dataPointIndex][1]; return x.sales_3y != null ? `${gbp(v)} · ${num(x.sales_3y)} sales` : `${gbp(v)} · ${x.growth != null ? (x.growth > 0 ? '+' : '') + x.growth + '% a year' : ''}`; }, title: { formatter: () => '' } } };
      return ['Bar chart of average price by property type', renderChart(el, 'bar', [{ name: 'Average price', data: rows.map(([, x]) => x.average_3y ?? x.average) }], o)];
    },
  },
  rent: {
    title: 'Average Rent Trend',
    sub: (d) => `Average monthly private rent · ${rec(d, 'average_rent')?.geography || ''}`,
    note: (d) => `ONS Price Index of Private Rents, ${rec(d, 'average_rent')?.period || ''}. Local authority is the smallest area published.`,
    ok: (d) => (val(d, 'average_rent')?.trend || []).length > 1,
    draw(el) {
      const r = val(DATA, 'average_rent');
      const mon = (m) => new Date(m + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
      return [`Line chart of the average monthly rent, now ${gbp(r.monthly)}`, renderChart(el, 'area', [{ name: 'Average rent', data: r.trend.map((t) => t.rent) }], {
        height: 330, legend: 'none', color: '--ax-viz-violet',
        apex: {
          xaxis: { categories: r.trend.map((t) => mon(t.month)), tickAmount: 10, labels: { rotate: 0, hideOverlappingLabels: true } },
          yaxis: { labels: { formatter: (v) => '£' + num(v) } },
          tooltip: { y: { formatter: (v) => `${gbp(v)} a month` } },
        },
      })];
    },
  },
  'rent-beds': {
    title: 'Rent by Bedrooms & Type',
    sub: (d) => `Average monthly private rent · ${rec(d, 'average_rent')?.period || ''}`,
    note: () => 'ONS Price Index of Private Rents. Grey bars: the region and England, all homes, for comparison.',
    ok: (d) => Object.values(val(d, 'average_rent')?.by_beds || {}).some(Boolean),
    draw(el) {
      const r = val(DATA, 'average_rent');
      const rows = [['1 bed', r.by_beds.one], ['2 beds', r.by_beds.two], ['3 beds', r.by_beds.three], ['4+ beds', r.by_beds.four_plus],
        ['Detached', r.by_type.detached], ['Semi-detached', r.by_type.semi], ['Terraced', r.by_type.terraced], ['Flat', r.by_type.flat],
        ...Object.entries(r.compare || {}).map(([k, v]) => [`${k} (all)`, v])].filter(([, v]) => v);
      const colors = rows.map(([l]) => cv(/bed/.test(l) ? '--ax-viz-violet' : /\(all\)/.test(l) ? '--ax-neutral-400' : '--ax-viz-cyan'));
      return ['Bar chart of average rent by bedrooms and property type', renderChart(el, 'bar', [{ name: 'Rent a month', data: rows.map((x) => x[1]) }], hbar(rows.map((x) => x[0]), colors, { fmt: gbp }))];
    },
  },
  tenure: {
    title: 'Renting Compared with Owning',
    sub: (d) => `Share of households by tenure · Census 2021 · ${rec(d, 'tenure')?.geography || ''}`,
    note: () => 'Own = owned outright, with a mortgage or shared ownership. Source: ONS Census 2021 (TS054), as in “How life has changed: Census 2021”.',
    ok: (d) => !!val(d, 'tenure'),
    draw(el) {
      const t = val(DATA, 'tenure');
      const cmp = rec(DATA, 'tenure').comparison || {};
      const places = [[DATA.name, t], ...Object.entries(cmp)];
      const keys = [['Own', 'own_pct', '--ax-viz-emerald'], ['Private rent', 'private_pct', '--ax-viz-amber'], ['Social rent', 'social_pct', '--ax-viz-violet']];
      return ['Stacked bar chart of households that own, rent privately or rent socially', renderChart(el, 'bar', keys.map(([n, k]) => ({ name: n, data: places.map(([, v]) => v[k]) })), {
        height: 90 + places.length * 56, legend: 'top', stacked: true,
        apex: {
          colors: keys.map((k) => cv(k[2])),
          plotOptions: { bar: { horizontal: true, barHeight: '55%', borderRadius: 4, borderRadiusWhenStacked: 'last' } },
          dataLabels: { enabled: true, formatter: (v) => (v >= 6 ? Math.round(v) + '%' : ''), style: { fontSize: '12px', fontWeight: 600, colors: ['#fff'] } },
          xaxis: { categories: places.map((p) => p[0]), max: 100, labels: { formatter: (v) => Math.round(v) + '%' } },
          tooltip: { y: { formatter: (v) => `${num(v, 1)}%` } },
        },
      })];
    },
  },
  age: {
    title: 'Age Profile',
    sub: (d) => `Share of residents by age · Census 2021 · ${rec(d, 'population')?.geography || ''}`,
    note: () => 'Source: ONS Census 2021 (TS007A) via Nomis; see Trafford Data Lab for the full population & households profile.',
    ok: (d) => !!val(d, 'population'),
    draw(el) {
      const p = val(DATA, 'population');
      const cmp = rec(DATA, 'population').comparison || {};
      const series = [{ name: DATA.name, data: p.age.map((g) => g.pct) }, ...Object.entries(cmp).map(([k, v]) => ({ name: k, data: p.age.map((g) => v[g.key]) }))];
      return ['Column chart of residents by age group', renderChart(el, 'bar', series, {
        height: 330, legend: 'top',
        apex: {
          colors: [cv('--ax-viz-cyan'), cv('--ax-viz-violet'), cv('--ax-neutral-400')],
          plotOptions: { bar: { columnWidth: '62%', borderRadius: 4 } },
          xaxis: { categories: p.age.map((g) => g.label) },
          yaxis: { labels: { formatter: (v) => Math.round(v) + '%' } },
          tooltip: { shared: true, intersect: false, y: { formatter: (v) => (v == null ? '—' : `${num(v, 1)}%`) } },
        },
      })];
    },
  },
  pay: {
    title: 'Average Pay',
    sub: (d) => `Median gross annual pay, full-time · ${rec(d, 'earnings')?.period || ''}`,
    note: (d) => `${rec(d, 'earnings')?.geography || ''}. Source: ONS Annual Survey of Hours and Earnings (resident analysis).`,
    ok: (d) => !!val(d, 'earnings'),
    draw(el) {
      const p = val(DATA, 'earnings');
      const rows = [[DATA.kind === 'region' ? DATA.name : DATA.borough, p.annual], ...Object.entries(p.comparison || {})];
      return ['Bar chart of median annual pay', renderChart(el, 'bar', [{ name: 'Median pay', data: rows.map((r) => r[1]) }],
        hbar(rows.map((r) => r[0]), [cv('--ax-accent'), cv('--ax-viz-violet'), cv('--ax-neutral-400')], { fmt: gbp }))];
    },
  },
  crime: {
    title: 'Crime Rate Compared',
    sub: (d) => `Crimes per 1,000 residents · ${rec(d, 'crime_rate')?.period || ''}`,
    note: () => 'Police recorded crime excluding fraud. Greater Manchester Police publishes no street-level data, so figures are borough-wide.',
    ok: (d) => val(d, 'crime_rate') != null,
    draw(el) {
      const cr = rec(DATA, 'crime_rate');
      const own = DATA.kind === 'region' ? DATA.name : (cr.geography || 'Borough').split(' Community')[0];
      const rows = [[own, cr.value, '--ax-accent'], ...Object.entries(cr.comparison || {}).map(([k, v]) => [k === 'England and Wales' ? 'England & Wales' : k, v, k === 'England and Wales' ? '--ax-viz-violet' : '--ax-viz-amber'])];
      return ['Bar chart comparing crimes per 1,000 residents', renderChart(el, 'bar', [{ name: 'Crimes / 1,000', data: rows.map((r) => r[1]) }],
        hbar(rows.map((r) => r[0]), rows.map((r) => cv(r[2])), { fmt: (v) => num(v, 1) }))];
    },
  },
  schools: {
    title: 'Ofsted Outcomes',
    sub: (d) => `${rec(d, 'schools')?.geography || ''} · ${rec(d, 'schools')?.period || ''}`,
    note: () => 'Inspections since Sep 2024 have no one-word grade; since Nov 2025 they use report cards. Source: Ofsted management information.',
    ok: (d) => Object.values(val(d, 'schools')?.mix || {}).some(Boolean),
    draw(el) {
      const m = val(DATA, 'schools').mix;
      const mix = SCHOOL_KEYS.filter(([k]) => m[k]);
      const total = mix.reduce((s, [k]) => s + m[k], 0);
      return ['Donut chart of Ofsted outcomes', renderChart(el, 'donut', mix.map(([k]) => m[k]), {
        height: 330, legend: 'right',
        apex: {
          colors: mix.map((x) => cv(x[2])), labels: mix.map((x) => x[1]),
          stroke: { width: 2, colors: ['transparent'] }, dataLabels: { enabled: false },
          plotOptions: { pie: { donut: { size: '66%', labels: { show: true,
            value: { fontFamily: cv('--ax-font-display'), fontSize: '26px', fontWeight: 700, color: cv('--ax-text-strong') },
            total: { show: true, showAlways: true, label: 'schools', color: cv('--ax-text-muted'), formatter: () => String(total) } } } } },
          tooltip: { y: { formatter: (v) => `${v} school${v === 1 ? '' : 's'}` } },
        },
      })];
    },
  },
  flood: {
    title: 'Flood Risk',
    sub: (d) => (val(d, 'flood_risk') ? 'Environment Agency long-term risk by source' : `Flood zones · ${rec(d, 'flood_zones')?.geography || ''}`),
    note: () => 'Rivers & sea from the EA flood map for planning; surface water varies street by street — check the address.',
    ok: (d) => !!(val(d, 'flood_risk')?.levels?.some((l) => l.level) || val(d, 'flood_zones')),
    draw(el) {
      const f = val(DATA, 'flood_risk');
      if (f) {
        const fd = f.levels.filter((l) => l.level);
        return ['Bar chart of flood risk by source', renderChart(el, 'bar', [{ name: 'Risk level', data: fd.map((x) => x.level) }],
          { ...hbar(fd.map((x) => x.label), fd.map((x) => cv(FLOOD_TONES[x.level])), { fmt: (v) => FLOOD_LEVELS[v], max: 4.6 }) })];
      }
      const z = val(DATA, 'flood_zones');
      const rows = [['Zone 3 land (high)', z.zone3_nearby, '--ax-danger-500'], ['Zone 2 land (medium)', z.zone2_nearby, '--ax-viz-amber']];
      return ['Bar chart of flood zone areas nearby', renderChart(el, 'bar', [{ name: 'Flood zone areas', data: rows.map((r) => r[1]) }],
        hbar(rows.map((r) => r[0]), rows.map((r) => cv(r[2])), { fmt: (v) => `${num(v)} area${v === 1 ? '' : 's'}` }))];
    },
  },
  journey: {
    title: 'Journey to the City Centre',
    sub: (d) => `Door to Manchester city centre · ≈${num((val(d, 'journey')?.legs || []).reduce((s, l) => s + l.minutes, 0))} min`,
    note: (d) => val(d, 'journey')?.note || 'TfGM timetables, checked by hand.',
    ok: (d) => (val(d, 'journey')?.legs || []).length > 0,
    draw(el) {
      const legs = val(DATA, 'journey').legs;
      const total = legs.reduce((s, l) => s + l.minutes, 0);
      return ['Stacked bar of the journey to Manchester city centre', renderChart(el, 'bar', legs.map((l) => ({ name: l.detail, data: [l.minutes] })), {
        height: 200, legend: 'bottom', stacked: true,
        apex: {
          colors: legs.map((_, i) => cv(['--ax-viz-violet', '--ax-viz-cyan', '--ax-viz-amber'][i % 3])),
          plotOptions: { bar: { horizontal: true, barHeight: '45%', borderRadius: 5, borderRadiusWhenStacked: 'all' } },
          stroke: { width: 2, colors: [cv('--ax-surface-raised') || '#fff'] },
          dataLabels: { enabled: true, formatter: (v, { seriesIndex }) => `${legs[seriesIndex].label} ${v} min`, style: { fontSize: '12px', fontWeight: 600, colors: ['#fff'] } },
          xaxis: { categories: ['Door → city'], min: 0, max: Math.ceil(total / 5) * 5, labels: { formatter: (v) => `${Math.round(v)}′` } },
          yaxis: { labels: { show: false } },
          tooltip: { y: { formatter: (v) => `≈${v} min` } },
        },
      })];
    },
  },
  scorecard: {
    title: 'Area Scorecard',
    sub: () => 'Indicative scores from the data on this page (higher is better)',
    note: () => 'Derived from the data on this page, not an official score. An axis is left out when its source has no data.',
    ok: (d) => scorecard(d).axes.length >= 3,
    draw(el) {
      const sc = scorecard(DATA);
      return ['Radar chart of indicative area scores: ' + sc.axes.map(([k, v]) => `${k.toLowerCase()} ${v}`).join(', '),
        renderChart(el, 'radar', [{ name: 'Score', data: sc.axes.map((a) => a[1]) }], {
          height: 330, legend: 'none', accent: true,
          apex: {
            xaxis: { categories: sc.axes.map((a) => a[0]), labels: { style: { colors: Array(sc.axes.length).fill(cv('--ax-text-muted')), fontFamily: cv('--ax-font-sans') } } },
            yaxis: { show: false, max: 100, min: 0 },
            stroke: { width: 2 }, fill: { opacity: 0.18 }, markers: { size: 3 },
            plotOptions: { radar: { polygons: { strokeColors: cv('--ax-border'), connectorColors: cv('--ax-border'), fill: { colors: ['transparent'] } } } },
          },
        })];
    },
  },
};

let chartView = 'value';
function drawChart(name) {
  const card = document.querySelector('[data-cr-charts]');
  const host = document.getElementById('cr-chart-main');
  if (!card || !host || !DATA) return;
  const view = VIEWS[name];
  chartView = name;
  card.querySelectorAll('[data-chart]').forEach((b) => {
    const on = b.dataset.chart === name;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-checked', String(on));
  });
  card.querySelector('[data-cr-chart-title]').textContent = view.title;
  const sub = card.querySelector('[data-cr-chart-sub]');
  sub.textContent = view.sub(DATA);
  card.querySelector('[data-cr-chart-note]').textContent = view.note(DATA);
  [...host.children].forEach(destroy);
  host.innerHTML = '';
  const el = document.createElement('div');          // a fresh node per draw: a slow render never lands on the next view
  host.appendChild(el);
  const [label] = view.draw(el);
  host.setAttribute('aria-label', label);
}

function initChartCard() {
  const card = document.querySelector('[data-cr-charts]');
  if (!card) return;
  const chips = [...card.querySelectorAll('[data-chart]')];
  chips.forEach((b) => (b.hidden = !VIEWS[b.dataset.chart].ok(DATA)));
  card.querySelectorAll('.cr-chart-filter__group').forEach((g) => {      // hide a group label with no chips left
    let n = g.nextElementSibling, any = false;
    while (n && !n.classList.contains('cr-chart-filter__group')) { if (!n.hidden) any = true; n = n.nextElementSibling; }
    g.hidden = !any;
  });
  if (!card._crWired) {
    card._crWired = true;
    card.addEventListener('click', (e) => {
      const b = e.target.closest('[data-chart]');
      if (b) drawChart(b.dataset.chart);
    });
  }
  const first = chips.find((b) => !b.hidden);
  if (!first) { document.getElementById('cr-chart-main').innerHTML = '<p class="cr-empty">No chart data for this area yet.</p>'; return; }
  drawChart(VIEWS[chartView].ok(DATA) ? chartView : first.dataset.chart);
}

// ── News: this area / surrounding areas filter (plain JS: the chips are re-rendered per area) ──
function wireNewsFilter() {
  const card = document.querySelector('[data-cr-news]');
  if (!card || card._crWired) return;
  card._crWired = true;
  card.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-news-scope]');
    if (!chip) return;
    const scope = chip.dataset.newsScope;
    card.querySelectorAll('[data-news-scope]').forEach((b) => {
      b.classList.toggle('is-active', b === chip);
      b.setAttribute('aria-checked', String(b === chip));
    });
    card.querySelectorAll('.cr-news__item').forEach((n) => (n.hidden = scope !== 'all' && n.dataset.scope !== scope));
  });
}

// ── KPI sparklines + transport gauge (stay in their own cards) ──
function initKpis() {
  const { s, growth } = trendSeries();
  const spark = (id, data, color) => {
    const el = document.getElementById(id);
    destroy(el);
    if (el && data.length > 1) renderChart(el, 'area', [{ name: id, data }], { height: 48, sparkline: true, tooltip: false, color, apex: { yaxis: { show: false } } });
  };
  spark('cr-spark-price', s.map((p) => Math.round(p.average / 1000)), '--ax-accent');
  spark('cr-spark-growth', growth.slice(1), '--ax-viz-cyan');
  spark('cr-spark-rent', ((val(DATA, 'average_rent') || {}).trend || []).map((t) => t.rent), '--ax-viz-violet');

  const gauge = document.getElementById('cr-transport-gauge');
  destroy(gauge);
  const tr = val(DATA, 'transport_score');
  if (gauge && tr && tr.overall != null) {
    gauge.setAttribute('aria-label', `Radial gauge: transport connectivity score ${num(tr.overall)} out of 100`);
    renderChart(gauge, 'radialBar', [Math.round(tr.overall)], {
      height: 210, legend: 'none', color: '--ax-viz-cyan',
      apex: {
        plotOptions: { radialBar: {
          startAngle: -120, endAngle: 120,
          hollow: { size: '64%' },
          track: { background: cv('--ax-border') },
          dataLabels: {
            name: { show: true, fontFamily: cv('--ax-font-sans'), color: cv('--ax-text-muted'), offsetY: 22, fontSize: '12px' },
            value: { show: true, fontFamily: cv('--ax-font-mono'), color: cv('--ax-text-strong'), fontSize: '28px', fontWeight: 700, offsetY: -12, formatter: (v) => v },
          },
        } },
        labels: ['out of 100'],
      },
    });
  }
}

// ── Selected area (?area=altrincham; default Trafford) — names, breadcrumb, tab title ──
function applyArea() {
  const area = currentArea();
  if (!area) return;
  const set = (sel, text) => document.querySelectorAll(sel).forEach((el) => (el.textContent = text));
  set('[data-cr-area-name]', area.name);
  set('[data-cr-area-postcode]', area.postcode);
  // services strip: "{area} Surveyors" — a name without the placeholder is left alone
  document.querySelectorAll('[data-cr-area-brand]').forEach((el) => {
    const pattern = el.getAttribute('data-cr-area-brand') || '{area} Surveyors';
    el.textContent = pattern.replace(/\{area\}/g, area.name);
  });
  // "Party Wall surveyors across Trafford" card follows the selection too; the
  // chips stay as they are (we only have pages for the Trafford pilot areas),
  // but the one you are looking at is marked.
  const areasTitle = document.querySelector('[data-cr-areas-title]');
  if (areasTitle) {
    const wide = area.kind === 'region' || area.kind === 'borough';
    areasTitle.textContent = `Party Wall surveyors ${wide ? 'across' : 'in and around'} ${area.name}`;
  }
  document.querySelectorAll('[data-cr-areas-list] .cr-areas__chip').forEach((a) => {
    const here = a.getAttribute('href') === `/party-wall-surveyors/${area.id}`;
    if (here) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
  });
  set('[data-cr-area-place]', area.kind === 'region' ? 'Ten boroughs, North West England' : area.kind === 'borough' ? `${area.borough}, ${area.county}` : `${area.postcode}, ${area.borough}, ${area.county}`);
  const ol = document.querySelector('[data-cr-crumbs]');
  if (ol) {
    const sep = ol.querySelector('.ax-breadcrumb__sep').outerHTML;
    const trail = areaTrail(area);
    ol.innerHTML = trail
      .map((t, i) => (i === trail.length - 1
        ? `<li class="ax-breadcrumb__item" aria-current="page"><span>${esc(t)}</span></li>`
        : `<li class="ax-breadcrumb__item"><span>${esc(t)}</span></li>`))
      .join(sep);
  }
  document.title = `${area.name} · Corelain Dashboard`;
  document.querySelectorAll('[data-cr-pw-link]').forEach((a) => (a.href = partyWallHref(area)));
}

// ── Client reviews (src/js/data/reviews.js) — section stays hidden while empty ──
function renderReviews() {
  const section = document.querySelector('[data-cr-reviews]');
  if (!section || !REVIEWS.length) return;
  section.querySelector('[data-cr-reviews-list]').innerHTML = REVIEWS.map((r) => `
    <figure class="cr-review">
      ${r.rating ? `<span class="cr-review__stars" role="img" aria-label="${r.rating} out of 5">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span>` : ''}
      <blockquote class="cr-review__quote">${esc(r.quote)}</blockquote>
      <figcaption class="cr-review__by"><b>${esc(r.name)}</b><span>${esc([r.role, r.project, r.area].filter(Boolean).join(' · '))}</span></figcaption>
    </figure>`).join('');
  section.hidden = false;
}

// ── Live flood warnings (Environment Agency real-time API, no key) — banner only when one is in force ──
const FLOOD_RADIUS_KM = { area: 5, borough: 12, region: 30 };
async function fillFloodAlerts(data) {
  const box = document.querySelector('[data-cr-flood-alert]');
  if (!box || !data || !data.centre) return;
  box.hidden = true;
  try {
    const dist = FLOOD_RADIUS_KM[data.kind || 'area'] || 5;
    const res = await fetch(`https://environment.data.gov.uk/flood-monitoring/id/floods?lat=${data.centre.lat}&long=${data.centre.lng}&dist=${dist}&min-severity=3`);
    if (!res.ok) return;
    const items = ((await res.json()).items || []).filter((x) => x.severityLevel >= 1 && x.severityLevel <= 3)
      .sort((a, b) => a.severityLevel - b.severityLevel);
    if (!items.length) return;                      // nothing in force: the page shows no alert at all
    const worst = items[0].severityLevel;
    const tone = worst <= 2 ? 'danger' : 'warning';
    const when = (t) => (t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) : '');
    box.className = `ax-card ax-col--12 cr-flood-alert cr-flood-alert--${tone}`;
    box.innerHTML = `<div class="cr-flood-alert__head">
        <span class="cr-flood-alert__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4"/><path d="M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z"/><path d="M12 16h.01"/></svg></span>
        <div><h2 class="cr-flood-alert__title">${items.length} flood ${items.length === 1 ? (worst <= 2 ? 'warning' : 'alert') : 'warnings and alerts'} in force near ${esc(data.name)}</h2>
        <p class="cr-flood-alert__sub">Live from the Environment Agency · within ${dist} km of the centre</p></div>
        <a class="ax-btn ax-btn--sm cr-flood-alert__btn" href="https://check-for-flooding.service.gov.uk/" target="_blank" rel="noopener">Check for flooding on GOV.UK</a>
      </div>
      <ul class="cr-flood-alert__list">${items.slice(0, 6).map((x) => `<li>
        <span class="ax-badge ax-badge--soft ax-badge--${x.severityLevel <= 2 ? 'danger' : 'warning'} ax-badge--sm">${esc(x.severity)}</span>
        <a href="https://check-for-flooding.service.gov.uk/target-area/${encodeURIComponent(x.floodAreaID)}" target="_blank" rel="noopener">${esc(x.description || x.eaAreaName)}</a>
        <small>${esc([x.floodArea && x.floodArea.riverOrSea, when(x.timeMessageChanged || x.timeRaised)].filter(Boolean).join(' · '))}</small>
      </li>`).join('')}</ul>`;
    box.hidden = false;
  } catch {
    /* the live service is optional: no banner */
  }
}

// ── Live European AQI (Open-Meteo, modelled, no key) at the area centre ──
const AQI_BANDS = [
  { max: 20, label: 'Good', color: '--ax-viz-emerald' },
  { max: 40, label: 'Fair', color: '--ax-viz-cyan' },
  { max: 60, label: 'Moderate', color: '--ax-viz-amber' },
  { max: 80, label: 'Poor', color: '--ax-danger-500' },
  { max: 100, label: 'Very poor', color: '--ax-danger-500' },
  { max: Infinity, label: 'Extremely poor', color: '--ax-danger-500' },
];
function renderAqiGauge(card, aqi) {
  const el = card.querySelector('#cr-air-gauge');
  if (!el || typeof aqi !== 'number') return;
  const band = AQI_BANDS.find((b) => aqi < b.max) || AQI_BANDS[AQI_BANDS.length - 1];
  const bandEl = card.querySelector('[data-cr-aqi-band]');
  bandEl.textContent = band.label;
  bandEl.style.setProperty('--c', `var(${band.color})`);
  el.setAttribute('aria-label', `European air quality index ${aqi}, ${band.label.toLowerCase()}`);
  destroy(el);
  renderChart(el, 'radialBar', [Math.min(100, aqi)], {
    height: 190, legend: 'none', color: band.color,
    apex: {
      chart: { sparkline: { enabled: true } },
      plotOptions: { radialBar: {
        startAngle: -90, endAngle: 90,
        hollow: { size: '62%' },
        track: { background: cv('--ax-border'), strokeWidth: '100%' },
        dataLabels: {
          name: { show: true, offsetY: 18, fontFamily: cv('--ax-font-sans'), color: cv('--ax-text-muted'), fontSize: '11px' },
          value: { show: true, offsetY: -16, fontFamily: cv('--ax-font-display'), color: cv('--ax-text-strong'), fontSize: '26px', fontWeight: 700, formatter: () => String(aqi) },
        },
      } },
      stroke: { lineCap: 'round' },
      labels: ['EAQI'],
    },
  });
}

async function fillLiveAir(centre) {
  const card = document.querySelector('[data-cr-air]');
  if (!card || !centre) return;
  const time = card.querySelector('[data-cr-air-time]');
  try {
    const res = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${centre.lat}&longitude=${centre.lng}&current=european_aqi`);
    if (!res.ok) throw new Error(res.status);
    const { current } = await res.json();
    renderAqiGauge(card, current.european_aqi);
    const badge = card.querySelector('[data-cr-air-badge]');
    badge.classList.replace('ax-badge--neutral', 'ax-badge--success');
    card.querySelector('[data-cr-air-badge-text]').textContent = 'Live';
    const t = new Date(current.time + 'Z');
    time.textContent = '· ' + t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) + ' (modelled)';
  } catch {
    time.textContent = '· unavailable';
  }
}

// Gauge tracks, centre labels and the main chart read tokens at render time;
// refresh them when the theme flips (the shared retheme only updates series/axis colours).
function rethemeGauges() {
  if (DATA) drawChart(chartView);
  ['#cr-transport-gauge', '#cr-air-gauge'].forEach((sel) => {
    const chart = document.querySelector(sel)?._axChart?.instance;
    if (!chart) return;
    chart.updateOptions({ plotOptions: { radialBar: {
      track: { background: cv('--ax-border') },
      dataLabels: { name: { color: cv('--ax-text-muted') }, value: { color: cv('--ax-text-strong') } },
    } } }, false, false, false);
  });
}

async function init() {
  const area = currentArea();
  applyArea();
  renderReviews();
  initTracking(area.id);
  wireFaq(document.querySelector('[data-faq]'));
  wireNewsFilter();
  document.addEventListener('ax:change', (e) => {
    if (e.detail && e.detail.reason === 'theme') requestAnimationFrame(rethemeGauges);
  });

  DATA = await loadArea(area.id);
  apply(DATA);
  window.__crData = DATA;
  window.dispatchEvent(new CustomEvent('cr:data', { detail: DATA }));
  if (!DATA) {
    window.Alpine && window.Alpine.store('toasts').push({ title: 'Area data unavailable', msg: 'Figures could not be loaded; showing “—”.', tone: 'warning', ttl: 5000 });
    return;
  }
  initKpis();
  initChartCard();
  fillFloodAlerts(DATA);
  fillLiveAir(DATA.centre);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

