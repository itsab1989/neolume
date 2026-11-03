/* Ansicht 'player' – Video-Wiedergabe mit OSD (SPEC 7.10–7.12; docs/research/player.md). Video liegt im SEF-Plugin HINTER der
 * transparenten HTML-Ebene; darueber nur kleine Inseln, ohne Ein-/Ausblend-Animation.
 * - OSD: Titel-Insel oben links, Uhrzeit/Ende oben rechts, Bedien-Insel unten (Balken, Zeiten, Kapitelname, Knopfreihe
 *   [⏮] · −x · Play/Pause · +x · [⏭] | Kapitel · Ton & UT · Mehr; Label unter dem fokussierten Knopf, SPEC 5.22). −x/+x folgen
 *   "Sprungweite Pfeiltasten & Knoepfe"; ⏮/⏭ wechseln Folge, Video der Warteschlange oder Kapitel (N.osd.pnMode), auch CH▲/CH▼.
 *   Erscheint bei jeder Taste, weg nach 5 s (Start 3 s, Pause: bleibt + Mini-Hinweisleiste). Zeit/Balken max. 1x/s, nur sichtbar.
 * - Fokus-Zonen bei sichtbarem OSD: Knoepfe (◀▶) -> ▲ Balken (◀▶ = Vorschau-Spulen, Sprung bei OK oder nach 1 s) -> ▲ Skip-Button.
 * - Spulen bei verborgenem OSD: ◀▶ / ◀◀▶▶ sammeln ein Ziel ("+2:30 → 41:12"), EIN Sprung 600 ms nach dem letzten Druck.
 * - Schnellspulen (PLAY-32, Einstellung "Vor-/Rueckspultasten im Video" = Schnell spulen): ◀◀▶▶ schalten den SEF-Trick-Modus
 *   (N.trick-Skala -16…-2 · 1 · 2…16, nur direkte Wiedergabe, ohne Ton); Pille "▶▶ 8x" in der Zeitzeile, OSD bleibt stehen, UT aus.
 *   PLAY/OK/RETURN = normal weiter; Pause, Sprung, Ziffern, Farbtasten, Stop beenden es zuerst. Umgewandelt -> Spruenge + Hinweis.
 * - Mehr (TOOLS): Qualitaet, Bildformat, Untertitel-Darstellung, Skip-Modus, Autoplay, Sleep-Timer, "Problem mit der Wiedergabe?"
 *   – gilt fuer diese Wiedergabe (auch die folgenden Folgen), Standards in Einstellungen › Wiedergabe.
 * - Gelb Kapitel, Blau Sleep-Timer, INFO Technik, Gruen/SUBTITLE Ton & UT. Zeiger: Bewegung zeigt das OSD, alles anklickbar.
 * - Finger (Eingabeart touch, SPEC PLAY-34): Tippen aufs Bild blendet die Bedienelemente ein/aus (nie Pause), Tippen auf ein
 *   Element bedient es, langer Druck tut nichts, Wischen blaettert nicht; Balken greifen und ziehen = Scrubbing (pointerDrag),
 *   Loslassen springt. Maus mit caps.pointer 'mouse' zieht ebenso; Klick aufs Bild bleibt Pause/Weiter.
 * - Finger/Maus mit caps.pointer 'mouse' (Apple Nr. 17, PLAY-34): Zurueck-Knopf oben links (Insel in der Titel-Ebene, blendet mit
 *   dem OSD; Tippen = Wiedergabe beenden wie RETURN bei verborgenem OSD), kein Fokus an Knoepfen/Balken/Skip; die erste Taste
 *   zeigt den Fokus wieder (Eingabeart N.input.mode, Klasse pl-dir nur beim Wechsel). Bild in Bild (caps.pip, PLAY-35): Knopf
 *   in der Leiste, Ereignis 100 des Players meldet die Darstellungsart. Fokus und Bedien-Label blenden mit der Huelle aus (der
 *   Fokus bleibt waehrend der Blende stehen und wird erst danach zurueckgesetzt).
 * N.player.play(item, how) ist der Einstieg (Fortsetzen-Frage nach Einstellung). */
(function (N) {
  var U = N.util, F = N.fmt, O = N.osd, BAR_X = 96, BAR_W = 1088, BAR_Y = O.BAR_Y, OSD_MS = 4000, START_MS = 3000, MH_Y = 648, MH_H = 36, SKIP_Y = 398;
  function hms(ms) {
    var s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
    return (h ? h + ':' + U.pad2(m) : m) + ':' + U.pad2(s % 60);
  }
  N.fmt.hms = hms;
  /* Restzeit passend zur abgelaufenen: beide auf ganze Sekunden abgerundet, zusammen = Laenge (sonst z. B. 0:01 + -0:01 bei 0:01,5 von 0:02,4) */
  function left(pos, d) { return hms((Math.floor(d / 1000) - Math.floor(Math.max(0, pos) / 1000)) * 1000); }
  N.fmt.left = left;
  function cfg() { return N.session.settings || {}; }
  function arrows() { return O.steps(cfg().seekArrows, 10); }   // Pfeile + Knoepfe −x/+x (Sekunden {b, f})
  function ffrw() { return O.steps(cfg().seekFf, 30); }          // Spultasten
  var status = null;                                     // P5: Zustand fuer den Bildschirmschoner (N.player.status)

  N.router.define('player', function (params) {
    var s = { rail: null, wheelKeys: ['LEFT', 'RIGHT'], toastHigh: true, news: 'player', touchLong: false, panelFull: true };   // panelFull: Panels ueber die ganze Hoehe (nur flexible Flaeche, Nr. 17)   // news: HOME-13 an der Stelle der Toasts, nur mit newsPlay und ruhigem Bild   // Toasts oben links (NAV-10), nie ueber der Bedien-Insel
    var root, vbg, osdW, top, t1, t2, clk, bot, played, head, segs, cgs, tm0, tm1, skl, chn, spin, spinT, thumb, thImg, thT, skip, skipT, up, upImg, upTi, upIn, upBar, upBtns = [], sub, subT, sb, sbBg;
    var btnEl = {}, ppIc = null, numB = null, numF = null, lbl, lblT, mh, mhItems = [], mhRects = null;
    var pb = null, sef = null, mk = null, acc = null, item = null, osd = false, osdT = 0, lastSec = -1, queue = null, qTask = null, upF = 0, cdOn = false, skipM = null, btnKind = null;
    var closed = false, cues = null, cueI = -1, subClr = 0, thumbOn = false, thLast = -1, thT0 = 0, thFail = 0, bif = null, bifRaw = null, info = null, onFlush = null, trackMem = null, errOn = false, slow = 0;
    // Fokus im OSD: zone 'btn' | 'bar' | 'skip'; quick = Balken per ◀▶ bei verborgenem OSD (Sammelfenster 600 ms, sonst 1 s)
    // ids = bedienbare Knoepfe (Fokus/Zeiger), vis = sichtbare (gesperrte ⏮/⏭ gedimmt), pn = Modus von ⏮/⏭ ('ep'|'chap'|'item'|'')
    var zone = 'btn', fb = 'pp', ids = ['back', 'pp', 'fwd', 'tracks', 'more'], vis = ids, pn = '', pnSt = { prev: false, next: false }, quick = false, chs = [], chI = -2, hov = false;
    // Wiedergabe-Sitzung (Mehr-Menue, gilt bis zum Schliessen des Players, auch fuer folgende Folgen); pcfg = Einstellungen + sess
    var sess = {}, pcfg = null, sleep = { mode: 'off', at: 0, t: 0, w: 0 };
    // Karte "Das war die letzte Folge" (lastOn, Knopf-Fokus lastF), "Schaust du noch?" (still, stillOn)
    var last, lastBtns = [], lastOn = false, lastF = 0, still = null, stillOn = false;
    // Karte am echten Dateiende (PLAY-18): Rueckzaehler endN (s), Zeitgeber endT, Balken lastBar; endHold = Erweiterung hat einen
    // Dialog offen (Zaehler steht); lastCustom = Erweiterung hat Knopf 0 belegt (dann Knopf 1 = "Zurueck in n Sek.")
    var calmAt = 0;                                       // HOME-13: seit wann laeuft das Video ruhig (0 = nicht)
    var lastEnd = false, endN = 0, endT = 0, endHold = false, lastCustom = false, lastBar = null, lastB1 = null;
    // P5: "Geringere Qualitaet?" beim Puffern (bw, lowT, offerT), Zurueckspulen nach langer Pause (pausedAt),
    // "Verbindung unterbrochen" (lost = {at}, Insel lostEl mit 2 Knoepfen, lostT = Wiederholungs-Takt)
    var bw = null, lowT = 0, offerT = 0, pausedAt = 0, prevSt = '', lost = null, lostEl, lostBtns = [], lostF = 0, lostT = 0, onOff = null, onOn = null;
    // Feinauswahl am Balken (N.Loupe + N.ui.LoupeView, SPEC PLAY-30/31): lp Logik, lpv Darstellung, lpPend/lpRaf Zeichnen je Frame,
    // lpS wirksame Darstellung (panel|stretch|film), lpTab Lasche (A/D) als Rechteck, lpBand Band in dem sie offen bleibt
    var lp = null, lpv = null, lpPend = null, lpRaf = false, lpS = 'panel', lpTab = null, lpBand = null;
    // Ziehen am Balken (Finger/Maus, s.pointerDrag): drg = {x, y} letzter Punkt (null = kein Zug), drgRaf = ein Zeichnen je Frame
    var drg = null, drgRaf = false;
    // Finger/Maus (caps.pointer 'mouse'): bk Zurueck-Knopf, dir = Klasse pl-dir gesetzt (kein Fokus, Zurueck sichtbar);
    // Bild in Bild (caps.pip): pipOn = Video im System-Fenster, pipOk = Bild lief schon (vorher kann das System kein Fenster
    // oeffnen – Knopf gedimmt, Tippen erklaert es; iPad 02.11.: Knopf "tat nichts", weil das Video noch lud). Blende: fadeB/fadeBar = Fokus, der waehrend des Ausblendens
    // stehen bleibt, fadeT raeumt ihn nach der Blende ab (mo.out 250 ms); lblIn = Label liegt in der Huelle (blendet mit)
    /* Schmaler Player (nur flexible Flaeche, Apple Nr. 17; 10-screens.md 7): K·N (iPhone hoch) und M·N (iPad hoch) – Video 16:9 ueber
     * die volle Breite, Bedienung darunter bzw. am unteren Rand (Lagen: N.osd.narrow). Die Ansicht steht dann nicht im verkleinerten
     * Kasten, sondern 1:1 in der Flaeche (Klasse pl-nar, flex.css); Zeiger-Punkte sind Flaechen-Punkte. Wechselt beim Drehen ohne
     * Neuaufbau (screen:resized -> nar()). G = wirksame Lagen; am TV und breit die TV-Werte TVG (unveraendert wie bisher). */
    var TVG = { ISX: O.ISL_X, ISY: O.ISL_Y, ISH: O.ISL_H, ISW: 1152, BAR_X: BAR_X, BAR_W: BAR_W, BAR_Y: BAR_Y, MH_Y: MH_Y, SKIP_Y: SKIP_Y,
      SKX0: 856, SKX1: 1216, CX: 640, UPX: 816, LOX: 400, LOY: 248, TX: 64, TY: 36, osd: null };
    var G = TVG, NG = null, onRsz = null, trEl = null, tiEl = null, segM = null;
    var bk = null, dir = false, pipOn = false, pipOk = false, pipIc = null, fadeB = null, fadeBar = false, fadeT = 0, lblIn = false, FADE_MS = 300;
    var clkT = 0, trk, trkIc, trkT, hintT = 0, trickHinted = false, lastPaint = 0, ffrwAt = 0, FFRW_GAP = 250;   // Schnellspulen: Pille, Hinweis im Label-Feld (einmal je Video)
    var lblW = {}, lblM = null, lblMT = null;            // Runde 6: Label-Breite je Text (lblWidth), Mess-Zwilling (lblWarm)
    var xt = null, upOv = null, lastTi = null, lastTx = null, lastB0 = null, offerTm = 0;   // optionale Erweiterung (N.ext 'player:open')
    /* Schnittstelle fuer eine Erweiterung: Hinweis-Insel (wie "Intro ueberspringen", nur wenn keine andere da ist), Karte
     * "letzte Folge" umbeschriften, Ueberzeile der Naechste-Folge-Karte, Folge hinter die aktuelle in die Play-Queue setzen */
    var PX = {
      item: function () { return item; }, queue: function () { return queue; }, hasNext: function () { return hasNext(); }, dur: function () { return dur(); },
      offer: function (text, ms) {
        if (btnKind || closed || cdOn || lastOn || stillOn) return false;   // nie zusammen mit einer anderen Insel oder Karte
        btnKind = 'ext'; skipM = null; U.setText(skipT, text); U.show(skip, true);
        if (offerTm) clearTimeout(offerTm);
        offerTm = setTimeout(function () { offerTm = 0; if (btnKind === 'ext') hideSkip(); }, ms || 15000);
        return true;
      },
      hideOffer: function () { if (btnKind === 'ext') hideSkip(); },
      setLast: function (title, text, b0) {
        lastCustom = !!b0;
        U.setText(lastTi, title || N.t('pl.last.title')); U.setText(lastTx, text || N.t('pl.last.text')); U.setText(lastB0, b0 || N.t('pl.last.toShow'));
        if (lastEnd) endPaint();
      },
      /* Erweiterung oeffnet/schliesst einen Dialog: der Rueckzaehler am Ende steht so lange; danach (am Ende) gleich weiter */
      hold: function (on) {
        endHold = !!on;
        if (lastBar) U.show(lastBar.parentNode, !endHold && lastEnd);
        if (!endHold && lastEnd) endLeave();
      },
      /* naechste Folge ist (am Ende) gerade in die Play-Queue gekommen (Erweiterung meldet es) -> abspielen statt zurueck */
      arrived: function () { if (lastEnd && !endHold) endLeave(); },
      ended: function () { return lastEnd; },
      setUpOver: function (text) { if (upOv) U.setText(upOv, text || N.t('pl.next.over')); },
      /* rk ans Ende der aktuellen Folge der Play-Queue (PMS PUT /playQueues/<id>?uri=…&next=1); cb(ok) */
      addNext: function (rk, cb) {
        var mid = isrv() || N.session.state.server && N.session.state.server.machineId;
        if (!queue || !mid || closed) { cb(false); return; }
        N.plex.pms('PUT', '/playQueues/' + queue.id, { uri: 'server://' + mid + '/com.plexapp.plugins.library/library/metadata/' + rk, next: 1 }, N.srv.o(isrv(), { retries: 0, dedupe: false }), function (err, d) {
          var mc = !err && d && d.MediaContainer;
          if (!mc || !mc.Metadata || closed) { cb(false); return; }
          var items = [], cur = queue.idx;
          for (var i = 0; i < mc.Metadata.length; i++) { var x = mc.Metadata[i], it = N.model.norm(x); it.pqi = x.playQueueItemID; if (item && it.rk === item.rk) cur = i; items.push(it); }
          queue = { id: mc.playQueueID || queue.id, items: items, idx: cur };
          updBtns(); cb(true);
        });
      }
    };

    /* ---------- Aufbau ---------- */
    s.create = function (el) {
      root = el; U.cls(root, 'pl', true);
      vbg = U.el('div', 'pl-vbg', root, 'display:none');               // nur Vorschau: Platzhalter fuer das Video
      sub = U.el('div', 'pl-sub', root, 'display:none'); subT = U.txt('span', '', sub, '');
      // Weiche Blende (Nutzerwunsch 30.10.): leere, dauerhafte Huelle .pl-osdw blendet (Regel Runde 8 wie #pn-news), Titel- und
      // Bedien-Insel darin sind eigene Ebenen und bleiben nach dem ersten Zeigen stehen (Regel Runde 6: kein display im Tastenpfad)
      osdW = U.el('div', 'pl-osdw', root);
      top = U.el('div', 'pl-top', osdW, 'display:none');
      var ti = tiEl = U.el('div', 'pl-isl pl-ti', top);
      t1 = U.txt('div', 'pl-t1 ell', ti, ''); t2 = U.txt('div', 'pl-t2 ell', ti, '');
      clk = U.txt('div', 'pl-isl pl-clk', top, '');
      if (N.platform.caps.pointer === 'mouse') {                     // Finger/Maus: Zurueck oben links (am TV nie angelegt)
        bk = U.el('div', 'pl-isl pl-bk', top); N.ui.icon(bk, 'ret', 's2');
        bk.setAttribute('role', 'button'); bk.setAttribute('aria-label', N.t('pl.btn.exit'));
      }
      bot = U.el('div', 'pl-isl pl-bot', osdW, 'display:none');
      var tr = trEl = U.el('div', 'pl-tr', bot);                                // Runde 8 (Huellen) am TV schlechter -> wie Runde 7
      segs = U.el('div', 'pl-segs', tr);
      played = U.el('div', 'pl-pl', tr);
      cgs = U.el('div', 'pl-cg', tr);
      head = U.el('div', 'pl-hd', bot);
      tm0 = U.txt('div', 'pl-tm0', bot, ''); tm1 = U.txt('div', 'pl-tm1', bot, '');
      skl = U.txt('div', 'pl-skl', bot, '');
      chn = U.txt('div', 'pl-chn ell', bot, '');
      trk = U.el('div', 'pl-trk', bot, 'visibility:hidden');                // Schnellspulen: Pille mittig in der Zeitzeile (Platz des Sprungziels)
      var tp = U.el('span', '', trk); trkIc = N.ui.icon(tp, 'ff', 's3'); trkT = U.txt('b', '', tp, '');
      mh = U.el('div', 'pl-isl pl-mh', root, 'display:none');           // Mini-Hinweisleiste in der Pause (SPEC 7.10): eigene Insel unter der Bedien-Insel
      for (var i = 0; i < 4; i++) {
        var e = { root: U.el('span', 'hint', mh) };
        e.k = U.el('span', 'k', e.root); e.kT = document.createTextNode(''); e.k.appendChild(e.kT);
        e.lb = document.createTextNode(''); e.root.appendChild(e.lb);
        mhItems.push(e);
      }
      for (i = 0; i < O.BTNS.length; i++) {
        if (O.BTNS[i].id === 'pip' && !N.platform.caps.pip) continue;   // Bild in Bild nur, wo die Plattform es kann (am TV nie)
        var b = O.BTNS[i], be = U.el('div', 'pl-b' + (b.w > 48 ? ' lg' : ''), bot, 'left:' + b.x + 'px;top:' + b.y + 'px');   // Groesse per CSS (.pl-b / .pl-b.lg)
        if (b.id === 'back' || b.id === 'fwd') { var nm = U.txt('div', 'num', be, ''); if (b.id === 'back') numB = nm; else numF = nm; }
        // Bild-in-Bild-Symbol per CSS (.pl-pip): eine neue Sprite-Spalte wuerde das Zustands-Symbol am TV stauchen (.stb .big 896 px)
        else if (b.id === 'pip') { pipIc = U.el('div', 'pl-pip', be); U.el('i', '', pipIc); U.cls(be, 'off', true); }
        else { var ic = N.ui.icon(be, { pp: 'pause', prev: 'prev', next: 'next', chap: 'chapters', tracks: 'audio', more: 'more' }[b.id]); if (b.id === 'pp') ppIc = ic; }
        btnEl[b.id] = be;
      }
      // Label: am TV wie bisher eigenes Element (Runde 6); mit Finger/Maus in der Huelle, damit es mit Fokus und Leiste ausblendet
      lblIn = !!bk;
      lbl = U.el('div', 'pl-lbl', lblIn ? osdW : root, 'display:none'); lblT = U.txt('span', '', lbl, '');
      lblM = U.el('div', 'pl-lbl', root, 'visibility:hidden'); lblMT = U.txt('span', '', lblM, '');   // Runde 6: misst Label-Breiten in Ruhe
      thumb = U.el('div', 'pl-th', root, 'display:none');
      thImg = U.el('img', '', thumb); thImg.src = N.img.BLANK;
      thT = U.txt('div', 'pl-tht', thumb, '');
      lpv = new N.ui.LoupeView({ parent: root, ox: 0, oy: 0, barTop: G.BAR_Y - 5, barH: 10, barX: G.BAR_X, barW: G.BAR_W,
        islY: G.ISY, islX: G.ISX, islW: G.ISW });
      // Runde 5: Feinauswahl-Behaelter in Ruhe vorab anlegen (nur mit Zeiger + Einstellung; Darstellung wie beim Oeffnen gewaehlt)
      N.idle.add(function () {
        if (closed || !lpv || eff('ptrLoupe') !== true || !N.pointer.enabled()) return;
        var st = N.Loupe.style(eff('loupeStyle'), { thumbs: true });
        lpv.prep(st);
        if (st === 'film') lpv.prep('panel');                 // ohne Vorschaubilder wird es die Lasche A
      }, 'lp-prep');
      spin = U.el('div', 'pl-spin', root, 'display:none');
      U.el('div', 'spinner', spin, 'left:180px;top:16px');
      spinT = U.txt('div', 'pl-spt', spin, '');
      skip = U.el('div', 'pl-skip', root, 'display:none'); skipT = document.createTextNode(''); skip.appendChild(skipT);
      U.txt('span', 'kc', skip, 'OK');
      up = U.el('div', 'pl-up', root, 'display:none');
      upImg = U.el('img', '', up); upImg.src = N.img.BLANK;
      upBar = U.el('i', '', U.el('div', 'pl-upbar', up));
      upOv = U.txt('div', 'pl-upov', up, N.t('pl.next.over'));
      upTi = U.txt('div', 'pl-upti', up, ''); upIn = U.txt('div', 'pl-upin', up, '');
      for (i = 0; i < 2; i++) { var ub = U.el('div', 'btn pl-upb', up, 'left:' + (16 + i * 192) + 'px'); ub.appendChild(document.createTextNode(N.t(i ? 'pl.next.watchCredits' : 'pl.next.now'))); upBtns.push(ub); }
      last = U.el('div', 'pl-up pl-last', root, 'display:none');
      lastTi = U.txt('div', 'pl-lastti', last, N.t('pl.last.title'));
      lastTx = U.txt('div', 'pl-lastx', last, N.t('pl.last.text'));
      for (i = 0; i < 2; i++) { var lb = U.el('div', 'btn pl-upb', last, 'left:' + (16 + i * 192) + 'px'), lt = document.createTextNode(N.t(i ? 'pl.next.watchCredits' : 'pl.last.toShow')); lb.appendChild(lt); lastBtns.push(lb); if (!i) lastB0 = lt; else lastB1 = lt; }
      lastBar = U.el('i', '', U.el('div', 'pl-upbar pl-lastbar', last, 'display:none'));
      if (N.ext.has('player:open')) xt = N.ext.call('player:open', PX) || null;
      lostEl = U.el('div', 'pl-isl pl-lost', root, 'display:none');
      U.txt('div', 'pl-lostti', lostEl, N.t('err.connLost.title'));
      U.txt('div', 'pl-lostx', lostEl, N.t('err.connLost.text'));
      for (i = 0; i < 2; i++) { var lo = U.el('div', 'btn pl-upb', lostEl, 'left:' + (24 + i * 192) + 'px'); lo.appendChild(document.createTextNode(N.t(i ? 'err.btn.exit' : 'err.btn.retry'))); lostBtns.push(lo); }
      sbBg = U.el('div', 'pl-errbg', root, 'display:none');
      sb = new N.ui.StateBlock(root);
      acc = new N.SeekAcc(commitSeek, { now: U.now, set: function (f, ms) { return setTimeout(f, ms); }, clear: function (t) { clearTimeout(t); } }, N.config.seekDelay || 600);
      lp = new N.Loupe({ timers: { now: U.now, set: function (f, ms) { return setTimeout(f, ms); }, clear: function (t) { clearTimeout(t); } },
        ok: lpOk, live: ptrLive, pos: function () { return ptLow(); }, open: lpOpen });
      onFlush = function (why) { if (why !== 'background') exitSync(); };   // Apple: Hintergrund (Bild in Bild) ist kein Beenden
      N.evt.on('app:flush', onFlush);
      onOff = function () { if (pb && !closed && !isrv() && !errOn && (pb.state === 'playing' || pb.state === 'paused' || pb.state === 'buffering')) connLost(); };
      onOn = function () { if (lost) resumeLost(); };
      N.evt.on('net:offline', onOff); N.evt.on('net:online', onOn);
      if (N.screen && N.screen.flex) { onRsz = function () { if (!closed) nar(); }; N.evt.on('screen:resized', onRsz); nar(); }
      // calm/since (HOME-13): nur Bild – kein OSD, keine Insel/Karte, kein Laden, kein Spulen, kein Menue; since = ms seit ruhigem Laufen (Start/Sprung)
      status = function () { return { active: !!pb && !closed && !errOn, paused: !!lost || !!(pb && pb.state === 'paused'), item: item, calm: calm(), since: calmAt ? U.now() - calmAt : 0 }; };
    };

    /* Schmaler Player an/aus (nur flexible Flaeche): Lagen aller Inseln inline (aus), Video-Feld fuer die Plattform (N.screen.video,
     * Apple-Lader legt das <video> hinein), Balken-Marken neu (Breite) */
    function nar() {
      var S = N.screen, c = S.cls, on = S.flex && !errOn && c.h === 'N' && (c.w === 'K' || c.w === 'M'), g, k;
      NG = on ? O.narrow(S.w, S.h, c.w === 'M') : null; G = NG || TVG; g = NG;
      U.cls(root, 'pl-nar', on);
      function px(v) { return on ? v + 'px' : ''; }
      function at(e, x, y, w, h) { var st = e.style; st.left = px(x); if (y !== null) st.top = px(y); if (w !== undefined) st.width = px(w); if (h !== undefined) st.height = px(h); }
      at(top, on && g.TX, on && g.TY, on && g.TW, on && 152);
      tiEl.style.left = px(0); tiEl.style.top = px(80); tiEl.style.maxWidth = px(on && g.TW);
      at(bot, on && g.ISX, on && g.ISY, on && g.ISW, on && g.ISH);
      trEl.style.width = px(on && g.BAR_W);
      var sw = on ? Math.min(500, g.ISW - 200) : 0;
      at(skl.parentNode, on && Math.round((g.ISW - sw) / 2), on && 41, sw); at(trk, on && Math.round((g.ISW - sw) / 2), on && 42, sw);
      at(chn.parentNode, on && 32, on && g.CHN_Y, on && g.ISW - 64);
      btnPos();
      lbl.style.top = px(on && g.LBL_Y);
      mh.style.top = px(on && g.MH_Y); mh.style.right = px(on && 24);
      skip.style.top = px(on && g.SKIP_Y); skip.style.right = px(on && 24);
      at(up, on && g.UPX, on && g.CBY - 168); at(last, on && g.UPX, on && g.CBY - 120);
      at(spin, on && Math.round((g.W - 400) / 2), on && g.VY + Math.round((g.VH - 112) / 2));
      at(lostEl, on && g.LOX, on && g.LOY);
      at(sub, on && 24, null, on && g.W - 48); sub.style.bottom = px(on && g.H - g.VY - g.VH + 12);
      thumb.style.top = '';
      at(vbg, on && 0, on && g.VY, on && g.VW, on && g.VH);   // Vorschau/Messlauf: Platzhalter im Video-Feld
      S.video = on ? { x: 0, y: g.VY, w: g.VW, h: g.VH } : null;
      if (sef && sef.relayout) sef.relayout();
      if (segM) buildSegs(segM);
      if (pb) paint(pb.t);
      setLabel();
    }

    /* ---------- Lebenszyklus ---------- */
    s.enter = function (p, restore) {
      if (pb || closed) return;                      // Rueckkehr aus einem Overlay o. ae.
      sef = N.platform.player.create(function (type, data) { if (type === 100) presented(data); else if (pb) pb.onEvent(type, data); });
      // Hintergrund durchsichtig: nur bei player.surface 'plane' (Video hinter der Seite, Orsay) noetig
      if (sef.fake) { U.show(vbg, true); if (N.config.fakeBg) vbg.style.background = N.config.fakeBg; } else transparent(true);   // Bildtest: heller Film
      U.cls(document.body, 'in-player', true);
      N.tv.saver(false);
      trackMem = N.store.get(memFile()) || {};
      still = new O.Still(cfg().stillWatching, U.now(), cfg().stillTime);
      if (p.queue) queue = p.queue;                  // "Alle abspielen"/"Zufall" aus der Bibliothek (M3b): fertige Play-Queue
      play(p.it, p.off || 0, p.queue ? p.it : null);
      var sd = cfg().sleepDefault;                                   // P5: Sleep-Timer-Standard
      if (sd && sd !== 'off') setSleep(sd === 'end' ? 'end' : Number(sd));
    };
    function memFile() { return 'tracks-' + (N.session.profile ? N.session.profile.uuid : 'x') + '.json'; }
    function transparent(on) {
      var v = on ? 'transparent' : '';
      document.body.style.background = v; document.documentElement.style.background = v;
    }
    s.leave = function () { return null; };
    s.destroy = function () {
      if (!closed) shutdown();
      N.evt.off('app:flush', onFlush); N.evt.off('net:offline', onOff); N.evt.off('net:online', onOn);
      if (onRsz) N.evt.off('screen:resized', onRsz);
      if (N.screen && N.screen.video) N.screen.video = null;   // Video-Feld des schmalen Players freigeben
      status = null;
    };
    function shutdown() {
      closed = true;
      if (offerTm) { clearTimeout(offerTm); offerTm = 0; }
      if (endT) { clearTimeout(endT); endT = 0; }
      if (hintT) { clearTimeout(hintT); hintT = 0; }
      if (xt && xt.close) xt.close();
      acc.cancel(); lp.leave(); lpEnd();
      setSleep('off', true);
      // Startseite: bis zur Schwelle gesehen/zu Ende -> Titel verlaesst Weiterschauen zu Recht (kein Warten auf ihn, home.js)
      var fin = !!pb && (pb.state === 'ended' || (pb.dur() > 0 && pb.t / pb.dur() >= (N.config.watchedThreshold || 0.9)));
      // Stelle des Stopps merken (N.player.play): kommt die Seite schneller zurueck als der Server die Position verarbeitet hat
      lastStop = item && item.rk && pb && !N.config.readOnly ? { rk: String(item.rk), srv: item.srv || '', off: fin ? 0 : Math.floor(pb.t || 0), at: U.now() } : null;
      if (pb) { pb.stop('user'); pb = null; }
      if (qTask) { qTask.abort(); qTask = null; }
      if (osdT) clearTimeout(osdT);
      if (clkT) { clearTimeout(clkT); clkT = 0; }
      clearLow(); if (lostT) { clearTimeout(lostT); lostT = 0; } lost = null;
      N.platform.player.close();
      transparent(false);
      U.cls(document.body, 'in-player', false);
      N.tv.saver(true);
      N.evt.emit('playback:stopped', { rk: item ? item.rk : '', video: true, done: fin, srv: item && item.srv || '', ep: item && item.type === 'episode' ? { s: item.s, e: item.e, show: item.showRk || '' } : null });
    }
    function close() { if (closed) return; shutdown(); N.router.back(); }
    /* EXIT/onunload: Abschluss-Anfragen synchron (async XHR wuerde mit der App sterben) */
    function exitSync() {
      if (!pb || N.config.readOnly) return;
      var urls = pb.exitUrls();
      for (var i = 0; i < urls.length; i++) { try { var x = new XMLHttpRequest(); x.open('GET', urls[i], false); x.send(null); } catch (e) {} }
      pb.dead = true;
    }
    function libsOf() { var hc = N.session.homeCache(); return hc && (hc.alibs || hc.libs) || []; }
    /* Weitere Server (N.srv): Titel eines fremden Servers -> Decision, Datei, Timeline, Untertitel, Vorschaubilder, Play-Queue
     * und Verbindungspruefung gehen an DIESEN Server (item.srv); der eigene Server bleibt unberuehrt */
    function isrv() { return item && item.srv || ''; }
    function conn() { var sv = isrv(); return sv ? N.srv.conn(sv) || { base: '', token: '' } : { base: N.plex.base, token: N.plex.token }; }
    function ping(cb) { if (isrv()) N.srv.ping(isrv(), cb); else N.net.ping(cb); }
    function mkey(k) { return N.srv.skey(isrv(), k); }
    /* Einstellungen + Sitzungs-Werte aus dem Mehr-Menue */
    function eff(k) { return sess[k] !== undefined ? sess[k] : cfg()[k]; }

    /* ---------- Wiedergabe ---------- */
    function play(it, off, q) {
      lpEnd();
      item = it; cues = null; cueI = -1; showSub(''); hideSkip(); hideUp(); hideLast();
      if (xt && xt.item) xt.item(it); bif = null; thFail = 0; slow = 0; chs = []; chI = -2; trickHinted = false; U.vis(trk, false);
      if (errOn) { errOn = false; if (onRsz) nar(); }   // nach einem Fehler: schmale Anordnung wieder an
      clearLow(); bw = new N.comfort.BufWatch(U.now()); pausedAt = 0; prevSt = ''; hideLost();
      sb.hide(); U.show(sbBg, false);
      U.setText(t1, it.type === 'episode' ? it.title : ''); U.setText(t2, it.type === 'episode' ? N.t('pl.epTitle', { s: it.s, e: it.e, t: it.epTitle || '' }) : it.title);
      pcfg = U.extend(U.extend({}, cfg()), sess);
      subLook();
      var cn = conn(), sv = isrv();
      if (sv && !cn.base) {                              // Weitere Server: Adresse erst pruefen (frisch gestartet oder ausgefallen)
        showSpin(N.t('common.loading'));
        N.srv.resolve(sv, false, function (st) { if (closed || item !== it) return; if (st === 'ok' && N.srv.conn(sv)) play(it, off, q); else onError({ kind: 'server' }); });
        return;
      }
      pipReady(false);                                   // neue Wiedergabe: Bild in Bild erst wieder mit dem ersten Bild
      pb = new N.Playback({
        sef: sef, base: cn.base, token: cn.token, clientId: N.plex.clientId, threshold: N.config.watchedThreshold,
        // uebers Internet: Weitere Server (immer, am TV ohne Direct Play) bzw. eigener Server unterwegs (N.plexConn, nur tls12);
        // Mobilfunk nur auf Geraeten mit Mobilfunk (caps.cellular, Zeile "Qualitaet ueber Mobilfunk")
        wan: !!sv || N.plexConn.wan(), wanDirect: !sv, cell: !!N.platform.caps.cellular && N.plexConn.cell(),
        timers: { now: U.now, set: function (f, ms) { return setTimeout(f, ms); }, clear: function (t) { clearTimeout(t); } },
        cfg: pcfg, mem: function (k) { return trackMem[mkey(k || 'm' + it.rk)] || null; },   // Film: Spurwahl aus den Details (M3b)
        // Anime je Titel (N.anime): Bibliothek "Anime" + Signale aus dem Cache + japanische Spur der Datei; Erkennung "aus" -> nie
        isAnime: function (m, ja) { return N.anime.rulesOn() && N.anime.is({ type: m.type, rk: m.rk, showRk: m.showRk, lib: m.lib, srv: sv || undefined, kind: (sv ? it.kind : N.hubs.libKinds(libsOf())[m.lib]) || '' }, { ja: ja }); },
        get: function (path, qq, o, cb) { return N.plex.get(path, qq, N.srv.o(sv, o), cb); },
        write: function (m, path, qq, cb) { return N.plex.write(m, path, qq, function (e, d) { cb(e, d); }, N.srv.who(sv) || undefined); }
      }, { rk: it.rk, off: off, pqi: q ? q.pqi : null, pqId: queue ? queue.id : null });
      if (sess.forced) pb.att = { dp: false, ds: false };
      var me = pb;
      pb.on(function (ev, d) { if (me === pb) onPb(ev, d); });   // spaete Ereignisse einer beendeten Wiedergabe verwerfen
      showSpin(N.t('common.loading'));
      updBtns();
      showOsd(START_MS);
      // Anime-Wiedergaberegeln an: Einordnung vorher sicherstellen (meist schon aus Details/Hero im Cache; sonst eine kurze Anfrage)
      if (N.anime.rulesOn() && N.anime.relevant(it)) N.anime.ensure(it, function () { if (me === pb && !closed) pb.start(); });
      else pb.start();
    }
    function onPb(ev, d) {
      if (closed) return;
      switch (ev) {
        case 'meta': onMeta(d); break;
        case 'decision': info = d; if (d.mode !== 'direct') showSpin(N.t('pl.preparing')); break;
        case 'state': onState(d); break;
        case 'time': onTime(d); break;
        case 'buffer': if (pb.state === 'buffering') showSpin(N.t('pl.loadingPct', { n: d })); break;
        case 'sub': showSub(d); break;
        case 'subs': loadSidecar(d); break;
        case 'ended': onEnded(); break;
        case 'error': onError(d); break;
        case 'fallback': N.diag.log('warn', 'Player Rueckfall von ' + d); break;
        case 'terminated': close(); N.ui.toast.show(N.t('pl.terminated')); break;   // erst schliessen: Toast an der Stelle des Bildschirms dahinter
        case 'speed': trickUi(d); break;
      }
    }
    function onMeta(m) {
      if (m.type === 'episode') { U.setText(t1, m.show); U.setText(t2, N.t('pl.epTitle', { s: m.s, e: m.e, t: m.title })); }
      else { U.setText(t1, ''); U.setText(t2, m.title); }
      U.cls(top.firstChild, 'one', m.type !== 'episode');           // Film: Titel mittig in der Insel
      mk = new N.Markers(m.parts > 1 ? [] : m.markers, { intro: eff('skipIntro'), credits: eff('skipCredits'), autoNext: !!eff('autoNext'), cd: Number(eff('countdown')) || 10 });
      chs = m.chapters || [];
      segM = m; buildSegs(m);
      thumbOn = eff('thumbs') !== false && N.thumbs.has(m.part);
      if (m.type === 'episode' && !queue) makeQueue(m);       // auch ohne Autoplay: ⏮/⏭ brauchen die Folgen davor und danach
      if (queue) for (var i = 0; i < queue.items.length; i++) if (queue.items[i].rk === m.rk) queue.idx = i;
      updBtns();
    }
    function buildSegs(m) {
      while (segs.firstChild) segs.removeChild(segs.firstChild);
      while (cgs.firstChild) cgs.removeChild(cgs.firstChild);
      if (!m.dur) return;
      for (var i = 0; i < m.markers.length; i++) {
        var x = m.markers[i], a = Math.round(G.BAR_W * x.startTimeOffset / m.dur), b = Math.round(G.BAR_W * x.endTimeOffset / m.dur);
        if (b > a) U.el('i', '', segs, 'left:' + a + 'px;width:' + (b - a) + 'px');
      }
      for (i = 1; i < chs.length; i++) U.el('i', '', cgs, 'left:' + (Math.round(G.BAR_W * chs[i].start / m.dur) - 1) + 'px');   // Kapitelgrenzen = 3-px-Luecken
    }
    /* F23: Spruenge und (Wieder-)Start melden -> Nachladen kurz danach zaehlt nicht fuer "Geringere Qualitaet?" */
    function seekPb(ms) { if (bw) bw.mark(U.now()); if (calmAt) calmAt = U.now(); pb.seek(ms); }
    function calm() {
      return !!pb && !closed && !errOn && !lost && pb.state === 'playing' && !trickOn() && !osd && !btnKind && !cdOn && !lastOn && !lastEnd && !stillOn &&
        up.style.display === 'none' && spin.style.display === 'none' && !(lp && lp.isOpen()) && !N.router.hasOverlay();
    }
    function onState(st) {
      var was = prevSt; prevSt = st;
      pauseClock(st === 'paused');
      if (st !== 'playing') calmAt = 0; else if (was !== 'playing') calmAt = U.now();   // HOME-13: Ruhe seit Start/Fortsetzen/Nachladen
      if (st === 'playing') {
        hideSpin(); N.tv.saver(false); pipReady(true);
        if (was !== 'playing' && was !== 'buffering' && bw) bw.mark(U.now());   // Start, Fortsetzen nach Pause
        if (was === 'paused' && pausedAt) {                        // P5: nach langer Pause etwas zurueck (Zurueckspulen beim Fortsetzen)
          var rw = N.comfort.pauseRewind(U.now() - pausedAt, eff('resumeRewind'));
          if (rw && pb) { seekPb(pb.t - rw); N.ui.toast.show(N.t('pl.toast.rewound', { n: rw / 1000 })); }
        }
        pausedAt = 0;
      }
      else if (st === 'paused') { showOsd(0); N.tv.saver(true); pausedAt = U.now(); }
      else if (st === 'buffering' || st === 'resolving') {
        if (st === 'buffering' && was === 'playing' && bw && bw.stall(U.now())) offerLower();   // P5: wiederholtes Nachladen
        if (!spin.style.display) return; showSpin(N.t('common.loading'));
      }
      paused();
      N.router.refreshHints();
    }
    /* Pause: Uhr und "Ende um" laufen weiter (TV-Test 29.10.: standen still). Ohne Zeit-Ereignisse des SEF einmal je Minute
     * (auf die Minutengrenze ausgerichtet) neu zeichnen – "Ende um" = jetzt + Restzeit. Billig: ein Timer, zwei Texte. */
    function pauseClock(on) {
      if (clkT) { clearTimeout(clkT); clkT = 0; }
      if (!on || closed) return;
      clkT = setTimeout(function () { clkT = 0; if (!closed && pb && pb.state === 'paused') { paintClk(pb.t, dur()); pauseClock(true); } }, O.minuteWait(N.clock.date()));
    }
    /* Pause: Play-Symbol, OSD bleibt, Mini-Hinweisleiste; sonst Pause-Symbol */
    function paused() {
      var p = !!(pb && pb.state === 'paused');
      N.ui.setIcon(ppIc, p || trickOn() ? 'play' : 'pause');          // Schnellspulen: Play = normal weiter
      if (osd && zone === 'btn' && fb === 'pp') setLabel();
      if (p && osd) { showOsd(0); }
      miniHints(p && osd);
    }
    function showSpin(t) {
      U.setText(spinT, t); U.show(spin, true);
      if (!slow) slow = setTimeout(function () { slow = 0; if (spin.style.display !== 'none') U.setText(spinT, N.t('pl.slow')); }, 12000);
      if (!lowT) { var t0 = U.now(); lowT = setTimeout(function () { lowT = 0; if (spin.style.display !== 'none' && bw && bw.loading(U.now() - t0)) offerLower(); }, 20000); }
    }
    function hideSpin() { U.show(spin, false); if (slow) { clearTimeout(slow); slow = 0; } if (lowT) { clearTimeout(lowT); lowT = 0; } }
    /* P5 "Geringere Qualitaet?" (Plex Quality Suggestions): Knopf wie "Intro ueberspringen", OK bei verborgenem OSD, 15 s sichtbar */
    function offerLower() {
      if (eff('lowerOffer') === false || !pb || errOn || lost || (String(eff('quality')) === '4' && !(info && info.mode === 'direct'))) return;
      if (btnKind && btnKind !== 'lower') return;
      N.log('Angebot Geringere Qualitaet');
      showSkip('lower', null);
      if (offerT) clearTimeout(offerT);
      offerT = setTimeout(function () { offerT = 0; if (btnKind === 'lower') hideSkip(); }, 15000);
    }
    function clearLow() { if (lowT) { clearTimeout(lowT); lowT = 0; } if (offerT) { clearTimeout(offerT); offerT = 0; } }
    function lowerQuality() {
      var direct = !!(info && info.mode === 'direct'), q = O.lower(eff('quality'), direct);
      sess.quality = q; pcfg.quality = q; sess.forced = true;
      restartAt({ dp: false, ds: false });
      N.ui.toast.show(N.t('pl.toast.quality', { q: N.decision.label(q) }));
    }

    /* ---------- Zeit: OSD (1x/s), Marker, Untertitel ---------- */
    function onTime(ms) {
      var sec = Math.floor(ms / 1000), tr = trickOn();
      // Zeit/Balken max. 1x/s (SPEC PLAY-23); beim Schnellspulen aendert sich die Sekunde bei jedem Takt -> nach Uhrzeit drosseln
      if (sec !== lastSec && (!tr || U.now() - lastPaint >= 1000)) { lastSec = sec; lastPaint = U.now(); if (osd && !acc.active() && !drg) paint(ms); }
      if (tr) return;                                     // Schnellspulen: keine Untertitel, keine Marker-Automatik (Ende = trickEdge)
      if (!cues && sef.fake && N.config.fakeSub) cues = [{ a: 0, b: 1e10, x: N.config.fakeSub }];   // nur Bildtest: Untertitel-Zeile
      if (cues) cue(ms);
      if (mk && pb) markerTick(ms);
    }
    function dur() { return pb && pb.dur() || item && item.dur || 0; }
    function paint(pos) {
      var d = dur(), w = d > 0 ? Math.round(G.BAR_W * Math.min(1, pos / d)) : 0;
      played.style.width = w + 'px';
      U.tf(head, G.BAR_X - G.ISX + w - 12, 0);
      U.setText(tm0, hms(pos)); U.setText(tm1, d ? '-' + left(pos, d) : '');   // ASCII-Minus: U+2212 fehlt in der TV-Schrift (Regel 10)
      paintClk(pos, d);
      var k = O.chapterAt(chs, pos);
      if (lpv.on) lpv.played(pos);
      if (k !== chI) { chI = k; U.setText(chn, k < 0 ? '' : O.chapterNamed(chs[k]) ? N.t('pl.chapter', { n: k + 1, t: chs[k].t }) : N.t('pl.chapterN', { n: k + 1 })); if (pn === 'chap') pnPaint(pos); }
    }
    function paintClk(pos, d) {
      var now = N.clock.date(), ends = d ? N.t('pl.endsAt', { time: F.clock(new Date(now.getTime() + d - pos)) }) : '';
      U.setText(clk, cfg().clock === false ? ends : N.comfort.clock(now, N.config.fixedClock) + (ends ? ' · ' + ends : ''));   // P5 set.clock
    }
    function markerTick(ms) {
      if (lastEnd) return;                           // Karte am echten Ende: spaete Zeit-Ereignisse aendern nichts mehr
      var o = mk.tick(ms, { dur: dur(), playing: pb.state === 'playing', hasNext: hasNext() && sleep.mode !== 'end', last: isLast() && sleep.mode !== 'end', resume: pb.resume });
      if (o.skipTo >= 0) {                           // Automatik: springen, Toast
        seekPb(o.skipTo);
        N.ui.toast.show(N.t('pl.skipped.' + o.marker.type), { icon: 'confirm' });
      }
      if (o.next) { autoNext(); return; }
      if (o.cd > 0) { showUp(o.cd); } else if (cdOn) hideUp();
      if (o.last) showLast(); else if (lastOn) hideLast();
      if (o.btn) showSkip(o.btn, o.marker); else if (btnKind && btnKind !== 'lower' && btnKind !== 'ext') hideSkip();
      if (xt && xt.tick) xt.tick(ms, dur(), o);
    }
    function showSkip(kind, m) {
      skipM = m;
      if (btnKind === kind) return;
      btnKind = kind;
      U.setText(skipT, N.t('pl.skip.' + kind));
      U.show(skip, true);
      lpCover();
    }
    function hideSkip() { btnKind = null; skipM = null; U.show(skip, false); if (zone === 'skip') setZone('bar'); }
    function doSkip() {
      if (!btnKind || !pb) return;
      if (btnKind === 'ext') { hideSkip(); if (xt && xt.offerOk) xt.offerOk(); return; }
      if (btnKind === 'lower') { hideSkip(); lowerQuality(); return; }
      if (btnKind === 'watch') { var t = mk.watchStart(); hideSkip(); if (t >= 0) seekPb(t); return; }
      if (btnKind === 'next') { hideSkip(); playNext(); return; }
      var tg = mk.skip(skipM, dur()); hideSkip(); seekPb(tg);
    }

    /* ---------- Untertitel: SEF-intern (Ereignis 19) / externe SRT (eigene Box); Darstellung aus Einstellung/Mehr ---------- */
    function showSub(t) {
      if (subClr) { clearTimeout(subClr); subClr = 0; }
      if (trickOn()) t = '';
      if (t && (!pb || (pb.subMode !== 'sef' && pb.subMode !== 'sidecar')) && !(sef && sef.fake && N.config.fakeSub)) t = '';   // UT aus: nichts zeichnen
      U.setText(subT, t || ''); U.show(sub, !!t);
      U.cls(sub, 'up', osd);
      if (t && !cues) subClr = setTimeout(function () { subClr = 0; showSub(''); }, 2500 + 1500 * t.split('\n').length);
    }
    function subLook() {
      sub.className = 'pl-sub sz-' + (eff('subSize') || 'medium') + ' bg-' + (eff('subBg') || 'dim') + (eff('subColor') === 'yellow' ? ' yel' : '') + (eff('subPos') === 'high' ? ' hi' : '') + (osd ? ' up' : '') + (lpTab ? ' lp-' + lpS : '');
    }
    function loadSidecar(mode) {
      cues = null; cueI = -1; showSub('');
      if (mode !== 'sidecar' || !pb || !pb.sub) return;
      var key = pb.sub.key;
      N.plex.get(key, { encoding: 'utf-8', format: 'srt' }, N.srv.o(isrv(), { json: false, timeout: 15000 }), function (err, txt) {
        if (err || !pb || !pb.sub || pb.sub.key !== key) return;
        cues = N.subs.parse(txt);
      });
    }
    function cue(ms) {
      var i = N.subs.cueAt(cues, ms - (Number(eff('subDelay')) || 0));   // Verzoegerung: + = spaeter
      if (i !== cueI) { cueI = i; showSub(i >= 0 ? cues[i].x : ''); }
    }

    /* ---------- OSD ---------- */
    function showOsd(ms) {
      if (errOn) return;
      if (!osd) {
        fadeEnd();                                                  // Fokus der letzten Blende abraeumen, bevor er neu gesetzt wird
        dirSync();
        osd = true; U.cls(sub, 'up', true); U.cls(root, 'pl-osd', true);
        if (top.style.display === 'none') { U.show(top, true); U.show(bot, true); U.raf(function () { if (osd) U.cls(osdW, 'on', true); }); }   // erstes Mal: Ebenen anlegen, Blende ab dem naechsten Frame
        else U.cls(osdW, 'on', true);
        if (pb) paint(pb.t);
        paused();
        setZone(zone, true);
        N.router.refreshHints();
      }
      if (osdT) clearTimeout(osdT);
      osdT = 0;
      var hold = pb && (pb.state === 'paused' || pb.speed !== 1);   // Pause und Schnellspulen: OSD bleibt stehen
      if (!hold) osdT = setTimeout(hideOsd, ms || OSD_MS);
    }
    function hideOsd(force) {
      if (osdT) clearTimeout(osdT); osdT = 0;
      // Feinauswahl offen und Finger auf dem Touchpad: OSD bleibt (ruhiges Zielen dauert); sonst zu
      if (lp.isOpen() && force !== true && ptrLive()) { osdT = setTimeout(hideOsd, OSD_MS); return; }
      if (lp.isOpen() || lpv.on) lpEnd();
      lp.leave();
      // waehrend Spulen oder offenem Panel (Ton & UT, Mehr, Kapitel …) bleibt das OSD stehen
      if (!osd || (force !== true && (acc.active() || trickOn() || drg || N.router.hasOverlay()))) { if (osd) osdT = setTimeout(hideOsd, OSD_MS); return; }
      hov = false; hovMs = -1; U.cls(thumb, 'tonly', false);
      osd = false; U.cls(osdW, 'on', false); U.show(thumb, false); if (!lblIn) U.show(lbl, false); U.cls(sub, 'up', false); U.cls(root, 'pl-osd', false);
      // Fokus in der Bedien-Insel blendet mit der Huelle aus (Nutzer Nr. 17: sonst sprang er vor dem Rest weg) und wird erst nach
      // der Blende zurueckgesetzt; der Skip-Knopf liegt ausserhalb der Huelle und bleibt sichtbar -> sofort
      U.cls(skip, 'is-focus', false);
      fadeB = zone === 'btn' ? btnEl[fb] : null; fadeBar = zone === 'bar';
      if (fadeT) clearTimeout(fadeT);
      fadeT = setTimeout(fadeEnd, FADE_MS);
      zone = 'btn'; fb = 'pp'; quick = false;                   // naechstes Einblenden: Fokus Play/Pause
      N.router.refreshHints();
    }
    function fadeEnd() {
      if (fadeT) { clearTimeout(fadeT); fadeT = 0; }
      if (fadeB) { U.cls(fadeB, 'is-focus', false); fadeB = null; }
      if (fadeBar) { U.cls(bot, 'foc', false); fadeBar = false; }
      if (lblIn && !osd) U.show(lbl, false);
    }
    /* Finger/Maus (caps.pointer 'mouse', letzte Eingabe nicht Taste): kein Fokus im Player, Zurueck-Knopf sichtbar. Klasse nur
     * beim Wechsel; -> true = gewechselt (Fokus neu zeichnen). Am TV immer false. */
    function direct() { return !!bk && N.input.mode !== 'key'; }
    function dirSync() {
      var d = direct();
      if (d === dir) return false;
      dir = d; U.cls(root, 'pl-dir', d);
      return true;
    }
    /* Bild in Bild (caps.pip, PLAY-35): Knopf schaltet um; der Player meldet die Darstellungsart als Ereignis 100 */
    function pipToggle() {
      if (!sef || !sef.exec || !pb) return;
      if (!pipOk) { N.ui.toast.show(N.t('pl.pip.wait'), { icon: 'info' }); return; }
      if (sef.exec('SetPresentationMode', pipOn ? 'inline' : 'pip') !== 1) N.ui.toast.show(N.t('pl.pip.failed'), { icon: 'info' });
    }
    function pipReady(on) {
      if (!btnEl.pip || on === pipOk) return;
      pipOk = on;
      U.cls(btnEl.pip, 'off', !on);
    }
    function presented(mode) {
      var on = mode === 'picture-in-picture';
      if (on === pipOn || closed) return;
      pipOn = on;
      if (pipIc) U.cls(pipIc, 'on', on);                       // Symbol: Pfeil aus dem Fenster heraus (beenden)
      if (on) hideOsd(true);                                   // das Bild ist im System-Fenster: Bedienelemente hier weg
      else showOsd();                                          // zurueck in der App: Player normal weiter, kurz die Leiste zeigen
      if (osd && zone === 'btn' && fb === 'pip') setLabel();
    }
    /* sichtbare Knoepfe: ⏮/⏭ nach Modus (Folgen/Warteschlange/Kapitel), Kapitel-Liste nur mit Kapiteln; Sprungweiten aus der Einstellung */
    function updBtns() {
      pn = O.pnMode({ type: item && item.type, qLen: queue ? queue.items.length : 0, chapters: chs.length });
      vis = O.visible({ pn: pn, chap: chs.length > 0, pip: !!btnEl.pip });
      for (var k in btnEl) U.show(btnEl[k], vis.indexOf(k) >= 0);
      var nm = O.stepNums(arrows());
      U.setText(numB, nm[0]); U.setText(numF, nm[1]);
      pnPaint(pb ? pb.t : 0);
      if (NG) btnPos();                                       // schmal: Reihe 2 mittig ueber die sichtbaren Knoepfe
      N.idle.add(lblWarm, 'pl-lblw');                         // Label-Breiten der Knoepfe in Ruhe messen
    }
    /* Knopf-Lagen (nur flexible Flaeche): schmal aus N.osd.narrow (Reihe 2 mittig), sonst die TV-Lagen */
    function btnPos() {
      if (NG) O.narrowRow(NG, vis);
      for (var k in btnEl) if (Object.prototype.hasOwnProperty.call(btnEl, k)) { var b = NG ? NG.osd.by[k] : O.btn(k); btnEl[k].style.left = b.x + 'px'; btnEl[k].style.top = b.y + 'px'; }
    }
    /* ⏮/⏭ bedienbar? Gesperrte bleiben gedimmt stehen (Reihe springt nicht), bekommen aber weder Fokus noch Klick */
    function pnPaint(ms) {
      pnSt = O.pnState({ mode: pn, qIdx: queue ? queue.idx : 0, qLen: queue ? queue.items.length : 0, chs: chs, ms: ms });
      U.cls(btnEl.prev, 'off', !pnSt.prev); U.cls(btnEl.next, 'off', !pnSt.next);
      ids = O.usable(vis, pnSt);
      if (ids.indexOf(fb) < 0) { U.cls(btnEl[fb], 'is-focus', false); fb = O.nav(ids, fb, ''); }
      if (osd) setZone(zone, true);
    }
    /* ⏮ / ⏭ (Knopf, Zeiger, CH▲/CH▼) */
    function stepItem(dir) {
      if (!pn || !pb || !(dir < 0 ? pnSt.prev : pnSt.next)) return;
      if (pn === 'chap') {
        var tg = dir < 0 ? O.prevChapter(chs, pb.t) : O.nextChapter(chs, pb.t);
        if (tg >= 0) { showOsd(); seekTo(tg > 0 ? tg + 1000 : 0, true); }   // +1 s: Sprung landet sonst knapp vor dem Anfang (TV-Test 28.10.)
        return;
      }
      if (dir < 0) playPrev(); else playNext(true);
    }
    /* Fokus setzen: nur alter + neuer Knopf umklassen, Label per left + nodeValue (SPEC 5.22) */
    function setZone(z, force, id) {
      var oldZ = zone, oldB = fb;
      if (z === 'skip' && !btnKind) z = 'bar';
      zone = z; if (id) fb = id;
      var ring = !dir;                                       // Finger/Maus: Fokus wird gefuehrt, aber nicht gezeigt (Nr. 14/17)
      if (oldZ === 'btn' && (z !== 'btn' || oldB !== fb || force || !ring)) U.cls(btnEl[oldB], 'is-focus', false);
      if (z === 'btn' && ring) U.cls(btnEl[fb], 'is-focus', true);
      U.cls(bot, 'foc', z === 'bar' && ring);
      U.cls(skip, 'is-focus', z === 'skip' && ring);
      if (z !== 'bar') quick = false;
      setLabel();
    }
    function setLabel() {
      if (lp && lp.isOpen()) return;                         // Feinauswahl: das Label-Feld zeigt deren Hinweis
      if (hintT) return;                                     // Schnellspulen-Hinweis steht noch
      if (!osd || zone !== 'btn' || (dir && N.input.mode === 'touch')) { U.show(lbl, false); return; }   // Finger: kein Label (kein Fokus)
      var tx = btnText(fb, !!(pb && pb.state === 'paused'));
      U.setText(lblT, tx);
      U.show(lbl, true);
      // Label mittig UNTER dem Knopf, aber nie ueber den Innenrand der Insel hinaus (rechte Knoepfe, lange Texte)
      var c = O.center(fb, G.osd), w = lblWidth(tx), x = U.clamp(c - w / 2, G.ISX + 32, G.ISX + G.ISW - 32 - w);
      lbl.style.left = Math.round(x + w / 2 - 150) + 'px';
    }
    function btnText(id, isPaused) {
      var t = id === 'pp' ? (trickOn() ? 'pl.btn.normal' : isPaused ? 'pl.btn.play' : 'pl.btn.pause') : id === 'prev' || id === 'next' ? O.pnLabel(pn, id)
        : id === 'pip' ? (pipOn ? 'pl.btn.pipEnd' : 'pl.btn.pip')
        : 'pl.btn.' + { back: 'back', fwd: 'fwd', chap: 'chapters', tracks: 'tracks', more: 'more' }[id], st = arrows();
      return N.t(t, { n: id === 'back' ? st.b : st.f });
    }
    /* Runde 6 (Regel: keine Geometrie-Abfragen im Tastenpfad): Breite je Label-Text einmal messen und merken; lblWarm misst die
     * Knopf-Texte schon in Ruhe nach dem Start (verstecktes Zwillings-Label, gleiche Schrift). Ohne Treffer wie bisher: Label
     * zeigen, dann messen (erzwingt Stil + Layout im Schritt). */
    function lblWidth(tx) {
      var w = lblW[tx];
      if (w === undefined) { w = lblT.parentNode.offsetWidth || 0; if (w) lblW[tx] = w; }
      return w;
    }
    function lblWarm() {
      if (closed || !lblM) return;
      var tx = [], k;
      for (k in btnEl) { tx.push(btnText(k, false)); if (k === 'pp') tx.push(btnText(k, true)); }
      if (eff('ffrw') === 'trick') tx.push(N.t('pl.btn.normal'), N.t('pl.trick.hls'), N.t('pl.trick.off'), N.t('pl.trick.hls.rw'), N.t('pl.trick.off.rw'));
      for (k = 0; k < tx.length; k++) if (lblW[tx[k]] === undefined) { U.setText(lblMT, tx[k]); var w = lblMT.parentNode.offsetWidth || 0; if (w) lblW[tx[k]] = w; }
    }
    function activate(id) {
      var st = arrows();                                     // wiederholte Klicks sammeln wie die Tasten (ein Sprung nach 600 ms Ruhe)
      switch (id) {
        case 'back': seekBy(-st.b * 1000, false); break;
        case 'fwd': seekBy(st.f * 1000, false); break;
        case 'pp': if (pb) pb.toggle(); showOsd(); break;
        case 'prev': stepItem(-1); break;
        case 'next': stepItem(1); break;
        case 'chap': chapters(); break;
        case 'tracks': tracks('a'); break;
        case 'more': more(); break;
        case 'pip': pipToggle(); break;
      }
    }
    /* Mini-Hinweisleiste (Pause): B Ton & UT · C Kapitel · D Sleep-Timer · INFO Hilfe; anklickbar. Tastenhinweise "Aus" -> nie;
     * "Nur kurz" -> wie "Immer" (erscheint ohnehin nur mit der Bedienleiste in der Pause) */
    var MH_KEYS = { green: 'GREEN', yellow: 'YELLOW', blue: 'BLUE', INFO: 'INFO' };
    /* Maus/Trackpad/Finger auf Geraeten ohne Fernbedienungs-Zeiger (caps.pointer 'mouse'): keine Tastenkappen, die Funktionen haben
     * eigene Knoepfe (Ton & UT, Kapitel, Mehr › Sleep-Timer bzw. Problem › Technische Infos) – Entscheidung Apple Nr. 13–15 */
    function capsOff() { return N.platform.caps.pointer === 'mouse' && N.input.mode !== 'key'; }
    function miniHints(on) {
      if (!on || acc.active() || N.ui.hints.mode() === 'off' || capsOff()) { U.show(mh, false); mhRects = null; return; }   // Tastenhinweise "Aus": auch hier nicht
      var list = [{ k: 'green', t: 'hint.tracks' }];
      if (chs.length) list.push({ k: 'yellow', t: 'hint.chapters' });
      list.push({ k: 'blue', t: 'hint.sleep' }, { k: 'INFO', t: 'hint.help' });
      for (var i = 0; i < mhItems.length; i++) {
        var e = mhItems[i], d = list[i];
        U.show(e.root, !!d);
        if (!d) continue;
        var col = { green: ['k-green', 'B'], yellow: ['k-yellow', 'C'], blue: ['k-blue', 'D'] }[d.k];
        e.k.className = col ? 'k ' + col[0] : 'kt'; U.setText(e.kT, col ? col[1] : 'INFO');
        U.setText(e.lb, N.t(d.t));
      }
      mh.list = list;
      U.show(mh, true);
      U.raf(function () {                                        // Rechtecke einmal messen (nie im Tastenpfad)
        var r = [];
        for (var j = 0; j < mh.list.length; j++) r.push({ x: mh.offsetLeft + mhItems[j].root.offsetLeft, w: mhItems[j].root.offsetWidth, k: MH_KEYS[mh.list[j].k] });
        mhRects = r;
      });
    }
    s.hints = function () {
      if (errOn) return [{ k: 'INFO', t: 'hint.details' }, { k: 'ret', t: 'hint.back' }];
      return [];                                                 // im Player keine Hinweisleiste (SPEC 5.11)
    };

    /* ---------- Spulen (Sammelfenster) + Vorschaubild ---------- */
    function seekBy(step, accel) {
      if (!pb || !dur() || pb.state === 'resolving' || pb.state === 'error') return;
      pb.normal();                                    // Sprung ab der Stelle, an der das Schnellspulen steht
      showOsd(); hoverOff();
      acc.delay = N.config.seekDelay || (zone === 'bar' && !quick ? 1000 : 600);   // Balken: Sprung nach 1 s Ruhe oder OK
      U.show(mh, false);
      showSeek(acc.press(step, pb.t, dur(), accel));
    }
    function showSeek(st) {
      var w = seekBar(st.target, st.delta);
      if (thumbOn) showThumb(st.target, w);
    }
    /* Balken, Kopf, Zeiten und Sprungziel "+2:30 (41:12)" fuer ein Ziel; -> Breite des gespielten Teils */
    function seekBar(target, delta) {
      var d = dur(), w = Math.round(G.BAR_W * target / d);
      played.style.width = w + 'px';
      U.tf(head, G.BAR_X - G.ISX + w - 12, 0);
      U.setText(tm0, hms(target)); U.setText(tm1, '-' + left(target, d));
      U.setText(skl, (delta < 0 ? '-' : '+') + hms(Math.abs(delta)) + ' (' + hms(target) + ')');
      return w;
    }
    /* Zeiger ueber dem Balken: Zeit (+ Vorschaubild, falls vorhanden) an der Zeigerstelle, gesprungen wird erst beim Klick */
    var hovMs = -1;
    function hover(x) {
      if (acc.active() || !dur()) return;               // laufendes Spulen hat Vorrang
      var w = Math.round(U.clamp(x - G.BAR_X, 0, G.BAR_W)), ms = Math.round(dur() * w / G.BAR_W);
      hov = true; hovMs = ms;
      if (thumbOn) { U.cls(thumb, 'tonly', false); showThumb(ms, w); return; }
      U.cls(thumb, 'tonly', true);                        // ohne Vorschaubilder: nur die Zeit in einer kleinen Blase
      if (NG) thumb.style.top = (G.BAR_Y + 14) + 'px';
      thumb.style.left = U.clamp(G.BAR_X + w - 48, G.BAR_X, G.BAR_X + G.BAR_W - 96) + 'px';
      U.setText(thT, hms(ms));
      U.show(thumb, true);
    }
    function hoverOff() {
      if (!hov) return;
      hov = false; hovMs = -1;
      if (!acc.active()) U.show(thumb, false);
      U.cls(thumb, 'tonly', false);
    }
    function showThumb(ms, w) {
      var x = U.clamp(G.BAR_X + w - 120, G.ISX, G.ISX + G.ISW - 240);
      if (NG) thumb.style.top = (G.BAR_Y - 202) + 'px';   // schmal: Vorschau ueber dem Balken (im Bild)
      thumb.style.left = x + 'px';
      U.setText(thT, hms(ms));
      U.show(thumb, true);
      var snap = N.thumbs.snap(ms), now = U.now();
      if (snap === thLast) return;
      if (now - thT0 < 250) { setTimeout(function () { if ((acc.active() && acc.target === ms) || (hov && hovMs === ms)) showThumb(ms, w); }, 260); return; }
      thLast = snap; thT0 = now;
      if (bif) { thImg.src = N.thumbs.dataUri(bifRaw, bif, N.thumbs.frameAt(bif, ms)) || N.img.BLANK; return; }
      thImg.onerror = function () { if (++thFail === 2) loadBif(); };
      var cn = conn();
      thImg.src = cn.base ? N.thumbs.url(cn.base, pb.meta.partId, ms, cn.token) : N.img.BLANK;
    }
    /* Rueckfall: BIF-Datei einmal als Binaer-String laden (Einzelbild-Endpunkt am TV gescheitert) */
    function loadBif() {
      try {
        var x = new XMLHttpRequest(), part = pb.meta.partId;
        var cb0 = conn();
        x.open('GET', N.thumbs.bifUrl(cb0.base, part, cb0.token), true);
        if (x.overrideMimeType) x.overrideMimeType('text/plain; charset=x-user-defined');
        x.onreadystatechange = function () {
          if (x.readyState !== 4) return;
          var b = x.status === 200 ? N.thumbs.parseBif(x.responseText) : null;
          if (b && pb && pb.meta.partId === part) { bif = b; bifRaw = x.responseText; } else thumbOn = false;
          N.log('BIF ' + x.status + ' ' + (b ? b.frames.length : 0));
        };
        x.send(null);
      } catch (e) { thumbOn = false; }
    }
    function commitSeek(tg) {
      U.setText(skl, ''); U.show(thumb, false); thLast = -1;
      if (!pb) return;
      if (mk) mk.seeked();
      cueI = -1;
      seekPb(tg);
      paint(tg);
      showOsd();
      paused();
    }
    /* Klick auf den Balken: Ziel wie beim Spulen sofort zeigen (Zeit, Vorschaubild, "+12:30"), EIN Sprung nach 1 s Ruhe – in der
     * Zeit korrigiert Wischen auf dem Touchpad (= ◀▶ auf dem Balken) um die Sprungweite, ohne einen zweiten teuren Sprung */
    function clickSeek(ms) {
      if (!pb || !dur() || pb.state === 'resolving' || pb.state === 'error') return;
      pb.normal();
      acc.delay = N.config.seekDelay || 1000;
      U.show(mh, false);
      showSeek(acc.set(ms, pb.t, dur(), false));
    }
    /* ---------- Feinauswahl am Balken (docs/research/player-controls.md "Feinauswahl"): ruhiger Zeiger -> Fenster um die Stelle in der
     * gewaehlten Darstellung (Einstellung loupeStyle: A Lasche (Standard), B Balken dehnt sich, D Filmstreifen – ohne
     * Vorschaubilder A); Klick setzt das Ziel ueber das Sammelfenster (ein Sprung), Taste/Wegbewegen nach oben/seitlich schliesst.
     * Schutzzone: das Band reicht bis zur Unterkante der Bedien-Insel (y 638) – solange die Feinauswahl offen ist, reagiert die
     * Knopfreihe (Treffer 530–594) weder auf Zeigen noch auf Klick; ein Klick dort setzt das feine Ziel (TV-Befund 28.10.) ---------- */
    var LP_BOT = G.ISY + G.ISH;                               // oben: Laschen-Oberkante (A/D) bzw. 32 px ueber der Balkenmitte (B)
    function ptrLive() { var P = N.pointer; return !!(P && P.rawT && U.now() - P.rawT < P.LIVE); }
    function lpHalf() { return N.Loupe.half(dur(), G.BAR_W); }
    function lpOk() { return !NG && eff('ptrLoupe') === true && N.pointer.enabled() && osd && hov && !!pb && !acc.active() && !N.router.hasOverlay() && !errOn && !lost && lpHalf() > 0; }
    function lpOpen(x) {
      var h = lpHalf(), Lp = N.Loupe;
      if (!h || closed) return;
      lpS = Lp.style(eff('loupeStyle'), { thumbs: thumbOn && !!(pb && pb.meta && pb.meta.partId) });
      var g = lp.open(Lp.geom({ x: x, barX: G.BAR_X, barW: G.BAR_W, dur: dur(), w: Lp.width(lpS, 480, G.BAR_W), h: h }), chs, 0);
      lpTab = Lp.tab(lpS, g, G.ISY);
      lpBand = Lp.band(lpS, g, { barY: G.BAR_Y, islY: G.ISY, bottom: LP_BOT, side: G.BAR_Y + 16 });   // seitlich raus nur bis zur Balken-Trefferzone
      lpBar(true);
      if (lpS === 'film' || (!thumbOn && lpS !== 'stretch')) U.show(thumb, false);   // Zielzeit steht an der Feinleiste bzw. im Bild
      U.cls(thumb, 'lp-panel', lpS === 'panel');                 // A: Vorschaubild ueber der Lasche
      var txt = lpText(h);
      lpv.show(g, { style: lpS, fmt: hms, chs: chs, coff: 0, markers: pb && pb.meta && pb.meta.parts < 2 ? pb.meta.markers : null, pos: pb ? pb.t : 0,
        title: txt, img: lpImg, fail: function () { if (!bif && ++thFail === 2) loadBif(); } });
      if (lpTab) { U.show(lbl, false); U.cls(sub, 'lp-' + lpS, true); lpCover(); } else lpLabel(txt);
      var pp = ptLow(), p = lp.move(pp.x, pp.y, lpBand);
      if (p && !p.exit) lpMove(p);
    }
    /* Balken, Kopf und Sprungziel waehrend der Feinauswahl (A/D gedimmt, B verborgen) – Klassen an der Bedien-Insel wie in Runde 7.
     * Runde 8 (Klassen an leeren Huellen-Ebenen .pl-trw/.pl-hdw) war am TV schlechter (9,8,1 Lasche/Stretch/Film 3/5/5 statt 2/3/3) */
    function lpBar(on) {
      U.cls(bot, 'lp', on); U.cls(bot, 'lp-stretch', on && lpS === 'stretch');
    }
    /* Hinweis/Titel: die ersten 3 Male (Zaehler je TV) der Hinweis zum Verlassen, danach "Feinauswahl · ±4:48 Min." */
    function lpText(h) {
      var S = N.session, n = Number(S.state && S.state.loupeHints) || 0;
      if (n < N.Loupe.K.HINTS && S.state) { S.state.loupeHints = n + 1; S.save(); return N.t('pl.loupe.hint'); }
      return N.t('pl.loupe.title', { t: hms(h) });
    }
    /* B: im Label-Feld unter der Knopfreihe (A/D: in der Kopfzeile der Lasche) */
    function lpLabel(txt) {
      U.setText(lblT, txt); U.show(lbl, true);
      var w = lblWidth(txt);                                    // je Text einmal gemessen, nie je Bewegung
      lbl.style.left = Math.round(G.CX - Math.max(w, 300) / 2) + 'px';
    }
    /* A/D: nur weichen, was die Lasche wirklich verdeckt (Skip-Knopf, Countdown-/Letzte-Folge-Karte); einmal je Oeffnen bzw. wenn eins
     * davon waehrend der Feinauswahl erscheint. Untertitel ruecken per Klasse hoch (subLook). */
    function lpCover() {
      if (!lpTab) return;
      [skip, up, last].forEach(function (e) {
        var on = e.style.display !== 'none' && N.Loupe.hit(lpTab, { x: e.offsetLeft, y: e.offsetTop, w: e.offsetWidth, h: e.offsetHeight });
        U.cls(e, 'lp-off', on);
      });
    }
    /* D: Bild-URL fuer eine Stelle (Einzelbild-Endpunkt oder BIF-Rueckfall wie die Zeiger-Vorschau); '' = keins */
    function lpImg(ms) {
      if (!thumbOn || !pb || !pb.meta) return '';
      if (bif) return N.thumbs.dataUri(bifRaw, bif, N.thumbs.frameAt(bif, ms)) || '';
      var cn = conn();
      return cn.base ? N.thumbs.url(cn.base, pb.meta.partId, ms, cn.token) : '';
    }
    function lpMove(p) { hovMs = p.ms; lpPend = p; if (!lpRaf) { lpRaf = true; U.raf(lpFrame); } }
    function lpFrame() {
      lpRaf = false;
      var p = lpPend;
      if (!p || !lp.isOpen()) return;
      lpv.point(p);
      if (lpS === 'film') return;                               // D: das Bild unter dem Zeiger ist die Vorschau
      if (thumbOn) { showThumb(p.ms, p.x - G.BAR_X); return; }
      if (lpS === 'stretch') {                                  // B ohne Bilder: Zeit-Blase am Zeiger wie die grobe Vorschau
        thumb.style.left = U.clamp(p.x - 48, G.BAR_X, G.BAR_X + G.BAR_W - 96) + 'px';
        U.setText(thT, hms(p.ms));
      }
    }
    function lpEnd() {
      if (!lpv) return;
      if (lp.isOpen()) lp.close();
      lpPend = null;
      if (!lpv.on) return;
      lpv.hide(); lpBar(false);
      if (lpTab) { lpTab = null; U.cls(sub, 'lp-' + lpS, false); U.cls(skip, 'lp-off', false); U.cls(up, 'lp-off', false); U.cls(last, 'lp-off', false); }
      U.cls(thumb, 'lp-panel', false);
      if (zone === 'btn' && osd) setLabel(); else U.show(lbl, false);
    }
    /* ---------- Ziehen am Balken (Finger, Maus mit caps.pointer 'mouse'; SPEC PLAY-34): Kopf, Zeiten und Vorschau folgen dem Punkt
     * (ein Zeichnen je Frame), Ruhe oeffnet die Feinauswahl wie beim Zeiger (Einstellung ptrLoupe), Loslassen springt sofort ---------- */
    /* Player auf voller Flaeche (nur flexible Flaeche, Apple Nr. 17; flex.css): die Ansicht rechnet weiter im 1280x720-Raster, die
     * Titel-Ebene haengt an der Oberkante, die Bedien-Ebene an der Unterkante, Mitte bleibt im Kasten -> Bildschirm-Punkte
     * umrechnen (N.osd.fullPt). Am TV ohne Wirkung (Versatz 0). full(x, y): Bildschirm-Punkt; ptLow: Zeiger als Bedien-Ebene */
    function full(x, y, how) {
      if (NG) { if (!errOn) return { x: x, y: y }; var st = N.screen.stage(); return { x: (x - st.x) / st.k, y: (y - st.y) / st.k }; }   // schmal: Flaechen-Punkte; Fehler im Kasten
      return O.fullPt(x, y, N.screen.stage(), N.screen.h, how || (lost || errOn ? 'mid' : ''));
    }
    function ptLow() { return full(N.pointer.x, N.pointer.y, 'low'); }
    function onBarGrab(x, y) { return x >= G.BAR_X - 16 && x < G.BAR_X + G.BAR_W + 16 && y >= G.BAR_Y - 24 && y < G.BAR_Y + 20; }   // Finger: etwas groesser als die Zeiger-Zone
    function canDrag() { return osd && !!pb && dur() > 0 && !lost && !errOn && pb.state !== 'resolving' && pb.state !== 'error'; }
    function dragStart(x, y) {
      if (trickOn()) pb.normal();
      if (acc.active()) acc.cancel();                       // offenes Sprungziel: der Zug setzt ein neues
      hintOff(); U.show(mh, false);
      if (zone !== 'bar') setZone('bar');
      drg = { x: x, y: y };
      showOsd();
      dragAt(x, y);
    }
    function dragAt(x, y) { drg.x = x; drg.y = y; if (!drgRaf) { drgRaf = true; U.raf(dragFrame); } }
    function dragMs(x) { return Math.round(dur() * U.clamp((x - G.BAR_X) / G.BAR_W, 0, 1)); }
    function dragFrame() {
      drgRaf = false;
      if (!drg || closed) return;
      var x = drg.x, y = drg.y;
      if (lp.isOpen()) {                                     // Feinauswahl offen: der Punkt waehlt fein, Verlassen -> grob weiter
        var r = lp.move(x, y, lpBand);
        if (r && !r.exit) { if (!r.same) lpMove(r); return; }
        lpEnd();
      }
      var ms = dragMs(x);
      seekBar(ms, ms - (pb ? pb.t : 0));
      hover(x);                                              // Vorschaubild bzw. Zeit-Blase am Punkt (setzt hov fuer die Feinauswahl)
      if (eff('ptrLoupe') === true) lp.track(x, y);
    }
    function dragEnd(x, y) {
      var ms = lp.isOpen() ? lp.click(x, y, lpBand) : -1;
      if (ms < 0) ms = dragMs(x);
      drg = null;
      lpEnd(); hoverOff();
      if (!pb || !dur() || pb.state === 'resolving' || pb.state === 'error') { dragCancel(); return; }
      pb.normal();
      acc.set(ms, pb.t, dur(), true);                        // sofort springen (commitSeek: Ziel weg, Balken, OSD)
    }
    function dragCancel() {
      drg = null;
      lp.leave(); lpEnd(); hoverOff();
      U.setText(skl, ''); U.show(thumb, false);
      if (pb) paint(pb.t);
      paused();
    }
    s.pointerGrab = function (x, y) {
      if (drg) return '';
      var pt = full(x, y); x = pt.x; y = pt.y;
      return canDrag() && onBarGrab(x, y) && !(btnKind && x >= G.SKX0 && x < G.SKX1 && y >= G.SKIP_Y && y < G.SKIP_Y + 48) ? 'drag' : 'tap';   // sonst nur Tippen: Wischen blaettert im Player nicht
    };
    s.pointerDrag = function (ph, x, y) {
      var pt = full(x, y, ph === 'start' ? '' : 'low'); x = pt.x; y = pt.y;   // waehrend des Zuges immer Bedien-Ebene
      if (ph === 'start') { if (drg || !canDrag() || !onBarGrab(x, y)) return false; dragStart(x, y); return true; }
      if (!drg) return false;
      if (ph === 'move') dragAt(x, y);
      else if (ph === 'end') dragEnd(x, y);
      else dragCancel();
      return true;
    };
    function seekTo(ms, now) { if (!pb || !dur()) return; pb.normal(); acc.set(ms, pb.t, dur(), now !== false); }
    /* ---------- Schnellspulen (PLAY-32): Einstellung ffrw 'trick', sonst Spruenge (PLAY-22) ---------- */
    function trickOn() { return !!(pb && pb.speed !== 1); }
    /* ◀◀ (dir -1) / ▶▶ (+1): Trick-Modus, wenn eingestellt und moeglich; umgewandelt/abgelehnt -> Sprung + Hinweis (einmal je Video) */
    function ffrwKey(dir) {
      var FR = ffrw(), jump = function () { seekBy(dir < 0 ? -FR.b * 1000 : FR.f * 1000, false); };
      if (!pb || eff('ffrw') !== 'trick') { jump(); return; }
      /* gehaltene Taste (Wiederholung) schaltet sonst in Bruchteilen einer Sekunde durch alle Stufen: < 250 ms ignorieren */
      var t = U.now();
      if (t - ffrwAt < FFRW_GAP) return;
      ffrwAt = t;
      if (acc.active()) acc.commit();                     // offenes Sprungziel zuerst ausfuehren
      var at = pausedAt, wasP = pb.state === 'paused';
      if (wasP) pausedAt = 0;                             // aus der Pause spulen: kein "Zurueckspulen beim Fortsetzen" dazu (Sprung + Hinweis)
      var r = pb.trick(dir);
      if (wasP && pb.state === 'paused') pausedAt = at;   // nicht losgelaufen (umgewandelt o. ae.): bleibt pausiert wie vorher
      if (r.why === 'hls' || r.why === 'off') { jump(); trickHint('pl.trick.' + r.why + (dir < 0 ? '.rw' : '')); return; }
      if (r.why === 'state' || (r.why === 'retry' && r.speed === 1)) { jump(); return; }   // laedt gerade / erste Ablehnung: wie bisher springen
      showOsd(); hoverOff();
    }
    function trickUi(sp) {
      var on = sp !== 1;
      if (on) {
        N.ui.setIcon(trkIc, sp > 0 ? 'ff' : 'rw'); U.setText(trkT, N.trick.label(sp));
        U.vis(trk, true); U.show(mh, false); showSub(''); lastPaint = 0;   // Pille: feste Ebene, nur visibility (Performance-Regel Runde 6)
        if (btnKind && btnKind !== 'lower' && btnKind !== 'ext') hideSkip();   // Marker-Knoepfe/Countdown passen nicht mehr zur Stelle
        if (cdOn) hideUp();
        if (lastOn) hideLast();                           // Karte "Letzte Folge" passt ebenso wenig zur neuen Stelle
      } else {
        U.vis(trk, false); cueI = -1; if (mk) mk.seeked();
      }
      if (pb && (pb.state === 'playing' || pb.state === 'paused')) showOsd();
      paused();
    }
    /* kurzer Hinweis im Label-Feld unter der Knopfreihe (wie die Feinauswahl), 4 s; einmal je Video */
    function trickHint(key) {
      if (trickHinted) return;
      trickHinted = true;
      var txt = N.t(key);
      U.setText(lblT, txt); U.show(lbl, true);
      lbl.style.left = Math.round(G.CX - Math.max(lblWidth(txt), 300) / 2) + 'px';
      if (hintT) clearTimeout(hintT);
      hintT = setTimeout(function () { hintT = 0; setLabel(); }, 4000);
    }
    function hintOff() { if (hintT) { clearTimeout(hintT); hintT = 0; setLabel(); } }
    function cancelSeek() { acc.cancel(); U.setText(skl, ''); U.show(thumb, false); if (pb) paint(pb.t); paused(); }

    /* ---------- Naechste Folge (Play-Queue, Countdown) ---------- */
    function makeQueue(m) {
      var mid = isrv() || N.session.state.server && N.session.state.server.machineId;   // Weitere Server: Queue auf DEM Server
      if (!mid) return;
      // Serie als Quelle + key = diese Folge: die Queue enthaelt auch die Folgen DAVOR (nur mit der Folge als uri beginnt sie bei ihr;
      // am PMS 1.43 geprueft 28.10.: offset 1 statt 0). Ohne Serien-Schluessel wie bisher.
      var lib = 'server://' + mid + '/com.plexapp.plugins.library/library/metadata/';
      qTask = N.plex.pms('POST', '/playQueues', m.showRk ? { type: 'video', continuous: 1, includeChapters: 0, key: '/library/metadata/' + m.rk, uri: lib + m.showRk }
        : { type: 'video', continuous: 1, includeChapters: 0, uri: lib + m.rk }, N.srv.o(isrv(), { retries: 0, dedupe: false }), function (err, d) {
        qTask = null;
        var mc = !err && d && d.MediaContainer;
        if (!mc || !mc.Metadata) { N.log('playQueue ' + (err ? err.status || err.type : 'leer')); return; }
        var items = [], cur = 0;
        for (var i = 0; i < mc.Metadata.length; i++) {
          var x = mc.Metadata[i], it = N.model.norm(x);
          it.pqi = x.playQueueItemID;
          if (String(x.playQueueItemID) === String(mc.playQueueSelectedItemID)) cur = i;
          items.push(it);
        }
        queue = { id: mc.playQueueID, items: items, idx: cur };
        if (pb) { pb.queueId = queue.id; pb.queueItem = items[cur] && items[cur].pqi; }
        updBtns();
      });
    }
    function hasNext() { return !!(queue && queue.idx < queue.items.length - 1); }
    /* letzte Folge: Play-Queue (fortlaufend = Rest der Serie) geladen und ohne naechsten Eintrag */
    function isLast() { return !!(queue && item && item.type === 'episode' && queue.idx >= queue.items.length - 1); }
    function showUp(left) {
      if (!cdOn) {
        if (btnKind === 'ext') hideSkip();           // Hinweis-Insel einer Erweiterung nie zusammen mit einer Karte (PX.offer)
        cdOn = true; upF = 0; setUpF(0);
        var nx = queue.items[queue.idx + 1];
        U.setText(upTi, N.t('pl.epTitle', { s: nx.s, e: nx.e, t: nx.epTitle }));
        upImg.src = nx.still ? N.img.url(nx.still, 'upnext') : N.img.BLANK;
        U.show(up, true); lpCover();
        upBar.style.webkitTransition = 'none'; upBar.style.webkitTransform = 'scaleX(1)';
        var n = left;
        setTimeout(function () { upBar.style.webkitTransition = '-webkit-transform ' + n + 's linear'; upBar.style.webkitTransform = 'scaleX(0)'; }, 30);
        N.router.refreshHints();
      }
      U.setText(upIn, N.tn('pl.next.in', left));
    }
    function hideUp() { if (!cdOn && up.style.display === 'none') return; cdOn = false; U.show(up, false); upBar.style.webkitTransition = 'none'; }
    function setUpF(i) { U.cls(upBtns[upF], 'is-focus', false); upF = i; U.cls(upBtns[i], 'is-focus', true); }
    function upAct(i) { if (i === 0) playNext(); else { mk.cancelCountdown(); hideUp(); } }
    /* skip: von Hand mitten in der Folge (⏭/CH▼) -> nicht als gesehen markieren (wie Plex), nur die Stelle bleibt gemerkt */
    function playNext(skip) {
      if (!hasNext() || !pb) { if (pb && pb.state === 'ended') close(); return; }
      var nx = queue.items[queue.idx + 1];
      hideUp(); hideSkip(); hideLast();
      pb.stop(skip === true ? 'skip' : 'next');
      queue.idx++;
      play(nx, 0, nx);
    }
    /* ⏮ bei Folgen/Warteschlange: vorige Folge von vorn (wie Plex: ohne Rueckfrage; die Stelle der laufenden Folge ist gemerkt) */
    function playPrev() {
      if (!queue || queue.idx < 1 || !pb) return;
      var pv = queue.items[queue.idx - 1];
      hideUp(); hideSkip(); hideLast();
      pb.stop('prev');
      queue.idx--;
      play(pv, 0, pv);
    }
    /* Echtes Dateiende (PLAY-18): naechster Eintrag, kurz die Karte "Das war die letzte Folge" mit Rueckzaehler oder gleich zurueck.
     * Nie bleibt der Player auf dem fertigen Video stehen (TV-Befund 1.0.6: Karte blieb mit "Anfragen" fuer immer offen). */
    function onEnded() {
      hideSkip(); hideUp();
      var a = N.Markers.endAction({ sleepEnd: sleep.mode === 'end', autoNext: !!eff('autoNext'), hasNext: hasNext(), last: isLast(), cancelled: !!(mk && mk.cancelled) });
      if (a === 'sleep') { sleepDone(); return; }
      if (a === 'next') { autoNext(); return; }
      if (a === 'card') { endCard(); return; }
      close();
    }
    function endCard() {
      showLast();
      lastEnd = true; endN = N.Markers.endWait(eff('countdown'));
      endPaint();
      lastBarOn(true); U.show(lastBar.parentNode, !endHold);
      lastBar.style.webkitTransition = 'none'; lastBar.style.webkitTransform = 'scaleX(1)';
      var n = endN;
      setTimeout(function () { lastBar.style.webkitTransition = '-webkit-transform ' + n + 's linear'; lastBar.style.webkitTransform = 'scaleX(0)'; }, 30);
      N.tv.saver(true);
      if (endT) clearTimeout(endT);
      endT = setTimeout(endStep, 1000);
      if (xt && xt.ended) xt.ended();                // Erweiterung: noch einmal nachsehen, ob die naechste Folge inzwischen da ist
    }
    function endStep() {
      endT = 0;
      if (closed || !lastEnd) return;
      if (!endHold) { endN--; if (endN <= 0) { endLeave(); return; } endPaint(); }
      endT = setTimeout(endStep, 1000);
    }
    /* Knoepfe am Ende: belegt die Erweiterung Knopf 0 ("Anfragen"), ist Knopf 1 "Zurueck in n Sek."; sonst Knopf 0 */
    function endPaint() {
      var t = N.tn('pl.last.backIn', endN);
      if (lastCustom) { U.setText(lastB1, t); U.show(lastBtns[1], true); }
      else { U.setText(lastB0, t); U.show(lastBtns[1], false); if (lastF) setLastF(0); }
    }
    /* zurueck zum aufrufenden Bildschirm (alter Fokus, NAV-6) – oder, falls die naechste Folge inzwischen eingereiht ist, abspielen */
    function endLeave() {
      if (closed) return;
      if (hasNext() && pb) { hideLast(); autoNext(); return; }
      close();
    }
    /* automatischer Wechsel (Countdown bei 0 / Ende): nach N Folgen ohne Eingabe erst nachfragen (SPEC 7.10) */
    function autoNext() {
      if (stillOn) return;
      if (!still.advance(N.idle.lastKey(), U.now())) { playNext(); return; }
      stillOn = true; hideUp();
      if (pb) pb.pause();
      N.log('Schaust du noch? nach ' + still.n + ' Folgen (' + still.why + ')');
      N.ui.dialog.open({ title: N.t('dlg.still.title'), text: N.t(still.why === 'time' ? 'dlg.still.timeText' : 'dlg.still.text'), focus: 0,
        buttons: [{ id: 'go', t: N.t('dlg.still.confirm') }, { id: 'stop', t: N.t('dlg.still.cancel') }],
        onSelect: function (id) { stillOn = false; if (id === 'go') { still.reset(U.now()); if (hasNext()) playNext(); else close(); } else close(); },
        onCancel: function () { stillOn = false; close(); } });
    }
    /* Karte "Das war die letzte Folge": Zur Serie (bis es Details gibt: zurueck zur Startseite) · Abspann ansehen */
    function showLast() {
      if (lastOn) return;
      if (btnKind === 'ext') hideSkip();             // z. B. Fortsetzen im Abspann: Insel "Naechste Folge fehlt" und Karte nie zugleich
      lastOn = true; U.setText(lastB1, N.t('pl.next.watchCredits')); U.show(lastBtns[1], true); setLastF(0); U.show(last, true); lpCover();
      if (xt && xt.last) xt.last();
    }
    /* Rueckzaehl-Balken der Karte am Ende; .cd macht die Karte dafuer 12 px hoeher – nur am Dateiende bzw. beim Schliessen, nie im
     * Tastenpfad (haelt eine Erweiterung den Rueckzaehler an, wird nur der Balken verborgen, die Karte behaelt ihre Hoehe) */
    function lastBarOn(on) { U.show(lastBar.parentNode, on); U.cls(last, 'cd', on); }
    function hideLast() {
      if (endT) { clearTimeout(endT); endT = 0; }
      lastEnd = false; lastBarOn(false);
      if (!lastOn) return;
      lastOn = false; U.show(last, false);
    }
    function setLastF(i) { U.cls(lastBtns[lastF], 'is-focus', false); lastF = i; U.cls(lastBtns[i], 'is-focus', true); }
    function lastAct(i) {
      if (i === 0 && xt && xt.lastAct && xt.lastAct()) return;
      if (lastEnd || i === 0 || (pb && pb.state === 'ended')) { close(); return; }
      if (mk) mk.cancelCountdown();
      hideLast();
    }

    /* ---------- Sleep-Timer (Blau / Mehr): Aus · Ende der Folge · 15–90 Min.; 1 Min. vorher Hinweis, dann Ende ---------- */
    function setSleep(mode, quiet) {
      if (sleep.t) clearTimeout(sleep.t); if (sleep.w) clearTimeout(sleep.w);
      sleep = { mode: mode, at: 0, t: 0, w: 0 };
      if (typeof mode === 'number') {
        var ms = mode * 60000;
        sleep.at = U.now() + ms;
        sleep.t = setTimeout(sleepDone, ms);
        sleep.w = setTimeout(function () { sleep.w = 0; N.ui.toast.show(N.t('pl.toast.sleepSoon'), { icon: 'info' }); }, ms - 60000);
      }
      if (quiet) return;
      N.ui.toast.show(mode === 'off' ? N.t('pl.toast.sleepOff') : mode === 'end' ? N.t('pl.toast.sleepEnd') : N.t('pl.toast.sleep', { n: mode }), { icon: 'confirm' });
    }
    function sleepDone() { sleep.t = 0; close(); N.ui.toast.show(N.t('pl.toast.sleepDone'), { icon: 'info' }); }
    function sleepText() {
      if (sleep.mode === 'off') return N.t('set.v.off');
      if (sleep.mode === 'end') return N.t(item && item.type === 'episode' ? 'pl.sleep.end' : 'pl.sleep.endMovie');
      return N.t('pl.sleep.left', { n: O.sleepLeft(sleep.at, U.now()) });
    }
    function sleepPanel(back) {
      var e = [];
      for (var i = 0; i < O.SLEEP.length; i++) {
        var v = O.SLEEP[i];
        e.push({ id: String(v), t: v === 'off' ? N.t('set.v.off') : v === 'end' ? N.t(item && item.type === 'episode' ? 'pl.sleep.end' : 'pl.sleep.endMovie') : N.t('pl.sleep.min', { n: v }),
          s: v === sleep.mode && typeof v === 'number' ? sleepText() : '' });
      }
      N.ui.panel.select({ title: N.t('pl.sleep'), entries: e, selected: String(sleep.mode), onCancel: back,
        onSelect: function (id) { setSleep(id === 'off' || id === 'end' ? id : Number(id)); } });
    }

    /* ---------- Fehler ---------- */
    function onError(e) {
      if (e.kind === 'server' && pb && pb.firstTick && !lost) { connLost(); return; }   // P5: lief schon -> "Verbindung unterbrochen"
      // weiterer Server: Startfehler heisst nicht "Server weg" – antwortet /identity, ist es ein Wiedergabefehler (Erneut/Geringere Qualitaet)
      if (e.kind === 'server' && isrv() && !e.checked) {
        var it1 = item;
        N.srv.ping(isrv(), function (ok) { if (!closed && item === it1) onError(U.extend(U.extend({}, e), { kind: ok ? 'playback' : 'server', checked: true })); });
        return;
      }
      acc.cancel(); hideSpin(); hideSkip(); hideUp(); hideLast(); hideOsd(true);
      errOn = true;
      if (NG) nar();                                   // schmal: Fehlerblock wie bisher im verkleinerten Kasten
      transparent(false); U.show(sbBg, true);
      var k = e.kind, kids = N.session.isKid(), txt = N.t('pl.err.' + k + '.text');
      if (kids && (k === 'fileMissing' || k === 'server' || k === 'playback')) txt += ' ' + N.t('kids.askAdult');
      var btns = k === 'playback' || k === 'busy' ? [{ id: 'retry', t: N.t('err.btn.retry') }, { id: 'lower', t: N.t('err.btn.lower') }] : [{ id: 'retry', t: N.t('err.btn.retry') }, { id: 'back', t: N.t('err.btn.back') }];
      info = e.r || info;
      s.errDetail = e.detail;
      /* Hauptaktion links, "Zurueck" rechts (NAV-11); Fokus auf "Zurueck", wo Nochmal nichts aendert (Datei fehlt, nicht freigegeben) */
      sb.show({ title: N.t('pl.err.' + k + '.title'), text: txt, buttons: btns, focus: k === 'fileMissing' || k === 'notAllowed' ? 1 : 0, onSelect: function (id) {
        if (id === 'back') { close(); return; }
        if (id === 'lower') { var q = O.lower(eff('quality'), false); sess.quality = q; N.session.setSetting('quality', q); }
        var at = pb ? pb.t : 0; if (pb) pb.stop('user');
        if (!sef.fake) transparent(true);
        play(item, at, null);
      } });
      N.router.refreshHints();
    }

    /* ---------- P5: Verbindung unterbrochen (SPEC 9, 10.5 err.connLost): pausieren, Insel, alle 5 s pruefen, an derselben Stelle weiter ---------- */
    function connLost() {
      if (lost || closed) return;
      lost = { at: pb ? pb.t : 0 };
      N.log('Verbindung unterbrochen bei ' + hms(lost.at));
      acc.cancel(); hideSpin(); hideSkip(); hideUp(); hideLast(); hideOsd(true); clearLow();
      if (pb && (pb.state === 'playing' || pb.state === 'buffering')) pb.pause();
      N.tv.saver(true);
      setLostF(0); U.show(lostEl, true);
      N.router.refreshHints();
      lostLoop();
    }
    function lostLoop() {
      if (lostT) clearTimeout(lostT);
      lostT = setTimeout(function () { lostT = 0; if (!lost) return; ping(function (ok) { if (!lost) return; if (ok) resumeLost(); else lostLoop(); }); }, 5000);
    }
    function hideLost() { if (lostEl) U.show(lostEl, false); }
    function setLostF(i) { U.cls(lostBtns[lostF], 'is-focus', false); lostF = i; U.cls(lostBtns[i], 'is-focus', true); }
    /* weiter an der gemerkten Stelle: neue Wiedergabe (der alte Datenstrom ist nach einem Netzausfall meist tot) */
    function resumeLost() {
      if (!lost || closed) return;
      var at = lost.at; lost = null;
      if (lostT) { clearTimeout(lostT); lostT = 0; }
      hideLost();
      N.ui.toast.show(N.t('toast.online'), { icon: 'confirm' });
      if (pb) pb.stop('user');
      play(item, at, item && item.pqi ? item : null);
    }
    function lostAct(i) {
      if (i === 1) { close(); return; }
      U.setText(lostBtns[0].firstChild, N.t('net.bar.checkingShort'));
      ping(function (ok) { U.setText(lostBtns[0].firstChild, N.t('err.btn.retry')); if (ok) resumeLost(); else N.ui.toast.show(N.t('err.connLost.still')); });
    }

    /* ---------- Panels ---------- */
    function tracks(tab) {
      if (!pb || !pb.meta) return;
      N.ui.tracks.open({ tracks: pb.meta.tracks, tab: tab, hls: pb.hls, ass: eff('ass'), onPick: function (kind, id) {
        pb.changeTrack(kind, id);
        rememberTracks();
      } });
    }
    function rememberTracks() {
      var m = pb.meta;
      if (!eff('rememberTracks') || !m.showRk) return;
      var T = m.tracks, st = N.tracks.selected(T.subs);
      trackMem = N.tracks.remember(trackMem, mkey(m.showRk), N.tracks.selected(T.audio), st || 0, U.now());
      N.store.set(memFile(), trackMem);
      N.ui.toast.show(N.t('pl.toast.remembered'), { icon: 'confirm' });
    }
    /* Kapitel (Gelb / Knopf): Liste mit Startzeit und Kapitelbild (falls der Server welche hat, includeChapters=1), OK springt sofort */
    function chapters() {
      if (!chs.length || !pb) return;
      var L = O.chapterList(chs, pb.t, hms), imgs = false;
      for (var i = 0; i < L.entries.length; i++) if (L.entries[i].img) { imgs = true; L.entries[i].img = N.img.url(N.srv.tag(isrv(), L.entries[i].img), 'chapter'); }
      N.ui.panel.select({ title: N.t('pl.chapters'), entries: L.entries, selected: String(L.cur), images: imgs, onSelect: function (id) {
        var c = chs[Number(id)];
        N.ui.toast.show(N.t('pl.jumpTo', { time: hms(c.start) }));
        seekTo(c.start + 1, true);
      } });
    }
    /* INFO: Modus in Klartext, Datei, was zum TV geht, Grund, Untertitel, Bildformat, Tastenhilfe */
    function infoPanel() {
      var m = pb && pb.meta, lines = [], r = info, V = function (x) { return x === 'copy' ? N.t('pl.v.copy') : (x || '?').toUpperCase(); };
      if (r && r.mode) lines.push(N.t(N.decision.modeKey(r, pb && pb.subMode === 'burn')));
      if (m) lines.push(N.t('pl.info.file', { v: (m.vcodec || '?').toUpperCase() + (m.res ? ' ' + (/^\d+$/.test(m.res) ? m.res + 'p' : m.res.toUpperCase()) : ''), a: (m.acodec || '?').toUpperCase(), c: (m.container || '?').toUpperCase() }));
      if (m && m.bitrate) lines.push(N.t('pl.info.bitrate', { n: Math.round(m.bitrate / 100) / 10 }));
      if (r && r.mode && r.mode !== 'direct') {
        lines.push(N.t('pl.info.out', { v: r.video === 'copy' ? N.t('pl.v.copy') : V(r.vcodec || 'h264'), a: V(r.audio === 'copy' ? 'copy' : 'ac3') }));
        if (r.mode === 'transcode') {                     // wirksame Grenze: beim Umwandeln bzw. niedriger ueber das Internet/Mobilfunk (PLAY-36)
          var cq = N.decision.cap(U.extend(pb.capOpts(), { quality: eff('quality') }));
          lines.push(N.t('pl.info.quality', { q: N.t('set.v.q', { n: cq[0] / 1000, r: N.decision.resText(cq[1]) }) }));
        }
      }
      if (r && r.reason) lines.push(N.t('pl.info.reason', { r: r.reason }));
      lines.push(pb && pb.sub && pb.subMode !== 'none' ? N.t('pl.info.sub', { s: pb.sub.label, w: N.t('pl.info.way.' + pb.subMode) }) : N.t('pl.info.subOff'));
      lines.push(N.t('pl.info.aspect', { a: N.t('set.v.' + aspectKey(eff('aspect'))) }));
      if (errOn && s.errDetail) lines.push(N.t('pl.info.detail', { d: s.errDetail }));
      lines.push('', N.t('pl.info.keys'));
      N.ui.panel.help(m ? (m.show || m.title) : N.t('pl.info.title'), lines.join('\n'));
    }
    function aspectKey(a) { return a === '43' ? 'a43' : a || 'auto'; }

    /* ---------- Mehr (TOOLS): Einstellungen fuer diese Wiedergabe ---------- */
    function more(focusId) {
      if (!pb || !pb.meta) return;
      var vs = pb.meta.versions, direct = !!(info && info.mode === 'direct'), entries = O.more({ version: vs.length > 1 ? vs[pb.meta.mi].label : '', direct: direct, quality: eff('quality'), aspect: eff('aspect'),
        subsOn: pb.subMode === 'sef' || pb.subMode === 'sidecar', subSize: eff('subSize'), subBg: eff('subBg'), subDelay: Number(eff('subDelay')) || 0,
        markers: !!(pb.meta.markers && pb.meta.markers.length), skipIntro: eff('skipIntro'), skipCredits: eff('skipCredits'),
        autoNext: !!eff('autoNext'), ep: pb.meta.type === 'episode', sleep: sleepText(), subSearch: N.session.isAdmin() && !N.session.isKid() });
      var f = 0;
      for (var i = 0; i < entries.length; i++) if (entries[i].id === focusId) f = i;
      function back(id) { return function () { more(id); }; }
      N.ui.panel.select({ title: N.t('pl.more'), entries: entries, focus: f, onSelect: function (id) {
        if (id === 'version') versions(back(id));
        else if (id === 'quality') quality(back(id));
        else if (id === 'aspect') pick(id, 'pl.m.aspect', ['auto', 'orig', 'fill', '43', 'zoom'], aspectKey, function (v) {
          sess.aspect = v; pcfg.aspect = v; if (pb) pb.setAspect(v); N.ui.toast.show(N.t('pl.toast.aspect', { a: N.t('set.v.' + aspectKey(v)) }));
        }, back(id));
        else if (id === 'subs') subsMenu(back(id));
        else if (id === 'skipIntro' || id === 'skipCredits') pick(id, 'pl.m.' + id, ['off', 'button', 'auto'], null, function (v) {
          sess[id] = v; pcfg[id] = v; if (mk) mk.cfg[id === 'skipIntro' ? 'intro' : 'credits'] = v;
        }, back(id));
        else if (id === 'autoNext') pick(id, 'pl.m.autoNext', [true, false], function (v) { return v ? 'on' : 'off'; }, function (v) {
          sess.autoNext = v; pcfg.autoNext = v; if (mk) mk.cfg.autoNext = v;
          if (v && !queue && pb && pb.meta && pb.meta.type === 'episode') makeQueue(pb.meta);
        }, back(id), 'set.');
        else if (id === 'sleep') sleepPanel(back(id));
        else if (id === 'problem') problem(back(id));
        else if (id === 'subsearch') subSearch(back(id));
      } });
    }
    /* Auswahl-Untermenue: Werte vals, Text 'set.v.<key>' (bzw. pre+key), RETURN zurueck ins Mehr-Menue */
    function pick(id, title, vals, keyFn, apply, back, pre) {
      var e = [], cur = eff(id);
      for (var i = 0; i < vals.length; i++) e.push({ id: String(vals[i]), t: N.t((pre || 'set.v.') + (keyFn ? keyFn(vals[i]) : vals[i])) });
      N.ui.panel.select({ title: N.t(title), entries: e, selected: String(cur === undefined ? vals[0] : cur), onCancel: back, onSelect: function (v) {
        for (var j = 0; j < vals.length; j++) if (String(vals[j]) === v) apply(vals[j]);
      } });
    }
    /* Qualitaet: Direct Play -> "Original (ohne Grenze)" (wie in den Einstellungen); andere Stufe = Umwandlung an der Stelle neu starten */
    function quality(back) {
      var direct = !!(info && info.mode === 'direct'), e = [], D = N.decision, QS = D.nums(), cq = D.eff(eff('quality'));
      if (direct || sess.forced) e.push({ id: 'orig', t: N.t('set.v.qOrig'), s: N.t('pl.q.origSub') });
      for (var i = 0; i < QS.length; i++) e.push({ id: QS[i], t: D.label(QS[i]) });
      if (cq === D.ORIG) cq = D.top();               // Einstellung Original: umgewandelt wird mit der hoechsten Stufe (PLAY-37)
      N.ui.panel.select({ title: N.t('pl.m.quality'), entries: e, selected: direct ? 'orig' : cq, onCancel: back, onSelect: function (v) {
        if (!pb) return;
        if (v === 'orig') { if (direct) return; sess.forced = false; restartAt({ dp: cfg().directPlay !== false, ds: true }); N.ui.toast.show(N.t('pl.toast.quality', { q: N.t('set.v.qOrig') })); return; }
        if (!direct && v === cq) return;
        sess.quality = v; pcfg.quality = v;
        if (direct || (info && info.mode === 'stream')) sess.forced = true;
        restartAt(sess.forced ? { dp: false, ds: false } : null);
        N.ui.toast.show(N.t('pl.toast.quality', { q: D.label(v) }));
      } });
    }
    /* Version (mehrere Dateien): Wahl gilt fuer diesen Titel in dieser Sitzung; neue Wiedergabe an derselben Stelle */
    function versions(back) {
      var vs = pb.meta.versions, e = [];
      for (var i = 0; i < vs.length; i++) e.push({ id: String(i), t: vs[i].label, s: vs[i].sub });
      N.ui.panel.select({ title: N.t('pl.m.version'), entries: e, selected: String(pb.meta.mi), onCancel: back, onSelect: function (v) {
        var i = Number(v);
        if (!pb || i === pb.meta.mi) return;
        N.versions.set(item.rk, i);
        N.ui.toast.show(N.t('pl.toast.version', { v: vs[i].label }));
        var at = pb.t; pb.stop('user');
        play(item, at, item.pqi ? item : null);
      } });
    }
    function restartAt(att) { if (!pb) return; acc.cancel(); showSpin(N.t('common.loading')); pb.restart(pb.t, att || undefined); }
    /* Untertitel-Darstellung (nur bei UT an): Groesse, Position, Hintergrund, Verzoegerung */
    function subsMenu(back) {
      var v = function (k) { return N.t('set.v.' + k); };
      var e = [{ id: 'subSize', t: N.t('pl.m.subSize'), s: v(eff('subSize') || 'medium') }, { id: 'subPos', t: N.t('pl.m.subPos'), s: v(eff('subPos') || 'low') },
        { id: 'subColor', t: N.t('pl.m.subColor'), s: v(eff('subColor') || 'white') },
        { id: 'subBg', t: N.t('pl.m.subBg'), s: v(eff('subBg') || 'dim') }, { id: 'subDelay', t: N.t('pl.m.subDelay'), s: O.delayText(Number(eff('subDelay')) || 0) }];
      function again(id) { return function () { subsMenu(back); }; }
      N.ui.panel.select({ title: N.t('pl.m.subs'), entries: e, onCancel: back, onSelect: function (id) {
        var look = function (val) { sess[id] = val; pcfg[id] = val; subLook(); };
        if (id === 'subSize') pick(id, 'pl.m.subSize', ['small', 'medium', 'large', 'xl'], null, look, again(id));
        else if (id === 'subColor') pick(id, 'pl.m.subColor', ['white', 'yellow'], null, look, again(id));
        else if (id === 'subPos') pick(id, 'pl.m.subPos', ['low', 'high'], null, look, again(id));
        else if (id === 'subBg') pick(id, 'pl.m.subBg', ['dim', 'solid', 'none'], null, look, again(id));
        else {
          var d = [], cur = Number(eff('subDelay')) || 0;
          for (var i = 0; i < O.DELAYS.length; i++) d.push({ id: String(O.DELAYS[i]), t: O.delayText(O.DELAYS[i]) });
          N.ui.panel.select({ title: N.t('pl.m.subDelay'), entries: d, selected: String(cur), onCancel: again(id), onSelect: function (val) {
            var ms = Number(val); sess.subDelay = ms; pcfg.subDelay = ms; cueI = -1;
            if (pb) pb.setSubDelay(ms);
            N.ui.toast.show(N.t('pl.toast.delay', { d: O.delayText(ms) }));
          } });
        }
      } });
    }
    /* P5 Untertitel suchen (OpenSubtitles ueber den PMS): Sprache -> Suche (lesend) -> Treffer -> WARNUNG -> Herunterladen (schreibt).
     * Herunterladen ist am echten Server noch nicht getestet (Nutzer-OK noetig, docs/P5-TV-TEST.md). */
    function subSearch(back) {
      if (!pb || !pb.meta) return;
      var rk = pb.meta.rk, again = function () { subSearch(back); };
      N.ui.panel.select({ title: N.t('pl.ss.title'), entries: [{ id: 'de', t: N.t('set.v.de') }, { id: 'en', t: N.t('set.v.en') }], onCancel: back, onSelect: function (lang) {
        N.ui.toast.show(N.t('pl.ss.searching'));
        N.subSearch.search(rk, lang, function (err, res) {
          if (closed || !pb || pb.meta.rk !== rk) return;
          N.ui.toast.hide();
          if (err) { N.ui.toast.show(N.t('pl.ss.failed'), { icon: 'info' }); return; }
          if (!res.length) { N.ui.toast.show(N.t('pl.ss.none')); again(); return; }
          var e = [];
          for (var i = 0; i < res.length && i < 20; i++) e.push({ id: String(i), t: res[i].title || N.tracks.langName(res[i].lang), s: N.subSearch.subline(res[i]) });
          N.ui.panel.select({ title: N.t('pl.ss.results', { n: res.length }), entries: e, onCancel: again, onSelect: function (id) { subWarn(rk, res[Number(id)], again); } });
        }, isrv());
      } });
    }
    function subWarn(rk, r, back) {
      N.ui.dialog.open({ title: N.t('dlg.subDl.title'), text: N.t('dlg.subDl.text'), focus: 0, vertical: true,
        buttons: [{ id: 'ok', t: N.t('dlg.subDl.confirm') }, { id: 'cancel', t: N.t('dlg.subDl.cancel') }], onCancel: back,
        onSelect: function (id) {
          if (id !== 'ok') { back(); return; }
          N.subSearch.download(rk, r.key, true, function (err) {
            if (closed) return;
            if (err) { N.ui.toast.show(N.t(err.status === 401 || err.status === 403 ? 'pl.ss.denied' : 'pl.ss.dlFailed'), { icon: 'info' }); return; }
            N.ui.toast.show(N.t('pl.ss.done'), { icon: 'confirm' });
            var at = pb ? pb.t : 0; if (pb) pb.stop('user');               // neu laden: die neue Spur steht danach unter Ton & Untertitel
            play(item, at, item && item.pqi ? item : null);
          }, isrv());
        } });
    }
    /* "Problem mit der Wiedergabe?": Neu laden · Umwandlung erzwingen · Geringere Qualitaet · Technische Infos */
    function problem(back) {
      var e = [{ id: 'reload', t: N.t('pl.p.reload'), s: N.t('pl.p.reload.s') }, { id: 'force', t: N.t('pl.p.force'), s: N.t('pl.p.force.s') },
        { id: 'lower', t: N.t('pl.p.lower'), s: N.t('pl.p.lower.s') }, { id: 'info', t: N.t('pl.p.info'), s: '' }];
      N.ui.panel.select({ title: N.t('pl.m.problem'), entries: e, onCancel: back, onSelect: function (id) {
        var direct = !!(info && info.mode === 'direct');
        if (id === 'reload') { N.ui.toast.show(N.t('pl.toast.reload')); restartAt(null); }
        else if (id === 'force') { sess.forced = true; restartAt({ dp: false, ds: false }); }
        else if (id === 'lower') lowerQuality();
        else infoPanel();
      } });
    }

    /* ---------- Tasten ---------- */
    s.onKey = function (k) {
      if (dirSync() && osd) { setZone(zone, true); miniHints(!!(pb && pb.state === 'paused')); }   // erste Taste nach Finger/Maus: Fokus und Tastenkappen wieder, Zurueck weg
      if (lp.isOpen()) { lp.cancel(); lpEnd(); if (k === 'RETURN') { showOsd(); return true; } }   // jede Taste schliesst, RETURN nur die Feinauswahl
      else lp.cancel();
      if (lost) {
        if (k === 'LEFT' || k === 'RIGHT') setLostF(k === 'LEFT' ? 0 : 1);
        else if (k === 'ENTER') lostAct(lostF);
        else if (k === 'RETURN' || k === 'STOP') close();
        return true;
      }
      if (errOn) {
        if (sb.onKey(k)) return true;
        if (k === 'INFO') infoPanel();
        else if (k === 'RETURN' || k === 'STOP') close();
        return true;
      }
      if (cdOn) {
        if (k === 'LEFT' || k === 'RIGHT') { setUpF(k === 'LEFT' ? 0 : 1); return true; }
        if (k === 'ENTER') { upAct(upF); return true; }
        if (k === 'RETURN') { upAct(1); return true; }
      }
      if (lastOn) {
        var two = lastBtns[1].style.display !== 'none';
        if ((k === 'LEFT' || k === 'RIGHT') && two) { setLastF(k === 'LEFT' ? 0 : 1); return true; }
        if (k === 'ENTER') { lastAct(lastF); return true; }
        if (k === 'RETURN') { lastAct(two ? 1 : 0); return true; }
      }
      if (k !== 'FF' && k !== 'RW') hintOff();
      // Schnellspulen: PLAY/OK/RETURN = normal weiter an der Stelle; Navigation in der Knopfreihe laesst es laufen; alles andere beendet
      // es zuerst und wirkt dann wie gewohnt (Pause, Sprung, Ziffern, Farbtasten, Stop, OK auf einem anderen Knopf)
      if (trickOn() && k !== 'FF' && k !== 'RW' && k !== 'UP' && k !== 'DOWN' && !((k === 'LEFT' || k === 'RIGHT') && osd && zone === 'btn')) {
        /* Stop, CH und ⏮/⏭ verlassen das Video gleich: ohne eigene "playing"-Meldung direkt vor "stopped" (quiet) */
        pb.normal(k === 'STOP' || k === 'CH_UP' || k === 'CH_DOWN' || (k === 'ENTER' && osd && zone === 'btn' && (fb === 'prev' || fb === 'next')));
        if (k === 'PLAY' || k === 'RETURN' || (k === 'ENTER' && !(osd && zone === 'btn' && fb !== 'pp'))) { showOsd(); return true; }
      }
      var A = arrows(), was = osd;
      switch (k) {
        case 'PLAY': if (pb) pb.play(); showOsd(); return true;
        case 'PAUSE': if (pb) pb.pause(); showOsd(); return true;
        case 'STOP': close(); return true;
        case 'RW': ffrwKey(-1); return true;
        case 'FF': ffrwKey(1); return true;
        case 'CH_UP': if (pn) { showOsd(); stepItem(-1); } return true;   // wie Jetzt laeuft: CH▲ = vorige, CH▼ = naechste
        case 'CH_DOWN': if (pn) { showOsd(); stepItem(1); } return true;
        case 'GREEN': showOsd(); tracks('a'); return true;
        case 'SUBTITLE': showOsd(); tracks('s'); return true;
        case 'YELLOW': showOsd(); chapters(); return true;
        case 'BLUE': showOsd(); sleepPanel(null); return true;
        case 'TOOLS': showOsd(); more(); return true;
        case 'INFO': showOsd(); infoPanel(); return true;
      }
      if (N.keys.isDigit(k)) {
        if (k !== '0' && dur()) {                          // 1–9: n x 10 % (0 ohne Funktion, Schutz vor Neustart)
          var tg = dur() * Number(k) / 10;
          N.ui.toast.show(N.t('pl.jumpTo', { time: hms(tg) }));
          seekTo(tg, false); showOsd();
        }
        return true;
      }
      if (!was) {                                          // OSD verborgen (SPEC 7.10 Tastenkarte)
        if (k === 'ENTER') { if (btnKind) doSkip(); else { showOsd(); setZone('btn', false, 'pp'); } return true; }
        if (k === 'LEFT' || k === 'RIGHT') { showOsd(); setZone('bar'); quick = true; seekBy(k === 'LEFT' ? -A.b * 1000 : A.f * 1000, true); return true; }
        if (k === 'UP') { showOsd(); setZone('btn', false, 'pp'); return true; }
        if (k === 'DOWN') { showOsd(); setZone('bar'); return true; }
        if (k === 'RETURN') { close(); return true; }
        return true;
      }
      showOsd();                                           // OSD sichtbar: jede Taste haelt es
      switch (k) {
        case 'RETURN':
          if (acc.active()) { cancelSeek(); return true; }
          hideOsd(); return true;
        case 'LEFT': case 'RIGHT':
          if (zone === 'btn') { var n = O.nav(ids, fb, k); if (n !== fb) setZone('btn', false, n); }
          else if (zone === 'bar') seekBy(k === 'LEFT' ? -A.b * 1000 : A.f * 1000, true);
          return true;
        case 'UP':
          if (zone === 'btn') setZone('bar'); else if (zone === 'bar' && btnKind) setZone('skip');
          return true;
        case 'DOWN':
          if (zone === 'skip') setZone('bar'); else if (zone === 'bar') { if (acc.active()) acc.commit(); setZone('btn'); }
          return true;
        case 'ENTER':
          if (zone === 'skip') { doSkip(); return true; }
          if (zone === 'bar') { if (acc.active()) acc.commit(); else if (pb) { pb.toggle(); showOsd(); } return true; }
          activate(fb); return true;
      }
      return true;
    };
    /* ---------- Zeiger: Bewegung zeigt das OSD (und haelt es), Hover fokussiert, alles anklickbar ---------- */
    s.pointer = function (x, y, kind) {
      var sp = N.screen.fromStage(x, y), pt = full(sp.x, sp.y); x = pt.x; y = pt.y;   // Kasten- -> Bildschirm- -> Raster-Punkt (TV: gleich)
      if (lost) {                                            // Insel "Verbindung unterbrochen": Knoepfe x 424/616, y 388
        if (y >= G.LOY + 128 && y < G.LOY + 176 && x >= G.LOX + 24 && x < G.LOX + 408) { var li2 = x < G.LOX + 216 ? 0 : 1; if (li2 !== lostF) setLostF(li2); if (kind === 'click') lostAct(li2); }
        return true;
      }
      if (errOn) return sb.pointer(x, y, kind);
      var tch = N.input.mode === 'touch';
      if (dirSync() && osd) { setZone(zone, true); miniHints(!!(pb && pb.state === 'paused') && osd); }   // Taste -> Finger/Maus: Fokus und Tastenkappen weg
      if (tch && kind === 'move') return true;               // Finger: kein Zeigen (das Tippen kommt als Klick, OSD erst dort)
      if (lp.isOpen()) {                                      // Feinauswahl hat Vorrang (ihr Band deckt die Knopfreihe mit ab)
        if (kind === 'click') {                               // Klick: setzt das Ziel oder schliesst nur – loest nie einen Knopf aus
          var lms = lp.click(x, y, lpBand);
          lpEnd(); hoverOff();
          if (lms >= 0) clickSeek(lms); else showOsd();
          return true;
        } else {
          var r = lp.move(x, y, lpBand);
          if (r && !r.exit) { showOsd(); if (!r.same) lpMove(r); return true; }
          lpEnd();                                            // verlassen: unten wie gewohnt weiter (grobe Vorschau, Knoepfe)
        }
      }
      var cy = NG ? NG.CBY : osd ? 382 : 588;               // Countdown-/Letzte-Folge-Karte: bei sichtbarem OSD ueber der Bedien-Insel (schmal: fest)
      if (cdOn && x >= G.UPX && y >= cy && y < cy + 48) {
        var i = x < G.UPX + 200 ? 0 : 1;
        if (i !== upF) setUpF(i);
        if (kind === 'click') upAct(i);
        return true;
      }
      if (lastOn && x >= G.UPX && y >= cy && y < cy + 48) {
        var li = x < G.UPX + 200 ? 0 : 1;
        if (li === 1 && lastBtns[1].style.display === 'none') return true;
        if (li !== lastF) setLastF(li);
        if (kind === 'click') lastAct(li);
        return true;
      }
      var was = osd;
      // Schnellspulen: ein Klick beendet es; auf Play/Pause oder freier Flaeche nur das (normal weiter), sonst wirkt der Klick wie gewohnt
      if (kind === 'click' && trickOn()) { var tb = O.hit(ids, x, y, G.osd); pb.normal(tb === 'prev' || tb === 'next'); if (tb === 'pp' || (!tb && !(y >= G.BAR_Y - 16 && y < G.BAR_Y + 16))) { showOsd(); return true; } }
      showOsd();
      if (btnKind && x >= G.SKX0 && x < G.SKX1 && y >= G.SKIP_Y && y < G.SKIP_Y + 48) { if (zone !== 'skip') setZone('skip'); if (kind === 'click') doSkip(); return true; }
      if (!was && kind === 'click') return true;           // erster Klick blendet nur ein
      // Zurueck-Knopf oben links (Insel 72 x 72 bei x 64, y 36; Trefferflaeche +8): beendet die Wiedergabe wie RETURN/STOP
      if (dir && x >= G.TX - 8 && x < G.TX + 80 && y >= G.TY - 8 && y < G.TY + 80) { if (kind === 'click') close(); return true; }
      // Balken: 32 px hohe Trefferzone (Kopf 24 px + Rand), endet ueber den Zeiten (y 500); Bewegung = Vorschau, Klick = Sprung
      var onBar = x >= G.BAR_X - 8 && x < G.BAR_X + G.BAR_W + 8 && y >= G.BAR_Y - 16 && y < G.BAR_Y + 16 && dur() > 0;
      if (!onBar) { hoverOff(); lp.leave(); }
      var b = O.hit(ids, x, y, G.osd);
      if (b) { if (zone !== 'btn' || b !== fb) setZone('btn', false, b); if (kind === 'click') activate(b); return true; }
      if (onBar) {
        if (zone !== 'bar') setZone('bar');
        if (kind === 'click') { lp.cancel(x, y); hoverOff(); clickSeek(dur() * U.clamp((x - G.BAR_X) / G.BAR_W, 0, 1)); }
        else { hover(x); if (eff('ptrLoupe') === true) lp.track(x, y); }   // ruhig halten -> Feinauswahl (Einstellung)
        return true;
      }
      if (mhRects && mh.style.display !== 'none' && y >= G.MH_Y && y < G.MH_Y + MH_H) {
        for (var j = 0; j < mhRects.length; j++) if (x >= mhRects[j].x - 8 && x < mhRects[j].x + mhRects[j].w + 8) { if (kind === 'click') N.router.key(mhRects[j].k); return true; }
      }
      if (kind === 'click' && (y < G.ISY || y >= G.ISY + G.ISH)) {   // freie Flaeche: Zeiger/Maus Pause/Weiter, Finger blendet aus
        if (tch) hideOsd(); else { if (pb) pb.toggle(); showOsd(); }
      }
      return true;
    };
    return s;
  });

  /* ---------- Einstieg ---------- */
  var lastOpen = 0, lastStop = null, STOP_KEEP = 600000;
  /* TV-Test 30.10.: nach STOP bei 10:57 begann "Abspielen" bei 0:01 ohne Frage – die Seite hatte noch die Position von vor dem
   * Abspielen (0). Position fuer den zuletzt gestoppten Titel: die eigene vom Stopp, solange der Server (noch) eine kleinere nennt
   * (hoechstens 10 Min.; gesehen/zu Ende oder Gelb "gesehen/ungesehen" verwirft sie). Rein (Tests): (it, stop, now) -> ms */
  function resumeAt(it, st, now) {
    var off = N.model.progress(it) > 0 ? it.off : 0;
    if (!st || String(it.rk) !== st.rk || (it.srv || '') !== st.srv || now - st.at > STOP_KEEP || st.off <= off) return off;
    if (it.dur > 0 && st.off / it.dur >= (N.config.watchedThreshold || 0.9)) return off;
    return st.off;
  }
  N.evt.on('watched:changed', function () { lastStop = null; });
  N.player = {
    resumeAt: resumeAt,
    _setStop: function (st) { lastStop = st; },
    /* how: 'ask' (OK auf Karte, Einstellung entscheidet) | 'resume' (PLAY) | 'start' */
    play: function (it, how) {
      if (!it || !N.model.isLeaf(it)) return false;
      var now = U.now();
      if (now - lastOpen < 600) return true;          // Doppelstart-Schutz (SPEC 14.10)
      lastOpen = now;
      var srvOff = N.model.progress(it) > 0 ? it.off : 0, off = resumeAt(it, lastStop, now), mode = how === 'ask' ? (cfg().resume || 'ask') : how, rw = N.comfort.rewind(off, cfg().resumeRewind);
      if (off !== srvOff) N.log('player fortsetzen: eigene Stopp-Stelle ' + Math.round(off / 1000) + ' s (Server ' + Math.round(srvOff / 1000) + ' s)');
      if (!off || mode === 'resume') { N.player.open(it, rw); return true; }
      if (mode === 'start') { N.player.open(it, 0); return true; }
      N.ui.dialog.open({ title: it.type === 'episode' ? N.t('pl.epTitle', { s: it.s, e: it.e, t: it.epTitle }) : it.title,
        buttons: [{ id: 'resume', t: N.t('pl.resumeAt', { time: hms(off) }) }, { id: 'start', t: N.t('pl.fromStart') }], focus: 0, vertical: true,
        onSelect: function (id) { lastOpen = 0; N.player.open(it, id === 'resume' ? rw : 0); } });
      return true;
    },
    open: function (it, off) { if (N.audio) N.audio.stop('video'); N.router.push('player', { it: it, off: off }); },   // M4: Video stoppt Musik
    /* P5 Bildschirmschoner: laeuft/pausiert ein Video? {active, paused, item} oder null */
    status: function () { return status ? status() : null; }
  };
})(N);
