/* N.ui.panel – rechtes Auswahl-Panel (SPEC 5.19) und Hilfe-Panel (INFO, SPEC 10.6). Deckend, ohne Animation. */
(function (N) {
  var U = N.util, X = 840, TOP = 112, STEP = 72, H = 64;
  /* select: o {title, entries:[{id, t, s (Unterzeile, optional), img (URL, nur mit images), sw (Farbfeld .sw-<sw>, optional)}], selected, focus (Index, optional),
   * images (Bild-Spalte statt Haken), onSelect(id), onCancel()}.
   * multi: Mehrfachauswahl (Haken je Eintrag, entries[i].on); OK schaltet um und das Panel bleibt offen, RETURN schliesst ->
   * onDone([ids mit Haken]) (z. B. Bibliotheken des Bildschirmschoners).
   * Mehr als 8 Eintraege: Liste scrollt per translate3d (Anker 4. Zeile); Zeiger scrollt nicht unter dem Punkt weg. */
  var VIS = 8;
  function select(o) {
    var ov = { el: U.el('div', 'layer'), items: [], f: 0, closed: false, off: 0 };
    U.el('div', 'dim', ov.el);                       // Hintergrund leicht abdunkeln: zeigt, was gerade im Fokus ist
    var p = U.el('div', 'panel', ov.el);
    U.txt('div', 'pt t-h2', p, o.title);
    var clip = U.el('div', 'tp-clip', p, 'top:' + TOP + 'px;height:' + (VIS * STEP) + 'px'), list = U.el('div', 'tp-list', clip);
    for (var i = 0; i < o.entries.length; i++) {
      var d = o.entries[i], e = U.el('div', 'pe' + ((o.multi ? d.on : d.id === o.selected) ? ' sel' : '') + (d.s ? ' two' : '') + (o.images ? ' im' : '') + (d.sw ? ' has-sw' : ''), list, 'top:' + (i * STEP) + 'px');
      if (d.sw) U.el('span', 'sw sw-' + d.sw, e);
      if (o.images) {                                 // Bild statt Haken (Kapitelbilder, 96 x 54), sichtbare zuerst laden
        var im = U.el('img', '', e); im.src = N.img.BLANK;
        if (d.img) N.img.want(im, d.img, i < VIS ? 0 : 2);
      } else N.ui.icon(e, 'confirm');
      U.txt('div', 'lb', e, d.t);
      if (d.s) U.txt('div', 'sb', e, d.s);
      ov.items.push(e);
      if (!o.multi && d.id === o.selected) ov.f = i;
    }
    if (o.focus >= 0 && o.focus < ov.items.length) ov.f = o.focus;
    function setF(i, still) {
      U.cls(ov.items[ov.f], 'is-focus', false); ov.f = i; U.cls(ov.items[i], 'is-focus', true);
      if (!still) { var off = Math.max(0, Math.min(i - 3, ov.items.length - VIS)); if (off !== ov.off) { ov.off = off; U.tf(list, 0, -off * STEP); } }
    }
    function close() { if (!ov.closed) { ov.closed = true; N.router.closeOverlay(ov); } }
    function pick(i) {
      if (o.multi) { var d = o.entries[i]; d.on = !d.on; U.cls(ov.items[i], 'sel', d.on); return; }   // Haken umschalten, Panel bleibt
      close(); if (o.onSelect) o.onSelect(o.entries[i].id);
    }
    function picked() { var r = []; for (var j = 0; j < o.entries.length; j++) if (o.entries[j].on) r.push(o.entries[j].id); return r; }
    ov.cancel = function () { close(); if (o.multi && o.onDone) o.onDone(picked()); else if (o.onCancel) o.onCancel(); };
    ov.hints = function () { return o.multi ? [{ k: 'ENTER', t: 'hint.toggle' }, { k: 'ret', t: 'hint.done' }] : [{ k: 'ret', t: o.onCancel ? 'hint.back' : 'hint.cancel' }]; };
    ov.onKey = function (k) {
      var n = N.nav.list(ov.f, ov.items.length, k, true);
      if (n >= 0) { setF(n); return true; }
      if (k === 'ENTER') { pick(ov.f); return true; }
      if (o.keys && o.keys[k]) { close(); o.keys[k](); return true; }
      if (o.multi && k === 'RETURN') { ov.cancel(); return true; }
      return k !== 'RETURN';
    };
    ov.wheelKeys = ['UP', 'DOWN'];
    ov.pointer = function (x, y, kind) {
      if (x < X) { if (kind === 'click') ov.cancel(); return true; }
      if (x < X + 24 || x >= X + 416) return false;
      var i = N.hit.list(TOP, STEP, H, Math.min(VIS, ov.items.length - ov.off), y);
      if (i < 0) return false;
      i += ov.off;
      if (i !== ov.f) setF(i, true);
      if (kind === 'click') pick(i);
      return true;
    };
    U.cls(ov.items[ov.f], 'is-focus', true); setF(ov.f);
    N.router.openOverlay(ov);
    return ov;
  }
  /* help: Titel + Text (max. 600 Zeichen). RETURN/INFO schliesst */
  function help(title, text) {
    var ov = { el: U.el('div', 'layer'), closed: false };
    U.el('div', 'dim', ov.el);                       // Hintergrund leicht abdunkeln: zeigt, was gerade im Fokus ist
    var p = U.el('div', 'panel', ov.el);
    U.txt('div', 'pt t-h2', p, title);
    U.txt('div', 'px', p, text);
    function close() { if (!ov.closed) { ov.closed = true; N.router.closeOverlay(ov); } }
    ov.cancel = close;
    ov.hints = function () { return [{ k: 'ret', t: 'hint.back' }]; };
    ov.onKey = function (k) { if (k === 'INFO' || k === 'ENTER') { close(); return true; } return k !== 'RETURN'; };
    ov.pointer = function (x, y, kind) { if (kind === 'click') close(); return true; };
    N.router.openOverlay(ov);
    return ov;
  }
  N.ui.panel = { select: select, help: help };
})(N);
