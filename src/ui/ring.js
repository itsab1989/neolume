/* N.ui.Ring – EIN sichtbarer Fokus-Ring je Bildschirm (SPEC 5.1): translate3d(x-8, y-8) scale(1.08).
 * TV-Test 28.10. (Entdecken, 9,8,2): beim ersten Zeigen nach hide() (z. B. von "Letzte Suchen" ▼ in eine Reihe) las to()
 * offsetWidth, um "ohne Uebergang springen" festzuschreiben – das erzwang Stil + Layout der ganzen Seite im Tastenschritt
 * (ring 19 ms von 53 ms). Jetzt ohne Lesen: Uebergang aus, Ziel setzen, zwei Frames spaeter (der Stil ist dann sicher gerechnet)
 * den Uebergang wieder an. to() liest nie Layout-Werte – nur Klasse/Transform/visibility schreiben.
 * Runde 7 (TV 29.10., 9,8,0: die langen Tastenframes der Startseite tragen {ring}): bisher wechselte EIN Element per Klasse
 * Breite/Hoehe (Querformat 304x178 <-> Poster 192x280) – Layout + neue Ebenen-Textur + Neumalen im Tastenschritt. Jetzt ein
 * eigenes Ring-Element je Form (beim ersten Gebrauch angelegt, danach dauerhaft): Formwechsel = alte Form Deckkraft 0 (Klasse
 * fr-off, Ebene + Inhalt bleiben), neue Form Deckkraft 1. Ruhende Formen laufen ohne Uebergang an dieselbe Stelle mit, damit die
 * neue Form wie bisher von der letzten Ringlage aus gleitet (gleiche Bewegung wie der alte Formwechsel).
 * Runde 8 (TV 29.10., 9,8,0/9,8,2: Formwechsel weiter 55–119 ms fast ohne JS, {ring}): Deckkraft 0 bzw. visibility:hidden AM Ring
 * selbst (Ebene MIT eigenem Inhalt) laesst WebKit offenbar die gemalten Inhalte fallen – Zeigen = Neumalen wie die alte
 * Groessenaenderung (gleiches Bild bei der Feinauswahl: Schliessen per Deckkraft 0 an Ebenen mit Inhalt blieb lang). Was am TV
 * nachweislich billig ist: Deckkraft 0 an einer Ebene OHNE eigenen Inhalt, deren Kinder eigene Ebenen sind (.rclip, Runde 4:
 * ▲ seither unauffaellig). Deshalb steckt jede Form in einer eigenen leeren Huelle (.frw, dauerhafte Ebene, Groesse 0);
 * Formwechsel UND hide()/Zeigen schalten nur die Deckkraft der Huelle (.frw.off) – der Ring selbst bleibt immer sichtbar
 * gemalt, seine Ebene wird nie verworfen, vergroessert oder neu gemalt. Bild und Bewegung unveraendert. */
(function (N) {
  var U = N.util;
  function Ring(parent) {
    this.parent = parent; this.els = {}; this.wr = {}; this.list = [];
    this.shape = 'land'; this.on = false; this.x = -1; this.y = -1; this.t = ''; this.g = 0; this.gen = 0;
    this.el = this._mk('land');                     // erste Form; alle Huellen starten verborgen (.off) bis to()
  }
  Ring.prototype._mk = function (shape) {
    var w = U.el('div', 'frw off', this.parent), el = U.el('div', 'focus-ring fr-' + shape, w);   // Huelle Deckkraft 0, Ring gemalt
    if (this.t) U.tf(el, this.x - 8, this.y - 8, this.t === ' ' ? '' : this.t);   // gleich an die letzte Ringlage
    this.els[shape] = el; this.wr[shape] = w; this.list.push(el); return el;
  };
  /* Formen vorab anlegen (in Ruhe, damit der erste Formwechsel keine Ebene anlegen muss) */
  Ring.prototype.prep = function (shapes) { for (var i = 0; i < shapes.length; i++) if (!this.els[shapes[i]]) this._mk(shapes[i]); };
  /* x, y = linke obere Ecke der UNSKALIERTEN Karte (bzw. des Avatars) in Bildschirmkoordinaten */
  /* noScale: Listenzeilen (Bibliothek "Liste") wachsen beim Fokus nicht */
  Ring.prototype.to = function (shape, x, y, noScale) {
    var el = this.els[shape] || this._mk(shape), old = this.el, wasOff = !this.on, sc = noScale ? '' : N.fx.scale(1.08), i;
    if (el !== old) {
      if (!wasOff) U.cls(this.wr[this.shape], 'off', true);   // alte Form: Huelle Deckkraft 0, Ring laeuft ohne Uebergang still mit
      if (this.g) el.style.webkitTransition = 'none';            // Sprung nach dem Zeigen noch nicht festgeschrieben: auch die neue Form springt
      this.el = el; this.shape = shape;
    }
    if (wasOff) el.style.webkitTransition = 'none'; else if (!this.g) N.fx.move(el);   // g: Sprung noch nicht festgeschrieben
    if (x !== this.x || y !== this.y || wasOff || (sc || ' ') !== this.t) {
      for (i = 0; i < this.list.length; i++) U.tf(this.list[i], x - 8, y - 8, sc);   // ruhende Formen: .frw.off = ohne Uebergang
      this.x = x; this.y = y; this.t = sc || ' ';
    }
    U.cls(this.wr[shape], 'off', false);
    if (wasOff) {
      this.on = true;
      var self = this, g = this.g = ++this.gen;
      U.raf(function () { U.raf(function () {   // Frame 1 zeichnet den Sprung ohne Uebergang, ab Frame 2 gleitet der Ring wieder
        if (g !== self.g) return;
        self.g = 0;
        for (var j = 0; j < self.list.length; j++) if (self.list[j].style.webkitTransition === 'none') self.list[j].style.webkitTransition = '';
        if (N.fx.isFast()) N.fx.move(self.el);    // Taste wird gehalten: wie alle bewegten Elemente ohne Uebergang bis zur Ruhe
      }); });
    }
  };
  /* Verbergen = Huelle Deckkraft 0 (Runde 8: kein visibility – der Ring behaelt Ebene und gemalten Inhalt) */
  Ring.prototype.hide = function () { if (this.on) { U.cls(this.wr[this.shape], 'off', true); this.on = false; } };
  N.ui.Ring = Ring;
})(N);
