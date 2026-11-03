/* Ansicht 'profiles' – Profilwahl + PIN (SPEC 7.2, 7.15, Mockups profiles.html / profiles-pin.html).
 * Start-Fokus: zuletzt genutztes Profil. ◀▶ ohne Wrap. OK: ohne PIN -> Start, mit PIN -> PIN-Dialog (jedes Mal).
 * Kein "Konto wechseln" – ausser einmalig direkt nach der Anmeldung ("Anderes Konto"). Fokus-Gedaechtnis wird beim Wechsel verworfen.
 * Aus der App geoeffnet (Einstellungen, Seitenleiste): Zurueck-Knopf oben links, sichtbar nur bei Finger/Maus (N.input.direct,
 * CSS .tback); mit Tasten fuehrt RETURN zurueck wie bisher. */
(function (N) {
  var U = N.util, STEP = 208, W = 168, Y = 232, BACK = { x: 64, y: 40, w: 160, h: 48 }, OTHER = { w: 200, h: 48 };
  N.router.define('profiles', function (params) {
    var s = {}, tiles = [], users = [], f = 0, ring, other = null, onOther = false, busy = false, x0 = 0, rows = 1, seq = 0, dead = false, subRow = [true, true], back = null;
    /* Flexible Flaeche (nur Apple, 10-screens.md 7): die Ansicht fuellt W x H; so viele Kacheln je Reihe, wie in die Breite passen
     * (iPhone hoch 2, iPad hoch 4), beliebig viele Reihen, alles senkrecht mittig. Mitte/Rand in Ansichts-Koordinaten (die Ansicht ist
     * bei M/K um die Inhaltskante nach links verschoben, N.screen.view). TV: 6 je Reihe, hoechstens 2 Reihen, Lagen wie bisher. */
    var FX = !!(N.screen && N.screen.flex), V = FX ? N.screen.view() : null, CX = FX ? -V.x + N.screen.w / 2 : 640;
    var BK = FX ? { x: -V.x + 24, y: BACK.y, w: BACK.w, h: BACK.h } : BACK;
    var STP = FX && N.screen.cls.w === 'K' ? 176 : STEP;   // iPhone hoch: 3 Kacheln je Reihe (8 Luecke)
    var MAXROW = FX ? Math.max(1, Math.min(6, Math.floor((N.screen.w - (STP < STEP ? 24 : 48) + (STP - W)) / STP))) : 6, ROWH = STP < STEP ? 252 : 268, top0 = Y, otherY = 580;
    if (FX) s.flex = true;
    /* Unterzeile: Hauptkonto/Kind/Jugendlich */
    function subKey(u) { return u.kind ? 'prof.sub.' + u.kind : ''; }
    function rowY(row) { return FX ? top0 + row * ROWH : row ? 500 : Y; }
    function pos(i) {
      var row = Math.floor(i / MAXROW), inRow = Math.min(MAXROW, users.length - row * MAXROW);
      var start = Math.round(CX - (inRow * STP - (STP - W)) / 2);
      return { x: start + (i % MAXROW) * STP, y: rowY(row) + (subRow[row] ? 0 : 12) };   // Reihe ohne Unterzeilen: mittig (F16)
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
      rows = FX ? Math.max(1, Math.ceil(users.length / MAXROW)) : users.length > MAXROW ? 2 : 1;
      subRow = [];
      for (var k = 0; k < rows; k++) subRow.push(false);
      for (k = 0; k < users.length; k++) if (subKey(users[k])) subRow[FX ? Math.floor(k / MAXROW) : Math.floor(k / MAXROW) ? 1 : 0] = true;
      if (FX) {                                        // Titel 104 ueber der ersten Reihe, darunter Hilfe/Knopf; Block senkrecht mittig
        var blockH = 104 + rows * ROWH + (rows === 1 ? 40 : 0) + (st.state.firstPicker ? 72 : 0);
        top0 = Math.max(148, Math.round((V.h - blockH) / 2) + 104);
        otherY = top0 + rows * ROWH + (rows === 1 ? 40 : 8);
      }
      U.txt('div', 'a t-h1', root, N.t('prof.title'), FX ? 'left:' + (CX - N.screen.w / 2 + 24) + 'px;top:' + (top0 - 104) + 'px;width:' + (N.screen.w - 48) + 'px;text-align:center'
        : 'left:0;top:128px;width:1280px;text-align:center');
      var tok = s.avTok = st.cachedToken(st.admin()) || (st.state.server && st.state.server.token);
      // Beim Start ist noch kein Profil aktiv (N.plex.base leer) -> Server-Adresse direkt aus dem Zustand
      var base = s.avBase = N.plex.base || (st.state.server && (st.state.server.uri || '').replace(/\/+$/, '')) || '';
      for (var i = 0; i < users.length; i++) {
        var u = users[i], p = pos(i), t = U.el('div', 'prof', root, 'left:' + p.x + 'px;top:' + p.y + 'px');
        var av = U.el('div', 'av ' + N.ui.avatarClass(u.name), t);
        av.appendChild(document.createTextNode(N.ui.initial(u.name)));
        if (u.thumb) { var im = U.el('img', '', av); im.src = N.img.BLANK; N.avatars.show(im, { uuid: u.uuid, thumb: u.thumb, tier: 'avatar', url: N.img.avatar(u.thumb, 'avatar', { token: tok, base: base }), prio: 0 }); }   // PROF-11: gespeichertes Bild sofort; TLS 1.2: direkt von plex.tv (ohne PMS)
        U.txt('div', 'nm', t, u.name);
        if (subKey(u)) U.txt('div', 'sub', t, N.t(subKey(u)));   // ohne Typ keine leere Unterzeile (TV-Test 27.10., F16)
        if (u.pin) { t.lk = U.el('div', 'lock', t); N.ui.icon(t.lk, 'lock'); }
        tiles.push(t);
        if (u.uuid === st.state.lastProfile) f = i;
      }
      x0 = pos(0).x;
      if (rows === 1) U.txt('div', 'a t-small c2', root, N.t('prof.help'), FX ? 'left:' + (CX - N.screen.w / 2 + 24) + 'px;top:' + (top0 + 288) + 'px;width:' + (N.screen.w - 48) + 'px;text-align:center'
        : 'left:0;top:520px;width:1280px;text-align:center');
      if (st.state.firstPicker) {
        other = U.el('div', 'btn', root, 'left:' + (CX - OTHER.w / 2) + 'px;top:' + otherY + 'px;width:' + OTHER.w + 'px;text-align:center;padding:0');
        other.appendChild(document.createTextNode(N.t('prof.otherAccount')));
      }
      if (!(params && params.atStart) && N.router.depth() >= 2) {   // aus der App: Zurueck-Knopf (am TV per CSS nie sichtbar)
        back = U.el('div', 'btn tback', root, 'width:' + BK.w + 'px;text-align:center;padding:0' + (FX ? ';left:' + BK.x + 'px' : ''));
        back.appendChild(document.createTextNode('\u2039 ' + N.t('hint.back')));
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
        buttons: [{ id: 'in', t: N.t('err.btn.signIn') }, { id: 'cancel', t: N.t('dlg.account.cancel') }], focus: 0,
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
        if (Math.floor(f / MAXROW) < rows - 1) focusTile(Math.min(f + MAXROW, users.length - 1));
        else if (other) focusOther();
        return true;
      }
      if (k === 'UP') { if (f >= MAXROW) focusTile(f - MAXROW); return true; }
      if (k === 'ENTER') { choose(f); return true; }
      return true;
    };
    function askOther() {
      N.ui.dialog.open({ title: N.t('dlg.account.title'), text: N.t('dlg.account.text'),
        buttons: [{ id: 'out', t: N.t('dlg.account.confirm') }, { id: 'cancel', t: N.t('dlg.account.cancel') }], focus: 1,
        onSelect: function (id) { if (id === 'out') { N.session.signOut(); N.router.reset('login'); } } });
    }
    /* Zeiger: Kachel per Index-Mathe (Reihe y, Spalte x) */
    s.pointer = function (x, y, kind) {
      if (back && N.input.direct() && N.hit.rect(BK.x, BK.y, BK.w, BK.h, x, y)) { if (kind === 'click') { if (busy) cancelChoose(); N.router.back(); } return true; }
      if (other && N.hit.rect(CX - OTHER.w / 2, otherY, OTHER.w, OTHER.h, x, y)) { if (!onOther) focusOther(); if (kind === 'click') askOther(); return true; }
      var row = -1;
      for (var r = 0; r < rows; r++) { var yr = pos(r * MAXROW).y; if (y >= yr && y < yr + 240) row = r; }
      if (row < 0) return false;
      var inRow = Math.min(MAXROW, users.length - row * MAXROW), start = pos(row * MAXROW).x;
      var c = N.hit.list(start, STP, W, inRow, x);
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
