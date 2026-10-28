/* N.ui.hints – Hinweisleiste (SPEC 5.11): max. 5 Eintraege, Farbtaste = Quadrat mit Buchstabe A–D,
 * Tastenkappen wie aufgedruckt (RETURN als Sprite-Symbol). Aenderung nur bei Kontextwechsel.
 * Einstellung "Tastenhinweise" (settings.hints, SPEC 5.11): 'always' (Standard) | 'brief' | 'off'.
 * - brief: sichtbar, wenn ein Bildschirm/Overlay aufgeht (router.refreshHints meldet den Kontextwechsel per wake) und nach
 *   jeder Farbtaste, INFO oder TOOLS (router.key); nach WAKE_MS ausblenden. Nur opacity (kleine Flaeche, Klasse .hid),
 *   ein Timer, kein Layout. Ausgeblendet ist die Leiste nicht anklickbar (hit -> null).
 * - off: Leiste nie sichtbar. Alle Tasten bleiben unter Hilfe & Info -> Tastenbelegung erklaert (views/help.js). */
(function (N) {
  var U = N.util, MAX = 5;
  var COLOR = { red: ['k-red', 'A'], green: ['k-green', 'B'], yellow: ['k-yellow', 'C'], blue: ['k-blue', 'D'] };
  var H = { el: null, items: [], sig: '' }, WAKE_MS = 4000, wakeT = 0, awake = false, hidden = false;
  H.MODES = ['always', 'brief', 'off'];
  /* Modus aus den Einstellungen des Profils; ohne Profil (Anmeldung, Profilwahl) und bei fehlendem/unbekanntem Wert: immer */
  H.mode = function () {
    var s = N.session && N.session.profile ? N.session.settings : null, m = s && s.hints;
    return m === 'brief' || m === 'off' ? m : 'always';
  };
  function apply() {
    if (!H.el) return;
    var m = H.mode(), hid = m === 'off' || (m === 'brief' && !awake);
    if (hid !== hidden) { hidden = hid; U.cls(H.el, 'hid', hid); }
  }
  function sleep() { wakeT = 0; awake = false; apply(); }
  /* Kontextwechsel oder Farbtaste/INFO/TOOLS: im Modus "Nur kurz" einblenden und den Ausblend-Timer neu starten */
  H.wake = function () {
    if (H.mode() !== 'brief') { apply(); return; }
    awake = true; apply();
    if (wakeT) clearTimeout(wakeT);
    wakeT = setTimeout(sleep, N.config.hintMs || WAKE_MS);
  };
  H.visible = function () { return !hidden; };
  /* Einstellung geaendert / anderes Profil: sofort wirken lassen ("Nur kurz" zeigt die Leiste dabei einmal) */
  H.applyMode = function () { awake = false; H.wake(); };
  H.init = function (parent) {
    H.el = U.el('div', '', parent); H.el.id = 'pn-hints';
    for (var i = 0; i < MAX; i++) {
      var e = { root: U.el('span', 'hint', H.el, 'display:none') };
      e.k = U.el('span', 'k', e.root); e.kT = document.createTextNode(''); e.k.appendChild(e.kT);
      e.kt = U.el('span', 'kt', e.root); e.ktT = document.createTextNode(''); e.kt.appendChild(e.ktT);
      e.ktIc = N.ui.icon(e.kt, 'ret', 's1'); e.ktIc.style.display = 'none';
      e.lb = document.createTextNode(''); e.root.appendChild(e.lb);
      H.items.push(e);
    }
  };
  /* list: [{k:'red'|'green'|'yellow'|'blue'|'ret'|'INFO'|'TOOLS'|'DIGITS', t:'hint.key'}] */
  H.set = function (list) {
    list = list || [];
    apply();                                          // z. B. Profil verlassen (Profilwahl): Modus "immer"
    var sig = '', i;
    for (i = 0; i < list.length; i++) sig += list[i].k + ':' + list[i].t + '|';
    sig += N.i18n.lang();
    if (sig === H.sig || !H.el) return;
    H.sig = sig;
    for (i = 0; i < MAX; i++) {
      var e = H.items[i], d = list[i];
      if (!d) { e.root.style.display = 'none'; continue; }
      e.root.style.display = '';
      var c = COLOR[d.k];
      if (c) {
        e.k.style.display = ''; e.kt.style.display = 'none';
        e.k.className = 'k ' + c[0]; U.setText(e.kT, c[1]);
      } else {
        e.k.style.display = 'none'; e.kt.style.display = '';
        var ret = d.k === 'ret';
        e.kt.className = ret ? 'kt ret' : 'kt';
        e.ktIc.style.display = ret ? '' : 'none';
        U.setText(e.ktT, ret ? '' : (N.keys.cap[d.k] || d.k));
      }
      U.setText(e.lb, N.t(d.t));
    }
    H.list = list.slice(0, MAX); H.rects = null;
    if (!H.measureQ) { H.measureQ = true; U.raf(H.measure); }
  };
  /* Zeiger (Smart Control hat kein TOOLS usw.): Klick auf einen Eintrag = diese Taste. Rechtecke EINMAL je Aenderung messen,
   * einen Frame nach dem Setzen (nie im Tastenpfad); Treffer per Rechteck-Mathe. */
  var KEY = { OK: 'ENTER', red: 'RED', green: 'GREEN', yellow: 'YELLOW', blue: 'BLUE', ret: 'RETURN', INFO: 'INFO', TOOLS: 'TOOLS' };
  var X0 = 144, Y0 = 656, PAD = 8;
  H.list = []; H.rects = null; H.measureQ = false;
  H.measure = function () {
    H.measureQ = false;
    var r = [];
    for (var i = 0; i < H.list.length; i++) {
      var e = H.items[i];
      r.push({ x: X0 + e.root.offsetLeft, w: e.root.offsetWidth, k: KEY[H.list[i].k] || null });
    }
    H.rects = r;
  };
  H.hit = function (x, y) {
    if (!H.rects || hidden || y < Y0 - PAD || y >= Y0 + 28 + PAD) return null;
    for (var i = 0; i < H.rects.length; i++) { var r = H.rects[i]; if (r.k && x >= r.x - PAD && x < r.x + r.w + PAD) return r.k; }
    return null;
  };
  H.refresh = function () { H.sig = ''; };
  N.evt.on('settings:changed', function (e) { if (e && e.key === 'hints') H.applyMode(); });
  N.evt.on('profile:changed', function () { H.applyMode(); });
  N.ui.hints = H;
})(N);
