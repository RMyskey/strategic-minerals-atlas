"""Annual USGS Mineral Commodity Summaries link check. Flags a new edition for review; never edits figures."""
import re

from .common import fetch, iso, now, sha

BASE = 'https://pubs.usgs.gov/periodicals/mcs{y}/mcs{y}.pdf'
SB = 'https://www.sciencebase.gov/catalog/items'


def _exists(url):
    try:
        fetch(url, method='HEAD', timeout=40, retries=1)
        return True
    except Exception:
        return False


def run(current_year=2026):
    res, reviews = {'checked': []}, []
    for y in (current_year, current_year + 1):
        u = BASE.format(y=y)
        ok = _exists(u)
        res['checked'].append({'year': y, 'url': u, 'available': ok})
        if ok and y > current_year:
            reviews.append({'id': sha('mcs%d' % y), 'type': 'usgs_mcs', 'created': iso(now()), 'status': 'open', 'mines': [],
                            'title': 'USGS Mineral Commodity Summaries %d is available' % y,
                            'detail': 'Update net import reliance, stockpile status and country production in data/source/reference.json after review.', 'url': u})
    try:
        import json
        j = json.loads(fetch(SB, params={'q': 'Mineral Commodity Summaries %d data release' % current_year, 'format': 'json', 'max': 5, 'fields': 'title,link'}, timeout=40))
        res['data_releases'] = [{'title': it.get('title'), 'url': (it.get('link') or {}).get('url')} for it in j.get('items', []) if re.search(r'Mineral Commodity Summaries', it.get('title', ''), re.I)]
    except Exception as e:
        res['data_releases_error'] = str(e)
    return res, reviews
