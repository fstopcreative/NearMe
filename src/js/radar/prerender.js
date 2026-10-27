/*
 * Corelain Near Me — fills the page HTML from an area JSON without a DOM.
 * Used at build time (vite.config.js) for the default Trafford view, so the
 * static page, its JSON-LD and llms.txt carry the current figures. The browser
 * applies the same renderers (src/js/radar/apply.js) for any ?area=.
 */
import { bindings, block, faqHtml, jsonld } from './render.js';
import { val, esc } from './format.js';

export function prerender(html, data, templates, siteUrl) {
  if (!data) return html;
  const b = bindings(data);
  const faq = faqHtml(data, templates);
  b['faq.total'] = String(faq.total);
  html = html.replace(/(<([a-z0-9]+)\b[^>]*\sdata-m="([^"]+)"[^>]*>)[^<]*(<\/\2>)/g,
    (all, open, tag, key, close) => (key in b ? open + esc(b[key]) + close : all));
  html = html.replace(/(\sdata-r="([^"]+)"[^>]*>)<!--r-->[\s\S]*?<!--\/r-->/g,
    (all, open, name) => `${open}<!--r-->${name === 'faq' ? faq.html : block(name, data)}<!--/r-->`);
  html = html.replace(/(<[a-z0-9]+\b[^>]*\sdata-show="([^"]+)"[^>]*?)\shidden(?=[\s>])/g,
    (all, open, key) => (val(data, key) != null ? open : all));
  html = html.replace('<!--jsonld--><!--/jsonld-->',
    `<script type="application/ld+json">\n${JSON.stringify(jsonld(data, templates, siteUrl), null, 2)}\n  </script>`);
  return html;
}
