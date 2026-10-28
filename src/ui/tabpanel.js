/* N.ui.tabPanel – rechtes Auswahl-Panel mit Reitern (SPEC 5.19; Bibliothek "Sortieren & Filter", 7.5): ◀▶ wechselt den Reiter,
 * ▲▼ den Eintrag, OK ruft onPick(tab, id) – liefert onPick true, bleibt das Panel offen und wird neu gezeichnet (z. B. Richtung
 * umdrehen). RETURN schliesst. Mehr als 7 Eintraege: Liste scrollt per translate3d. Ohne Animation, deckend.
 * o: {title, tabs:[{t, entries: function () -> [{id, t, s, sel}]}], tab, onPick(tab, id), keys:{TASTE: fn}} */
(function (N) {
  var U = N.util, X = 840, TOP = 160, STEP = 72, H = 64, VIS = 7;
  function open(o) {
    var ov = { el: U.el('div', 'layer'), closed: false, tab: o.tab || 0, f: 0, items: [], data: [], off: 0 };
    U.el('div', 'dim', ov.el);                       // Hintergrund leicht abdunkeln: zeigt, was gerade im Fokus ist
    var p = U.el('div', 'panel', ov.el), tabs = [];
    U.txt('div', 'pt t-h2', p, o.title);
    var tabRow = U.el('div', 'tp-tabs', p);            // Reiter nebeneinander nach Textbreite (fester Abstand schob "Ansicht" in den Sicherheitsrand)
    for (var t = 0; t < o.tabs.length; t++) {
      var te = U.el('div', 'tp-tab', tabRow);
      te.appendChild(document.createTextNode(o.tabs[t].t));
      tabs.push(te);
    }
    var clip = U.el('div', 'tp-clip', p), list = U.el('div', 'tp-list', clip);
    function render(keepF) {
      while (list.firstChild) list.removeChild(list.firstChild);
      var f = keepF ? ov.f : -1;
      ov.items = []; ov.data = o.tabs[ov.tab].entries(); ov.f = 0;
      for (var k = 0; k < tabs.length; k++) U.cls(tabs[k], 'is-cur', k === ov.tab);
      for (var i = 0; i < ov.data.length; i++) {
        var d = ov.data[i], e = U.el('div', 'pe' + (d.sel ? ' sel' : '') + (d.s ? ' two' : ''), list, 'top:' + (i * STEP) + 'px');
        N.ui.icon(e, 'confirm');
        U.txt('div', 'lb', e, d.t);
        if (d.s) U.txt('div', 'sb', e, d.s);
        ov.items.push(e);
        if (d.sel && f < 0) ov.f = i;
      }
      if (f >= 0) ov.f = Math.min(f, ov.items.length - 1);
      setF(ov.f, true);
    }
    function setF(i, force, still) {
      if (!ov.items.length) return;
      if (!force) U.cls(ov.items[ov.f], 'is-focus', false);
      ov.f = i; U.cls(ov.items[i], 'is-focus', true);
      if (!still) { var off = Math.max(0, Math.min(i - 3, ov.items.length - VIS)); if (off !== ov.off || force) { ov.off = off; U.tf(list, 0, -off * STEP); } }
    }
    function close() { if (!ov.closed) { ov.closed = true; N.router.closeOverlay(ov); } }
    function pick(i) {
      var d = ov.data[i];
      if (!d) return;
      var keep = o.onPick ? o.onPick(ov.tab, d.id, ov) : false;
      if (keep && !ov.closed) render(true); else close();
    }
    function tab(t) { if (t >= 0 && t < tabs.length && t !== ov.tab) { ov.tab = t; render(); } }
    ov.close = close;
    ov.cancel = close;
    ov.hints = function () { return [{ k: 'ret', t: 'hint.cancel' }]; };
    ov.onKey = function (k) {
      if (k === 'LEFT') { tab(ov.tab - 1); return true; }
      if (k === 'RIGHT') { tab(ov.tab + 1); return true; }
      var n = N.nav.list(ov.f, ov.items.length, k, true);
      if (n >= 0) { setF(n); return true; }
      if (k === 'ENTER') { pick(ov.f); return true; }
      if (o.keys && o.keys[k]) { close(); o.keys[k](); return true; }
      return k !== 'RETURN';
    };
    ov.wheelKeys = ['UP', 'DOWN'];
    ov.pointer = function (x, y, kind) {
      if (x < X) { if (kind === 'click') close(); return true; }
      if (y >= 112 && y < 152) { if (kind === 'click') tab(Math.floor((x - X - 32) / 152)); return true; }
      var i = N.hit.list(TOP, STEP, H, Math.min(VIS, ov.items.length - ov.off), y);
      if (i < 0) return false;
      i += ov.off;
      if (i !== ov.f) setF(i, false, true);
      if (kind === 'click') pick(i);
      return true;
    };
    render();
    N.router.openOverlay(ov);
    return ov;
  }
  N.ui.tabPanel = { open: open };
})(N);
