'use strict';
/* PROF-11: Profilbilder zwischenspeichern (src/ui/avatars.js) – sofort aus dem Speicher, Auffrischen nur bei Aenderung,
 * Groessenbegrenzung, kaputte Daten -> Server-Bild/Initiale, kein Schreiben im Startpfad. */
var test = require('node:test'), assert = require('node:assert');
var H = require('./helpers/load'), vm = require('vm');

var JPG = [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3];
function dataOf(bytes, mime) { return 'data:' + (mime || 'image/jpeg') + ';base64,' + Buffer.from(bytes).toString('base64'); }

function setup(disk) {
  var ctx = H.load({ fakeTimers: true }), N = ctx.N, T = ctx.timers, writes = [], wants = [], reqs = [];
  disk = disk || {};
  N.store.init({ read: function (n) { return disk[n] === undefined ? null : disk[n]; }, write: function (n, t) { disk[n] = t; writes.push(n); } });
  N.plex.setServer('http://pms.example:32400', 'TOK');
  // Bildlader nachbilden: merkt Auftraege; ok(i, true/false) meldet Laden fertig
  N.img.want = function (img, u, prio, done) { img._pnUrl = u; wants.push({ img: img, url: u, prio: prio, done: done }); };
  // XHR nachbilden: Antwort per reply(i, status, bytes, contentType)
  N.avatars._xhr(function () {
    var x = { readyState: 0, status: 0, responseType: '', response: null, headers: {} };
    x.open = function (m, u) { x.url = u; };
    x.send = function () { reqs.push(x); };
    x.abort = function () {};
    x.getResponseHeader = function (h) { return x.headers[h] || null; };
    return x;
  });
  function reply(i, status, bytes, ct) {
    var x = reqs[i];
    x.status = status; x.headers['Content-Type'] = ct || 'image/jpeg';
    x.response = bytes ? new (vm.runInContext('Uint8Array', ctx))(bytes).buffer : null;
    x.readyState = 4; x.onreadystatechange();
  }
  return { N: N, T: T, disk: disk, writes: writes, wants: wants, reqs: reqs, reply: reply, ctx: ctx };
}
function img() { return { src: 'BLANK' }; }
function stored(S) { return JSON.parse(S.disk['avatars.json']); }

test('Base64 wie Node (Restlaengen 0/1/2)', function () {
  var N = setup().N;
  [[], [1], [1, 2], [1, 2, 3], [255, 254, 253, 0, 7]].forEach(function (b) {
    assert.strictEqual(N.avatars._b64(function (i) { return b[i]; }, b.length), Buffer.from(b).toString('base64'));
  });
});

test('ohne Speicher: Server-URL wie bisher, danach im Hintergrund speichern (nicht im Startpfad)', function () {
  var S = setup(), N = S.N, im = img();
  N.avatars.show(im, { uuid: 'u1', thumb: 'https://plex.tv/users/a/avatar?c=1', tier: 'avatar', url: 'http://pms.example:32400/photo/x', prio: 0 });
  assert.strictEqual(S.wants.length, 1);
  assert.strictEqual(S.wants[0].url, 'http://pms.example:32400/photo/x');
  S.wants[0].done(true);                         // Bild geladen
  S.T.tick(1000);
  assert.strictEqual(S.reqs.length, 0, 'keine Anfrage direkt nach dem Start');
  S.T.tick(N.avatars.LATER + 500);
  assert.strictEqual(S.reqs.length, 1);
  assert.strictEqual(S.reqs[0].url, 'http://pms.example:32400/photo/x');
  assert.strictEqual(S.reqs[0].responseType, 'arraybuffer');
  S.reply(0, 200, JPG);
  assert.strictEqual(S.writes.length, 0, 'Schreiben entprellt');
  S.T.tick(5000);
  assert.deepStrictEqual(S.writes, ['avatars.json']);
  var e = stored(S).e['u1|avatar'];
  assert.strictEqual(e.d, dataOf(JPG));
  assert.strictEqual(e.t, 'https://plex.tv/users/a/avatar?c=1');
  assert.strictEqual(S.wants.length, 1, 'gleiches Bild, kein zweites Zuweisen');
});

function cachedDisk(thumb, d, at) {
  return { 'avatars.json': JSON.stringify({ v: 1, e: { 'u1|avatar': { t: thumb, d: d || dataOf(JPG), at: at === undefined ? 1000000 : at } } }) };
}

test('mit Speicher: sofort das gespeicherte Bild, keine Anfrage, kein Schreiben', function () {
  var S = setup(cachedDisk('T1')), N = S.N, im = img();
  N.avatars.show(im, { uuid: 'u1', thumb: 'T1', tier: 'avatar', url: 'http://pms/x', prio: 0 });
  assert.strictEqual(S.wants.length, 1);
  assert.strictEqual(S.wants[0].url, dataOf(JPG));
  S.wants[0].done(true);
  S.T.tick(60000);
  assert.strictEqual(S.reqs.length, 0);
  assert.strictEqual(S.writes.length, 0);
});

test('Bild-Adresse geaendert: altes sofort, neues im Hintergrund ersetzt es und wird gespeichert', function () {
  var S = setup(cachedDisk('T1')), N = S.N, im = img(), NEW = [0xff, 0xd8, 9, 9, 9];
  N.avatars.show(im, { uuid: 'u1', thumb: 'T2', tier: 'avatar', url: 'http://pms/x2', prio: 0 });
  assert.strictEqual(S.wants[0].url, dataOf(JPG));
  S.wants[0].done(true);
  S.T.tick(N.avatars.LATER + 500);
  assert.strictEqual(S.reqs.length, 1);
  S.reply(0, 200, NEW);
  assert.strictEqual(S.wants.length, 2);
  assert.strictEqual(S.wants[1].img, im);
  assert.strictEqual(S.wants[1].url, dataOf(NEW));
  S.T.tick(5000);
  var e = stored(S).e['u1|avatar'];
  H.eq([e.t, e.d], ['T2', dataOf(NEW)]);
});

test('Bild unveraendert (gleiche Bytes, neue Adresse): kein Ersetzen, nur Adresse nachgetragen', function () {
  var S = setup(cachedDisk('T1')), N = S.N, im = img();
  N.avatars.show(im, { uuid: 'u1', thumb: 'T2', tier: 'avatar', url: 'http://pms/x2', prio: 0 });
  S.wants[0].done(true);
  S.T.tick(N.avatars.LATER + 500);
  S.reply(0, 200, JPG);
  assert.strictEqual(S.wants.length, 1);
  S.T.tick(5000);
  assert.strictEqual(stored(S).e['u1|avatar'].t, 'T2');
});

test('gleiche Adresse, aelter als REFRESH: pruefen; gleiches Bild -> nur Pruefzeit', function () {
  var S = setup(cachedDisk('T1', null, 1000000 - 8 * 86400000)), N = S.N, im = img();
  N.avatars.show(im, { uuid: 'u1', thumb: 'T1', tier: 'avatar', url: 'http://pms/x', prio: 0 });
  S.T.tick(N.avatars.LATER + 500);
  assert.strictEqual(S.reqs.length, 1);
  S.reply(0, 200, JPG);
  S.T.tick(5000);
  assert.ok(stored(S).e['u1|avatar'].at > 1000000);
});

test('Fehler/kein Bild vom Server: nichts geschrieben, gespeichertes bleibt', function () {
  var S = setup(cachedDisk('T1')), N = S.N, im = img();
  N.avatars.show(im, { uuid: 'u1', thumb: 'T2', tier: 'avatar', url: 'http://pms/x2', prio: 0 });
  S.T.tick(N.avatars.LATER + 500);
  S.reply(0, 404, null);
  S.T.tick(5000);
  assert.strictEqual(S.writes.length, 0);
  N.avatars._reset();
  var S2 = setup(cachedDisk('T1')), im2 = img();
  S2.N.avatars.show(im2, { uuid: 'u1', thumb: 'T2', tier: 'avatar', url: 'http://pms/x2', prio: 0 });
  S2.T.tick(S2.N.avatars.LATER + 500);
  S2.reply(0, 200, [60, 104, 116, 109, 108, 62], 'text/html');   // Fehlerseite statt Bild
  S2.T.tick(5000);
  assert.strictEqual(S2.writes.length, 0);
});

test('kaputte Daten: ungueltiger Eintrag -> Server-URL; nicht dekodierbar -> Eintrag weg, Server-URL', function () {
  var S = setup(cachedDisk('T1', 'kein-bild')), N = S.N, im = img();
  N.avatars.show(im, { uuid: 'u1', thumb: 'T1', tier: 'avatar', url: 'http://pms/x', prio: 0 });
  assert.strictEqual(S.wants[0].url, 'http://pms/x');
  var S2 = setup({ 'avatars.json': '{kaputt' }), im2 = img();
  S2.N.avatars.show(im2, { uuid: 'u1', thumb: 'T1', tier: 'avatar', url: 'http://pms/x', prio: 0 });
  assert.strictEqual(S2.wants[0].url, 'http://pms/x');
  var S3 = setup(cachedDisk('T1', 'data:image/jpeg;base64,AAAA')), im3 = img();
  S3.N.avatars.show(im3, { uuid: 'u1', thumb: 'T1', tier: 'avatar', url: 'http://pms/x', prio: 0 });
  S3.wants[0].done(false);                       // Dekodieren gescheitert
  assert.strictEqual(S3.wants[1].url, 'http://pms/x');
  S3.T.tick(5000);
  assert.deepStrictEqual(stored(S3).e, {});
  // ohne Server-URL (kein Token) und ohne Speicher: kein Bild -> Initiale bleibt sichtbar
  var S4 = setup(), im4 = img();
  S4.N.avatars.show(im4, { uuid: 'u1', thumb: 'T1', tier: 'avatar', url: '', prio: 0 });
  assert.strictEqual(S4.wants.length, 0);
  assert.strictEqual(im4.src, 'BLANK');
});

test('Groessenbegrenzung: zu grosses Bild nicht gespeichert, Summe/Anzahl begrenzt (aelteste zuerst)', function () {
  var S = setup(), N = S.N, big = [], i;
  for (i = 0; i < N.avatars.MAX_ENTRY; i++) big.push(i & 255);
  N.avatars.show(img(), { uuid: 'u1', thumb: 'T', tier: 'avatar', url: 'http://pms/big', prio: 0 });
  S.wants[0].done(true);
  S.T.tick(N.avatars.LATER + 500);
  S.reply(0, 200, big);
  S.T.tick(5000);
  assert.strictEqual(S.writes.length, 0);
  // viele Profile: Anzahl bleibt <= MAX_COUNT
  var e = {};
  for (i = 0; i < N.avatars.MAX_COUNT; i++) e['p' + i + '|avatar'] = { t: 'T', d: dataOf([i]), at: 1000 + i };
  var S2 = setup({ 'avatars.json': JSON.stringify({ v: 1, e: e }) });
  S2.N.avatars.show(img(), { uuid: 'neu', thumb: 'T', tier: 'avatar', url: 'http://pms/n', prio: 0 });
  S2.wants[0].done(true);
  S2.T.tick(S2.N.avatars.LATER + 500);
  S2.reply(0, 200, JPG);
  S2.T.tick(5000);
  var keys = Object.keys(stored(S2).e);
  assert.strictEqual(keys.length, S2.N.avatars.MAX_COUNT);
  assert.ok(keys.indexOf('neu|avatar') >= 0);
  assert.ok(keys.indexOf('p0|avatar') < 0, 'aeltester Eintrag faellt weg');
});

test('nacheinander: hoechstens eine Anfrage zur Zeit, erst in Tastenruhe', function () {
  var S = setup(), N = S.N;
  ['a', 'b', 'c'].forEach(function (u) { N.avatars.show(img(), { uuid: u, thumb: 'T', tier: 'avatarS', url: 'http://pms/' + u, prio: 1 }); });
  S.wants.forEach(function (w) { w.done(true); });
  S.T.tick(N.avatars.LATER - 100);
  assert.strictEqual(S.reqs.length, 0);
  N.idle.touch();                                // Taste
  S.T.tick(150);
  assert.strictEqual(S.reqs.length, 0);
  S.T.tick(400);
  assert.strictEqual(S.reqs.length, 1);
  S.reply(0, 200, JPG);
  S.T.tick(400);
  assert.strictEqual(S.reqs.length, 2);
});

test('Abmelden loescht die gespeicherten Bilder und verwirft Auftraege', function () {
  var S = setup(cachedDisk('T1')), N = S.N;
  N.avatars.show(img(), { uuid: 'u1', thumb: 'T2', tier: 'avatar', url: 'http://pms/x', prio: 0 });
  N.session.state = { clientId: 'c', lang: 'de' };
  N.session.signOut();
  S.T.tick(N.avatars.LATER + 5000);
  assert.strictEqual(S.reqs.length, 0);
  assert.strictEqual(S.disk['avatars.json'], 'null');
});

test('Plattform-Naht: N.platform.net.imageData ersetzt das XHR', function () {
  var S = setup(), N = S.N, asked = [];
  N.platform = { net: { imageData: function (u, cb) { asked.push(u); cb(null, dataOf(JPG, 'image/png')); } } };
  N.avatars.show(img(), { uuid: 'u1', thumb: 'T', tier: 'avatar', url: 'https://plex.tv/x', prio: 0 });
  S.wants[0].done(true);
  S.T.tick(N.avatars.LATER + 5000);
  assert.deepStrictEqual(asked, ['https://plex.tv/x']);
  assert.strictEqual(S.reqs.length, 0);
  assert.strictEqual(stored(S).e['u1|avatar'].d, dataOf(JPG, 'image/png'));
});
