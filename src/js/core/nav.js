/*
 * Vireo — active-trail + breadcrumb derivation (02-shell §3.6, §6).
 *
 * On load: read the current route, match the manifest leaf, mark the active
 * leaf + its ancestor trail in the sidebar (.is-active / aria-current +
 * auto-expand groups + scrollIntoView), build the breadcrumb into the page's
 * breadcrumb slot (Home root → groups → current non-link), and sync <title>.
 *
 * The DOM is server-rendered (handlebars partials); this module enhances the
 * static markup — it does NOT generate the sidebar tree.
 */

import { loadManifest, currentSlug } from './manifest.js';

const HOME_SLUG = 'dashboards/area-radar';

// Home crumb renders an icon (not the word "Home"), matching the static
// breadcrumb partial. The .ax-breadcrumb__home class sizes the SVG to 16px.
const HOME_ICON =
  '<svg class="ax-breadcrumb__home" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 8.71l-5.333 -4.148a2.666 2.666 0 0 0 -3.274 0l-5.334 4.148a2.665 2.665 0 0 0 -1.029 2.105v7.2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-7.2c0 -.823 -.38 -1.6 -1.03 -2.105"/><path d="M16 15c-2.21 1.333 -5.792 1.333 -8 0"/></svg>';

let _booted = false;

export function init() {
  if (_booted) return;
  _booted = true;
  loadManifest().then((mf) => {
    const slug = currentSlug();
    const node = mf.resolve(mf.bySlug.get(slug));
    const trail = node ? mf.trail(node) : [];
    markActive(slug, trail);
    buildBreadcrumb(node, trail);
    syncTitle(node);
  });
}

/** Mark the active leaf + auto-expand ancestor groups in the sidebar DOM. */
function markActive(slug, trail) {
  const sidebar = document.querySelector('.ax-sidebar');
  if (!sidebar) return;

  // Active leaf: link whose href resolves to the current slug.
  const links = sidebar.querySelectorAll('.ax-nav__item[href]');
  let activeLeaf = null;
  links.forEach((a) => {
    if (hrefSlug(a.getAttribute('href')) === slug) activeLeaf = a;
  });

  // First, close any group the markup pre-rendered open (e.g. Dashboards) so a
  // clean active trail wins. Keep this in sync with the Alpine accordion.
  sidebar.querySelectorAll('.ax-nav__group').forEach((group) => {
    setGroupOpen(group, false);
  });

  if (activeLeaf) {
    activeLeaf.classList.add('ax-nav__item--active', 'is-active');
    activeLeaf.setAttribute('aria-current', 'page');
    activeLeaf.setAttribute('tabindex', '0'); // roving tabindex seed

    // Walk up every .ax-nav__group ancestor of the leaf and open it (nested
    // sub-groups included). The partial identifies groups by data-ax-group; we
    // simply open by DOM ancestry, which is robust to the exact id scheme.
    let group = activeLeaf.closest('.ax-nav__group');
    while (group) {
      setGroupOpen(group, true);
      const parentBtn = group.querySelector(':scope > .ax-nav__item--parent');
      if (parentBtn) parentBtn.classList.add('ax-nav__item--trail');
      group = group.parentElement ? group.parentElement.closest('.ax-nav__group') : null;
    }
    activeLeaf.scrollIntoView({ block: 'nearest' });
  } else {
    // No matching leaf (e.g. a standalone page): fall back to opening the
    // top-level trunk that matches the route's first trail group, if present.
    const top = trail.find((n) => n.parent === null);
    if (top) {
      const btn = sidebar.querySelector(`[data-ax-group="${cssEscape(top.id)}"]`);
      const group = btn ? btn.closest('.ax-nav__group') : null;
      if (group) setGroupOpen(group, true);
    }
  }
}

function setGroupOpen(group, open) {
  if (!group) return;
  group.classList.toggle('is-open', open);
  const btn = group.querySelector(':scope > .ax-nav__item--parent');
  if (btn) btn.setAttribute('aria-expanded', String(open));
  const panel = group.querySelector(':scope > [data-ax-collapse-panel], :scope > .ax-nav__children');
  if (panel) {
    if (open) panel.removeAttribute('hidden');
    else panel.setAttribute('hidden', '');
  }
}

function cssEscape(s) {
  return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&');
}

/** Build the breadcrumb <ol> into the page's .ax-breadcrumb slot. */
function buildBreadcrumb(node, trail) {
  const nav = document.querySelector('.ax-breadcrumb');
  if (!nav || nav.hasAttribute('data-cr-static')) return; // page renders its own trail
  let ol = nav.querySelector('ol');
  if (!ol) {
    ol = document.createElement('ol');
    nav.appendChild(ol);
  }
  // Flex row + vertical centring (matches the static breadcrumb partial);
  // without it the inline-flex items baseline-align and the home icon drops.
  ol.className = 'ax-breadcrumb__list';
  ol.innerHTML = '';

  // Root crumb is always Home (never omitted).
  ol.appendChild(crumb('Home', HOME_SLUG, false, true));

  // Group + sub-group crumbs (section labels are NOT crumbs; only L1+ groups).
  // The trail includes the current node last; render the intermediate nodes.
  const middle = trail.slice(0, Math.max(0, trail.length - 1));
  for (const n of middle) {
    // Skip a node whose slug equals the home slug to avoid a duplicate Home.
    if (n.slug === HOME_SLUG) continue;
    ol.appendChild(separator());
    ol.appendChild(crumb(n.title, n.slug, false, false));
  }

  // Current crumb — page title, non-link, aria-current.
  if (node) {
    ol.appendChild(separator());
    ol.appendChild(crumb(node.title, node.slug, true, false));
  }
}

function crumb(label, slug, current, isHome) {
  const li = document.createElement('li');
  li.className = 'ax-breadcrumb__item';
  if (current) {
    li.setAttribute('aria-current', 'page');
    li.textContent = label;
  } else {
    const a = document.createElement('a');
    a.className = 'ax-breadcrumb__link';
    a.href = toHref(slug);
    if (isHome) {
      // Icon-only home crumb (aria-label carries the name for a11y).
      a.setAttribute('aria-label', 'Home');
      a.innerHTML = HOME_ICON;
    } else {
      a.textContent = label;
    }
    li.appendChild(a);
  }
  return li;
}

function separator() {
  const li = document.createElement('li');
  li.className = 'ax-breadcrumb__sep';
  li.setAttribute('aria-hidden', 'true');
  // Tabler chevron-right (flips in RTL via .ax-icon--directional).
  li.innerHTML =
    '<svg class="ax-icon ax-icon--directional" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6l-6 6"/></svg>';
  return li;
}

function syncTitle(node) {
  if (document.documentElement.hasAttribute('data-cr-title')) return; // page sets its own title
  if (node) document.title = `${node.title} · Corelain Dashboard`;
}

/* ---- slug/href helpers (relative .html links ↔ manifest slugs) ---- */

function hrefSlug(href) {
  if (!href) return '';
  return href
    .replace(/[?#].*$/, '')
    .replace(/^\.?\/+/, '')
    .replace(/^src\/html\//, '')
    .replace(/\.html$/, '')
    .replace(/^index$/, HOME_SLUG);
}

function toHref(slug) {
  // Absolute, depth-safe href matching the sidebar convention (hrefSlug strips
  // the same prefix). A relative `${slug}.html` would resolve against the
  // current folder and double the path on pages nested under /dashboards, etc.
  return `/src/html/${slug}.html`;
}

export default { init };
