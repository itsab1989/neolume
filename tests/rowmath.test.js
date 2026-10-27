'use strict';
var test = require('node:test'), assert = require('node:assert');
var H = require('./helpers/load');
var N = H.load().N, R = N.RowMath;

test('Geometrie: ganz sichtbare und angeschnittene Karten', function () {
  var L = R.geom('land'), P = R.geom('poster');
  assert.strictEqual(L.full, 3); assert.strictEqual(L.visible, 4); assert.strictEqual(L.pool, 8);
  assert.strictEqual(P.full, 5); assert.strictEqual(P.visible, 6); assert.strictEqual(P.pool, 11);
  assert.ok(144 + L.full * L.step - (L.step - L.w) <= 1216);
  assert.ok(144 + P.full * P.step - (P.step - P.w) <= 1216);
});

test('Fokus-Anker: Ring bleibt auf Spalte 1, erst am Reihenende wandert er', function () {
  var P = R.geom('poster'), n = 20, cols = [];
  for (var f = 0; f < n; f++) cols.push(R.col(f, R.scroll(n, f, P.full)));
  assert.deepStrictEqual(cols.slice(0, 16), new Array(16).fill(0));
  assert.deepStrictEqual(cols.slice(15), [0, 1, 2, 3, 4]);
  assert.strictEqual(R.scroll(3, 2, P.full), 0);             // kurze Reihe scrollt nie
  assert.strictEqual(R.x(7, 5, P), 144 + 2 * 200);
});

test('Fenster deckt immer alle sichtbaren Karten ab und passt in den Pool', function () {
  ['land', 'poster'].forEach(function (k) {
    var g = R.geom(k);
    [1, 3, 8, 11, 12, 40].forEach(function (n) {
      for (var f = 0; f < n; f++) {
        var sc = R.scroll(n, f, g.full), w = R.win(n, sc, g.pool);
        assert.ok(w.last - w.first + 1 <= g.pool, k + ' Pool ' + n + '/' + f);
        for (var i = sc; i < Math.min(n, sc + g.visible); i++) assert.ok(i >= w.first && i <= w.last, k + ' n=' + n + ' f=' + f + ' i=' + i);
        assert.ok(f >= w.first && f <= w.last);
        // auch Zeiger-Fokus (Scroll steht, Fokus irgendwo in den ganz sichtbaren Karten)
        for (var j = sc; j < Math.min(n, sc + g.full); j++) assert.ok(j >= w.first && j <= w.last);
      }
    });
  });
});

test('Recycling: ein Schritt nach rechts tauscht hoechstens 1 Karte', function () {
  var P = R.geom('poster'), n = 30;
  for (var f = 0; f < n - 1; f++) {
    var d = R.diff(n, R.scroll(n, f, P.full), R.scroll(n, f + 1, P.full), P.pool);
    assert.ok(d.add.length <= 1 && d.remove.length === d.add.length, 'f=' + f);
  }
});

test('Zeiger-Treffer per Index-Mathe (nur Kartenkoerper, nicht die Luecke)', function () {
  var L = R.geom('land'), n = 10;
  assert.strictEqual(R.hit(n, 0, L, 144), 0);
  assert.strictEqual(R.hit(n, 0, L, 144 + 287), 0);
  assert.strictEqual(R.hit(n, 0, L, 144 + 290), -1);          // Luecke 24 px
  assert.strictEqual(R.hit(n, 0, L, 144 + 312), 1);
  assert.strictEqual(R.hit(n, 4, L, 144 + 2 * 312 + 5), 6);    // gescrollt
  assert.strictEqual(R.hit(n, 0, L, 1100), -1);               // angeschnittene 4. Karte nicht waehlbar
  assert.strictEqual(R.hit(n, 0, L, 100), -1);                // Rail-Bereich
  assert.strictEqual(R.hit(2, 0, L, 144 + 2 * 312 + 5), -1);  // hinter dem Ende
});

test('Zeiger-Pfeile blaettern um eine Bildschirmbreite und behalten die Spalte', function () {
  var P = R.geom('poster');
  H.eq(R.page(30, 2, 0, P.full, 1), { sc: 5, f: 7 });
  H.eq(R.page(30, 7, 5, P.full, -1), { sc: 0, f: 2 });
  H.eq(R.page(12, 9, 5, P.full, 1), { sc: 7, f: 11 });   // am Ende begrenzt
  H.eq(R.page(4, 1, 0, P.full, 1), { sc: 0, f: 1 });
});

test('N.hit: Liste, Raster (PIN-Block wie im Dialog), Rechteck', function () {
  var h = N.hit;
  assert.strictEqual(h.list(112, 64, 64, 4, 112), 0);
  assert.strictEqual(h.list(112, 64, 64, 4, 175), 0);
  assert.strictEqual(h.list(112, 64, 64, 4, 176), 1);
  assert.strictEqual(h.list(112, 64, 64, 4, 400), -1);
  assert.strictEqual(h.list(112, 72, 64, 4, 112 + 66), -1);   // Luecke
  // PIN-Tasten: x 504/600/696 (80 breit), y 300/376/452/528 (64 hoch)
  function pin(x, y) { return h.grid(504, 300, 80, 64, 96, 76, 3, 12, x, y); }
  assert.strictEqual(pin(640, 408), 4);     // "5"
  assert.strictEqual(pin(510, 560), 9);     // Loeschen
  assert.strictEqual(pin(770, 590), 11);    // OK
  assert.strictEqual(pin(590, 330), -1);    // zwischen den Tasten
  assert.strictEqual(pin(640, 600), -1);    // unterhalb
  assert.ok(h.rect(144, 568, 240, 48, 200, 590));
  assert.ok(!h.rect(144, 568, 240, 48, 200, 620));
});
