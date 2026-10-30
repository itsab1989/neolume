/* Layout-Pruefung: Auswertung (Node) der Befunde von tools/layout_probe.js (laeuft je Szene im Browser von tools/visual.js).
 * Prueft keine Pixel, sondern das sichtbare DOM: ueberlappender Text, abgeschnittener Text, Text ueber fremden Bedienelementen,
 * Text ueber dem Bildschirm- oder Sicherheitsrand, teilweise ueberlappende Flaechen, Toast ueber Text, Knopf/Text ragt ueber
 * seinen Dialog/sein Panel hinaus (Arten siehe layout_probe.js).
 * Gewollte Faelle: tools/layout_allow.json ({scene, type, a, b, detail, reason}; scene/a/b/detail sind regulaere Ausdruecke, a/b gegen den
 * Elementpfad "div.v-home > div.row > div.cap > div.t1"; bei Paaren in beiden Reihenfolgen; detail gegen die Beschreibung, z. B.
 * "rechts") oder data-layout-ok am Element.
 * Bericht: <Ausgabe>/layout/index.html + report.json + Ausschnitte (gruen/blau = beteiligte Elemente, rot = Problemstelle). */
'use strict';
var fs = require('fs'), path = require('path');
var ALLOW_FILE = path.join(__dirname, 'layout_allow.json');
var TYPES = ['overlap', 'clip', 'button', 'offscreen', 'safe', 'panel', 'edge', 'notice', 'spill', 'ring'];
var LABEL = { overlap: 'Text ueberlappt Text', clip: 'Text abgeschnitten', button: 'Text ueber fremdem Bedienelement', offscreen: 'Text ueber dem Bildschirmrand',
  safe: 'Text im Sicherheitsrand', panel: 'Flaechen ueberlappen', edge: 'Flaeche erreicht den Bildschirmrand nicht',
  notice: 'Hinweis (Toast) verdeckt Text', spill: 'Ragt ueber den Rand seiner Flaeche',
  ring: 'Fokus-Ring ueber der Hinweisleiste' };

function loadAllow(file) {
  var j = JSON.parse(fs.readFileSync(file || ALLOW_FILE, 'utf8')), list = j.allow || [];
  list.forEach(function (e, i) {
    if (!e.reason || !e.type || !e.a) throw new Error('layout_allow.json Eintrag ' + i + ': type, a und reason sind Pflicht');
    if (TYPES.indexOf(e.type) < 0 && e.type !== '*') throw new Error('layout_allow.json Eintrag ' + i + ': unbekannte Art ' + e.type);
    e._s = new RegExp(e.scene || '.'); e._a = new RegExp(e.a); e._b = e.b ? new RegExp(e.b) : null; e._d = e.detail ? new RegExp(e.detail) : null; e._i = i;
  });
  return list;
}
/* passender Eintrag fuer einen Befund oder null */
function allowedBy(v, scene, list) {
  for (var i = 0; i < list.length; i++) {
    var e = list[i];
    if ((e.type !== '*' && e.type !== v.t) || !e._s.test(scene) || (e._d && !e._d.test(v.d || ''))) continue;
    var pa = v.a ? v.a.p : '', pb = v.b ? v.b.p : '';
    if (!e._b) { if (e._a.test(pa) || (pb && e._a.test(pb))) return e; continue; }
    if ((e._a.test(pa) && e._b.test(pb)) || (e._a.test(pb) && e._b.test(pa))) return e;
  }
  return null;
}
/* Befunde einer Szene einordnen -> {fail: [...], ok: [...]}; markiert benutzte Eintraege (e.used) */
function classify(scene, res, list) {
  var fail = [], ok = [];
  ((res && res.v) || []).forEach(function (v) {
    var e = allowedBy(v, scene, list);
    if (e) { e.used = (e.used || 0) + 1; v.allow = e.reason; ok.push(v); } else fail.push(v);
  });
  return { fail: fail, ok: ok };
}

/* Ausschnitt aus dem Screenshot mit Rahmen (a gruen, b blau, Problemstelle rot), 2-fach vergroessert wenn klein */
function crop(img, v, pad) {
  pad = pad || 24;
  var rects = [v.r].concat(v.a ? [v.a.r] : [], v.b ? [v.b.r] : []), l = 1e9, t = 1e9, r = -1e9, b = -1e9;
  rects.forEach(function (q) { l = Math.min(l, q[0]); t = Math.min(t, q[1]); r = Math.max(r, q[0] + q[2]); b = Math.max(b, q[1] + q[3]); });
  l = Math.max(0, Math.min(img.w - 1, l - pad)); t = Math.max(0, Math.min(img.h - 1, t - pad));
  r = Math.min(img.w, Math.max(l + 1, r + pad)); b = Math.min(img.h, Math.max(t + 1, b + pad));
  if (r - l > 900) { var cx = v.r[0] + v.r[2] / 2; l = Math.max(0, Math.round(cx - 450)); r = Math.min(img.w, l + 900); }
  if (b - t > 500) { var cy = v.r[1] + v.r[3] / 2; t = Math.max(0, Math.round(cy - 250)); b = Math.min(img.h, t + 500); }
  var sc = (r - l) < 400 && (b - t) < 250 ? 2 : 1, cw = (r - l) * sc, ch = (b - t) * sc, px = Buffer.alloc(cw * ch * 4);
  for (var y = 0; y < ch; y++) for (var x = 0; x < cw; x++) {
    var so = ((t + Math.floor(y / sc)) * img.w + l + Math.floor(x / sc)) * 4, o = (y * cw + x) * 4;
    px[o] = img.px[so]; px[o + 1] = img.px[so + 1]; px[o + 2] = img.px[so + 2]; px[o + 3] = 255;
  }
  function frame(q, rgb) {
    var x0 = (q[0] - l) * sc, y0 = (q[1] - t) * sc, x1 = (q[0] + q[2] - l) * sc - 1, y1 = (q[1] + q[3] - t) * sc - 1;
    function dot(x, y) { if (x < 0 || y < 0 || x >= cw || y >= ch) return; var o = (y * cw + x) * 4; px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2]; }
    for (var xx = x0; xx <= x1; xx++) { dot(xx, y0); dot(xx, y1); }
    for (var yy = y0; yy <= y1; yy++) { dot(x0, yy); dot(x1, yy); }
  }
  if (v.a) frame(v.a.r, [40, 220, 90]);
  if (v.b) frame(v.b.r, [60, 150, 255]);
  frame(v.r, [255, 40, 40]);
  return { w: cw, h: ch, px: px };
}

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function line(v) {
  return LABEL[v.t] + (v.d ? ' – ' + v.d : '') + '\n      A: ' + v.a.p + (v.a.s ? '  "' + v.a.s + '"' : '') + (v.b ? '\n      B: ' + v.b.p + (v.b.s ? '  "' + v.b.s + '"' : '') : '');
}
/* Bericht schreiben. scenes: [{name, res, png(Pfad)}]; io: {readPng, writePng}; full: alle Szenen gelaufen (-> unbenutzte Eintraege melden)
 * -> {fail, ok, missing, unused, dir} */
function report(dir, scenes, list, io, full) {
  var out = path.join(dir, 'layout'), rows = [], all = { scenes: {} }, nFail = 0, nOk = 0, missing = [];
  fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
  scenes.forEach(function (s) {
    if (!s.res || s.res.err) { missing.push(s.name + (s.res && s.res.err ? ' (' + s.res.err.split('\n')[0] + ')' : '')); return; }
    var c = classify(s.name, s.res, list), img = null;
    nFail += c.fail.length; nOk += c.ok.length;
    all.scenes[s.name] = { texts: s.res.n, ms: s.res.ms, fail: c.fail, allowed: c.ok };
    c.fail.forEach(function (v, i) {
      if (!img && s.png && fs.existsSync(s.png)) img = io.readPng(s.png);
      var f = s.name + '-' + (i + 1) + '.png';
      if (img) { var cr = crop(img, v); fs.writeFileSync(path.join(out, f), io.writePng(cr.w, cr.h, cr.px)); v.img = 'layout/' + f; }
      rows.push('<section><h3>' + esc(s.name) + ' · ' + esc(LABEL[v.t]) + (v.d ? ' – ' + esc(v.d) : '') + '</h3>' +
        '<p class="a">A: <code>' + esc(v.a.p) + '</code> ' + esc(v.a.s) + '</p>' + (v.b ? '<p class="b">B: <code>' + esc(v.b.p) + '</code> ' + esc(v.b.s) + '</p>' : '') +
        (img ? '<img src="' + f + '">' : '') + '</section>');
    });
  });
  var unused = full ? list.filter(function (e) { return !e.used; }) : [];
  all.summary = { fail: nFail, allowed: nOk, missing: missing, unused: unused.map(function (e) { return { i: e._i, scene: e.scene, type: e.type, a: e.a, b: e.b, reason: e.reason }; }) };
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(all, null, 1));
  fs.writeFileSync(path.join(out, 'index.html'), '<!DOCTYPE html><meta charset="utf-8"><title>Layout-Pruefung</title><style>body{font:14px sans-serif;background:#1b1c20;color:#ddd;margin:24px}' +
    'code{color:#fc6}section{margin:0 0 28px}h3{margin:0 0 4px;color:#f88}.a code{color:#5d8}.b code{color:#7af}p{margin:2px 0}img{margin-top:6px;border:1px solid #444;max-width:100%}</style>' +
    '<h1>Layout-Pruefung: ' + nFail + ' Befund(e), ' + nOk + ' erlaubt</h1><p>Rahmen: gruen = A, blau = B, rot = Problemstelle. Gewollte Faelle: tools/layout_allow.json</p>' +
    (missing.length ? '<p>Ohne Ergebnis: ' + esc(missing.join(', ')) + '</p>' : '') + rows.join('\n'));
  return { fail: nFail, ok: nOk, missing: missing, unused: unused, dir: out, data: all };
}
/* Konsolenausgabe */
function print(rep, log) {
  log = log || console.log;
  Object.keys(rep.data.scenes).forEach(function (n) {
    rep.data.scenes[n].fail.forEach(function (v) { log('  ' + (n + '                      ').slice(0, 22) + line(v)); });
  });
  rep.unused.forEach(function (e) { log('  Hinweis: Erlaubnis-Eintrag ' + e._i + ' (' + e.type + ' ' + (e.scene || '*') + ' ' + e.a + ') wird nicht mehr gebraucht – entfernen?'); });
  if (rep.missing.length) log('  Ohne Layout-Ergebnis: ' + rep.missing.join(', '));
  log('Layout: ' + rep.fail + ' Befund(e), ' + rep.ok + ' erlaubt' + (rep.fail ? ' – Bericht: ' + path.join(rep.dir, 'index.html') : '') + '.');
}

module.exports = { loadAllow: loadAllow, allowedBy: allowedBy, classify: classify, crop: crop, report: report, print: print, TYPES: TYPES, ALLOW_FILE: ALLOW_FILE };
