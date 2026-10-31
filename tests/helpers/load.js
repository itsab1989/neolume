/* Laedt die ES5-Module aus src/ (Manifest-Reihenfolge) in einen eigenen vm-Kontext – ohne DOM.
 * Optional mit kuenstlichen Timern (deterministisch): load({fakeTimers:true}) -> ctx.timers.tick(ms) */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var SRC = path.join(__dirname, '..', '..', 'src');

function FakeTimers() {
  var now = 1000000, seq = 1, list = [];
  var T = {
    now: function () { return now; },
    setTimeout: function (fn, ms) { var id = seq++; list.push({ id: id, at: now + (ms || 0), fn: fn }); return id; },
    clearTimeout: function (id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) { list.splice(i, 1); return; } },
    tick: function (ms) {
      var end = now + ms;
      for (;;) {
        list.sort(function (a, b) { return a.at - b.at || a.id - b.id; });
        if (!list.length || list[0].at > end) break;
        var t = list.shift(); now = Math.max(now, t.at); t.fn();
      }
      now = end;
    },
    pending: function () { return list.length; },
    /* Wanduhr springt (TV stellt die Uhr nach): Date.now() aendert sich, laufende Timer feuern weiter nach ihrer Restzeit */
    jump: function (ms) { now += ms; for (var i = 0; i < list.length; i++) list[i].at += ms; }
  };
  return T;
}

/* opts.ext: Liste von Erweiterungen (brand "features", tools/build.js) – deren Module werden hinter dem Haupt-Manifest geladen
 * (nur wo src/private/manifest.json existiert; sonst Fehler, damit kein Test still ohne seine Module laeuft) */
function extModules(list) {
  var mp = path.join(SRC, 'private', 'manifest.json'), m = JSON.parse(fs.readFileSync(mp, 'utf8')), out = [];
  list.forEach(function (f) { if (!m[f]) throw new Error('Erweiterung fehlt: ' + f); (m[f].js || []).forEach(function (x) { out.push('private/' + x); }); });
  return out;
}

function load(opts) {
  opts = opts || {};
  var manifest = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
  if (opts.ext && opts.ext.length) manifest = manifest.concat(extModules(opts.ext));
  var ctx = { console: console };
  if (opts.fakeTimers) {
    var T = FakeTimers();
    ctx.timers = T;
    ctx.setTimeout = T.setTimeout; ctx.clearTimeout = T.clearTimeout;
    ctx.setInterval = function () { return 0; }; ctx.clearInterval = function () {};
    var RealDate = Date;
    ctx.Date = function (v) { return arguments.length ? new RealDate(v) : new RealDate(T.now()); };
    ctx.Date.now = T.now; ctx.Date.UTC = RealDate.UTC; ctx.Date.parse = RealDate.parse;
  } else {
    ctx.setTimeout = setTimeout; ctx.clearTimeout = clearTimeout; ctx.setInterval = setInterval; ctx.clearInterval = clearInterval;
  }
  ctx.window = ctx;
  vm.createContext(ctx);
  manifest.forEach(function (f) {
    if (opts.only && opts.only.indexOf(f) < 0 && f !== 'core/ns.js') return;
    vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
  });
  return ctx;
}

/* Kuenstliches XHR: Antworten per Skript; zaehlt parallele Anfragen */
function FakeXHR(script) {
  var log = { opened: [], active: 0, maxActive: 0, aborted: 0 };
  function X() { this.readyState = 0; this.status = 0; this.responseText = ''; this.headers = {}; }
  X.prototype.open = function (m, u) { this.method = m; this.url = u; };
  X.prototype.setRequestHeader = function (k, v) { this.headers[k] = v; };
  X.prototype.send = function (body) {
    var self = this;
    log.opened.push({ method: this.method, url: this.url, headers: this.headers, body: body });
    log.active++; log.maxActive = Math.max(log.maxActive, log.active);
    var r = script(this.method, this.url, log.opened.length, this);
    if (!r || r.hang) return;                        // haengt -> Timeout
    self._hdrs = r.headers || null;                  // optionale Antwortkoepfe (z. B. Date fuer core/clock.js)
    (r.timers || { setTimeout: setTimeout }).setTimeout(function () { self._respond(r.status, r.body); }, r.delay || 0);
  };
  X.prototype._respond = function (status, body) {
    if (this._done) return;
    this._done = true; log.active--;
    this.readyState = 4; this.status = status; this.responseText = typeof body === 'string' ? body : JSON.stringify(body);
    if (this.onreadystatechange) this.onreadystatechange();
  };
  X.prototype.getResponseHeader = function (k) { return this.readyState >= 2 && this._hdrs && this._hdrs[k] !== undefined ? this._hdrs[k] : null; };
  X.prototype.abort = function () { if (!this._done) { this._done = true; log.active--; log.aborted++; } };
  return { factory: function () { return new X(); }, log: log };
}

function synthetic(name) { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'synthetic', name), 'utf8')); }

function eq(a, b, msg) { var A = require('assert'); if (msg === undefined) A.deepStrictEqual(JSON.parse(JSON.stringify(a)), b); else A.deepStrictEqual(JSON.parse(JSON.stringify(a)), b, msg); }

module.exports = { eq: eq, load: load, FakeTimers: FakeTimers, FakeXHR: FakeXHR, synthetic: synthetic };
