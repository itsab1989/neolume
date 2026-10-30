'use strict';
/* Startseite (views/home.js) ohne DOM: Reihen-Slots, Hero, Ring und das Laden (N.hubs.fetch) sind Attrappen, Zeitgeber kuenstlich.
 * - HOME-12 (TV-Test 30.10.): Signal "Bibliothek geaendert", die Teil-Antwort enthielt die neue Serie noch nicht (der PMS nennt sie in
 *   "Zuletzt hinzugefuegt" erst nach dem Zuordnen, das Signal steigt danach nicht wieder) -> die Startseite sieht selbst nach.
 * - Aenderung, waehrend schon geladen wird: danach holen (vorher verworfen).
 * - Erweiterungs-Reihen (TV-Test 30.10.): eine per 'home:want' geladene Erweiterungs-Reihe wird bei der Rueckkehr neu gezeichnet. */
var test = require('node:test'), assert = require('assert');
var fs = require('fs'), path = require('path'), vm = require('vm');
var H = require('./helpers/load');

function setup(opts) {
  opts = opts || {};
  var c = H.load({ fakeTimers: true }), N = c.N, T = c.timers, calls = [], slots = [];
  function El(tag) { this.tagName = tag; this.style = {}; this.childNodes = []; this.className = ''; }
  El.prototype.appendChild = function (x) { this.childNodes.push(x); x.parentNode = this; return x; };
  El.prototype.setAttribute = function () {};
  c.document = { createElement: function (t) { return new El(t); }, createTextNode: function (t) { return { nodeValue: t }; }, body: new El('body') };
  function Slot() { this.model = null; this.f = 0; this.sc = 0; this.g = N.RowMath.geom('land'); this.pend = false; this.focused = false; this.sets = 0; this.refreshed = 0; slots.push(this); }
  Slot.prototype.setModel = function (m, f) { this.model = m; this.g = N.RowMath.geom(m.kind); this.f = f || 0; this.sets++; };
  Slot.prototype.clear = function () { this.model = null; };
  Slot.prototype.item = function (i) { return this.model ? this.model.items[i] : null; };
  Slot.prototype.count = function () { return this.model ? this.model.items.length : 0; };
  Slot.prototype.ringPos = function () { return { x: 0, y: 0, shape: this.g.kind }; };
  Slot.prototype.focusCol = function (f) { this.f = f; return this.ringPos(); };
  Slot.prototype.setFocused = function (on) { this.focused = on; };
  Slot.prototype.refreshAll = function () { this.refreshed++; };
  Slot.prototype.urls = function (a, b, out) { return out || []; };
  ['setTop', 'setVisible', 'boost', 'setMore', 'render', 'relabel', 'refreshItem'].forEach(function (k) { Slot.prototype[k] = function () {}; });
  N.ui.Row = Slot;
  N.ui.Hero = function () { this.item = null; };
  N.ui.Hero.prototype = { set: function (it) { this.item = it; }, clear: function () {}, refresh: function () {}, setStrip: function () {}, paintOv: function () {} };
  N.ui.Ring = function () {};
  N.ui.Ring.prototype = { prep: function () {}, to: function () {}, hide: function () {} };
  N.ui.StateBlock = function () { this.on = false; };
  N.ui.StateBlock.prototype = { show: function () { this.on = true; }, hide: function () { this.on = false; }, setText: function () {} };
  N.ui.rail = { setData: function () {}, isOpen: function () { return false; } };
  N.fx = { move: function () {}, step: function () {}, isFast: function () { return false; } };
  N.img.warm = function () {};
  N.router.refreshHints = function () {};
  N.i18n.set('de');
  var libs = [{ id: 1, type: 'movie', title: 'Filme', kind: 'movie', loc: [] }, { id: 2, type: 'show', title: 'Serien', kind: 'show', loc: [] }];
  var cache = { v: 1, libs: libs, alibs: libs, rows: opts.cacheRows };
  N.session = { profile: { uuid: 'p1' }, settings: { homeRows: opts.homeRows || null }, homeCache: function () { return cache; }, setHomeCache: function (x) { cache = x; },
    hubCatalog: function () { return null; }, setHubCatalog: function () {}, refreshUsersLater: function () {}, isKid: function () { return false; } };
  N.hubs.fetch = function (cb, prev) { var t = { cb: cb, prev: prev, aborted: false, abort: function () { this.aborted = true; } }; calls.push(t); return t; };
  var defs = {}, real = N.router.define;
  N.router.define = function (n, f) { defs[n] = f; };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'home.js'), 'utf8'), c, { filename: 'views/home.js' });
  N.router.define = real;
  var s = defs.home({});
  s.create(new El('div'));
  return { N: N, T: T, s: s, calls: calls, slots: slots, libs: libs };
}
function card(rk) { return { rk: rk, type: 'show', title: 'Demo ' + rk, thumb: '/t/' + rk, leaf: 1, vleaf: 0, vc: 0, off: 0, dur: 0 }; }
function row(id, rks, kind) { return { id: id, kind: kind || 'poster', tk: 'home.row.newIn', tp: { library: 'Serien' }, items: rks.map(card) }; }
function answer(t, rows, libs) { t.cb(null, { libs: libs, alibs: libs, rows: rows, partial: false, hubCat: {} }); }
function firstOf(e, id) { for (var k = 0; k < e.slots.length; k++) if (e.slots[k].model && e.slots[k].model.id === id) return e.slots[k].model.items[0].rk; return null; }

test('HOME-12: Teil-Antwort ohne die neue Serie -> nach 30 s noch einmal dieselben Reihen holen, neue Serie erscheint an Ort und Stelle', function () {
  var base = [row('cw', ['c1'], 'land'), row('deck', ['d1'], 'land'), row('new-2', ['s1', 's2', 's3'])];
  var e = setup({ cacheRows: base, homeRows: [{ id: 'cw', on: true }, { id: 'deck', on: true }, { id: 'new-2', on: true }] });
  e.s.enter({}, null);
  assert.strictEqual(e.calls.length, 1, 'Start: Cache, dann ein ganzes Laden');
  answer(e.calls[0], JSON.parse(JSON.stringify(base)), e.libs);
  e.T.tick(1000);
  e.s.onKey('RIGHT');                                // bedient: Antworten gehen ab jetzt Reihe fuer Reihe
  e.T.tick(1000);
  e.N.evt.emit('library:changed', { libs: ['2'] });
  assert.strictEqual(e.calls.length, 2);
  assert.strictEqual(JSON.stringify(e.calls[1].prev.only), '["deck","new-2"]');
  answer(e.calls[1], JSON.parse(JSON.stringify(base)), e.libs);   // PMS: Titel noch nicht in "Zuletzt hinzugefuegt"
  e.T.tick(1000);
  assert.strictEqual(e.calls.length, 2, 'noch kein Nachsehen');
  e.T.tick(30000);
  assert.strictEqual(e.calls.length, 3, 'nach 30 s: nachsehen');
  assert.strictEqual(JSON.stringify(e.calls[2].prev.only), '["deck","new-2"]');
  var now = JSON.parse(JSON.stringify(base)); now[2] = row('new-2', ['NEU', 's1', 's2', 's3']);
  answer(e.calls[2], now, e.libs);
  e.T.tick(1000);
  assert.strictEqual(firstOf(e, 'new-2'), 'NEU', 'neue Serie vorn in "Neu in Serien", ohne erneutes Betreten');
  /* TV-Nachtest 30.10.: die Reihe stand am Anfang -> sie bleibt am Anfang (Spalte 0 = NEU sichtbar), statt der alten ersten Karte
   * (s1, jetzt Stelle 1) zu folgen und NEU links aus dem Bild zu schieben */
  var sl = e.slots.filter(function (x) { return x.model && x.model.id === 'new-2'; })[0];
  assert.strictEqual(sl.f, 0, 'Spalte bleibt am Anfang');
  /* weitere Nachsehen (60 s, 120 s), danach Ruhe */
  e.T.tick(60000); assert.strictEqual(e.calls.length, 4); answer(e.calls[3], now, e.libs);
  e.T.tick(120000); assert.strictEqual(e.calls.length, 5); answer(e.calls[4], now, e.libs);
  e.T.tick(600000); assert.strictEqual(e.calls.length, 5, 'nach drei Nachsehen keine weitere Anfrage');
});

test('HOME-12: Aenderung waehrend eines laufenden Ladens wird danach geholt (nicht verworfen); verdeckt -> beim Zurueckkehren', function () {
  var base = [row('cw', ['c1'], 'land'), row('new-2', ['s1', 's2'])];
  var e = setup({ cacheRows: base, homeRows: [{ id: 'cw', on: true }, { id: 'new-2', on: true }] });
  e.s.enter({}, null);
  e.N.evt.emit('library:changed', { libs: ['2'] });   // Start-Laden laeuft noch
  assert.strictEqual(e.calls.length, 1);
  answer(e.calls[0], JSON.parse(JSON.stringify(base)), e.libs);
  e.T.tick(500);
  assert.strictEqual(e.calls.length, 2, 'gleich danach: die betroffene Reihe holen');
  assert.ok(e.calls[1].prev.only.indexOf('new-2') >= 0);
  answer(e.calls[1], JSON.parse(JSON.stringify(base)), e.libs);
  e.T.tick(500);
  e.s.leave();
  e.T.tick(30000);
  assert.strictEqual(e.calls.length, 2, 'anderer Bildschirm oben: kein Laden');
  e.s.enter({}, null);
  assert.strictEqual(e.calls.length, 3, 'beim Zurueckkehren nachsehen');
  assert.ok(e.calls[2].prev.only.indexOf('new-2') >= 0);
});

test('Erweiterungs-Reihe: per home:want geladene Erweiterungs-Reihe zaehlt als Erweiterungs-Reihe -> Rueckkehr zeichnet ihre Karten neu', function () {
  var e = setup({ cacheRows: [row('cw', ['c1'], 'land')], homeRows: [{ id: 'cw', on: true }, { id: 'x-demo', on: true }] });
  var loaded = { id: 'x-demo', kind: 'poster', title: 'Demo', items: [{ rk: 'q1', ext: true, type: 'movie', title: 'Demo q1', thumb: '' }] };
  e.N.ext.on('home:avail', function () { return [{ id: 'x-demo' }]; });
  e.N.ext.on('home:row', function (id) { return id === 'x-demo' ? { id: id, kind: 'poster', title: 'Demo', items: [], note: 'rq.home.note.loading', want: true } : undefined; });
  e.N.ext.on('home:want', function (id, cb) { cb(loaded); });   // Modell ohne ext-Kennung, wie die Erweiterung es liefert
  e.s.enter({}, null);
  e.T.tick(2000);                                   // Leerlauf: Reihe in der Naehe -> laden
  var sl = e.slots.filter(function (x) { return x.model === loaded; })[0];
  assert.ok(sl, 'geladene Reihe im Slot');
  e.s.leave();
  loaded.items[0].badgeText = 'Demo-Marke';        // z. B. Aktion auf der Detailseite (Erweiterung setzt die Marke am selben Kartenobjekt)
  var before = sl.refreshed;
  e.s.enter({}, null);
  assert.strictEqual(sl.refreshed, before + 1, 'Karten der Erweiterungs-Reihe bei der Rueckkehr neu befuellt (Marke sofort)');
});

/* TV-Test 30.10.: geloeschte Serie blieb in der fokussierten Reihe "Neu in Serien", bis der Fokus sie verliess */
function focusedSetup() {
  var base = [row('cw', ['c1'], 'land'), row('new-2', ['s1', 's2', 's3'])];
  var e = setup({ cacheRows: base, homeRows: [{ id: 'cw', on: true }, { id: 'new-2', on: true }] });
  e.s.enter({}, null);
  answer(e.calls[0], JSON.parse(JSON.stringify(base)), e.libs);
  e.T.tick(1000);
  e.N.idle.touch(); e.s.onKey('DOWN');               // Fokus in "Neu in Serien", erste Karte (s1)
  e.T.tick(1000);
  e.N.evt.emit('library:changed', { libs: ['2'] });
  return { e: e, base: base, slot: function () { return e.slots.filter(function (x) { return x.model && x.model.id === 'new-2'; })[0]; } };
}
test('HOME-12/NAV-7.3: fokussierte Karte auf dem Server entfernt -> neue Fassung sofort, gleiche Spalte; sonst nach 30 s ohne Taste', function () {
  var t = focusedSetup(), e = t.e, now = JSON.parse(JSON.stringify(t.base));
  now[1] = row('new-2', ['s2', 's3']);               // s1 (fokussiert) geloescht
  answer(e.calls[e.calls.length - 1], now, e.libs);
  e.T.tick(1000);
  assert.strictEqual(t.slot().model.items[0].rk, 's2', 'sofort eingesetzt');
  assert.strictEqual(t.slot().f, 0, 'gleiche Spalte (begrenzt)');

  var t2 = focusedSetup(), e2 = t2.e, now2 = JSON.parse(JSON.stringify(t2.base));
  now2[1] = row('new-2', ['NEU', 's1', 's2', 's3']);  // neue Serie vorn, fokussierte Karte bleibt
  answer(e2.calls[e2.calls.length - 1], now2, e2.libs);
  e2.T.tick(1000);
  assert.strictEqual(t2.slot().model.items[0].rk, 's1', 'zunaechst unveraendert unter dem Fokus');
  e2.T.tick(15000); e2.N.idle.touch();                // Taste nach 16 s verschiebt das Einsetzen
  e2.T.tick(20000);
  assert.strictEqual(t2.slot().model.items[0].rk, 's1', '20 s nach der Taste: noch nicht');
  e2.T.tick(12000);
  assert.strictEqual(t2.slot().model.items[0].rk, 'NEU', '30 s ohne Taste: eingesetzt');
  assert.strictEqual(t2.slot().f, 1, 'dieselbe Karte (s1) bleibt fokussiert');
});
