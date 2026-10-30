/* N.newsLogic – Hinweis bei neuen Inhalten (SPEC HOME-13), reine Logik ohne DOM/Netz (Tests: tests/newsnote.test.js).
 * - Einstellungen: mode (off | general | exact, Standard exact), Anzeigedauer (3/5/8/12 s, Standard 5), auch im Video (Standard aus).
 * - Ausgangsstand je Server + Profil und Bibliothek: {sig, at} (sig = Stand von N.libwatch, at = neuestes bekanntes addedAt in
 *   Server-Sekunden). Erster Lauf legt ihn nur fest (at = updatedAt/scannedAt der Bibliothek) -> nichts Altes wird gemeldet.
 *   Weicht der Stand ab, holt N.newWatch EINE kleine Liste "neu seit at" je Bibliothek (req), done() liefert Titel + neuen Stand.
 * - Gruppieren/Texte: Folgen je Serie (S1·F1 dabei = neue Serie, F1 einer Staffel = neue Staffel), Musiktitel je Album,
 *   Hoerbuch = Album einer Hoerbuch-Bibliothek; mehrere Gruppen -> eine zusammenfassende Zeile.
 * - Warteschlange: decide() sagt show | wait | drop (nie im Video ohne Erlaubnis, nie im Schoner, nie ueber Menue/Toast,
 *   nur nach Tastenruhe, veraltet nach STALE). */
(function (N) {
  var TYPES = { movie: 1, show: 4, artist: 10 };          // je Bibliotheksart: Filme, Folgen, Musiktitel
  var L = {
    MODES: ['off', 'general', 'exact'], DEF: 'exact',
    SECS: [3, 5, 8, 12], DEF_SECS: 5,
    STALE: 30 * 60000,                                   // aelter: verwerfen statt spaet melden
    REST: 1500,                                          // so lange keine Taste, bevor ein Hinweis erscheint
    SETTLE: 60000,                                       // im Video: erst so lange nach Start/Sprung/Nachladen
    PLAY_EVERY: 300000,                                  // im Video: hoechstens alle 5 Min. eine Anfrage /library/sections
    LIMIT: 60,                                           // Titel je Anfrage
    MAX_TITLE: 40,
    mode: function (st) { var m = st && st.newsNote; return L.MODES.indexOf(m) >= 0 ? m : L.DEF; },
    ms: function (st) { var s = Number(st && st.newsSecs); return (L.SECS.indexOf(s) >= 0 ? s : L.DEF_SECS) * 1000; },
    play: function (st) { return !!(st && st.newsPlay === true); },
    /* Stand einer Bibliothek wie N.libwatch.sigs */
    sig: function (d) { return d.contentChangedAt !== undefined && d.contentChangedAt !== null ? 'c' + d.contentChangedAt : 'u' + (d.updatedAt || 0); },
    seed: function (d) { return Math.max(Number(d.updatedAt) || 0, Number(d.scannedAt) || 0); },
    /* Ausgangsstand abgleichen: store {libs: {id: {sig, at}}}, dirs = /library/sections Directory; book(dir) -> Hoerbuch-Bibliothek?
     * -> {libs (neuer Stand ohne die abzuholenden), load: [{id, type, at, sig, book}], dirty} */
    plan: function (store, dirs, book) {
      var old = store && store.libs || {}, libs = {}, load = [], dirty = false, k;
      for (var i = 0; dirs && i < dirs.length; i++) {
        var d = dirs[i];
        if (!d || d.key === undefined || d.key === null || !TYPES[d.type]) continue;
        var id = String(d.key), s = L.sig(d), e = old[id];
        if (!e) { libs[id] = { sig: s, at: L.seed(d) }; dirty = true; continue; }
        libs[id] = e;
        if (e.sig !== s) load.push({ id: id, type: d.type, at: Number(e.at) || 0, sig: s, book: !!(book && book(d)) });
      }
      for (k in old) if (!libs[k]) dirty = true;
      return { libs: libs, load: load, dirty: dirty };
    },
    /* Anfrage fuer eine Bibliothek: neu seit at (Server-Sekunden), neueste zuerst; ohne at nur der neueste Titel (Stand festlegen) */
    req: function (f) {
      var p = '/library/sections/' + encodeURIComponent(f.id) + '/all?type=' + TYPES[f.type] + '&sort=addedAt:desc' + (f.at ? '&addedAt>>=' + Math.floor(f.at) : '');
      return { path: p, query: { 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': f.at ? L.LIMIT : 1, excludeFields: 'summary' } };
    },
    /* Antwort -> {entry: neuer Stand, items: neue Titel (normiert)}; ohne at nichts melden */
    done: function (f, json) {
      var l = json && json.MediaContainer && json.MediaContainer.Metadata || [], at = f.at, items = [];
      for (var i = 0; i < l.length; i++) {
        var a = Number(l[i] && l[i].addedAt) || 0;
        if (a > at) at = a;
        if (!f.at || a <= f.at) continue;                // Server ohne Filter: alte Titel nie melden
        var it = L.norm(l[i], f.book);
        if (it) items.push(it);
      }
      return { entry: { sig: f.sig, at: at }, items: items };
    },
    /* PMS-Eintrag -> {k: movie|ep|track, rk, …} oder null */
    norm: function (m, book) {
      if (!m || !m.ratingKey) return null;
      var rk = String(m.ratingKey), at = Number(m.addedAt) || 0;
      if (m.type === 'movie') return { k: 'movie', rk: rk, title: String(m.title || ''), at: at };
      if (m.type === 'episode') return { k: 'ep', rk: rk, show: String(m.grandparentTitle || ''), showRk: String(m.grandparentRatingKey || ''),
        s: Number(m.parentIndex) || 0, e: Number(m.index) || 0, at: at };
      if (m.type === 'track') return { k: 'track', rk: rk, title: String(m.title || ''), album: String(m.parentTitle || ''), albumRk: String(m.parentRatingKey || ''),
        artist: String(m.originalTitle || m.grandparentTitle || ''), n: Number(m.index) || 0, book: !!book, at: at };
      return null;
    },
    /* Titel -> Gruppen {c: movie|show|season|ep|eps|album|track|book, title, by, s, e, n, rks} in der Reihenfolge des ersten Auftretens */
    group: function (items) {
      var out = [], by = {}, i;
      for (i = 0; items && i < items.length; i++) {
        var it = items[i], g;
        if (!it) continue;
        if (it.k === 'movie') { out.push({ c: 'movie', title: it.title, n: 1, rks: [it.rk] }); continue; }
        var key = it.k === 'ep' ? 'S' + (it.showRk || it.show) : 'A' + (it.albumRk || it.album);
        g = by[key];
        if (!g) { g = by[key] = { c: it.k, title: it.k === 'ep' ? it.show : it.album || it.title, by: it.artist || '', list: [], n: 0, rks: [], showRk: it.showRk || '' }; out.push(g); }
        g.list.push(it); g.n++; g.rks.push(it.rk);
      }
      for (i = 0; i < out.length; i++) {
        var x = out[i], l = x.list;
        if (!l) continue;
        if (x.c === 'ep') {
          var first = false, seasons = {}, ns = 0, e1 = false;
          for (var j = 0; j < l.length; j++) {
            if (l[j].s === 1 && l[j].e === 1) first = true;
            if (l[j].e === 1) e1 = true;
            if (!seasons[l[j].s]) { seasons[l[j].s] = 1; ns++; }
          }
          x.s = l[0].s; x.e = l[0].e;
          x.c = first ? 'show' : ns === 1 && e1 ? 'season' : x.n === 1 ? 'ep' : 'eps';
        } else {
          var t1 = false;
          for (var m = 0; m < l.length; m++) if (l[m].n === 1) t1 = true;
          if (l[0].book) x.c = 'book';
          else if (x.n > 1 || t1) x.c = 'album';
          else { x.c = 'track'; x.title = l[0].title; }
        }
        delete x.list;
      }
      return out;
    },
    /* Oberbegriff einer Gruppe fuer Sammeltexte */
    cat: function (c) { return c === 'movie' ? 'movie' : c === 'album' ? 'album' : c === 'track' ? 'track' : c === 'book' ? 'book' : 'ep'; },
    icon: function (c) { var k = L.cat(c); return k === 'movie' ? 'film' : k === 'ep' ? 'tv' : k === 'book' ? 'book' : 'note'; },
    /* Text des Hinweises: {icon, head, line} (head leer = einzeilig). T = {t, tn} (Standard N.t/N.tn) */
    describe: function (items, mode, T) {
      T = T || { t: N.t, tn: N.tn };
      if (!items || !items.length || mode === 'off') return null;
      if (mode === 'general') return { icon: 'star', head: '', line: T.t('news.general') };
      var g = L.group(items), x = g[0];
      if (!g.length) return null;
      function q(s) { return T.t('news.q', { t: clip(s) }); }
      if (g.length === 1) {
        if (x.c === 'movie') return { icon: 'film', head: T.t('news.movie'), line: q(x.title) };
        if (x.c === 'show') return { icon: 'tv', head: T.t('news.show'), line: x.n > 1 ? T.tn('news.withEps', x.n, { t: clip(x.title) }) : q(x.title) };
        if (x.c === 'season') return { icon: 'tv', head: T.t('news.season'), line: T.t('news.seasonLine', { t: clip(x.title), s: x.s }) };
        if (x.c === 'ep') return { icon: 'tv', head: T.t('news.ep'), line: T.t('news.epLine', { t: clip(x.title), s: x.s, e: x.e }) };
        if (x.c === 'eps') return { icon: 'tv', head: T.tn('news.eps', x.n), line: q(x.title) };
        if (x.c === 'album') return { icon: 'note', head: T.t('news.album'), line: by(x) };
        if (x.c === 'track') return { icon: 'note', head: T.t('news.track'), line: by(x) };
        return { icon: 'book', head: T.t('news.book'), line: by(x) };
      }
      function by(y) { return y.by ? T.t('news.by', { t: clip(y.title), a: clip(y.by) }) : q(y.title); }
      /* mehrere Gruppen: eine Art -> "3 neue Filme" + Titel; sonst "Neu auf deinem Server" + Anzahl je Art */
      var cnt = { movie: 0, ep: 0, album: 0, track: 0, book: 0 }, kinds = 0, names = [], i;
      for (i = 0; i < g.length; i++) {
        var c = L.cat(g[i].c);
        if (!cnt[c]) kinds++;
        cnt[c] += c === 'ep' || c === 'track' ? g[i].n : 1;
        names.push(q(g[i].title));
      }
      var lst = names.join(', ');
      if (kinds === 1) {
        var k = L.cat(x.c);
        return { icon: L.icon(x.c), head: T.tn(k === 'movie' ? 'news.movies' : k === 'ep' ? 'news.eps' : k === 'album' ? 'news.albums' : k === 'track' ? 'news.tracks' : 'news.books', cnt[k]), line: lst };
      }
      var parts = [];
      ['movie', 'ep', 'album', 'track', 'book'].forEach(function (k2) { if (cnt[k2]) parts.push(T.tn('news.n.' + k2, cnt[k2])); });
      return { icon: 'star', head: T.t('news.mixed'), line: parts.join(', ') };
    },
    /* Warteschlange: neue Titel dazunehmen (gleicher rk nur einmal), veraltete verwerfen */
    merge: function (queue, items, now) {
      var have = {}, out = [], i;
      for (i = 0; queue && i < queue.length; i++) { have[queue[i].it.rk] = 1; out.push(queue[i]); }
      for (i = 0; items && i < items.length; i++) if (items[i] && !have[items[i].rk]) { have[items[i].rk] = 1; out.push({ it: items[i], at: now }); }
      return out;
    },
    prune: function (queue, now) { var out = []; for (var i = 0; queue && i < queue.length; i++) if (now - queue[i].at <= L.STALE) out.push(queue[i]); return out; },
    /* Darf jetzt ein Hinweis erscheinen? env: {saver, screen ('' = hier nie), overlay, rail, toast, netbar, rest (ms ohne Taste),
     * player: {active, calm, since} | null, play (Einstellung "Auch waehrend der Wiedergabe"), settle (ms)} -> 'show' | 'wait' */
    decide: function (env) {
      if (env.saver || !env.screen) return 'wait';
      var p = env.player;
      if (p && p.active) {
        if (!env.play || !p.calm || p.since < (env.settle === undefined ? L.SETTLE : env.settle)) return 'wait';
      } else if (env.screen === 'player') return 'wait';
      if (env.overlay || env.rail || env.toast || env.netbar) return 'wait';
      return env.rest >= L.REST ? 'show' : 'wait';
    },
    /* im Video nachsehen? nur mit Erlaubnis, ruhig laufend seit SETTLE, hoechstens alle PLAY_EVERY ms */
    playCheck: function (o) { return !!(o.play && o.active && o.calm && o.since >= (o.settle === undefined ? L.SETTLE : o.settle) && o.age >= L.PLAY_EVERY); }
  };
  function clip(s) { s = String(s || ''); return s.length > L.MAX_TITLE ? s.substring(0, L.MAX_TITLE - 1) + '…' : s; }
  N.newsLogic = L;
})(N);
