/*
 * Vireo — storage helper (ax: prefix, schema-guarded, never throws)
 * Single source of truth for reading/writing the customizer persistence keys.
 * Mirrors the guard logic in the blocking anti-flash head script (02-shell §1).
 */

export const PREFIX = 'ax:';
export const SCHEMA = '1';

let LS = null;
try {
  LS = window.localStorage;
} catch (e) {
  LS = null;
}

/** Read a raw ax: key. Returns null on miss or storage failure. */
export function get(key) {
  try {
    return LS ? LS.getItem(key) : null;
  } catch (e) {
    return null;
  }
}

/** Write an ax: key. Silently no-ops if storage is unavailable. */
export function set(key, value) {
  try {
    if (LS) LS.setItem(key, value);
  } catch (e) {
    /* in-memory fallback only — never throw */
  }
}

/** Remove an ax: key. */
export function remove(key) {
  try {
    if (LS) LS.removeItem(key);
  } catch (e) {
    /* noop */
  }
}

/** Every ax: key currently persisted. */
export function keys() {
  try {
    if (!LS) return [];
    return Object.keys(LS).filter((k) => k.indexOf(PREFIX) === 0);
  } catch (e) {
    return [];
  }
}

/** Wipe every ax: key (used by customizer Reset). */
export function clearAll() {
  keys().forEach((k) => remove(k));
}

/**
 * Schema guard — if a stored schema version mismatches, wipe all ax: keys so a
 * stale shape can never poison the app. Idempotent; safe to call repeatedly.
 */
export function ensureSchema() {
  try {
    if (!LS) return;
    const stored = get(PREFIX + 'schema');
    if (stored && stored !== SCHEMA) clearAll();
    set(PREFIX + 'schema', SCHEMA);
  } catch (e) {
    /* noop */
  }
}
