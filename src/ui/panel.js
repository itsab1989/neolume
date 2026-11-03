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
   * hint: kurze Zeile unter dem Titel (die Hinweisleiste liegt hinter dem Panel), z. B. "OK: an/aus · Zurück: abbrechen".
   * Finger/Maus (caps.scroll 'free'): die Liste scrollt frei unter dem Finger (N.ui.freeList, Schwung, Gummiband, kein Einrasten),
   * Wischen aendert den Fokus nicht, Tipp waehlt. Zurueck-Pfeil "‹" oben links (nur Finger/Maus, NAV-21), wenn RETURN hier eine
   * Ebene zurueck fuehrt – also genau dann, wenn die Hinweisleiste "Zurück" zeigt (onCancel ohne multi; back: true/false erzwingt);
   * er wirkt wie RETURN. Am TV entsteht kein Element (N.input.on false). */
  var VIS = 8;
  /* Panel ueber die ganze Hoehe am rechten Rand (flexible Flaeche, nur ueber Ansichten mit scr.panelFull – Player, Apple Nr. 17):
   * Versatz gegen den mittigen 1280x720-Kasten (x, y) und zusaetzliche Zeilen (n). Sonst (TV, andere Ansichten) alles 0. */
  N.ui.panelFrame = function (step) {
    var S = N.screen, t = N.router && N.router.top ? N.router.top() : null;
    if (!S || !S.flex || !t || !t.panelFull || S.stage().k < 1) return { on: false, x: 0, y: 0, n: 0 };   // verkleinerter Kasten: Panel darin
    var o = S.off();
    return { on: true, x: o.x, y: o.y, n: Math.max(0, Math.floor(2 * o.y / (step || STEP))) };
  };
  /* Panel-Flaeche anlegen (mit Rahmen fr: rechts buendig, volle Hoehe) */
  N.ui.panelEl = function (parent, fr) {
    return U.el('div', 'panel' + (fr.on ? ' pfull' : ''), parent, fr.on ? 'left:' + (X + fr.x) + 'px;top:' + (-fr.y) + 'px;height:' + (720 + 2 * fr.y) + 'px' : undefined);
  };
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
  /* Zurueck-Pfeil oben links im Panel (Finger/Maus, Apple Nr. 11/26; Stil wie der Zurueck-Knopf der Editoren .tbk): 48 x 48 bei
   * Panel-x 24 / y 40, Titel und Hinweiszeile ruecken per CSS nach rechts (.has-bk). Nur auf Geraeten mit umschaltbarer Eingabeart
   * (N.input.on); sichtbar nur bei .inp-touch/.inp-ptr. Rueckgabe: Element oder null */
  var BK = { x: 24, y: 40, w: 48 };
  function backBtn(p, want) {
    if (!want || !(N.input && N.input.on)) return null;
    U.cls(p, 'has-bk', true);
    var b = U.txt('div', 'btn pbk', p, '\u2039').parentNode;
    b.setAttribute('role', 'button'); b.setAttribute('aria-label', N.t('hint.back'));
    return b;
  }
  /* Treffer (Panel-Koordinaten, je 8 px Rand), nur solange der Pfeil sichtbar ist (Finger/Maus) */
  function backHit(x, y) { return N.input.direct() && x >= X + BK.x - 8 && x < X + BK.x + BK.w + 8 && y >= BK.y - 8 && y < BK.y + BK.w + 8; }
  N.ui.panelBack = { el: backBtn, hit: backHit };
  function select(o) {
    var ov = { el: U.el('div', 'layer'), items: [], f: 0, closed: false, off: 0 };
    U.el('div', 'dim', ov.el);                       // Hintergrund leicht abdunkeln: zeigt, was gerade im Fokus ist
    var fr = N.ui.panelFrame(STEP), MAXV = VIS + fr.n, p = N.ui.panelEl(ov.el, fr);
    U.txt('div', 'pt t-h2', p, o.title);
    var bk = backBtn(p, o.back !== undefined ? !!o.back : !!o.onCancel && !o.multi);
    if (o.hint) U.txt('div', 'phint', p, o.hint);
    var act = o.multi && o.done ? o.done : null, ents = act ? o.entries.concat([{ id: '', act: true, t: '' }]) : o.entries;
    var vis = o.more !== false && ents.length > MAXV ? MAXV - 1 : MAXV;   // NAV-11: Mehr-Hinweis immer, wenn die Liste scrollt (more:false schaltet ab)
    var clip = U.el('div', 'tp-clip', p, 'top:' + TOP + 'px;height:' + (vis * STEP) + 'px'), list = U.el('div', 'tp-list', clip);
    if (vis < MAXV) { ov.up = U.txt('div', 'pmore up', p, '›').parentNode; ov.dn = U.txt('div', 'pmore dn', p, '›', 'top:' + (TOP + vis * STEP + 4) + 'px').parentNode; }
    function maxPx() { return Math.max(0, ov.items.length - vis) * STEP; }
    var fl = N.ui.freeList({ el: list, max: maxPx, dim: vis * STEP,
      hit: function (x, y) { return x - fr.x >= X && y + fr.y >= TOP - 24; },   // ganzes Panel unter dem Titel
      onSet: function (px) { if (ov.up) { U.cls(ov.up, 'on', px > 0.5); U.cls(ov.dn, 'on', px < maxPx() - 0.5); } } });
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
      if (!still) {
        if (fl.keys()) ov.off = -1;                   // nach freiem Scrollen: Taste rastet wieder auf ganze Zeilen
        var off = Math.max(0, Math.min(i - 3, ov.items.length - vis));
        if (off !== ov.off) { ov.off = off; U.tf(list, 0, -off * STEP); }
        fl.sync(ov.off * STEP);
      }
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
    ov.scrollTop = function () { return fl.top(); };   // An den Anfang (App.scrollTop, Tipp ganz oben / Cmd+Pfeil hoch)
    ov.pan = function (e) { return fl.pan(e); };     // nicht genommen (kurze Liste, waagerecht): der Router verschluckt den Zug
    ov.wheel = function (x, y, dx, dy) { fl.wheel(x, y, dy); return true; };
    ov.pointerDown = function () { fl.down(); };
    ov.pointer = function (x, y, kind) {
      if (fl.eat(kind)) return true;                  // Tipp in den Schwung: nur anhalten
      x -= fr.x; y += fr.y;                           // volle Hoehe: Panel-Koordinaten (sonst 0)
      if (x < X) { if (kind === 'click') ov.cancel(); return true; }
      if (bk && backHit(x, y)) { if (kind === 'click') ov.cancel(); return true; }   // Zurueck-Pfeil = RETURN
      if (x < X + 24 || x >= X + 416) return false;
      var i;
      if (fl.free) i = fl.idx(y, TOP, STEP, ov.items.length, vis);   // frei gescrollt: auch angeschnittene Zeilen
      else { i = N.hit.list(TOP, STEP, H, Math.min(vis, ov.items.length - ov.off), y); if (i >= 0) i += ov.off; }
      if (i < 0) return false;
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
    var fr = N.ui.panelFrame(STEP), p = N.ui.panelEl(ov.el, fr);
    U.txt('div', 'pt t-h2', p, o.title);
    U.el('div', 'spinner sm pwait', p);
    U.txt('div', 'px pwait-t', p, o.text || '');
    function close() { if (!ov.closed) { ov.closed = true; N.router.closeOverlay(ov); } }
    ov.close = close;
    ov.cancel = function () { close(); if (o.onCancel) o.onCancel(); };
    ov.hints = function () { return [{ k: 'ret', t: 'hint.cancel' }]; };
    ov.onKey = function (k) { return k !== 'RETURN'; };
    ov.pointer = function (x, y, kind) { if (x - fr.x < X && kind === 'click') ov.cancel(); return true; };
    N.router.openOverlay(ov);
    return ov;
  }
  /* help: Titel + Text (max. 600 Zeichen). RETURN/INFO schliesst */
  function help(title, text) {
    var ov = { el: U.el('div', 'layer'), closed: false };
    U.el('div', 'dim', ov.el);                       // Hintergrund leicht abdunkeln: zeigt, was gerade im Fokus ist
    var p = N.ui.panelEl(ov.el, N.ui.panelFrame(STEP));
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
