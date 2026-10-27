'use strict';
/* P7: Messlauf-Logik (dev/benchmath.js), Ereignis-Zaehler, Bildlader-Zaehler, Tasten-Folge 9,8,7 */
var test = require('node:test'), assert = require('node:assert');
var H = require('./helpers/load');

test('Tastenskript wird expandiert', function () {
  var BM = H.load().N.benchMath;
  H.eq(BM.keys('R3 D U2 x B'), ['RIGHT', 'RIGHT', 'RIGHT', 'DOWN', 'UP', 'UP', 'RETURN']);
  H.eq(BM.keys(''), []);
});

test('Meter: fps, lange Frames, schlimmster Frame, Bild-Haenger', function () {
  var BM = H.load().N.benchMath, m = new BM.Meter();
  // 1 s mit 16-ms-Frames, dazwischen ein 80-ms-Frame mit Bildereignis und ein 60-ms-Frame ohne
  var t = 1000, img = 0;
  m.frame(t, img);
  for (var i = 0; i < 50; i++) { t += 16; m.frame(t, img); }
  t += 80; img++; m.frame(t, img);
  t += 60; m.frame(t, img);
  var r = m.result();
  assert.strictEqual(r.long, 2);
  assert.strictEqual(r.stall, 1);
  assert.strictEqual(r.worst, 80);
  assert.strictEqual(r.frames, 53);
  assert.strictEqual(r.ms, 50 * 16 + 140);
  assert.strictEqual(r.fps, Math.round(52 * 10000 / 940) / 10);
  assert.ok(/^bench x: [\d.]+ fps, >50ms 2, worst 80ms, imgStall 1, steps 3, 940ms, heap n\/a, dom 7$/.test(BM.line('x', r, { steps: 3, dom: 7 })));
});

test('Szenario-Auswahl: all ohne leak, Praefix, leak:n', function () {
  var BM = H.load().N.benchMath, names = ['home', 'home-hero', 'lib-L', 'lib-M', 'search', 'leak', 'saver-fade', 'saver-zoom'];
  H.eq(BM.pick('saver', names), ['saver-fade', 'saver-zoom']);   // Bildschirmschoner nur auf Wunsch (Ziffern 9,8,4)
  H.eq(BM.pick('all', names), ['home', 'home-hero', 'lib-L', 'lib-M', 'search']);
  H.eq(BM.pick('lib', names), ['lib-L', 'lib-M']);
  H.eq(BM.pick('home', names), ['home', 'home-hero']);
  H.eq(BM.pick(' search , leak:20', names), ['search', 'leak']);
  H.eq(BM.pick('nix', names), []);
});

test('Leck-Bericht: ok bei stabilen Werten, Verdacht bei Wachstum', function () {
  var BM = H.load().N.benchMath;
  var a = { dom: 900, evt: 20, iv: 2, to: 5, img: { cached: 120, queued: 0, active: 0 }, heap: 0, depth: 1 };
  var b = { dom: 930, evt: 20, iv: 2, to: 7, img: { cached: 300, queued: 0, active: 0 }, heap: 0, depth: 1 };
  var r = BM.leaks(a, b, 10);
  assert.ok(r.ok, r.line);
  assert.ok(/=> ok$/.test(r.line));
  var c = { dom: 1500, evt: 25, iv: 3, to: 20, img: { cached: 401, queued: 0, active: 0 }, heap: 0, depth: 2 };
  r = BM.leaks(a, c, 10);
  assert.ok(!r.ok);
  assert.strictEqual(r.bad.length, 6);
  assert.ok(/VERDACHT: DOM \+600; Ereignis-Hoerer \+5; Intervalle \+1; Timer \+15; Bild-LRU 401 > 400; Stapel 1->2/.test(r.line), r.line);
});

test('N.evt.count zaehlt an- und abgemeldete Hoerer', function () {
  var N = H.load().N, base = N.evt.count(), f = function () {};
  N.evt.on('x:a', f); N.evt.on('x:b', f); N.evt.on('x:a', function () {});
  assert.strictEqual(N.evt.count(), base + 3);
  N.evt.off('x:a', f); N.evt.off('x:b', f);
  assert.strictEqual(N.evt.count(), base + 1);
});

test('Bildlader zaehlt Zuweisungen aus der LRU und fertige Downloads', function () {
  var ctx = H.load({ fakeTimers: true }), N = ctx.N, T = ctx.timers;
  N.plex.setServer('http://pms.local:32400', 'TOKEN-A');
  function Img() { this.src = ''; }
  var a = new Img(), b = new Img(), u = N.img.url('/t/1', 'poster');
  N.img.want(a, u, 0); T.tick(100);
  assert.strictEqual(N.img._stats().loads, 0);
  a.onload(); T.tick(100);
  assert.strictEqual(N.img._stats().loads, 1);
  N.img.want(b, u, 0); T.tick(100);                  // LRU-Treffer -> sofort zugewiesen
  assert.strictEqual(N.img._stats().sets, 1);
  assert.strictEqual(b.src, u);
});

test('Dev-Messlauf: Ziffernfolge 9,8,7 (6, 5) startet, andere Folgen nicht; ohne Dev-Quelle aus', function () {
  var N = H.load({ fakeTimers: true }).N, started = [];
  N.devbench.start = function (s) { started.push(s); };
  var k = N.devbench.key;
  assert.strictEqual(k('9'), false); assert.strictEqual(k('8'), false); assert.strictEqual(k('7'), true);
  H.eq(started, ['all']);
  k('9'); k('7'); k('8'); k('7');
  H.eq(started, ['all']);
  k('9'); k('9'); k('8'); k('7');                     // erneutes 9 beginnt die Folge neu
  H.eq(started, ['all', 'all']);
  k('9'); k('8'); assert.strictEqual(k('6'), true);   // perf2: 9,8,6 = home,lib mit Frame-Protokoll; 9,8,5 = Varianten
  k('9'); k('8'); k('5');
  H.eq(started, ['all', 'all', 'home,lib,frames', 'chunk,nocapl,frames']);
  assert.strictEqual(N.devperf.key('9'), false);    // devperf ohne init(dev) -> nicht aktiv
});
