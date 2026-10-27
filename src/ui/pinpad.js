/* N.ui.pinpad – PIN-Dialog (SPEC 5.16, Mockup profiles-pin.html): Fokus startet auf „5“, Zifferntasten tippen direkt,
 * nach 4 Ziffern automatische Pruefung (Spinner im ✓-Feld), falsche PIN -> Punkte rot + Text, 5 Fehlversuche -> 30 s Sperre.
 * Logik in N.PinLogic (testbar). PIN wird nie gespeichert. */
(function (N) {
  var U = N.util;
  var KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'];
  var KX = [104, 200, 296], KY = [236, 312, 388, 464];
  /* o: {key (Profil-uuid: Sperre ueberlebt Schliessen), uuid (Profil fuer das Foto, Standard key), name, avatar (img-URL; fehlt: Profilfoto), title, verify(pin, cb(ok, err)), onSuccess(pin), onCancel(),
   *     help (Text unter dem Ziffernblock, Standard prof.pin.help), wrongText (statt prof.pin.wrong), helpKey (INFO-Text)} */
  /* Profilfoto (wie die Profilwahl): Token des Hauptprofils bzw. Server-Token, Server-Adresse auch ohne aktives Profil */
  function avatarUrl(u) {
    var st = N.session;
    if (!u || !u.thumb || !st || !st.state) return '';
    var tok = st.cachedToken(st.admin()) || (st.state.server && st.state.server.token);
    var base = N.plex.base || (st.state.server && (st.state.server.uri || '').replace(/\/+$/, '')) || '';
    return tok && base ? N.img.url(u.thumb, 'avatarM', { token: tok, base: base }) : '';
  }
  N.ui.avatarUrl = avatarUrl;
  function open(o) {
    var ov = { el: U.el('div', 'layer'), keys: [], dots: [], f: 4, closed: false };
    U.el('div', 'backdrop', ov.el);
    var d = U.el('div', 'pdlg', ov.el);
    var av = U.el('div', 'pav ' + N.ui.avatarClass(o.name), d);
    av.appendChild(document.createTextNode(N.ui.initial(o.name)));
    var avUrl = o.avatar !== undefined && o.avatar !== '' ? o.avatar : avatarUrl(N.session && N.session.user(o.uuid || o.key));   // F18: Foto wie auf der Profilwahl
    if (avUrl) { var im = U.el('img', '', av); im.src = N.img.BLANK; N.img.want(im, avUrl, 0); }
    U.txt('div', 'a t-h2 ell', d, o.title, 'left:24px;top:140px;width:432px;text-align:center');
    for (var i = 0; i < 4; i++) ov.dots.push(U.el('div', 'pin-dot', d, 'left:' + (170 + i * 40) + 'px'));
    for (i = 0; i < KEYS.length; i++) {
      var k = U.el('div', 'pkey', d, 'left:' + KX[i % 3] + 'px;top:' + KY[Math.floor(i / 3)] + 'px');
      if (KEYS[i] === 'del') N.ui.icon(k, 'backspace');
      else if (KEYS[i] === 'ok') { ov.okIc = N.ui.icon(k, 'confirm'); ov.spin = U.el('div', 'spinner sm', k, 'display:none'); }
      else k.appendChild(document.createTextNode(KEYS[i]));
      ov.keys.push(k);
    }
    var helpTxt = o.help || N.t('prof.pin.help');
    // Pentest P16: pins.json unlesbar -> App-PINs scheitern geschlossen; sagen, warum keine PIN passt und wie es weitergeht
    if (N.session && N.session.pkg && N.appPin && N.appPin.broken()) { helpTxt = N.t('prof.pin.broken'); o.wrongText = helpTxt; }
    ov.msg = U.txt('div', 'pmsg', d, helpTxt);
    ov.msgEl = ov.msg.parentNode;

    var logic = new N.PinLogic({
      key: o.key, verify: o.verify, now: U.now, timers: { set: function (f, ms) { return setTimeout(f, ms); }, clear: function (t) { clearTimeout(t); } },
      onChange: render, onSuccess: function (pin) { if (ov.closed) return; close(); if (o.onSuccess) o.onSuccess(pin); }
    });
    function render(s) {
      for (var i = 0; i < 4; i++) ov.dots[i].className = 'pin-dot' + (i < s.digits.length ? (s.wrong ? ' bad' : ' on') : '');
      U.show(ov.spin, s.busy); U.show(ov.okIc, !s.busy);
      var txt = helpTxt, bad = false;
      if (s.lockedUntil) { txt = N.t('prof.pin.locked', { n: s.lockLeft }); bad = true; }
      else if (s.wrong) { txt = o.wrongText || N.t('prof.pin.wrong'); bad = true; }
      else if (s.error) { txt = N.t('toast.actionFailed'); bad = true; }
      U.setText(ov.msg, txt);
      ov.msgEl.className = bad ? 'pmsg cdanger' : 'pmsg';
    }
    function setF(i) { U.cls(ov.keys[ov.f], 'is-focus', false); ov.f = i; U.cls(ov.keys[i], 'is-focus', true); }
    function press(i) {
      var v = KEYS[i];
      if (v === 'del') logic.del(); else if (v === 'ok') logic.submit(); else logic.input(v);
    }
    function close() { if (ov.closed) return; ov.closed = true; logic.destroy(); N.router.closeOverlay(ov); }
    ov.close = close;
    ov.cancel = function () { close(); if (o.onCancel) o.onCancel(); };
    ov.hints = function () { return [{ k: 'DIGITS', t: 'hint.type' }, { k: 'ret', t: 'hint.cancel' }]; };
    ov.onKey = function (k) {
      if (N.keys.isDigit(k)) { logic.input(k); return true; }
      if (N.keys.isNav(k)) { var n = N.nav.grid(ov.f, KEYS.length, 3, k); if (n >= 0) setF(n); return true; }
      if (k === 'ENTER') { press(ov.f); return true; }
      if (k === 'INFO') { N.ui.panel.help(N.t('help.title'), N.t(o.helpKey || (N.session.pkg ? 'help.pin.app' : 'help.pin'))); return true; }
      return k !== 'RETURN';
    };
    ov.pointer = function (x, y, kind) {
      var i = N.hit.grid(400 + KX[0], 64 + KY[0], 80, 64, 96, 76, 3, KEYS.length, x, y);
      if (i < 0) return false;
      if (i !== ov.f) setF(i);
      if (kind === 'click') press(i);
      return true;
    };
    setF(4);
    render(logic.s);
    N.router.openOverlay(ov);
    return ov;
  }
  N.ui.pinpad = { open: open, KEYS: KEYS };
})(N);
