/* P5 Hilfe & Info (SPEC 7.16.5, 10.4 set.keys/set.testConn/set.version):
 * - Ansicht 'keys' – Tastenbelegung je Bildschirm: links die Bildschirme (wie die Einstellungs-Kategorien), rechts die Tasten
 *   mit Kappe wie auf der Fernbedienung (Farbquadrat A–D, Text-Kappe, RETURN-Symbol). Statisch, nur ▲▼ wechselt den Bildschirm.
 * - N.helpUi.welcome(auto) – Karte "So bedienst du {app}" (einmal je Profil nach dem ersten Betreten von Start; ui/saver.js loest aus)
 * - N.helpUi.connTest() – Verbindung testen (Panel, Zeilen erscheinen nacheinander), about(), licenses(). */
(function (N) {
  var U = N.util, CAT_Y = 112, CAT_STEP = 56, ROW_Y = 112, ROW_STEP = 46;
  var COLOR = { red: ['k-red', 'A'], green: ['k-green', 'B'], yellow: ['k-yellow', 'C'], blue: ['k-blue', 'D'] };
  /* Kappen als Text (Nutzer-Feedback-Regel 10: keine Pfeil-/Sonderzeichen, die TV-Schrift hat sie nicht) */
  var CAP = { DIGITS: '0–9', CH: 'CH', PP: 'PLAY · PAUSE' }, CAPT = { NAV: 'keys.cap.arrows', LR: 'keys.cap.lr', FFRW: 'keys.cap.ffrw', PTR: 'keys.cap.touchpad' };
  /* je Bildschirm: [Kappe, Text-Schluessel keys.<screen>.<id>]. Jede Taste, die eine Hinweisleiste irgendwo zeigt, steht hier
   * (Tastenhinweise "Nur kurz"/"Aus" duerfen nichts unauffindbar machen) */
  var KEYS = [
    ['all', [['NAV', 'nav'], ['OK', 'ok'], ['ret', 'ret'], ['INFO', 'info'], ['TOOLS', 'tools'], ['EXIT', 'exit'], ['PTR', 'ptr']]],
    ['home', [['OK', 'ok'], ['PLAY', 'play'], ['red', 'red'], ['yellow', 'yellow'], ['blue', 'blue'], ['FFRW', 'ffrw'], ['ret', 'ret']]],
    ['library', [['OK', 'ok'], ['PLAY', 'play'], ['red', 'red'], ['yellow', 'yellow'], ['blue', 'blue'], ['DIGITS', 'digits'], ['FFRW', 'ffrw'], ['CH', 'ch']]],
    ['details', [['OK', 'ok'], ['PLAY', 'play'], ['red', 'red'], ['green', 'green'], ['yellow', 'yellow'], ['blue', 'blue'], ['SUBTITLE', 'subtitle'], ['DIGITS', 'digits']]],
    ['search', [['NAV', 'nav'], ['DIGITS', 'digits'], ['red', 'red'], ['yellow', 'yellow'], ['ret', 'ret']]],
    ['player', [['OK', 'ok'], ['LR', 'lr'], ['FFRW', 'ffrw'], ['DIGITS', 'digits'], ['PP', 'pp'], ['CH', 'ch'], ['STOP', 'stop'], ['green', 'green'], ['yellow', 'yellow'], ['blue', 'blue'], ['TOOLS', 'tools'], ['INFO', 'info']]],
    ['music', [['OK', 'ok'], ['green', 'green'], ['yellow', 'yellow'], ['blue', 'blue'], ['FFRW', 'ffrw'], ['CH', 'ch'], ['INFO', 'info']]],
    ['settings', [['NAV', 'nav'], ['OK', 'ok'], ['yellow', 'yellow'], ['INFO', 'info'], ['ret', 'ret']]]
  ];
  var MAXK = 12;
  /* Kappe in ein Element zeichnen (wie die Hinweisleiste) */
  function cap(parent, k) {
    var c = COLOR[k];
    if (c) { U.txt('span', 'k ' + c[0], parent, c[1]); return; }
    var e = U.el('span', 'kt', parent);
    if (k === 'ret') { e.className = 'kt ret'; N.ui.icon(e, 'ret', 's1'); return; }
    e.appendChild(document.createTextNode(CAPT[k] ? N.t(CAPT[k]) : CAP[k] || k));
  }

  N.router.define('keys', function () {
    var s = { rail: 'settings', wheelKeys: ['UP', 'DOWN'] }, cats = [], rows = [], c = 0;
    s.create = function (root) {
      U.txt('div', 'a t-h1', root, N.t('keys.title'), 'left:144px;top:40px;width:900px');
      for (var i = 0; i < KEYS.length; i++) {
        var ce = U.el('div', 'set-cat', root, 'top:' + (CAT_Y + i * CAT_STEP) + 'px');
        U.el('span', 'bar', ce);
        ce.appendChild(document.createTextNode(N.t('keys.scr.' + KEYS[i][0])));
        cats.push(ce);
      }
      for (i = 0; i < MAXK; i++) {
        var r = { el: U.el('div', 'ky-row', root, 'top:' + (ROW_Y + i * ROW_STEP) + 'px;display:none') };
        r.cap = U.el('div', 'ky-cap hint', r.el);
        r.t = U.txt('div', 'ky-t ell', r.el, '');
        rows.push(r);
      }
    };
    function show(i) {
      U.cls(cats[c], 'is-focus', false); U.cls(cats[c], 'is-cur', false);
      c = i;
      U.cls(cats[c], 'is-focus', true); U.cls(cats[c], 'is-cur', true);
      var list = KEYS[c][1];
      for (var k = 0; k < rows.length; k++) {
        var r = rows[k], d = list[k];
        U.show(r.el, !!d);
        if (!d) continue;
        while (r.cap.firstChild) r.cap.removeChild(r.cap.firstChild);   // nur beim Wechsel des Bildschirms (kein Fokusschritt in einer Reihe)
        cap(r.cap, d[0]);
        U.setText(r.t, N.t('keys.' + KEYS[c][0] + '.' + d[1]));
      }
    }
    s.enter = function (p, restore) { show(restore ? restore.c || 0 : 0); };
    s.leave = function () { return { c: c }; };
    s.railBlur = function () { U.cls(cats[c], 'is-focus', false); };
    s.railFocus = function () { U.cls(cats[c], 'is-focus', true); };
    s.hints = function () { return [{ k: 'ret', t: 'hint.back' }, { k: 'INFO', t: 'hint.howTo' }]; };
    s.onKey = function (k) {
      if (k === 'UP' || k === 'DOWN') { var n = N.nav.list(c, cats.length, k, true); if (n >= 0) show(n); return true; }
      if (k === 'INFO' || k === 'ENTER') { N.helpUi.welcome(false); return true; }
      if (k === 'LEFT') { N.ui.rail.open(); return true; }
      return false;                                       // RETURN -> Router: zurueck zu den Einstellungen
    };
    s.pointer = function (x, y, kind) {
      if (x < 144 || x >= 424) return false;
      var i = N.hit.list(CAT_Y, CAT_STEP, 48, cats.length, y);
      if (i < 0) return false;
      if (i !== c) show(i);
      return true;
    };
    return s;
  });

  /* ---------- Karte "So bedienst du {app}" (SPEC 7.16.5) ---------- */
  function welcome(auto) {
    var ov = { el: U.el('div', 'layer'), closed: false };
    U.el('div', 'backdrop', ov.el);
    var box = U.el('div', 'dlg wc', ov.el);
    U.txt('div', 'dt', box, N.t('onb.title'));
    var list = [['yellow', 'onb.yellow'], ['green', 'onb.green'], ['blue', 'onb.blue'], ['INFO', 'onb.info']];
    for (var i = 0; i < list.length; i++) {
      var r = U.el('div', 'wc-row hint', box);
      cap(r, list[i][0]);
      r.appendChild(document.createTextNode(N.t(list[i][1])));
    }
    U.txt('div', 'wc-more', box, N.t('onb.later'));
    var b = U.el('div', 'btn inl is-focus wc-btn', box); b.appendChild(document.createTextNode(N.t('onb.go')));
    function close() {
      if (ov.closed) return;
      ov.closed = true; N.router.closeOverlay(ov);
      if (auto) N.session.setSetting('welcomed', true);
    }
    ov.cancel = close;
    ov.hints = function () { return [{ k: 'ret', t: 'hint.close' }]; };
    ov.onKey = function (k) { if (k === 'ENTER') { close(); return true; } return k !== 'RETURN'; };
    ov.pointer = function (x, y, kind) { if (kind === 'click') close(); return true; };
    N.router.openOverlay(ov);
    return ov;
  }

  /* ---------- Panel mit Zeilen, die sich nachtraeglich aendern (Verbindung testen) ---------- */
  function livePanel(title, onClose) {
    var ov = { el: U.el('div', 'layer'), closed: false };
    U.el('div', 'dim', ov.el);
    var p = U.el('div', 'panel', ov.el);
    U.txt('div', 'pt t-h2', p, title);
    var tx = U.txt('div', 'px', p, '');
    function close() { if (!ov.closed) { ov.closed = true; N.router.closeOverlay(ov); if (onClose) onClose(); } }
    ov.cancel = close;
    ov.hints = function () { return [{ k: 'ret', t: 'hint.back' }]; };
    ov.onKey = function (k) { if (k === 'INFO' || k === 'ENTER') { close(); return true; } return k !== 'RETURN'; };
    ov.pointer = function (x, y, kind) { if (kind === 'click') close(); return true; };
    ov.set = function (lines) { if (!ov.closed) U.setText(tx, lines.join('\n')); };
    N.router.openOverlay(ov);
    return ov;
  }
  function connTest() {
    var task = null, ov = livePanel(N.t('set.testConn'), function () { if (task) task.abort(); });
    ov.set([N.t('ct.running')]);
    task = N.connTest.run(function (lines) { ov.set(lines.concat(['', N.t('ct.running')])); }, function (r) {
      task = null;
      N.log('Verbindung testen: ' + (r.reach ? 'ok ' + N.connTest.median(r.ms) + ' ms, Zugang ' + r.auth : 'nicht erreichbar'));
      ov.set(N.connTest.summary(r));
    });
  }
  N.helpUi = {
    welcome: welcome,
    connTest: connTest,
    about: function () { N.ui.panel.help(N.t('set.about'), N.t('help.about', { v: N.config.version })); },
    licenses: function () { N.ui.panel.help(N.t('set.licenses'), N.t('help.licenses')); }
  };
})(N);
