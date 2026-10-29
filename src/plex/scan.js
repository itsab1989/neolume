/* N.scan – "Bibliotheken aktualisieren" (Nutzerwunsch 26.10., nur Hauptkonto): GET /library/sections/all|<id>/refresh, dann
 * /activities alle 3 s (max. 10 Min.) bis kein Bibliotheks-Scan mehr laeuft -> Toast "Fertig", Ereignis library:scanned
 * (Startseite laedt still neu). Profilwechsel beendet die Abfrage. 401/403 -> klare Meldung. */
(function (N) {
  var POLL = 3000, MAX = 600000, cur = null;
  var S = {
    /* /activities -> {busy, pct} (rein, getestet): nur Bibliotheks-Aktivitaeten (library.update.section, library.refresh.items …) */
    progress: function (json) {
      var a = json && json.MediaContainer && json.MediaContainer.Activity || [], n = 0, sum = 0;
      for (var i = 0; i < a.length; i++) {
        if (!/^library\./.test(String(a[i].type || ''))) continue;
        n++; sum += Number(a[i].progress) || 0;
      }
      return { busy: n > 0, pct: n ? Math.round(sum / n) : -1 };
    },
    running: function () { return !!cur; },
    stop: function () { if (cur) { clearTimeout(cur.t); if (cur.task) cur.task.abort(); cur = null; } },
    /* lib: Bibliotheks-id oder null (alle) */
    start: function (lib) {
      S.stop();
      var me = cur = { t: 0, task: null, t0: N.util.now(), seen: false, polls: 0, last: -2 };
      var path = '/library/sections/' + (lib ? lib : 'all') + '/refresh';
      N.plex.write('GET', path, null, function (err) {
        if (cur !== me) return;
        if (err) {
          cur = null;
          N.ui.toast.show(N.t(err.status === 401 || err.status === 403 ? 'toast.scanDenied' : 'toast.scanFailed'));
          return;
        }
        N.ui.toast.show(N.t('toast.scanStarted'), { ms: 6000 });
        poll();
      });
      function poll() {
        me.t = setTimeout(function () {
          if (cur !== me) return;
          me.task = N.plex.get('/activities', null, { retries: 0 }, function (err, d) {
            me.task = null;
            if (cur !== me) return;
            me.polls++;
            var p = err ? { busy: true, pct: -1 } : S.progress(d);
            if (p.busy && !err) me.seen = true;
            if (!p.busy && (me.seen || me.polls >= 3)) { cur = null; N.ui.toast.show(N.t('toast.scanDone'), { icon: 'confirm' }); N.evt.emit('library:scanned', { lib: lib }); return; }
            if (N.util.now() - me.t0 > MAX) { cur = null; return; }
            if (p.pct >= 0 && p.pct !== me.last) { me.last = p.pct; N.ui.toast.show(N.t('toast.scanProgress', { n: p.pct }), { ms: 6000 }); }
            poll();
          });
        }, POLL);
      }
    }
  };
  if (N.evt) N.evt.on('profile:changed', function () { S.stop(); });
  N.scan = S;
})(N);
