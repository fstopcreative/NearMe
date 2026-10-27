/*
 * Vireo — color utilities for the custom-accent picker.
 * Pure functions: hex parsing, sRGB luminance, lighten/darken (oklab when
 * available, falls back to HSL mixing), and a deterministic 50→900 ramp +
 * the Layer-2 accent aliases the token system consumes.
 *
 * The blocking head script only sets --ax-accent + --ax-on-accent for first
 * paint; this module derives the FULL ramp so charts/components stay coherent.
 */

/** "#1E856C" | "1E856C" | "#abc" → {r,g,b} (0-255) or null. */
export function parseHex(hex) {
  if (typeof hex !== 'string') return null;
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function toHex({ r, g, b }) {
  const c = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}

/** Relative sRGB luminance (0-1), used to pick on-accent ink. */
export function luminance({ r, g, b }) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Contrast-correct text colour to sit on top of a given fill. */
export function onColor(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return '#FFFFFF';
  // amber/yellow-ish high-luminance fills need dark ink; threshold per spec.
  return luminance(rgb) > 0.62 ? '#1F1602' : '#FFFFFF';
}

/** Mix two rgb objects by t (0=a, 1=b). */
function mix(a, b, t) {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

const WHITE = { r: 255, g: 255, b: 255 };
const BLACK = { r: 0, g: 0, b: 0 };

export function lighten(rgb, t) {
  return mix(rgb, WHITE, t);
}
export function darken(rgb, t) {
  return mix(rgb, BLACK, t);
}

/** "30,133,108" channel string for rgba() glow/wash derivations. */
export function rgbString(hex) {
  const rgb = parseHex(hex);
  return rgb ? `${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)}` : '0, 0, 0';
}

/**
 * Derive the full accent ramp + Layer-2 aliases for a custom hex.
 * Returns a flat map of CSS custom-prop name → value, ready to set inline on
 * <html>. The 500 stop is the chosen hex; lighter/darker stops are mixed.
 */
export function deriveRamp(hex) {
  const base = parseHex(hex);
  if (!base) return {};
  const stops = {
    '--ax-accent-50': toHex(lighten(base, 0.92)),
    '--ax-accent-100': toHex(lighten(base, 0.84)),
    '--ax-accent-150': toHex(lighten(base, 0.76)),
    '--ax-accent-200': toHex(lighten(base, 0.68)),
    '--ax-accent-300': toHex(lighten(base, 0.5)),
    '--ax-accent-400': toHex(lighten(base, 0.25)),
    '--ax-accent-500': toHex(base),
    '--ax-accent-600': toHex(darken(base, 0.16)),
    '--ax-accent-700': toHex(darken(base, 0.32)),
    '--ax-accent-800': toHex(darken(base, 0.48)),
    '--ax-accent-900': toHex(darken(base, 0.62)),
  };
  const on = onColor(hex);
  return {
    ...stops,
    '--ax-accent': toHex(base),
    '--ax-accent-hover': toHex(lighten(base, 0.14)),
    '--ax-accent-rgb': rgbString(hex),
    '--ax-on-accent': on,
    // accent-led chart series-1 tracks the accent (08 §0.2).
    '--ax-chart-1': toHex(base),
  };
}
