/* N.insp – "Entdecken: Inspiration" (Stufe 1, docs/research/discover.md "Inspiration"): Reihen im leeren Entdecken-Bildschirm.
 * Stufe 1 nur PMS, nur GET: Server-Hubs aus /hubs/sections/<lib> (EINE Anfrage je Film-/Serien-Bibliothek des Profils, Familien
 * ueber N.homeRows.hubType wie "Startseite anpassen") + zwei Genre-Reihen, deren Genre je Tag wechselt (stabil fuer Tag + Profil):
 * /library/sections/<lib>/genre -> Wahl per Hash -> /library/sections/<lib>/all?genre=…  (wie die Hubs movie.genre / tv.moreingenre).
 * Stufe 2 (vorbereitet, nur mit Helfer + "discover":true): "Gerade beliebt / Neu erschienen / Bald verfuegbar" je Filme/Serien aus
 * plex.tv Discover ueber den Helfer, danach EIN GUID-Abgleich /library/all?guid= -> Kennzeichnung "Auf/Nicht auf deinem Server".
 * Auswahl/Reihenfolge je Profil in settings.inspRows (gleiche Logik wie homeRows: N.homeRows.merge/view/store/enabled).
 * Reihen laden unabhaengig (jede Reihe meldet sich, sobald ihre Quellen da sind), Ergebnis 5 min im Speicher (je Profil/Tag/Sprache). */
(function (N) {
  var U = N.util, M = N.model, HR = N.homeRows;
  var TTL = 300000, MAX = 20, GENRE_MIN = 4, GENRE_TRIES = 3, HUB_COUNT = 20;
  var ROWS = [
    { id: 'top', tk: 'insp.row.top', fams: ['movie.topunwatched'], types: ['movie'] },
    { id: 'trend-movie', tk: 'insp.row.trend.movie', list: 'trending', type: 'movie' },
    { id: 'trend-show', tk: 'insp.row.trend.show', list: 'trending', type: 'show' },
    { id: 'rediscover', tk: 'insp.row.rediscover', fams: ['movie.rediscover', 'tv.rediscover'], types: ['movie', 'show'] },
    { id: 'released', tk: 'insp.row.released', fams: ['movie.recentlyreleased'], types: ['movie'] },
    { id: 'new-movie', tk: 'insp.row.new.movie', list: 'new', type: 'movie' },
    { id: 'new-show', tk: 'insp.row.new.show', list: 'new', type: 'show' },
    { id: 'start', tk: 'insp.row.start', fams: ['tv.startwatching'], types: ['show'] },
    { id: 'rated', tk: 'insp.row.rated', fams: ['movie.toprated', 'tv.toprated'], types: ['movie', 'show'] },
    { id: 'genre1', genre: 0, types: ['movie', 'show'] },
    { id: 'genre2', genre: 1, types: ['movie', 'show'] },
    { id: 'soon-movie', tk: 'insp.row.soon.movie', list: 'soon', type: 'movie' },
    { id: 'soon-show', tk: 'insp.row.soon.show', list: 'soon', type: 'show' }
  ];
  var BY = {}, k;
  for (k = 0; k < ROWS.length; k++) BY[ROWS[k].id] = ROWS[k];
  var mem = { key: '', rows: {} };                  // id -> {ts, row|null}
  var genreMem = { key: '', pools: null };          // Genre-Listen je Tag/Profil (aendern sich kaum)

  var I = {
    TTL: TTL, ROWS: ROWS,
    def: function (id) { return BY[id] || null; },
    /* Stufe 2 sichtbar? Nur mit Helfer, der "discover":true meldet (N.disc.probeHelper), nie ohne Helfer-Adresse */
    helperOn: function () { return !!(N.disc && N.disc.discoverOn && N.disc.discoverOn()); },
    /* ---------- Auswahl (settings.inspRows) ---------- */
    /* verfuegbare Reihen in Standard-Reihenfolge (alle Standard an). libs: Film-/Serien-Bibliotheken des Profils;
     * cat: Hub-Katalog ("Startseite anpassen", optional) -> Hub-Reihen nur, wenn der Server eine passende Familie liefert */
    avail: function (libs, cat, helper) {
      var have = {}, fams = null, out = [], i, j;
      for (i = 0; libs && i < libs.length; i++) have[libs[i].type] = 1;
      if (cat && cat.hubs) {
        fams = {};
        for (i = 0; i < cat.hubs.length; i++) fams[cat.hubs[i].fam] = 1;
      }
      for (i = 0; i < ROWS.length; i++) {
        var r = ROWS[i], ok = false;
        if (r.list) ok = !!helper;
        else for (j = 0; j < r.types.length; j++) if (have[r.types[j]]) ok = true;
        if (ok && r.fams && fams) { ok = false; for (j = 0; j < r.fams.length; j++) if (fams[r.fams[j]]) ok = true; }
        if (ok) out.push({ id: r.id, def: true });
      }
      return out;
    },
    enabled: function (saved, libs, cat, helper) { return HR.enabled(saved, I.avail(libs, cat, helper)); },
    /* ---------- Genre des Tages ---------- */
    day: function (t) { var d = new Date(t); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); },
    /* FNV-1a (32 bit), deterministisch in ES5 */
    hash: function (s) {
      var h = 0x811c9dc5;
      s = String(s);
      for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
      return h >>> 0;
    },
    /* /library/sections/<lib>/genre -> [{title, key}] */
    genres: function (json) {
      var l = json && json.MediaContainer && json.MediaContainer.Directory || [], out = [];
      for (var i = 0; i < l.length; i++) if (l[i] && l[i].key !== undefined && l[i].title) out.push({ title: String(l[i].title), key: String(l[i].key) });
      return out;
    },
    /* Genre-Pool je Typ aus allen Bibliotheken: [{title, type, keys:{lib: key}}] (gleicher Titel in 2 Bibliotheken = 1 Eintrag) */
    pool: function (perLib) {
      var out = { movie: [], show: [] }, idx = {}, i, j;
      for (i = 0; i < perLib.length; i++) {
        var p = perLib[i];
        for (j = 0; j < p.genres.length; j++) {
          var g = p.genres[j], key = p.type + '|' + g.title.toLowerCase(), e = idx[key];
          if (!e) { e = idx[key] = { title: g.title, type: p.type, keys: {} }; out[p.type].push(e); }
          e.keys[p.lib] = g.key;
        }
      }
      return out;
    },
    /* Kandidaten fuer Genre-Reihe slot (0/1), stabil fuer seed (Tag + Profil): Reihe 1 bevorzugt Filme, Reihe 2 Serien;
     * fehlt ein Typ, kommen beide aus dem anderen (verschiedene Genres). Rueckgabe: geordnete Liste (Ersatz bei zu wenig Titeln) */
    candidates: function (pools, seed, slot) {
      function order(list, salt) {
        var t = [];
        for (var i = 0; i < list.length; i++) t.push({ g: list[i], h: I.hash(seed + '|' + salt + '|' + list[i].type + '|' + list[i].title.toLowerCase()) });
        t.sort(function (a, b) { return a.h - b.h || (a.g.title < b.g.title ? -1 : 1); });
        var out = [];
        for (i = 0; i < t.length; i++) out.push(t[i].g);
        return out;
      }
      var mv = pools && pools.movie || [], sh = pools && pools.show || [];
      var first = mv.length ? order(mv, 'a') : order(sh, 'a');
      if (slot === 0) return first;
      if (mv.length && sh.length) return order(sh, 'b');
      return first.slice(GENRE_TRIES);              // nur ein Typ: Reihe 2 nimmt die naechsten Genres (nie dieselben wie Reihe 1)
    },
    /* ---------- Reihen bauen (rein) ---------- */
    /* Eintraege mehrerer Quellen abwechselnd mischen, nach ratingKey dedupliziert, max. MAX */
    mix: function (lists, max) {
      var out = [], seen = {}, i, n = 0;
      for (i = 0; i < lists.length; i++) n = Math.max(n, lists[i].length);
      for (var p = 0; p < n && out.length < (max || MAX); p++) {
        for (i = 0; i < lists.length && out.length < (max || MAX); i++) {
          var it = lists[i][p];
          if (!it || seen[it.rk]) continue;
          seen[it.rk] = 1; out.push(it);
        }
      }
      return out;
    },
    /* Hub-Reihe aus den Hub-Antworten der Bibliotheken: hubs {lib: json} */
    hubRow: function (id, hubs, libs, kinds) {
      var r = BY[id], lists = [], i, j;
      for (i = 0; i < libs.length; i++) {
        var lib = libs[i], hl = hubs[lib.id] && hubs[lib.id].MediaContainer && hubs[lib.id].MediaContainer.Hub || [];
        for (j = 0; j < hl.length; j++) {
          var h = hl[j], fam = HR.hubType(h, lib.id).fam;
          if (r.fams.indexOf(fam) < 0) continue;
          lists.push(M.normList(h.Metadata || [], kinds, lib.id));
        }
      }
      var items = I.mix(lists);
      return items.length ? { id: id, kind: 'posterQ', tk: r.tk, tp: null, items: items } : null;
    },
    genreRow: function (id, g, lists) {
      var items = I.mix(lists);
      if (!items.length) return null;
      return { id: id, kind: 'posterQ', tk: g.type === 'show' ? 'insp.row.genre.show' : 'insp.row.genre.movie', tp: { genre: g.title }, items: items };
    },
    /* Stufe 2: fremde Eintraege (Helfer) + eigene Titel mit derselben GUID -> eigene zuerst als normale Karte mit Marke
     * "Auf deinem Server" (abspielbar), sonst fremd mit Marke "Nicht auf deinem Server". Reihenfolge der Liste bleibt. */
    markServer: function (exts, local) {
      var by = {}, out = [], i;
      for (i = 0; local && i < local.length; i++) if (local[i].guid && !by[local[i].guid]) by[local[i].guid] = local[i].it;
      for (i = 0; i < exts.length; i++) {
        var x = exts[i], own = by[x.guid], it;
        if (own) { it = U.extend({}, own); it.mark = 'disc.onServer'; }
        else { it = U.extend({}, x); it.mark = 'disc.notOnServer'; }
        out.push(it);
      }
      return out;
    },
    /* Helfer-Antwort {items:[{guid,title,year,summary,thumb}]} -> fremde Eintraege des Typs (nur gueltige Plex-GUID) */
    parseHelper: function (d, type) {
      var l = d && d.items || [], out = [], seen = {};
      for (var i = 0; i < l.length && out.length < MAX; i++) {
        var x = l[i];
        if (!x || !N.disc.guidOk(x.guid) || x.guid.indexOf('plex://' + type + '/') !== 0 || seen[x.guid] || !x.title) continue;
        seen[x.guid] = 1;
        out.push(N.disc.extItem({ guid: x.guid, name: x.title, year: x.year, summary: x.summary, thumb: x.thumb }, type));
      }
      return out;
    },
    /* ---------- Zwischenspeicher (Speicher, je Profil/Tag/Sprache/Bibliotheken) ---------- */
    key: function (libs) {
      var S = N.session, ids = [];
      for (var i = 0; libs && i < libs.length; i++) ids.push(libs[i].id);
      return (S && S.profile ? S.profile.uuid : 'x') + '|' + I.day(U.now()) + '|' + N.i18n.lang() + '|' + ids.join(',');
    },
    /* gemerkte Reihen fuer libs: {id: {row, fresh}} (fresh = juenger als TTL) */
    cached: function (libs) {
      var key = I.key(libs), out = {}, now = U.now();
      if (mem.key !== key) return out;
      for (var id in mem.rows) if (Object.prototype.hasOwnProperty.call(mem.rows, id)) out[id] = { row: mem.rows[id].row, fresh: now - mem.rows[id].ts < TTL };
      return out;
    },
    _put: function (key, id, row) {
      if (mem.key !== key) mem = { key: key, rows: {} };
      mem.rows[id] = { ts: U.now(), row: row };
    },
    _reset: function () { mem = { key: '', rows: {} }; genreMem = { key: '', pools: null }; },
    /* ---------- Laden ----------
     * ids: Reihen, die geholt werden sollen (in Anzeige-Reihenfolge). onRow(id, row|null, err) je Reihe, sobald sie fertig ist;
     * onDone() danach. Fehler einer Reihe: err gesetzt, nicht zwischengespeichert (naechstes Oeffnen fragt neu). */
    load: function (ids, libs, kinds, onRow, onDone) {
      var P = N.plex, key = I.key(libs), tasks = [], dead = false, left = 0, i;
      var hubs = {}, hubErr = {}, hubLeft = {}, hubIds = [], gIds = [], hIds = [];
      function emit(id, row, err) {
        if (dead) return;
        if (!err) I._put(key, id, row);
        onRow(id, row, err || null);
        if (--left === 0 && onDone) onDone();
      }
      function get(path, q, opts, cb) { var t = P.get(path, q, opts || { timeout: 12000 }, function (e, d) { if (!dead && !(e && e.type === 'aborted')) cb(e, d); }); tasks.push(t); return t; }
      function libsFor(types) { var out = []; for (var j = 0; j < libs.length; j++) if (types.indexOf(libs[j].type) >= 0) out.push(libs[j]); return out; }
      for (i = 0; i < ids.length; i++) {
        var r = BY[ids[i]];
        if (!r) continue;
        if (r.list) { if (I.helperOn()) { hIds.push(r.id); left++; } }
        else if (r.genre !== undefined) { gIds.push(r.id); left++; }
        else { hubIds.push(r.id); left++; }
      }
      if (!left) { setTimeout(function () { if (!dead && onDone) onDone(); }, 0); return { abort: function () { dead = true; } }; }
      /* Hub-Reihen: EINE Anfrage je benoetigter Bibliothek; eine Reihe ist fertig, wenn alle ihre Bibliotheken geantwortet haben */
      var needLib = {};
      U.each(hubIds, function (id) {
        var ls = libsFor(BY[id].types);
        hubLeft[id] = ls.length;
        for (var j = 0; j < ls.length; j++) needLib[ls[j].id] = ls[j];
        if (!ls.length) setTimeout(function () { emit(id, null); }, 0);
      });
      function hubDone(lib) {
        U.each(hubIds, function (id) {
          if (libsFor(BY[id].types).indexOf(lib) < 0) return;
          if (--hubLeft[id] > 0) return;
          var ls = libsFor(BY[id].types), errAll = true, j;
          for (j = 0; j < ls.length; j++) if (!hubErr[ls[j].id]) errAll = false;
          var row = I.hubRow(id, hubs, ls, kinds);
          emit(id, row, !row && errAll ? hubErr[ls[0].id] : row && hasErr(ls) ? { type: 'partial' } : null);
        });
      }
      function hasErr(ls) { for (var j = 0; j < ls.length; j++) if (hubErr[ls[j].id]) return true; return false; }
      for (var lid in needLib) if (Object.prototype.hasOwnProperty.call(needLib, lid)) (function (lib) {
        get('/hubs/sections/' + lib.id, { count: HUB_COUNT, excludeElements: N.hubs.EXCL }, null, function (e, d) {
          if (e) hubErr[lib.id] = e; else hubs[lib.id] = d;
          hubDone(lib);
        });
      })(needLib[lid]);
      if (gIds.length) loadGenres();
      U.each(hIds, function (id) { loadHelper(id); });
      /* Genre-Reihen: Genre-Listen (je Tag gemerkt) -> Wahl -> Titel; zu wenige Titel -> naechstes Genre (max. GENRE_TRIES) */
      function loadGenres() {
        var gl = libsFor(['movie', 'show']), gkey = key, per = [], n = gl.length, failed = 0;
        if (genreMem.key === gkey && genreMem.pools) { pick(genreMem.pools); return; }
        if (!n) { U.each(gIds, function (id) { setTimeout(function () { emit(id, null); }, 0); }); return; }
        U.each(gl, function (lib) {
          get('/library/sections/' + lib.id + '/genre', null, null, function (e, d) {
            if (e) failed++; else per.push({ lib: lib.id, type: lib.type, genres: I.genres(d) });
            if (--n > 0) return;
            if (failed === gl.length) { U.each(gIds, function (id) { emit(id, null, e || { type: 'parse' }); }); return; }
            var pools = I.pool(per);
            if (!failed) genreMem = { key: gkey, pools: pools };
            pick(pools);
          });
        });
      }
      function pick(pools) {
        var seed = key.split('|').slice(0, 2).join('|'), used = {};
        U.each(gIds, function (id) {
          var cands = I.candidates(pools, seed, BY[id].genre), list = [];
          for (var j = 0; j < cands.length && list.length < GENRE_TRIES; j++) if (!used[cands[j].type + cands[j].title]) list.push(cands[j]);
          if (list[0]) used[list[0].type + list[0].title] = 1;
          tryGenre(id, list, 0);
        });
      }
      function tryGenre(id, list, t) {
        var g = list[t];
        if (!g) { emit(id, null); return; }
        var ls = [], lists = [], errs = 0;
        for (var lk in g.keys) if (Object.prototype.hasOwnProperty.call(g.keys, lk)) ls.push(Number(lk));
        var n = ls.length;
        U.each(ls, function (lib) {
          var q = g.type === 'show'
            ? { type: 2, genre: g.keys[lib], unwatchedLeaves: 1, sort: 'audienceRating:desc' }
            : { type: 1, genre: g.keys[lib], unwatched: 1, sort: 'audienceRating:desc' };
          q['X-Plex-Container-Start'] = 0; q['X-Plex-Container-Size'] = MAX; q.excludeElements = N.hubs.EXCL;
          get('/library/sections/' + lib + '/all', q, null, function (e, d) {
            if (e) errs++; else lists.push(M.normList(d && d.MediaContainer && d.MediaContainer.Metadata || [], kinds, lib));
            if (--n > 0) return;
            var row = I.genreRow(id, g, lists);
            if (errs === ls.length) { emit(id, null, e || { type: 'parse' }); return; }
            if ((!row || row.items.length < GENRE_MIN) && list[t + 1]) { tryGenre(id, list, t + 1); return; }
            emit(id, row, errs ? { type: 'partial' } : null);
          });
        });
      }
      /* Stufe 2: Liste vom Helfer, danach EIN GUID-Abgleich; schlaegt der fehl, faellt die Reihe weg (strikte Trennung) */
      function loadHelper(id) {
        var r = BY[id];
        tasks.push(N.disc.helperGet('/discover/' + r.list + '?type=' + r.type + '&size=' + MAX, function (e, d) {
          if (dead || (e && e.type === 'aborted')) return;
          if (e) { emit(id, null, e); return; }
          var exts = I.parseHelper(d, r.type), gp = N.disc.guidParam(exts);
          if (!gp) { emit(id, null); return; }
          get('/library/all', { guid: gp, excludeElements: N.hubs.EXCL }, { timeout: 10000 }, function (e2, d2) {
            if (e2) { emit(id, null, e2); return; }
            var items = I.markServer(exts, N.disc.localList(d2, kinds));
            emit(id, items.length ? { id: id, kind: 'posterQ', tk: r.tk, tp: null, items: items } : null);
          });
        }));
      }
      return { abort: function () { dead = true; for (var j = 0; j < tasks.length; j++) if (tasks[j]) tasks[j].abort(); } };
    }
  };
  N.insp = I;
})(N);
