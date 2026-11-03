/* N.ui.rail – Seitenleiste (SPEC 5.5, 7.4): eingeklappt 120 px (rail.png, Icons aus dem Sprite), ausgeklappt Panel 320 px
 * deckend, translate3d(-200 -> 0) 150 ms, dauerhaft im DOM (Finger: R.pan, bis -320 = ganz aus dem Bild). Standard-Reihenfolge: Profil, Suche, [Entdecken, P4], Start, Bibliotheken (max. 7), Einstellungen; je Profil anpassbar (W1).
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
    if (user && user.thumb) {   // PROF-11: gespeichertes Bild sofort, sonst ueber den Server wie bisher (TLS 1.2: direkt von plex.tv)
      var im = U.el('img', '', a); im.src = N.img.BLANK;
      N.avatars.show(im, { uuid: user.uuid, thumb: user.thumb, tier: 'avatarS', url: N.img.avatar(user.thumb, 'avatarS', { base: N.plex.base, token: N.plex.token }), prio: 1 });
    }
    return a;
  }
  /* Eintraege zwischen Profil (oben) und Einstellungen (unten, y 636): ab y 112 im Abstand 56, bei vielen enger (min. 48) */
  R.layoutY = function (n) {
    return { y0: 112, step: Math.max(48, Math.min(56, Math.floor((628 - 112) / Math.max(1, n)))) };
  };
  /* P4: optionaler Eintrag "Entdecken" (N.disc.enabled); W1: Reihenfolge und ausgeblendete Eintraege je Profil
   * ("Seitenleiste anpassen", N.railRows) – Start und Einstellungen sind immer da */
  /* Weitere Server: deren Bibliotheken (N.srv, mit srv/srvName) nach den eigenen; Seitenleisten-ID 'xlib-<server>-<id>' */
  R.allLibs = function () { var x = N.srv ? N.srv.libs() : []; return x.length ? R.libs.concat(x) : R.libs; };
  /* zwischen Profil und Einstellungen passen hoechstens MAX Eintraege (Abstand min. 48); weitere bleiben unsichtbar, bis der
   * Nutzer andere in "Seitenleiste anpassen" ausblendet (betrifft praktisch nur viele Bibliotheken weiterer Server) */
  R.MAX = 10;
  R.order = function () {
    var disc = !!(N.disc && N.disc.enabled()), st = N.session && N.session.settings;
    var ids = N.railRows.enabled(st && st.railItems || null, N.railRows.avail(R.allLibs(), disc));
    if (ids.length <= R.MAX) return ids;
    var out = [], n = 0;                            // 'home' bleibt immer (gesperrt), an seiner Stelle
    for (var i = 0; i < ids.length; i++) { if (ids[i] === 'home') out.push(ids[i]); else if (n < R.MAX - 1) { out.push(ids[i]); n++; } }
    return out;
  };
  /* Eintraege neu aufbauen (nur bei Profil-/Bibliothekswechsel oder geaenderter Auswahl, nie im Fokusschritt) */
  R.build = function () {
    var ids = R.order(), L = R.layoutY(ids.length), byLib = {}, i, all = R.allLibs();
    for (i = 0; i < all.length; i++) byLib[N.railRows.libId(all[i])] = all[i];
    var list = [{ id: 'profile', y: 28 }];
    if (N.disc) N.disc.probeHelper();               // nur mit konfiguriertem Helfer (sonst keine Anfrage)
    for (i = 0; i < ids.length; i++) {
      var id = ids[i], y = L.y0 + i * L.step, lib = byLib[id];
      if (id === 'search') list.push({ id: id, icon: 'search', t: 'nav.search', y: y });
      else if (id === 'discover') list.push({ id: id, icon: 'compass', t: 'nav.discover', y: y });
      else if (id === 'home') list.push({ id: id, icon: 'home', t: 'nav.home', y: y });
      else if (lib) list.push({ id: id, icon: R.libIcon(lib), label: lib.title, lib: lib, y: y });
    }
    list.push({ id: 'settings', icon: 'gear', t: 'nav.settings', y: 636 + (N.screen.flex ? N.screen.h - 720 : 0) });   // flexible Flaeche: unten buendig
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
        var lt = e.label || N.t(e.t);
        if (e.lib && e.lib.srv) {                      // Weitere Server: Name einzeilig, darunter klein die Herkunft
          e.lbT = U.txt('div', 'lb lbx', e.ni, lt);
          U.txt('div', 'lbo', e.ni, N.t('srv.from', { server: e.lib.srvName }));
        } else {
          e.lbT = U.txt('div', R.longLabel(lt) ? 'lb lb2 clamp' : 'lb', e.ni, '');
          U.clampText(e.lbT, lt);
        }
      }
    }
    R.entries = list;
    R.f = 0;
    R.markCur();
  };
  /* Passt nicht in eine Zeile (168 px bei 20 px Schrift, ca. 15 Zeichen)? -> bis zu zwei Zeilen in normaler Schrift, danach "…",
   * einmal beim Aufbau (TV-Test 27.10., F6: "Hörbücher & Hör…"; F25: nicht mehr verkleinern) */
  R.longLabel = function (t) { return String(t || '').length > 15; };
  R.libIcon = function (lib) { return KIND_ICON[lib.kind === 'anime' && N.anime && !N.anime.showCat() ? lib.type : lib.kind] || 'film'; };
  R.relabel = function () {
    for (var i = 0; i < R.entries.length; i++) {
      var e = R.entries[i], lt = e.t && N.t(e.t);
      if (e.t) { e.lbT.parentNode.className = R.longLabel(lt) ? 'lb lb2 clamp' : 'lb'; U.clampText(e.lbT, lt); }   // lbT ist der Textknoten
    }
    if (N.ui.tabbar) N.ui.tabbar.relabel();
  };
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
    if (N.ui.tabbar) N.ui.tabbar.sync();            // flexible Flaeche: Leiste unten / Menue-Knopf folgen der Seitenleiste
  };
  R.attached = function () { return !!R.att; };
  /* flexible Flaeche, Breitenklasse M/K: keine Icon-Spalte (Leiste nur einblendbar, N.ui.tabbar); TV/R: false */
  R.slim = function () { return !!(N.ui.tabbar && N.ui.tabbar.slim()); };
  /* Eintrag der Seitenleiste zu einer ID (oder null, z. B. ausgeblendet oder Bibliothek verschwunden) */
  R.entry = function (id) { for (var i = 0; i < R.entries.length; i++) if (R.entries[i].id === id) return R.entries[i]; return null; };
  R.isOpen = function () { return R.open_; };
  function idx(id) { for (var i = 0; i < R.entries.length; i++) if (R.entries[i].id === id) return i; return id === 'home' ? 0 : idx('home'); }   // ausgeblendeter Eintrag (W1): Fokus auf Start
  function setF(i) { U.cls(R.entries[R.f].ni, 'is-focus', false); R.f = i; U.cls(R.entries[i].ni, 'is-focus', true); }
  /* ◀ von der Inhaltskante: ausklappen, Fokus auf dem aktuellen Eintrag */
  R.open = function (at) {
    if (R.open_ || !R.att) return;
    if (N.input && N.input.swipe) return;            // Nr. 22: ein Finger-Wisch (Pfeil vom Lader) schiebt den Fokus nie in die Seitenleiste
    R.open_ = true; R.rest = false;
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
    if (k === 'RETURN') { R.close(); return true; }   // NAV-5 (Nutzerentscheid 29.10.): nur einklappen – die Leiste gehoert zu keiner RETURN-Kette
    return true;
  };
  /* Zeiger: Eintrag ueber die y-Liste (Hoehe 48) finden.
   * Nach einem Klick auf einen Eintrag ruht die Leiste (R.rest): Der Punkt steht danach noch ueber der Icon-Spalte, und schon das
   * kleinste Weiterbewegen haette sie sofort wieder aufgeklappt (Nutzer-Befund 29.10.: "Einstellungen" unten links blieb offen,
   * Bibliotheken nicht – dort zieht man den Punkt meist gleich nach rechts). Erst wenn der Punkt die Spalte verlassen hat
   * (N.pointer meldet R.away), klappt Darueberfahren sie wieder auf; ein Klick und ◀ wirken immer. */
  R.rest = false;
  R.pointer = function (x, y, kind) {
    var hit = -1;
    for (var i = 0; i < R.entries.length; i++) if (y >= R.entries[i].y && y < R.entries[i].y + 48) { hit = i; break; }
    if (hit < 0) return false;
    if (!R.open_ && R.rest && kind !== 'click') return true;
    if (!R.open_) R.open(hit); else if (hit !== R.f) setF(hit);
    if (kind === 'click') { R.activate(hit); R.rest = true; }
    return true;
  };
  R.away = function () { R.rest = false; };
  /* ---- Finger zieht die Leiste (nur Plattformen mit Touch-Lader, Apple Nr. 24; am TV ruft das nie jemand) ----
   * Rand-Wisch (from 'edge'): das Panel folgt dem Finger live (Lage -TRAVEL + dx, ohne Uebergang), die Abdunklung blendet mit ein.
   * Offene Leiste (from 'open'): Zug nach links schiebt sie live hinaus – bis GANZ aus dem Bild (-NAV_W), dann liegt die Icon-Spalte
   * frei wie bei der eingeklappten Leiste (vorher blieb das Panel bei -TRAVEL als Streifen ueber der Spalte stehen und verschwand
   * erst beim Loslassen: "hakt"). Verstaerkung gain = NAV_W / Fingerlage beim Erkennen: Finger am linken Rand = ganz zu, auch wenn
   * er darueber hinaus geht (Koordinate klemmt bei 0 bzw. keine touchmove mehr). Gemessen ab dem Erkennen (dx0), kein Sprung um
   * die Zitterschwelle des Laders.
   * Loslassen (auch touchcancel = cancel): offen, wenn mindestens OPEN_PART des Wegs erreicht ist oder mit Schwung nach rechts
   * (FLING px/ms, ab FLING_MIN px); sonst zu (Schwung nach links schliesst). Danach gleitet das Panel mit der Restgeschwindigkeit
   * weiter (R.glide: Ease-out-Kurve, deren Anfangssteigung dem Finger-Tempo entspricht) – Oeffnen und Schliessen gleich. Im Frame
   * nur transform/opacity (inline), keine Layout-Abfragen; Uebergang des Compositors (laeuft weiter, auch wenn R.open/R.close
   * den Hauptfaden kurz belegen). Oeffnen/Schliessen selbst ueber R.open/R.close (Fokus wie immer).
   * e: {phase 'start'|'move'|'end', from 'edge'|'open', dx (App-px seit Start), x (Startpunkt, nur 'open'), t (ms), cancel}.
   * Rein rechnend (getestet): R.dragPos, R.dragGain, R.dragEnd, R.dragVel, R.glide. */
  var TRAVEL = 200, NAV_W = 320, OPEN_PART = 0.4, FLING = 0.5, FLING_MIN = 24, GAIN_MAX = 3, VEL_MS = 100, VEL_STALE = 80;
  R.TRAVEL = TRAVEL; R.NAV_W = NAV_W;
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  /* Lage des Panels (translate x: -TRAVEL = Rand-Wisch-Start, 0 = offen, -NAV_W = ganz aus dem Bild) fuer einen Zug; gain nur 'open' */
  R.dragPos = function (from, dx, gain) {
    return clamp(from === 'open' ? dx * (gain || 1) : -TRAVEL + dx, -NAV_W, 0);
  };
  /* Verstaerkung fuer das Schliessen: Finger bei x (App-px, Lage beim Erkennen) -> am linken Rand (x 0) ist das Panel ganz hinaus */
  R.dragGain = function (x) { return x > 0 ? clamp(NAV_W / x, 1, GAIN_MAX) : GAIN_MAX; };
  /* Loslassen: true = offen. pos = Lage, v = Tempo (px/ms, + nach rechts), dist = |dx|, from: 'edge' (oeffnen ab OPEN_PART des
   * Wegs) | 'open' (schliessen ab OPEN_PART des Wegs nach links) */
  R.dragEnd = function (pos, v, dist, from) {
    if (dist >= FLING_MIN && v > FLING) return true;
    if (dist >= FLING_MIN && v < -FLING) return false;
    return from === 'open' ? pos > -TRAVEL * OPEN_PART : pos >= -TRAVEL * (1 - OPEN_PART);
  };
  /* Tempo der Panel-Lage (px/ms) aus den Proben [{t, p}] der letzten VEL_MS; Finger stand vor dem Ende laenger als VEL_STALE: 0 */
  R.dragVel = function (s, tEnd) {
    var n = s.length, b = s[n - 1];
    if (n < 2 || tEnd - b.t > VEL_STALE) return 0;
    var a = b;
    for (var i = n - 1; i >= 0 && b.t - s[i].t <= VEL_MS; i--) a = s[i];
    return b.t > a.t ? (b.p - a.p) / (b.t - a.t) : 0;
  };
  /* Gleiten von from nach to mit Restgeschwindigkeit v (px/ms): {ms, ease}. Dauer nach Weg (GLIDE_MIN..GLIDE_MAX), bei schnellem
   * Finger kuerzer; Kurve cubic-bezier(0.2, y1, 0.2, 1) = Familie von mo.ease (0,0,0.2,1), Anfangssteigung y1/0.2 = Tempo des Fingers
   * (normiert v*ms/Weg, 1..5) -> das Panel setzt beim Loslassen mit dem Finger-Tempo fort, ohne Ruck und ohne Ueberschwingen. */
  var GLIDE_MIN = 160, GLIDE_MAX = 300, GLIDE_FAST = 110, SLOPE_MIN = 1, SLOPE_MAX = 5;
  R.glide = function (from, to, v) {
    var d = Math.abs(to - from);
    if (d < 0.5) return { ms: 0, ease: '' };
    var vt = (to > from ? v : -v) || 0, ms = clamp(140 + d * 0.5, GLIDE_MIN, GLIDE_MAX);
    if (vt > 0 && vt * ms / d > SLOPE_MAX) ms = Math.max(GLIDE_FAST, SLOPE_MAX * d / vt);
    var k = clamp(vt * ms / d, SLOPE_MIN, SLOPE_MAX);
    return { ms: Math.round(ms), ease: 'cubic-bezier(0.2,' + (Math.round(k * 20) / 100) + ',0.2,1)' };
  };
  var drag = null, outT = 0;
  function frame(pos) {   // einziger Schreibweg im Frame: Lage + Abdunklung (nur transform/opacity)
    R.panel.style.webkitTransform = R.panel.style.transform = 'translate3d(' + Math.round(pos) + 'px,0,0)';
    R.dim.style.opacity = String(clamp((pos + TRAVEL) / TRAVEL, 0, 1));
  }
  function paintDrag(pos, first) {
    var ps = R.panel.style, ds = R.dim.style;
    if (first) {                                     // einmal je Zug: ohne Uebergang, sichtbar, Abdunklung als eigene Ebene
      ps.webkitTransition = ps.transition = 'none'; ds.webkitTransition = ds.transition = 'none';
      ps.visibility = 'visible'; ds.visibility = 'visible';
      ds.webkitTransform = ds.transform = 'translate3d(0,0,0)';
    }
    frame(pos);
  }
  function unpaint() {
    var ps = R.panel.style, ds = R.dim.style;
    ps.webkitTransition = ps.transition = ''; ps.webkitTransform = ps.transform = ''; ps.visibility = '';
    ds.webkitTransition = ds.transition = ''; ds.webkitTransform = ds.transform = ''; ds.visibility = ''; ds.opacity = '';
  }
  /* Loslassen: von der Finger-Lage mit Restgeschwindigkeit an die Ziel-Lage gleiten, danach Inline-Werte weg (Klasse .open traegt) */
  function settle(pos, v, open) {
    var to = open ? 0 : -NAV_W, g = N.fx && N.fx.reduced && N.fx.reduced() ? { ms: 0 } : R.glide(pos, to, v);
    if (open) { if (!R.open_) R.open(); } else if (R.open_) R.close();
    if (!g.ms) { unpaint(); return; }
    var ps = R.panel.style, ds = R.dim.style;
    ps.webkitTransition = '-webkit-transform ' + g.ms + 'ms ' + g.ease; ps.transition = 'transform ' + g.ms + 'ms ' + g.ease;
    ds.webkitTransition = ds.transition = 'opacity ' + g.ms + 'ms ' + g.ease;
    ps.visibility = 'visible'; ds.visibility = 'visible';   // zu: Klasse .open fehlt schon -> sonst sofort unsichtbar
    frame(to);
    outT = setTimeout(function () { outT = 0; unpaint(); }, g.ms + 40);
  }
  R.pan = function (e) {
    if (!R.el || !e) return false;
    var dx = e.dx || 0, t = e.t || 0;
    if (e.phase === 'start') {
      if (outT) { clearTimeout(outT); outT = 0; unpaint(); }
      if (!R.att || (e.from === 'open') !== R.open_) { drag = null; return false; }
      var open = e.from === 'open';
      drag = { from: e.from, dx0: open ? dx : 0, gain: open && typeof e.x === 'number' ? R.dragGain(e.x + dx) : 1, s: [] };
    }
    if (!drag) return false;
    var pos = R.dragPos(drag.from, dx - drag.dx0, drag.gain), s = drag.s;
    if (e.phase !== 'end') {
      s.push({ t: t, p: pos }); if (s.length > 24) s.shift();
      paintDrag(pos, e.phase === 'start');
      return true;
    }
    /* Ende oder Abbruch (touchcancel, zweiter Finger): wie Loslassen mit dem letzten Tempo (bis zum Abbruch sah der Finger es so) */
    var v = R.dragVel(s, t), d = drag;
    drag = null;
    settle(pos, v, R.dragEnd(pos, v, Math.abs(dx - d.dx0), d.from));
    return true;
  };
  R.dragging = function () { return !!drag; };
  /* Schalter "Entdecken in der Seitenleiste" wirkt sofort */
  N.evt.on('settings:changed', function (e) { if (e && (e.key === 'discover' || e.key === 'railItems') && R.el) R.build(); });
  /* Weitere Server: Bibliotheken kamen/gingen -> neu aufbauen (nur bei geaenderter Liste; bei offener Leiste erst nach dem Schliessen) */
  var xsig = '[]', xdirty = false;
  N.evt.on('srv:changed', function () {
    var sg = JSON.stringify(N.srv.libs());
    if (sg === xsig) return;
    xsig = sg;
    if (!R.el) return;
    if (R.open_) xdirty = true; else R.build();
  });
  var close0 = R.close;
  R.close = function (silent) { close0(silent); if (xdirty && !R.open_) { xdirty = false; R.build(); } };
  N.ui.rail = R;
})(N);
