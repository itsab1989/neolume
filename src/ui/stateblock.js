/* N.ui.StateBlock – Leer-/Fehlerzustand innerhalb eines Bildschirms (SPEC 9, Texte 10.5):
 * Icon, Titel, Erklaerung (max. 3 Zeilen), Buttons (erster fokussiert). Nie ein leerer Bildschirm. */
(function (N) {
  var U = N.util;
  function SB(parent) {
    this.el = U.el('div', 'stb', parent, 'display:none');
    U.el('div', 'big', this.el);
    this.ti = U.txt('div', 'st t-h1', this.el, '');
    this.tx = U.txt('div', 'sx t-body c2', this.el, '');
    this.bar = U.el('div', 'sb', this.el);
    this.btns = []; this.ids = []; this.f = 0; this.on = false; this.onSelect = null;
    for (var i = 0; i < 2; i++) {
      var b = U.el('div', 'btn inl', this.bar, 'display:none');
      b.appendChild(document.createTextNode(''));
      this.btns.push(b);
    }
  }
  /* o: {title, text, buttons:[{id, t}], onSelect(id)} */
  SB.prototype.show = function (o) {
    U.setText(this.ti, o.title); U.setText(this.tx, o.text);
    this.ids = []; this.onSelect = o.onSelect || null;
    for (var i = 0; i < 2; i++) {
      var d = o.buttons && o.buttons[i], b = this.btns[i];
      U.show(b, !!d);
      if (d) { U.setText(b.firstChild, d.t); this.ids.push(d.id); }
      U.cls(b, 'is-focus', false);
    }
    this.f = 0;
    if (this.ids.length) U.cls(this.btns[0], 'is-focus', true);
    U.show(this.el, true); this.on = true;
    N.router.refreshHints();
  };
  SB.prototype.setText = function (t) { U.setText(this.tx, t); };
  SB.prototype.hide = function () { if (this.on) { U.show(this.el, false); this.on = false; N.router.refreshHints(); } };
  SB.prototype.setF = function (i) { U.cls(this.btns[this.f], 'is-focus', false); this.f = i; U.cls(this.btns[i], 'is-focus', true); };
  SB.prototype.onKey = function (k) {
    if (!this.on || !this.ids.length) return false;
    var n = N.nav.list(this.f, this.ids.length, k, false);
    if (n >= 0) { this.setF(n); return true; }
    if (k === 'ENTER') { if (this.onSelect) this.onSelect(this.ids[this.f]); return true; }
    return false;
  };
  /* Zeiger: Buttons liegen bei y = 176+240, Breite unbekannt -> grob 300 px je Button (einmalige Messung nicht noetig) */
  SB.prototype.pointer = function (x, y, kind) {
    if (!this.on || !this.ids.length) return false;
    var i = N.hit.list(144, 316, 300, this.ids.length, x);
    if (i < 0 || y < 416 || y >= 464) return false;
    if (i !== this.f) this.setF(i);
    if (kind === 'click' && this.onSelect) this.onSelect(this.ids[i]);
    return true;
  };
  N.ui.StateBlock = SB;
})(N);
