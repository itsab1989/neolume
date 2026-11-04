/* N.ui.StateBlock – Leer-/Fehlerzustand innerhalb eines Bildschirms (SPEC 9, Texte 10.5):
 * Icon, Titel, Erklaerung (max. 3 Zeilen), Buttons (Hauptaktion links, "Zurueck" rechts; fokussiert: o.focus, sonst der erste).
 * Nie ein leerer Bildschirm. */
(function (N) {
  var U = N.util;
  function SB(parent) {
    this.el = U.el('div', 'stb', parent, 'display:none');
    U.el('div', 'big', this.el);
    this.ti = U.txt('div', 'st t-h1', this.el, '');
    this.tx = U.txt('div', 'sx t-body c2', this.el, '');
    this.bar = U.el('div', 'sb', this.el);
    this.btns = []; this.ids = []; this.f = 0; this.on = false; this.onSelect = null; this.g = null; this.L = null;
    for (var i = 0; i < 2; i++) {
      var b = U.el('div', 'btn inl', this.bar, 'display:none');
      b.appendChild(document.createTextNode(''));
      this.btns.push(b);
    }
  }
  /* o: {title, text, buttons:[{id, t}], focus, onSelect(id)} */
  SB.prototype.show = function (o) {
    U.setText(this.ti, o.title); U.setText(this.tx, o.text);
    this.ids = []; this.onSelect = o.onSelect || null;
    for (var i = 0; i < 2; i++) {
      var d = o.buttons && o.buttons[i], b = this.btns[i];
      U.show(b, !!d);
      if (d) { U.setText(b.firstChild, d.t); this.ids.push(d.id); }
      U.cls(b, 'is-focus', false);
    }
    this.f = o.focus > 0 && o.focus < this.ids.length ? o.focus : 0;
    if (this.ids.length) U.cls(this.btns[this.f], 'is-focus', true);
    U.show(this.el, true); this.on = true;
    /* flexible Ansicht schmaler als der TV-Block (Inhaltskante 144 + 800, z. B. iPhone hoch; Befund 03.11.: Text lief rechts hinaus):
     * selbst einpassen – ab der Inhaltskante bis 24 vor dem rechten Rand, Texte umbrechen, Knoepfe ggf. untereinander. TV nie. */
    if (!this.g && N.screen && N.screen.flex && this.el.parentNode && /(^|\s)flex(\s|$)/.test(this.el.parentNode.className || '')) {
      var v = N.screen.view();
      if (v.w < 144 + 800 + 24) this.g = { x: 144, w: v.w - 144 - 24, H: v.h, top: 176, auto: true };
    }
    if (this.g) this.lay();
    N.router.refreshHints();
  };
  /* Schmale Flaeche (nur flexible Plattform, Apple 10-screens.md 7: Anmeldung, Player schmal): Block ab x in Breite w, senkrecht mittig in
   * der Hoehe H; Texte umbrechen in die Breite, Abstaende nach gemessener Hoehe, Knoepfe untereinander, wenn zwei nebeneinander nicht
   * passen (w < 632). g = {x, w, H} oder null (wieder wie am TV). Am TV nie aufgerufen. */
  SB.prototype.fit = function (g) {
    var had = !!this.g;
    this.g = g || null;
    if (this.g) { if (this.on) this.lay(); return; }
    if (!had) return;
    var es = this.el.style, i;
    es.left = es.top = es.width = '';
    this.ti.parentNode.style.width = this.tx.parentNode.style.width = this.tx.parentNode.style.top = '';
    this.bar.style.top = this.bar.style.width = this.bar.style.height = this.bar.style.whiteSpace = '';
    for (i = 0; i < 2; i++) { var bs = this.btns[i].style; bs.width = bs.marginRight = bs.marginBottom = ''; }
    this.L = null;
  };
  SB.prototype.lay = function () {
    var g = this.g, es = this.el.style, tiE = this.ti.parentNode, txE = this.tx.parentNode, n = this.ids.length, i;
    var stack = n > 1 && g.w < 632, bw = stack ? Math.min(g.w, 400) : 300;
    es.left = g.x + 'px'; es.width = g.w + 'px';
    tiE.style.width = txE.style.width = g.w + 'px';
    var txY = 88 + Math.max(52, (tiE.offsetHeight || 0) + 4), barY = txY + Math.max(48, txE.offsetHeight || 0) + 36;   // TV: Text 140, Knoepfe 240
    txE.style.top = txY + 'px';
    var bs = this.bar.style; bs.top = barY + 'px'; bs.width = g.w + 'px'; bs.height = (stack ? n * 64 - 16 : 48) + 'px'; bs.whiteSpace = stack ? 'normal' : '';
    for (i = 0; i < 2; i++) { var b = this.btns[i].style; b.width = bw + 'px'; b.marginRight = stack ? '0' : ''; b.marginBottom = stack ? '16px' : ''; }
    var h = barY + (stack ? n * 64 - 16 : 48), y = Math.max(g.top || 24, Math.round((g.H - h) / 2));   // g.top: nie ueber den Kopf der Ansicht (selbst eingepasst: TV-Lage 176)
    es.top = y + 'px';
    this.L = { x: g.x, y: y + barY, bw: bw, stack: stack };
  };
  SB.prototype.setText = function (t) { U.setText(this.tx, t); };
  SB.prototype.hide = function () { if (this.on) { U.show(this.el, false); this.on = false; N.router.refreshHints(); } };
  SB.prototype.setF = function (i) { U.cls(this.btns[this.f], 'is-focus', false); this.f = i; U.cls(this.btns[i], 'is-focus', true); };
  SB.prototype.onKey = function (k) {
    if (!this.on || !this.ids.length) return false;
    var n = N.nav.list(this.f, this.ids.length, k, false);
    if (n < 0 && this.L && this.L.stack) n = N.nav.list(this.f, this.ids.length, k, true);   // Knoepfe untereinander: auch ▲▼
    if (n >= 0) { this.setF(n); return true; }
    if (k === 'ENTER') { if (this.onSelect) this.onSelect(this.ids[this.f]); return true; }
    return false;
  };
  /* Zeiger: Buttons liegen bei y = 176+240, Breite unbekannt -> grob 300 px je Button (einmalige Messung nicht noetig) */
  SB.prototype.pointer = function (x, y, kind) {
    if (!this.on || !this.ids.length) return false;
    var L = this.L, i;
    if (L && L.stack) { i = x >= L.x && x < L.x + L.bw && y >= L.y ? Math.floor((y - L.y) / 64) : -1; if (i >= this.ids.length || (y - L.y) % 64 >= 48) i = -1; }
    else if (L) { i = N.hit.list(L.x, 316, 300, this.ids.length, x); if (y < L.y || y >= L.y + 48) i = -1; }
    else { i = N.hit.list(144, 316, 300, this.ids.length, x); if (y < 416 || y >= 464) i = -1; }
    if (i < 0) return false;
    if (i !== this.f) this.setF(i);
    if (kind === 'click' && this.onSelect) this.onSelect(this.ids[i]);
    return true;
  };
  N.ui.StateBlock = SB;
})(N);
