/* N.ui.tracks – Panel "Ton & Untertitel" mit zwei Reitern (SPEC 5.19, 7.11): ◀▶ wechselt den Reiter, ▲▼ die Spur, OK waehlt
 * und schliesst, RETURN schliesst ohne Aenderung. Grün oeffnet auf "Ton", SUBTITLE auf "Untertitel". Unterzeile mit Klartext
 * (Hoerfilm, fuer Hoergeschaedigte, "wird ins Bild eingefuegt"). Mehr als 7 Eintraege: Liste scrollt per translate3d.
 * o: {tracks:{audio, subs}, tab:'a'|'s', hls, ass, onPick(kind, id)} */
(function (N) {
  var U = N.util, X = 840, TOP = 160, STEP = 72, H = 64, VIS = 7;
  function open(o) {
    var ov = { el: U.el('div', 'layer'), closed: false, tab: o.tab === 's' ? 's' : 'a', f: 0, items: [] };
    U.el('div', 'dim', ov.el);                       // Hintergrund leicht abdunkeln: zeigt, was gerade im Fokus ist
    var p = U.el('div', 'panel', ov.el);
    U.txt('div', 'pt t-h2', p, N.t('pl.tracks'));
    var tabs = [U.el('div', 'tp-tab', p, 'left:32px'), U.el('div', 'tp-tab', p, 'left:184px')];
    tabs[0].appendChild(document.createTextNode(N.t('pl.tab.audio')));
    tabs[1].appendChild(document.createTextNode(N.t('pl.tab.subs')));
    var clip = U.el('div', 'tp-clip', p), list = U.el('div', 'tp-list', clip);
    function entries() {
      var T = o.tracks, out = [], i;
      if (ov.tab === 'a') for (i = 0; i < T.audio.length; i++) out.push({ id: T.audio[i].id, t: T.audio[i].label, s: N.tracks.subline(T.audio[i], false), sel: T.audio[i].sel });
      else {
        var any = false;
        for (i = 0; i < T.subs.length; i++) if (T.subs[i].sel) any = true;
        out.push({ id: 0, t: N.t('pl.track.off'), s: '', sel: !any });
        for (i = 0; i < T.subs.length; i++) {
          var x = T.subs[i], burn = N.tracks.subMode(x, o.ass, o.hls) === 'burn';
          out.push({ id: x.id, t: x.label, s: N.tracks.subline(x, burn), sel: x.sel });
        }
      }
      return out;
    }
    function render() {
      while (list.firstChild) list.removeChild(list.firstChild);
      ov.items = []; ov.data = entries(); ov.f = 0;
      U.cls(tabs[0], 'is-cur', ov.tab === 'a'); U.cls(tabs[1], 'is-cur', ov.tab === 's');
      for (var i = 0; i < ov.data.length; i++) {
        var d = ov.data[i], e = U.el('div', 'pe' + (d.sel ? ' sel' : '') + (d.s ? ' two' : ''), list, 'top:' + (i * STEP) + 'px');
        N.ui.icon(e, 'confirm');
        U.txt('div', 'lb', e, d.t);
        if (d.s) U.txt('div', 'sb', e, d.s);
        ov.items.push(e);
        if (d.sel) ov.f = i;
      }
      setF(ov.f, true);
    }
    function setF(i, force, still) {
      if (!ov.items.length) return;
      if (!force) U.cls(ov.items[ov.f], 'is-focus', false);
      ov.f = i; U.cls(ov.items[i], 'is-focus', true);
      if (!still) { ov.off = Math.max(0, Math.min(i - 3, ov.items.length - VIS)); U.tf(list, 0, -ov.off * STEP); }
    }
    function close() { if (!ov.closed) { ov.closed = true; N.router.closeOverlay(ov); } }
    function pick(i) { var d = ov.data[i]; close(); if (!d.sel && o.onPick) o.onPick(ov.tab, d.id); }
    function tab(t) { if (t !== ov.tab) { ov.tab = t; render(); } }
    ov.cancel = close;
    ov.hints = function () { return [{ k: 'ret', t: 'hint.cancel' }]; };
    ov.onKey = function (k) {
      if (k === 'LEFT') { tab('a'); return true; }
      if (k === 'RIGHT') { tab('s'); return true; }
      var n = N.nav.list(ov.f, ov.items.length, k, true);
      if (n >= 0) { setF(n); return true; }
      if (k === 'ENTER') { pick(ov.f); return true; }
      if (k === 'GREEN' || k === 'TOOLS') { close(); return true; }
      if (k === 'SUBTITLE') { tab('s'); return true; }
      return k !== 'RETURN';
    };
    ov.wheelKeys = ['UP', 'DOWN'];
    ov.pointer = function (x, y, kind) {
      if (x < X) { if (kind === 'click') close(); return true; }
      if (y >= 112 && y < 152) { if (kind === 'click') tab(x < X + 176 ? 'a' : 's'); return true; }
      var off = ov.off || 0, i = N.hit.list(TOP, STEP, H, Math.min(VIS, ov.items.length - off), y);
      if (i < 0) return false;
      i += off;
      if (i !== ov.f) setF(i, false, true);   // Zeiger: Liste scrollt nicht unter dem Punkt weg
      if (kind === 'click') pick(i);
      return true;
    };
    render();
    N.router.openOverlay(ov);
    return ov;
  }
  N.ui.tracks = { open: open };
})(N);
