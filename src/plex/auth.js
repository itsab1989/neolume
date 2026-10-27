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
    createPin: function (cb) {
      return P.tv('POST', '/api/v2/pins', { strong: 'false' }, null, { retries: 0 }, function (err, d) {
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
      return P.tv('GET', '/api/v2/resources', { includeHttps: 1, includeRelay: 0, includeIPv6: 0 }, token, {}, function (err, d) {
        if (err) { cb(err); return; }
        cb(null, A.normServers(d));
      });
    },
    normServers: function (list) {
      var out = [];
      for (var i = 0; list && i < list.length; i++) {
        var r = list[i];
        if (!r || String(r.provides || '').indexOf('server') < 0) continue;
        var conns = [];
        for (var j = 0; r.connections && j < r.connections.length; j++) {
          var c = r.connections[j];
          if (c.relay || c.IPv6 || !c.address) continue;
          // Der TV kann kein modernes TLS: lokale Verbindungen per http://adresse:port
          conns.push({ uri: 'http://' + c.address + ':' + (c.port || 32400), local: !!c.local });
        }
        out.push({ name: r.name || '', machineId: r.clientIdentifier, owned: !!r.owned, token: r.accessToken || null, conns: conns });
      }
      return out;
    },
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
    /* Server-Token eines Profils: aus dessen Ressourcen-Liste der Eintrag mit unserer machineId */
    serverTokenFor: function (userToken, machineId, cb) {
      return A.resources(userToken, function (err, servers) {
        if (err) { cb(err); return; }
        for (var i = 0; i < servers.length; i++) if (servers[i].machineId === machineId && servers[i].token) { cb(null, servers[i].token); return; }
        cb({ type: 'noserver' });
      });
    }
  };
  N.auth = A;
})(N);
