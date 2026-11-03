'use strict';
/* Detailkarte (caps.details 'card', src/ui/card.js + N.router; Apple-Entscheidungen Nr. 9/16, SPEC DET-20) ohne Browser:
 * Mini-DOM, kuenstliche Uhr. Am Fernseher (caps.details 'page') entsteht keine Karte und der Stapel verhaelt sich wie immer.
 * Auf Apple: Karte ueber der sichtbaren Ansicht, tiefere Ebenen in derselben Karte (X -> Pfeil), Zurueck/Schliessen,
 * Gesten (nach unten ziehen nur ganz oben, Mitte -> rechts nur ab Ebene 2 und ausserhalb einer Reihe), Zeiger auf X/daneben,
 * Rand-Wisch-Sperre: Fokus-Schritte aus einem Wisch oeffnen die Seitenleiste nie (App.press via 'touch'), App.rail schon. */
var test = require('./helpers/load').appleTest(require('node:test')), assert = require('node:assert');
var H = require('./helpers/load');

function FakeDoc() {
  function El(tag) { this.tagName = tag; this.style = {}; this.childNodes = []; this.className = ''; this.offsetWidth = 100; }
  El.prototype.appendChild = function (c) { if (c.parentNode) c.parentNode.removeChild(c); this.childNodes.push(c); c.parentNode = this; return c; };
  El.prototype.removeChild = function (c) { var i = this.childNodes.indexOf(c); if (i >= 0) this.childNodes.splice(i, 1); c.parentNode = null; return c; };
  El.prototype.setAttribute = function (k, v) { this[k] = v; };
  El.prototype.addEventListener = function () {};
  Object.defineProperty(El.prototype, 'firstChild', { get: function () { return this.childNodes[0] || null; } });
  Object.defineProperty(El.prototype, 'nextSibling', { get: function () { var p = this.parentNode, i = p ? p.childNodes.indexOf(this) : -1; return i >= 0 ? p.childNodes[i + 1] || null : null; } });
  return { createElement: function (t) { return new El(t); }, createTextNode: function (t) { return { nodeValue: t }; }, body: new El('body') };
}

/* touch: Finger-Geraet (iPad) -> volle Breite; platform: 'apple' oder Standard (TV) */
function setup(platform, touch) {
  var g = platform === 'apple' ? { PN_NATIVE: { hello: { caps: { touch: !!touch, tls12: true } } } } : {};
  var c = H.load({ fakeTimers: true, platform: platform, globals: g }), N = c.N, T = c.timers;
  c.document = FakeDoc();
  N.router.refreshHints = function () {};
  var log = [];
  function view(name, card, extra) {
    N.router.define(name, function (p) {
      var s = { card: card, rail: null, pans: [] };
      s.enter = function () { log.push('enter ' + name + (p.n || '')); };
      s.leave = function () { log.push('leave ' + name + (p.n || '')); return {}; };
      s.destroy = function () { log.push('destroy ' + name + (p.n || '')); };
      s.onKey = function () { return false; };
      s.pan = function (e) { s.pans.push(e.phase + ':' + e.axis); return true; };
      s.pointer = function (x, y, kind) { log.push('ptr ' + Math.round(x) + ',' + Math.round(y) + ' ' + kind); return true; };
      if (extra) extra(s);
      return s;
    });
  }
  var layer = c.document.createElement('div'), over = c.document.createElement('div');
  N.router.init(layer, over);
  view('base', false);
  var flags = { top: true, back: true };
  view('det', true, function (s) { s.cardTop = function () { return flags.top; }; s.cardBackOk = function () { return flags.back; }; });
  return { N: N, T: T, log: log, layer: layer, flags: flags };
}
function pan(N, phase, axis, x, y, dx, dy, t) { return N.router.pan({ phase: phase, axis: axis, x: x, y: y, dx: dx, dy: dy, t: t }); }
function drag(a, axis, x, y, dx, dy, ms) {
  var t = a.T.now(), N = a.N;
  var took = pan(N, 'start', axis, x, y, axis === 'x' ? 12 : 0, axis === 'y' ? 12 : 0, t);
  for (var i = 1; i <= 5; i++) pan(N, 'move', axis, x, y, dx * i / 5, dy * i / 5, t + ms * i / 5);
  pan(N, 'end', axis, x, y, dx, dy, t + ms + 100);   // Finger stand 100 ms -> kein Schwung
  return took;
}

test('Geometrie: Touch volle Breite mit Spalt oben, Mac mittiges Feld; schmaler als 1280 -> Inhalt verkleinert', function () {
  var G = setup('apple', true).N.ui.card.geom;
  assert.deepStrictEqual(JSON.parse(JSON.stringify(G(1280, 960, true))), { x: 0, y: 32, w: 1280, h: 928, round: 'top', k: 1, ch: 928, cw: 1280, cut: 0, narrow: false });
  var m = G(1280, 800, false);
  assert.deepStrictEqual([m.x, m.y, m.w, m.h, m.round, m.k, m.ch, m.cw], [48, 40, 1184, 720, 'all', 0.925, 778, 1280]);
  assert.strictEqual(G(1728, 960, false).w, 1280, 'breites Mac-Fenster: Feld hoechstens 1280, k = 1');
  assert.strictEqual(G(1561, 720, true).cw, 1561, 'iPhone quer: Reihen laufen weiter');
  var p = G(834, 1194, true);                                     // spaeteres Hochformat (Nr. 16): keine feste 1280er-Karte
  assert.strictEqual(p.w, 834); assert.ok(Math.abs(p.k - 834 / 1280) < 1e-9); assert.strictEqual(p.ch, Math.round((1194 - 32) / p.k));
  // Groessenklassen (10-screens.md 6.3): M und K ohne Verkleinern, Inhaltskante verschoben (cut), M·N Blatt mit 15 % oben frei,
  // K Vollbild-Blatt (12 px) in schmaler Anordnung – auch mit Maus (schmales Mac-Fenster)
  var mn = G(960, 1232, true, { w: 'M', h: 'N' }), k = G(586, 1132, false, { w: 'K', h: 'N' }), mf = G(1092, 556, true, { w: 'M', h: 'F' });
  assert.deepStrictEqual([mn.k, mn.cut, mn.cw, mn.y, mn.h, mn.narrow], [1, 64, 1024, 185, 1047, false]);
  assert.deepStrictEqual([k.k, k.cut, k.cw, k.y, k.x, k.w, k.narrow], [1, 120, 706, 12, 0, 586, true]);
  assert.deepStrictEqual([mf.y, mf.cw, mf.ch], [32, 1156, 524]);
  assert.strictEqual(G(1280, 912, true, { w: 'R', h: 'N' }).cut, 0, 'R wie bisher');
});

test('Fernseher: keine Karte – scr.card wird ignoriert, Stapel wie immer (Ansicht darunter versteckt)', function () {
  var a = setup(), N = a.N;
  assert.strictEqual(N.platform.caps.details, 'page');
  assert.strictEqual(N.ui.card.on(), false);
  N.router.push('base'); N.router.push('det');
  assert.strictEqual(N.ui.card.el, null, 'kein Karten-DOM');
  assert.strictEqual(N.router.cardDepth(), 0);
  assert.strictEqual(a.layer.childNodes.length, 2);
  assert.strictEqual(a.layer.childNodes[0].style.display, 'none', 'Ansicht darunter wie bisher versteckt');
  assert.strictEqual(N.router.cardFrame(N.router.top()), null);
  assert.strictEqual(N.router.cardPointer(5, 5, 'click'), false);
});

test('Apple: Karte ueber der sichtbaren Ansicht, tiefere Ebene in derselben Karte (X -> Pfeil), Zurueck und Schliessen', function () {
  var a = setup('apple', true), N = a.N, C = N.ui.card;
  assert.strictEqual(N.platform.caps.details, 'card');
  N.router.push('base'); N.router.push('det', { n: 1 });
  var baseEl = a.layer.childNodes[0];
  assert.strictEqual(N.router.cardDepth(), 1);
  assert.ok(C.shown && C.el.style.display === '', 'Karte offen');
  assert.strictEqual(baseEl.style.display, '', 'Ansicht darunter bleibt sichtbar');
  assert.ok(/ is-x/.test(C.btn.className));
  assert.strictEqual(C.body.childNodes.length, 1, 'Ansicht steckt in der Karte');
  assert.deepStrictEqual(a.log.slice(-2), ['leave base', 'enter det1']);

  N.router.push('det', { n: 2 });
  assert.strictEqual(N.router.cardDepth(), 2);
  assert.ok(/ is-back/.test(C.btn.className), 'tiefere Ebene: Zurueck-Pfeil');
  assert.strictEqual(C.body.childNodes[0].style.display, 'none', 'Ebene 1 versteckt');
  assert.strictEqual(baseEl.style.display, '', 'Ansicht unter der Karte weiter sichtbar');

  N.router.back();                                               // Pfeil: eine Ebene zurueck, Ebene 2 gleitet hinaus
  assert.strictEqual(N.router.cardDepth(), 1);
  assert.ok(/ is-x/.test(C.btn.className));
  a.T.tick(400);
  assert.strictEqual(C.body.childNodes.length, 1, 'Ebene 2 nach dem Hinausgleiten entfernt');

  N.router.back();                                               // X: Karte zu
  assert.strictEqual(N.router.topName(), 'base');
  assert.strictEqual(N.router.cardDepth(), 0);
  assert.strictEqual(C.shown, false);
  a.T.tick(400);
  assert.strictEqual(C.el.style.display, 'none');
  assert.strictEqual(C.body.childNodes.length, 0);
  assert.strictEqual(a.log[a.log.length - 1], 'enter base');
});

test('Apple: Ansicht ohne Karte ueber der Karte (Player, Mediathek) versteckt Karte und Ansicht darunter; zurueck zeigt beides', function () {
  var a = setup('apple', true), N = a.N, C = N.ui.card;
  N.router.push('base'); N.router.push('det');
  N.router.push('base', { n: 2 });
  assert.strictEqual(C.shown, false);
  assert.strictEqual(a.layer.childNodes[0].style.display, 'none');
  N.router.back();
  assert.strictEqual(N.router.cardDepth(), 1);
  assert.ok(C.shown);
  assert.strictEqual(a.layer.childNodes[0].style.display, '');
});

test('Gesten: nach unten ziehen schliesst nur ganz oben; Mitte -> rechts erst ab Ebene 2 und nicht in einer Reihe', function () {
  var a = setup('apple', true), N = a.N;
  N.router.push('base'); N.router.push('det', { n: 1 });
  var s1 = N.router.top();
  // kurz nach unten: federt zurueck
  assert.strictEqual(drag(a, 'y', 600, 300, 0, 80, 400), true);
  assert.strictEqual(N.router.cardDepth(), 1);
  assert.deepStrictEqual(s1.pans, [], 'Karten-Geste geht nicht an die Ansicht');
  // Inhalt nicht oben: Zug gehoert der Ansicht (scrollt)
  a.flags.top = false;
  drag(a, 'y', 600, 300, 0, 400, 400);
  assert.deepStrictEqual(s1.pans, ['start:y', 'move:y', 'move:y', 'move:y', 'move:y', 'move:y', 'end:y']);
  assert.strictEqual(N.router.cardDepth(), 1);
  a.flags.top = true;
  // Mitte -> rechts auf Ebene 1: nichts (Zug angenommen, Karte bleibt)
  s1.pans.length = 0;
  assert.strictEqual(drag(a, 'x', 600, 300, 700, 0, 300), true);
  assert.strictEqual(N.router.cardDepth(), 1);
  assert.deepStrictEqual(s1.pans, []);
  // Ebene 2: Mitte -> rechts weit = zurueck; in einer Reihe (cardBackOk false) blaettert die Ansicht
  N.router.push('det', { n: 2 });
  var s2 = N.router.top();
  a.flags.back = false;
  drag(a, 'x', 600, 300, 700, 0, 300);
  assert.strictEqual(N.router.cardDepth(), 2, 'in einer Reihe: kein Zurueck');
  assert.strictEqual(s2.pans[0], 'start:x');
  a.flags.back = true;
  drag(a, 'x', 600, 300, 200, 0, 300);
  assert.strictEqual(N.router.cardDepth(), 2, 'zu kurz: federt zurueck');
  drag(a, 'x', 600, 300, 700, 0, 300);
  assert.strictEqual(N.router.cardDepth(), 1, 'weit genug: eine Ebene zurueck');
  // weit nach unten ziehen schliesst alle Ebenen
  N.router.push('det', { n: 3 });
  drag(a, 'y', 600, 300, 0, 500, 400);
  assert.strictEqual(N.router.cardDepth(), 0);
  assert.strictEqual(N.router.topName(), 'base');
});

test('Zeiger: Koordinaten der Karte, X/Pfeil und Flaeche daneben (Mac: mittiges Feld, verkleinert)', function () {
  var a = setup('apple', false), N = a.N, C = N.ui.card;
  N.router.push('base'); N.router.push('det', { n: 1 }); N.router.push('det', { n: 2 });
  var g = C.g;                                                   // TV-Flaeche 1280x720 in Tests: Feld 1184 breit, k 0.925
  assert.deepStrictEqual([g.x, g.y, g.w, g.round], [48, 40, 1184, 'all']);
  assert.strictEqual(C.hit(g.x + 40, g.y + 40), 'btn');
  assert.strictEqual(C.hit(g.x + 400, g.y + 300), 'in');
  assert.strictEqual(C.hit(10, 300), 'out');
  assert.strictEqual(N.router.cardPointer(g.x + 400, g.y + 300, 'click'), false, 'Inhalt: Ansicht bedient');
  assert.strictEqual(N.router.cardPointer(g.x + 40, g.y + 40, 'move'), true);
  assert.strictEqual(N.router.cardDepth(), 2, 'Darueberfahren tut nichts');
  N.router.cardPointer(g.x + 40, g.y + 40, 'click');
  assert.strictEqual(N.router.cardDepth(), 1, 'Pfeil: eine Ebene zurueck');
  N.router.cardPointer(600, 5, 'click');
  assert.strictEqual(N.router.cardDepth(), 0, 'Klick daneben schliesst');
  // Pan-Koordinaten: in Inhalts-px umgerechnet
  N.router.push('det', { n: 4 });
  var s = N.router.top(), seen = null;
  s.pan = function (e) { seen = e; return true; };
  a.flags.top = false;
  pan(N, 'start', 'y', g.x + 185, g.y + 92.5, 0, -18.5, a.T.now());
  assert.deepStrictEqual([Math.round(seen.x), Math.round(seen.y), Math.round(seen.dy)], [200, 100, -20]);
});

test('Seitenleiste: Fokus-Schritte aus einem Wisch oeffnen sie nicht, nur der Rand-Wisch (App.rail)', function () {
  var a = setup('apple', true), N = a.N, R = N.ui.rail;
  var el = function () { return { style: {}, className: '' }; };
  R.att = 'home'; R.cur = 'home'; R.f = 0; R.entries = [{ id: 'home', ni: el() }]; R.panel = el(); R.dim = el(); R.el = el();
  N.diag.error = function (w, e) { throw e; };
  N.router.define('edge', function () { return { rail: 'home', onKey: function (k) { if (k === 'LEFT') R.open(); return true; } }; });
  N.router.push('edge');
  N.app.press('LEFT', 'touch');
  assert.strictEqual(R.isOpen(), false, 'Wisch-Schritt LEFT am Inhaltsrand');
  assert.strictEqual(N.input.swipe, false);
  a.T.tick(500);
  N.app.press('LEFT');
  assert.strictEqual(R.isOpen(), true, 'echte Taste wie am TV');
  R.close(true);
  assert.strictEqual(N.app.rail(), true, 'Rand-Wisch');
  assert.strictEqual(R.isOpen(), true);
});
