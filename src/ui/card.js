/* N.ui.card – Detailansicht als Karte von unten (caps.details 'card', nur Touch/Maus-Plattformen; Entscheidung Nr. 9/16,
 * SPEC DET-20). Am Fernseher (caps.details 'page', Standard) wird nichts hiervon angelegt; N.router fragt N.ui.card.on() und
 * bleibt sonst unveraendert.
 * - Ansichten mit scr.card (Details, Album, Kuenstler, fremder Titel) stehen nicht im Bildschirm-Stapel-DOM, sondern in EINER Karte
 *   (.cardhost > .card-sheet > .card-body) ueber der abgedunkelten Ansicht darunter. Tiefere Ebenen (Serie -> Folge, Aehnliche
 *   Titel …) wechseln IN der Karte (von rechts herein), keine Karte auf der Karte. Knopf oben links: X (erste Ebene) bzw.
 *   Zurueck-Pfeil (tiefere Ebenen).
 * - Geometrie (rein, getestet: geom): Touch – volle Breite, oben ein Spalt, Ecken oben rund; Maus (Mac) – mittiges Feld mit Rand.
 *   Inhalt rechnet in App-px mit Breite 1280 und Hoehe h/k; ist die Karte schmaler als 1280 (Mac-Fenster, spaeter Hochformat),
 *   wird der Inhalt mit k = w/1280 verkleinert – keine feste 1280er-Flaeche fuer die Karte selbst.
 * - Gesten fuehrt N.router.pan (Ziehen nach unten, Mitte -> rechts); hier nur die Darstellung (drag/settle/ghost). */
(function (N) {
  var U = N.util, GAP = 32, MAC_X = 48, MAC_Y = 40, CW = 1280, BTN = 60, OPEN_MS = 280, LEVEL_MS = 240;

  /* rein: Karte in einer Flaeche W x H. touch = Finger-Geraet (volle Breite), sonst Maus/Trackpad (mittiges Feld).
   * cls (optional, Groessenklasse der Flaeche, 10-screens.md 6.3): M und K immer volle Breite (auch mit Maus), ohne Verkleinern –
   * der Inhalt rechnet in einer um cut breiteren Flaeche und ist um cut nach links verschoben (wie N.screen.view: Inhaltskante 80
   * bzw. 24 statt 144); M·N als Blatt von unten (oben 15 % frei), K als Vollbild-Blatt (oben 12 px); K = narrow (schmale Anordnung
   * der Details: kein Plakat, Info und Knoepfe ab der Inhaltskante). */
  var CUT = { M: 64, K: 120 };
  /* safe (optional, N.screen.safe {t, r, b, l}): Karte beginnt unter dem oberen Rand (Dynamic Island), Inhaltskante mindestens 16
   * neben dem linken (Notch quer); unten reicht die Karte bis an den Bildschirmrand (Inhalt rollt unter den Home-Indikator) */
  function geom(W, H, touch, cls, safe) {
    var cw = cls && CUT[cls.w] ? cls.w : '', g, st = safe && safe.t > 0 ? safe.t : 0, sl = safe && safe.l > 0 ? safe.l : 0, sr = safe && safe.r > 0 ? safe.r : 0;
    if (cw) {
      var top = Math.max(cw === 'K' ? 12 : cls.h === 'N' ? Math.round(H * 0.15) : GAP, st ? st + 12 : 0);
      g = { x: 0, y: top, w: W, h: H - top, round: 'top', k: 1, cut: Math.min(CUT[cw], Math.max(0, 128 - sl)), narrow: cw === 'K' };
      g.cw = W + g.cut - sr; g.ch = g.h; if (sl) g.bx = sl;   // rechter Rand: Inhalt endet davor; X/Pfeil neben dem linken
      return g;
    }
    var gt = Math.max(GAP, st ? st + 12 : 0);
    g = touch ? { x: 0, y: gt, w: W, h: H - gt, round: 'top' }
      : { w: Math.min(CW, W - 2 * MAC_X), y: MAC_Y, h: H - 2 * MAC_Y, round: 'all' };
    if (!touch) g.x = Math.round((W - g.w) / 2);
    g.k = g.w >= CW ? 1 : g.w / CW;
    g.ch = Math.round(g.h / g.k);                   // Inhaltshoehe in App-px (Breite immer 1280)
    g.cw = g.w >= CW ? g.w : CW;                    // Inhaltsbreite: breitere Karte (Touch, breites Fenster) -> Reihen laufen weiter
    g.cut = 0; g.narrow = false;
    return g;
  }

  var C = { geom: geom, BTN: BTN, OPEN_MS: OPEN_MS, LEVEL_MS: LEVEL_MS, el: null, shown: false, g: null, closing: 0, ghosts: [] };
  function caps() { return N.platform && N.platform.caps || {}; }
  /* Karte an? (Plattform-Faehigkeit; am TV immer false) */
  C.on = function () { return caps().details === 'card'; };
  function anim() { return !(N.fx && N.fx.reduced && N.fx.reduced()); }
  function tf(el, x, y, ms) {
    el.style.webkitTransition = el.style.transition = ms ? '-webkit-transform ' + ms + 'ms cubic-bezier(0.2, 0.8, 0.2, 1), transform ' + ms + 'ms cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none';
    var t = 'translate3d(' + Math.round(x) + 'px,' + Math.round(y) + 'px,0)';
    el.style.webkitTransform = el.style.transform = t;
  }
  function fade(el, o, ms) {
    el.style.webkitTransition = el.style.transition = ms ? 'opacity ' + ms + 'ms ease-out' : 'none';
    el.style.opacity = String(o);
  }

  /* DOM einmal anlegen (im Bildschirm-Layer, ueber den Ansichten) */
  C.init = function (layer) {
    if (C.el || !layer) return;
    var h = C.el = U.el('div', 'cardhost', layer, 'display:none');
    C.dim = U.el('div', 'card-dim', h);
    C.sheet = U.el('div', 'card-sheet', h);
    C.body = U.el('div', 'card-body', C.sheet);
    C.btn = U.el('div', 'card-btn is-x', C.sheet);
    U.el('i', '', C.btn); U.el('b', '', C.btn);
    C.layout();
  };
  /* Geometrie fuer die aktuelle Flaeche (ohne DOM; Ansichten fragen sie beim Aufbau, bevor die Karte angelegt ist) */
  C.peek = function () {
    var A = N.screen ? N.screen.area(true) : { w: 1280, h: 720 };
    return geom(A.w, A.h, !!caps().touch, N.screen && N.screen.flex ? N.screen.cls : null, N.screen && N.screen.flex ? N.screen.safe : null);
  };
  /* Flaeche geaendert (N.screen) bzw. erstes Oeffnen: Lage und Groesse der Karte, Inhalt in App-px (1280 x ch) */
  C.layout = function () {
    if (!C.el) return null;
    var g = C.g = C.peek(), st = C.sheet.style;
    st.left = g.x + 'px'; st.top = g.y + 'px'; st.width = g.w + 'px'; st.height = g.h + 'px';
    U.cls(C.sheet, 'r-all', g.round === 'all');
    U.cls(C.sheet, 'narrow', !!g.narrow);
    C.btn.style.left = g.bx ? (20 + g.bx) + 'px' : '';
    var bs = C.body.style, sc = (g.cut ? 'translate(' + (-g.cut) + 'px,0) ' : '') + 'scale(' + g.k + ')';
    bs.width = g.cw + 'px'; bs.height = g.ch + 'px';
    bs.webkitTransform = bs.transform = g.k === 1 && !g.cut ? '' : sc;
    for (var c = C.body.firstChild; c; c = c.nextSibling) { c.style.width = g.cw + 'px'; c.style.height = g.ch + 'px'; }
    return g;
  };
  /* Ansichts-Element in die Karte haengen (Router build) */
  C.adopt = function (el) {
    if (!C.el) return;
    C.body.appendChild(el);
    var g = C.g || C.layout();
    el.style.width = g.cw + 'px'; el.style.height = g.ch + 'px';
  };
  /* Knopf oben links: 'x' (erste Ebene) | 'back' */
  C.button = function (kind) { U.cls(C.btn, 'is-x', kind !== 'back'); U.cls(C.btn, 'is-back', kind === 'back'); };
  /* Karte zeigen; fresh = sie war zu -> von unten hereingleiten */
  C.show = function (fresh) {
    if (!C.el) return;
    if (fresh) C.flush();
    if (C.shown && !fresh) return;
    C.layout();
    C.shown = true;
    U.show(C.el, true);
    if (fresh && anim()) {
      tf(C.sheet, 0, C.g.h + C.g.y, 0); fade(C.dim, 0, 0);
      C.el.offsetWidth;                              // Startlage festschreiben, dann gleiten
      tf(C.sheet, 0, 0, OPEN_MS); fade(C.dim, 1, OPEN_MS);
    } else { tf(C.sheet, 0, 0, 0); fade(C.dim, 1, 0); }
  };
  /* Karte zu: nach unten hinaus, dann Element(e) entfernen; ohne Animation sofort */
  C.hide = function (animate, done) {
    if (!C.el || !C.shown) { if (done) done(); return; }
    C.shown = false;
    function end() {
      C.closing = 0;
      if (!C.shown) U.show(C.el, false);
      if (done) done();
    }
    if (animate && anim()) {
      tf(C.sheet, 0, C.g.h + C.g.y, OPEN_MS); fade(C.dim, 0, OPEN_MS);
      C.closing = setTimeout(end, OPEN_MS + 20);
      C.closeDone = end;
    } else end();
  };
  /* laufende Ausgaenge (Schliessen, Ebene zurueck) sofort beenden – vor jeder neuen Stapel-Aenderung */
  C.flush = function () {
    if (C.closing) { clearTimeout(C.closing); var f = C.closeDone; C.closing = 0; C.closeDone = null; if (f) f(); }
    while (C.ghosts.length) { var g = C.ghosts.pop(); clearTimeout(g.t); if (g.el.parentNode) g.el.parentNode.removeChild(g.el); }
  };
  /* tiefere Ebene: neues Element kommt von rechts herein */
  C.enterLevel = function (el) {
    if (!anim()) return;
    tf(el, C.g ? C.g.cw : CW, 0, 0); el.offsetWidth; tf(el, 0, 0, LEVEL_MS);
  };
  /* Element einer verlassenen Ebene noch hinausgleiten lassen (nach rechts), dann entfernen. Ansicht ist schon zerstoert. */
  C.ghost = function (el) {
    if (!el) return;
    if (!anim()) { if (el.parentNode) el.parentNode.removeChild(el); return; }
    el.style.zIndex = '2';
    tf(el, C.g ? C.g.cw : CW, 0, LEVEL_MS);
    var g = { el: el };
    g.t = setTimeout(function () { var i = C.ghosts.indexOf(g); if (i >= 0) C.ghosts.splice(i, 1); if (el.parentNode) el.parentNode.removeChild(el); }, LEVEL_MS + 20);
    C.ghosts.push(g);
  };
  /* ---- Gesten (Darstellung; Logik in N.router.pan) ---- */
  /* Ziehen nach unten: Karte folgt dem Finger (dy in App-px), Abdunklung nimmt ab */
  C.drag = function (dy) {
    if (!C.el) return;
    dy = Math.max(0, dy);
    tf(C.sheet, 0, dy, 0);
    fade(C.dim, Math.max(0, 1 - dy / (C.g.h || 1)), 0);
  };
  /* zurueckfedern (nicht geschlossen) */
  C.settle = function () { if (C.el) { tf(C.sheet, 0, 0, 220); fade(C.dim, 1, 220); } };
  /* Mitte -> rechts: oberstes Element folgt dem Finger (dx in Inhalts-px), das darunter ist schon sichtbar */
  C.slide = function (el, dx, ms) { if (el) tf(el, Math.max(0, dx), 0, ms || 0); };
  /* Treffer in App-Koordinaten: 'btn' (X/Pfeil), 'in' (Karte), 'out' (Abdunklung daneben/darueber) */
  C.hit = function (x, y) {
    var g = C.g;
    if (!g || !C.shown) return '';
    if (x < g.x || x >= g.x + g.w || y < g.y || y >= g.y + g.h) return 'out';
    var bx = x - g.x - (g.bx || 0), by = y - g.y;
    return bx >= 16 && bx < 16 + BTN + 8 && by >= 12 && by < 12 + BTN + 8 ? 'btn' : 'in';
  };
  N.ui.card = C;
})(N);
