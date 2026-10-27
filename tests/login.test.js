'use strict';
var test = require('node:test'), assert = require('node:assert');
var H = require('./helpers/load'), S = H.synthetic;

/* LoginFlow mit gemockter API und kuenstlichen Timern */
function flowSetup(api) {
  var ctx = H.load({ fakeTimers: true }), T = ctx.timers, states = [];
  var f = new ctx.N.LoginFlow({ api: api, now: T.now, timers: { set: T.setTimeout, clear: T.clearTimeout }, onChange: function (s) { states.push(s.name + (s.renewed ? '+' : '')); } });
  return { f: f, T: T, states: states };
}

test('Login: Code anfordern, alle 2 s pollen, Token -> authorized; Poll stoppt', function () {
  var polls = 0;
  var api = { createPin: function (cb) { cb(null, { id: 7, code: 'AB12', expiresIn: 900 }); return { abort: function () {} }; },
    checkPin: function (id, cb) { polls++; assert.strictEqual(id, 7); cb(null, polls >= 3 ? 'TOKEN' : null); return { abort: function () {} }; } };
  var s = flowSetup(api);
  s.f.start(false);
  assert.strictEqual(s.f.state.code, 'AB12');
  assert.strictEqual(s.f.secondsLeft(), 900);
  s.T.tick(1999); assert.strictEqual(polls, 0);
  s.T.tick(1); assert.strictEqual(polls, 1);
  s.T.tick(4000);
  assert.strictEqual(polls, 3);
  assert.strictEqual(s.f.state.name, 'authorized');
  assert.strictEqual(s.f.state.token, 'TOKEN');
  s.T.tick(10000); assert.strictEqual(polls, 3);
  assert.deepStrictEqual(s.states, ['requesting', 'waiting', 'authorized']);
});

test('Login: abgelaufener Code -> automatisch neuer Code (kein Fehler)', function () {
  var n = 0;
  var api = { createPin: function (cb) { n++; cb(null, { id: n, code: 'C' + n, expiresIn: 10 }); }, checkPin: function (id, cb) { cb(null, null); } };
  var s = flowSetup(api);
  s.f.start(false);
  s.T.tick(12000);
  assert.strictEqual(n, 2);
  assert.strictEqual(s.f.state.code, 'C2');
  assert.strictEqual(s.f.state.renewed, true);
  assert.ok(s.states.indexOf('error') < 0);
});

test('Login: 404 beim Pollen -> neuer Code; Proxy nicht erreichbar -> Fehler; stop() beendet alles', function () {
  var n = 0, fail = false;
  var api = { createPin: function (cb) { n++; if (fail) cb({ type: 'network', status: 0 }); else cb(null, { id: n, code: 'X' + n, expiresIn: 900 }); },
    checkPin: function (id, cb) { cb(id === 1 ? { type: 'http', status: 404 } : null, null); } };
  var s = flowSetup(api);
  s.f.start(false);
  s.T.tick(2000);
  assert.strictEqual(s.f.state.code, 'X2');
  fail = true; s.f.newCode();
  assert.strictEqual(s.f.state.name, 'error');
  assert.strictEqual(s.f.state.kind, 'proxy');
  fail = false; s.f.start(false); s.f.stop();
  var before = s.T.pending();
  s.T.tick(10000);
  assert.strictEqual(s.T.pending(), 0); assert.ok(before === 0);
});

test('Login: kurzzeitige Poll-Fehler werden toleriert, viele hintereinander -> Fehler', function () {
  var api = { createPin: function (cb) { cb(null, { id: 1, code: 'Q', expiresIn: 900 }); }, checkPin: function (id, cb) { cb({ type: 'timeout', status: 0 }); } };
  var s = flowSetup(api);
  s.f.start(false);
  s.T.tick(2000 * 7);
  assert.strictEqual(s.f.state.name, 'waiting');
  s.T.tick(2000);
  assert.strictEqual(s.f.state.name, 'error');
});

/* PIN-Eingabe */
function pinSetup(verify) {
  var ctx = H.load({ fakeTimers: true }), T = ctx.timers, ok = [];
  var p = new ctx.N.PinLogic({ verify: verify, now: T.now, timers: { set: T.setTimeout, clear: T.clearTimeout }, onSuccess: function (pin) { ok.push(pin); } });
  return { p: p, T: T, ok: ok };
}
test('PIN: 4 Ziffern -> automatische Pruefung; Loeschen; Erfolg', function () {
  var seen = [];
  var s = pinSetup(function (pin, cb) { seen.push(pin); cb(pin === '4711'); });
  s.p.input('4'); s.p.input('7'); s.p.del(); s.p.input('7'); s.p.input('1');
  assert.strictEqual(s.p.s.digits, '471');
  s.p.input('1');
  assert.deepStrictEqual(seen, ['4711']);
  assert.deepStrictEqual(s.ok, ['4711']);
});
test('PIN: falsch -> rot bis zur naechsten Eingabe; 5 Fehlversuche -> 30 s Sperre mit Countdown', function () {
  var s = pinSetup(function (pin, cb) { cb(false, { wrongPin: true }); });
  function wrong() { '1234'.split('').forEach(function (d) { s.p.input(d); }); }
  wrong();
  assert.strictEqual(s.p.s.wrong, true); assert.strictEqual(s.p.s.digits, '1234');
  s.p.input('9');
  assert.strictEqual(s.p.s.wrong, false); assert.strictEqual(s.p.s.digits, '9');
  s.p.del();
  for (var i = 0; i < 4; i++) wrong();
  assert.ok(s.p.locked());
  assert.strictEqual(s.p.s.lockLeft, 30);
  s.p.input('1'); assert.strictEqual(s.p.s.digits, '1234');     // gesperrt: keine Eingabe
  s.T.tick(10000); assert.strictEqual(s.p.s.lockLeft, 20);
  s.T.tick(20000);
  assert.ok(!s.p.locked()); assert.strictEqual(s.p.s.digits, '');
  s.p.input('5'); assert.strictEqual(s.p.s.digits, '5');
});
test('PIN: Netzfehler zaehlt nicht als Fehlversuch', function () {
  var s = pinSetup(function (pin, cb) { cb(false, { type: 'network' }); });
  for (var i = 0; i < 6; i++) '1111'.split('').forEach(function (d) { s.p.input(d); });
  assert.ok(!s.p.locked()); assert.ok(s.p.s.error); assert.strictEqual(s.p.s.wrong, false);
});

/* plex.tv-Aufrufe ueber den Proxy (gemocktes XHR) */
function authSetup(script) {
  var ctx = H.load(), N = ctx.N, x = H.FakeXHR(script);
  N.http._setFactory(x.factory); N.http._reset();
  N.plex.clientId = 'cid-1';
  N.config.apply({ proxyHost: '192.0.2.10:3000' });   // Repo-Standard ist leer (lokale Werte aus local.json)
  return { N: N, log: x.log };
}
test('PIN-Anfrage geht als POST ueber den Proxy mit X-Plex-Headern', function (t, done) {
  var s = authSetup(function () { return { status: 201, body: { id: 5, code: 'ZZ99', expiresIn: 900 } }; });
  s.N.auth.createPin(function (err, pin) {
    assert.ifError(err);
    assert.strictEqual(pin.code, 'ZZ99');
    var r = s.log.opened[0];
    assert.strictEqual(r.method, 'POST');
    assert.strictEqual(r.url, 'http://192.0.2.10:3000/?url=' + encodeURIComponent('https://plex.tv/api/v2/pins?strong=false'));
    assert.strictEqual(r.headers['X-Plex-Client-Identifier'], 'cid-1');
    assert.strictEqual(r.headers['X-Plex-Product'], 'Neolume');
    assert.ok(/^(de-DE|en-US)$/.test(r.headers['X-Plex-Language']));
    done();
  });
});
test('Profilwechsel: falsche PIN wird als wrongPin erkannt, PIN nur als Parameter', function (t, done) {
  var s = authSetup(function (m, u) { return /pin=1111/.test(decodeURIComponent(u)) ? { status: 201, body: { authToken: 'UT' } } : { status: 403, body: {} }; });
  s.N.auth.switchUser('ACC', 'bbbb2222', '9999', function (err) {
    assert.ok(err && err.wrongPin);
    s.N.auth.switchUser('ACC', 'bbbb2222', '1111', function (e2, tok) {
      assert.ifError(e2); assert.strictEqual(tok, 'UT');
      assert.ok(/home%2Fusers%2Fbbbb2222%2Fswitch/.test(s.log.opened[1].url));
      done();
    });
  });
});
test('Profile: Gaeste weg, Hauptkonto/Kind/Jugendlich, PIN-Schloss', function () {
  var N = H.load().N, u = N.auth.normUsers(S('home-users.json'));
  H.eq(u.map(function (x) { return [x.name, x.kind, x.pin, x.restricted]; }), [['Alex', 'main', true, false], ['Kim', 'kid', false, true], ['Robin', 'teen', true, true]]);
});
test('Server-Wahl: gemerkte ID > Fallback-Adresse > eigener lokaler; immer http://adresse:port', function () {
  var N = H.load().N, srv = N.auth.normServers(S('resources.json'));
  assert.strictEqual(srv.length, 2);                                   // Player-Ressource ignoriert
  var p = N.auth.pickServer(srv, null, 'http://192.0.2.20:32400');
  assert.deepStrictEqual([p.machineId, p.uri, p.token], ['mid-own', 'http://10.0.0.5:32400', 'tok-own']);
  p = N.auth.pickServer(srv, 'mid-friend', 'x');
  assert.strictEqual(p.uri, 'http://198.51.100.7:32400');
  p = N.auth.pickServer(srv, null, 'http://203.0.113.9:41000');
  assert.strictEqual(p.uri, 'http://203.0.113.9:41000');
  assert.strictEqual(N.auth.pickServer([], null, 'x'), null);
});

/* Review M2 (H3/H4/M3): Sperre je Profil ausserhalb des Dialogs, Abbrechen verwirft spaete Ergebnisse, 401 ist kein Fehlversuch */
function keyedPin(ctx, key, verify, ok) {
  var T = ctx.timers;
  return new ctx.N.PinLogic({ key: key, verify: verify, now: T.now, timers: { set: T.setTimeout, clear: T.clearTimeout }, onSuccess: function (pin) { ok.push(pin); } });
}
function typePin(p, pin) { pin.split('').forEach(function (d) { p.input(d); }); }
test('PIN-Sperre ueberlebt Schliessen/Neu-Oeffnen (je Profil-uuid)', function () {
  var ctx = H.load({ fakeTimers: true }), ok = [], bad = function (pin, cb) { cb(false, { wrongPin: true }); };
  var p = keyedPin(ctx, 'kid', bad, ok);
  for (var i = 0; i < 3; i++) typePin(p, '1234');
  p.destroy();
  p = keyedPin(ctx, 'kid', bad, ok);                             // neu geoeffnet: Zaehler laeuft weiter
  assert.strictEqual(p.s.tries, 3);
  typePin(p, '1234'); typePin(p, '1234');
  assert.ok(p.locked());
  p.destroy();
  var other = keyedPin(ctx, 'adult', bad, ok);                   // anderes Profil: eigene Zaehlung
  assert.ok(!other.locked()); other.destroy();
  p = keyedPin(ctx, 'kid', bad, ok);                             // waehrend der Sperre neu geoeffnet -> weiter gesperrt
  assert.ok(p.locked()); assert.strictEqual(p.s.lockLeft, 30);
  typePin(p, '1'); assert.strictEqual(p.s.digits, '');
  ctx.timers.tick(30000);
  assert.ok(!p.locked());
  p.destroy();
  p = keyedPin(ctx, 'kid', bad, ok);
  assert.ok(!p.locked()); assert.strictEqual(p.s.tries, 0);
});
test('PIN: Abbrechen waehrend der Pruefung verwirft das Ergebnis (kein Profilwechsel), falsche zaehlt trotzdem', function () {
  var ctx = H.load({ fakeTimers: true }), ok = [], pend = [];
  var p = keyedPin(ctx, 'u1', function (pin, cb) { pend.push(cb); }, ok);
  typePin(p, '4711');
  assert.strictEqual(p.s.busy, true);
  p.destroy();                                                   // RETURN waehrend busy
  pend[0](true);
  assert.deepStrictEqual(ok, []);
  var q = keyedPin(ctx, 'u1', function (pin, cb) { pend.push(cb); }, ok);
  typePin(q, '0000'); q.destroy();
  pend[1](false, { wrongPin: true });                            // Abbrechen umgeht die Zaehlung nicht
  assert.strictEqual(ctx.N.PinLogic._locks.u1.tries, 1);
});
test('PIN: abgelaufene Konto-Anmeldung (401 von plex.tv) zaehlt nicht als Fehlversuch', function (t, done) {
  var s = authSetup(function () { return { status: 401, body: {} }; });
  s.N.auth.switchUser('ACC', 'bbbb2222', '1234', function (err) {
    assert.ok(err.authExpired); assert.ok(!err.wrongPin);
    done();
  });
});
test('PIN: authExpired-Fehler sperrt nicht', function () {
  var ctx = H.load({ fakeTimers: true }), ok = [];
  var p = keyedPin(ctx, 'u2', function (pin, cb) { cb(false, { type: 'http', status: 401, authExpired: true }); }, ok);
  for (var i = 0; i < 6; i++) typePin(p, '1111');
  assert.ok(!p.locked()); assert.ok(p.s.error); assert.strictEqual(p.s.tries, 0);
});
