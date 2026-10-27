/* Ansicht 'soon' – freundlicher Platzhalter fuer Bereiche ausserhalb von M2 (Bibliothek, Details, Suche, Wiedergabe). */
(function (N) {
  var U = N.util;
  N.router.define('soon', function (params) {
    var s = {};
    s.rail = params && params.rail ? params.rail : null;
    s.create = function (root) {
      var area = params.label || (params.area === 'search' ? N.t('nav.search') : N.t('soon.' + (params.area === 'player' ? 'player' : 'details')));
      U.txt('div', 'soon-ov t-label c2', root, area);
      U.txt('div', 'soon-ti t-display', root, N.t('soon.title'));
      U.txt('div', 'soon-tx t-body c2', root, N.t('soon.text'));
    };
    s.hints = function () { return [{ k: 'ret', t: 'hint.back' }]; };
    s.onKey = function (k) {
      if (k === 'LEFT' && s.rail) { N.ui.rail.open(); return true; }
      return k !== 'RETURN';
    };
    s.pointer = function () { return false; };
    return s;
  });
})(N);
