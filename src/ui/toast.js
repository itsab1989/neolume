/* N.ui.toast – Toast (SPEC 5.12): max. 1, 4 s (mit Rueckgaengig 6 s), nicht fokussierbar, Text vor dem Einblenden. */
(function (N) {
  var U = N.util, T = { el: null, txt: null, ic: null, timer: 0 };
  T.init = function (parent) {
    T.el = U.el('div', '', parent); T.el.id = 'pn-toast';
    T.ic = N.ui.icon(T.el, 'info', 's2');
    T.txt = document.createTextNode(''); T.el.appendChild(T.txt);
  };
  /* show(text, {icon:'info'|'confirm', undo:bool}) */
  T.show = function (text, o) {
    o = o || {};
    if (!T.el) return;
    if (T.timer) clearTimeout(T.timer);
    N.ui.setIcon(T.ic, o.icon || 'info');
    U.setText(T.txt, text);
    U.cls(T.el, 'on', true);
    T.timer = setTimeout(T.hide, o.ms || (o.undo ? 6000 : 4000));
  };
  T.hide = function () { if (T.timer) clearTimeout(T.timer); T.timer = 0; if (T.el) U.cls(T.el, 'on', false); };
  N.ui.toast = T;
})(N);
