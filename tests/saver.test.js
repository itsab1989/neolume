'use strict';
/* Bildschirmschoner (core/saverlogic.js, plex/saverlib.js): Uebergaenge + Reduzierte Bewegung, Ken-Burns-Grenzen, Jalousie/Kacheln,
 * Zufallsbeutel, Bibliotheks-Pool (keine Wiederholung, Nachladen, neue Runde), Bibliotheks-Filter, Anfragen, Einblendungen,
 * Standardwerte. Reine Logik bzw. kuenstliches XHR, ohne Netz. */
var test = require('node:test'), assert = require('node:assert');
var H = require('./helpers/load'), eq = H.eq;
var ctx = H.load({ fakeTimers: true }), N = ctx.N;
N.log = function () {};
N.i18n.set('de');
var L = N.saverLogic;
function seq(list) { var i = 0; return function () { return list[i++ % list.length]; }; }

test('Uebergang: Standard Ueberblenden, Unbekanntes -> Ueberblenden, Reduzierte Bewegung -> nur ohne Bewegung', function () {
  assert.strictEqual(N.comfort.applyDefaults({}, false).saverFx, 'fade');
  ['cut', 'fade', 'dip', 'zoom', 'drift', 'fly', 'curtain', 'blinds', 'tiles'].forEach(function (f) {
    assert.strictEqual(L.fx(f, false), f);
    assert.strictEqual(L.fx(f, true), L.CALM[f] ? f : 'fade', 'reduziert: ' + f);
  });
  assert.strictEqual(L.fx('wobble', false), 'fade');
  assert.strictEqual(L.fx(undefined, true), 'fade');
  eq(L.FX, ['cut', 'fade', 'dip', 'zoom', 'drift', 'fly', 'curtain', 'blinds', 'tiles', 'random']);
});
test('Uebergang Zufaellig: nie Schnitt, nie zweimal derselbe; bei Reduzierter Bewegung nur Ueberblenden/Ueber Schwarz', function () {
  var seen = {}, last = '', r, i;
  for (i = 0; i < 400; i++) {
    r = L.fx('random', false, Math.random(), last);
    assert.notStrictEqual(r, 'cut'); assert.notStrictEqual(r, last); assert.ok(L.FX_MS[r] > 0);
    seen[r] = 1; last = r;
  }
  assert.strictEqual(Object.keys(seen).length, 8, 'alle bewegten und ruhigen Uebergaenge kommen vor');
  for (i = 0; i < 50; i++) { r = L.fx('random', true, Math.random(), last); assert.ok(r === 'fade' || r === 'dip'); assert.notStrictEqual(r, last); last = r; }
  assert.strictEqual(L.fx('random', false, 0.999999), 'tiles');
});
test('Bildwechsel: 10/20/30/60 s, Standard 30 s, ungueltig -> 30 s', function () {
  eq(L.SEC, [10, 20, 30, 60]);
  assert.strictEqual(L.interval(10), 10000); assert.strictEqual(L.interval('60'), 60000);
  assert.strictEqual(L.interval(7), 30000); assert.strictEqual(L.interval(undefined), 30000);
  assert.strictEqual(N.comfort.applyDefaults({}, false).saverInterval, 30);
});
test('Ken Burns: jede Pose bleibt im Bild (kein schwarzer Rand), Zoom/Gleiten bewegen sich wirklich', function () {
  ['zoom', 'drift'].forEach(function (k) {
    for (var v = 0; v < 4; v++) {
      var p = L.pose(k, v).raw;
      [[p[0], p[1], p[2]], [p[3], p[4], p[5]]].forEach(function (q) {
        assert.ok(q[0] >= 1, k + v + ' Skalierung >= 1');
        assert.ok(Math.abs(q[1]) <= (q[0] - 1) * 640 + 1e-9, k + v + ' x im Bild');
        assert.ok(Math.abs(q[2]) <= (q[0] - 1) * 360 + 1e-9, k + v + ' y im Bild');
      });
      assert.ok(p[0] !== p[3] || p[1] !== p[4] || p[2] !== p[5], 'Bewegung');
    }
  });
  assert.strictEqual(L.pose('zoom', 0).from, 'translate3d(0px,0px,0)');
  assert.strictEqual(L.pose('zoom', 0).to, 'translate3d(-36px,-18px,0) scale(1.08)');
  assert.strictEqual(L.pose('drift', 5).from, L.pose('drift', 1).from);
});
test('Jalousie von links, Kacheln in zufaelliger Reihenfolge: jede Verzoegerung genau einmal', function () {
  eq(L.delays(4, 100, true), [0, 100, 200, 300]);
  var d = L.delays(12, 50, false, seq([0.9, 0.1, 0.5, 0.3, 0.7]));
  eq(d.slice().sort(function (a, b) { return a - b; }), [0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550]);
  assert.notDeepStrictEqual(JSON.parse(JSON.stringify(d)), [0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550]);
});
test('Teile: Kacheln 3 x 2 (TV: 12 Ebenen zu teuer), Jalousie 8 Streifen; ganze Pixel, Bildschirm luecken- und ueberlappungsfrei', function () {
  eq(L.PARTS.tiles, [3, 2]); eq(L.PARTS.blinds, [8, 1]);
  [[3, 2], [8, 1], [4, 3], [7, 5]].forEach(function (cr) {
    var g = L.grid(cr[0], cr[1]), area = 0, i, j;
    assert.strictEqual(g.length, cr[0] * cr[1]);
    for (i = 0; i < g.length; i++) {
      var a = g[i];
      [a.x, a.y, a.w, a.h].forEach(function (v) { assert.strictEqual(v, Math.round(v)); });
      assert.ok(a.x >= 0 && a.y >= 0 && a.x + a.w <= 1280 && a.y + a.h <= 720);
      area += a.w * a.h;
      for (j = i + 1; j < g.length; j++) {
        var b = g[j];
        assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, 'keine Ueberlappung ' + i + '/' + j);
      }
    }
    assert.strictEqual(area, 1280 * 720, 'deckt alles ab');
  });
  eq(L.grid(3, 2).map(function (a) { return a.w; }), [427, 426, 427, 427, 426, 427]);
  eq(L.grid(8, 1)[1], { x: 160, y: 0, w: 160, h: 720 });   // Jalousie wie bisher
});
test('Zufallsbeutel (Startseite): jede Nummer einmal je Runde, nie dieselbe zweimal hintereinander', function () {
  var b = new L.Bag(5), last = -1, r, k, i;
  for (r = 0; r < 30; r++) {
    var seen = {};
    for (i = 0; i < 5; i++) { k = b.next(); assert.ok(!seen[k], 'keine Wiederholung in der Runde'); assert.notStrictEqual(k, last); seen[k] = 1; last = k; }
  }
  assert.strictEqual(new L.Bag(1).next(), 0); assert.strictEqual(new L.Bag(0).next(), -1);
});

/* ---------- Bibliotheks-Pool ---------- */
function items(lib, from, n, noArt) {
  var o = [];
  for (var i = from; i < from + n; i++) o.push({ rk: lib + '-' + i, art: noArt && noArt(i) ? '' : '/a/' + lib + '/' + i, title: 'T' + i, type: 'movie' });
  return o;
}
test('Pool: Seiten zufaellig ueber alle Bibliotheken, keine Wiederholung bis alles gezeigt, dann neue Runde', function () {
  var p = new L.Pool(Math.random), A = { id: 1, type: 'movie' }, B = { id: 2, type: 'show' };
  p.setTotals([{ lib: A, n: 65 }, { lib: B, n: 30 }]);
  assert.strictEqual(p.pages.length, 4);            // 3 Seiten Filme (0, 30, 60) + 1 Seite Serien
  assert.strictEqual(p.size(), 95);
  var shown = {}, n = 0, pg, it;
  while ((pg = p.nextPage())) {
    p.add(items(pg.lib.id, pg.start, Math.min(30, (pg.lib.id === 1 ? 65 : 30) - pg.start)));
    while ((it = p.take())) { assert.ok(!shown[it.rk], 'doppelt: ' + it.rk); shown[it.rk] = 1; n++; }
  }
  assert.strictEqual(n, 95); assert.ok(p.done());
  var last = p.last; p.newRound();
  assert.strictEqual(p.round, 2); assert.strictEqual(p.pages.length, 4);
  pg = p.nextPage(); p.add(items(pg.lib.id, pg.start, 30));
  assert.notStrictEqual(p.take().rk, last, 'erstes Bild der neuen Runde ist nicht das letzte der alten');
});
test('Pool: nur Titel mit Hintergrundbild; doppelt gelieferte Titel (verschobene Seiten) nur einmal; low() fordert Nachschub', function () {
  var p = new L.Pool(), A = { id: 1, type: 'movie' };
  p.setTotals([{ lib: A, n: 60 }]);
  function no(i) { return i % 3 === 0; }
  assert.strictEqual(p.add(items(1, 0, 30, no)), 20);
  assert.strictEqual(p.add(items(1, 25, 10, no)), 3, 'Ueberlappung 25..29 schon im Vorrat; 30 und 33 ohne Art');
  var c = 0; while (p.q.length > 2) { p.take(); c++; }
  assert.strictEqual(c, 21); assert.ok(p.low(), 'Vorrat < 3 und Seiten uebrig -> nachladen');
  assert.strictEqual(p.add([{ rk: 'x' }, null]), 0);
});
test('Bibliotheken: Standard = alle Film-/Serien-Bibliotheken; Auswahl gilt, Musik nur gewaehlt, fremde ids nie', function () {
  var libs = [{ id: 1, type: 'movie' }, { id: 2, type: 'show' }, { id: 3, type: 'artist' }, { id: 9, type: 'photo' }];
  eq(L.libs(null, libs).map(function (l) { return l.id; }), [1, 2]);
  eq(L.libs([], libs).map(function (l) { return l.id; }), [1, 2]);
  eq(L.libs([2, 3], libs).map(function (l) { return l.id; }), [2, 3]);
  eq(L.libs([9, 42], libs), []);                    // Fotos werden nie gezeigt; 42 gibt es in diesem Profil nicht (Kinderprofil)
  assert.strictEqual(N.comfort.applyDefaults({}, false).saverLibs, null);
  assert.strictEqual(N.comfort.applyDefaults({}, false).saverSrc, 'libs');
  assert.strictEqual(N.comfort.applyDefaults({}, false).saverUnwatched, false);
});
test('Anfragen: Zaehlen ohne Felder, Seite mit 30 Titeln + excludeElements; Ungesehen je Typ (unwatched / unwatchedLeaves)', function () {
  var q = L.query({ id: 1, type: 'movie' }, 0, 0, true);
  assert.strictEqual(q['X-Plex-Container-Size'], 0); assert.strictEqual(q.excludeElements, undefined); assert.strictEqual(q.unwatched, 1);
  q = L.query({ id: 2, type: 'show' }, 60, 30, true);
  assert.strictEqual(q.type, 2); assert.strictEqual(q['X-Plex-Container-Start'], 60); assert.strictEqual(q.unwatchedLeaves, 1); assert.strictEqual(q.unwatched, undefined);
  assert.ok(q.excludeElements.length > 0); assert.strictEqual(q.excludeFields, 'summary,tagline');
  q = L.query({ id: 3, type: 'artist' }, 0, 30, true);
  assert.strictEqual(q.type, 8); assert.strictEqual(q.unwatched, undefined); assert.strictEqual(q.unwatchedLeaves, undefined);
});
test('Zeile unter dem Titel (DE/EN)', function () {
  assert.strictEqual(L.meta({ type: 'movie', year: 2019 }), 'Film · 2019');
  assert.strictEqual(L.meta({ type: 'episode', s: 2, e: 4, year: 2020 }), 'Serie · S2 · F4');
  assert.strictEqual(L.meta({ type: 'show', year: 2015 }), 'Serie · 2015');
  assert.strictEqual(L.meta({ type: 'artist' }), 'Musik');
  N.i18n.set('en');
  assert.strictEqual(L.meta({ type: 'episode', s: 2, e: 4 }), 'TV show · S2 · E4');
  assert.strictEqual(L.meta({ type: 'movie' }), 'Movie');
  N.i18n.set('de');
});
test('Einblendung: Standard Ambient; jede Lage liegt im Bild; Uhr folgt "Uhrzeit anzeigen", reine Uhr-Stile dann leer', function () {
  assert.strictEqual(N.comfort.applyDefaults({}, false).saverInfo, 'ambient');
  L.INFOS.forEach(function (st) {
    for (var i = 0; i < 4; i++) {
      var c = L.info(st, i);
      assert.strictEqual(c.style, st);
      assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.w <= 1280 && c.y + c.h <= 720, st + i + ' im Bild');
    }
  });
  assert.strictEqual(L.info('nope', 0).style, 'ambient');
  var seen = {}; for (var i = 0; i < 4; i++) seen[L.info('ambient', i).x + ',' + L.info('ambient', i).y] = 1;
  assert.strictEqual(Object.keys(seen).length, 4, 'Ambient wandert durch 4 Ecken');
  eq(L.infoParts('ambient', true), { clock: true, title: true, any: true });
  eq(L.infoParts('ambient', false), { clock: false, title: true, any: true });
  eq(L.infoParts('bigclock', false), { clock: false, title: false, any: false });
  eq(L.infoParts('minimal', true), { clock: true, title: false, any: true });
  eq(L.infoParts('off', true), { clock: false, title: false, any: false });
});

/* ---------- N.saverLib gegen kuenstliches XHR ---------- */
test('Bibliotheks-Quelle: 1 Zaehl-Anfrage je Bibliothek, dann 1 Seite je 30 Bilder; Profil-Token; keine Wiederholung; neue Runde', function () {
  var c = H.load({ fakeTimers: true }), M = c.N, T = c.timers;
  M.log = function () {}; M.i18n.set('de'); M.config.apply({ fixedClock: '12:00' });
  var SIZE = { 1: 40, 2: 10 };
  var x = H.FakeXHR(function (m, u) {
    var q = new URL(u), lib = Number(/sections\/(\d+)/.exec(q.pathname)[1]), st = Number(q.searchParams.get('X-Plex-Container-Start')), sz = Number(q.searchParams.get('X-Plex-Container-Size'));
    var md = [];
    for (var i = st; i < Math.min(SIZE[lib], st + sz); i++) md.push({ ratingKey: String(lib * 1000 + i), type: lib === 1 ? 'movie' : 'show', title: 'T' + i, year: 2000 + i, art: i % 10 === 9 ? undefined : '/a/' + lib + '/' + i });
    return { status: 200, body: { MediaContainer: { size: md.length, totalSize: SIZE[lib], Metadata: md } }, delay: 5, timers: T };
  });
  M.http._setFactory(x.factory); M.http._setTimers({ set: T.setTimeout, clear: T.clearTimeout }); M.http._reset();
  M.plex.setServer('http://192.0.2.10:32400', 'KIDTOKEN');
  M.session = { profile: { uuid: 'kid' }, settings: { saverLibs: null, saverUnwatched: true },
    homeCache: function () { return { alibs: [{ id: 1, type: 'movie', title: 'Filme' }, { id: 2, type: 'show', title: 'Serien' }, { id: 3, type: 'artist', title: 'Musik' }] }; } };
  var got = [], i;
  function take() { var r; M.saverLib.next(function (it) { r = it; }); T.tick(200); return r; }
  var first = take();
  assert.ok(first && first.art, 'erstes Bild');
  var urls = x.log.opened.map(function (o) { return o.url; });
  assert.strictEqual(urls.length, 3, 'Zaehlen Filme + Serien (nicht Musik) + eine Seite: ' + urls.join(' | '));
  assert.match(urls[0], /sections\/1\/all\?.*X-Plex-Container-Size=0/); assert.match(urls[0], /unwatched=1/);
  assert.match(urls[1], /sections\/2\/all\?.*X-Plex-Container-Size=0/); assert.match(urls[1], /unwatchedLeaves=1/);
  assert.match(urls[2], /X-Plex-Container-Size=30/); assert.match(urls[2], /excludeElements=/);
  x.log.opened.forEach(function (o) { assert.strictEqual(o.headers['X-Plex-Token'], 'KIDTOKEN', 'Token des aktiven Profils'); });
  got.push(first.rk);
  for (i = 1; i < 45; i++) { var it = take(); assert.ok(it, 'Bild ' + i); assert.ok(got.indexOf(it.rk) < 0 || got.length >= 45, 'doppelt ' + it.rk); got.push(it.rk); }
  // 50 Titel, jeder 10. ohne Art -> 45 Bilder je Runde; 3 Seiten (0, 30 Filme; 0 Serien) = 3 Seiten-Anfragen
  assert.strictEqual(x.log.opened.length, 2 + 3, 'je 30 Titel nur eine Anfrage');
  var it46 = take();
  assert.ok(it46 && got.indexOf(it46.rk) >= 0, 'neue Runde nach allen 45');
  assert.strictEqual(x.log.opened.length, 2 + 4, 'neue Runde ohne neue Zaehl-Anfrage');
  // Auswahl geaendert -> neu zaehlen
  M.session.settings.saverLibs = [2];
  take();
  assert.match(x.log.opened[x.log.opened.length - 2].url, /sections\/2\/all\?.*Size=0/);
  // Abbrechen (Schoner aus): kein Rueckruf, naechster Start laedt wieder
  M.saverLib.reset();
  var called = 0; M.saverLib.next(function () { called++; }); M.saverLib.abort(); T.tick(500);
  assert.strictEqual(called, 0);
  assert.ok(take(), 'nach Abbruch wieder Bilder');
});
test('Bibliotheks-Quelle: Fehler -> null (Schoner nimmt Startseiten-Bilder), 1 Min. Ruhe, danach neuer Versuch', function () {
  var c = H.load({ fakeTimers: true }), M = c.N, T = c.timers, fail = true;
  M.log = function () {};
  var x = H.FakeXHR(function () {
    if (fail) return { status: 500, body: '', timers: T };
    return { status: 200, body: { MediaContainer: { size: 1, totalSize: 1, Metadata: [{ ratingKey: '7', type: 'movie', title: 'A', art: '/a/7' }] } }, timers: T };
  });
  M.http._setFactory(x.factory); M.http._setTimers({ set: T.setTimeout, clear: T.clearTimeout }); M.http._reset();
  M.plex.setServer('http://192.0.2.10:32400', 'T');
  M.session = { profile: { uuid: 'a' }, settings: {}, homeCache: function () { return { libs: [{ id: 1, type: 'movie' }] }; } };
  var r = 'x'; M.saverLib.next(function (it) { r = it; }); T.tick(5000);
  assert.strictEqual(r, null);
  var n = x.log.opened.length;
  r = 'x'; M.saverLib.next(function (it) { r = it; }); T.tick(10);
  assert.strictEqual(r, null); assert.strictEqual(x.log.opened.length, n, 'keine Anfrage in der Ruhezeit');
  fail = false; T.tick(61000);
  r = 'x'; M.saverLib.next(function (it) { r = it; }); T.tick(5000);
  assert.ok(r && r.rk === '7');
  r = 'x'; M.session.homeCache = function () { return { libs: [] }; }; M.saverLib.next(function (it) { r = it; });
  assert.strictEqual(r, null, 'keine Bibliothek -> sofort null');
});

test('Bibliotheks-Quelle: leerer Vorrat waehrend des Nachschubs im Hintergrund -> Warteliste wird bedient (Review 1.0.5)', function () {
  var c = H.load({ fakeTimers: true }), M = c.N, T = c.timers, delay = 5;
  M.log = function () {};
  var x = H.FakeXHR(function (m, u) {
    var q = new URL(u), st = Number(q.searchParams.get('X-Plex-Container-Start')), sz = Number(q.searchParams.get('X-Plex-Container-Size')), md = [];
    for (var i = st; i < Math.min(90, st + sz); i++) md.push({ ratingKey: String(i), type: 'movie', title: 'T' + i, art: '/a/' + i });
    return { status: 200, body: { MediaContainer: { size: md.length, totalSize: 90, Metadata: md } }, delay: delay, timers: T };
  });
  M.http._setFactory(x.factory); M.http._setTimers({ set: T.setTimeout, clear: T.clearTimeout }); M.http._reset();
  M.plex.setServer('http://192.0.2.10:32400', 'T');
  M.session = { profile: { uuid: 'a' }, settings: {}, homeCache: function () { return { libs: [{ id: 1, type: 'movie' }] }; } };
  var first = null; M.saverLib.next(function (it) { first = it; }); T.tick(200);
  assert.ok(first, 'erstes Bild');
  delay = 8000;                                                   // langsamer Server: Nachschub dauert laenger als die Bilder
  // Vorrat leeren: jeder Aufruf antwortet sofort, bis einer warten muss (Nachschub im Hintergrund noch unterwegs)
  var r = null, n = 0;
  for (; n < 60; n++) {
    var box = { it: 'x' };
    (function (b) { M.saverLib.next(function (it) { b.it = it; }); })(box);
    if (box.it === 'x') { r = box; break; }
  }
  assert.ok(r, 'ein Aufruf wartet');
  T.tick(9000);
  r = r.it;
  assert.ok(r && r.art, 'Wartender bekommt ein Bild, sobald der Nachschub da ist');
});

test('Schoner per Klick beenden: der Klick oeffnet nichts dahinter; Bewegung bei Schoner wird geschluckt (Review 1.0.5)', function () {
  var c = H.load({ fakeTimers: true }), M = c.N, T = c.timers, S = M.ui.saver;
  M.log = function () {};
  var stopped = 0; S.stop = function () { S.on = false; stopped++; };
  function ev(type) { var e = { type: type, stops: 0 }; e.stopPropagation = function () { e.stops++; }; e.preventDefault = function () {}; S._pointer(e); return e.stops > 0; }
  S.on = true;
  assert.strictEqual(ev('mousemove'), true, 'Bewegung erreicht die Ansicht dahinter nicht');
  assert.strictEqual(S.on, true, 'Bewegung allein beendet nicht');
  assert.strictEqual(ev('mousedown'), true);
  assert.strictEqual(stopped, 1);
  assert.strictEqual(ev('click'), true, 'der Klick zum mousedown wird geschluckt');
  assert.strictEqual(ev('click'), false, 'der naechste Klick wirkt wieder');
  T.tick(5000);
  S.on = true; ev('mousedown'); T.tick(1500);
  assert.strictEqual(ev('click'), false, 'spaeter Klick (> 1 s) wirkt normal');
});
test('Einblendung buendig (TV-Befund 28.10.): jede Abdunklung erreicht die Raender, die sie beruehren soll; Eck-Bilder je Ecke ohne Spiegelung', function () {
  L.INFOS.forEach(function (st) {
    for (var i = 0; i < 4; i++) {
      var c = L.info(st, i);
      c.edge.forEach(function (e) {
        var g = e === 'l' ? c.x : e === 'r' ? 1280 - c.x - c.w : e === 't' ? c.y : 720 - c.y - c.h;
        assert.strictEqual(g, 0, st + ' Lage ' + i + ': Luecke ' + g + ' px am Rand ' + e);
      });
      if (c.scr && st !== 'bigclock') assert.ok(c.edge.length >= 2, st + ' Lage ' + i + ': Abdunklung muss am Rand liegen');
      if (/^scrim-saver(-[bt][lr])?\.png$/.test(c.scr)) assert.strictEqual(c.scr, 'scrim-saver' + (c.r || c.t ? '-' + (c.t ? 't' : 'b') + (c.r ? 'r' : 'l') : '') + '.png');
    }
  });
  var ty = {}; for (var i = 0; i < 4; i++) ty[L.info('lower', i).ty] = 1;
  assert.strictEqual(Object.keys(ty).length, 4, 'Untertitel-Leiste: Text wandert in 4 Hoehen, die Abdunklung bleibt unten');
});

/* ---------- SAV-5: Bilder im Bildschirmschoner (echte Hintergrundbilder / Standbilder / Poster) ---------- */
/* /arts-Antworten wie vom echten PMS (Form 28.10. geprueft; Hashes erfunden): Agent-Bilder (https), lokale Eintraege am Ende */
function artsTxt(entries) {
  return JSON.stringify({ MediaContainer: { size: entries.length, identifier: 'com.plexapp.plugins.library', Metadata: entries.map(function (e) {
    return { key: '/library/metadata/77/file?url=' + encodeURIComponent(e[0]), ratingKey: e[0], thumb: '/library/metadata/77/file?url=x', selected: !!e[1], provider: e[2] };
  }) } });
}
var EXT = ['https://image.example.org/t/p/original/aaaa.jpg', false, 'tmdb'];
var STILL = 'media://3/0123456789abcdef0123456789abcdef01234567.bundle/Contents/Art/art1.jpg';
var AGENT = 'metadata://art/tv.plex.agents.movie_0123456789abcdef0123456789abcdef01234567';
test('Standbild erkennen: ausgewaehlter Eintrag media:// = Standbild, metadata:// / upload:// = echt; ohne Auswahl nur media:// = Standbild', function () {
  assert.strictEqual(L.artKind(artsTxt([EXT, [AGENT, false, 'gracenote'], [STILL, true]])), 'still');
  assert.strictEqual(L.artKind(artsTxt([EXT, [AGENT, true, 'gracenote'], [STILL, false]])), 'real');
  assert.strictEqual(L.artKind(artsTxt([EXT, ['upload://art/9f8e7d', true]])), 'real');
  assert.strictEqual(L.artKind(artsTxt([[STILL, false]])), 'still', 'nur ein Standbild, nichts ausgewaehlt');
  assert.strictEqual(L.artKind(artsTxt([EXT, [STILL, false]])), '', 'nichts ausgewaehlt, aber echte Bilder dabei -> unbekannt');
  assert.strictEqual(L.artKind(artsTxt([])), '');
  assert.strictEqual(L.artKind(''), ''); assert.strictEqual(L.artKind(null), ''); assert.strictEqual(L.artKind('<html>'), '');
  assert.strictEqual(L.artKind('{"Metadata":[{"ratingKey": "' + STILL + '", "selected": true}]}'), 'still', 'mit Leerzeichen');
  // Besitzer des Bilds aus dem art-Pfad (Folgen: Serien-Art; Weitere Server: Marke)
  eq(L.artOwner('/library/metadata/18681/art/1784767485'), { rk: '18681', srv: '' });
  eq(L.artOwner('@friend-1|/library/metadata/42/art/1'), { rk: '42', srv: 'friend-1' });
  assert.strictEqual(L.artOwner('/library/metadata/42/thumb/1'), null);
  assert.strictEqual(L.artOwner('/a/1'), null); assert.strictEqual(L.artOwner(''), null);
  assert.strictEqual(L.pics('poster'), 'poster'); assert.strictEqual(L.pics('x'), 'art'); assert.strictEqual(L.pics(undefined), 'art');
  assert.strictEqual(N.comfort.applyDefaults({}, false).saverPics, 'art');
});
test('Poster-Modus: Plakat immer im Bild, gegenueber dem Text (Ecken) bzw. ueber der Leiste; quadratische Cover kleiner', function () {
  L.INFOS.forEach(function (st) {
    for (var i = 0; i < 4; i++) {
      [[2, 3], [1, 1], [16, 9], [0, 0]].forEach(function (a) {
        var b = L.posterBox(st, i, a[0], a[1]), c = L.info(st, i), tag = st + '/' + i + '/' + a.join('x');
        assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= 1280 && b.y + b.h <= 720, 'im Bild ' + tag);
        assert.ok(b.w > 100 && b.h > 100, 'Groesse ' + tag);
        [b.x, b.y, b.w, b.h].forEach(function (v) { assert.strictEqual(v, Math.round(v)); });
        if (st === 'ambient' || st === 'classic' || st === 'minimal') assert.ok(c.r ? b.x + b.w <= 760 : b.x >= 520, 'gegenueber dem Text ' + tag);
        if (st === 'poster' || st === 'lower') assert.ok(b.y + b.h <= 470, 'ueber der Leiste ' + tag);
        if (st === 'bigclock') {                         // Gruppe Plakat + Uhr-Platz: mittig (+ Lage), Plakat-Mitte = Ziffern-Mitte, nie darunter
          var G = L.bigGroup(i, a[0], a[1]);
          assert.strictEqual(JSON.stringify(G.p), JSON.stringify(b));
          assert.strictEqual(G.ck.x, b.x + b.w + L.CK_GAP, 'Abstand ' + tag);
          assert.ok(Math.abs((b.x + G.ck.x + G.ck.w) / 2 - (640 + c.x - 40)) <= 1, 'Gruppe mittig ' + tag);
          assert.ok(Math.abs(b.y + b.h / 2 - (c.y + 300)) <= 1, 'senkrecht auf Ziffern-Mitte ' + tag);
          assert.ok(G.ck.x + G.ck.w <= c.x + c.w, 'Uhr-Platz in der Einblendung ' + tag);
        }
      });
    }
  });
  assert.ok(L.posterBox('ambient', 0, 1, 1).h < L.posterBox('ambient', 0, 2, 3).h, 'Cover kleiner als Plakat');
  eq(L.posterBox('off', 0, 2, 3), { x: 460, y: 90, w: 360, h: 540 });
  assert.strictEqual(L.square({ type: 'artist' }), true); assert.strictEqual(L.square({ type: 'movie' }), false);
});
test('Poster-Modus: Pool und Startseite sammeln Titel mit Poster/Cover (auch ohne Hintergrundbild)', function () {
  var p = new L.Pool(seq([0.3])), items = [{ rk: '1', art: '/a/1', thumb: '/t/1' }, { rk: '2', art: '', thumb: '/t/2' }, { rk: '3', art: '/a/3', thumb: '' }];
  p.setTotals([{ lib: { id: 1 }, n: 3 }]);
  assert.strictEqual(p.add(items, 'thumb'), 2);
  eq(p.q.map(function (x) { return x.rk; }).sort(), ['1', '2']);
  var p2 = new L.Pool(seq([0.3])); p2.setTotals([{ lib: { id: 1 }, n: 3 }]);
  assert.strictEqual(p2.add(items), 2, 'Standard: nur mit Hintergrundbild');
  var cache = { rows: [{ id: 'cw', items: [{ title: 'Ohne Art', type: 'movie', art: '', thumb: '/t/9' }, { title: 'Musik', type: 'artist', art: '/a/m', thumb: '/t/m' }] }] };
  eq(N.comfort.saverItems(cache, 0, 'thumb').map(function (x) { return x.title + ':' + x.thumb + ':' + x.sq; }), ['Ohne Art:/t/9:false', 'Musik:/t/m:true']);
  eq(N.comfort.saverItems(cache).map(function (x) { return x.title; }), ['Musik']);
});
/* Testumgebung fuer N.saverArt / Bildauswahl: arts = { rk: 'still'|'real'|'fail' } */
function artEnv(arts, settings, libItems) {
  var c = H.load({ fakeTimers: true }), M = c.N, T = c.timers;
  M.log = function () {}; M.i18n.set('de'); M.config.apply({ fixedClock: '12:00' });
  var x = H.FakeXHR(function (m, u) {
    var q = new URL(u), a = /^\/library\/metadata\/(\d+)\/arts$/.exec(q.pathname);
    if (a) {
      var k = arts[a[1]];
      if (k === 'fail') return { status: 500, body: '', timers: T };
      return { status: 200, body: artsTxt(k === 'still' ? [EXT, [STILL, true]] : [EXT, [AGENT, true, 'tmdb']]), delay: 3, timers: T };
    }
    var st = Number(q.searchParams.get('X-Plex-Container-Start')), sz = Number(q.searchParams.get('X-Plex-Container-Size')), all = libItems || [];
    return { status: 200, body: { MediaContainer: { size: sz ? Math.min(sz, all.length - st) : 0, totalSize: all.length, Metadata: sz ? all.slice(st, st + sz) : [] } }, delay: 3, timers: T };
  });
  M.http._setFactory(x.factory); M.http._setTimers({ set: T.setTimeout, clear: T.clearTimeout }); M.http._reset();
  M.plex.setServer('http://192.0.2.10:32400', 'TOK');
  M.session = { profile: { uuid: 'a' }, settings: settings || {}, homeCache: function () { return { libs: [{ id: 1, type: 'movie' }] }; } };
  return { N: M, T: T, x: x, arts: function () { return x.log.opened.filter(function (o) { return /\/arts$/.test(o.url.split('?')[0]); }); } };
}
test('N.saverArt: eine /arts-Anfrage je Bild (Profil-Token, Text ohne JSON-Parse), Ergebnis gemerkt; Fremd-Pfad ohne Anfrage; Fehler nicht gemerkt', function () {
  var e = artEnv({ 10: 'still', 11: 'real', 12: 'fail' }), A = e.N.saverArt, r;
  A.kind('/library/metadata/10/art/5', function (k) { r = k; }); e.T.tick(100);
  assert.strictEqual(r, 'still');
  assert.strictEqual(e.arts().length, 1);
  assert.match(e.arts()[0].url, /\/library\/metadata\/10\/arts/);
  assert.strictEqual(e.arts()[0].headers['X-Plex-Token'], 'TOK');
  r = ''; A.kind('/library/metadata/10/art/5', function (k) { r = k; });
  assert.strictEqual(r, 'still', 'aus dem Speicher, sofort'); assert.strictEqual(e.arts().length, 1);
  A.kind('/library/metadata/10/art/6', function (k) { r = k; }); e.T.tick(100);
  assert.strictEqual(e.arts().length, 2, 'neuer Zeitstempel = neues Bild = neue Pruefung');
  A.kind('/library/metadata/11/art/1', function (k) { r = k; }); e.T.tick(100); assert.strictEqual(r, 'real');
  r = 'x'; A.kind('/a/1', function (k) { r = k; }); assert.strictEqual(r, '', 'keine PMS-Art: nicht pruefbar = echt'); assert.strictEqual(e.arts().length, 3);
  A.kind('/library/metadata/12/art/1', function (k) { r = k; }); e.T.tick(100); assert.strictEqual(r, '');
  A.kind('/library/metadata/12/art/1', function (k) { r = k; }); e.T.tick(100); assert.strictEqual(e.arts().length, 5, 'Fehler nicht gemerkt');
  var called = 0; A.kind('/library/metadata/13/art/1', function () { called++; }); A.abort(); e.T.tick(500);
  assert.strictEqual(called, 0, 'abgebrochen (Schoner aus): kein Rueckruf');
});
function lib(n, artOf) {
  var out = [];
  for (var i = 0; i < n; i++) out.push({ ratingKey: String(100 + i), type: 'movie', title: 'T' + i, art: artOf ? artOf(i) : '/library/metadata/' + (100 + i) + '/art/1', thumb: '/library/metadata/' + (100 + i) + '/thumb/1' });
  return out;
}
test('Bildauswahl: Standard ueberspringt Standbilder; "Auch Standbilder" zeigt sie ohne Pruefung; Poster liefert Plakat', function () {
  var arts = {}, i;
  for (i = 0; i < 6; i++) arts[100 + i] = i % 2 ? 'still' : 'real';
  var e = artEnv(arts, { saverLibs: [1] }, lib(6)), got = [];
  for (i = 0; i < 3; i++) { e.N.ui.saver._nextItem(function (x) { got.push(x); }); e.T.tick(500); }
  assert.strictEqual(got.length, 3);
  got.forEach(function (x) { assert.ok(!x.pm && arts[/metadata\/(\d+)/.exec(x.art)[1]] === 'real', 'nur echte: ' + x.art); });
  var e2 = artEnv(arts, { saverLibs: [1], saverPics: 'stills' }, lib(6)), g2 = [];
  for (i = 0; i < 6; i++) { e2.N.ui.saver._nextItem(function (x) { g2.push(x); }); e2.T.tick(500); }
  assert.strictEqual(g2.length, 6); assert.strictEqual(e2.arts().length, 0, 'Auch Standbilder: keine Pruefung');
  var e3 = artEnv(arts, { saverLibs: [1], saverPics: 'poster' }, lib(6, function (k) { return k < 3 ? '' : '/library/metadata/' + (100 + k) + '/art/1'; })), g3 = [];
  for (i = 0; i < 6; i++) { e3.N.ui.saver._nextItem(function (x) { g3.push(x); }); e3.T.tick(500); }
  assert.strictEqual(g3.length, 6, 'Poster: auch Titel ohne Hintergrundbild'); assert.strictEqual(e3.arts().length, 0);
  g3.forEach(function (x) { assert.ok(x.pm && /\/thumb\//.test(x.thumb)); });
});
test('Pause-Schoner folgt "Bilder im Bildschirmschoner": Standbild -> Plakat (nur echte), Poster-Modus -> Plakat, ohne Hintergrund -> Plakat', function () {
  var P = L.pausedPic;
  // pure Entscheidung: (Modus, Hintergrundbild?, Plakat?, Pruefergebnis)
  assert.strictEqual(P('art', true, true, undefined), 'check', 'erst pruefen');
  assert.strictEqual(P('art', true, true, 'still'), 'poster');
  assert.strictEqual(P('art', true, true, 'real'), 'art');
  assert.strictEqual(P('art', true, true, ''), 'art', 'unbekannt = echt');
  assert.strictEqual(P('art', true, false, undefined), 'art', 'ohne Plakat nichts zu pruefen: Standbild bleibt (nie schwarz)');
  assert.strictEqual(P('stills', true, true, undefined), 'art');
  assert.strictEqual(P('poster', true, true, undefined), 'poster');
  assert.strictEqual(P('poster', true, false, undefined), 'art', 'Poster-Modus ohne Plakat: Hintergrundbild');
  ['art', 'stills', 'poster', 'x'].forEach(function (m) {
    assert.strictEqual(P(m, false, true), 'poster', 'ohne Hintergrundbild: Plakat (' + m + ')');
    assert.strictEqual(P(m, false, false), '', 'gar kein Bild: nur Text (' + m + ')');
  });
  assert.strictEqual(P(undefined, true, true, 'still'), 'poster', 'unbekannter Modus = Standard');
  // Ablauf im Schoner: eine /arts-Anfrage fuer den pausierten Titel, Text bleibt "Pausiert · …"
  var ep = { type: 'episode', title: 'Serie', s: 1, e: 5, art: '/library/metadata/77/art/1', thumb: '/library/metadata/77/thumb/1' }, r = null;
  var e = artEnv({ 77: 'still' }, {});
  e.N.ui.saver._pausedNext(ep, function (x) { r = x; }); e.T.tick(200);
  assert.ok(r && r.pm && r.thumb === ep.thumb, 'Standbild -> Plakat'); assert.match(r.title, /^Pausiert · Serie S1/);
  assert.strictEqual(e.arts().length, 1);
  var e2 = artEnv({ 77: 'real' }, {}); r = null;
  e2.N.ui.saver._pausedNext(ep, function (x) { r = x; }); e2.T.tick(200);
  assert.ok(r && !r.pm && r.art === ep.art, 'echtes Hintergrundbild bleibt');
  var e3 = artEnv({ 77: 'still' }, { saverPics: 'stills' }); r = null;
  e3.N.ui.saver._pausedNext(ep, function (x) { r = x; }); e3.T.tick(200);
  assert.ok(r && !r.pm, 'Auch Standbilder: Standbild'); assert.strictEqual(e3.arts().length, 0, 'ohne Pruefung');
  var e4 = artEnv({}, { saverPics: 'poster' }); r = null;
  e4.N.ui.saver._pausedNext(ep, function (x) { r = x; }); e4.T.tick(200);
  assert.ok(r && r.pm, 'Poster und Cover: Plakat'); assert.strictEqual(e4.arts().length, 0);
  var e5 = artEnv({}, {}); r = 'x';
  e5.N.ui.saver._pausedNext(null, function (x) { r = x; }); e5.T.tick(200);
  assert.strictEqual(r, null, 'ohne Titel: kein Bild');
});
test('Plakat-Schatten: umschliesst das Plakat mit dem gestreckten Rand, Hoch- und Querformat je ein eigenes Bild', function () {
  [[{ x: 238, y: 140, w: 293, h: 440 }, 'saver-shadow.png'], [{ x: 460, y: 90, w: 360, h: 540 }, 'saver-shadow.png'], [{ x: 100, y: 100, w: 374, h: 374 }, 'saver-shadow-sq.png']].forEach(function (c) {
    var p = c[0], b = L.shadowBox(p), S = c[1] === 'saver-shadow.png' ? L.SHADOW.tall : L.SHADOW.sq;
    assert.strictEqual(b.f, c[1]);
    assert.ok(b.x < p.x && b.y < p.y && b.x + b.w > p.x + p.w && b.y + b.h > p.y + p.h, 'rundum groesser');
    assert.ok(Math.abs((p.x - b.x) - S.m * p.w / S.pw) <= 1 && Math.abs((p.y - b.y) - S.m * p.h / S.ph) <= 1, 'Rand gestreckt wie das Plakat');
    var png = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'assets', S.f));
    assert.deepStrictEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [S.pw + 2 * S.m, S.ph + 2 * S.m], 'Bildgroesse passt zu SHADOW');
    var A = readPngAlpha(require('path').join(__dirname, '..', 'src', 'assets', S.f)), i;   // weich bis 0 an jedem Rand, unter dem Plakat kraeftig
    for (i = 0; i < A.w; i++) assert.ok(A.a(i, 0) <= 1 / 255 && A.a(i, A.h - 1) <= 1 / 255, 'Schatten oben/unten 0');
    for (i = 0; i < A.h; i++) assert.ok(A.a(0, i) <= 1 / 255 && A.a(A.w - 1, i) <= 1 / 255, 'Schatten links/rechts 0');
    assert.ok(A.a(A.w >> 1, A.h - S.m + 4) > 0.3, 'Schatten unter der Unterkante sichtbar');
  });
});
test('Bildauswahl: nur Standbilder -> nach 12 Versuchen das Plakat des ersten (nie schwarz), hoechstens 12 Pruefungen je Bild', function () {
  var arts = {}, i;
  for (i = 0; i < 40; i++) arts[100 + i] = 'still';
  var e = artEnv(arts, { saverLibs: [1] }, lib(40)), r = null;
  e.N.ui.saver._nextItem(function (x) { r = x; }); e.T.tick(3000);
  assert.ok(r && r.pm && r.thumb, 'Plakat statt Standbild');
  assert.strictEqual(e.arts().length, 12);
});

/* ---------- Schoner-Abdunklungen (tools/make_assets.js saverScrims, TV-Befund 28.10. abends) ---------- */
function readPngAlpha(f) {
  var zlib = require('zlib'), b = require('fs').readFileSync(f), w = b.readUInt32BE(16), h = b.readUInt32BE(20), i = 8, idat = [];
  assert.strictEqual(b[25], 6, 'RGBA: ' + f);
  while (i < b.length) { var len = b.readUInt32BE(i), t = b.toString('ascii', i + 4, i + 8); if (t === 'IDAT') idat.push(b.slice(i + 8, i + 8 + len)); i += 12 + len; }
  var raw = zlib.inflateSync(Buffer.concat(idat)), st = w * 4, out = new Uint8Array(w * h), prev = Buffer.alloc(st);
  for (var y = 0; y < h; y++) {
    var ft = raw[y * (st + 1)], cur = Buffer.alloc(st);
    for (var x = 0; x < st; x++) {
      var v = raw[y * (st + 1) + 1 + x], a = x >= 4 ? cur[x - 4] : 0, up = prev[x], c = x >= 4 ? prev[x - 4] : 0, p;
      if (ft === 0) p = v; else if (ft === 1) p = v + a; else if (ft === 2) p = v + up; else if (ft === 3) p = v + ((a + up) >> 1);
      else { var pp = a + up - c, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - c); p = v + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c); }
      cur[x] = p & 255;
    }
    for (x = 0; x < w; x++) out[y * w + x] = cur[x * 4 + 3];
    prev = cur;
  }
  return { w: w, h: h, a: function (x, y) { return out[y * w + x] / 255; } };
}
test('Schoner-Abdunklungen: Text auf weissem Bild >= 4,5:1, weich bis 0 an jedem Rand, der nicht am Bildschirmrand liegt; keine Stufe', function () {
  var path = require('path'), A = path.join(__dirname, '..', 'src', 'assets');
  function lum(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  function minContrast(img, x0, y0, x1, y1, text) {   // weisses Bild (255) nach saver-dim 0,35, dann Abdunklung
    var worst = 99;
    for (var y = y0; y <= y1; y += 2) for (var x = x0; x <= x1; x += 2) worst = Math.min(worst, (lum(text) + 0.05) / (lum(255 * 0.65 * (1 - img.a(x, y))) + 0.05));
    return worst;
  }
  var T1 = 242, TS = 212;                                // text-1, text-soft
  ['', '-br', '-tr', '-tl'].forEach(function (s) {
    var c = readPngAlpha(path.join(A, 'scrim-saver' + s + '.png')), m = readPngAlpha(path.join(A, 'scrim-saver-m' + s + '.png'));
    function X(img, x) { return /r/.test(s) ? img.w - 1 - x : x; }
    function Y(img, yb) { return /t/.test(s) ? yb : img.h - 1 - yb; }
    function box(img, x0, yb0, x1, yb1, t) { var xa = X(img, x0), xb = X(img, x1), ya = Y(img, yb0), yb = Y(img, yb1);
      return minContrast(img, Math.min(xa, xb), Math.min(ya, yb), Math.max(xa, xb), Math.max(ya, yb), t); }
    // Ambient: Block ab safe-x 64, 56 px vom Rand; Uhr bis x 230 und 202 hoch, Titel bis x 704, Zeile darunter (text-soft)
    assert.ok(box(c, 64, 122, 230, 202, T1) >= 4.5, 'Ambient Uhr ' + s);
    assert.ok(box(c, 64, 86, 704, 120, T1) >= 4.5, 'Ambient Titel ' + s);
    assert.ok(box(c, 64, 56, 400, 84, TS) >= 4.5, 'Ambient Zeile ' + s);
    assert.ok(box(m, 64, 48, 160, 92, T1) >= 4.5, 'Nur kleine Uhr ' + s);
    [c, m].forEach(function (img) {                       // aussen liegende Raender: 0 (hoechstens 1 Stufe Rauschen)
      for (var i = 0; i < img.h; i++) assert.ok(img.a(X(img, img.w - 1), i) <= 1 / 255, 'Rand seitlich ' + s);
      for (i = 0; i < img.w; i++) assert.ok(img.a(i, Y(img, img.h - 1)) <= 1 / 255, 'Rand oben/unten ' + s);
    });
  });
  var k = readPngAlpha(path.join(A, 'scrim-saver-c.png'));
  assert.ok(minContrast(k, 395, 234, 805, 366, T1) >= 4.5, 'Grosse Uhr');
  for (var i = 0; i < k.w; i++) assert.ok(k.a(i, 0) <= 1 / 255 && k.a(i, k.h - 1) <= 1 / 255, 'Grosse Uhr oben/unten');
  for (i = 0; i < k.h; i++) assert.ok(k.a(0, i) <= 1 / 255 && k.a(k.w - 1, i) <= 1 / 255, 'Grosse Uhr links/rechts');
  var b = readPngAlpha(path.join(A, 'scrim-saver-b.png')), B0 = 720 - b.h;   // Band liegt unten buendig (SL.INFO poster/lower)
  eq([L.info('poster', 0).y, L.info('lower', 0).y, L.info('poster', 0).h], [B0, B0, b.h]);
  // Text ab y 504 (Filmplakat, Lage mit ty 16) bis 680: alles text-soft-tauglich (Uhr, Zeile), damit auch der Titel
  assert.ok(minContrast(b, 64, 504 - B0, 1216, 680 - B0, TS) >= 4.5, 'Leiste: Uhr/Titel/Zeile');
  // TODO nach 1.0.5 "Beginn des Bands sichtbar": auf weissem Bild aendert sich die Helligkeit (L*) je Pixel hoechstens um 0,25
  // (bis 1.0.5: 0,44 auf 215 px) und das Band ist oben ganz transparent
  function Ls(v) { var Y = lum(v); return Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y; }
  var prevL = null, maxD = 0;
  for (i = 0; i < b.h; i++) {
    var av = 0; for (var xx = 0; xx < 64; xx++) av += b.a(xx * 20, i); av /= 64;   // Mittel ueber die Zeile (Rauschen)
    var Lv = Ls(166 * (1 - av)); if (prevL !== null) maxD = Math.max(maxD, Math.abs(Lv - prevL)); prevL = Lv;
  }
  assert.ok(maxD <= 0.25, 'Band zu steil: ' + maxD.toFixed(3) + ' L*/px');
  for (i = 0; i < b.w; i++) assert.ok(b.a(i, 0) <= 1 / 255, 'Band oben transparent');
  // keine Stufe: entlang einer Zeile/Spalte durch die Mitte aendert sich die Deckkraft je Pixel um hoechstens 2 Stufen (+ Rauschen)
  function smooth(img, pts) { for (var j = 1; j < pts.length; j++) assert.ok(Math.abs(img.a(pts[j][0], pts[j][1]) - img.a(pts[j - 1][0], pts[j - 1][1])) <= 3 / 255, 'Stufe bei ' + pts[j]); }
  var row = [], col = [];
  for (i = 0; i < k.w; i++) row.push([i, 300]);
  for (i = 0; i < k.h; i++) col.push([600, i]);
  smooth(k, row); smooth(k, col);
  var c0 = readPngAlpha(path.join(A, 'scrim-saver.png')), diag = [];
  for (i = 0; i < 460; i++) diag.push([Math.round(i * 999 / 459), 459 - i]);
  smooth(c0, diag);
});

test('Info-Block blendet erst ueber dem NEUEN Bild ein (TV-Test 29.10.: neuer Titel ueber dem alten Bild); Schnitt im selben Frame', function () {
  assert.strictEqual(L.infoIn('cut', 0), 0);
  assert.strictEqual(L.infoIn('fade', 1500), 1500, 'nach dem Ueberblenden');
  ['dip', 'zoom', 'drift', 'fly', 'curtain', 'blinds', 'tiles'].forEach(function (fx) { assert.strictEqual(L.infoIn(fx, L.FX_MS[fx]), L.FX_MS[fx], fx); });
  assert.strictEqual(L.infoIn('fade', 0), 0, 'ohne Dauer sofort');
  assert.strictEqual(L.infoIn('fade', 1500, true), 0, 'erstes Bild aus Schwarz: kein altes Bild, sofort');
});
