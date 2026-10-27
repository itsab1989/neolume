'use strict';
/* M3b Bibliothek: Raster-Geometrie (N.GridMath), Sortier-/Filter-Parameter, Statuszeile, A–Z-Register, T9-Sprung (N.lib). */
var test = require('node:test'), assert = require('node:assert');
var H = require('./helpers/load');
var N = H.load().N, G = N.GridMath, L = N.lib;
N.i18n.set('de');
var MOVIES = { id: 1, title: 'Filme', type: 'movie' }, SHOWS = { id: 2, title: 'Serien', type: 'show' };

test('Raster: 5 Spalten, Schritt 200/340, Fokus-Anker y 176, Fenster Zeile -1 … +3 (25 Karten)', function () {
  H.eq(G.pos(0), { x: 144, y: 176 });
  H.eq(G.pos(7), { x: 544, y: 516 });
  assert.strictEqual(G.offset(3), -1020);
  H.eq(G.win(538, 0), { first: 0, last: 19 });
  H.eq(G.win(538, 10), { first: 45, last: 69 });
  assert.strictEqual(G.win(538, 10).last - G.win(538, 10).first + 1, G.POOL);
  H.eq(G.win(12, 2), { first: 5, last: 11 });
  H.eq(G.win(0, 0), { first: 0, last: -1 });
});
test('Raster: Navigation ohne Wrap, letzte unvollstaendige Zeile, 3-Zeilen-Spruenge', function () {
  assert.strictEqual(G.move(4, 20, 'RIGHT'), -1);
  assert.strictEqual(G.move(5, 20, 'LEFT'), -1);
  assert.strictEqual(G.move(2, 20, 'UP'), -1);
  assert.strictEqual(G.move(8, 12, 'DOWN'), 11);      // in die kurze letzte Zeile -> letztes Element
  assert.strictEqual(G.jumpRows(2, 100, 3), 17);
  assert.strictEqual(G.jumpRows(17, 100, -3), 2);
  assert.strictEqual(G.jumpRows(7, 100, -3), 2);       // nicht ueber den Anfang hinaus, gleiche Spalte
  assert.strictEqual(G.jumpRows(91, 98, 3), 96);       // letzte Zeile, gleiche Spalte
  assert.strictEqual(G.jumpRows(94, 98, 3), 97);       // Spalte gibt es dort nicht -> letztes
});
test('Raster: Seiten (je 50) fuer Fenster + 2 Zeilen Vorlauf', function () {
  H.eq(G.pagesFor(538, 0), [0]);
  H.eq(G.pagesFor(538, 6), [0, 1]);                    // Zeile 6 -> Indizes 25 … 59 (+10)
  H.eq(G.pagesFor(538, 15), [1, 2]);
  H.eq(G.pagesFor(0, 0), []);
});
test('Raster: Zeiger nur auf Kartenkoerper der Fokus- und der angeschnittenen Zeile', function () {
  assert.strictEqual(G.hit(100, 2, 150, 200), 10);
  assert.strictEqual(G.hit(100, 2, 330, 200), -1);      // Luecke zwischen Karten
  assert.strictEqual(G.hit(100, 2, 350, 520), 16);      // naechste Zeile
  assert.strictEqual(G.hit(100, 2, 350, 640), -1);      // im deckenden Band
  assert.strictEqual(G.hit(12, 2, 750, 520), -1);       // Index existiert nicht
});

test('Sortierung: Titel A–Z Standard, andere Eintraege absteigend, erneutes OK dreht die Richtung', function () {
  var p = L.defaults();
  assert.strictEqual(L.sortParam(p, MOVIES), 'titleSort:asc');
  p = L.pickSort(p, 'added', MOVIES);
  assert.strictEqual(L.sortParam(p, MOVIES), 'addedAt:desc,titleSort:asc');
  assert.strictEqual(L.sortParam(p, SHOWS), 'episode.addedAt:desc,titleSort:asc');
  p = L.pickSort(p, 'added', MOVIES);
  assert.strictEqual(L.sortParam(p, MOVIES), 'addedAt:asc,titleSort:asc');
  assert.strictEqual(L.sortLabel(p), 'Zuletzt hinzugefügt (umgekehrt)');
  p = L.pickSort(p, 'title', MOVIES); p = L.pickSort(p, 'title', MOVIES);
  assert.strictEqual(L.sortParam(p, MOVIES), 'titleSort:desc');
  assert.strictEqual(L.sortLabel(p), 'Titel Z–A');
});
test('Sortierung "Ungesehene zuerst": Filme viewCount:asc, Serien unviewedLeafCount:desc, Richtung fest', function () {
  var p = L.pickSort(L.defaults(), 'unwatchedFirst', MOVIES);
  assert.strictEqual(L.sortParam(p, MOVIES), 'viewCount:asc,titleSort:asc');
  assert.strictEqual(L.sortParam(p, SHOWS), 'unviewedLeafCount:desc,titleSort:asc');
  assert.strictEqual(L.sortParam(L.pickSort(p, 'unwatchedFirst', MOVIES), MOVIES), 'viewCount:asc,titleSort:asc');
});
test('Filter -> Query (am PMS 1.43 per GET geprueft)', function () {
  var p = L.defaults();
  H.eq(L.filterQuery(p, MOVIES), { type: 1 });
  p.f = { status: 'unwatched', genre: { id: '143', t: 'Action' }, decade: { id: '1990', t: '1990s' }, res: { id: '4k', t: '4K' }, coll: { id: '9', t: 'Bond' } };
  H.eq(L.filterQuery(p, MOVIES), { type: 1, unwatched: 1, genre: '143', decade: '1990', resolution: '4k', collection: '9' });
  H.eq(L.filterQuery(p, SHOWS), { type: 2, unwatched: 1, genre: '143', decade: '1990', collection: '9' });   // keine Aufloesung bei Serien
  p.f = { status: 'started', actor: { id: 150, t: 'Paul Walker' } };
  H.eq(L.filterQuery(p, MOVIES), { type: 1, inProgress: 1, actor: 150 });
  p.f = { status: 'watched' };
  H.eq(L.filterQuery(p, MOVIES), { type: 1, unwatched: 0 });
  var q = L.pageQuery(MOVIES, p, 100, 50);
  assert.strictEqual(q.path, '/library/sections/1/all');
  assert.strictEqual(q.q['X-Plex-Container-Start'], 100);
  assert.strictEqual(q.q['X-Plex-Container-Size'], 50);
  assert.strictEqual(q.q.excludeFields, 'summary,tagline');
});
test('Statuszeile DE/EN, Filter in Klartext', function () {
  var p = L.defaults();
  assert.strictEqual(L.status(248, -1, p), '248 Titel · Titel A–Z');
  p.f = { status: 'unwatched', actor: { id: 1, t: 'Paul Walker' } };
  assert.strictEqual(L.status(37, 248, p), '37 von 248 Titeln · Titel A–Z · Nur ungesehene · mit Paul Walker');
  N.i18n.set('en');
  assert.strictEqual(L.status(1, -1, L.defaults()), '1 title · Title A–Z');
  assert.strictEqual(L.status(37, 248, p), '37 of 248 titles · Title A–Z · Unwatched only · with Paul Walker');
  N.i18n.set('de');
});
test('Alle abspielen / Zufall: Play-Queue-URI mit Filter und Sortierung', function () {
  var p = L.defaults(); p.f = { status: 'unwatched' };
  var uri = L.queueUri('mid1', MOVIES, p);
  assert.strictEqual(uri, 'server://mid1/com.plexapp.plugins.library/library/sections/1/all?type=1&unwatched=1&sort=titleSort%3Aasc');
});

var FC = { MediaContainer: { size: 5, Directory: [{ key: '%23', title: '#', size: 12 }, { key: 'A', title: 'A', size: 27 }, { key: 'B', title: 'B', size: 40 },
  { key: 'D', title: 'D', size: 43 }, { key: 'Ä', title: 'Ä', size: 2 }, { key: 'Z', title: 'Z', size: 6 }] } };
test('Register: /firstCharacter -> Buchstaben, Umlaute/Sonderzeichen zu #', function () {
  var c = L.chars(FC);
  H.eq(c.map(function (x) { return x.ch; }), ['#', 'A', 'B', 'D', '#', 'Z']);
});
test('Register: Sprung-Offsets (aufsteigend/absteigend), fehlender Buchstabe -> naechster', function () {
  var c = L.chars({ MediaContainer: { Directory: [{ title: '#', size: 12 }, { title: 'A', size: 27 }, { title: 'B', size: 40 }, { title: 'D', size: 43 }, { title: 'Z', size: 6 }] } });
  H.eq(L.jump(c, 'A', false), { idx: 12, ch: 'A' });
  H.eq(L.jump(c, 'C', false), { idx: 79, ch: 'D' });     // C fehlt -> D
  H.eq(L.jump(c, '#', false), { idx: 0, ch: '#' });
  H.eq(L.jump(c, 'Z', true), { idx: 0, ch: 'Z' });
  H.eq(L.jump(c, 'C', true), { idx: 49, ch: 'B' });      // absteigend: naechster in Laufrichtung
  assert.strictEqual(L.letterAt(c, 0, false), '#');
  assert.strictEqual(L.letterAt(c, 12, false), 'A');
  assert.strictEqual(L.letterAt(c, 78, false), 'B');
  assert.strictEqual(L.letterAt(c, 127, false), 'Z');
  assert.strictEqual(L.letterAt(c, 0, true), 'Z');
  H.eq(L.regWindow(c, 'B', false), ['#', 'A', 'B', 'D', 'Z']);
  H.eq(L.regWindow(c, '#', false), ['', '', '#', 'A', 'B']);
  H.eq(L.regWindow(c, 'Z', true), ['', '', 'Z', 'D', 'B']);
  assert.strictEqual(L.regStep(c, 'A', 1, false), 'B');
  assert.strictEqual(L.regStep(c, '#', -1, false), '#');
});
test('T9-Erstbuchstabe: 2 = A, 22 = B, 222 = C, 2222 = A, 7777 = S, 0/1 = #', function () {
  assert.strictEqual(L.t9('2', 1), 'A');
  assert.strictEqual(L.t9('2', 2), 'B');
  assert.strictEqual(L.t9('2', 3), 'C');
  assert.strictEqual(L.t9('2', 4), 'A');
  assert.strictEqual(L.t9('7', 4), 'S');
  assert.strictEqual(L.t9('9', 4), 'Z');
  assert.strictEqual(L.t9('0', 1), '#');
  assert.strictEqual(L.t9('1', 2), '#');
});
test('Merken je Bibliothek + Profil (ohne Person-Filter)', function () {
  var store = {};
  N.store.init({ read: function (n) { return store[n] || null; }, write: function (n, t) { store[n] = t; } });
  N.session.profile = { uuid: 'u1' };
  var p = L.pickSort(L.defaults(), 'rating', MOVIES); p.tab = 'coll'; p.f = { status: 'unwatched', actor: { id: 1, t: 'X' } };
  L.save(1, p);
  var back = L.load(1);
  H.eq(back, { tab: 'coll', sort: 'rating', desc: true, view: '', f: { status: 'unwatched' } });
  p.view = 'S'; L.save(1, p); assert.strictEqual(L.load(1).view, 'S');
  assert.strictEqual(L.view({ view: '' }), 'L'); assert.strictEqual(L.view({ view: 'list' }), 'list');
  H.eq(L.load(2), JSON.parse(JSON.stringify(L.defaults())));
  N.session.profile = { uuid: 'u2' };
  H.eq(L.load(1), JSON.parse(JSON.stringify(L.defaults())));   // anderes Profil
});

test('normList: librarySectionID vom Container, wenn die Eintraege keine tragen (PMS /library/sections/X/all, TV-Befund Seitenleiste)', function () {
  var l = N.model.normList([{ ratingKey: '1', type: 'show', title: 'A' }, { ratingKey: '2', type: 'movie', title: 'B', librarySectionID: 1 }], { 2: 'show', 1: 'movie' }, 2);
  assert.strictEqual(l[0].lib, 2); assert.strictEqual(l[0].kind, 'show');
  assert.strictEqual(l[1].lib, 1);
  assert.strictEqual(N.model.normList([{ ratingKey: '3', type: 'movie' }], {})[0].lib, 0);
});
