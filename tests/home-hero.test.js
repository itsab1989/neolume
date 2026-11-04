'use strict';
/* Startseite auf Apple mit Infobereich ueber den Kacheln (HOME-18, caps.homeHero, Einstellung homeHero; Nr. 34) ohne Browser:
 * Mini-DOM, echte Reihen (N.ui.Row), Apple-Kern, kuenstliche Uhr. Der Hero ist ein Stub, der seine Aufrufe zaehlt.
 * - Zeiger/Tastatur + genug Hoehe: Hero mit Bildkasten in Flaechenbreite, erste Reihe bei y 348, Ausschnitt ab y 308, TV-Reihen.
 * - Finger, Einstellung aus, zu flach, zu schmal: Kacheln wie bisher (kein Hero).
 * - Hysterese der Hoehe (RowMath.heroTall), Zeiger ueber dem Infobereich trifft nichts, Hover setzt den Hero erst in Ruhe.
 * - Eingabeart-Wechsel: sofort auf einer unbedienten Seite, auf einer bedienten nachgeholt (oben, Ruhe 1 s, nichts offen),
 *   zum Finger erst beim naechsten Aufbau (s.stale). */
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
function card(rk, kind) { return { rk: rk, type: kind === 'land' ? 'episode' : 'movie', title: 'Demo ' + rk, thumb: '/t/' + rk, still: '/s/' + rk, art: '/a/' + rk, vc: 0, off: 0, dur: 0, leaf: 1, vleaf: 0 }; }
function row(id, n, kind) { var it = []; for (var i = 0; i < n; i++) it.push(card(id + i, kind)); return { id: id, kind: kind, tk: 'home.row.newIn', tp: { library: 'Filme' }, items: it }; }

/* o: {w, h, mode ('pointer'|'key'|'touch'), off (Einstellung aus), platform} */
function open(o) {
  o = o || {};
  var c = H.load({ fakeTimers: true, platform: o.platform || 'apple' }), N = c.N, T = c.timers, frames = [], heroes = [], renews = [];
  c.document = FakeDoc();
  N.util.raf = function (f) { frames.push(f); return frames.length; };
  N.i18n.set('de');
  if (o.platform !== 'samsung-orsay') {
    N.platform.caps.screen.flex = true;
    N.platform.screen.size = function () { return { w: o.w || 1440, h: o.h || 900 }; };
    N.screen.init();
  }
  N.input.on = true; N.input.mode = o.mode || 'pointer';
  N.ui.Hero = function (root, opts) { this.opts = opts; this.sets = []; this.item = null; heroes.push(this); };
  N.ui.Hero.prototype = { set: function (it) { this.item = it; this.sets.push(it ? it.rk : null); }, clear: function () { this.set(null); }, refresh: function () {}, setStrip: function () {}, paintOv: function () {} };
  N.ui.Ambient = function () { this.amb = true; };
  N.ui.Ambient.prototype = { enter: function () {}, focus: function () {}, data: function () {}, destroy: function () {} };
  N.ui.Ring = function () { this.at = null; };
  N.ui.Ring.prototype = { prep: function () {}, to: function (sh, x, y) { this.at = [x, y]; }, hide: function () { this.at = null; } };
  N.ui.StateBlock = function () { this.on = false; };
  N.ui.StateBlock.prototype = { show: function () { this.on = true; }, hide: function () { this.on = false; }, setText: function () {} };
  N.ui.rail = { setData: function () {}, isOpen: function () { return false; }, open: function () {} };
  N.router.refreshHints = function () {};
  N.router.renew = function (scr) { renews.push(scr); return true; };
  N.details = { open: function () {}, play: function () {} };
  N.img.warm = function () {};
  var libs = [{ id: 1, type: 'movie', title: 'Filme', kind: 'movie', loc: [] }];
  var rows = [row('a', 9, 'land'), row('b', 14, 'poster'), row('c', 12, 'poster'), row('d', 12, 'land'), row('e', 12, 'poster')];
  var cache = { v: 1, libs: libs, alibs: libs, rows: rows };
  N.session = { profile: { uuid: 'p1' }, settings: { homeRows: rows.map(function (r) { return { id: r.id, on: true }; }), homeHero: o.off ? false : undefined },
    homeCache: function () { return cache; }, setHomeCache: function () {}, hubCatalog: function () { return null; }, setHubCatalog: function () {},
    refreshUsersLater: function () {}, isKid: function () { return false; } };
  N.hubs.fetch = function () { return { abort: function () {} }; };
  N.hubs.order = function () { return rows.map(function (r) { return r.id; }); };
  N.hubs.pick = function (r) { return r; };
  var defs = {}, real = N.router.define;
  N.router.define = function (n, f) { defs[n] = f; };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'home.js'), 'utf8'), c, { filename: 'views/home.js' });
  N.router.define = real;
  function make() { var s = defs.home({}), root = c.document.createElement('div'); s.create(root); s.enter({}, null); return { s: s, root: root }; }
  var v = make();
  function all(el, k, out) { out = out || []; if ((' ' + el.className + ' ').indexOf(' ' + k + ' ') >= 0) out.push(el); (el.childNodes || []).forEach(function (x) { if (x.childNodes) all(x, k, out); }); return out; }
  function tx(el) { var m = /translate3d\((-?[\d.]+)px,(-?[\d.]+)px/.exec(el.style.webkitTransform || ''); return m ? [Number(m[1]), Number(m[2])] : [0, 0]; }
  function heads(root) { return all(root, 'hrow').filter(function (h) { return h.style.top; }).map(function (h) { return Number(h.style.top.replace('px', '')); }).sort(function (x, y) { return x - y; }); }
  function flush(ms) { for (var i = 0; i < ms / 16; i++) { T.tick(16); var f = frames.shift(); if (f) f(); } }
  return { N: N, T: T, s: v.s, root: v.root, make: make, heroes: heroes, renews: renews, all: all, heads: heads, flush: flush, pg: function () { return tx(all(v.root, 'pg')[0])[1]; } };
}

test('RowMath.heroTall: ein ab 800, aus erst unter 760 (Hysterese beim Fenster-Ziehen)', function () {
  var c = H.load({}), RM = c.N.RowMath;
  assert.strictEqual(RM.heroTall(799, null), false); assert.strictEqual(RM.heroTall(800, null), true);
  assert.strictEqual(RM.heroTall(780, true), true, 'war an: bleibt bis 760');
  assert.strictEqual(RM.heroTall(759, true), false);
  assert.strictEqual(RM.heroTall(780, false), false, 'war aus: erst ab 800');
});

test('Zeiger, Flaeche hoch genug: Infobereich oben, Bildkasten in Flaechenbreite, Reihen wie am TV ab y 348, Ausschnitt ab 308', function () {
  var a = open({ w: 1440, h: 900, mode: 'pointer' });
  assert.strictEqual(a.heroes.length, 1, 'ein Hero');
  assert.strictEqual(JSON.stringify(a.heroes[0].opts), JSON.stringify({ w: 1440, xf: true, decode: true }));
  assert.ok(/(^| )hhero( |$)/.test(a.root.className), 'Klasse hhero fuer flex.css');
  var h = a.heads(a.root);
  assert.strictEqual(h[0], 348, 'erster Reihenkopf unter dem Infobereich');
  assert.strictEqual(h[1] - h[0], 288, 'Querformat-Reihe wie am TV (L, Kopf zu Kopf 288)');
  var clip = a.all(a.root, 'hclip')[0];
  assert.ok(clip, 'Ausschnitt da');
  assert.strictEqual(a.all(a.root, 'cap-poster').filter(function (e) { return e.style.display !== 'none' && e.style.display !== undefined && e.style.display !== ''; }).length, 0, 'Poster ohne Beschriftung (Titel steht im Infobereich)');
  a.flush(400);
  assert.deepStrictEqual(a.heroes[0].sets, ['a0'], 'Hero zeigt die erste Karte nach der Ruhe');
});

test('Kacheln bleiben: Finger, Einstellung aus, zu flach, zu schmal, TV ohne caps.homeHero', function () {
  [{ mode: 'touch' }, { off: true }, { h: 740 }, { w: 760, h: 1100 }].forEach(function (o) {
    var a = open(o);
    assert.strictEqual(a.heroes.length, 0, JSON.stringify(o) + ': kein Hero');
    assert.strictEqual(a.heads(a.root)[0], 88, JSON.stringify(o) + ': erste Reihe unter der Uhr');
    assert.strictEqual(a.s.stale(), false);
  });
  var tv = open({ platform: 'samsung-orsay' });
  assert.strictEqual(tv.N.platform.caps.homeHero, false);
  assert.strictEqual(tv.heroes.length, 1, 'TV: Hero wie immer');
  assert.strictEqual(tv.heroes[0].opts, undefined, 'TV: ohne Optionen (Vollbild-Bild wie bisher)');
  assert.strictEqual(tv.heads(tv.root)[0], 320, 'TV: Reihe bei 320 wie immer');
  assert.strictEqual(tv.s.stale(), false);
});

test('Hover: Hero erst nach Ruhe, schnelles Ueberfahren vieler Kacheln setzt ihn einmal; ueber dem Infobereich kein Treffer', function () {
  var a = open({ w: 1440, h: 900 });
  a.flush(400);
  var hr = a.heroes[0], n0 = hr.sets.length, y = 348 + 52 + 60;   // Karten der Reihe a (Querformat)
  for (var i = 0; i < 4; i++) { a.N.idle.touch(); assert.strictEqual(a.s.pointer(144 + i * 312 + 40, y, 'move'), true); a.T.tick(60); }
  assert.strictEqual(hr.sets.length, n0, 'waehrend der Bewegung kein Wechsel');
  a.flush(500);
  assert.deepStrictEqual(hr.sets.slice(n0), ['a3'], 'in Ruhe genau einmal die letzte Kachel');
  assert.strictEqual(a.s.pointer(400, 200, 'move'), false, 'Zeiger ueber dem Infobereich: nichts');
  assert.strictEqual(a.s.pointer(400, 310, 'move'), false, 'im Verlauf: nichts');
});

test('Rollen mit Rad/Trackpad: nur die Seite bewegt sich (ein Transform), der Infobereich bleibt stehen', function () {
  var a = open({ w: 1440, h: 900 });
  a.flush(400);
  var hr = a.heroes[0], n0 = hr.sets.length;
  assert.strictEqual(a.s.wheel(600, 500, 0, 120), true);
  a.flush(300);
  assert.ok(a.pg() < 0, 'Seite gerollt: ' + a.pg());
  assert.strictEqual(hr.sets.length, n0, 'Hero unveraendert');
});

test('Eingabeart-Wechsel: unbediente Seite sofort (renew), bediente erst beim naechsten Aufbau; Finger -> Kacheln erst danach', function () {
  var a = open({ w: 1440, h: 900, mode: 'touch' });
  assert.strictEqual(a.heroes.length, 0);
  a.N.input.set('pointer');
  assert.strictEqual(a.s.stale(), true, 'Zeiger: Infobereich gewuenscht');
  assert.deepStrictEqual(a.renews, [a.s], 'unbediente Seite: sofort neu aufbauen');
  var b = open({ w: 1440, h: 900, mode: 'touch' });
  b.s.wheel(600, 500, 0, 60);                                  // bedient
  b.N.input.set('pointer');
  assert.deepStrictEqual(b.renews, [], 'bediente Seite: nicht unter der Hand umbauen');
  assert.strictEqual(b.s.stale(), true, 'aber beim naechsten Aufbau');
  b.T.tick(3000);
  assert.deepStrictEqual(b.renews, [], 'Seite nicht ganz oben: kein Nachholen');
  var c = open({ w: 1440, h: 900, mode: 'pointer' });
  c.N.input.set('touch');
  assert.deepStrictEqual(c.renews, [], 'Finger: nie sofort (der erste Tipp traefe sonst eine andere Kachel)');
  c.T.tick(3000);
  assert.deepStrictEqual(c.renews, [], 'Finger: auch nicht nachgeholt');
  assert.strictEqual(c.s.stale(), true);
  var n = c.make();
  assert.strictEqual(c.heroes.length, 1, 'neuer Aufbau mit Finger: kein weiterer Hero');
  assert.strictEqual(c.heads(n.root)[0], 88);
});

test('Flache Flaeche (Kacheln dicht, Nachbefund 03.11.): Untertitel der Reihen beruehren nie die naechste Ueberschrift', function () {
  [{ w: 1092, h: 556, mode: 'touch' }, { w: 960, h: 640, mode: 'pointer' }].forEach(function (o) {
    var a = open(o), h = a.heads(a.root), RM = a.N.RowMath;
    assert.strictEqual(a.heroes.length, 0, 'flach: kein Infobereich');
    var kinds = ['land', 'poster', 'poster', 'land'];                  // Reihen a–d
    assert.ok(h.length >= 3, "mind. drei Reihen im DOM");
    for (var i = 0; i < kinds.length && i + 1 < h.length; i++) {
      var g = RM.homeGeom('M', kinds[i], o.w), bottom = 52 + g.capY + 24 + 22;   // Kopf + Beschriftung (zwei Zeilen)
      assert.ok(h[i + 1] - h[i] - bottom >= 16, JSON.stringify(o) + ' Reihe ' + i + ': Luft ' + (h[i + 1] - h[i] - bottom));
    }
    assert.strictEqual(h[1] - h[0], 272); assert.strictEqual(h[2] - h[1], 352);
  });
});

test('Nachholen (Nutzerbefund 04.11.): bediente Seite bekommt den Infobereich, sobald sie oben steht und 1 s Ruhe ist', function () {
  var a = open({ w: 1440, h: 900, mode: 'touch' });
  a.s.wheel(600, 500, 0, 60);                                  // mit dem Finger/Rad bedient, Seite gerollt
  a.N.input.set('pointer');
  a.T.tick(2000);
  assert.deepStrictEqual(a.renews, [], 'gerollt: wartet');
  a.s.wheel(600, 500, 0, -60);                                 // zurueck nach ganz oben
  a.T.tick(600);
  assert.deepStrictEqual(a.renews, [], 'noch keine Sekunde Ruhe');
  a.s.pointer(700, 500, 'move');                               // Zeiger bewegt: Ruhe beginnt neu
  a.T.tick(700);
  assert.deepStrictEqual(a.renews, [], 'Zeiger bewegt sich: wartet weiter');
  a.T.tick(800);
  assert.deepStrictEqual(a.renews, [a.s], 'oben und in Ruhe: neu aufbauen');
  // Seitenleiste offen: erst nach dem Schliessen
  var b = open({ w: 1440, h: 900, mode: 'touch' }), open_ = true;
  b.N.ui.rail.isOpen = function () { return open_; };
  b.N.input.set('pointer');
  b.T.tick(3000);
  assert.deepStrictEqual(b.renews, [], 'Seitenleiste offen: wartet');
  open_ = false; b.s.railFocus();
  b.T.tick(600);
  assert.deepStrictEqual(b.renews, [], 'gleich nach dem Schliessen noch nicht');
  b.T.tick(600);
  assert.deepStrictEqual(b.renews, [b.s], 'Seitenleiste zu, 1 s Ruhe: neu aufbauen');
  // Overlay offen: wartet; danach nachgeholt
  var c = open({ w: 1440, h: 900, mode: 'touch' }), ov = true;
  c.N.router.hasOverlay = function () { return ov; };
  c.s.onKey('RIGHT');                                          // mit Tasten bedient
  c.N.input.set('key');
  c.T.tick(3000);
  assert.deepStrictEqual(c.renews, [], 'Overlay offen: wartet');
  ov = false; c.T.tick(1100);
  assert.deepStrictEqual(c.renews, [c.s], 'Overlay zu: neu aufbauen');
  // verdeckt (leave): Schluss, die Rueckkehr baut ueber s.stale neu
  var d = open({ w: 1440, h: 900, mode: 'touch' });
  d.s.onKey('RIGHT');
  d.N.input.set('pointer');
  d.s.leave();
  d.T.tick(3000);
  assert.deepStrictEqual(d.renews, [], 'verdeckt: nichts');
  assert.strictEqual(d.s.stale(), true);
});
