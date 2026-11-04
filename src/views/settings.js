/* Ansicht 'settings' – Einstellungen (SPEC 5.18, 7.13, 10.4; Mockup settings.html):
 * Zeilen immer 64 hoch, Fokus = surface-3 + 3-px-Amber-Rahmen, feste Beschreibungsflaeche (nodeValue, ohne Animation).
 * Kategorien (Reihenfolge docs/research/settings-order-2026-10-29.md): Wiedergabe, Ton & Untertitel, Anime, Oberflaeche,
 * [Erweiterung], Bildschirmschoner, Profil & Konto (Konto-Aktionen nur Hauptkonto, SPEC 7.15.1), Diagnose, Hilfe & Info – je Kategorie
 * EINE geordnete Liste. Mehr als 6 Zeilen: EIN Listen-Container scrollt per translate3d (Anker 3. Zeile). ◀ von jeder Zeile -> Kategorie; RETURN: Zeile -> Kategorie -> Start bzw. vorheriger Bereich (NAV-5).
 * Listen oeffnen das Auswahl-Panel (keine Wertaenderung per ◀▶). Speichern entprellt ueber N.store.
 * Finger/Trackpad (caps.scroll 'free', App.pan -> s.pan): senkrechtes Wischen ueber einer langen Liste verschiebt sie frei unter
 * dem Finger und laeuft frei aus (N.kinetic, kein Einrasten – Nr. 18; Gummiband an den Enden), der Fokus bleibt; Wischen ueber den Kategorien tut nichts. Nur Tippen setzt
 * den Fokus. Ein Tipper in den laufenden Schwung haelt ihn an (kein Klick). */
(function (N) {
  var U = N.util, CAT_Y = 112, CAT_STEP = 56, ROW_Y = 112, ROW_STEP = 64;
  N.router.define('settings', function (params) {
    var s = { rail: 'settings', wheelKeys: ['UP', 'DOWN'], flex: true };
    /* flexible Flaeche (N.screen, nur Apple): die Liste nutzt die Hoehe – je 64 px mehr eine Zeile mehr (TV: 6 Zeilen).
     * Schmal (Ansicht < 1264 breit: iPhone hoch/quer, iPad hoch, geteilte Fenster; 10-screens.md 6.3, SPEC SET-…): Kategorien und
     * Zeilen nacheinander statt nebeneinander (STACK) – erst die Liste der Kategorien, ein Tipp/OK/▶ oeffnet ihre Zeilen ueber die
     * volle Breite mit Zurueck "‹" oben links (RETURN/◀ wie bisher zurueck zu den Kategorien). Am TV nie (1280 breit). */
    var VA = N.screen.view(), STACK = N.screen.flex && VA.w < 1264, LW = STACK ? VA.w - 168 : 736, RX = STACK ? 144 : 464;
    /* Hoehe: hoeher als 720 -> mehr Zeilen; flach (nur flexibel: Mac-Fenster ab 516, iPhone quer) -> weniger Zeilen, damit die
     * Beschreibung (bis 608 + DY) ueber dem unteren Rand bleibt (Nutzerbefund 03.11.) */
    var EXTRA = VA.h >= 720 ? Math.floor((VA.h - 720) / ROW_STEP) : Math.max(-3, Math.floor((VA.h - 624) / ROW_STEP)), MAXROWS = 6 + EXTRA, DY = EXTRA * ROW_STEP;
    var titleT = null, bk = null;
    var cats = [], catEls = [], cTips = [], rowEls = [], desc, zone = 'cat', c = 0, r = 0, list = null, off = 0, more = null;
    var fl = null;                                       // freies Scrollen (nur caps.scroll 'free'): gemeinsame Hilfe N.ui.freeList
    /* Kategorien rollen (nur flexibel, Nutzerbefund 03.11.: "Hauptauswahl unten abgeschnitten"): Behaelter catIn in einem Ausschnitt
     * ab CAT_Y - 8 bis 16 ueber dem unteren Rand; fc = eigene freie Liste, catMax = Rollweite (0 = passt). Am TV nichts davon. */
    var catIn = null, fc = null, catMax = 0, CAT_TOP = CAT_Y - 8, catVis = VA.h - CAT_TOP - 72 - (N.screen.flex && N.screen.nav() !== 'tabs' ? N.screen.safe.b : 0), pz = null;   // ueber Hinweisleiste und Home-Indikator
    function st() { return N.session; }
    /* Zahl der eingeschalteten Reihen (aus Einstellung + bekannten Bibliotheken/Katalog) */
    function homeCount() {
      var S = st(), c = S.hubCatalog(), hc = S.homeCache(), libs = hc && hc.libs || [];
      return N.homeRows.enabled(S.settings && S.settings.homeRows || null, N.homeRows.avail(libs, c)).length;
    }
    /* Auswahlzeile: Wert aus den Einstellungen, OK oeffnet das Auswahl-Panel. opts: [wert, text, farbfeld (optional, .sw-<id>), unterzeile (optional)] */
    function choice(id, opts, label) {
      var S = st();
      function cur() { var v = S.settings ? S.settings[id] : null; for (var i = 0; i < opts.length; i++) if (String(opts[i][0]) === String(v)) return opts[i]; return opts[0]; }
      var row = { id: id, type: 'list', label: 'set.' + id, desc: 'set.' + id + '.desc', val: function () { return cur()[1]; },
        sw: opts[0][2] ? function () { return cur()[2]; } : null,
        open: function () {
          var e = []; for (var i = 0; i < opts.length; i++) e.push({ id: String(opts[i][0]), t: opts[i][1], sw: opts[i][2], s: opts[i][3] });
          N.ui.panel.select({ title: N.t(row.label), selected: String(cur()[0]), entries: e, onSelect: function (v) {
            for (var j = 0; j < opts.length; j++) if (String(opts[j][0]) === v) S.setSetting(id, opts[j][0]);
            paintAll();
          } });
        } };
      return row;
    }
    function toggle(id) {
      var S = st();
      return { id: id, type: 'toggle', label: 'set.' + id, desc: 'set.' + id + '.desc',
        get: function () { return !!(S.settings && S.settings[id]); }, set: function (v) { S.setSetting(id, v); } };
    }
    function v(key) { return N.t('set.v.' + key); }
    function vals(keys) { var o = []; for (var i = 0; i < keys.length; i++) o.push([keys[i], v(keys[i])]); return o; }
    function secs(list) { var o = []; for (var i = 0; i < list.length; i++) o.push([list[i], N.t('set.v.sec', { n: list[i] })]); return o; }
    /* zurueck kuerzer als vor (wie Plex/Podcast-Apps): ein zusaetzlicher Wert in derselben Liste statt einer zweiten Zeile */
    function secBF(v) { var st = N.osd.steps(v, 10); return [[v, N.t('set.v.secBF', { b: st.b, f: st.f })]]; }
    function stills() { var o = []; N.osd.STILL.forEach(function (n) { o.push([n, n ? N.tn('set.v.afterEp', n) : v('off')]); }); return o; }
    /* Stufen dieses Geraets (N.decision.steps, SPEC PLAY-37): Original (ohne Grenze) zuerst mit Unterzeile je Zeile, dann 4K (nur
     * Geraete mit caps.codecs.maxResolution >= 3840x2160) und 20 … 4 Mbit/s; INFO erklaert Original, 4K und die Datenmenge */
    function quals(id, q) {
      var D = N.decision, o = [];
      D.steps().forEach(function (k) {
        o.push(k === D.ORIG ? [k, D.label(k), null, N.t('set.v.qOrig.' + id + '.s', { q: D.label(D.top()) })] : [k, D.label(k, q)]);
      });
      var r = choice(id, o), def = { quality: '12', qualityRemote: '8', qualityCell: '4' }[id];
      r.val = function () {                         // zu hoch fuer dieses Geraet (z. B. 4K am TV): hoechste Stufe; unbekannt: Standard
        var v = D.eff(st().settings ? st().settings[id] : '', def), i;
        for (i = 0; i < o.length; i++) if (o[i][0] === v) return o[i][1];
        return D.label(def, q);
      };
      r.help = { quality: 'help.qualityOrig', qualityRemote: 'help.qualityOrigRemote', qualityCell: 'help.qualityOrigCell' }[id];
      return r;
    }
    /* Grenze ueber das Internet (Weitere Server, eigener Server unterwegs) und – nur auf Geraeten mit Mobilfunk – ueber Mobilfunk;
     * Werte wie "beim Umwandeln", 8 Mbit/s hier mit 1080p (N.decision.QWAN, seit TV-Test 1.0.4) */
    function netQuals() {
      var o = [quals('qualityRemote', N.decision.QWAN)];
      if (N.platform.caps.cellular) o.push(quals('qualityCell', N.decision.QWAN));
      return o;
    }
    /* Wiedergabe (Reihenfolge docs/research/settings-order-2026-10-29.md 2.2): Fortsetzen, Serien-Abend (Intro … Sleep-Timer),
     * Qualitaet (beim Umwandeln, ueber das Internet, [ueber Mobilfunk]) + Bildformat, Spulen. Ton-Ausgabe (Durchreichen, Verstaerkung) steht unter "Ton & Untertitel". */
    function playRows() {
      return [choice('resume', vals(['ask', 'resume', 'start'])), choice('resumeRewind', rewinds()),
        choice('skipIntro', vals(['off', 'button', 'auto'])), choice('skipCredits', vals(['off', 'button', 'auto'])), toggle('autoNext'), countdownRow(),
        choice('stillWatching', stills()), choice('stillTime', hours()), choice('sleepDefault', sleeps()),
        quals('quality')].concat(netQuals(), [toggle('directPlay'), toggle('lowerOffer'),
        choice('aspect', [['auto', v('auto')], ['orig', v('orig')], ['fill', v('fill')], ['43', v('a43')], ['zoom', v('zoom')]]),
        choice('seekArrows', secs([5, 10, 15, 30]).concat(secBF('10/30'))), ffrwRow(), choice('seekFf', secs([10, 30, 60]).concat(secBF('15/30'))),
        toggle('thumbs'), loupeRow(), loupeStyleRow()]);
    }
    /* Wartezeit vor naechster Folge: wirkt nur mit "Naechste Folge automatisch" (player/markers.js: cd nur bei autoNext) -> sonst gedimmt */
    function countdownRow() {
      var r = choice('countdown', secs([5, 8, 10, 15, 20, 30]));
      r.disabled = function () { var S = st(); return !!(S.settings && S.settings.autoNext === false); };
      r.ddesc = 'set.countdown.off.desc';
      return r;
    }
    /* Vor-/Rueckspultasten im Video (SPEC PLAY-32): Springen (Standard: gleiches Verhalten bei jedem Video, bis der Trick-Modus am
     * TV erprobt ist) oder Schnell spulen (SEF-Trick-Modus 2x…16x, ohne Ton, nur direkte Wiedergabe); INFO erklaert beides */
    function ffrwRow() {
      var r = choice('ffrw', [['jump', v('ffJump'), null, v('ffJump.s')], ['trick', v('ffTrick'), null, v('ffTrick.s')]]);
      r.help = 'help.ffrw';
      return r;
    }
    /* ===== P5 Einstellungen & Komfort (SPEC 10.4): Ton & Untertitel, Anime, Oberflaeche, Hilfe & Info ===== */
    function rewinds() { var o = []; N.comfort.REWIND.forEach(function (n) { o.push([n, n ? N.t('set.v.sec', { n: n }) : v('off')]); }); return o; }
    function hours() { var o = []; N.comfort.STILL_H.forEach(function (n) { o.push([n, n ? N.tn('set.v.afterH', n) : v('off')]); }); return o; }
    function sleeps() { return [['off', v('off')], ['end', v('sleepEnd')], [30, N.t('set.v.min', { n: 30 })], [60, N.t('set.v.min', { n: 60 })]]; }
    function boostRow() {
      var r = choice('audioBoost', [[100, v('off')], [150, v('boostS')], [200, v('boostM')], [300, v('boostL')]]);
      r.disabled = function () { var S = st(); return !(S.settings && S.settings.passthrough === false); };
      r.ddesc = 'set.audioBoost.disabled';
      return r;
    }
    /* Feinauswahl am Fortschrittsbalken (SPEC PLAY-30, Standard aus): nur mit Zeiger-Steuerung bedienbar, INFO erklaert Bedienung */
    function loupeRow() {
      var r = toggle('ptrLoupe');
      r.disabled = function () { return st().state.pointer === false; };
      r.ddesc = 'set.ptrLoupe.off.desc'; r.help = 'help.ptrLoupe';
      return r;
    }
    /* Darstellung der Feinauswahl (SPEC PLAY-31): drei Formen (A Standard, B, D; C entfallen) auf derselben Logik, je mit Unterzeile; gedimmt ohne Zeiger bzw. ohne
     * Feinauswahl. Filmstreifen ohne Vorschaubilder -> Panel; Jetzt laeuft immer B (INFO erklaert beides) */
    function loupeStyleRow() {
      var o = [];
      N.Loupe.STYLES.forEach(function (k) { var c = 'lp' + k.charAt(0).toUpperCase() + k.slice(1); o.push([k, v(c), null, v(c + '.s')]); });
      var r = choice('loupeStyle', o);
      r.disabled = function () { var S = st(); return S.state.pointer === false || !(S.settings && S.settings.ptrLoupe === true); };
      r.ddesc = function () { return st().state.pointer === false ? 'set.ptrLoupe.off.desc' : 'set.loupeStyle.off.desc'; };
      r.help = 'help.loupeStyle';
      return r;
    }
    function delays() { var o = []; N.osd.DELAYS.forEach(function (ms) { o.push([ms, N.osd.delayText(ms)]); }); return o; }
    /* Ton & Untertitel: erst die drei Grundwahlen, dann Darstellung der Untertitel, zuletzt Technik (ASS, Ton-Ausgabe) */
    function subsRows() {
      return [choice('audioLang', vals(['de', 'en', 'no', 'ja', 'server'])), choice('subs', vals(['off', 'forced', 'foreign', 'always', 'server'])),
        choice('subLang', vals(['de', 'en', 'no'])), toggle('rememberTracks'), choice('subSize', vals(['small', 'medium', 'large', 'xl'])),
        choice('subColor', vals(['white', 'yellow'])), choice('subBg', vals(['none', 'dim', 'solid'])), choice('subPos', vals(['low', 'high'])), choice('subDelay', delays()),
        choice('ass', vals(['burn', 'text'])), toggle('passthrough'), boostRow()];
    }
    /* Anime (docs/TODO.md "Anime-Erkennung"): Erkennung je Titel (normal/streng/aus) -> "als eigene Kategorie zeigen" (Ueberzeile, INFO)
     * und "Anime-Wiedergaberegeln" (Ton/UT) unabhaengig voneinander; Erkennung "aus" dimmt beide. Feinere Regeln gedimmt, solange die
     * Wiedergaberegeln aus sind. */
    function animeRows() {
      var S = st();
      function off() { return !!(S.settings && S.settings.animeDetect === 'off'); }
      function dimOff(r) { r.disabled = off; r.ddesc = 'set.animeDetect.off.desc'; return r; }
      function dim(r) {
        r.disabled = function () { return off() || !(S.settings && S.settings.anime); };
        r.ddesc = function () { return off() ? 'set.animeDetect.off.desc' : 'set.anime.off.desc'; };
        return r;
      }
      var det = choice('animeDetect', vals(['off', 'normal', 'strict'])), show = dimOff(toggle('animeShow')), rules = dimOff(toggle('anime'));
      return [det, show, rules, dim(choice('animeAudio', vals(['ja', 'de', 'same']))), dim(choice('animeSubs', vals(N.i18n.lang() === 'nb' ? ['off', 'noen', 'no', 'deen', 'de'] : ['off', 'deen', 'de']))),
        dim(toggle('animeSigns'))];
    }
    /* Akzentfarbe (N.accent): Palette mit Farbfeld, Standardfarbe der Marke zuerst; wirkt sofort (settings:changed) */
    function accentRow() {
      var o = [], ids = N.accent.ids(), b = N.accent.base();
      for (var i = 0; i < ids.length; i++) o.push([ids[i], v('ac_' + ids[i]), ids[i]]);
      for (i = 0; i < o.length; i++) if (o[i][0] === b) o.unshift(o.splice(i, 1)[0]);   // Standard zuerst
      return choice('accent', o);
    }
    /* Farbe der Markierungen (ACC-2, N.accent.badge): Dreieck neu/ungesehen, Haken gesehen, Zahl ungesehener Folgen auf Kacheln;
     * Hellgrau (bisher, Standard) zuerst, dann die Akzent-Palette in ihrer Reihenfolge. Steht direkt unter der Akzentfarbe: beides
     * sind Farbwahlen mit Farbfeld, wer eine sucht, findet die andere daneben (docs/research/settings-order-2026-10-29.md) */
    function badgeRow() {
      var o = [], ids = N.accent.badgeIds();
      for (var i = 0; i < ids.length; i++) o.push([ids[i], v(ids[i] === N.accent.LIGHT ? 'bdLight' : 'ac_' + ids[i]), ids[i]]);
      var r = choice('badgeColor', o);
      r.help = 'help.badgeColor';
      return r;
    }
    /* Uhr auf der Startseite (ui/saver.js, N.comfort.CLOCK_STYLES): vier Stile mit Unterzeile, gedimmt bei "Uhrzeit anzeigen" aus */
    function clockStyleRow() {
      var S = st(), o = [];
      N.comfort.CLOCK_STYLES.forEach(function (k) { var c = 'cs' + k.charAt(0).toUpperCase() + k.slice(1); o.push([k, v(c), null, v(c + '.s')]); });
      var r = choice('clockStyle', o);
      r.val = function () { var k = N.comfort.clockStyle(S.settings); return v('cs' + k.charAt(0).toUpperCase() + k.slice(1)); };
      r.disabled = function () { return !!(S.settings && S.settings.clock === false); };
      r.ddesc = 'set.clockStyle.off.desc'; r.help = 'help.clockStyle';
      return r;
    }
    /* Hinweis bei neuen Inhalten (N.newsLogic, SPEC HOME-13): Elternzeile Aus/Allgemein/Genau, darunter Anzeigedauer und "Auch
     * waehrend der Wiedergabe" (beide gedimmt bei Aus). Steht im Block "Hinweise" direkt vor den Tastenhinweisen. */
    function newsRows() {
      var S = st(), NL = N.newsLogic;
      function off() { return NL.mode(S.settings) === 'off'; }
      var m = choice('newsNote', [['off', v('off'), null, v('nnOff.s')], ['general', v('nnGeneral'), null, v('nnGeneral.s')], ['exact', v('nnExact'), null, v('nnExact.s')]]);
      m.val = function () { return v({ off: 'off', general: 'nnGeneral', exact: 'nnExact' }[NL.mode(S.settings)]); };   // fehlend/unbekannt = Standard
      m.help = 'help.newsNote';
      var d = choice('newsSecs', secs(NL.SECS));
      d.val = function () { return N.t('set.v.sec', { n: NL.ms(S.settings) / 1000 }); };
      d.disabled = off; d.ddesc = 'set.newsNote.off.desc'; d.help = 'help.newsSecs';
      var p = toggle('newsPlay');
      p.disabled = off; p.ddesc = 'set.newsNote.off.desc'; p.help = 'help.newsPlay';
      return [m, d, p];
    }
    /* Tastenhinweise (N.ui.hints): Immer / Nur kurz / Aus; INFO erklaert, wo die Tasten sonst stehen (Tastenbelegung) */
    function hintsRow() {
      var r = choice('hints', [['off', v('hOff'), null, v('hOff.s')], ['brief', v('hBrief'), null, v('hBrief.s')], ['always', v('hAlways'), null, v('hAlways.s')]]);   // Aus zuerst (wie ueberall)
      r.help = 'help.hints';
      return r;
    }
    /* Zuletzt gesucht (N.srch.limit, Nutzer-Feedback 28.10.): Aus / 4 / 8 Begriffe (Standard 8; fruehere 6/3 -> 8/4 in N.comfort.applyDefaults), auch fuer Kinderprofile; Aus loescht die Listen
     * (N.srch.applyLimit ueber settings:changed). INFO erklaert Rot zum Entfernen und "Verlauf loeschen" */
    function recentRow() {
      var r = choice('recentSearches', [[0, v('off')], [4, N.tn('set.v.terms', 4)], [8, N.tn('set.v.terms', 8)]]);
      r.help = 'help.recentSearches';
      return r;
    }
    /* Kategorie Bildschirmschoner (ui/saver.js, core/saverlogic.js; nur Erwachsene): "Bildschirmschoner nach", Einblendung, Uebergang,
     * Takt, Bildart, unscharf, Quelle, Bibliotheken, Ungesehenes, Nachtruhe. Schoner aus -> alle gedimmt; Bibliotheken/Ungesehenes
     * nur bei Quelle "Bibliotheken". */
    function saverRows() {
      var S = st(), SL = N.saverLogic;
      function off() { return !(S.settings && Number(S.settings.screensaver) > 0); }
      function dim(r) { r.disabled = off; r.ddesc = 'set.saver.off.desc'; return r; }
      function dimLib(r) {
        r.disabled = function () { return off() || !(S.settings && S.settings.saverSrc === 'libs'); };
        r.ddesc = function () { return off() ? 'set.saver.off.desc' : 'set.saverLibs.off.desc'; };
        return r;
      }
      function opts(list, pre) { var o = []; for (var i = 0; i < list.length; i++) o.push([list[i], v(pre + list[i])]); return o; }
      var fx = dim(choice('saverFx', opts(SL.FX, 'fx_'))), info = dim(choice('saverInfo', opts(SL.INFOS, 'inf_')));
      fx.help = 'help.saverFx'; info.help = 'help.saverInfo';      // INFO: jede Moeglichkeit erklaert (zu lang fuer die Beschreibungszeile)
      var pics = dim(choice('saverPics', opts(SL.PICS, 'pics_')));   // SAV-5: echte Hintergrundbilder / auch Standbilder / Poster
      pics.help = 'help.saverPics';
      var on = choice('screensaver', [[0, v('off')]].concat(N.comfort.SAVER_MIN.slice(1).map(function (n) { return [n, N.t('set.v.min', { n: n })]; })));
      // Elternzeile oben; dann was man sieht (Einblendung, Uebergang, Takt, Bildart, unscharf), Quelle, zuletzt die Langzeit-Regel
      return [on, info, fx, dim(choice('saverInterval', secs(SL.SEC))), pics, dim(toggle('saverBlur')),   // saverBlur (F21): weich (Standard) oder scharf
        dim(choice('saverSrc', [['libs', v('src_libs')], ['home', v('src_home')]])), dimLib(saverLibsRow()), dimLib(toggle('saverUnwatched')), dim(nightRow())];
    }
    /* "Nach langer Zeit nur noch die Uhr" (SAV-6): 1/2 (Standard)/4 Std./Nie; fehlend/unbekannt zeigt den Standard (wie N.saverLogic.night).
     * INFO erklaert, warum (Speicher aelterer TVs, Einbrennen, Strom) und was "Nie" bedeutet */
    function nightRow() {
      var S = st(), SL = N.saverLogic, o = [];
      SL.NIGHT.forEach(function (n) { o.push([n, n ? N.tn('set.v.hrs', n / 60) : v('never')]); });
      var r = choice('saverNight', o);
      r.val = function () {
        var m = SL.night(S.settings ? S.settings.saverNight : null) / 60000;
        for (var i = 0; i < o.length; i++) if (o[i][0] === m) return o[i][1];
        return o[1][1];
      };
      r.help = 'help.saverNight';
      return r;
    }
    /* Mehrfachauswahl der Bibliotheken (Panel mit Haken); keine Auswahl = Standard (alle Film- und Serien-Bibliotheken) */
    function saverLibsRow() {
      var S = st();
      function all() { var hc = S.homeCache(); return hc && (hc.alibs || hc.libs) || []; }   // Bibliotheken dieses Profils
      function sel() { return S.settings && S.settings.saverLibs && S.settings.saverLibs.length ? S.settings.saverLibs : null; }
      return { id: 'saverLibs', type: 'list', label: 'set.saverLibs', desc: 'set.saverLibs.desc',
        val: function () { var s0 = sel(); return s0 ? N.tn('set.saverLibs.val', N.saverLogic.libs(s0, all()).length) : v('libsAuto'); },
        open: function () {
          var libs = all(), cur = N.saverLogic.libs(sel(), libs), on = {}, e = [], i;
          for (i = 0; i < cur.length; i++) on[cur[i].id] = 1;
          for (i = 0; i < libs.length; i++) if (N.saverLogic.TYPE[libs[i].type]) e.push({ id: String(libs[i].id), t: libs[i].title, on: !!on[libs[i].id] });
          N.ui.panel.select({ title: N.t('set.saverLibs'), multi: true, entries: e, onDone: function (ids) {
            var nums = [];
            for (var j = 0; j < ids.length; j++) nums.push(Number(ids[j]));
            S.setSetting('saverLibs', nums.length ? nums : null);
            paintAll();
          } });
        } };
    }
    /* Hintergrund in Bibliotheken (N.amb, ui/ambient.js): Modus und Staerke mit Erklaerung je Wert; Staerke gedimmt bei "Aus" */
    function libBgRows() {
      /* Startseite mit Kacheln (Apple, HOME-17): dieselbe Einstellung gilt auch hinter den Kacheln der Startseite -> eigene Texte
       * ("Seitenhintergrund"); TV: Texte wie bisher (Hero, Hintergrund nur in Bibliotheken) */
      var S = st(), A = N.amb, T = N.platform.caps.home === 'tiles';
      function opt(val, k) { return [val, v(k), null, v(k + (T && k === 'bgRandom' ? '.sT' : '.s'))]; }
      var m = choice('libBg', [opt(A.MODES[0], 'bgOff'), opt(A.MODES[1], 'bgMood'), opt(A.MODES[2], 'bgTitle'), opt(A.MODES[3], 'bgRandom')]);
      var str = choice('libBgStrength', [opt(A.STRENGTHS[0], 'bgSoft'), opt(A.STRENGTHS[1], 'bgStrong')]);
      m.val = function () { return v(['bgOff', 'bgMood', 'bgTitle', 'bgRandom'][A.MODES.indexOf(A.mode(S.settings))]); };   // fehlend/unbekannt = Standard
      str.val = function () { return v(A.strength(S.settings) === 'strong' ? 'bgStrong' : 'bgSoft'); };
      str.disabled = function () { return A.mode(S.settings) === 'off'; };
      str.ddesc = 'set.libBgStrength.off.desc';
      if (T) { m.label = 'set.pageBg'; m.desc = 'set.pageBg.desc'; str.desc = 'set.pageBgStrength.desc'; str.ddesc = 'set.pageBgStrength.off.desc'; }
      return [m, str];
    }
    /* P4 (docs/research/discover.md): Entdecken an/aus (Standard: an im Hauptprofil). Merkliste nur mit Helfer; ohne Helfer eine
     * Wertzeile "Nicht eingerichtet", deren Satz erklaert, wie man sie einschaltet – sonst ist die Merkliste nirgends sichtbar. */
    function discRows() {
      var S = st(), D = N.disc;
      var d = { id: 'discover', type: 'toggle', label: 'set.discover', desc: 'set.discover.desc',
        get: function () { return D.enabled(); }, set: function (x) { S.setSetting('discover', x); } };
      /* Inspiration anpassen (Entdecken vor der Eingabe, N.insp): gleiche Liste wie "Startseite anpassen" */
      var ir = { id: 'insprows', type: 'action', label: 'set.inspRows', desc: 'set.inspRows.desc', disabled: function () { return !D.enabled(); }, ddesc: 'set.inspRows.off.desc',
        val: function () { return N.tn('set.inspRows.val', inspCount()); }, run: function () { N.router.push('insprows'); } };
      /* Blaue Taste oeffnet Suche oder Entdecken (Nutzerwunsch 31.10.): haengt an "Entdecken" -> direkt darunter, gedimmt wenn aus */
      var bk = choice('blueKey', [['search', v('bkSearch'), null, v('bkSearch.s')], ['discover', v('bkDisc'), null, v('bkDisc.s')]]);
      bk.disabled = function () { return !D.enabled(); }; bk.ddesc = 'set.blueKey.off.desc'; bk.help = 'help.blueKey';
      if (!D.helper()) return [d, bk, { id: 'watchlist', type: 'value', label: 'set.watchlist', desc: 'set.watchlist.none.desc', val: function () { return v('notSetUp'); } }, ir];
      D.probeHelper(function () { paintAll(); });
      return [d, bk, { id: 'watchlist', type: 'toggle', label: 'set.watchlist', desc: 'set.watchlist.desc',
        get: function () { return D.watchlistOn(); }, set: function (x) { S.setSetting('watchlist', x); },
        disabled: function () { return D.helperState() === 'down' || !D.enabled(); },
        ddesc: function () { return D.helperState() === 'down' ? 'set.watchlist.down.desc' : 'set.watchlist.off.desc'; } }, ir].concat(hideRows());
    }
    /* "Nur Titel, die du noch nicht hast" (N.insp.hide): wirkt nur auf die plex.tv-Reihen (Helfer) -> nur mit eingetragenem Helfer.
     * Standard AN (fehlender Wert = an). Mit Weiteren Servern eine zweite Zeile: auch deren Titel ausblenden (Standard an). */
    function hideRows() {
      var S = st(), D = N.disc;
      function on(k) { return !(S.settings && S.settings[k] === false); }
      function why() { return !D.enabled() ? 'set.inspHideOwn.off.desc' : D.helperState() === 'down' ? 'set.watchlist.down.desc' : 'set.inspHideOwn.nodisc.desc'; }
      function off() { return !N.insp.helperOn(); }
      var own = { id: 'inspHideOwn', type: 'toggle', label: 'set.inspHideOwn', desc: 'set.inspHideOwn.desc', help: 'help.inspHideOwn',
        get: function () { return on('inspHideOwn'); }, set: function (x) { S.setSetting('inspHideOwn', x); }, disabled: off, ddesc: why };
      if (!N.srv || !N.srv.has()) return [own];
      return [own, { id: 'inspHideShared', type: 'toggle', label: 'set.inspHideShared', desc: 'set.inspHideShared.desc',
        get: function () { return on('inspHideShared'); }, set: function (x) { S.setSetting('inspHideShared', x); },
        disabled: function () { return off() || !on('inspHideOwn'); },
        ddesc: function () { return off() ? why() : 'set.inspHideShared.off.desc'; } }];
    }
    function inspCount() {
      var S = st(), hc = S.homeCache();
      return N.insp.enabled(S.settings && S.settings.inspRows || null, hc && hc.libs || [], S.hubCatalog(), N.insp.helperOn()).length;
    }
    function helpRows() {
      function act(id, run) { return { id: id, type: 'action', label: 'set.' + id, desc: 'set.' + id + '.desc', run: run }; }
      return [act('keys', function () { N.router.push('keys'); }), act('welcome', function () { N.helpUi.welcome(false); }),
        act('testConn', function () { N.helpUi.connTest(); }),
        { id: 'ver', type: 'value', label: 'set.version', desc: 'set.version.desc', val: function () { return N.config.version; } },
        act('about', function () { N.helpUi.about(); }), act('licenses', function () { N.helpUi.licenses(); })];
    }
    /* Startprofil: Einstellung des Fernsehers (state.json), nicht je Profil */
    function startRow() {
      var S = st();
      function opts() { var a = S.admin(); return [['main', N.t('set.v.startMain', { name: a ? a.name : '' })], ['last', v('startLast')], ['picker', v('startPicker')]]; }
      function cur() { var o = opts(), c = S.startProfile(); for (var i = 0; i < o.length; i++) if (o[i][0] === c) return o[i]; return o[0]; }
      return { id: 'startProfile', type: 'list', label: 'set.startProfile', desc: 'set.startProfile.desc', val: function () { return cur()[1]; },
        open: function () {
          var o = opts(), e = [];
          for (var i = 0; i < o.length; i++) e.push({ id: o[i][0], t: o[i][1] });
          N.ui.panel.select({ title: N.t('set.startProfile'), selected: cur()[0], entries: e, onSelect: function (id) { S.state.startProfile = id; S.save(); paintAll(); } });
        } };
    }
    /* ===== Ende P5 ===== */
    function scanRow() {
      return { id: 'scan', type: 'action', label: 'set.scan', desc: 'set.scan.desc', run: function () {
        var S = st(), hc = S.homeCache(), libs = hc && (hc.alibs || hc.libs) || [], e = [{ id: 'all', t: N.t('set.scan.all') }];
        for (var i = 0; i < libs.length; i++) e.push({ id: String(libs[i].id), t: libs[i].title });
        N.ui.panel.select({ title: N.t('set.scan'), selected: '', entries: e, onSelect: function (id) { N.scan.start(id === 'all' ? null : id); } });
      } };
    }
    /* Zeilen ohne die weggelassenen (null/false): jede Kategorie steht als EINE geordnete Liste da – neue Zeilen bewusst
     * einsortieren statt hinten anhaengen (Reihenfolge docs/research/settings-order-2026-10-29.md) */
    function only(list) { var o = []; for (var i = 0; i < list.length; i++) if (list[i]) o.push(list[i]); return o; }
    function langRow() {
      return { id: 'lang', type: 'list', label: 'set.language', desc: 'set.language.desc', val: function () { return N.t('lang.' + N.i18n.lang()); },
        open: function () {
          N.ui.panel.select({ title: N.t('set.language'), selected: N.i18n.lang(),
            entries: N.i18n.langs.map(function (l) { return { id: l, t: N.t('lang.' + l) }; }),   // Deutsch, English, Norsk bokmål
            onSelect: function (l) { if (l !== N.i18n.lang()) N.app.setLang(l); } });
        } };
    }
    /* Oberflaeche (2.5): Layout (Startseite, Seitenleiste, Zurueck aus einem Bereich, Ansicht) · Aussehen (Akzent, Markierungen, Hintergruende, Bewegung) · Kacheln
     * (Fortschritt, Spoiler) · Uhr · Hinweise (neue Inhalte + Anzeigedauer + im Video, Tastenhinweise) · Bedienung (Zuletzt gesucht, Zeiger) ·
     * Titelmelodie · Entdecken-Block (nur Erwachsene) */
    function displayRows(S) {
      var adult = !S.isKid();
      return only([langRow(),
        adult && { id: 'homerows', type: 'action', label: 'set.homeRows', desc: 'set.homeRows.desc',   // SPEC 7.3.1 – nicht in Kinderprofilen (7.13)
          val: function () { return N.tn('set.homeRows.val', homeCount()); }, run: function () { N.router.push('homerows'); } },
        homeHeroRow(S),                                // HOME-18 (nur caps.homeHero, Apple): direkt unter "Startseite anpassen" – auch fuer Kinder
        // W1 "Seitenleiste anpassen": Eintraege umsortieren/ausblenden (Start + Einstellungen bleiben), gleiche Liste wie oben
        adult && { id: 'railitems', type: 'action', label: 'set.railItems', desc: 'set.railItems.desc',
          val: function () { return N.tn('set.railItems.val', N.ui.rail.order().length); }, run: function () { N.router.push('railitems'); } },
        sectionBackRow(),
        N.platform.caps.home !== 'tiles' && homeSizeRow(),   // HOME-15: direkt vor der Bibliotheksansicht (gleiche Werte Gross/Mittel/Klein); Kacheln-Startseite (Apple): eigene Masse
        choice('libView', [['L', N.t('lib.view.L')], ['M', N.t('lib.view.M')], ['S', N.t('lib.view.S')], ['list', N.t('lib.view.list')]]),   // Bibliotheksansicht (Feedback-Regel 2)
        accentRow(), badgeRow(),
        toggle('backgrounds')].concat(libBgRows(), [
        { id: 'rm', type: 'toggle', label: 'set.reduceMotion', desc: 'set.reduceMotion.desc',
          get: function () { return !!(S.settings && S.settings.reduceMotion); }, set: function (x) { S.setSetting('reduceMotion', x); N.fx.setReduced(x); } },
        { id: 'ep', type: 'toggle', label: 'set.episodeProgress', desc: 'set.episodeProgress.desc',
          get: function () { return !!(S.settings && S.settings.episodeProgress); }, set: function (x) { S.setSetting('episodeProgress', x); } },
        // TV-Befund 28.10.: Serien-Balken einzeln abschaltbar (vorher an "Folgen-Fortschritt" gekoppelt)
        { id: 'sp', type: 'toggle', label: 'set.seriesProgress', desc: 'set.seriesProgress.desc',
          get: function () { return !!(S.settings && S.settings.seriesProgress); }, set: function (x) { S.setSetting('seriesProgress', x); } },
        toggle('spoiler'), toggle('clock'), clockStyleRow()].concat(newsRows(), N.platform.caps.hintBar === false ? [] : [hintsRow()], [recentRow()],
        // Smart-Control-Zeiger (Fernbedienung): mit echter Maus/Trackpad (caps.pointer 'mouse', Apple) nicht anbieten – "Aus" haette
        // dort die Maus abgeschaltet, Randzonen braucht freies Rollen nicht (Nutzer 03.11., SPEC NAV-26)
        N.platform.caps.pointer === 'mouse' ? [] : [{ id: 'ptr', type: 'toggle', label: 'set.pointer', desc: 'set.pointer.desc',
          get: function () { return S.state.pointer !== false; }, set: function (x) { S.state.pointer = x; S.save(); N.pointer.setEnabled(x); } },
        // TV-Befund 1.0.5: Weiterblaettern durch Verweilen am Rand (Randzonen, naechste Reihe der Startseite) abschaltbar
        { id: 'ptredge', type: 'toggle', label: 'set.ptrEdge', desc: 'set.ptrEdge.desc', ddesc: 'set.ptrEdge.off.desc', help: 'help.ptrEdge',
          disabled: function () { return S.state.pointer === false; },
          get: function () { return S.state.ptrEdge !== false; }, set: function (x) { S.state.ptrEdge = x; S.save(); N.pointer.setEdge(x); } },
        // TV-Befund 27.10. nachmittags: Randzonen-Rollen erst langsam, dann schneller; nur mit Zeiger-Steuerung (sonst ausgegraut)
        { id: 'ptracc', type: 'toggle', label: 'set.ptrAccel', desc: 'set.ptrAccel.desc',
          ddesc: function () { return S.state.pointer === false ? 'set.ptrAccel.off.desc' : 'set.ptrAccel.edge.desc'; },
          disabled: function () { return S.state.pointer === false || S.state.ptrEdge === false; },
          get: function () { return S.state.ptrAccel !== false; }, set: function (x) { S.state.ptrAccel = x; S.save(); N.pointer.setAccel(x); } }], [
        toggle('themeMusic'),                         // Titelmelodie (SPEC v2.2, M3b: Standard aus)
        themeVolRow()
      ]), adult ? discRows() : []));                   // P4 Entdecken + Merkliste (Kinderprofile: nicht vorhanden)
    }
    /* Infobereich ueber den Kacheln der Startseite (HOME-18, caps.homeHero): Standard an; wirkt nur mit Zeiger/Tastatur und genug Hoehe
     * (views/home.js heroWanted), gilt beim naechsten Aufbau der Startseite */
    function homeHeroRow(S) {
      if (N.platform.caps.homeHero !== true) return null;
      return { id: 'homehero', type: 'toggle', label: 'set.homeHero', desc: 'set.homeHero.desc',
        get: function () { return !(S.settings && S.settings.homeHero === false); }, set: function (x) { S.setSetting('homeHero', x); } };
    }
    /* Kachelgroesse der Startseite (HOME-15): Groß/Mittel/Klein wie die Bibliotheksansicht; Unterzeile = Kacheln je Reihe aus RowMath */
    function homeSizeRow() {
      var RM = N.RowMath, o = [];
      RM.HOME_SIZES.forEach(function (k) {
        var n = { a: RM.homeGeom(k, 'land').full, b: RM.homeGeom(k, 'poster').full };
        o.push([k, N.t('lib.view.' + k), null, N.t(k === 'L' ? 'set.v.homeSizeL.s' : 'set.v.homeSize.s', n)]);
      });
      return choice('homeSize', o);
    }
    /* Zurueck aus einem Bereich (NAV-5, N.sections): wohin RETURN oben in einem Bereich der Seitenleiste fuehrt; INFO erklaert die Kette */
    function sectionBackRow() {
      var r = choice('sectionBack', [['home', v('secHome'), null, v('secHome.s')], ['prev', v('secPrev'), null, v('secPrev.s')]]);
      r.help = 'help.sectionBack';
      return r;
    }
    /* Lautstaerke der Titelmelodie: gedimmt, solange die Titelmelodie aus ist (Standard) – sonst waere sie wirkungslos aktiv */
    function themeVolRow() {
      var r = choice('themeVol', [[25, N.t('set.v.pct', { n: 25 })], [50, N.t('set.v.pct', { n: 50 })], [75, N.t('set.v.pct', { n: 75 })], [100, N.t('set.v.pct', { n: 100 })]]);
      r.disabled = function () { var S = st(); return !(S.settings && S.settings.themeMusic); };
      r.ddesc = 'set.themeVol.off.desc';
      return r;
    }
    /* Profil & Konto (2.8): Profil (wechseln, Startprofil, PINs, Profilwechsel nur mit PIN – steht UNTER "PIN fuer dieses Profil",
     * dessen gedimmter Text sagt "oben") · Server (aktualisieren, Server, Weitere Server) · Einrichtung bzw. Abmelden zuletzt.
     * Konto-Aktionen nur im Hauptkonto-Profil (SPEC 7.15.1); andere Erwachsene: Profil wechseln (+ PIN, Weitere Server mit setup.json) */
    function accountRows(S) {
      var admin = S.isAdmin(), pins = [];
      if (S.pkg) N.pinSettings.rows(pins, paintAll);  // P2: eigene App-PIN je Profil (nur mit setup.json, views/pinsettings.js)
      return only([
        { id: 'switch', type: 'action', label: 'set.switchProfile', desc: 'set.switchProfile.desc', run: function () { N.app.switchProfile(); } },
        admin && startRow()].concat(pins, [         // P5: Startprofil (Nutzer-Feedback-Regel 9), gilt fuer diesen Fernseher
        admin && { id: 'pinsw', type: 'toggle', label: 'set.pinSwitch', desc: S.pkg ? 'set.pinSwitch.app.desc' : 'set.pinSwitch.desc', disabled: function () { return !S.pinSwitchAvailable() || !S.hasRestricted(); },
          ddesc: function () { if (S.pkg && !S.pinSwitchAvailable()) return 'set.pinSwitch.app.disabled'; return S.pinSwitchAvailable() ? 'set.pinSwitch.noKids.disabled' : 'set.pinSwitch.disabled'; },
          get: function () { return S.pinSwitchOn(); }, set: function (x) { S.state.pinSwitch = x; S.save(); } },
        admin && scanRow(),
        admin && { id: 'server', type: 'value', label: 'set.server', desc: 'set.server.desc', val: function () { return S.state.server ? S.state.server.name : ''; } },
        // Weitere Server (optional, setup.json): Anzahl + erreichbar; der Satz erklaert, wo man sie einrichtet
        S.pkg && { id: 'others', type: 'value', label: 'set.otherServers', desc: 'set.otherServers.desc', val: function () {
          var l = N.srv.list(), ok = 0;
          for (var i = 0; i < l.length; i++) if (l[i].state === 'ok') ok++;
          return l.length ? N.t('set.otherServers.val', { ok: ok, n: l.length }) : v('notSetUp');
        } },
        // P2 (setup.json): kein plex.tv-Konto zum Abmelden, statt dessen Hinweis zur Einrichtung; sonst Abmelden (zuletzt)
        admin && S.pkg && N.pinSettings.setupRow(),
        admin && !S.pkg && { id: 'out', type: 'action', label: 'set.signOut', desc: 'set.signOut.desc', run: function () {
          N.ui.dialog.open({ title: N.t('dlg.account.title'), text: N.t('dlg.account.text'),
            buttons: [{ id: 'out', t: N.t('dlg.account.confirm') }, { id: 'cancel', t: N.t('dlg.account.cancel') }], focus: 1,
            onSelect: function (id) { if (id === 'out') { N.session.signOut(); N.router.reset('login'); } } });
        } }
      ]));
    }
    function diagRows() {
      return [
        { id: 'logsend', type: 'action', label: 'set.diagSend', desc: 'set.diagSend.desc', run: function () {
          N.diag.send(function (ok) { N.ui.toast.show(N.t(ok ? 'toast.logSent' : 'toast.logFailed'), { icon: ok ? 'confirm' : 'info' }); });
        } },
        { id: 'logclear', type: 'action', label: 'set.diagClear', desc: 'set.diagClear.desc', run: function () {
          N.diag.clear(); N.ui.toast.show(N.t('toast.logCleared'), { icon: 'confirm' });
        } }
      ];
    }
    /* Kategorien: Wiedergabe · Ton & Untertitel · Anime · Oberflaeche · [Erweiterung, z. B. Anfragen] · Bildschirmschoner ·
     * Profil & Konto · Diagnose · Hilfe & Info. Kinder: ohne Bildschirmschoner, Profil & Konto und Diagnose. */
    function defs() {
      var S = st(), adult = !S.isKid();
      var list = only([{ id: 'play', rows: playRows() }, { id: 'subs', rows: subsRows() }, { id: 'anime', rows: animeRows() },
        { id: 'display', rows: displayRows(S) },
        adult && { id: 'saver', rows: saverRows() },
        adult && { id: 'account', rows: accountRows(S), desc: S.pkg ? 'set.cat.account.app.desc' : null },
        adult && { id: 'diag', rows: diagRows() },
        { id: 'help', rows: helpRows() }]);
      N.ext.call('settings:cats', list, S, paintAll);   // optionale Erweiterungen: eigene Kategorie (core/ext.js)
      return list;
    }
    s.create = function (root) {
      cats = defs();
      titleT = U.txt('div', 'a t-h1 ell', root, N.t('set.title'), STACK ? 'left:144px;top:40px;width:' + LW + 'px' : 'left:144px;top:40px;width:900px');
      if (STACK) {                                       // schmal: Zurueck "‹" vor dem Kategorie-Namen (nur auf der Seite der Zeilen)
        bk = U.el('div', 'set-bk', root, 'display:none');
        bk.setAttribute('role', 'button'); bk.setAttribute('aria-label', N.t('hint.back'));
        bk.appendChild(document.createTextNode('‹'));
      }
      var cp = root;
      if (N.screen.flex) {
        var cc = U.el('div', 'set-cc', root, 'position:absolute;left:0;top:' + CAT_TOP + 'px;width:100%;height:' + catVis + 'px;overflow:hidden');
        cp = catIn = U.el('div', 'set-ci', cc, 'position:absolute;left:0;top:' + (-CAT_TOP) + 'px;width:100%;height:0');
        catMax = Math.max(0, CAT_Y + cats.length * CAT_STEP - CAT_STEP + 48 + 8 - (CAT_TOP + catVis));
        if (catMax > 0) catIn.setAttribute('data-scroll', '1');
        fc = N.ui.freeList({ el: catIn, max: function () { return catMax; }, dim: catVis,
          hit: function (x, y) { return catMax > 0 && y >= CAT_TOP && (STACK ? zone !== 'row' && x >= RX - 24 && x < RX + LW + 24 : x >= 144 && x < 444); } });
      }
      for (var i = 0; i < cats.length; i++) {
        var ce = U.el('div', 'set-cat', cp, 'top:' + (CAT_Y + i * CAT_STEP) + 'px' + (STACK ? ';width:' + LW + 'px' : ''));
        U.el('span', 'bar', ce);
        ce.appendChild(document.createTextNode(N.t('set.cat.' + cats[i].id)));
        catEls.push(ce);
        cTips.push(N.i18n.has(catKey(i)) ? N.ui.infotip.icon(ce) : null);   // Finger/Maus: ⓘ statt Beschreibungsflaeche (Nr. 28)
      }
      var clip = U.el('div', 'set-clip', root, (DY ? 'height:' + (384 + DY) + 'px;' : '') + (STACK ? 'left:144px;width:' + LW + 'px' : ''));
      list = U.el('div', 'set-list', clip, STACK ? 'width:' + LW + 'px' : '');
      s.clipEl = clip;
      fl = N.ui.freeList({ el: list, max: maxPx, dim: MAXROWS * ROW_STEP,
        hit: function (x, y) { return (!STACK || zone === 'row') && x >= RX && x < RX + LW && y >= ROW_Y && y < ROW_Y + MAXROWS * ROW_STEP; },
        onSet: function (p) { more.set(p > 0.5, p < maxPx() - 0.5); } });
      for (i = 0; i < maxRows(); i++) {
        var re = { el: U.el('div', 'set-row', list, 'display:none;top:' + (i * ROW_STEP) + 'px' + (STACK ? ';width:' + LW + 'px' : '')) };
        re.lb = U.txt('div', 'lb', re.el, '', STACK ? 'width:' + Math.max(160, LW - 250) + 'px' : undefined);
        re.val = U.txt('div', 'val', re.el, '');
        re.tg = U.el('div', 'toggle', re.el); U.el('i', '', re.tg);
        re.sw = U.el('span', 'sw', re.el);              // Farbfeld (nur Zeilen mit sw, z. B. Akzentfarbe)
        U.el('div', 'sep', re.el);
        re.tip = N.ui.infotip.icon(re.el);              // nur Plattformen mit umschaltbarer Eingabeart (am TV null)
        if (re.tip) U.cls(re.el, 'itr', true);
        rowEls.push(re);
      }
      desc = U.txt('div', 'set-desc', root, '');
      if (DY) desc.parentNode.style.top = (528 + DY) + 'px';
      if (STACK) { desc.parentNode.style.left = '144px'; desc.parentNode.style.width = LW + 'px'; }
      /* Mehr-Hinweis (NAV-11, Nutzer-Befund 29.10.: unter "Bildübergang" ging die Liste ohne jeden Hinweis weiter): ▲ in der Luecke
       * ueber der ersten Zeile, ▼ zwischen Liste (bis y 496) und Beschreibung (ab y 528), mittig ueber der Liste */
      var mx = STACK ? 144 + Math.round(LW / 2) - 10 : 818;
      more = N.ui.more(root, 'left:' + mx + 'px;top:84px', 'left:' + mx + 'px;top:' + (498 + DY) + 'px');
    };
    /* schmal (STACK): nur die Seite der Zone zeigen – Kategorien oder die Zeilen einer Kategorie (mit Zurueck und ihrem Namen) */
    function page() {
      if (!STACK) return;
      var rowsOn = zone === 'row';
      for (var i = 0; i < catEls.length; i++) U.show(catEls[i], !rowsOn);
      U.show(s.clipEl, rowsOn); U.show(desc.parentNode, rowsOn); U.show(bk, rowsOn);
      if (!rowsOn) more.set(false, false);
      var t = rowsOn ? N.t('set.cat.' + cats[c].id) : N.t('set.title');
      titleT.parentNode.style.left = rowsOn ? '208px' : '144px';
      titleT.parentNode.style.width = (rowsOn ? LW - 64 : LW) + 'px';
      U.setText(titleT, t);
    }
    function rowsOf() { return cats[c].rows; }
    function maxRows() { var n = 0; for (var i = 0; i < cats.length; i++) n = Math.max(n, cats[i].rows.length); return n; }
    function paintAll() { for (var k = 0; k < rowEls.length; k++) paintRow(k); if (zone === 'row') setDesc(); }
    /* Liste scrollen: Fokus-Anker = 3. Zeile, nie ueber das Ende hinaus */
    function scrollTo(i) {
      var snap = fl.keys();                             // nach freiem Scrollen (Lage zwischen Zeilen): Tasten rasten wieder ein (TV: nie)
      if (snap) off = Math.max(0, Math.min(fl.near(ROW_STEP), rowsOf().length - MAXROWS));
      var o = Math.max(0, Math.min(i - 2, rowsOf().length - MAXROWS));
      if (o !== off || (snap && fl.px !== o * ROW_STEP)) { off = o; N.fx.move(list); U.tf(list, 0, -off * ROW_STEP); }
      fl.sync(off * ROW_STEP);
      more.set(off > 0, off + MAXROWS < rowsOf().length);
    }
    /* ---- freies Scrollen (App.pan, N.ui.freeList) ---- */
    function maxPx() { return Math.max(0, rowsOf().length - MAXROWS) * ROW_STEP; }
    /* Kategorien, kurze Liste: Zug annehmen und nichts tun (kein Rueckfall auf Fokus-Schritte) */
    s.pan = function (e) {
      if (e.phase === 'start') { pz = fc && fc.pan(e) ? fc : fl; if (pz === fl) fl.pan(e); return true; }
      if (pz) pz.pan(e);
      if (e.phase === 'end') pz = null;
      return true;
    };
    s.wheel = function (x, y, dx, dy) { return !!(fc && fc.wheel(x, y, dy)) || fl.wheel(x, y, dy); };
    s.pointerDown = function () { fl.down(); if (fc) fc.down(); };
    /* Kategorie i ins Bild holen (Tasten-Fokus; nur wenn die Kategorien rollen) */
    function catReveal(i) {
      if (!fc || !(catMax > 0)) return;
      var y = CAT_Y + i * CAT_STEP, p = fc.px;
      if (y - p < CAT_TOP + 8) p = y - CAT_TOP - 8; else if (y + 48 - p > CAT_TOP + catVis - 8) p = y + 56 - CAT_TOP - catVis;
      p = Math.max(0, Math.min(catMax, p));
      fc.keys(); fc.sync(p); U.tf(catIn, 0, -p);
    }
    function cy() { return fc ? fc.px : 0; }             // gerollte Kategorien (sonst 0)
    /* An den Anfang (App.scrollTop, Tipp ganz oben / Cmd+Pfeil hoch): Zeilenliste gleitet nach oben (N.ui.freeList.top) */
    s.scrollTop = function () { return fl.top(); };
    function paintRow(i) {
      var d = rowsOf()[i], re = rowEls[i];
      if (!d) { U.show(re.el, false); return; }
      U.show(re.el, true);
      U.setText(re.lb, N.t(d.label));
      U.show(re.tg, d.type === 'toggle');
      if (d.type === 'toggle') U.cls(re.tg, 'on', d.get());
      U.setText(re.val, d.type === 'toggle' ? '' : (d.val ? d.val() : ''));
      var sw = d.sw ? d.sw() : '';
      if (re.swc !== sw) { re.swc = sw; re.sw.className = sw ? 'sw sw-' + sw : 'sw'; U.cls(re.el, 'has-sw', !!sw); }
      U.cls(re.el, 'dis', !!(d.disabled && d.disabled()));
    }
    function showCat(i) {
      U.cls(catEls[c], 'is-cur', false);
      c = i;
      U.cls(catEls[c], 'is-cur', true);
      for (var k = 0; k < rowEls.length; k++) paintRow(k);
      off = -1; scrollTo(0);
    }
    function setDesc() {
      if (zone === 'cat') { U.setText(desc, N.t(catKey(c))); return; }
      var d = rowsOf()[r];
      U.setText(desc, N.t(descKey(d)));
    }
    function catKey(i) { return cats[i].desc || 'set.cat.' + cats[i].id + '.desc'; }
    /* Text wie INFO: Hilfe (bzw. info()) einer aktiven Zeile, sonst die Beschreibung (gedimmt: warum) */
    function infoText(d) { var on = !(d.disabled && d.disabled()); return d.info && on ? d.info() : N.t(d.help && on ? d.help : descKey(d)); }
    /* Info-Symbol (Finger/Maus, N.ui.infotip): Blase mit dem Text am Symbol; Lage aus Zeilen-Mathe (Mitte des 32er-Symbols) */
    var TIP_X = STACK ? RX + LW - 32 : 1168, TIP_CX = STACK ? RX + LW - 32 : 400;
    function scrollPx() { return fl.free ? fl.px : off * ROW_STEP; }
    function rowTip(i) {
      var d = rowsOf()[i];
      if (d) N.ui.infotip.open({ title: N.t(d.label), text: infoText(d), x: TIP_X, y: ROW_Y + i * ROW_STEP - scrollPx() + 32, flex: true, el: rowEls[i].tip });
    }
    function catTip(i) {
      N.ui.infotip.open({ title: N.t('set.cat.' + cats[i].id), text: N.t(catKey(i)), x: TIP_CX, y: CAT_Y + i * CAT_STEP + 24 - cy(), flex: true, el: cTips[i] });
    }
    function descKey(d) { return d.disabled && d.disabled() && d.ddesc ? (typeof d.ddesc === 'function' ? d.ddesc() : d.ddesc) : d.desc; }
    function focusCat(i) {
      if (zone === 'row') U.cls(rowEls[r].el, 'is-focus', false);
      U.cls(catEls[c], 'is-focus', false);
      if (i !== c) showCat(i);
      zone = 'cat';
      U.cls(catEls[c], 'is-focus', true);
      catReveal(c);
      setDesc();
      page();
    }
    function focusRow(i, still) {
      if (zone === 'cat') U.cls(catEls[c], 'is-focus', false); else U.cls(rowEls[r].el, 'is-focus', false);
      var was = zone;
      zone = 'row'; r = i;
      if (!still) scrollTo(r);                        // Zeiger: Liste laeuft nicht unter dem Punkt weg
      U.cls(rowEls[r].el, 'is-focus', true);
      setDesc();
      if (was !== 'row') page();
    }
    function activate() {
      var d = rowsOf()[r];
      if (d.disabled && d.disabled()) return;
      if (d.type === 'toggle') { d.set(!d.get()); paintAll(); setDesc(); }   // alle Zeilen: abhaengige (z. B. Zeiger-Scrollen) aendern ihren Zustand
      else if (d.type === 'list') d.open();
      else if (d.type === 'action') d.run();
    }
    s.enter = function (params, restore) {
      var rc = restore ? Math.min(restore.c || 0, cats.length - 1) : 0;
      for (var j = 0; restore && restore.id && j < cats.length; j++) if (cats[j].id === restore.id) rc = j;   // Kategorie wieder finden, auch wenn sich die Liste geaendert hat
      c = rc; for (var i = 0; i < catEls.length; i++) U.cls(catEls[i], 'is-cur', i === c);
      for (i = 0; i < rowEls.length; i++) paintRow(i);
      off = -1; scrollTo(restore && restore.zone === 'row' ? restore.r || 0 : 0);
      if (restore && restore.zone === 'row' && rowsOf()[restore.r]) { zone = 'cat'; focusRow(restore.r); } else { zone = 'cat'; focusCat(c); }
    };
    s.leave = function () { return { c: c, zone: zone, r: r, id: cats[c] ? cats[c].id : '' }; };
    s.railBlur = function () { if (zone === 'cat') U.cls(catEls[c], 'is-focus', false); else U.cls(rowEls[r].el, 'is-focus', false); };
    s.railFocus = function () { if (zone === 'cat') U.cls(catEls[c], 'is-focus', true); else U.cls(rowEls[r].el, 'is-focus', true); };
    s.toastLow = true;              // Toast unter der Beschreibung (.set-desc), nie darueber (NAV-10)
    s.hints = function () { return [{ k: 'ret', t: 'hint.back' }, { k: 'INFO', t: 'hint.learnMore' }]; };
    s.onKey = function (k) {
      var n;
      if (zone === 'cat') {
        if (k === 'UP' || k === 'DOWN') { n = N.nav.list(c, cats.length, k, true); if (n >= 0) focusCat(n); }
        else if (k === 'RIGHT' || k === 'ENTER') focusRow(0);
        else if (k === 'LEFT') N.ui.rail.open();
        else if (k === 'RETURN') { if (params && params.sec) N.app.sectionBack(); else N.router.back(); }   // NAV-5: Kategorien -> Start bzw. vorheriger Bereich
        else if (k === 'INFO') N.ui.panel.help(N.t('set.cat.' + cats[c].id), N.t('set.cat.' + cats[c].id + '.desc'));
        return true;
      }
      if (k === 'UP' || k === 'DOWN') { n = N.nav.list(r, rowsOf().length, k, true); if (n >= 0) focusRow(n); }
      else if (k === 'LEFT' || k === 'RETURN') focusCat(c);
      else if (k === 'ENTER') activate();
      else if (k === 'INFO') N.ui.panel.help(N.t(rowsOf()[r].label), infoText(rowsOf()[r]));   // info(): fertiger Text (z. B. mit Werten)
      return true;
    };
    /* Zeiger: Kategorien und Zeilen per Index-Mathe. Finger/Maus (Nr. 28): Treffer auf dem ⓘ (Kategorie x 376–444, Zeile
     * x 1136–1216, je volle Zeilenhoehe >= 44 pt) oeffnet nur die Info-Blase – kein Umschalten, keine Auswahl */
    s.pointer = function (x, y, kind) {
      var i, tip = N.ui.infotip.on();
      if (fl.eat(kind) || (fc && fc.eat(kind))) return true;   // Tipper in den Schwung: nur anhalten (wo er gerade ist)
      if (STACK) return stackPointer(x, y, kind, tip);
      if (x >= 144 && x < (tip ? 444 : 424)) {
        i = y < CAT_TOP && fc ? -1 : N.hit.list(CAT_Y, CAT_STEP, tip ? CAT_STEP : 48, cats.length, (tip ? y + 4 : y) + cy());
        if (i < 0) { N.ui.infotip.hover(null); return false; }
        if (tip && cTips[i] && x >= 376) { N.ui.infotip.hover(cTips[i]); if (kind === 'click') catTip(i); return true; }
        N.ui.infotip.hover(null);
        if (x >= 424) return false;
        if (zone !== 'cat' || i !== c) focusCat(i);
        return true;
      }
      if (x >= 464 && x < (tip ? 1216 : 1200)) {
        if (fl.free) {                                    // frei gescrollt: Zeile per Pixel-Lage (auch angeschnittene)
          i = fl.idx(y, ROW_Y, ROW_STEP, rowsOf().length, MAXROWS);
          if (i < 0) return false;
        } else {
          i = N.hit.list(ROW_Y, ROW_STEP, 64, Math.min(MAXROWS, rowsOf().length - off), y);
          if (i < 0) return false;
          i += off;
        }
        if (zone !== 'row' || i !== r) focusRow(i, true);
        if (tip && rowEls[i].tip && x >= 1136) { N.ui.infotip.hover(rowEls[i].tip); if (kind === 'click') rowTip(i); return true; }
        N.ui.infotip.hover(null);
        if (x >= 1200) return true;
        if (kind === 'click') activate();
        return true;
      }
      N.ui.infotip.hover(null);
      return false;
    };
    /* schmal (STACK): Kategorien bzw. Zeilen ueber die volle Breite RX … RX + LW; ⓘ ganz rechts (64 breit); Zurueck oben links */
    function stackPointer(x, y, kind, tip) {
      var i;
      if (x < RX - 24 || x >= RX + LW + 24) { N.ui.infotip.hover(null); return false; }
      if (zone !== 'row') {
        i = y < CAT_TOP && fc ? -1 : N.hit.list(CAT_Y, CAT_STEP, tip ? CAT_STEP : 48, cats.length, (tip ? y + 4 : y) + cy());
        if (i < 0) { N.ui.infotip.hover(null); return false; }
        if (tip && cTips[i] && x >= RX + LW - 64) { N.ui.infotip.hover(cTips[i]); if (kind === 'click') catTip(i); return true; }
        N.ui.infotip.hover(null);
        if (i !== c) focusCat(i); else if (zone !== 'cat') focusCat(i);
        if (kind === 'click') focusRow(0);                // Tipp oeffnet die Kategorie
        return true;
      }
      if (y >= 32 && y < 104 && x < RX + 72) { if (kind === 'click') focusCat(c); return true; }   // Zurueck "‹"
      if (fl.free) { i = fl.idx(y, ROW_Y, ROW_STEP, rowsOf().length, MAXROWS); if (i < 0) return false; }
      else { i = N.hit.list(ROW_Y, ROW_STEP, 64, Math.min(MAXROWS, rowsOf().length - off), y); if (i < 0) return false; i += off; }
      if (i !== r) focusRow(i, true);
      if (tip && rowEls[i].tip && x >= RX + LW - 64) { N.ui.infotip.hover(rowEls[i].tip); if (kind === 'click') rowTip(i); return true; }
      N.ui.infotip.hover(null);
      if (kind === 'click') activate();
      return true;
    }
    return s;
  });
})(N);
