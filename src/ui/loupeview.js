/* N.ui.LoupeView – Darstellung der Feinauswahl (N.Loupe; SPEC PLAY-30, Darstellungen PLAY-31). Eine Logik, drei Ansichten (info.style;
 * die fruehere Feinleiste C unter dem Balken ist entfallen, siehe N.Loupe):
 *   panel   A "Lasche" (Standard): waechst aus der Oberkante der Bedien-Insel (gemeinsame Kante, Hohlkehlen), Kopfzeile mit Hinweis/Titel,
 *           Feinleiste, darunter Anfang | Ziel | Ende. Die Huelle schneidet an der Inselkante ab, der Inhalt gleitet heraus.
 *   film    D "Filmstreifen": Lasche wie A mit 7 Vorschaubildern ueber das ganze Fenster (1000 px); das Bild unter dem Zeiger ist
 *           umrandet und zeigt die Zielstelle. Bilder lazy (nach dem Einblenden, nacheinander von der Mitte aus, gleiche URLs = Cache).
 *   stretch B "Balken dehnt sich": Ueberzug genau auf dem Balken in 3 Gruppen (links gestaucht, Mitte gedehnt + heller + Striche,
 *           rechts gestaucht); die Oeffnen-Animation zeigt die Dehnung (Gruppen von der groben Lage per scaleX/translate auf gedehnt).
 *           Jetzt laeuft nutzt immer B (Text ueber dem Balken, Knoepfe darunter).
 * Gemeinsam: Ausschnitt-Markierung auf dem Balken + zwei Keil-Linien (Balken -> Lasche, eine Canvas; nicht bei B), Teilstriche, Kapitel-Luecken,
 * Marker-Segmente, gespielter Teil, Knopf + Zielzeit (Enden weichen ihr).
 * Leistung: Elemente einmal angelegt (Pools, je Darstellung beim ersten Gebrauch), Aufbau nur beim Oeffnen; je Zeigerbewegung
 * 2 Transforms + 1 Textknoten (+ Sichtbarkeit der Enden bei Wechsel; film: + 1 Transform bei Bildwechsel, Zielbild hoechstens alle
 * 250 ms); gespielter Teil 1x/s per scaleX. Bewegung nur opacity/transform, 120 ms (reduzierte Bewegung: sofort), Ausblenden sofort.
 * o: {parent, ox, oy (Bildschirm -> parent), barTop, barH (Hauptbalken, Bildschirm-y),
 *     barX, barW, islY, islX, islW (Bedien-Insel: Laschen-Unterkante, Hohlkehlen nur mit Abstand zu den Inselecken)} */
(function (N) {
  var U = N.util, TICKS = 40, GAPS = 12, SEGS = 4, LBL_W = 96, HIDE_END = 92, FILL = 12, IMG_MS = 250;
  var WEDGE = { w: 2, inset: 2, fade: 0.45, pad: 4 };   // Keil: Linienstaerke, Fuss so weit innen am Ausschnitt, Deckkraft am Kopf, Canvas-Rand
  function LoupeView(o) {
    var r = this;
    r.o = o;
    r.lnk = U.el('div', 'lpv-l', o.parent, 'display:none');          // Ausschnitt auf dem Balken + Keil (alle ausser B)
    r.cv = U.el('canvas', 'lpv-w', r.lnk);                          // Keil-Linien (unter dem Ausschnitt: er deckt die Fussenden)
    r.ctx = r.cv.getContext ? r.cv.getContext('2d') : null; r.wc = null;
    if (!r.ctx) r.cv.style.display = 'none';
    r.rng = U.el('div', 'lpv-r', r.lnk);
    // Feinleiste in der Lasche (A, D): Ursprung = linkes Fensterende, y = Mitte der Leiste
    var f = r.fn = U.el('div', 'lpv-fn');
    r.tr = U.el('div', 'lpv-t', f);
    r.fill = U.el('div', 'lpv-f', r.tr);
    r.segs = []; r.gaps = []; r.ticks = [];
    for (var i = 0; i < SEGS; i++) r.segs.push(U.el('i', 'lpv-s', r.tr, 'display:none'));
    for (i = 0; i < TICKS; i++) r.ticks.push(U.el('i', '', f, 'display:none'));
    for (i = 0; i < GAPS; i++) r.gaps.push(U.el('i', 'lpv-g', f, 'display:none'));
    r.knob = U.el('div', 'lpv-k', f);
    r.a = U.txt('div', 'lpv-a', f, ''); r.b = U.txt('div', 'lpv-b', f, '');
    r.v = U.txt('div', 'lpv-v', f, '');
    r.box = {}; r.cur = null; r.on = false; r.g = null; r.st = ''; r.endA = true; r.endB = true; r.fmt = null; r.info = null;
    r.sl = -1; r.fr = null; r.fsrc = []; r.fT = 0; r.fTok = 0; r.xT = 0; r.xWant = -1; r.xLast = 0; r.zs = null; r.go = false; r.pos0 = 0;
  }
  var P = LoupeView.prototype;
  /* Behaelter je Darstellung, beim ersten Gebrauch angelegt */
  P.boxFor = function (st) {
    var r = this, b = r.box[st], o = r.o, i;
    if (b) return b;
    if (st === 'stretch') {
      b = { root: U.el('div', 'lpv-x', o.parent, 'display:none'), z: [] };
      for (var k = 0; k < 3; k++) {
        var z = { el: U.el('div', 'lpv-z' + (k === 1 ? ' lpv-zm' : k ? ' lpv-zr' : ' lpv-zl'), b.root) };
        z.bg = U.el('div', 'lpv-zb', z.el); z.fill = U.el('div', 'lpv-zf', z.el); z.segs = []; z.gaps = [];
        for (i = 0; i < SEGS; i++) z.segs.push(U.el('i', 'lpv-s', z.el, 'display:none'));
        for (i = 0; i < GAPS; i++) z.gaps.push(U.el('i', 'lpv-g', z.el, 'display:none'));
        b.z.push(z);
      }
      b.ticks = [];
      for (i = 0; i < TICKS; i++) b.ticks.push(U.el('i', '', b.z[1].el, 'display:none'));   // Striche ueber dem gedehnten Teil
      b.hd = U.el('div', 'lpv-hd', b.root);
      b.tg = U.el('div', 'lpv-tg', b.root);
    } else {
      b = { root: U.el('div', 'lpv-tb', o.parent, 'display:none') };     // Huelle (schneidet an der Inselkante ab)
      b.inn = U.el('div', 'lpv-in', b.root);
      b.p = U.el('div', 'pl-isl lpv-p', b.inn);
      b.fl = U.el('div', 'lpv-fl', b.inn); b.fr = U.el('div', 'lpv-fr', b.inn);
      U.el('div', 'lpv-rg', b.fl); U.el('div', 'lpv-rg', b.fr);              // Hohlkehle = Viertel eines Rings (ohne Verlauf)
      b.hd = U.txt('div', 'lpv-h ell', b.inn, '');
      if (st === 'film') {
        b.img = [];
        for (i = 0; i < N.Loupe.STY.film.n; i++) { var im = U.el('img', 'lpv-im', b.inn); im.src = N.img.BLANK; b.img.push(im); }
        b.sel = U.el('div', 'lpv-sel', b.inn);
      }
    }
    r.box[st] = b;
    return b;
  };
  /* g aus N.Loupe.geom; info {style, fmt(ms) -> Text, chs, coff, markers, pos (gespielt, Balkenzeit), dur, title (Kopfzeile A/D),
   * img(ms) -> Bild-URL oder '' (D), fail() (D: ein Bild kam nicht)} */
  P.show = function (g, info) {
    var r = this, o = r.o, Lp = N.Loupe, st = info.style || N.Loupe.DEF, b = r.boxFor(st), i;
    if (r.cur && r.cur !== b) r.cur.root.style.display = 'none';
    r.cur = b; r.g = g; r.st = st; r.zs = null; r.fmt = info.fmt; r.info = info; r.endA = r.endB = true; r.sl = -1;
    var ra = o.barX + o.barW * Math.max(0, g.a) / g.dur, rb = o.barX + o.barW * Math.min(g.dur, g.b) / g.dur;
    if (st === 'stretch') r.showStretch(g, info, b);
    else {
      var tb = Lp.tab(st, g, o.islY), pad = Lp.STY[st].pad, fy, x0;   // fy/x0: Lage der Feinleiste im Behaelter
      b.root.style.cssText = 'left:' + (tb.x - FILL - o.ox) + 'px;top:' + (tb.y - o.oy) + 'px;width:' + (tb.w + 2 * FILL) + 'px;height:' + tb.h + 'px;display:block';
      b.p.style.cssText = 'left:' + FILL + 'px;width:' + tb.w + 'px;height:' + tb.h + 'px';
      // Hohlkehlen nur mit Abstand zu den runden Inselecken (sonst Spalt); sie liegen auf der Inselkante
      U.show(b.fl, tb.x - FILL >= o.islX + FILL); U.show(b.fr, tb.x + tb.w + FILL <= o.islX + o.islW - FILL);
      b.fl.style.top = b.fr.style.top = (tb.h - FILL) + 'px'; b.fr.style.left = (FILL + tb.w) + 'px';
      b.hd.parentNode.style.width = (tb.w - 32) + 'px';
      U.setText(b.hd, info.title || '');
      fy = st === 'film' ? 126 : 43; x0 = FILL + pad;
      if (st === 'film') r.showFilm(g, info, b, x0);
      U.tf(b.inn, 0, tb.h);                                    // Start: unter der Kante versteckt
      r.link(ra, rb, g.L, g.L + g.w, o.islY);
      if (r.fn.parentNode !== b.inn) b.inn.appendChild(r.fn);
      r.fn.style.cssText = 'left:' + x0 + 'px;top:' + fy + 'px;width:' + g.w + 'px';
      r.fine(g, info);
    }
    r.played(info.pos);
    r.point({ ms: g.t0, x: g.x0 });
    if (!r.on) {
      r.on = true;
      U.cls(b.root, 'on', false); U.cls(r.lnk, 'on', false);
      U.raf(function () {                                         // naechster Frame: Uebergaenge (120 ms) starten
        if (!r.on || r.cur !== b) return;
        U.cls(b.root, 'on', true); U.cls(r.lnk, 'on', true);
        if (b.inn) U.tf(b.inn, 0, 0);
        if (r.zs) { r.go = true; r.stretchGo(b); }
      });
    }
  };
  /* Ausschnitt auf dem Balken (grobe Skala) + zwei Keil-Linien nach oben zu x1/x2 auf Hoehe y2 (Laschen-Unterkante, Bildschirm).
   * Keil (TV-Befund 28.10.: gedrehte 2-px-Divs hatten ungleiche, harte Enden – Dicke einseitig zum Drehpunkt, Enden schraeg
   * abgeschnitten, eine Linie ragte in den Balken): beide Linien auf einer Canvas (einmal je Oeffnen gezeichnet, keine Transforms,
   * keine Abfragen je Frame), Zeichenweg kantengeglaettet, runde Enden, gleiche Geometrie links/rechts gespiegelt:
   * Fuss = obere Ecke des Ausschnitts (WEDGE.inset px nach innen, Linie liegt AUF dem Balken, nie darin), Kopf = Fensterende auf
   * der Laschen-Unterkante; Helligkeit laeuft vom Fuss (voll) zum Kopf auf WEDGE.fade aus (kein hartes Ende im Leeren). */
  P.link = function (ra, rb, x1, x2, y2) {
    var r = this, o = r.o, y1 = o.barTop, L = Math.round(ra), R = L + Math.max(4, Math.round(rb - ra));
    r.lnk.style.display = 'block';
    r.rng.style.cssText = 'left:' + (L - o.ox) + 'px;top:' + (y1 - o.oy) + 'px;width:' + (R - L) + 'px;height:' + o.barH + 'px';
    if (r.ctx) r.wedge(L + WEDGE.inset, R - WEDGE.inset, x1, x2, y1 - WEDGE.w / 2, y2);
  };
  /* Canvas ueber Balkenbreite + Rand, von der Laschen-Unterkante bis zum Balken; Groesse nur bei Aenderung (setzt den Inhalt zurueck) */
  P.wedge = function (fa, fb, x1, x2, yf, yk) {
    var r = this, o = r.o, c = r.ctx, P2 = WEDGE.pad, X = o.barX - P2, Y = Math.floor(yk) - P2;
    var w = o.barW + 2 * P2, h = Math.ceil(yf + WEDGE.w) - Y + P2;
    if (r.cv.width !== w || r.cv.height !== h) { r.cv.width = w; r.cv.height = h; }
    r.cv.style.left = (X - o.ox) + 'px'; r.cv.style.top = (Y - o.oy) + 'px';
    r.color();
    c.clearRect(0, 0, w, h);
    c.lineWidth = WEDGE.w; c.lineCap = 'round';
    seg(c, r.wc, fa - X, yf - Y, x1 - X, yk - Y); seg(c, r.wc, fb - X, yf - Y, x2 - X, yk - Y);
  };
  /* Farbe aus dem Token (CSS color von .lpv-w), einmal je Ansicht (getComputedStyle = Stil-Berechnung -> nie im Oeffnen-Frame, s. prep) */
  P.color = function () {
    var r = this;
    if (r.wc || !r.ctx) return;
    var cs = window.getComputedStyle(r.cv, null).color || '', m = /(\d+)\D+(\d+)\D+(\d+)/.exec(cs);
    r.wc = m ? m[1] + ',' + m[2] + ',' + m[3] : cs;              // nicht lesbar: einfarbig, ohne Auslaufen
  };
  /* Runde 5 (Messlauf loupe: 2–7 Frames > 50 ms, darunter das erste Oeffnen je Player): Behaelter der Darstellung (bis ~70 Elemente)
   * und die Linienfarbe in Ruhe vorab anlegen (Aufrufer: Idle-Queue nach dem Player-Start), nicht im Frame des Oeffnens */
  P.prep = function (st) { this.boxFor(st || N.Loupe.DEF); if (st !== 'stretch') this.color(); };
  /* Feinleiste: Teilstriche, Kapitel-Luecken, Marker-Segmente (Koordinaten relativ zu r.fn) */
  P.fine = function (g, info) {
    var r = this, Lp = N.Loupe, i, tk = Lp.ticks(g);
    for (i = 0; i < TICKS; i++) {
      var t = tk[i], e = r.ticks[i];
      if (!t) { if (e.style.display !== 'none') e.style.display = 'none'; continue; }
      var h = t.major ? 14 : 6;
      e.className = t.major ? 'lpv-mj' : 'lpv-mn';
      e.style.cssText = 'left:' + (t.x - g.L) + 'px;top:' + (-h / 2) + 'px;height:' + h + 'px';
    }
    var mk = Lp.marks(g, info.chs, info.coff);
    for (i = 0; i < GAPS; i++) {
      if (!mk[i]) { r.gaps[i].style.display = 'none'; continue; }
      r.gaps[i].style.cssText = 'left:' + (mk[i].x - g.L - 1) + 'px;top:-7px';
    }
    var sg = Lp.segs(g, info.markers);
    for (i = 0; i < SEGS; i++) {
      if (!sg[i]) { r.segs[i].style.display = 'none'; continue; }
      r.segs[i].style.cssText = 'left:' + (sg[i].x - g.L) + 'px;width:' + sg[i].w + 'px';
    }
    U.setText(r.a, info.fmt(Math.max(0, g.a))); U.setText(r.b, info.fmt(Math.min(g.dur, g.b)));
    r.a.parentNode.style.visibility = ''; r.b.parentNode.style.visibility = '';
  };
  /* D: Bilder an ihre Abschnitte, Platzhalter zuerst; Laden startet nach dem Einblenden (die Animation bleibt frei) */
  P.showFilm = function (g, info, b, x0) {
    var r = this, F = N.Loupe.STY.film, fr = N.Loupe.frames(g), i;
    r.fr = fr; r.fTok++;
    for (i = 0; i < F.n; i++) {
      b.img[i].style.cssText = 'left:' + (x0 + i * (F.fw + F.gap)) + 'px;top:36px;width:' + F.fw + 'px;height:' + F.fh + 'px';
      if (r.fsrc[i] !== N.img.BLANK) { r.fsrc[i] = N.img.BLANK; b.img[i].src = N.img.BLANK; }
    }
    b.sel.style.cssText = 'left:' + (x0 - 3) + 'px;top:33px;width:' + (F.fw + 6) + 'px;height:' + (F.fh + 6) + 'px';
    if (r.fT) clearTimeout(r.fT);
    var tok = r.fTok;
    r.fT = setTimeout(function () { r.fT = 0; if (r.on && tok === r.fTok) r.loadFrames(tok); }, 140);
  };
  /* nacheinander, von der Auswahl nach aussen; jedes Bild hoechstens einmal je Oeffnen; das ausgewaehlte zeigt die Zielstelle */
  P.loadFrames = function (tok) {
    var r = this, b = r.box.film, n = r.fr.length, order = [], c = r.sl < 0 ? 3 : r.sl, k = 0;
    for (var d = 1; d < n; d++) { if (c - d >= 0) order.push(c - d); if (c + d < n) order.push(c + d); }
    order.push(c);                                               // zuletzt auch das Startbild (falls die Auswahl inzwischen weiterzog)
    function next() {
      if (tok !== r.fTok || !r.on) return;
      var i = order[k++];
      if (i === undefined) return;
      if (i === r.sl) { next(); return; }
      var src = r.info.img(r.fr[i].ms), im = b.img[i];
      if (!src || src === r.fsrc[i]) { next(); return; }
      r.fsrc[i] = src;
      im.onload = function () { im.onload = im.onerror = null; next(); };
      im.onerror = function () { im.onload = im.onerror = null; if (r.info.fail) r.info.fail(); next(); };
      im.src = src;
    }
    r.exact(true);
    next();
  };
  /* Zielbild im ausgewaehlten Abschnitt (hoechstens alle IMG_MS ms; gleiche Bild-URL = kein neues Laden) */
  P.exact = function (now) {
    var r = this, b = r.box.film;
    if (!b || r.st !== 'film' || r.sl < 0 || r.xWant < 0) return;
    var wait = IMG_MS - (U.now() - r.xLast);
    if (!now && wait > 0) { if (!r.xT) r.xT = setTimeout(function () { r.xT = 0; r.exact(true); }, wait); return; }
    if (r.fT) return;                                            // noch in der Einblend-Zeit: loadFrames ruft gleich exact(true)
    var src = r.info.img(r.xWant), im = b.img[r.sl];
    r.xLast = U.now();
    if (src && im.getAttribute('src') !== src) im.src = src;
  };
  /* B: Gruppen (links/Mitte/rechts) gedehnt anlegen und auf die grobe Lage zurueck-transformieren; stretchGo laesst sie aufgehen */
  P.showStretch = function (g, info, b) {
    var r = this, o = r.o, Lp = N.Loupe, zs = Lp.stretch(g, o.barX, o.barW), i, k;
    r.zs = zs; r.lnk.style.display = 'none';
    b.root.style.cssText = 'left:' + (o.barX - o.ox) + 'px;top:' + (o.barTop - o.oy) + 'px;width:' + o.barW + 'px;height:' + o.barH + 'px;display:block';
    var cut = [g.a, g.b], segL = info.markers || [];
    for (k = 0; k < 3; k++) {
      var z = b.z[k], gr = zs.grp[k], lo = k ? cut[k - 1] : 0, hi = k < 2 ? cut[k] : g.dur;
      z.el.style.cssText = 'left:' + Math.round(gr.x - o.barX) + 'px;width:' + Math.max(0, Math.round(gr.w)) + 'px;height:' + o.barH + 'px' + (gr.w < 1 ? ';display:none' : '') +
        ';-webkit-transform-origin:' + gr.o + ' 0;-webkit-transform:translate3d(' + gr.tx.toFixed(1) + 'px,0,0) scale3d(' + gr.s.toFixed(4) + ',1,1)';
      var gi = 0, si = 0;
      var all = info.chs || [];
      for (i = 1; i < all.length && gi < GAPS; i++) {
        var t = all[i].start - (info.coff || 0);
        if (t > lo && t < hi && t > 0 && t < g.dur) z.gaps[gi++].style.cssText = 'left:' + (Math.round(zs.map(t) - gr.x) - 1) + 'px;height:' + o.barH + 'px';
      }
      for (; gi < GAPS; gi++) if (z.gaps[gi].style.display !== 'none') z.gaps[gi].style.display = 'none';
      for (i = 0; i < segL.length && si < SEGS; i++) {
        var s0 = Math.max(lo, segL[i].startTimeOffset), s1 = Math.min(hi, segL[i].endTimeOffset);
        if (s1 > s0) { var sx = Math.round(zs.map(s0) - gr.x); z.segs[si++].style.cssText = 'left:' + sx + 'px;width:' + Math.max(1, Math.round(zs.map(s1) - gr.x) - sx) + 'px;height:' + o.barH + 'px'; }
      }
      for (; si < SEGS; si++) if (z.segs[si].style.display !== 'none') z.segs[si].style.display = 'none';
    }
    var tk = Lp.ticks(g);
    for (i = 0; i < TICKS; i++) {
      var tt = tk[i], e = b.ticks[i];
      if (!tt) { if (e.style.display !== 'none') e.style.display = 'none'; continue; }
      var h = tt.major ? 8 : 4;
      e.className = tt.major ? 'lpv-mj' : 'lpv-mn';
      e.style.cssText = 'left:' + (tt.x - g.L) + 'px;top:' + (-2 - h) + 'px;height:' + h + 'px';
    }
    b.tg.style.top = Math.round(o.barH / 2 - 9) + 'px';
    b.hd.style.top = Math.round(o.barH / 2 - 12) + 'px';
    U.tf(b.hd, Math.round(o.barX + o.barW * U.clamp(info.pos / g.dur, 0, 1) - o.barX - 12), 0);   // Start: grobe Lage des Kopfes
  };
  P.stretchGo = function (b) {
    var r = this;
    for (var k = 0; k < 3; k++) b.z[k].el.style.webkitTransform = 'translate3d(0,0,0)';
    r.headAt(r.pos0);
  };
  P.headAt = function (ms) {
    var r = this, b = r.box.stretch;
    if (!r.zs || !b) return;
    U.tf(b.hd, Math.round(r.zs.map(U.clamp(ms, 0, r.g.dur)) - r.o.barX - 12), 0);
  };
  /* eine Keil-Linie vom Fuss (x1,y1; volle Farbe) zum Kopf (x2,y2; WEDGE.fade) */
  function seg(c, rgb, x1, y1, x2, y2) {
    if (/^\d/.test(rgb)) {
      var gr = c.createLinearGradient(x1, y1, x2, y2);
      gr.addColorStop(0, 'rgba(' + rgb + ',1)'); gr.addColorStop(1, 'rgba(' + rgb + ',' + WEDGE.fade + ')');
      c.strokeStyle = gr;
    } else c.strokeStyle = rgb;
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
  }
  /* Zeiger-Stand {ms, x}: Knopf + Zielzeit wandern (translate3d), Endzeiten weichen der Zielzeit; D: Rahmen auf das Bild darunter;
   * B: Ziel-Strich am Zeiger (Zeit/Vorschaubild zeigt der Player wie bei der groben Vorschau) */
  P.point = function (p) {
    var r = this, g = r.g;
    if (!g) return;
    var x = p.x - g.L;
    if (r.st === 'stretch') { U.tf(r.box.stretch.tg, Math.round(p.x - r.o.barX - 2), 0); return; }
    U.tf(r.knob, x - 7, 0);
    U.tf(r.v.parentNode, U.clamp(x - LBL_W / 2, -8, g.w - LBL_W + 8), 0);
    U.setText(r.v, r.fmt(p.ms));
    var ea = x > HIDE_END, eb = g.w - x > HIDE_END;
    if (ea !== r.endA) { r.endA = ea; r.a.parentNode.style.visibility = ea ? '' : 'hidden'; }
    if (eb !== r.endB) { r.endB = eb; r.b.parentNode.style.visibility = eb ? '' : 'hidden'; }
    if (r.st === 'film') {
      var F = N.Loupe.STY.film, sl = N.Loupe.slot(g, p.x), b = r.box.film;
      if (sl !== r.sl) {
        if (r.sl >= 0 && b.img[r.sl].getAttribute('src') !== r.fsrc[r.sl]) b.img[r.sl].src = r.fsrc[r.sl] || N.img.BLANK;   // altes Bild: wieder sein Abschnitt
        r.sl = sl;
        U.tf(b.sel, sl * (F.fw + F.gap), 0);
      }
      r.xWant = p.ms;
      r.exact(false);
    }
  };
  /* gespielter Teil (Balkenzeit), hoechstens 1x/s */
  P.played = function (ms) {
    var r = this, g = r.g;
    if (!g) return;
    r.pos0 = ms;
    if (r.st === 'stretch') {
      var b = r.box.stretch, cut = [0, Math.max(0, g.a), Math.min(g.dur, g.b), g.dur];
      for (var k = 0; k < 3; k++) {
        var lo = cut[k], hi = cut[k + 1], f = hi > lo ? U.clamp((ms - lo) / (hi - lo), 0, 1) : 0;
        b.z[k].fill.style.webkitTransform = 'scaleX(' + f.toFixed(4) + ')';
      }
      if (r.go) r.headAt(ms);
      return;
    }
    var fq = U.clamp((ms - g.a) / (g.b - g.a), 0, 1);
    r.fill.style.webkitTransform = 'scaleX(' + fq.toFixed(4) + ')';
  };
  P.hide = function () {
    var r = this;
    if (!r.on) return;
    r.on = false; r.go = false; r.g = null; r.zs = null; r.fTok++; r.sl = -1; r.xWant = -1;
    if (r.fT) { clearTimeout(r.fT); r.fT = 0; }
    if (r.xT) { clearTimeout(r.xT); r.xT = 0; }
    if (r.cur) { U.cls(r.cur.root, 'on', false); r.cur.root.style.display = 'none'; }
    U.cls(r.lnk, 'on', false); r.lnk.style.display = 'none';
  };
  N.ui.LoupeView = LoupeView;
})(N);
