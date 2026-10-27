'use strict';
/* Player-Logik (M3): Decision/Profil, Rueckfall, Spurregeln, Marker/Countdown, Sammel-Sprung, BIF, SRT, Ablaufsteuerung.
 * Keine echten Sitzungen: SEF, Netz und Zeit sind Faelschungen. */
var test = require('node:test'), assert = require('node:assert');
var H = require('./helpers/load'), S = H.synthetic, eq = H.eq;
var ctx = H.load({ fakeTimers: true }), N = ctx.N, T = ctx.timers;
N.log = function () {};

function qsParse(url) {
  var q = {}, s = url.split('?')[1].split('|')[0];
  s.split('&').forEach(function (p) { var kv = p.split('='); q[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]); });
  return q;
}

/* ---------- Decision ---------- */
test('Decision-Parameter: Profil-Ergaenzung, kein hasMDE, kein Bitratenlimit in der ersten Decision', function () {
  var q = N.decision.query({ rk: '90546', session: 's1', clientId: 'c1', token: 'TOK', dp: true, ds: true, quality: '12' });
  assert.strictEqual(q.path, '/library/metadata/90546');
  assert.strictEqual(q.directPlay, 1); assert.strictEqual(q.directStream, 1);
  assert.strictEqual(q.hasMDE, undefined, 'hasMDE=1 schaltet die Profilpruefung ab (K8)');
  assert.strictEqual(q.maxVideoBitrate, undefined, 'K2: kein Limit in der ersten Decision');
  assert.strictEqual(q['X-Plex-Platform'], 'Samsung');
  assert.strictEqual(q.session, 's1'); assert.strictEqual(q['X-Plex-Session-Identifier'], 's1');
  var ex = q['X-Plex-Client-Profile-Extra'].split('+');
  assert.ok(ex.indexOf('add-limitation(scope=videoCodec&scopeName=hevc&type=upperBound&name=video.width&value=0&isRequired=false)') >= 0);
  assert.ok(ex.indexOf('add-limitation(scope=videoCodec&scopeName=h264&type=upperBound&name=video.bitDepth&value=8&isRequired=false)') >= 0);
  assert.ok(ex.indexOf('add-limitation(scope=videoCodec&scopeName=h264&type=upperBound&name=video.level&value=41&isRequired=false)') >= 0);
  assert.ok(ex.indexOf('add-settings(DirectPlayStreamSelection=true)') >= 0);
  var url = N.decision.decisionUrl('http://pms', { rk: 1, session: 's', clientId: 'c', token: 't', dp: true, ds: true });
  assert.ok(/X-Plex-Client-Profile-Extra=add-limitation\(scope%3DvideoCodec%26/.test(url), 'Extra URL-kodiert');
});

test('Umwandlung: Bitratengrenze + Aufloesung nur bei transcode, HLS-Suffix', function () {
  var o = { rk: 5, session: 's', clientId: 'c', token: 't', dp: false, ds: true, transcode: true, quality: '8' };
  var u = N.decision.startUrl('http://pms', o);
  assert.ok(/\|COMPONENT=HLS$/.test(u));
  var q = qsParse(u);
  assert.strictEqual(q.maxVideoBitrate, '8000'); assert.strictEqual(q.videoResolution, '1280x720'); assert.strictEqual(q.directPlay, '0');
  o.transcode = false;
  assert.strictEqual(qsParse(N.decision.startUrl('http://pms', o)).maxVideoBitrate, undefined, 'Direct Stream ohne Limit');
  assert.strictEqual(N.decision.directUrl('http://pms', '/library/parts/1/2/file.mkv', 'T', 'C'), 'http://pms/library/parts/1/2/file.mkv?X-Plex-Token=T&X-Plex-Client-Identifier=C');
});

test('Decision-Antworten (PMS 1.43.5): direct, HEVC -> transcode, TrueHD -> direct stream', function () {
  var d = N.decision.parse(S('decision-direct.json'));
  assert.strictEqual(d.mode, 'direct'); assert.strictEqual(d.partKey, '/library/parts/25307/1461260780/file.mkv');
  assert.strictEqual(N.decision.modeKey(d), 'pl.mode.direct');
  var h = N.decision.parse(S('decision-hevc.json'));
  assert.strictEqual(h.mode, 'transcode'); assert.strictEqual(h.code, 1001); assert.strictEqual(N.decision.modeKey(h), 'pl.mode.hevc');
  var t = N.decision.parse(S('decision-truehd.json'));
  assert.strictEqual(t.mode, 'stream'); assert.strictEqual(t.audio, 'transcode'); assert.strictEqual(N.decision.modeKey(t), 'pl.mode.audio');
  assert.strictEqual(N.decision.parse({ MediaContainer: { generalDecisionCode: 2000 } }).mode, 'error');
  assert.strictEqual(N.decision.parse(null).mode, 'error');
});

test('Rueckfall-Kette: direct -> direct stream -> transcode -> Ende; Fehlerarten', function () {
  eq(N.decision.fallback({ dp: true, ds: true }, 'direct'), { dp: false, ds: true });
  eq(N.decision.fallback({ dp: false, ds: true }, 'stream'), { dp: false, ds: false });
  assert.strictEqual(N.decision.fallback({ dp: false, ds: false }, 'transcode'), null);
  assert.strictEqual(N.decision.errKind({ type: 'http', status: 401 }), 'notAllowed');
  assert.strictEqual(N.decision.errKind({ type: 'timeout', status: 0 }), 'server');
  assert.strictEqual(N.decision.errKind({ type: 'http', status: 404 }), 'fileMissing');
  assert.strictEqual(N.decision.errKind(null, { code: 1001 }), 'playback');
});

/* ---------- Spuren ---------- */
function anime() { return N.Playback.meta(S('meta-anime.json').MediaContainer.Metadata[0]); }
var CFG = { audioLang: 'de', subs: 'forced', subLang: 'de', anime: false, remember: true };
test('Spuren: Anime-Regel waehlt JPN-Ton + DE-Untertitel (voll, nicht forced)', function () {
  var m = anime(), c = JSON.parse(JSON.stringify(CFG)); c.anime = true;
  var r = N.tracks.choose(m.tracks, c, null, true);
  assert.strictEqual(r.a, 72301); assert.strictEqual(r.s, 72303); assert.strictEqual(r.why, 'anime');
  assert.strictEqual(N.tracks.choose(m.tracks, c, null, false).why, 'anime', 'Anime je Titel: auch Filme');
});
test('Spuren: Nur noetige -> Forced-Spur in Tonsprache; Immer -> volle DE; Aus -> aus', function () {
  var m = anime();
  eq(N.tracks.choose(m.tracks, CFG, null, true), { a: null, s: 72302, why: 'prefs' });
  var c = JSON.parse(JSON.stringify(CFG)); c.subs = 'always';
  assert.strictEqual(N.tracks.choose(m.tracks, c, null, true).s, 72303);
  c.subs = 'off'; assert.strictEqual(N.tracks.choose(m.tracks, c, null, true).s, null, 'nichts gewaehlt -> keine Aenderung');
  c.audioLang = 'ja'; c.subs = 'server';
  assert.strictEqual(N.tracks.choose(m.tracks, c, null, true).a, 72301);
});
test('Spuren: SDH/Hoerfilm nie automatisch; Merken je Serie gewinnt und ist auf 200 begrenzt', function () {
  var m = N.Playback.meta(S('meta-hevc.json').MediaContainer.Metadata[0]), c = JSON.parse(JSON.stringify(CFG));
  c.subs = 'always'; c.subLang = 'en';
  assert.strictEqual(N.tracks.choose(m.tracks, c, null, true).s, 95398, 'EN nur als SDH vorhanden -> DE statt SDH');
  var mem = N.tracks.remember({}, 'show1', m.tracks.audio[1], 0, 5);
  eq(mem.show1, { a: 'en', at: '', off: 1, t: 5 });
  var r = N.tracks.choose(m.tracks, c, mem.show1, true);
  assert.strictEqual(r.a, 95396); assert.strictEqual(r.why, 'remember');
  var big = {}; for (var i = 0; i < 205; i++) big['s' + i] = { t: i };
  big = N.tracks.remember(big, 'neu', null, m.tracks.subs[1], 1000);
  assert.strictEqual(Object.keys(big).length, 200); assert.ok(!big.s0 && big.neu && big.s204);
});
test('Untertitel-Darstellung: Bild-UT/ASS einbrennen, eingebettet SEF, extern eigene Box, Umwandlung brennt ein', function () {
  var TR = N.tracks;
  assert.strictEqual(TR.subMode(null, 'burn', false), 'none');
  assert.strictEqual(TR.subMode({ codec: 'pgs' }, 'text', false), 'burn');
  assert.strictEqual(TR.subMode({ codec: 'ass' }, 'burn', false), 'burn');
  assert.strictEqual(TR.subMode({ codec: 'ass' }, 'text', false), 'sef');
  assert.strictEqual(TR.subMode({ codec: 'srt' }, 'burn', true), 'burn');
  assert.strictEqual(TR.subMode({ codec: 'srt', key: '/library/streams/9' }, 'burn', true), 'sidecar');
});

/* ---------- Marker / Countdown ---------- */
function run(mk, from, to, ctx2) { var out = null; for (var t = from; t <= to; t += 1000) out = mk.tick(t, ctx2); return out; }
var MK = [{ type: 'intro', startTimeOffset: 1361, endTimeOffset: 87121 }, { type: 'credits', startTimeOffset: 1349374, endTimeOffset: 1411374 }];
test('Marker: Button erst nach 2 fortlaufenden Ticks, max. 15 s, Sprungziel = Markerende', function () {
  var mk = new N.Markers(MK, { intro: 'button', credits: 'button', autoNext: false, cd: 10 }), c = { dur: 1437083, playing: true, hasNext: false, resume: 0 };
  assert.strictEqual(mk.tick(5000, c).btn, null); assert.strictEqual(mk.tick(6000, c).btn, null);
  var o = mk.tick(7000, c); assert.strictEqual(o.btn, 'intro');
  assert.strictEqual(mk.skip(o.marker, c.dur), 87121);
  var mk2 = new N.Markers(MK, { intro: 'button', credits: 'off', autoNext: false, cd: 10 });
  assert.strictEqual(run(mk2, 5000, 19000, c).btn, 'intro');
  assert.strictEqual(run(mk2, 20000, 30000, c).btn, null, 'nach 15 s weg');
});
test('Marker: Auto springt, danach 5 s "Intro ansehen"; nicht waehrend des Fortsetzen-Sprungs', function () {
  var mk = new N.Markers(MK, { intro: 'auto', credits: 'off', autoNext: false, cd: 10 }), c = { dur: 1437083, playing: true, hasNext: false, resume: 60000 };
  assert.strictEqual(run(mk, 2000, 10000, c).skipTo, -1, 'resume 60 s: kein Sprung bei 10 s');
  c.resume = 0; mk = new N.Markers(MK, { intro: 'auto', credits: 'off', autoNext: false, cd: 10 });
  var o = run(mk, 2000, 4000, c); assert.strictEqual(o.skipTo, 87121);
  o = mk.tick(87500, c); assert.strictEqual(o.btn, 'watch');
  assert.strictEqual(mk.watchStart(), 1361);
  assert.strictEqual(run(mk, 2000, 6000, c).skipTo, -1, 'kein erneuter Auto-Sprung');
});
test('Countdown: ab finalem Abspann, N Sekunden nach Wiedergabezeit, Abbruch, Fallback Dauer - N - 2 s', function () {
  var list = [{ type: 'credits', startTimeOffset: 3142551, endTimeOffset: 3185057, 'final': true }];
  var mk = new N.Markers(list, { intro: 'button', credits: 'button', autoNext: true, cd: 10 }), c = { dur: 3185057, playing: true, hasNext: true, resume: 0 };
  var o = run(mk, 3140000, 3143000, c); assert.strictEqual(o.cd, 10);
  o = run(mk, 3144000, 3150000, c); assert.strictEqual(o.cd, 3);
  o = run(mk, 3151000, 3153000, c); assert.strictEqual(o.next, true);
  mk = new N.Markers(list, { intro: 'button', credits: 'button', autoNext: true, cd: 10 });
  run(mk, 3140000, 3145000, c); mk.cancelCountdown();
  o = run(mk, 3146000, 3150000, c); assert.strictEqual(o.cd, -1); assert.strictEqual(o.btn, 'credits');
  mk = new N.Markers([], { intro: 'off', credits: 'off', autoNext: true, cd: 5 });
  assert.strictEqual(run(mk, 3170000, 3178000, c).cd, -1);
  assert.strictEqual(run(mk, 3179000, 3179000 + 2000, c).cd, 5 - 2);
  c.hasNext = false; mk = new N.Markers(list, { intro: 'off', credits: 'off', autoNext: true, cd: 5 });
  assert.strictEqual(run(mk, 3140000, 3150000, c).cd, -1, 'ohne naechste Folge kein Countdown');
});

/* ---------- Sammel-Sprung ---------- */
test('Sprung-Sammelfenster: Ziel sofort, ein Sprung 600 ms nach dem letzten Druck, Grenzen', function () {
  var done = [], acc = new N.SeekAcc(function (tg, d) { done.push([tg, d]); }, { now: T.now, set: T.setTimeout, clear: T.clearTimeout });
  eq(acc.press(30000, 600000, 3600000), { target: 630000, delta: 30000 });
  T.tick(300); acc.press(30000, 600000, 3600000); T.tick(300);
  var st = acc.press(30000, 600000, 3600000);
  assert.strictEqual(st.delta, 90000); assert.strictEqual(done.length, 0);
  T.tick(599); assert.strictEqual(done.length, 0); T.tick(1);
  eq(done, [[690000, 90000]]); assert.ok(!acc.active());
  acc.press(-30000, 10000, 3600000); T.tick(600); eq(done[1], [0, -10000]);
  acc.press(30000, 3590000, 3600000); T.tick(600); eq(done[2], [3595000, 5000]);
});
test('Sprung-Sammelfenster: Halten beschleunigt (x3 nach 1 s, x6 nach 3 s)', function () {
  var acc = new N.SeekAcc(function () {}, { now: T.now, set: T.setTimeout, clear: T.clearTimeout }), st;
  for (var i = 0; i < 6; i++) { st = acc.press(10000, 0, 9e6, true); T.tick(200); }
  assert.strictEqual(st.target, 60000 + 20000);   // 5 x 10 s, 6. Druck (1000 ms gehalten) x3
  for (i = 0; i < 10; i++) { st = acc.press(10000, 0, 9e6, true); T.tick(200); }
  assert.strictEqual(st.target, 80000 + 9 * 30000 + 60000);
  acc.cancel();
});

/* ---------- Vorschaubilder ---------- */
function bif(frames, iv) {
  var head = [0x89, 0x42, 0x49, 0x46, 0x0d, 0x0a, 0x1a, 0x0a], b = [];
  function u32(v) { b.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255); }
  b = head.slice(); u32(0); u32(frames.length); u32(iv); while (b.length < 64) b.push(0);
  var off = 64 + (frames.length + 1) * 8;
  frames.forEach(function (f, i) { u32(i); u32(off); off += f.length; });
  u32(0xffffffff); u32(off);
  var s = String.fromCharCode.apply(null, b); frames.forEach(function (f) { s += f; });
  return s;
}
test('BIF: Index lesen, Bild zur Zeit finden, Base64-Daten-URI', function () {
  var s = bif(['ab', 'cde', 'f'], 2000), r = N.thumbs.parseBif(s);
  assert.strictEqual(r.interval, 2000); assert.strictEqual(r.frames.length, 3);
  eq(r.frames.map(function (f) { return [f.t, f.n]; }), [[0, 2], [2000, 3], [4000, 1]]);
  assert.strictEqual(N.thumbs.frameAt(r, 3999), 1); assert.strictEqual(N.thumbs.frameAt(r, 99999), 2);
  assert.strictEqual(N.thumbs.dataUri(s, r, 1), 'data:image/jpeg;base64,' + Buffer.from('cde').toString('base64'));
  assert.strictEqual(N.thumbs.b64('ÿ\u0000'), Buffer.from([255, 0]).toString('base64'));
  assert.strictEqual(N.thumbs.parseBif('kein bif'), null);
});
test('Vorschaubild-URL: nur mit indexes=sd, 240x135, 2-s-Raster', function () {
  assert.ok(!N.thumbs.has({ id: 1 })); assert.ok(N.thumbs.has({ id: 1, indexes: 'sd' }));
  var q = qsParse(N.thumbs.url('http://pms', 77, 61234, 'T'));
  assert.strictEqual(q.url, '/library/parts/77/indexes/sd/62000'); assert.strictEqual(q.width, '240'); assert.strictEqual(q.height, '135');
});

/* ---------- Untertitel ---------- */
test('SRT: parsen, Tags entfernen, Cue finden', function () {
  var c = N.subs.parse('1\r\n00:00:01,000 --> 00:00:02,500\r\n<i>Hallo</i>\r\n\r\n2\n00:00:03,000 --> 00:00:04,000\n{\\an8}Zwei\nZeilen\n');
  eq(c, [{ a: 1000, b: 2500, x: 'Hallo' }, { a: 3000, b: 4000, x: 'Zwei\nZeilen' }]);
  assert.strictEqual(N.subs.cueAt(c, 2000), 0); assert.strictEqual(N.subs.cueAt(c, 2600), -1); assert.strictEqual(N.subs.cueAt(c, 3500), 1);
  assert.strictEqual(N.subs.clean('a<br />b\\nc'), 'a\nb\nc');
});

/* ---------- Ablaufsteuerung ---------- */
function rig(opts) {
  opts = opts || {};
  var calls = [], writes = [], gets = [];
  var sef = { exec: function (n, a) { calls.push(a === undefined ? n : n + ':' + a); return opts.jumpRet !== undefined && /^Jump/.test(n) ? opts.jumpRet : 1; } };
  var meta = opts.meta || 'meta-direct.json', dec = opts.dec || 'decision-direct.json';
  var deps = {
    sef: sef, base: 'http://pms', token: 'TOK', clientId: 'CID', threshold: 0.9,
    timers: { now: T.now, set: T.setTimeout, clear: T.clearTimeout },
    cfg: { directPlay: true, quality: '12', ass: 'burn', audioLang: 'server', subs: 'server', subLang: 'de', anime: false, rememberTracks: false },
    get: function (path, q, o, cb) { gets.push({ path: path, q: q }); cb(null, /decision/.test(path) ? S(opts.decs ? opts.decs[gets.length - 2] : dec) : opts.metaJson || S(meta)); },
    write: function (m, path, q, cb) { writes.push(m + ' ' + path + (q.state ? ' ' + q.state : '')); cb(null, ''); }
  };
  var p = new N.Playback(deps, { rk: '2345', off: opts.off || 0 }), ev = [];
  p.on(function (e, d) { ev.push(e === 'state' ? 'state:' + d : e); });
  return { p: p, calls: calls, writes: writes, gets: gets, ev: ev, deps: deps };
}
test('Ablauf Direct Play: Decision -> InitPlayer mit Datei-URL, Start an viewOffset, Timeline alle 10 s', function () {
  var r = rig({ off: 754000 }), p = r.p;
  p.start();
  assert.ok(r.calls[0] === 'Stop');
  assert.ok(/^InitPlayer:http:\/\/pms\/library\/parts\/25307\/1461260780\/file.mkv\?X-Plex-Token=TOK&X-Plex-Client-Identifier=CID$/.test(r.calls[1]));
  assert.ok(r.calls.indexOf('StartPlayback:754') > 0);
  assert.strictEqual(r.gets[1].q.directPlay, 1);
  p.onEvent(9); p.onEvent(14, 754500);
  assert.strictEqual(p.state, 'playing');
  assert.deepStrictEqual(r.writes.filter(function (w) { return /timeline/.test(w); }), ['GET /:/timeline playing']);
  T.tick(10000); T.tick(10000);
  assert.strictEqual(r.writes.filter(function (w) { return /timeline playing/.test(w); }).length, 3);
  assert.ok(!r.writes.some(function (w) { return /ping/.test(w); }), 'kein Ping bei Direct Play');
  p.stop('user');
  assert.ok(r.writes.indexOf('GET /:/timeline stopped') >= 0);
  assert.ok(!r.writes.some(function (w) { return /transcode\/universal\/stop/.test(w); }));
  var n = r.writes.length; T.tick(30000); assert.strictEqual(r.writes.length, n, 'nach Stop keine Timeline mehr');
});
test('Ablauf HEVC: start.m3u8 mit Limit + |COMPONENT=HLS nach 300 ms (hlsWait), Ping alle 10 s in der Pause, Stop beendet die Sitzung', function () {
  var r = rig({ meta: 'meta-hevc.json', dec: 'decision-hevc.json' }), p = r.p;
  p.start();
  assert.ok(!r.calls.some(function (c) { return /^InitPlayer/.test(c); }), 'nicht sofort');
  T.tick(299);
  assert.ok(!r.calls.some(function (c) { return /^InitPlayer/.test(c); }), 'erst nach 300 ms');
  T.tick(1);
  var init = r.calls.filter(function (c) { return /^InitPlayer/.test(c); })[0];
  assert.ok(/start\.m3u8\?.*\|COMPONENT=HLS$/.test(init));
  var q = qsParse(init.slice(11));
  assert.strictEqual(q.maxVideoBitrate, '12000'); assert.strictEqual(q.directPlay, '0'); assert.strictEqual(q.session, p.session);
  p.onEvent(14, 1000); p.pause();
  assert.strictEqual(p.state, 'paused');
  T.tick(10000); T.tick(10000); T.tick(10000);
  assert.strictEqual(r.writes.filter(function (w) { return /ping/.test(w); }).length, 3, 'Pause > 30 s: Transcoder bleibt wach');
  p.stop('user');
  assert.ok(r.writes.indexOf('GET /video/:/transcode/universal/stop') >= 0);
  assert.strictEqual(r.calls[r.calls.length - 1], 'Stop');
});
test('Renderfehler: direct -> direct stream -> transcode -> Fehler', function () {
  var r = rig({ decs: ['decision-direct.json', 'decision-truehd.json', 'decision-hevc.json'] }), p = r.p, errs = [];
  p.on(function (e, d) { if (e === 'error') errs.push(d.kind); });
  p.start(); p.onEvent(14, 5000);
  p.onEvent(6, 2);
  assert.strictEqual(r.gets[2].q.directPlay, 0); assert.strictEqual(r.gets[2].q.directStream, 1);
  T.tick(1000); p.onEvent(14, 5000); p.onEvent(6, 2);
  assert.strictEqual(r.gets[3].q.directStream, 0);
  T.tick(1000); p.onEvent(6, 2);
  eq(errs, ['playback']); assert.strictEqual(p.state, 'error');
  assert.ok(r.calls.filter(function (c) { return /^StartPlayback:5$/.test(c); }).length >= 2, 'Neustart an der Fehlerstelle');
});
test('Ende: unter der Schwelle scrobble, darueber nur Timeline; Jump-Fehler bei HLS -> Neustart', function () {
  var r = rig(), p = r.p;
  p.start(); p.onEvent(14, 1000); p.stop('next');
  assert.ok(r.writes.indexOf('GET /:/scrobble') >= 0, 'Folgewechsel vor 90 % setzt gesehen');
  r = rig(); p = r.p; p.start(); p.onEvent(14, 3100000); p.onEvent(8);
  assert.ok(r.writes.indexOf('GET /:/scrobble') < 0); assert.strictEqual(p.state, 'ended');
  r = rig({ meta: 'meta-hevc.json', dec: 'decision-hevc.json', jumpRet: -1 }); p = r.p;
  p.start(); T.tick(1000); p.onEvent(14, 60000);
  var before = r.gets.length; p.seek(120000);
  assert.strictEqual(r.gets.length, before + 1, 'neue Decision'); assert.strictEqual(p.resume, 120000);
  T.tick(1000); assert.ok(r.calls.indexOf('StartPlayback:120') >= 0);
});
test('Spurwahl vor der Decision: PUT /library/parts mit allParts=1; Direct Play setzt Tonspur lokal', function () {
  var r = rig({ meta: 'meta-anime.json' }), p = r.p;
  r.deps.cfg.anime = true; r.deps.cfg.ass = 'text';
  p.start();
  assert.strictEqual(r.gets[1].q.subtitles, 'none'); assert.strictEqual(r.gets[1].q.directPlay, 1);
  assert.ok(r.writes[0] === 'PUT /library/parts/25556');
  p.onEvent(9);
  assert.ok(r.calls.indexOf('SetStreamID:1') >= 0);
  assert.ok(r.calls.indexOf('StartSubtitle:1') >= 0, 'eingebettete ASS als Text ueber das SEF');
  r = rig({ meta: 'meta-anime.json' }); r.deps.cfg.anime = true; r.p.start();
  assert.strictEqual(r.gets[1].q.subtitles, 'burn'); assert.strictEqual(r.gets[1].q.directPlay, 0, 'ASS einbrennen -> kein Direct Play');
});
test('Bildflaeche: Letterbox 2.39 und 4:3', function () {
  eq(N.Playback.area(2.39), [0, 92, 1280, 536]);
  eq(N.Playback.area(4 / 3), [160, 0, 960, 720]);
});

/* ---------- TV-Test 26.10.: franzoesische UT ohne Auswahl (Film mit Server-Vorauswahl "French Forced") ---------- */
function forcedRaw() {
  return { ratingKey: 90530, type: 'movie', title: 'Ponyhof', Media: [{ Part: [{ id: 1, duration: 1000, Stream: [
    { id: 1, streamType: 1, codec: 'h264' },
    { id: 73898, streamType: 2, codec: 'eac3', languageCode: 'fra', title: 'French', selected: true },
    { id: 73899, streamType: 2, codec: 'eac3', languageCode: 'eng', title: 'English', default: true },
    { id: 73900, streamType: 3, codec: 'srt', languageCode: 'fra', title: 'French Forced', selected: true, default: true, forced: true },
    { id: 73901, streamType: 3, codec: 'srt', languageCode: 'fra', title: 'French' },
    { id: 73903, streamType: 3, codec: 'srt', languageCode: 'eng', title: 'English' }] }] }] };
}
function forcedMovie() { return N.Playback.meta(forcedRaw()); }
test('Untertitel folgen der Einstellung, nicht der Server-Vorauswahl', function () {
  var m = forcedMovie(), c = JSON.parse(JSON.stringify(CFG));
  eq(N.tracks.choose(m.tracks, c, null, false), { a: null, s: 0, why: 'prefs' }, 'Nur noetige: Forced nur in einer Sprache des Nutzers');
  c.subs = 'always'; c.subLang = 'de';
  assert.strictEqual(N.tracks.choose(m.tracks, c, null, false).s, 73903, 'Immer: DE fehlt -> EN');
  m.tracks.subs.pop(); assert.strictEqual(N.tracks.choose(m.tracks, c, null, false).s, 0, 'Immer ohne DE/EN -> aus statt Server-Wahl');
  c.subs = 'server'; assert.strictEqual(N.tracks.choose(m.tracks, c, null, false).s, null, 'Wie auf dem Server: Vorauswahl bleibt');
  c.subs = 'forced';
  var r = N.tracks.choose(forcedMovie().tracks, c, { a: 'fr', at: 'French', t: 1 }, false);
  assert.strictEqual(r.s, 0, 'nur Ton gemerkt -> UT nach Einstellung');
  var de = forcedMovie(); de.tracks.audio[0].lang = 'de'; de.tracks.subs[0].lang = 'de';
  assert.strictEqual(N.tracks.choose(de.tracks, c, null, false).s, null, 'DE-Ton + DE Forced (schon gewaehlt) bleibt');
});
test('UT aus: kein StartSubtitle, SEF-Untertitel-Ereignisse (19) werden verworfen', function () {
  var r = rig({ metaJson: { MediaContainer: { Metadata: [forcedRaw()] } } }), p = r.p, subs = [];
  r.deps.cfg.subs = 'off';
  p.on(function (e, d) { if (e === 'sub') subs.push(d); });
  p.start(); p.onEvent(9); p.onEvent(14, 1000);
  p.onEvent(19, 'Bonjour');
  assert.ok(!r.calls.some(function (c) { return /Subtitle|SetStreamID:4/.test(c); }));
  eq(subs, []);
  assert.strictEqual(p.subMode, 'none');
  assert.ok(r.writes[0] === 'PUT /library/parts/1', 'Server-Vorauswahl wird abgewaehlt (subtitleStreamID=0)');
});

/* ---------- HLS-Start: A/B-Schalter (config.json), Zeitstempel ---------- */
test('HLS-Start: hlsFast = ohne Wartezeit, offset an der Fortsetzen-Stelle, STARTBITRATE, EAC3 durchreichen, Puffer', function () {
  var keep = N.config.hls, logs = [], oldLog = N.log;
  N.log = function (m) { logs.push(m); };
  try {
    N.config.apply({ hlsFast: true, hlsBuf: { init: 1024, pending: 512 } });
    var r = rig({ meta: 'meta-hevc.json', dec: 'decision-hevc.json', off: 600000 }), p = r.p;
    p.start();
    var init = r.calls.filter(function (c) { return /^InitPlayer/.test(c); })[0];
    assert.ok(init, 'InitPlayer sofort (hlsWait 0)');
    assert.ok(/\|COMPONENT=HLS\|STARTBITRATE=5000000$/.test(init));
    var q = qsParse(init.slice(11));
    assert.strictEqual(q.offset, '600'); assert.strictEqual(q['X-Plex-Incomplete-Segments'], '1');
    assert.ok(q['X-Plex-Client-Profile-Extra'].indexOf(N.decision.EAC3) > 0);
    assert.ok(r.calls.indexOf('StartPlayback:0') > 0, 'SEF startet bei 0, Server bei offset');
    assert.ok(r.calls.indexOf('SetInitialBufferSize:1048576') > 0 && r.calls.indexOf('SetPendingBufferSize:524288') > 0);
    p.onEvent(11); p.onEvent(12); p.onEvent(14, 2000);
    assert.strictEqual(p.t, 602000, 'relative SEF-Zeit + Basis');
    T.tick(1000); assert.ok(!r.calls.some(function (c) { return /^Jump/.test(c); }), 'kein Sicherheits-Sprung');
    ['Decision fertig', 'InitPlayer', 'StartPlayback', 'SEF Puffern', 'SEF Puffer voll', 'erste Zeit'].forEach(function (w) {
      assert.ok(logs.some(function (l) { return l.indexOf('Zeit ' + w + ' +') >= 0; }), 'Zeitstempel ' + w);
    });
    var r2 = rig({ meta: 'meta-hevc.json', dec: 'decision-hevc.json', off: 600000 }); r2.p.start(); r2.p.onEvent(14, 600500);
    assert.strictEqual(r2.p.t, 600500, 'SEF meldet Original-Zeit (copyts) -> unveraendert');
  } finally { N.config.hls = keep; N.log = oldLog; }
  var r3 = rig({ meta: 'meta-hevc.json', dec: 'decision-hevc.json', off: 600000 }); r3.p.start(); T.tick(1000);
  var i3 = r3.calls.filter(function (c) { return /^InitPlayer/.test(c); })[0];
  assert.strictEqual(qsParse(i3.slice(11)).offset, '0', 'Standard unveraendert');
  assert.ok(r3.calls.indexOf('StartPlayback:600') > 0);
});
test('Bildformat: Flaechen und Zoom-Zuschnitt (Orca-Raster 960x540 bzw. Quellpixel)', function () {
  var R = N.Playback.rects;
  eq(R('auto', 2.39, 1920, 800, 'app').area, [0, 92, 1280, 536]);
  eq(R('fill', 2.39, 1920, 800, 'app').area, [0, 0, 1280, 720]);
  eq(R('43', 16 / 9, 1920, 1080, 'app').area, [160, 0, 960, 720]);
  eq(R('orig', 16 / 9, 720, 576, 'app').area, [190, 0, 900, 720]);
  var z = R('zoom', 2.4, 1920, 800, 'app');
  eq(z.area, [0, 0, 1280, 720]); eq(z.crop, [125, 0, 711, 540]); eq(z.full, [0, 0, 960, 540]);
  eq(R('zoom', 2.4, 1920, 800, 'video').crop, [249, 0, 1422, 800]);
  eq(R('zoom', 16 / 9, 1920, 1080, 'app').crop, [120, 68, 720, 405]);
  assert.strictEqual(R('auto', 2.4, 1920, 800, 'app').crop, null);
});

/* ---------- OSD-Logik (Knopfreihe, Kapitel, Mehr-Menue, Sleep, Verzoegerung) ---------- */
test('Knopfreihe: sichtbare Knoepfe, ◀▶ ohne Umlauf, Zeiger-Treffer, Label-Mitte', function () {
  var O = N.osd, all = O.visible({ next: true, chap: true });
  eq(all, ['back', 'pp', 'fwd', 'next', 'chap', 'tracks', 'more']);
  var film = O.visible({ next: false, chap: false });
  eq(film, ['back', 'pp', 'fwd', 'tracks', 'more']);
  assert.strictEqual(O.nav(film, 'pp', 'RIGHT'), 'fwd');
  assert.strictEqual(O.nav(film, 'fwd', 'RIGHT'), 'tracks', 'Luecke wird uebersprungen');
  assert.strictEqual(O.nav(film, 'more', 'RIGHT'), 'more', 'kein Umlauf');
  assert.strictEqual(O.nav(film, 'back', 'LEFT'), 'back');
  assert.strictEqual(O.nav(film, 'next', 'LEFT'), 'pp', 'ausgeblendeter Knopf -> Play/Pause');
  assert.strictEqual(O.center('pp'), 640, 'Play/Pause mittig auf x = 640');
  assert.strictEqual(O.hit(film, 640, 562), 'pp');
  assert.strictEqual(O.hit(film, 1160, 562), 'more');
  assert.strictEqual(O.hit(film, 1032, 562), null, 'Kapitel ausgeblendet');
  assert.strictEqual(O.hit(all, 1032, 562), 'chap');
  assert.strictEqual(O.hit(all, 300, 562), null);
});
test('Kapitel: sortiert, Kapitel zur Zeit', function () {
  var c = N.osd.chapters([{ tag: 'B', index: 2, startTimeOffset: 600000 }, { tag: 'A', index: 1, startTimeOffset: 0 }]);
  eq(c.map(function (x) { return x.t; }), ['A', 'B']);
  assert.strictEqual(N.osd.chapterAt(c, 599999), 0); assert.strictEqual(N.osd.chapterAt(c, 600000), 1);
  assert.strictEqual(N.osd.chapterAt([], 5), -1);
  var m = N.Playback.meta({ ratingKey: 1, type: 'movie', Chapter: [{ tag: 'X', startTimeOffset: 0 }], Media: [{ Part: [{ id: 1 }] }] });
  assert.strictEqual(m.chapters.length, 1);
});
test('Mehr-Menue: Original bei Direct Play, UT-Darstellung nur bei UT an, Sleep-Rest, Verzoegerung, Qualitaet senken', function () {
  var O = N.osd, st = { direct: true, quality: '12', aspect: 'auto', subsOn: false, markers: false, autoNext: true, ep: false, sleep: 'Aus' };
  var ids = O.more(st).map(function (e) { return e.id; });
  eq(ids, ['quality', 'aspect', 'sleep', 'problem']);
  assert.strictEqual(O.more(st)[0].s, N.t('pl.q.orig'));
  st.direct = false; st.subsOn = true; st.markers = true; st.ep = true;
  ids = O.more(st).map(function (e) { return e.id; });
  eq(ids, ['quality', 'aspect', 'subs', 'skipIntro', 'skipCredits', 'autoNext', 'sleep', 'problem']);
  assert.ok(/12 Mbit\/s/.test(O.more(st)[0].s));
  assert.strictEqual(O.sleepLeft(1000 + 30 * 60000, 1000), 30); assert.strictEqual(O.sleepLeft(1000 + 61000, 1000), 2);
  assert.strictEqual(O.delayText(0), N.t('pl.delay.zero'));
  var de = N.i18n.lang() === 'de';
  assert.strictEqual(O.delayText(500), (de ? '+0,5 Sek. später' : '+0.5 sec later'));
  assert.strictEqual(O.delayText(-250), (de ? '-0,25 Sek. früher' : '-0.25 sec earlier'));
  assert.strictEqual(O.lower('12', false), '8'); assert.strictEqual(O.lower('4', false), '4'); assert.strictEqual(O.lower('20', true), '8');
});
test('Untertitel-Verzoegerung: SEF-intern per SetSubtitleSync beim Start und beim Aendern', function () {
  var r = rig({ meta: 'meta-anime.json' }), p = r.p;
  r.deps.cfg.anime = true; r.deps.cfg.ass = 'text'; r.deps.cfg.subDelay = 500;
  p.start(); p.onEvent(9);
  assert.ok(r.calls.indexOf('SetSubtitleSync:500') >= 0);
  p.setSubDelay(-1000);
  assert.ok(r.calls.indexOf('SetSubtitleSync:-1000') >= 0);
});
