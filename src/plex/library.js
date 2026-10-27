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
    /* /firstCharacter -> [{ch, n}] in aufsteigender Reihenfolge ('#' zuerst) */
    chars: function (json) {
      var list = json && json.MediaContainer && json.MediaContainer.Directory || [], out = [];
      for (var i = 0; i < list.length; i++) {
        var ch = String(list[i].title || list[i].key || '').toUpperCase(), n = Number(list[i].size) || 0;
        if (!ch || !n) continue;
        if (!/^[A-Z]$/.test(ch)) ch = '#';
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
      for (i = 0; i < a.length; i++) {
        var cmp = L.cmp(a[i].ch, letter);
        if (desc ? cmp <= 0 : cmp >= 0) { best = i; break; }
      }
      if (best < 0) best = a.length - 1;
      for (i = 0; i < best; i++) off += a[i].n;
      return { idx: off, ch: a[best].ch };
    },
    cmp: function (a, b) { if (a === b) return 0; if (a === '#') return -1; if (b === '#') return 1; return a < b ? -1 : 1; },
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
    /* T9-Ziffernsprung (SPEC 6/7.5): 2 = A, 22 = B, 222 = C, 2222 = A …; 0/1 = '#' */
    t9: function (digit, presses) {
      var s = T9[digit];
      if (!s) return '';
      return s.charAt((Math.max(1, presses) - 1) % s.length);
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
