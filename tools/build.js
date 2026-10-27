#!/usr/bin/env node
/* Build (SPEC 14.13): src/ in Manifest-Reihenfolge -> app/app.js (CSS als String eingebettet, keine weitere Startdatei),
 * Gates: CSS-Verbote, i18n (Schluessel/Platzhalter/Zeichengrenzen/Zeichensatz), Nicht-ASCII -> \uXXXX, ES5 (acorn ecmaVersion 5),
 * verbotene ES6-APIs, Groessenbericht. Kopiert die Bilder aus src/assets nach app/.
 * P7: zwei Ausgaben – app/app.js (lesbar, mit dev/-Modulen; dev.py serve liefert sie zum Debuggen) und app/app.min.js
 * (terser, ecma 5, ohne dev/-Module; geht ins TV-Paket). Beide durchlaufen dieselben Gates.
 *   node tools/build.js [--no-test] [--no-min] */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var ROOT = path.join(__dirname, '..'), SRC = path.join(ROOT, 'src'), OUT = path.join(ROOT, 'app');
var errors = [];
function fail(msg) { errors.push(msg); }

/* ---------- CSS ---------- */
/* Marken-Tokens: @accent@ (Akzentfarbe) und @pointer@ (Zeiger-Bilder) aus brand/<id>.json (Standard: oeffentliche Marke). */
var BRAND_CSS = { accent: '#2EC4B6', pointer: 'pointer-teal' };
function buildCss(cssText, brand) {
  var css = cssText !== undefined ? cssText : fs.readFileSync(path.join(SRC, 'css', 'app.css'), 'utf8');
  var b = brand || BRAND_CSS;
  css = css.replace(/@accent@/g, b.accent).replace(/@pointer@/g, b.pointer);
  if (/@[a-z]+@/.test(css.replace(/\/\*[\s\S]*?\*\//g, ''))) fail('CSS: unbekannter Marken-Token ' + css.match(/@[a-z]+@/)[0]);
  var code = css.replace(/\/\*[\s\S]*?\*\//g, '');
  var bad = [[/gradient/i, 'gradient'], [/box-shadow/i, 'box-shadow'], [/text-shadow/i, 'text-shadow'], [/(^|[^-\w])filter\s*:/i, 'filter'],
    [/display\s*:\s*(-webkit-)?flex/i, 'flex'], [/calc\(/i, 'calc()'], [/\d(vw|vh)\b/i, 'vw/vh'], [/var\(/i, 'var()']];
  bad.forEach(function (b) { if (b[0].test(code)) fail('CSS verboten: ' + b[1]); });
  var m, re = /font-size\s*:\s*(\d+)px/g;
  while ((m = re.exec(code))) if (Number(m[1]) < 16) fail('CSS font-size < 16px: ' + m[0]);
  ['transform', 'transition', 'animation', 'transform-origin'].forEach(function (p) {
    var r = new RegExp('(^|[;{\\s])' + p + '\\s*:', 'g');
    if (r.test(code)) fail('CSS ohne -webkit--Praefix: ' + p);
  });
  return code.replace(/\s+/g, ' ').replace(/\s*([{};:,])\s*/g, '$1').replace(/;}/g, '}').trim();
}

/* ---------- i18n ---------- */
function checkI18n() {
  var ctx = { N: undefined };
  vm.createContext(ctx);
  ['core/ns.js', 'i18n/strings.de.js', 'i18n/strings.en.js', 'i18n/strings.music.js'].forEach(function (f) { vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f }); });
  var errs = require('./i18n_rules').check(ctx.N.strings.de, ctx.N.strings.en);
  errs.forEach(function (e) { fail('i18n: ' + e); });
  return Object.keys(ctx.N.strings.de).length;
}

/* ---------- lokale Netzwerk-Werte (local.json, git-ignoriert) ----------
 * Das Repo enthaelt keine Adressen aus dem Heimnetz. Die lokalen Standards (Proxy, PMS, Log-Empfaenger) stehen in
 * local.json im Repo-Wurzelverzeichnis (Vorlage: local.example.json) und werden hier ins gebaute app.js geschrieben.
 * Ohne local.json bleiben die Standards leer (CI, fremde Rechner); config.json auf dem TV ueberschreibt weiterhin. */
var LOCAL_KEYS = { proxyHost: /^[A-Za-z0-9.\-]+(:\d{1,5})?(\/[A-Za-z0-9._\-\/]*)?$/, logHost: /^[A-Za-z0-9.\-]+(:\d{1,5})?(\/[A-Za-z0-9._\-\/]*)?$/,
  pms: /^http:\/\/[A-Za-z0-9.\-]+(:\d{1,5})?$/ };
function localConfig() {
  var p = path.join(ROOT, 'local.json'), o, out = {};
  if (!fs.existsSync(p)) { console.log('HINWEIS: local.json fehlt – app.js ohne lokale Netzwerk-Standards (siehe local.example.json).'); return out; }
  try { o = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { fail('local.json ist kein gueltiges JSON: ' + e.message); return out; }
  Object.keys(LOCAL_KEYS).forEach(function (k) {
    if (o[k] === undefined || o[k] === '') return;
    if (typeof o[k] !== 'string' || !LOCAL_KEYS[k].test(o[k])) fail('local.json: ungueltiger Wert fuer ' + k);
    else out[k] = o[k];
  });
  return out;
}

/* ---------- Marken-Profil (brand/<id>.json, siehe brand/README.md) ----------
 * Auswahl: --brand <id> / env BRAND -> local.json "brand" -> "private", falls brand/private.json existiert -> "public". */
function brandConfig() {
  var i = process.argv.indexOf('--brand'), id = i >= 0 ? process.argv[i + 1] : process.env.BRAND, o = {};
  try { o = JSON.parse(fs.readFileSync(path.join(ROOT, 'local.json'), 'utf8')); } catch (e) { o = {}; }
  id = id || o.brand || (fs.existsSync(path.join(ROOT, 'brand', 'private.json')) ? 'private' : 'public');
  if (!/^[a-z0-9-]+$/.test(id)) { fail('Marke ungueltig: ' + id); return null; }
  var p = path.join(ROOT, 'brand', id + '.json'), b;
  try { b = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { fail('Marken-Profil fehlt oder ist kaputt: brand/' + id + '.json'); return null; }
  if (typeof b.name !== 'string' || !b.name || !b.wordmark || b.wordmark.length !== 2) { fail('brand/' + id + '.json: name/wordmark fehlen'); return null; }
  console.log('Marke: ' + id + ' (' + b.name + ')');
  if (!/^#[0-9A-Fa-f]{6}$/.test(b.accent || '') || !/^[a-z0-9-]+$/.test(b.pointer || '')) { fail('brand/' + id + '.json: accent/pointer fehlen'); return null; }
  return { id: id, name: b.name, wordmark: [String(b.wordmark[0]), String(b.wordmark[1])], accent: b.accent, pointer: b.pointer };
}

/* ---------- JS ---------- */
function escapeNonAscii(s) {
  return s.replace(/[^\x00-\x7e]/g, function (ch) { return '\\u' + ('0000' + ch.charCodeAt(0).toString(16)).slice(-4); });
}
/* Kommentare entfernen (Groesse; Code bleibt lesbar fuer den Web Inspector). Erste Zeile (Kopf) bleibt. */
function stripComments(code) {
  var acorn;
  try { acorn = require('acorn'); } catch (e) { return code; }
  var cs = [];
  try { acorn.parse(code, { ecmaVersion: 5, onComment: function (block, text, start, end) { cs.push([start, end]); } }); } catch (e) { return code; }
  var out = [], pos = 0;
  cs.forEach(function (c, i) { if (i === 0 && c[0] === 0) return; out.push(code.slice(pos, c[0])); pos = c[1]; });
  out.push(code.slice(pos));
  return out.join('').replace(/[ \t]+$/gm, '').replace(/\n{2,}/g, '\n');
}
function es5Gate(code) {
  var acorn, walk;
  try { acorn = require('acorn'); walk = require('acorn-walk'); } catch (e) { fail('acorn fehlt – bitte "npm install" ausfuehren'); return; }
  var ast;
  try { ast = acorn.parse(code, { ecmaVersion: 5, sourceType: 'script', locations: true }); }
  catch (e) { fail('ES5-Fehler: ' + e.message + ' (Zeile ' + (e.loc && e.loc.line) + ' in app.js)'); return; }
  var GLOBALS = { Promise: 1, fetch: 1, Map: 1, Set: 1, WeakMap: 1, WeakSet: 1, Symbol: 1, Proxy: 1, Reflect: 1 };
  var CALLS = { assign: 'Object', from: 'Array', includes: '', startsWith: '', endsWith: '', padStart: '', padEnd: '', repeat: '', findIndex: '',
    find: '', fill: '', at: '', codePointAt: '', values: 'Object', entries: 'Object', isNaN: 'Number', isFinite: 'Number', isInteger: 'Number',
    trunc: 'Math', sign: 'Math', log10: 'Math', of: 'Array', keys: 'Reflect' };
  walk.simple(ast, {
    Identifier: function (n) { if (GLOBALS[n.name]) fail('Verbotene ES6-API ' + n.name + ' (Zeile ' + n.loc.start.line + ')'); },
    MemberExpression: function (n) {           // WebKit 537 (Orsay) kennt classList nicht zuverlaessig
      if (!n.computed && n.property.name === 'classList') fail('Verboten: .classList (Zeile ' + n.loc.start.line + ')');
    },
    CallExpression: function (n) {
      var c = n.callee;
      if (c.type === 'MemberExpression' && !c.computed && Object.prototype.hasOwnProperty.call(CALLS, c.property.name)) {
        var obj = CALLS[c.property.name];
        if (!obj || (c.object.type === 'Identifier' && c.object.name === obj)) fail('Verbotene ES6-Methode .' + c.property.name + '() (Zeile ' + n.loc.start.line + ')');
      }
    }
  });
}

/* ---------- Minifizierung (P7) ----------
 * terser ist als devDependency fest gepinnt. Optionen konservativ fuer WebKit 537 (Orsay): ecma 5, ie8/safari10-Schutz,
 * keine unsicheren Umformungen, nur lokale Namen kuerzen (Eigenschaften, globale Namen wie N/App bleiben). */
var MIN_OPTS = {
  ecma: 5, ie8: true, safari10: true, toplevel: false,
  compress: { ecma: 5, passes: 2, unsafe: false, keep_fargs: true, keep_infinity: true, typeofs: false, hoist_funs: false },
  mangle: { ie8: true, safari10: true },
  format: { ecma: 5, ascii_only: true, comments: false, ie8: true, safari10: true, semicolons: true }
};
function minify(code) {
  return require('terser').minify(code, MIN_OPTS).then(function (r) { return r.code; });
}
function kb(n) { return Math.round(n / 102.4) / 10; }

function build() {
  var t0 = Date.now();
  var manifest = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
  var brand = brandConfig();
  var css = buildCss(undefined, brand);
  var keys = checkI18n();
  var local = localConfig();
  var parts = ['/* gebaut aus src/ (tools/build.js). Nicht von Hand bearbeiten. */'], rel = [];
  manifest.forEach(function (f, i) {
    var p = path.join(SRC, f);
    if (!fs.existsSync(p)) { fail('Manifest-Datei fehlt: ' + f); return; }
    var chunk = '/* ===== ' + f + ' ===== */\n' + fs.readFileSync(p, 'utf8');
    parts.push(chunk);
    if (!/^dev\//.test(f)) rel.push(chunk);                // Release (minifiziert): ohne Entwicklungs-Module
    var extra = i === 0 ? 'N.CSS = ' + JSON.stringify(css) + ';' : f === 'core/config.js' && Object.keys(local).length ? 'N.config.apply(' + JSON.stringify(local) + ');   /* aus local.json */' :
      f === 'core/brand.js' && brand ? 'N.brand = ' + JSON.stringify({ id: brand.id, name: brand.name, wordmark: brand.wordmark }) + ';   /* brand/' + brand.id + '.json */' : '';
    if (extra) { parts.push(extra); rel.push(extra); }
  });
  // nicht im Manifest gelistete Quelldateien melden
  (function scan(dir) {
    fs.readdirSync(dir).forEach(function (f) {
      var p = path.join(dir, f), rel = path.relative(SRC, p);
      if (fs.statSync(p).isDirectory()) { if (f !== 'assets' && f !== 'css') scan(p); }
      else if (/\.js$/.test(f) && manifest.indexOf(rel) < 0) fail('Quelldatei nicht im Manifest: ' + rel);
    });
  })(SRC);
  var code = stripComments(escapeNonAscii(parts.join('\n')));
  es5Gate(code);
  function abort() { console.error('BUILD FEHLGESCHLAGEN:\n  - ' + errors.join('\n  - ')); process.exit(1); }
  if (errors.length) abort();
  var noMin = process.argv.indexOf('--no-min') >= 0;
  (noMin ? Promise.resolve(null) : minify(escapeNonAscii(rel.join('\n')))).then(function (min) {
    if (min !== null) {
      es5Gate(min);
      if (/[^\x00-\x7e]/.test(min)) fail('app.min.js enthaelt Nicht-ASCII');
      if (!/window\.App=/.test(min)) fail('app.min.js ohne window.App');
      if (errors.length) abort();
    }
    write(code, min);
  }, function (e) { fail('Minifizierung: ' + (e && e.message)); abort(); });

  function write(code, min) {
    var appPath = path.join(OUT, 'app.js'), minPath = path.join(OUT, 'app.min.js');
    var previous = fs.existsSync(appPath) ? fs.readFileSync(appPath) : null, prevMin = fs.existsSync(minPath) ? fs.readFileSync(minPath) : null;
    fs.writeFileSync(appPath, code);
    if (min !== null) fs.writeFileSync(minPath, min);
    // Zeiger-Bilder nur der gewaehlten Marke (<pointer>.png, <pointer>-press.png); fremde aus app/ entfernen
    var mine = [brand.pointer + '.png', brand.pointer + '-press.png'];
    function isPtr(f) { return /^pointer.*\.png$/.test(f); }
    var assets = fs.readdirSync(path.join(SRC, 'assets')).filter(function (f) { return /\.(png|gif)$/.test(f) && (!isPtr(f) || mine.indexOf(f) >= 0); });
    fs.readdirSync(OUT).forEach(function (f) { if (isPtr(f) && mine.indexOf(f) < 0) fs.unlinkSync(path.join(OUT, f)); });
    assets.forEach(function (f) { fs.copyFileSync(path.join(SRC, 'assets', f), path.join(OUT, f)); });
    var gz = require('zlib');
    console.log('app/app.js: ' + kb(code.length) + ' KB lesbar (' + manifest.length + ' Module, CSS ' + kb(css.length) + ' KB, ' + keys + ' Texte je Sprache), ' +
      'Startdateien: 1 (CSS eingebettet), Bilder: ' + assets.join(', ') + ' – ' + (Date.now() - t0) + ' ms');
    if (min !== null) {
      console.log('app/app.min.js: ' + kb(min.length) + ' KB minifiziert, ' + kb(gz.gzipSync(min).length) + ' KB gzip (Release-Paket, ohne dev/)');
      if (min.length > 180 * 1024) console.log('HINWEIS: app.min.js > 180 KB (Budget SPEC 16.2) – Rest sind Texte (de/en), CSS und Eigenschaftsnamen, siehe docs/P7-TV-TEST.md.');
    } else console.log('HINWEIS: --no-min – app/app.min.js nicht neu gebaut.');
    // Regressionsschutz: alle Unit-Tests laufen im Build; bei Fehlern bleiben die vorherigen Dateien stehen
    if (process.argv.indexOf('--no-test') < 0) {
      var r = require('child_process').spawnSync(process.execPath, ['--test', 'tests/*.test.js'], { cwd: ROOT, stdio: 'inherit' });
      if (r.status !== 0) {
        if (previous) fs.writeFileSync(appPath, previous);
        if (min !== null && prevMin) fs.writeFileSync(minPath, prevMin);
        console.error('BUILD FEHLGESCHLAGEN: Unit-Tests rot – app/app.js und app.min.js wurden NICHT aktualisiert.');
        process.exit(1);
      }
      console.log('Unit-Tests gruen.');
    }
  }
}
if (require.main === module) build();
/* fuer Tests: Gates einzeln pruefen -> Liste der Fehler */
module.exports = {
  es5Errors: function (code) { errors = []; es5Gate(code); return errors.slice(); },
  cssErrors: function (css) { errors = []; buildCss(css); return errors.slice(); },
  escapeNonAscii: escapeNonAscii,
  minify: minify
};
