/* N.RowMath – Geometrie und Virtualisierungsfenster einer Reihe (SPEC 5.1, 7.3, 14.6). Reine Funktionen.
 * Fokus-Anker (Tasten): ab der 2. Karte bleibt der Ring auf Spalte 1 und die Reihe scrollt; erst am Ende wandert der Ring.
 * sc = Scroll-Index (erste Karte am linken Rand). Zeiger-Fokus aendert sc NICHT (sonst liefe die Reihe unter dem Punkt weg). */
(function (N) {
  var X0 = 144, RIGHT = 1216;
  var GEOM = {
    land: { kind: 'land', w: 288, h: 162, step: 312, capY: 184, pool: 8 },
    poster: { kind: 'poster', w: 176, h: 264, step: 200, capY: 280, pool: 11 },
    cast: { kind: 'cast', w: 120, h: 120, step: 144, capY: 136, pool: 11 },     // Besetzung (SPEC 7.6: runde Bilder 120 px)
    sq: { kind: 'sq', tier: 'square', w: 176, h: 176, step: 200, capY: 192, pool: 11 }   // M4 Musik/Hoerbuecher: quadratische Cover
  };
  for (var k in GEOM) {
    var g = GEOM[k];
    g.full = Math.floor((RIGHT - X0 + (g.step - g.w)) / g.step);          // ganz sichtbare Karten (land 3, poster 5)
    g.visible = Math.ceil((1280 - X0) / g.step);                          // inkl. angeschnittener (land 4, poster 6)
  }
  /* Suche (SPEC 7.9): Ergebnisse ab x 560 – Reihen-Container um 416 px versetzt, daher eigene Anzahl sichtbarer Karten */
  GEOM.posterQ = { kind: 'poster-q', tier: 'posterQ', w: 120, h: 180, step: 136, capY: 192, pool: 11, full: 4, visible: 5 };   // zwei Gruppen passen untereinander
  GEOM.landS = { kind: 'land', w: 288, h: 162, step: 312, capY: 184, pool: 8, full: 2, visible: 3 };
  GEOM.castS = { kind: 'cast', w: 120, h: 120, step: 144, capY: 136, pool: 11, full: 4, visible: 5 };
  var R = {
    X0: X0, GEOM: GEOM,
    geom: function (kind) { return GEOM[kind] || GEOM.poster; },
    /* Scroll-Index nach der Anker-Regel (Tasten) */
    scroll: function (n, f, full) { return Math.max(0, Math.min(f, n - full)); },
    maxScroll: function (n, full) { return Math.max(0, n - full); },
    /* Spalte des Fokus auf dem Bildschirm */
    col: function (f, sc) { return f - sc; },
    /* Fenster der Karten im DOM um den Scroll-Index: [first, last], Groesse = Pool (deckt sc-2 … sc+pool-3) */
    win: function (n, sc, pool) {
      var first = Math.max(0, Math.min(sc - 2, n - pool));
      return { first: first, last: Math.min(n - 1, first + pool - 1) };
    },
    /* Bildschirm-x einer Karte */
    x: function (i, sc, g) { return X0 + (i - sc) * g.step; },
    /* Zeiger: Kartenindex unter Bildschirm-x (nur ganz sichtbare Karten, nur Kartenkoerper). -1 = keine Karte */
    hit: function (n, sc, g, x) {
      var c = N.hit.list(X0, g.step, g.w, g.full, x);
      if (c < 0) return -1;
      var i = sc + c;
      return i < n ? i : -1;
    },
    /* Blaettern (Zeiger-Pfeile): neuer Scroll-Index und Fokus mit gleicher Bildschirmspalte */
    page: function (n, f, sc, full, dir) {
      var sc2 = Math.max(0, Math.min(sc + dir * full, R.maxScroll(n, full)));
      return { sc: sc2, f: Math.max(0, Math.min(n - 1, f + (sc2 - sc))) };
    },
    /* Recycling-Plan: welche Indizes fallen raus / kommen dazu */
    diff: function (n, sc0, sc1, pool) {
      var a = R.win(n, sc0, pool), b = R.win(n, sc1, pool), out = { remove: [], add: [] }, i;
      for (i = a.first; i <= a.last; i++) if (i < b.first || i > b.last) out.remove.push(i);
      for (i = b.first; i <= b.last; i++) if (i < a.first || i > a.last) out.add.push(i);
      return out;
    }
  };
  N.RowMath = R;
})(N);
