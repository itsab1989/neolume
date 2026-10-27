/* N.net – Erkennung "Server nicht erreichbar" (SPEC 9 Offline, 10.5): N.http meldet jedes Ergebnis einer PMS-Anfrage
 * (N.http.watch). 2 Netzfehler/Zeitueberschreitungen hintereinander = offline -> Ereignis 'net:offline', danach alle 10 s
 * GET /identity (4 s, ohne Wiederholung). Jede Antwort des Servers (auch 4xx/5xx) = erreichbar -> 'net:online'.
 * Anzeige: ui/netbar.js (Leiste mit Countdown), Player: "Verbindung unterbrochen" (views/player.js). */
(function (N) {
  var U = N.util, PING_MS = 10000, FAILS = 2;
  var timers = { set: function (f, ms) { return setTimeout(f, ms); }, clear: function (t) { clearTimeout(t); }, now: function () { return U.now(); } };
  var W = { offline: false, fails: 0, nextAt: 0, checking: false, t: 0 };
  function isPms(url) { var b = N.plex && N.plex.base; return !!b && String(url || '').indexOf(b) === 0; }
  function reachable(err) { return !err || err.type === 'http' || err.type === 'parse'; }
  W.init = function () { N.http.watch = W.observe; };
  /* Ergebnis einer Anfrage (N.http, nach allen Wiederholungen) */
  W.observe = function (url, err) {
    if (!isPms(url) || (err && err.type === 'aborted')) return;
    if (reachable(err)) { W.fails = 0; W.back(); return; }
    W.fails++;
    if (W.fails >= FAILS && !W.offline) W.down();
  };
  W.down = function () {
    W.offline = true;
    if (N.log) N.log('net offline (' + W.fails + ' Fehler)');
    N.evt.emit('net:offline');
    W.schedule(PING_MS);
  };
  W.back = function () {
    if (!W.offline) return;
    W.offline = false; W.fails = 0;
    if (W.t) { timers.clear(W.t); W.t = 0; }
    if (N.log) N.log('net online');
    N.evt.emit('net:online');
  };
  W.schedule = function (ms) {
    if (W.t) timers.clear(W.t);
    W.nextAt = timers.now() + ms;
    W.t = timers.set(function () { W.t = 0; W.ping(); }, ms);
  };
  /* Erreichbarkeit pruefen (auch "Erneut versuchen"); cb(ok) */
  W.ping = function (cb) {
    if (W.checking) { if (cb) cb(false); return; }
    W.checking = true;
    N.plex.get('/identity', null, { timeout: 4000, retries: 0, dedupe: false }, function (err) {
      W.checking = false;
      var ok = reachable(err);
      if (ok) W.back(); else if (W.offline) W.schedule(PING_MS);
      if (cb) cb(ok);
    });
  };
  W.retryNow = function (cb) { if (W.t) { timers.clear(W.t); W.t = 0; } W.ping(cb); };
  W.secondsLeft = function () { return Math.max(0, Math.ceil((W.nextAt - timers.now()) / 1000)); };
  /* Tests */
  W._reset = function (t) { if (t) timers = t; W.offline = false; W.fails = 0; W.nextAt = 0; W.checking = false; W.t = 0; };
  N.net = W;
})(N);
