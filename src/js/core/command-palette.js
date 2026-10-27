/*
 * Vireo — command palette (⌘K / Ctrl-K) — 02-shell §9.
 *
 * Fuzzy search over the SAME manifest (titles + keywords) the sidebar filter
 * uses, grouped results with breadcrumb context, arrow/enter navigation, Esc
 * close, recent (persisted). Vanilla so it works without an Alpine scope; the
 * markup is a static #ax-command dialog rendered by the customizer/command
 * partial — this module fills + drives it.
 */

import { trapFocus } from './focus-trap.js';
import * as store from './storage.js';
import { AREAS, areaHref } from '../data/areas.js';

const RECENT_KEY = 'ax:cmd-recent';
const RECENT_MAX = 5;
const HOME_SLUG = 'dashboards/area-radar';

let _booted = false;
let _open = false;
let _releaseTrap = null;
let _items = []; // flat searchable list
let _results = []; // grouped result rows (flattened with group headers)
let _active = -1; // index into flattened selectable rows
let _root = null;
let _input = null;
let _list = null;

export function init() {
  if (_booted) return;
  _booted = true;
  _root = document.getElementById('ax-command');

  // Global open shortcut works even if the dialog markup is absent (no-op then).
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if ((e.metaKey || e.ctrlKey) && k === 'k') {
      e.preventDefault();
      toggle();
    }
  });

  // The header search button raises `ax-command-open` via $dispatch; vireo.js
  // bridges it to open(). We listen here too so the palette is self-contained.
  document.addEventListener('ax-command-open', () => open());

  if (!_root) return;
  _input = _root.querySelector('.ax-command__input input, [data-ax-command-input]');
  _list = _root.querySelector('.ax-command__results, [data-ax-command-results]');

  // Standalone fallback trigger (non-Alpine builds) — no .ax-search binding to
  // avoid double-firing with the Alpine header's $dispatch.
  document
    .querySelectorAll('[data-ax-command-open]')
    .forEach((b) => b.addEventListener('click', () => open()));

  _root.addEventListener('keydown', onKey);
  _root.addEventListener('click', (e) => {
    if (e.target.closest('.ax-command__backdrop, [data-ax-command-backdrop], [data-ax-command-close]'))
      close();
  });
  if (_input) _input.addEventListener('input', () => render(_input.value));

  buildItems();
}

// Corelain: the palette searches areas only — template pages and actions are
// left out on purpose.
function buildItems() {
  _items = AREAS.map((a) => ({
    group: 'Areas',
    title: a.name,
    href: areaHref(a),
    crumb: `${a.focus ? 'Focus area · ' : ''}${a.borough} · ${a.county}`,
    badge: a.postcode,
    keywords: [a.borough, a.county, a.postcode, a.postcode.replace('-', ' ')].join(' '),
  }));
}

/* Manifest section → result group. Anything unmapped lands in "Pages", which is
   itself in GROUP_ORDER, so a new section can never drop rows silently. */
const GROUPS = {
  MAIN: 'Dashboards',
  APPLICATIONS: 'Apps',
  MODULES: 'Modules',
  'UI & FORMS': 'UI & Forms',
  PAGES: 'Pages',
  DOCS: 'Docs',
};
const GROUP_ORDER = ['Areas', 'Dashboards', 'Apps', 'Modules', 'UI & Forms', 'Pages', 'Docs', 'Actions'];

function groupFor(section) {
  return GROUPS[section] || 'Pages';
}

/* ---------------- open / close ---------------- */

export function open() {
  if (!_root || _open) return;
  _open = true;
  _root.classList.add('is-open');
  _root.removeAttribute('hidden');
  _root.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  if (_input) _input.value = '';
  render('');
  _releaseTrap = trapFocus(_root, '.ax-command__input input, [data-ax-command-input]');
}

export function close() {
  if (!_root || !_open) return;
  _open = false;
  // Hand focus back BEFORE the root goes aria-hidden/hidden: hiding a subtree
  // that still owns the focused element strands it for assistive tech, and
  // Chrome refuses the aria-hidden outright ("Blocked aria-hidden on an element
  // because its descendant retained focus"). release() returns focus to the
  // opener; when there was none — ⌘K pressed with nothing focused — blur.
  if (_releaseTrap) {
    _releaseTrap();
    _releaseTrap = null;
  }
  if (_root.contains(document.activeElement)) document.activeElement.blur();
  _root.classList.remove('is-open');
  _root.setAttribute('aria-hidden', 'true');
  _root.setAttribute('hidden', '');
  document.body.style.overflow = '';
}

export function toggle() {
  _open ? close() : open();
}

/* ---------------- search + render ---------------- */

function search(q) {
  const query = (q || '').trim().toLowerCase();
  if (!query) return [{ groupHeader: 'Areas' }, ..._items];

  const scored = [];
  for (const it of _items) {
    const hay = (it.title + ' ' + (it.keywords || '')).toLowerCase();
    let score = -1;
    const titleLc = it.title.toLowerCase();
    if (titleLc.startsWith(query)) score = 100;
    else if (titleLc.indexOf(query) !== -1) score = 70;
    else if (hay.indexOf(query) !== -1) score = 40;
    // Fuzzy against the TITLE only. Run over title+keywords it degenerated: a
    // subsequence match on a 60-char haystack put "503 Service Unavailable" and
    // "Breadcrumb" under a search for "email".
    else if (fuzzy(titleLc, query)) score = 20;
    if (score >= 0) scored.push({ it, score });
  }
  scored.sort((a, b) => b.score - a.score || a.it.title.localeCompare(b.it.title));

  // group into sections
  const order = GROUP_ORDER;
  const buckets = {};
  scored.forEach(({ it }) => {
    (buckets[it.group] = buckets[it.group] || []).push(it);
  });
  const out = [];
  order.forEach((g) => {
    if (buckets[g] && buckets[g].length) {
      out.push({ groupHeader: g });
      buckets[g].slice(0, g === 'Areas' ? AREAS.length : 8).forEach((i) => out.push(i));
    }
  });
  return out;
}

function fuzzy(hay, q) {
  let i = 0;
  for (const ch of hay) {
    if (ch === q[i]) i++;
    if (i === q.length) return true;
  }
  return false;
}

function render(q) {
  if (!_list) return;
  _results = search(q);
  _list.innerHTML = '';
  const selectable = _results.filter((r) => !r.groupHeader);

  if (!selectable.length) {
    const empty = document.createElement('p');
    empty.className = 'ax-command__empty';
    empty.textContent = `No matches for “${(q || '').trim()}” — try an area or a postcode like "M33".`;
    _list.appendChild(empty);
    _active = -1;
    return;
  }

  let selIndex = 0;
  _results.forEach((row) => {
    if (row.groupHeader) {
      const h = document.createElement('p');
      h.className = 'ax-command__group';
      h.textContent = row.groupHeader;
      _list.appendChild(h);
      return;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ax-command__row';
    btn.setAttribute('role', 'option');
    btn.dataset.axIndex = String(selIndex);
    btn.innerHTML =
      `<span class="ax-command__row-title">${escapeHtml(row.title)}</span>` +
      `<span class="ax-command__crumb">${escapeHtml(row.crumb || '')}</span>` +
      (row.badge ? `<span class="cr-command__postcode">${escapeHtml(row.badge)}</span>` : '');
    const captured = row;
    // Capture this row's index: `selIndex` is shared and ends at rows.length, so
    // reading it in the handler made every hover wrap to row 0 and jump to the top.
    const idx = selIndex;
    btn.addEventListener('click', () => go(captured));
    btn.addEventListener('mouseenter', () => setActive(idx, false));
    _list.appendChild(btn);
    selIndex++;
  });

  _active = 0;
  highlightActive();
}

function selectableRows() {
  return _results.filter((r) => !r.groupHeader);
}

function setActive(i, scroll = true) {
  const rows = selectableRows();
  if (!rows.length) return;
  _active = (i + rows.length) % rows.length;
  highlightActive(scroll);
}

// Only keyboard navigation scrolls the list; hovering must never move it.
function highlightActive(scroll = true) {
  if (!_list) return;
  _list.querySelectorAll('.ax-command__row').forEach((el) => {
    const on = Number(el.dataset.axIndex) === _active;
    el.classList.toggle('is-active', on);
    el.setAttribute('aria-selected', String(on));
    if (on && scroll) el.scrollIntoView({ block: 'nearest' });
  });
}

function onKey(e) {
  switch (e.key) {
    case 'Escape':
      e.preventDefault();
      close();
      break;
    case 'ArrowDown':
      e.preventDefault();
      setActive(_active + 1);
      break;
    case 'ArrowUp':
      e.preventDefault();
      setActive(_active - 1);
      break;
    case 'Enter': {
      e.preventDefault();
      const row = selectableRows()[_active];
      if (row) go(row);
      break;
    }
  }
}

function go(row) {
  if (row.action === 'toggle-theme') {
    document.dispatchEvent(new CustomEvent('ax-theme-toggle'));
    close();
    return;
  }
  if (row.action === 'open-customizer') {
    document.dispatchEvent(new CustomEvent('ax-customizer-open'));
    close();
    return;
  }
  if (row.slug) pushRecent(row.slug);
  if (row.href) {
    if (row.external) window.open(row.href, '_blank', 'noopener');
    else window.location.href = row.href;
  }
  close();
}

/* ---------------- recent ---------------- */

function getRecent() {
  try {
    return JSON.parse(store.get(RECENT_KEY) || '[]');
  } catch (e) {
    return [];
  }
}
function pushRecent(slug) {
  let list = getRecent().filter((s) => s !== slug);
  list.unshift(slug);
  list = list.slice(0, RECENT_MAX);
  store.set(RECENT_KEY, JSON.stringify(list));
}

/* ---------------- helpers ---------------- */

function toHref(slug) {
  // Absolute and depth-safe, matching nav.js + the sidebar's link convention.
  // A relative `${slug}.html` resolves against the CURRENT folder, so every hit
  // opened from a page nested under /dashboards, /apps, … doubled its path.
  return `/src/html/${slug}.html`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export default { init, open, close, toggle };
