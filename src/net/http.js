/* N.http – XHR mit eigenem Timeout (setTimeout + abort), JSON, Retries fuer GET (Netzfehler/Timeout/5xx: nach 500 und 1500 ms),
 * Dedupe gleicher laufender GETs (URL + Token), max. 3 parallel, 401 -> Ereignis auth:expired (SPEC 14.8).
 * cb(err, data, meta) ; err = {type:'timeout'|'network'|'http'|'parse', status} ; Rueckgabe task {abort()} */
(function (N) {
  var U = N.util, active = 0, MAX = 3, queue = [], inflight = {};
  var DELAYS = [500, 1500];
  var factory = function () { return new XMLHttpRequest(); };
  var timers = { set: function (f, ms) { return setTimeout(f, ms); }, clear: function (t) { clearTimeout(t); } };

  function finishSlot() { active--; pump(); }
  function pump() {
    while (active < MAX && queue.length) { active++; queue.shift()(); }
  }
  function slot(fn) { queue.push(fn); pump(); }

  /* ein einzelner Versuch */
  function attempt(o, done) {
    var x = factory(), fin = false, t;
    function end(err, data, status) {
      if (fin) return; fin = true;
      timers.clear(t);
      x.onreadystatechange = null;
      if (x.destroy) { try { x.destroy(); } catch (e0) {} }
      done(err, data, status);
    }
    t = timers.set(function () { try { x.abort(); } catch (e) {} end({ type: 'timeout', status: 0 }, null, 0); }, o.timeout || 8000);
    x.onreadystatechange = function () {
      if (x.readyState !== 4 || fin) return;
      var st = x.status, txt = x.responseText, data = null;
      if (st === 0) { end({ type: 'network', status: 0 }, null, 0); return; }
      if (st < 200 || st >= 300) { end({ type: 'http', status: st, body: U.parse(txt) }, null, st); return; }
      if (o.json !== false && txt) {
        data = U.parse(txt);
        if (data === null) { end({ type: 'parse', status: st }, null, st); return; }
      } else data = txt || null;
      end(null, data, st);
    };
    try {
      x.open(o.method || 'GET', o.url, true);
      var h = o.headers || {};
      for (var k in h) if (Object.prototype.hasOwnProperty.call(h, k)) x.setRequestHeader(k, h[k]);
      x.send(o.body === undefined ? null : o.body);
    } catch (e) { end({ type: 'network', status: 0 }, null, 0); }
    return { abort: function () { if (fin) return; try { x.abort(); } catch (e) {} end({ type: 'aborted', status: 0 }, null, 0); } };
  }

  function retryable(err) { return err && (err.type === 'network' || err.type === 'timeout' || (err.type === 'http' && err.status >= 500)); }

  function run(o, cb) {
    var tries = 0, cur = null, retryT = 0, aborted = false, t0 = U.now();
    var maxRetries = o.retries !== undefined ? o.retries : ((o.method || 'GET') === 'GET' ? 2 : 0);
    function go() {
      slot(function () {
        if (aborted) { finishSlot(); return; }
        cur = attempt(o, function (err, data, status) {
          cur = null; finishSlot();
          if (aborted) return;
          if (err && retryable(err) && tries < maxRetries) {
            retryT = timers.set(function () { retryT = 0; go(); }, DELAYS[Math.min(tries, DELAYS.length - 1)]);
            tries++;
            return;
          }
          if (err && err.status === 401 && !o.no401) N.evt.emit('auth:expired', { url: o.url });
          if (N.http.watch && !o.nowatch) { try { N.http.watch(o.url, err); } catch (ew) {} }   // P5: Offline-Erkennung (core/netwatch.js); nowatch: langsame Fremd-Abfragen (P4 matches) zaehlen nicht
          cb(err, data, { status: status, ms: U.now() - t0, tries: tries + 1 });
        });
      });
    }
    go();
    return { abort: function () { aborted = true; if (retryT) timers.clear(retryT); if (cur) cur.abort(); } };
  }

  N.http = {
    request: function (o, cb) {
      var method = o.method || 'GET';
      if (method !== 'GET' || o.dedupe === false) return run(o, cb);
      var key = o.url + '|' + ((o.headers && o.headers['X-Plex-Token']) || ''), entry = inflight[key];   // je Profil-Token getrennt
      var mine = { cb: cb };
      if (entry) { entry.subs.push(mine); }
      else {
        entry = inflight[key] = { subs: [mine], task: null };
        entry.task = run(o, function (err, data, meta) {
          delete inflight[key];
          var subs = entry.subs.slice();
          for (var i = 0; i < subs.length; i++) subs[i].cb(err, data, meta);
        });
      }
      return {
        abort: function () {
          var i = entry.subs.indexOf(mine);
          if (i >= 0) entry.subs.splice(i, 1);
          if (!entry.subs.length && inflight[key] === entry) { delete inflight[key]; entry.task.abort(); }
        }
      };
    },
    /* Tests: XHR-Fabrik und Timer austauschen */
    _setFactory: function (f) { factory = f; },
    _setTimers: function (t) { timers = t; },
    _reset: function () { active = 0; queue = []; inflight = {}; },
    _stats: function () { return { active: active, queued: queue.length }; }
  };
})(N);
