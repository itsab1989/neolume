/* N.ui.infotip – Info-Symbol mit Pop-up statt fester Beschreibungsflaeche (Apple Nr. 28, SPEC SET-9): bei Finger UND Maus/Trackpad
 * (N.input.direct(), Klassen .inp-touch/.inp-ptr) steht hinter jeder Option bzw. Kategorie ein kleines ⓘ (Sprite-Symbol "info",
 * text-2); ein Tipp darauf oeffnet eine Sprechblase mit dem Text, den mit Tasten die Beschreibungsflaeche bzw. INFO zeigt.
 * Mit Tasten (inp-key) blendet die CSS die Symbole aus und die Beschreibungsflaeche wieder ein – es schaltet nur die Klasse am
 * body um, keine Ansicht baut neu (gemischte Bedienung am iPad: kein Hin- und Herspringen).
 * Am TV (caps.focusRing 'always', N.input.on false) legt icon() nichts an: kein DOM, keine Regel greift, TV-Bilder unveraendert.
 * open(o): {title, text, x, y (Mitte des Symbols in Ansichts-Koordinaten), flex (Ansicht mit scr.flex: Koordinaten = Flaeche,
 * sonst im 1280x720-Kasten), el (Symbol, leuchtet in der Akzentfarbe, solange die Blase offen ist)}. Blase 520 breit, unter
 * dem Symbol mit Pfeil nach oben, passt sie dort nicht: darueber (Pfeil nach unten); waagerecht in den Sicherheitsrand
 * geschoben, links nie ueber die Seitenleiste. Lange Texte scrollen in der Blase (Finger, Rad/Trackpad, ▲▼).
 * Schliessen: X oben rechts, Tipp ausserhalb, Esc/Zurueck, OK/INFO. */
(function (N) {
  var U = N.util, PW = 520, PAD = 24, TOP = 60, BOT = 24, AR = 12, GAP = 30, SX = 64, SY = 36, XW = 56, STEP = 52, RAIL = 128;   // RAIL: links nie ueber die eingeklappte Seitenleiste (0–112)
  var IT = { hov: null };
  /* gibt es Symbole auf diesem Geraet? (nur Plattformen mit umschaltbarer Eingabeart) */
  IT.avail = function () { return !!(N.input && N.input.on); };
  /* jetzt sichtbar (Finger/Maus)? Trefferflaechen nur dann */
  IT.on = function () { return !!(N.input && N.input.direct && N.input.direct()); };
  /* Symbol anlegen (32 x 32, Lage per css); ohne avail() null */
  IT.icon = function (parent, css) {
    if (!IT.avail()) return null;
    var e = U.el('span', 'itip', parent, css);
    N.ui.icon(e, 'info', 's1');
    e.setAttribute('role', 'button');
    e.setAttribute('aria-label', N.t('hint.learnMore'));
    return e;
  };
  /* Zeiger ueber einem Symbol (nur Maus/Trackpad, Nr. 20): hoechstens eines in der Akzentfarbe (Klasse on wie bei offener Blase) */
  function lit(el, on) { if (el && (on || !IT.cur || IT.cur.tipEl !== el)) U.cls(el, 'on', on); }
  IT.hover = function (el) {
    if (el && N.input.mode !== 'pointer') el = null;   // Finger: keine Hervorhebung
    if (el === IT.hov) return;
    lit(IT.hov, false);
    IT.hov = el || null;
    lit(IT.hov, true);
  };
  /* reine Lage-Rechnung (getestet): Blase w x h zum Symbol (x, y) in der Flaeche [l, r] x [t, b] -> {left, top, h, up, ax} */
  IT.place = function (x, y, h, l, r, t, b) {
    var left = Math.max(l, Math.min(r - PW, x - PW + 44)), below = b - (y + GAP), above = (y - GAP) - t, up = true;
    if (h > below) { if (h <= above || above > below) up = false; }
    var hh = Math.min(h, up ? below : above);
    return { left: left, top: up ? y + GAP : y - GAP - hh, h: hh, up: up, ax: Math.max(PAD, Math.min(PW - PAD, x - left)) };
  };
  IT.open = function (o) {
    if (IT.cur) IT.cur.cancel();
    IT.hover(null);
    var ov = { el: U.el('div', 'layer'), closed: false, sc: 0, max: 0, tipEl: o.el || null }, off = N.screen && N.screen.flex ? N.screen.off() : { x: 0, y: 0 };
    var A = N.screen ? N.screen.area(true) : { w: 1280, h: 720 };
    var x = o.flex ? o.x - off.x : o.x, y = o.flex ? o.y - off.y : o.y;   // -> Koordinaten des Overlay-Kastens
    var pop = U.el('div', 'itip-pop', ov.el), ar = U.el('div', 'itip-ar', pop);
    U.el('i', '', ar);
    U.txt('div', 'itip-t', pop, o.title || '');
    var xb = U.el('div', 'itip-x', pop);
    xb.setAttribute('role', 'button'); xb.setAttribute('aria-label', N.t('hint.close'));
    U.el('span', '', xb); U.el('i', '', xb); U.el('b', '', xb);
    var clip = U.el('div', 'itip-clip', pop), tx = U.el('div', 'itip-tx', clip);
    tx.appendChild(document.createTextNode(o.text || ''));
    pop.setAttribute('role', 'dialog');
    function close() {
      if (ov.closed) return;
      ov.closed = true;
      if (IT.cur === ov) IT.cur = null;
      if (o.el && o.el !== IT.hov) U.cls(o.el, 'on', false);
      N.router.closeOverlay(ov);
    }
    function scrollTo(v) {
      v = Math.max(0, Math.min(ov.max, v));
      if (v === ov.sc) return;
      ov.sc = v; U.tf(tx, 0, -Math.round(v));
      U.cls(pop, 'more-up', v > 0.5); U.cls(pop, 'more-dn', v < ov.max - 0.5);
    }
    ov.cancel = close;
    ov.close = close;
    ov.hints = function () { return [{ k: 'ret', t: 'hint.close' }]; };
    ov.onKey = function (k) {
      if (k === 'UP' || k === 'DOWN') { scrollTo(ov.sc + (k === 'DOWN' ? STEP : -STEP)); return true; }
      if (k === 'ENTER' || k === 'INFO') { close(); return true; }
      return k !== 'RETURN';
    };
    ov.wheelKeys = ['UP', 'DOWN'];
    ov.wheelPx = function (d) { if (!ov.max) return false; scrollTo(ov.sc + d); return true; };
    function inPop(px, py) { return px >= ov.r[0] && px < ov.r[0] + PW && py >= ov.r[1] && py < ov.r[1] + ov.r[2]; }
    ov.pointer = function (px, py, kind) {
      var onX = px >= ov.r[0] + PW - XW - 12 && px < ov.r[0] + PW + 4 && py >= ov.r[1] - 4 && py < ov.r[1] + XW + 12;   // Knopf 56 x 56 + Rand
      U.cls(xb, 'is-hover', onX && kind === 'move');
      if (kind === 'click' && (onX || !inPop(px, py))) close();   // X oder daneben: zu (Tipp daneben bedient nichts darunter)
      return true;
    };
    ov.pan = function (e) {
      if (e.phase === 'start') { ov.pg = e.axis === 'y' && ov.max > 0 && inPop(e.x, e.y) ? { s: ov.sc, dy: 0 } : null; return true; }
      if (ov.pg) { scrollTo(ov.pg.s - e.dy); if (e.phase === 'end') ov.pg = null; }
      return true;
    };
    ov.destroy = function () { U.cls(xb, 'is-hover', false); };
    N.router.openOverlay(ov);
    IT.cur = ov;
    if (o.el) U.cls(o.el, 'on', true);
    /* einmal messen (nur beim Oeffnen, nie im Tastenpfad) */
    var th = tx.offsetHeight, P = IT.place(x, y, TOP + th + BOT, RAIL - off.x, A.w - SX - off.x, SY - off.y, A.h - SY - off.y);
    ov.max = Math.max(0, th - (P.h - TOP - BOT));
    ov.r = [P.left, P.top, P.h];
    pop.style.cssText = 'left:' + P.left + 'px;top:' + P.top + 'px;height:' + P.h + 'px';
    clip.style.height = (P.h - TOP - BOT) + 'px';
    ar.className = 'itip-ar ' + (P.up ? 'up' : 'dn');
    ar.style.left = (P.ax - AR) + 'px';
    if (ov.max) { clip.setAttribute('data-layout-ok', 'clip'); U.cls(pop, 'more-dn', true); }   // bewusst: scrollt in der Blase
    return ov;
  };
  IT.PW = PW;
  N.ui.infotip = IT;
})(N);
