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
/* Design-Tokens (design/tokens.json, tools/tokens.js): @<gruppe>.<name>@ (z. B. @c.bg@, @sp.4@, @mo.base@) wird vor allen Gates
 * durch den Wert ersetzt (WebKit 537 kennt kein var()); unbekannte Platzhalter sind ein Build-Fehler. In src/css/*.css sind
 * Farb-Literale (#hex, rgb()/rgba(), hsl(), Farbnamen) in Deklarationen verboten – jede Farbe ist ein Token (Ausnahme nur ueber
 * RAW_COLOR_ALLOW, derzeit leer). Werkzeug zum Umstellen neuer Literale: node tools/tokenize_css.js --write.
 * Marken-Tokens: @accent@ (Akzentfarbe) und @pointer@ (Zeiger-Bilder) aus brand/<id>.json (Standard: oeffentliche Marke).
 * Akzentfarbe waehlbar (src/core/accent.js): Die Grundregeln tragen die Standardfarbe der Marke; fuer jede andere
 * Palettenfarbe entsteht aus jeder Regel mit Token eine Variante ".ac-<id> <selektor>{nur die Token-Deklarationen}".
 * Die App schaltet nur die Klasse am <html> um. Weil die Varianten eine Klasse spezifischer sind, werden Regeln ohne Token,
 * die eine Token-Deklaration in der Grundfassung ueberstimmen koennten (gleiche Eigenschaft, gleiche Klasse im letzten
 * Selektor-Glied, mindestens gleich spezifisch), mit allen Farbklassen in Quellreihenfolge mitkopiert. */
var TOKENS = require('./tokens.js');
var RAW_COLOR_ALLOW = [];   // ausdrueklich erlaubte Farb-Literale in src/css (exakter Text, z. B. 'rgba(0,0,0,0.5)'); bitte Token bevorzugen
/* Palette aus design/tokens.json (Gruppe accent; daraus erzeugt: src/core/accent.js PALETTE, Test prueft Gleichstand) */
function loadPalette() { return TOKENS.palette(); }
/* ohne Markenprofil (Tests, Werkzeuge): Teal der Palette mit den Teal-Zeigern */
var BRAND_CSS = { accent: loadPalette().filter(function (p) { return p.id === 'teal'; })[0].color, pointer: 'pointer-teal', accentId: 'teal' };
/* Quell-CSS pruefen: keine rohen Farbwerte in Deklarationen (Kommentare zaehlen nicht), alle Token-Platzhalter aufloesbar */
var COLOR_NAMES = /(^|[^-\w.#@])(white|black|red|green|blue|yellow|orange|purple|gray|grey|silver|maroon|navy|teal|olive|lime|aqua|fuchsia|pink|brown|gold)(?![-\w])/i;
function cssSourceErrors(text, file) {
  var out = [], code = text.replace(/\/\*[\s\S]*?\*\//g, ''), f = file || 'CSS';
  var r = TOKENS.resolve(code);
  r.unknown.forEach(function (u) { out.push(f + ': unbekannter Design-Token ' + u + ' (design/tokens.json)'); });
  var re = /\{([^{}]*)\}/g, m;
  while ((m = re.exec(code))) {
    m[1].split(';').forEach(function (d) {
      var k = d.indexOf(':'); if (k < 0) return;
      var prop = d.slice(0, k).trim(), v = d.slice(k + 1).trim(), lit = v.match(/#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?)\([^)]*\)/g) || [], n = COLOR_NAMES.exec(v);
      if (n && !/^(font-family|content|-webkit-animation|animation)$/.test(prop)) lit.push(n[2]);
      lit.forEach(function (l) { if (RAW_COLOR_ALLOW.indexOf(l) < 0) out.push(f + ': Farb-Literal ' + l + ' in "' + prop + ': ' + v + '" – Farb-Token verwenden (@c.<name>@, design/tokens.json)'); });
    });
  }
  return out;
}
/* Palette fuer eine Marke: ihre Standardfarbe (accentId) mit dem Markenwert und ihren Zeiger-Bildern, die anderen mit pointer-<id> */
function brandPalette(brand) {
  var b = brand || BRAND_CSS;
  return loadPalette().map(function (p) {
    var own = p.id === b.accentId;
    return { id: p.id, color: own ? b.accent : p.color, pointer: own ? b.pointer : 'pointer-' + p.id, base: own };
  });
}
function cssRules(css) {                 // kompaktes CSS (ohne Kommentare) -> [{sel, decls:[[prop, value]]} | {raw}]
  var out = [], i = 0, n = css.length;
  while (i < n) {
    var o = css.indexOf('{', i);
    if (o < 0) break;
    var sel = css.slice(i, o).trim();
    if (sel.charAt(0) === '@') {         // @-webkit-keyframes … : unveraendert (verschachtelte Klammern)
      var d = 0, j = o;
      for (; j < n; j++) { if (css[j] === '{') d++; else if (css[j] === '}' && --d === 0) break; }
      out.push({ raw: css.slice(i, j + 1) }); i = j + 1; continue;
    }
    var c = css.indexOf('}', o), decls = [];
    css.slice(o + 1, c).split(';').forEach(function (x) {
      var k = x.indexOf(':');
      if (k > 0) decls.push([x.slice(0, k).trim(), x.slice(k + 1).trim()]);
    });
    out.push({ sel: sel.split(',').map(function (x) { return x.trim(); }), decls: decls });
    i = c + 1;
  }
  return out;
}
function specificity(sel) {
  var s = sel.replace(/::?[a-z-]+\([^)]*\)/g, ' .p ').replace(/::[a-z-]+/g, ' ');
  var a = (s.match(/#[\w-]+/g) || []).length, b = (s.match(/\.[\w-]+|\[[^\]]*\]|:[a-z-]+/g) || []).length;
  var c = (s.replace(/#[\w-]+|\.[\w-]+|\[[^\]]*\]|:[a-z-]+/g, ' ').match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length;
  return a * 10000 + b * 100 + c;
}
/* letztes Selektor-Glied: Klassen und Elementname ("*"/fehlend = beliebig) */
function lastPart(sel) {
  var a = sel.split(/[\s>+~]+/), p = a.pop(), t = /^[a-zA-Z][\w-]*/.exec(p);
  return { cls: p.match(/[.#][\w-]+/g) || [], tag: t ? t[0].toLowerCase() : '', up: a.join(' ').match(/[.#][\w-]+/g) || [] };
}
/* Teil-Eigenschaften, die eine Deklaration setzt (nur die, die eine Akzent-Deklaration betreffen koennen) */
function parts(prop) {
  var p = prop.replace(/^-webkit-/, '');
  if (p === 'background') return ['bg-color', 'bg-image'];
  if (p === 'background-color') return ['bg-color'];
  if (p === 'background-image') return ['bg-image'];
  if (/^border(-(top|right|bottom|left))?(-color)?$/.test(p)) return ['border-color'];
  if (p === 'color' || p === 'cursor') return [p];
  return [];
}
function hasToken(v) { return /@(accent|pointer)@/.test(v); }
function accentCss(css, pal) {
  var rules = cssRules(css), base = null, vars = [], tok = [];
  pal.forEach(function (p) { if (p.base) base = p; else vars.push(p); });
  if (!base) { fail('CSS: Standardfarbe der Marke fehlt in der Palette (accentId)'); return css; }
  function fill(v, p) { return v.replace(/@accent@/g, p.color).replace(/@pointer@/g, p.pointer); }
  rules.forEach(function (r, ri) {
    if (r.raw) { if (hasToken(r.raw)) fail('CSS: Marken-Token in @-Regel'); return; }
    r.decls.forEach(function (d) { if (hasToken(d[1])) tok.push({ ri: ri, parts: parts(d[0]), sel: r.sel }); });
    r.sel.forEach(function (s) { if (hasToken(r.decls.map(function (d) { return d[1]; }).join(';')) && /^(html|body)\b/.test(s)) fail('CSS: Token-Regel auf html/body: ' + s); });
  });
  function overlaps(sa, sb) {             // koennen beide Selektoren dasselbe Element treffen? (Klassen-Muster dieses CSS)
    var a = lastPart(sa), b = lastPart(sb), i;
    if (a.cls.length && b.cls.length) { for (i = 0; i < a.cls.length; i++) if (b.cls.indexOf(a.cls[i]) >= 0) return !(a.tag && b.tag && a.tag !== b.tag); return false; }
    if (!a.cls.length && !b.cls.length) {   // nur Elemente (".np-bar i"): gleiche Vorfahren-Klasse noetig
      if (a.tag && b.tag && a.tag !== b.tag) return false;
      if (!a.up.length || !b.up.length) return true;
      for (i = 0; i < a.up.length; i++) if (b.up.indexOf(a.up[i]) >= 0) return true;
      return false;
    }
    var t = a.cls.length ? b : a;         // ein Glied nur mit Element: trifft nur, wenn es beliebig ist ("*"/leer)
    return !t.tag;
  }
  function conflicts(ri, sel, prop) {     // koennte diese Deklaration eine Token-Deklaration ueberstimmen?
    var f = parts(prop);
    return tok.some(function (t) {
      if (t.ri === ri || !t.parts.some(function (x) { return f.indexOf(x) >= 0; })) return false;
      return t.sel.some(function (sa) { return sel.some(function (sb) { return overlaps(sa, sb) && specificity(sb) >= specificity(sa); }); });
    });
  }
  function scoped(sels, list) { var o = []; list.forEach(function (p) { sels.forEach(function (s) { o.push('.ac-' + p.id + ' ' + s); }); }); return o.join(','); }
  function block(decls) { return '{' + decls.map(function (d) { return d[0] + ':' + d[1]; }).join(';') + '}'; }
  /* Eintraege in Quellreihenfolge: je Token-Regel einer pro Farbe, je Begleitregel einer fuer alle Farben ('*').
   * Gleiche Deklarationen einer Farbe werden zusammengefasst (an die erste Stelle), sofern keine Regel dazwischen dasselbe
   * Element und dieselbe Teil-Eigenschaft treffen kann – die Kaskade bleibt also gleich, das CSS waechst weniger. */
  var head = [], ents = [], copies = 0;
  function partsOf(decls) { var o = []; decls.forEach(function (d) { o = o.concat(parts(d[0])); }); return o; }
  rules.forEach(function (r, ri) {
    if (r.raw) { head.push(r.raw); return; }
    head.push(r.sel.join(',') + block(r.decls.map(function (d) { return [d[0], fill(d[1], base)]; })));
    var t = r.decls.filter(function (d) { return hasToken(d[1]); });
    if (t.length) vars.forEach(function (p) { ents.push({ c: p.id, sel: r.sel.slice(), b: block(t.map(function (d) { return [d[0], fill(d[1], p)]; })), parts: partsOf(t) }); });
    else {
      var c = r.decls.filter(function (d) { return conflicts(ri, r.sel, d[0]); });
      if (c.length && vars.length) { ents.push({ c: '*', sel: r.sel.slice(), b: block(c), parts: partsOf(c) }); copies++; }
    }
  });
  function clash(x, y) {
    if (!x.parts.some(function (q) { return y.parts.indexOf(q) >= 0; })) return false;
    return x.sel.some(function (sa) { return y.sel.some(function (sb) { return overlaps(sa, sb); }); });
  }
  var out = [];
  ents.forEach(function (e) {
    for (var i = out.length - 1; i >= 0; i--) {
      var o = out[i];
      if (o.c === e.c && o.b === e.b) { o.sel = o.sel.concat(e.sel); o.parts = o.parts.concat(e.parts); return; }
      if ((o.c === e.c || o.c === '*' || e.c === '*') && clash(o, e)) break;
    }
    out.push(e);
  });
  var extra = out.map(function (e) { return scoped(e.sel, e.c === '*' ? vars : [{ id: e.c }]) + e.b; });
  pal.forEach(function (p) { extra.push('.sw-' + p.id + '{background:' + p.color + '}'); });   // Farbfelder (Einstellung, Auswahl)
  accentCss.stats = { variants: vars.length, tokenRules: rules.filter(function (r) { return !r.raw && r.decls.some(function (d) { return hasToken(d[1]); }); }).length, copies: copies, bytes: extra.join('').length };
  return head.join('') + extra.join('');
}
function buildCss(cssText, brand) {
  var css = cssText !== undefined ? cssText : fs.readFileSync(path.join(SRC, 'css', 'app.css'), 'utf8');
  var b = brand || BRAND_CSS;
  var code = css.replace(/\/\*[\s\S]*?\*\//g, '');
  var tk = TOKENS.resolve(code);           // Design-Tokens vor den Gates einsetzen (die Gates sehen die echten Werte)
  tk.unknown.forEach(function (u) { fail('CSS: unbekannter Design-Token ' + u + ' (design/tokens.json)'); });
  code = tk.text;
  if (/@[a-z]+@/.test(code.replace(/@(accent|pointer)@/g, ''))) fail('CSS: unbekannter Marken-Token ' + code.replace(/@(accent|pointer)@/g, '').match(/@[a-z]+@/)[0]);
  var bad = [[/gradient/i, 'gradient'], [/box-shadow/i, 'box-shadow'], [/text-shadow/i, 'text-shadow'], [/(^|[^-\w])filter\s*:/i, 'filter'],
    [/display\s*:\s*(-webkit-)?flex/i, 'flex'], [/calc\(/i, 'calc()'], [/\d(vw|vh)\b/i, 'vw/vh'], [/var\(/i, 'var()']];
  bad.forEach(function (b) { if (b[0].test(code)) fail('CSS verboten: ' + b[1]); });
  var m, re = /font-size\s*:\s*(\d+)px/g;
  while ((m = re.exec(code))) if (Number(m[1]) < 16) fail('CSS font-size < 16px: ' + m[0]);
  ['transform', 'transition', 'animation', 'transform-origin'].forEach(function (p) {
    var r = new RegExp('(^|[;{\\s])' + p + '\\s*:', 'g');
    if (r.test(code)) fail('CSS ohne -webkit--Praefix: ' + p);
  });
  code = code.replace(/\s+/g, ' ').replace(/\s*([{};:,])\s*/g, '$1').replace(/;}/g, '}').trim();
  return accentCss(code, brandPalette(b));
}

/* ---------- i18n ---------- */
function checkI18n(extra) {
  var ctx = { N: undefined };
  vm.createContext(ctx);
  ['core/ns.js', 'i18n/strings.de.js', 'i18n/strings.en.js', 'i18n/strings.music.js'].concat(extra || []).forEach(function (f) { vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f }); });
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
  var ids = loadPalette().map(function (p) { return p.id; });
  if (ids.indexOf(b.accentId) < 0) { fail('brand/' + id + '.json: accentId muss eine Palettenfarbe sein (' + ids.join(', ') + ')'); return null; }
  var feats = b.features === undefined ? [] : b.features;
  if (!Array.isArray(feats) || feats.some(function (f) { return typeof f !== 'string' || !/^[a-z0-9-]+$/.test(f); })) { fail('brand/' + id + '.json: features muss eine Liste von Namen sein'); return null; }
  return { id: id, name: b.name, wordmark: [String(b.wordmark[0]), String(b.wordmark[1])], accent: b.accent, pointer: b.pointer, accentId: b.accentId, features: feats };
}

/* ---------- optionale Erweiterungen (brand/<id>.json "features") ----------
 * Gibt es src/<EXT_DIR>/manifest.json (nur in Baeumen, die Erweiterungen enthalten), haengt der Build die Module jeder im
 * Marken-Profil eingeschalteten Erweiterung NACH dem Haupt-Manifest an, ihr CSS hinter app.css (gleiche Gates, gleiche Tokens)
 * und prueft ihre Texte (Dateien "strings*.js") mit dem i18n-Gate. Ohne Ordner oder ohne "features": nichts davon.
 * Format: {"<feature>": {"js": ["pfad.js", …], "css": ["pfad.css", …]}} – Pfade relativ zu src/<EXT_DIR>/. */
var EXT_DIR = 'private';
function extensions(brand) {
  var base = path.join(SRC, EXT_DIR), mp = path.join(base, 'manifest.json'), out = { js: [], css: [], strings: [], listed: [], on: [] };
  if (!fs.existsSync(mp)) return out;
  var m;
  try { m = JSON.parse(fs.readFileSync(mp, 'utf8')); } catch (e) { fail('src/' + EXT_DIR + '/manifest.json ist kein gueltiges JSON: ' + e.message); return out; }
  Object.keys(m).forEach(function (f) {
    var e = m[f] || {}, js = (e.js || []).map(function (x) { return EXT_DIR + '/' + x; }), css = (e.css || []).map(function (x) { return EXT_DIR + '/' + x; });
    out.listed = out.listed.concat(js, css);
    if (!brand || brand.features.indexOf(f) < 0) return;
    out.on.push(f);
    out.js = out.js.concat(js); out.css = out.css.concat(css);
    js.forEach(function (x) { if (/(^|\/)strings[^\/]*\.js$/.test(x)) out.strings.push(x); });
  });
  (brand ? brand.features : []).forEach(function (f) { if (!m[f]) fail('brand: Erweiterung "' + f + '" fehlt in src/' + EXT_DIR + '/manifest.json'); });
  return out;
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
  var ext = extensions(brand);
  if (ext.on.length) console.log('Erweiterungen: ' + ext.on.join(', ') + ' (' + ext.js.length + ' Module)');
  fs.readdirSync(path.join(SRC, 'css')).filter(function (f) { return /\.css$/.test(f); }).forEach(function (f) {
    cssSourceErrors(fs.readFileSync(path.join(SRC, 'css', f), 'utf8'), 'src/css/' + f).forEach(fail);
  });
  ext.listed.forEach(function (f) { if (!fs.existsSync(path.join(SRC, f))) fail('Erweiterungs-Datei fehlt: src/' + f); });
  var extCss = ext.css.filter(function (f) { return fs.existsSync(path.join(SRC, f)); }).map(function (f) {
    var t = fs.readFileSync(path.join(SRC, f), 'utf8');
    cssSourceErrors(t, 'src/' + f).forEach(fail);
    return t;
  }).join('\n');
  var css = buildCss(extCss ? fs.readFileSync(path.join(SRC, 'css', 'app.css'), 'utf8') + '\n' + extCss : undefined, brand);
  var cssStats = accentCss.stats;
  var keys = checkI18n(ext.strings);
  var local = localConfig();
  var parts = ['/* gebaut aus src/ (tools/build.js). Nicht von Hand bearbeiten. */'], rel = [];
  var main = manifest.slice();
  manifest = manifest.concat(ext.js);                      // Erweiterungen hinter dem Haupt-Manifest (melden sich per N.ext an)
  manifest.forEach(function (f, i) {
    var p = path.join(SRC, f);
    if (!fs.existsSync(p)) { fail('Manifest-Datei fehlt: ' + f); return; }
    var chunk = '/* ===== ' + f + ' ===== */\n' + fs.readFileSync(p, 'utf8');
    parts.push(chunk);
    if (!/^dev\//.test(f)) rel.push(chunk);                // Release (minifiziert): ohne Entwicklungs-Module
    var extra = i === 0 ? 'N.CSS = ' + JSON.stringify(css) + ';' : f === 'core/config.js' && Object.keys(local).length ? 'N.config.apply(' + JSON.stringify(local) + ');   /* aus local.json */' :
      f === 'core/brand.js' && brand ? 'N.brand = ' + JSON.stringify({ id: brand.id, name: brand.name, wordmark: brand.wordmark, accent: brand.accentId }) + ';   /* brand/' + brand.id + '.json */' +
        (ext.on.length ? '\nN.features = ' + JSON.stringify(ext.on) + ';' : '') : '';
    if (extra) { parts.push(extra); rel.push(extra); }
  });
  // nicht im Manifest gelistete Quelldateien melden
  (function scan(dir) {
    fs.readdirSync(dir).forEach(function (f) {
      var p = path.join(dir, f), rel = path.relative(SRC, p);
      if (fs.statSync(p).isDirectory()) { if (f !== 'assets' && f !== 'css') scan(p); }
      else if (/\.js$/.test(f) && main.indexOf(rel) < 0 && ext.listed.indexOf(rel) < 0) fail('Quelldatei nicht im Manifest: ' + rel + (rel.indexOf(EXT_DIR + '/') === 0 ? ' (src/' + EXT_DIR + '/manifest.json)' : ''));
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
    // Zeiger-Bilder der Palette fuer diese Marke (Standardfarbe: <pointer>.png der Marke, sonst pointer-<id>.png, je mit -press); fremde aus app/ entfernen
    var mine = [];
    brandPalette(brand).forEach(function (p) { mine.push(p.pointer + '.png', p.pointer + '-press.png'); });
    mine.forEach(function (f) { if (!fs.existsSync(path.join(SRC, 'assets', f))) fail('Zeiger-Bild fehlt: src/assets/' + f + ' (node tools/make_assets.js --pointers)'); });
    if (errors.length) { console.error('BUILD FEHLGESCHLAGEN:\n  - ' + errors.join('\n  - ')); process.exit(1); }
    function isPtr(f) { return /^pointer.*\.png$/.test(f); }
    var assets = fs.readdirSync(path.join(SRC, 'assets')).filter(function (f) { return /\.(png|gif)$/.test(f) && (!isPtr(f) || mine.indexOf(f) >= 0); });
    fs.readdirSync(OUT).forEach(function (f) { if (isPtr(f) && mine.indexOf(f) < 0) fs.unlinkSync(path.join(OUT, f)); });
    assets.forEach(function (f) { fs.copyFileSync(path.join(SRC, 'assets', f), path.join(OUT, f)); });
    var gz = require('zlib');
    console.log('app/app.js: ' + kb(code.length) + ' KB lesbar (' + manifest.length + ' Module, CSS ' + kb(css.length) + ' KB davon Akzent-Varianten ' + kb(cssStats.bytes) + ' KB (' + cssStats.variants + ' Farben x ' + cssStats.tokenRules + ' Regeln, ' + cssStats.copies + ' Begleitregeln), ' + keys + ' Texte je Sprache), ' +
      'Startdateien: 1 (CSS eingebettet), Bilder: ' + assets.join(', ') + ' – ' + (Date.now() - t0) + ' ms');
    if (min !== null) {
      console.log('app/app.min.js: ' + kb(min.length) + ' KB minifiziert, ' + kb(gz.gzipSync(min).length) + ' KB gzip (Release-Paket, ohne dev/)');
      if (min.length > 180 * 1024) console.log('HINWEIS: app.min.js > 180 KB (Budget SPEC 16.2) – Rest sind Texte (de/en), CSS und Eigenschaftsnamen, siehe docs/P7-TV-TEST.md.');
    } else console.log('HINWEIS: --no-min – app/app.min.js nicht neu gebaut.');
    // Regressionsschutz: alle Unit-Tests laufen im Build; bei Fehlern bleiben die vorherigen Dateien stehen
    if (process.argv.indexOf('--no-test') < 0) {
      var globs = ['tests/*.test.js'].concat(fs.existsSync(path.join(ROOT, 'tests', EXT_DIR)) ? ['tests/' + EXT_DIR + '/*.test.js'] : []);
      var r = require('child_process').spawnSync(process.execPath, ['--test'].concat(globs), { cwd: ROOT, stdio: 'inherit' });
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
  /* Quell-Gate fuer src/css/*.css (Farb-Literale, Token-Platzhalter) -> Liste der Fehler */
  cssSourceErrors: cssSourceErrors,
  /* Akzent-Varianten (tests/accent.test.js): CSS (Rohtext) + Marke -> {css, errors, stats} */
  css: function (css, brand) { errors = []; var out = buildCss(css, brand); return { css: out, errors: errors.slice(), stats: accentCss.stats }; },
  brandPalette: brandPalette, loadPalette: loadPalette, specificity: specificity,
  /* Erweiterungen eines Marken-Profils (tests/helpers/load.js, Werkzeuge): {js, css, strings, listed, on} */
  extensions: function (brand) { errors = []; return extensions(brand); },
  escapeNonAscii: escapeNonAscii,
  minify: minify
};
