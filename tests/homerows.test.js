'use strict';
/* "Startseite anpassen" (SPEC 7.3.1): Reihen-Konfiguration, Hub-Katalog, Dedupe "Neu in" je Serie, Laden nach Konfiguration */
var test = require('node:test'), assert = require('node:assert');
var H = require('./helpers/load'), S = H.synthetic, eq = H.eq;
var N = H.load().N, HR = N.homeRows;
function ids(list) { return list.map(function (r) { return r.id; }); }
var LIBS = [{ id: 1, title: 'Filme', type: 'movie' }, { id: 2, title: 'Serien', type: 'show' }];
var CAT = { hubs: [{ id: 'hub-1-movie.topunwatched' }, { id: 'hub-2-tv.toprated' }], pl: { title: 'Playlists' } };

test('Standard: Weiterschauen, Naechste Folgen, Neu je Bibliothek an; Server-Hubs und Playlists aus', function () {
  var v = HR.view(null, HR.avail(LIBS, CAT));
  eq(ids(v), ['cw', 'deck', 'new-1', 'new-2', 'hub-1-movie.topunwatched', 'hub-2-tv.toprated', 'pl']);
  eq(v.map(function (r) { return r.on; }), [true, true, true, true, false, false, false]);
  eq(HR.enabled(null, HR.avail(LIBS, CAT)), ['cw', 'deck', 'new-1', 'new-2']);
});

test('Gespeicherte Reihenfolge bleibt; neue Bibliothek/neuer Hub erscheinen an ihrer Standard-Stelle', function () {
  var saved = [{ id: 'new-2', on: true }, { id: 'cw', on: true }, { id: 'hub-2-tv.toprated', on: true }, { id: 'deck', on: false }, { id: 'new-1', on: true }];
  var libs = LIBS.concat([{ id: 7, title: 'Kinder', type: 'show' }]);
  var cat = { hubs: [{ id: 'hub-1-movie.topunwatched' }, { id: 'hub-2-tv.toprated' }, { id: 'hub-2-tv.rediscover' }] };
  var v = HR.view(saved, HR.avail(libs, cat));
  // new-7 (Standard an) direkt hinter seinen Standard-Vorgaenger new-2; neue Zusatz-Reihen (aus) ans Ende
  eq(ids(v), ['new-2', 'new-7', 'cw', 'hub-2-tv.toprated', 'deck', 'new-1', 'hub-1-movie.topunwatched', 'hub-2-tv.rediscover']);
  eq(v.map(function (r) { return r.on; }), [true, true, true, true, false, true, false, false]);
  eq(HR.enabled(saved, HR.avail(libs, cat)), ['new-2', 'new-7', 'cw', 'hub-2-tv.toprated', 'new-1']);
});

test('Verschwundener Hub: nicht sichtbar, aber Auswahl und Platz bleiben gespeichert (kommt er wieder, ist er wieder an)', function () {
  var saved = [{ id: 'cw', on: true }, { id: 'hub-1-movie.topunwatched', on: true }, { id: 'deck', on: true }, { id: 'new-1', on: true }, { id: 'new-2', on: true }];
  var gone = HR.avail(LIBS, { hubs: [] });
  eq(ids(HR.view(saved, gone)), ['cw', 'deck', 'new-1', 'new-2']);
  // Nutzer verschiebt in der sichtbaren Liste deck nach oben -> Speichern behaelt den unsichtbaren Hub an seiner Stelle
  var vis = HR.view(saved, gone); HR.move(vis, 1, -1);
  var st = HR.store(saved, gone, vis);
  eq(ids(st), ['deck', 'hub-1-movie.topunwatched', 'cw', 'new-1', 'new-2']);
  var back = HR.avail(LIBS, { hubs: [{ id: 'hub-1-movie.topunwatched' }] });
  eq(HR.enabled(st, back), ['deck', 'hub-1-movie.topunwatched', 'cw', 'new-1', 'new-2']);
});

test('Verschieben an den Raendern und Startseite: Hubs nur, wenn ihre Bibliothek existiert', function () {
  var l = [{ id: 'a' }, { id: 'b' }];
  assert.strictEqual(HR.move(l, 0, -1), 0); assert.strictEqual(HR.move(l, 0, 1), 1); eq(ids(l), ['b', 'a']);
  var saved = [{ id: 'hub-3-music.recent.added', on: true }, { id: 'hub-9-movie.toprated', on: true }, { id: 'pl', on: true }];
  var a = HR.homeAvail(saved, LIBS, LIBS.concat([{ id: 3, title: 'Musik', type: 'artist' }]));
  eq(HR.enabled(saved, a), ['cw', 'deck', 'new-1', 'new-2', 'hub-3-music.recent.added', 'pl']);   // hub-9: Bibliothek fehlt
});

test('Hub-Typ stabil: Sammlung behaelt Nummer, Genre/Person nur Familie; doppelnde Hubs werden nicht angeboten', function () {
  eq(HR.hubType({ hubIdentifier: 'movie.curated.1.1', context: 'hub.movie.curated' }, 1), { fam: 'movie.curated', type: 'movie.curated.1' });
  eq(HR.hubType({ hubIdentifier: 'movie.genre.1.143', context: 'hub.movie.genre' }, 1), { fam: 'movie.genre', type: 'movie.genre' });
  eq(HR.hubType({ hubIdentifier: 'music.recent.added.4' }, 4), { fam: 'music.recent.added', type: 'music.recent.added' });
  var cat = HR.hubsOf(S('hubs-1.json'), 1);
  eq(ids(cat), ['hub-1-movie.recentlyreleased', 'hub-1-movie.genre', 'hub-1-movie.curated.1']);
  assert.strictEqual(cat[0].title, 'Zuletzt veröffentlichte Filme');
});

test('Neu in: je Serie nur ein Eintrag (der neueste), mit Zahl neuer Folgen; Filme unveraendert', function () {
  var M = N.model, items = S('recent-2.json').MediaContainer.Metadata.map(function (m) { return M.norm(m, {}); });
  var out = N.hubs.byShow(items, 12);
  eq(out.map(function (i) { return i.rk; }), ['1303', '930', '941']);
  assert.strictEqual(out[0].nNew, 3);
  assert.strictEqual(out[1].nNew, undefined);
  N.i18n.set('de');
  eq(M.badge(out[0]), { b: 'count', n: '3 neu' });
  assert.strictEqual(items[0].nNew, undefined);              // Original unveraendert (Kopie)
  // Staffel + Folgen derselben Staffel: Folgen nicht doppelt zaehlen; Serie selbst = alle Folgen
  var mk = function (o) { return M.norm(o, {}); };
  var mix = [mk({ ratingKey: 5, type: 'episode', parentRatingKey: 40, grandparentRatingKey: 30, addedAt: 9 }),
    mk({ ratingKey: 40, type: 'season', parentRatingKey: 30, leafCount: 5, addedAt: 8 }),
    mk({ ratingKey: 6, type: 'episode', parentRatingKey: 41, grandparentRatingKey: 30, addedAt: 7 }),
    mk({ ratingKey: 7, type: 'movie', addedAt: 6 }), mk({ ratingKey: 8, type: 'movie', addedAt: 10 })];
  var r = N.hubs.byShow(mix, 12);
  eq(r.map(function (i) { return i.rk; }), ['8', '5', '7']);
  assert.strictEqual(r[1].nNew, 6);
  assert.strictEqual(N.hubs.byShow(mix, 2).length, 2);
});

test('Reihen aus Konfiguration: Reihenfolge, Hub-Reihe mit Server-Titel, Kopf ohne Weiterschauen ohne Abgleich', function () {
  var libs = N.hubs.libraries(S('sections.json')), alibs = N.hubs.allLibraries(S('sections.json'));
  eq(alibs.map(function (l) { return l.id + ':' + l.kind; }), ['1:movie', '2:show', '5:anime', '3:music', '6:doc']);
  var rows = N.hubs.buildRows({ libs: libs, alibs: alibs, order: ['hub-1-movie.recentlyreleased', 'deck', 'new-2'],
    deck: S('onDeck.json').MediaContainer.Metadata, recent: { 2: S('recent-2.json').MediaContainer.Metadata }, hubs: { 1: S('hubs-1.json') } });
  eq(ids(rows), ['hub-1-movie.recentlyreleased', 'deck', 'new-2']);
  assert.strictEqual(N.hubs.rowTitle(rows[0]), 'Zuletzt veröffentlichte Filme');
  assert.strictEqual(rows[0].kind, 'poster');
  assert.strictEqual(rows[2].items.length, 3);                 // Nachtzug nur einmal
  N.i18n.set('de'); assert.strictEqual(N.hubs.rowTitle(rows[1]), 'Nächste Folgen');
  N.i18n.set('en'); assert.strictEqual(N.hubs.rowTitle(rows[1]), 'Next episodes'); N.i18n.set('de');
});

/* Netz: nur eingeschaltete Reihen werden geladen; ein fehlgeschlagener Hub bricht nichts */
function netSetup(fail) {
  var ctx = H.load({ fakeTimers: true }), NN = ctx.N, T = ctx.timers;
  var files = { '/library/sections': 'sections.json', '/hubs/continueWatching/items': 'continueWatching.json', '/library/onDeck': 'onDeck.json', '/hubs/sections/1': 'hubs-1.json' };
  var x = H.FakeXHR(function (m, u) {
    var path = u.replace(/^http:\/\/pms:32400/, '').split('?')[0], q = u.split('?')[1] || '';
    var f = fail(path, q);
    if (f) return { status: f, body: {}, timers: T };
    if (path === '/hubs/home/recentlyAdded') return { status: 200, body: S('recent-' + /sectionID=(\d+)/.exec(q)[1] + '.json'), timers: T };
    if (path === '/playlists/all') return { status: 200, body: { MediaContainer: { Metadata: [{ ratingKey: '77', type: 'playlist', title: 'Lieblinge', composite: '/playlists/77/composite/1' }] } }, timers: T };
    return { status: 200, body: files[path] ? S(files[path]) : { MediaContainer: {} }, timers: T };
  });
  NN.http._setFactory(x.factory); NN.http._setTimers({ set: T.setTimeout, clear: T.clearTimeout }); NN.http._reset();
  NN.plex.setServer('http://pms:32400', 'TOK');
  return { N: NN, T: T, log: x.log };
}
function paths(log) { return log.opened.map(function (o) { return o.url.replace(/^http:\/\/pms:32400/, '').split('?')[0]; }); }
test('Laden nach Konfiguration: Weiterschauen aus -> keine Anfrage; Hubs EINMAL je Bibliothek; Playlists', function () {
  var cfg = [{ id: 'cw', on: false }, { id: 'pl', on: true }, { id: 'hub-1-movie.recentlyreleased', on: true }, { id: 'hub-1-movie.curated.1', on: true }, { id: 'new-1', on: false }];
  var s = netSetup(function () { return 0; }), res = null;
  s.N.hubs.fetch(function (e, r) { res = r; }, { cfg: cfg, plTitle: 'Zuletzt genutzt' });
  s.T.tick(10000);
  var p = paths(s.log);
  assert.ok(p.indexOf('/hubs/continueWatching/items') < 0);
  assert.strictEqual(p.filter(function (x) { return x === '/hubs/sections/1'; }).length, 1);
  assert.ok(!p.some(function (x, i) { return x === '/hubs/home/recentlyAdded' && /sectionID=1\b/.test(s.log.opened[i].url); }));
  eq(ids(res.rows), ['deck', 'pl', 'hub-1-movie.recentlyreleased', 'hub-1-movie.curated.1', 'new-2', 'new-6']);
  assert.strictEqual(res.rows[1].title, 'Zuletzt genutzt');
  assert.ok(/composite/.test(res.rows[1].items[0].thumb));
  eq(ids(res.hubCat[1]), ['hub-1-movie.recentlyreleased', 'hub-1-movie.genre', 'hub-1-movie.curated.1']);
});
test('Hub-Anfrage scheitert: alte Hub-Reihen bleiben, Rest erscheint, kein Gesamtfehler', function () {
  var cfg = [{ id: 'hub-1-movie.recentlyreleased', on: true }];
  var prev = { cfg: cfg, rows: [{ id: 'hub-1-movie.recentlyreleased', kind: 'poster', title: 'Alt', items: [{ rk: '1' }] }] };
  var s = netSetup(function (p) { return p === '/hubs/sections/1' ? 500 : 0; }), res = null, err = 'x';
  s.N.hubs.fetch(function (e, r) { err = e; res = r; }, prev);
  s.T.tick(20000);
  assert.strictEqual(err, null); assert.strictEqual(res.partial, true);
  eq(ids(res.rows), ['cw', 'deck', 'new-1', 'new-2', 'new-6', 'hub-1-movie.recentlyreleased']);
  assert.strictEqual(res.rows[5].title, 'Alt');
});
test('Nur Sektionen angefragt (Weiterschauen + Naechste Folgen aus) und die scheitern -> Fehler', function () {
  var s = netSetup(function (p) { return p === '/library/sections' ? 503 : 0; }), err = null;
  s.N.hubs.fetch(function (e) { err = e; }, { cfg: [{ id: 'cw', on: false }, { id: 'deck', on: false }] });
  s.T.tick(20000);
  assert.strictEqual(err.status, 503);
});

test('Seitenleiste anpassen (W1): umsortieren, ausblenden, Start immer an, neue Bibliothek an am Ende, Entdecken aus behaelt Stelle', function () {
  var RR = N.railRows, libs = [{ id: 1 }, { id: 2 }];
  var av = RR.avail(libs, true);
  var v = RR.view(null, av);
  eq(v.map(function (x) { return x.id; }), ['search', 'discover', 'home', 'lib-1', 'lib-2']);
  // Nutzer: Bibliothek 2 nach oben, Suche aus, Start "aus" (bleibt an)
  var vis = [{ id: 'lib-2', on: true }, { id: 'search', on: false }, { id: 'discover', on: true }, { id: 'home', on: false }, { id: 'lib-1', on: true }];
  var st = RR.store(null, av, vis);
  eq(RR.enabled(st, av), ['lib-2', 'discover', 'home', 'lib-1']);
  // Entdecken ausgeschaltet: faellt weg, Stelle bleibt gespeichert
  var av2 = RR.avail(libs, false);
  eq(RR.enabled(st, av2), ['lib-2', 'home', 'lib-1']);
  var st2 = RR.store(st, av2, RR.view(st, av2));
  eq(RR.enabled(st2, av), ['lib-2', 'discover', 'home', 'lib-1']);
  // neue Bibliothek: eingeschaltet am Ende
  eq(RR.enabled(st, RR.avail([{ id: 1 }, { id: 2 }, { id: 9 }], true)), ['lib-2', 'discover', 'home', 'lib-1', 'lib-9']);
  // kaputte/doppelte Eintraege werden ignoriert
  eq(RR.enabled([{ id: 'home', on: false }, null, { id: 'home', on: true }, { x: 1 }], RR.avail([], false)), ['home', 'search']);
});
