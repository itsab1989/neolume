/* Findet alle Dialog-/Zustandsbox-Definitionen im Quelltext (Objekt-Literal mit "buttons: [...]") fuer die Knopf-Regel NAV-11:
 * Hauptaktion links (bzw. oben), Abbrechen/Behalten/Zurueck/Spaeter/Schliessen rechts (bzw. unten); Fokus bei loeschenden oder
 * verlassenden Rueckfragen auf der sicheren Option (dem letzten Knopf), sonst auf der Hauptaktion (dem ersten).
 * scan(dir) -> { lit: [{file, line, ids, keys, focus, vertical}], dyn: [{file, line}] }
 *   lit: Knoepfe als Literal (auch "a ? [..] : [..]" und eine Variable, die nur so belegt und nie per push erweitert wird)
 *   dyn: zur Laufzeit gebaute Listen – deren Reihenfolge pruefen die Verhaltens-Tests (die Liste hier zwingt zum Hinsehen). */
'use strict';
var fs = require('fs'), path = require('path');
var acorn = require('acorn'), walk = require('acorn-walk');

/* "Neben-Knoepfe": stehen immer zuletzt */
var SECONDARY = { cancel: 1, keep: 1, later: 1, back: 1, close: 1, stay: 1 };

function files(dir) {
  var out = [];
  if (!fs.existsSync(dir)) return out;
  fs.readdirSync(dir).forEach(function (f) {
    var p = path.join(dir, f), st = fs.statSync(p);
    if (st.isDirectory()) out = out.concat(files(p));
    else if (/\.js$/.test(f)) out.push(p);
  });
  return out;
}
function prop(obj, name) {
  for (var i = 0; i < obj.properties.length; i++) {
    var p = obj.properties[i];
    if (p.type === 'Property' && !p.computed && (p.key.name || p.key.value) === name) return p.value;
  }
  return null;
}
/* erster String im Ausdruck (Textschluessel eines Knopfs: N.t('dlg.exit.confirm') / t('btn.keep') / N.t(a ? 'x' : 'y')) */
function firstStr(node) {
  var s = null;
  walk.full(node, function (n) { if (s === null && n.type === 'Literal' && typeof n.value === 'string') s = n.value; });
  return s;
}
function arrays(node, vars) {
  if (!node) return null;
  if (node.type === 'ArrayExpression') return [node];
  if (node.type === 'ConditionalExpression') {
    var a = arrays(node.consequent, vars), b = arrays(node.alternate, vars);
    return a && b ? a.concat(b) : null;
  }
  if (node.type === 'Identifier' && vars[node.name]) return arrays(vars[node.name], {});
  return null;
}

function scanFile(file, root) {
  var src = fs.readFileSync(file, 'utf8'), rel = path.relative(root, file).split(path.sep).join('/');
  var ast = acorn.parse(src, { ecmaVersion: 5, locations: true }), vars = {}, pushed = {}, multi = {}, lit = [], dyn = [];
  walk.simple(ast, {
    VariableDeclarator: function (n) {
      if (!n.init || n.id.type !== 'Identifier') return;
      if (vars[n.id.name]) multi[n.id.name] = 1;
      vars[n.id.name] = n.init;
    },
    AssignmentExpression: function (n) { if (n.left.type === 'Identifier') multi[n.left.name] = 1; },
    CallExpression: function (n) {
      var c = n.callee;
      if (c.type === 'MemberExpression' && c.object.type === 'Identifier' && /^(push|unshift|splice|concat)$/.test(c.property.name)) pushed[c.object.name] = 1;
    }
  });
  var safeVars = {};
  Object.keys(vars).forEach(function (k) { if (!pushed[k] && !multi[k]) safeVars[k] = vars[k]; });
  walk.simple(ast, {
    ObjectExpression: function (o) {
      var b = prop(o, 'buttons');
      if (!b || /Function/.test(b.type)) return;            // Detailseiten-Controller: buttons() ist eine Funktion, kein Dialog
      var line = o.loc.start.line, list = arrays(b, safeVars);
      if (!list) { dyn.push({ file: rel, line: line }); return; }
      var f = prop(o, 'focus'), v = prop(o, 'vertical');
      var focus = !f ? 0 : f.type === 'Literal' ? f.value : 'expr';
      list.forEach(function (arr) {
        if (!arr.elements.length) return;                   // Karte ohne Knoepfe (arbeitet gerade)
        lit.push({ file: rel, line: line, focus: focus, vertical: !!(v && v.value),
          ids: arr.elements.map(function (e) { var x = e.type === 'ObjectExpression' && prop(e, 'id'); return x ? x.value : '?'; }),
          keys: arr.elements.map(function (e) { var x = e.type === 'ObjectExpression' && prop(e, 't'); return x ? firstStr(x) : null; }) });
      });
    }
  });
  return { lit: lit, dyn: dyn };
}

function scan(dir, root) {
  var out = { lit: [], dyn: [] };
  files(dir).forEach(function (f) { var r = scanFile(f, root); out.lit = out.lit.concat(r.lit); out.dyn = out.dyn.concat(r.dyn); });
  return out;
}

/* Prueft eine Definition gegen NAV-11; SAFE = Textschluessel der Hauptaktionen, die loeschen/verlassen (Fokus auf den letzten Knopf).
 * Gibt eine Fehlermeldung oder '' zurueck. */
function check(d, SAFE) {
  var where = d.file + ':' + d.line + ' [' + d.ids.join(', ') + ']', n = d.ids.length, last = n - 1;
  for (var i = 0; i < last; i++) if (SECONDARY[d.ids[i]]) return where + ': "' + d.ids[i] + '" ist ein Neben-Knopf und gehoert ans Ende (rechts bzw. unten)';
  if (n < 2) return '';
  var safe = !!SAFE[d.keys[0]];
  if (safe && d.focus !== last) return where + ': loeschende/verlassende Rueckfrage – Fokus muss auf dem sicheren letzten Knopf stehen (focus: ' + last + ')';
  if (safe && !SECONDARY[d.ids[last]]) return where + ': loeschende/verlassende Rueckfrage braucht einen sicheren Knopf am Ende';
  if (!safe && d.focus !== 0 && d.focus !== 'expr') return where + ': harmlose Auswahl – Fokus auf die Hauptaktion (erster Knopf), oder Textschluessel "' + d.keys[0] + '" in SAFE eintragen';
  return '';
}

/* Hauptaktionen, deren Name nach Loeschen/Verlassen klingt – muessen in SAFE stehen oder bewusst ausgenommen sein */
var RISKY = /exit|quit|remove|delete|clear|reset|withdraw|signOut|account\.confirm|mark\.confirm/i;

module.exports = { scan: scan, check: check, SECONDARY: SECONDARY, RISKY: RISKY };
