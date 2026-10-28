/* N.pointer – Smart-Control-Zeiger (Luftmaus-Punkt; Touchpad-Druck = Klick). Nutzer-Anforderung M2.
 * - NUR delegierte Listener am Root (keine pro Karte) -> Tastennavigation bleibt unberuehrt.
 * - mousemove mit Vorderflanke: erste Bewegung sofort, danach hoechstens alle 40 ms (letzte Position gewinnt) -> Ziel per
 *   Index-Mathe (N.hit / N.RowMath.hit) -> Fokus ueber dieselben Fokus-Funktionen wie die Tasten. Zeiger-Fokus springt ohne
 *   Gleiten (N.fx.step(true): nur die bewegten Elemente ohne Uebergang), Tasten gleiten weiter.
 * - Hinweisleiste anklickbar (Klick auf einen Eintrag = diese Taste; Smart Control hat z. B. kein TOOLS).
 * - Langes Druecken auf das Touchpad (>= 800 ms) = TOOLS (Optionen) fuer das Element unter dem Punkt; der Klick danach entfaellt.
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
 *   pointerScroll(d) (einen Schritt rollen, Fokus bleibt sichtbar) */
(function (N) {
  var U = N.util, THROTTLE = 40, IDLE = 3000, KEY_GUARD = 16, LONG = 800;
  var JITTER = 4, SCROLL_COOL = 450, SCROLL_MOVE = 40, EDGE_DWELL = 400, EDGE_RATE = 300, WHEEL_RATE = 150, EDGE_SLOW = 400, EDGE_FAST = 120, LIVE = 1000, HOLD = 250, CX = 640, CY = 360, CENTRE = 8, JUMP = 200;
  // LIVE (TV-Log 27.10., dev/ptrlog.js): ruhig gehaltene Fernbedienung mit Finger auf dem Pad -> Roh-Ereignisse p90 ~340 ms,
  // max ~710 ms; Loslassen liefert KEIN Ereignis (kein mouseout/blur), nur Stille -> 1 s Frist = kurzer Nachlauf, kein Abbruch
  // beim Stillhalten. Wiederauflegen: Punkt erscheint in der Bildmitte (~639,360) = Sprung, siehe P.retouch.
  var P = { on: true, root: null, x: -1, y: -1, pend: false, timer: 0, lastMove: 0, keyT: 0, ax: -1, ay: -1, idleT: 0, arrows: null, arrowsOn: false,
    rx: -1e4, ry: -1e4, rawT: 0, holdT: 0, gaps: [], lockT: 0, lx: 0, ly: 0, edge: null, edgeT: 0, edgeEl: null, wheelT: 0 };
  P.accel = true;
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
  function route(x, y, kind, target) {
    var ov = owner();
    if (ov) return ov.pointer ? ov.pointer(x, y, kind, target) : false;
    var rail = N.ui.rail, scr = N.router.top();
    if (rail && rail.attached()) {
      if (rail.isOpen()) {
        if (x < 320) return rail.pointer(x, y, kind);
        if (kind === 'move') rail.close();           // Punkt verlaesst das Panel -> einklappen, Fokus zurueck
      } else if (x < 112 && !(P.arrowsOn && arrowHit(x, y))) {
        return rail.pointer(x, y, kind);             // Punkt auf der Rail -> ausklappen
      }
    }
    if (N.ui.mini && N.ui.mini.pointer(x, y, kind)) return true;   // M4: Mini-Player (Klick = Jetzt laeuft)
    if (P.arrowsOn && kind === 'click') {
      var d = arrowHit(x, y);
      if (d && scr && scr.pointerPage) { scr.pointerPage(d); return true; }
    }
    return scr && scr.pointer ? scr.pointer(x, y, kind, target) : false;
  }
  function arrowHit(x, y) {
    var a = P.curArrows;
    if (!a || y < a.y || y >= a.y + a.h) return 0;
    if (a.left && x >= 124 && x < 164) return -1;
    if (a.right && x >= 1236 && x < 1276) return 1;
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
   * Verweilen kam. fn prueft selbst, ob der Punkt (P.x/P.y) noch dort ist. */
  P.hold = function (fn, ms) {
    P.holdCancel();
    P.holdT = setTimeout(function () { P.holdT = 0; if (P.on && !P.keyT) fn(); }, ms || HOLD);
  };
  P.holdCancel = function () { if (P.holdT) { clearTimeout(P.holdT); P.holdT = 0; } };
  function edgeCheck(t) {
    var e = edgeAt(t, P.x, P.y);
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
  function onMove(e) { P.move(e.clientX, e.clientY); }
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
    P.click(e.clientX, e.clientY, e.target);
    P.refocus();
  }
  P.click = function (x, y, target) {
    P.x = x; P.y = y; P.keyT = 0; P.lastMove = U.now(); P.lockT = 0; P.rx = x; P.ry = y;   // Klick ist eindeutig: Sperre aus
    thr.cancel(); P.pend = false; edgeStop(); P.holdCancel();
    if (P.longDone) { P.longDone = false; return; }  // langer Druck hat schon TOOLS ausgeloest
    var hk = hintKey(x, y);
    if (hk) { N.router.key(hk); return; }            // Klick auf die Hinweisleiste = diese Taste
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
      N.fx.step(true);
      route(x, y, 'move', null);
      N.router.key('TOOLS');
    }, LONG);
  };
  P.up = function () { if (P.longT) { clearTimeout(P.longT); P.longT = 0; } };
  function onWheel(e) {
    if (!P.on) return;
    var d = e.wheelDelta ? -e.wheelDelta : (e.detail || 0);
    if (!d) return;
    if (e.preventDefault) e.preventDefault();
    P.wheel(d);
  }
  /* Mausrad/Touchpad-Wischen -> Taste, gedrosselt (ein Schritt je WHEEL_RATE ms; schnelle Raeder liefern Dutzende Ereignisse) */
  P.wheel = function (d) {
    if (!P.on) return false;
    var now = U.now();
    if (now - P.wheelT < WHEEL_RATE) return false;
    P.wheelT = now;
    var ov = owner(), t = ov || (N.ui.rail && N.ui.rail.isOpen() ? N.ui.rail : N.router.top());
    var keys = (t && t.wheelKeys) || ['UP', 'DOWN'];
    N.router.key(d > 0 ? keys[1] : keys[0]);
    return true;
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
      if (P.on) { press(true); P.down(e.clientX, e.clientY); }
    }, false);
    root.addEventListener('mouseup', function () { press(false); P.up(); P.refocus(); }, false);
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
    P.curArrows = a;
    var css = 'top:' + (a.y + Math.round(a.h / 2) - 32) + 'px;';
    P.arrows[0].style.cssText = css + 'left:124px;display:' + (a.left ? 'block' : 'none');
    P.arrows[1].style.cssText = css + 'left:1236px;display:' + (a.right ? 'block' : 'none');
    P.arrowsOn = true;
  };
  N.pointer = P;
})(N);
