#!/usr/bin/env node
/* visuelle Regression (Nutzer-Anforderung M2).
 *   node tools/visual.js            Ansichten mit synthetischen Daten rendern -> tests/visual/current/, mit baseline/ vergleichen
 *   node tools/visual.js --approve  aktuelle Bilder als neue Baseline uebernehmen
 *   node tools/visual.js --only home,login
 *   PN_VIS_OUT=/pfad node tools/visual.js --only …   Ausgabe in eigenen Ordner (parallele Laeufe teilen sonst tests/visual/current)
 *   node tools/visual.js --readable   gegen app/app.js statt app/app.min.js (Standard: der minifizierte Release-Build, P7)
 * Rendert tools/preview.html in Firefox headless (1280x720) gegen einen lokalen Mock (PMS + plex.tv-Proxy + Bilder),
 * daher ohne Netz und ohne Geheimnisse. Vergleich pixelweise (Kanal-Toleranz 24, Schwelle 0,2 % der Flaeche, Masken
 * fuer zeitabhaengige Bereiche). Ausgabe: Bericht + diff-*.png (rot = Abweichung). */
'use strict';
var fs = require('fs'), path = require('path'), http = require('http'), zlib = require('zlib'), cp = require('child_process'), os = require('os');
var ROOT = path.join(__dirname, '..'), SYN = path.join(ROOT, 'tests', 'synthetic'), VIS = path.join(ROOT, 'tests', 'visual');
var CUR = process.env.PN_VIS_OUT ? path.resolve(process.env.PN_VIS_OUT) : path.join(VIS, 'current'), BASE = path.join(VIS, 'baseline');   // PN_VIS_OUT: eigener Ausgabeordner (parallele Laeufe)
var FIREFOX = process.env.FIREFOX || '/Applications/Firefox.app/Contents/MacOS/firefox';
var TOL = 24, MAX_RATIO = 0.002;
var args = process.argv.slice(2), APPROVE = args.indexOf('--approve') >= 0;
var ONLY = (function () { var i = args.indexOf('--only'); return i >= 0 ? args[i + 1].split(',') : null; })();
var MIN = args.indexOf('--readable') < 0, APPFILE = MIN ? 'app.min.js' : 'app.js';
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
  al.sort(function (a, b) { return a.titleSort < b.titleSort ? -1 : 1; });
  function tracks(alb) {
    var k = Number(alb.ratingKey) - 9200, out = [];
    for (var t = 1; t <= 9; t++) out.push({ ratingKey: String(9300 + k * 20 + t), type: 'track', title: 'Lied Nummer ' + t, index: t, parentIndex: 1, parentTitle: alb.title,
      parentRatingKey: alb.ratingKey, grandparentTitle: alb.parentTitle, grandparentRatingKey: alb.parentRatingKey, parentThumb: alb.thumb, grandparentArt: alb.nocover ? alb.art : undefined, duration: 180000 + t * 7000,
      Media: [{ audioCodec: 'mp3', container: 'mp3', Part: [{ id: 9300 + k * 20 + t, key: '/library/parts/' + (9300 + k * 20 + t) + '/1/file.mp3', duration: 180000 + t * 7000 }] }] });
    return out;
  }
  return { ar: ar, al: al, tracks: tracks };
})();
function musicRoute(p, q) {
  var m = /^\/library\/sections\/3\/(all|firstCharacter|collections|prefs)$/.exec(p), list, i;
  if (m) {
    if (m[1] === 'prefs') return { MediaContainer: { Setting: [{ id: 'enableTrackOffsets', value: false }] } };
    if (m[1] === 'collections') return page([], q);
    list = q.get('type') === '9' ? MUS.al.slice() : MUS.ar.slice();
    if (/titleSort:desc/.test(String(q.get('sort')))) list.reverse();
    if (m[1] === 'firstCharacter') return firstChars(list);
    var pa = page(list, q); pa.MediaContainer.librarySectionID = 3; return pa;
  }
  m = /^\/library\/metadata\/(9\d\d\d)(\/children|\/allLeaves)?$/.exec(p);
  if (!m) return null;
  var rk = m[1];
  for (i = 0; i < MUS.ar.length; i++) if (MUS.ar[i].ratingKey === rk) {
    var a = MUS.ar[i], als = MUS.al.filter(function (x) { return x.parentRatingKey === rk; });
    if (m[2] === '/children') return { MediaContainer: { size: als.length, librarySectionID: 3, Metadata: als } };
    if (m[2] === '/allLeaves') return { MediaContainer: { size: 18, Metadata: MUS.tracks(als[0]).concat(MUS.tracks(als[1])) } };
    var x = JSON.parse(JSON.stringify(a)); x.librarySectionID = 3; x.PopularLeaves = { size: 5, Metadata: MUS.tracks(als[0]).slice(0, 5) };
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
  names.forEach(function (n, i) { out.push({ guid: sguid(type, 70000 + (movie ? 0 : 100) + i), name: n, year: 2020 + i, type: type, summary: 'Synthetische Beschreibung eines Titels, der nicht auf dem Server liegt.', thumb: i === 2 ? undefined : 'https://images.example/' + type + i }); });
  return { MediaContainer: { size: out.length, SearchResult: ql.length >= 2 ? out : [] } };
}
function byGuid(list) {
  var want = String(list || '').split(','), out = [];
  [1, 2].forEach(function (id) { LIB[id].forEach(function (m) { if (want.indexOf(sguid(m.type, m.ratingKey)) >= 0) { var c = JSON.parse(JSON.stringify(m)); c.guid = sguid(m.type, m.ratingKey); out.push(c); } }); });
  return { MediaContainer: { size: out.length, Metadata: out } };
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
/* F25: Seitenleiste mit langen Bibliotheksnamen (nur Szenen mit Seed longLib*) */
var curSeed = '';
function longSections() {
  var s = syn('sections.json');
  s.MediaContainer.Directory.push({ key: '4', type: 'artist', title: 'Hörbücher & Hörspiele', agent: 'tv.plex.agents.music', hidden: 0 });
  s.MediaContainer.Directory[4].title = 'Dokumentationen, Reportagen und Naturfilme';
  return s;
}
function startServer(cb) {
  var sink = { on: null };                                   // tools/bench.js: Protokollzeilen der Vorschau (&logurl=)
  var srv = http.createServer(function (req, res) {
    var u = new URL(req.url, 'http://x'), p = u.pathname;
    function cors() { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', '*'); res.setHeader('Access-Control-Allow-Methods', '*'); }
    function json(o, code) { cors(); res.writeHead(code || 200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); }
    if (req.method === 'OPTIONS') { cors(); res.writeHead(200); return res.end(); }
    if (p === '/log' && req.method === 'POST') {
      var body = ''; req.on('data', function (c) { body += c; });
      return req.on('end', function () { cors(); res.writeHead(200); res.end(); if (sink.on) body.split('\n').forEach(function (l) { if (l) sink.on(l); }); });
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
    var empty = p.indexOf('/leer') === 0;                    // Server ohne Inhalte (Leerzustand)
    if (!empty && p.indexOf('/pms') !== 0) { res.writeHead(404); return res.end(); }
    p = p.slice(empty ? 5 : 4);
    if (empty && p !== '/photo/:/transcode') return json({ MediaContainer: { size: 0 } });
    if (p === '/photo/:/transcode') {
      var w = Math.min(1280, Number(u.searchParams.get('width')) || 100), h = Math.min(720, Number(u.searchParams.get('height')) || 100);
      var src = u.searchParams.get('url') || '';
      if (u.searchParams.get('blur') && w >= 640 && !/\/a\/|\/art\//.test(src)) { cors(); res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(posterPng(w, colorFor(src))); }
      cors(); res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(solidPng(w, h, colorFor(u.searchParams.get('url') || '')));
    }
    if (p === '/library/sections') return json(/^longLib/.test(curSeed) ? longSections() : syn('sections.json'));
    if (p === '/hubs/continueWatching/items') return json(noArt(withVersions(syn('continueWatching.json'))));
    if (p === '/library/onDeck') return json(syn('onDeck.json'));
    if (/^\/hubs\/sections\/[12]$/.test(p) && u.searchParams.get('count') === '20') return json(inspHubs(p.slice(-1)));   // Entdecken: Inspiration (count=20)
    if (p === '/hubs/sections/1') return json(syn('hubs-1.json'));          // Server-Hubs (Startseite anpassen)
    if (p === '/hubs') return json({ MediaContainer: { size: 1, Hub: [{ hubIdentifier: 'home.playlists', type: 'playlist', title: 'Zuletzt genutzte Playlists', size: 0 }] } });
    if (p === '/hubs/home/recentlyAdded') { var f = 'recent-' + u.searchParams.get('sectionID') + '.json'; return json(fs.existsSync(path.join(SYN, f)) ? syn(f) : { MediaContainer: { size: 0 } }); }
    if (p === '/video/:/transcode/universal/decision') return json(syn('decision-direct.json'));
    if (p === '/playQueues' && req.method === 'POST') return json(playQueue(new URL(u.searchParams.get('uri').replace('server://', 'http://')).pathname.split('/').pop()));
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
  });
  srv.listen(0, '127.0.0.1', function () { cb(srv, srv.address().port, sink); });
}

/* Player: Metadaten aus den synthetischen Karten + Spuren aus meta-anime.json; Marker je Szene (rk 1001 Intro um die
 * Fortsetzen-Stelle -> Skip-Button, 1101 finaler Abspann -> Countdown), Film 2001 mit Vorschaubildern (indexes=sd) */
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
  // Zeiger-Randzone: Verweilen loest nie aus (ptrEdgeDwell) -> stehende Anzeige-Pille; Zeiger aus -> abhaengige Einstellung grau
  seeds.ptrHold = seed({}, null, JSON.stringify({ readOnly: true, proxyHost: '127.0.0.1:' + port + '/tv', cursor: 'system', fixedClock: '21:34', welcome: false, ptrEdgeDwell: 600000 }));
  seeds.ptrHoldPlay = seed({}, null, JSON.stringify({ readOnly: true, proxyHost: '127.0.0.1:' + port + '/tv', cursor: 'system', sefFake: 'still', seekDelay: 600000, fixedClock: '21:34', welcome: false, ptrEdgeDwell: 600000 }));
  seeds.ptrOff = seed({ pointer: false });
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
  seeds.noart = seed();                                                                               // Hero ohne Art: Poster unscharf
  seeds.noartOff = seed({}, { 'settings-aaaa1111.json': { backgrounds: false } });                   // ... Hintergrundbilder aus: einfarbig
  seeds.empty = seed({ server: { uri: base + '/leer', machineId: 'mid', name: 'Leer', token: 'T' } });
  // P5: Willkommenskarte (erster Start des Profils), Bildschirmschoner nach 1,5 s, Spoilerschutz + Uhr aus
  seeds.welcome = seed(null, null, JSON.stringify({ readOnly: true, proxyHost: '127.0.0.1:' + port + '/tv', cursor: 'system', fixedClock: '21:34' }));
  seeds.saver = seed(null, null, JSON.stringify({ readOnly: true, proxyHost: '127.0.0.1:' + port + '/tv', cursor: 'system', fixedClock: '21:34', welcome: false, saverMs: 1500 }));
  seeds.spoiler = seed({}, { 'settings-aaaa1111.json': { spoiler: true, clock: false } });
  // Anime je Titel: alle synthetischen Serien per eigener Markierung als Anime; Variante mit ausgeblendeter Kategorie
  var animeOv = { 900: 1, 910: 1 };
  for (var ai = 0; ai < 30; ai++) animeOv[5100 + ai * 10] = 1;
  seeds.anime = seed({}, { 'anime-aaaa1111.json': animeOv });
  // Akzentfarbe (N.accent): Profil mit eigener Farbe; state.accent = zuletzt genutzte Farbe (Start ohne Farbsprung)
  seeds.violet = seed({ accent: 'violet' }, { 'settings-aaaa1111.json': { accent: 'violet' } });
  seeds.coral = seed({ accent: 'coral' }, { 'settings-aaaa1111.json': { accent: 'coral' } });
  seeds.coralPlay = seed({ accent: 'coral' }, { 'settings-aaaa1111.json': { accent: 'coral' } }, cfgPlay);
  seeds.animeHidden = seed({}, { 'anime-aaaa1111.json': animeOv, 'settings-aaaa1111.json': { animeShow: false } });
}
var LOGIN_MASK = [[144, 476, 640, 70]];
var CLOCK = [[896, 36, 320, 72]];                     // Uhrzeit + "Ende um" im Player               // Countdown + Spinner
var SCENES = [
  // P2: nur PMS (setup.json) + App-PIN je Profil
  { name: 'p2-profiles', seed: 'pkg' },
  { name: 'p2-account', seed: 'pkg', keys: 'ENTER,wait800,LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,DOWN,RIGHT,DOWN' },
  { name: 'p2-pin-new', seed: 'pkg', keys: 'ENTER,wait800,LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,DOWN,RIGHT,DOWN,ENTER' },
  { name: 'p2-pin-mismatch', seed: 'pkg', keys: 'ENTER,wait800,LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,DOWN,RIGHT,DOWN,ENTER,1,2,3,4,wait600,5,6,7,8,wait600' },
  { name: 'p2-pins-all', seed: 'pkg', keys: 'ENTER,wait800,LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,ENTER' },
  { name: 'p2-pin-kid', seed: 'pkg', keys: 'RIGHT,ENTER,9,9,9,9,wait600' },
  { name: 'login', seed: 'login', mask: LOGIN_MASK },
  { name: 'profiles', seed: 'multi' },
  { name: 'pin', seed: 'multi', keys: 'LEFT,ENTER,1,2' },
  { name: 'pin-wrong', seed: 'multi', keys: 'LEFT,ENTER,9,9,9,9' },
  { name: 'home', seed: 'home' },
  { name: 'home-en', seed: 'en' },
  { name: 'home-row2', seed: 'home', keys: 'DOWN,RIGHT' },
  { name: 'home-poster', seed: 'home', keys: 'DOWN,DOWN,RIGHT,RIGHT', mask: [[320, 270, 600, 34]] },   // "Ende um HH:MM" haengt von der Uhr ab
  { name: 'home-rail', seed: 'home', keys: 'LEFT,DOWN' },
  { name: 'home-tools', seed: 'home', keys: 'TOOLS' },
  { name: 'home-markshow', seed: 'home', keys: 'DOWN,DOWN,DOWN,RIGHT,YELLOW' },
  { name: 'home-empty', seed: 'empty' },
  { name: 'home-noart', seed: 'noart' },                 // TV 27.10.: Titel ohne Art -> Serienposter unscharf (Server-blur), mittig beschnitten
  { name: 'home-noart-off', seed: 'noartOff' },          // Einstellung Hintergrundbilder aus -> einfarbig wie bisher
  { name: 'settings', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT' },
  { name: 'settings-diag', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,DOWN,DOWN,RIGHT' },
  { name: 'search', seed: 'home', keys: 'BLUE' },
  { name: 'search-123', seed: 'home', keys: 'BLUE,wait600,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER' },
  { name: 'search-results', seed: 'home', keys: 'BLUE,wait600,ENTER,RIGHT,ENTER,wait1500,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,DOWN' },
  { name: 'search-empty', seed: 'home', keys: 'BLUE,wait600,9,wait1000,9,9,9,wait1500' },
  { name: 'p4-discover', seed: 'home', keys: 'LEFT,UP,ENTER,wait800' },
  { name: 'p4-discover-rail', seed: 'home', keys: 'LEFT,UP' },
  { name: 'p4-discover-results', seed: 'home', keys: 'LEFT,UP,ENTER,wait600,ENTER,RIGHT,ENTER,wait2500,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT' },
  { name: 'p4-discover-ext', seed: 'home', keys: 'LEFT,UP,ENTER,wait600,ENTER,RIGHT,ENTER,wait2500,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,DOWN' },
  { name: 'p4-ext-details', seed: 'home', keys: 'LEFT,UP,ENTER,wait600,ENTER,RIGHT,ENTER,wait2500,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,DOWN,ENTER,wait1200' },
  { name: 'p4-insp-rows', seed: 'home', keys: 'LEFT,UP,ENTER,wait1500,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,DOWN,DOWN,DOWN,wait800' },   // Inspiration: Fokus in der 4. Reihe
  { name: 'p4-insp-back', seed: 'home', keys: 'LEFT,UP,ENTER,wait1500,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,RIGHT,DOWN,RIGHT,ENTER,wait1200,RETURN,wait900' },   // Detailseite und zurueck: Fokus bleibt in der Reihe
  { name: 'p4-insp-cleared', seed: 'home', keys: 'LEFT,UP,ENTER,wait600,ENTER,RIGHT,ENTER,wait2500,RED,wait1500' },   // Eingabe geloescht -> Reihen wieder da
  { name: 'p4-insprows', seed: 'insp', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,wait600' },   // Einstellungen > Inspiration anpassen
  { name: 'p4-settings-watchlist', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN' },
  { name: 'settings-homerows', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,ENTER,DOWN' },
  { name: 'settings-homerows-move', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,ENTER,DOWN,DOWN,DOWN,YELLOW,UP' },
  { name: 'home-custom', seed: 'custom' },
  { name: 'settings-railitems', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,ENTER,DOWN' },   // W1: Seitenleiste anpassen
  { name: 'home-rail-custom', seed: 'railCustom', keys: 'LEFT' },                     // W1: Serien oben, Suche und Dokus aus
  { name: 'player-resume', seed: 'play', keys: 'ENTER' },
  { name: 'player-skip', seed: 'play', keys: 'ENTER,ENTER' },
  { name: 'player-osd', seed: 'play', keys: 'RIGHT,RIGHT,ENTER,ENTER,wait800,PAUSE', mask: CLOCK },
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
  { name: 'settings-still', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER' },
  // P5 Einstellungen & Komfort
  { name: 'p5-settings-subs', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN' },
  { name: 'p5-settings-anime', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,RIGHT,DOWN' },
  { name: 'p5-settings-display', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN' },
  // Zeiger-Scrollen beschleunigen (abhaengig von Zeiger-Steuerung): an, Zeiger-Steuerung selbst (Erklaerung mit "Aus: …"), Zeiger aus = grau, englisch
  { name: 'settings-ptraccel', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,UP,UP' },
  { name: 'settings-pointer', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,UP,UP,UP' },
  { name: 'settings-ptraccel-off', seed: 'ptrOff', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,UP,UP' },
  { name: 'settings-ptraccel-en', seed: 'ptrEn', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,UP,UP' },
  { name: 'settings-pointer-en', seed: 'ptrEn', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,UP,UP,UP' },
  { name: 'p5-settings-help', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN' },
  { name: 'p5-settings-boost', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN' },
  { name: 'p5-keys', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,RIGHT,ENTER,DOWN,DOWN,DOWN,DOWN,DOWN' },
  { name: 'p5-conntest', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,ENTER,wait1500', mask: [[872, 112, 376, 30]] },
  // Anime je Titel (docs/TODO.md "Anime-Erkennung"): Ueberzeile, Grund im INFO-Panel, TOOLS-Eintraege, Kategorie ausgeblendet
  { name: 'p5-anime-details', seed: 'anime', keys: 'LEFT,DOWN,DOWN,ENTER,wait800,RIGHT,ENTER,wait800' },
  { name: 'p5-anime-info', seed: 'anime', keys: 'LEFT,DOWN,DOWN,ENTER,wait800,RIGHT,ENTER,wait800,INFO' },
  { name: 'p5-anime-menu', seed: 'anime', keys: 'LEFT,DOWN,DOWN,ENTER,wait800,RIGHT,ENTER,wait800,TOOLS' },
  { name: 'p5-anime-hidden', seed: 'animeHidden', keys: 'LEFT,DOWN,DOWN,ENTER,wait800,RIGHT,ENTER,wait800,INFO' },
  { name: 'p5-welcome', seed: 'welcome', keys: 'wait3500' },
  { name: 'p5-saver', seed: 'saver', keys: 'wait3500' },
  { name: 'p5-spoiler', seed: 'spoiler', keys: 'DOWN' },
  // Akzentfarbe: Einstellung (Farbfeld), Auswahl mit Farbfeldern, Wechsel wirkt sofort; Startseite/Seitenleiste in anderen Farben
  { name: 'accent-setting', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN' },
  { name: 'accent-picker', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN' },
  { name: 'accent-live', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,RIGHT,DOWN,DOWN,DOWN,ENTER,DOWN,DOWN,DOWN,DOWN,ENTER' },
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
  { name: 'details-show', seed: 'home', keys: 'LEFT,DOWN,DOWN,ENTER,wait800,RIGHT,ENTER' },
  { name: 'details-show-eps', seed: 'home', keys: 'LEFT,DOWN,DOWN,ENTER,wait800,RIGHT,ENTER,wait800,DOWN,DOWN', mask: [[144, 124, 1000, 26]] },
  { name: 'details-show-noart', seed: 'home', keys: 'LEFT,DOWN,DOWN,ENTER,wait800,9,9,9,9,wait1500,ENTER,wait800' },
  { name: 'details-show-noart-eps', seed: 'home', keys: 'LEFT,DOWN,DOWN,ENTER,wait800,9,9,9,9,wait1500,ENTER,wait800,DOWN,DOWN', mask: [[144, 124, 1000, 26]] },
  { name: 'details-show-cells', seed: 'home', keys: 'LEFT,DOWN,DOWN,ENTER,wait800,RIGHT,ENTER,wait800,DOWN,RIGHT,wait800,DOWN' },
  { name: 'settings-play-end', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,ENTER,RIGHT,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN' },
  // M4 Musik (Bibliothek 3 "Musik"): quadratische Karten, Alben-Reiter, Album-/Kuenstlerseite, Jetzt laeuft, Mini-Player
  { name: 'music-artists', seed: 'play', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800' },
  { name: 'music-albums', seed: 'play', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,UP,LEFT,ENTER,wait800' },
  { name: 'music-albums-list', seed: 'play', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,UP,LEFT,ENTER,wait800,DOWN,RED,RIGHT,RIGHT,DOWN,DOWN,DOWN,ENTER,RETURN,wait800' },
  { name: 'music-album', seed: 'play', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,UP,LEFT,ENTER,wait800,DOWN,ENTER,wait800' },
  { name: 'music-album-tracks', seed: 'play', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,UP,LEFT,ENTER,wait800,DOWN,ENTER,wait800,DOWN,DOWN,DOWN' },
  { name: 'music-album-ptr', seed: 'ptrHoldPlay', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,UP,LEFT,ENTER,wait800,DOWN,ENTER,wait800,DOWN,DOWN,DOWN', mwait: 11500, moves: '600:400,600:420,600:640,600:644' },   // angeschnittene 7. Zeile = Randzone
  { name: 'music-artist', seed: 'play', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,ENTER,wait800' },
  { name: 'music-artist-albums', seed: 'play', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,ENTER,wait800,DOWN' },
  { name: 'music-nowplaying', seed: 'play', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,UP,LEFT,ENTER,wait800,DOWN,ENTER,wait800,ENTER,wait800' },
  { name: 'music-queue', seed: 'play', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,UP,LEFT,ENTER,wait800,DOWN,ENTER,wait800,ENTER,wait800,YELLOW' },
  { name: 'music-mini', seed: 'play', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,UP,LEFT,ENTER,wait800,DOWN,ENTER,wait800,ENTER,wait800,RETURN,wait1500' },
  // TV-Test 27.10. nachmittags (F24–F30): heller Hintergrund, Titelkarten ohne Cover, Mini-Player (Pause, Platz, A–Z), lange Namen
  { name: 'music-np-nocover', seed: 'play', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,UP,LEFT,ENTER,wait800,DOWN,RIGHT,RIGHT,ENTER,wait800,ENTER,wait800' },
  { name: 'music-mini-nocover', seed: 'play', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,UP,LEFT,ENTER,wait800,DOWN,RIGHT,RIGHT,ENTER,wait800,ENTER,wait800,PAUSE,RETURN,wait1500' },
  { name: 'music-mini-list', seed: 'play', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,UP,LEFT,ENTER,wait800,DOWN,ENTER,wait800,ENTER,wait800,RETURN,wait1500,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,DOWN,wait800' },
  { name: 'music-mini-lib', seed: 'play', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,UP,LEFT,ENTER,wait800,DOWN,ENTER,wait800,ENTER,wait800,RETURN,wait800,RETURN,wait1500' },
  { name: 'music-artist-bright', seed: 'play', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait800,RIGHT,ENTER,wait800' },
  { name: 'rail-long', seed: 'longLib', keys: 'LEFT' },
  { name: 'rail-long-en', seed: 'longLibEn', keys: 'LEFT' }
];

function shot(port, sc, done) {
  var prof = fs.mkdtempSync(path.join(os.tmpdir(), 'pnvis-'));
  var keys = (sc.keys ? '&keys=' + sc.keys + '&wait=1800' : '') + (sc.moves ? '&moves=' + sc.moves + '&mwait=' + (sc.mwait || 2500) : '');
  var hold = 3500 + (sc.keys ? sc.keys.split(',').length * 400 + 1800 : 0) + (sc.moves ? sc.moves.split(',').length * 300 : 0);
  var url = 'file://' + path.join(ROOT, 'tools', 'preview.html') + '?clear=1&seed=' + encodeURIComponent('http://127.0.0.1:' + port + '/seed/' + sc.seed + '.js') +
    '&hold=' + hold + '&holdurl=' + encodeURIComponent('http://127.0.0.1:' + port + '/sleep') + keys + (MIN ? '&min=1' : '');
  var out = path.join(CUR, sc.name + '.png');
  try { fs.unlinkSync(out); } catch (e) {}
  cp.execFile(FIREFOX, ['--headless', '-no-remote', '-profile', prof, '--window-size=1280,720', '--screenshot', out, url], { timeout: 60000 }, function () {
    try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) {}
    done(fs.existsSync(out));
  });
}

function main() {
  if (APPROVE) {
    fs.mkdirSync(BASE, { recursive: true });
    var n = 0;
    fs.readdirSync(CUR).filter(function (f) { return /\.png$/.test(f) && !/^diff-/.test(f); }).forEach(function (f) { fs.copyFileSync(path.join(CUR, f), path.join(BASE, f)); n++; });
    console.log(n + ' Bilder als Baseline uebernommen (tests/visual/baseline/).');
    return;
  }
  if (!fs.existsSync(FIREFOX)) { console.error('Firefox nicht gefunden (' + FIREFOX + '), FIREFOX=… setzen.'); process.exit(2); }
  fs.mkdirSync(CUR, { recursive: true });
  console.log('Build: app/' + APPFILE);
  var scenes = SCENES.filter(function (s) { return !ONLY || ONLY.indexOf(s.name) >= 0; });
  startServer(function (srv, port) {
    makeSeeds(port);
    var i = 0, results = [];
    (function next() {
      if (i >= scenes.length) { srv.close(); report(results); return; }
      var sc = scenes[i++];
      process.stdout.write('rendere ' + sc.name + ' … ');
      shot(port, sc, function (ok) { console.log(ok ? 'ok' : 'FEHLT'); results.push({ sc: sc, ok: ok }); next(); });
    })();
  });
}
function report(results) {
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
  if (fail || missing) process.exit(1);
}

if (require.main === module) main();
module.exports = { compare: compare, readPng: readPng, writePng: writePng, solidPng: solidPng, startServer: startServer, makeSeeds: makeSeeds };
