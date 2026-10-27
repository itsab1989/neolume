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
      var base = opts.base !== undefined ? opts.base : P.base, tok = opts.token !== undefined ? opts.token : P.token;
      return N.http.request({
        method: method, url: U.addQs(base + path, query), headers: P.headers(tok),
        timeout: opts.timeout || 8000, retries: opts.retries, json: opts.json, dedupe: opts.dedupe, no401: opts.no401, nowatch: opts.nowatch
      }, cb);
    },
    get: function (path, query, opts, cb) { return P.pms('GET', path, query, opts, cb); },
    /* Schreibende Aktionen (Gesehen, Ausblenden …). N.config.readOnly (config.json {"readOnly":true}) unterdrueckt sie –
     * fuer Vorschau/Tests gegen den echten Server. who: {base, token} aus P.target() – fuer verzoegerte Schreibzugriffe, die
     * nach einem Profilwechsel noch mit dem Token des ALTEN Profils laufen muessen. */
    target: function () { return { base: P.base, token: P.token }; },
    write: function (method, path, query, cb, who) {
      if (N.config.readOnly) { if (N.log) N.log('readOnly: ' + method + ' ' + path + ' unterdrueckt'); setTimeout(function () { cb(null, null, { status: 200 }); }, 0); return { abort: function () {} }; }
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
