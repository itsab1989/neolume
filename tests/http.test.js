'use strict';
var test = require('node:test'), assert = require('node:assert');
var H = require('./helpers/load');

function setup(script) {
  var ctx = H.load({ fakeTimers: true }), N = ctx.N, T = ctx.timers, x = H.FakeXHR(function (m, u, n, xhr) { var r = script(m, u, n, xhr); if (r) r.timers = T; return r; });
  N.http._setFactory(x.factory); N.http._setTimers({ set: T.setTimeout, clear: T.clearTimeout }); N.http._reset();
  return { N: N, T: T, log: x.log };
}

test('Timeout per setTimeout + abort, GET wird 2x wiederholt (500/1500 ms)', function () {
  var s = setup(function () { return { hang: true }; }), res = null;
  s.N.http.request({ url: 'http://pms/a', timeout: 1000 }, function (err) { res = err; });
  s.T.tick(1000); assert.strictEqual(s.log.opened.length, 1); assert.strictEqual(s.log.aborted, 1);
  s.T.tick(500); assert.strictEqual(s.log.opened.length, 2);
  s.T.tick(1000 + 1500); assert.strictEqual(s.log.opened.length, 3);
  s.T.tick(1000);
  assert.strictEqual(res.type, 'timeout');
  s.T.tick(10000); assert.strictEqual(s.log.opened.length, 3);
});

test('POST wird nie wiederholt; 5xx bei GET schon, 404 nicht', function () {
  var s = setup(function (m, u) { return { status: /five/.test(u) ? 503 : 404, body: {} }; }), errs = [];
  s.N.http.request({ method: 'POST', url: 'http://pms/five' }, function (e) { errs.push(e.status); });
  s.T.tick(10);
  s.N.http.request({ url: 'http://pms/404' }, function (e) { errs.push(e.status); });
  s.T.tick(10);
  s.N.http.request({ url: 'http://pms/five' }, function (e) { errs.push(e.status); });
  s.T.tick(5000);
  assert.deepStrictEqual(errs, [503, 404, 503]);
  assert.strictEqual(s.log.opened.length, 1 + 1 + 3);
});

test('401 -> Ereignis auth:expired (ausser no401)', function () {
  var s = setup(function () { return { status: 401, body: {} }; }), ev = 0;
  s.N.evt.on('auth:expired', function () { ev++; });
  s.N.http.request({ url: 'http://pms/x' }, function () {});
  s.N.http.request({ url: 'http://pms/y', no401: true }, function () {});
  s.T.tick(10);
  assert.strictEqual(ev, 1);
});

test('JSON wird geparst; kaputtes JSON -> parse-Fehler', function () {
  var s = setup(function (m, u) { return { status: 200, body: /bad/.test(u) ? '{nope' : { a: 1 } }; }), out = [];
  s.N.http.request({ url: 'http://pms/ok' }, function (e, d) { out.push(d.a); });
  s.N.http.request({ url: 'http://pms/bad' }, function (e) { out.push(e.type); });
  s.T.tick(10);
  assert.deepStrictEqual(out, [1, 'parse']);
});

test('Gleiche laufende GETs werden zusammengefasst; Abbruch eines Abonnenten stoert die anderen nicht', function () {
  var s = setup(function () { return { status: 200, body: { v: 1 }, delay: 50 }; }), got = 0;
  var a = s.N.http.request({ url: 'http://pms/same' }, function () { got++; });
  s.N.http.request({ url: 'http://pms/same' }, function () { got++; });
  s.N.http.request({ url: 'http://pms/same' }, function () { got++; });
  a.abort();
  s.T.tick(100);
  assert.strictEqual(s.log.opened.length, 1);
  assert.strictEqual(got, 2);
});

test('Max. 3 Anfragen gleichzeitig, Rest wartet', function () {
  var s = setup(function () { return { status: 200, body: {}, delay: 100 }; }), done = 0;
  for (var i = 0; i < 8; i++) s.N.http.request({ url: 'http://pms/' + i }, function () { done++; });
  assert.strictEqual(s.log.active, 3);
  s.T.tick(1000);
  assert.strictEqual(done, 8);
  assert.strictEqual(s.log.maxActive, 3);
});

test('Dedupe nur bei gleicher URL UND gleichem Token (Profilwechsel)', function () {
  var s = setup(function () { return { status: 200, body: { a: 1 } }; }), n = 0;
  s.N.http.request({ url: 'http://pms/z', headers: { 'X-Plex-Token': 'A' } }, function () { n++; });
  s.N.http.request({ url: 'http://pms/z', headers: { 'X-Plex-Token': 'A' } }, function () { n++; });
  s.N.http.request({ url: 'http://pms/z', headers: { 'X-Plex-Token': 'B' } }, function () { n++; });
  s.T.tick(10);
  assert.strictEqual(n, 3); assert.strictEqual(s.log.opened.length, 2);
});
