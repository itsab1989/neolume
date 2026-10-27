/* N.music – Musik & Hoerbuecher (M4, docs/research/music-audiobooks.md). Reine Funktionen (Node-Tests) bis auf den Abschnitt
 * "Einstieg" am Ende (Router/Netz):
 * - Tracks normalisieren (Titel-Fallback aus dem Dateinamen, fehlende Media, Album- vor Kuenstlerbild), Kapitelnamen saeubern
 * - Hoerbuch: Fortsetzen je Buch aus viewOffset/viewCount/lastViewedAt der Tracks (Regel 1.4), Buch-Fortschritt, Kapitel
 *   (Tracks bzw. eingebettete M4B-Kapitel), Reihe "Weiterhoeren" (je Buch der juengste angefangene Track)
 * - Decision/Umwandlung fuer Ton: /music/:/transcode/universal, protocol=http, KEIN Bitraten-Parameter (B4), Rueckfall start.mp3
 * - Warteschlange lokal (keine POST /playQueues): Zufall (Fisher-Yates, aktueller Titel bleibt vorn), Wiederholen aus/alle/einen */
(function (N) {
  var U = N.util;
  function num(v) { return v === undefined || v === null || v === '' ? 0 : Number(v) || 0; }
  var EXT = /\.(mp3|m4a|m4b|mp4|aac|flac|wma|ogg|oga|opus|wav|aiff?)$/i;

  /* Warteschlange: items fest, order = Abspiel-Reihenfolge (Indizes in items), pos = Position in order */
  function Queue(items, start) {
    this.items = items || []; this.order = []; this.shuffle = false; this.repeat = 'off';
    for (var i = 0; i < this.items.length; i++) this.order.push(i);
    this.pos = U.clamp(start || 0, 0, Math.max(0, this.items.length - 1));
  }
  var Q = Queue.prototype;
  Q.size = function () { return this.order.length; };
  Q.cur = function () { return this.items[this.order[this.pos]] || null; };
  Q.itemAt = function (p) { return this.items[this.order[p]] || null; };
  /* naechste Position: auto = Titel zu Ende (Wiederholen "einen" bleibt stehen), sonst Nutzer (⏭). -1 = Ende */
  Q.nextPos = function (auto) {
    if (!this.order.length) return -1;
    if (auto && this.repeat === 'one') return this.pos;
    if (this.pos + 1 < this.order.length) return this.pos + 1;
    return this.repeat === 'off' ? -1 : 0;
  };
  Q.prevPos = function () {
    if (this.pos > 0) return this.pos - 1;
    return this.repeat === 'all' ? this.order.length - 1 : 0;
  };
  Q.go = function (p) { if (p >= 0 && p < this.order.length) this.pos = p; return this.cur(); };
  /* Zufall an: aktueller Titel an Position 0, Rest gemischt (rnd fuer Tests); aus: Original-Reihenfolge, Position = aktueller Titel */
  Q.setShuffle = function (on, rnd) {
    var curI = this.order[this.pos], i;
    rnd = rnd || Math.random;
    this.shuffle = !!on;
    this.order = [];
    for (i = 0; i < this.items.length; i++) this.order.push(i);
    if (on && this.items.length) {
      this.order.splice(curI, 1);
      for (i = this.order.length - 1; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)), t = this.order[i]; this.order[i] = this.order[j]; this.order[j] = t; }
      this.order.unshift(curI);
      this.pos = 0;
    } else this.pos = curI || 0;
    return this;
  };
  Q.cycleRepeat = function () { this.repeat = this.repeat === 'off' ? 'all' : this.repeat === 'all' ? 'one' : 'off'; return this.repeat; };
  /* "Als Naechstes" (hinter den aktuellen) bzw. ans Ende */
  Q.insert = function (list, next) {
    var at = next ? this.pos + 1 : this.order.length;
    for (var i = 0; i < list.length; i++) { this.items.push(list[i]); this.order.splice(at + i, 0, this.items.length - 1); }
  };
  /* Liste in Abspiel-Reihenfolge */
  Q.list = function () { var out = []; for (var i = 0; i < this.order.length; i++) out.push(this.items[this.order[i]]); return out; };

  var MU = {
    Queue: Queue,
    /* ---------- Normalisieren ---------- */
    /* Dateiname -> Titel ("/x/01. Intro.mp3" -> "Intro"); fuer Tracks ohne Titel (nicht analysiert) */
    fileTitle: function (path) {
      var b = String(path || '').split(/[\\/]/).pop().replace(EXT, '');
      return MU.stripNum(b).replace(/^\s+|\s+$/g, '');
    },
    stripNum: function (s) { var t = String(s || '').replace(/^\s*(?:cd\s*\d+\s*[-_.]\s*)?\d{1,3}(?:\s*[-_.)]\s*|\s+)/i, ''); return t || String(s || ''); },
    /* Track (type 10) -> schlankes Objekt; at = Cover des Albums (Albumseite: Tracks ohne parentThumb sonst mit dem Autorenbild, F30) */
    track: function (m, at) {
      var md = m.Media && m.Media[0], part = md && md.Part && md.Part[0];
      var t = {
        rk: String(m.ratingKey), type: 'track', lib: num(m.librarySectionID),
        title: String(m.title || '') || MU.fileTitle(part && part.file) || '?',
        artist: String(m.originalTitle || m.grandparentTitle || ''), album: String(m.parentTitle || ''),
        albumRk: m.parentRatingKey ? String(m.parentRatingKey) : '', artistRk: m.grandparentRatingKey ? String(m.grandparentRatingKey) : '',
        idx: num(m.index), disc: num(m.parentIndex) || 1, dur: num(m.duration) || num(part && part.duration) || num(md && md.duration),
        off: num(m.viewOffset), vc: num(m.viewCount), lv: num(m.lastViewedAt), added: num(m.addedAt),
        thumb: m.parentThumb || m.thumb || at || m.grandparentThumb || '', art: m.art || m.grandparentArt || '',
        chs: m.chapterSource === 'media' ? 1 : 0, codec: String(md && md.audioCodec || ''), container: String(md && md.container || ''),
        year: num(m.parentYear || m.year), vleaf: 0, leaf: 0, child: 0
      };
      var sv = N.srv ? N.srv.cur() : '';                 // Weitere Server: Titel traegt seinen Server, Bilder die Marke
      if (sv) { t.srv = sv; t.thumb = N.srv.tag(sv, t.thumb); t.art = N.srv.tag(sv, t.art); }
      return t;
    },
    tracks: function (json, at) {
      var list = json && json.MediaContainer && json.MediaContainer.Metadata || [], out = [];
      for (var i = 0; i < list.length; i++) if (list[i] && list[i].ratingKey && (list[i].type === 'track' || !list[i].type)) out.push(MU.track(list[i], at));
      return out;
    },
    isAudio: function (it) { return !!it && (it.type === 'artist' || it.type === 'album' || it.type === 'track'); },
    /* Hoerbuch-Bibliothek: Name (N.hubs: kind 'audio') oder "Store track progress" (enableTrackOffsets, 1 GET je Bibliothek) */
    isBookLib: function (lib, offsets) { return !!lib && (lib.kind === 'audio' || offsets === true); },
    offsetsOn: function (json) {
      var s = json && json.MediaContainer && json.MediaContainer.Setting || [];
      for (var i = 0; i < s.length; i++) if (s[i].id === 'enableTrackOffsets') return s[i].value === true || s[i].value === 'true' || s[i].value === '1';
      return false;
    },
    /* Beschriftung Raster/Reihe: [Zeile 1, Zeile 2]; list = Listenansicht (Interpret · Jahr · Dauer) */
    caption: function (it, list) {
      if (!it) return ['', ''];
      if (it.type === 'album') return [it.title, list ? N.fmt.join([it.artist, it.year || '']) : it.artist || (it.year ? String(it.year) : '')];
      if (it.type === 'track') return [it.title, list ? N.fmt.join([it.artist, it.dur ? MU.clock(it.dur) : '']) : it.artist];
      if (it.type === 'artist') return [it.title, it.child ? N.tn('mu.albums', it.child) : ''];
      return [it.title, ''];
    },
    /* 3:07 bzw. 1:02:07 */
    clock: function (ms) {
      var s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
      return (h ? h + ':' + U.pad2(m) : m) + ':' + U.pad2(s % 60);
    },
    totalDur: function (tracks) { var d = 0; for (var i = 0; i < tracks.length; i++) d += tracks[i].dur || 0; return d; },

    /* ---------- Kuenstlerseite: Alben nach Art (wie die offiziellen Plex-Apps) ----------
     * /library/metadata/<id>/children liefert nur die "normalen" Alben: PMS laesst dort Singles & EPs, Live-Alben, Soundtracks,
     * Kompilationen, Demos und Remixe weg (Format-/Subformat-Tags; Live-Befund 27.10.: Kuenstler mit nur einer Kompilation
     * zeigte 0 Alben). Die uebrigen Gruppen liefert /library/metadata/<id>/related als Hubs artist.albums.* (Reihenfolge wie PMS). */
    ALBUM_GROUPS: [['singles', 'mu.row.singles'], ['live', 'mu.row.live'], ['soundtrack', 'mu.row.soundtracks'],
      ['compilation', 'mu.row.compilations'], ['demo', 'mu.row.demos'], ['remix', 'mu.row.remixes']],
    /* related-JSON -> {singles: [Metadata…], live: […], …} bzw. null, wenn der Server keine Album-Hubs liefert (aeltere PMS) */
    albumHubs: function (json) {
      var hubs = json && json.MediaContainer && json.MediaContainer.Hub || [], out = null;
      for (var i = 0; i < hubs.length; i++) {
        var m = /^artist\.albums\.(\w+)$/.exec(String(hubs[i] && hubs[i].hubIdentifier || ''));
        if (m) { out = out || {}; out[m[1]] = (out[m[1]] || []).concat(hubs[i].Metadata || []); }
      }
      return out;
    },
    /* Reihen der Kuenstlerseite. main = Alben aus /children, hubs = {gruppe: [..]} (albumHubs, schon normalisiert) oder null,
     * rest = alle Alben der Abschnitts-Abfrage (Rueckfall ohne Hubs: was /children fehlt, kommt in "Weitere Alben").
     * Jedes Album genau einmal, leere Gruppen fallen weg. book: alles in EINER Reihe "Hoerbuecher".
     * -> [{id, tk, items}] */
    albumGroups: function (main, hubs, rest, book) {
      var seen = {}, out = [], i;
      function take(list) {
        var r = [];
        for (var k = 0; list && k < list.length; k++) { var x = list[k]; if (x && x.rk && !seen[x.rk]) { seen[x.rk] = 1; r.push(x); } }
        return r;
      }
      function add(id, tk, items) { if (items.length) out.push({ id: id, tk: tk, items: items }); }
      if (book) {
        var all = take(main);
        for (i = 0; hubs && i < MU.ALBUM_GROUPS.length; i++) all = all.concat(take(hubs[MU.ALBUM_GROUPS[i][0]]));
        add('albums', 'mu.row.books', all.concat(take(rest)));
        return out;
      }
      add('albums', 'mu.row.albums', take(main));
      for (i = 0; hubs && i < MU.ALBUM_GROUPS.length; i++) add(MU.ALBUM_GROUPS[i][0], MU.ALBUM_GROUPS[i][1], take(hubs[MU.ALBUM_GROUPS[i][0]]));
      add('more', 'mu.row.moreAlbums', take(rest));
      return out;
    },
    groupCount: function (groups) { var n = 0; for (var i = 0; groups && i < groups.length; i++) n += groups[i].items.length; return n; },

    /* ---------- Hoerbuch ---------- */
    /* Fortsetzen je Buch (research 1.4): juengster gehoerter Track (lastViewedAt; ohne Zeitstempel der mit Offset);
     * mit viewOffset -> dort; gehoert (viewCount) -> naechster Track bei 0; alles gehoert -> von vorn.
     * -> {i, off, state: 'new'|'resume'|'next'|'done'} */
    resume: function (tracks, endMs) {
      var k = -1, best = -1, i;
      endMs = endMs || 15000;
      for (i = 0; i < tracks.length; i++) {
        var t = tracks[i], score = t.lv || (t.off > 0 ? 1 : 0);
        if (score > best && (t.lv || t.off > 0)) { best = score; k = i; }
      }
      if (k < 0) {
        var allDone = tracks.length > 0;
        for (i = 0; i < tracks.length; i++) if (!tracks[i].vc) allDone = false;
        return { i: 0, off: 0, state: allDone ? 'done' : 'new' };
      }
      var c = tracks[k];
      if (c.off > 0 && !(c.dur && c.off > c.dur - endMs)) return { i: k, off: c.off, state: 'resume' };
      if (c.vc > 0 || c.off > 0) {
        if (k + 1 < tracks.length) return { i: k + 1, off: tracks[k + 1].off || 0, state: 'next' };
        return { i: 0, off: 0, state: 'done' };
      }
      return { i: k, off: 0, state: 'resume' };
    },
    /* Fortschritt des Buchs bis zur Fortsetzen-Stelle: {pos, total, frac, left} (ms) */
    progress: function (tracks, r) {
      var total = MU.totalDur(tracks), pos = 0;
      if (r.state === 'done') pos = total;
      else { for (var i = 0; i < r.i && i < tracks.length; i++) pos += tracks[i].dur || 0; pos += r.off || 0; }
      return { pos: pos, total: total, frac: total ? Math.min(1, pos / total) : 0, left: Math.max(0, total - pos) };
    },
    /* Zurueckspulen beim Fortsetzen nach > 1 h Pause: 5 s (Kontext), research 3.3. lv = lastViewedAt des Servers (s), daher
     * Vergleich mit der server-korrigierten Uhr (N.clock), nicht mit der TV-Uhr: die geht am Orsay teils Stunden falsch.
     * nowSec optional (Tests); ohne -> N.clock.now() */
    rewind: function (off, lv, nowSec) {
      if (nowSec === undefined) nowSec = Math.floor(N.clock.now() / 1000);
      return off > 0 && lv > 0 && nowSec - lv > 3600 ? Math.max(0, off - 5000) : off;
    },
    /* Kapitelname saeubern: "01 Begrüßung.mp3" -> "Begrüßung", "Kapitel 01"/leer -> "Kapitel n" (App-Sprache) */
    chapterName: function (t, i) {
      var s = String(t || '').replace(EXT, '').replace(/^\s+|\s+$/g, ''), c = MU.stripNum(s);
      if (/^\d+$/.test(c) || c === s && /^\d+$/.test(s)) c = '';
      if (!c || /^(chapter|kapitel|chapitre|track|titel|part|teil)\s*\d+$/i.test(c)) return N.t('pl.chapterN', { n: i + 1 });
      return c;
    },
    /* eingebettete Kapitel (Chapter[] der Metadaten) -> [{n, t, start, end}] mit sauberen Namen */
    chapters: function (list) {
      var out = N.osd.chapters(list);
      for (var i = 0; i < out.length; i++) out[i].t = MU.chapterName(out[i].t, i);
      return out;
    },
    /* Kapitel eines Buchs: eine Datei mit eingebetteten Kapiteln -> diese; sonst die Tracks.
     * -> {kind: 'embedded'|'tracks', list:[{t, start, dur, ti (Track-Index)}]} */
    bookChapters: function (tracks, embedded) {
      var out = [], i;
      if (tracks.length === 1 && embedded && embedded.length > 1) {
        for (i = 0; i < embedded.length; i++) out.push({ t: embedded[i].t, start: embedded[i].start, dur: Math.max(0, (embedded[i].end || tracks[0].dur) - embedded[i].start), ti: 0 });
        return { kind: 'embedded', list: out };
      }
      for (i = 0; i < tracks.length; i++) out.push({ t: tracks[i].title, start: 0, dur: tracks[i].dur, ti: i });
      return { kind: 'tracks', list: out };
    },
    /* "Weiterhoeren": angefangene Tracks (sortiert lastViewedAt:desc) -> je Buch (Album) nur der juengste, max. n */
    continueList: function (tracks, max) {
      var seen = {}, out = [];
      for (var i = 0; i < tracks.length && out.length < (max || 12); i++) {
        var t = tracks[i], key = t.albumRk || 't' + t.rk;
        if (seen[key]) continue;
        seen[key] = 1;
        out.push(t);
      }
      return out;
    },
    /* Karten der Reihe "Weiterhoeren": Titel = Buch, Interpret = Autor, Beschreibung = Kapitel + Rest (type 'track', OK setzt fort) */
    continueCards: function (tracks, max) {
      var l = MU.continueList(tracks.slice().sort(function (a, b) { return (b.lv || 0) - (a.lv || 0); }), max), out = [];
      for (var i = 0; i < l.length; i++) {
        var t = U.extend({}, l[i]);
        t.chTitle = t.title; t.title = t.album && t.album !== '[Unknown Album]' ? t.album : t.title; t.kind = 'audio';
        t.sum = N.fmt.join([t.chTitle !== t.title ? t.chTitle : '', t.dur ? N.t('det.left', { time: N.fmt.dur(Math.max(0, t.dur - t.off)) }) : '']);
        out.push(t);
      }
      return out;
    },
    /* Fortschritt einer Track-Karte 0..1 (Weiterhoeren) */
    trackProgress: function (t) { return t && t.dur > 0 && t.off > 0 ? Math.min(0.98, t.off / t.dur) : 0; },

    /* ---------- Decision / Umwandlung (B3/B4) ---------- */
    query: function (o) {
      var C = N.config;
      return {
        path: '/library/metadata/' + o.rk, mediaIndex: 0, partIndex: 0, protocol: 'http', location: o.wan ? 'wan' : 'lan',
        directPlay: o.dp ? 1 : 0, directStream: o.dp ? 1 : 0, offset: Math.floor((o.offsetMs || 0) / 1000),
        session: o.session, 'X-Plex-Session-Identifier': o.session, 'X-Plex-Client-Identifier': o.clientId,
        'X-Plex-Product': C.product, 'X-Plex-Version': C.version, 'X-Plex-Platform': C.platform, 'X-Plex-Device': C.device,
        'X-Plex-Token': o.token
      };
    },
    DECISION: '/music/:/transcode/universal/decision',
    startUrl: function (base, o) { var q = U.extend({}, o); q.dp = false; return base + '/music/:/transcode/universal/start.mp3?' + U.qs(MU.query(q)); },

    /* ---------- Bibliothek: alle Titel (Alle abspielen/Zufall ohne Play-Queue-POST) ---------- */
    libTracksQuery: function (libId, shuffle, max) {
      return { path: '/library/sections/' + libId + '/all', q: { type: 10, sort: shuffle ? 'random' : 'artist.titleSort,album.titleSort,track.index',
        'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': max || 200, excludeElements: 'Genre,Mood,Image,UltraBlurColors,Guid' } };
    }
  };
  N.music = MU;
})(N);
