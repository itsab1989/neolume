#!/usr/bin/env node
/* Replaces literal design values in src/css/*.css with design-token placeholders (design/tokens.json).
 *   node tools/tokenize_css.js            dry run: lists what would change and which colour literals have no token yet
 *   node tools/tokenize_css.js --write    rewrites the files in place (formatting and comments stay as they are)
 * Use it after writing new CSS: the build refuses raw colour literals in src/css (tools/build.js cssSourceErrors).
 * A colour without a matching token is reported – add it to design/tokens.json (with a description) and run again.
 * The output of the build does not change: every placeholder resolves to exactly the literal it replaced.
 * What is converted (values that are design decisions, not one-off geometry):
 *   - every colour literal whose value equals a colour token (c.*)
 *   - font-size / line-height / font-weight / letter-spacing of rules whose size + line-height match a type style (ty.*),
 *     the font stack (ty.family)
 *   - padding / margin when every non-zero value is on the spacing scale (sp.*)
 *   - border-radius on the radius scale (r.*), unless it is a circle/pill (radius = half the width or height of the rule)
 *   - focus ring width/radius, settings-row border, focus scale(1.08 / 1.04) (fo.*)
 *   - durations and easing curves in transitions/animations (mo.*), global z-index layers (z.*)
 *   - stage size, content edge, rail/panel sizes, title-safe margins (l.*), icon cell and sprite rows (ic.*) */
'use strict';
var fs = require('fs'), path = require('path'), T = require('./tokens.js');
var ROOT = path.join(__dirname, '..'), DIR = path.join(ROOT, 'src', 'css');

function inverse(group, t) {               // value -> token name of one group (first wins)
  var o = {}, g = t.groups[group].tokens;
  Object.keys(g).forEach(function (n) { var v = norm(String(g[n].value)); if (!(v in o)) o[v] = group + '.' + n; });
  return o;
}
function norm(v) { return /^#/.test(v) ? v.toUpperCase() : v.replace(/\s+/g, ''); }
function ph(name) { return '@' + name + '@'; }

/* selector-bound layout/focus tokens (only where the value means the token, not wherever the number appears) */
var BOUND = [
  [/^\.focus-ring$/, 'border', /^4px(?= solid)/, 'fo.ring-width'], [/^\.focus-ring$/, 'border-radius', /^14px$/, 'fo.ring-radius'],
  [/^\.set-row$/, 'border', /^3px(?= solid)/, 'fo.row-border'],
  [/^\.panel$/, 'left', /^840px$/, 'l.panel-x'], [/^(\.panel|\.tp-clip|\.tp-list)$/, 'width', /^440px$/, 'l.panel-w'],
  [/^\.nav-panel$/, 'width', /^320px$/, 'l.nav-w'], [/^(#pn-rail|\.rail-bg)$/, 'width', /^120px$/, 'l.rail-w'],
  [/^\.pl-top$/, 'top', /^36px$/, 'l.safe-y'],
  [/^(\.pl-(top|bot|mh|skip)|.*\.scs-blk)$/, 'left', /^64px$/, 'l.safe-x'], [/^(\.pl-(top|bot|mh|skip)|.*\.scs-blk)$/, 'right', /^64px$/, 'l.safe-x'], [/^\.ic$/, 'width', /^32px$/, 'ic.cell'], [/^\.ic$/, 'height', /^32px$/, 'ic.cell']
];
var LOCAL_Z = /^(\.prof \.lock|\.scs-ov)$/;   // z-index inside a component, not a global layer

function convert(src, t, log) {
  var col = inverse('c', t), mo = inverse('mo', t), z = inverse('z', t), sp = inverse('sp', t), r = inverse('r', t), ty = t.groups.ty.tokens;
  var styles = Object.keys(ty).filter(function (k) { return /\.size$/.test(k); }).map(function (k) {
    var s = k.replace(/\.size$/, ''), g = function (p) { return ty[s + '.' + p] ? String(ty[s + '.' + p].value) : null; };
    return { id: s, size: g('size'), lh: g('lh'), weight: g('weight'), ls: g('ls') };
  });
  var rows = {}; t.icons.rows.forEach(function (n, i) { rows[i ? -(i * t.icons.cell) + 'px' : '0'] = 'ic.row.' + n; });
  // mask comments (same length) so braces/semicolons inside them are ignored
  var mask = src.replace(/\/\*[\s\S]*?\*\//g, function (c) { return c.replace(/[^\n]/g, ' '); });
  var out = '', pos = 0, re = /([^{}]*)\{([^{}]*)\}/g, m, n = 0;
  while ((m = re.exec(mask))) {
    var bodyStart = m.index + m[1].length + 1, bodyEnd = bodyStart + m[2].length;
    var sel = m[1].trim().replace(/\s+/g, ' '), sels = sel.split(/\s*,\s*/);
    if (/^@/.test(sel) || /^(from|to|\d+%)$/.test(sel)) sels = [sel];
    var body = src.slice(bodyStart, bodyEnd), maskBody = m[2];
    // declarations of this rule (by property) for context
    var decl = {};
    maskBody.split(';').forEach(function (d) { var k = d.indexOf(':'); if (k > 0) decl[d.slice(0, k).trim()] = d.slice(k + 1).trim(); });
    var style = null;
    if (decl['font-size'] && decl['line-height']) {
      var c = styles.filter(function (s) { return s.size === decl['font-size'] && s.lh === decl['line-height']; });
      if (c.length > 1) c = c.filter(function (s) { return (s.weight === '600') === (decl['font-weight'] === '600'); });
      style = c[0] || null;
    }
    function half(v) { var x = parseFloat(v); return isNaN(x) ? null : x * 2; }
    var w = parseFloat(decl.width), h = parseFloat(decl.height);
    var newBody = '', bp = 0;
    maskBody.replace(/[^;]+/g, function (d, off) {
      var k = d.indexOf(':');
      if (k < 0) return d;
      var prop = d.slice(0, k).trim(), vStart = off + k + 1, raw = body.slice(vStart, off + d.length);
      var lead = /^\s*/.exec(raw)[0], trail = /\s*$/.exec(raw)[0], v = raw.slice(lead.length, raw.length - trail.length), nv = v;
      if (!v || /\/\*/.test(raw)) return d;
      // colours
      nv = nv.replace(/#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?)\([^)]*\)/g, function (l) { var k2 = col[norm(l)]; return k2 ? ph(k2) : l; });
      // motion
      if (/^-webkit-(transition|animation)$/.test(prop)) {
        nv = nv.replace(/\b\d+ms\b/g, function (x) { return mo[x] ? ph(mo[x]) : x; }).replace(/cubic-bezier\([^)]*\)/g, function (x) { return mo[norm(x)] ? ph(mo[norm(x)]) : x; });
      }
      if (prop === '-webkit-transform') nv = nv.replace(/scale\((1\.08|1\.04)\)/g, function (x, s) { return 'scale(' + ph(s === t.groups.fo.tokens.scale.value ? 'fo.scale' : 'fo.scale-btn') + ')'; });
      if (prop === 'z-index' && z[v] && !sels.some(function (s) { return LOCAL_Z.test(s); })) nv = ph(z[v]);
      // type
      if (style) {
        if (prop === 'font-size') nv = ph('ty.' + style.id + '.size');
        else if (prop === 'line-height') nv = ph('ty.' + style.id + '.lh');
        else if (prop === 'font-weight' && v === style.weight) nv = ph('ty.' + style.id + '.weight');
        else if (prop === 'letter-spacing' && v === style.ls) nv = ph('ty.' + style.id + '.ls');
      }
      if (prop === 'font-family' && norm(v) === norm(ty.family.value)) nv = ph('ty.family');
      // spacing
      if (/^(padding|margin)(-(top|right|bottom|left))?$/.test(prop)) {
        var parts = v.split(/\s+/);
        if (parts.every(function (p) { return p === '0' || p === 'auto' || sp[p] || /^@/.test(p); }) && parts.some(function (p) { return sp[p]; }))
          nv = parts.map(function (p) { return sp[p] ? ph(sp[p]) : p; }).join(' ');
      }
      // radius (not for circles/pills)
      if (prop === 'border-radius' && r[v] && half(v) !== w && half(v) !== h) nv = ph(r[v]);
      // layout
      if (prop === 'width' && v === t.groups.l.tokens['screen-w'].value) nv = ph('l.screen-w');
      if (prop === 'height' && v === t.groups.l.tokens['screen-h'].value) nv = ph('l.screen-h');
      if (/^(-webkit-)?background-size$/.test(prop) && v === t.groups.l.tokens['screen-w'].value + ' ' + t.groups.l.tokens['screen-h'].value) nv = ph('l.screen-w') + ' ' + ph('l.screen-h');
      if (prop === 'left' && v === t.groups.l.tokens['content-x'].value) nv = ph('l.content-x');
      BOUND.forEach(function (b) { if (b[1] === prop && sels.length === 1 && b[0].test(sels[0]) && b[2].test(nv)) nv = nv.replace(b[2], ph(b[3])); });
      if (prop === 'background-position-y' && rows[v]) nv = ph(rows[v]);
      if (nv !== v) { n++; if (log) log(sel + ' { ' + prop + ': ' + v + ' -> ' + nv + ' }'); }
      newBody += body.slice(bp, vStart) + lead + nv + trail;
      bp = off + d.length;
      return d;
    });
    newBody += body.slice(bp);
    out += src.slice(pos, bodyStart) + newBody;
    pos = bodyEnd;
  }
  out += src.slice(pos);
  return { text: out, changes: n };
}

if (require.main === module) {
  var write = process.argv.indexOf('--write') >= 0, verbose = process.argv.indexOf('-v') >= 0, t = T.load(), bad = 0;
  fs.readdirSync(DIR).filter(function (f) { return /\.css$/.test(f); }).forEach(function (f) {
    var p = path.join(DIR, f), src = fs.readFileSync(p, 'utf8');
    var r = convert(src, t, verbose ? function (s) { console.log('  ' + s); } : null);
    console.log('src/css/' + f + ': ' + r.changes + ' value(s) ' + (write ? 'replaced' : 'to replace'));
    if (write && r.changes) fs.writeFileSync(p, r.text);
    require('./build.js').cssSourceErrors(r.text, 'src/css/' + f).forEach(function (e) { bad++; console.log('  still raw: ' + e); });
  });
  if (bad) { console.log('Add the missing colours to design/tokens.json (group "c", with a description) and run again.'); process.exit(1); }
}
module.exports = { convert: convert };
