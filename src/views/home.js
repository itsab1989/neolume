/* Ansicht 'home' – Startseite (SPEC 5.6, 6.1–6.3, 7.3, 15; Mockup home.html).
 * - Erster Inhalt aus cache-home-<uid>.json, danach stiller Netz-Refresh (fokussierte Reihe wird nie umgebaut, 6.3.3).
 * - Max. 4 Reihen im DOM (vorherige, aktuelle, naechste, uebernaechste): Slot = Reihenindex mod 4, Recycling in der Idle-Queue.
 * - Fokus-Anker: Kartenoberkante der fokussierten Reihe immer y = 372; Seiten-Container per translate3d.
 * - Hero folgt dem Fokus nach 300 ms Ruhe; Staffelstreifen (abschaltbar) fuer angefangene Serien.
 * - Farbtasten (6.1): Rot Ausblenden (nur Weiterschauen, lokal + 6 s Rueckgaengig), Gelb Gesehen/Ungesehen, Blau Suche. */
(function (N) {
  var U = N.util, M = N.model, H = N.hubs, RM = N.RowMath;
  var HERO_REST = 300, TTL = 60000, HEAD_H = 52;
  /* Rueckkehr aus dem Player: erst nach PLAY_SETTLE laden (Timeline "stopped" ist dann beim PMS), fehlt der Titel noch in
   * Weiterschauen, die Antwort NICHT anwenden (nichts verschwindet) und nach PLAY_RETRY erneut fragen; danach gilt der Server */
  var PLAY_SETTLE = 1500, PLAY_RETRY = [2500, 5000];
  /* HOME-12 (TV-Test 30.10.): der PMS erhoeht contentChangedAt, sobald er eine neue Datei aufnimmt, nennt den Titel in "Zuletzt
   * hinzugefuegt" aber erst nach dem Zuordnen (am TV 16 s nach dem Signal noch nicht, Ankunft ~1:45 min nach dem Import) – und das
   * Signal steigt danach nicht noch einmal. Deshalb dieselben Reihen nach FOLLOW ms noch einmal holen (Abstaende ab der letzten Antwort) */
  var FOLLOW = [30000, 60000, 120000];
  /* Kachelgroesse (HOME-15, Einstellung homeSize L/M/S): Masse je Art und Reihenabstand aus RowMath.homeGeom; L = wie bisher
   * (Querformat 288, Poster 360, quadratisch 280 Kopf zu Kopf). Gelesen beim Aufbau und beim Betreten (nie im Fokusschritt) */
  function sizeSetting() { var st = N.session && N.session.settings, v = st && st.homeSize; return RM.HOME_SIZES.indexOf(v) >= 0 ? v : 'L'; }
  /* caps.home 'tiles' (Apple Nr. 12/16, 08-touch S4): kein Infobereich oben – Reihen ab y 88 (unter der Uhr), alle Reihen sichtbar,
   * Poster/Cover mit Beschriftung (Titel stehen sonst im Hero), dafuer hoehere Reihen. Eigene Geometrie (RowMath.geom fuer die
   * Breite + PITCH_TILES), die Kachelgroesse gilt dort nicht (Einstellung ausgeblendet) */
  var PITCH_TILES = { land: 312, poster: 400, sq: 312 };
  /* Kacheln dicht (nur flexible Flaeche mit Hoehe unter 720, iPhone quer; 10-screens.md 6.3 M·F): Kachelgroesse M (Querformat 240,
   * Poster 144, quadratisch 144) und engere Reihen – statt anderthalb Reihen passen gut zwei ins Bild. Reihenabstand = Kopf 52 +
   * Beschriftungs-Oberkante (capY) + zwei Zeilen (24 + 22) + 16 Luft bis zur naechsten Ueberschrift: Querformat 52+157+46 = 255 -> 272,
   * Poster 52+238+46 = 336 -> 352, quadratisch 52+166+46 = 264 -> 280 (Nachbefund 03.11.: vorher 264/328/256, der Untertitel der
   * Poster- und Quadrat-Reihen beruehrte die naechste Ueberschrift; PITCH_TILES hat ueberall >= 16 Luft) */
  var PITCH_DENSE = { land: 272, poster: 352, sq: 280 };
  var CLIP_T = 80;                                     // Kacheln: Oberkante des Reihen-Ausschnitts (unter der Uhr, ueber dem ersten Kopf)
  /* Infobereich ueber den Kacheln (Apple Nr. 34, SPEC HOME-18; caps.homeHero + Einstellung homeHero, Standard an): der TV-Hero
   * (Titel, Infos, Bild der Kachel im Fokus bzw. unter dem Zeiger) steht fest oben, die Reihen darunter rollen frei wie bei den
   * Kacheln und laufen hinter ihm mit einem weichen Verlauf aus (Ausschnitt ab HT_CLIP, Maske HT_FADE px). Reihen wie am TV
   * (Groesse L, Beschriftung nur Querformat), erster Kopf bei HT_HEAD. Nur ohne Finger (N.input 'pointer'/'key'), ab Breite M und
   * wenn die Flaeche hoch genug ist (RowMath.heroTall mit Hysterese: heroWas gilt ueber Neuaufbauten hinweg, Fenster-Ziehen am Mac
   * schaltet nicht hin und her). Am TV nie (caps.homeHero fehlt). */
  var HT_HEAD = 348, HT_CLIP = 308, HT_FADE = 40, heroWas = null;
  function heroWanted(A, keep) {
    var c = N.platform.caps;
    if (c.home !== 'tiles' || c.homeHero !== true || !N.screen.flex) return false;
    var tall = RM.heroTall(A.h, heroWas);
    if (!keep) heroWas = tall;                          // keep: nur nachsehen (stale), Zustand nicht fortschreiben
    var st = N.session && N.session.settings;
    return tall && N.screen.cls.w !== 'K' && N.input.mode !== 'touch' && !(st && st.homeHero === false);
  }

  N.router.define('home', function () {
    var s = { rail: 'home', wheelKeys: ['LEFT', 'RIGHT'], news: 'clock', flex: true };   // HOME-13: Hinweis bei neuen Inhalten rechts unter der Uhr
    var A = N.screen.view(), VIS = RM.visFor(A.h);   // Flaeche (TV 1280x720; flexibel nur Apple: breitere Reihen, Zonen bis unten)
    var caps = N.platform.caps, TILES = caps.home === 'tiles', FREE = caps.scroll === 'free', TAP_DETAILS = caps.cardTap === 'details';
    /* HT = Infobereich ueber frei scrollenden Kacheln (HOME-18): wie TILES (freie Seite, alle Reihen sichtbar), aber mit Hero und
     * TV-Reihen; PLAIN = Kacheln ohne Infobereich (Hintergrund Nr. 27, Poster mit Beschriftung) */
    var HT = TILES && heroWanted(A), PLAIN = TILES && !HT;
    var DENSE = PLAIN && N.screen.flex && N.screen.cls.h === 'F';
    var HEAD_Y = HT ? HT_HEAD : TILES ? 88 : 320, CARD_Y = HEAD_Y + HEAD_H, PITCH = DENSE ? PITCH_DENSE : PITCH_TILES;   // PITCH nur Kacheln (sonst geom().pitch)
    var CLIP = HT ? HT_CLIP : CLIP_T, VIS_T = HT ? HT_CLIP + HT_FADE / 2 : CLIP_T;   // Ausschnitt oben; Zeiger/Ring erst ab VIS_T (darueber: Verlauf, Infobereich)
    /* Reihen-Slots: TV 4 (R-1 … R+2). Kacheln: so viele, wie Reihen auf die Hoehe passen, + Puffer oben/unten (08-touch 1 Punkt 3) */
    var SLOTS = HT ? Math.ceil(A.h / Math.min(RM.homeGeom('L', 'land', A.w).pitch, RM.homeGeom('L', 'sq', A.w).pitch)) + 3
      : TILES ? Math.ceil(A.h / Math.min(PITCH.land, PITCH.sq)) + 3 : 4;
    var used = false, onMode = null;                                   // HT-Wechsel ohne Neuaufbau nur, solange die Seite unbedient ist (s.stale)
    var lastIn = 0, catchT = 0;                                        // HOME-18 Nachholen: letzte Eingabe (ms), Zeitgeber
    var root, pg, ring, hero, sb, fade, cue, cueT, cueOn = false, slots = [], rows = [], tops = [], colMem = {}, R = 0;
    var slotRow = [], heroT = 0, task = null, loadedAt = 0, pending = null, interacted = false;
    /* freies Scrollen (caps.scroll 'free', S5/S6): py = Seitenlage (px); loose = Lage frei verschoben (erste Taste setzt den Fokus auf
     * die Karte am Anker); pan = laufender Zug; drv = Antrieb je Slot bzw. Seite (N.kinetic.Drive); eat = Klick nach Stopp verschlucken */
    var py = 0, loose = false, pan = null, pageDrv = null, rowDrv = [], eat = false, winA = -1, winB = -1, wheelAx = '', wheelT = 0;
    for (var si = 0; si < SLOTS; si++) slotRow.push(-1);
    var undo = null, hideCommit = null, retryT = 0, retryN = 0, offline = false, pingT = 0, railOpen = false;
    var seasonCache = new N.LRU(10), stripTask = null, drawn = false;
    var skel = null, away = false, parked = null, resume = false, prepRaf = false, dead = false, onFlush = null, onSet = null, onBack = null, onPlayed = null, onScanned = null, onAnime = null, onEpg = null, cfgDirty = false;
    var size = 'L', skelSize = '';
    /* Kacheln (Apple Nr. 27, SPEC HOME-17): Hintergrund wie in Bibliotheken (N.ui.Ambient, Einstellung libBg/libBgStrength) –
     * Titel = oberste ganz sichtbare Kachel (Film/Serie), mit Tasten bzw. unter Maus/Trackpad die Kachel im Fokus; hov = der Zeiger
     * steht gerade ueber einer Kachel. TV: kein Element, nichts geladen (Hero bleibt). */
    var amb = null, hov = false;
    /* Geometrie je Art: Hero-Startseite (TV, Apple 'hero') = Kachelgroesse fuer die Flaechenbreite (TV 1280: wie bisher);
     * Kacheln = RowMath.geom fuer die Breite + Reihenabstand PITCH_TILES (je Art einmal kopiert, nie im Fokusschritt) */
    var tileG = {};
    function geom(kind) {
      if (HT) return RM.homeGeom('L', kind, A.w);      // Infobereich: Reihen wie am TV (Kachelgroesse-Einstellung gibt es auf Apple nicht)
      if (!TILES) return RM.homeGeom(size, kind, A.w);
      var b = PITCH_TILES[kind] ? kind : 'poster';
      if (!tileG[b]) { var g0 = DENSE ? RM.homeGeom('M', b, A.w) : RM.geom(b, A.w), g = {}; for (var f in g0) g[f] = g0[f]; g.base = b; g.size = DENSE ? 'M' : 'L'; g.pitch = PITCH[b]; tileG[b] = g; }
      return tileG[b];
    }
    var played = null, playT = 0, cueDisp = false;                     // {rk, n}: gerade gestoppter Film/Folge, auf den Weiterschauen warten soll
    /* HOME-12: Bibliothek geaendert (N.libwatch) -> nur die betroffenen Reihen holen; held = neue Fassung der fokussierten Reihe
     * (wartet, bis der Fokus die Reihe verlaesst oder die Startseite neu betreten wird); dirty = betroffene Reihen, waehrend ein
     * anderer Bildschirm oben war */
    var held = {}, dirty = [], onChanged = null, watchFn = null;
    /* heldT: fokussierte Reihe wartet hoechstens HELD_MS ohne Taste (auch unter dem Schoner), dann wird sie in Ruhe eingesetzt; fehlt die
     * fokussierte Karte in der neuen Fassung (auf dem Server entfernt), sofort (TV-Test 30.10.: geloeschte Serie blieb unter dem Fokus) */
    var heldT = 0, HELD_MS = 30000;
    /* again = Reihen einer Aenderung, die kam, waehrend schon geladen wurde (danach holen); chase/chaseN/chaseT = Nachsehen (FOLLOW) */
    var again = null, chase = [], chaseN = 0, chaseT = 0;

    /* ---------- Aufbau ---------- */
    s.create = function (el) {
      root = el;
      hero = PLAIN ? noHero() : HT ? new N.ui.Hero(root, { w: N.screen.box().w, xf: true, decode: true }) : new N.ui.Hero(root);
      if (HT) U.cls(root, 'hhero', true);             // flex.css: Bildkasten, Ueberblendung, Verlauf am Ausschnitt
      if (PLAIN && N.ui.Ambient) amb = new N.ui.Ambient(root, { moodArt: true, items: ambItems });   // Ebenen ganz unten (vor dem Ausschnitt)
      /* Kacheln: die Seite rollt frei nach oben – ueber dem ersten Reihenkopf (y 88) ein ruhiges Band fuer die Uhr (y 32–72).
       * Inhalt wird an CLIP_T abgeschnitten (eigener Ausschnitt, Seite darin um -CLIP_T versetzt; Koordinaten bleiben gleich), damit
       * keine Karte/Haekchen unter oder ueber dem halbdurchsichtigen Uhr-Kasten erscheint. TV: kein Ausschnitt. */
      if (TILES) {
        var clip = U.el('div', 'hclip', root, 'position:absolute;left:0;top:' + CLIP + 'px;width:' + A.w + 'px;height:' + (A.h - CLIP) + 'px;overflow:hidden');
        pg = U.el('div', 'pg', clip, 'top:' + (-CLIP) + 'px;height:' + A.h + 'px');
      } else pg = U.el('div', 'pg', root);
      size = sizeSetting();
      for (var i = 0; i < SLOTS; i++) slots.push(new N.ui.Row(pg, { geom: geom, captions: function (kind) { return PLAIN || kind === 'land'; }, w: A.w, free: FREE, clipH: PLAIN ? 400 : 0 }));
      fade = U.el('img', 'fade', root); fade.src = N.assetBase + 'fade-bottom.png';
      // HOME-11: fester "darunter geht es weiter"-Hinweis unten links (Glyphe wie .more-dn + Titel der naechsten Reihe), nur wenn
      // deren Kopf nicht im Bild ist (hohe Posterreihe); zeigen/klicken = eine Reihe tiefer. Runde 6: dauerhafte GPU-Ebene (.hmore
      // translate3d), Zeigen/Verbergen per visibility – siehe markMore
      cue = U.el('div', 'hmore', root, 'visibility:hidden');
      U.el('span', 'more-dn', cue).appendChild(document.createTextNode('›'));
      cueT = U.txt('span', 'ht', cue, '');
      ring = new N.ui.Ring(root);
      prepRing();
      sb = new N.ui.StateBlock(root);
      onFlush = function () { if (hideCommit) hideCommit.run(); };
      N.evt.on('app:flush', onFlush);                 // EXIT-Taste: ausstehendes Ausblenden sofort senden (L8)
      onSet = function (e) { if (e && (e.key === 'homeRows' || e.key === 'liveHome' || e.key === 'liveRegions' || e.key === 'liveTv')) cfgDirty = true; if (e && /^anime/.test(e.key) && hero) hero.paintOv(); };
      onAnime = function () { if (hero) hero.paintOv(); };
      N.evt.on('anime:changed', onAnime);             // "Als Anime behandeln" (TOOLS): Ueberzeile sofort anpassen
      N.evt.on('settings:changed', onSet);            // "Startseite anpassen": beim naechsten Betreten neu ordnen + laden
      onBack = function () { if (!away && !dead && rows.length && !sb.on) heroBack(); };
      N.evt.on('overlay:closed', onBack);             // Hero nach Dialog/Menue/Bildschirmtastatur immer wiederherstellen
      N.evt.on('app:refocus', onBack);
      onPlayed = function (e) {
        loadedAt = 0; interacted = false;
        parked = null;                                // Antwort von vor/waehrend der Wiedergabe: veraltet
        if (task) { task.abort(); task = null; }
        if (playT) { clearTimeout(playT); playT = 0; }
        played = e && e.video && e.rk && !e.done && !e.srv ? { rk: e.rk, n: 0, wait: true } : null;
      };
      N.evt.on('playback:stopped', onPlayed);         // Rueckkehr aus dem Player: Weiterschauen neu laden (SPEC 6.3.2)
      onScanned = function () { loadedAt = 0; if (!away && !dead) refresh(); };
      N.evt.on('library:scanned', onScanned);         // "Mediathek aktualisieren" fertig: still neu laden
      onChanged = function (e) {
        if (dead) return;
        var ids = H.affected(e && e.libs, order());
        N.log('home changed libs ' + (e && e.libs || []).join(',') + ' -> ' + ids.join(',') + (task ? ' (laedt schon)' : '') + (away ? ' (verdeckt)' : ''));
        if (!ids.length) return;
        merge(chase, ids); chaseN = 0;                // Nachsehen (FOLLOW) beginnt nach der naechsten Antwort von vorn
        if (chaseT) { clearTimeout(chaseT); chaseT = 0; }
        // laeuft gerade ein Laden, kann seine Liste schon VOR der Aenderung geholt sein (Signal aus einer eigenen Anfrage) -> danach holen
        if (task) { again = merge(again || [], ids); return; }
        if (away) { merge(dirty, ids); return; }
        refresh(ids);
      };
      N.evt.on('library:changed', onChanged);         // HOME-12: neue Titel auf dem Server -> betroffene Reihen an Ort und Stelle
      onEpg = function () { if (!dead) N.idle.add(liveFresh, 'home-live'); };
      N.evt.on('live:epg', onEpg);                    // Fernsehen (LIVE-8): "Laeuft gerade" angekommen -> Reihe im Leerlauf neu beschriften
      N.evt.on('live:avail', onEpg);                  // Helfer erreichbar bzw. weg (LIVE-10): Sender mit getrenntem Ton dazu/weg
      watchFn = function () { return !dead && !away; };
      N.libwatch.want(watchFn);                       // solange die Startseite oben ist: alle 2 Min. im Leerlauf nachsehen
      if (TILES && caps.homeHero === true) { onMode = function () { modeChanged(); }; N.evt.on('input:mode', onMode); }
    };
    /* HOME-18: Eingabeart gewechselt (iPad: Finger <-> Trackpad/Tastatur). Der Infobereich kommt sofort nur, solange die Seite noch
     * unbedient ist (frisch aufgebaut, nichts gerollt/getippt – es springt nichts); sonst und zurueck zu den Kacheln (Finger) erst beim
     * naechsten Aufbau der Seite (s.stale: Rueckkehr aus einem anderen Bereich, den Einstellungen …). Grund: am iPad werden Finger
     * und Trackpad gemischt benutzt (Nr. 28) – die Seite darf unter dem Finger nicht umspringen, der erste Tipp traefe sonst
     * eine andere Kachel. */
    function modeChanged() {
      if (dead || away || HT || !heroWanted(A, true)) return;
      if (!used && py === 0 && !railIsOpen() && N.router.renew(s)) return;
      catchUp();
    }
    /* Nachholen (Nutzerbefund 04.11., Vorschlag A): auf einer schon bedienten Seite kommt der Infobereich, sobald das ohne sichtbaren
     * Sprung geht – Zeiger/Tasten, Seite ganz oben (py 0), kein Zug, keine Karte, kein Overlay, Seitenleiste zu und CATCH_MS ohne
     * Eingabe. Zurueck zu den Kacheln (Finger) weiter erst beim naechsten Aufbau (heroWanted dann false: nichts nachzuholen).
     * Verdeckt (away): Schluss, die Rueckkehr baut ueber s.stale ohnehin neu. */
    var CATCH_MS = 1000;
    function railIsOpen() { return !!(N.ui.rail && N.ui.rail.isOpen && N.ui.rail.isOpen()); }
    function poke() { lastIn = U.now(); }
    function catchUp() { if (!catchT && !dead && !HT) catchT = setTimeout(tryCatch, CATCH_MS); }
    function tryCatch() {
      catchT = 0;
      if (dead || away || HT || !heroWanted(A, true)) return;
      var wait = CATCH_MS - (U.now() - lastIn);
      if (wait <= 0 && !pan && py === 0 && !railIsOpen() && !N.router.hasOverlay() && N.router.renew(s)) return;
      catchT = setTimeout(tryCatch, Math.max(wait, 250));
    }
    s.stale = function () { return TILES && caps.homeHero === true && heroWanted(A, true) !== HT; };
    /* Kacheln ohne Infobereich: Platzhalter mit den Methoden des Hero (alle Aufrufe bleiben, nichts wird gemalt oder geladen) */
    function noHero() { var f = function () {}; return { item: null, set: f, clear: f, refresh: f, setStrip: f, paintOv: f }; }
    /* Hero passend zum Fokus: anderes Element -> neu setzen; gleiches -> Bild auffrischen */
    function heroBack() {
      var it = curItem();
      if (it && it.all) it = rows[R].items[H.realCount(rows[R]) - 1] || null;
      if (it !== hero.item) scheduleHero(0); else hero.refresh();
    }
    /* Runde 7: je Form ein Ring – Formwechsel Querformat <-> Poster ohne Groessenaenderung (Formen der aktuellen Kachelgroesse) */
    function prepRing() { ring.prep([geom('land').kind, geom('poster').kind, geom('sq').kind]); }
    /* Kachelgroesse beim Betreten geaendert? -> neue Geometrie (true = alles neu zeichnen; Skelett baut showSkel neu) */
    function sizeChanged() {
      var v = sizeSetting();
      if (v === size) return false;
      size = v; prepRing();
      return true;
    }
    function cfg() { var st = N.session.settings; return st && st.homeRows || null; }
    function order() { return H.order(cfg(), s.libs || [], s.alibs || s.libs || []); }
    /* Server-Titel der Playlists-Reihe aus dem Hub-Katalog (nur in der aktuellen Sprache, sonst eigener Text) */
    function plTitle() { var c = N.session.hubCatalog(); return c && c.lang === N.i18n.lang() && c.pl ? c.pl.title : ''; }
    /* Katalog mit frischen Hub-Listen der geladenen Bibliotheken aktualisieren (Titel in der App-Sprache) */
    function updateCatalog(hubCat) {
      var c = N.session.hubCatalog(), libsDone = [], k, i;
      for (k in hubCat) libsDone.push(Number(k));
      if (!libsDone.length || !c || c.lang !== N.i18n.lang()) return;
      var hubs = [];
      for (i = 0; i < (c.hubs || []).length; i++) if (libsDone.indexOf(c.hubs[i].lib) < 0) hubs.push(c.hubs[i]);
      for (k in hubCat) hubs = hubs.concat(hubCat[k]);
      c.hubs = N.homeRows.sortCatalog(hubs, c.alibs || []);
      N.session.setHubCatalog(c);
    }
    /* Lade-Skelett (SPEC 9: nie ein leerer Bildschirm): statische Platzhalter, ohne Animation */
    function showSkel(on) {
      if (!on) { if (skel) U.show(skel, false); return; }
      if (skel && skelSize !== size) { root.removeChild(skel); skel = null; }   // Kachelgroesse geaendert (nur ohne Inhalt sichtbar)
      if (!skel && PLAIN) {                           // Kacheln: nur Reihen-Platzhalter ab oben
        skelSize = size;
        skel = U.el('div', 'skel', root);
        for (var t = 0; t < 3; t++) {
          U.el('i', '', skel, 'left:144px;top:' + (HEAD_Y + t * PITCH.land) + 'px;width:240px;height:28px');
          for (var j = 0; j < 4; j++) U.el('i', '', skel, 'left:' + (144 + j * 312) + 'px;top:' + (CARD_Y + t * PITCH.land) + 'px;width:288px;height:162px');
        }
      }
      if (!skel) {
        var g = geom('land'), n = Math.min(4, g.visible);
        skelSize = size;
        skel = U.el('div', 'skel', root);
        U.el('i', '', skel, 'left:144px;top:96px;width:200px;height:20px');
        U.el('i', '', skel, 'left:144px;top:136px;width:420px;height:40px');
        U.el('i', '', skel, 'left:144px;top:196px;width:300px;height:20px');
        U.el('i', '', skel, 'left:144px;top:' + HEAD_Y + 'px;width:240px;height:28px');
        for (var i = 0; i < n; i++) U.el('i', '', skel, 'left:' + (144 + i * g.step) + 'px;top:' + CARD_Y + 'px;width:' + g.w + 'px;height:' + g.h + 'px');
        U.el('i', '', skel, 'left:144px;top:' + (HEAD_Y + g.pitch) + 'px;width:240px;height:28px');
      }
      U.show(skel, true);
    }
    function layoutTops() {
      tops = []; var y = HEAD_Y;
      for (var i = 0; i < rows.length; i++) { tops.push(y); y += geom(rows[i].kind).pitch; }
    }
    function slotFor(r) { return slots[r % SLOTS]; }
    /* Reihe r in ihren Slot bringen (falls dort noch eine andere liegt). lazy (P7 27.10.): verdeckte Reihe in rAF-Haeppchen fuellen;
     * sonst sind die sichtbaren Karten danach sicher da (auch wenn ein Haeppchen-Fuellen noch laeuft) */
    function ensure(r, prio, lazy) {
      if (r < 0 || r >= rows.length) return;
      var k = r % SLOTS, sl = slots[k];
      if (slotRow[k] !== r) { sl.setModel(rows[r], colMem[r] || 0, lazy ? 2 : 0); slotRow[k] = r; }
      else if (!lazy && sl.pend) sl.render(1, 1);
      sl.setTop(tops[r]);
      sl.setVisible(TILES || r >= R);
      if (prio === 0) sl.boost();
      markMore();
    }
    /* Hinweis "darunter geht es weiter" (HOME-11): nur am Kopf der angeschnittenen naechsten Reihe; an der letzten Reihe keiner.
     * Je Slot nur ein display-Wechsel, wenn er sich aendert (kein Messen im Fokusschritt).
     * Runde 6 (TV 9,8,6: die langen Frames @U32+0 79 ms / @D33+0 54 ms mit nur ~4 ms JS lagen genau bei den Wechseln Querformat <->
     * Poster = wenn der feste Hinweis unten erscheint/verschwindet): .hmore liegt ueber der Seiten-Ebene und wurde deshalb bei jedem
     * display-Wechsel als GPU-Ebene neu angelegt bzw. verworfen (Ebenenbaum neu, Flaeche in der Wurzel-Ebene neu malen – dort liegen
     * Hero-Bild + Scrim ohne eigene Ebene). Jetzt dauerhafte Ebene, Wechsel nur per visibility (malt nur die kleine Ebene).
     * cueDisp = Gegenprobe des Messlaufs (hvar-cue0: alter display-Wechsel ohne Ebene). */
    function markMore() {
      if (TILES) return;                              // Kacheln: alle Reihen sichtbar, die Seite rollt frei – kein Hinweis noetig
      for (var k = 0; k < SLOTS; k++) slots[k].setMore(slotRow[k] >= 0 && slotRow[k] === R + 1);
      var on = !sb.on && R + 1 < rows.length && nextZone().cue;     // Kopf der naechsten Reihe nicht im Bild: fester Hinweis unten
      if (on) U.setText(cueT, H.rowTitle(rows[R + 1]));
      if (on !== cueOn) { cueOn = on; if (cueDisp) U.show(cue, on); else U.vis(cue, on); }
    }
    /* Zeiger-Zone "naechste Reihe" (RowMath.nextZone): ab ihrem Kopf, sonst ab der Unterkante der Fokus-Karten */
    function nextZone() { return RM.nextZone(tops[R + 1] - pageY(), CARD_Y + slotFor(R).g.h, VIS); }
    function recycleLater() {
      if (TILES) { N.idle.add(function () { syncWin(true); }, 'home-recycle'); return; }
      N.idle.add(function () {
        for (var r = R - 1; r <= R + 2; r++) ensure(r, r === R ? 0 : 2, r > R + 1 || r < R);
        for (var k = 0; k < SLOTS; k++) { var rr = slotRow[k]; if (rr >= 0 && (rr < R - 1 || rr > R + 2 || rr >= rows.length)) { slots[k].clear(); slotRow[k] = -1; } }
        markMore();
      }, 'home-recycle');
    }
    /* Seitenlage fuer die Fokusreihe R (Reihe am Anker HEAD_Y). Kacheln (Apple): in [0, maxPy] geklemmt – sonst stand nach einem
     * Neuaufbau mit einer der letzten Reihen im Fokus (z. B. Einstellungen -> Startseite, Groessenwechsel) die letzte Reihe oben und
     * darunter leerer Raum, bis man von Hand scrollte (Auftrag 02.11. Punkt 14). TV unveraendert (Fokusreihe immer am Anker). */
    function pageY() {
      if (!rows.length) return 0;
      var y = tops[R] - HEAD_Y;
      return TILES ? Math.max(0, Math.min(y, maxPy())) : y;
    }
    function jumpPage() {
      py = pageY();
      pg.style.webkitTransition = 'none'; U.tf(pg, 0, -pageY());
      setTimeout(function () { if (!loose) pg.style.webkitTransition = ''; }, 60);
    }
    /* ---------- Kacheln: Fenster aus der Seitenlage (S6) ----------
     * sichtbar = Reihen, die [py, py + H] schneiden; dazu je eine Reihe Puffer oben/unten. Passt immer in SLOTS (Reihe mod SLOTS
     * eindeutig). Sichtbare Reihen sofort, Puffer in Haeppchen. Liegt die Fokusreihe nicht mehr im Bild, geht der (unsichtbare)
     * Fokus auf die Karte am Anker – so meinen Hinweise/Optionen immer eine sichtbare Karte. */
    function pitchOf(r) { return geom(rows[r].kind).pitch; }
    function rowAtPage(yp) { for (var r = 0; r < rows.length; r++) if (yp >= tops[r] && yp < tops[r] + pitchOf(r)) return r; return -1; }
    function visRange() {
      var a = -1, b = -1;
      for (var r = 0; r < rows.length; r++) if (tops[r] + pitchOf(r) > py && tops[r] < py + A.h) { if (a < 0) a = r; b = r; }
      return a < 0 ? [0, -1] : [a, b];
    }
    function anchorRow() {
      for (var r = 0; r < rows.length; r++) if (tops[r] + pitchOf(r) / 2 > py + HEAD_Y - HEAD_H) return r;
      return Math.max(0, rows.length - 1);
    }
    function syncWin(force) {
      if (!TILES || !rows.length) return;
      var v = visRange(), a = Math.max(0, v[0] - 1), b = Math.min(rows.length - 1, v[1] + 1);
      while (b - a + 1 > SLOTS) b--;
      if (!force && a === winA && b === winB) return;
      winA = a; winB = b;
      for (var k = 0; k < SLOTS; k++) { var rr = slotRow[k]; if (rr >= 0 && (rr < a || rr > b || rr >= rows.length)) { stopRow(k); slots[k].clear(); slotRow[k] = -1; } }
      for (var r = a; r <= b; r++) ensure(r, r === R ? 0 : r >= v[0] && r <= v[1] ? 1 : 2, r < v[0] || r > v[1]);
      if (loose && (R < v[0] || R > v[1] || slotRow[R % SLOTS] !== R)) refocusAnchor();
    }
    function refocusAnchor() {
      var r = anchorRow();
      if (r === R && slotRow[R % SLOTS] === R) return;
      if (slotRow[R % SLOTS] === R) { colMem[R] = slotFor(R).f; slotFor(R).setFocused(false); }
      R = r;
      ensure(R, 0);
      var sl = slotFor(R);
      sl.hoverCol(sl.anchorCol()); sl.setFocused(true);
      N.idle.add(updateHints, 'home-hints');
    }
    /* komplettes Neuzeichnen (Cache-Start, Layout-Aenderung, Profil/Sprache) */
    function renderAll() {
      showSkel(false);
      stopAll(); loose = false; winA = winB = -1;
      layoutTops();
      for (var k = 0; k < SLOTS; k++) { slots[k].clear(); slotRow[k] = -1; }
      markMore();
      if (!rows.length) { ring.hide(); hero.clear(); showEmpty(); return; }
      sb.hide();
      R = U.clamp(R, 0, rows.length - 1);
      if (TILES) { py = pageY(); syncWin(true); }
      else for (var r = R - 1; r <= R + 2; r++) ensure(r, r === R ? 0 : 1, r > R + 1 || r < R);
      jumpPage();
      var sl = slotFor(R);
      sl.setFocused(true);
      placeRing(sl.ringPos(), true);
      scheduleHero(0);
      N.idle.add(updateHints, 'home-hints');
      N.idle.add(warm, 'home-warm');
      N.idle.add(extNear, 'home-ext');
      N.idle.add(liveEpg, 'home-live-epg');
      if (amb) { amb.data(); ambKick(); }
    }
    /* Fernsehen (LIVE-8): Programmdaten der Sender in der Reihe holen (nur wo der Sender sie offen anbietet; im Leerlauf) */
    function liveRow() { for (var r = 0; r < rows.length; r++) if (rows[r].live) return r; return -1; }
    function liveEpg() { var r = liveRow(); if (r >= 0 && !dead) N.live.epgFetch(liveIds(rows[r])); }
    /* neue Beschriftung: nicht fokussierte Reihe an Ort und Stelle, fokussierte erst nach Tastenruhe (wie HOME-12) */
    function liveFresh() {
      var r = liveRow(), nr = r >= 0 ? N.live.homeRow() : null;
      if (!nr || dead || away) return;
      if (r === R) { held[nr.id] = nr; holdLater(); } else putRow(r, nr);
    }
    function placeRing(p) {
      if (rows[R] && !rows[R].items.length) { ring.hide(); return; }   // Hinweis-Reihe einer Erweiterung ("Wird geladen …"): keine Karte
      if (!p || railOpen || sb.on) return;
      var y = TILES ? Math.round(tops[R] + HEAD_H - py) : CARD_Y;      // Kacheln: Reihe kann frei stehen
      /* Kacheln, Maus/Trackpad (Nr. 29): Ring scrollt mit der Karte; ist sie oben unter das Uhr-Band (CLIP_T) bzw. links unter die
       * Inhaltskante (128) gewandert, waere er ueber Uhr bzw. Seitenleiste zu sehen -> verbergen, bis wieder eine ganze Karte gemeint ist */
      if (TILES && N.input.mode !== 'key' && (y < VIS_T || p.x < 128)) { ring.hide(); return; }
      ring.to(p.shape, p.x, y);
    }
    /* Nr. 29: Seite/Reihe frei gescrollt -> Ring an die Lage der Fokuskarte (selber Frame, ohne Gleiten), Treffer unter dem Zeiger
     * neu bestimmen (N.pointer.follow, hoechstens einmal je Frame). Nur Maus/Trackpad; bei Finger ist kein Ring zu sehen. */
    function ptrScrolled(r) {
      if (N.input.mode !== 'pointer' || !rows.length) return;
      if ((r === undefined || r === R) && slotRow[R % SLOTS] === R && rows[R].items.length) { N.fx.step(true); placeRing(slotFor(R).ringPos()); }
      if (N.pointer && N.pointer.follow) N.pointer.follow();
    }
    /* ---------- Hintergrund (nur Kacheln, Nr. 27) ---------- */
    function ambVideo(it) { return it && !it.all && M.isVideo(it) ? it : null; }
    /* oberste ganz sichtbare Kachel (Film/Serie): erste Reihe, deren Karten ganz im Bild stehen, darin ab der ersten ganz sichtbaren
     * Karte nach rechts; nur Reihen-/Seiten-Mathe (keine Layout-Abfragen) */
    function topTile() {
      for (var r = 0; r < rows.length; r++) {
        var k = r % SLOTS, cy = tops[r] + HEAD_H - py;
        if (slotRow[k] !== r || cy < CLIP) continue;
        var sl = slots[k], g = sl.g;
        if (cy + g.h > A.h) return null;
        for (var i = sl.anchorCol(), n = sl.count(); i < n; i++) {
          var x = sl.free ? RM.xPx(i, sl.px, g) : RM.x(i, sl.sc, g);
          if (x + g.w > A.w) break;
          if (ambVideo(sl.item(i))) return sl.item(i);
        }
      }
      return null;
    }
    /* Titel fuer den Hintergrund: Tasten = Fokus; Maus/Trackpad ueber einer Kachel = diese; sonst (Finger, Zeiger daneben) die
     * oberste ganz sichtbare. Nur merken – N.ui.Ambient wechselt erst nach 600 ms Ruhe (Scrollen/Schwung zaehlt als Eingabe) */
    function ambKick() {
      if (!amb || !rows.length) return;
      var m = N.input.mode, it = m === 'key' || (m === 'pointer' && hov) ? ambVideo(curItem()) : topTile();
      if (it) amb.focus(it);
    }
    /* Zufallsbild: Filme/Serien der geladenen Reihen (einmal je Aufbau der Startseite gewaehlt) */
    function ambItems() {
      var o = [];
      for (var r = 0; r < rows.length && o.length < 120; r++) for (var i = 0; i < rows[r].items.length; i++) if (ambVideo(rows[r].items[i])) o.push(rows[r].items[i]);
      return o;
    }
    function curItem() { var sl = slotFor(R); return rows.length && (!TILES || slotRow[R % SLOTS] === R) ? sl.item(sl.f) : null; }

    /* ---------- Hero (300 ms Ruhe) + Staffelstreifen ---------- */
    function scheduleHero(delay) {
      if (PLAIN) return;                              // kein Infobereich: weder Bild noch Staffelstreifen laden
      if (heroT) clearTimeout(heroT);
      heroT = setTimeout(function () {
        heroT = 0;
        var rest = N.idle.restFor();
        if (rest < HERO_REST) { scheduleHero(HERO_REST - rest); return; }
        var it = curItem();
        if (it && it.all) it = rows[R].items[H.realCount(rows[R]) - 1] || null;   // "Alle anzeigen" (HOME-14): Hero der letzten Karte davor
        if (it === hero.item || (!it && rows[R] && rows[R].note)) return;   // Hinweis-Reihe: Hero bleibt stehen
        var stripOn = !!(N.session.settings && N.session.settings.episodeProgress);
        hero.set(it, { stripEnabled: stripOn });
        if (it && it.type === 'episode' && stripOn && it.seasonRk) loadStrip(it);
      }, delay === undefined ? HERO_REST : delay);
    }
    function stripLayout(it, data) {
      return N.SeasonStrip.layout({ enabled: true, size: 'L', episodes: data.eps, total: data.total, viewed: data.viewed, next: it.e, threshold: N.config.watchedThreshold });
    }
    function loadStrip(it) {
      var key = it.seasonRk, c = seasonCache.get(key);
      if (c && U.now() - c.ts < 300000) { hero.setStrip(stripLayout(it, c)); return; }
      if (stripTask) stripTask.abort();
      stripTask = N.plex.get('/library/metadata/' + key + '/children', { 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 31,
        excludeElements: H.EXCL, excludeFields: 'summary' }, null, function (err, d) {
        stripTask = null;
        if (err || !d || !d.MediaContainer) return;
        var mc = d.MediaContainer, list = mc.Metadata || [], eps = [], total = Number(mc.totalSize || mc.size || list.length);
        for (var i = 0; i < list.length; i++) eps.push({ index: Number(list[i].index) || i + 1, vc: Number(list[i].viewCount) || 0, off: Number(list[i].viewOffset) || 0, dur: Number(list[i].duration) || 0 });
        function done(data) { seasonCache.set(key, data); if (hero.item === it) hero.setStrip(stripLayout(it, data)); }
        if (total <= N.SeasonStrip.MAX_CELLS) { done({ eps: eps, total: total, viewed: 0, ts: U.now() }); return; }
        // Modus B: Balken aus leafCount/viewedLeafCount der Staffel (keine 1100 Folgen laden)
        stripTask = N.plex.get('/library/metadata/' + key, { excludeElements: H.EXCL, excludeFields: 'summary' }, null, function (e2, d2) {
          stripTask = null;
          var m = !e2 && d2 && d2.MediaContainer && d2.MediaContainer.Metadata && d2.MediaContainer.Metadata[0];
          if (!m) return;
          done({ eps: null, total: Number(m.leafCount) || total, viewed: Number(m.viewedLeafCount) || 0, ts: U.now() });
        });
      });
    }

    /* ---------- Hinweisleiste (Kontextwechsel, Idle-Queue) ---------- */
    function updateHints() { N.router.refreshHints(); }
    s.hints = function () {
      if (sb.on) return sb.ids.length ? [{ k: 'ret', t: 'hint.exit' }] : [N.disc.blueHint(), { k: 'ret', t: 'hint.exit' }];
      if (!rows.length) return [N.disc.blueHint()];      // Lade-Skelett: keine Karten-Aktionen
      var it = curItem(), list = [];
      if (it && it.ext) return [{ k: 'OK', t: 'hint.details' }, N.disc.blueHint()];   // Erweiterungs-Karte: nur Details
      if (it && it.live) return [{ k: 'OK', t: 'hint.watch' }, N.disc.blueHint(), { k: 'TOOLS', t: 'hint.options' }];   // Fernsehen (LIVE-6)
      if (it && it.all) return [{ k: 'OK', t: 'hint.showAll' }, N.disc.blueHint()];   // HOME-14 "Alle anzeigen"
      if (!it && rows[R] && rows[R].note) return [N.disc.blueHint()];   // Hinweis-Reihe ohne Karten
      if (rows[R] && rows[R].id === 'cw') list.push({ k: 'red', t: 'hint.hide' });
      if (M.isVideo(it)) list.push({ k: 'yellow', t: M.watched(it) ? 'hint.markUnwatched' : 'hint.markWatched' });
      list.push(N.disc.blueHint());
      list.push({ k: 'INFO', t: 'hint.details' });
      if (list.length < 5) list.push({ k: 'TOOLS', t: 'hint.options' });
      return list;
    };

    /* ---------- Fokus-Schritte ---------- */
    function afterMove() { scheduleHero(); N.idle.add(updateHints, 'home-hints'); N.idle.add(warm, 'home-warm'); N.idle.add(extNear, 'home-ext'); if (amb) ambKick(); if (DWARM && N.details.warm) N.details.warm(curItem()); }
    var DWARM = !!(N.ui.card && N.ui.card.on());       // Detailkarte (Apple): Hintergrund der fokussierten Karte vorladen (DET-21); TV: nie
    /* Reihen einer optionalen Erweiterung (N.hubs.extRow): erst laden, wenn sie in die Naehe kommen (R-1 … R+2), immer aus der
     * Idle-Queue (nie im Fokusschritt); naht der Fokus dem Ende einer geladenen Reihe, die mehr hat, die naechste Seite holen. */
    function extNear() {
      if (dead || away || !rows.length || !N.ext.has('home:want')) return;
      var a = TILES ? Math.max(0, Math.min(R, winA)) : Math.max(0, R - 1), b = TILES ? Math.max(R + 1, winB) : R + 2;
      for (var r = a; r <= b && r < rows.length; r++) {
        var row = rows[r];
        if (row.ext && row.want) N.ext.call('home:want', row.id, gotExt);
      }
      var cur = rows[R], sl = slotFor(R);
      if (cur && cur.ext && cur.more && sl.model === cur && sl.f >= cur.items.length - 6) N.ext.call('home:more', cur.id, function (id) { grewExt(id); });
    }
    /* geladene Erweiterungs-Reihe an die Stelle ihres Platzhalters (gleiche Hoehe: nichts springt) */
    function gotExt(row) {
      if (dead || !row) return;
      var r = -1, i;
      for (i = 0; i < rows.length; i++) if (rows[i].id === row.id) r = i;
      if (r < 0 || rows[r] === row) return;
      if (rows[r].kind !== row.kind) row.kind = rows[r].kind;   // Hoehe bleibt (layoutTops)
      /* TV-Test 30.10.: die geladene Reihe kam ohne ext-Kennung (die setzt sonst N.hubs.extRow) -> s.enter zeichnete ihre
       * Karten nach der Rueckkehr von der Detailseite nicht neu, die Marke einer Erweiterung fehlte bis zum naechsten Laden der Startseite */
      row.ext = true;
      rows[r] = row;
      var k = r % SLOTS;
      if (slotRow[k] === r) {
        slots[k].setModel(row, colMem[r] || 0, r === R ? 0 : 2); slots[k].setTop(tops[r]); slots[k].setVisible(TILES || r >= R);
        if (r === R && !away) { slots[k].setFocused(true); placeRing(slots[k].ringPos()); scheduleHero(0); N.idle.add(updateHints, 'home-hints'); }
      }
      markMore();
    }
    /* weitere Seite einer Erweiterungs-Reihe: die Erweiterung hat ihr Modell schon verlaengert -> Fenster neu herstellen */
    function grewExt(id) {
      if (dead) return;
      for (var k = 0; k < SLOTS; k++) { var r = slotRow[k]; if (r >= 0 && rows[r] && rows[r].id === id) slots[k].render(2, 2); }
      if (N.pointer && N.pointer.syncArrows) N.pointer.syncArrows();
    }
    /* Vorab-Dekodieren (Runde 5, N.img.warm): Der TV malt Karten-Ebenen unter dem Bildschirmrand bzw. rechts ausserhalb des Clips
     * erst, wenn sie hereinkommen – samt Dekodieren ihrer Bilder im Frame nach ▼/▶ (56–75 ms ohne DOM-Aenderung). In Ruhe: sichtbare
     * Spalten von R+1 und R+2 (kommen mit ▼ herein) und die naechsten Karten rechts/links in R (kommen mit ▶/◀). */
    function warm() {
      if (dead || away || !rows.length || TILES) return;   // Kacheln (schnelles Geraet): Puffer-Reihen/-Karten laden selbst voraus
      var out = [], sl, k;
      for (var r = R; r <= R + 2; r++) {
        k = r % SLOTS; sl = slots[k];
        if (r >= rows.length || slotRow[k] !== r) continue;
        if (r === R) { sl.urls(sl.sc + sl.g.visible, sl.sc + sl.g.visible + 1, out); sl.urls(sl.sc - 1, sl.sc - 1, out); }
        else sl.urls(sl.sc, sl.sc + sl.g.visible - 1, out);
      }
      N.img.warm(out);
    }
    function moveCol(f) {
      var sl = slotFor(R), p = sl.focusCol(f);
      placeRing(p); afterMove();
    }
    function moveRow(r, f) {
      if (r < 0 || r >= rows.length || r === R) return;
      var old = slotFor(R);
      colMem[R] = old.f;
      old.setFocused(false);
      var down = r > R;
      R = r;
      ensure(R, 0);                                   // meist schon da (Fenster R-1 … R+2)
      ensure(R + 1, 1);                               // angeschnittene naechste Reihe muss sofort stimmen
      if (TILES) py = pageY();
      else if (down) slots[(R - 1 + SLOTS) % SLOTS].setVisible(false); else slotFor(R).setVisible(true);
      markMore();
      var sl = slotFor(R);
      if (f !== undefined) sl.f = f;
      sl.setFocused(true);
      N.fx.move(pg); U.tf(pg, 0, -pageY());
      placeRing(f !== undefined ? sl.hoverCol(f) : sl.ringPos());
      recycleLater();
      prepareSoon();
      afterMove();
      for (var hk in held) { N.idle.add(applyHeld, 'home-held'); break; }   // Reihe verlassen: ihre neue Fassung in Ruhe einsetzen
    }
    /* Nachbarreihen (R-1 … R+2) einen Frame nach dem Schritt fuellen, nicht erst nach der Idle-Ruhe: bei Tastenwiederholung
     * (120–160 ms) waere R+1 sonst beim naechsten Schritt noch leer und wuerde IM Tastenhandler gebaut (M6) */
    function prepareSoon() {
      if (prepRaf) return;
      prepRaf = true;
      U.raf(function () {
        prepRaf = false;
        if (dead || away || !rows.length) return;
        if (TILES) { syncWin(true); return; }
        for (var r = R - 1; r <= R + 2; r++) ensure(r, r === R ? 0 : 2, r > R + 1 || r < R);
      });
    }
    function toTop() {
      if (R === 0) { moveCol(0); return; }
      colMem = {}; colMem[0] = 0;
      slotFor(R).setFocused(false);
      R = 0;
      renderAll();
    }

    /* ---------- Aktionen ---------- */
    function soon(area) { N.router.push('soon', { area: area }); }
    function openItem(it, play) {
      if (!it) return;
      if (it.all) { openAll(rows[R]); return; }      // HOME-14: Karte "Alle anzeigen" (OK, PLAY, Klick)
      if (it.ext) { if (!N.ext.call('home:open', it)) N.router.push('extdetails', { it: it, rail: 'home' }); return; }   // Titel ausserhalb des Servers (Erweiterungs-Reihe)
      if (it.live) { N.live.play(it.live, liveIds(rows[R])); return; }   // Fernsehen (LIVE-6): Sender sofort, CH▲/▼ blaettert in dieser Reihe
      if (N.music.isAudio(it)) { if (play && N.music.play(it)) return; if (N.music.open(it)) return; }   // M4 Musik/Hoerbuecher
      if (!M.isVideo(it)) { N.router.push('soon', { area: 'details', label: N.t('soon.music') }); return; }   // Musik/Hoerbuch/Playlist
      // OK auf Weiterschauen/Naechste Folgen und PLAY auf jeder Film-/Folgenkarte spielen ab (M3); sonst Details (M3b)
      if (M.isLeaf(it) && (play || rows[R].kind === 'land')) { N.player.play(it, play === true ? 'resume' : play || 'ask'); return; }
      if (play) { N.details.play(it, 'resume'); return; }          // PLAY auf Serie: naechste Folge (SPEC 7.3)
      N.details.open(it);
    }
    /* HOME-14 "Alle anzeigen": ganze Liste hinter der Reihe als Unterebene (NAV-5/6: RETURN kommt hierher zurueck, Fokus wieder auf
     * dieser Karte). Neu in … -> die Bibliothek, nur fuer diesen Besuch nach "Zuletzt hinzugefuegt" (gemerkte Sortierung bleibt);
     * Server-Hub, Weiterschauen, Naechste Folgen -> Raster der ganzen Liste; Erweiterungs-Reihe -> Raster aus ihrer Quelle.
     * Erst hier wird etwas geladen. */
    function libById(id) {
      var l = (s.alibs || []).concat(s.libs || []);
      for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
      return null;
    }
    function openAll(row) {
      var a = row && row.all, lib = a && a.lib ? libById(a.lib) : null;
      if (!a) return;
      if (a.t === 'lib') { if (lib) N.router.push('library', { lib: lib, once: { sort: a.sort } }); return; }
      /* Erweiterungs-Reihe mit eigener Karte (row.all = {t: 'x'}): Raster, dessen Titel die Erweiterung seitenweise liefert (lib:list) */
      if (a.t === 'x') { N.router.push('library', { lib: { id: 0, title: '', type: 'movie' }, rail: 'home', list: { title: H.rowTitle(row), src: 'x', id: row.id } }); return; }
      var cw = [], i, r;
      for (r = 0; r < rows.length; r++) if (rows[r].id === 'cw') for (i = 0; i < rows[r].items.length; i++) if (!rows[r].items[i].all) cw.push({ rk: rows[r].items[i].rk, showRk: rows[r].items[i].showRk });
      N.router.push('library', { lib: lib || { id: 0, title: '', type: 'movie' }, rail: 'home',
        list: { title: H.rowTitle(row), src: a.src, key: a.key || '', n: a.n || 0, kinds: H.libKinds(s.alibs || s.libs || []), cw: cw, cwOn: order().indexOf('cw') >= 0 } });
    }
    function scrobble(it, watched, cb) {
      N.plex.write('GET', watched ? '/:/scrobble' : '/:/unscrobble', { identifier: 'com.plexapp.plugins.library', key: it.rk }, cb);
    }
    function snapshot(it) { return { vc: it.vc, off: it.off, vleaf: it.vleaf }; }
    function restoreSnap(it, sn) { it.vc = sn.vc; it.off = sn.off; it.vleaf = sn.vleaf; }
    function applyWatched(it, w) {
      if (M.isLeaf(it)) { it.vc = w ? Math.max(1, it.vc) : 0; it.off = 0; } else it.vleaf = w ? it.leaf : 0;
    }
    function refreshAll(it) {
      for (var k = 0; k < SLOTS; k++) {
        var sl = slots[k];
        if (slotRow[k] < 0) continue;
        for (var i = 0; i < sl.count(); i++) if (sl.item(i).rk === it.rk) sl.refreshItem(i);
      }
      N.idle.add(updateHints, 'home-hints');
    }
    /* Gelb (SPEC 6.5): Film/Folge ohne Rueckfrage + Rueckgaengig; Serie/Staffel mit Bestaetigung (Fokus Abbrechen) */
    function toggleWatched() {
      var it = curItem();
      if (!M.isVideo(it) || it.ext) return;
      if (undo && undo.kind === 'watched' && U.now() < undo.until) { var u = undo; undo = null; N.ui.toast.hide(); u.revert(); return; }
      var w = !M.watched(it);
      if (it.type === 'show' || it.type === 'season') {
        var show = it.type === 'show', key = (w ? 'dlg.mark' : 'dlg.unmark') + (show ? 'Show' : 'Season');
        N.ui.dialog.open({ title: N.t(key + '.title'), text: N.t(key + '.text', { n: it.leaf, show: it.title, s: it.s }),
          buttons: [{ id: 'ok', t: N.t('dlg.mark.confirm') }, { id: 'cancel', t: N.t('dlg.mark.cancel') }], focus: 1,
          onSelect: function (id) { if (id === 'ok') doWatched(it, w); } });
        return;
      }
      doWatched(it, w);
    }
    function doWatched(it, w) {
      var sn = snapshot(it), row = rows[R], sl = slotFor(R), idx = sl.f;
      var leaves = row.kind === 'land' && w;        // aus Weiterschauen/Naechste Folgen verschwindet die Karte (6.3.1)
      applyWatched(it, w);
      if (leaves) removeCard(idx); else refreshAll(it);
      scrobble(it, w, function (err) {
        if (err) { restoreSnap(it, sn); if (leaves) reinsert(row, idx, it); else refreshAll(it); N.ui.toast.show(N.t('toast.actionFailed')); undo = null; }
      });
      N.ui.toast.show(N.t((w ? 'toast.markedWatched' : 'toast.markedUnwatched') + N.ui.toast.tapSuffix()), { undo: true, icon: 'confirm' });
      undo = { kind: 'watched', until: U.now() + 6000, revert: function () {
        restoreSnap(it, sn);
        if (leaves) reinsert(row, idx, it); else refreshAll(it);
        scrobble(it, !w, function () {});
        N.ui.toast.show(N.t('toast.undone'));
      } };
    }
    /* Rot "Ausblenden" (SPEC 7.3, UX-M7): nur lokal, Server erst nach 6 s */
    function hideCard() {
      if (!rows[R] || rows[R].id !== 'cw') return;
      if (undo && undo.kind === 'hide' && U.now() < undo.until) { var u = undo; undo = null; N.ui.toast.hide(); u.revert(); return; }
      if (hideCommit) hideCommit.run();
      var row = rows[R], sl = slotFor(R), idx = sl.f, it = sl.item(idx);
      if (!it || it.all) return;
      removeCard(idx);
      var who = N.plex.target();                     // Token jetzt festhalten: Commit kann erst nach dem Profilwechsel laufen
      var c = { done: false, t: 0, run: function () {
        if (c.done) return; c.done = true; clearTimeout(c.t); if (hideCommit === c) hideCommit = null;
        if (!who.base || !who.token) return;
        N.plex.write('PUT', '/actions/removeFromContinueWatching', { ratingKey: it.rk }, function (err) {
          if (err) N.diag.log('warn', 'removeFromContinueWatching failed ' + (err.status || err.type));
        }, who);
      } };
      c.t = setTimeout(c.run, 6000);
      hideCommit = c;
      N.ui.toast.show(N.t('toast.hidden' + N.ui.toast.tapSuffix()), { undo: true, undoKey: 'RED' });
      undo = { kind: 'hide', until: U.now() + 6000, revert: function () {
        c.done = true; clearTimeout(c.t); if (hideCommit === c) hideCommit = null;
        reinsert(row, idx, it); N.ui.toast.show(N.t('toast.undone'));
      } };
    }
    /* Karte entfernen; Fokus: nachrueckende Karte, sonst vorherige, leere Reihe -> naechste bzw. vorherige Reihe (6.3.1) */
    function removeCard(idx) {
      var sl = slotFor(R);
      sl.removeAt(idx);
      if (H.realCount(rows[R])) { placeRing(sl.ringPos()); afterMove(); return; }   // nur noch "Alle anzeigen" = Reihe leer
      rows.splice(R, 1);
      if (R >= rows.length) R = Math.max(0, rows.length - 1);
      colMem = {}; colMem[R] = 0;
      renderAll();
    }
    function reinsert(row, idx, it) {
      var r = rows.indexOf(row);
      if (r < 0) {                                   // Reihe war leer geworden -> wieder einsetzen
        row.items = [it]; H.withAll(row);
        rows.splice(Math.min(row.id === 'cw' ? 0 : 1, rows.length), 0, row);
        r = rows.indexOf(row); slotFor(R).setFocused(false); R = r; colMem = {}; colMem[r] = 0; renderAll(); return;
      }
      if (r !== R) moveRow(r);
      var sl = slotFor(R);
      sl.insertAt(Math.min(idx, sl.count()), it);
      placeRing(sl.ringPos()); afterMove();
    }
    /* "Version wählen" (SPEC 7.6/7.12): Dateien vom Server holen (nur GET), Wahl gilt in dieser Sitzung, dann abspielen */
    function chooseVersion(it) {
      N.plex.get('/library/metadata/' + it.rk, { excludeElements: H.EXCL }, { timeout: 12000 }, function (err, d) {
        var m = !err && d && d.MediaContainer && d.MediaContainer.Metadata && d.MediaContainer.Metadata[0];
        if (!m || !m.Media || !m.Media.length || N.router.top() !== s || N.router.hasOverlay()) { if (err) N.ui.toast.show(N.t('err.server.title'), { icon: 'info' }); return; }
        var vs = N.versions.list(m.Media), e = [], lim = N.decision.verLimit(N.session.settings.quality);
        for (var i = 0; i < vs.length; i++) e.push({ id: String(i), t: vs[i].label, s: vs[i].sub });
        N.ui.panel.select({ title: N.t('menu.version'), entries: e, selected: String(N.versions.choose(it.rk, m.Media, lim)), onSelect: function (v) {
          N.versions.set(it.rk, Number(v));
          openItem(it, 'ask');
        } });
      });
    }
    function menu() {
      var it0 = curItem(); if (!it0) return;
      if (it0.ext || it0.all) { openItem(it0, false); return; }   // Titel ausserhalb des Servers / "Alle anzeigen": kein Menue
      if (it0.live) { liveMenu(it0); return; }
      N.anime.ensure(it0, function () { if (curItem() === it0 && N.router.top() === s && !N.router.hasOverlay()) menuOpen(it0); });   // Einordnung fuer "Als Anime behandeln"
    }
    function liveIds(row) { var o = []; for (var i = 0; row && i < row.items.length; i++) if (row.items[i].live) o.push(row.items[i].live); return o; }
    /* Fernsehen (LIVE-6): Ansehen · Sender der Startseite (Liste wie "Startseite anpassen") · Alle Sender (Bereich Fernsehen) */
    function liveMenu(it) {
      N.ui.dialog.open({ title: it.title, buttons: [{ id: 'play', t: N.t('menu.watch') }, { id: 'pick', t: N.t('menu.liveHome') }, { id: 'all', t: N.t('menu.liveAll') }],
        vertical: true, focus: 0, top: 120,
        onSelect: function (id) {
          if (id === 'play') openItem(it, false);
          else if (id === 'pick') N.router.push('livehome');
          else N.app.navigate('livetv');
        } });
    }
    function menuOpen(it) {
      var b = [];
      if (M.isLeaf(it)) b.push({ id: 'play', t: N.t('menu.play') });
      if (M.isLeaf(it) && M.progress(it) > 0) b.push({ id: 'start', t: N.t('menu.fromStart') });
      if (M.isLeaf(it) && it.nv > 1) b.push({ id: 'version', t: N.t('menu.version') });
      if (M.isVideo(it)) b.push({ id: 'watched', t: N.t(M.watched(it) ? 'menu.markUnwatched' : 'menu.markWatched') });
      if (rows[R].id === 'cw') b.push({ id: 'hide', t: N.t('menu.hideContinue') });
      b = b.concat(N.anime.menuButtons(it));
      b.push({ id: 'info', t: N.t('menu.info') });
      N.ui.dialog.open({ title: it.title, buttons: b, vertical: true, focus: 0, top: 120,
        onSelect: function (id) {
          if (id === 'play') openItem(it, 'ask');
          else if (id === 'start') openItem(it, 'start');
          else if (id === 'watched') toggleWatched();
          else if (id === 'hide') hideCard();
          else if (id === 'version') chooseVersion(it);
          else if (N.anime.menuPick(id, it)) return;
          else N.details.open(it);
        } });
    }

    /* ---------- Daten ---------- */
    function libsChanged(libs) { N.ui.rail.setData(N.session.profile, libs); }
    function applyNetwork(res, inPlace) {
      N.log('home net ' + (inPlace ? 'teilweise' : 'ganz') + (interacted ? ', bedient' : '') + (H.sameLayout(rows, res.rows) ? '' : ', andere Anordnung -> beim naechsten Betreten'));
      if (!inPlace) loadedAt = res.at || U.now();     // Zeitpunkt der Anfrage (eine geparkte Antwort ist so alt wie ihr Laden)
      if (res.libs && (!s.libs || JSON.stringify(s.libs) !== JSON.stringify(res.libs))) { s.libs = res.libs; libsChanged(res.alibs || res.libs); }
      if (res.alibs) { if (s.alibs && JSON.stringify(s.alibs) !== JSON.stringify(res.alibs)) libsChanged(res.alibs); s.alibs = res.alibs; }   // M4: Rail auch mit Musik/Hoerbuechern
      if (res.hubCat) N.idle.add(function () { updateCatalog(res.hubCat); }, 'home-hubcat');
      // Teil-Fehler: Cache nicht mit Luecken ueberschreiben; naechster Versuch nach TTL
      if (!res.partial) N.session.setHomeCache({ v: 1, ts: loadedAt, libs: s.libs || [], alibs: s.alibs || [], rows: H.forCache(res.rows) });
      var nr = res.rows;
      if (!inPlace && (!rows.length || sb.on || (!interacted && !sameAll(rows, nr)))) { rows = nr; R = 0; colMem = {}; held = {}; renderAll(); return; }
      if (!interacted && !inPlace) return;
      if (!H.sameLayout(rows, nr)) { pending = nr; return; }      // beim naechsten Betreten (6.3.3)
      for (var r = 0; r < nr.length; r++) {
        if (H.sameRow(rows[r], nr[r])) { if (r === R) delete held[nr[r].id]; continue; }
        if (r === R) {                                   // fokussierte Reihe nicht unter dem Fokus umbauen: wartet (Fokus verlaesst sie, 30 s Ruhe)
          held[nr[r].id] = nr[r];
          var fit = slotFor(R).item(slotFor(R).f), gone = !!(fit && !fit.all && fit.rk && !nr[r].items.some(function (x) { return x.rk === fit.rk; }));
          N.log('home reihe ' + nr[r].id + (gone ? ' fokussierte Karte entfernt -> sofort' : ' wartet (Fokus)'));
          if (gone) swapFocused(true); else holdLater();
          continue;
        }
        N.log('home reihe ' + nr[r].id + ' neu: ' + (nr[r].items[0] && nr[r].items[0].title || ''));
        putRow(r, nr[r]);
      }
    }
    /* Reihe r (nicht fokussiert) an Ort und Stelle ersetzen: gemerkte Spalte folgt derselben Karte (H.keepFocus), Hoehe gleich */
    function putRow(r, row) {
      var old = rows[r], k = r % SLOTS, g = geom(row.kind), f0 = colMem[r] || 0;
      if (old && old.kind !== row.kind) row.kind = old.kind;
      /* Reihe am Anfang (gemerkte Spalte 0, nie hineingeblaettert): bleibt am Anfang, damit neue Titel vorn sichtbar sind (TV-Test 30.10.:
       * die neue Serie stand an Stelle 0, die Reihe folgte der alten ersten Karte und schob sie links aus dem Bild). Sonst folgt die
       * gemerkte Spalte derselben Karte (H.keepFocus). */
      colMem[r] = f0 > 0 ? H.keepFocus(old ? old.items : [], row.items, f0, N.RowMath.scroll(old ? old.items.length : 0, f0, g.full), g.full).f : 0;
      rows[r] = row;
      delete held[row.id];
      // P7 27.10.: nur die angeschnittene naechste Reihe sichtbar sofort, verdeckte Reihen in Haeppchen
      if (slotRow[k] === r) { slots[k].setModel(row, colMem[r], r === R + 1 ? 1 : 2); slots[k].setTop(tops[r]); slots[k].setVisible(TILES || r >= R); }
    }
    /* zurueckgehaltene Fassung einer Reihe, die nicht mehr fokussiert ist, einsetzen (Leerlauf, nie im Fokusschritt) */
    /* neue Fassung der FOKUSSIERTEN Reihe einsetzen: dieselbe Karte bleibt fokussiert an derselben Stelle, fehlt sie, dieselbe Spalte
     * (begrenzt); andere Reihen bewegen sich nicht. ring: Fokusring/Hero nachziehen (in Ruhe auf der Startseite; beim Betreten macht das enter) */
    function swapFocused(ring) {
      if (heldT) { clearTimeout(heldT); heldT = 0; }
      if (!rows[R] || !held[rows[R].id]) return;
      var hsl = slotFor(R), nrow = held[rows[R].id], kf = H.keepFocus(rows[R].items, nrow.items, hsl.f, hsl.sc, hsl.g.full);
      if (rows[R].kind !== nrow.kind) nrow.kind = rows[R].kind;
      rows[R] = nrow; delete held[nrow.id];
      N.log('home reihe ' + nrow.id + ' eingesetzt (Fokus, Spalte ' + kf.f + ')');
      if (slotRow[R % SLOTS] !== R) return;
      hsl.setModel(nrow, kf.f, 0, kf.sc);
      if (ring && !away && !dead) { hsl.setFocused(true); placeRing(hsl.ringPos()); heroBack(); }
    }
    /* fokussierte Reihe wartet: nach HELD_MS ohne Taste einsetzen (Schoner zaehlt als Ruhe; Tasten verschieben den Zeitpunkt) */
    function holdLater() {
      if (heldT) clearTimeout(heldT);
      var rest = N.idle && N.idle.restFor ? N.idle.restFor() : HELD_MS;
      heldT = setTimeout(function () {
        heldT = 0;
        if (dead || away || !rows[R] || !held[rows[R].id]) return;
        if (N.idle && N.idle.restFor && N.idle.restFor() < HELD_MS) { holdLater(); return; }
        swapFocused(true);
      }, Math.max(1000, HELD_MS - rest));
    }
    function applyHeld() {
      if (dead || away) return;
      for (var r = 0; r < rows.length; r++) if (r !== R && held[rows[r].id]) putRow(r, held[rows[r].id]);
    }
    function sameAll(a, b) {
      if (!H.sameLayout(a, b)) return false;
      for (var i = 0; i < a.length; i++) if (!H.sameRow(a[i], b[i])) return false;
      return true;
    }
    function merge(list, ids) { for (var i = 0; ids && i < ids.length; i++) if (list.indexOf(ids[i]) < 0) list.push(ids[i]); return list; }
    /* nach jeder Antwort: Reihen einer Aenderung, die waehrend des Ladens kam, jetzt holen; sonst das naechste Nachsehen planen */
    function kick() {
      if (dead) return;
      if (again && !task) { var a = again; again = null; if (away) merge(dirty, a); else refresh(a); return; }
      if (chaseT || !chase.length) return;
      if (chaseN >= FOLLOW.length) { chase = []; chaseN = 0; return; }
      chaseT = setTimeout(function () {
        chaseT = 0;
        if (dead || !chase.length) return;
        var ids = chase.slice();
        N.log('home nachsehen ' + chaseN + '/' + FOLLOW.length + ': ' + ids.join(',') + (away ? ' (verdeckt)' : ''));
        if (away) merge(dirty, ids);                  // beim Zurueckkehren (danach geht das Nachsehen weiter)
        else if (task) again = merge(again || [], ids);
        else refresh(ids);
      }, FOLLOW[chaseN++]);
    }
    function later(ms) {
      if (playT) clearTimeout(playT);
      playT = setTimeout(function () { playT = 0; if (dead) return; if (away) loadedAt = 0; else refresh(); }, ms);
    }
    /* only: nur diese Reihen holen (HOME-12, Bibliothek geaendert) – alle anderen bleiben, wie sie sind */
    function refresh(only) {
      if (task) return;
      var t0 = U.now();
      if (!only) dirty = [];
      task = H.fetch(function (err, res) {
        task = null;
        if (dead) return;
        got(err, res, only, t0);
        kick();
      }, { libs: s.libs, alibs: s.alibs, rows: rows, cfg: cfg(), plTitle: plTitle(), only: only || null });
    }
    function got(err, res, only, t0) {
      if (res) { res.at = t0; res.only = !!only; }
      if (only && err) { merge(dirty, only); return; }                // still; beim naechsten Betreten erneut
      if (away) { parked = { err: err, res: res }; return; }      // anderer Bildschirm oben: erst beim Zurueckkehren anwenden
      // P7 27.10.: Antwort mitten in einer Tastenfolge (erste Schritte nach dem Start) erst in der naechsten Ruhe anwenden
      if (rows.length && !err) N.idle.add(function () { if (!dead && !away) handle(err, res); else if (!dead) parked = { err: err, res: res }; }, 'home-net');
      else handle(err, res);
    }
    function handle(err, res) {
      if (err) { onLoadError(err); return; }
      if (played) {                                   // Rueckkehr aus dem Player (TV-Test 28.10.): Titel nie voreilig entfernen
        if (played.n < PLAY_RETRY.length && H.stale(res.rows, played.rk, order())) { later(PLAY_RETRY[played.n++]); return; }
        played = null;
      }
      retryN = 0;
      if (offline) { offline = false; N.ui.toast.show(N.t('toast.online'), { icon: 'confirm' }); }
      applyNetwork(res, res.only && rows.length > 0);
    }
    function onLoadError(err) {
      var S = N.session, kind = N.errs.kind(err, 'pms'), kids = S.isKid();
      N.diag.log('warn', 'home load error ' + (err.status || err.type));
      if (kind === 'auth') {
        // 401 mit dem Profil-Token: nur dieses Token verwerfen und zur Profilwahl – Konto bleibt angemeldet (M3)
        if (S.profile) S.dropToken(S.profile.uuid);
        if (kids && S.pinSwitchOn()) {                // Kinderprofil: Profilwahl nur ueber die Hauptkonto-PIN
          showState(N.errs.texts('profile', null, kids), [{ id: 'switch', t: N.t('err.btn.chooseProfile') }]);
          return;
        }
        N.router.reset('profiles', { atStart: true });
        N.ui.toast.show(N.t('toast.chooseProfileAgain'));
        return;
      }
      if (rows.length) {                              // Inhalte bleiben bedienbar; still weiter versuchen
        if (!offline) { offline = true; N.ui.toast.show(N.t('toast.offline')); }
        if (retryT) clearTimeout(retryT);
        retryT = setTimeout(function () { retryT = 0; refresh(); }, 10000);
        return;
      }
      if (kind !== 'server') {                        // z. B. 404/400: kein "Server nicht erreichbar", kein Countdown
        showState(N.errs.texts('generic', null, kids), [{ id: 'retry', t: N.t('err.btn.retry') }]);
        return;
      }
      retryN = 10;
      countdown();
    }
    function countdown() {
      // ohne Servernamen (Fallback-Adresse) die IP zeigen statt leerer Anfuehrungszeichen
      var srv = N.session.state.server && N.session.state.server.name || (N.plex.base || '').replace(/^https?:\/\//, '').split(':')[0] || '?';
      var tx = N.errs.texts('server', { server: srv, n: retryN }, N.session.isKid());
      if (!sb.on) showState(tx, [{ id: 'retry', t: N.t('err.btn.retry') }]); else sb.setText(tx.text);
      if (retryT) clearTimeout(retryT);
      retryT = setTimeout(function () {
        retryT = 0;
        if (--retryN <= 0) { refresh(); return; }
        countdown();
      }, 1000);
    }
    function showState(tx, buttons) {
      showSkel(false); ring.hide(); hero.clear();
      for (var k = 0; k < SLOTS; k++) slots[k].setVisible(false);
      sb.show({ title: tx.title, text: tx.text, buttons: buttons, onSelect: function (id) {
        if (id === 'retry') { if (retryT) clearTimeout(retryT); retryT = 0; sb.hide(); if (!rows.length) showSkel(true); refresh(); }
        else if (id === 'switch') N.app.switchProfile();
      } });
      markMore();                                     // fester Hinweis unten aus
    }
    function showEmpty() {
      var kids = N.session.isKid(), p = kids ? 'empty.home.kids' : 'empty.home';
      if (!order().length) p = 'empty.homeOff';      // alle Reihen in "Startseite anpassen" ausgeschaltet
      showState({ title: N.t(p + '.title'), text: N.t(p + '.text') }, []);
    }

    /* ---------- Lebenszyklus ---------- */
    s.enter = function (params, restore) {
      var redraw = false;
      if (amb) amb.enter();                           // Einstellung pruefen (Aenderung in den Einstellungen gilt ab hier)
      // TV-Test 28.10.: Start -> Seitenleiste -> anderer Bildschirm -> zurueck zur Startseite liess railOpen (aus railBlur) stehen,
      // der Fokusring blieb unsichtbar. Beim Betreten ist die Seitenleiste zu (activate schliesst sie vor dem Wechsel).
      railOpen = !!(N.ui.rail && N.ui.rail.isOpen && N.ui.rail.isOpen());
      if (pending) { rows = pending; pending = null; held = {}; redraw = true; }
      else if (rows.length) for (var hr = 0; hr < rows.length; hr++) if (held[rows[hr].id]) {   // neu betreten: zurueckgehaltene Reihen einsetzen
        if (hr !== R) { putRow(hr, held[rows[hr].id]); continue; }
        swapFocused(false);
      }
      if (sizeChanged() && drawn) redraw = true;      // HOME-15: Kachelgroesse in den Einstellungen geaendert
      if (cfgDirty && drawn) {                        // Reihen-Auswahl geaendert: sofort umordnen, dann frisch laden
        cfgDirty = false; rows = H.pick(rows, order()); R = 0; colMem = {}; interacted = false; loadedAt = 0; redraw = true; parked = null;
        if (task) { task.abort(); task = null; }
      }
      if (!drawn) {                                   // erstes Betreten dieser Instanz (oder Neuaufbau aus restore)
        drawn = true;
        if (restore) { R = restore.R || 0; colMem = restore.colMem || {}; }
        if (!rows.length) {
          var c = N.session.homeCache();
          if (c && c.v === 1 && c.rows) { s.libs = c.libs; s.alibs = c.alibs; rows = H.pick(c.rows, order()); libsChanged(c.alibs || c.libs || []); loadedAt = 0; }
          else libsChanged([]);
          cfgDirty = false;
        }
        redraw = rows.length > 0;
      }
      if (redraw) renderAll();
      else if (rows.length && !sb.on) {
        var sl = slotFor(R);
        // Marken von Erweiterungs-Karten koennen sich geaendert haben (Anfrage auf der Detailseite: auch dieselbe Karte in anderen Reihen)
        for (var ek = 0; ek < SLOTS; ek++) if (slotRow[ek] >= 0 && slots[ek].model && slots[ek].model.ext) slots[ek].refreshAll();
        sl.setFocused(true); placeRing(sl.ringPos()); heroBack();
      }
      if (!rows.length && !sb.on) { ring.hide(); showSkel(true); }
      away = false;
      if (parked) { var pk = parked; parked = null; handle(pk.err, pk.res); }
      else if (resume) { resume = false; refresh(); }
      if (played && played.wait) { played.wait = false; later(PLAY_SETTLE); }   // nach dem Player: PMS erst kurz nachziehen lassen
      else if (!loadedAt || U.now() - loadedAt > TTL) { if (!playT) refresh(); }
      else if (dirty.length && !playT) { var dl = dirty; dirty = []; refresh(dl); }   // HOME-12: nur die Reihen der geaenderten Bibliothek
      N.session.refreshUsersLater();
    };
    s.leave = function () {
      away = true;                                    // Wiederholungen/Toasts/Neuzeichnen ruhen, solange etwas anderes oben ist (L2)
      if (retryT) { clearTimeout(retryT); retryT = 0; resume = true; }
      if (heroT) { clearTimeout(heroT); heroT = 0; }
      if (catchT) { clearTimeout(catchT); catchT = 0; }
      if (playT) { clearTimeout(playT); playT = 0; loadedAt = 0; }   // Nachladen nach dem Player: beim Zurueckkehren
      if (stripTask) { stripTask.abort(); stripTask = null; }
      stopAll(); pan = null;                          // laufender Schwung endet, wo er ist
      colMem[R] = rows.length && slotRow[R % SLOTS] === R ? slotFor(R).f : colMem[R] || 0;
      return { R: R, colMem: U.extend({}, colMem) };
    };
    s.destroy = function () {
      dead = true;
      if (catchT) { clearTimeout(catchT); catchT = 0; }
      if (amb) amb.destroy();
      if (playT) { clearTimeout(playT); playT = 0; }
      if (chaseT) { clearTimeout(chaseT); chaseT = 0; }
      if (heldT) { clearTimeout(heldT); heldT = 0; }
      if (onFlush) N.evt.off('app:flush', onFlush);
      if (onSet) N.evt.off('settings:changed', onSet);
      if (onAnime) N.evt.off('anime:changed', onAnime);
      if (onBack) { N.evt.off('overlay:closed', onBack); N.evt.off('app:refocus', onBack); }
      if (onPlayed) N.evt.off('playback:stopped', onPlayed);
      if (onScanned) N.evt.off('library:scanned', onScanned);
      if (onChanged) N.evt.off('library:changed', onChanged);
      if (onMode) N.evt.off('input:mode', onMode);
      if (onEpg) { N.evt.off('live:epg', onEpg); N.evt.off('live:avail', onEpg); }
      if (watchFn) N.libwatch.unwant(watchFn);
      if (task) task.abort(); task = null;
      if (retryT) clearTimeout(retryT);
      if (hideCommit) hideCommit.run();
      for (var k = 0; k < SLOTS; k++) slots[k].clear();
    };
    s.railBlur = function () { railOpen = true; ring.hide(); if (rows.length) slotFor(R).setFocused(false); };
    s.railFocus = function () { railOpen = false; if (TILES && caps.homeHero === true && !HT && heroWanted(A, true)) { poke(); catchUp(); } if (sb.on) return; if (rows.length) { var sl = slotFor(R); sl.setFocused(true); placeRing(sl.ringPos()); } };

    s.onKey = function (k) {
      interacted = true; used = true; lastIn = U.now();
      if (sb.on) {
        if (sb.onKey(k)) return true;
        if (k === 'LEFT') { N.ui.rail.open(); return true; }
        if (k === 'BLUE') { N.router.push(N.disc.blueView()); return true; }
        if (k === 'RETURN') { N.ui.dialog.exitApp(); return true; }
        return true;
      }
      if (!rows.length) { if (k === 'LEFT') N.ui.rail.open(); else if (k === 'RETURN') N.ui.dialog.exitApp(); return true; }
      if (loose) { reanchor(); if (N.keys.isNav(k)) return true; }   // erste Taste nach Wischen/Rad: Fokus auf die Karte am Anker (wie TV)
      var sl = slotFor(R), f = sl.f, it = sl.item(f);
      switch (k) {
        case 'LEFT': if (f > 0) moveCol(f - 1); else N.ui.rail.open(); return true;
        case 'RIGHT': if (f < sl.count() - 1) moveCol(f + 1); return true;
        case 'UP': if (R > 0) moveRow(R - 1); return true;
        case 'DOWN': if (R < rows.length - 1) moveRow(R + 1); return true;
        case 'ENTER': openItem(it, false); return true;
        case 'PLAY': openItem(it, true); return true;
        case 'RED': hideCard(); return true;
        case 'YELLOW': toggleWatched(); return true;
        case 'BLUE': N.router.push(N.disc.blueView()); return true;
        case 'INFO': if (it && it.live) liveMenu(it); else if (it && (it.ext || it.all)) openItem(it, false); else N.details.open(it); return true;
        case 'TOOLS': menu(); return true;
        case 'FF': moveCol(Math.min(sl.count() - 1, f + 5)); return true;
        case 'RW': moveCol(Math.max(0, f - 5)); return true;
        case 'RETURN':
          if (R > 0 || f > 0) toTop(); else N.ui.dialog.exitApp();     // RETURN-Kette (NAV-5): erste Karte, dann Beenden-Dialog (ohne Seitenleiste)
          return true;
      }
      return true;
    };

    /* ---------- Zeiger (Index-Mathe) ---------- */
    /* Naechste Reihe per Zeiger (NAV-2, HOME-11): Zone ab ihrem Kopf bzw. – wenn hohe Poster ihn aus dem Bild schieben – ab der
     * Unterkante der Fokus-Karten bis zum Bildrand (Hinweisleiste ausgenommen). Verweilen (HOLD, Einstellung "Zeiger blaettert am
     * Rand weiter") oder Klick = eine Reihe tiefer; danach Zeiger-Sperre (Seite ist unter dem Punkt gewandert). Vorbeiziehen
     * loest nichts aus. */
    function inNext(x, y) {
      if (R + 1 >= rows.length || x < 128) return false;
      if (y < nextZone().y || y >= A.h) return false;
      return !(N.ui.hints && N.ui.hints.hit && N.ui.hints.hit(x, y));
    }
    function goNext(x) {
      var r = R + 1, nx = slotFor(r);
      if (r >= rows.length) return;
      var j = nx.model === rows[r] ? nx.hit(x) : -1;
      N.fx.step(true);
      moveRow(r, j >= 0 ? j : undefined);
      if (N.pointer) N.pointer.scrolled();
    }
    s.pointer = function (x, y, kind) {
      lastIn = U.now();
      if (eat) { if (kind === 'click') eat = false; return true; }   // Beruehrung hat den Schwung angehalten: kein Oeffnen, kein Fokus
      if (sb.on) return sb.pointer(x, y, kind);
      if (!rows.length) return false;
      if (TILES) return tilesPointer(x, y, kind);
      var sl = slotFor(R);
      if (kind === 'click') used = true;
      if (sl.free && y >= CARD_Y && y < CARD_Y + sl.g.h) {      // Reihe frei verschoben (Hero + freies Scrollen): Treffer per px
        var j = sl.hitAny(x);
        if (j < 0) return false;
        if (j !== sl.f) { placeRing(sl.hoverCol(j)); afterMove(); }
        if (kind === 'click') tap(sl.item(j));
        return true;
      }
      if (y >= CARD_Y && y < CARD_Y + sl.g.h) {
        N.pointer.holdCancel();
        var i = sl.hit(x);
        if (i < 0) return false;
        if (i !== sl.f) { placeRing(sl.hoverCol(i)); afterMove(); }
        if (kind === 'click') tap(sl.item(i));
        return true;
      }
      if (!inNext(x, y)) { N.pointer.holdCancel(); return false; }
      if (kind === 'click') { N.pointer.holdCancel(); goNext(x); return true; }
      var r0 = R;
      N.pointer.hold(function () { if (!dead && !away && R === r0 && inNext(N.pointer.x, N.pointer.y)) goNext(N.pointer.x); });
      return true;
    };
    s.pointerSig = function () { return TILES ? 0 : pageY(); };   // Zeiger-Scroll-Sperre (N.pointer): Reihenwechsel rollt die Seite (Kacheln: Zeiger rollt nie)
    s.pointerArrows = function () {
      if (!rows.length || sb.on || railOpen || FREE) return null;   // freies Scrollen: Rad/Trackpad statt Blaetter-Pfeilen
      var sl = slotFor(R);
      return { y: CARD_Y, h: sl.g.h, left: sl.canPage(-1), right: sl.canPage(1) };
    };
    s.pointerPage = function (dir) {
      var sl = slotFor(R);
      if (!sl.canPage(dir)) return;
      placeRing(sl.page(dir)); afterMove();
      if (N.pointer) N.pointer.syncArrows();
    };
    /* ---------- Tippen, freies Scrollen (Apple: caps.cardTap, caps.home 'tiles', caps.scroll 'free'; 08-touch S4–S6) ---------- */
    /* Tipper/Klick auf eine Kachel: bei cardTap 'details' oeffnen Film/Serie/Folge die Details (Detailkarte, Nr. 9/12) statt
     * abzuspielen, eine Weiterhoeren-Karte die Karte ihres Buchs; "Alle anzeigen", Erweiterungs-Karten, Musik und Playlists wie OK.
     * Tasten (auch am Apple-Geraet) und der TV bleiben bei openItem: OK auf Weiterhoeren setzt sofort fort. */
    function tap(it) {
      if (!it) return;
      if (N.details.tap && N.details.tap(it)) return;   // Detailkarte (caps.details 'card'): auch Album/Kuenstler, nur Finger/Maus (DET-10)
      if (TAP_DETAILS && !it.all && !it.ext && M.isVideo(it)) { N.details.open(it); return; }
      var book = TAP_DETAILS ? N.music.listenAlbum(it) : null;   // Weiterhoeren: Karte des Buchs ("Fortsetzen" zuerst) statt sofort abzuspielen (DET-10)
      if (book) { N.details.open(book); return; }
      openItem(it, false);
    }
    /* Kacheln: Treffer in jeder sichtbaren Reihe (Seitenlage py, Reihenlage px), auch angeschnittene Karten und ihre Beschriftung.
     * Zeiger/Finger setzt nur den (unsichtbaren) Fokus, die Seite rollt nie unter dem Punkt */
    function tilesPointer(x, y, kind) {
      if (kind === 'click') used = true;
      if (HT && y < VIS_T) { hov = false; return false; }   // ueber dem Infobereich/Verlauf: Reihen darunter sind nicht zu sehen
      var r = rowAtPage(y + py);
      if (r < 0 || slotRow[r % SLOTS] !== r) { hov = false; return false; }
      var sl = slotFor(r), cy = tops[r] + HEAD_H - py, band = sl.showCaptions() ? sl.g.capY + 48 : sl.g.h;
      if (y < cy || y >= cy + band) { hov = false; return false; }
      var i = sl.hitAny(x);
      if (i < 0) { hov = false; return false; }
      hov = true;
      if (r !== R || i !== sl.f) focusAt(r, i);
      if (kind === 'click') tap(sl.item(i));
      return true;
    }
    /* Fokus auf Reihe r, Karte i, ohne dass Seite oder Reihe sich bewegen */
    function focusAt(r, i) {
      if (r !== R) {
        if (slotRow[R % SLOTS] === R) { colMem[R] = slotFor(R).f; slotFor(R).setFocused(false); }
        R = r;
        slotFor(R).setFocused(true);
      }
      placeRing(slotFor(R).hoverCol(i));
      afterMove();
    }
    function stopRow(k) { return rowDrv[k] ? rowDrv[k].stop() : false; }
    function stopAll() {
      var m = false;
      for (var k = 0; k < rowDrv.length; k++) if (stopRow(k)) m = true;
      if (pageDrv && pageDrv.stop()) m = true;
      return m;
    }
    function drvRow(k) {
      if (!rowDrv[k]) {
        var sl = slots[k];
        rowDrv[k] = new N.kinetic.Drive({ dim: A.w, get: function () { return sl.curPx(); }, max: function () { return sl.maxPx(); },
          set: function (p) { if (N.idle) N.idle.touch(); sl.setPx(p); ptrScrolled(slotRow[k]); },
          end: function () { if (amb) ambKick(); } });   // Nr. 27: Titel fuer den Hintergrund, wenn die Reihe ruht
      }
      return rowDrv[k];
    }
    function maxPy() {
      var n = rows.length;
      return n ? Math.max(0, tops[n - 1] + pitchOf(n - 1) - (A.h - 72)) : 0;   // letzte Reihe endet ueber der Hinweisleiste
    }
    function setPy(p) {
      // Uebergang immer aus – auch wenn ein waagerechter Rad-/Zug-Schritt schon loose gesetzt hat (sonst glitt die Seite 150 ms nach)
      loose = true; if (pg.style.webkitTransition !== 'none') pg.style.webkitTransition = 'none';
      py = p; lastIn = U.now();
      if (N.idle) N.idle.touch();
      U.tf(pg, 0, -Math.round(p * 100) / 100);
      syncWin(false);
      ptrScrolled();
    }
    function drvPage() {
      if (!pageDrv) pageDrv = new N.kinetic.Drive({ dim: A.h, get: function () { return py; }, max: maxPy, set: setPy, end: function () { if (amb) ambKick(); } });
      return pageDrv;
    }
    /* Reihe unter dem Punkt (Bildschirm-y) fuer waagerechtes Ziehen/Rad: ganze Reihenhoehe (Kopf, Karten, Beschriftung) */
    function rowUnder(y) {
      var r = TILES ? rowAtPage(y + py) : (y >= CARD_Y - HEAD_H && y < CARD_Y + slotFor(R).g.h + 40 ? R : -1);
      return r >= 0 && slotRow[r % SLOTS] === r ? r : -1;
    }
    /* Wischen (App.pan): waagerecht = Reihe unter dem Finger, senkrecht = Seite (nur Kacheln). Frei, mit Schwung, ohne Einrasten
     * (Nr. 18), Gummiband an den Enden (Reihenanfang: nur Gummiband, nie die Seitenleiste – Nr. 22). Ein Transform je Container
     * und Frame, keine Layout-Abfragen. Ohne Kacheln senkrecht: false (Rueckfall des Laders auf Fokus-Schritte). */
    s.pan = function (e) {
      if (e.phase === 'start') {
        if (!FREE || !N.kinetic || !rows.length || sb.on) return false;
        stopAll(); eat = false; pan = null; used = true; lastIn = U.now();
        if (e.axis === 'x') {
          var r = rowUnder(e.y);
          if (r < 0) return true;                       // ausserhalb einer Reihe: Zug annehmen, nichts tun
          var k = r % SLOTS;
          if (slots[k].pend) slots[k].render(1, 1);
          loose = true;
          pan = { d: drvRow(k), x: true, last: 0 };
        } else {
          if (!TILES) return false;
          pan = { d: drvPage(), x: false, last: 0 };
        }
        pan.d.grab(e.t);
        return true;
      }
      if (!pan) return true;
      var v = pan.x ? e.dx : e.dy, d = -(v - pan.last);   // Finger nach links/oben -> Inhalt nach links/oben (Lage waechst)
      pan.last = v; lastIn = U.now();
      if (e.phase === 'move') { pan.d.move(d, e.t); return true; }
      var p = pan; pan = null;                          // end
      p.d.up(e.t, e.cancel);
      return true;
    };
    /* Beruehrung/Druck haelt jeden laufenden Schwung an; der Klick danach oeffnet nichts (iOS-Verhalten) */
    s.pointerDown = function () { lastIn = U.now(); if (FREE && stopAll()) eat = true; };
    /* Rad/Trackpad (Mac, iPad mit Trackpad): Weg direkt in px (das System liefert den Schwung), Achse je Geste fest (150 ms Pause) */
    s.wheel = function (x, y, dx, dy) {
      if (!FREE || !N.kinetic || !rows.length || sb.on) return false;
      var now = U.now();
      used = true; lastIn = now;
      if (now - wheelT > 150 || !wheelAx) wheelAx = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      wheelT = now;
      eat = false;
      if (wheelAx === 'x') {
        var r = rowUnder(y);
        if (r < 0) return true;
        loose = true;
        drvRow(r % SLOTS).nudge(dx);
        return true;
      }
      if (!TILES) return false;
      if (pageDrv) pageDrv.stop();
      drvPage().nudge(dy);
      return true;
    };
    /* An den Anfang (App.scrollTop, Tipp ganz oben / Cmd+Pfeil hoch): Seite gleitet nach oben; Reihen bleiben, wo sie stehen */
    s.scrollTop = function () {
      if (!FREE || !TILES || !N.kinetic || !rows.length || sb.on) return false;
      stopAll(); pan = null;
      return drvPage().to(0);
    };
    /* erste Taste nach freiem Scrollen: Fokus auf die Karte am Anker (Reihe oben, erste ganz sichtbare Karte), Reihen und Seite
     * zurueck ins Tastenraster (ohne Gleiten), Ring wieder an der Fokuskarte */
    function reanchor() {
      stopAll(); loose = false; pan = null;
      var r = TILES ? anchorRow() : R;
      if (slotRow[R % SLOTS] === R && r !== R) { colMem[R] = slotFor(R).f; slotFor(R).setFocused(false); }
      for (var k = 0; k < SLOTS; k++) {
        var rr = slotRow[k], sl0 = slots[k];
        if (rr < 0 || !sl0.free) continue;
        var c = sl0.anchorCol();
        if (rr !== r) { colMem[rr] = c; sl0.fix(c); }
      }
      R = r;
      ensure(R, 0);
      var sl = slotFor(R);
      sl.fix(sl.free ? sl.anchorCol() : sl.f);
      sl.setFocused(true);
      pg.style.webkitTransition = '';
      jumpPage();
      if (TILES) syncWin(true);
      placeRing(sl.ringPos());
      afterMove();
    }
    /* Messlauf (dev/bench.js): gleicher Ausgangspunkt fuer jeden Lauf (TV 28.10.: home/home-hero hingen von der zuletzt fokussierten
     * Reihe ab). top() = Reihe 0, Spalte 0 (wie RETURN); row() = fokussierte Reihe; counts() = Kartenzahl je Reihe */
    s.bench = {
      top: function () { if (rows.length) toTop(); },
      row: function () { return R; },
      counts: function () { var c = []; for (var i = 0; i < rows.length; i++) c.push(rows[i].items.length); return c; },
      /* HOME-15 (home-M/home-S): Kachelgroesse aus den Einstellungen sofort anwenden (Messlauf setzt sie nur im Speicher) */
      size: function () { if (sizeChanged() && rows.length && !sb.on) renderAll(); return size; },
      /* Runde 6, Gegenprobe hvar-cue0: Hinweis unten wie bis 1.0.5 per display (Klasse hcue0 am body nimmt ihm die Ebene) */
      cueDisplay: function (on) {
        cueDisp = !!on;
        U.cls(document.body, 'hcue0', cueDisp);
        if (cueDisp) { U.vis(cue, true); U.show(cue, cueOn); } else { U.show(cue, true); U.vis(cue, cueOn); }
      }
    };
    s.relabel = function () { for (var k = 0; k < SLOTS; k++) if (slotRow[k] >= 0) slots[k].relabel(); };
    return s;
  });
})(N);
