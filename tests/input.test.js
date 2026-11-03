'use strict';
/* Eingabeart (src/core/input.js, Entscheidung Nr. 14) und die Wege dazu ohne Browser: TV unveraendert (keine Klasse, kein
 * Ereignis), mit caps.focusRing 'keys' Klasse am body nur beim Wechsel; App.press setzt 'key' (via 'touch'/'sys' nicht),
 * Zeiger-Bewegung 'pointer'; Hinweisleiste ohne "Beenden" bei caps.exit false, Beenden-Dialog dann ohne Wirkung;
 * App.pan -> router.pan: oberstes Overlay bzw. Bildschirm, offene Seitenleiste nimmt den Zug selbst (Nr. 24), Ansicht ohne pan() = nichts. */
var test = require('node:test'), assert = require('node:assert');
var H = require('./helpers/load');

function boot(caps) {
  var ctx = H.load(), N = ctx.N, events = [];
  ctx.document = { body: { className: '' } };
  if (caps) for (var k in caps) N.platform.caps[k] = caps[k];
  N.evt.on('input:mode', function (m) { events.push(m); });
  N.input.init();
  return { N: N, ctx: ctx, events: events, body: ctx.document.body };
}

test('TV (Standard focusRing always): Art wird mitgefuehrt (eine Quelle), aber keine Klasse, kein Ereignis', function () {
  var b = boot(null), I = b.N.input;
  assert.strictEqual(b.N.platform.caps.focusRing, 'always');
  assert.strictEqual(I.mode, 'key');
  assert.strictEqual(I.set('pointer'), true);
  assert.strictEqual(I.mode, 'pointer');
  assert.strictEqual(I.set('key'), true);
  assert.strictEqual(b.body.className, '');
  assert.strictEqual(b.events.length, 0);
  assert.strictEqual(I.direct(), false);
});

test('focusRing keys: Start nach Geraet (Touch -> touch, sonst pointer), Klasse nur beim Wechsel', function () {
  var b = boot({ focusRing: 'keys', touch: true }), I = b.N.input;
  assert.strictEqual(I.mode, 'touch');
  assert.strictEqual(b.body.className, 'inp-touch');
  assert.ok(I.direct());
  assert.strictEqual(I.set('touch'), false, 'gleiche Art: nichts');
  assert.strictEqual(I.set('key'), true);
  assert.strictEqual(b.body.className, 'inp-key');
  assert.ok(!I.direct());
  I.set('key'); I.set('key');
  I.set('pointer');
  assert.strictEqual(b.body.className, 'inp-ptr');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(b.events)), ['key', 'pointer']);
  assert.strictEqual(I.set('quatsch'), false);
  var m = boot({ focusRing: 'keys', touch: false });
  assert.strictEqual(m.N.input.mode, 'pointer', 'Mac ohne Touch: Maus');
});

test('App.press: echte Taste = key, via touch = touch, via sys = Art bleibt; Zeiger-Bewegung = pointer', function () {
  var b = boot({ focusRing: 'keys', touch: true }), N = b.N, I = N.input, keys = [];
  N.router.key = function (k) { keys.push(k); };
  b.ctx.App.press('RETURN', 'touch');
  assert.strictEqual(I.mode, 'touch');
  b.ctx.App.press('PAUSE', 'sys');
  assert.strictEqual(I.mode, 'touch', 'Anruf pausiert: kein Fokusrahmen');
  b.ctx.App.press('DOWN');
  assert.strictEqual(I.mode, 'key');
  b.ctx.App.input('touch');
  assert.strictEqual(I.mode, 'touch');
  N.input.set('pointer');                                   // pointer.js: echte Maus-Ereignisse (onMove/onClick/mousedown)
  assert.strictEqual(I.mode, 'pointer');
  assert.strictEqual(keys.join(), 'RETURN,PAUSE,DOWN');
});

test('caps.exit false: Hinweis "Beenden" entfaellt, Beenden-Dialog oeffnet nicht; TV unveraendert', function () {
  var ctx = H.load(), N = ctx.N;
  ctx.document = { createTextNode: function (t) { return { nodeValue: t }; } };
  N.ui.hints.el = { className: '' };
  N.ui.hints.items = [];
  for (var i = 0; i < 5; i++) N.ui.hints.items.push({ root: { style: {} }, k: { style: {} }, kT: {}, kt: { style: {} }, ktT: {}, ktIc: { style: {} }, lb: {} });
  N.util.raf = function () {};
  N.ui.hints.set([{ k: 'ret', t: 'hint.exit' }, { k: 'INFO', t: 'hint.help' }]);
  assert.strictEqual(N.ui.hints.list.length, 2, 'TV: Beenden bleibt');
  N.platform.caps.exit = false;
  N.ui.hints.set([{ k: 'ret', t: 'hint.exit' }, { k: 'INFO', t: 'hint.help' }]);
  assert.strictEqual(JSON.stringify(N.ui.hints.list), JSON.stringify([{ k: 'INFO', t: 'hint.help' }]));
  assert.strictEqual(N.ui.hints.items[1].root.style.display, 'none');
});

test('Beenden-Dialog: mit caps.exit false kein Dialog', function () {
  var N = H.load().N, n = 0;
  var R = N.router, orig = R.openOverlay;
  R.openOverlay = function () { n++; };
  N.platform.caps.exit = false;
  N.ui.dialog.exitApp();
  assert.strictEqual(n, 0);
  R.openOverlay = orig;
});

test('router.pan: Bildschirm nimmt den Zug bis zum Loslassen; ohne pan() nichts; Overlay zuerst; offene Seitenleiste nimmt ihn selbst', function () {
  var N = H.load().N, R = N.router, log = [];
  var scr = { pan: function (e) { log.push('s:' + e.phase); return e.phase !== 'start' || e.y > 100; } };
  R.define('a', function () { return scr; });
  R.define('b', function () { return {}; });
  R.push('a');
  assert.strictEqual(R.pan({ phase: 'start', y: 50 }), false, 'Ansicht lehnt ab');
  assert.strictEqual(R.pan({ phase: 'move' }), false, 'ohne Annahme kein move');
  assert.strictEqual(R.pan({ phase: 'start', y: 200 }), true);
  assert.strictEqual(R.pan({ phase: 'move', dy: 5 }), true);
  assert.strictEqual(R.pan({ phase: 'end', dy: 9 }), true);
  assert.strictEqual(R.pan({ phase: 'move' }), false, 'nach dem Ende frei');
  assert.strictEqual(log.join(), 's:start,s:start,s:move,s:end');
  log.length = 0;
  R.push('b');
  assert.strictEqual(R.pan({ phase: 'start', y: 200 }), false, 'Ansicht ohne pan: nichts');
  R.back();
  var ov = { el: {}, pan: function (e) { log.push('o:' + e.phase); return true; } };
  R.openOverlay(ov);
  assert.strictEqual(R.pan({ phase: 'start', y: 200 }), true);
  R.closeOverlay(ov);                                    // Overlay weg mitten im Zug: sauberes Ende (cancel)
  assert.strictEqual(R.pan({ phase: 'move' }), false);
  assert.strictEqual(log.join(), 'o:start,o:end');
  log.length = 0;
  N.ui.rail.isOpen = function () { return true; };
  assert.strictEqual(R.pan({ phase: 'start', y: 200 }), true, 'offene Seitenleiste nimmt den Zug (Nr. 24: waagerecht schiebt sie zu), die Ansicht bekommt nichts');
  assert.strictEqual(log.length, 0);
});

test('router.scrollTop (App.scrollTop, Tipp ganz oben): Overlay zuerst, sonst Bildschirm; ohne scrollTop() oder Seitenleiste offen: false', function () {
  var N = H.load().N, R = N.router, log = [];
  R.define('a', function () { return { scrollTop: function () { log.push('s'); return true; } }; });
  R.define('b', function () { return {}; });
  R.push('a');
  assert.strictEqual(R.scrollTop(), true);
  R.push('b');
  assert.strictEqual(R.scrollTop(), false, 'Ansicht ohne scrollTop');
  R.back();
  var ov = { el: {}, scrollTop: function () { log.push('o'); return false; } };
  R.openOverlay(ov);
  assert.strictEqual(R.scrollTop(), false, 'Overlay entscheidet (steht schon oben)');
  R.closeOverlay(ov);
  N.ui.rail.isOpen = function () { return true; };
  assert.strictEqual(R.scrollTop(), false, 'offene Seitenleiste: nichts');
  assert.strictEqual(log.join(), 's,o');
  assert.strictEqual(typeof N.app.scrollTop, 'function');
});
