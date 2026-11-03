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
  assert.deepStrictEqual(J(got), [{ w: 1562, h: 720, cls: 'R\u00b7N', clsChanged: false }]);
  assert.deepStrictEqual(J(N.screen.off()), { x: 141, y: 0 });
  assert.deepStrictEqual(J(N.screen.stage()), { x: 141, y: 0, k: 1 });
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
  // 10-screens.md 6.3: der Kasten wird verkleinert statt abgeschnitten (nie negativer Versatz)
  var g = N.screen.stage();
  assert.ok(g.x >= 0 && g.k < 1, 'Kasten verkleinert, ganz in der Flaeche');
  assert.ok(Math.abs(g.k - 834 / 1280) < 1e-9 && Math.abs(1280 * g.k + 2 * g.x - 834) < 1e-9);
  var p = N.screen.fromStage(640, 360), q = N.screen.toStage(p.x, p.y);
  assert.ok(Math.abs(p.x - 417) < 1e-9 && Math.abs(q.x - 640) < 1e-9 && Math.abs(q.y - 360) < 1e-9, 'toStage/fromStage invers');
});

test('Groessenklassen (10-screens.md 6.2): Breite K < 800 <= M < 1280 <= R, Hoehe F < 720 <= N; Wechsel gemeldet', function () {
  var N = load().N, size = { w: 1280, h: 900 }, got = [];
  assert.strictEqual(N.screen.cls.id, 'R\u00b7N', 'TV: immer R·N');
  N.platform.caps.screen = { w: 544, h: 516, scale: 2, flex: true };
  N.platform.screen.size = function () { return size; };
  N.screen.init();
  assert.strictEqual(N.screen.cls.id, 'R\u00b7N');
  N.evt.on('screen:resized', function (d) { got.push(d.cls + (d.clsChanged ? '!' : '')); });
  [[960, 1232], [586, 1132], [1092, 556], [798, 718], [1280, 720], [1280, 700]].forEach(function (z) { size = { w: z[0], h: z[1] }; N.evt.emit('screen:changed', size); });
  assert.deepStrictEqual(got, ['M\u00b7N!', 'K\u00b7N!', 'M\u00b7F!', 'K\u00b7F!', 'R\u00b7N!', 'R\u00b7F!']);
  assert.strictEqual(N.screen.is('R'), true); assert.strictEqual(N.screen.is('K'), false);
  assert.deepStrictEqual(J(N.screen.classOf(545, 941)), { w: 'K', h: 'N', id: 'K\u00b7N' });
});

test('Anordnung je Breitenklasse (10-screens.md 6.3): R wie TV, M Inhalt ab x 80, K ab x 24 + Leiste unten; TV unveraendert', function () {
  var N = load().N, size = { w: 1280, h: 912 };
  N.screen.init();
  assert.deepStrictEqual(J(N.screen.view()), { x: 0, y: 0, w: 1280, h: 720 }, 'TV');
  assert.deepStrictEqual(J(N.screen.shape()), { cut: 0, bar: 0 });
  N.platform.caps.screen = { w: 544, h: 516, scale: 2, flex: true };
  N.platform.screen.size = function () { return size; };
  N.screen.init();
  assert.deepStrictEqual(J(N.screen.view()), { x: 0, y: 0, w: 1280, h: 912 }, 'R');
  size = { w: 960, h: 1232 }; N.evt.emit('screen:changed', size);
  assert.deepStrictEqual(J(N.screen.view()), { x: -64, y: 0, w: 1024, h: 1232 }, 'M: Kante 144 - 64 = 80');
  size = { w: 586, h: 1132 }; N.evt.emit('screen:changed', size);
  assert.deepStrictEqual(J(N.screen.view()), { x: -120, y: 0, w: 706, h: 1132 - N.screen.TAB_H }, 'K: Kante 24, Leiste unten');
  // Raster: rechts nur 88 frei (A–Z am Rand) -> Spalten nach Formel; Reihen: mehr Karten als ohne Kante
  var G = N.GridMath.make('L', false, { w: 1024, h: 1232, r: 88 }), Gm = N.GridMath.make('M', false, { w: 1024, h: 1232, r: 88 });
  assert.deepStrictEqual([G.COLS, Gm.COLS], [4, 4]);
  assert.strictEqual(N.GridMath.make('S', false, { w: 706, h: 1044, r: 88 }).COLS, 4);
});

test('Overlays nach ihrem Kasten (N.screen.place): Panel rechts buendig, Dialog mittig, nur so weit verkleinert wie noetig', function () {
  var N = load().N;
  N.platform.caps.screen = { w: 544, h: 516, scale: 2, flex: true };
  N.platform.screen.size = function () { return { w: 586, h: 1132 }; };
  N.screen.init();
  function ov(cls, l, t, w, h) { return { el: { style: {}, children: [{ className: 'dim' }, { className: cls, offsetLeft: l, offsetTop: t, offsetWidth: w, offsetHeight: h }] } }; }
  var p = ov('panel', 840, 0, 440, 720), g = N.screen.place(p);
  // K·N (iPhone hoch): Blatt von unten – mittig, am unteren Rand, volle Groesse, Klasse p-sheet am Overlay
  assert.deepStrictEqual(J(g), { x: 586 / 2 - (840 + 220), y: 1132 - 720, k: 1, sheet: true }, 'Panel als Blatt von unten');
  assert.strictEqual(p.el.style.transform, 'translate(-767px,412px) scale(1)');
  assert.ok(/(^|\s)p-sheet(\s|$)/.test(p.el.className));
  assert.strictEqual(N.screen.stageFor(p), p._st);
  N.evt.emit('screen:changed', { w: 836, h: 1222 });   // M·N (iPad hoch): rechts buendig in voller Groesse, keine Blatt-Klasse
  var pm = ov('panel', 840, 0, 440, 720), gm = N.screen.place(pm);
  assert.deepStrictEqual(J(gm), { x: 836 - 1280, y: (1222 - 720) / 2, k: 1 }, 'Panel in voller Groesse am rechten Rand');
  assert.ok(!/p-sheet/.test(pm.el.className || ''));
  N.evt.emit('screen:changed', { w: 586, h: 1132 });
  var d = ov('dlg c', 370, 230, 540, 260), gd = N.screen.place(d);
  assert.ok(Math.abs(gd.k - 554 / 540) < 1e-9 || gd.k === 1);
  assert.ok(Math.abs(gd.x + (370 + 270) * gd.k - 293) < 1e-6, 'Dialog mittig');
  var big = ov('dlg', 320, 200, 640, 300), gb = N.screen.place(big);
  assert.ok(Math.abs(gb.k - 554 / 640) < 1e-9, 'breiter als die Flaeche: verkleinert auf 16 px Rand');
  var pf = ov('panel pfull', 840, 0, 440, 720), gf = N.screen.place(pf);
  assert.deepStrictEqual(J(gf), J(N.screen.stage()), 'Player-Panel (pfull): Kasten wie bisher');
  var T = N.ui.tabbar;
  assert.deepStrictEqual(['home', 'search', 'settings', 'lib-3', 'discover', ''].map(T.tabOf), ['home', 'search', 'settings', 'lib', '', '']);
  assert.deepStrictEqual([T.hitTab(0, 586), T.hitTab(150, 586), T.hitTab(585, 586), T.hitTab(600, 586)], [0, 1, 3, -1]);
});

test('Falz (iPhone Duo, screen.geometry): gerade Spaltenzahl, Luecke der mittleren Spalten auf dem Falz; ohne Falz unveraendert', function () {
  var N = load().N, GM = N.GridMath;
  var A = { w: 1280, h: 902 }, G0 = GM.make('L', false, A), G = GM.make('L', false, { w: 1280, h: 902, fold: 640 });
  assert.strictEqual(G0.X0, 144);
  assert.strictEqual(G.COLS % 2, 0);
  var gapL = G.X0 + (G.COLS / 2 - 1) * G.SX + G.W, gapR = G.X0 + (G.COLS / 2) * G.SX;
  assert.ok(gapL <= 640 && gapR >= 640, 'Falz in der Luecke ' + gapL + '..' + gapR);
  assert.ok(G.X0 >= 144 && G.X0 + G.width() <= 1280 - 144);
  N.platform.caps.screen = { w: 544, h: 516, scale: 2, flex: true };
  N.platform.screen.size = function () { return { w: 1280, h: 902, fold: [{ x: 638, y: 0, w: 4, h: 902 }, { x: 0, y: 400, w: 1280, h: 4 }] }; };
  N.screen.init();
  assert.deepStrictEqual(J(N.screen.fold), [{ x: 638, w: 4 }], 'nur senkrechte Streifen');
  assert.strictEqual(N.screen.foldX(), 640);
});
