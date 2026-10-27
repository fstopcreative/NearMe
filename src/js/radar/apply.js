/*
 * Corelain Near Me — applies an area JSON to the live page (browser side of
 * prerender.js). Missing data always ends up as "—" or an empty state.
 */
import { bindings, block, faqHtml } from './render.js';
import { val, DASH } from './format.js';
import templates from '../../data/faq-templates.json';

export function apply(data) {
  const b = data ? bindings(data) : {};
  const faq = data ? faqHtml(data, templates) : { total: 0, html: '' };
  b['faq.total'] = data ? String(faq.total) : DASH;
  document.querySelectorAll('[data-m]').forEach((el) => {
    el.textContent = b[el.dataset.m] ?? DASH;
  });
  document.querySelectorAll('[data-r]').forEach((el) => {
    el.innerHTML = el.dataset.r === 'faq' ? faq.html : (data ? block(el.dataset.r, data) : '');
  });
  document.querySelectorAll('[data-show]').forEach((el) => {
    el.hidden = !data || val(data, el.dataset.show) == null;
  });
  document.querySelectorAll('[data-hide-region]').forEach((el) => {
    el.hidden = !!data && data.kind === 'region';
  });
  document.documentElement.classList.remove('cr-pending');
}

/** FAQ topic tabs (plain JS so re-rendered panels need no framework). */
export function wireFaq(root) {
  if (!root || root._crFaq) return;
  root._crFaq = true;
  const select = (tab, focus) => {
    root.querySelectorAll('[data-faq-tab]').forEach((t) => {
      const on = t === tab;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      const panel = root.querySelector('#' + t.getAttribute('aria-controls'));
      if (panel) panel.hidden = !on;
    });
    if (focus) tab.focus();
  };
  root.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-faq-tab]');
    if (tab) select(tab, false);
  });
  root.addEventListener('keydown', (e) => {
    const tab = e.target.closest('[data-faq-tab]');
    if (!tab) return;
    const tabs = [...root.querySelectorAll('[data-faq-tab]')];
    const i = tabs.indexOf(tab);
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (step) {
      e.preventDefault();
      select(tabs[(i + step + tabs.length) % tabs.length], true);
    }
  });
}
