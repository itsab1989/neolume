/* N.pointer – Smart-Control-Zeiger (Luftmaus-Punkt; Touchpad-Druck = Klick). Nutzer-Anforderung M2.
 * - NUR delegierte Listener am Root (keine pro Karte) -> Tastennavigation bleibt unberuehrt.
 * - mousemove mit Vorderflanke: erste Bewegung sofort, danach hoechstens alle 40 ms (letzte Position gewinnt) -> Ziel per
 *   Index-Mathe (N.hit / N.RowMath.hit) -> Fokus ueber dieselben Fokus-Funktionen wie die Tasten. Zeiger-Fokus springt ohne
 *   Gleiten (N.fx.step(true): nur die bewegten Elemente ohne Uebergang), Tasten gleiten weiter.
 * - Hinweisleiste anklickbar (Klick auf einen Eintrag = diese Taste; Smart Control hat z. B. kein TOOLS).
 * - Langes Druecken auf das Touchpad (>= 800 ms) = TOOLS (Optionen) fuer das Element unter dem Punkt; der Klick danach entfaellt.
 * - Maus/Trackpad (caps.pointer 'mouse'): Rechtsklick/Ctrl-Klick = sofort TOOLS fuer das Element unter dem Zeiger (P.context, NAV-25).
 * - Letzte Eingabe gewinnt: nach einer Taste werden Zeiger-Bewegungen ignoriert, bis sich der Punkt deutlich bewegt (> 16 px).
 * - Klick = OK auf dem Element unter dem Punkt. Blaetter-Pfeile an der fokussierten Reihe nur bei aktivem Zeiger.
 * - Mausrad (falls geliefert) -> Tasten der Zone (Reihe: LINKS/RECHTS, Liste: HOCH/RUNTER), hoechstens alle 150 ms.
 * - TV-Befund 27.10. nachmittags ("Liste scrollt wild"): Hover darf nie eine Rueckkopplung ausloesen (Fokus -> Liste rollt ->
 *   anderes Element unter dem stehenden Punkt -> Fokus …). Darum:
 *   a) Zitterschwelle: Bewegungen < JITTER px gegenueber der zuletzt ausgewerteten Position werden nicht ausgewertet;
 *      Ereignisse mit unveraenderter Position (WebKit feuert mousemove, wenn Inhalt unter dem Punkt wandert) ohnehin nicht.
 *   b) Scroll-Sperre: hat eine Zeiger-Bewegung den Inhalt verschoben (pointerSig() vorher != nachher), wertet der Zeiger erst
 *      wieder aus, wenn SCROLL_COOL ms vergangen sind UND der Punkt sich um >= SCROLL_MOVE px von der Stelle entfernt hat.
 *   c) Listen/Raster fokussieren per Zeiger "still" (ohne zu rollen); geblaettert wird ueber Randzonen (pointerEdge: erst nach
 *      EDGE_DWELL ms Verweilen, dann ein Schritt je P.edgeDelay: beschleunigt 400 ms -> 120 ms bzw. gleichmaessig EDGE_RATE ms,
 *      Einstellung "Zeiger-Scrollen beschleunigen") oder Mausrad. Nur ganz sichtbare Zeilen bekommen sofort Zeiger-Fokus;
 *      eine angeschnittene, aber zu >= 40 % sichtbare Zeile nach HOLD ms Verweilen (EIN Schritt Rollen, dann Sperre).
 *   d) Lebenszeichen: Liegt der Finger auf dem Touchpad, kommen laufend kleinste Bewegungen (auch unter JITTER). Bleibt LIVE ms
 *      jedes Roh-Ereignis mit neuer Position aus, ist der Finger weg (der Punkt bleibt am TV stehen) -> Randzonen-Rollen endet.
 *      Ereignisse mit gleicher Position zaehlen nicht (WebKit schickt sie, wenn Inhalt unter dem Punkt wandert). Ein Ausblende-
 *      Ereignis gibt es am TV nicht (Log 27.10.); Wiederauflegen = Sprung in die Bildmitte (P.retouch) beendet Rollen sofort. Liefert ein TV
 *      im Stillstand gar keine Ereignisse, braucht das Rollen fortlaufende (auch winzige) Bewegung. Dev: "ptr raw n/med/p90/max"
 *      im Protokoll zeigt die Abstaende je Randzonen-Lauf.
 * Ziel-Schnittstelle (Bildschirm/Overlay/Rail): pointer(x, y, kind:'move'|'click', target) -> bool,
 *   optional pointerArrows() -> {y, h, left, right} | null, pointerPage(dir), wheelKeys ['LEFT','RIGHT'],
 *   pointerSig() -> Zahl/Text der aktuellen Scroll-Lage, pointerEdge(x, y) -> {d: -1|1, x, y} | null (Randzone, Anzeige-Mitte),
 *   pointerScroll(d) (einen Schritt rollen, Fokus bleibt sichtbar),
 *   pointerGrab(x, y) -> 'drag' | 'tap' | '' (Finger/Maus-Druck an dieser Stelle: Ziehen an pointerDrag, nur Tippen, Standard),
 *   pointerDrag(phase 'start'|'move'|'end'|'cancel', x, y) -> bool (start: true = uebernommen), touchLong (false = langer
 *   Finger-Druck tut nichts statt TOOLS), pointerDown(x, y) (Finger/Maus gedrueckt: z. B. Schwung anhalten),
 *   wheel(x, y, dx, dy) -> bool (nur caps.scroll 'free': Rad/Trackpad-Weg in App-px, P.wheelPx; auch am obersten Overlay)
 * Eingabeart (Entscheidung Apple Nr. 14): EINE Quelle N.input.mode = 'key' | 'pointer' | 'touch' (src/core/input.js); hier gesetzt
 *   aus Maus-Ereignissen (pointer bzw. touch), Tasten setzt App.press. Finger-Ereignisse tragen
 *   e.pnInput = 'touch' (Touch-Schicht der Plattform). Ziehen (P.grab/P.drag): Finger ueber App.grab/App.drag, Maus nur bei
 *   caps.pointer 'mouse' (Druck auf ein Zug-Ziel -> Bewegungen gehen an pointerDrag, der Klick danach entfaellt). TV unveraendert. */
(function (N) {
  var U = N.util, THROTTLE = 40, IDLE = 3000, KEY_GUARD = 16, LONG = 800;
  var JITTER = 4, SCROLL_COOL = 450, SCROLL_MOVE = 40, EDGE_DWELL = 400, EDGE_RATE = 300, WHEEL_RATE = 150, EDGE_SLOW = 400, EDGE_FAST = 120, LIVE = 1000, HOLD = 250, CX = 640, CY = 360, CENTRE = 8, JUMP = 200;
  // LIVE (TV-Log 27.10., dev/ptrlog.js): ruhig gehaltene Fernbedienung mit Finger auf dem Pad -> Roh-Ereignisse p90 ~340 ms,
  // max ~710 ms; Loslassen liefert KEIN Ereignis (kein mouseout/blur), nur Stille -> 1 s Frist = kurzer Nachlauf, kein Abbruch
  // beim Stillhalten. Wiederauflegen: Punkt erscheint in der Bildmitte (~639,360) = Sprung, siehe P.retouch.
  var P = { on: true, root: null, x: -1, y: -1, pend: false, timer: 0, lastMove: 0, keyT: 0, ax: -1, ay: -1, idleT: 0, arrows: null, arrowsOn: false,
    rx: -1e4, ry: -1e4, rawT: 0, holdT: 0, gaps: [], lockT: 0, lx: 0, ly: 0, edge: null, edgeT: 0, edgeEl: null, wheelT: 0,
    dragOn: false, dragScr: null, mdrag: false, dragDone: false };
  P.accel = true;
  /* Einstellung "Mit dem Zeiger am Rand weiterblaettern" (state.ptrEdge, Standard an; TV-Befund 1.0.5): an = Verweilen in einer
   * Randzone rollt (edgeCheck), Verweilen auf einer angeschnittenen Zeile/naechsten Reihe holt sie herein (P.hold). Aus = Inhalt
   * bewegt sich nur per Klick (Klick in die Randzone = ein Schritt, Klick auf die angeschnittene Zeile), Taste oder Mausrad. */
  P.edgeAuto = true;
  P.setEdge = function (on) { P.edgeAuto = on !== false; if (!P.edgeAuto) { edgeStop(); P.holdCancel(); } };
  /* Takt der Randzone (rein, getestet): Wartezeit vor Schritt k+1, nachdem k Schritte gelaufen sind (k >= 1).
   * Beschleunigt: 3 Schritte im Abstand von 400 ms, dann je Schritt x0,8 bis 120 ms; aus: gleichmaessig 300 ms */
  P.edgeDelay = function (k, accel) {
    if (!accel) return EDGE_RATE;
    if (k < 3) return EDGE_SLOW;
    return Math.max(EDGE_FAST, Math.round(EDGE_SLOW * Math.pow(0.8, k - 2)));
  };
  P.setAccel = function (on) { P.accel = on !== false; };
  P.LIVE = LIVE; P.HOLD = HOLD;
  /* Wiederauflegen des Fingers (rein, getestet): der TV setzt den Punkt in die Bildmitte. Erkannt an Position nahe (640,360)
   * nach >= LIVE ms Stille oder nach einem Sprung > JUMP px. Kein bewusstes Zeigen -> kein Fokus/Rollen/Verweilen. */
  P.retouch = function (x, y, px, py, silent) {
    if (Math.abs(x - CX) >= CENTRE || Math.abs(y - CY) >= CENTRE) return false;
    return silent >= LIVE || (px >= 0 && Math.abs(x - px) + Math.abs(y - py) > JUMP);
  };
  P.JITTER = JITTER; P.SCROLL_COOL = SCROLL_COOL; P.SCROLL_MOVE = SCROLL_MOVE; P.EDGE_DWELL = EDGE_DWELL; P.EDGE_RATE = EDGE_RATE;

  function owner() {
    var R = N.router;
    if (R.hasOverlay()) return R.topOverlay();
    return null;
  }
  /* flexible Flaeche (N.screen, nur Apple): Overlays und Ansichten ohne scr.flex stehen im mittigen 1280x720-Kasten -> ihre
   * Koordinaten sind um dessen Lage verschoben. Am TV immer 0/0. */
  function stageOff(t, isOv) {
    if (!N.screen || !N.screen.flex || !t) return null;
    if (isOv) return N.screen.stageFor ? N.screen.stageFor(t) : N.screen.stage();
    if (!t.flex) return N.screen.stage();
    var v = N.screen.view();                         // flexible Ansicht: Breitenklasse M/K und sichere Raender verschieben den Inhalt
    return v.x || v.y ? { x: v.x, y: v.y, k: 1 } : null;
  }
  /* Flaechen-Punkt -> Kasten-Punkt (o = stageOff; k < 1: Kasten verkleinert, schmale/flache Flaeche) */
  function sx(o, x) { return o ? (x - o.x) / o.k : x; }
  function sy(o, y) { return o ? (y - o.y) / o.k : y; }
  function route(x, y, kind, target) {
    if (kind === 'click' && N.ui.toast && N.ui.toast.tap && N.ui.toast.tap(x, y)) return true;   // Rueckgaengig-Toast antippen (Nr. 26)
    var ov = owner(), o = stageOff(ov, true);
    if (ov) {
      var hit = ov.pointer ? ov.pointer(sx(o, x), sy(o, y), kind, target) : false;
      /* Finger/Maus ohne Hinweisleiste (Apple Nr. 26): Tipp neben das Fenster (Dialog, PIN …) = Abbrechen wie RETURN */
      if (!hit && kind === 'click' && N.input.direct() && ov.box && !N.hit.rect(ov.box[0], ov.box[1], ov.box[2], ov.box[3], sx(o, x), sy(o, y))) { N.router.key('RETURN'); return true; }
      return hit;
    }
    if (N.ui.hints.backHit && N.ui.hints.backHit(x, y)) { if (kind === 'click') N.router.key('RETURN'); return true; }   // Zurueck-Knopf (Nr. 26)
    var rail = N.ui.rail, scr = N.router.top(), cf = N.router.cardFrame ? N.router.cardFrame(scr) : null, slim = !!(rail && rail.slim && rail.slim());
    // flexible Flaeche M/K: Menue-Knopf bzw. Leiste unten (unter Karte und offener Seitenleiste)
    if (slim && !cf && !rail.isOpen() && N.ui.tabbar.pointer(x, y, kind)) return true;
    if (cf && !(rail && rail.isOpen())) {            // Detailkarte (nur caps.details 'card'): Inhalt, X/Pfeil, Flaeche daneben
      var ch = N.ui.card.hit(x, y);
      if (ch === 'in') { P.holdCancel(); return scr.pointer ? scr.pointer((x - cf.x) / cf.k + (cf.cut || 0), (y - cf.y) / cf.k, kind, target) : false; }
      if (!(ch === 'out' && rail && x < 112 + rail.edge() && !slim && rail.attached()) && N.router.cardPointer(x, y, kind)) return true;
    }
    if (rail && rail.attached()) {
      var rx = rail.edge ? rail.edge() : 0;          // flexibel: Spalte neben dem linken Rand (Notch quer); TV 0
      if (rail.isOpen()) {
        if (x < 320 + rx) return rail.pointer(x - rx, y, kind);
        if (kind === 'move') rail.close();           // Punkt verlaesst das Panel -> einklappen, Fokus zurueck
      } else if (x < 112 + rx && !slim && !(P.arrowsOn && arrowHit(x, y))) {
        return rail.pointer(x, y, kind);             // Punkt auf der Rail -> ausklappen
      } else if (rail.rest) rail.away();             // Punkt hat die Icon-Spalte verlassen: Darueberfahren klappt wieder auf

    }
    if (N.ui.mini && N.ui.mini.pointer(x, y, kind)) return true;   // M4: Mini-Player (Klick = Jetzt laeuft)
    if (P.arrowsOn && kind === 'click') {
      var d = arrowHit(x, y);
      if (d && scr && scr.pointerPage) { scr.pointerPage(d); return true; }
    }
    o = stageOff(scr, false);
    return scr && scr.pointer ? scr.pointer(sx(o, x), sy(o, y), kind, target) : false;
  }
  function arrowHit(x, y) {
    var a = P.curArrows;
    if (!a || y < a.y || y >= a.y + a.h) return 0;
    if (a.left && x >= a.lx && x < a.lx + 40) return -1;
    if (a.right && x >= a.rx && x < a.rx + 40) return 1;
    return 0;
  }
  /* Drossel mit Vorderflanke (rein, getestet): fire() sofort, wenn seit dem letzten Lauf >= ms vergangen sind, sonst einmal
   * am Ende des Fensters; der Aufrufer liest dann die neueste Position. */
  function Throttle(ms, fire, timers) {
    var t = timers || { now: U.now, set: function (f, d) { return setTimeout(f, d); } }, last = -1e9, timer = 0;
    this.hit = function () {
      var now = t.now(), wait = last + ms - now;
      if (wait <= 0 && !timer) { last = now; fire(); return; }
      if (!timer) timer = t.set(function () { timer = 0; last = t.now(); fire(); }, Math.max(0, wait));
    };
    this.cancel = function () { if (timer) { (t.clear || clearTimeout)(timer); timer = 0; } };
  }
  P.Throttle = Throttle;
  /* Ziel fuer Scroll-Lage/Randzonen: Overlay > offene Rail (nichts) > Bildschirm */
  function scrollOwner() {
    var ov = owner();
    if (ov) return ov;
    if (N.ui.rail && N.ui.rail.isOpen && N.ui.rail.isOpen()) return null;
    return N.router.top();
  }
  function sig(t) { return t && t.pointerSig ? String(t.pointerSig()) : ''; }
  /* Scroll-Sperre aktiv? (Inhalt hat sich durch den Zeiger bewegt; erst Zeit UND Weg) */
  P.locked = function (x, y) {
    if (!P.lockT) return false;
    if (U.now() - P.lockT >= SCROLL_COOL && Math.abs(x - P.lx) + Math.abs(y - P.ly) >= SCROLL_MOVE) { P.lockT = 0; return false; }
    return true;
  };
  P.scrolled = function () { P.lockT = U.now(); P.lx = P.x; P.ly = P.y; };
  /* Apple Nr. 29 (SPEC NAV-23): Inhalt ist unter dem stehenden Zeiger gewandert (freies Scrollen per Rad/Trackpad samt Schwung).
   * Die Ansicht setzt den Ring im selben Frame an die Lage ihrer Fokuskarte (er scrollt mit); hier wird hoechstens einmal je Frame
   * (rAF) der Treffer an der letzten Zeigerstelle neu bestimmt – liegt dort jetzt eine andere Kachel/Zeile, springt die
   * Hervorhebung dorthin (gleicher Weg wie eine Zeiger-Bewegung). Nur bei Maus/Trackpad (N.input 'pointer') und caps.scroll 'free';
   * am TV wird follow() nie aufgerufen. Nie die Seitenleiste ausklappen (Zeiger steht nur zufaellig ueber der Icon-Spalte). */
  var folRaf = false;
  P.follow = function () {
    if (folRaf || !P.on || P.x < 0 || N.input.mode !== 'pointer' || N.platform.caps.scroll !== 'free') return;
    folRaf = true;
    U.raf(function () {
      folRaf = false;
      if (!P.on || N.input.mode !== 'pointer' || P.keyT || P.mdrag || P.dragOn) return;
      var rl = N.ui.rail;
      if (!owner() && rl && rl.attached() && (rl.isOpen() || (P.x < 112 + (rl.edge ? rl.edge() : 0) && !(rl.slim && rl.slim())))) return;
      N.fx.step(true);                                 // Ring/Karten springen ohne Gleiten (wie jede Zeiger-Bewegung)
      route(P.x, P.y, 'move', null);
    });
  };
  function process() {
    if (!P.pend) return;
    P.pend = false;
    var x = P.x, y = P.y;
    if (P.locked(x, y)) { edgeCheck(scrollOwner()); return; }   // gesperrt: kein Hover-Fokus, Randzone aber weiter (Wiedereintritt)
    if (Math.abs(x - P.rx) + Math.abs(y - P.ry) < JITTER) return;   // Zittern des Luftmaus-Punkts
    P.rx = x; P.ry = y;
    // Runde 5: ein Zeiger-Schritt zaehlt fuer die Ruhe wie eine Taste (N.idle: Nacharbeit, Bildlader, Speichern, Hero/Hintergrund
    // warten auf Ruhe). Bisher nur der Klick -> waehrend der Feinauswahl (40-ms-Schritte) liefen Idle-Arbeit und Bild-Zuweisungen
    // zwischen den Schritten (Messlauf loupe: 2–7 Frames > 50 ms). Zittern unter JITTER zaehlt nicht (Finger ruht).
    if (N.idle) N.idle.touch();
    var t = scrollOwner(), before = sig(t);
    N.fx.step(true);                                 // Zeiger: Ring/Karten springen ohne Gleiten
    route(x, y, 'move', null);
    if (t && t === scrollOwner() && sig(t) !== before) P.scrolled();   // Inhalt ist unter dem Punkt gewandert -> Sperre
    edgeCheck(t);
    P.syncArrows();
  }
  /* ---- Randzonen: Verweilen -> gedrosselt rollen; Anzeige-Pille ---- */
  function edgeAt(t, x, y) { return t && t.pointerEdge ? t.pointerEdge(x, y) : null; }
  function edgeStop() {
    if (P.edgeT) { clearTimeout(P.edgeT); P.edgeT = 0; }
    if (P.gaps.length && N.devperf) {                // Dev: Abstaende der Roh-Ereignisse (stimmt die LIVE-Schwelle am TV?)
      var g = P.gaps.slice().sort(function (a, b) { return a - b; });
      N.log('ptr raw n=' + g.length + ' med=' + g[g.length >> 1] + ' p90=' + g[Math.floor(g.length * 0.9)] + ' max=' + g[g.length - 1]);
    }
    P.gaps = [];
    P.edge = null;
    if (P.edgeEl && P.edgeEl.style.display !== 'none') P.edgeEl.style.display = 'none';
  }
  P.edgeStop = edgeStop;
  /* Verweilen auf einem Element (z. B. angeschnittene Zeile): fn nach ms, wenn bis dahin keine Taste/kein Klick/kein neues
   * Verweilen kam. fn prueft selbst, ob der Punkt (P.x/P.y) noch dort ist. Nur fuer Rollen durch Verweilen -> mit
   * "Am Rand weiterblaettern: Aus" kein Verweilen (Rueckgabe false: der Aufrufer weiss, dass nichts kommt). */
  P.hold = function (fn, ms) {
    P.holdCancel();
    if (!P.edgeAuto) return false;
    P.holdT = setTimeout(function () { P.holdT = 0; if (P.on && !P.keyT && P.edgeAuto) fn(); }, ms || HOLD);
    return true;
  };
  P.holdCancel = function () { if (P.holdT) { clearTimeout(P.holdT); P.holdT = 0; } };
  function edgeCheck(t) {
    var e = P.edgeAuto ? edgeAt(t, P.x, P.y) : null;   // Aus: kein Verweil-Rollen, keine Pille (Klick in die Zone rollt weiter)
    if (!e) { if (P.edge) edgeStop(); return; }
    if (P.edge && P.edge.d === e.d && P.edgeT) return;
    edgeStop();
    P.edge = e;
    if (P.edgeEl) {
      P.edgeEl.className = e.d < 0 ? 'pedge up' : 'pedge dn';   // '‹' per CSS gedreht (gleiche Glyphe wie die Blaetter-Pfeile)
      P.edgeEl.style.cssText = 'left:' + (e.x - 20) + 'px;top:' + (e.y - 20) + 'px;display:block';
    }
    var k = 0;                                       // Schritte seit Betreten der Zone (Verlassen = neu ab 0)
    P.edgeT = setTimeout(function step() {
      P.edgeT = 0;
      var tt = scrollOwner(), cur = edgeAt(tt, P.x, P.y);
      // Lebenszeichen: Finger auf dem Touchpad = laufend kleinste Bewegungen (auch unter der Zitterschwelle). Kommt LIVE ms
      // nichts, ist der Finger weg (der Punkt bleibt am TV stehen) -> Rollen endet (TV-Befund 27.10. nachmittags)
      if (!P.edge || !cur || cur.d !== P.edge.d || !P.on || P.keyT || U.now() - P.rawT > LIVE) { edgeStop(); return; }
      N.fx.step(true);
      tt.pointerScroll(cur.d);
      P.scrolled();                                 // Inhalt wandert: Hover-Auswertung bis zur naechsten deutlichen Bewegung aus
      P.syncArrows();
      k++;
      if (edgeAt(tt, P.x, P.y)) P.edgeT = setTimeout(step, P.edgeDelay(k, P.accel)); else edgeStop();
    }, (N.config && N.config.ptrEdgeDwell) || EDGE_DWELL);
  }
  var thr = new Throttle(THROTTLE, process);
  function kindOf(e) { return e && e.pnInput === 'touch' ? 'touch' : 'pointer'; }
  function onMove(e) {
    if (P.mdrag) { P.x = e.clientX; P.y = e.clientY; P.rawT = U.now(); P.drag('move', e.clientX, e.clientY); return; }   // Maus zieht
    N.input.set(kindOf(e));
    P.move(e.clientX, e.clientY);
  }
  /* echte Bewegung (rein, getestet): gleiche Position = kuenstliches Ereignis (Inhalt bewegt sich unter dem Punkt) -> ignorieren */
  P.move = function (x, y) {
    if (!P.on) return;
    if (x === P.x && y === P.y) return;                 // gleiche Stelle: kuenstlich (Inhalt wanderte) -> kein Lebenszeichen
    var now = U.now(), re = P.rawT > 0 && P.retouch(x, y, P.x, P.y, now - P.rawT);
    if (P.edge && P.rawT && P.gaps.length < 200) P.gaps.push(now - P.rawT);
    P.rawT = now;                                       // Lebenszeichen VOR der Zitterschwelle (Randzone, s. edgeCheck)
    P.x = x; P.y = y;
    moveCursor();
    if (re) {                                          // Finger wieder aufgelegt: Punkt in der Mitte -> nichts ausloesen
      edgeStop(); P.holdCancel(); thr.cancel(); P.pend = false;
      P.rx = x; P.ry = y; P.lockT = 0;                  // naechste echte Bewegung wird ab hier normal ausgewertet
      return;
    }
    // letzte Eingabe gewinnt: nach Tastendruck erst bei deutlicher Bewegung uebernehmen
    if (P.keyT && Math.abs(x - P.ax) + Math.abs(y - P.ay) < KEY_GUARD) return;
    P.keyT = 0;
    P.lastMove = U.now();
    P.pend = true;
    thr.hit();
    if (P.idleT) clearTimeout(P.idleT);
    P.idleT = setTimeout(function () { P.idleT = 0; P.hideArrows(); edgeStop(); }, IDLE);
  };
  /* ---- eigener Pfeil (Variante B): ein Element, rAF-gedrosselt, nach 2 s ohne Bewegung bzw. bei Tasten weg ---- */
  var curEl = null, curRaf = false, curHideT = 0, curVis = false;
  function drawCursor() {
    curRaf = false;
    if (!curEl || P.mode !== 'B' || !P.on) return;
    U.tf(curEl, P.x - 4, P.y - 4);
    if (!curVis) { curEl.style.visibility = 'visible'; curVis = true; }
  }
  function moveCursor() {
    if (P.mode !== 'B' || !curEl) return;
    if (!curRaf) { curRaf = true; U.raf(drawCursor); }
    if (curHideT) clearTimeout(curHideT);
    curHideT = setTimeout(hideCursor, 2000);
  }
  function hideCursor() { curHideT = 0; if (curEl && curVis) { curEl.style.visibility = 'hidden'; curVis = false; } }
  function press(on) {
    if (P.mode === 'A' && document.body) U.cls(document.body, 'cur-press', on);
    if (P.mode === 'B' && curEl) U.cls(curEl, 'press', on);
  }

  /* Hinweisleiste: Eintrags-Rechtecke misst N.ui.hints einmal nach jeder Aenderung (nie im Tastenpfad) */
  function hintKey(x, y) { return N.ui.hints && N.ui.hints.hit ? N.ui.hints.hit(x, y) : null; }
  function onClick(e) {
    if (!P.on) { P.refocus(); return; }
    if (e.preventDefault) e.preventDefault();
    if (P.dragDone) { P.dragDone = false; P.refocus(); return; }   // Klick nach einem Maus-Zug: der Zug hat schon gewirkt
    N.input.set(kindOf(e));
    P.click(e.clientX, e.clientY, e.target);
    P.refocus();
  }
  P.click = function (x, y, target) {
    P.x = x; P.y = y; P.keyT = 0; P.lastMove = U.now(); P.lockT = 0; P.rx = x; P.ry = y;   // Klick ist eindeutig: Sperre aus
    thr.cancel(); P.pend = false; edgeStop(); P.holdCancel();
    if (P.longDone) { P.longDone = false; return; }  // langer Druck hat schon TOOLS ausgeloest
    var hk = hintKey(x, y);
    if (hk) { N.router.key(hk); return; }            // Klick auf die Hinweisleiste = diese Taste
    var rl = N.ui.rail;                               // Finger neben die ausgeklappte Seitenleiste: nur einklappen (wie iOS), nichts antippen
    if (N.input.mode === 'touch' && rl && rl.isOpen() && !owner() && x >= 320) { rl.close(); return; }
    if (N.idle) N.idle.touch();
    N.fx.step(true);
    route(x, y, 'move', target);
    route(x, y, 'click', target);
    P.syncArrows();
  };
  /* langer Druck (>= 800 ms): Element unter dem Punkt fokussieren, dann TOOLS. Tasten bleiben unveraendert. */
  P.longDone = false; P.longT = 0;
  P.down = function (x, y) {
    if (P.longT) clearTimeout(P.longT);
    P.longDone = false;
    P.longT = setTimeout(function () {
      P.longT = 0;
      if (hintKey(x, y)) return;
      P.longDone = true;
      var sc = owner() ? null : N.router.top();
      if (N.input.mode === 'touch' && sc && sc.touchLong === false) return;   // Finger: langer Druck tut hier nichts (Klick entfaellt)
      N.fx.step(true);
      route(x, y, 'move', null);
      N.router.key('TOOLS');
    }, LONG);
  };
  P.up = function () { if (P.longT) { clearTimeout(P.longT); P.longT = 0; } };
  /* Rechtsklick bzw. Ctrl-Klick (nur caps.pointer 'mouse', NAV-25): sofort Optionen (TOOLS) fuer das Element unter dem Zeiger,
   * wie der lange Druck. ctrl: ein Ctrl-Klick kann danach noch "click" senden -> wie beim langen Druck verwerfen (P.down setzt
   * longDone beim naechsten Druck zurueck). Gibt true zurueck, wenn TOOLS ausgeloest wurde. */
  P.context = function (x, y, ctrl) {
    P.up();
    if (!P.on || hintKey(x, y)) return false;
    P.x = x; P.y = y; P.lockT = 0; thr.cancel(); P.pend = false; edgeStop(); P.holdCancel();
    P.longDone = !!ctrl;
    if (N.idle) N.idle.touch();
    N.fx.step(true);
    route(x, y, 'move', null);
    N.router.key('TOOLS');
    return true;
  };
  /* Ziehen (Finger: Touch-Schicht ueber App.grab/App.drag; Maus: mousedown bei caps.pointer 'mouse'). grab fragt nur, drag fuehrt
   * aus. Nur am Bildschirm selbst (kein Overlay, keine offene Rail, kein Schoner): dort bleibt alles beim Tippen/Klicken. */
  function dragScreen() {
    if (!P.on || owner() || (N.ui.saver && N.ui.saver.on) || (N.ui.rail && N.ui.rail.isOpen && N.ui.rail.isOpen())) return null;
    return N.router.top();
  }
  P.grab = function (x, y) {
    var sc = dragScreen();
    return sc && sc.pointerGrab ? sc.pointerGrab(x, y) || '' : '';
  };
  P.drag = function (phase, x, y) {
    if (phase === 'start') {
      var sc = dragScreen();
      P.dragOn = !!(sc && sc.pointerDrag && sc.pointerGrab && sc.pointerGrab(x, y) === 'drag' && sc.pointerDrag('start', x, y));
      P.dragScr = P.dragOn ? sc : null;
    } else if (P.dragOn) {
      if (phase === 'end' || phase === 'cancel') P.dragOn = false;
      if (P.dragScr === N.router.top()) P.dragScr.pointerDrag(phase, x, y);
      if (!P.dragOn) P.dragScr = null;
    } else return false;
    if (phase !== 'cancel') { P.x = x; P.y = y; P.rawT = U.now(); P.keyT = 0; }   // Lebenszeichen: Feinauswahl wartet auf Ruhe
    if (N.idle) N.idle.touch();
    return P.dragOn || phase === 'end';
  };
  /* Finger-Ziehen von der Touch-Schicht: Eingabeart setzen, dann wie P.drag */
  P.touchGrab = function (x, y) { return P.grab(x, y); };
  P.touchDrag = function (phase, x, y) { N.input.set('touch'); return P.drag(phase, x, y); };
  function onWheel(e) {
    if (!P.on) return;
    if (N.platform.caps.scroll === 'free' && P.freeWheel) { if (e.preventDefault) e.preventDefault(); return; }   // Pixel-Weg (P.wheelPx)
    var d = e.wheelDelta ? -e.wheelDelta : (e.detail || 0);
    if (!d) return;
    if (e.preventDefault) e.preventDefault();
    P.wheel(d);
  }
  /* Mausrad/Touchpad-Wischen -> Taste, gedrosselt (ein Schritt je WHEEL_RATE ms; schnelle Raeder liefern Dutzende Ereignisse) */
  P.wheel = function (d) {
    if (!P.on) return false;
    var now = U.now(), ov = owner(), t = ov || (N.ui.rail && N.ui.rail.isOpen() ? N.ui.rail : N.router.top());
    if (t && t.wheelPx && t.wheelPx(d)) return true;   // Ansicht rollt selbst frei, ungedrosselt (Detailkarte, caps.details 'card'); am TV nie
    if (now - P.wheelT < WHEEL_RATE) return false;
    P.wheelT = now;
    var keys = (t && t.wheelKeys) || ['UP', 'DOWN'];
    N.router.key(d > 0 ? keys[1] : keys[0]);
    return true;
  };

  /* Rad/Trackpad in Pixeln (caps.scroll 'free', Apple Nr. 10/12): der Plattform-Lader liefert App-Koordinaten und den Weg in App-px
   * (dx/dy > 0 = Inhalt nach links/oben, wie deltaX/deltaY). Ziel: Bildschirm (kein Overlay, keine offene Seitenleiste) mit
   * wheel(x, y, dx, dy) -> true = verschoben. Sonst Rueckfall auf den Tasten-Weg (P.wheel, gedrosselt). */
  P.freeWheel = false;
  P.wheelPx = function (x, y, dx, dy) {
    if (!P.on) return false;
    P.freeWheel = true;
    N.input.set('pointer');
    if (N.idle) N.idle.touch();
    var ov = owner();
    if (ov && ov.wheel) { var oo = stageOff(ov, true); if (ov.wheel(oo ? x - oo.x : x, oo ? y - oo.y : y, dx, dy)) return true; }   // Overlay mit freier Liste
    if (!ov && N.ui.rail && N.ui.rail.wheel && N.ui.rail.wheel(x, y, dy)) return true;   // flach: rollende Seitenleiste unter dem Zeiger
    var sc = ov || (N.ui.rail && N.ui.rail.isOpen && N.ui.rail.isOpen()) ? null : N.router.top(), o = stageOff(sc, false);
    var cf = sc && N.router.cardFrame ? N.router.cardFrame(sc) : null;   // Detailkarte: Inhalts-Koordinaten der Karte
    if (cf) { if (sc.wheel && sc.wheel((x - cf.x) / cf.k + (cf.cut || 0), (y - cf.y) / cf.k, dx / cf.k, dy / cf.k)) return true; }
    else if (sc && sc.wheel && sc.wheel(o ? x - o.x : x, o ? y - o.y : y, dx, dy)) return true;
    var d = Math.abs(dy) >= Math.abs(dx) ? dy : 0;
    return d ? P.wheel(d) : false;
  };
  /* Tasten kommen nur ueber onkeydown von #anchor (loader/index.html). WebKit verschiebt den Fokus beim mousedown ->
   * mousedown ohne Standardaktion, nach jedem Klick und bei jedem blur/onfocus den Anker wieder fokussieren. */
  var refT = 0;
  function anchor() { return typeof document !== 'undefined' && document.getElementById ? document.getElementById('anchor') : null; }
  P.refocus = function () {
    var a = anchor();
    if (a && document.activeElement !== a) { try { a.focus(); } catch (e) {} }
  };
  var backT = 0;
  function appBack() { if (!backT) backT = setTimeout(function () { backT = 0; N.evt.emit('app:refocus'); }, 50); }
  function refocusSoon() { if (!refT) refT = setTimeout(function () { refT = 0; P.refocus(); }, 0); }

  P.init = function (root, chrome) {
    P.root = root;
    root.addEventListener('mousemove', onMove, false);
    root.addEventListener('click', onClick, false);
    root.addEventListener('mousewheel', onWheel, false);
    root.addEventListener('mousedown', function (e) {
      if (e && e.preventDefault) e.preventDefault();
      if (!P.on) return;
      if (e && e.button === 2 && N.platform.caps.pointer === 'mouse') return;   // Sekundaerklick: kommt als contextmenu
      if (P.mdrag) { P.mdrag = false; P.drag('cancel', P.x, P.y); }   // Loslassen ausserhalb des Fensters kam nie an
      N.input.set(kindOf(e)); P.dragDone = false;
      // Beruehrung/Druck haelt freies Scrollen an (Schwung stoppt, iOS-Verhalten); die Ansicht verschluckt dann den Klick selbst
      var ds = dragScreen(), dov = owner();
      if (ds && ds.pointerDown) ds.pointerDown(e.clientX, e.clientY);
      else if (dov && dov.pointerDown) dov.pointerDown(e.clientX, e.clientY);   // Overlay mit freier Liste (N.ui.freeList)
      // Maus/Trackpad (caps.pointer 'mouse', nicht am TV): Druck auf ein Zug-Ziel (Player-Balken) -> Ziehen statt Klick/langer Druck
      if (N.input.mode === 'pointer' && N.platform.caps.pointer === 'mouse' && P.grab(e.clientX, e.clientY) === 'drag' && P.drag('start', e.clientX, e.clientY)) { P.mdrag = true; return; }
      press(true); P.down(e.clientX, e.clientY);
    }, false);
    // Rechtsklick/Ctrl-Klick = Optionen (Maus/Trackpad, NAV-25); das Kontextmenue der WebView entfaellt. Fernseher: kein Ereignis
    if (N.platform.caps.pointer === 'mouse') root.addEventListener('contextmenu', function (e) {
      if (e && e.preventDefault) e.preventDefault();
      if (!P.on || P.mdrag) return;
      N.input.set(kindOf(e));
      P.context(e.clientX, e.clientY, !!(e && e.ctrlKey && e.button !== 2));
      P.refocus();
    }, false);
    root.addEventListener('mouseup', function (e) {
      if (P.mdrag) { P.mdrag = false; P.dragDone = true; P.drag('end', e.clientX, e.clientY); P.refocus(); return; }
      press(false); P.up(); P.refocus();
    }, false);
    var a = anchor();
    if (a) a.addEventListener('blur', refocusSoon, false);
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('focus', refocusSoon, false);
      // Bildschirmtastatur/Systemeinblendungen: Fenster bekommt den Fokus zurueck bzw. wird neu vermessen -> Ansichten auffrischen
      window.addEventListener('focus', appBack, false);
      window.addEventListener('resize', appBack, false);
    }
    curEl = U.el('div', 'pcur', chrome);
    root.addEventListener('DOMMouseScroll', onWheel, false);
    P.arrows = [U.el('div', 'parr', chrome, 'display:none'), U.el('div', 'parr', chrome, 'display:none')];
    P.arrows[0].appendChild(document.createTextNode('‹'));
    P.arrows[1].appendChild(document.createTextNode('›'));
    P.edgeEl = U.el('div', 'pedge', chrome, 'display:none');
    P.edgeEl.appendChild(document.createTextNode('‹'));
  };
  /* Einstellung "Zeiger-Steuerung" (Standard An). Aus: Zeiger-Ereignisse werden ignoriert; Punkt ausblenden ist
   * nur per CSS cursor:none versucht (am TV unbestaetigt, siehe docs/ARCHITEKTUR.md). */
  P.setEnabled = function (on) {
    P.on = !!on;
    if (!P.on) { P.hideArrows(); edgeStop(); P.holdCancel(); }
    if (typeof document !== 'undefined' && document.body) U.cls(document.body, 'nocursor', !P.on);
    P.applyCursor();
  };
  P.enabled = function () { return P.on; };
  /* Zeiger-Darstellung A/B/system (siehe N.config.cursorMode) */
  P.mode = 'B';
  P.setCursorMode = function (m) {
    P.mode = m === 'B' || m === 'system' ? m : 'A';
    P.applyCursor();
  };
  P.applyCursor = function () {
    var b = typeof document !== 'undefined' && document.body;
    if (!b) return;
    U.cls(b, 'cur-a', P.on && P.mode === 'A');
    U.cls(b, 'cur-b', P.on && P.mode === 'B');
    if (P.mode !== 'B' || !P.on) hideCursor();
  };
  P.cycleCursor = function () { P.setCursorMode(P.mode === 'A' ? 'B' : P.mode === 'B' ? 'system' : 'A'); return P.mode; };
  P.active = function () { return P.on && P.lastMove > 0 && U.now() - P.lastMove < IDLE; };
  /* Router meldet jede Taste: Pfeile weg, Zeiger-Bewegungen bis zur naechsten deutlichen Bewegung ignorieren */
  P.keyUsed = function () {
    if (P.mdrag) { P.mdrag = false; P.dragDone = false; }
    if (P.dragOn) P.drag('cancel', P.x, P.y);             // Taste mitten im Zug: Zug abbrechen
    P.keyT = U.now(); P.ax = P.x; P.ay = P.y; P.lastMove = 0; P.pend = false; thr.cancel(); P.lockT = 0; P.rx = P.ry = -1e4;
    if (P.edge) edgeStop();
    P.holdCancel();
    if (P.arrowsOn) P.hideArrows();
    hideCursor();
  };
  P.hideArrows = function () {
    if (!P.arrows || !P.arrowsOn) return;
    P.arrows[0].style.display = 'none'; P.arrows[1].style.display = 'none'; P.arrowsOn = false; P.curArrows = null;
  };
  P.syncArrows = function () {
    if (!P.arrows) return;
    var scr = N.router.top(), a = P.active() && !N.router.hasOverlay() && !(N.ui.rail && N.ui.rail.isOpen()) && scr && scr.pointerArrows ? scr.pointerArrows() : null;
    if (!a) { P.hideArrows(); return; }
    // Lage in Wurzel-Koordinaten: am TV links 124, rechts 1236; flexible Flaeche: rechts an der Breite der Ansicht, Kasten verschoben
    var o = stageOff(scr, false) || { x: 0, y: 0, k: 1 }, aw = N.screen ? N.screen.area(scr.flex).w : 1280;
    a = { y: a.y * o.k + o.y, h: a.h * o.k, left: a.left, right: a.right, lx: 124 * o.k + o.x, rx: (aw - 44) * o.k + o.x };
    P.curArrows = a;
    var css = 'top:' + (a.y + Math.round(a.h / 2) - 32) + 'px;';
    P.arrows[0].style.cssText = css + 'left:' + a.lx + 'px;display:' + (a.left ? 'block' : 'none');
    P.arrows[1].style.cssText = css + 'left:' + a.rx + 'px;display:' + (a.right ? 'block' : 'none');
    P.arrowsOn = true;
  };
  N.pointer = P;
})(N);
