/*
 * Vireo — collapsed-rail flyout popover.
 *
 * When the sidebar is the icon-only rail (header-toggle `data-ax-collapsed` or
 * the locked `data-ax-sidebar-behavior='compact'`), base.css §7b hides the
 * in-rail child panels — there is no room to expand a submenu.
 * This module gives every top-level icon a flyout: hovering / focusing /
 * clicking a parent icon mounts a popover beside the rail listing that group's
 * sub-pages, so the rail stays narrow yet every page is one move away.
 *
 * Why a body-level popover with its own `ax-flyout__*` classes (not a cloned
 * `.ax-nav__children`):
 *   - The rail (`.ax-sidebar`) and its nav both clip overflow, so an in-rail
 *     absolutely-positioned flyout would be cut off. `position: fixed` on
 *     <body> escapes that.
 *   - §7b's hide rules match `.ax-nav__label/__children/__badge/__caret`
 *     ANYWHERE under `[data-ax-collapsed]` (not scoped to `.ax-sidebar`), so a
 *     clone carrying those classes would be hidden too. Fresh `ax-flyout__*`
 *     markup is immune.
 *
 * Self-contained on purpose (no import from sidebar.js) so sidebar.js can
 * depend on this without a cycle. Styles live in styles/nav.css.
 */

const D = document.documentElement;
const MOBILE_MQ = '(max-width: 767.98px)';
// 768–992: base.css §10 auto-collapses the DEFAULT sidebar to the 76px icon rail
// (no explicit style, non-detached shell) and hides its child panels — same as
// §7b, so it needs the same flyout to reach nested pages.
const AUTO_RAIL_MQ = '(min-width: 768px) and (max-width: 991.98px)';
const CLOSE_DELAY = 160; // ms grace so the pointer can cross the rail→popover gap

let _el = null; // the single reusable popover, mounted on <body>
let _btn = null; // the parent button the popover currently belongs to
let _pinned = false; // click/keyboard opens are "pinned" (no hover auto-close)
let _closeTimer = null;
let _inited = false;

/* ---------------- guards / helpers ---------------- */

function isMobile() {
  try {
    return window.matchMedia(MOBILE_MQ).matches;
  } catch (e) {
    return false;
  }
}

/** The flyout serves the desktop icon-only rail: the header-toggle collapse
 *  (base.css §7b), the locked 'compact' behavior, AND the 768–992 auto-collapse
 *  (§10) — all hide the in-rail submenu, so each needs the flyout. Mobile uses
 *  the drawer (full labels) instead. */
function isCollapsedDesktop() {
  if (isMobile()) return false;
  // 'compact' behavior is the locked icon rail; its submenus fly out.
  if (D.getAttribute('data-ax-sidebar-behavior') === 'compact') return true;
  if (D.hasAttribute('data-ax-collapsed')) return true;
  return isAutoRail();
}

/** True when the DEFAULT sidebar is auto-collapsed to the icon rail at 768–992
 *  (matches base.css §10's scope: non-detached shell, no explicit style). */
function isAutoRail() {
  if (D.getAttribute('data-ax-shell-style') === 'detached') return false;
  if (D.hasAttribute('data-ax-sidebar-style')) return false;
  try {
    return window.matchMedia(AUTO_RAIL_MQ).matches;
  } catch (e) {
    return false;
  }
}

/** Live read of the customizer's Menu interaction (Click | Hover). On the
 *  collapsed rail this is the ONLY place the setting applies to the sidebar:
 *  Hover → the flyout opens on pointer-over; Click → only a click opens it
 *  (the expanded rail is always click). Read per-event so flipping the toggle
 *  takes effect with no reload. */
function hoverMode() {
  return (D.getAttribute('data-ax-menu') || 'click') === 'hover';
}

function cssEscape(s) {
  return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&');
}

function isTopLevel(group) {
  return !!group && !group.parentElement.closest('.ax-nav__group');
}

function labelText(el) {
  const l = el.querySelector('.ax-nav__label');
  return (l ? l.textContent : el.textContent || '').trim();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* ---------------- DOM build ---------------- */

/** Build one flyout link from an in-rail `<a class="ax-nav__item--child">`. */
function makeLink(a) {
  const link = document.createElement('a');
  link.className = 'ax-flyout__item';
  link.setAttribute('href', a.getAttribute('href') || '#');
  link.setAttribute('role', 'menuitem');
  link.setAttribute('tabindex', '-1');
  if (a.classList.contains('is-active') || a.getAttribute('aria-current')) {
    link.classList.add('is-active');
    link.setAttribute('aria-current', 'page');
  }
  link.innerHTML = `<span class="ax-flyout__label">${escapeHtml(labelText(a))}</span>`;
  const badge = a.querySelector('.ax-nav__badge');
  if (badge) {
    const mod = Array.from(badge.classList).find((c) => c.startsWith('ax-nav__badge--'));
    const variant = mod ? mod.replace('ax-nav__badge--', '') : 'count';
    const b = document.createElement('span');
    b.className = `ax-flyout__badge ax-flyout__badge--${variant}`;
    b.textContent = badge.textContent.trim();
    link.appendChild(b);
  }
  return link;
}

/** Populate the popover from the parent's child panel. Nested sub-groups (e.g.
 *  Authentication → Sign In) are flattened to a label + their links, since the
 *  popover has room to show the whole subtree expanded. */
function build(el, btn) {
  const group = btn.closest('.ax-nav__group');
  const panel = group && group.querySelector(':scope > .ax-nav__children');
  el.textContent = '';

  const title = document.createElement('p');
  title.className = 'ax-flyout__title';
  title.textContent = labelText(btn);
  el.appendChild(title);
  el.setAttribute('aria-label', title.textContent);

  const list = document.createElement('div');
  list.className = 'ax-flyout__list';
  if (panel) {
    Array.from(panel.children).forEach((node) => {
      if (node.matches('a.ax-nav__item')) {
        list.appendChild(makeLink(node));
      } else if (node.matches('.ax-nav__group')) {
        const subBtn = node.querySelector(':scope > .ax-nav__item--parent');
        const subPanel = node.querySelector(':scope > .ax-nav__children');
        const lbl = document.createElement('p');
        lbl.className = 'ax-flyout__group';
        lbl.textContent = subBtn ? labelText(subBtn) : '';
        list.appendChild(lbl);
        if (subPanel) {
          subPanel.querySelectorAll(':scope > a.ax-nav__item').forEach((a) => list.appendChild(makeLink(a)));
        }
      }
    });
  }
  el.appendChild(list);
}

/* ---------------- positioning ---------------- */

function position(el, btn, sidebarEl) {
  const sidebar = sidebarEl || btn.closest('.ax-sidebar');
  const sRect = sidebar.getBoundingClientRect();
  const bRect = btn.getBoundingClientRect();
  const rtl = D.getAttribute('dir') === 'rtl';
  const gap = 8;
  const margin = 8;

  // measure (element is in layout even while visibility:hidden)
  const fw = el.offsetWidth;
  const fh = el.offsetHeight;

  let top = bRect.top;
  const maxTop = window.innerHeight - fh - margin;
  if (top > maxTop) top = maxTop;
  if (top < margin) top = margin;

  const left = rtl ? sRect.left - gap - fw : sRect.right + gap;

  el.style.top = `${Math.round(top)}px`;
  el.style.left = `${Math.round(left)}px`;
}

/* ---------------- open / close ---------------- */

function cancelClose() {
  if (_closeTimer) {
    clearTimeout(_closeTimer);
    _closeTimer = null;
  }
}

function scheduleClose() {
  cancelClose();
  _closeTimer = setTimeout(() => close(), CLOSE_DELAY);
}

function ensureEl() {
  if (_el) return _el;
  const el = document.createElement('div');
  el.className = 'ax-flyout';
  el.setAttribute('role', 'menu');
  el.addEventListener('mouseenter', cancelClose);
  el.addEventListener('mouseleave', () => {
    if (!_pinned) scheduleClose();
  });
  el.addEventListener('click', (e) => {
    if (e.target.closest('a[href]')) close();
  });
  el.addEventListener('keydown', onFlyoutKey);
  // moving focus out of the popover (and not back onto its trigger) closes it
  el.addEventListener('focusout', (e) => {
    const to = e.relatedTarget;
    if (to && (el.contains(to) || to === _btn)) return;
    close();
  });
  document.body.appendChild(el);
  _el = el;
  return el;
}

function isOpen() {
  return !!_el && _el.classList.contains('is-open');
}

/**
 * Open the popover for a parent button.
 * @param sidebarEl the `.ax-sidebar` root (for positioning)
 * @param btn       the `.ax-nav__item--parent` trigger
 * @param pinned    true for click/keyboard (stays until dismissed); false hover
 * @param focusFirst move focus to the first item (keyboard entry)
 */
function openFor(sidebarEl, btn, pinned, focusFirst) {
  if (!btn) return;
  cancelClose();
  _btn = btn;
  _pinned = !!pinned;
  const el = ensureEl();
  build(el, btn);
  position(el, btn, sidebarEl);
  el.classList.add('is-open');
  if (focusFirst) {
    const first = el.querySelector('.ax-flyout__item');
    if (first) {
      first.setAttribute('tabindex', '0');
      first.focus();
    }
  }
}

/** Toggle (used by a click on the collapsed parent): close if already pinned to
 *  this button, otherwise (re)open pinned. */
function toggleFor(sidebarEl, id) {
  const btn = sidebarEl.querySelector(`[data-ax-group="${cssEscape(id)}"]`);
  if (!btn) return;
  if (_btn === btn && _pinned && isOpen()) {
    close();
    return;
  }
  openFor(sidebarEl, btn, true, false);
}

function close() {
  cancelClose();
  if (_el) _el.classList.remove('is-open');
  _btn = null;
  _pinned = false;
}

/* ---------------- popover keyboard ---------------- */

function onFlyoutKey(e) {
  const items = Array.from(_el.querySelectorAll('.ax-flyout__item'));
  if (!items.length) return;
  const i = items.indexOf(document.activeElement);
  const rtl = D.getAttribute('dir') === 'rtl';
  const focusAt = (n) => {
    const next = items[Math.max(0, Math.min(items.length - 1, n))];
    if (!next) return;
    items.forEach((it) => it.setAttribute('tabindex', '-1'));
    next.setAttribute('tabindex', '0');
    next.focus();
  };

  // Esc, or the "collapse" arrow (Left in LTR / Right in RTL) → back to the rail
  const collapseArrow = rtl ? 'ArrowRight' : 'ArrowLeft';
  if (e.key === 'Escape' || e.key === collapseArrow) {
    e.preventDefault();
    const btn = _btn;
    close();
    if (btn) btn.focus();
    return;
  }

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      focusAt(i === -1 ? 0 : i + 1);
      break;
    case 'ArrowUp':
      e.preventDefault();
      focusAt(i === -1 ? 0 : i - 1);
      break;
    case 'Home':
      e.preventDefault();
      focusAt(0);
      break;
    case 'End':
      e.preventDefault();
      focusAt(items.length - 1);
      break;
    default:
      break;
  }
}

/* ---------------- init (delegated listeners) ---------------- */

export function initFlyout() {
  if (_inited) return;
  const sidebar = document.querySelector('.ax-sidebar');
  if (!sidebar) return;
  _inited = true;

  // hover: open for the hovered top-level parent; dismiss when hovering a leaf.
  // Gated on Menu interaction = Hover — in Click mode the flyout opens only on a
  // click (toggleFor, pinned), so pointer-over does nothing here.
  sidebar.addEventListener('mouseover', (e) => {
    if (!isCollapsedDesktop()) return;
    if (!hoverMode()) return;
    const row = e.target.closest('.ax-nav__item');
    if (!row || !sidebar.contains(row)) return;
    const isParent = row.classList.contains('ax-nav__item--parent') && isTopLevel(row.closest('.ax-nav__group'));
    if (isParent) {
      if (_btn !== row || !isOpen()) openFor(sidebar, row, false, false);
    } else if (!_pinned) {
      scheduleClose();
    }
  });
  sidebar.addEventListener('mouseleave', () => {
    if (!_pinned) scheduleClose();
  });

  // close on outside click (pinned popovers)
  document.addEventListener('click', (e) => {
    if (!isOpen()) return;
    if (_el.contains(e.target)) return;
    if (e.target.closest('.ax-nav__item--parent') === _btn) return;
    close();
  });

  // reposition while the rail scrolls / the window resizes; if the resize crossed
  // out of the icon rail (e.g. md → desktop), close the now-orphaned popover.
  const reflow = () => {
    if (!_btn || !isOpen()) return;
    if (!isCollapsedDesktop()) close();
    else position(_el, _btn);
  };
  try {
    window.addEventListener('resize', reflow);
  } catch (e) {
    /* noop */
  }
  const nav = sidebar.querySelector('.ax-sidebar__nav');
  if (nav) nav.addEventListener('scroll', () => (_pinned ? reflow() : close()));

  // leaving the collapsed state (header toggle / responsive) closes any popover
  new MutationObserver(() => {
    if (!isCollapsedDesktop()) close();
  }).observe(D, {
    attributes: true,
    attributeFilter: ['data-ax-collapsed', 'data-ax-sidebar-behavior'],
  });
}

export { openFor, toggleFor, close, isOpen, isCollapsedDesktop, isAutoRail };

export default { initFlyout, openFor, toggleFor, close, isOpen, isCollapsedDesktop, isAutoRail };
