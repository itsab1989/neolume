/* N.ui.toast – Toast (SPEC 5.12, NAV-10): max. 1, 4 s (mit Rueckgaengig 6 s), nicht fokussierbar, Text vor dem Einblenden.
 * Lage: unten links (y 568); Bildschirme mit fester Beschreibung unten (Einstellungen: .set-desc bis y 608) setzen
 * toastLow = true -> y 628 unter der Beschreibung, nie ueber Text. Player: toastHigh = true -> oben links unter der Titel-Insel
 * (y 124, x 64), nie ueber Bedien-Insel, Knopf-Beschriftung oder Untertiteln (TV-Test 29.10.: "Sprung zu …" lag ueber dem Label). */
(function (N) {
  var U = N.util, T = { el: null, txt: null, ic: null, timer: 0 };
  T.init = function (parent) {
    T.el = U.el('div', '', parent); T.el.id = 'pn-toast';
    T.ic = N.ui.icon(T.el, 'info', 's2');
    T.txt = document.createTextNode(''); T.el.appendChild(T.txt);
  };
  /* show(text, {icon:'info'|'confirm', undo:bool, undoKey:'YELLOW'(Standard)|'RED', low:bool}); low fehlt -> wie der oberste Bildschirm (scr.toastLow) */
  T.show = function (text, o) {
    o = o || {};
    if (!T.el) return;
    if (T.timer) clearTimeout(T.timer);
    if (N.ui.news && N.ui.news.visible && N.ui.news.visible()) N.ui.news.hide();   // HOME-13: nie zwei Hinweise zugleich – der Toast (Folge einer Taste) geht vor
    N.ui.setIcon(T.ic, o.icon || 'info');
    U.setText(T.txt, text);
    var top = N.router && N.router.top ? N.router.top() : null;
    U.cls(T.el, 'low', o.low !== undefined ? !!o.low : !!(top && top.toastLow));
    U.cls(T.el, 'high', !!(top && top.toastHigh) && !o.low);
    U.cls(T.el, 'on', true);
    T.timer = setTimeout(T.hide, o.ms || (o.undo ? 6000 : 4000));
    T.undoKey = o.undo ? o.undoKey || 'YELLOW' : '';
  };
  /* Finger/Maus (Apple Nr. 26, keine Hinweisleiste/Farbtasten): Rueckgaengig-Toast antippen = dieselbe Taste; Text-Schluessel mit
   * Endung 'Tap' ("Tippen: rückgängig"). Rechteck erst beim Klick lesen (nie im Tastenpfad). Am TV nie (N.input.direct false). */
  T.tapSuffix = function () { return N.input && N.input.direct() ? 'Tap' : ''; };
  T.tap = function (x, y) {
    if (!T.timer || !T.undoKey || !N.input.direct()) return false;
    var e = T.el, l = e.offsetLeft, t = e.offsetTop;
    if (x < l || x >= l + e.offsetWidth || y < t || y >= t + e.offsetHeight) return false;
    var k = T.undoKey; T.undoKey = '';
    N.router.key(k);
    return true;
  };
  T.on = function () { return !!T.timer; };
  T.hide = function () { if (T.timer) clearTimeout(T.timer); T.timer = 0; T.undoKey = ''; if (T.el) U.cls(T.el, 'on', false); };
  N.ui.toast = T;
})(N);
