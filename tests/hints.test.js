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
