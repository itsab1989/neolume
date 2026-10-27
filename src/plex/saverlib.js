/* N.saverLib – Bilder des Bildschirmschoners aus ganzen Bibliotheken (Einstellung "Schoner-Bilder aus" = Bibliotheken).
 * Anfragen (Token des aktiven Profils -> eingeschraenkte Profile bekommen nur, was der PMS ihnen zeigt):
 *   1. je gewaehlter Bibliothek EINE Zaehl-Anfrage /library/sections/<id>/all?type=…&X-Plex-Container-Size=0 (nur totalSize)
 *   2. dann je 30 Bilder EINE Seite …/all?type=…&sort=titleSort&X-Plex-Container-Start=<zufaellige Seite>&X-Plex-Container-Size=30
 *      mit excludeElements/excludeFields; "Nur Ungesehenes": unwatched=1 (Filme) bzw. unwatchedLeaves=1 (Serien).
 *   Bei 30 s Takt also hoechstens eine Anfrage je ~15 Minuten. Nur im Speicher (Profilwechsel/Aenderung der Auswahl = neu).
 * Nur Hintergrundbilder von Filmen, Serien und Kuenstlern – keine Folgenbilder, daher nichts fuer den Spoilerschutz.
 * next(cb): cb(item|null) – null = keine Bilder (Fehler, leere Auswahl) -> der Schoner nimmt die Startseiten-Bilder. */
(function (N) {
  var SL = N.saverLogic, M = N.model;
  var pool = null, key = '', task = null, waiting = [], filling = false, failAt = 0, RETRY = 60000;

  function settings() { return N.session && N.session.settings || {}; }
  function chosen() {
    var hc = N.session && N.session.homeCache && N.session.homeCache(), all = hc && (hc.alibs || hc.libs) || [];
    return SL.libs(settings().saverLibs, all);
  }
  function keyOf(libs) {
    var ids = [];
    for (var i = 0; i < libs.length; i++) ids.push(libs[i].id);
    return (N.session && N.session.profile ? N.session.profile.uuid : '') + '|' + ids.join(',') + '|' + (settings().saverUnwatched ? 1 : 0);
  }
  function get(path, q, cb) {
    task = N.plex.get(path, q, { timeout: 12000 }, function (err, d) { task = null; cb(err, d); });
  }
  function flush(it) { var w = waiting; waiting = []; for (var i = 0; i < w.length; i++) w[i](it); }

  /* Anzahl je Bibliothek, nacheinander (kein Gedraenge neben Bildern); cb(totals | null, fehlgeschlagen) */
  function count(libs, unw, cb) {
    var totals = [], i = 0;
    (function one() {
      if (i >= libs.length) { cb(totals); return; }
      var lib = libs[i++];
      get('/library/sections/' + lib.id + '/all', SL.query(lib, 0, 0, unw), function (err, d) {
        if (err) { cb(null, err.type !== 'aborted'); return; }   // Fehler: kein Pool, spaeter neu zaehlen
        var n = !err && d && d.MediaContainer ? Number(d.MediaContainer.totalSize || d.MediaContainer.size || 0) : 0;
        if (n > 0) totals.push({ lib: lib, n: n });
        one();
      });
    })();
  }
  /* bis zu 3 Seiten laden, bis ein Bild da ist; cb(ok, abgebrochen) */
  function fill(unw, cb, tries) {
    var pg = pool.nextPage();
    if (!pg) { cb(false); return; }
    get('/library/sections/' + pg.lib.id + '/all', SL.query(pg.lib, pg.start, SL.PAGE, unw), function (err, d) {
      if (err) { cb(false, err.type === 'aborted'); return; }
      var mc = d && d.MediaContainer || {};
      pool.add(M.normList(mc.Metadata || [], null, pg.lib.id));
      if (pool.q.length || (tries || 0) >= 2) cb(!!pool.q.length);
      else fill(unw, cb, (tries || 0) + 1);
    });
  }
  function rnd() { return N.config && N.config.fixedClock ? 0 : Math.random(); }   // Tests: feste Reihenfolge

  var SLB = {
    /* naechstes Bild {rk, art, title, type, year, …} oder null */
    next: function (cb) {
      var libs = chosen(), unw = !!settings().saverUnwatched, k = keyOf(libs);
      if (!libs.length) { cb(null); return; }
      if (k !== key) { SLB.reset(); key = k; }
      if (pool && pool.q.length) {
        var it = pool.take();
        cb(it);
        if (pool.low() && !filling) { filling = true; fill(unw, function () { filling = false; }); }   // Vorrat im Hintergrund auffuellen
        return;
      }
      waiting.push(cb);
      if (filling) return;
      if (failAt && N.util.now() - failAt < RETRY) { flush(null); return; }   // nach Fehler 1 Min. Ruhe (Startseiten-Bilder)
      filling = true;
      function done(ok, aborted) {
        filling = false;
        if (aborted) return;                               // Schoner beendet: Warteliste ist schon leer
        failAt = ok ? 0 : N.util.now();
        flush(ok && pool ? pool.take() : null);
      }
      function go() {
        if (pool.done()) {                                 // Runde zu Ende: alles gezeigt -> neu mischen
          if (!pool.size()) { done(false); return; }
          pool.newRound();
        }
        fill(unw, done);
      }
      if (pool) { go(); return; }
      count(libs, unw, function (totals, failed) {
        if (!totals) { filling = false; if (failed) failAt = N.util.now(); flush(null); return; }
        pool = new SL.Pool(rnd);
        pool.setTotals(totals);
        go();
      });
    },
    /* Schoner aus: laufende Anfrage abbrechen (Vorrat bleibt fuer das naechste Mal) */
    abort: function () { if (task) { var t = task; task = null; t.abort(); } filling = false; waiting = []; },
    reset: function () { SLB.abort(); pool = null; key = ''; failAt = 0; },
    _pool: function () { return pool; }
  };
  N.evt.on('profile:changed', function () { SLB.reset(); });
  N.saverLib = SLB;
})(N);
