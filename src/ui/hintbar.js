/* N.ui.hints – Hinweisleiste (SPEC 5.11): max. 5 Eintraege, Farbtaste = Quadrat mit Buchstabe A–D,
 * Tastenkappen wie aufgedruckt (RETURN als Sprite-Symbol). Aenderung nur bei Kontextwechsel.
 * Einstellung "Tastenhinweise" (settings.hints, SPEC 5.11): 'always' (Standard) | 'brief' | 'off'.
 * - brief: sichtbar, wenn ein Bildschirm/Overlay aufgeht (router.refreshHints meldet den Kontextwechsel per wake) und nach
 *   jeder Farbtaste, INFO oder TOOLS (router.key); nach WAKE_MS ausblenden. Nur opacity (kleine Flaeche, Klasse .hid),
 *   ein Timer, kein Layout. Ausgeblendet ist die Leiste nicht anklickbar (hit -> null).
 * - caps.hintBar false (Mac, Nutzer 03.11., SPEC NAV-25): wie 'off' auf Dauer, die Einstellung gibt es dann nicht.
 * - off: Leiste nie sichtbar. Alle Tasten bleiben unter Hilfe & Info -> Tastenbelegung erklaert (views/help.js).
 * Eintraege, die das Geraet nicht kann, entfallen ueber caps (NEEDS: "Beenden" nur mit caps.exit).
 * Finger/Maus/Trackpad (N.input.direct(), nur caps.focusRing 'keys'; Apple Nr. 23/26): KEINE Hinweisleiste – die Bildschirme
 * haben echte Knoepfe, Tippen, langes Druecken (Optionen), Karte (X/Pfeil, Wisch) und Seitenleiste. Wo sonst nur die Leiste
 * "Zurueck" anbot (Ansicht mit scr.backBtn, z. B. "Startseite anpassen"), zeigt sie oben links einen runden Zurueck-Knopf
 * (#pn-tbk, wirkt wie RETURN). Mit Tasten (inp-key) und am TV genau wie immer; ein Wechsel der Eingabeart wirkt sofort. */
(function (N) {
  var U = N.util, MAX = 5;
  var COLOR = { red: ['k-red', 'A'], green: ['k-green', 'B'], yellow: ['k-yellow', 'C'], blue: ['k-blue', 'D'] };
  var H = { el: null, items: [], sig: '' }, WAKE_MS = 4000, wakeT = 0, awake = false, hidden = false;
  H.MODES = ['always', 'brief', 'off'];
  /* Modus aus den Einstellungen des Profils; ohne Profil (Anmeldung, Profilwahl) und bei fehlendem/unbekanntem Wert: immer */
  H.mode = function () {
    if (N.platform && N.platform.caps && N.platform.caps.hintBar === false) return 'off';   // Geraet ohne Leiste (Mac, NAV-25)
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
    // Geraet ohne Leiste: Klasse fuer den Lader (Apple flex.css blendet damit auch das dunkle Band unten aus)
    if (N.platform && N.platform.caps && N.platform.caps.hintBar === false && document.body) U.cls(document.body, 'no-hints', true);
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
  var NEEDS = { 'hint.exit': 'exit' };
  function direct() { return !!(N.input && N.input.direct && N.input.direct()); }
  function usable(d) { var c = N.platform && N.platform.caps, n = d && NEEDS[d.t]; return !n || !c || c[n] !== false; }
  /* rein (getestet): Eintraege, die gezeigt werden – Finger/Maus: keine; sonst ohne Aenderung dieselbe Liste (kein neues Array am TV) */
  H.pick = function (list) {
    list = list || [];
    if (direct()) return [];
    for (var j = 0; j < list.length; j++) if (!usable(list[j])) return list.filter(usable);
    return list;
  };
  /* Zurueck-Knopf oben links (nur Finger/Maus, scr.backBtn; vom Router bei jedem Kontextwechsel): Element erst beim ersten Gebrauch */
  var BK = { x: 64, y: 40, w: 48, h: 48 }, bkOn = false;
  H.BACK = BK;
  H.back = function (want) {
    var on = !!want && direct();
    if (on && H.bk && bkOn) place();                 // gleicher Zustand, aber andere Ansicht/Flaeche: Lage nachfuehren
    if (on === bkOn || (!on && !H.bk)) { bkOn = on; return; }
    bkOn = on;
    if (!H.bk && H.el) { H.bk = U.txt('div', 'btn tback tbk', H.el.parentNode, '\u2039', 'left:' + BK.x + 'px;top:' + BK.y + 'px;width:' + BK.w + 'px;padding:0;text-align:center;border-radius:24px;font-size:36px;line-height:44px').parentNode; }
    if (H.bk && on) place();
    if (H.bk) U.show(H.bk, on);
  };
  /* flexible Flaeche: Knopf an derselben Stelle der Ansicht wie am TV (64/40) – steht sie im verkleinerten 1280x720-Kasten (flache/
   * schmale Flaeche, z. B. "Startseite anpassen" bei iPhone SE quer; Befund Strang M 03.11.: Knopf lag ueber der Ueberschrift),
   * mit dessen Lage und Faktor; und nie unter den sicheren Raendern (Notch/Dynamic Island). TV: 64/40 */
  function place() {
    var S = N.screen, f = S && S.flex ? S.safe : null, sc = f && N.router && N.router.top ? N.router.top() : null;
    var g = sc && !sc.flex ? S.stage() : { x: 0, y: 0, k: 1 };
    var x = f ? Math.max(Math.round(g.x + 64 * g.k), f.l + 16) : 64, y = f ? Math.max(Math.round(g.y + 40 * g.k), f.t + 8) : 40;
    // sehr klein verkleinert (iPhone hoch, k < 0,6): neben der Ueberschrift (x 144·k) ist kein Platz fuer den 48er-Knopf -> darueber
    if (f && x + BK.w + 8 > g.x + 144 * g.k && g.y + 40 * g.k - 56 >= f.t + 8) y = Math.round(g.y + 40 * g.k - 56);
    if (x === BK.x && y === BK.y) return;
    BK.x = x; BK.y = y; H.bk.style.left = x + 'px'; H.bk.style.top = y + 'px';
  }
  /* Treffer auf dem Zurueck-Knopf (N.pointer, vor der Ansicht) */
  H.backHit = function (x, y) { return bkOn && x >= BK.x - 8 && x < BK.x + BK.w + 8 && y >= BK.y - 8 && y < BK.y + BK.h + 8; };
  H.set = function (list) {
    list = H.pick(list);
    apply();                                         // z. B. Profil verlassen (Profilwahl): Modus "immer"
    var sig = '', i;
    for (i = 0; i < list.length; i++) sig += list[i].k + ':' + list[i].t + '|';
    sig += N.i18n.lang() + (N.platform.texts && N.input ? N.input.mode : '');   // Apple: Kappen je Eingabeart (NAV-26)
    if (sig === H.sig || !H.el) return;
    H.sig = sig;
    for (i = 0; i < MAX; i++) {
      var e = H.items[i], d = list[i];
      if (!d) { e.root.style.display = 'none'; continue; }
      e.root.style.display = '';
      var c = COLOR[d.k], cl = c ? N.keys.label(d.k) : null;
      if (c && cl !== null) c = null;                  // Apple (NAV-26): keine Farbquadrate, neutrale Kappe mit der echten Taste/Geste
      if (c) {
        e.k.style.display = ''; e.kt.style.display = 'none';
        e.k.className = 'k ' + c[0]; U.setText(e.kT, N.keys.label(d.k) || c[1]);
      } else {
        e.k.style.display = 'none'; e.kt.style.display = '';
        var ret = d.k === 'ret';
        e.kt.className = ret ? 'kt ret' : 'kt';
        var lb = N.keys.label(d.k);
        e.ktIc.style.display = ret && lb === null ? '' : 'none';
        if (ret && lb !== null) e.kt.className = 'kt';
        U.setText(e.ktT, ret && lb === null ? '' : (lb || d.k));
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
  /* Tasten <-> Finger/Maus: Knoepfe sind anders breit als Tastenkappen -> Trefferflaechen neu (einen Frame spaeter, wie set); die
   * Auswahl der Eintraege haengt an der Art (FOCUS, hintBar) -> Liste der Ansicht neu holen */
  N.evt.on('input:mode', function () {
    H.rects = null; if (!H.measureQ && H.el) { H.measureQ = true; U.raf(H.measure); }
    if (H.el && N.router && N.router.refreshHints) N.router.refreshHints();
  });
  N.ui.hints = H;
})(N);
