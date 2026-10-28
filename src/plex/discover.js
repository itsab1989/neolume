/* N.disc – Entdecken (P4, docs/research/discover.md): Filme/Serien auch AUSSERHALB des eigenen Servers suchen, strikt getrennt.
 * Nur PMS, nie plex.tv: fremde Titel ueber den "Match korrigieren"-Endpunkt GET /library/metadata/<Anker>/matches?manual=1
 * (Anker = eigener Titel desselben Typs aus den Bibliotheken des aktiven Profils), Abgleich per Plex-GUID in EINER Anfrage
 * GET /library/all?guid=a,b,c (Alt-Agenten: Titel + Jahr). Bilder fremder Titel ueber /photo/:/transcode (N.img.url).
 * Merkliste nur mit dem optionalen Helfer (setup.json "helper" bzw. config.json "helperUrl"); ohne Helfer KEINE Anfrage dorthin.
 * Reine Logik (parse/group/match/…) ist DOM-frei und in Node getestet (tests/discover.test.js). */
(function (N) {
  var U = N.util, M = N.model;
  var AGENT = { movie: 'tv.plex.agents.movie', show: 'tv.plex.agents.series' }, LTYPE = { movie: 1, show: 2 };
  var GUID = /^plex:\/\/(movie|show)\/([0-9a-f]{12,40})$/, HEX = /^[0-9a-f]{12,40}$/;
  var infoCache = new N.LRU(30), anchors = {}, helperOk = null, helperDisc = false, helperFeat = [], helperT = null, helperBase = '', helperDownAt = 0, noWl = {}, downShown = false, PORT = '32499';   // anchors je Profil-uuid: {movie: rk|'' , show: rk|''}

  var D = {
    DELAY: 700, MAX_EXT: 30, TIMEOUT: 15000,
    /* ---------- Schalter ---------- */
    /* Standard: an im Hauptprofil, aus in anderen Profilen (matches braucht vermutlich Besitzerrechte, TV-Test offen), nie bei Kindern */
    enabled: function () {
      var S = N.session;
      if (!S || !S.profile || S.isKid()) return false;
      var v = S.settings ? S.settings.discover : undefined;
      return v === undefined ? D.defaultOn() : v === true;
    },
    defaultOn: function () { return !!(N.session && N.session.isAdmin()); },
    /* Helfer-Adresse: setup.json (Einrichtung) vor config.json (Entwicklung); nur http:// + private IPv4.
     * Nach erfolgreicher Erkennung die gefundene Adresse (helperBase, s. probeHelper). */
    helper: function () { return helperBase || D.helperConf(); },
    helperConf: function () {
      var S = N.session, h = S && S.pkg && S.pkg.helper;
      if (h && h.url) return h.url;
      return N.config.helperUrl && N.setupFile ? N.setupFile.lanUri(N.config.helperUrl) || '' : '';
    },
    helperKey: function () { var S = N.session, h = S && S.pkg && S.pkg.helper; return h && h.key || N.config.helperKey || ''; },
    /* Erkennung im Heimnetz (Orsay kann kein UDP -> kein GDM/SSDP): feste Port-Probe NUR an Adressen aus setup.json, in dieser
     * Reihenfolge: eingetragene Helfer-Adresse, Einrichtungs-Computer (computer.address:updatePort), Rechner des PMS (:32499).
     * Hilft, wenn sich die Adresse per DHCP geaendert hat oder der Helfer neben dem PMS (NAS) laeuft. Kein Netz-Scan.
     * Ohne eingetragenen Helfer (setup.json helper / config.json helperUrl) keine einzige Probe. */
    helperCands: function () {
      var conf = D.helperConf(), out = [], S = N.session, pkg = S && S.pkg, L = N.setupFile;
      if (!conf) return out;
      function add(u) { u = u && L ? L.lanUri(u) : u; if (u && out.indexOf(u) < 0) out.push(u); }
      out.push(conf);                                   // bereits geprueft (setupfile.parse bzw. config)
      var port = (/:(\d+)$/.exec(conf) || [0, PORT])[1];
      if (pkg && pkg.computer && pkg.computer.address) add('http://' + pkg.computer.address + ':' + (pkg.computer.updatePort || port));
      var uris = pkg && pkg.server && pkg.server.uris || [];
      for (var i = 0; i < uris.length; i++) { var m = /^http:\/\/([0-9.]+)/.exec(uris[i]); if (m) add('http://' + m[1] + ':' + port); }
      return out.slice(0, 4);
    },
    /* Merkliste sichtbar? Helfer konfiguriert + (noch nicht als fehlend erkannt) + Schalter + kein Kinderprofil + nicht "Freund"
     * + der Helfer kennt das Profil (404 "profile" = z. B. Profil mit Plex-PIN, bei der Einrichtung uebersprungen) */
    watchlistOn: function () {
      var S = N.session;
      if (!D.helper() || helperOk === false || !S || !S.profile || S.isKid() || S.profile.src === 'friend' || noWl[S.profile.uuid]) return false;
      return !(S.settings && S.settings.watchlist === false);
    },
    /* Inspiration Stufe 2 ("Gerade beliebt" usw., N.insp): Helfer meldet "discover":true + Entdecken an + kein Kinderprofil */
    discoverOn: function () {
      var S = N.session;
      return !!D.helper() && helperOk === true && helperDisc && !!S && !!S.profile && !S.isKid() && D.enabled();
    },
    helperState: function () { return !D.helper() ? 'none' : helperOk === null ? 'unknown' : helperOk ? 'ok' : 'down'; },
    /* einmal je Start: GET <kandidat>/neo-helper (3 s je Kandidat) -> watchlist:true? Nicht erreichbar -> 'down'; nach
     * RETRY ms darf ein erneuter Aufruf (Entdecken/Einstellungen oeffnen) wieder probieren. */
    probeHelper: function (cb) {
      var cands = D.helperCands();
      if (!cands.length) { helperOk = null; if (cb) cb(false); return; }
      if (helperOk === false && N.util.now() - helperDownAt > D.RETRY && !helperT) helperOk = null;
      if (helperOk !== null) { if (cb) cb(helperOk); return; }
      if (helperT) { if (cb) helperT.push(cb); return; }
      helperT = cb ? [cb] : [];
      var k = 0;
      function fin(ok) {
        helperOk = ok;
        if (!ok) { helperDisc = false; helperDownAt = N.util.now(); }
        var l = helperT; helperT = null;
        for (var i = 0; i < l.length; i++) l[i](helperOk);
      }
      (function next() {
        if (k >= cands.length) { fin(false); return; }
        var base = cands[k++];
        N.http.request({ url: base + '/neo-helper', headers: { 'Accept': 'application/json' }, timeout: 3000, retries: 0, no401: true, dedupe: false }, function (err, d) {
          if (err || !d || d.name !== 'plex-neo-helper' || d.watchlist !== true) { next(); return; }
          helperBase = base === D.helperConf() ? '' : base;
          helperDisc = d.discover === true;
          helperFeat = d.features && d.features.length ? d.features : [];   // z. B. 'servers' (Weitere Server: frische Adressen)
          downShown = false;
          fin(true);
        });
      })();
    },
    RETRY: 60000,
    /* Helfer erreichbar und kann diese Funktion (aus /neo-helper features) */
    helperHas: function (f) { return helperOk === true && helperFeat.indexOf(f) >= 0; },
    _resetHelper: function () { helperOk = null; helperDisc = false; helperFeat = []; helperT = null; helperBase = ''; helperDownAt = 0; noWl = {}; downShown = false; },
    /* Fehler einer Helfer-Anfrage auswerten: nicht erreichbar -> 'down' (Merkliste/Trends weg, Einstellungen erklaeren es);
     * 404 {error:"profile"} -> Merkliste fuer dieses Profil aus. Rueckgabe: 'down' | 'profile' | '' */
    helperFail: function (err) {
      if (!err || err.type === 'aborted') return '';
      if (err.type === 'network' || err.type === 'timeout') {
        helperOk = false; helperDisc = false; helperDownAt = N.util.now();
        N.evt.emit('helper:down', {});
        return 'down';
      }
      if (err.status === 404 && err.body && err.body.error === 'profile' && N.session.profile) { noWl[N.session.profile.uuid] = true; return 'profile'; }
      return '';
    },
    /* Hinweis "Helfer nicht erreichbar" als Toast: einmal je Ausfall (force: immer, z. B. nach einem Knopfdruck) */
    downToast: function (force) {
      if (!force && downShown) return;
      downShown = true;
      if (N.ui && N.ui.toast) N.ui.toast.show(N.t('toast.helperDown'), { icon: 'info' });
    },
    /* GET an den Helfer (nur feste Routen, nie mit Plex-Token); ohne Helfer-Adresse KEINE Anfrage */
    helperGet: function (path, cb) {
      if (!D.helper()) { setTimeout(function () { cb({ type: 'nohelper' }); }, 0); return { abort: function () {} }; }
      return N.http.request({ url: D.helper() + path, timeout: 10000, retries: 1, no401: true, dedupe: false,
        headers: { 'Accept': 'application/json', 'X-Neo-Profile': N.session.profile ? N.session.profile.uuid : '', 'X-Neo-Key': D.helperKey() } },
        function (err, d, meta) { if (err) D.helperFail(err); cb(err, d, meta); });
    },
    /* ---------- reine Logik ---------- */
    guidOk: function (g) { return typeof g === 'string' && GUID.test(g); },
    hexOf: function (g) { var m = GUID.exec(g || ''); return m ? m[2] : ''; },
    /* Titel vergleichbar machen (Alt-Agenten-Rueckfall): klein, ohne Satzzeichen/Leerraum */
    norm: function (t) { return String(t || '').toLowerCase().replace(/[^a-z0-9à-ÿ]+/g, ''); },
    /* matches-Antwort -> fremde Eintraege (nur gueltige GUID des erwarteten Typs, dedupliziert) */
    parseMatches: function (json, type) {
      var list = json && json.MediaContainer && json.MediaContainer.SearchResult || [], out = [], seen = {};
      for (var i = 0; i < list.length; i++) {
        var x = list[i], m = GUID.exec(x && x.guid || '');
        if (!m || m[1] !== type || seen[x.guid] || !x.name) continue;
        seen[x.guid] = 1;
        out.push(D.extItem(x, type));
      }
      return out;
    },
    extItem: function (x, type) {
      var thumb = typeof x.thumb === 'string' && /^https?:\/\/[^\s"'<>]+$/.test(x.thumb) ? x.thumb : '';
      var it = { rk: 'x' + D.hexOf(x.guid), ext: true, type: type, guid: x.guid, title: String(x.name || x.title || ''), year: Number(x.year) || 0,
        sum: U.trim(String(x.summary || ''), 600), thumb: thumb, still: thumb, art: '', lib: 0, kind: '', vc: 0, off: 0, dur: 0, leaf: 0, vleaf: 0, child: 0 };
      if (N.ext) N.ext.call('disc:item', it);              // optionale Erweiterung (z. B. Marke an der Karte)
      return it;
    },
    /* GUID-Liste fuer /library/all?guid= (eindeutig, gueltig, max. MAX_EXT) */
    guidParam: function (exts) {
      var out = [], seen = {};
      for (var i = 0; i < exts.length && out.length < D.MAX_EXT; i++) { var g = exts[i].guid; if (D.guidOk(g) && !seen[g]) { seen[g] = 1; out.push(g); } }
      return out.join(',');
    },
    /* Server-Titel (Filme/Serien) aus /hubs/search bzw. /library/all -> [{it, guid}] */
    localList: function (json, kinds) {
      var mc = json && json.MediaContainer || {}, out = [], i, j, src = [];
      if (mc.Hub) { for (i = 0; i < mc.Hub.length; i++) if (LTYPE[mc.Hub[i].type]) src = src.concat(mc.Hub[i].Metadata || []); }
      else src = mc.Metadata || [];
      for (j = 0; j < src.length; j++) {
        var x = src[j];
        if (!x || !x.ratingKey || !LTYPE[x.type]) continue;
        out.push({ it: M.norm(x, kinds), guid: String(x.guid || '') });
      }
      return out;
    },
    /* Kern: lokale Treffer + per GUID gefundene (found) + fremde -> Gruppen in fester Reihenfolge, leere fehlen.
     * Ein fremder Titel, dessen GUID (bzw. bei Alt-Agenten Titel+Jahr) auf dem Server liegt, erscheint NUR oben. */
    group: function (local, found, extMovies, extShows) {
      var server = [], rks = {}, byGuid = {}, byName = {}, i;
      function add(l) {
        for (var k = 0; k < l.length; k++) {
          var e = l[k];
          if (e.guid) byGuid[e.guid] = 1;
          if (!D.guidOk(e.guid)) byName[e.it.type + '|' + D.norm(e.it.title) + '|' + (e.it.year || '')] = 1;
          if (rks[e.it.rk]) continue;
          rks[e.it.rk] = 1; server.push(e.it);
        }
      }
      add(local || []); add(found || []);
      function rest(list) {
        var out = [];
        for (i = 0; list && i < list.length; i++) {
          var x = list[i];
          if (byGuid[x.guid] || byName[x.type + '|' + D.norm(x.title) + '|' + (x.year || '')]) continue;
          out.push(x);
        }
        return out;
      }
      var gm = rest(extMovies), gs = rest(extShows), out = [];
      if (server.length) out.push({ id: 'server', tk: 'disc.group.server', kind: 'posterQ', items: server.slice(0, 30) });
      if (gm.length) out.push({ id: 'extMovies', tk: 'disc.group.extMovies', kind: 'posterQ', items: gm.slice(0, 20) });
      if (gs.length) out.push({ id: 'extShows', tk: 'disc.group.extShows', kind: 'posterQ', items: gs.slice(0, 20) });
      return out;
    },
    /* Kartenzeile 2: "Film · 2025" (fremd: gleiche Form; die Gruppe sagt "Nicht auf deinem Server") */
    caption: function (it) {
      var kind = it.type === 'show' ? N.t('search.kind.show') : N.t('search.kind.movie');
      return [it.title, N.fmt.join([kind, it.year || ''])];
    },
    /* Ueberzeile der Detailseite fremder Titel */
    overline: function (it) { return N.t(it.type === 'show' ? 'search.kind.show' : 'search.kind.movie') + ' · ' + N.t('disc.notOnServer'); },
    /* ---------- Details eines fremden Titels (Detailseite 'extdetails') ----------
     * Gemeinsames Modell fuer alle Quellen (Plex-Katalog ueber den Helfer, optional eine Erweiterung der Ausgabe):
     * {src, sum, tagline, date, thumb, art, cr, dur (ms), rating (0-10), studio, network, genres [Text], directors, creators,
     *  writers [Name], cast [{name, role, thumb}], seasons, episodes, status 'running'|'ended'|'', lastAired, nextAir,
     *  release {cinema, digital, physical} (Datum je Art; nur eine Erweiterung liefert es)}
     * Bilder sind https-Adressen bekannter Bild-Hosts; der Fernseher laedt sie ueber den Foto-Umrechner des PMS (N.img.url),
     * nie direkt (kein TLS 1.2). Reine Funktionen, in Node getestet (tests/extinfo.test.js). */
    IMG: /^https:\/\/(images\.plex\.tv|metadata-static\.plex\.tv|image\.tmdb\.org|artworks\.thetvdb\.com)\/[^\s"'<>]{1,500}$/,
    img: function (u) { return typeof u === 'string' && D.IMG.test(u) ? u : ''; },
    emptyInfo: function () {
      return { src: '', sum: '', tagline: '', date: '', thumb: '', art: '', cr: '', dur: 0, rating: 0, studio: '', network: '', genres: [], directors: [],
        creators: [], writers: [], cast: [], seasons: 0, episodes: 0, status: '', lastAired: '', nextAir: '', release: null };
    },
    /* Antwort von GET <helfer>/details -> Modell (unbekannte/kaputte Felder fallen weg) */
    infoFromHelper: function (d) {
      if (!d || typeof d !== 'object') return null;
      function s(v, n) { return typeof v === 'string' ? U.trim(v, n) : ''; }
      function arr(l) { return Object.prototype.toString.call(l) === '[object Array]' ? l : []; }
      function names(l, n) { var o = []; l = arr(l); for (var i = 0; i < l.length && o.length < n; i++) if (typeof l[i] === 'string' && l[i]) o.push(U.trim(l[i], 80)); return o; }
      function day(v) { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''; }
      var x = D.emptyInfo(), c = arr(d.cast);
      x.src = 'plex'; x.sum = s(d.summary, 1500); x.tagline = s(d.tagline, 200); x.date = day(d.date); x.thumb = D.img(d.thumb); x.art = D.img(d.art);
      x.cr = s(d.contentRating, 20); x.dur = Number(d.duration) > 0 ? Number(d.duration) : 0; x.rating = Number(d.rating) > 0 && Number(d.rating) <= 10 ? Number(d.rating) : 0;
      x.studio = s(d.studio, 100); x.network = s(d.network, 60);
      x.genres = names(d.genres, 5); x.directors = names(d.directors, 3); x.writers = names(d.writers, 3);
      for (var i = 0; i < c.length && x.cast.length < 15; i++) if (c[i] && typeof c[i].name === 'string' && c[i].name) x.cast.push({ name: U.trim(c[i].name, 80), role: s(c[i].role, 80), thumb: D.img(c[i].thumb) });
      x.seasons = Number(d.seasons) > 0 ? Math.floor(Number(d.seasons)) : 0; x.episodes = Number(d.episodes) > 0 ? Math.floor(Number(d.episodes)) : 0;
      x.status = d.continuing === true ? 'running' : d.continuing === false ? 'ended' : '';
      x.lastAired = day(d.lastAired);
      return x;
    },
    /* zwei Quellen zusammenfuehren: a hat Vorrang, leere Felder kommen aus b (Listen nur, wenn a keine hat) */
    mergeInfo: function (a, b) {
      if (!a) return b || null;
      if (!b) return a;
      var o = D.emptyInfo(), k;
      for (k in o) if (Object.prototype.hasOwnProperty.call(o, k)) {
        var va = a[k], vb = b[k];
        o[k] = va && (typeof va !== 'object' || va.length === undefined || va.length) ? va : vb !== undefined ? vb : o[k];
      }
      if (/^[a-z]{2}\//.test(b.cr || '') && !/^[a-z]{2}\//.test(a.cr || '')) o.cr = b.cr;   // Freigabe mit Land ("de/16" = FSK 16) vor der US-Angabe des Katalogs
      o.src = a.src && b.src ? a.src + '+' + b.src : a.src || b.src;
      return o;
    },
    /* Metazeile: "1978 · 1 Std. 31 Min. · R · 8,9/10" bzw. "2022 · 6 Staffeln · Läuft noch · TV-MA" (+ Zusatz, z. B. "Hier nicht abspielbar") */
    extMeta: function (it, x, tail) {
      var F = N.fmt, p = [it.year || ''];
      if (x) {
        if (it.type === 'show') {
          if (x.seasons) p.push(N.tn('meta.seasons', x.seasons));
          if (x.status) p.push(N.t('disc.det.st.' + x.status));
        } else if (x.dur) p.push(F.dur(x.dur));
        p.push(F.rated(x.cr));
        if (x.rating) p.push(F.rating(x.rating));
      }
      p.push(tail === undefined ? N.t('disc.det.note') : tail);
      return F.join(p);
    },
    /* Zeile unter der Beschreibung: Film "Regie: …", Serie "Sender · Idee: …" */
    extLine: function (it, x) {
      if (!x) return '';
      if (it.type === 'show') return N.fmt.join([x.network ? N.t('disc.det.network', { name: x.network }) : '', x.creators.length ? N.t('disc.det.creator', { names: x.creators.slice(0, 2).join(', ') }) : '']);
      return x.directors.length ? N.t('det.info.director', { names: x.directors.slice(0, 2).join(', ') }) : x.studio ? N.t('det.info.studio', { name: x.studio }) : '';
    },
    extChips: function (x) { var o = []; for (var i = 0; x && i < x.genres.length && o.length < 3; i++) o.push(N.fmt.genre(x.genres[i])); return o; },
    /* Besetzung als Karten (Reihe 'cast' wie bei eigenen Titeln) */
    extCast: function (x) {
      var o = [];
      for (var i = 0; x && i < x.cast.length; i++) o.push({ rk: 'xc' + i, type: 'person', id: 0, title: x.cast[i].name, role: x.cast[i].role, thumb: x.cast[i].thumb, vc: 0, off: 0, dur: 0, leaf: 0, vleaf: 0 });
      return o;
    },
    /* INFO-Panel: Leitsatz, ganze Beschreibung, Regie/Idee/Drehbuch, Sender/Studio, Genres, Staffeln/Folgen, Erstausstrahlung.
     * ext {ov, state} (optional, Erweiterung): eigene Ueberzeile (z. B. "Film · Bald da") und Stand als Zeile darunter – wie auf der Seite */
    extInfoText: function (it, x, sum, note, ext) {
      var F = N.fmt, head = [F.join([ext && ext.ov || D.overline(it), it.year || ''])], p = [];
      if (ext && ext.state) head.push(ext.state);
      if (x && x.tagline) head.push(x.tagline);
      if (x) {
        if (x.directors.length && it.type !== 'show') p.push(N.t('det.info.director', { names: x.directors.join(', ') }));
        if (x.creators.length) p.push(N.t('disc.det.creator', { names: x.creators.join(', ') }));
        if (x.writers.length && it.type !== 'show') p.push(N.t('det.info.writer', { names: x.writers.join(', ') }));
        if (x.network) p.push(N.t('disc.det.network', { name: x.network }));
        if (x.studio) p.push(N.t('det.info.studio', { name: x.studio }));
        if (x.genres.length) p.push(x.genres.slice(0, 5).map(function (g) { return F.genre(g); }).join(', '));
        if (it.type === 'show' && x.episodes) p.push(N.t('disc.det.episodes', { s: N.tn('meta.seasons', x.seasons || 1), n: x.episodes }));
        if (x.date) p.push(N.t(it.type === 'show' ? 'disc.det.firstAired' : 'disc.det.released', { date: N.det.date(x.date) }));
        if (x.release && x.release.digital) p.push(N.t('disc.det.digital', { date: N.det.date(x.release.digital) }));
        if (x.release && x.release.physical) p.push(N.t('disc.det.physical', { date: N.det.date(x.release.physical) }));
        if (x.nextAir) p.push(N.t('disc.det.nextAir', { date: N.det.date(x.nextAir) }));
      }
      /* Fakten und Hinweis bleiben ganz; die Beschreibung bekommt den Rest der 700 Zeichen (mind. 160) */
      var tail = [], used;
      if (p.length) tail.push(p.join('\n'));
      if (note) tail.push(note);
      used = head.join('\n\n').length + tail.join('\n\n').length + 4 * (tail.length + 1);
      return U.trim(head.concat([U.trim(sum, Math.max(160, Math.min(600, 700 - used)))], tail).join('\n\n'), 700);
    },
    /* Details ueber den Helfer: EINE Anfrage je Titel + Sprache, im Speicher gehalten. cb(err, info|null).
     * Ohne Helfer bzw. Helfer ohne 'details' (aelterer Helfer): sofort cb({type:'nohelper'}) – keine Anfrage. */
    details: function (it, cb) {
      var hex = D.hexOf(it && it.guid), lang = N.i18n.lang() === 'en' ? 'en' : 'de', key = hex + '|' + lang, v = infoCache.get(key);
      function later(e, r) { setTimeout(function () { cb(e, r); }, 0); return { abort: function () {} }; }
      if (!HEX.test(hex)) return later({ type: 'guid' }, null);
      if (v) return later(null, v);
      if (!D.helperHas('details')) return later({ type: 'nohelper' }, null);
      return D.helperGet('/details?id=' + hex + '&lang=' + lang, function (err, d) {
        var x = err ? null : D.infoFromHelper(d);
        if (x) infoCache.set(key, x);
        cb(err || (x ? null : { type: 'parse' }), x);
      });
    },
    _resetInfo: function () { infoCache = new N.LRU(30); },
    /* ---------- Anfragen ---------- */
    /* Anker je Typ aus den Film-/Serien-Bibliotheken des aktiven Profils (einmal je Profil) */
    anchor: function (type, libs, cb) {
      var uid = N.session.profile ? N.session.profile.uuid : 'x', a = anchors[uid] || (anchors[uid] = {});
      if (a[type] !== undefined) { cb(a[type]); return { abort: function () {} }; }
      var ids = [];
      for (var i = 0; libs && i < libs.length; i++) if (libs[i].type === type) ids.push(libs[i].id);
      var k = 0, cur = null, dead = false;
      function next() {
        if (dead) return;
        if (k >= ids.length) { a[type] = ''; cb(''); return; }
        cur = N.plex.get('/library/sections/' + ids[k++] + '/all', { type: LTYPE[type], 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 1, excludeElements: N.hubs.EXCL }, null, function (err, d) {
          cur = null;
          var m = !err && d && d.MediaContainer && d.MediaContainer.Metadata;
          if (m && m[0] && m[0].ratingKey) { a[type] = String(m[0].ratingKey); cb(a[type]); } else next();
        });
      }
      next();
      return { abort: function () { dead = true; if (cur) cur.abort(); } };
    },
    _resetAnchors: function () { anchors = {}; },
    /* Fremde Titel eines Typs: cb(err, items) ; err.type 'noanchor' = keine passende Bibliothek.
     * 404 = Anker inzwischen geloescht (am PMS geprueft) -> Anker vergessen und EINMAL neu ermitteln.
     * nowatch: Zeitueberschreitungen dieses langsamen Endpunkts (Metadaten-Dienst) melden NICHT "Server nicht erreichbar". */
    external: function (q, type, libs, cb, again) {
      var sub = null, dead = false, inner = null, t = D.anchor(type, libs, function (rk) {
        if (dead) return;
        if (!rk) { cb({ type: 'noanchor' }, []); return; }
        sub = N.plex.get('/library/metadata/' + rk + '/matches', { manual: 1, title: q, agent: AGENT[type], language: N.i18n.plexLanguage() },
          { timeout: D.TIMEOUT, retries: 0, no401: true, nowatch: true }, function (err, d) {
            sub = null;
            if (dead) return;
            if (err && err.status === 404 && !again) { D._forgetAnchor(type); inner = D.external(q, type, libs, cb, true); return; }
            cb(err, err ? [] : D.parseMatches(d, type));
          });
      });
      return { abort: function () { dead = true; t.abort(); if (sub) sub.abort(); if (inner) inner.abort(); } };
    },
    _forgetAnchor: function (type) { var uid = N.session.profile ? N.session.profile.uuid : 'x'; if (anchors[uid]) delete anchors[uid][type]; },
    /* Gesamte Suche: lokale Treffer + Filme + Serien parallel, danach EIN GUID-Abgleich.
     * cb(groups, info) ; info {ext: 'ok'|'part'|'fail'|'none', local: 'ok'|'fail', cache: bool}
     * ext 'part' = ein Typ fehlgeschlagen, 'fail' = keine fremden Treffer moeglich (alle Typen bzw. GUID-Abgleich fehlgeschlagen).
     * Schlaegt der GUID-Abgleich fehl, fallen die fremden Treffer weg: ungeprueft koennten eigene Titel als "nicht auf deinem
     * Server" erscheinen (strikte Trennung). Zwischengespeichert wird nur ein vollstaendiges Ergebnis (info.cache). */
    status: function (xerr) {
      var fail = 0, none = 0, n = 0;
      for (var k in xerr) if (Object.prototype.hasOwnProperty.call(xerr, k)) { n++; if (xerr[k]) { if (xerr[k].type === 'noanchor') none++; else fail++; } }
      return none === n ? 'none' : fail === 0 ? 'ok' : fail + none === n ? 'fail' : 'part';
    },
    search: function (q, libs, kinds, cb) {
      var tasks = [], left = 3, dead = false, local = null, lerr = null, ext = { movie: [], show: [] }, xerr = { movie: null, show: null };
      function done() {
        if (dead || --left > 0) return;
        var all = ext.movie.concat(ext.show), gp = D.guidParam(all), xs = D.status(xerr);
        function fin(found, gerr) {
          if (dead) return;
          if (gerr) { xs = 'fail'; ext.movie = []; ext.show = []; }
          cb(D.group(local || [], found, ext.movie, ext.show), { ext: xs, local: lerr ? 'fail' : 'ok', cache: !lerr && xs === 'ok' });
        }
        if (!gp) { fin([]); return; }
        tasks.push(N.plex.get('/library/all', { guid: gp, excludeElements: N.hubs.EXCL }, { timeout: 10000 }, function (err, d) { fin(err ? [] : D.localList(d, kinds), err); }));
      }
      tasks.push(N.plex.get('/hubs/search', { query: q, limit: 10, excludeElements: N.hubs.EXCL }, { timeout: 10000 }, function (err, d) {
        lerr = err; local = err ? [] : D.localList(d, kinds); done();
      }));
      ['movie', 'show'].forEach(function (type) {
        tasks.push(D.external(q, type, libs, function (err, items) { xerr[type] = err; ext[type] = items || []; done(); }));
      });
      return { abort: function () { dead = true; for (var i = 0; i < tasks.length; i++) if (tasks[i]) tasks[i].abort(); } };
    },
    /* ---------- Merkliste ueber den Helfer (nur wenn watchlistOn) ---------- */
    wl: {
      ids: {},                                   // hex -> true (bekannter Zustand dieser Sitzung)
      req: function (method, path, cb) {
        if (!D.watchlistOn()) { setTimeout(function () { cb({ type: 'nohelper' }); }, 0); return { abort: function () {} }; }
        if (method !== 'GET' && N.config.readOnly) { N.log('readOnly: ' + method + ' helper' + path + ' unterdrueckt'); setTimeout(function () { cb(null, {}); }, 0); return { abort: function () {} }; }
        return N.http.request({ method: method, url: D.helper() + path, timeout: 10000, retries: method === 'GET' ? 1 : 0, no401: true, dedupe: false,
          headers: { 'Accept': 'application/json', 'X-Neo-Profile': N.session.profile ? N.session.profile.uuid : '', 'X-Neo-Key': D.helperKey() } },
          function (err, d, meta) { if (err) err.helper = D.helperFail(err); cb(err, d, meta); });
      },
      /* Merkliste -> fremde Eintraege (Helfer liefert {items:[{id,guid,title,year,summary,thumb,type}], total}) */
      parse: function (d) {
        var l = d && d.items || [], out = [];
        for (var i = 0; i < l.length; i++) {
          var x = l[i], m = GUID.exec(x && x.guid || '');
          if (!m) continue;
          var it = D.extItem({ guid: x.guid, name: x.title, year: x.year, summary: x.summary, thumb: x.thumb }, m[1]);
          it.wl = true; D.wl.ids[m[2]] = true; out.push(it);
        }
        return out;
      },
      list: function (cb) { return D.wl.req('GET', '/watchlist?type=all&start=0&size=50', function (err, d) { cb(err, err ? [] : D.wl.parse(d)); }); },
      /* Merkliste fuer die Reihe "Deine Merkliste": danach EIN GUID-Abgleich am PMS (wie Stufe 2) -> eigene Titel als normale,
       * abspielbare Karte "Auf deinem Server", sonst fremde Karte. Schlaegt der Abgleich fehl, faellt die Reihe weg (strikte Trennung). */
      listMarked: function (kinds, cb) {
        var sub = null, dead = false, t = D.wl.list(function (err, items) {
          if (dead) return;
          if (err || !items.length) { cb(err, []); return; }
          items = items.slice(0, D.MAX_EXT);              // nur so viele, wie EIN Abgleich prueft
          sub = N.plex.get('/library/all', { guid: D.guidParam(items), excludeElements: N.hubs.EXCL }, { timeout: 10000 }, function (e2, d2) {
            sub = null;
            if (dead) return;
            if (e2) { cb(e2, []); return; }
            var out = N.insp.markServer(items, D.localList(d2, kinds));
            for (var i = 0; i < out.length; i++) out[i].wl = true;
            cb(null, out);
          });
        });
        return { abort: function () { dead = true; t.abort(); if (sub) sub.abort(); } };
      },
      has: function (it) { return !!D.wl.ids[D.hexOf(it.guid)]; },
      /* Reihe "Deine Merkliste" nach Hinzufuegen/Entfernen auf einer Detailseite ohne neue Anfrage anpassen (TV-Test 28.10.: sie
       * aenderte sich erst beim naechsten Oeffnen von Entdecken). items: bisherige Reihe (wird nicht veraendert) -> neue Liste;
       * hinzugefuegt = vorne (wie die Merkliste, neueste zuerst), entfernt = alle Eintraege mit derselben GUID raus */
      apply: function (items, it, on) {
        var hex = D.hexOf(it && it.guid), out = [], i;
        if (!HEX.test(hex)) return items || [];
        if (on) { var c = U.extend({}, it); c.wl = true; out.push(c); }
        for (i = 0; items && i < items.length; i++) if (D.hexOf(items[i].guid) !== hex) out.push(items[i]);
        return out;
      },
      state: function (it, cb) {
        var hex = D.hexOf(it.guid);
        if (!HEX.test(hex)) { cb(false); return { abort: function () {} }; }
        return D.wl.req('GET', '/watchlist/state?ids=' + hex, function (err, d) {
          if (!err && d && d.ids) D.wl.ids[hex] = !!d.ids[hex];
          cb(!!D.wl.ids[hex]);
        });
      },
      set: function (it, on, cb) {
        var hex = D.hexOf(it.guid);
        if (!HEX.test(hex)) { cb({ type: 'guid' }); return { abort: function () {} }; }
        return D.wl.req(on ? 'PUT' : 'DELETE', '/watchlist/' + hex, function (err) {
          if (!err) { D.wl.ids[hex] = on; N.evt.emit('watchlist:changed', { it: it, on: on }); }   // Entdecken: Reihe "Deine Merkliste" sofort anpassen
          cb(err);
        });
      }
    }
  };
  N.evt.on('profile:changed', function () { D.wl.ids = {}; });
  N.disc = D;
})(N);
