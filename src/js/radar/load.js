/*
 * Corelain Near Me — loads /data/areas/<id>.json (written by scripts/data/run.py).
 * One request per area per page view; Compare reuses the same cache.
 */
const cache = new Map();

export function loadArea(id) {
  if (!id || !/^[a-z0-9-]+$/.test(id)) return Promise.resolve(null);
  if (!cache.has(id)) {
    cache.set(id, fetch(`/data/areas/${id}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null));
  }
  return cache.get(id);
}
