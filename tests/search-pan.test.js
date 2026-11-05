'use strict';
/* Suche und Entdecken auf Apple (caps.scroll 'free', Nutzerbefund iPad/Mac 05.11.): waagerechte Reihen frei wie die Startseite.
 * Vorher nahm die Ansicht nur senkrechte Zuege (N.ui.freeList), waagerecht fiel der Lader auf Fokus-Schritte nach dem Abheben
 * zurueck, und das Trackpad (wheel mit deltaX) wurde zu gedrosselten Pfeiltasten. Mini-DOM, echte Reihen (N.ui.Row), Apple-Kern
 * (N.kinetic), kuenstliche Uhr und rAF.
 * - Reihe folgt dem Zug live 1:1, laeuft mit Schwung aus, kein Einrasten; Gummiband am Anfang; nie Fokuswechsel, nie Seitenleiste.
 * - Trackpad waagerecht verschiebt die Reihe unter dem Zeiger direkt; ueber der Tastatur nichts (kein Fokus-Schritt).
 * - Beruehrung stoppt den Schwung, der Klick danach oeffnet nichts; Tipp trifft auch eine angeschnittene Karte.
 * - Erste Taste nach dem Wischen: Fokus auf die erste ganz sichtbare Karte, Reihe im Tastenraster.
 * - Entdecken (Inspirations-Reihen): nur die Reihe unter dem Finger bewegt sich. */
var test = require('./helpers/load').appleTest(require('node:test')), assert = require('node:assert');
var fs = require('fs'), path = require('path'), vm = require('vm');
var H = require('./helpers/load');

function FakeDoc() {
  function El(tag) { this.tagName = tag; this.style = {}; this.childNodes = []; this.className = ''; }
  El.prototype.appendChild = function (c) { this.childNodes.push(c); c.parentNode = this; return c; };
  El.prototype.insertBefore = function (c) { return this.appendChild(c); };
  El.prototype.removeChild = function (c) { var i = this.childNodes.indexOf(c); if (i >= 0) this.childNodes.splice(i, 1); c.parentNode = null; return c; };
  El.prototype.setAttribute = function (k, v) { this[k] = v; };
  El.prototype.addEventListener = function () {};
  return { createElement: function (t) { return new El(t); }, createTextNode: function (t) { return { nodeValue: t }; }, body: new El('body') };
}
function card(rk) { return { rk: rk, type: 'movie', title: 'Demo ' + rk, thumb: '/t/' + rk, vc: 0, off: 0, dur: 0 }; }
function items(id, n) { var it = []; for (var i = 0; i < n; i++) it.push(card(id + i)); return it; }

function open(kind) {
  var c = H.load({ fakeTimers: true, platform: 'apple' }), N = c.N, T = c.timers, frames = [], details = [], rails = [];
  c.document = FakeDoc();
  N.util.raf = function (f) { frames.push(f); return frames.length; };
  N.i18n.set('de');
  N.screen.init();                                         // flexible Flaeche 1280 x 720 (R·N) wie das iPad quer
  N.ui.Ring = function () { this.at = null; };
  N.ui.Ring.prototype = { prep: function () {}, to: function (sh, x, y) { this.at = [x, y]; }, hide: function () { this.at = null; } };
  N.ui.rail = { setData: function () {}, isOpen: function () { return false; }, open: function () { rails.push(1); }, libs: [] };
  N.router.refreshHints = function () {};
  N.details = { open: function (it) { details.push(it.rk); }, play: function () {} };
  N.srch.recent = function () { return []; };
  var libs = [{ id: 1, type: 'movie', title: 'Filme', kind: 'movie', loc: [] }];
  var cache = { v: 1, libs: libs, alibs: libs, rows: [{ id: 'a', kind: 'poster', items: items('s', 12) }] };
  N.session = { profile: { uuid: 'p1' }, state: { server: { name: 'Demo' } }, settings: {}, homeCache: function () { return cache; },
    hubCatalog: function () { return null; }, isKid: function () { return false; } };
  var insp = { a: { id: 'a', tk: 'home.row.newIn', tp: { library: 'Filme' }, kind: 'posterQ', items: items('a', 14) },
    b: { id: 'b', tk: 'home.row.newIn', tp: { library: 'Filme' }, kind: 'posterQ', items: items('b', 14) } };
  N.disc = { DELAY: 400, helper: function () { return false; }, watchlistOn: function () { return false; }, search: function () { return { abort: function () {} }; } };
  N.insp = { enabled: function () { return ['a', 'b']; }, helperOn: function () { return false; },
    cached: function () { return { a: { row: insp.a, fresh: true }, b: { row: insp.b, fresh: true } }; }, load: function () { return null; } };
  var defs = {}, real = N.router.define;
  N.router.define = function (n, f) { defs[n] = f; };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'search.js'), 'utf8'), c, { filename: 'views/search.js' });
  N.router.define = real;
  var s = defs[kind || 'search']({}), root = c.document.createElement('div');
  s.create(root); s.enter({}, null);
  function all(el, k, out) { out = out || []; if ((' ' + el.className + ' ').indexOf(' ' + k + ' ') >= 0) out.push(el); (el.childNodes || []).forEach(function (x) { if (x.childNodes) all(x, k, out); }); return out; }
  function tx(el) { var m = /translate3d\((-?[\d.]+)px,(-?[\d.]+)px/.exec(el.style.webkitTransform || ''); return m ? [Number(m[1]), Number(m[2])] : [0, 0]; }
  function rowEl(top) { return all(root, 'hrow').filter(function (h) { return h.style.top === top + 'px' && h.childNodes[1].style.opacity !== '0'; })[0]; }
  function strip(top) { return tx(all(rowEl(top), 'strip')[0])[0]; }
  function keyFocus() { return all(root, 'key').filter(function (k) { return / is-focus/.test(k.className); }).length; }
  function flush(ms) { for (var i = 0; i < ms / 16 && frames.length; i++) { T.tick(16); var f = frames.shift(); f(); } }
  function swipe(axis, x, y0, d, ms, rest, log) {
    var t = T.now(), n = 10, out = [];
    assert.strictEqual(s.pan({ phase: 'start', axis: axis, x: x, y: y0, dx: 0, dy: 0, t: t }), true, 'Zug angenommen');
    for (var i = 1; i <= n; i++) {
      T.tick(ms / n);
      s.pan({ phase: 'move', axis: axis, x: x, y: y0, dx: axis === 'x' ? d * i / n : 0, dy: axis === 'y' ? d * i / n : 0, t: T.now() });
      if (log) out.push(log());
    }
    T.tick(rest || 0);
    s.pan({ phase: 'end', axis: axis, x: x, y: y0, dx: axis === 'x' ? d : 0, dy: axis === 'y' ? d : 0, t: T.now() });
    return out;
  }
  return { N: N, T: T, s: s, root: root, page: function () { return tx(all(root, 'sres')[0])[1]; }, all: all, strip: strip, keyFocus: keyFocus, flush: flush, swipe: swipe, details: details, rails: rails };
}
var TOP = 48, CY = TOP + 52, STEP = 136;                   // erste Reihe (Vorschlaege) ohne "Zuletzt gesucht"; Poster klein: Schritt 136

test('Suche: Vorschlags-Reihe folgt dem Zug live 1:1, laeuft frei aus, Gummiband am Anfang; kein Fokuswechsel, keine Seitenleiste', function () {
  var a = open('search');
  assert.strictEqual(a.keyFocus(), 1, 'Fokus auf der Bildschirm-Tastatur');
  var live = a.swipe('x', 800, CY + 60, -230, 230, 120, function () { return a.strip(TOP); });   // langsam, Finger steht: kein Schwung
  for (var i = 1; i < live.length; i++) assert.ok(live[i] < live[i - 1], 'jede Bewegung verschiebt sofort: ' + live);
  assert.ok(Math.abs(live[live.length - 1] + 230) < 1, 'folgt 1:1: ' + live[live.length - 1]);
  a.flush(2000);
  assert.strictEqual(a.strip(TOP), -230, 'bleibt zwischen zwei Karten stehen (kein Einrasten)');
  a.swipe('x', 800, CY + 60, -120, 60, 0);                                        // schnell: Schwung
  var t0 = a.strip(TOP); a.flush(100); var t1 = a.strip(TOP); a.flush(3000); var t2 = a.strip(TOP);
  assert.ok(t1 < t0 && t2 < t1, 'laeuft nach dem Loslassen weiter: ' + [t0, t1, t2]);
  a.swipe('x', 800, CY + 60, 3000, 300, 120); a.flush(3000);
  assert.strictEqual(a.strip(TOP), 0, 'zurueck am Anfang');
  var over = a.swipe('x', 800, CY + 60, 300, 300, 0, function () { return a.strip(TOP); });
  assert.ok(over[over.length - 1] > 0 && over[over.length - 1] < 300, 'Gummiband: weniger als der Fingerweg ' + over[over.length - 1]);
  a.flush(2000);
  assert.strictEqual(a.strip(TOP), 0, 'federt zurueck');
  assert.strictEqual(a.keyFocus(), 1, 'Wischen aendert den Fokus nicht');
  assert.deepStrictEqual(a.rails, [], 'nie die Seitenleiste');
  // waagerecht ueber der Tastatur: angenommen (kein Rueckfall auf Fokus-Schritte), nichts bewegt sich
  a.swipe('x', 300, 300, -200, 200, 120);
  assert.strictEqual(a.strip(TOP), 0);
  assert.strictEqual(a.keyFocus(), 1);
});

test('Trackpad: Zweifinger-Wischen waagerecht (deltaX) verschiebt die Reihe unter dem Zeiger direkt; ueber der Tastatur nichts', function () {
  var a = open('search');
  for (var i = 0; i < 5; i++) { a.T.tick(16); assert.strictEqual(a.s.wheel(800, CY + 60, 30, 2), true); }
  assert.strictEqual(a.strip(TOP), -150, 'Weg direkt in px, ohne eigenen Schwung');
  a.flush(1000);
  assert.strictEqual(a.strip(TOP), -150);
  a.T.tick(400);
  assert.strictEqual(a.s.wheel(300, 300, 40, 0), true, 'ueber der Tastatur verschluckt (keine gedrosselte Pfeiltaste)');
  assert.strictEqual(a.strip(TOP), -150);
  assert.strictEqual(a.keyFocus(), 1);
});

test('Beruehrung stoppt den Schwung, der Klick danach oeffnet nichts; Tipp trifft bei freier Lage die Karte unter dem Finger', function () {
  var a = open('search');
  a.swipe('x', 800, CY + 60, -300, 60, 0);
  a.flush(48);
  var p0 = a.strip(TOP);
  a.s.pointerDown(800, CY + 60);
  a.flush(500);
  assert.strictEqual(a.strip(TOP), p0, 'steht nach der Beruehrung');
  a.s.pointer(800, CY + 60, 'move'); a.s.pointer(800, CY + 60, 'click');
  assert.deepStrictEqual(a.details, [], 'Tipp zum Anhalten oeffnet nichts');
  var px = -p0, j = Math.floor((px + 40) / STEP) + 1, x = 416 + 144 + j * STEP + 10 - px;   // Karte j bei Lage px (rechts der Tastatur)
  a.s.pointer(x, CY + 60, 'move'); a.s.pointer(x, CY + 60, 'click');
  assert.deepStrictEqual(a.details, ['s' + j], 'Details der getippten Karte');
});

test('Erste Taste nach dem Wischen: Fokus auf die erste ganz sichtbare Karte, Reihe im Tastenraster; danach Schritte wie am TV', function () {
  var a = open('search');
  var x0 = 416 + 144 + 30;
  a.s.pointer(x0, CY + 60, 'move');                                               // Zeiger auf Karte 0: Fokus in die Reihe
  a.swipe('x', 800, CY + 60, -2 * STEP - 40, 300, 120); a.flush(2000);           // 2,3 Karten weit
  assert.strictEqual(a.strip(TOP), -2 * STEP - 40);
  assert.strictEqual(a.s.onKey('RIGHT'), true);                                   // nur Anker, kein Schritt
  assert.strictEqual(a.strip(TOP), -3 * STEP, 'Fokus auf Karte 3 (erste ganz sichtbare), Reihe im Raster');
  var foc = a.all(a.root, 'is-focus').filter(function (e) { return / card /.test(' ' + e.className + ' '); });
  assert.strictEqual(foc.length, 1);
  assert.strictEqual(foc[0].childNodes[0].childNodes[0].nodeValue, 'Demo s3');
  a.s.onKey('RIGHT');
  var foc2 = a.all(a.root, 'is-focus').filter(function (e) { return / card /.test(' ' + e.className + ' '); });
  assert.strictEqual(foc2[0].childNodes[0].childNodes[0].nodeValue, 'Demo s4', 'danach Fokus-Schritte');
});

test('Entdecken: jede Inspirations-Reihe folgt einzeln dem Finger; senkrecht rollt weiter die Seite', function () {
  var a = open('discover');
  var TOP2 = TOP + 316, y1 = CY + 60, y2 = TOP2 + 52 + 60;
  a.swipe('x', 800, y2, -250, 250, 120); a.flush(2000);
  assert.strictEqual(a.strip(TOP2), -250, 'zweite Reihe bewegt');
  assert.strictEqual(a.strip(TOP), 0, 'erste Reihe bleibt');
  a.swipe('x', 800, y1, -120, 250, 120); a.flush(2000);
  assert.strictEqual(a.strip(TOP), -120, 'erste Reihe bewegt');
  assert.strictEqual(a.strip(TOP2), -250);
  a.T.tick(400);
  assert.strictEqual(a.s.wheel(800, y2, 50, 0), true);
  assert.strictEqual(a.strip(TOP2), -300, 'Trackpad waagerecht ueber Reihe 2');
  assert.strictEqual(a.keyFocus(), 1, 'Fokus bleibt auf der Tastatur');
  a.swipe('y', 800, 400, -100, 300, 120); a.flush(2000);
  assert.strictEqual(a.page(), -100, 'Seite folgt senkrecht (N.ui.freeList)');
  assert.strictEqual(a.strip(TOP2), -300, 'Reihen bleiben, wo sie waren');
});
