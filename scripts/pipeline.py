#!/usr/bin/env python3
"""Millennium KI Mine Atlas data pipeline.

  python3 scripts/pipeline.py                 # run every feed that is due, then rebuild all outputs
  python3 scripts/pipeline.py --force         # run every feed now regardless of cadence
  python3 scripts/pipeline.py --only sec,usgs # run selected feeds (implies --force for them)
  python3 scripts/pipeline.py --build-only    # no network: rebuild data/*.json, geojson, csv, assets/js/data.js

Inputs:  data/source/mines_master.json (curated), data/source/reference.json, data/source/countries.geojson,
         data/source/sec_registrants.json, data/state/* (feed snapshots)
Outputs: data/mines.json, minerals.json, countries.json, usgs_country_production.json, sources.json, countries.geojson,
         mines.geojson, mines.csv, updates.json, prices.json, review.json, meta.json, assets/js/data.js
Env:     SEC_USER_AGENT (required for SEC; "Org Name contact@domain"), FRED_API_KEY (optional), QX_USER_AGENT (optional)
Feeds never change curated owners, production, shares or coordinates. They only add alerts and review items."""
import argparse
import datetime as dt
import os
import re
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qxatlas import build as B  # noqa: E402
from qxatlas import news, prices, sec, usgs, wikidata  # noqa: E402
from qxatlas.common import DATA, DEFAULT_UA, iso, load, log, now, parse_iso, save  # noqa: E402

FEEDS = {
    'gdelt': {'label': 'GDELT DOC 2.0 news alerts', 'cadence': 'daily', 'url': 'https://api.gdeltproject.org/api/v2/doc/doc'},
    'gnews': {'label': 'Google News RSS alerts', 'cadence': 'daily', 'url': 'https://news.google.com/rss'},
    'miningcom': {'label': 'MINING.COM RSS alerts', 'cadence': 'daily', 'url': 'https://www.mining.com/feed/'},
    'wikidata': {'label': 'Wikidata coordinate/owner check', 'cadence': 'weekly', 'url': 'https://query.wikidata.org/'},
    'sec': {'label': 'SEC EDGAR filings (US-registered owners)', 'cadence': 'weekly', 'url': 'https://data.sec.gov/submissions/', 'requires': 'SEC_USER_AGENT'},
    'worldbank': {'label': 'World Bank Pink Sheet prices', 'cadence': 'monthly', 'url': 'https://www.worldbank.org/en/research/commodity-markets'},
    'fred': {'label': 'FRED commodity prices', 'cadence': 'monthly', 'url': 'https://fred.stlouisfed.org/', 'requires': 'FRED_API_KEY'},
    'usgs': {'label': 'USGS MCS release check', 'cadence': 'annual', 'url': 'https://pubs.usgs.gov/periodicals/'},
}
DUE_HOURS = {'daily': 20, 'weekly': 6.5 * 24, 'monthly': 27 * 24, 'annual': 360 * 24}
KEEP_DAYS = {'filing': 180}
NEWS_KEEP_DAYS = 120


def due(meta, name, force):
    if force:
        return True
    last = parse_iso((meta.get(name) or {}).get('last_success'))
    return last is None or (now() - last).total_seconds() / 3600 >= DUE_HOURS[FEEDS[name]['cadence']]


def norm_title(t):
    return re.sub(r'[^a-z0-9]+', ' ', (t or '').lower()).strip()[:90]


def merge_updates(old, new):
    by_id, titles, out = {}, set(), []
    for it in new + old:  # new first so fresher metadata wins
        if it['id'] in by_id or (it['category'] != 'filing' and news.NOISE.search(it.get('title', ''))):
            continue
        nt = norm_title(it['title'])
        if it['category'] != 'filing' and nt in titles:
            continue
        by_id[it['id']] = it
        titles.add(nt)
        out.append(it)
    cutoff = now()
    keep = []
    for it in out:
        d = parse_iso(it.get('date'))
        lim = KEEP_DAYS.get(it['category'], NEWS_KEEP_DAYS)
        if d is None or (cutoff - d).days <= lim:
            keep.append(it)
    keep.sort(key=lambda x: x.get('date') or '', reverse=True)
    return keep[:800]


def merge_review(old, new):
    by = {r['id']: r for r in old}
    for r in new:
        if r['id'] not in by:
            by[r['id']] = r
    lim = now() - dt.timedelta(days=365)
    items = [r for r in by.values() if (parse_iso(r.get('created')) or now()) >= lim]
    items.sort(key=lambda r: r.get('created') or '', reverse=True)
    return items


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--only', default='')
    ap.add_argument('--build-only', action='store_true')
    ap.add_argument('--news-window', default='2d', help='GDELT timespan / Google News when: (e.g. 2d, 7d)')
    a = ap.parse_args()

    mines, ref = B.build(write_bundle=False)  # validates the curated source first
    old_meta = load(os.path.join(DATA, 'meta.json'), {}) or {}
    fm = {k: dict((old_meta.get('feeds') or {}).get(k, {})) for k in FEEDS}
    for k, f in FEEDS.items():
        fm[k].update({'label': f['label'], 'cadence': f['cadence'], 'url': f['url']})
        if f.get('requires'):
            fm[k]['requires'] = f['requires']
    if a.build_only:
        upd = load(os.path.join(DATA, 'updates.json'))
        if upd and upd.get('items') is not None:
            upd['items'] = merge_updates(upd['items'], [])
            save(os.path.join(DATA, 'updates.json'), upd)
        B.build(feed_meta=fm)
        log('build-only: outputs regenerated')
        return 0

    only = [x.strip() for x in a.only.split(',') if x.strip()]
    run = [k for k in FEEDS if (k in only if only else due(fm, k, a.force))]
    for k in FEEDS:
        if k not in run:
            fm[k]['status_note'] = 'not due' if not only else 'not selected'
    upd = load(os.path.join(DATA, 'updates.json'), {'items': []}) or {'items': []}
    rev = load(os.path.join(DATA, 'review.json'), {'items': []}) or {'items': []}
    pr = load(os.path.join(DATA, 'prices.json'), {'series': []}) or {'series': []}
    new_items, new_reviews = [], []
    terms = news.build_terms(mines)

    def record(k, status, items=0, message='', extra=None):
        fm[k].update({'status': status, 'last_attempt': iso(now()), 'items': items, 'message': message[:400]})
        fm[k].pop('status_note', None)
        if status in ('ok', 'partial'):
            fm[k]['last_success'] = iso(now())
        if extra is not None:
            fm[k]['detail'] = extra
        log('%-10s %-12s items=%s %s' % (k, status, items, message[:160]))

    for k in run:
        try:
            if k == 'gdelt':
                its, n, errs = news.gdelt(terms, timespan=a.news_window)
                new_items += its
                record(k, ('partial' if errs else 'ok') if n else 'error', len(its), ('%d/%d queries ok; ' % (n, len(news.GDELT_TOPICS))) + ('; '.join(sorted(set(errs))[:2]) if errs else ''))
            elif k == 'gnews':
                its, n, errs = news.gnews(terms, when=a.news_window)
                new_items += its
                record(k, 'ok' if n else 'error', len(its), ('%d queries; ' % n) + ('; '.join(errs[:3]) if errs else ''))
            elif k == 'miningcom':
                its, n, errs = news.miningcom(terms)
                new_items += its
                record(k, 'ok' if n else 'error', len(its), ('%d feed entries scanned; ' % n) + '; '.join(errs[:3]))
            elif k == 'wikidata':
                res, rv = wikidata.run(mines, DEFAULT_UA)
                new_reviews += rv
                record(k, 'ok', len(rv), '%d Wikidata items checked, %d returned%s; %d changes flagged' % (res['checked'], res['returned'], ' (baseline snapshot created)' if res['baseline'] else '', len(rv)), extra={'missing': res['missing']})
            elif k == 'sec':
                ua = os.environ.get('SEC_USER_AGENT', '').strip()
                if not ua or '@' not in ua:
                    record(k, 'needs_config', 0, 'Set SEC_USER_AGENT to "Organisation Name contact@domain" (SEC fair-access policy).')
                    continue
                its, rv, ok, total, errs = sec.run(mines, ua)
                new_items += its
                new_reviews += rv
                record(k, 'ok' if ok else 'error', len(its), '%d/%d registrants fetched; %d annual reports flagged%s' % (ok, total, len(rv), ('; ' + '; '.join(errs[:3])) if errs else ''))
            elif k == 'worldbank':
                s = prices.worldbank()
                pr['series'] = [x for x in pr.get('series', []) if x.get('source') != 'World Bank Pink Sheet'] + s
                record(k, 'ok' if s else 'error', len(s), 'latest period %s' % (s[0]['period'] if s else 'n/a'))
            elif k == 'fred':
                key = os.environ.get('FRED_API_KEY', '').strip()
                if not key:
                    record(k, 'needs_key', 0, 'FRED_API_KEY not set; skipped (free key: https://fred.stlouisfed.org/docs/api/api_key.html).')
                    continue
                s, errs = prices.fred(key)
                pr['series'] = [x for x in pr.get('series', []) if x.get('source') != 'FRED (IMF)'] + s
                record(k, 'ok' if s else 'error', len(s), '; '.join(errs[:3]))
            elif k == 'usgs':
                res, rv = usgs.run()
                new_reviews += rv
                avail = ', '.join('%d %s' % (c['year'], 'available' if c['available'] else 'not found') for c in res['checked'])
                record(k, 'ok', len(rv), avail, extra=res)
        except Exception as e:
            traceback.print_exc()
            record(k, 'error', 0, '%s: %s' % (type(e).__name__, e))

    upd['items'] = merge_updates(upd.get('items', []), new_items)
    upd['generated_at'] = iso(now())
    rev['items'] = merge_review(rev.get('items', []), new_reviews)
    rev['generated_at'] = iso(now())
    pr['generated_at'] = iso(now())
    save(os.path.join(DATA, 'updates.json'), upd)
    save(os.path.join(DATA, 'review.json'), rev)
    save(os.path.join(DATA, 'prices.json'), pr)
    B.build(feed_meta=fm)
    log('done: %d updates, %d review items, %d price series' % (len(upd['items']), len(rev['items']), len(pr['series'])))
    return 0


if __name__ == '__main__':
    sys.exit(main())
