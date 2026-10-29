/* N.ui.tabPanel – rechtes Auswahl-Panel mit Reitern (SPEC 5.19; Bibliothek "Sortieren & Filter", 7.5): ◀▶ wechselt den Reiter,
 * ▲▼ den Eintrag, OK ruft onPick(tab, id) – liefert onPick true, bleibt das Panel offen und wird neu gezeichnet (z. B. Richtung
 * umdrehen). RETURN schliesst. Mehr als 7 Eintraege: Liste scrollt per translate3d. Ohne Animation, deckend.
 * TV-Befund 1.0.5 ("Ansicht" in Sortieren & Filter liess sich nicht zuverlaessig waehlen): die Reiter stehen nach Textbreite,
 * der Zeiger traf aber feste 152-px-Felder (Klick auf "Ansicht" landete meist auf "Filter"), und per Taste war die Reiterzeile
 * nicht erreichbar (nur ◀▶ ohne sichtbaren Fokus). Jetzt: Treffer ueber die einmal gemessenen Reiter-Rechtecke; ▲ auf dem
 * ersten Eintrag fokussiert die Reiterzeile (◀▶ wechselt, ▼/OK zurueck in die Liste); Zeigen auf einen Reiter waehlt ihn
 * (wie die Staffel-Reiter, DET-3).
 * o: {title, tabs:[{t, entries: function () -> [{id, t, s, sel}]}], tab, onPick(tab, id), keys:{TASTE: fn}} */
(function (N) {
  var U = N.util, X = 840, TOP = 160, STEP = 72, H = 64, VIS = 7, TAB_X = X + 32, TAB_Y = 112, TAB_H = 43;
  /* Tastenlogik (rein, getestet): st {zone:'list'|'tabs', tab, n (Reiter), f, m (Eintraege)} -> neuer Zustand
   * {zone, tab, f, pick} oder null (Taste nicht behandelt). ◀▶ wechselt den Reiter in beiden Zonen. */
  function step(st, k) {
    var o = { zone: st.zone, tab: st.tab, f: st.f, pick: false };
    if (k === 'LEFT' || k === 'RIGHT') { var t = st.tab + (k === 'LEFT' ? -1 : 1); if (t >= 0 && t < st.n) o.tab = t; return o; }
    if (st.zone === 'tabs') {
      if (k === 'DOWN' || k === 'ENTER') { if (st.m) o.zone = 'list'; return o; }
      return k === 'UP' ? o : null;
    }
    if (k === 'UP' && st.f === 0) { o.zone = 'tabs'; return o; }
    var n = N.nav.list(st.f, st.m, k, true);
    if (n >= 0) { o.f = n; return o; }
    if (k === 'ENTER') { o.pick = true; return o; }
    return null;
  }
  function open(o) {
    var ov = { el: U.el('div', 'layer'), closed: false, tab: o.tab || 0, f: 0, items: [], data: [], off: 0, zone: 'list', rects: null };
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
      for (var i = 0; i < ov.data.length; i++) {
        var d = ov.data[i], e = U.el('div', 'pe' + (d.sel ? ' sel' : '') + (d.s ? ' two' : ''), list, 'top:' + (i * STEP) + 'px');
        N.ui.icon(e, 'confirm');
        U.txt('div', 'lb', e, d.t);
        if (d.s) U.txt('div', 'sb', e, d.s);
        ov.items.push(e);
        if (d.sel && f < 0) ov.f = i;
      }
      if (f >= 0) ov.f = Math.min(f, ov.items.length - 1);
      if (!ov.items.length) ov.zone = 'tabs';
      paintTabs();
      setF(ov.f, true);
    }
    /* aktueller Reiter unterstrichen; mit Fokus auf der Reiterzeile zusaetzlich Akzentflaeche (eine Fokussprache, PRIN-4) */
    function paintTabs() {
      for (var k = 0; k < tabs.length; k++) { U.cls(tabs[k], 'is-cur', k === ov.tab); U.cls(tabs[k], 'is-focus', ov.zone === 'tabs' && k === ov.tab); }
    }
    function setZone(z) {
      if (z === ov.zone) return;
      ov.zone = z;
      if (ov.items[ov.f]) U.cls(ov.items[ov.f], 'is-focus', z === 'list');
      paintTabs();
    }
    /* Reiter-Rechtecke einmal messen (nach dem Aufbau, nie im Tastenpfad) */
    function measure() {
      if (ov.closed) return;
      ov.rects = [];
      for (var k = 0; k < tabs.length; k++) ov.rects.push([TAB_X + tabs[k].offsetLeft, tabs[k].offsetWidth]);
    }
    function setF(i, force, still) {
      if (!ov.items.length) return;
      if (!force) U.cls(ov.items[ov.f], 'is-focus', false);
      ov.f = i; U.cls(ov.items[i], 'is-focus', ov.zone === 'list');
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
      var st = step({ zone: ov.zone, tab: ov.tab, n: tabs.length, f: ov.f, m: ov.items.length }, k);
      if (st) {
        if (st.tab !== ov.tab) tab(st.tab);
        else if (st.f !== ov.f) setF(st.f);
        setZone(st.zone);
        if (st.pick) pick(ov.f);
        return true;
      }
      if (o.keys && o.keys[k]) { close(); o.keys[k](); return true; }
      return k !== 'RETURN';
    };
    ov.wheelKeys = ['UP', 'DOWN'];
    ov.pointer = function (x, y, kind) {
      if (x < X) { if (kind === 'click') close(); return true; }
      if (y >= TAB_Y && y < TAB_Y + TAB_H) {
        var t = ov.rects ? N.hit.spans(ov.rects, x) : -1;
        if (t < 0) return false;
        setZone('tabs'); tab(t);                         // Zeigen waehlt den Reiter (die Liste darunter wechselt, nichts rollt)
        return true;
      }
      var i = N.hit.list(TOP, STEP, H, Math.min(VIS, ov.items.length - ov.off), y);
      if (i < 0) return false;
      i += ov.off;
      setZone('list');
      if (i !== ov.f) setF(i, false, true);
      if (kind === 'click') pick(i);
      return true;
    };
    render();
    N.router.openOverlay(ov);
    setTimeout(measure, 50);                           // einmalige Messung fuer den Zeiger (Reiter nach Textbreite)
    return ov;
  }
  N.ui.tabPanel = { open: open, step: step };
})(N);
