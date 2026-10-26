"""Regenerate every published data file from data/source/* plus feed outputs.

Curated fields (owners, equity, production, world share, coordinates) come ONLY from
data/source/mines_master.json. Feeds never modify them; they produce updates/review items."""
import csv
import io
import json
import os

from .common import DATA, ROOT, SRC, iso, load, now, save
from .geo import mgrs


def srclabel(s):
    if s.startswith('Q'):
        return 'Wikidata ' + s
    return {'I': 'Located on Esri World Imagery', 'D': 'District centroid', 'WP': 'Wikipedia'}.get(s, 'Analyst approximation')


def load_sources():
    master = load(os.path.join(SRC, 'mines_master.json'))
    ref = load(os.path.join(SRC, 'reference.json'))
    if not master or not ref:
        raise SystemExit('data/source/mines_master.json or reference.json missing or invalid')
    return master, ref


def validate(mines, ref):
    errs = []
    ids = set()
    for i, m in enumerate(mines):
        if m.get('id') != i:
            errs.append('mine %r: id must equal list index %d' % (m.get('name'), i))
        ids.add(m.get('id'))
        if not (-90 <= m['lat'] <= 90 and -180 <= m['lon'] <= 180):
            errs.append('mine %s: bad coordinates' % m['name'])
        if m['prec'] not in ref['precision']:
            errs.append('mine %s: unknown precision %s' % (m['name'], m['prec']))
        if m['ctrl_cls'] not in ref['control_types']:
            errs.append('mine %s: unknown control type' % m['name'])
        for o in m['owners']:
            if o['cl'] not in ref['control_types']:
                errs.append('mine %s owner %s: unknown control type' % (m['name'], o['n']))
        for s in m['src']:
            if s not in ref['sources']:
                errs.append('mine %s: unknown source key %s' % (m['name'], s))
    if errs:
        raise SystemExit('Validation failed:\n  ' + '\n  '.join(errs))


def mine_props(m, ref):
    mi = ref['minerals'].get(m['primary'], {})
    cn = lambda c: ref['countries'].get(c, {}).get('name', c)
    ml = lambda c: ref['minerals'].get(c, {}).get('l', c)
    return {
        'id': m['id'], 'name': m['name'], 'host_country': cn(m['host']), 'host_iso2': m['host'], 'primary_mineral': ml(m['primary']),
        'secondary_minerals': '; '.join(ml(s) for s in m['secondary']), 'operator': m['operator'],
        'owners': '; '.join('%s%s (%s)' % (o['n'], (' %s%%' % fmtnum(o['pct'])) if o['pct'] is not None else '', o['cc']) for o in m['owners']),
        'controlling_owner_hq_iso2': m['ctrl_cc'], 'control_type': ref['control_types'][m['ctrl_cls']]['label'], 'production': m['production'],
        'production_year': m['year'] or None, 'world_share_pct': m['share'], 'status': m['status'],
        'us_critical_2025': mi.get('crit'), 'us_net_import_reliance': mi.get('nir'), 'us_defense_stockpile': mi.get('nds'),
        'lat': m['lat'], 'lon': m['lon'], 'mgrs': m['mgrs'], 'coord_precision': ref['precision'][m['prec']]['label'],
        'coord_ce_m': ref['precision'][m['prec']]['ce_m'], 'coord_source': srclabel(m['coord_src']),
        'sources': ' '.join(ref['sources'][s]['u'] if s in ref['sources'] else s for s in m['src']),
    }


def fmtnum(v):
    return ('%g' % v) if isinstance(v, (int, float)) else str(v)


def build(feed_meta=None, write_bundle=True):
    master, ref = load_sources()
    mines = master['mines']
    validate(mines, ref)
    for m in mines:
        m['mgrs'] = mgrs(m['lat'], m['lon'])
    save(os.path.join(DATA, 'mines.json'), mines)
    save(os.path.join(DATA, 'minerals.json'), ref['minerals'])
    save(os.path.join(DATA, 'countries.json'), ref['countries'])
    save(os.path.join(DATA, 'usgs_country_production.json'), ref['usgs_country_production'])
    save(os.path.join(DATA, 'sources.json'), ref['sources'])
    world = load(os.path.join(SRC, 'countries.geojson'))
    save(os.path.join(DATA, 'countries.geojson'), world, compact=True)
    props = [mine_props(m, ref) for m in mines]
    gj = {'type': 'FeatureCollection', 'name': 'quantumxi_strategic_mines',
          'crs': {'type': 'name', 'properties': {'name': 'urn:ogc:def:crs:OGC:1.3:CRS84'}},
          'features': [{'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [m['lon'], m['lat']]}, 'properties': p} for m, p in zip(mines, props)]}
    save(os.path.join(DATA, 'mines.geojson'), gj)
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=list(props[0].keys()), lineterminator='\n')
    w.writeheader()
    for p in props:
        w.writerow({k: ('' if v is None else ('true' if v is True else 'false' if v is False else v)) for k, v in p.items()})
    with open(os.path.join(DATA, 'mines.csv'), 'w', encoding='utf-8', newline='') as f:
        f.write(buf.getvalue())

    old_meta = load(os.path.join(DATA, 'meta.json'), {}) or {}
    meta = {
        'datum': ref['datum'], 'control_types': ref['control_types'], 'precision': ref['precision'],
        'mines': len(mines), 'compiled': master.get('compiled'),
        'built_at': iso(now()),
        'feeds': feed_meta if feed_meta is not None else old_meta.get('feeds', {}),
    }
    ts = [f.get('last_success') for f in meta['feeds'].values() if f.get('last_success')]
    meta['last_refresh'] = max(ts) if ts else None
    save(os.path.join(DATA, 'meta.json'), meta)
    for name, default in (('updates.json', {'items': []}), ('prices.json', {'series': []}), ('review.json', {'items': []})):
        p = os.path.join(DATA, name)
        if load(p) is None:
            save(p, default)
    if write_bundle:
        bundle_js()
    return mines, ref


def bundle_js():
    d = lambda f: load(os.path.join(DATA, f))
    bundle = {
        'mines': d('mines.json'), 'minerals': d('minerals.json'), 'countries': d('countries.json'),
        'choro': d('usgs_country_production.json'), 'sources': d('sources.json'), 'meta': d('meta.json'),
        'world': d('countries.geojson'), 'updates': d('updates.json') or {'items': []}, 'prices': d('prices.json') or {'series': []},
        'review': d('review.json') or {'items': []},
    }
    path = os.path.join(ROOT, 'assets', 'js', 'data.js')
    with open(path + '.tmp', 'w', encoding='utf-8') as f:
        f.write('/* Generated by scripts/pipeline.py from data/*.json. Do not edit by hand. */\nwindow.QX=')
        json.dump(bundle, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';\n')
    os.replace(path + '.tmp', path)
