'use strict';
/* Smart-Control-Zeiger (TV-Test 26.10.): Drossel mit Vorderflanke, langes Druecken = TOOLS, Hinweisleiste anklickbar */
var test = require('node:test'), assert = require('node:assert');
var H = require('./helpers/load');

function setup() {
  var ctx = H.load({ fakeTimers: true }), N = ctx.N, T = ctx.timers;
  var hints = N.ui.hints;
  N.router._reset(T.now);
  N.ui.hints = { el: null, set: function () {}, refresh: function () {}, hit: function (x, y) { return y >= 650 ? 'INFO' : null; } };
  N.ui.rail = { el: null, isOpen: function () { return false; }, attached: function () { return false; } };
  var s = { keys: [], ptr: [] };
  N.router.define('x', function () {
    return { create: function () {}, onKey: function (k) { s.keys.push(k); return true; },
      pointer: function (x, y, kind) { s.ptr.push(kind + '@' + x + ',' + y); return true; } };
  });
  N.router.reset('x');
  return { N: N, T: T, s: s, realHints: hints };
}

test('Drossel: erste Bewegung sofort, dann hoechstens alle 40 ms, letzte gewinnt', function () {
  var c = setup(), T = c.T, n = 0;
  var th = new c.N.pointer.Throttle(40, function () { n++; }, { now: T.now, set: T.setTimeout, clear: T.clearTimeout });
  th.hit(); assert.strictEqual(n, 1);                         // Vorderflanke: ohne Wartezeit
  T.tick(10); th.hit(); T.tick(10); th.hit(); assert.strictEqual(n, 1);
  T.tick(20); assert.strictEqual(n, 2);                       // ein Nachlauf am Ende des 40-ms-Fensters
  T.tick(100); th.hit(); assert.strictEqual(n, 3);            // nach Ruhe wieder sofort
  th.hit(); th.cancel(); T.tick(100); assert.strictEqual(n, 3);
});

test('Langes Druecken (>= 800 ms) = TOOLS fuer das Element unter dem Punkt; der folgende Klick entfaellt', function () {
  var c = setup(), P = c.N.pointer;
  P.down(300, 400); c.T.tick(799);
  assert.deepStrictEqual(c.s.keys, []);
  c.T.tick(1);
  assert.deepStrictEqual(c.s.ptr.slice(), ['move@300,400']);
  assert.deepStrictEqual(c.s.keys.slice(), ['TOOLS']);
  P.up(); P.click(300, 400, null);
  assert.deepStrictEqual(c.s.ptr.slice(), ['move@300,400']);   // kein OK hinterher
  P.down(300, 400); c.T.tick(300); P.up(); P.click(300, 400, null);   // kurzer Druck = normaler Klick
  assert.deepStrictEqual(c.s.ptr.slice(1), ['move@300,400', 'click@300,400']);
  assert.deepStrictEqual(c.s.keys.slice(), ['TOOLS']);
});

test('Klick auf die Hinweisleiste = diese Taste (Bildschirm bekommt keinen Zeiger-Klick)', function () {
  var c = setup(), P = c.N.pointer;
  P.click(1100, 668, null);
  assert.deepStrictEqual(c.s.keys.slice(), ['INFO']);
  assert.strictEqual(c.s.ptr.length, 0);
});

test('Hinweisleiste: Treffer per Rechteck-Mathe, Farbtasten/RETURN/INFO/TOOLS abgebildet', function () {
  var c = setup(), Hh = c.realHints;
  Hh.list = [{ k: 'yellow' }, { k: 'ret' }, { k: 'TOOLS' }, { k: 'DIGITS' }];
  Hh.rects = [{ x: 700, w: 120, k: 'YELLOW' }, { x: 850, w: 100, k: 'RETURN' }, { x: 980, w: 120, k: 'TOOLS' }, { x: 1110, w: 90, k: null }];
  assert.strictEqual(Hh.hit(760, 668), 'YELLOW');
  assert.strictEqual(Hh.hit(900, 660), 'RETURN');
  assert.strictEqual(Hh.hit(1000, 690), 'TOOLS');
  assert.strictEqual(Hh.hit(1150, 668), null);                // Ziffern: keine Taste
  assert.strictEqual(Hh.hit(760, 600), null);                 // oberhalb der Leiste
});
