/*
 * Vireo — horizontal top-nav adapter (Navigation → Orientation).
 *
 * The customizer offers Vertical / Horizontal / Hybrid. Vertical is the sidebar;
 * Horizontal hides the sidebar; Hybrid keeps it. Both Horizontal and Hybrid need a
 * real top menu bar — `.ax-topnav` — but the shell ships none. Rather than hand-
 * duplicate the 21-group menu into every page, this module builds `.ax-topnav` from
 * the existing sidebar tree (single source of truth) on boot and wires its
 * dropdowns. CSS (base.css §8) gates visibility off `data-ax-nav`, so the bar is
 * inert in Vertical. No-op on shell-less pages (auth/error) where there is no nav.
 *
 * Dropdown panels are `position: fixed`, positioned under their trigger on open, so
 * they escape the bar's horizontal overflow (the bar scrolls when the groups exceed
 * the viewport width) and never get clipped.
 */

const D = document.documentElement;
const CARET =
  '<svg class="ax-topnav__caret" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
const CHEVRON = (d) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const CHEVRON_PREV = CHEVRON('M15 6l-6 6 6 6'); // points to inline-start
const CHEVRON_NEXT = CHEVRON('M9 6l6 6-6 6'); // points to inline-end

/** Live read of the menu-interaction mode (customizer: Click | Hover). */
function hoverMode() {
  return (D.getAttribute('data-ax-menu') || 'click') === 'hover';
}

let _inited = false;
let _bar = null;
let _track = null;
let _prev = null;
let _next = null;
let _openItem = null;
let _hoverTimer = null;

function labelOf(el) {
  const l = el && el.querySelector('.ax-nav__label');
  return (l ? l.textContent : (el ? el.textContent : '') || '').trim();
}

/* ---------------- open / close ---------------- */

function positionMenu(item) {
  const trigger = item.querySelector('.ax-topnav__trigger');
  const menu = item.querySelector('.ax-topnav__menu');
  if (!trigger || !menu) return;
  const r = trigger.getBoundingClientRect();
  const rtl = D.getAttribute('dir') === 'rtl';
  menu.style.insetBlockStart = `${Math.round(r.bottom + 4)}px`;
  // clamp horizontally to the viewport (flip alignment near the far edge)
  const w = menu.offsetWidth || 240;
  let left = rtl ? r.right - w : r.left;
  left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
  menu.style.insetInlineStart = `${Math.round(left)}px`;
  menu.style.insetInlineEnd = 'auto';
  // cap height to what is left below the trigger
  menu.style.maxBlockSize = `${Math.round(window.innerHeight - r.bottom - 16)}px`;
}

function openItem(item) {
  if (_openItem && _openItem !== item) closeItem(_openItem);
  _openItem = item;
  item.classList.add('is-open');
  const t = item.querySelector('.ax-topnav__trigger');
  if (t) t.setAttribute('aria-expanded', 'true');
  positionMenu(item);
}

function closeItem(item) {
  if (!item) return;
  item.classList.remove('is-open');
  const t = item.querySelector('.ax-topnav__trigger');
  if (t) t.setAttribute('aria-expanded', 'false');
  if (_openItem === item) _openItem = null;
}

function closeAll() {
  if (_openItem) closeItem(_openItem);
}

/* ---------------- build ---------------- */

function makeMenuLink(a) {
  const link = document.createElement('a');
  link.className = 'ax-topnav__menu-link';
  link.setAttribute('role', 'menuitem');
  link.href = a.getAttribute('href') || '#';
  if (a.classList.contains('is-active') || a.getAttribute('aria-current')) {
    link.classList.add('is-active');
    link.setAttribute('aria-current', 'page');
  }
  const span = document.createElement('span');
  span.className = 'ax-topnav__menu-label';
  span.textContent = labelOf(a);
  link.appendChild(span);
  const badge = a.querySelector('.ax-nav__badge');
  if (badge) link.appendChild(badge.cloneNode(true));
  return link;
}

/** A group → a dropdown trigger + fixed menu (nested sub-groups flattened, their
 *  parent label becoming a section heading so deep menus stay reachable). */
function makeGroupItem(group) {
  const parentBtn = group.querySelector(':scope > .ax-nav__item--parent');
  const panel = group.querySelector(':scope > .ax-nav__children');
  if (!parentBtn || !panel) return null;

  const item = document.createElement('div');
  item.className = 'ax-topnav__item';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'ax-topnav__trigger';
  trigger.setAttribute('aria-haspopup', 'true');
  trigger.setAttribute('aria-expanded', 'false');
  const tl = document.createElement('span');
  tl.className = 'ax-topnav__label';
  tl.textContent = labelOf(parentBtn);
  trigger.append(tl);
  trigger.insertAdjacentHTML('beforeend', CARET);

  const menu = document.createElement('div');
  menu.className = 'ax-topnav__menu';
  menu.setAttribute('role', 'menu');

  // Walk the panel in document order: nested group parents become headings, leaf
  // children become links. Direct leaves (the common case) just become links.
  Array.from(panel.children).forEach((node) => appendPanelNode(menu, node));
  if (!menu.children.length) return null;

  item.append(trigger, menu);

  // Click always toggles (predictable for keyboard + touch); outside-click /
  // Escape dismissal is wired in init(). In menu=hover the pointer also drives
  // it — read live so flipping the customizer toggle needs no reload, and Click
  // mode stays genuinely click-only (no stray hover opens).
  trigger.addEventListener('click', (e) => {
    e.preventDefault();
    item.classList.contains('is-open') ? closeItem(item) : openItem(item);
  });
  item.addEventListener('mouseenter', () => {
    if (!hoverMode()) return;
    clearTimeout(_hoverTimer);
    openItem(item);
  });
  item.addEventListener('mouseleave', () => {
    if (!hoverMode()) return;
    // Grace delay bridges the few-px gap between the trigger and its fixed
    // dropdown: the pointer briefly leaves `item` while crossing it, and
    // re-entering the menu (a DOM child of `item`) cancels this scheduled close.
    clearTimeout(_hoverTimer);
    _hoverTimer = setTimeout(() => closeItem(item), 180);
  });
  return item;
}

function appendPanelNode(menu, node) {
  if (!node.classList) return;
  if (node.matches('a.ax-nav__item--child')) {
    menu.appendChild(makeMenuLink(node));
    return;
  }
  if (node.matches('.ax-nav__group')) {
    const sub = node.querySelector(':scope > .ax-nav__item--parent');
    const subPanel = node.querySelector(':scope > .ax-nav__children');
    if (sub) {
      const h = document.createElement('p');
      h.className = 'ax-topnav__menu-heading';
      h.textContent = labelOf(sub);
      menu.appendChild(h);
    }
    if (subPanel) Array.from(subPanel.children).forEach((c) => appendPanelNode(menu, c));
  }
}

/** A top-level plain link (no children) → a direct bar link. */
function makeDirectLink(a) {
  const link = document.createElement('a');
  link.className = 'ax-topnav__link';
  link.href = a.getAttribute('href') || '#';
  if (a.classList.contains('is-active') || a.getAttribute('aria-current')) {
    link.classList.add('is-active');
    link.setAttribute('aria-current', 'page');
  }
  link.textContent = labelOf(a);
  return link;
}

function makeEdge(dir) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `ax-topnav__edge ax-topnav__edge--${dir}`;
  btn.setAttribute('aria-label', dir === 'prev' ? 'Scroll menu backward' : 'Scroll menu forward');
  btn.tabIndex = -1;
  btn.innerHTML = dir === 'prev' ? CHEVRON_PREV : CHEVRON_NEXT;
  btn.addEventListener('click', () => scrollTrack(dir));
  return btn;
}

function build() {
  const shell = document.querySelector('.ax-shell');
  const navSrc = document.querySelector('.ax-sidebar__nav');
  const main = shell && shell.querySelector(':scope > .ax-main');
  if (!shell || !navSrc || !main) return null;
  if (shell.querySelector(':scope > .ax-topnav')) return null; // already built

  const bar = document.createElement('nav');
  bar.className = 'ax-topnav';
  bar.setAttribute('aria-label', 'Primary');

  const track = document.createElement('div');
  track.className = 'ax-topnav__track';

  Array.from(navSrc.children).forEach((node) => {
    if (!node.classList) return;
    if (node.matches('.ax-nav__group')) {
      const item = makeGroupItem(node);
      if (item) track.appendChild(item);
    } else if (node.matches('a.ax-nav__item')) {
      track.appendChild(makeDirectLink(node));
    }
  });

  _prev = makeEdge('prev');
  _next = makeEdge('next');
  _track = track;
  bar.append(_prev, track, _next);
  track.addEventListener('scroll', updateEdges, { passive: true });

  shell.insertBefore(bar, main);
  return bar;
}

/* ---------------- overflow chevrons ---------------- */

/** Page the track toward an edge by ~60% of its width (smooth). */
function scrollTrack(edge) {
  if (!_track) return;
  const amount = Math.max(160, Math.round(_track.clientWidth * 0.6));
  let delta = edge === 'next' ? amount : -amount;
  if (D.getAttribute('dir') === 'rtl') delta = -delta; // RTL scrollLeft runs negative
  _track.scrollBy({ left: delta, behavior: 'smooth' });
}

/** Show each chevron only when the track can still scroll that way. */
function updateEdges() {
  if (!_track || !_prev || !_next) return;
  const max = _track.scrollWidth - _track.clientWidth;
  const pos = Math.abs(_track.scrollLeft); // abs handles RTL negative offsets
  const overflowing = max > 2;
  _prev.classList.toggle('is-visible', overflowing && pos > 1);
  _next.classList.toggle('is-visible', overflowing && pos < max - 1);
}

/* ---------------- init ---------------- */

export function init() {
  if (_inited) return;
  _bar = build();
  if (!_bar) return;
  _inited = true;

  // dismiss on outside click / Escape
  document.addEventListener('click', (e) => {
    if (!_openItem) return;
    if (!_openItem.contains(e.target)) closeAll();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAll();
  });
  // reposition the open menu + refresh the edge chevrons on scroll / resize
  const reflow = () => {
    if (_openItem) positionMenu(_openItem);
    updateEdges();
  };
  try {
    window.addEventListener('resize', reflow);
    window.addEventListener('scroll', reflow, true);
  } catch (e) {
    /* noop */
  }
  // orientation change: close any open menu (bar may now be hidden) and — once
  // the bar is laid out (it was display:none in Vertical) — recompute the edges.
  new MutationObserver(() => {
    closeAll();
    requestAnimationFrame(updateEdges);
  }).observe(D, { attributes: true, attributeFilter: ['data-ax-nav', 'data-ax-sidebar-behavior'] });

  // initial edge state (run after first layout so measurements are non-zero)
  requestAnimationFrame(updateEdges);
}

export default { init };
