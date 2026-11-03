/* N.screen – logische App-Flaeche (docs/research/apple/08-touch.md 8, 10-screens.md 6).
 * Fernseher (caps.screen.flex aus, Standard): immer 1280x720, Groessenklasse R·N, nichts aendert sich – alle Rechnungen liefern die
 * festen Werte.
 * Flexible Plattform (Apple: iPhone/iPad hoch und quer, geteilte Fenster, Mac-Fenster): W x H (>= Mindestflaeche caps.screen.w/h)
 * aus N.platform.screen.size(); die Plattform meldet Groessenwechsel als N.evt 'screen:changed' (entprellt), N.screen gibt sie als
 * 'screen:resized' {w, h, cls, clsChanged} weiter.
 * Groessenklassen (10-screens.md 6.2, nur aus der Flaeche, nie aus Geraet oder Ausrichtung): Breite K (kompakt, W < 800),
 * M (mittel, < 1280), R (regulaer); Hoehe F (flach, H < 720), N (normal). Am body (nur flexibel) die Klassen sz-k/sz-m/sz-r und
 * sz-f/sz-n fuer das Plattform-CSS.
 * Ansichten, die schon mit W x H rechnen, setzen scr.flex = true (Startseite, Mediathek, Einstellungen); alle anderen stehen in
 * einem mittigen 1280x720-Kasten (Klasse stage720 am Bildschirm, N.router), Overlays ebenso. stage() = Lage dieses Kastens
 * {x, y, k}: k < 1, wenn die Flaeche schmaler als 1280 bzw. flacher als 720 ist (Kasten verkleinert statt abgeschnitten);
 * off() = nur die Lage {x, y}. toStage/fromStage rechnen Flaechen- in Kasten-Punkte um und zurueck.
 * Ansichten fragen W x H immer ueber area() ab (nie N.screen.w direkt). */
(function (N) {
  var BW = 1280, BH = 720, K_W = 800, R_W = 1280, N_H = 720;
  function classOf(w, h) {
    var a = w < K_W ? 'K' : w < R_W ? 'M' : 'R', b = h < N_H ? 'F' : 'N';
    return { w: a, h: b, id: a + '·' + b };
  }
  var S = {
    BW: BW, BH: BH, w: BW, h: BH, flex: false, cls: classOf(BW, BH), classOf: classOf,
    /* einmal in App.start (nach N.platform.init): Faehigkeit lesen, Startgroesse holen, Wechsel abonnieren */
    init: function () {
      var P = N.platform, c = P && P.caps && P.caps.screen;
      S.flex = !!(c && c.flex === true && P.screen && typeof P.screen.size === 'function');
      S.w = BW; S.h = BH; S.minW = BW; S.minH = BH; S.cls = classOf(BW, BH);
      if (S.flex && c.w > 0 && c.h > 0) { S.minW = c.w; S.minH = c.h; }
      if (!S.flex) return;
      S.read();
      S.body();
      N.evt.off('screen:changed', S.changed);
      N.evt.on('screen:changed', S.changed);
    },
    /* Groesse der Plattform uebernehmen (nie kleiner als minW x minH, gerade Zahlen: Kasten-Versatz ganzzahlig) -> geaendert? */
    read: function (sz) {
      if (!S.flex) return false;
      sz = sz || N.platform.screen.size() || {};
      var w = S.clampW(sz.w), h = S.clampH(sz.h), fl = S.folds(sz.fold), fs = JSON.stringify(fl), ch = w !== S.w || h !== S.h || fs !== S.foldSig;
      S.w = w; S.h = h; S.cls = classOf(w, h); S.fold = fl; S.foldSig = fs;
      return ch;
    },
    minW: BW, minH: BH, fold: [], foldSig: '[]',
    /* Falz (iPhone Duo, reservierter Bereich "division" vom Geruest, in Flaechen-Koordinaten): nur senkrechte Streifen innerhalb der
     * Flaeche zaehlen (Raster legt die Spalten-Luecke darauf, N.GridMath area.fold) -> [{x, w}] */
    folds: function (list) {
      var out = [];
      if (!list || !list.length) return out;
      for (var i = 0; i < list.length; i++) {
        var f = list[i] || {}, x = Number(f.x), w = Number(f.w), h = Number(f.h);
        if (isFinite(x) && w >= 0 && h > w && x > 0 && x < S.w) out.push({ x: Math.round(x), w: Math.round(w) });
      }
      return out;
    },
    /* Mitte des Falzes in Ansichts-Koordinaten einer flexiblen Ansicht (0 = keiner) */
    foldX: function () { var f = S.fold[0]; return f ? f.x + f.w / 2 - S.view().x : 0; },
    clampW: function (v) { v = Math.round(Number(v) || 0); v += v % 2; return v > S.minW ? v : S.minW; },
    clampH: function (v) { v = Math.round(Number(v) || 0); v += v % 2; return v > S.minH ? v : S.minH; },
    changed: function (sz) {
      var was = S.cls.id;
      if (!S.read(sz)) return;
      S.body();
      N.evt.emit('screen:resized', { w: S.w, h: S.h, cls: S.cls.id, clsChanged: S.cls.id !== was });
    },
    /* Klassen am body (nur flexibel; der TV-body bleibt unberuehrt) */
    body: function () {
      var b = typeof document !== 'undefined' && document.body;
      if (!S.flex || !b) return;
      var c = String(b.className || '').replace(/(^|\s)sz-[kmrfn](?=\s|$)/g, '').replace(/\s+/g, ' ').replace(/^\s|\s$/g, '');
      b.className = (c ? c + ' ' : '') + 'sz-' + S.cls.w.toLowerCase() + ' sz-' + S.cls.h.toLowerCase();
    },
    /* Breiten-/Hoehenklasse abfragen: N.screen.is('K'), is('F'); am TV immer R bzw. N */
    is: function (c) { return S.cls.w === c || S.cls.h === c; },
    /* Flaeche einer Ansicht: flexibel -> W x H, sonst (oder am TV) 1280x720 */
    area: function (flexView) { return S.flex && flexView ? { w: S.w, h: S.h } : { w: BW, h: BH }; },
    /* Anordnung je Breitenklasse (10-screens.md 6.3) fuer flexible Ansichten: R = feste Seitenleiste (Inhalt ab x 144 wie am TV);
     * M = Seitenleiste einblendbar (Menue-Knopf oben links, Rand-Wisch), Inhalt ab x 80; K = Leiste unten (N.ui.tabbar, TAB_H hoch),
     * Inhalt ab x 24. Die Ansichten rechnen weiter mit der TV-Kante 144: ihre Flaeche ist um cut breiter und um cut nach links
     * verschoben (der Streifen der Seitenleiste liegt ausserhalb des Bildes), unten um bar kuerzer. TV: alles 0. */
    CUT: { R: 0, M: 64, K: 120 }, TAB_H: 88,
    shape: function () {
      if (!S.flex) return { cut: 0, bar: 0 };
      var w = S.cls.w;
      return { cut: S.CUT[w] || 0, bar: w === 'K' ? S.TAB_H : 0 };
    },
    /* Flaeche und Lage einer flexiblen Ansicht in der Flaeche: {x, y, w, h} (x = -cut); am TV 0/0/1280/720 */
    view: function () {
      if (!S.flex) return { x: 0, y: 0, w: BW, h: BH };
      var sh = S.shape();
      return { x: -sh.cut, y: 0, w: S.w + sh.cut, h: S.h - sh.bar };
    },
    /* Lage und Faktor des mittigen 1280x720-Kastens (stage720, Overlays) in der Flaeche; am TV 0/0/1. Gleiche Regel wie
     * PNA.scale.stage im Apple-Lader (setzt --ox/--oy/--ok fuer flex.css) */
    stage: function () {
      if (!S.flex) return { x: 0, y: 0, k: 1 };
      var k = Math.min(1, S.w / BW, S.h / BH);
      return { x: (S.w - BW * k) / 2, y: (S.h - BH * k) / 2, k: k };
    },
    off: function () { var g = S.stage(); return { x: g.x, y: g.y }; },
    /* Overlays (Dialog, Panel, PIN …) in der Flaeche (nur flexibel; 10-screens.md 6.3): jedes steht nach seinem eigenen Kasten
     * statt im 1280x720-Raster – Panel (.panel, nicht .pfull) rechts buendig, Dialog (.dlg/.pdlg) mittig, beides nur so weit
     * verkleinert, wie die Flaeche verlangt (W 544 reicht fuer ein Panel in voller Groesse); K·N (iPhone hoch): Panel als Blatt von unten
     * (mittig, am unteren Rand, Klasse p-sheet); sonst wie stage(). place(ov) setzt die
     * Lage am Overlay-Element und merkt sie (ov._st); stageFor(ov) liefert sie fuer Zeiger und Wischen. */
    frameFor: function (ov) {
      var el = ov && ov.el, kids = el && el.children || [], i, c, cl, k;
      for (i = 0; i < kids.length; i++) {
        c = kids[i]; cl = ' ' + (c.className || '') + ' ';
        if (cl.indexOf(' panel ') >= 0 && cl.indexOf(' pfull ') < 0) {
          if (S.cls.w === 'K' && S.cls.h === 'N') {     // iPhone hoch: Blatt von unten (Panel mittig, volle Hoehe 720 am unteren Rand)
            var pw = c.offsetWidth || 440;
            k = Math.min(1, S.w / pw);
            return { x: S.w / 2 - (c.offsetLeft + pw / 2) * k, y: S.h - BH * k, k: k, sheet: true };
          }
          k = Math.min(1, S.h / BH, S.w / Math.max(1, c.offsetWidth || 440));
          return { x: S.w - BW * k, y: (S.h - BH * k) / 2, k: k };
        }
        if ((cl.indexOf(' dlg ') >= 0 || cl.indexOf(' pdlg ') >= 0) && c.offsetWidth > 0) {
          var bx = c.offsetLeft, by = c.offsetTop, bw = c.offsetWidth, bh = c.offsetHeight;
          k = Math.min(1, (S.w - 32) / bw, (S.h - 32) / bh);
          return { x: S.w / 2 - (bx + bw / 2) * k, y: S.h / 2 - (by + bh / 2) * k, k: k };
        }
      }
      return S.stage();
    },
    place: function (ov) {
      if (!S.flex || !ov || !ov.el || !ov.el.style) return null;
      var g = ov._st = S.frameFor(ov), st = ov.el.style, t = 'translate(' + g.x + 'px,' + g.y + 'px) scale(' + g.k + ')';
      var cn = String(ov.el.className || '').replace(/(^|\s)p-sheet(?=\s|$)/g, '');
      ov.el.className = g.sheet ? cn + ' p-sheet' : cn;   // Blatt von unten: eigene Abdeckung (flex.css)
      st.width = BW + 'px'; st.height = BH + 'px';
      st.webkitTransformOrigin = st.transformOrigin = '0 0';
      st.webkitTransform = st.transform = t;
      return g;
    },
    stageFor: function (ov) { return ov && ov._st || S.stage(); },
    /* Flaechen-Punkt -> Kasten-Punkt und zurueck (TV: unveraendert) */
    toStage: function (x, y) { var g = S.stage(); return { x: (x - g.x) / g.k, y: (y - g.y) / g.k }; },
    fromStage: function (x, y) { var g = S.stage(); return { x: g.x + x * g.k, y: g.y + y * g.k }; }
  };
  N.screen = S;
})(N);
