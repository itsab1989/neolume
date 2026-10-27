'use strict';
/* P5 Einstellungen & Komfort: Bildschirmschoner-Logik, Spoilerschutz, Zurueckspulen, Anime-Regeln, UT-Modus "bei fremdem Ton",
 * "Schaust du noch?" nach Zeit, "Geringere Qualitaet?", Passthrough/Ton-Verstaerkung in der Decision, Offline-Erkennung,
 * Verbindung testen, Untertitel-Suche (ohne Schreibzugriff), neutrale Genre-Reihe. Reine Logik, ohne Netz. */
var test = require('node:test'), assert = require('node:assert');
var H = require('./helpers/load'), eq = H.eq;
var ctx = H.load({ fakeTimers: true }), N = ctx.N;
N.log = function () {};
N.i18n.set('de');
var C = N.comfort, MIN = 60000;

/* ---------- Bildschirmschoner (SPEC 7.14) ---------- */
test('Schoner: nach der Einstellung, nie waehrend ein Video laeuft, in der Pause fruehestens nach 10 Min., Aus = nie', function () {
  assert.strictEqual(C.saverDue(4 * MIN, 5, {}), false);
  assert.strictEqual(C.saverDue(5 * MIN, 5, {}), true);
  assert.strictEqual(C.saverDue(60 * MIN, 0, {}), false);
  assert.strictEqual(C.saverDue(60 * MIN, 5, { playing: true }), false);
  assert.strictEqual(C.saverDue(9 * MIN, 5, { paused: true }), false);
  assert.strictEqual(C.saverDue(10 * MIN, 5, { paused: true }), true);
  assert.strictEqual(C.saverDue(29 * MIN, 30, { paused: true }), false);
  eq(C.SAVER_MIN, [0, 5, 10, 15, 30]);
});
test('Schoner: Insel springt reihum durch 4 Ecken; naechstes Bild nie dasselbe', function () {
  var seen = {};
  for (var i = 0; i < 8; i++) seen[C.corner(i).join(',')] = 1;
  assert.strictEqual(Object.keys(seen).length, 4);
  eq(C.corner(4), [64, 56]); eq(C.corner(-1), [64, 568]); eq(C.corner(0), [64, 56]);
  for (var r = 0; r < 1; r += 0.1) assert.notStrictEqual(C.nextIndex(5, 2, r), 2);
  assert.strictEqual(C.nextIndex(1, 0, 0.5), 0);
});
test('Schoner: Bilder aus dem Home-Cache – Weiterschauen + Neu zuerst, je Bild einmal, sonst andere Reihen', function () {
  var cache = { v: 1, rows: [
    { id: 'hub-1-movie.genre', items: [{ title: 'X', art: '/a/x' }] },
    { id: 'cw', items: [{ title: 'Wolkenreiter', type: 'episode', s: 1, e: 5, art: '/a/w' }, { title: 'Doppelt', art: '/a/w' }] },
    { id: 'new-2', items: [{ title: 'Neu', art: '/a/n' }, { title: 'Ohne Bild', art: '' }] }] };
  var it = C.saverItems(cache);
  eq(it.map(function (x) { return x.title; }), ['Wolkenreiter', 'Neu']);
  assert.strictEqual(it[0].sub, 'S1 · F5');
  eq(C.saverItems({ rows: [{ id: 'hub-1-x', items: [{ title: 'Nur Hub', art: '/a/h' }] }] }).length, 1);
  eq(C.saverItems(null), []);
});
test('Schoner: Pausen-Text "Pausiert · Serie S1 · F5" (DE/EN)', function () {
  assert.strictEqual(C.pausedText({ type: 'episode', title: 'Nordlicht', s: 1, e: 5 }), 'Pausiert · Nordlicht S1 · F5');
  assert.strictEqual(C.pausedText({ type: 'movie', title: 'Bergfilm' }), 'Pausiert · Bergfilm');
  N.i18n.set('en');
  assert.strictEqual(C.pausedText({ type: 'episode', title: 'Nordlicht', s: 1, e: 5 }), 'Paused · Nordlicht S1 · E5');
  N.i18n.set('de');
  assert.strictEqual(C.clock(new Date(2026, 9, 26, 21, 4), '12:00'), '12:00');
});

/* ---------- Standardwerte ---------- */
test('Standardwerte: fehlende P5-Einstellungen werden ergaenzt, gespeicherte bleiben; Kinderprofil fragt nach 1 Std.', function () {
  var st = C.applyDefaults({ screensaver: 0, clock: false }, false);
  assert.strictEqual(st.screensaver, 0); assert.strictEqual(st.clock, false);
  assert.strictEqual(st.spoiler, false); assert.strictEqual(st.passthrough, true); assert.strictEqual(st.stillTime, 2);
  assert.strictEqual(C.applyDefaults({}, true).stillTime, 1);
  assert.strictEqual(C.applyDefaults({ stillTime: 3 }, true).stillTime, 3);
});

/* ---------- Spoilerschutz + Hintergrundbilder ---------- */
test('Spoilerschutz: Vorschaubild ungesehener Folgen unscharf (blur=30), gesehene/angefangene/Filme nicht; Beschreibung ausgeblendet', function () {
  N.plex.setServer('http://192.0.2.10:32400', 'T');
  N.session.settings = { spoiler: false };
  var ep = N.model.norm({ ratingKey: '1', type: 'episode', title: 'Folge', grandparentTitle: 'Serie', grandparentThumb: '/library/metadata/9/thumb/1', thumb: '/library/metadata/1/thumb/9', summary: 'Der Held stirbt.' });
  var seen = N.model.norm({ ratingKey: '2', type: 'episode', viewCount: 1, thumb: '/library/metadata/2/thumb/9', summary: 'x' });
  var half = N.model.norm({ ratingKey: '3', type: 'episode', viewOffset: 60000, duration: 1200000, thumb: '/library/metadata/3/thumb/9' });
  assert.ok(N.img.url(ep.still, 'land').indexOf('blur=') < 0, 'aus: scharf');
  assert.strictEqual(C.summary(ep), 'Der Held stirbt.');
  N.session.settings.spoiler = true;
  assert.ok(N.img.url(ep.still, 'land').indexOf('blur=30') > 0, 'an: unscharf');
  assert.ok(N.img.url(seen.still, 'land').indexOf('blur=') < 0);
  assert.ok(N.img.url(half.still, 'land').indexOf('blur=') < 0);
  assert.ok(N.img.url(ep.thumb, 'poster').indexOf('blur=') < 0, 'Serienposter bleibt scharf');
  assert.strictEqual(C.summary(ep), 'Beschreibung ausgeblendet (Spoilerschutz).');
  assert.strictEqual(C.summary(seen), 'x');
  N.model.norm({ ratingKey: '1', type: 'episode', viewCount: 1, thumb: '/library/metadata/1/thumb/9' });   // inzwischen gesehen
  assert.ok(N.img.url(ep.still, 'land').indexOf('blur=') < 0);
  assert.strictEqual(C.backgrounds(), true);
  N.session.settings.backgrounds = false;
  assert.strictEqual(C.backgrounds(), false);
  N.session.settings = null;
});

/* ---------- Zurueckspulen beim Fortsetzen ---------- */
test('Zurueckspulen: Fortsetzen-Stelle minus Einstellung (nie unter 0), nach Pause > 1 Min.', function () {
  assert.strictEqual(C.rewind(600000, 10), 590000);
  assert.strictEqual(C.rewind(4000, 10), 0);
  assert.strictEqual(C.rewind(600000, 0), 600000);
  assert.strictEqual(C.rewind(0, 10), 0);
  assert.strictEqual(C.pauseRewind(30000, 10), 0);
  assert.strictEqual(C.pauseRewind(61000, 10), 10000);
  assert.strictEqual(C.pauseRewind(600000, 0), 0);
});

/* ---------- Spurregeln: Anime-Feinheiten + "bei fremdem Ton" ---------- */
function st(audio, subs) {
  var list = [], id = 1;
  audio.forEach(function (a) { list.push({ id: id++, streamType: 2, codec: 'aac', languageCode: a[0], title: a[1] || '', 'default': !!a[2], selected: !!a[2] }); });
  subs.forEach(function (s) { list.push({ id: id++, streamType: 3, codec: 'srt', languageCode: s[0], title: s[1] || '', forced: !!s[2] }); });
  return N.tracks.streams({ Stream: list });
}
var BASE = { audioLang: 'de', subs: 'forced', subLang: 'de', remember: false };
function cfg(o) { var c = JSON.parse(JSON.stringify(BASE)); for (var k in o) c[k] = o[k]; return c; }
test('Anime: Japanisch + DE sonst EN (wie bisher), "nur DE", "aus"; ohne passende UT keine Regel', function () {
  var t = st([['ger'], ['jpn']], [['eng'], ['ger', 'Signs & Songs', true], ['ger']]);
  var r = N.tracks.choose(t, cfg({ anime: true }), null, true);
  eq([r.a, r.s, r.why], [2, 5, 'anime']);
  r = N.tracks.choose(st([['ger'], ['jpn']], [['eng']]), cfg({ anime: true, animeSubs: 'deen' }), null, true);
  eq([r.a, r.s], [2, 3]);
  r = N.tracks.choose(st([['ger'], ['jpn']], [['eng']]), cfg({ anime: true, animeSubs: 'de' }), null, true);
  assert.notStrictEqual(r.why, 'anime', 'nur DE, aber keine DE-Spur: normale Wahl');
  r = N.tracks.choose(st([['ger'], ['jpn']], [['eng']]), cfg({ anime: true, animeSubs: 'off' }), null, true);
  eq([r.a, r.s, r.why], [2, null, 'anime']);
});
test('Anime: deutscher Ton mit Schilder-Untertiteln (Signs & Songs), sonst Einstellung; "Wie oben" = bevorzugte Tonsprache', function () {
  var t = st([['jpn', '', true], ['ger']], [['ger'], ['ger', 'Signs & Songs'], ['eng']]);
  var r = N.tracks.choose(t, cfg({ anime: true, animeAudio: 'de', animeSigns: true }), null, true);
  eq([r.a, r.s, r.why], [2, 4, 'anime']);
  r = N.tracks.choose(t, cfg({ anime: true, animeAudio: 'de', animeSigns: false, subs: 'off' }), null, true);
  eq([r.a, r.s], [2, null]);
  r = N.tracks.choose(t, cfg({ anime: true, animeAudio: 'same', audioLang: 'de' }), null, true);
  assert.strictEqual(r.a, 2);
  r = N.tracks.choose(t, cfg({ anime: false }), null, true);
  assert.notStrictEqual(r.why, 'anime');
});
test('UT-Modus "bei fremdem Ton": Ton nicht in der UT-Sprache -> volle UT; gleiche Sprache -> nur noetige Stellen', function () {
  var c = cfg({ subs: 'foreign', audioLang: 'server' });
  var t = st([['fre', '', true]], [['ger', 'Forced', true], ['ger'], ['eng']]);
  assert.strictEqual(N.tracks.choose(t, c, null, false).s, 3);
  t = st([['ger', '', true]], [['ger', 'Forced', true], ['ger']]);
  assert.strictEqual(N.tracks.choose(t, c, null, false).s, 2);
  t = st([['ger', '', true]], [['ger']]);
  assert.strictEqual(N.tracks.choose(t, c, null, false).s, null, 'keine Forced-Spur: aus (war schon aus)');
  t = st([['jpn', '', true]], [['eng']]);
  assert.strictEqual(N.tracks.choose(t, cfg({ subs: 'foreign', audioLang: 'server', subLang: 'en' }), null, false).s, 2);
});
test('Anime-Einordnung wird in der Wiedergabe beachtet (deps.isAnime)', function () {
  var meta = N.Playback.meta({ ratingKey: '9', type: 'episode', librarySectionID: 2, Media: [{ Part: [{ id: 1, Stream: [
    { id: 11, streamType: 2, codec: 'aac', languageCode: 'ger', 'default': true }, { id: 12, streamType: 2, codec: 'aac', languageCode: 'jpn' },
    { id: 13, streamType: 3, codec: 'srt', languageCode: 'ger' }] }] }] });
  var calls = [];
  function pb(lib) {
    var p = new N.Playback({ sef: { exec: function () { return 1; } }, cfg: { anime: true, audioLang: 'de', subs: 'forced', subLang: 'de', rememberTracks: false },
      timers: { now: function () { return 0; }, set: function () { return 0; }, clear: function () {} }, isAnime: function (m) { return m.lib === lib; },
      get: function () {}, write: function (m, path, q, cb) { calls.push(q); cb(); } }, { rk: '9' });
    p.meta = JSON.parse(JSON.stringify(meta)); p.meta.tracks = N.tracks.streams(meta.part);
    return p;
  }
  calls = []; pb(2).autoTracks(function () {});
  assert.strictEqual(calls[0].audioStreamID, 12);
  calls = []; pb(5).autoTracks(function () {});
  assert.ok(!calls.length || calls[0].audioStreamID !== 12, 'kein Anime: keine Anime-Regel');
});

/* ---------- "Schaust du noch?" nach Zeit ---------- */
test('Schaust du noch?: nach Folgen ODER nach Zeit ohne Eingabe; Eingabe setzt die Zeit zurueck', function () {
  var H2 = 3600000, s = new N.osd.Still(0, 0, 2);
  assert.strictEqual(s.advance(0, H2 - 1), false);
  assert.strictEqual(s.advance(0, 2 * H2), true); assert.strictEqual(s.why, 'time');
  s = new N.osd.Still(0, 0, 2);
  assert.strictEqual(s.advance(H2 + 10, 2 * H2 + 5), false, 'Taste nach 1 Std.: Uhr neu');
  s = new N.osd.Still(3, 0, 0);
  s.advance(0, 1); s.advance(0, 2);
  assert.strictEqual(s.advance(0, 3), true); assert.strictEqual(s.why, 'eps');
  s.reset(10); assert.strictEqual(s.advance(0, 11), false);
});

/* ---------- Geringere Qualitaet? ---------- */
test('Geringere Qualitaet?: 2 Nachlade-Pausen in 60 s oder 20 s Laden, je Video einmal', function () {
  var b = new C.BufWatch(0);
  assert.strictEqual(b.stall(1000), false);
  assert.strictEqual(b.stall(70000), false, 'erste ist aelter als 60 s');
  assert.strictEqual(b.stall(90000), true);
  assert.strictEqual(b.stall(91000), false, 'nur einmal');
  b = new C.BufWatch(0);
  assert.strictEqual(b.loading(19000), false);
  assert.strictEqual(b.loading(20000), true);
  assert.strictEqual(b.stall(1), false);
});
test('Geringere Qualitaet?: Nachladen bis 5 s nach Sprung/Start/Fortsetzen zaehlt nicht (F23)', function () {
  var b = new C.BufWatch(0);
  b.mark(10000); assert.strictEqual(b.stall(12000), false);            // Sprung +10 s im Direct Play
  b.mark(20000); assert.strictEqual(b.stall(23000), false);            // noch ein Sprung
  assert.strictEqual(b.stall(30000), false);                           // erstes echtes Nachladen
  assert.strictEqual(b.stall(40000), true);                            // zweites in 60 s -> anbieten
});

/* ---------- Decision: Passthrough + Ton-Verstaerkung ---------- */
test('Decision: Passthrough aus = Kanal-Grenze 2 (videoAudioCodec), Ton-Verstaerkung nur dann', function () {
  var o = { rk: '1', session: 's', clientId: 'c', token: 't', dp: true, ds: true };
  var q = N.decision.query(o);
  assert.strictEqual(q.audioBoost, 100);
  assert.ok(q['X-Plex-Client-Profile-Extra'].indexOf('audio.channels') < 0);
  o.stereo = true; o.boost = 200;
  q = N.decision.query(o);
  assert.strictEqual(q.audioBoost, 200);
  assert.ok(/add-limitation\(scope=videoAudioCodec&scopeName=\*&type=upperBound&name=audio\.channels&value=2/.test(q['X-Plex-Client-Profile-Extra']));
});

/* ---------- Offline-Erkennung ---------- */
test('Offline: 2 Netzfehler am PMS -> offline, Ping alle 10 s, jede Server-Antwort -> online; fremde Adressen zaehlen nicht', function () {
  var T = H.FakeTimers(), evs = [], pings = 0, answer = { type: 'network', status: 0 };
  N.net._reset({ set: T.setTimeout, clear: T.clearTimeout, now: T.now });
  N.plex.setServer('http://192.0.2.10:32400', 'T');
  var get = N.plex.get;
  N.plex.get = function (p, q, o, cb) { pings++; var a = answer; T.setTimeout(function () { N.net.observe(N.plex.base + p, a); cb(a); }, 5); return { abort: function () {} }; };
  var on = function () { evs.push('off'); }, onb = function () { evs.push('on'); };
  N.evt.on('net:offline', on); N.evt.on('net:online', onb);
  N.net.observe('http://192.0.2.99/x', { type: 'network' });
  N.net.observe('http://192.0.2.99/x', { type: 'network' });
  assert.strictEqual(N.net.offline, false);
  N.net.observe(N.plex.base + '/a', { type: 'timeout' });
  N.net.observe(N.plex.base + '/b', null);
  N.net.observe(N.plex.base + '/c', { type: 'network' });
  assert.strictEqual(N.net.offline, false, 'Erfolg dazwischen setzt zurueck');
  N.net.observe(N.plex.base + '/d', { type: 'network' });
  assert.strictEqual(N.net.offline, true); eq(evs, ['off']);
  assert.strictEqual(N.net.secondsLeft(), 10);
  T.tick(10010); assert.strictEqual(pings, 1); assert.strictEqual(N.net.offline, true);
  answer = { type: 'http', status: 503 };
  T.tick(10010); assert.strictEqual(pings, 2); assert.strictEqual(N.net.offline, false); eq(evs, ['off', 'on']);
  N.net.observe(N.plex.base + '/e', { type: 'aborted' });
  assert.strictEqual(N.net.fails, 0);
  N.evt.off('net:offline', on); N.evt.off('net:online', onb);
  N.plex.get = get;
});

/* ---------- Verbindung testen ---------- */
test('Verbindung testen: Zusammenfassung in Klartext (erreicht/Median/Version/Zugang/Direktwiedergabe) bzw. nicht erreichbar', function () {
  assert.strictEqual(N.connTest.median([30, 10, 500]), 30);
  var L = N.connTest.summary({ name: 'Wohnzimmer', reach: true, ms: [12, 40, 15], version: '1.43.5.11029-6bf8af3f0', auth: 'ok', directPlay: true, passthrough: false });
  assert.strictEqual(L[0], 'Server „Wohnzimmer“ erreicht – Antwortzeit 15\u00a0ms.');
  assert.strictEqual(L[1], 'Sehr schnelle Verbindung.');
  assert.strictEqual(L[2], 'Plex Media Server 1.43.5.11029');
  assert.strictEqual(L[3], 'Zugang für dieses Profil: in Ordnung.');
  assert.strictEqual(L[L.length - 1], 'Direkte Wiedergabe: an · Mehrkanal-Ton: Stereo');
  L = N.connTest.summary({ name: 'Wohnzimmer', reach: false });
  assert.strictEqual(L[0], 'Dein Server „Wohnzimmer“ antwortet nicht.');
  assert.strictEqual(N.connTest.summary({ name: 'x', reach: true, ms: [400] })[1].indexOf('langsam') > 0, true);
});

/* ---------- Untertitel-Suche ---------- */
test('Untertitel-Suche: Anfrage, Treffer nach Bewertung, Unterzeile; Herunterladen nur nach Bestaetigung', function () {
  eq(N.subSearch.query('en', false, false), { language: 'en', hearingImpaired: 0, forced: 0 });
  var res = N.subSearch.parse({ MediaContainer: { Stream: [
    { id: 1, key: '/library/streams/1', codec: 'srt', languageCode: 'deu', providerTitle: 'OpenSubtitles', score: '91', title: 'Film.2001.German.WEB' },
    { id: 2, key: '/library/streams/2', codec: 'srt', languageCode: 'deu', providerTitle: 'OpenSubtitles', score: '2357', title: 'Film.2001.DVD' },
    { id: 3, codec: 'srt', languageCode: 'deu', score: '9999' },
    { id: 4, key: '/library/streams/4', codec: 'srt', languageCode: 'deu', forced: true, providerTitle: 'OpenSubtitles', score: '580', title: 'Film_forced' }] } });
  eq(res.map(function (r) { return r.key; }), ['/library/streams/2', '/library/streams/4', '/library/streams/1']);
  assert.strictEqual(res[0].lang, 'de');
  assert.strictEqual(N.subSearch.subline(res[1]), 'OpenSubtitles · nur fremdsprachige Stellen · Bewertung 580');
  var w = N.plex.write, wrote = [];
  N.plex.write = function (m, p, q, cb) { wrote.push([m, p, q]); cb(null); };
  var err = null;
  N.subSearch.download('77', '/library/streams/2', false, function (e) { err = e; });
  assert.strictEqual(err.type, 'unconfirmed'); assert.strictEqual(wrote.length, 0, 'ohne Bestaetigung kein Schreibzugriff');
  N.subSearch.download('77', '/library/streams/2', true, function () {});
  eq(wrote, [['PUT', '/library/metadata/77/subtitles', { key: '/library/streams/2' }]]);
  N.plex.write = w;
});

/* ---------- Genre-Reihe ---------- */
test('Genre-Zusatzreihe: stabiler Schluessel ohne Genre-ID, neutraler Name in DE/EN', function () {
  var a = N.homeRows.hubType({ hubIdentifier: 'movie.genre.1.143', context: 'hub.movie.genre' }, 1);
  var b = N.homeRows.hubType({ hubIdentifier: 'movie.genre.1.17', context: 'hub.movie.genre' }, 1);
  eq(a, JSON.parse(JSON.stringify(b))); assert.strictEqual(a.type, 'movie.genre');
  eq(N.homeRows.hubType({ hubIdentifier: 'movie.genre.1.5' }, 1).type, 'movie.genre');
  var hubs = N.homeRows.hubsOf({ MediaContainer: { Hub: [{ hubIdentifier: 'movie.genre.1.143', context: 'hub.movie.genre', title: 'Top-Filme in Action', type: 'movie' }] } }, 1);
  assert.strictEqual(hubs[0].id, 'hub-1-movie.genre');
  assert.strictEqual(N.t('set.hr.name.movie.genre'), 'Top-Filme eines Genres (wechselt)');
  N.i18n.set('en'); assert.strictEqual(N.t('set.hr.name.movie.genre'), 'Top movies of a genre (changes)'); N.i18n.set('de');
});
