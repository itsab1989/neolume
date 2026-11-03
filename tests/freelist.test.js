'use strict';
/* N.ui.freeList (SPEC NAV-20) und Zurueck-Pfeil in Panels mit Unterebenen (NAV-21), ohne Browser: Mini-DOM, Apple-Kern (N.kinetic),
 * kuenstliche Uhr und rAF. Auswahl-Panel, "Sortieren & Filter", "Startseite anpassen": Wischen verschiebt die Liste ohne
 * Fokuswechsel und laeuft frei aus (kein Einrasten), Tipp trifft die Zeile unter dem Finger, erste Taste rastet ein; der Router
 * verschluckt Zuege, die ein Overlay nicht nimmt (kein Rueckfall auf Fokus-Schritte). Am TV: nichts davon (kein Pfeil, kein Zug). */
var test = require('./helpers/load').appleTest(require('node:test')), assert = require('node:assert');
var fs = require('fs'), path = require('path'), vm = require('vm');
var H = require('./helpers/load');

function FakeDoc() {
  function El(tag) { this.tagName = tag; this.style = {}; this.childNodes = []; this.className = ''; this.offsetLeft = 0; this.offsetTop = 0; this.offsetWidth = 100; this.offsetHeight = 40; }
  El.prototype.appendChild = function (c) { this.childNodes.push(c); c.parentNode = this; return c; };
  El.prototype.insertBefore = function (c) { return this.appendChild(c); };
  El.prototype.removeChild = function (c) { var i = this.childNodes.indexOf(c); if (i >= 0) this.childNodes.splice(i, 1); c.parentNode = null; return c; };
  El.prototype.setAttribute = function (k, v) { this[k] = v; };
  El.prototype.addEventListener = function () {};
  Object.defineProperty(El.prototype, 'firstChild', { get: function () { return this.childNodes[0] || null; } });
  return { createElement: function (t) { return new El(t); }, createTextNode: function (t) { return { nodeValue: t }; }, body: new El('body') };
}
function has(el, c) { return (' ' + el.className + ' ').indexOf(' ' + c + ' ') >= 0; }
function find(el, c) { if (has(el, c)) return el; for (var i = 0; i < (el.childNodes || []).length; i++) { var r = el.childNodes[i].childNodes ? find(el.childNodes[i], c) : null; if (r) return r; } return null; }
function ty(el) { var m = /translate3d\((-?[\d.]+)px,(-?[\d.]+)px/.exec(el.style.webkitTransform || ''); return m ? Number(m[2]) : 0; }

function setup(platform) {
  var c = H.load({ fakeTimers: true, platform: platform }), N = c.N, T = c.timers, frames = [], ov = [];
  c.document = FakeDoc();
  N.util.raf = function (f) { frames.push(f); return frames.length; };
  N.i18n.set('de');
  N.input.init();
  if (N.input.on) N.input.set('touch');
  N.router.openOverlay = function (o) { ov.push(o); };
  N.router.closeOverlay = function (o) { var i = ov.indexOf(o); if (i >= 0) ov.splice(i, 1); };
  function flush(ms) { for (var i = 0; i < ms / 16 && frames.length; i++) { T.tick(16); var f = frames.shift(); f(); } }
  /* senkrechter Zug am Ziel tg (ov oder Ansicht), Finger von y0 nach y1 in ms, danach rest ms still */
  function swipe(tg, x, y0, y1, ms, rest) {
    var t = T.now(), n = 10, took = tg.pan({ phase: 'start', axis: 'y', x: x, y: y0, dx: 0, dy: 0, t: t });
    for (var i = 1; i <= n; i++) { T.tick(ms / n); tg.pan({ phase: 'move', axis: 'y', x: x, y: y0, dx: 0, dy: (y1 - y0) * i / n, t: T.now() }); }
    T.tick(rest || 0);
    tg.pan({ phase: 'end', axis: 'y', x: x, y: y0, dx: 0, dy: y1 - y0, t: T.now() });
    return took;
  }
  return { c: c, N: N, T: T, ov: ov, flush: flush, swipe: swipe };
}
function entries(n) { var e = []; for (var i = 0; i < n; i++) e.push({ id: 'e' + i, t: 'Eintrag ' + i }); return e; }

test('Auswahl-Panel: Wischen verschiebt die Liste frei (Fokus bleibt), Tipp waehlt die Zeile darunter, Taste rastet ein', function () {
  var s = setup('apple'), picked = [];
  var p = s.N.ui.panel.select({ title: 'Qualität', entries: entries(20), selected: 'e0', onSelect: function (id) { picked.push(id); } });
  var list = find(p.el, 'tp-list');
  assert.strictEqual(ty(list), 0);
  assert.strictEqual(s.swipe(p, 1000, 500, 300, 300, 120), true, 'Zug angenommen');
  s.flush(2000);
  assert.strictEqual(ty(list), -200, 'bleibt zwischen zwei Zeilen stehen (72 px je Zeile)');
  assert.strictEqual(p.f, 0, 'Fokus unveraendert');
  assert.strictEqual(list.style.webkitTransition, 'none');
  p.pointer(1000, 130, 'click');                            // (130 - 112 + 200) / 72 = 3,03 -> Eintrag 3 (angeschnitten oben: 2)
  assert.deepStrictEqual(picked, ['e3']);
  p = s.N.ui.panel.select({ title: 'T', entries: entries(20), selected: 'e0', onSelect: function () {} });
  list = find(p.el, 'tp-list');
  s.swipe(p, 1000, 500, 340, 300, 120); s.flush(2000);
  p.onKey('DOWN');                                          // Taste: Fokus 1, Liste rastet auf ganze Zeilen (TV-Weg)
  assert.ok(ty(list) % 72 === 0, 'eingerastet: ' + ty(list));
  assert.strictEqual(list.style.webkitTransition, '');
});

test('Auswahl-Panel: Wurf laeuft aus, Gummiband federt am Anfang zurueck, Tipp in den Schwung waehlt nichts', function () {
  var s = setup('apple'), picked = [];
  var p = s.N.ui.panel.select({ title: 'T', entries: entries(30), onSelect: function (id) { picked.push(id); } });
  var list = find(p.el, 'tp-list');
  s.swipe(p, 1000, 500, 300, 60, 0);                        // schneller Wurf nach oben
  s.flush(64);
  var mid = ty(list);
  assert.ok(mid < -200, 'Schwung laeuft weiter: ' + mid);
  p.pointerDown(); p.pointer(1000, 300, 'click');           // Beruehrung haelt an, der Klick waehlt nichts
  assert.deepStrictEqual(picked, []);
  var stop = ty(list); s.flush(500);
  assert.strictEqual(ty(list), stop, 'steht');
  s.swipe(p, 1000, 300, 700, 300, 0); s.flush(3000);        // weit ueber den Anfang: zurueck auf 0
  assert.strictEqual(ty(list), 0);
});

test('Router: Overlay ohne (passenden) Zug verschluckt ihn – kein Fokus-Schritt; Panel mit kurzer Liste nimmt ihn nicht', function () {
  var c = H.load({ platform: 'apple' }), N = c.N, keys = [];
  c.document = FakeDoc();
  N.router.refreshHints = function () {};
  N.router.openOverlay({ el: c.document.createElement('div'), onKey: function (k) { keys.push(k); return true; } });   // z. B. Dialog
  assert.strictEqual(N.router.pan({ phase: 'start', axis: 'y', x: 600, y: 300, dx: 0, dy: 0, t: 1 }), true, 'angenommen');
  assert.strictEqual(N.router.pan({ phase: 'move', axis: 'y', x: 600, y: 300, dx: 0, dy: -80, t: 20 }), true);
  assert.strictEqual(N.router.pan({ phase: 'end', axis: 'y', x: 600, y: 300, dx: 0, dy: -80, t: 40 }), true);
  assert.deepStrictEqual(keys, [], 'keine Taste');
  var s = setup('apple');
  var p = s.N.ui.panel.select({ title: 'T', entries: entries(3), onSelect: function () {} });
  assert.strictEqual(p.pan({ phase: 'start', axis: 'y', x: 1000, y: 300, dx: 0, dy: 0, t: 1 }), false, 'kurze Liste: Panel nimmt nicht (Router verschluckt)');
});

test('Zurueck-Pfeil: nur bei Unterebenen (onCancel = Hinweis "Zurück"), Tipp = RETURN; mit Tasten kein Treffer; am TV kein Element', function () {
  var s = setup('apple'), back = 0;
  var p = s.N.ui.panel.select({ title: 'Untertitel-Verzögerung', entries: entries(4), onCancel: function () { back++; }, onSelect: function () {} });
  var b = find(p.el, 'pbk');
  assert.ok(b, 'Pfeil da');
  assert.ok(has(find(p.el, 'panel'), 'has-bk'));
  H.eq(p.hints().map(function (h) { return h.t; }), ['hint.back']);
  s.N.input.set('key');
  p.pointer(840 + 48, 64, 'click');
  assert.strictEqual(back, 0, 'mit Tasten unsichtbar: kein Treffer');
  s.N.input.set('touch');
  p.pointer(840 + 48, 64, 'click');
  assert.strictEqual(back, 1, 'Tipp = eine Ebene zurueck');
  assert.strictEqual(s.ov.length, 0);
  p = s.N.ui.panel.select({ title: 'Oberste Ebene', entries: entries(4), onSelect: function () {} });
  assert.strictEqual(find(p.el, 'pbk'), null, 'ohne onCancel: kein Pfeil');
  p = s.N.ui.panel.select({ title: 'Mehrfach', multi: true, entries: entries(4), onCancel: function () {}, onDone: function () {} });
  assert.strictEqual(find(p.el, 'pbk'), null, 'Mehrfachauswahl: kein Pfeil');
  var tv = setup();
  p = tv.N.ui.panel.select({ title: 'T', entries: entries(20), onCancel: function () {}, onSelect: function () {} });
  assert.strictEqual(find(p.el, 'pbk'), null, 'TV: kein Element');
  assert.strictEqual(p.pan({ phase: 'start', axis: 'y', x: 1000, y: 400, dx: 0, dy: 0, t: 1 }), false, 'TV: kein freies Scrollen');
});

test('Sortieren & Filter (Reiter): frei scrollbar, Reiterwechsel beginnt oben', function () {
  var s = setup('apple'), got = [];
  var p = s.N.ui.tabPanel.open({ title: 'Sortieren & Filter', tabs: [{ t: 'Filter', entries: function () { return entries(20); } }, { t: 'Ansicht', entries: function () { return entries(3); } }],
    onPick: function (t, id) { got.push(id); } });
  var list = find(p.el, 'tp-list');
  s.swipe(p, 1000, 600, 400, 300, 120); s.flush(2000);
  assert.strictEqual(ty(list), -200);
  p.pointer(1000, 200, 'click');                            // top 188 (Mehr-Hinweis), (200 - 188 + 200) / 72 = 2,9 -> 2
  assert.deepStrictEqual(got, ['e2']);
  p.onKey('RIGHT');
  assert.strictEqual(ty(list), 0, 'anderer Reiter: oben');
});

test('"Startseite anpassen": Liste frei, Tipp trifft die Zeile, beim Verschieben bleibt Wischen ein Platz je Schritt', function () {
  var s = setup('apple'), N = s.N, c = s.c;
  N.session.settings = {}; N.session.homeCache = function () { return { libs: [] }; }; N.session.hubCatalog = function () { return { lang: 'de', ts: c.timers.now(), hubs: [] }; };
  N.router.refreshHints = function () {};
  var defs = {}, real = N.router.define;
  N.router.define = function (n, f) { defs[n] = f; };
  N.rowsEditor = null;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'homerows.js'), 'utf8'), c, { filename: 'views/homerows.js' });
  N.router.define = real;
  var ed = N.rowsEditor({ setting: 'x', noCatalog: true, keys: { title: 'set.homeRows', how: 'set.hr.how', help: 'set.hr.help', resetDesc: 'set.hr.reset.desc', resetText: 'dlg.hrReset.text' },
    model: { view: function () { var v = []; for (var i = 0; i < 14; i++) v.push({ id: 'r' + i, on: true }); return v; }, store: function (a, b, v) { return v; }, move: function () {} },
    avail: function () { return []; }, label: function (it) { return it.id; }, val: function () { return ''; }, desc: function () { return ''; } })();
  var root = c.document.createElement('div');
  ed.create(root); ed.enter({}, null);
  var list = find(root, 'hr-list');
  assert.strictEqual(s.swipe(ed, 400, 400, 250, 300, 120), true);
  s.flush(2000);
  assert.strictEqual(ty(list), -150);
  ed.pointer(400, 120, 'click');                            // (120 - 112 + 150) / 64 = 2,47 -> Zeile 2 umgeschaltet
  var rows = [], all = function (el) { if (has(el, 'hr-row')) rows.push(el); (el.childNodes || []).forEach(function (x) { if (x.childNodes) all(x); }); };
  all(root);
  assert.ok(has(rows[2], 'off'), 'Zeile 2 ausgeschaltet');
  ed.onKey('YELLOW');                                       // Verschieben
  assert.strictEqual(ed.pan({ phase: 'start', axis: 'y', x: 400, y: 300, dx: 0, dy: 0, t: c.timers.now() }), false, 'beim Verschieben: Rueckfall auf Schritte');
});

test('TV: RETURN in einer Unterebene (Panel mit onCancel) geht genau eine Ebene zurueck, oben schliesst es', function () {
  var c = H.load(), N = c.N, names = [];                    // Standard-Plattform (TV)
  c.document = FakeDoc();
  N.i18n.set('de');
  N.router.refreshHints = function () {};
  function top() { return N.router.hasOverlay() ? N.router.topOverlay() : null; }
  function root() { var p = N.ui.panel.select({ title: 'Mehr', entries: entries(3), onSelect: function () { sub(); } }); p.name = 'root'; return p; }
  function sub() { var p = N.ui.panel.select({ title: 'Qualität', entries: entries(12), onCancel: root, onSelect: function () {} }); p.name = 'sub'; return p; }
  root();
  N.router.key('ENTER');                                    // Unterebene oeffnen
  names.push(top() && top().name);
  N.router.key('RETURN');
  names.push(top() && top().name);
  N.router.key('RETURN');
  names.push(top() && top().name);
  assert.deepStrictEqual(names, ['sub', 'root', null]);
  assert.strictEqual(find(c.document.body, 'pbk'), null);
});

test('An den Anfang (App.scrollTop, Tipp ganz oben / Cmd+Pfeil hoch): Panel-Liste gleitet nach 0; oben bzw. am TV: false', function () {
  var s = setup('apple');
  var p = s.N.ui.panel.select({ title: 'T', entries: entries(30), onSelect: function () {} });
  var list = find(p.el, 'tp-list');
  assert.strictEqual(p.scrollTop(), false, 'schon oben');
  s.swipe(p, 1000, 600, 200, 300, 120); s.flush(2000);
  assert.ok(ty(list) < -300);
  assert.strictEqual(p.scrollTop(), true);
  s.flush(48);
  assert.ok(ty(list) < 0 && ty(list) > -400, 'gleitet');
  s.flush(1000);
  assert.strictEqual(ty(list), 0, 'oben');
  var tv = setup();
  var q = tv.N.ui.panel.select({ title: 'T', entries: entries(30), onSelect: function () {} });
  assert.strictEqual(q.scrollTop(), false, 'TV: nichts');
});
