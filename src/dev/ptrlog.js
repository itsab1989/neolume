/* N.devptr – nur Dev-Build (dev/-Modul, nie im Release): protokolliert Zeiger-Ereignisse, um am TV das Signal fuer
 * "Punkt ausgeblendet / Finger vom Touchpad" zu finden (TV-Befund 27.10.: Punkt verschwindet beim Loslassen, erscheint beim
 * erneuten Auflegen in der Bildmitte). Zeile: "ptrdbg +<ms seit letzter Zeile> <typ> <x>,<y> tgt=<tag.klasse> rel=<…>".
 * mousemove wird verdichtet (hoechstens alle 250 ms eine Zeile mit Anzahl/groesster Luecke), Spruenge > 200 px immer;
 * mouseover/mouseout zwischen Elementen nur gezaehlt, ausser relatedTarget fehlt oder Ziel ist html/body/#root. */
(function (N) {
  var U = N.util, last = 0, mv = { n: 0, gap: 0, t: 0, x: -1, y: -1, lastT: 0 }, cross = 0, SAMPLE = 250, JUMP = 200;
  function tag(e) {
    if (!e) return 'null';
    if (e === window) return 'window';
    if (e === document) return 'document';
    var c = e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : '';
    return String(e.tagName || e.nodeName || '?').toLowerCase() + (e.id ? '#' + e.id : '') + c;
  }
  function line(type, e, extra) {
    var now = U.now(), d = last ? now - last : 0;
    last = now;
    var xy = e && e.clientX !== undefined ? ' ' + e.clientX + ',' + e.clientY : '';
    N.log('ptrdbg +' + d + ' ' + type + xy + (e && e.target ? ' tgt=' + tag(e.target) : '') +
      (e && 'relatedTarget' in e ? ' rel=' + tag(e.relatedTarget) : '') + (extra ? ' ' + extra : ''));
  }
  function flushMoves() {
    if (!mv.n) return;
    line('mousemove*' + mv.n, null, 'last=' + mv.x + ',' + mv.y + ' maxgap=' + mv.gap + (cross ? ' over/out=' + cross : ''));
    mv.n = 0; mv.gap = 0; cross = 0;
  }
  function onMove(e) {
    var now = U.now(), jump = mv.x >= 0 && Math.abs(e.clientX - mv.x) + Math.abs(e.clientY - mv.y) > JUMP;
    if (mv.lastT) mv.gap = Math.max(mv.gap, now - mv.lastT);
    mv.lastT = now;
    if (jump) { flushMoves(); line('mousemove-JUMP', e, 'from=' + mv.x + ',' + mv.y); }
    mv.x = e.clientX; mv.y = e.clientY; mv.n++;
    if (now - mv.t >= SAMPLE) { mv.t = now; flushMoves(); }
  }
  function onCross(type) {
    return function (e) {
      var t = e.target, top = t === document || t === document.documentElement || t === document.body || (t && t.id === 'root');
      if (!e.relatedTarget || top) { flushMoves(); line(type, e); } else cross++;
    };
  }
  function plain(type) { return function (e) { flushMoves(); line(type, e); }; }
  N.devptr = {
    init: function () {
      if (typeof document === 'undefined' || !document.addEventListener) return;
      document.addEventListener('mousemove', onMove, true);
      ['mouseover', 'mouseout', 'mouseenter', 'mouseleave'].forEach(function (t) { document.addEventListener(t, onCross(t), true); });
      ['mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'mousewheel', 'DOMMouseScroll', 'touchstart', 'touchend', 'touchcancel',
        'webkitmouseforcewillbegin', 'pointerdown', 'pointerup', 'pointercancel', 'pointerleave', 'pointerout'].forEach(function (t) { document.addEventListener(t, plain(t), true); });
      ['visibilitychange', 'webkitvisibilitychange'].forEach(function (t) {
        document.addEventListener(t, function () { flushMoves(); line(t, null, 'hidden=' + (document.hidden || document.webkitHidden)); }, true);
      });
      ['blur', 'focus', 'resize', 'mouseout', 'mouseover', 'pageshow', 'pagehide'].forEach(function (t) { window.addEventListener(t, function (e) { if (e.target === window || t === 'resize') { flushMoves(); line('window.' + t, e); } }, true); });
      setInterval(flushMoves, 1000);                   // letzte Bewegungs-Zeile auch ohne weitere Ereignisse
      N.log('ptrdbg aktiv (Dev): Zeiger-Ereignisse werden protokolliert');
    }
  };
})(N);
