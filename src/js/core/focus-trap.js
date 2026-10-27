/*
 * Vireo — minimal focus trap for overlays (customizer, command palette,
 * mobile drawer). Returns a release() that restores focus to the opener.
 * Alpine's @alpinejs/focus is available for x-trap, but the core vanilla
 * modules (sidebar drawer, command palette) use this so they don't depend on
 * an Alpine scope.
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusable(container) {
  return Array.from(container.querySelectorAll(FOCUSABLE)).filter(
    (el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement,
  );
}

/**
 * Trap focus within `container`. `initial` (selector or element) gets focus on
 * open; defaults to the first focusable. Returns release().
 */
export function trapFocus(container, initial) {
  const opener = document.activeElement;

  const onKey = (e) => {
    if (e.key !== 'Tab') return;
    const items = focusable(container);
    if (!items.length) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  container.addEventListener('keydown', onKey);

  const target =
    (typeof initial === 'string' ? container.querySelector(initial) : initial) ||
    focusable(container)[0] ||
    container;
  // Defer so x-show / transitions have made the node focusable.
  requestAnimationFrame(() => {
    try {
      target.focus({ preventScroll: true });
    } catch (e) {
      /* noop */
    }
  });

  return function release() {
    container.removeEventListener('keydown', onKey);
    if (opener && typeof opener.focus === 'function') {
      try {
        opener.focus({ preventScroll: true });
      } catch (e) {
        /* noop */
      }
    }
  };
}
