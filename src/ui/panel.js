/* N.ui.panel – rechtes Auswahl-Panel (SPEC 5.19) und Hilfe-Panel (INFO, SPEC 10.6). Deckend, ohne Animation. */
(function (N) {
  var U = N.util, X = 840, TOP = 112, STEP = 72, H = 64;
  /* select: o {title, entries:[{id, t, s (Unterzeile, optional), img (URL, nur mit images), sw (Farbfeld .sw-<sw>, optional)}], selected, focus (Index, optional),
   * images (Bild-Spalte statt Haken), onSelect(id), onCancel()}.
   * multi: Mehrfachauswahl (Haken je Eintrag, entries[i].on); OK schaltet um und das Panel bleibt offen, RETURN schliesst ->
   * onDone([ids mit Haken]) (z. B. Bibliotheken des Bildschirmschoners).
   * Mehr als 8 Eintraege: Liste scrollt per translate3d (Anker 4. Zeile); Zeiger scrollt nicht unter dem Punkt weg.
   * more (Standard an, NAV-11): dezenter Mehr-Hinweis (kleines ›, nach oben/unten gedreht, text-2 wie der Staffel-Pfeil .d-tmore), nur wenn oberhalb
   * bzw. unterhalb wirklich Eintraege liegen; dann 7 sichtbare Zeilen, der untere Pfeil steht in der Luecke darunter.
   * entries[i].head: Zwischenueberschrift (nicht waehlbar, der Fokus springt darueber; z. B. Gruppen einer Liste).
   * multi + done {t(n), s(n), min}: eigener letzter Eintrag "Anfragen (2) ›" (Zahl der Haken) – NUR er schliesst mit onDone(ids);
   * unter min Haken gedimmt, die Unterzeile sagt warum. RETURN/Klick daneben = onCancel() (nichts uebernommen). Ohne done wie bisher.
   * hint: kurze Zeile unter dem Titel (die Hinweisleiste liegt hinter dem Panel), z. B. "OK: an/aus · Zurück: abbrechen". */
  var VIS = 8;
  /* Mehr-Hinweis (SPEC NAV-11) fuer jede scrollende senkrechte Liste: zwei dauerhafte Elemente (oben/unten), Lage per css-Text;
   * set(oben, unten) schaltet nur bei Aenderung die Klasse on (visibility) – keine neuen Ebenen im Tastenpfad */
  N.ui.more = function (parent, upCss, dnCss) {
    var m = { up: U.txt('div', 'pmore up', parent, '›', upCss).parentNode, dn: U.txt('div', 'pmore dn', parent, '›', dnCss).parentNode, u: false, d: false };
    m.set = function (u, d) {
      u = !!u; d = !!d;
      if (u !== m.u) { m.u = u; U.cls(m.up, 'on', u); }
      if (d !== m.d) { m.d = d; U.cls(m.dn, 'on', d); }
    };
    return m;
  };
  function select(o) {
    var ov = { el: U.el('div', 'layer'), items: [], f: 0, closed: false, off: 0 };
    U.el('div', 'dim', ov.el);                       // Hintergrund leicht abdunkeln: zeigt, was gerade im Fokus ist
    var p = U.el('div', 'panel', ov.el);
    U.txt('div', 'pt t-h2', p, o.title);
    if (o.hint) U.txt('div', 'phint', p, o.hint);
    var act = o.multi && o.done ? o.done : null, ents = act ? o.entries.concat([{ id: '', act: true, t: '' }]) : o.entries;
    var vis = o.more !== false && ents.length > VIS ? VIS - 1 : VIS;   // NAV-11: Mehr-Hinweis immer, wenn die Liste scrollt (more:false schaltet ab)
    var clip = U.el('div', 'tp-clip', p, 'top:' + TOP + 'px;height:' + (vis * STEP) + 'px'), list = U.el('div', 'tp-list', clip);
    if (vis < VIS) { ov.up = U.txt('div', 'pmore up', p, '›').parentNode; ov.dn = U.txt('div', 'pmore dn', p, '›', 'top:' + (TOP + vis * STEP + 4) + 'px').parentNode; }
    for (var i = 0; i < ents.length; i++) {
      var d = ents[i];
      if (d.act) { ov.act = U.el('div', 'pe two act', list, 'top:' + (i * STEP) + 'px'); ov.actT = U.txt('div', 'lb', ov.act, ''); ov.actS = U.txt('div', 'sb', ov.act, ''); ov.items.push(ov.act); continue; }
      if (d.head) { var hd = U.el('div', 'pe hd', list, 'top:' + (i * STEP) + 'px'); U.txt('div', 'lb', hd, d.t); ov.items.push(hd); continue; }
      var e = U.el('div', 'pe' + ((o.multi ? d.on : d.id === o.selected) ? ' sel' : '') + (d.s ? ' two' : '') + (o.images ? ' im' : '') + (d.sw ? ' has-sw' : ''), list, 'top:' + (i * STEP) + 'px');
      if (d.sw) U.el('span', 'sw sw-' + d.sw, e);
      if (o.images) {                                 // Bild statt Haken (Kapitelbilder, 96 x 54), sichtbare zuerst laden
        var im = U.el('img', '', e); im.src = N.img.BLANK;
        if (d.img) N.img.want(im, d.img, i < vis ? 0 : 2);
      } else N.ui.icon(e, 'confirm');
      U.txt('div', 'lb', e, d.t);
      if (d.s) U.txt('div', 'sb', e, d.s);
      ov.items.push(e);
      if (!o.multi && d.id === o.selected) ov.f = i;
    }
    if (o.focus >= 0 && o.focus < ov.items.length) ov.f = o.focus;
    function head(i) { return !!(ents[i] && ents[i].head); }
    function count() { var n = 0; for (var j = 0; j < o.entries.length; j++) if (o.entries[j].on && !o.entries[j].head) n++; return n; }
    function ready() { return count() >= (act && act.min || 0); }
    function paintAct() {                             // Zahl im Abschluss-Eintrag; gedimmt, solange zu wenig gewaehlt ist
      if (!ov.act) return;
      var n = count();
      U.setText(ov.actT, act.t(n)); U.setText(ov.actS, act.s ? act.s(n, ready()) : '');
      U.cls(ov.act, 'dis', !ready());
    }
    paintAct();
    while (head(ov.f) && ov.f < ov.items.length - 1) ov.f++;
    function setF(i, still) {
      U.cls(ov.items[ov.f], 'is-focus', false); ov.f = i; U.cls(ov.items[i], 'is-focus', true);
      if (!still) { var off = Math.max(0, Math.min(i - 3, ov.items.length - vis)); if (off !== ov.off) { ov.off = off; U.tf(list, 0, -off * STEP); } }
      if (ov.up) { U.cls(ov.up, 'on', ov.off > 0); U.cls(ov.dn, 'on', ov.off + vis < ov.items.length); }
    }
    function close() { if (!ov.closed) { ov.closed = true; N.router.closeOverlay(ov); } }
    function pick(i) {
      if (act && ents[i].act) { if (!ready()) return; close(); if (o.onDone) o.onDone(picked()); return; }   // Abschluss: nur mit genug Haken
      if (o.multi) { var d = ents[i]; d.on = !d.on; U.cls(ov.items[i], 'sel', d.on); paintAct(); return; }   // Haken umschalten, Panel bleibt
      close(); if (o.onSelect) o.onSelect(o.entries[i].id);
    }
    function picked() { var r = []; for (var j = 0; j < o.entries.length; j++) if (o.entries[j].on) r.push(o.entries[j].id); return r; }
    ov.cancel = function () { close(); if (o.multi && !act && o.onDone) o.onDone(picked()); else if (o.onCancel) o.onCancel(); };
    ov.hints = function () {
      if (act) return [{ k: 'ENTER', t: 'hint.toggle' }, { k: 'ret', t: 'hint.cancel' }];
      return o.multi ? [{ k: 'ENTER', t: 'hint.toggle' }, { k: 'ret', t: 'hint.done' }] : [{ k: 'ret', t: o.onCancel ? 'hint.back' : 'hint.cancel' }];
    };
    ov.onKey = function (k) {
      var n = N.nav.list(ov.f, ov.items.length, k, true);
      while (n >= 0 && head(n)) n = N.nav.list(n, ov.items.length, k, true);   // Zwischenueberschrift ueberspringen
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
      var i = N.hit.list(TOP, STEP, H, Math.min(vis, ov.items.length - ov.off), y);
      if (i < 0) return false;
      i += ov.off;
      if (head(i)) return true;
      if (i !== ov.f) setF(i, true);
      if (kind === 'click') pick(i);
      return true;
    };
    U.cls(ov.items[ov.f], 'is-focus', true); setF(ov.f);
    N.router.openOverlay(ov);
    return ov;
  }
  /* wait: Panel "laedt" (Titel, kleiner Lade-Kreis, Text) – sofort sichtbar, solange eine Liste noch kommt (keine leere Wartezeit,
   * ein zweites OK oeffnet nichts doppelt). RETURN/Klick daneben schliesst -> onCancel(). ov.close() schliesst ohne onCancel. */
  function wait(o) {
    var ov = { el: U.el('div', 'layer'), closed: false };
    U.el('div', 'dim', ov.el);
    var p = U.el('div', 'panel', ov.el);
    U.txt('div', 'pt t-h2', p, o.title);
    U.el('div', 'spinner sm pwait', p);
    U.txt('div', 'px pwait-t', p, o.text || '');
    function close() { if (!ov.closed) { ov.closed = true; N.router.closeOverlay(ov); } }
    ov.close = close;
    ov.cancel = function () { close(); if (o.onCancel) o.onCancel(); };
    ov.hints = function () { return [{ k: 'ret', t: 'hint.cancel' }]; };
    ov.onKey = function (k) { return k !== 'RETURN'; };
    ov.pointer = function (x, y, kind) { if (x < X && kind === 'click') ov.cancel(); return true; };
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
  N.ui.panel = { select: select, help: help, wait: wait };
})(N);
