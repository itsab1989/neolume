/* N.router – Fokus-Engine auf Bildschirm-Ebene (SPEC 14.4/14.5):
 * - Bildschirm-Stapel push/replace/back/reset; max. 2 Ansichten unter der aktuellen bleiben im DOM (display:none),
 *   tiefere werden zerstoert und bei Rueckkehr aus ihrem restore-Objekt neu aufgebaut.
 * - Overlay-Stapel (Dialog, Panel, PIN): RETURN schliesst immer zuerst das oberste Overlay.
 * - Seitenleiste (N.ui.rail) bekommt die Tasten, solange sie ausgeklappt ist.
 * - Tasten-Drossel: Pfeiltasten < 120 ms nach der letzten verarbeiteten -> verworfen; < 200 ms -> fast (keine Uebergaenge).
 * Bildschirm-Schnittstelle: create(root), enter(params, restore), leave() -> restore, destroy(), onKey(k, fast) -> bool,
 *   hints() -> [...], rail -> 'home'|'settings'|null, railClosed(), relabel()   (alles ausser create/onKey optional) */
(function (N) {
  var U = N.util, KEEP = 2, THROTTLE = 120, FAST = 200;
  var factories = {}, stack = [], overlays = [], layer = null, overLayer = null, lastNav = 0, nowFn = U.now, hintCtx = null;
  var WAKE_KEYS = { RED: 1, GREEN: 1, YELLOW: 1, BLUE: 1, INFO: 1, TOOLS: 1 };

  function mkEl() { var e = document.createElement('div'); e.className = 'scr'; return e; }
  function build(entry) {
    var scr = factories[entry.name](entry.params);
    scr.el = scr.el || (layer ? mkEl() : { style: {} });
    if (layer && !scr.el.parentNode) layer.appendChild(scr.el);
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
    for (var i = 0; i < stack.length - 1 - KEEP; i++) if (stack[i].scr) kill(stack[i]);
  }
  function show(entry) {
    var scr = entry.scr || build(entry);
    scr.el.style.display = '';
    if (scr.enter) scr.enter(entry.params, entry.restore || null);
    syncChrome();
  }
  function top() { return stack.length ? stack[stack.length - 1] : null; }

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
      var t = top();
      if (t) hide(t);
      var e = { name: name, params: params || {}, scr: null, restore: null };
      stack.push(e);
      trim();
      show(e);
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
      hide(t); kill(t);
      show(top());
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
    /* ---- Overlays ---- */
    openOverlay: function (ov) {
      overlays.push(ov);
      if (overLayer) { if (!ov.el.parentNode) overLayer.appendChild(ov.el); U.cls(overLayer, 'on', true); }
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
    },
    closeAllOverlays: function () { while (overlays.length) R.closeOverlay(overlays[overlays.length - 1]); },
    hasOverlay: function () { return overlays.length > 0; },
    topOverlay: function () { return overlays.length ? overlays[overlays.length - 1] : null; },
    refreshHints: function () {
      if (!N.ui.hints || !N.ui.hints.el) return;
      var o = overlays.length ? overlays[overlays.length - 1] : null, cx = o || top();
      if (cx !== hintCtx) { hintCtx = cx; N.ui.hints.wake(); }   // neuer Bildschirm/neues Overlay: "Nur kurz" blendet ein (Rail zaehlt nicht)
      if (o) { N.ui.hints.set(o.hints ? o.hints() : [{ k: 'ret', t: 'hint.cancel' }]); return; }
      if (N.ui.rail && N.ui.rail.isOpen()) { N.ui.hints.set([{ k: 'ret', t: 'hint.back' }]); return; }
      var t = top();
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
    /* Tests */
    _reset: function (nf) { factories = {}; stack = []; overlays = []; layer = null; overLayer = null; lastNav = 0; nowFn = nf || U.now; }
  };
  N.router = R;
})(N);
