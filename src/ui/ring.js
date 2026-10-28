/* N.ui.Ring – EIN Fokus-Ring je Bildschirm (SPEC 5.1): translate3d(x-8, y-8) scale(1.08), Formwechsel per Klasse.
 * TV-Test 28.10. (Entdecken, 9,8,2): beim ersten Zeigen nach hide() (z. B. von "Letzte Suchen" ▼ in eine Reihe) las to()
 * offsetWidth, um "ohne Uebergang springen" festzuschreiben – das erzwang Stil + Layout der ganzen Seite im Tastenschritt
 * (ring 19 ms von 53 ms). Jetzt ohne Lesen: Uebergang aus, Ziel setzen, zwei Frames spaeter (der Stil ist dann sicher gerechnet)
 * den Uebergang wieder an. to() liest nie Layout-Werte – nur Klasse/Transform/visibility schreiben. */
(function (N) {
  var U = N.util;
  function Ring(parent) { this.el = U.el('div', 'focus-ring fr-land', parent); this.shape = 'land'; this.on = false; this.x = -1; this.y = -1; this.g = 0; this.gen = 0; }
  /* x, y = linke obere Ecke der UNSKALIERTEN Karte (bzw. des Avatars) in Bildschirmkoordinaten */
  /* noScale: Listenzeilen (Bibliothek "Liste") wachsen beim Fokus nicht */
  Ring.prototype.to = function (shape, x, y, noScale) {
    var el = this.el, wasOff = !this.on;
    if (shape !== this.shape) { el.className = 'focus-ring fr-' + shape; this.shape = shape; }
    if (wasOff) el.style.webkitTransition = 'none'; else if (!this.g) N.fx.move(el);   // g: Sprung noch nicht festgeschrieben
    if (x !== this.x || y !== this.y || wasOff) { U.tf(el, x - 8, y - 8, noScale ? '' : N.fx.scale(1.08)); this.x = x; this.y = y; }
    if (wasOff) {
      el.style.visibility = 'visible'; this.on = true;
      var self = this, g = this.g = ++this.gen;
      U.raf(function () { U.raf(function () {   // Frame 1 zeichnet den Sprung ohne Uebergang, ab Frame 2 gleitet der Ring wieder
        if (g !== self.g) return;
        self.g = 0; el.style.webkitTransition = '';
        if (N.fx.isFast()) N.fx.move(el);         // Taste wird gehalten: wie alle bewegten Elemente ohne Uebergang bis zur Ruhe
      }); });
    }
  };
  Ring.prototype.hide = function () { if (this.on) { this.el.style.visibility = 'hidden'; this.on = false; } };
  N.ui.Ring = Ring;
})(N);
