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
test('Marker nach Fortsetzen und Zuruecksprung (Review 07.11.): Intro-Button wieder da, Sprung setzt den Fortsetzen-Punkt zurueck', function () {
  // fortgesetzt bei 25:00, dann zurueck auf 0:05: das Intro (0:01-1:27) war nur "vorbei", nie gezeigt -> Button wieder da
  var mk = new N.Markers(MK, { intro: 'button', credits: 'off', autoNext: false, cd: 10 }), c = { dur: 1437083, playing: true, hasNext: false, resume: 1500000 };
  run(mk, 1500000, 1505000, c);
  mk.seeked(); c.resume = 0;
  assert.strictEqual(run(mk, 5000, 8000, c).btn, 'intro');
  // Playback: ein Sprung nach dem ersten Tick setzt resume auf 0 (Start-Sprung/Sicherheitsnetz unberuehrt)
  var r = rig({ off: 1500000 }), p = r.p;
  p.start(); T.tick(1000);
  assert.strictEqual(p.resume, 1500000, 'vor dem ersten Tick bleibt der Fortsetzen-Punkt');
  p.onEvent(14, 1500000);
  p.seek(60000);
  assert.strictEqual(p.resume, 0);
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

test('Echtes Dateiende (PLAY-18, TV-Befund 1.0.6): naechste Folge, kurz die Karte mit Rueckzaehler oder zurueck – nie stehen bleiben', function () {
  var E = N.Markers.endAction, base = { sleepEnd: false, autoNext: true, hasNext: false, last: false, cancelled: false };
  function ea(o) { var x = {}, k; for (k in base) x[k] = base[k]; for (k in o) x[k] = o[k]; return E(x); }
  assert.strictEqual(ea({ hasNext: true }), 'next');
  assert.strictEqual(ea({ last: true }), 'card', 'letzte Folge: Karte, danach zurueck');
  assert.strictEqual(ea({ last: true, cancelled: true }), 'close', 'Karte vorher weggedrueckt (Abspann ansehen): gleich zurueck');
  assert.strictEqual(ea({ last: true, autoNext: false }), 'close');
  assert.strictEqual(ea({}), 'close', 'Film: zurueck');
  assert.strictEqual(ea({ hasNext: true, sleepEnd: true }), 'sleep');
  assert.strictEqual(N.Markers.endWait(15), 15, 'Wartezeit vor naechster Folge');
  assert.strictEqual(N.Markers.endWait(0), 10, 'aus/leer -> 10 s');
  assert.strictEqual(N.Markers.endWait(undefined), 10);
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
    sef: sef, base: 'http://pms', token: 'TOK', clientId: 'CID', threshold: 0.9, wan: !!opts.wan, wanDirect: !!opts.wanDirect, cell: !!opts.cell,
    timers: { now: T.now, set: T.setTimeout, clear: T.clearTimeout },
    cfg: { directPlay: true, quality: '12', qualityRemote: opts.qWan, qualityCell: opts.qCell, ass: 'burn', audioLang: 'server', subs: 'server', subLang: 'de', anime: false, rememberTracks: false },
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
test('Weiterer Server uebers Internet (TV-Test 1.0.4): kein Direct Play, 8 Mbit/s 1080p in der Decision, SEF 1 beim Start -> Rueckfall statt Fehler', function () {
  var r = rig({ wan: true, decs: ['decision-truehd.json', 'decision-hevc.json'] }), p = r.p, errs = [];
  p.on(function (e, d) { if (e === 'error') errs.push(d.kind); });
  p.start();
  var q = r.gets[1].q;
  assert.strictEqual(q.directPlay, 0); assert.strictEqual(q.directStream, 1); assert.strictEqual(q.location, 'wan');
  assert.strictEqual(q.maxVideoBitrate, 8000); assert.strictEqual(q.videoResolution, '1920x1080');
  T.tick(1000);
  p.onEvent(1);                                          // Verbindung/Oeffnen gescheitert, noch kein Bild
  eq(errs, []);
  assert.strictEqual(r.gets[2].q.directStream, 0, 'Rueckfall: Umwandlung');
  T.tick(1000);
  p.onEvent(1);
  eq(errs, ['server']);                                  // Kette zu Ende -> Fehler (Ansicht prueft /identity, s. views/player.js)
  // niedrigere eigene Qualitaet gilt weiter; eigener Server ohne Grenze in der ersten Decision (K2)
  assert.strictEqual(N.decision.query({ rk: '1', wan: true, quality: '4' }).maxVideoBitrate, 4000);
  assert.strictEqual(N.decision.query({ rk: '1', quality: '12' }).maxVideoBitrate, undefined);
  r = rig(); p = r.p; errs = [];
  p.on(function (e, d) { if (e === 'error') errs.push(d.kind); });
  p.start(); p.onEvent(1);
  eq(errs, ['server']);                                  // eigener Server unveraendert
});
test('Qualitaet ueber das Internet / ueber Mobilfunk (PLAY-36): Standard 8 = bisher, niedrigste Grenze gilt, eigener Server unterwegs mit Direct Play', function () {
  var D = N.decision;
  function cap(o) { var q = D.query(Object.assign({ rk: '1' }, o)); return q.maxVideoBitrate === undefined ? '-' : q.maxVideoBitrate + ' ' + q.videoResolution; }
  // ohne Einstellung (alte Profile) und mit Standard 8: genau wie TV-Test 1.0.4
  eq([cap({ wan: true, quality: '12' }), cap({ wan: true, quality: '12', qWan: '8' }), cap({ wan: true, quality: '20', qWan: '8' })],
    ['8000 1920x1080', '8000 1920x1080', '8000 1920x1080']);
  eq(cap({ wan: true, quality: '8', qWan: '8' }), '8000 1280x720');            // gleiche Bitrate: "beim Umwandeln" bleibt (720p)
  eq(cap({ wan: true, quality: '12', qWan: '20' }), '12000 1920x1080');        // Internet hoeher als beim Umwandeln: Umwandeln gilt
  eq(cap({ wan: true, quality: '20', qWan: '20' }), '20000 1920x1080');
  eq(cap({ wan: true, quality: '20', qWan: '4' }), '4000 1280x720');
  eq(cap({ quality: '12', qWan: '4' }), '-');                                   // Heimnetz: Einstellung wirkt nicht (K2)
  eq(cap({ cell: true, quality: '12' }), '4000 1280x720');                      // Mobilfunk: Standard 4
  eq(cap({ cell: true, wan: true, quality: '20', qWan: '12', qCell: '8' }), '8000 1920x1080');
  eq(cap({ cell: true, wan: true, quality: '20', qWan: '4', qCell: '12' }), '4000 1280x720');
  eq(D.query({ rk: '1', cell: true }).location, 'lan', 'Mobilfunk mit VPN nach Hause: location bleibt lan');
  // Playback: Weitere Server ohne Direct Play (TV), eigener Server unterwegs (wanDirect) zuerst Direct Play – mit Grenze
  var r = rig({ wan: true, wanDirect: true, qWan: '12' });
  r.p.start();
  var q = r.gets[1].q;
  assert.strictEqual(q.directPlay, 1); assert.strictEqual(q.location, 'wan'); assert.strictEqual(q.maxVideoBitrate, 12000);
  r = rig({ cell: true, qCell: '8' });
  r.p.start();
  q = r.gets[1].q;
  assert.strictEqual(q.directPlay, 1); assert.strictEqual(q.location, 'lan'); assert.strictEqual(q.maxVideoBitrate, 8000); assert.strictEqual(q.videoResolution, '1920x1080');
});
test('Qualitaet ueber 1080p (PLAY-37): Original ohne Grenze, 4K nur auf 4K-Geraeten, beim Umwandeln immer endlich', function () {
  var D = N.decision, C = N.platform.caps.codecs, oldRes = C.maxResolution;
  function cap(o) { var q = D.query(Object.assign({ rk: '1' }, o)); return q.maxVideoBitrate === undefined ? '- ' + q.videoResolution : q.maxVideoBitrate + ' ' + q.videoResolution; }
  // TV (1920x1080): Stufen Original, 20, 12, 8, 4 – kein 4K; hoechste Zahlen-Stufe 20
  eq(D.steps(), ['orig', '20', '12', '8', '4']); assert.strictEqual(D.top(), '20');
  // Heimnetz, Decision: nie eine Grenze (K2) – auch nicht mit Original
  eq(cap({ quality: 'orig' }), '- 1920x1080');
  // beim Umwandeln: Original = hoechste Stufe des Geraets, nie unbegrenzt
  eq(cap({ quality: 'orig', transcode: true }), '20000 1920x1080');
  eq(D.cap({ quality: 'orig' }), [20000, '1920x1080']);
  // ueber das Internet: Original = keine Grenze in der Decision (Direct Play/Stream moeglich); wird umgewandelt: "beim Umwandeln"
  eq(cap({ wan: true, quality: '12', qWan: 'orig' }), '- 1920x1080');
  eq(cap({ wan: true, quality: '12', qWan: 'orig', transcode: true }), '12000 1920x1080');
  eq(cap({ wan: true, quality: 'orig', qWan: 'orig', transcode: true }), '20000 1920x1080');
  // Zahl ueber das Internet, Original beim Umwandeln: Internet-Grenze gilt (wie bisher die niedrigste)
  eq(cap({ wan: true, quality: 'orig', qWan: '8' }), '8000 1920x1080');
  eq(cap({ wan: true, quality: 'orig', qWan: '8', transcode: true }), '8000 1920x1080');
  // Mobilfunk Original + Internet Zahl: die Zahl gilt; beide Original: keine Grenze
  eq(cap({ wan: true, cell: true, quality: '12', qWan: '4', qCell: 'orig' }), '4000 1280x720');
  eq(cap({ cell: true, quality: '12', qCell: 'orig' }), '- 1920x1080');
  // 4K-Werte am TV (z. B. aus einem anderen Geraet): hoechste Stufe des Geraets (Nacht F, Befund 4); unbekannt -> Standard
  eq(cap({ wan: true, quality: '80', qWan: '80' }), '20000 1920x1080');
  eq(cap({ quality: '40', transcode: true }), '20000 1920x1080');
  eq(cap({ quality: 'x', transcode: true }), '12000 1920x1080');
  eq(cap({ wan: true, quality: '12', qWan: 'x' }), '8000 1920x1080');
  assert.strictEqual(D.eff('80'), '20'); assert.strictEqual(D.eff('x'), '12'); assert.strictEqual(D.eff('x', '8'), '8'); assert.strictEqual(D.eff('orig'), 'orig');
  // Versionswahl (Detailseite, Startseite, Wiedergabe) = Grenze beim Umwandeln (Befund 1)
  assert.strictEqual(D.verLimit('orig'), 20000); assert.strictEqual(D.verLimit('80'), 20000); assert.strictEqual(D.verLimit(undefined), 12000); assert.strictEqual(D.verLimit('8'), 8000);
  // Original + Quell-Codec am TV: hoechste Stufe ist ohnehin 20
  eq(cap({ quality: 'orig', transcode: true, vcodec: 'hevc' }), '20000 1920x1080');
  // Texte
  assert.strictEqual(D.label('orig'), N.t('set.v.qOrig'));
  assert.ok(/^20 Mbit\/s · 1080p$/.test(D.label('20'))); assert.ok(/^8 Mbit\/s · 1080p$/.test(D.label('8', D.QWAN))); assert.ok(/720p$/.test(D.label('8')));
  try {
    C.maxResolution = '3840x2160';                     // 4K-Geraet (Apple-Adapter setzt das spaeter)
    eq(D.steps(), ['orig', '80', '40', '20', '12', '8', '4']); assert.strictEqual(D.top(), '80');
    eq(cap({ quality: 'orig', transcode: true }), '80000 3840x2160');
    eq(cap({ quality: '40', transcode: true }), '40000 3840x2160');
    eq(cap({ wan: true, quality: '80', qWan: '40' }), '40000 3840x2160');
    eq(cap({ wan: true, quality: 'orig', qWan: 'orig' }), '- 3840x2160');
    assert.ok(/^80 Mbit\/s · 4K$/.test(D.label('80')));
    assert.strictEqual(N.osd.lower('orig', false), '40'); assert.strictEqual(N.osd.lower('80', false), '40');
    assert.strictEqual(N.osd.lower('x', false), '8', 'unbekannte Stufe = 12 -> 8, nicht 20 (Befund 4)');
    assert.strictEqual(D.verLimit('orig'), 80000);
    // Original beim Umwandeln: Quell-Codec hier nicht direkt (HEVC ohne hevc, andere Codecs) -> hoechstens 20 Mbit/s · 1080p (Befund 3)
    eq(cap({ quality: 'orig', transcode: true, vcodec: 'hevc' }), '20000 1920x1080');
    eq(cap({ quality: 'orig', transcode: true, vcodec: 'mpeg2video' }), '20000 1920x1080');
    eq(cap({ quality: 'orig', transcode: true, vcodec: 'h264' }), '80000 3840x2160');
    eq(cap({ quality: '80', transcode: true, vcodec: 'hevc' }), '80000 3840x2160', 'eine gewaehlte Zahl gilt wie gewaehlt');
    C.hevc = { maxBitDepth: 10 };
    eq(cap({ quality: 'orig', transcode: true, vcodec: 'hevc' }), '80000 3840x2160', 'HEVC direkt und im HLS moeglich');
    C.hevcStream = false;
    eq(cap({ quality: 'orig', transcode: true, vcodec: 'hevc' }), '20000 1920x1080', 'HEVC nur Direct Play (Apple)');
  } finally { C.maxResolution = oldRes; C.hevc = false; delete C.hevcStream; }
  // eine Stufe geringer: am TV unveraendert, Original wandelt mit 20 um -> 12
  assert.strictEqual(N.osd.lower('orig', false), '12'); assert.strictEqual(N.osd.lower('20', false), '12'); assert.strictEqual(N.osd.lower('x', false), '8');
  assert.strictEqual(N.osd.lower('80', false), '12', '4K-Wert am TV = hoechste Stufe 20 -> 12');
  // alle Versionswahlen rechnen mit derselben Grenze (Befund 1)
  ['src/views/details.js', 'src/views/home.js', 'src/player/playback.js'].forEach(function (f) {
    var src = require('fs').readFileSync(require('path').join(__dirname, '..', f), 'utf8');
    assert.ok(src.indexOf('verLimit(') >= 0, f); assert.ok(!/decision\.QUAL\[/.test(src), f + ' rechnet die Grenze selbst');
  });
});
test('HEVC nur Direct Play (caps.codecs.hevcStream false, Apple): Direct Stream mit HEVC -> gleich Umwandlung mit hoechstens 20 Mbit/s', function () {
  var C = N.platform.caps.codecs, old = [C.hevc, C.maxResolution];
  function streamHevc() { var j = S('decision-hevc.json'), p = j.MediaContainer.Metadata[0].Media[0].Part[0]; p.decision = 'copy'; p.Stream[0].codec = 'hevc'; p.Stream[0].decision = 'copy'; return j; }
  try {
    C.hevc = { maxBitDepth: 10 }; C.maxResolution = '3840x2160'; C.hevcStream = false;
    var r = rig({ meta: 'meta-hevc.json' }), n = 0;
    r.deps.get = function (path, q, o, cb) { r.gets.push({ path: path, q: q }); cb(null, /decision/.test(path) ? (n++ ? S('decision-hevc.json') : streamHevc()) : S('meta-hevc.json')); };
    r.deps.cfg.quality = 'orig';
    r.p.start();
    var dec = r.gets.filter(function (g) { return /decision/.test(g.path); });
    assert.strictEqual(dec.length, 2, 'zweite Decision ohne Direct Stream');
    assert.strictEqual(dec[1].q.directPlay, 0); assert.strictEqual(dec[1].q.directStream, 0);
    T.tick(1000);
    var url = r.calls.filter(function (c) { return /^InitPlayer:/.test(c); })[0];
    assert.ok(/maxVideoBitrate=20000/.test(url) && /videoResolution=1920x1080/.test(url), url);
    // ohne hevcStream (HLS traegt HEVC): Direct Stream bleibt
    delete C.hevcStream;
    r = rig({ meta: 'meta-hevc.json' }); n = 0;
    r.deps.get = function (path, q, o, cb) { r.gets.push({ path: path, q: q }); cb(null, /decision/.test(path) ? streamHevc() : S('meta-hevc.json')); };
    r.p.start();
    assert.strictEqual(r.gets.filter(function (g) { return /decision/.test(g.path); }).length, 1);
  } finally { C.hevc = old[0]; C.maxResolution = old[1]; delete C.hevcStream; }
});
test('PLAY-38 Spurgrenze (TV-Test 04.11.: Player des TVs 2014 stuerzt beim Springen in Dateien mit 33+ Spuren ab): mehr als caps.codecs.maxTracks -> Direct Stream mit eigenem Grund; externe UT zaehlen nicht', function () {
  function metaN(n, ext) {
    var j = S('meta-direct.json'), part = j.MediaContainer.Metadata[0].Media[0].Part[0], base = part.Stream.length;
    for (var i = base; i < n; i++) part.Stream.push({ id: 9000 + i, streamType: 3, codec: 'srt', languageCode: 'ger', index: i });
    for (i = 0; i < (ext || 0); i++) part.Stream.push({ id: 9900 + i, streamType: 3, codec: 'srt', key: '/library/streams/' + (9900 + i) });
    return j;
  }
  var C = N.platform.caps.codecs, old = C.maxTracks;
  try {
    assert.strictEqual(old, 32, 'Standard (Orsay) = 32');
    var r = rig({ metaJson: metaN(33), off: 478000 });
    r.p.start();
    assert.strictEqual(r.p.meta.ntracks, 33);
    assert.strictEqual(r.gets[1].q.directPlay, 0, '33 Spuren -> kein Direct Play'); assert.strictEqual(r.gets[1].q.directStream, 1);
    r = rig({ metaJson: metaN(32, 5), off: 478000 });
    r.p.start();
    assert.strictEqual(r.p.meta.ntracks, 32, 'externe Untertitel zaehlen nicht');
    assert.strictEqual(r.gets[1].q.directPlay, 1, '32 Spuren -> Direct Play');
    C.maxTracks = 0;
    r = rig({ metaJson: metaN(40) }); r.p.start();
    assert.strictEqual(r.gets[1].q.directPlay, 1, '0 = keine Grenze (Apple)');
  } finally { C.maxTracks = old; }
  // Grund im INFO-Panel statt "Direkte Wiedergabe ist deaktiviert"
  r = rig({ metaJson: metaN(35), dec: 'decision-hevc.json' }); r.p.start();
  assert.ok(/35/.test(r.p.r.why) && /32/.test(r.p.r.why), r.p.r.why);
});
test('Protokoll: oeffentliche IPv4-Adressen geschwaerzt, Heimnetz-Adressen bleiben', function () {
  assert.strictEqual(N.diag.redact('InitPlayer http://203.0.113.7:32400/library/parts/1/file.mkv'), 'InitPlayer http://<fern>:32400/library/parts/1/file.mkv');
  assert.strictEqual(N.diag.redact('http://192.168.1.20:32400/x 10.0.0.5 172.16.3.4'), 'http://192.168.1.20:32400/x 10.0.0.5 172.16.3.4');
  assert.strictEqual(N.diag.redact('Version 1.43.5.11029'), 'Version 1.43.5.11029');
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
test('Player auf voller Flaeche (Apple Nr. 17): Bildschirm-Punkt -> Raster; TV und 16:9 unveraendert', function () {
  var O = N.osd, o = { x: 140, y: 120 }, H2 = 960;
  eq(O.fullPt(600, 485, { x: 0, y: 0 }, 720, ''), { x: 600, y: 485 });
  eq(O.fullPt(600, 485, null, 720, 'low'), { x: 600, y: 485 });
  eq(O.fullPt(80, 60, o, H2, ''), { x: 80, y: 60 }, 'Zurueck-Knopf oben links: an der Oberkante, ab dem linken Rand');
  eq(O.fullPt(740, 485 + 240, o, H2, ''), { x: 600, y: 485 }, 'Balken an der Unterkante (y + 2 * 120), waagerecht im Kasten');
  eq(O.fullPt(740, 300, o, H2, 'low'), { x: 600, y: 60 }, 'Ziehen: immer Bedien-Ebene');
  eq(O.fullPt(564, 520, o, H2, 'mid'), { x: 424, y: 400 }, 'Verbindung unterbrochen: mittig im Kasten');
  eq(O.fullPt(10, 479, o, H2, ''), { x: 10, y: 479 }); eq(O.fullPt(150, 480, o, H2, ''), { x: 10, y: 240 }, 'Grenze = Bildmitte');
});
test('Knopfreihe: sichtbare Knoepfe, ◀▶ ohne Umlauf, Zeiger-Treffer, Label-Mitte', function () {
  var O = N.osd, all = O.visible({ pn: 'ep', chap: true });
  eq(all, ['prev', 'back', 'pp', 'fwd', 'next', 'chap', 'tracks', 'more']);
  var film = O.visible({ pn: '', chap: false });
  eq(film, ['back', 'pp', 'fwd', 'tracks', 'more']);
  // Bild in Bild (caps.pip, PLAY-35): rechte Gruppe vor Kapitel, x 880 (64er Raster); ohne pip (TV) nie dabei
  var pip = O.visible({ pn: '', chap: true, pip: true });
  eq(pip, ['back', 'pp', 'fwd', 'pip', 'chap', 'tracks', 'more']);
  assert.strictEqual(O.nav(pip, 'fwd', 'RIGHT'), 'pip');
  assert.strictEqual(O.hit(pip, O.ISL_X + 880 + 24, O.ISL_Y + 104), 'pip');
  assert.strictEqual(O.hit(film, O.ISL_X + 880 + 24, O.ISL_Y + 104), null, 'ohne caps.pip kein Treffer');
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
  assert.strictEqual(O.hit(all, 504, 562), 'prev', '⏮ links aussen in der Mitte');
});
/* Nutzerauftrag 28.10.: Sprungweiten auf den Knoepfen, ⏮/⏭ je nach Inhalt */
test('Sprungweiten: Zahl oder "zurueck/vor", ungueltig -> Standard; Aufschrift mit ASCII-Vorzeichen', function () {
  var O = N.osd;
  eq(O.steps(15, 10), { b: 15, f: 15 });
  eq(O.steps('30', 10), { b: 30, f: 30 });
  eq(O.steps('10/30', 10), { b: 10, f: 30 });
  eq(O.steps(' 15 / 30 ', 10), { b: 15, f: 30 });
  eq(O.steps(undefined, 10), { b: 10, f: 10 });
  eq(O.steps('quatsch', 30), { b: 30, f: 30 });
  eq(O.steps('0/30', 30), { b: 30, f: 30 }, 'Null ist kein Sprung');
  eq(O.stepNums({ b: 10, f: 10 }), ['-10', '+10']);
  eq(O.stepNums({ b: 15, f: 30 }), ['-15', '+30']);
  assert.ok(!/\u2212/.test(O.stepNums({ b: 5, f: 5 }).join('')), 'kein U+2212 (fehlt in der TV-Schrift)');
});
test('Vorige/Naechste: Folgen -> Folgen, sonst Kapitel (ab 2), sonst Warteschlange, sonst ausgeblendet', function () {
  var O = N.osd;
  assert.strictEqual(O.pnMode({ type: 'episode', qLen: 5, chapters: 4 }), 'ep', 'Folge mit Kapiteln: trotzdem Folgen');
  assert.strictEqual(O.pnMode({ type: 'episode', qLen: 1, chapters: 4 }), '', 'Folge ohne Queue (noch nicht geladen/letzte allein): keine Knoepfe');
  assert.strictEqual(O.pnMode({ type: 'episode', qLen: 0, chapters: 0 }), '');
  assert.strictEqual(O.pnMode({ type: 'movie', qLen: 0, chapters: 6 }), 'chap');
  assert.strictEqual(O.pnMode({ type: 'movie', qLen: 3, chapters: 6 }), 'chap', 'Film mit Kapiteln in "Alle abspielen": Kapitel');
  assert.strictEqual(O.pnMode({ type: 'movie', qLen: 0, chapters: 1 }), '', 'ein Kapitel ist keins');
  assert.strictEqual(O.pnMode({ type: 'movie', qLen: 4, chapters: 0 }), 'item');
  assert.strictEqual(O.pnMode({ type: 'movie', qLen: 0, chapters: 0 }), '');
  // bedienbar: erste/letzte Folge gesperrt (gedimmt, kein Fokus/Treffer)
  eq(O.pnState({ mode: 'ep', qIdx: 0, qLen: 3 }), { prev: false, next: true });
  eq(O.pnState({ mode: 'ep', qIdx: 2, qLen: 3 }), { prev: true, next: false });
  var chs = [{ start: 0 }, { start: 60000 }, { start: 120000 }];
  eq(O.pnState({ mode: 'chap', chs: chs, ms: 70000 }), { prev: true, next: true });
  eq(O.pnState({ mode: 'chap', chs: chs, ms: 130000 }), { prev: true, next: false }, 'im letzten Kapitel kein ⏭');
  eq(O.pnState({ mode: '' }), { prev: false, next: false });
  var vis = O.visible({ pn: 'ep', chap: false });
  eq(O.usable(vis, { prev: false, next: true }), ['back', 'pp', 'fwd', 'next', 'tracks', 'more']);
  assert.strictEqual(O.nav(O.usable(vis, { prev: false, next: true }), 'back', 'LEFT'), 'back', '◀ landet nicht auf dem gesperrten ⏮');
  assert.strictEqual(O.hit(O.usable(vis, { prev: false, next: true }), 504, 562), null, 'gesperrter ⏮ nimmt keinen Klick');
  // Kapitel-Ziele: > 3 s im Kapitel -> dessen Anfang, sonst das vorige; erstes Kapitel -> Anfang; ⏭ im letzten -> -1
  assert.strictEqual(O.prevChapter(chs, 70000), 60000);
  assert.strictEqual(O.prevChapter(chs, 62000), 0);
  assert.strictEqual(O.prevChapter(chs, 1000), 0);
  assert.strictEqual(O.nextChapter(chs, 70000), 120000);
  assert.strictEqual(O.nextChapter(chs, 130000), -1);
  // TV-Test 28.10.: Sprung landet bis ~1,5 s vor dem Kapitelanfang -> zaehlt schon als dieses Kapitel
  assert.strictEqual(O.prevChapter(chs, 58500), 0, '⏮ knapp vor Kapitel 2 -> Kapitel 1, nicht noch eins weiter');
  assert.strictEqual(O.nextChapter(chs, 58500), 120000, '⏭ knapp vor Kapitel 2 -> Kapitel 3, nicht Kapitel 2 erneut');
  // Labels je Modus, in beiden Sprachen vorhanden
  ['ep', 'chap', 'item'].forEach(function (m) { ['prev', 'next'].forEach(function (id) {
    var k = O.pnLabel(m, id);
    assert.ok(N.t(k) !== k && N.t(k).length <= 20, k + ' vorhanden und kurz');
  }); });
  assert.strictEqual(N.t(O.pnLabel('ep', 'next')), N.i18n.lang() === 'de' ? 'Nächste Folge' : 'Next episode');
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
  assert.strictEqual(O.more(st)[0].s, N.t('set.v.qOrig'));
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

test('Pause: Uhr und "Ende um" einmal je Minute, kurz nach der Minutengrenze (TV-Test 29.10.: standen still)', function () {
  var O = N.osd;
  assert.strictEqual(O.minuteWait(new Date(2026, 9, 29, 8, 4, 0, 0)), 60050);
  assert.strictEqual(O.minuteWait(new Date(2026, 9, 29, 8, 4, 59, 900)), 150);
  assert.strictEqual(O.minuteWait(new Date(2026, 9, 29, 8, 4, 30, 0)), 30050);
});

test('Schmaler Player (Apple Nr. 17, 10-screens 7): N.osd.narrow – Video 16:9 oben (K) bzw. mittig (M), Insel darunter/unten, Knoepfe in zwei Reihen', function () {
  var O = N.osd, k = O.narrow(546, 942, false), m = O.narrow(836, 1222, true);
  eq([k.VY, k.VW, k.VH, k.ISY, k.ISW, k.BAR_X, k.BAR_W, k.BAR_Y], [184, 546, 307, 507, 498, 56, 434, 534], 'iPhone hoch: Titel, Video, Insel untereinander');
  assert.ok(m.VY > 184 && m.ISY + m.ISH <= 1222 - 32 && m.ISY >= m.VY + m.VH + 16, 'iPad hoch: Video mittig, Insel am unteren Rand');
  // Reihe 1 = Mitte der TV-Reihe (Play mittig), Reihe 2 = rechte Gruppe mittig ueber die sichtbaren Knoepfe
  assert.strictEqual(O.center('pp', k.osd), 24 + 249);
  O.narrowRow(k, ['back', 'pp', 'fwd', 'tracks', 'more']);
  eq([k.osd.by.tracks.x, k.osd.by.more.x, k.osd.by.more.y], [249 - 56, 249 + 8, 148]);
  assert.strictEqual(O.hit(['back', 'pp', 'fwd', 'tracks', 'more'], 24 + 249 + 8 + 10, 507 + 160, k.osd), 'more');
  assert.strictEqual(O.hit(['back', 'pp', 'fwd'], 24 + 249, 507 + 100, k.osd), 'pp');
  assert.strictEqual(O.hit(['back', 'pp', 'fwd'], 640, 458 + 100), 'pp', 'ohne Lage: TV-Raster unveraendert');
  // Karten: unten rechts im Video, wenn unter der Insel kein Platz ist, sonst darunter
  assert.strictEqual(k.CBY, k.VY + k.VH - 72);
  var p = O.narrow(586, 1132, false);
  assert.strictEqual(p.CBY, p.ISY + 276 + 16 + 168);
  // sichere Raender (iPhone hoch: Dynamic Island 91, unten 50; Duo aussen: rechts 122): Zurueck/Uhr und Inseln darin, Video volle Breite
  var q = O.narrow(586, 1272, false, { t: 91, r: 0, b: 50, l: 0 }), d = O.narrow(678, 986, false, { t: 0, r: 122, b: 50, l: 0 });
  assert.deepStrictEqual([q.TY, q.TX, q.VW, q.VY], [91 + 16, 24, 586, 91 + 16 + 168]);
  assert.deepStrictEqual([d.TX + d.TW, d.ISX + d.ISW, d.SKX1, d.VW, d.SR], [678 - 122 - 24, 678 - 122 - 24, 678 - 122 - 24, 678, 122]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(O.narrow(586, 1132, false, null))), JSON.parse(JSON.stringify(O.narrow(586, 1132, false))));
});
