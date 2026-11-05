'use strict';
/* Akzentfarbe waehlbar: Palette (Lesbarkeit), Build-Varianten je Farbe (tools/build.js), Einstellung + Anwenden (N.accent). */
var test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
var B = require('../tools/build');
var H = require('./helpers/load'), eq = H.eq;
var ROOT = path.join(__dirname, '..');

function lum(h) {
  var c = [1, 3, 5].map(function (i) { var v = parseInt(h.substr(i, 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
function brands() {
  return fs.readdirSync(path.join(ROOT, 'brand')).filter(function (f) { return /\.json$/.test(f); })
    .map(function (f) { return JSON.parse(fs.readFileSync(path.join(ROOT, 'brand', f), 'utf8')); });
}
var PUB = { accent: '#2EC4B6', pointer: 'pointer-teal', accentId: 'teal' };

/* ---------- Palette ---------- */
test('Palette: 7 Farben, eindeutig, Bernstein + Tuerkis dabei', function () {
  var p = B.loadPalette(), ids = p.map(function (x) { return x.id; });
  assert.ok(p.length >= 7);
  assert.strictEqual(new Set(ids).size, ids.length);
  assert.ok(ids.indexOf('amber') >= 0 && ids.indexOf('teal') >= 0);
  p.forEach(function (x) { assert.ok(/^[a-z]+$/.test(x.id) && /^#[0-9A-F]{6}$/.test(x.color), x.id); });
});
test('Palette + Markenfarben: Schrift #141414 auf dem Akzent und der Akzent auf #121316/#0E0F11 je >= 4.5:1 (WCAG AA)', function () {
  var cols = B.loadPalette().map(function (x) { return [x.id, x.color]; });
  brands().forEach(function (b) { cols.push([b.id + ':' + b.accentId, b.accent]); });
  cols.forEach(function (c) {
    assert.ok(contrast('#141414', c[1]) >= 4.5, c[0] + ' Schrift ' + contrast('#141414', c[1]).toFixed(2));
    assert.ok(contrast(c[1], '#121316') >= 4.5, c[0] + ' auf Panel ' + contrast(c[1], '#121316').toFixed(2));
    assert.ok(contrast(c[1], '#0E0F11') >= 4.5, c[0] + ' auf Hintergrund');
  });
});
test('Marken: accentId ist eine Palettenfarbe; die gemeinsame Palette enthaelt nicht die Markenfarbe der privaten Fassung', function () {
  var ids = B.loadPalette().map(function (x) { return x.id; }), src = fs.readFileSync(path.join(ROOT, 'src', 'core', 'accent.js'), 'utf8');
  brands().forEach(function (b) {
    assert.ok(ids.indexOf(b.accentId) >= 0, b.id);
    if (b.id !== 'public') assert.ok(src.toLowerCase().indexOf(b.accent.toLowerCase()) < 0, 'Markenfarbe ' + b.id + ' gehoert nur ins Markenprofil');
  });
  var pub = brands().filter(function (b) { return b.id === 'public'; })[0];
  if (pub) assert.strictEqual(pub.accentId, 'teal');
});
test('brandPalette: Standardfarbe mit Markenwert und Marken-Zeiger, die anderen mit pointer-<id>; alle Zeiger-Bilder vorhanden', function () {
  brands().forEach(function (b) {
    var p = B.brandPalette(b), base = p.filter(function (x) { return x.base; });
    assert.strictEqual(base.length, 1);
    assert.strictEqual(base[0].id, b.accentId); assert.strictEqual(base[0].color, b.accent); assert.strictEqual(base[0].pointer, b.pointer);
    p.forEach(function (x) {
      if (!x.base) assert.strictEqual(x.pointer, 'pointer-' + x.id);
      ['', '-press'].forEach(function (s) { assert.ok(fs.existsSync(path.join(ROOT, 'src', 'assets', x.pointer + s + '.png')), x.pointer + s); });
    });
  });
});

/* ---------- Build: Varianten je Farbe ---------- */
test('Build: Grundregel unbeschriftet in der Markenfarbe, je andere Farbe eine Variante nur mit den Token-Deklarationen', function () {
  var r = B.css('.btn { height: 48px; }\n.btn.is-focus { background: @accent@; color: #141414; }', PUB);
  eq(r.errors, []);
  assert.ok(r.css.indexOf('.btn.is-focus{background:#2EC4B6;color:#141414}') === 0 || r.css.indexOf('.btn{height:48px}.btn.is-focus{background:#2EC4B6;color:#141414}') === 0);
  B.brandPalette(PUB).forEach(function (p) {
    if (p.base) assert.ok(r.css.indexOf('.ac-' + p.id + ' ') < 0, 'keine Klasse fuer die Standardfarbe');
    else assert.ok(r.css.indexOf('.ac-' + p.id + ' .btn.is-focus{background:' + p.color + '}') >= 0, p.id);
    assert.ok(r.css.indexOf('.sw-' + p.id + '{background:' + p.color + '}') >= 0, 'Farbfeld ' + p.id);
  });
  assert.ok(!/@accent@|@pointer@/.test(r.css));
  assert.ok(!/\.ac-[a-z]+ \.btn\{/.test(r.css), 'Regeln ohne Token werden nicht kopiert');
  assert.strictEqual(r.stats.tokenRules, 1); assert.strictEqual(r.stats.variants, B.loadPalette().length - 1);
});
test('Build: Zeiger-Token je Farbe (pointer-<id>), Standardfarbe mit dem Zeiger der Marke', function () {
  var r = B.css('.pcur { background-image: url(@A/@pointer@.png); }', { accent: '#E0A010', pointer: 'pointer', accentId: 'amber' });
  eq(r.errors, []);
  assert.ok(r.css.indexOf('.pcur{background-image:url(@A/pointer.png)}') === 0);
  assert.ok(r.css.indexOf('.ac-violet .pcur{background-image:url(@A/pointer-violet.png)}') >= 0);
  assert.ok(r.css.indexOf('.ac-teal .pcur{background-image:url(@A/pointer-teal.png)}') >= 0);
  assert.ok(r.css.indexOf('.sw-amber{background:#E0A010}') >= 0, 'Farbfeld der Standardfarbe mit dem Markenwert');
});
test('Build: Regel ohne Token, die den Akzent ueberstimmt, wird mit allen Farbklassen dahinter mitkopiert (Kaskade bleibt)', function () {
  var r = B.css('.pl-skip { background: @accent@; color: #141414; }\n.pl-skip.is-focus { background: #F2F2F2; }\n.other { background: #000000; }', PUB);
  eq(r.errors, []);
  var v = r.css.indexOf('.ac-violet .pl-skip{'), c = r.css.indexOf('.ac-violet .pl-skip.is-focus');
  assert.ok(v > 0 && c > v, 'Kopie steht hinter der Variante');
  assert.ok(/\.ac-coral \.pl-skip\.is-focus,[^{]*\.ac-gray \.pl-skip\.is-focus\{background:#F2F2F2\}/.test(r.css));
  assert.ok(r.css.indexOf('.ac-violet .other') < 0, 'fremde Klassen werden nicht kopiert');
  assert.strictEqual(r.stats.copies, 1);
});
test('Build: gleiche Deklarationen einer Farbe werden zusammengefasst, aber nie ueber eine kollidierende Regel hinweg', function () {
  var r = B.css('.a { background: @accent@; }\n.x { color: #F2F2F2; }\n.b { background: @accent@; }', PUB);
  assert.ok(r.css.indexOf('.ac-violet .a,.ac-violet .b{background:#A78BFA}') > 0);
  r = B.css('.a { background: @accent@; }\n.a.on { background: #F2F2F2; }\n.a.on { background: @accent@; }', PUB);
  var s = r.css, v1 = s.indexOf('.ac-violet .a{background:#A78BFA}'), cp = s.indexOf('.ac-violet .a.on,'), v2 = s.indexOf('.ac-violet .a.on{background:#A78BFA}');
  assert.ok(v1 > 0 && cp > v1 && v2 > cp, 'Reihenfolge wie in der Quelle: ' + [v1, cp, v2]);
});
test('Build: Token in @-Regeln und unbekannte Token sind Fehler; Gates gelten weiter', function () {
  assert.ok(B.css('@-webkit-keyframes x { from { color: @accent@; } }', PUB).errors.length);
  assert.ok(B.css('.a { color: @farbe@; }', PUB).errors.length);
  assert.ok(B.cssErrors('.a { background: @accent@; box-shadow: 0 0 1px #000; }').length);
});
/* Budget je Farbe statt fester Summe (02.11., Grau als 8. Farbe): die Varianten wachsen linear mit der Palette (jede Farbe ~2 KB);
 * der Waechter soll zusaetzliche Token-Regeln/Begleitregeln fangen, nicht eine gewollte neue Palettenfarbe. Je Farbe < 2 KB
 * (bei 7 Farben 12 KB wie bisher). */
test('Build: echtes app.css – jede Token-Regel hat je Farbe eine Variante, Zuwachs < 2 KB je Farbe, keine Token uebrig', function () {
  brands().forEach(function (b) {
    var r = B.css(undefined, { accent: b.accent, pointer: b.pointer, accentId: b.accentId });
    eq(r.errors, []);
    assert.ok(!/@accent@|@pointer@|@badge@/.test(r.css));
    assert.ok(r.stats.bytes < r.stats.variants * 2048, 'Zuwachs ' + r.stats.bytes + ' bei ' + r.stats.variants + ' Farben');
    var base = B.brandPalette(b).filter(function (p) { return p.base; })[0];
    assert.ok(r.css.indexOf('.focus-ring{') >= 0 && r.css.indexOf('border:4px solid ' + base.color) > 0);
    B.brandPalette(b).forEach(function (p) {
      if (p.base) return;
      ['.focus-ring', '.btn.is-focus', '.set-row.is-focus', '.panel .pe.is-focus', '.pcur', '.cacc'].forEach(function (s) {
        assert.ok(new RegExp('\\.ac-' + p.id + ' ' + s.replace(/\./g, '\\.') + '[,{]').test(r.css), b.id + ' ' + p.id + ' ' + s);
      });
      assert.ok(r.css.indexOf(p.color) > 0);
    });
  });
});

/* ---------- Farbe der Markierungen (ACC-2): @badge@ ---------- */
test('Build: @badge@ = Hellgrau (text-1) in der Grundregel, je Palettenfarbe eine Variante .bd-<id> mit nur dieser Deklaration', function () {
  var r = B.css('.bdg.new { right: 0; border-top: 24px solid @badge@; }\n.bdg.done { width: 24px; background-color: @badge@; }', PUB);
  eq(r.errors, []);
  assert.ok(r.css.indexOf('.bdg.new{right:0;border-top:24px solid #F2F2F2}') === 0, r.css.slice(0, 80));
  B.brandPalette(PUB).forEach(function (p) {
    assert.ok(r.css.indexOf('.bd-' + p.id + ' .bdg.new{border-top:24px solid ' + p.color + '}') > 0, p.id);
    assert.ok(r.css.indexOf('.bd-' + p.id + ' .bdg.done{background-color:' + p.color + '}') > 0, p.id);
  });
  assert.ok(r.css.indexOf('.ac-violet .bdg') < 0, 'keine Akzent-Varianten fuer Markierungen');
  assert.strictEqual(r.badge.rules, 2);
});
test('Build: echtes app.css – Markierungen (neu, Zahl, gesehen) tragen @badge@, Varianten < 1,5 KB, niemand ueberstimmt sie', function () {
  brands().forEach(function (b) {
    var r = B.css(undefined, { accent: b.accent, pointer: b.pointer, accentId: b.accentId });
    assert.strictEqual(r.badge.rules, 3, b.id);
    assert.ok(r.badge.bytes < 1536, 'Markierungen ' + r.badge.bytes);
    ['.bdg.new', '.bdg.count', '.bdg.done'].forEach(function (s) { assert.ok(r.css.indexOf('.bd-amber ' + s + '{') > 0, s); });
    // Grundfassung unveraendert hellgrau (kein Pixel aendert sich ohne Einstellung)
    assert.ok(/\.bdg\.new\{[^}]*border-top:24px solid #F2F2F2/.test(r.css));
    assert.ok(/\.bdg\.done\{[^}]*background-color:#F2F2F2/.test(r.css));
  });
  // keine andere Regel setzt Rahmen/Hintergrund der drei Markierungen (sonst braeuchte es Begleitregeln wie beim Akzent)
  var src = fs.readFileSync(path.join(ROOT, 'src', 'css', 'app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  var re = /([^{}]+)\{([^}]*)\}/g, m, hits = [];
  while ((m = re.exec(src))) if (/\.bdg\.(new|count|done)\b/.test(m[1]) && /(border|background)[^:]*:/.test(m[2]) && m[2].indexOf('@badge@') < 0 && !/^\s*\.bdg\.(count|done)\s*$/.test(m[1])) hits.push(m[1].trim());
  eq(hits, []);
});
test('N.accent.badge: Hellgrau = keine Klasse, Palettenfarbe = bd-<id>, unbekannt -> Hellgrau; Einstellung wirkt sofort', function () {
  var A = N.accent, html = { className: 'tv ac-violet' }, S = N.session;
  eq(A.badgeIds(), ['light'].concat(A.ids()));
  assert.strictEqual(A.badgeOf('pink'), 'light'); assert.strictEqual(A.badgeCls('light'), ''); assert.strictEqual(A.badgeCls('blue'), 'bd-blue');
  assert.strictEqual(N.comfort.DEFAULTS.badgeColor, 'light');
  ctx.document = { documentElement: html };
  var old = { settings: S.settings, state: S.state, save: S.save };
  S.state = { accent: 'violet' }; S.save = function () {};
  try {
    S.settings = { accent: 'violet', badgeColor: 'amber' };
    N.evt.emit('settings:changed', { key: 'badgeColor', value: 'amber' });
    assert.strictEqual(html.className, 'tv ac-violet bd-amber');
    S.settings.badgeColor = 'light';
    N.evt.emit('settings:changed', { key: 'badgeColor', value: 'light' });
    assert.strictEqual(html.className, 'tv ac-violet', 'Hellgrau = keine Klasse, Akzent bleibt');
    assert.strictEqual(A.applyBadge('light'), false, 'gleiche Farbe: kein DOM-Zugriff');
  } finally { S.settings = { accent: 'teal' }; A.sync(); S.settings = old.settings; S.state = old.state; S.save = old.save; delete ctx.document; }
});

/* ---------- Laufzeit: Einstellung + Anwenden ---------- */
var ctx = H.load(), N = ctx.N;
N.log = function () {};
test('N.accent: unbekannte/alte Werte -> Standard der Marke; Klasse nur fuer Nicht-Standardfarben', function () {
  assert.strictEqual(N.accent.base(), 'teal');               // Standard in src/core/brand.js = oeffentliche Marke
  assert.strictEqual(N.accent.of('violet'), 'violet');
  assert.strictEqual(N.accent.of('pink'), 'teal'); assert.strictEqual(N.accent.of(undefined), 'teal');
  assert.strictEqual(N.accent.cls('teal'), ''); assert.strictEqual(N.accent.cls('coral'), 'ac-coral');
  eq(N.accent.ids(), JSON.parse(JSON.stringify(B.loadPalette().map(function (x) { return x.id; }))));
});
test('Einstellung: Standardwert = Farbe der Marke (comfort.DEFAULTS), eigene Wahl bleibt', function () {
  assert.strictEqual(N.comfort.DEFAULTS.accent, N.brand.accent);
  assert.strictEqual(N.comfort.applyDefaults({}).accent, 'teal');
  assert.strictEqual(N.comfort.applyDefaults({ accent: 'rose' }).accent, 'rose');
});
test('Anwenden: eine Klasse am <html> (andere Klassen bleiben), Profilwechsel + Einstellung wirken sofort, Farbe fuer den Start gemerkt', function () {
  var html = { className: 'tv x' }, saves = 0, S = N.session;
  ctx.document = { documentElement: html };
  var old = { settings: S.settings, state: S.state, save: S.save };
  S.state = { accent: 'teal' }; S.save = function () { saves++; };
  try {
    S.settings = { accent: 'violet' };
    N.evt.emit('profile:changed', {});
    assert.strictEqual(html.className, 'tv x ac-violet');
    assert.strictEqual(S.state.accent, 'violet'); assert.strictEqual(saves, 1);
    S.settings.accent = 'green';
    N.evt.emit('settings:changed', { key: 'accent', value: 'green' });
    assert.strictEqual(html.className, 'tv x ac-green');
    N.evt.emit('settings:changed', { key: 'clock', value: false });
    assert.strictEqual(saves, 2, 'andere Einstellungen schreiben nichts');
    S.settings.accent = 'teal';
    N.evt.emit('settings:changed', { key: 'accent', value: 'teal' });
    assert.strictEqual(html.className, 'tv x', 'Standardfarbe = keine Klasse');
    assert.strictEqual(N.accent.apply('teal'), false, 'gleiche Farbe: kein DOM-Zugriff');
    S.settings = null; S.state = { accent: 'coral' };   // Start ohne Profil: gemerkte Farbe
    N.accent.sync();
    assert.strictEqual(html.className, 'tv x ac-coral');
  } finally { S.settings = old.settings; S.state = old.state; S.save = old.save; delete ctx.document; }
});
test('i18n: Name je Palettenfarbe in de, en und nb', function () {
  ['de', 'en', 'nb'].forEach(function (l) {
    N.i18n.set(l);
    N.accent.ids().forEach(function (id) { var t = N.t('set.v.ac_' + id); assert.ok(t && t !== 'set.v.ac_' + id && t.length <= 14, l + ' ' + id); });
    assert.ok(N.t('set.v.bdLight').length <= 14);
    assert.ok(N.t('set.accent').length <= 20);   // "Farbe der Auswahl" (05.11.2026); Panel-Titel tragen bis 34 Zeichen
  });
});
