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

test('Hintergrund (N.img.bg): Art scharf, ohne Art Poster/Cover unscharf vom Server, Einstellung aus -> keins (TV 27.10.)', function () {
  var N = setup().N, M = N.model;
  function q(u) { var o = {}; u.split('?')[1].split('&').forEach(function (kv) { var p = kv.split('='); o[p[0]] = decodeURIComponent(p[1]); }); return o; }
  // Film mit Art: 1280x720 scharf
  var b = N.img.bg('/library/metadata/1/art/9', '/library/metadata/1/thumb/9');
  assert.strictEqual(b.soft, false);
  H.eq([q(b.url).width, q(b.url).height, q(b.url).url, 'blur' in q(b.url)], ['1280', '720', '/library/metadata/1/art/9', false]);
  // frisch hinzugefuegter Film ohne Art: Poster nativ 1280 breit (minSize: PMS liefert 1280x1850), maessiger blur + quality vom Server
  var mv = M.norm({ ratingKey: 2, type: 'movie', title: 'Neu', thumb: '/library/metadata/2/thumb/1' });
  b = N.img.bg(mv.art, mv.thumb);
  assert.strictEqual(b.soft, true);
  H.eq([q(b.url).width, q(b.url).height, q(b.url).minSize, q(b.url).blur, q(b.url).quality, q(b.url).url], ['1280', '720', '1', '12', '90', '/library/metadata/2/thumb/1']);
  // Folge ohne Serien-Art: Serienposter (nicht das Folgenbild -> kein Spoiler, ruhiger)
  var ep = M.norm({ ratingKey: 3, type: 'episode', grandparentTitle: 'S', title: 'E', thumb: '/library/metadata/3/thumb/1', grandparentThumb: '/library/metadata/30/thumb/1' });
  assert.strictEqual(q(N.img.bg(ep.art, ep.thumb).url).url, '/library/metadata/30/thumb/1');
  // Folge mit Serien-Art: die Art
  ep = M.norm({ ratingKey: 4, type: 'episode', title: 'E', grandparentArt: '/library/metadata/30/art/1', grandparentThumb: '/library/metadata/30/thumb/1' });
  assert.strictEqual(N.img.bg(ep.art, ep.thumb).soft, false);
  // Track ohne Art: Albumcover
  var tr = M.norm({ ratingKey: 5, type: 'track', title: 'T', thumb: '/t/track', parentThumb: '/library/metadata/50/thumb/1' });
  assert.strictEqual(q(N.img.bg(tr.art, tr.thumb).url).url, '/library/metadata/50/thumb/1');
  // gar kein Bild
  assert.strictEqual(N.img.bg('', ''), null);
  // Einstellung "Hintergrundbilder" aus: weder Art noch Ersatz
  N.session.settings = { backgrounds: false };
  assert.strictEqual(N.img.bg('/a', '/t'), null);
  N.session.settings = { backgrounds: true };
  assert.ok(N.img.bg('/a', '/t'));
});

test('Hintergrund: unscharfes Poster mittig auf 1280x720 beschnitten, nie verzerrt; Art auf CSS-Groesse zurueck', function () {
  var N = setup().N;
  H.eq(N.img.cover(1280, 1850, 1280, 720), { x: 0, y: -565, w: 1280, h: 1850 });  // Poster 2:3 (PMS-Antwort gemessen): 1:1, nur verschoben
  H.eq(N.img.cover(640, 925, 1280, 720), { x: 0, y: -565, w: 1280, h: 1850 });
  H.eq(N.img.cover(640, 640, 1280, 720), { x: 0, y: -280, w: 1280, h: 1280 });   // Albumcover
  H.eq(N.img.cover(640, 360, 1280, 720), { x: 0, y: 0, w: 1280, h: 720 });       // 16:9
  H.eq(N.img.cover(1000, 360, 1280, 720), { x: -360, y: 0, w: 2000, h: 720 });   // breiter als 16:9
  H.eq(N.img.cover(0, 0, 1280, 720), { x: 0, y: 0, w: 1280, h: 720 });
  var img = { naturalWidth: 1280, naturalHeight: 1850, style: {} };
  N.img.fit(img, true);
  H.eq(img.style, { left: '0px', top: '-565px', width: '1280px', height: '1850px' });
  N.img.fit(img, false);
  H.eq(img.style, { left: '', top: '', width: '', height: '' });
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

test('Vorab-Dekodieren (Runde 5): nur geladene Bilder, eines je Frame, nur in Ruhe, nicht doppelt', function () {
  var s = setup(), N = s.N, T = s.T, dec = new Img(), seen = [];
  N.img._dec(dec);
  var a = new Img(), b = new Img();
  N.img.want(a, 'http://pms/a', 1); N.img.want(b, 'http://pms/b', 1);
  T.tick(50); a.onload(); b.onload();                                  // beide geladen (LRU)
  T.tick(200);
  N.idle.touch();
  N.img.warm(['http://pms/a', 'http://pms/nicht-geladen', 'http://pms/b', 'http://pms/a']);
  T.tick(100);
  assert.strictEqual(dec.src, '', 'nicht direkt nach einer Taste');
  var last = '';
  for (var i = 0; i < 40; i++) { T.tick(10); if (dec.src !== last) { seen.push(dec.src); last = dec.src; } }
  H.eq(seen, ['http://pms/a', 'http://pms/b']);                       // Reihenfolge der Liste, Ungeladenes ausgelassen, keine Doppel
  assert.strictEqual(N.img._stats().warms, 2);
  N.img.warm(['http://pms/a']); T.tick(400);
  assert.strictEqual(N.img._stats().warms, 2);                         // kuerzlich dekodiert -> kein zweites Mal
  N.img.reset();
  assert.strictEqual(dec.src, N.img.BLANK);
});
