'use strict';
/* "Mediathek aktualisieren": Fortschritt aus /activities, Abfrage bis fertig, 401/403-Meldung. Kein echter Refresh. */
var test = require('node:test'), assert = require('node:assert');
var H = require('./helpers/load');

function rig(writeErr, acts) {
  var ctx = H.load({ fakeTimers: true }), N = ctx.N, T = ctx.timers, log = { writes: [], toasts: [], ev: 0, polls: 0 };
  N.log = function () {};
  N.ui.toast = { show: function (t) { log.toasts.push(t); } };
  N.plex.write = function (m, p, q, cb) { log.writes.push(m + ' ' + p); cb(writeErr || null); };
  N.plex.get = function (p, q, o, cb) { var a = acts[Math.min(log.polls, acts.length - 1)]; log.polls++; cb(null, a); return { abort: function () {} }; };
  N.evt.on('library:scanned', function () { log.ev++; });
  return { N: N, T: T, log: log };
}
var BUSY = { MediaContainer: { size: 2, Activity: [{ type: 'library.update.section', progress: 40 }, { type: 'media.generate.bif', progress: 5 }] } };
var IDLE = { MediaContainer: { size: 0 } };

test('Fortschritt: nur Bibliotheks-Aktivitaeten zaehlen', function () {
  var N = rig(null, [IDLE]).N;
  assert.deepStrictEqual(JSON.parse(JSON.stringify(N.scan.progress(BUSY))), { busy: true, pct: 40 });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(N.scan.progress(IDLE))), { busy: false, pct: -1 });
  assert.strictEqual(N.scan.progress({ MediaContainer: { Activity: [{ type: 'media.generate.bif', progress: 9 }] } }).busy, false);
});
test('Alle Bibliotheken: Refresh, Abfrage alle 3 s, fertig wenn kein Scan mehr laeuft -> Toast + Ereignis', function () {
  var r = rig(null, [BUSY, BUSY, IDLE]), N = r.N;
  N.i18n.set('de');
  N.scan.start(null);
  assert.deepStrictEqual(r.log.writes, ['GET /library/sections/all/refresh']);
  assert.strictEqual(r.log.toasts[0], 'Mediathek wird aktualisiert …');
  r.T.tick(3000); assert.strictEqual(r.log.toasts[1], 'Aktualisiere … 40 %');
  r.T.tick(3000); r.T.tick(3000);
  assert.strictEqual(r.log.ev, 1); assert.ok(!N.scan.running());
  assert.strictEqual(r.log.toasts[r.log.toasts.length - 1], 'Fertig – neue Titel auf der Startseite');
});
test('Eine Bibliothek; ohne sichtbaren Scan nach 3 Abfragen fertig; Profilwechsel stoppt', function () {
  var r = rig(null, [IDLE]), N = r.N;
  N.scan.start('2');
  assert.deepStrictEqual(r.log.writes, ['GET /library/sections/2/refresh']);
  r.T.tick(6000); assert.strictEqual(r.log.ev, 0); r.T.tick(3000); assert.strictEqual(r.log.ev, 1);
  r = rig(null, [BUSY]); N = r.N;
  N.scan.start(null); r.T.tick(3000); N.evt.emit('profile:changed');
  var p = r.log.polls; r.T.tick(30000); assert.strictEqual(r.log.polls, p);
});
test('Nicht-Admin (403) -> klare Meldung, keine Abfrage', function () {
  var r = rig({ type: 'http', status: 403 }, [IDLE]), N = r.N;
  N.i18n.set('de');
  N.scan.start(null); r.T.tick(10000);
  assert.deepStrictEqual(r.log.toasts, ['Nur das Hauptkonto darf aktualisieren']); assert.strictEqual(r.log.polls, 0);
});
