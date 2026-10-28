/* Design tokens and icon sources (design/tokens.json, design/icons/*.svg) for build, asset generator, docs and tests.
 * One place that knows how the files are read, so every consumer sees the same values.
 *   var T = require('./tokens.js');
 *   T.map()                 -> { 'c.bg': '#0E0F11', 'sp.4': '16px', 'ic.row.text-1': '-64px', ... } (CSS placeholders)
 *   T.resolve(css)          -> { text, unknown: ['@x.y@', ...] }   replaces @group.name@ (comments are not touched specially)
 *   T.palette()             -> [{ id, color }]                    accent palette in order
 *   T.icons()               -> [{ name, attrs, body }]            icon sources in sprite column order
 *   T.spriteSvg()           -> SVG text of the whole sprite (input of rsvg-convert, also checked into src/assets/icons.svg)
 * Placeholder syntax: @<group>.<name>@ with group = lower-case letters, name = [a-z0-9.-]. The brand tokens @accent@ and
 * @pointer@ (no dot) are handled by tools/build.js itself (accent variants). */
'use strict';
var fs = require('fs'), path = require('path');
var ROOT = path.join(__dirname, '..'), FILE = path.join(ROOT, 'design', 'tokens.json'), ICON_DIR = path.join(ROOT, 'design', 'icons');
var PLACEHOLDER = /@([a-z]+)\.([a-z0-9][a-z0-9.-]*)@/g;

function load() { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
/* optionale Erweiterungen (nur in Baeumen mit design/private/, nicht im oeffentlichen Export): <name>-tokens.json im gleichen
 * Format mit EIGENEN Gruppen (eine Gruppe aus design/tokens.json zu ueberschreiben ist ein Fehler). Sie gelten nur fuer die
 * Platzhalter im Build (map/resolve ohne Argument); load() bleibt die oeffentliche Quelle (Dokumentation, Pruefungen). */
var EXT_DIR = path.join(ROOT, 'design', 'private');
function extFiles() { return fs.existsSync(EXT_DIR) ? fs.readdirSync(EXT_DIR).filter(function (f) { return /-tokens\.json$/.test(f); }).sort() : []; }
function extGroups() {
  var base = load().groups, out = {};
  extFiles().forEach(function (f) {
    var g = JSON.parse(fs.readFileSync(path.join(EXT_DIR, f), 'utf8')).groups || {};
    Object.keys(g).forEach(function (k) {
      if (base[k] || out[k]) throw new Error('design/private/' + f + ': Gruppe "' + k + '" gibt es schon – eigene Gruppe waehlen');
      out[k] = g[k];
    });
  });
  return out;
}

/* rows of the icon sprite -> background-position-y per colour state (row 0 = "0", like the hand-written CSS) */
function iconTokens(t) {
  var o = {}, ic = t.icons;
  o['ic.cell'] = ic.cell + 'px';
  ic.rows.forEach(function (r, i) { o['ic.row.' + r] = i ? -(i * ic.cell) + 'px' : '0'; });
  return o;
}
function map(t) {
  var withExt = !t;
  t = t || load();
  var o = {}, groups = t.groups;
  if (withExt) { var ex = extGroups(); groups = {}; Object.keys(t.groups).forEach(function (g) { groups[g] = t.groups[g]; }); Object.keys(ex).forEach(function (g) { groups[g] = ex[g]; }); }
  Object.keys(groups).forEach(function (g) {
    if (groups[g].css === false) return;
    Object.keys(groups[g].tokens).forEach(function (n) { o[g + '.' + n] = String(groups[g].tokens[n].value); });
  });
  var ic = iconTokens(t);
  Object.keys(ic).forEach(function (k) { o[k] = ic[k]; });
  return o;
}
function resolve(css, t) {
  var m = map(t), unknown = [];
  var text = css.replace(PLACEHOLDER, function (all, g, n) {
    var k = g + '.' + n;
    if (Object.prototype.hasOwnProperty.call(m, k)) return m[k];
    if (unknown.indexOf(all) < 0) unknown.push(all);
    return all;
  });
  return { text: text, unknown: unknown };
}
function color(name, t) { return (t || load()).groups.c.tokens[name].value; }
function palette(t) {
  var p = (t || load()).groups.accent.tokens;
  return Object.keys(p).map(function (id) { return { id: id, color: p[id].value }; });
}

/* ---------- icons ---------- */
function order() { return JSON.parse(fs.readFileSync(path.join(ICON_DIR, 'order.json'), 'utf8')).order; }
/* one file: <svg ...><g ATTRS>BODY</g></svg>; ATTRS/BODY use currentColor for the state colour */
function parseIcon(name, text) {
  var m = /^<svg\b[^>]*>\s*<g ([^>]*)>([\s\S]*)<\/g>\s*<\/svg>\s*$/.exec(text);
  if (!m) throw new Error('design/icons/' + name + '.svg: expected <svg …><g …>…</g></svg>');
  return { name: name, attrs: m[1], body: m[2] };
}
function icons() {
  return order().map(function (n) {
    var f = path.join(ICON_DIR, n + '.svg');
    if (!fs.existsSync(f)) throw new Error('design/icons/' + n + '.svg missing (listed in design/icons/order.json)');
    return parseIcon(n, fs.readFileSync(f, 'utf8'));
  });
}
function iconFiles() { return fs.readdirSync(ICON_DIR).filter(function (f) { return /\.svg$/.test(f); }).map(function (f) { return f.replace(/\.svg$/, ''); }).sort(); }
function spriteSvg(t) {
  t = t || load();
  var ic = t.icons, list = icons(), cell = ic.cell;
  var cols = ic.rows.map(function (r) { return color(r, t); });
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + (list.length * cell) + '" height="' + (cols.length * cell) + '">';
  cols.forEach(function (col, r) {
    list.forEach(function (it, i) {
      svg += '<g transform="translate(' + (i * cell + ic.inset) + ' ' + (r * cell + ic.inset) + ')" ' + it.attrs.replace(/currentColor/g, col) + '>' +
        it.body.replace(/currentColor/g, col) + '</g>';
    });
  });
  return svg + '</svg>';
}

module.exports = { FILE: FILE, ICON_DIR: ICON_DIR, EXT_DIR: EXT_DIR, extFiles: extFiles, extGroups: extGroups, PLACEHOLDER: PLACEHOLDER, load: load, map: map, resolve: resolve, color: color, palette: palette,
  order: order, icons: icons, iconFiles: iconFiles, parseIcon: parseIcon, spriteSvg: spriteSvg };
