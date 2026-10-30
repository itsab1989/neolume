/* N.hubs – Daten der Startseite (SPEC 7.3, 15): Bibliotheken, Weiterschauen, Naechste Folgen (dedupliziert), Neu je Bibliothek
 * (je Serie nur einmal), optionale Server-Hubs und Playlists in der Reihenfolge aus "Startseite anpassen" (N.homeRows).
 * Zeilen-Modell: {id, kind:'land'|'poster', tk (String-Schluessel), tp (Parameter) | title (Server-Titel), items:[norm]}. */
(function (N) {
  var U = N.util, M = N.model, HR = N.homeRows;
  var EXCL = 'Media,Genre,Country,Director,Writer,Role,Collection,Label,Image,UltraBlurColors,Field,Guid,Rating';
  var MAX_LIBS = 7, NEW_MAX = 12;
  function libKind(d) {
    var low = String(d.title || '').toLowerCase();
    if (d.type === 'artist') return /h\u00f6rb|h\u00f6rsp|audiob|audio book|podcast/.test(low) ? 'audio' : 'music';
    if (low.indexOf('anime') >= 0) return 'anime';
    if (/doku|docu/.test(low)) return 'doc';
    return d.type;
  }
  function dirs(json, types) {
    var list = json && json.MediaContainer && json.MediaContainer.Directory || [], out = [];
    for (var i = 0; i < list.length && out.length < MAX_LIBS; i++) {
      var d = list[i];
      if (!types[d.type] || (d.hidden && Number(d.hidden) === 1)) continue;
      /* loc: Ordner der Bibliothek (PMS "Location", hoechstens 4) – fuer Erweiterungen, die eine Bibliothek einem Ordner zuordnen */
      var loc = [], ls = d.Location || [];
      for (var j = 0; j < ls.length && loc.length < 4; j++) if (ls[j] && typeof ls[j].path === 'string' && ls[j].path) loc.push(ls[j].path.substring(0, 256));
      out.push({ id: Number(d.key), title: String(d.title || ''), type: d.type, kind: libKind(d), loc: loc });
    }
    return out;
  }
  var H = {
    EXCL: EXCL,
    /* /library/sections -> nur Film- und Serien-Bibliotheken, max. 7 (SPEC 5.5: Seitenleiste, "Neu in") */
    libraries: function (json) { return dirs(json, { movie: 1, show: 1 }); },
    /* alle Bibliotheken mit Server-Hubs (auch Musik/Hoerbuecher) fuer optionale Reihen */
    allLibraries: function (json) { return dirs(json, { movie: 1, show: 1, artist: 1 }); },
    libKind: libKind,                                 // Art einer Bibliothek aus /library/sections ('audio' = Hoerbuecher, HOME-13)
    libKinds: function (libs) { var k = {}; for (var i = 0; libs && i < libs.length; i++) k[libs[i].id] = libs[i].kind; return k; },
    /* Naechste Folgen ohne alles, was schon in Weiterschauen steht (ratingKey und grandparentRatingKey; SPEC 7.3, TECH-R14) */
    dedupe: function (cw, deck) {
      var rk = {}, show = {}, i, out = [];
      for (i = 0; i < cw.length; i++) { rk[cw[i].rk] = 1; if (cw[i].showRk) show[cw[i].showRk] = 1; }
      for (i = 0; i < deck.length; i++) {
        var it = deck[i];
        if (rk[it.rk] || (it.showRk && show[it.showRk])) continue;
        rk[it.rk] = 1; if (it.showRk) show[it.showRk] = 1;   // auch innerhalb von Naechste Folgen keine Doppelten
        out.push(it);
      }
      return out;
    },
    /* /library/onDeck liefert auch angefangene Filme (TV-Test 27.10., F3): die gehoeren zu Weiterschauen. Die Reihe
     * "Naechste Folgen" zeigt nur Folgen; mit Weiterschauen zusaetzlich nur ungesehene (angefangene stehen dort). */
    nextEpisodes: function (deck, withCw) {
      var out = [];
      for (var i = 0; i < deck.length; i++) {
        var it = deck[i];
        if (it.type !== 'episode' || (withCw && it.off > 0)) continue;
        out.push(it);
      }
      return out;
    },
    /* "Neu in": recentlyAdded liefert Folgen, Staffeln und Serien gemischt -> je Serie nur EIN Eintrag (der neueste, an
     * seiner Stelle). nNew = Zahl neuer Folgen der Serie (Staffel = ihre Folgen, Serie = alle), nur bei >= 2 Eintraegen. */
    byShow: function (items, max) {
      var groups = {}, order = [], i, it, g;
      for (i = 0; i < items.length; i++) {
        it = items[i];
        var key = it.showRk ? 's' + it.showRk : 'r' + it.rk;
        g = groups[key];
        if (!g) { g = groups[key] = { list: [], best: it }; order.push(g); }
        else if ((it.added || 0) > (g.best.added || 0)) g.best = it;
        g.list.push(it);
      }
      order.sort(function (a, b) { return (b.best.added || 0) - (a.best.added || 0) || items.indexOf(a.best) - items.indexOf(b.best); });
      var out = [];
      for (i = 0; i < order.length && out.length < (max || 1e9); i++) {
        g = order[i]; it = g.best;
        if (g.list.length > 1) { it = U.extend({}, it); it.nNew = H.newCount(g.list); }
        out.push(it);
      }
      return out;
    },
    newCount: function (list) {
      var seasons = {}, n = 0, i;
      for (i = 0; i < list.length; i++) if (list[i].type === 'show') return Math.max(list[i].leaf, list.length);
      for (i = 0; i < list.length; i++) if (list[i].type === 'season') { seasons[list[i].rk] = 1; n += list[i].leaf || 1; }
      for (i = 0; i < list.length; i++) if (list[i].type !== 'season' && !(list[i].seasonRk && seasons[list[i].seasonRk])) n++;
      return n;
    },
    /* data: {libs, alibs, order:[ids] (fehlt = Standard), cw:[raw], deck:[raw], recent:{libId:[raw]}, hubs:{libId:json},
     *        pl:[raw], plTitle, keep:{rowId:row}, tot:{cw|deck:{got, total}}} -> Zeilen in order (leere werden weggelassen).
     * Jede Reihe mit Ziel (allTarget) bekommt row.all und als letzte Karte "Alle anzeigen" (HOME-14).
     * keep: Reihen, deren Anfrage fehlschlug -> alte Reihe an ihrer Stelle behalten (Teil-Fehler, M2) */
    buildRows: function (data) {
      var libs = data.libs || [], kinds = H.libKinds(data.alibs || libs), rows = [], keep = data.keep || {}, i;
      var order = data.order || HR.enabled(null, HR.avail(libs, null)), libById = {};
      for (i = 0; i < libs.length; i++) libById[libs[i].id] = libs[i];
      var useCw = order.indexOf('cw') >= 0;
      var cw = keep.cw ? keep.cw.items : M.normList(data.cw || [], kinds);
      for (i = 0; i < order.length; i++) {
        var id = order[i], p = HR.parse(id), row = null, items;
        if (keep[id]) { rows.push(keep[id]); continue; }
        if (id === 'cw') { if (cw.length) row = { id: id, kind: 'land', tk: 'home.row.continue', tp: null, items: cw }; }
        else if (id === 'deck') {
          items = H.nextEpisodes(M.normList(data.deck || [], kinds), useCw);
          items = useCw ? H.dedupe(cw, items) : H.dedupe([], items);
          if (items.length) row = { id: id, kind: 'land', tk: 'home.row.upNext', tp: null, items: items };
        } else if (p.group === 'new') {
          var lib = libById[p.lib];
          items = lib ? H.byShow(M.normList(data.recent && data.recent[p.lib] || [], kinds), NEW_MAX) : [];
          if (items.length) row = { id: id, kind: 'poster', tk: 'home.row.newIn', tp: { library: lib.title }, items: items };
        } else if (p.group === 'hub') {
          var h = data.hubs && data.hubs[p.lib] ? HR.findHub(data.hubs[p.lib], id, p.lib) : null;
          items = h ? M.normList(h.Metadata || h.Directory || [], kinds) : [];
          if (items.length) row = { id: id, kind: h.type === 'episode' ? 'land' : N.music.isAudio(items[0]) ? 'sq' : 'poster', title: String(h.title || ''), items: items.slice(0, NEW_MAX) };
        } else if (id === 'ab') {                       // M4 Weiterhoeren: je Buch der juengste angefangene Track
          items = N.music.continueCards(data.ab || []);
          if (items.length) row = { id: id, kind: 'sq', tk: 'mu.row.continue', tp: null, items: items };
        } else if (id === 'pl') {
          items = M.normList(data.pl || [], kinds);
          if (items.length) row = { id: id, kind: 'poster', tk: 'home.row.playlists', tp: null, title: data.plTitle || '', items: items };
        } else if (p.group === 'ext') row = H.extRow(id);
        /* Erweiterungs-Reihen setzen ihr Ziel selbst ({t: 'x'}, Karte per withAll; views/library.js holt die Liste ueber 'lib:list') */
        if (row && !row.ext) { row.all = H.allTarget(row, p, data, p.group === 'hub' ? h : null); H.withAll(row); }
        if (row) rows.push(row);
      }
      return rows;
    },
    /* HOME-14 "Alle anzeigen": wohin fuehrt die Karte am Ende einer Reihe? null = keine Karte (die Reihe zeigt schon alles).
     *   {t:'lib', lib, sort:'added'}  Bibliothek, nur fuer diesen Besuch nach "Zuletzt hinzugefuegt" (Neu in …, Hub "zuletzt hinzugefuegt")
     *   {t:'list', src:'hub', key, lib}  ganze Liste eines Server-Hubs (h.more bzw. mehr als gezeigt)
     *   {t:'list', src:'cw'|'deck', n}  Weiterschauen / Naechste Folgen, nur wenn der Server mehr hat als die geholten 20
     * n = Gesamtzahl, soweit bekannt (Server: totalSize). Rein (Tests). */
    allTarget: function (row, p, data, h) {
      var tot;
      if (p.group === 'new') return { t: 'lib', lib: p.lib, sort: 'added' };
      if (p.group === 'hub' && h) {
        var fam = HR.hubType(h, p.lib).fam;
        if (/recent(ly)?\.?added$/.test(fam)) return { t: 'lib', lib: p.lib, sort: 'added' };
        if (h.key && (h.more === true || h.more === 1 || h.more === '1' || row.items.length < H.rawCount(h))) return { t: 'list', src: 'hub', key: String(h.key), lib: p.lib };
        return null;
      }
      if (row.id === 'cw' || row.id === 'deck') {
        tot = data && data.tot && data.tot[row.id];
        if (!tot || !(tot.total > tot.got || tot.got >= H.CW_MAX)) return null;
        return { t: 'list', src: row.id, n: tot.total > tot.got ? tot.total : 0 };
      }
      return null;
    },
    CW_MAX: 20,
    rawCount: function (h) { return (h.Metadata || h.Directory || []).length; },
    /* Karte "Alle anzeigen" als letztes Element anhaengen (idempotent; Reihen aus dem Cache – dort ohne Karte – bekommen sie so wieder) */
    withAll: function (row) {
      var l = row && row.items;
      if (!l || !row.all || (l.length && l[l.length - 1].all)) return row;
      l.push({ rk: 'all:' + row.id, type: 'all', all: true, cls: 'is-all', title: '', alln: row.all.n || 0 });
      return row;
    },
    /* Zahl der echten Karten (ohne "Alle anzeigen") */
    realCount: function (row) { var l = row && row.items || []; return l.length && l[l.length - 1].all ? l.length - 1 : l.length; },
    /* Titel der ganzen Liste (HOME-14) wie in der Reihe: Naechste Folgen nur Folgen, ohne Doppelte und – wenn Weiterschauen an ist –
     * ohne Angefangene und ohne Serien aus Weiterschauen (list.cw: [{rk, showRk}]). items: normalisiert */
    listItems: function (list, items) {
      if (list.src !== 'deck') return items;
      return H.dedupe(list.cwOn ? list.cw || [] : [], H.nextEpisodes(items, !!list.cwOn));
    },
    /* Reihen nach neuer Auswahl/Reihenfolge (sofort nach "Startseite anpassen", vor dem Netz-Refresh) */
    pick: function (rows, ids) {
      var by = {}, out = [], i, x;
      for (i = 0; i < rows.length; i++) by[rows[i].id] = rows[i];
      for (i = 0; i < ids.length; i++) {
        x = by[ids[i]] || (HR.parse(ids[i]).group === 'ext' ? H.extRow(ids[i]) : null);   // Erweiterungs-Reihe: nie im Cache, gleich ihr Stand
        if (x) out.push(H.withAll(x));
      }
      return out;
    },
    /* Reihe einer optionalen Erweiterung (N.ext 'home:row'): fertige Reihe {id, kind, title, items, ext: true, more} oder
     * Platzhalter {…, items: [], note, want: true} – geladen wird erst, wenn sie in die Naehe des Fokus kommt ('home:want'
     * aus views/home.js, im Leerlauf). Nie im Startseiten-Cache (forCache), damit kein alter Stand erscheint. */
    extRow: function (id) {
      var r = N.ext && N.ext.has('home:row') ? N.ext.call('home:row', id) : null;
      if (!r || r.id !== id || !r.items) return null;
      r.ext = true;
      return r;
    },
    /* eingeschaltete Reihen-ids fuer die Startseite */
    order: function (cfg, libs, alibs) { return HR.enabled(cfg, HR.homeAvail(cfg, libs || [], alibs || libs || [])); },
    rowTitle: function (row) { return row.title || N.t(row.tk, row.tp); },
    /* gleiche Reihe? (Reihenfolge, Keys, Fortschritt, Gesehen-Status) -> keine DOM-Arbeit beim Hintergrund-Refresh */
    sameRow: function (a, b) {
      if (!a || !b || a.id !== b.id || a.items.length !== b.items.length || (a.title || '') !== (b.title || '') || (a.note || '') !== (b.note || '')) return false;
      if (JSON.stringify(a.all || null) !== JSON.stringify(b.all || null)) return false;
      for (var i = 0; i < a.items.length; i++) {
        var x = a.items[i], y = b.items[i];
        if (x.rk !== y.rk || x.off !== y.off || x.vc !== y.vc || x.vleaf !== y.vleaf || x.leaf !== y.leaf || x.nNew !== y.nNew) return false;
      }
      return true;
    },
    /* TV-Test 28.10.: direkt nach dem Stoppen fehlt der gerade gespielte Titel manchmal in der Antwort von Weiterschauen (die
     * Timeline "stopped" ist beim PMS noch nicht verarbeitet), kurz danach steht er dort an erster Stelle. true = die Antwort
     * ist noch zu frueh: Weiterschauen (bzw. ohne sie Naechste Folgen) ist eingeschaltet, enthaelt den Titel rk aber nicht.
     * ids: eingeschaltete Reihen (H.order) */
    stale: function (rows, rk, ids) {
      var want = [], i, j;
      if (!rk) return false;
      if (ids.indexOf('cw') >= 0) want.push('cw'); else if (ids.indexOf('deck') >= 0) want.push('deck');
      if (!want.length) return false;
      for (i = 0; rows && i < rows.length; i++) {
        if (want.indexOf(rows[i].id) < 0) continue;
        for (j = 0; j < rows[i].items.length; j++) if (rows[i].items[j].rk === rk) return false;
      }
      return true;
    },
    /* Bibliothek geaendert (N.libwatch): welche eingeschalteten Reihen koennen sich dadurch aendern? "Neu in" und Server-Hubs dieser
     * Bibliotheken, dazu "Naechste Folgen" (neue Folge einer angefangenen Serie). Weiterschauen, Playlists und Erweiterungs-Reihen
     * nicht. libIds: ['2', …] (Strings oder Zahlen), ids: H.order(…) -> Teilmenge von ids */
    affected: function (libIds, ids) {
      var libs = {}, out = [], i;
      for (i = 0; libIds && i < libIds.length; i++) libs[String(libIds[i])] = 1;
      for (i = 0; ids && i < ids.length; i++) {
        var p = HR.parse(ids[i]);
        if (ids[i] === 'deck' || ((p.group === 'new' || p.group === 'hub') && libs[String(p.lib)])) out.push(ids[i]);
      }
      return out;
    },
    /* Fokus in einer Reihe, die sich im Hintergrund geaendert hat (HOME-3): dieselbe Karte bleibt fokussiert (gleicher ratingKey),
     * fehlt sie, die an ihrer Stelle (bzw. die letzte); die Karte bleibt an derselben Bildschirm-Spalte, soweit die Reihe das
     * zulaesst. olds/news: Karten, f/sc: Fokus/erste sichtbare Karte vorher, full: ganz sichtbare Karten -> {f, sc} */
    keepFocus: function (olds, news, f, sc, full) {
      var n = news ? news.length : 0, rk = olds && olds[f] ? olds[f].rk : null, nf = -1, i;
      if (!n) return { f: 0, sc: 0 };
      for (i = 0; rk != null && i < n; i++) if (news[i].rk === rk) { nf = i; break; }
      if (nf < 0) nf = Math.max(0, Math.min(f, n - 1));
      var col = Math.max(0, f - sc), nsc = nf - col, max = Math.max(0, n - full);
      nsc = Math.max(0, Math.min(nsc, max));
      if (nf < nsc) nsc = nf; else if (nf > nsc + full - 1) nsc = Math.max(0, nf - full + 1);
      return { f: nf, sc: nsc };
    },
    sameLayout: function (a, b) {
      if (!a || !b || a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) if (a[i].id !== b[i].id) return false;
      return true;
    },
    /* Cache-Kopie <= 60 KB (SPEC 14.9): erst Beschreibungen kuerzen, dann hintere Reihen ohne Beschreibung */
    forCache: function (rows, maxBytes) {
      maxBytes = maxBytes || 60000;
      var keep = [], r, i;
      for (r = 0; r < rows.length; r++) if (!rows[r].ext) keep.push(rows[r]);   // Erweiterungs-Reihen: eigener Speicher, nie hier
      var copy = JSON.parse(JSON.stringify(keep)), s;
      /* "Alle anzeigen" (HOME-14) nie in den Cache: andere Leser (Suche-Vorschlaege, Schoner) sehen nur echte Titel; row.all bleibt,
       * H.pick haengt die Karte beim Lesen wieder an */
      for (r = 0; r < copy.length; r++) copy[r].items.length = H.realCount(copy[r]);
      s = JSON.stringify(copy);
      if (s.length <= maxBytes) return copy;
      for (r = 0; r < copy.length; r++) for (i = 0; i < copy[r].items.length; i++) copy[r].items[i].sum = U.trim(copy[r].items[i].sum, 160);
      s = JSON.stringify(copy);
      for (r = copy.length - 1; r >= 0 && s.length > maxBytes; r--) {
        for (i = 0; i < copy[r].items.length; i++) copy[r].items[i].sum = '';
        s = JSON.stringify(copy);
      }
      for (r = copy.length - 1; r >= 0 && s.length > maxBytes; r--) {
        while (copy[r].items.length > 6 && s.length > maxBytes) { copy[r].items.pop(); s = JSON.stringify(copy); }
      }
      return copy;
    },
    /* Hub-Katalog fuer "Startseite anpassen" (SPEC 7.3.1): /library/sections, dann je Bibliothek /hubs/sections/<id>
     * (count=6: mit count=1 laesst der PMS 1.43 manche Hubs weg) und /hubs fuer die Playlists-Reihe. Fehler einer Bibliothek -> ihr alter Stand aus prev;
     * nur ohne Sektionen -> Fehler. Titel kommen in der App-Sprache (X-Plex-Language). cb(err, {v, lang, ts, alibs, hubs, pl}) */
    discover: function (prev, cb) {
      var P = N.plex, tasks = [], done = false, pending = 0, alibs = null, hubs = {}, pl = prev && prev.pl || null;
      function oldFor(lib) {
        var out = [], h = prev && prev.hubs || [];
        for (var i = 0; i < h.length; i++) if (h[i].lib === lib) out.push(h[i]);
        return out;
      }
      function finish(err, res) { if (done) return; done = true; cb(err, res); }
      function step() {
        if (done || --pending > 0) return;
        var all = [];
        for (var i = 0; i < alibs.length; i++) all = all.concat(hubs[alibs[i].id] || []);
        finish(null, { v: 1, lang: N.i18n.lang(), ts: U.now(), alibs: alibs, hubs: all, pl: pl });
      }
      tasks.push(P.get('/library/sections', null, null, function (err, d) {
        if (err) { if (err.type !== 'aborted') finish(err); return; }
        alibs = H.allLibraries(d);
        pending = alibs.length + 1;
        U.each(alibs, function (lib) {
          tasks.push(P.get('/hubs/sections/' + lib.id, { count: 6, excludeElements: EXCL }, null, function (e2, d2) {
            if (e2 && e2.type === 'aborted') return;
            hubs[lib.id] = e2 ? oldFor(lib.id) : HR.hubsOf(d2, lib.id);
            step();
          }));
        });
        tasks.push(P.get('/hubs', { count: 6, excludeElements: EXCL }, null, function (e3, d3) {
          if (e3 && e3.type === 'aborted') return;
          if (!e3) {
            var list = d3 && d3.MediaContainer && d3.MediaContainer.Hub || [];
            pl = null;
            for (var i = 0; i < list.length; i++) if (list[i].hubIdentifier === 'home.playlists') pl = { title: String(list[i].title || '') };
          }
          step();
        }));
      }));
      return { abort: function () { done = true; for (var i = 0; i < tasks.length; i++) tasks[i].abort(); } };
    },
    /* Netz: Sektionen + Weiterschauen + Naechste Folgen parallel (nur eingeschaltete), danach Neu je Bibliothek, Server-Hubs
     * (EINE Anfrage /hubs/sections/<lib> je Bibliothek mit eingeschalteten Hubs) und Playlists. Jede Anfrage einzeln (M2):
     * eine fehlgeschlagene Reihe bleibt leer bzw. behaelt ihre alte Fassung aus prev.rows; ohne Sektionen gelten prev.libs.
     * Ganzer Fehler nur, wenn alle Grund-Anfragen scheitern, oder sofort bei 401 (Token ungueltig).
     * prev: {libs, alibs, rows, cfg (settings.homeRows), plTitle} (optional).
     * cb(err, {libs (null = Sektionen fehlgeschlagen), alibs, rows, partial, hubCat:{lib:[Katalog]}}) */
    fetch: function (cb, prev) {
      prev = prev || {};
      var P = N.plex, cfg = prev.cfg || null, out = { libs: null, alibs: null, cw: null, deck: null, recent: {}, hubs: {}, pl: null, hubCat: {}, tot: {} };
      var done = false, tasks = [], keep = {}, errs = [], baseErrs = 0, pending = 0, phase2 = false, only = prev.only || null;
      function want(id) { return !only || only.indexOf(id) >= 0; }
      var old = {};
      for (var o = 0; prev.rows && o < prev.rows.length; o++) old[prev.rows[o].id] = prev.rows[o];
      function list(d) { return d && d.MediaContainer && d.MediaContainer.Metadata || []; }
      /* HOME-14: Gesamtzahl laut Server (totalSize) und geholte Zahl -> "Alle anzeigen" nur, wenn es mehr gibt */
      function tot(id, d) { var mc = d && d.MediaContainer || {}; out.tot[id] = { got: list(d).length, total: Number(mc.totalSize) || 0 }; }
      function finish(err, res) {
        if (done) return; done = true;
        if (err) for (var i = 0; i < tasks.length; i++) tasks[i].abort();
        cb(err, res);
      }
      /* Fehler einer Reihe merken; true = alles abbrechen (401). ids: alte Reihen, die stehen bleiben */
      function bad(err, ids) {
        err = err || { type: 'parse' };
        errs.push(err);
        if (N.diag) N.diag.log('warn', 'home ' + (ids && ids[0] || 'sections') + ' ' + (err.status || err.type));
        if (err.status === 401) { finish(err); return true; }
        for (var i = 0; ids && i < ids.length; i++) if (old[ids[i]]) keep[ids[i]] = old[ids[i]];
        return false;
      }
      function libsUsed() { return out.libs || prev.libs || []; }
      function alibsUsed() { return out.alibs || prev.alibs || libsUsed(); }
      function order() { return H.order(cfg, libsUsed(), alibsUsed()); }
      function result() {
        return { libs: out.libs, alibs: out.alibs, partial: errs.length > 0, hubCat: out.hubCat,
          rows: H.buildRows({ libs: libsUsed(), alibs: alibsUsed(), order: order(), cw: out.cw, deck: out.deck, recent: out.recent,
            hubs: out.hubs, pl: out.pl, ab: out.ab, tot: out.tot, plTitle: prev.plTitle, keep: keep }) };
      }
      function req(path, query, opts, ids, ok) {
        pending++;
        tasks.push(P.get(path, query, opts, function (err, d) {
          if (err) { if (err.type === 'aborted' || bad(err, ids)) return; if (!phase2) baseErrs++; }
          else ok(d);
          step();
        }));
      }
      function step() {
        if (done || --pending > 0) return;
        if (phase2) { finish(null, result()); return; }
        phase2 = true;
        if (baseErrs === baseN) { finish(errs[0] || { type: 'parse' }); return; }
        var ids = order(), hubLibs = [], i;
        for (i = 0; i < ids.length; i++) {
          var p = HR.parse(ids[i]);
          if (p.group === 'hub' && want(ids[i]) && hubLibs.indexOf(p.lib) < 0) hubLibs.push(p.lib);
        }
        pending = 1;                                  // Waechter: erst nach dem Anstossen aller Anfragen fertig werden
        U.each(libsUsed(), function (lib) {
          if (ids.indexOf('new-' + lib.id) < 0 || !want('new-' + lib.id)) return;
          req('/hubs/home/recentlyAdded', { type: lib.type === 'movie' ? 1 : 2, sectionID: lib.id,
            'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 40, excludeElements: EXCL }, null, ['new-' + lib.id], function (d) {
              out.recent[lib.id] = list(d);
              // HOME-3/12-Diagnose (TV-Test 30.10.: "Neu: Serien" nach dem Start veraltet): erste Titel jeder Antwort, nicht nur der Teil-Antwort
              if (N.log) N.log('home neu ' + lib.id + (only ? ' (teilweise)' : '') + ': ' + list(d).slice(0, 3).map(function (m) { return (m.grandparentTitle || m.parentTitle || m.title || '').substring(0, 20) + '@' + (m.addedAt || 0); }).join(' | '));
            });
        });
        U.each(hubLibs, function (lib) {
          var mine = [];
          for (var k in old) if (k.indexOf('hub-' + lib + '-') === 0) mine.push(k);
          req('/hubs/sections/' + lib, { count: NEW_MAX, excludeElements: EXCL }, null, mine, function (d) {
            out.hubs[lib] = d; out.hubCat[lib] = HR.hubsOf(d, lib);
          });
        });
        if (ids.indexOf('ab') >= 0 && want('ab')) U.each(alibsUsed(), function (lib) {   // M4 Weiterhoeren: angefangene Hoerbuch-Tracks
          if (lib.kind !== 'audio') return;
          req('/library/sections/' + lib.id + '/all', { type: 10, 'viewOffset>': 1, sort: 'lastViewedAt:desc', 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 30,
            excludeElements: EXCL }, null, ['ab'], function (d) { var l = N.music.tracks(d), k; for (k = 0; k < l.length; k++) if (!l[k].lib) l[k].lib = lib.id; out.ab = (out.ab || []).concat(l); });
        });
        if (ids.indexOf('pl') >= 0 && want('pl')) req('/playlists/all', { type: 15, sort: 'lastViewedAt:desc', playlistType: 'video,audio',
          'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': NEW_MAX }, null, ['pl'], function (d) { out.pl = list(d); });
        step();
      }
      var baseN = 1;
      pending = 1;                                    // Waechter (siehe oben)
      req('/library/sections', null, null, null, function (d) { out.libs = H.libraries(d); out.alibs = H.allLibraries(d); if (N.libwatch) N.libwatch.note(d); });
      if (only) {                                     // nur einzelne Reihen (Bibliothek geaendert): alle anderen bleiben, wie sie sind
        for (var oid in old) if (only.indexOf(oid) < 0) keep[oid] = old[oid];
        if (only.indexOf('cw') >= 0) { baseN++; req('/hubs/continueWatching/items', { 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': H.CW_MAX, excludeElements: EXCL }, { timeout: 12000 }, ['cw'], function (d) { out.cw = list(d); tot('cw', d); }); }
        if (only.indexOf('deck') >= 0) { baseN++; req('/library/onDeck', { 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': H.CW_MAX, excludeElements: EXCL }, null, ['deck'], function (d) { out.deck = list(d); tot('deck', d); }); }
        step();
        return { abort: function () { if (done) return; done = true; for (var i = 0; i < tasks.length; i++) tasks[i].abort(); } };
      }
      if (HR.isOn(cfg, 'cw', true)) { baseN++; req('/hubs/continueWatching/items', { 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': H.CW_MAX, excludeElements: EXCL }, { timeout: 12000 }, ['cw'], function (d) { out.cw = list(d); tot('cw', d); }); }
      if (HR.isOn(cfg, 'deck', true)) { baseN++; req('/library/onDeck', { 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': H.CW_MAX, excludeElements: EXCL }, null, ['deck'], function (d) { out.deck = list(d); tot('deck', d); }); }
      step();
      return { abort: function () { if (done) return; done = true; for (var i = 0; i < tasks.length; i++) tasks[i].abort(); } };
    }
  };
  N.hubs = H;
})(N);
