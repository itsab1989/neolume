'use strict';
var test = require('node:test'), assert = require('node:assert');
var H = require('./helpers/load');

function setup() {
  var ctx = H.load({ fakeTimers: true }), N = ctx.N;
  N.plex.setServer('http://pms.local:32400', 'TOKEN-A');
  return { ctx: ctx, N: N, T: ctx.timers };
}
function Img() { this.src = ''; this.onload = null; this.onerror = null; }

test('URL in exakter Groesse mit Profil-Token, Pfad kodiert', function () {
  var N = setup().N;
  var u = N.img.url('/library/metadata/1/thumb/2', 'poster');
  assert.strictEqual(u, 'http://pms.local:32400/photo/:/transcode?width=176&height=264&minSize=1&upscale=1&format=jpeg&url=%2Flibrary%2Fmetadata%2F1%2Fthumb%2F2&X-Plex-Token=TOKEN-A');
  assert.ok(/width=288&height=162/.test(N.img.url('/x', 'land')));
  assert.ok(/width=1280&height=720/.test(N.img.url('/x', 'hero')));       // am TV gemessen (PHASE1)
  assert.ok(/width=160&height=160/.test(N.img.url('https://plex.tv/users/a/avatar?c=1', 'avatar')));
  assert.ok(/url=https%3A%2F%2Fplex\.tv/.test(N.img.url('https://plex.tv/users/a/avatar?c=1', 'avatar')));
  assert.ok(/blur=24/.test(N.img.url('/x', 'backdrop', { blur: 24 })));
  assert.ok(/X-Plex-Token=OTHER/.test(N.img.url('/x', 'avatar', { token: 'OTHER' })));
  assert.strictEqual(N.img.url('', 'poster'), '');
});

test('Lader: max. 4 gleichzeitig, max. 2 neue src pro Frame, LRU-Treffer sofort', function () {
  var s = setup(), N = s.N, T = s.T, imgs = [];
  for (var i = 0; i < 10; i++) { imgs.push(new Img()); N.img.want(imgs[i], 'http://pms/' + i, 0); }
  T.tick(20);
  var started = imgs.filter(function (m) { return /pms\/\d/.test(m.src); }).length;
  assert.ok(started <= 2, 'pro Frame hoechstens 2, waren ' + started);
  T.tick(500);
  started = imgs.filter(function (m) { return /pms\/\d/.test(m.src); }).length;
  assert.strictEqual(started, 4);                                    // nie mehr als 4 Downloads
  assert.strictEqual(N.img._stats().active, 4);
  imgs[0].onload(); imgs[1].onload();
  T.tick(200);
  assert.strictEqual(N.img._stats().active, 4);
  assert.strictEqual(imgs.filter(function (m) { return /pms\/\d/.test(m.src); }).length, 6);
  // LRU: bereits geladene URL wird ohne Download zugewiesen
  var again = new Img(); N.img.want(again, 'http://pms/0', 0); T.tick(50);
  assert.strictEqual(again.src, 'http://pms/0');
  assert.strictEqual(N.img._stats().active, 4);
});

test('Lader pausiert waehrend Tasten (150 ms Ruhe) und verwirft recycelte Auftraege', function () {
  var s = setup(), N = s.N, T = s.T;
  N.idle.touch();
  var a = new Img(); N.img.want(a, 'http://pms/a', 0);
  T.tick(100);
  assert.ok(!/pms/.test(a.src), 'kein Laden direkt nach einer Taste');
  T.tick(300);
  assert.strictEqual(a.src, 'http://pms/a');
  var b = new Img(); N.img.want(b, 'http://pms/b', 1); N.img.drop(b); T.tick(500);
  assert.strictEqual(b.src, '');                                       // nie gestartet
  N.img.drop(a);
  assert.strictEqual(a.src, N.img.BLANK);                              // nie src="" – Platzhalter-GIF
});

test('Fehler: 1 Wiederholung nach 2 s, dann Platzhalter', function () {
  var s = setup(), N = s.N, T = s.T, a = new Img(), result = null;
  N.img.want(a, 'http://pms/err', 0, function (ok) { result = ok; });
  T.tick(50); a.onerror();
  assert.strictEqual(a.src, N.img.BLANK);
  T.tick(2100);
  assert.strictEqual(a.src, 'http://pms/err');
  a.onerror(); T.tick(10);
  assert.strictEqual(result, false);
  assert.strictEqual(a.src, N.img.BLANK);
});

test('Profilwechsel leert Warteschlange und LRU', function () {
  var s = setup(), N = s.N, T = s.T, a = new Img();
  N.img.want(a, 'http://pms/x', 0); T.tick(50); a.onload();
  assert.strictEqual(N.img._stats().cached, 1);
  N.img.reset();
  assert.strictEqual(N.img._stats().cached, 0);
  assert.strictEqual(N.img._stats().queued, 0);
});
