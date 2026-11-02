'use strict';
/* Verbindungen zum Plex-Server (N.plexConn, SPEC NET-7) und Weitere Server von plex.tv (SRV-5). Form der Ressourcen wie die
 * echte plex.tv-Antwort (02.11. gegen das Konto geprueft: mit includeHttps=1 nur https-Verbindungen, auch lokal). Nur
 * Beispieladressen (RFC 5737 / RFC 1918) und erfundene Kennungen, kein Netz. */
var test = require('./helpers/load').appleTest(require('node:test')), assert = require('node:assert');
var H = require('./helpers/load');

var OWN = '0123456789abcdef0123456789abcdef01234567', FRIEND = 'aaaa1111bbbb2222cccc3333dddd4444eeee5555';
var HX = '0123456789abcdef0123456789abcdef', FX = 'fedcba9876543210fedcba9876543210';
var L_HTTPS = 'https://192-168-1-10.' + HX + '.plex.direct:32400', L_HTTP = 'http://192.168.1.10:32400';
var R_HTTPS = 'https://203-0-113-7.' + HX + '.plex.direct:32411', RELAY = 'https://198-51-100-3.' + HX + '.plex.direct:8443';
var F_REMOTE = 'https://198-51-100-20.' + FX + '.plex.direct:32400', F_LOCAL = 'https://10-1-2-3.' + FX + '.plex.direct:32400';
var F_RELAY = 'https://198-51-100-4.' + FX + '.plex.direct:8443';

function conn(uri, address, port, local, relay, extra) {
  var c = { protocol: 'https', address: address, port: port, uri: uri, local: local, relay: relay, IPv6: false };
  for (var k in extra || {}) c[k] = extra[k];
  return c;
}
function resources(over) {
  var own = { name: 'Home Server', provides: 'server', clientIdentifier: OWN, owned: true, accessToken: 'OWNTOKEN0000000000001', httpsRequired: false,
    connections: [conn(L_HTTPS, '192.168.1.10', 32400, true, false), conn(R_HTTPS, '203.0.113.7', 32411, false, false), conn(RELAY, '198.51.100.3', 8443, false, true),
      conn('https://2001-db8--10.' + HX + '.plex.direct:32400', '2001:db8::10', 32400, true, false, { IPv6: true })] };
  var friend = { name: 'Freund', provides: 'server', clientIdentifier: FRIEND, owned: false, accessToken: 'FRIENDSRVTOKEN000001', httpsRequired: false,
    connections: [conn(F_LOCAL, '10.1.2.3', 32400, true, false), conn(F_REMOTE, '198.51.100.20', 32400, false, false), conn(F_RELAY, '198.51.100.4', 8443, false, true)] };
  var r = [own, friend, { name: 'Player', provides: 'client,player', clientIdentifier: 'p1', connections: [] }];
  if (over) over(r);
  return r;
}
function J(v) { return JSON.parse(JSON.stringify(v)); }
function uris(s) { return s.conns.map(function (c) { return c.uri; }); }

/* das alte N.auth.normServers (bis 02.11.) – der Fernseher muss genau dieses Ergebnis behalten */
function oldNorm(list) {
  var out = [];
  for (var i = 0; list && i < list.length; i++) {
    var r = list[i];
    if (!r || String(r.provides || '').indexOf('server') < 0) continue;
    var conns = [];
    for (var j = 0; r.connections && j < r.connections.length; j++) {
      var c = r.connections[j];
      if (c.relay || c.IPv6 || !c.address) continue;
      conns.push({ uri: 'http://' + c.address + ':' + (c.port || 32400), local: !!c.local });
    }
    out.push({ name: r.name || '', machineId: r.clientIdentifier, owned: !!r.owned, token: r.accessToken || null, conns: conns });
  }
  return out;
}

test('TV (ohne tls12): normServers genau wie bisher, resources ohne Relay, Verbindungswahl aus', function () {
  var N = H.load().N;
  assert.strictEqual(N.platform.caps.tls12, false);
  var dup = resources(function (r) { r[0].connections.push(J(r[0].connections[0])); r[0].connections.push({ protocol: 'http', address: '192.168.1.20', local: true }); });
  assert.deepStrictEqual(J(N.auth.normServers(dup)), oldNorm(dup));
  assert.deepStrictEqual(J(N.auth.normServers(resources())), oldNorm(resources()));
  var x = H.FakeXHR(function () { return { status: 200, body: [] }; });
  N.http._setFactory(x.factory);
  N.auth.resources('T', function () {});
  assert.ok(/includeRelay%3D0/.test(x.log.opened[0].url));
  assert.strictEqual(N.plexConn.on(), false);
  assert.strictEqual(N.plexConn.wan(), false, 'TV: eigener Server immer Heimnetz');
});

test('Apple (tls12): lokal-https -> lokal-http (abgeleitet) -> entfernt-https -> Relay; kein IPv6, Token je Server', function () {
  var N = H.load({ platform: 'apple' }).N, s = J(N.auth.normServers(resources()));
  assert.deepStrictEqual(uris(s[0]), [L_HTTPS, L_HTTP, R_HTTPS, RELAY]);
  assert.deepStrictEqual(s[0].conns.map(function (c) { return [c.local, c.https, c.relay]; }), [[true, true, false], [true, false, false], [false, true, false], [false, true, true]]);
  assert.strictEqual(s[1].token, 'FRIENDSRVTOKEN000001');
  var x = H.FakeXHR(function () { return { status: 200, body: [] }; });
  N.http._setFactory(x.factory);
  N.auth.resources('T', function () {});
  assert.ok(/includeHttps=1/.test(x.log.opened[0].url) && /includeRelay=1/.test(x.log.opened[0].url));
});

test('Apple: httpsRequired -> kein http; http nie ins Internet; kaputte/fremde uri faellt weg; doppelte einmal', function () {
  var N = H.load({ platform: 'apple' }).N;
  var s = J(N.auth.normServers(resources(function (r) { r[0].httpsRequired = true; })))[0];
  assert.ok(uris(s).every(function (u) { return u.indexOf('https://') === 0; }));
  s = J(N.auth.normServers(resources(function (r) {
    r[0].connections = [{ protocol: 'http', address: '198.51.100.9', port: 32400, uri: 'http://198.51.100.9:32400', local: true },
      { protocol: 'http', address: '203.0.113.9', port: 32400, uri: 'http://203.0.113.9:32400', local: false },
      conn('javascript:alert(1)', '192.168.1.10', 1, false, false), conn('https://user@plex.example.net', '203.0.113.8', 443, false, false),
      conn('https://plex.example.net:443', '203.0.113.8', 443, false, false), conn('https://plex.example.net:443/', '203.0.113.8', 443, false, false)];
  })))[0];
  assert.deepStrictEqual(uris(s), ['https://plex.example.net:443']);
});

test('Gruppen: WLAN lokal zuerst, Mobilfunk entfernt zuerst (lokal = VPN), Relay immer zuletzt, gemerkte zuerst in ihrer Gruppe', function () {
  var N = H.load({ platform: 'apple' }).N, C = N.plexConn, cs = N.auth.normServers(resources())[0].conns;
  function g(kind, last) { return J(C.groups(cs, kind, last)).map(function (l) { return l.map(function (c) { return c.uri; }); }); }
  assert.deepStrictEqual(g('wlan'), [[L_HTTPS, L_HTTP], [R_HTTPS], [RELAY]]);
  assert.deepStrictEqual(g('cell'), [[R_HTTPS], [L_HTTPS, L_HTTP], [RELAY]]);
  assert.deepStrictEqual(g('wlan', L_HTTP), [[L_HTTP, L_HTTPS], [R_HTTPS], [RELAY]]);
  assert.deepStrictEqual(g('wlan', RELAY)[0], [L_HTTPS, L_HTTP], 'gemerkte nie vor einer besseren Gruppe');
  assert.deepStrictEqual(g('none'), []);
  assert.strictEqual(C.kindOf({ status: 'satisfied', wifi: true }), 'wlan');
  assert.strictEqual(C.kindOf({ status: 'satisfied', cellular: true }), 'cell');
  assert.strictEqual(C.kindOf({ status: 'unsatisfied' }), 'none');
  assert.strictEqual(C.identityOk({ MediaContainer: { machineIdentifier: OWN } }, OWN), true);
  assert.strictEqual(C.identityOk({ MediaContainer: { machineIdentifier: 'x' } }, OWN), false);
});

/* ---------- Laufzeit (Apple, ohne setup.json) ---------- */
function world(o) {
  o = o || {};
  var ctx = H.load({ fakeTimers: true, platform: o.platform || 'apple' }), N = ctx.N, T = ctx.timers, disk = {};
  var conns = o.conns === undefined ? J(H.load({ platform: 'apple' }).N.auth.normServers(resources())[0].conns) : o.conns;
  var st = { v: 1, clientId: 'c', account: { token: 'ACCTOKEN000000000001', uuid: 'aaaa1111' },
    server: { uri: o.last || L_HTTPS, machineId: OWN, name: 'Home Server', token: 'OWNTOKEN0000000000001', conns: conns, connsTs: o.connsTs === undefined ? 1 : o.connsTs },
    users: [{ id: 1, uuid: 'aaaa1111', name: 'Owner', admin: true, restricted: false, pin: false, kind: 'main', rp: '' },
      { id: 2, uuid: 'bbbb2222', name: 'Kind', admin: false, restricted: true, pin: false, kind: 'kid', rp: 'little_kid' }],
    usersTs: 1, profiles: { aaaa1111: { serverToken: 'OWNTOKEN0000000000001' }, bbbb2222: { serverToken: 'KIDTOKEN000000000002' } },
    lastProfile: 'aaaa1111', lang: 'de', pinSwitch: null, protectRemindAt: 0, firstPicker: false };
  if (o.state) o.state(st);
  disk['state.json'] = JSON.stringify(st);
  N.store.init({ read: function (n) { return disk[n] === undefined ? null : disk[n]; }, write: function (n, t) { disk[n] = t; } });
  var up = o.up || {};                                    // uri -> true (antwortet als unser Server) | 'other' (fremdes Geraet)
  var x = H.FakeXHR(function (m, u, n, req) {
    var r;
    if (u.indexOf('https://plex.tv/') === 0) r = o.plextv ? o.plextv(u) : { status: 500, body: '' };
    else {
      var base = u.replace(/^(https?:\/\/[^/]+).*$/, '$1'), who = up[base];
      if (!who) r = { hang: true };                       // nicht erreichbar -> Zeitlimit
      else if (/\/identity$/.test(u)) r = { status: 200, body: { MediaContainer: { machineIdentifier: who === 'other' ? 'ffffffffffffffff' : base.indexOf(FX) > 0 ? FRIEND : OWN } } };
      else r = { status: 200, body: { MediaContainer: { size: 0, Directory: [{ key: '3', title: 'Filme', type: 'movie' }] } } };
    }
    if (r) r.timers = T;
    return r;
  });
  N.http._setFactory(x.factory);
  N.session.load(null);
  return { N: N, T: T, disk: disk, log: x.log, up: up };
}
function urls(w, from) { return w.log.opened.slice(from || 0).map(function (o) { return o.url.split('?')[0]; }); }
function tokenOf(o) { return o.headers['X-Plex-Token'] || null; }

test('Start zu Hause: gemerkte Adresse zuerst mit /identity OHNE Token, Anfragen warten darauf, kein plex.tv im Startpfad', function () {
  var w = world({ up: { 'https://192-168-1-10.0123456789abcdef0123456789abcdef.plex.direct:32400': true } }), N = w.N, S = N.session;
  S.activate(S.user('aaaa1111'), S.cachedToken(S.user('aaaa1111')));
  assert.strictEqual(N.plexConn.busy(), true);
  var got = null;
  N.plex.get('/library/sections', null, {}, function (e, d) { got = e || d; });
  assert.ok(urls(w).indexOf(L_HTTPS + '/library/sections') < 0, 'Token-Anfrage wartet auf die Pruefung');
  w.T.tick(2000);
  assert.ok(got && got.MediaContainer);
  var first = w.log.opened[0];
  assert.strictEqual(first.url, L_HTTPS + '/identity');
  assert.strictEqual(tokenOf(first), null, '/identity ohne Token');
  var sec = w.log.opened.filter(function (o) { return o.url.indexOf('/library/sections') > 0; })[0];
  assert.strictEqual(sec.url.split('?')[0], L_HTTPS + '/library/sections');
  assert.strictEqual(tokenOf(sec), 'OWNTOKEN0000000000001');
  assert.strictEqual(N.plex.base, L_HTTPS);
  assert.ok(urls(w).every(function (u) { return u.indexOf('plex.tv/') < 0; }), 'kein plex.tv');
});

test('Fremdes WLAN mit gleicher privater Adresse: kein Token an ein Geraet mit falscher Kennung, entfernt-https gewinnt', function () {
  var up = {}; up[L_HTTPS] = 'other'; up[L_HTTP] = 'other'; up[R_HTTPS] = true;
  var w = world({ up: up, connsTs: Date.now() }), N = w.N, S = N.session;
  S.activate(S.user('aaaa1111'), S.cachedToken(S.user('aaaa1111')));
  N.plex.get('/library/sections', null, {}, function () {});
  w.T.tick(8000);
  assert.strictEqual(N.plex.base, R_HTTPS);
  w.log.opened.forEach(function (o) { if (o.url.indexOf('192.168.1.10') >= 0 || o.url.indexOf('192-168-1-10') >= 0) assert.strictEqual(tokenOf(o), null, o.url); });
  assert.ok(urls(w).indexOf(R_HTTPS + '/library/sections') >= 0);
  assert.ok(JSON.parse(w.disk['state.json']).server.uri === R_HTTPS, 'neue Adresse gemerkt (ohne Token in der Liste)');
  assert.ok(JSON.parse(w.disk['state.json']).server.conns.every(function (c) { return !c.token; }));
});

test('Netzwechsel WLAN -> Mobilfunk -> WLAN: neu waehlen (entfernt zuerst im Mobilfunk), Bilder folgen der Basis', function () {
  var up = {}; up[L_HTTPS] = true; up[R_HTTPS] = true;
  var w = world({ up: up, connsTs: Date.now() }), N = w.N, S = N.session;
  S.activate(S.user('aaaa1111'), S.cachedToken(S.user('aaaa1111')));
  w.T.tick(2000);
  assert.strictEqual(N.plex.base, L_HTTPS);
  assert.strictEqual(N.plexConn.wan(), false, 'zu Hause: nicht uebers Internet');
  assert.strictEqual(N.plexConn.cell(), false);
  delete up[L_HTTPS];                                     // Mobilfunk: Heimnetz weg
  var n0 = w.log.opened.length;
  N.evt.emit('net:changed', { status: 'satisfied', cellular: true, wifi: false, seq: 2 });
  assert.strictEqual(N.plexConn.busy(), true);
  assert.strictEqual(urls(w, n0)[0], R_HTTPS + '/identity', 'Mobilfunk: entfernte Adresse zuerst');
  w.T.tick(6000);
  assert.strictEqual(N.plex.base, R_HTTPS);
  assert.strictEqual(N.plexConn.wan(), true, 'unterwegs: Player sendet location=wan + Grenze ueber das Internet (PLAY-36)');
  assert.strictEqual(N.plexConn.cell(), true);
  assert.ok(N.img.url('/library/metadata/7/thumb/1', 'poster').indexOf(R_HTTPS) === 0);
  up[L_HTTPS] = true;                                     // wieder zu Hause
  N.evt.emit('net:changed', { status: 'satisfied', wifi: true, seq: 3 });
  w.T.tick(2000);
  assert.strictEqual(N.plex.base, L_HTTPS);
  assert.strictEqual(N.plexConn.wan(), false); assert.strictEqual(N.plexConn.cell(), false);
  assert.ok(urls(w).every(function (u) { return u.indexOf('plex.tv/') < 0; }));
});

test('Keine gemerkte Adresse antwortet: einmal frische Verbindungen von plex.tv, dann die neue Adresse', function () {
  var NEW = 'https://203-0-113-99.' + HX + '.plex.direct:32411', calls = 0;
  var up = {}; up[NEW] = true;
  var w = world({ up: up, connsTs: Date.now(), plextv: function (u) {
    calls++;
    return { status: 200, body: resources(function (r) { r[0].connections[1] = conn(NEW, '203.0.113.99', 32411, false, false); }) };
  } }), N = w.N, S = N.session;
  S.activate(S.user('aaaa1111'), S.cachedToken(S.user('aaaa1111')));
  w.T.tick(20000);
  assert.strictEqual(calls, 1);
  assert.strictEqual(N.plex.base, NEW);
  assert.ok(w.log.opened.filter(function (o) { return o.url.indexOf('plex.tv/api/v2/resources') > 0; })[0].headers['X-Plex-Token'] === 'ACCTOKEN000000000001');
});

test('Weitere Server (Apple): fremde Server aus plex.tv mit ihrem Zugriffs-Token, https zuerst entfernt, Seitenleiste', function () {
  var up = {}; up[L_HTTPS] = true; up[F_REMOTE] = true;
  var w = world({ up: up, connsTs: 0, plextv: function () { return { status: 200, body: resources() }; } }), N = w.N, S = N.session;
  S.activate(S.user('aaaa1111'), S.cachedToken(S.user('aaaa1111')));
  assert.strictEqual(N.srv.has(), false);                 // noch nie geholt
  w.T.tick(20000);                                       // Auffrischung im Hintergrund (nicht im Startpfad)
  assert.strictEqual(N.srv.has(), true);
  var sv = N.srv.get(FRIEND);
  assert.deepStrictEqual(J(sv.uris), [F_REMOTE, F_LOCAL, 'http://10.1.2.3:32400', F_RELAY]);
  w.T.tick(10000);
  assert.strictEqual(N.srv.state(FRIEND), 'ok');
  var fr = w.log.opened.filter(function (o) { return o.url.indexOf(FX) > 0; });
  assert.strictEqual(fr[0].url, F_REMOTE + '/identity');
  assert.strictEqual(tokenOf(fr[0]), null);
  assert.strictEqual(tokenOf(fr.filter(function (o) { return /library\/sections/.test(o.url); })[0]), 'FRIENDSRVTOKEN000001');
  assert.deepStrictEqual(J(N.srv.libs()).map(function (l) { return [l.title, l.srvName]; }), [['Filme', 'Freund']]);
  // naechster Start: Liste aus dem Speicher, ohne plex.tv
  var st = JSON.parse(w.disk['state.json']);
  assert.strictEqual(st.profiles.aaaa1111.servers[0].machineId, FRIEND);
  assert.strictEqual(st.profiles.aaaa1111.serverToken, 'OWNTOKEN0000000000001');
  // das eigene Profil-Token bleibt, Kinderprofil hat keine fremden Server
  S.activate(S.user('bbbb2222'), S.cachedToken(S.user('bbbb2222')));
  assert.strictEqual(N.srv.has(), false);
});

test('Profilwechsel (plex.tv-Ablauf): fremde Server aus den Ressourcen DIESES Profils merken', function () {
  var w = world({ state: function (st) { st.users[1].pin = true; delete st.profiles.bbbb2222; },
    plextv: function (u) {
      if (/switch/.test(u)) return { status: 201, body: { authToken: 'KIDUSERTOKEN00000001' } };
      return { status: 200, body: resources(function (r) { r[0].owned = false; r[0].accessToken = 'KIDSRVTOKEN000000001'; r[1].accessToken = 'KIDFRIENDTOK00000001'; }) };
    } }), N = w.N, S = N.session, tok = null;
  S.tokenFor(S.user('bbbb2222'), '1234', function (e, t) { tok = t; });
  w.T.tick(100);
  assert.strictEqual(tok, 'KIDSRVTOKEN000000001');
  var o = S.otherServers('bbbb2222');
  assert.strictEqual(o.length, 1, 'eigener Server (owned=false fuer Home-Profile) nicht doppelt');
  assert.strictEqual(o[0].token, 'KIDFRIENDTOK00000001');
});

test('TV ohne setup.json (Entwicklung): keine Verbindungswahl, keine fremden Server aus plex.tv', function () {
  var w = world({ platform: 'samsung-orsay', last: 'http://192.168.1.10:32400', conns: null, plextv: function () { return { status: 200, body: resources() }; } }), N = w.N, S = N.session;
  S.activate(S.user('aaaa1111'), S.cachedToken(S.user('aaaa1111')));
  assert.strictEqual(N.plexConn.busy(), false);
  w.T.tick(30000);
  assert.strictEqual(N.srv.has(), false);
  assert.strictEqual(w.log.opened.length, 0);
  S.takeServers('aaaa1111', N.auth.normServers(resources()));
  assert.strictEqual(S.otherServers('aaaa1111').length, 0);
});
