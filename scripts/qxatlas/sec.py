"""Weekly SEC EDGAR submissions check for US-listed / SEC-registered owners.

Lists new 10-K, 10-Q, 8-K, 6-K, 20-F and 40-F filings. Annual reports (10-K, 20-F, 40-F) also create a
'review needed' item so an analyst can check the mine-level production figures. Production is never auto-changed.
SEC requires a descriptive User-Agent with contact details: set SEC_USER_AGENT, e.g. "Quantum Xi Atlas you@yourdomain.com"."""
import datetime as dt
import json
import os
import time

from .common import SRC, fetch, iso, load, log, now, sha

FORMS = {'10-K', '10-Q', '8-K', '6-K', '20-F', '40-F', '10-K/A', '20-F/A', '40-F/A'}
ANNUAL = {'10-K', '20-F', '40-F'}


def run(mines, ua, window_days=45):
    cfg = load(os.path.join(SRC, 'sec_registrants.json'))
    regs = cfg['registrants']
    try:  # re-resolve CIKs by ticker (tickers move; CIKs are stable but this catches typos)
        tick = json.loads(fetch('https://www.sec.gov/files/company_tickers.json', ua=ua))
        T = {v['ticker']: v['cik_str'] for v in tick.values()}
        for r in regs:
            if r['ticker'] in T:
                r['cik'] = T[r['ticker']]
    except Exception as e:
        log('SEC ticker map failed, using stored CIKs:', e)
    owner_mines = {}
    for m in mines:
        for o in m['owners']:
            owner_mines.setdefault(o['n'], []).append(m['id'])
    cutoff = (now() - dt.timedelta(days=window_days)).date().isoformat()
    items, reviews, errors, ok = [], [], [], 0
    for r in regs:
        try:
            sub = json.loads(fetch('https://data.sec.gov/submissions/CIK%010d.json' % r['cik'], ua=ua, timeout=40))
            rec = sub.get('filings', {}).get('recent', {})
            ok += 1
            for i, form in enumerate(rec.get('form', [])):
                fdate = rec['filingDate'][i]
                if fdate < cutoff or form not in FORMS:
                    continue
                acc = rec['accessionNumber'][i]
                doc = rec.get('primaryDocument', [''] * (i + 1))[i]
                desc = rec.get('primaryDocDescription', [''] * (i + 1))[i] or ''
                url = 'https://www.sec.gov/Archives/edgar/data/%d/%s/%s' % (r['cik'], acc.replace('-', ''), doc) if doc else \
                      'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=%d' % r['cik']
                mids = sorted(set(owner_mines.get(r['owner'], [])))
                items.append({'id': sha(acc), 'feed': 'sec', 'date': fdate + 'T00:00:00Z', 'title': '%s filed %s%s' % (r['owner'], form, (': ' + desc) if desc and desc.upper() != form else ''),
                              'url': url, 'source': 'SEC EDGAR (%s)' % r['ticker'], 'category': 'filing', 'form': form, 'mines': mids, 'owners': [r['owner']]})
                if form.split('/')[0] in ANNUAL:
                    reviews.append({'id': sha('sec' + acc), 'type': 'annual_report', 'created': iso(now()), 'status': 'open', 'mines': mids,
                                    'title': '%s %s filed %s: check production figures' % (r['owner'], form, fdate),
                                    'detail': 'New annual report. Review mine-level production and ownership for the linked mines; the atlas has not been changed.', 'url': url})
        except Exception as e:
            errors.append('%s: %s' % (r['ticker'], e))
        time.sleep(0.25)
    return items, reviews, ok, len(regs), errors
