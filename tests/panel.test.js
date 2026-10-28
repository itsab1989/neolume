/* N.ui.panel – Mehrfachauswahl mit Abschluss-Eintrag (Option done), Hinweiszeile, RETURN = abbrechen; alte Mehrfachauswahl
 * (ohne done) unveraendert: RETURN = fertig. Panel "laedt" (wait). Kleine DOM-Attrappe, keine Darstellung. */
'use strict';
var test = require('node:test'), assert = require('assert');
var H = require('./helpers/load');

function setup() {
  var c = H.load(), N = c.N, ctx = c.ctx || c, ov = [];
  function El(tag) { this.tagName = tag; this.style = {}; this.childNodes = []; this.className = ''; }
  El.prototype.appendChild = function (x) { this.childNodes.push(x); x.parentNode = this; return x; };
  El.prototype.removeChild = function (x) { this.childNodes.splice(this.childNodes.indexOf(x), 1); x.parentNode = null; };
  ctx.document = { createElement: function (t) { return new El(t); }, createTextNode: function (t) { return { nodeValue: t }; } };
  N.i18n.set('de');
  N.router.openOverlay = function (o) { ov.push(o); };
  N.router.closeOverlay = function (o) { var i = ov.indexOf(o); if (i >= 0) ov.splice(i, 1); };
  return { N: N, ov: ov };
}
function texts(el, out) {
  out = out || [];
  (el.childNodes || []).forEach(function (x) { if (x.nodeValue !== undefined) out.push(x.nodeValue); else texts(x, out); });
  return out;
}
function has(el, c) { return (' ' + el.className + ' ').indexOf(' ' + c + ' ') >= 0; }

test('Mehrfachauswahl mit done: OK schaltet nur um, Abschluss "(n)" schickt, gedimmt unter min, RETURN = abbrechen', function () {
  var s = setup(), N = s.N, done = [], cancel = 0;
  var e = [{ id: 'a', t: 'A', on: false }, { id: 'b', t: 'B', on: false }];
  var p = N.ui.panel.select({ title: 'T', multi: true, entries: e, hint: 'OK: an/aus', focus: 0,
    done: { min: 1, t: function (n) { return 'Los (' + n + ') ›'; }, s: function (n, ok) { return ok ? 'weiter' : 'erst waehlen'; } },
    onDone: function (ids) { done.push(ids); }, onCancel: function () { cancel++; } });
  assert.strictEqual(p.items.length, 3, 'Abschluss als letzter Eintrag');
  assert.ok(texts(p.el).indexOf('OK: an/aus') >= 0, 'Hinweiszeile im Panel');
  assert.ok(has(p.act, 'dis') && texts(p.act).join('|') === 'Los (0) ›|erst waehlen');
  p.onKey('DOWN'); p.onKey('DOWN'); p.onKey('ENTER');      // Abschluss ohne Haken: nichts
  assert.strictEqual(s.ov.length, 1); assert.strictEqual(done.length, 0);
  p.onKey('UP'); p.onKey('ENTER');                         // B an
  assert.strictEqual(s.ov.length, 1, 'OK schaltet nur um');
  assert.ok(!has(p.act, 'dis') && texts(p.act)[0] === 'Los (1) ›');
  H.eq(p.hints().map(function (h) { return h.t; }), ['hint.toggle', 'hint.cancel']);
  assert.strictEqual(p.onKey('RETURN'), true);
  assert.strictEqual(cancel, 1); assert.strictEqual(done.length, 0, 'RETURN schickt nichts ab');
  assert.strictEqual(s.ov.length, 0);
  p = N.ui.panel.select({ title: 'T', multi: true, entries: e, focus: 2, done: { min: 1, t: function (n) { return n + ''; } }, onDone: function (ids) { done.push(ids); } });
  assert.strictEqual(p.f, 2, 'Fokus auf dem Abschluss');
  p.onKey('ENTER');
  H.eq(done, [['b']]);
});

test('Mehrfachauswahl ohne done (alt): RETURN = fertig mit den Haken', function () {
  var s = setup(), N = s.N, done = null;
  var p = N.ui.panel.select({ title: 'T', multi: true, entries: [{ id: 'a', t: 'A', on: true }, { id: 'b', t: 'B', on: false }], onDone: function (ids) { done = ids; } });
  assert.strictEqual(p.items.length, 2);
  p.onKey('ENTER');
  p.onKey('RETURN');
  H.eq(done, []);
});

test('Panel "laedt": RETURN -> onCancel, close() ohne onCancel', function () {
  var s = setup(), N = s.N, c = 0;
  var w = N.ui.panel.wait({ title: 'T', text: 'Wird geladen …', onCancel: function () { c++; } });
  assert.strictEqual(w.onKey('ENTER'), true, 'OK tut nichts');
  assert.strictEqual(w.onKey('RETURN'), false);           // Router ruft dann cancel()
  w.cancel(); assert.strictEqual(c, 1);
  w = N.ui.panel.wait({ title: 'T', onCancel: function () { c++; } });
  w.close(); assert.strictEqual(c, 1); assert.strictEqual(s.ov.length, 0);
});
