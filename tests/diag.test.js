'use strict';
var test = require('node:test'), assert = require('node:assert');
var H = require('./helpers/load');

test('Schwaerzung: Token, PINs und Codes vor dem Speichern', function () {
  var D = H.load().N.diag;
  var r = D.redact('GET http://pms:32400/x?a=1&X-Plex-Token=abcDEF123&b=2');
  assert.ok(!/abcDEF123/.test(r) && /X-Plex-Token=\*\*\*&b=2/.test(r));
  assert.ok(!/SECRET/.test(D.redact('{"authToken":"SECRET","x":1}')));
  assert.ok(!/SECRET/.test(D.redact('{"X-Plex-Token": "SECRET"}')));
  assert.ok(!/SECRET/.test(D.redact('accessToken=SECRET token=SECRET')));
  assert.ok(!/4711/.test(D.redact('switch?pin=4711')));
  assert.ok(!/4711/.test(D.redact('{"pin":"4711"}')));
  assert.ok(!/AB12/.test(D.redact('{"id":5,"code":"AB12"}')));
  assert.strictEqual(D.redact('Startseite geladen in 120ms'), 'Startseite geladen in 120ms');
});

test('Rotation: zwei Dateien je max. 64 KB, waechst nie', function () {
  var D = H.load().N.diag, files = { a: '', b: '' }, cur = 'a', line = new Array(200).join('x');
  for (var i = 0; i < 2000; i++) {
    var r = D.append(files, cur, [line + i]);
    files = r.files; cur = r.cur;
    assert.ok(files.a.length <= 65536 && files.b.length <= 65536);
  }
  assert.ok(files.a.length + files.b.length <= 2 * 65536);
  assert.ok(files[cur].indexOf(line + 1999) >= 0);                 // neueste Zeile in der aktuellen Datei
  var other = cur === 'a' ? 'b' : 'a';
  assert.ok(files[other].length > 60000);                          // vorherige Datei voll erhalten
  var huge = D.append({ a: '', b: '' }, 'a', [new Array(100000).join('y')]);
  assert.ok(huge.files.a.length <= 65536);                         // Einzelzeile wird gekappt
});

test('Release: nur warn/error dauerhaft; Dev: alles + an ctx.log; Ringpuffer 500', function () {
  var ctx = H.load({ fakeTimers: true }), D = ctx.N.diag, disk = {}, sink = [];
  var be = { read: function (n) { return disk[n] || null; }, write: function (n, t) { disk[n] = t; } };
  D.init(be, false, function (l) { sink.push(l); });
  D.log('info', 'hallo'); D.log('debug', 'tief'); D.log('warn', 'achtung token=XYZ'); D.error('kaputt', new Error('boom'));
  ctx.timers.tick(5000);
  assert.ok(/WARN achtung token=\*\*\*/.test(disk['log-a.txt']));
  assert.ok(/ERROR kaputt: boom/.test(disk['log-a.txt']));
  assert.ok(!/hallo|tief/.test(disk['log-a.txt']));
  assert.strictEqual(sink.length, 0);
  assert.ok(/^\d{4}-\d\d-\d\dT[\d:.]+Z - INFO hallo$/.test(D.ring[0]));   // ISO-Zeit, Bildschirm, Stufe
  for (var i = 0; i < 600; i++) D.log('info', 'n' + i);
  assert.strictEqual(D.ring.length, 500);
  var c2 = H.load({ fakeTimers: true }), D2 = c2.N.diag, d2 = {};
  D2.init({ read: function (n) { return d2[n] || null; }, write: function (n, t) { d2[n] = t; } }, true, function (l) { sink.push(l); });
  D2.log('debug', 'dev-zeile');
  c2.timers.tick(5000);
  assert.ok(/DEBUG dev-zeile/.test(d2['log-a.txt']));
  assert.strictEqual(sink.length, 1);
});

test('Loeschen leert Speicher und Dateien; Senden schickt Kopfzeile + geschwaerzten Text per POST', function (t, done) {
  var ctx = H.load(), N = ctx.N, D = N.diag, disk = {};
  D.init({ read: function (n) { return disk[n] || null; }, write: function (n, t2) { disk[n] = t2; } }, false, null);
  D.log('error', 'Fehler mit X-Plex-Token=GEHEIM');
  N.config.apply({ logHost: '192.0.2.10:8099' });
  var x = H.FakeXHR(function () { return { status: 200, body: '' }; });
  N.http._setFactory(x.factory); N.http._reset();
  D.send(function (ok) {
    assert.ok(ok);
    var r = x.log.opened[0];
    assert.strictEqual(r.method, 'POST');
    assert.strictEqual(r.url, 'http://192.0.2.10:8099/log');
    assert.ok(/^# Neolume \d+\.\d+\.\d+ \| Samsung TV UE48H8000/.test(r.body));
    assert.ok(/ERROR Fehler/.test(r.body) && !/GEHEIM/.test(r.body));
    D.clear();
    assert.strictEqual(disk['log-a.txt'], ''); assert.strictEqual(D.dump(), ''); assert.strictEqual(D.ring.length, 0);
    done();
  });
});

test('Schwaerzung: auch URL-kodierte Token/PINs (Proxy-URL)', function () {
  var D = H.load().N.diag;
  var u = 'POST http://192.0.2.10:3000/?url=' + encodeURIComponent('https://plex.tv/api/v2/home/users/x/switch?pin=4711&X-Plex-Token=SECRETTOK');
  var r = D.redact(u);
  assert.ok(!/4711/.test(r), r); assert.ok(!/SECRETTOK/.test(r), r);
  assert.ok(/pin%3D\*\*\*/.test(r) && /X-Plex-Token%3D\*\*\*/.test(r), r);
  assert.ok(!/4711/.test(D.redact('a%3Fpin%3D4711')));
  assert.ok(!/4711/.test(D.redact('%7B%22pin%22%3A%224711%22%7D')));
  assert.ok(!/SECRET/.test(D.redact('%22authToken%22%3A%22SECRET%22')));
  assert.ok(!/AB12/.test(D.redact('%22code%22%3A%22AB12%22')));
  assert.strictEqual(D.redact('spinner pinned codec'), 'spinner pinned codec');
});

test('Protokoll senden: ohne gueltigen logHost keine Anfrage (Repo-Standard leer)', function () {
  var N = H.load().N, x = H.FakeXHR(function () { return { status: 200, body: '' }; }), res = null;
  N.http._setFactory(x.factory); N.http._reset();
  N.diag.init({ read: function () { return null; }, write: function () {} }, false, null);
  N.config.apply({ logHost: 'evil.example/x?y=1' });
  assert.strictEqual(N.config.logHost, '');
  N.diag.send(function (ok) { res = ok; });
  assert.strictEqual(res, false); assert.strictEqual(x.log.opened.length, 0);
});

test('config.json: Hosts werden geprueft (kein Schema, keine Zugangsdaten, keine Query)', function () {
  var C = H.load().N.config;
  ['192.0.2.10:3000', 'proxy.lan:3000', '127.0.0.1:9/tv'].forEach(function (h) { assert.ok(C.validHost(h), h); });
  ['', 'http://x', 'a@b:1', 'x:1/?url=y', 'x:1#f', 'a b', 5].forEach(function (h) { assert.ok(!C.validHost(h), String(h)); });
  C.apply({ pms: 'http://u:p@x:1' }); assert.strictEqual(C.pmsFallback, '');
  C.apply({ pms: 'http://192.0.2.20:32400/' }); assert.strictEqual(C.pmsFallback, 'http://192.0.2.20:32400');
});
