/* N.router – Fokus-Engine auf Bildschirm-Ebene (SPEC 14.4/14.5):
 * - Bildschirm-Stapel push/replace/back/reset; max. 2 Ansichten unter der aktuellen bleiben im DOM (display:none),
 *   tiefere werden zerstoert und bei Rueckkehr aus ihrem restore-Objekt neu aufgebaut.
 * - Overlay-Stapel (Dialog, Panel, PIN): RETURN schliesst immer zuerst das oberste Overlay.
 * - Seitenleiste (N.ui.rail) bekommt die Tasten, solange sie ausgeklappt ist.
 * - Tasten-Drossel: Pfeiltasten < 120 ms nach der letzten verarbeiteten -> verworfen; < 200 ms -> fast (keine Uebergaenge).
 * Bildschirm-Schnittstelle: create(root), enter(params, restore), leave() -> restore, destroy(), onKey(k, fast) -> bool,
 *   hints() -> [...], backBtn (Finger/Maus: Zurueck-Knopf oben links statt Hinweisleiste, N.ui.hints.back), rail -> 'home'|'settings'|null, railClosed(), relabel()   (alles ausser create/onKey optional),
 *   pan(e) -> bool (nur caps.scroll 'free': Wischen frei verschieben; bei phase 'start' true = Zug gehoert dieser Ansicht;
 *   Overlays: nicht genommene Zuege verschluckt der Router)
 * Detailkarte (caps.details 'card', N.ui.card; am TV nie): Ansichten mit scr.card stehen in einer Karte ueber der Ansicht darunter
 *   (die sichtbar bleibt, abgedunkelt; sie bekommt leave(), aber kein display:none). Tiefere Karten-Ebenen wechseln in derselben
 *   Karte. Optional an Karten-Ansichten: cardTop() -> true = Inhalt steht ganz oben (Ziehen nach unten schliesst), cardBackOk(x, y)
 *   -> true = waagerechter Zug hier ist kein Reihen-Blaettern (Mitte -> rechts = eine Ebene zurueck). */
(function (N) {
  var U = N.util, KEEP = 2, THROTTLE = 120, FAST = 200;
  var factories = {}, stack = [], overlays = [], layer = null, overLayer = null, lastNav = 0, nowFn = U.now, hintCtx = null, panT = null, SINK = {};
  var cg = null;                                     // laufende Karten-Geste (Ziehen nach unten / Mitte -> rechts)
  var WAKE_KEYS = { RED: 1, GREEN: 1, YELLOW: 1, BLUE: 1, INFO: 1, TOOLS: 1 };

  function mkEl() { var e = document.createElement('div'); e.className = 'scr'; return e; }
  function build(entry) {
    var scr = factories[entry.name](entry.params);
    scr.el = scr.el || (layer ? mkEl() : { style: {} });
    entry.card = !!(scr.card && layer && cardOn());
    if (entry.card) { N.ui.card.init(layer); scr.el.className += ' incard'; N.ui.card.adopt(scr.el); }   // Detailkarte (nur caps.details 'card')
    if (layer && !scr.el.parentNode) layer.appendChild(scr.el);
    // flexible Flaeche (N.screen, nur Apple): angepasste Ansichten fuellen W x H, alle anderen im mittigen 1280x720-Kasten
    if (!entry.card && N.screen && N.screen.flex && scr.el.className) {
      scr.el.className += scr.flex ? ' flex' : ' stage720';
      if (scr.flex) { var vw = N.screen.view(), es = scr.el.style; es.left = vw.x + 'px'; es.width = vw.w + 'px'; es.height = vw.h + 'px'; }   // Breitenklasse M/K: Inhaltskante, Leiste unten
    }
    if (scr.create) scr.create(scr.el, entry.params);
    entry.scr = scr;
    return scr;
  }
  function hide(entry) {
    if (!entry.scr) return;
    if (entry.scr.leave) entry.restore = entry.scr.leave() || entry.restore;
    entry.scr.el.style.display = 'none';
  }
  function kill(entry) {
    if (!entry.scr) return;
    if (entry.scr.destroy) entry.scr.destroy();
    var el = entry.scr.el;
    if (el && el.parentNode) el.parentNode.removeChild(el);
    entry.scr = null;
  }
  function trim() {
    var b = cardBase();                              // Ansicht unter der Karte bleibt (sie ist sichtbar)
    for (var i = 0; i < stack.length - 1 - KEEP; i++) if (stack[i].scr && i !== b) kill(stack[i]);
  }
  function show(entry) {
    if (entry.dirty) { entry.dirty = false; kill(entry); }   // Flaeche hat sich geaendert (R.relayout): aus restore neu aufbauen
    var scr = entry.scr || build(entry);
    scr.el.style.display = '';
    paintCard();
    if (scr.enter) scr.enter(entry.params, entry.restore || null);
    syncChrome();
  }
  function top() { return stack.length ? stack[stack.length - 1] : null; }

  /* ---- Detailkarte (N.ui.card, nur caps.details 'card') ---- */
  function cardOn() { return !!(N.ui.card && N.ui.card.on()); }
  /* Index der Ansicht unter der obersten Karten-Folge (-1: oben ist keine Karte) */
  function cardBase() {
    var i = stack.length - 1;
    if (i < 0 || !stack[i].card) return -1;
    while (i >= 0 && stack[i].card) i--;
    return i;
  }
  function cardDepth() { var t = stack.length - 1; return t >= 0 && stack[t].card ? t - cardBase() : 0; }
  /* Sichtbarkeit nach jeder Stapel-Aenderung: oben eine Karte -> Karte + Ansicht darunter sichtbar, sonst Karte zu */
  function paintCard() {
    var C = N.ui.card;
    if (!C || !C.el) return;
    var d = cardDepth(), b = cardBase();
    if (d) {
      if (stack[b] && stack[b].scr) stack[b].scr.el.style.display = '';
      C.button(d > 1 ? 'back' : 'x');
      C.show(!C.shown);
    } else {
      if (C.shown) C.hide(false);
      for (var i = 0; i < stack.length - 1; i++) if (stack[i].scr) stack[i].scr.el.style.display = 'none';   // z. B. Player ueber der Karte
    }
    if (N.ui.rail && N.ui.rail.el) U.cls(N.ui.rail.el, 'under-card', d > 0 && !N.ui.rail.isOpen());   // eingeklappte Leiste nicht ueber der Karte
  }
  /* Karten-Ebene verlassen: Ansicht zerstoeren, ihr Element gleitet noch hinaus (eine Ebene: nach rechts; letzte: Karte nach unten) */
  function cardPop(entry, last) {
    var el = entry.scr.el;
    if (entry.scr.leave) entry.scr.leave();
    if (entry.scr.destroy) entry.scr.destroy();
    entry.scr = null;
    if (last) N.ui.card.hide(true, function () { if (el.parentNode) el.parentNode.removeChild(el); });
    else N.ui.card.ghost(el);
  }

  /* Seitenleiste + Hinweisleiste passend zum obersten Bildschirm/Overlay */
  function syncChrome() {
    var t = top(), scr = t && t.scr;
    if (N.ui.rail && N.ui.rail.el) N.ui.rail.attach(scr && scr.rail ? scr.rail : null);
    R.refreshHints();
    N.evt.emit('router:top', t ? t.name : null);       // z. B. Mini-Player sofort ein-/ausblenden (M4)
  }

  var R = {
    init: function (screensLayer, overlayLayer) { layer = screensLayer; overLayer = overlayLayer; },
    define: function (name, factory) { factories[name] = factory; },
    top: function () { var t = top(); return t ? t.scr : null; },
    topName: function () { var t = top(); return t ? t.name : null; },
    topParams: function () { var t = top(); return t ? t.params : null; },
    depth: function () { return stack.length; },
    push: function (name, params) {
      var t = top(), wasCard = cardDepth();
      if (wasCard) N.ui.card.flush();
      if (t) hide(t);
      var e = { name: name, params: params || {}, scr: null, restore: null };
      stack.push(e);
      trim();
      show(e);
      if (e.card && wasCard && e.scr) N.ui.card.enterLevel(e.scr.el);   // tiefere Ebene: in derselben Karte von rechts
    },
    replace: function (name, params) {
      var t = stack.pop();
      if (t) { hide(t); kill(t); }
      R.push(name, params);
    },
    /* alles verwerfen (Profilwechsel: Fokus-Gedaechtnis weg, SPEC 6.3.4) */
    reset: function (name, params) {
      R.closeAllOverlays();
      if (N.ui.rail && N.ui.rail.isOpen()) N.ui.rail.close(true);
      while (stack.length) { var t = stack.pop(); if (t.scr && t.scr.leave) t.scr.leave(); kill(t); }
      R.push(name, params);
    },
    back: function () {
      if (stack.length < 2) return false;
      var t = stack.pop();
      if (t.card && t.scr) { N.ui.card.flush(); cardPop(t, !top().card); show(top()); return true; }   // Karte: Ebene zurueck bzw. Karte zu
      hide(t); kill(t);
      show(top());
      return true;
    },
    /* Detailkarte ganz schliessen (Ziehen nach unten, Tipp daneben): alle Karten-Ebenen; X auf der ersten Ebene ist back() */
    closeCard: function () {
      if (!cardDepth() || stack.length < 2) return false;
      N.ui.card.flush();
      while (stack.length > 2 && stack[stack.length - 2].card) { var d = stack.pop(); if (d.scr && d.scr.leave) d.scr.leave(); kill(d); }
      var t = stack.pop();
      if (t.scr) cardPop(t, true);
      show(top());
      return true;
    },
    cardDepth: cardDepth,
    /* Lage der Karte, wenn scr die oberste Karten-Ansicht ist (Zeiger, Pan): N.ui.card.geom-Ergebnis in App-px, sonst null */
    cardFrame: function (scr) {
      var t = top();
      if (!t || !t.card || !scr || t.scr !== scr || !N.ui.card.shown) return null;
      return N.ui.card.g;
    },
    /* Zeiger auf dem Rahmen der Karte (N.pointer, vor Seitenleiste und Ansicht): X/Pfeil, Abdunklung daneben. true = erledigt */
    cardPointer: function (x, y, kind) {
      if (!cardDepth() || overlays.length || !N.ui.card.shown) return false;
      var h = N.ui.card.hit(x, y);
      if (h !== 'btn' && h !== 'out') return false;
      if (kind === 'click') { if (h === 'btn') R.back(); else R.closeCard(); }
      return true;
    },
    /* Sprachwechsel: oberste Ansicht neu aufbauen (Fokus bleibt ueber restore), tiefere beim Zurueckkehren */
    rebuild: function () {
      for (var i = 0; i < stack.length - 1; i++) if (stack[i].scr) { kill(stack[i]); }
      var t = top();
      if (t && t.scr) { hide(t); kill(t); show(t); }
      if (N.ui.rail && N.ui.rail.relabel) N.ui.rail.relabel();
      N.ui.hints.refresh(); R.refreshHints();
    },
    /* Flaeche geaendert (N.screen 'screen:resized', nur Apple): flexible Ansichten neu aufbauen. Die oberste sofort (Fokus bleibt
     * ueber leave/restore wie beim Sprachwechsel), sobald kein Overlay mehr offen ist; tiefere beim Zurueckkehren (show). Ansichten
     * im 1280x720-Kasten (Player, Dialoge …) bleiben unberuehrt, ausser sie setzen scr.reflow (ob sie flexibel sind, haengt von der
     * Flaeche ab). */
    relayout: function () {
      for (var i = 0; i < stack.length; i++) if (stack[i].scr && (stack[i].scr.flex || stack[i].card || stack[i].scr.reflow)) stack[i].dirty = true;
      if (N.ui.card && N.ui.card.el) N.ui.card.layout();
      for (var j = 0; j < overlays.length; j++) N.screen.place(overlays[j]);
      R.settle();
    },
    settle: function () {
      var t = top();
      if (!t || !t.dirty || overlays.length) return;
      hide(t); show(t);
    },
    /* ---- Overlays ---- */
    openOverlay: function (ov) {
      overlays.push(ov);
      if (overLayer) { if (!ov.el.parentNode) overLayer.appendChild(ov.el); U.cls(overLayer, 'on', true); }
      if (N.screen && N.screen.flex) N.screen.place(ov);   // flexible Flaeche: Overlay nach seinem Kasten (Panel rechts, Dialog mittig)
      R.refreshHints();
    },
    closeOverlay: function (ov) {
      var i = overlays.indexOf(ov);
      if (i < 0) return;
      overlays.splice(i, 1);
      if (ov.el && ov.el.parentNode) ov.el.parentNode.removeChild(ov.el);
      if (overLayer && !overlays.length) U.cls(overLayer, 'on', false);
      if (ov.destroy) ov.destroy();
      R.refreshHints();
      N.evt.emit('overlay:closed', ov);              // z. B. Home: Hero-Bild wiederherstellen (M3-Fehler B)
      if (!overlays.length) R.settle();
    },
    closeAllOverlays: function () { while (overlays.length) R.closeOverlay(overlays[overlays.length - 1]); },
    hasOverlay: function () { return overlays.length > 0; },
    topOverlay: function () { return overlays.length ? overlays[overlays.length - 1] : null; },
    refreshHints: function () {
      if (N.ui.card && N.ui.card.el && N.ui.rail && N.ui.rail.el) U.cls(N.ui.rail.el, 'under-card', cardDepth() > 0 && !N.ui.rail.isOpen());   // Leiste auf/zu
      if (!N.ui.hints || !N.ui.hints.el) return;
      var o = overlays.length ? overlays[overlays.length - 1] : null, cx = o || top();
      if (cx !== hintCtx) { hintCtx = cx; N.ui.hints.wake(); }   // neuer Bildschirm/neues Overlay: "Nur kurz" blendet ein (Rail zaehlt nicht)
      var t = top();
      N.ui.hints.back(!o && !(N.ui.rail && N.ui.rail.isOpen()) && t && !t.card && t.scr && t.scr.backBtn);   // Finger/Maus: Zurueck-Knopf statt Leiste (Nr. 26)
      if (o) { N.ui.hints.set(o.hints ? o.hints() : [{ k: 'ret', t: 'hint.cancel' }]); return; }
      if (N.ui.rail && N.ui.rail.isOpen()) { N.ui.hints.set([{ k: 'ret', t: 'hint.back' }]); return; }
      N.ui.hints.set(t && t.scr && t.scr.hints ? t.scr.hints() : []);
    },
    /* ---- Tasten ---- */
    /* Rueckgabe: false = verworfen (Drossel), sonst true */
    key: function (k) {
      var now = nowFn(), fast = false;
      if (N.keys.isNav(k)) {
        var dt = now - lastNav;
        if (dt < THROTTLE) return false;
        fast = dt < FAST;
        lastNav = now;
      }
      if (N.idle) N.idle.touch();
      if (N.pointer && N.pointer.keyUsed) N.pointer.keyUsed();
      if (WAKE_KEYS[k] && N.ui.hints && N.ui.hints.el) N.ui.hints.wake();   // Tastenhinweise "Nur kurz": nach Farbtaste/INFO/TOOLS zeigen
      N.fx.step(fast);
      R.dispatch(k, fast);
      return true;
    },
    dispatch: function (k, fast) {
      if (overlays.length) {
        var o = overlays[overlays.length - 1];
        var handled = o.onKey ? o.onKey(k, fast) : false;
        if (!handled && k === 'RETURN') { if (o.cancel) o.cancel(); else R.closeOverlay(o); }
        return;
      }
      if (N.ui.rail && N.ui.rail.isOpen()) { N.ui.rail.onKey(k); return; }
      var t = top();
      if (!t || !t.scr) return;
      var h = t.scr.onKey ? t.scr.onKey(k, fast) : false;
      if (!h && k === 'RETURN') R.back();
    },
    /* Wischen (App.pan, caps.scroll 'free'): Ziel wie bei Tasten – oberstes Overlay, sonst Bildschirm; offene Seitenleiste nimmt
     * keine Zuege. Ein Zug gehoert bis zum Loslassen dem Ziel, das ihn bei 'start' angenommen hat. Ohne pan(): nichts (kein
     * Fokus-Schritt). Rueckgabe true = angenommen. */
    pan: function (e) {
      if (!e) return false;
      var o = overlays.length ? overlays[overlays.length - 1] : null, t = top();
      var rOpen = !!(N.ui.rail && N.ui.rail.isOpen && N.ui.rail.isOpen()), cur = o || (rOpen ? null : t && t.scr);
      if (N.idle) N.idle.touch();
      /* offene Seitenleiste (Nr. 24): waagerechter Zug schiebt sie live zu (N.ui.rail.pan); andere Zuege nimmt sie, ohne etwas zu tun */
      if (!o && (rOpen || panT === 'rail')) {
        if (e.phase === 'start') { panT = e.axis === 'x' && N.ui.rail.pan && N.ui.rail.pan({ phase: 'start', from: 'open', dx: e.dx, x: e.x, t: e.t }) ? 'rail' : null; return true; }
        if (panT === 'rail') { if (e.phase === 'end') panT = null; N.ui.rail.pan({ phase: e.phase, from: 'open', dx: e.dx, t: e.t, cancel: e.cancel }); }
        return true;
      }
      // flexible Flaeche (N.screen, nur Apple): Overlays und Ansichten ohne scr.flex stehen im 1280x720-Kasten (wie N.pointer)
      if (cur && N.screen && N.screen.flex && !o && cur.flex && N.screen.view().x) {   // flexible Ansicht (M/K): Inhaltskante verschoben
        var vo = N.screen.view().x, c3 = {}, k3;
        for (k3 in e) if (Object.prototype.hasOwnProperty.call(e, k3)) c3[k3] = e[k3];
        c3.x = e.x - vo; e = c3;
      } else if (cur && N.screen && N.screen.flex && (o || (!cur.flex && !R.cardFrame(cur)))) {
        var so = o ? N.screen.stageFor(o) : N.screen.stage(), c2 = {}, k;
        for (k in e) if (Object.prototype.hasOwnProperty.call(e, k)) c2[k] = e[k];
        c2.x = (e.x - so.x) / so.k; c2.y = (e.y - so.y) / so.k;   // k < 1: verkleinerter Kasten (schmale Flaeche),
        if (so.k !== 1) { c2.dx = e.dx / so.k; c2.dy = e.dy / so.k; }   // Wege ebenso in Kasten-px
        e = c2;
      }
      var cf = !o && cur ? R.cardFrame(cur) : null;
      if (cf) e = cardLocal(e, cf);                   // Detailkarte: Inhalts-Koordinaten (Karte verschoben, ggf. verkleinert)
      if (e.phase === 'start') {
        cg = null;
        if (cf && cardGesture(cur, e, cf)) return true;
        panT = cur && cur.pan && cur.pan(e) ? cur : null;
        /* Overlay (Panel, Dialog, PIN …), das den Zug nicht nimmt (keine/kurze Liste, waagerecht): annehmen und nichts tun – Wischen
         * ist dort nie ein Fokus-Schritt (sonst Rueckfall des Laders: Fokus springt erst nach dem Abheben, Apple Nr. 12/18) */
        if (!panT && o) panT = SINK;
        return !!panT;
      }
      if (cg) return cardMove(e);
      var p = panT;
      if (e.phase === 'end') panT = null;
      if (p === SINK) return true;
      if (!p) return false;
      if (p !== cur) {                                // Ziel verschwand mitten im Zug (Overlay zu/auf): sauber beenden
        panT = null;
        p.pan({ phase: 'end', cancel: true, axis: e.axis, x: e.x, y: e.y, dx: e.dx, dy: e.dy, t: e.t });
        return false;
      }
      p.pan(e);
      return true;
    },
    /* An den Anfang (App.scrollTop: Tipp ganz oben bzw. Cmd+Pfeil hoch, nur Apple; Auftrag 02.11. Punkt 3): Ziel wie bei Zuegen –
     * oberstes Overlay, sonst der Bildschirm (Detailkarte eingeschlossen); offene Seitenleiste: nichts. Ansicht ohne scrollTop()
     * oder schon oben: false (der Lader macht daraus einen normalen Klick). */
    scrollTop: function () {
      var o = overlays.length ? overlays[overlays.length - 1] : null, t = top();
      if (!o && N.ui.rail && N.ui.rail.isOpen && N.ui.rail.isOpen()) return false;
      var cur = o || (t && t.scr);
      return !!(cur && typeof cur.scrollTop === 'function' && cur.scrollTop());
    },
    /* Tests */
    _reset: function (nf) { factories = {}; stack = []; overlays = []; layer = null; overLayer = null; lastNav = 0; nowFn = nf || U.now; panT = null; cg = null; }
  };

  /* ---- Gesten der Detailkarte (Nr. 9): nach unten ziehen = schliessen (nur wenn der Inhalt ganz oben steht), Mitte -> rechts =
   * eine Ebene zurueck (nicht in einer waagerechten Reihe; auf der ersten Ebene nichts). Schwellen [T]: Schliessen ab 25 % der
   * Kartenhoehe oder 0,5 px/ms nach unten, Zurueck ab 35 % der Breite oder 0,5 px/ms nach rechts (je mindestens 24 px). ---- */
  var CLOSE_PART = 0.25, BACK_PART = 0.35, FLING = 0.5, FLING_MIN = 24;
  function cardLocal(e, f) {
    var c = {}, k;
    for (k in e) if (Object.prototype.hasOwnProperty.call(e, k)) c[k] = e[k];
    c.x = (e.x - f.x) / f.k + (f.cut || 0); c.y = (e.y - f.y) / f.k; c.dx = e.dx / f.k; c.dy = e.dy / f.k; c.ady = e.dy;   // cut: Inhaltskante (M/K)
    return c;
  }
  function cardGesture(scr, e, f) {
    if (e.axis === 'y' && e.dy > 0 && (!scr.cardTop || scr.cardTop())) cg = { kind: 'down', f: f, s: [] };
    else if (e.axis === 'x' && e.dx > 0 && (!scr.cardBackOk || scr.cardBackOk(e.x, e.y))) {
      if (cardDepth() < 2) { cg = { kind: 'none' }; return true; }  // erste Ebene: Mitte -> rechts tut nichts (Nr. 9)
      var under = stack[stack.length - 2];
      cg = { kind: 'back', f: f, s: [], el: scr.el, under: under && under.scr ? under.scr.el : null };
      if (cg.under) cg.under.style.display = '';                     // darunterliegende Ebene schon zeigen
    } else return false;
    cardMove(e);
    return true;
  }
  function cardMove(e) {
    var g = cg, C = N.ui.card;
    if (!g || g.kind === 'none') { if (e.phase === 'end') cg = null; return true; }
    var v = g.kind === 'down' ? e.ady : e.dx;
    g.s.push({ t: e.t || 0, v: v });
    if (g.s.length > 6) g.s.shift();
    if (e.phase !== 'end') { if (g.kind === 'down') C.drag(v); else C.slide(g.el, v); return true; }
    cg = null;
    var a = g.s[0], b = g.s[g.s.length - 1], sp = b.t > a.t ? (b.v - a.v) / (b.t - a.t) : 0;
    var go = !e.cancel && (v > (g.kind === 'down' ? g.f.h * CLOSE_PART : g.f.cw * BACK_PART) || (sp > FLING && v > FLING_MIN));
    if (g.kind === 'down') { if (go) R.closeCard(); else C.settle(); return true; }
    if (go) { R.back(); return true; }
    C.slide(g.el, 0, 200);
    if (g.under) setTimeout(function () { var t = top(); if (t && t.scr && t.scr.el === g.el) g.under.style.display = 'none'; }, 210);
    return true;
  }
  N.router = R;
})(N);
