"""Monthly commodity prices: World Bank Pink Sheet (keyless) and FRED (needs FRED_API_KEY; skipped if absent)."""
import io
import os
import re
import xml.etree.ElementTree as ET
import zipfile

from .common import fetch, fetch_json, log

WB_PAGE = 'https://www.worldbank.org/en/research/commodity-markets'
WB_WANT = {  # Pink Sheet column header (prefix match) -> (atlas mineral code, label)
    'Copper': ('Cu', 'Copper'), 'Nickel': ('Ni', 'Nickel'), 'Aluminum': ('Al', 'Aluminum'), 'Zinc': ('Zn', 'Zinc'),
    'Lead': ('Pb', 'Lead'), 'Tin': ('Sn', 'Tin'), 'Iron ore, cfr spot': ('Fe', 'Iron ore (CFR China)'), 'Gold': ('Au', 'Gold'),
    'Silver': ('Ag', 'Silver'), 'Platinum': ('PGM', 'Platinum'), 'Potassium chloride': ('K', 'Potash (KCl)'), 'Phosphate rock': ('P', 'Phosphate rock'),
}
FRED_SERIES = {  # IMF Primary Commodity Prices on FRED, monthly
    'PURANUSDM': ('U', 'Uranium', 'USD/lb'), 'PCOPPUSDM': ('Cu', 'Copper', 'USD/mt'), 'PNICKUSDM': ('Ni', 'Nickel', 'USD/mt'),
    'PALUMUSDM': ('Al', 'Aluminum', 'USD/mt'), 'PZINCUSDM': ('Zn', 'Zinc', 'USD/mt'), 'PTINUSDM': ('Sn', 'Tin', 'USD/mt'),
    'PLEADUSDM': ('Pb', 'Lead', 'USD/mt'), 'PIORECRUSDM': ('Fe', 'Iron ore', 'USD/mt'),
}
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}


def _xlsx_sheet(raw, want):
    z = zipfile.ZipFile(io.BytesIO(raw))
    ss = []
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS):
            ss.append(''.join(t.text or '' for t in si.iter('{%s}t' % NS['m'])))
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    rmap = {r.get('Id'): r.get('Target') for r in rels}
    target = None
    for s in wb.find('m:sheets', NS):
        if s.get('name', '').strip().lower() == want.lower():
            target = rmap[s.get('{%s}id' % NS['r'])]
    if not target:
        raise ValueError('sheet %r not found' % want)
    target = target.lstrip('/')
    path = target if target.startswith('xl/') else 'xl/' + target
    rows = {}
    for row in ET.fromstring(z.read(path)).iter('{%s}row' % NS['m']):
        r = int(row.get('r'))
        for c in row.findall('m:c', NS):
            ref = c.get('r'); col = re.match(r'[A-Z]+', ref).group(0)
            v = c.find('m:v', NS)
            if v is None:
                is_ = c.find('m:is', NS)
                val = ''.join(t.text or '' for t in is_.iter('{%s}t' % NS['m'])) if is_ is not None else None
            else:
                val = ss[int(v.text)] if c.get('t') == 's' else v.text
            rows.setdefault(r, {})[col] = val
    return rows


def worldbank():
    page = fetch(WB_PAGE, timeout=40).decode('utf-8', 'replace')
    m = re.search(r'https?://[^"\'\s>]+CMO-Historical-Data-Monthly\.xlsx', page)
    if not m:
        raise ValueError('Pink Sheet monthly xlsx link not found on ' + WB_PAGE)
    url = m.group(0)
    rows = _xlsx_sheet(fetch(url, timeout=120), 'Monthly Prices')
    hdr_row = next(r for r in sorted(rows) if any((v or '').strip().startswith('Crude oil') for v in rows[r].values()))
    hdr, units = rows[hdr_row], rows.get(hdr_row + 1, {})
    data = [(rows[r].get('A'), rows[r]) for r in sorted(rows) if r > hdr_row + 1 and re.fullmatch(r'\d{4}M\d{2}', (rows[r].get('A') or '').strip())]
    out = []
    for col, name in hdr.items():
        name = (name or '').strip()
        key = next((k for k in WB_WANT if name.startswith(k)), None)
        if not key or any(s['label'] == WB_WANT[key][1] for s in out):
            continue
        pts = []
        for per, r in data:
            try:
                pts.append((per.strip(), float(r.get(col))))
            except (TypeError, ValueError):
                pass
        if not pts:
            continue
        last, prev = pts[-1], (pts[-2] if len(pts) > 1 else None)
        yago = next((p for p in pts if p[0] == '%d%s' % (int(last[0][:4]) - 1, last[0][4:])), None)
        code, label = WB_WANT[key]
        out.append({'source': 'World Bank Pink Sheet', 'series': name, 'mineral': code, 'label': label, 'unit': (units.get(col) or '').strip().strip('()'),
                    'period': last[0].replace('M', '-'), 'value': last[1], 'prev': prev[1] if prev else None,
                    'mom_pct': round((last[1] / prev[1] - 1) * 100, 2) if prev and prev[1] else None,
                    'yoy_pct': round((last[1] / yago[1] - 1) * 100, 2) if yago and yago[1] else None,
                    'history': [{'p': p.replace('M', '-'), 'v': v} for p, v in pts[-24:]], 'url': url})
    return out


def fred(key):
    out, errors = [], []
    for sid, (code, label, unit) in FRED_SERIES.items():
        try:
            j = fetch_json('https://api.stlouisfed.org/fred/series/observations', params={'series_id': sid, 'api_key': key, 'file_type': 'json', 'sort_order': 'desc', 'limit': 25})
            obs = [(o['date'][:7], float(o['value'])) for o in j.get('observations', []) if o.get('value') not in ('.', None)]
            if not obs:
                continue
            obs.reverse()
            last, prev = obs[-1], obs[-2] if len(obs) > 1 else None
            yago = next((o for o in obs if o[0] == '%d%s' % (int(last[0][:4]) - 1, last[0][4:])), None)
            out.append({'source': 'FRED (IMF)', 'series': sid, 'mineral': code, 'label': label, 'unit': unit, 'period': last[0], 'value': last[1],
                        'prev': prev[1] if prev else None, 'mom_pct': round((last[1] / prev[1] - 1) * 100, 2) if prev and prev[1] else None,
                        'yoy_pct': round((last[1] / yago[1] - 1) * 100, 2) if yago and yago[1] else None,
                        'history': [{'p': p, 'v': v} for p, v in obs], 'url': 'https://fred.stlouisfed.org/series/' + sid})
        except Exception as e:
            errors.append('%s: %s' % (sid, e))
    return out, errors
