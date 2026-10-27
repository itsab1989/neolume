'use strict';
/* Uhr-Korrektur (core/clock.js): Date-Kopf lesen, Median, Schwelle 90 s, langsame Antworten ignorieren, Einbindung in N.http
 * und in die Anzeigen ("Ende um"). TV-Test 27.10. nachmittags: App-Uhr 07:21 statt 14:23. */
var test = require('node:test'), assert = require('node:assert');
var H = require('./helpers/load');

var SRV = Date.UTC(2026, 9, 27, 13, 23, 5);                 // "Tue, 27 Oct 2026 13:23:05 GMT"
var HDR = 'Tue, 27 Oct 2026 13:23:05 GMT';
function hdr(ms) { return new Date(ms).toUTCString(); }        // gleiches Format wie PMS/plex.tv

function fresh() {
  var N = H.load().N, t = { now: 0 };
  N.util.now = function () { return t.now; };                  // wie viele Tests: U.now stubben
  N.clock._reset();
  return { N: N, C: N.clock, t: t };
}

test('Date-Kopf: IMF-fixdate und RFC 850 -> ms UTC; Unsinn -> NaN', function () {
  var C = fresh().C;
  assert.strictEqual(C.parse(HDR), SRV);
  assert.strictEqual(C.parse('Tuesday, 27-Oct-26 13:23:05 GMT'), SRV);
  assert.strictEqual(C.parse('Thu, 01 Jan 1970 00:00:00 GMT'), 0);
  assert.ok(isNaN(C.parse('')));
  assert.ok(isNaN(C.parse(null)));
  assert.ok(isNaN(C.parse('Tue, 27 Okt 2026 13:23:05 GMT')));  // unbekannter Monat
  assert.ok(isNaN(C.parse('Tue, 27 Oct 2026 25:23:05 GMT')));
  assert.ok(isNaN(C.parse('gestern')));
});

test('Median: ungerade/gerade Anzahl, leer = 0; Eingabe bleibt unveraendert', function () {
  var C = fresh().C, a = [5, 1, 3];
  assert.strictEqual(C.median(a), 3);
  H.eq(a, [5, 1, 3]);
  assert.strictEqual(C.median([4, 1, 3, 2]), 3);             // (2+3)/2 gerundet
  assert.strictEqual(C.median([]), 0);
});

test('Angewandt erst ab 3 Proben und nur bei |Versatz| > 90 s (TV 07:21 statt 14:23)', function () {
  var s = fresh(), C = s.C, tv = SRV - (7 * 3600 + 2 * 60) * 1000, i;   // TV-Uhr 7 h 2 min nach
  for (i = 0; i < 2; i++) { s.t.now = tv + i * 1000 + 100; assert.ok(C.sample(hdr(SRV + i * 1000), tv + i * 1000, s.t.now)); }
  assert.strictEqual(C.offset(), 0, 'zwei Proben reichen nicht');
  s.t.now = tv + 2100; C.sample(hdr(SRV + 2000), tv + 2000, s.t.now);
  // Probe: Date + 0,5 s - (t0 + rtt/2) = SRV + 500 - (tv + 50)
  assert.strictEqual(C.offset(), SRV + 450 - tv);
  assert.strictEqual(C.now(), s.t.now + C.offset());
  var d = C.date();
  assert.strictEqual(d.getTime(), SRV + 2100 + 450);
  assert.match(C.info(), /^off=\+25320s n=3$/);
});

test('Kleine Abweichung (60 s) bleibt unkorrigiert; > 90 s in beide Richtungen wird korrigiert', function () {
  var s = fresh(), C = s.C, i;
  for (i = 0; i < 5; i++) C.sample(hdr(SRV), SRV - 60000, SRV - 60000);
  assert.strictEqual(C.offset(), 0);
  s = fresh(); C = s.C;
  for (i = 0; i < 3; i++) C.sample(hdr(SRV), SRV + 120000, SRV + 120000);   // TV-Uhr 2 min vor
  assert.strictEqual(C.offset(), -120000 + 500);
});

test('Langsame (> 1,5 s) oder unplausible Antworten zaehlen nicht; Ausreisser (z. B. Cache) kippt den Median nicht', function () {
  var s = fresh(), C = s.C, tv = SRV - 3600000, i;
  assert.strictEqual(C.sample(hdr(SRV), tv, tv + 1501), false);
  assert.strictEqual(C.sample(hdr(SRV), tv, tv - 5), false);
  assert.strictEqual(C.sample('kaputt', tv, tv + 10), false);
  assert.match(C.info(), /n=0/);
  C.sample(hdr(SRV - 86400000), tv, tv);                     // alte Antwort aus einem Cache
  for (i = 0; i < 2; i++) C.sample(hdr(SRV), tv, tv);
  assert.strictEqual(C.offset(), 3600500);
});

test('Stabil: Schwankung <= 2 s aendert den Versatz nicht; Uhr wird am TV gestellt -> Fenster folgt, Versatz faellt weg', function () {
  var s = fresh(), C = s.C, tv = SRV - 3600000, i;
  for (i = 0; i < 3; i++) C.sample(hdr(SRV), tv, tv);
  var o = C.offset();
  C.sample(hdr(SRV + 1000), tv, tv); C.sample(hdr(SRV + 2000), tv, tv);
  assert.strictEqual(C.offset(), o);
  for (i = 0; i < 3; i++) C.sample(hdr(SRV), SRV, SRV);     // Nutzer stellt die TV-Uhr richtig
  assert.strictEqual(C.offset(), 0);
});

test('N.http: Date-Kopf schneller Antworten wird gelesen; ohne Kopf / ohne getResponseHeader keine Probe, kein Fehler', function () {
  var ctx = H.load({ fakeTimers: true }), N = ctx.N, T = ctx.timers, mode = 'hdr';
  N.clock._reset();
  var tvAt = T.now();                                          // FakeTimers: TV-Uhr steht auf 1970
  var x = H.FakeXHR(function () {
    var r = { status: 200, body: { a: 1 }, delay: 40, timers: T };
    if (mode === 'hdr') r.headers = { Date: hdr(SRV + (T.now() - tvAt)) };
    return r;
  });
  var noHdr = function () { var o = x.factory(); o.getResponseHeader = undefined; return o; };
  N.http._setFactory(x.factory); N.http._setTimers({ set: T.setTimeout, clear: T.clearTimeout }); N.http._reset();
  var got = 0, i;
  for (i = 0; i < 3; i++) { N.http.request({ url: 'http://pms/x' + i }, function (e, d) { if (d && d.a === 1) got++; }); T.tick(100); }
  assert.strictEqual(got, 3);
  assert.match(N.clock.info(), /n=3/);
  assert.ok(Math.abs(N.clock.offset() - (SRV - tvAt)) < 1000, 'Versatz ~ Serverzeit - TV-Uhr');
  mode = 'none'; N.http.request({ url: 'http://pms/n' }, function () { got++; }); T.tick(100);
  N.http._setFactory(noHdr); N.http.request({ url: 'http://pms/m' }, function () { got++; }); T.tick(100);
  assert.strictEqual(got, 5);
  assert.match(N.clock.info(), /n=3/);
});

test('Anzeigen nutzen die korrigierte Uhr: Details "Ende um"; Dauern (U.now) bleiben unberuehrt', function () {
  var s = fresh(), N = s.N, C = s.C, i;
  N.i18n.set('de');
  var real = new Date(2026, 9, 27, 14, 23).getTime(), tv = new Date(2026, 9, 27, 7, 21).getTime();
  s.t.now = tv;
  for (i = 0; i < 3; i++) C.sample(hdr(real), tv, tv);
  var it = N.model.norm({ ratingKey: '1', type: 'movie', title: 'X', year: 2003, duration: 6468704, viewOffset: 6468704 - 62 * 60000 });
  assert.match(N.det.meta(it, {}), /Ende um 15:25$/);         // 14:23 + 62 min (+0,5 s), nicht 08:23
  assert.strictEqual(N.util.now(), tv, 'U.now bleibt die TV-Uhr (monotone Differenzen)');
});
