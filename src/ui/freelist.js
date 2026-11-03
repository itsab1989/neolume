/* N.ui.freeList – freies senkrechtes Scrollen einer Liste unter Finger/Trackpad (caps.scroll 'free'; Apple Nr. 12/18, SPEC NAV-20).
 * EINE gemeinsame Hilfe fuer alle Listen ausserhalb von Startseite/Mediathek/Karte: Einstellungen, "Startseite/Seitenleiste/
 * Inspiration anpassen" (N.rowsEditor), Auswahl-Panels (N.ui.panel.select – auch alle Anfragen-Listen), "Sortieren & Filter"
 * (N.ui.tabPanel) und "Ton & Untertitel" (N.ui.tracks).
 * Die Liste bleibt EIN Container mit translate3d (wie mit Tasten). Waehrend des Zugs folgt er 1:1 dem Finger, danach Schwung,
 * Gummiband an den Enden und Rueckfeder aus N.kinetic – kein Einrasten (Nr. 18). Der Fokus bleibt, wo er ist (Wischen ist kein
 * Fokus-Schritt); ein Tipp trifft die Zeile unter dem Finger auch zwischen zwei Rasterlagen (idx). Ein Tipp in den laufenden
 * Schwung haelt ihn nur an (down/eat). Rad/Trackpad (Mac) verschiebt direkt (wheel). Die erste Taste danach rastet wieder auf
 * ganze Zeilen ein (keys: der Aufrufer setzt seine Tasten-Lage neu).
 * Am TV (caps.scroll 'focus', kein N.kinetic) nimmt pan()/wheel() nie etwas an und free bleibt false: Tasten- und Zeigerweg
 * unveraendert (keine Ebenen, kein Stil, keine Zeitgeber).
 * o: {el (Listen-Container), hit(x, y) -> bool (Zug/Rad ueber der Liste; Koordinaten des Aufrufers), max() -> groesste Lage (px),
 *     dim (sichtbare Hoehe in px, Zahl oder Funktion; Mass des Gummibands), onSet(px) (optional, z. B. Mehr-Hinweis),
 *     set(px) (optional: setzt die Lage selbst statt EINES translate3d an el, z. B. Album: Seite + Titelliste)} */
(function (N) {
  var U = N.util;
  function avail() { return !!(N.kinetic && N.platform && N.platform.caps && N.platform.caps.scroll === 'free'); }
  function FreeList(o) { this.o = o; this.px = 0; this.free = false; this.kin = null; this.gen = 0; this.anim = false; this.drag = null; this.eatC = false; }
  var F = FreeList.prototype;
  F.dim = function () { var d = this.o.dim; d = typeof d === 'function' ? d() : d; return d > 0 ? d : 400; };
  F.max = function () { return Math.max(0, this.o.max() || 0); };
  /* Lage setzen: Bruchteil-px (Feder/Ausklingen ohne Treppenstufen), Uebergang aus, solange frei */
  F.set = function (p) {
    var el = this.o.el;
    this.px = p;
    if (this.free && el.style.webkitTransition !== 'none') el.style.webkitTransition = 'none';
    if (this.o.set) this.o.set(p); else U.tf(el, 0, -Math.round(p * 100) / 100);
    if (this.o.onSet) this.o.onSet(p);
    if (this.free && N.pointer && N.pointer.follow) N.pointer.follow();   // Nr. 29: Zeile unter dem stehenden Zeiger neu bestimmen
  };
  F._loose = function () { this.free = true; this.o.el.style.webkitTransition = 'none'; };
  /* Bewegung anhalten; true = lief gerade (Schwung/Rueckfeder) */
  F.stop = function () { var m = this.anim; this.gen++; this.anim = false; if (this.kin) this.kin.stop(); return m; };
  /* Ruhe: bleibt, wo es ausgelaufen ist (innerhalb der Grenzen), kein Rasten */
  F.settle = function () {
    this.stop();
    var m = this.max(), p = this.px < 0 ? 0 : this.px > m ? m : this.px;
    if (p !== this.px) this.set(p);
  };
  F._run = function () {
    var self = this, g = this.gen;
    this.anim = true;
    U.raf(function (ts) {
      if (g !== self.gen) return;
      var k = self.kin;
      if (k.step(N.kinetic.frameTime(ts, U.now))) self.set(k.pos);   // Frame-Zeitstempel: gleiche Bahn bei 60/120 Hz
      if (k.ph.length) self._run(); else { self.anim = false; self.settle(); }
    });
  };
  /* Zug (N.router.pan -> scr.pan/ov.pan): {phase, axis, x, y (Start), dy (seit Start), t, cancel}. 'start' -> true = angenommen
   * (senkrecht, ueber der Liste, Liste laenger als sichtbar); danach gehoeren move/end dieser Liste. false = nicht genommen. */
  F.pan = function (e) {
    if (e.phase === 'start') {
      this.drag = null; this.eatC = false;
      if (!avail() || e.axis !== 'y' || !this.o.hit(e.x, e.y) || this.max() <= 0) return false;
      this.stop(); this._loose();
      var d = this.dim();
      if (!this.kin) this.kin = new N.kinetic.Scroller({ snap: 0, dim: d });
      this.kin.setMax(this.max(), d); this.kin.pos = this.px; this.kin.grab(e.t);
      this.drag = { dy: 0 };
      return true;
    }
    if (!this.drag) return false;
    var k = this.kin, dd = -((e.dy || 0) - this.drag.dy);   // Finger nach oben -> Inhalt nach oben (Lage waechst)
    this.drag.dy = e.dy || 0;
    if (e.phase === 'move') { k.move(dd, e.t); this.set(k.pos); return true; }
    this.drag = null;                                        // end
    if (e.cancel) { k.dragging = false; k.samples = []; k.release(0, e.t); } else k.up(e.t);
    if (k.ph.length) this._run(); else this.settle();
    return true;
  };
  /* Rad/Trackpad in App-px (N.pointer.wheelPx; das System liefert den Schwung schon mit): direkt verschieben. true = verschoben */
  F.wheel = function (x, y, dy) {
    if (!avail() || !dy || this.max() <= 0 || !this.o.hit(x, y)) return false;
    this.stop(); this._loose();
    var m = this.max(), p = U.clamp(this.px + dy, 0, m);
    if (p !== this.px) this.set(p);
    return true;
  };
  /* An den Anfang (App.scrollTop: Tipp ganz oben / Cmd+Pfeil hoch, Auftrag 02.11. Punkt 3): gleitet in N.kinetic.TOP_MS nach 0.
   * false = steht schon oben bzw. am TV. Eine Beruehrung (down/stop) haelt das Gleiten an wie einen Schwung. */
  F.top = function () {
    if (!avail() || !(this.px > 0.5)) return false;
    this.stop(); this.drag = null; this._loose();
    var self = this, g = this.gen;
    this.anim = true;
    N.kinetic.tween(this.px, 0, function (p) { if (g === self.gen) self.set(p); }, function () { if (g === self.gen) { self.anim = false; self.settle(); } });
    return true;
  };
  /* Zeile unter y, solange frei gescrollt (auch angeschnittene Zeilen); top = Oberkante der sichtbaren Liste, rows = sichtbare
   * Zeilen. -1 ausserhalb */
  F.idx = function (y, top, step, n, rows) {
    if (y < top || y >= top + rows * step) return -1;
    var i = Math.floor((y - top + this.px) / step);
    return i >= 0 && i < n ? i : -1;
  };
  /* Taste nach freiem Scrollen: anhalten, Uebergang wieder an. true = war frei -> der Aufrufer rastet sofort auf seine Tasten-Lage
   * (near(step) = naechste ganze Zeile) und meldet sie mit sync(px) */
  F.keys = function () {
    if (!this.free) return false;
    this.stop(); this.drag = null; this.free = false; this.o.el.style.webkitTransition = '';
    return true;
  };
  F.near = function (step) { return Math.round(this.px / step); };
  F.sync = function (px) { this.px = px; };
  /* Liste neu aufgebaut (anderer Reiter): Lage 0, nicht mehr frei */
  F.reset = function () { this.keys(); this.px = 0; };
  /* Finger/Maus gedrueckt (N.pointer -> pointerDown): laufenden Schwung anhalten; der Klick danach waehlt nichts */
  F.down = function () { if (!this.stop()) return false; this.settle(); this.eatC = true; return true; };
  /* Zeiger-Ereignis verschlucken? (Tipp in den Schwung bzw. der Klick nach down) */
  F.eat = function (kind) {
    if (this.anim) { this.settle(); this.eatC = kind !== 'click'; return true; }
    if (this.eatC) { if (kind === 'click') this.eatC = false; return true; }
    return false;
  };
  N.ui.freeList = function (o) { return new FreeList(o); };
  N.ui.freeList.avail = avail;
})(N);
