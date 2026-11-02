/* N.plexConn – Verbindungen zum Plex-Server (SPEC NET-7, SRV-5). Am Fernseher (ohne caps.tls12) ohne Wirkung: normServers
 * liefert dort genau das alte Ergebnis (http://address:port, lokal, ohne Relay/IPv6) und on() ist immer false.
 *
 * Mit caps.tls12 (Apple; docs/research/apple/05-net-requests.md 4):
 *  - plex.tv /api/v2/resources?includeHttps=1&includeRelay=1 meldet je Server nur https-Verbindungen (plex.direct-uri, auch die
 *    lokalen; geprueft an der echten Antwort 02.11.). Daraus: jede https-uri, dazu fuer lokale Verbindungen mit privater IPv4
 *    zusaetzlich http://address:port (Router mit DNS-Rebind-Schutz loesen *.plex.direct mit privater IP nicht auf). Nie http ins
 *    Internet, bei httpsRequired gar kein http, kein IPv6.
 *  - Reihenfolge: lokal (https vor http) -> entfernt direkt (https) -> Relay zuletzt; die zuletzt funktionierende Adresse zuerst
 *    innerhalb ihrer Gruppe. Im Mobilfunk erst entfernt, dann lokal (VPN nach Hause), dann Relay.
 *  - Jede Adresse wird zuerst mit GET /identity OHNE Token geprueft (machineIdentifier muss passen), erst dann bekommt sie
 *    das Token: beim Aktivieren eines Profils, bei jedem Netzwechsel ('net:changed') und wenn der Server nicht antwortet.
 *    Solange die Pruefung laeuft, warten Anfragen an den eigenen Server (N.plex.pms -> when). Gruppen werden parallel
 *    geprueft (Zeitgrenze lokal 1,5 s, sonst 5 s), die beste passende Adresse gewinnt.
 *  - plex.tv nur, wenn keine gemerkte Adresse antwortet (hoechstens alle 5 min), nie im Startpfad, wenn eine gemerkte geht. */
(function (N) {
  var U = N.util, NEAR = 1500, FAR = 5000, FRESH = 300000, DAY = 86400000, LATER = 15000, MAX_URIS = 8;
  function lanIp(h) {
    var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(h || ''));
    if (!m) return false;
    var a = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
    for (var i = 0; i < 4; i++) if (a[i] > 255) return false;
    return a[0] === 10 || a[0] === 127 || (a[0] === 172 && a[1] >= 16 && a[1] <= 31) || (a[0] === 192 && a[1] === 168) || (a[0] === 169 && a[1] === 254);
  }
  var HTTPS_URI = /^https:\/\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)(?::(\d{1,5}))?\/?$/i;
  function port(p) { var n = Number(p); return n > 0 && n < 65536 && n % 1 === 0 ? n : 32400; }
  function tls() { return !!(N.platform && N.platform.caps && N.platform.caps.tls12); }
  function add(out, seen, c) { if (!seen[c.uri]) { seen[c.uri] = 1; out.push(c); } }

  /* Verbindungen eines Servers aus plex.tv. Ohne tls12 genau wie bisher (auch doppelte Eintraege). */
  function connsOf(r, tls12) {
    var out = [], seen = {}, list = r.connections || [];
    for (var j = 0; j < list.length; j++) {
      var c = list[j];
      if (!c || c.IPv6 || !c.address) continue;
      if (!tls12) {
        if (c.relay) continue;
        out.push({ uri: 'http://' + c.address + ':' + (c.port || 32400), local: !!c.local });   // der TV kann kein modernes TLS
        continue;
      }
      if (c.protocol === 'https' || /^https:/i.test(String(c.uri || ''))) {
        var m = HTTPS_URI.exec(String(c.uri || ''));
        if (m && (!m[2] || port(m[2]) === Number(m[2])))
          add(out, seen, { uri: 'https://' + m[1].toLowerCase() + (m[2] ? ':' + Number(m[2]) : ''), local: !!c.local && !c.relay, https: true, relay: !!c.relay });
      }
      if (c.local && !c.relay && !r.httpsRequired && lanIp(c.address))       // http nur im Heimnetz (Token nie im Klartext ins Internet)
        add(out, seen, { uri: 'http://' + c.address + ':' + port(c.port), local: true, https: false, relay: false });
    }
    return tls12 ? order(out) : out;
  }
  /* Gruppe (0 lokal, 1 entfernt, 2 Relay) und darin https vor http */
  function grp(c) { return c.relay ? 2 : c.local ? 0 : 1; }
  function sub(c) { return c.https ? 0 : 1; }
  /* stabile Sortierung nach Gruppe; last = zuletzt funktionierende uri zuerst in IHRER Gruppe (nie vor einer besseren) */
  function order(conns, last, gk) {
    var a = [], i;
    gk = gk || grp;
    for (i = 0; i < conns.length; i++) a.push({ c: conns[i], i: i });
    a.sort(function (x, y) {
      return gk(x.c) - gk(y.c) || (x.c.uri === last ? -1 : y.c.uri === last ? 1 : 0) || sub(x.c) - sub(y.c) || x.i - y.i;
    });
    var out = [];
    for (i = 0; i < a.length; i++) out.push(a[i].c);
    return out;
  }
  /* Pruef-Gruppen nach Netzart: WLAN/LAN/unbekannt lokal -> entfernt -> Relay; Mobilfunk entfernt -> lokal (VPN) -> Relay; kein Netz: [] */
  function groups(conns, kind, last) {
    if (kind === 'none') return [];
    var o = order(conns, last), near = [], far = [], relay = [], out = [];
    for (var i = 0; i < o.length; i++) (o[i].relay ? relay : o[i].local ? near : far).push(o[i]);
    var g = kind === 'cell' ? [far, near, relay] : [near, far, relay];
    for (i = 0; i < g.length; i++) if (g[i].length) out.push(g[i]);
    return out;
  }
  function candidates(conns, kind, last) {
    var g = groups(conns, kind, last), out = [];
    for (var i = 0; i < g.length; i++) out = out.concat(g[i]);
    return out;
  }
  /* Netzart aus N.platform.net.path() bzw. 'net:changed' {status, wifi, cellular, wired} */
  function kindOf(p) {
    if (!p) return 'unknown';
    if (p.status === 'unsatisfied' || p.status === 'requiresConnection') return 'none';
    if (p.wired) return 'wired';
    if (p.wifi) return 'wlan';
    if (p.cellular) return 'cell';
    return 'unknown';
  }
  function identityOk(d, machineId) { return !!(machineId && d && d.MediaContainer && d.MediaContainer.machineIdentifier === machineId); }

  function normServers(list, caps) {
    var out = [], tls12 = !!(caps && caps.tls12);
    for (var i = 0; list && i < list.length; i++) {
      var r = list[i];
      if (!r || String(r.provides || '').indexOf('server') < 0) continue;
      var s = { name: r.name || '', machineId: r.clientIdentifier, owned: !!r.owned, token: r.accessToken || null, conns: connsOf(r, tls12) };
      if (tls12) s.httpsRequired = !!r.httpsRequired;
      out.push(s);
    }
    return out;
  }
  /* Weitere Server eines Profils aus dessen Ressourcen (nur tls12): fremde Server (owned=false, nicht der eigene) mit ihrem
   * Zugriffs-Token aus der Antwort -> Form wie setup.json (N.srv.setProfile). Reihenfolge fuer fremde Server: entfernt
   * direkt -> lokal (beim Freund zu Hause) -> Relay. */
  function friendGrp(c) { return c.relay ? 2 : c.local ? 1 : 0; }
  function others(servers, ownId) {
    var out = [];
    for (var i = 0; servers && i < servers.length; i++) {
      var s = servers[i];
      if (!s || s.owned || !s.machineId || s.machineId === ownId || !s.token || !s.conns || !s.conns.length) continue;
      var o = order(s.conns, '', friendGrp), uris = [];
      for (var j = 0; j < o.length && uris.length < MAX_URIS; j++) uris.push(o[j].uri);
      out.push({ machineId: s.machineId, name: s.name || '', uris: uris, token: s.token });
    }
    return out;
  }

  /* ---- Laufzeit: Adresse des eigenen Servers waehlen (nur tls12, ohne setup.json) ---- */
  var st = { busy: null, gen: 0, path: null, freshAt: 0, wired: false, laterT: 0 };
  function S() { return N.session; }
  function server() { var s = S(); return s && s.state && s.state.server; }
  function on() { var s = S(), sv = server(); return tls() && !!s && !s.pkg && !!sv && !!sv.machineId; }
  function kind() {
    var p = st.path || (N.platform && N.platform.net && N.platform.net.path ? N.platform.net.path() : null);
    return kindOf(p);
  }
  /* gemerkte Verbindungen (state.json server.conns, ohne Token); alter Stand ohne Liste: nur die gemerkte Adresse */
  function stored() {
    var sv = server();
    if (sv.conns && sv.conns.length) return sv.conns;
    var h = /^(https?):\/\/([^:/]+)/.exec(sv.uri || '');
    return h ? [{ uri: sv.uri, local: h[1] === 'http' || lanIp(h[2]), https: h[1] === 'https', relay: false }] : [];
  }
  function label(c) { return c.relay ? 'relay' : (c.local ? 'lokal-' : 'entfernt-') + (c.https ? 'https' : 'http'); }
  function probe(c, id, cb) {
    N.http.request({ url: c.uri + '/identity', headers: N.plex.headers(null), timeout: c.local ? NEAR : FAR, retries: 0, no401: true, dedupe: false, nowatch: true },
      function (err, d) { cb(!err && identityOk(d, id)); });
  }
  /* eine Gruppe parallel pruefen; Ergebnis = erste passende in Reihenfolge, sobald alle davor gescheitert sind */
  function race(list, id, g, cb) {
    var res = [], done = false, i;
    function settle() {
      if (done) return;
      for (var k = 0; k < list.length; k++) {
        if (res[k] === undefined) return;
        if (res[k]) { done = true; cb(list[k]); return; }
      }
      done = true; cb(null);
    }
    for (i = 0; i < list.length; i++) (function (k) { probe(list[k], id, function (ok) { if (g !== st.gen) return; res[k] = ok; settle(); }); })(i);
  }
  function finish(g, c, k) {
    if (g !== st.gen) return;
    var w = st.busy || [], sv = server();
    st.busy = null;
    if (c && sv) {
      if (N.plex.base !== c.uri) N.plex.setServer(c.uri, N.plex.token);   // Bilder, Video, alle Anfragen nutzen ab jetzt diese Basis
      if (sv.uri !== c.uri) { sv.uri = c.uri; S().save(); }
      if (N.net && N.net.offline && N.net.observe) N.net.observe(c.uri + '/identity', null);   // Leiste "Wieder verbunden"
    }
    if (N.log) N.log('plex conn (' + k + '): ' + (c ? label(c) : 'keine Adresse antwortet'));
    for (var i = 0; i < w.length; i++) w[i](!!c);
  }

  var C = {
    NEAR: NEAR, FAR: FAR, FRESH: FRESH,
    normServers: normServers, order: order, groups: groups, candidates: candidates, kindOf: kindOf, identityOk: identityOk,
    others: others, lanIp: lanIp,
    on: on,
    busy: function () { return !!st.busy; },
    /* Laeuft die Verbindung zum eigenen Server gerade ueber das Internet (entfernt direkt oder Relay)? Nur mit on(), sonst
     * (TV, setup.json) false; unbekannte Adresse = Heimnetz wie bisher. Player: location=wan + "Qualitaet ueber das Internet". */
    wan: function () {
      if (!on()) return false;
      var b = N.plex.base, l = stored();
      for (var i = 0; i < l.length; i++) if (l[i].uri === b) return !l[i].local;
      return false;
    },
    /* Netz gerade Mobilfunk (path.cellular, ohne WLAN/Kabel)? Player: "Qualitaet ueber Mobilfunk" */
    cell: function () { return kind() === 'cell'; },
    /* fn, sobald die laufende Pruefung fertig ist (sonst sofort) */
    when: function (fn) { if (st.busy) st.busy.push(function () { fn(); }); else fn(); },
    /* Adresse waehlen. why: Protokoll ('start'|'net'|'offline'|'retry'). cb(ok). Eine neue Pruefung ersetzt eine laufende
     * (Wartende bleiben in der Liste und bekommen das Ergebnis der neuen). */
    check: function (why, cb) {
      if (!on()) { if (cb) cb(false); return; }
      var g = ++st.gen, sv = server(), id = sv.machineId, k = kind(), fresh = false, tried = {};
      if (!st.busy) st.busy = [];
      if (cb) st.busy.push(cb);
      var gs = groups(stored(), k, sv.uri), i = 0;
      function step() {
        if (g !== st.gen) return;
        if (i >= gs.length) { refresh(); return; }
        var list = gs[i++];
        for (var j = 0; j < list.length; j++) tried[list[j].uri] = 1;
        race(list, id, g, function (c) { if (g !== st.gen) return; if (c) finish(g, c, why + '/' + k); else step(); });
      }
      /* keine gemerkte Adresse antwortet: einmal frische Verbindungen von plex.tv (Ausnahme von PRIN-12) */
      function refresh() {
        var s = S(), tok = s.state.account && s.state.account.token;
        if (fresh || k === 'none' || !tok || U.now() - st.freshAt < FRESH) { finish(g, null, why + '/' + k); return; }
        fresh = true; st.freshAt = U.now();
        N.auth.resources(tok, function (err, servers) {
          if (g !== st.gen) return;
          if (!err && servers) s.takeServers(s.state.account.uuid, servers, true);
          var nw = [], cur = server().conns || [];
          for (var j = 0; j < cur.length; j++) if (!tried[cur[j].uri]) nw.push(cur[j]);
          if (err || !nw.length) { finish(g, null, why + '/' + k); return; }
          gs = groups(nw, k, ''); i = 0; step();
        });
      }
      step();
    },
    /* Profil aktiv (session.activate): gemerkte Adressen pruefen (ohne plex.tv), Netzwechsel beobachten, Verbindungsliste
     * hoechstens einmal am Tag spaeter im Hintergrund auffrischen (nicht im Startpfad) */
    start: function () {
      if (!on()) return;
      if (!st.wired && N.evt) {
        st.wired = true;
        N.evt.on('net:changed', function (d) { st.path = d || null; if (on() && N.session.profile) C.check('net'); });
        N.evt.on('net:offline', function () { if (on() && !st.busy) C.check('offline'); });
      }
      C.check('start');
      if (st.laterT) clearTimeout(st.laterT);
      st.laterT = setTimeout(function () {
        st.laterT = 0;
        var sv = server();
        if (on() && sv && (!sv.connsTs || U.now() - sv.connsTs > DAY) && N.session.refreshServers) N.session.refreshServers();
      }, LATER);
    },
    _reset: function () { st = { busy: null, gen: 0, path: null, freshAt: 0, wired: st.wired, laterT: 0 }; }
  };
  N.plexConn = C;
})(N);
