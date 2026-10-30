'use strict';
/* HOME-13: Hinweis bei neuen Inhalten – Gruppieren/Texte (N.newsLogic), Ausgangsstand je Server + Profil, Warteschlange
 * (wann zeigen, wann warten, veraltet), Netz-Ablauf (N.newWatch: eine Anfrage je geaenderter Bibliothek, nie im Video ohne Erlaubnis). */
var test = require('node:test'), assert = require('node:assert');
var H = require('./helpers/load');
function eq(a, b, m) { assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b, m); }
function mk(lang) { var N = H.load().N; N.i18n.set(lang || 'de'); return N; }
function mv(rk, title, at) { return { k: 'movie', rk: String(rk), title: title, at: at || 1 }; }
function ep(rk, show, s, e, srk) { return { k: 'ep', rk: String(rk), show: show, showRk: String(srk || show), s: s, e: e, at: 1 }; }
function tr(rk, title, album, n, artist, book) { return { k: 'track', rk: String(rk), title: title, album: album, albumRk: 'a-' + album, artist: artist || '', n: n, book: !!book, at: 1 }; }

test('Genau: Wortlaut je Art und Anzahl (DE)', function () {
  var L = mk().newsLogic;
  function d(items) { var x = L.describe(items, 'exact'); return [x.icon, x.head, x.line]; }
  eq(d([mv(1, 'Abendrot')]), ['film', 'Neuer Film', '„Abendrot“']);
  eq(d([ep(1, 'Sternenfahrer', 1, 1), ep(2, 'Sternenfahrer', 1, 2)]), ['tv', 'Neue Serie', '„Sternenfahrer“ · 2 Folgen'], 'S1·F1 dabei = neue Serie');
  eq(d([ep(1, 'Sternenfahrer', 1, 1)]), ['tv', 'Neue Serie', '„Sternenfahrer“']);
  eq(d([ep(1, 'Wolkenreiter', 3, 1), ep(2, 'Wolkenreiter', 3, 2)]), ['tv', 'Neue Staffel', '„Wolkenreiter“ · Staffel 3']);
  eq(d([ep(1, 'Wolkenreiter', 2, 5)]), ['tv', 'Neue Folge', '„Wolkenreiter“ · S2 · F5']);
  eq(d([ep(1, 'Wolkenreiter', 2, 5), ep(2, 'Wolkenreiter', 2, 6), ep(3, 'Wolkenreiter', 2, 7)]), ['tv', '3 neue Folgen', '„Wolkenreiter“']);
  eq(d([tr(1, 'Lied 1', 'Morgenlicht', 1, 'Aurora Weiss'), tr(2, 'Lied 2', 'Morgenlicht', 2, 'Aurora Weiss')]), ['note', 'Neues Album', '„Morgenlicht“ · Aurora Weiss']);
  eq(d([tr(1, 'Lied 7', 'Morgenlicht', 7, 'Aurora Weiss')]), ['note', 'Neuer Musiktitel', '„Lied 7“ · Aurora Weiss']);
  eq(d([tr(1, 'Kapitel 1', 'Die stille Insel', 1, 'K. Erzähler', true), tr(2, 'Kapitel 2', 'Die stille Insel', 2, 'K. Erzähler', true)]), ['book', 'Neues Hörbuch', '„Die stille Insel“ · K. Erzähler']);
});

test('Genau: mehrere Titel – eine Art mit Namen, gemischt mit Anzahl je Art; Allgemein; Aus; EN', function () {
  var N = mk(), L = N.newsLogic;
  var x = L.describe([mv(1, 'A'), mv(2, 'B'), mv(3, 'C')], 'exact');
  eq([x.head, x.line], ['3 neue Filme', '„A“, „B“, „C“']);
  x = L.describe([ep(1, 'X', 2, 5), ep(2, 'X', 2, 6), ep(3, 'Y', 4, 2)], 'exact');
  eq([x.head, x.line], ['3 neue Folgen', '„X“, „Y“'], 'Folgen je Serie gruppiert');
  x = L.describe([mv(1, 'A'), mv(2, 'B'), ep(3, 'X', 2, 5), ep(4, 'X', 2, 6), ep(5, 'Y', 1, 3)], 'exact');
  eq([x.icon, x.head, x.line], ['star', 'Neu auf deinem Server', '2 Filme, 3 Folgen']);
  x = L.describe([mv(1, 'A'), tr(2, 'L', 'Alb', 1, 'K'), tr(3, 'M', 'Alb', 2, 'K')], 'exact');
  eq(x.line, '1 Film, 1 Album');
  x = L.describe([mv(1, 'A')], 'general');
  eq([x.head, x.line], ['', 'Neue Inhalte auf deinem Server'], 'Allgemein: einzeilig');
  assert.strictEqual(L.describe([mv(1, 'A')], 'off'), null);
  assert.strictEqual(L.describe([], 'exact'), null);
  var long = L.describe([mv(1, 'Die unglaublich lange Reise des kleinen Leuchtturmwärters bis ans Ende der Welt')], 'exact');
  assert.ok(long.line.length <= 42 && /…“$/.test(long.line), 'langer Titel gekuerzt: ' + long.line);
  N.i18n.set('en');
  x = L.describe([ep(1, 'Wolkenreiter', 2, 5)], 'exact');
  eq([x.head, x.line], ['New episode', '“Wolkenreiter” · S2 · E5']);
  x = L.describe([mv(1, 'A'), ep(3, 'X', 2, 5), ep(4, 'X', 2, 6)], 'exact');
  eq([x.head, x.line], ['New on your server', '1 movie, 2 episodes']);
});

test('PMS-Eintraege normieren; Einstellungen mit Standard', function () {
  var L = mk().newsLogic;
  eq(L.norm({ ratingKey: 7, type: 'episode', grandparentTitle: 'S', grandparentRatingKey: 70, parentIndex: 2, index: 5, addedAt: 9 }),
    { k: 'ep', rk: '7', show: 'S', showRk: '70', s: 2, e: 5, at: 9 });
  assert.strictEqual(L.norm({ ratingKey: 8, type: 'photo' }), null);
  eq([L.mode({}), L.mode({ newsNote: 'general' }), L.mode({ newsNote: 'x' })], ['exact', 'general', 'exact']);
  eq([L.ms({}), L.ms({ newsSecs: 12 }), L.ms({ newsSecs: 1 })], [5000, 12000, 5000], 'unter 3 s gibt es nicht');
  eq([L.play({}), L.play({ newsPlay: true })], [false, true]);
});

test('Ausgangsstand: erster Lauf legt nur fest; geaenderter Stand -> eine Anfrage neu seit at; Antwort setzt neuen Stand', function () {
  var L = mk().newsLogic;
  var dirs = [{ key: '1', type: 'movie', contentChangedAt: 10, updatedAt: 500, scannedAt: 480 }, { key: '2', type: 'show', contentChangedAt: 20, updatedAt: 600 },
    { key: '9', type: 'photo', contentChangedAt: 1 }];
  var p = L.plan(null, dirs, null);
  eq(p, { libs: { 1: { sig: 'c10', at: 500 }, 2: { sig: 'c20', at: 600 } }, load: [], dirty: true }, 'nichts melden, Fotos nie');
  dirs[1].contentChangedAt = 21;
  p = L.plan({ libs: p.libs }, dirs, function (d) { return d.key === '2'; });
  eq(p.load, [{ id: '2', type: 'show', at: 600, sig: 'c21', book: true }]);
  assert.strictEqual(p.dirty, false);
  var r = L.req(p.load[0]);
  eq(r, { path: '/library/sections/2/all?type=4&sort=addedAt:desc&addedAt>>=600', query: { 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 60, excludeFields: 'summary' } });
  var res = L.done(p.load[0], { MediaContainer: { Metadata: [{ ratingKey: 5, type: 'episode', grandparentTitle: 'S', parentIndex: 1, index: 2, addedAt: 700 },
    { ratingKey: 4, type: 'episode', grandparentTitle: 'S', parentIndex: 1, index: 1, addedAt: 400 }] } });
  eq(res.entry, { sig: 'c21', at: 700 });
  eq(res.items.map(function (x) { return x.rk; }), ['5'], 'Server ohne Filter: alte Titel nie melden');
  var seed = L.done({ id: '1', type: 'movie', at: 0, sig: 'c11' }, { MediaContainer: { Metadata: [{ ratingKey: 1, type: 'movie', addedAt: 900 }] } });
  eq([seed.entry, seed.items], [{ sig: 'c11', at: 900 }, []], 'ohne at: nur Stand festlegen');
  eq(L.req({ id: '1', type: 'movie', at: 0 }).query['X-Plex-Container-Size'], 1);
  p = L.plan({ libs: { 1: { sig: 'c10', at: 1 }, 7: { sig: 'c1', at: 1 } } }, dirs.slice(0, 1), null);
  assert.strictEqual(p.dirty, true, 'entfernte Bibliothek faellt weg');
});

test('Warteschlange: zusammenfassen, veraltet verwerfen, wann zeigen', function () {
  var L = mk().newsLogic;
  var q = L.merge([], [mv(1, 'A')], 1000);
  q = L.merge(q, [mv(1, 'A'), mv(2, 'B')], 2000);
  eq(q.map(function (x) { return x.it.rk; }), ['1', '2'], 'gleicher Titel nur einmal');
  eq(L.prune(q, 1000 + L.STALE + 500).map(function (x) { return x.it.rk; }), ['2'], 'aelter als 30 Min. faellt weg');
  var ok = { saver: false, screen: 'clock', overlay: false, rail: false, toast: false, netbar: false, rest: 5000, player: null, play: false };
  function d(o) { var e = JSON.parse(JSON.stringify(ok)); for (var k in o) e[k] = o[k]; return L.decide(e); }
  assert.strictEqual(d({}), 'show');
  assert.strictEqual(d({ rest: 500 }), 'wait', 'Tasten werden gedrueckt');
  assert.strictEqual(d({ saver: true }), 'wait');
  assert.strictEqual(d({ overlay: true }), 'wait', 'nie ueber Dialog/Panel');
  assert.strictEqual(d({ toast: true }), 'wait', 'nie zwei Hinweise zugleich');
  assert.strictEqual(d({ rail: true }), 'wait');
  assert.strictEqual(d({ netbar: true }), 'wait');
  assert.strictEqual(d({ screen: '' }), 'wait', 'Bildschirm ohne Platz: warten');
  var pl = { active: true, calm: true, since: 70000 };
  assert.strictEqual(d({ screen: 'player', player: pl }), 'wait', 'Video ohne Erlaubnis');
  assert.strictEqual(d({ screen: 'player', player: pl, play: true }), 'show');
  assert.strictEqual(d({ screen: 'player', player: { active: true, calm: false, since: 70000 }, play: true }), 'wait', 'OSD/Insel da');
  assert.strictEqual(d({ screen: 'player', player: { active: true, calm: true, since: 30000 }, play: true }), 'wait', 'erst 1 Min. nach Start/Sprung');
  assert.strictEqual(d({ screen: 'player', player: null, play: true }), 'wait', 'Player ohne laufendes Video');
  assert.ok(L.playCheck({ play: true, active: true, calm: true, since: 61000, age: 301000 }));
  assert.ok(!L.playCheck({ play: true, active: true, calm: true, since: 61000, age: 100000 }), 'hoechstens alle 5 Min.');
  assert.ok(!L.playCheck({ play: false, active: true, calm: true, since: 61000, age: 301000 }));
  assert.ok(!L.playCheck({ play: true, active: true, calm: false, since: 61000, age: 301000 }), 'nie beim Puffern');
});

function app(settings) {
  var N = mk(), mem = {}, calls = [], added = [];
  N.store = { get: function (k) { return mem[k] ? JSON.parse(mem[k]) : null; }, set: function (k, v) { mem[k] = JSON.stringify(v); } };
  N.idle = { add: function (fn) { fn(); }, restFor: function () { return 99999; }, touch: function () {} };
  N.plex.base = 'http://192.0.2.1:32400';
  N.plex.get = function (p, q, o, cb) { calls.push({ p: p, cb: cb }); return { abort: function () {} }; };
  N.session = { profile: { uuid: 'p1' }, settings: settings || {}, state: { server: { machineId: 'm1' } } };
  N.ui.news = { add: function (l) { added.push(l); } };
  return { N: N, mem: mem, calls: calls, added: added };
}
function secs(list) { return { MediaContainer: { Directory: list } }; }

test('Netz: Start legt Stand fest, Aenderung -> EINE Anfrage je Bibliothek, Ergebnis an den Hinweis; je Server und Profil', function () {
  var a = app(), N = a.N;
  N.libwatch.note(secs([{ key: '1', type: 'movie', contentChangedAt: 1, updatedAt: 100 }, { key: '2', type: 'show', contentChangedAt: 1, updatedAt: 100 }]));
  eq(JSON.parse(a.mem['news-p1.json']), { srv: 'm1', libs: { 1: { sig: 'c1', at: 100 }, 2: { sig: 'c1', at: 100 } } });
  assert.strictEqual(a.calls.length, 0, 'erster Lauf: keine Anfrage, nichts melden');
  N.libwatch.note(secs([{ key: '1', type: 'movie', contentChangedAt: 2 }, { key: '2', type: 'show', contentChangedAt: 1 }]));
  assert.strictEqual(a.calls.length, 1);
  assert.ok(/^\/library\/sections\/1\/all\?type=1&sort=addedAt:desc&addedAt>>=100$/.test(a.calls[0].p), a.calls[0].p);
  a.calls[0].cb(null, { MediaContainer: { Metadata: [{ ratingKey: 9, type: 'movie', title: 'Neu', addedAt: 150 }] } });
  eq(a.added.length, 1); eq(a.added[0][0].title, 'Neu');
  eq(JSON.parse(a.mem['news-p1.json']).libs[1], { sig: 'c2', at: 150 });
  N.session.state.server = { machineId: 'm2' };                 // anderer Server: neuer Ausgangsstand, nichts melden
  N.libwatch.note(secs([{ key: '1', type: 'movie', contentChangedAt: 3, updatedAt: 200 }]));
  assert.strictEqual(a.calls.length, 1);
  eq(JSON.parse(a.mem['news-p1.json']), { srv: 'm2', libs: { 1: { sig: 'c3', at: 200 } } });
});

test('Netz: was ankam, waehrend die App aus war, wird beim Start gemeldet; Aus = kein Nachsehen, Stand geloescht', function () {
  var a = app();
  a.mem['news-p1.json'] = JSON.stringify({ srv: 'm1', libs: { 2: { sig: 'c1', at: 100 } } });
  a.N.libwatch.note(secs([{ key: '2', type: 'show', contentChangedAt: 5 }]));
  assert.strictEqual(a.calls.length, 1, 'gemerkter Stand weicht ab -> nachsehen');
  var b = app({ newsNote: 'off' });
  b.mem['news-p1.json'] = JSON.stringify({ srv: 'm1', libs: { 2: { sig: 'c1', at: 100 } } });
  b.N.libwatch.note(secs([{ key: '2', type: 'show', contentChangedAt: 5 }]));
  assert.strictEqual(b.calls.length, 0);
  assert.strictEqual(b.mem['news-p1.json'], 'null', 'Aus: Stand weg -> beim Einschalten nichts Altes');
});

test('Netz: im Video nur mit Erlaubnis und ruhigem Bild; Anfrage wartet sonst', function () {
  var a = app(), N = a.N, st = { active: true, calm: true, since: 90000 };
  N.player = { status: function () { return st; } };
  N.router = { topName: function () { return 'player'; } };
  a.mem['news-p1.json'] = JSON.stringify({ srv: 'm1', libs: { 2: { sig: 'c1', at: 100 } } });
  N.libwatch.note(secs([{ key: '2', type: 'show', contentChangedAt: 5 }]));
  assert.strictEqual(a.calls.length, 0, 'Video ohne Erlaubnis: keine Anfrage');
  eq(N.newWatch._todo().length, 1, 'wartet');
  N.newWatch._reset();
  N.session.settings.newsPlay = true;
  assert.ok(N.newWatch.quiet());
  st.calm = false; assert.ok(!N.newWatch.quiet(), 'Puffern/OSD');
  st.calm = true; st.since = 10000; assert.ok(!N.newWatch.quiet(), 'erste Minute');
  st.since = 90000;
  N.libwatch._reset();
  var added = []; N.idle.add = function (fn, k) { added.push(k); };
  assert.ok(N.newWatch.playTick(), 'Takt im Video fragt nach (Alter unbekannt)');
  eq(added, ['news-play']);
});
