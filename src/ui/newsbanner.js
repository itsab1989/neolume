/* N.ui.news – kleiner Hinweis "neu auf deinem Server" (SPEC HOME-13, NAV-10): weich ein- und ausblenden, nie fokussierbar,
 * schluckt keine Taste. Hoechstens einer zugleich; was waehrenddessen dazukommt, wird zusammengefasst und spaeter gezeigt.
 * Wo: nur Bildschirme mit scr.news ('clock' = Startseite rechts unter der Uhr, 'top' = oben rechts, 'player' = Player oben links
 * an der Stelle der Toasts); sonst wartet er (Warteschlange, nach N.newsLogic.STALE verworfen).
 * Wann (N.newsLogic.decide): kein Bildschirmschoner, kein Menue/Dialog/Panel, keine aufgeklappte Leiste, kein Toast, keine
 * Offline-Leiste, >= 1,5 s keine Taste; im Video nur mit "Auch waehrend der Wiedergabe" und nur, wenn keine Insel/kein OSD da ist.
 * Leistung (ARCHITEKTUR Runde 8): EINE dauerhafte, leere Huellen-Ebene #pn-news wechselt die Deckkraft; der Kasten .nb darin ist
 * eine eigene Ebene. Text, Symbol und Lage werden nur gesetzt, solange die Huelle unsichtbar ist. Takt 1 s nur solange etwas
 * wartet oder sichtbar ist (Zahlenvergleiche).
 * Schnittstelle: add(items) (neue Titel, N.newWatch), post({key, icon, head, line}) (fertige Meldung, z. B. Erweiterung; hat
 * Vorrang), Erweiterungspunkt 'news:filter' (items -> gefilterte Liste: was eine Erweiterung selbst meldet, faellt hier weg). */
(function (N) {
  var U = N.util, L = N.newsLogic, B = { el: null };
  var box, ic, hd, ln, hdT, lnT, queue = [], msgs = [], timer = 0, hideT = 0, offT = 0, state = 'off', where = '';
  function settings() { return N.session && N.session.settings || null; }
  function top() { return N.router && N.router.top ? N.router.top() : null; }
  function env() {
    var t = top(), st = N.player && N.player.status ? N.player.status() : null;
    return { saver: !!(N.ui.saver && N.ui.saver.on), screen: t && t.news || '', overlay: !!(N.router.hasOverlay && N.router.hasOverlay()),
      rail: !!(N.ui.rail && N.ui.rail.isOpen && N.ui.rail.isOpen()), toast: !!(N.ui.toast && N.ui.toast.on && N.ui.toast.on()),
      netbar: !!(N.ui.netbar && N.ui.netbar.on && N.ui.netbar.on()), rest: N.idle.restFor(),
      player: st, play: L.play(settings()), settle: N.config.newsSettleMs };
  }
  function arm(ms) { if (!timer) timer = setTimeout(tick, ms || 1000); }
  function tick() {
    timer = 0;
    var now = U.now();
    queue = L.prune(queue, now);
    for (var i = msgs.length - 1; i >= 0; i--) if (now - msgs[i].at > L.STALE) msgs.splice(i, 1);
    if (state !== 'off') {                              // sichtbar: verschwinden, sobald es dort nicht mehr passt (Video-Insel, Menue, anderer Bildschirm)
      var e = env();
      if (state === 'on' && (e.screen !== where || L.decide(U.extend(e, { rest: L.REST })) !== 'show')) B.hide();
      arm();
      return;
    }
    if (!msgs.length && !queue.length) return;
    if (N.config.newsHoldMs && now - first() < N.config.newsHoldMs) { arm(); return; }   // nur Bildtests: erst nach ms zeigen
    if (L.decide(env()) === 'show') show(); else arm();
  }
  function first() { var t = Infinity, i; for (i = 0; i < queue.length; i++) t = Math.min(t, queue[i].at); for (i = 0; i < msgs.length; i++) t = Math.min(t, msgs[i].at); return t; }
  /* naechste Meldung: zuerst fertige Meldungen (z. B. Ankunft einer Anfrage), sonst alle wartenden Titel als EIN Hinweis */
  function next() {
    if (msgs.length) return msgs.shift().m;
    var items = [], i;
    for (i = 0; i < queue.length; i++) items.push(queue[i].it);
    queue = [];
    var f = N.ext.has('news:filter') ? N.ext.call('news:filter', items) : undefined;
    if (f) items = f;
    return L.describe(items, L.mode(settings()));
  }
  function show() {
    var m = next();
    if (!m) { if (N.log) N.log('news: nichts zu zeigen (gefiltert)'); arm(); return; }
    if (N.log) N.log('news zeigt (' + env().screen + '): ' + (m.head ? m.head + ' | ' : '') + (m.line || ''));
    where = env().screen;
    // unsichtbar vorbereiten (Huelle steht auf Deckkraft 0): Lage, Symbol, Text; erst im uebernaechsten Frame einblenden
    U.cls(B.el, 'at-top', where === 'top'); U.cls(B.el, 'at-pl', where === 'player');
    N.ui.setIcon(ic, m.icon || 'info');
    U.setText(hdT, m.head || ''); U.setText(lnT, m.line || '');
    U.cls(box, 'one', !m.head);
    state = 'prep';
    U.raf(function () { U.raf(function () {
      if (state !== 'prep') return;
      state = 'on'; U.cls(B.el, 'on', true);
      hideT = setTimeout(B.hide, N.config.newsShowMs || L.ms(settings()));
    }); });
    arm();
  }
  B.init = function (parent) {
    B.el = U.el('div', '', parent); B.el.id = 'pn-news';           // leere Huelle (eigene Ebene), nur sie blendet
    box = U.el('div', 'nb', B.el); box.setAttribute('data-layout-notice', '');
    ic = N.ui.icon(box, 'info', 's2');
    hd = U.el('div', 'nb-h', box); hdT = document.createTextNode(''); hd.appendChild(hdT);
    ln = U.el('div', 'nb-l', box); lnT = document.createTextNode(''); ln.appendChild(lnT);
  };
  B.add = function (items) { if (!items || !items.length) return; queue = L.merge(queue, items, U.now()); arm(); };
  B.post = function (m) {
    if (!m) return;
    for (var i = msgs.length - 1; i >= 0; i--) if (m.key && msgs[i].m.key === m.key) msgs.splice(i, 1);
    msgs.push({ m: m, at: U.now() }); arm();
  };
  /* ausblenden (weich); danach ggf. der naechste */
  B.hide = function () {
    if (hideT) { clearTimeout(hideT); hideT = 0; }
    if (state === 'off' || state === 'fade') return;
    var was = state;
    state = 'fade'; U.cls(B.el, 'on', false);
    if (offT) clearTimeout(offT);
    offT = setTimeout(function () { offT = 0; state = 'off'; arm(); }, was === 'prep' ? 0 : 450);   // Blende 400 ms
  };
  B.visible = function () { return state === 'on' || state === 'prep'; };
  B.pending = function () { return msgs.length + queue.length; };
  B.clear = function () { queue = []; msgs = []; B.hide(); };
  /* Profil-/Serverwechsel: nichts vom alten Profil zeigen */
  N.evt.on('profile:changed', function () { queue = []; msgs = []; if (B.el) B.hide(); });
  N.ui.news = B;
})(N);
