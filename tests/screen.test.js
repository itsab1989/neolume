'use strict';
/* Flexible App-Flaeche (N.screen, docs/research/apple/08-touch.md 8): am Fernseher (caps.screen.flex aus) liefern alle
 * Rechnungen exakt die festen 1280x720-Werte; mit flex (Apple) waechst die Flaeche, Reihen/Raster bekommen mehr Karten. */
var test = require('node:test'), assert = require('node:assert');
var load = require('./helpers/load.js').load;
function J(v) { return JSON.parse(JSON.stringify(v)); }
/* GridMath-Zahlen einer Ansicht (Funktionswerte ausgewertet) */
function gridNums(G) {
  return { COLS: G.COLS, AFTER: G.AFTER, POOL: G.POOL, X0: G.X0, Y0: G.Y0, W: G.W, H: G.H, SX: G.SX, SY: G.SY, full: G.full(), part: G.part(),
    edgeB: G.edgeB(), width: G.width(), hit: [G.hit(200, 0, 150, 200), G.hit(200, 0, 150, 631), G.hit(200, 0, 150, 632)] };
}

test('Fernseher: N.screen bleibt 1280x720, keine Verschiebung, flexible Ansichten rechnen mit 1280x720', function () {
  var N = load().N;
  N.screen.init();
  assert.strictEqual(N.screen.flex, false);
  assert.deepStrictEqual([N.screen.w, N.screen.h], [1280, 720]);
  assert.deepStrictEqual(J(N.screen.area(true)), { w: 1280, h: 720 });
  assert.deepStrictEqual(J(N.screen.off()), { x: 0, y: 0 });
  N.evt.emit('screen:changed', { w: 1600, h: 900 });                  // am TV ohne Wirkung
  assert.deepStrictEqual([N.screen.w, N.screen.h], [1280, 720]);
});

test('Fernseher: RowMath bei 1280 = feste Tabelle (dieselben Objekte), VIS 632', function () {
  var R = load().N.RowMath, want = { land: [3, 4], poster: [5, 6], cast: [7, 8], sq: [5, 6], posterQ: [4, 5], landS: [2, 3], castS: [4, 5] };
  Object.keys(want).forEach(function (k) {
    assert.strictEqual(R.geom(k, 1280), R.geom(k), k);
    assert.strictEqual(R.geom(k, 0), R.geom(k), k);
    assert.deepStrictEqual([R.geom(k).full, R.geom(k).visible], want[k], k);
  });
  assert.strictEqual(R.visFor(720), 632); assert.strictEqual(R.visFor(), 632);
  assert.deepStrictEqual(J(R.nextZone(600, 534)), J(R.nextZone(600, 534, 632)));
});

test('Fernseher: GridMath mit Flaeche 1280x720 = ohne Flaeche (alle Ansichten, Poster und quadratisch)', function () {
  var GM = load().N.GridMath, tv = { L: [5, 3, 1], M: [6, 3, 1], S: [9, 3, 2], list: [1, 6, 5] };
  [false, true].forEach(function (sq) {
    GM.VIEWS.forEach(function (v) {
      var a = GM.make(v, sq), b = GM.make(v, sq, { w: 1280, h: 720 });
      assert.deepStrictEqual(gridNums(b), gridNums(a), v + (sq ? ' sq' : ''));
      assert.strictEqual(a.VIS, 632);
      if (!sq) assert.deepStrictEqual([a.COLS, a.AFTER, a.full()], tv[v], v);
    });
  });
  assert.strictEqual(GM.COLS, 5); assert.strictEqual(GM.AH, 720);
});

test('Flexibel: breitere Flaeche -> mehr Karten je Reihe und mehr Spalten, A–Z-Leiste bleibt frei', function () {
  var N = load().N, R = N.RowMath, GM = N.GridMath;
  var p = R.geom('poster', 1562);
  assert.notStrictEqual(p, R.geom('poster'));
  assert.deepStrictEqual([p.full, p.visible, p.w, p.step], [6, 8, 176, 200]);
  assert.strictEqual(R.geom('poster', 1562), p, 'je Breite einmal berechnet');
  assert.strictEqual(R.geom('posterQ', 1562), R.geom('posterQ'), 'Suche bleibt fest');
  assert.ok(144 + p.full * p.step - (p.step - p.w) <= 1562 - 64);
  ['L', 'M', 'S'].forEach(function (v) {
    var G = GM.make(v, false, { w: 1562, h: 720 });
    assert.ok(G.COLS > GM.make(v).COLS, v + ' mehr Spalten');
    assert.ok(G.X0 + G.width() <= 1562 - 144, v + ' Raster endet vor der A–Z-Leiste');
    assert.strictEqual(G.POOL, (2 + G.AFTER) * G.COLS);
  });
  var T = GM.make('L', false, { w: 1280, h: 960 });                    // iPad 4:3: mehr Zeilen, Zonen bis weiter unten
  assert.strictEqual(T.COLS, 5); assert.strictEqual(T.AFTER, 4); assert.strictEqual(T.VIS, 872);
  assert.ok(T.full() >= GM.make('L').full());
  assert.strictEqual(T.hit(200, 0, 150, 700) >= 0, true);
});

test('Flexibel: N.screen liest screen.size(), gerade Werte >= 1280x720, meldet Wechsel einmal als screen:resized', function () {
  var N = load().N, size = { w: 1280, h: 960 }, got = [];
  N.platform.caps.screen.flex = true;
  N.platform.screen.size = function () { return size; };
  N.screen.init();
  assert.strictEqual(N.screen.flex, true);
  assert.deepStrictEqual([N.screen.w, N.screen.h], [1280, 960]);
  assert.deepStrictEqual(J(N.screen.off()), { x: 0, y: 120 });
  assert.deepStrictEqual(J(N.screen.area(false)), { w: 1280, h: 720 });
  N.evt.on('screen:resized', function (d) { got.push(d); });
  N.evt.emit('screen:changed', { w: 1561, h: 719 });
  assert.deepStrictEqual([N.screen.w, N.screen.h], [1562, 720]);
  N.evt.emit('screen:changed', { w: 1562, h: 720 });                  // gleiche Groesse: nichts
  assert.deepStrictEqual(J(got), [{ w: 1562, h: 720 }]);
  assert.deepStrictEqual(J(N.screen.off()), { x: 141, y: 0 });
});

test('Hochformat-tauglich (Nr. 16): schmale Flaeche -> weniger Spalten/Karten, Mindestflaeche aus caps.screen', function () {
  var N = load().N, GM = N.GridMath, R = N.RowMath;
  var G = GM.make('L', false, { w: 834, h: 1194 });
  assert.ok(G.COLS >= 1 && G.COLS < 5);
  assert.ok(R.geom('poster', 834).full < R.geom('poster').full);
  N.platform.caps.screen = { w: 720, h: 1024, scale: 2, flex: true };
  N.platform.screen.size = function () { return { w: 834, h: 1194 }; };
  N.screen.init();
  assert.deepStrictEqual([N.screen.w, N.screen.h], [834, 1194]);
  assert.ok(N.screen.off().x < 0, 'Kasten breiter als die Flaeche');
});
