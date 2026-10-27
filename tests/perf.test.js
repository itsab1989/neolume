'use strict';
/* P7 27.10.: Arbeit je Fokusschritt in Raster (N.ui.Grid) und Reihe (N.ui.Row) mit einem Mini-DOM, Dekodier-Sperre im Bildlader */
var test = require('node:test'), assert = require('node:assert');
var H = require('./helpers/load');

/* Mini-DOM: zaehlt Schreibzugriffe auf style.display / style.left|top und className */
function FakeDoc(stats) {
  function Style() {}
  ['display', 'left', 'top', 'width', 'webkitTransform', 'webkitTransition', 'visibility', 'cssText'].forEach(function (k) {
    Object.defineProperty(Style.prototype, k, {
      get: function () { return this['_' + k] || ''; },
      set: function (v) { stats[k === 'display' ? 'display' : k === 'left' || k === 'top' ? 'pos' : 'other']++; this['_' + k] = v; }
    });
  });
  function El(tag) { this.tagName = tag; this.style = new Style(); this.childNodes = []; this._cls = ''; this.src = ''; }
  Object.defineProperty(El.prototype, 'className', { get: function () { return this._cls; }, set: function (v) { stats.cls++; this._cls = v; } });
  El.prototype.appendChild = function (c) { this.childNodes.push(c); c.parentNode = this; return c; };
  return {
    createElement: function (t) { return new El(t); },
    createTextNode: function (t) { return { nodeValue: t }; }
  };
}
function setup() {
  var stats = { display: 0, pos: 0, other: 0, cls: 0 };
  var ctx = H.load({ fakeTimers: true }), N = ctx.N;
  ctx.document = FakeDoc(stats);
  N.plex.setServer('http://pms.local:32400', 'T');
  N.i18n.set('de');
  var items = [];
  for (var i = 0; i < 200; i++) items.push({ rk: String(i), type: 'movie', title: 'Film ' + i, thumb: '/t/' + i, year: 2000 });
  return { N: N, T: ctx.timers, stats: stats, items: items, doc: ctx.document, reset: function () { for (var k in stats) stats[k] = 0; } };
}
function shown(pool) { return pool.filter(function (e) { return e.on; }).length; }

test('Raster Klein: ▼ fuellt nur sichtbare Zeilen sofort, die Pufferzeile in rAF-Haeppchen, ohne display-Wechsel', function () {
  var s = setup(), N = s.N, G = N.GridMath.make('S'), g = new N.ui.Grid(s.doc.createElement('div'));
  assert.strictEqual(N.ui.Grid.CHUNK, 1); assert.strictEqual(N.ui.Row.CHUNK, 1);   // perf3: Standard 1 Karte je Frame (TV-Messung)
  N.ui.Grid.CHUNK = N.ui.Grid.CHUNK_FAST = 3;                          // Ablauf unten mit 3er-Haeppchen
  g.setGeom(G); g.setModel(s.items, s.items.length, 0); g.setFocused(true);
  assert.strictEqual(g.vis, 3);                                       // 176, 388, 600 liegen im Clip (bis 720)
  assert.strictEqual(shown(g.pool), 36);                              // Zeile 0..3 (keine Zeile -1)
  g.focusTo(9); s.T.tick(100);                                        // ▼: Fenster Zeile 0..4
  assert.strictEqual(shown(g.pool), G.POOL);
  s.reset();
  g.focusTo(18);                                                       // ▼: Zeile 0 wird frei, neue Pufferzeile 5 (45..53)
  for (var i = 18; i < 45; i++) assert.ok(g.byIdx[i], 'sichtbar ' + i);
  assert.ok(!g.byIdx[45], 'Pufferzeile noch nicht im Tastenhandler');
  assert.strictEqual(s.stats.pos, 0, 'im Tastenhandler nichts verschoben');
  s.T.tick(16);
  var filled = 0; for (i = 45; i <= 53; i++) if (g.byIdx[i]) filled++;
  assert.strictEqual(filled, 3, 'ein Haeppchen = 3 Karten je Frame');
  s.T.tick(48);
  for (i = 45; i <= 53; i++) assert.ok(g.byIdx[i], 'Puffer ' + i);
  assert.strictEqual(s.stats.display, 0);
  assert.strictEqual(s.stats.pos, 9 * 2, 'nur top von Karte + Beschriftung (left bleibt je Spalte gleich)');
  assert.strictEqual(shown(g.pool), G.POOL);
});

test('Raster: Ende der Liste versteckt ueberzaehlige Karten erst nach dem letzten Haeppchen', function () {
  var s = setup(), N = s.N, G = N.GridMath.make('L'), g = new N.ui.Grid(s.doc.createElement('div'));
  var few = s.items.slice(0, 22);
  g.setGeom(G); g.setModel(few, few.length, 0); g.setFocused(true);
  g.focusTo(20); s.T.tick(200);                                        // letzte Zeile: Fenster 15..21
  assert.strictEqual(shown(g.pool), 7);
  g.focusTo(0); s.T.tick(200);
  assert.strictEqual(shown(g.pool), 20);
  for (var i = 0; i < 20; i++) assert.ok(g.byIdx[i]);
});

test('Reihe: ▶ fuellt die neue Puffer-Karte erst im naechsten Frame; setModel(mode 2) komplett in Haeppchen', function () {
  var s = setup(), N = s.N;
  N.ui.Row.CHUNK = N.ui.Row.CHUNK_FAST = 3;
  var r = new N.ui.Row(s.doc.createElement('div'), { noHead: true, captions: function () { return true; } });
  r.setModel({ id: 'a', kind: 'poster', items: s.items.slice(0, 30) }, 0);
  r.setFocused(true);
  s.reset();
  r.focusCol(1); r.focusCol(2); r.focusCol(3);                         // sc 0..3: Fenster sc-2 .. sc+8
  assert.ok(!r.byIdx[11], 'Puffer-Karte nicht im Tastenhandler');
  s.T.tick(20);
  assert.ok(r.byIdx[11]);
  assert.strictEqual(s.stats.display, 0);
  // verdeckte Reihe neu belegen: im Aufruf nur ein Haeppchen, die sichtbaren zuerst; Karten bleiben an ihrem Platz
  var other = { id: 'b', kind: 'poster', items: s.items.slice(100, 130) };
  s.reset();
  r.setModel(other, 0, 2);
  var n = Object.keys(r.byIdx).length;
  assert.strictEqual(n, 3);
  assert.ok(r.byIdx[0] && r.byIdx[1] && r.byIdx[2]);
  s.T.tick(100);
  assert.strictEqual(Object.keys(r.byIdx).length, 11);
  assert.strictEqual(s.stats.display, 0, 'kein Ab-/Aufbau von Ebenen');
  for (var i = 0; i < 11; i++) assert.strictEqual(r.byIdx[i].x, i * 200 + 'px');
  // nie zwei sichtbare Karten an derselben Stelle (alte Karte wird an ihrem Platz wiederverwendet)
  var at = {};
  r.pool.forEach(function (e) { if (e.on) { assert.ok(!at[e.x], 'doppelt bei ' + e.x); at[e.x] = 1; } });
});

test('Bildlader: Download losgeloest, sichtbares <img> erst in Ruhe; nach Tastenwiederholung 250 ms Ruhe', function () {
  var s = setup(), N = s.N, T = s.T, pres = [];
  function Pre() { this.src = ''; pres.push(this); }
  N.img._mkPre(function () { return new Pre(); });
  var a = { src: '' }, b = { src: '' };
  N.img.want(a, 'http://pms/a', 0); N.img.want(b, 'http://pms/b', 0);
  T.tick(20);
  assert.strictEqual(pres.length, 2);
  assert.strictEqual(a.src, '', 'sichtbares Bild noch leer, Download laeuft losgeloest');
  N.router._reset(T.now);
  N.ui.hints = { set: function () {} };
  N.idle.touch(); N.fx.step(true);                                     // Tastenwiederholung laeuft
  pres[0].onload(); pres[1].onload();
  T.tick(200);
  assert.strictEqual(a.src, '', 'kein Zuweisen 200 ms nach einer Wiederholungstaste');
  T.tick(100);
  assert.strictEqual(a.src, 'http://pms/a');
  assert.strictEqual(b.src, 'http://pms/b');
  assert.strictEqual(N.img._stats().active, 0);
  // Abbruch: recycelte Karte bricht den losgeloesten Download ab
  var c = { src: '' }; N.img.want(c, 'http://pms/c', 0); T.tick(400);
  var p = pres[pres.length - 1];
  assert.strictEqual(p.src, 'http://pms/c');
  N.img.drop(c);
  assert.strictEqual(p.src, N.img.BLANK);
  assert.strictEqual(N.img._stats().active, 0);
});

test('setup.json: read() meldet io/vorab/warten/luecke fuers Startprotokoll', function () {
  var ctx = H.load({ fakeTimers: true }), N = ctx.N, T = ctx.timers, x = null, got = null;
  function X() { x = this; } X.prototype.open = function () {}; X.prototype.send = function () {};
  N.setupFile.read({}, function (c, w) { got = [c, w]; }, function () { return new X(); });
  T.tick(35);
  x.readyState = 4; x.status = 404; x.responseText = ''; x.onreadystatechange();
  H.eq(got, [null, null]);
  var t = N.setupFile.timing();
  assert.strictEqual(t.io, 35); assert.strictEqual(t.early, 0); assert.strictEqual(t.wait, 35);
  assert.ok(t.gap >= 10 && t.gap <= 15, 'Herzschlag alle 10 ms: ' + t.gap);
});

test('setup.json: onShow-Block des Laders (registKey) im Warten wird als "davon onShow" gemessen (TV 27.10.: luecke 500)', function () {
  var ctx = H.load({ fakeTimers: true }), N = ctx.N, T = ctx.timers, x = null, calls = 0, logs = [];
  function X() { x = this; } X.prototype.open = function () {}; X.prototype.send = function () {};
  ctx.Boot = {}; ctx.onShow = function () { calls++; T.tick(480); };   // Lader: window.onShow = registerKeys (blockiert)
  N.log = function (m) { logs.push(m); };
  N.setupFile._watchShow(); N.setupFile._watchShow();                  // zweimal: keine doppelte Huelle
  N.setupFile.read({}, function () {}, function () { return new X(); });
  T.tick(5);
  ctx.onShow();                                                        // Plattform ruft onShow waehrend des Wartens
  assert.strictEqual(calls, 1);
  x.readyState = 4; x.status = 404; x.responseText = ''; x.onreadystatechange();
  var t = N.setupFile.timing();
  assert.strictEqual(t.show, 480);
  assert.deepStrictEqual(logs, ['onShow (Tasten registrieren) 480 ms']);
  // ohne onShow im Warten: -1
  var c2 = H.load({ fakeTimers: true }), y = null;
  function Y() { y = this; } Y.prototype.open = function () {}; Y.prototype.send = function () {};
  c2.N.setupFile.read({}, function () {}, function () { return new Y(); });
  c2.timers.tick(20); y.readyState = 4; y.status = 404; y.onreadystatechange();
  assert.strictEqual(c2.N.setupFile.timing().show, -1);
});

test('Raster: ankommende Seite (refresh) fuellt sichtbare Zeilen sofort, Puffer in Haeppchen', function () {
  var s = setup(), N = s.N, G = N.GridMath.make('S'), g = new N.ui.Grid(s.doc.createElement('div'));
  var sparse = s.items.slice(0, 18);                                   // nur 2 Zeilen geladen, Gesamtzahl 200
  g.setGeom(G); g.setModel(sparse, 200, 0); g.setFocused(true);
  assert.strictEqual(g.byIdx[20].it, null, 'Platzhalter');
  for (var i = 18; i < 50; i++) sparse[i] = s.items[i];
  g.refresh(18, 49);
  for (i = 18; i < 27; i++) assert.strictEqual(g.byIdx[i].it, s.items[i], 'sichtbar sofort ' + i);
  assert.strictEqual(g.byIdx[27].it, undefined, 'Pufferzeile 3 noch nicht');
  s.T.tick(200);
  for (i = 27; i < 36; i++) assert.strictEqual(g.byIdx[i].it, s.items[i], 'Puffer ' + i);
});
