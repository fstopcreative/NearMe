/*
 * Vireo — HTML reference edition · JS entry (ES module).
 *
 * Linked once per page as: <script type="module" src="/src/js/vireo.js">.
 * Responsibilities:
 *   1. Start Alpine (with collapse + focus plugins, reusable components, stores).
 *   2. Run the non-blocking theme re-sync + system-theme listener (the BLOCKING
 *      first-paint copy lives inline in partials/head.html — see theme-restore.js).
 *   3. Init every core behaviour module (all idempotent init()s).
 *   4. Init the ApexCharts auto-scanner.
 *   5. Hide the page loader once ready.
 *
 * Every module guards its own init() so re-running vireo.js is a no-op.
 */

import { start as startAlpine } from './alpine/index.js';

import themeRestore from './core/theme-restore.js';
import nav from './core/nav.js';
import topnav from './core/topnav.js';
import commandPalette from './core/command-palette.js';
import charts from './plugins/charts.js';

let _booted = false;

function boot() {
  if (_booted) return;
  _booted = true;

  // 1) Non-blocking theme re-sync + system listener (first paint already done
  //    by the inline head script). Run BEFORE Alpine so $store.theme is correct.
  themeRestore.init();

  // 2) Alpine: components (axSidebar/axHeader/axDropdown/axCustomizer),
  //    directives, $store.theme/$store.ax, toasts. The customizer offcanvas is
  //    driven entirely by the Alpine axCustomizer() component (logic in
  //    core/customizer.js), so there is no separate customizer.init() here.
  startAlpine();

  // 3) Remaining core shell behaviours (order-independent, all idempotent).
  nav.init();
  topnav.init(); // builds .ax-topnav from the sidebar tree (Horizontal/Hybrid nav)
  commandPalette.init(); // listens for ax-command-open (header $dispatch)

  // 4) Data-viz: lazy ApexCharts auto-init + live re-theme on ax:change.
  charts.init();

  // 5) Page loader: reveal the app once wired.
  hideLoader();
}

function hideLoader() {
  const loader = document.querySelector('[data-ax-loader-el], .ax-loader');
  if (!loader) return;
  if (document.documentElement.getAttribute('data-ax-loader') === 'off') {
    loader.remove();
    return;
  }
  loader.classList.add('is-hidden');
  loader.setAttribute('aria-hidden', 'true');
  const remove = () => loader.remove();
  loader.addEventListener('transitionend', remove, { once: true });
  setTimeout(remove, 600); // fallback if no transition fires
}

// Corelain: in the production build the page modules (e.g. area-radar-actions.js,
// which defines window.crHeroActions) can share one bundle with this file, and a
// shared chunk evaluates first. Booting in a microtask lets the whole module graph
// finish, so every Alpine factory exists before Alpine walks the DOM.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  queueMicrotask(boot);
}

export { boot };
