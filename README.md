# NearMe by Corelain

A static UK area dashboard for Greater Manchester, Trafford and its towns, from Corelain's surveyors. It shows property prices, rents, renting vs owning, population, pay, crime, schools, transport routes, flood (with live warnings) and mining risk, air quality, conservation areas and planning, the UK's top mortgage lenders, plus Party Wall pages.

There is no backend:

```
official open data ──► scripts/data (Python, GitHub Actions) ──► public/data/areas/<area>.json ──► static Vite site
```

- **No server, database or Supabase/Firebase.** The browser reads the JSON files.
- **Scheduled refresh.** A GitHub Actions workflow refreshes the JSON on a schedule and commits only the files that changed.
- **No hard-coded figures.** Nothing in the HTML or JS carries a figure. If a metric has no data, the page shows "—".

## Quick start

```sh
npm install
npm run dev                      # http://localhost:5179/  ·  /?area=sale  ·  /?area=greater-manchester  ·  /party-wall-surveyors/sale
python3 scripts/data/run.py      # refresh every area JSON (Python 3.9+, standard library only)
npm run build                    # static site in dist/ (deployable as-is)
```

Before you commit, run `npm run build` and check that it completes without errors.

## Data pipeline

| Path | What it is |
| --- | --- |
| `scripts/data/run.py` | Entry point. Runs the collectors, merges the hand-entered values and writes `public/data/areas/<id>.json` plus `index.json`. A file is rewritten only when its content changes. |
| `scripts/data/collectors/` | One module per source (see the table below). |
| `scripts/data/config/areas.json` | Area definitions: ward set, Land Registry locality or whole borough, plus the map centre. Keep the ids in step with `src/js/data/areas.js`. |
| `scripts/data/manual/<id>.json` | Values entered by hand (see "Fields updated by hand"). |
| `scripts/data/.cache/` | Download and postcode cache. Git-ignored; in Actions it is kept with `actions/cache`. |
| `.github/workflows/refresh-area-data.yml` | Scheduled and manual refresh. Commits changed JSON only. |

Run part of the pipeline:

```sh
python3 scripts/data/run.py --only crime,schools   # selected collectors; the others keep their previous values
python3 scripts/data/run.py --only none            # re-merge the manual files only
python3 scripts/data/run.py --force                # re-download files that have not changed
```

If a collector fails, the previous values for its metrics are kept, so one broken source never blanks the site. The error appears in the workflow log.

### Metric format

Every metric in `public/data/areas/<id>.json` has the same shape:

```json
"average_price": {
  "value": 454016,
  "period": "12 months to 31 Jul 2026",
  "geography": "Trafford (local authority)",
  "source": { "name": "HM Land Registry Price Paid Data", "url": "…", "licence": "Open Government Licence v3.0" },
  "status": "ok",
  "sample": 2693
}
```

`status` is one of the following:

| Status | Meaning |
| --- | --- |
| `ok` | Data is present and reliable. |
| `low-confidence` | A small sample: fewer than 30 sales, or only a few schools. |
| `manual` | Entered by hand; `reviewed` holds the date it was last checked. |
| `no-data` | The source has nothing for this area. For example, fewer than 5 sales gives no price. |
| `unavailable` | No usable source. The page shows "No source available". |
| `disabled` / `missing-key` | The source is not licensed for reuse, or a paid API key is not set. The page shows "No source available". |
| `error` | The collector failed and there was no earlier value to keep. |

## Active sources

These are the FINAL sources from `Feature_List1_Source4-5.xlsx`.

| Metric (page card) | FINAL source | How it is collected | Geography | Refresh |
| --- | --- | --- | --- | --- |
| Average property value, price trend, prices by type | HM Land Registry Price Paid Data | SPARQL endpoint, standard-price sales only. Postcodes are placed in wards and LSOAs via postcodes.io. | Wards per area; Land Registry locality for small villages; whole borough for Trafford | Monthly, around the 20th working day |
| Annual growth % | Price Paid (area) + UK House Price Index (borough and UK comparison) | CSV download | Area / Trafford / UK | Monthly |
| Crime rating | Home Office police recorded crime, Community Safety Partnership tables + ONS mid-year population (Nomis) | `.ods` from GOV.UK, streamed. Downloaded again only when GOV.UK lists a new file. | Borough-wide; Greater Manchester Police publishes no street-level data | Quarterly |
| School rating | Ofsted management information, latest inspections (monthly CSV) | CSV from GOV.UK. Report cards (from November 2025) and older grades become one indicative 0–10 score; the method is stored in the JSON. | 5 nearest state primary and secondary schools; all Trafford schools for the borough | Monthly |
| Transport score | DfT Transport Connectivity Metric | `.ods` from GOV.UK, streamed. Downloaded again only when a new file is listed. | Mean of the area's LSOAs; DfT's own figure for the borough | Yearly |
| Air quality | Defra LAQM background maps (1 km grid) | Official CSV download per local authority | 1 km squares within 1.5 km of the centre | Yearly; projections for the current year |
| Conservation area status | planning.data.gov.uk | Entity API: areas within 1.5 km of the centre, and whether the centre lies inside one | Area / borough | Weekly |
| Mining risk | Mining Remediation Authority (Coal Authority) Data Mine | ArcGIS FeatureServer: Development High / Low Risk Area layers | Area centre; borough extent | Weekly |
| Radon screening | UKHSA / BGS Indicative Atlas of Radon | Public ArcGIS service, 1 km indicative class at the area centre | 1 km grid square | Weekly |
| Natural ground-movement screening | BGS GeoSure open 5 km hex grid | Public ArcGIS service; highest of shrink–swell, landslide, compressible, collapsible, running-sand and soluble-rock classes | 5 km generalised hexagon | Weekly |
| Planning constraints (listed buildings, Article 4, Green Belt, tree preservation, scheduled monuments) | planning.data.gov.uk (MHCLG / Historic England) | Entity API | Within 1.5 km; Green Belt at the centre; borough extent | Weekly |
| Major developments (housing sites) | planning.data.gov.uk — council brownfield land registers | Entity API. Capacity is read from the register, or from its notes where the council left the field blank. | Within 1.5 km; whole borough | Weekly; councils update yearly. Trafford's entries date from 2017. |
| Flood risk (rivers & sea) | Environment Agency Flood Zones 2/3 (via planning.data.gov.uk) | Entity API: zone at the centre, zone 2/3 land within 1 km | Area centre / 1 km | Weekly |
| AQMA | Defra air quality management areas (via planning.data.gov.uk) | Entity API | Centre and 1.5 km | Weekly |
| Nearby places | OpenStreetMap (Overpass API, ODbL — "© OpenStreetMap contributors") | Stations, tram stops, parks, museums, shopping centres, stadiums, libraries, hospitals | 2.5 km; 6 km for the borough | Weekly |
| Estate agents | OpenStreetMap (`shop=estate_agent`) | Overpass API. Coverage is patchy, so a Zoopla search link is always shown too. | 4 km | Weekly |
| Nearest stops (transport card) | NaPTAN (DfT) | Nearest Metrolink stop and rail station with an estimated walk, bus stops within 400 m, distance to the city centre | Area centre | Weekly |
| Local headlines | Altrincham Today, Manchester Evening News (Trafford, towns, Greater Manchester), Messenger Newspapers, Warrington Guardian and BBC Manchester RSS | Publisher feeds filtered by each area's include/exclude terms. Each area shows its own headlines plus "surrounding area" headlines (the neighbouring towns' matches, then the regional feeds); the page filters All / area / surrounding. Titles, links, dates and publisher names only | All configured areas | Weekly |
| Average rent | ONS Price Index of Private Rents ([Housing prices in your area](https://www.ons.gov.uk/visualisations/housingpriceslocal/E08000009/)) | The JSON behind the ONS page: monthly average rent, by bedrooms and type, with region and England | Local authority (towns show their borough); Greater Manchester = mean of its ten boroughs | Monthly |
| Rent vs ownership | ONS Census 2021, tenure TS054 (as in [How life has changed: Census 2021](https://www.ons.gov.uk/visualisations/censusareachanges/E08000009/)) | Nomis API | Area LSOAs (as transport) / borough / ten boroughs | Census 2021 |
| Population & households | ONS Census 2021 TS001, TS007A, TS054 (as in [Trafford Data Lab: Population & Households](https://www.trafforddatalab.io/accessible_graphics/census_2021_population_and_households_infographic.html)) | Nomis API; residents, households, household size, age groups vs borough and England | Area LSOAs / borough / ten boroughs | Census 2021 |
| Average pay | ONS Annual Survey of Hours and Earnings (resident analysis) | Nomis API: median gross annual pay, full-time, vs Greater Manchester and England | Borough | Yearly (October) |
| Trams, trains and buses | TfGM GTFS timetable (OGL) + `config/rail-lines.json` | Metrolink lines and bus services stopping within 1 km of the centre with their end points (e.g. 192 Manchester – Stockport – Hazel Grove); stations from NaPTAN with lines checked by hand (TfGM's GTFS has no National Rail) | Area centre; borough = all its towns; Greater Manchester = whole network | Weekly (timetable); rail lines by hand at each timetable change |
| Flood warnings (live) | Environment Agency real-time flood-monitoring API | Fetched by the browser; a banner appears only when a flood alert or warning is in force within 5 km (12 km borough, 30 km Greater Manchester) | Area centre | Live |

The browser makes two live third-party requests, both free and keyless, at the area centre: the European AQI gauge (Open-Meteo) and Environment Agency flood warnings.

**Greater Manchester overview** (`/?area=greater-manchester`, `kind: "region"` in `areas.json`): prices come from the UK HPI county series (`ukhpi.py`), crime adds up the ten CSPs, schools / air quality / Census use all ten boroughs, the transport score is the mean of the ten DfT borough figures. Conservation, planning and developments are not compiled for the region, and their cards are hidden on that view.

**Top mortgage lenders** is a static card in the page (the UK "Big Six" by share of gross lending, from Pauzible's guide). Check the shares when Pauzible updates its article.

## Fields updated by hand

These live in `scripts/data/manual/<area-id>.json`. Each block becomes a metric with `status: "manual"` and the file's `reviewed` date.

| Field | Why it is entered by hand | Where to check it | Suggested review |
| --- | --- | --- | --- |
| `flood_risk` (optional) | Adds the per-source EA levels, including surface water. The flood zones are already automatic. | check-long-term-flood-risk.service.gov.uk | Every 6 months |
| `aqma_roadside` (optional) | Roadside NO₂ from council monitoring; the AQMA itself is automatic | Council air quality report | Yearly |
| `journey` (optional) | Door-to-city-centre time; nearest stops are automatic | TfGM timetables | Every 6 months |
| `developments` (optional) | Headline schemes such as the stadium; brownfield sites are automatic | Trafford Council planning search, news | Monthly |
| `places` (optional) | A curated list here replaces the OpenStreetMap list for that area | Public pages | Every 6 months |

Today only `trafford.json` and `old-trafford.json` have manual files. The automatic sources fill radon screening, generalised ground-movement screening, flood zones, AQMA, brownfield developments, planning constraints, places, stops and matching local RSS headlines for every area. To add one, copy `old-trafford.json`, rename it to the area id and run `python3 scripts/data/run.py --only none`.

Only the keys in `MANUAL_KEYS` (`scripts/data/run.py`) are read. Anything else sits in the file unused, and the admin panel marks it "Ignored by the site".

RSS matching rules live in `scripts/data/config/rss-feeds.json`, based on the v1.2 `rss-feeds.json`, `rss2.json` and `RSS_Haber_Kaynaklari.xlsx` catalogues. Bing News fallback feeds are not used in production. Article text is not copied. When an RSS item supplies a secure media/enclosure URL, its publisher-hosted image is referenced directly; otherwise the card falls back to a local Corelain category image.

The free radon and GeoSure layers are screening datasets, not property reports. Radon uses the highest class in a 1 km square. GeoSure uses a generalised 5 km hexagon and is stored as `low-confidence`; the UI says so. Buyers should still run an address-level check or survey.

Reviews: real client reviews go in `src/js/data/reviews.js`. The section stays hidden while that file is empty.

## Admin panel (`/admin`)

A small panel for the people who run the site. There is no database: everything it edits is a JSON file in this repository, and a save commits that file through the GitHub API (`api/admin.js`, a Vercel Function). Vercel then redeploys the site; files the data pipeline reads also re-run the refresh workflow.

| Tab | What it does | File |
| --- | --- | --- |
| Data freshness | Age and status of every data source, failed metrics, the latest GitHub Actions refresh runs, a "Refresh now" button, and review dates for the hand-entered items | reads `public/data/areas/*.json` |
| Services & lenders | The services strip at the top of the page and the Top Mortgage Lenders card | `src/data/site-content.json` |
| Train lines | Lines calling at each station (TfGM's GTFS has no National Rail) | `scripts/data/config/rail-lines.json` |
| Reviews | "What our clients say" (hidden while empty) | `src/data/reviews.json` |
| Area hand-entered data | Developments, journey, flood detail, curated places per area | `scripts/data/manual/<area>.json` |
| Cover photos | The picture behind an area page's title. One upload is cut into the six sizes in the browser and saved in a single commit; an area without one uses the default. | `public/images/hero/<area>-*.jpg` + `src/data/hero-covers.json` |

**Set-up on Vercel** (Project Settings → Environment Variables), then redeploy:

| Variable | Value |
| --- | --- |
| `ADMIN_USER` / `ADMIN_PASSWORD` | The panel login |
| `SESSION_SECRET` | A long random string (`openssl rand -hex 32`) |
| `GITHUB_TOKEN` | Fine-grained token for this repository: **Contents: Read and write**, **Actions: Read and write** |
| `GITHUB_REPO` | `fstopcreative/NearMe` — the repository this deployment is built from. A wrong value, or a token without access to it, makes every admin form report its file as missing. |
| `GITHUB_BRANCH` / `GITHUB_WORKFLOW` | Optional; default `main` / `refresh-area-data.yml` |

**When the panel refuses to load or save.** Everything it edits goes through the GitHub API, so its errors are the token's:

| What the panel says | What it means |
| --- | --- |
| *… is not in the repository* | The file is missing on that branch, or `GITHUB_REPO` points at another repository (the old `CRADAR-v4`, say). |
| *Resource not accessible by personal access token* | The token reaches the repository but lacks the permission for that call: **Contents: Read and write** to save, **Actions: Read and write** for the refresh button. Fine-grained tokens on an organisation repository also need the owner to approve them. |
| *GitHub rejected the token* | `GITHUB_TOKEN` is wrong or expired. |

Check a token before putting it in Vercel:

```bash
GITHUB_REPO=fstopcreative/NearMe GITHUB_TOKEN=github_pat_… node scripts/check-github-token.mjs
```

Environment variables take effect on the next deployment: change them, then redeploy.

**Locally**, put `ADMIN_USER`, `ADMIN_PASSWORD` and `SESSION_SECRET` in `.env` or `.env.local` (both git-ignored) and open `http://localhost:5179/admin`. Without `GITHUB_TOKEN` the panel saves straight to your working copy, and the refresh buttons are disabled.

The session is a signed, HttpOnly cookie valid for 12 hours. The API only reads or writes the files listed above, checks that links start with `https://`, and refuses state-changing requests that do not come from the panel. `/admin` and `/api/` are kept out of search engines.

## Adding an area

There is no admin form for this: an area has to exist in the collector config
*and* in the browser's list, and the two are different languages. It is four
steps, and the first one is the only one that needs care.

**1 · Tell the collectors about it** — `scripts/data/config/areas.json`:

```json
{
  "id": "chorlton",
  "name": "Chorlton",
  "borough": "Manchester",
  "lad": "E08000003",
  "csp": "Manchester",
  "county": "Greater Manchester",
  "postcode": "M21",
  "match": { "wards": ["Chorlton", "Chorlton Park"] },
  "centre": { "lat": 53.4426, "lng": -2.2795 }
}
```

`match` decides which statistics the area is built from, and is the one field
that fails quietly. Pick the form that fits:

| `match` | Use it when | Source |
| --- | --- | --- |
| `{"wards": ["…"]}` | Normal case — a town or suburb | ONS Wards (Dec 2024), within `lad` |
| `{"localities": ["…"], "districts": ["…"]}` | Villages with no ward of their own | Parishes, matched by name |
| `{"lad": "E08000009"}` | A whole borough | Local Authority Districts |
| `{"region": …}` | A multi-borough view | The ten GM districts together |

Ward names must match ONS **exactly**, including `&` and spelling. A name that
does not match produces no error: the area simply gets no population, tenure or
price data, and `census.py` falls back to the single LSOA at `centre`. If an
area's population looks suspiciously round or small, this is why. Put `centre`
inside the area, since several metrics use a radius around it.

**2 · Put it in the browser's list** — `src/js/data/areas.js`. One line; the
`id` is derived from `name`, so it must match the config id:

```js
{ name: 'Chorlton', county: 'Greater Manchester', borough: 'Manchester', postcode: 'M21' },
```

Add `focus: true` only if the area is also to get a Party Wall page (step 5).

**3 · Collect the data:**

```sh
python3 scripts/data/run.py            # or run the workflow from the admin panel
```

Check the new `public/data/areas/<id>.json`: `population.geography` should read
"*N* census LSOAs", not "1 census LSOA", unless the area really is that small.

**4 · Fit the map to it:**

```sh
python3 scripts/area-bounds.py         # ONS extents → src/data/area-bounds.json
```

Without this the map opens at a default zoom and the area may sit off-frame.
If the boundary Google draws is wider than the statistical one (a suburb that
shares a ward), widen just the map with `MAP_EXTRA_WARDS` in that script —
it does not affect any figure.

**5 · Optional, a Party Wall page.** Add a `dict(...)` entry to
`src/seo/townships.py` (intro, conservation areas, notes), set `focus: true` in
step 2, then regenerate:

```sh
python3 src/seo/townships.py           # pages + pw-areas strip + sitemap + llms.txt
```

**6 · Optional, a cover photo.** Upload one in the admin panel's *Cover photos*
tab. Without it the area uses the default picture, which is fine.

Finally `npm run build`, confirm the area loads at `/?area=<id>`, and commit.

## Update schedule

`.github/workflows/refresh-area-data.yml` runs (GitHub must allow the workflow to push: Settings → Actions → General → Workflow permissions → **Read and write permissions**):

- **Every Monday at 05:30 UTC.** This picks up new Ofsted, crime, UK HPI, conservation and coal data.
- **On the 23rd of each month at 06:30 UTC.** This runs after HM Land Registry's monthly Price Paid release.
- **After a save in the admin panel** to a file the pipeline reads (`scripts/data/config/`, `scripts/data/manual/`).
- **On demand.** Use "Refresh now" in the admin panel, or go to Actions → "Refresh area data" → Run workflow. You can optionally list collectors and/or force a re-download.

Each run commits only the `public/data/areas/*.json` files that actually changed. The commit message is `data: refresh area JSON (YYYY-MM-DD)`.

## Deploying to Vercel

The project is ready for Vercel: Node (`engines: >=22`), `npm ci`, `npm run build` and the
`dist` output directory are declared in the repository. The clean production
URL is `/`; area selection uses `/?area=sale`, and Party Wall pages use
`/party-wall-surveyors/sale`.

**Recommended Git deployment:**

1. Make this `CRADAR` folder the root of a GitHub repository and push it.
2. In Vercel choose **Add New → Project**, import that GitHub repository and click **Deploy**. No build fields need to be changed; `vercel.json` supplies them.
3. Vercel supplies its generated production URL automatically. For a custom domain, add `SITE_URL=https://your-domain.example` under **Project Settings → Environment Variables**, then redeploy.
4. Optional: enable Vercel Web Analytics and set `VERCEL_ANALYTICS=true`. Set `GA4_ID=G-XXXXXXXXXX` only if Google Analytics is required.
5. In GitHub, open **Settings → Actions → General → Workflow permissions** and select **Read and write permissions**. The scheduled data workflow can then commit refreshed JSON; every commit triggers a new Vercel deployment.

This folder is the repository root, so Vercel's **Root Directory** stays empty.
If it is ever moved inside a larger repository, set Root Directory to that
sub-folder, and keep the workflow files in the repository's own root
`.github/workflows/` folder — GitHub only runs them from there.

`node_modules/` and `dist/` are not committed: Vercel installs and builds from
the lockfile on every push.

For a local check before pushing:

```sh
npm ci
npm run build
npm run preview
```

Open `http://localhost:4173/`. Put local settings (admin login, tokens) in
`.env` or `.env.local`; every `.env*` file is excluded from Git.

## Where things live (front end)

| Path | What it is |
| --- | --- |
| `src/html/dashboards/area-radar.html` | The page. `data-m="…"` elements are text values and `data-r="…"` elements are rendered blocks. |
| `src/js/radar/format.js` | Formatting, tokens for the FAQ, and the indicative scorecard |
| `src/js/radar/render.js` | HTML for every data-driven block, the FAQ and the JSON-LD. Pure functions shared by the browser and the build. |
| `src/js/radar/apply.js` · `load.js` | Browser side: fetch the area JSON and apply it |
| `src/js/radar/prerender.js` | Build side: fill the default view (used by `vite.config.js`) |
| `src/data/faq-templates.json` | FAQ questions and answers with `{tokens}`. A question is dropped when its data is missing. |
| `src/js/pages/area-radar.js` | The combined, filterable chart card (every chart view), sparklines, gauges, live AQI and live flood warnings |
| `src/js/pages/area-radar-actions.js` | Search, Compare (real figures from both areas' JSON) and the map component |
| `src/seo/townships.py` | Party Wall area pages, sitemap and the llms.txt areas block |
