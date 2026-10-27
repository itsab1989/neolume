/* N.ui.Ring – EIN Fokus-Ring je Bildschirm (SPEC 5.1): translate3d(x-8, y-8) scale(1.08), Formwechsel per Klasse. */
(function (N) {
  var U = N.util;
  function Ring(parent) { this.el = U.el('div', 'focus-ring fr-land', parent); this.shape = 'land'; this.on = false; this.x = -1; this.y = -1; }
  /* x, y = linke obere Ecke der UNSKALIERTEN Karte (bzw. des Avatars) in Bildschirmkoordinaten */
  /* noScale: Listenzeilen (Bibliothek "Liste") wachsen beim Fokus nicht */
  Ring.prototype.to = function (shape, x, y, noScale) {
    var el = this.el, wasOff = !this.on;
    if (shape !== this.shape) { el.className = 'focus-ring fr-' + shape; this.shape = shape; }
    if (wasOff) el.style.webkitTransition = 'none'; else N.fx.move(el);
    if (x !== this.x || y !== this.y || wasOff) { U.tf(el, x - 8, y - 8, noScale ? '' : N.fx.scale(1.08)); this.x = x; this.y = y; }
    if (wasOff) {
      el.style.visibility = 'visible'; this.on = true;
      var t = el.offsetWidth;            // Stil festschreiben, damit das Einblenden nicht animiert
      el.style.webkitTransition = t >= 0 ? '' : '';
    }
  };
  Ring.prototype.hide = function () { if (this.on) { this.el.style.visibility = 'hidden'; this.on = false; } };
  N.ui.Ring = Ring;
})(N);
