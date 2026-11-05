/* N.ptv – plex.tv direkt (Plattform-Faehigkeit caps.plexTvDirect, z. B. Apple): Merkliste, Entdecken-Reihen ("Gerade beliebt /
 * Neu erschienen / Bald verfuegbar") und Details fremder Titel OHNE Helfer. Das Modul ist der Helfer in der App: es nimmt
 * dieselben festen Routen wie installer/neosetup/helper.py (GET /watchlist, /watchlist/state, PUT/DELETE /watchlist/<hex>,
 * GET /discover/<liste>, /details) und liefert dieselben gekuerzten Antworten – N.disc/N.insp bleiben unveraendert.
 * Regeln wie der Helfer (SPEC SEC-5, DISC-4/5): jede Ziel-Adresse steht in UPSTREAM (Host + Methode + ganzer Pfad + erlaubte
 * Abfrage-Schluessel), nur https ohne Port/Anmeldedaten/Fragment; Antwort hoechstens MAX_UPSTREAM Zeichen; nur gelistete Felder
 * (slim/detailsSlim), Bilder nur von bekannten Bild-Hosts ohne "token" (safeImg; die App laedt sie wie am TV ueber den
 * Foto-Umrechner des PMS); Seitengroesse hoechstens PLEX_PAGE_MAX; Zwischenspeicher wie der Helfer (Listen 15 min, Merkliste 60 s,
 * Details 6 h). Token: plex.tv-Token des aktiven Profils (Kontoinhaber = Konto-Token; Plex-Home-Profil = Token aus dem
 * Profilwechsel, nur im Speicher, nie gespeichert, nie im Protokoll); nicht persoenliche Listen/Details notfalls mit dem
 * Konto-Token (wie der Helfer mit dem Token des Inhabers). Reine Funktionen spiegeln helper.py und werden mit derselben Vorlage
 * geprueft (tests/synthetic/plextv-slim.json: tests/plextv.test.js und tests/installer/test_helper.py). Am TV ohne Wirkung. */
(function (N) {
  var U = N.util;
  var DISCOVER = 'discover.provider.plex.tv', METADATA = 'metadata.provider.plex.tv', PLEX_TV = 'plex.tv';
  var PAGING = ['X-Plex-Container-Start', 'X-Plex-Container-Size'];
  /* vollstaendige Ziel-Liste – gleich UPSTREAM in helper.py (Methode, Host, Pfad-Regex, erlaubte Abfrage-Schluessel) */
  var UPSTREAM = [
    ['GET', DISCOVER, /^\/library\/sections\/watchlist\/all$/, ['type', 'includeCollections', 'includeExternalMedia'].concat(PAGING)],
    ['PUT', DISCOVER, /^\/actions\/(addToWatchlist|removeFromWatchlist)$/, ['ratingKey']],
    ['GET', DISCOVER, /^\/library\/metadata\/[0-9a-f]{24}(,[0-9a-f]{24}){0,29}\/userState$/, []],
    ['GET', DISCOVER, /^\/hubs\/sections\/home\/(top_watchlisted|recently-released-family|coming-soon)$/, PAGING],
    ['GET', METADATA, /^\/library\/metadata\/[0-9a-f]{24}$/, []],
    ['GET', METADATA, /^\/library\/metadata\/[0-9a-f]{24}\/children$/, PAGING],
    ['GET', PLEX_TV, /^\/api\/v2\/resources$/, ['includeHttps', 'includeRelay', 'includeIPv6']]
  ];
  var LISTS = {
    trending: { hubs: ['top_watchlisted'], when: null },
    'new': { hubs: ['top_watchlisted', 'recently-released-family'], when: 'past' },
    soon: { hubs: ['coming-soon'], when: 'future' }
  };
  var IMG_HOSTS = ['images.plex.tv', 'metadata-static.plex.tv', 'image.tmdb.org', 'artworks.thetvdb.com'];
  var HEX = /^[0-9a-f]{24}$/, GUID = /^plex:\/\/(movie|show)\/([0-9a-f]{24})$/, DAY = /^\d{4}-\d{2}-\d{2}\n?$/;
  var WL_TYPE = { all: 0, movie: 1, show: 2 }, LANGS = { de: 1, en: 1, nb: 1 };
  var ROUTE_KEYS = { '/watchlist': ['type', 'start', 'size'], '/watchlist/state': ['ids'], item: [], discover: ['type', 'size'], '/details': ['id', 'lang'] };
  var cache = {}, ncache = 0, wait = {}, toks = { acc: '', map: {} };

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isArr(v) { return Object.prototype.toString.call(v) === '[object Array]'; }
  function isObj(v) { return !!v && typeof v === 'object' && !isArr(v); }
  function str(v, n) { return typeof v === 'string' ? v.slice(0, n) : ''; }
  function num(v, lo, hi) { return typeof v === 'number' && isFinite(v) && v >= lo && v <= hi ? v : 0; }
  function day(v) { return typeof v === 'string' && DAY.test(v) ? v.slice(0, 10) : ''; }
  function fail(status, code) { return { type: 'http', status: status, body: { error: code } }; }
  /* Datum (UTC) als JJJJ-MM-TT; ms = Zeitpunkt */
  function ymd(ms) { var d = new Date(ms); function p(x) { return (x < 10 ? '0' : '') + x; } return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()); }
  /* https-Adresse zerlegen; null = keine einfache https-Adresse (Leerraum, Anmeldedaten, Port – strenger als urlsplit) */
  function split(url) {
    if (typeof url !== 'string' || /[\s\x00-\x1f\x7f\\]/.test(url)) return null;
    var m = /^https:\/\/([^\/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(url);
    if (!m || !m[1] || /[@:\[\]]/.test(m[1])) return null;
    return { host: m[1].toLowerCase(), path: m[2], query: m[3] ? m[3].slice(1) : '', frag: m[4] !== undefined };
  }
  /* Abfrage -> Schluessel-Liste (wie parse_qsl strict); null = kaputt */
  function qsKeys(q) {
    if (!q) return [];
    var parts = q.split('&'), out = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i], e = p.indexOf('=');
      if (e < 0) return null;
      try { out.push(decodeURIComponent(p.slice(0, e).replace(/\+/g, ' '))); } catch (x) { return null; }
    }
    return out;
  }

  var P = {
    UPSTREAM: UPSTREAM, LISTS: LISTS, IMG_HOSTS: IMG_HOSTS,
    MAX_UPSTREAM: 262144, MAX_ITEMS: 50, PLEX_PAGE_MAX: 100, HUB_SIZE: 60, NEW_DAYS: 180, TIMEOUT: 10000,
    TTL: { discover: 900000, watchlist: 60000, details: 6 * 3600000 },
    /* Faehigkeiten wie /neo-helper "features" – nur, was dieser Weg kann (keine Weitere-Server-Adressen, kein Live, kein update) */
    FEATURES: ['watchlist', 'discover', 'details', 'nb'],
    /* an? Plattform kann es (caps.plexTvDirect), kein setup.json (dann nie plex.tv), Konto angemeldet */
    on: function () {
      var S = N.session, c = N.platform && N.platform.caps;
      return !!(c && c.plexTvDirect && S && S.state && !S.pkg && S.state.account && S.state.account.token);
    },
    /* ---------- reine Logik (gleich helper.py) ---------- */
    /* upstream_allowed: nur https-Adressen der Liste (Host, Methode, ganzer Pfad, bekannte Abfrage-Schluessel) */
    allowed: function (method, url) {
      var p = split(url), keys, i, j;
      if (!p || p.frag) return false;
      keys = qsKeys(p.query);
      if (!keys) return false;
      for (i = 0; i < UPSTREAM.length; i++) {
        var u = UPSTREAM[i];
        if (u[0] !== method || u[1] !== p.host || !u[2].test(p.path)) continue;
        for (j = 0; j < keys.length; j++) if (u[3].indexOf(keys[j]) < 0) return false;
        return true;
      }
      return false;
    },
    /* safe_img: https auf bekannten Bild-Hosts, ohne Anmeldedaten/Port, ohne "token" in der Abfrage, hoechstens 600 Zeichen */
    safeImg: function (url) {
      if (typeof url !== 'string' || url.length > 600) return '';
      var p = split(url);
      if (!p || IMG_HOSTS.indexOf(p.host) < 0 || p.query.toLowerCase().indexOf('token') >= 0) return '';
      return url;
    },
    /* slim: Metadata-Eintrag -> {id, type, guid, title, year, summary, thumb, date} oder null (nur Film/Serie mit Plex-GUID) */
    slim: function (md) {
      if (!isObj(md)) return null;
      var m = typeof md.guid === 'string' ? GUID.exec(md.guid) : null;
      if (!m || md.type !== m[1]) return null;
      var title = str(md.title, 200), y = md.year;
      if (!title) return null;
      return { id: m[2], type: m[1], guid: m[0], title: title, year: typeof y === 'number' && y % 1 === 0 && y > 1800 && y < 2200 ? y : 0,
        summary: str(md.summary, 600), thumb: P.safeImg(md.thumb), date: day(md.originallyAvailableAt) };
    },
    pub: function (it) { return { id: it.id, type: it.type, guid: it.guid, title: it.title, year: it.year, summary: it.summary, thumb: it.thumb }; },
    /* metadata_list: Antworttext -> {md: [...], total} oder null (kaputt) */
    metadataList: function (txt) {
      var d = typeof txt === 'string' ? U.parse(txt) : txt, mc = isObj(d) ? d.MediaContainer : null;
      if (!isObj(mc)) return null;
      var total = has(mc, 'totalSize') ? mc.totalSize : has(mc, 'size') ? mc.size : 0;
      return { md: isArr(mc.Metadata) ? mc.Metadata : [], total: typeof total === 'number' && total % 1 === 0 ? total : 0 };
    },
    /* pick: Typ, Zeitfenster (past = letzte NEW_DAYS Tage bis heute, neueste zuerst; future = nicht vor heute, naechste zuerst),
     * nach id dedupliziert, hoechstens size. today 'JJJJ-MM-TT' (UTC) */
    pick: function (items, type, when, today, size) {
      var out = [], seen = {}, t = today.split('-'), lo = ymd(Date.UTC(+t[0], +t[1] - 1, +t[2]) - P.NEW_DAYS * 86400000), i;
      for (i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it || seen[it.id] || (type && it.type !== type)) continue;
        var d = it.date;
        if (when === 'past' && !(d && lo <= d && d <= today)) continue;
        if (when === 'future' && d && d < today) continue;
        seen[it.id] = 1; out.push({ it: it, n: out.length });
      }
      function key(x) { return when === 'future' ? x.it.date || '9999' : x.it.date; }
      if (when) out.sort(function (a, b) { var ka = key(a), kb = key(b); return ka === kb ? a.n - b.n : (when === 'past' ? ka < kb : ka > kb) ? 1 : -1; });
      var res = [];
      for (i = 0; i < out.length && res.length < size; i++) res.push(out[i].it);
      return res;
    },
    /* _tags: Tag-Liste (Genre/Director/…) -> hoechstens n Namen */
    tags: function (l, n, size) {
      var out = [];
      if (!isArr(l)) return out;
      for (var i = 0; i < l.length; i++) {
        var name = str(isObj(l[i]) ? l[i].tag : null, size === undefined ? 80 : size);
        if (name && out.indexOf(name) < 0) out.push(name);
        if (out.length >= n) break;
      }
      return out;
    },
    /* details_slim: ganzer Katalog-Eintrag -> gekuerzte Details (nur gelistete Felder, Grenzen, Bilder nur bekannter Hosts) */
    detailsSlim: function (md) {
      var base = P.slim(md);
      if (!base) return null;
      var d = P.pub(base), i;
      d.summary = str(md.summary, 1500);
      d.tagline = str(md.tagline, 200);
      d.date = base.date;
      d.art = P.safeImg(md.art);
      d.contentRating = str(md.contentRating, 20);
      d.duration = Math.floor(num(md.duration, 0, 100 * 3600 * 1000));
      d.rating = Math.round((num(md.audienceRating, 0, 10) || num(md.rating, 0, 10)) * 10) / 10;
      d.studio = str(md.studio, 100);
      d.genres = P.tags(md.Genre, 5, 40);
      d.network = P.tags(md.Network, 1, 60)[0] || '';
      d.directors = P.tags(md.Director, 3);
      d.writers = P.tags(md.Writer, 3);
      var cast = [], roles = isArr(md.Role) ? md.Role : [];
      for (i = 0; i < roles.length; i++) {
        var name = str(isObj(roles[i]) ? roles[i].tag : null, 80);
        if (!name) continue;
        cast.push({ name: name, role: str(roles[i].role, 80), thumb: P.safeImg(roles[i].thumb) });
        if (cast.length >= 15) break;
      }
      d.cast = cast;
      if (base.type === 'show') {
        d.seasons = Math.floor(num(md.childCount, 0, 1000));
        d.episodes = Math.floor(num(md.leafCount, 0, 100000));
        d.continuing = typeof md.isContinuingSeries === 'boolean' ? md.isContinuingSeries : null;
        d.lastAired = day(md.lastEpisodeOriginallyAvailableAt);
      }
      var ids = {}, gl = isArr(md.Guid) ? md.Guid : [];
      for (i = 0; i < gl.length; i++) {
        var g = /^(?:(tmdb|tvdb):\/\/(\d{1,10})|(imdb):\/\/(tt\d{1,10}))\n?$/.exec(String(isObj(gl[i]) ? gl[i].id : ''));
        if (g && g[1]) ids[g[1]] = parseInt(g[2], 10);
        else if (g) ids.imdb = g[4];
      }
      d.ids = ids;
      return d;
    },
    /* userState-Antwort -> {ids: {hex: bool}} fuer genau die gefragten ids */
    stateOf: function (json, ids) {
      var mc = isObj(json) ? json.MediaContainer : null, us = isObj(mc) ? mc.UserState : null, on = {}, i;
      if (isObj(us)) us = [us];
      for (i = 0; i < ids.length; i++) on[ids[i]] = false;
      for (i = 0; isArr(us) && i < us.length; i++) {
        var u = us[i];
        if (isObj(u) && typeof u.ratingKey === 'string' && has(on, u.ratingKey)) on[u.ratingKey] = !!u.watchlistedAt;
      }
      return { ids: on };
    },
    /* Helfer-Route pruefen (gleich helper.py _route/check_keys/q_int/q_choice/q_ids) -> {r, …} oder {err} */
    parse: function (method, raw) {
      var qi = raw.indexOf('?'), path = qi < 0 ? raw : raw.slice(0, qi), qs = qi < 0 ? '' : raw.slice(qi + 1), q = {}, i;
      if (qs.length > 1024) return { err: fail(400, 'query') };
      if (qs) {
        var parts = qs.split('&');
        for (i = 0; i < parts.length; i++) {
          var e = parts[i].indexOf('='), k, v;
          if (e < 0) return { err: fail(400, 'query') };
          try { k = decodeURIComponent(parts[i].slice(0, e).replace(/\+/g, ' ')); v = decodeURIComponent(parts[i].slice(e + 1).replace(/\+/g, ' ')); } catch (x) { return { err: fail(400, 'query') }; }
          if (has(q, k)) return { err: fail(400, 'query') };
          q[k] = v;
        }
      }
      var route = ROUTE_KEYS[path] ? path : path.indexOf('/watchlist/') === 0 ? 'item' : path.indexOf('/discover/') === 0 ? 'discover' : '';
      if (!route) return { err: fail(404, 'route') };
      for (var qk in q) if (has(q, qk) && ROUTE_KEYS[route].indexOf(qk) < 0) return { err: fail(400, 'query') };
      function int(name, def, lo, hi) {
        if (!has(q, name)) return def;
        var s = q[name];
        if (!/^\d{1,6}$/.test(s) || +s < lo || +s > hi) throw fail(400, name);
        return +s;
      }
      function choice(name, set, def, req) {
        if (!has(q, name)) { if (req) throw fail(400, name); return def; }
        if (!has(set, q[name])) throw fail(400, name);
        return q[name];
      }
      try {
        if (route === 'item') {
          var hex = path.slice('/watchlist/'.length);
          if (!HEX.test(hex)) return { err: fail(400, 'id') };
          if (method !== 'PUT' && method !== 'DELETE') return { err: fail(405, 'method') };
          return { r: 'set', id: hex, on: method === 'PUT' };
        }
        if (method !== 'GET') return { err: fail(405, 'method') };
        if (route === '/details') {
          if (!HEX.test(q.id || '')) return { err: fail(400, 'id') };
          return { r: 'details', id: q.id, lang: choice('lang', LANGS, 'de') };
        }
        if (route === '/watchlist') return { r: 'watchlist', type: choice('type', WL_TYPE, 'all'), start: int('start', 0, 0, 10000), size: int('size', 50, 1, P.MAX_ITEMS) };
        if (route === '/watchlist/state') {
          var l = (q.ids || '').split(','), ids = [];
          if (l.length > 30) return { err: fail(400, 'ids') };
          for (i = 0; i < l.length; i++) { if (!HEX.test(l[i])) return { err: fail(400, 'ids') }; if (ids.indexOf(l[i]) < 0) ids.push(l[i]); }
          return { r: 'state', ids: ids };
        }
        var lst = path.slice('/discover/'.length);
        if (!has(LISTS, lst)) return { err: fail(404, 'route') };
        return { r: 'discover', list: lst, type: choice('type', { movie: 1, show: 2 }, null, true), size: int('size', 20, 1, 30) };
      } catch (ex) { return { err: ex }; }
    },
    /* ---------- Token ---------- */
    /* Token eines Home-Profils aus dem Profilwechsel merken (nur Speicher, gilt fuer dieses Konto) */
    remember: function (uuid, token) {
      var S = N.session, acc = S && S.state && S.state.account && S.state.account.token, c = N.platform && N.platform.caps;
      if (!c || !c.plexTvDirect || !acc || !uuid || typeof token !== 'string' || !token) return;
      if (toks.acc !== acc) toks = { acc: acc, map: {} };
      toks.map[uuid] = token;
    },
    forget: function (uuid) { if (uuid) delete toks.map[uuid]; else toks = { acc: '', map: {} }; },
    /* plex.tv-Token fuer uuid. own: persoenlich (Merkliste) – ohne eigenes Token nichts; sonst notfalls das Konto-Token.
     * Profil ohne PIN, noch kein Token: EIN Profilwechsel bei plex.tv (wie beim Oeffnen des Profils). cb(token|'') */
    token: function (uuid, own, cb) {
      var S = N.session, acc = S.state.account, a = acc && acc.token || '';
      if (toks.acc !== a) toks = { acc: a, map: {} };
      if (!a) { cb(''); return null; }
      if (uuid && uuid === acc.uuid) { cb(a); return null; }
      if (uuid && toks.map[uuid]) { cb(toks.map[uuid]); return null; }
      if (!own) { cb(a); return null; }
      var u = uuid && S.user(uuid);
      if (!u || u.pin || !N.auth) { cb(''); return null; }
      return N.auth.switchUser(a, uuid, null, function (err, ut) {
        if (!err && ut && toks.acc === a) toks.map[uuid] = ut;
        cb(!err && ut ? ut : '');
      });
    },
    /* ---------- Netz ---------- */
    /* EINE Anfrage an plex.tv; Adresse vorher gegen UPSTREAM geprueft. cb(err, text). Fehler wie der Helfer: 401/403 ->
     * 502 plex_auth, 404 -> 502 plex_404, sonst 502 plex_<status>; zu gross -> 502 too_large; Netzfehler unveraendert */
    call: function (method, host, path, query, token, lang, cb) {
      var qs = [], i;
      for (i = 0; query && i < query.length; i++) qs.push(encodeURIComponent(query[i][0]) + '=' + encodeURIComponent(query[i][1]));
      var url = 'https://' + host + path + (qs.length ? '?' + qs.join('&') : '');
      if (!P.allowed(method, url)) { setTimeout(function () { cb(fail(403, 'not_allowed'), null); }, 0); return { abort: function () {} }; }
      var h = N.plex.headers(token);
      if (lang) h['X-Plex-Language'] = lang;
      return N.http.request({ method: method, url: url, headers: h, json: false, timeout: P.TIMEOUT, retries: method === 'GET' ? 1 : 0,
        no401: true, nowatch: true, dedupe: false, body: method === 'PUT' ? '' : undefined }, function (err, txt) {
        if (err) {
          if (err.type !== 'http') { cb({ type: err.type, status: 0 }, null); return; }
          cb(fail(502, err.status === 401 || err.status === 403 ? 'plex_auth' : err.status === 404 ? 'plex_404' : 'plex_' + err.status), null);
          return;
        }
        txt = typeof txt === 'string' ? txt : '';
        if (txt.length > P.MAX_UPSTREAM) { cb(fail(502, 'too_large'), null); return; }
        cb(null, txt);
      });
    },
    /* Zwischenspeicher wie der Helfer; gleiche laufende Abfrage nur EINMAL (z. B. "Gerade beliebt" und "Neu erschienen" teilen
     * top_watchlisted). Fehler werden nicht gemerkt. */
    _cached: function (key, ttl, fn, cb) {
      var now = U.now(), hit = cache[key], w = wait[key], me = { cb: cb };
      if (hit && now - hit.ts < ttl) { setTimeout(function () { if (me.cb) me.cb(null, hit.v); }, 0); return { abort: function () { me.cb = null; } }; }
      if (w) { w.subs.push(me); return { abort: function () { me.cb = null; } }; }
      w = wait[key] = { subs: [me], task: null };
      w.task = fn(function (err, v) {
        delete wait[key];
        if (!err) {
          if (!has(cache, key)) ncache++;
          cache[key] = { ts: now, v: v };
          if (ncache > 200) { cache = {}; ncache = 0; }
        }
        for (var i = 0; i < w.subs.length; i++) if (w.subs[i].cb) w.subs[i].cb(err, v);
      });
      return { abort: function () {
        me.cb = null;
        for (var i = 0; i < w.subs.length; i++) if (w.subs[i].cb) return;
        if (wait[key] === w) { delete wait[key]; if (w.task && w.task.abort) w.task.abort(); }
      } };
    },
    _drop: function (prefix) { for (var k in cache) if (has(cache, k) && k.indexOf(prefix) === 0) { delete cache[k]; ncache--; } },
    _reset: function () { cache = {}; ncache = 0; wait = {}; toks = { acc: '', map: {} }; },
    /* Helfer-Route ausfuehren: method + path (mit Abfrage, wie an den Helfer). cb(err, data) mit derselben Form wie helper.py */
    request: function (method, raw, cb) {
      var dead = false, cur = null, S = N.session, uuid = S.profile ? S.profile.uuid : '';
      function done(e, d) { if (!dead) cb(e, d); }
      function later(e) { setTimeout(function () { done(e, null); }, 0); }
      var r = P.parse(method, raw);
      if (r.err) later(r.err);
      else if (!P.on()) later({ type: 'nohelper' });
      else cur = P.token(uuid, r.r === 'watchlist' || r.r === 'state' || r.r === 'set', function (tok) {
        if (dead) return;
        if (!tok) { done(fail(404, 'profile'), null); return; }        // wie der Helfer: Profil ohne Token (z. B. mit PIN, nicht geoeffnet)
        cur = P['_' + r.r](uuid, r, tok, function (e, d) {
          if (e && e.body && e.body.error === 'plex_auth' && uuid) P.forget(uuid);   // Token abgelaufen: naechste Anfrage wechselt neu
          done(e, d);
        });
      });
      return { abort: function () { dead = true; if (cur && cur.abort) cur.abort(); } };
    },
    _watchlist: function (uuid, r, tok, cb) {
      var q = [['includeCollections', 0], ['includeExternalMedia', 0]];
      if (WL_TYPE[r.type]) q.push(['type', WL_TYPE[r.type]]);
      q.push(['X-Plex-Container-Start', r.start], ['X-Plex-Container-Size', Math.min(r.size, P.PLEX_PAGE_MAX)]);
      return P._cached('wl|' + uuid + '|' + r.type + '|' + r.start + '|' + r.size, P.TTL.watchlist, function (fin) {
        return P.call('GET', DISCOVER, '/library/sections/watchlist/all', q, tok, '', function (e, txt) {
          var l = e ? null : P.metadataList(txt), items = [], i;
          if (e || !l) { fin(e || fail(502, 'parse')); return; }
          for (i = 0; i < l.md.length && items.length < P.MAX_ITEMS; i++) { var s = P.slim(l.md[i]); if (s) items.push(P.pub(s)); }
          fin(null, { items: items, total: l.total });
        });
      }, cb);
    },
    _state: function (uuid, r, tok, cb) {
      return P.call('GET', DISCOVER, '/library/metadata/' + r.ids.join(',') + '/userState', null, tok, '', function (e, txt) {
        var d = e ? null : U.parse(txt);
        if (e || !isObj(d)) { cb(e || fail(502, 'parse')); return; }
        cb(null, P.stateOf(d, r.ids));
      });
    },
    _set: function (uuid, r, tok, cb) {
      return P.call('PUT', DISCOVER, '/actions/' + (r.on ? 'addToWatchlist' : 'removeFromWatchlist'), [['ratingKey', r.id]], tok, '', function (e) {
        if (e) { cb(e); return; }
        P._drop('wl|');
        cb(null, { ok: true, id: r.id, on: r.on });
      });
    },
    _discover: function (uuid, r, tok, cb) {
      var spec = LISTS[r.list], lang = N.i18n.plexLanguage(), got = [], left = spec.hubs.length, errs = 0, firstErr = null, tasks = [];
      U.each(spec.hubs, function (name, k) {
        tasks.push(P._cached('hub|' + name + '|' + lang, P.TTL.discover, function (fin) {
          return P.call('GET', DISCOVER, '/hubs/sections/home/' + name, [['X-Plex-Container-Start', 0], ['X-Plex-Container-Size', P.HUB_SIZE]], tok, '', function (e, txt) {
            var l = e ? null : P.metadataList(txt), out = [], i;
            if (e || !l) { fin(e || fail(502, 'parse')); return; }
            for (i = 0; i < l.md.length; i++) { var s = P.slim(l.md[i]); if (s) out.push(s); }
            fin(null, out);
          });
        }, function (e, list) {
          if (e) { errs++; firstErr = firstErr || e; } else got[k] = list;
          if (--left > 0) return;
          if (errs === spec.hubs.length) { cb(firstErr); return; }      // ein Hub ausgefallen: die anderen reichen (wie der Helfer)
          var all = [], i;
          for (i = 0; i < spec.hubs.length; i++) if (got[i]) all = all.concat(got[i]);   // Hub-Reihenfolge wie der Helfer
          var out = P.pick(all, r.type, spec.when, ymd(N.clock ? N.clock.now() : U.now()), r.size), res = [];
          for (i = 0; i < out.length; i++) res.push(P.pub(out[i]));
          cb(null, { items: res });
        }));
      });
      return { abort: function () { for (var i = 0; i < tasks.length; i++) tasks[i].abort(); } };
    },
    _details: function (uuid, r, tok, cb) {
      return P._cached('det|' + r.id + '|' + r.lang, P.TTL.details, function (fin) {
        return P.call('GET', METADATA, '/library/metadata/' + r.id, null, tok, r.lang, function (e, txt) {
          var l = e ? null : P.metadataList(txt), d = l ? P.detailsSlim(l.md[0]) : null;
          if (e || !d || d.id !== r.id) { fin(e || fail(502, 'parse')); return; }
          fin(null, d);
        });
      }, cb);
    }
  };
  N.ptv = P;
})(N);
