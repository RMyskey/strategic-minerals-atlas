"""News alerts: GDELT DOC 2.0 API, Google News RSS and MINING.COM RSS.

An item becomes an alert only if its headline (or RSS summary) names a tracked mine or owner
AND matches one of the alert categories below. Nothing here edits curated mine data."""
import datetime as dt
import email.utils
import html
import re
import time
import urllib.parse
import xml.etree.ElementTree as ET

from .common import fetch, fetch_json, iso, log, now, sha

RSS_UA = 'Mozilla/5.0 (compatible; MillenniumKI-Mine-Atlas/1.0; +https://github.com/RMyskey/strategic-minerals-atlas)'

CATEGORIES = [  # first match wins
    ('nationalization', r'nationali[sz]|expropriat|seiz(e|es|ed|ure)|state takeover|revok\w* (the )?(mining )?(licen[cs]e|permit|concession)|junta|cancel\w* (mining )?(licen[cs]e|permit|concession)'),
    ('sanctions', r'sanction|\bOFAC\b|embargo|export ban|export control|entity list|blacklist|tariff'),
    ('suspension', r'suspend|suspension|\bhalt|force majeure|shut(s|down| down)?\b|closure|\bstrike\b|stoppage|curtail|care and maintenance|mud ?rush|collapse|flood|blockade|evacuat|fatalit|accident'),
    ('ownership', r'\bstake\b|acqui(re|res|red|sition)|takeover|merger|\bmerge|buyout|divest|\bsale\b|\bsells?\b|\bsold\b|purchase|joint venture|\bJV\b|\bbid\b|\bdeal\b|equity stake'),
]
CAT_RE = [(c, re.compile(p, re.I)) for c, p in CATEGORIES]
# Market-chatter headlines (fund position changes, ratings, price moves) are not ownership changes of a mine.
NOISE = re.compile(r'shares? (were |was )?(sold|bought|acquired|purchased|trimmed|lowered|raised) by|position (in|by)|stake (raised|lowered|trimmed|cut|boosted|increased|decreased)|'
                   r'price target|stock (price|forecast)|time to (buy|sell)|cut to (sell|hold)|(up|down)grade|\((NYSE|NASDAQ|TSX|ASX|LSE|OTC)|\$[A-Z]{2,5}\b|'
                   r'equity price and quote|institutional|shares (down|up|gap|jump|fall|rise|drop)|short interest|dividend', re.I)
GENERIC_OWNER = re.compile(r'^(govt|government)|consortium|producers|militia|partners|army|^blue horizon', re.I)
AMBIGUOUS_HINT = re.compile(r'\bmine|mining|miner|copper|cobalt|lithium|nickel|uranium|rare earth|graphite|tungsten|antimony|zinc|tin\b|bauxite|alumin|iron ore|manganese|vanadium|platinum|palladium|niobium|potash|titanium|chrom|gold|molybdenum', re.I)
KEYWORDS_GDELT = '(nationalization OR nationalisation OR expropriation OR suspended OR suspension OR halted OR "force majeure" OR sanctions OR stake OR acquisition OR takeover OR merger OR strike)'
KEYWORDS_GNEWS = '(nationalization OR nationalise OR expropriation OR suspended OR halt OR "force majeure" OR sanctions OR stake OR acquisition OR takeover OR strike)'


# Multi-word names that are also everyday phrases: require a mining word in the headline too.
AMBIG = {'red dog', 'silver peak', 'mountain pass', 'polar division', 'pilbara system', 'wa state', 'kachin state', 'east boulder',
         'solomon hub', 'san rafael', 'rio tuba', 'mount weld', 'mt marion', 'mt holland', 'newman', 'sentinel', 'stillwater'}


def _clean(name):
    base = re.sub(r'\s*\(.*?\)', '', name).strip()
    inner = re.findall(r'\(([^)]+)\)', name)
    return base, inner


def build_terms(mines):
    """Return list of matcher dicts: {term, regex, kind, key, mines, ambiguous}."""
    terms, seen = [], set()
    owner_names = {_clean(o['n'])[0].lower() for m in mines for o in m['owners']}

    def add(term, kind, key, mids, case=False):
        t = term.strip()
        if len(t) < 4 or t.lower() in seen:
            return
        seen.add(t.lower())
        acronym = t.isupper() and len(t) <= 6
        rx = re.compile(r'(?<![\w-])' + re.escape(t) + r'(?![\w-])', 0 if (acronym or case) else re.I)
        ambiguous = (' ' not in t and '-' not in t and not acronym) or t.lower() in AMBIG
        terms.append({'term': t, 'rx': rx, 'kind': kind, 'key': key, 'mines': mids, 'ambiguous': ambiguous})

    for m in mines:
        base, inner = _clean(m['name'])
        add(base, 'mine', m['id'], [m['id']])
        for x in inner:
            for part in re.split(r'[/,]', x):
                part = part.strip()
                if len(part) >= 5 and part[0].isupper() and not re.search(r'\d', part) and not part.lower().startswith(('ex-', 'formerly')) and part.lower() not in owner_names:
                    add(part, 'mine', m['id'], [m['id']])
    owners = {}
    for m in mines:
        for o in m['owners']:
            owners.setdefault(o['n'], []).append(m['id'])
    for n, mids in owners.items():
        if GENERIC_OWNER.search(n):
            continue
        base, _ = _clean(n)
        add(base, 'owner', n, sorted(set(mids)), case=base.isupper())
    return terms


def classify(text):
    for c, rx in CAT_RE:
        if rx.search(text):
            return c
    return None


def match(text, terms):
    mines, owners = set(), set()
    for t in terms:
        if t['rx'].search(text):
            if t['ambiguous'] and not AMBIGUOUS_HINT.search(text):
                continue
            if t['kind'] == 'mine':
                mines.update(t['mines'])
            else:
                owners.add(t['key'])
    return sorted(mines), sorted(owners)


def make_item(feed, title, url, date, source, terms, summary='', max_age_days=None):
    if max_age_days is not None and date is not None and (now() - date).total_seconds() > max_age_days * 86400:
        return None
    title = html.unescape(re.sub(r'\s+', ' ', title or '')).strip()
    text = title + ' ' + html.unescape(re.sub(r'<[^>]+>', ' ', summary or ''))
    if not title or not url:
        return None
    if NOISE.search(title):
        return None
    cat = classify(title) or (classify(text) if summary else None)
    if not cat:
        return None
    mines, owners = match(text, terms)
    if not mines and not owners:
        return None
    return {'id': sha(url), 'feed': feed, 'date': iso(date) if date else None, 'title': title, 'url': url, 'source': source,
            'category': cat, 'mines': mines, 'owners': owners}


def _days(span):
    m = re.fullmatch(r'(\d+)\s*([dhw])', span or '')
    if not m:
        return 7
    n = int(m.group(1))
    return {'d': n, 'h': max(1, n // 24), 'w': n * 7}[m.group(2)]


def chunks(lst, n):
    for i in range(0, len(lst), n):
        yield lst[i:i + n]


def query_terms(terms):
    out, seen = [], set()
    for t in terms:
        q = t['term']
        if q.lower() in seen or len(q) < 5:
            continue
        seen.add(q.lower())
        out.append(q)
    return out


# ---------------- GDELT ----------------
# GDELT allows ~1 request / 5 s per IP, so we run a few broad topic queries (up to 250 articles each)
# and match tracked mine / owner names locally instead of one query per name.
GDELT_TOPICS = [
    '(mine OR mining) (nationalization OR nationalisation OR expropriation OR seized OR "revoked license" OR junta)',
    '(mine OR mining OR miner) (sanctions OR embargo OR "export ban" OR "export controls")',
    '(mine OR mining) (suspended OR halted OR "force majeure" OR strike OR shutdown)',
    '(mine OR mining OR miner) (stake OR acquisition OR takeover OR merger OR divest)',
    '(copper OR cobalt OR lithium OR nickel OR uranium OR "rare earth" OR graphite OR tungsten OR antimony) (mine OR mining) (sanctions OR nationalization OR suspended OR stake OR acquisition)',
]


def gdelt(terms, timespan='2d', delay=12.0):
    import json
    items, errors, n = [], [], 0
    for i, q in enumerate(GDELT_TOPICS):
        if i:
            time.sleep(delay)
        try:
            raw = fetch('https://api.gdeltproject.org/api/v2/doc/doc', params={'query': q + ' sourcelang:english', 'mode': 'artlist', 'format': 'json', 'maxrecords': 250, 'timespan': timespan, 'sort': 'datedesc'}, timeout=45, retries=2, backoff=20)
            txt = raw.decode('utf-8', 'replace').strip()
            if not txt.startswith('{'):
                errors.append(txt[:100]); continue
            for a in json.loads(txt).get('articles', []) or []:
                d = None
                try:
                    d = dt.datetime.strptime(a.get('seendate', ''), '%Y%m%dT%H%M%SZ').replace(tzinfo=dt.timezone.utc)
                except ValueError:
                    pass
                it = make_item('gdelt', a.get('title'), a.get('url'), d, a.get('domain'), terms, max_age_days=_days(timespan) + 1)
                if it:
                    items.append(it)
            n += 1
        except Exception as e:
            errors.append(str(e))
    return items, n, errors


# ---------------- RSS (Google News, MINING.COM) ----------------
def parse_rss(raw):
    root = ET.fromstring(raw)
    for it in root.iter('item'):
        g = lambda tag: (it.findtext(tag) or '').strip()
        src = it.find('source')
        d = None
        if g('pubDate'):
            try:
                d = email.utils.parsedate_to_datetime(g('pubDate'))
                if d.tzinfo is None:
                    d = d.replace(tzinfo=dt.timezone.utc)
            except (TypeError, ValueError):
                d = None
        yield {'title': g('title'), 'link': g('link'), 'date': d, 'desc': g('description'),
               'source': (src.text.strip() if src is not None and src.text else '')}


def gnews(terms, when='2d', delay=2.0, group=12):
    items, errors, n = [], [], 0
    qs = query_terms(terms)
    for grp in chunks(qs, group):
        q = '(' + ' OR '.join('"%s"' % g for g in grp) + ') ' + KEYWORDS_GNEWS + ' when:' + when
        try:
            raw = fetch('https://news.google.com/rss/search', params={'q': q, 'hl': 'en-US', 'gl': 'US', 'ceid': 'US:en'}, timeout=30, retries=1, ua=RSS_UA)
            for r in parse_rss(raw):
                title = re.sub(r'\s+-\s+[^-]+$', '', r['title']) if r['source'] else r['title']
                it = make_item('gnews', title, r['link'], r['date'], r['source'] or 'Google News', terms, max_age_days=_days(when) + 1)
                if it:
                    items.append(it)
            n += 1
        except Exception as e:
            errors.append(str(e))
        time.sleep(delay)
    return items, n, errors


def miningcom(terms):
    items, errors = [], []
    try:
        raw = fetch('https://www.mining.com/feed/', timeout=40, ua=RSS_UA)
        n = 0
        for r in parse_rss(raw):
            n += 1
            it = make_item('miningcom', r['title'], r['link'], r['date'], 'MINING.COM', terms, summary=r['desc'], max_age_days=8)
            if it:
                items.append(it)
        return items, n, errors
    except Exception as e:
        errors.append(str(e))
        return items, 0, errors
