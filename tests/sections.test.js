'use strict';
/* N.sections (NAV-5 "Zurueck aus einem Bereich"): reine Regeln des Verlaufs */
var test = require('node:test'), assert = require('assert');
var H = require('./helpers/load');
function eq(a, b, m) { assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m); }   // Werte aus dem vm-Kontext (andere Array-Herkunft)
var N = H.load({ only: ['core/evt.js', 'core/sections.js'] }).N, S = N.sections, R = S.H;

test('visit: neuester vorn, jeder Bereich hoechstens einmal (Wiederbesuch rueckt nach vorn)', function () {
  var l = [];
  ['lib-1', 'search', 'lib-1', 'settings'].forEach(function (id) { l = R.visit(l, id); });
  eq(l, ['settings', 'lib-1', 'search']);
});

test('back: naechster andere Bereich, der verlassene faellt heraus, verschwundene werden uebersprungen, leer -> Start', function () {
  eq(R.back(['settings', 'lib-1', 'search'], 'settings'), { to: 'lib-1', list: ['lib-1', 'search'] });
  eq(R.back(['settings', 'lib-1', 'search'], 'settings', function (id) { return id !== 'lib-1'; }), { to: 'search', list: ['search'] });
  eq(R.back(['settings'], 'settings'), { to: 'home', list: [] });
  eq(R.back([], 'search'), { to: 'home', list: [] });
  // Bereich nicht ueber die Seitenleiste geoeffnet (nicht im Verlauf): der juengste aus dem Verlauf
  eq(R.back(['lib-2'], 'lib-9'), { to: 'lib-2', list: ['lib-2'] });
});

test('mode: Standard "Zur Startseite", nur "prev" schaltet den Verlauf ein; target kuerzt den Verlauf', function () {
  assert.strictEqual(R.mode(null), 'home');
  assert.strictEqual(R.mode({ sectionBack: 'x' }), 'home');
  assert.strictEqual(R.mode({ sectionBack: 'prev' }), 'prev');
  S.reset(); S.visit('lib-1'); S.visit('search');
  assert.strictEqual(S.target('search', {}), 'home', 'Standard: immer Start, Verlauf bleibt');
  eq(S.list(), ['search', 'lib-1']);
  assert.strictEqual(S.target('search', { sectionBack: 'prev' }), 'lib-1');
  eq(S.list(), ['lib-1']);
  S.visit('home');
  eq(S.list(), [], 'Start leert den Verlauf');
});
