'use strict';
/* SRV-6 / DET-13 (Nutzerbefund iPad 05.11.: Infos eines Films auf dem Server eines Freundes kamen langsam bis gar nicht, obwohl
 * die direkte Verbindung schnell ist): Relay nie als "zuerst probieren" gemerkt, ueber das Relay verbunden -> direkte Adresse
 * spaeter erneut pruefen; langsame Anfragen (> 3 s) als Warnung im Protokoll (ohne Token); Nachlade-Anfrage hoechstens eine
 * Wiederholung. Ohne Netz; nur Beispieladressen (RFC 5737 / RFC 1918, plex.direct-Muster erfunden). */
var test = require('node:test'), assert = require('node:assert');
var H = require('./helpers/load');

var OTHER = 'aaaa1111bbbb2222cccc3333dddd4444eeee5555';
var DIRECT = 'https://203-0-113-7.0123456789abcdef.plex.direct:32400', LOCAL = 'http://172.20.0.5:32400',
  RELAY = 'https://198-51-100-9.0123456789abcdef.plex.direct:8443';
var TOKEN = 'OTHERTOKEN000000001';

function world(script, cache) {
  var ctx = H.load({ fakeTimers: true }), N = ctx.N, T = ctx.timers, disk = {};
  if (cache) disk['srv-u1.json'] = JSON.stringify(cache);
  N.store.init({ read: function (n) { return disk[n] === undefined ? null : disk[n]; }, write: function (n, t) { disk[n] = t; } });
  var x = H.FakeXHR(function (m, u, n, req) { var r = script(m, u, req); if (r) r.timers = T; return r; });
  N.http._setFactory(x.factory);
  N.diag.ring = [];
  N.srv.setProfile([{ machineId: OTHER, name: 'Freund', uris: [DIRECT, LOCAL, RELAY], relays: [RELAY], token: TOKEN }], 'u1');
  return { N: N, T: T, disk: disk, log: x.log, warns: function () { return N.diag.ring.filter(function (l) { return / WARN /.test(l); }); } };
}
function ident() { return { status: 200, body: { MediaContainer: { machineIdentifier: OTHER } } }; }
function libs() { return { status: 200, body: { MediaContainer: { Directory: [{ key: '3', title: 'Filme', type: 'movie' }] } } }; }

test('SRV-6: zuletzt ueber das Relay verbunden -> beim naechsten Start trotzdem zuerst die direkte Adresse (TV: setup.json ohne Relays unveraendert)', function () {
  var w = world(function () { return null; }, { v: 1, s: { aaaa1111bbbb2222cccc3333dddd4444eeee5555: { uri: RELAY, libs: [], ts: 1 } } });
  assert.strictEqual(w.N.srv.list()[0].uris[0], DIRECT, 'Relay nicht nach vorn');
  var w2 = world(function () { return null; }, { v: 1, s: { aaaa1111bbbb2222cccc3333dddd4444eeee5555: { uri: LOCAL, libs: [], ts: 1 } } });
  assert.strictEqual(w2.N.srv.list()[0].uris[0], LOCAL, 'andere zuletzt funktionierende Adresse weiter zuerst');
});

test('SRV-6: direkte Adresse antwortet beim Start nicht -> Relay (Warnung); nach 30 s wieder direkt, Anfragen und Bilder laufen darueber', function () {
  var directUp = false;
  var w = world(function (m, u) {
    if (u.indexOf(DIRECT) === 0) return directUp ? (/\/identity$/.test(u) ? ident() : { status: 200, body: { MediaContainer: {} } }) : { status: 0, body: '' };
    if (u.indexOf(LOCAL) === 0) return { hang: true };                       // anderes Netz: Zeitueberschreitung
    if (u === RELAY + '/identity') return ident();
    if (u === RELAY + '/library/sections') return libs();
    if (u.indexOf(RELAY) === 0) return { status: 200, body: { MediaContainer: {} } };
    return { status: 404, body: '' };
  }), N = w.N;
  N.srv.resolve(OTHER);
  w.T.tick(6000);
  assert.strictEqual(N.srv.state(OTHER), 'ok');
  assert.strictEqual(N.srv.conn(OTHER).base, RELAY);
  assert.ok(w.warns().some(function (l) { return /Relay/.test(l); }), 'Warnung: ueber Relay');
  directUp = true;
  w.T.tick(31000);
  assert.strictEqual(N.srv.conn(OTHER).base, DIRECT, 'direkte Adresse wieder gewaehlt');
  var url = N.img.url('@' + OTHER + '|/library/metadata/7/thumb/1', 'poster');
  assert.ok(url.indexOf(DIRECT + '/photo/:/transcode?') === 0, 'Bilder ueber die direkte Adresse');
  var probes = w.log.opened.filter(function (o) { return o.url === DIRECT + '/identity'; });
  probes.forEach(function (p) { assert.ok(!p.headers['X-Plex-Token'], 'Pruefung ohne Token'); });
});

test('SRV-6: Anfrage an weiteren Server > 3 s -> Warnung im Protokoll (ohne Token/Query), schnelle Anfrage nur als Info', function () {
  var w = world(function (m, u) {
    if (/\/identity$/.test(u)) return ident();
    if (/\/library\/sections$/.test(u)) return libs();
    if (u.indexOf('/library/metadata/7?') > 0) return { status: 200, body: { MediaContainer: { Metadata: [{ ratingKey: '7' }] } }, delay: 3500 };
    if (u.indexOf('/library/metadata/8') > 0) return { status: 200, body: { MediaContainer: { Metadata: [{ ratingKey: '8' }] } }, delay: 200 };
    return { status: 404, body: '' };
  }), N = w.N;
  N.srv.resolve(OTHER); w.T.tick(100);
  var ok7 = false, ok8 = false;
  N.plex.get('/library/metadata/7', { includeRelated: 1 }, N.srv.o(OTHER), function (e) { ok7 = !e; });
  N.plex.get('/library/metadata/8', null, N.srv.o(OTHER), function (e) { ok8 = !e; });
  w.T.tick(4000);
  assert.ok(ok7 && ok8);
  var warns = w.warns().filter(function (l) { return /GET/.test(l); });
  assert.strictEqual(warns.length, 1, warns.join('\n'));
  assert.ok(/\/library\/metadata\/7 -> ok 3\d\d\d ms/.test(warns[0]), warns[0]);
  assert.ok(warns[0].indexOf(TOKEN) < 0 && warns[0].indexOf('includeRelated') < 0 && warns[0].indexOf('plex.direct') < 0, 'kein Token, keine Query, keine Adresse');
  assert.ok(N.diag.ring.some(function (l) { return / INFO .*\/library\/metadata\/8 -> ok/.test(l); }), 'schnelle Anfrage als Info');
});

test('DET-13: Nachlade-Anfrage (retries 1) an langsamen Server: hoechstens 2 Versuche, Fehler nach ~50 s statt ~77 s', function () {
  var w = world(function (m, u) {
    if (/\/identity$/.test(u)) return ident();
    if (/\/library\/sections$/.test(u)) return libs();
    if (u.indexOf('/library/metadata/7') > 0) return { hang: true };
    return { status: 404, body: '' };
  }), N = w.N, err = null, t0;
  N.srv.resolve(OTHER); w.T.tick(100);
  t0 = N.util.now();
  N.plex.get('/library/metadata/7', N.det.moreQuery(), N.srv.o(OTHER, { timeout: 12000, retries: N.det.MORE_RETRIES, dedupe: false }), function (e) { err = e; err.at = N.util.now() - t0; });
  w.T.tick(60000);
  assert.ok(err && err.type === 'timeout', 'Fehler gemeldet');
  assert.strictEqual(w.log.opened.filter(function (o) { return o.url.indexOf('/library/metadata/7') > 0; }).length, 2, 'genau 2 Versuche');
  assert.ok(err.at >= 50000 && err.at <= 51000, 'Frist je Versuch 25 s (N.srv.TIMEOUT): ' + err.at);
});
