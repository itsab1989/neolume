/* N.GridMath – Geometrie und Virtualisierungsfenster des Bibliotheksrasters (SPEC 7.5, 14.6). Reine Funktionen (Node-Tests).
 * Ansichten je Bibliothek (docs/NUTZER-FEEDBACK-REGELN.md 2): Gross (5 Spalten 176x264, Schritt 200/340), Mittel (6 x 144x216),
 * Klein (9 x 96x144), Liste (1 Spalte, Zeilen 72 hoch). Fokus-Anker: die fokussierte Zeile steht immer bei y = 176
 * (Seiten-Container per translate3d). Fenster im DOM: Zeile −1 … +after um die Fokuszeile, fester Pool. */
(function (N) {
  var SIZES = {
    L: { cols: 5, w: 176, h: 264, sx: 200, sy: 340, capX: 0, capY: 280, tier: 'poster', cls: 'poster', after: 3 },
    M: { cols: 6, w: 144, h: 216, sx: 164, sy: 292, capX: 0, capY: 228, tier: 'posterS', cls: 'poster-s', after: 3 },
    S: { cols: 9, w: 96, h: 144, sx: 112, sy: 212, capX: 0, capY: 156, tier: 'posterXS', cls: 'poster-xs', after: 3 },
    list: { cols: 1, w: 976, h: 72, sx: 0, sy: 84, capX: 72, capY: 12, tier: 'listThumb', cls: 'list', after: 6, noScale: true }
  };
  /* Musik/Hoerbuecher (M4, Feedback-Regel 2): quadratische Cover in denselben Spalten, Zeilen entsprechend flacher */
  var SQ = {
    L: { cols: 5, w: 176, h: 176, sx: 200, sy: 252, capX: 0, capY: 192, tier: 'square', cls: 'sq', after: 3 },
    M: { cols: 6, w: 144, h: 144, sx: 164, sy: 220, capX: 0, capY: 156, tier: 'squareS', cls: 'sq-s', after: 3 },
    S: { cols: 9, w: 96, h: 96, sx: 112, sy: 164, capX: 0, capY: 108, tier: 'squareXS', cls: 'sq-xs', after: 4 },
    list: { cols: 1, w: 976, h: 56, sx: 0, sy: 68, capX: 64, capY: 4, tier: 'listSq', cls: 'list-sq', after: 7, noScale: true }
  };
  function make(size, square) {
    var d = (square ? SQ[size] : SIZES[size]) || (square ? SQ.L : SIZES.L);
    var G = {
      size: SIZES[size] ? size : 'L', square: !!square, COLS: d.cols, X0: 144, Y0: 176, W: d.w, H: d.h, SX: d.sx, SY: d.sy, CAP_X: d.capX, CAP_Y: d.capY,
      TIER: d.tier, CLS: d.cls, NO_SCALE: !!d.noScale, PAGE: 50, BEFORE: 1, AFTER: d.after,
      POOL: (1 + d.after + 1) * d.cols,
      row: function (i) { return Math.floor(i / G.COLS); },
      col: function (i) { return i % G.COLS; },
      rows: function (n) { return Math.ceil(n / G.COLS); },
      /* Position einer Karte im Seiten-Container (Zeile 0 bei y = Y0) */
      pos: function (i) { return { x: G.X0 + G.col(i) * G.SX, y: G.Y0 + G.row(i) * G.SY }; },
      /* Seitenversatz, damit Zeile r am Anker steht */
      offset: function (r) { return -r * G.SY; },
      /* Fenster der Indizes im DOM um die Fokuszeile r: [first, last] */
      win: function (n, r) {
        if (n <= 0) return { first: 0, last: -1 };
        return { first: Math.max(0, (r - G.BEFORE) * G.COLS), last: Math.min(n - 1, (r + G.AFTER + 1) * G.COLS - 1) };
      },
      /* Navigation ▲▼◀▶ -> neuer Index oder -1 (Kante). ▼ in eine unvollstaendige letzte Zeile -> letztes Element */
      move: function (i, n, dir) { return N.nav.grid(i, n, G.COLS, dir); },
      /* FF/RW, CH▲▼: 3 Zeilen (Liste: 5) – gleiche Spalte, am Ende geklemmt */
      jumpRows: function (i, n, rows) {
        if (n <= 0) return 0;
        var t = i + rows * G.COLS;
        if (t < 0) return Math.min(G.col(i), n - 1);
        if (t > n - 1) t = Math.min(n - 1, G.row(n - 1) * G.COLS + G.col(i));
        return t;
      },
      /* Seiten (je PAGE Titel), die fuer das Fenster + Vorlauf (2 Zeilen) geladen sein muessen */
      pagesFor: function (n, r) {
        var w = G.win(n, r), last = Math.min(n - 1, w.last + 2 * G.COLS), out = [];
        if (w.last < w.first) return out;
        for (var p = Math.floor(w.first / G.PAGE); p <= Math.floor(last / G.PAGE); p++) out.push(p);
        return out;
      },
      /* Zeilen ab der Fokuszeile, die GANZ ueber dem Ausblend-Band (y 632) liegen: nur sie bekommen Zeiger-Fokus; die naechste
       * (angeschnittene) Zeile ist Randzone (TV-Befund 27.10. nachmittags). Liste 5, Gross 1, Mittel 1, Klein 2 */
      full: function () { return Math.max(1, Math.floor((632 - G.Y0 - G.H) / G.SY) + 1); },
      /* Ist die angeschnittene Zeile darunter zeigbar? (>= 40 % der Karte ueber dem Band bei y 632: Gross 44 %, Mittel 76 %,
       * Liste 50 % ja; Klein 22 % nein -> dort Randzone). Zeigen = Fokus nach kurzem Verweilen + EIN Schritt Rollen */
      part: function () { var top = G.Y0 + G.full() * G.SY; return (632 - top) / G.H >= 0.4; },
      /* Obergrenze der unteren Randzone: schmales Band ueber der Hinweisleiste (y 604–656) bzw. ab der nicht zeigbaren Zeile */
      edgeB: function () { var top = G.Y0 + G.full() * G.SY; return G.part() ? 604 : Math.min(604, top); },
      /* Breite des Rasters (Randzonen) */
      width: function () { return G.COLS === 1 ? G.W : (G.COLS - 1) * G.SX + G.W; },
      /* Zeiger: Index unter (x, y) (Fokuszeile und die sichtbaren darunter bis zum deckenden Band) */
      hit: function (n, r, x, y) {
        var c = G.COLS === 1 ? (x >= G.X0 && x < G.X0 + G.W ? 0 : -1) : N.hit.list(G.X0, G.SX, G.W, G.COLS, x);
        if (c < 0 || y < G.Y0 || y >= 632) return -1;
        var k = Math.floor((y - G.Y0) / G.SY);
        if (y - G.Y0 - k * G.SY >= G.H) return -1;
        var i = (r + k) * G.COLS + c;
        return i < n ? i : -1;
      }
    };
    return G;
  }
  var base = make('L');
  base.make = make;
  base.SIZES = SIZES;
  base.SQ = SQ;
  base.VIEWS = ['L', 'M', 'S', 'list'];
  N.GridMath = base;
})(N);
