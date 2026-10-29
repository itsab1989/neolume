/* N.comfort – reine Logik fuer P5 "Einstellungen & Komfort" (ohne DOM, in Node getestet; tests/comfort.test.js):
 * Bildschirmschoner (wann, welche Bilder aus dem Home-Cache; Uebergaenge/Bibliotheks-Quelle/Ecken: core/saverlogic.js), Spoilerschutz, Zurueckspulen beim Fortsetzen,
 * "Geringere Qualitaet?"-Angebot beim Puffern, Uhrzeit-Text. Die Ansichten dazu: ui/saver.js, views/help.js, views/player.js. */
(function (N) {
  var MIN = 60000;
  var spoil = {}, spoilN = 0, SPOIL_MAX = 600;
  var C = {
    SAVER_MIN: [0, 1, 2, 5, 10, 15, 30],   // Nutzerwunsch 27.10.: auch 1 und 2 Min. (Standard bleibt 5)
    REWIND: [0, 3, 5, 10, 15, 30],
    STILL_H: [0, 1, 2, 3],
    BOOST: [100, 150, 200, 300],
    /* Schoner faellig? rest = ms ohne Eingabe, minutes = Einstellung (0 = aus), st: {playing, paused}
     * Wiedergabe laeuft -> nie; Pause -> fruehestens nach 10 Min. (SPEC 7.14), sonst nach der Einstellung */
    saverDue: function (rest, minutes, st) {
      var m = Number(minutes) || 0;
      if (m <= 0 || (st && st.playing)) return false;
      if (st && st.paused) m = Math.max(m, 10);
      return rest >= m * MIN;
    },
    /* Bilder fuer den Schoner aus dem Home-Cache (0 Anfragen): erst Weiterschauen + "Neu", sonst alle Reihen; je Bild einmal */
    saverItems: function (cache, max, need) {
      var rows = cache && cache.rows || [], out = [], seen = {}, pass, i, j, k = need || 'art';   // need 'thumb': "Poster und Cover"
      max = max || 24;
      for (pass = 0; pass < 2 && !out.length; pass++) {
        for (i = 0; i < rows.length; i++) {
          var r = rows[i], pri = r.id === 'cw' || /^new-/.test(String(r.id));
          if (pass === 0 && !pri) continue;
          for (j = 0; r.items && j < r.items.length && out.length < max; j++) {
            var it = r.items[j], pic = it[k] || '';   // Hintergrundbild (TV 27.10.: Poster als Ersatz im Vollbild = Farbbrei)
            if (!pic || seen[pic]) continue;
            seen[pic] = 1;
            out.push({ art: it.art || '', thumb: it.thumb || '', sq: N.saverLogic.square(it), title: it.title || '', sub: N.saverLogic.meta(it) });
          }
        }
      }
      return out;
    },
    /* Pausen-Variante: "Pausiert · Serie S1 · F5" bzw. "Pausiert · Film" */
    pausedText: function (it) {
      if (!it) return N.t('ss.paused');
      if (it.type === 'episode') return N.t('ss.pausedEp', { show: it.title, s: it.s, e: it.e });
      return N.t('ss.pausedMovie', { title: it.title });
    },
    clock: function (d, fixed) { return fixed || N.fmt.clock(d); },

    /* ---- Spoilerschutz (SPEC 5.3, 10.4 set.spoiler) ----
     * N.model.norm meldet das Vorschaubild jeder ungesehenen, nicht angefangenen Folge; N.img.url zeichnet genau diese Bilder
     * unscharf (blur=30), solange die Einstellung an ist. So greift der Schutz in allen Reihen, ohne dass jede Ansicht ihn kennt. */
    spoilerOn: function () { var s = N.session && N.session.settings; return !!(s && s.spoiler); },
    markSpoiler: function (path, on) {
      if (!path) return;
      if (on) { if (!spoil[path]) { if (++spoilN > SPOIL_MAX) { spoil = {}; spoilN = 1; } spoil[path] = 1; } }
      else if (spoil[path]) { delete spoil[path]; spoilN--; }
    },
    isSpoiler: function (path) { return !!(path && spoil[path]) && C.spoilerOn(); },
    /* Folge, deren Inhalt geschuetzt wird: ungesehen und nicht angefangen */
    spoilerItem: function (it) { return !!it && it.type === 'episode' && !(it.vc > 0) && !(it.off > 0); },
    /* Beschreibung fuer Hero/Details: bei Schutz ein Hinweis statt des Textes (INFO zeigt ihn) */
    summary: function (it) {
      if (!it) return '';
      return C.spoilerOn() && C.spoilerItem(it) && it.sum ? N.t('spoiler.hidden') : it.sum || '';
    },
    /* Hintergrundbilder (set.backgrounds, Standard an) */
    backgrounds: function () { var s = N.session && N.session.settings; return !(s && s.backgrounds === false); },

    /* ---- Zurueckspulen beim Fortsetzen (Plex "Rewind on Resume") ---- */
    rewind: function (off, sec) {
      var s = Number(sec) || 0;
      if (!(off > 0) || s <= 0) return off || 0;
      return Math.max(0, off - s * 1000);
    },
    /* nach einer Pause > 1 Min. beim Weiterspielen etwas zurueck */
    pauseRewind: function (pausedMs, sec) { return (Number(sec) || 0) > 0 && pausedMs > MIN ? Number(sec) * 1000 : 0; },

    /* Anime: Erkennung je Titel in N.anime (plex/anime.js); set.animeDetect ersetzt die fruehere Bibliotheks-Auswahl (set.animeLibs) */

    /* ---- "Geringere Qualitaet?" (Plex Quality Suggestions): nach 20 s Laden oder 2 Nachlade-Pausen in 60 s, einmal je Video ---- */
    BufWatch: BufWatch
  };
  function BufWatch(now) { this.list = []; this.shown = false; this.t0 = now || 0; this.markAt = now || 0; }
  BufWatch.GRACE = 5000;
  /* Sprung, Start oder Fortsetzen: Nachladen in den naechsten 5 s ist erwartbar und zaehlt nicht (TV-Test 27.10., F23) */
  BufWatch.prototype.mark = function (now) { this.markAt = now; };
  /* ein Nachladen (Wechsel playing -> buffering nach dem Start) -> true = jetzt anbieten */
  BufWatch.prototype.stall = function (now) {
    if (this.shown || now - this.markAt < BufWatch.GRACE) return false;
    this.list.push(now);
    while (this.list.length && now - this.list[0] > MIN) this.list.shift();
    if (this.list.length >= 2) { this.shown = true; return true; }
    return false;
  };
  /* Startphase: laedt seit loadingMs -> true = anbieten (einmal) */
  BufWatch.prototype.loading = function (loadingMs) {
    if (this.shown || loadingMs < 20000) return false;
    this.shown = true; return true;
  };
  /* Standardwerte der P5-Einstellungen (SPEC 10.4); fehlende Werte beim Profilwechsel ergaenzen (Kinderprofil: 1 Std.) */
  C.DEFAULTS = { screensaver: 5, saverBlur: true, clock: true, backgrounds: true, spoiler: false, resumeRewind: 0, passthrough: true, audioBoost: 100,
    stillTime: 2, sleepDefault: 'off', lowerOffer: true, subColor: 'white', subDelay: 0,
    animeDetect: 'normal', animeShow: true, animeAudio: 'ja', animeSubs: 'deen', animeSigns: false,
    saverFx: 'fade', saverInterval: 30, saverSrc: 'libs', saverLibs: null, saverUnwatched: false, saverInfo: 'ambient', saverPics: 'art',   // Schoner (N.saverLogic)
    clockStyle: 'box', hints: 'always',   // Uhr auf der Startseite (C.CLOCK_STYLES), Tastenhinweise (N.ui.hints.MODES)
    accent: N.brand.accent,   // Akzentfarbe (N.accent): Standard = Farbe der Marke
    libBg: 'mood', libBgStrength: 'soft',   // Hintergrund in Bibliotheken (N.amb): Farbstimmung, dezent
    recentSearches: 8 };   // Zuletzt gesucht (N.srch.limit): 0 = Aus, 4, 8
  C.applyDefaults = function (st, kid) {
    if (!st) return st;
    for (var k in C.DEFAULTS) if (Object.prototype.hasOwnProperty.call(C.DEFAULTS, k) && st[k] === undefined) st[k] = k === 'stillTime' && kid ? 1 : C.DEFAULTS[k];
    var rs = Number(st.recentSearches);               // Zuletzt gesucht: fruehere Stufen 6/3 (bis 28.10.) -> 8/4, Aus bleibt Aus
    if (rs === 6) st.recentSearches = 8; else if (rs === 3) st.recentSearches = 4;
    if (st.recentSearches === null || st.recentSearches === '') st.recentSearches = C.DEFAULTS.recentSearches;   // leer ist nicht "Aus"
    return st;
  };
  /* Uhr auf der Startseite: box = Kasten (bisher, Standard), free = grosse duenne Ziffern frei auf weichem Eckschatten,
   * date = wie free plus Datumszeile, small = kleine ruhige Ziffern. Fehlend/unbekannt -> box. */
  C.CLOCK_STYLES = ['box', 'free', 'date', 'small'];
  C.clockStyle = function (st) { var v = st && st.clockStyle; return C.CLOCK_STYLES.indexOf(v) >= 0 ? v : 'box'; };
  N.evt.on('profile:changed', function () { if (N.session) C.applyDefaults(N.session.settings, N.session.isKid()); });
  N.comfort = C;
})(N);
