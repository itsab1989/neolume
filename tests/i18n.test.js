'use strict';
var test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
var H = require('./helpers/load'), rules = require('../tools/i18n_rules');
var N = H.load().N;
function eq(a, b) { assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b); }   // vm-Kontext: Objekte aus anderem Realm
var SRC = path.join(__dirname, '..', 'src');

test('DE und EN haben dieselben Schluessel, Platzhalter, Grenzen und Zeichen', function () {
  eq(rules.check(N.strings.de, N.strings.en), []);
  eq(Object.keys(N.strings.de).sort(), Object.keys(N.strings.en).sort());
});

test('Gate erkennt Fehler (fehlender Schluessel, Platzhalter, Laenge, Zeichen)', function () {
  var errs = rules.check({ 'a.b': 'x', 'toast.x': 'Hallo {name}', 'hint.y': 'Viel zu langer Hinweis', 'z': 'ok' },
    { 'toast.x': 'Hello {nam}', 'hint.y': 'ok', 'z': '中' });
  assert.ok(errs.some(function (e) { return /EN fehlt: a\.b/.test(e); }));
  assert.ok(errs.some(function (e) { return /Platzhalter ungleich: toast\.x/.test(e); }));
  assert.ok(errs.some(function (e) { return /Zu lang \(de .*hint\.y/.test(e); }));
  assert.ok(errs.some(function (e) { return /Font-Subset \(en/.test(e); }));
});

test('jeder im Code benutzte Schluessel existiert in beiden Sprachen', function () {
  var used = {}, files = [];
  (function scan(d) { fs.readdirSync(d).forEach(function (f) { var p = path.join(d, f); if (fs.statSync(p).isDirectory()) { if (f !== 'private') scan(p); } else if (/\.js$/.test(f) && !/strings\./.test(f)) files.push(p); }); })(SRC);
  files.forEach(function (p) {
    var s = fs.readFileSync(p, 'utf8'), m, re = /N\.tn?\('([a-zA-Z0-9_.]+)'(?!\s*\+)|\b(?:t|label|desc|ddesc|tk): '([a-z]+\.[a-zA-Z0-9_.]+)'/g;
    while ((m = re.exec(s))) used[m[1] || m[2]] = p;
  });
  // zusammengesetzte Schluessel
  ['main', 'kid', 'teen'].forEach(function (k) { used['prof.sub.' + k] = 1; });
  ['network', 'server', 'proxy', 'auth', 'generic'].forEach(function (k) { used['err.' + k + '.title'] = used['err.' + k + '.text'] = 1; });
  ['display', 'account', 'diag', 'help'].forEach(function (k) { used['set.cat.' + k] = used['set.cat.' + k + '.desc'] = 1; });
  ['dlg.markShow', 'dlg.unmarkShow', 'dlg.markSeason', 'dlg.unmarkSeason'].forEach(function (k) { used[k + '.title'] = used[k + '.text'] = 1; });
  ['de', 'en'].forEach(function (l) { used['lang.' + l] = 1; });
  ['login.step2', 'login.step3', 'soon.details', 'soon.player', 'empty.home.title', 'empty.home.text', 'empty.home.kids.title', 'empty.home.kids.text'].forEach(function (k) { used[k] = 1; });
  var missing = Object.keys(used).filter(function (k) { return !/\.$/.test(k) && !(k in N.strings.de) || !(k in N.strings.en); });
  eq(missing, []);
  assert.ok(Object.keys(used).length > 100);
});

test('t/tn setzen Platzhalter und Mehrzahl, Sprachwechsel wirkt sofort', function () {
  N.i18n.set('de');
  assert.strictEqual(N.t('toast.signedIn', { name: 'Kim' }), 'Angemeldet als Kim');
  assert.strictEqual(N.tn('meta.seasons', 1), '1 Staffel');
  assert.strictEqual(N.tn('meta.seasons', 3), '3 Staffeln');
  assert.strictEqual(N.i18n.plexLanguage(), 'de-DE');
  N.i18n.set('en');
  assert.strictEqual(N.tn('meta.seasons', 3), '3 seasons');
  assert.strictEqual(N.t('card.sub.episodeLeft', { s: 1, e: 5, time: '14 min' }), 'S1 · E5 · 14 min left');
  assert.strictEqual(N.i18n.plexLanguage(), 'en-US');
  N.i18n.set('xx');
  assert.strictEqual(N.i18n.lang(), 'de');
});

test('TV-Sprache: Deutsch/Englisch erkannt, alles andere Deutsch', function () {
  assert.strictEqual(N.i18n.detect('en-GB'), 'en');
  assert.strictEqual(N.i18n.detect('en_US'), 'en');
  assert.strictEqual(N.i18n.detect('eng'), 'en');
  assert.strictEqual(N.i18n.detect('de-DE'), 'de');
  assert.strictEqual(N.i18n.detect('fr-FR'), 'de');
  assert.strictEqual(N.i18n.detect(7), 'de');
  assert.strictEqual(N.i18n.detect(''), 'de');
});

test('Formatierung DE und EN (Dauer, Bewertung, FSK)', function () {
  N.i18n.set('de');
  assert.strictEqual(N.fmt.dur(24 * 60000), '24 Min.');
  assert.strictEqual(N.fmt.dur(62 * 60000), '1 Std. 2 Min.');
  assert.strictEqual(N.fmt.dur(120 * 60000), '2 Std.');
  assert.strictEqual(N.fmt.rating(8.94), '8,9/10');
  assert.strictEqual(N.fmt.rated('de/12'), 'FSK 12');
  assert.strictEqual(N.fmt.rated('TV-14'), 'TV-14');
  N.i18n.set('en');
  assert.strictEqual(N.fmt.dur(62 * 60000), '1 hr 2 min');
  assert.strictEqual(N.fmt.rating(8.94), '8.9/10');
  N.i18n.set('de');
});

test('Keine Symbole ausserhalb der TV-Schrift in Quelltext-Strings (NUTZER-FEEDBACK-REGELN 10)', function () {
  var fs = require('fs'), path = require('path'), acorn = require('acorn'), BANNED = require('../tools/i18n_rules').BANNED, bad = [];
  (function walk(dir) {
    fs.readdirSync(dir).forEach(function (f) {
      var p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) return walk(p);
      if (!/\.js$/.test(f)) return;
      var src = fs.readFileSync(p, 'utf8');
      for (var tok of acorn.tokenizer(src, { ecmaVersion: 5, locations: true })) {
        if (tok.type !== acorn.tokTypes.string) continue;
        for (var i = 0; i < BANNED.length; i++) if (String(tok.value).indexOf(BANNED.charAt(i)) >= 0) bad.push(path.relative(dir, p) + ':' + tok.loc.start.line + ' ' + BANNED.charAt(i));
      }
    });
  })(path.join(__dirname, '..', 'src'));
  assert.deepStrictEqual(bad, []);
});
