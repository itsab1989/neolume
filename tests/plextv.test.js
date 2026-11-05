'use strict';
/* plex.tv direkt (N.ptv, caps.plexTvDirect – SPEC B-1, DISC-2/4/5): auf Apple kommen Entdecken-Reihen, Merkliste und Details fremder
 * Titel ohne Helfer direkt von plex.tv – mit denselben Regeln und derselben Kuerzung wie installer/neosetup/helper.py (gemeinsame
 * Vorlage tests/synthetic/plextv-slim.json, gleich geprueft in tests/installer/test_helper.py). Kein Netz: Antworten per Attrappe
 * (FakeXHR an der Stelle des nativen Netzes), nur erfundene Titel/Kennungen, Beispieladressen (RFC 1918). Der Fernseher bleibt beim
 * Helfer: dort ist N.ptv aus und schickt keine einzige Anfrage. */
var nodeTest = require('node:test'), test = require('./helpers/load').appleTest(nodeTest), assert = require('node:assert');
var H = require('./helpers/load'), eq = H.eq;
var F = H.synthetic('plextv-slim.json');

var A = 'a'.repeat(24), B = 'b'.repeat(24), C = 'c'.repeat(24), D = 'd'.repeat(24);
var ACC = 'ACCOUNTTOKEN-demo-000001', HOME = 'HOMEUSERTOKEN-demo-0001', SRV = 'SERVERTOKEN-demo-000001';
var PMS = 'http://192.168.1.10:32400', LIBS = [{ id: 1, title: 'Filme', type: 'movie' }, { id: 2, title: 'Serien', type: 'show' }];
var USERS = [{ uuid: 'u-owner', name: 'Inhaber', admin: true, kind: 'main' }, { uuid: 'u-home', name: 'Mitbewohner', kind: '' },
  { uuid: 'u-pin', name: 'Mit PIN', kind: '', pin: true }, { uuid: 'u-kid', name: 'Kind', kind: 'kid' }];

function md(hex, type, title, date, extra) {
  var m = { guid: 'plex://' + type + '/' + hex, ratingKey: hex, type: type, title: title, year: 2026, summary: 'Erfunden.', originallyAvailableAt: date || '',
    thumb: 'https://image.tmdb.org/t/p/x' + hex.slice(0, 4) + '.jpg', Media: [{ url: 'https://vod.example/streams/main.m3u8' }], publicPagesURL: 'https://watch.plex.tv/x', userState: false };
  for (var k in extra || {}) m[k] = extra[k];
  return m;
}
function mc(list) { return { MediaContainer: { size: list.length, totalSize: list.length, Metadata: list } }; }
function today() { var d = new Date(); return d.toISOString().slice(0, 10); }
function shift(days) { return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10); }

/* Apple-App ohne Geruest: plex.tv-Antworten + PMS (GUID-Abgleich) als Attrappe des nativen Netzes */
function apple(opts) {
  opts = opts || {};
  var ctx = H.load({ platform: opts.platform || 'apple' }), N = ctx.N, logs = [], wl = { ids: opts.wl || [A] };
  N.i18n.set('de');
  var x = H.FakeXHR(function (method, url, n, req) {
    var u = String(url), path = u.replace(/^https?:\/\/[^\/]+/, '').split('?')[0];
    if (opts.fail && opts.fail(u)) return { status: opts.failStatus || 500, body: '' };
    if (u.indexOf('https://plex.tv/api/v2/home/users/') === 0 && /\/switch$/.test(path)) return { status: 201, body: { authToken: HOME } };
    if (u.indexOf('https://discover.provider.plex.tv/hubs/sections/home/') === 0) {
      var name = path.split('/').pop();
      if (name === 'top_watchlisted') return { status: 200, body: mc([md(A, 'movie', 'Film A', shift(-20)), md(B, 'show', 'Serie B', shift(-400)),
        md(C, 'movie', 'Film C', shift(30), { thumb: 'https://images.plex.tv/p?X-Plex-Token=geheim' }), { guid: 'plex://season/' + D, type: 'season', title: 'Staffel' }]) };
      if (name === 'recently-released-family') return { status: 200, body: mc([md(D, 'movie', 'Film D', shift(-3))]) };
      return { status: 200, body: mc([md(C, 'movie', 'Film C', shift(30)), md(B, 'show', 'Serie B', shift(10))]) };
    }
    if (u.indexOf('https://discover.provider.plex.tv/library/sections/watchlist/all') === 0) {
      return { status: 200, body: mc(wl.ids.map(function (h) { return md(h, 'movie', 'Gemerkt ' + h.slice(0, 1), shift(-50)); })) };
    }
    if (/^https:\/\/discover\.provider\.plex\.tv\/library\/metadata\/.*\/userState$/.test(u)) {
      var ids = path.split('/')[3].split(',');
      return { status: 200, body: { MediaContainer: { UserState: ids.map(function (h) { return wl.ids.indexOf(h) >= 0 ? { ratingKey: h, watchlistedAt: 1 } : { ratingKey: h }; }) } } };
    }
    if (u.indexOf('https://discover.provider.plex.tv/actions/') === 0) {
      var rk = /ratingKey=([0-9a-f]+)/.exec(u)[1];
      if (/addToWatchlist/.test(path)) wl.ids.unshift(rk); else wl.ids = wl.ids.filter(function (h) { return h !== rk; });
      return { status: 200, body: '' };
    }
    if (u.indexOf('https://metadata.provider.plex.tv/library/metadata/') === 0) {
      return { status: 200, body: mc([md(path.split('/').pop(), 'movie', 'Film A', '2024-05-01', { tagline: 'Kurz.', duration: 5460000, audienceRating: 7.8,
        Genre: [{ tag: 'Drama' }], Role: [{ tag: 'Person 1', role: 'Rolle', thumb: 'http://evil.example/x.jpg' }], art: 'https://metadata-static.plex.tv/a/art.jpg' })]) };
    }
    if (u.indexOf(PMS + '/library/all') === 0) {                                      // GUID-Abgleich: Film A liegt auf dem Server
      return { status: 200, body: { MediaContainer: { Metadata: /plex%3A%2F%2Fmovie%2Fa{24}/.test(u) ? [{ ratingKey: '77', type: 'movie', title: 'Film A', guid: 'plex://movie/' + A }] : [] } } };
    }
    if (u.indexOf(PMS) === 0) return { status: 200, body: { MediaContainer: { size: 0 } } };
    return { status: 599, body: '' };                                                  // alles andere: kein bekannter Weg
  });
  N.http._reset(); N.http._setFactory(x.factory);
  var disk = {};
  N.store.init({ read: function (k) { return disk[k] === undefined ? null : disk[k]; }, write: function (k, t) { disk[k] = t; return true; } });
  var S = N.session;
  S.state = { v: 1, clientId: 'cid-demo', account: { token: ACC, uuid: 'u-owner', name: 'Inhaber' }, server: { uri: PMS, machineId: 'm1' },
    users: USERS, usersTs: 0, profiles: {}, lastProfile: null };
  S.pkg = null;
  S.profile = USERS[opts.profile || 0];
  S.settings = opts.settings || {};
  N.plex.setServer(PMS, SRV); N.plex.clientId = 'cid-demo';
  var dlog = N.diag.log;
  N.diag.log = function (lv, m) { logs.push(String(m)); return dlog.apply(N.diag, arguments); };
  var nlog = N.log;
  N.log = function (m) { logs.push(String(m)); if (nlog) return nlog.apply(null, arguments); };
  N.ptv._reset(); N.insp._reset(); N.disc._resetHelper(); N.disc._resetInfo();
  return { N: N, ctx: ctx, x: x, wl: wl, logs: logs, disk: disk };
}
function settle(ms) { return new Promise(function (r) { setTimeout(r, ms || 20); }); }
function urls(a) { return a.x.log.opened.map(function (o) { return o.method + ' ' + o.url; }); }
function noSecrets(a) {
  var all = a.logs.join('\n') + '\n' + a.N.diag.ring.join('\n');
  [ACC, HOME, SRV].forEach(function (t) { assert.ok(all.indexOf(t) < 0, 'Token im Protokoll'); });
  a.x.log.opened.forEach(function (o) { [ACC, HOME, SRV].forEach(function (t) { assert.ok(o.url.indexOf(t) < 0, 'Token in der Adresse ' + o.url); }); });
}
/* jede Anfrage: plex.tv-Katalog nur ueber die Liste (N.ptv.allowed), sonst nur der eigene PMS oder der Profilwechsel bei plex.tv */
function onlyAllowed(a) {
  a.x.log.opened.forEach(function (o) {
    var ok = a.N.ptv.allowed(o.method, o.url) || o.url.indexOf(PMS + '/') === 0 || /^https:\/\/plex\.tv\/api\/v2\/home\/users\/[^\/]+\/switch$/.test(o.url);
    assert.ok(ok, 'nicht erlaubte Anfrage: ' + o.method + ' ' + o.url);
    assert.ok(!/:32499/.test(o.url), 'nie an einen Helfer');
  });
}

/* ---------------------------------------------------------------- reine Logik = helper.py (gemeinsame Vorlage) */
nodeTest('Abgleich mit helper.py: upstream_allowed / safe_img / slim / details_slim / pick / userState gleich (plextv-slim.json)', function () {
  var P = H.load().N.ptv;
  F.allowed.forEach(function (c) { assert.strictEqual(P.allowed(c[0], c[1]), c[2], c[0] + ' ' + c[1]); });
  F.safe_img.forEach(function (c) { assert.strictEqual(P.safeImg(c[0]), c[1], String(c[0])); });
  F.slim.forEach(function (c, i) { eq(P.slim(c[0]), c[1], 'slim #' + i); });
  F.details_slim.forEach(function (c, i) { eq(P.detailsSlim(c[0]), c[1], 'details_slim #' + i); });
  F.pick.forEach(function (c) { eq(P.pick(F.pick_items, c.type, c.when, c.today, c.size), c.out, [c.type, c.when, c.size].join()); });
  F.state.forEach(function (c, i) { eq(P.stateOf(c[0], c[1]), c[2], 'state #' + i); });
  assert.ok(F.allowed.length > 30 && F.slim.length > 15 && F.details_slim.length > 5 && F.pick.length === 18);
});

nodeTest('Routen wie der Helfer geprueft: feste Pfade, erlaubte Schluessel, Grenzen (Merkliste <= 50, Liste <= 30, ids <= 30)', function () {
  var P = H.load().N.ptv;
  eq(P.parse('GET', '/watchlist?type=all&start=0&size=50'), { r: 'watchlist', type: 'all', start: 0, size: 50 });
  eq(P.parse('GET', '/discover/new?type=show&size=30'), { r: 'discover', list: 'new', type: 'show', size: 30 });
  eq(P.parse('PUT', '/watchlist/' + A), { r: 'set', id: A, on: true });
  eq(P.parse('DELETE', '/watchlist/' + A), { r: 'set', id: A, on: false });
  eq(P.parse('GET', '/watchlist/state?ids=' + A + ',' + A + ',' + B), { r: 'state', ids: [A, B] });
  eq(P.parse('GET', '/details?id=' + A + '&lang=nb'), { r: 'details', id: A, lang: 'nb' });
  function code(m, p) { var r = P.parse(m, p); return r.err ? r.err.status + ' ' + r.err.body.error : 'ok'; }
  assert.strictEqual(code('GET', '/watchlist?size=51'), '400 size');
  assert.strictEqual(code('GET', '/discover/new?type=show&size=31'), '400 size');
  assert.strictEqual(code('GET', '/discover/new?size=5'), '400 type');
  assert.strictEqual(code('GET', '/discover/popular?type=movie'), '404 route');
  assert.strictEqual(code('GET', '/watchlist?type=all&type=movie'), '400 query');
  assert.strictEqual(code('GET', '/watchlist?url=https://evil.example'), '400 query');
  assert.strictEqual(code('GET', '/watchlist/state?ids=' + new Array(32).join(A + ',') + A), '400 ids');
  assert.strictEqual(code('GET', '/watchlist/' + A), '405 method');
  assert.strictEqual(code('PUT', '/watchlist/xyz'), '400 id');
  assert.strictEqual(code('GET', '/details?id=' + A + '&lang=fr'), '400 lang');
  assert.strictEqual(code('GET', '/servers'), '404 route');                   // Weitere Server: auf Apple ueber plex.tv-Ressourcen (SRV-5), nicht hier
  assert.strictEqual(code('GET', '/live/open?ch=x'), '404 route');
});

test('Vertrag: caps.plexTvDirect nur mit tls12; Apple an, Fernseher aus', function () {
  var N = H.load().N, Pl = N.Platform;
  assert.strictEqual(Pl.defaults().plexTvDirect, false);
  assert.strictEqual(N.platform.caps.plexTvDirect, false);
  var tv = { id: 'x', info: { platform: 'a', platformVersion: '1', device: 'd', short: 's' }, init: function () {}, keys: { name: function () {}, register: function () {}, cap: { EXIT: '', DIGITS: '', ENTER: '', INFO: '', TOOLS: '' } },
    store: function () {}, player: { create: function () {}, close: function () {}, surface: 'plane' }, tv: { saver: function () {}, exit: function () {}, language: function () {} },
    screen: { toApp: function () {} }, net: { plexTv: function () {}, kind: function () {} }, caps: { plexTvDirect: true } };
  assert.ok(Pl.check(tv).some(function (e) { return /plexTvDirect braucht tls12/.test(e); }));
  tv.caps.tls12 = true; tv.caps.setupFile = false;
  eq(Pl.check(tv), []);
  tv.caps.plexTvDirect = 'ja';
  assert.ok(Pl.check(tv).some(function (e) { return /caps.plexTvDirect muss true\/false/.test(e); }));
  assert.strictEqual(H.load({ platform: 'apple' }).N.platform.caps.plexTvDirect, true);
});

/* ---------------------------------------------------------------- Apple: ohne Helfer */
test('Apple ohne Helfer: Entdecken-Reihen (Gerade beliebt / Neu erschienen / Bald verfuegbar) erscheinen, gekuerzt, nur erlaubte Hosts', async function () {
  var a = apple(), N = a.N, D = N.disc, I = N.insp, rows = {};
  assert.strictEqual(D.helper(), '', 'kein Helfer');
  assert.strictEqual(D.direct(), true);
  assert.strictEqual(I.helperOn(), true, 'Stufe 2 an ohne Helfer-Probe');
  assert.strictEqual(D.helperState(), 'ok');
  assert.ok(D.helperHas('details') && D.helperHas('nb') && !D.helperHas('servers') && !D.helperHas('live'));
  var avail = I.avail(LIBS, null, I.helperOn()).map(function (r) { return r.id; });
  ['trend-movie', 'trend-show', 'new-movie', 'new-show', 'soon-movie', 'soon-show'].forEach(function (id) { assert.ok(avail.indexOf(id) >= 0, id); });
  N.session.settings = { inspHideOwn: false };                                        // alle Titel mit Marke (Abgleich sichtbar)
  await new Promise(function (r) { I.load(['trend-movie', 'new-movie', 'soon-movie', 'soon-show'], LIBS, {}, function (id, row, err) { rows[id] = { row: row, err: err }; }, r); });
  var t = rows['trend-movie'];
  assert.ok(!t.err && t.row, 'Gerade beliebt: Filme');
  eq(t.row.items.map(function (i) { return i.title + '|' + (i.mark || ''); }), ['Film A|disc.onServer', 'Film C|disc.notOnServer']);
  assert.strictEqual(t.row.items[0].rk, '77', 'eigener Titel = abspielbare Karte vom Server');
  assert.strictEqual(t.row.items[1].thumb, '', 'Bild mit Token in der Adresse faellt weg (safe_img)');
  eq(rows['new-movie'].row.items.map(function (i) { return i.title; }), ['Film D', 'Film A']);   // letzte 180 Tage, neueste zuerst
  eq(rows['soon-movie'].row.items.map(function (i) { return i.title; }), ['Film C']);
  eq(rows['soon-show'].row.items.map(function (i) { return i.title; }), ['Serie B']);
  var u = urls(a);
  assert.ok(u.some(function (s) { return /^GET https:\/\/discover\.provider\.plex\.tv\/hubs\/sections\/home\/top_watchlisted\?X-Plex-Container-Start=0&X-Plex-Container-Size=60$/.test(s); }), u.join('\n'));
  assert.strictEqual(u.filter(function (s) { return /top_watchlisted/.test(s); }).length, 1, 'Hub 15 min gemerkt: EINE Anfrage fuer Gerade beliebt + Neu erschienen');
  var hubReq = a.x.log.opened.filter(function (o) { return /provider\.plex\.tv/.test(o.url); })[0];
  assert.strictEqual(hubReq.headers['X-Plex-Token'], ACC, 'Listen mit dem plex.tv-Token des Inhabers');
  assert.strictEqual(hubReq.headers['X-Plex-Client-Identifier'], 'cid-demo');
  onlyAllowed(a); noSecrets(a);
});

test('Apple: Antwort wie der Helfer gekuerzt (nur id/type/guid/title/year/summary/thumb), Groesse begrenzt', async function () {
  var a = apple(), N = a.N, d = await new Promise(function (r) { N.disc.helperGet('/discover/trending?type=movie&size=30', function (e, x) { r(x); }); });
  eq(Object.keys(d.items[0]).sort(), ['guid', 'id', 'summary', 'thumb', 'title', 'type', 'year']);
  assert.ok(JSON.stringify(d).indexOf('vod.example') < 0 && JSON.stringify(d).indexOf('watch.plex.tv') < 0 && JSON.stringify(d).indexOf('geheim') < 0);
  var big = apple({ fail: function () { return false; } });
  big.x.log.opened.length = 0;
  big.N.http._setFactory(H.FakeXHR(function () { return { status: 200, body: JSON.stringify(mc([md(A, 'movie', 'x'.repeat(270000), '')])) }; }).factory);
  var err = await new Promise(function (r) { big.N.disc.helperGet('/discover/soon?type=movie&size=5', function (e) { r(e); }); });
  assert.strictEqual(err.status, 502); assert.strictEqual(err.body.error, 'too_large');
});

test('Apple: Merkliste lesen, merken und entfernen wie am TV (Inhaber), Abgleich mit dem Server, Reihe sofort angepasst', async function () {
  var a = apple(), N = a.N, D = N.disc;
  assert.strictEqual(D.watchlistOn(), true);
  var items = await new Promise(function (r) { D.wl.listMarked({}, function (e, l) { assert.ifError(e); r(l); }); });
  eq(items.map(function (i) { return i.title + '|' + i.mark; }), ['Film A|disc.onServer']);
  var ext = D.extItem({ guid: 'plex://movie/' + B, name: 'Serie B' }, 'movie'), changed = null;
  N.evt.on('watchlist:changed', function (e) { changed = e; });
  assert.strictEqual(await new Promise(function (r) { D.wl.state(ext, r); }), false);
  await new Promise(function (r) { D.wl.set(ext, true, function (e) { assert.ifError(e); r(); }); });
  assert.ok(changed && changed.on === true && D.wl.has(ext));
  assert.strictEqual(await new Promise(function (r) { D.wl.state(ext, r); }), true);
  var l2 = await new Promise(function (r) { D.wl.list(function (e, l) { r(l); }); });
  eq(l2.map(function (i) { return i.guid; }), ['plex://movie/' + B, 'plex://movie/' + A], 'nach dem Merken frisch (Zwischenspeicher verworfen)');
  await new Promise(function (r) { D.wl.set(ext, false, function (e) { assert.ifError(e); r(); }); });
  assert.strictEqual(D.wl.has(ext), false);
  var u = urls(a);
  assert.ok(u.indexOf('PUT https://discover.provider.plex.tv/actions/addToWatchlist?ratingKey=' + B) >= 0);
  assert.ok(u.indexOf('PUT https://discover.provider.plex.tv/actions/removeFromWatchlist?ratingKey=' + B) >= 0);
  assert.ok(u.some(function (s) { return /watchlist\/all\?includeCollections=0&includeExternalMedia=0&X-Plex-Container-Start=0&X-Plex-Container-Size=50$/.test(s); }));
  a.x.log.opened.filter(function (o) { return /provider\.plex\.tv/.test(o.url); }).forEach(function (o) { assert.strictEqual(o.headers['X-Plex-Token'], ACC); });
  onlyAllowed(a); noSecrets(a);
});

test('Apple: Plex-Home-Profil ohne PIN – EIN Profilwechsel, dann Merkliste mit dessen Token (nur im Speicher); mit PIN: Token aus dem Oeffnen', async function () {
  var a = apple({ profile: 1 }), N = a.N, D = N.disc;
  await new Promise(function (r) { D.wl.list(function (e) { assert.ifError(e); r(); }); });
  await new Promise(function (r) { D.wl.state(D.extItem({ guid: 'plex://movie/' + A, name: 'A' }, 'movie'), function () { r(); }); });
  var sw = a.x.log.opened.filter(function (o) { return /\/switch$/.test(o.url); });
  assert.strictEqual(sw.length, 1, 'Token einmal geholt, danach gemerkt');
  a.x.log.opened.filter(function (o) { return /provider\.plex\.tv/.test(o.url); }).forEach(function (o) { assert.strictEqual(o.headers['X-Plex-Token'], HOME); });
  assert.ok(JSON.stringify(N.store.get('state.json') || {}).indexOf(HOME) < 0, 'nie gespeichert');
  N.store.flush && N.store.flush();
  // PIN-Profil: ohne Oeffnen kein Token -> wie der Helfer 404 profile -> Merkliste fuer das Profil aus (kein Profilwechsel ohne PIN)
  var b = apple({ profile: 2 }), Db = b.N.disc;
  var err = await new Promise(function (r) { Db.wl.list(function (e) { r(e); }); });
  assert.strictEqual(err.helper, 'profile'); assert.strictEqual(Db.watchlistOn(), false);
  assert.strictEqual(b.x.log.opened.filter(function (o) { return /\/switch$/.test(o.url); }).length, 0);
  // PIN-Profil geoeffnet (tokenFor mit PIN): der Token aus dem Wechsel gilt fuer die Merkliste
  var c = apple({ profile: 2 }), Nc = c.N;
  Nc.auth.serverTokenFor = function (ut, mid, cb) { cb(null, SRV, []); };
  await new Promise(function (r) { Nc.session.tokenFor(USERS[2], '1234', function (e) { assert.ifError(e); r(); }); });
  await new Promise(function (r) { Nc.disc.wl.list(function (e) { assert.ifError(e); r(); }); });
  c.x.log.opened.filter(function (o) { return /provider\.plex\.tv/.test(o.url); }).forEach(function (o) { assert.strictEqual(o.headers['X-Plex-Token'], HOME); });
  assert.ok(JSON.stringify(Nc.store.get('state.json') || {}).indexOf(HOME) < 0 && JSON.stringify(c.disk).indexOf(HOME) < 0, 'Token des Profils nie gespeichert');
  noSecrets(a); noSecrets(b); noSecrets(c);
});

test('Apple: Kinderprofil – keine Reihen, keine Merkliste, keine Anfrage an plex.tv (wie am TV)', async function () {
  var a = apple({ profile: 3 }), N = a.N;
  assert.strictEqual(N.disc.discoverOn(), false); assert.strictEqual(N.disc.watchlistOn(), false); assert.strictEqual(N.insp.helperOn(), false);
  await new Promise(function (r) { N.insp.load(['trend-movie'], LIBS, {}, function () {}, r); });
  await new Promise(function (r) { N.disc.wl.list(function () { r(); }); });
  assert.strictEqual(a.x.log.opened.filter(function (o) { return /plex\.tv/.test(o.url); }).length, 0);
});

test('Apple: Details eines fremden Titels direkt aus dem Katalog (Sprache, gekuerzt, Bilder nur bekannter Hosts), 6 h gemerkt', async function () {
  var a = apple(), N = a.N, it = N.disc.extItem({ guid: 'plex://movie/' + A, name: 'Film A' }, 'movie');
  N.i18n.set('nb');
  var x = await new Promise(function (r) { N.disc.details(it, function (e, v) { assert.ifError(e); r(v); }); });
  assert.strictEqual(x.tagline, 'Kurz.'); assert.strictEqual(x.dur, 5460000); assert.strictEqual(x.rating, 7.8);
  assert.strictEqual(x.cast[0].thumb, '', 'Bild eines fremden Hosts faellt weg');
  assert.strictEqual(x.art, 'https://metadata-static.plex.tv/a/art.jpg');
  var req = a.x.log.opened.filter(function (o) { return /metadata\.provider/.test(o.url); });
  assert.strictEqual(req.length, 1); assert.strictEqual(req[0].url, 'https://metadata.provider.plex.tv/library/metadata/' + A);
  assert.strictEqual(req[0].headers['X-Plex-Language'], 'nb');
  N.disc._resetInfo();                                                                 // Speicher der App leer -> N.ptv antwortet aus seinem
  await new Promise(function (r) { N.disc.details(it, function () { r(); }); });
  assert.strictEqual(a.x.log.opened.filter(function (o) { return /metadata\.provider/.test(o.url); }).length, 1);
  noSecrets(a);
});

test('Apple: plex.tv-Fehler – kein "Helfer nicht erreichbar", Reihe faellt weg, abgelaufenes Token wird vergessen', async function () {
  var a = apple({ profile: 1, fail: function (u) { return /provider\.plex\.tv/.test(u); }, failStatus: 401 }), N = a.N, toast = 0;
  N.ui = N.ui || {}; N.ui.toast = { show: function () { toast++; } };
  var err = await new Promise(function (r) { N.disc.wl.list(function (e) { r(e); }); });
  assert.strictEqual(err.status, 502); assert.strictEqual(err.body.error, 'plex_auth'); assert.strictEqual(err.helper, '');
  assert.strictEqual(N.disc.helperState(), 'ok'); assert.strictEqual(N.disc.watchlistOn(), true);
  await new Promise(function (r) { N.disc.wl.list(function () { r(); }); });
  assert.strictEqual(a.x.log.opened.filter(function (o) { return /\/switch$/.test(o.url); }).length, 2, 'nach plex_auth neuer Profilwechsel');
  var net = apple({ fail: function (u) { return /provider\.plex\.tv/.test(u); }, failStatus: 0 });
  net.N.ui = net.N.ui || {}; net.N.ui.toast = { show: function () { toast++; } };
  var row = await new Promise(function (r) { net.N.insp.load(['trend-movie'], LIBS, {}, function (id, rw, e) { r({ rw: rw, e: e }); }, function () {}); });
  assert.ok(row.e && !row.rw); assert.strictEqual(net.N.disc.helperState(), 'ok'); assert.strictEqual(toast, 0);
});

test('Apple: Einstellungen – Merkliste sichtbar und schaltbar (ohne Helfer), "Nur Titel, die du noch nicht hast" schaltbar', function () {
  var fs = require('fs'), path = require('path'), vm = require('vm');
  var a = apple(), N = a.N, src = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'settings.js'), 'utf8');
  src = src.replace('    s.create = function (root) {', '    s.__defs = defs;\n    s.create = function (root) {');
  var factory = null, def = N.router.define;
  N.router.define = function (n, f) { if (n === 'settings') factory = f; };
  vm.runInContext(src, a.ctx);
  N.router.define = def;
  N.ui.rail = N.ui.rail || {}; N.ui.rail.order = function () { return []; };
  N.srv = { has: function () { return false; }, list: function () { return []; } };
  var S = N.session, set = {};
  S.homeCache = function () { return { libs: LIBS }; }; S.hubCatalog = function () { return null; };
  S.setSetting = function (k, v) { set[k] = v; S.settings[k] = v; };
  var rows = {};
  factory().__defs().forEach(function (c) { c.rows.forEach(function (r) { rows[r.id] = r; }); });
  var w = rows.watchlist;
  assert.ok(w, 'Zeile Merkliste fehlt'); assert.strictEqual(w.type, 'toggle');
  assert.strictEqual(w.get(), true); assert.strictEqual(w.disabled(), false);
  w.set(false); assert.strictEqual(set.watchlist, false); assert.strictEqual(N.disc.watchlistOn(), false);
  assert.ok(rows.inspHideOwn && rows.inspHideOwn.disabled() === false);
  assert.strictEqual(a.x.log.opened.length, 0, 'keine Helfer-Probe, keine Anfrage');
});

/* ---------------------------------------------------------------- Fernseher: unveraendert */
nodeTest('Fernseher (samsung-orsay): N.ptv aus, kein Helfer -> keine Reihen, keine Merkliste, KEINE Anfrage (auch nicht an plex.tv)', async function () {
  var ctx = H.load(), N = ctx.N, x = H.FakeXHR(function () { return { status: 200, body: {} }; });
  N.http._setFactory(x.factory);
  N.session.state = { account: { token: ACC, uuid: 'u-owner' }, users: USERS, profiles: {} };
  N.session.pkg = null; N.session.profile = USERS[0]; N.session.settings = {};
  N.ptv.remember('u-home', HOME);
  assert.strictEqual(N.ptv.on(), false); assert.strictEqual(N.disc.direct(), false);
  assert.strictEqual(N.disc.discoverOn(), false); assert.strictEqual(N.disc.watchlistOn(), false); assert.strictEqual(N.disc.helperState(), 'none');
  assert.strictEqual(N.disc.helperHas('details'), false);
  var e1 = await new Promise(function (r) { N.disc.helperGet('/discover/trending?type=movie&size=20', function (e) { r(e); }); });
  var e2 = await new Promise(function (r) { N.ptv.request('GET', '/watchlist?type=all&start=0&size=50', function (e) { r(e); }); });
  assert.strictEqual(e1.type, 'nohelper'); assert.strictEqual(e2.type, 'nohelper');
  N.disc.probeHelper(function () {});
  await settle();
  assert.strictEqual(x.log.opened.length, 0);
});

nodeTest('Fernseher mit Helfer: Anfragen gehen wie bisher an den Helfer (signiert), nie direkt an plex.tv', async function () {
  var ctx = H.load(), N = ctx.N, x = H.FakeXHR(function (m, u) {
    if (/\/neo-helper$/.test(u)) return { status: 200, body: { name: 'plex-neo-helper', watchlist: true, discover: true, features: ['watchlist', 'discover', 'details'] } };
    return { status: 200, body: { items: [] } };
  });
  N.http._setFactory(x.factory);
  N.config.helperUrl = 'http://192.168.1.20:32499'; N.config.helperKey = 'k'.repeat(32);
  N.session.state = { account: null, users: USERS, profiles: {} }; N.session.pkg = null; N.session.profile = USERS[0]; N.session.settings = {};
  N.session.isAdmin = function () { return true; };
  await new Promise(function (r) { N.disc.probeHelper(r); });
  assert.strictEqual(N.disc.discoverOn(), true);
  await new Promise(function (r) { N.disc.helperGet('/discover/trending?type=movie&size=20', function () { r(); }); });
  var u = x.log.opened.map(function (o) { return o.url; });
  assert.ok(u.every(function (s) { return s.indexOf('http://192.168.1.20:32499/') === 0; }), u.join('\n'));
});
