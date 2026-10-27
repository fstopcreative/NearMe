"""
Corelain — Party Wall area pages (MKT-01 "township pages" + "local authority page").

Run from CRADAR/:  python3 src/seo/townships.py
It writes:
  src/html/party-wall-surveyors/<area>.html  one page per Trafford focus area
  src/html/party-wall-surveyors/trafford.html the borough (local authority) hub
  src/html/partials/pw-areas.html             "Areas we cover" strip (all pages)
  src/seo/sitemap.xml                         every indexable URL
  src/seo/llms.txt                            block between the AREAS markers

Each page carries facts that are specific to the area (postcode, council,
conservation areas, housing, typical projects) so the pages are not
near-duplicates. Keep the facts checkable: designations come from Trafford
Council's conservation area list.
The area list must match FOCUS ids in src/js/data/areas.js.
"""
import html
import json
import re
from pathlib import Path

# Party Wall questions are shared with the main FAQ (src/data/faq-templates.json)
TEMPLATES = json.loads((Path(__file__).resolve().parents[1] / 'data' / 'faq-templates.json').read_text())
CHEV = ('<svg class="cr-faq__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6l6 -6"/></svg>')

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / 'src/html/party-wall-surveyors'
AREAS_PARTIAL = ROOT / 'src/html/partials/pw-areas.html'
SITEMAP = ROOT / 'src/seo/sitemap.xml'
LLMS = ROOT / 'src/seo/llms.txt'

PW_URL = 'https://www.corelain.com/party-wall-surveyor-manchester'
ENQUIRY = PW_URL + '#partywall-enquiry'
TRAFFORD_PLANNING = 'https://pa.trafford.gov.uk/online-applications/'
WARRINGTON_PLANNING = 'https://www.warrington.gov.uk/planning'

# id, name, postcode, borough, geo (lat, lng), intro, housing, projects, conservation, notes, extra FAQ
AREAS = [
    dict(id='old-trafford', name='Old Trafford', pc='M16', borough='Trafford', geo=(53.4600, -2.2790),
         intro='Old Trafford is one of Trafford\'s most densely built neighbourhoods, with long Victorian and Edwardian terraces either side of Chester Road. Almost every house shares a party wall, so loft conversions, rear extensions and flat conversions here nearly always need a notice.',
         housing='Terraced streets make up most of the housing, with apartment blocks along Chester Road and Trafford Wharfside and interwar semi-detached pockets around Seymour Park. Terraces and flats together accounted for about nine in ten sales recorded over the last three years, so shared walls are the norm.',
         projects=['Loft conversions', 'Single-storey rear extensions', 'Flat and HMO conversions', 'Chimney breast removal'],
         conservation=['Empress Conservation Area (Chester Road / Empress Street)'],
         notes='Trafford\'s 2018 HMO Article 4 direction covers Old Trafford, so a small house-share conversion needs planning permission as well as any party wall notices.',
         faq=[('Does converting an Old Trafford terrace into flats need a party wall notice?',
               'Usually. Splitting a terraced house normally means new floors, sound insulation and steel bearing into the party wall, which is work under section 2 of the Act and needs two months\' notice to each adjoining owner.')]),
    dict(id='stretford', name='Stretford', pc='M32', borough='Trafford', geo=(53.4466, -2.3086),
         intro='Stretford\'s Victorian and Edwardian terraces and interwar semi-detached streets share party walls almost everywhere, so rear extensions and loft conversions here usually involve the Party Wall Act.',
         housing='Long runs of terraced houses around the town centre and Edge Lane, with 1930s semi-detached homes further out. Most houses share at least one party wall, and many rear gardens meet along a party fence wall.',
         projects=['Loft conversions with steel beams', 'Single-storey rear extensions', 'Kitchen side returns', 'Chimney breast removal'],
         conservation=['Longford Park Conservation Area'],
         notes='Stretford sits on the Metrolink Altrincham line, close to the Old Trafford regeneration area.',
         faq=[('Are party wall notices common in Stretford?',
               'Yes. Most Stretford homes are terraced or semi-detached, so loft conversions, chimney breast removal and rear extensions usually involve work to a party wall or excavation near a neighbour\'s foundations.')]),
    dict(id='sale', name='Sale', pc='M33', borough='Trafford', geo=(53.4246, -2.3226),
         intro='Sale combines Victorian villas and terraces near the Bridgewater Canal with large interwar semi-detached estates, so loft conversions and two-storey extensions here often need a party wall notice.',
         housing='Victorian and Edwardian terraces and villas near the town centre and canal, and extensive 1930s semi-detached streets towards Brooklands and Ashton upon Mersey.',
         projects=['Loft conversions', 'Two-storey side extensions', 'Rear kitchen extensions', 'Basement and cellar conversions'],
         conservation=['Brogden Grove Conservation Area', 'Ashton-on-Mersey Village Conservation Area'],
         notes='The Bridgewater Canal runs through the centre of Sale.',
         faq=[('Does a side extension on a semi-detached house in Sale need a party wall notice?',
               'Often. A side extension on a 1930s semi usually needs new foundations close to the neighbour\'s house, and may build a wall on the boundary line, which brings in sections 1 and 6 of the Act.')]),
    dict(id='hale-barns', name='Hale Barns', pc='WA15', borough='Trafford', geo=(53.3700, -2.3060),
         intro='Hale Barns is mostly large detached homes on generous plots. Even with no shared wall, deep foundations, basements and replacement houses near the boundary often fall under section 6 of the Party Wall Act.',
         housing='Large detached houses, many rebuilt or heavily extended, on wide plots. Party walls are rare, but neighbouring buildings are often within 3 to 6 metres of new foundations.',
         projects=['Replacement dwellings', 'Basements', 'Two-storey extensions', 'Garages and outbuildings near the boundary'],
         conservation=[],
         notes='No conservation area of its own; the South Hale and Ashley Heath conservation areas are in neighbouring Hale.',
         faq=[('Do detached houses in Hale Barns need party wall notices?',
               'They can. Section 6 of the Act covers excavation within 3 metres of a neighbour\'s building, or within 6 metres for deeper foundations, whether or not the houses share a wall. Basements and replacement houses often trigger it.')]),
    dict(id='hale', name='Hale', pc='WA15', borough='Trafford', geo=(53.3786, -2.3483),
         intro='Hale\'s Victorian and Edwardian villas, many inside conservation areas, are often extended with basements and large rear extensions that need careful party wall planning.',
         housing='Substantial Victorian and Edwardian villas and semi-detached houses around Hale station and village, with later infill. Many sit inside one of three conservation areas.',
         projects=['Basements', 'Large rear extensions', 'Loft conversions', 'Boundary walls'],
         conservation=['Hale Station Conservation Area', 'South Hale Conservation Area', 'Ashley Heath Conservation Area'],
         notes='Conservation area rules add planning steps, but they do not replace the Party Wall Act.',
         faq=[('Does being in a Hale conservation area change the party wall process?',
               'No. Conservation area consent and planning rules are separate from the Party Wall Act. If the work is notifiable you still need to serve notice, even with planning permission in place.')]),
    dict(id='timperley', name='Timperley', pc='WA15', borough='Trafford', geo=(53.3970, -2.3240),
         intro='Timperley is a large interwar and post-war suburb of semi-detached houses. Side extensions, rear extensions and loft conversions on a semi almost always involve the party wall itself or excavation close to the neighbour\'s foundations.',
         housing='Mostly 1930s and post-war semi-detached houses across Timperley Central and Timperley North, with terraces near the village and the Metrolink stop and newer flats on infill plots. Semi-detached homes were more than half of all sales recorded over the last three years.',
         projects=['Two-storey side extensions', 'Loft conversions with steel beams', 'Rear kitchen extensions', 'Garage conversions'],
         conservation=[],
         notes='No conservation area in Timperley itself; the nearest Trafford designations are the Altrincham ones, a little over a mile away.',
         faq=[('Do I need a party wall notice to convert a garage in Timperley?',
               'Often yes. Many Timperley semis have a garage against the boundary or attached to the neighbour\'s, so cutting a new opening, raising the wall or underpinning it is notifiable work under section 2 of the Act.')]),
    dict(id='carrington', name='Carrington', pc='M31', borough='Trafford', geo=(53.4361, -2.3946),
         intro='Carrington is changing fast, with new housing planned around the village. Building next to existing homes, and extending older houses in the village, can both bring in the Party Wall Act.',
         housing='A small village with older cottages and terraces, surrounded by former industrial land and Carrington Moss. New housing is planned under the New Carrington allocation in the Places for Everyone plan.',
         projects=['Rear extensions', 'Loft conversions', 'Building next to existing homes', 'Excavation for new foundations'],
         conservation=[],
         notes='Large new developments must serve notices on existing neighbours where their excavation or boundary walls come close.',
         faq=[('Do new housing developments in Carrington have to serve party wall notices?',
               'Yes, where their work is notifiable. A developer digging foundations within 3 or 6 metres of an existing home, or building on the boundary, must serve notice on the owner like anyone else.')]),
    dict(id='partington', name='Partington', pc='M31', borough='Trafford', geo=(53.4194, -2.4265),
         intro='Partington grew rapidly in the 1960s and 1970s as an overspill town, so most homes are semi-detached or terraced and share a party wall with at least one neighbour.',
         housing='Post-war semi-detached and terraced houses from the town\'s 1960s and 1970s expansion, plus newer estates. Shared party walls are the norm.',
         projects=['Single-storey rear extensions', 'Loft conversions', 'Porches and side extensions', 'Chimney breast removal'],
         conservation=[],
         notes='Partington sits between the Manchester Ship Canal and Carrington Moss.',
         faq=[('Does a rear extension on a Partington semi need a party wall notice?',
               'Usually. Rear extensions on semi-detached houses normally need foundations close to the neighbour\'s, and often a wall on the boundary line, so sections 1 and 6 apply.')]),
    dict(id='dunham-massey', name='Dunham Massey', pc='WA14', borough='Trafford', geo=(53.3836, -2.3916),
         intro='Around the National Trust\'s Dunham Massey estate, historic cottages and farm buildings sit in conservation areas and the Green Belt, so extensions need planning, heritage and party wall advice together.',
         housing='Historic cottages, farmhouses and converted farm buildings, often attached, around Dunham Town and Dunham Woodhouses, with larger homes on the edge of Altrincham.',
         projects=['Barn and outbuilding conversions', 'Rear extensions to cottages', 'Repairs to shared walls', 'Underpinning'],
         conservation=['Dunham Town Conservation Area', 'Dunham Woodhouses Conservation Area'],
         notes='Much of the area is Green Belt, which limits the size of extensions.',
         faq=[('Do repairs to an old shared wall in Dunham Massey need a party wall notice?',
               'Often. Repairing, underpinning or rebuilding a party wall is work under section 2 of the Act, and needs two months\' notice to the neighbour unless they agree in writing.')]),
    dict(id='warburton', name='Warburton', pc='WA13', borough='Trafford', geo=(53.4005, -2.4549),
         intro='Warburton is a small rural village in the Green Belt with a historic core. Attached cottages and old boundary walls mean that even modest works can involve the Party Wall Act.',
         housing='Historic cottages, farmhouses and a small number of newer homes along Bent Lane and Paddock Lane, with the village core in a conservation area.',
         projects=['Cottage extensions', 'Barn conversions', 'Rebuilding boundary walls', 'Underpinning'],
         conservation=['Warburton Village Conservation Area'],
         notes='The village is in the Green Belt, south of the Manchester Ship Canal and the Warburton toll bridge.',
         faq=[('Is a garden boundary wall covered by the Party Wall Act in Warburton?',
               'It can be. A wall standing astride the boundary and separating two gardens is a party fence wall, so raising, rebuilding or underpinning it needs notice.')]),
    dict(id='urmston', name='Urmston', pc='M41', borough='Trafford', geo=(53.4487, -2.3540),
         intro='Urmston\'s Edwardian terraces and interwar semis share party walls street after street, making loft conversions and rear extensions the most common reasons for a party wall notice here.',
         housing='Edwardian and Victorian terraces near the town centre and station, interwar semi-detached houses towards Flixton and Davyhulme, and some post-war estates.',
         projects=['Loft conversions', 'Rear and side return extensions', 'Chimney breast removal', 'Structural alterations'],
         conservation=[],
         notes='No conservation area in Urmston itself; Flixton Village Conservation Area is next door.',
         faq=[('Does removing a chimney breast in an Urmston terrace need a party wall notice?',
               'Usually. A chimney breast on a party wall is part of that wall, so removing it is work under section 2 and needs two months\' notice unless the neighbour agrees in writing.')]),
]

ICO_PIN = '<path d="M9 11a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"/><path d="M17.657 16.657l-4.243 4.243a2 2 0 0 1 -2.827 0l-4.244 -4.243a8 8 0 1 1 11.314 0"/>'
ICO_EXT = '<path d="M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6"/><path d="M11 13l9 -9"/><path d="M15 4h5v5"/>'
ICO_ARROW = '<path d="M5 12l14 0"/><path d="M13 18l6 -6"/><path d="M13 6l6 6"/>'
ICO_PHONE = '<path d="M5 4h4l2 5l-2.5 1.5a11 11 0 0 0 5 5l1.5 -2.5l5 2v4a2 2 0 0 1 -2 2a16 16 0 0 1 -15 -15a2 2 0 0 1 2 -2"/>'
ICO_CHART = '<path d="M3 13a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z"/><path d="M15 9a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z"/><path d="M9 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z"/><path d="M4 20h14"/>'
SEP = '<li class="ax-breadcrumb__sep" aria-hidden="true"><svg class="ax-icon ax-icon--directional" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6l-6 6"/></svg></li>'

e = html.escape


def svg(paths, cls=''):
    c = f' class="{cls}"' if cls else ''
    return (f'<svg{c} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" '
            f'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{paths}</svg>')


def pw_questions(area_name):
    """Party Wall FAQ (homeowners + neighbours) with the area filled in."""
    out = []
    for topic in TEMPLATES['topics']:
        if topic['key'] in ('partywall', 'notice'):
            out += [(it['q'].replace('{area}', area_name), it['a'].replace('{area}', area_name)) for it in topic['items']]
    return out


def faq_html(qa):
    items = ''.join(f'''
            <details class="cr-faq__item"{' open' if i == 0 else ''}>
              <summary><h3 class="cr-faq__q">{e(q)}</h3>{CHEV}</summary>
              <p class="cr-faq__a">{e(a)}</p>
            </details>''' for i, (q, a) in enumerate(qa))
    return items


def crumbs(trail):
    """trail: [(label, href|None)]"""
    out = []
    for i, (label, href) in enumerate(trail):
        last = i == len(trail) - 1
        inner = f'<a href="{href}">{e(label)}</a>' if href and not last else f'<span>{e(label)}</span>'
        cur = ' aria-current="page"' if last else ''
        out.append(f'<li class="ax-breadcrumb__item"{cur}>{inner}</li>')
    return SEP.join(out)


def jsonld(graph):
    return ('  <script type="application/ld+json">\n'
            + json.dumps({'@context': 'https://schema.org', '@graph': graph}, ensure_ascii=False, indent=2)
            + '\n  </script>')


def org_ref():
    return {'@id': '{{siteUrl}}/#org'}


def page(*, path, title, desc, og_title, h1, eyebrow, lead, trail, body, graph, geo=None, region='GB-TRF', place=''):
    geo_params = ''
    if geo:
        geo_params = (f'\n  geoRegion="{region}" geoPlace="{place}" '
                      f'geoPosition="{geo[0]};{geo[1]}" geoIcbm="{geo[0]}, {geo[1]}"')
    return f'''<!doctype html>
<!-- GENERATED by src/seo/townships.py — edit there, then run: python3 src/seo/townships.py -->
<html lang="en-GB" data-ax-route="party-wall-surveyors" data-cr-shell="topbar" data-cr-title>
<head>{{{{> head
  seoTitle="{title}"
  seoDescription="{desc}"
  ogTitle="{og_title}"
  ogImageAlt="Corelain Party Wall surveyors — {h1}"
  canonical="{path}"{geo_params}
}}}}</head>
<body>
  <div class="ax-ambient" aria-hidden="true"><i></i></div>
  <div class="ax-layout">
    <div class="ax-shell">
      {{{{> header}}}}
      <main class="ax-main" id="ax-main">
        <section class="cr-twn-hero" role="region" aria-labelledby="cr-twn-h1">
          <nav class="ax-breadcrumb cr-twn-hero__crumbs" data-cr-static aria-label="Breadcrumb">
            <ol class="ax-breadcrumb__list">{crumbs(trail)}</ol>
          </nav>
          <span class="cr-twn-hero__eyebrow">{e(eyebrow)}</span>
          <h1 class="cr-twn-hero__title" id="cr-twn-h1">{e(h1)}</h1>
          <p class="cr-twn-hero__lead">{e(lead)}</p>
          <div class="cr-twn-hero__ctas">
            <a class="cr-twn-btn cr-twn-btn--light" href="{ENQUIRY}" target="_blank" rel="noopener" data-cr-cta="area-page-hero">Request a free consultation {svg(ICO_ARROW)}</a>
            <a class="cr-twn-btn cr-twn-btn--ghost" href="tel:01618201121" data-cr-cta="area-page-call">{svg(ICO_PHONE)} 0161 820 1121</a>
          </div>
        </section>

        <div class="ax-dash-grid">
{body}
        </div>
      </main>
      {{{{> footer}}}}
    </div>
  </div>
{jsonld(graph)}
  {{{{> command}}}}
  {{{{> scripts}}}}
  <script type="module" src="/src/js/pages/party-wall.js"></script>
</body>
</html>
'''


def service_node(path, area_served):
    return {
        '@type': 'Service',
        '@id': '{{siteUrl}}' + path + '#service',
        'name': 'Party Wall surveying',
        'serviceType': 'Party Wall surveying',
        'provider': org_ref(),
        'areaServed': area_served,
        'audience': [{'@type': 'Audience', 'audienceType': t} for t in
                     ('Homeowners', 'Adjoining owners', 'Architects and design professionals', 'Builders and professional referrers')],
        'url': PW_URL,
    }


def area_page(a):
    path = f'/party-wall-surveyors/{a["id"]}'
    name, pc, borough = a['name'], a['pc'], a['borough']
    council = f'{borough} Council' if borough == 'Trafford' else f'{borough} Borough Council'
    planning = TRAFFORD_PLANNING if borough == 'Trafford' else WARRINGTON_PLANNING
    title = f'Party Wall Surveyors in {name} ({pc}) | Corelain'
    desc = (f'Party wall surveyors in {name}, {pc}: notices, schedules of condition and awards for '
            f'extensions, lofts and basements. For homeowners, neighbours and architects.')
    ca = a['conservation']
    ca_html = (''.join(f'<li>{e(c)}</li>' for c in ca) if ca else '<li class="is-none">None listed for this area</li>')
    qa = a['faq'] + pw_questions(name)
    hub = 'Party Wall Surveyors in Trafford' if borough == 'Trafford' else 'Party Wall Surveyors'
    trail = [('Area Radar', '/'), (hub, '/party-wall-surveyors/trafford'), (name, None)]

    body = f'''          <!-- area at a glance (4) + local housing & projects (8) -->
          <section class="ax-card ax-col--4 cr-twn-facts" role="region" aria-labelledby="cr-twn-facts-title">
            <div class="ax-card__header"><div class="ax-card__titles">
              <span class="ax-card__eyebrow">At a glance</span>
              <h2 class="ax-card__title" id="cr-twn-facts-title">{e(name)} planning facts</h2>
            </div></div>
            <div class="ax-card__body" style="padding-top:0;">
              <dl class="cr-twn-dl">
                <div><dt>Postcode district</dt><dd class="ax-num">{e(pc)}</dd></div>
                <div><dt>Borough</dt><dd>{e(borough)}</dd></div>
                <div><dt>Planning authority</dt><dd><a href="{planning}" target="_blank" rel="noopener">{e(council)}</a></dd></div>
              </dl>
              <h3 class="cr-twn-sub">Conservation areas</h3>
              <ul class="cr-twn-ca">{ca_html}</ul>
              <p class="cr-card-note">{e(a['notes'])}</p>
              <a class="cr-radon__link cr-card-foot" href="/?area={a['id']}">
                {svg(ICO_CHART)}
                {e(name)} area stats on Area Radar
                <span class="cr-radon__ext">{svg(ICO_ARROW)}</span>
              </a>
            </div>
          </section>

          <section class="ax-card ax-col--8 cr-twn-local" role="region" aria-labelledby="cr-twn-local-title">
            <div class="ax-card__header"><div class="ax-card__titles">
              <span class="ax-card__eyebrow">Local knowledge</span>
              <h2 class="ax-card__title" id="cr-twn-local-title">Homes and party walls in {e(name)}</h2>
            </div></div>
            <div class="ax-card__body" style="padding-top:0;">
              <p class="cr-twn-p">{e(a['housing'])}</p>
              <h3 class="cr-twn-sub">Projects we see most in {e(name)}</h3>
              <ul class="cr-pro__chips">{''.join(f'<li>{e(p)}</li>' for p in a['projects'])}</ul>
              <h3 class="cr-twn-sub">How a party wall instruction works</h3>
              <ol class="cr-steps">
                <li><b>Project review</b><span>Drawings and scope checked against sections 1, 2 and 6.</span></li>
                <li><b>Notice strategy</b><span>Which neighbours, which notices and when, to protect your programme.</span></li>
                <li><b>Serve notices</b><span>Correctly drafted notices served on every adjoining owner.</span></li>
                <li><b>Schedule &amp; award</b><span>The neighbour's property recorded and the award agreed.</span></li>
                <li><b>Close-out</b><span>Post-works check and sign-off.</span></li>
              </ol>
            </div>
          </section>

          {{{{> pw-projects areaHtml='{e(name)}'}}}}
          {{{{> pw-pros}}}}
          {{{{> pw-notice areaHtml='{e(name)}'}}}}

          <section class="ax-card ax-col--12" role="region" aria-labelledby="cr-twn-faq-title">
            <div class="ax-card__header"><div class="ax-card__titles">
              <span class="ax-card__eyebrow">Quick answers</span>
              <h2 class="ax-card__title" id="cr-twn-faq-title">Party Wall questions in {e(name)}</h2>
              <p class="ax-card__subtitle">Based on the Party Wall etc. Act 1996 · reviewed <time datetime="{{{{buildDate}}}}">{{{{buildDate}}}}</time></p>
            </div></div>
            <div class="ax-card__body cr-twn-faq" style="padding-top:0;">{faq_html(qa)}
            </div>
          </section>

          {{{{> pw-areas}}}}'''

    place = {'@type': 'Place', 'name': f'{name}, {borough}',
             'address': {'@type': 'PostalAddress', 'addressLocality': name, 'postalCode': pc,
                         'addressRegion': 'Greater Manchester' if borough == 'Trafford' else 'Cheshire', 'addressCountry': 'GB'},
             'geo': {'@type': 'GeoCoordinates', 'latitude': a['geo'][0], 'longitude': a['geo'][1]}}
    graph = [
        {'@type': 'WebPage', '@id': '{{siteUrl}}' + path + '#webpage', 'url': '{{siteUrl}}' + path,
         'name': title, 'description': desc, 'inLanguage': 'en-GB',
         'isPartOf': {'@id': '{{siteUrl}}/#website'}, 'about': {'@id': '{{siteUrl}}' + path + '#service'},
         'dateModified': '{{buildDate}}', 'publisher': org_ref()},
        {'@type': 'BreadcrumbList', 'itemListElement': [
            {'@type': 'ListItem', 'position': i + 1, 'name': label, 'item': '{{siteUrl}}' + (href or path)}
            for i, (label, href) in enumerate(trail)]},
        service_node(path, place),
        {'@type': 'FAQPage', '@id': '{{siteUrl}}' + path + '#faq',
         'mainEntity': [{'@type': 'Question', 'name': q, 'acceptedAnswer': {'@type': 'Answer', 'text': a_}} for q, a_ in qa]},
    ]
    return path, page(path=path, title=title, desc=desc,
                      og_title=f'Party Wall Surveyors in {name} ({pc})', h1=f'Party Wall Surveyors in {name}',
                      eyebrow=f'Party Wall surveyors · {pc} · {borough}', lead=a['intro'], trail=trail, body=body,
                      graph=graph, geo=a['geo'], region='GB-TRF' if borough == 'Trafford' else 'GB-WRT',
                      place=f'{name}, {borough}')


def hub_page():
    path = '/party-wall-surveyors/trafford'
    title = 'Party Wall Surveyors in Trafford | Corelain'
    desc = ('Party wall surveyors across Trafford: Old Trafford, Stretford, Sale, Hale, Hale Barns, Timperley, Urmston, '
            'Partington, Carrington, Dunham Massey and Warburton. Notices, schedules of condition and awards.')
    cards = ''.join(f'''
              <a class="cr-twn-card" href="/party-wall-surveyors/{a['id']}">
                <span class="cr-twn-card__head"><b>{e(a['name'])}</b><span class="ax-badge ax-badge--soft ax-badge--neutral ax-badge--sm ax-num">{e(a['pc'])}</span></span>
                <span class="cr-twn-card__text">{e(a['intro'])}</span>
                <span class="cr-twn-card__more">Party Wall in {e(a['name'])} {svg(ICO_ARROW)}</span>
              </a>''' for a in AREAS)
    qa = pw_questions('Trafford')
    trail = [('Area Radar', '/'), ('Party Wall Surveyors in Trafford', None)]
    body = f'''          <section class="ax-card ax-col--12" role="region" aria-labelledby="cr-hub-areas-title">
            <div class="ax-card__header"><div class="ax-card__titles">
              <span class="ax-card__eyebrow">Trafford pilot areas</span>
              <h2 class="ax-card__title" id="cr-hub-areas-title">Party Wall advice by area</h2>
              <p class="ax-card__subtitle">Local housing, conservation areas and the projects we see most</p>
            </div></div>
            <div class="ax-card__body" style="padding-top:0;"><div class="cr-twn-cards">{cards}
            </div></div>
          </section>

          {{{{> pw-projects areaHtml='Trafford'}}}}
          {{{{> pw-pros}}}}
          {{{{> pw-notice areaHtml='Trafford'}}}}

          <section class="ax-card ax-col--12" role="region" aria-labelledby="cr-twn-faq-title">
            <div class="ax-card__header"><div class="ax-card__titles">
              <span class="ax-card__eyebrow">Quick answers</span>
              <h2 class="ax-card__title" id="cr-twn-faq-title">Party Wall questions in Trafford</h2>
              <p class="ax-card__subtitle">Based on the Party Wall etc. Act 1996 · reviewed <time datetime="{{{{buildDate}}}}">{{{{buildDate}}}}</time></p>
            </div></div>
            <div class="ax-card__body cr-twn-faq" style="padding-top:0;">{faq_html(qa)}
            </div>
          </section>'''
    graph = [
        {'@type': 'WebPage', '@id': '{{siteUrl}}' + path + '#webpage', 'url': '{{siteUrl}}' + path,
         'name': title, 'description': desc, 'inLanguage': 'en-GB',
         'isPartOf': {'@id': '{{siteUrl}}/#website'}, 'about': {'@id': '{{siteUrl}}' + path + '#service'},
         'dateModified': '{{buildDate}}', 'publisher': org_ref()},
        {'@type': 'BreadcrumbList', 'itemListElement': [
            {'@type': 'ListItem', 'position': 1, 'name': 'Area Radar', 'item': '{{siteUrl}}/'},
            {'@type': 'ListItem', 'position': 2, 'name': 'Party Wall Surveyors in Trafford', 'item': '{{siteUrl}}' + path}]},
        service_node(path, [{'@type': 'AdministrativeArea', 'name': 'Trafford'}] +
                     [{'@type': 'Place', 'name': f'{a["name"]}, {a["borough"]}'} for a in AREAS]),
        {'@type': 'ItemList', 'name': 'Party Wall surveyors by area in Trafford',
         'itemListElement': [{'@type': 'ListItem', 'position': i + 1, 'name': a['name'],
                              'url': '{{siteUrl}}/party-wall-surveyors/' + a['id']} for i, a in enumerate(AREAS)]},
        {'@type': 'FAQPage', '@id': '{{siteUrl}}' + path + '#faq',
         'mainEntity': [{'@type': 'Question', 'name': q, 'acceptedAnswer': {'@type': 'Answer', 'text': a_}} for q, a_ in qa]},
    ]
    return path, page(path=path, title=title, desc=desc, og_title='Party Wall Surveyors in Trafford',
                      h1='Party Wall Surveyors in Trafford', eyebrow='Party Wall surveyors · Trafford borough',
                      lead=('Corelain\'s Party Wall surveyors cover the whole of Trafford, from Old Trafford, Stretford '
                            'and Urmston to Timperley, Hale, Hale Barns and the villages around Dunham Massey. Choose '
                            'your area for local advice on notices, awards and the projects we see most.'),
                      trail=trail, body=body, graph=graph)


def areas_partial():
    links = ''.join(f'''
        <li><a class="cr-areas__chip" href="/party-wall-surveyors/{a['id']}">{svg(ICO_PIN)}<span>{e(a['name'])}</span><small class="ax-num">{e(a['pc'])}</small></a></li>'''
                    for a in AREAS)
    # `col` lets a page narrow the strip so something can sit beside it
    # (Area Radar pairs it with the sponsored card); it spans the full row by default.
    return f'''<!-- GENERATED by src/seo/townships.py — "Areas we cover" (MKT-01 geographic focus) -->
<section class="ax-card ax-col--{{{{#if col}}}}{{{{col}}}}{{{{else}}}}12{{{{/if}}}} cr-areas" role="region" aria-labelledby="cr-areas-title">
  <div class="ax-card__header">
    <div class="ax-card__titles">
      <span class="ax-card__eyebrow">Trafford pilot</span>
      <h2 class="ax-card__title" id="cr-areas-title" data-cr-areas-title>Party Wall surveyors across Trafford</h2>
      <p class="ax-card__subtitle">Local Party Wall guides for each focus area</p>
    </div>
    <a class="ax-btn ax-btn--link" href="/party-wall-surveyors/trafford">All Trafford</a>
  </div>
  <div class="ax-card__body" style="padding-top:0;">
    <ul class="cr-areas__list" data-cr-areas-list>{links}
    </ul>
  </div>
</section>
'''


def sitemap(paths):
    urls = ['  <url>\n    <loc>%SITE_URL%/</loc>\n    <lastmod>%BUILD_DATE%</lastmod>\n    <changefreq>weekly</changefreq>\n'
            '    <priority>1.0</priority>\n    <image:image>\n      <image:loc>%SITE_URL%/images/og-old-trafford.jpg</image:loc>\n'
            '    </image:image>\n  </url>']
    for p in paths:
        prio = '0.9' if p.endswith('/trafford') else '0.8'
        urls.append(f'  <url>\n    <loc>%SITE_URL%{p}</loc>\n    <lastmod>%BUILD_DATE%</lastmod>\n'
                    f'    <changefreq>monthly</changefreq>\n    <priority>{prio}</priority>\n  </url>')
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<!-- GENERATED by src/seo/townships.py -->\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
            'xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n' + '\n'.join(urls) + '\n</urlset>\n')


def llms_block():
    out = ['<!-- AREAS:START -->', '## Corelain Party Wall surveying', '',
           'Corelain (https://www.corelain.com/) is a Manchester building surveying practice (Cardinal House, 20 St Mary\'s Parsonage, '
           'Manchester M3 2LY; 0161 820 1121; office@corelain.com). Its Party Wall surveyors serve notices, prepare schedules of condition '
           'and agree awards under the Party Wall etc. Act 1996, for:',
           '',
           '- Homeowners planning rear or side extensions, loft conversions, basements, excavation or structural alterations.',
           '- Adjoining owners who have received a party wall notice.',
           '- Architects, architectural technologists, designers, planning consultants and structural engineers (preliminary assessments, early risk identification, CPD).',
           '- Builders, extension and loft specialists, surveyors, solicitors and project managers who refer clients.',
           '',
           f'Party Wall service page: {PW_URL}',
           '',
           '### Party Wall pages by area (Trafford pilot)',
           '',
           '- Trafford (all areas): %SITE_URL%/party-wall-surveyors/trafford']
    for a in AREAS:
        ca = '; conservation areas: ' + ', '.join(a['conservation']) if a['conservation'] else ''
        out.append(f'- {a["name"]} ({a["pc"]}, {a["borough"]}): %SITE_URL%/party-wall-surveyors/{a["id"]} — {a["intro"]}{ca}')
    out += ['<!-- AREAS:END -->']
    return '\n'.join(out)


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    paths = []
    for builder in [hub_page] + [lambda a=a: area_page(a) for a in AREAS]:
        path, html_ = builder()
        (OUT_DIR / (path.rsplit('/', 1)[1] + '.html')).write_text(html_)
        paths.append(path)
    AREAS_PARTIAL.write_text(areas_partial())
    SITEMAP.write_text(sitemap(paths))

    llms = LLMS.read_text()
    if '<!-- AREAS:START -->' in llms:
        llms = re.sub(r'<!-- AREAS:START -->.*?<!-- AREAS:END -->', lambda _: llms_block(), llms, flags=re.S)
    else:
        llms = llms.replace('<!-- FAQ:START -->', llms_block() + '\n\n<!-- FAQ:START -->', 1)
    LLMS.write_text(llms)
    print(f'Area pages written: {len(paths)} → {OUT_DIR.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
