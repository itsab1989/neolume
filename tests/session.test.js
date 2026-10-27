'use strict';
var test = require('node:test'), assert = require('node:assert');
var H = require('./helpers/load'), S = H.synthetic;

function setup(files) {
  var ctx = H.load({ fakeTimers: true }), N = ctx.N, T = ctx.timers, disk = {}, writes = [];
  for (var k in files || {}) disk[k] = files[k];
  N.store.init({ read: function (n) { return disk[n] === undefined ? null : disk[n]; }, write: function (n, t) { disk[n] = t; writes.push(n); } });
  var x = H.FakeXHR(function () { throw new Error('kein Netz erwartet'); });
  N.http._setFactory(x.factory);
  return { N: N, T: T, disk: disk, writes: writes, xhr: x.log };
}
function users() { return JSON.parse(JSON.stringify(H.load().N.auth.normUsers(S('home-users.json')))); }
function state(extra) {
  var st = { v: 1, clientId: 'c', account: { token: 'ACC' }, server: { uri: 'http://pms:32400', machineId: 'm', name: 'S', token: 'ST' },
    users: users(), usersTs: 1, profiles: {}, lastProfile: null, lang: 'de', pinSwitch: null, protectRemindAt: 0, firstPicker: false };
  for (var k in extra || {}) st[k] = extra[k];
  return JSON.stringify(st);
}

test('Migration aus Meilenstein 1: device.json + auth.json werden uebernommen (kein Neu-Login)', function () {
  var s = setup({ 'device.json': '{"id":"plexneo-old"}', 'auth.json': '{"token":"OLDTOK","ts":1}' });
  var st = s.N.session.load();
  assert.strictEqual(st.clientId, 'plexneo-old');
  assert.strictEqual(st.account.token, 'OLDTOK');
  assert.strictEqual(s.N.session.startRoute().route, 'setup');       // Profile/Server einmalig von plex.tv
  var t = setup({}); t.N.session.load();
  assert.strictEqual(t.N.session.startRoute().route, 'login');
});

test('Start-Regeln (7.15.4): mehrere Profile -> immer Profilwahl', function () {
  var s = setup({ 'state.json': state({ lastProfile: 'bbbb2222', profiles: { bbbb2222: { serverToken: 'K' } } }) });
  s.N.session.load();
  // Hauptkonto hat PIN + Kinderprofile -> "Profilwechsel nur mit PIN" ist Standard an -> direkt ins Kinderprofil
  assert.strictEqual(s.N.session.pinSwitchOn(), true);
  var r = s.N.session.startRoute();
  assert.strictEqual(r.route, 'home'); assert.strictEqual(r.user.uuid, 'bbbb2222');
});

test('Start-Regeln: Erwachsener zuletzt bzw. Schalter aus -> Profilwahl', function () {
  var s = setup({ 'state.json': state({ lastProfile: 'aaaa1111', profiles: { aaaa1111: { serverToken: 'K' } } }) });
  s.N.session.load();
  assert.strictEqual(s.N.session.startRoute().route, 'profiles');
  var t = setup({ 'state.json': state({ lastProfile: 'bbbb2222', pinSwitch: false, profiles: { bbbb2222: { serverToken: 'K' } } }) });
  t.N.session.load();
  assert.strictEqual(t.N.session.startRoute().route, 'profiles');
});

test('Start-Regeln: nur ein Profil ohne PIN mit gecachtem Token -> direkt Home, ohne plex.tv', function () {
  var one = [{ uuid: 'u1', name: 'Solo', admin: true, restricted: false, pin: false, kind: 'main' }];
  var s = setup({ 'state.json': state({ users: one, profiles: { u1: { serverToken: 'K' } } }) });
  s.N.session.load();
  var r = s.N.session.startRoute();
  assert.strictEqual(r.route, 'home');
  var tok = null;
  s.N.session.tokenFor(r.user, null, function (e, t) { tok = t; });
  assert.strictEqual(tok, 'K');
  assert.strictEqual(s.xhr.opened.length, 0);
});

test('PIN-Profile verlangen jedes Mal plex.tv (Token wird nicht ohne PIN herausgegeben)', function () {
  var s = setup({ 'state.json': state({ profiles: { cccc3333: { serverToken: 'K' } } }) });
  s.N.session.load();
  var calls = [];
  s.N.auth.switchUser = function (acc, uuid, pin, cb) { calls.push([acc, uuid, pin]); cb({ wrongPin: true }); };
  var err = null;
  s.N.session.tokenFor(s.N.session.user('cccc3333'), '0000', function (e) { err = e; });
  assert.ok(err.wrongPin);
  H.eq(calls, [['ACC', 'cccc3333', '0000']]);
});

test('Hinweis "Erwachsenenprofile schuetzen?" nur ohne Hauptkonto-PIN, max. 1x pro Woche', function () {
  var u = users(); u[0].pin = false;
  var s = setup({ 'state.json': state({ users: u }) });
  s.N.session.load();
  assert.strictEqual(s.N.session.needsProtectHint(1000), true);
  assert.strictEqual(s.N.session.pinSwitchAvailable(), false);
  assert.strictEqual(s.N.session.pinSwitchOn(), false);
  s.N.session.state.protectRemindAt = 1000 + 7 * 86400000;
  assert.strictEqual(s.N.session.needsProtectHint(2000), false);
  var t = setup({ 'state.json': state() }); t.N.session.load();
  assert.strictEqual(t.N.session.needsProtectHint(1000), false);
});

test('Speichern ist entprellt (>= 2 s Ruhe), flush schreibt sofort', function () {
  var s = setup({ 'state.json': state() });
  s.N.session.load();
  s.N.store.set('settings-x.json', { a: 1 });
  s.N.store.set('settings-x.json', { a: 2 });
  s.T.tick(1500);
  assert.deepStrictEqual(s.writes, []);
  s.N.idle.touch(); s.T.tick(600);
  assert.deepStrictEqual(s.writes, []);             // Taste waehrend des Wartens -> spaeter
  s.T.tick(2500);
  assert.deepStrictEqual(s.writes, ['settings-x.json']);
  assert.strictEqual(s.disk['settings-x.json'], '{"a":2}');
  s.N.store.set('state.json', { v: 9 }); s.N.store.flush();
  assert.strictEqual(s.writes.length, 2);
});

test('Abmelden behaelt Geraete-ID und Sprache, loescht Konto und Alt-Token', function () {
  var s = setup({ 'state.json': state({ lang: 'en' }), 'auth.json': '{"token":"OLD"}' });
  s.N.session.load();
  s.N.session.signOut(); s.N.store.flush();
  var st = JSON.parse(s.disk['state.json']);
  assert.strictEqual(st.account, null); assert.strictEqual(st.clientId, 'c'); assert.strictEqual(st.lang, 'en');
  assert.strictEqual(s.disk['auth.json'], 'null');
  s.N.session.load();
  assert.strictEqual(s.N.session.startRoute().route, 'login');
});

test('Fehlerabbildung: Kinderprofil haengt "Bitte frag einen Erwachsenen." an', function () {
  var N = H.load().N;
  N.i18n.set('de');
  assert.strictEqual(N.errs.kind({ type: 'timeout' }, 'pms'), 'server');
  assert.strictEqual(N.errs.kind({ type: 'network' }, 'tv'), 'proxy');
  assert.strictEqual(N.errs.kind({ type: 'http', status: 401 }, 'pms'), 'auth');
  assert.ok(/Bitte frag einen Erwachsenen\.$/.test(N.errs.texts('server', { server: 'X', n: 5 }, true).text));
  assert.ok(!/Erwachsenen/.test(N.errs.texts('server', { server: 'X', n: 5 }, false).text));
});

/* Review M2 (M3/M4/M5) */
test('Neue PIN laut frischer Profil-Liste: gecachtes Token wird nicht mehr ohne PIN herausgegeben', function () {
  var s = setup({ 'state.json': state({ profiles: { bbbb2222: { serverToken: 'KID' } } }) });
  var S = s.N.session; S.load();
  var fresh = users(); fresh[1].pin = true;                      // Kim hat jetzt eine PIN
  var homeCalls = 0;
  s.N.auth.homeUsers = function (tok, cb) { homeCalls++; cb(null, fresh); };
  var got = null;
  S.refreshUsers(true, function (u) { got = u; });
  assert.ok(got); assert.strictEqual(S.user('bbbb2222').pin, true);
  S.refreshUsers(true);                                          // hoechstens alle 30 s
  assert.strictEqual(homeCalls, 1);
  s.T.tick(31000); S.refreshUsers(true);
  assert.strictEqual(homeCalls, 2);
  var calls = [];
  s.N.auth.switchUser = function (acc, uuid, pin, cb) { calls.push(pin); cb({ wrongPin: true }); };
  var tok = 'none';
  S.tokenFor(S.user('bbbb2222'), null, function (e, t) { tok = t; });
  assert.strictEqual(calls.length, 1); assert.strictEqual(tok, undefined);
});
test('Profil-Liste ohne force hoechstens 1x am Tag', function () {
  var s = setup({ 'state.json': state({ usersTs: 1000000 }) });
  var S = s.N.session; S.load();
  var n = 0; s.N.auth.homeUsers = function (tok, cb) { n++; cb(null, users()); };
  S.refreshUsersLater(); assert.strictEqual(n, 0);
  s.T.tick(86400001); S.refreshUsersLater(); assert.strictEqual(n, 1);
});
test('PMS-401: nur das Token dieses Profils verwerfen, Konto bleibt angemeldet', function () {
  var s = setup({ 'state.json': state({ profiles: { aaaa1111: { serverToken: 'A' }, bbbb2222: { serverToken: 'K' } } }) });
  var S = s.N.session; S.load();
  S.dropToken('bbbb2222');
  assert.ok(S.signedIn());
  assert.strictEqual(S.cachedToken(S.user('bbbb2222')), null);
  assert.strictEqual(S.cachedToken(S.user('aaaa1111')), 'A');
  var asked = [];
  s.N.auth.switchUser = function (acc, uuid, pin, cb) { asked.push(uuid); cb(null, 'UT'); };
  s.N.auth.serverTokenFor = function (ut, mid, cb) { cb(null, 'NEWK'); };
  var tok = null;
  S.tokenFor(S.user('bbbb2222'), null, function (e, t) { tok = t; });
  assert.strictEqual(tok, 'NEWK'); H.eq(asked, ['bbbb2222']);
});
test('Konto-Aktionen nur im Hauptkonto-Profil; verwaltete Konten ohne Kinder-Profil sind keine Kinder', function () {
  var u = users(); u.push({ id: 9, uuid: 'hhhh', name: 'Robin', admin: false, restricted: true, rp: '', pin: false, kind: '' });
  var s = setup({ 'state.json': state({ users: u }) });
  var S = s.N.session; S.load();
  S.profile = S.user('hhhh');
  assert.strictEqual(S.isKid(), false); assert.strictEqual(S.isAdmin(), false);
  S.profile = S.user('aaaa1111');
  assert.strictEqual(S.isAdmin(), true);
  S.profile = S.user('bbbb2222');
  assert.strictEqual(S.isKid(), true); assert.strictEqual(S.isAdmin(), false);
});
