'use strict';
/* Tastenhinweise (settings.hints, SPEC NAV-14) und Uhr auf der Startseite (settings.clockStyle, HOME-10): Modus-Logik ohne DOM,
 * Ausblend-Timer mit kuenstlicher Zeit, Weckruf ueber router.key, Rueckfallwerte, Datumszeile de/en. */
var test = require('node:test'), assert = require('node:assert');
var H = require('./helpers/load');

function fresh(settings) {
  var ctx = H.load({ fakeTimers: true }), N = ctx.N;
  N.session = { profile: settings ? { uuid: 'p' } : null, settings: settings || null };
  N.ui.hints.el = { className: '' };                           // Leiste ohne DOM: nur die Klasse zaehlt
  return { N: N, T: ctx.timers, hid: function () { return /\bhid\b/.test(N.ui.hints.el.className); } };
}

test('Tastenhinweise: Standard und unbekannte Werte = immer; ohne Profil immer', function () {
  assert.strictEqual(fresh({}).N.ui.hints.mode(), 'always');
  assert.strictEqual(fresh({ hints: 'kaputt' }).N.ui.hints.mode(), 'always');
  assert.strictEqual(fresh(null).N.ui.hints.mode(), 'always');
  assert.strictEqual(fresh({ hints: 'brief' }).N.ui.hints.mode(), 'brief');
  var f = fresh({ hints: 'always' });
  f.N.ui.hints.wake(); f.T.tick(10000);
  assert.ok(!f.hid(), 'immer: bleibt sichtbar');
});

test('Nur kurz: Weckruf zeigt die Leiste, nach 4 s weg; erneuter Weckruf verlaengert', function () {
  var f = fresh({ hints: 'brief' }), Hn = f.N.ui.hints;
  Hn.wake();
  assert.ok(!f.hid());
  f.T.tick(3000); Hn.wake(); f.T.tick(3000);
  assert.ok(!f.hid(), 'zweiter Weckruf startet den Timer neu');
  f.T.tick(1100);
  assert.ok(f.hid(), 'nach 4 s Ruhe ausgeblendet');
  assert.strictEqual(Hn.hit(1000, 670), null, 'ausgeblendet nicht anklickbar');
});

test('Nur kurz: Farbtasten, INFO und TOOLS wecken, Pfeile und OK nicht', function () {
  var f = fresh({ hints: 'brief' }), N = f.N;
  N.ui.hints.wake(); f.T.tick(5000);
  assert.ok(f.hid());
  N.router.key('DOWN'); N.router.key('ENTER');
  assert.ok(f.hid(), 'Navigation laesst sie aus');
  ['RED', 'GREEN', 'YELLOW', 'BLUE', 'INFO', 'TOOLS'].forEach(function (k) {
    f.T.tick(5000); assert.ok(f.hid());
    N.router.key(k);
    assert.ok(!f.hid(), k + ' weckt');
  });
});

test('Aus: nie sichtbar, auch nicht nach Tasten; Wechsel auf immer wirkt sofort', function () {
  var f = fresh({ hints: 'off' }), N = f.N;
  N.ui.hints.wake(); N.router.key('YELLOW');
  assert.ok(f.hid());
  N.session.settings.hints = 'always';
  N.evt.emit('settings:changed', { key: 'hints', value: 'always' });
  assert.ok(!f.hid());
});

test('Uhr-Stil: bekannte Werte, sonst Kasten; Standardwert box', function () {
  var N = H.load().N, C = N.comfort;
  assert.strictEqual(C.CLOCK_STYLES.join(), 'box,free,date,small');
  assert.strictEqual(C.clockStyle(null), 'box');
  assert.strictEqual(C.clockStyle({ clockStyle: 'neon' }), 'box');
  assert.strictEqual(C.clockStyle({ clockStyle: 'date' }), 'date');
  assert.strictEqual(C.DEFAULTS.clockStyle, 'box');
  assert.strictEqual(C.DEFAULTS.hints, 'always');
});

test('Datumszeile: "Mi., 28. Okt." / "Wed 28 Oct", Maerz/Mai ohne Punkt', function () {
  var N = H.load().N;
  N.i18n.set('de');
  assert.strictEqual(N.fmt.dateShort(new Date(2026, 9, 28)), 'Mi., 28. Okt.');
  assert.strictEqual(N.fmt.dateShort(new Date(2026, 2, 1)), 'So., 1. März');
  N.i18n.set('en');
  assert.strictEqual(N.fmt.dateShort(new Date(2026, 9, 28)), 'Wed 28 Oct');
});

/* Apple Nr. 23/26 (SPEC NAV-16): bei Finger/Maus/Trackpad keine Hinweisleiste; Zurueck-Knopf fuer Ansichten mit scr.backBtn */
function direct(mode) {
  var ctx = H.load(), N = ctx.N;
  ctx.document = { body: { className: '' } };
  N.platform.caps.focusRing = 'keys'; N.platform.caps.touch = true;
  N.input.init(); N.input.set(mode);
  return N;
}
var CARD = [{ k: 'red', t: 'hint.hide' }, { k: 'yellow', t: 'hint.markWatched' }, { k: 'blue', t: 'hint.search' }, { k: 'INFO', t: 'hint.details' }, { k: 'ret', t: 'hint.back' }];
test('Hinweisleiste Finger/Maus: ganz weg; Tastatur und TV unveraendert (dieselbe Liste)', function () {
  ['touch', 'pointer'].forEach(function (m) {
    var Hn = direct(m).ui.hints;
    assert.strictEqual(Hn.pick(CARD).length, 0, m);
    assert.strictEqual(Hn.pick([{ k: 'ret', t: 'hint.cancel' }, { k: 'green', t: 'hint.newCode' }]).length, 0, m + ': auch Dialoge/Anmeldung (echte Knoepfe)');
  });
  assert.strictEqual(direct('key').ui.hints.pick(CARD), CARD, 'Tastatur: dieselbe Liste');
  var tv = H.load().N;                                    // TV: focusRing 'always' -> nie direkt
  tv.input.init(); tv.input.set('touch');
  assert.strictEqual(tv.ui.hints.pick(CARD), CARD, 'TV: unveraendert');
});

test('Zurueck-Knopf: nur Finger/Maus und nur auf Wunsch der Ansicht; Treffer oben links', function () {
  var N = direct('touch'), Hn = N.ui.hints, B = Hn.BACK;
  Hn.back(true);
  assert.ok(Hn.backHit(B.x + 10, B.y + 10));
  assert.ok(!Hn.backHit(400, 300));
  Hn.back(false);
  assert.ok(!Hn.backHit(B.x + 10, B.y + 10), 'Ansicht ohne backBtn');
  N.input.set('key'); Hn.back(true);
  assert.ok(!Hn.backHit(B.x + 10, B.y + 10), 'Tastatur: RETURN statt Knopf');
});

test('Hinweisleiste: Wechsel der Eingabeart holt die Liste der Ansicht neu (router.refreshHints)', function () {
  var N = direct('touch'), n = 0;
  N.ui.hints.el = { className: '' };
  N.router.refreshHints = function () { n++; };
  N.input.set('key');
  assert.strictEqual(n, 1);
  N.input.set('key');
  assert.strictEqual(n, 1, 'gleiche Art: nichts');
});

test('Rueckgaengig-Toast: Finger/Maus antippen = dieselbe Taste (Gelb bzw. Rot), Text "Tippen"; Tastatur/TV nicht', function () {
  var N = direct('touch'), T = N.ui.toast, keys = [];
  T.el = { className: '', offsetLeft: 144, offsetTop: 568, offsetWidth: 400, offsetHeight: 56 };
  T.ic = {}; T.txt = {}; N.ui.setIcon = function () {}; N.util.setText = function () {};
  N.router.key = function (k) { keys.push(k); };
  assert.strictEqual(T.tapSuffix(), 'Tap');
  T.show('x', { undo: true });
  assert.strictEqual(T.tap(10, 10), false, 'daneben');
  assert.strictEqual(T.tap(200, 590), true);
  T.show('x', { undo: true, undoKey: 'RED' }); T.tap(200, 590);
  T.show('x', {}); assert.strictEqual(T.tap(200, 590), false, 'ohne Rueckgaengig');
  assert.deepStrictEqual(keys, ['YELLOW', 'RED']);
  N.input.set('key');
  T.show('x', { undo: true });
  assert.strictEqual(T.tap(200, 590), false, 'Tastatur: Farbtaste');
  assert.strictEqual(T.tapSuffix(), '');
  T.hide();
});

test('Computer ohne Hinweisleiste (caps.hintBar false, NAV-25): Modus immer "aus", auch mit Tasten und Profil-Einstellung', function () {
  var f = fresh({ hints: 'always' }), N = f.N;
  assert.strictEqual(N.platform.caps.hintBar, true, 'Standard (TV): Leiste da');
  N.platform.caps.hintBar = false;
  assert.strictEqual(N.ui.hints.mode(), 'off');
  N.ui.hints.wake();
  assert.ok(f.hid(), 'Leiste versteckt');
  assert.strictEqual(N.ui.hints.hit(1000, 670), null, 'nicht anklickbar');
  N.platform.caps.hintBar = true;
  assert.strictEqual(N.ui.hints.mode(), 'always', 'ohne die Faehigkeit wie bisher');
});
