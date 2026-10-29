'use strict';
var test = require('node:test'), assert = require('node:assert');
var H = require('./helpers/load'), S = H.synthetic;
var N = H.load().N;
function eq(a, b) { assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b); }   // vm-Kontext: Objekte aus anderem Realm
function list(f) { return S(f).MediaContainer.Metadata || []; }
test('Nach dem Player (TV-Test 28.10.): Antwort ohne den gerade gestoppten Titel in Weiterschauen gilt als zu frueh', function () {
  var rows = [{ id: 'cw', items: [{ rk: '5' }, { rk: '7' }] }, { id: 'deck', items: [{ rk: '9' }] }, { id: 'new-1', items: [{ rk: '42' }] }];
  assert.strictEqual(N.hubs.stale(rows, '7', ['cw', 'deck']), false, 'steht drin');
  assert.strictEqual(N.hubs.stale(rows, '42', ['cw', 'deck']), true, 'nur in einer anderen Reihe -> noch warten');
  assert.strictEqual(N.hubs.stale(rows.slice(1), '7', ['cw', 'deck']), true, 'Weiterschauen leer/fehlt -> warten');
  assert.strictEqual(N.hubs.stale(rows, '9', ['deck']), false, 'ohne Weiterschauen zaehlt Naechste Folgen');
  assert.strictEqual(N.hubs.stale(rows, '9', ['cw', 'deck']), true, 'mit Weiterschauen muss er dort stehen');
  assert.strictEqual(N.hubs.stale(rows, '1', ['new-1']), false, 'beide Reihen aus -> nichts zu warten');
  assert.strictEqual(N.hubs.stale(rows, '', ['cw']), false);
});
function data() {
  var libs = N.hubs.libraries(S('sections.json'));
  return { libs: libs, cw: list('continueWatching.json'), deck: list('onDeck.json'),
    recent: { 1: list('recent-1.json'), 2: list('recent-2.json'), 5: list('recent-5.json'), 6: list('recent-6.json') } };
}

test('Bibliotheken: nur Filme/Serien, Anime und Doku erkannt', function () {
  var libs = N.hubs.libraries(S('sections.json'));
  eq(libs.map(function (l) { return l.id + ':' + l.kind; }), ['1:movie', '2:show', '5:anime', '6:doc']);
});

test('Als Naechstes wird gegen Weiterschauen dedupliziert (ratingKey und Serie)', function () {
  var rows = N.hubs.buildRows(data());
  var cw = rows[0], deck = rows[1];
  assert.strictEqual(cw.id, 'cw'); assert.strictEqual(deck.id, 'deck');
  var deckKeys = deck.items.map(function (i) { return i.rk; });
  eq(deckKeys, ['1201']);           // 1001 (gleiche Folge), 1002 (gleiche Serie), 2001 (Film) und 1202 (Doppel) entfallen
  var cwShows = {}; cw.items.forEach(function (i) { if (i.showRk) cwShows[i.showRk] = 1; });
  deck.items.forEach(function (i) { assert.ok(!cwShows[i.showRk]); });
});

test('Reihenfolge: Weiterschauen, Als Naechstes, Neu je Bibliothek; leere Reihen fehlen', function () {
  var rows = N.hubs.buildRows(data());
  eq(rows.map(function (r) { return r.id + '/' + r.kind; }), ['cw/land', 'deck/land', 'new-1/poster', 'new-2/poster', 'new-6/poster']);
  N.i18n.set('de');
  assert.strictEqual(N.hubs.rowTitle(rows[2]), 'Neu: Filme');
  N.i18n.set('en');
  assert.strictEqual(N.hubs.rowTitle(rows[3]), 'New: Serien');      // Bibliotheksname unveraendert
  N.i18n.set('de');
});

test('Als Naechstes entfaellt ganz, wenn nach Dedupe nichts uebrig ist', function () {
  var d = data(); d.deck = d.cw.slice();
  var rows = N.hubs.buildRows(d);
  assert.ok(!rows.some(function (r) { return r.id === 'deck'; }));
});

test('Normalisierung: Folge, Staffel, Serie, Film', function () {
  var kinds = { 2: 'show', 5: 'anime' };
  var ep = N.model.norm(list('continueWatching.json')[1], kinds);
  assert.strictEqual(ep.title, 'Wolkenreiter'); assert.strictEqual(ep.epTitle, 'Sturmwarnung');
  assert.strictEqual(ep.s, 2); assert.strictEqual(ep.e, 5); assert.strictEqual(ep.kind, 'anime');
  assert.strictEqual(ep.seasonRk, '960'); assert.strictEqual(ep.showRk, '910');
  assert.ok(/thumb/.test(ep.still) && /910\/thumb/.test(ep.thumb) && /910\/art/.test(ep.art));
  var season = N.model.norm(list('recent-2.json')[3], kinds);
  assert.strictEqual(season.title, 'Brückenbauer'); assert.strictEqual(season.s, 3);
  N.i18n.set('de');
  assert.strictEqual(N.model.overline(ep), 'SERIE · ANIME');
  assert.strictEqual(N.model.overline(N.model.norm(list('recent-1.json')[0], kinds)), 'FILM');
});

test('Badges, Fortschritt und Gesehen-Schwelle 90 %', function () {
  var M = N.model, cw = list('continueWatching.json').map(function (m) { return M.norm(m, {}); });
  assert.ok(Math.abs(M.progress(cw[2]) - 0.5) < 1e-9);
  assert.strictEqual(M.progress(cw[3]), 0);                       // 95,8 % -> gesehen, Balken weg
  assert.strictEqual(M.badge(cw[3]).b, 'done');
  var rec = list('recent-1.json').map(function (m) { return M.norm(m, {}); });
  assert.strictEqual(M.badge(rec[0]).b, 'new');
  assert.strictEqual(M.badge(rec[1]).b, 'done');
  assert.strictEqual(M.badge(rec[2]).b, '');
  var shows = list('recent-2.json').slice(2).map(function (m) { return M.norm(m, {}); });
  eq(M.badge(shows[0]), { b: 'count', n: '14' });
  assert.strictEqual(M.badge(shows[1]).b, 'done');
  var many = M.norm({ ratingKey: 1, type: 'show', leafCount: 500, viewedLeafCount: 1 }, {});
  assert.strictEqual(M.badge(many).n, '99+');
});

test('Beschriftungen Landscape/Poster', function () {
  N.i18n.set('de');
  var M = N.model, cw = list('continueWatching.json').map(function (m) { return M.norm(m, {}); });
  eq(M.landCaption(cw[0]), ['Sternenfahrer', 'S1 · F3 · noch 14 Min.']);
  eq(M.landCaption(cw[2]), ['Der stille Berg', 'noch 1 Std.']);
  var show = M.norm(list('recent-2.json')[2], {});
  eq(M.posterCaption(show), ['Leuchtturm', '2 Staffeln']);
});

test('Cache-Kopie bleibt unter 60 KB und kuerzt erst Beschreibungen', function () {
  var rows = N.hubs.buildRows(data());
  rows.forEach(function (r) { r.items.forEach(function (it) { it.sum = new Array(400).join('x'); }); });
  var big = [];
  for (var i = 0; i < 30; i++) big.push(JSON.parse(JSON.stringify(rows[i % rows.length])));
  var c = N.hubs.forCache(big, 60000);
  assert.ok(JSON.stringify(c).length <= 60000);
  var small = N.hubs.forCache(rows, 60000);
  assert.strictEqual(small[0].items[0].sum.length, rows[0].items[0].sum.length);
});

test('sameRow/sameLayout erkennen Aenderungen (fuer den stillen Refresh)', function () {
  var a = N.hubs.buildRows(data()), b = N.hubs.buildRows(data());
  assert.ok(N.hubs.sameLayout(a, b) && N.hubs.sameRow(a[0], b[0]));
  b[0].items[0].off += 1000;
  assert.ok(!N.hubs.sameRow(a[0], b[0]));
  b.pop();
  assert.ok(!N.hubs.sameLayout(a, b));
});

/* Review M2: Reihen einzeln laden – eine fehlgeschlagene Anfrage bringt nicht die ganze Startseite zu Fall */
function netSetup(fail) {
  var ctx = H.load({ fakeTimers: true }), NN = ctx.N, T = ctx.timers;
  var files = { '/library/sections': 'sections.json', '/hubs/continueWatching/items': 'continueWatching.json', '/library/onDeck': 'onDeck.json' };
  var x = H.FakeXHR(function (m, u) {
    var path = u.replace(/^http:\/\/pms:32400/, '').split('?')[0], q = u.split('?')[1] || '';
    var f = fail(path, q);
    if (f) return { status: f, body: {}, timers: T };
    if (path === '/hubs/home/recentlyAdded') return { status: 200, body: S('recent-' + /sectionID=(\d+)/.exec(q)[1] + '.json'), timers: T };
    return { status: 200, body: S(files[path]), timers: T };
  });
  NN.http._setFactory(x.factory); NN.http._setTimers({ set: T.setTimeout, clear: T.clearTimeout }); NN.http._reset();
  NN.plex.setServer('http://pms:32400', 'TOK');
  return { N: NN, T: T, log: x.log };
}
function ids(rows) { return rows.map(function (r) { return r.id; }); }
test('Teil-Fehler: Weiterschauen 404 und eine Bibliothek 500 -> Rest wird angezeigt', function () {
  var s = netSetup(function (p, q) { return p === '/hubs/continueWatching/items' ? 404 : /sectionID=2\b/.test(q) ? 500 : 0; }), res = null, err = 'x';
  s.N.hubs.fetch(function (e, r) { err = e; res = r; });
  s.T.tick(10000);
  assert.strictEqual(err, null);
  assert.strictEqual(res.partial, true);
  eq(ids(res.rows), ['deck', 'new-1', 'new-6']);
});
test('Teil-Fehler: alte Fassung der fehlgeschlagenen Reihe bleibt an ihrer Stelle', function () {
  var prev = { libs: N.hubs.libraries(S('sections.json')), rows: N.hubs.buildRows(data()) };
  var s = netSetup(function (p, q) { return p === '/hubs/continueWatching/items' || /sectionID=2\b/.test(q) ? 404 : 0; }), res = null;
  s.N.hubs.fetch(function (e, r) { res = r; }, prev);
  s.T.tick(10000);
  eq(ids(res.rows), ['cw', 'deck', 'new-1', 'new-2', 'new-6']);
  assert.strictEqual(res.rows[0].items.length, prev.rows[0].items.length);
});
test('Sektionen fehlgeschlagen: Reihen trotzdem, Bibliotheken aus prev; libs = null (Rail bleibt)', function () {
  var prev = { libs: N.hubs.libraries(S('sections.json')), rows: [] };
  var s = netSetup(function (p) { return p === '/library/sections' ? 500 : 0; }), res = null;
  s.N.hubs.fetch(function (e, r) { res = r; }, prev);
  s.T.tick(10000);
  assert.strictEqual(res.libs, null);
  eq(ids(res.rows), ['cw', 'deck', 'new-1', 'new-2', 'new-6']);
});
test('Alles fehlgeschlagen -> Fehler (Sektionen-Fehler zaehlt); 401 bricht sofort ab', function () {
  var s = netSetup(function () { return 503; }), err = null;
  s.N.hubs.fetch(function (e) { err = e; });
  s.T.tick(20000);
  assert.strictEqual(err.status, 503);
  assert.strictEqual(s.N.errs.kind(err, 'pms'), 'server');
  var t = netSetup(function (p) { return p === '/library/onDeck' ? 401 : 0; }), e2 = null, calls = 0;
  t.N.hubs.fetch(function (e) { e2 = e; calls++; });
  t.T.tick(20000);
  assert.strictEqual(e2.status, 401); assert.strictEqual(calls, 1);
});

test('Naechste Folgen: keine Filme aus onDeck, mit Weiterschauen keine angefangenen (TV-Test 27.10., F3)', function () {
  var kinds = {};
  var deck = [{ ratingKey: '7', type: 'movie', viewOffset: 5000, title: 'Northern Static' },
    { ratingKey: '8', type: 'episode', grandparentRatingKey: '80', title: 'A' },
    { ratingKey: '9', type: 'episode', grandparentRatingKey: '90', viewOffset: 1000, title: 'B' }];
  var norm = N.model.normList(deck, kinds);
  eq(N.hubs.nextEpisodes(norm, true).map(function (i) { return i.rk; }), ['8']);
  eq(N.hubs.nextEpisodes(norm, false).map(function (i) { return i.rk; }), ['8', '9']);
  var d = data(); d.cw = []; d.deck = deck;
  var rows = N.hubs.buildRows(d), deckRow = rows.filter(function (r) { return r.id === 'deck'; })[0];
  eq(deckRow.items.map(function (i) { return i.rk; }), ['8']);
});

test('Erweiterungs-Reihen: Platzhalter/Stand aus N.ext home:row an ihrer Stelle, nie im Startseiten-Cache, Hinweis zaehlt beim Vergleich', function () {
  var c = H.load(), M = c.N, libs = M.hubs.libraries(S('sections.json'));
  var d = { libs: libs, cw: list('continueWatching.json'), deck: list('onDeck.json'), recent: { 1: list('recent-1.json') } };
  M.ext.on('home:row', function (id) { return id === 'x-a' ? { id: 'x-a', kind: 'poster', title: 'A', items: [], note: 'n.loading', want: true } : id === 'x-b' ? { id: 'x-c', items: [] } : undefined; });
  d.order = ['cw', 'x-a', 'x-b', 'new-1'];
  var rows = M.hubs.buildRows(d);
  eq(rows.map(function (r) { return r.id; }), ['cw', 'x-a', 'new-1']);
  assert.ok(rows[1].ext);
  eq(M.hubs.pick([rows[0], rows[2]], ['x-a', 'cw']).map(function (r) { return r.id; }), ['x-a', 'cw']);
  eq(M.hubs.forCache(rows).map(function (r) { return r.id; }), ['cw', 'new-1']);
  var b2 = JSON.parse(JSON.stringify(rows[1])); b2.note = '';
  assert.strictEqual(M.hubs.sameRow(rows[1], b2), false);
});
