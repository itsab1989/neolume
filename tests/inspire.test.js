'use strict';
/* Entdecken: Inspiration (Stufe 1, docs/research/discover.md "Inspiration"): verfuegbare Reihen + Auswahl (inspRows wie homeRows),
 * Genre des Tages (stabil je Tag/Profil), Hub-Reihen ueber mehrere Bibliotheken, unabhaengiges Laden mit EINER Hub-Anfrage je
 * Bibliothek, kurzer Speicher, Teilfehler, Stufe 2 ohne Helfer unsichtbar und ohne Anfrage, Kennzeichnung "auf deinem Server". */
var test = require('node:test'), assert = require('node:assert');
var H = require('./helpers/load'), eq = H.eq;
var N = H.load().N, I = N.insp, HR = N.homeRows;
N.i18n.set('de');

var LIBS = [{ id: 1, title: 'Filme', type: 'movie' }, { id: 2, title: 'Serien', type: 'show' }];
var STAGE1 = ['top', 'rediscover', 'released', 'start', 'rated', 'genre1', 'genre2'];
function prof(uuid) { N.session.profile = { uuid: uuid || 'a', admin: true, kind: 'main' }; N.session.settings = {}; }
function ids(l) { return l.map(function (x) { return x.id; }); }
function meta(rk, type, extra) { var m = { ratingKey: String(rk), type: type, title: 'T' + rk }; for (var k in extra || {}) m[k] = extra[k]; return m; }
function hub(ident, ctx, type, list) { return { hubIdentifier: ident, context: 'hub.' + ctx, type: type, title: ident, Metadata: list }; }
function hubs1() { return { MediaContainer: { Hub: [hub('movie.topunwatched.1', 'movie.topunwatched', 'movie', [meta(11, 'movie'), meta(12, 'movie')]),
  hub('movie.recentlyreleased.1', 'movie.recentlyreleased', 'movie', [meta(13, 'movie')]), hub('movie.genre.1.5', 'movie.genre', 'movie', [meta(14, 'movie')])] } }; }
function hubs2() { return { MediaContainer: { Hub: [hub('tv.startwatching.2', 'tv.startwatching', 'show', [meta(21, 'show')]),
  hub('tv.rediscover.2', 'tv.rediscover', 'show', [meta(22, 'show')]), hub('tv.toprated.2', 'tv.toprated', 'show', [meta(23, 'show'), meta(24, 'show')])] } }; }
function genres(list) { return { MediaContainer: { Directory: list.map(function (t, i) { return { key: String(100 + i), title: t }; }) } }; }
function many(n, base, type) { var out = []; for (var i = 0; i < n; i++) out.push(meta(base + i, type)); return { MediaContainer: { Metadata: out } }; }
/* Plex-Stub: Antworten je Pfad; calls protokolliert */
function stub(answers, calls) {
  return function (path, q, o, cb) {
    calls.push({ path: path, q: q || {} });
    var a = answers(path, q || {});
    if (a && a.err) cb(a.err); else cb(null, a);
    return { abort: function () {} };
  };
}

test('Verfuegbar: Stufe-1-Reihen je Bibliothekstyp, alle Standard an; Stufe 2 nur mit Helfer', function () {
  eq(ids(I.avail(LIBS, null, false)), STAGE1);
  eq(I.avail(LIBS, null, false).map(function (r) { return r.def; }), STAGE1.map(function () { return true; }));
  eq(ids(I.avail([LIBS[0]], null, false)), ['top', 'rediscover', 'released', 'rated', 'genre1', 'genre2']);
  eq(ids(I.avail([LIBS[1]], null, false)), ['rediscover', 'start', 'rated', 'genre1', 'genre2']);
  eq(ids(I.avail([], null, false)), []);
  var all = ids(I.avail(LIBS, null, true));
  eq(all, ['top', 'trend-movie', 'trend-show', 'rediscover', 'released', 'new-movie', 'new-show', 'start', 'rated', 'genre1', 'genre2', 'soon-movie', 'soon-show']);
});

test('Hub-Katalog bekannt: Hub-Reihen nur, wenn der Server die Familie liefert (Genre-Reihen immer)', function () {
  var cat = { hubs: [{ fam: 'movie.topunwatched' }, { fam: 'tv.toprated' }] };
  eq(ids(I.avail(LIBS, cat, false)), ['top', 'rated', 'genre1', 'genre2']);
});

test('Auswahl/Reihenfolge: gleiche Logik wie "Startseite anpassen" (inspRows), Stufe 2 erscheint an ihrer Standard-Stelle', function () {
  var saved = [{ id: 'start', on: true }, { id: 'top', on: false }, { id: 'genre2', on: true }];
  var en = I.enabled(saved, LIBS, null, false);
  eq(en, ['start', 'rated', 'genre1', 'rediscover', 'released', 'genre2']);   // neue Standard-Reihen hinter ihren Vorgaenger (HR.merge)
  var withHelper = I.enabled(saved, LIBS, null, true);
  assert.ok(withHelper.indexOf('trend-movie') >= 0 && withHelper.indexOf('top') < 0);
  var st = HR.store(saved, I.avail(LIBS, null, false), [{ id: 'top', on: true }, { id: 'start', on: false }]);
  assert.strictEqual(HR.isOn(st, 'top', false), true);
  assert.strictEqual(HR.isOn(st, 'start', true), false);
});

test('Genre des Tages: stabil fuer Tag + Profil, wechselt mit dem Tag; Reihe 1 Filme, Reihe 2 Serien, nie dasselbe Genre', function () {
  var pools = I.pool([{ lib: 1, type: 'movie', genres: I.genres(genres(['Action', 'Drama', 'Komödie', 'Horror', 'Krimi', 'Western'])) },
    { lib: 2, type: 'show', genres: I.genres(genres(['Drama', 'Mystery', 'Sitcom', 'Doku'])) },
    { lib: 7, type: 'movie', genres: I.genres(genres(['Drama', 'Anime'])) }]);
  eq([pools.movie.length, pools.show.length], [7, 4]);                 // Drama aus Bibliothek 1 + 7 = ein Eintrag
  var drama = pools.movie.filter(function (g) { return g.title === 'Drama'; })[0];
  assert.strictEqual(Object.keys(drama.keys).sort().join(','), '1,7');
  var a1 = I.candidates(pools, 'a|2026-10-27', 0), a2 = I.candidates(pools, 'a|2026-10-27', 0);
  assert.strictEqual(a1.map(function (g) { return g.title; }).join(), a2.map(function (g) { return g.title; }).join());
  assert.strictEqual(a1[0].type, 'movie');
  assert.strictEqual(I.candidates(pools, 'a|2026-10-27', 1)[0].type, 'show');
  var days = {}, d;
  for (d = 1; d <= 20; d++) days[I.candidates(pools, 'a|2026-10-' + d, 0)[0].title] = 1;
  assert.ok(Object.keys(days).length >= 3, 'Genre wechselt ueber die Tage');
  var onlyMovies = I.pool([{ lib: 1, type: 'movie', genres: I.genres(genres(['Action', 'Drama', 'Komödie', 'Horror', 'Krimi', 'Western'])) }]);
  var m0 = I.candidates(onlyMovies, 's', 0), m1 = I.candidates(onlyMovies, 's', 1);
  assert.ok(m1.length > 0);
  m1.forEach(function (g) { assert.ok(m0.slice(0, 3).indexOf(g) < 0, 'zweite Reihe nie eines der Genres der ersten'); });
  eq(I.candidates({ movie: [], show: [] }, 's', 0), []);
  assert.strictEqual(I.day(new Date(2026, 9, 27, 23, 59).getTime()), I.day(new Date(2026, 9, 27, 0, 1).getTime()));
});

test('Mischen ueber Bibliotheken: abwechselnd, nach ratingKey dedupliziert, max. 20', function () {
  var a = [{ rk: '1' }, { rk: '2' }, { rk: '3' }], b = [{ rk: '9' }, { rk: '2' }];
  eq(I.mix([a, b]).map(function (x) { return x.rk; }), ['1', '9', '2', '3']);
  var big = []; for (var i = 0; i < 30; i++) big.push({ rk: String(i) });
  assert.strictEqual(I.mix([big]).length, 20);
});

test('Laden: EINE Hub-Anfrage je Bibliothek, jede Reihe meldet sich einzeln, Genre-Reihen mit Genre im Titel', function () {
  prof('a'); I._reset();
  var calls = [], plex = N.plex.get, rows = {}, order = [], done = false;
  N.plex.get = stub(function (p, q) {
    if (p === '/hubs/sections/1') return hubs1();
    if (p === '/hubs/sections/2') return hubs2();
    if (/\/genre$/.test(p)) return genres(p.indexOf('/1/') > 0 ? ['Action', 'Drama'] : ['Mystery', 'Sitcom']);
    if (/\/all$/.test(p)) return many(6, p.indexOf('/1/') > 0 ? 300 : 400, q.type === 2 ? 'show' : 'movie');
    return null;
  }, calls);
  try {
    I.load(STAGE1, LIBS, {}, function (id, row, err) { order.push(id); rows[id] = row; assert.strictEqual(err, null); }, function () { done = true; });
  } finally { N.plex.get = plex; }
  assert.ok(done);
  eq(order.slice().sort(), STAGE1.slice().sort());
  eq(calls.filter(function (c) { return /^\/hubs\/sections\//.test(c.path); }).map(function (c) { return c.path; }).sort(), ['/hubs/sections/1', '/hubs/sections/2']);
  eq(rows.top.items.map(function (x) { return x.rk; }), ['11', '12']);
  eq(rows.rated.items.map(function (x) { return x.rk; }), ['23', '24']);
  eq(rows.rediscover.items.map(function (x) { return [x.rk, x.lib]; }), [['22', 2]]);
  eq(rows.released.items.map(function (x) { return x.rk; }), ['13']);
  assert.strictEqual(rows.top.kind, 'posterQ');
  assert.strictEqual(rows.genre1.tk, 'insp.row.genre.movie');
  assert.strictEqual(rows.genre2.tk, 'insp.row.genre.show');
  assert.ok(/^Genre des Tages: (Action|Drama) · Filme$/.test(N.hubs.rowTitle(rows.genre1)), N.hubs.rowTitle(rows.genre1));
  var gq = calls.filter(function (c) { return /\/all$/.test(c.path); });
  gq.forEach(function (c) {
    assert.ok(c.q.genre && c.q.sort === 'audienceRating:desc');
    if (c.q.type === 1) assert.strictEqual(c.q.unwatched, 1); else assert.strictEqual(c.q.unwatchedLeaves, 1);
  });
  assert.ok(calls.every(function (c) { return c.path.indexOf('plex.tv') < 0; }));
});

test('Kurz gemerkt: zweites Oeffnen ohne Anfrage (frisch), anderes Profil/anderer Tag = neu', function () {
  var cached = I.cached(LIBS);
  assert.strictEqual(Object.keys(cached).sort().join(','), STAGE1.slice().sort().join(','));
  assert.ok(cached.top.fresh);
  prof('b');
  assert.strictEqual(Object.keys(I.cached(LIBS)).length, 0);
  prof('a');
  assert.ok(I.cached(LIBS).top.fresh);
  assert.strictEqual(Object.keys(I.cached([LIBS[0]])).length, 0);       // andere Bibliotheken -> eigener Schluessel
});

test('Genre mit zu wenigen Titeln: naechstes Genre; Teilfehler: Reihe bleibt, wird aber nicht gemerkt; Fehler -> err', function () {
  prof('c'); I._reset();
  var calls = [], plex = N.plex.get, got = {};
  N.plex.get = stub(function (p, q) {
    if (p === '/hubs/sections/1') return { err: { type: 'timeout' } };
    if (p === '/hubs/sections/2') return hubs2();
    if (/\/genre$/.test(p)) return p.indexOf('/1/') > 0 ? genres(['Action', 'Drama', 'Horror', 'Krimi']) : { err: { status: 500 } };
    if (/\/all$/.test(p)) return calls.filter(function (c) { return /\/all$/.test(c.path); }).length === 1 ? many(2, 300, 'movie') : many(6, 500, 'movie');
    return null;
  }, calls);
  try {
    I.load(['top', 'rated', 'genre1'], LIBS, {}, function (id, row, err) { got[id] = { row: row, err: err }; });
  } finally { N.plex.get = plex; }
  assert.strictEqual(got.top.row, null); assert.strictEqual(got.top.err.type, 'timeout');          // nur Filmbibliothek, die fehlte
  eq(got.rated.row.items.map(function (x) { return x.rk; }), ['23', '24']); assert.strictEqual(got.rated.err.type, 'partial');
  assert.strictEqual(calls.filter(function (c) { return /\/all$/.test(c.path); }).length, 2);   // erstes Genre (2 Titel) -> Ersatz
  assert.strictEqual(got.genre1.row.items.length, 6);
  var c = I.cached(LIBS);
  assert.ok(!c.top && !c.rated, 'Fehler/Teilfehler werden nicht gemerkt');
  assert.ok(c.genre1);
});

test('Stufe 2 ohne Helfer: nicht verfuegbar, keine Anfrage an den Helfer; Kennzeichnung auf/nicht auf deinem Server', function () {
  prof('a'); N.session.pkg = null; N.config.helperUrl = ''; N.disc._resetHelper();
  assert.strictEqual(I.helperOn(), false);
  var req = N.http.request, n = 0, plex = N.plex.get, done = false;
  N.http.request = function () { n++; return { abort: function () {} }; };
  N.plex.get = function (p, q, o, cb) { cb(null, {}); return { abort: function () {} }; };
  try { I.load(['trend-movie', 'soon-show'], LIBS, {}, function () { assert.fail('keine Reihe ohne Helfer'); }, function () { done = true; }); }
  finally { N.http.request = req; N.plex.get = plex; }
  assert.strictEqual(n, 0);
  return new Promise(function (res) { setTimeout(function () {
    assert.ok(done);
    var G1 = 'plex://movie/5eb8f25e3f398b00402fbe55', G2 = 'plex://movie/61d5833cf81c1be53a737fcc';
    var exts = I.parseHelper({ items: [{ guid: G1, title: 'Eigener', year: 2024 }, { guid: G2, title: 'Fremd', year: 2025 }, { guid: 'plex://show/5d9c086c46115600200aa2fe', title: 'Falscher Typ' }, { guid: 'x', title: 'kaputt' }] }, 'movie');
    eq(exts.map(function (x) { return x.title; }), ['Eigener', 'Fremd']);
    var marked = I.markServer(exts, [{ guid: G1, it: { rk: '77', type: 'movie', title: 'Eigener (Server)', year: 2024 } }]);
    eq(marked.map(function (x) { return [x.rk, !!x.ext, x.mark]; }), [['77', false, 'disc.onServer'], ['x61d5833cf81c1be53a737fcc', true, 'disc.notOnServer']]);
    eq(N.srch.caption(marked[0]), ['Eigener (Server)', 'Auf deinem Server · 2024']);
    eq(N.srch.caption(marked[1]), ['Fremd', 'Nicht auf deinem Server · 2025']);
    res();
  }, 5); });
});

test('Stufe 2 mit Helfer (discover:true), Filter aus: feste Route ohne Token, danach EIN GUID-Abgleich', function () {
  prof('a'); N.session.settings.inspHideOwn = false; N.session.pkg = { helper: { url: 'http://192.0.2.5:32499', key: 'k0123456789abcdefXYZ' } }; N.disc._resetHelper(); I._reset();
  var req = N.http.request, seen = [], plex = N.plex.get, calls = [], got = null;
  var G1 = 'plex://movie/5eb8f25e3f398b00402fbe55';
  N.http.request = function (o, cb) {
    seen.push(o);
    if (/\/neo-helper$/.test(o.url)) cb(null, { name: 'plex-neo-helper', version: '1', watchlist: true, discover: true });
    else cb(null, { items: [{ guid: G1, title: 'Trend', year: 2026 }] });
    return { abort: function () {} };
  };
  N.plex.get = stub(function (p) { return p === '/library/all' ? { MediaContainer: { Metadata: [] } } : null; }, calls);
  try {
    N.disc.probeHelper();
    assert.strictEqual(I.helperOn(), true);
    I.load(['trend-movie'], LIBS, {}, function (id, row) { got = row; });
  } finally { N.http.request = req; N.plex.get = plex; N.session.pkg = null; N.disc._resetHelper(); }
  var last = seen[seen.length - 1];
  assert.strictEqual(last.url, 'http://192.0.2.5:32499/discover/trending?type=movie&size=20');
  assert.ok(!('X-Plex-Token' in last.headers));
  eq(calls.map(function (c) { return [c.path, c.q.guid]; }), [['/library/all', G1]]);
  eq(got.items.map(function (x) { return [x.title, x.mark]; }), [['Trend', 'disc.notOnServer']]);
});

/* ---------- "Nur Titel, die du noch nicht hast" (inspHideOwn / inspHideShared) ---------- */
function hx(i) { return 'plex://movie/' + ('000000000000000000000000' + i.toString(16)).slice(-24); }
function helperItems(n) { var out = []; for (var i = 1; i <= n; i++) out.push({ guid: hx(i), title: 'P' + i, year: 2026 }); return { items: out }; }
function ownMeta(list) { return { MediaContainer: { Metadata: list.map(function (i) { return { ratingKey: String(500 + i), type: 'movie', title: 'Eigen' + i, guid: hx(i) }; }) } }; }
var FRIEND = 'friend-machine-0001';
function withFriend(state) {
  N.srv.setProfile([{ machineId: FRIEND, name: 'Max-NAS', uris: ['http://203.0.113.9:32400'], token: 'T-f' }], 'a');
  var sv = N.srv.list()[0];
  if (state === 'ok') { sv.base = 'http://203.0.113.9:32400'; sv.state = 'ok'; }
}
/* Helfer + PMS simulieren; ownList: eigene Treffer (Indizes), friend(q, cb): Antwort des Weiteren Servers (cb nie = haengt) */
function runHelper(ids, n, ownList, friend, onRow, onDone) {
  N.session.pkg = { helper: { url: 'http://192.0.2.5:32499', key: 'k0123456789abcdefXYZ' } }; N.disc._resetHelper(); I._reset();
  var req = N.http.request, plex = N.plex.get, seen = [], calls = [];
  N.http.request = function (o, cb) {
    seen.push(o);
    if (/\/neo-helper$/.test(o.url)) cb(null, { name: 'plex-neo-helper', version: '1', watchlist: true, discover: true });
    else cb(null, helperItems(n));
    return { abort: function () {} };
  };
  N.plex.get = function (path, q, o, cb) {
    calls.push({ path: path, q: q || {}, srv: o && o.srv || '' });
    if (o && o.srv) { if (friend) friend(q, cb); }
    else cb(null, ownMeta(ownList));
    return { abort: function () {} };
  };
  try { N.disc.probeHelper(); I.load(ids, LIBS, {}, onRow, onDone); }
  finally { N.http.request = req; N.plex.get = plex; }
  return { seen: seen, calls: calls, restore: function () { N.session.pkg = null; N.disc._resetHelper(); N.srv._reset(); } };
}

test('Filter: Standard AN; mit Weiteren Servern auch deren Titel; beide einzeln abschaltbar; Speicher-Schluessel kennt den Filter', function () {
  prof('a'); N.srv._reset();
  assert.strictEqual(I.hide(), 'own');
  var k1 = I.key(LIBS);
  N.session.settings.inspHideOwn = false;
  assert.strictEqual(I.hide(), '');
  assert.notStrictEqual(I.key(LIBS), k1, 'Umschalten laedt die Reihen neu');
  withFriend();
  N.session.settings = {};
  assert.strictEqual(I.hide(), 'all');
  N.session.settings.inspHideShared = false;
  assert.strictEqual(I.hide(), 'own');
  N.session.settings = { inspHideOwn: false };
  assert.strictEqual(I.hide(), '', 'Hauptschalter aus = alles zeigen, auch mit Weiteren Servern');
  eq(I.sharedSrv(), [], 'nicht gepruefte Server werden nicht gefragt');
  withFriend('ok');
  eq(I.sharedSrv(), [FRIEND]);
  N.srv._reset();
});

test('Filter (rein): eigene + Titel Weiterer Server raus, Reihenfolge bleibt, max. 20; alles vorhanden -> Hinweis-Reihe', function () {
  prof('a');
  var exts = I.parseHelper(helperItems(30), 'movie', I.FETCH);
  assert.strictEqual(exts.length, 30, 'mit Filter bis zu FETCH Titel');
  assert.strictEqual(I.parseHelper(helperItems(30), 'movie').length, 20, 'ohne Angabe MAX');
  var local = N.disc.localList(ownMeta([1, 2, 3]), {});
  var row = I.helperRow('trend-movie', exts, local, {});
  assert.strictEqual(row.items.length, 20);
  eq(row.items.slice(0, 3).map(function (x) { return x.title; }), ['P4', 'P5', 'P6']);
  row.items.forEach(function (x) { assert.ok(x.ext && x.mark === 'disc.notOnServer'); });
  var other = {}; other[hx(4)] = 1; other[hx(6)] = 1;
  eq(I.helperRow('trend-movie', exts.slice(0, 8), local, other).items.map(function (x) { return x.title; }), ['P5', 'P7', 'P8']);
  // Filter aus: alle, eigene als abspielbare Karte mit Marke (wie bisher)
  var all = I.helperRow('trend-movie', exts.slice(0, 5), local, null);
  eq(all.items.map(function (x) { return [x.title, x.mark]; }), [['Eigen1', 'disc.onServer'], ['Eigen2', 'disc.onServer'], ['Eigen3', 'disc.onServer'], ['P4', 'disc.notOnServer'], ['P5', 'disc.notOnServer']]);
  // alles vorhanden: Hinweis statt leerer Reihe; plex.tv lieferte nichts: keine Reihe
  var note = I.helperRow('trend-movie', exts.slice(0, 3), local, {});
  eq([note.kind, note.items.length, note.note, note.tk], ['note', 0, 'insp.note.allOwned', 'insp.row.trend.movie']);
  assert.strictEqual(I.helperRow('trend-movie', exts.slice(0, 3), local, {}, true).note, 'insp.note.allOwnedSrv');
  assert.strictEqual(I.helperRow('trend-movie', [], [], {}), null);
  assert.strictEqual(I.helperRow('trend-movie', exts.slice(0, 3), local, null).items.length, 3, 'Filter aus: nie ein Hinweis');
  assert.strictEqual(N.t('insp.note.allOwned').indexOf('insp.') < 0, true);
});

test('Filter an: Helfer liefert 30 statt 20 (Auffuellen), EIN Abgleich ueber alle 30, Reihe wieder 20 voll', function () {
  prof('a'); N.srv._reset();
  var got = null, own = []; for (var i = 1; i <= 9; i++) own.push(i);
  var h = runHelper(['trend-movie'], 30, own, null, function (id, row, err) { got = { row: row, err: err }; });
  h.restore();
  assert.strictEqual(h.seen[h.seen.length - 1].url, 'http://192.0.2.5:32499/discover/trending?type=movie&size=30');
  assert.strictEqual(h.calls.length, 1);
  assert.strictEqual(h.calls[0].q.guid.split(',').length, 30);
  assert.strictEqual(got.err, null);
  assert.strictEqual(got.row.items.length, 20);
  assert.strictEqual(got.row.items[0].title, 'P10');
  // weniger als 20 neue: zeigen, was da ist
  own = []; for (i = 1; i <= 25; i++) own.push(i);
  h = runHelper(['trend-movie'], 30, own, null, function (id, row) { got = row; }); h.restore();
  eq(got.items.map(function (x) { return x.title; }), ['P26', 'P27', 'P28', 'P29', 'P30']);
});

test('Filter an, alles schon auf dem Server: Hinweis-Reihe (wird gemerkt wie eine Reihe)', function () {
  prof('a'); N.srv._reset();
  var got = null;
  var h = runHelper(['new-show'], 4, [1, 2, 3, 4], null, function (id, row, err) { got = { row: row, err: err }; });
  h.restore();
  // Helfer-Typ "show": hx() liefert movie-GUIDs -> keine gueltigen Serien -> keine Reihe, kein Abgleich
  assert.strictEqual(got.row, null);
  h = runHelper(['new-movie'], 4, [1, 2, 3, 4], null, function (id, row, err) { got = { row: row, err: err }; });
  h.restore();
  eq([got.row.kind, got.row.note, got.err], ['note', 'insp.note.allOwned', null]);
});

test('Filter an + Weiterer Server verbunden: derselbe Abgleich dort, dessen Titel verschwinden; haengt er, nach SHARED_WAIT ohne ihn', function () {
  prof('a');
  var got = null, wait = I.SHARED_WAIT;
  N.session.pkg = null; withFriend('ok');
  var h = runHelper(['trend-movie'], 6, [1], function (q, cb) { cb(null, { MediaContainer: { Metadata: [{ ratingKey: '9', type: 'movie', guid: hx(2) }, { ratingKey: '10', type: 'movie', guid: hx(3) }] } }); },
    function (id, row, err) { got = { row: row, err: err }; });
  var fr = h.calls.filter(function (c) { return c.srv === FRIEND; });
  assert.strictEqual(fr.length, 1);
  assert.strictEqual(fr[0].q.guid, h.calls[0].q.guid, 'gleiche GUID-Liste');
  h.restore();
  eq(got.row.items.map(function (x) { return x.title; }), ['P4', 'P5', 'P6']);
  assert.strictEqual(got.err, null);
  withFriend('ok');
  assert.ok(I.cached(LIBS)['trend-movie'], 'vollstaendiges Ergebnis wird gemerkt');
  // Weiterer Server haengt: Reihe kommt nach SHARED_WAIT trotzdem (seine Titel bleiben), als Teilfehler (nicht gemerkt)
  withFriend('ok'); I.SHARED_WAIT = 15; got = null;
  h = runHelper(['trend-movie'], 6, [1], function () {}, function (id, row, err) { got = { row: row, err: err }; });
  assert.strictEqual(got, null, 'wartet auf den Weiteren Server');
  return new Promise(function (res) { setTimeout(function () {
    I.SHARED_WAIT = wait;
    eq(I.cached(LIBS), {}, 'Teilfehler wird nicht gemerkt');
    h.restore();
    eq(got.row.items.map(function (x) { return x.title; }), ['P2', 'P3', 'P4', 'P5', 'P6']);
    eq(got.err, { type: 'partial' });
    res();
  }, 40); });
});

test('Filter an + Weiterer Server: alles vorhanden -> Hinweis nennt die Weiteren Server; Server nicht verbunden -> nicht gefragt', function () {
  prof('a');
  var got = null;
  withFriend('ok');
  var h = runHelper(['trend-movie'], 3, [1], function (q, cb) { cb(null, { MediaContainer: { Metadata: [{ guid: hx(2) }, { guid: hx(3) }] } }); }, function (id, row) { got = row; });
  h.restore();
  eq([got.kind, got.note], ['note', 'insp.note.allOwnedSrv']);
  withFriend();
  h = runHelper(['trend-movie'], 3, [1], function () { assert.fail('nicht verbundener Server wird nicht gefragt'); }, function (id, row) { got = row; });
  h.restore();
  eq(got.items.map(function (x) { return x.title; }), ['P2', 'P3']);
});
