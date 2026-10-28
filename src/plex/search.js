/* N.srch – Logik der Suche (SPEC 5.14, 7.9, 15). Reine Funktionen bis auf recent()/addRecent() (N.store):
 * Bildschirmtastatur (abc/123, breite Tasten), Navigation, T9-Eingabe ueber die Zifferntasten (900 ms), Ergebnisgruppen aus
 * /hubs/search (Serien, Filme, Folgen, Personen, Sammlungen; Musik u. a. ausgeblendet), letzte Suchen je Profil. */
(function (N) {
  var U = N.util, M = N.model;
  var ABC = ['abcdef', 'ghijkl', 'mnopqr', 'stuvwx', 'yzäöüß'];
  var NUM = ['123456', "7890-'", '.&!?:,'];
  /* Englische Oberflaeche: keine Umlaut-Reihe auf abc, Umlaute stehen auf 123 (TV-Test 27.10., F15) */
  var ABC_EN = ['abcdef', 'ghijkl', 'mnopqr', 'stuvwx', 'yz'];
  var NUM_EN = NUM.concat(['äöüß']);
  var T9 = { '2': 'abcä', '3': 'def', '4': 'ghi', '5': 'jkl', '6': 'mnoö', '7': 'pqrsß', '8': 'tuvü', '9': 'wxyz', '0': ' ', '1': ".-'" };
  var GROUPS = [
    { id: 'shows', tk: 'search.group.shows', types: { show: 1 }, kind: 'posterQ' },
    { id: 'movies', tk: 'search.group.movies', types: { movie: 1 }, kind: 'posterQ' },
    { id: 'episodes', tk: 'search.group.episodes', types: { episode: 1 }, kind: 'landS' },
    { id: 'people', tk: 'search.group.people', types: { actor: 1, director: 1 }, kind: 'castS' },
    { id: 'collections', tk: 'search.group.collections', types: { collection: 1 }, kind: 'posterQ' }
  ];
  var S = {
    KX: 144, KY: 152, KS: 60, KW: 52, WIDE: 172, MAX_RECENT: 6, DELAY: 400, T9MS: 900,
    /* Tastatur-Modell: Zeilen von Tasten {k (Zeichen) | act ('space','del','mode'), x, y, w} */
    layout: function (mode, lang) {
      var en = (lang || N.i18n.lang()) === 'en', rows = [], src = mode === 'num' ? (en ? NUM_EN : NUM) : (en ? ABC_EN : ABC), r, c;
      for (r = 0; r < src.length; r++) {
        var row = [];
        for (c = 0; c < src[r].length; c++) row.push({ k: src[r].charAt(c), x: S.KX + c * S.KS, y: S.KY + r * S.KS, w: S.KW });
        rows.push(row);
      }
      var y = S.KY + src.length * S.KS;
      rows.push([{ act: 'space', x: S.KX, y: y, w: S.WIDE }, { act: 'del', x: S.KX + S.WIDE + 8, y: y, w: S.WIDE }]);
      rows.push([{ act: 'mode', x: S.KX, y: y + S.KS, w: S.WIDE }]);
      return rows;
    },
    /* Navigation in der Tastatur (kein Wrap). pos {r, c} -> neue Position oder null (Kante). Spalte wird ueber breite Tasten hinweg gemerkt (col) */
    move: function (rows, pos, dir) {
      var r = pos.r, c = pos.c, row = rows[r];
      if (dir === 'LEFT') return c > 0 ? { r: r, c: c - 1, col: S.colOf(rows, r, c - 1) } : null;
      if (dir === 'RIGHT') return c < row.length - 1 ? { r: r, c: c + 1, col: S.colOf(rows, r, c + 1) } : null;
      var nr = dir === 'UP' ? r - 1 : dir === 'DOWN' ? r + 1 : r;
      if (nr < 0 || nr >= rows.length || nr === r) return null;
      var col = pos.col !== undefined ? pos.col : S.colOf(rows, r, c);
      return { r: nr, c: S.cellFor(rows[nr], col), col: col };
    },
    /* Rasterspalte einer Taste (breite Tasten = Spalte ihrer Mitte) */
    colOf: function (rows, r, c) { var k = rows[r][c]; return Math.round((k.x + k.w / 2 - S.KX - S.KW / 2) / S.KS); },
    cellFor: function (row, col) {
      var best = 0, bd = 1e9;
      for (var i = 0; i < row.length; i++) {
        var k = row[i], x = S.KX + col * S.KS + S.KW / 2;
        if (x >= k.x && x < k.x + k.w) return i;
        var d = Math.abs(k.x + k.w / 2 - x); if (d < bd) { bd = d; best = i; }
      }
      return best;
    },
    /* rechter Rand -> Ergebnisse */
    atRight: function (rows, pos) { return pos.c === rows[pos.r].length - 1; },
    /* Zeiger: Taste unter (x, y) */
    hitKey: function (rows, x, y) {
      for (var r = 0; r < rows.length; r++) for (var c = 0; c < rows[r].length; c++) {
        var k = rows[r][c];
        if (x >= k.x && x < k.x + k.w && y >= k.y && y < k.y + S.KW) return { r: r, c: c, col: S.colOf(rows, r, c) };
      }
      return null;
    },
    /* ---------- T9 (SPEC 5.14): Mehrfachdruck innerhalb 900 ms wechselt den Buchstaben ---------- */
    T9: function () { this.d = ''; this.i = 0; this.t = 0; },
    letters: function (d) { return T9[d] || ''; },
    /* Anfrage ab 2 Zeichen (ohne Leerzeichen am Rand) */
    query: function (q) { q = String(q || '').replace(/^\s+|\s+$/g, ''); return q.length >= 2 ? q : ''; },
    /* ---------- Ergebnisse ---------- */
    /* /hubs/search -> [{id, tk, kind, items}] in fester Reihenfolge, leere Gruppen fehlen. Personen dedupliziert (gleiche id) */
    group: function (json, kinds) {
      var hubs = json && json.MediaContainer && json.MediaContainer.Hub || [], out = [], g, i, j;
      for (g = 0; g < GROUPS.length; g++) {
        var def = GROUPS[g], items = [], seen = {};
        for (i = 0; i < hubs.length; i++) {
          var h = hubs[i], t = String(h.type || h.hubIdentifier || '');
          if (!def.types[t]) continue;
          var list = h.Metadata || h.Directory || [];
          for (j = 0; j < list.length; j++) {
            var x = list[j], it;
            if (def.id === 'people') {
              if (x.id === undefined || seen['p' + x.id]) continue;
              seen['p' + x.id] = 1;
              it = { rk: 'p' + x.id, type: 'person', id: x.id, title: String(x.tag || ''), role: t === 'director' ? N.t('search.director') : '', thumb: x.thumb || '',
                lib: Number(x.librarySectionID) || 0, filter: t === 'director' ? 'director' : 'actor', vc: 0, off: 0, dur: 0, leaf: 0, vleaf: 0 };
            } else {
              if (!x.ratingKey || seen[x.ratingKey]) continue;
              seen[x.ratingKey] = 1;
              it = M.norm(x, kinds);
            }
            items.push(it);
          }
        }
        if (items.length) out.push({ id: def.id, tk: def.tk, kind: def.kind, items: items.slice(0, 20) });
      }
      return out;
    },
    /* Kartenzeile 2 in der Suche: "Serie · 2023" / "Film · 2002" / "S1 · F4" */
    caption: function (it) {
      if (it.sub) return [it.title, it.sub];          // Unterzeile einer Erweiterung (z. B. Stand einer Anfrage)
      if (it.mark) return [it.title, N.fmt.join([N.t(it.mark), it.year || ''])];   // Entdecken Stufe 2: "Auf deinem Server · 2025"
      if (it.type === 'person') return [it.title, it.role || N.t('search.person')];
      if (it.type === 'episode') return [it.epTitle || it.title, N.t('card.sub.episode', { s: it.s, e: it.e })];
      var kind = it.type === 'show' ? N.t('search.kind.show') : it.type === 'movie' ? N.t('search.kind.movie') : '';
      return [it.title, N.fmt.join([kind, it.year || ''])];
    },
    /* ---------- Zuletzt gesucht (je Profil, max. 6; pfx 'disc' = eigene Liste fuer Entdecken, P4) ---------- */
    file: function (pfx) { return (pfx || 'search') + '-' + (N.session.profile ? N.session.profile.uuid : 'x') + '.json'; },
    recent: function (pfx) { var r = N.store.get(S.file(pfx)); return r && U.isArray(r.q) ? r.q : []; },
    addRecent: function (list, q) {
      q = String(q || '').replace(/^\s+|\s+$/g, '');
      if (!q) return list;
      var out = [q], low = q.toLowerCase();
      for (var i = 0; i < list.length && out.length < S.MAX_RECENT; i++) if (String(list[i]).toLowerCase() !== low) out.push(list[i]);
      return out;
    },
    remember: function (q, pfx) { N.store.set(S.file(pfx), { q: S.addRecent(S.recent(pfx), q) }); },
    /* Vorschlaege aus dem Home-Cache (0 Anfragen): erste Poster-Reihe */
    suggestions: function (cache) {
      var rows = cache && cache.rows || [];
      for (var i = 0; i < rows.length; i++) if (rows[i].kind === 'poster' && rows[i].items && rows[i].items.length) return rows[i].items.slice(0, 12);
      return [];
    }
  };
  /* T9-Zustand: press(d, now) -> {cand, letters, idx, commit} ; commit = vorher angefangener Buchstabe, der jetzt feststeht */
  S.T9.prototype.press = function (d, now) {
    var L = T9[d] || '', out = { commit: '' };
    if (!L) return out;
    if (this.d === d && now - this.t < S.T9MS) this.i = (this.i + 1) % L.length;
    else { out.commit = this.pending(); this.d = d; this.i = 0; }
    this.t = now;
    out.cand = L.charAt(this.i); out.letters = L; out.idx = this.i;
    return out;
  };
  S.T9.prototype.pending = function () { return this.d ? (T9[this.d] || '').charAt(this.i) : ''; };
  /* nach 900 ms Ruhe bzw. vor jeder anderen Eingabe: Kandidat uebernehmen */
  S.T9.prototype.flush = function () { var c = this.pending(); this.d = ''; this.i = 0; return c; };
  S.T9.prototype.active = function () { return !!this.d; };
  N.srch = S;
})(N);
