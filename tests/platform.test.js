'use strict';
/* Vertrag der Plattform-Schicht (src/platform/platform.js): Pruefung, Standard-Faehigkeiten (Fernseher 2014), Ergaenzung
 * fehlender caps-Felder. Der Orsay-Adapter kommt mit P1 C2 (platforms/samsung-orsay/adapter/) und eigenen Tests dazu. */
var test = require('node:test'), assert = require('node:assert');
var load = require('./helpers/load.js').load;
function J(v) { return JSON.parse(JSON.stringify(v)); }   // Werte aus dem vm-Kontext (fremde Array-Prototypen)

/* kleinster gueltiger Adapter (Form wie ein echter, Rumpf leer) */
function minimal() {
  return {
    id: 'test-tv',
    info: { platform: 'Test', platformVersion: '1', device: 'Test TV', short: 'Test', model: '' },
    init: function () {},
    keys: { name: function () { return null; }, register: function () {},
      cap: { EXIT: 'EXIT', DIGITS: '0-9', ENTER: 'OK', INFO: 'INFO', TOOLS: 'TOOLS' } },
    store: function (ctx) { return ctx.store; },
    player: { create: function () { return { exec: function () {}, close: function () {} }; }, close: function () {}, surface: 'plane' },
    tv: { saver: function () {}, exit: function () {}, language: function () { return ''; } },
    screen: { toApp: function (x, y) { return { x: x, y: y }; } },
    net: { plexTv: function (u) { return u; }, kind: function () { return 'lan'; } }
  };
}

test('Minimal-Adapter erfuellt den Vertrag; use() setzt N.platform mit Standard-caps', function () {
  var N = load().N, PL = N.Platform, p = minimal();
  assert.deepStrictEqual(J(PL.check(p)), []);
  assert.strictEqual(PL.use(p), p);
  assert.strictEqual(N.platform, p);
  assert.deepStrictEqual(J(p.caps), J(PL.defaults()));
  assert.strictEqual(p.net.factory, null);
  assert.strictEqual(p.auth, null);
  assert.strictEqual(p.caps.webLogin, false);
});

test('Standard-caps = heutiges Verhalten des Fernsehers (alles aus, setup.json/Helfer an, SEF)', function () {
  var d = load().N.Platform.defaults();
  ['tls12', 'touch', 'textInput', 'pip', 'secureStore', 'backgroundAudio', 'webLogin', 'cellular', 'haptic'].forEach(function (k) { assert.strictEqual(d[k], false, k); });
  assert.strictEqual(d.setupFile, true); assert.strictEqual(d.helper, true);
  assert.strictEqual(d.trick, 'sef'); assert.strictEqual(d.subsEmbedded, 'sef');
  assert.strictEqual(d.exit, true); assert.strictEqual(d.focusRing, 'always'); assert.strictEqual(d.scroll, 'focus');
  assert.strictEqual(d.home, 'hero'); assert.strictEqual(d.cardTap, 'ok'); assert.strictEqual(d.images, 'tv');   // TV-Standard
  assert.strictEqual(d.codecs.hevc, false); assert.strictEqual(d.codecs.maxResolution, '1920x1080');
  assert.deepStrictEqual(J(d.screen), { w: 1280, h: 720, scale: 1, safe: { t: 0, r: 0, b: 0, l: 0 }, flex: false });
});

test('Vertrag: fehlende Felder und unsinnige caps werden gemeldet, use() wirft', function () {
  var PL = load().N.Platform;
  assert.deepStrictEqual(J(PL.check(null)), ['Plattform fehlt']);
  var e = PL.check({ id: 'Apple TV' });
  ['id fehlt oder ungueltig', 'info.platform fehlt', 'init(ctx) fehlt', 'keys.name(code, ev) fehlt', 'store(ctx) fehlt',
    'player.create/close fehlt', 'tv.saver/exit/language fehlt', 'screen.toApp fehlt', 'net.plexTv/kind fehlt'].forEach(function (m) {
    assert.ok(e.indexOf(m) >= 0, m + ' in ' + e.join(' | '));
  });
  var bad = minimal();
  bad.caps = { trick: 'rueckwaerts', touch: 'ja', setupFile: false };
  var e2 = PL.check(bad);
  assert.ok(e2.indexOf('caps.trick ungueltig') >= 0);
  assert.ok(e2.indexOf('caps.touch muss true/false sein') >= 0);
  assert.ok(e2.indexOf('ohne TLS 1.2 braucht die Plattform setup.json (caps.setupFile)') >= 0);
  bad.caps = { secureStore: true };
  assert.ok(PL.check(bad).indexOf('caps.secureStore ohne tls12 ist nicht vorgesehen') >= 0);
  bad.caps = { screen: { w: 1920, h: 1080, scale: 1 } };
  assert.ok(PL.check(bad).indexOf('caps.screen: App-Raster 1280x720, scale > 0') >= 0);
  bad.caps = { tls12: true, setupFile: false, webLogin: true };
  assert.ok(PL.check(bad).indexOf('caps.webLogin braucht auth.web/close') >= 0);
  bad.caps = { haptic: true };
  assert.ok(PL.check(bad).indexOf('caps.haptic braucht haptic.prepare/select') >= 0, 'Haptik (LIB-12) nur mit haptic.prepare/select');
  bad.caps = { haptic: 'ja' };
  assert.ok(PL.check(bad).indexOf('caps.haptic muss true/false sein') >= 0);
  bad.caps = { focusRing: 'nie', scroll: 'frei', exit: 'nein' };
  var e3 = PL.check(bad);
  assert.ok(e3.indexOf('caps.focusRing muss always|keys sein') >= 0);
  bad.caps = { home: 'kacheln', cardTap: 'tap', images: 'schnell' };
  var e4 = PL.check(bad);
  assert.ok(e4.indexOf('caps.home muss hero|tiles sein') >= 0 && e4.indexOf('caps.cardTap muss ok|details sein') >= 0 && e4.indexOf('caps.images muss tv|fast sein') >= 0, e4.join('; '));
  bad.caps = { home: 'tiles', cardTap: 'details', images: 'fast' };
  assert.strictEqual(PL.check(bad).filter(function (m) { return /home|cardTap|images/.test(m); }).length, 0);
  assert.ok(e3.indexOf('caps.scroll muss focus|free sein') >= 0);
  assert.ok(e3.indexOf('caps.exit muss true/false sein') >= 0);
  bad.caps = { focusRing: 'keys', scroll: 'free', exit: false };
  assert.strictEqual(PL.check(bad).filter(function (m) { return /focusRing|scroll|exit/.test(m); }).length, 0);
  bad.caps = { webLogin: 'ja' };
  assert.ok(PL.check(bad).indexOf('caps.webLogin muss true/false sein') >= 0);
  bad.caps = { webLogin: true };
  bad.auth = { web: function () {}, close: function () {} };
  assert.ok(PL.check(bad).indexOf('caps.webLogin ohne tls12 ist nicht vorgesehen') >= 0);
  bad.auth = { web: function () {} };
  assert.ok(PL.check(bad).indexOf('auth.web/close fehlt') >= 0);
  delete bad.auth;
  bad.player.surface = 'fenster';
  assert.ok(PL.check(bad).indexOf('player.surface muss plane|element sein') >= 0);
  assert.throws(function () { PL.use(bad); }, /N\.platform test-tv: /);
});

test('Faehigkeiten eines Touch-Geraets: fehlende caps-Felder = Standard, codecs/screen feldweise ergaenzt', function () {
  var PL = load().N.Platform, p = minimal();
  p.id = 'apple'; p.player.surface = 'element';
  p.caps = { tls12: true, touch: true, textInput: true, pip: true, secureStore: true, backgroundAudio: true, setupFile: false,
    helper: false, trick: 'seek', subsEmbedded: 'vtt', codecs: { hevc: { maxBitDepth: 10 }, h264: true }, screen: { w: 1280, h: 720, scale: 2 } };
  assert.deepStrictEqual(J(PL.check(p)), []);
  var c = PL.caps(p.caps);
  assert.strictEqual(c.codecs.streamSelection, true);
  assert.strictEqual(c.codecs.maxResolution, '1920x1080');
  assert.deepStrictEqual(J(c.screen.safe), { t: 0, r: 0, b: 0, l: 0 });
});

test('Flexible Flaeche (caps.screen.flex, Apple): Mindestflaeche und screen.size() Pflicht; ohne flex bleibt 1280x720 fest', function () {
  var PL = load().N.Platform, p = minimal();
  p.caps = { screen: { w: 1280, h: 720, scale: 2, flex: true } };
  assert.ok(PL.check(p).indexOf('caps.screen.flex braucht screen.size()') >= 0);
  p.screen.size = function () { return { w: 1280, h: 960 }; };
  assert.deepStrictEqual(J(PL.check(p)), []);
  p.caps = { screen: { w: 720, h: 1280, scale: 2, flex: true } };      // Hochformat-Mindestflaeche (Nr. 16) ist erlaubt
  assert.deepStrictEqual(J(PL.check(p)), []);
  p.caps = { screen: { w: 0, h: 720, scale: 1, flex: true } };
  assert.ok(PL.check(p).indexOf('caps.screen: flexible Mindestflaeche >= 360x360, scale > 0') >= 0);
  p.caps = { screen: { flex: 'ja' } };
  assert.ok(PL.check(p).indexOf('caps.screen.flex muss true/false sein') >= 0);
  p.caps = { screen: { w: 1280, h: 960, scale: 1 } };                 // ohne flex: weiter nur 1280x720
  assert.ok(PL.check(p).indexOf('caps.screen: App-Raster 1280x720, scale > 0') >= 0);
  assert.strictEqual(PL.caps({ screen: { w: 1280, h: 720, scale: 2 } }).screen.flex, false);
});

/* ---- Orsay-Adapter (platforms/samsung-orsay/adapter/platform.js): gleiches Verhalten wie der heutige Code ---- */
function orsay() { var ctx = load(), logs = []; ctx.N.log = function (m) { logs.push(m); }; return { N: ctx.N, logs: logs }; }

test('Orsay-Adapter ist geladen, erfuellt den Vertrag, caps = Standard', function () {
  var s = orsay(), P = s.N.platform;
  assert.strictEqual(P.id, 'samsung-orsay');
  assert.deepStrictEqual(J(s.N.Platform.check(P)), []);
  assert.deepStrictEqual(J(P.caps), J(s.N.Platform.defaults()));
  assert.strictEqual(P.net.factory, null);
});

/* am TV verifizierte Orsay-Codes (docs/PHASE1-ERGEBNISSE.md) – bis P1 C4 stand die Tabelle in src/core/keys.js */
var ORSAY = { 29443: 'ENTER', 88: 'RETURN', 29460: 'UP', 29461: 'DOWN', 4: 'LEFT', 5: 'RIGHT', 108: 'RED', 20: 'GREEN', 21: 'YELLOW',
  22: 'BLUE', 31: 'INFO', 75: 'TOOLS', 71: 'PLAY', 74: 'PAUSE', 70: 'STOP', 72: 'FF', 69: 'RW', 68: 'CH_UP', 65: 'CH_DOWN', 652: 'SUBTITLE',
  17: '0', 101: '1', 98: '2', 6: '3', 8: '4', 9: '5', 10: '6', 12: '7', 13: '8', 14: '9' };

test('Orsay-Tasten: Codes wie am TV verifiziert, N.keys reicht weiter, jeder Vertrags-Name belegt', function () {
  var s = orsay(), K = s.N.platform.keys, seen = {};
  assert.deepStrictEqual(J(K.CODES), ORSAY);
  Object.keys(ORSAY).forEach(function (c) { assert.strictEqual(s.N.keys.name(Number(c)), ORSAY[c], 'Code ' + c); seen[ORSAY[c]] = 1; });
  [0, 1, 99999, -1, null, undefined].forEach(function (c) { assert.strictEqual(s.N.keys.name(c), null); });
  s.N.Platform.KEYS.forEach(function (k) { assert.ok(seen[k], 'Taste ' + k + ' ohne Code'); });
  assert.deepStrictEqual(J(K.cap), J(s.N.keys.cap));
});

test('Orsay info = heutige N.config-Werte (X-Plex-Kopfzeilen bleiben gleich)', function () {
  var s = orsay(), i = s.N.platform.info, C = s.N.config;
  assert.strictEqual(i.platform, C.platform); assert.strictEqual(i.platformVersion, C.platformVersion);
  assert.strictEqual(i.device, C.device); assert.strictEqual(i.model, C.model);
  assert.strictEqual(C.deviceName, s.N.brand.name + ' (' + i.short + ')');
});

test('Orsay tv/keys.register: dieselben Plugin-Aufrufe wie src/app.js', function () {
  var s = orsay(), P = s.N.platform, calls = [];
  var plugin = { setOnScreenSaver: function () { calls.push('on'); }, setOffScreenSaver: function () { calls.push('off'); },
    registKey: function (c) { calls.push('reg ' + c); } };
  var widget = { sendReturnEvent: function () { calls.push('return'); } };
  P.tv.saver(true); P.tv.exit(); P.keys.register(['SUBTITLE']);           // ohne ctx: nichts, kein Fehler
  assert.deepStrictEqual(calls, []);
  P.init({ pluginAPI: plugin, widgetAPI: widget, tvKey: { KEY_SUBTITLE: 652, KEY_CH_UP: 68, KEY_CH_DOWN: 65 } });
  P.tv.saver(false); P.tv.saver(true); P.tv.exit();
  P.keys.register(['SUBTITLE', 'CH_UP', 'CH_DOWN', 'GIBTSNICHT']);
  assert.deepStrictEqual(calls, ['off', 'on', 'return', 'reg 652', 'reg 68', 'reg 65']);
  P.init({ pluginAPI: { registKey: function () { throw new Error('kaputt'); } }, tvKey: { KEY_SUBTITLE: 652 } });
  P.keys.register(['SUBTITLE']);
  assert.ok(s.logs.indexOf('registKey KEY_SUBTITLE kaputt') >= 0, 'Fehlertext wie app.js');
  assert.strictEqual(P.tv.language(), '');                                  // ohne TVMW-Plugin (Node/Vorschau)
});

test('Orsay store/player/net/screen reichen an den heutigen Code weiter', function () {
  var s = orsay(), P = s.N.platform, st = { read: function () { return 'x'; }, write: function () { return true; } };
  assert.strictEqual(P.store({ store: st }), st);
  assert.strictEqual(P.store({}).read('a'), null);
  var p = P.player.create(function () {});
  assert.strictEqual(p.fake, true);                                         // ohne #pluginSef: Faelschung aus platforms/samsung-orsay/adapter/sef.js
  P.player.close();
  assert.strictEqual(P.player.surface, 'plane');
  s.N.config.proxyHost = '192.0.2.5:8443';
  assert.strictEqual(P.net.plexTv('https://plex.tv/api/v2/pins'), s.N.config.proxy('https://plex.tv/api/v2/pins'));
  assert.strictEqual(P.net.kind(), 'lan');
  assert.deepStrictEqual(J(P.screen.toApp(12, 34)), { x: 12, y: 34 });
});

test('C6: X-Plex-Kopfzeilen und plex.tv-Weg wie vor P1 (Werte vom Stand vor dem Umzug festgeschrieben)', function () {
  var s = orsay(), h = J(s.N.plex.headers('t'));
  assert.strictEqual(h['X-Plex-Platform'], 'Samsung');
  assert.strictEqual(h['X-Plex-Platform-Version'], 'Orsay 2014');
  assert.strictEqual(h['X-Plex-Device'], 'Samsung TV');
  assert.strictEqual(h['X-Plex-Device-Name'], s.N.brand.name + ' (TV)');
  assert.strictEqual(s.N.config.model, 'UE48H8000');
  s.N.config.proxyHost = '192.0.2.5:8443';
  assert.strictEqual(s.N.platform.net.plexTv('https://plex.tv/api/v2/pins'), 'http://192.0.2.5:8443/?url=https%3A%2F%2Fplex.tv%2Fapi%2Fv2%2Fpins');
});

/* X-Plex-Client-Profile-Extra vor P1 (src/player/decision.js, feste Liste) – muss zeichengleich bleiben */
var EXTRA_C0 = ['add-limitation(scope=videoCodec&scopeName=hevc&type=upperBound&name=video.width&value=0&isRequired=false)',
  'add-limitation(scope=videoCodec&scopeName=h264&type=upperBound&name=video.bitDepth&value=8&isRequired=false)',
  'add-limitation(scope=videoCodec&scopeName=h264&type=upperBound&name=video.level&value=41&isRequired=false)',
  'add-limitation(scope=videoCodec&scopeName=h264&type=upperBound&name=video.width&value=1920&isRequired=false)',
  'add-limitation(scope=videoCodec&scopeName=h264&type=upperBound&name=video.height&value=1088&isRequired=false)',
  'add-settings(DirectPlayStreamSelection=true)',
  'add-transcode-target(type=subtitleProfile&context=all&protocol=http&container=srt&subtitleCodec=srt)'].join('+');

test('C7: EXTRA aus caps.codecs ist zeichengleich mit dem Stand vor P1; videoResolution bleibt 1920x1080', function () {
  var s = orsay();
  assert.strictEqual(s.N.decision.EXTRA, EXTRA_C0);
  assert.strictEqual(s.N.decision.extraFor(s.N.platform.caps.codecs), EXTRA_C0);
  var q = s.N.decision.query({ rk: 1, session: 's', clientId: 'c', token: 't', dp: 1, ds: 1 });
  assert.strictEqual(q.videoResolution, '1920x1080');
  assert.strictEqual(q['X-Plex-Client-Profile-Extra'], EXTRA_C0);
});

test('C7: Geraet mit HEVC – keine HEVC-Sperre, eigene H.264-Grenzen; ohne Grenzen leer', function () {
  var x = orsay().N.decision.extraFor({ hevc: { maxBitDepth: 10 }, h264: { maxLevel: 52 }, streamSelection: true, subtitleTarget: 'srt' });
  assert.ok(x.indexOf('scopeName=hevc&type=upperBound&name=video.width&value=0') < 0);
  assert.ok(x.indexOf('scopeName=hevc&type=upperBound&name=video.bitDepth&value=10') >= 0);
  assert.ok(x.indexOf('scopeName=h264&type=upperBound&name=video.level&value=52') >= 0);
  assert.ok(x.indexOf('video.width&value=1920') < 0);
  assert.strictEqual(orsay().N.decision.extraFor({ hevc: true, h264: true }), '');
});
