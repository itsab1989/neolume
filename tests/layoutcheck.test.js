'use strict';
/* Layout-Pruefung (tools/layoutcheck.js): Erlaubnisliste, Einordnung, Ausschnitte. Die Sonde selbst (tools/layout_probe.js)
 * braucht einen Browser und wird bei jedem Bildtest mit tools/layout_selftest.html geprueft. */
var test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path'), os = require('os');
var LC = require('../tools/layoutcheck.js');

function allow(list) {
  var f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pnlc-')), 'a.json');
  fs.writeFileSync(f, JSON.stringify({ allow: list }));
  return LC.loadAllow(f);
}
var OV = { t: 'overlap', a: { p: 'div.v-home > div.cap > div.t1', s: 'Titel', r: [10, 10, 100, 20] }, b: { p: 'div.v-home > div.hint', s: 'Hinweis', r: [50, 20, 60, 20] }, r: [50, 20, 60, 10] };

test('Erlaubnisliste: Paare in beiden Reihenfolgen, Szene als Muster, Art muss passen', function () {
  var l = allow([{ scene: '^home', type: 'overlap', a: 'div\\.hint$', b: '\\.t1$', reason: 'gewollt' }]);
  assert.ok(LC.allowedBy(OV, 'home-en', l));
  assert.strictEqual(LC.allowedBy(OV, 'details', l), null);
  assert.strictEqual(LC.allowedBy({ t: 'button', a: OV.a, b: OV.b, r: OV.r }, 'home', l), null);
});

test('Erlaubnisliste: nur a passt auf jedes beteiligte Element, Pflichtfelder', function () {
  var l = allow([{ type: '*', a: 'div\\.hint', reason: 'Hinweis darf das' }]);
  assert.ok(LC.allowedBy(OV, 'x', l));
  assert.throws(function () { allow([{ type: 'overlap', a: 'x' }]); }, /reason/);
  assert.throws(function () { allow([{ type: 'quatsch', a: 'x', reason: 'r' }]); }, /unbekannte Art/);
});

test('classify zaehlt benutzte Eintraege, Rest ist neu', function () {
  var l = allow([{ type: 'overlap', a: 'hint', reason: 'r' }, { type: 'clip', a: 'nie', reason: 'r' }]);
  var c = LC.classify('home', { v: [OV, { t: 'clip', a: { p: 'div.x', s: 'x', r: [0, 0, 5, 5] }, r: [0, 0, 5, 5] }] }, l);
  assert.strictEqual(c.ok.length, 1); assert.strictEqual(c.fail.length, 1);
  assert.strictEqual(l[0].used, 1); assert.ok(!l[1].used);
});

test('Ausschnitt: Rahmen in Rot um die Problemstelle, kleine Ausschnitte doppelt gross', function () {
  var img = { w: 200, h: 100, px: Buffer.alloc(200 * 100 * 4) };
  var c = LC.crop(img, { t: 'clip', a: { r: [40, 40, 20, 10] }, r: [40, 40, 20, 10] }, 10);
  assert.strictEqual(c.w, 40 * 2); assert.strictEqual(c.h, 30 * 2);
  var o = (10 * 2 * c.w + 10 * 2) * 4;                    // linke obere Ecke der Problemstelle
  assert.deepStrictEqual([c.px[o], c.px[o + 1], c.px[o + 2]], [255, 40, 40]);
});

test('die mitgelieferte Erlaubnisliste ist gueltig und jeder Eintrag begruendet', function () {
  var l = LC.loadAllow();
  l.forEach(function (e) { assert.ok(e.reason.length >= 10, 'Begruendung zu kurz: ' + JSON.stringify(e)); });
});
