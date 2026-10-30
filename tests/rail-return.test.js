'use strict';
/* NAV-5 RETURN-Ketten (Nutzerentscheid 29.10.): Die Seitenleiste gehoert zu keiner Kette mehr (RETURN klappt sie nur ein).
 * Start: erste Karte -> Beenden-Dialog. Bereiche aus der Seitenleiste: erst nach oben, dann je nach "Zurueck aus einem Bereich"
 * zur Startseite (Standard) oder zum vorherigen Bereich (N.sections, Verlauf). Unterebenen gehen per Router eine Ebene zurueck. */
var test = require('node:test'), assert = require('assert');
var H = require('./helpers/load');
function eq(a, b, m) { assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m); }   // Werte aus dem vm-Kontext (andere Array-Herkunft)
var fs = require('fs'), path = require('path'), vm = require('vm');

function setup() {
  var c = H.load(), N = c.N, ctx = c.ctx || c, log = [];
  var R = N.ui.rail, top = null;
  R.close = function () { log.push('close'); };
  N.router.top = function () { return top; };
  N.ui.dialog = { exitApp: function () { log.push('exit'); } };
  /* Fabriken der Bildschirme einsammeln (wie tools/spec_gen.js): Ansichten erneut mit mitschreibendem define laden */
  var defs = {}, real = N.router.define;
  N.router.define = function (n, f) { defs[n] = f; };
  ['views/settings.js', 'views/search.js', 'views/library.js', 'views/help.js', 'views/home.js'].forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'), ctx, { filename: f });
  });
  N.router.define = real;
  return { N: N, R: R, log: log, defs: defs, setTop: function (s) { top = s; } };
}

test('Seitenleiste RETURN: klappt auf jedem Bildschirm nur ein (kein Beenden, kein Sprung zur Startseite)', function () {
  var e = setup();
  e.N.app.navigate = function (id) { e.log.push('nav:' + id); return true; };
  [{ rail: 'home' }, { rail: 'settings' }, { rail: 'search' }, { rail: 'lib-1' }, {}].forEach(function (scr) {
    e.log.length = 0; e.setTop(scr); e.R.onKey('RETURN');
    assert.strictEqual(e.log.join(','), 'close', JSON.stringify(scr));
  });
});

test('Bildschirme tragen kein Kettenende der Seitenleiste mehr (railReturnHome/railReturnExits entfallen)', function () {
  var e = setup(), d = e.defs;
  [d.settings({}), d.search({}), d.discover({}), d.library({ lib: { id: 1, type: 'movie', title: 'Filme' } }), d.home({})].forEach(function (s) {
    assert.ok(!s.railReturnHome && !s.railReturnExits);
  });
});

/* N.app.navigate/sectionBack mit einem Router-Nachbau: Stapel aus Namen + Parametern, Seitenleiste mit festen Eintraegen */
function appSetup(entries) {
  var c = H.load(), N = c.N, stack = [{ name: 'home', params: {} }];
  function scr(e) { var lib = e.params.lib; return { rail: e.name === 'library' ? 'lib-' + lib.id : e.name === 'home' ? 'home' : e.name }; }
  N.router.top = function () { return scr(stack[stack.length - 1]); };
  N.router.topName = function () { return stack[stack.length - 1].name; };
  N.router.topParams = function () { return stack[stack.length - 1].params; };
  N.router.depth = function () { return stack.length; };
  N.router.back = function () { if (stack.length < 2) return false; stack.pop(); return true; };
  N.router.reset = function (n, p) { stack = [{ name: n, params: p || {} }]; };
  N.router.push = function (n, p) { stack.push({ name: n, params: p || {} }); };
  N.router.replace = function (n, p) { stack.pop(); stack.push({ name: n, params: p || {} }); };
  N.ui.rail.entries = entries;
  N.session.settings = {};
  N.sections.reset();
  function at() { var t = stack[stack.length - 1]; return t.name === 'library' ? 'lib-' + t.params.lib.id : t.name; }
  return { N: N, at: at, stack: function () { return stack; }, open: function (id) { var e = N.ui.rail.entry(id); N.app.navigate(e.id, e.lib || null); } };
}
var ENTRIES = [{ id: 'profile' }, { id: 'search' }, { id: 'home' }, { id: 'lib-1', lib: { id: 1, title: 'Filme' } }, { id: 'lib-2', lib: { id: 2, title: 'Musik' } }, { id: 'settings' }];

test('Bereiche aus der Seitenleiste bekommen sec, Standard "Zur Startseite": RETURN oben -> Start', function () {
  var a = appSetup(ENTRIES.slice());
  a.open('lib-1'); a.open('settings');
  assert.strictEqual(a.stack()[a.stack().length - 1].params.sec, 1, 'Bereich weiss, dass er aus der Seitenleiste kommt');
  a.N.app.sectionBack();
  assert.strictEqual(a.at(), 'home');
  assert.strictEqual(a.stack().length, 1);
});

test('"Zum vorherigen Bereich": Verlauf rueckwaerts, jeder Bereich einmal, endet auf Start; Wiederbesuch rueckt nach vorn', function () {
  var a = appSetup(ENTRIES.slice());
  a.N.session.settings = { sectionBack: 'prev' };
  a.open('lib-1'); a.open('search'); a.open('lib-2'); a.open('search'); a.open('settings');
  eq(a.N.sections.list(), ['settings', 'search', 'lib-2', 'lib-1']);
  a.N.app.sectionBack(); assert.strictEqual(a.at(), 'search');
  a.N.app.sectionBack(); assert.strictEqual(a.at(), 'lib-2');
  a.N.app.sectionBack(); assert.strictEqual(a.at(), 'lib-1');
  a.N.app.sectionBack(); assert.strictEqual(a.at(), 'home');
});

test('"Zum vorherigen Bereich": verschwundene Bereiche werden uebersprungen; Start und Profilwechsel leeren den Verlauf', function () {
  var a = appSetup(ENTRIES.slice());
  a.N.session.settings = { sectionBack: 'prev' };
  a.open('lib-1'); a.open('lib-2'); a.open('settings');
  a.N.ui.rail.entries = ENTRIES.filter(function (e) { return e.id !== 'lib-2'; });   // Bibliothek "Musik" ist weg
  a.N.app.sectionBack(); assert.strictEqual(a.at(), 'lib-1');
  a.open('settings'); a.N.app.navigate('home');
  eq(a.N.sections.list(), []);
  a.open('lib-1'); a.open('settings');
  a.N.evt.emit('profile:changed');
  eq(a.N.sections.list(), []);
});
