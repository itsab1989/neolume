/* N.plex – PMS-Client und plex.tv-Zugriff ueber den LAN-Proxy. Header nach SPEC 14.8 inkl. X-Plex-Language. */
(function (N) {
  var U = N.util, C = N.config;
  var P = {
    clientId: null,
    base: '',          // http://ip:32400 des aktiven Servers
    token: null,       // Server-Token des AKTIVEN PROFILS (SPEC 7.15.5)
    headers: function (token) {
      var h = {
        'Accept': 'application/json',
        'X-Plex-Product': C.product,
        'X-Plex-Version': C.version,
        'X-Plex-Client-Identifier': P.clientId || 'plexneo-unknown',
        'X-Plex-Platform': C.platform,
        'X-Plex-Platform-Version': C.platformVersion,
        'X-Plex-Device': C.device,
        'X-Plex-Device-Name': C.deviceName,
        'X-Plex-Language': N.i18n.plexLanguage()
      };
      if (token) h['X-Plex-Token'] = token;
      return h;
    },
    setServer: function (uri, token) { P.base = (uri || '').replace(/\/+$/, ''); P.token = token || null; },
    url: function (path, query) { return U.addQs(P.base + path, query); },
    /* PMS-Anfrage mit dem Profil-Token. opts: {method, timeout, retries, query} */
    pms: function (method, path, query, opts, cb) {
      opts = opts || {};
      var base = opts.base !== undefined ? opts.base : P.base, tok = opts.token !== undefined ? opts.token : P.token, no401 = opts.no401;
      if (opts.srv) return P.pmsSrv(method, path, query, opts, cb);
      return N.http.request({
        method: method, url: U.addQs(base + path, query), headers: P.headers(tok),
        timeout: opts.timeout || 8000, retries: opts.retries, json: opts.json, dedupe: opts.dedupe, no401: no401, nowatch: opts.nowatch
      }, cb);
    },
    /* Weitere Server (N.srv): Adresse + Token DIESES Servers; 401 dort heisst nie "eigenes Profil abgemeldet" (no401), Ausfaelle
     * zaehlen nicht fuer die Offline-Leiste des eigenen Servers (nowatch). Laeuft die Adresspruefung noch, wartet die Anfrage
     * darauf; nicht erreichbar -> Fehler {type:'network', srv}. Rueckruf im Kontext des Servers (N.model.norm markiert). */
    pmsSrv: function (method, path, query, opts, cb) {
      var id = opts.srv, done = N.srv.wrap(id, cb), inner = null, dead = false;
      function go() {
        if (dead) return;
        var c = N.srv.conn(id);
        if (!c) { N.srv.timing(id, method, path, { type: 'down' }, null); done({ type: 'network', srv: id, status: 0 }, null, { status: 0 }); return; }
        // TV-Test 1.0.4 (Dreamland): uebers Internet sind 8–12 s zu knapp (am TV meldet ein abgebrochenes XHR oft "network") ->
        // mindestens N.srv.TIMEOUT; GET wiederholt N.http ohnehin (500/1500 ms). Dauer jeder Anfrage ins Protokoll (ohne Query/Token).
        inner = N.http.request({
          method: method, url: U.addQs(c.base + path, query), headers: P.headers(c.token),
          timeout: Math.max(opts.timeout || 8000, N.srv.TIMEOUT), retries: opts.retries, json: opts.json, dedupe: opts.dedupe, no401: true, nowatch: true
        }, function (err, d, meta) {
          N.srv.timing(id, method, path, err, meta);
          if (err) { err.srv = id; N.srv.failed(id, err); }
          return done(err, d, meta);
        });
      }
      N.srv.when(id, go);
      return { abort: function () { dead = true; if (inner) inner.abort(); } };
    },
    get: function (path, query, opts, cb) { return P.pms('GET', path, query, opts, cb); },
    /* Schreibende Aktionen (Gesehen, Ausblenden …). N.config.readOnly (config.json {"readOnly":true}) unterdrueckt sie –
     * fuer Vorschau/Tests gegen den echten Server. who: {base, token} aus P.target() – fuer verzoegerte Schreibzugriffe, die
     * nach einem Profilwechsel noch mit dem Token des ALTEN Profils laufen muessen. */
    target: function () { return { base: P.base, token: P.token }; },
    write: function (method, path, query, cb, who) {
      if (N.config.readOnly) { if (N.log) N.log('readOnly: ' + method + ' ' + path + ' unterdrueckt'); setTimeout(function () { cb(null, null, { status: 200 }); }, 0); return { abort: function () {} }; }
      if (who && who.srv) return P.pms(method, path, query, { json: false, retries: method === 'GET' ? 1 : 0, dedupe: false, srv: who.srv }, cb);   // Weitere Server
      return P.pms(method, path, query, { json: false, retries: method === 'GET' ? 1 : 0, dedupe: false,
        base: who ? who.base : undefined, token: who ? who.token : undefined }, cb);
    },
    /* plex.tv (https) ueber den Proxy. no401: 401 hier heisst "falsche PIN" o. ae., kein globales Abmelden */
    tv: function (method, path, query, token, opts, cb) {
      opts = opts || {};
      if (N.session && N.session.pkg) {                // PMS-only (setup.json): nie plex.tv, auch nicht versehentlich
        if (N.log) N.log('plex.tv gesperrt (setup.json): ' + path);
        setTimeout(function () { cb({ type: 'pmsonly', status: 0 }); }, 0);
        return { abort: function () {} };
      }
      var url = U.addQs('https://plex.tv' + path, query);
      return N.http.request({
        method: method, url: C.proxy(url), headers: P.headers(token), timeout: opts.timeout || 10000,
        retries: opts.retries, no401: true, dedupe: false
      }, cb);
    }
  };
  N.plex = P;
})(N);
