/* N.SeasonStrip – Staffelstreifen (SPEC 5.20, v2.1 abschaltbar). layout() und seriesBar() sind rein (Node-Tests);
 * N.ui.SeasonStrip rendert statisch aus einem festen Pool (30 Zellen + Marker + Balken + Text), nie im Fokusschritt. */
(function (N) {
  var U = N.util;
  var SIZES = {
    L: { cw: 12, ch: 18, step: 16, barW: 320, barH: 6, text: true },
    M: { cw: 10, ch: 18, step: 14, barW: 416, barH: 6, text: true },
    S: { cw: 8, ch: 12, step: 12, barW: 368, barH: 4, text: false }
  };
  var MAX_CELLS = 30;
  function watchedEp(ep, thr) { return ep.vc > 0 || (ep.dur > 0 && ep.off / ep.dur >= thr); }   // SPEC: Schwelle erreicht bzw. viewCount > 0

  var SS = {
    SIZES: SIZES, MAX_CELLS: MAX_CELLS,
    /* o: {enabled, size:'L'|'M'|'S', episodes:[{index,vc,off,dur}]|null, total, viewed, next (Folgen-index), threshold} */
    layout: function (o) {
      var sz = SIZES[o.size || 'L'], thr = o.threshold || 0.9, i;
      if (!o.enabled) return { mode: 'none' };
      var eps = o.episodes, total = o.total || (eps ? eps.length : 0);
      if (!total) return { mode: 'none' };
      if (eps && eps.length && total <= MAX_CELLS && eps.length <= MAX_CELLS) {
        eps = eps.slice().sort(function (a, b) { return a.index - b.index; });
        var cells = [], marker = null;
        for (i = 0; i < eps.length; i++) {
          var ep = eps[i], st = 'u', fill = 0;
          if (watchedEp(ep, thr)) st = 'w';
          else if (ep.off > 0 && ep.dur > 0) { st = 'p'; fill = Math.max(2, Math.round(sz.ch * ep.off / ep.dur)); }
          cells.push({ x: i * sz.step, state: st, fill: fill });
          if (o.next && ep.index === o.next) marker = { x: i * sz.step, w: sz.cw, y: sz.ch + 3, h: 3 };
        }
        return { mode: 'cells', size: o.size || 'L', cells: cells, marker: marker, width: eps.length * sz.step - (sz.step - sz.cw), text: '' };
      }
      // Modus B: Balken aus leafCount/viewedLeafCount (keine 1100 Folgen laden)
      var viewed = Math.max(0, Math.min(o.viewed || 0, total)), bw = sz.barW;
      var out = { mode: 'bar', size: o.size || 'L', width: bw, height: sz.barH, fill: Math.round(bw * viewed / total), marker: null, text: '' };
      if (o.next) {
        var mx = Math.round(bw * (Math.min(o.next, total) - 1) / total);
        out.marker = { x: Math.max(0, Math.min(bw - 2, mx)), w: 2, y: -3, h: sz.barH + 6 };
      }
      if (sz.text) {
        if (viewed >= total) out.text = N.t('ss.allWatched', { n: total });
        else if (o.next) out.text = N.t('ss.position', { e: o.next, n: total });
      }
      return out;
    },
    /* Gesamt-Serien-Balken (Seriendetails, Variante M-Serie): seasons [{index, leaf, vleaf}] ohne Specials.
     * Segmente >= 4 px, Luecke 2 px; > 40 Staffeln oder Mindestbreiten passen nicht -> einfacher Balken */
    seriesBar: function (seasons, selIndex, width, gap, min) {
      width = width || 416; gap = gap === undefined ? 2 : gap; min = min || 4;
      var list = [], i, sumL = 0, sumV = 0;
      for (i = 0; i < seasons.length; i++) if (seasons[i].index !== 0 && seasons[i].leaf > 0) { list.push(seasons[i]); sumL += seasons[i].leaf; sumV += Math.min(seasons[i].vleaf, seasons[i].leaf); }
      if (!list.length) return { mode: 'none' };
      var k = list.length, avail = width - gap * (k - 1);
      if (k > 40 || k * min > avail) return { mode: 'single', width: width, fill: Math.round(width * sumV / sumL) };
      var w = [], fixed = [], changed = true, rest, sumFree;
      for (i = 0; i < k; i++) { w[i] = avail * list[i].leaf / sumL; fixed[i] = false; }
      while (changed) {
        changed = false; rest = avail; sumFree = 0;
        for (i = 0; i < k; i++) if (fixed[i]) rest -= min; else sumFree += list[i].leaf;
        for (i = 0; i < k; i++) if (!fixed[i]) {
          w[i] = rest * list[i].leaf / sumFree;
          if (w[i] < min) { fixed[i] = true; changed = true; }
        }
        for (i = 0; i < k; i++) if (fixed[i]) w[i] = min;
      }
      // ganzzahlig, Rest auf das breiteste Segment
      var ints = [], tot = 0, widest = 0;
      for (i = 0; i < k; i++) { ints[i] = Math.max(min, Math.floor(w[i])); tot += ints[i]; if (ints[i] > ints[widest]) widest = i; }
      ints[widest] += avail - tot;
      var segs = [], x = 0;
      for (i = 0; i < k; i++) {
        var s = list[i];
        segs.push({ x: x, w: ints[i], fill: Math.round(ints[i] * Math.min(s.vleaf, s.leaf) / s.leaf), sel: s.index === selIndex });
        x += ints[i] + gap;
      }
      return { mode: 'segments', width: width, segments: segs };
    }
  };
  N.SeasonStrip = SS;

  /* ---------- DOM-Renderer (Pool, einmal erzeugt) ---------- */
  /* noText: Zaehltext stellt der Aufrufer selbst (Seriendetails: links neben dem Streifen, rechtsbuendig) */
  function Strip(parent, size, x, y, noText) {
    var sz = SIZES[size];
    this.size = size; this.sz = sz;
    this.el = U.el('div', 'ss ss-' + size, parent, 'left:' + x + 'px;top:' + y + 'px');
    this.cells = [];
    for (var i = 0; i < MAX_CELLS; i++) {
      var c = U.el('div', 'ss-c', this.el, 'left:' + (i * sz.step) + 'px;display:none'), f = U.el('i', '', c);
      this.cells.push({ el: c, fill: f, state: '', shown: false });
    }
    this.marker = U.el('div', 'ss-m', this.el, 'display:none');
    this.bar = U.el('div', 'ss-bar', this.el, 'display:none;width:' + sz.barW + 'px;height:' + sz.barH + 'px');
    this.barFill = U.el('i', '', this.bar, 'height:' + sz.barH + 'px');
    this.text = sz.text && !noText ? U.txt('div', 'ss-t', this.el, '', 'left:' + (sz.barW + 16) + 'px') : null;
    this.mode = 'none';
  }
  Strip.prototype.render = function (lay) {
    var i, c;
    U.show(this.el, lay.mode !== 'none');
    if (lay.mode === 'none') { this.mode = 'none'; return; }
    U.show(this.bar, lay.mode === 'bar');
    for (i = 0; i < MAX_CELLS; i++) {
      c = this.cells[i];
      var d = lay.mode === 'cells' ? lay.cells[i] : null;
      if (!d) { if (c.shown) { c.el.style.display = 'none'; c.shown = false; } continue; }
      if (!c.shown) { c.el.style.display = ''; c.shown = true; }
      if (c.state !== d.state) { c.el.className = 'ss-c' + (d.state === 'w' ? ' w' : ''); c.state = d.state; }
      c.fill.style.height = (d.state === 'p' ? d.fill : 0) + 'px';
    }
    if (lay.mode === 'bar') this.barFill.style.width = lay.fill + 'px';
    var m = lay.marker;
    U.show(this.marker, !!m);
    if (m) this.marker.style.cssText = 'left:' + m.x + 'px;top:' + m.y + 'px;width:' + m.w + 'px;height:' + m.h + 'px';
    if (this.text) U.setText(this.text, lay.text || '');
    this.mode = lay.mode;
  };
  N.ui.SeasonStrip = Strip;
})(N);
