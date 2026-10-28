'use strict';
/* Player P1: Spur-Beschriftung (SPEC 7.11), Versionswahl (7.6/UX-S6), Kapitel, "Schaust du noch?" (7.10). Reine Logik, ohne Netz. */
var test = require('node:test'), assert = require('node:assert');
var H = require('./helpers/load'), S = H.synthetic, eq = H.eq;
var N = H.load({ fakeTimers: true }).N;
N.log = function () {};
function lang(l) { N.i18n.set(l); }

/* ---------- Spur-Beschriftung ---------- */
function part(streams) { return { Stream: streams }; }
test('Tonspur: Sprache aus languageCode in App-Sprache + Codec/Kanaele in Klartext (kein "French (Französisch EAC3 5.1)")', function () {
  lang('de');
  var st = N.tracks.streams(part([
    { id: 1, streamType: 2, codec: 'eac3', channels: 6, audioChannelLayout: '5.1(side)', languageCode: 'fre', language: 'French', extendedDisplayTitle: 'French (Französisch EAC3 5.1)' },
    { id: 2, streamType: 2, codec: 'aac', channels: 2, audioChannelLayout: 'stereo', languageCode: 'jpn', language: '日本語', 'default': true },
    { id: 3, streamType: 2, codec: 'ac3', channels: 6, languageCode: 'ger' },
    { id: 4, streamType: 2, codec: 'dca', profile: 'ma', channels: 8, languageCode: 'eng' },
    { id: 5, streamType: 2, codec: 'truehd', channels: 8, languageCode: 'eng', extendedDisplayTitle: 'English (TrueHD 7.1 Atmos)' },
    { id: 6, streamType: 2, codec: 'mp3', channels: 1, languageCode: 'ita' },
    { id: 7, streamType: 2, codec: 'flac', channels: 2, languageCode: 'deu', title: 'Audiodeskription', visualImpaired: true },
    { id: 8, streamType: 2, codec: 'opus', channels: 2, languageCode: 'xyz', language: 'Klingonisch' },
    { id: 9, streamType: 2, codec: 'aac', channels: 2 }
  ]));
  var L = st.audio.map(function (a) { return a.label; });
  eq(L, ['Französisch · Dolby Digital Plus 5.1', 'Japanisch · AAC Stereo', 'Deutsch · Dolby Digital 5.1', 'Englisch · DTS-HD MA 7.1',
    'Englisch · Dolby TrueHD Atmos 7.1', 'Italienisch · MP3 Mono', 'Deutsch · FLAC Stereo', 'Klingonisch · Opus Stereo', 'Unbekannte Sprache · AAC Stereo']);
  assert.strictEqual(N.tracks.subline(st.audio[1], false), 'Standard');
  assert.strictEqual(N.tracks.subline(st.audio[6], false), 'Hörfilm (Bildbeschreibung)');
  assert.strictEqual(st.audio[0].lang, 'fr');
  lang('en');
  assert.strictEqual(N.tracks.streams(part([{ id: 1, streamType: 2, codec: 'eac3', channels: 6, languageCode: 'fre' }])).audio[0].label, 'French · Dolby Digital Plus 5.1');
  lang('de');
});
test('Untertitel: nur fremdsprachige Stellen, gestaltet, fuer Hoergeschaedigte, Einbrennen, gleiche Namen unterscheidbar', function () {
  lang('de');
  var st = N.tracks.streams(part([
    { id: 1, streamType: 3, codec: 'srt', languageCode: 'ger', forced: true, title: 'German Forced' },
    { id: 2, streamType: 3, codec: 'ass', languageCode: 'deu' },
    { id: 3, streamType: 3, codec: 'srt', languageCode: 'eng', hearingImpaired: true, title: 'English SDH' },
    { id: 4, streamType: 3, codec: 'pgs', languageCode: 'eng', title: 'Signs' },
    { id: 5, streamType: 3, codec: 'pgs', languageCode: 'eng', title: 'Full' }
  ]));
  eq(st.subs.map(function (x) { return x.label; }), ['Deutsch · nur fremdsprachige Stellen', 'Deutsch · gestaltet', 'Englisch', 'Englisch', 'Englisch']);
  assert.strictEqual(N.tracks.subline(st.subs[2], false), 'für Hörgeschädigte · English SDH');
  assert.strictEqual(N.tracks.subline(st.subs[3], true), 'Signs · Ins Bild eingefügt – kurzer Neustart');
  assert.strictEqual(N.tracks.subline(st.subs[0], false), '', 'eindeutig: kein Titel');
});
test('Gemerkte Spuren mit alten Sprachcodes (fre) passen weiter', function () {
  var st = N.tracks.streams(part([{ id: 1, streamType: 2, codec: 'ac3', languageCode: 'ger', selected: true }, { id: 2, streamType: 2, codec: 'eac3', languageCode: 'fre' }]));
  var r = N.tracks.choose(st, { audioLang: 'de', subs: 'off', remember: true }, { a: 'fre', at: '' }, true);
  assert.strictEqual(r.a, 2);
});

/* ---------- Versionen ---------- */
function media(o) {
  return { videoResolution: o.res, width: o.w, height: o.h, videoCodec: o.vc, bitrate: o.br, duration: o.dur || 1440000,
    Part: [{ id: o.id || 1, size: o.size, Stream: [{ streamType: 1, codec: o.vc, bitDepth: o.depth || 8, level: o.level || 40 }] }] };
}
var UHD = media({ res: '4k', w: 3840, h: 2160, vc: 'hevc', br: 40000, size: 25e9, depth: 10 });
var FHD = media({ res: '1080', w: 1920, h: 1080, vc: 'h264', br: 9000, size: 4.24e9 });
var FHD_HI = media({ res: '1080', w: 1920, h: 1080, vc: 'h264', br: 30000, size: 20e9 });
var HD = media({ res: '720', w: 1280, h: 720, vc: 'h264', br: 4000, size: 850e6 });
test('Versionen: Klartext (Aufloesung · Codec · Groesse) + direkt/umgewandelt', function () {
  lang('de');
  var l = N.versions.list([UHD, FHD, HD]);
  eq(l.map(function (v) { return v.label; }), ['4K · HEVC 10 Bit · 25,0 GB', '1080p · H.264 · 4,2 GB', '720p · H.264 · 850 MB']);
  eq(l.map(function (v) { return v.sub; }), ['wird umgewandelt', 'direkt abspielbar', 'direkt abspielbar']);
  lang('en');
  assert.strictEqual(N.versions.list([UHD])[0].label, '4K · HEVC 10-bit · 25.0 GB');
  lang('de');
  var cut = N.versions.list([FHD, media({ res: '1080', w: 1920, h: 1080, vc: 'h264', br: 9000, size: 5e9, dur: 9000000 })]);
  assert.strictEqual(cut[1].sub, 'direkt abspielbar · 2 Std. 30 Min.', 'unterschiedlich lang -> Dauer');
});
test('Versionen: automatische Wahl nach SPEC 7.6 (1080p H.264 > 720p > HEVC; Bitrate <= Grenze)', function () {
  assert.strictEqual(N.versions.auto(N.versions.list([UHD, HD, FHD])), 2);
  assert.strictEqual(N.versions.auto(N.versions.list([UHD, HD])), 1);
  assert.strictEqual(N.versions.auto(N.versions.list([FHD_HI, FHD]), 12000), 1, 'ueber der Grenze -> kleinere');
  assert.strictEqual(N.versions.auto(N.versions.list([FHD, FHD_HI]), 0), 1, 'ohne Grenze -> hoechste');
  assert.strictEqual(N.versions.auto(N.versions.list([media({ res: '1080', w: 1920, h: 1080, vc: 'h264', br: 8000, depth: 10 }), UHD])), 0, '10-Bit-H.264 vor HEVC');
});
test('Versionen: Wahl je Titel gemerkt (Sitzung), ungueltige ignoriert, mediaIndex in Decision', function () {
  N.versions.reset();
  assert.strictEqual(N.versions.choose('42', [UHD, FHD], 12000), 1);
  N.versions.set('42', 0);
  assert.strictEqual(N.versions.choose('42', [UHD, FHD], 12000), 0);
  assert.strictEqual(N.versions.choose('42', [FHD], 12000), 0);
  N.versions.set('43', 5);
  assert.strictEqual(N.versions.choose('43', [UHD, FHD], 12000), 1, 'Index ausserhalb -> automatisch');
  var m = N.Playback.meta({ ratingKey: '42', type: 'movie', Media: [UHD, FHD] }, 1);
  assert.strictEqual(m.mi, 1); assert.strictEqual(m.versions.length, 2); assert.strictEqual(m.vcodec, 'h264');
  assert.strictEqual(N.Playback.meta({ ratingKey: '42', type: 'movie', Media: [FHD] }, 3).mi, 0);
  assert.strictEqual(N.decision.query({ rk: 42, mediaIndex: 1, session: 's' }).mediaIndex, 1);
  N.versions.reset();
});
test('Ablauf: automatisch/gemerkt gewaehlte Version geht als mediaIndex in die Decision', function () {
  function run() {
    var gets = [];
    var deps = { sef: { exec: function () { return 1; } }, base: 'http://pms', token: 'T', clientId: 'C', threshold: 0.9,
      timers: { now: Date.now, set: function () { return 0; }, clear: function () {} },
      cfg: { directPlay: true, quality: '12', ass: 'burn', audioLang: 'server', subs: 'server', subLang: 'de', rememberTracks: false },
      get: function (path, q, o, cb) { gets.push({ path: path, q: q }); cb(null, /decision/.test(path) ? S('decision-direct.json') : { MediaContainer: { Metadata: [{ ratingKey: '77', type: 'movie', Media: [UHD, FHD] }] } }); },
      write: function (m, p, q, cb) { cb(null, ''); } };
    var p = new N.Playback(deps, { rk: '77', off: 0 });
    p.start(); p.stop('user');
    return gets[1].q.mediaIndex;
  }
  N.versions.reset();
  assert.strictEqual(run(), 1, 'automatisch: 1080p H.264');
  N.versions.set('77', 0);
  assert.strictEqual(run(), 0, 'Nutzerwahl');
  N.versions.reset();
});

/* ---------- Kapitel ---------- */
test('Kapitel: sortiert, generische Namen -> "Kapitel n", Bild nur wenn vom Server, laufendes Kapitel', function () {
  lang('de');
  var chs = N.osd.chapters([
    { tag: 'Chapter 2', index: 2, startTimeOffset: 600000, endTimeOffset: 1200000, thumb: '/library/media/9/chapterImages/2' },
    { tag: 'Ankunft', index: 1, startTimeOffset: 0, endTimeOffset: 600000, thumb: '/library/media/9/chapterImages/1' },
    { index: 3, startTimeOffset: 1200000, endTimeOffset: 1800000 }]);
  eq(chs.map(function (c) { return c.start; }), [0, 600000, 1200000]);
  var L = N.osd.chapterList(chs, 700000, N.fmt.hms || function (ms) { return String(ms / 1000); });
  assert.strictEqual(L.cur, 1);
  eq(L.entries.map(function (e) { return e.t; }), ['Ankunft', 'Kapitel 2', 'Kapitel 3']);
  eq(L.entries.map(function (e) { return e.img; }), ['/library/media/9/chapterImages/1', '/library/media/9/chapterImages/2', '']);
  assert.ok(N.osd.chapterNamed({ t: 'Kapitel 12b' })); assert.ok(!N.osd.chapterNamed({ t: '12' }));
  assert.strictEqual(N.osd.chapterAt(chs, 0), 0); assert.strictEqual(N.osd.chapterAt([], 5), -1);
  assert.ok(/chapterImages%2F1/.test(N.img.url('/library/media/9/chapterImages/1', 'chapter')) && /width=96/.test(N.img.url('/x', 'chapter')));
});

/* ---------- "Schaust du noch?" + letzte Folge ---------- */
test('Schaust du noch?: zaehlt Folgen ohne Eingabe, Taste setzt zurueck, 0 = aus', function () {
  var s = new N.osd.Still(2, 1000);                      // Start per OK bei t = 900 (vor dem Start)
  assert.strictEqual(s.advance(900, 5000), false, 'nach Folge 1: weiter');
  assert.strictEqual(s.advance(900, 9000), true, 'nach Folge 2 ohne Taste: fragen');
  s.reset(9500);
  assert.strictEqual(s.advance(900, 13000), false);
  assert.strictEqual(s.advance(14000, 17000), false, 'Taste in Folge -> Zaehler neu');
  assert.strictEqual(s.advance(14000, 21000), true);
  var off = new N.osd.Still(0, 0);
  for (var i = 0; i < 10; i++) assert.strictEqual(off.advance(0, i + 1), false);
  var three = new N.osd.Still(3, 0);
  assert.deepStrictEqual([three.advance(0, 1), three.advance(0, 2), three.advance(0, 3)], [false, false, true]);
});
test('Letzte Folge: Karte statt Countdown ab finalem Abspann bzw. Dauer - N - 2 s; abbrechbar', function () {
  var cfg = { intro: 'button', credits: 'button', autoNext: true, cd: 10 };
  function run(markers, ctx, ts) { var m = new N.Markers(markers, cfg), o; ts.forEach(function (t) { o = m.tick(t, ctx); }); return { o: o, m: m }; }
  var fin = [{ type: 'credits', startTimeOffset: 1300000, endTimeOffset: 1440000, 'final': true }];
  var r = run(fin, { dur: 1440000, playing: true, hasNext: false, last: true, resume: 0 }, [1300000, 1301000, 1302000]);
  assert.strictEqual(r.o.last, true); assert.strictEqual(r.o.cd, -1); assert.strictEqual(r.o.next, false);
  r.m.cancelCountdown();
  assert.strictEqual(r.m.tick(1303000, { dur: 1440000, playing: true, hasNext: false, last: true }).last, false, 'Abspann ansehen -> Karte weg');
  r = run([], { dur: 1440000, playing: true, hasNext: false, last: true }, [1426000, 1427000, 1428000]);
  assert.strictEqual(r.o.last, true, 'ohne Marker: Dauer - 12 s');
  r = run([], { dur: 1440000, playing: true, hasNext: false, last: true }, [1425000, 1426000, 1427000]);
  assert.strictEqual(r.o.last, false, 'vorher nicht');
  r = run(fin, { dur: 1440000, playing: true, hasNext: true, last: false }, [1300000, 1301000, 1302000]);
  assert.ok(r.o.cd > 0 && !r.o.last, 'mit naechster Folge: Countdown');
});
test('Einstellung "Nachfragen, ob du noch schaust": Standard 3, Kinderprofil 2, eigene Wahl bleibt', function () {
  var files = {};
  N.store.get = function (f) { return files[f] || null; }; N.store.set = function (f, v) { files[f] = v; };
  N.session.state = { profiles: {}, server: { uri: 'http://192.0.2.1:32400' } };
  N.session.activate({ uuid: 'a', kind: 'main' }, 'T');
  assert.strictEqual(N.session.settings.stillWatching, 3);
  N.session.activate({ uuid: 'k', kind: 'kid' }, 'T');
  assert.strictEqual(N.session.settings.stillWatching, 2);
  files['settings-k.json'] = { stillWatching: 0 };
  N.session.activate({ uuid: 'k', kind: 'kid' }, 'T');
  assert.strictEqual(N.session.settings.stillWatching, 0);
});

test('Ton-/UT-Sprache ohne eigene Wahl folgen der Oberflaeche; gespeichert wird nur die eigene Wahl (F12)', function () {
  var files = {};
  N.store.get = function (f) { return files[f] || null; }; N.store.set = function (f, v) { files[f] = v; };
  N.session.state = { profiles: {}, server: { uri: 'http://192.0.2.1:32400' } };
  N.i18n.set('en');
  N.session.activate({ uuid: 'a', kind: 'main' }, 'T');
  assert.strictEqual(N.session.settings.audioLang, 'en'); assert.strictEqual(N.session.settings.subLang, 'en');
  N.session.setSetting('thumbs', false);
  assert.deepStrictEqual(Object.keys(files['settings-a.json']), ['thumbs']);
  N.i18n.set('de'); N.session.applyDefaults();
  assert.strictEqual(N.session.settings.audioLang, 'de'); assert.strictEqual(N.session.settings.thumbs, false);
  assert.strictEqual(N.session.settings.screensaver, 5);                  // P5-Standardwerte bleiben nach Sprachwechsel
  N.session.setSetting('audioLang', 'ja'); N.i18n.set('en'); N.session.applyDefaults();
  assert.strictEqual(N.session.settings.audioLang, 'ja'); assert.strictEqual(N.session.settings.subLang, 'en');
  N.i18n.set('de');
});

test('Feinauswahl: gespeicherte Darstellung "Feinleiste" (C, entfallen) wird zu A (Standard Panel), andere Wahl bleibt', function () {
  var files = { 'settings-a.json': { loupeStyle: 'bar', thumbs: false }, 'settings-b.json': { loupeStyle: 'film' } };
  N.store.get = function (f) { return files[f] || null; }; N.store.set = function (f, v) { files[f] = v; };
  N.session.state = { profiles: {}, server: { uri: 'http://192.0.2.1:32400' } };
  N.session.activate({ uuid: 'a', kind: 'main' }, 'T');
  assert.strictEqual(N.session.settings.loupeStyle, 'panel');
  assert.deepStrictEqual(files['settings-a.json'], { thumbs: false });    // dauerhaft entfernt -> folgt dem Standard
  N.session.activate({ uuid: 'b', kind: 'main' }, 'T');
  assert.strictEqual(N.session.settings.loupeStyle, 'film');
  N.session.activate({ uuid: 'c', kind: 'main' }, 'T');
  assert.strictEqual(N.session.settings.loupeStyle, 'panel');
});

test('HLS-Wartezeit vor InitPlayer: Standard 300 ms, per config.json einstellbar', function () {
  assert.strictEqual(N.config.hls.wait, 300);
  N.config.apply({ hlsWait: 1000 }); assert.strictEqual(N.config.hls.wait, 1000);
  N.config.apply({ hlsWait: 0 }); assert.strictEqual(N.config.hls.wait, 0);
  N.config.apply({ hlsWait: 300 });
});
