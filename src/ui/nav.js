/* N.nav – reine Index-Navigation fuer Fokus-Zonen (SPEC 14.5: Zonen statt Geometriesuche). -1 = Kante. */
(function (N) {
  N.nav = {
    /* lineare Liste: horizontal (LEFT/RIGHT) oder vertikal (UP/DOWN); kein Wrap */
    list: function (index, count, dir, vertical) {
      var prev = vertical ? 'UP' : 'LEFT', next = vertical ? 'DOWN' : 'RIGHT';
      if (dir === prev) return index > 0 ? index - 1 : -1;
      if (dir === next) return index < count - 1 ? index + 1 : -1;
      return -1;
    },
    /* Raster zeilenweise, cols Spalten; ▼ in eine unvollstaendige letzte Zeile -> letztes Element */
    grid: function (index, count, cols, dir) {
      var r = Math.floor(index / cols), c = index % cols, rows = Math.ceil(count / cols);
      if (dir === 'LEFT') return c > 0 ? index - 1 : -1;
      if (dir === 'RIGHT') return c < cols - 1 && index + 1 < count ? index + 1 : -1;
      if (dir === 'UP') return r > 0 ? index - cols : -1;
      if (dir === 'DOWN') { if (r >= rows - 1) return -1; return Math.min(index + cols, count - 1); }
      return -1;
    }
  };
})(N);
/* N.hit – Zeiger-Treffer per Index-Mathe (Smart-Control-Zeiger; kein getBoundingClientRect, keine Layout-Abfrage).
 * Alle Funktionen liefern einen Index oder -1. */
(function (N) {
  N.hit = {
    /* gleichmaessige Liste: Start p0, Schritt step, Elementgroesse size, Anzahl count, Koordinate p */
    list: function (p0, step, size, count, p) {
      if (p < p0) return -1;
      var i = Math.floor((p - p0) / step);
      if (i >= count || p - p0 - i * step >= size) return -1;
      return i;
    },
    /* Raster: links/oben x0,y0, Element w x h, Schritt sx/sy, cols Spalten */
    grid: function (x0, y0, w, h, sx, sy, cols, count, x, y) {
      var c = N.hit.list(x0, sx, w, cols, x), r = N.hit.list(y0, sy, h, Math.ceil(count / cols), y);
      if (c < 0 || r < 0) return -1;
      var i = r * cols + c;
      return i < count ? i : -1;
    },
    /* nebeneinander nach Textbreite (einmal gemessen): rects [[x, w], …] -> Index des getroffenen Elements */
    spans: function (rects, x) {
      for (var i = 0; i < rects.length; i++) if (x >= rects[i][0] && x < rects[i][0] + rects[i][1]) return i;
      return -1;
    },
    /* Rechteck */
    rect: function (x0, y0, w, h, x, y) { return x >= x0 && x < x0 + w && y >= y0 && y < y0 + h; }
  };
})(N);
