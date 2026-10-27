/* N.pointer – Smart-Control-Zeiger (Luftmaus-Punkt; Touchpad-Druck = Klick). Nutzer-Anforderung M2.
 * - NUR delegierte Listener am Root (keine pro Karte) -> Tastennavigation bleibt unberuehrt.
 * - mousemove mit Vorderflanke: erste Bewegung sofort, danach hoechstens alle 40 ms (letzte Position gewinnt) -> Ziel per
 *   Index-Mathe (N.hit / N.RowMath.hit) -> Fokus ueber dieselben Fokus-Funktionen wie die Tasten. Zeiger-Fokus springt ohne
 *   Gleiten (N.fx.step(true): nur die bewegten Elemente ohne Uebergang), Tasten gleiten weiter.
 * - Hinweisleiste anklickbar (Klick auf einen Eintrag = diese Taste; Smart Control hat z. B. kein TOOLS).
 * - Langes Druecken auf das Touchpad (>= 800 ms) = TOOLS (Optionen) fuer das Element unter dem Punkt; der Klick danach entfaellt.
 * - Letzte Eingabe gewinnt: nach einer Taste werden Zeiger-Bewegungen ignoriert, bis sich der Punkt deutlich bewegt (> 16 px).
 * - Klick = OK auf dem Element unter dem Punkt. Blaetter-Pfeile an der fokussierten Reihe nur bei aktivem Zeiger.
 * - Mausrad (falls geliefert) -> Tasten der Zone (Reihe: LINKS/RECHTS, Liste: HOCH/RUNTER).
 * Ziel-Schnittstelle (Bildschirm/Overlay/Rail): pointer(x, y, kind:'move'|'click', target) -> bool,
 *   optional pointerArrows() -> {y, h, left, right} | null, pointerPage(dir), wheelKeys ['LEFT','RIGHT'] */
(function (N) {
  var U = N.util, THROTTLE = 40, IDLE = 3000, KEY_GUARD = 16, LONG = 800;
  var P = { on: true, root: null, x: -1, y: -1, pend: false, timer: 0, lastMove: 0, keyT: 0, ax: -1, ay: -1, idleT: 0, arrows: null, arrowsOn: false };

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
  function process() {
    if (!P.pend) return;
    P.pend = false;
    N.fx.step(true);                                 // Zeiger: Ring/Karten springen ohne Gleiten
    route(P.x, P.y, 'move', null);
    P.syncArrows();
  }
  var thr = new Throttle(THROTTLE, process);
  function onMove(e) {
    if (!P.on) return;
    var x = e.clientX, y = e.clientY;
    if (x === P.x && y === P.y) return;
    P.x = x; P.y = y;
    moveCursor();
    // letzte Eingabe gewinnt: nach Tastendruck erst bei deutlicher Bewegung uebernehmen
    if (P.keyT && Math.abs(x - P.ax) + Math.abs(y - P.ay) < KEY_GUARD) return;
    P.keyT = 0;
    P.lastMove = U.now();
    P.pend = true;
    thr.hit();
    if (P.idleT) clearTimeout(P.idleT);
    P.idleT = setTimeout(function () { P.idleT = 0; P.hideArrows(); }, IDLE);
  }
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
    P.x = x; P.y = y; P.keyT = 0; P.lastMove = U.now();
    thr.cancel(); P.pend = false;
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
    var ov = owner(), t = ov || (N.ui.rail && N.ui.rail.isOpen() ? N.ui.rail : N.router.top());
    var keys = (t && t.wheelKeys) || ['UP', 'DOWN'];
    N.router.key(d > 0 ? keys[1] : keys[0]);
  }

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
  };
  /* Einstellung "Zeiger-Steuerung" (Standard An). Aus: Zeiger-Ereignisse werden ignoriert; Punkt ausblenden ist
   * nur per CSS cursor:none versucht (am TV unbestaetigt, siehe docs/ARCHITEKTUR.md). */
  P.setEnabled = function (on) {
    P.on = !!on;
    if (!P.on) P.hideArrows();
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
    P.keyT = U.now(); P.ax = P.x; P.ay = P.y; P.lastMove = 0; P.pend = false; thr.cancel();
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
