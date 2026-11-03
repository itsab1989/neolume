'use strict';
/* Bildlader mit caps.images 'fast' (Apple, 09-perf Nachtrag A1): fertige Downloads werden per Image.decode() vorab dekodiert, erst
 * dann bekommt das sichtbare <img> die URL (decoding 'async'); LRU-Treffer ebenso; Verwerfen waehrend des Dekodierens zaehlt
 * active nur einmal herunter; Gegenprobe _decode(false) = alter Weg. TV-Bau: kein decode-Aufruf (tests/perf.test.js). */
var test = require('./helpers/load').appleTest(require('node:test')), assert = require('node:assert');
var H = require('./helpers/load');

function setup() {
  var c = H.load({ fakeTimers: true, platform: 'apple' }), N = c.N, T = c.timers, pres = [];
  function Pre() { var me = this; this.src = ''; this.decodes = 0; pres.push(this); this.decode = function () { me.decodes++; return new Promise(function (ok, bad) { me.ok = ok; me.bad = bad; }); }; }
  N.img._mkPre(function () { return new Pre(); });
  return { N: N, T: T, pres: pres };
}
function flushMicro() { return new Promise(function (r) { setImmediate(r); }); }

test('fast: sichtbares Bild erst nach decode(), decoding async; LRU-Treffer auch vorab dekodiert', async function () {
  var s = setup(), N = s.N, T = s.T;
  assert.strictEqual(N.platform.caps.images, 'fast');
  var a = { src: '' };
  N.img.want(a, 'http://pms/a', 0); T.tick(40);
  var p = s.pres[0];
  assert.strictEqual(p.src, 'http://pms/a');
  p.onload();
  assert.strictEqual(p.decodes, 1, 'nach dem Laden dekodieren');
  T.tick(100);
  assert.strictEqual(a.src, '', 'noch nicht zugewiesen, solange decode laeuft');
  p.ok(); await flushMicro(); T.tick(40);
  assert.strictEqual(a.src, 'http://pms/a');
  assert.strictEqual(a.decoding, 'async');
  assert.strictEqual(N.img._stats().active, 0);
  var b = { src: '' };                                   // gleiche URL aus dem LRU: auch erst vorab dekodieren
  N.img.want(b, 'http://pms/a', 0); T.tick(40);
  var q = s.pres[s.pres.length - 1];
  assert.notStrictEqual(q, p);
  q.onload(); q.bad(new Error('x')); await flushMicro(); T.tick(40);   // Fehler beim Dekodieren: trotzdem zeigen
  assert.strictEqual(b.src, 'http://pms/a');
});

test('fast: Verwerfen waehrend decode zaehlt active einmal; Gegenprobe _decode(false) zeigt ohne decode', async function () {
  var s = setup(), N = s.N, T = s.T, c = { src: '' };
  N.img.want(c, 'http://pms/c', 0); T.tick(40);
  var p = s.pres[0];
  p.onload();
  assert.strictEqual(N.img._stats().active, 1);
  N.img.drop(c);
  assert.strictEqual(N.img._stats().active, 0);
  p.ok(); await flushMicro(); T.tick(40);
  assert.strictEqual(N.img._stats().active, 0, 'nicht doppelt heruntergezaehlt');
  assert.strictEqual(c.src, '');
  N.img._decode(false);
  var d = { src: '' };
  N.img.want(d, 'http://pms/d', 0); T.tick(40);
  var q = s.pres[s.pres.length - 1];
  q.onload(); T.tick(40);
  assert.strictEqual(q.decodes, 0);
  assert.strictEqual(d.src, 'http://pms/d');
  N.img._decode(true);
});
