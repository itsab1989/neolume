/* N.ui.dialog – Dialog und Kontextmenue (SPEC 5.13, 7.12): Abdunklung statisch, Box 640 breit, Buttons mit Fuellungsfokus,
 * fokussiert ist immer die sichere Option (Aufrufer setzt focus). RETURN = Abbrechen. Fokus geht danach an den Aufrufer zurueck.
 * Wird nur bei Bedarf erzeugt (nie im Fokusschritt). Zeiger: Button-Rechtecke werden EINMAL nach dem Oeffnen gemessen. */
(function (N) {
  var U = N.util;
  /* o: {title, text, buttons:[{id, t}], focus, vertical, onSelect(id), onCancel(), hints} */
  function open(o) {
    var ov = { el: U.el('div', 'layer'), btns: [], f: o.focus || 0, rects: null, closed: false };
    U.el('div', 'backdrop', ov.el);
    var box = U.el('div', o.vertical ? 'dlg' : 'dlg c', ov.el);   // Bestaetigung (Buttons nebeneinander): kompakt + zentriert
    if (o.top) box.style.top = o.top + 'px';
    if (o.title) U.txt('div', 'dt', box, o.title);
    if (o.text) U.txt('div', 'dx', box, o.text);
    var bar = U.el('div', o.vertical ? 'db v' : 'db', box);
    for (var i = 0; i < o.buttons.length; i++) {
      var b = U.el('div', 'btn ' + (o.vertical ? 'blk' : 'inl'), bar);
      b.appendChild(document.createTextNode(o.buttons[i].t));
      ov.btns.push(b);
    }
    function setF(i) {
      if (i < 0 || i >= ov.btns.length) return;
      if (ov.btns[ov.f]) U.cls(ov.btns[ov.f], 'is-focus', false);
      ov.f = i; U.cls(ov.btns[i], 'is-focus', true);
    }
    function close() { if (ov.closed) return; ov.closed = true; N.router.closeOverlay(ov); }
    function select(i) { var id = o.buttons[i].id; close(); if (o.onSelect) o.onSelect(id); }
    ov.close = close;
    ov.cancel = function () { close(); if (o.onCancel) o.onCancel(); };
    ov.hints = function () { return o.hints || [{ k: 'ret', t: 'hint.cancel' }]; };
    ov.onKey = function (k) {
      var n = N.nav.list(ov.f, ov.btns.length, k, !!o.vertical);
      if (n >= 0) { setF(n); return true; }
      if (k === 'ENTER') { select(ov.f); return true; }
      return k !== 'RETURN';          // alles andere schlucken (modal); RETURN -> Router ruft cancel()
    };
    ov.wheelKeys = o.vertical ? ['UP', 'DOWN'] : ['LEFT', 'RIGHT'];
    ov.pointer = function (x, y, kind) {
      if (!ov.rects) return false;
      for (var i = 0; i < ov.rects.length; i++) {
        var r = ov.rects[i];
        if (N.hit.rect(r[0], r[1], r[2], r[3], x, y)) { if (i !== ov.f) setF(i); if (kind === 'click') select(i); return true; }
      }
      return false;
    };
    setF(ov.f);
    N.router.openOverlay(ov);
    setTimeout(function () {            // einmalige Messung fuer den Zeiger (nicht im Tastenpfad)
      if (ov.closed) return;
      ov.rects = [];
      for (var i = 0; i < ov.btns.length; i++) {
        var b = ov.btns[i], x = 0, y = 0, e = b;
        while (e && e !== ov.el) { x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent; }
        ov.rects.push([x, y, b.offsetWidth, b.offsetHeight]);
      }
    }, 50);
    return ov;
  }
  /* Beenden-Dialog (SPEC 6.2) */
  function exitApp() {
    open({ title: N.t('dlg.exit.title'), text: N.t('dlg.exit.text'),
      buttons: [{ id: 'cancel', t: N.t('dlg.exit.cancel') }, { id: 'exit', t: N.t('dlg.exit.confirm') }], focus: 0,
      onSelect: function (id) { if (id === 'exit') N.app.exit(); } });
  }
  N.ui.dialog = { open: open, exitApp: exitApp };
})(N);
