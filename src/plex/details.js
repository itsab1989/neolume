/* N.det – Daten der Detailseiten (SPEC 7.6–7.8, 15; plex-parity 3.2 Nr. 8). Reine Funktionen (Node-Tests):
 * Metadaten -> Detail-Modell (Besetzung, Extras/Trailer, Aehnliche Titel, Weiterschauen-Folge, Titelmusik), Metazeile, Technik-Chips,
 * Buttons, Staffeln (Specials zuletzt), Folgen-Beschriftung, Info-Text (INFO-Panel). Abfragen: query()/seasonQuery(). */
(function (N) {
  var U = N.util, M = N.model, F = N.fmt;
  function num(v) { return Number(v) || 0; }
  function tags(list, max) { var out = []; for (var i = 0; list && i < list.length && out.length < (max || 99); i++) if (list[i].tag) out.push({ id: list[i].id, t: String(list[i].tag) }); return out; }
  function genreTags(list, max) { var t = tags(list, max); for (var i = 0; i < t.length; i++) t[i].t = N.fmt.genre(t[i].t); return t; }   // F22: App-Sprache
  var D = {
    /* Filmdetails: eine Anfrage (Player nutzt die Metadaten wieder) */
    query: function (type) {
      if (type === 'show') return { includeOnDeck: 1, includeRelated: 1, includeExtras: 1, checkFiles: 0, includeReviews: 0 };
      return { includeExtras: 1, includeRelated: 1, includeOnDeck: 1, includeChapters: 1, includeMarkers: 1, checkFiles: 0, includeReviews: 0 };
    },
    /* Folgen einer Staffel seitenweise (50), ohne Besetzung */
    seasonQuery: function (start, size) {
      return { 'X-Plex-Container-Start': start, 'X-Plex-Container-Size': size || 50, excludeElements: 'Role,Director,Writer,Producer,Country,Genre,Image,UltraBlurColors,Guid,Rating' };
    },
    /* m: Metadata-Eintrag (mit Extras/Related/OnDeck) -> Detail-Modell */
    parse: function (m, kinds) {
      var it = M.norm(m, kinds), d = { it: it, sum: String(m.summary || ''), tagline: String(m.tagline || ''), studio: String(m.studio || ''),
        genres: genreTags(m.Genre, 3), directors: tags(m.Director, 3), writers: tags(m.Writer, 3), date: String(m.originallyAvailableAt || ''),
        cast: [], extras: [], trailer: null, related: [], ondeck: null, media: m.Media || [], theme: m.theme || '', lib: num(m.librarySectionID) };
      var i, r = m.Role || [];
      for (i = 0; i < r.length && i < 20; i++) d.cast.push({ rk: 'p' + r[i].id, type: 'person', id: r[i].id, title: String(r[i].tag || ''), role: String(r[i].role || ''), thumb: r[i].thumb || '', vc: 0, off: 0, dur: 0, leaf: 0, vleaf: 0 });
      var ex = m.Extras && m.Extras.Metadata || [];
      for (i = 0; i < ex.length && i < 20; i++) {
        var x = M.norm(ex[i], kinds);
        x.extra = true; x.still = ex[i].thumb || ''; x.sub = String(ex[i].subtype || '');
        d.extras.push(x);
        if (!d.trailer && (x.sub === 'trailer' || Number(ex[i].extraType) === 1)) d.trailer = x;
      }
      var hubs = m.Related && m.Related.Hub || [];
      for (i = 0; i < hubs.length; i++) {
        var h = hubs[i], id = String(h.hubIdentifier || '');
        if (!/similar/.test(id)) continue;                 // "Aehnliche Titel" (movie.similar / tv.similar); nur Titel des eigenen Servers
        var items = M.normList(h.Metadata || [], kinds);
        if (items.length) d.related.push({ title: String(h.title || ''), items: items });
      }
      var od = m.OnDeck && m.OnDeck.Metadata;
      if (od) d.ondeck = M.norm(od, kinds);
      return d;
    },
    /* /children der Serie -> Staffeln, Specials (Staffel 0) zuletzt */
    seasons: function (json) {
      var list = json && json.MediaContainer && json.MediaContainer.Metadata || [], out = [], sp = null;
      for (var i = 0; i < list.length; i++) {
        var x = list[i];
        if (x.type !== 'season') continue;
        var s = { rk: String(x.ratingKey), index: num(x.index), title: String(x.title || ''), leaf: num(x.leafCount), vleaf: num(x.viewedLeafCount), thumb: x.thumb || '' };
        if (s.index === 0) sp = s; else out.push(s);
      }
      out.sort(function (a, b) { return a.index - b.index; });
      if (sp) out.push(sp);
      return out;
    },
    /* Start-Staffel: Wunsch (index) > Staffel der naechsten Folge > erste mit Ungesehenem > erste */
    pickSeason: function (seasons, wish, ondeck) {
      var i;
      if (wish !== undefined && wish !== null) for (i = 0; i < seasons.length; i++) if (seasons[i].index === wish) return i;
      if (ondeck) for (i = 0; i < seasons.length; i++) if (seasons[i].index === ondeck.s) return i;
      for (i = 0; i < seasons.length; i++) if (seasons[i].index !== 0 && seasons[i].vleaf < seasons[i].leaf) return i;
      return 0;
    },
    /* Staffel-Reiter: Verschiebung so, dass der fokussierte Reiter ganz sichtbar ist und links immer ein Reiter-Anfang steht
     * (nie "eason 1", TV-Test 27.10., F14). tabX [[left, width]], cur = bisherige Verschiebung, w = sichtbare Breite */
    tabOffset: function (tabX, f, cur, w) {
      if (!tabX.length || !tabX[f]) return 0;
      var l = tabX[f][0], r = l + tabX[f][1], o = cur || 0, i;
      if (l < o) o = l;
      else if (r > o + w) { o = l; for (i = 0; i < f; i++) if (tabX[i][0] >= r - w) { o = tabX[i][0]; break; } }
      var ok = false;                                  // gemessene Positionen koennen sich aendern: auf einen Reiter-Anfang legen
      for (i = 0; i < tabX.length; i++) if (tabX[i][0] === o) { ok = true; break; }
      return ok ? o : l;
    },
    tabLabel: function (s) { return s.index === 0 ? N.t('det.tab.specials') : N.t('det.tab.season', { n: s.index }); },
    /* Folgen-Fokus: Wunsch (Folgen-index) > angefangene > erste ungesehene > erste */
    pickEpisode: function (eps, wish) {
      var i;
      if (wish) for (i = 0; i < eps.length; i++) if (eps[i] && eps[i].e === wish) return i;
      for (i = 0; i < eps.length; i++) if (eps[i] && M.progress(eps[i]) > 0) return i;
      for (i = 0; i < eps.length; i++) if (eps[i] && !M.watched(eps[i])) return i;
      return 0;
    },
    /* Position einer Folgennummer in der Liste (Ziffernsprung; fehlt sie -> naechstliegende). Nicht geladene: Schaetzung */
    epIndex: function (eps, total, num0) {
      var best = -1, bd = 1e9;
      for (var i = 0; i < eps.length; i++) if (eps[i] && !eps[i].ph) { var dd = Math.abs(eps[i].e - num0); if (dd < bd) { bd = dd; best = i; } }
      if (best >= 0 && bd === 0) return best;
      var first = eps[0] && !eps[0].ph ? eps[0].e : 1, guess = U.clamp(num0 - first, 0, Math.max(0, total - 1));
      if (eps[guess] && eps[guess].ph) return guess;     // Seite noch nicht geladen -> Position schaetzen (laedt dann gezielt)
      return best >= 0 ? best : guess;
    },
    /* Beschriftung der Folgenkarte (SPEC 7.7): "F5 · Tote Magier" / "24 Min. · noch 9 Min." bzw. "· Gesehen" */
    epCaption: function (ep) {
      if (!ep || ep.ph) return ['', ''];
      var l2 = [];
      if (ep.dur) l2.push(F.dur(ep.dur));
      if (M.progress(ep) > 0) l2.push(N.t('det.left', { time: F.dur(M.remaining(ep)) }));
      else if (M.watched(ep)) l2.push(N.t('det.watched'));
      return [N.t('det.epCard', { e: ep.e, title: ep.epTitle }), F.join(l2)];
    },
    /* Metazeile (SPEC 7.6/7.7): "2024 · 2 Std. 46 Min. · FSK 12 · ★ 8,6 · noch 1 Std. 2 Min. · Ende um 23:14" */
    meta: function (it, d, now) {
      var p = [], left;
      if (it.type === 'episode') {
        if (it.dur) p.push(F.dur(it.dur));
        if (d && d.date) p.push(N.t('det.meta.firstAired', { date: D.date(d.date) }));
      } else {
        if (it.year) p.push(it.year);
        if (it.type === 'movie' && it.dur) p.push(F.dur(it.dur));
        if (it.type === 'show' && it.child) p.push(N.tn('meta.seasons', it.child));
        p.push(F.rated(it.cr));
        if (it.rating) p.push(F.rating(it.rating));
      }
      if (M.isLeaf(it) && M.progress(it) > 0) {
        left = M.remaining(it);
        p.push(N.t('det.left', { time: F.dur(left) }));
        p.push(N.t('det.meta.endsAt', { clock: F.clock(new Date((now || N.clock.now()) + left)) }));
      }
      if (it.type === 'show' && d && d.ondeck) {
        var od = d.ondeck;
        p.push(M.progress(od) > 0 ? N.t('det.meta.resumeWith', { s: od.s, e: od.e, time: F.dur(M.remaining(od)) }) : N.t('det.meta.nextUp', { s: od.s, e: od.e }));
      }
      return F.join(p);
    },
    /* "2023-10-06" -> "06.10.2023" (DE) bzw. "10/06/2023" (EN) */
    date: function (s) {
      var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
      if (!m) return '';
      return N.i18n.lang() === 'en' ? m[2] + '/' + m[3] + '/' + m[1] : m[3] + '.' + m[2] + '.' + m[1];
    },
    /* Ueberzeile: "FILM · ACTION", "SERIE", "NORDLICHT · STAFFEL 1" */
    overline: function (it, d) {
      if (it.type === 'episode') return N.t('det.overline.season', { show: it.title, s: it.s });
      var base = M.overline(it), g = d && d.genres && d.genres[0];
      if (it.type === 'movie' && N.anime && N.anime.shown(it)) return base;   // "FILM · ANIME" statt erstem Genre
      return g && it.type === 'movie' ? base + ' · ' + g.t : base;
    },
    /* Technik-Chips (SPEC 5.8): nur Sprache + Aufloesung. media = Media[] (Version mi) */
    chips: function (media, mi) {
      var out = [], md = media && media[mi || 0];
      if (!md) return out;
      var part = md.Part && md.Part[0], st = part && part.Stream || [], a = null, s = null;
      for (var i = 0; i < st.length; i++) {
        if (st[i].streamType === 2 && (st[i].selected || !a)) a = st[i];
        if (st[i].streamType === 3 && st[i].selected) s = st[i];
      }
      if (a) {
        var an = N.tracks.langName(D.lk(a), a.language);
        out.push(s ? N.t('chip.lang', { audio: an, subs: N.tracks.langName(D.lk(s), s.language) }) : an);
      }
      var r = String(md.videoResolution || '').toLowerCase();
      if (r === '4k') out.push(N.t('chip.res.4kToHd'));
      else if (r === '1080' || r === '720') out.push(N.t('chip.res.hd'));
      else if (r) out.push(N.t('chip.res.sd'));
      return out;
    },
    lk: function (s) { var x = N.tracks.streams({ Stream: [{ streamType: 2, languageCode: s.languageCode, languageTag: s.languageTag }] }); return x.audio[0] ? x.audio[0].lang : ''; },
    /* Buttons (SPEC 7.6/7.7): [{id, t}] – 'more' ist der Icon-Button "⋯" */
    buttons: function (it, d) {
      var b = [], leaf = M.isLeaf(it), od = d && d.ondeck, prog = leaf ? M.progress(it) > 0 : !!(od && M.progress(od) > 0);
      b.push({ id: 'play', t: N.t(prog || (it.type === 'show' && it.vleaf > 0 && it.vleaf < it.leaf) ? 'det.btn.resume' : 'det.btn.play') });
      if (prog) b.push({ id: 'start', t: N.t('det.btn.startOver') });
      if (it.type === 'movie' && d && d.trailer) b.push({ id: 'trailer', t: N.t('det.btn.trailer') });
      b.push({ id: 'watched', t: N.t(M.watched(it) ? 'det.btn.unwatched' : 'det.btn.watched') });
      b.push({ id: 'more', t: '', icon: 'more' });
      return b;
    },
    /* INFO-Panel: volle Beschreibung + Regie, Drehbuch, Studio, Datei (max. 600 Zeichen, SPEC 10.6) */
    info: function (it, d) {
      var lines = [];
      if (d && d.tagline) lines.push(d.tagline);
      if (d && d.sum) lines.push(U.trim(d.sum, 360));
      var p = [];
      if (d && d.directors.length) p.push(N.t('det.info.director', { names: D.names(d.directors) }));
      if (d && d.writers.length) p.push(N.t('det.info.writer', { names: D.names(d.writers) }));
      if (d && d.studio) p.push(N.t('det.info.studio', { name: d.studio }));
      if (d && d.genres.length) p.push(D.names(d.genres));
      var md = d && d.media && d.media[0];
      if (md) p.push(F.join([String(md.videoResolution || '').toUpperCase(), String(md.videoCodec || '').toUpperCase(), String(md.audioCodec || '').toUpperCase(), md.container ? String(md.container).toUpperCase() : '']));
      if (p.length) lines.push(p.join('\n'));
      return U.trim(lines.join('\n\n'), 600);
    },
    names: function (list) { var a = []; for (var i = 0; i < list.length; i++) a.push(list[i].t); return a.join(', '); },
    /* Platzhalter fuer noch nicht geladene Folgen */
    placeholder: function (s, e) { return { rk: '', ph: true, type: 'episode', title: '', epTitle: '', s: s, e: e, vc: 0, off: 0, dur: 0, leaf: 0, vleaf: 0, thumb: '', still: '' }; },
    /* Staffelstreifen-Daten aus der Folgenliste */
    stripEps: function (eps) {
      var out = [];
      for (var i = 0; i < eps.length; i++) if (eps[i] && !eps[i].ph) out.push({ index: eps[i].e, vc: eps[i].vc, off: eps[i].off, dur: eps[i].dur });
      return out;
    }
  };
  N.det = D;
})(N);
