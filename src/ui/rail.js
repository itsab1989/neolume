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
    /* flexibel: Icon-Spalte in einem Ausschnitt (flach: rollt ueber dem festen Eintrag "Einstellungen"); am TV direkt wie bisher */
    R.clipI = N.screen && N.screen.flex ? U.el('div', 'rail-clip', R.el, 'position:absolute;left:0;top:0;width:100%') : null;
    R.icons = U.el('div', 'a', R.clipI || R.el, 'left:0;top:0');
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
    var g = R.flat();
    if (g) return { y0: g.y0, step: 56 };            // flach: voller Abstand (zweizeilige Namen haben Luft), die Leiste rollt ohnehin
    return { y0: 112, step: Math.max(48, Math.min(56, Math.floor((628 - 112) / Math.max(1, n)))) };
  };
  /* flache flexible Flaeche (N.screen, Hoehe ohne unteren Rand < 720: Mac-Fenster ab 516, iPhone quer; Nutzerbefunde 03.11.): Eintraege
   * ab y 96, Abstand 56; passen sie nicht ueber die Einstellungen, rollt die ganze Leiste frei (R.sMax, N.ui.freeList - Finger,
   * Trackpad/Rad, der Tasten-Fokus holt seinen Eintrag ins Bild). Am TV und ab 720 Hoehe: null (feste Lagen wie bisher). */
  R.flat = function () {
    var S = N.screen;
    if (!S || !S.flex) return null;
    var h = S.h - S.safe.b - S.safe.t;
    if (h >= 720) return null;
    return { y0: 96, end: 636 + h - 720 - 8, h: h };
  };
  /* Lage der Einstellungen und Rollweite (rein): n Eintraege nach layoutY; TV/hoch: Einstellungen bei 636 (+ H - 720), sMax 0 */
  /* Nutzerentscheidung 03.11.: "Einstellungen" bleibt immer sichtbar (fest unten, set), nur die Eintraege darueber rollen in einem
   * Ausschnitt bis clip (8 ueber den Einstellungen); sMax = Rollweite (letzter Eintrag + 16 Luft). TV/hoch: clip 0, sMax 0. */
  R.geo = function (n) {
    var S = N.screen, L = R.layoutY(n), h = S && S.flex ? S.h - S.safe.b - S.safe.t : 720, base = 636 + (S && S.flex ? h - 720 : 0);
    if (!R.flat()) return { set: base, sMax: 0, clip: 0, top: 0 };
    var end = n ? L.y0 + (n - 1) * L.step + 48 + 16 : 96, clip = base - 8;
    if (end - clip <= 0) return { set: base, sMax: 0, clip: clip, top: 0 };
    // rollt: eigene Baender fuer die Mehr-Pfeile ueber (0..TOP) und unter dem Ausschnitt (clip..set-8), nichts liegt unter ihnen
    clip = base - 8 - ARW;
    return { set: base, sMax: Math.max(0, end - clip), clip: clip, top: ARW };
  };
  /* linker Rand der Spalte in der Flaeche (flexibel: sicherer Rand, iPhone quer mit Notch; TV 0) */
  R.edge = function () { return N.screen && N.screen.flex ? N.screen.safe.l : 0; };
  /* oberer Rand der Eintraege (flexibel: Dynamic Island, iPhone hoch mit offenem Panel; flex.css verschiebt um --st; TV 0) */
  R.top = function () { return N.screen && N.screen.flex ? N.screen.safe.t : 0; };
  function visH() { return N.screen.h - N.screen.safe.b - N.screen.safe.t; }
  R.sy = 0; R.sMax = 0; R.fl = null;
  var ARW = 40;                                     // Band eines Mehr-Pfeils (28 hoch + Luft; Befund K 03.11.: unten zu knapp ueber "Einstellungen")
  R.clip = 0; R.ctop = 0;                           // flach: Ausschnitt der rollenden Eintraege ctop..clip (0 = keiner)
  function scrollSet(p) {
    var y = -Math.round(p * 100) / 100;
    R.sy = p; U.tf(R.icons, 0, y);
    if (R.pin !== R.panel) U.tf(R.pin, 0, y);
    edges();
  }
  /* weicher Verlauf am Rand des Ausschnitts und Mehr-Pfeile (N.ui.more wie in Panels), nur in die Richtung, in die mehr kommt */
  function edges() {
    var u = R.sMax > 0 && R.sy > 0.5, d = R.sMax > 0 && R.sy < R.sMax - 0.5, cs = [R.clipI, R.clipP];
    for (var i = 0; i < cs.length; i++) if (cs[i]) { U.cls(cs[i], 'ft', u); U.cls(cs[i], 'fb', d); }
    if (R.mI) R.mI.set(u, d);
    if (R.mP) R.mP.set(u, d);
  }
  function scrollTo(p) {
    p = Math.max(0, Math.min(R.sMax, p));
    if (R.fl) { R.fl.keys(); R.fl.sync(p); }
    if (p !== R.sy) scrollSet(p);
  }
  /* Eintrag i ins Bild holen (Tasten-Fokus, nur wenn die Leiste rollt; "Einstellungen" steht fest) */
  function reveal(i) {
    if (!(R.sMax > 0) || !R.entries[i] || R.entries[i].fixed) return;
    var e = R.entries[i], h = R.clip || visH(), p = R.sy;
    if (e.y - p < R.ctop + 8) p = e.y - R.ctop - 8; else if (e.y + 48 - p > h - 8) p = e.y + 56 - h;
    scrollTo(p);
  }
  /* Mehr-Pfeil getroffen (y in Leisten-Koordinaten): -1 oben, 1 unten, 0 nein */
  function arrowAt(y) {
    if (!(R.sMax > 0) || !R.mI) return 0;
    if (R.mI.u && y >= 0 && y < R.ctop) return -1;
    if (R.mI.d && y >= R.clip && y < R.clip + ARW) return 1;
    return 0;
  }
  /* Zug/Rad ueber der Spalte bzw. der offenen Leiste (N.router.pan, N.pointer.wheelPx; nur wenn sie rollt) */
  R.scrollPan = function (e) { return !!(R.fl && R.att && R.fl.pan(e)); };
  R.wheel = function (x, y, dy) { return !!(R.fl && R.att && (R.open_ || !R.slim()) && R.fl.wheel(x, y, dy)); };
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
    var mx = R.MAX;
    if (ids.length <= mx) return ids;
    var out = [], n = 0;                            // 'home' bleibt immer (gesperrt), an seiner Stelle
    for (var i = 0; i < ids.length; i++) { if (ids[i] === 'home') out.push(ids[i]); else if (n < mx - 1) { out.push(ids[i]); n++; } }
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
    var gy = R.geo(ids.length), FX = !!N.screen.flex;
    list.push({ id: 'settings', icon: 'gear', t: 'nav.settings', y: gy.set, fixed: FX });   // flexibel: fest unten (ueber dem Home-Indikator), rollt nie mit
    while (R.icons.firstChild) R.icons.removeChild(R.icons.firstChild);
    while (R.panel.firstChild) R.panel.removeChild(R.panel.firstChild);
    if (R.fixRi && R.fixRi.parentNode) R.fixRi.parentNode.removeChild(R.fixRi);
    R.fixRi = null; R.mP = null;
    /* flexibel: Eintraege des Panels in einem Ausschnitt mit eigenem Behaelter (rollt mit der Icon-Spalte); am TV direkt im Panel */
    R.clipP = FX ? U.el('div', 'nav-clip', R.panel, 'position:absolute;left:0;top:0;width:100%') : null;
    R.pin = FX ? U.el('div', 'nav-in', R.clipP, 'position:absolute;left:0;top:0;width:100%;height:0') : R.panel;
    var sep = U.el('div', 'nav-sep', FX ? R.panel : R.pin);
    R.sMax = gy.sMax; R.sy = 0; R.clip = gy.clip; R.ctop = gy.top;
    if (FX) {
      sep.style.top = (gy.set - 12) + 'px'; sep.style.bottom = 'auto';
      U.tf(R.icons, 0, 0);
      // Ausschnitt ctop..clip; der Inhalt behaelt seine Lagen (innen um -ctop verschoben)
      var cl = gy.clip ? (gy.clip - gy.top) + 'px' : '', ov = gy.clip ? 'hidden' : '', ct = gy.top + 'px', it = (-gy.top) + 'px';
      R.clipI.style.height = R.clipP.style.height = cl; R.clipI.style.overflow = R.clipP.style.overflow = ov;
      R.clipI.style.top = R.clipP.style.top = ct; R.icons.style.top = R.pin.style.top = it;
      // Mehr-Pfeile: Icon-Spalte (Mitte x 72) dauerhaft, Panel (Mitte der Beschriftung) je Aufbau; nur flach sichtbar (edges)
      if (!R.mI) { R.mI = N.ui.more(R.el, '', ''); R.el.insertBefore(R.mI.up, R.dim); R.el.insertBefore(R.mI.dn, R.dim); }   // unter Abdunklung und Panel
      R.mI.up.style.cssText = 'left:58px;top:2px'; R.mI.dn.style.cssText = 'left:58px;top:' + (gy.clip + 2) + 'px';   // Band clip..clip+40, Trennlinie bei clip+36, "Einstellungen" ab clip+48
      R.mP = N.ui.more(R.panel, 'left:146px;top:2px', 'left:146px;top:' + (gy.clip + 2) + 'px');
      R.icons.setAttribute('data-scroll', gy.sMax > 0 ? '1' : ''); R.pin.setAttribute('data-scroll', gy.sMax > 0 ? '1' : '');
      if (!R.fl) R.fl = N.ui.freeList({ el: R.icons, set: scrollSet, max: function () { return R.sMax; }, dim: visH,
        hit: function (x) { return R.sMax > 0 && (R.open_ || !R.slim()) && x < (R.open_ ? NAV_W : 112) + R.edge(); } });
      R.fl.reset();
    }
    edges();
    for (i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.id === 'profile') {
        avatar(R.icons, R.profile);
        e.ni = U.el('div', 'ni', R.pin, 'top:' + e.y + 'px');
        avatar(e.ni, R.profile);
        e.lbT = U.txt('div', 'lb', e.ni, R.profile ? R.profile.name : '');
      } else {
        e.ri = U.el('div', 'ri', e.fixed ? R.el : R.icons, 'top:' + e.y + 'px');   // fester Eintrag: ausserhalb des Ausschnitts
        if (e.fixed) { R.fixRi = e.ri; R.el.insertBefore(e.ri, R.dim); }   // unter Abdunklung und Panel wie die Spalte
        U.el('div', 'bar', e.ri);
        N.ui.icon(e.ri, e.icon);
        e.ni = U.el('div', 'ni', e.fixed ? R.panel : R.pin, 'top:' + e.y + 'px');
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
  /* flexible Flaeche, M·F/K (N.screen.nav): keine Icon-Spalte (Leiste nur einblendbar, N.ui.tabbar); TV/R: false */
  R.slim = function () { return !!(N.ui.tabbar && N.ui.tabbar.slim()); };
  /* Eintrag der Seitenleiste zu einer ID (oder null, z. B. ausgeblendet oder Bibliothek verschwunden) */
  R.entry = function (id) { for (var i = 0; i < R.entries.length; i++) if (R.entries[i].id === id) return R.entries[i]; return null; };
  R.isOpen = function () { return R.open_; };
  function idx(id) { for (var i = 0; i < R.entries.length; i++) if (R.entries[i].id === id) return i; return id === 'home' ? 0 : idx('home'); }   // ausgeblendeter Eintrag (W1): Fokus auf Start
  function setF(i) { U.cls(R.entries[R.f].ni, 'is-focus', false); R.f = i; U.cls(R.entries[i].ni, 'is-focus', true); reveal(i); }
  /* ◀ von der Inhaltskante: ausklappen, Fokus auf dem aktuellen Eintrag */
  R.open = function (at) {
    if (R.open_ || !R.att) return;
    if (N.input && N.input.swipe) return;            // Nr. 22: ein Finger-Wisch (Pfeil vom Lader) schiebt den Fokus nie in die Seitenleiste
    R.open_ = true; R.rest = false;
    var scr = N.router.top();
    if (scr && scr.railBlur) scr.railBlur();
    setF(at === undefined ? idx(R.cur) : at);
    // flexibel (Maus/Trackpad, Nutzerbefund 03.11.): nicht ueber N.fx.move – jede Zeigerbewegung schaltet N.fx auf "schnell", dann
    // sprang die Leiste beim Aus- und Einklappen ohne Uebergang (wirkte unruhig, beim Einklappen kurz Reste oben/unten). TV wie bisher.
    if (!(N.screen && N.screen.flex)) N.fx.move(R.panel);
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
    if (R.fl && R.fl.eat(kind)) return true;          // Tipp in den Schwung der rollenden Leiste: nur anhalten
    y -= R.top();                                    // oberer Rand (Dynamic Island; sonst 0)
    var ar = arrowAt(y);
    if (ar && kind === 'click') { scrollTo(R.sy + ar * 56); return true; }   // Mehr-Pfeil: eine Stufe rollen
    hit = R.hitY(y, false);
    /* flexibel (Maus/Trackpad, Nutzerbefund 03.11.: "faehrt manchmal aus, manchmal nicht"): Darueberfahren klappt ueberall in der
     * Spalte auf – auch zwischen zwei Eintraegen und ueber den Pfeil-Baendern (naechster Eintrag); Klick nur auf einem Eintrag.
     * TV (Smart-Control-Zeiger): unveraendert nur ueber einem Eintrag. */
    if (hit < 0 && kind !== 'click' && N.screen && N.screen.flex) hit = R.hitY(y, true);
    else if (ar) return true;                         // Pfeil-Band ohne Eintrag (TV gibt es nicht)
    if (hit < 0) return false;
    if (!R.open_ && R.rest && kind !== 'click') {
      /* flexibel (Befund K 03.11.: "klappt nach einem Klick nicht wieder auf"): Darueberfahren klappt wieder auf, sobald der Zeiger in
       * der Spalte deutlich weiterbewegt wurde (24 px seit dem Klick) – ein Zittern direkt nach dem Klick (Grund fuer R.rest, Befund
       * 29.10.) bleibt ohne Wirkung. TV: wie bisher erst nach Verlassen der Spalte. */
      var rp = R.restAt;
      if (!(N.screen && N.screen.flex && rp && (Math.abs(y - rp.y) >= 24 || Math.abs(x - rp.x) >= 24))) return true;
      R.rest = false;
    }
    if (!R.open_) R.open(hit); else if (hit !== R.f) setF(hit);
    if (kind === 'click') { R.activate(hit); R.rest = true; R.restAt = { x: x, y: y }; }
    return true;
  };
  R.away = function () { R.rest = false; };
  /* Eintrag unter y (Leisten-Koordinaten, ohne oberen Rand): genau (Kasten 48 hoch) oder near = der naechste sichtbare (Mitte);
   * flach zaehlen rollende Eintraege nur im Ausschnitt ctop..clip, "Einstellungen" steht fest. -1 = keiner */
  R.hitY = function (y, near) {
    var best = -1, bd = 1e9;
    for (var i = 0; i < R.entries.length; i++) {
      var en = R.entries[i], py = en.fixed ? y : y + R.sy;
      if (!en.fixed && R.clip && (y >= R.clip || y < R.ctop)) { if (!near) continue; }
      if (!near) { if (py >= en.y && py < en.y + 48) return i; continue; }
      var sy = en.fixed ? en.y : en.y - R.sy;                 // Lage auf dem Bildschirm
      if (!en.fixed && R.clip && (sy + 48 <= R.ctop || sy >= R.clip)) continue;   // weggerollt
      var d = Math.abs(y - (sy + 24));
      if (d < bd) { bd = d; best = i; }
    }
    return near ? best : -1;
  };
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
