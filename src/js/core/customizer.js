/*
 * Vireo — theme customizer LOGIC (02-shell §8).
 *
 * The customizer partial is Alpine-driven (x-data="axCustomizer()"), so this
 * module is the pure logic layer the Alpine component composes:
 *   - apply(attr,key,value,default) → set data-ax-* on <html> + write ax: key;
 *     selecting the default REMOVES both (clean DOM + storage)
 *   - setByName(name,value) using the attribute/key registry
 *   - accent presets + custom colour pickers (full ramp + on-accent contrast)
 *   - custom canvas (per-mode key) + low-contrast detection
 *   - reset (clear all ax: + data-ax-* + inline style) and copyConfig (ax:config)
 *   - currentConfig() for Copy-config / persistence snapshots
 *
 * It fires `ax:change` after any mutation so chart-theme / data-viz re-theme
 * live, and `ax-toast`/`ax-theme-change` where the spec requires.
 */

import * as store from './storage.js';
import { deriveRamp, onColor, parseHex } from './color.js';
import { resolveTheme, listenSystem, applyTheme, applyCanvas } from './theme-restore.js';
import {
  DEFAULT_FONT, DEFAULT_FAMILY, CUSTOM_FONT, applyFont, weightQuery,
  isDefaultFamily, loadCatalog, catalogEntry, searchCatalog, ensureSearchPreviews,
} from './fonts.js';

const D = document.documentElement;
const PREFIX = store.PREFIX;

// attribute ↔ key ↔ default registry (02-shell §10).
export const REGISTRY = {
  nav: { attr: 'data-ax-nav', key: 'ax:nav', def: 'vertical' },
  'shell-style': { attr: 'data-ax-shell-style', key: 'ax:shell-style', def: 'default' },
  'sidebar-behavior': { attr: 'data-ax-sidebar-behavior', key: 'ax:sidebar-behavior', def: 'collapsible' },
  menu: { attr: 'data-ax-menu', key: 'ax:menu', def: 'click' },
  page: { attr: 'data-ax-page', key: 'ax:page', def: 'regular' },
  width: { attr: 'data-ax-width', key: 'ax:width', def: 'fluid' },
  'header-position': { attr: 'data-ax-header-position', key: 'ax:header-position', def: 'fixed' },
  'sidebar-position': { attr: 'data-ax-sidebar-position', key: 'ax:sidebar-position', def: 'fixed' },
  'sidebar-scheme': { attr: 'data-ax-sidebar', key: 'ax:sidebar-scheme', def: 'light' },
  'header-scheme': { attr: 'data-ax-header', key: 'ax:header-scheme', def: 'light' },
  'sidebar-image': { attr: 'data-ax-sidebar-image', key: 'ax:sidebar-image', def: 'none' },
  loader: { attr: 'data-ax-loader', key: 'ax:loader', def: 'on' },
  font: { attr: 'data-ax-font', key: 'ax:font', def: DEFAULT_FONT },
};

export const PRESETS = [
  { value: 'verdigris', label: 'Verdigris', base: '#1E856C' },
  { value: 'cobalt', label: 'Cobalt', base: '#2A5FCC' },
  { value: 'indigo', label: 'Indigo', base: '#4F46C9' },
  { value: 'amethyst', label: 'Amethyst', base: '#8A46B5' },
  { value: 'magenta', label: 'Magenta', base: '#C13C84' },
  { value: 'terracotta', label: 'Terracotta', base: '#C25339' },
  { value: 'amber', label: 'Amber', base: '#C1820E' },
  { value: 'olive', label: 'Olive', base: '#647F1C' },
  { value: 'forest', label: 'Forest', base: '#2C7A4B' },
  { value: 'teal', label: 'Teal', base: '#10808F' },
  { value: 'slate', label: 'Slate', base: '#4A5A6B' },
  { value: 'graphite', label: 'Graphite', base: '#52514C' },
];

const ALL_KEYS = [
  'ax:theme', 'ax:accent', 'ax:accent-custom', 'ax:bg-custom', 'ax:bg-custom-dark',
  'ax:lang', 'ax:dir', 'ax:nav', 'ax:shell-style', 'ax:sidebar-behavior', 'ax:menu', 'ax:page', 'ax:width',
  'ax:header-position', 'ax:sidebar-position', 'ax:sidebar-scheme', 'ax:header-scheme',
  'ax:sidebar-image', 'ax:loader', 'ax:font', 'ax:font-custom', 'ax:font-weights',
  'ax:collapsed', 'ax:config',
];

const ALL_ATTRS = [
  'data-ax-theme', 'data-ax-accent', 'data-ax-nav', 'data-ax-shell-style', 'data-ax-sidebar-behavior',
  'data-ax-menu', 'data-ax-page', 'data-ax-width', 'data-ax-header-position', 'data-ax-sidebar-position',
  'data-ax-sidebar', 'data-ax-header', 'data-ax-sidebar-image', 'data-ax-loader', 'data-ax-font',
  'data-ax-collapsed',
];

export const RECENT_SWATCH_KEY = 'ax:accent-recent';

function emitChange(reason) {
  document.dispatchEvent(new CustomEvent('ax:change', { detail: { reason } }));
}

/* ---------------- generic writers ---------------- */

/** Write attr + key; selecting the default removes BOTH. */
export function apply(attr, key, val, def) {
  if (val === def) {
    D.removeAttribute(attr);
    store.remove(key);
  } else {
    D.setAttribute(attr, val);
    store.set(key, val);
  }
}

/** Apply by registry name; returns the resolved value (default included). */
export function setByName(name, val) {
  const r = REGISTRY[name];
  if (!r) return val;
  apply(r.attr, r.key, val, r.def);
  emitChange(name);
  return val;
}

/* ---------------- theme / accent / direction ---------------- */

export function setMode(m) {
  if (m === 'system') {
    store.set('ax:theme', 'system');
    D.setAttribute('data-ax-theme', resolveTheme('system'));
    listenSystem();
  } else {
    store.set('ax:theme', m);
    D.setAttribute('data-ax-theme', m);
  }
  // Re-resolve the per-mode custom background: applies the active mode's stored
  // canvas, or strips a stale inline override so the default token shows through.
  applyCanvas(D.getAttribute('data-ax-theme'));
  emitChange('theme');
  document.dispatchEvent(new CustomEvent('ax-theme-change', { detail: { theme: m } }));
  return m;
}

/** Header quick-toggle: flip light↔dark only (never system). Returns new mode. */
export function quickToggleTheme() {
  const cur = D.getAttribute('data-ax-theme') === 'dark' ? 'dark' : 'light';
  return setMode(cur === 'dark' ? 'light' : 'dark');
}

export function setDir(d) {
  if (d === 'rtl') {
    D.setAttribute('dir', 'rtl');
    store.set('ax:dir', 'rtl');
  } else {
    D.setAttribute('dir', 'ltr');
    store.remove('ax:dir');
  }
  emitChange('dir');
  return d;
}

/* ---------------- font family ---------------- */

/**
 * Back to the shipped pairing (Inter body + Space Grotesk display): drops the
 * attribute, the stored family and its weight ramp, and the injected <link> —
 * head.html already requests Inter, so nothing extra is needed to render it.
 */
export function resetFont() {
  applyFont(DEFAULT_FONT);
  store.remove('ax:font-custom');
  store.remove('ax:font-weights');
  return setByName('font', DEFAULT_FONT);
}

/**
 * Swap the UI typeface to ANY Google family, by exact family name — search hits
 * and free text both land here. The webfont request is issued BEFORE the
 * attribute flips so the face is in flight while the fallback is still
 * painting; `display=swap` covers the gap. Picking Inter is redirected to
 * resetFont, since that IS the default rather than an override of it.
 *
 * The weight fragment is resolved from the catalog (families ship wildly
 * different ramps) and PERSISTED, because the anti-flash head script has to
 * rebuild this exact URL before first paint and cannot load the catalog to do
 * it. Unknown families — typed by hand, or added to Google Fonts after this
 * snapshot — fall back to the standard ramp, which the css2 endpoint narrows to
 * whatever actually exists. Returns the applied family, or null if blank.
 */
export function setCustomFont(family) {
  const name = String(family || '').trim().replace(/\s+/g, ' ');
  if (!name) return null;
  if (isDefaultFamily(name)) {
    resetFont();
    return DEFAULT_FAMILY;
  }

  const entry = catalogEntry(name);
  const frag = entry ? weightQuery(entry.weights) : undefined;

  applyFont(CUSTOM_FONT, name, frag);
  store.set('ax:font-custom', name);
  if (frag === undefined) store.remove('ax:font-weights');
  else store.set('ax:font-weights', frag);
  setByName('font', CUSTOM_FONT);
  return name;
}

/** The family currently dressing the UI, by name. */
export function currentFontFamily() {
  if (currentValueOf('font') === CUSTOM_FONT) return store.get('ax:font-custom') || DEFAULT_FAMILY;
  return DEFAULT_FAMILY;
}

/** Pull in the family snapshot (lazy chunk). Resolves to the catalog array. */
export function loadFontCatalog() {
  return loadCatalog();
}

/**
 * Search every Google family offline, loading the snapshot on first use, and
 * queue one preview request so each hit can render in its own typeface.
 */
export function searchFonts(query, limit) {
  return loadCatalog().then(() => {
    const hits = searchCatalog(query, limit);
    ensureSearchPreviews(hits.map((f) => f.family));
    return hits;
  });
}

function clearCustomAccentProps() {
  ['--ax-accent', '--ax-on-accent', '--ax-accent-rgb', '--ax-accent-hover', '--ax-chart-1'].forEach((p) =>
    D.style.removeProperty(p),
  );
  for (let s = 50; s <= 900; s += 50) D.style.removeProperty(`--ax-accent-${s}`);
  D.style.removeProperty('--ax-accent-150');
}

export function setAccent(name) {
  clearCustomAccentProps();
  store.remove('ax:accent-custom');
  if (name === 'verdigris') {
    D.removeAttribute('data-ax-accent');
    store.remove('ax:accent');
  } else {
    D.setAttribute('data-ax-accent', name);
    store.set('ax:accent', name);
  }
  emitChange('accent');
  return name;
}

export function setCustomAccent(hex) {
  if (!parseHex(hex)) return null;
  const ramp = deriveRamp(hex);
  Object.entries(ramp).forEach(([prop, val]) => D.style.setProperty(prop, val));
  D.style.setProperty('--ax-on-accent', onColor(hex));
  D.setAttribute('data-ax-accent', 'custom');
  store.set('ax:accent', 'custom');
  store.set('ax:accent-custom', hex);
  pushRecentSwatch(hex);
  emitChange('accent');
  return hex;
}

export function setCustomBg(hex) {
  if (!parseHex(hex)) return false;
  const dark = D.getAttribute('data-ax-theme') === 'dark';
  store.set(dark ? 'ax:bg-custom-dark' : 'ax:bg-custom', hex);
  D.style.setProperty('--ax-canvas', hex);
  emitChange('canvas');
  return isLowContrast(hex);
}

export function isLowContrast(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return false;
  const L = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  return L > 0.35 && L < 0.72;
}

export function recentSwatches() {
  try {
    return JSON.parse(store.get(RECENT_SWATCH_KEY) || '[]');
  } catch (e) {
    return [];
  }
}
function pushRecentSwatch(hex) {
  const list = [hex, ...recentSwatches().filter((h) => h !== hex)].slice(0, 6);
  store.set(RECENT_SWATCH_KEY, JSON.stringify(list));
}

/* ---------------- reset / copy / snapshot ---------------- */

export function currentConfig() {
  const cfg = {};
  ALL_KEYS.forEach((k) => {
    const v = store.get(k);
    if (v != null && k !== 'ax:config') cfg[k.replace(PREFIX, '')] = v;
  });
  return cfg;
}

export function snapshot() {
  const keys = {};
  ALL_KEYS.forEach((k) => {
    const v = store.get(k);
    if (v != null) keys[k] = v;
  });
  return { keys, style: D.getAttribute('style') || '' };
}

export function restore(snap) {
  if (!snap) return;
  ALL_KEYS.forEach((k) => store.remove(k));
  Object.entries(snap.keys).forEach(([k, v]) => store.set(k, v));
  D.removeAttribute('style');
  if (snap.style) D.setAttribute('style', snap.style);
  applyTheme();
  emitChange('restore');
}

/** Reset everything to spec defaults. Returns the pre-reset snapshot (Undo). */
export function reset() {
  const snap = snapshot();
  ALL_KEYS.forEach((k) => store.remove(k));
  store.remove(RECENT_SWATCH_KEY);
  ALL_ATTRS.forEach((a) => D.removeAttribute(a));
  applyFont(DEFAULT_FONT); // tear the injected Google Fonts <link> back down
  D.removeAttribute('dir');
  D.setAttribute('dir', 'ltr');
  D.removeAttribute('style'); // strip ALL inline custom props
  D.setAttribute('data-ax-theme', resolveTheme());
  store.ensureSchema();
  emitChange('reset');
  return snap;
}

export function copyConfig() {
  const json = JSON.stringify(currentConfig(), null, 2);
  store.set('ax:config', json);
  const ok = () =>
    document.dispatchEvent(new CustomEvent('ax-toast', { detail: { msg: 'Config copied' } }));
  if (navigator.clipboard) navigator.clipboard.writeText(json).then(ok, ok);
  else ok();
  return json;
}

/** Read the current resolved value of a control (registry/theme/dir aware). */
export function currentValueOf(name) {
  if (name === 'theme' || name === 'mode') return store.get('ax:theme') || 'dark';
  if (name === 'dir') return D.getAttribute('dir') === 'rtl' ? 'rtl' : 'ltr';
  if (name === 'accent') return D.getAttribute('data-ax-accent') || 'verdigris';
  const r = REGISTRY[name];
  return r ? D.getAttribute(r.attr) || r.def : '';
}

export default {
  REGISTRY,
  PRESETS,
  DEFAULT_FONT,
  DEFAULT_FAMILY,
  RECENT_SWATCH_KEY,
  apply,
  setByName,
  setMode,
  quickToggleTheme,
  setDir,
  resetFont,
  setCustomFont,
  currentFontFamily,
  loadFontCatalog,
  searchFonts,
  setAccent,
  setCustomAccent,
  setCustomBg,
  isLowContrast,
  recentSwatches,
  currentConfig,
  snapshot,
  restore,
  reset,
  copyConfig,
  currentValueOf,
};
