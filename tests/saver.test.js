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
