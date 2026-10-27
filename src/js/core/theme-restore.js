/*
 * Vireo — theme restore / re-sync (NON-BLOCKING).
 *
 * The AUTHORITATIVE blocking copy of this resolution lives INLINE as the first
 * child of <head> (02-shell §1) so there is zero flash before first paint.
 * This module is the ES-module mirror: it (a) re-runs the same resolution after
 * DOMContentLoaded as a safety re-sync, and (b) attaches the live matchMedia
 * '(prefers-color-scheme)' listener so that when ax:theme === 'system' the
 * canvas tracks the OS theme without a reload — which the blocking IIFE cannot
 * do because it runs once.
 *
 * Exported `applyTheme()` re-derives every data-ax-* attribute from storage,
 * matching the head script byte-for-byte (so reuse/reference stays honest).
 */

import * as store from './storage.js';
import { deriveRamp, onColor } from './color.js';
import { DEFAULT_FONT, applyFont } from './fonts.js';

const PREFIX = store.PREFIX;
const D = document.documentElement;

const ATTR_KEYS = [
  ['data-ax-nav', 'ax:nav', 'vertical'],
  ['data-ax-shell-style', 'ax:shell-style', 'default'],
  ['data-ax-menu', 'ax:menu', 'click'],
  ['data-ax-page', 'ax:page', 'regular'],
  ['data-ax-width', 'ax:width', 'fluid'],
  ['data-ax-header-position', 'ax:header-position', 'fixed'],
  ['data-ax-sidebar-position', 'ax:sidebar-position', 'fixed'],
  ['data-ax-sidebar', 'ax:sidebar-scheme', 'light'],
  ['data-ax-header', 'ax:header-scheme', 'light'],
  ['data-ax-sidebar-image', 'ax:sidebar-image', 'none'],
  ['data-ax-loader', 'ax:loader', 'on'],
  ['data-ax-font', 'ax:font', DEFAULT_FONT],
];

function systemDark() {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch (e) {
    return false;
  }
}

/**
 * Resolve 'light' | 'dark' | 'system' → the concrete theme to paint.
 * With nothing stored the site opens dark; 'system' is opt-in from the
 * customizer. Must match the blocking copy in partials/head.html.
 */
export function resolveTheme(theme) {
  const t = theme || store.get(PREFIX + 'theme') || 'dark';
  return t === 'system' ? (systemDark() ? 'dark' : 'light') : t;
}

const THEME_COLOR = { dark: '#183319', light: '#FCFBF9' };

/** Point <meta name="theme-color"> at the canvas actually being painted. */
export function syncThemeColor(resolved) {
  const m = document.querySelector('[data-ax-theme-color]');
  if (m) m.setAttribute('content', THEME_COLOR[resolved === 'dark' ? 'dark' : 'light']);
}

/**
 * Re-apply EVERY persisted attribute/inline-prop from storage onto <html>.
 * Idempotent — safe to run after the blocking head script.
 */
export function applyTheme() {
  store.ensureSchema();

  // THEME
  const resolved = resolveTheme();
  D.setAttribute('data-ax-theme', resolved);
  syncThemeColor(resolved);

  // ACCENT (preset)
  const accent = store.get(PREFIX + 'accent') || 'verdigris';
  if (accent === 'verdigris') D.removeAttribute('data-ax-accent');
  else D.setAttribute('data-ax-accent', accent);

  // LANG + DIR
  const lang = (store.get(PREFIX + 'lang') || 'EN').toUpperCase();
  D.setAttribute('lang', lang.toLowerCase());
  const dirStored = store.get(PREFIX + 'dir');
  D.setAttribute('dir', dirStored || (lang === 'AR' ? 'rtl' : 'ltr'));

  // LAYOUT / SCHEME attributes (write only non-defaults)
  for (const [attr, key, def] of ATTR_KEYS) {
    const v = store.get(key);
    if (v && v !== def) D.setAttribute(attr, v);
    else D.removeAttribute(attr);
  }

  // FONT — the attribute is restored by the loop above; the webfont <link> and
  // (for a catalog family) the inline --ax-font-sans are not attributes, so keep
  // them in step here too. Matters after an Undo/restore, where the head script
  // has long since run against the pre-restore value.
  applyFont(
    store.get(PREFIX + 'font') || DEFAULT_FONT,
    store.get(PREFIX + 'font-custom'),
    store.get(PREFIX + 'font-weights') || undefined,
  );

  // COLLAPSED RAIL (boolean presence; default expanded) — mirrors head script
  if (store.get(PREFIX + 'collapsed') === '1') D.setAttribute('data-ax-collapsed', '');
  else D.removeAttribute('data-ax-collapsed');

  // CUSTOM ACCENT — derive the FULL ramp (head script only set base+on-accent)
  const customAccent = store.get(PREFIX + 'accent-custom');
  if (accent === 'custom' && customAccent) {
    const ramp = deriveRamp(customAccent);
    for (const [prop, val] of Object.entries(ramp)) D.style.setProperty(prop, val);
    if (!ramp['--ax-on-accent']) D.style.setProperty('--ax-on-accent', onColor(customAccent));
    D.setAttribute('data-ax-accent', 'custom');
  }

  // CUSTOM CANVAS (per-mode key)
  applyCanvas(resolved);
}

/**
 * Resolve the per-mode custom canvas override. Sets the inline --ax-canvas when
 * the active mode has a stored custom background; otherwise STRIPS the inline
 * override so the CSS [data-ax-theme] default token wins again.
 *
 * The strip is the part that used to be missing: a light-mode custom background
 * bled into dark because an inline custom property outranks the
 * [data-ax-theme="dark"] token rule, so toggling modes left the canvas stale.
 * --ax-canvas is only ever set inline by the custom-bg path (never by the accent
 * ramp), so removeProperty here is safe.
 */
export function applyCanvas(resolved) {
  const r = resolved || resolveTheme();
  const bg = store.get(r === 'dark' ? 'ax:bg-custom-dark' : 'ax:bg-custom');
  if (bg) D.style.setProperty('--ax-canvas', bg);
  else D.style.removeProperty('--ax-canvas');
}

let _mql = null;
let _onChange = null;

/**
 * Attach the live system-theme listener. Only mutates the canvas while the
 * user's stored preference is 'system'. Notifies via the `ax:change` event so
 * chart-theme.js and any listeners re-theme in place.
 */
export function listenSystem() {
  if (_mql) return; // idempotent
  try {
    _mql = window.matchMedia('(prefers-color-scheme: dark)');
  } catch (e) {
    return;
  }
  _onChange = (e) => {
    const pref = store.get(PREFIX + 'theme') || 'system';
    if (pref !== 'system') return;
    const resolved = e.matches ? 'dark' : 'light';
    D.setAttribute('data-ax-theme', resolved);
    syncThemeColor(resolved);
    applyCanvas(resolved);
    document.dispatchEvent(new CustomEvent('ax:change', { detail: { reason: 'system-theme' } }));
    document.dispatchEvent(new CustomEvent('ax-theme-change'));
  };
  if (_mql.addEventListener) _mql.addEventListener('change', _onChange);
  else if (_mql.addListener) _mql.addListener(_onChange);
}

let _booted = false;

/** Idempotent entry — re-sync once + wire the system listener. */
export function init() {
  if (_booted) return;
  _booted = true;
  applyTheme();
  listenSystem();
}

export default { init, applyTheme, resolveTheme, listenSystem };
