/* N.connTest – "Verbindung testen" (SPEC 10.4 set.testConn): Server erreichbar? Antwortzeit (3 Messungen, Median), Server-Version,
 * Zugang dieses Profils, Zusammenfassung "was spielt der Fernseher direkt". Nur lesende GETs. summary() ist rein (getestet). */
(function (N) {
  var U = N.util;
  var T = {
    median: function (a) {
      var b = a.slice().sort(function (x, y) { return x - y; });
      return b.length ? b[Math.floor((b.length - 1) / 2)] : 0;
    },
    /* r: {name, reach, ms:[...], version, auth:'ok'|'denied'|'error'|null, directPlay, passthrough, quality} -> Zeilen (Text) */
    summary: function (r) {
      var out = [];
      if (!r.reach) {
        out.push(N.t('ct.down', { server: r.name }));
        out.push(N.t('ct.downHint'));
        return out;
      }
      var m = T.median(r.ms || []);
      out.push(N.t('ct.up', { server: r.name, ms: m }));
      out.push(N.t(m < 60 ? 'ct.fast' : m < 250 ? 'ct.ok' : 'ct.slow'));
      if (r.version) out.push(N.t('ct.version', { v: String(r.version).split('-')[0] }));
      if (r.auth === 'ok') out.push(N.t('ct.auth.ok'));
      else if (r.auth === 'denied') out.push(N.t('ct.auth.denied'));
      else if (r.auth === 'error') out.push(N.t('ct.auth.error'));
      out.push('');
      out.push(N.t('ct.direct'));
      out.push(N.t(r.directPlay === false ? 'ct.dpOff' : 'ct.dpOn') + ' · ' + N.t(r.passthrough === false ? 'ct.stereo' : 'ct.surround'));
      return out;
    },
    /* Pruefung ausfuehren; step(zeilen) nach jedem Schritt, done(r) am Ende */
    run: function (step, done) {
      var S = N.session, st = S && S.settings || {}, srv = S && S.state && S.state.server;
      var r = { name: srv && srv.name ? srv.name : 'Plex', reach: false, ms: [], version: '', auth: null, directPlay: st.directPlay, passthrough: st.passthrough };
      var n = 0, aborted = false, cur = null;
      function ping() {
        var t0 = U.now();
        cur = N.plex.get('/identity', null, { timeout: 4000, retries: 0, dedupe: false }, function (err, j) {
          cur = null;
          if (aborted) return;
          if (err && err.type !== 'http') { r.reach = r.ms.length > 0; if (!r.reach) { done(r); return; } auth(); return; }
          r.reach = true; r.ms.push(U.now() - t0);
          var mc = j && j.MediaContainer;
          if (mc && mc.version) r.version = mc.version;
          if (++n < 3) { step(T.summary(r)); ping(); } else auth();
        });
      }
      function auth() {
        step(T.summary(r));
        cur = N.plex.get('/library/sections', { 'X-Plex-Container-Size': 0 }, { timeout: 6000, retries: 0, dedupe: false, no401: true }, function (err) {
          cur = null;
          if (aborted) return;
          r.auth = !err ? 'ok' : err.status === 401 || err.status === 403 ? 'denied' : 'error';
          done(r);
        });
      }
      ping();
      return { abort: function () { aborted = true; if (cur) cur.abort(); } };
    }
  };
  N.connTest = T;
})(N);
