/* Ansicht 'library' – Bibliothek als Posterraster (SPEC 7.5, 9, 10.5, 15; Mockup library.html; plex-parity 3.1 Nr. 6).
 * - Titel, Statuszeile ("37 von 248 Titeln · Titel A–Z · Nur ungesehene"), Chip-Zeile y 120: Reiter Bibliothek | Sammlungen,
 *   "Sortieren & Filter" (= Rot), "Alle abspielen", "Zufall" (Play-Queue ueber den PMS).
 * - Raster: N.ui.Grid (Pool 25, Fokus-Anker y 176), Paging je 50 mit Platzhaltern, naechste Seiten 2 Zeilen vor dem Ende.
 * - Buchstaben-Register (nur Titelsortierung): 5 Positionen, ▶ aus der letzten Spalte, ▲▼ waehlt, OK springt; Ziffern = T9-Sprung.
 * - Sortierung, Filter und Reiter je Bibliothek + Profil gemerkt (N.lib). Person-Filter (aus der Besetzung) gilt nur fuer diesen Aufruf.
 * params: {lib:{id,title,type,kind}, coll:{rk,title} (Sammlung oeffnen), actor:{id,t} (Filter "mit <Person>"), view:'L'|'M'|'S'|'list' (nicht gemerkt),
 *   xtab: Reiter einer Erweiterung gleich oeffnen (Kennung; '*' = erster mit Quelle – Messlauf lib-xtab),
 *   once:{sort} (HOME-14 "Alle anzeigen" aus "Neu in …": Sortierung nur fuer diesen Besuch, ohne Filter; nichts in diesem Besuch wird
 *     gemerkt – die gemerkte Sortierung der Bibliothek bleibt, wie sie war),
 *   list:{title, src:'hub'|'cw'|'deck', key, kinds, cw, cwOn} (HOME-14: ganze Liste einer Startseiten-Reihe als Raster, EINE Anfrage
 *     mit hoechstens LIST_MAX Titeln; kein A–Z, nur der Chip "Ansicht" – Gross/Mittel/Klein/Liste nur fuer diesen Besuch),
 *   list:{title, src:'x', id} (HOME-14 "Alle anzeigen" einer Erweiterungs-Reihe: Quelle im Reiter-Protokoll von N.ext 'lib:list',
 *     waechst seitenweise wie ein Reiter mit Quelle; ohne Erweiterung leer),
 *   rail: Markierung der Seitenleiste (Standard: die Bibliothek)} */
(function (N) {
  var U = N.util, M = N.model, G = N.GridMath, L = N.lib, REST = 300;
  var MIXC = new N.LRU(300);                               // LIB-13: Stellen eingemischter Karten (Bibliothek + Filter + Stand + Schluessel)
  var REG_X = 1160, REG_Y = 168, REG_STEP = 17, LETTERS = '#ABCDEFGHIJKLMNOPQRSTUVWXYZ', LIST_MAX = 300;   // LETTERS: je Bildschirm neu (Sprache, N.lib.letters)

  N.router.define('library', function (params) {
    LETTERS = N.lib.letters();                           // Norwegisch: … Z Æ Ø Å (Sprachwechsel baut den Bildschirm neu)
    REG_STEP = LETTERS.length > 27 ? 15 : 17;             // 30 Zeichen passen nur mit 15 px in die 460 px der Leiste (ueber der Hinweisleiste)
    var lib = params.lib || { id: 0, title: '', type: 'movie' }, coll = params.coll || null, list = params.list || null, once = params.once || null;
    // Seitenleiste markiert die Bibliothek auch in Sammlung/Personenfilter (TV-Befund 26.10.); sub: RETURN geht dort zurueck
    // flexible Flaeche (N.screen, nur Apple): Raster mit mehr Spalten/Zeilen, A–Z-Leiste am rechten Rand (TV: 1280x720, REG_X 1160)
    // Breitenklasse M/K (10-screens 6.3): A–Z-Leiste an den rechten Rand (56 statt 120 Abstand), Raster bis davor (A.r)
    var A = N.screen.view(), slimR = N.screen.flex && N.screen.cls.w !== 'R', regX = REG_X + A.w - 1280 + (slimR ? 56 : 0);
    if (slimR) A = { x: A.x, y: A.y, w: A.w, h: A.h, r: 88 };
    if (N.screen.flex && N.screen.foldX()) A = { x: A.x, y: A.y, w: A.w, h: A.h, r: A.r, fold: N.screen.foldX() };   // Duo: Luecke auf dem Falz
    var sub = !!(coll || params.actor || list || once), s = { rail: params.rail || (lib.id ? N.railRows.libId(lib) : null), wheelKeys: ['UP', 'DOWN'], miniX: regX - 16 - 360, news: 'top', flex: true };   // news: HOME-13 Hinweis oben rechts neben dem Titel   // Mini-Player links neben A–Z (F26)
    // Weitere Server (N.srv): Bibliothek eines fremden Servers -> alle Anfragen dorthin, Ansicht-Merken mit eigenem Schluessel
    var srv = lib.srv || '', libKey = srv ? N.srv.skey(srv, lib.id) : lib.id;
    function get(path, q, o, cb) { return N.plex.get(path, q, N.srv.o(srv, o), cb); }
    // caps.images 'fast' (Apple Nr. 13): 3 Zeilen mehr Vorrat ueber/unter dem Fenster und beim Seiten-Vorladen; caps.scroll 'free' (S7):
    // Raster folgt senkrecht frei dem Finger/Trackpad (N.kinetic.Drive, kein Einrasten), erste Taste danach: Fokus am Anker
    var caps = N.platform.caps, AHEAD = caps.images === 'fast' ? 3 : 0, FREE = caps.scroll === 'free';
    // A–Z-Leiste mit Finger/Maus (LIB-12): Ziehen ueber die Leiste mit Anzeige, Sprung beim Loslassen; Zeiger darueber hebt hervor (hell, fett).
    // Nur flexible Flaeche mit Touch oder Maus (Apple) – am TV nie (Fernbedienungs-Zeiger: Klick wie bisher)
    var AZD = N.screen.flex && (!!caps.touch || caps.pointer === 'mouse');
    var drv = null, pan = null, loose = false, eat = false;
    var G = A.w === 1280 && A.h === 720 && !AHEAD ? N.GridMath : N.GridMath.make('L', false, A, AHEAD), root, titleT, statT, chipBar, chipIn, chips = [], chipRects = null, grid, ring, sb, amb, regDivs = [], regCur = -1, regFoc = false, regHas = '', regAi = [], regMap = [], regH = 0, regHov = -1, scrub = null, azs = null, azsT = null, bubble, bubbleT, skel, fade;
    var prefs = null, items = [], n = -1, total = -1, chars = [], pages = {}, gen = 0, tasks = [], collN = -1;
    // M4 Musik/Hoerbuecher: Reiter 'lib' = Kuenstler (Musik) bzw. Buecher (Hoerbuecher), 'alt' = Alben bzw. Autoren; quadratische Karten
    var music = lib.type === 'artist', book = music && N.music.bookLib(lib);
    // Erweiterung (N.ext 'lib:tabs'/'lib:items'/'lib:status'): eigener Reiter mit fertiger Titelliste (z. B. eine Merkliste der Erweiterung), nie gemerkt.
    // Reiter mit Quelle (tab.src): Liste waechst seitenweise (src.load im Leerlauf, wenn der Fokus 2 Zeilen vor dem Ende ist), eigenes
    // Sortieren & Filter (src.tabs/pick) + Ansicht, Hinweis unter der letzten Zeile (src.end), Statuszeile (src.status), Optionen (src.menu/act)
    var xtab = '', xsrc = null, listItems = null;   // listItems: geladene HOME-14-Liste (Ansicht wechseln laedt nicht neu)
    var loadSig = '', restoreRk = null, keyed = false;
    /* LIB-13 eingemischte Karten einer Erweiterung (N.ext 'lib:mix'): mx = Antwort der Erweiterung fuer diesen Ladevorgang, mm = Abbildung
     * Server-Index <-> Raster-Index (N.lib.mixPlan, mp = Plan bis die Stellen am Anfang da sind, held = so lange zurueckgehaltene Seiten), chars0 = Buchstaben des Servers, sN = Titel beim Server, p0 = Seite 0 mit fertigen Stellen
     * bzw. (leere Bibliothek) wartend, mixQuiet = seit dem Zeichnen keine Taste/kein Zeiger (spaete Karten duerfen noch dazu, hoechstens
     * MIX_WAIT ms), mixDirty = Menge hat sich geaendert (neu laden beim naechsten Betreten, nie darin – LIB-10) */
    var mx = null, mm = null, mp = null, held = {}, chars0Ok = false, mixWait = false, mixT = 0, p0 = null, chars0 = [], sN = -1, mixDirty = false, mixQuiet = false, MIX_WAIT = 1500;   // LIB-10: Stand der Bibliothek beim Laden (N.libwatch), fokussierter Titel beim Neuladen
    var restoreF = 0, zone = 'grid', cf = 0, regCh = '', regT = 0, t9 = { d: '', c: 0, t: 0 }, bubbleTm = 0, dead = false, away = false, railOpen = false, onScanned = null;

    /* ---------- Aufbau ---------- */
    s.create = function (el) {
      root = el;
      // Hintergrund in Bibliotheken (N.ui.Ambient): Ebenen erst bei Bedarf, ganz unten; "Aus" = keine Elemente
      amb = new N.ui.Ambient(root, { lib: lib.id, coll: !!(coll || list), type: function () { return L.typeNum(qlib()); }, items: function () { return items.slice(0, G.PAGE); }, get: get });
      titleT = U.txt('div', 'a t-h1 ell', root, coll ? coll.title : list ? list.title : lib.title, 'left:144px;top:40px;width:' + Math.min(900, A.w - 168) + 'px');
      if (srv) U.txt('div', 'a t-label cacc ell', root, N.t('srv.libFrom', { server: lib.srvName || N.srv.name(srv) }), 'left:144px;top:16px;width:' + Math.min(900, A.w - 168) + 'px');   // Herkunft
      statT = U.txt('div', 'a t-small c2 ell', root, N.t('common.loading'), 'left:144px;top:84px;width:' + Math.min(1000, A.w - 168) + 'px');
      chipBar = U.el('div', 'lchips', root, A.w < 1240 ? 'width:' + (A.w - 168) + 'px' : undefined);   // schmale Flaeche: bis zum rechten Rand
      /* flexibel (nur Apple): Chips in einem Streifen, der waagerecht wischbar ist, wenn sie nicht in die Breite passen (iPhone SE hoch);
       * der Fokus per Taste holt seinen Chip ins Bild. Am TV liegen die Chips direkt in der Zeile (chipIn = chipBar). */
      chipIn = chipBar;
      if (N.screen.flex) { chipBar.style.overflow = 'hidden'; chipIn = U.el('div', 'lchips-in', chipBar); }
      grid = new N.ui.Grid(root);
      if (G !== N.GridMath) grid.setGeom(G);
      // freie Lage: Seiten fuer das neue Fenster holen (Anfrage, kein DOM); A–Z-Leiste zeigt den Buchstaben der obersten Zeile (LIB-11,
      // nur beim Zeilenwechsel, nur bei anderem Buchstaben zwei Klassen)
      if (FREE) grid.onScroll = function () { ensurePages(); if (zone === 'grid' && regOn()) paintReg(false); };
      skel = U.el('div', 'skel', root);
      for (var i = 0; i < 5; i++) U.el('i', '', skel, 'left:' + (G.X0 + i * G.SX) + 'px;top:' + G.Y0 + 'px;width:176px;height:264px');
      fade = U.el('img', 'fade fade-frame', root); fade.src = N.assetBase + 'fade-frame.png';   // unter A–Z-Leiste/Sprungbuchstabe: Band ab y 612, Leiste bis 628
      /* A–Z-Leiste: vollstaendiges Alphabet sofort sichtbar (NUTZER-FEEDBACK-REGELN 1), 27 feste Elemente. Flache flexible Flaeche
       * (LIB-12): reicht die Hoehe bis 16 px ueber der Unterkante nicht, verdichtet (jeder zweite Platz "•", L.azSlots) statt
       * abgeschnitten; regDivs = Plaetze, regAi = Buchstaben-Index je Platz (-1 = "•"), regMap = Platz je Buchstabe */
      var slots = N.screen.flex ? L.azSlots(LETTERS, A.h - REG_Y - 16, REG_STEP) : null;
      if (slots && slots.length >= LETTERS.length) slots = null;
      regH = (slots ? slots.length : LETTERS.length) * REG_STEP;
      var reg = U.el('div', 'regcol', root, 'display:none' + (regX !== REG_X ? ';left:' + regX + 'px' : '') + (slots ? ';height:' + regH + 'px' : ''));
      for (i = 0; i < (slots ? slots.length : LETTERS.length); i++) {
        var re = U.el('div', slots && slots[i].i < 0 ? 'reg dot' : 'reg', reg, 'top:' + (i * REG_STEP) + 'px' + (REG_STEP !== 17 ? ';height:' + REG_STEP + 'px;line-height:' + REG_STEP + 'px' : ''));
        re.appendChild(document.createTextNode(slots ? slots[i].t : LETTERS.charAt(i))); regDivs.push(re); regAi.push(slots ? slots[i].i : i);
      }
      for (i = 0; i < LETTERS.length; i++) regMap.push(slots ? Math.round(i * (slots.length - 1) / (LETTERS.length - 1)) : i);
      regDivs.box = reg;
      if (AZD) { azs = U.el('div', 'azs cacc', root, 'display:none'); azsT = document.createTextNode(''); azs.appendChild(azsT); }   // Anzeige beim Ziehen
      bubble = U.el('div', 'jump', root, 'display:none' + (A.w !== 1280 ? ';left:' + Math.round(G.X0 + G.width() / 2 - 80) + 'px' : ''));
      bubbleT = document.createTextNode(''); bubble.appendChild(bubbleT);
      ring = new N.ui.Ring(root);
      sb = new N.ui.StateBlock(root);
      onScanned = function (d) { if (!dead && !srv && (!d || !d.lib || String(d.lib) === String(lib.id))) { if (away) pages = null; else reload(); } };
      N.evt.on('library:scanned', onScanned);
    };
    function mode() { return coll ? 'coll-items' : list ? (xsrc ? 'x' : 'list') : xtab ? 'x' : prefs.tab === 'coll' ? 'colls' : 'lib'; }
    /* HOME-14-Listen (auch die einer Erweiterung ohne eigenes Sortieren & Filter): nur "Ansicht", nichts wird gemerkt */
    function viewOnly() { return !!list && !xPanel(); }
    /* gemerkt wird nur in der normalen Bibliothek (nicht Sammlung, Person, "Alle anzeigen") */
    function keep() { return !coll && !params.actor && !list && !once; }
    /* Startwerte: gemerkt; "Alle anzeigen" aus "Neu in …" (once): Sortierung nur fuer diesen Besuch, ohne Filter, Reiter der Titel
     * (Musik: Alben, Hoerbuecher: Buecher – das, was die Reihe zeigt) */
    function startPrefs() {
      var p = coll || list ? L.defaults() : L.load(libKey);
      if (!once) return p;
      return N.lib.oncePrefs(p, once.sort, music, book);
    }
    /* Reiter einer Erweiterung: [{id, t (fertiger Text)}]; repaint(), sobald sich ihre Liste aendert */
    function xtabs() { return !coll && !params.actor && !list && !srv && N.ext.has('lib:tabs') ? N.ext.call('lib:tabs', lib, xRepaint) || [] : []; }
    function xRepaint() {
      if (dead || away) return;
      var has = false, l = xtabs();
      for (var i = 0; i < l.length; i++) if (l[i].id === xtab) has = true;
      if (xtab && !has) { xtab = ''; xsrc = null; reload(); return; }
      if (xsrc) { if (xsrc.restamp && n > 0) { xsrc.restamp(); grid.refresh(Math.max(0, grid.f - 10), Math.min(n - 1, grid.f + 15)); } buildChips(); paintStatus(); return; }
      if (xtab) { var f = grid.f, x = N.ext.call('lib:items', lib, xtab) || []; if (x.length !== n || zone !== 'grid') { restoreF = Math.min(f, Math.max(0, x.length - 1)); reload(true); return; } items = x; grid.setModel(items, n, f); placeRing(grid.ringPos()); }
      buildChips();
    }
    /* Bibliothek mit dem Typ der Eintraege (Musik: artist | album je Reiter) fuer N.lib */
    function qlib() {
      if (!music) return lib;
      var t = (prefs.tab === 'alt') === book ? 'artist' : 'album';
      return U.extend(U.extend({}, lib), { type: t });
    }
    function regOn() { return mode() === 'lib' && L.hasRegister(prefs) && chars.length > 0 && n > 0; }

    /* ---------- Chip-Zeile (Reiter, Sortieren & Filter, Alle abspielen, Zufall) ---------- */
    function chipDefs() {
      var d = [], xt = xtabs();
      if (!coll && !params.actor && !list && (collN > 0 || music || xt.length)) {
        d.push({ id: 'tab-lib', t: music ? (book ? 'mu.tab.books' : 'mu.tab.artists') : 'lib.tab.library', act: !xtab && prefs.tab === 'lib' });
        if (music) d.push({ id: 'tab-alt', t: book ? 'mu.tab.authors' : 'mu.tab.albums', act: !xtab && prefs.tab === 'alt' });
        if (collN > 0) d.push({ id: 'tab-coll', t: 'lib.tab.collections', act: !xtab && prefs.tab === 'coll' });
        for (var i = 0; i < xt.length; i++) d.push({ id: 'tab-x-' + xt[i].id, tx: xt[i].t, act: xtab === xt[i].id });
      }
      if (mode() === 'lib' || xPanel()) d.push({ id: 'sort', t: 'lib.chip' });
      else if (viewOnly()) d.push({ id: 'view', t: 'lib.chipView' });
      if (mode() !== 'colls' && mode() !== 'x' && mode() !== 'list' && !book) { d.push({ id: 'all', t: 'lib.playAll' }); d.push({ id: 'shuffle', t: 'lib.shuffle' }); }
      return d;
    }
    function buildChips() {
      while (chipIn.firstChild) chipIn.removeChild(chipIn.firstChild);
      chips = chipDefs(); chipRects = null;
      for (var i = 0; i < chips.length; i++) {
        var c = U.el('span', 'chip' + (chips[i].act ? ' act' : ''), chipIn);
        c.appendChild(document.createTextNode(chips[i].tx || N.t(chips[i].t)));
        chips[i].el = c;
      }
      cf = Math.min(cf, Math.max(0, chips.length - 1));
      if (zone === 'chips' && chips[cf]) U.cls(chips[cf].el, 'is-focus', true);
      setTimeout(measureChips, 50);                    // einmalige Messung fuer den Zeiger (nie im Tastenpfad)
    }
    function measureChips() {
      if (dead) return;
      chipRects = [];
      for (var i = 0; i < chips.length; i++) chipRects.push([144 + chips[i].el.offsetLeft, chips[i].el.offsetWidth]);
      if (chipIn !== chipBar) {                         // flexibel: wie weit der Streifen rollen kann
        var l = chipRects[chipRects.length - 1];
        chipMax = l ? Math.max(0, l[0] + l[1] - 144 - chipBar.offsetWidth) : 0;
        chipTo(chipOff);
      }
    }
    var chipOff = 0, chipMax = 0, chipPan = null;
    function chipTo(v) { chipOff = U.clamp(Math.round(v), 0, chipMax); U.tf(chipIn, -chipOff, 0); U.cls(chipBar, 'lc-r', chipOff < chipMax); U.cls(chipBar, 'lc-l', chipOff > 0); }   // Rand laeuft aus, wo es weitergeht
    /* Chip i ganz ins Bild holen (Tasten-Fokus; nur, wenn der Streifen rollen kann) */
    function chipShow(i) {
      if (!chipMax || !chipRects || !chipRects[i]) return;
      var a = chipRects[i][0] - 144, b = a + chipRects[i][1], w = chipBar.offsetWidth;
      if (a < chipOff) chipTo(a); else if (b > chipOff + w) chipTo(b - w);
    }
    function chipIndex(id) { for (var i = 0; i < chips.length; i++) if (chips[i].id === id) return i; return 0; }

    /* ---------- Status ---------- */
    function paintStatus() {
      if (n < 0) { U.setText(statT, N.t('common.loading')); return; }
      if (mode() === 'colls') { U.setText(statT, N.tn('lib.status.colls', n)); return; }
      if (mode() === 'x') { U.setText(statT, (xsrc ? xsrc.status(n) : N.ext.call('lib:status', lib, xtab, n)) || ''); return; }
      if (coll || list) { U.setText(statT, N.tn('lib.status.items', n)); return; }
      var mn = mm ? mm.n : 0, ms = mn && mx.status ? mx.status(mn) : '';
      U.setText(statT, L.status(n - mn, total, prefs, qlib()) + (ms ? ' · ' + ms : '') + (once ? ' · ' + N.t('lib.status.once') : ''));   // HOME-14: Sortierung nur fuer diesen Besuch
    }

    /* ---------- Daten ---------- */
    function abortAll() { for (var i = 0; i < tasks.length; i++) if (tasks[i]) tasks[i].abort(); tasks = []; }
    function track(t) { tasks.push(t); return t; }
    function pageReq(p) {
      var start = p * G.PAGE;
      if (mode() === 'lib') return L.pageQuery(qlib(), prefs, start, G.PAGE);
      var q = { 'X-Plex-Container-Start': start, 'X-Plex-Container-Size': G.PAGE, excludeElements: N.hubs.EXCL, excludeFields: 'summary,tagline' };
      return { path: coll ? '/library/collections/' + coll.rk + '/children' : '/library/sections/' + lib.id + '/collections', q: q };
    }
    function kinds() { var k = {}; k[lib.id] = lib.kind || lib.type; return k; }
    function loadPage(p) {
      if (!pages || pages[p] || mode() === 'x' || mode() === 'list') return;
      pages[p] = 1;
      var g = gen, r = pageReq(p);
      track(get(r.path, r.q, { timeout: 12000 }, function (err, d) {
        if (g !== gen || dead) return;
        var mc = !err && d && d.MediaContainer;
        if (!mc) { pages[p] = 0; if (n < 0) onError(err); else N.diag.log('warn', 'library page ' + p + ' ' + (err && (err.status || err.type))); return; }
        var list = M.normList(mc.Metadata || [], kinds(), mc.librarySectionID || (mode() === 'lib' ? lib.id : 0), true), start = p * G.PAGE, size = Number(mc.totalSize !== undefined ? mc.totalSize : list.length);
        if (n < 0) {
          sN = size;
          /* LIB-13: Stellen am Anfang schon da (meist gemerkt) -> gleich mit Karten; leere Bibliothek -> kurz warten (sonst "leer" und gleich
           * danach Karten); sonst Seite 0 SOFORT zeichnen (Review 05.11. M4: vorher bis 1,5 s Warten auf die Zaehlungen), Karten nach (mixLate) */
          if (mm || !mixWait) { page0(list, start, size); return; }
          if (!size) { p0 = { list: list, start: start, size: size }; if (!mixT) mixT = setTimeout(function () { mixT = 0; if (g === gen && !dead && mixWait) mixOff(); }, MIX_WAIT); return; }
          page0(list, start, size);
          mixQuiet = true; if (!mixT) mixT = setTimeout(function () { mixT = 0; if (g === gen && !dead && mixWait) mixOff(); }, MIX_WAIT);
          return;
        }
        pageN(p, list, start);
      }));
    }
    /* Server-Index -> Raster-Index (LIB-13; ohne eingemischte Karten gleich) */
    function vi(s0) { return mm ? mm.toV(s0) : s0; }
    function put(list, start) { for (var i = 0; i < list.length; i++) items[vi(start + i)] = list[i]; }
    function page0(list, start, size) {
      put(list, start);
      if (mm) mixCards(0);
      if (restoreRk) for (var j = 0; j < list.length; j++) if (list[j] && list[j].rk === restoreRk) { restoreF = vi(start + j); break; }
      restoreRk = null; n = size + (mm ? mm.n : 0); firstPaint();
    }
    /* weitere Seite p: erst die Karten zaehlen, die diesen Bereich betreffen (wenige kleine Anfragen, sonst keine), dann einsortieren */
    function pageN(p, list, start) {
      if (mixWait && mx) { held[p] = { list: list, start: start }; return; }   // Stellen am Anfang noch offen: Seite wartet (unsichtbar, Platzhalter)
      var g = gen, todo = mm ? mm.need(start, start + G.PAGE - 1) : [];
      if (todo.length) { mixCount(todo, g, function () { if (g === gen && !dead) pageN(p, list, start); }); return; }
      put(list, start);
      var a = vi(start), b = vi(start + list.length - 1), c = mm ? mixCards(p) : null;
      if (c) { a = Math.min(a, c[0]); b = Math.max(b, c[1]); }
      grid.refresh(a, b);
      if (a <= grid.f && grid.f <= b) { N.idle.add(updateHints, 'lib-hints'); amb.focus(cur()); }
    }
    /* ---------- LIB-13: Karten einer Erweiterung in die Titelsortierung mischen ----------
     * Stelle je Karte = Zahl der Server-Titel davor: dieselbe Abfrage wie Seite 0 (Filter) mit titleSort<<=<Schluessel> und Groesse 0
     * (~250 Byte; am PMS 1.43 geprueft: Zaehlung = Lage in sort=titleSort). Je Bibliothek + Filter + Stand der Bibliothek 10 min gemerkt.
     * Bis L.MIX_MAX Karten (Plan N.lib.mixPlan): beim Oeffnen gezaehlt werden nur die Karten der ersten beiden Seiten (Bereich aus dem
     * Buchstaben-Index, der ohnehin geladen wird) und ladende Karten (Blick, ob schon da); jede weitere Seite zaehlt vor dem Einsortieren
     * die Karten ihres Bereichs. Seite 0 wartet nicht: kommen die Stellen spaeter (hoechstens MIX_WAIT ms, vor der ersten Taste), werden
     * die Karten HINTER dem fokussierten Titel in einem Schritt eingesetzt (Fokus und Ring bleiben auf demselben Titel); Karten an/vor
     * dem Fokus fallen fuer diesen Besuch weg (beim naechsten Oeffnen sofort dabei, Stellen gemerkt). */
    function mixOn() { return mode() === 'lib' && !srv && !music && !coll && !params.actor && !list && !once && L.mixable(prefs) && N.ext.has('lib:mix'); }
    function mixStart() {
      mx = null; mm = null; mp = null; mixWait = false; mixQuiet = false; p0 = null; held = {}; mixDirty = false; mixBusy = {}; chars0Ok = false;
      if (mixT) { clearTimeout(mixT); mixT = 0; }
      if (!mixOn()) return;
      var x = N.ext.call('lib:mix', lib, mixRepaint), g = gen;
      if (!x) return;
      if ((!x.items || !x.items.length) && x.later) {                 // Erweiterung laedt ihre Liste noch: Karten ggf. nach (mixLate)
        mx = x; mixWait = true;
        x.later(function (y) {
          if (g !== gen || dead || !mixWait || mx !== x) return;
          if (!y || !y.items || !y.items.length) { mixOff(); return; }
          mx = y; mixPlan(g);
        });
        return;
      }
      if (!x.items || !x.items.length) return;
      mx = x; mixWait = true;
    }
    /* Plan, sobald Karten und Buchstaben-Index da sind; dann die Stellen fuer den Anfang (Seiten 0 und 1) und ladende Karten */
    function mixPlan(g) {
      if (!mx || !mx.items || !mx.items.length || !chars0Ok || mp) return;
      var l = mx.items.slice(0, L.MIX_MAX), keys = [];
      for (var i = 0; i < l.length; i++) keys.push(L.mixKey(l[i].key || l[i].title));
      mp = L.mixPlan(keys, chars0, !!prefs.desc);
      mp.cards = l;
      var first = mp.need(0, 2 * G.PAGE - 1), near = [];
      mp.order().forEach(function (o) { if (l[o.j].near && mx.same && near.length < 12) near.push(o); });
      var todo = first.slice();
      near.forEach(function (o) { if (todo.indexOf(o) < 0) todo.push(o); });
      mixCount(todo, g, function () {
        var left = near.length;
        if (!left) { mixSettle(g); return; }
        near.forEach(function (o) {
          if (o.k < 0) { if (!--left) mixSettle(g); return; }
          /* Karte kurz vor der Ankunft (c.near): steht der Titel schon beim Server (erster Titel ab dieser Stelle, 1 Eintrag)? Dann faellt
           * die Karte weg – nie dieselbe Karte doppelt, auch wenn die Erweiterung es noch nicht weiss */
          var q2 = U.extend({}, L.filterQuery(prefs, qlib()));
          q2.sort = 'titleSort:asc'; q2['X-Plex-Container-Start'] = o.b; q2['X-Plex-Container-Size'] = 1; q2.includeGuids = 1; q2.excludeElements = N.hubs.EXCL;
          track(get('/library/sections/' + lib.id + '/all', q2, { timeout: 8000, retries: 0 }, function (e2, d2) {
            if (g !== gen || dead || !mp) return;
            var md = !e2 && d2 && d2.MediaContainer && d2.MediaContainer.Metadata && d2.MediaContainer.Metadata[0];
            if (md && mx.same(l[o.j], md)) mp.drop(o);
            if (!--left) mixSettle(g);
          }));
        });
      });
    }
    /* Stellen der Karten os zaehlen (gemerkte sofort), dann done(). Fehler: am Anfang faellt die Karte weg; spaeter steht sie am Anfang
     * ihres Bereichs (die Abbildung bleibt stimmig). Zaehlung ausserhalb des Bereichs (Buchstaben anders sortiert): geklemmt, beim
     * naechsten Betreten neu (mixDirty). */
    var mixBusy = {};
    function mixCount(os, g, done) {
      var left = os.length, fq = L.filterQuery(prefs, qlib()), sig = N.libwatch.sig(lib.id) || '', l = mp.cards;
      if (!left) { done(); return; }
      function got(o, t) {
        if (g !== gen || dead || !mp) return;
        if (o.k < 0) {
          if (t >= 0) { if (!mp.set(o, t)) { mixDirty = true; N.diag.log('warn', 'lib mix: Stelle ausserhalb des Buchstabens'); } }
          else if (mixWait) mp.drop(o); else mp.set(o, prefs.desc ? mp.total - o.lo : o.lo);
        }
        if (!--left) done();
      }
      os.forEach(function (o) {
        var key = L.mixKey(l[o.j].key || l[o.j].title), ck = libKey + '|' + JSON.stringify(fq) + '|' + sig + '|' + key.toLowerCase(), hit = MIXC.get(ck);
        if (o.k >= 0) { got(o, o.b); return; }
        if (hit && U.now() - hit.t < 600000) { got(o, hit.v); return; }
        if (mixBusy[ck]) { mixBusy[ck].push(function (t) { got(o, t); }); return; }
        var w = mixBusy[ck] = [function (t) { got(o, t); }], q = U.extend({}, fq);
        q['titleSort<<'] = key; q['X-Plex-Container-Start'] = 0; q['X-Plex-Container-Size'] = 0;
        track(get('/library/sections/' + lib.id + '/all', q, { timeout: 8000, retries: 0 }, function (err, d) {
          if (mixBusy[ck] === w) delete mixBusy[ck];
          var t = !err && d && d.MediaContainer ? Number(d.MediaContainer.totalSize) : NaN;
          if (!isNaN(t)) MIXC.set(ck, { t: U.now(), v: t });
          for (var i = 0; i < w.length; i++) w[i](isNaN(t) ? -1 : t);
        }));
      });
    }
    /* Karten der Server-Seite p ins Raster (Stelle bekannt, im Bereich der Seite; die letzte Seite auch Karten ganz am Ende) -> [a, b] | null */
    function mixCards(p) {
      var a = p * G.PAGE, b = a + G.PAGE - 1, last = Math.max(0, Math.ceil(sN / G.PAGE) - 1), r = null;
      for (var j = 0; j < mm.n; j++) {
        var o = mm.order()[j];
        if (o.k < 0 || o.k < a || (o.k > b && p !== last)) continue;
        var v = o.k + j;
        items[v] = mm.cards[o.j];
        r = r ? [Math.min(r[0], v), Math.max(r[1], v)] : [v, v];
      }
      return r;
    }
    function mixLetters() { var out = []; for (var j = 0; mm && j < mm.n; j++) { var c = mm.cards[mm.order()[j].j]; out.push(L.mixLetter(L.mixKey(c.key || c.title))); }; return out; }
    /* Anfang fertig gezaehlt: wartet Seite 0 noch -> gleich mit Karten; schon gezeichnet -> mixLate; leere Bibliothek wartet in p0 */
    function mixSettle(g) {
      if (g !== gen || dead || !mixWait || !mp) return;
      if (!mp.n) { mixOff(); return; }
      if (p0) { mixDone(); return; }
      if (n >= 0) { mixLate(); return; }
      mixWait = false; mm = mp;                                           // Seite 0 kommt noch: sie nimmt die Abbildung gleich mit
      if (chars0.length) chars = L.mixChars(chars0, mixLetters());
    }
    /* keine Karten fuer diesen Besuch: zurueckgehaltene Seiten ohne Abbildung einsortieren */
    function mixOff() {
      if (mixT) { clearTimeout(mixT); mixT = 0; }
      mixWait = false; mixQuiet = false; mx = null; mm = null; mp = null;
      var z = p0; p0 = null;
      if (z) page0(z.list, z.start, z.size);
      flushHeld();
    }
    function flushHeld() { var h = held; held = {}; for (var p in h) if (h.hasOwnProperty(p)) pageN(Number(p), h[p].list, h[p].start); }
    /* Stellen nach dem ersten Zeichnen (M4): nur ohne Taste seit dem Zeichnen und binnen MIX_WAIT; eingesetzt werden nur Karten hinter dem
     * Fokus (Stelle k > grid.f: der fokussierte Titel behaelt seinen Index, Ring und Fokus springen nicht; die Karten dahinter ruecken
     * einmal auf). Karten an/vor dem Fokus fallen fuer diesen Besuch weg (beim naechsten Oeffnen sofort dabei, Stellen 10 min gemerkt). */
    function mixLate() {
      if (!(mixQuiet && n > 0)) { mixOff(); return; }
      if (mixT) { clearTimeout(mixT); mixT = 0; }
      mixWait = false; mixQuiet = false;
      var f = grid.f, j, k;
      var ol = mp.order().slice();
      for (j = 0; j < ol.length; j++) if (ol[j].k >= 0 && ol[j].k <= f) mp.drop(ol[j]);
      if (!mp.n) { mx = null; mp = null; flushHeld(); return; }
      mm = mp;
      var nw = [];
      for (k in items) if (items.hasOwnProperty(k) && items[k]) nw[mm.toV(Number(k))] = items[k];
      items = nw;
      mixCards(0);
      n = sN + mm.n;
      if (chars0.length) chars = L.mixChars(chars0, mixLetters());
      grid.grow(items, n);
      grid.refresh(f + 1, n - 1);                                         // nur Zellen hinter dem Fokus neu (Fokuszelle bleibt)
      paintStatus(); paintReg(true);
      if (zone === 'grid') N.idle.add(updateHints, 'lib-hints');
      flushHeld();
    }
    function mixDone() {
      if (mixT) { clearTimeout(mixT); mixT = 0; }
      mixWait = false; mm = mp;
      if (chars0.length) chars = L.mixChars(chars0, mixLetters());
      var z = p0; p0 = null;
      if (z) page0(z.list, z.start, z.size);
      flushHeld();
    }
    /* Erweiterung meldet: Stand einzelner Karten neu (gleiche Menge) -> nur diese neu zeichnen; Menge anders -> beim naechsten Betreten */
    function mixRepaint() {
      if (dead || !mm || !mx) return;
      var x = mixOn() ? N.ext.call('lib:mix', lib, mixRepaint) : null;
      if (!x || x.sig !== mx.sig) { mixDirty = true; return; }
      if (away || n <= 0) return;
      for (var j = 0; j < mm.n; j++) { var v = mm.pos(j); if (v >= 0) grid.refresh(v, v); }
      if (zone === 'grid' && mm.phAt(grid.f) >= 0) N.idle.add(updateHints, 'lib-hints');
    }
    /* alles neu laden (Sortierung/Filter/Reiter geaendert, Rueckkehr nach Scan) */
    function reload(keepF) {
      gen++; abortAll();
      loadSig = srv ? '' : N.libwatch.sig(lib.id);
      items = []; n = -1; pages = {}; chars = []; chars0 = []; total = -1; sN = -1;
      if (!keepF) restoreF = 0;
      grid.clear(); ring.hide(); sb.hide(); hideReg(); U.show(skel, true);
      if (G.size !== L.view(prefs) || !!G.square !== music) { G = N.GridMath.make(L.view(prefs), music, A, AHEAD); grid.setGeom(G); }   // Ansicht Gross/Mittel/Klein/Liste
      buildChips(); paintStatus();
      U.cls(grid.clip, 'is-ext', mode() === 'x');       // Erweiterungs-Reiter: Karten gedimmt (nicht abspielbar), per Klasse am Raster
      if (xsrc) { items = xsrc.items(); if (!items.length && xsrc.more()) { xLoad(); return; } n = items.length; firstPaint(); return; }
      if (mode() === 'x') { items = N.ext.call('lib:items', lib, xtab) || []; n = items.length; firstPaint(); return; }
      if (list) { if (list.src === 'x' || listItems) { items = listItems || []; n = items.length; firstPaint(); } else loadList(); return; }   // Erweiterung fehlt: leer
      if (srv && !N.srv.conn(srv)) U.setText(statT, N.t('srv.connecting', { server: lib.srvName || N.srv.name(srv) }));   // weiterer Server: Verbindung wird geprueft
      mixStart();
      loadPage(0);
      var g = gen;
      if (mode() === 'lib') {
        if (L.hasRegister(prefs)) track(get('/library/sections/' + lib.id + '/firstCharacter', L.filterQuery(prefs, qlib()), null, function (err, d) {
          if (g !== gen) return;
          if (err) { if (mixWait) mixOff(); return; }                   // ohne Buchstaben-Index keine Stellen: diesmal ohne Karten
          chars0 = L.chars(d); chars0Ok = true; chars = mm ? L.mixChars(chars0, mixLetters()) : chars0; if (n >= 0) paintReg(true);
          mixPlan(g);
        }));
        if (L.hasFilter(prefs)) track(get('/library/sections/' + lib.id + '/all', { type: L.typeNum(qlib()), 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 0 }, null, function (err, d) {
          if (g !== gen || err || !d || !d.MediaContainer) return;
          total = Number(d.MediaContainer.totalSize) || 0; paintStatus();
        }));
      }
    }
    /* HOME-14: ganze Liste einer Startseiten-Reihe – EINE Anfrage (hoechstens LIST_MAX), Naechste Folgen gefiltert wie die Reihe */
    function loadList() {
      var g = gen, q = { 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': LIST_MAX, excludeElements: N.hubs.EXCL, excludeFields: 'summary,tagline' };
      var path = list.src === 'cw' ? '/hubs/continueWatching/items' : list.src === 'deck' ? '/library/onDeck' : list.key;
      track(get(path, q, { timeout: 15000 }, function (err, d) {
        if (g !== gen || dead) return;
        var mc = !err && d && d.MediaContainer;
        if (!mc) { onError(err); return; }
        items = listItems = N.hubs.listItems(list, M.normList(mc.Metadata || mc.Directory || [], list.kinds || kinds(), 0, true));
        n = items.length; firstPaint();
      }));
    }
    function firstPaint() {
      U.show(skel, false);
      paintStatus(); buildChips();
      if (!n) { showEmpty(); return; }
      grid.setModel(items, n, Math.min(restoreF, n - 1));
      if (zone === 'chips' && chips.length) { grid.setFocused(false); setChip(cf, true); }
      else { zone = 'grid'; grid.setFocused(!railOpen); placeRing(grid.ringPos()); }
      ensurePages();
      paintReg(true);
      N.idle.add(updateHints, 'lib-hints');
      amb.focus(cur()); amb.data();
      if (xsrc) grid.endNote(xEnd());
    }
    function ensurePages() { if (xsrc) { xNear(); return; } var ps = G.pagesFor(n, grid.r); if (mm) ps = L.mixPages(mm, ps, G.PAGE, sN); for (var i = 0; i < ps.length; i++) loadPage(ps[i]); }
    /* ---------- Reiter mit Quelle (Erweiterung) ---------- */
    function xPanel() { return !!(xsrc && xsrc.tabs); }
    function xEnd() { return n > 0 && !xsrc.more() ? xsrc.end() || '' : ''; }
    /* naechste Seite: erst wenn der Fokus hoechstens 2 Zeilen vor dem Ende steht, und dann aus dem Leerlauf (nie im Fokusschritt) */
    function xNear() {
      if (!xsrc || n <= 0 || !xsrc.more() || xsrc.busy() || G.row(n - 1) - G.row(grid.f) > 2) return;
      var g = gen;
      N.idle.add(function () { if (g === gen && !dead && xsrc && !xsrc.busy()) xLoad(); }, 'lib-xmore');
    }
    function xLoad() {
      var g = gen, src = xsrc;
      src.load(function (err) {
        if (g !== gen || dead || src !== xsrc) return;
        var l = src.items();
        if (n < 0) {
          if (!l.length && err) { xError(err); return; }
          items = l; n = l.length; firstPaint(); return;
        }
        if (l.length > n) { items = l; n = l.length; grid.grow(items, n); }
        grid.endNote(xEnd()); paintStatus();
        if (!away) xNear();
      });
    }
    function xError(err) {
      var tx = xsrc.err(err);
      U.show(skel, false); ring.hide(); U.setText(statT, '');
      sb.show({ title: tx.title, text: tx.text, buttons: [{ id: 'retry', t: N.t('err.btn.retry') }], onSelect: function () { sb.hide(); reload(true); } });
      zone = 'state';
    }
    function onError(err) {
      U.show(skel, false); ring.hide();
      var kind = N.errs.kind(err, 'pms'), tx;
      if (srv) { srvError(err); return; }                 // Weitere Server: Meldung nur fuer diesen Server, eigenes Profil bleibt
      if (kind === 'auth') { N.app.authLost(); return; }   // Kinderprofil-Pruefung wie Startseite (Pentest P6)
      tx = kind === 'server' ? { title: N.t('err.server.title'), text: N.t('lib.err.text', { server: N.session.state.server && N.session.state.server.name || '' }) }
        : N.errs.texts('generic', null, N.session.isKid());
      U.setText(statT, '');
      sb.show({ title: tx.title, text: tx.text, buttons: [{ id: 'retry', t: N.t('err.btn.retry') }], onSelect: function () { sb.hide(); reload(true); } });
      zone = 'state';
    }
    /* Weitere Server: nicht erreichbar (Freund offline, Adresse gewechselt, "Sichere Verbindungen: Erforderlich") oder Zugang
     * abgelehnt (Freigabe entzogen). Erneut versuchen = alle Adressen neu pruefen (ggf. frische vom Helfer), dann neu laden. */
    function srvError(err) {
      var name = lib.srvName || N.srv.name(srv), auth = N.srv.state(srv) === 'auth' || (err && (err.status === 401 || err.status === 403));
      U.setText(statT, '');
      sb.show({ title: N.t(auth ? 'srv.err.auth.title' : 'srv.err.down.title', { server: name }), text: N.t(auth ? 'srv.err.auth.text' : 'srv.err.down.text', { server: name }),
        buttons: [{ id: 'retry', t: N.t('err.btn.retry') }],
        onSelect: function () { sb.hide(); U.setText(statT, N.t('common.loading')); N.srv.resolve(srv, true, function () { if (!dead) reload(true); }); } });
      zone = 'state';
    }
    function showEmpty() {
      ring.hide(); grid.clear(); hideReg(); amb.focus(null);
      if (xsrc) {
        var em = xsrc.empty();
        sb.show({ title: em.title, text: em.text, buttons: em.reset ? [{ id: 'reset', t: N.t('lib.filter.reset') }] : [], onSelect: function () { xsrc.reset(); restoreF = 0; reload(); } });
        zone = sb.ids.length ? 'state' : chips.length ? 'chips' : 'state';
        if (zone === 'chips') setChip(0, true);
        return;
      }
      var key = mode() === 'colls' ? 'empty.colls' : list ? 'empty.list' : L.hasFilter(prefs) && !coll ? 'empty.filter' : 'empty.library';
      sb.show({ title: N.t(key + '.title'), text: N.t(key + '.text'), buttons: key === 'empty.filter' ? [{ id: 'reset', t: N.t('lib.filter.reset') }] : [],
        onSelect: function () { resetFilter(); } });
      zone = sb.ids.length ? 'state' : chips.length ? 'chips' : 'state';
      if (zone === 'chips') setChip(0, true);
    }

    /* ---------- Register (SPEC 7.5) ---------- */
    function hideReg() { U.show(regDivs.box, false); }
    /* Buchstabe der Stelle, an der man ist (LIB-11): fokussierter Titel (TV: die Fokuszeile steht oben am Anker); frei gescrollt
     * (caps.scroll 'free', Fokus bleibt liegen) der erste Titel der obersten sichtbaren Zeile */
    function regIdx() { return grid.free ? Math.max(0, Math.min(n - 1, grid.r * G.COLS)) : grid.f; }   // leere Liste: 0, nie -1
    /* Buchstaben ohne Titel abgeschwaecht (einmal je Index), aktueller hervorgehoben (nur alter + neuer umgeklasst) */
    /* Klasse eines Platzes: aktuell (fokussiert bzw. beim Ziehen unter dem Finger) > Zeiger darueber > vorhanden/abgeschwaecht/"•" */
    function regCls(j) {
      if (j === regCur) return regFoc ? 'reg cur is-focus' : 'reg cur';
      var b = regAi[j] < 0 ? 'reg dot' : regHas.indexOf(LETTERS.charAt(regAi[j])) >= 0 ? 'reg' : 'reg off';
      return j === regHov ? b + ' hov' : b;
    }
    function paintReg(force) {
      if (!regOn()) { hideReg(); return; }
      var has = L.present(chars), i, sc = scrub && !scrub.away;
      if (has !== regHas) { regHas = has; regCur = -1; regFoc = false; for (i = 0; i < regDivs.length; i++) regDivs[i].className = regCls(i); }
      U.show(regDivs.box, true);
      var ch = sc ? scrub.ch : zone === 'reg' ? regCh : L.letterAt(chars, regIdx(), prefs.desc);
      if (!force && zone !== 'reg' && ch === regCh && regCur >= 0) return;
      if (!sc) regCh = ch;                                  // Ziehen: Tasten-Stand bleibt (Abbruch stellt ihn wieder her)
      var li = LETTERS.indexOf(ch), k = li >= 0 ? regMap[li] : -1, foc = zone === 'reg' || !!sc, old = regCur;
      regCur = k; regFoc = foc;
      if (old >= 0 && old !== k) regDivs[old].className = regCls(old);
      if (k >= 0) regDivs[k].className = regCls(k);
    }
    /* Buchstabe unter y (Ansicht): Plaetze der Leiste, verdichtet linear (L.azIndex); TV wie bisher je 17 px */
    function regAt(y) { return regDivs.length < LETTERS.length ? LETTERS.charAt(L.azIndex(y - REG_Y, regDivs.length, REG_STEP, LETTERS.length)) : LETTERS.charAt(Math.floor((y - REG_Y) / REG_STEP)); }
    /* Zeiger ueber der Leiste (nur AZD): Platz hell und fett; -1 = keiner */
    function setHov(j) {
      if (j === regHov) return;
      var old = regHov;
      regHov = j;
      if (old >= 0 && regDivs[old]) regDivs[old].className = regCls(old);
      if (j >= 0) regDivs[j].className = regCls(j);
    }
    /* Anzeige nur nach 300 ms Ruhe (nicht im Tastenpfad) */
    function regLater() {
      if (regT) clearTimeout(regT);
      regT = setTimeout(function () { regT = 0; if (N.idle.restFor() < REST) { regLater(); return; } paintReg(false); }, REST);
    }
    function jumpTo(letter) {
      var j = L.jump(chars, letter, prefs.desc);
      showBubble(j.ch || letter);
      if (zone !== 'grid') toGrid();
      moveTo(Math.min(j.idx, n - 1));
      regCh = j.ch; paintReg(true);
    }
    function showBubble(t) {
      U.setText(bubbleT, t); U.show(bubble, true);
      if (bubbleTm) clearTimeout(bubbleTm);
      bubbleTm = setTimeout(function () { bubbleTm = 0; U.show(bubble, false); }, 1000);
    }
    /* Ziffern: T9-Erstbuchstabe (2 = A, 22 = B …), Mehrfachdruck innerhalb 900 ms */
    function digit(d) {
      if (!regOn()) return;
      var now = U.now();
      if (t9.d === d && now - t9.t < 900) t9.c++; else { t9.d = d; t9.c = 1; }
      t9.t = now;
      jumpTo(L.t9(d, t9.c));
    }

    /* ---------- Fokus ---------- */
    /* freies Scrollen, Maus/Trackpad (Apple Nr. 29): Ring scrollt mit der Karte; ist sie oben unter Chips/Titel gewandert (Raster-
     * Ausschnitt ab y 164), waere er dort zu sehen -> verbergen, bis wieder eine ganze Karte gemeint ist. Tasten/TV: unveraendert */
    function placeRing(p) {
      if (!p || railOpen || sb.on) return;
      if (FREE && N.input.mode !== 'key' && p.y < 164) { ring.hide(); return; }
      ring.to(p.shape, p.x, p.y, p.noScale);
    }
    /* Nr. 29: Raster frei gescrollt -> Ring an die Fokuskarte (selber Frame, ohne Gleiten), Karte unter dem Zeiger neu bestimmen */
    function ptrScrolled() {
      if (N.input.mode !== 'pointer' || zone !== 'grid' || n <= 0) return;
      N.fx.step(true); placeRing(grid.ringPos());
      if (N.pointer && N.pointer.follow) N.pointer.follow();
    }
    function updateHints() { N.router.refreshHints(); }
    function afterMove() { ensurePages(); regLater(); N.idle.add(updateHints, 'lib-hints'); amb.focus(cur()); if (DWARM && N.details.warm) N.details.warm(cur()); }   // amb: nur merken (Wechsel nach Ruhe)
    var DWARM = !!(N.ui.card && N.ui.card.on());       // Detailkarte (Apple): Hintergrund der fokussierten Karte vorladen (DET-21); TV: nie
    function moveTo(i) { placeRing(grid.focusTo(i)); afterMove(); }
    function setChip(i, force) {
      if (!chips.length) return;
      if (!force && chips[cf]) U.cls(chips[cf].el, 'is-focus', false);
      cf = U.clamp(i, 0, chips.length - 1);
      U.cls(chips[cf].el, 'is-focus', true);
      if (chipMax) chipShow(cf);
    }
    /* ▲ aus der ersten Reihe: auf den aktiven Reiter (TV-Test 29.10.: landete auf "Sortieren & Filter", ▶ dann auf "Alle abspielen"
     * und ein OK spielte sofort ab). Ohne Reiter: "Sortieren & Filter", sonst der erste Chip. Nie direkt "Alle abspielen". */
    function upChip() {
      for (var i = 0; i < chips.length; i++) if (chips[i].act) return i;
      for (i = 0; i < chips.length; i++) if (chips[i].id === 'sort') return i;
      return 0;
    }
    function toChips() {
      if (!chips.length) return;
      zone = 'chips'; grid.setFocused(false); ring.hide();
      setChip(upChip(), true);
      N.router.refreshHints();
    }
    function toGrid() {
      if (zone === 'chips' && chips[cf]) U.cls(chips[cf].el, 'is-focus', false);
      if (zone === 'reg') { zone = ''; }
      zone = 'grid';
      if (n > 0) { grid.setFocused(true); placeRing(grid.ringPos()); }
      paintReg(true);
      N.router.refreshHints();
    }
    function toReg() {
      zone = 'reg'; grid.setFocused(false); ring.hide();
      regCh = L.letterAt(chars, regIdx(), prefs.desc);    // startet beim hervorgehobenen Buchstaben (LIB-11), nie oben
      paintReg(true);
      N.router.refreshHints();
    }

    /* ---------- Aktionen ---------- */
    function cur() { return n > 0 ? grid.item(grid.f) : null; }
    function open(it) {
      if (!it) return;
      if (it.ext && xsrc && xsrc.open && xsrc.open(it)) return;          // Reiter mit Quelle: z. B. schon vorhandener Titel -> echte Seite
      if (it.ext && mm && mx && mx.open && mx.open(it, s.rail)) return;    // LIB-13: eingemischte Karte – die Erweiterung waehlt die Seite
      if (it.ext) { N.router.push('extdetails', { it: it, rail: s.rail }); return; }   // Titel ausserhalb des Servers (Erweiterungs-Reiter); Marke bleibt auf der Bibliothek (TV-Test 29.10.)
      if (it.type === 'collection') { N.router.push('library', { lib: lib, coll: { rk: it.rk, title: it.title } }); return; }
      if (list && (list.src === 'cw' || list.src === 'deck') && M.isLeaf(it)) { N.player.play(it, 'ask'); return; }   // wie auf der Startseite: OK spielt ab
      if (music && N.music.open(it)) return;
      N.details.open(it);
    }
    function setPrefs(p) {
      prefs = p;
      if (keep()) L.save(libKey, prefs);
      reload();
    }
    function resetFilter() { var p = U.extend({}, prefs); p.f = { status: '' }; params.actor = null; setPrefs(p); }
    function sortEntries() {
      var out = [];
      var ss = L.sorts(qlib());
      for (var i = 0; i < ss.length; i++) {
        var d = ss[i], sel = prefs.sort === d.id;
        var t = d.id === 'title' ? N.t(sel && prefs.desc ? 'lib.sort.titleDesc' : 'lib.sort.title') : L.sortName(d, qlib());
        out.push({ id: d.id, t: t, s: sel && !d.fixed ? N.t('lib.sort.hint') : '', sel: sel });
      }
      return out;
    }
    function filterEntries() {
      var f = prefs.f || {}, out = [], i;
      for (i = 0; i < L.STATUS.length && !music; i++) out.push({ id: 'st:' + L.STATUS[i], t: N.t('lib.filter.' + (L.STATUS[i] || 'all')), sel: (f.status || '') === L.STATUS[i] });
      var ls = L.lists(qlib());
      for (i = 0; i < ls.length; i++) out.push({ id: 'ls:' + ls[i].id, t: N.t('lib.filter.' + ls[i].id), s: f[ls[i].id] ? f[ls[i].id].t : N.t('lib.filter.any'), sel: !!f[ls[i].id] });
      if (f.actor) out.push({ id: 'actor', t: N.t('lib.filter.with', { name: f.actor.t }), s: N.t('lib.filter.remove'), sel: true });
      out.push({ id: 'reset', t: N.t('lib.filter.reset') });
      return out;
    }
    function viewEntries() {
      var out = [], cur = L.view(prefs);
      var V = N.GridMath.VIEWS;
      for (var i = 0; i < V.length; i++) out.push({ id: V[i], t: N.t('lib.view.' + V[i]), sel: cur === V[i] });
      return out;
    }
    function setView(id) { var pv = U.extend({}, prefs); pv.view = id; restoreF = grid.f; prefs = pv; if (keep()) L.save(libKey, prefs); reload(true); }
    /* HOME-14-Listen: nur "Ansicht" (Gross/Mittel/Klein/Liste) wie in der Bibliothek, gilt fuer diesen Besuch */
    function viewPanel() {
      N.ui.tabPanel.open({ title: N.t('lib.chipView'), tab: 0, tabs: [{ t: N.t('lib.panel.tabView'), entries: viewEntries }], keys: { RED: function () {} },
        onPick: function (t, id) { setView(id); return true; } });
    }
    function sortFilter(tab) {
      if (viewOnly()) { viewPanel(); return; }
      if (xPanel()) { xSortFilter(tab); return; }
      if (mode() !== 'lib') return;
      N.ui.tabPanel.open({ title: N.t('lib.chip'), tab: tab || 0,
        tabs: [{ t: N.t('lib.panel.tabSort'), entries: sortEntries }, { t: N.t('lib.panel.tabFilter'), entries: filterEntries }, { t: N.t('lib.panel.tabView'), entries: viewEntries }],
        keys: { RED: function () {} },
        onPick: function (t, id) {
          if (t === 0) { setPrefs(L.pickSort(prefs, id, qlib())); return true; }
          if (t === 2) { setView(id); return true; }
          var p = U.extend({}, prefs); p.f = U.extend({}, prefs.f || {});
          if (id.indexOf('st:') === 0) { p.f.status = id.slice(3); setPrefs(p); return true; }
          if (id === 'actor') { delete p.f.actor; params.actor = null; setPrefs(p); return true; }
          if (id === 'reset') { p.f = { status: '' }; params.actor = null; setPrefs(p); return false; }
          if (id.indexOf('ls:') === 0) { pickValue(id.slice(3)); return false; }
          return false;
        } });
    }
    /* Sortieren & Filter eines Reiters mit Quelle: Reiter der Quelle + "Ansicht" (wie die Bibliothek). onPick der Quelle: true = offen
     * lassen; ctx.reload() laedt neu (Fokus auf den Anfang), ctx.reopen(t) oeffnet das Panel wieder (z. B. nach einer Werteliste) */
    function xSortFilter(tab) {
      var src = xsrc, tabs = src.tabs(), vi = tabs.length;
      var ctx = { reload: function () { if (src === xsrc && !dead) { restoreF = 0; reload(); } }, reopen: function (t) { if (src === xsrc && !dead && !away) xSortFilter(t); } };
      N.ui.tabPanel.open({ title: N.t('lib.chip'), tab: Math.min(tab || 0, vi),
        tabs: tabs.concat([{ t: N.t('lib.panel.tabView'), entries: viewEntries }]),
        keys: { RED: function () {} },
        onPick: function (t, id) {
          if (t === vi) { setView(id); return true; }
          return src.pick(t, id, ctx);
        } });
    }
    /* Werte eines Zusatzfilters vom Server (lazy), Auswahl-Panel; RETURN -> zurueck ins Filter-Panel */
    function pickValue(lid) {
      var def = null, ls = L.lists(qlib());
      for (var i = 0; i < ls.length; i++) if (ls[i].id === lid) def = ls[i];
      if (!def) return;
      get('/library/sections/' + lib.id + '/' + def.key, { type: L.typeNum(qlib()) }, null, function (err, d) {
        if (dead || away) return;
        var vals = err ? [] : L.values(d), cur0 = prefs.f && prefs.f[lid], e = [{ id: '', t: N.t('lib.filter.any') }];
        if (err) { N.ui.toast.show(N.t('toast.actionFailed')); return; }
        for (var j = 0; j < vals.length; j++) e.push({ id: vals[j].id, t: vals[j].t });
        N.ui.panel.select({ title: N.t('lib.filter.' + lid), entries: e, selected: cur0 ? cur0.id : '',
          onCancel: function () { sortFilter(1); },
          onSelect: function (v) {
            var p = U.extend({}, prefs); p.f = U.extend({}, prefs.f || {});
            if (!v) delete p.f[lid]; else for (var k = 0; k < vals.length; k++) if (vals[k].id === v) p.f[lid] = { id: v, t: vals[k].t };
            setPrefs(p);
          } });
      });
    }
    /* Alle abspielen / Zufall: Play-Queue ueber den PMS (sortiert/gefiltert wie das Raster) */
    function playAll(shuffle) {
      var mid = srv || N.session.state.server && N.session.state.server.machineId;   // Weitere Server: Queue auf DEM Server
      if (music && !coll) { N.music.playLib(lib, shuffle); return; }   // M4: lokale Warteschlange (kein Play-Queue-POST)
      if (!mid || n <= 0) return;
      var uri = coll ? 'server://' + mid + '/com.plexapp.plugins.library/library/collections/' + coll.rk + '/children' : L.queueUri(mid, lib, prefs);
      N.ui.toast.show(N.t('common.loading'));
      N.plex.pms('POST', '/playQueues', { type: 'video', uri: uri, shuffle: shuffle ? 1 : 0, continuous: 0, includeChapters: 0 }, N.srv.o(srv, { retries: 0, dedupe: false, timeout: 15000 }), function (err, d) {
        var mc = !err && d && d.MediaContainer;
        if (dead || away) return;
        if (!mc || !mc.Metadata || !mc.Metadata.length) { N.ui.toast.show(N.t('toast.actionFailed')); return; }
        N.ui.toast.hide();
        N.details.playQueue(mc);
      });
    }
    function toggleWatched() {
      var it = cur(), idx = grid.f;
      if (!it || it.ext || !M.isVideo(it)) return;
      var st = prefs.f && prefs.f.status;
      N.watch.toggle(it, {
        changed: function (x, w) {
          // Filter "Ungesehen"/"Gesehen": Karte verschwindet (SPEC 6.3.1)
          if (mode() === 'lib' && ((st === 'unwatched' && w) || (st === 'watched' && !w) || (st === 'started' && w))) {
            if (mm) { mm.cut(idx); sN--; }                     // LIB-13: eingemischte Karten dahinter ruecken mit
            if (!grid.removeAt(idx)) { n = 0; showEmpty(); } else { n = grid.n; placeRing(grid.ringPos()); }
            paintStatus();
          } else grid.refresh(idx, idx);
          N.idle.add(updateHints, 'lib-hints'); amb.focus(cur());
        },
        reverted: function (x) {
          if (grid.items[idx] !== x && grid.items.indexOf(x) < 0) { sb.hide(); if (zone === 'state') zone = 'grid'; grid.setFocused(true); var at = Math.min(idx, grid.n); if (mm) { mm.ins(at); sN++; } grid.insertAt(at, x); n = grid.n; placeRing(grid.ringPos()); paintStatus(); }
          else grid.refresh(0, grid.n - 1);
          N.idle.add(updateHints, 'lib-hints');
        }
      });
    }
    function menu() {
      var it0 = zone === 'grid' ? cur() : null;
      if (!it0 || !N.anime.menuOn(it0)) { menuOpen(it0); return; }
      N.anime.ensure(it0, function () { if (cur() === it0 && N.router.top() === s && !N.router.hasOverlay()) menuOpen(it0); });   // Einordnung fuer "Als Anime behandeln"
    }
    function menuOpen(it) {
      var b = [];
      var pl = it && !it.ext;                          // Titel ausserhalb des Servers: nur "Details"
      if (pl && (M.isLeaf(it) || N.music.isAudio(it))) b.push({ id: 'play', t: N.t('menu.play') });
      if (pl && M.isLeaf(it) && M.progress(it) > 0) b.push({ id: 'start', t: N.t('menu.fromStart') });
      if (pl && M.isVideo(it)) b.push({ id: 'watched', t: N.t(M.watched(it) ? 'menu.markUnwatched' : 'menu.markWatched') });
      if (pl) b = b.concat(N.anime.menuButtons(it));
      if (it && it.ext && xsrc && xsrc.menu) b = b.concat(xsrc.menu(it));   // Reiter mit Quelle: eigene Aktionen der Erweiterung
      if (it) b.push({ id: 'info', t: N.t('menu.info') });
      if (mode() !== 'colls' && mode() !== 'x' && mode() !== 'list' && n > 0) { b.push({ id: 'all', t: N.t('lib.playAll') }); b.push({ id: 'shuffle', t: N.t('lib.shuffle') }); }
      if (mode() === 'lib' || xPanel()) b.push({ id: 'sort', t: N.t('lib.chip') });
      else if (viewOnly()) b.push({ id: 'sort', t: N.t('lib.chipView') });
      if (!coll && !list && !srv && N.session.isAdmin() && !xsrc) b.push({ id: 'scan', t: N.t('menu.scanLib') });
      if (!b.length) return;
      N.ui.dialog.open({ title: it ? it.title : (coll ? coll.title : lib.title), buttons: b, vertical: true, focus: 0, top: 120,
        onSelect: function (id) {
          if (id === 'play') N.details.play(it, 'ask');
          else if (id === 'start') N.details.play(it, 'start');
          else if (id === 'watched') toggleWatched();
          else if (id === 'info') open(it);
          else if (id === 'all') playAll(false);
          else if (id === 'shuffle') playAll(true);
          else if (id === 'sort') sortFilter(0);
          else if (id === 'scan') N.scan.start(lib.id);
          else if (xsrc && xsrc.act && xsrc.act(id, it, function () { var j = grid.items.indexOf(it); if (j >= 0 && !dead) grid.refresh(j, j); })) return;
          else N.anime.menuPick(id, it);
        } });
    }
    function chipAct(id) {
      if (id === 'sort' || id === 'view') sortFilter(0);
      else if (id === 'all') playAll(false);
      else if (id === 'shuffle') playAll(true);
      else if (id === 'tab-lib' || id === 'tab-coll' || id === 'tab-alt') {
        var t = id.slice(4), wasX = !!xtab;
        xtab = ''; xsrc = null;
        if (t !== prefs.tab) { var p = U.extend({}, prefs); p.tab = t; cf = chipIndex(id); setPrefs(p); }
        else if (wasX) { cf = chipIndex(id); restoreF = 0; reload(); }
      }
      else if (id.indexOf('tab-x-') === 0 && id.slice(6) !== xtab) {
        xtab = id.slice(6); xsrc = null;
        var xt = xtabs();
        for (var i = 0; i < xt.length; i++) if (xt[i].id === xtab) xsrc = xt[i].src || null;
        cf = chipIndex(id); restoreF = 0; reload();
      }
    }

    /* ---------- Hinweisleiste ---------- */
    s.hints = function () {
      if (sb.on && zone === 'state') return [N.disc.blueHint(), { k: 'ret', t: 'hint.back' }];
      var it = zone === 'grid' ? cur() : null, list = [];
      if (mode() === 'lib' || xPanel()) list.push({ k: 'red', t: 'hint.sort' });
      else if (viewOnly()) list.push({ k: 'red', t: 'hint.view' });
      if (it && !it.ext && M.isVideo(it)) list.push({ k: 'yellow', t: M.watched(it) ? 'hint.markUnwatched' : 'hint.markWatched' });
      list.push(N.disc.blueHint());
      if (it) list.push({ k: 'INFO', t: 'hint.details' });
      if (list.length < 5) list.push({ k: 'TOOLS', t: 'hint.options' });
      return list;
    };

    /* ---------- Lebenszyklus ---------- */
    s.enter = function (p, restore) {
      away = false;
      amb.enter();                                     // Einstellung pruefen; Zufallsbild einmal je Oeffnen
      if (!prefs) {
        prefs = startPrefs();
        if (params.actor) { prefs = U.extend({}, prefs); prefs.tab = 'lib'; prefs.f = { status: '', actor: params.actor }; }
        if (params.view) { prefs = U.extend({}, prefs); prefs.view = params.view; }   // Messlauf (P7): Ansicht nur fuer diesen Aufruf
        if (restore) { restoreF = restore.f || 0; if (restore.prefs) prefs = restore.prefs; }
        if (!coll && !params.actor && !list) checkColls();
        if (music && !coll && !list) N.music.probeLib(lib, function (b) { if (!dead && b !== book) { book = b; if (!restore) prefs = startPrefs(); reload(true); } });
        if (list && list.src === 'x') xsrc = N.ext.has('lib:list') ? N.ext.call('lib:list', list) || null : null;   // HOME-14 Erweiterungs-Liste
        if (params.xtab && !restore) { var xl = xtabs(); for (var xi = 0; xi < xl.length && !xtab; xi++) if (xl[xi].id === params.xtab || (params.xtab === '*' && xl[xi].src)) { xtab = xl[xi].id; xsrc = xl[xi].src || null; } }
        reload(true);
        return;
      }
      if (!pages) { reload(true); return; }
      if (fresh()) return;
      if (mode() === 'x') xRepaint();                  // Rueckkehr von der Detailseite (z. B. Anfrage zurueckgezogen): Liste aus dem Speicher
      else if (N.ext.has('lib:tabs')) buildChips();    // Reiter der Erweiterung kann inzwischen da sein
      if (zone === 'grid' && n > 0) { grid.setFocused(true); placeRing(grid.ringPos()); grid.refresh(Math.max(0, grid.f - 10), Math.min(n - 1, grid.f + 15)); }
      N.router.refreshHints();
    };
    /* LIB-10: Inhalt der Bibliothek auf dem Server geaendert (N.libwatch)? Nur beim (Wieder-)Betreten, nie waehrend man darin ist:
     * Stand schon bekannt und anders -> sofort einmal neu laden (fokussierter Titel bleibt fokussiert); sonst hoechstens alle 60 s
     * eine kleine Anfrage im Leerlauf – kommt die Antwort, bevor eine Taste gedrueckt wurde, wird gleich neu geladen, sonst beim
     * naechsten Betreten. Reiter einer Erweiterung und Bibliotheken weiterer Server: unveraendert. */
    function changed() { var sg = N.libwatch.sig(lib.id); if (!loadSig && sg) loadSig = sg; return !!(loadSig && sg && sg !== loadSig); }
    /* LIB-13: Menge der eingemischten Karten anders als beim Laden (neue Anfrage, Ankunft) – nur beim Betreten geprueft */
    function mixChanged() {
      if (mixDirty) return true;
      if (!mixOn()) return !!mm;
      var x = N.ext.call('lib:mix', lib, mixRepaint);
      return (x && x.items && x.items.length ? x.sig : '') !== (mm && mx ? mx.sig : '');
    }
    function relaunch() { var it = cur(); restoreRk = it ? it.rk : null; restoreF = grid.f; reload(true); }
    function fresh() {
      if (srv || mode() === 'x' || list || n < 0) return false;
      if (changed() || mixChanged()) { relaunch(); return true; }
      keyed = false;
      var g = gen;
      N.idle.add(function () {
        if (dead || away || g !== gen) return;
        N.libwatch.check(function () { if (!dead && !away && g === gen && !keyed && changed()) relaunch(); });
      }, 'lib-watch');
      return false;
    }
    /* Gibt es Sammlungen? (nur dann den Reiter zeigen) */
    function checkColls() {
      get('/library/sections/' + lib.id + '/collections', { 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 0 }, null, function (err, d) {
        if (dead || err || !d || !d.MediaContainer) return;
        var c = Number(d.MediaContainer.totalSize || d.MediaContainer.size) || 0;
        if (c !== collN) { collN = c; if (!c && prefs.tab === 'coll') { prefs.tab = 'lib'; reload(); } else buildChips(); }
      });
    }
    s.leave = function () {
      away = true;
      stopPan(); pan = null;
      if (scrub) { scrub = null; U.show(azs, false); }
      if (regT) { clearTimeout(regT); regT = 0; }
      return { f: grid.f, prefs: params.actor || once || list ? prefs : null };   // nicht gemerkte Ansicht: Stand fuer die Rueckkehr
    };
    s.destroy = function () {
      dead = true; gen++; abortAll();
      if (mixT) clearTimeout(mixT);
      if (onScanned) N.evt.off('library:scanned', onScanned);
      if (bubbleTm) clearTimeout(bubbleTm);
      amb.destroy();
      grid.clear();
    };
    s.railBlur = function () { railOpen = true; ring.hide(); grid.setFocused(false); if (zone === 'chips' && chips[cf]) U.cls(chips[cf].el, 'is-focus', false); };
    s.railFocus = function () {
      railOpen = false;
      if (zone === 'chips') { setChip(cf, true); return; }
      if (zone === 'grid' && n > 0) { grid.setFocused(true); placeRing(grid.ringPos()); }
    };
    /* RETURN oben angekommen (NAV-5): Bereich aus der Seitenleiste -> N.app.sectionBack (Start bzw. vorheriger Bereich), Sammlung/Person -> zurueck */
    function up() { if (params.sec && !sub) N.app.sectionBack(); else N.router.back(); }

    s.onKey = function (k) {
      keyed = true; mixQuiet = false;
      if (N.keys.isDigit(k)) { if (zone === 'grid' || zone === 'reg') digit(k); return true; }
      if (k === 'BLUE') { N.router.push(N.disc.blueView()); return true; }
      if (zone === 'state') {
        if (sb.onKey(k)) return true;
        if (k === 'UP' && chips.length) { zone = 'chips'; setChip(cf, true); N.router.refreshHints(); return true; }
        if (k === 'LEFT') { if (s.rail) N.ui.rail.open(); return true; }
        if (k === 'RED') { sortFilter(0); return true; }
        if (k === 'RETURN') { up(); return true; }
        return true;
      }
      if (zone === 'chips') {
        switch (k) {
          case 'LEFT': if (cf > 0) setChip(cf - 1); else if (s.rail) { U.cls(chips[cf].el, 'is-focus', false); N.ui.rail.open(); } return true;
          case 'RIGHT': if (cf < chips.length - 1) setChip(cf + 1); return true;
          case 'DOWN': if (n > 0) toGrid(); else if (sb.on && sb.ids.length) { U.cls(chips[cf].el, 'is-focus', false); zone = 'state'; } return true;
          case 'ENTER': chipAct(chips[cf].id); return true;
          case 'RED': sortFilter(0); return true;
          case 'TOOLS': menu(); return true;
          case 'RETURN': if (n > 0) toGrid(); else up(); return true;
        }
        return true;
      }
      if (zone === 'reg') {
        switch (k) {
          case 'UP': case 'DOWN': regCh = L.regStep(chars, regCh, k === 'UP' ? -1 : 1, false); paintReg(true); return true;
          case 'ENTER': jumpTo(regCh); return true;
          case 'LEFT': case 'RETURN': toGrid(); return true;
        }
        return true;
      }
      if (n <= 0) { if (k === 'LEFT' && s.rail) N.ui.rail.open(); else if (k === 'RETURN') up(); return true; }
      if (loose) { reanchor(); if (N.keys.isNav(k)) return true; }   // erste Taste nach Wischen/Rad: Fokus auf die Karte am Anker (wie TV)
      var f = grid.f, it = cur(), nx;
      switch (k) {
        case 'LEFT': if (G.col(f) > 0) moveTo(f - 1); else if (s.rail) N.ui.rail.open(); return true;
        case 'RIGHT':
          nx = G.move(f, n, 'RIGHT');
          if (nx >= 0) moveTo(nx); else if (regOn()) toReg();
          return true;
        case 'UP': nx = G.move(f, n, 'UP'); if (nx >= 0) moveTo(nx); else toChips(); return true;
        case 'DOWN': nx = G.move(f, n, 'DOWN'); if (nx >= 0) moveTo(nx); return true;
        case 'FF': case 'CH_DOWN': moveTo(G.jumpRows(f, n, 3)); return true;
        case 'RW': case 'CH_UP': moveTo(G.jumpRows(f, n, -3)); return true;
        case 'ENTER': open(it); return true;
        case 'INFO': if (list && it && !it.ext && M.isLeaf(it)) N.details.open(it); else open(it); return true;   // HOME-14: INFO in Weiterschauen = Details, nicht abspielen
        case 'PLAY': if (it && !it.ext) N.details.play(it, 'resume'); return true;
        case 'RED': sortFilter(0); return true;
        case 'YELLOW': toggleWatched(); return true;
        case 'TOOLS': menu(); return true;
        case 'RETURN':
          if (G.row(f) > 0) moveTo(G.col(f));                      // RETURN-Kette (6.2): Zeile 1, gleiche Spalte
          else up();
          return true;
      }
      return true;
    };

    /* ---------- Zeiger (Index-Mathe) ---------- */
    s.pointer = function (x, y, kind) {
      keyed = true; mixQuiet = false;
      if (eat) { if (kind === 'click') eat = false; return true; }   // Beruehrung hat den Schwung angehalten: nichts oeffnen
      if (sb.on && zone === 'state') return sb.pointer(x, y, kind);
      if (y >= 120 && y < 152 && chipRects) {
        for (var i = 0; i < chipRects.length; i++) if (x + chipOff >= chipRects[i][0] && x + chipOff < chipRects[i][0] + chipRects[i][1] && x < 144 + (chipMax ? chipBar.offsetWidth : 1e4)) {
          if (zone !== 'chips') { zone = 'chips'; paintReg(true); grid.setFocused(false); ring.hide(); setChip(i, true); N.router.refreshHints(); }
          else if (i !== cf) setChip(i);
          if (kind === 'click') chipAct(chips[i].id);
          return true;
        }
        return false;
      }
      if (regOn() && x >= regX && x < regX + 56 && y >= REG_Y && y < REG_Y + regH) {
        var lt = regAt(y);
        if (AZD && kind === 'move') setHov(regMap[LETTERS.indexOf(lt)]);   // Maus/Trackpad: Buchstabe unter dem Zeiger hell (Klick = Ziehen-Weg)
        if (kind === 'click' && L.present(chars).indexOf(lt) >= 0) jumpTo(lt);
        return true;
      }
      if (regHov >= 0) setHov(-1);
      if (n <= 0) return false;
      if (FREE) {                                       // freies Scrollen: jede sichtbare Karte (auch angeschnitten), Liste rollt nie
        var jf = grid.hitAt(x, y);
        if (jf < 0) return false;
        if (zone !== 'grid') toGrid();
        if (jf !== grid.f) { N.fx.step(true); placeRing(grid.focusTo(jf, true)); afterMove(); }
        if (kind === 'click' && !N.details.tap(grid.item(jf))) open(grid.item(jf));   // Detailkarte: Tipp oeffnet die Karte (auch Weiterschauen-Listen)
        return true;
      }
      var ez = s.pointerEdge(x, y);
      if (ez) { if (kind === 'click') s.pointerScroll(ez.d); return true; }   // Randzone: rollt (Verweilen/Klick), fokussiert nicht
      var j = G.hit(n, grid.r, x, y);
      if (j < 0) { N.pointer.holdCancel(); return false; }
      if (G.row(j) - grid.r >= grid.hitRows()) {                          // angeschnittene, aber zeigbare Zeile (G.part)
        if (kind === 'click') { reveal(j); if (!N.details.tap(grid.item(j))) open(grid.item(j)); return true; }
        N.pointer.hold(function () { if (!dead && G.hit(n, grid.r, N.pointer.x, N.pointer.y) === j) reveal(j); });   // ~250 ms: Vorbeiziehen loest nichts aus
        return true;
      }
      N.pointer.holdCancel();
      if (zone !== 'grid') toGrid();
      if (j !== grid.f) { N.fx.step(true); placeRing(grid.focusTo(j, true)); afterMove(); }   // still: Liste rollt nicht unter dem Punkt
      if (kind === 'click' && !N.details.tap(grid.item(j))) open(grid.item(j));   // Detailkarte: Tipp oeffnet die Karte
      return true;
    };
    /* Zeiger-Rollen nur ueber Randzonen (TV-Befund 27.10. nachmittags): oben Streifen y 154–196 (unter den Chips, oberer Rand der
     * Fokuszeile), unten schmales Band y 604–656 ueber der Hinweisleiste (bzw. ab einer nicht zeigbaren Zeile, G.edgeB), jeweils
     * ueber der Rasterbreite; Anzeige-Pille mittig in der Zone */
    /* angeschnittene Zeile per Zeiger: EINE Zeile rollen, dann fokussieren (Ring erst jetzt, nie ueber Band/Hinweisleiste);
     * danach Zeiger-Sperre (Inhalt ist unter dem Punkt gewandert) -> keine Rueckkopplung */
    function reveal(j) {
      if (zone !== 'grid') toGrid();
      N.fx.step(true);
      grid.scrollBy(1);
      placeRing(grid.focusTo(j, true)); afterMove();
      N.pointer.scrolled();
    }
    /* ---------- A–Z-Leiste ziehen (LIB-12, nur AZD) ----------
     * Finger (Touch-Schicht App.grab/App.drag) bzw. Maus mit gedrueckter Taste (N.pointer, caps.pointer 'mouse') auf der Leiste:
     * Buchstabe unter dem Finger in der Leiste markiert (wie fokussiert) und gross in einer runden Anzeige LINKS daneben (der Finger
     * verdeckt die Leiste), die senkrecht mitlaeuft; Maus: kleinere Anzeige naeher an der Leiste. Loslassen springt (jumpTo: fehlt der
     * Buchstabe, der naechste vorhandene, sanft wie gewohnt). Keine Live-Vorschau im Raster (00-entscheidungen 03.11.). Abbruch: Finger
     * mehr als AZ_OFF px seitlich neben der Leiste (L.azAway) – Anzeige und Markierung weg, Loslassen tut nichts; zurueck gilt es wieder.
     * Zug-Zone etwas groesser als die Leiste (links 20, rechts bis zum Rand, oben/unten 16): Finger-Treffer >= 44 pt in der Breite. */
    var AZ_OFF = { touch: 120, mouse: 80 }, hap = null;
    function vpt(x) { return N.screen.flex ? x - N.screen.view().x : x; }   // Flaechen- -> Ansichts-Punkt (M/K: Inhaltskante verschoben)
    function grabAt(x, y) { return AZD && !scrub && regOn() && !(sb.on && zone === 'state') && x >= regX - 20 && y >= REG_Y - 16 && y < REG_Y + regH + 16; }
    s.pointerGrab = function (x, y) { return grabAt(vpt(x), y) ? 'drag' : ''; };
    s.pointerDrag = function (ph, x, y) {
      x = vpt(x);
      if (ph === 'start') {
        if (!grabAt(x, y)) return false;
        stopPan(); eat = false; setHov(-1);
        scrub = { mouse: N.input.mode === 'pointer', away: false, ch: '' };
        U.cls(azs, 'sm', scrub.mouse);
        hap = !scrub.mouse && N.platform.haptic ? N.platform.haptic : null;   // Tick je Buchstabe nur am Finger (caps.haptic)
        if (hap) hap.prepare();
        scrubAt(x, y);
        return true;
      }
      if (!scrub) return false;
      if (ph === 'move') { scrubAt(x, y); return true; }
      var z = scrub;
      if (ph === 'end') scrubAt(x, y);
      scrub = null; U.show(azs, false);
      if (ph === 'end' && !z.away && z.ch && regOn()) jumpTo(z.ch);
      else paintReg(true);
      return true;
    };
    function scrubAt(x, y) {
      var away = L.azAway(x, regX, 56, scrub.mouse ? AZ_OFF.mouse : AZ_OFF.touch);
      if (away) { if (!scrub.away) { scrub.away = true; U.show(azs, false); paintReg(true); } return; }
      var ch = LETTERS.charAt(L.azIndex(y - REG_Y, regDivs.length, REG_STEP, LETTERS.length)), back = scrub.away;
      scrub.away = false;
      if (ch !== scrub.ch || back) {
        if (hap && scrub.ch && ch !== scrub.ch) hap.select();   // nur beim Wechsel, nicht schon beim Auflegen
        scrub.ch = ch;
        U.setText(azsT, ch);
        U.cls(azs, 'no', L.present(chars).indexOf(ch) < 0);     // ohne Titel: gedaempft (Loslassen = naechster vorhandener)
        paintReg(true);
      }
      var d = scrub.mouse ? 56 : 96, cy = Math.max(REG_Y, Math.min(REG_Y + regH, y)), ty = Math.max(8, Math.min(A.h - d - 8, cy - d / 2));
      var tx = regX - (scrub.mouse ? 8 : 36) - d;                 // Finger verdeckt die Leiste: Anzeige links daneben
      azs.style.webkitTransform = azs.style.transform = 'translate3d(' + tx + 'px,' + Math.round(ty) + 'px,0)';
      U.show(azs, true);
    }
    s.pointerSig = function () { return grid.r; };
    s.pointerEdge = function (x, y) {
      if (FREE || n <= 0 || (sb.on && zone === 'state') || zone === 'reg' || railOpen) return null;   // frei: Rad/Trackpad statt Randzonen
      var w = G.width(), cx = G.X0 + Math.round(w / 2);
      if (x < G.X0 || x >= G.X0 + w) return null;
      if (y >= 154 && y < G.Y0 + 20 && grid.canScroll(-1)) return { d: -1, x: cx, y: 176 };
      if (y >= G.edgeB() && y < G.VIS + 24 && grid.canScroll(1)) return { d: 1, x: cx, y: G.VIS - 4 };   // TV: bis 656, Mitte 628
      return null;
    };
    /* Pfeile hoch/runter (NAV-2): fest als Paar mittig unter dem Raster ueber der Hinweisleiste (y 630; die fokussierte Zeile ist
     * immer ganz sichtbar und endet darueber), je Richtung ein fester Platz; nur wenn ihre Randzone gilt. Oben lag der Pfeil auf
     * dem Fokus-Rahmen der ersten Zeile (Nutzerentscheidung 06.11.). */
    s.pointerVert = function () {
      var cx = G.X0 + Math.round(G.width() / 2), P = N.pointer;
      return { up: P.slot(s.pointerEdge(cx, 176), cx - 36, 630), dn: P.slot(s.pointerEdge(cx, G.VIS - 4), cx + 36, 630) };
    };
    s.pointerScroll = function (d) {
      if (zone !== 'grid') toGrid();
      placeRing(grid.scrollBy(d)); afterMove();
    };
    /* ---------- freies Scrollen (caps.scroll 'free', 08-touch S7) ----------
     * Senkrechtes Wischen ueber dem Raster verschiebt die Seite frei mit Schwung, ohne Einrasten (Nr. 18), Gummiband an den Enden;
     * der Fokus bleibt (unsichtbar bei Touch). Waagerecht bzw. ueber Kopf/Chips: Zug annehmen, nichts tun (nie Fokus-Schritte, nie
     * die Seitenleiste – Nr. 22). Ein Transform je Frame (Grid.setPy), keine Layout-Abfragen. */
    function stopPan() { return drv ? drv.stop() : false; }
    function drive() {
      if (!drv) drv = new N.kinetic.Drive({ dim: G.AH - G.Y0, get: function () { return grid.curPy(); }, max: function () { return grid.maxPy(); },
        set: function (p) { if (N.idle) N.idle.touch(); grid.setPy(p); ptrScrolled(); } });
      return drv;
    }
    s.pan = function (e) {
      if (chipPan) { chipTo(chipPan.o - e.dx); if (e.phase === 'end') chipPan = null; return true; }   // Chip-Streifen folgt dem Finger
      if (e.phase === 'start') {
        if (!FREE || !N.kinetic) return false;
        if (chipMax && e.axis === 'x' && e.y >= 112 && e.y < 160) { chipPan = { o: chipOff }; return true; }
        stopPan(); eat = false; pan = null;
        if (e.axis !== 'y' || n <= 0 || zone === 'reg' || (sb.on && zone === 'state') || e.y < 152) return true;
        if (regOn() && e.x >= regX) return true;          // A–Z-Leiste
        loose = true;
        pan = { last: 0 };
        drive().grab(e.t);
        return true;
      }
      if (!pan) return true;
      var d = -(e.dy - pan.last);
      pan.last = e.dy;
      if (e.phase === 'move') { drv.move(d, e.t); return true; }
      pan = null;
      drv.up(e.t, e.cancel);
      return true;
    };
    s.pointerDown = function () { if (FREE && stopPan()) eat = true; };
    s.wheel = function (x, y, dx, dy) {
      if (!FREE || !N.kinetic || n <= 0 || zone === 'reg' || Math.abs(dy) < Math.abs(dx)) return false;
      eat = false; loose = true;
      drive().nudge(dy);
      return true;
    };
    /* An den Anfang (App.scrollTop, Tipp ganz oben / Cmd+Pfeil hoch): Raster gleitet nach oben */
    s.scrollTop = function () {
      if (!FREE || !N.kinetic || n <= 0 || zone === 'reg') return false;
      pan = null; loose = true;
      return drive().to(0);
    };
    /* erste Taste nach freiem Scrollen: Karte am Anker (Zeile oben, Spalte des Fokus), Raster zurueck ins Tastenraster */
    function reanchor() {
      stopPan(); loose = false; pan = null;
      if (!grid.free) return;
      if (zone !== 'grid') toGrid();
      placeRing(grid.fix(grid.anchorIdx()));
      afterMove();
    }
    s.relabel = function () { buildChips(); paintStatus(); };
    return s;
  });
})(N);
