'use strict';
/* Sprachtabellen als eigene Dateien (TV-Leistung 03.11.): app.js/app.min.js ohne Texte, je Sprache app/i18n/<lang>.js,
 * N.i18n.load laedt nur die aktive Sprache. Hier: kein Modul ruft N.t beim Laden (sonst stuende dort der Schluessel),
 * Nachladen per <script> (gemeinsame Ladung, Fehler, Zeitlimit), Start wartet auf die Tabelle, Sprachwechsel laedt nach. */
var test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path'), vm = require('vm');
var H = require('./helpers/load');
var ROOT = path.join(__dirname, '..'), SRC = path.join(ROOT, 'src');

test('kein Modul ruft N.t/N.tn beim Laden (Texte kommen erst danach aus i18n/<lang>.js)', function () {
  var plat = require('../tools/platform.js'), manifest = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
  var pabs = {}, pi = manifest.indexOf('platform/platform.js'), pm = plat.modules(plat.DEFAULT);
  pm.forEach(function (m) { pabs[m.rel] = m.abs; });
  manifest = manifest.slice(0, pi + 1).concat(pm.map(function (m) { return m.rel; }), manifest.slice(pi + 1));
  var ctx = { console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: function () {}, clearInterval: function () {} };
  ctx.window = ctx; vm.createContext(ctx);
  var cur = '', calls = [];
  manifest.forEach(function (f) {
    if (/(^|\/)strings[^\/]*\.js$/.test(f)) return;          // wie der Build: Texte nicht im Bundle
    cur = f;
    vm.runInContext(fs.readFileSync(pabs[f] || path.join(SRC, f), 'utf8'), ctx, { filename: f });
    if (f === 'i18n/i18n.js') {
      var t = ctx.N.t, tn = ctx.N.tn;
      ctx.N.t = function (k) { calls.push(cur + ': ' + k); return t.apply(this, arguments); };
      ctx.N.tn = function (k) { calls.push(cur + ': ' + k); return tn.apply(this, arguments); };
    }
  });
  assert.deepStrictEqual(calls, []);
  assert.strictEqual(ctx.N.t('hint.back'), 'hint.back');   // ohne Tabelle: Schluessel, kein Absturz
});

function fakeDoc(N, behave, setTimeout) {
  var added = [];
  return {
    added: added,
    createElement: function () { return {}; },
    getElementsByTagName: function () {
      return [{ appendChild: function (s) {
        added.push(s.src);
        var l = /i18n\/([a-z]+)\.js$/.exec(s.src)[1], b = behave(l);
        if (b === 'ok') setTimeout(function () { N.strings[l] = { 'hint.back': 'X-' + l }; s.onload(); }, 1);
        else if (b === 'err') setTimeout(function () { s.onerror(); }, 1);
      } }];
    }
  };
}

test('N.i18n.load: laedt i18n/<lang>.js einmal, teilt die Ladung, meldet Fehler und Zeitlimit', function () {
  var ctx = H.load({ fakeTimers: true }), N = ctx.N;
  delete N.strings.nb; delete N.strings.en;
  var d = fakeDoc(N, function (l) { return l === 'nb' ? 'ok' : l === 'en' ? 'err' : 'hang'; }, ctx.setTimeout), got = [];
  ctx.document = d; N.assetBase = 'http://192.0.2.1:8090/';
  N.i18n.load('nb', function (ok, l) { got.push('a ' + ok + ' ' + l); });
  N.i18n.load('nb', function (ok) { got.push('b ' + ok); });
  N.i18n.load('en', function (ok) { got.push('en ' + ok); });
  N.i18n.load('xx', function (ok, l) { got.push('xx ' + ok + ' ' + l); });   // unbekannt -> de (im Test schon da)
  ctx.timers.tick(5);
  assert.deepStrictEqual(d.added, ['http://192.0.2.1:8090/i18n/nb.js', 'http://192.0.2.1:8090/i18n/en.js']);
  assert.deepStrictEqual(got, ['xx true de', 'a true nb', 'b true', 'en false']);
  N.i18n.load('nb', function (ok) { got.push('c ' + ok); });                  // schon da: sofort, ohne neue Ladung
  assert.strictEqual(d.added.length, 2); assert.strictEqual(got[4], 'c true');
  delete N.strings.de; d = fakeDoc(N, function () { return 'hang'; }, ctx.setTimeout); ctx.document = d;
  N.i18n.load('de', function (ok) { got.push('de ' + ok); });
  ctx.timers.tick(4100);
  assert.strictEqual(got[5], 'de false');                                     // Zeitlimit 4 s
});

test('Sprachwechsel laedt die Tabelle der neuen Sprache nach, erst dann wechselt die Oberflaeche', function () {
  var ctx = H.load({ fakeTimers: true }), N = ctx.N, seen = [];
  delete N.strings.nb;
  ctx.document = fakeDoc(N, function (l) { seen.push(l); return 'ok'; }, ctx.setTimeout);
  var langs = [];
  var orig = N.session.save; N.session.save = function () {};
  N.router.rebuild = function () { langs.push(N.i18n.lang()); };
  N.session.state = N.session.state || {};
  N.app.setLang('nb');
  assert.strictEqual(N.i18n.lang() === 'nb', false);                           // noch nicht da
  ctx.timers.tick(5);
  assert.deepStrictEqual(seen, ['nb']);
  assert.strictEqual(N.i18n.lang(), 'nb'); assert.strictEqual(N.t('hint.back'), 'X-nb');
  assert.deepStrictEqual(langs, ['nb']);
  N.session.save = orig; N.i18n.set('de');
});

test('Build: app.js/app.min.js ohne Text-Module, je Sprache app/i18n/<lang>.js mit allen Schluesseln (wenn gebaut)', { skip: !fs.existsSync(path.join(ROOT, 'app', 'i18n', 'de.js')) && 'nicht gebaut' }, function () {
  var app = fs.readFileSync(path.join(ROOT, 'app', 'app.js'), 'utf8');
  assert.ok(app.indexOf('===== i18n/strings.de.js') < 0 && app.indexOf('N.strings.de = {') < 0, 'Texte im Bundle');
  ['de', 'en', 'nb'].forEach(function (l) {
    var t = fs.readFileSync(path.join(ROOT, 'app', 'i18n', l + '.js'), 'utf8'), c = { N: {} };
    assert.ok(!/[^\x00-\x7e]/.test(t), l + ': nur ASCII');
    vm.createContext(c); vm.runInContext(t, c);
    var de = H.load().N.strings.de;
    Object.keys(de).forEach(function (k) { if (!/^rq\./.test(k)) assert.ok(k in c.N.strings[l], l + ' fehlt ' + k); });
  });
});
