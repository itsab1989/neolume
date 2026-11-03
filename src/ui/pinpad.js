/* N.ui.pinpad – PIN-Dialog (SPEC 5.16, Mockup profiles-pin.html): Fokus startet auf „5“, Zifferntasten tippen direkt,
 * nach 4 Ziffern automatische Pruefung (Spinner im ✓-Feld), falsche PIN -> Punkte rot + Text, 5 Fehlversuche -> 30 s Sperre.
 * Logik in N.PinLogic (testbar). PIN wird nie gespeichert. */
(function (N) {
  var U = N.util;
  var KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'];
  var KX = [104, 200, 296], KY = [236, 312, 388, 464];
  /* Quer (nur flexible Flaeche auf Apple, Hoehe unter 624 – iPhone quer, 10-screens.md 7): Dialog 760 x 356, links Bild, Name, Punkte,
   * Text, rechts der Ziffernblock in voller Groesse (Tasten 80 x 64 = 44 pt auch beim kleinsten Faktor 0,6875) – sonst muesste der
   * hohe Dialog verkleinert werden. Lage im 1280x720-Overlay wie am TV (N.screen.place stellt ihn mittig). */
  var WIDE = { x: 260, y: 182, w: 760, h: 356, kx: [464, 560, 656], ky: [32, 108, 184, 260] };
  /* o: {key (Profil-uuid: Sperre ueberlebt Schliessen), uuid (Profil fuer das Foto, Standard key), name, avatar (img-URL; fehlt: Profilfoto), title, verify(pin, cb(ok, err)), onSuccess(pin), onCancel(),
   *     help (Text unter dem Ziffernblock, Standard prof.pin.help), wrongText (statt prof.pin.wrong), helpKey (INFO-Text)} */
  /* Profilfoto (wie die Profilwahl): Token des Hauptprofils bzw. Server-Token, Server-Adresse auch ohne aktives Profil */
  function avatarUrl(u) {
    var st = N.session;
    if (!u || !u.thumb || !st || !st.state) return '';
    var tok = st.cachedToken(st.admin()) || (st.state.server && st.state.server.token);
    var base = N.plex.base || (st.state.server && (st.state.server.uri || '').replace(/\/+$/, '')) || '';
    return N.img.avatar(u.thumb, 'avatarM', { token: tok, base: base });
  }
  N.ui.avatarUrl = avatarUrl;
  function open(o) {
    var ov = { el: U.el('div', 'layer'), keys: [], dots: [], f: 4, closed: false };
    U.el('div', 'backdrop', ov.el);
    var d = U.el('div', 'pdlg', ov.el);
    var WD = N.screen && N.screen.flex && N.screen.h < 624 ? WIDE : null, kx = WD ? WD.kx : KX, ky = WD ? WD.ky : KY, ox = WD ? WD.x : 400, oy = WD ? WD.y : 64;
    if (WD) { d.style.left = WD.x + 'px'; d.style.top = WD.y + 'px'; d.style.width = WD.w + 'px'; d.style.height = WD.h + 'px'; }
    var av = U.el('div', 'pav ' + N.ui.avatarClass(o.name), d, WD ? 'left:152px;top:40px' : '');
    av.appendChild(document.createTextNode(N.ui.initial(o.name)));
    var im, avU = N.session && N.session.user(o.uuid || o.key);   // F18: Foto wie auf der Profilwahl; PROF-11: gespeichertes Bild sofort
    if (o.avatar) { im = U.el('img', '', av); im.src = N.img.BLANK; N.img.want(im, o.avatar, 0); }
    else if (avU && avU.thumb) { im = U.el('img', '', av); im.src = N.img.BLANK; N.avatars.show(im, { uuid: avU.uuid, thumb: avU.thumb, tier: 'avatarM', url: avatarUrl(avU), prio: 0 }); }
    U.txt('div', 'a t-h2 ell', d, o.title, WD ? 'left:24px;top:148px;width:352px;text-align:center' : 'left:24px;top:140px;width:432px;text-align:center');
    for (var i = 0; i < 4; i++) ov.dots.push(U.el('div', 'pin-dot', d, 'left:' + ((WD ? 130 : 170) + i * 40) + 'px' + (WD ? ';top:200px' : '')));
    for (i = 0; i < KEYS.length; i++) {
      var k = U.el('div', 'pkey', d, 'left:' + kx[i % 3] + 'px;top:' + ky[Math.floor(i / 3)] + 'px');
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
    if (WD) { ov.msgEl.style.top = '248px'; ov.msgEl.style.width = '352px'; }

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
      if (k === 'DEL') { logic.del(); return true; }                 // Ruecktaste einer Hardware-Tastatur (Apple), am TV ohne Code
      if (N.keys.isNav(k)) { var n = N.nav.grid(ov.f, KEYS.length, 3, k); if (n >= 0) setF(n); return true; }
      if (k === 'ENTER') { press(ov.f); return true; }
      if (k === 'INFO') { N.ui.panel.help(N.t('help.title'), N.t(o.helpKey || (N.session.pkg ? 'help.pin.app' : 'help.pin'))); return true; }
      return k !== 'RETURN';
    };
    ov.pointer = function (x, y, kind) {
      var i = N.hit.grid(ox + kx[0], oy + ky[0], 80, 64, 96, 76, 3, KEYS.length, x, y);
      if (i < 0) return false;
      if (i !== ov.f) setF(i);
      if (kind === 'click') press(i);
      return true;
    };
    setF(4);
    render(logic.s);
    N.router.openOverlay(ov);
    setTimeout(function () { if (!ov.closed) ov.box = [d.offsetLeft, d.offsetTop, d.offsetWidth, d.offsetHeight]; }, 50);   // Finger/Maus: Tipp daneben = Abbrechen (N.pointer)
    return ov;
  }
  N.ui.pinpad = { open: open, KEYS: KEYS };
})(N);
