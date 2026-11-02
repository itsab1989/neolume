'use strict';
/* Info-Symbol der Einstellungen (src/ui/infotip.js, Apple Nr. 28, SPEC SET-9): am TV keine Symbole, nur Finger/Maus treffen;
 * Lage der Blase bleibt im Sicherheitsrand (unter dem Symbol, sonst darueber, sonst die groessere Seite mit Scrollen). */
var test = require('node:test'), assert = require('node:assert');
var H = require('./helpers/load');

function boot(caps) {
  var ctx = H.load(), N = ctx.N;
  ctx.document = { body: { className: '' } };
  if (caps) for (var k in caps) N.platform.caps[k] = caps[k];
  N.input.init();
  return N;
}

test('TV: kein Symbol (kein DOM), keine Trefferflaeche', function () {
  var N = boot(null), IT = N.ui.infotip;
  assert.strictEqual(IT.avail(), false);
  assert.strictEqual(IT.on(), false);
  assert.strictEqual(IT.icon({}), null);
});

test('Apple: Symbole bei Finger und Maus/Trackpad, mit Tasten aus (gleiche Elemente, nur die Klasse wechselt)', function () {
  var N = boot({ focusRing: 'keys', touch: true }), IT = N.ui.infotip;
  assert.strictEqual(IT.avail(), true);
  assert.strictEqual(IT.on(), true);
  N.input.set('pointer'); assert.strictEqual(IT.on(), true);
  N.input.set('key'); assert.strictEqual(IT.on(), false);
  assert.strictEqual(IT.avail(), true, 'Symbole bleiben angelegt');
});

test('Lage: unter dem Symbol mit Pfeil nach oben, rechts buendig im Rand', function () {
  var IT = boot(null).ui.infotip, p = IT.place(1168, 144, 200, 64, 1216, 36, 684);
  assert.strictEqual(p.up, true);
  assert.strictEqual(p.top, 174);
  assert.strictEqual(p.h, 200);
  assert.ok(p.left + IT.PW <= 1216 && p.left >= 64);
  assert.strictEqual(p.left + p.ax, 1168, 'Pfeil zeigt auf das Symbol');
});

test('Lage: unten zu wenig Platz -> darueber; beide zu klein -> groessere Seite, gekappt (scrollt)', function () {
  var IT = boot(null).ui.infotip;
  var p = IT.place(1168, 560, 300, 64, 1216, 36, 684);
  assert.strictEqual(p.up, false);
  assert.strictEqual(p.top + p.h, 560 - 30);
  p = IT.place(400, 300, 900, 64, 1216, 36, 684);
  assert.strictEqual(p.up, true);
  assert.strictEqual(p.h, 684 - 330);
  assert.strictEqual(p.left, 64, 'links im Rand');
  assert.strictEqual(p.left + p.ax, 400);
});
