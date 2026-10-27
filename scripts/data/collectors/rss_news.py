"""Local headlines from publisher-provided RSS feeds.

The catalogue and matching rules come from ``rss-feeds.json`` and
``RSS_Haber_Kaynaklari.xlsx`` supplied with v1.2.  Production deliberately
does not use the Bing News fallback feeds mentioned in those files.

Each area gets its own matching headlines plus "surrounding area" headlines:
the neighbouring towns' matches (their own rules), then the area's nearby and
the regional feeds. Each item carries scope local / nearby.

Only titles, links, dates and publisher names are republished.  Article text
and remote images are not copied; cards use Corelain's existing local images.
"""
import html
import json
import re
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import date, timezone
from email.utils import parsedate_to_datetime

from lib.common import DATA_DIR, http, log, metric, miles, SOURCES

CONFIG = DATA_DIR / 'config' / 'rss-feeds.json'
MAX_PER_AREA = 4          # the area's own headlines
MAX_NEARBY = 4            # plus headlines from the surrounding areas
MAX_NEIGHBOURS, NEAR_KM = 4, 6
MEDIA_NS = 'http://search.yahoo.com/mrss/'

TAGS = [
    ('Transport', 'info', '/images/news/transport.jpg', ('road closed', 'relief road', 'rail', 'tram', 'traffic', 'bus ', 'bridge', 'travel', 'm6', 'm60')),
    ('Schools', 'success', '/images/news/schools.jpg', ('school', 'college', 'pupil', 'student', 'education')),
    ('Planning', 'accent', '/images/news/planning.jpg', ('plan', 'planning', 'development', 'housing', 'homes', 'build', 'regeneration')),
]
DEFAULT_TAG = ('Local news', 'neutral', '/images/news/environment.jpg')


def clean_text(value):
    value = re.sub(r'<[^>]+>', ' ', html.unescape(value or ''))
    return re.sub(r'\s+', ' ', value).strip()


def child_text(item, name):
    node = item.find(name)
    return clean_text(node.text) if node is not None else ''


def parse_date(value):
    try:
        dt = parsedate_to_datetime(value)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError, OverflowError):
        return None


def classify(text):
    low = text.casefold()
    for tag, tone, image, words in TAGS:
        if any(word in low for word in words):
            return tag, tone, image
    return DEFAULT_TAG


def image_url(item, fallback):
    """Prefer the publisher image explicitly supplied in the RSS item."""
    candidates = []
    candidates.extend(x.get('url') for x in item.findall(f'{{{MEDIA_NS}}}content'))
    candidates.extend(x.get('url') for x in item.findall('enclosure')
                      if (x.get('type') or '').startswith('image/'))
    candidates.extend(x.get('url') for x in item.findall(f'{{{MEDIA_NS}}}thumbnail'))
    for value in candidates:
        if value and urllib.parse.urlparse(value).scheme == 'https':
            return value
    return fallback


def read_feed(raw, feed_id, feed):
    root = ET.fromstring(raw)
    items = []
    for node in root.findall('.//item'):
        title = child_text(node, 'title')
        link = child_text(node, 'link')
        description = child_text(node, 'description')
        published = parse_date(child_text(node, 'pubDate'))
        if not title or not link or not link.startswith(('https://', 'http://')):
            continue
        tag, tone, image = classify(title + ' ' + description)
        publisher_image = image_url(node, image)
        items.append({
            '_feed': feed_id,
            '_search': (title + ' ' + description).casefold(),
            '_published': published,
            'title': title,
            'excerpt': '',
            'date': published.strftime('%-d %b %Y') if published else '',
            'tag': tag,
            'tone': tone,
            'source': feed['name'],
            'domain': urllib.parse.urlparse(link).netloc.removeprefix('www.'),
            'url': link,
            'image': publisher_image,
            'image_external': publisher_image != image,
        })
    return items


def matches(item, rule):
    if rule.get('all'):
        return True
    text = item['_search']
    include = any(term.casefold() in text for term in rule.get('match', []))
    exclude = any(term.casefold() in text for term in rule.get('exclude', []))
    return include and not exclude


def public_item(item):
    return {k: v for k, v in item.items() if not k.startswith('_')}


def by_date(items):
    epoch = parsedate_to_datetime('Thu, 1 Jan 1970 00:00:00 +0000')
    return sorted(items, key=lambda x: x['_published'] or epoch, reverse=True)


def canonical(item):
    return item['url'].split('?', 1)[0].rstrip('/')


def pick(items, limit, seen, scope, label=None):
    """Latest unique items not already shown; `scope` is local or nearby."""
    selected = []
    for item in by_date(items):
        key = canonical(item)
        if key in seen:
            continue
        seen.add(key)
        public = public_item(item)
        public['scope'] = scope
        if item.get('_near'):
            public['near'] = item['_near']
        if label:
            public['tag'] = label
            public['tone'] = 'neutral'
        selected.append(public)
        if len(selected) == limit:
            break
    return selected


def neighbours(area, areas):
    """The nearest towns (not the borough or region) within NEAR_KM, closest first."""
    if area.get('kind') in ('borough', 'region'):
        return []
    c = area['centre']
    near = sorted((miles(c['lat'], c['lng'], a['centre']['lat'], a['centre']['lng']), a) for a in areas
                  if a['id'] != area['id'] and a.get('kind', 'area') == 'area')
    return [a for d, a in near if d <= NEAR_KM / 1.609344][:MAX_NEIGHBOURS]


def collect(ctx):
    config = json.loads(CONFIG.read_text())
    feed_items, failures = {}, []
    for feed_id, feed in config['feeds'].items():
        try:
            feed_items[feed_id] = read_feed(http(feed['url'], timeout=60), feed_id, feed)
            log(f'RSS {feed_id}: {len(feed_items[feed_id])} items')
        except Exception as exc:
            failures.append(feed_id)
            feed_items[feed_id] = []
            log(f'RSS {feed_id} failed: {exc}')

    rules = {rule['id']: rule for rule in config['areas']}
    general_ids = config.get('generalFallbackFeeds', [])
    out = {}
    for area in ctx.areas:
        rule = rules.get(area['id'])
        if not rule:
            out[area['id']] = {'news': metric(None, source='news_rss', status='no-data',
                                                   geography=area['name'], note='No RSS matching rule is configured.')}
            continue
        seen = set()
        local = pick([x for f in rule['feeds'] for x in feed_items.get(f, []) if matches(x, rule)],
                     MAX_PER_AREA * (2 if rule.get('all') else 1), seen, 'local')

        # surrounding areas: neighbouring towns' own headlines, then the area's nearby and regional feeds
        nearby, used_ids = [], list(rule['feeds'])
        if not rule.get('all'):
            for nb in neighbours(area, ctx.areas):
                nr = rules.get(nb['id'])
                if not nr:
                    continue
                items = [dict(x, _near=nb['name']) for f in nr['feeds'] for x in feed_items.get(f, []) if matches(x, nr) and not matches(x, rule)]
                nearby += pick(items, 2, seen, 'nearby', f"Nearby · {nb['name']}")
                used_ids += nr['feeds']
            for ids, label in ((rule.get('fallback_feeds', []), 'Nearby news'), (general_ids, 'Greater Manchester')):
                if len(nearby) >= MAX_NEARBY:
                    break
                items = [x for f in ids for x in feed_items.get(f, []) if not matches(x, rule)]
                nearby += pick(items, MAX_NEARBY - len(nearby), seen, 'nearby', label)
                used_ids += ids
        nearby = nearby[:MAX_NEARBY]
        selected = local + nearby
        used_ids = [x for x in dict.fromkeys(used_ids) if feed_items.get(x)]
        note = 'Headlines and links only; RSS images are referenced from the publisher when supplied and are not copied.'
        if failures:
            note += ' Unavailable feeds this run: ' + ', '.join(failures) + '.'
        out[area['id']] = {'news': metric(
            selected or None,
            period=f"Publisher feeds checked {date.today().isoformat()}",
            geography=area['name'],
            source='news_rss',
            status='ok' if selected else 'no-data',
            feeds=[config['feeds'][x]['name'] for x in used_ids],
            feed_links=[{'name': config['feeds'][x]['name'], 'url': config['feeds'][x]['url']} for x in used_ids],
            scope='local' if local else 'nearby',
            local_count=len(local), nearby_count=len(nearby),
            note=note,
        )}
        log(f"news {area['id']}: {len(local)} local + {len(nearby)} nearby")
    return out
