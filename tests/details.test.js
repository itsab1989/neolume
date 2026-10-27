'use strict';
/* M3b Details: Metadaten -> Modell (Besetzung, Extras/Trailer, Aehnliche), Staffeln, Metazeile, Chips, Buttons, Folgensprung. */
var test = require('node:test'), assert = require('node:assert');
var H = require('./helpers/load');
var N = H.load().N, D = N.det;
N.i18n.set('de');

var MOVIE = { ratingKey: '18681', type: 'movie', title: '2 Fast 2 Furious', year: 2003, duration: 6468704, contentRating: 'de/16', audienceRating: 5.0,
  librarySectionID: 1, summary: 'Brian ...', tagline: 'Wie schnell?', studio: 'Ardustry', originallyAvailableAt: '2003-06-05',
  Genre: [{ id: 143, tag: 'Action' }, { id: 144, tag: 'Krimi' }], Director: [{ id: 146, tag: 'John Singleton' }],
  Role: [{ id: 150, tag: 'Paul Walker', role: "Brian O'Conner", thumb: 'https://metadata-static.plex.tv/x.jpg' }, { id: 151, tag: 'Tyrese Gibson', role: 'Roman' }],
  Media: [{ videoResolution: '1080', videoCodec: 'h264', audioCodec: 'dca', Part: [{ id: 1, Stream: [{ streamType: 1 }, { streamType: 2, languageCode: 'deu', selected: true }, { streamType: 2, languageCode: 'eng' },
    { streamType: 3, languageCode: 'deu', codec: 'srt' }] }] }],
  Extras: { size: 2, Metadata: [{ ratingKey: '36', type: 'clip', subtype: 'behindTheScenes', extraType: 5, title: 'Making-of', thumb: '/t/36' }, { ratingKey: '35', type: 'clip', subtype: 'trailer', extraType: 1, title: 'Trailer', thumb: '/t/35' }] },
  Related: { Hub: [{ hubIdentifier: 'movie.similar', title: 'Ähnliche Filme', Metadata: [{ ratingKey: '9', type: 'movie', title: 'Five' }] },
    { hubIdentifier: 'movie.same.actor.0', title: 'Mehr mit Paul Walker', Metadata: [{ ratingKey: '10', type: 'movie', title: 'X' }] }] } };

test('Film: Besetzung (Filter-ID), Extras + Trailer, nur "aehnliche" Hubs, Genres', function () {
  var d = D.parse(MOVIE, { 1: 'movie' });
  assert.strictEqual(d.cast.length, 2);
  H.eq([d.cast[0].id, d.cast[0].title, d.cast[0].role, d.cast[0].type], [150, 'Paul Walker', "Brian O'Conner", 'person']);
  assert.strictEqual(d.extras.length, 2);
  assert.strictEqual(d.trailer.rk, '35');
  assert.strictEqual(d.related.length, 1);
  assert.strictEqual(d.related[0].items[0].title, 'Five');
  assert.strictEqual(D.overline(d.it, d), 'FILM · Action');
  assert.strictEqual(d.lib, 1);
});
test('Metazeile Film (mit Fortschritt: noch … · Ende um), Folge (Erstausstrahlung), Serie (Weiter mit)', function () {
  var d = D.parse(MOVIE, {}), it = d.it;
  assert.strictEqual(D.meta(it, d), '2003 · 1 Std. 48 Min. · FSK 16 · 5,0/10');
  it.off = 6468704 - 62 * 60000;
  var now = new Date(2026, 9, 26, 22, 12).getTime();
  assert.strictEqual(D.meta(it, d, now), '2003 · 1 Std. 48 Min. · FSK 16 · 5,0/10 · noch 1 Std. 2 Min. · Ende um 23:14');
  var ep = N.model.norm({ ratingKey: '5', type: 'episode', title: 'Tote Magier', grandparentTitle: 'Nordlicht', index: 5, parentIndex: 1, duration: 1440000 });
  assert.strictEqual(D.meta(ep, { date: '2023-10-06' }), '24 Min. · Erstausstrahlung 06.10.2023');
  var show = D.parse({ ratingKey: '7', type: 'show', title: 'Nordlicht', year: 2023, childCount: 2, leafCount: 40, viewedLeafCount: 4,
    OnDeck: { Metadata: { ratingKey: '5', type: 'episode', title: 'Tote Magier', index: 5, parentIndex: 1, duration: 1440000, viewOffset: 900000 } } }, {});
  assert.strictEqual(D.meta(show.it, show), '2023 · 2 Staffeln · Weiter mit S1 · F5 · noch 9 Min.');
  N.i18n.set('en');
  assert.strictEqual(D.date('2023-10-06'), '10/06/2023');
  N.i18n.set('de');
});
test('Technik-Chips: nur Sprache (+ UT) und Aufloesung', function () {
  H.eq(D.chips(MOVIE.Media, 0), ['Deutsch', 'HD']);
  var m = JSON.parse(JSON.stringify(MOVIE.Media)); m[0].videoResolution = '4k'; m[0].Part[0].Stream[3].selected = true; m[0].Part[0].Stream[1].selected = false; m[0].Part[0].Stream[2].selected = true;
  H.eq(D.chips(m, 0), ['Englisch · UT Deutsch', '4K, als HD']);
  H.eq(D.chips([], 0), []);
});
test('Buttons: Abspielen/Fortsetzen, Von vorne nur mit Fortschritt, Trailer nur mit lokalem Trailer, Gesehen-Zielzustand, ⋯', function () {
  var d = D.parse(MOVIE, {});
  H.eq(D.buttons(d.it, d).map(function (b) { return b.id; }), ['play', 'trailer', 'watched', 'more']);
  assert.strictEqual(D.buttons(d.it, d)[0].t, 'Abspielen');
  d.it.off = 100000;
  var b = D.buttons(d.it, d);
  H.eq(b.map(function (x) { return x.id; }), ['play', 'start', 'trailer', 'watched', 'more']);
  assert.strictEqual(b[0].t, 'Fortsetzen');
  d.it.off = 0; d.it.vc = 1;
  assert.strictEqual(D.buttons(d.it, d)[2].t, 'Ungesehen');
});
test('Staffeln: Specials zuletzt, Start-Staffel (Wunsch > naechste Folge > erste mit Ungesehenem)', function () {
  var s = D.seasons({ MediaContainer: { Metadata: [{ type: 'season', ratingKey: '9', index: 0, leafCount: 3 }, { type: 'season', ratingKey: '2', index: 2, leafCount: 10, viewedLeafCount: 0 },
    { type: 'season', ratingKey: '1', index: 1, leafCount: 12, viewedLeafCount: 12 }, { title: 'Alle Folgen', ratingKey: 'x' }] } });
  H.eq(s.map(function (x) { return x.index; }), [1, 2, 0]);
  assert.strictEqual(D.tabLabel(s[2]), 'Specials');
  assert.strictEqual(D.tabLabel(s[1]), 'Staffel 2');
  assert.strictEqual(D.pickSeason(s, 0, null), 2);
  assert.strictEqual(D.pickSeason(s, null, { s: 1 }), 0);
  assert.strictEqual(D.pickSeason(s, null, null), 1);
});
test('Folgen: Fokus (angefangen > erste ungesehene), Beschriftung, Ziffernsprung auch bei Platzhaltern', function () {
  var M = N.model, eps = [];
  for (var i = 1; i <= 60; i++) eps.push(i <= 50 ? M.norm({ ratingKey: String(i), type: 'episode', index: i, title: 'T' + i, duration: 1440000, viewCount: i < 4 ? 1 : 0, viewOffset: i === 6 ? 600000 : 0 }) : D.placeholder(1, i));
  assert.strictEqual(D.pickEpisode(eps), 5);
  assert.strictEqual(D.pickEpisode(eps, 12), 11);
  H.eq(D.epCaption(eps[5]), ['F6 · T6', '24 Min. · noch 14 Min.']);
  H.eq(D.epCaption(eps[0]), ['F1 · T1', '24 Min. · Gesehen']);
  H.eq(D.epCaption(eps[55]), ['', '']);
  assert.strictEqual(D.epIndex(eps, 60, 12), 11);
  assert.strictEqual(D.epIndex(eps, 60, 57), 56);      // noch nicht geladen -> Schaetzung ueber die Position
  assert.strictEqual(D.epIndex(eps, 60, 999), 59);
});
test('INFO-Text: Tagline, Beschreibung, Regie, Studio, Datei (max. 600 Zeichen)', function () {
  var d = D.parse(MOVIE, {}), t = D.info(d.it, d);
  assert.ok(t.indexOf('Wie schnell?') === 0);
  assert.ok(t.indexOf('Regie: John Singleton') > 0);
  assert.ok(t.indexOf('1080 · H264 · DCA') > 0);
  assert.ok(t.length <= 600);
});

test('Staffel-Reiter: links nie halb abgeschnitten, fokussierter Reiter ganz sichtbar (F14)', function () {
  var D = require('./helpers/load').load().N.det;
  var X = [[0, 112], [120, 112], [232 + 8, 112], [360, 112], [480, 112], [600, 120]];   // 6 Staffeln, Fenster 464
  assert.strictEqual(D.tabOffset(X, 0, 0, 464), 0);
  assert.strictEqual(D.tabOffset(X, 2, 0, 464), 0);
  assert.strictEqual(D.tabOffset(X, 3, 0, 464), 120);            // 472 > 464: um genau einen Reiter weiter
  var o = D.tabOffset(X, 4, 0, 464);
  assert.ok(X.some(function (t) { return t[0] === o; }) && 592 <= o + 464 && o <= 480);
  o = D.tabOffset(X, 5, o, 464);
  assert.ok(X.some(function (t) { return t[0] === o; }) && 720 <= o + 464);
  assert.strictEqual(D.tabOffset(X, 1, o, 464), 120);            // zurueck: Reiter links buendig
});

test('Beschreibung mit "…": JS-Ersatz kuerzt an Wortgrenzen, bis der Text passt (F13, ohne -webkit-line-clamp)', function () {
  var U = require('./helpers/load').load().N.util, old = U.clampCss;
  U.clampCss = false;
  var el = { offsetHeight: 52 }, node = { nodeValue: '', parentNode: el };
  Object.defineProperty(el, 'scrollHeight', { get: function () { return Math.ceil(node.nodeValue.length / 40) * 26; } });   // 40 Zeichen je Zeile
  var s = 'Ein langer Text, der deutlich mehr als zwei Zeilen braucht und deshalb am Ende gekuerzt werden muss, damit er passt.';
  U.clampText(node, s);
  assert.ok(node.nodeValue.length <= 80 && /…$/.test(node.nodeValue), node.nodeValue);
  assert.ok(s.indexOf(node.nodeValue.slice(0, -2)) === 0);
  U.clampText(node, 'Kurz.');
  assert.strictEqual(node.nodeValue, 'Kurz.');
  U.clampCss = old;
});

test('Genre-Tags in der App-Sprache (F22): bekannte uebersetzt, unbekannte unveraendert', function () {
  var N = require('./helpers/load').load().N;
  N.i18n.set('de');
  assert.strictEqual(N.fmt.genre('Adventure'), 'Abenteuer'); assert.strictEqual(N.fmt.genre('science fiction'), 'Science-Fiction');
  assert.strictEqual(N.fmt.genre('Abenteuer'), 'Abenteuer'); assert.strictEqual(N.fmt.genre('Heimatfilm'), 'Heimatfilm');
  N.i18n.set('en');
  assert.strictEqual(N.fmt.genre('Komödie'), 'Comedy'); assert.strictEqual(N.fmt.genre('Adventure'), 'Adventure');
  N.i18n.set('de');
});
