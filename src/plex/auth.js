/* N.auth – plex.tv: PIN-Anmeldung, Konto, Plex-Home-Profile, Profilwechsel, Server-Ressourcen (SPEC 7.1, 7.2, 15). */
(function (N) {
  var P = N.plex;
  function kindOf(u) {
    if (u.admin) return 'main';
    var rp = u.restrictionProfile;
    if (rp === 'teen') return 'teen';
    if (rp === 'little_kid' || rp === 'older_kid') return 'kid';
    return '';                           // auch verwaltete Konten mit eigenen Einschraenkungen (kein Kinderprofil)
  }
  var A = {
    /* strong = true: langer Code fuer die Anmeldeseite app.plex.tv/auth (N.WebLoginFlow); sonst 4 Zeichen fuer plex.tv/link */
    createPin: function (cb, strong) {
      return P.tv('POST', '/api/v2/pins', { strong: strong ? 'true' : 'false' }, null, { retries: 0 }, function (err, d) {
        if (err || !d || !d.code || !d.id) { cb(err || { type: 'parse' }); return; }
        cb(null, { id: d.id, code: String(d.code), expiresIn: d.expiresIn || 900 });
      });
    },
    checkPin: function (id, cb) {
      return P.tv('GET', '/api/v2/pins/' + id, null, null, { retries: 0, timeout: 8000 }, function (err, d) {
        if (err) { cb(err); return; }
        cb(null, d && d.authToken ? d.authToken : null);
      });
    },
    /* Offizielle Plex-Anmeldeseite fuer eine starke PIN (wie installer/neosetup/plextv.py auth_url; ohne forwardUrl) */
    webUrl: function (code) {
      var e = encodeURIComponent;
      return 'https://app.plex.tv/auth#?clientID=' + e(P.clientId || 'plexneo-unknown') + '&code=' + e(code) +
        '&context%5Bdevice%5D%5Bproduct%5D=' + e(N.config.product);
    },
    user: function (token, cb) {
      return P.tv('GET', '/api/v2/user', null, token, {}, function (err, d) {
        if (err || !d) { cb(err || { type: 'parse' }); return; }
        cb(null, { id: d.id, uuid: d.uuid, name: d.title || d.username || '', thumb: d.thumb || '', home: !!d.home, pinProtected: !!d['protected'] });
      });
    },
    normUsers: function (d) {
      var out = [], list = (d && d.users) || [];
      for (var i = 0; i < list.length; i++) {
        var u = list[i];
        if (u.guest) continue;
        out.push({ id: u.id, uuid: u.uuid, name: u.title || u.friendlyName || u.username || '?', thumb: u.thumb || '',
          admin: !!u.admin, restricted: !!u.restricted, rp: u.restrictionProfile || '', pin: !!u['protected'], kind: kindOf(u) });
      }
      return out;
    },
    homeUsers: function (token, cb) {
      return P.tv('GET', '/api/v2/home/users', null, token, {}, function (err, d) {
        if (err) { cb(err); return; }
        cb(null, A.normUsers(d));
      });
    },
    /* Profilwechsel; PIN wird nie gespeichert (SPEC 5.16). Ergebnis: Benutzer-Token des Profils.
     * Fehler mit err.wrongPin = true bei 400/403/422 (falsche PIN); 401 = Konto-Token ungueltig -> err.authExpired (kein Fehlversuch). */
    switchUser: function (accountToken, uuid, pin, cb) {
      var q = pin ? { pin: pin } : null;
      return P.tv('POST', '/api/v2/home/users/' + encodeURIComponent(uuid) + '/switch', q, accountToken, { retries: 0 }, function (err, d) {
        if (err) {
          if (err.type === 'http' && err.status === 401) err.authExpired = true;
          else if (err.type === 'http' && (err.status === 403 || err.status === 422 || err.status === 400)) err.wrongPin = true;
          cb(err); return;
        }
        var tok = d && (d.authToken || d.authenticationToken);
        if (!tok) { cb({ type: 'parse' }); return; }
        cb(null, tok);
      });
    },
    resources: function (token, cb) {
      return P.tv('GET', '/api/v2/resources', { includeHttps: 1, includeRelay: N.platform && N.platform.caps.tls12 ? 1 : 0, includeIPv6: 0 }, token, {}, function (err, d) {
        if (err) { cb(err); return; }
        cb(null, A.normServers(d));
      });
    },
    /* Server + Verbindungen (N.plexConn): ohne caps.tls12 (TV) nur http://adresse:port wie bisher; mit tls12 auch
     * https (plex.direct), lokal -> entfernt -> Relay (SPEC NET-7) */
    normServers: function (list) { return N.plexConn.normServers(list, N.platform && N.platform.caps); },
    /* Serverwahl: gemerkte machineId > Server mit Fallback-Adresse > eigener mit lokaler Verbindung > erster lokaler.
     * Ergebnis {name, machineId, uri, token} oder null */
    pickServer: function (servers, prefId, fallbackUri) {
      var i, j, s, pick = null, uri = null;
      function localUri(sv) { for (var k = 0; k < sv.conns.length; k++) if (sv.conns[k].local) return sv.conns[k].uri; return sv.conns.length ? sv.conns[0].uri : null; }
      for (i = 0; i < servers.length && !pick; i++) if (prefId && servers[i].machineId === prefId) pick = servers[i];
      for (i = 0; i < servers.length && !pick; i++) {
        s = servers[i];
        for (j = 0; j < s.conns.length; j++) if (s.conns[j].uri === fallbackUri) { pick = s; uri = fallbackUri; break; }
      }
      for (i = 0; i < servers.length && !pick; i++) if (servers[i].owned && localUri(servers[i])) pick = servers[i];
      for (i = 0; i < servers.length && !pick; i++) if (localUri(servers[i])) pick = servers[i];
      if (!pick) return null;
      if (!uri) {
        for (j = 0; j < pick.conns.length; j++) if (pick.conns[j].uri === fallbackUri) uri = fallbackUri;
        if (!uri) uri = localUri(pick);
      }
      return { name: pick.name, machineId: pick.machineId, uri: uri, token: pick.token };
    },
    /* Server-Token eines Profils: aus dessen Ressourcen-Liste der Eintrag mit unserer machineId; cb(err, token, servers) –
     * servers = die ganze Liste dieses Profils (Weitere Server auf Plattformen mit TLS 1.2, SRV-5) */
    serverTokenFor: function (userToken, machineId, cb) {
      return A.resources(userToken, function (err, servers) {
        if (err) { cb(err); return; }
        for (var i = 0; i < servers.length; i++) if (servers[i].machineId === machineId && servers[i].token) { cb(null, servers[i].token, servers); return; }
        cb({ type: 'noserver' }, null, servers);
      });
    }
  };
  N.auth = A;
})(N);
