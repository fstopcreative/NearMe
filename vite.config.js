import { defineConfig, loadEnv } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import handlebars from 'vite-plugin-handlebars'
import { resolve, relative, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyFile, mkdir, readFile, writeFile, rename, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { globSync } from 'glob'
import { prerender } from './src/js/radar/prerender.js'
import { tokens, faqItems, caption, val } from './src/js/radar/render.js'

const root = dirname(fileURLToPath(import.meta.url))
const htmlRoot = resolve(root, 'src/html')
const outDir = resolve(root, 'dist')

// ── Multipage inputs: every page under src/html except shared partials ──
const pageFiles = globSync('src/html/**/*.html', {
  cwd: root,
  ignore: ['src/html/partials/**'],
})
const input = Object.fromEntries(
  pageFiles.map((p) => [relative('src/html', p).replace(/\.html$/, ''), resolve(root, p)]),
)

// ── Runtime data the app fetches by absolute URL ──
// nav.js and command-palette.js fetch /src/data/nav-manifest.json at runtime.
// It is data, not a module import, so Rollup never sees it and a plain build
// leaves it out — the sidebar filter and command palette then silently degrade
// to an empty index. Copy it into the bundle so `vite build` is self-contained.
function copyRuntimeData() {
  return {
    name: 'vireo-copy-runtime-data',
    apply: 'build',
    async writeBundle() {
      const to = resolve(outDir, 'src/data/nav-manifest.json')
      await mkdir(dirname(to), { recursive: true })
      await copyFile(resolve(root, 'src/data/nav-manifest.json'), to)
    },
  }
}

// ── Public site address (SEO) ──
// The public address, used for canonicals, og:url, the sitemap and llms.txt.
// Vercel supplies the production domain itself; the fallback is for local builds.
// Override in .env (SITE_URL=…) or from the shell: SITE_URL=… vite build
const fileEnv = loadEnv('production', root, '')
const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || ''
const SITE_URL = (process.env.SITE_URL || (vercelHost ? `https://${vercelHost}` : '') || fileEnv.SITE_URL || 'https://nearme.corelain.com').replace(/\/+$/, '')
const BUILD_DATE = new Date().toISOString().slice(0, 10)
// Analytics switches (see the head partial): GA4_ID=G-XXXX, VERCEL_ANALYTICS=true
const GA4_ID = (process.env.GA4_ID || fileEnv.GA4_ID || '').trim()
const VERCEL_ANALYTICS = /^(1|true|yes)$/i.test(process.env.VERCEL_ANALYTICS || fileEnv.VERCEL_ANALYTICS || '')

// ── Area data (public/data/areas/*.json, written by scripts/data/run.py) ──
const DEFAULT_AREA = 'trafford'
const readJson = (p) => JSON.parse(readFileSync(resolve(root, p), 'utf8'))
const areaData = (id) => { try { return readJson(`public/data/areas/${id}.json`) } catch { return null } }
const faqTemplates = () => readJson('src/data/faq-templates.json')

// The default (Trafford) view is filled in at build time — values, lists, FAQ and
// the Dataset/FAQPage JSON-LD — so crawlers and no-JS visitors see real figures.
// The browser re-applies the same renderers for ?area= (src/js/radar/apply.js).
function radarPrerender() {
  return {
    name: 'corelain-radar-prerender',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        if (!html.includes('data-radar-page')) return html
        return prerender(html, areaData(DEFAULT_AREA), faqTemplates(), SITE_URL)
      },
    },
  }
}

// Key facts + FAQ for llms.txt, from the default area's data.
function llmsFacts(d) {
  if (!d) return '- Data not available at build time.'
  const t = tokens(d)
  const line = (label, key, text) => (val(d, key) == null ? null : `- ${label}: ${text} (${caption(d, key)}).`)
  const sc = val(d, 'schools')
  return [
    line('Average sold price', 'average_price', `${t.average_price} in ${t.average_price_period}, from ${t.sales_12m} sales`),
    line('Annual change in average sold price', 'annual_growth', `${t.annual_growth}; UK ${t.uk_growth} in the year to ${t.uk_period}`),
    line('Price trend', 'price_trend', `${t.trend_from} to ${t.trend_to} over ${t.trend_years}`),
    line('Crime', 'crime_rate', `${t.crime_rate} police recorded crimes per 1,000 residents in the ${t.crime_period}; England and Wales ${t.crime_ew}; Manchester ${t.crime_manchester}`),
    sc && line('Schools', 'schools', `${t.school_mix}; indicative score ${t.school_score}/10`),
    line('Transport connectivity', 'transport_score', `${t.transport_score}/100 overall, ${t.transport_pt}/100 by public transport`),
    line('Air quality (background)', 'air_quality', `NO₂ ${t.no2}, PM2.5 ${t.pm25}, PM10 ${t.pm10} µg/m³`),
    line('Coal mining', 'coal_mining', `${d.name} ${t.coal_text}`),
    line('Conservation areas', 'conservation_areas', `${t.ca_count} in ${d.name}`),
    `- Data files (JSON, one per area): ${SITE_URL}/data/areas/<id>.json — index at ${SITE_URL}/data/areas/index.json.`,
  ].filter(Boolean).join('\n')
}
function llmsFaq(d) {
  if (!d) return ''
  const out = ['## Frequently asked questions', '']
  for (const topic of faqItems(d, faqTemplates())) {
    out.push(`### ${topic.label}`, '')
    topic.qa.forEach((qa) => out.push(`- **${qa.q}** ${qa.a}`))
    out.push('')
  }
  return out.join('\n')
}

// robots.txt, sitemap.xml and llms.txt are templates in src/seo/ with
// %SITE_URL% / %BUILD_DATE% placeholders, written into the bundle root.
function writeSeoFiles() {
  return {
    name: 'corelain-seo-files',
    apply: 'build',
    async writeBundle() {
      const d = areaData(DEFAULT_AREA)
      for (const name of ['robots.txt', 'sitemap.xml', 'llms.txt']) {
        let tpl = await readFile(resolve(root, 'src/seo', name), 'utf8')
        if (name === 'llms.txt') {
          tpl = tpl.replace(/<!-- FACTS:START -->[\s\S]*?<!-- FACTS:END -->/, `## Key facts — ${d ? d.name : ''}\n\n${llmsFacts(d)}`)
            .replace(/<!-- FAQ:START -->[\s\S]*?<!-- FAQ:END -->/, llmsFaq(d))
        }
        await writeFile(resolve(outDir, name), tpl.replaceAll('%SITE_URL%', SITE_URL).replaceAll('%BUILD_DATE%', BUILD_DATE))
      }
    },
  }
}

const humanize = (s) =>
  s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

// ── Build-time <title> per page, resolved from the nav manifest ──
// The manifest is the single source of truth for page titles (it carries the
// correct casing for acronyms: "CRM Dashboard", "Create NFT", "HR & Payroll").
// Resolving here means the STATIC html already carries the right title, so
// there is no title flash before nav.js boots and crawlers/no-JS see it too.
const navManifest = JSON.parse(
  readFileSync(resolve(root, 'src/data/nav-manifest.json'), 'utf8'),
)
const titleBySlug = new Map()
for (const n of navManifest.nodes || []) {
  // Mirror manifest.js indexing: a real node always wins over an alias node.
  if (!titleBySlug.has(n.slug) || !n.alias) titleBySlug.set(n.slug, n.title)
}

// `vite-plugin-handlebars` hands the context function a URL path
// (e.g. "/src/html/dashboards/nft.html"), NOT a filesystem path — so it must be
// sliced at the html root rather than run through path.relative() against it.
function routeFor(pagePath) {
  const p = String(pagePath).replace(/\\/g, '/').replace(/\.html$/, '')
  const i = p.lastIndexOf('src/html/')
  const route = i === -1 ? relative(htmlRoot, p) : p.slice(i + 'src/html/'.length)
  return route.replace(/^\/+/, '')
}

// ── Editable site content (src/data/site-content.json, edited in the admin panel) ──
// Read on every page transform so a save shows up in the dev server without a restart.
const LENDER_TONES = ['--ax-accent', '--ax-viz-violet', '--ax-viz-cyan', '--ax-viz-amber', '--ax-viz-emerald', '--ax-viz-pink']
function siteContent() {
  const c = readJson('src/data/site-content.json')
  const items = (c.lenders && c.lenders.items) || []
  const max = Math.max(1, ...items.map((x) => Number(x.share) || 0))
  c.lenders = { ...c.lenders, items: items.map((x, i) => ({
    ...x, rank: i + 1, tone: LENDER_TONES[i % LENDER_TONES.length],
    width: Math.round(((Number(x.share) || 0) / max) * 100), shareText: x.share == null || x.share === '' ? '—' : `${Number(x.share).toFixed(1)}%`,
  })) }
  c.services = { ...c.services, phoneHref: String((c.services && c.services.phone) || '').replace(/[^0-9+]/g, '').replace(/^0/, '+44') }
  return c
}

function pageContext(pagePath) {
  const route = routeFor(pagePath)
  // index.html is the app entry and renders the default Sales dashboard.
  const slug = route === 'index' ? 'dashboards/area-radar' : route
  return { title: titleBySlug.get(slug) || humanize(basename(route)), route: slug, siteUrl: SITE_URL, buildDate: BUILD_DATE, gaId: GA4_ID, vercelAnalytics: VERCEL_ANALYTICS, content: siteContent(),
    // Area ids that have a cover photo (scripts/hero-covers.py). Inlined so the
    // head can retarget the LCP preload before the <picture> is parsed.
    heroCovers: JSON.stringify(readJson('src/data/hero-covers.json')) }
}

// ── Production layout: the dashboard becomes /index.html and the Party Wall pages
// /party-wall-surveyors/<area>.html, so `npm run build` output can be deployed as-is
// (Vercel Git integration) — the same layout build-vercel-ready.sh produces. ──
function productionLayout() {
  return {
    name: 'corelain-production-layout',
    apply: 'build',
    async closeBundle() {
      const from = resolve(outDir, 'src/html')
      if (!existsSync(from)) return
      const dash = resolve(from, 'dashboards/area-radar.html')
      if (existsSync(dash)) await rename(dash, resolve(outDir, 'index.html'))
      const admin = resolve(from, 'admin/index.html')
      if (existsSync(admin)) {
        await mkdir(resolve(outDir, 'admin'), { recursive: true })
        await rename(admin, resolve(outDir, 'admin/index.html'))
      }
      const pw = resolve(from, 'party-wall-surveyors')
      if (existsSync(pw)) {
        await mkdir(resolve(outDir, 'party-wall-surveyors'), { recursive: true })
        for (const f of await readdir(pw)) await rename(resolve(pw, f), resolve(outDir, 'party-wall-surveyors', f))
      }
      await rm(from, { recursive: true, force: true })
    },
  }
}

// ── Dev server: the admin API (api/admin.js, a Vercel Function in production) ──
// Settings come from .env / .env.local. Without GITHUB_TOKEN, saves are written
// straight to this working copy (ADMIN_LOCAL_ROOT) so the panel can be tried locally.
function adminApiInDev() {
  return {
    name: 'corelain-admin-api-in-dev',
    apply: 'serve',
    configureServer(server) {
      const devEnv = loadEnv('development', root, '')
      for (const k of ['ADMIN_USER', 'ADMIN_PASSWORD', 'SESSION_SECRET', 'GITHUB_TOKEN', 'GITHUB_REPO', 'GITHUB_BRANCH', 'GITHUB_WORKFLOW']) {
        if (devEnv[k] && !process.env[k]) process.env[k] = devEnv[k]
      }
      process.env.ADMIN_LOCAL_ROOT = root
      server.middlewares.use('/api/admin', async (req, res) => {
        const mod = await server.ssrLoadModule('/api/admin.js')
        await mod.default(req, res)
      })
    },
  }
}

// ── Dev server: serve the production URLs from the source pages ──
//   /  and  /?area=…               → src/html/dashboards/area-radar.html
//   /party-wall-surveyors/<area>   → src/html/party-wall-surveyors/<area>.html
function prodUrlsInDev() {
  return {
    name: 'corelain-prod-urls-in-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const [path, query = ''] = req.url.split('?')
        const q = query ? '?' + query : ''
        if (path === '/' || path === '/index.html') req.url = '/src/html/dashboards/area-radar.html' + q
        else if (/^\/party-wall-surveyors\/[a-z-]+$/.test(path)) req.url = '/src/html' + path + '.html' + q
        else if (path === '/admin' || path === '/admin/') req.url = '/src/html/admin/index.html' + q
        next()
      })
    },
  }
}

export default defineConfig({
  root,
  appType: 'mpa',
  plugins: [
    tailwindcss(),
    handlebars({
      partialDirectory: resolve(root, 'src/html/partials'),
      context: pageContext,
    }),
    copyRuntimeData(),
    writeSeoFiles(),
    radarPrerender(),
    productionLayout(),
    prodUrlsInDev(),
    adminApiInDev(),
  ],
  resolve: {
    alias: { '@': resolve(root, 'src') },
  },
  server: {
    port: 5179,
    host: true,
    open: '/',
  },
  build: {
    outDir: resolve(root, 'dist'),
    emptyOutDir: true,
    rollupOptions: { input },
  },
})
