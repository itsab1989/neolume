'use strict';
/* Freies Scrollen (Apple Nr. 12/18, 08-touch S5–S7): reine Mathe von Reihe und Raster mit Pixel-Lage. In Ruhe nach Tasten gilt
 * px = sc * step bzw. py = r * SY – dann muessen die px-Fassungen genau die bisherigen Index-Werte liefern (TV unveraendert).
 * Dazu: Nr. 22 (Finger-Wisch oeffnet nie die Seitenleiste), Bildlader-Stufen je caps.images. */
var test = require('./helpers/load').appleTest(require('node:test')), assert = require('node:assert');
var H = require('./helpers/load');
var N = H.load().N, R = N.RowMath, GM = N.GridMath;

test('RowMath: mit px = sc*step gleich wie die Index-Fassung (Fenster, Lage, Treffer, Anker)', function () {
  ['land', 'poster', 'cast', 'sq'].forEach(function (k) {
    [1280, 1440].forEach(function (W) {
      var g = R.geom(k, W), n = 23;
      for (var sc = 0; sc <= R.maxScroll(n, g.full); sc++) {
        var px = sc * g.step;
        assert.strictEqual(R.scOf(px, g.step, n), sc, k + ' scOf');
        assert.deepStrictEqual(R.win(n, R.scOf(px, g.step, n), 11), R.win(n, sc, 11));
        assert.strictEqual(R.anchor(px, g.step, n), sc, 'erste ganz sichtbare Karte');
        for (var i = sc; i < sc + g.visible; i++) assert.strictEqual(R.xPx(i, px, g), R.x(i, sc, g));
        for (var x = 100; x < W; x += 7) {
          var a = R.hit(n, sc, g, x), b = R.hitPx(n, px, g, x, W);
          if (a >= 0) assert.strictEqual(b, a, k + ' x ' + x);   // ganz sichtbare Karten: gleicher Treffer
          else if (b >= 0) assert.ok(b >= sc + g.full || x < 144, 'zusaetzlich nur angeschnittene Karten ' + k + ' x ' + x);
        }
      }
    });
  });
});

test('RowMath: Zwischenlagen, Grenzen, angeschnittene Karten treffen', function () {
  var g = R.geom('poster'), n = 12;
  assert.strictEqual(R.scOf(-40, g.step, n), 0, 'Gummiband am Anfang');
  assert.strictEqual(R.scOf(1e6, g.step, n), n - 1);
  assert.strictEqual(R.scOf(350, g.step, n), 1);
  assert.strictEqual(R.anchor(350, g.step, n), 2, 'Karte 1 halb links draussen -> Karte 2');
  assert.strictEqual(R.maxPx(n, g, 1280), 144 + 11 * 200 + 176 - 1216, 'letzte Karte endet am rechten Rand');
  assert.strictEqual(R.maxPx(3, g, 1280), 0, 'kurze Reihe scrollt nicht');
  assert.strictEqual(R.hitPx(n, 350, g, 144 + 60, 1280), 2, 'x 204 bei px 350: Karte 2');
  assert.strictEqual(R.hitPx(n, 350, g, 140, 1280), 1, 'angeschnittene Karte links trifft');
  assert.strictEqual(R.hitPx(n, 350, g, 144 + 230, 1280), -1, 'Luecke zwischen Karten');
  assert.strictEqual(R.xPx(3, 350, g), 144 + 600 - 350);
});

test('GridMath: mit py = r*SY gleich wie die Index-Fassung; ahead nur mit Vorrat', function () {
  ['L', 'M', 'S', 'list'].forEach(function (v) {
    [null, { w: 1280, h: 960 }].forEach(function (area) {
      var G = GM.make(v, false, area), n = 157;
      for (var r = 0; r < G.rows(n); r++) {
        var py = r * G.SY;
        assert.strictEqual(G.rowPx(n, py), r);
        assert.strictEqual(G.offPx(py), G.offset(r));
        assert.strictEqual(G.anchorRow(n, py), r);
        for (var y = G.Y0; y < G.VIS; y += 11) for (var x = 130; x < 1200; x += 37) {
          var a = G.hit(n, r, x, y), b = G.hitPx(n, py, x, y);
          if (a >= 0) assert.strictEqual(b, a, v + ' ' + x + ',' + y);
        }
      }
    });
  });
  var T = GM.make('L'), F = GM.make('L', false, null, 3);
  assert.strictEqual(T.POOL, GM.POOL, 'ohne ahead: TV-Pool');
  assert.strictEqual(T.BEFORE, 1); assert.strictEqual(F.BEFORE, 4); assert.strictEqual(F.AFTER, T.AFTER + 3);
  assert.strictEqual(F.POOL, (F.BEFORE + F.AFTER + 1) * F.COLS);
  assert.ok(F.pagesFor(1000, 10).length >= T.pagesFor(1000, 10).length);
  assert.strictEqual(T.maxPx(10), Math.max(0, 2 * 340 - (632 - 176)));
  assert.strictEqual(T.hitPx(50, 170, 150, 170), 0, 'angeschnittene Zeile oben trifft (y 170 + py 170 -> Zeile 0)');
});

test('Nr. 22: Pfeil aus einem Finger-Wisch oeffnet nie die Seitenleiste; echte Taste schon', function () {
  var c = H.load({ fakeTimers: true }), M = c.N, seen = [];
  M.ui.rail.att = true; M.ui.rail.open_ = false;                 // Seitenleiste angebunden und zu
  M.router.key = function (k) {                                  // Ansicht: LEFT an der ersten Karte -> Seitenleiste (wie home.js)
    seen.push(k + ':' + M.input.swipe);
    if (M.input.swipe) M.ui.rail.open();                         // echter Aufruf: kehrt vor jedem DOM-Zugriff zurueck
  };
  M.ui.saver = { key: function () { return false; } }; M.audio = { key: function () { return false; } };
  M.app.press('LEFT', 'touch');
  assert.strictEqual(M.ui.rail.isOpen(), false, 'Wisch-Pfeil: keine Seitenleiste');
  assert.strictEqual(M.input.swipe, false, 'Merker nach der Taste zurueck');
  M.app.press('LEFT');
  M.app.press('RETURN', 'touch');                                // Rand-Wisch (RETURN) ist kein Pfeil
  assert.deepStrictEqual(seen, ['LEFT:true', 'LEFT:false', 'RETURN:false']);
});

test('Bildlader: TV-Groessen am TV, Retina-Stufe und schnelle Werte nur mit caps.images fast', function () {
  N.plex.base = 'http://pms'; N.plex.token = 't';
  assert.ok(/width=176&height=264/.test(N.img.url('/t/1', 'poster')), 'TV unveraendert');
  assert.strictEqual(N.img.SCALE, 1);
  var A = H.load({ platform: 'apple' }).N;
  A.plex.base = 'http://pms'; A.plex.token = 't';
  assert.strictEqual(A.platform.caps.images, 'fast');
  var sc = A.img.SCALE;
  assert.ok(sc >= 1 && sc <= 2);
  assert.ok(new RegExp('width=' + Math.round(176 * sc) + '&height=' + Math.round(264 * sc)).test(A.img.url('/t/1', 'poster')));
  assert.ok(new RegExp('blur=' + Math.round(12 * sc)).test(A.img.bg(null, '/t/1').url), 'Unschaerfe skaliert mit');
});

test('Grid (Mediathek S7): Seitenlage frei, Fenster folgt, Zeiger rollt nie, Taste rastet am Anker ein', function () {
  var c = H.load({ fakeTimers: true, platform: 'apple' }), M = c.N, rows = [];
  function El(tag) { this.tagName = tag; this.style = {}; this.childNodes = []; this.className = ''; }
  El.prototype.appendChild = function (x) { this.childNodes.push(x); x.parentNode = this; return x; };
  El.prototype.setAttribute = function () {};
  c.document = { createElement: function (t) { return new El(t); }, createTextNode: function (t) { return { nodeValue: t }; }, body: new El('body') };
  M.util.raf = function () {};
  var g = new M.ui.Grid(new El('div')), items = [];
  for (var i = 0; i < 200; i++) items.push({ rk: 'm' + i, type: 'movie', title: 'Demo ' + i, thumb: '/t/' + i });
  g.onScroll = function (r) { rows.push(r); };
  g.setModel(items, 200, 0); g.focused = true;
  var G = g.G, ty = function () { return Number(/,(-?[\d.]+)px,0\)/.exec(g.pg.style.webkitTransform)[1]); };
  g.setPy(510);
  assert.strictEqual(ty(), -510, 'ein Transform, Lage frei'); assert.strictEqual(g.r, 1); assert.deepStrictEqual(rows, [1]);
  assert.strictEqual(g.pg.style.webkitTransition, 'none', 'folgt ohne Nachgleiten');
  var j = g.hitAt(144 + 10, 200);                     // y 200 + py 510 - Y0 176 = 534 -> Zeile 1 (Karte bis 340 + 264)
  assert.strictEqual(j, G.COLS);
  g.focusTo(j, true);
  assert.strictEqual(ty(), -510, 'Zeiger-Fokus rollt nicht'); assert.strictEqual(g.free, true);
  assert.strictEqual(g.anchorIdx(), 2 * G.COLS, 'Anker: Zeile 2 (1,5 Zeilen gescrollt -> gerundet)');
  g.fix(g.anchorIdx());
  assert.strictEqual(g.free, false); assert.strictEqual(ty(), G.offset(2)); assert.strictEqual(g.f, 2 * G.COLS);
  assert.strictEqual(g.ringPos().y, G.Y0, 'Ring am Anker');
});

test('Grid: Tastenschritt gleitet mit freiem Scrollen per rAF (Apple), am TV EIN Transform wie bisher; Gegenprobe KEY_TWEEN', function () {
  function mk(platform) {
    var c = H.load({ fakeTimers: true, platform: platform }), M = c.N, q = [];
    function El(tag) { this.tagName = tag; this.style = {}; this.childNodes = []; this.className = ''; }
    El.prototype.appendChild = function (x) { this.childNodes.push(x); x.parentNode = this; return x; };
    El.prototype.setAttribute = function () {};
    c.document = { createElement: function (t) { return new El(t); }, createTextNode: function (t) { return { nodeValue: t }; }, body: new El('body') };
    M.util.raf = function (f) { q.push(f); };
    var g = new M.ui.Grid(new El('div')), items = [];
    for (var i = 0; i < 200; i++) items.push({ rk: 'm' + i, type: 'movie', title: 'Demo ' + i, thumb: '' });
    g.setModel(items, 200, 0); g.focused = true;
    function frames(n) { for (var k = 0; k < n; k++) { c.timers.tick(20); var f = q.splice(0, q.length); f.forEach(function (x) { x(); }); } }
    return { g: g, M: M, frames: frames, ty: function () { return Number(/,(-?[\d.]+)px,0\)/.exec(g.pg.style.webkitTransform)[1]); } };
  }
  var tv = mk(), G = tv.g.G;
  tv.frames(5);                                        // Einrasten nach setModel (60 ms) vorbei
  tv.g.focusTo(G.COLS);
  assert.strictEqual(tv.ty(), G.offset(1), 'TV: sofort am Ziel (CSS-Uebergang macht die Bewegung)');
  assert.notStrictEqual(tv.g.pg.style.webkitTransition, 'none');
  var ap = mk('apple'), g = ap.g;
  g.focusTo(g.G.COLS);
  ap.frames(2);
  var y1 = ap.ty();
  assert.ok(y1 < 0 && y1 > g.G.offset(1), 'Apple: unterwegs nach dem ersten Frame (' + y1 + ')');
  assert.strictEqual(g.pg.style.webkitTransition, 'none', 'kein CSS-Uebergang unter dem Gleiten');
  g.focusTo(2 * g.G.COLS);                             // naechste Taste mitten im Gleiten: weiter von der aktuellen Lage
  ap.frames(2);
  assert.ok(ap.ty() < y1, 'setzt an der aktuellen Lage fort');
  ap.frames(12);
  assert.strictEqual(ap.ty(), g.G.offset(2), 'am Ziel');
  ap.M.ui.Grid.KEY_TWEEN = false;
  g.focusTo(3 * g.G.COLS);
  assert.strictEqual(ap.ty(), g.G.offset(3), 'Gegenprobe: ein Transform wie am TV');
  ap.M.ui.Grid.KEY_TWEEN = true;
});
