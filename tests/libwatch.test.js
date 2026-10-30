'use strict';
/* HOME-12 / LIB-10: Aenderungs-Signal des Servers (N.libwatch), nur betroffene Reihen holen (N.hubs.affected, fetch only),
 * Fokus bleibt auf derselben Karte (N.hubs.keepFocus) */
var test = require('node:test'), assert = require('node:assert');
var H = require('./helpers/load');
function eq(a, b, m) { assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b, m); }
function secs(list) { return { MediaContainer: { Directory: list } }; }
function setup() {
  var N = H.load().N, events = [];
  N.plex.base = 'http://192.0.2.1:32400';
  N.session = { profile: { uuid: 'p1' } };
  N.evt.on('library:changed', function (e) { events.push(e.libs.slice()); });
  return { N: N, events: events };
}

test('Stand je Bibliothek: contentChangedAt, sonst updatedAt; erste Antwort = Ausgangsstand ohne Ereignis', function () {
  var a = setup(), W = a.N.libwatch;
  eq(W.sigs(secs([{ key: '1', type: 'movie', contentChangedAt: 10, updatedAt: 5 }, { key: 2, type: 'show', updatedAt: 7 }, null])), { 1: 'c10', 2: 'u7' });
  eq(W.note(secs([{ key: '1', type: 'movie', contentChangedAt: 10 }, { key: '2', type: 'show', contentChangedAt: 20 }])), []);
  eq(a.events, [], 'Ausgangsstand: kein Ereignis');
  assert.strictEqual(W.type('2'), 'show'); assert.strictEqual(W.sig(2), 'c20');
  eq(W.note(secs([{ key: '1', type: 'movie', contentChangedAt: 10 }, { key: '2', type: 'show', contentChangedAt: 21 }])), ['2']);
  eq(a.events, [['2']], 'nur die geaenderte Bibliothek');
  W.note(secs([{ key: '1', type: 'movie', contentChangedAt: 10 }, { key: '2', type: 'show', contentChangedAt: 21 }]));
  assert.strictEqual(a.events.length, 1, 'gleicher Stand: nichts');
  a.N.session.profile = { uuid: 'p2' };
  W.note(secs([{ key: '1', type: 'movie', contentChangedAt: 99 }]));
  assert.strictEqual(a.events.length, 1, 'anderes Profil: neuer Ausgangsstand');
});

test('Selbst nachsehen: hoechstens alle 60 s, nie zwei Anfragen gleichzeitig; nie waehrend Video/Bildschirmschoner', function () {
  var a = setup(), N = a.N, W = N.libwatch, calls = [];
  N.plex.get = function (p, q, o, cb) { calls.push({ p: p, cb: cb }); return { abort: function () {} }; };
  var got = 0;
  W.check(function () { got++; }); W.check(function () { got++; });
  assert.strictEqual(calls.length, 1, 'eine Anfrage fuer beide');
  assert.strictEqual(calls[0].p, '/library/sections');
  calls[0].cb(null, secs([{ key: '2', type: 'show', contentChangedAt: 1 }]));
  assert.strictEqual(got, 2);
  W.check(function () { got++; });
  assert.strictEqual(calls.length, 1, 'eben erst nachgesehen: aus dem Stand');
  assert.strictEqual(got, 3);
  W.check(null, 0);
  assert.strictEqual(calls.length, 2, 'maxAge 0: frisch');
  assert.ok(W.quiet());
  N.player = { status: function () { return { active: true }; } };
  assert.ok(!W.quiet(), 'Video laeuft');
  N.player = { status: function () { return null; } }; N.ui.saver = { on: true };
  assert.ok(!W.quiet(), 'Bildschirmschoner');
});

test('Betroffene Reihen: "Neu in" und Hubs der Bibliothek plus Naechste Folgen; nie Weiterschauen/Playlists/Erweiterungs-Reihen', function () {
  var N = H.load().N;
  eq(N.hubs.affected(['2'], ['cw', 'deck', 'new-1', 'new-2', 'hub-2-home.ondeck', 'hub-1-x', 'pl', 'x-rq-trend']), ['deck', 'new-2', 'hub-2-home.ondeck']);
  eq(N.hubs.affected([2], ['cw', 'new-1']), []);
  eq(N.hubs.affected([], ['deck']), ['deck']);
});

test('Fokus nach einer Aenderung der Reihe: gleiche Karte, gleiche Bildschirm-Spalte; fehlt sie, die an ihrer Stelle', function () {
  var N = H.load().N, K = N.hubs.keepFocus;
  function l(s) { return s.split('').map(function (c) { return { rk: c }; }); }
  eq(K(l('abcdefgh'), l('Xabcdefgh'), 3, 1, 5), { f: 4, sc: 2 }, 'neuer Titel vorn: Karte d rueckt nach, Ring bleibt');
  eq(K(l('abcdefgh'), l('abdefgh'), 3, 1, 5), { f: 2, sc: 0 }, 'davor einer weg: wieder Spalte 2');
  eq(K(l('abcdefgh'), l('abcefgh'), 3, 1, 5), { f: 3, sc: 1 }, 'fokussierte weg: die an ihrer Stelle');
  eq(K(l('abc'), l('ab'), 2, 0, 5), { f: 1, sc: 0 }, 'letzte weg: die davor');
  eq(K(l('abc'), [], 1, 0, 5), { f: 0, sc: 0 });
  eq(K(l('abcdefghij'), l('abcdefghij'), 9, 5, 5), { f: 9, sc: 5 });
});

test('Nur einzelne Reihen holen (Bibliothek geaendert): Sektionen + "Neu in" dieser Bibliothek; alle anderen Reihen bleiben unveraendert', function () {
  var N = H.load().N, calls = [];
  N.homeRows.enabled = function () { return ['cw', 'new-1', 'new-2']; };
  N.plex.get = function (p, q, o, cb) {
    calls.push(p + (q && q.sectionID ? '#' + q.sectionID : ''));
    var d = p === '/library/sections' ? secs([{ key: '1', type: 'movie', title: 'Filme' }, { key: '2', type: 'show', title: 'Serien' }])
      : { MediaContainer: { Metadata: [{ ratingKey: '77', type: 'show', title: 'Neue Serie', addedAt: 9 }] } };
    setTimeout(function () { cb(null, d); }, 0);
    return { abort: function () {} };
  };
  var old = [{ id: 'cw', kind: 'land', items: [{ rk: '5' }] }, { id: 'new-1', kind: 'poster', items: [{ rk: '9' }] }, { id: 'new-2', kind: 'poster', items: [{ rk: '8' }] }];
  return new Promise(function (done) {
    N.hubs.fetch(function (err, res) {
      assert.ok(!err);
      eq(calls.sort(), ['/hubs/home/recentlyAdded#2', '/library/sections']);
      assert.strictEqual(res.rows[0], old[0], 'Weiterschauen: dieselbe Reihe');
      assert.strictEqual(res.rows[1], old[1], 'andere Bibliothek: dieselbe Reihe');
      eq(res.rows[2].items.map(function (i) { return i.rk; }), ['77', 'all:new-2']);   // + "Alle anzeigen" (HOME-14)
      done();
    }, { libs: [{ id: 1, type: 'movie', title: 'Filme' }, { id: 2, type: 'show', title: 'Serien' }], rows: old, only: ['new-2'] });
  });
});
