/*
 * Vireo — ApexCharts thin wrapper (08-dataviz §1).
 *
 * Reads resolved --ax-* tokens (chart-1..6, text-subtle, border, surface-overlay,
 * fonts) to theme series/grid/axis/tooltip. Dark-aware. Reduced-motion disables
 * animations. Re-themes live on the `ax:change` event so light↔dark / 12 accents
 * / LTR↔RTL flip every chart within ~200ms with no reload.
 *
 * Public API:
 *   renderChart(el, type, series, opts) → Promise<ApexCharts instance>
 *   initCharts(root)  → scans [data-ax-chart] and auto-inits (lazy import + IO)
 */

let _ApexCharts = null;
const _registry = new Set(); // { instance, el, type, accent }

const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/** Read the current token palette into a plain object. */
export function readTokens() {
  const series = [1, 2, 3, 4, 5, 6].map((i) => cssVar(`--ax-chart-${i}`)).filter(Boolean);
  return {
    series: series.length ? series : ['#38BDF8', '#A78BFA', '#F472B6', '#FBBF24', '#34D399', '#FB7185'],
    accent: cssVar('--ax-accent') || '#1E856C',
    posNeg: { up: cssVar('--ax-success-500') || '#34D399', down: cssVar('--ax-danger-500') || '#FB7185' },
    gridColor: cssVar('--ax-border') || 'rgba(255,255,255,.07)',
    axisText: cssVar('--ax-text-subtle') || '#646E80',
    labelText: cssVar('--ax-text-muted') || '#98A2B3',
    tooltipBg: cssVar('--ax-surface-overlay') || '#1C212C',
    fontSans: cssVar('--ax-font-sans') || 'Inter, system-ui, sans-serif',
    fontMono: cssVar('--ax-font-mono') || 'JetBrains Mono, ui-monospace, monospace',
    dark: document.documentElement.getAttribute('data-ax-theme') === 'dark',
    rtl: document.documentElement.getAttribute('dir') === 'rtl',
    reduceMotion: prefersReducedMotion(),
  };
}

function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {
    return false;
  }
}

/**
 * Resolve a chart color spec to a concrete value. Accepts a token name
 * (`--ax-viz-cyan`), a `var(--ax-viz-cyan)` wrapper, or a literal color.
 * Tokens are read live so colors re-resolve on light↔dark / accent change.
 */
function resolveColor(c) {
  if (!c) return null;
  c = String(c).trim();
  const m = c.match(/^var\((--[^)]+)\)$/);
  if (m) return cssVar(m[1]) || null;
  if (c.startsWith('--')) return cssVar(c) || null;
  return c;
}

/** Abbreviate large numbers (K/M/B) for axes/tooltips. */
function abbr(v) {
  if (typeof v !== 'number') return v;
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(v);
}

/** Base ApexCharts option object built from tokens. */
export function apexBase(t, { type, height = 320, sparkline = false, accent = false, legend = 'bottom', stacked = false, tooltip = true }) {
  const isLine = type === 'area' || type === 'line';
  return {
    chart: {
      type,
      height,
      stacked,
      fontFamily: t.fontSans,
      foreColor: t.labelText,
      toolbar: { show: false },
      background: 'transparent',
      redrawOnParentResize: true,
      sparkline: { enabled: sparkline },
      animations: { enabled: !t.reduceMotion, speed: 280, easing: 'easeinout' },
    },
    colors: accent ? [t.accent, ...t.series.slice(1)] : t.series,
    grid: {
      show: !sparkline,
      borderColor: t.gridColor,
      strokeDashArray: 0,
      xaxis: { lines: { show: false } },
      yaxis: { lines: { show: !sparkline } },
      padding: sparkline ? { left: 0, right: 0, top: 0, bottom: 0 } : { left: 8, right: 8 },
    },
    dataLabels: { enabled: false },
    stroke: { width: isLine ? 2 : 0, curve: 'smooth', lineCap: 'round' },
    fill: { type: 'solid', opacity: type === 'area' ? 0.12 : 1 },
    plotOptions: { bar: { borderRadius: 4, columnWidth: '55%' } },
    legend: {
      show: legend !== 'none' && !sparkline,
      position: legend === 'none' ? 'bottom' : legend,
      horizontalAlign: 'left',
      fontFamily: t.fontSans,
      fontSize: '13px',
      labels: { colors: t.labelText },
      markers: { width: 8, height: 8, radius: 2 },
      itemMargin: { horizontal: 10 },
    },
    xaxis: {
      axisBorder: { show: !sparkline, color: t.gridColor },
      axisTicks: { show: false },
      labels: { style: { colors: t.axisText, fontFamily: t.fontMono, fontSize: '12px' } },
    },
    yaxis: {
      show: !sparkline,
      labels: {
        style: { colors: t.axisText, fontFamily: t.fontMono, fontSize: '12px' },
        formatter: (v) => abbr(v),
      },
    },
    tooltip: { enabled: tooltip, theme: t.dark ? 'dark' : 'light', style: { fontFamily: t.fontSans }, fillSeriesColor: false },
    markers: { size: 0, hover: { size: 5 } },
  };
}

async function loadApex() {
  if (_ApexCharts) return _ApexCharts;
  const mod = await import('apexcharts');
  _ApexCharts = mod.default || mod;
  return _ApexCharts;
}

/**
 * Render a chart into `el`. Merges apexBase(tokens) with caller opts and series.
 * Registers the instance for live re-theming. Returns the ApexCharts instance.
 */
export async function renderChart(el, type, series, opts = {}) {
  const Apex = await loadApex();
  const t = readTokens();
  const base = apexBase(t, {
    type,
    height: opts.height || 320,
    sparkline: !!opts.sparkline,
    accent: !!opts.accent,
    legend: opts.legend || 'bottom',
    stacked: !!opts.stacked,
    tooltip: opts.tooltip !== false,
  });
  const fixedColor = resolveColor(opts.color);
  const options = deepMerge(base, { series }, fixedColor ? { colors: [fixedColor] } : {}, opts.apex || {});
  const instance = new Apex(el, options);
  await instance.render();
  const entry = { instance, el, type, accent: !!opts.accent, colorToken: opts.color || null };
  _registry.add(entry);
  el._axChart = entry;

  // Re-fit on container resize (debounced one reflow per frame). Guard on WIDTH:
  // the initial observe callback and the mount-time height jump both report no
  // width change, so we skip them — only a genuine responsive resize redraws.
  // This kills the redundant second render that flashed the empty chart frame.
  if (window.ResizeObserver) {
    let raf = null;
    let lastW = el.clientWidth;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      if (w === lastW) return;
      lastW = w;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => instance.render && instance.updateOptions({}, false, true, false));
    });
    ro.observe(el);
    entry.ro = ro;
  }
  return instance;
}

/** Recolour y-axis labels without dropping a multi-axis config (array yaxis
 *  with its own formatters / min / max) — a plain object would collapse it. */
function rethemeYaxis(instance, t) {
  const cur = instance.w && instance.w.config && instance.w.config.yaxis;
  if (Array.isArray(cur) && cur.length > 1) {
    return cur.map((y) => ({ ...y, labels: { ...y.labels, style: { ...(y.labels && y.labels.style), colors: t.axisText } } }));
  }
  return { labels: { style: { colors: t.axisText } } };
}

/** Re-apply the live token palette to every registered chart. */
export function retheme() {
  const t = readTokens();
  _registry.forEach((entry) => {
    const colors = entry.colorToken
      ? [resolveColor(entry.colorToken)]
      : entry.accent
        ? [t.accent, ...t.series.slice(1)]
        : t.series;
    try {
      entry.instance.updateOptions(
        {
          colors,
          theme: { mode: t.dark ? 'dark' : 'light' },
          chart: { foreColor: t.labelText, animations: { enabled: !t.reduceMotion } },
          grid: { borderColor: t.gridColor },
          tooltip: { theme: t.dark ? 'dark' : 'light' },
          xaxis: { labels: { style: { colors: t.axisText } } },
          yaxis: rethemeYaxis(entry.instance, t),
        },
        false,
        false,
        false,
      );
    } catch (e) {
      /* chart may have been destroyed */
    }
  });
}

/**
 * Scan for [data-ax-chart="apex"] and auto-init. Below-fold charts wait for an
 * IntersectionObserver so heavy libs only load when visible. Series come from
 * window.AX_DATA[key] resolved through the data-ax-chart-data attribute, or
 * inline JSON in data-ax-chart-series.
 */
export function initCharts(root = document) {
  const els = root.querySelectorAll('[data-ax-chart="apex"]:not([data-ax-init])');
  // Reserve the chart's height BEFORE the (lazy-imported) SVG paints. Without this
  // the box stays 0px until render, then jumps to its full height — that 0→Npx
  // reflow both shifts the layout and self-triggers a second redraw whose empty
  // frame flashes the translucent glass card through as a white box. Sparklines
  // already reserve space inline, so we only fill the gap the big charts leave.
  els.forEach(reserveChartHeight);
  const mount = (el) => {
    if (el.dataset.axInit) return;
    el.dataset.axInit = '1';
    const cfg = readConfig(el);
    if (!cfg.series) return;
    renderChart(el, cfg.type, cfg.series, cfg);
  };

  if (!window.IntersectionObserver) {
    els.forEach(mount);
    return;
  }
  const io = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          mount(entry.target);
          obs.unobserve(entry.target);
        }
      });
    },
    { rootMargin: '120px' },
  );
  els.forEach((el) => io.observe(el));
}

/** Reserve a chart box's height up-front (skips els that already pin a size inline). */
function reserveChartHeight(el) {
  if (el.style.minHeight || el.style.height) return;
  const h = Number(el.dataset.axChartHeight);
  if (h > 0) el.style.minHeight = h + 'px';
}

function readConfig(el) {
  const d = el.dataset;
  let series = null;
  if (d.axChartSeries) {
    try {
      series = JSON.parse(d.axChartSeries);
    } catch (e) {
      series = null;
    }
  } else if (d.axChartData && window.AX_DATA) {
    series = resolvePath(window.AX_DATA, d.axChartData);
  }
  return {
    type: d.axChartType || 'line',
    series,
    height: d.axChartHeight ? Number(d.axChartHeight) : 320,
    sparkline: d.axChartSparkline === 'true',
    accent: d.axChartAccent === 'true',
    legend: d.axChartLegend || 'bottom',
    stacked: d.axChartStacked === 'true',
    tooltip: d.axChartTooltip !== 'false',
    color: d.axChartColor || null,
  };
}

function resolvePath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

/* ---------------- helpers ---------------- */

function isObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}
function deepMerge(...sources) {
  const out = {};
  for (const src of sources) {
    if (!src) continue;
    for (const [k, v] of Object.entries(src)) {
      if (isObject(v) && isObject(out[k])) out[k] = deepMerge(out[k], v);
      else out[k] = v;
    }
  }
  return out;
}

let _booted = false;
export function init() {
  if (_booted) return;
  _booted = true;
  document.addEventListener('ax:change', retheme);
  initCharts(document);
}

export default { init, renderChart, initCharts, retheme, readTokens, apexBase };
