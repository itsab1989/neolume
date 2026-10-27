'use strict';
/* M3b Suche: Tastatur-Layout/-Navigation, T9 (900 ms), Ergebnisgruppen aus /hubs/search, Zuletzt gesucht. */
var test = require('node:test'), assert = require('node:assert');
var H = require('./helpers/load');
var N = H.load().N, S = N.srch;
N.i18n.set('de');

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
test('Zuletzt gesucht: neueste zuerst, ohne Doppelte (Gross/Klein), max. 6; Vorschlaege aus dem Home-Cache', function () {
  var l = [];
  ['nordlicht', 'langer weg', 'Nordlicht', 'a', 'b', 'c', 'd', 'e'].forEach(function (q) { l = S.addRecent(l, q); });
  H.eq(l, ['e', 'd', 'c', 'b', 'a', 'Nordlicht']);
  H.eq(S.addRecent(l, '   '), JSON.parse(JSON.stringify(l)));
  var cache = { rows: [{ kind: 'land', items: [{ rk: '1' }] }, { kind: 'poster', items: [{ rk: '2' }, { rk: '3' }] }] };
  H.eq(S.suggestions(cache).map(function (x) { return x.rk; }), ['2', '3']);
  H.eq(S.suggestions(null), []);
});
