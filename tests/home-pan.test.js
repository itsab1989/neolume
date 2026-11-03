'use strict';
/* Startseite auf Apple (caps.home 'tiles', caps.scroll 'free', caps.cardTap 'details'; 08-touch S4–S6, Nr. 12/16/18/22) ohne Browser:
 * Mini-DOM, echte Reihen (N.ui.Row), Apple-Kern (N.kinetic), kuenstliche Uhr und rAF.
 * - Kacheln: kein Hero, erste Reihe oben (y 88), alle Reihen sichtbar, Poster mit Beschriftung.
 * - Reihe folgt dem Zug live (jede Bewegung ein Transform), laeuft mit Schwung frei aus, ohne Einrasten auf Kartengrenzen.
 * - Wisch nach rechts am Reihenanfang: nur Gummiband, kein Fokuswechsel, nie die Seitenleiste (Nr. 22).
 * - Seite senkrecht frei; Beruehrung haelt den Schwung an und oeffnet nichts; Tipper oeffnet die Details.
 * - Erste Taste nach dem Wischen: Fokus auf die Karte am Anker, Reihe/Seite zurueck im Tastenraster. */
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
function card(rk, kind) { return { rk: rk, type: kind === 'land' ? 'episode' : 'movie', title: 'Demo ' + rk, thumb: '/t/' + rk, still: '/s/' + rk, vc: 0, off: 0, dur: 0, leaf: 1, vleaf: 0 }; }
function row(id, n, kind) { var it = []; for (var i = 0; i < n; i++) it.push(card(id + i, kind)); return { id: id, kind: kind, tk: 'home.row.newIn', tp: { library: 'Filme' }, items: it }; }

function open() {
  var c = H.load({ fakeTimers: true, platform: 'apple' }), N = c.N, T = c.timers, frames = [], details = [], rails = [];
  c.document = FakeDoc();
  N.util.raf = function (f) { frames.push(f); return frames.length; };
  N.i18n.set('de');
  N.ui.Hero = function () { throw new Error('Kacheln: kein Hero'); };
  N.ui.Ring = function () { this.at = null; };
  N.ui.Ring.prototype = { prep: function () {}, to: function (sh, x, y) { this.at = [x, y]; }, hide: function () { this.at = null; } };
  N.ui.StateBlock = function () { this.on = false; };
  N.ui.StateBlock.prototype = { show: function () { this.on = true; }, hide: function () { this.on = false; }, setText: function () {} };
  N.ui.rail = { setData: function () {}, isOpen: function () { return false; }, open: function () { rails.push(1); } };
  N.router.refreshHints = function () {};
  N.details = { open: function (it) { details.push(it.rk); }, play: function () {} };
  N.img.warm = function () {};
  var libs = [{ id: 1, type: 'movie', title: 'Filme', kind: 'movie', loc: [] }];
  var rows = [row('a', 14, 'poster'), row('b', 9, 'land'), row('c', 12, 'poster'), row('d', 12, 'poster'), row('e', 12, 'land')];
  var cache = { v: 1, libs: libs, alibs: libs, rows: rows };
  N.session = { profile: { uuid: 'p1' }, settings: { homeRows: rows.map(function (r) { return { id: r.id, on: true }; }) }, homeCache: function () { return cache; }, setHomeCache: function () {},
    hubCatalog: function () { return null; }, setHubCatalog: function () {}, refreshUsersLater: function () {}, isKid: function () { return false; } };
  N.hubs.fetch = function () { return { abort: function () {} }; };
  N.hubs.order = function () { return rows.map(function (r) { return r.id; }); };
  N.hubs.pick = function (r) { return r; };
  var defs = {}, real = N.router.define;
  N.router.define = function (n, f) { defs[n] = f; };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'home.js'), 'utf8'), c, { filename: 'views/home.js' });
  N.router.define = real;
  var s = defs.home({}), root = c.document.createElement('div');
  s.create(root); s.enter({}, null);
  function all(el, k, out) { out = out || []; if ((' ' + el.className + ' ').indexOf(' ' + k + ' ') >= 0) out.push(el); (el.childNodes || []).forEach(function (x) { if (x.childNodes) all(x, k, out); }); return out; }
  function tx(el) { var m = /translate3d\((-?[\d.]+)px,(-?[\d.]+)px/.exec(el.style.webkitTransform || ''); return m ? [Number(m[1]), Number(m[2])] : [0, 0]; }
  var pg = all(root, 'pg')[0];
  function stripOf(id) { var hr = all(root, 'hrow').filter(function (h) { return h.childNodes[0].childNodes[0].nodeValue && h.style.top === (rowTop(id)) + 'px'; })[0]; return hr ? all(hr, 'strip')[0] : null; }
  var tops = {}, y = 88; rows.forEach(function (r) { tops[r.id] = y; y += { land: 312, poster: 400, sq: 312 }[r.kind]; });
  function rowTop(id) { return tops[id]; }
  function flush(ms) { for (var i = 0; i < ms / 16 && frames.length; i++) { T.tick(16); var f = frames.shift(); f(); } }
  function swipe(axis, x, y0, d, ms, rest, log) {
    var t = T.now(), n = 10, out = [];
    assert.strictEqual(s.pan({ phase: 'start', axis: axis, x: x, y: y0, dx: 0, dy: 0, t: t }), true);
    for (var i = 1; i <= n; i++) {
      T.tick(ms / n);
      s.pan({ phase: 'move', axis: axis, x: x, y: y0, dx: axis === 'x' ? d * i / n : 0, dy: axis === 'y' ? d * i / n : 0, t: T.now() });
      if (log) out.push(log());
    }
    T.tick(rest || 0);
    s.pan({ phase: 'end', axis: axis, x: x, y: y0, dx: axis === 'x' ? d : 0, dy: axis === 'y' ? d : 0, t: T.now() });
    return out;
  }
  /* Neuaufbau derselben Ansicht (Router: Einstellungen -> Startseite, Groessenwechsel): neue Instanz mit restore aus leave() */
  function rebuild() {
    var st = s.leave(), s2 = defs.home({}), r2 = c.document.createElement('div');
    s2.create(r2); s2.enter({}, st);
    return { s: s2, pg: function () { return tx(all(r2, 'pg')[0])[1]; } };
  }
  return { N: N, T: T, s: s, root: root, rebuild: rebuild, pg: function () { return tx(pg)[1]; }, strip: function (id) { return tx(stripOf(id))[0]; }, flush: flush, swipe: swipe,
    details: details, rails: rails, all: all, tops: tops };
}

test('Kacheln: kein Hero, erste Reihe oben, alle Reihen sichtbar, Poster mit Beschriftung', function () {
  var a = open();
  assert.strictEqual(a.N.platform.caps.home, 'tiles');
  var heads = a.all(a.root, 'hrow').filter(function (h) { return h.style.top; }).map(function (h) { return Number(h.style.top.replace('px', '')); }).sort(function (x, y) { return x - y; });
  assert.strictEqual(heads[0], 88, 'erste Reihe direkt unter der Uhr');
  assert.ok(heads.length >= 3, 'mehrere Reihen im Bild');
  a.all(a.root, 'rclip').forEach(function (c) { assert.notStrictEqual(c.style.opacity, '0', 'keine Reihe verborgen'); });
  var caps = a.all(a.root, 'cap-poster').filter(function (e) { return e.style.display !== 'none'; });
  assert.ok(caps.length > 0, 'Poster-Beschriftung sichtbar');
});

test('Reihe folgt dem Zug live, laeuft frei aus (kein Einrasten); Wisch nach rechts am Anfang: Gummiband, keine Seitenleiste', function () {
  var a = open();
  var y = a.tops.a + 52 + 100;
  var live = a.swipe('x', 600, y, -230, 230, 120, function () { return a.strip('a'); });   // langsam, Finger steht: kein Schwung
  for (var i = 1; i < live.length; i++) assert.ok(live[i] < live[i - 1], 'jede Bewegung verschiebt sofort');
  assert.ok(Math.abs(live[live.length - 1] + 230) < 1, 'folgt 1:1: ' + live[live.length - 1]);
  a.flush(2000);
  assert.strictEqual(a.strip('a'), -230, 'bleibt zwischen zwei Karten stehen (Schritt 200)');
  a.swipe('x', 600, y, -400, 80, 0);                                               // schnell: Schwung
  var t0 = a.strip('a'); a.flush(100); var t1 = a.strip('a'); a.flush(3000); var t2 = a.strip('a');
  assert.ok(t1 < t0 && t2 < t1, 'laeuft nach dem Loslassen weiter: ' + [t0, t1, t2]);
  assert.ok(t2 % 200 !== 0 || t2 === -a.N.RowMath.maxPx(14, a.N.RowMath.geom('poster'), 1280), 'kein Rasten auf Kartengrenzen: ' + t2);
  // zurueck an den Anfang und darueber hinaus nach rechts ziehen
  a.swipe('x', 600, y, 3000, 300, 120); a.flush(3000);
  assert.strictEqual(a.strip('a'), 0);
  var over = a.swipe('x', 600, y, 300, 300, 0, function () { return a.strip('a'); });
  assert.ok(over[over.length - 1] > 0 && over[over.length - 1] < 300, 'Gummiband: weniger als der Fingerweg ' + over[over.length - 1]);
  a.flush(2000);
  assert.strictEqual(a.strip('a'), 0, 'federt zurueck');
  assert.deepStrictEqual(a.rails, [], 'nie die Seitenleiste (Nr. 22)');
});

test('Seite senkrecht frei; Beruehrung stoppt den Schwung ohne zu oeffnen; Tipper oeffnet die Details', function () {
  var a = open();
  a.swipe('y', 600, 500, -150, 300, 120); a.flush(2000);
  assert.strictEqual(a.pg(), -150, 'Seite bleibt, wo der Finger sie liess');
  a.swipe('y', 600, 600, -400, 80, 0);
  a.flush(48);
  var p0 = a.pg();
  a.s.pointerDown(600, 400);                                                       // Finger legt sich auf: Schwung stoppt
  a.flush(500);
  assert.strictEqual(a.pg(), p0, 'steht nach der Beruehrung');
  assert.strictEqual(a.s.pointer(600, 400, 'move'), true); assert.strictEqual(a.s.pointer(600, 400, 'click'), true);
  assert.deepStrictEqual(a.details, [], 'Tipper zum Anhalten oeffnet nichts');
  // Tipper auf eine Karte der Reihe b (Querformat, Weiterschauen-Art: am TV wuerde OK abspielen) -> Details
  var yb = a.tops.b + 52 + 60 + a.pg();
  a.s.pointer(144 + 312 + 20, yb, 'move'); a.s.pointer(144 + 312 + 20, yb, 'click');
  assert.deepStrictEqual(a.details, ['b1'], 'Details der getippten Karte');
});

test('Erste Taste nach dem Wischen: Fokus auf die Karte am Anker, Seite und Reihe im Tastenraster', function () {
  var a = open();
  a.swipe('y', 600, 700, -a.tops.c + 88 - 30, 300, 120); a.flush(2000);       // Reihe c knapp ueber dem Anker
  var yc = a.tops.c + 52 + 100 + a.pg();
  a.swipe('x', 600, yc, -450, 300, 120); a.flush(2000);                           // Reihe c um 2,25 Karten
  assert.strictEqual(a.strip('c'), -450);
  a.s.onKey('RIGHT');                                                              // nur Anker, kein Schritt
  assert.strictEqual(a.pg(), -(a.tops.c - 88), 'Seite: Reihe c am Anker');
  assert.strictEqual(a.strip('c'), -600, 'Reihe: erste ganz sichtbare Karte (3) links');
  var foc = a.all(a.root, 'is-focus').filter(function (e) { return / card /.test(' ' + e.className + ' '); });
  assert.strictEqual(foc.length, 1);
  a.s.onKey('RIGHT');
  assert.strictEqual(a.strip('c'), -800, 'danach Fokus-Schritte wie am TV');
});

test('Seitenlage bleibt im gueltigen Bereich: Neuaufbau mit der letzten Reihe im Fokus, erste Taste am Ende (Auftrag 02.11. Punkt 14)', function () {
  var a = open(), max = a.tops.e + 312 - (720 - 72);                              // letzte Reihe endet ueber der Hinweisleiste
  assert.ok(a.tops.e - 88 > max, 'Testaufbau: Reihe e am Anker laege hinter dem Ende');
  a.swipe('y', 600, 700, -3000, 300, 120); a.flush(3000);                         // ganz nach unten
  assert.strictEqual(a.pg(), -max, 'am Ende');
  a.s.onKey('DOWN');                                                               // erste Taste: Fokus auf die Reihe am Anker (d)
  assert.ok(a.pg() >= -max, 'erste Taste: nie hinter das Ende: ' + a.pg());
  a.s.onKey('DOWN'); a.s.onKey('DOWN');
  assert.strictEqual(a.pg(), -max, 'letzte Reihe per Taste: Seite am Ende, kein leerer Raum unten');
  var b = a.rebuild();                                                             // z. B. zurueck aus den Einstellungen
  assert.strictEqual(b.pg(), -max, 'nach dem Neuaufbau: letzte Reihe unten, nicht am Anker oben');
  b.s.onKey('UP'); b.s.onKey('UP'); b.s.onKey('UP'); b.s.onKey('UP');
  assert.strictEqual(b.pg(), 0, 'ganz oben wieder am Anfang');
});

test('An den Anfang (App.scrollTop: Tipp ganz oben / Cmd+Pfeil hoch): Seite gleitet nach oben, Reihen bleiben; oben = false', function () {
  var a = open();
  assert.strictEqual(a.s.scrollTop(), false, 'schon oben: nichts (der Lader macht einen Klick daraus)');
  a.swipe('y', 600, 700, -900, 300, 120); a.flush(2000);
  var yc = a.tops.c + 52 + 100 + a.pg();
  a.swipe('x', 600, yc, -450, 300, 120); a.flush(2000);
  assert.ok(a.pg() < -500);
  assert.strictEqual(a.s.scrollTop(), true);
  a.flush(48); var mid = a.pg();
  assert.ok(mid < 0 && mid > -900, 'gleitet: ' + mid);
  a.flush(1000);
  assert.strictEqual(a.pg(), 0, 'ganz oben');
  assert.strictEqual(a.strip('c'), -450, 'Reihe bleibt, wo sie war');
  assert.strictEqual(a.N.router.scrollTop.length, 0);
});
