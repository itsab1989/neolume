'use strict';
/* Hintergrund in Bibliotheken (core/ambient.js N.amb): Farben aus UltraBlurColors, Abdunkeln/Lesbarkeit, PNG als data:-URI,
 * Ziel je Modus, Zufallsbild, Einstellungen (Standard/Rueckfall), Entprellung ohne Arbeit im Fokusschritt. Ohne DOM/Netz. */
var test = require('node:test'), assert = require('node:assert'), zlib = require('zlib');
var H = require('./helpers/load'), eq = H.eq;
var ctx = H.load({ fakeTimers: true }), N = ctx.N, A = N.amb, T = ctx.timers;
N.log = function () {};

/* PNG aus der data:-URI lesen (Signatur, CRC je Block, IHDR, Pixel nach inflate) */
function readPng(uri) {
  assert.ok(/^data:image\/png;base64,/.test(uri));
  var b = Buffer.from(uri.split(',')[1], 'base64'), o = 8, out = { idat: [] };
  assert.deepStrictEqual([].slice.call(b, 0, 8), [137, 80, 78, 71, 13, 10, 26, 10]);
  while (o < b.length) {
    var len = b.readUInt32BE(o), type = b.toString('latin1', o + 4, o + 8), data = b.slice(o + 8, o + 8 + len);
    assert.strictEqual(b.readUInt32BE(o + 8 + len), zlib.crc32 ? zlib.crc32(b.slice(o + 4, o + 8 + len)) : b.readUInt32BE(o + 8 + len), 'CRC ' + type);
    if (type === 'IHDR') { out.w = data.readUInt32BE(0); out.h = data.readUInt32BE(4); out.depth = data[8]; out.ct = data[9]; }
    if (type === 'IDAT') out.idat.push(data);
    o += 12 + len;
  }
  var raw = zlib.inflateSync(Buffer.concat(out.idat)), stride = out.w * 3 + 1;
  assert.strictEqual(raw.length, stride * out.h);
  out.px = function (x, y) { var i = y * stride + 1 + x * 3; return [raw[i], raw[i + 1], raw[i + 2]]; };
  return out;
}

test('Farben: Hex-Werte wie vom PMS (mit/ohne #, Kurzform, Unsinn -> null)', function () {
  eq(A.hex('291574'), [0x29, 0x15, 0x74]);
  eq(A.hex('#A1B2C3'), [0xa1, 0xb2, 0xc3]);
  eq(A.hex(' fff '), [255, 255, 255]);
  assert.strictEqual(A.hex('12345'), null); assert.strictEqual(A.hex('zzzzzz'), null);
  assert.strictEqual(A.hex(null), null); assert.strictEqual(A.hex(undefined), null);
});
test('Farben: UltraBlurColors packen/entpacken (Reihenfolge oben links, oben rechts, unten rechts, unten links); unvollstaendig -> leer', function () {
  var ub = { topLeft: '291574', topRight: '4c2d6c', bottomRight: '602415', bottomLeft: '6d1c11' };   // echter PMS 1.43
  assert.strictEqual(A.pack(ub), '2915744c2d6c6024156d1c11');
  assert.strictEqual(A.pack([ub]), '2915744c2d6c6024156d1c11');           // XML->JSON-Varianten als Liste
  assert.strictEqual(A.pack({ topLeft: '291574', topRight: '4c2d6c', bottomRight: '602415' }), '');
  assert.strictEqual(A.pack(null), ''); assert.strictEqual(A.pack('291574'), '');
  eq(A.unpack('2915744c2d6c6024156d1c11'), [[0x29, 0x15, 0x74], [0x4c, 0x2d, 0x6c], [0x60, 0x24, 0x15], [0x6d, 0x1c, 0x11]]);
  assert.strictEqual(A.unpack('xyz'), null); assert.strictEqual(A.unpack(''), null);
});
test('Bibliothek nimmt die Farben mit (normList ub), andere Listen nicht (Home-Cache bleibt schlank)', function () {
  var m = [{ ratingKey: '1', type: 'movie', title: 'X', UltraBlurColors: { topLeft: '010203', topRight: '040506', bottomRight: '070809', bottomLeft: '0a0b0c' } }];
  assert.strictEqual(N.model.normList(m, null, 1, true)[0].ub, '0102030405060708090a0b0c');
  assert.strictEqual(N.model.normList(m, null, 1)[0].ub, undefined);
});
test('Abdunkeln: Helligkeit nie ueber der Grenze der Staerke (Text lesbar), dunkle Farben bleiben dunkel, Farbton bleibt', function () {
  ['ffffff', 'ffd400', '00e5ff', '7cff00', 'ff2d6e', 'f4f1e8'].forEach(function (h) {
    assert.ok(A.lum(A.shade(A.hex(h), 'soft')) <= A.LOOK.soft.lmax + 0.002, h + ' soft');
    assert.ok(A.lum(A.shade(A.hex(h), 'strong')) <= A.LOOK.strong.lmax + 0.002, h + ' strong');
    assert.ok(A.lum(A.shade(A.hex(h), 'strong')) > A.lum(A.shade(A.hex(h), 'soft')), h + ' kraeftiger = heller');
  });
  /* TV-Test 29.10. ("Dezent" bei kraeftigen Postern sehr bunt, ganz magenta): Buntheit (groesster minus kleinster Kanal)
   * dezent hoechstens 30 Stufen (vorher bis 66), kraeftiger deutlich mehr */
  ['ff00c8', 'ff2d6e', '00e5ff', '7cff00', 'ff0000'].forEach(function (h) {
    var sc = A.shade(A.hex(h), 'soft'), st = A.shade(A.hex(h), 'strong');
    var cs = Math.max.apply(null, sc) - Math.min.apply(null, sc), ct = Math.max.apply(null, st) - Math.min.apply(null, st);
    assert.ok(cs <= 30, h + ' dezent: Buntheit ' + cs + ' ' + sc);
    assert.ok(ct > cs, h + ' kraeftiger bunter');
  });
  var red = A.shade(A.hex('ff0000'), 'soft');
  assert.ok(red[0] > red[1] && red[0] > red[2], 'rot bleibt rot');
  var dark = A.shade(A.hex('101010'), 'soft');
  assert.ok(Math.abs(dark[0] - 15) <= 2, 'fast Grund');
  // Zweitzeile der Beschriftung (#858B92) auf der hellsten erlaubten Flaeche: Kontrast >= 4:1 (dezent) bzw. >= 3:1 (kraeftiger)
  var t2 = A.lum([0x85, 0x8b, 0x92]);
  assert.ok((t2 + 0.05) / (A.LOOK.soft.lmax + 0.05) >= 4);
  assert.ok((t2 + 0.05) / (A.LOOK.strong.lmax + 0.05) >= 3);
});
test('PNG: gueltige data:-URI (Signatur, CRC, zlib), 16x9 RGB, Ecken = abgedunkelte Titelfarben, Mitte gemischt', function () {
  var u = A.moodUrl('ff2d6effd40000e5ff7cff00', 'strong'), p = readPng(u);
  assert.strictEqual(p.w, A.W); assert.strictEqual(p.h, A.H); assert.strictEqual(p.depth, 8); assert.strictEqual(p.ct, 2);
  eq(A.shade(A.hex('ff2d6e'), 'strong'), p.px(0, 0));
  eq(A.shade(A.hex('ffd400'), 'strong'), p.px(A.W - 1, 0));
  eq(A.shade(A.hex('00e5ff'), 'strong'), p.px(A.W - 1, A.H - 1));
  eq(A.shade(A.hex('7cff00'), 'strong'), p.px(0, A.H - 1));
  assert.ok(u.length < 3000, 'klein: ' + u.length);
  assert.strictEqual(A.moodUrl('ff2d6effd40000e5ff7cff00', 'strong'), u, 'gleiche Farben -> gleiche URI (Speicher)');
  assert.notStrictEqual(A.moodUrl('ff2d6effd40000e5ff7cff00', 'soft'), u);
  assert.strictEqual(A.moodUrl('', 'soft'), '');
  var b = readPng(A.baseUrl());
  eq([b.w, b.h], [1, 1]); eq(A.BASE, b.px(0, 0));
});
/* Referenz = die alte, einfache Fassung (bis 1.0.5): Pixel mit Math.round je Kanal, PNG mit gespeichertem Deflate-Block, Base64 von Node.
 * Die schnelle Fassung (TV-Befund 28.10.: amb.apply 18–23 ms) muss Byte fuer Byte dasselbe liefern. */
function refPixels(cs, w, h) {
  var px = [];
  function ss(t) { return t * t * (3 - 2 * t); }
  for (var y = 0; y < h; y++) {
    var v = ss(h > 1 ? y / (h - 1) : 0);
    for (var x = 0; x < w; x++) {
      var u = ss(w > 1 ? x / (w - 1) : 0);
      for (var k = 0; k < 3; k++) {
        var top = cs[0][k] + (cs[1][k] - cs[0][k]) * u, bot = cs[3][k] + (cs[2][k] - cs[3][k]) * u;
        px.push(Math.round(top + (bot - top) * v));
      }
    }
  }
  return px;
}
function refPng(w, h, px) {
  var raw = [], a = 1, b = 0;
  for (var y = 0; y < h; y++) { raw.push(0); for (var x = 0; x < w * 3; x++) raw.push(px[y * w * 3 + x]); }
  raw.forEach(function (v) { a = (a + v) % 65521; b = (b + a) % 65521; });
  var n = raw.length, z = Buffer.from([0x78, 0x01, 0x01, n & 255, n >> 8, ~n & 255, (~n >> 8) & 255].concat(raw, [b >> 8, b & 255, a >> 8, a & 255]));
  function chunk(type, data) {
    var len = Buffer.alloc(4), crc = Buffer.alloc(4), td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    len.writeUInt32BE(data.length); crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  }
  var ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return 'data:image/png;base64,' + Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', z), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}
test('PNG schnell = alte Fassung Byte fuer Byte (Zufallsfarben, Extremwerte, beide Staerken, beliebige Groessen)', { skip: !zlib.crc32 && 'Node ohne zlib.crc32' }, function () {
  var seed = 7, i, s;
  function r() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; }
  function hx() { return ('00000' + (r() % 0x1000000).toString(16)).slice(-6); }
  var keys = ['000000000000000000000000', 'ffffffffffffffffffffffff', '000000ffffff000000ffffff', 'ff000000ff000000ff0e0f11'];
  for (i = 0; i < 300; i++) keys.push(hx() + hx() + hx() + hx());
  keys.forEach(function (k) {
    ['soft', 'strong'].forEach(function (st) {
      var cs = A.unpack(k).map(function (c) { return A.shade(c, st); });
      assert.strictEqual(A.moodUrl(k, st), refPng(A.W, A.H, refPixels(cs, A.W, A.H)), k + ' ' + st);
      for (s = 0; s < 4; s++) assert.ok(Math.min.apply(null, cs[s]) >= 1, 'abgedunkelt nie < 1 (Rundung (x+0.5)|0 exakt)');
    });
  });
  eq(A.pixels([[1, 2, 3], [200, 100, 0], [9, 99, 199], [255, 0, 128]], 7, 5), refPixels([[1, 2, 3], [200, 100, 0], [9, 99, 199], [255, 0, 128]], 7, 5));
  for (var w = 1; w < 40; w += 7) for (var h = 1; h < 25; h += 6) {
    var px = []; for (i = 0; i < w * h * 3; i++) px.push(r() & 255);
    assert.strictEqual(A.png(w, h, px), refPng(w, h, px), w + 'x' + h);
  }
  assert.strictEqual(A.baseUrl(), refPng(1, 1, A.BASE));
});
test('Vorwaermen (TV 28.10.: erster Aufruf baute Tabellen im Wechsel): aendert keine Ausgabe', { skip: !zlib.crc32 && 'Node ohne zlib.crc32' }, function () {
  var k = '123456abcdef0f0f0f804020', cs = A.unpack(k).map(function (c) { return A.shade(c, 'soft'); });
  assert.strictEqual(A.warm(), true);
  assert.strictEqual(A.moodUrl(k, 'soft'), refPng(A.W, A.H, refPixels(cs, A.W, A.H)));
  A.warm();                                       // schreibt in dasselbe Feld wie moodUrl -> danach weiter korrekt
  assert.strictEqual(A.moodUrl('fedcba0123456789abcdef01', 'strong'),
    refPng(A.W, A.H, refPixels(A.unpack('fedcba0123456789abcdef01').map(function (c) { return A.shade(c, 'strong'); }), A.W, A.H)));
});
test('Einstellungen: Standard Farbstimmung/Dezent, unbekannte Werte -> Standard; Hintergrundbilder aus -> Bild-Modi zeigen Farben', function () {
  assert.strictEqual(A.mode(null), 'mood'); assert.strictEqual(A.mode({}), 'mood'); assert.strictEqual(A.mode({ libBg: 'disco' }), 'mood');
  assert.strictEqual(A.mode({ libBg: 'off' }), 'off'); assert.strictEqual(A.mode({ libBg: 'random' }), 'random');
  assert.strictEqual(A.strength({}), 'soft'); assert.strictEqual(A.strength({ libBgStrength: 'strong' }), 'strong'); assert.strictEqual(A.strength({ libBgStrength: 3 }), 'soft');
  assert.strictEqual(A.effective('art', false), 'mood'); assert.strictEqual(A.effective('random', false), 'mood');
  assert.strictEqual(A.effective('off', false), 'off'); assert.strictEqual(A.effective('art', true), 'art');
  var st = N.comfort.applyDefaults({ libBg: 'off' }, false);
  assert.strictEqual(st.libBg, 'off'); assert.strictEqual(st.libBgStrength, 'soft');
  assert.strictEqual(N.comfort.applyDefaults({}, true).libBg, 'mood');   // Kinderprofile: gleicher Standard
});
test('Ziel je Modus: Farbstimmung nur Farben; Titelbild Art > Farben > Poster (nie ein Spoiler-Bild); ohne alles der Grund', function () {
  var it = { art: '/a/1', ub: '0102030405060708090a0b0c', thumb: '/t/1' };
  eq(A.target(it, 'mood'), { key: 'm:' + it.ub, mood: it.ub });
  eq(A.target(it, 'art'), { key: 'a:/a/1', art: '/a/1' });
  eq(A.target({ ub: it.ub, thumb: '/t/1' }, 'art'), { key: 'm:' + it.ub, mood: it.ub });
  eq(A.target({ thumb: '/t/1' }, 'art'), { key: 't:/t/1', thumb: '/t/1' });
  eq(A.target({ thumb: '/t/1' }, 'mood'), { key: 'base' });
  eq(A.target(null, 'mood'), { key: 'base' });
  N.session.settings = { spoiler: true }; N.comfort.markSpoiler('/t/ep', true);
  eq(A.target({ thumb: '/t/ep' }, 'art'), { key: 'base' });
  N.session.settings = null;
  // Server-Abdunklung: Parameter landen in der Transcode-URL
  N.plex.base = 'http://192.0.2.1:32400'; N.plex.token = 'T';
  var u = N.img.url('/a/1', 'amb', A.artOpts('soft'));
  assert.ok(/width=320&height=180/.test(u) && /blur=18/.test(u) && /opacity=16/.test(u) && /background=0E0F11/.test(u), u);
});
test('Runde 5: Bild-URL je Ziel (im Idle vorgerechnet) = dieselbe wie frueher in _apply; Poster weich, Art scharf beschnitten', function () {
  N.plex.base = 'http://192.0.2.1:32400'; N.plex.token = 'T';
  var am = new N.ui.Ambient({}, {}), ao = A.artOpts('soft');
  am.str = 'soft';
  eq(am._url({ key: 'a:/a/1', art: '/a/1' }), { key: 'a:/a/1', str: 'soft', url: N.img.url('/a/1', 'amb', ao), soft: false });
  eq(am._url({ key: 't:/t/1', thumb: '/t/1' }), { key: 't:/t/1', str: 'soft', url: N.img.url('/t/1', 'amb', ao), soft: true });
  var ub = '0102030405060708090a0b0c';
  eq(am._url({ key: 'm:' + ub, mood: ub }).url, A.moodUrl(ub, 'soft'));
  eq(am._url({ key: 'base' }).url, A.baseUrl());
});

test('Zufallsbild: erster Titel mit Art, sonst mit Farben/Poster, sonst keiner', function () {
  assert.strictEqual(A.pickRandom([{ t: 1 }, { t: 2, thumb: '/t' }, { t: 3, art: '/a' }]).t, 3);
  assert.strictEqual(A.pickRandom([{ t: 1 }, { t: 2, thumb: '/t' }]).t, 2);
  assert.strictEqual(A.pickRandom([{ t: 1 }]), null);
  assert.strictEqual(A.pickRandom(null), null);
});
test('Entprellung: gehaltene Taste (160 ms) loest nie aus, erst 600 ms nach der letzten Taste genau einmal; hoechstens ein Timer', function () {
  var fired = 0, last = T.now(), s = new A.Settle(600, function () { fired++; }, function () { return T.now() - last; });
  for (var i = 0; i < 20; i++) { last = T.now(); s.poke(); assert.ok(T.pending() <= 1, 'ein Timer'); T.tick(160); }
  assert.strictEqual(fired, 0);
  T.tick(400); assert.strictEqual(fired, 0, 'erst 560 ms Ruhe');
  T.tick(100); assert.strictEqual(fired, 1);
  T.tick(5000); assert.strictEqual(fired, 1, 'nur einmal');
  last = T.now(); s.poke(); s.cancel(); T.tick(2000); assert.strictEqual(fired, 1, 'abgebrochen (Ansicht weg)');
});
