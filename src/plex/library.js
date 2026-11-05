/* N.lib – Logik der Bibliothek (SPEC 7.5, 15; docs/research/plex-parity.md 3.1 Nr. 6). Rein bis auf load()/save() (N.store):
 * Sortierungen (je Bibliothekstyp), Filter -> Query fuer /library/sections/<id>/all (am PMS 1.43 per GET geprueft: unwatched=1,
 * inProgress=1, unwatched=0 = gesehen, genre=<id>, decade=<jahr>, resolution=<key>, collection=<id>, actor=<id>),
 * Statuszeile, Buchstaben-Register aus /firstCharacter (Offsets, T9-Ziffernsprung), Merken je Bibliothek + Profil. */
(function (N) {
  var U = N.util;
  /* sort: Server-Schluessel; desc = Standardrichtung absteigend. "Ungesehen zuerst": Filme viewCount:asc, Serien unviewedLeafCount:desc */
  var SORTS = [
    { id: 'title', movie: 'titleSort', show: 'titleSort', artist: 'titleSort', album: 'titleSort', desc: false },
    { id: 'added', movie: 'addedAt', show: 'episode.addedAt', artist: 'addedAt', album: 'addedAt', desc: true },
    { id: 'released', movie: 'originallyAvailableAt', show: 'originallyAvailableAt', album: 'year', desc: true },
    { id: 'rating', movie: 'audienceRating', show: 'audienceRating', desc: true },
    { id: 'unwatchedFirst', movie: 'viewCount', show: 'unviewedLeafCount', desc: false, showDesc: true, fixed: true },
    { id: 'lastWatched', movie: 'lastViewedAt', show: 'lastViewedAt', artist: 'lastViewedAt', album: 'lastViewedAt', desc: true, mlabel: 'lastPlayed' },
    { id: 'plays', artist: 'viewCount', album: 'viewCount', desc: true }      // M4 Musik: "Meistgehört"
  ];
  function isMusic(lib) { return !!lib && (lib.type === 'artist' || lib.type === 'album'); }
  /* Zusatzfilter mit Werteliste vom Server (lazy beim Oeffnen): Pfad /library/sections/<id>/<key> */
  var LISTS = [
    { id: 'genre', key: 'genre' },
    { id: 'decade', key: 'decade', noArtist: true },
    { id: 'res', key: 'resolution', movieOnly: true },
    { id: 'coll', key: 'collection' }
  ];
  function listOk(d, lib) { return !(d.movieOnly && tp(lib) !== 'movie') && !(d.noArtist && tp(lib) === 'artist'); }
  var STATUS = ['', 'unwatched', 'started', 'watched'];
  var T9 = { '2': 'ABC', '3': 'DEF', '4': 'GHI', '5': 'JKL', '6': 'MNO', '7': 'PQRS', '8': 'TUV', '9': 'WXYZ', '0': '#', '1': '#' };
  function sortDef(id) { for (var i = 0; i < SORTS.length; i++) if (SORTS[i].id === id) return SORTS[i]; return SORTS[0]; }
  /* Typ der Eintraege: movie | show | artist | album (Musik/Hoerbuecher: Reiter Kuenstler bzw. Alben, M4) */
  function tp(lib) { return lib && (lib.type === 'show' || lib.type === 'artist' || lib.type === 'album') ? lib.type : 'movie'; }

  var L = {
    SORTS: SORTS, LISTS: LISTS, STATUS: STATUS,
    /* Plex-Typ der Eintraege: 1 Film, 2 Serie */
    typeNum: function (lib) { var t = tp(lib); return t === 'show' ? 2 : t === 'artist' ? 8 : t === 'album' ? 9 : 1; },
    isMusic: isMusic,
    /* Sortierungen, die es fuer diesen Typ gibt */
    sorts: function (lib) { var out = [], t = tp(lib); for (var i = 0; i < SORTS.length; i++) if (SORTS[i][t]) out.push(SORTS[i]); return out; },
    sortName: function (d, lib) { return N.t('lib.sort.' + (isMusic(lib) && d.mlabel ? d.mlabel : d.id)); },
    defaults: function () { return { tab: 'lib', sort: 'title', desc: false, view: '', f: { status: '' } }; },
    /* Ansicht: gemerkt je Bibliothek, sonst Standard aus den Einstellungen (Gross) */
    view: function (prefs) { var v = prefs.view || (N.session.settings && N.session.settings.libView) || 'L'; return N.GridMath.SIZES[v] ? v : 'L'; },
    sortDef: sortDef,
    /* Standardrichtung einer Sortierung (Typ-abhaengig) */
    defDesc: function (id, lib) { var d = sortDef(id); return tp(lib) === 'show' && d.showDesc !== undefined ? d.showDesc : d.desc; },
    /* OK im Panel: anderer Eintrag -> dessen Standardrichtung; gleicher Eintrag -> Richtung umdrehen (nicht bei festen) */
    pickSort: function (prefs, id, lib) {
      var p = U.extend({}, prefs);
      if (p.sort === id && !sortDef(id).fixed) p.desc = !p.desc;
      else { p.sort = id; p.desc = L.defDesc(id, lib); }
      return p;
    },
    sortParam: function (prefs, lib) {
      var d = sortDef(prefs.sort), key = d[tp(lib)] || 'titleSort', desc = d.fixed ? L.defDesc(d.id, lib) : !!prefs.desc;
      var s = key + ':' + (desc ? 'desc' : 'asc');
      return d.id === 'title' ? s : s + ',titleSort:asc';
    },
    /* Filter-Teil der Query (ohne Sortierung/Paging) */
    filterQuery: function (prefs, lib) {
      var f = prefs.f || {}, q = { type: L.typeNum(lib) };
      if (isMusic(lib)) f = U.extend(U.extend({}, f), { status: '' });   // Musik: kein Gesehen-Filter
      if (f.status === 'unwatched') q.unwatched = 1;
      else if (f.status === 'started') q.inProgress = 1;
      else if (f.status === 'watched') q.unwatched = 0;
      for (var i = 0; i < LISTS.length; i++) { var v = f[LISTS[i].id]; if (v && v.id !== undefined && listOk(LISTS[i], lib)) q[LISTS[i].key] = v.id; }
      if (f.actor && f.actor.id !== undefined) q[f.actor.key === 'director' ? 'director' : 'actor'] = f.actor.id;   // Person (Besetzung/Suche)
      return q;
    },
    /* komplette Anfrage einer Seite: {path, q} */
    pageQuery: function (lib, prefs, start, size) {
      var q = L.filterQuery(prefs, lib);
      q.sort = L.sortParam(prefs, lib);
      q['X-Plex-Container-Start'] = start; q['X-Plex-Container-Size'] = size;
      q.excludeElements = N.hubs.EXCL; q.excludeFields = 'summary,tagline';
      return { path: '/library/sections/' + lib.id + '/all', q: q };
    },
    /* HOME-14 "Alle anzeigen" aus "Neu in …": gemerkte Werte (Ansicht) + Sortierung nur fuer diesen Besuch in ihrer Standardrichtung,
     * ohne Filter, Reiter mit den Titeln der Reihe (Musik: Alben = 'alt', Hoerbuecher: Buecher = 'lib'). Die gemerkten Werte selbst
     * bleiben unveraendert (die Ansicht speichert in diesem Besuch nichts). */
    oncePrefs: function (saved, sort, music, book) {
      var tab = music && !book ? 'alt' : 'lib', t = music ? 'album' : null;
      return { tab: tab, sort: sortDef(sort).id, desc: L.defDesc(sort, t ? { type: t } : null), view: saved && saved.view || '', f: { status: '' } };
    },
    hasFilter: function (prefs) {
      var f = prefs.f || {};
      if (f.status || f.actor) return true;
      for (var i = 0; i < LISTS.length; i++) if (f[LISTS[i].id]) return true;
      return false;
    },
    /* Register nur bei Titelsortierung (Server-Reihenfolge = Buchstaben-Reihenfolge) */
    hasRegister: function (prefs) { return prefs.sort === 'title'; },
    sortLabel: function (prefs, lib) {
      if (prefs.sort === 'title') return N.t(prefs.desc ? 'lib.sort.titleDesc' : 'lib.sort.title');
      var d = sortDef(prefs.sort), base = L.sortName(d, lib);
      return !d.fixed && prefs.desc === false ? base + ' ' + N.t('lib.sort.reversed') : base;
    },
    /* Filter in Klartext ("Nur ungesehene · Action · mit Paul Walker") */
    filterLabel: function (prefs) {
      var f = prefs.f || {}, parts = [];
      if (f.status) parts.push(N.t('lib.filter.status.' + f.status));
      for (var i = 0; i < LISTS.length; i++) if (f[LISTS[i].id]) parts.push(f[LISTS[i].id].t);
      if (f.actor) parts.push(N.t('lib.filter.with', { name: f.actor.t }));
      return N.fmt.join(parts);
    },
    /* Statuszeile (SPEC 7.5): "248 Titel · Titel A–Z" bzw. "37 von 248 Titeln · Titel A–Z · Nur ungesehene" */
    status: function (k, n, prefs, lib) {
      if (!L.hasFilter(prefs)) return N.tn(isMusic(lib) ? 'mu.status.' + tp(lib) : 'lib.status.all', k, { sort: L.sortLabel(prefs, lib) });
      return N.t('lib.status.filtered', { k: k, n: n >= 0 ? n : '?', sort: L.sortLabel(prefs, lib), filter: L.filterLabel(prefs) });
    },
    /* ---------- Buchstaben-Register ---------- */
    /* Buchstaben der Leiste in der App-Sprache: '#', A–Z, auf Norwegisch dahinter Æ Ø Å (Nutzerwunsch 03.11.) */
    letters: function (lang) { return '#ABCDEFGHIJKLMNOPQRSTUVWXYZ' + ((lang || (N.i18n && N.i18n.lang())) === 'nb' ? 'ÆØÅ' : ''); },
    /* /firstCharacter -> [{ch, n}] in der Reihenfolge des Servers ('#' zuerst); Zeichen ausserhalb der Leiste zaehlen zu '#' */
    chars: function (json, lang) {
      var list = json && json.MediaContainer && json.MediaContainer.Directory || [], out = [], abc = L.letters(lang);
      for (var i = 0; i < list.length; i++) {
        var ch = String(list[i].title || list[i].key || '').toUpperCase(), n = Number(list[i].size) || 0;
        if (!ch || !n) continue;
        if (ch.length !== 1 || ch === '#' || abc.indexOf(ch) < 0) ch = '#';
        if (out.length && out[out.length - 1].ch === ch) out[out.length - 1].n += n; else out.push({ ch: ch, n: n });
      }
      return out;
    },
    /* vorhandene Buchstaben als Zeichenkette ("#ABD…") fuer die volle A–Z-Leiste */
    present: function (chars) { var s = ''; for (var i = 0; i < chars.length; i++) if (s.indexOf(chars[i].ch) < 0) s += chars[i].ch; return s; },
    /* Buchstaben in Sortier-Reihenfolge (absteigend: umgekehrt) */
    ordered: function (chars, desc) { var a = chars.slice(); if (desc) a.reverse(); return a; },
    /* erster Index des Buchstabens; fehlt er, der naechste vorhandene in Sortier-Richtung (sonst der letzte) */
    jump: function (chars, letter, desc) {
      var a = L.ordered(chars, desc), off = 0, i, best = -1;
      if (!a.length) return { idx: 0, ch: '' };
      for (i = 0; i < a.length; i++) if (a[i].ch === letter) { best = i; break; }   // vorhanden: genau dort (Server-Reihenfolge)
      for (i = 0; best < 0 && i < a.length; i++) {
        var cmp = L.cmp(a[i].ch, letter);
        if (desc ? cmp <= 0 : cmp >= 0) { best = i; break; }
      }
      if (best < 0) best = a.length - 1;
      for (i = 0; i < best; i++) off += a[i].n;
      return { idx: off, ch: a[best].ch };
    },
    /* Reihenfolge der Leiste ('#', A–Z, Æ Ø Å); unbekannte Zeichen nach Zeichencode dahinter */
    cmp: function (a, b) {
      if (a === b) return 0;
      var abc = L.letters('nb'), x = abc.indexOf(a), y = abc.indexOf(b);
      if (x >= 0 && y >= 0) return x < y ? -1 : 1;
      if (x >= 0 || y >= 0) return x >= 0 ? -1 : 1;
      return a < b ? -1 : 1;
    },
    /* Buchstabe des Titels an Index idx */
    letterAt: function (chars, idx, desc) {
      var a = L.ordered(chars, desc), off = 0;
      for (var i = 0; i < a.length; i++) { off += a[i].n; if (idx < off) return a[i].ch; }
      return a.length ? a[a.length - 1].ch : '';
    },
    /* 5 Positionen um den aktuellen Buchstaben (SPEC 7.5): [−2, −1, aktuell, +1, +2], fehlende = '' */
    regWindow: function (chars, ch, desc) {
      var a = L.ordered(chars, desc), k = -1, out = [], i;
      for (i = 0; i < a.length; i++) if (a[i].ch === ch) k = i;
      for (i = -2; i <= 2; i++) out.push(k >= 0 && a[k + i] ? a[k + i].ch : '');
      return out;
    },
    /* Nachbar im Register (▲ = −1, ▼ = +1), ohne Wrap */
    regStep: function (chars, ch, dir, desc) {
      var a = L.ordered(chars, desc);
      for (var i = 0; i < a.length; i++) if (a[i].ch === ch) return a[Math.max(0, Math.min(a.length - 1, i + dir))].ch;
      return a.length ? a[0].ch : '';
    },
    /* ---------- A–Z-Leiste mit Finger/Maus (LIB-12, nur flexible Flaeche) ---------- */
    /* Plaetze der Leiste: passt das ganze Alphabet (n Zeichen je step px) nicht in avail, wird verdichtet wie bei iOS – ungerade
     * Anzahl Plaetze (erster und letzter Buchstabe bleiben), jeder zweite ein "•" fuer die uebersprungenen Buchstaben.
     * -> [{t: Zeichen, i: Buchstaben-Index (bei "•" -1)}], hoechstens n, mindestens 3 */
    azSlots: function (letters, avail, step) {
      var n = letters.length, s = Math.floor(avail / step), out = [], j;
      if (s >= n) { for (j = 0; j < n; j++) out.push({ t: letters.charAt(j), i: j }); return out; }
      if (s % 2 === 0) s--;
      if (s < 3) s = 3;
      for (j = 0; j < s; j++) out.push(j % 2 ? { t: '•', i: -1 } : { t: letters.charAt(Math.round(j * (n - 1) / (s - 1))), i: Math.round(j * (n - 1) / (s - 1)) });
      return out;
    },
    /* Buchstaben-Index unter dy (px ab Oberkante der Leiste) bei slots Plaetzen zu je step px fuer n Buchstaben: Platzmitten zeigen
     * genau ihren Buchstaben, dazwischen (auch ueber einem "•") linear; ober-/unterhalb der Leiste der erste bzw. letzte */
    azIndex: function (dy, slots, step, n) {
      if (n <= 1 || slots <= 1) return 0;
      var u = Math.max(0, Math.min(slots - 1, dy / step - 0.5));
      return Math.max(0, Math.min(n - 1, Math.round(u * (n - 1) / (slots - 1))));
    },
    /* Abbruchregel beim Ziehen: der Finger ist mehr als off px seitlich neben der Leiste (x0 … x0 + w) -> nicht mehr gemeint
     * (Anzeige weg, Loslassen springt nicht); zurueck an der Leiste gilt der Zug wieder. Senkrecht nie: oben/unten = erster/letzter */
    azAway: function (x, x0, w, off) { return x < x0 - off || x > x0 + w + off; },
    /* T9-Ziffernsprung (SPEC 6/7.5): 2 = A, 22 = B, 222 = C, 2222 = A …; 0/1 = '#' */
    t9: function (digit, presses) {
      var s = T9[digit];
      if (!s) return '';
      return s.charAt((Math.max(1, presses) - 1) % s.length);
    },
    /* ---------- Eingemischte Karten einer Erweiterung (LIB-13) ----------
     * Nur Titelsortierung, ohne Filter oder nur "Ungesehene" (eingemischte Titel sind nie gesehen/angefangen und haben keine
     * Genres, Jahrzehnte, Aufloesungen, Sammlungen oder Personen beim Server). */
    /* hoechstens so viele eingemischte Karten je Bibliothek (je Karte eine kleine Zaehl-Anfrage beim Oeffnen); die Erweiterung nennt
     * mehr in ihrer Statuszeile ("12 von 15 …") */
    MIX_MAX: 100,
    mixable: function (prefs) {
      var f = prefs.f || {};
      if (prefs.sort !== 'title' || f.actor || (f.status && f.status !== 'unwatched')) return false;
      for (var i = 0; i < LISTS.length; i++) if (f[LISTS[i].id]) return false;
      return true;
    },
    /* Sortier-Schluessel einer eingemischten Karte wie Plex' titleSort: fuehrender Artikel weg (am PMS 1.43 so beobachtet:
     * "The", "Der", "Das", "A", "An"); Gross/Klein spielt fuer den Server keine Rolle */
    mixKey: function (title) {
      var t = String(title || '').replace(/^\s+|\s+$/g, '');
      var m = /^(the|der|das|a|an)\s+(\S.*)$/i.exec(t);
      return m ? m[2] : t;
    },
    /* Buchstabe der Leiste fuer einen Schluessel (Umlaute/Akzente zum Grundbuchstaben; Æ Ø Å nur auf Norwegisch eigen) */
    mixLetter: function (key, lang) {
      var c = String(key || '').charAt(0).toUpperCase(), abc = L.letters(lang), F = { 'Ä': 'A', 'Á': 'A', 'À': 'A', 'Â': 'A', 'É': 'E', 'È': 'E', 'Ê': 'E', 'Ö': 'O', 'Ó': 'O', 'Ò': 'O', 'Ô': 'O', 'Ü': 'U', 'Ú': 'U', 'Í': 'I', 'Ñ': 'N', 'Ç': 'C' };
      if (abc.indexOf(c) < 0 && F[c]) c = F[c];
      return c && abc.indexOf(c) > 0 ? c : '#';
    },
    /* Abbildung Server-Index <-> Raster-Index. ks = Stelle je eingemischter Karte = Zahl der Server-Titel davor (aufsteigend
     * sortiert). Karte j steht im Raster bei ks[j] + j; ein Server-Titel s bei s + Zahl der Karten mit ks[j] <= s. */
    mix: function (ks) {
      var v = [];
      for (var j = 0; j < ks.length; j++) v.push(ks[j] + j);
      return {
        n: ks.length, ks: ks, v: v,
        toV: function (s) { var c = 0; while (c < ks.length && ks[c] <= s) c++; return s + c; },
        /* Server-Index des Raster-Index i (bei einer eingemischten Karte: der naechste Server-Titel danach) */
        toS: function (i) { var c = 0; while (c < v.length && v[c] < i) c++; return i - c; },
        phAt: function (i) { for (var j = 0; j < v.length; j++) if (v[j] === i) return j; return -1; },
        /* Server-Titel an Raster-Index i faellt weg (Gelb unter "Nur ungesehene", SPEC 6.3.1) bzw. kommt dort wieder dazu: Karten
         * dahinter ruecken mit, sonst landeten spaeter geladene Seiten um eins verschoben (doppelte bzw. fehlende Karte) */
        cut: function (i) { for (var j = 0; j < v.length; j++) if (v[j] > i) { v[j]--; ks[j]--; } },
        ins: function (i) { for (var j = 0; j < v.length; j++) if (v[j] >= i) { v[j]++; ks[j]++; } }
      };
    },
    /* Plan fuer viele eingemischte Karten (LIB-13, bis MIX_MAX): die genaue Stelle einer Karte wird erst gezaehlt, wenn sie gebraucht
     * wird. Vorher kennt der Plan nur ihren Bereich aus dem Buchstaben-Index des Servers (chars = L.chars, aufsteigend): die Zahl der
     * Server-Titel davor liegt im Bereich ihres Buchstabens, mit einem Buchstaben Spielraum davor und danach (Plex sortiert Umlaute und
     * Zeichen nicht immer wie die Leiste). keys = Schluessel je Karte (L.mixKey), desc = Z–A. Reihenfolge im Raster: bekannte Stelle bzw.
     * Bereichsanfang, dann Schluessel – eine noch ungezaehlte Karte ueberlappt nie eine schon gezeichnete Seite (need() vor jeder Seite),
     * also aendert ihr Zaehlen die Lage keiner gezeichneten Karte. Rueckgabe wie L.mix (n, toV, toS, phAt, cut, ins), dazu pos(j) =
     * Raster-Index der Karte j (-1 = unbekannt), need(a, b) = ungezaehlte Karten, die Server-Index a..b betreffen, set/drop, list. */
    mixPlan: function (keys, chars, desc, lang) {
      var tot = 0, st = [], i, j, A = [];
      for (i = 0; i < chars.length; i++) { st.push(tot); tot += chars[i].n; }
      function end(x) { return x < chars.length ? st[x] + chars[x].n : tot; }
      function fold(s) { return String(s || '').toLowerCase().replace(/[äáàâ]/g, 'a').replace(/[éèê]/g, 'e').replace(/[öóòô]/g, 'o').replace(/[üúù]/g, 'u').replace(/ß/g, 'ss'); }
      for (j = 0; j < keys.length; j++) {
        var ch = L.mixLetter(keys[j], lang), a = -1, b = -1, p;
        for (i = 0; i < chars.length; i++) if (chars[i].ch === ch) { if (a < 0) a = i; b = i; }
        if (a < 0) { for (p = 0; p < chars.length && L.cmp(chars[p].ch, ch) < 0; p++) {} a = p; b = p - 1; }   // Buchstabe fehlt beim Server
        var lo = st[Math.max(0, a - 1)] || 0, hi = end(b + 1);
        A.push({ j: j, key: fold(keys[j]), k: -1, b: -1, lo: desc ? tot - hi : lo, hi: desc ? tot - lo : hi });
      }
      function val(o) { return o.k >= 0 ? o.k : o.lo; }
      var dirty = false;
      function fix() { if (dirty) { dirty = false; sort(); } }            // nach Zaehlungen erst beim naechsten Lesen neu ordnen (einmal je Stapel)
      function sort() { A.sort(function (x, y) { return val(x) - val(y) || (x.key < y.key ? (desc ? 1 : -1) : x.key > y.key ? (desc ? -1 : 1) : x.j - y.j); }); M.n = A.length; }
      var M = {
        n: 0, total: tot, list: A,
        order: function () { fix(); return A; },
        pos: function (j) { fix(); return A[j].k >= 0 ? A[j].k + j : -1; },
        /* Server-Index s -> Raster-Index; -1, solange eine ungezaehlte Karte davor oder dahinter liegen koennte */
        toV: function (s) {
          fix();
          var c = 0;
          for (var x = 0; x < A.length; x++) {
            var o = A[x];
            if (o.k >= 0 ? o.k <= s : o.hi <= s) { c++; continue; }
            if (o.k < 0 && o.lo <= s) return -1;
            if (val(o) > s) break;
          }
          return s + c;
        },
        /* Raster-Index i -> Server-Index (bei einer Karte: der naechste Server-Titel); ungezaehlte Karten am Anfang ihres Bereichs
         * (nur fuer die Wahl der Server-Seiten). Binaere Suche: val(o) + Rang steigt streng. */
        toS: function (i) { fix(); var a = 0, b = A.length; while (a < b) { var m = (a + b) >> 1; if (val(A[m]) + m < i) a = m + 1; else b = m; } return i - a; },
        phAt: function (i) { fix(); var a = 0, b = A.length; while (a < b) { var m = (a + b) >> 1; if (val(A[m]) + m < i) a = m + 1; else b = m; } return a < A.length && A[a].k >= 0 && A[a].k + a === i ? a : -1; },
        need: function (a, b) { fix(); var out = []; for (var x = 0; x < A.length; x++) if (A[x].k < 0 && A[x].lo <= b && A[x].hi >= a) out.push(A[x]); return out; },
        /* Zaehlung (Zahl der Server-Titel davor, aufsteigend) einer Karte o; ausserhalb ihres Bereichs -> geklemmt, Rueckgabe false */
        set: function (o, before) {
          var k = desc ? tot - before : before, ok = k >= o.lo && k <= o.hi;
          o.b = before; o.k = Math.max(o.lo, Math.min(o.hi, k)); dirty = true;
          return ok;
        },
        drop: function (o) { var x = A.indexOf(o); if (x >= 0) A.splice(x, 1); M.n = A.length; },
        /* wie L.mix: Server-Titel an Raster-Index i weg (Gelb unter "Nur ungesehene") bzw. wieder da – Karten dahinter ruecken mit */
        cut: function (i) { fix(); for (var x = 0; x < A.length; x++) if (val(A[x]) + x > i) { if (A[x].k >= 0) A[x].k--; A[x].lo--; A[x].hi--; } },
        ins: function (i) { fix(); for (var x = 0; x < A.length; x++) if (val(A[x]) + x >= i) { if (A[x].k >= 0) A[x].k++; A[x].lo++; A[x].hi++; } }
      };
      sort();
      return M;
    },
    /* Raster-Seiten (GridMath.pagesFor) -> Server-Seiten, die sie fuellen (sTotal = Titel beim Server) */
    mixPages: function (mx, vpages, size, sTotal) {
      var out = [], seen = {};
      for (var i = 0; i < vpages.length; i++) {
        var a = mx.toS(vpages[i] * size), b = Math.min(sTotal - 1, mx.toS(vpages[i] * size + size - 1));
        for (var p = Math.floor(a / size); p <= Math.floor(Math.max(a, b) / size); p++) if (p * size < sTotal && !seen[p]) { seen[p] = 1; out.push(p); }
      }
      return out;
    },
    /* Buchstaben-Zaehlung des Servers (L.chars) + eingemischte Karten (Buchstaben je Karte) – Sprung/Markierung bleiben exakt */
    mixChars: function (chars, letters) {
      var out = [], i, j;
      for (i = 0; i < chars.length; i++) out.push({ ch: chars[i].ch, n: chars[i].n });
      for (j = 0; j < letters.length; j++) {
        var ch = letters[j], hit = false;
        for (i = 0; i < out.length; i++) if (out[i].ch === ch) { out[i].n++; hit = true; break; }
        if (hit) continue;
        for (i = 0; i < out.length && L.cmp(out[i].ch, ch) < 0; i++) {}
        out.splice(i, 0, { ch: ch, n: 1 });
      }
      return out;
    },
    /* Stellen aus den Zaehlungen: before[j] = Server-Titel vor Karte j (aufsteigend); absteigend = Gesamtzahl - before.
     * -> Reihenfolge der Karten im Raster [{j, k}] (nach k, bei Gleichstand nach Schluessel in Sortier-Richtung) */
    mixOrder: function (keys, before, total, desc) {
      var a = [];
      for (var j = 0; j < keys.length; j++) a.push({ j: j, k: desc ? Math.max(0, total - before[j]) : Math.min(total, before[j]), key: String(keys[j] || '').toLowerCase() });
      a.sort(function (x, y) { return x.k - y.k || (x.key < y.key ? (desc ? 1 : -1) : x.key > y.key ? (desc ? -1 : 1) : 0); });
      return a;
    },
    /* ---------- Werte-Listen der Zusatzfilter ---------- */
    values: function (json) {
      var list = json && json.MediaContainer && json.MediaContainer.Directory || [], out = [];
      for (var i = 0; i < list.length; i++) if (list[i].key !== undefined && list[i].title) out.push({ id: String(list[i].key), t: String(list[i].title) });
      return out;
    },
    lists: function (lib) { var out = []; for (var i = 0; i < LISTS.length; i++) if (listOk(LISTS[i], lib)) out.push(LISTS[i]); return out; },
    /* ---------- Alle abspielen / Zufall (Play-Queue ueber den PMS) ---------- */
    queueUri: function (mid, lib, prefs) {
      var q = L.filterQuery(prefs, lib);
      q.sort = L.sortParam(prefs, lib);
      return 'server://' + mid + '/com.plexapp.plugins.library' + U.addQs('/library/sections/' + lib.id + '/all', q);
    },
    /* ---------- Merken je Bibliothek + Profil (lib-<uuid>.json) ---------- */
    file: function () { return 'lib-' + (N.session.profile ? N.session.profile.uuid : 'x') + '.json'; },
    load: function (libId) {
      var all = N.store.get(L.file()) || {}, p = all[libId];
      var d = L.defaults();
      if (!p) return d;
      return { tab: p.tab === 'coll' || p.tab === 'alt' ? p.tab : 'lib', sort: sortDef(p.sort).id, desc: !!p.desc, view: N.GridMath.SIZES[p.view] ? p.view : '', f: p.f || { status: '' } };
    },
    /* Person-Filter (aus der Besetzung) wird nicht gemerkt */
    save: function (libId, prefs) {
      var all = N.store.get(L.file()) || {}, f = U.extend({}, prefs.f || {});
      delete f.actor;
      all[libId] = { tab: prefs.tab, sort: prefs.sort, desc: !!prefs.desc, view: prefs.view || '', f: f };
      N.store.set(L.file(), all);
    }
  };
  N.lib = L;
})(N);
