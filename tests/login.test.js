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

/* ---- Anmeldung direkt am Geraet (caps.webLogin): N.WebLoginFlow ---- */
function webSetup(api) {
  var ctx = H.load({ fakeTimers: true }), T = ctx.timers, states = [], win = { opened: [], closed: 0, cb: null };
  api.webUrl = api.webUrl || function (code) { return 'https://app.plex.tv/auth#?code=' + code; };
  var f = new ctx.N.WebLoginFlow({ api: api, now: T.now, timers: { set: T.setTimeout, clear: T.clearTimeout },
    web: { open: function (url, cb) { win.opened.push(url); win.cb = cb; }, close: function () { win.closed++; var c = win.cb; win.cb = null; if (c) c(null, { closed: true, reason: 'closed' }); } },
    onChange: function (s) { states.push(s.name + (s.notice ? ':' + s.notice : '')); } });
  return { f: f, T: T, states: states, win: win };
}
function pinApi(o) {
  o = o || {};
  var a = { polls: 0, strong: [] };
  a.createPin = function (cb, strong) { a.strong.push(strong); cb(null, { id: 9, code: 'LONGCODE', expiresIn: o.expiresIn || 1800 }); return { abort: function () {} }; };
  a.checkPin = function (id, cb) { a.polls++; var r = o.check ? o.check(a.polls) : [null, null]; cb(r[0], r[1]); return { abort: function () {} }; };
  return a;
}

test('Web-Anmeldung: starke PIN, Anmeldeseite oeffnen, Abfrage alle 2 s, Token -> Fenster zu, authorized', function () {
  var api = pinApi({ check: function (n) { return [null, n >= 2 ? 'TOK' : null]; } }), s = webSetup(api);
  s.f.start();
  assert.deepStrictEqual(api.strong, [true]);
  assert.deepStrictEqual(s.win.opened, ['https://app.plex.tv/auth#?code=LONGCODE']);
  assert.strictEqual(s.f.state.name, 'open');
  s.T.tick(4000);
  assert.strictEqual(api.polls, 2);
  assert.strictEqual(s.f.state.name, 'authorized'); assert.strictEqual(s.f.state.token, 'TOK');
  assert.strictEqual(s.win.closed, 1, 'Fenster per auth.close geschlossen');
  s.T.tick(10000); assert.strictEqual(api.polls, 2);
  assert.deepStrictEqual(s.states, ['requesting', 'open', 'authorized']);
});

test('Web-Anmeldung: Nutzer schliesst das Fenster -> sofort nachsehen; Token da = angemeldet, sonst "abgebrochen"', function () {
  var tok = null, api = pinApi({ check: function () { return [null, tok]; } }), s = webSetup(api);
  s.f.start(); s.T.tick(2000);
  assert.strictEqual(api.polls, 1);
  s.win.cb(null, { closed: true, reason: 'cancelled' });
  assert.strictEqual(api.polls, 2, 'sofortige Abfrage beim Schliessen');
  assert.strictEqual(s.f.state.name, 'idle'); assert.strictEqual(s.f.state.notice, 'cancelled');
  assert.strictEqual(s.win.closed, 0, 'Fenster war schon zu');
  s.T.tick(10000); assert.strictEqual(api.polls, 2, 'keine Abfrage mehr');
  // zweiter Versuch: Anmeldung kurz vor dem Schliessen fertig
  tok = 'LATE';
  s.f.start();
  s.win.cb(null, { closed: true, reason: 'cancelled' });
  assert.strictEqual(s.f.state.name, 'authorized'); assert.strictEqual(s.f.state.token, 'LATE');
});

test('Web-Anmeldung: Fenster geht nicht auf, PIN abgelaufen (Zeit/404), viele Fehler, stop() schliesst das Fenster', function () {
  var s = webSetup(pinApi());
  s.f.start(); s.win.cb({ code: 'web_failed' });
  assert.strictEqual(s.f.state.notice, 'failed');
  s.T.tick(10000); assert.strictEqual(s.f.state.notice, 'failed');

  s = webSetup(pinApi({ expiresIn: 5 }));
  s.f.start(); s.T.tick(6000);
  assert.strictEqual(s.f.state.name, 'idle'); assert.strictEqual(s.f.state.notice, 'expired'); assert.strictEqual(s.win.closed, 1);

  s = webSetup(pinApi({ check: function () { return [{ type: 'http', status: 404 }, null]; } }));
  s.f.start(); s.T.tick(2000);
  assert.strictEqual(s.f.state.notice, 'expired'); assert.strictEqual(s.win.closed, 1);

  s = webSetup(pinApi({ check: function () { return [{ type: 'network', status: 0 }, null]; } }));
  s.f.start(); s.T.tick(2000 * 8);
  assert.strictEqual(s.f.state.name, 'error'); assert.strictEqual(s.f.state.kind, 'proxy'); assert.strictEqual(s.win.closed, 1);

  var api = pinApi(); s = webSetup(api);
  s.f.start(); s.f.stop();
  assert.strictEqual(s.win.closed, 1);
  s.T.tick(10000); assert.strictEqual(api.polls, 0);
});

test('Web-Anmeldung: Anmeldeseite = app.plex.tv/auth mit clientID, code, Produkt; starke PIN per strong=true', function (t, done) {
  var s = authSetup(function () { return { status: 201, body: { id: 6, code: 'abc def', expiresIn: 1800 } }; });
  var u = s.N.auth.webUrl('abc def');
  assert.strictEqual(u, 'https://app.plex.tv/auth#?clientID=cid-1&code=abc%20def&context%5Bdevice%5D%5Bproduct%5D=Neolume');
  s.N.auth.createPin(function (err, pin) {
    assert.ifError(err);
    assert.strictEqual(pin.code, 'abc def');
    assert.strictEqual(s.log.opened[0].url, 'http://192.0.2.10:3000/?url=' + encodeURIComponent('https://plex.tv/api/v2/pins?strong=true'));
    done();
  }, true);
});

test('Web-Anmeldung: Plattform wirft beim Oeffnen -> Hinweis "failed" statt ewigem Ladekreis, Abfrage gestoppt', function () {
  var api = pinApi(), s = webSetup(api);
  s.f.d.web.open = function () { throw new Error('keine Bruecke'); };
  s.f.start();
  assert.strictEqual(s.f.state.name, 'idle'); assert.strictEqual(s.f.state.notice, 'failed');
  assert.strictEqual(s.win.closed, 0, 'kein Schliessen ohne offenes Fenster');
  s.T.tick(10000); assert.strictEqual(api.polls, 0);
});

/* ---- Ansicht 'login' mit caps.webLogin (views/login.js) ohne Browser: Mini-DOM, Plattform und PIN als Attrappe.
 * iPad 02.11. (Nr. 15): "Mit Plex anmelden" zeigte nur den Ladekreis – webRender schrieb style.left auf den Textknoten der
 * Statuszeile (U.txt liefert den Textknoten), warf beim ersten Zustand "requesting", die PIN wurde nie angelegt. */
function MiniDoc() {
  function El(tag) { this.tagName = tag; this.style = {}; this.childNodes = []; this.className = ''; this.offsetWidth = 240; }
  El.prototype.appendChild = function (c) { this.childNodes.push(c); c.parentNode = this; return c; };
  El.prototype.setAttribute = function (k, v) { this[k] = v; };
  El.prototype.addEventListener = function () {};
  Object.defineProperty(El.prototype, 'firstChild', { get: function () { return this.childNodes[0] || null; } });
  return { createElement: function (t) { return new El(t); }, createTextNode: function (t) { return { nodeValue: t }; } };
}
function webView(o) {
  o = o || {};
  var fs = require('fs'), path = require('path'), vm = require('vm');
  var ctx = H.load({ fakeTimers: true }), N = ctx.N, calls = { pins: [], opened: [], closed: 0, cb: null }, factory = null;
  ctx.document = MiniDoc();
  N.i18n.set('de');
  N.platform.caps.webLogin = true;
  N.platform.auth = {
    web: function (url, cb) { if (o.throwOpen) throw new Error('kaputt'); calls.opened.push(url); calls.cb = cb; },
    close: function () { calls.closed++; }
  };
  N.auth.createPin = function (cb, strong) { calls.pins.push(strong); cb(null, { id: 4, code: 'WEBCODE', expiresIn: 1800 }); return { abort: function () {} }; };
  N.auth.checkPin = function (id, cb) { cb(null, null); return { abort: function () {} }; };
  N.router.refreshHints = function () {};
  var def = N.router.define;
  N.router.define = function (n, fn) { if (n === 'login') factory = fn; };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'login.js'), 'utf8'), ctx, { filename: 'views/login.js' });
  N.router.define = def;
  var scr = factory({}), root = ctx.document.createElement('div');
  scr.create(root);
  scr.enter({});
  var layer = root.childNodes[0];
  function find(text) {
    for (var i = 0; i < layer.childNodes.length; i++) { var e = layer.childNodes[i]; if (e.firstChild && e.firstChild.nodeValue === text) return e; }
    return null;
  }
  return { N: N, scr: scr, calls: calls, find: find };
}

test('Ansicht Web-Anmeldung: Tippen auf "Mit Plex anmelden" legt starke PIN an, oeffnet das Fenster, Status sichtbar', function () {
  var v = webView(), N = v.N;
  assert.ok(v.find(N.t('login.btnWeb')) && v.find(N.t('login.btnCode')), 'Knoepfe gebaut');
  assert.ok(v.scr.pointer(200, 370, 'click'), 'Tippen auf den Knopf');
  assert.deepStrictEqual(v.calls.pins, [true], 'starke PIN angelegt');
  assert.strictEqual(v.calls.opened.length, 1, 'auth.web aufgerufen');
  assert.ok(/^https:\/\/app\.plex\.tv\/auth#\?/.test(v.calls.opened[0]));
  var stat = v.find(N.t('login.web.waiting'));
  assert.ok(stat, 'Statuszeile zeigt "wartet"');
  assert.strictEqual(stat.style.left, '180px', 'Statuszeile neben dem Ladekreis');
  // Nutzer schliesst das Fenster ohne Anmeldung -> sichtbarer Hinweis, kein Ladekreis mehr
  v.calls.cb(null, { closed: true, reason: 'cancelled' });
  stat = v.find(N.t('login.web.cancelled'));
  assert.ok(stat, 'Hinweis "abgebrochen"');
  assert.strictEqual(stat.style.left, '144px');
});

test('Ansicht Web-Anmeldung: Fokus wechselt zwischen den Knoepfen (Klasse am Element), Fehler beim Oeffnen sichtbar', function () {
  var v = webView(), N = v.N, btn = v.find(N.t('login.btnWeb')), code = v.find(N.t('login.btnCode'));
  v.scr.onKey('DOWN');
  assert.ok(/is-focus/.test(code.className) && !/is-focus/.test(btn.className));
  v.scr.onKey('UP');
  assert.ok(/is-focus/.test(btn.className) && !/is-focus/.test(code.className));
  v.scr.onKey('ENTER');
  v.calls.cb({ code: 'web_failed' });
  assert.ok(v.find(N.t('login.web.failed')), 'Hinweis "liess sich nicht oeffnen"');
  v = webView({ throwOpen: true });
  v.scr.onKey('ENTER');
  assert.ok(v.find(v.N.t('login.web.failed')), 'Hinweis nach Ausnahme der Plattform');
  assert.strictEqual(v.calls.closed, 0);
});

test('StateBlock schmal (fit): Knoepfe untereinander, Zeiger und ▲▼ treffen sie; fit(null) wieder wie am TV', function () {
  var ctx = H.load({ fakeTimers: true }), N = ctx.N;
  ctx.document = MiniDoc();
  N.router.refreshHints = function () {};
  var root = ctx.document.createElement('div'), sb = new N.ui.StateBlock(root), sel = [];
  sb.fit({ x: 24, w: 498, H: 942 });
  sb.show({ title: 'T', text: 'X', buttons: [{ id: 'a', t: 'A' }, { id: 'b', t: 'B' }], onSelect: function (id) { sel.push(id); } });
  assert.ok(sb.L && sb.L.stack, 'untereinander bei 498 Breite');
  assert.strictEqual(sb.btns[0].style.width, '400px');
  var y = sb.L.y;
  assert.ok(sb.pointer(100, y + 70, 'click')); assert.deepStrictEqual(sel, ['b'], 'zweiter Knopf 64 tiefer');
  assert.strictEqual(sb.pointer(100, y + 52, 'click'), false, 'Luecke trifft nichts');
  sb.onKey('UP'); assert.strictEqual(sb.f, 0, '▲ zum ersten');
  sb.fit(null);
  assert.strictEqual(sb.L, null); assert.strictEqual(sb.el.style.left, ''); assert.strictEqual(sb.btns[0].style.width, '');
  assert.ok(sb.pointer(144 + 316 + 10, 420, 'click'), 'TV-Lagen'); assert.deepStrictEqual(sel, ['b', 'b']);
});
