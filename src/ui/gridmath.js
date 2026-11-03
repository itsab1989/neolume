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
  /* area {w, h}: Flaeche der Ansicht (flexible Flaeche auf Apple, N.screen.area); ohne bzw. bei 1280x720 genau die Tabelle oben.
   * Spalten: so viele, wie links ab X0 bis 144 px vor dem rechten Rand passen (dort die A–Z-Leiste) – bei 1280 5/6/9.
   * Zeilen: AFTER waechst um die zusaetzliche Hoehe; VIS = Unterkante des zeigbaren Bereichs (TV 632).
   * ahead (optional, caps.images 'fast'): so viele Zeilen mehr Vorrat ueber und unter dem Fenster (Bilder ohne sichtbares Nachladen,
   * Apple Nr. 13) und beim Seiten-Vorladen; ohne bzw. 0 genau die TV-Werte */
  function make(size, square, area, ahead) {
    var d = (square ? SQ[size] : SIZES[size]) || (square ? SQ.L : SIZES.L);
    var AW = area && area.w > 0 ? area.w : 1280, AH = area && area.h > 0 ? area.h : 720, VIS = AH - 88;
    var cols = d.cols, after = d.after;
    var RES = area && area.r > 0 ? area.r : 144;                         // rechts frei (A–Z-Leiste); schmale Flaeche M/K: 88
    if ((AW !== 1280 || RES !== 144) && d.cols > 1) cols = Math.max(1, Math.floor((AW - 144 - RES + d.sx - d.w) / d.sx));   // auch schmaler (Hochformat, Nr. 16)
    if (AH > 720) after = d.after + Math.ceil((AH - 720) / d.sy);
    /* Falz (iPhone Duo halb aufgeklappt, area.fold = x der Mitte in Ansichts-Koordinaten; 10-screens.md 3/6.3): gerade Spaltenzahl,
     * Raster so verschoben, dass die Luecke zwischen den mittleren Spalten auf dem Falz liegt (keine Karte darauf) */
    var X0 = 144;
    if (area && area.fold > 0 && cols >= 2 && d.cols > 1) {
      cols -= cols % 2;
      while (cols >= 2) {
        X0 = Math.round(area.fold - (cols / 2) * d.sx + (d.sx - d.w) / 2);
        if (X0 >= 144 && X0 + (cols - 1) * d.sx + d.w <= AW - RES) break;
        cols -= 2;
      }
      if (cols < 2) { cols = 1; X0 = 144; }
    }
    ahead = ahead > 0 ? Math.round(ahead) : 0;
    after += ahead;
    var G = {
      size: SIZES[size] ? size : 'L', square: !!square, COLS: cols, X0: X0, Y0: 176, W: d.w, H: d.h, SX: d.sx, SY: d.sy, CAP_X: d.capX, CAP_Y: d.capY,
      TIER: d.tier, CLS: d.cls, NO_SCALE: !!d.noScale, PAGE: 50, BEFORE: 1 + ahead, AFTER: after, AW: AW, AH: AH, VIS: VIS, AHEAD: ahead,
      POOL: (1 + ahead + after + 1) * cols,
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
        var w = G.win(n, r), last = Math.min(n - 1, w.last + (2 + G.AHEAD) * G.COLS), out = [];
        if (w.last < w.first) return out;
        for (var p = Math.floor(w.first / G.PAGE); p <= Math.floor(last / G.PAGE); p++) out.push(p);
        return out;
      },
      /* Zeilen ab der Fokuszeile, die GANZ ueber dem Ausblend-Band (y 632) liegen: nur sie bekommen Zeiger-Fokus; die naechste
       * (angeschnittene) Zeile ist Randzone (TV-Befund 27.10. nachmittags). Liste 5, Gross 1, Mittel 1, Klein 2 */
      full: function () { return Math.max(1, Math.floor((VIS - G.Y0 - G.H) / G.SY) + 1); },
      /* Ist die angeschnittene Zeile darunter zeigbar? (>= 40 % der Karte ueber dem Band bei y 632: Gross 44 %, Mittel 76 %,
       * Liste 50 % ja; Klein 22 % nein -> dort Randzone). Zeigen = Fokus nach kurzem Verweilen + EIN Schritt Rollen */
      part: function () { var top = G.Y0 + G.full() * G.SY; return (VIS - top) / G.H >= 0.4; },
      /* Obergrenze der unteren Randzone: schmales Band ueber der Hinweisleiste (y 604–656) bzw. ab der nicht zeigbaren Zeile */
      edgeB: function () { var top = G.Y0 + G.full() * G.SY; return G.part() ? VIS - 28 : Math.min(VIS - 28, top); },
      /* Breite des Rasters (Randzonen) */
      width: function () { return G.COLS === 1 ? G.W : (G.COLS - 1) * G.SX + G.W; },
      /* Zeiger: Index unter (x, y) (Fokuszeile und die sichtbaren darunter bis zum deckenden Band) */
      hit: function (n, r, x, y) {
        var c = G.COLS === 1 ? (x >= G.X0 && x < G.X0 + G.W ? 0 : -1) : N.hit.list(G.X0, G.SX, G.W, G.COLS, x);
        if (c < 0 || y < G.Y0 || y >= VIS) return -1;
        var k = Math.floor((y - G.Y0) / G.SY);
        if (y - G.Y0 - k * G.SY >= G.H) return -1;
        var i = (r + k) * G.COLS + c;
        return i < n ? i : -1;
      },
      /* ---- freies Scrollen (caps.scroll 'free', Apple Nr. 12/18): Seitenlage py in px statt Scroll-Zeile r ----
       * In Ruhe nach Tasten gilt py = r * SY; dann liefern rowPx/offPx/hitPx dasselbe wie row-Zeile/offset/hit (Tests). */
      rowPx: function (n, py) { return Math.max(0, Math.min(Math.max(0, G.rows(n) - 1), Math.floor(Math.max(0, py) / G.SY))); },
      offPx: function (py) { return -py; },
      /* groesste Lage: die letzte Zeile (mit Beschriftung) endet am zeigbaren Bereich (VIS), nie < 0 */
      maxPx: function (n) { return n > 0 ? Math.max(0, G.rows(n) * G.SY - (VIS - G.Y0)) : 0; },
      /* Treffer bei Lage py: jede sichtbare Zeile (auch angeschnittene, ab der Clip-Oberkante y 164 bis VIS), nur Kartenkoerper */
      hitPx: function (n, py, x, y) {
        var c = G.COLS === 1 ? (x >= G.X0 && x < G.X0 + G.W ? 0 : -1) : N.hit.list(G.X0, G.SX, G.W, G.COLS, x);
        if (c < 0 || y < 164 || y >= VIS) return -1;
        var d = y - G.Y0 + py, k = Math.floor(d / G.SY);
        if (k < 0 || d - k * G.SY >= G.H) return -1;
        var i = k * G.COLS + c;
        return i < n ? i : -1;
      },
      /* Zeile am Anker bei Lage py (erste Taste nach dem Wischen: die Zeile, die am weitesten oben noch zur Haelfte sichtbar ist) */
      anchorRow: function (n, py) { return Math.max(0, Math.min(Math.max(0, G.rows(n) - 1), Math.round(Math.max(0, py) / G.SY))); }
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
