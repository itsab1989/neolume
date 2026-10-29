'use strict';
/* Schnellspulen (SPEC PLAY-32): Skala N.trick und Zustandsmaschine in N.Playback mit einem gefaelschten SEF, das
 * SetPlaybackSpeed annimmt oder (fuer einzelne Stufen) ablehnt. Keine echten Sitzungen, kuenstliche Zeit. */
var test = require('node:test'), assert = require('node:assert');
var H = require('./helpers/load'), S = H.synthetic, eq = H.eq;
var ctx = H.load({ fakeTimers: true }), N = ctx.N, T = ctx.timers;
N.log = function () {};
var TK = N.trick;

test('Stufen: Standard 2/4/8/16, config-Liste gefiltert (Vielfache von 2, 2…64, sortiert, ohne Doppel)', function () {
  eq(TK.speeds(), [2, 4, 8, 16]);
  eq(TK.speeds([32, 2, 8, 4, 16, 16, -8, 3, 1, 0, 128, 'x']), [2, 4, 8, 16, 32]);
  eq(TK.speeds([3, 5]), [2, 4, 8, 16], 'nichts Gueltiges -> Standard');
  eq(TK.speeds('2,4,8,32'), [2, 4, 8, 16], 'Text statt Liste: sauber abgelehnt (Audit 1.0.6)');
  eq(TK.speeds(['32', '8']), [2, 4, 8, 16], 'Texte in der Liste zaehlen nicht');
  var c2 = H.load(); c2.N.config.apply({ trickSpeeds: '2,4,8' }); assert.strictEqual(c2.N.config.trickSpeeds, undefined, 'config.json: nur eine Liste');
  c2.N.config.apply({ trickSpeeds: [2, 32] }); eq(c2.N.config.trickSpeeds, [2, 32]);
  eq(TK.scale([2, 4, 8, 16]), [-16, -8, -4, -2, 1, 2, 4, 8, 16]);
  eq(TK.scale([2, 4, 8, 16], { f: 8, b: 0 }), [1, 2, 4, 8]);
});

test('Skala: FF eine Stufe rechts, RW eine links (ueber 1x hinweg), Anschlag bleibt', function () {
  var sp = TK.DEF, s = 1, seq = [];
  [1, 1, 1, 1, 1].forEach(function (d) { s = TK.next(s, d, sp); seq.push(s); });
  eq(seq, [2, 4, 8, 16, 16], 'FF verdoppelt bis 16, dann Anschlag');
  seq = [];
  [-1, -1, -1, -1, -1, -1, -1, -1, -1].forEach(function (d) { s = TK.next(s, d, sp); seq.push(s); });
  eq(seq, [8, 4, 2, 1, -2, -4, -8, -16, -16], 'RW wird langsamer, ueber normal ins Rueckwaerts');
  assert.strictEqual(TK.next(-4, 1, sp), -2, 'FF beim Rueckspulen: langsamer');
  assert.strictEqual(TK.next(7, 1, sp), 2, 'unbekannte Stufe zaehlt als 1x');
  assert.strictEqual(TK.below(sp, 32), 16); assert.strictEqual(TK.below(sp, -4), 2); assert.strictEqual(TK.below(sp, 2), 0);
  assert.strictEqual(TK.label(-8), '8×');
});

test('Raender: Anfang beim Rueckspulen (naechster Takt laege vor 0), Ende beim Vorspulen', function () {
  assert.strictEqual(TK.edge(-16, 9000, 0), 'start', '16x zurueck: 9,6 s Vorlauf');
  assert.strictEqual(TK.edge(-16, 12000, 0), '');
  assert.strictEqual(TK.edge(-2, 900, 0), 'start', 'mindestens 1 s');
  assert.strictEqual(TK.edge(8, 3596000, 3600000), 'end');
  assert.strictEqual(TK.edge(8, 3500000, 3600000), '');
  assert.strictEqual(TK.edge(4, 100000, 0), '', 'ohne Dauer kein Ende');
  assert.strictEqual(TK.edge(1, 0, 0), '');
});

/* ---------- Zustandsmaschine in N.Playback ---------- */
function rig(opts) {
  opts = opts || {};
  var calls = [], writes = [], ev = [];
  var sef = { exec: function (n, a) {
    calls.push(a === undefined ? n : n + ':' + a);
    if (n === 'SetPlaybackSpeed' && opts.refuse && opts.refuse.indexOf(Number(a)) >= 0) return -1;
    return 1;
  } };
  var deps = {
    sef: sef, base: 'http://pms', token: 'TOK', clientId: 'CID', threshold: 0.9,
    timers: { now: T.now, set: T.setTimeout, clear: T.clearTimeout },
    cfg: { directPlay: true, quality: '12', ass: 'burn', audioLang: 'server', subs: 'server', subLang: 'de', anime: false, rememberTracks: false },
    get: function (path, q, o, cb) { cb(null, /decision/.test(path) ? S(opts.dec || 'decision-direct.json') : S(opts.meta || 'meta-direct.json')); },
    write: function (m, path, q, cb) { writes.push(path + (q.state ? ' ' + q.state + ' ' + q.time : '')); cb(null, ''); }
  };
  var p = new N.Playback(deps, { rk: '2345', off: 0 });
  p.on(function (e, d) { if (e === 'speed' || e === 'trickEdge' || e === 'state') ev.push(e + ':' + d); });
  return { p: p, calls: calls, writes: writes, ev: ev,
    speeds: function () { return calls.filter(function (c) { return /^SetPlaybackSpeed/.test(c); }).map(function (c) { return Number(c.split(':')[1]); }); } };
}
function playing(r, ms) { r.p.start(); r.p.onEvent(9); r.p.onEvent(14, ms || 600000); assert.strictEqual(r.p.state, 'playing'); }

test('Direct Play: FF 2-4-8-16, RW zurueck ueber 1x ins Rueckwaerts, PLAY/OK = normal (SetPlaybackSpeed 1)', function () {
  var r = rig(), p = r.p;
  playing(r);
  [1, 1, 1, 1].forEach(function (d) { p.trick(d); });
  assert.strictEqual(p.speed, 16);
  eq(p.trick(1), { ok: true, speed: 16, why: 'max' });
  [-1, -1, -1, -1, -1].forEach(function (d) { p.trick(d); });
  assert.strictEqual(p.speed, -2);
  eq(r.speeds(), [2, 4, 8, 16, 8, 4, 2, 1, -2]);
  assert.strictEqual(p.state, 'playing', 'Zustand bleibt playing (Timeline meldet spielend)');
  assert.ok(p.normal()); assert.strictEqual(p.speed, 1);
  assert.strictEqual(r.speeds().pop(), 1);
  assert.ok(!p.normal(), 'schon normal: nichts zu tun');
  assert.ok(r.ev.indexOf('speed:-2') >= 0 && r.ev[r.ev.length - 1] === 'speed:1');
});

test('Umgewandelt (HLS): kein Trick-Modus, Ansicht springt stattdessen; laedt noch: state', function () {
  var r = rig({ meta: 'meta-hevc.json', dec: 'decision-hevc.json' }), p = r.p;
  p.start(); T.tick(1000); p.onEvent(14, 60000);
  eq(p.trick(1), { ok: false, speed: 1, why: 'hls' });
  eq(r.speeds(), []);
  r = rig(); r.p.start();                                // Direct Play, aber noch kein Bild (buffering)
  assert.strictEqual(r.p.trick(1).why, 'state');
});

test('SEF lehnt eine Stufe ab: erst die zweite Ablehnung kappt die Skala (Audit 1.0.6), bisherige bleibt; erste Stufe 2x abgelehnt -> off', function () {
  var r = rig({ refuse: [16] }), p = r.p;
  playing(r);
  p.trick(1); p.trick(1); p.trick(1);
  assert.strictEqual(p.speed, 8);
  eq(p.trick(1), { ok: false, speed: 8, why: 'retry' }, 'erste Ablehnung: nichts gekappt');
  eq(p.trick(1), { ok: false, speed: 8, why: 'refused' }, 'zweite Ablehnung: gekappt');
  assert.strictEqual(p.speed, 8, 'bleibt bei 8x');
  eq(p.trick(1), { ok: true, speed: 8, why: 'max' }, '16 wird nicht erneut versucht');
  assert.strictEqual(r.speeds().filter(function (s) { return s === 16; }).length, 2);
  r = rig({ refuse: [2, -2] }); p = r.p;
  playing(r);
  eq(p.trick(1), { ok: false, speed: 1, why: 'retry' }, 'erster Druck: Ansicht springt, nichts gekappt');
  eq(p.trick(1), { ok: false, speed: 1, why: 'off' });
  eq(p.trick(1), { ok: false, speed: 1, why: 'off' }, 'danach kein neuer Versuch');
  eq(p.trick(-1), { ok: false, speed: 1, why: 'retry' });
  eq(p.trick(-1), { ok: false, speed: 1, why: 'off' });
  eq(r.speeds(), [2, 2, -2, -2]);
});

test('Ende-Ereignis beim Rueckspulen = Anfang (kein Gesehen, kein Autoplay): 1x, neu ab 0:00 (Audit 1.0.6)', function () {
  var r = rig(), p = r.p, ended = 0;
  playing(r, 60000);
  p.on(function (e) { if (e === 'ended') ended++; });
  p.trick(-1); p.trick(-1);
  p.onEvent(8);
  assert.strictEqual(ended, 0); assert.notStrictEqual(p.state, 'ended');
  assert.strictEqual(p.speed, 1); assert.strictEqual(p.t, 0);
  assert.ok(r.ev.indexOf('trickEdge:start') >= 0);
  assert.ok(!r.writes.some(function (w) { return /scrobble/.test(w); }), 'kein Gesehen');
});

test('TV-Test 29.10.: aus -16x bis 0:00, SEF-Ende-Ereignis kommt 1,1 s NACH dem Ruecksetzen auf 1x -> Anfang, kein Ende/Gesehen', function () {
  var r = rig(), p = r.p, ended = 0;
  playing(r, 600000);
  p.on(function (e) { if (e === 'ended') ended++; });
  [-1, -1, -1, -1].forEach(function (d) { p.trick(d); });
  assert.strictEqual(p.speed, -16);
  p.onEvent(14, 5613);                                    // "Schnellspulen am Anfang 5613"
  assert.strictEqual(p.speed, 1);
  assert.ok(r.calls.indexOf('JumpBackward:5') >= 0, 'abgerundet: nie vor 0:00 springen (vorher JumpBackward 6)');
  assert.ok(r.calls.indexOf('JumpBackward:6') < 0);
  var stops = r.calls.filter(function (c) { return c === 'Stop'; }).length;
  T.tick(1100);
  p.onEvent(8);                                           // spaetes RENDERING_COMPLETE
  assert.strictEqual(ended, 0); assert.notStrictEqual(p.state, 'ended');
  assert.ok(!r.writes.some(function (w) { return /scrobble/.test(w); }), 'kein Gesehen');
  assert.ok(!r.writes.some(function (w) { return / stopped /.test(w); }), 'keine Stopp-Timeline');
  assert.strictEqual(r.calls.filter(function (c) { return c === 'Stop'; }).length, stops + 1, 'nur der Stop des Neustarts ab 0:00');
  assert.strictEqual(p.t, 0);
  // nach der Schonfrist ist ein Ende wieder ein Ende
  r = rig(); p = r.p; ended = 0; playing(r, 600000);
  p.on(function (e) { if (e === 'ended') ended++; });
  p.trick(-1); p.onEvent(14, 800);
  T.tick(5000);
  p.onEvent(8);
  assert.strictEqual(p.state, 'ended');
});

test('Schonfrist gilt nicht am echten Ende: Rueckspulen kurz vor Schluss, dann Ende-Ereignis = Ende', function () {
  var r = rig(), p = r.p, dur;
  playing(r, 60000); dur = p.dur();
  p.onEvent(14, dur - 3000);
  p.trick(-1); p.normal();                                // kurz zurueck, gleich wieder normal
  T.tick(1000);
  p.onEvent(14, dur - 2000);
  p.onEvent(8);
  assert.strictEqual(p.state, 'ended');
});

test('Sprung rueckwaerts nie ueber 0:00 hinaus; unter 1 s: kein Sprung, Anzeige 0', function () {
  var r = rig(), p = r.p;
  playing(r, 2600);
  p.seek(0);
  assert.ok(r.calls.indexOf('JumpBackward:2') >= 0, '2,6 s -> 2 s (nicht 3)');
  r = rig(); p = r.p; playing(r, 800);
  p.seek(0);
  assert.ok(!r.calls.some(function (c) { return /^JumpBackward/.test(c); }));
  assert.strictEqual(p.t, 0);
});

test('Restzeit passt zur abgelaufenen Zeit: beide ganze Sekunden, zusammen = Laenge', function () {
  var F = N.fmt;
  assert.strictEqual(F.hms(1500) + ' ' + F.left(1500, 2400), '0:01 0:01', '1,5 s von 2,4 s: 0:01 + 0:01 = 0:02 (vorher 0:01 + 0:00)');
  assert.strictEqual(F.left(59500, 3600900), '59:01');
  assert.strictEqual(F.hms(59500), '0:59');
  assert.strictEqual(F.left(0, 0), '0:00');
});

test('Pause, Sprung, Stop beenden das Spulen sauber; aus der Pause heraus erst Resume', function () {
  var r = rig(), p = r.p;
  playing(r);
  p.trick(1); p.trick(1);
  p.pause();
  assert.strictEqual(p.speed, 1); assert.strictEqual(p.state, 'paused');
  var i = r.calls.indexOf('SetPlaybackSpeed:1');
  assert.ok(i >= 0 && r.calls[i + 1] === 'Pause', 'erst 1x, dann Pause');
  p.trick(1);
  assert.strictEqual(p.state, 'playing'); assert.strictEqual(p.speed, 2);
  assert.ok(r.calls.indexOf('Resume') < r.calls.lastIndexOf('SetPlaybackSpeed:2'), 'Resume vor dem Spulen');
  p.onEvent(14, 700000);
  p.seek(900000);
  assert.strictEqual(p.speed, 1);
  assert.ok(r.calls.lastIndexOf('SetPlaybackSpeed:1') < r.calls.lastIndexOf('JumpForward:200'), 'erst normal, dann springen');
  p.trick(-1);
  assert.strictEqual(p.speed, -2);
  p.stop('user');
  assert.strictEqual(p.speed, 1);
  assert.strictEqual(r.ev[r.ev.length - 1], 'speed:1');
  assert.ok(r.writes.indexOf('/:/timeline stopped 900000') >= 0, 'Fortschritt an der Spul-Stelle gespeichert');
});

test('Rueckspulen bis zum Anfang: 1x ab 0:00 (Sprung auf 0), Timeline meldet 0', function () {
  var r = rig(), p = r.p;
  playing(r, 60000);
  p.trick(-1); p.trick(-1); p.trick(-1);                 // -8x
  p.onEvent(14, 30000);
  assert.strictEqual(p.speed, -8);
  p.onEvent(14, 4000);                                    // naechster Takt laege vor 0
  assert.strictEqual(p.speed, 1);
  assert.strictEqual(p.t, 0);
  assert.ok(r.calls.indexOf('JumpBackward:4') >= 0);
  assert.ok(r.ev.indexOf('trickEdge:start') >= 0);
  assert.strictEqual(r.writes[r.writes.length - 1], '/:/timeline playing 0');
});

test('Vorspulen bis kurz vor das Ende: 1x, das Ende laeuft normal (RENDERING_COMPLETE -> ended)', function () {
  var r = rig(), p = r.p, dur;
  playing(r, 60000);
  dur = p.dur(); assert.ok(dur > 0);
  p.trick(1); p.trick(1); p.trick(1);                     // 8x
  p.onEvent(14, dur - 4000);
  assert.strictEqual(p.speed, 1);
  assert.ok(r.ev.indexOf('trickEdge:end') >= 0);
  p.onEvent(8);
  assert.strictEqual(p.state, 'ended');
  r = rig(); p = r.p; playing(r, 60000);
  p.trick(1);
  p.onEvent(8);                                           // SEF meldet das Ende schon im Trick-Modus
  assert.strictEqual(p.state, 'ended'); assert.strictEqual(p.speed, 1);
});

test('SEF-Ereignisse im Trick-Modus: Puffern aendert den Zustand nicht, keine Untertitel; Timeline alle 10 s mit Position', function () {
  var r = rig(), p = r.p;
  playing(r);
  p.subMode = 'sef'; p.sub = { idx: 1 };
  var subs = 0; p.on(function (e) { if (e === 'sub') subs++; });
  p.trick(1); p.trick(1);
  p.onEvent(11); p.onEvent(13, 40);
  assert.strictEqual(p.state, 'playing');
  p.onEvent(19, 'Hallo');
  assert.strictEqual(subs, 0);
  p.onEvent(14, 640000);
  var n = r.writes.length;
  T.tick(10000);
  assert.ok(r.writes.slice(n).indexOf('/:/timeline playing 640000') >= 0);
  p.normal();
  p.onEvent(19, 'Hallo');
  assert.strictEqual(subs, 1, 'nach dem Spulen wieder Untertitel');
});

test('Renderfehler beim Spulen: Rueckfall startet neu mit 1x', function () {
  var r = rig(), p = r.p;
  playing(r);
  p.trick(1);
  p.onEvent(6, 2);
  assert.strictEqual(p.speed, 1);
  assert.strictEqual(r.ev.filter(function (e) { return e === 'speed:1'; }).length, 1);
});

test('Faelschung des SEF (Vorschau/Bildtests) kennt SetPlaybackSpeed: Zeit laeuft mit der Geschwindigkeit, nie unter 0', function () {
  var got = [], f = N.sef.create(function (t, d) { if (t === 14) got.push(d); });
  assert.ok(f.fake);
  f.exec('InitPlayer', 'x'); f.exec('StartPlayback', 10);
  T.tick(60); T.tick(500);
  f.exec('SetPlaybackSpeed', 8); T.tick(500);
  f.exec('SetPlaybackSpeed', -16); T.tick(500); T.tick(500);
  var a = got.slice(-4);
  eq([a[1] - a[0], a[3]], [4000, 0]);
  N.sef.close();
});
