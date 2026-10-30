#!/usr/bin/env node
/* Keeps the generated blocks of public/docs/SPEC.md in sync with the code, and checks that every setting, screen,
 * setup.json field and helper route has a hand-written entry in the spec.
 *
 *   node tools/spec_gen.js            # rewrite all <!-- gen:NAME --> … <!-- /gen:NAME --> blocks (npm run spec)
 *   node tools/spec_gen.js --check    # exit 1 if a block is stale or a hand-written entry is missing (npm test, CI)
 *
 * Sources (nothing is copied by hand):
 *   settings      src/views/settings.js (+ views/pinsettings.js) executed in a vm with stubbed sessions,
 *                 defaults from src/core/session.js DEFAULT_SETTINGS + src/core/comfort.js DEFAULTS (as the app applies them),
 *                 English labels/explanations from src/i18n/strings.en.js
 *   routes        N.router.define('<name>', …) in src/**
 *   setup-schema  fields read by N.setupFile.parse (src/core/setupfile.js)
 *   helper        installer/neosetup/helper.py (TV routes + query keys, upstream allow-list, Discover lists)
 *   geometry      library grid views (src/ui/gridmath.js) and requested image sizes (src/ui/images.js)
 *   assets        pictures in src/assets/ with pixel size (each needs a hand-written row: what it is for)
 *   bench         key scripts of the benchmark scenarios (src/dev/bench.js)
 *   tokens        design/tokens.json (tables from tools/design_doc.js), brand/public.json
 *   icons         design/icons/*.svg, column order design/icons/order.json
 *   version      package.json version (= spec version) in SPEC.md, PORTING-WITH-AI.md and TEST-PLAN.md
 *   sources       PORTING-WITH-AI.md: inventory of the maintained sources (spec, test plan, design tokens/icons, screenshots,
 *                 visual-test scenes of tools/visual.js, string tables); paths in <!-- hand:sources --> must exist and be exported
 *   reuse         PORTING-WITH-AI.md: size, namespaces, dependencies, platform APIs and unit tests of every reusable part listed
 *                 in <!-- hand:reuse --> (path must exist and be on the export allowlist)
 *   test-cases    TEST-PLAN.md: acceptance tests per Part A section of SPEC.md from <!-- hand:test-steps --> (one row per
 *   test-results  requirement ID – missing or unknown IDs fail the check) + the results template
 *   ports         ports.json (validated against ports.schema.json) -> PORTS.md table and docs/index.html section;
 *                 ports with an older specVersion are marked automatically
 *   prompt        the starter prompt for an AI agent: written once in <!-- hand:prompt --> of PORTING-WITH-AI.md, copied into
 *                 README.md, README.de.md (gen:prompt) and the website docs/index.html, docs/port.html (gen:prompt-html)
 * Hand-written entries live between <!-- hand:NAME --> … <!-- /hand:NAME --> as table rows starting with "| `id` |".
 * References: requirement IDs (PLAY-3 …), section numbers ("SPEC A9.3", "section C2") and SPEC.md#anchors used in
 * SPEC.md, PORTING-WITH-AI.md, TEST-PLAN.md and PORTS.md must exist in SPEC.md.
 * Paths: public/… in the private repo (export overlay), repository root in the public tree.
 * The module exports {generate, generateAll, check} for tests/spec.test.js. */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var ROOT = path.join(__dirname, '..'), SRC = path.join(ROOT, 'src');
/* Public files live under public/ in the private repo (export overlay) and at the root of the public tree. */
var PUB = fs.existsSync(path.join(ROOT, 'public', 'docs', 'SPEC.md')) ? 'public/' : '';
function pub(rel) { return PUB + rel; }
/* text is compared with LF line ends whatever the checkout uses (Windows core.autocrlf), so the check is the same on every OS */
function lf(t) { return t.replace(/\r\n/g, '\n'); }
function rd(p) { return lf(fs.readFileSync(path.join(ROOT, p), 'utf8')); }
function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' '); }
function code(s) { return '`' + String(s).replace(/\|/g, '\\|') + '`'; }

/* ---------------------------------------------------------------- app in a vm (DOM-free modules, like the unit tests) */
function loadApp() {
  var load = require(path.join(ROOT, 'tests', 'helpers', 'load.js')).load;
  var ctx = load();
  ctx.N.i18n.set('en');
  return ctx;
}

/* ---------------------------------------------------------------- settings */
var SCEN = [
  { id: 'M', name: 'main profile (setup.json)', admin: true, kind: 'main', pkg: true },
  { id: 'A', name: 'other adult profile (setup.json)', admin: false, kind: '', pkg: true },
  { id: 'K', name: 'kids/teen profile (setup.json)', admin: false, kind: 'kid', pkg: true },
  { id: 'D', name: 'development build without setup.json, main profile', admin: true, kind: 'main', pkg: false }
];
function settingsData() {
  var ctx = loadApp(), N = ctx.N;
  var src = rd('src/views/settings.js'), hook = '    s.create = function (root) {';
  if (src.indexOf(hook) < 0) throw new Error('spec_gen: src/views/settings.js changed – hook "s.create = function (root) {" not found; update tools/spec_gen.js');
  src = src.replace(hook, '    s.__defs = defs;\n' + hook);
  var factory = null, realDefine = N.router.define;
  N.router.define = function (name, f) { if (name === 'settings') factory = f; };
  vm.runInContext(src, ctx, { filename: 'views/settings.js' });
  N.router.define = realDefine;
  if (!factory) throw new Error('spec_gen: settings view not defined');
  var real = N.session, captured = null;
  N.ui = N.ui || {};
  N.ui.panel = { select: function (o) { captured = o; }, help: function () {} };
  N.ui.rail = N.ui.rail || {}; N.ui.rail.order = function () { return []; };
  N.appPin = { has: function () { return false; }, count: function () { return 0; } };
  var helperOn = true;
  N.disc = { enabled: function () { return true; }, helper: function () { return helperOn ? 'http://helper' : ''; }, probeHelper: function () {},
    watchlistOn: function () { return true; }, helperState: function () { return 'ok'; } };
  N.insp = N.util.extend({}, N.insp); N.insp.helperOn = function () { return true; };
  N.srv = { has: function () { return true; }, list: function () { return []; } };

  function defaults(kind) {               // the real session code fills the defaults, exactly as on profile activation
    real.profile = { uuid: 'spec', kind: kind, admin: kind === 'main' };
    real.own = {};
    real.applyDefaults();
    var st = N.util.extend({}, real.settings);
    real.profile = null; real.settings = null; real.own = null;
    return st;
  }
  var rows = {}, order = [], cats = [];
  SCEN.forEach(function (sc) {
    var settings = defaults(sc.kind), users = [{ uuid: 'spec', name: 'Main', admin: true, kind: 'main', pin: true }, { uuid: 'k', name: 'Kid', kind: 'kid' }];
    var state = { pointer: undefined, ptrAccel: undefined, ptrEdge: undefined, server: { name: 'My server' }, startProfile: undefined, pinSwitch: null, users: users };
    /* real session logic on the scenario state (defaults such as "profile switch needs PIN" = on, start profile) */
    function viaReal(name) { return function () { var ks = real.state, kp = real.pkg; real.state = state; real.pkg = N.session.pkg; try { return real[name](); } finally { real.state = ks; real.pkg = kp; } }; }
    N.session = { settings: settings, state: state, pkg: sc.pkg ? { createdAt: '2026-01-01T00:00:00Z', profiles: [] } : null,
      profile: { uuid: 'spec', kind: sc.kind, admin: sc.admin }, isKid: function () { return sc.kind === 'kid'; }, isAdmin: function () { return sc.admin; },
      homeCache: function () { return { libs: [], alibs: [] }; }, hubCatalog: function () { return null; }, admin: function () { return users[0]; },
      users: function () { return users; }, startProfile: viaReal('startProfile'),
      pinSwitchAvailable: viaReal('pinSwitchAvailable'), hasRestricted: viaReal('hasRestricted'), pinSwitchOn: viaReal('pinSwitchOn'),
      setSetting: function () {}, save: function () {} };
    var s = factory();
    var list = s.__defs();
    list.forEach(function (cat) {
      if (cats.indexOf(cat.id) < 0) cats.push(cat.id);
      cat.rows.forEach(function (d) {
        var key = d.id, r = rows[key];
        if (!r) {
          r = rows[key] = { id: d.id, cat: cat.id, type: d.type, label: N.t(d.label), desc: N.t(d.desc), help: d.help ? N.t(d.help) : '',
            ddesc: [], store: storeOf(d), values: null, def: {}, scen: [] };
          order.push(key);
        }
        r.scen.push(sc.id);
        if (d.ddesc) {
          var dk = typeof d.ddesc === 'function' ? [] : [d.ddesc];
          if (typeof d.ddesc === 'function') { var m, re = /'(set\.[\w.]+)'/g, t = d.ddesc.toString(); while ((m = re.exec(t))) dk.push(m[1]); }
          dk.forEach(function (k) { var x = N.t(k); if (r.ddesc.indexOf(x) < 0) r.ddesc.push(x); });
        }
        var dv = d.type === 'toggle' ? (d.get() ? 'On' : 'Off') : d.val ? d.val() : '';
        r.def[sc.id] = dv;
        if (d.type === 'list' && !r.values) {
          captured = null; d.open();
          if (captured && captured.entries) r.values = captured.entries.map(function (e) { return { id: e.id, t: e.t, s: e.s || '' }; }), r.multi = !!captured.multi;
        }
      });
    });
  });
  N.session = real;
  return { rows: order.map(function (k) { return rows[k]; }), cats: cats.map(function (c) { return { id: c, label: N.t('set.cat.' + c) }; }) };
}
function storeOf(d) {
  var f = [d.set, d.open, d.run].filter(Boolean).map(function (x) { return x.toString(); }).join('\n');
  var m = /setSetting\('(\w+)'/.exec(f);
  if (m) return 'settings.' + m[1];
  if (/setSetting\(id,/.test(f)) return 'settings.' + d.id;
  m = /S\.state\.(\w+) =/.exec(f);
  if (m) return 'state.' + m[1];
  if (/setLang/.test(f)) return 'state.lang';
  return '';
}
function genSettings() {
  var d = settingsData(), out = [];
  out.push('Availability codes: ' + SCEN.map(function (s) { return '**' + s.id + '** = ' + s.name; }).join(' · ') +
    '. Defaults are shown as they apply with the English UI (audio and subtitle language default to the UI language). `settings.*` is stored per profile (`settings-<profile uuid>.json`), `state.*` once per TV (`state.json`).');
  d.cats.forEach(function (c) {
    out.push('', '##### ' + c.label + ' (`' + c.id + '`)', '', '| Row id | Label | Stored as | Type | Default | Values | Explanation shown in the app | Shown for |', '|---|---|---|---|---|---|---|---|');
    d.rows.forEach(function (r) {
      if (r.cat !== c.id) return;
      var def = r.def[r.scen[0]], other = r.scen.filter(function (k) { return r.def[k] !== def; });
      var defTxt = r.type === 'action' || (r.type === 'value' && r.id !== 'others') ? '–' :
        esc(def) + (other.length ? ' (' + other.map(function (k) { return k + ': ' + esc(r.def[k]); }).join(', ') + ')' : '');
      var vals = r.type === 'toggle' ? 'On / Off' : r.multi ? 'multi-select of this profile’s libraries' : r.values ? r.values.map(function (v) { return esc(v.t) + (v.s ? ' (' + esc(v.s) + ')' : ''); }).join(' · ') :
        r.type === 'action' ? '(opens a screen/dialog)' : r.type === 'value' ? '(read-only)' : '';
      var expl = esc(r.desc) + (r.ddesc.length ? ' *Dimmed:* ' + r.ddesc.map(esc).join(' / ') : '');
      out.push('| ' + code(r.id) + ' | ' + esc(r.label) + ' | ' + (r.store ? code(r.store) : '–') + ' | ' + r.type + ' | ' + defTxt + ' | ' + vals + ' | ' + expl + ' | ' + r.scen.join(' ') + ' |');
    });
  });
  return { text: out.join('\n'), ids: d.rows.map(function (r) { return r.id; }), rows: d.rows };
}

/* ---------------------------------------------------------------- routes */
/* optional extensions (src/private, not in the public tree) are documented in their own addendum */
function walk(dir, out) {
  fs.readdirSync(dir).forEach(function (f) { var p = path.join(dir, f); if (fs.statSync(p).isDirectory()) { if (f !== 'private') walk(p, out); } else if (/\.js$/.test(f)) out.push(p); });
  return out;
}
function routesData() {
  var list = [];
  walk(SRC, []).sort().forEach(function (p) {
    var m, re = /N\.router\.define\('([\w-]+)'/g, t = fs.readFileSync(p, 'utf8');
    while ((m = re.exec(t))) list.push({ name: m[1], file: path.relative(ROOT, p).replace(/\\/g, '/') });
  });
  return list;
}
function genRoutes() {
  var l = routesData();
  return { text: ['| Route | Defined in |', '|---|---|'].concat(l.map(function (r) { return '| ' + code(r.name) + ' | ' + code(r.file) + ' |'; })).join('\n'), ids: l.map(function (r) { return r.name; }) };
}

/* ---------------------------------------------------------------- setup.json fields (what the app reads) */
function setupData() {
  var acorn = require('acorn'), walkA = require('acorn-walk');
  var t = rd('src/core/setupfile.js'), ast = acorn.parse(t, { ecmaVersion: 5 });
  var VARS = { d: '', s: 'server', p: 'profiles[]', v: 'profiles[].servers[]', c: 'computer', hp: 'helper' };
  var fields = [];
  var fns = [];                           // only the validating functions (users() reads the normalized profile, not the file)
  walkA.simple(ast, { FunctionDeclaration: function (n) { if (n.id && (n.id.name === 'parse' || n.id.name === 'servers')) fns.push(n); } });
  if (fns.length !== 2) throw new Error('spec_gen: parse()/servers() not found in src/core/setupfile.js');
  fns.forEach(function (fn) { walkA.simple(fn, { MemberExpression: function (n) {
    if (n.computed || n.object.type !== 'Identifier' || !Object.prototype.hasOwnProperty.call(VARS, n.object.name)) return;
    var name = n.property.name;
    if (/^(length|test|push|indexOf|substring|replace)$/.test(name)) return;
    var f = (VARS[n.object.name] ? VARS[n.object.name] + '.' : '') + name;
    if (fields.indexOf(f) < 0) fields.push(f);
  } }); });
  ['server', 'profiles', 'computer', 'helper'].forEach(function (o) { fields = fields.filter(function (f) { return f !== o; }); });
  return fields.sort();
}
function genSetup() {
  var f = setupData(), kind = /d\.kind !== '([\w-]+)'/.exec(rd('src/core/setupfile.js'));
  return { text: ['Fields read by the app (`N.setupFile.parse`); constant `kind` = ' + code(kind ? kind[1] : '?') + ', `schema` = `1`.', '',
    '| Field |', '|---|'].concat(f.map(function (x) { return '| ' + code(x) + ' |'; })).join('\n'), ids: f };
}

/* ---------------------------------------------------------------- helper protocol */
function helperData() {
  var t = rd('installer/neosetup/helper.py');
  var rk = /ROUTE_KEYS = \{([^}]*)\}/.exec(t), routes = [];
  if (!rk) throw new Error('spec_gen: ROUTE_KEYS not found in installer/neosetup/helper.py');
  var m, re = /'([^']+)': \(([^)]*)\)/g;
  while ((m = re.exec(rk[1]))) routes.push({ route: m[1], keys: (m[2].match(/'([^']+)'/g) || []).map(function (x) { return x.replace(/'/g, ''); }) });
  if (/path == '\/neo-helper'/.test(t)) routes.unshift({ route: '/neo-helper', keys: [] });   // hello route (no key, no query)
  var up = /UPSTREAM = \(([\s\S]*?)\n\)/.exec(t), ups = [];
  re = /\('(GET|PUT|DELETE)', (\w+), r'([^']+)'/g;
  var hosts = { DISCOVER: /DISCOVER = '([^']+)'/.exec(t)[1], METADATA: /METADATA = '([^']+)'/.exec(t)[1], PLEX_TV: /PLEX_TV = '([^']+)'/.exec(t)[1] };
  while (up && (m = re.exec(up[1]))) ups.push({ method: m[1], host: hosts[m[2]] || m[2], path: m[3] });
  var dl = /DISCOVER_LISTS = \{([\s\S]*?)\n\}/.exec(t), lists = [];
  re = /'(\w+)': \{'hubs': \(([^)]*)\), 'when': ('?\w+'?)\}/g;
  while (dl && (m = re.exec(dl[1]))) lists.push({ id: m[1], hubs: (m[2].match(/'([^']+)'/g) || []).map(function (x) { return x.replace(/'/g, ''); }), when: m[3].replace(/'/g, '') });
  var port = /HELPER_PORT = (\d+)/.exec(t);
  return { routes: routes, ups: ups, lists: lists, port: port ? port[1] : '?' };
}
var ROUTE_PATH = { item: '/watchlist/<24 hex>', discover: '/discover/<list>' };
function genHelper() {
  var h = helperData(), o = [];
  o.push('Default port ' + code(h.port) + '. Hello route `GET /neo-helper` needs no key. All other routes need `X-Neo-Key` + `X-Neo-Profile` headers.', '',
    '| TV route | Allowed query keys |', '|---|---|');
  h.routes.forEach(function (r) { o.push('| ' + code(ROUTE_PATH[r.route] || r.route) + ' | ' + (r.keys.length ? r.keys.map(code).join(', ') : '–') + ' |'); });
  o.push('', 'Discover lists (`/discover/<list>`): ' + h.lists.map(function (l) { return code(l.id) + ' (hubs ' + l.hubs.map(code).join(' + ') + (l.when !== 'None' ? ', ' + l.when : '') + ')'; }).join(' · '), '',
    'Upstream allow-list (the only HTTPS requests the helper may make):', '', '| Method | Host | Path (regex) |', '|---|---|---|');
  h.ups.forEach(function (u) { o.push('| ' + u.method + ' | ' + code(u.host) + ' | ' + code(u.path) + ' |'); });
  return { text: o.join('\n'), ids: h.routes.map(function (r) { return ROUTE_PATH[r.route] || r.route; }) };
}

/* ---------------------------------------------------------------- design tokens */
/* Source: design/tokens.json (single source, tables via tools/design_doc.js) + brand/public.json (public brand default) */
function genTokens() {
  var D = require('./design_doc.js'), T = require('./tokens.js'), pub = JSON.parse(rd('brand/public.json'));
  var o = ['Source: `design/tokens.json` in the repository – the single source of all design values (also readable by a port). ' +
    'Every token has a description; `design/README.md` shows the same tables.', ''];
  o.push(D.tokensMarkdown({ level: 0, bare: true }).replace(/\n+$/, ''));
  var own = T.palette().filter(function (p) { return p.id === pub.accentId; })[0];
  o.push('', 'Brand profile (public): name ' + code(pub.name) + ', wordmark ' + code(pub.wordmark.join('')) + ' (second part in accent colour), default accent ' +
    code(pub.accentId) + ' ' + code(pub.accent.toUpperCase()) + (own && own.color.toUpperCase() !== pub.accent.toUpperCase() ? ' (overrides the palette value)' : '') +
    ', accent pressed ' + code(pub.accentPress.toUpperCase()) + ', pointer image ' + code(pub.pointer + '.png') + ', icon set ' + pub.icons.map(code).join(', ') + '.');
  return { text: o.join('\n'), ids: [] };
}
/* (plain paths, no links: the same text must be valid in the private tree and the exported public tree)
 * Source: design/icons/*.svg in the column order of design/icons/order.json */
function genIcons() {
  var D = require('./design_doc.js'), T = require('./tokens.js'), names = T.order();
  return { text: 'Sprite `src/assets/icons.png`: 32×32 px per icon, column = icon (order below), rows = colour state text-3 / text-2 / text-1 / on-accent (y 0/−32/−64/−96). ' +
    'Vector sources: `design/icons/<name>.svg` (28 × 28 view box, colour `currentColor`).\n\n' +
    D.iconsMarkdown({ previews: false, bare: true }).replace(/\n+$/, ''), ids: names };
}

/* ---------------------------------------------------------------- screen geometry (library grids, image sizes) */
/* Source: N.GridMath (src/ui/gridmath.js) and N.img.TIERS (src/ui/images.js), read from the running modules */
function genGeometry() {
  var N = loadApp().N, G = N.GridMath, o = [];
  var name = { L: 'Large', M: 'Medium', S: 'Small', list: 'List' };
  o.push('Library grid views (setting `libView`; music and audiobooks use square covers in the same columns). All values in px on the ' +
    '1280 × 720 canvas; the grid starts at x ' + G.X0 + ', y ' + G.Y0 + ' (focus anchor), card *n* sits at x = ' + G.X0 + ' + column × step x, ' +
    'y = ' + G.Y0 + ' + row × step y. Window = cards kept in the page (1 row above, the focus row and the rows below it); pages of ' + G.PAGE + ' items are loaded.', '',
    '| View | Covers | Columns | Card w × h | Step x / y | Caption at (x, y) | Image size requested | Window (cards) |', '|---|---|---|---|---|---|---|---|');
  G.VIEWS.forEach(function (v) {
    [false, true].forEach(function (sq) {
      var g = G.make(v, sq), t = N.img.TIERS[g.TIER];
      o.push('| ' + name[v] + ' | ' + (sq ? 'square' : 'poster') + ' | ' + g.COLS + ' | ' + g.W + ' × ' + g.H + ' | ' + (g.COLS > 1 ? g.SX : '–') + ' / ' + g.SY +
        ' | ' + g.CAP_X + ', ' + g.CAP_Y + ' | ' + code(g.TIER) + (t ? ' ' + t[0] + ' × ' + t[1] : '') + ' | ' + g.POOL + ' |');
    });
  });
  var T = N.img.TIERS;
  o.push('', 'Image sizes requested from the server per use (`N.img.TIERS`, width × height, scaled by the server): ' +
    Object.keys(T).map(function (k) { return code(k) + ' ' + T[k][0] + ' × ' + T[k][1]; }).join(' · ') + '.');
  return { text: o.join('\n'), ids: [] };
}

/* ---------------------------------------------------------------- image assets (src/assets/*.png) */
/* every picture the app ships, with its pixel size (PNG header); pointer images (one per accent colour and brand) are one
 * entry. Each needs a hand-written row in <!-- hand:assets --> that says what it is for. */
function assetsData() {
  var list = [], seen = {};
  listDir('src/assets', /\.png$/).forEach(function (f) {
    var id = /^pointer/.test(f) ? 'pointer-<colour>[-press].png' : f, b = fs.readFileSync(path.join(ROOT, 'src', 'assets', f));
    if (seen[id]) { seen[id].n++; return; }
    var w = b.length > 24 && b.toString('ascii', 12, 16) === 'IHDR' ? b.readUInt32BE(16) : 0, h = w ? b.readUInt32BE(20) : 0;
    list.push(seen[id] = { id: id, w: w, h: h, n: 1 });
  });
  return list;
}
function genAssets() {
  var l = assetsData();
  return { text: ['Pictures in `src/assets/` (the files themselves are the reference; MIT like the code):', '', '| File | Size (px) |', '|---|---|']
    .concat(l.map(function (a) { return '| ' + code(a.id) + ' | ' + a.w + ' × ' + a.h + ' |'; })).join('\n'),
    ids: l.map(function (a) { return a.id; }) };
}

/* ---------------------------------------------------------------- benchmark scenarios (src/dev/bench.js) */
/* key script and rhythm of every measured scenario, so a port can run the same sequences */
function benchData() {
  var t = rd('src/dev/bench.js'), out = [], m, re = /measure\(([^,]+), BM\.keys\('([^']+)'\), (\w+)/g;
  var gap = /\bGAP = (\d+)/.exec(t), keys = /KEYS = \{([^}]*)\}/.exec(rd('src/dev/benchmath.js'));
  if (!gap || !keys) throw new Error('spec_gen: GAP in src/dev/bench.js or KEYS in src/dev/benchmath.js not found – update benchData()');
  while ((m = re.exec(t))) {
    var name = m[1].replace(/^label \|\| /, '').replace(/'([^']*)' \+ (\w+)/g, '$1<$2>').replace(/'/g, '');
    if (name === 'label') {                                // named by the scenario that calls it: nearest S['…'] above
      var def = t.slice(0, m.index).match(/S\[('[^\]]+'(?: \+ \w+)?)\] = function|S\.([\w]+) = function/g);
      var last = def && def[def.length - 1];
      name = last ? last.replace(/^S\[|\] = function$|^S\.| = function$/g, '').replace(/'([^']*)' \+ (\w+)/g, '$1<$2>').replace(/'/g, '') : '?';
    }
    out.push({ name: name, keys: m[2], gap: m[3] === 'GAP' ? +gap[1] : +m[3] });
  }
  return { list: out, keys: keys[1].replace(/'/g, '').replace(/\s+/g, ' ').trim() };
}
function genBench() {
  var d = benchData(), o = ['Key scripts of the measured scenarios (from `src/dev/bench.js`). Letters: ' + code(d.keys) + '; a number repeats the key ' +
    '(`R12` = 12 × RIGHT). One key every *gap* ms; the screen is opened and left to settle (1.5–3 s) before the first key. ' +
    '`<…>` stands for the variants of one scenario (library view, details type, background mode – see the run list above).', '',
    '| Scenario | Keys | Gap (ms) |', '|---|---|---|'];
  d.list.forEach(function (s) { o.push('| ' + code(s.name) + ' | ' + code(s.keys) + ' | ' + s.gap + ' |'); });
  return { text: o.join('\n'), ids: [] };
}

/* ---------------------------------------------------------------- blocks + checks */
var GEN = { settings: genSettings, routes: genRoutes, 'setup-schema': genSetup, helper: genHelper, geometry: genGeometry, assets: genAssets, bench: genBench, tokens: genTokens, icons: genIcons };
/* gen block -> hand block whose table must have one row per id */
var HAND = { settings: 'settings', routes: 'routes', 'setup-schema': 'setup-schema', helper: 'helper', assets: 'assets' };
var WHAT = { settings: 'Setting row', routes: 'Screen/route', 'setup-schema': 'setup.json field', helper: 'Helper route', assets: 'Image asset' };
var WHERE = { settings: 'src/views/settings.js', routes: 'N.router.define in src/', 'setup-schema': 'src/core/setupfile.js', helper: 'installer/neosetup/helper.py', assets: 'src/assets/' };

function blockRe(kind, name) { return new RegExp('(<!-- ' + kind + ':' + name + ' -->\\n)([\\s\\S]*?)(\\n?<!-- /' + kind + ':' + name + ' -->)'); }
function handIds(text, name) {
  var b = blockRe('hand', name).exec(text);
  if (!b) return null;
  var ids = [], m, re = /^\| `([^`]+)` \|/gm;
  while ((m = re.exec(b[2]))) ids.push(m[1]);
  return ids;
}
function fill(file, out, name, g, problems) {
  var re = blockRe('gen', name);
  if (!re.test(out)) { problems.push(file + ': block <!-- gen:' + name + ' --> … <!-- /gen:' + name + ' --> is missing. Add the two marker lines, then run `npm run spec`.'); return out; }
  return out.replace(re, function (all, a, b, c) { return a + '<!-- generated by tools/spec_gen.js – do not edit; run `npm run spec` -->\n' + g.text + '\n' + c.replace(/^\n/, ''); });
}

/* ---------------------------------------------------------------- version (app version = spec version) */
function appVersion() { return JSON.parse(rd('package.json')).version; }
function genVersion() {
  var v = appVersion();
  return { text: 'Current app version **' + v + '** · spec version **' + v + '** (the spec is versioned together with the app; `specVersion` of a port refers to this number).', ids: [] };
}

/* ---------------------------------------------------------------- references into SPEC.md (IDs, section numbers, anchors) */
function slug(t) { return t.trim().toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\w\- ]+/g, '').replace(/ /g, '-'); }
function specIndex(text) {
  var ids = {}, prefixes = {}, anchors = {}, sections = {}, heads = [], m;
  var re = /^#{1,6} (.+)$/gm;
  while ((m = re.exec(text))) {
    anchors[slug(m[1])] = 1;
    var n = /^([A-C]\d{1,2}(?:\.\d+)*) /.exec(m[1]);
    if (n) sections[n[1]] = 1;
    heads.push({ at: m.index, sec: n ? n[1] : '-' });
  }
  re = /\*\*([A-Z][A-Z0-9]*-\d+)\b|^\| ([A-Z][A-Z0-9]*-\d+) \|/gm;
  while ((m = re.exec(text))) {                          // ids[ID] = the (sub)section it is defined in
    var id = m[1] || m[2], sec = '-';
    heads.forEach(function (h) { if (h.at < m.index) sec = h.sec; });
    if (!ids[id]) ids[id] = sec;
    prefixes[id.replace(/-\d+$/, '')] = 1;
  }
  return { ids: ids, prefixes: prefixes, anchors: anchors, sections: sections };
}
/* own = SPEC.md itself (links '#…'); other documents link 'SPEC.md#…' and may name sections ("SPEC A9.3", "section C2.4") */
function checkRefs(file, text, idx, own) {
  var problems = [], m, seen = {};
  // only real blocks (markers on their own line): a mention of `<!-- gen:… -->` in the prose must not hide the text after it
  var body = text.replace(/^<!-- gen:([\w-]+) -->\n[\s\S]*?\n<!-- \/gen:\1 -->$/gm, '');
  var re = /\b([A-Z][A-Z0-9]*)-(\d+)\b/g;
  while ((m = re.exec(body))) {
    var id = m[1] + '-' + m[2];
    if (!idx.prefixes[m[1]] || idx.ids[id] || seen[id]) continue;
    seen[id] = 1;
    problems.push(file + ': refers to requirement ' + id + ', which does not exist in SPEC.md (renamed or removed?). Update the reference.');
  }
  // "PLAY-1 … PLAY-29" means "all of them": stale when a newer ID of the same (sub)section exists
  re = /\b([A-Z][A-Z0-9]*)-1 (?:…|\.\.\.) \1-(\d+)\b/g;
  while ((m = re.exec(body))) {
    var last = m[1] + '-' + m[2], next = m[1] + '-' + (+m[2] + 1);
    if (!idx.ids[last] || !idx.ids[next] || idx.ids[next] !== idx.ids[last] || seen['r' + last]) continue;
    seen['r' + last] = 1;
    problems.push(file + ': the range ' + m[1] + '-1 … ' + last + ' misses ' + next + ' (same section ' + idx.ids[next] + ' of SPEC.md) – extend the range to the last ID (if only some are meant, list them: ' + m[1] + '-1, ' + m[1] + '-2, …).');
  }
  re = own ? /\]\(#([^)\s]+)\)/g : /SPEC\.md#([^)\s"'>]+)/g;
  while ((m = re.exec(body))) {
    if (idx.anchors[m[1]] || seen['#' + m[1]]) continue;
    seen['#' + m[1]] = 1;
    problems.push(file + ': link to SPEC.md section #' + m[1] + ' – no such heading in SPEC.md. Fix the link.');
  }
  // "SPEC A9", "section C2.4", and every dotted section number on its own ("(A9.3)") – those exist only as headings
  re = /\b(?:SPEC(?:\.md)?|[Ss]ections?|§)\s+([A-C]\d{1,2}(?:\.\d+)*)\b|(?<![\w.\/-])([A-C]\d{1,2}(?:\.\d+)+)(?![\w\/-])/g;
  while ((m = re.exec(body))) {
    var sn = m[1] || m[2];
    if (idx.sections[sn] || seen['s' + sn]) continue;
    seen['s' + sn] = 1;
    problems.push(file + ': refers to SPEC section ' + sn + ', which does not exist in SPEC.md. Update the reference.');
  }
  return problems;
}

/* ---------------------------------------------------------------- community ports (ports.json -> PORTS.md, website) */
function vnum(v) { return String(v).split('.').map(function (x) { return ('0000' + (parseInt(x, 10) || 0)).slice(-4); }).join('.'); }
/* small JSON-schema subset: type, required, properties, patternProperties, additionalProperties:false, items, enum, pattern,
 * minLength, maxLength, minItems – enough for ports.schema.json */
function validate(v, sch, at, errs) {
  var t = Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v;
  if (sch.type && sch.type !== t) { errs.push(at + ': must be ' + sch.type); return; }
  if (sch.enum && sch.enum.indexOf(v) < 0) errs.push(at + ': must be one of ' + sch.enum.join(', '));
  if (sch.pattern && t === 'string' && !new RegExp(sch.pattern).test(v)) errs.push(at + ': "' + v + '" does not match ' + sch.pattern);
  if (sch.minLength && t === 'string' && v.length < sch.minLength) errs.push(at + ': too short');
  if (sch.maxLength && t === 'string' && v.length > sch.maxLength) errs.push(at + ': too long (max ' + sch.maxLength + ')');
  if (t === 'array') {
    if (sch.minItems && v.length < sch.minItems) errs.push(at + ': needs at least ' + sch.minItems + ' item(s)');
    if (sch.items) v.forEach(function (x, i) { validate(x, sch.items, at + '[' + i + ']', errs); });
  }
  if (t === 'object') {
    (sch.required || []).forEach(function (k) { if (!(k in v)) errs.push(at + ': missing "' + k + '"'); });
    Object.keys(v).forEach(function (k) {
      var ps = sch.properties && sch.properties[k], hit = false;
      if (ps) { validate(v[k], ps, at + '.' + k, errs); return; }
      Object.keys(sch.patternProperties || {}).forEach(function (pp) {
        if (new RegExp(pp).test(k)) { hit = true; validate(v[k], sch.patternProperties[pp], at + '.' + k, errs); }
      });
      if (!hit && sch.additionalProperties === false) errs.push(at + ': unknown key "' + k + '"');
    });
  }
}
var FEATURE_MARK = { done: '✅', partial: '🟡', planned: '⬜', 'n/a': '–' };
function portsData(specText) {
  var file = pub('ports.json'), errs = [], data;
  try { data = JSON.parse(rd(file)); } catch (e) { return { errs: [file + ': not valid JSON – ' + e.message], ports: [], cur: appVersion(), areas: [] }; }
  validate(data, JSON.parse(rd(pub('ports.schema.json'))), file, errs);
  var idx = specIndex(specText), cur = appVersion(), names = {};
  var areas = Object.keys(idx.sections).filter(function (k) { return /^A\d+$/.test(k); });
  (data.ports || []).forEach(function (p, i) {
    var at = file + ' ports[' + i + '] (' + (p.name || '?') + ')';
    if (names[p.name]) errs.push(at + ': duplicate name');
    names[p.name] = 1;
    if (!p.reference && !p.specVersion) errs.push(at + ': "specVersion" is required (the app version whose SPEC.md the port was built against)');
    if (p.specVersion && vnum(p.specVersion) > vnum(cur)) errs.push(at + ': specVersion ' + p.specVersion + ' is newer than the current spec ' + cur);
    Object.keys(p.features || {}).forEach(function (k) {
      if (areas.indexOf(k) < 0) errs.push(at + ': feature area "' + k + '" is not a Part A section of SPEC.md (use ' + areas.join(', ') + ')');
    });
    if (/plex/i.test(p.name || '')) errs.push(at + ': the port name must not contain "Plex" (trademark – see the policy in PORTS.md)');
  });
  var ports = (data.ports || []).map(function (p) {
    var sv = p.reference ? cur : p.specVersion || '?', f = p.features || {}, done = 0;
    areas.forEach(function (a) { if (f[a] === 'done' || f[a] === 'n/a') done++; });
    return { p: p, sv: sv, old: vnum(sv) < vnum(cur), done: done, total: areas.length };
  });
  return { errs: errs, ports: ports, cur: cur, areas: areas };
}
/* optional marks after the port name: media servers other than Plex only, and "in the collection" (reviewed, see PORTS.md) */
var SERVER_NAME = { plex: 'Plex', jellyfin: 'Jellyfin', emby: 'Emby' };
function portTags(p, html) {
  var t = [], sv = p.mediaServers || [];
  if (sv.length && !(sv.length === 1 && sv[0] === 'plex')) t.push('for ' + sv.map(function (x) { return SERVER_NAME[x] || x; }).join(', '));
  if (p.collection) t.push('in the collection (' + p.collection + ')');
  if (!t.length) return '';
  return html ? ' <small>' + ht(t.join(' · ')) + '</small>' : '<br>*' + esc(t.join(' · ')) + '*';
}
function genPorts(specText) {
  var d = portsData(specText), o = [];
  if (!d.ports.length) return { text: '*No ports listed yet.*', ids: [], errs: d.errs };
  o.push('Current spec version: **' + d.cur + '**.', '', '| Port | TV / models | OS | Built against spec | Feature areas done | Maintainer | Licence | Last verified |',
    '|---|---|---|---|---|---|---|---|');
  d.ports.forEach(function (x) {
    var p = x.p, sv = x.old ? '⚠️ ' + esc(x.sv) + ' – built against an older spec, may miss newer features' : esc(x.sv) + (p.reference ? ' (reference)' : '');
    o.push('| [' + esc(p.name) + '](' + p.url + ')' + portTags(p) + ' | ' + esc(p.brand + ' – ' + p.models) + ' | ' + esc(p.os) + ' | ' + sv + ' | ' + x.done + ' / ' + x.total +
      ' | [@' + p.maintainer + '](https://github.com/' + p.maintainer + ') | ' + esc(p.licence) + ' | ' + esc(p.lastVerified) + ' |');
  });
  o.push('', '<details><summary>Feature checklist per port (Part A sections of SPEC.md)</summary>', '', '| Port | ' + d.areas.join(' | ') + ' |',
    '|---|' + d.areas.map(function () { return '---'; }).join('|') + '|');
  d.ports.forEach(function (x) { o.push('| ' + esc(x.p.name) + ' | ' + d.areas.map(function (a) { return FEATURE_MARK[(x.p.features || {})[a]] || '?'; }).join(' | ') + ' |'); });
  o.push('', 'Legend: ✅ done · 🟡 partial · ⬜ planned · – not applicable on that TV · ? not stated.', '', '</details>');
  return { text: o.join('\n'), ids: [], errs: d.errs };
}
function ht(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function genPortsHtml(specText) {
  var d = portsData(specText);
  var o = ['    <div class="table-wrap"><table>', '      <thead><tr><th>Port</th><th>TV</th><th>OS</th><th>Spec version</th><th>Maintainer</th></tr></thead>', '      <tbody>'];
  d.ports.forEach(function (x) {
    var p = x.p;
    o.push('        <tr><td><a href="' + ht(p.url) + '">' + ht(p.name) + '</a>' + portTags(p, true) + '</td><td>' + ht(p.brand + ' – ' + p.models) + '</td><td>' + ht(p.os) + '</td><td>' +
      ht(x.sv) + (x.old ? ' (older spec)' : '') + '</td><td><a href="https://github.com/' + ht(p.maintainer) + '">@' + ht(p.maintainer) + '</a></td></tr>');
  });
  o.push('      </tbody>', '    </table></div>');
  return { text: o.join('\n'), ids: [] };
}

/* ---------------------------------------------------------------- starter prompt (one source, several copies) */
/* The prompt a person pastes into their AI coding agent. Its only hand-written copy is the ```text block in
 * <!-- hand:prompt --> of PORTING-WITH-AI.md (the file the agent reads); the READMEs and the website get generated copies,
 * so the wording and the raw URL can never drift apart. */
function promptData(read) {
  var rel = pub('docs/PORTING-WITH-AI.md'), b = blockRe('hand', 'prompt').exec(tryRead(read, rel));
  var m = b && /^```text\n([\s\S]*?)\n```$/m.exec(b[2]);
  if (!m) return { errs: [rel + ': the starter prompt block <!-- hand:prompt --> with one ```text … ``` block inside is missing. Add it (it is copied into the READMEs and the website).'], text: '' };
  var url = rawBase() + 'docs/PORTING-WITH-AI.md', errs = [];
  if (m[1].indexOf(url) < 0) errs.push(rel + ': the starter prompt must contain the raw link ' + url + ' (the agent reads the playbook from there).');
  return { errs: errs, text: m[1] };
}
function genPrompt(read) {
  var d = promptData(read);
  return { text: '```text\n' + d.text + '\n```', ids: [], errs: d.errs };
}
function genPromptHtml(read) {
  var d = promptData(read);
  // one line on the website: the box wraps it to its width (a hard break mid-sentence looks broken there)
  return { text: '<pre class="prompt" id="prompt"><code>' + ht(d.text.replace(/\s*\n\s*/g, ' ')) + '</code></pre>', ids: [], errs: [] };
}

/* ---------------------------------------------------------------- porting sources + reusable parts (PORTING-WITH-AI.md) */
/* Paths in these docs are written as in the PUBLIC tree (docs/…, src/…); in the private repo docs/ and the other overlay
 * files live under public/. resolvePub() finds the file in either layout. */
function resolvePub(p) {
  var clean = p.replace(/\/$/, '');
  if (PUB && fs.existsSync(path.join(ROOT, PUB, clean))) return PUB + clean;
  if (fs.existsSync(path.join(ROOT, clean))) return clean;
  return null;
}
/* the export allowlist of tools/export_public.sh (+ the public/ overlay and tests/*.test.js): a path a port is told to
 * read must be part of the public tree, otherwise the link is dead there */
function exported(p, rel) {
  if (!PUB) return true;                                             // this IS the public tree: what exists is exported
  if (rel.indexOf(PUB) === 0) return true;                           // overlay file (public/…)
  var m = /\nALLOW="\n([\s\S]*?)\n"/.exec(rd('tools/export_public.sh'));
  if (!m) return true;                                               // unknown layout – don't guess
  var allow = m[1].split('\n').map(function (x) { return x.trim(); }).filter(Boolean), clean = p.replace(/\/$/, '');
  if (/^tests\/[^/]+\.test\.js$/.test(clean) && !/fixtures-local/.test(clean)) return true;
  return allow.some(function (a) { return clean === a || clean.indexOf(a + '/') === 0; });
}
function repoOf() { return JSON.parse(rd('brand/public.json')).repo; }
function rawBase() { return 'https://raw.githubusercontent.com/' + repoOf() + '/main/'; }
function treeBase() { return 'https://github.com/' + repoOf() + '/tree/main/'; }
/* rows of a hand table: | `id` | cell | cell | … (cells may contain \| ) */
function handRows(text, name) {
  var b = blockRe('hand', name).exec(text), rows = [];
  if (!b) return null;
  b[2].split('\n').forEach(function (l) {
    if (!/^\| `[^`]+` \|/.test(l)) return;
    var cells = l.replace(/^\|/, '').replace(/\|\s*$/, '').replace(/\\\|/g, '\u0001').split('|').map(function (c) { return c.trim().replace(/\u0001/g, '|'); });
    rows.push({ id: cells[0].replace(/^`|`$/g, ''), cells: cells.slice(1) });
  });
  return rows;
}
/* Nur Dateien zaehlen, die ins Repository gehoeren (git ls-files: versioniert + neu, aber nicht ignoriert): lokale
 * Bauprodukte wie installer/neosetup/payload/ duerfen die generierten Groessen nicht je nach Rechner veraendern; eine neue,
 * noch nicht mit `git add` aufgenommene Datei zaehlt schon mit (sonst waere der Block lokal aktuell und in CI veraltet).
 * Ohne git (z. B. entpackter Export) Dateisystem ohne payload/. */
var tracked = (function () {
  try {
    var out = require('child_process').execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    var set = {}; out.split('\0').forEach(function (f) { if (f) set[f] = true; });
    return Object.keys(set).length ? set : null;
  } catch (e) { return null; }
})();
function listFiles(rel) {                               // all files below rel (or [rel] for a file), sorted
  var abs = path.join(ROOT, rel);
  if (!fs.statSync(abs).isDirectory()) return [rel];
  var out = [];
  fs.readdirSync(abs).sort().forEach(function (f) {
    if (f === '__pycache__' || f.charAt(0) === '.') return;
    if (f === 'private') return;                          // optional extensions of an edition: never in the public tree
    var r = rel + '/' + f;
    if (fs.statSync(path.join(ROOT, r)).isDirectory()) {
      if (!tracked && f === 'payload') return;            // Bauprodukt des Einrichtungsprogramms
      out = out.concat(listFiles(r));
    } else if (!tracked || tracked[r]) out.push(r);
  });
  return out;
}
/* file names in one directory (sorted, only files that belong to the repository – see tracked) */
function listDir(rel, re) {
  if (!fs.existsSync(path.join(ROOT, rel))) return [];
  return fs.readdirSync(path.join(ROOT, rel)).filter(function (f) { return re.test(f) && (!tracked || tracked[rel + '/' + f]); }).sort();
}
function kb(n) { return n < 1024 ? '< 1 KB' : Math.round(n / 1024) + ' KB'; }
/* platform-specific things a JS module touches (to replace or stub when porting) */
var PLATFORM_API = [
  [/\b(curWidget|widgetAPI|pluginAPI|webapis|sf\.(?:core|key|service)|FileSystem)\b/, 'Orsay widget/plugin APIs'],
  [/\bN\.sef\b/, 'Samsung SEF player (`N.sef`)'],
  [/\bwindow\.(?!setTimeout|clearTimeout)/, '`window` (loader hooks)'],
  [/\bdocument\./, 'DOM'],
  [/\bXMLHttpRequest\b/, '`XMLHttpRequest`'],
  [/\blocalStorage\b/, '`localStorage`'],
  [/\bnew Image\b/, '`Image()`'],
  [/\brequestAnimationFrame\b/, '`requestAnimationFrame`']
];
function moduleFacts(rel) {
  var files = listFiles(rel), size = 0, own = {}, uses = {}, plat = {}, py = {}, ns = [];
  files.forEach(function (f) {
    var t = rd(f), m, re;
    size += Buffer.byteLength(t);
    if (/\.js$/.test(f)) {
      re = /\bN\.([A-Za-z][A-Za-z0-9]*) = /g; while ((m = re.exec(t))) own[m[1]] = 1;
      re = /\bN\.([A-Za-z][A-Za-z0-9]*)\b/g; while ((m = re.exec(t))) uses[m[1]] = 1;
      PLATFORM_API.forEach(function (p) { if (p[0].test(t)) plat[p[1]] = 1; });
    } else if (/\.py$/.test(f)) {
      re = /^\s*(?:import|from) ([A-Za-z_]\w*)/gm; while ((m = re.exec(t))) py[m[1]] = 1;
    }
  });
  Object.keys(own).forEach(function (k) { delete uses[k]; ns.push('N.' + k); });
  delete uses.strings;                                   // string tables are data, listed as their own entry
  var local = { neosetup: 1, __future__: 1 };            // Python: modules of the same package are not dependencies
  files.forEach(function (f) { local[path.basename(f).replace(/\.py$/, '')] = 1; });
  var pyDeps = Object.keys(py).filter(function (k) { return !local[k]; }).sort();
  /* unit tests to port with it. JS: tests/<name>.test.js of the same name, plus the tests that use one of its namespaces
   * most often (≥ 3 uses, at most 4 files – every test loads all modules, so a single mention means little).
   * Python: tests/installer/test_<module>.py; for a whole package every installer test. */
  var tests = [], jsBase = {}, scored = [];
  files.forEach(function (f) { if (/\.js$/.test(f)) jsBase[path.basename(f, '.js')] = 1; });
  ns.forEach(function (n) { jsBase[n.slice(2).toLowerCase()] = 1; });
  if (ns.length) listDir('tests', /\.test\.js$/).forEach(function (f) {
    if (/fixtures-local|spec\.test/.test(f)) return;
    if (jsBase[f.replace(/\.test\.js$/, '')]) { tests.push('tests/' + f); return; }
    var t = rd('tests/' + f), n = 0;
    ns.forEach(function (x) { n += (t.match(new RegExp('\\bN\\.' + x.slice(2) + '\\b', 'g')) || []).length; });
    if (n) scored.push({ f: 'tests/' + f, n: n });
  });
  scored.sort(function (a, b) { return b.n - a.n || (a.f < b.f ? -1 : 1); });
  var strong = scored.filter(function (s) { return s.n >= 3; });
  (strong.length || tests.length ? strong : scored).slice(0, 4).forEach(function (s) { tests.push(s.f); });
  if (/^tools\/.*\.js$/.test(rel)) listDir('tests', /\.test\.js$/).forEach(function (f) {
    if (!/fixtures-local/.test(f) && rd('tests/' + f).indexOf(path.basename(rel, '.js')) >= 0) tests.push('tests/' + f);
  });
  var pyFiles = files.filter(function (f) { return /\.py$/.test(f); });
  if (pyFiles.length) listDir('tests/installer', /^test_.*\.py$/).forEach(function (f) {
    if (pyFiles.length > 1 || pyFiles.some(function (x) { return f === 'test_' + path.basename(x); })) tests.push('tests/installer/' + f);
  });
  return { files: files, size: size, ns: ns.sort(), uses: Object.keys(uses).sort().map(function (k) { return 'N.' + k; }), plat: Object.keys(plat), py: pyDeps, tests: tests };
}
function genReuse(text) {
  var rows = handRows(text, 'reuse') || [], probs = [], o = [], file = pub('docs/PORTING-WITH-AI.md');
  var lic = rd(pub('LICENSE')).split('\n')[0].trim();
  o.push('Facts per row of the table above, read from the code of version **' + appVersion() + '**. Licence of every file: **' + lic +
    '** ([LICENSE](../LICENSE)) – keep the copyright and licence notice when you copy code. The reference contains no third-party code ([THIRD-PARTY.md](../THIRD-PARTY.md)).', '',
    '| Path | Size | Defines | Uses (other reference modules: port them too or replace them) | Platform-specific parts | Unit tests to port with it |', '|---|---|---|---|---|---|');
  rows.forEach(function (r) {
    var rel = resolvePub(r.id);
    if (!rel) { probs.push(file + ': reusable part `' + r.id + '` (<!-- hand:reuse -->) does not exist. Fix the path or remove the row.'); return; }
    if (!exported(r.id, rel)) { probs.push(file + ': reusable part `' + r.id + '` is not on the export allowlist (tools/export_public.sh), so it is missing in the public repository. Add it to ALLOW or remove the row.'); return; }
    if (r.cells.length < 3 || r.cells.slice(0, 3).some(function (c) { return !c; })) probs.push(file + ': row `' + r.id + '` in <!-- hand:reuse --> needs 4 filled columns (path, purpose, what to replace, notes).');
    var f = moduleFacts(rel), many = f.files.length > 1;
    var deps = f.py.length ? 'Python standard library only: ' + f.py.map(code).join(', ') : f.uses.length ? f.uses.map(code).join(', ') : 'none';
    o.push('| ' + code(r.id) + ' | ' + kb(f.size) + (many ? ' in ' + f.files.length + ' files' : '') + ' | ' + (f.ns.length ? f.ns.map(code).join(', ') : '–') + ' | ' + deps +
      ' | ' + (f.plat.length ? f.plat.join(', ') : 'none') + ' | ' + (f.tests.length ? f.tests.map(code).join(', ') : '–') + ' |');
  });
  return { text: o.join('\n'), ids: [], errs: probs };
}
function loadStrings(lang) {
  var ctx = { N: { strings: {} } }; vm.createContext(ctx);
  ['strings.de.js', 'strings.en.js', 'strings.music.js'].forEach(function (f) { vm.runInContext(rd('src/i18n/' + f), ctx); });
  return ctx.N.strings[lang] || {};
}
/* inventory of the maintained sources a port reads (counts and links generated, so the playbook never points at stale things) */
function genSources(text) {
  var rows = handRows(text, 'sources') || [], probs = [], file = pub('docs/PORTING-WITH-AI.md'), raw = rawBase(), tree = treeBase(), o = [];
  rows.forEach(function (r) {
    var rel = resolvePub(r.id);
    if (!rel) probs.push(file + ': source `' + r.id + '` (<!-- hand:sources -->) does not exist. Fix the path or remove the row.');
    else if (!exported(r.id, rel)) probs.push(file + ': source `' + r.id + '` is not on the export allowlist (tools/export_public.sh). Add it or remove the row.');
  });
  var spec = rd(pub('docs/SPEC.md')), idx = specIndex(spec);
  o.push('Generated from the files themselves (version **' + appVersion() + '**). The raw links work for agents without a clone.', '',
    '| Source | Link | What it holds right now |', '|---|---|---|');
  o.push('| Product spec | ' + raw + 'docs/SPEC.md | ' + Object.keys(idx.ids).length + ' requirement IDs (' + specReqs(spec).length + ' in Part A), ' +
    (spec.match(/\*Accept:\*/g) || []).length + ' explicit *Accept:* criteria |');
  var tp = resolvePub('docs/TEST-PLAN.md');
  if (tp) {
    var tr = handRows(rd(tp), 'test-steps') || [];
    o.push('| Acceptance test plan | ' + raw + 'docs/TEST-PLAN.md | ' + tr.filter(function (x) { return x.cells[0] === 'human'; }).length + ' tests with the human, ' +
      tr.filter(function (x) { return x.cells[0] === 'agent'; }).length + ' checks by the agent |');
  }
  if (fs.existsSync(path.join(ROOT, 'design', 'tokens.json'))) {
    var n = 0;
    (function count(x) { Object.keys(x).forEach(function (k) { var v = x[k]; if (v && typeof v === 'object' && !Array.isArray(v)) { if ('value' in v) n++; else count(v); } }); })(JSON.parse(rd('design/tokens.json')));
    o.push('| Design tokens | ' + raw + 'design/tokens.json | ' + n + ' tokens, each with a description |');
  }
  if (fs.existsSync(path.join(ROOT, 'design', 'icons'))) {
    var svgs = listDir('design/icons', /\.svg$/);
    o.push('| Icon SVGs | ' + tree + 'design/icons | ' + svgs.length + ' icons: ' + svgs.map(function (s) { return code(s.replace(/\.svg$/, '')); }).join(', ') + ' |');
  }
  if (fs.existsSync(path.join(ROOT, 'design', 'README.md'))) o.push('| Design system overview | ' + raw + 'design/README.md | readable description of every token and icon |');
  var shotDir = pub('docs/screenshots'), shots = listDir(shotDir, /\.png$/);
  var shotsDe = listDir(shotDir + '/de', /\.png$/).length;
  o.push('| Reference screenshots | ' + tree + 'docs/screenshots | ' + shots.length + ' English: ' + shots.map(function (s) { return '[' + s.replace(/\.png$/, '') + '](screenshots/' + s + ')'; }).join(', ') +
    (shotsDe ? ' · ' + shotsDe + ' German ones in `de/`' : '') + ' |');
  var scenes = require(path.join(ROOT, 'tools', 'visual.js')).SCENES.map(function (s) { return s.name; });
  o.push('| Visual-test scenes | ' + raw + 'tools/visual.js | ' + scenes.length + ' screen states (list below) – each one must exist in the port |');
  var en = loadStrings('en'), de = loadStrings('de');
  o.push('| UI texts | ' + raw + 'src/i18n/strings.en.js · ' + raw + 'src/i18n/strings.de.js | ' + Object.keys(en).length + ' English / ' + Object.keys(de).length +
    ' German keys (music texts included); length limit per key prefix in ' + raw + 'tools/i18n_rules.js |');
  var groups = {};
  scenes.forEach(function (s) { var g = s.split('-')[0]; (groups[g] = groups[g] || []).push(s); });
  o.push('', '<details><summary>All ' + scenes.length + ' visual-test scenes (grouped by prefix)</summary>', '');
  Object.keys(groups).sort().forEach(function (g) { o.push('- **' + g + '**: ' + groups[g].map(code).join(', ')); });
  o.push('', '</details>');
  return { text: o.join('\n'), ids: [], errs: probs };
}

/* ---------------------------------------------------------------- acceptance test plan (TEST-PLAN.md) */
/* Every requirement ID of Part A is an acceptance criterion. TEST-PLAN.md holds one hand-written row per ID in
 * <!-- hand:test-steps -->:  | `ID` | human | name | before you start | steps "1) … 2) …" | you should see | tell the agent |
 * or                         | `ID` | agent | name | – | how the agent verifies it | – | – |
 * The generator turns them into the plan (gen:test-cases) and the results template (gen:test-results). */
function specReqs(text, all) {           // all: every requirement of the spec (Parts A–C), not only Part A
  var out = [], sec = null, sub = null, inA = !!all, cur = null;
  function flush() {
    if (!cur) return;
    cur.text = cur.text.replace(/\s+/g, ' ').trim();
    var a = /\*Accept:\*\s*(.*)$/.exec(cur.text);
    cur.accept = a ? a[1] : '';
    out.push(cur); cur = null;
  }
  text.split('\n').forEach(function (l) {
    var m;
    if (/^# Part A/.test(l)) { inA = true; return; }
    if (/^# Part [B-Z]/.test(l)) { flush(); inA = !!all; return; }
    if (!inA) return;
    if ((m = /^## (A\d+) (.+)$/.exec(l))) { flush(); sec = { id: m[1], title: m[2], anchor: slug(l.slice(3)) }; sub = null; return; }
    if ((m = /^### (A\d+\.\d+) (.+)$/.exec(l))) { flush(); sub = { id: m[1], title: m[2], anchor: slug(l.slice(4)) }; return; }
    if ((m = /^- \*\*([A-Z][A-Z0-9]*-\d+)\b(.*)$/.exec(l))) { flush(); cur = { id: m[1], sec: sec, sub: sub, text: m[2] }; return; }
    if ((m = /^\| ([A-Z][A-Z0-9]*-\d+) \| (.*)$/.exec(l))) { flush(); cur = { id: m[1], sec: sec, sub: sub, text: m[2].replace(/\|/g, ' · ') }; flush(); return; }
    if (cur && /^\s{2,}\S/.test(l)) { cur.text += ' ' + l.trim(); return; }
    flush();
  });
  flush();
  return out;
}
function testPlanData(planText, specText) {
  var reqs = specReqs(specText), rows = handRows(planText, 'test-steps'), probs = [], file = pub('docs/TEST-PLAN.md'), by = {};
  if (!rows) return { probs: [file + ': hand-written block <!-- hand:test-steps --> … <!-- /hand:test-steps --> is missing.'], reqs: reqs, by: by };
  rows.forEach(function (r) {
    if (by[r.id]) probs.push(file + ': duplicate test row `' + r.id + '` in <!-- hand:test-steps -->.');
    var c = r.cells, x = by[r.id] = { who: c[0], name: c[1], pre: c[2], steps: c[3], see: c[4], tell: c[5] };
    function filled(v) { return v && v !== '–'; }
    if (x.who !== 'human' && x.who !== 'agent') probs.push(file + ': test row `' + r.id + '`: the second column must be "human" or "agent", not "' + x.who + '".');
    else if (x.who === 'human' && ![x.name, x.pre, x.steps, x.see, x.tell].every(filled))
      probs.push(file + ': test row `' + r.id + '` (human) needs every column: name, before you start, steps "1) … 2) …", you should see, tell the agent.');
    else if (x.who === 'human' && !/^1\)\s/.test(x.steps)) probs.push(file + ': test row `' + r.id + '`: steps must be numbered "1) … 2) …".');
    else if (x.who === 'agent' && !(filled(x.name) && filled(x.steps))) probs.push(file + ': test row `' + r.id + '` (agent) needs a name and, in the steps column, how the agent verifies it.');
  });
  var ids = reqs.map(function (q) { return q.id; });
  reqs.forEach(function (q) {
    if (!by[q.id]) probs.push('Requirement ' + q.id + ' (SPEC ' + (q.sub || q.sec).id + ') has no entry in ' + file + '. Add a row starting with "| `' + q.id + '` |" inside <!-- hand:test-steps --> … <!-- /hand:test-steps -->: ' +
      'human (before you start, numbered steps for a non-technical person with a remote, expected result, what to report) or agent (how the agent verifies it).');
  });
  rows.forEach(function (r) { if (ids.indexOf(r.id) < 0) probs.push(file + ': test row `' + r.id + '` refers to no requirement in Part A of SPEC.md (renamed or removed?). Update or remove it.'); });
  return { probs: probs, reqs: reqs, by: by };
}
function testSteps(s) { return s.split(/(?:^|\s+)\d{1,2}\)\s+/).filter(Boolean); }
function genTestCases(planText, specText) {
  var d = testPlanData(planText, specText), o = [], secs = [], bySec = {}, nh = 0, na = 0;
  d.reqs.forEach(function (q) {
    if (!bySec[q.sec.id]) { bySec[q.sec.id] = []; secs.push(q.sec); }
    bySec[q.sec.id].push(q);
    var x = d.by[q.id]; if (x && x.who === 'human') nh++; else if (x) na++;
  });
  o.push('Spec version **' + appVersion() + '**: ' + d.reqs.length + ' requirements in Part A → **' + nh + ' tests with you** and ' + na +
    ' checks the agent does on its own (folded away at the end of each area).');
  secs.forEach(function (s) {
    var list = bySec[s.id];
    var human = list.filter(function (q) { return d.by[q.id] && d.by[q.id].who === 'human'; }), agent = list.filter(function (q) { return d.by[q.id] && d.by[q.id].who === 'agent'; });
    o.push('', '### ' + s.id + ' ' + s.title, '');
    if (!human.length) o.push('*Nothing to do for you in this area – the agent checks it.*', '');
    human.forEach(function (q) {
      var x = d.by[q.id];
      o.push('#### ' + q.id + ' · ' + x.name, '', '*Spec:* [' + q.id + '](SPEC.md#' + (q.sub || q.sec).anchor + ')' + (q.accept ? ' · *Acceptance criterion:* ' + q.accept : ''), '',
        '**Before you start:** ' + x.pre, '');
      testSteps(x.steps).forEach(function (st, i) { o.push((i + 1) + '. ' + st); });
      o.push('', '**You should see:** ' + x.see, '', '**Tell the agent:** ' + x.tell, '', '- [ ] Pass', '- [ ] Fail – what happened instead:', '');
    });
    if (agent.length) {
      o.push('<details><summary>Checked by the agent (' + agent.length + ')</summary>', '', '| ID | What | How the agent verifies it |', '|---|---|---|');
      agent.forEach(function (q) { var x = d.by[q.id]; o.push('| [' + q.id + '](SPEC.md#' + (q.sub || q.sec).anchor + ') | ' + esc(x.name) + ' | ' + esc(x.steps) + ' |'); });
      o.push('', '</details>');
    }
  });
  while (o[o.length - 1] === '') o.pop();
  return { text: o.join('\n'), ids: [], errs: d.probs };
}
function genTestResults(planText, specText) {
  var d = testPlanData(planText, specText), last = '';
  var o = ['```text', 'Test results – <app name> <version> on <TV brand and model>, <date>', 'Build / commit tested: <filled in by the agent>', '',
    'Device setup checklist (section 1): complete / missing: ...', 'Smoke test (section 2): passed / failed at step ...'];
  d.reqs.forEach(function (q) {
    var x = d.by[q.id];
    if (!x || x.who !== 'human') return;
    if (q.sec.id !== last) { o.push('', q.sec.id + ' ' + q.sec.title); last = q.sec.id; }
    o.push('  [ ] pass  [ ] fail   ' + q.id + '  ' + x.name + '  – notes:');
  });
  o.push('', 'Performance (section 4): numbers from the agent: ...  what I saw: ...', 'Privacy & security (section 5): all OK / problem with ...',
    'Anything else I noticed: ...', '```');
  return { text: o.join('\n'), ids: [] };
}

/* ---------------------------------------------------------------- review lock (docs/spec-review.json) */
/* The hand-written rows that depend on a requirement – its test in TEST-PLAN.md and every reusable-part row of
 * PORTING-WITH-AI.md that names it – are written against the requirement text of that moment. The lock stores a short hash
 * of that text per requirement. When the text changes but the ID stays, the check fails until someone has looked at the
 * dependent rows and confirmed them with `npm run spec -- --ack <ID>`. New requirements are added (their rows are written
 * now), removed ones dropped – both by `npm run spec`; a changed hash is never updated without --ack. */
var LOCK = 'docs/spec-review.json';
var LOCK_NOTE = 'Generated by tools/spec_gen.js. Per requirement ID: hash of its text in SPEC.md when the rows that depend on it ' +
  '(its test in TEST-PLAN.md, reusable-part rows in PORTING-WITH-AI.md) were last checked. Changed requirement -> check those rows, ' +
  'then run: npm run spec -- --ack <ID>. Do not edit by hand.';
function reqHash(text) { return require('crypto').createHash('sha256').update(text.replace(/\s+/g, ' ').trim(), 'utf8').digest('hex').slice(0, 12); }
function reviewData(specText, planText, portText) {
  var all = specReqs(specText, true), byId = {}, deps = {}, order = [];
  all.forEach(function (q) { if (!byId[q.id]) byId[q.id] = q; });
  function dep(id, what) { if (!byId[id]) return; if (!deps[id]) { deps[id] = []; order.push(id); } if (deps[id].indexOf(what) < 0) deps[id].push(what); }
  (handRows(planText, 'test-steps') || []).forEach(function (r) { dep(r.id, 'its test row in ' + pub('docs/TEST-PLAN.md') + ' (<!-- hand:test-steps -->)'); });
  (handRows(portText, 'reuse') || []).forEach(function (r) {
    var m, re = /\b([A-Z][A-Z0-9]*-\d+)\b/g, t = r.cells.join(' ');
    while ((m = re.exec(t))) dep(m[1], 'reusable-part row `' + r.id + '` in ' + pub('docs/PORTING-WITH-AI.md') + ' (<!-- hand:reuse -->)');
  });
  order.sort(function (a, b) { return all.indexOf(byId[a]) - all.indexOf(byId[b]); });
  var want = {};
  order.forEach(function (id) { want[id] = reqHash(byId[id].text); });
  return { want: want, deps: deps, byId: byId, order: order };
}
/* -> { text (new lock file), errs }; ack = list of IDs (or ['all']) whose changed text is confirmed */
function genReview(lockText, specText, planText, portText, ack) {
  var d = reviewData(specText, planText, portText), old = {}, errs = [], out = {}, file = pub(LOCK);
  try { old = lockText ? JSON.parse(lockText).reviewed || {} : {}; } catch (e) { errs.push(file + ': not valid JSON (' + e.message + ') – delete it and run `npm run spec` to rebuild it.'); }
  ack = ack || [];
  ack.forEach(function (id) { if (id !== 'all' && !d.want[id]) errs.push('--ack ' + id + ': no such requirement with dependent rows in SPEC.md (check the spelling).'); });
  d.order.forEach(function (id) {
    var cur = d.want[id], was = old[id];
    if (!was || ack.indexOf('all') >= 0 || ack.indexOf(id) >= 0) { out[id] = cur; return; }
    out[id] = was;
    if (was !== cur) {
      var q = d.byId[id];
      errs.push('Requirement ' + id + (q.sec && /^A/.test(q.sec.id) ? ' (SPEC ' + (q.sub || q.sec).id + ')' : '') + ' was changed in ' + pub('docs/SPEC.md') +
        ' since the rows that depend on it were last checked: ' + d.deps[id].join('; ') + '. Read the new wording (git diff ' + pub('docs/SPEC.md') +
        '), update those rows where they no longer match, then confirm with `npm run spec -- --ack ' + id + '`.');
    }
  });
  return { text: JSON.stringify({ $comment: LOCK_NOTE, reviewed: out }, null, 2) + '\n', errs: errs,
    acked: ack.filter(function (id) { return id === 'all' || d.want[id]; }) };
}

/* ---------------------------------------------------------------- one version everywhere */
/* the app version (= spec version) is written in several files; a bump in package.json alone would leave the TV app,
 * the widget and the setup program on the old number */
var VERSION_FILES = [
  ['package-lock.json', /^  "version": "([^"]+)"/m],
  ['package-lock.json', /^    "": \{\n[^}]*?"version": "([^"]+)"/m],
  ['src/core/config.js', /\bversion: '([^']+)'/],
  ['loader/config.xml', /<ver itemtype="string">([^<]+)<\/ver>/],
  ['installer/neosetup/__init__.py', /^VERSION = '([^']+)'/m],
  // statisches Versions-Abzeichen im README der privaten Fassung (ein privates Repo kann kein dynamisches Release-Abzeichen
  // zeigen); optional: das oeffentliche README hat ein dynamisches Abzeichen und dieses Muster nicht
  ['README.md', /badge\/version-([0-9][^-"]*)-/, true]
];
function versionProblems() {
  var v = appVersion(), bad = [], probs = [];
  VERSION_FILES.forEach(function (x) {
    if (!fs.existsSync(path.join(ROOT, x[0]))) return;
    var m = x[1].exec(rd(x[0]));
    if (!m && x[2]) return;
    if (!m) probs.push(x[0] + ': version not found (tools/spec_gen.js VERSION_FILES expects ' + x[1] + ') – update the pattern there.');
    else if (m[1] !== v && !bad.some(function (b) { return b.indexOf(x[0] + ' ') === 0; })) bad.push(x[0] + ' (' + m[1] + ')');
  });
  if (bad.length) probs.push('Version differs from package.json (' + v + '): ' + bad.join(', ') + '. Set the same version in package.json, package-lock.json ' +
    '(both entries), src/core/config.js, loader/config.xml, installer/neosetup/__init__.py (and the version badge in README.md, if it has one), then run `npm run spec`.');
  return probs;
}

/* ---------------------------------------------------------------- all files */
function files() {
  return [
    { rel: pub('docs/SPEC.md'), gen: Object.keys(GEN).concat(['version']), hand: true, refs: 'own' },
    { rel: pub('docs/PORTING-WITH-AI.md'), gen: ['version', 'sources', 'reuse'], refs: 'other' },
    { rel: pub('docs/TEST-PLAN.md'), gen: ['version', 'test-cases', 'test-results'], refs: 'other' },
    { rel: pub('PORTS.md'), gen: ['ports'], refs: 'other' },
    { rel: pub('docs/index.html'), gen: ['prompt-html', 'ports-html'] },
    { rel: pub('docs/port.html'), gen: ['prompt-html'] },
    { rel: pub('README.md'), gen: ['prompt'] },
    { rel: pub('README.de.md'), gen: ['prompt'] }
  ];
}
function generateAll(read, opts) {
  read = read || rd;
  var problems = [], res = {}, results = [], specRel = pub('docs/SPEC.md'), specText = read(specRel), outSpec = null;
  var gens = { version: genVersion, 'ports-html': function () { return genPortsHtml(specText); }, ports: function () { return genPorts(specText); },
    prompt: function () { return genPrompt(read); }, 'prompt-html': function () { return genPromptHtml(read); },
    sources: genSources, reuse: genReuse,
    'test-cases': function (t) { return genTestCases(t, specText); }, 'test-results': function (t) { return genTestResults(t, specText); } };
  Object.keys(GEN).forEach(function (k) { gens[k] = function () { return res[k] || (res[k] = GEN[k]()); }; });
  files().forEach(function (f) {
    var text = read(f.rel), out = text;
    f.gen.forEach(function (name) {
      var g = gens[name](out);                          // some generators read hand-written rows of the same file
      if (g.errs) problems = problems.concat(g.errs);
      out = fill(f.rel, out, name, g, problems);
    });
    if (f.hand) Object.keys(HAND).forEach(function (name) {
      var have = handIds(out, HAND[name]), need = res[name] ? res[name].ids : [];
      if (!have) { problems.push(f.rel + ': hand-written block <!-- hand:' + HAND[name] + ' --> … <!-- /hand:' + HAND[name] + ' --> is missing.'); return; }
      need.forEach(function (id) {
        if (have.indexOf(id) < 0) problems.push(WHAT[name] + ' `' + id + '` exists in the code (' + WHERE[name] + ') but has no hand-written entry in ' + f.rel + '. ' +
          'Add a table row starting with "| `' + id + '` |" inside <!-- hand:' + HAND[name] + ' --> … <!-- /hand:' + HAND[name] + ' --> ' + (name === 'assets' ? 'saying what the picture is for and where it appears.' : 'describing its behaviour (what it does, edge cases, availability).'));
      });
      have.forEach(function (id) {
        if (need.indexOf(id) < 0) problems.push(f.rel + ': hand-written entry `' + id + '` in <!-- hand:' + HAND[name] + ' --> no longer exists in the code (' + WHERE[name] + '). Remove or rename it.');
      });
    });
    if (f.rel === specRel) outSpec = out;
    results.push({ rel: f.rel, text: text, out: out, refs: f.refs });
  });
  var idx = specIndex(outSpec);
  results.forEach(function (r) { if (r.refs) problems = problems.concat(checkRefs(r.rel, r.out, idx, r.refs === 'own')); });
  var lockRel = pub(LOCK), lockText = tryRead(read, lockRel);   // missing -> built from scratch
  var rv = genReview(lockText, outSpec, outOf(pub('docs/TEST-PLAN.md')), outOf(pub('docs/PORTING-WITH-AI.md')), opts && opts.ack);
  problems = problems.concat(rv.errs, versionProblems()).filter(function (x, i, a) { return a.indexOf(x) === i; });
  results.push({ rel: lockRel, text: lockText, out: rv.text });
  function outOf(rel) { return results.filter(function (r) { return r.rel === rel; })[0].out; }
  return { files: results, problems: problems, acked: rv.acked };
}
function tryRead(read, rel) { try { return read(rel); } catch (e) { return ''; } }
/* SPEC.md only (text in, generated text + all problems out) */
function generate(text) {
  var specRel = pub('docs/SPEC.md');
  var g = generateAll(function (rel) { return rel === specRel ? text : rd(rel); });
  return { text: g.files[0].out, problems: g.problems };
}
function clip(s) { s = String(s === undefined ? '(end of file)' : s); return s.length > 100 ? s.slice(0, 100) + '…' : s; }
/* where a file differs from what it should be (first differing line, both versions) */
function firstDiff(have, want) {
  var a = have.split('\n'), b = want.split('\n'), i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return 'first difference at line ' + (i + 1) + ': is "' + clip(a[i]) + '", should be "' + clip(b[i]) + '"';
}
function check() {
  var g = generateAll(), problems = g.problems.slice();
  g.files.forEach(function (f) {
    if (f.out === f.text) return;
    problems.unshift(f.rel + (f.text ? ': generated content is stale (' + firstDiff(f.text, f.out) + ')' : ': missing') + '. Run `npm run spec` and commit the result.');
  });
  /* files of the design system (design/README.md, accent palette, icon columns) – npm run spec regenerates them too */
  require('./design_doc.js').stale().forEach(function (f) { problems.unshift(f + ': generated from design/tokens.json / design/icons but stale. Run `npm run spec` and commit the result.'); });
  return problems;
}
module.exports = { generate: generate, generateAll: generateAll, check: check, settingsData: settingsData, routesData: routesData,
  validate: validate, specIndex: specIndex, checkRefs: checkRefs, specReqs: specReqs, testPlanData: testPlanData, genReuse: genReuse,
  genReview: genReview, reqHash: reqHash, versionProblems: versionProblems, firstDiff: firstDiff, portTags: portTags };

/* npm run spec [-- --ack ID[,ID…]|all]   ·   npm run spec:check */
function main(argv) {
  var checkOnly = argv.indexOf('--check') >= 0, problems, ack = [];
  argv.forEach(function (a, i) {
    var v = a.indexOf('--ack=') === 0 ? a.slice(6) : a === '--ack' ? argv[i + 1] : null;
    if (v) ack = ack.concat(v.split(',').map(function (x) { return x.trim(); }).filter(Boolean));
  });
  if (argv.indexOf('--ack') >= 0 && !ack.length) { console.error('spec: --ack needs requirement IDs, e.g. npm run spec -- --ack PLAY-3,NAV-1 (or --ack all)'); return 1; }
  if (checkOnly) problems = check();
  else {
    require('./design_doc.js').write().forEach(function (f) { console.log('spec: design file updated: ' + f); });
    var g = generateAll(null, { ack: ack });
    g.files.forEach(function (f) {
      if (f.out !== f.text) { fs.writeFileSync(path.join(ROOT, f.rel), f.out); console.log('spec: generated content updated in ' + f.rel); }
    });
    if (g.acked.length) console.log('spec: confirmed as reviewed: ' + g.acked.join(', '));
    problems = g.problems;
  }
  if (problems.length) {
    console.error('SPEC CHECK FAILED (' + problems.length + ' problem' + (problems.length > 1 ? 's' : '') + '):\n  - ' + problems.join('\n  - ') +
      '\n\nHow to keep the spec current: ' + pub('CONTRIBUTING.md') + '.');
    return 1;
  }
  console.log(checkOnly ? 'spec: SPEC.md, PORTING-WITH-AI.md, TEST-PLAN.md, PORTS.md, the starter prompt in the READMEs, the website and the design files are up to date' : 'spec: done');
  return 0;
}
if (require.main === module) {
  var code;
  try { code = main(process.argv.slice(2)); } catch (e) {
    console.error('SPEC CHECK FAILED: tools/spec_gen.js could not read the code (' + e.message + ').\n' +
      'Usually a file it reads was moved, renamed or does not load – fix that first (`npm test` shows build errors), then run `npm run spec` again.\n' +
      'Details: ' + String(e.stack || '').split('\n').slice(1, 3).join(' ').replace(/\s+/g, ' '));
    code = 1;
  }
  process.exit(code);
}

