/* Millennium KI: Supply Flow view. Layered entity diagram: mines -> mineral -> compounds -> typical end uses.
   Facility nodes and shares come from the atlas data (window.QX); the downstream chain is an illustrative lookup only. */
(function () {
  'use strict';
  var D = window.QX; if (!D) return;
  var MINES = D.mines, MIN = D.minerals, CTRY = D.countries;
  var NS = 'http://www.w3.org/2000/svg';
  function $(s) { return document.querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function cname(cc) { return (CTRY[cc] && CTRY[cc].name) || cc; }
  function ml(c) { return (MIN[c] && MIN[c].l) || c; }

  /* simple 24x24 icon paths (stroke only) */
  var IC = {
    chip: '<rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"/>',
    radar: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 12l6-6"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    fiber: '<path d="M3 8c5-4 6 4 11 0s5 0 7-1M3 13c5-4 6 4 11 0s5 0 7-1M3 18c5-4 6 4 11 0s5 0 7-1"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
    battery: '<rect x="3" y="8" width="16" height="9" rx="1.5"/><path d="M21 11v3M8 11v3M12 11v3"/>',
    missile: '<path d="M4 20l5-5M9 15l-2-2 7-8c2-2 5-2 6-2 0 1 0 4-2 6l-8 7z"/><circle cx="15" cy="9" r="1.4"/>',
    bolt: '<path d="M13 2L5 14h6l-1 8 8-12h-6z"/>',
    gear: '<circle cx="12" cy="12" r="3.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
    flask: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/>',
    plane: '<path d="M21 4L3 11l6 2 2 6 3-4 5 3z"/>',
    atom: '<ellipse cx="12" cy="12" rx="9" ry="3.6"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(120 12 12)"/>',
    ship: '<path d="M3 16l2 4h14l2-4zM7 16V9h10v7M12 9V4"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    wrench: '<path d="M14 6a4 4 0 0 0 5 5l-8 8a2.2 2.2 0 0 1-3-3l8-8a4 4 0 0 0-2-2z"/>',
    bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10c1 1 1 2 1 3h6c0-1 0-2 1-3a6 6 0 0 0-4-10z"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5"/>',
    car: '<path d="M4 15v-3l2-5h12l2 5v3zM4 15v3M20 15v3"/><circle cx="8" cy="15" r="1.2"/><circle cx="16" cy="15" r="1.2"/>'
  };
  function ico(k, size, x, y, col) { return '<g transform="translate(' + x + ' ' + y + ') scale(' + (size / 24) + ')" fill="none" stroke="' + (col || '#fff') + '" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + (IC[k] || IC.layers) + '</g>'; }

  /* Illustrative downstream lookup: [compound, icon, [[use, icon], ...]]. General USGS / DoD use categories only. */
  var DS = {
    Ga: ['Gallium – Metal', [['Gallium arsenide (GaAs)', [['MMIC / radar', 'radar'], ['Night-vision & IR sensors', 'eye'], ['Space & high-efficiency solar cells', 'sun']]],
      ['Gallium nitride (GaN)', [['RF amplifiers / electronic warfare', 'radar'], ['Power electronics & fast chargers', 'bolt']]],
      ['Laser diodes / VCSEL', [['LiDAR & rangefinders', 'radar'], ['Fiber-optic communications', 'fiber']]]]],
    Ge: ['Germanium – Metal', [['Germanium dioxide (GeO2)', [['Fiber-optic cable', 'fiber'], ['PET plastics catalyst', 'flask']]],
      ['Germanium tetrachloride (GeCl4)', [['Fiber-optic cable', 'fiber']]],
      ['Optical blanks, lenses & windows', [['Thermal imaging / night vision', 'eye'], ['Infrared targeting optics', 'shield']]],
      ['Germanium substrates / SiGe', [['Space solar cells', 'sun'], ['Radiation-hardened electronics', 'chip']]]]],
    Cu: ['Copper – Metal', [['Wire, cable & busbar', [['Power grid & EV motors', 'bolt'], ['Electronics & circuit boards', 'chip']]],
      ['Brass & bronze', [['Ammunition casings', 'missile'], ['Plumbing & fittings', 'wrench']]],
      ['Copper-nickel alloys', [['Naval vessels & desalination', 'ship']]]]],
    Co: ['Cobalt – Metal', [['Superalloys', [['Jet engines & turbines', 'plane']]], ['Battery cathodes (NMC / LCO)', [['EV & grid batteries', 'battery'], ['Portable military electronics', 'battery']]],
      ['Samarium-cobalt magnets', [['Precision guidance & actuators', 'missile']]]]],
    Li: ['Lithium – Carbonate / Hydroxide', [['Battery cathode materials', [['EV & grid batteries', 'battery'], ['Drones & soldier-worn power', 'plane']]],
      ['Lithium metal / primary cells', [['Missile & sonobuoy batteries', 'missile']]], ['Glass, ceramics & greases', [['Industrial products', 'gear']]]]],
    Ni: ['Nickel – Metal', [['Stainless & alloy steel', [['Industrial & naval structures', 'ship']]], ['Nickel superalloys', [['Jet engines & turbines', 'plane']]],
      ['Battery precursors (NMC)', [['EV & grid batteries', 'battery']]]]],
    Zn: ['Zinc – Metal', [['Galvanizing', [['Steel infrastructure & vehicles', 'car']]], ['Brass', [['Ammunition casings', 'missile']]], ['Zinc oxide & chemicals', [['Rubber, ceramics & batteries', 'flask']]]]],
    REE: ['Rare earths – Oxides', [['NdPr oxide → NdFeB magnets', [['EV & wind-turbine motors', 'bolt'], ['Actuators & guidance systems', 'missile']]],
      ['Samarium oxide → SmCo magnets', [['High-temperature guidance motors', 'missile']]], ['Yttrium & europium compounds', [['Thermal barrier coatings', 'plane'], ['Phosphors & displays', 'eye']]]]],
    U: ['Uranium – U3O8', [['Enriched uranium (LEU / HALEU)', [['Civil nuclear power', 'atom'], ['Naval reactors', 'ship']]], ['Depleted uranium', [['Kinetic penetrators & armor', 'shield']]]]],
    W: ['Tungsten – Concentrate', [['Tungsten carbide', [['Cutting & drilling tools', 'wrench']]], ['Tungsten heavy alloy', [['Penetrators & munitions', 'missile']]], ['Tungsten wire & powder', [['Electronics & lighting', 'bulb']]]]],
    Sb: ['Antimony – Metal', [['Antimony trioxide', [['Flame retardants', 'flask']]], ['Lead-antimony alloy', [['Lead-acid batteries', 'battery']]], ['Antimony compounds', [['Ammunition primers & tracers', 'missile']]]]],
    C: ['Graphite – Natural', [['Battery-grade anode material', [['EV & grid batteries', 'battery']]], ['Refractories & electrodes', [['Steel & foundry industry', 'gear']]], ['Isostatic / nuclear graphite', [['Aerospace & reactors', 'atom']]]]],
    Nb: ['Niobium – Ferroniobium / Oxide', [['Ferroniobium', [['High-strength steel pipelines & vehicles', 'car']]], ['Niobium alloys (e.g. C-103)', [['Rocket nozzles & hypersonics', 'missile']]], ['Niobium-titanium', [['Superconducting magnets', 'bolt']]]]],
    Ta: ['Tantalum – Concentrate', [['Tantalum capacitors', [['Avionics & electronics', 'chip']]], ['Tantalum alloys', [['Jet engines & penetrators', 'plane']]], ['Sputtering targets', [['Semiconductors', 'chip']]]]],
    Ti: ['Titanium – Sponge / Feedstock', [['Titanium alloys', [['Airframes & jet engines', 'plane'], ['Naval & armor components', 'ship']]], ['Titanium dioxide', [['Pigments & coatings', 'flask']]]]],
    PGM: ['PGMs – Platinum / Palladium', [['Catalysts', [['Vehicle emissions control', 'car'], ['Chemicals & refining', 'flask']]], ['Electrochemical cells', [['Fuel cells & electrolyzers', 'bolt']]]]],
    Mn: ['Manganese – Ore / Alloy', [['Ferromanganese', [['Steelmaking', 'gear']]], ['Electrolytic manganese / sulfate', [['EV battery cathodes', 'battery']]]]],
    Al: ['Aluminum – Metal', [['Aluminum alloys', [['Aircraft & armored vehicles', 'plane']]], ['Aluminum powder', [['Rocket propellant & munitions', 'missile']]], ['Alumina', [['Abrasives & ceramics', 'gear']]]]],
    Mo: ['Molybdenum – Concentrate', [['Ferromolybdenum', [['Alloy & stainless steel', 'gear']]], ['Molybdenum disulfide', [['Lubricants', 'flask']]], ['Molybdenum alloys', [['High-temperature hardware', 'plane']]]]],
    V: ['Vanadium – Pentoxide', [['Ferrovanadium', [['High-strength steel', 'gear']]], ['Vanadium electrolyte', [['Flow batteries', 'battery']]], ['Titanium-vanadium alloys', [['Airframes', 'plane']]]]],
    Sn: ['Tin – Metal', [['Solder', [['Electronics assembly', 'chip']]], ['Tin plate & chemicals', [['Packaging & coatings', 'layers']]], ['Bronze & alloys', [['Bearings & hardware', 'wrench']]]]],
    Pb: ['Lead – Metal', [['Lead-acid batteries', [['Vehicle & backup power', 'battery']]], ['Lead alloys', [['Ammunition & radiation shielding', 'shield']]]]],
    Zr: ['Zirconium – Zircon / Metal', [['Zircaloy', [['Nuclear fuel cladding', 'atom']]], ['Zirconia ceramics', [['Refractories & thermal coatings', 'plane']]]]],
    Cr: ['Chromium – Ferrochrome', [['Ferrochrome', [['Stainless steel', 'gear']]], ['Chromium superalloys', [['Jet engines', 'plane']]]]],
    Re: ['Rhenium – Metal', [['Rhenium superalloys', [['Jet-engine turbine blades', 'plane']]], ['Platinum-rhenium catalysts', [['Petroleum refining', 'flask']]]]],
    In: ['Indium – Metal', [['Indium tin oxide', [['Displays & touchscreens', 'eye']]], ['Indium phosphide / antimonide', [['Fiber-optic & IR detectors', 'fiber']]]]],
    Ag: ['Silver – Metal', [['Silver paste & contacts', [['Solar cells', 'sun'], ['Electronics', 'chip']]]]],
    Au: ['Gold – Metal', [['Gold plating & bonding wire', [['Electronics & aerospace', 'chip']]]]],
    Bi: ['Bismuth – Metal', [['Bismuth alloys & compounds', [['Fusible alloys & pharmaceuticals', 'flask']]]]],
    Fe: ['Iron ore – Pellets / Fines', [['Pig iron / DRI', [['Steel for vehicles, ships & infrastructure', 'ship']]]]],
    K: ['Potash – KCl', [['Fertilizer', [['Agriculture', 'layers']]]]],
    P: ['Phosphate rock', [['Phosphoric acid', [['Fertilizer', 'layers'], ['LFP battery cathodes', 'battery']]]]]
  };

  var state = { min: 'Ge', expand: false };
  var MAXN = 12, W = 1240;

  function facilitiesFor(k) {
    var list = MINES.filter(function (m) { return m.primary === k || (m.secondary || []).indexOf(k) >= 0; }).map(function (m) {
      return { m: m, share: (m.share_unit === k && m.share != null) ? m.share : null, by: m.primary !== k, cc: m.ctrl_cc || (m.owners[0] && m.owners[0].cc) };
    });
    list.sort(function (a, b) { return (b.share == null ? -1 : b.share) - (a.share == null ? -1 : a.share) || a.m.name.localeCompare(b.m.name); });
    return list;
  }
  function wrap(t, n) { var w = String(t).split(' '), L = [], c = ''; w.forEach(function (x) { if ((c + ' ' + x).trim().length > n && c) { L.push(c); c = x; } else c = (c + ' ' + x).trim(); }); if (c) L.push(c); return L.slice(0, 3); }
  function trunc(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function label(x, y, text, n, cls) { var L = wrap(text, n); return '<text class="' + (cls || 'fl-lbl') + '" x="' + x + '" y="' + y + '" text-anchor="middle">' + L.map(function (l, i) { return '<tspan x="' + x + '" dy="' + (i ? 12.5 : 0) + '">' + esc(l) + '</tspan>'; }).join('') + '</text>'; }
  function pill(x, y, t, cls) { var w = t.length * 5.6 + 12; return '<g class="fl-pill ' + (cls || '') + '"><rect x="' + (x - w / 2) + '" y="' + (y - 8) + '" width="' + w + '" height="16" rx="8"/><text x="' + x + '" y="' + (y + 3.6) + '" text-anchor="middle">' + esc(t) + '</text></g>'; }
  function line(x1, y1, x2, y2, cls, w, marker) { return '<line class="' + cls + '" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke-width="' + w + '" marker-end="url(#' + marker + ')"/>'; }
  function tile(cx, cy, s, fill, icon) { return '<rect x="' + (cx - s / 2) + '" y="' + (cy - s / 2) + '" width="' + s + '" height="' + s + '" rx="' + Math.round(s * 0.18) + '" fill="' + fill + '"/>' + ico(icon, s * 0.6, cx - s * 0.3, cy - s * 0.3); }

  function render() {
    var k = state.min, ds = DS[k], facs = facilitiesFor(k), body = $('#flowBody'), note = $('#flowNote');
    var shown = state.expand ? facs : facs.slice(0, MAXN), more = facs.length - shown.length;
    var rows = shown.length + (more > 0 ? 1 : 0), STEP = 64, FY0 = 400;
    var facH = rows * STEP, chain = ds ? ds[1] : [];
    var minY = Math.max(FY0 + 20, FY0 + facH / 2), H = Math.max(minY + 90, FY0 + facH + 24), MX = 700;
    if (!ds) { minY = 160; H = Math.max(260, rows * STEP + 40); }
    var svg = ['<defs><marker id="arG" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="13" markerHeight="13" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#1f9d5c"/></marker><marker id="arX" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="11" markerHeight="11" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#7d8797"/></marker></defs>'];
    var edgesG = [], nodes = [];
    var maxShare = Math.max.apply(null, facs.map(function (f) { return f.share || 0; }).concat([1]));
    var y0 = ds ? minY : 160, ty = y0;
    if (!ds) { FY0 = 30; }
    var fy0 = ds ? FY0 : 30, fyMid = ds ? fy0 + facH / 2 : fy0 + facH / 2;
    if (ds) ty = Math.max(minY, fyMid);
    /* facilities */
    var xr = 24 + 262;
    shown.forEach(function (f, i) {
      var cy = fy0 + i * STEP + 28, w = f.share != null ? 1.8 + 4.2 * (f.share / maxShare) : 2;
      var tx = MX - 32, ang = Math.atan2(ty - cy, tx - xr), ex = tx - 6, ey = ty + (cy - ty) * 0.0;
      var lx = xr + (tx - xr) * 0.42, ly = cy + (ty - cy) * 0.42;
      edgesG.push(line(xr, cy, tx, ty, 'fl-eg', w.toFixed(1), 'arG'));
      edgesG.push(pill(lx, ly, f.share != null ? 'produces · ' + f.share.toFixed(1) + '% of world' : (f.by ? 'produces (byproduct)' : 'produces'), 'g'));
      var m = f.m, cc = (f.cc || '').toLowerCase();
      nodes.push('<g class="fl-fac" tabindex="0" role="button" data-id="' + m.id + '" transform="translate(24 ' + (cy - 28) + ')"><title>' + esc(m.name + ' (' + cname(m.host) + ') · owner HQ ' + cname(f.cc) + ' · ' + (m.production || 'production n/a')) + '</title>'
        + '<rect class="fl-card" width="262" height="56" rx="8"/><image href="assets/flags/' + cc + '.svg" x="10" y="14" width="36" height="27" preserveAspectRatio="xMidYMid slice"/><rect x="10" y="14" width="36" height="27" rx="3" fill="none" stroke="rgba(0,0,0,.18)"/>'
        + '<text class="fl-name" x="56" y="24">' + esc(trunc(m.name, 27)) + '</text><text class="fl-sub" x="56" y="40">Mine' + (f.by ? ' · byproduct' : '') + ' · ' + esc(trunc(cname(f.cc), 16)) + '</text></g>');
    });
    if (more > 0) {
      var cy2 = fy0 + shown.length * STEP + 28;
      edgesG.push('<line class="fl-eg dash" x1="' + xr + '" y1="' + cy2 + '" x2="' + (MX - 32) + '" y2="' + ty + '" stroke-width="1.6" marker-end="url(#arG)"/>');
      nodes.push('<g class="fl-fac more" tabindex="0" role="button" data-more="1" transform="translate(24 ' + (cy2 - 28) + ')"><rect class="fl-card dash" width="262" height="56" rx="8"/><text class="fl-name" x="131" y="26" text-anchor="middle">+ ' + more + ' more mines</text><text class="fl-sub" x="131" y="42" text-anchor="middle">click to show all ' + facs.length + '</text></g>');
    } else if (state.expand && facs.length > MAXN) {
      var cy3 = fy0 + shown.length * STEP + 28; H += STEP;
      nodes.push('<g class="fl-fac more" tabindex="0" role="button" data-less="1" transform="translate(24 ' + (cy3 - 28) + ')"><rect class="fl-card dash" width="262" height="56" rx="8"/><text class="fl-name" x="131" y="33" text-anchor="middle">Collapse to top ' + MAXN + '</text></g>');
    }
    /* mineral node */
    nodes.push('<g class="fl-min" tabindex="0" role="button" data-min="1" transform="translate(0 0)"><title>Filter the atlas to ' + esc(ml(k)) + '</title>' + tile(MX, ty, 64, '#a8531c', 'layers') + label(MX, ty + 50, ds ? ds[0] : ml(k), 22, 'fl-lbl b') + '</g>');
    /* compounds and uses */
    if (ds) {
      var comps = chain, uses = {}, order = [];
      comps.forEach(function (c, ci) { c[1].forEach(function (u) { if (!uses[u[0]]) { uses[u[0]] = { n: u[0], ic: u[1], from: [] }; order.push(u[0]); } uses[u[0]].from.push(ci); }); });
      var cx0 = 330, cx1 = W - 70, cY = 270, uY = 110;
      var cxs = comps.map(function (_, i) { return comps.length === 1 ? (cx0 + cx1) / 2 : cx0 + (cx1 - cx0) * i / (comps.length - 1); });
      var ul = order.map(function (n) { var u = uses[n]; u.bc = u.from.reduce(function (a, ci) { return a + cxs[ci]; }, 0) / u.from.length; return u; }).sort(function (a, b) { return a.bc - b.bc; });
      var step = Math.min(150, (W - 200) / Math.max(ul.length - 1, 1)), uw = step * (ul.length - 1), ux0 = Math.max(90, Math.min(W / 2 - uw / 2, W - 100 - uw));
      ul.forEach(function (u, i) { u.x = ux0 + i * step; });
      comps.forEach(function (c, ci) {
        var x = cxs[ci];
        edgesG.push(line(MX, ty - 34, x, cY + 24, 'fl-ex', 1.5, 'arX')); edgesG.push(pill((MX + x) / 2, (ty - 34 + cY + 24) / 2, 'produced into', 'x'));
        nodes.push('<g class="fl-node"><title>' + esc(c[0]) + '</title>' + tile(x, cY, 44, '#c8691f', 'flask') + label(x, cY + 38, c[0], 20) + '</g>');
        c[1].forEach(function (uu) { var u = uses[uu[0]]; edgesG.push(line(x, cY - 24, u.x, uY + 26, 'fl-ex', 1.4, 'arX')); edgesG.push(pill(x + (u.x - x) * 0.62, cY - 24 + (uY + 26 - cY + 24) * 0.62, 'produced into', 'x')); });
      });
      ul.forEach(function (u, i) { nodes.push('<g class="fl-node"><title>' + esc(u.n) + '</title>' + tile(u.x, uY, 44, i % 2 ? '#2f6db5' : '#d9602a', u.ic) + label(u.x, uY - 30 - (wrap(u.n, 20).length - 1) * 12.5, u.n, 20, 'fl-lbl up') + '</g>'); });
      svg.push('<text class="fl-tag" x="' + (W - 14) + '" y="18" text-anchor="end">Typical downstream uses (illustrative)</text>');
    } else {
      svg.push('<text class="fl-tag" x="' + (MX) + '" y="' + (ty - 70) + '" text-anchor="middle">No curated downstream chain for this mineral yet</text>');
    }
    svg.push(edgesG.join(''), nodes.join(''));
    body.innerHTML = '<svg id="flowSvg" class="flow-svg" viewBox="0 0 ' + W + ' ' + Math.round(H) + '" role="img" aria-label="Supply flow diagram for ' + esc(ml(k)) + '">' + svg.join('') + '</svg>';
    var shareN = facs.filter(function (f) { return f.share != null; }).length;
    note.innerHTML = '<b>' + esc(ml(k)) + '</b>: ' + facs.length + ' tracked mine' + (facs.length === 1 ? '' : 's') + (facs.some(function (f) { return f.by; }) ? ' (' + facs.filter(function (f) { return f.by; }).length + ' as a byproduct host)' : '') + '. '
      + (shareN ? 'Arrow width follows each mine\u2019s share of world output (' + shareN + ' with a published share).' : 'No mine-level world share is published for this mineral, so all arrows have equal width.') + ' Flags show the owner HQ country (largest equity holder). Downstream compounds and uses are a generic, illustrative lookup, not company supply contracts.';
    var svgEl = $('#flowSvg');
    svgEl.addEventListener('click', onClick);
    svgEl.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); } });
  }
  function onClick(e) {
    var g = e.target.closest && e.target.closest('g[data-id],g[data-more],g[data-less],g[data-min]'); if (!g) return;
    if (g.dataset.more) { state.expand = true; render(); return; }
    if (g.dataset.less) { state.expand = false; render(); return; }
    var A = window.QXApp; if (!A) return;
    if (g.dataset.min) { var fm = $('#fMin'); fm.value = state.min; A.S.min = state.min; A.update(); document.getElementById('map').scrollIntoView(); return; }
    document.getElementById('map').scrollIntoView(); A.selectMine(+g.dataset.id, true);
  }
  function init() {
    var sel = $('#flowMin'); if (!sel) return;
    var counts = {}; MINES.forEach(function (m) { [m.primary].concat(m.secondary || []).forEach(function (c) { counts[c] = (counts[c] || 0) + 1; }); });
    Object.keys(counts).filter(function (c) { return MIN[c]; }).sort(function (a, b) { return ml(a).localeCompare(ml(b)); }).forEach(function (c) {
      var o = document.createElement('option'); o.value = c; o.textContent = ml(c) + ' (' + counts[c] + ')'; sel.appendChild(o); });
    var q = /[?&]flow=([A-Za-z]+)/.exec(location.search); if (q && counts[q[1]]) state.min = q[1];
    sel.value = state.min;
    sel.onchange = function () { state.min = sel.value; state.expand = false; render(); };
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
