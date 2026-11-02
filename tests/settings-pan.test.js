'use strict';
/* Einstellungen mit freiem Scrollen (caps.scroll 'free', App.pan -> s.pan; Entscheidungen Apple Nr. 13/18) ohne Browser:
 * Mini-DOM, Apple-Kern (N.kinetic), kuenstliche Uhr und rAF. Wischen ueber eine lange Liste verschiebt sie ohne Fokuswechsel
 * und laeuft frei aus (kein Einrasten auf Zeilen), Gummiband federt an den Enden zurueck; Kategorien nehmen den Zug an und tun
 * nichts (kein Rueckfall auf Fokus-Schritte); Tippen trifft die Zeile unter dem Finger auch zwischen zwei Rasterlagen; die
 * erste Taste rastet wieder ein (TV-Weg). */
var test = require('./helpers/load').appleTest(require('node:test')), assert = require('node:assert');
var fs = require('fs'), path = require('path'), vm = require('vm');
var H = require('./helpers/load');

function FakeDoc() {
  function El(tag) { this.tagName = tag; this.style = {}; this.childNodes = []; this.className = ''; this.offsetLeft = 0; this.offsetWidth = 100; this.offsetHeight = 40; this.scrollWidth = 100; this.clientWidth = 100; this.scrollHeight = 40; this.clientHeight = 40; }
  El.prototype.appendChild = function (c) { this.childNodes.push(c); c.parentNode = this; return c; };
  El.prototype.insertBefore = function (c) { return this.appendChild(c); };
  El.prototype.removeChild = function (c) { var i = this.childNodes.indexOf(c); if (i >= 0) this.childNodes.splice(i, 1); c.parentNode = null; return c; };
  El.prototype.setAttribute = function (k, v) { this[k] = v; };
  El.prototype.addEventListener = function () {};
  Object.defineProperty(El.prototype, 'firstChild', { get: function () { return this.childNodes[0] || null; } });
  return { createElement: function (t) { return new El(t); }, createTextNode: function (t) { return { nodeValue: t }; }, body: new El('body') };
}

function open() {
  var c = H.load({ fakeTimers: true, platform: 'apple' }), N = c.N, T = c.timers, frames = [];
  c.document = FakeDoc();
  N.util.raf = function (f) { frames.push(f); return frames.length; };
  N.i18n.set('de');
  N.session.settings = {};
  N.session.state = { profiles: {}, users: [] };
  N.session.isKid = function () { return true; };             // weniger Kategorien, Wiedergabe bleibt lang
  N.session.homeCache = function () { return null; };
  N.session.hubCatalog = function () { return null; };
  N.router.refreshHints = function () {};
  var defs = {}, real = N.router.define;
  N.router.define = function (n, f) { defs[n] = f; };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'settings.js'), 'utf8'), c, { filename: 'views/settings.js' });
  N.router.define = real;
  var s = defs.settings({}), root = c.document.createElement('div');
  s.create(root); s.enter({}, null);
  function list() { var m = /translate3d\((-?[\d.]+)px,(-?[\d.]+)px/.exec(findCls(root, 'set-list').style.webkitTransform || ''); return m ? Number(m[2]) : 0; }
  function findCls(el, k) { if ((' ' + el.className + ' ').indexOf(' ' + k + ' ') >= 0) return el; for (var i = 0; i < (el.childNodes || []).length; i++) { var r = el.childNodes[i].childNodes ? findCls(el.childNodes[i], k) : null; if (r) return r; } return null; }
  function all(el, k, out) { out = out || []; if ((' ' + el.className + ' ').indexOf(' ' + k + ' ') >= 0) out.push(el); (el.childNodes || []).forEach(function (x) { if (x.childNodes) all(x, k, out); }); return out; }
  function flush(ms) { for (var i = 0; i < ms / 16 && frames.length; i++) { T.tick(16); var f = frames.shift(); f(); } }
  function swipe(x, y0, y1, ms, rest) {
    var t = T.now(), n = 10;
    assert.strictEqual(s.pan({ phase: 'start', axis: 'y', x: x, y: y0, dx: 0, dy: 0, t: t }), true);
    for (var i = 1; i <= n; i++) { T.tick(ms / n); s.pan({ phase: 'move', axis: 'y', x: x, y: y0, dx: 0, dy: (y1 - y0) * i / n, t: T.now() }); }
    T.tick(rest || 0);
    s.pan({ phase: 'end', axis: 'y', x: x, y: y0, dx: 0, dy: y1 - y0, t: T.now() });
  }
  return { N: N, s: s, root: root, list: list, flush: flush, swipe: swipe, focusRows: function () { return all(root, 'set-row').filter(function (e) { return / is-focus/.test(' ' + e.className); }); },
    catFocus: function () { return all(root, 'set-cat').filter(function (e) { return / is-focus/.test(' ' + e.className); }).length; } };
}

test('Liste: Wischen verschiebt ohne Fokuswechsel und laeuft frei aus (kein Einrasten), Gummiband federt zurueck', function () {
  var a = open();
  assert.strictEqual(a.list(), 0);
  assert.strictEqual(a.catFocus(), 1);
  a.swipe(800, 450, 300, 300, 120);                          // 150 px nach oben, Finger steht -> kein Schwung
  a.flush(2000);
  assert.strictEqual(a.list(), -150, 'bleibt zwischen zwei Zeilen stehen (64 px je Zeile)');
  assert.strictEqual(a.catFocus(), 1, 'Fokus bleibt auf der Kategorie');
  assert.strictEqual(a.focusRows().length, 0);
  a.swipe(800, 300, 460, 200, 120);                          // weit ueber den Anfang hinaus: Gummiband, dann zurueck auf 0
  a.flush(2000);
  assert.strictEqual(a.list(), 0);
});

test('Kategorien: Zug angenommen, nichts passiert; Tippen trifft die Zeile unter dem Finger; erste Taste rastet ein', function () {
  var a = open();
  a.swipe(280, 400, 160, 300, 120);
  a.flush(500);
  assert.strictEqual(a.list(), 0);
  assert.strictEqual(a.catFocus(), 1);
  a.swipe(800, 450, 300, 300, 120);                          // -150 px: Zeile 2 beginnt bei 112 + 128 - 150 = 90
  a.flush(2000);
  a.s.pointer(800, 120, 'move');                             // y 120 -> (120 - 112 + 150) / 64 = 2,47 -> Zeile 2
  var rows = a.focusRows();
  assert.strictEqual(rows.length, 1);
  assert.ok(/top:128px/.test(rows[0].style.cssText), rows[0].style.cssText);
  assert.strictEqual(a.list(), -150, 'Tippen laesst die Liste stehen');
  a.s.onKey('DOWN');                                         // Taste: Fokus Zeile 3, Liste rastet auf ganze Zeilen (TV-Weg)
  assert.ok(a.list() % 64 === 0 && a.list() < 0, 'eingerastet: ' + a.list());
});
