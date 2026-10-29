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

/* TV-Befund 1.0.5: Reihen-Listen per Zeiger (Startseite, Suche/Entdecken) */
test('Startseite: Zone "naechste Reihe" ab ihrem Kopf, bei hoher Posterreihe ab der Kartenunterkante + fester Hinweis', function () {
  // Startseite: Kopf y 320, Karten ab 372; Abstand land 288, poster 360, sq 280
  H.eq(R.nextZone(320 + 288, 372 + 162), { y: 608, cue: false }, 'Querformat: Kopf der naechsten Reihe im Bild');
  H.eq(R.nextZone(320 + 280, 372 + 176), { y: 600, cue: false }, 'quadratisch: Kopf im Bild');
  H.eq(R.nextZone(320 + 360, 372 + 264), { y: 640, cue: true }, 'Poster: Kopf (y 680) nicht im Bild -> Band unter den Karten');
});

test('Sichtbarkeit fuer den Zeiger: ganz (sofort), >= 40 % (nach Verweilen), sonst nicht zeigbar; untere Randzone', function () {
  assert.strictEqual(R.vis(100, 180, 52), 'full');
  assert.strictEqual(R.vis(452, 180, 52), 'full', 'endet genau an der Unterkante 632');
  assert.strictEqual(R.vis(520, 180, 52), 'part', '112 von 180 px sichtbar');
  assert.strictEqual(R.vis(572, 180, 52), '', '60 von 180 px: zu wenig');
  assert.strictEqual(R.vis(640, 180, 52), '', 'unter der Kante');
  assert.strictEqual(R.vis(40, 180, 52), '', 'oben unter dem Ausschnittrand');
  assert.strictEqual(R.edgeB([{ cy: 100, h: 180 }, { cy: 416, h: 162 }], 52), 604);
  assert.strictEqual(R.edgeB([{ cy: 100, h: 180 }, { cy: 520, h: 180 }], 52), 604, 'zeigbare angeschnittene Reihe: schmales Band');
  assert.strictEqual(R.edgeB([{ cy: 100, h: 180 }, { cy: 572, h: 180 }], 52), 572, 'nicht zeigbare Reihe gehoert zur Randzone');
});

test('Detailseiten per Zeiger (DET-9): nur der eingerastete Abschnitt bekommt sofort Fokus', function () {
  // Serie, Knoepfe (Versatz 0): Staffel-Reiter y 580–620 ganz im Bild, aber anderer Abschnitt -> erst hereinholen
  assert.strictEqual(R.secVis(580, 40, false, 0), 'part');
  assert.strictEqual(R.secVis(640, 162, false, 0), '', 'Folgen unter der Kante');
  assert.strictEqual(R.secVis(392, 162, true, 316), 'full', 'eingerastete Folgenreihe');
  assert.strictEqual(R.secVis(392, 264, true, 316), 'full', 'eingerastete Posterreihe ragt in den Verlauf: trotzdem ganz');
  assert.strictEqual(R.secVis(144, 120, false, 316), '', 'ausgeblendeter Abschnitt ueber dem Kopf');
  assert.strictEqual(R.secVis(596, 56, false, 236), 'part', 'erste Zeile "Beliebte Titel" unter der letzten Reihe (64 %)');
  assert.strictEqual(R.secVis(604, 176, false, 236), '', 'naechste Kuenstler-Reihe: 16 % sichtbar');
  var st = [0, 248, 536, 784];
  assert.strictEqual(R.secNext(st, 0, 1), 1);
  assert.strictEqual(R.secNext(st, 248, 1), 2);
  assert.strictEqual(R.secNext(st, 784, 1), -1, 'letzter Abschnitt');
  assert.strictEqual(R.secNext(st, 536, -1), 1);
  assert.strictEqual(R.secNext(st, 0, -1), -1, 'ganz oben');
  assert.strictEqual(R.secEdgeB([{ cy: 580, h: 40 }, { cy: 640, h: 162 }], 0), 620, 'Reiter ragen in die Zone: sie beginnt darunter');
  assert.strictEqual(R.secEdgeB([{ cy: 392, h: 162 }, { cy: 680, h: 162 }], 316), 604);
  assert.strictEqual(R.secEdgeB([{ cy: 288, h: 176 }, { cy: 592, h: 176 }], 236), 592, 'nicht zeigbare angeschnittene Reihe gehoert zur Zone');
});
