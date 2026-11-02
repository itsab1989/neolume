/* Plattform-Wahl zur Bauzeit (docs/research/apple/01-platform.md): --platform <id> / env PLATFORM / Standard samsung-orsay.
 * Jede Plattform hat platforms/<id>/adapter/manifest.json (Liste der Adapter-Module, ES5, in dieser Reihenfolge direkt hinter
 * src/platform/platform.js geladen). Fehler werfen (tools/build.js meldet sie als Bau-Fehler). */
'use strict';
var fs = require('fs'), path = require('path');
var ROOT = path.join(__dirname, '..'), DEFAULT = 'samsung-orsay';

function id(argv, env) {
  argv = argv || []; env = env || {};
  var i = argv.indexOf('--platform'), v = i >= 0 ? argv[i + 1] : env.PLATFORM;
  if (v === undefined || v === '') return DEFAULT;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v)) throw new Error('--platform: ungueltige Kennung "' + v + '" (klein, z. B. samsung-orsay)');
  return v;
}
function dir(pid) { return path.join(ROOT, 'platforms', pid, 'adapter'); }
function modules(pid) {
  var d = dir(pid), mp = path.join(d, 'manifest.json');
  if (!fs.existsSync(d)) throw new Error('Plattform "' + pid + '" unbekannt: platforms/' + pid + '/adapter/ fehlt');
  if (!fs.existsSync(mp)) throw new Error('platforms/' + pid + '/adapter/manifest.json fehlt');
  var list = JSON.parse(fs.readFileSync(mp, 'utf8'));
  if (!Array.isArray(list) || !list.length) throw new Error('platforms/' + pid + '/adapter/manifest.json: Liste der Module leer');
  return list.map(function (f) {
    var abs = path.join(d, f);
    if (!fs.existsSync(abs)) throw new Error('Adapter-Datei fehlt: platforms/' + pid + '/adapter/' + f);
    return { rel: 'platforms/' + pid + '/adapter/' + f, abs: abs };
  });
}
/* Adapter-Dateien, die nicht im Manifest stehen (wie "Quelldatei nicht im Manifest" fuer src/) */
function unlisted(pid) {
  var d = dir(pid), listed = JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8')), out = [];
  (function scan(sub) {
    fs.readdirSync(path.join(d, sub)).forEach(function (f) {
      var r = sub ? sub + '/' + f : f;
      if (fs.statSync(path.join(d, r)).isDirectory()) scan(r);
      else if (/\.js$/.test(f) && listed.indexOf(r) < 0) out.push('platforms/' + pid + '/adapter/' + r);
    });
  })('');
  return out;
}
/* Plattform-Zusaetze einer Erweiterung (brand "features"): platforms/<id>/private/<feature>/manifest.json {"<feature>": {"js": [...]}}
 * -> Module hinter denen der Erweiterung (Zusaetze nur fuer diese Plattform). Ohne Datei: []. */
function extModules(pid, feature) {
  var d = path.join(ROOT, 'platforms', pid, 'private', feature), mp = path.join(d, 'manifest.json');
  if (!fs.existsSync(mp)) return [];
  var m = JSON.parse(fs.readFileSync(mp, 'utf8')), list = m[feature] && m[feature].js;
  if (!Array.isArray(list)) throw new Error('platforms/' + pid + '/private/' + feature + '/manifest.json: "' + feature + '.js" fehlt');
  return list.map(function (f) {
    var abs = path.join(d, f);
    if (!fs.existsSync(abs)) throw new Error('Datei fehlt: platforms/' + pid + '/private/' + feature + '/' + f);
    return { rel: 'platforms/' + pid + '/private/' + feature + '/' + f, abs: abs };
  });
}
module.exports = { DEFAULT: DEFAULT, id: id, modules: modules, unlisted: unlisted, extModules: extModules };
