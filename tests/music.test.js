'use strict';
/* M4 Musik & Hoerbuecher: Normalisieren, Hoerbuch-Fortsetzen, Kapitel, Warteschlange, Ton-Decision/Rueckfall (N.AudioCore mit
 * Faelschungen – keine echten Anfragen, keine Timeline/Scrobble an einen Server), Musik-Sortierungen, Quadrat-Raster. */
var test = require('node:test'), assert = require('node:assert');
var H = require('./helpers/load');
var ctx = H.load({ fakeTimers: true }), N = ctx.N, MU = N.music;
N.i18n.set('de');
N.config.product = 'Neolume'; N.config.version = '0';

function tr(o) { return U(o, { rk: '1', type: 'track', title: 't', dur: 600000, off: 0, vc: 0, lv: 0, chs: 0 }); }
function U(a, b) { for (var k in a) b[k] = a[k]; return b; }

test('Track: Titel aus dem Dateinamen, Album- vor Kuenstlerbild, fehlende Media', function () {
  var t = MU.track({ ratingKey: 7, title: '', parentTitle: 'A', grandparentTitle: 'K', parentThumb: '/p', grandparentThumb: '/g', duration: 1000,
    Media: [{ Part: [{ file: '/media/x/03 - Küßchenlied.mp3' }] }] });
  assert.strictEqual(t.title, 'Küßchenlied'); assert.strictEqual(t.thumb, '/p'); assert.strictEqual(t.artist, 'K');
  var u = MU.track({ ratingKey: 8, title: 'Ohne Media', grandparentThumb: '/g' });
  assert.strictEqual(u.dur, 0); assert.strictEqual(u.thumb, '/g'); assert.strictEqual(u.codec, '');
  assert.strictEqual(MU.fileTitle('/a/01. Intro.flac'), 'Intro');
  assert.strictEqual(MU.fileTitle('/a/2001.mp3'), '2001');          // nur Zahl bleibt stehen
});

test('Hoerbuch fortsetzen: juengster Track mit Offset, gehoert -> naechster, alles gehoert, neu', function () {
  var a = [tr({ rk: 'a', vc: 1, lv: 100 }), tr({ rk: 'b', off: 125000, lv: 200 }), tr({ rk: 'c' })];
  H.eq(MU.resume(a), { i: 1, off: 125000, state: 'resume' });
  var b = [tr({ rk: 'a', vc: 1, lv: 100 }), tr({ rk: 'b', vc: 1, lv: 300 }), tr({ rk: 'c' })];
  H.eq(MU.resume(b), { i: 2, off: 0, state: 'next' });
  var c = [tr({ vc: 1, lv: 1 }), tr({ vc: 2, lv: 5 })];
  H.eq(MU.resume(c), { i: 0, off: 0, state: 'done' });
  H.eq(MU.resume([tr({}), tr({})]), { i: 0, off: 0, state: 'new' });
  // Offset und viewCount zugleich (zweiter Durchgang) -> Offset zaehlt; Offset kurz vor Ende -> naechster
  H.eq(MU.resume([tr({ vc: 2, off: 625000, lv: 9, dur: 4789655 })]), { i: 0, off: 625000, state: 'resume' });
  H.eq(MU.resume([tr({ off: 595000, lv: 9 }), tr({ rk: 'z' })]), { i: 1, off: 0, state: 'next' });
  // Offset ohne lastViewedAt (alter Stand) wird trotzdem gefunden
  H.eq(MU.resume([tr({}), tr({ off: 5000 })]), { i: 1, off: 5000, state: 'resume' });
  var p = MU.progress(a, MU.resume(a));
  H.eq(p, { pos: 725000, total: 1800000, frac: 725000 / 1800000, left: 1075000 });
  assert.strictEqual(MU.rewind(60000, 1000, 1000 + 3601), 55000);
  assert.strictEqual(MU.rewind(60000, 1000, 1000 + 60), 60000);
});

test('Hoerbuch-Zurueckspulen: Pause gegen die Server-Uhr (N.clock), nicht die TV-Uhr', function () {
  var N2 = H.load().N, M2 = N2.music, C = N2.clock, t = { now: 0 };
  N2.util.now = function () { return t.now; };
  C._reset();
  var SRV = Date.UTC(2026, 9, 27, 15, 0, 0), lv = SRV / 1000 - 600;   // vor 10 min (Serverzeit) zuletzt gehoert
  t.now = SRV - 3 * 3600 * 1000;                                     // TV-Uhr geht 3 h nach (Orsay ohne Sendezeit)
  // ohne Korrektur: TV-Uhr liegt VOR lastViewedAt -> kein Zurueckspulen; mit falscher Vorgabe +3 h waere es eins
  assert.strictEqual(M2.rewind(60000, lv), 60000);
  for (var i = 0; i < 3; i++) { assert.ok(C.sample(new Date(SRV + i * 1000).toUTCString(), t.now - 50, t.now + 50)); t.now += 1000; }
  assert.ok(Math.abs(C.offset() - 3 * 3600 * 1000) < 5000);
  assert.strictEqual(M2.rewind(60000, lv), 60000);                   // Server: 10 min Pause -> bleibt
  t.now += 3600 * 1000;                                              // 1 h spaeter (beide Uhren laufen gleich)
  assert.strictEqual(M2.rewind(60000, lv), 55000);                   // > 1 h nach Serverzeit -> 5 s zurueck
  // TV-Uhr 3 h VOR: ohne Korrektur faelschlich zurueckgespult, mit Korrektur nicht
  C._reset(); t.now = SRV + 3 * 3600 * 1000;
  assert.strictEqual(M2.rewind(60000, lv), 55000);
  for (i = 0; i < 3; i++) { C.sample(new Date(SRV + i * 1000).toUTCString(), t.now - 50, t.now + 50); t.now += 1000; }
  assert.strictEqual(M2.rewind(60000, lv), 60000);
});

test('Kapitel: Namen saeubern, eingebettete (M4B) vs. Tracks, Kapitel zur Zeit', function () {
  assert.strictEqual(MU.chapterName('01 Begrüßung.mp3', 0), 'Begrüßung');
  assert.strictEqual(MU.chapterName('Kapitel 01', 4), 'Kapitel 5');
  assert.strictEqual(MU.chapterName('', 1), 'Kapitel 2');
  assert.strictEqual(MU.chapterName('07', 6), 'Kapitel 7');
  var chs = MU.chapters([{ tag: '02 Was ist Social Media?.mp3', index: 2, startTimeOffset: 317753, endTimeOffset: 672939 },
    { tag: '01 Begrüßung.mp3', index: 1, startTimeOffset: 0, endTimeOffset: 317753 }]);
  H.eq(chs.map(function (c) { return c.t; }), ['Begrüßung', 'Was ist Social Media?']);
  var one = [tr({ dur: 700000 })];
  var bc = MU.bookChapters(one, chs);
  assert.strictEqual(bc.kind, 'embedded');
  H.eq(bc.list[1], { t: 'Was ist Social Media?', start: 317753, dur: 355186, ti: 0 });
  assert.strictEqual(MU.bookChapters([tr({}), tr({ title: 'Zwei' })], chs).kind, 'tracks');
  assert.strictEqual(N.osd.chapterAt(chs, 400000), 1);
});

test('Weiterhoeren: je Buch nur der juengste angefangene Track', function () {
  var l = [tr({ rk: '1', albumRk: 'A', off: 5 }), tr({ rk: '2', albumRk: 'A', off: 6 }), tr({ rk: '3', albumRk: 'B', off: 7 }), tr({ rk: '4', albumRk: '', off: 8 })];
  H.eq(MU.continueList(l, 12).map(function (t) { return t.rk; }), ['1', '3', '4']);
  assert.ok(MU.trackProgress(tr({ off: 300000, dur: 600000 })) === 0.5);
  assert.strictEqual(N.model.progress(tr({ off: 300000, dur: 600000 })), 0.5);
});

test('Warteschlange: weiter/zurueck, Wiederholen, Zufall mit aktuellem Titel vorn, Einfuegen', function () {
  var q = new MU.Queue(['a', 'b', 'c', 'd'], 1);
  assert.strictEqual(q.cur(), 'b'); assert.strictEqual(q.nextPos(true), 2);
  q.go(3); assert.strictEqual(q.nextPos(true), -1);
  q.cycleRepeat(); assert.strictEqual(q.repeat, 'all'); assert.strictEqual(q.nextPos(true), 0);
  q.cycleRepeat(); assert.strictEqual(q.repeat, 'one'); assert.strictEqual(q.nextPos(true), 3); assert.strictEqual(q.nextPos(false), 0);
  q.cycleRepeat(); assert.strictEqual(q.repeat, 'off');
  q.go(0); assert.strictEqual(q.prevPos(), 0);
  q.go(2);
  var seq = [0.1, 0.9, 0.5], k = 0;
  q.setShuffle(true, function () { return seq[k++ % 3]; });
  assert.strictEqual(q.pos, 0); assert.strictEqual(q.cur(), 'c');
  H.eq(q.list().slice().sort(), ['a', 'b', 'c', 'd']);
  q.setShuffle(false); assert.strictEqual(q.cur(), 'c'); assert.strictEqual(q.pos, 2);
  q.insert(['x'], true); H.eq(q.list(), ['a', 'b', 'c', 'x', 'd']);
  q.insert(['y'], false); assert.strictEqual(q.list()[5], 'y');
});

/* ---------- Ton-Ablauf mit Faelschungen ---------- */
function rig(decide) {
  var calls = [], gets = [], writes = [], T = ctx.timers;
  var core = new N.AudioCore({
    sef: { exec: function () { calls.push(Array.prototype.slice.call(arguments)); return 1; } },
    base: 'http://192.0.2.1:32400', token: 'TOK', clientId: 'cid', threshold: 0.9, cfg: {},
    timers: { now: T.now, set: function (f, ms) { return T.setTimeout(f, ms); }, clear: function (t) { T.clearTimeout(t); } },
    rnd: function () { return 0.3; },
    get: function (path, q, o, cb) { gets.push({ path: path, q: q }); var r = decide(path, q); T.setTimeout(function () { cb(r.err || null, r.json); }, 1); return { abort: function () {} }; },
    write: function (m, path, q, cb) { writes.push({ m: m, path: path, q: q }); cb(null, null); }
  });
  return { core: core, calls: calls, gets: gets, writes: writes };
}
var DIRECT = { json: { MediaContainer: { generalDecisionCode: 1000, Metadata: [{ Media: [{ Part: [{ decision: 'directplay', key: '/library/parts/5/1/file.mp3', Stream: [{ streamType: 2, decision: 'directplay' }] }] }] }] } } };
var TRANS = { json: { MediaContainer: { generalDecisionCode: 1001, Metadata: [{ Media: [{ Part: [{ decision: 'transcode', Stream: [{ streamType: 2, decision: 'transcode' }] }] }] }] } } };

test('Ton: Decision ohne Bitrate, Direct Play = Datei-URL, SEF mit exakten Argumenten', function () {
  var r = rig(function () { return DIRECT; });
  r.core.play([tr({ rk: '11065', dur: 58122 })], 0, {});
  ctx.timers.tick(5);
  var g = r.gets[0];
  assert.strictEqual(g.path, '/music/:/transcode/universal/decision');
  assert.strictEqual(g.q.protocol, 'http'); assert.strictEqual(g.q.directPlay, 1); assert.strictEqual(g.q.path, '/library/metadata/11065');
  assert.ok(!('musicBitrate' in g.q) && !('maxAudioBitrate' in g.q) && !('maxVideoBitrate' in g.q));   // B4
  var init = r.calls.filter(function (c) { return c[0] === 'InitPlayer'; })[0];
  assert.strictEqual(init.length, 2);
  assert.ok(/^http:\/\/192\.0\.2\.1:32400\/library\/parts\/5\/1\/file\.mp3\?X-Plex-Token=TOK/.test(init[1]));
  assert.ok(init[1].indexOf('COMPONENT') < 0);
  H.eq(r.calls.filter(function (c) { return c[0] === 'SetDisplayArea'; })[0], ['SetDisplayArea', 0, 0, 0, 0, 720, 1]);
  H.eq(r.calls.filter(function (c) { return c[0] === 'StartPlayback'; })[0], ['StartPlayback', 0]);
  r.core.stop('test');
});

test('Ton: Renderfehler -> Umwandlung start.mp3 an der Stelle (offset), Zeitbasis relativ', function () {
  var n = 0, r = rig(function (p, q) { n++; return q.directPlay ? DIRECT : TRANS; });
  r.core.play([tr({ rk: '42', dur: 600000 })], 0, { off: 90000 });
  ctx.timers.tick(5);
  r.core.onEvent(14, 91000); r.core.onEvent(6, 6);
  ctx.timers.tick(5);
  var g = r.gets[r.gets.length - 1];
  assert.strictEqual(g.q.directPlay, 0); assert.strictEqual(g.q.directStream, 0);
  var inits = r.calls.filter(function (c) { return c[0] === 'InitPlayer'; }), url = inits[inits.length - 1][1];
  assert.ok(/\/music\/:\/transcode\/universal\/start\.mp3\?/.test(url));
  assert.ok(/[?&]offset=91(&|$)/.test(url) && /protocol=http/.test(url) && /directPlay=0/.test(url));
  assert.ok(!/Bitrate/i.test(url));
  var sp = r.calls.filter(function (c) { return c[0] === 'StartPlayback'; });
  H.eq(sp[sp.length - 1], ['StartPlayback', 0]);
  r.core.onEvent(14, 2000);                                  // SEF zaehlt ab 0 -> + offset
  assert.strictEqual(r.core.t, 93000);
  r.core.pause();
  ctx.timers.tick(10000);
  assert.ok(r.writes.some(function (w) { return w.path === '/music/:/transcode/universal/ping'; }));
  r.core.stop('test');
  assert.ok(r.writes.some(function (w) { return w.path === '/music/:/transcode/universal/stop'; }));
});

test('Ton: Ende -> naechster Titel; Timeline bei Pause sofort, Scrobble unter der Schwelle', function () {
  var r = rig(function () { return DIRECT; });
  r.core.play([tr({ rk: 'a', dur: 100000 }), tr({ rk: 'b', dur: 100000 })], 0, {});
  ctx.timers.tick(5);
  r.core.onEvent(14, 1000);
  r.core.pause();
  var tl = r.writes.filter(function (w) { return w.path === '/:/timeline'; });
  assert.strictEqual(tl[tl.length - 1].q.state, 'paused'); assert.strictEqual(tl[tl.length - 1].q.ratingKey, 'a');
  r.core.resumePlay();
  r.core.onEvent(14, 95000); r.core.onEvent(8);
  ctx.timers.tick(5);
  assert.strictEqual(r.core.item.rk, 'b');
  assert.strictEqual(r.core.q.items[0].off, 0); assert.strictEqual(r.core.q.items[0].vc, 1);   // lokal "gehoert", nicht "noch 0 Min." (Review M4)
  assert.ok(!r.writes.some(function (w) { return w.path === '/:/scrobble'; }));   // 95 % -> PMS zaehlt selbst
  r.core.onEvent(14, 10000); r.core.onEvent(8);
  assert.strictEqual(r.core.state, 'done');
  assert.ok(r.writes.some(function (w) { return w.path === '/:/timeline' && w.q.ratingKey === 'b' && w.q.state === 'stopped' && w.q.time === 100000; }), 'Ende: Timeline stopped bei voller Dauer');
});

test('Ton: Hoerbuch-Kapitel (eingebettet) – naechstes/vorheriges Kapitel = Sprung, Sleep "Ende des Kapitels"', function () {
  var r = rig(function (p) { return p.indexOf('/library/metadata/') === 0 ? { json: { MediaContainer: { Metadata: [{ Chapter: [
    { tag: 'Eins', index: 1, startTimeOffset: 0, endTimeOffset: 60000 }, { tag: 'Zwei', index: 2, startTimeOffset: 60000, endTimeOffset: 120000 }] }] } } } : DIRECT; });
  r.core.play([tr({ rk: 'm4b', dur: 120000, chs: 1 })], 0, { book: true });
  ctx.timers.tick(5);
  assert.strictEqual(r.core.chs.length, 2);
  r.core.onEvent(14, 10000);
  r.core.next();
  H.eq(r.calls[r.calls.length - 1], ['JumpForward', 50]);
  r.core.setSleep('end');
  r.core.onEvent(14, 59000); r.core.onEvent(14, 61000);
  assert.strictEqual(r.core.state, 'paused');
  r.core.stop('test');
});

test('Musik-Bibliothek: Typen, Sortierungen, Statuszeile, Quadrat-Raster', function () {
  var L = N.lib, ar = { id: 3, type: 'artist' }, al = { id: 3, type: 'album' };
  assert.strictEqual(L.typeNum(ar), 8); assert.strictEqual(L.typeNum(al), 9);
  H.eq(L.sorts(ar).map(function (s) { return s.id; }), ['title', 'added', 'lastWatched', 'plays']);
  assert.strictEqual(L.sortParam({ sort: 'plays', desc: true }, al), 'viewCount:desc,titleSort:asc');
  H.eq(L.filterQuery({ f: { status: 'unwatched', decade: { id: '2010', t: '2010s' } } }, ar), { type: 8 });
  H.eq(L.filterQuery({ f: { decade: { id: '2010', t: '2010s' } } }, al), { type: 9, decade: '2010' });
  assert.strictEqual(L.status(121, -1, { sort: 'title', desc: false, f: {} }, ar), '121 Künstler · Titel A–Z');
  assert.strictEqual(L.sortLabel({ sort: 'lastWatched', desc: true }, al), 'Zuletzt gehört');
  var G = N.GridMath.make('L', true);
  assert.strictEqual(G.TIER, 'square'); assert.strictEqual(G.H, 176); H.eq(G.pos(5), { x: 144, y: 176 + 252 });
  assert.strictEqual(N.GridMath.make('list', true).CLS, 'list-sq');
  H.eq(MU.caption({ type: 'album', title: 'X', artist: 'Y', year: 2011 }, true), ['X', 'Y · 2011']);
  var q = MU.libTracksQuery(3, true, 200);
  assert.strictEqual(q.q.sort, 'random'); assert.strictEqual(q.q.type, 10);
});

test('Ton: Datei nicht erreichbar (SEF 1/3) -> klare Art, nach 2 Fehlern in Folge anhalten (F7)', function () {
  var r = rig(function () { return DIRECT; }), errs = [], states = [];
  r.core.on(function (ev, d) { if (ev === 'error') errs.push(d); if (ev === 'state') states.push(d); });
  r.core.play([tr({ rk: '1' }), tr({ rk: '2' }), tr({ rk: '3' }), tr({ rk: '4' })], 0, {});
  ctx.timers.tick(5);
  r.core.onEvent(1, 0);                                       // CONNECTION_FAILED -> naechster Titel
  ctx.timers.tick(5);
  assert.strictEqual(errs[0].kind, 'unreach'); assert.strictEqual(errs[0].stop, false);
  assert.strictEqual(r.core.q.pos, 1);
  r.core.onEvent(3, 0);                                       // STREAM_NOT_FOUND -> anhalten (nicht weiter durch die Liste)
  ctx.timers.tick(5);
  assert.strictEqual(errs[1].stop, true); assert.strictEqual(r.core.q.pos, 1);
  assert.strictEqual(r.core.state, 'stopped'); assert.strictEqual(r.core.errKind, 'unreach');
  assert.ok(N.AudioCore.unreachable('404') && !N.AudioCore.unreachable('SEF 4'));
  r.core.stop('test');
});
