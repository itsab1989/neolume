'use strict';
/* HOME-14 "Alle anzeigen" am Ende einer Startseiten-Reihe: welche Reihen die Karte bekommen, wohin sie fuehrt (Bibliothek nach
 * "Zuletzt hinzugefuegt" nur fuer diesen Besuch bzw. ganze Liste), Karte bleibt am Ende (Cache, Auswahl), gemerkte Sortierung bleibt. */
var test = require('node:test'), assert = require('node:assert');
var H = require('./helpers/load'), S = H.synthetic;
var N = H.load().N, Hb = N.hubs, L = N.lib;
N.i18n.set('de');
function eq(a, b, m) { assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b, m); }   // vm-Kontext: Objekte aus anderem Realm
function list(f) { return S(f).MediaContainer.Metadata || []; }
function hubJson(h) { return { MediaContainer: { Hub: [h] } }; }
function ep(rk, show) { return { ratingKey: String(rk), type: 'episode', title: 'Folge ' + rk, grandparentTitle: 'S' + show, grandparentRatingKey: String(show), parentIndex: 1, index: rk, duration: 1000 }; }

test('Neu in …: immer eine Karte "Alle anzeigen" am Ende -> Bibliothek nach "Zuletzt hinzugefuegt"', function () {
  var libs = Hb.libraries(S('sections.json'));
  var rows = Hb.buildRows({ libs: libs, order: ['new-1', 'new-2'], recent: { 1: list('recent-1.json'), 2: list('recent-2.json') } });
  rows.forEach(function (r) {
    var last = r.items[r.items.length - 1];
    assert.ok(last.all, r.id + ': letzte Karte ist "Alle anzeigen"');
    assert.strictEqual(last.rk, 'all:' + r.id);
    eq(r.all, { t: 'lib', lib: Number(r.id.slice(4)), sort: 'added' });
    assert.strictEqual(Hb.realCount(r), r.items.length - 1);
  });
});

test('Server-Hub: Karte nur, wenn der Server mehr hat (more / mehr als gezeigt); "zuletzt hinzugefuegt"-Hub -> Bibliothek', function () {
  var libs = [{ id: 1, title: 'Filme', type: 'movie', kind: 'movie' }], alibs = libs.concat([{ id: 3, title: 'Musik', type: 'artist', kind: 'music' }]);
  var meta = [{ ratingKey: '1', type: 'movie', title: 'A' }, { ratingKey: '2', type: 'movie', title: 'B' }];
  function row(lib, h, id) { return Hb.buildRows({ libs: libs, alibs: alibs, order: [id], hubs: (function () { var o = {}; o[lib] = hubJson(h); return o; })() })[0]; }
  var more = row(1, { hubIdentifier: 'movie.toprated.1', context: 'hub.movie.toprated', type: 'movie', title: 'Bestbewertet', key: '/hubs/sections/1/toprated', more: true, Metadata: meta }, 'hub-1-movie.toprated');
  eq(more.all, { t: 'list', src: 'hub', key: '/hubs/sections/1/toprated', lib: 1 });
  assert.ok(more.items[2].all);
  var all = row(1, { hubIdentifier: 'movie.toprated.1', context: 'hub.movie.toprated', type: 'movie', title: 'Bestbewertet', key: '/x', more: false, Metadata: meta }, 'hub-1-movie.toprated');
  assert.strictEqual(all.all, null, 'zeigt schon alles -> keine Karte');
  assert.strictEqual(all.items.length, 2);
  var nokey = row(1, { hubIdentifier: 'movie.toprated.1', context: 'hub.movie.toprated', type: 'movie', title: 'B', more: true, Metadata: meta }, 'hub-1-movie.toprated');
  assert.strictEqual(nokey.all, null, 'ohne key keine ganze Liste');
  var mus = row(3, { hubIdentifier: 'music.recent.added.3', context: 'hub.music.recent.added', type: 'album', title: 'Neue Alben', key: '/hubs/x', more: false,
    Metadata: [{ ratingKey: '9', type: 'album', title: 'Album' }] }, 'hub-3-music.recent.added');
  eq(mus.all, { t: 'lib', lib: 3, sort: 'added' }, 'Musik/Hoerbuecher "zuletzt hinzugefuegt": Bibliothek (Alben/Buecher) nach Hinzugefuegt');
  assert.strictEqual(mus.kind, 'sq');
});

test('Weiterschauen / Naechste Folgen: Karte nur, wenn der Server mehr als die geholten 20 hat (Zahl, wenn bekannt)', function () {
  var cw = list('continueWatching.json');
  function cwRow(tot) { return Hb.buildRows({ libs: [], order: ['cw'], cw: cw, tot: { cw: tot } })[0]; }
  assert.strictEqual(cwRow({ got: cw.length, total: cw.length }).all, null);
  assert.strictEqual(cwRow({ got: cw.length, total: 0 }).all, null, 'weniger als 20 ohne Gesamtzahl -> alles da');
  eq(cwRow({ got: 20, total: 35 }).all, { t: 'list', src: 'cw', n: 35 });
  eq(cwRow({ got: 20, total: 0 }).all, { t: 'list', src: 'cw', n: 0 }, 'volle Seite ohne Gesamtzahl: vermutlich mehr');
  assert.strictEqual(Hb.buildRows({ libs: [], order: ['cw'], cw: cw })[0].all, null, 'ohne Angaben keine Karte');
  var r = cwRow({ got: 20, total: 35 });
  assert.strictEqual(r.items[r.items.length - 1].alln, 35);
  var deck = Hb.buildRows({ libs: [], order: ['deck'], deck: list('onDeck.json'), tot: { deck: { got: 20, total: 50 } } })[0];
  eq(deck.all, { t: 'list', src: 'deck', n: 50 });
  assert.strictEqual(Hb.buildRows({ libs: [], order: ['pl'], pl: [{ ratingKey: '7', type: 'playlist', title: 'P' }] })[0].all, null, 'Playlists: keine Karte');
});

test('Karte bleibt am Ende: idempotent, nie im Cache, Auswahl/Cache bringt sie zurueck, sameRow sieht Zieländerung', function () {
  var row = { id: 'new-1', kind: 'poster', all: { t: 'lib', lib: 1, sort: 'added' }, items: [{ rk: '1', title: 'A' }] };
  Hb.withAll(row); Hb.withAll(row);
  assert.strictEqual(row.items.length, 2);
  var big = { id: 'new-2', kind: 'poster', all: { t: 'lib', lib: 2, sort: 'added' }, items: [] };
  for (var i = 0; i < 40; i++) big.items.push({ rk: String(i), title: 'Titel ' + i, sum: new Array(400).join('x') });
  Hb.withAll(big);
  var c = Hb.forCache([big], 900)[0];
  assert.ok(c.items.length < 40, 'gekuerzt');
  assert.ok(!Hb.forCache([big])[0].items.some(function (x) { return x.all; }), 'nie im Cache (Suche-Vorschlaege, Schoner lesen ihn)');
  assert.strictEqual(Hb.forCache([big])[0].all.t, 'lib', 'Ziel bleibt an der Reihe');
  assert.ok(big.items[40].all, 'Original unveraendert');
  var picked = Hb.pick(Hb.forCache([row]), ['new-1'])[0];
  assert.ok(picked.items[1].all && picked.items.length === 2, 'pick haengt die Karte beim Lesen wieder an');
  var other = JSON.parse(JSON.stringify(row)); other.all.lib = 9;
  assert.ok(Hb.sameRow(row, JSON.parse(JSON.stringify(row))));
  assert.ok(!Hb.sameRow(row, other));
});

test('Ganze Liste "Naechste Folgen": nur Folgen, ohne Angefangene/Serien aus Weiterschauen, ohne Doppelte; andere Listen unveraendert', function () {
  var items = N.model.normList([ep(1, 100), ep(2, 100), ep(3, 200), { ratingKey: '50', type: 'movie', title: 'Film', viewOffset: 10, duration: 100 },
    (function () { var e = ep(4, 300); e.viewOffset = 5; return e; })(), ep(5, 400)], {});
  var out = Hb.listItems({ src: 'deck', cwOn: true, cw: [{ rk: '9', showRk: '400' }] }, items);
  eq(out.map(function (x) { return x.rk; }), ['1', '3']);
  eq(Hb.listItems({ src: 'deck', cwOn: false, cw: [] }, items).map(function (x) { return x.rk; }), ['1', '3', '4', '5']);
  assert.strictEqual(Hb.listItems({ src: 'hub' }, items), items);
});

test('Bibliothek aus "Alle anzeigen": nur fuer diesen Besuch nach Hinzugefuegt, ohne Filter; gemerkte Sortierung bleibt unangetastet', function () {
  var store = {};
  N.store.init({ read: function (n) { return store[n] || null; }, write: function (n, t) { store[n] = t; } });
  N.session.profile = { uuid: 'u1' };
  var saved = { tab: 'coll', sort: 'title', desc: false, view: 'M', f: { status: 'unwatched' } };
  L.save(1, saved);
  var before = JSON.stringify(L.load(1));
  var p = L.oncePrefs(L.load(1), 'added', false, false);
  eq(p, { tab: 'lib', sort: 'added', desc: true, view: 'M', f: { status: '' } });
  assert.strictEqual(L.sortParam(p, { type: 'movie' }), 'addedAt:desc,titleSort:asc');
  assert.strictEqual(L.sortParam(p, { type: 'show' }), 'episode.addedAt:desc,titleSort:asc', 'Serien: neueste Folge zuerst – wie die Reihe (je Serie)');
  assert.strictEqual(JSON.stringify(L.load(1)), before, 'gemerkte Werte unveraendert');
  assert.strictEqual(L.status(312, -1, p, { type: 'movie' }), '312 Titel · Zuletzt hinzugefügt');
  eq(L.oncePrefs(null, 'added', true, false).tab, 'alt', 'Musik: Alben');
  eq(L.oncePrefs(null, 'added', true, true).tab, 'lib', 'Hoerbuecher: Buecher');
  var mq = L.pageQuery({ id: 3, type: 'album' }, L.oncePrefs(null, 'added', true, false), 0, 50).q;
  assert.strictEqual(mq.type, 9); assert.strictEqual(mq.sort, 'addedAt:desc,titleSort:asc');
});

test('Texte: Karte, Hinweis, Statuszusatz, leere Liste in DE und EN', function () {
  ['de', 'en'].forEach(function (l) {
    N.i18n.set(l);
    ['home.row.all', 'hint.showAll', 'lib.status.once', 'empty.list.title', 'empty.list.text'].forEach(function (k) { assert.ok(N.t(k) && N.t(k) !== k, l + ' ' + k); });
    assert.ok(/312/.test(N.t('home.row.allN', { n: 312 })));
  });
  N.i18n.set('de');
});
