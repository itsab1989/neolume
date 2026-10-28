'use strict';
/* Weitere Server (N.srv, Nutzerwunsch 27.10.): setup.json-Format, Adresspruefung (/identity ohne Token, dann Bibliotheken),
 * Anfragen/Bilder/Schreiben je Server, Seitenleisten-IDs. Ohne Netz; nur Beispieladressen (RFC 5737 / RFC 1918). */
var test = require('node:test'), assert = require('node:assert');
var H = require('./helpers/load');

var OWN = '0123456789abcdef0123456789abcdef01234567', OTHER = 'aaaa1111bbbb2222cccc3333dddd4444eeee5555';
var B = 'http://203.0.113.7:32400', A = 'http://198.51.100.9:32400';
function cfgObj(over) {
  var o = { schema: 1, kind: 'plexneo-setup', createdAt: '2026-10-27T12:00:00Z', clientIdentifier: 'plexneo-0123456789abcdef0123', serversSchema: 1,
    server: { machineIdentifier: OWN, name: 'Home Server', uris: ['http://10.0.0.20:32400'] },
    profiles: [
      { id: 1, uuid: 'aaaa1111', title: 'Owner', kind: 'owner', token: 'OWNERTOKEN0000000001',
        servers: [{ machineIdentifier: OTHER, name: 'Freund', uris: [A, B], token: 'OTHERTOKEN000000001' }] },
      { id: 2, uuid: 'bbbb2222', title: 'Kid', kind: 'home', restricted: true, restrictionProfile: 'little_kid', token: 'KIDTOKEN000000000002' },
      { id: 5, uuid: 'eeee5555', title: 'Friend', kind: 'friend', token: 'FRIENDTOKEN000000005',
        servers: [{ machineIdentifier: OTHER, name: 'Freund', uris: [B], token: 'OTHERTOKEN000000005' }] }] };
  if (over) over(o);
  return o;
}
function parse(N, over) { return N.setupFile.parse(JSON.stringify(cfgObj(over))); }

/* ---------- setup.json ---------- */
test('setup.json: servers je Profil, fehlerhafte Eintraege uebersprungen, Freunde nie, alte Dateien unveraendert', function () {
  var N = H.load().N, r = parse(N);
  assert.ok(r.ok, r.reason);
  H.eq(r.cfg.profiles[0].servers, [{ machineId: OTHER, name: 'Freund', uris: [A, B], token: 'OTHERTOKEN000000001' }]);
  H.eq(r.cfg.profiles[1].servers, []);
  assert.strictEqual(r.cfg.profiles.length, 2);                // Freund-Profil (anderes Konto): gar nicht uebernommen, also auch keine Server
  // alte Datei (ohne serversSchema/servers) gilt weiter
  var old = parse(N, function (o) { delete o.serversSchema; delete o.profiles[0].servers; });
  assert.ok(old.ok); H.eq(old.cfg.profiles[0].servers, []);
  // neueres Format: nur die weiteren Server ignorieren, Einrichtung bleibt gueltig
  var nw = parse(N, function (o) { o.serversSchema = 2; });
  assert.ok(nw.ok); H.eq(nw.cfg.profiles[0].servers, []); assert.strictEqual(nw.cfg.serversIgnored, true);
  function srv(mod) { var x = parse(N, function (o) { mod(o.profiles[0].servers[0]); }); assert.ok(x.ok); return x.cfg; }
  [function (s) { s.machineIdentifier = 'x/y'; }, function (s) { s.machineIdentifier = OWN; }, function (s) { s.token = 'kurz'; },
    function (s) { s.uris = ['https://203.0.113.7:32400', 'http://example.com:32400', 'http://0.0.0.0:1', 'http://224.0.0.1:32400', 'http://203.0.113.7:99999']; }]
    .forEach(function (mod, i) { var c = srv(mod); assert.strictEqual(c.profiles[0].servers.length, 0, 'Fall ' + i); assert.ok(c.skipped.indexOf('server') >= 0); });
  // oeffentliche Adressen sind bei weiteren Servern erlaubt, beim eigenen Server weiter nicht
  assert.strictEqual(N.setupFile.netUri('http://203.0.113.7:32400/'), 'http://203.0.113.7:32400');
  assert.strictEqual(N.setupFile.lanUri('http://203.0.113.7:32400'), null);
  assert.strictEqual(parse(N, function (o) { o.server.uris = [B]; }).reason, 'uri');
});

/* ---------- Adresspruefung + Anfragen ---------- */
function world(script) {
  var ctx = H.load({ fakeTimers: true }), N = ctx.N, T = ctx.timers, disk = {};
  N.store.init({ read: function (n) { return disk[n] === undefined ? null : disk[n]; }, write: function (n, t) { disk[n] = t; } });
  var x = H.FakeXHR(function (m, u, n, req) { var r = script(m, u, req); if (r) r.timers = T; return r; });
  N.http._setFactory(x.factory);
  var r = N.setupFile.parse(JSON.stringify(cfgObj()));
  N.session.load(r.cfg);
  return { N: N, T: T, disk: disk, log: x.log };
}
function sections() {
  return { MediaContainer: { Directory: [{ key: '3', title: 'Filme', type: 'movie' }, { key: '4', title: 'Serien', type: 'show' }, { key: '9', title: 'Fotos', type: 'photo' }] } };
}
function friendScript(m, u) {
  if (u.indexOf(A) === 0) return { status: 0, body: '' };                                   // lokale Adresse des Freundes: hier nicht da
  if (u === B + '/identity') return { status: 200, body: { MediaContainer: { machineIdentifier: OTHER } } };
  if (u === B + '/library/sections') return { status: 200, body: sections() };
  if (u.indexOf(B + '/library/sections/3/all') === 0) return { status: 200, body: { MediaContainer: { totalSize: 1, Metadata: [{ ratingKey: '7', type: 'movie', title: 'Film', thumb: '/library/metadata/7/thumb/1', art: '/library/metadata/7/art/1' }] } } };
  if (u.indexOf(B + '/:/scrobble') === 0) return { status: 200, body: '' };
  if (u.indexOf(B + '/library/metadata/7') === 0) return { status: 401, body: '' };
  if (u.indexOf('http://10.0.0.20:32400') === 0) return { status: 200, body: { MediaContainer: {} } };
  return { status: 404, body: '' };
}

test('Profil aktiv: Adressen der Reihe nach, /identity OHNE Token, Token erst an die passende Adresse; Bibliotheken + Speicher ohne Token', function () {
  var w = world(friendScript), N = w.N, S = N.session;
  S.activate(S.user('aaaa1111'), S.cachedToken(S.user('aaaa1111')));
  assert.strictEqual(N.srv.list().length, 1);
  assert.strictEqual(N.srv.state(OTHER), 'idle');
  w.T.tick(3000);                                               // Hintergrund-Pruefung nach dem Start
  assert.strictEqual(N.srv.state(OTHER), 'ok');
  var opened = w.log.opened.filter(function (o) { return o.url.indexOf('10.0.0.20') < 0; });
  H.eq(opened.map(function (o) { return o.url; }), [A + '/identity', B + '/identity', B + '/library/sections']);
  assert.ok(!opened[0].headers['X-Plex-Token'] && !opened[1].headers['X-Plex-Token']);
  assert.strictEqual(opened[2].headers['X-Plex-Token'], 'OTHERTOKEN000000001');
  H.eq(N.srv.libs().map(function (l) { return [l.id, l.title, l.srv, l.srvName]; }), [[3, 'Filme', OTHER, 'Freund'], [4, 'Serien', OTHER, 'Freund']]);
  w.T.tick(5000); var saved = w.disk['srv-aaaa1111.json'];   // Speichern entprellt
  assert.ok(saved && saved.indexOf(B) > 0);
  assert.ok(saved.indexOf('OTHERTOKEN') < 0, 'kein Token im Speicher');
  // naechster Start: zuletzt funktionierende Adresse zuerst
  S.activate(S.user('aaaa1111'), S.cachedToken(S.user('aaaa1111')));
  assert.strictEqual(N.srv.list()[0].uris[0], B);
  assert.strictEqual(N.srv.libs().length, 2);                   // Seitenleiste sofort aus dem Speicher
  // Profil ohne weitere Server
  S.activate(S.user('bbbb2222'), S.cachedToken(S.user('bbbb2222')));
  assert.strictEqual(N.srv.has(), false);
  H.eq(N.srv.libs(), []);
});

test('Anfrage an weiteren Server: eigene Adresse + Token, Eintraege markiert, Bilder ueber diesen Server, 401 meldet nie das eigene Profil ab', function () {
  var w = world(friendScript), N = w.N, S = N.session, expired = 0;
  N.evt.on('auth:expired', function () { expired++; });
  S.activate(S.user('aaaa1111'), S.cachedToken(S.user('aaaa1111')));
  var items = null, err401 = null;
  // Anfrage waehrend die Pruefung noch nicht lief: wartet darauf
  N.plex.get('/library/sections/3/all', { type: 1 }, N.srv.o(OTHER, { timeout: 5000 }), function (e, d) { items = N.model.normList(d.MediaContainer.Metadata, {}, 3); });
  w.T.tick(100);
  assert.ok(items, 'Antwort da');
  assert.strictEqual(items[0].srv, OTHER);
  assert.strictEqual(items[0].thumb, '@' + OTHER + '|/library/metadata/7/thumb/1');
  var last = w.log.opened[w.log.opened.length - 1];
  assert.ok(last.url.indexOf(B + '/library/sections/3/all') === 0);
  assert.strictEqual(last.headers['X-Plex-Token'], 'OTHERTOKEN000000001');
  // ausserhalb des Rueckrufs: keine Markierung (eigener Server)
  assert.strictEqual(N.model.norm({ ratingKey: '1', type: 'movie', thumb: '/t' }).srv, undefined);
  var url = N.img.url(items[0].thumb, 'poster');
  assert.ok(url.indexOf(B + '/photo/:/transcode?') === 0, url);
  assert.ok(url.indexOf('X-Plex-Token=OTHERTOKEN000000001') > 0 && url.indexOf('url=%2Flibrary%2Fmetadata%2F7%2Fthumb%2F1') > 0, url);
  assert.ok(N.img.url('/library/metadata/1/thumb/2', 'poster').indexOf('http://10.0.0.20:32400/photo') === 0, 'eigene Bilder unveraendert');
  // 401 vom fremden Server
  N.plex.get('/library/metadata/7', null, N.srv.o(OTHER), function (e) { err401 = e; });
  w.T.tick(100);
  assert.strictEqual(err401.status, 401); assert.strictEqual(err401.srv, OTHER);
  assert.strictEqual(expired, 0);
  // Gesehen (Gelb) geht an DEN Server
  N.watch.set(items[0], true, {});
  w.T.tick(100);
  var sc = w.log.opened.filter(function (o) { return o.url.indexOf('/:/scrobble') > 0; });
  assert.strictEqual(sc.length, 1); assert.ok(sc[0].url.indexOf(B) === 0);
  assert.strictEqual(sc[0].headers['X-Plex-Token'], 'OTHERTOKEN000000001');
});

test('Server nicht erreichbar: Zustand down, Anfragen scheitern sofort (kein Token irgendwohin), Bilder leer, neuer Versuch nach RETRY', function () {
  var down = true;
  var w = world(function (m, u) {
    if (u.indexOf(A) === 0 || u.indexOf(B) === 0) return down ? { status: 0, body: '' } : friendScript(m, u);
    return friendScript(m, u);
  }), N = w.N, S = N.session;
  S.activate(S.user('aaaa1111'), S.cachedToken(S.user('aaaa1111')));
  w.T.tick(3000);
  assert.strictEqual(N.srv.state(OTHER), 'down');
  var err = null, n0 = w.log.opened.length;
  N.plex.get('/library/sections/3/all', null, N.srv.o(OTHER), function (e) { err = e; });
  w.T.tick(10);
  assert.strictEqual(err.type, 'network'); assert.strictEqual(err.srv, OTHER);
  assert.strictEqual(w.log.opened.length, n0, 'keine neue Anfrage vor Ablauf von RETRY');
  assert.strictEqual(N.img.url('@' + OTHER + '|/x', 'poster'), '');
  assert.ok(w.log.opened.every(function (o) { return !o.headers['X-Plex-Token'] || o.url.indexOf('10.0.0.20') > 0; }), 'Token nie an eine ungepruefte Adresse');
  // Server wieder da: "Erneut versuchen" (resolve force) findet ihn
  down = false;
  var st = null;
  N.srv.resolve(OTHER, true, function (s) { st = s; });
  w.T.tick(100);
  assert.strictEqual(st, 'ok');
});

test('Falsche machineIdentifier unter einer Adresse (anderes Geraet): kein Token dorthin', function () {
  var w = world(function (m, u) {
    if (u === A + '/identity') return { status: 200, body: { MediaContainer: { machineIdentifier: 'ffffffffffffffff' } } };
    return friendScript(m, u);
  }), N = w.N, S = N.session;
  S.activate(S.user('aaaa1111'), S.cachedToken(S.user('aaaa1111')));
  w.T.tick(3000);
  assert.strictEqual(N.srv.state(OTHER), 'ok');
  var toA = w.log.opened.filter(function (o) { return o.url.indexOf(A) === 0; });
  H.eq(toA.map(function (o) { return o.url; }), [A + '/identity']);
  assert.ok(!toA[0].headers['X-Plex-Token']);
});

test('Helfer liefert neue Adressen (GET /servers), wenn keine bekannte passt', function () {
  var NEW = 'http://203.0.113.50:32400';
  var w = world(function (m, u) {
    if (u === 'http://10.0.0.5:32499/neo-helper') return { status: 200, body: { name: 'plex-neo-helper', watchlist: true, discover: true, features: ['watchlist', 'discover', 'servers'] } };
    if (u === 'http://10.0.0.5:32499/servers') return { status: 200, body: { servers: [{ id: OTHER, uris: [NEW, 'https://203.0.113.51:32400', 'http://example.com:1'] }, { id: 'zzzz', uris: ['http://203.0.113.52:1'] }] } };
    if (u === NEW + '/identity') return { status: 200, body: { MediaContainer: { machineIdentifier: OTHER } } };
    if (u === NEW + '/library/sections') return { status: 200, body: sections() };
    if (u.indexOf(A) === 0 || u.indexOf(B) === 0) return { status: 0, body: '' };
    return friendScript(m, u);
  }), N = w.N, S = N.session;
  S.pkg.helper = { url: 'http://10.0.0.5:32499', key: 'k0123456789abcdef0123' };
  S.activate(S.user('aaaa1111'), S.cachedToken(S.user('aaaa1111')));
  w.T.tick(3000);
  assert.strictEqual(N.srv.state(OTHER), 'ok');
  assert.strictEqual(N.srv.conn(OTHER).base, NEW);
  var hs = w.log.opened.filter(function (o) { return o.url === 'http://10.0.0.5:32499/servers'; });
  assert.strictEqual(hs.length, 1);
  assert.ok(!hs[0].headers['X-Plex-Token'], 'nie ein Plex-Token an den Helfer');
  H.eq(N.srv.helperUris({ servers: [{ id: OTHER, uris: [NEW, 'https://203.0.113.51:32400'] }] }, OTHER), [NEW]);
});

/* ---------- Seitenleiste, Schluessel, Decision ---------- */
test('Seitenleiste: eigene IDs unveraendert, weitere Server xlib-<server>-<id>, Speicher-Schluessel getrennt, Decision wan', function () {
  var N = H.load().N;
  H.eq(N.railRows.avail([{ id: 1 }, { id: 3, srv: OTHER }], false).map(function (x) { return x.id; }), ['search', 'home', 'lib-1', 'xlib-' + OTHER + '-3']);
  // neue Bibliothek eines weiteren Servers: eingeschaltet am Ende, gespeicherte Reihenfolge bleibt
  var saved = [{ id: 'home', on: true }, { id: 'lib-1', on: false }, { id: 'search', on: true }];
  H.eq(N.railRows.enabled(saved, N.railRows.avail([{ id: 1 }, { id: 3, srv: OTHER }], false)), ['home', 'search', 'xlib-' + OTHER + '-3']);
  assert.strictEqual(N.srv.skey('', '42'), '42');
  assert.notStrictEqual(N.srv.skey(OTHER, '42'), '42');
  assert.strictEqual(N.anime.key({ type: 'movie', rk: '42' }), '42');
  assert.strictEqual(N.anime.key({ type: 'movie', rk: '42', srv: OTHER }), N.srv.skey(OTHER, '42'));
  assert.strictEqual(N.decision.query({ rk: '1', wan: true }).location, 'wan');
  assert.strictEqual(N.decision.query({ rk: '1' }).location, 'lan');
  assert.strictEqual(N.music.query({ rk: '1', wan: true }).location, 'wan');
  // Bildmarke: nur einmal, leere Pfade bleiben leer
  assert.strictEqual(N.srv.tag(OTHER, ''), '');
  assert.strictEqual(N.srv.tag(OTHER, N.srv.tag(OTHER, '/a')), '@' + OTHER + '|/a');
  H.eq(N.srv.untag('@' + OTHER + '|/a'), { id: OTHER, path: '/a' });
  assert.strictEqual(N.srv.untag('/a'), null);
});

test('Fehlgeschlagene Anfrage (Zeitlimit oder am TV "network"): Server bleibt verbunden, wenn /identity antwortet; Mindest-Zeitlimit; Protokoll (TV-Test 1.0.4)', function () {
  var idOk = true, logs = [];
  var w = world(function (m, u) {
    if (u.indexOf(B + '/library/metadata/9/subtitles') === 0) return { hang: true };
    if (u.indexOf(B + '/library/metadata/8') === 0) return { status: 0, body: '' };
    if (u === B + '/identity' && !idOk) return { status: 0, body: '' };
    return friendScript(m, u);
  }), N = w.N, S = N.session, err = null;
  var log0 = N.log; N.log = function (t) { logs.push(String(t)); return log0.apply(this, arguments); };
  S.activate(S.user('aaaa1111'), S.cachedToken(S.user('aaaa1111')));
  w.T.tick(3000);
  // Mindest-Zeitlimit fuer weitere Server (Internet): 2 s angefragt -> erst nach N.srv.TIMEOUT
  N.plex.get('/library/metadata/9/subtitles', null, N.srv.o(OTHER, { timeout: 2000, retries: 0 }), function (e) { err = e; });
  w.T.tick(2500);
  assert.strictEqual(err, null, 'noch kein Zeitlimit nach 2,5 s');
  w.T.tick(N.srv.TIMEOUT);
  assert.strictEqual(err.type, 'timeout');
  w.T.tick(100);
  assert.strictEqual(N.srv.state(OTHER), 'ok');
  assert.ok(N.srv.conn(OTHER));
  // "network" (am TV auch bei abgebrochenen Anfragen) ebenso erst pruefen
  N.plex.get('/library/metadata/8', null, N.srv.o(OTHER, { retries: 0 }), function () {});
  w.T.tick(100);
  assert.strictEqual(N.srv.state(OTHER), 'ok');
  assert.ok(logs.some(function (l) { return /^srv Freund GET \/library\/metadata\/8 -> network/.test(l); }), logs.join('\n'));
  assert.ok(logs.every(function (l) { return l.indexOf('OTHERTOKEN') < 0 && l.indexOf('203.0.113') < 0; }), 'kein Token/keine Adresse im Protokoll');
  // antwortet auch /identity nicht (mit Wiederholung): down
  idOk = false;
  N.plex.get('/library/metadata/8', null, N.srv.o(OTHER, { retries: 0 }), function () {});
  w.T.tick(3000);
  assert.strictEqual(N.srv.state(OTHER), 'down');
});

test('Seitenleiste: hoechstens 10 Eintraege, Start wird nie abgeschnitten', function () {
  var N = H.load().N, libs = [];
  for (var i = 1; i <= 12; i++) libs.push(i > 6 ? { id: i, srv: OTHER } : { id: i });
  N.ui.rail.libs = libs;
  N.session.settings = { railItems: [{ id: 'search', on: true }].concat(libs.map(function (l) { return { id: N.railRows.libId(l), on: true }; }), [{ id: 'home', on: true }]) };
  var ids = N.ui.rail.order();
  assert.strictEqual(ids.length, 10);
  assert.strictEqual(ids[ids.length - 1], 'home');
});

test('Profilwechsel waehrend der Adresspruefung: Wartende bekommen trotzdem eine Antwort (Review 1.0.5)', function () {
  var w = world(friendScript), N = w.N, S = N.session, called = 0, st = null;
  S.activate(S.user('aaaa1111'), S.cachedToken(S.user('aaaa1111')));
  N.srv.when(OTHER, function () { called++; });
  N.srv.resolve(OTHER, false, function (s) { st = s; });
  assert.strictEqual(called, 0);
  S.activate(S.user('bbbb2222'), S.cachedToken(S.user('bbbb2222')));   // anderes Profil, /identity noch unterwegs
  w.T.tick(30000);
  assert.strictEqual(called, 1, 'when()-Rueckruf darf nicht haengen');
  assert.strictEqual(st, 'none');
});
