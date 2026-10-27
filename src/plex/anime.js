/* N.anime – Anime-Erkennung je Titel (docs/TODO.md "Anime-Erkennung"; SPEC 10.4 set.animeDetect). Reine Regeln + kleiner Cache:
 * - classify(sig, ctx) -> {anime, strength:'strong'|'weak'|'none', reason}: Signale aus den DETAIL-Metadaten (Listen kuerzen Genres).
 *   Stark: Bibliothek "Anime" · Label "Anime" · Sammlung "Anime" · Genre "Anime" · Land Japan + Animation (Japan einziges Land
 *   ODER japanische Tonspur; Koproduktionen mit Japan zaehlen nicht). Schwach: Land Japan + japanische Tonspur (trifft auch
 *   japanische Realfilme -> bei "streng" ausgeschlossen). Eigene Markierung je Profil (TOOLS-Menue) ueberstimmt alles, auch "aus".
 * - Folgen/Staffeln gelten als ihre Serie (grandparent/parent). Signale je ratingKey im LRU (klein: ein paar kurze Listen),
 *   geladen nur bei Bedarf (Hero nach Ruhe, Menue, Wiedergabe mit Anime-Regeln) bzw. aus Detail-Anfragen, die ohnehin laufen. */
(function (N) {
  var cache = new N.LRU(150), wait = {}, MAX_OV = 500;
  var EXCL = 'Role,Director,Writer,Producer,Similar,Image,UltraBlurColors,Guid,Rating,Field,Chapter,Marker';
  function low(list) { var o = []; for (var i = 0; list && i < list.length; i++) if (list[i] && list[i].tag) o.push(String(list[i].tag).toLowerCase()); return o; }
  function has(list, re) { for (var i = 0; list && i < list.length; i++) if (re.test(list[i])) return true; return false; }
  function settings() { return N.session && N.session.settings || {}; }
  function ovFile() { var p = N.session && N.session.profile; return p ? 'anime-' + (p.uuid || 'x') + '.json' : ''; }
  var RE_ANIME = /^anime$/, RE_ANIM = /^(animation|zeichentrick|animiert|anime)$/, RE_JP = /^(japan|jp)$/;
  var A = {
    MODES: ['normal', 'strict', 'off'],
    /* Video-Titel, fuer die eine Einordnung Sinn hat (Musik, Hoerbuecher, Playlists, Fotos: nie) */
    relevant: function (it) {
      return !!it && (it.type === 'movie' || it.type === 'show' || it.type === 'season' || it.type === 'episode') &&
        it.kind !== 'music' && it.kind !== 'audio' && !it.extra;
    },
    /* Schluessel: Serie fuer Folge/Staffel, sonst der Titel selbst */
    key: function (it) {
      var k = A.rkOf(it);
      return k && it.srv && N.srv ? N.srv.skey(it.srv, k) : k;   // Weitere Server: eigener Schluessel (gleiche ratingKeys moeglich)
    },
    /* ratingKey fuer die Anfrage (ohne Server-Praefix) */
    rkOf: function (it) {
      if (!it) return '';
      if (it.type === 'episode' || it.type === 'season') return it.showRk || '';
      return it.rk || '';
    },
    /* japanische Tonspur in Media[] -> true | false | undefined (keine Spuren bekannt, z. B. Serien-Metadaten) */
    jaAudio: function (media) {
      var known = false;
      for (var i = 0; media && i < media.length; i++) {
        var pt = media[i].Part || [];
        for (var j = 0; j < pt.length; j++) {
          var st = pt[j].Stream || [];
          for (var k = 0; k < st.length; k++) if (st[k].streamType === 2) {
            known = true;
            if (/^(jpn|ja)$/i.test(String(st[k].languageCode || st[k].languageTag || ''))) return true;
          }
        }
      }
      return known ? false : undefined;
    },
    /* Spuren aus N.tracks.streams -> japanischer Ton vorhanden? */
    jaTracks: function (T) { for (var i = 0; T && T.audio && i < T.audio.length; i++) if (T.audio[i].lang === 'ja') return true; return false; },
    /* Detail-Metadata -> kompakte Signale {g, l, c, co, ja} */
    signals: function (m) {
      return { g: low(m.Genre), l: low(m.Label), c: low(m.Collection), co: low(m.Country), ja: A.jaAudio(m.Media) };
    },
    /* sig: Signale (oder null = unbekannt); ctx: {mode, override: true|false|undefined, libAnime, ja} */
    classify: function (sig, ctx) {
      ctx = ctx || {};
      var mode = ctx.mode || 'normal';
      if (mode === 'off') return { anime: false, strength: 'none', reason: 'off' };   // "aus": weder Kategorie noch Wiedergaberegeln
      if (ctx.override === true) return { anime: true, strength: 'strong', reason: 'manual' };
      if (ctx.override === false) return { anime: false, strength: 'none', reason: 'manualNo' };
      var s = sig || {}, why = '', strength = 'none';
      var ja = s.ja === true || ctx.ja === true, jp = has(s.co, RE_JP);
      if (ctx.libAnime) why = 'lib';
      else if (has(s.l, RE_ANIME)) why = 'label';
      else if (has(s.c, RE_ANIME)) why = 'coll';
      else if (has(s.g, RE_ANIME)) why = 'genre';
      else if (jp && has(s.g, RE_ANIM) && (s.co.length === 1 || ja)) why = 'jpAnim';
      if (why) strength = 'strong';
      else if (jp && ja) { strength = 'weak'; why = mode === 'strict' ? 'jpAudioStrict' : 'jpAudio'; }
      else why = 'none';
      return { anime: strength === 'strong' || (strength === 'weak' && mode !== 'strict'), strength: strength, reason: why };
    },

    /* ---- eigene Markierung je Profil (lokal, N.store) ---- */
    override: function (it) {
      var f = ovFile(), k = A.key(it), all = f && N.store ? N.store.get(f) : null;
      if (!k || !all || !Object.prototype.hasOwnProperty.call(all, k)) return undefined;
      return !!all[k];
    },
    /* v: true | false | null (Markierung entfernen = automatisch) */
    setOverride: function (it, v) {
      var f = ovFile(), k = A.key(it);
      if (!f || !k) return;
      var all = N.store.get(f) || {}, n = 0, x;
      if (v === null || v === undefined) delete all[k]; else { delete all[k]; all[k] = v ? 1 : 0; }
      for (x in all) if (Object.prototype.hasOwnProperty.call(all, x)) n++;
      for (x in all) { if (n <= MAX_OV) break; if (Object.prototype.hasOwnProperty.call(all, x)) { delete all[x]; n--; } }   // aelteste zuerst
      N.store.set(f, all);
      if (N.evt) N.evt.emit('anime:changed', k);
    },

    /* ---- Cache ---- */
    learn: function (rk, m) { if (rk && m) { var old = cache.get(String(rk)), s = A.signals(m); if (s.ja === undefined && old) s.ja = old.ja; cache.set(String(rk), s); } },
    /* japanische Spur einer Folge/Datei merken (Serien-Metadaten haben keine Spuren) */
    noteAudio: function (rk, ja) { var s = rk && cache.get(String(rk)); if (s && ja !== undefined && s.ja !== true) s.ja = ja; },
    cached: function (it) { var k = A.key(it); return k ? cache.get(k) || null : null; },
    clear: function () { cache.clear(); wait = {}; },
    /* Einordnung sicherstellen (laedt die Detail-Metadaten einmal je Titel), dann cb(); ohne Netz/Fehler: cb() mit dem, was da ist */
    ensure: function (it, cb) {
      var k = A.key(it);
      cb = cb || function () {};
      if (!A.relevant(it) || !k || cache.has(k) || A.override(it) !== undefined || settings().animeDetect === 'off' || !N.plex || !N.plex.get) { cb(); return; }
      if (wait[k]) { wait[k].push(cb); return; }
      wait[k] = [cb];
      N.plex.get('/library/metadata/' + A.rkOf(it), { excludeElements: EXCL, includeExtras: 0, includeRelated: 0, includeOnDeck: 0 }, N.srv ? N.srv.o(it.srv, { timeout: 6000 }) : { timeout: 6000 }, function (err, d) {
        var m = !err && d && d.MediaContainer && d.MediaContainer.Metadata && d.MediaContainer.Metadata[0], list = wait[k] || [];
        delete wait[k];
        if (m) A.learn(k, m);
        for (var i = 0; i < list.length; i++) list[i]();
      });
    },
    /* Einordnung aus Einstellung, Markierung, Bibliothek und Cache (synchron). extra: {ja} (Spuren der laufenden Datei) */
    of: function (it, extra) {
      if (!A.relevant(it)) return { anime: false, strength: 'none', reason: 'none' };
      return A.classify(A.cached(it), { mode: settings().animeDetect || 'normal', override: A.override(it), libAnime: it.kind === 'anime',
        ja: extra && extra.ja });
    },
    is: function (it, extra) { return A.of(it, extra).anime; },
    /* "Anime als eigene Kategorie zeigen" (Standard an): aus -> nirgends "Anime" in der Oberflaeche (nur Film/Serie) */
    showCat: function () { var s = settings(); return s.animeShow !== false && s.animeDetect !== 'off'; },
    /* Anime-Wiedergaberegeln an (und Erkennung nicht aus)? */
    rulesOn: function () { var s = settings(); return !!s.anime && s.animeDetect !== 'off'; },
    /* als Anime ANZEIGEN (Ueberzeile usw.) */
    shown: function (it) { return A.showCat() && A.is(it); },
    /* Markierung im TOOLS-Menue anbieten: Erkennung an und Kategorie oder Wiedergaberegeln aktiv */
    menuOn: function (it) { return A.relevant(it) && !!A.key(it) && settings().animeDetect !== 'off' && (A.showCat() || A.rulesOn()); },
    /* Eintraege fuer das TOOLS-Menue (Karten/Details): je nach Einordnung "Als Anime behandeln" bzw. "Nicht als Anime behandeln",
     * mit eigener Markierung zusaetzlich "Anime automatisch erkennen" */
    menuButtons: function (it) {
      if (!A.menuOn(it)) return [];
      var b = [{ id: A.is(it) ? 'animeOff' : 'animeOn', t: N.t(A.is(it) ? 'menu.animeOff' : 'menu.animeOn') }];
      if (A.override(it) !== undefined) b.push({ id: 'animeAuto', t: N.t('menu.animeAuto') });
      return b;
    },
    /* Menue-Auswahl ausfuehren -> true, wenn es ein Anime-Eintrag war */
    menuPick: function (id, it) {
      if (id !== 'animeOn' && id !== 'animeOff' && id !== 'animeAuto') return false;
      A.setOverride(it, id === 'animeAuto' ? null : id === 'animeOn');
      if (N.ui && N.ui.toast) N.ui.toast.show(N.t('toast.' + id), { icon: 'confirm' });
      return true;
    },
    /* Zeile fuer das INFO-Panel ("Anime: Land Japan + Animation") oder '' (keine Merkmale / Kategorie ausgeblendet) */
    infoLine: function (it) {
      if (!A.relevant(it) || !A.showCat()) return '';
      var r = A.of(it);
      if (r.reason === 'none' || r.reason === 'off') return '';
      var line = N.t(r.anime ? 'anime.info.yes' : 'anime.info.no', { why: N.t('anime.why.' + r.reason) }), sig = A.cached(it);
      if (r.anime && sig && sig.ja === false) line += '\n' + N.t('anime.info.noJa');   // z. B. nur deutsche Synchronfassung
      return line;
    }
  };
  N.evt.on('profile:changed', function () { wait = {}; });
  N.anime = A;
})(N);
