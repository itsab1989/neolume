/* N.screen – logische App-Flaeche (docs/research/apple/08-touch.md 8, Regel 8b "kurze Kante fest").
 * Fernseher (caps.screen.flex aus, Standard): immer 1280x720, nichts aendert sich – alle Rechnungen liefern die festen Werte.
 * Flexible Plattform (Apple: iPad 4:3, iPhone quer, Mac-Fenster): W x H (>= Mindestflaeche) aus N.platform.screen.size(); die Plattform
 * meldet Groessenwechsel als N.evt 'screen:changed' (entprellt), N.screen gibt sie als 'screen:resized' {w, h} weiter.
 * Ansichten, die schon mit W x H rechnen, setzen scr.flex = true (Startseite, Mediathek, Einstellungen); alle anderen stehen in
 * einem mittigen 1280x720-Kasten (Klasse stage720 am Bildschirm, N.router), Overlays ebenso. off() = Lage dieses Kastens.
 * Hoch- und Querformat (00-entscheidungen Nr. 16): die Untergrenze kommt aus caps.screen.w/h (heute Apple 1280x720 = nur
 * Querformat); eine Plattform mit Hochformat meldet dort eine schmalere Mindestbreite – keine Kernstelle hier nimmt W >= 1280 an.
 * Ansichten fragen W x H immer ueber area() ab (nie N.screen.w direkt), damit eine Hochformat-Regel nur hier dazukommt. */
(function (N) {
  var BW = 1280, BH = 720;
  var S = {
    BW: BW, BH: BH, w: BW, h: BH, flex: false,
    /* einmal in App.start (nach N.platform.init): Faehigkeit lesen, Startgroesse holen, Wechsel abonnieren */
    init: function () {
      var P = N.platform, c = P && P.caps && P.caps.screen;
      S.flex = !!(c && c.flex === true && P.screen && typeof P.screen.size === 'function');
      S.w = BW; S.h = BH; S.minW = BW; S.minH = BH;
      if (S.flex && c.w > 0 && c.h > 0) { S.minW = c.w; S.minH = c.h; }
      if (!S.flex) return;
      S.read();
      N.evt.off('screen:changed', S.changed);
      N.evt.on('screen:changed', S.changed);
    },
    /* Groesse der Plattform uebernehmen (nie kleiner als minW x minH, gerade Zahlen: Kasten-Versatz ganzzahlig) -> geaendert? */
    read: function (sz) {
      if (!S.flex) return false;
      sz = sz || N.platform.screen.size() || {};
      var w = S.clampW(sz.w), h = S.clampH(sz.h), ch = w !== S.w || h !== S.h;
      S.w = w; S.h = h;
      return ch;
    },
    minW: BW, minH: BH,
    clampW: function (v) { v = Math.round(Number(v) || 0); v += v % 2; return v > S.minW ? v : S.minW; },
    clampH: function (v) { v = Math.round(Number(v) || 0); v += v % 2; return v > S.minH ? v : S.minH; },
    changed: function (sz) { if (S.read(sz)) N.evt.emit('screen:resized', { w: S.w, h: S.h }); },
    /* Flaeche einer Ansicht: flexibel -> W x H, sonst (oder am TV) 1280x720 */
    area: function (flexView) { return S.flex && flexView ? { w: S.w, h: S.h } : { w: BW, h: BH }; },
    /* Lage des mittigen 1280x720-Kastens (stage720) in der Flaeche; am TV 0/0 */
    off: function () { return S.flex ? { x: (S.w - BW) / 2, y: (S.h - BH) / 2 } : { x: 0, y: 0 }; }   // Hochformat: x < 0 (Kasten breiter)
  };
  N.screen = S;
})(N);
