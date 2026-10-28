/* Design-Tokens und Symbole als zentrale Quelle (design/tokens.json, design/icons/*.svg):
 * generierte Dateien aktuell, CSS ohne Farb-Literale und ohne unaufloesbare Platzhalter, Symbole vollstaendig,
 * keine Markenfarbe der privaten Fassung in den (exportierten) Token-Dateien. */
'use strict';
var test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path'), vm = require('vm');
var ROOT = path.join(__dirname, '..'), T = require('../tools/tokens.js'), D = require('../tools/design_doc.js'), B = require('../tools/build.js');
var TZ = require('../tools/tokenize_css.js');
function rd(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }

test('generierte Design-Dateien sind aktuell (sonst: npm run spec)', function () {
  assert.deepStrictEqual(D.stale(), [], 'veraltet: ' + D.stale().join(', ') + ' – npm run spec ausfuehren (erzeugt sie aus design/tokens.json und design/icons neu)');
});

/* Jedes Token wird benutzt: als Platzhalter in src/css, als Zeilenfarbe des Symbol-Sprites oder per T.color('<name>') in
 * tools/ (Bilder). Ein Token, das nirgends wirkt, taeuscht eine Portierung (sie baut es nach) – entfernen, oder als Stufe
 * einer Skala mit "reserved": true markieren. Gruppen mit "css": false (Akzent-Palette) wirken ueber src/core/accent.js. */
test('Token-Datei: kein Token ohne Verwendung', function () {
  var t = T.load(), used = {}, m, re = new RegExp(T.PLACEHOLDER.source, 'g');
  fs.readdirSync(path.join(ROOT, 'src', 'css')).forEach(function (f) { var s = rd('src/css/' + f); while ((m = re.exec(s))) used[m[1] + '.' + m[2]] = 1; });
  t.icons.rows.forEach(function (r) { used['c.' + r] = 1; });
  fs.readdirSync(path.join(ROOT, 'tools')).filter(function (f) { return /\.js$/.test(f); }).forEach(function (f) {
    var s = rd('tools/' + f), r2 = /\bT\.color\('([a-z0-9-]+)'\)/g; while ((m = r2.exec(s))) used['c.' + m[1]] = 1;
  });
  assert.deepStrictEqual(unusedTokens(t, used), [], 'Token ohne Verwendung (design/tokens.json): im CSS als @gruppe.name@ verwenden, entfernen, ' +
    'oder – als bewusst freie Stufe einer Skala – "reserved": true setzen; danach npm run spec');
  // die Pruefung selbst: ein neues, unbenutztes Token wird gemeldet, ein reserviertes nicht
  var t2 = JSON.parse(JSON.stringify(t));
  t2.groups.sp.tokens['99'] = { value: '1px', description: 'x' };
  t2.groups.sp.tokens['98'] = { value: '2px', description: 'y', reserved: true };
  assert.deepStrictEqual(unusedTokens(t2, used), ['sp.99']);
});
function unusedTokens(t, used) {
  var out = [];
  Object.keys(t.groups).forEach(function (g) {
    if (t.groups[g].css === false) return;
    Object.keys(t.groups[g].tokens).forEach(function (n) { if (!used[g + '.' + n] && !t.groups[g].tokens[n].reserved) out.push(g + '.' + n); });
  });
  return out;
}

test('Token-Datei: jede Gruppe/jedes Token mit Wert und Beschreibung, gueltige Werte', function () {
  var t = T.load();
  assert.ok(t.scaling && t.scaling.length > 40, 'Skalierungshinweis fehlt');
  Object.keys(t.groups).forEach(function (g) {
    var G = t.groups[g];
    assert.ok(/^[a-z]+$/.test(g) && G.title && G.description, 'Gruppe ' + g);
    Object.keys(G.tokens).forEach(function (n) {
      var k = g + '.' + n, v = String(G.tokens[n].value);
      assert.ok(/^[a-z0-9][a-z0-9.-]*$/.test(n), 'Name ' + k);
      assert.ok(G.tokens[n].description && G.tokens[n].description.length > 3, 'Beschreibung fehlt: ' + k);
      assert.ok(v.indexOf('@') < 0 && v.indexOf(';') < 0 && v.indexOf('{') < 0, 'Wert ' + k);
      if (g === 'c' || g === 'accent') assert.ok(/^#[0-9A-F]{6}$/.test(v) || /^rgba\(\d+,\d+,\d+,(0|1|0\.\d+)\)$/.test(v), 'Farbe ' + k + ' = ' + v + ' (#RRGGBB gross oder rgba ohne Leerzeichen)');
      if (g === 'sp' || g === 'r' || g === 'l') assert.ok(/^\d+px$/.test(v), 'px-Wert ' + k);
      if (g === 'ty' && /\.size$/.test(n)) assert.ok(parseInt(v, 10) >= 16, 'Schrift < 16 px: ' + k);
      if (g === 'mo' && /^(fast|base|slow|spin)$/.test(n)) assert.ok(/^\d+ms$/.test(v), 'Dauer ' + k);
    });
  });
  // Platzhalter-Werte eindeutig je Name (keine Doppelbelegung c.x in zwei Gruppen moeglich, aber Farbwerte sollen nicht doppelt vorkommen)
  var seen = {};
  Object.keys(t.groups.c.tokens).forEach(function (n) {
    var v = t.groups.c.tokens[n].value;
    assert.ok(!seen[v], 'Farbe ' + v + ' doppelt: c.' + seen[v] + ' und c.' + n + ' (ein Wert = ein Token)');
    seen[v] = n;
  });
});

test('src/css: keine Farb-Literale, alle Platzhalter aufloesbar, nichts mehr zu tokenisieren', function () {
  fs.readdirSync(path.join(ROOT, 'src', 'css')).filter(function (f) { return /\.css$/.test(f); }).forEach(function (f) {
    var src = rd('src/css/' + f);
    assert.deepStrictEqual(B.cssSourceErrors(src, f), []);
    var r = TZ.convert(src, T.load());
    assert.strictEqual(r.changes, 0, f + ': Werte mit passendem Token stehen noch als Literal (node tools/tokenize_css.js -v / --write)');
  });
});

test('Gates: Farb-Literal und unbekannter Platzhalter werden gemeldet', function () {
  assert.ok(B.cssSourceErrors('.a { color: #fff; }').length);
  assert.ok(B.cssSourceErrors('.a { background: rgba(0,0,0,0.5); }').length);
  assert.ok(B.cssSourceErrors('.a { border: 1px solid white; }').length);
  assert.ok(B.cssSourceErrors('.a { color: @c.gibtsnicht@; }').length);
  assert.deepStrictEqual(B.cssSourceErrors('/* #fff im Kommentar */ #root .x { color: @c.text-1@; background: transparent; }'), []);
  assert.ok(B.cssErrors('.a { color: @c.gibtsnicht@; }').length);
  assert.deepStrictEqual(B.cssErrors('.a { color: @c.text-1@; padding: @sp.4@; }'), []);
  var out = B.css('.a { color: @c.text-1@; -webkit-transition: opacity @mo.base@ @mo.ease@; }').css;
  assert.ok(out.indexOf('.a{color:' + T.color('text-1') + ';-webkit-transition:opacity 150ms cubic-bezier(0,0,0.2,1)}') === 0, out);
  assert.ok(B.cssErrors('.a { font-size: @ty.small.size@; }').length === 0);
});

test('Symbole: jede Spalte in src/ui/icons.js hat ein SVG und umgekehrt, Sprite-Dateien aktuell', function () {
  var order = T.order(), files = T.iconFiles();
  var noOrder = files.filter(function (n) { return order.indexOf(n) < 0; }), noSvg = order.filter(function (n) { return files.indexOf(n) < 0; });
  assert.deepStrictEqual(noOrder.concat(noSvg), [], 'design/icons: ' +
    (noOrder.length ? 'SVG ohne Eintrag in design/icons/order.json: ' + noOrder.join(', ') + ' – Namen hinten an "order" anhaengen (nie einfuegen: Spalten sind fest). ' : '') +
    (noSvg.length ? 'in order.json, aber keine Datei design/icons/<name>.svg: ' + noSvg.join(', ') + '. ' : '') +
    'Danach npm run spec und node tools/make_assets.js (Sprite, braucht rsvg-convert).');
  assert.strictEqual(new Set(order).size, order.length, 'Name doppelt in order.json');
  var ctx = { N: { ui: {}, util: {} } };
  vm.createContext(ctx);
  vm.runInContext(rd('src/ui/icons.js'), ctx);
  var cols = JSON.parse(JSON.stringify(ctx.N.ui.ICONS));
  assert.deepStrictEqual(Object.keys(cols).sort(), files, 'src/ui/icons.js COLS <-> design/icons');
  order.forEach(function (n, i) { assert.strictEqual(cols[n], i, 'Spalte von ' + n); });
  T.icons().forEach(function (ic) {               // einheitliches Format (make_assets setzt die Zeilenfarbe fuer currentColor ein)
    assert.ok(/^fill="none" stroke="currentColor" stroke-width="[\d.]+" stroke-linecap="round"( stroke-linejoin="round")?$/.test(ic.attrs), ic.name + ': <g>-Attribute');
    assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(ic.body), ic.name + ': feste Farbe im Symbol (currentColor verwenden)');
    assert.ok(/viewBox="0 0 28 28"/.test(fs.readFileSync(path.join(T.ICON_DIR, ic.name + '.svg'), 'utf8')), ic.name + ': viewBox 0 0 28 28');
  });
  assert.strictEqual(rd('src/assets/icons.svg'), T.spriteSvg() + '\n', 'src/assets/icons.svg/png veraltet: node tools/make_assets.js');
  assert.deepStrictEqual(JSON.parse(rd('src/assets/icons.json')), order, 'src/assets/icons.json veraltet: node tools/make_assets.js');
});

test('Akzent-Palette: eine Quelle (tokens.json) fuer App, Build und Bilder', function () {
  var ctx = { N: {} };
  vm.createContext(ctx);
  vm.runInContext(rd('src/core/accent.js'), ctx);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.N.accent.PALETTE)), T.palette().map(function (p) { return [p.id, p.color]; }));
  assert.deepStrictEqual(B.loadPalette(), T.palette());
  assert.ok(!/#[0-9A-Fa-f]{6}/.test(rd('tools/make_assets.js')), 'tools/make_assets.js: Farben aus design/tokens.json lesen');
  var base = /var BASE = \[(\d+), (\d+), (\d+)\]/.exec(rd('src/core/ambient.js')), bg = T.color('bg');
  assert.deepStrictEqual(base.slice(1).map(Number), [1, 3, 5].map(function (i) { return parseInt(bg.substr(i, 2), 16); }), 'src/core/ambient.js BASE = c.bg');
});

test('keine Markenfarbe eines Markenprofils in den exportierten Design-Dateien', function () {
  var pal = {}, texts = [rd('design/tokens.json'), rd('design/README.md')];
  T.palette().forEach(function (p) { pal[p.id] = p.color.toUpperCase(); });
  fs.readdirSync(path.join(ROOT, 'brand')).filter(function (f) { return /\.json$/.test(f); }).forEach(function (f) {
    var b = JSON.parse(rd('brand/' + f));
    ['accent', 'accentPress', 'softLight', 'softDark'].forEach(function (k) {
      var v = String(b[k] || '').toUpperCase();
      if (!v || (k === 'accent' && pal[b.accentId] === v)) return;
      texts.forEach(function (s) { assert.ok(s.toUpperCase().indexOf(v) < 0, 'brand/' + f + ' ' + k + ' ' + v + ' steht in design/ (gehoert nur ins Markenprofil)'); });
    });
    assert.ok(texts.every(function (s) { return s.indexOf(b.name) < 0 || f === 'public.json'; }), 'Markenname ' + b.name + ' in design/');
  });
});
