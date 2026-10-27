'use strict';
/* P2: setup.json (PMS-only) – Pruefung, Lesen, Profilwechsel ohne plex.tv; eigene App-PIN (PBKDF2-SHA256, Sperre). Ohne Netz. */
var test = require('node:test'), assert = require('node:assert'), crypto = require('crypto');
var H = require('./helpers/load');

/* Beispiel wie installer/README.md (Platzhalter-Adressen aus 10.0.0.0/8, keine echten Daten) */
function cfgObj(over) {
  var o = { schema: 1, kind: 'plexneo-setup', createdAt: '2026-10-26T12:00:00Z', setupVersion: '0.1.0', clientIdentifier: 'plexneo-0123456789abcdef0123',
    server: { machineIdentifier: '0123456789abcdef0123456789abcdef01234567', name: 'Home Server', uris: ['http://10.0.0.20:32400'] },
    profiles: [
      { id: 1, uuid: 'aaaa1111', title: 'Owner', thumb: 'https://plex.tv/users/aaaa1111/avatar?c=1', kind: 'owner', restricted: false, restrictionProfile: '', token: 'OWNERTOKEN0000000001' },
      { id: 2, uuid: 'bbbb2222', title: 'Kid', thumb: '', kind: 'home', restricted: true, restrictionProfile: 'little_kid', token: 'KIDTOKEN000000000002' },
      { id: 3, uuid: 'cccc3333', title: 'Teen', thumb: '', kind: 'home', restricted: true, restrictionProfile: 'teen', token: 'TEENTOKEN00000000003' },
      { id: 4, uuid: 'dddd4444', title: 'Robin', thumb: '', kind: 'home', restricted: true, restrictionProfile: '', token: 'ADULTTOKEN0000000004' },
      { id: 5, uuid: 'eeee5555', title: 'Friend', thumb: '', kind: 'friend', restricted: false, restrictionProfile: '', token: 'FRIENDTOKEN000000005' }],
    computer: { address: '10.0.0.5', updatePort: 32499 } };
  if (over) over(o);
  return o;
}
function txt(over) { return JSON.stringify(cfgObj(over)); }

function setup(files) {
  var ctx = H.load({ fakeTimers: true }), N = ctx.N, T = ctx.timers, disk = {};
  for (var k in files || {}) disk[k] = files[k];
  N.store.init({ read: function (n) { return disk[n] === undefined ? null : disk[n]; }, write: function (n, t) { disk[n] = t; } });
  var x = H.FakeXHR(function (m, u) { throw new Error('kein Netz erwartet: ' + m + ' ' + u); });
  N.http._setFactory(x.factory);
  return { N: N, T: T, disk: disk, xhr: x.log };
}
function pkg(N, over) { var r = N.setupFile.parse(txt(over)); assert.ok(r.ok, r.reason); return r.cfg; }

/* ---------- setup.json pruefen ---------- */
test('setup.json: gueltige Datei -> Server, Profile, Kinder-/Hauptprofil-Kennzeichen', function () {
  var N = H.load().N, r = N.setupFile.parse(txt());
  assert.ok(r.ok);
  assert.strictEqual(r.cfg.server.uris[0], 'http://10.0.0.20:32400');
  assert.strictEqual(r.cfg.clientId, 'plexneo-0123456789abcdef0123');
  assert.strictEqual(r.cfg.id, '2026-10-26T12:00:00Z|0123456789abcdef0123456789abcdef01234567');
  var u = N.setupFile.users(r.cfg, function () { return false; });
  H.eq(u.map(function (x) { return [x.uuid, x.kind, x.admin]; }),
    [['aaaa1111', 'main', true], ['bbbb2222', 'kid', false], ['cccc3333', 'teen', false], ['dddd4444', '', false], ['eeee5555', '', false]]);
  assert.strictEqual(u[0].thumb, 'https://plex.tv/users/aaaa1111/avatar?c=1');
});

test('setup.json: kaputte Dateien werden abgelehnt (Grund fuer die Meldung)', function () {
  var N = H.load().N;
  function why(t) { var r = N.setupFile.parse(t); assert.strictEqual(r.ok, false); return r.reason; }
  // einzelnes fehlerhaftes Profil: uebersprungen (Grund in cfg.skipped), die uebrigen Profile gelten (TV-Test 27.10.)
  function skip(t) { var r = N.setupFile.parse(t); assert.ok(r.ok, r.reason); assert.strictEqual(r.cfg.profiles.length, 4); return r.cfg.skipped[0]; }
  assert.strictEqual(why('{kaputt'), 'json');
  assert.strictEqual(why(''), 'json');
  assert.strictEqual(why('[]'), 'kind');
  assert.strictEqual(why(txt(function (o) { o.kind = 'x'; })), 'kind');
  assert.strictEqual(why(txt(function (o) { o.schema = 2; })), 'newer');
  assert.strictEqual(why(txt(function (o) { o.schema = '1'; })), 'schema');
  assert.strictEqual(why(txt(function (o) { delete o.server.machineIdentifier; })), 'server');
  assert.strictEqual(why(txt(function (o) { o.profiles = []; })), 'profiles');
  assert.strictEqual(skip(txt(function (o) { delete o.profiles[1].token; })), 'token');
  assert.strictEqual(skip(txt(function (o) { o.profiles[1].token = ''; })), 'token');
  assert.strictEqual(skip(txt(function (o) { o.profiles[1].token = 'abc'; })), 'token');
  assert.strictEqual(skip(txt(function (o) { o.profiles[1].token = 'TOKEN with space 1234'; })), 'token');
  assert.strictEqual(skip(txt(function (o) { o.profiles[1].kind = 'admin'; })), 'profile');
  assert.strictEqual(skip(txt(function (o) { o.profiles[1].title = ''; })), 'profile');
  assert.strictEqual(skip(txt(function (o) { o.profiles[1].uuid = 'aaaa1111'; })), 'dup');
  assert.strictEqual(skip(txt(function (o) { o.profiles[4].uuid = ''; })), 'profile');        // Freund ohne uuid (aelteres Einrichtungsprogramm)
  assert.strictEqual(why(txt(function (o) { o.profiles = [o.profiles[4]]; o.profiles[0].uuid = ''; })), 'profile');   // kein gueltiges Profil uebrig
  assert.strictEqual(why(txt(function (o) { o.profiles[1].kind = 'owner'; })), 'owner');
});

test('setup.json: nur http-Adressen im Heimnetz (Token geht unverschluesselt an den PMS)', function () {
  var N = H.load().N;
  function why(uris) { var r = N.setupFile.parse(txt(function (o) { o.server.uris = uris; })); return r.ok ? r.cfg.server.uris : r.reason; }
  assert.strictEqual(why(['http://198.51.100.7:32400']), 'uri');                 // oeffentlich
  assert.strictEqual(why(['https://10.0.0.20:32400']), 'uri');                   // https kann der TV nicht
  assert.strictEqual(why(['http://plex.example.com:32400']), 'uri');             // Namen: koennten nach aussen aufloesen
  assert.strictEqual(why(['http://user@10.0.0.20:32400']), 'uri');
  assert.strictEqual(why(['http://10.0.0.20:32400/?x=1']), 'uri');
  assert.strictEqual(why(['http://10.0.0.300:32400']), 'uri');
  assert.strictEqual(why(['http://172.32.0.1:32400']), 'uri');                   // knapp ausserhalb 172.16/12
  assert.strictEqual(why([]), 'uri');
  H.eq(why(['http://198.51.100.7:32400', 'http://192.168.178.20:32400/', 'http://172.16.1.2:32400', 'http://169.254.1.1:32400']),
    ['http://192.168.178.20:32400', 'http://172.16.1.2:32400', 'http://169.254.1.1:32400']);
  var r = N.setupFile.parse(txt(function (o) { o.computer = { address: '198.51.100.7', updatePort: 32499 }; o.profiles[0].thumb = 'http://evil/x'; }));
  assert.strictEqual(r.cfg.computer, null);
  assert.strictEqual(r.cfg.profiles[0].thumb, '');
});

test('setup.json lesen: Vorschau-Text, Datei fehlt (404/leer/Timeout), file:// (Status 0), ungueltig', function () {
  var N = H.load().N, out = [];
  N.setupFile.read({ setupText: null }, function (c, w) { out.push(['null', c, w]); });
  function viaXhr(status, body, hang) {
    var x = H.FakeXHR(function (m, u) { assert.strictEqual(m, 'GET'); assert.strictEqual(u, 'setup.json'); return hang ? { hang: true } : { status: status, body: body }; });
    return x.factory;
  }
  var res = {};
  N.setupFile.read({}, function (c, w) { res.s404 = [c, w]; }, viaXhr(404, 'not found'));
  N.setupFile.read({}, function (c, w) { res.s0 = [c && c.profiles.length, w]; }, viaXhr(0, txt()));
  N.setupFile.read({}, function (c, w) { res.empty = [c, w]; }, viaXhr(0, ''));
  N.setupFile.read({}, function (c, w) { res.bad = [c, w]; }, viaXhr(200, txt(function (o) { o.schema = 7; })));
  H.eq(out, [['null', null, null]]);
  return new Promise(function (resolve) {
    setTimeout(function () {
      H.eq(res, { s404: [null, null], s0: [5, null], empty: [null, null], bad: [null, 'newer'] });
      resolve();
    }, 20);
  });
});

/* ---------- Session PMS-only ---------- */
test('PMS-only: Profilwahl, Wechsel und Start ohne plex.tv; Tokens nie im Store', function () {
  var s = setup({ 'state.json': JSON.stringify({ v: 1, clientId: 'c-old', account: { token: 'OLD-PLEXTV-ACCOUNT' }, server: null, users: null, usersTs: 0,
    profiles: {}, lastProfile: 'bbbb2222', lang: 'de', pinSwitch: null, protectRemindAt: 0, firstPicker: true }) });
  var N = s.N, S = N.session;
  S.load(pkg(N));
  assert.strictEqual(S.signedIn(), true);
  assert.strictEqual(S.ready(), true);
  assert.strictEqual(N.plex.clientId, 'plexneo-0123456789abcdef0123');
  assert.strictEqual(S.state.server.uri, 'http://10.0.0.20:32400');
  assert.strictEqual(S.state.firstPicker, false);
  var r0 = S.startRoute();                                              // P5 Startprofil, Standard mit setup.json: Hauptprofil ohne PIN
  assert.strictEqual(r0.route, 'home'); assert.strictEqual(r0.user.admin, true);
  S.state.startProfile = 'picker';
  assert.strictEqual(S.startRoute().route, 'profiles');                 // keine App-PIN des Hauptprofils -> kein PIN-Schalter
  S.state.startProfile = 'last';
  assert.strictEqual(S.startRoute().user.uuid, 'bbbb2222');             // zuletzt genutztes Profil (ohne PIN)
  S.state.startProfile = 'picker';
  var got = null;
  S.tokenFor(S.user('bbbb2222'), null, function (e, t) { got = t; });
  assert.strictEqual(got, 'KIDTOKEN000000000002');
  S.activate(S.user('bbbb2222'), got);
  assert.strictEqual(N.plex.token, 'KIDTOKEN000000000002');
  assert.strictEqual(N.plex.base, 'http://10.0.0.20:32400');
  var refreshed = false;
  S.refreshUsers(true, function () { refreshed = true; });
  var tvErr = null;
  N.plex.tv('GET', '/api/v2/user', null, 'x', {}, function (e) { tvErr = e; });
  s.T.tick(10);
  assert.strictEqual(tvErr.type, 'pmsonly');
  assert.strictEqual(refreshed, false);
  assert.strictEqual(s.xhr.opened.length, 0);                          // kein einziger Netzaufruf (plex.tv/Proxy)
  N.store.flush();
  var disk = s.disk['state.json'];
  ['TOKEN0', 'OLD-PLEXTV-ACCOUNT', '10.0.0.20', 'Home Server'].forEach(function (needle) { assert.strictEqual(disk.indexOf(needle), -1, needle); });
  assert.strictEqual(JSON.parse(disk).lastProfile, 'bbbb2222');
  // Neustart: Kinderprofil zuletzt, Hauptprofil ohne App-PIN -> Profilwahl
  var t = setup({ 'state.json': disk }); t.N.session.load(pkg(t.N));
  assert.strictEqual(t.N.session.startRoute().route, 'profiles');
  assert.strictEqual(t.N.session.cachedToken(t.N.session.user('aaaa1111')), 'OWNERTOKEN0000000001');
});

test('PMS-only: ein einziges Profil ohne PIN startet direkt; 401 -> Einrichtung erneut ausfuehren', function () {
  var s = setup({}), N = s.N, S = N.session;
  S.load(pkg(N, function (o) { o.profiles = [o.profiles[0]]; }));
  var r = S.startRoute();
  assert.strictEqual(r.route, 'home');
  S.activate(r.user, S.cachedToken(r.user));
  S.dropToken(r.user.uuid);                                            // PMS meldet 401
  assert.strictEqual(S.setupStale, true);
  var err = null;
  S.tokenFor(r.user, null, function (e) { err = e; });
  assert.strictEqual(err.type, 'setup'); assert.strictEqual(err.authExpired, true);
  assert.strictEqual(s.xhr.opened.length, 0);
});

test('Ohne setup.json bleibt der alte Ablauf (plex.tv-Anmeldung) unveraendert', function () {
  var s = setup({}), S = s.N.session;
  S.load(null);
  assert.strictEqual(S.pkg, null);
  assert.strictEqual(S.startRoute().route, 'login');
});

/* ---------- App-PIN ---------- */
test('SHA-256 und PBKDF2-HMAC-SHA256 (ES5) = Node crypto', function () {
  var N = H.load().N;
  ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'ä€😀', 'x'.repeat(300)].forEach(function (m) {
    assert.strictEqual(N.sha256.hex(m), crypto.createHash('sha256').update(m, 'utf8').digest('hex'), JSON.stringify(m.slice(0, 10)));
  });
  [['1234', '00112233445566778899aabbccddeeff', 1], ['0000', 'ffeeddccbbaa99887766554433221100', 1000], ['p'.repeat(80), 'abcd', 3]].forEach(function (c) {
    assert.strictEqual(N.sha256.pbkdf2(c[0], c[1], c[2]), crypto.pbkdf2Sync(c[0], Buffer.from(c[1], 'hex'), c[2], 32, 'sha256').toString('hex'));
  });
  // RFC 7914 Testvektor (erste 32 Byte)
  assert.strictEqual(N.sha256.pbkdf2('passwd', Buffer.from('salt').toString('hex'), 1), '55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc');
});

test('App-PIN: Rechenzeit 1000 Runden (Desktop << 300 ms; TV-Schaetzung in apppin.js)', function () {
  var N = H.load().N, t0 = Date.now(), n = 10;
  for (var i = 0; i < n; i++) N.appPin.hash('1234', '00112233445566778899aabbccddeeff');
  var ms = (Date.now() - t0) / n;
  assert.ok(N.appPin.ITER >= 1000);
  assert.ok(ms < 60, 'PBKDF2 zu langsam: ' + ms + ' ms');
});

test('App-PIN: nur gesalzene Pruefsumme, Salz je Profil, Pruefen, Entfernen, gehoert zur Einrichtung', function () {
  var s = setup({}), N = s.N, S = N.session;
  S.load(pkg(N));
  var done = [];
  N.appPin.set('aaaa1111', '1234', function (ok) { done.push(ok); });
  N.appPin.set('bbbb2222', '1234', function (ok) { done.push(ok); });
  N.appPin.set('cccc3333', '12a4', function (ok) { done.push(ok); });        // ungueltig: nur 4 Ziffern
  s.T.tick(100);
  H.eq(done, [false, true, true]);
  N.store.flush();
  var raw = s.disk['pins.json'], f = JSON.parse(raw);
  H.eq(Object.keys(f.p.aaaa1111).sort(), ['h', 'i', 's']);                 // nur Salz, Pruefsumme, Runden – keine PIN
  assert.notStrictEqual(f.p.aaaa1111.s, f.p.bbbb2222.s);
  assert.notStrictEqual(f.p.aaaa1111.h, f.p.bbbb2222.h);                    // gleiche PIN, anderes Salz -> andere Pruefsumme
  assert.strictEqual(f.p.aaaa1111.s.length, 32); assert.strictEqual(f.p.aaaa1111.i, 1000);
  assert.strictEqual(f.p.aaaa1111.h, crypto.pbkdf2Sync('1234', Buffer.from(f.p.aaaa1111.s, 'hex'), 1000, 32, 'sha256').toString('hex'));
  var res = [];
  N.appPin.verify('aaaa1111', '1234', function (ok) { res.push(ok); });
  N.appPin.verify('aaaa1111', '1235', function (ok) { res.push(ok); });
  N.appPin.verify('dddd4444', '1234', function (ok) { res.push(ok); });     // ohne PIN
  s.T.tick(100);
  H.eq(res, [true, false, false]);
  S.refreshPins();
  assert.strictEqual(S.user('aaaa1111').pin, true);
  assert.strictEqual(S.pinSwitchOn(), true);                                 // Hauptprofil-PIN + Kinderprofile -> Standard an
  N.appPin.remove('aaaa1111'); S.refreshPins();
  assert.strictEqual(S.user('aaaa1111').pin, false);
  assert.strictEqual(S.pinSwitchAvailable(), false);
  // Neustart mit derselben setup.json -> PINs bleiben
  N.store.flush();
  var t = setup({ 'pins.json': s.disk['pins.json'] });
  t.N.session.load(pkg(t.N));
  assert.strictEqual(t.N.appPin.has('bbbb2222'), true);
  // erneute Einrichtung (neue setup.json, gleicher Server) BEHAELT die PINs (Nutzerentscheidung 26.10. abends)
  var u = setup({ 'pins.json': s.disk['pins.json'] });
  u.N.session.load(pkg(u.N, function (o) { o.createdAt = '2026-11-01T08:00:00Z'; }));
  assert.strictEqual(u.N.appPin.has('bbbb2222'), true);
  assert.strictEqual(u.N.session.user('bbbb2222').pin, true);
  // anderer Server -> PINs gelten dort nicht
  var w = setup({ 'pins.json': s.disk['pins.json'] });
  w.N.session.load(pkg(w.N, function (o) { o.server.machineIdentifier = 'ffffffffffffffffffffffffffffffffffffffff'; }));
  assert.strictEqual(w.N.appPin.has('bbbb2222'), false);
});

test('App-PIN: Kaestchen "App-PINs zuruecksetzen" (resetAppPins) loescht einmal je Einrichtung; altes Dateiformat bleibt gueltig', function () {
  var s = setup({}), N = s.N;
  N.session.load(pkg(N));
  N.appPin.set('aaaa1111', '2580'); N.appPin.set('bbbb2222', '4711'); s.T.tick(100); N.store.flush();
  var before = s.disk['pins.json'];
  function reset(o) { o.createdAt = '2026-11-02T09:00:00Z'; o.resetAppPins = true; }
  assert.strictEqual(N.setupFile.parse(txt(reset)).cfg.resetPins, true);
  assert.strictEqual(N.setupFile.parse(txt(function (o) { o.resetAppPins = 'true'; })).cfg.resetPins, false);   // nur echtes true
  // Einrichtung mit Haken -> alle PINs weg, Schloss-Kennzeichen weg
  var a = setup({ 'pins.json': before });
  a.N.session.load(pkg(a.N, reset));
  assert.strictEqual(a.N.appPin.has('aaaa1111'), false); assert.strictEqual(a.N.appPin.has('bbbb2222'), false);
  assert.strictEqual(a.N.session.user('aaaa1111').pin, false);
  // danach neu gesetzte PIN ueberlebt den naechsten Start mit derselben (zuruecksetzenden) setup.json
  a.N.appPin.set('aaaa1111', '1357'); a.T.tick(100); a.N.store.flush();
  var b = setup({ 'pins.json': a.disk['pins.json'] });
  b.N.session.load(pkg(b.N, reset));
  assert.strictEqual(b.N.appPin.has('aaaa1111'), true);
  var ok = []; b.N.appPin.verify('aaaa1111', '1357', function (r) { ok.push(r); }); b.T.tick(100);
  H.eq(ok, [true]);
  // pins.json im alten Format (setup = "createdAt|machineId") gilt weiter
  var old = JSON.parse(before); old.setup = '2026-10-26T12:00:00Z|' + cfgObj().server.machineIdentifier; delete old.reset;
  var c = setup({ 'pins.json': JSON.stringify(old) });
  c.N.session.load(pkg(c.N, function (o) { o.createdAt = '2026-12-24T18:00:00Z'; }));
  assert.strictEqual(c.N.appPin.has('bbbb2222'), true);
});

test('App-PIN: Profilwechsel mit PIN ohne plex.tv; 5 Fehlversuche -> 30 s Sperre je Profil, ueberlebt Neu-Oeffnen', function () {
  var s = setup({}), N = s.N, S = N.session, T = s.T;
  S.load(pkg(N));
  N.appPin.set('bbbb2222', '4711'); N.appPin.set('aaaa1111', '2580'); T.tick(100); S.refreshPins();
  var kid = S.user('bbbb2222');
  function logic(key, verify) {
    var st = { ok: false };
    var L = new N.PinLogic({ key: key, verify: verify, now: T.now, timers: { set: T.setTimeout, clear: T.clearTimeout },
      onChange: function () {}, onSuccess: function () { st.ok = true; } });
    st.L = L; return st;
  }
  function verifyKid(pin, cb) { S.tokenFor(kid, pin, function (e, tok) { if (e) cb(false, e); else { cb(true); } }); }
  function type(L, pin) { for (var i = 0; i < pin.length; i++) L.input(pin[i]); T.tick(100); }
  var a = logic('bbbb2222', verifyKid);
  for (var i = 0; i < 4; i++) type(a.L, '0000');
  assert.strictEqual(a.L.locked(), false);
  a.L.destroy();
  var b = logic('bbbb2222', verifyKid);                                   // Dialog neu geoeffnet: Zaehler bleibt
  type(b.L, '0000');
  assert.strictEqual(b.L.locked(), true);
  type(b.L, '4711');                                                     // gesperrt: auch richtige PIN wird nicht geprueft
  assert.strictEqual(b.ok, false);
  var c = logic('cccc3333', function (pin, cb) { cb(true); });           // anderes Profil nicht gesperrt
  type(c.L, '1111'); assert.strictEqual(c.ok, true);
  T.tick(30000);
  type(b.L, '4711');
  assert.strictEqual(b.ok, true);
  // Kinderprofil -> Profilwahl nur mit der App-PIN des Hauptprofils
  S.activate(kid, S.cachedToken(kid));
  assert.strictEqual(S.isKid() && S.pinSwitchOn(), true);
  var res = [];
  S.verifyAdminPin('4711', function (ok, err) { res.push([ok, !!(err && err.wrongPin)]); });
  S.verifyAdminPin('2580', function (ok) { res.push([ok]); });
  T.tick(100);
  H.eq(res, [[false, true], [true]]);
  assert.strictEqual(s.xhr.opened.length, 0);
});

test('Einstellungen: Datum der Einrichtung je Sprache', function () {
  var N = H.load().N;
  N.i18n.set('de'); assert.strictEqual(N.pinSettings._day('2026-10-26T12:00:00Z'), '26.10.2026');
  N.i18n.set('en'); assert.strictEqual(N.pinSettings._day('2026-10-26T12:00:00Z'), '2026-10-26');
  assert.strictEqual(N.pinSettings._day(''), '');
});

test('Startprofil (Regel 9) mit setup.json: Standard Hauptprofil auch mit App-PIN; Wahl bleibt nach erneuter Einrichtung; "Zuletzt" nur ohne PIN', function () {
  var s = setup({}), N = s.N, S = N.session;
  S.load(pkg(N));
  assert.strictEqual(S.startProfile(), 'main');
  N.appPin.set('aaaa1111', '2580'); N.appPin.set('bbbb2222', '4711'); s.T.tick(100); S.refreshPins();
  var r = S.startRoute();
  assert.strictEqual(r.route, 'home'); assert.strictEqual(r.user.uuid, 'aaaa1111');   // Nutzerwunsch: Hauptprofil ohne PIN-Abfrage
  S.state.startProfile = 'last'; S.state.lastProfile = 'dddd4444'; S.save(); N.store.flush();
  // erneute Einrichtung (neue setup.json): Einstellung und PINs bleiben
  var t = setup({ 'state.json': s.disk['state.json'], 'pins.json': s.disk['pins.json'] }), T2 = t.N.session;
  T2.load(pkg(t.N, function (o) { o.createdAt = '2026-11-03T10:00:00Z'; }));
  assert.strictEqual(T2.startProfile(), 'last');
  assert.strictEqual(T2.startRoute().user.uuid, 'dddd4444');                          // zuletzt genutzt, ohne PIN
  T2.state.lastProfile = 'bbbb2222';                                                   // Kinderprofil mit App-PIN
  T2.state.pinSwitch = false;
  assert.strictEqual(T2.startRoute().route, 'profiles');                               // mit PIN -> Profilwahl
  assert.ok(String(t.disk['state.json'] || '').indexOf('TOKEN') < 0);                 // Tokens nie im Store
});


test('App-PIN: kaputte pins.json scheitert geschlossen (Pentest P16), localStorage-Kopie wird genutzt, Zuruecksetzen hilft', function () {
  var s = setup({}), N = s.N;
  N.session.load(pkg(N));
  N.appPin.set('aaaa1111', '2580'); s.T.tick(100); N.store.flush();
  var good = s.disk['pins.json'], cut = good.substring(0, 20);          // Strom weg beim Schreiben
  // 1) Datei kaputt, keine Kopie -> alle Profile geschuetzt, keine PIN passt, nichts wird ueberschrieben
  var a = setup({ 'pins.json': cut });
  a.N.session.load(pkg(a.N));
  assert.strictEqual(a.N.appPin.broken(), true);
  assert.strictEqual(a.N.appPin.has('aaaa1111'), true); assert.strictEqual(a.N.appPin.has('dddd4444'), true);
  var r = []; a.N.appPin.verify('aaaa1111', '2580', function (ok) { r.push(ok); });
  a.N.appPin.set('dddd4444', '1111', function (ok) { r.push(ok); }); a.T.tick(100); a.N.store.flush();
  H.eq(r, [false, false]);
  assert.strictEqual(a.disk['pins.json'], cut);
  var t = []; a.N.session.tokenFor(a.N.session.user('dddd4444'), null, function (e, tok) { t.push(e ? e.type : tok); }); a.T.tick(100);
  H.eq(t, ['pin']);
  // 2) Datei kaputt, localStorage-Kopie gut (Lader-probe) -> Kopie gilt
  var b = setup({ 'pins.json': cut });
  b.N.store.init({ read: function () { return cut; }, write: function () {}, probe: function () { return { file: cut, local: good }; } });
  b.N.session.load(pkg(b.N));
  assert.strictEqual(b.N.appPin.broken(), false);
  assert.strictEqual(b.N.appPin.has('aaaa1111'), true); assert.strictEqual(b.N.appPin.has('dddd4444'), false);
  // 3) Einrichtung mit "App-PINs zuruecksetzen" schreibt die Datei neu -> wieder benutzbar
  var c = setup({ 'pins.json': cut });
  c.N.session.load(pkg(c.N, function (o) { o.createdAt = '2026-11-05T10:00:00Z'; o.resetAppPins = true; }));
  assert.strictEqual(c.N.appPin.broken(), false); assert.strictEqual(c.N.appPin.has('aaaa1111'), false);
});

test('Speicher-Schreibfehler (Audit H2): PIN gilt erst nach erfolgreichem Schreiben, Store versucht es erneut', function () {
  var s = setup({}), N = s.N, fail = true, disk = {};
  N.store.init({ fs: {}, read: function (n) { return disk[n] === undefined ? null : disk[n]; },
    write: function (n, t) { if (fail) return false; disk[n] = t; return true; } });
  N.session.load(pkg(N));
  var r = []; N.appPin.set('dddd4444', '1111', function (ok) { r.push(ok); }); s.T.tick(100);
  H.eq(r, [false]);
  assert.strictEqual(N.appPin.has('dddd4444'), false, 'nicht geschriebene PIN gilt nicht');
  fail = false;
  N.appPin.set('dddd4444', '1111', function (ok) { r.push(ok); }); s.T.tick(100);
  H.eq(r, [false, true]);
  assert.ok(/dddd4444/.test(disk['pins.json']));
  fail = true;
  assert.strictEqual(N.appPin.remove('dddd4444'), false);
  assert.strictEqual(N.appPin.has('dddd4444'), true, 'Entfernen nicht geschrieben -> PIN bleibt');
  // andere Datei: Fehler -> bleibt dirty, spaeterer Versuch schreibt sie
  N.store.set('x.json', { a: 1 }); N.store.flush();
  assert.strictEqual(N.store.isDirty(), true);
  fail = false; s.T.tick(70000);
  assert.ok(disk['x.json']);
});
