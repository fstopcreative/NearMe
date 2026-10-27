/*
 * Vireo — nav manifest loader + index.
 * Single fetch of /src/data/nav-manifest.json, cached as a promise so the
 * sidebar filter, breadcrumb, active-trail and command palette all share ONE
 * resolution of the 219-node tree.
 */

const MANIFEST_URL = '/src/data/nav-manifest.json';

let _promise = null;
let _cache = null;

/** Fetch + normalise the manifest once. Resolves to {nodes, byId, bySlug, meta}. */
export function loadManifest() {
  if (_promise) return _promise;
  _promise = fetch(MANIFEST_URL)
    .then((r) => {
      if (!r.ok) throw new Error('manifest ' + r.status);
      return r.json();
    })
    .then((data) => {
      _cache = index(data);
      return _cache;
    })
    .catch((err) => {
      // Surface but never crash the shell — degrade to an empty index.
      console.warn('[vireo] nav-manifest unavailable:', err.message);
      _cache = index({ nodes: [], meta: {} });
      return _cache;
    });
  return _promise;
}

/** Synchronous accessor — null until loadManifest() resolves. */
export function getManifest() {
  return _cache;
}

function index(data) {
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  const byId = new Map();
  const bySlug = new Map();
  const children = new Map();

  for (const n of nodes) {
    byId.set(n.id, n);
    // Real nodes win the slug map over alias nodes (canonical chain preferred).
    if (!bySlug.has(n.slug) || !n.alias) bySlug.set(n.slug, n);
    const p = n.parent || '__root__';
    if (!children.has(p)) children.set(p, []);
    children.get(p).push(n);
  }
  for (const list of children.values()) {
    list.sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  return {
    meta: data.meta || {},
    nodes,
    byId,
    bySlug,
    /** Direct children of a node id (or '__root__' for top-level). */
    childrenOf: (id) => children.get(id || '__root__') || [],
    /** Resolve the canonical node for a node that may be an alias. */
    resolve: (node) => (node && node.alias && byId.get(node.alias)) || node,
    /** Root→node ancestor chain (canonical), inclusive of the node itself. */
    trail(node) {
      const out = [];
      let cur = node;
      const seen = new Set();
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        out.unshift(cur);
        cur = cur.parent ? byId.get(cur.parent) : null;
      }
      return out;
    },
  };
}

/**
 * Resolve the current route slug from <html data-ax-route> or the URL path.
 * Strips the /src/html prefix, leading slash and .html so it matches manifest
 * slugs like "dashboards/sales".
 */
export function currentSlug() {
  const attr = document.documentElement.dataset.axRoute;
  if (attr) return attr.replace(/^\/+/, '').replace(/\.html$/, '');
  let p = (location.pathname || '/').replace(/\/+$/, '');
  p = p.replace(/^\/src\/html\//, '').replace(/^\//, '').replace(/\.html$/, '');
  if (!p || p === 'index') return 'dashboards/area-radar';
  return p;
}
