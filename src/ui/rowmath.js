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
    /* ---- Reihen-Listen per Zeiger (NAV-2, HOME-11; Startseite, Suche/Entdecken) ----
     * VIS: Unterkante des zeigbaren Bereichs (darunter Verlauf und Hinweisleiste), EDGE_B: Beginn der unteren Randzone */
    VIS: 632, EDGE_B: 604, PART: 0.4,
    /* Startseite: Zone "naechste Reihe". head = Bildschirm-y des Kopfs der naechsten Reihe, bottom = Unterkante der Karten der
     * Fokusreihe. Kopf sichtbar -> Zone ab dem Kopf; sonst (hohe Posterreihe schiebt ihn hinaus) Band ab der Kartenunterkante
     * und fester Hinweis unten links (cue), damit man sieht, dass darunter noch etwas kommt */
    nextZone: function (head, bottom) { return head < R.VIS ? { y: head, cue: false } : { y: bottom + 4, cue: true }; },
    /* Sichtbarkeit einer Reihe: cy = Bildschirm-y der Kartenoberkante, h = Kartenhoehe, top = Oberkante des Ausschnitts.
     * 'full' = ganz sichtbar (Zeiger fokussiert sofort, ohne zu rollen), 'part' = zu >= 40 % sichtbar (nach Verweilen bzw. per
     * Klick: erst hereinholen), '' = nicht zeigbar */
    vis: function (cy, h, top) {
      if (cy < top || cy >= R.VIS) return '';
      if (cy + h <= R.VIS) return 'full';
      return (R.VIS - cy) / h >= R.PART ? 'part' : '';
    },
    /* Beginn der unteren Randzone: EDGE_B, bei einer nicht zeigbaren angeschnittenen Reihe schon an deren Oberkante
     * (wie GridMath.edgeB). rows: [{cy, h}] der sichtbaren Reihen */
    edgeB: function (rows, top) {
      var b = R.EDGE_B;
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (r.cy < R.VIS && r.cy + r.h > R.VIS && !R.vis(r.cy, r.h, top)) b = Math.min(b, Math.max(top, r.cy));
      }
      return b;
    },
    /* ---- Detailseiten per Zeiger (NAV-2, DET-9; Film/Serie, fremder Titel, Album, Kuenstler) ----
     * Die Seite rastet je Abschnitt (Knoepfe, Staffeln/Folgen, Besetzung, …) auf einem festen Versatz ein ("Stopp"); erst dann
     * stehen Info-Block und Knoepfe passend. Sichtbarkeit eines Zeigeziels: cy = Bildschirm-y, h = Hoehe, anchored = sein
     * Abschnitt ist der eingerastete, top = Oberkante des zeigbaren Bereichs (darueber Info-Block bzw. ausgeblendete Abschnitte).
     * 'full' = Fokus ohne Rollen (nur im eingerasteten Abschnitt), 'part' = anderer Abschnitt, zu >= 40 % im Bild (erst nach
     * Verweilen bzw. per Klick hereinholen – auch wenn er ganz zu sehen ist, z. B. die Staffel-Reiter unter den Knoepfen: der
     * Fokus dort braucht den Seitenwechsel), '' = nicht zeigbar */
    secVis: function (cy, h, anchored, top) {
      if (cy < top || cy >= R.VIS) return '';
      if (anchored) return 'full';
      return R.vis(cy, h, top) ? 'part' : '';
    },
    /* naechster Stopp in Richtung d (stops aufsteigend); -1 = keiner */
    secNext: function (stops, off, d) {
      var i;
      if (d > 0) { for (i = 0; i < stops.length; i++) if (stops[i] > off) return i; }
      else for (i = stops.length - 1; i >= 0; i--) if (stops[i] < off) return i;
      return -1;
    },
    /* Beginn der unteren Randzone einer Detailseite: wie edgeB (bei einer nicht zeigbaren angeschnittenen Reihe ab deren
     * Oberkante); ragt ein zeigbares Ziel, das ganz ueber VIS endet (Staffel-Reiter y 580–620), in EDGE_B hinein, beginnt die
     * Zone erst unter ihm. rows: [{cy, h}] der Ziele im Bild */
    secEdgeB: function (rows, top) {
      var b = R.edgeB(rows, top);
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (b === R.EDGE_B && r.cy >= top && r.cy < b && r.cy + r.h > b && r.cy + r.h <= R.VIS) b = r.cy + r.h;
      }
      return b;
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
