#!/usr/bin/env node
/* visuelle Regression (Nutzer-Anforderung M2).
 *   node tools/visual.js            Ansichten mit synthetischen Daten rendern -> tests/visual/current/, mit baseline/ vergleichen
 *   node tools/visual.js --approve  aktuelle Bilder als neue Baseline uebernehmen
 *   node tools/visual.js --only home,login,saver-*   nur diese Szenen (Namen oder Muster mit * und ?)
 *   node tools/visual.js --changed   nur Szenen, die von Aenderungen gegenueber main betroffen sein koennen (PN_VIS_BASE=<ref>);
 *                                    schnelles Nachsehen beim Arbeiten – die volle Suite bleibt Pflicht vor dem Release
 *   node tools/visual.js --list …    nur die ausgewaehlten Szenen auflisten, nichts rendern
 *   PN_VIS_JOBS=n   Szenen gleichzeitig (Standard min(8, Kerne/2)); jeder Worker hat eigenen Mock-Server und eigenes Profil
 *   PN_VIS_MAX=n    hoechstens n Firefox rechnerweit ueber alle gleichzeitigen Laeufe (Standard 8 – Absturz 29.10. bei zwei vollen Laeufen mit zusammen 10; 0 = ohne; Sperrordner
 *                   $TMPDIR/pnvis-slots, verwaiste Eintraege werden selbst aufgeraeumt)
 *   PN_VIS_OUT=/pfad node tools/visual.js --only …   Ausgabe in eigenen Ordner (parallele Laeufe teilen sonst tests/visual/current)
 *   node tools/visual.js --readable   gegen app/app.js statt app/app.min.js (Standard: der minifizierte Release-Build, P7)
 *   node tools/visual.js --layout     nur die Layout-Pruefung (ohne Pixelvergleich) = npm run layoutcheck;  --no-layout schaltet sie ab
 * Layout-Pruefung (Standard bei jedem Lauf): direkt vor jedem Screenshot untersucht tools/layout_probe.js das sichtbare DOM
 * (ueberlappender/abgeschnittener Text, Text ueber fremden Knoepfen, ueber Bildschirm-/Sicherheitsrand, ueberlappende Flaechen);
 * tools/layoutcheck.js wertet aus (Erlaubnisliste tools/layout_allow.json), Bericht in <Ausgabe>/layout/index.html.
 * Rendert tools/preview.html in Firefox headless (1280x720) gegen einen lokalen Mock (PMS + plex.tv-Proxy + Bilder),
 * daher ohne Netz und ohne Geheimnisse. Vergleich pixelweise (Kanal-Toleranz 24, Schwelle 0,2 % der Flaeche, Masken
 * fuer zeitabhaengige Bereiche). Ausgabe: Bericht + diff-*.png (rot = Abweichung). */
'use strict';
var fs = require('fs'), path = require('path'), http = require('http'), zlib = require('zlib'), cp = require('child_process'), os = require('os');
var ROOT = path.join(__dirname, '..'), SYN = path.join(ROOT, 'tests', 'synthetic'), VIS = path.join(ROOT, 'tests', 'visual');
var CUR = process.env.PN_VIS_OUT ? path.resolve(process.env.PN_VIS_OUT) : path.join(VIS, 'current'), BASE = path.join(VIS, 'baseline');   // PN_VIS_OUT: eigener Ausgabeordner (parallele Laeufe)
var FIREFOX = process.env.FIREFOX || '/Applications/Firefox.app/Contents/MacOS/firefox';
var TOL = 24, MAX_RATIO = 0.002;
var args = process.argv.slice(2), APPROVE = args.indexOf('--approve') >= 0, WORKER = args.indexOf('--worker') >= 0, CHANGED = args.indexOf('--changed') >= 0;
var ONLY = (function () { var i = args.indexOf('--only'); return i >= 0 ? String(args[i + 1] || '').split(',').filter(Boolean) : null; })();   // Namen oder Muster (* ?)
var MIN = args.indexOf('--readable') < 0, APPFILE = MIN ? 'app.min.js' : 'app.js';
var LAYOUT_ONLY = args.indexOf('--layout') >= 0, LAYOUT = LAYOUT_ONLY || args.indexOf('--no-layout') < 0, layoutRes = {};
var JOBS = Math.max(1, Number(process.env.PN_VIS_JOBS) || Math.min(8, Math.floor(os.cpus().length / 2)) || 1);   // gleichzeitige Firefox je Lauf
var MAX_TOTAL = process.env.PN_VIS_MAX === undefined ? 8 : Number(process.env.PN_VIS_MAX);                    // rechnerweit (alle Laeufe zusammen), 0 = ohne Grenze
var LOCKDIR = process.env.PN_VIS_LOCKDIR || path.join(os.tmpdir(), 'pnvis-slots');
if (require.main === module && !fs.existsSync(path.join(ROOT, 'app', APPFILE))) { console.error('app/' + APPFILE + ' fehlt – zuerst "npm run build" (wird nicht eingecheckt).'); process.exit(1); }

/* ---------- PNG lesen/schreiben (8 Bit, RGB/RGBA, ohne Interlace) ---------- */
function readPng(file) {
  var b = fs.readFileSync(file), pos = 8, w, h, ct, idat = [];
  while (pos < b.length) {
    var len = b.readUInt32BE(pos), type = b.toString('ascii', pos + 4, pos + 8), data = b.slice(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; if (data[8] !== 8 || data[12] !== 0) throw new Error('PNG-Format nicht unterstuetzt: ' + file); }
    else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  var bpp = ct === 6 ? 4 : ct === 2 ? 3 : 0;
  if (!bpp) throw new Error('PNG-Farbtyp ' + ct + ' nicht unterstuetzt: ' + file);
  var raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp, out = Buffer.alloc(w * h * 4), prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
  for (var y = 0; y < h; y++) {
    var f = raw[y * (stride + 1)], line = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (var x = 0; x < stride; x++) {
      var a = x >= bpp ? cur[x - bpp] : 0, up = prev[x], c = x >= bpp ? prev[x - bpp] : 0, v = line[x];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { var p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      cur[x] = v & 255;
    }
    for (x = 0; x < w; x++) { var o = (y * w + x) * 4; out[o] = cur[x * bpp]; out[o + 1] = cur[x * bpp + 1]; out[o + 2] = cur[x * bpp + 2]; out[o + 3] = bpp === 4 ? cur[x * bpp + 3] : 255; }
    var t = prev; prev = cur; cur = t;
  }
  return { w: w, h: h, px: out };
}
var CRC = (function () { var t = [], c, n, k; for (n = 0; n < 256; n++) { c = n; for (k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { var c = 0xFFFFFFFF; for (var i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function chunk(type, data) { var l = Buffer.alloc(4); l.writeUInt32BE(data.length); var td = Buffer.concat([Buffer.from(type), data]); var c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
function writePng(w, h, px) {
  var raw = Buffer.alloc((w * 4 + 1) * h);
  for (var y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  var ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
/* unscharfes Ersatzbild (Poster/Cover mit blur, >= 640 breit): wie der echte PMS (minSize=1 schneidet nicht zu) im Poster-Format 2:3,
 * obere Haelfte hell, untere dunkler -> im Bildtest sichtbar, dass es mittig beschnitten und nicht verzerrt ist */
function posterPng(w, rgb) {
  var h = Math.round(w * 1.5), px = Buffer.alloc(w * h * 4);
  for (var i = 0; i < w * h; i++) { var k = i < w * h / 2 ? 1 : 0.55; px[i * 4] = rgb[0] * k; px[i * 4 + 1] = rgb[1] * k; px[i * 4 + 2] = rgb[2] * k; px[i * 4 + 3] = 255; }
  return writePng(w, h, px);
}
/* Bildschirmschoner-Szenen: sehr unruhiges Bild (8-px-Schachbrett aus Weiss und kraeftigen Farben) = schlimmster Fall fuer Lesbarkeit */
function busyPng(w, h) {
  var px = Buffer.alloc(w * h * 4), C = [[250, 250, 250], [230, 40, 40], [250, 210, 30], [30, 160, 240], [20, 20, 24], [60, 200, 90]];
  for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
    var c = C[((x >> 3) * 7 + (y >> 3) * 3 + ((x >> 5) ^ (y >> 4))) % C.length], o = (y * w + x) * 4;
    px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
  }
  return writePng(w, h, px);
}
/* Ecke unten links (Seitenleiste + Band unten, Seed ambCorner): knallbuntes, helles Titelbild (abgedunkelt wie am PMS, f = darken) –
 * weicher Verlauf aus vier Eckfarben, damit Staerke und Form des Rahmens auf ruhigem, buntem Grund sichtbar sind */
function gradPng(w, h, f) {
  var C = [[255, 45, 110], [255, 212, 0], [0, 229, 255], [124, 255, 0]], px = Buffer.alloc(w * h * 4);   // oben links, oben rechts, unten rechts, unten links
  for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
    var u = x / (w - 1), v = y / (h - 1), o = (y * w + x) * 4;
    var c = [0, 1, 2].map(function (k) { return Math.round((C[0][k] * (1 - u) + C[1][k] * u) * (1 - v) + (C[3][k] * (1 - u) + C[2][k] * u) * v); });
    c = f ? f(c) : c; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2];
    px[o + 3] = 255;
  }
  return writePng(w, h, px);
}
function solidPng(w, h, rgb) { var px = Buffer.alloc(w * h * 4); for (var i = 0; i < w * h; i++) { px[i * 4] = rgb[0]; px[i * 4 + 1] = rgb[1]; px[i * 4 + 2] = rgb[2]; px[i * 4 + 3] = 255; } return writePng(w, h, px); }

/* reiner Vergleich (auch fuer Tests): -> {diff, ratio, mask(px)} */
function compare(a, b, masks) {
  if (a.w !== b.w || a.h !== b.h) return { diff: -1, ratio: 1, img: null };
  var n = 0, img = Buffer.alloc(a.w * a.h * 4);
  for (var y = 0; y < a.h; y++) for (var x = 0; x < a.w; x++) {
    var o = (y * a.w + x) * 4, masked = false;
    for (var m = 0; masks && m < masks.length; m++) { var r = masks[m]; if (x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3]) { masked = true; break; } }
    var d = masked ? 0 : Math.max(Math.abs(a.px[o] - b.px[o]), Math.abs(a.px[o + 1] - b.px[o + 1]), Math.abs(a.px[o + 2] - b.px[o + 2]));
    if (d > TOL) { n++; img[o] = 255; img[o + 1] = 0; img[o + 2] = 0; img[o + 3] = 255; }
    else { var g = (b.px[o] + b.px[o + 1] + b.px[o + 2]) / 9 | 0; img[o] = img[o + 1] = img[o + 2] = masked ? 40 : g; img[o + 3] = 255; }
  }
  return { diff: n, ratio: n / (a.w * a.h), img: img };
}

/* ---------- M3b: synthetische Bibliothek (Filme 1, Serien 2), Details, Suche ---------- */
var LIB = (function () {
  var bases = ['Abendrot', 'Bergwind', 'Coralle', 'Donnerhall', 'Eisvogel', 'Fernweh', 'Glutnest', 'Himmelsleiter', 'Inselreich', 'Jadegarten',
    'Kieselstrand', 'Lichtung', 'Mondfahrt', 'Nordlicht', 'Ozeanblau', 'Polarstern', 'Quellwasser', 'Regenbogen', 'Sturmfront', 'Talsperre',
    'Uferweg', 'Vulkan', 'Wolkenhaus', 'Zugvogel'];
  var suf = ['', ' 2', ' – Die Rückkehr', ' im Winter', ' und das Meer'], movies = [], shows = [], i, j;
  for (i = 0; i < bases.length; i++) for (j = 0; j < suf.length; j++) {
    var n = movies.length, rk = String(4000 + n);
    movies.push({ ratingKey: rk, type: 'movie', title: bases[i] + suf[j], titleSort: bases[i] + suf[j], year: 1960 + (n * 7) % 64, librarySectionID: 1,
      thumb: '/t/m' + rk, art: '/a/m' + rk, duration: 5400000 + (n % 5) * 600000, viewCount: n % 3 === 0 ? 1 : 0, viewOffset: n % 7 === 2 ? 1800000 : 0,
      addedAt: 1700000000 + n * 3600, audienceRating: 5 + (n % 50) / 10, contentRating: 'de/12', summary: 'Eine ruhige Geschichte über ' + bases[i] + '. Synthetischer Testtext für die Detailseite.' });
  }
  movies.unshift({ ratingKey: '3999', type: 'movie', title: '7 Brücken', titleSort: '7 Brücken', year: 2001, librarySectionID: 1, thumb: '/t/m3999', art: '/a/m3999', duration: 6000000, viewCount: 0, addedAt: 1600000000 });
  for (i = 0; i < 30; i++) {
    var srk = String(5100 + i * 10), seasons = i === 0 ? 3 : 1 + i % 3;
    shows.push({ ratingKey: srk, type: 'show', title: bases[i % 24] + (i >= 24 ? ' (Neu)' : '') + ' – Serie', titleSort: bases[i % 24] + (i >= 24 ? ' Neu' : '') + ' Serie', year: 1990 + i,
      librarySectionID: 2, thumb: '/t/s' + srk, art: '/a/s' + srk, childCount: seasons, leafCount: seasons * 12 + (i === 0 ? 30 : 0), viewedLeafCount: i % 4 === 0 ? 14 : 0,
      contentRating: 'de/6', audienceRating: 7.5, theme: '/library/metadata/' + srk + '/theme/1', summary: 'Eine Serie über ' + bases[i % 24] + ' mit mehreren Staffeln.' });
  }
  delete shows[23].thumb; delete shows[23].art;          // 'Zugvogel – Serie': ganz ohne Bilder (TV-Befund: Serie ohne Metadaten)
  movies.sort(function (a, b) { return a.titleSort < b.titleSort ? -1 : 1; });
  shows.sort(function (a, b) { return a.titleSort < b.titleSort ? -1 : 1; });
  return { 1: movies, 2: shows };
})();
/* M4 Musik (Bibliothek 3): 12 Kuenstler (9100+), je 2 Alben (9200+), je 9 Titel (9300 + Album*20 + n) */
var MUS = (function () {
  var names = ['Aurora Weiss', 'Bergklang', 'Celine Vogt', 'Delta Fluss', 'Echo Tal', 'Frost & Feuer', 'Glasperlen', 'Hafenlichter', 'Inselkind', 'Juni Sterne', 'Kranich', 'Lindgrün'];
  var ar = [], al = [], i, j;
  for (i = 0; i < names.length; i++) {
    ar.push({ ratingKey: String(9100 + i), type: 'artist', title: names[i], titleSort: names[i], thumb: '/t/ar' + i, art: '/a/ar' + i, addedAt: 1700000000 + i, summary: 'Synthetische Biografie von ' + names[i] + '.' });
    for (j = 0; j < 2; j++) {
      var k = al.length;
      al.push({ ratingKey: String(9200 + k), type: 'album', title: (j ? 'Nachtfahrt ' : 'Morgenlicht ') + (i + 1), titleSort: (j ? 'Nachtfahrt ' : 'Morgenlicht ') + (100 + i),
        parentTitle: names[i], parentRatingKey: String(9100 + i), year: 2000 + k, thumb: '/t/al' + k, art: '/a/ar' + i, addedAt: 1700000000 + k * 10, summary: 'Ein synthetisches Album mit neun Titeln.' });
    }
  }
  // TV-Test 27.10. (F24/F27/F28): Album ohne jedes Bild mit hellem Hintergrund (Kuenstler-Art weiss) und verwaister Eintrag ohne Titel
  var nc = al[2]; delete nc.thumb; nc.art = '/a/hell'; nc.nocover = true;
  ar[1].art = '/a/hell';
  al.push({ ratingKey: String(9200 + al.length), type: 'album', title: '', titleSort: 'Morgenlicht 100a', addedAt: 1700000000, summary: '' });
  // Live-Befund 27.10.: Kompilation/Live-Album fehlen in /children, kommen ueber /related (Hubs artist.albums.*) – 'Celine Vogt'
  al.push({ ratingKey: String(9200 + al.length), type: 'album', title: 'Das Beste von Celine Vogt', titleSort: 'Zz Beste', parentTitle: names[2], parentRatingKey: '9102', year: 2015,
    thumb: '/t/al' + al.length, art: '/a/ar2', addedAt: 1700000000, summary: '', hub: 'compilation' });
  al.push({ ratingKey: String(9200 + al.length), type: 'album', title: 'Abends am Fluss (Live)', titleSort: 'Zz Live', parentTitle: names[2], parentRatingKey: '9102', year: 2012,
    thumb: '/t/al' + al.length, art: '/a/ar2', addedAt: 1700000000, summary: '', hub: 'live' });
  al.sort(function (a, b) { return a.titleSort < b.titleSort ? -1 : 1; });
  function tracks(alb) {
    var k = Number(alb.ratingKey) - 9200, out = [], lg = /^bookLoupe/.test(curSeed);   // Feinauswahl im Hoerbuch: lange Kapitel-Dateien (45 Min.)
    for (var t = 1; t <= 9; t++) out.push({ ratingKey: String(9300 + k * 20 + t), type: 'track', title: 'Lied Nummer ' + t, index: t, parentIndex: 1, parentTitle: alb.title,
      parentRatingKey: alb.ratingKey, grandparentTitle: alb.parentTitle, grandparentRatingKey: alb.parentRatingKey, parentThumb: alb.thumb, grandparentArt: alb.nocover ? alb.art : undefined, duration: lg ? 2700000 : 180000 + t * 7000,
      Media: [{ audioCodec: 'mp3', container: 'mp3', Part: [{ id: 9300 + k * 20 + t, key: '/library/parts/' + (9300 + k * 20 + t) + '/1/file.mp3', duration: lg ? 2700000 : 180000 + t * 7000 }] }] });
    return out;
  }
  return { ar: ar, al: al, tracks: tracks };
})();
function musicRoute(p, q) {
  var m = /^\/library\/sections\/3\/(all|firstCharacter|collections|prefs)$/.exec(p), list, i;
  if (m) {
    if (m[1] === 'prefs') return { MediaContainer: { Setting: [{ id: 'enableTrackOffsets', value: /^book/.test(curSeed) }] } };   // Seeds book*: Musik als Hoerbuch-Bibliothek
    if (m[1] === 'collections') return page([], q);
    list = q.get('type') === '9' ? MUS.al.slice() : MUS.ar.slice();
    if (/titleSort:desc/.test(String(q.get('sort')))) list.reverse();
    if (m[1] === 'firstCharacter') return firstChars(list);
    var pa = page(list, q); pa.MediaContainer.librarySectionID = 3; return pa;
  }
  m = /^\/library\/metadata\/(9\d\d\d)(\/children|\/allLeaves|\/related)?$/.exec(p);
  if (!m) return null;
  var rk = m[1];
  for (i = 0; i < MUS.ar.length; i++) if (MUS.ar[i].ratingKey === rk) {
    var a = MUS.ar[i], als = MUS.al.filter(function (x) { return x.parentRatingKey === rk; });
    var main = als.filter(function (x) { return !x.hub; });
    if (m[2] === '/children') return { MediaContainer: { size: main.length, librarySectionID: 3, Metadata: main } };
    if (m[2] === '/related') return { MediaContainer: { size: 6, Hub: ['singles', 'live', 'soundtrack', 'compilation', 'demo', 'remix'].map(function (h) {
      var l = als.filter(function (x) { return x.hub === h; }); return { hubIdentifier: 'artist.albums.' + h, type: 'album', size: l.length, Metadata: l };
    }) } };
    if (m[2] === '/allLeaves') return { MediaContainer: { size: 18, Metadata: MUS.tracks(main[0]).concat(MUS.tracks(main[1])) } };
    var x = JSON.parse(JSON.stringify(a)); x.librarySectionID = 3; x.PopularLeaves = { size: 5, Metadata: MUS.tracks(main[0]).slice(0, 5) };
    return { MediaContainer: { size: 1, Metadata: [x] } };
  }
  for (i = 0; i < MUS.al.length; i++) if (MUS.al[i].ratingKey === rk) {
    if (m[2]) { var tr = MUS.tracks(MUS.al[i]); return { MediaContainer: { size: tr.length, totalSize: tr.length, Metadata: tr } }; }
    var y = JSON.parse(JSON.stringify(MUS.al[i])); y.librarySectionID = 3; y.Genre = [{ tag: 'Pop' }];
    return { MediaContainer: { size: 1, Metadata: [y] } };
  }
  var tk = Number(rk) - 9300, alb = MUS.al.filter(function (z) { return Number(z.ratingKey) - 9200 === Math.floor(tk / 20); })[0];
  if (alb) return { MediaContainer: { size: 1, Metadata: [MUS.tracks(alb)[tk % 20 - 1]] } };
  return null;
}
function libAll(id, q) {
  var list = (LIB[id] || []).slice(), sort = String(q.get('sort') || 'titleSort:asc');
  if (q.get('unwatched') === '1') list = list.filter(function (m) { return m.type === 'show' ? m.viewedLeafCount < m.leafCount : !m.viewCount; });
  if (q.get('unwatched') === '0') list = list.filter(function (m) { return m.type === 'show' ? m.viewedLeafCount >= m.leafCount : m.viewCount > 0; });
  if (q.get('inProgress') === '1') list = list.filter(function (m) { return m.viewOffset > 0; });
  if (q.get('actor')) list = list.filter(function (m, k) { return k % 4 === 0; });
  if (q.get('genre')) list = list.filter(function (m, k) { return k % 2 === 0; });
  if (/titleSort:desc/.test(sort)) list.reverse();
  else if (/^addedAt|episode.addedAt/.test(sort)) list.sort(function (a, b) { return (b.addedAt || 0) - (a.addedAt || 0); });
  return list;
}
function firstChars(list) {
  var out = [];
  list.forEach(function (m) { var c = m.titleSort.charAt(0).toUpperCase(); if (!/[A-Z]/.test(c)) c = '#'; if (out.length && out[out.length - 1].title === c) out[out.length - 1].size++; else out.push({ key: c, title: c, size: 1 }); });
  return { MediaContainer: { size: out.length, Directory: out } };
}
function page(list, q) {
  var st = Number(q.get('X-Plex-Container-Start') || 0), sz = Number(q.get('X-Plex-Container-Size') || 50);
  return { MediaContainer: { size: Math.min(sz, Math.max(0, list.length - st)), totalSize: list.length, offset: st, Metadata: list.slice(st, st + sz) } };
}
function findLib(rk) { var all = LIB[1].concat(LIB[2]); for (var i = 0; i < all.length; i++) if (all[i].ratingKey === rk) return all[i]; return null; }
function libMeta(m) {
  var x = JSON.parse(JSON.stringify(m)), people = ['Mara Lind', 'Jonas Berg', 'Ida Sommer', 'Paul Feld', 'Lea Nord', 'Tom Wiese', 'Ina Kehl', 'Ole Brandt'];
  x.Role = people.map(function (p, k) { return { id: 900 + k, tag: p, role: 'Rolle ' + (k + 1), thumb: '/t/p' + k }; });
  x.Genre = [{ id: 143, tag: 'Abenteuer' }]; x.Director = [{ id: 70, tag: 'Rita Sand' }]; x.studio = 'Teststudio';
  if (x.type === 'movie') {
    x.Media = [{ id: 1, videoResolution: '1080', videoCodec: 'h264', audioCodec: 'ac3', container: 'mkv', Part: [{ id: Number(x.ratingKey), Stream: [
      { id: 1, streamType: 1, codec: 'h264' }, { id: 2, streamType: 2, codec: 'ac3', channels: 6, languageCode: 'ger', selected: true }, { id: 3, streamType: 2, codec: 'aac', channels: 2, languageCode: 'eng' },
      { id: 4, streamType: 3, codec: 'srt', languageCode: 'ger', forced: true }, { id: 5, streamType: 3, codec: 'srt', languageCode: 'eng' }] }] }];
    x.Extras = { size: 2, Metadata: [{ ratingKey: '8801', type: 'clip', subtype: 'trailer', extraType: 1, title: 'Trailer', thumb: '/t/x1', duration: 120000 },
      { ratingKey: '8802', type: 'clip', subtype: 'behindTheScenes', extraType: 5, title: 'Hinter den Kulissen', thumb: '/t/x2', duration: 600000 }] };
  }
  x.Related = { Hub: [{ hubIdentifier: x.type === 'show' ? 'tv.similar' : 'movie.similar', title: 'Ähnliche', Metadata: (x.type === 'show' ? LIB[2] : LIB[1]).slice(3, 11) }] };
  if (x.type === 'show') x.OnDeck = { Metadata: epMeta(x, 1, 3) };
  return { MediaContainer: { size: 1, Metadata: [x] } };
}
function epMeta(show, s, e) {
  var rk = String(Number(show.ratingKey) + s) + String(1000 + e).slice(1);
  return { ratingKey: rk, type: 'episode', title: 'Kapitel ' + e, index: e, parentIndex: s, grandparentTitle: show.title, grandparentRatingKey: show.ratingKey,
    parentRatingKey: String(Number(show.ratingKey) + s), thumb: '/t/e' + rk, duration: 1440000, viewCount: s === 1 && e < 3 ? 1 : 0, viewOffset: s === 1 && e === 3 ? 600000 : 0,
    summary: 'Folge ' + e + ' der Staffel ' + s + '. Synthetischer Text.', originallyAvailableAt: '2023-10-0' + (1 + e % 9) };
}
function seasonsOf(show) {
  var out = [];
  for (var s = 1; s <= show.childCount; s++) out.push({ ratingKey: String(Number(show.ratingKey) + s), type: 'season', index: s, title: 'Staffel ' + s, leafCount: s === 1 && show.ratingKey === '5100' ? 42 : 12, viewedLeafCount: s === 1 ? 2 : 0 });
  if (show.ratingKey === '5100') out.push({ ratingKey: '5109', type: 'season', index: 0, title: 'Specials', leafCount: 2, viewedLeafCount: 0 });
  return { MediaContainer: { size: out.length, Metadata: out } };
}
function seasonEps(rk, q) {
  var showRk = String(Math.floor(Number(rk) / 10) * 10), show = findLib(showRk), s = Number(rk) % 10, n = s === 1 && showRk === '5100' ? 42 : s === 9 ? 2 : 12, list = [];
  for (var e = 1; e <= n; e++) list.push(epMeta(show, s === 9 ? 0 : s, e));
  return page(list, q);
}
function search(query) {
  var ql = String(query || '').toLowerCase(), mv = LIB[1].filter(function (m) { return m.title.toLowerCase().indexOf(ql) >= 0; }).slice(0, 10);
  var sh = LIB[2].filter(function (m) { return m.title.toLowerCase().indexOf(ql) >= 0; }).slice(0, 10);
  var ep = sh.length ? [epMeta(sh[0], 1, 4), epMeta(sh[0], 1, 5)] : [];
  var ac = ql === 'ab' || 'jonas berg'.indexOf(ql) >= 0 ? [{ type: 'tag', id: 901, tag: 'Jonas Berg', filter: 'actor=901', librarySectionID: 1, thumb: '/t/p1' }] : [];
  return { MediaContainer: { size: 5, Hub: [{ hubIdentifier: 'track', type: 'track', title: 'Titel', size: 1, Metadata: [{ type: 'track', title: 'Lied' }] },
    { hubIdentifier: 'movie', type: 'movie', title: 'Filme', size: mv.length, Metadata: mv }, { hubIdentifier: 'show', type: 'show', title: 'Serien', size: sh.length, Metadata: sh },
    { hubIdentifier: 'episode', type: 'episode', title: 'Folgen', size: ep.length, Metadata: ep }, { hubIdentifier: 'actor', type: 'actor', title: 'Schauspieler', size: ac.length, Directory: ac }] } };
}

/* P4 Entdecken: synthetische Plex-GUIDs (24 hex) fuer Bibliothekstitel + fremde Treffer von /matches (Abgleich per /library/all?guid=) */
function sguid(type, rk) { var h = Number(rk).toString(16); return 'plex://' + type + '/' + new Array(25 - h.length).join('a') + h; }
function matchesFor(q) {
  var ql = String(q.get('title') || '').toLowerCase(), movie = q.get('agent') === 'tv.plex.agents.movie', type = movie ? 'movie' : 'show', out = [];
  var own = (movie ? LIB[1] : LIB[2]).filter(function (m) { return m.title.toLowerCase().indexOf(ql) === 0; }).slice(0, 2);
  own.forEach(function (m) { out.push({ guid: sguid(type, m.ratingKey), name: m.title + ' (Originaltitel)', year: m.year, type: type, thumb: 'https://images.example/' + m.ratingKey }); });
  var names = movie ? ['Abendland', 'Abenteuer im Eis', 'Aberglaube', 'Abflug 22:10', 'Abgrund'] : ['Abenteuer Nordsee', 'Abendschule'];
  names.forEach(function (n, i) { out.push({ guid: sguid(type, 70000 + (movie ? 0 : 100) + i), name: n, year: 2020 + i, type: type, summary: i === 4 ? undefined : 'Synthetische Beschreibung eines Titels, der nicht auf dem Server liegt.', thumb: i === 2 ? undefined : 'https://images.example/' + type + i }); });
  return { MediaContainer: { size: out.length, SearchResult: ql.length >= 2 ? out : [] } };
}
function byGuid(list) {
  var want = String(list || '').split(','), out = [];
  [1, 2].forEach(function (id) { LIB[id].forEach(function (m) { if (want.indexOf(sguid(m.type, m.ratingKey)) >= 0) { var c = JSON.parse(JSON.stringify(m)); c.guid = sguid(m.type, m.ratingKey); out.push(c); } }); });
  return { MediaContainer: { size: out.length, Metadata: out } };
}

/* Helfer /details (DISC-5): erfundene Katalogdaten fremder Titel aus matchesFor – 70000 Film voll, 70100 Serie voll, sonst minimal */
function extDetails(id) {
  var n = parseInt(String(id).replace(/^a+/, ''), 16) || 0, show = n >= 70100 && n < 70200, img = 'https://metadata-static.plex.tv/people/p';
  var base = { id: id, type: show ? 'show' : 'movie', guid: 'plex://' + (show ? 'show' : 'movie') + '/' + id, year: 2020 + n % 100, cast: [], genres: [], directors: [], writers: [] };
  function cast(names) { return names.map(function (x, i) { return { name: x[0], role: x[1], thumb: i === 3 ? '' : img + n + '-' + i + '.jpg' }; }); }
  if (n === 70000) return Object.assign(base, { title: 'Abendland', summary: 'Als die Fischerin Ilka Brandt nach zwanzig Jahren in ihr Heimatdorf an der Küste zurückkehrt, findet sie das Haus ihrer Mutter leer und die Nachbarn schweigsam. Ein altes Logbuch führt sie auf die Spur eines Unglücks, über das im Dorf niemand sprechen will – und zu der Frage, wem sie noch trauen kann. Synthetischer Testtext.',
    tagline: 'Manche Wellen kommen zurück.', date: '2020-03-12', thumb: 'https://image.tmdb.org/t/p/original/poster70000.jpg', art: 'https://image.tmdb.org/t/p/original/art70000.jpg',
    contentRating: 'de/12', duration: 7020000, rating: 7.4, studio: 'Nordlicht Film', genres: ['Drama', 'Thriller', 'Mystery', 'Krimi'], directors: ['Mara Lindqvist', 'Jonas Feld'], writers: ['Pia Sander'],
    cast: cast([['Lena Albers', 'Ilka Brandt'], ['Tom Wieland', 'Jens Kröger'], ['Ruth Hansen', 'Marta'], ['Ole Petersen', 'Hafenmeister'], ['Nina Vogt', 'Svenja'], ['Paul Behrens', 'Pastor'], ['Kim Lorenz', 'Junge Ilka'], ['Erik Dahl', 'Fischer']]) });
  if (n === 70100) return Object.assign(base, { title: 'Abenteuer Nordsee', summary: 'Vier Jugendliche entdecken auf einer Hallig ein verlassenes Forschungsschiff. Jede Staffel ein neues Rätsel zwischen Ebbe und Flut. Synthetischer Testtext.',
    tagline: '', date: '2020-09-01', thumb: 'https://image.tmdb.org/t/p/original/poster70100.jpg', art: 'https://image.tmdb.org/t/p/original/art70100.jpg', contentRating: 'de/12', duration: 2700000, rating: 8.1,
    studio: 'Hallig Pictures', network: 'Kanal Nord', genres: ['Abenteuer', 'Familie'], seasons: 4, episodes: 38, continuing: true, lastAired: '2026-09-30',
    cast: cast([['Mia Kruse', 'Frieda'], ['Jan Ohlsen', 'Bent'], ['Ayla Demir', 'Nesrin'], ['Lukas Hein', 'Matti'], ['Greta Möller', 'Kapitänin']]) });
  return Object.assign(base, { title: 'Titel', summary: '', thumb: '', art: '', contentRating: '', duration: 0, rating: 0, studio: '', network: '' });
}

/* Entdecken: Helfer-Attrappe (nur Seeds mit config.helperUrl) – plex.tv-Listen gemischt aus eigenen Titeln (GUID wie byGuid) und
 * fremden. "Gerade beliebt · Serien" enthaelt NUR eigene Serien -> mit Filter "Nur Titel, die du noch nicht hast" die Hinweis-Reihe. */
function helperRoute(p, q) {
  if (p === '/neo-helper') return { name: 'plex-neo-helper', version: 'visual', watchlist: true, discover: true, features: ['watchlist', 'discover', 'details'] };
  if (p === '/watchlist') return { items: [], total: 0 };
  if (p === '/details') return extDetails(q.get('id') || '');
  var m = /^\/discover\/(trending|new|soon)$/.exec(p);
  if (!m) return null;
  var type = q.get('type') === 'show' ? 'show' : 'movie', lib = LIB[type === 'movie' ? 1 : 2], out = [], i;
  var names = { trending: ['Sternenstaub', 'Kalte Spur', 'Das letzte Signal', 'Wellenbrecher', 'Nachtzug', 'Funkstille', 'Grenzland', 'Sommerhitze'],
    new: ['Leuchtfeuer', 'Unter Null', 'Spiegelstadt', 'Die Brücke', 'Tiefsee', 'Rote Linie'], soon: ['Morgenrot', 'Zeitsprung', 'Schattenland', 'Weiße Nächte'] }[m[1]];
  function ext(n, k) { var off = { trending: 0, new: 20, soon: 40 }[m[1]] + (type === 'show' ? 100 : 0) + k; return { guid: sguid(type, 80000 + off), title: n, year: 2026, summary: 'Synthetischer plex.tv-Titel, der nicht auf dem Server liegt.', thumb: 'https://images.example/disc' + off }; }
  function own(x) { return { guid: sguid(type, x.ratingKey), title: x.title, year: x.year, summary: '', thumb: 'https://images.example/own' + x.ratingKey }; }
  if (m[1] === 'trending' && type === 'show') { for (i = 0; i < 5; i++) out.push(own(lib[i])); }       // alles schon da -> Hinweis
  else if (m[1] === 'trending') { for (i = 0; i < names.length; i++) { if (i % 2 === 0) out.push(own(lib[i + 3])); out.push(ext(names[i], i)); } }
  else names.forEach(function (n, k) { out.push(ext(n, k)); });
  return { items: out.slice(0, Number(q.get('size')) || 20) };
}

/* Entdecken: Inspiration – Server-Hubs fuer Film- (1) und Serienbibliothek (2), nur bei count=20 (Startseite/Katalog bleiben unveraendert) */
function inspHubs(lib) {
  function h(id, ctx, type, list) { return { hubIdentifier: id, context: 'hub.' + ctx, type: type, title: id, size: list.length, Metadata: list }; }
  var L = LIB[lib] || [];
  if (lib === '1') return { MediaContainer: { size: 2, Hub: [h('movie.topunwatched.1', 'movie.topunwatched', 'movie', L.slice(2, 12)), h('movie.recentlyreleased.1', 'movie.recentlyreleased', 'movie', L.slice(8, 16))] } };
  return { MediaContainer: { size: 3, Hub: [h('tv.startwatching.2', 'tv.startwatching', 'show', L.slice(4, 10)), h('tv.rediscover.2', 'tv.rediscover', 'show', L.slice(0, 3)),
    h('tv.toprated.2', 'tv.toprated', 'show', L.slice(1, 8))] } };
}

/* ---------- Mock-Server ---------- */
function syn(f) { return JSON.parse(fs.readFileSync(path.join(SYN, f), 'utf8')); }
function colorFor(s) { if (s.indexOf('/hell') >= 0) return [244, 244, 242];   // sehr helles Foto (F24)
  var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return [60 + h % 140, 60 + (h >> 8) % 140, 60 + (h >> 16) % 140]; }
/* Hintergrund in Bibliotheken (nur Seeds amb*): UltraBlurColors je Titel wie am PMS 1.43 (kommt mit /library/sections/<id>/all);
 * schwierigste Faelle vorn: erster Titel fast weiss (Farben + sehr helle Art /a/hell…), zweiter knallbunt */
var UB_HARD = [['f4f1e8', 'fffef5', 'e8e4d8', 'f9f6ee'], ['ff2d6e', 'ffd400', '00e5ff', '7cff00']];
function hex6(c) { return c.map(function (v) { return ('0' + Math.round(v * 0.6).toString(16)).slice(-2); }).join(''); }
/* Pause-Schoner (Seeds svPicPause*): Bilder des pausierten Titels als PMS-Pfade (Standbild-Pruefung ueber /arts), Plakate als /t/… */
function pauseData(o) {
  if (!/^svPicPause/.test(curSeed) || !o || !o.MediaContainer || !o.MediaContainer.Metadata) return o;
  var x = JSON.parse(JSON.stringify(o));
  x.MediaContainer.Metadata.forEach(function (m) {
    if (m.art) m.art = '/library/metadata/' + m.ratingKey + '/art/1';
    if (m.grandparentArt) m.grandparentArt = '/library/metadata/' + (m.grandparentRatingKey || m.ratingKey) + '/art/1';
    if (m.thumb) m.thumb = '/t/p' + m.ratingKey;
    if (m.grandparentThumb) m.grandparentThumb = '/t/g' + (m.grandparentRatingKey || m.ratingKey);
  });
  return x;
}
function ambData(o, p) {
  if (!/^amb/.test(curSeed) || !/^\/library\/(sections|collections)\//.test(p) || !o || !o.MediaContainer || !o.MediaContainer.Metadata) return o;
  var x = JSON.parse(JSON.stringify(o)), off = Number(x.MediaContainer.offset) || 0;
  x.MediaContainer.Metadata.forEach(function (m, k) {
    if (!m.ratingKey) return;
    var c = UB_HARD[off + k] || ['tl', 'tr', 'br', 'bl'].map(function (e) { return hex6(colorFor('/ub/' + e + m.ratingKey)); });
    m.UltraBlurColors = { topLeft: c[0], topRight: c[1], bottomRight: c[2], bottomLeft: c[3] };
    if (off + k === 0 && m.art) m.art = '/a/hell' + m.ratingKey;
  });
  return x;
}
/* PMS /photo/:/transcode opacity=<%>&background=<hex>: Bild ueber der Farbe abgedunkelt (am PMS 27.10. geprueft) */
function darken(rgb, q) {
  var op = Number(q.get('opacity')), bg = /^[0-9a-f]{6}$/i.test(q.get('background') || '') ? q.get('background') : '000000';
  if (!(op > 0 && op < 100)) return rgb;
  var b = [0, 2, 4].map(function (i) { return parseInt(bg.slice(i, i + 2), 16); });
  return rgb.map(function (v, i) { return Math.round(v * op / 100 + b[i] * (1 - op / 100)); });
}
/* F25: Seitenleiste mit langen Bibliotheksnamen (nur Szenen mit Seed longLib*) */
var curSeed = '';
function longSections() {
  var s = syn('sections.json');
  s.MediaContainer.Directory.push({ key: '4', type: 'artist', title: 'Hörbücher & Hörspiele', agent: 'tv.plex.agents.music', hidden: 0 });
  s.MediaContainer.Directory[4].title = 'Dokumentationen, Reportagen und Naturfilme';
  return s;
}
/* Weitere Server: freigegebener Server eines Freundes als zweiter Mock auf eigenem Port (setup.json erlaubt dort keine Pfade) */
var FRIEND_MID = 'friend-machine-0001', friendPort = 0;
function friendSections() {
  return { MediaContainer: { size: 2, Directory: [{ key: '1', type: 'movie', title: 'Kino', hidden: 0 }, { key: '2', type: 'show', title: 'Serienabend', hidden: 0 }] } };
}
function startServer(cb) {
  var sink = { on: null };                                   // tools/bench.js: Protokollzeilen der Vorschau (&logurl=)
  var srv = http.createServer(handle), fsrv = http.createServer(function (req, res) { req.url = '/friend' + req.url; handle(req, res); });
  function handle(req, res) {
    var u = new URL(req.url, 'http://x'), p = u.pathname;
    function cors() { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', '*'); res.setHeader('Access-Control-Allow-Methods', '*'); }
    function json(o, code) { o = pauseData(ambData(o, p)); cors(); res.writeHead(code || 200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); }
    if (req.method === 'OPTIONS') { cors(); res.writeHead(200); return res.end(); }
    if (p === '/log' && req.method === 'POST') {
      var body = ''; req.on('data', function (c) { body += c; });
      return req.on('end', function () { cors(); res.writeHead(200); res.end(); if (sink.on) body.split('\n').forEach(function (l) { if (l) sink.on(l); }); });
    }
    if (p === '/layout' && req.method === 'POST') {             // Layout-Pruefung (tools/layout_probe.js) je Szene
      var lb = ''; req.on('data', function (c) { lb += c; });
      return req.on('end', function () { cors(); res.writeHead(200); res.end(); try { layoutRes[u.searchParams.get('scene')] = JSON.parse(lb); } catch (e) { layoutRes[u.searchParams.get('scene')] = { err: 'JSON: ' + e.message }; } });
    }
    if (p === '/sleep') return setTimeout(function () { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(solidPng(1, 1, [0, 0, 0])); }, Number(u.searchParams.get('ms') || 3000));
    if (p.indexOf('/seed/') === 0) { curSeed = p.slice(6, -3); res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(seeds[curSeed] || ''); }
    if (p === '/tv/') {                                     // plex.tv-Proxy
      var t = new URL(u.searchParams.get('url'));
      if (t.pathname === '/api/v2/pins' && req.method === 'POST') return json({ id: 1, code: 'A7K2', expiresIn: 900 }, 201);
      if (t.pathname.indexOf('/api/v2/pins/') === 0) return json({ id: 1, authToken: null });
      if (/\/switch$/.test(t.pathname)) return t.searchParams.get('pin') === '1234' ? json({ authToken: 'u' }, 201) : json({}, 403);
      return json({}, 404);
    }
    var hr = helperRoute(p, u.searchParams);                     // Helfer-Attrappe (Entdecken: plex.tv-Reihen)
    if (hr) return json(hr);
    var empty = p.indexOf('/leer') === 0, friend = p.indexOf('/friend') === 0;   // Server ohne Inhalte (Leerzustand) / Server des Freundes
    if (!empty && !friend && p.indexOf('/pms') !== 0) { res.writeHead(404); return res.end(); }
    p = p.slice(empty ? 5 : friend ? 7 : 4);
    if (friend && p === '/identity') return json({ MediaContainer: { machineIdentifier: FRIEND_MID } });
    if (friend && p === '/library/sections') return json(friendSections());
    if (friend && curSeed === 'pkgSrvMetaFail' && /^\/library\/metadata\/\d+$/.test(p)) return json({}, 500);   // Detailanfrage scheitert (TV-Test 1.0.4)
    if (empty && p !== '/photo/:/transcode') return json({ MediaContainer: { size: 0 } });
    if (p === '/photo/:/transcode') {
      var w = Math.min(1280, Number(u.searchParams.get('width')) || 100), h = Math.min(720, Number(u.searchParams.get('height')) || 100);
      var src = u.searchParams.get('url') || '';
      // SAV-5 (Seeds svPic*): Poster als buntes Bild im Plakat-Format 2:3 (unscharf: wie am PMS abgedunkelt) – kein zweifarbiges
      // Ersatzbild, dessen harte Mittelkante im Schoner wie ein Fehler aussieht; Hintergrundbilder: ungerade rk = Standbild (unruhig), gerade = echt
      if (/^svPic/.test(curSeed) && /^\/t\//.test(src)) { cors(); res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(gradPng(w, Math.round(w * 1.5), function (c) { return darken(c, u.searchParams); })); }
      if (u.searchParams.get('blur') && w >= 640 && !/\/a\/|\/art\//.test(src)) { cors(); res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(posterPng(w, darken(colorFor(src), u.searchParams))); }
      var pa0 = /^svPic/.test(curSeed) && /^\/library\/metadata\/(\d+)\/art\//.exec(src);
      if (pa0 && /^svPicPause/.test(curSeed)) { cors(); res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(/Still/.test(curSeed) ? busyPng(w, h) : gradPng(w, h, function (c) { return darken(c, u.searchParams); })); }
      if (pa0) { cors(); res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(Number(pa0[1]) % 2 ? busyPng(w, h) : gradPng(w, h, function (c) { return darken(c, u.searchParams); })); }
      var sv = /^sv[A-Z]/.test(curSeed) && /^\/a\//.test(src);   // Bildschirmschoner-Szenen: helles, dunkles, unruhiges Bild
      if (curSeed === 'ambCorner' && /^\/a\//.test(src)) { cors(); res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(gradPng(w, h, function (c) { return darken(c, u.searchParams); })); }
      if (sv && /Color/.test(curSeed)) { cors(); res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(gradPng(w, h)); }   // knallbunt, hell
      if (sv && /Busy/.test(curSeed)) { cors(); res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(busyPng(w, h)); }
      if (sv) { cors(); res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(solidPng(w, h, /Bright/.test(curSeed) ? [246, 246, 244] : [14, 14, 16])); }
      cors(); res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(solidPng(w, h, darken(colorFor(u.searchParams.get('url') || ''), u.searchParams)));
    }
    if (p === '/library/sections') return json(/^longLib/.test(curSeed) ? longSections() : syn('sections.json'));
    if (p === '/hubs/continueWatching/items' && curSeed === 'cwMore') return json(page(cwMany(), u.searchParams));   // HOME-14: mehr als 20 -> "Alle 31 anzeigen"
    if (p === '/hubs/continueWatching/items') return json(noArt(withVersions(syn('continueWatching.json'))));
    if (p === '/library/onDeck') return json(syn('onDeck.json'));
    if (/^\/hubs\/sections\/[12]$/.test(p) && u.searchParams.get('count') === '20') return json(inspHubs(p.slice(-1)));   // Entdecken: Inspiration (count=20)
    if (p === '/hubs/sections/1') return json(syn('hubs-1.json'));          // Server-Hubs (Startseite anpassen)
    if (p === '/hubs') return json({ MediaContainer: { size: 1, Hub: [{ hubIdentifier: 'home.playlists', type: 'playlist', title: 'Zuletzt genutzte Playlists', size: 0 }] } });
    if (p === '/hubs/home/recentlyAdded') { var f = 'recent-' + u.searchParams.get('sectionID') + '.json'; return json(fs.existsSync(path.join(SYN, f)) ? syn(f) : { MediaContainer: { size: 0 } }); }
    if (p === '/video/:/transcode/universal/decision') return json(syn(/^trickHls/.test(curSeed) ? 'decision-hevc.json' : 'decision-direct.json'));
    if (p === '/playQueues' && req.method === 'POST') return json(playQueue((u.searchParams.get('key') || new URL(u.searchParams.get('uri').replace('server://', 'http://')).pathname).split('/').pop()));   // wie der PMS: key = gewaehlte Folge (uri = Serie)
    var mr = musicRoute(p, u.searchParams);
    if (mr) return json(mr);
    if (p === '/music/:/transcode/universal/decision') return json(syn('decision-direct.json'));
    var ls = /^\/library\/sections\/(\d+)\/(all|firstCharacter|collections|genre|decade|resolution|collection)$/.exec(p);
    if (ls && LIB[ls[1]]) {
      var q = u.searchParams;
      if (ls[2] === 'all') {                 // wie der echte PMS: librarySectionID nur am Container, nicht je Eintrag
        var pa = page(libAll(ls[1], q), q);
        pa.MediaContainer.librarySectionID = Number(ls[1]);
        pa.MediaContainer.Metadata = pa.MediaContainer.Metadata.map(function (m) { var c = JSON.parse(JSON.stringify(m)); delete c.librarySectionID; return c; });
        if (/^sv[A-Z].*Long/.test(curSeed)) pa.MediaContainer.Metadata.forEach(function (m) { m.title = 'Die unglaublich lange Reise des kleinen Leuchtturmwärters ' + m.title + ' bis ans Ende der Welt'; });
        if (/^svPic/.test(curSeed)) pa.MediaContainer.Metadata.forEach(function (m) { if (m.art) m.art = '/library/metadata/' + m.ratingKey + '/art/1'; });   // SAV-5: PMS-Pfade
        if (q.get('addedAt>>') !== null) return json(newsItems(ls[1], q));   // HOME-13: neu seit dem gemerkten Stand
        return json(pa);
      }
      if (ls[2] === 'firstCharacter') return json(firstChars(libAll(ls[1], q)));
      if (ls[2] === 'collections') return json(page(ls[1] === '1' ? [{ ratingKey: '7701', type: 'collection', title: 'Bergfilme', thumb: '/t/c1', childCount: 6 }, { ratingKey: '7702', type: 'collection', title: 'Klassiker', thumb: '/t/c2', childCount: 4 }] : [], q));
      if (ls[2] === 'genre' && !q.get('type')) return json({ MediaContainer: { size: 1, Directory: [ls[1] === '1' ? { key: '143', title: 'Abenteuer' } : { key: '5', title: 'Drama' }] } });   // Inspiration: ein Genre -> Bild unabhaengig vom Tag
      if (ls[2] === 'genre') return json({ MediaContainer: { size: 3, Directory: [{ key: '143', title: 'Abenteuer' }, { key: '5', title: 'Drama' }, { key: '7', title: 'Komödie' }] } });
      if (ls[2] === 'decade') return json({ MediaContainer: { size: 2, Directory: [{ key: '2010', title: '2010s' }, { key: '2000', title: '2000s' }] } });
      return json({ MediaContainer: { size: 1, Directory: [{ key: '1080', title: '1080p' }] } });
    }
    if (/^\/library\/collections\/\d+\/children$/.test(p)) return json(page(LIB[1].slice(0, 6), u.searchParams));
    var arm = /^\/library\/metadata\/(\d+)\/arts$/.exec(p);   // SAV-5: Bildauswahl wie am PMS – ungerade rk: Standbild (media://) ausgewaehlt
    if (arm && /^svPicPause/.test(curSeed)) return json({ MediaContainer: { size: 1, Metadata: [{ ratingKey: /Still/.test(curSeed) ? 'media://1/ab.bundle/Contents/Art/art1.jpg' : 'metadata://art/tv.plex.agents.movie_ab', selected: true }] } });
    if (arm) return json({ MediaContainer: { size: 2, Metadata: [{ ratingKey: 'https://image.example.org/a.jpg', selected: false, provider: 'tmdb' },
      { ratingKey: Number(arm[1]) % 2 ? 'media://1/ab.bundle/Contents/Art/art1.jpg' : 'metadata://art/tv.plex.agents.movie_ab', selected: true }] } });
    if (p === '/hubs/search') return json(search(u.searchParams.get('query')));
    if (/^\/library\/metadata\/\d+\/matches$/.test(p)) return setTimeout(function () { json(matchesFor(u.searchParams)); }, 300);   // P4 (echter PMS: 2,5-5 s)
    if (p === '/library/all' && u.searchParams.get('guid')) return json(byGuid(u.searchParams.get('guid')));
    var lm = /^\/library\/metadata\/(\d+)(\/children)?$/.exec(p), lx = lm && findLib(lm[1]);
    if (lx) return json(lm[2] ? seasonsOf(lx) : libMeta(lx));
    if (lm && lm[2] && Number(lm[1]) >= 5100 && Number(lm[1]) < 5400) return json(seasonEps(lm[1], u.searchParams));
    var mm = /^\/library\/metadata\/(\d+)$/.exec(p);
    if (mm) return json(metaFor(mm[1]));
    var m = /^\/library\/metadata\/(\d+)\/children$/.exec(p);
    if (m) { var eps = []; for (var i = 1; i <= 12; i++) eps.push({ ratingKey: String(5000 + i), type: 'episode', index: i, viewCount: i < 3 ? 1 : 0, viewOffset: i === 3 ? 600000 : 0, duration: 1440000 }); return json({ MediaContainer: { size: 12, totalSize: 12, Metadata: eps } }); }
    if (/^\/(:\/|actions)/.test(p)) return json({});
    return json({ MediaContainer: { size: 0 } });
  }
  srv.listen(0, '127.0.0.1', function () {
    fsrv.listen(0, '127.0.0.1', function () {
      friendPort = fsrv.address().port;
      var close0 = srv.close;
      srv.close = function (f) { fsrv.close(); return close0.call(srv, f); };
      cb(srv, srv.address().port, sink);
    });
  });
}

/* Player: Metadaten aus den synthetischen Karten + Spuren aus meta-anime.json; Marker je Szene (rk 1001 Intro um die
 * Fortsetzen-Stelle -> Skip-Button, 1101 finaler Abspann -> Countdown), Film 2001 mit Vorschaubildern (indexes=sd) */
/* HOME-14: 31 angefangene Titel (Seed cwMore) – die 4 synthetischen Karten, danach erfundene Folgen mit eigenem ratingKey */
function cwMany() {
  var base = noArt(syn('continueWatching.json')).MediaContainer.Metadata, out = base.slice();
  for (var i = out.length; i < 31; i++) {
    var c = JSON.parse(JSON.stringify(base[i % base.length]));
    c.ratingKey = String(8000 + i); c.title = 'Folge ' + (i + 1); c.index = i + 1; c.viewOffset = 300000 + i * 20000;
    out.push(c);
  }
  return out;
}
function cardMeta(rk) {
  var all = syn('continueWatching.json').MediaContainer.Metadata.concat(syn('onDeck.json').MediaContainer.Metadata);
  for (var i = 0; i < all.length; i++) if (all[i].ratingKey === rk) return JSON.parse(JSON.stringify(all[i]));
  return { ratingKey: rk, type: 'episode', title: 'Folge ' + rk, grandparentTitle: 'Wolkenreiter', parentIndex: 1, index: 2, duration: 1500000, thumb: '/t/' + rk };
}
function metaFor(rk) {
  var m = cardMeta(rk), src = syn('meta-anime.json').MediaContainer.Metadata[0];
  m.Media = JSON.parse(JSON.stringify(src.Media));
  m.Media[0].Part[0].duration = m.duration; m.Media[0].Part[0].id = Number(rk);
  if (rk === '2001') {
    m.Media[0].Part[0].indexes = 'sd'; m.Media[0].Part[0].size = 4240000000; m.Media[0].videoResolution = '1080'; m.Media[0].bitrate = 9000;
    m.Media.push({ id: 25490, width: 3840, height: 2160, videoResolution: '4k', videoCodec: 'hevc', audioCodec: 'eac3', container: 'mkv', bitrate: 40000,
      Part: [{ id: 2002001, size: 25000000000, duration: m.duration, Stream: [{ id: 72400, streamType: 1, codec: 'hevc', bitDepth: 10 }] }] });
    m.Media[0].Part[0].Stream.splice(3, 0, { id: 72310, streamType: 2, codec: 'eac3', channels: 6, audioChannelLayout: '5.1(side)', languageCode: 'fre', language: 'French',
      extendedDisplayTitle: 'French (Französisch EAC3 5.1)' }, { id: 72311, streamType: 2, codec: 'ac3', channels: 2, languageCode: 'ger', title: 'Audiodeskription', visualImpaired: true });
  }
  m.Marker = rk === '1001' ? [{ type: 'intro', startTimeOffset: 590000, endTimeOffset: 680000 }]
    : rk === '1101' ? [{ type: 'credits', startTimeOffset: 280000, endTimeOffset: 1500000, 'final': true }]
    : rk === '1201' ? [{ type: 'credits', startTimeOffset: 0, endTimeOffset: 700000, 'final': true }] : [];   // 1201 = letzte Folge
  if (rk === '2001') m.Chapter = [{ tag: 'Ankunft', index: 1, startTimeOffset: 0, endTimeOffset: 900000 }, { tag: 'Der Aufstieg', index: 2, startTimeOffset: 900000, endTimeOffset: 2400000 },
    { tag: 'Sturm am Grat', index: 3, startTimeOffset: 2400000, endTimeOffset: 4000000 }, { tag: 'Chapter 4', index: 4, startTimeOffset: 4000000, endTimeOffset: 7200000 }];
  if (rk === '2001') m.Chapter.forEach(function (c) { c.thumb = '/library/media/25489/chapterImages/' + c.index; });   // Kapitelbilder
  if (/Long/.test(curSeed)) {                          // TV-Befund 27.10. nachmittags: lange Titel/Kapitelnamen im OSD
    m.title = 'The Extraordinarily Long Journey Across the Silent Mountain of Forgotten Kings';
    if (m.Chapter) m.Chapter[2].tag = 'The Storm on the Ridge Above the Valley of Endless Echoes';
  }
  return { MediaContainer: { size: 1, Metadata: [m] } };
}
/* HOME-13: neue Titel seit dem gemerkten Stand (nur news*-Seeds; sonst wie ein PMS ohne Neues) – Demo-Titel */
function newsItems(lib, q) {
  var l = [], at = Number(q.get('addedAt>>')) + 50;
  function epi(rk, show, s, e) { return { ratingKey: String(rk), type: 'episode', title: 'Folge ' + e, grandparentTitle: show, grandparentRatingKey: show === 'Wolkenreiter' ? '901' : '902', parentIndex: s, index: e, addedAt: at++ }; }
  if (!/^news/.test(curSeed)) return { MediaContainer: { size: 0, totalSize: 0 } };
  if (lib === '2' && curSeed === 'newsMixed') l = [epi(9701, 'Wolkenreiter', 2, 5), epi(9702, 'Wolkenreiter', 2, 6), epi(9703, 'Sternenfahrer', 1, 4)];
  else if (lib === '2') l = [epi(9701, 'Wolkenreiter', 2, 5)];
  if (lib === '1' && curSeed === 'newsLongEn') l = [{ ratingKey: '9801', type: 'movie', title: 'The Extraordinarily Long Journey Across the Silent Mountain of Forgotten Kings', addedAt: at++ }];
  else if (lib === '1') l = [{ ratingKey: '9801', type: 'movie', title: 'Abendrot im Winter', addedAt: at++ }, { ratingKey: '9802', type: 'movie', title: 'Der stille Berg', addedAt: at++ }];
  return { MediaContainer: { size: l.length, totalSize: l.length, Metadata: l } };
}
/* TV-Befund 27.10. nachmittags: erster Titel (Hero) ohne Art (z. B. gerade hinzugefuegt) -> Seeds noart* */
function noArt(j) {
  if (/^noart/.test(curSeed)) { var m = j.MediaContainer.Metadata[0]; delete m.art; delete m.grandparentArt; }
  return j;
}
/* Film 2001 hat zwei Dateien (1080p H.264 + 4K HEVC) -> "Version wählen" */
function withVersions(j) {
  j.MediaContainer.Metadata.forEach(function (m) { if (m.ratingKey === '2001') m.Media = [{ id: 1 }, { id: 2 }]; });
  return j;
}
function playQueue(rk) {
  var a = cardMeta(rk), b = cardMeta(String(Number(rk) + 1));
  a.playQueueItemID = 1; b.playQueueItemID = 2; b.title = 'Gegenwind'; b.index = (a.index || 1) + 1;
  if (rk === '1201') return { MediaContainer: { playQueueID: 8, playQueueSelectedItemID: 1, Metadata: [a] } };   // letzte Folge der Serie
  return { MediaContainer: { playQueueID: 7, playQueueSelectedItemID: 1, Metadata: [a, b] } };
}

/* ---------- Szenarien ---------- */
var seeds = {};
function makeSeeds(port) {
  var base = 'http://127.0.0.1:' + port;
  function st(o) {
    var s = { v: 1, clientId: 'visual', account: { token: 'ACC', uuid: 'aaaa1111', name: 'Alex' }, server: { uri: base + '/pms', machineId: 'mid', name: 'Testserver', token: 'T' },
      users: [{ id: 11, uuid: 'aaaa1111', name: 'Alex', thumb: '', admin: true, restricted: false, pin: false, kind: 'main' }], usersTs: Date.now(), profiles: { aaaa1111: { serverToken: 'T' } },
      lastProfile: 'aaaa1111', lang: 'de', pinSwitch: null, protectRemindAt: 0, firstPicker: false, pointer: true };
    for (var k in o || {}) s[k] = o[k];
    return s;
  }
  var cfg = JSON.stringify({ readOnly: true, proxyHost: '127.0.0.1:' + port + '/tv', cursor: 'system', fixedClock: '21:34', welcome: false });
  function seed(o, extra, c) {
    var files = { 'state.json': JSON.stringify(st(o)), 'config.json': c || cfg };
    for (var k in extra || {}) files[k] = JSON.stringify(extra[k]);
    return 'window.PN_SEED=' + JSON.stringify(files) + ';';
  }
  var multi = [{ id: 11, uuid: 'aaaa1111', name: 'Alex', thumb: '', admin: true, restricted: false, pin: true, kind: 'main' },
    { id: 12, uuid: 'bbbb2222', name: 'Kim', thumb: '', admin: false, restricted: true, pin: false, kind: 'kid' },
    { id: 13, uuid: 'cccc3333', name: 'Robin', thumb: '', admin: false, restricted: true, pin: true, kind: 'teen' }];
  seeds.home = seed(); seeds.en = seed({ lang: 'en' }); seeds.login = seed({ account: null });
  seeds.longLib = seed(); seeds.longLibEn = seed({ lang: 'en' });   // F25: lange Bibliotheksnamen
  seeds.multi = seed({ users: multi, lastProfile: 'bbbb2222', pinSwitch: false });
  // Startseite angepasst: Server-Hub zuerst, Weiterschauen aus
  seeds.custom = seed({}, { 'settings-aaaa1111.json': { homeRows: [{ id: 'hub-1-movie.recentlyreleased', on: true }, { id: 'cw', on: false }] } });
  seeds.cwMore = seed();                                  // HOME-14: Weiterschauen mit 31 Titeln (Mock liefert totalSize)
  // W1 Seitenleiste angepasst: Serien zuerst, Suche und Dokus ausgeblendet
  seeds.railCustom = seed({}, { 'settings-aaaa1111.json': { railItems: [{ id: 'lib-2', on: true }, { id: 'home', on: true }, { id: 'search', on: false }, { id: 'lib-6', on: false }] } });
  // Inspiration anpassen: Hub-Katalog (frisch) mit den Familien der Inspirations-Reihen -> volle Liste ohne Katalog-Abfrage
  seeds.insp = seed({}, { 'cache-hubs-aaaa1111.json': { v: 1, lang: 'de', ts: Date.now(), pl: null,
    alibs: [{ id: 1, title: 'Filme', type: 'movie', kind: 'movie' }, { id: 2, title: 'Serien', type: 'show', kind: 'show' }],
    hubs: [['1', 'movie.topunwatched'], ['1', 'movie.recentlyreleased'], ['2', 'tv.startwatching'], ['2', 'tv.rediscover'], ['2', 'tv.toprated']].map(function (h) {
      return { id: 'hub-' + h[0] + '-' + h[1], lib: Number(h[0]), type: h[1], fam: h[1], title: h[1], it: h[0] === '1' ? 'movie' : 'show' }; }) } });
  // Player: stehendes Bild (Faelschung ohne Zeitfortschritt), Sammel-Sprung wartet (Anzeige "+0:30 → …" bleibt fuer das Foto)
  var cfgPlay = JSON.stringify({ readOnly: true, proxyHost: '127.0.0.1:' + port + '/tv', cursor: 'system', sefFake: 'still', seekDelay: 600000, fixedClock: '21:34', welcome: false });
  seeds.play = seed({}, null, cfgPlay);
  seeds.playsub = seed({}, { 'settings-aaaa1111.json': { ass: 'text' } }, cfgPlay);
  seeds.playEn = seed({ lang: 'en' }, null, cfgPlay);
  seeds.bookPlay = seed({}, null, cfgPlay); seeds.bookPlayEn = seed({ lang: 'en' }, null, cfgPlay);   // Jetzt laeuft als Hoerbuch (Kapitel = Titel)
  seeds.playAsym = seed({}, { 'settings-aaaa1111.json': { seekArrows: '10/30', seekFf: '15/30' } }, cfgPlay);   // -10/+30 auf den Knoepfen
  // Schnellspulen (SPEC PLAY-32): Einstellung "Schnell spulen"; trickHls: der Server wandelt um (decision-hevc) -> Spruenge + Hinweis
  seeds.playTrick = seed({}, { 'settings-aaaa1111.json': { ffrw: 'trick' } }, cfgPlay);
  seeds.playTrickEn = seed({ lang: 'en', accent: 'violet' }, { 'settings-aaaa1111.json': { ffrw: 'trick', accent: 'violet' } }, cfgPlay);
  seeds.trickHls = seed({}, { 'settings-aaaa1111.json': { ffrw: 'trick' } }, cfgPlay);
  seeds.trickHlsEn = seed({ lang: 'en' }, { 'settings-aaaa1111.json': { ffrw: 'trick' } }, cfgPlay);
  // Zeiger-Randzone: Verweilen loest nie aus (ptrEdgeDwell) -> stehende Anzeige-Pille; Zeiger aus -> abhaengige Einstellung grau
  seeds.ptrHold = seed({}, null, JSON.stringify({ readOnly: true, proxyHost: '127.0.0.1:' + port + '/tv', cursor: 'system', fixedClock: '21:34', welcome: false, ptrEdgeDwell: 600000 }));
  seeds.ptrHoldPlay = seed({}, null, JSON.stringify({ readOnly: true, proxyHost: '127.0.0.1:' + port + '/tv', cursor: 'system', sefFake: 'still', seekDelay: 600000, fixedClock: '21:34', welcome: false, ptrEdgeDwell: 600000 }));
  seeds.ptrOff = seed({ pointer: false });
  // Nutzer-Feedback 28.10. "Zuletzt gesucht" (Chips in 2 Zeilen, Rot entfernt, Verlauf loeschen, Einstellung Aus/4/8, Standard 8); erfundene Begriffe.
  // REC8: 8 normal lange Begriffe fuellen die 2 Zeilen (mit "Verlauf loeschen"); RECL: 8 Begriffe mit sehr langen -> aelteste ausgeblendet
  var REC8 = ['Nordlicht', 'Bergklang', 'Krimi', 'Hafenlichter', 'Aurora Weiss', 'Sterne', 'Winterreise', 'Leuchtfeuer'];
  var RECL = ['The Extraordinarily Long Journey Across the Silent Mountain', 'Frost & Fire', 'A very long documentary about whales and the deep blue sea', 'Echo', 'Glass beads', 'Harbour lights', 'Silver lake', 'Moonrise'];
  var cfgHold = JSON.stringify({ readOnly: true, proxyHost: '127.0.0.1:' + port + '/tv', cursor: 'system', fixedClock: '21:34', welcome: false, ptrEdgeDwell: 600000 });
  seeds.recent8 = seed({}, { 'search-aaaa1111.json': { q: REC8 }, 'disc-aaaa1111.json': { q: REC8.slice(0, 5) } });
  seeds.recent8En = seed({ lang: 'en' }, { 'search-aaaa1111.json': { q: ['Northern lights', 'Mountain song', 'Crime', 'Harbour lights', 'Aurora', 'Stars', 'Winter trip', 'Beacon'] } });
  seeds.recent4 = seed({}, { 'search-aaaa1111.json': { q: REC8 }, 'settings-aaaa1111.json': { recentSearches: 3 } });   // fruehere Stufe 3 -> 4 (Migration)
  seeds.recentLongEn = seed({ lang: 'en' }, { 'search-aaaa1111.json': { q: RECL } });
  seeds.recentPtr = seed({}, { 'search-aaaa1111.json': { q: REC8 } }, cfgHold);
  seeds.ptrEdgeOff = seed({ ptrEdge: false }, null, JSON.stringify({ readOnly: true, proxyHost: '127.0.0.1:' + port + '/tv', cursor: 'system', fixedClock: '21:34', welcome: false, ptrEdgeDwell: 600000 }));   // "Zeiger blaettert am Rand weiter" aus
  // Feinauswahl am Balken (SPEC PLAY-30): Einstellung an, Zeiger-Verweilen echt (700 ms), heller "Film" (fakeBg) und Vorschaubilder aus
  // sub: feste Untertitel-Zeile (config.fakeSub, nur Bildtest) – Kollision Lasche/Untertitel sichtbar machen
  var cfgLp = function (bg, sub) { return JSON.stringify({ readOnly: true, proxyHost: '127.0.0.1:' + port + '/tv', cursor: 'system', sefFake: 'still', seekDelay: 600000, fixedClock: '21:34', welcome: false, ptrEdgeDwell: 600000, fakeBg: bg || undefined, fakeSub: sub || undefined }); };
  var SUB_DE = 'Wir müssen los, bevor der Sturm kommt.', SUB_EN = 'We have to go before the storm hits.';
  // Darstellungen der Feinauswahl (SPEC PLAY-31): A panel, B stretch, D film (mit/ohne Vorschaubilder), de/en, dunkel/hell, Untertitel
  [['lpA', 'panel', {}, null, SUB_DE, {}], ['lpAEn', 'panel', { accent: 'violet' }, '#E4DCC8', SUB_EN, { lang: 'en', accent: 'violet' }],
    ['lpB', 'stretch', {}, null, SUB_DE, {}], ['lpBEn', 'stretch', { thumbs: false }, '#E4DCC8', SUB_EN, { lang: 'en', loupeHints: 3 }],
    ['lpD', 'film', {}, null, SUB_DE, {}], ['lpDEn', 'film', { accent: 'violet' }, '#E4DCC8', SUB_EN, { lang: 'en', accent: 'violet' }],
    ['lpDNo', 'film', { thumbs: false }, '#E4DCC8', SUB_DE, { loupeHints: 3 }]].forEach(function (d) {
    var x = { ptrLoupe: true, loupeStyle: d[1] }; for (var k in d[2]) x[k] = d[2][k];
    seeds[d[0]] = seed(d[5], { 'settings-aaaa1111.json': x }, cfgLp(d[3], d[4]));
  });
  seeds.lpStyleOn = seed({}, { 'settings-aaaa1111.json': { ptrLoupe: true, loupeStyle: 'film' } });
  seeds.loupe = seed({}, { 'settings-aaaa1111.json': { ptrLoupe: true } }, cfgLp());
  seeds.loupeSeen = seed({ loupeHints: 3 }, { 'settings-aaaa1111.json': { ptrLoupe: true, thumbs: false } }, cfgLp('#E4DCC8'));     // 4. Mal: Titel statt Hinweis; ohne Vorschaubilder; helles Bild
  seeds.loupeSeenEn = seed({ loupeHints: 3, lang: 'en' }, { 'settings-aaaa1111.json': { ptrLoupe: true } }, cfgLp('#E4DCC8'));
  seeds.bookLoupe = seed({}, { 'settings-aaaa1111.json': { ptrLoupe: true } }, cfgLp());   // Hoerbuch mit 45-Min.-Dateien
  seeds.bookLoupeEn = seed({ lang: 'en' }, { 'settings-aaaa1111.json': { ptrLoupe: true } }, cfgLp());
  seeds.musicLoupe = seed({}, { 'settings-aaaa1111.json': { ptrLoupe: true } }, cfgLp());   // kurze Musiktitel: nur die Zeit-Blase, keine Feinauswahl
  seeds.ptrOffEn = seed({ pointer: false, lang: 'en' });
  seeds.ptrEn = seed({ lang: 'en' });
  seeds.playEnLong = seed({ lang: 'en', accent: 'violet' }, { 'settings-aaaa1111.json': { accent: 'violet' } }, cfgPlay);   // eingebettete UT als Text -> Mehr zeigt "Untertitel-Darstellung"
  // P2: PMS-only (setup.json im Paket, preview.html: window.PN_SETUP) + App-PIN (pins.json, gleiche PBKDF2-Pruefsumme wie N.appPin)
  var pkgCfg = { schema: 1, kind: 'plexneo-setup', createdAt: '2026-10-26T12:00:00Z', setupVersion: '0.1.0', clientIdentifier: 'plexneo-visual',
    server: { machineIdentifier: 'visual-machine-id', name: 'Testserver', uris: [base + '/pms'] },
    profiles: [{ id: 11, uuid: 'aaaa1111', title: 'Alex', thumb: '', kind: 'owner', restricted: false, restrictionProfile: '', token: 'T-owner-1' },
      { id: 12, uuid: 'bbbb2222', title: 'Kim', thumb: '', kind: 'home', restricted: true, restrictionProfile: 'little_kid', token: 'T-kim-12' },
      { id: 13, uuid: 'cccc3333', title: 'Robin', thumb: '', kind: 'home', restricted: true, restrictionProfile: 'teen', token: 'T-robin-13' }], computer: null };
  var pinSalt = '00112233445566778899aabbccddeeff';
  var pkgPins = { v: 1, setup: pkgCfg.createdAt + '|' + pkgCfg.server.machineIdentifier,
    p: { bbbb2222: { s: pinSalt, h: require('crypto').pbkdf2Sync('1234', Buffer.from(pinSalt, 'hex'), 1000, 32, 'sha256').toString('hex'), i: 1000 } } };
  seeds.pkg = seed({ account: null, server: null, users: null, profiles: {}, lastProfile: 'aaaa1111', protectRemindAt: 4102444800000, startProfile: 'picker' }, { 'pins.json': pkgPins }) +
    'window.PN_SETUP=' + JSON.stringify(JSON.stringify(pkgCfg)) + ';';
  // Weitere Server: Alex hat Zugang zum Server eines Freundes (zweiter Mock-Port); Variante: Server nicht erreichbar (Bibliotheken aus dem Speicher)
  function pkgWith(uris) {
    var c = JSON.parse(JSON.stringify(pkgCfg));
    c.serversSchema = 1;
    c.profiles[0].servers = [{ machineIdentifier: FRIEND_MID, name: 'Max-NAS', uris: uris, token: 'T-friend-1' }];
    return 'window.PN_SETUP=' + JSON.stringify(JSON.stringify(c)) + ';';
  }
  var pkgState = { account: null, server: null, users: null, profiles: {}, lastProfile: 'aaaa1111', protectRemindAt: 4102444800000, startProfile: 'main' };
  seeds.pkgSrv = seed(pkgState) + pkgWith(['http://127.0.0.1:' + friendPort]);
  seeds.pkgSrvMetaFail = seed(pkgState) + pkgWith(['http://127.0.0.1:' + friendPort]);
  seeds.pkgSrvDown = seed(pkgState, { 'srv-aaaa1111.json': { v: 1, s: { 'friend-machine-0001': { uri: '', ts: 1, libs: [{ id: 1, title: 'Kino', type: 'movie', kind: 'movie' }] } } } }) +
    pkgWith(['http://127.0.0.1:9']);
  // Entdecken mit Helfer (plex.tv-Reihen): Filter "Nur Titel, die du noch nicht hast" an (Standard) / aus; Weitere Server + Helfer
  var cfgHelper = JSON.stringify({ readOnly: true, proxyHost: '127.0.0.1:' + port + '/tv', cursor: 'system', fixedClock: '21:34', welcome: false,
    helperUrl: 'http://127.0.0.1:' + port, helperKey: 'visual-helper-key-0001' });
  seeds.inspNew = seed({}, null, cfgHelper);
  seeds.inspNewEn = seed({ lang: 'en' }, null, cfgHelper);
  seeds.inspNewPtr = seed({}, null, cfgHelper.replace('}', ', "ptrEdgeDwell": 600000}'));   // Zeiger-Szenen mit Helfer: Randzone zeigt nur die Pille
  seeds.inspNewOff = seed({}, { 'settings-aaaa1111.json': { inspHideOwn: false } }, cfgHelper);
  seeds.pkgSrvHelper = seed(pkgState, null, cfgHelper) + pkgWith(['http://127.0.0.1:' + friendPort]);
  seeds.noart = seed();                                                                               // Hero ohne Art: Poster unscharf
  seeds.noartOff = seed({}, { 'settings-aaaa1111.json': { backgrounds: false } });                   // ... Hintergrundbilder aus: einfarbig
  // DET-3 (TV-Befund 28.10.): Felder und Serien-Balken einzeln abschaltbar
  seeds.epOff = seed({}, { 'settings-aaaa1111.json': { episodeProgress: false, seriesProgress: true } });
  seeds.seriesOff = seed({}, { 'settings-aaaa1111.json': { seriesProgress: false } });
  seeds.empty = seed({ server: { uri: base + '/leer', machineId: 'mid', name: 'Leer', token: 'T' } });
  // P5: Willkommenskarte (erster Start des Profils), Bildschirmschoner nach 1,5 s, Spoilerschutz + Uhr aus
  seeds.welcome = seed(null, null, JSON.stringify({ readOnly: true, proxyHost: '127.0.0.1:' + port + '/tv', cursor: 'system', fixedClock: '21:34' }));
  seeds.saver = seed(null, null, JSON.stringify({ readOnly: true, proxyHost: '127.0.0.1:' + port + '/tv', cursor: 'system', fixedClock: '21:34', welcome: false, saverMs: 1500 }));
  seeds.spoiler = seed({}, { 'settings-aaaa1111.json': { spoiler: true, clock: false } });
  // Uhr auf der Startseite (settings.clockStyle) je Stil, de + en; Tastenhinweise "Nur kurz" (nach 1,5 s weg) und "Aus"
  ['box', 'free', 'date', 'small'].forEach(function (cs) {
    seeds['clock_' + cs] = seed({}, { 'settings-aaaa1111.json': { clockStyle: cs } });
    seeds['clock_' + cs + 'En'] = seed({ lang: 'en' }, { 'settings-aaaa1111.json': { clockStyle: cs, backgrounds: false } });   // dunkler Kopf
  });
  var hintCfg = JSON.stringify({ readOnly: true, proxyHost: '127.0.0.1:' + port + '/tv', cursor: 'system', fixedClock: '21:34', welcome: false, hintMs: 1500 });
  seeds.hintsBrief = seed({}, { 'settings-aaaa1111.json': { hints: 'brief' } }, hintCfg);
  seeds.hintsOff = seed({}, { 'settings-aaaa1111.json': { hints: 'off' } });
  // HOME-13 Hinweis bei neuen Inhalten: gemerkter Stand weicht vom Mock ab (Mock-Stand 'u0') -> eine Anfrage "neu seit 100" je Bibliothek
  // (Antwort newsItems), Hinweis bleibt fuer den Screenshot stehen (newsShowMs); hold = fruehestens nach ms (Bibliothek/Player statt Startseite)
  function newsSeed(libs, set, lang, extra) {
    var c = { readOnly: true, proxyHost: '127.0.0.1:' + port + '/tv', cursor: 'system', fixedClock: '21:34', welcome: false, newsShowMs: 600000 };
    for (var k in extra || {}) c[k] = extra[k];
    var l = {}; libs.forEach(function (id) { l[id] = { sig: 'u-1', at: 100 }; });
    return seed(lang ? { lang: lang } : {}, { 'news-aaaa1111.json': { srv: 'mid', libs: l }, 'settings-aaaa1111.json': set || {} }, JSON.stringify(c));
  }
  seeds.newsExact = newsSeed(['2']); seeds.newsExactEn = newsSeed(['2'], null, 'en');
  seeds.newsMixed = newsSeed(['1', '2']); seeds.newsGeneral = newsSeed(['2'], { newsNote: 'general' });
  seeds.newsLongEn = newsSeed(['1'], null, 'en'); seeds.newsLib = newsSeed(['2'], null, null, { newsHoldMs: 4500 });
  seeds.newsPlay = newsSeed(['2'], { newsPlay: true }, null, { sefFake: 'still', seekDelay: 600000, newsHoldMs: 4500, newsSettleMs: 0 });
  seeds.newsPlayOff = newsSeed(['2'], null, null, { sefFake: 'still', seekDelay: 600000, newsHoldMs: 4500, newsSettleMs: 0 });
  // Bildschirmschoner: Einblendung je Stil auf hellem (lange Titel, de), dunklem (lange Titel, en) und unruhigem Bild (de); Quelle Filme
  var svCfg = JSON.stringify({ readOnly: true, proxyHost: '127.0.0.1:' + port + '/tv', cursor: 'system', fixedClock: '21:34', welcome: false, saverMs: 1500 });
  SAVER_STYLES.forEach(function (st) {
    var cap = st.charAt(0).toUpperCase() + st.slice(1), set = { saverInfo: st, saverLibs: [1], saverFx: 'cut' };
    seeds['svBright' + cap + 'Long'] = seed({}, { 'settings-aaaa1111.json': set }, svCfg);
    seeds['svDark' + cap + 'LongEn'] = seed({ lang: 'en' }, { 'settings-aaaa1111.json': set }, svCfg);
    seeds['svBusy' + cap] = seed({}, { 'settings-aaaa1111.json': set }, svCfg);
  });
  // jede Lage der Einblendung (TV-Befund 28.10.: Abdunklung nicht buendig am Rand) – Lage 0 zeigen die Szenen oben
  SAVER_STYLES.forEach(function (st) {
    var cap = st.charAt(0).toUpperCase() + st.slice(1);
    [1, 2, 3].forEach(function (k) {
      seeds['svBusyPos' + cap + k] = seed({}, { 'settings-aaaa1111.json': { saverInfo: st, saverLibs: [1], saverFx: 'cut' } },
        JSON.stringify({ readOnly: true, proxyHost: '127.0.0.1:' + port + '/tv', cursor: 'system', fixedClock: '21:34', welcome: false, saverMs: 1500, saverPos: k }));
    });
  });
  seeds.svBrightNoclockLongEn = seed({ lang: 'en' }, { 'settings-aaaa1111.json': { saverInfo: 'ambient', saverLibs: [1], saverFx: 'cut', clock: false } }, svCfg);
  seeds.svBusyOff = seed({}, { 'settings-aaaa1111.json': { saverInfo: 'off', saverLibs: [1], saverFx: 'cut' } }, svCfg);
  seeds.svDarkFade = seed({}, { 'settings-aaaa1111.json': { saverLibs: [1] } }, svCfg);   // Standard: Ueberblenden + Ambient
  // SAV-5 "Bilder im Bildschirmschoner": Standard (Standbilder uebersprungen), Auch Standbilder, Poster je Einblendung (+ Lage 1, en)
  seeds.svPicArt = seed({}, { 'settings-aaaa1111.json': { saverLibs: [1], saverFx: 'cut' } }, svCfg);
  seeds.svPicStills = seed({}, { 'settings-aaaa1111.json': { saverLibs: [1], saverFx: 'cut', saverPics: 'stills' } }, svCfg);
  SAVER_STYLES.concat(['off']).forEach(function (st) {
    var cap = st.charAt(0).toUpperCase() + st.slice(1);
    seeds['svPicPoster' + cap] = seed({}, { 'settings-aaaa1111.json': { saverLibs: [1], saverFx: 'cut', saverPics: 'poster', saverInfo: st } }, svCfg);
    seeds['svPicPoster' + cap + 'En1'] = seed({ lang: 'en' }, { 'settings-aaaa1111.json': { saverLibs: [1], saverFx: 'cut', saverPics: 'poster', saverInfo: st } },
      JSON.stringify({ readOnly: true, proxyHost: '127.0.0.1:' + port + '/tv', cursor: 'system', fixedClock: '21:34', welcome: false, saverMs: 1500, saverPos: 1 }));
  });
  // Bunte, helle Bilder fuer die Leisten (Band unten weich, Text lesbar) und Grosse Uhr + Poster (Gruppe mittig) in weiteren Lagen
  ['poster', 'lower'].forEach(function (st) {
    var cap = st.charAt(0).toUpperCase() + st.slice(1);
    seeds['svColor' + cap] = seed({}, { 'settings-aaaa1111.json': { saverInfo: st, saverLibs: [1], saverFx: 'cut' } }, svCfg);
    seeds['svColor' + cap + 'Pos2'] = seed({}, { 'settings-aaaa1111.json': { saverInfo: st, saverLibs: [1], saverFx: 'cut' } },
      JSON.stringify({ readOnly: true, proxyHost: '127.0.0.1:' + port + '/tv', cursor: 'system', fixedClock: '21:34', welcome: false, saverMs: 1500, saverPos: 2 }));
  });
  [2, 3].forEach(function (k) {
    seeds['svPicPosterBigclockPos' + k] = seed({ lang: k === 3 ? 'en' : 'de' }, { 'settings-aaaa1111.json': { saverLibs: [1], saverFx: 'cut', saverPics: 'poster', saverInfo: 'bigclock' } },
      JSON.stringify({ readOnly: true, proxyHost: '127.0.0.1:' + port + '/tv', cursor: 'system', fixedClock: '21:34', welcome: false, saverMs: 1500, saverPos: k }));
  });
  // Pause-Schoner (pausiertes Video) nach "Bilder im Bildschirmschoner": Standbild/echtes Bild je Modus
  var svPauseCfg = JSON.stringify({ readOnly: true, proxyHost: '127.0.0.1:' + port + '/tv', cursor: 'system', sefFake: 'still', seekDelay: 600000, fixedClock: '21:34', welcome: false, saverMs: 1500 });
  seeds.svPicPauseStill = seed({}, null, svPauseCfg);                                                                       // Standard: Standbild -> Plakat
  seeds.svPicPauseStillStills = seed({}, { 'settings-aaaa1111.json': { saverPics: 'stills' } }, svPauseCfg);                // Auch Standbilder: Standbild
  seeds.svPicPauseReal = seed({}, null, svPauseCfg);                                                                        // echtes Hintergrundbild
  seeds.keysTrick = seed({}, { 'settings-aaaa1111.json': { ffrw: 'trick' } });                      // Tastenbelegung: FF/REW folgt "Schnell spulen"
  seeds.keysTrickEn = seed({ lang: 'en' }, { 'settings-aaaa1111.json': { ffrw: 'trick' } });
  seeds.svPicPausePosterEn = seed({ lang: 'en' }, { 'settings-aaaa1111.json': { saverPics: 'poster', saverInfo: 'bigclock' } }, svPauseCfg);
  // Pause-Schoner mit Plakat: Einblendung wandert (Lage 1 -> 2, Takt 5 s), Plakat und Schatten wandern mit (Audit 1.0.6)
  var svPauseMoveCfg = JSON.stringify({ readOnly: true, proxyHost: '127.0.0.1:' + port + '/tv', cursor: 'system', sefFake: 'still', seekDelay: 600000, fixedClock: '21:34', welcome: false, saverMs: 1500, saverPos: 0, saverIvMs: 5000 });
  seeds.svPicPausePosterPos1 = seed({}, { 'settings-aaaa1111.json': { saverPics: 'poster' } }, svPauseMoveCfg);
  seeds.svPicPausePosterMove = seed({}, { 'settings-aaaa1111.json': { saverPics: 'poster' } }, svPauseMoveCfg);
  // Anime je Titel: alle synthetischen Serien per eigener Markierung als Anime; Variante mit ausgeblendeter Kategorie
  var animeOv = { 900: 1, 910: 1 };
  for (var ai = 0; ai < 30; ai++) animeOv[5100 + ai * 10] = 1;
  seeds.anime = seed({}, { 'anime-aaaa1111.json': animeOv });
  // Akzentfarbe (N.accent): Profil mit eigener Farbe; state.accent = zuletzt genutzte Farbe (Start ohne Farbsprung)
  seeds.violet = seed({ accent: 'violet' }, { 'settings-aaaa1111.json': { accent: 'violet' } });
  seeds.coral = seed({ accent: 'coral' }, { 'settings-aaaa1111.json': { accent: 'coral' } });
  seeds.coralPlay = seed({ accent: 'coral' }, { 'settings-aaaa1111.json': { accent: 'coral' } }, cfgPlay);
  // Hintergrund in Bibliotheken: Farbstimmung (Standard, ohne Eintrag), kraeftiger, Titelbild, Zufallsbild, aus, ohne Hintergrundbilder
  function amb(o, l) { return seed(l ? { lang: l } : {}, { 'settings-aaaa1111.json': o }); }
  seeds.ambMood = amb({}); seeds.ambStrong = amb({ libBgStrength: 'strong' }); seeds.ambArt = amb({ libBg: 'art' });
  seeds.ambArtStrong = amb({ libBg: 'art', libBgStrength: 'strong' }); seeds.ambRandom = amb({ libBg: 'random' }); seeds.ambOff = amb({ libBg: 'off' });
  seeds.ambCorner = amb({ libBg: 'art', libBgStrength: 'strong' });   // Titelbild knallbunt und hell (gradPng): Ecke unten links
  seeds.ambNoBg = amb({ libBg: 'art', backgrounds: false }); seeds.ambEn = amb({}, 'en'); seeds.ambRm = amb({ reduceMotion: true });
  seeds.animeHidden = seed({}, { 'anime-aaaa1111.json': animeOv, 'settings-aaaa1111.json': { animeShow: false } });
}
var LOGIN_MASK = [[144, 476, 640, 70]];
var CLOCK = [[896, 36, 320, 72]];                     // Uhrzeit + "Ende um" im Player               // Countdown + Spinner
var SAVER_STYLES = ['ambient', 'classic', 'poster', 'lower', 'bigclock', 'minimal'];
function rep(k, n) { var o = []; for (var i = 0; i < n; i++) o.push(k); return o.join(','); }
var SCENES = [
  // P2: nur PMS (setup.json) + App-PIN je Profil
  { name: 'p2-profiles', seed: 'pkg' },
  { name: 'p2-account', seed: 'pkg', keys: 'ENTER,wait800,LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN' },
  { name: 'p2-pin-new', seed: 'pkg', keys: 'ENTER,wait800,LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,ENTER' },
  { name: 'p2-pin-mismatch', seed: 'pkg', keys: 'ENTER,wait800,LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,ENTER,1,2,3,4,wait600,5,6,7,8,wait600' },
  { name: 'p2-pins-all', seed: 'pkg', keys: 'ENTER,wait800,LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,ENTER' },
  { name: 'p2-pin-kid', seed: 'pkg', keys: 'RIGHT,ENTER,9,9,9,9,wait600' },
  { name: 'login', seed: 'login', mask: LOGIN_MASK },
  { name: 'profiles', seed: 'multi' },
  { name: 'pin', seed: 'multi', keys: 'LEFT,ENTER,1,2' },
  { name: 'pin-wrong', seed: 'multi', keys: 'LEFT,ENTER,9,9,9,9' },
  { name: 'home', seed: 'home' },
  { name: 'home-en', seed: 'en' },
  { name: 'home-row2', seed: 'home', keys: 'DOWN,RIGHT' },
  { name: 'home-last', seed: 'home', keys: 'DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN' },   // HOME-11: letzte Reihe, kein "darunter"-Pfeil
  { name: 'home-poster', seed: 'home', keys: 'DOWN,DOWN,RIGHT,RIGHT', mask: [[320, 270, 600, 34]] },   // "Ende um HH:MM" haengt von der Uhr ab
  { name: 'home-poster-en', seed: 'en', keys: 'DOWN,DOWN,RIGHT,RIGHT', mask: [[320, 270, 600, 34]] },   // HOME-11: fester Hinweis unten links (Kopf der naechsten Reihe nicht im Bild)
  { name: 'home-ptr-next', seed: 'ptrHold', keys: 'DOWN,DOWN', mwait: 4200, moves: '600:300,600:320,600:664,601:665' },   // Zeiger ruht unter den Postern -> naechste Reihe
  { name: 'home-ptr-next-land', seed: 'ptrHold', keys: 'DOWN', mwait: 3800, moves: '600:300,600:320,700:620,701:621' },   // Querformat: auf dem Kopf der naechsten Reihe
  { name: 'home-ptr-next-off', seed: 'ptrEdgeOff', keys: 'DOWN,DOWN', mwait: 4200, moves: '600:300,600:320,600:664,601:665' },   // Einstellung aus: Verweilen bewegt nichts
  { name: 'home-ptr-next-click', seed: 'ptrEdgeOff', keys: 'DOWN,DOWN', mwait: 4200, moves: '600:300,600:320,600:664,click@600:664' },   // aus: Klick geht eine Reihe tiefer
  { name: 'home-rail', seed: 'home', keys: 'LEFT,DOWN' },
  { name: 'home-tools', seed: 'home', keys: 'TOOLS' },
  { name: 'home-markshow', seed: 'home', keys: 'DOWN,DOWN,DOWN,RIGHT,YELLOW' },
  { name: 'home-empty', seed: 'empty' },
  { name: 'home-noart', seed: 'noart' },                 // TV 27.10.: Titel ohne Art -> Serienposter unscharf (Server-blur), mittig beschnitten
  { name: 'home-noart-off', seed: 'noartOff' },          // Einstellung Hintergrundbilder aus -> einfarbig wie bisher
  { name: 'settings', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT' },
  // DET-3: "Serien-Fortschritt anzeigen" mit Erklaerung (DE/EN)
  { name: 'settings-seriesprog', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN' },
  { name: 'settings-seriesprog-en', seed: 'en', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN' },
  { name: 'settings-epprog-en', seed: 'en', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN' },
  { name: 'settings-diag', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,RIGHT' },
  { name: 'search', seed: 'home', keys: 'BLUE' },
  { name: 'search-123', seed: 'home', keys: 'BLUE,wait600,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER' },
  { name: 'search-results', seed: 'home', keys: 'BLUE,wait600,ENTER,RIGHT,ENTER,wait1500,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,DOWN' },
  { name: 'search-empty', seed: 'home', keys: 'BLUE,wait600,9,wait1000,9,9,9,wait1500' },
  // TV-Befund 1.0.5 ("Elemente springen wild umher"): Zeiger fokussiert ganz sichtbare Reihen ohne zu rollen, Tastatur rollt nicht zurueck
  { name: 'search-ptr-row2', seed: 'ptrHold', keys: 'BLUE,wait600,ENTER,RIGHT,ENTER,wait1500,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT', mwait: 7800, moves: '700:300,700:320,700:500,701:502' },
  { name: 'search-ptr-kbd', seed: 'ptrHold', keys: 'BLUE,wait600,ENTER,RIGHT,ENTER,wait1500,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,DOWN', mwait: 8200, moves: '700:300,700:320,300:300,302:301' },
  { name: 'search-ptr-edge', seed: 'ptrHold', keys: 'BLUE,wait600,ENTER,RIGHT,ENTER,wait1500,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT', mwait: 7800, moves: '700:300,700:320,900:630,click@900:630' },   // Klick in die untere Randzone: eine Gruppe weiter
  // Nutzer-Feedback 28.10.: "Zuletzt gesucht" als Chips in hoechstens 2 Zeilen, Rot = Begriff entfernen, "Verlauf loeschen" mit Rueckfrage
  { name: 'search-recent8', seed: 'recent8', keys: 'BLUE,wait600' },
  { name: 'search-recent8-en', seed: 'recent8En', keys: 'BLUE,wait600' },
  { name: 'search-recent4', seed: 'recent4', keys: 'BLUE,wait600' },
  { name: 'search-recent-focus', seed: 'recent8', keys: 'BLUE,wait600,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT' },
  { name: 'search-recent-line2', seed: 'recent8', keys: 'BLUE,wait600,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,DOWN' },
  { name: 'search-recent-removed', seed: 'recent8', keys: 'BLUE,wait600,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,RED,wait300' },
  { name: 'search-recent-clear', seed: 'recent8', keys: 'BLUE,wait600,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,DOWN,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT' },
  { name: 'search-recent-clear-dlg', seed: 'recent8', keys: 'BLUE,wait600,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,DOWN,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,ENTER,wait300' },
  { name: 'search-recent-cleared', seed: 'recent8', keys: 'BLUE,wait600,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,DOWN,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,ENTER,wait300,LEFT,ENTER,wait800' },   // Dialog: Leeren links, Abbrechen (Fokus) rechts
  { name: 'search-recent-long-en', seed: 'recentLongEn', keys: 'BLUE,wait600,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT' },
  { name: 'search-recent-sugg-up', seed: 'recent8', keys: 'BLUE,wait600,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,DOWN,DOWN,UP' },
  { name: 'search-recent-ptr', seed: 'recentPtr', keys: 'BLUE,wait600', mwait: 3600, moves: '700:300,700:320,600:160,601:161' },   // Zeiger auf Zeile 2: Fokus ohne Rollen
  { name: 'search-recent-ptr-click', seed: 'recentPtr', keys: 'BLUE,wait600', mwait: 4600, moves: '700:300,700:320,818:116,819:117,click@819:117' },   // Klick auf einen Begriff = OK
  { name: 'settings-recent', seed: 'recent8', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN' },
  { name: 'settings-recent-panel-en', seed: 'recent8En', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER' },
  { name: 'settings-recent-info', seed: 'recent8', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,INFO' },
  { name: 'p4-discover-recent', seed: 'recent8', keys: 'LEFT,UP,ENTER,wait1500,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT' },
  { name: 'p4-discover', seed: 'home', keys: 'LEFT,UP,ENTER,wait800' },
  { name: 'p4-discover-rail', seed: 'home', keys: 'LEFT,UP' },
  { name: 'p4-discover-ptr', seed: 'ptrHold', keys: 'LEFT,UP,ENTER,wait1500', mwait: 5200, moves: '800:300,800:320,800:470,801:472' },   // Zeiger auf der zweiten Reihe: kein Rollen
  { name: 'p4-discover-results', seed: 'home', keys: 'LEFT,UP,ENTER,wait600,ENTER,RIGHT,ENTER,wait2500,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT' },
  { name: 'p4-discover-ext', seed: 'home', keys: 'LEFT,UP,ENTER,wait600,ENTER,RIGHT,ENTER,wait2500,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,DOWN' },
  { name: 'p4-ext-details', seed: 'home', keys: 'LEFT,UP,ENTER,wait600,ENTER,RIGHT,ENTER,wait2500,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,DOWN,ENTER,wait1200' },
  // DISC-5 Details fremder Titel: mit Helfer (Plex-Katalog) Film/Serie voll, Film minimal, Besetzung fokussiert, INFO; ohne Helfer ohne Beschreibung
  { name: 'p4-ext-details-full', seed: 'inspNew', keys: 'LEFT,UP,ENTER,wait600,ENTER,RIGHT,ENTER,wait2500,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,DOWN,ENTER,wait1500' },
  { name: 'p4-ext-details-full-info', seed: 'inspNew', keys: 'LEFT,UP,ENTER,wait600,ENTER,RIGHT,ENTER,wait2500,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,DOWN,ENTER,wait1500,INFO,wait400' },
  // DET-9: fremder Titel – Klick in die untere Randzone holt die Besetzung herein (Karten lugen unter den Knoepfen nur an)
  { name: 'p4-ext-details-cast-ptr', seed: 'inspNewPtr', keys: 'LEFT,UP,ENTER,wait600,ENTER,RIGHT,ENTER,wait2500,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,DOWN,ENTER,wait1500', mwait: 12200, hold: 15500, moves: '600:300,600:320,700:630,click@700:630' },
  { name: 'p4-ext-details-cast',seed: 'inspNew', keys: 'LEFT,UP,ENTER,wait600,ENTER,RIGHT,ENTER,wait2500,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,DOWN,ENTER,wait1500,DOWN,wait900' },
  { name: 'p4-ext-details-show', seed: 'inspNew', keys: 'LEFT,UP,ENTER,wait600,ENTER,RIGHT,ENTER,wait2500,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,DOWN,DOWN,ENTER,wait1500' },
  { name: 'p4-ext-details-show-en', seed: 'inspNewEn', keys: 'LEFT,UP,ENTER,wait600,ENTER,RIGHT,ENTER,wait2500,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,DOWN,DOWN,ENTER,wait1500' },
  { name: 'p4-ext-details-min', seed: 'inspNew', keys: 'LEFT,UP,ENTER,wait600,ENTER,RIGHT,ENTER,wait2500,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,DOWN,RIGHT,ENTER,wait1500' },
  { name: 'p4-ext-details-nohelper', seed: 'home', keys: 'LEFT,UP,ENTER,wait600,ENTER,RIGHT,ENTER,wait2500,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,DOWN,RIGHT,RIGHT,RIGHT,RIGHT,ENTER,wait1200' },
  { name: 'p4-insp-rows', seed: 'home', keys: 'LEFT,UP,ENTER,wait1500,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,DOWN,DOWN,DOWN,wait800' },   // Inspiration: Fokus in der 4. Reihe
  { name: 'p4-insp-back', seed: 'home', keys: 'LEFT,UP,ENTER,wait1500,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,DOWN,RIGHT,ENTER,wait1200,RETURN,wait900' },   // Detailseite und zurueck: Fokus bleibt in der Reihe
  { name: 'p4-insp-cleared', seed: 'home', keys: 'LEFT,UP,ENTER,wait600,ENTER,RIGHT,ENTER,wait2500,RED,wait1500' },   // Eingabe geloescht -> Reihen wieder da
  { name: 'p4-insprows', seed: 'insp', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,wait600' },   // Einstellungen > Inspiration anpassen
  { name: 'p4-settings-watchlist', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN' },
  // "Nur Titel, die du noch nicht hast" (Entdecken, plex.tv-Reihen ueber den Helfer): Einstellung de/en, mit Weiteren Servern, Reihen mit Filter
  { name: 'p4-settings-insphide', seed: 'inspNew', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,wait600' },
  { name: 'p4-settings-insphide-info', seed: 'inspNew', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,wait600,INFO' },   // INFO: alles erklaert
  { name: 'p4-settings-insphide-en', seed: 'inspNewEn', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,wait600' },
  { name: 'p4-settings-insphide-srv', seed: 'pkgSrvHelper', keys: 'wait3500,LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,wait600' },   // zweite Zeile: auch Weitere Server
  { name: 'p4-insp-new', seed: 'inspNew', keys: 'LEFT,UP,ENTER,wait1500,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,DOWN,wait800' },          // Filter an: nur fremde Titel + Hinweis-Reihe
  { name: 'p4-insp-new-en', seed: 'inspNewEn', keys: 'LEFT,UP,ENTER,wait1500,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,DOWN,wait800' },
  { name: 'p4-insp-new-skip', seed: 'inspNew', keys: 'LEFT,UP,ENTER,wait1500,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,DOWN,DOWN,wait800' },   // DOWN springt ueber den Hinweis
  { name: 'p4-insp-new-off', seed: 'inspNewOff', keys: 'LEFT,UP,ENTER,wait1500,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,DOWN,wait800' },   // Filter aus: Marken wie bisher
  { name: 'settings-homerows', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,ENTER,DOWN' },
  { name: 'settings-homerows-move', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,ENTER,DOWN,DOWN,DOWN,YELLOW,UP' },
  { name: 'home-custom', seed: 'custom' },
  /* HOME-14 "Alle anzeigen": Karte am Reihenende (Poster, Querformat mit Zahl, EN), Bibliothek nur fuer diesen Besuch nach Hinzugefuegt,
   * ganze Liste eines Server-Hubs bzw. von Weiterschauen, RETURN zurueck auf die Karte */
  { name: 'home-all-new', seed: 'home', keys: 'DOWN,DOWN,RIGHT,RIGHT,RIGHT', mask: [[320, 270, 600, 34]] },
  { name: 'home-all-new-en', seed: 'en', keys: 'DOWN,DOWN,RIGHT,RIGHT,RIGHT', mask: [[320, 270, 600, 34]] },
  { name: 'home-all-cw', seed: 'cwMore', keys: 'FF,FF,FF,FF' },
  { name: 'lib-all-new', seed: 'home', keys: 'DOWN,DOWN,RIGHT,RIGHT,RIGHT,ENTER,wait800' },
  { name: 'lib-all-hub', seed: 'custom', keys: 'RIGHT,RIGHT,ENTER,wait800' },
  { name: 'lib-all-cw', seed: 'cwMore', keys: 'FF,FF,FF,FF,ENTER,wait800' },
  /* HOME-14 Ansicht in den Listen: Chip "Ansicht", Panel (Rot), jede Groesse; nur fuer diesen Besuch */
  { name: 'lib-all-hub-view', seed: 'custom', keys: 'RIGHT,RIGHT,ENTER,wait800,RED,wait600' },
  { name: 'lib-all-hub-m', seed: 'custom', keys: 'RIGHT,RIGHT,ENTER,wait800,RED,wait600,DOWN,ENTER,wait900,RETURN,wait600' },
  { name: 'lib-all-hub-s', seed: 'custom', keys: 'RIGHT,RIGHT,ENTER,wait800,RED,wait600,DOWN,DOWN,ENTER,wait900,RETURN,wait600' },
  { name: 'lib-all-hub-list', seed: 'custom', keys: 'RIGHT,RIGHT,ENTER,wait800,RED,wait600,DOWN,DOWN,DOWN,ENTER,wait900,RETURN,wait600' },
  { name: 'lib-all-cw-list', seed: 'cwMore', keys: 'FF,FF,FF,FF,ENTER,wait800,RED,wait600,DOWN,DOWN,DOWN,ENTER,wait900,RETURN,wait600' },
  { name: 'lib-all-cw-chip', seed: 'cwMore', keys: 'FF,FF,FF,FF,ENTER,wait800,UP,wait400' },
  { name: 'home-all-back', seed: 'home', keys: 'DOWN,DOWN,RIGHT,RIGHT,RIGHT,ENTER,wait800,RETURN,wait600', mask: [[320, 270, 600, 34]] },
  { name: 'settings-secback', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN' },   // NAV-5: "Zurueck aus einem Bereich" unter "Seitenleiste anpassen"
  { name: 'settings-secback-panel', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,ENTER' },
  { name: 'settings-secback-panel-en', seed: 'en', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,ENTER' },
  { name: 'settings-secback-info', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,INFO' },
  { name: 'home-return-exit', seed: 'home', keys: 'DOWN,RIGHT,RETURN,RETURN' },   // NAV-5: erste Karte, dann gleich der Beenden-Dialog (ohne Seitenleiste)
  { name: 'settings-railitems', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,ENTER,DOWN' },   // W1: Seitenleiste anpassen
  { name: 'home-rail-custom', seed: 'railCustom', keys: 'LEFT' },                     // W1: Serien oben, Suche und Dokus aus
  { name: 'player-resume', seed: 'play', keys: 'ENTER' },
  { name: 'player-skip', seed: 'play', keys: 'ENTER,ENTER' },
  { name: 'player-osd', seed: 'play', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800,PAUSE', mask: CLOCK },
  { name: 'player-jump-toast', seed: 'play', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800,PAUSE,5,wait900', mask: CLOCK },   // TV-Test 29.10.: "Sprung zu …" oben links, nie ueber der Knopf-Beschriftung
  { name: 'player-seek', seed: 'play', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800,RETURN,RIGHT,RIGHT,RIGHT', mask: CLOCK },
  { name: 'player-btns', seed: 'play', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800,RIGHT,RIGHT,RIGHT', mask: CLOCK },
  { name: 'player-osd-en', seed: 'playEn', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800,PAUSE', mask: CLOCK },   // Pause: Hinweis-Insel (en)
  { name: 'player-btns-en', seed: 'playEn', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800,RIGHT,RIGHT,RIGHT', mask: CLOCK },
  { name: 'player-more-label', seed: 'playEnLong', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800,RIGHT,RIGHT,RIGHT,RIGHT,PAUSE', mask: CLOCK },   // Label am rechten Rand, lange Namen, violett
  { name: 'player-back-label', seed: 'play', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800,LEFT', mask: CLOCK },
  { name: 'player-bar', seed: 'play', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800,UP,LEFT', mask: CLOCK },
  { name: 'player-more', seed: 'playsub', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800,TOOLS' },
  { name: 'player-subs', seed: 'playsub', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800,TOOLS,DOWN,DOWN,DOWN,ENTER' },
  { name: 'player-sleep', seed: 'play', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800,BLUE' },
  { name: 'player-chapters', seed: 'play', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800,YELLOW' },
  { name: 'player-info', seed: 'play', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800,INFO' },
  { name: 'player-tracks', seed: 'play', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800,GREEN,RIGHT' },
  { name: 'player-audio', seed: 'play', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800,GREEN' },
  { name: 'player-versions', seed: 'play', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800,TOOLS,ENTER' },
  { name: 'home-version', seed: 'home', keys: 'RIGHT,RIGHT,TOOLS' },
  { name: 'player-last', seed: 'play', keys: 'DOWN,ENTER', mask: CLOCK },
  { name: 'settings-still', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER' },
  // P5 Einstellungen & Komfort
  { name: 'p5-settings-subs', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN' },
  { name: 'p5-settings-anime', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,RIGHT,DOWN' },
  { name: 'p5-settings-display', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN' },
  // Zeiger-Scrollen beschleunigen (abhaengig von Zeiger-Steuerung): an, Zeiger-Steuerung selbst (Erklaerung mit "Aus: …"), Zeiger aus = grau, englisch
  { name: 'settings-ptraccel', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN' },
  { name: 'settings-ptredge', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN' },   // Zeiger blaettert am Rand weiter (TV-Befund 1.0.5)
  { name: 'settings-ptredge-info', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,INFO' },
  { name: 'settings-ptraccel-edgeoff', seed: 'ptrEdgeOff', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN' },   // ausgegraut: erst am Rand weiterblaettern einschalten
  { name: 'settings-pointer', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN' },
  { name: 'settings-ptraccel-off', seed: 'ptrOff', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN' },
  { name: 'settings-ptredge-off', seed: 'ptrOff', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN' },
  { name: 'settings-ptraccel-en', seed: 'ptrEn', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN' },
  { name: 'settings-ptredge-en', seed: 'ptrEn', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN' },
  { name: 'settings-ptredge-info-en', seed: 'ptrEn', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,INFO' },
  { name: 'settings-pointer-en', seed: 'ptrEn', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN' },
  { name: 'p5-settings-help', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN' },
  { name: 'p5-settings-boost', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN' },
  { name: 'p5-keys', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,RIGHT,ENTER,DOWN,DOWN,DOWN,DOWN,DOWN' },
  { name: 'p5-keys-trick', seed: 'keysTrick', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,RIGHT,ENTER,DOWN,DOWN,DOWN,DOWN,DOWN' },
  { name: 'p5-keys-trick-en', seed: 'keysTrickEn', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,RIGHT,ENTER,DOWN,DOWN,DOWN,DOWN,DOWN' },
  { name: 'p5-conntest', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,ENTER,wait1500', mask: [[872, 112, 376, 48]] },   // Antwortzeit (gemessen, 0/1 ms; bricht in die 2. Zeile um)
  // Anime je Titel (docs/TODO.md "Anime-Erkennung"): Ueberzeile, Grund im INFO-Panel, TOOLS-Eintraege, Kategorie ausgeblendet
  { name: 'p5-anime-details', seed: 'anime', keys: 'LEFT,DOWN,DOWN,ENTER,wait800,RIGHT,ENTER,wait800' },
  { name: 'p5-anime-info', seed: 'anime', keys: 'LEFT,DOWN,DOWN,ENTER,wait800,RIGHT,ENTER,wait800,INFO' },
  { name: 'p5-anime-menu', seed: 'anime', keys: 'LEFT,DOWN,DOWN,ENTER,wait800,RIGHT,ENTER,wait800,TOOLS' },
  { name: 'p5-anime-hidden', seed: 'animeHidden', keys: 'LEFT,DOWN,DOWN,ENTER,wait800,RIGHT,ENTER,wait800,INFO' },
  { name: 'p5-welcome', seed: 'welcome', keys: 'wait3500' },
  { name: 'p5-saver', seed: 'saver', keys: 'wait6000' },
  { name: 'saver-noclock-bright-en', seed: 'svBrightNoclockLongEn', keys: 'wait6000' },   // "Uhrzeit anzeigen" aus: nur Titel + Zeile
  { name: 'saver-off-busy', seed: 'svBusyOff', keys: 'wait6000' },
  { name: 'saver-fade-done', seed: 'svDarkFade', keys: 'wait7000' },                   // Standard (Ueberblenden) nach dem ersten Bild
  // Einstellungen: Schoner-Zeilen, Auswahl Uebergang/Einblendung, Mehrfachauswahl Bibliotheken
  { name: 'saver-settings', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN' },
  { name: 'saver-fx-picker', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,ENTER' },   // +1: Zeile "Nach langer Zeit nur noch die Uhr" (SAV-6)
  { name: 'saver-info-picker-en', seed: 'en', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,DOWN,RIGHT,DOWN,ENTER' },
  { name: 'saver-night-info', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,wait600,INFO' },   // SAV-6: INFO erklaert die Nachtruhe
  { name: 'saver-libs-picker', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,ENTER' },   // Musik dazu
  { name: 'p5-spoiler', seed: 'spoiler', keys: 'DOWN' },
  // Uhr auf der Startseite: je Stil hell (de, Hero-Bild), dunkel (en, Hintergrundbilder aus), kraeftig gruen (de, Film-Reihe)
  { name: 'clock-box', seed: 'clock_box' }, { name: 'clock-free', seed: 'clock_free' }, { name: 'clock-date', seed: 'clock_date' }, { name: 'clock-small', seed: 'clock_small' },
  { name: 'clock-free-en', seed: 'clock_freeEn' }, { name: 'clock-date-en', seed: 'clock_dateEn' }, { name: 'clock-small-en', seed: 'clock_smallEn' },
  { name: 'clock-free-green', seed: 'clock_free', keys: 'DOWN,DOWN,RIGHT,RIGHT', mask: [[320, 270, 600, 34]] },
  { name: 'clock-date-green', seed: 'clock_date', keys: 'DOWN,DOWN,RIGHT,RIGHT', mask: [[320, 270, 600, 34]] },
  { name: 'clock-small-green', seed: 'clock_small', keys: 'DOWN,DOWN,RIGHT,RIGHT', mask: [[320, 270, 600, 34]] },
  // Tastenhinweise: "Nur kurz" nach dem Ausblenden, wieder da nach TOOLS (neues Menue); "Aus"; Einstellungszeile + Auswahl + INFO
  { name: 'hints-brief-faded', seed: 'hintsBrief', keys: 'wait3000' },
  { name: 'hints-brief-tools', seed: 'hintsBrief', keys: 'wait3000,TOOLS' },
  { name: 'hints-off', seed: 'hintsOff' },
  // HOME-13: Hinweis bei neuen Inhalten – Startseite (Genau DE/EN, gemischt, Allgemein, langer Titel), Bibliothek oben rechts, Player oben links
  // (nur mit "Auch waehrend der Wiedergabe"; ohne: kein Hinweis im Video), Einstellungen (drei Zeilen unter der Uhr)
  { name: 'news-exact', seed: 'newsExact', hold: 5000 }, { name: 'news-exact-en', seed: 'newsExactEn', hold: 5000 },
  { name: 'news-mixed', seed: 'newsMixed', hold: 5000 }, { name: 'news-general', seed: 'newsGeneral', hold: 5000 },
  { name: 'news-long-en', seed: 'newsLongEn', hold: 5000 },
  { name: 'news-library', seed: 'newsLib', keys: 'LEFT,DOWN,ENTER,wait3500' },
  { name: 'news-player', seed: 'newsPlay', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait8000', mask: CLOCK },
  { name: 'news-player-off', seed: 'newsPlayOff', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait8000', mask: CLOCK },
  { name: 'news-settings', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN' },
  { name: 'news-settings-secs-en', seed: 'en', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER' },
  { name: 'news-settings-info', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,INFO' },
  { name: 'settings-clockstyle', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER' },
  { name: 'settings-clockstyle-off', seed: 'spoiler', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN' },   // Uhr aus: Zeile gedimmt, Satz erklaert warum
  { name: 'settings-hints-en', seed: 'en', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER' },
  { name: 'settings-hints-info', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,INFO' },
  // Akzentfarbe: Einstellung (Farbfeld), Auswahl mit Farbfeldern, Wechsel wirkt sofort; Startseite/Seitenleiste in anderen Farben
  { name: 'accent-setting', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN' },
  { name: 'accent-picker', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN' },
  { name: 'accent-live', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,DOWN,ENTER' },
  { name: 'accent-home-violet', seed: 'violet', keys: 'DOWN' },
  { name: 'accent-rail-coral', seed: 'coral', keys: 'LEFT,DOWN' },
  { name: 'accent-player-coral', seed: 'coralPlay', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800,RIGHT,RIGHT,RIGHT', mask: CLOCK },
  { name: 'p5-player-subs', seed: 'playsub', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800,TOOLS,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,ENTER' },
  { name: 'player-upnext', seed: 'play', keys: 'RIGHT,ENTER,ENTER', mask: [[832, 540, 176, 10]] },   // Countdown-Balken laeuft
  { name: 'player-upnext-osd', seed: 'play', keys: 'RIGHT,ENTER,ENTER,UP', mask: [[832, 334, 176, 10]].concat(CLOCK) },   // OSD sichtbar: Karte ueber der Bedien-Insel
  { name: 'settings-play', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,RIGHT' },
  { name: 'settings-play-more', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN' },
  { name: 'library', seed: 'home', keys: 'LEFT,DOWN,ENTER' },
  { name: 'library-row2', seed: 'home', keys: 'LEFT,DOWN,ENTER,wait800,DOWN,RIGHT' },
  { name: 'library-chips', seed: 'home', keys: 'LEFT,DOWN,ENTER,wait800,UP' },
  { name: 'library-sort', seed: 'home', keys: 'LEFT,DOWN,ENTER,wait800,RED' },
  // TV-Befund 1.0.5: Reiter "Ansicht" per Taste (▲ auf die Reiterzeile) und per Zeiger (gemessene Reiter) erreichbar
  { name: 'library-sort-tabs', seed: 'home', keys: 'LEFT,DOWN,ENTER,wait800,RED,UP,RIGHT,RIGHT' },
  { name: 'library-sort-tabs-en', seed: 'en', keys: 'LEFT,DOWN,ENTER,wait800,RED,UP,RIGHT,RIGHT' },
  { name: 'library-sort-ptr-view', seed: 'ptrHold', keys: 'LEFT,DOWN,ENTER,wait800,RED', mwait: 5000, moves: '1000:300,1148:132,click@1148:132' },
  { name: 'library-sort-ptr-list', seed: 'ptrHold', keys: 'LEFT,DOWN,ENTER,wait800,RED', mwait: 5000, moves: '1000:300,1148:132,click@1148:132,1000:400,click@1000:408' },   // Zeiger: Ansicht > Liste
  { name: 'library-sort-ptr-view-back', seed: 'ptrHold', keys: 'LEFT,DOWN,ENTER,wait800,ENTER,wait1500,RETURN,wait1000,RED', mwait: 8600, moves: '1000:300,1148:132,click@1148:132' },   // nach Detailseite und zurueck
  { name: 'library-filter', seed: 'home', keys: 'LEFT,DOWN,ENTER,wait800,RED,RIGHT,DOWN,ENTER' },
  { name: 'library-reg', seed: 'home', keys: 'LEFT,DOWN,ENTER,wait800,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,DOWN,DOWN' },
  { name: 'library-jump', seed: 'home', keys: 'LEFT,DOWN,ENTER,wait800,7,wait1200' },
  { name: 'library-shows', seed: 'home', keys: 'LEFT,DOWN,DOWN,ENTER' },
  { name: 'library-view', seed: 'home', keys: 'LEFT,DOWN,ENTER,wait800,RED,RIGHT,RIGHT' },
  { name: 'library-medium', seed: 'home', keys: 'LEFT,DOWN,ENTER,wait800,RED,RIGHT,RIGHT,DOWN,ENTER,RETURN,wait800,DOWN' },
  { name: 'library-small', seed: 'home', keys: 'LEFT,DOWN,DOWN,ENTER,wait800,RED,RIGHT,RIGHT,DOWN,DOWN,ENTER,RETURN' },
  { name: 'library-list', seed: 'home', keys: 'LEFT,DOWN,ENTER,wait800,RED,RIGHT,RIGHT,DOWN,DOWN,DOWN,ENTER,RETURN,wait800,DOWN' },
  // TV-Befund 27.10. nachmittags: Zeiger ueber der angeschnittenen letzten Zeile = Randzone (Pille, kein Fokus/Ring dort)
  { name: 'library-ptr-lastrow', seed: 'ptrHold', keys: 'LEFT,DOWN,ENTER,wait800,RED,RIGHT,RIGHT,DOWN,DOWN,DOWN,ENTER,RETURN,wait800,DOWN', mwait: 9500, moves: '600:400,600:420,600:612,600:616' },
  // Gross: angeschnittene 2. Reihe (44 % sichtbar) ist zeigbar -> nach 250 ms EINE Reihe hoch und fokussiert; Band y 604–656 = Randzone
  { name: 'library-ptr-poster', seed: 'ptrHold', keys: 'LEFT,DOWN,ENTER,wait800,DOWN', mwait: 5000, moves: '600:300,600:320,600:560,600:566' },
  { name: 'library-ptr-band', seed: 'ptrHold', keys: 'LEFT,DOWN,ENTER,wait800,DOWN', mwait: 5000, moves: '600:300,600:320,600:630,600:634' },
  { name: 'details-movie', seed: 'home', keys: 'LEFT,DOWN,ENTER,wait800,RIGHT,ENTER' },
  { name: 'details-movie-cast', seed: 'home', keys: 'LEFT,DOWN,ENTER,wait800,RIGHT,ENTER,wait800,DOWN' },
  // Nutzerbefund 30.10.: Fokus in der letzten Reihe (Poster "Aehnliche Titel") – Ring frei ueber der Hinweisleiste (Layout-Art ring)
  { name: 'details-movie-last', seed: 'home', keys: 'LEFT,DOWN,ENTER,wait800,RIGHT,ENTER,wait800,DOWN,DOWN,DOWN,DOWN,DOWN,wait800' },
  { name: 'details-show-last', seed: 'home', keys: 'LEFT,DOWN,DOWN,ENTER,wait800,RIGHT,ENTER,wait800,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,wait800', mask: [[144, 124, 1000, 26]] },
  { name: 'details-show', seed: 'home', keys: 'LEFT,DOWN,DOWN,ENTER,wait800,RIGHT,ENTER' },
  { name: 'details-show-eps', seed: 'home', keys: 'LEFT,DOWN,DOWN,ENTER,wait800,RIGHT,ENTER,wait800,DOWN,DOWN', mask: [[144, 124, 1000, 26]] },
  { name: 'details-show-noart', seed: 'home', keys: 'LEFT,DOWN,DOWN,ENTER,wait800,9,9,9,9,wait1500,ENTER,wait800' },
  { name: 'details-show-noart-eps', seed: 'home', keys: 'LEFT,DOWN,DOWN,ENTER,wait800,9,9,9,9,wait1500,ENTER,wait800,DOWN,DOWN', mask: [[144, 124, 1000, 26]] },
  { name: 'details-show-cells', seed: 'home', keys: 'LEFT,DOWN,DOWN,ENTER,wait800,RIGHT,ENTER,wait800,DOWN,RIGHT,wait800,DOWN' },
  // DET-3: nach dem Zurueck zu den Knoepfen bleiben es Felder, Marker = naechste Folge; Einstellungen einzeln
  { name: 'details-show-cells-up', seed: 'home', keys: 'LEFT,DOWN,DOWN,ENTER,wait800,RIGHT,ENTER,wait800,DOWN,RIGHT,wait800,DOWN,RIGHT,RIGHT,wait800,UP,UP,wait800' },
  { name: 'details-show-epoff', seed: 'epOff', keys: 'LEFT,DOWN,DOWN,ENTER,wait800,RIGHT,ENTER,wait800,DOWN,RIGHT,wait800,DOWN' },
  { name: 'details-show-seriesoff', seed: 'seriesOff', keys: 'LEFT,DOWN,DOWN,ENTER,wait800,RIGHT,ENTER,wait800,DOWN,RIGHT,wait800,DOWN' },
  { name: 'details-show-en', seed: 'en', keys: 'LEFT,DOWN,DOWN,ENTER,wait800,RIGHT,ENTER,wait800,DOWN,RIGHT,wait800,DOWN' },
  // Nutzerbefund 28.10.: Zeiger ueber dem Staffel-Pfeil › bzw. ‹ -> hinterlegt wie ein Reiter
  { name: 'details-tabs-ptr-r', seed: 'ptrHold', keys: 'LEFT,DOWN,DOWN,ENTER,wait800,RIGHT,ENTER,wait800,DOWN', mwait: 6500, moves: '600:200,480:350,486:352' },
  { name: 'details-tabs-ptr-l', seed: 'ptrHold', keys: 'LEFT,DOWN,DOWN,ENTER,wait800,RIGHT,ENTER,wait800,DOWN,RIGHT,RIGHT,RIGHT,wait800', mwait: 7500, moves: '600:200,150:350,148:352' },
  // DET-9 (NAV-2): Zeiger auf Detailseiten rollt nie unter dem ruhenden Punkt. Reiter unter den Knoepfen = anderer Abschnitt:
  // erst nach 250 ms Verweilen herein (Staffel unter dem Punkt gewaehlt), Einstellung aus = nichts
  { name: 'details-ptr-tabs', seed: 'ptrHold', keys: 'LEFT,DOWN,DOWN,ENTER,wait800,RIGHT,ENTER,wait800', mwait: 6500, moves: '600:200,300:598,301:599' },
  { name: 'details-ptr-tabs-off', seed: 'ptrEdgeOff', keys: 'LEFT,DOWN,DOWN,ENTER,wait800,RIGHT,ENTER,wait800', mwait: 6500, moves: '600:200,300:598,301:599' },
  // Staffeln/Folgen eingerastet: vom Reiter auf eine Folge (Fokus ohne Rollen), dann Ruhe in der unteren Randzone (Pille, ptrHold rollt nicht)
  { name: 'details-ptr-eps', seed: 'ptrHold', keys: 'LEFT,DOWN,DOWN,ENTER,wait800,RIGHT,ENTER,wait800,DOWN', mwait: 7000, moves: '600:200,600:220,300:350,700:470,701:471,700:640,701:641' },
  // Besetzung eingerastet: Punkt ueber dem ausgeblendeten Folgen-Abschnitt (frueher Sprung dorthin) bleibt ohne Wirkung; obere Randzone mit Pille
  { name: 'details-ptr-cast-hidden', seed: 'ptrHold', keys: 'LEFT,DOWN,DOWN,ENTER,wait800,RIGHT,ENTER,wait800,DOWN,DOWN,DOWN', mwait: 7800, moves: '600:420,600:440,600:200,601:202,700:300,701:301' },
  // Film: Klick in die untere Randzone unter den Knoepfen holt die Besetzung herein
  { name: 'details-movie-ptr-cast', seed: 'ptrHold', keys: 'LEFT,DOWN,ENTER,wait800,RIGHT,ENTER,wait800', mwait: 6000, moves: '600:300,600:320,700:630,click@700:630' },
  { name: 'settings-play-end', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN' },
  // M4 Musik (Bibliothek 3 "Musik"): quadratische Karten, Alben-Reiter, Album-/Kuenstlerseite, Jetzt laeuft, Mini-Player
  { name: 'music-artists', seed: 'play', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800' },
  { name: 'music-albums', seed: 'play', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,UP,RIGHT,ENTER,wait800' },
  { name: 'music-albums-list', seed: 'play', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,UP,RIGHT,ENTER,wait800,DOWN,RED,RIGHT,RIGHT,DOWN,DOWN,DOWN,ENTER,RETURN,wait800' },
  { name: 'music-album', seed: 'play', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,UP,RIGHT,ENTER,wait800,DOWN,ENTER,wait800' },
  { name: 'music-album-tracks', seed: 'play', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,UP,RIGHT,ENTER,wait800,DOWN,ENTER,wait800,DOWN,DOWN,DOWN' },
  { name: 'music-album-ptr', seed: 'ptrHoldPlay', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,UP,RIGHT,ENTER,wait800,DOWN,ENTER,wait800,DOWN,DOWN,DOWN', mwait: 11500, moves: '600:400,600:420,600:640,600:644' },   // angeschnittene 7. Zeile = Randzone
  // DET-9: Albumseite unter den Knoepfen – Ruhe auf dem Rand der ersten Titelzeile rollt nicht mehr, Randzone mit Pille
  { name: 'music-album-ptr-peek', seed: 'ptrHoldPlay', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,UP,RIGHT,ENTER,wait800,DOWN,ENTER,wait800', mwait: 9200, moves: '600:400,600:420,600:626,601:627' },
  { name: 'music-artist', seed: 'play', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,ENTER,wait800' },
  // DET-9: Kuenstlerseite, Alben eingerastet – Punkt ueber dem Kopf (dort lag frueher eine ausgeblendete Reihe) und auf dem Kopf der
  // naechsten Reihe bewegt nichts
  { name: 'music-artist-ptr', seed: 'ptrHoldPlay', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,RIGHT,RIGHT,ENTER,wait800,DOWN,DOWN', mwait: 8500, moves: '600:400,600:420,600:120,601:121,600:590,601:591,600:620,601:621' },
  { name: 'music-artist-albums', seed: 'play', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,ENTER,wait800,DOWN' },
  { name: 'music-nowplaying', seed: 'play', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,UP,RIGHT,ENTER,wait800,DOWN,ENTER,wait800,ENTER,wait800' },
  { name: 'music-queue', seed: 'play', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,UP,RIGHT,ENTER,wait800,DOWN,ENTER,wait800,ENTER,wait800,YELLOW' },
  { name: 'music-mini', seed: 'play', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,UP,RIGHT,ENTER,wait800,DOWN,ENTER,wait800,ENTER,wait800,RETURN,wait1500' },
  // TV-Test 27.10. nachmittags (F24–F30): heller Hintergrund, Titelkarten ohne Cover, Mini-Player (Pause, Platz, A–Z), lange Namen
  { name: 'music-np-nocover', seed: 'play', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,UP,RIGHT,ENTER,wait800,DOWN,RIGHT,RIGHT,ENTER,wait800,ENTER,wait800' },
  // Nutzerauftrag 28.10. (docs/research/player-controls.md): eine Knopf-Familie fuer Video, Musik, Hoerbuch; ⏮/⏭ nach Inhalt; Zeiger-Vorschau am Balken
  { name: 'music-np-en', seed: 'playEn', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,UP,RIGHT,ENTER,wait800,DOWN,ENTER,wait800,ENTER,wait800' },
  { name: 'music-np-prev', seed: 'play', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,UP,RIGHT,ENTER,wait800,DOWN,ENTER,wait800,ENTER,wait800,LEFT,LEFT' },
  { name: 'music-np-asym', seed: 'playAsym', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,UP,RIGHT,ENTER,wait800,DOWN,ENTER,wait800,ENTER,wait800,LEFT' },
  { name: 'book-np', seed: 'bookPlay', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,UP,RIGHT,ENTER,wait800,DOWN,ENTER,wait800,ENTER,wait800' },
  { name: 'book-np-en', seed: 'bookPlayEn', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,UP,RIGHT,ENTER,wait800,DOWN,ENTER,wait800,ENTER,wait800,RIGHT,RIGHT' },
  { name: 'book-mini', seed: 'bookPlay', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,UP,RIGHT,ENTER,wait800,DOWN,ENTER,wait800,ENTER,wait800,RETURN,wait1500' },
  { name: 'music-mini-en', seed: 'playEn', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,UP,RIGHT,ENTER,wait800,DOWN,ENTER,wait800,ENTER,wait800,RETURN,wait1500' },
  { name: 'player-pn-prev', seed: 'play', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800,LEFT,LEFT', mask: CLOCK },                 // Film mit Kapiteln: ⏮ Voriges Kapitel
  { name: 'player-pn-next-en', seed: 'playEnLong', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800,RIGHT,PAUSE', mask: CLOCK },      // lang + en + violett: ⏭ Next chapter, Pause-Hinweise
  // Schnellspulen (SPEC PLAY-32): Pille in der Zeitzeile, Play-Knopf = "Normal weiter"; umgewandelt -> Sprung + Hinweis im Label-Feld
  { name: 'player-trick-ff8', seed: 'playTrick', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800,FF,FF,FF', mask: CLOCK },
  { name: 'player-trick-rw4-en', seed: 'playTrickEn', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800,RW,RW', mask: CLOCK },
  { name: 'player-trick-normal', seed: 'playTrick', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800,FF,FF,PLAY', mask: CLOCK },   // PLAY: Pille weg, Pause-Symbol
  { name: 'player-trick-hls', seed: 'trickHls', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait1500,FF', mask: CLOCK },
  { name: 'player-trick-hls-en', seed: 'trickHlsEn', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait1500,FF', mask: CLOCK },
  { name: 'settings-ffrw', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN' },
  { name: 'settings-ffrw-panel', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER' },
  { name: 'settings-ffrw-en', seed: 'en', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN' },
  { name: 'settings-ffrw-panel-en', seed: 'en', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER' },
  { name: 'settings-ffrw-help-en', seed: 'en', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,INFO' },
  { name: 'player-asym', seed: 'playAsym', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800,RIGHT', mask: CLOCK },                    // -10 / +30
  { name: 'player-ep-pn', seed: 'play', keys: 'ENTER,ENTER,wait800,UP,DOWN,LEFT,LEFT', mask: CLOCK },     // Folge: erste der Queue -> ⏮ gedimmt, Fokus bleibt auf -10; Skip-Knopf sichtbar
  { name: 'player-hover', seed: 'ptrHoldPlay', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800', mwait: 6200, moves: '600:300,700:486', mask: CLOCK },   // Zeiger ueber dem Balken: Zeit + Vorschaubild
  { name: 'player-hover-skip', seed: 'ptrHoldPlay', keys: 'ENTER,ENTER,wait800,UP', mwait: 5600, moves: '600:300,1150:486', mask: CLOCK },   // Vorschau am rechten Rand ueber dem Skip-Knopf
  { name: 'player-click-bar', seed: 'ptrHoldPlay', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800', mwait: 6200, moves: '600:300,900:486,click@900:486', mask: CLOCK },   // Klick: Ziel steht, Sprung erst nach Ruhe
  { name: 'player-upnext-hover', seed: 'ptrHoldPlay', keys: 'RIGHT,ENTER,ENTER', mwait: 5200, moves: '600:300,1000:486', mask: [[832, 334, 176, 10]].concat(CLOCK) },   // Vorschau + Countdown-Karte
  // Feinauswahl am Balken (docs/research/player-controls.md "Feinauswahl", SPEC PLAY-30): Zeiger ruht 700 ms (kleinste Bewegungen = Finger
  // auf dem Touchpad), dann 60 px weiter. Standard-Form A (Lasche); Mitte/Balkenanfang/Skip/Countdown: player-lpA*. Hier: ohne
  // Vorschaubilder/hell, Klick, nach oben weg, Schutzzone (Zeiger rutscht auf die Knopfreihe: kein Knopf reagiert, Klick setzt das Ziel)
  { name: 'player-loupe-plain', seed: 'loupeSeen', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800', mwait: 6200, moves: '600:300,700:486,701:486,700:486,701:486,700:486,760:486', mask: CLOCK },   // ohne Vorschaubilder, helles Bild, Titel statt Hinweis
  { name: 'player-loupe-plain-en', seed: 'loupeSeenEn', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800', mwait: 6200, moves: '600:300,700:486,701:486,700:486,701:486,700:486,760:486', mask: CLOCK },
  { name: 'player-loupe-click', seed: 'loupe', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800', mwait: 6200, moves: '600:300,700:486,701:486,700:486,701:486,700:486,760:486,click@760:486', mask: CLOCK },   // Klick: Lasche zu, Ziel steht (+x), ein Sprung nach Ruhe
  { name: 'player-loupe-guard', seed: 'loupe', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800', mwait: 6200, moves: '600:300,700:486,701:486,700:486,701:486,700:486,720:512,740:540,760:562,900:562,1000:562', mask: CLOCK },   // Schutzzone: auf der Knopfreihe weiter offen, kein Knopf fokussiert, Zeit haftet am Fensterende
  { name: 'player-loupe-guard-click', seed: 'loupe', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800', mwait: 6200, moves: '600:300,700:486,701:486,700:486,701:486,700:486,680:512,620:540,580:562,click@580:562', mask: CLOCK },   // Klick auf Play/Pause: setzt das Ziel, keine Pause
  { name: 'player-loupe-up', seed: 'loupe', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800', mwait: 6200, moves: '600:300,700:486,701:486,700:486,701:486,700:486,760:486,760:360', mask: CLOCK },   // nach oben ueber die Lasche weg: zu, grobe Ansicht
  // Darstellungen (PLAY-31): je Form Film 2 h Mitte (+ Untertitel), Balkenanfang (en, hell, violett), Folge mit Skip-Knopf links/rechts,
  // Countdown-Karte; D ohne Vorschaubilder -> Panel. Kollisionsmatrix: docs/research/player-controls.md "Darstellungen"
  { name: 'player-lpA', seed: 'lpA', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800', mwait: 6200, moves: '600:300,700:486,701:486,700:486,701:486,700:486,760:486', mask: CLOCK },
  { name: 'player-lpA-en', seed: 'lpAEn', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800', mwait: 6200, moves: '600:300,300:486,301:486,300:486,301:486,300:486,250:486', mask: CLOCK },
  { name: 'player-lpA-skip', seed: 'lpA', keys: 'ENTER,ENTER,wait800,UP', mwait: 5600, moves: '600:300,400:486,401:486,400:486,401:486,400:486,430:470', mask: CLOCK },   // Lasche links: Skip-Knopf bleibt
  { name: 'player-lpA-skip-r', seed: 'lpA', keys: 'ENTER,ENTER,wait800,UP', mwait: 5600, moves: '600:300,1100:486,1101:486,1100:486,1101:486,1100:486,1150:470', mask: CLOCK },   // rechts: Skip-Knopf weicht
  { name: 'player-lpA-upnext', seed: 'lpA', keys: 'RIGHT,ENTER,ENTER', mwait: 5200, moves: '600:300,1000:486,1001:486,1000:486,1001:486,1000:486,1040:440', mask: [[832, 334, 176, 10]].concat(CLOCK) },
  // Keil-Linien an den Balkenenden (TV-Befund 28.10.: Enden gleich weich): Fenster ganz am Anfang/Ende, Ausschnitt an der Balkenkante
  { name: 'player-lpA-start', seed: 'lpA', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800', mwait: 6200, moves: '600:300,100:486,101:486,100:486,101:486,100:486,110:486', mask: CLOCK },
  { name: 'player-lpA-end', seed: 'lpA', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800', mwait: 6200, moves: '600:300,1180:486,1181:486,1180:486,1181:486,1180:486,1170:486', mask: CLOCK },
  { name: 'player-lpB', seed: 'lpB', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800', mwait: 6200, moves: '600:300,700:486,701:486,700:486,701:486,700:486,760:486', mask: CLOCK },
  { name: 'player-lpB-en', seed: 'lpBEn', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800', mwait: 6200, moves: '600:300,300:486,301:486,300:486,301:486,300:486,250:486', mask: CLOCK },   // ohne Bilder: Zeit-Blase
  { name: 'player-lpB-guard', seed: 'lpB', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800', mwait: 6200, moves: '600:300,700:486,701:486,700:486,701:486,700:486,710:512,715:540,720:562', mask: CLOCK },   // B: Schutzzone auf der Knopfreihe
  { name: 'player-lpB-skip', seed: 'lpB', keys: 'ENTER,ENTER,wait800,UP', mwait: 5600, moves: '600:300,1100:486,1101:486,1100:486,1101:486,1100:486,1150:470', mask: CLOCK },
  { name: 'player-lpD', seed: 'lpD', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800', mwait: 6800, moves: '600:300,700:486,701:486,700:486,701:486,700:486,760:486', mask: CLOCK },
  { name: 'player-lpD-en', seed: 'lpDEn', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800', mwait: 6800, moves: '600:300,300:486,301:486,300:486,301:486,300:486,250:420', mask: CLOCK },   // Zeiger in den Bildern
  { name: 'player-lpD-skip', seed: 'lpD', keys: 'ENTER,ENTER,wait800,UP', mwait: 6200, moves: '600:300,1100:486,1101:486,1100:486,1101:486,1100:486,1150:470', mask: CLOCK },
  { name: 'player-lpD-upnext', seed: 'lpD', keys: 'RIGHT,ENTER,ENTER', mwait: 5800, moves: '600:300,1000:486,1001:486,1000:486,1001:486,1000:486,1040:440', mask: [[832, 334, 176, 10]].concat(CLOCK) },
  { name: 'player-lpD-end', seed: 'lpD', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800', mwait: 6800, moves: '600:300,1180:486,1181:486,1180:486,1181:486,1180:486,1170:486', mask: CLOCK },   // Keil am Balkenende
  { name: 'player-lpD-nothumbs', seed: 'lpDNo', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800', mwait: 6200, moves: '600:300,700:486,701:486,700:486,701:486,700:486,760:486', mask: CLOCK },   // -> Panel
  { name: 'player-lpD-up', seed: 'lpD', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800', mwait: 6800, moves: '600:300,700:486,701:486,700:486,701:486,700:486,760:486,760:280', mask: CLOCK },   // ueber die Lasche hinaus: zu
  { name: 'settings-loupe-style', seed: 'lpStyleOn', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,RIGHT,' + rep('DOWN', 18) + ',ENTER' },
  { name: 'settings-loupe-style-off-en', seed: 'en', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,RIGHT,' + rep('DOWN', 18) },
  { name: 'book-np-loupe', seed: 'bookLoupe', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,UP,RIGHT,ENTER,wait800,DOWN,ENTER,wait800,ENTER,wait800', mwait: 12500, moves: '700:300,860:404,861:404,860:404,861:404,860:404,900:404' },
  { name: 'book-np-loupe-en', seed: 'bookLoupeEn', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,UP,RIGHT,ENTER,wait800,DOWN,ENTER,wait800,ENTER,wait800', mwait: 12500, moves: '700:300,640:404,641:404,640:404,641:404,640:404,620:420' },
  { name: 'book-np-loupe-guard', seed: 'bookLoupe', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,UP,RIGHT,ENTER,wait800,DOWN,ENTER,wait800,ENTER,wait800', mwait: 12500, moves: '700:300,860:404,861:404,860:404,861:404,860:404,870:440,880:480,890:510' },   // Jetzt laeuft (B): Zeiger auf der Knopfreihe, Knoepfe reagieren nicht
  { name: 'music-np-hover', seed: 'musicLoupe', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,UP,RIGHT,ENTER,wait800,DOWN,ENTER,wait800,ENTER,wait800', mwait: 12500, moves: '700:300,860:404,861:404,860:404,861:404,860:404' },   // Musiktitel 3 Min.: nur Zeit-Blase
  { name: 'settings-loupe-info', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,RIGHT,' + rep('DOWN', 17) + ',INFO' },
  { name: 'settings-loupe-off-en', seed: 'ptrOffEn', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,RIGHT,' + rep('DOWN', 17) },
  { name: 'music-mini-nocover', seed: 'play', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,UP,RIGHT,ENTER,wait800,DOWN,RIGHT,RIGHT,ENTER,wait800,ENTER,wait800,PAUSE,RETURN,wait1500' },
  { name: 'music-mini-list', seed: 'play', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,UP,RIGHT,ENTER,wait800,DOWN,ENTER,wait800,ENTER,wait800,RETURN,wait1500,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,wait800' },
  { name: 'music-mini-lib', seed: 'play', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,UP,RIGHT,ENTER,wait800,DOWN,ENTER,wait800,ENTER,wait800,RETURN,wait800,RETURN,wait1500' },
  { name: 'music-artist-groups', seed: 'play', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,RIGHT,RIGHT,ENTER,wait800,DOWN' },   // Alben + Live + Kompilation
  { name: 'music-artist-groups2', seed: 'play', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,RIGHT,RIGHT,ENTER,wait800,DOWN,DOWN,DOWN' },
  { name: 'music-artist-bright', seed: 'play', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,RIGHT,ENTER,wait800' },
  // Hintergrund in Bibliotheken: je Modus/Staerke die schwierigsten Titel (fast weiss, knallbunt), Liste, A–Z, Chips, Musik, Einstellungen
  { name: 'amb-mood-bright', seed: 'ambMood', keys: 'LEFT,DOWN,ENTER,wait1800' },
  { name: 'amb-mood-colour', seed: 'ambMood', keys: 'LEFT,DOWN,ENTER,wait800,RIGHT,wait1800' },
  { name: 'amb-mood-normal', seed: 'ambMood', keys: 'LEFT,DOWN,ENTER,wait800,DOWN,RIGHT,wait1800' },
  { name: 'amb-strong-colour', seed: 'ambStrong', keys: 'LEFT,DOWN,ENTER,wait800,RIGHT,wait1800' },
  { name: 'amb-strong-bright', seed: 'ambStrong', keys: 'LEFT,DOWN,ENTER,wait1800' },
  { name: 'amb-mood-list', seed: 'ambMood', keys: 'LEFT,DOWN,ENTER,wait800,RED,RIGHT,RIGHT,DOWN,DOWN,DOWN,ENTER,RETURN,wait800,DOWN,wait1800' },
  { name: 'amb-strong-list', seed: 'ambStrong', keys: 'LEFT,DOWN,ENTER,wait800,RED,RIGHT,RIGHT,DOWN,DOWN,DOWN,ENTER,RETURN,wait1800' },
  { name: 'amb-mood-small', seed: 'ambStrong', keys: 'LEFT,DOWN,DOWN,ENTER,wait800,RED,RIGHT,RIGHT,DOWN,DOWN,ENTER,RETURN,wait800,RIGHT,wait1800' },
  { name: 'amb-mood-reg', seed: 'ambStrong', keys: 'LEFT,DOWN,ENTER,wait800,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,DOWN,DOWN,wait1800' },
  { name: 'amb-mood-chips', seed: 'ambStrong', keys: 'LEFT,DOWN,ENTER,wait800,RIGHT,wait1500,UP,wait600' },
  { name: 'amb-art-bright', seed: 'ambArt', keys: 'LEFT,DOWN,ENTER,wait1800' },
  { name: 'amb-art-strong', seed: 'ambArtStrong', keys: 'LEFT,DOWN,ENTER,wait1800' },
  { name: 'amb-art-normal', seed: 'ambArtStrong', keys: 'LEFT,DOWN,ENTER,wait800,DOWN,RIGHT,wait1800' },
  { name: 'amb-corner', seed: 'ambCorner', keys: 'LEFT,DOWN,ENTER,wait1800' },   // Seitenleiste + Band unten als ein Rahmen, weiche Ecke unten links (TV-Befund 28.10.)
  { name: 'amb-random', seed: 'ambRandom', keys: 'LEFT,DOWN,ENTER,wait800,DOWN,RIGHT,wait1800' },
  { name: 'amb-nobg-art', seed: 'ambNoBg', keys: 'LEFT,DOWN,ENTER,wait800,RIGHT,wait1800' },   // Hintergrundbilder aus: Titelbild -> Farbstimmung
  { name: 'amb-off', seed: 'ambOff', keys: 'LEFT,DOWN,ENTER,wait800,RIGHT,wait1800' },
  { name: 'amb-rm', seed: 'ambRm', keys: 'LEFT,DOWN,ENTER,wait800,RIGHT,wait1000' },          // Reduzierte Bewegung: sofortiger Tausch
  { name: 'amb-music', seed: 'ambStrong', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,RIGHT,wait1800' },
  { name: 'amb-settings', seed: 'ambMood', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN' },
  { name: 'amb-settings-panel', seed: 'ambMood', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER' },
  { name: 'amb-settings-strength', seed: 'ambMood', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER' },
  { name: 'amb-settings-off', seed: 'ambOff', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN' },
  { name: 'amb-settings-en', seed: 'ambEn', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN' },
  { name: 'amb-settings-panel-en', seed: 'ambEn', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER' },
  { name: 'rail-long', seed: 'longLib', keys: 'LEFT' },
  // Weitere Server: Seitenleiste mit Bibliotheken eines freigegebenen Servers (Herkunft), Bibliothek/Details mit Herkunft,
  // Seitenleiste anpassen, Einstellungszeile, nicht erreichbarer Server (Meldung nur fuer ihn)
  { name: 'srv-rail', seed: 'pkgSrv', keys: 'wait3500,LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN' },
  { name: 'srv-library', seed: 'pkgSrv', keys: 'wait3500,LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,wait1000' },
  { name: 'srv-details', seed: 'pkgSrv', keys: 'wait3500,LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,wait1000,RIGHT,ENTER,wait2500', mask: [[992, 624, 288, 32]] },   // letzte Besetzungsbilder laden mal spaeter
  { name: 'srv-railitems', seed: 'pkgSrv', keys: 'wait3500,LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN' },
  { name: 'srv-settings', seed: 'pkgSrv', keys: 'wait3500,LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN' },
  { name: 'srv-details-error', seed: 'pkgSrvMetaFail', keys: 'wait3500,LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,wait1000,RIGHT,ENTER,wait2600', hold: 16000 },   // Meldung deckt Titel/Metazeile ab
  { name: 'srv-down', seed: 'pkgSrvDown', keys: 'wait3500,LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,wait1500' },
  { name: 'rail-long-en', seed: 'longLibEn', keys: 'LEFT' }
];

SAVER_STYLES.forEach(function (st) {
  var cap = st.charAt(0).toUpperCase() + st.slice(1);
  SCENES.push({ name: 'saver-' + st + '-bright', seed: 'svBright' + cap + 'Long', keys: 'wait6000' },
    { name: 'saver-' + st + '-dark-en', seed: 'svDark' + cap + 'LongEn', keys: 'wait6000' },
    { name: 'saver-' + st + '-busy', seed: 'svBusy' + cap, keys: 'wait6000' },
    { name: 'saver-' + st + '-pos1', seed: 'svBusyPos' + cap + '1', keys: 'wait6000' }, { name: 'saver-' + st + '-pos2', seed: 'svBusyPos' + cap + '2', keys: 'wait6000' },
    { name: 'saver-' + st + '-pos3', seed: 'svBusyPos' + cap + '3', keys: 'wait6000' });
});
/* SAV-5: Einstellung (Zeile, Auswahl en, INFO-Erklaerung), Standard ueberspringt Standbilder, Auch Standbilder, Poster je Einblendung */
var SV_SET = 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN';   // Einstellungen › Bildschirmschoner › "Bilder im Bildschirmschoner" (Zeile 5)
SCENES.push({ name: 'saver-pics-setting', seed: 'home', keys: SV_SET }, { name: 'saver-pics-picker-en', seed: 'en', keys: SV_SET + ',ENTER' },
  { name: 'saver-pics-info', seed: 'home', keys: SV_SET + ',wait600,INFO' }, { name: 'saver-pics-art', seed: 'svPicArt', keys: 'wait6000' },
  { name: 'saver-pics-stills', seed: 'svPicStills', keys: 'wait6000' });
SAVER_STYLES.concat(['off']).forEach(function (st) {
  var cap = st.charAt(0).toUpperCase() + st.slice(1);
  SCENES.push({ name: 'saver-pics-poster-' + st, seed: 'svPicPoster' + cap, keys: 'wait6000' }, { name: 'saver-pics-poster-' + st + '-en1', seed: 'svPicPoster' + cap + 'En1', keys: 'wait6000' });
});

['poster', 'lower'].forEach(function (st) {
  var cap = st.charAt(0).toUpperCase() + st.slice(1);
  SCENES.push({ name: 'saver-' + st + '-color', seed: 'svColor' + cap, keys: 'wait6000' }, { name: 'saver-' + st + '-color-pos2', seed: 'svColor' + cap + 'Pos2', keys: 'wait6000' });
});
SCENES.push({ name: 'saver-pics-poster-bigclock-pos2', seed: 'svPicPosterBigclockPos2', keys: 'wait6000' },
  { name: 'saver-pics-poster-bigclock-pos3-en', seed: 'svPicPosterBigclockPos3', keys: 'wait6000' });
var SV_PAUSE = 'RIGHT,RIGHT,ENTER,ENTER,wait800,PAUSE,wait6000';
SCENES.push({ name: 'saver-pause-still', seed: 'svPicPauseStill', keys: SV_PAUSE }, { name: 'saver-pause-still-stills', seed: 'svPicPauseStillStills', keys: SV_PAUSE },
  { name: 'saver-pause-real', seed: 'svPicPauseReal', keys: SV_PAUSE }, { name: 'saver-pause-poster-en', seed: 'svPicPausePosterEn', keys: SV_PAUSE },
  // hold: Aufnahme nach ms ab Start (PAUSE bei ~4,6 s, Schoner + Bild ~7 s, Wandern nach 5 s Takt ~12,5 s, naechstes ~17,5 s)
  { name: 'saver-pause-poster-pos1', seed: 'svPicPausePosterPos1', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800,PAUSE', hold: 10000 },   // Lage 1 (vor dem Wandern)
  { name: 'saver-pause-poster-pos2', seed: 'svPicPausePosterMove', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800,PAUSE', hold: 15000 });   // nach dem Wandern: Lage 2, Plakat mit

var running = null;                                          // laufender Firefox (der Worker beendet ihn beim Abbruch)
function shot(port, sc, done) {
  var prof = fs.mkdtempSync(path.join(os.tmpdir(), 'pnvis-'));
  var keys = (sc.keys ? '&keys=' + sc.keys + '&wait=1800' : '') + (sc.moves ? '&moves=' + sc.moves + '&mwait=' + (sc.mwait || 2500) : '');
  var hold = sc.hold || 3500 + (sc.keys ? sc.keys.split(',').length * 400 + 1800 : 0) + (sc.moves ? sc.moves.split(',').length * 300 : 0);
  var url = 'file://' + path.join(ROOT, 'tools', 'preview.html') + '?clear=1&seed=' + encodeURIComponent('http://127.0.0.1:' + port + '/seed/' + sc.seed + '.js') +
    '&hold=' + hold + '&holdurl=' + encodeURIComponent('http://127.0.0.1:' + port + '/sleep') + keys + (MIN ? '&min=1' : '') +
    (LAYOUT ? '&probe=' + encodeURIComponent('http://127.0.0.1:' + port + '/layout?scene=' + encodeURIComponent(sc.name)) : '');
  var out = path.join(CUR, sc.name + '.png');
  try { fs.unlinkSync(out); } catch (e) {}
  running = cp.execFile(FIREFOX, ['--headless', '-no-remote', '-profile', prof, '--window-size=1280,720', '--screenshot', out, url], { timeout: 60000 }, function () {
    running = null;
    try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) {}
    done(fs.existsSync(out));
  });
}

/* Selbsttest der Layout-Pruefung (tools/layout_selftest.html): genau diese Befunde muessen kommen, sonst ist sie blind */
var LAYOUT_EXPECT = ['button x-btn x-btn-hint', 'clip x-clip', 'edge x-edge', 'notice x-note x-note-under', 'offscreen x-off', 'overlap x-ov-a x-ov-b', 'panel x-pa x-pb', 'ring x-hints x-ring', 'safe x-safe', 'spill x-spill-btn x-spill-dlg'];
function layoutSelftest(port, done) {
  var prof = fs.mkdtempSync(path.join(os.tmpdir(), 'pnvis-')), out = path.join(CUR, 'layout-selftest.png');
  var url = 'file://' + path.join(ROOT, 'tools', 'layout_selftest.html') + '?probe=' + encodeURIComponent('http://127.0.0.1:' + port + '/layout?scene=_selftest');
  cp.execFile(FIREFOX, ['--headless', '-no-remote', '-profile', prof, '--window-size=1280,720', '--screenshot', out, url], { timeout: 60000 }, function () {
    try { fs.rmSync(prof, { recursive: true, force: true }); fs.unlinkSync(out); } catch (e) {}
    var r = layoutRes._selftest, got = [];
    delete layoutRes._selftest;
    ((r && r.v) || []).forEach(function (v) {
      var ids = [v.a, v.b].filter(Boolean).map(function (x) { var m = /#((?:x|ok)-[\w-]+)(?!.*#)/.exec(x.p); return m ? m[1] : '?'; }).sort();
      got.push(v.t + ' ' + ids.join(' '));
    });
    got.sort();
    var ok = JSON.stringify(got) === JSON.stringify(LAYOUT_EXPECT);
    if (!ok) console.log('Layout-Selbsttest FEHLGESCHLAGEN (tools/layout_selftest.html)\n  erwartet: ' + LAYOUT_EXPECT.join(' | ') + '\n  bekommen: ' + (r && r.err ? r.err : got.join(' | ')));
    done(ok);
  });
}

/* ---------- Parallelbetrieb ----------
 * Jeder Worker ist ein eigener Node-Prozess (node tools/visual.js --worker) mit eigenem Mock-Server und Port: der Mock haelt
 * Zustand je Szene (curSeed, Seeds mit Port) und darf deshalb nie von zwei Szenen gleichzeitig benutzt werden.
 * Jeder Firefox bekommt wie bisher ein eigenes, frisches Profil -> gleiche Bilder wie nacheinander.
 * Gemessen 28.10.2026 (16 Kerne, Firefox 158, andere Agenten aktiv): 227 Szenen nacheinander 3029 s, 8 parallel 309-341 s;
 * 243 Szenen + Layout-Pruefung nacheinander 2614 s, 8 parallel 332 s. Bilder ausserhalb der zeitabhaengigen Masken pixelgleich
 * (201 von 243 byte-identisch, Rest nur Uhr/"Ende um"/Antwortzeit), Layout-Bericht gleich bis auf die Messdauer der Sonde.
 * Die Zeit steckt fast ganz im Warten der Szenen (Summe hold = 2241 s -> Untergrenze bei 8 parallel ~280 s); der Start eines
 * Firefox kostet ~0,75 s je Szene. Ein dauerhafter Browser je Worker (WebDriver BiDi) spart damit hoechstens ~20 s je Lauf,
 * liefert die Bilder aber ueber einen anderen Weg (captureScreenshot statt --screenshot) und teilt Zustand zwischen Szenen –
 * bewusst nicht umgesetzt. */
function worker() {
  startServer(function (srv, port) {
    makeSeeds(port);
    process.on('message', function (m) {
      var sc = SCENES.filter(function (s) { return s.name === m.name; })[0];
      if (m.selftest) return layoutSelftest(port, function (ok) { process.send({ selftest: ok }); });
      if (!sc) return process.send({ i: m.i, ok: false });
      shot(port, sc, function (ok) { var lr = layoutRes[sc.name]; delete layoutRes[sc.name]; process.send({ i: m.i, ok: ok, layout: lr }); });   // Layout-Befund kommt per POST vor dem Screenshot
    });
    process.on('disconnect', function () { if (running) try { running.kill('SIGKILL'); } catch (e) {} srv.close(); process.exit(0); });
    process.send({ ready: true });
  });
}

/* Rechnerweite Grenze fuer gleichzeitige Firefox (mehrere Laeufe, Agenten, Worktrees): je Szene ein Eintrag in LOCKDIR
 * '<zeit>-<pid>-<zufall>'. Die aeltesten MAX_TOTAL Eintraege duerfen rendern, spaetere warten (Warteschlange nach Zeit).
 * Verwaist = Prozess tot oder Eintrag > 3 min nicht aufgefrischt (Wartende frischen beim Nachsehen auf, Szenen dauern < 1 min). */
var held = {}, lastTs = 0;
function slotAcquire(cb, max, dir) {
  max = max === undefined ? MAX_TOTAL : max; dir = dir || LOCKDIR;
  if (!(max > 0)) return cb(function () {});
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  lastTs = Math.max(Date.now(), lastTs + 1);                    // eindeutig und aufsteigend je Prozess
  var name = ('000000000000000' + lastTs).slice(-15) + '-' + process.pid + '-' + Math.random().toString(36).slice(2, 10), me = path.join(dir, name);
  try { fs.writeFileSync(me, '', { flag: 'wx' }); } catch (e) { return cb(function () {}); }   // Sperrordner unbrauchbar -> ohne Grenze weiter
  held[me] = 1;
  function release() { delete held[me]; try { fs.unlinkSync(me); } catch (e) {} }
  (function check() {
    var live = [];
    try {
      fs.readdirSync(dir).forEach(function (f) {
        if (f === name) return live.push(f);
        var p = path.join(dir, f), stale = false;
        try { process.kill(Number(f.split('-')[1]), 0); } catch (e) { stale = e.code === 'ESRCH'; }
        try { if (Date.now() - fs.statSync(p).mtimeMs > 180000) stale = true; } catch (e) { return; }
        if (stale) { try { fs.unlinkSync(p); } catch (e) {} } else live.push(f);
      });
    } catch (e) { return cb(release); }
    live.sort();
    if (live.indexOf(name) < max) return cb(release);
    try { var t = new Date(); fs.utimesSync(me, t, t); } catch (e) {}
    setTimeout(check, 200 + Math.random() * 300);
  })();
}
process.on('exit', function () { for (var f in held) try { fs.unlinkSync(f); } catch (e) {} });

/* Auswahl: --only a,b,saver-*  (Namen oder Muster mit * und ?) */
function globRe(g) { return new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$'); }
function matchAny(name, globs) { return globs.some(function (g) { return globRe(g).test(name); }); }

/* --changed: nur Szenen, die von Aenderungen gegenueber main (oder PN_VIS_BASE) betroffen sein koennen – schnelles Nachsehen beim
 * Arbeiten; die volle Suite bleibt Pflicht vor dem Release. Gemeinsam genutzte/unbekannte Dateien (core, css, i18n, ui …) -> alle. */
var CHANGE_MAP = [
  [/^(docs|design|public|installer|loader)\/|^[^/]+\.md$|^tests\/(?!visual\/|synthetic\/)|^tools\/(?!visual\.js|preview\.html|build\.js|layout)|^src\/dev\//, []],
  [/^src\/(player\/|views\/player\.js|ui\/loupeview\.js)/, ['player-*', 'p5-player-*', 'accent-player-*', 'book-*', 'music-*']],
  [/^src\/(plex\/music\.js|views\/(album|artist|nowplaying)\.js|ui\/(miniplayer|tracklist|trackpanel)\.js)/, ['music-*', 'book-*', 'amb-music']],
  [/^src\/views\/(settings|pinsettings|help)\.js/, ['*settings*', 'p5-keys*', 'p2-*', 'accent-*']],
  [/^src\/(views|plex)\/search\.js|^src\/plex\/subsearch\.js/, ['search*', 'p4-discover*', 'p5-player-subs']],
  [/^src\/(plex\/discover\.js|views\/(extdetails|soon)\.js)/, ['p4-*']],
  [/^src\/(plex\/inspire\.js|views\/insprows\.js)/, ['p4-insp*', 'p4-settings-insp*']],
  [/^src\/(ui\/saver\.js|core\/saverlogic\.js|plex\/saverlib\.js)/, ['saver-*', 'p5-saver']],
  [/^src\/(views\/(login|profiles|start)\.js|plex\/(login|auth)\.js|ui\/(pinpad|pinlogic)\.js|core\/(apppin|setupfile)\.js)/, ['login', 'profiles', 'pin*', 'p2-*']],
  [/^src\/(views\/library\.js|plex\/library\.js|ui\/(grid|gridmath)\.js)/, ['library-*', 'amb-*', 'srv-library', 'accent-*']],
  [/^src\/(views\/details\.js|plex\/details\.js|ui\/(dethero|seasonstrip)\.js)/, ['details-*', 'p5-anime-*', 'srv-details*', 'p4-ext-details']],
  [/^src\/(core|ui)\/ambient\.js/, ['amb-*']],
  [/^src\/core\/accent\.js/, ['accent-*']],
  [/^src\/plex\/(servers|conntest)\.js/, ['srv-*', 'p5-conntest']],
  [/^src\/plex\/anime\.js/, ['p5-anime-*', 'p5-settings-anime']],
  [/^src\/(views\/home(rows)?\.js|plex\/(homerows|hubs)\.js|ui\/(hero|row|rowmath)\.js)/, ['home*', 'p4-insp*', 'accent-home-*', 'rail-*']],
  [/^src\/ui\/rail\.js/, ['rail-*', 'home-rail', 'srv-rail*', 'p4-discover-rail', 'accent-rail-*']]
];
function changedScenes() {
  var base = process.env.PN_VIS_BASE || 'main', files, mb;
  function vcs(a) { return cp.execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  function all() { console.log('--changed: ' + why + ' -> alle Szenen.'); return null; }
  var why = '';
  try {
    mb = vcs(['merge-base', base, 'HEAD']).trim();
    files = vcs(['diff', '--name-only', mb]).split('\n').concat(vcs(['ls-files', '--others', '--exclude-standard']).split('\n')).filter(Boolean);
  } catch (e) { why = 'Vergleich mit ' + base + ' nicht moeglich'; return all(); }
  var names = SCENES.map(function (s) { return s.name; }), pick = {};
  function add(globs) { names.forEach(function (n) { if (matchAny(n, globs)) pick[n] = 1; }); }
  for (var k = 0; k < files.length; k++) {
    var f = files[k], m = /^tests\/visual\/baseline\/(.+)\.png$/.exec(f), hit = null;
    if (m) { pick[m[1]] = 1; continue; }
    if (/^tests\/visual\//.test(f)) continue;
    if (f === 'tools/visual.js') {               // neue/geaenderte Szenen (Definition oder Seed) gegenueber dem Stand an der Abzweigung
      var d = null;
      try { d = sceneDiff(vcs(['show', mb + ':tools/visual.js'])); } catch (e) {}
      if (d && d.length) { add(d); continue; }
      why = 'tools/visual.js geaendert, aber keine Szene/kein Seed (Mock?)'; return all();
    }
    for (var r = 0; r < CHANGE_MAP.length && !hit; r++) if (CHANGE_MAP[r][0].test(f)) hit = CHANGE_MAP[r][1];
    if (!hit) { why = f + ' betrifft viele Ansichten'; return all(); }
    add(hit);
  }
  names.forEach(function (n) { if (!fs.existsSync(path.join(BASE, n + '.png'))) pick[n] = 1; });   // Szenen ohne Baseline immer
  console.log('--changed: ' + files.length + ' geaenderte Datei(en) gegenueber ' + base + ' -> ' + Object.keys(pick).length + ' Szene(n).');
  return Object.keys(pick);
}
function seedsFor(port) { makeSeeds(port); return seeds; }
/* Szenen, deren Definition oder Seed sich zwischen zwei Staenden von tools/visual.js unterscheidet (Zeitstempel ausgeblendet) */
function sceneSig(mod, withSeeds) {
  var sd = withSeeds ? mod.seedsFor(1) : null, o = {};
  mod.SCENES.forEach(function (s) { o[s.name] = JSON.stringify(s) + (sd ? String(sd[s.seed]).replace(/\d{13}/g, 'T') : ''); });
  return o;
}
function sceneDiff(oldSrc) {
  var tmp = path.join(__dirname, '.visual-base-' + process.pid + '.js');
  try {
    fs.writeFileSync(tmp, oldSrc);
    var old = require(tmp), both = !!old.seedsFor, a = sceneSig(old, both), b = sceneSig({ SCENES: SCENES, seedsFor: seedsFor }, both), out = [];
    for (var n in b) if (a[n] !== b[n]) out.push(n);
    return out;
  } catch (e) { return null; } finally { try { fs.unlinkSync(tmp); } catch (e) {} }
}

function main() {
  if (WORKER) return worker();
  if (APPROVE) {
    fs.mkdirSync(BASE, { recursive: true });
    var n = 0;
    fs.readdirSync(CUR).filter(function (f) { return /\.png$/.test(f) && !/^diff-/.test(f); }).forEach(function (f) { fs.copyFileSync(path.join(CUR, f), path.join(BASE, f)); n++; });
    console.log(n + ' Bilder als Baseline uebernommen (tests/visual/baseline/).');
    return;
  }
  if (!fs.existsSync(FIREFOX)) { console.error('Firefox nicht gefunden (' + FIREFOX + '), FIREFOX=… setzen.'); process.exit(2); }
  fs.mkdirSync(CUR, { recursive: true });
  var pick = CHANGED ? changedScenes() : null;
  var scenes = SCENES.filter(function (s) { return (!ONLY || matchAny(s.name, ONLY)) && (!pick || pick.indexOf(s.name) >= 0); });
  if (!scenes.length) {
    if (ONLY && !CHANGED) { console.error('Keine Szene passt zu --only ' + ONLY.join(',') + '.'); process.exit(2); }
    return console.log('Keine betroffene Szene – nichts zu rendern.');
  }
  if (args.indexOf('--list') >= 0) return console.log(scenes.map(function (s) { return s.name; }).join('\n'));
  var jobs = Math.min(JOBS, scenes.length), t0 = Date.now(), W = String(scenes.length).length;
  console.log('Build: app/' + APPFILE + ' · ' + scenes.length + ' Szene(n) · ' + jobs + ' parallel (PN_VIS_JOBS)' +
    (MAX_TOTAL > 0 ? ' · rechnerweit hoechstens ' + MAX_TOTAL + ' Firefox (PN_VIS_MAX)' : ''));
  process.on('SIGINT', function () { process.exit(130); });
  process.on('SIGTERM', function () { process.exit(143); });
  runPool({ script: __filename, args: (MIN ? [] : ['--readable']).concat(LAYOUT ? [] : ['--no-layout']), jobs: jobs, names: scenes.map(function (s) { return s.name; }),
    selftest: LAYOUT, onSelftest: function (ok) { if (!ok) process.exitCode = 1; },   // Selbsttest der Layout-Pruefung zuerst
    onResult: function (m, done, secs) {
      if (m.layout) layoutRes[scenes[m.i].name] = m.layout;
      console.log('[' + ('    ' + done).slice(-W) + '/' + scenes.length + '] ' + scenes[m.i].name + ' ' + (m.ok ? 'ok' : 'FEHLT') + ' (' + secs.toFixed(1) + ' s)');
    },
    done: function (rs) {
      console.log('Gerendert in ' + Math.round((Date.now() - t0) / 1000) + ' s.');
      report(rs.map(function (m, i) { return { sc: scenes[i], ok: m.ok }; }));                            // Bericht in fester Szenen-Reihenfolge
    } });
}
/* Job-Pool (auch fuer andere Bildtest-Laeufer, die ihn importieren): o.jobs Worker-Prozesse "node <o.script> --worker <o.args>", je Auftrag ein
 * rechnerweiter Platz (slotAcquire, PN_VIS_MAX). Protokoll: Worker meldet {ready}; bekommt {i, name} bzw. {selftest: true} und
 * antwortet {i, ok, layout} bzw. {selftest: ok}. o.onResult(m, fertig, sekunden) je Szene, o.done(ergebnisse) mit einem Eintrag
 * je Name in Auftragsreihenfolge (abgestuerzter Worker -> ok: false). */
function runPool(o) {
  var n = o.names.length, jobs = Math.max(1, Math.min(o.jobs, n)), results = new Array(n), next = 0, selfPending = !!o.selftest, done = 0, exited = 0;
  for (var w = 0; w < jobs; w++) spawnWorker();
  function spawnWorker() {
    var ch = cp.fork(o.script, ['--worker'].concat(o.args || []), { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] }), cur = -1, rel = null, ts = 0;
    function free() { if (rel) { rel(); rel = null; } }
    function feed() {
      if (selfPending) { selfPending = false; cur = -2; return slotAcquire(function (r) { rel = r; ch.send({ selftest: true }); }); }
      if (next >= n) return ch.disconnect();
      cur = next++;
      slotAcquire(function (r) { rel = r; ts = Date.now(); ch.send({ i: cur, name: o.names[cur] }); });
    }
    ch.on('message', function (m) {
      if (m.ready) return feed();
      free();
      if (m.selftest !== undefined) { if (o.onSelftest) o.onSelftest(m.selftest); cur = -1; return feed(); }
      results[m.i] = m; cur = -1; done++;
      if (o.onResult) o.onResult(m, done, (Date.now() - ts) / 1000);
      feed();
    });
    ch.on('exit', function () {
      free();
      if (cur >= 0 && !results[cur]) { results[cur] = { i: cur, ok: false }; done++; }
      if (++exited === jobs) {
        for (var i = 0; i < n; i++) if (!results[i]) results[i] = { i: i, ok: false };                   // Worker abgestuerzt
        o.done(results);
      }
    });
  }
}
function report(results) {
  var lay = LAYOUT ? layoutReport(results) : 0;
  if (LAYOUT_ONLY) { if (lay) process.exit(1); return; }
  var fail = 0, missing = 0;
  console.log('\nSzene                 Abweichung   Ergebnis');
  results.forEach(function (r) {
    var name = r.sc.name, cur = path.join(CUR, name + '.png'), base = path.join(BASE, name + '.png'), line = (name + '                      ').slice(0, 22);
    if (!r.ok) { fail++; console.log(line + '-            Render fehlgeschlagen'); return; }
    if (!fs.existsSync(base)) { missing++; console.log(line + '-            keine Baseline (npm run visual:approve)'); return; }
    var c = compare(readPng(cur), readPng(base), r.sc.mask);
    var pct = (c.ratio * 100).toFixed(3) + ' %', bad = c.diff < 0 || c.ratio > MAX_RATIO;
    if (bad) { fail++; if (c.img) fs.writeFileSync(path.join(CUR, 'diff-' + name + '.png'), writePng(1280, 720, c.img)); }
    console.log(line + (pct + '          ').slice(0, 13) + (bad ? 'ABWEICHUNG (tests/visual/current/diff-' + name + '.png)' : 'gleich'));
  });
  console.log('\n' + (results.length - fail - missing) + ' gleich, ' + fail + ' abweichend/fehlerhaft, ' + missing + ' ohne Baseline.');
  if (fail || missing || lay) process.exit(1);
}
/* Layout-Pruefung auswerten -> Anzahl neuer Befunde (+ Szenen ohne Ergebnis) */
function layoutReport(results) {
  var LC = require('./layoutcheck.js'), list = LC.loadAllow();
  var rep = LC.report(CUR, results.map(function (r) { return { name: r.sc.name, res: layoutRes[r.sc.name], png: path.join(CUR, r.sc.name + '.png') }; }), list,
    { readPng: readPng, writePng: writePng }, results.length === SCENES.length);   // nur voller Lauf meldet unbenutzte Erlaubnisse
  console.log('');
  LC.print(rep);
  return rep.fail + rep.missing.length;
}

if (require.main === module) main();
module.exports = { compare: compare, readPng: readPng, writePng: writePng, solidPng: solidPng, startServer: startServer, makeSeeds: makeSeeds, SCENES: SCENES,
  slotAcquire: slotAcquire, matchAny: matchAny, seedsFor: seedsFor, runPool: runPool, JOBS: JOBS, MAX_TOTAL: MAX_TOTAL, LIB: LIB };
