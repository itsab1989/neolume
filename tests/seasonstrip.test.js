'use strict';
var test = require('node:test'), assert = require('node:assert');
var H = require('./helpers/load');
var N = H.load().N, SS = N.SeasonStrip;
function eps(n, fn) { var a = []; for (var i = 1; i <= n; i++) a.push(fn(i)); return a; }

test('Modus A (<= 30 Folgen): eine Zelle je Folge, Zustaende, Fuellhoehe, Marker', function () {
  var list = eps(28, function (i) { return { index: i, vc: i <= 11 ? 1 : 0, off: i === 12 ? 60 : 0, dur: 100 }; });
  var l = SS.layout({ enabled: true, size: 'L', episodes: list.slice().reverse(), next: 12 });
  assert.strictEqual(l.mode, 'cells');
  assert.strictEqual(l.cells.length, 28);
  assert.strictEqual(l.cells[0].x, 0); assert.strictEqual(l.cells[1].x, 16);         // L: Schritt 16
  assert.strictEqual(l.cells[10].state, 'w');
  assert.strictEqual(l.cells[11].state, 'p');
  assert.strictEqual(l.cells[11].fill, Math.round(18 * 0.6));
  assert.strictEqual(l.cells[12].state, 'u');
  H.eq(l.marker, { x: 176, w: 12, y: 21, h: 3 });                                    // 3 px unter der Zelle
  assert.strictEqual(l.width, 28 * 16 - 4);
  assert.ok(l.width <= 476);
});

test('Gesehen-Schwelle 90 % und Mindest-Fuellung 2 px', function () {
  var l = SS.layout({ enabled: true, size: 'S', episodes: [{ index: 1, vc: 0, off: 95, dur: 100 }, { index: 2, vc: 0, off: 1, dur: 100 }] });
  assert.strictEqual(l.cells[0].state, 'w');
  assert.strictEqual(l.cells[1].fill, 2);
});

test('Genau 30 Folgen = Zellen, 31 = Balken', function () {
  assert.strictEqual(SS.layout({ enabled: true, episodes: eps(30, function (i) { return { index: i, vc: 0, off: 0, dur: 1 }; }) }).mode, 'cells');
  assert.strictEqual(SS.layout({ enabled: true, episodes: eps(31, function (i) { return { index: i, vc: 0, off: 0, dur: 1 }; }), total: 31, viewed: 3, next: 4 }).mode, 'bar');
});

test('Modus B (> 30 Folgen): Balken aus leafCount/viewedLeafCount + Text', function () {
  N.i18n.set('de');
  var l = SS.layout({ enabled: true, size: 'L', episodes: null, total: 1100, viewed: 511, next: 512 });
  assert.strictEqual(l.mode, 'bar');
  assert.strictEqual(l.width, 320);
  assert.strictEqual(l.fill, Math.round(320 * 511 / 1100));
  assert.strictEqual(l.text, 'Folge 512 von 1100');
  assert.strictEqual(l.marker.w, 2); assert.strictEqual(l.marker.h, 12);
  assert.strictEqual(SS.layout({ enabled: true, total: 1100, viewed: 1100 }).text, 'Alle 1100 Folgen gesehen');
  assert.strictEqual(SS.layout({ enabled: true, size: 'S', total: 1100, viewed: 5, next: 6 }).text, '');   // S: ohne Text
  N.i18n.set('en');
  assert.strictEqual(SS.layout({ enabled: true, total: 40, viewed: 2, next: 3 }).text, 'Episode 3 of 40');
  N.i18n.set('de');
});

test('Einstellung aus -> kein Streifen (Layout der anderen Elemente bleibt)', function () {
  assert.strictEqual(SS.layout({ enabled: false, episodes: [{ index: 1, vc: 1 }] }).mode, 'none');
  assert.strictEqual(SS.layout({ enabled: true, episodes: [], total: 0 }).mode, 'none');
});

test('Serien-Balken: Segmente proportional, >= 4 px, Luecke 3 px, Specials ausgeschlossen, gewaehlte Staffel', function () {
  var seasons = [{ index: 0, leaf: 5, vleaf: 0 }, { index: 1, leaf: 100, vleaf: 100 }, { index: 2, leaf: 1, vleaf: 0 }, { index: 3, leaf: 50, vleaf: 25 }];
  var b = SS.seriesBar(seasons, 3);
  assert.strictEqual(b.mode, 'segments');
  assert.strictEqual(b.segments.length, 3);
  var total = 0; b.segments.forEach(function (s) { total += s.w; assert.ok(s.w >= 4); });
  assert.strictEqual(total + 2 * 3, 336);                                    // so breit wie der Staffel-Balken M
  assert.strictEqual(SS.SIZES.M.barW, 336);
  assert.strictEqual(b.segments[1].w, 4);                                    // winzige Staffel auf 4 px
  assert.strictEqual(b.segments[0].fill, b.segments[0].w);                  // ganz gesehen
  assert.ok(b.segments[2].sel && !b.segments[0].sel);
  assert.strictEqual(b.segments[1].x, b.segments[0].w + 3);
  assert.strictEqual(b.watched, 125); assert.strictEqual(b.total, 151);    // fuer die Beschriftung, ohne Specials
});

test('Serien-Balken: nur eine regulaere Staffel (Specials zaehlen nicht) -> keiner', function () {
  assert.strictEqual(SS.seriesBar([{ index: 1, leaf: 10, vleaf: 2 }], 1).mode, 'none');
  assert.strictEqual(SS.seriesBar([{ index: 0, leaf: 3, vleaf: 0 }, { index: 1, leaf: 10, vleaf: 2 }], 1).mode, 'none');
  assert.strictEqual(SS.seriesBar([], 1).mode, 'none');
});

test('Serien-Beschriftung: ungesehene Folgen der ganzen Serie, alles gesehen, DE/EN', function () {
  N.i18n.set('de');
  var b = SS.seriesBar([{ index: 1, leaf: 10, vleaf: 10 }, { index: 2, leaf: 12, vleaf: 2 }], 2);
  assert.strictEqual(SS.seriesText(b), 'Serie: 10 von 22 ungesehen');
  assert.strictEqual(SS.seriesText(SS.seriesBar([{ index: 1, leaf: 10, vleaf: 10 }, { index: 2, leaf: 12, vleaf: 12 }], 2)), 'Serie: alle 22 gesehen');
  assert.strictEqual(SS.seriesText({ mode: 'none' }), '');
  N.i18n.set('en');
  assert.strictEqual(SS.seriesText(b), 'Series: 10 of 22 unwatched');
  N.i18n.set('de');
});

test('Serien-Balken: > 40 Staffeln -> einfacher Balken', function () {
  var many = []; for (var i = 1; i <= 41; i++) many.push({ index: i, leaf: 10, vleaf: i <= 20 ? 10 : 0 });
  var b = SS.seriesBar(many, 1);
  assert.strictEqual(b.mode, 'single');
  assert.strictEqual(b.fill, Math.round(336 * 200 / 410));
  assert.strictEqual(b.watched, 200); assert.strictEqual(b.total, 410);
});

test('Einstellung "Serien-Fortschritt": Standard an, unabhaengig; wer "Folgen-Fortschritt" aus hatte, behaelt den Balken aus', function () {
  var files = {}, g = N.store.get, st = N.store.set;
  N.store.get = function (f) { return files[f] || null; }; N.store.set = function (f, v) { files[f] = v; };
  N.session.state = { profiles: {}, server: { uri: 'http://192.0.2.1:32400' } };
  N.session.activate({ uuid: 'a', kind: 'main' }, 'T');
  assert.strictEqual(N.session.settings.seriesProgress, true);
  assert.strictEqual(N.session.settings.episodeProgress, true);
  files['settings-b.json'] = { episodeProgress: false };                       // alt: ein Schalter fuer beides
  N.session.activate({ uuid: 'b', kind: 'main' }, 'T');
  assert.strictEqual(N.session.settings.seriesProgress, false);
  assert.ok(!('seriesProgress' in files['settings-b.json']), 'nur abgeleitet, nichts geschrieben');
  N.session.setSetting('seriesProgress', true);                                // danach gilt die eigene Wahl
  N.session.activate({ uuid: 'b', kind: 'main' }, 'T');
  assert.strictEqual(N.session.settings.seriesProgress, true);
  assert.strictEqual(N.session.settings.episodeProgress, false);
  N.store.get = g; N.store.set = st;
});
