/* N.srv – "Weitere Server": Plex-Server, die ANDERE fuer dieses Profil freigegeben haben (z. B. der Server eines Freundes;
 * Nutzerwunsch 27.10., docs/research/other-servers.md). Optional: nur, wenn das Einrichtungsprogramm sie in setup.json
 * eingetragen hat (je Profil `servers`, eigener Zugang dieses Profils, nie fremde Tokens). Der eigene Server bleibt davon
 * unberuehrt: N.plex.base/token zeigen immer auf ihn, alles hier ist ein zusaetzlicher Weg.
 *
 * - Verbindung: nur http (der TV kann hoechstens TLS 1.1, plex.direct-https geht nicht) -> klappt nur, wenn beim fremden
 *   Server "Sichere Verbindungen: Bevorzugt" eingestellt ist (das Einrichtungsprogramm prueft und erklaert es).
 * - Adressen: alle http-Kandidaten aus setup.json; der zuletzt funktionierende zuerst (srv-<profil>.json, ohne Token).
 *   Jede Adresse wird erst mit GET /identity OHNE Token geprueft (machineIdentifier muss passen), erst dann geht das Token
 *   dorthin. Keine passt: Zustand 'down' (nur dieser Server; Bibliothek zeigt eine Meldung), neuer Versuch fruehestens nach
 *   RETRY. Mit Helfer (Funktion 'servers') werden frische Adressen von plex.tv geholt (GET /servers am Helfer).
 * - Eintraege tragen ihren Server: it.srv = machineIdentifier. Bildpfade solcher Eintraege tragen eine Marke
 *   '@<machineId>|<pfad>' (N.img.url loest sie auf). N.model.norm setzt beides, solange eine Antwort dieses Servers
 *   verarbeitet wird (N.plex.pms setzt dafuer den Kontext `cur` um den Rueckruf; s. client.js).
 * - Speicher-Schluessel, die nur die ratingKey/Bibliotheks-ID kennen (Spurwahl, Anime-Markierung, Bibliotheks-Ansicht), bekommen
 *   fuer fremde Eintraege ein Praefix (N.srv.skey), damit sie nicht mit gleichen Nummern des eigenen Servers kollidieren. */
(function (N) {
  var U = N.util, IDT = 5000, LIBT = 20000, RETRY = 30000, MAX_LIBS = 7, TIMEOUT = 25000;   // TV-Test 1.0.4: Internet-Latenz
  var list = [], byId = {}, uuid = '', ctx = '', gen = 0, startT = 0;

  function now() { return U.now(); }
  function file() { return 'srv-' + uuid + '.json'; }
  function cache() { var c = uuid && N.store ? N.store.get(file()) : null; return c && c.v === 1 && c.s && typeof c.s === 'object' ? c : { v: 1, s: {} }; }
  function remember(sv) {
    if (!uuid) return;
    var c = cache();
    c.s[sv.id] = { uri: sv.base || (c.s[sv.id] && c.s[sv.id].uri) || '', libs: sv.libs, ts: now() };
    for (var k in c.s) if (!byId[k]) delete c.s[k];               // Server, die nicht mehr in setup.json stehen
    N.store.set(file(), c);
  }
  function changed() { if (N.evt) N.evt.emit('srv:changed', {}); }
  /* Bibliotheken aus /library/sections (Film, Serie, Musik/Hoerbuecher wie beim eigenen Server, max. 7 je Server) */
  function libsOf(json) {
    var l = N.hubs ? N.hubs.allLibraries(json) : [], out = [];
    for (var i = 0; i < l.length && out.length < MAX_LIBS; i++) out.push({ id: l[i].id, title: l[i].title, type: l[i].type, kind: l[i].kind });
    return out;
  }
  function cleanLibs(a) {
    var out = [];
    for (var i = 0; a && i < a.length && out.length < MAX_LIBS; i++) {
      var l = a[i];
      if (l && typeof l.id === 'number' && typeof l.title === 'string' && (l.type === 'movie' || l.type === 'show' || l.type === 'artist'))
        out.push({ id: l.id, title: l.title.substring(0, 64), type: l.type, kind: typeof l.kind === 'string' ? l.kind : l.type });
    }
    return out;
  }

  var S = {
    RETRY: RETRY, TIMEOUT: TIMEOUT,
    /* Protokollzeile je Anfrage an einen weiteren Server (Pfad ohne Query/Token): Dauer, Versuche, Ergebnis – zum Pruefen am TV */
    timing: function (id, method, path, err, meta) {
      var sv = byId[id];
      N.log('srv ' + (sv ? sv.name : '?') + ' ' + method + ' ' + String(path).split('?')[0] + ' -> ' + (err ? (err.type || 'err') + (err.status ? ' ' + err.status : '') : 'ok') +
        (meta ? ' ' + meta.ms + ' ms' + (meta.tries > 1 ? ' (' + meta.tries + ' Versuche)' : '') : ''));
    },
    /* Profil aktiv (session.activate): Server dieses Profils aus setup.json; Bibliotheken sofort aus dem Speicher (Seitenleiste),
     * Pruefung der Adressen spaeter im Hintergrund (start). servers: [{machineId, name, uris, token}] */
    setProfile: function (servers, profileUuid) {
      gen++; list = []; byId = {}; uuid = profileUuid || ''; ctx = '';
      if (startT) { clearTimeout(startT); startT = 0; }
      var c = cache();
      for (var i = 0; servers && i < servers.length; i++) {
        var s = servers[i], m = c.s[s.machineId] || {}, uris = s.uris.slice(0);
        if (m.uri && uris.indexOf(m.uri) > 0) { uris.splice(uris.indexOf(m.uri), 1); uris.unshift(m.uri); }   // zuletzt funktionierende zuerst
        var sv = { id: s.machineId, name: s.name || '', uris: uris, token: s.token, base: '', state: 'idle', at: 0, busy: null,
          libs: cleanLibs(m.libs) };
        list.push(sv); byId[sv.id] = sv;
      }
      changed();
    },
    has: function () { return list.length > 0; },
    list: function () { return list; },
    get: function (id) { return id && byId[id] || null; },
    name: function (id) { var sv = byId[id]; return sv ? sv.name : ''; },
    state: function (id) { var sv = byId[id]; return sv ? sv.state : 'none'; },
    /* Bibliotheken aller weiteren Server fuer Seitenleiste/"Seitenleiste anpassen": {id, title, type, kind, srv, srvName}.
     * Auch bei 'down' aus dem Speicher (die Bibliothek erklaert dann den Ausfall); Zugang abgelehnt ('auth') -> keine. */
    libs: function () {
      var out = [];
      for (var i = 0; i < list.length; i++) {
        var sv = list[i];
        if (sv.state === 'auth') continue;
        for (var j = 0; j < sv.libs.length; j++) out.push(U.extend(U.extend({}, sv.libs[j]), { srv: sv.id, srvName: sv.name }));
      }
      return out;
    },
    /* Anfrage-Optionen fuer diesen Server (leer/'' = eigener Server: unveraendert) */
    o: function (id, opts) { if (!id) return opts; var o = U.extend({}, opts || {}); o.srv = id; return o; },
    /* fuer N.plex.write (verzoegerte Schreibzugriffe): wie N.plex.target() */
    who: function (id) { return id ? { srv: id } : null; },   // nie auf den eigenen Server zurueckfallen (unbekannt -> Fehler)
    /* aktuelle Verbindung {base, token} oder null (nicht erreichbar / noch nicht geprueft -> Pruefung anstossen) */
    conn: function (id) {
      var sv = byId[id];
      if (!sv) return null;
      if (sv.base) return { base: sv.base, token: sv.token };
      if (!sv.busy && sv.state !== 'auth' && now() - sv.at >= RETRY) S.resolve(id);
      return null;
    },
    /* fn, sobald klar ist, ob der Server erreichbar ist (Adresse bekannt: sofort; Pruefung laeuft/steht an: danach; gerade
     * ausgefallen bzw. Zugang abgelehnt: im naechsten Takt, ohne neue Pruefung vor Ablauf von RETRY). Nie synchron ohne Adresse. */
    when: function (id, fn) {
      var sv = byId[id];
      if (sv && sv.base) { fn(); return; }
      if (!sv || sv.state === 'auth' || (!sv.busy && sv.state === 'down' && now() - sv.at < RETRY)) { setTimeout(fn, 0); return; }
      S.resolve(id, false, function () { fn(); });
    },
    /* Bildpfad mit Server-Marke; tp: mit dem gerade verarbeiteten Server (Kontext), sonst unveraendert */
    tag: function (id, p) { return id && p && p.charAt(0) !== '@' ? '@' + id + '|' + p : p; },
    tp: function (p) { return S.tag(ctx, p); },
    untag: function (p) {
      if (typeof p !== 'string' || p.charAt(0) !== '@') return null;
      var i = p.indexOf('|');
      return i > 1 ? { id: p.substring(1, i), path: p.substring(i + 1) } : null;
    },
    cur: function () { return ctx; },
    /* Rueckruf mit Kontext "Antwort von Server id" (N.model.norm markiert dann Eintraege und Bildpfade) */
    wrap: function (id, cb) {
      return function () {
        var prev = ctx; ctx = id;
        try { return cb.apply(this, arguments); } finally { ctx = prev; }
      };
    },
    /* Speicher-Schluessel fuer Eintraege fremder Server (ratingKey/Bibliotheks-ID allein waere mehrdeutig) */
    skey: function (id, k) { return id ? 'x' + String(id).substring(0, 12) + ':' + k : k; },
    /* Netzfehler einer Anfrage an diesen Server. Ein einzelnes Zeitlimit (langsame Anfrage uebers Internet, z. B. Untertitel-Suche)
     * heisst nicht "Server weg": dann erst /identity kurz pruefen (Review). Echter Netzfehler -> Adresse vergessen, beim naechsten
     * Zugriff (nach RETRY) neu suchen. */
    failed: function (id, err) {
      var sv = byId[id];
      if (!sv || !err || (err.type !== 'network' && err.type !== 'timeout') || !sv.base || sv.checking) return;
      // TV-Test 1.0.4: eine einzelne fehlgeschlagene Anfrage (langsam, am TV als "network" gemeldetes Zeitlimit) ist kein Ausfall.
      // Erst /identity pruefen (mit einer Wiederholung); nur wenn der Server auch darauf nicht antwortet: 'down'.
      var base = sv.base, g = gen;
      sv.checking = true;
      N.http.request({ url: base + '/identity', headers: N.plex.headers(null), timeout: IDT * 2, retries: 1, no401: true, dedupe: false, nowatch: true },
        function (e, d) {
          sv.checking = false;
          if (g !== gen || sv.base !== base) return;
          if (!e && d && d.MediaContainer && d.MediaContainer.machineIdentifier === sv.id) { N.log('srv ' + sv.name + ': Anfrage fehlgeschlagen (' + err.type + '), Server antwortet – bleibt verbunden'); return; }
          N.log('srv ' + sv.name + ': Verbindung verloren (' + err.type + ', /identity ' + (e ? e.type : 'falsch') + ')');
          sv.base = ''; sv.state = 'down'; sv.at = now();
          changed();
        });
    },
    /* Meldung fuer Ansichten (Bibliothek, Details, Album, Kuenstler): nicht erreichbar bzw. kein Zugang – nur fuer diesen Server */
    errText: function (id, err) {
      var n = S.name(id), auth = S.state(id) === 'auth' || !!(err && (err.status === 401 || err.status === 403));
      return { title: N.t(auth ? 'srv.err.auth.title' : 'srv.err.down.title', { server: n }), text: N.t(auth ? 'srv.err.auth.text' : 'srv.err.down.text', { server: n }) };
    },
    /* Adressen pruefen: /identity ohne Token (machineIdentifier muss passen), dann /library/sections mit Token.
     * force: auch vor Ablauf von RETRY (Knopf "Erneut versuchen"). cb(state) */
    resolve: function (id, force, cb) {
      var sv = byId[id], g = gen;
      cb = cb || function () {};
      if (!sv) { cb('none'); return; }
      if (sv.busy) { sv.busy.push(cb); return; }
      if (!force && sv.base) { cb(sv.state); return; }
      sv.busy = [cb]; sv.at = now();
      if (!sv.base) { sv.state = 'probe'; }
      var k = 0, tried = {}, helperAsked = false;
      function fin(state) {
        if (g !== gen) { var w = sv.busy || []; sv.busy = null; for (var j = 0; j < w.length; j++) w[j]('none'); return; }   // Profil gewechselt: Wartende nicht haengen lassen
        sv.state = state; sv.at = now();
        if (state === 'ok' || state === 'down') remember(sv);
        N.log('srv ' + sv.name + ': ' + state);
        var l = sv.busy; sv.busy = null;
        changed();
        for (var i = 0; i < l.length; i++) l[i](state);
      }
      function libs(uri) {
        N.http.request({ url: uri + '/library/sections', headers: N.plex.headers(sv.token), timeout: LIBT, retries: 0, no401: true, dedupe: false, nowatch: true },
          function (err, d) {
            if (g !== gen) { fin(); return; }   // Profil gewechselt: fin benachrichtigt die Wartenden (sonst haengen sie)
            if (err && (err.status === 401 || err.status === 403)) { sv.base = ''; fin('auth'); return; }   // Freigabe entzogen / Token ungueltig
            sv.base = uri;
            if (!err && d && d.MediaContainer) sv.libs = libsOf(d);
            fin('ok');
          });
      }
      function next() {
        if (g !== gen) { fin(); return; }
        while (k < sv.uris.length && tried[sv.uris[k]]) k++;
        if (k >= sv.uris.length) { fromHelper(); return; }
        var uri = sv.uris[k++];
        tried[uri] = 1;
        N.http.request({ url: uri + '/identity', headers: N.plex.headers(null), timeout: IDT, retries: 0, no401: true, dedupe: false, nowatch: true },
          function (err, d) {
            var mid = !err && d && d.MediaContainer && d.MediaContainer.machineIdentifier;
            if (mid === sv.id) libs(uri); else next();
          });
      }
      /* optional: frische Adressen ueber den Helfer (plex.tv); nur einmal je Pruefung, nie ein Token an den Helfer */
      function fromHelper() {
        if (helperAsked || !N.disc || !N.disc.helper || !N.disc.helper()) { sv.base = ''; fin('down'); return; }
        helperAsked = true;
        N.disc.probeHelper(function (ok) {
          if (!ok || !N.disc.helperHas('servers')) { sv.base = ''; fin('down'); return; }
          N.disc.helperGet('/servers', function (err, d) {
            var add = err ? [] : S.helperUris(d, sv.id), n = 0;
            for (var i = 0; i < add.length; i++) if (sv.uris.indexOf(add[i]) < 0) { sv.uris.push(add[i]); n++; }
            if (n) N.log('srv ' + sv.name + ': ' + n + ' neue Adresse(n) vom Helfer');
            next();
          });
        });
      }
      next();
    },
    /* Antwort des Helfers GET /servers {servers:[{id, uris:[...]}]} -> gepruefte http-Adressen fuer diesen Server */
    helperUris: function (d, id) {
      var l = d && d.servers, out = [];
      for (var i = 0; l && i < l.length; i++) {
        if (!l[i] || l[i].id !== id || !l[i].uris) continue;
        for (var j = 0; j < l[i].uris.length && out.length < 8; j++) { var u = N.setupFile.netUri(l[i].uris[j]); if (u && out.indexOf(u) < 0) out.push(u); }
      }
      return out;
    },
    /* alle Server im Hintergrund pruefen (nach dem Start der Startseite, nicht im Startpfad) */
    start: function (delay) {
      if (startT) clearTimeout(startT);
      if (!list.length) return;
      var g = gen;
      startT = setTimeout(function () { startT = 0; if (g !== gen) return; for (var i = 0; i < list.length; i++) S.resolve(list[i].id); }, delay === undefined ? 2500 : delay);
    },
    /* erreichbar? (Player "Verbindung unterbrochen" bei Titeln dieses Servers) cb(ok) */
    ping: function (id, cb) {
      var sv = byId[id];
      if (!sv) { cb(false); return; }
      S.resolve(id, true, function (st) { cb(st === 'ok'); });
    },
    _reset: function () { gen++; list = []; byId = {}; uuid = ''; ctx = ''; if (startT) { clearTimeout(startT); startT = 0; } }
  };
  N.srv = S;
})(N);
