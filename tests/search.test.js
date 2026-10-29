'use strict';
/* M3b Suche: Tastatur-Layout/-Navigation, T9 (900 ms), Ergebnisgruppen aus /hubs/search, Zuletzt gesucht. */
var test = require('node:test'), assert = require('node:assert');
var H = require('./helpers/load');
var N = H.load().N, S = N.srch;
N.i18n.set('de');
var disk = {}; N.store.init({ read: function (n) { return disk[n] === undefined ? null : disk[n]; }, write: function (n, t) { disk[n] = t; } });

test('Tastatur: 6 Spalten ab x 144/y 152, Schritt 60, breite Tasten 172, 123/abc', function () {
  var r = S.layout('abc');
  assert.strictEqual(r.length, 7);
  assert.strictEqual(r[0].map(function (k) { return k.k; }).join(''), 'abcdef');
  assert.strictEqual(r[4].map(function (k) { return k.k; }).join(''), 'yzäöüß');
  H.eq([r[1][2].x, r[1][2].y], [264, 212]);
  H.eq(r[5].map(function (k) { return [k.act, k.x, k.y, k.w]; }), [['space', 144, 452, 172], ['del', 324, 452, 172]]);
  H.eq([r[6][0].act, r[6][0].y], ['mode', 512]);
  var n = S.layout('num');
  assert.strictEqual(n.length, 5);
  assert.strictEqual(n[1].map(function (k) { return k.k; }).join(''), "7890-'");
  H.eq([n[3][0].y, n[4][0].y], [332, 392]);
});
test('Tastatur je Sprache: Englisch ohne Umlaut-Reihe auf abc, Umlaute auf 123 (F15)', function () {
  var r = S.layout('abc', 'en');
  assert.strictEqual(r.length, 7);
  assert.strictEqual(r[4].map(function (k) { return k.k; }).join(''), 'yz');
  var p = S.move(r, { r: 3, c: 4 }, 'DOWN'); H.eq([p.r, p.c], [4, 1]);    // w -> z (letzte Taste der kurzen Reihe)
  var n = S.layout('num', 'en');
  assert.strictEqual(n.length, 6);
  assert.strictEqual(n[3].map(function (k) { return k.k; }).join(''), 'äöüß');
  assert.strictEqual(S.layout('abc', 'de')[4].map(function (k) { return k.k; }).join(''), 'yzäöüß');
  assert.strictEqual(S.layout('num', 'de').length, 5);
});
test('Tastatur-Navigation: kein Wrap, Spalte ueber breite Tasten gemerkt, Rand rechts -> Ergebnisse', function () {
  var r = S.layout('abc'), p = { r: 4, c: 4 };
  assert.strictEqual(S.move(r, { r: 0, c: 0 }, 'LEFT'), null);
  assert.strictEqual(S.move(r, { r: 0, c: 0 }, 'UP'), null);
  p = S.move(r, p, 'DOWN'); H.eq([p.r, p.c], [5, 1]);          // ü -> Löschen
  p = S.move(r, p, 'DOWN'); H.eq([p.r, p.c], [6, 0]);          // -> 123
  p = S.move(r, p, 'UP'); p = S.move(r, p, 'UP'); H.eq([p.r, p.c], [4, 4]);   // zurueck zu ü (Spalte gemerkt)
  p = S.move(r, { r: 4, c: 1 }, 'DOWN'); H.eq([p.r, p.c], [5, 0]);           // z -> Leerzeichen
  assert.ok(S.atRight(r, { r: 2, c: 5 }));
  assert.ok(S.atRight(r, { r: 5, c: 1 }));
  assert.ok(!S.atRight(r, { r: 5, c: 0 }));
  H.eq(S.hitKey(r, 270, 220), { r: 1, c: 2, col: 2 });
  assert.strictEqual(S.hitKey(r, 258, 220), null);              // Luecke
  assert.strictEqual(S.hitKey(r, 400, 470).c, 1);
});
test('T9: Mehrfachdruck < 900 ms wechselt, andere Ziffer bzw. Pause uebernimmt, Umlaute, 0 = Leerzeichen', function () {
  var t = new S.T9(), r;
  r = t.press('3', 1000); assert.strictEqual(r.cand, 'd'); assert.strictEqual(r.commit, '');
  r = t.press('3', 1500); assert.strictEqual(r.cand, 'e');
  r = t.press('3', 2000); assert.strictEqual(r.cand, 'f'); assert.strictEqual(r.idx, 2); assert.strictEqual(r.letters, 'def');
  r = t.press('3', 2500); assert.strictEqual(r.cand, 'd');     // rundum
  r = t.press('2', 2600); assert.strictEqual(r.commit, 'd'); assert.strictEqual(r.cand, 'a');
  r = t.press('2', 3600); assert.strictEqual(r.commit, 'a'); assert.strictEqual(r.cand, 'a');   // Pause > 900 ms: neuer Buchstabe
  t.press('2', 3700); t.press('2', 3800); r = t.press('2', 3900); assert.strictEqual(r.cand, 'ä');
  assert.strictEqual(t.flush(), 'ä'); assert.ok(!t.active());
  r = t.press('0', 5000); assert.strictEqual(r.cand, ' ');
  r = t.press('7', 5100); assert.strictEqual(r.commit, ' ');
  for (var i = 0; i < 4; i++) r = t.press('7', 5200 + i * 100);
  assert.strictEqual(r.cand, 'ß');
  assert.strictEqual(S.query(' a '), '');
  assert.strictEqual(S.query(' ab '), 'ab');
});
test('Ergebnisse: feste Gruppen-Reihenfolge, Musik ausgeblendet, Personen dedupliziert (Filter-ID)', function () {
  var json = { MediaContainer: { Hub: [
    { hubIdentifier: 'track', type: 'track', Metadata: [{ ratingKey: '1', type: 'track', title: 'Fast Car' }] },
    { hubIdentifier: 'movie', type: 'movie', Metadata: [{ ratingKey: '10', type: 'movie', title: 'Fast Five', year: 2011 }, { ratingKey: '11', type: 'movie', title: 'Fast 6' }] },
    { hubIdentifier: 'show', type: 'show', Metadata: [{ ratingKey: '20', type: 'show', title: 'Supernatural', year: 2005 }] },
    { hubIdentifier: 'episode', type: 'episode', size: 0 },
    { hubIdentifier: 'actor', type: 'actor', Directory: [{ type: 'tag', id: 12974, tag: 'Alexia Fast', librarySectionID: 1, thumb: '/p' }, { type: 'tag', id: 12974, tag: 'Alexia Fast', librarySectionID: 2 }] },
    { hubIdentifier: 'director', type: 'director', Directory: [{ type: 'tag', id: 77, tag: 'Paul King', librarySectionID: 1 }] },
    { hubIdentifier: 'collection', type: 'collection', Metadata: [{ ratingKey: '30', type: 'collection', title: 'Fast & Furious' }] }] } };
  var g = S.group(json, {});
  H.eq(g.map(function (x) { return [x.id, x.kind, x.items.length]; }), [['shows', 'posterQ', 1], ['movies', 'posterQ', 2], ['people', 'castS', 2], ['collections', 'posterQ', 1]]);
  var p = g[2].items;
  H.eq([p[0].type, p[0].id, p[0].title, p[0].lib, p[0].filter], ['person', 12974, 'Alexia Fast', 1, 'actor']);
  assert.strictEqual(p[1].filter, 'director');
  H.eq(S.caption(g[1].items[0]), ['Fast Five', 'Film · 2011']);
  H.eq(S.caption(g[0].items[0]), ['Supernatural', 'Serie · 2005']);
  H.eq(S.caption(p[1]), ['Paul King', 'Regie']);
  H.eq(S.group({ MediaContainer: { size: 0 } }, {}), []);
});
test('Zuletzt gesucht: neueste zuerst, ohne Doppelte (Gross/Klein), max. 8; Vorschlaege aus dem Home-Cache', function () {
  var l = [];
  ['nordlicht', 'langer weg', 'Nordlicht', 'a', 'b', 'c', 'd', 'e', 'f', 'g'].forEach(function (q) { l = S.addRecent(l, q); });
  H.eq(l, ['g', 'f', 'e', 'd', 'c', 'b', 'a', 'Nordlicht']);
  H.eq(S.addRecent(l, '   '), JSON.parse(JSON.stringify(l)));
  var cache = { rows: [{ kind: 'land', items: [{ rk: '1' }] }, { kind: 'poster', items: [{ rk: '2' }, { rk: '3' }] }] };
  H.eq(S.suggestions(cache).map(function (x) { return x.rk; }), ['2', '3']);
  H.eq(S.suggestions(null), []);
});

/* Nutzer-Feedback 28.10. ("Zuletzt gesucht nimmt viel Platz"): Einstellung Aus/4/8 (bis 28.10. abends Aus/3/6), einzelne Begriffe entfernen, Chips in 2 Zeilen */
test('Zuletzt gesucht: Grenze aus der Einstellung (Standard 8), Aus merkt nichts und loescht, 4 kuerzt', function () {
  N.session.profile = { uuid: 'rs1' }; N.session.settings = {};
  S.clearRecent('search'); S.clearRecent('disc');
  assert.strictEqual(S.limit(), 8);
  ['a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7', 'h8', 'i9'].forEach(function (q) { S.remember(q); });
  H.eq(S.recent(), ['i9', 'h8', 'g7', 'f6', 'e5', 'd4', 'c3', 'b2']);
  S.remember('x9', 'disc');
  N.session.settings.recentSearches = 4; S.applyLimit();
  H.eq(S.recent(), ['i9', 'h8', 'g7', 'f6']);
  N.session.settings.recentSearches = 8;
  H.eq(S.recent(), ['i9', 'h8', 'g7', 'f6']);           // gekuerzt bleibt gekuerzt
  S.remember('j0'); H.eq(S.recent(), ['j0', 'i9', 'h8', 'g7', 'f6']);
  N.session.settings.recentSearches = 0; S.applyLimit();
  assert.strictEqual(S.limit(), 0);
  H.eq(S.recent(), []); H.eq(S.recent('disc'), []);
  assert.strictEqual(N.store.get(S.file('search')), null);
  S.remember('neu'); H.eq(S.recent(), []);              // Aus: nichts wird gemerkt
  N.session.settings.recentSearches = 'quatsch'; assert.strictEqual(S.limit(), 8);
  N.session.settings.recentSearches = null; assert.strictEqual(S.limit(), 8, 'null gespeichert: Standard, nicht Aus');
  N.session.settings.recentSearches = ''; assert.strictEqual(S.limit(), 8, 'leer gespeichert: Standard, nicht Aus');
  N.session.settings.recentSearches = '0'; assert.strictEqual(S.limit(), 0);
  N.session.settings.recentSearches = 3; assert.strictEqual(S.limit(), 4);   // fruehere Stufen: 3 -> 4, 6 -> 8
  N.session.settings.recentSearches = 6; assert.strictEqual(S.limit(), 8);
  H.eq(S.addRecent(['a'], 'b', 0), []);
});
test('Zuletzt gesucht: Einstellung wirkt ueber settings:changed (setSetting)', function () {
  N.session.profile = { uuid: 'rs3' }; N.session.settings = {}; N.session.own = {};
  ['a', 'b', 'c', 'd', 'e', 'f'].forEach(function (q) { S.remember(q); });
  N.session.setSetting('recentSearches', 4);
  H.eq(N.store.get(S.file('search')).q, ['f', 'e', 'd', 'c']);
  N.session.setSetting('recentSearches', 0);
  assert.strictEqual(N.store.get(S.file('search')), null);
});
test('Zuletzt gesucht: einzelnen Begriff entfernen (Gross/Klein egal), andere Liste bleibt', function () {
  N.session.profile = { uuid: 'rs2' }; N.session.settings = { recentSearches: 8 };
  ['Nordlicht', 'Langer Weg', 'Echo'].forEach(function (q) { S.remember(q); });
  S.remember('Nordlicht', 'disc');
  S.forget('nordlicht');
  H.eq(S.recent(), ['Echo', 'Langer Weg']);
  H.eq(S.recent('disc'), ['Nordlicht']);
  H.eq(S.without(['a', 'B', 'c'], 'b'), ['a', 'c']);
  S.clearRecent('search'); H.eq(S.recent(), []); H.eq(S.recent('disc'), ['Nordlicht']);
});
test('Zuletzt gesucht: Chips in hoechstens 2 Zeilen, "Verlauf loeschen" immer zuletzt, aelteste fallen weg', function () {
  // 6 kurze Begriffe + Loeschen-Chip (150) passen in 2 Zeilen zu 656 px (Abstand 12)
  var p = S.pack([100, 120, 90, 140, 110, 100], 150, 656, 12, 2);
  assert.strictEqual(p.n, 6); assert.strictEqual(p.lines, 2); assert.strictEqual(p.pos.length, 7);
  H.eq(p.pos.slice(0, 6).map(function (x) { return [x.x, x.l]; }), [[0, 0], [112, 0], [244, 0], [346, 0], [498, 0], [0, 1]]);
  H.eq([p.pos[6].x, p.pos[6].l], [112, 1]);
  // lange Begriffe (300 = Hoechstbreite): nur so viele, wie mit dem Loeschen-Chip in 2 Zeilen passen
  p = S.pack([300, 300, 300, 300, 300, 300], 150, 656, 12, 2);
  assert.strictEqual(p.n, 3); assert.strictEqual(p.lines, 2);
  H.eq(p.pos.map(function (x) { return x.l; }), [0, 0, 1, 1]);
  // 3 Begriffe: eine Zeile
  p = S.pack([100, 120, 90], 150, 656, 12, 2);
  H.eq([p.n, p.lines], [3, 1]);
  // keiner
  p = S.pack([], 150, 656, 12, 2); H.eq([p.n, p.lines, p.pos.length], [0, 1, 1]);
});
test('Zuletzt gesucht: fruehere Stufen 6/3 werden 8/4, Aus bleibt Aus (N.comfort.applyDefaults)', function () {
  H.eq(N.comfort.applyDefaults({ recentSearches: 6 }).recentSearches, 8);
  H.eq(N.comfort.applyDefaults({ recentSearches: null }).recentSearches, 8);
  H.eq(N.comfort.applyDefaults({ recentSearches: 0 }).recentSearches, 0);
  H.eq(N.comfort.applyDefaults({ recentSearches: 3 }).recentSearches, 4);
  H.eq(N.comfort.applyDefaults({ recentSearches: 0 }).recentSearches, 0);
  H.eq(N.comfort.applyDefaults({ recentSearches: 4 }).recentSearches, 4);
  H.eq(N.comfort.applyDefaults({}).recentSearches, 8);
});
test('Zuletzt gesucht: 8 normal lange Begriffe fuellen genau 2 Zeilen, lange verdraengen die aeltesten', function () {
  // ~ "Nordlicht", "Krimi" …: 8 Begriffe 70..130 px + "Verlauf loeschen" (160) in 2 Zeilen zu 656 px
  var p = S.pack([120, 80, 110, 130, 100, 90, 120, 110], 160, 656, 12, 2);
  H.eq([p.n, p.lines], [8, 2]);
  assert.strictEqual(p.pos[8].l, 1);                  // "Verlauf loeschen" zuletzt, Zeile 2
  p = S.pack([300, 120, 300, 80, 110, 130, 100, 90], 160, 656, 12, 2);
  assert.ok(p.n < 8 && p.n >= 3); assert.strictEqual(p.lines, 2);
});
test('Zuletzt gesucht: Pfeiltasten zwischen den Chips und Zeiger-Treffer in Seitenkoordinaten', function () {
  var p = S.pack([100, 120, 90, 140, 110, 100], 150, 656, 12, 2).pos;   // Zeile 0: 0..4, Zeile 1: 5, 6 (Loeschen)
  assert.strictEqual(S.chipMove(p, 0, 'LEFT'), -1);   // -> Tastatur
  assert.strictEqual(S.chipMove(p, 1, 'LEFT'), 0);
  assert.strictEqual(S.chipMove(p, 4, 'RIGHT'), -1);  // Zeilenende
  assert.strictEqual(S.chipMove(p, 5, 'LEFT'), -1);   // Zeilenanfang Zeile 2 -> Tastatur
  assert.strictEqual(S.chipMove(p, 5, 'RIGHT'), 6);
  assert.strictEqual(S.chipMove(p, 2, 'DOWN'), 6);    // Mitte 289 -> naechster Chip unten: Loeschen (112..262, Mitte 187)
  assert.strictEqual(S.chipMove(p, 0, 'DOWN'), 5);
  assert.strictEqual(S.chipMove(p, 6, 'DOWN'), -1);   // -> Vorschlaege
  assert.strictEqual(S.chipMove(p, 6, 'UP'), 1);      // Mitte 187 -> Chip 1 (112..232, Mitte 172)
  assert.strictEqual(S.chipMove(p, 0, 'UP'), -1);
  assert.strictEqual(S.chipLineStart(p, 1), 5);
  assert.strictEqual(S.hitChip(p, 120, 52 + 10, 52, 44, 32), 1);
  assert.strictEqual(S.hitChip(p, 120, 52 + 44 + 10, 52, 44, 32), 6);
  assert.strictEqual(S.hitChip(p, 105, 60, 52, 44, 32), -1);   // Luecke zwischen zwei Chips
  assert.strictEqual(S.hitChip(p, 120, 52 + 36, 52, 44, 32), -1);   // Luecke zwischen den Zeilen
});
