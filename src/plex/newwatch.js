/* N.newWatch – neue Titel auf dem Server bemerken (SPEC HOME-13). Rein lesend, Token des aktiven Profils (eingeschraenkte Profile
 * erfahren nur, was der PMS ihnen zeigt). Ausloeser ist nur das Aenderungs-Signal des Servers (N.libwatch, 'library:seen' bei jeder
 * Antwort von /library/sections): weicht der Stand einer Film-/Serien-/Musikbibliothek vom gemerkten ab, holt sie im Leerlauf EINE
 * kleine Liste "neu seit dem letzten Stand" (N.newsLogic.req, hoechstens 60 Titel), nacheinander, nie zwei zugleich, nie im
 * Tastenpfad. Ergebnis -> N.ui.news.add. Gemerkter Stand je Profil in news-<uuid>.json ({srv, libs: {id: {sig, at}}}); anderer
 * Server = neuer Ausgangsstand. Erster Lauf legt nur fest (nichts Altes melden); was ankam, waehrend die App aus war, kommt beim
 * naechsten Start als EIN Hinweis. Einstellung "Aus": kein Nachsehen, gemerkter Stand wird geloescht (beim Einschalten neu).
 * Takt: solange der Hinweis an ist, darf N.libwatch auch ausserhalb der Startseite nachsehen, aber hoechstens alle ~6 Min.
 * (Startseite: alle 2 Min. wie HOME-12). Im Video nur mit "Auch waehrend der Wiedergabe": hoechstens alle 5 Min. eine Anfrage
 * /library/sections, erst 1 Min. nach Start/Sprung/Nachladen, nie beim Puffern (N.newsLogic.playCheck). */
(function (N) {
  var L = N.newsLogic, U = N.util, todo = [], busy = false, retryT = 0, playT = 0;
  function S() { return N.session; }
  function on() { var s = S(); return !!(s && s.profile && s.settings) && L.mode(s.settings) !== 'off'; }   // Einstellungen des Profils geladen
  function file() { var s = S(); return s && s.profile ? 'news-' + s.profile.uuid + '.json' : ''; }
  function srv() { var s = S(), v = s && s.state && s.state.server; return v && (v.machineId || v.uri) || N.plex && N.plex.base || ''; }
  function key() { return file() + '|' + srv(); }
  function load() { var f = file(), d = f ? N.store.get(f) : null; return d && d.srv === srv() && d.libs ? d : { srv: srv(), libs: {} }; }
  function book(d) { return N.hubs && N.hubs.libKind ? N.hubs.libKind(d) === 'audio' : false; }
  function pump() { if (!busy && todo.length) N.idle.add(step, 'news-load'); }
  function later() { if (!retryT) retryT = setTimeout(function () { retryT = 0; pump(); }, 30000); if (retryT && retryT.unref) retryT.unref(); }
  function step() {
    if (busy || !todo.length) return;
    if (!on() || todo[0].k !== key()) { todo = []; return; }
    if (!W.quiet()) { later(); return; }               // Video ohne Erlaubnis, Schoner: spaeter
    var f = todo.shift(), r = L.req(f), k = f.k;
    busy = true;
    N.plex.get(r.path, r.query, { timeout: 10000, retries: 0 }, function (err, d) {
      busy = false;
      if (!err && k === key()) {
        var res = L.done(f, d), st = load();
        st.libs[f.id] = res.entry; N.store.set(file(), st);
        if (res.items.length && on()) N.ui.news.add(res.items);
      }
      pump();
    });
  }
  var W = {
    /* jetzt nachsehen erlaubt? wie N.libwatch.quiet, im Video nur mit Erlaubnis und ruhig laufend */
    quiet: function () {
      if (N.libwatch.quiet()) return true;
      var s = S(), st = N.player && N.player.status ? N.player.status() : null;
      if (!s || !s.profile || !st || !st.active || (N.ui.saver && N.ui.saver.on)) return false;
      return L.play(s.settings) && !!st.calm && st.since >= (N.config.newsSettleMs === undefined ? L.SETTLE : N.config.newsSettleMs);
    },
    /* jede Antwort von /library/sections (N.libwatch) */
    seen: function (dirs) {
      var f = file(), s = S();
      if (!f || !s.settings) return;
      if (!on()) { if (N.store.get(f)) N.store.set(f, null); todo = []; return; }
      var st = load(), p = L.plan(st, dirs, book), k = key(), i, j;
      if (p.dirty || st.srv !== srv()) N.store.set(f, { srv: srv(), libs: p.libs });
      for (i = 0; i < p.load.length; i++) {
        var x = p.load[i], dup = false;
        x.k = k;
        for (j = 0; j < todo.length; j++) if (todo[j].id === x.id && todo[j].k === k) { todo[j] = x; dup = true; }
        if (!dup) todo.push(x);
      }
      pump();
    },
    /* Takt im Video (60 s, nur Zahlenvergleiche): mit Erlaubnis hoechstens alle 5 Min. /library/sections */
    playTick: function () {
      var s = S(), st = N.player && N.player.status ? N.player.status() : null;
      if (!s || !s.profile || !st || !st.active || (N.ui.saver && N.ui.saver.on)) return false;
      var go = L.playCheck({ play: L.play(s.settings), active: true, calm: !!st.calm, since: st.since || 0, age: N.libwatch.age(),
        settle: N.config.newsSettleMs }) && (on() || N.libwatch.wanted());
      if (go) N.idle.add(function () { if (W.quiet()) N.libwatch.check(null, L.PLAY_EVERY - 5000); }, 'news-play');
      return go;
    },
    _reset: function () { todo = []; busy = false; if (retryT) clearTimeout(retryT); retryT = 0; },
    _todo: function () { return todo; }
  };
  N.evt.on('library:seen', function (e) { W.seen(e && e.dirs); });
  /* ausserhalb der Startseite: hoechstens alle ~6 Min. (Takt von N.libwatch 2 Min., Alter >= 5 Min.); Takt im Video 60 s.
   * Beides erst ab dem ersten Profil (keine Zeitgeber beim Laden des Moduls). */
  function wantFn() { return on() && N.libwatch.age() >= L.PLAY_EVERY - 5000; }
  function loop() { playT = setTimeout(function () { W.playTick(); loop(); }, 60000); if (playT && playT.unref) playT.unref(); }   // unref: nur Node (Tests)
  N.evt.on('profile:changed', function () { N.libwatch.want(wantFn); if (!playT) loop(); });
  N.newWatch = W;
})(N);
