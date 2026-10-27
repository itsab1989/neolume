/* Ansicht 'profiles' – Profilwahl + PIN (SPEC 7.2, 7.15, Mockups profiles.html / profiles-pin.html).
 * Start-Fokus: zuletzt genutztes Profil. ◀▶ ohne Wrap. OK: ohne PIN -> Start, mit PIN -> PIN-Dialog (jedes Mal).
 * Kein "Konto wechseln" – ausser einmalig direkt nach der Anmeldung ("Anderes Konto"). Fokus-Gedaechtnis wird beim Wechsel verworfen. */
(function (N) {
  var U = N.util, STEP = 208, W = 168, Y = 232, MAXROW = 6;
  N.router.define('profiles', function (params) {
    var s = {}, tiles = [], users = [], f = 0, ring, other = null, onOther = false, busy = false, x0 = 0, rows = 1, seq = 0, dead = false, subRow = [true, true];
    /* Unterzeile: Hauptkonto/Kind/Jugendlich; Freund-Profil aus setup.json (src 'friend') = "Freigabe" (F20) */
    function subKey(u) { return u.kind ? 'prof.sub.' + u.kind : u.src === 'friend' ? 'prof.sub.friend' : ''; }
    function pos(i) {
      var row = Math.floor(i / MAXROW), inRow = Math.min(MAXROW, users.length - row * MAXROW);
      var start = Math.round((1280 - (inRow * STEP - (STEP - W))) / 2);
      return { x: start + (i % MAXROW) * STEP, y: (row ? 500 : Y) + (subRow[row] ? 0 : 12) };   // Reihe ohne Unterzeilen: mittig (F16)
    }
    s.create = function (root) {
      var st = N.session;
      users = st.users();
      // Hintergrund bei jedem Oeffnen: neue PINs gelten sofort (choose() liest die frische Liste), Schloss wird nachgetragen
      st.refreshUsers(true, function () {
        if (dead) return;
        for (var j = 0; j < users.length; j++) {
          var fu = st.user(users[j].uuid);
          if (fu && fu.pin && !tiles[j].lk) { tiles[j].lk = U.el('div', 'lock', tiles[j]); N.ui.icon(tiles[j].lk, 'lock'); }
        }
      });
      rows = users.length > MAXROW ? 2 : 1;
      subRow = [false, false];
      for (var k = 0; k < users.length; k++) if (subKey(users[k])) subRow[Math.floor(k / MAXROW) ? 1 : 0] = true;
      U.txt('div', 'a t-h1', root, N.t('prof.title'), 'left:0;top:128px;width:1280px;text-align:center');
      var tok = s.avTok = st.cachedToken(st.admin()) || (st.state.server && st.state.server.token);
      // Beim Start ist noch kein Profil aktiv (N.plex.base leer) -> Server-Adresse direkt aus dem Zustand
      var base = s.avBase = N.plex.base || (st.state.server && (st.state.server.uri || '').replace(/\/+$/, '')) || '';
      for (var i = 0; i < users.length; i++) {
        var u = users[i], p = pos(i), t = U.el('div', 'prof', root, 'left:' + p.x + 'px;top:' + p.y + 'px');
        var av = U.el('div', 'av ' + N.ui.avatarClass(u.name), t);
        av.appendChild(document.createTextNode(N.ui.initial(u.name)));
        if (u.thumb && base && tok) { var im = U.el('img', '', av); im.src = N.img.BLANK; N.img.want(im, N.img.url(u.thumb, 'avatar', { token: tok, base: base }), 0); }
        U.txt('div', 'nm', t, u.name);
        if (subKey(u)) U.txt('div', 'sub', t, N.t(subKey(u)));   // ohne Typ keine leere Unterzeile (TV-Test 27.10., F16)
        if (u.pin) { t.lk = U.el('div', 'lock', t); N.ui.icon(t.lk, 'lock'); }
        tiles.push(t);
        if (u.uuid === st.state.lastProfile) f = i;
      }
      x0 = pos(0).x;
      if (rows === 1) U.txt('div', 'a t-small c2', root, N.t('prof.help'), 'left:0;top:520px;width:1280px;text-align:center');
      if (st.state.firstPicker) {
        other = U.el('div', 'btn', root, 'left:540px;top:580px;width:200px;text-align:center;padding:0');
        other.appendChild(document.createTextNode(N.t('prof.otherAccount')));
      }
      ring = new N.ui.Ring(root);
    };
    function focusTile(i) {
      if (onOther) { U.cls(other, 'is-focus', false); onOther = false; }
      if (tiles[f]) U.cls(tiles[f], 'is-focus', false);
      f = i;
      U.cls(tiles[f], 'is-focus', true);
      N.fx.move(tiles[f].firstChild);
      var p = pos(f);
      ring.to('prof', p.x + 4, p.y + 4);
    }
    function focusOther() {
      U.cls(tiles[f], 'is-focus', false); ring.hide();
      U.cls(other, 'is-focus', true); onOther = true;
    }
    s.enter = function () {
      busy = false;
      focusTile(f);
      var st = N.session;
      if (st.needsProtectHint()) {
        N.ui.dialog.open({ title: N.t('kids.protect.title'), text: N.t(st.pkg ? 'kids.protect.app.text' : 'kids.protect.text'),
          buttons: [{ id: 'ok', t: N.t('kids.protect.ok') }, { id: 'later', t: N.t('kids.protect.later') }], focus: 0,
          onSelect: function (id) { st.state.protectRemindAt = id === 'ok' ? 4102444800000 : U.now() + 7 * 86400000; st.save(); },
          onCancel: function () { st.state.protectRemindAt = U.now() + 7 * 86400000; st.save(); } });
      }
    };
    function choose(i) {
      if (busy) return;
      var st = N.session, u = st.user(users[i].uuid) || users[i];      // frische Liste: PIN evtl. neu dazugekommen
      if (u.pin) {
        N.ui.pinpad.open({ key: u.uuid, name: u.name, title: N.t('prof.pin.title', { name: u.name }),
          avatar: u.thumb && s.avTok && s.avBase ? N.img.url(u.thumb, 'avatarM', { token: s.avTok, base: s.avBase }) : '',
          verify: function (pin, cb) {
            st.tokenFor(u, pin, function (err, tok) {
              if (err) { cb(false, err); if (err.authExpired) askSignIn(); return; }
              s.tok = tok; cb(true);
            });
          },
          onSuccess: function () { if (!dead) go(u, s.tok); } });
        return;
      }
      busy = true;
      var my = ++seq;
      s.task = st.tokenFor(u, null, function (err, tok) {
        if (my !== seq || dead) return;               // abgebrochen (RETURN) oder Ansicht weg
        busy = false; s.task = null;
        if (err) {
          N.diag.log('warn', 'profile switch failed ' + (err.status || err.type));
          if (err.authExpired) askSignIn(); else N.ui.toast.show(N.t('toast.actionFailed'));
          return;
        }
        go(u, tok);
      });
    }
    function cancelChoose() { seq++; busy = false; if (s.task && s.task.abort) s.task.abort(); s.task = null; }
    /* plex.tv lehnt das Konto-Token ab (401): Konto neu anmelden anbieten – keine PIN-Fehlversuche.
     * PMS-only (setup.json): Profil-Token ungueltig -> nur Hinweis „Einrichtung am Computer erneut ausfuehren“ */
    function askSignIn() {
      if (N.session.pkg) {
        N.ui.dialog.open({ title: N.t('err.setup.title'), text: N.t('err.setup.text'), buttons: [{ id: 'ok', t: N.t('err.btn.ok') }], focus: 0 });
        return;
      }
      N.ui.dialog.open({ title: N.t('err.auth.title'), text: N.t('err.auth.text'),
        buttons: [{ id: 'cancel', t: N.t('dlg.account.cancel') }, { id: 'in', t: N.t('err.btn.signIn') }], focus: 1,
        onSelect: function (id) { if (id === 'in') { N.session.signOut(); N.router.reset('login'); } } });
    }
    function go(u, tok) {
      N.session.activate(u, tok);
      N.router.reset('home');
    }
    s.hints = function () { return [{ k: 'ret', t: params && params.atStart ? 'hint.exit' : 'hint.back' }]; };
    s.leave = function () { if (busy) cancelChoose(); };
    s.destroy = function () { dead = true; cancelChoose(); };
    s.onKey = function (k) {
      if (k === 'RETURN' && busy) { cancelChoose(); return true; }
      if (k === 'RETURN') {
        if (params && params.atStart || N.router.depth() < 2) N.ui.dialog.exitApp(); else N.router.back();
        return true;
      }
      if (onOther) {
        if (k === 'UP') focusTile(f);
        else if (k === 'ENTER') askOther();
        return true;
      }
      if (k === 'LEFT' || k === 'RIGHT') {
        var n = N.nav.list(f % MAXROW, Math.min(MAXROW, users.length - Math.floor(f / MAXROW) * MAXROW), k, false);
        if (n >= 0) focusTile(Math.floor(f / MAXROW) * MAXROW + n);
        return true;
      }
      if (k === 'DOWN') {
        if (rows === 2 && f < MAXROW) focusTile(Math.min(f + MAXROW, users.length - 1));
        else if (other) focusOther();
        return true;
      }
      if (k === 'UP') { if (rows === 2 && f >= MAXROW) focusTile(f - MAXROW); return true; }
      if (k === 'ENTER') { choose(f); return true; }
      return true;
    };
    function askOther() {
      N.ui.dialog.open({ title: N.t('dlg.account.title'), text: N.t('dlg.account.text'),
        buttons: [{ id: 'cancel', t: N.t('dlg.account.cancel') }, { id: 'out', t: N.t('dlg.account.confirm') }], focus: 0,
        onSelect: function (id) { if (id === 'out') { N.session.signOut(); N.router.reset('login'); } } });
    }
    /* Zeiger: Kachel per Index-Mathe (Reihe y, Spalte x) */
    s.pointer = function (x, y, kind) {
      if (other && N.hit.rect(540, 580, 200, 48, x, y)) { if (!onOther) focusOther(); if (kind === 'click') askOther(); return true; }
      var y0 = pos(0).y, y1 = rows === 2 ? pos(MAXROW).y : -1e4, row = y >= y0 && y < y0 + 240 ? 0 : rows === 2 && y >= y1 && y < y1 + 240 ? 1 : -1;
      if (row < 0) return false;
      var inRow = Math.min(MAXROW, users.length - row * MAXROW), start = pos(row * MAXROW).x;
      var c = N.hit.list(start, STEP, W, inRow, x);
      if (c < 0) return false;
      var i = row * MAXROW + c;
      if (i !== f || onOther) focusTile(i);
      if (kind === 'click') choose(i);
      return true;
    };
    s.wheelKeys = ['LEFT', 'RIGHT'];
    return s;
  });
})(N);
