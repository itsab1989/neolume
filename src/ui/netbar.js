/* N.ui.netbar – Leiste "Server nicht erreichbar" (SPEC 9 Offline, Text 10.5 err.server): oben mittig, nicht fokussierbar,
 * Countdown bis zum naechsten automatischen Versuch (1x/s, nur solange offline). Wieder da: 3 s "Wieder verbunden".
 * Im Player nicht sichtbar – dort pausiert das Video mit eigener Insel "Verbindung unterbrochen". */
(function (N) {
  var U = N.util, B = { el: null }, txt = null, iv = 0, hideT = 0;
  function server() { var s = N.session && N.session.state && N.session.state.server; return s && s.name ? s.name : 'Plex'; }
  function paint() {
    var inPlayer = N.router.topName() === 'player';
    if (!N.net.offline || inPlayer) { U.show(B.el, false); return; }
    var n = N.net.secondsLeft();
    U.setText(txt, N.net.checking || !n ? N.t('net.bar.checking', { server: server() }) : N.t('net.bar.retry', { server: server(), n: n }));
    U.cls(B.el, 'ok', false);
    U.show(B.el, true);
  }
  B.init = function (chrome) {
    B.el = U.el('div', 'netbar', chrome, 'display:none');
    N.ui.icon(B.el, 'info', 's2');
    txt = document.createTextNode(''); B.el.appendChild(txt);
    N.evt.on('net:offline', function () {
      if (hideT) { clearTimeout(hideT); hideT = 0; }
      paint();
      if (!iv) iv = setInterval(paint, 1000);
    });
    N.evt.on('net:online', function () {
      if (iv) { clearInterval(iv); iv = 0; }
      if (N.router.topName() === 'player') { U.show(B.el, false); return; }
      U.setText(txt, N.t('net.bar.back')); U.cls(B.el, 'ok', true); U.show(B.el, true);
      hideT = setTimeout(function () { hideT = 0; U.show(B.el, false); }, 3000);
    });
  };
  N.ui.netbar = B;
})(N);
