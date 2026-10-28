/* N.model – normalisiert PMS-Metadaten in schlanke Objekte (Rohantworten werden nicht gehalten, SPEC 14.8)
 * und leitet Karten-Darstellung ab (Badges, Fortschritt, Zeile 2). Reine Funktionen. */
(function (N) {
  var U = N.util;
  function num(v) { return v === undefined || v === null || v === '' ? 0 : Number(v) || 0; }
  var M = {
    /* m: Metadata-Eintrag ; libKinds: {sectionID: 'movie'|'show'|'anime'|'doc'} */
    norm: function (m, libKinds) {
      var t = m.type, it = {
        rk: String(m.ratingKey), type: t, lib: num(m.librarySectionID),
        year: num(m.year || m.parentYear), dur: num(m.duration), off: num(m.viewOffset), vc: num(m.viewCount),
        leaf: num(m.leafCount), vleaf: num(m.viewedLeafCount), child: num(m.childCount),
        cr: m.contentRating || m.grandparentContentRating || '', rating: m.audienceRating || m.rating || '',
        sum: U.trim(m.summary || '', 420), added: num(m.addedAt)
      };
      it.kind = libKinds && libKinds[it.lib] || '';
      // Weitere Server: Antwort eines fremden Servers (Kontext aus N.plex.pms) -> Eintrag traegt seinen Server, Bilder die Marke
      var sv = N.srv ? N.srv.cur() : '';
      if (sv) it.srv = sv;
      if ((t === 'movie' || t === 'episode') && m.Media && m.Media.length > 1) it.nv = m.Media.length;   // mehrere Dateien -> "Version wählen"
      if (t === 'episode') {
        it.title = m.grandparentTitle || m.title || '';
        it.epTitle = m.title || '';
        it.s = num(m.parentIndex); it.e = num(m.index);
        it.showRk = m.grandparentRatingKey ? String(m.grandparentRatingKey) : '';
        it.seasonRk = m.parentRatingKey ? String(m.parentRatingKey) : '';
        it.thumb = m.grandparentThumb || m.parentThumb || m.thumb || '';
        it.still = m.thumb || m.grandparentArt || m.art || '';
        it.art = m.grandparentArt || m.art || '';
        if (N.comfort && m.thumb) N.comfort.markSpoiler(sv ? N.srv.tag(sv, m.thumb) : m.thumb, N.comfort.spoilerItem(it));   // Spoilerschutz: N.img.url zeichnet es unscharf
      } else if (t === 'season') {
        it.title = m.parentTitle || m.title || '';
        it.s = num(m.index);
        it.showRk = m.parentRatingKey ? String(m.parentRatingKey) : '';
        it.seasonRk = it.rk;
        it.thumb = m.thumb || m.parentThumb || '';
        it.still = m.art || '';
        it.art = m.art || m.parentArt || '';
      } else {
        it.title = String(m.title || '') || (t === 'album' || t === 'artist' ? N.t('mu.untitled') : '');   // verwaiste Alben ohne Titel (F27)
        it.showRk = t === 'show' ? it.rk : '';
        it.thumb = m.thumb || m.composite || '';          // Playlists: Collage
        if (t === 'track') { it.artist = m.originalTitle || m.grandparentTitle || ''; it.album = m.parentTitle || ''; it.albumRk = m.parentRatingKey ? String(m.parentRatingKey) : ''; it.lv = num(m.lastViewedAt); it.thumb = m.parentThumb || m.thumb || m.grandparentThumb || ''; }   // M4
        if (t === 'album') { it.artist = m.parentTitle || ''; it.artistRk = m.parentRatingKey ? String(m.parentRatingKey) : ''; }   // M4 Musik
        it.still = m.art || m.thumb || '';
        it.art = m.art || '';
      }
      if (sv) { it.thumb = N.srv.tag(sv, it.thumb); it.still = N.srv.tag(sv, it.still); it.art = N.srv.tag(sv, it.art); }
      return it;
    },
    /* libId: Bibliothek des Containers (Bibliotheksseiten tragen librarySectionID nur am MediaContainer, nicht je Eintrag).
     * ub: UltraBlurColors als 24 Hex-Zeichen mitnehmen (nur Bibliothek, "Hintergrund in Bibliotheken"; nicht im Home-Cache) */
    normList: function (list, libKinds, libId, ub) {
      var out = [];
      for (var i = 0; list && i < list.length; i++) if (list[i] && list[i].ratingKey) {
        var it = M.norm(list[i], libKinds);
        if (ub && list[i].UltraBlurColors && N.amb) it.ub = N.amb.pack(list[i].UltraBlurColors);
        if (!it.lib && libId) { it.lib = num(libId); it.kind = libKinds && libKinds[it.lib] || it.kind; }
        out.push(it);
      }
      return out;
    },
    isLeaf: function (it) { return it.type === 'movie' || it.type === 'episode'; },
    /* Filme/Serien: nur dafuer gibt es Gesehen/Ungesehen (Musik, Hoerbuecher, Playlists: nicht) */
    isVideo: function (it) { return !!it && (it.type === 'movie' || it.type === 'episode' || it.type === 'show' || it.type === 'season'); },
    /* Fortschritt 0..1 (0 = keiner bzw. ab Gesehen-Schwelle) */
    progress: function (it) {
      if (it.type === 'track') return N.music ? N.music.trackProgress(it) : 0;   // M4: Hoerbuch-Track (Weiterhoeren)
      if (!M.isLeaf(it) || !it.off || !it.dur) return 0;
      var p = it.off / it.dur;
      return p >= N.config.watchedThreshold ? 0 : p;
    },
    watched: function (it) {
      if (M.isLeaf(it)) return (it.vc > 0 && !M.progress(it)) || (it.dur > 0 && it.off / it.dur >= N.config.watchedThreshold);
      return it.leaf > 0 && it.vleaf >= it.leaf;
    },
    unwatchedCount: function (it) { return it.type === 'show' || it.type === 'season' ? Math.max(0, it.leaf - it.vleaf) : 0; },
    /* Badge: {b:'new'|'count'|'done'|'', n:'12'} (SPEC 5.2/5.3) */
    badge: function (it) {
      if (it.badgeText) return { b: 'mark', n: it.badgeText };   // Text-Marke einer Erweiterung (z. B. Zustand), ersetzt das Gesehen-Zeichen
      if (it.ext) return { b: '', n: '' };              // P4: Titel nicht auf dem Server -> kein Gesehen-/Ungesehen-Zeichen
      if (it.nNew > 1) return { b: 'count', n: N.t('card.newBadge', { n: it.nNew > 99 ? '99+' : it.nNew }) };   // "Neu in": Serie zusammengefasst
      if (M.isLeaf(it)) {
        if (M.watched(it)) return { b: 'done', n: '' };
        if (!it.vc && !it.off) return { b: 'new', n: '' };
        return { b: '', n: '' };
      }
      if (it.type === 'show' || it.type === 'season') {
        var c = M.unwatchedCount(it);
        if (c > 0) return { b: 'count', n: c > 99 ? '99+' : String(c) };
        if (M.watched(it)) return { b: 'done', n: '' };
      }
      return { b: '', n: '' };
    },
    remaining: function (it) { return Math.max(0, it.dur - it.off); },
    /* Beschriftung Landscape-Karte (Weiterschauen, Naechste Folgen) */
    landCaption: function (it) {
      if (it.type === 'episode') return [it.title, M.watched(it) ? N.t('card.sub.episode', { s: it.s, e: it.e }) : N.t('card.sub.episodeLeft', { s: it.s, e: it.e, time: N.fmt.dur(M.remaining(it)) })];
      if (it.type === 'movie') return [it.title, it.dur ? N.t('card.sub.left', { time: N.fmt.dur(M.remaining(it)) }) : (it.year || '')];
      return [it.title, ''];
    },
    posterCaption: function (it) {
      if (it.ext && it.sub) return [it.title, it.sub];   // Titel ausserhalb des Servers mit Unterzeile einer Erweiterung
      if (N.music && N.music.isAudio(it)) return N.music.caption(it, false);   // M4: Album -> Interpret, Kuenstler, Track
      if (it.type === 'season') return [it.title, N.t('card.season', { n: it.s })];
      if (it.type === 'show') return [it.title, it.child ? N.tn('meta.seasons', it.child) : (it.year || '')];
      if (it.type === 'episode') return [it.title, N.t('card.sub.episodeLeft', { s: it.s, e: it.e, time: N.fmt.dur(M.remaining(it)) })];
      return [it.title, it.year ? String(it.year) : ''];
    },
    /* Ueberzeile im Hero (SPEC 5.6 / 10.3) */
    overline: function (it) {
      // Anime je Titel (N.anime: Erkennung + "Anime als eigene Kategorie zeigen"; aus -> nur Film/Serie)
      var an = (it.type === 'movie' || it.type === 'show' || it.type === 'season' || it.type === 'episode') && N.anime && N.anime.shown(it);
      if (it.type === 'movie') return N.t(an ? 'home.overline.animeMovie' : 'home.overline.movie');
      if (it.type === 'playlist') return N.t('home.overline.playlist');
      if (it.kind === 'music' || it.kind === 'audio') return N.t('home.overline.' + it.kind);
      if (an) return N.t('home.overline.anime');
      return N.t('home.overline.show');
    }
  };
  N.model = M;
})(N);
