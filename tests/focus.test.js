'use strict';
var test = require('node:test'), assert = require('node:assert');
var H = require('./helpers/load');

function setup() {
  var ctx = H.load({ fakeTimers: true }), N = ctx.N, T = ctx.timers;
  N.router._reset(T.now);
  N.ui.hints = { el: null, set: function () {}, refresh: function () {} };   // ohne DOM
  N.ui.rail = { el: null, isOpen: function () { return false; } };
  var log = [];
  function screen(name, back) {
    return function (params) {
      var s = { keys: [], created: 0, destroyed: 0 };
      s.create = function () { s.created++; log.push('create ' + name); };
      s.enter = function (p, restore) { s.restore = restore; log.push('enter ' + name + (restore ? ' restore=' + restore.f : '')); };
      s.leave = function () { log.push('leave ' + name); return { f: s.f || 0 }; };
      s.destroy = function () { s.destroyed++; log.push('destroy ' + name); };
      s.onKey = function (k, fast) { s.keys.push(k + (fast ? '!' : '')); if (k === 'RIGHT') s.f = (s.f || 0) + 1; return k !== 'RETURN' || !back; };
      return s;
    };
  }
  ['a', 'b', 'c', 'd'].forEach(function (n) { N.router.define(n, screen(n, true)); });
  N.router.define('home', screen('home', false));
  return { N: N, T: T, log: log };
}

test('RETURN geht genau eine Ebene zurueck und stellt den Fokus wieder her', function () {
  var s = setup(), R = s.N.router;
  R.reset('a'); s.T.tick(500);
  R.key('RIGHT'); s.T.tick(500); R.key('RIGHT');
  R.push('b');
  assert.strictEqual(R.topName(), 'b');
  R.key('RETURN');
  assert.strictEqual(R.topName(), 'a');
  assert.ok(s.log.indexOf('enter a restore=2') >= 0, s.log.join(' | '));
});

test('Bildschirm behandelt RETURN selbst (z. B. Start-Kette) – Router geht dann nicht zurueck', function () {
  var s = setup(), R = s.N.router;
  R.reset('a'); R.push('home');
  R.key('RETURN');
  assert.strictEqual(R.topName(), 'home');
  assert.deepStrictEqual(R.top().keys.slice(), ['RETURN']);
});

test('Overlay faengt Tasten; RETURN schliesst zuerst das oberste Overlay', function () {
  var s = setup(), R = s.N.router, got = [], cancelled = 0;
  R.reset('a');
  var ov = { el: { parentNode: null }, onKey: function (k) { got.push(k); return k !== 'RETURN'; }, cancel: function () { cancelled++; R.closeOverlay(ov); } };
  R.openOverlay(ov);
  R.key('DOWN'); R.key('RETURN');
  assert.deepStrictEqual(got, ['DOWN', 'RETURN']);
  assert.strictEqual(cancelled, 1);
  assert.ok(!R.hasOverlay());
  assert.deepStrictEqual(R.top().keys.slice(), []);        // Bildschirm hat nichts bekommen
  R.key('RETURN');                                       // jetzt erst der Bildschirm (a: nicht behandelt, nur 1 Ebene)
  assert.strictEqual(R.topName(), 'a');
});

test('Wiederholungs-Drossel: < 120 ms verworfen, < 200 ms = fast (ohne Uebergaenge)', function () {
  var s = setup(), R = s.N.router;
  R.reset('a');
  s.T.tick(1000);
  assert.strictEqual(R.key('RIGHT'), true);
  s.T.tick(60);
  assert.strictEqual(R.key('RIGHT'), false);             // verworfen
  s.T.tick(90);                                          // 150 ms seit dem letzten verarbeiteten
  assert.strictEqual(R.key('RIGHT'), true);
  s.T.tick(400);
  R.key('LEFT');
  s.T.tick(10);
  assert.strictEqual(R.key('ENTER'), true);              // OK wird nie gedrosselt
  assert.deepStrictEqual(R.top().keys.slice(), ['RIGHT', 'RIGHT!', 'LEFT', 'ENTER']);
  assert.strictEqual(s.N.fx.isFast(), false);
});

test('Max. 2 Ansichten unter der aktuellen bleiben, tiefere werden zerstoert und aus restore neu gebaut', function () {
  var s = setup(), R = s.N.router;
  R.reset('a'); s.T.tick(500); R.key('RIGHT');
  R.push('b'); R.push('c'); R.push('d');
  assert.ok(s.log.indexOf('destroy a') >= 0);
  assert.ok(s.log.indexOf('destroy b') < 0);
  R.back(); R.back(); R.back();
  assert.strictEqual(R.topName(), 'a');
  assert.strictEqual(s.log.filter(function (l) { return l === 'create a'; }).length, 2);
  assert.ok(s.log.indexOf('enter a restore=1') >= 0);
});

test('reset verwirft das Fokus-Gedaechtnis (Profilwechsel, SPEC 6.3.4)', function () {
  var s = setup(), R = s.N.router;
  R.reset('a'); R.push('b');
  R.reset('home');
  assert.strictEqual(R.depth(), 1);
  assert.strictEqual(R.top().restore, null);
});

test('Index-Navigation: Liste ohne Wrap, Raster (PIN-Block 3x4)', function () {
  var nav = setup().N.nav;
  assert.strictEqual(nav.list(0, 3, 'LEFT', false), -1);
  assert.strictEqual(nav.list(0, 3, 'RIGHT', false), 1);
  assert.strictEqual(nav.list(2, 3, 'RIGHT', false), -1);
  assert.strictEqual(nav.list(1, 3, 'UP', true), 0);
  assert.strictEqual(nav.list(1, 3, 'LEFT', true), -1);
  assert.strictEqual(nav.grid(4, 12, 3, 'UP'), 1);
  assert.strictEqual(nav.grid(4, 12, 3, 'DOWN'), 7);
  assert.strictEqual(nav.grid(9, 12, 3, 'LEFT'), -1);
  assert.strictEqual(nav.grid(11, 12, 3, 'DOWN'), -1);
  assert.strictEqual(nav.grid(3, 5, 3, 'DOWN'), -1);
  assert.strictEqual(nav.grid(1, 5, 3, 'DOWN'), 4);
  assert.strictEqual(nav.grid(2, 5, 3, 'DOWN'), 4);       // in unvollstaendige Zeile -> letztes Element
});

test('Seitenleiste: Eintrag des offenen Bildschirms wechselt nicht (navigate -> false), Fokus kommt zurueck (F9)', function () {
  var s = setup(), R = s.N.router;
  ['library', 'settings'].forEach(function (n) { R.define(n, function () { return { onKey: function () { return true; } }; }); });
  R.reset('home'); s.T.tick(500);
  assert.strictEqual(s.N.app.navigate('home'), false);
  assert.strictEqual(s.N.app.navigate('lib-1', { id: 1 }), true); assert.strictEqual(R.topName(), 'library');
  assert.strictEqual(s.N.app.navigate('lib-1', { id: 1 }), false);
  assert.strictEqual(s.N.app.navigate('lib-2', { id: 2 }), true);
  assert.strictEqual(s.N.app.navigate('settings'), true); assert.strictEqual(s.N.app.navigate('settings'), false);
  assert.strictEqual(s.N.app.navigate('home'), true); assert.strictEqual(R.topName(), 'home');
});

test('401 in einer Ansicht (Pentest P6): Kinderprofil mit PIN-Schalter -> Startseite, sonst Profilwahl; Token verworfen', function () {
  var s = setup(), N = s.N, R = N.router, dropped = [], kid = true;
  R.define('profiles', function () { return { onKey: function () { return true; } }; });
  N.session.profile = { uuid: 'k1' };
  N.session.dropToken = function (u) { dropped.push(u); };
  N.session.isKid = function () { return kid; }; N.session.pinSwitchOn = function () { return true; };
  R.reset('a'); s.T.tick(500);
  N.app.authLost(); s.T.tick(500);
  assert.strictEqual(R.topName(), 'home'); H.eq(dropped, ['k1']);
  kid = false; R.reset('a'); s.T.tick(500);
  N.app.authLost(); s.T.tick(500);
  assert.strictEqual(R.topName(), 'profiles');
});

test('Toast (NAV-10): unten links; Bildschirm mit toastLow (Einstellungen) -> tiefer unter der Beschreibung; Option low gewinnt', function () {
  var s = setup(), N = s.N, R = N.router, T = N.ui.toast, icon = N.ui.setIcon;
  T.el = { className: '' }; T.txt = { nodeValue: '' }; T.ic = {};
  N.ui.setIcon = function () {};
  try {
    R.reset('a');
    T.show('x'); assert.strictEqual(T.el.className, 'on');
    R.top().toastLow = true;
    T.show('y'); assert.ok(/(^| )low( |$)/.test(T.el.className), T.el.className);
    T.show('z', { low: false }); assert.ok(!/(^| )low( |$)/.test(T.el.className), T.el.className);
    T.hide();
  } finally { N.ui.setIcon = icon; T.el = null; }
});
