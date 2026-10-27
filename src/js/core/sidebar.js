/*
 * Vireo — sidebar behaviour (02-shell §3).
 *
 * The sidebar partial is Alpine-driven (x-data="axSidebar()"), so this module
 * exposes the heavy DOM logic as plain functions that the Alpine component in
 * alpine/index.js calls — keeping the component thin and the logic testable:
 *   - group toggle + accordion (one top-level trunk open in click mode)
 *   - menu FILTER (substring + keyword match, hide non-matches, auto-expand
 *     ancestors, <mark> highlight, empty state, restore on clear)
 *   - role=tree roving-tabindex keyboard handling
 *   - mobile offcanvas drawer (open/close + backdrop + body lock + focus trap)
 *
 * Groups in the markup are identified by `data-ax-group="<id>"` on the parent
 * button; the collapsible panel is `[data-ax-collapse-panel]` toggled via the
 * `hidden` attribute (CSS animates height). Section eyebrows are
 * `.ax-sidebar__section`; empty state is `.ax-sidebar__nav-empty`.
 */

import { trapFocus } from './focus-trap.js';
import flyout from './sidebar-flyout.js';

const D = document.documentElement;
const MOBILE_MQ = '(max-width: 767.98px)';

let _releaseTrap = null;

export function isMobile() {
  try {
    return window.matchMedia(MOBILE_MQ).matches;
  } catch (e) {
    return false;
  }
}

/* ---------------- group accordion ---------------- */

function groupEl(sidebar, id) {
  const btn = sidebar.querySelector(`[data-ax-group="${cssEscape(id)}"]`);
  return btn ? btn.closest('.ax-nav__group') : null;
}

function isTopLevel(group) {
  return !group.parentElement.closest('.ax-nav__group');
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

/** Toggle a group by id; accordion-closes sibling top-level trunks in click mode. */
export function toggleGroup(sidebar, id) {
  const group = groupEl(sidebar, id);
  if (!group) return;
  const willOpen = !group.classList.contains('is-open');
  // Accordion: opening a top-level trunk closes its sibling trunks.
  if (willOpen && isTopLevel(group)) {
    sidebar.querySelectorAll('.ax-nav__group.is-open').forEach((g) => {
      if (g !== group && isTopLevel(g)) setGroupOpen(g, false);
    });
  }
  setGroupOpen(group, willOpen);
}

/* The expanded full-width rail always opens groups on click (accordion) — the
 * menu=hover setting does NOT touch it. Hover-to-open lives only on the
 * collapsed / compact icon rail, where it drives the flyout popover
 * (core/sidebar-flyout.js, gated on data-ax-menu). */

/* ---------------- menu filter ---------------- */

function snapshotExpansion(sidebar) {
  return Array.from(sidebar.querySelectorAll('.ax-nav__group')).map((g) =>
    g.classList.contains('is-open'),
  );
}

function restoreExpansion(sidebar, snap) {
  if (!snap) return;
  sidebar.querySelectorAll('.ax-nav__group').forEach((g, i) => setGroupOpen(g, !!snap[i]));
}

/**
 * Apply the filter. Returns the expansion snapshot taken before filtering (so
 * the caller can restore it on clear). Pass the previous snapshot back in to
 * avoid re-snapshotting an already-filtered tree.
 */
export function applyFilter(sidebar, raw, prevSnap) {
  const q = (raw || '').trim().toLowerCase();
  if (!q) {
    clearFilter(sidebar, prevSnap);
    return null;
  }
  const snap = prevSnap || snapshotExpansion(sidebar);

  // leaves: show/hide + highlight
  sidebar.querySelectorAll('.ax-nav__item').forEach((item) => {
    const labelEl = item.querySelector('.ax-nav__label');
    if (!labelEl) return;
    if (labelEl.dataset.axLabel == null) labelEl.dataset.axLabel = labelEl.textContent;
    const text = labelEl.dataset.axLabel;

    if (item.classList.contains('ax-nav__item--parent')) {
      labelEl.innerHTML = escapeHtml(text); // parents resolved by descendants
      return;
    }
    const keywords = (item.dataset.axKeywords || '').toLowerCase();
    const hit = (text.toLowerCase() + ' ' + keywords).indexOf(q) !== -1;
    item.hidden = !hit;
    labelEl.innerHTML = hit ? highlight(text, q) : escapeHtml(text);
  });

  // groups: visible + expanded iff they contain a visible leaf
  sidebar.querySelectorAll('.ax-nav__group').forEach((group) => {
    const hasMatch = !!group.querySelector(
      '.ax-nav__item:not(.ax-nav__item--parent):not([hidden])',
    );
    group.hidden = !hasMatch;
    setGroupOpen(group, hasMatch);
    const parent = group.querySelector(':scope > .ax-nav__item--parent');
    if (parent) parent.hidden = !hasMatch;
  });

  // section eyebrows: hide when the section has no visible items
  sidebar.querySelectorAll('.ax-sidebar__section').forEach((section) => {
    let el = section.nextElementSibling;
    let visible = false;
    while (el && !el.classList.contains('ax-sidebar__section')) {
      const isVisibleLeaf =
        !el.hidden && el.matches && el.matches('.ax-nav__item:not([hidden])');
      const hasVisibleLeaf =
        !el.hidden && el.querySelector && el.querySelector('.ax-nav__item:not([hidden])');
      if (isVisibleLeaf || hasVisibleLeaf) {
        visible = true;
        break;
      }
      el = el.nextElementSibling;
    }
    section.hidden = !visible;
  });

  const none = !sidebar.querySelector(
    '.ax-nav__item:not(.ax-nav__item--parent):not([hidden])',
  );
  toggleEmptyState(sidebar, none, raw);
  return snap;
}

export function clearFilter(sidebar, snap) {
  sidebar
    .querySelectorAll('.ax-nav__item, .ax-nav__group, .ax-sidebar__section')
    .forEach((el) => (el.hidden = false));
  sidebar.querySelectorAll('.ax-nav__label').forEach((labelEl) => {
    if (labelEl.dataset.axLabel != null) labelEl.innerHTML = escapeHtml(labelEl.dataset.axLabel);
  });
  restoreExpansion(sidebar, snap);
  toggleEmptyState(sidebar, false, '');
}

function toggleEmptyState(sidebar, show, q) {
  const empty = sidebar.querySelector('.ax-sidebar__nav-empty');
  if (!empty) return;
  if (show) {
    empty.textContent = `No menu items match “${q.trim()}”.`;
    empty.hidden = false;
  } else {
    empty.hidden = true;
  }
}

/* ---------------- role=tree keyboard ---------------- */

function visibleItems(sidebar) {
  return Array.from(sidebar.querySelectorAll('.ax-nav__item')).filter(
    (el) => !el.hidden && el.offsetParent !== null,
  );
}

/** Handle a keydown on the nav tree (roving tabindex). */
export function onTreeKey(sidebar, e) {
  const items = visibleItems(sidebar);
  const idx = items.indexOf(document.activeElement);
  const rtl = D.getAttribute('dir') === 'rtl';

  const focusAt = (i) => {
    const next = items[Math.max(0, Math.min(items.length - 1, i))];
    if (!next) return;
    items.forEach((it) => it.setAttribute('tabindex', '-1'));
    next.setAttribute('tabindex', '0');
    next.focus();
  };

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      focusAt(idx === -1 ? 0 : idx + 1);
      break;
    case 'ArrowUp':
      e.preventDefault();
      focusAt(idx === -1 ? 0 : idx - 1);
      break;
    case 'Home':
      e.preventDefault();
      focusAt(0);
      break;
    case 'End':
      e.preventDefault();
      focusAt(items.length - 1);
      break;
    case 'Enter':
    case ' ': {
      const cur = document.activeElement;
      if (cur && cur.classList.contains('ax-nav__item--parent')) {
        e.preventDefault();
        const id = cur.dataset.axGroup;
        if (!id) break;
        // Collapsed rail: the in-rail panel is hidden — open the flyout instead.
        if (flyout.isCollapsedDesktop()) flyout.openFor(sidebar, cur, true, true);
        else toggleGroup(sidebar, id);
      }
      break;
    }
    case 'ArrowRight':
    case 'ArrowLeft': {
      const expand = (e.key === 'ArrowRight') !== rtl;
      const cur = document.activeElement;
      if (cur && cur.classList.contains('ax-nav__item--parent')) {
        // Collapsed rail: expand-arrow opens the flyout, collapse-arrow closes it.
        if (flyout.isCollapsedDesktop()) {
          e.preventDefault();
          if (expand) flyout.openFor(sidebar, cur, true, true);
          else flyout.close();
          break;
        }
        const group = cur.closest('.ax-nav__group');
        const isOpen = group && group.classList.contains('is-open');
        if (expand && !isOpen) {
          e.preventDefault();
          setGroupOpen(group, true);
        } else if (!expand && isOpen) {
          e.preventDefault();
          setGroupOpen(group, false);
        }
      }
      break;
    }
    default:
      if (e.key.length === 1 && /\S/.test(e.key) && idx !== -1) {
        const letter = e.key.toLowerCase();
        for (let i = 1; i <= items.length; i++) {
          const cand = items[(idx + i) % items.length];
          const label = cand.querySelector('.ax-nav__label');
          if (label && label.textContent.trim().toLowerCase().startsWith(letter)) {
            focusAt(items.indexOf(cand));
            break;
          }
        }
      }
  }
}

/* ---------------- mobile drawer ---------------- */

/* The drawer scrim is addressed by `[data-ax-drawer-scrim]`, NOT by the bare
 * `.ax-backdrop` class: content pages (crm/contacts, apps/contacts, jobs/…) also
 * paint their own scrims with that class, and a bare query matched THEIR element
 * — leaving the drawer with no scrim and no click-outside-to-close at all. */
const SCRIM_SEL = '[data-ax-drawer-scrim]';

function scrimEl() {
  return document.querySelector(SCRIM_SEL);
}

function ensureBackdrop() {
  let bd = scrimEl();
  if (!bd) {
    bd = document.createElement('div');
    bd.className = 'ax-backdrop';
    bd.setAttribute('data-ax-drawer-scrim', '');
    bd.setAttribute('aria-hidden', 'true');
    bd.addEventListener('click', closeDrawer);
  }
  // Mount it inside the drawer's OWN stacking context. `.ax-layout` is
  // `isolation:isolate`, so `.ax-sidebar`'s z-index is scoped to that context;
  // a scrim parked on <body> compares against `.ax-layout` itself (z-index:1)
  // and therefore paints ABOVE the open drawer — dimming it and swallowing
  // every tap on the menu. Same parent ⇒ 900 (scrim) < 1100 (drawer).
  const sb = document.querySelector('.ax-sidebar');
  const host = (sb && sb.parentElement) || document.body;
  if (bd.parentElement !== host) host.appendChild(bd);
  return bd;
}

export function openDrawer() {
  const sidebar = document.querySelector('.ax-sidebar');
  if (!sidebar) return;
  D.setAttribute('data-ax-drawer', 'open');
  document.body.style.overflow = 'hidden';
  ensureBackdrop().classList.add('is-visible');
  _releaseTrap = trapFocus(sidebar, '.ax-sidebar__filter');
}

export function closeDrawer() {
  if (!D.hasAttribute('data-ax-drawer')) return;
  D.removeAttribute('data-ax-drawer');
  document.body.style.overflow = '';
  const bd = scrimEl();
  if (bd) bd.classList.remove('is-visible');
  if (_releaseTrap) {
    _releaseTrap();
    _releaseTrap = null;
  }
}

/** Esc closes the drawer (wired once globally by the Alpine component init). */
export function wireDrawerEscape() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && D.getAttribute('data-ax-drawer') === 'open') closeDrawer();
  });
  // Growing past the drawer band (rotate a phone, drag a desktop window) hands
  // the sidebar back to the docked layout — but the open STATE is ours, and
  // without this it survived: `data-ax-drawer="open"`, the body scroll-lock and
  // the scrim all stayed put beside a sidebar that was no longer a drawer.
  try {
    const mq = window.matchMedia(MOBILE_MQ);
    const onChange = (e) => {
      if (!e.matches) closeDrawer();
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange); /* Safari < 14 */
  } catch (e) {
    /* noop */
  }
}

/* ---------------- helpers ---------------- */

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function highlight(text, q) {
  const i = text.toLowerCase().indexOf(q);
  if (i === -1) return escapeHtml(text);
  return (
    escapeHtml(text.slice(0, i)) +
    '<mark class="ax-nav__mark">' +
    escapeHtml(text.slice(i, i + q.length)) +
    '</mark>' +
    escapeHtml(text.slice(i + q.length))
  );
}

function cssEscape(s) {
  return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&');
}

export default {
  isMobile,
  toggleGroup,
  applyFilter,
  clearFilter,
  onTreeKey,
  openDrawer,
  closeDrawer,
  wireDrawerEscape,
  // collapsed-rail flyout (see core/sidebar-flyout.js)
  initFlyout: flyout.initFlyout,
  toggleFlyout: flyout.toggleFor,
  closeFlyout: flyout.close,
  isCollapsedDesktop: flyout.isCollapsedDesktop,
  isAutoRail: flyout.isAutoRail,
};
