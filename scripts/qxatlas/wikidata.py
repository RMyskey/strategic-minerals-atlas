"""Weekly Wikidata check (SPARQL) for mines with Wikidata IDs.

Pulls coordinate (P625), owned by (P127) and operator (P137). Compares with the last snapshot
(data/state/wikidata_snapshot.json) and flags changes for analyst review. It never overwrites
curated coordinates or ownership."""
import json
import os
import re

from .common import STATE, fetch, iso, load, now, save, sha
from .geo import hav_km

ENDPOINT = 'https://query.wikidata.org/sparql'
SNAP = os.path.join(STATE, 'wikidata_snapshot.json')


def run(mines, ua):
    qids = sorted({m['coord_src'] for m in mines if re.fullmatch(r'Q\d+', m['coord_src'])})
    by_q = {}
    for m in mines:
        by_q.setdefault(m['coord_src'], []).append(m)
    snap = {}
    for i in range(0, len(qids), 40):
        vals = ' '.join('wd:' + q for q in qids[i:i + 40])
        q = ('SELECT ?item ?coord ?owner ?ownerLabel ?op ?opLabel WHERE { VALUES ?item { %s } '
             'OPTIONAL { ?item wdt:P625 ?coord } OPTIONAL { ?item wdt:P127 ?owner } OPTIONAL { ?item wdt:P137 ?op } '
             'SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }') % vals
        raw = fetch(ENDPOINT, params={'query': q, 'format': 'json'}, headers={'Accept': 'application/sparql-results+json'}, ua=ua, timeout=90)
        for b in json.loads(raw)['results']['bindings']:
            qid = b['item']['value'].rsplit('/', 1)[-1]
            s = snap.setdefault(qid, {'coords': set(), 'owners': set(), 'operators': set()})
            if 'coord' in b:
                mm = re.match(r'Point\(([-\d.eE]+) ([-\d.eE]+)\)', b['coord']['value'])
                if mm:
                    s['coords'].add((round(float(mm.group(2)), 5), round(float(mm.group(1)), 5)))
            if 'ownerLabel' in b:
                s['owners'].add(b['ownerLabel']['value'])
            if 'opLabel' in b:
                s['operators'].add(b['opLabel']['value'])
    snap = {k: {'coords': sorted(v['coords']), 'owners': sorted(v['owners']), 'operators': sorted(v['operators'])} for k, v in snap.items()}
    prev = load(SNAP)
    reviews, t = [], iso(now())
    for qid, cur in snap.items():
        ms = by_q.get(qid, [])
        names = ', '.join(m['name'] for m in ms)
        url = 'https://www.wikidata.org/wiki/' + qid
        if prev and qid in prev:
            old = prev[qid]
            for field in ('owners', 'operators'):
                if old.get(field) != cur[field]:
                    reviews.append({'id': sha('wd' + qid + field + json.dumps(cur[field])), 'type': 'wikidata_' + field, 'created': t, 'status': 'open',
                                    'mines': [m['id'] for m in ms], 'title': 'Wikidata %s changed for %s' % (field, names),
                                    'detail': 'Was: %s. Now: %s. Curated data unchanged; verify before editing mines_master.json.' % ('; '.join(old.get(field) or ['none']), '; '.join(cur[field] or ['none'])), 'url': url})
            if [list(c) for c in old.get('coords', [])] != [list(c) for c in cur['coords']] and cur['coords']:
                d = min(hav_km(c, (m['lat'], m['lon'])) for c in cur['coords'] for m in ms) if ms else None
                reviews.append({'id': sha('wd' + qid + 'coord' + json.dumps(cur['coords'])), 'type': 'wikidata_coordinate', 'created': t, 'status': 'open',
                                'mines': [m['id'] for m in ms], 'title': 'Wikidata coordinate changed for %s' % names,
                                'detail': 'New Wikidata P625: %s (%.1f km from the atlas coordinate). Atlas coordinate unchanged.' % (cur['coords'], d) if d is not None else 'New P625: %s' % cur['coords'], 'url': url})
    missing = [q for q in qids if q not in snap]
    save(SNAP, snap)
    return {'checked': len(qids), 'returned': len(snap), 'baseline': prev is None, 'missing': missing}, reviews
