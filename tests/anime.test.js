'use strict';
/* Anime-Erkennung je Titel (N.anime, docs/TODO.md "Anime-Erkennung"): Signale aus Detaildaten, starke/schwache Merkmale, Fehlgriffe
 * (Animations-Koproduktion mit Japan; japanischer Realfilm: nur schwach), eigene Markierung, Cache, Kategorie ausblenden,
 * Wiedergaberegeln ohne japanische Spur, Versionswahl. Faelle nach den Server-Befunden 26.10. (read-only, Detail-Abfragen). */
var test = require('node:test'), assert = require('node:assert');
var H = require('./helpers/load'), eq = H.eq;
var N = H.load().N;
N.log = function () {};
N.i18n.set('de');
var A = N.anime, files = {};
N.store.init({ read: function (n) { return files[n] || null; }, write: function (n, v) { files[n] = v; } });
N.session.profile = { uuid: 'p1' };
function setts(o) { N.session.settings = { animeDetect: 'normal', animeShow: true, anime: true }; for (var k in o) N.session.settings[k] = o[k]; }
setts();

function tags(a) { return (a || []).map(function (t) { return { tag: t }; }); }
function audio(langs) { return [{ Part: [{ Stream: langs.map(function (l, i) { return { id: i + 1, streamType: 2, languageCode: l }; }) }] }]; }
function meta(o) { return { Genre: tags(o.g), Label: tags(o.l), Collection: tags(o.c), Country: tags(o.co), Media: o.a ? audio(o.a) : undefined }; }
var JPFILM = meta({ g: ['Familie', 'Anime', 'Animation', 'Fantasy'], co: ['Japan'], a: ['ger', 'jpn'] });
var JPSHOW = meta({ g: ['Liebesfilm', 'Komödie', 'Animation', 'Anime'], co: ['Japan'] });
var COPROD = meta({ g: ['Komödie', 'Animation', 'Adventure'], co: ['Japan', 'United States of America'], a: ['ger', 'eng'] });
var THRILLER = meta({ g: ['Horror', 'Thriller'], co: ['France', 'Japan', 'United States of America'], a: ['ger', 'eng'] });
var LIVE = meta({ g: ['Drama', 'Krimi'], co: ['Japan'], a: ['jpn', 'ger'] });          // japanische Realserie/-film
var JPANIM = meta({ g: ['Animation', 'Action'], co: ['Japan'] });                         // ohne Genre "Anime"
function cl(m, ctx) { var r = A.classify(A.signals(m), ctx); return [r.anime, r.strength, r.reason]; }

test('Starke Merkmale: Genre/Label/Sammlung/Bibliothek "Anime", Japan (einziges Land) + Animation', function () {
  eq(cl(JPFILM), [true, 'strong', 'genre']);
  eq(cl(JPSHOW), [true, 'strong', 'genre'], 'Serie ohne japanische Spur in den Serien-Metadaten');
  eq(cl(JPANIM), [true, 'strong', 'jpAnim']);
  eq(cl(meta({ l: ['anime'], co: ['Germany'] })), [true, 'strong', 'label']);
  eq(cl(meta({ c: ['Anime'] })), [true, 'strong', 'coll']);
  eq(cl(meta({ g: ['Drama'] }), { libAnime: true }), [true, 'strong', 'lib']);
  eq(cl(meta({ g: ['Animation'], co: ['Japan', 'United States of America'], a: ['jpn'] })), [true, 'strong', 'jpAnim'], 'Koproduktion mit japanischem Ton');
});

test('Fehlgriffe: Koproduktion mit Japan (Animation) und Thriller mit Japan als Mitproduzent sind in beiden Modi kein Anime', function () {
  ['normal', 'strict'].forEach(function (mode) {
    eq(cl(COPROD, { mode: mode }), [false, 'none', 'none']);
    eq(cl(THRILLER, { mode: mode }), [false, 'none', 'none']);
  });
});

test('Japanischer Realfilm mit japanischem Ton: nur schwach – bei "normal" Anime, bei "streng" nicht; "aus" = nie', function () {
  eq(cl(LIVE, { mode: 'normal' }), [true, 'weak', 'jpAudio']);
  eq(cl(LIVE, { mode: 'strict' }), [false, 'weak', 'jpAudioStrict']);
  eq(cl(JPFILM, { mode: 'strict' }), [true, 'strong', 'genre']);
  eq(cl(JPFILM, { mode: 'off' }), [false, 'none', 'off']);
  eq(cl(meta({ g: ['Drama'], co: ['Japan'] }), { ja: true }), [true, 'weak', 'jpAudio'], 'Spur aus der laufenden Datei');
});

test('Eigene Markierung je Profil ueberstimmt alle Merkmale (nicht aber Erkennung "aus"); "automatisch" hebt sie auf', function () {
  setts();
  var coprod = { type: 'movie', rk: '501' }, jpfilm = { type: 'movie', rk: '502' };
  A.learn('501', COPROD); A.learn('502', JPFILM);
  assert.strictEqual(A.is(coprod), false); assert.strictEqual(A.is(jpfilm), true);
  A.setOverride(coprod, true); A.setOverride(jpfilm, false);
  eq([A.of(coprod).anime, A.of(coprod).reason], [true, 'manual']);
  eq([A.of(jpfilm).anime, A.of(jpfilm).reason], [false, 'manualNo']);
  N.session.profile = { uuid: 'p2' };
  assert.strictEqual(A.is(coprod), false, 'anderes Profil: eigene Markierungen');
  N.session.profile = { uuid: 'p1' };
  setts({ animeDetect: 'off' });
  assert.strictEqual(A.is(coprod), false, 'Erkennung aus: alles aus');
  setts();
  eq(A.menuButtons(jpfilm).map(function (b) { return b.id; }), ['animeOn', 'animeAuto']);
  A.setOverride(jpfilm, null);
  assert.strictEqual(A.is(jpfilm), true);
  eq(A.menuButtons(jpfilm).map(function (b) { return b.id; }), ['animeOff']);
  A.setOverride(coprod, null);
  // Folge und Staffel gelten als ihre Serie
  A.learn('600', JPSHOW);
  assert.strictEqual(A.is({ type: 'episode', rk: '611', showRk: '600' }), true);
  A.setOverride({ type: 'season', rk: '610', showRk: '600' }, false);
  assert.strictEqual(A.is({ type: 'episode', rk: '612', showRk: '600' }), false);
  A.setOverride({ type: 'show', rk: '600' }, null);
});

test('Cache: eine Detail-Anfrage je Serie (Folgen teilen sie, gleichzeitige Aufrufe warten mit), LRU begrenzt', function () {
  setts(); A.clear();
  var calls = [], pend = [], old = N.plex.get;
  N.plex.get = function (path, q, o, cb) { calls.push(path); pend.push(function () { cb(null, { MediaContainer: { Metadata: [JPSHOW] } }); }); };
  var done = 0;
  A.ensure({ type: 'episode', rk: '1', showRk: '700' }, function () { done++; });
  A.ensure({ type: 'episode', rk: '2', showRk: '700' }, function () { done++; });
  eq(calls, ['/library/metadata/700']);
  pend.forEach(function (f) { f(); });
  assert.strictEqual(done, 2);
  A.ensure({ type: 'show', rk: '700' }, function () { done++; });
  assert.strictEqual(done, 3); assert.strictEqual(calls.length, 1, 'aus dem Cache');
  assert.strictEqual(A.is({ type: 'episode', rk: '3', showRk: '700' }), true);
  A.ensure({ type: 'track', rk: '9' }, function () { done++; });
  assert.strictEqual(calls.length, 1, 'Musik: keine Anfrage');
  for (var i = 0; i < 160; i++) A.learn('x' + i, JPANIM);
  assert.ok(!A.cached({ type: 'movie', rk: 'x0' }), 'aeltester Eintrag verdraengt');
  assert.ok(A.cached({ type: 'movie', rk: 'x159' }));
  N.plex.get = old;
});

test('Kategorie ausblenden: Ueberzeile nur Film/Serie, kein INFO-Grund – Wiedergaberegeln bleiben; Erkennung "aus" schaltet beides ab', function () {
  setts(); A.clear();
  var show = { type: 'show', rk: '800', kind: 'show' }, movie = { type: 'movie', rk: '801' }, coprod = { type: 'movie', rk: '802' };
  A.learn('800', JPSHOW); A.learn('801', JPFILM); A.learn('802', COPROD);
  assert.strictEqual(N.model.overline(show), 'SERIE · ANIME');
  assert.strictEqual(N.model.overline(movie), 'FILM · ANIME');
  assert.strictEqual(N.model.overline(coprod), 'FILM');
  assert.strictEqual(A.infoLine(show), 'Anime: Genre „Anime“');
  setts({ animeShow: false });
  assert.strictEqual(N.model.overline(show), 'SERIE');
  assert.strictEqual(N.model.overline(movie), 'FILM');
  assert.strictEqual(A.infoLine(show), '');
  assert.strictEqual(A.is(show), true); assert.strictEqual(A.rulesOn(), true, 'Wiedergaberegeln unabhaengig');
  assert.ok(A.menuOn(show), 'Markierung bleibt fuer die Wiedergaberegeln erreichbar');
  setts({ animeShow: false, anime: false });
  assert.ok(!A.menuOn(show), 'Kategorie und Regeln aus: kein Anime-Eintrag im Menue');
  setts({ animeDetect: 'off' });
  assert.strictEqual(A.rulesOn(), false); assert.strictEqual(A.showCat(), false);
  assert.strictEqual(N.model.overline(show), 'SERIE');
  setts();
});

test('Anime ohne japanische Spur (nur deutsche Synchronfassung): erkannt, normale Tonwahl, keine Anime-Untertitel, INFO-Hinweis', function () {
  setts(); A.clear();
  var dub = meta({ g: ['Anime', 'Animation'], co: ['Japan'], a: ['ger'] }), it = { type: 'movie', rk: '900' };
  A.learn('900', dub);
  assert.strictEqual(A.is(it), true, 'Genre "Anime" reicht');
  assert.strictEqual(A.infoLine(it), 'Anime: Genre „Anime“\nAnime – keine japanische Tonspur vorhanden');
  var T = N.tracks.streams({ Stream: [{ id: 1, streamType: 2, codec: 'aac', languageCode: 'ger', 'default': true, selected: true },
    { id: 2, streamType: 3, codec: 'srt', languageCode: 'ger' }, { id: 3, streamType: 3, codec: 'srt', languageCode: 'eng' }] });
  var r = N.tracks.choose(T, { audioLang: 'de', subs: 'forced', subLang: 'de', anime: true, animeAudio: 'ja', animeSubs: 'deen', remember: false }, null, false);
  assert.notStrictEqual(r.why, 'anime');
  assert.ok(r.s !== 2 && r.s !== 3, 'keine Untertitel wegen der Anime-Regel (normaler Modus "nur noetige")');
  r = N.tracks.choose(T, { audioLang: 'de', subs: 'always', subLang: 'de', anime: true, animeAudio: 'ja', remember: false }, null, false);
  assert.strictEqual(r.s, 2, 'normale UT-Einstellung gilt weiter');
});

test('Mehrere Versionen: mit Anime-Wiedergaberegeln die Version mit japanischer Spur, sonst die normale Wahl', function () {
  function ver(h, langs) {
    var st = [{ streamType: 1, bitDepth: 8 }].concat(langs.map(function (l) { return { streamType: 2, languageCode: l }; }));
    return { videoCodec: 'h264', videoResolution: String(h), height: h, width: h === 1080 ? 1920 : 1280, bitrate: 5000, Part: [{ size: 1e9, Stream: st }] };
  }
  N.versions.reset();
  var media = [ver(1080, ['ger']), ver(720, ['ger', 'jpn'])];
  assert.strictEqual(N.versions.choose('v1', media, 12000), 0);
  assert.strictEqual(N.versions.choose('v1', media, 12000, true), 1);
  assert.strictEqual(N.versions.anyJa(media), true);
  var none = [ver(1080, ['ger']), ver(720, ['eng'])];
  assert.strictEqual(N.versions.choose('v2', none, 12000, true), 0, 'keine japanische Spur: normale Wahl');
  N.versions.set('v1', 0);
  assert.strictEqual(N.versions.choose('v1', media, 12000, true), 0, 'eigene Wahl bleibt');
  N.versions.reset();
});
