/*
 * Vireo — Alpine setup.
 *
 * Imports Alpine + @alpinejs/collapse + @alpinejs/focus and registers the
 * components the shell partials reference by name:
 *   x-data="axSidebar()"  (sidebar partial)
 *   x-data="axHeader()"   (header root)
 *   x-data="axDropdown()" (header lang/apps/cart/notif/profile popovers)
 * plus reusable in-page components (axModal, axOffcanvas, axTabs, axTooltip),
 * a global $store.theme and $store.ax (lang + responsive overflow), and the
 * toast queue. Heavy DOM logic lives in core/* and is called from these thin
 * components. Exports start().
 */

import Alpine from 'alpinejs';
import collapse from '@alpinejs/collapse';
import focus from '@alpinejs/focus';

import * as store from '../core/storage.js';
import { resolveTheme } from '../core/theme-restore.js';
import sidebar from '../core/sidebar.js';
import cz from '../core/customizer.js';

const D = document.documentElement;

let _started = false;

export function start() {
  if (_started) return Alpine;
  _started = true;

  Alpine.plugin(collapse);
  Alpine.plugin(focus);

  registerStores();
  registerComponents();
  registerDirectives();
  registerMagics();

  sidebar.wireDrawerEscape();
  sidebar.initFlyout();

  window.Alpine = Alpine;
  Alpine.start();
  return Alpine;
}

/* ---------------- stores ---------------- */

function registerStores() {
  Alpine.store('theme', {
    get mode() {
      return store.get('ax:theme') || 'system';
    },
    // Reactive copy of html[data-ax-theme] so the header toggle icon re-renders.
    resolved: D.getAttribute('data-ax-theme') || resolveTheme(),
    get dark() {
      return this.resolved === 'dark';
    },
    get accent() {
      return D.getAttribute('data-ax-accent') || 'verdigris';
    },
    get dir() {
      return D.getAttribute('dir') || 'ltr';
    },
    // Works without the customizer panel (removed in Corelain).
    toggle() {
      cz.quickToggleTheme();
      this.resolved = D.getAttribute('data-ax-theme') || resolveTheme();
    },
    openCustomizer() {
      document.dispatchEvent(new CustomEvent('ax-customizer-open'));
    },
  });

  // App-level reactive bits the header reads: $store.ax.lang, $store.ax.overflow
  Alpine.store('ax', {
    lang: (store.get('ax:lang') || 'EN').toUpperCase(),
    overflow: [], // utility items shed into the header overflow menu (by band)
    setLang(code) {
      this.lang = code;
      store.set('ax:lang', code);
      D.setAttribute('lang', code.toLowerCase());
      // AR sets RTL on first pick (unless the user already overrode dir).
      if (code === 'AR' && !store.get('ax:dir')) {
        D.setAttribute('dir', 'rtl');
        store.set('ax:dir', 'rtl');
      }
      document.dispatchEvent(new CustomEvent('ax:change', { detail: { reason: 'lang' } }));
    },
  });

  Alpine.store('toasts', {
    items: [],
    push(toast) {
      const id = Date.now() + Math.random();
      const item = { id, msg: '', ttl: 4000, action: null, ...toast };
      this.items.push(item);
      if (item.ttl) setTimeout(() => this.dismiss(id), item.ttl);
      return id;
    },
    dismiss(id) {
      this.items = this.items.filter((t) => t.id !== id);
    },
  });

  // Bridge vanilla ax-toast events into the store.
  document.addEventListener('ax-toast', (e) => Alpine.store('toasts').push(e.detail || {}));
}

/* ---------------- components ---------------- */

function registerComponents() {
  /* ===== SIDEBAR (x-data="axSidebar()") ===== */
  Alpine.data('axSidebar', () => ({
    collapsed: D.hasAttribute('data-ax-collapsed'),
    q: '',
    _snap: null,
    _root: null,

    init() {
      // Alpine's `$el` inside an event handler is the element the handler is bound
      // to (e.g. the clicked nav button / the filter input), NOT the component
      // root. The core sidebar helpers query the whole `.ax-sidebar` tree, so they
      // must be handed the root explicitly — capture it here, where `$el` IS the
      // root, and use `this._root` everywhere below. (Passing the button instead
      // makes every `querySelector('[data-ax-group=…]')` miss → clicks no-op.)
      this._root = this.$el;
      // '/' focuses the filter while focus is inside the sidebar
      this._root.addEventListener('keydown', (e) => {
        if (e.key === '/' && !/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) {
          e.preventDefault();
          if (this.$refs.filter) this.$refs.filter.focus();
        }
      });
      // keep `collapsed` in sync with the header toggle / responsive auto-collapse
      document.addEventListener('ax:sidebar-collapsed', (e) => {
        this.collapsed = !!(e.detail && e.detail.collapsed);
      });
      new MutationObserver(() => {
        this.collapsed = D.hasAttribute('data-ax-collapsed');
      }).observe(D, { attributes: true, attributeFilter: ['data-ax-collapsed'] });
    },

    toggle(id) {
      // Collapsed icon rail (header toggle, locked 'compact', OR the 768–992
      // auto-collapse): the in-rail child panel is hidden, so toggling it in place
      // shows nothing useful. Pop the group's sub-pages out in a flyout beside the
      // rail (core/sidebar-flyout.js) so the rail stays narrow yet every page is
      // reachable. isCollapsedDesktop() owns this decision (and excludes mobile,
      // which uses the offcanvas drawer with full labels).
      if (sidebar.isCollapsedDesktop()) {
        sidebar.toggleFlyout(this._root, id);
        return;
      }
      sidebar.toggleGroup(this._root, id);
    },
    filter(value) {
      this.q = value;
      this._snap = sidebar.applyFilter(this._root, value, this._snap);
    },
    clearFilter() {
      this.q = '';
      if (this.$refs.filter) this.$refs.filter.value = '';
      sidebar.clearFilter(this._root, this._snap);
      this._snap = null;
    },
    onTreeKey(e) {
      sidebar.onTreeKey(this._root, e);
    },
  }));

  /* ===== HEADER ROOT (x-data="axHeader()") ===== */
  Alpine.data('axHeader', () => ({
    full: false,
    get theme() {
      return Alpine.store('theme').resolved;
    },
    get collapsed() {
      return D.hasAttribute('data-ax-collapsed');
    },
    init() {
      document.addEventListener('fullscreenchange', () => {
        this.full = !!document.fullscreenElement;
      });
      this._bindBands();
    },
    toggleSidebar() {
      if (sidebar.isMobile()) {
        sidebar.openDrawer();
        return;
      }
      // md auto-collapse (768–992) locks the DEFAULT rail to the icon width, so the
      // toggle has no visible effect — the button is hidden in CSS; no-op here too
      // so a stray keyboard/palette call can't flip the persisted collapse state.
      if (sidebar.isAutoRail()) return;
      // Expanded / Compact lock the rail width — the toggle is hidden in CSS but
      // guard here too (keyboard / command-palette could still reach it).
      if ((D.getAttribute('data-ax-sidebar-behavior') || 'collapsible') !== 'collapsible') return;
      const collapsed = D.toggleAttribute('data-ax-collapsed');
      // persist so the rail keeps its state across reloads (write only the
      // non-default; default is expanded). Mirrors the anti-flash head script.
      if (collapsed) store.set('ax:collapsed', '1');
      else store.remove('ax:collapsed');
      document.dispatchEvent(new CustomEvent('ax:sidebar-collapsed', { detail: { collapsed } }));
    },
    toggleTheme() {
      Alpine.store('theme').toggle();
    },
    toggleFullscreen() {
      if (!document.documentElement.requestFullscreen) return;
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen();
    },
    setLang(code) {
      Alpine.store('ax').setLang(code);
    },
    // Responsive overflow band signal (02-shell §4.12).
    _bindBands() {
      const update = () => {
        let w = 9999;
        try {
          w = window.innerWidth;
        } catch (e) {
          /* noop */
        }
        // Corelain: nothing is shed into an overflow menu any more — below lg the
        // fullscreen toggle is simply hidden (shell.css) and there is no "⋮" menu.
        const shed = [];
        Alpine.store('ax').overflow = shed;
      };
      update();
      try {
        window.addEventListener('resize', debounce(update, 150));
      } catch (e) {
        /* noop */
      }
    },
  }));

  /* ===== DROPDOWN / POPOVER (x-data="axDropdown()") ===== */
  Alpine.data('axDropdown', () => ({
    open: false,
    toggle() {
      this.open = !this.open;
    },
    close() {
      this.open = false;
    },
  }));

  /* ===== CUSTOMIZER (x-data="axCustomizer()") =====
     The partial binds reactive state (mode/dir/accent/nav/…) + setX() methods.
     This component is a thin reactive shell over core/customizer.js (the logic)
     so every control is live-apply, default-removes-attr, and persists. */
  Alpine.data('axCustomizer', () => ({
    open: false,
    announce: '',
    bgLowContrast: false,
    presets: cz.PRESETS,
    recentAccents: cz.recentSwatches(),
    // reactive mirrors of the current <html>/storage state
    mode: cz.currentValueOf('mode'),
    dir: cz.currentValueOf('dir'),
    accent: cz.currentValueOf('accent'),
    customAccent: store.get('ax:accent-custom') || '',
    hex: store.get('ax:accent-custom') || '#1E856C',
    nav: cz.currentValueOf('nav'),
    shellStyle: cz.currentValueOf('shell-style'),
    sidebarBehavior: cz.currentValueOf('sidebar-behavior'),
    menu: cz.currentValueOf('menu'),
    page: cz.currentValueOf('page'),
    width: cz.currentValueOf('width'),
    headerPos: cz.currentValueOf('header-position'),
    sidebarPos: cz.currentValueOf('sidebar-position'),
    sidebarScheme: cz.currentValueOf('sidebar-scheme'),
    headerScheme: cz.currentValueOf('header-scheme'),
    sidebarImage: cz.currentValueOf('sidebar-image'),
    loader: cz.currentValueOf('loader'),
    font: cz.currentValueOf('font'),
    fontFamily: cz.currentFontFamily(),
    fontQuery: '',
    fontResults: [],
    fontSearching: false,
    fontSearched: false,
    _fontTimer: null,

    init() {
      // Lock page scroll (hides the main scrollbar) whenever the panel is open —
      // covers every close path (Esc, backdrop, X button, event) from one place,
      // mirroring the drawer / command-palette / axModal overflow lock.
      this.$watch('open', (v) => { document.body.style.overflow = v ? 'hidden' : ''; });
      document.addEventListener('ax-customizer-open', () => {
        this._hydrate();
        this.open = true;
      });
      document.addEventListener('ax-customizer-close', () => (this.open = false));
      // header quick theme toggle / command-palette action
      document.addEventListener('ax-theme-toggle', () => {
        this.mode = cz.quickToggleTheme();
        this._announce(this.mode === 'dark' ? 'Dark mode on' : 'Light mode on');
      });
    },

    _hydrate() {
      this.mode = cz.currentValueOf('mode');
      this.dir = cz.currentValueOf('dir');
      this.accent = cz.currentValueOf('accent');
      this.nav = cz.currentValueOf('nav');
      this.shellStyle = cz.currentValueOf('shell-style');
      this.sidebarBehavior = cz.currentValueOf('sidebar-behavior');
      this.menu = cz.currentValueOf('menu');
      this.page = cz.currentValueOf('page');
      this.width = cz.currentValueOf('width');
      this.headerPos = cz.currentValueOf('header-position');
      this.sidebarPos = cz.currentValueOf('sidebar-position');
      this.sidebarScheme = cz.currentValueOf('sidebar-scheme');
      this.headerScheme = cz.currentValueOf('header-scheme');
      this.sidebarImage = cz.currentValueOf('sidebar-image');
      this.loader = cz.currentValueOf('loader');
      this.font = cz.currentValueOf('font');
      this.fontFamily = cz.currentFontFamily();
      this.customAccent = store.get('ax:accent-custom') || '';
      this.recentAccents = cz.recentSwatches();
    },
    _announce(msg) {
      this.announce = msg;
    },

    setMode(m) {
      this.mode = cz.setMode(m);
      this._announce(m === 'dark' ? 'Dark mode on' : m === 'light' ? 'Light mode on' : 'System theme');
    },
    setDir(d) {
      this.dir = cz.setDir(d);
    },
    /** Back to the shipped Inter + Space Grotesk pairing. */
    resetFont() {
      this.font = cz.resetFont();
      this.fontFamily = cz.currentFontFamily();
      this.clearFontSearch();
      this._announce('Font: ' + this.fontFamily);
    },
    /** Apply a family by name — a search hit, or whatever was typed. */
    pickFont(family) {
      const applied = cz.setCustomFont(family);
      if (!applied) return;
      this.font = cz.currentValueOf('font'); // 'custom', unless they picked Inter
      this.fontFamily = applied;
      this.clearFontSearch();
      this._announce('Font: ' + applied);
    },
    /** Pull the catalog chunk on first focus so the first keystroke has it. */
    warmFontCatalog() {
      cz.loadFontCatalog();
    },
    onFontQuery() {
      clearTimeout(this._fontTimer);
      this._fontTimer = setTimeout(() => this._runFontSearch(), 160);
    },
    _runFontSearch() {
      const q = this.fontQuery.trim();
      if (!q) {
        this.fontResults = [];
        this.fontSearching = false;
        this.fontSearched = false;
        return;
      }
      this.fontSearching = true;
      this.fontSearched = false;
      cz.searchFonts(q, 24).then((hits) => {
        if (this.fontQuery.trim() !== q) return; // a stale reply must not win
        this.fontResults = hits;
        this.fontSearching = false;
        this.fontSearched = true;
      });
    },
    /**
     * Enter applies the best match. It re-runs the search rather than trusting
     * `fontResults`, which may still be a debounce behind what was typed —
     * otherwise a fast typist hitting Enter applies their half-finished query
     * as a literal family name.
     */
    submitFontSearch() {
      const q = this.fontQuery.trim();
      if (!q) return;
      clearTimeout(this._fontTimer);
      cz.searchFonts(q, 24).then((hits) => this.pickFont(hits.length ? hits[0].family : q));
    },
    /** Escape clears the search first; only an empty field lets it close the panel. */
    onFontEscape(e) {
      if (!this.fontQuery) return;
      e.stopPropagation();
      this.clearFontSearch();
    },
    clearFontSearch() {
      clearTimeout(this._fontTimer);
      this.fontQuery = '';
      this.fontResults = [];
      this.fontSearching = false;
      this.fontSearched = false;
    },
    setAccent(name) {
      this.accent = cz.setAccent(name);
      this._announce('Accent: ' + name);
    },
    setCustomAccent(hex) {
      const v = cz.setCustomAccent(hex);
      if (v) {
        this.hex = v;
        this.customAccent = v;
        this.accent = 'custom';
        this.recentAccents = cz.recentSwatches();
        this._announce('Custom accent applied');
      }
    },
    setCustomBg(hex) {
      this.bgLowContrast = cz.setCustomBg(hex);
    },
    setNav(v) {
      this.nav = cz.setByName('nav', v);
    },
    setShellStyle(v) {
      this.shellStyle = cz.setByName('shell-style', v);
    },
    setMenu(v) {
      this.menu = cz.setByName('menu', v);
    },
    setSidebarBehavior(v) {
      this.sidebarBehavior = cz.setByName('sidebar-behavior', v);
      // Expanded & Compact lock the rail: clear any header-toggle collapse state
      // (attr + persisted key) so the locked behavior is the single source of truth.
      // Compact renders the icon rail purely via [data-ax-sidebar-behavior='compact'].
      if (v !== 'collapsible') {
        D.removeAttribute('data-ax-collapsed');
        store.remove('ax:collapsed');
        document.dispatchEvent(
          new CustomEvent('ax:sidebar-collapsed', { detail: { collapsed: false } }),
        );
      }
    },
    setPage(v) {
      this.page = cz.setByName('page', v);
    },
    setWidth(v) {
      this.width = cz.setByName('width', v);
    },
    setHeaderPos(v) {
      this.headerPos = cz.setByName('header-position', v);
    },
    setSidebarPos(v) {
      this.sidebarPos = cz.setByName('sidebar-position', v);
    },
    setSidebarScheme(v) {
      this.sidebarScheme = cz.setByName('sidebar-scheme', v);
    },
    setHeaderScheme(v) {
      this.headerScheme = cz.setByName('header-scheme', v);
    },
    setSidebarImage(v) {
      this.sidebarImage = cz.setByName('sidebar-image', v);
    },
    setLoader(e) {
      const v = e.target.checked ? 'on' : 'off';
      this.loader = cz.setByName('loader', v);
    },
    reset() {
      const snap = cz.reset();
      this._hydrate();
      this._announce('Theme reset to defaults');
      Alpine.store('toasts').push({
        msg: 'Theme reset',
        ttl: 3000,
        action: {
          label: 'Undo',
          run: () => {
            cz.restore(snap);
            this._hydrate();
          },
        },
      });
    },
    copyConfig() {
      cz.copyConfig();
      this._announce('Config copied to clipboard');
    },
  }));

  /* ===== reusable in-page components ===== */
  Alpine.data('axModal', (initial = false) => ({
    open: initial,
    show() {
      this.open = true;
      document.body.style.overflow = 'hidden';
    },
    hide() {
      this.open = false;
      document.body.style.overflow = '';
    },
  }));

  Alpine.data('axOffcanvas', (side = 'end') => ({
    open: false,
    side,
    show() {
      this.open = true;
    },
    hide() {
      this.open = false;
    },
  }));

  Alpine.data('axTabs', (initial = 0) => ({
    active: initial,
    select(i) {
      this.active = i;
    },
    isActive(i) {
      return this.active === i;
    },
  }));

  Alpine.data('axTooltip', () => ({
    open: false,
    show() {
      this.open = true;
    },
    hide() {
      this.open = false;
    },
  }));
}

/* ---------------- directives ---------------- */

function registerDirectives() {
  // x-tooltip="'Label'" — attribute-based tooltip without extra markup.
  Alpine.directive('tooltip', (el, { expression }, { evaluateLater, effect }) => {
    const get = evaluateLater(expression || `'${el.getAttribute('title') || ''}'`);
    effect(() =>
      get((val) => {
        if (val) {
          el.setAttribute('data-ax-tooltip', val);
          el.removeAttribute('title');
        }
      }),
    );
  });
}

/* ---------------- magics ---------------- */

function registerMagics() {
  Alpine.magic('toast', () => (arg) => {
    const detail = typeof arg === 'string' ? { msg: arg } : arg;
    return Alpine.store('toasts').push(detail);
  });
}

function debounce(fn, ms) {
  let t = null;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export default { start };
