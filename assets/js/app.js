/* Millennium KI Strategic Mine Ownership Atlas: application logic.
   Global state (filters + selection) cross-filters the map, network, chart builder and register. */
(function () {
  'use strict';
  var D = window.QX, G = window.QXGeo;
  var MINES = D.mines, MIN = D.minerals, CTRY = D.countries, CHORO = D.choro, SRC = D.sources, META = D.meta;
  var CLS = META.control_types, PREC = META.precision;
  var CLS_KEYS = ['cnsoe', 'cnpriv', 'ru', 'state', 'priv'];

  /* ---------- helpers ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function flag(cc) { return cc && cc.length === 2 && /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint.apply(null, cc.split('').map(function (c) { return 127397 + c.charCodeAt(0); })) : ''; }
  function cname(cc) { return (CTRY[cc] && CTRY[cc].name) || cc; }
  function ml(c) { return (MIN[c] && MIN[c].l) || c; }
  function isCN(c) { return c === 'cnsoe' || c === 'cnpriv'; }
  function stateLinked(c) { return c === 'cnsoe' || c === 'ru' || c === 'state'; }
  function ringed(m) { return isCN(m.ctrl_cls) || stateLinked(m.ctrl_cls) || m.owners.some(function (o) { return isCN(o.cl); }); }
  var FALLBACK = ['#ff8a3d', '#3d8bff', '#9be15d', '#ff4fe6', '#f5e663', '#4fe0ff', '#c39bff'];
  function mcol(c) { var x = MIN[c] && MIN[c].col; return x && x.toLowerCase() !== '#ffffff' ? x : '#dfe6f0'; }
  function srcLabel(s) { return s.charAt(0) === 'Q' ? 'Wikidata ' + s : s === 'I' ? 'Located on Esri World Imagery' : s === 'D' ? 'District centroid' : s === 'WP' ? 'Wikipedia' : 'Analyst approximation'; }
  function fmtShare(v) { return v === null || v === undefined ? 'n/a' : v.toFixed(1) + '%'; }
  function ownersTxt(m) { return m.owners.map(function (o) { return o.n + (o.pct !== null ? ' ' + o.pct + '%' : ''); }).join('; '); }
  function statusGroup(s) {
    if (/^Operating/i.test(s)) return 'Operating';
    if (/ramp|commission|restart/i.test(s)) return 'Ramping / restarting';
    if (/care|suspend|halt|seiz|conflict/i.test(s)) return 'Disrupted / idle';
    if (/construct|develop/i.test(s)) return 'Development';
    return 'Other';
  }
  function topOwner(m) {
    var k = m.owners.filter(function (o) { return o.pct !== null; });
    return k.length ? k.reduce(function (a, b) { return b.pct > a.pct ? b : a; }) : m.owners[0];
  }
  function attributed(m) { // equity-weighted split of a mine's world share
    if (m.share === null) return [];
    var known = m.owners.filter(function (o) { return o.pct !== null; }), unk = m.owners.filter(function (o) { return o.pct === null; });
    var sumK = known.reduce(function (a, o) { return a + o.pct; }, 0), rest = Math.max(0, 100 - sumK);
    var out = known.map(function (o) { return { o: o, v: m.share * o.pct / 100 }; });
    unk.forEach(function (o) { out.push({ o: o, v: m.share * rest / 100 / unk.length }); });
    return out;
  }
  function toast(t) { var el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(function () { el.hidden = true; }, 2200); }
  function copyText(t) {
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(t).then(function () { toast('Copied: ' + t); }, function () { toast(t); });
    else { var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast('Copied: ' + t); } catch (e) { toast(t); } ta.remove(); }
  }
  MINES.forEach(function (m) { m.sg = statusGroup(m.status); m.top = topOwner(m); m.ring = ringed(m); });

  /* ---------- export ---------- */
  function mineProps(m) {
    var mi = MIN[m.primary] || {};
    return {
      id: m.id, name: m.name, host_country: cname(m.host), host_iso2: m.host, primary_mineral: ml(m.primary), secondary_minerals: m.secondary.map(ml).join('; '),
      operator: m.operator, owners: m.owners.map(function (o) { return o.n + (o.pct !== null ? ' ' + o.pct + '%' : '') + ' (' + o.cc + ')'; }).join('; '),
      controlling_owner_hq_iso2: m.ctrl_cc, control_type: CLS[m.ctrl_cls].label, production: m.production, production_year: m.year || null,
      world_share_pct: m.share, status: m.status, us_critical_2025: mi.crit === undefined ? null : mi.crit, us_net_import_reliance: mi.nir || null,
      us_defense_stockpile: mi.nds || null, lat: m.lat, lon: m.lon, mgrs: m.mgrs, coord_precision: PREC[m.prec].label, coord_ce_m: PREC[m.prec].ce_m,
      coord_source: srcLabel(m.coord_src), sources: m.src.map(function (s) { return SRC[s] ? SRC[s].u : s; }).join(' ')
    };
  }
  function toGeoJSON(list) {
    return JSON.stringify({ type: 'FeatureCollection', name: 'millenniumki_strategic_mines', crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } },
      features: list.map(function (m) { return { type: 'Feature', geometry: { type: 'Point', coordinates: [m.lon, m.lat] }, properties: mineProps(m) }; }) }, null, 1);
  }
  function csvCell(v) { v = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function toCSV(list) {
    if (!list.length) return '';
    var keys = Object.keys(mineProps(list[0]));
    return [keys.join(',')].concat(list.map(function (m) { var p = mineProps(m); return keys.map(function (k) { return csvCell(p[k]); }).join(','); })).join('\n');
  }
  function download(name, text, type) {
    try {
      var b = new Blob([text], { type: type }), u = URL.createObjectURL(b), a = document.createElement('a');
      a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(u); }, 4000); toast('Exported ' + name);
    } catch (e) { copyText(text); }
  }
  function exportSet() { return viewMines(); }
  function exportGeo() { download('millenniumki_mines_filtered.geojson', toGeoJSON(exportSet()), 'application/geo+json'); }
  function exportCsv() { download('millenniumki_mines_filtered.csv', toCSV(exportSet()), 'text/csv'); }

  /* ---------- global state ---------- */
  var S = { min: 'all', occ: 'all', cls: 'all', crit: false, sel: null };
  var filtered = MINES.slice(), selSet = null;
  function passes(m) {
    if (S.min !== 'all' && m.primary !== S.min && m.secondary.indexOf(S.min) < 0) return false;
    if (S.occ !== 'all' && !m.owners.some(function (o) { return o.cc === S.occ; })) return false;
    if (S.cls === 'china' && !m.owners.some(function (o) { return isCN(o.cl); })) return false;
    if (S.cls === 'state' && !stateLinked(m.ctrl_cls) && !isCN(m.ctrl_cls)) return false;
    if (S.cls === 'state_' && m.ctrl_cls !== 'state') return false;
    if (['cnsoe', 'cnpriv', 'ru', 'priv'].indexOf(S.cls) >= 0 && m.ctrl_cls !== S.cls) return false;
    if (S.crit && !(MIN[m.primary] && MIN[m.primary].crit)) return false;
    return true;
  }
  function inSel(m) {
    var s = S.sel; if (!s) return true;
    if (s.kind === 'mine') return m.id === s.key;
    if (s.kind === 'owner') return m.owners.some(function (o) { return o.n === s.key; });
    if (s.kind === 'country') return m.host === s.key;
    if (s.kind === 'mineral') return m.primary === s.key;
    return true;
  }
  /* A mine selection only highlights; owner / country / mineral selections narrow every view. */
  function narrowing() { return S.sel && S.sel.kind !== 'mine'; }
  function viewMines() { return narrowing() ? filtered.filter(inSel) : filtered; }
  function selLabel() {
    var s = S.sel; if (!s) return '';
    if (s.kind === 'mine') return MINES[s.key].name;
    if (s.kind === 'country') return flag(s.key) + ' ' + cname(s.key) + ' (host)';
    if (s.kind === 'mineral') return ml(s.key);
    return s.key + ' (owner)';
  }
  var views = [];
  function update(opts) {
    filtered = MINES.filter(passes);
    selSet = S.sel ? new Set(MINES.filter(inSel).map(function (m) { return m.id; })) : null;
    renderFilterBar();
    views.forEach(function (v) { try { v(opts || {}); } catch (e) { console.error(e); } });
  }
  function setSel(s, opts) {
    if (s && S.sel && S.sel.kind === s.kind && S.sel.key === s.key && !(opts && opts.keep)) s = null;
    S.sel = s; update(opts);
  }

  /* ---------- filter bar ---------- */
  function opt(v, l) { var o = document.createElement('option'); o.value = v; o.textContent = l; return o; }
  function initFilters() {
    var fm = $('#fMin'); fm.appendChild(opt('all', 'All minerals'));
    var mins = Array.from(new Set([].concat.apply([], MINES.map(function (m) { return [m.primary].concat(m.secondary); })))).filter(function (c) { return MIN[c]; })
      .sort(function (a, b) { return ml(a).localeCompare(ml(b)); });
    mins.forEach(function (c) { fm.appendChild(opt(c, ml(c))); });
    var fo = $('#fOcc'); fo.appendChild(opt('all', 'All owner countries'));
    Array.from(new Set([].concat.apply([], MINES.map(function (m) { return m.owners.map(function (o) { return o.cc; }); }))))
      .sort(function (a, b) { return cname(a).localeCompare(cname(b)); }).forEach(function (c) { fo.appendChild(opt(c, flag(c) + ' ' + cname(c))); });
    var fc = $('#fCls');
    [['all', 'All control types'], ['china', 'Any Chinese stake'], ['state', 'State-linked or Chinese'], ['cnsoe', CLS.cnsoe.label], ['cnpriv', CLS.cnpriv.label], ['ru', CLS.ru.label], ['state_', CLS.state.label], ['priv', CLS.priv.label]]
      .forEach(function (p) { fc.appendChild(opt(p[0], p[1])); });
    fm.onchange = function () { S.min = fm.value; update(); };
    fo.onchange = function () { S.occ = fo.value; update(); };
    fc.onchange = function () { S.cls = fc.value; update(); };
    $('#fCrit').onchange = function (e) { S.crit = e.target.checked; update(); };
    $('#fReset').onclick = function () { S.min = 'all'; S.occ = 'all'; S.cls = 'all'; S.crit = false; S.sel = null; fm.value = 'all'; fo.value = 'all'; fc.value = 'all'; $('#fCrit').checked = false; update({ home: true }); };
    $('#fbToggle').onclick = function () { var fb = $('#filterbar'); fb.classList.toggle('open'); this.setAttribute('aria-expanded', fb.classList.contains('open')); };
  }
  function renderFilterBar() {
    var n = viewMines().length, act = (S.min !== 'all') + (S.occ !== 'all') + (S.cls !== 'all') + S.crit + (S.sel ? 1 : 0);
    $('#fbNote').textContent = n + ' of ' + MINES.length + ' mines in view';
    $('#fbCount').textContent = act ? '(' + act + ' active · ' + n + ' mines)' : '(' + n + ' mines)';
    var chip = $('#selChip');
    if (S.sel) { chip.hidden = false; chip.innerHTML = 'Selected: ' + esc(selLabel()) + ' <button aria-label="Clear selection">✕</button>'; chip.querySelector('button').onclick = function () { setSel(null); }; }
    else chip.hidden = true;
  }

  /* ---------- KPIs ---------- */
  function renderKPIs() {
    var total = MINES.length, crit = MINES.filter(function (m) { return MIN[m.primary] && MIN[m.primary].crit; }).length;
    var cnC = MINES.filter(function (m) { return isCN(m.ctrl_cls); }).length, cnA = MINES.filter(function (m) { return m.owners.some(function (o) { return isCN(o.cl); }); }).length;
    var st = MINES.filter(function (m) { return stateLinked(m.ctrl_cls); }).length;
    var ver = MINES.filter(function (m) { return m.prec === 'S' || m.prec === 'W'; }).length, s = MINES.filter(function (m) { return m.prec === 'S'; }).length;
    var k = [
      [String(total), 'Major mines tracked', crit + ' produce a mineral on the 2025 US critical list', ''],
      [cnC + ' / ' + cnA, 'Chinese-controlled / any Chinese stake', Math.round(cnA / total * 100) + '% of tracked mines', ''],
      [String(st), 'Controlled by a state-linked owner', 'Chinese SOE, Russian or other state', ''],
      ['38%', 'World cobalt mined by CMOC', '114.2 kt of 302 kt in 2024 (CMOC; USGS)', 'warn'],
      [ver + ' / ' + total, 'Coordinates sourced or verified', s + ' site-verified on Esri imagery, ' + (ver - s) + ' Wikidata/Wikipedia', '']
    ];
    $('#kpis').innerHTML = k.map(function (x) { return '<div class="kpi ' + x[3] + '"><b>' + esc(x[0]) + '</b><span>' + esc(x[1]) + '</span><small>' + esc(x[2]) + '</small></div>'; }).join('');
  }

  /* =====================================================================
     MAP (MapLibre GL JS, live tiles)
     ===================================================================== */
  var map = null, hoverPop = null, mapReady = false;
  var base = 'dark', choroMin = 'Cu', measuring = false, mpts = [], mcursor = null, searchPin = null;
  var L = { pulse: true, pts: true, cl: false, heat: false, arcs: false, lab: true, prec: true, choro: false, ref: true, hill: false, t3d: false, globe: false };
  var ATTR = {
    sat: 'Imagery © <a href="https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9" target="_blank" rel="noopener">Esri</a>, Maxar, Earthstar Geographics, and the GIS User Community',
    ref: 'Reference © Esri',
    topo: 'Topo © <a href="https://www.arcgis.com/home/item.html?id=7dc6cea0b1764a1f9af2e679f642f0f5" target="_blank" rel="noopener">Esri</a>, HERE, Garmin, FAO, NOAA, USGS, © OpenStreetMap contributors, and the GIS User Community',
    dark: 'Dark Gray Canvas © <a href="https://www.arcgis.com/home/item.html?id=358ec1e175ea41c3bf5c68f0da11ae2b" target="_blank" rel="noopener">Esri</a>, HERE, Garmin, © OpenStreetMap contributors, and the GIS User Community',
    dem: 'Elevation: <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">Tilezen Terrarium</a> (SRTM, GMTED, ETOPO1 et al.)',
    ne: 'Boundaries: Natural Earth · Production: USGS MCS 2026'
  };
  var CHORO_BREAKS = [1, 5, 10, 25, 50];
  var CHORO_COLS = ['#16365e', '#1f6390', '#2397a8', '#4cc39a', '#b6e37a', '#fff27a'];
  function choroClass(t) { var i = 0; while (i < CHORO_BREAKS.length && t >= CHORO_BREAKS[i]) i++; return i; }

  function glyphURL() {
    if (location.protocol === 'file:') return 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf';
    return location.href.replace(/[#?].*$/, '').replace(/[^/]*$/, '') + 'assets/fonts/{fontstack}/{range}.pbf';
  }
  function rasterSrc(tiles, attr, maxz, ts) { return { type: 'raster', tiles: tiles, tileSize: ts || 256, maxzoom: maxz, attribution: attr }; }
  /* Tile providers are set in assets/js/config.js (default: keyless Esri). */
  function tileConfig() {
    var c = (window.QX_CONFIG && window.QX_CONFIG.tiles) || {};
    var terrarium = { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, maxzoom: 15, attribution: ATTR.dem };
    if (c.provider === 'maptiler' && c.maptilerKey) {
      var k = encodeURIComponent(c.maptilerKey);
      var MA = '<a href="https://www.maptiler.com/copyright/" target="_blank" rel="noopener">© MapTiler</a> <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>';
      return { name: 'MapTiler',
        dark: rasterSrc(['https://api.maptiler.com/maps/dataviz-dark/256/{z}/{x}/{y}.png?key=' + k], MA, 20), darkref: null,
        sat: rasterSrc(['https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=' + k], MA, 20, 512), ref: null,
        topo: rasterSrc(['https://api.maptiler.com/maps/topo-v2/256/{z}/{x}/{y}.png?key=' + k], MA, 20),
        dem: { type: 'raster-dem', tiles: ['https://api.maptiler.com/tiles/terrain-rgb-v2/{z}/{x}/{y}.webp?key=' + k], encoding: 'mapbox', tileSize: 512, maxzoom: 14, attribution: MA } };
    }
    var keyed = c.provider === 'esri-key' && c.esriApiKey;
    var esri = function (svc) { return keyed ? ['https://ibasemaps-api.arcgis.com/arcgis/rest/services/' + svc + '/MapServer/tile/{z}/{y}/{x}?token=' + encodeURIComponent(c.esriApiKey)] : ['https://server.arcgisonline.com/ArcGIS/rest/services/' + svc + '/MapServer/tile/{z}/{y}/{x}']; };
    return { name: keyed ? 'Esri (API key)' : 'Esri (keyless)',
      dark: rasterSrc(esri('Canvas/World_Dark_Gray_Base'), ATTR.dark, 16), darkref: rasterSrc(esri('Canvas/World_Dark_Gray_Reference'), ATTR.dark, 16),
      sat: rasterSrc(esri('World_Imagery'), ATTR.sat, 19), ref: rasterSrc(esri('Reference/World_Boundaries_and_Places'), ATTR.ref, 19),
      topo: rasterSrc(esri('World_Topo_Map'), ATTR.topo, 19), dem: terrarium };
  }
  function buildStyle() {
    var TC = tileConfig();
    var dem = TC.dem;
    var empty = { type: 'geojson', data: { type: 'FeatureCollection', features: [] } };
    var radBase = ['interpolate', ['linear'], ['get', 'shr'], -1, 3.6, 0, 3.6, 2, 6, 10, 10, 25, 15, 45, 21];
    var rad = ['interpolate', ['linear'], ['zoom'], 1, ['*', 0.75, radBase], 6, ['*', 1.1, radBase], 13, ['*', 1.6, radBase]];
    var ptPaint = {
      'circle-radius': rad, 'circle-color': ['get', 'col'],
      'circle-opacity': ['case', ['==', ['get', 'dim'], 1], 0.16, 0.92],
      'circle-stroke-color': ['case', ['==', ['get', 'ring'], 1], ['get', 'ccol'], 'rgba(5,8,14,0.9)'],
      'circle-stroke-width': ['case', ['==', ['get', 'ring'], 1], 2.6, 1],
      'circle-stroke-opacity': ['case', ['==', ['get', 'dim'], 1], 0.2, 1]
    };
    var style = {
      version: 8, glyphs: glyphURL(),
      sources: {
        dark: TC.dark, sat: TC.sat, topo: TC.topo,
        dem: dem, demhs: JSON.parse(JSON.stringify(dem)),
        countries: { type: 'geojson', data: D.world, attribution: ATTR.ne },
        mines: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        minescl: { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, cluster: true, clusterRadius: 42, clusterMaxZoom: 5 },
        arcs: empty, prec: JSON.parse(JSON.stringify(empty)), sel: JSON.parse(JSON.stringify(empty)), measure: JSON.parse(JSON.stringify(empty))
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#070b13' } },
        { id: 'base-dark', type: 'raster', source: 'dark', paint: { 'raster-brightness-max': 0.62, 'raster-saturation': -0.2, 'raster-contrast': 0.15 } },
        { id: 'base-sat', type: 'raster', source: 'sat', layout: { visibility: 'none' } },
        { id: 'base-topo', type: 'raster', source: 'topo', layout: { visibility: 'none' } },
        { id: 'hill', type: 'hillshade', source: 'demhs', layout: { visibility: 'none' }, paint: { 'hillshade-exaggeration': 0.55, 'hillshade-shadow-color': '#000000', 'hillshade-highlight-color': '#9fb6d8' } },
        { id: 'ref', type: 'raster', source: 'ref', layout: { visibility: 'none' } },
        { id: 'darkref', type: 'raster', source: 'darkref', paint: { 'raster-opacity': 0.85 } },
        { id: 'ctry-fill', type: 'fill', source: 'countries', paint: { 'fill-color': '#000000', 'fill-opacity': 0 } },
        { id: 'ctry-line', type: 'line', source: 'countries', layout: { visibility: 'none' }, paint: { 'line-color': '#7f93b5', 'line-width': 0.6, 'line-opacity': 0.7 } },
        { id: 'heat', type: 'heatmap', source: 'mines', layout: { visibility: 'none' }, paint: {
          'heatmap-weight': ['interpolate', ['linear'], ['get', 'shr'], -1, 0.25, 0, 0.25, 40, 1],
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 0.9, 8, 2.2],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 16, 4, 30, 9, 50],
          'heatmap-opacity': 0.8,
          'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0,0,0,0)', 0.15, 'rgba(60,30,120,0.6)', 0.35, 'rgb(150,30,130)', 0.55, 'rgb(235,70,70)', 0.78, 'rgb(255,165,40)', 1, 'rgb(255,250,200)'] } },
        { id: 'arcs', type: 'line', source: 'arcs', layout: { visibility: 'none', 'line-cap': 'round' }, paint: {
          'line-color': ['get', 'col'], 'line-width': ['interpolate', ['linear'], ['get', 'w'], 0, 0.7, 100, 2.8],
          'line-opacity': ['case', ['==', ['get', 'dim'], 1], 0.07, 0.6] } },
        { id: 'prec-fill', type: 'fill', source: 'prec', minzoom: 6, paint: { 'fill-color': ['get', 'col'], 'fill-opacity': 0.07 } },
        { id: 'prec-line', type: 'line', source: 'prec', minzoom: 6, paint: { 'line-color': ['get', 'col'], 'line-width': 1.4, 'line-dasharray': [3, 2], 'line-opacity': 0.9 } },
        { id: 'cl-circle', type: 'circle', source: 'minescl', filter: ['has', 'point_count'], layout: { visibility: 'none' }, paint: {
          'circle-color': 'rgba(62,230,195,0.22)', 'circle-stroke-color': '#3ee6c3', 'circle-stroke-width': 1.5,
          'circle-radius': ['interpolate', ['linear'], ['get', 'point_count'], 2, 13, 10, 20, 40, 30] } },
        { id: 'cl-count', type: 'symbol', source: 'minescl', filter: ['has', 'point_count'], layout: { visibility: 'none', 'text-field': ['to-string', ['get', 'point_count']], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-allow-overlap': true }, paint: { 'text-color': '#e8fbff' } },
        { id: 'pts-cl', type: 'circle', source: 'minescl', filter: ['!', ['has', 'point_count']], layout: { visibility: 'none' }, paint: ptPaint },
        { id: 'pts', type: 'circle', source: 'mines', paint: ptPaint },
        { id: 'sel-halo', type: 'circle', source: 'sel', paint: { 'circle-radius': 17, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#3ee6c3', 'circle-stroke-width': 2.4 } },
        { id: 'labels', type: 'symbol', source: 'mines', minzoom: 2.6, layout: {
          'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 3, 10.5, 10, 13.5],
          'text-offset': [0, 1.15], 'text-anchor': 'top', 'text-max-width': 9, 'text-optional': true }, paint: {
          'text-color': '#eaf2ff', 'text-halo-color': 'rgba(3,6,12,0.95)', 'text-halo-width': 1.6, 'text-opacity': ['case', ['==', ['get', 'dim'], 1], 0.25, 1] } },
        { id: 'measure-line', type: 'line', source: 'measure', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#ffb547', 'line-width': 2.4, 'line-dasharray': [2, 1.2] } },
        { id: 'measure-pts', type: 'circle', source: 'measure', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 4.5, 'circle-color': '#ffb547', 'circle-stroke-color': '#070b13', 'circle-stroke-width': 1.5 } }
      ]
    };
    ['ref', 'darkref'].forEach(function (k) { if (TC[k]) style.sources[k] = TC[k]; else style.layers = style.layers.filter(function (l) { return l.id !== k; }); });
    window.__qxTiles = TC.name;
    return style;
  }
  function ccolOf(m) {
    if (isCN(m.ctrl_cls) || stateLinked(m.ctrl_cls)) return CLS[m.ctrl_cls].color;
    var cn = m.owners.filter(function (o) { return isCN(o.cl); })[0];
    return cn ? CLS[cn.cl].color : CLS[m.ctrl_cls].color;
  }
  function mineFeature(m, dim) {
    return { type: 'Feature', id: m.id, geometry: { type: 'Point', coordinates: [m.lon, m.lat] },
      properties: { id: m.id, name: m.name, col: mcol(m.primary), ccol: ccolOf(m), ring: m.ring ? 1 : 0, shr: m.share === null ? -1 : m.share, dim: dim ? 1 : 0, pr: m.prec } };
  }
  function fc(f) { return { type: 'FeatureCollection', features: f }; }
  function setVis(id, on) { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); }
  function applyLayers() {
    if (!mapReady) return;
    setVis('base-dark', base === 'dark'); setVis('base-sat', base === 'sat'); setVis('base-topo', base === 'topo');
    setVis('ref', base === 'sat' && L.ref); setVis('darkref', base === 'dark' && L.ref); setVis('hill', L.hill);
    setVis('pts', L.pts && !L.cl); setVis('pts-cl', L.pts && L.cl); setVis('cl-circle', L.pts && L.cl); setVis('cl-count', L.pts && L.cl);
    setVis('heat', L.heat); setVis('arcs', L.arcs); setVis('labels', L.lab && L.pts); setVis('prec-fill', L.prec); setVis('prec-line', L.prec);
    setVis('ctry-line', L.choro);
    map.setPaintProperty('ctry-fill', 'fill-opacity', L.choro ? 0.6 : 0);
    if (L.choro) applyChoro();
    $$('#baseSeg button').forEach(function (b) { b.classList.toggle('on', b.dataset.b === base); });
    $('#lRef').disabled = base === 'topo';
    try {
      if (L.t3d) { map.setTerrain({ source: 'dem', exaggeration: 1.4 }); if (map.getPitch() < 30) map.easeTo({ pitch: 55, duration: 900 }); }
      else { map.setTerrain(null); if (map.getCenterElevation && map.getCenterElevation()) map.jumpTo({ elevation: 0 }); if (map.getPitch() > 0) map.easeTo({ pitch: 0, duration: 600 }); }
    } catch (e) { console.warn('terrain', e); }
    try { map.setProjection({ type: L.globe ? 'globe' : 'mercator' }); } catch (e) { console.warn('projection', e); }
    renderLegend();
  }
  function applyChoro() {
    var c = CHORO[choroMin]; if (!c) return;
    var expr = ['match', ['get', 'iso2']];
    Object.keys(c.v).forEach(function (cc) { expr.push(cc, CHORO_COLS[choroClass(c.v[cc] / c.world * 100)]); });
    expr.push('rgba(0,0,0,0)');
    map.setPaintProperty('ctry-fill', 'fill-color', expr.length > 3 ? expr : '#000000');
  }
  function mapUpdate(opts) {
    if (!mapReady) return;
    var narrow = narrowing();
    var feats = filtered.map(function (m) { return mineFeature(m, narrow && !selSet.has(m.id)); });
    map.getSource('mines').setData(fc(feats));
    map.getSource('minescl').setData(fc(feats));
    var arcs = [];
    filtered.forEach(function (m) {
      var dim = narrow && !selSet.has(m.id), seen = {};
      m.owners.forEach(function (o) {
        if (o.cc === m.host || seen[o.cc] || !CTRY[o.cc] || CTRY[o.cc].lon === null) return; seen[o.cc] = 1;
        arcs.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: G.gcPath([CTRY[o.cc].lon, CTRY[o.cc].lat], [m.lon, m.lat], 48) },
          properties: { col: CLS[o.cl].color, w: o.pct === null ? 25 : o.pct, dim: dim ? 1 : 0 } });
      });
    });
    map.getSource('arcs').setData(fc(arcs));
    map.getSource('prec').setData(fc(filtered.filter(function (m) { return !narrow || selSet.has(m.id); }).map(function (m) {
      return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [G.circle(m.lon, m.lat, PREC[m.prec].ce_m, 72)] }, properties: { col: mcol(m.primary) } };
    })));
    var sm = S.sel && S.sel.kind === 'mine' ? MINES[S.sel.key] : null;
    map.getSource('sel').setData(fc(sm ? [mineFeature(sm, false)] : []));
    renderLegend();
    renderDetail();
    renderPulses();
    if (opts.home) home();
    if (opts.fit && narrow) fitMines(viewMines());
  }
  function home() { map.flyTo({ center: [18, 14], zoom: window.innerWidth < 820 ? 0.6 : 1.55, pitch: L.t3d ? 45 : 0, bearing: 0, duration: 1200 }); }
  function fitMines(list) {
    if (!list.length) return;
    if (list.length === 1) { map.flyTo({ center: [list[0].lon, list[0].lat], zoom: 8 }); return; }
    var b = new maplibregl.LngLatBounds();
    list.forEach(function (m) { b.extend([m.lon, m.lat]); });
    map.fitBounds(b, { padding: { top: 70, bottom: 60, left: window.innerWidth < 820 ? 30 : 270, right: 70 }, maxZoom: 7, duration: 1200 });
  }
  function zoomFor(m) { return m.prec === 'S' ? 13.2 : m.prec === 'W' ? 12 : 9; }
  function detailPad() { return window.innerWidth < 820 ? { bottom: window.innerHeight * 0.4 } : { right: 380, left: 250 }; }
  function selectMine(id, fly) {
    var m = MINES[id];
    S.sel = { kind: 'mine', key: id }; update();
    if (fly && map) map.flyTo({ center: [m.lon, m.lat], zoom: Math.max(map.getZoom(), zoomFor(m)), padding: detailPad(), duration: 1600, essential: true });
  }
  function zoomToPit(id) {
    var m = MINES[id]; base = 'sat'; applyLayers();
    map.flyTo({ center: [m.lon, m.lat], zoom: m.prec === 'S' ? 14.5 : m.prec === 'W' ? 13 : 10.5, padding: detailPad(), duration: 2000, essential: true });
    location.hash !== '#map' && document.getElementById('map').scrollIntoView({ behavior: 'smooth' });
  }

  /* ---------- legend ---------- */
  function renderLegend() {
    var el = $('#legendBody'); if (!el) return;
    var mins = {}; filtered.forEach(function (m) { mins[m.primary] = (mins[m.primary] || 0) + 1; });
    var h = '<div class="lg-t">Primary mineral (fill)</div><div class="lg-grid">' + Object.keys(mins).sort(function (a, b) { return mins[b] - mins[a]; }).map(function (c) {
      return '<div class="lg-row"><span class="lg-sw" style="background:' + mcol(c) + '"></span>' + esc(ml(c)) + ' <span style="color:var(--tx3)">' + mins[c] + '</span></div>'; }).join('') + '</div>';
    h += '<div class="lg-t">Ring = Chinese / state-linked</div>' + ['cnsoe', 'cnpriv', 'ru', 'state'].map(function (k) {
      return '<div class="lg-row"><span class="lg-ring" style="box-shadow:0 0 0 2.5px ' + CLS[k].color + '"></span>' + esc(CLS[k].label) + '</div>'; }).join('');
    h += '<div class="lg-t">Size = world share of output</div><div class="lg-row"><svg width="120" height="30"><circle cx="10" cy="18" r="4" fill="#8aa"/><circle cx="34" cy="16" r="8" fill="#8aa"/><circle cx="70" cy="13" r="12" fill="#8aa"/></svg></div><div class="lg-ticks" style="width:96px"><span>n/a</span><span>10%</span><span>40%</span></div>';
    h += '<div class="lg-t">Precision circle (z ≥ 6)</div>' + ['S', 'W', 'D', 'A'].map(function (k) {
      return '<div class="lg-row"><b style="width:14px;color:var(--acc)">' + k + '</b>' + esc(PREC[k].label) + ' · CE ' + (PREC[k].ce_m / 1000) + ' km</div>'; }).join('');
    if (L.choro && CHORO[choroMin]) {
      var c = CHORO[choroMin];
      h += '<div class="lg-t">USGS 2025e mine production: ' + esc(ml(choroMin)) + '</div><div style="display:flex;gap:2px">' + CHORO_COLS.map(function (x) { return '<span class="lg-grad" style="flex:1;background:' + x + '"></span>'; }).join('') + '</div><div class="lg-ticks"><span>&lt;1%</span><span>5</span><span>10</span><span>25</span><span>50%+</span></div><div class="lg-row">World ' + c.world.toLocaleString() + ' ' + esc(c.unit) + '</div>';
    }
    if (L.arcs) h += '<div class="lg-t">Arcs: foreign owner HQ → mine</div><div class="lg-row">Colour = owner control type, width = equity %</div>';
    if (L.heat) h += '<div class="lg-t">Heatmap</div><div class="lg-grad" style="background:linear-gradient(90deg,rgba(60,30,120,.6),rgb(150,30,130),rgb(235,70,70),rgb(255,165,40),rgb(255,250,200))"></div><div class="lg-ticks"><span>low</span><span>share-weighted density</span><span>high</span></div>';
    el.innerHTML = h;
  }

  /* ---------- detail panel ---------- */
  function tagFor(cl) { return cl === 'cnsoe' || cl === 'ru' ? 'bad' : cl === 'cnpriv' || cl === 'state' ? 'warn' : ''; }
  function renderDetail() {
    var el = $('#detail'), m = S.sel && S.sel.kind === 'mine' ? MINES[S.sel.key] : null;
    if (!m) { el.hidden = true; el.innerHTML = ''; return; }
    var mi = MIN[m.primary] || {};
    var dd = m.lat.toFixed(5) + ', ' + m.lon.toFixed(5);
    var own = m.owners.map(function (o) {
      return '<span>' + flag(o.cc) + ' ' + esc(o.n) + ' <small style="color:var(--tx3)">' + esc(CLS[o.cl].label) + '</small></span><b class="mono" style="text-align:right">' + (o.pct === null ? 'n/a' : o.pct + '%') + '</b>' +
        '<div class="bar"><i style="width:' + (o.pct === null ? 0 : o.pct) + '%;background:' + CLS[o.cl].color + '"></i></div>'; }).join('');
    var links = [
      ['Esri World Imagery', 'https://www.arcgis.com/home/webmap/viewer.html?center=' + m.lon + ',' + m.lat + '&level=15&basemapUrl=https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'],
      ['Google satellite', 'https://www.google.com/maps/@' + m.lat + ',' + m.lon + ',3000m/data=!3m1!1e3'],
      ['OpenStreetMap', 'https://www.openstreetmap.org/?mlat=' + m.lat + '&mlon=' + m.lon + '#map=14/' + m.lat + '/' + m.lon]
    ];
    if (m.coord_src.charAt(0) === 'Q') links.push(['Wikidata ' + m.coord_src, 'https://www.wikidata.org/wiki/' + m.coord_src]);
    el.innerHTML = '<button class="d-close" aria-label="Close">✕</button>' +
      '<div class="d-kick">' + flag(m.host) + ' ' + esc(cname(m.host)) + ' · ' + esc(ml(m.primary)) + '</div>' +
      '<div class="d-name">' + esc(m.name) + '</div><div class="d-sub">Operator: ' + esc(m.operator) + ' · ' + esc(m.status) + '</div>' +
      '<div class="tags"><span class="tag ' + tagFor(m.ctrl_cls) + '">' + esc(CLS[m.ctrl_cls].label) + '</span>' +
      (mi.crit ? '<span class="tag warn">US critical (2025)</span>' : '<span class="tag">Not on 2025 critical list</span>') +
      '<span class="tag ' + (m.prec === 'S' || m.prec === 'W' ? 'ok' : 'warn') + '">Coord: ' + esc(PREC[m.prec].label) + '</span></div>' +
      '<div class="d-sec"><h4>Ownership (equity %)</h4><div class="own">' + own + '</div><dl class="kv"><dt>Controlling HQ</dt><dd>' + flag(m.ctrl_cc) + ' ' + esc(cname(m.ctrl_cc)) + '</dd></dl></div>' +
      '<div class="d-sec"><h4>Production</h4><dl class="kv"><dt>Latest output</dt><dd>' + esc(m.production) + '</dd><dt>Year</dt><dd>' + esc(m.year || 'n/a') + '</dd>' +
      '<dt>World share</dt><dd>' + fmtShare(m.share) + (m.share !== null && m.share_unit !== m.primary ? ' (' + esc(ml(m.share_unit)) + ')' : '') + '</dd>' +
      '<dt>Minerals</dt><dd>' + esc([ml(m.primary)].concat(m.secondary.map(ml)).join(', ')) + '</dd></dl></div>' +
      '<div class="d-sec"><h4>US exposure (' + esc(ml(m.primary)) + ')</h4><dl class="kv"><dt>2025 critical list</dt><dd>' + (mi.crit === undefined ? 'n/a' : mi.crit ? 'Yes' : 'No') + '</dd>' +
      '<dt>Net import reliance</dt><dd>' + esc(mi.nir || 'n/a') + '</dd><dt>Defense stockpile</dt><dd>' + esc(mi.nds || 'n/a') + '</dd></dl></div>' +
      '<div class="d-sec"><h4>Location (WGS 84)</h4><dl class="kv">' +
      '<dt>Decimal deg.</dt><dd class="mono">' + dd + ' <button class="copy" data-c="' + dd + '" title="Copy">⧉</button></dd>' +
      '<dt>DD (hemisphere)</dt><dd class="mono">' + G.fmtDD(m.lat, m.lon, 4) + '</dd>' +
      '<dt>DMS</dt><dd class="mono">' + G.fmtDMS(m.lat, m.lon) + ' <button class="copy" data-c="' + G.fmtDMS(m.lat, m.lon) + '" title="Copy">⧉</button></dd>' +
      '<dt>MGRS</dt><dd class="mono">' + esc(m.mgrs) + ' <button class="copy" data-c="' + esc(m.mgrs) + '" title="Copy">⧉</button></dd>' +
      '<dt>Precision</dt><dd>' + m.prec + ': ' + esc(PREC[m.prec].label) + '</dd><dt>Circular error</dt><dd>≈ ' + (PREC[m.prec].ce_m / 1000) + ' km (indicative)</dd>' +
      '<dt>Coord. source</dt><dd>' + esc(srcLabel(m.coord_src)) + '</dd></dl></div>' +
      '<div class="d-sec"><div class="row2"><button class="btn" id="dPit">🛰 Zoom to site on satellite</button><button class="btn ghost" id="dHome">⌂ World</button></div>' +
      '<h4 style="margin-top:10px">Open in</h4><div class="links">' + links.map(function (l) { return '<a href="' + esc(l[1]) + '" target="_blank" rel="noopener">' + esc(l[0]) + ' ↗</a>'; }).join('') + '</div></div>' +
      intelForMine(m.id) +
      '<div class="d-sec"><h4>Sources</h4><div class="links">' + m.src.map(function (s) { return SRC[s] ? '<a href="' + esc(SRC[s].u) + '" target="_blank" rel="noopener" title="' + esc(SRC[s].t) + '">' + esc(SRC[s].t.split(' – ')[0].slice(0, 46)) + ' ↗</a>' : '<span class="tag">' + esc(s) + '</span>'; }).join('') + '</div></div>';
    el.hidden = false;
    el.querySelector('.d-close').onclick = function () { setSel(null); };
    $('#dPit').onclick = function () { zoomToPit(m.id); };
    $('#dHome').onclick = function () { home(); };
    $$('.copy', el).forEach(function (b) { b.onclick = function () { copyText(b.dataset.c); }; });
  }

  /* ---------- map init & interaction ---------- */
  function popHTML(m) {
    return '<div class="pp-n">' + flag(m.host) + ' ' + esc(m.name) + '</div><div class="pp-s">' + esc(ml(m.primary)) + ' · ' + esc(cname(m.host)) + ' · ' + esc(m.status) + '</div>' +
      '<div>' + esc(ownersTxt(m)) + '</div><div class="pp-s">' + esc(CLS[m.ctrl_cls].label) + ' · world share ' + fmtShare(m.share) + '</div>' +
      '<div class="pp-s">' + esc(m.production) + (m.year ? ' (' + esc(m.year) + ')' : '') + ' · precision ' + m.prec + '</div>';
  }
  function scaleDen(lat, z) { return Math.round(40075016.686 * Math.cos(lat * Math.PI / 180) / (512 * Math.pow(2, z)) / 0.000264583); }
  function readout(ll, tag) {
    var lat = ll.lat, lon = ((ll.lng + 180) % 360 + 360) % 360 - 180, z = map.getZoom();
    $('#readout').textContent = (tag ? tag + ' ' : '') + lat.toFixed(5) + ', ' + lon.toFixed(5) + '  |  MGRS ' + G.mgrs(lat, lon) + '  |  z ' + z.toFixed(1) + '  |  ≈1:' + scaleDen(lat, z).toLocaleString();
  }
  function measureRender() {
    var coords = mpts.slice(); if (mcursor && mpts.length) coords.push(mcursor);
    var f = mpts.map(function (p) { return { type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: {} }; });
    if (coords.length > 1) {
      var line = [];
      for (var i = 1; i < coords.length; i++) { var seg = G.gcPath(coords[i - 1], coords[i], 32); line = line.concat(i > 1 ? seg.slice(1) : seg); }
      f.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: line }, properties: {} });
    }
    map.getSource('measure').setData(fc(f));
    var box = $('#measureBox');
    if (!measuring) { box.hidden = true; return; }
    var km = 0; for (var j = 1; j < coords.length; j++) km += G.havKm(coords[j - 1], coords[j]);
    var brg = coords.length > 1 ? G.bearing(coords[coords.length - 2], coords[coords.length - 1]) : null;
    box.hidden = false;
    box.innerHTML = '<span>📏 ' + (mpts.length ? '<b>' + km.toFixed(km < 10 ? 2 : 1) + ' km</b> · ' + (km / 1.852).toFixed(1) + ' nmi · ' + (km / 1.609344).toFixed(1) + ' mi' + (brg !== null ? ' · brg ' + brg.toFixed(1) + '°' : '') + ' · ' + mpts.length + ' pts' : 'Click the map to add points') + '</span>' +
      '<button class="btn ghost" id="mUndo">Undo</button><button class="btn ghost" id="mClear">Clear</button><button class="btn" id="mDone">Done</button>';
    $('#mUndo').onclick = function () { mpts.pop(); measureRender(); };
    $('#mClear').onclick = function () { mpts = []; measureRender(); };
    $('#mDone').onclick = function () { toggleMeasure(false); };
  }
  function toggleMeasure(on) {
    measuring = on; mcursor = null; if (!on) mpts = [];
    $('#measureBtn').classList.toggle('on', on);
    map.getCanvas().style.cursor = on ? 'crosshair' : '';
    if (on) map.doubleClickZoom.disable(); else map.doubleClickZoom.enable();
    if (hoverPop) hoverPop.remove();
    measureRender();
  }
  function initMap() {
    if (!window.maplibregl) { $('#mapcv').innerHTML = '<p style="padding:40px">Map library failed to load.</p>'; return; }
    map = new maplibregl.Map({ container: 'mapcv', style: buildStyle(), center: [18, 14], zoom: window.innerWidth < 820 ? 0.6 : 1.55, maxPitch: 75,
      attributionControl: { compact: true }, hash: false, renderWorldCopies: true, fadeDuration: 150 });
    window.__qxmap = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new maplibregl.FullscreenControl({ container: $('#mapwrap') }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 130 }), 'bottom-left');
    map.addControl(new maplibregl.ScaleControl({ unit: 'nautical', maxWidth: 130 }), 'bottom-left');
    hoverPop = new maplibregl.Popup({ closeButton: false, closeOnClick: false, maxWidth: '300px', offset: 12 });
    map.on('load', function () {
      mapReady = true; applyLayers(); mapUpdate({});
      ['pts', 'pts-cl'].forEach(function (lid) {
        map.on('mousemove', lid, function (e) {
          if (measuring) return;
          var f = e.features && e.features[0]; if (!f) return;
          map.getCanvas().style.cursor = 'pointer';
          var m = MINES[f.properties.id];
          hoverPop.setLngLat([m.lon, m.lat]).setHTML(popHTML(m)).addTo(map);
        });
        map.on('mouseleave', lid, function () { if (!measuring) map.getCanvas().style.cursor = ''; hoverPop.remove(); });
      });
      map.on('mousemove', 'ctry-fill', function (e) {
        if (!L.choro || measuring) return;
        if (map.queryRenderedFeatures(e.point, { layers: ['pts', 'pts-cl'].filter(function (l) { return map.getLayoutProperty(l, 'visibility') !== 'none'; }) }).length) return;
        var f = e.features && e.features[0]; if (!f) return;
        var c = CHORO[choroMin], iso = f.properties.iso2, v = c && c.v[iso];
        var n = MINES.filter(function (m) { return m.host === iso; }).length;
        hoverPop.setLngLat(e.lngLat).setHTML('<div class="pp-n">' + flag(iso) + ' ' + esc(f.properties.name) + '</div><div>' + esc(ml(choroMin)) + ': ' + (v !== undefined ? v.toLocaleString() + ' ' + esc(c.unit) + ' · ' + (v / c.world * 100).toFixed(1) + '% of world' : 'n/a') + '</div><div class="pp-s">USGS MCS 2026, 2025 estimate · ' + n + ' tracked mines hosted</div>').addTo(map);
      });
      map.on('mouseleave', 'ctry-fill', function () { if (L.choro) hoverPop.remove(); });
      map.on('click', 'cl-circle', function (e) {
        var f = e.features[0];
        Promise.resolve(map.getSource('minescl').getClusterExpansionZoom(f.properties.cluster_id)).then(function (z) { map.easeTo({ center: f.geometry.coordinates, zoom: z + 0.3 }); });
      });
    });
    map.on('click', function (e) {
      if (measuring) { mpts.push([e.lngLat.lng, e.lngLat.lat]); measureRender(); return; }
      var lyr = ['pts', 'pts-cl', 'cl-circle'].filter(function (l) { return map.getLayer(l) && map.getLayoutProperty(l, 'visibility') !== 'none'; });
      var hits = map.queryRenderedFeatures([[e.point.x - 4, e.point.y - 4], [e.point.x + 4, e.point.y + 4]], { layers: lyr });
      if (hits.length) { if (hits[0].layer.id !== 'cl-circle') selectMine(hits[0].properties.id, true); return; }
      var c = map.queryRenderedFeatures(e.point, { layers: ['ctry-fill'] })[0];
      if (c && MINES.some(function (m) { return m.host === c.properties.iso2 && passes(m); })) setSel({ kind: 'country', key: c.properties.iso2 }, { fit: true });
      else if (S.sel) setSel(null);
    });
    map.on('mousemove', function (e) { readout(e.lngLat); if (measuring && mpts.length) { mcursor = [e.lngLat.lng, e.lngLat.lat]; measureRender(); } });
    // With 3D terrain on, keep the camera centre on the ground (MapLibre otherwise centres at sea level and high sites drift off-screen).
    var fixing = false;
    function groundFix() {
      if (fixing || !map.getTerrain()) return;
      var el = map.queryTerrainElevation(map.getCenter());
      if (el === null || el === undefined || Math.abs(el - (map.getCenterElevation ? map.getCenterElevation() : 0)) < 25) return;
      fixing = true; map.jumpTo({ center: map.getCenter(), elevation: el }); fixing = false;
    }
    map.on('moveend', function () { setTimeout(groundFix, 50); });
    map.on('idle', groundFix);
    map.on('moveend', function (e) { if (!e.originalEvent || e.originalEvent.type.indexOf('touch') === 0) readout(map.getCenter(), 'Centre'); });
    map.on('error', function (e) { if (e && e.error && !/tile|Failed to fetch|AJAXError/i.test(String(e.error.message || e.error))) console.warn('map', e.error); });

    $$('#baseSeg button').forEach(function (b) { b.onclick = function () { base = b.dataset.b; applyLayers(); }; });
    var bind = function (id, key) { var el = $('#' + id); el.checked = L[key]; el.onchange = function () { L[key] = el.checked; applyLayers(); }; };
    bind('lRef', 'ref'); bind('lHill', 'hill'); bind('l3d', 't3d'); bind('lGlobe', 'globe'); bind('lPts', 'pts'); bind('lCl', 'cl'); bind('lHeat', 'heat');
    var lp = $('#lPulse'); lp.onchange = function () { L.pulse = lp.checked; renderPulses(); };
    bind('lArcs', 'arcs'); bind('lLab', 'lab'); bind('lPrec', 'prec'); bind('lChoro', 'choro');
    var cm = $('#choroMin');
    Object.keys(CHORO).sort(function (a, b) { return ml(a).localeCompare(ml(b)); }).forEach(function (k) { cm.appendChild(opt(k, ml(k) + ' (' + CHORO[k].unit + ')')); });
    cm.value = choroMin;
    cm.onchange = function () { choroMin = cm.value; if (!L.choro) { L.choro = true; $('#lChoro').checked = true; } applyLayers(); };
    $('#measureBtn').onclick = function () { toggleMeasure(!measuring); };
    $('#homeBtn').onclick = home;
    $('#expGeo').onclick = exportGeo; $('#expCsv').onclick = exportCsv;
    $('#layersHead').onclick = function () { $('#layersPanel').classList.toggle('closed'); };
    $('#legendHead').onclick = function () { $('#legend').classList.toggle('closed'); };
    if (window.innerWidth < 820) {
      $('#layersPanel').classList.add('closed'); $('#legend').classList.add('closed');
      $('#readout').textContent = 'Pan the map to read the centre coordinate';
      map.once('load', function () { var a = $('.maplibregl-ctrl-attrib'); if (a) { a.classList.remove('maplibregl-compact-show'); a.removeAttribute('open'); } });
    }
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && measuring) toggleMeasure(false); });
    views.push(function (o) { if (o.skipMap) return; mapUpdate(o); });
    initSearch();
  }

  /* ---------- search / fly-to ---------- */
  function norm(s) { return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
  function initSearch() {
    var idx = [];
    MINES.forEach(function (m) { idx.push({ t: 'Mine', l: m.name, s: ml(m.primary) + ' · ' + cname(m.host), k: norm(m.name + ' ' + m.operator), go: function () { selectMine(m.id, true); } }); });
    var owners = {}; MINES.forEach(function (m) { m.owners.forEach(function (o) { owners[o.n] = owners[o.n] || { o: o, n: 0 }; owners[o.n].n++; }); });
    Object.keys(owners).forEach(function (n) { idx.push({ t: 'Owner', l: n, s: flag(owners[n].o.cc) + ' ' + owners[n].n + ' mines', k: norm(n), go: function () { setSel({ kind: 'owner', key: n }, { fit: true, keep: true }); } }); });
    Array.from(new Set(MINES.map(function (m) { return m.host; }))).forEach(function (c) { idx.push({ t: 'Country', l: flag(c) + ' ' + cname(c), s: 'host of ' + MINES.filter(function (m) { return m.host === c; }).length + ' mines', k: norm(cname(c) + ' ' + c), go: function () { setSel({ kind: 'country', key: c }, { fit: true, keep: true }); } }); });
    Array.from(new Set(MINES.map(function (m) { return m.primary; }))).forEach(function (c) { idx.push({ t: 'Mineral', l: ml(c), s: MINES.filter(function (m) { return m.primary === c; }).length + ' mines', k: norm(ml(c) + ' ' + c), go: function () { setSel({ kind: 'mineral', key: c }, { fit: true, keep: true }); } }); });
    var inp = $('#search'), list = $('#searchList'), act = 0, cur = [];
    function render() {
      var q = norm(inp.value.trim()); cur = [];
      if (!q) { list.hidden = true; return; }
      var mm = inp.value.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
      if (mm && Math.abs(+mm[1]) <= 90 && Math.abs(+mm[2]) <= 180) {
        var la = +mm[1], lo = +mm[2];
        cur.push({ t: 'Coord', l: la.toFixed(5) + ', ' + lo.toFixed(5), s: G.mgrs(la, lo), go: function () {
          if (searchPin) searchPin.remove();
          searchPin = new maplibregl.Marker({ color: '#ffb547' }).setLngLat([lo, la]).addTo(map);
          map.flyTo({ center: [lo, la], zoom: 12, duration: 1600 });
        } });
      }
      cur = cur.concat(idx.filter(function (i) { return i.k.indexOf(q) >= 0; }).sort(function (a, b) { return (a.k.indexOf(q) === 0 ? 0 : 1) - (b.k.indexOf(q) === 0 ? 0 : 1); }).slice(0, 12));
      act = 0;
      list.innerHTML = cur.length ? cur.map(function (i, n) { return '<div data-i="' + n + '" class="' + (n === 0 ? 'act' : '') + '"><i>' + i.t + '</i><b>' + esc(i.l) + '</b><span class="sub">' + esc(i.s) + '</span></div>'; }).join('') : '<div><span class="sub">No match. Try a mine, owner, country, mineral or "lat, lon".</span></div>';
      list.hidden = false;
      $$('div[data-i]', list).forEach(function (d) { d.onmousedown = function (e) { e.preventDefault(); pick(+d.dataset.i); }; });
    }
    function pick(i) { var it = cur[i]; if (!it) return; list.hidden = true; inp.value = it.t === 'Coord' ? inp.value : it.l.replace(/^\S+\s(?=[A-Z])/, function (x) { return /[\u{1F1E6}-\u{1F1FF}]/u.test(x) ? '' : x; }); inp.blur(); it.go(); }
    inp.addEventListener('input', render);
    inp.addEventListener('focus', render);
    inp.addEventListener('blur', function () { setTimeout(function () { list.hidden = true; }, 150); });
    inp.addEventListener('keydown', function (e) {
      var rows = $$('div[data-i]', list);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); act = (act + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % Math.max(1, rows.length); rows.forEach(function (r, n) { r.classList.toggle('act', n === act); }); }
      if (e.key === 'Enter') { e.preventDefault(); pick(act); }
      if (e.key === 'Escape') { list.hidden = true; inp.blur(); }
    });
  }

  /* =====================================================================
     NETWORK GRAPH (force-directed layout computed in-browser, rendered with ECharts)
     ===================================================================== */
  var graph = null, GN = null, gColor = 'control';
  var PALETTE = ['#ff3b4e', '#5b8def', '#ffb547', '#3ddc97', '#b06cff', '#3ee6c3', '#ff7ac6', '#c8e05a', '#ff8a3d', '#8fb7ff', '#e0a96d', '#2ec4b6'];
  function rng(seed) { return function () { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }
  function buildGraph() {
    var nodes = [], idx = {}, edges = [], rnd = rng(42);
    function add(n) {
      if (idx[n.id] !== undefined) { nodes[idx[n.id]].mines.push(n.mines[0]); return idx[n.id]; }
      var a = rnd() * Math.PI * 2, rr = 200 + rnd() * 200;
      n.x = Math.cos(a) * rr; n.y = Math.sin(a) * rr; n.vx = 0; n.vy = 0; nodes.push(n); idx[n.id] = nodes.length - 1; return nodes.length - 1;
    }
    MINES.forEach(function (m) {
      var mi = add({ id: 'm:' + m.id, kind: 'mine', key: m.id, label: m.name, cc: m.ctrl_cc, cl: m.ctrl_cls, r: 2.6 + Math.sqrt(Math.max(m.share === null ? 0.2 : m.share, 0.2)) * 2.3, mines: [m.id] });
      m.owners.forEach(function (o) { var oi = add({ id: 'o:' + o.n, kind: 'owner', key: o.n, label: o.n, cc: o.cc, cl: o.cl, r: 4, mines: [m.id] }); edges.push({ a: oi, b: mi, len: 26 }); });
      var ci = add({ id: 'c:' + m.host, kind: 'country', key: m.host, label: cname(m.host), cc: m.host, cl: null, r: 5, mines: [m.id] }); edges.push({ a: mi, b: ci, len: 42 });
      var xi = add({ id: 'x:' + m.primary, kind: 'mineral', key: m.primary, label: ml(m.primary), cc: '', cl: null, r: 7, mines: [m.id] }); edges.push({ a: mi, b: xi, len: 72 });
    });
    nodes.forEach(function (n) {
      if (n.kind === 'owner') n.r = 3.5 + Math.sqrt(n.mines.length) * 2.5;
      if (n.kind === 'country') n.r = 4 + Math.sqrt(n.mines.length) * 1.9;
      if (n.kind === 'mineral') n.r = 6 + Math.sqrt(n.mines.length) * 1.7;
    });
    var alpha = 1;
    for (var it = 0; it < 320 && alpha > 0.02; it++) {
      for (var i = 0; i < nodes.length; i++) {
        var A = nodes[i];
        for (var j = i + 1; j < nodes.length; j++) {
          var B = nodes[j], dx = A.x - B.x, dy = A.y - B.y, d2 = dx * dx + dy * dy;
          if (d2 < 1) { dx = rnd() - 0.5; dy = rnd() - 0.5; d2 = 1; }
          if (d2 > 160000) continue;
          var f = 420 * alpha / d2; A.vx += dx * f; A.vy += dy * f; B.vx -= dx * f; B.vy -= dy * f;
        }
      }
      edges.forEach(function (e) {
        var a = nodes[e.a], b = nodes[e.b], dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1, f = (d - e.len) / d * 0.08 * alpha;
        a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
      });
      nodes.forEach(function (p) { p.vx -= p.x * 0.004 * alpha; p.vy -= p.y * 0.004 * alpha; p.vx *= 0.55; p.vy *= 0.55; p.x += p.vx; p.y += p.vy; });
      alpha *= 0.985;
    }
    var ownerCounts = {}; nodes.forEach(function (n) { if (n.kind === 'owner') ownerCounts[n.cc] = (ownerCounts[n.cc] || 0) + n.mines.length; });
    var topCC = Object.keys(ownerCounts).sort(function (a, b) { return ownerCounts[b] - ownerCounts[a]; }).slice(0, 11);
    return { nodes: nodes, edges: edges, topCC: topCC };
  }
  function ccColor(cc) { var i = GN.topCC.indexOf(cc); return i >= 0 ? PALETTE[i] : '#7d8aa3'; }
  function graphOption() {
    var hiList = narrowing() ? viewMines() : S.sel && S.sel.kind === 'mine' ? [MINES[S.sel.key]] : (S.min !== 'all' || S.occ !== 'all' || S.cls !== 'all' || S.crit) ? filtered : null;
    var hi = hiList ? new Set(hiList.map(function (m) { return m.id; })) : null;
    var on = function (n) { return !hi || n.mines.some(function (id) { return hi.has(id); }); };
    var data = GN.nodes.map(function (n) {
      var lit = on(n), col;
      if (n.kind === 'mineral') col = mcol(n.key);
      else if (n.kind === 'country') col = 'rgba(0,0,0,0)';
      else col = gColor === 'control' ? CLS[n.cl].color : ccColor(n.cc);
      var selNode = S.sel && ((S.sel.kind === 'mine' && n.kind === 'mine' && n.key === S.sel.key) || (S.sel.kind === n.kind && S.sel.key === n.key));
      var big = (n.kind === 'owner' && n.mines.length >= 3) || n.kind === 'mineral' || (n.kind === 'country' && n.mines.length >= 5) || selNode;
      return {
        id: n.id, name: n.label, x: n.x, y: n.y, symbolSize: n.r * 2, symbol: n.kind === 'mineral' ? 'roundRect' : 'circle', value: n.mines.length, kind: n.kind, key: n.key,
        itemStyle: { color: col, opacity: lit ? 1 : 0.08, borderColor: selNode ? '#3ee6c3' : n.kind === 'country' ? '#a9b6cc' : 'rgba(5,8,14,.8)', borderWidth: selNode ? 3 : n.kind === 'country' ? 1.8 : 0.6 },
        label: { show: big && lit, color: n.kind === 'mineral' ? '#ffffff' : '#c9d6ea', fontSize: n.kind === 'mineral' ? 12 : 10.5, fontWeight: n.kind === 'mineral' ? 700 : 500, position: 'right', textBorderColor: '#070b13', textBorderWidth: 2 }
      };
    });
    var links = GN.edges.map(function (e) {
      var lit = on(GN.nodes[e.a]) && on(GN.nodes[e.b]);
      return { source: GN.nodes[e.a].id, target: GN.nodes[e.b].id, lineStyle: { opacity: lit ? (hi ? 0.55 : 0.22) : 0.03, width: lit && hi ? 1.1 : 0.7 } };
    });
    return {
      backgroundColor: 'transparent', animationDurationUpdate: 300,
      tooltip: { backgroundColor: 'rgba(8,13,22,.97)', borderColor: '#26395a', textStyle: { color: '#e6eef9', fontSize: 12 }, formatter: function (p) {
        if (p.dataType !== 'node') return '';
        var d = p.data, k = { mine: 'Mine', owner: 'Owner', country: 'Host country', mineral: 'Mineral' }[d.kind];
        if (d.kind === 'mine') { var m = MINES[d.key]; return '<b>' + esc(m.name) + '</b><br>' + esc(ml(m.primary)) + ' · ' + flag(m.host) + ' ' + esc(cname(m.host)) + '<br>' + esc(ownersTxt(m)) + '<br>World share ' + fmtShare(m.share); }
        var o = d.kind === 'owner' ? GN.nodes.filter(function (n) { return n.id === d.id; })[0] : null;
        return '<b>' + esc(d.name) + '</b><br>' + k + (o ? ' · ' + flag(o.cc) + ' ' + esc(cname(o.cc)) + ' · ' + esc(CLS[o.cl].label) : '') + '<br>' + d.value + ' tracked mine' + (d.value === 1 ? '' : 's') + '<br><i style="color:#9fb0c8">Click to cross-filter</i>';
      } },
      series: [{ type: 'graph', layout: 'none', roam: true, zoom: 1.2, draggable: true, scaleLimit: { min: 0.3, max: 8 }, data: data, links: links,
        lineStyle: { color: '#5d7598', curveness: 0.08 }, emphasis: { focus: 'adjacency', lineStyle: { width: 2, opacity: 0.9 }, label: { show: true } },
        labelLayout: { hideOverlap: true } }]
    };
  }
  function renderGraphLegend() {
    var h = gColor === 'control' ? CLS_KEYS.map(function (k) { return '<span><span class="dot" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + CLS[k].color + ';margin-right:6px"></span>' + esc(CLS[k].label) + '</span>'; }).join('')
      : GN.topCC.map(function (c) { return '<span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + ccColor(c) + ';margin-right:6px"></span>' + flag(c) + ' ' + esc(cname(c)) + '</span>'; }).join('') + '<span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#7d8aa3;margin-right:6px"></span>Other</span>';
    h += '<span>○ Host country</span><span>▢ Primary mineral</span>';
    $('#gLegend').innerHTML = h;
  }
  function initGraph() {
    GN = buildGraph();
    graph = echarts.init($('#graph'), null, { renderer: 'canvas' });
    graph.setOption(graphOption());
    graph.on('click', function (p) {
      if (p.dataType !== 'node') return;
      var d = p.data;
      if (d.kind === 'mine') { if (S.sel && S.sel.kind === 'mine' && S.sel.key === d.key) setSel(null); else selectMine(d.key, true); }
      else setSel({ kind: d.kind, key: d.key }, { fit: true });
    });
    $$('#gColor button').forEach(function (b) { b.onclick = function () { gColor = b.dataset.c; $$('#gColor button').forEach(function (x) { x.classList.toggle('on', x === b); }); graph.setOption(graphOption()); renderGraphLegend(); }; });
    renderGraphLegend();
    views.push(function () { graph.setOption(graphOption()); });
  }

  /* =====================================================================
     CHART BUILDER (ECharts)
     ===================================================================== */
  var chart = null;
  var C = { type: 'stacked', cat: 'ctrl_cc', val: 'share_attr', grp: 'ctrl_cls', min: 'Co', crit: false, top: 15, sx: 'share', sy: 'nir', preset: 'p1' };
  var PL = { S: 'S · site-verified', W: 'W · reference coord.', D: 'D · district centroid', A: 'A · approximate' };
  var CAT = {
    primary: { l: 'Primary mineral', k: function (r) { return r.m.primary; }, n: ml, col: mcol, sel: function (k) { setSel({ kind: 'mineral', key: k }, { fit: true }); } },
    host: { l: 'Host country', k: function (r) { return r.m.host; }, n: function (k) { return flag(k) + ' ' + cname(k); }, sel: function (k) { setSel({ kind: 'country', key: k }, { fit: true }); } },
    ctrl_cc: { l: 'Owner HQ country', k: function (r) { return r.cc; }, n: function (k) { return flag(k) + ' ' + cname(k); }, sel: function (k) { S.occ = k; $('#fOcc').value = k; update(); } },
    ctrl_cls: { l: 'Control type', k: function (r) { return r.cls; }, n: function (k) { return CLS[k].label; }, col: function (k) { return CLS[k].color; }, sel: function (k) { S.cls = k === 'state' ? 'state_' : k; $('#fCls').value = S.cls; update(); } },
    owner: { l: 'Owner company', k: function (r) { return r.owner; }, n: function (k) { return k; }, sel: function (k) { setSel({ kind: 'owner', key: k }, { fit: true }); } },
    status: { l: 'Status group', k: function (r) { return r.m.sg; }, n: function (k) { return k; } },
    prec: { l: 'Coordinate precision', k: function (r) { return r.m.prec; }, n: function (k) { return PL[k]; } },
    crit: { l: 'On 2025 US critical list', k: function (r) { return MIN[r.m.primary] && MIN[r.m.primary].crit ? 'Yes' : 'No'; }, n: function (k) { return k; } }
  };
  var VAL = {
    count: { l: 'Number of mines', agg: 'sum', v: function () { return 1; } },
    share_sum: { l: 'Sum of world share (%)', agg: 'sum', share: true, v: function (m) { return m.share; } },
    share_attr: { l: 'Equity-attributed world share (%)', agg: 'sum', share: true },
    share_avg: { l: 'Average world share (%)', agg: 'mean', share: true, v: function (m) { return m.share; } },
    nir: { l: 'US net import reliance (%), mean', agg: 'mean', v: function (m) { return MIN[m.primary] ? MIN[m.primary].nirN : null; } },
    owners_n: { l: 'Average number of owners', agg: 'mean', v: function (m) { return m.owners.length; } },
    top_eq: { l: 'Average largest equity stake (%)', agg: 'mean', v: function (m) { return m.top.pct; } }
  };
  var NUM = {
    share: { l: 'World share (%)', v: function (m) { return m.share; } },
    nir: { l: 'US net import reliance (%)', v: function (m) { return MIN[m.primary] ? MIN[m.primary].nirN : null; } },
    top_eq: { l: 'Largest equity stake (%)', v: function (m) { return m.top.pct; } },
    owners_n: { l: 'Number of owners', v: function (m) { return m.owners.length; } },
    lat: { l: 'Latitude (°)', v: function (m) { return m.lat; } },
    lon: { l: 'Longitude (°)', v: function (m) { return m.lon; } },
    year: { l: 'Production year', v: function (m) { var y = parseInt(String(m.year).replace(/\D/g, '').slice(0, 4), 10); return isNaN(y) ? null : y; } }
  };
  var TYPES = [['bar', 'Bar'], ['stacked', 'Stacked bar'], ['pie', 'Pie'], ['donut', 'Donut'], ['scatter', 'Scatter'], ['treemap', 'Treemap']];
  var PRESETS = [
    { id: 'p1', t: 'World share by owner country', s: 'Equity-attributed, one mineral', c: { type: 'stacked', cat: 'ctrl_cc', val: 'share_attr', grp: 'ctrl_cls', min: 'Co', crit: false, top: 15 } },
    { id: 'p2', t: 'Critical-mineral mines by owner country', s: 'Count, stacked by control type', c: { type: 'stacked', cat: 'ctrl_cc', val: 'count', grp: 'ctrl_cls', min: 'all', crit: true, top: 15 } },
    { id: 'p3', t: 'Mines by control type', s: 'Donut', c: { type: 'donut', cat: 'ctrl_cls', val: 'count', grp: 'none', min: 'all', crit: false, top: 15 } },
    { id: 'p4', t: 'US net import reliance', s: 'By primary mineral of tracked mines', c: { type: 'bar', cat: 'primary', val: 'nir', grp: 'none', min: 'all', crit: true, top: 25 } },
    { id: 'p5', t: 'World share vs US import reliance', s: 'Scatter, coloured by control', c: { type: 'scatter', sx: 'nir', sy: 'share', grp: 'ctrl_cls', min: 'all', crit: false } },
    { id: 'p6', t: 'Mineral × control treemap', s: 'Mine counts', c: { type: 'treemap', cat: 'primary', val: 'count', grp: 'ctrl_cls', min: 'all', crit: false, top: 25 } }
  ];
  function sel(id, label, opts, val) {
    return '<label>' + label + '<select id="' + id + '">' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(val) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label>';
  }
  function renderControls() {
    var cats = Object.keys(CAT).map(function (k) { return [k, CAT[k].l]; });
    var mins = Array.from(new Set(MINES.map(function (m) { return m.share_unit; }).concat(MINES.map(function (m) { return m.primary; })))).sort(function (a, b) { return ml(a).localeCompare(ml(b)); });
    var h = '<label>Chart type</label><div class="cb-types">' + TYPES.map(function (t) { return '<button data-t="' + t[0] + '" class="' + (C.type === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</div>';
    if (C.type === 'scatter') {
      var nums = Object.keys(NUM).map(function (k) { return [k, NUM[k].l]; });
      h += sel('cSx', 'X axis', nums, C.sx) + sel('cSy', 'Y axis', nums, C.sy) + sel('cGrp', 'Colour by', [['none', 'None']].concat(cats.filter(function (c) { return c[0] !== 'owner'; })), C.grp);
    } else {
      h += sel('cCat', C.type === 'treemap' ? 'Category (outer)' : 'Category / X axis', cats, C.cat) + sel('cVal', 'Value', Object.keys(VAL).map(function (k) { return [k, VAL[k].l]; }), C.val);
      if (C.type !== 'pie' && C.type !== 'donut') h += sel('cGrp', C.type === 'treemap' ? 'Group (inner)' : 'Group / colour by', [['none', 'None']].concat(cats.filter(function (c) { return c[0] !== C.cat; })), C.grp);
      h += sel('cTop', 'Show top', [[10, '10'], [15, '15'], [25, '25'], [999, 'All']], C.top);
    }
    h += sel('cMin', 'Mineral' + (VAL[C.val] && VAL[C.val].share && C.type !== 'scatter' ? ' (share basis)' : ''), [['all', 'All minerals']].concat(mins.map(function (c) { return [c, ml(c)]; })), C.min);
    h += '<label class="chk"><input type="checkbox" id="cCrit"' + (C.crit ? ' checked' : '') + '> US-critical primary mineral only</label>';
    h += '<p class="small" style="margin:0">Global filters and selections also apply. Click a bar, slice or point to cross-filter.</p>';
    h += '<div class="row2"><button class="btn ghost" id="cPng">⬇ PNG</button><button class="btn ghost" id="cCsv">⬇ Chart data CSV</button></div>';
    $('#cbControls').innerHTML = h;
    $$('#cbControls .cb-types button').forEach(function (b) { b.onclick = function () { C.type = b.dataset.t; C.preset = null; if ((C.type === 'stacked' || C.type === 'treemap') && C.grp === 'none') C.grp = C.cat === 'ctrl_cls' ? 'primary' : 'ctrl_cls'; renderControls(); renderChart(); }; });
    var on = function (id, key, num) { var el = $('#' + id); if (el) el.onchange = function () { C[key] = num ? +el.value : el.value; C.preset = null; if (key === 'cat' && C.grp === C.cat) C.grp = 'none'; renderControls(); renderChart(); }; };
    on('cCat', 'cat'); on('cVal', 'val'); on('cGrp', 'grp'); on('cTop', 'top', true); on('cMin', 'min'); on('cSx', 'sx'); on('cSy', 'sy');
    $('#cCrit').onchange = function (e) { C.crit = e.target.checked; C.preset = null; renderChart(); };
    $('#cPng').onclick = function () { var a = document.createElement('a'); a.href = chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#0e1520' }); a.download = 'millenniumki_chart.png'; document.body.appendChild(a); a.click(); a.remove(); };
    $('#cCsv').onclick = function () { download('millenniumki_chart_data.csv', chartCSV, 'text/csv'); };
    $$('#presets button').forEach(function (b) { b.classList.toggle('on', b.dataset.p === C.preset); });
  }
  var chartCSV = '';
  function chartMines() {
    var shareBasis = VAL[C.val] && VAL[C.val].share && C.type !== 'scatter';
    return viewMines().filter(function (m) {
      if (C.min !== 'all' && (shareBasis ? m.share_unit : m.primary) !== C.min) return false;
      if (C.crit && !(MIN[m.primary] && MIN[m.primary].crit)) return false;
      return true;
    });
  }
  function chartRows(list) {
    var rows = [];
    list.forEach(function (m) {
      if (C.val === 'share_attr') { attributed(m).forEach(function (a) { rows.push({ m: m, cc: a.o.cc, cls: a.o.cl, owner: a.o.n, v: a.v }); }); return; }
      var v = VAL[C.val].v(m); if (v === null || v === undefined) return;
      rows.push({ m: m, cc: m.ctrl_cc, cls: m.ctrl_cls, owner: m.top.n, v: v });
    });
    return rows;
  }
  var AX = { axisLine: { lineStyle: { color: '#26395a' } }, axisLabel: { color: '#9fb0c8', fontSize: 11 }, splitLine: { lineStyle: { color: '#16233a' } }, nameTextStyle: { color: '#9fb0c8' } };
  function grpColor(g, k, i) { var f = g !== 'none' && CAT[g].col; return f ? f(k) : PALETTE[i % PALETTE.length]; }
  function r1(v) { return Math.round(v * 100) / 100; }
  function renderChart() {
    var list = chartMines(), note = [], warn = false, opt;
    var tip = { backgroundColor: 'rgba(8,13,22,.97)', borderColor: '#26395a', textStyle: { color: '#e6eef9', fontSize: 12 } };
    if (C.type === 'scatter') {
      var groups = {}, X = NUM[C.sx], Y = NUM[C.sy], csv = ['mine,' + C.sx + ',' + C.sy + ',group'];
      list.forEach(function (m) {
        var x = X.v(m), y = Y.v(m); if (x === null || y === null || x === undefined || y === undefined) return;
        var g = C.grp === 'none' ? 'All mines' : CAT[C.grp].k({ m: m, cc: m.ctrl_cc, cls: m.ctrl_cls, owner: m.top.n });
        (groups[g] = groups[g] || []).push({ value: [x, y], name: m.name, id: m.id, symbolSize: 6 + Math.sqrt(m.share || 0.5) * 3 });
        csv.push([csvCell(m.name), x, y, csvCell(g)].join(','));
      });
      chartCSV = csv.join('\n');
      var gk = Object.keys(groups);
      var n = gk.reduce(function (a, k) { return a + groups[k].length; }, 0);
      opt = { backgroundColor: 'transparent', tooltip: Object.assign({ formatter: function (p) { return '<b>' + esc(p.data.name) + '</b><br>' + X.l + ': ' + p.data.value[0] + '<br>' + Y.l + ': ' + p.data.value[1]; } }, tip),
        legend: { top: 0, textStyle: { color: '#c9d6ea' }, type: 'scroll' }, grid: { left: 56, right: 24, top: 44, bottom: 50 },
        xAxis: Object.assign({ type: 'value', name: X.l, nameLocation: 'middle', nameGap: 30, scale: true }, AX), yAxis: Object.assign({ type: 'value', name: Y.l, nameLocation: 'middle', nameGap: 40, scale: true }, AX),
        series: gk.map(function (k, i) { return { type: 'scatter', name: C.grp === 'none' ? k : CAT[C.grp].n(k), data: groups[k], itemStyle: { color: grpColor(C.grp, k, i), opacity: 0.85, borderColor: '#070b13' } }; }) };
      $('#cbTitle').textContent = Y.l + ' vs ' + X.l + ' (' + n + ' mines with both values)';
      note.push('Point size follows world share. Mines with n/a on either axis are omitted. US import reliance applies to the mine\'s primary mineral; ">50%" style values have no number and are omitted.');
    } else {
      var rows = chartRows(list), cat = CAT[C.cat], V = VAL[C.val], grp = (C.type === 'pie' || C.type === 'donut' || C.grp === 'none') ? 'none' : C.grp;
      var acc = {}, gset = {};
      rows.forEach(function (r) {
        var k = cat.k(r), g = grp === 'none' ? '_' : CAT[grp].k(r);
        acc[k] = acc[k] || { s: 0, n: 0, g: {} }; acc[k].s += r.v; acc[k].n++;
        acc[k].g[g] = acc[k].g[g] || { s: 0, n: 0 }; acc[k].g[g].s += r.v; acc[k].g[g].n++; gset[g] = (gset[g] || 0) + r.v;
      });
      var val = function (o) { return V.agg === 'mean' ? (o.n ? o.s / o.n : 0) : o.s; };
      var keys = Object.keys(acc).sort(function (a, b) { return val(acc[b]) - val(acc[a]); });
      var total = keys.length; keys = keys.slice(0, C.top);
      var gkeys = Object.keys(gset).sort(function (a, b) { return gset[b] - gset[a]; });
      var csv2 = [csvCell(cat.l) + (grp !== 'none' ? ',' + csvCell(CAT[grp].l) : '') + ',' + csvCell(V.l)];
      keys.forEach(function (k) { if (grp === 'none') csv2.push(csvCell(cat.n(k)) + ',' + r1(val(acc[k]))); else gkeys.forEach(function (g) { if (acc[k].g[g]) csv2.push(csvCell(cat.n(k)) + ',' + csvCell(CAT[grp].n(g)) + ',' + r1(val(acc[k].g[g]))); }); });
      chartCSV = csv2.join('\n');
      $('#cbTitle').textContent = V.l + ' by ' + cat.l + (grp !== 'none' ? ', ' + (C.type === 'treemap' ? 'then ' : 'coloured by ') + CAT[grp].l : '') + (C.min !== 'all' ? ' · ' + ml(C.min) : '') + (C.crit ? ' · US-critical' : '');
      if (total > keys.length) note.push('Showing top ' + keys.length + ' of ' + total + ' categories.');
      if (!rows.length) note.push('No mines match these settings (values may be n/a).');
      if (V.share && C.min === 'all' && C.cat !== 'primary' && grp !== 'primary') { warn = true; note.push('World shares from different minerals are being added together. Pick one mineral (share basis) for a meaningful world-share total.'); }
      if (C.val === 'share_attr') note.push('Each mine\'s share of world output is split across owners by equity %; unpublished stakes split the remainder evenly. Owner HQ country and control type refer to each owner.');
      else if (C.cat === 'ctrl_cc' || C.cat === 'ctrl_cls' || C.cat === 'owner') note.push('Owner fields use the largest known equity holder of each mine.');
      if (C.val === 'nir') note.push('USGS MCS 2026 net import reliance for 2025; values given only as ranges (e.g. ">50%") or as "net exporter" are omitted.');
      var unit = V.share || C.val === 'nir' || C.val === 'top_eq' ? '%' : '';
      var fmt = function (v) { return (Math.round(v * 10) / 10).toLocaleString() + unit; };
      if (C.type === 'pie' || C.type === 'donut') {
        opt = { backgroundColor: 'transparent', tooltip: Object.assign({ trigger: 'item', formatter: function (p) { return '<b>' + esc(p.name) + '</b><br>' + fmt(p.value) + ' (' + p.percent + '%)'; } }, tip),
          legend: { type: 'scroll', orient: 'vertical', right: 0, top: 20, bottom: 20, textStyle: { color: '#c9d6ea' } },
          series: [{ type: 'pie', radius: C.type === 'donut' ? ['42%', '72%'] : ['0%', '72%'], center: ['40%', '52%'], itemStyle: { borderColor: '#0e1520', borderWidth: 2 },
            label: { color: '#c9d6ea', formatter: '{b}\n{d}%' }, data: keys.map(function (k, i) { return { name: cat.n(k), value: r1(val(acc[k])), key: k, itemStyle: { color: cat.col ? cat.col(k) : PALETTE[i % PALETTE.length] } }; }) }] };
      } else if (C.type === 'treemap') {
        opt = { backgroundColor: 'transparent', tooltip: Object.assign({ formatter: function (p) { return '<b>' + esc(p.treePathInfo.slice(1).map(function (x) { return x.name; }).join(' › ')) + '</b><br>' + fmt(p.value); } }, tip),
          series: [{ type: 'treemap', roam: false, nodeClick: false, breadcrumb: { show: false }, width: '100%', height: '92%', top: 8,
            label: { show: true, formatter: '{b}', color: '#fff', fontSize: 12 }, upperLabel: { show: true, height: 22, color: '#fff', fontWeight: 700 },
            levels: [{ itemStyle: { borderColor: '#0e1520', borderWidth: 3, gapWidth: 3 } }, { itemStyle: { borderColor: '#0e1520', borderWidth: 1, gapWidth: 1 }, colorSaturation: [0.35, 0.6] }],
            data: keys.map(function (k, i) {
              var kids = grp === 'none' ? undefined : gkeys.filter(function (g) { return acc[k].g[g]; }).map(function (g, j) { return { name: CAT[grp].n(g), value: r1(val(acc[k].g[g])), itemStyle: { color: grpColor(grp, g, j) } }; });
              return { name: cat.n(k), value: r1(val(acc[k])), key: k, children: kids, itemStyle: { color: cat.col ? cat.col(k) : PALETTE[i % PALETTE.length] } };
            }) }] };
        if (V.agg === 'mean') { warn = true; note.push('Treemaps sum their children; averages are better shown as bars.'); }
      } else {
        var cats = keys.slice().reverse();
        var series = grp === 'none'
          ? [{ type: 'bar', name: V.l, data: cats.map(function (k) { return { value: r1(val(acc[k])), key: k, itemStyle: { color: cat.col ? cat.col(k) : new echarts.graphic.LinearGradient(0, 0, 1, 0, [{ offset: 0, color: '#1b5cff' }, { offset: 1, color: '#3ee6c3' }]) } }; }), barMaxWidth: 26, label: { show: true, position: 'right', color: '#c9d6ea', formatter: function (p) { return fmt(p.value); } } }]
          : gkeys.map(function (g, j) { return { type: 'bar', name: CAT[grp].n(g), stack: C.type === 'stacked' ? 'a' : undefined, barMaxWidth: C.type === 'stacked' ? 26 : 12, itemStyle: { color: grpColor(grp, g, j) }, data: cats.map(function (k) { return { value: acc[k].g[g] ? r1(val(acc[k].g[g])) : 0, key: k }; }) }; });
        if (grp !== 'none' && V.agg === 'mean' && C.type === 'stacked') { warn = true; note.push('Stacking averages is not additive; use grouped bars for averages.'); }
        opt = { backgroundColor: 'transparent', tooltip: Object.assign({ trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: function (v) { return fmt(v); } }, tip),
          legend: grp === 'none' ? undefined : { type: 'scroll', top: 0, textStyle: { color: '#c9d6ea' } },
          grid: { left: 8, right: 60, top: grp === 'none' ? 10 : 40, bottom: 30, containLabel: true },
          xAxis: Object.assign({ type: 'value', name: V.l, nameLocation: 'middle', nameGap: 24 }, AX),
          yAxis: Object.assign({}, AX, { type: 'category', data: cats.map(function (k) { return cat.n(k); }), axisLabel: { color: '#c9d6ea', fontSize: 11.5, width: 170, overflow: 'truncate' } }),
          series: series };
      }
      chart.__keys = keys; chart.__cat = C.cat;
    }
    chart.setOption(opt, true);
    var ne = $('#cbNote'); ne.textContent = note.join(' '); ne.classList.toggle('warn', warn);
  }
  function initCharts() {
    $('#presets').innerHTML = PRESETS.map(function (p) { return '<button data-p="' + p.id + '">' + esc(p.t) + '<small>' + esc(p.s) + '</small></button>'; }).join('');
    $$('#presets button').forEach(function (b) { b.onclick = function () { var p = PRESETS.filter(function (x) { return x.id === b.dataset.p; })[0]; Object.assign(C, p.c, { preset: p.id }); renderControls(); renderChart(); }; });
    chart = echarts.init($('#chart'), null, { renderer: 'canvas' });
    chart.on('click', function (p) {
      if (C.type === 'scatter') { if (p.data && p.data.id !== undefined) selectMine(p.data.id, true); return; }
      var k = p.data && p.data.key !== undefined ? p.data.key : null;
      if (k === null && p.name !== undefined && C.type !== 'treemap') { var i = chart.__keys.map(function (x) { return CAT[C.cat].n(x); }).indexOf(p.name); if (i >= 0) k = chart.__keys[i]; }
      if (k !== null && CAT[C.cat].sel) { CAT[C.cat].sel(k); toast('Cross-filtered: ' + CAT[C.cat].n(k)); }
    });
    renderControls(); renderChart();
    views.push(function () { renderChart(); });
  }

  /* =====================================================================
     DATA TABLE
     ===================================================================== */
  var T = { view: 'own', sort: 'share', dir: -1, q: '' };
  function clsCell(m) { var t = tagFor(m.ctrl_cls); return t ? '<span class="tag ' + t + '">' + esc(CLS[m.ctrl_cls].label) + '</span>' : esc(CLS[m.ctrl_cls].label); }
  var COL = {
    name: { h: 'Mine', v: function (m) { return '<span class="dot" style="background:' + mcol(m.primary) + '"></span><b>' + esc(m.name) + '</b>'; }, s: function (m) { return m.name; } },
    host: { h: 'Host', v: function (m) { return flag(m.host) + ' ' + esc(cname(m.host)); }, s: function (m) { return cname(m.host); } },
    mins: { h: 'Minerals', v: function (m) { return esc([ml(m.primary)].concat(m.secondary.map(ml)).join(', ')); }, s: function (m) { return ml(m.primary); } },
    prim: { h: 'Primary', v: function (m) { return esc(ml(m.primary)); }, s: function (m) { return ml(m.primary); } },
    op: { h: 'Operator', v: function (m) { return esc(m.operator); }, s: function (m) { return m.operator; } },
    owners: { h: 'Owners (equity %)', v: function (m) { return m.owners.map(function (o) { return flag(o.cc) + ' ' + esc(o.n) + (o.pct !== null ? ' <span class="mono">' + o.pct + '%</span>' : ''); }).join('<br>'); }, s: function (m) { return m.top.n; } },
    occ: { h: 'Owner HQ', v: function (m) { return flag(m.ctrl_cc) + ' ' + esc(cname(m.ctrl_cc)); }, s: function (m) { return cname(m.ctrl_cc); } },
    cls: { h: 'Control', v: clsCell, s: function (m) { return CLS_KEYS.indexOf(m.ctrl_cls); } },
    prod: { h: 'Production', v: function (m) { return esc(m.production); }, s: function (m) { return m.production; } },
    year: { h: 'Year', v: function (m) { return esc(m.year || 'n/a'); }, s: function (m) { return m.year || ''; } },
    share: { h: 'World share', num: true, v: function (m) { return fmtShare(m.share); }, s: function (m) { return m.share === null ? -1 : m.share; } },
    status: { h: 'Status', v: function (m) { return esc(m.status); }, s: function (m) { return m.status; } },
    src: { h: 'Sources', v: function (m) { return m.src.map(function (s) { return SRC[s] ? '<a href="' + esc(SRC[s].u) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">' + esc(SRC[s].t.split(' – ')[0].split(' (')[0]) + '</a>' : esc(s); }).join('; '); }, s: function (m) { return m.src.join(); } },
    crit: { h: '2025 critical', v: function (m) { var c = MIN[m.primary] && MIN[m.primary].crit; return c === undefined ? 'n/a' : c ? '<span class="tag warn">Yes</span>' : 'No'; }, s: function (m) { return MIN[m.primary] && MIN[m.primary].crit ? 1 : 0; } },
    nir: { h: 'US net import reliance', v: function (m) { return esc((MIN[m.primary] && MIN[m.primary].nir) || 'n/a'); }, s: function (m) { var n = MIN[m.primary] && MIN[m.primary].nirN; return n === null || n === undefined ? -1 : n; } },
    nds: { h: 'Defense stockpile (NDS)', v: function (m) { return esc((MIN[m.primary] && MIN[m.primary].nds) || 'n/a'); }, s: function (m) { return (MIN[m.primary] && MIN[m.primary].nds) || ''; } },
    lat: { h: 'Lat', num: true, v: function (m) { return '<span class="mono">' + m.lat.toFixed(4) + '</span>'; }, s: function (m) { return m.lat; } },
    lon: { h: 'Lon', num: true, v: function (m) { return '<span class="mono">' + m.lon.toFixed(4) + '</span>'; }, s: function (m) { return m.lon; } },
    mgrs: { h: 'MGRS', v: function (m) { return '<span class="mono">' + esc(m.mgrs) + '</span>'; }, s: function (m) { return m.mgrs; } },
    prec: { h: 'Coord. precision', v: function (m) { return '<span class="tag ' + (m.prec === 'S' || m.prec === 'W' ? 'ok' : 'warn') + '">' + m.prec + '</span> ' + esc(PREC[m.prec].label); }, s: function (m) { return 'SWDA'.indexOf(m.prec); } },
    ce: { h: 'CE (km)', num: true, v: function (m) { return PREC[m.prec].ce_m / 1000; }, s: function (m) { return PREC[m.prec].ce_m; } },
    csrc: { h: 'Coord. source', v: function (m) { return m.coord_src.charAt(0) === 'Q' ? '<a href="https://www.wikidata.org/wiki/' + esc(m.coord_src) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">' + esc(srcLabel(m.coord_src)) + '</a>' : esc(srcLabel(m.coord_src)); }, s: function (m) { return m.coord_src; } }
  };
  var TV = { own: ['name', 'host', 'mins', 'op', 'owners', 'occ', 'cls'], prod: ['name', 'prim', 'prod', 'year', 'share', 'status', 'src'], us: ['name', 'prim', 'crit', 'nir', 'nds', 'occ', 'cls'], geo: ['name', 'host', 'lat', 'lon', 'mgrs', 'prec', 'ce', 'csrc'] };
  function tableMines() {
    var q = norm(T.q.trim());
    var list = viewMines().filter(function (m) { return !q || norm([m.name, m.operator, ownersTxt(m), cname(m.host), ml(m.primary), m.secondary.map(ml).join(' '), m.status, m.mgrs].join(' ')).indexOf(q) >= 0; });
    var c = COL[T.sort] || COL.share;
    return list.slice().sort(function (a, b) { var x = c.s(a), y = c.s(b); return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * T.dir; });
  }
  function renderTable() {
    var cols = TV[T.view], list = tableMines(), selId = S.sel && S.sel.kind === 'mine' ? S.sel.key : null;
    $('#table thead').innerHTML = '<tr>' + cols.map(function (k) { return '<th data-k="' + k + '" class="' + (T.sort === k ? (T.dir > 0 ? 's-asc' : 's-desc') : '') + '">' + esc(COL[k].h) + '</th>'; }).join('') + '</tr>';
    $('#table tbody').innerHTML = list.map(function (m) { return '<tr data-id="' + m.id + '" class="' + (m.id === selId ? 'sel' : '') + '">' + cols.map(function (k) { return '<td' + (COL[k].num ? ' class="num"' : '') + '>' + COL[k].v(m) + '</td>'; }).join('') + '</tr>'; }).join('') || '<tr><td colspan="' + cols.length + '">No mines match.</td></tr>';
    $('#tCount').textContent = list.length + ' mines' + (list.length !== MINES.length ? ' (of ' + MINES.length + ')' : '');
    $$('#table th').forEach(function (th) { th.onclick = function () { var k = th.dataset.k; if (T.sort === k) T.dir = -T.dir; else { T.sort = k; T.dir = COL[k].num || k === 'share' ? -1 : 1; } renderTable(); }; });
    $$('#table tbody tr[data-id]').forEach(function (tr) { tr.onclick = function () { selectMine(+tr.dataset.id, true); document.getElementById('map').scrollIntoView({ behavior: 'smooth' }); }; });
  }
  function initTable() {
    $('#tSearch').addEventListener('input', function (e) { T.q = e.target.value; renderTable(); });
    $$('#tView button').forEach(function (b) { b.onclick = function () { T.view = b.dataset.v; $$('#tView button').forEach(function (x) { x.classList.toggle('on', x === b); }); renderTable(); }; });
    $('#tGeo').onclick = function () { download('millenniumki_mines_filtered.geojson', toGeoJSON(tableMines()), 'application/geo+json'); };
    $('#tCsv').onclick = function () { download('millenniumki_mines_filtered.csv', toCSV(tableMines()), 'text/csv'); };
    renderTable(); views.push(renderTable);
    // US criticality reference
    var used = Object.keys(MIN).filter(function (c) { return MINES.some(function (m) { return m.primary === c; }); });
    $('#usTable').innerHTML = '<thead><tr><th>Mineral</th><th>2025 critical list</th><th>US net import reliance</th><th>National Defense Stockpile</th><th>Mines tracked</th></tr></thead><tbody>' +
      used.map(function (c) { return '<tr><td><span class="dot" style="background:' + mcol(c) + '"></span>' + esc(MIN[c].l) + '</td><td>' + (MIN[c].crit ? 'Yes' : 'No') + '</td><td>' + esc(MIN[c].nir) + '</td><td>' + esc(MIN[c].nds) + '</td><td class="num">' + MINES.filter(function (m) { return m.primary === c; }).length + '</td></tr>'; }).join('') + '</tbody>';
    $$('#usTable tbody tr').forEach(function (tr, i) { tr.onclick = function () { setSel({ kind: 'mineral', key: used[i] }, { fit: true }); toast('Selected ' + ml(used[i])); }; });
    // precision summary
    var cnt = {}; MINES.forEach(function (m) { cnt[m.prec] = (cnt[m.prec] || 0) + 1; });
    $('#precText').textContent = (cnt.S + cnt.W) + ' of ' + MINES.length + ' coordinates are sourced or verified: ' + cnt.S + ' were confirmed on Esri World Imagery chips (zoom 11 to 13) on a visible pit, plant, pond field or wellfield and nudged onto it; ' + cnt.W + ' keep a Wikidata or Wikipedia reference point where the operation is underground or obscured. ' + cnt.D + ' multi-site entries use a district centroid and ' + cnt.A + ' could not be confirmed and stay approximate.';
    $('#precTable').innerHTML = '<thead><tr><th>Class</th><th>Meaning</th><th>CE (indicative)</th><th>Mines</th></tr></thead><tbody>' + ['S', 'W', 'D', 'A'].map(function (k) { return '<tr><td><b>' + k + '</b></td><td>' + esc(PREC[k].label) + '</td><td>≈ ' + PREC[k].ce_m / 1000 + ' km</td><td class="num">' + (cnt[k] || 0) + '</td></tr>'; }).join('') + '</tbody>';
  }
  function initSources() {
    var extra = [
      ['USGS Mineral Commodity Summaries 2026 (net import reliance, world production, stockpile)', 'https://pubs.usgs.gov/periodicals/mcs2026/mcs2026.pdf'],
      ['Final 2025 List of Critical Minerals (Federal Register, 7 Nov 2025)', 'https://www.federalregister.gov/documents/2025/11/07/2025-19813/final-2025-list-of-critical-minerals'],
      ['Proposed FY2026 Annual Materials Plan, National Defense Stockpile', 'https://www.federalregister.gov/documents/2024/08/29/2024-19422/request-for-public-comments-on-the-potential-market-impact-of-the-proposed-fiscal-year-2026-annual'],
      ['DLA Strategic Materials reports', 'https://www.dla.mil/Strategic-Materials/Reports/'],
      ['Esri World Imagery (basemap and coordinate verification)', 'https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9'],
      ['Esri World Topographic Map (basemap)', 'https://www.arcgis.com/home/item.html?id=7dc6cea0b1764a1f9af2e679f642f0f5'],
      ['CARTO Dark Matter basemap (OpenStreetMap data)', 'https://carto.com/basemaps'],
      ['Tilezen Terrarium elevation tiles on AWS (hillshade, 3D terrain)', 'https://registry.opendata.aws/terrain-tiles/'],
      ['Wikidata coordinate location (P625) for mine items', 'https://www.wikidata.org/wiki/Property:P625'],
      ['Natural Earth 1:110m Admin 0 countries', 'https://www.naturalearthdata.com/downloads/110m-cultural-vectors/'],
      ['MapLibre GL JS 5.15.0 (BSD-3-Clause)', 'https://maplibre.org/'],
      ['Apache ECharts 5.6.0 (Apache-2.0)', 'https://echarts.apache.org/']
    ];
    var list = extra.concat(Object.keys(SRC).filter(function (k) { return SRC[k].u.indexOf('mcs2026') < 0; }).map(function (k) { return [SRC[k].t, SRC[k].u]; }));
    $('#srcList').innerHTML = list.map(function (s) { return '<a class="src" href="' + esc(s[1]) + '" target="_blank" rel="noopener">' + esc(s[0]) + '<small>' + esc(s[1].split('/')[2].replace('www.', '')) + '</small></a>'; }).join('');
  }


  /* =====================================================================
     INTEL FEED, PULSES, PRICES, REFRESH FOOTER (data from scripts/pipeline.py)
     ===================================================================== */
  var UPD = (D.updates && D.updates.items) || [], REV = (D.review && D.review.items) || [], PRICES = (D.prices && D.prices.series) || [];
  var ALERT_CATS = { nationalization: 'Nationalisation', sanctions: 'Sanctions', suspension: 'Suspension / disruption', ownership: 'Ownership change', filing: 'SEC filing' };
  var CAT_RANK = { nationalization: 0, sanctions: 1, suspension: 2, ownership: 3, filing: 9 };
  var I = { days: 30, cat: 'all', scope: false };
  var pulseMarkers = [];
  function ageDays(it) { var t = Date.parse(it.date || ''); return isNaN(t) ? 9999 : (Date.now() - t) / 864e5; }
  function fmtDate(s) { var t = Date.parse(s || ''); if (isNaN(t)) return 'n/a'; return new Date(t).toISOString().slice(0, 10); }
  function fmtStamp(s) { var t = Date.parse(s || ''); if (isNaN(t)) return 'never'; return new Date(t).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'; }
  function recentAlerts(days) { return UPD.filter(function (it) { return it.category !== 'filing' && ageDays(it) <= days; }); }
  function renderPulses() {
    pulseMarkers.forEach(function (mk) { mk.remove(); }); pulseMarkers = [];
    if (!map || !L.pulse) return;
    var inView = new Set(viewMines().map(function (m) { return m.id; })), best = {};
    recentAlerts(30).forEach(function (it) { (it.mines || []).forEach(function (id) { if (inView.has(id) && (!best[id] || CAT_RANK[it.category] < CAT_RANK[best[id].category])) best[id] = it; }); });
    Object.keys(best).forEach(function (id) {
      var m = MINES[+id], it = best[id], el = document.createElement('div');
      el.className = 'pulse c-' + it.category; el.title = m.name + ': ' + (ALERT_CATS[it.category] || it.category) + ' alert';
      el.addEventListener('click', function (e) { e.stopPropagation(); selectMine(m.id, true); });
      pulseMarkers.push(new maplibregl.Marker({ element: el }).setLngLat([m.lon, m.lat]).addTo(map));
    });
  }
  function intelForMine(id) {
    var its = UPD.filter(function (it) { return (it.mines || []).indexOf(id) >= 0; }).slice(0, 6);
    if (!its.length) return '<div class="d-sec"><h4>Recent intel</h4><div class="d-intel"><small>No automated alerts or filings for this mine in the retained window.</small></div></div>';
    return '<div class="d-sec"><h4>Recent intel (automated, unverified)</h4><div class="d-intel">' + its.map(function (it) {
      return '<div><span class="cat cat-' + esc(it.category) + '">' + esc(ALERT_CATS[it.category] || it.category) + '</span> <a href="' + esc(it.url) + '" target="_blank" rel="noopener">' + esc(it.title) + '</a><small> · ' + esc(it.source || '') + ' · ' + fmtDate(it.date) + '</small></div>'; }).join('') + '</div></div>';
  }
  function intelItems() {
    var view = viewMines(), ids = new Set(view.map(function (m) { return m.id; })), own = new Set();
    view.forEach(function (m) { m.owners.forEach(function (o) { own.add(o.n); }); });
    var anyFilter = I.scope && (S.min !== 'all' || S.occ !== 'all' || S.cls !== 'all' || S.crit || narrowing());
    return UPD.filter(function (it) {
      if (ageDays(it) > I.days) return false;
      if (I.cat !== 'all' && it.category !== I.cat) return false;
      if (anyFilter && !(it.mines || []).some(function (x) { return ids.has(x); }) && !(it.owners || []).some(function (o) { return own.has(o); })) return false;
      return true;
    });
  }
  function renderIntel() {
    var all = UPD.filter(function (it) { return ageDays(it) <= I.days; }), cnt = {};
    all.forEach(function (it) { cnt[it.category] = (cnt[it.category] || 0) + 1; });
    $('#iCats').innerHTML = [['all', 'All']].concat(Object.keys(ALERT_CATS).map(function (k) { return [k, ALERT_CATS[k]]; })).map(function (c) {
      return '<button class="chip' + (I.cat === c[0] ? ' on' : '') + '" data-c="' + c[0] + '">' + esc(c[1]) + '<i>' + (c[0] === 'all' ? all.length : (cnt[c[0]] || 0)) + '</i></button>'; }).join('');
    $$('#iCats .chip').forEach(function (b) { b.onclick = function () { I.cat = b.dataset.c; renderIntel(); }; });
    var its = intelItems().slice(0, 250);
    if (!UPD.length) $('#iList').innerHTML = '<div class="iempty">No feed items yet. The daily refresh (scripts/pipeline.py) has not produced any alerts, or the feeds have not run.</div>';
    else if (!its.length) $('#iList').innerHTML = '<div class="iempty">No items match these settings in the last ' + I.days + ' days.</div>';
    else $('#iList').innerHTML = its.map(function (it) {
      var ms = (it.mines || []).slice(0, 8).map(function (id) { return MINES[id] ? '<button class="mchip" data-m="' + id + '">📍 ' + esc(MINES[id].name) + '</button>' : ''; }).join('');
      if ((it.mines || []).length > 8) ms += '<span>+' + (it.mines.length - 8) + ' more</span>';
      var os = (it.owners || []).slice(0, 4).map(function (o) { return '<button class="ochip" data-o="' + esc(o) + '">' + esc(o) + '</button>'; }).join('');
      return '<div class="iitem"><span class="idate">' + fmtDate(it.date) + '</span><div><a class="it" href="' + esc(it.url) + '" target="_blank" rel="noopener">' + esc(it.title) + '</a></div>' +
        '<div class="imeta"><span class="cat cat-' + esc(it.category) + '">' + esc(ALERT_CATS[it.category] || it.category) + '</span><span>' + esc(it.source || '') + ' · via ' + esc(it.feed) + '</span>' + ms + os + '</div></div>'; }).join('');
    $$('#iList .mchip').forEach(function (b) { b.onclick = function () { selectMine(+b.dataset.m, true); document.getElementById('map').scrollIntoView({ behavior: 'smooth' }); }; });
    $$('#iList .ochip').forEach(function (b) { b.onclick = function () { setSel({ kind: 'owner', key: b.dataset.o }, { fit: true, keep: true }); toast('Selected owner: ' + b.dataset.o); }; });
    var open = REV.filter(function (r) { return r.status !== 'resolved'; });
    $('#rCount').textContent = open.length;
    $('#rList').innerHTML = open.length ? open.slice(0, 40).map(function (r) {
      return '<div class="ritem"><a href="' + esc(r.url || '#') + '" target="_blank" rel="noopener">' + esc(r.title) + '</a><small>' + esc(r.detail || '') + ' · ' + fmtDate(r.created) + '</small></div>'; }).join('')
      : '<div class="small">Nothing awaiting review. New annual reports, Wikidata changes and new USGS editions appear here; curated figures are only changed by an analyst.</div>';
    var F = (META.feeds) || {};
    var keys = Object.keys(F);
    $('#fStatus').innerHTML = keys.length ? keys.map(function (k) {
      var f = F[k], st = f.status || 'never';
      return '<span><b>' + esc(f.label || k) + '</b> <span style="color:var(--tx3)">(' + esc(f.cadence || '') + ')</span></span><span class="st st-' + esc(st) + '">' + esc(st.replace('_', ' ')) + '</span>' +
        '<small>Last success: ' + fmtStamp(f.last_success) + (f.items !== undefined && (f.status === 'ok' || f.status === 'partial') ? ' · ' + f.items + ' items' : '') + (f.status !== 'ok' && f.message ? ' · ' + esc(f.message) : '') + '</small>'; }).join('')
      : '<div class="small">Feed status is not available yet.</div>';
  }
  function spark(hist) {
    if (!hist || hist.length < 2) return '';
    var v = hist.map(function (h) { return h.v; }), mn = Math.min.apply(null, v), mx = Math.max.apply(null, v), w = 120, h = 22;
    var pts = v.map(function (x, i) { return (i / (v.length - 1) * w).toFixed(1) + ',' + (h - (mx === mn ? h / 2 : (x - mn) / (mx - mn) * h)).toFixed(1); }).join(' ');
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"><polyline points="' + pts + '" fill="none" stroke="#3ee6c3" stroke-width="1.4"/></svg>';
  }
  function renderPrices() {
    var el = $('#prices'); if (!el) return;
    if (!PRICES.length) { el.innerHTML = '<div class="pempty">Commodity prices: not yet refreshed (monthly World Bank Pink Sheet / FRED feed).</div>'; return; }
    var seen = {}, list = PRICES.filter(function (p) { var k = p.label; if (seen[k]) return false; seen[k] = 1; return true; });
    el.innerHTML = list.map(function (p) {
      var ch = p.mom_pct, cls = ch === null || ch === undefined ? '' : ch >= 0 ? 'up' : 'dn';
      var val = p.value >= 1000 ? Math.round(p.value).toLocaleString() : p.value >= 10 ? p.value.toFixed(1) : p.value.toFixed(2);
      return '<a class="price" href="' + esc(p.url) + '" target="_blank" rel="noopener" title="' + esc(p.series + ' · ' + p.source) + '"><span class="pl"><span>' + esc(p.label) + '</span><span class="' + cls + '">' + (ch === null || ch === undefined ? '' : (ch >= 0 ? '▲' : '▼') + Math.abs(ch).toFixed(1) + '%') + '</span></span><b>' + val + '</b><small>' + esc(p.unit) + ' · ' + esc(p.period) + ' · ' + esc(p.source) + '</small>' + spark(p.history) + '</a>'; }).join('');
  }
  function renderRefresh() {
    var F = META.feeds || {}, parts = Object.keys(F).filter(function (k) { return F[k].last_success; }).map(function (k) { return (F[k].label || k).split(' ')[0] + ' ' + fmtStamp(F[k].last_success).slice(0, 10); });
    $('#refreshLine').textContent = 'Data last refreshed: ' + (META.last_refresh ? fmtStamp(META.last_refresh) : 'not yet (curated baseline only)') + ' · site data built ' + fmtStamp(META.built_at) + (parts.length ? ' · ' + parts.join(' · ') : '') + ' · tiles: ' + (window.__qxTiles || 'Esri');
  }
  function initIntel() {
    $$('#iWin button').forEach(function (b) { b.onclick = function () { I.days = +b.dataset.d; $$('#iWin button').forEach(function (x) { x.classList.toggle('on', x === b); }); renderIntel(); }; });
    $('#iScope').onchange = function (e) { I.scope = e.target.checked; renderIntel(); };
    renderPrices(); renderIntel(); renderRefresh();
    views.push(function () { renderIntel(); });
  }

  /* ---------- nav & boot ---------- */
  function initNav() {
    $('#navToggle').onclick = function () { var n = $('#nav'); n.classList.toggle('open'); this.setAttribute('aria-expanded', n.classList.contains('open')); };
    $$('#nav a').forEach(function (a) { a.addEventListener('click', function () { $('#nav').classList.remove('open'); }); });
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) $$('#nav a').forEach(function (a) { a.classList.toggle('on', a.getAttribute('href') === '#' + e.target.id); }); }); }, { rootMargin: '-40% 0px -55% 0px' });
      ['map', 'intel', 'network', 'charts', 'data', 'findings', 'method', 'sources', 'about'].forEach(function (id) { io.observe(document.getElementById(id)); });
    }
    window.addEventListener('resize', function () { if (graph) graph.resize(); if (chart) chart.resize(); });
  }
  function boot() {
    initFilters(); renderKPIs(); initNav(); initSources();
    try { initMap(); } catch (e) { console.error('map init', e); }
    try { initGraph(); } catch (e) { console.error('graph init', e); }
    try { initCharts(); } catch (e) { console.error('chart init', e); }
    initTable();
    try { initIntel(); } catch (e) { console.error('intel init', e); }
    update();
    window.QXApp = { S: S, setSel: setSel, selectMine: selectMine, zoomToPit: zoomToPit, update: update, setBase: function (b) { base = b; applyLayers(); }, L: L, applyLayers: applyLayers, C: C, renderControls: renderControls, renderChart: renderChart };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
