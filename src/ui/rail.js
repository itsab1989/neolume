/* N.ui.rail – Seitenleiste (SPEC 5.5, 7.4): eingeklappt 120 px (rail.png, Icons aus dem Sprite), ausgeklappt Panel 320 px
 * deckend, translate3d(-200 -> 0) 150 ms, dauerhaft im DOM. Standard-Reihenfolge: Profil, Suche, [Entdecken, P4], Start, Bibliotheken (max. 7), Einstellungen; je Profil anpassbar (W1).
 * Aktuelle Seite: Icon text-1 + 4x24-Balken. Fokus im Panel: Akzent-Fuellung. Kein Wrap. */
(function (N) {
  var U = N.util;
  var KIND_ICON = { movie: 'film', show: 'tv', anime: 'star', doc: 'globe', music: 'note', audio: 'book' };   // M4: Musik, Hoerbuecher
  var R = { el: null, panel: null, entries: [], cur: null, open_: false, f: 0, att: null, profile: null, libs: [] };

  R.init = function (parent) {
    R.el = U.el('div', '', parent, 'display:none'); R.el.id = 'pn-rail';
    var bg = U.el('img', 'rail-bg', R.el); bg.src = N.assetBase + 'rail.png';
    R.icons = U.el('div', 'a', R.el, 'left:0;top:0');
    R.dim = U.el('div', 'nav-dim', R.el);             // aufgeklappte Leiste: Inhalt rechts leicht abdunkeln
    R.panel = U.el('div', 'nav-panel', R.el);
    R.build();
  };
  function avatar(parent, user) {
    var a = U.el('div', 'rav ' + N.ui.avatarClass(user ? user.name : '?'), parent);
    a.appendChild(document.createTextNode(N.ui.initial(user ? user.name : '?')));
    if (user && user.thumb && N.plex.base && N.plex.token) {
      var im = U.el('img', '', a); im.src = N.img.BLANK;
      N.img.want(im, N.img.url(user.thumb, 'avatarS'), 1);
    }
    return a;
  }
  /* Eintraege zwischen Profil (oben) und Einstellungen (unten, y 636): ab y 112 im Abstand 56, bei vielen enger (min. 48) */
  R.layoutY = function (n) {
    return { y0: 112, step: Math.max(48, Math.min(56, Math.floor((628 - 112) / Math.max(1, n)))) };
  };
  /* P4: optionaler Eintrag "Entdecken" (N.disc.enabled); W1: Reihenfolge und ausgeblendete Eintraege je Profil
   * ("Seitenleiste anpassen", N.railRows) – Start und Einstellungen sind immer da */
  R.order = function () {
    var disc = !!(N.disc && N.disc.enabled()), st = N.session && N.session.settings;
    return N.railRows.enabled(st && st.railItems || null, N.railRows.avail(R.libs, disc));
  };
  /* Eintraege neu aufbauen (nur bei Profil-/Bibliothekswechsel oder geaenderter Auswahl, nie im Fokusschritt) */
  R.build = function () {
    var ids = R.order(), L = R.layoutY(ids.length), byLib = {}, i;
    for (i = 0; i < R.libs.length; i++) byLib['lib-' + R.libs[i].id] = R.libs[i];
    var list = [{ id: 'profile', y: 28 }];
    if (N.disc) N.disc.probeHelper();               // nur mit konfiguriertem Helfer (sonst keine Anfrage)
    for (i = 0; i < ids.length; i++) {
      var id = ids[i], y = L.y0 + i * L.step, lib = byLib[id];
      if (id === 'search') list.push({ id: id, icon: 'search', t: 'nav.search', y: y });
      else if (id === 'discover') list.push({ id: id, icon: 'compass', t: 'nav.discover', y: y });
      else if (id === 'home') list.push({ id: id, icon: 'home', t: 'nav.home', y: y });
      else if (lib) list.push({ id: id, icon: R.libIcon(lib), label: lib.title, lib: lib, y: y });
    }
    list.push({ id: 'settings', icon: 'gear', t: 'nav.settings', y: 636 });
    while (R.icons.firstChild) R.icons.removeChild(R.icons.firstChild);
    while (R.panel.firstChild) R.panel.removeChild(R.panel.firstChild);
    U.el('div', 'nav-sep', R.panel);
    for (i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.id === 'profile') {
        avatar(R.icons, R.profile);
        e.ni = U.el('div', 'ni', R.panel, 'top:' + e.y + 'px');
        avatar(e.ni, R.profile);
        e.lbT = U.txt('div', 'lb', e.ni, R.profile ? R.profile.name : '');
      } else {
        e.ri = U.el('div', 'ri', R.icons, 'top:' + e.y + 'px');
        U.el('div', 'bar', e.ri);
        N.ui.icon(e.ri, e.icon);
        e.ni = U.el('div', 'ni', R.panel, 'top:' + e.y + 'px');
        N.ui.icon(e.ni, e.icon);
        e.lbT = U.txt('div', R.longLabel(e.label || N.t(e.t)) ? 'lb lb2' : 'lb', e.ni, e.label || N.t(e.t));
      }
    }
    R.entries = list;
    R.f = 0;
    R.markCur();
  };
  /* Passt nicht in eine Zeile (168 px bei 20 px Schrift, ca. 15 Zeichen)? -> zwei Zeilen in kleinerer Schrift, einmal beim Aufbau
   * (TV-Test 27.10., F6: "Hörbücher & Hör…") */
  R.longLabel = function (t) { return String(t || '').length > 15; };
  R.libIcon = function (lib) { return KIND_ICON[lib.kind === 'anime' && N.anime && !N.anime.showCat() ? lib.type : lib.kind] || 'film'; };
  R.relabel = function () { for (var i = 0; i < R.entries.length; i++) { var e = R.entries[i]; if (e.t) { U.setText(e.lbT, N.t(e.t)); U.cls(e.lbT, 'lb2', R.longLabel(N.t(e.t))); } } };
  R.setData = function (profile, libs) { R.profile = profile; R.libs = libs || []; if (R.el) R.build(); };
  R.markCur = function () {
    for (var i = 0; i < R.entries.length; i++) {
      var e = R.entries[i], on = e.id === R.cur;
      if (e.ri) U.cls(e.ri, 'is-cur', on);
      U.cls(e.ni, 'is-cur', on);
    }
  };
  /* vom Router: Rail fuer diesen Bildschirm zeigen (cur = Eintrag-ID) oder verstecken (null) */
  R.attach = function (cur) {
    R.att = cur;
    if (!R.el) return;
    U.show(R.el, !!cur);
    if (!cur && R.open_) R.close(true);
    if (cur && cur !== R.cur) { R.cur = cur; R.markCur(); }
  };
  R.attached = function () { return !!R.att; };
  R.isOpen = function () { return R.open_; };
  function idx(id) { for (var i = 0; i < R.entries.length; i++) if (R.entries[i].id === id) return i; return id === 'home' ? 0 : idx('home'); }   // ausgeblendeter Eintrag (W1): Fokus auf Start
  function setF(i) { U.cls(R.entries[R.f].ni, 'is-focus', false); R.f = i; U.cls(R.entries[i].ni, 'is-focus', true); }
  /* ◀ von der Inhaltskante: ausklappen, Fokus auf dem aktuellen Eintrag */
  R.open = function (at) {
    if (R.open_ || !R.att) return;
    R.open_ = true;
    var scr = N.router.top();
    if (scr && scr.railBlur) scr.railBlur();
    setF(at === undefined ? idx(R.cur) : at);
    N.fx.move(R.panel);
    U.cls(R.panel, 'open', true);
    U.cls(R.dim, 'on', true);
    N.router.refreshHints();
  };
  /* einklappen; silent = ohne Fokus-Rueckgabe (Bildschirmwechsel) */
  R.close = function (silent) {
    if (!R.open_) return;
    R.open_ = false;
    U.cls(R.panel, 'open', false);
    U.cls(R.dim, 'on', false);
    U.cls(R.entries[R.f].ni, 'is-focus', false);
    if (!silent) { var scr = N.router.top(); if (scr && scr.railFocus) scr.railFocus(); }
    N.router.refreshHints();
  };
  R.activate = function (i) {
    var e = R.entries[i];
    R.close(true);
    // Eintrag des offenen Bildschirms (z. B. Start auf Start): kein Wechsel -> Fokus wie beim Einklappen zurueckgeben,
    // sonst bliebe der Fokusring der Seite unsichtbar (TV-Test 27.10., F9)
    if (N.app.navigate(e.id, e.lib || null) === false) { var scr = N.router.top(); if (scr && scr.railFocus) scr.railFocus(); }
  };
  R.wheelKeys = ['UP', 'DOWN'];
  R.onKey = function (k) {
    if (k === 'UP' || k === 'DOWN') { var n = N.nav.list(R.f, R.entries.length, k, true); if (n >= 0) setF(n); return true; }
    if (k === 'ENTER') { R.activate(R.f); return true; }
    if (k === 'RIGHT') { R.close(); return true; }
    if (k === 'RETURN') {
      var scr = N.router.top();
      if (scr && scr.railReturnExits) { R.close(); N.ui.dialog.exitApp(); }   // Start: Fokus war schon in der Leiste (SPEC 6.2)
      else if (scr && scr.railReturnHome) { R.close(true); N.app.navigate('home'); }   // Bibliothek/Suche: (3) -> Start
      else R.close();
      return true;
    }
    return true;
  };
  /* Zeiger: Eintrag ueber die y-Liste (Hoehe 48) finden */
  R.pointer = function (x, y, kind) {
    var hit = -1;
    for (var i = 0; i < R.entries.length; i++) if (y >= R.entries[i].y && y < R.entries[i].y + 48) { hit = i; break; }
    if (hit < 0) return false;
    if (!R.open_) R.open(hit); else if (hit !== R.f) setF(hit);
    if (kind === 'click') R.activate(hit);
    return true;
  };
  /* Schalter "Entdecken in der Seitenleiste" wirkt sofort */
  N.evt.on('settings:changed', function (e) { if (e && (e.key === 'discover' || e.key === 'railItems') && R.el) R.build(); });
  N.ui.rail = R;
})(N);
