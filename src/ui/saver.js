/* N.ui.saver – eigener Bildschirmschoner (SPEC 7.14) + Uhrzeit im Kopf der Startseite (set.clock) + Ausloeser der
 * Willkommenskarte (SPEC 7.16.5). Ein einziger 1-s-Takt, der nur Zahlen vergleicht; DOM-Arbeit nur bei Aenderung:
 * Uhr 1x pro Minute, Schoner-Bild + Insel-Ecke alle 30 s (harter Wechsel, keine Animation grosser Flaechen).
 * - Faellig nach "Bildschirmschoner nach" (Aus/5/10/15/30 Min., Standard 5) ohne Taste/Zeiger; nie waehrend ein Video laeuft,
 *   in der Pause fruehestens nach 10 Min. mit "Pausiert · Serie S1 · F5".
 * - Bilder aus dem Home-Cache des aktiven Profils (0 Anfragen ausser den Bildern; nur Titel mit echter Art,
 *   1280x720 blur=8 quality=95; Einstellung "Schoner-Bilder unscharf" aus: 1280x720 scharf); ohne Profil
 *   (Anmeldung/Profilwahl) nur die Uhr.
 * - Jede Taste und jeder Zeiger-Klick beendet ihn OHNE die normale Funktion (App.onKey fragt saver.key zuerst). */
(function (N) {
  var U = N.util, C = N.comfort, TICK = 1000, SAVER_BLUR = 8, SAVER_Q = 95;   // weicher Schoner (s. cycle)
  var S = { on: false }, root = null, timer = 0, lastAct = 0, lastMin = '', homeT0 = 0;
  var hc, hcT, el, img, isl, ck, ti, sb, kind = '', items = [], idx = -1, cyc = 0, nextAt = 0;

  function now() { return U.now(); }
  function settings() { return N.session && N.session.settings || null; }
  function clockOn() { var s = settings(); return !(s && s.clock === false); }
  function minutes() {
    var s = settings();
    if (!N.session || !N.session.profile) return 5;                  // Anmeldung/Profilwahl: Standard (nur Uhr)
    return s && s.screensaver !== undefined ? Number(s.screensaver) || 0 : 5;
  }
  function clockText() { return C.clock(N.clock.date(), N.config.fixedClock); }   // korrigierte Wanduhr (core/clock.js)
  function act() { lastAct = now(); }
  /* Zeiger: beendet den Schoner und wird geschluckt (Capture-Phase am #root, vor N.pointer) */
  function onPointer(e) {
    if (N.pointer && N.pointer.enabled && !N.pointer.enabled()) return;   // Zeiger-Steuerung aus: Zeiger wirkt nirgends (auch nicht hier)
    act();
    if (!S.on) return;
    if (e.type === 'mousemove') return;                              // nur Bewegung: Schoner bleibt bis zum Klick/zur Taste
    S.stop();
    if (e.stopPropagation) e.stopPropagation();
    if (e.preventDefault) e.preventDefault();
  }
  S.init = function (rootEl, chrome) {
    root = rootEl;
    hc = U.el('div', 'hclock', chrome, 'display:none'); hcT = document.createTextNode(''); hc.appendChild(hcT);
    el = U.el('div', 'scs', root, 'display:none');
    img = U.el('img', 'scs-img', el); img.src = N.img.BLANK;
    U.el('div', 'scs-dim', el);
    isl = U.el('div', 'scs-isl', el);
    ck = U.txt('div', 'scs-ck', isl, ''); ti = U.txt('div', 'scs-ti ell', isl, ''); sb = U.txt('div', 'scs-sb ell', isl, '');
    if (root.addEventListener) {
      root.addEventListener('mousedown', onPointer, true); root.addEventListener('click', onPointer, true);
      root.addEventListener('mousemove', onPointer, true); root.addEventListener('mousewheel', onPointer, true);
    }
    lastAct = now();
    if (!timer) timer = setInterval(tick, TICK);
  };
  /* App.onKey: true = Taste geschluckt (Schoner war an) */
  S.key = function () { act(); if (!S.on) return false; S.stop(); return true; };
  function rest() { var k = N.idle ? N.idle.lastKey() : 0; return now() - Math.max(k, lastAct); }
  function playerState() {
    var st = N.router.topName() === 'player' && N.player && N.player.status ? N.player.status() : null;
    return { playing: !!(st && st.active && !st.paused), paused: !!(st && st.active && st.paused), item: st ? st.item : null };
  }
  function tick() {
    try {
      var t = clockText();
      if (t !== lastMin) { lastMin = t; U.setText(hcT, t); if (S.on) U.setText(ck, clockOn() ? t : ''); }
      var top = N.router.topName();
      U.show(hc, !S.on && top === 'home' && !!(N.session && N.session.profile) && clockOn());
      if (S.on) { if (now() >= nextAt) cycle(); return; }
      var ps = playerState();
      var due = N.config.saverMs ? !ps.playing && rest() >= N.config.saverMs : C.saverDue(rest(), minutes(), ps);   // saverMs: nur visuelle Tests
      if (due && minutes() > 0) { S.start(ps); return; }
      welcomeCheck(top);
    } catch (e) { if (N.diag) N.diag.error('saver tick', e); }
  }
  /* Willkommenskarte einmal je Profil, 1,5 s nachdem die Startseite ruhig sichtbar ist */
  function welcomeCheck(top) {
    var s = settings();
    if (top !== 'home' || !s || s.welcomed || N.config.welcome === false || N.router.hasOverlay() || (N.ui.rail && N.ui.rail.isOpen())) { homeT0 = 0; return; }
    if (!homeT0) { homeT0 = now(); return; }
    if (now() - homeT0 < 1500 || rest() < 1500) return;
    homeT0 = 0;
    if (N.helpUi) N.helpUi.welcome(true);
  }
  S.start = function (ps) {
    var prof = N.session && N.session.profile;
    kind = !prof ? 'clock' : ps && ps.paused ? 'paused' : 'art';
    items = kind === 'art' ? C.saverItems(N.session.homeCache()) : [];
    if (kind === 'art' && !items.length) kind = 'clock';
    if (kind === 'paused') {
      var it = ps.item || {};
      items = [{ art: it.art || '', title: C.pausedText(it), sub: '' }];   // ohne Art kein Bild (kein Poster-Ersatz)
    }
    S.on = true; idx = -1; cyc = N.config.fixedClock ? -1 : Math.floor(Math.random() * 4);   // Tests: feste Ecke/Bildfolge
    U.show(hc, false);
    U.setText(ck, clockOn() ? clockText() : '');
    U.show(el, true);
    cycle();
    N.log('Bildschirmschoner an (' + kind + ')');
  };
  /* alle 30 s: neues Bild (hart), Insel in die naechste Ecke */
  function cycle() {
    nextAt = now() + C.CYCLE_MS;
    cyc = (cyc + 1) % 4;
    var p = C.corner(cyc);
    isl.style.left = p[0] + 'px'; isl.style.top = p[1] + 'px';
    U.setText(ck, clockOn() ? clockText() : '');
    if (!items.length) { U.setText(ti, ''); U.setText(sb, ''); N.img.drop(img); return; }
    idx = kind === 'paused' ? 0 : C.nextIndex(items.length, idx, N.config.fixedClock ? 0 : undefined);
    var x = items[idx];
    U.setText(ti, x.title); U.setText(sb, x.sub || '');
    // F21: weich oder scharf (beide 1280x720 wie der Hero, ohne Skalierung). TV 27.10. nachmittags: 640x360 blur 24 gestreckt war ein
    // unkenntlicher Farbbrei mit JPEG-Bloecken -> nativ, blur 8 (ruhig, Motiv erkennbar), quality 95 (Block-Kennzahl 2,38 -> 1,15; ~150 KB)
    var sharp = settings() && settings().saverBlur === false;
    if (x.art) N.img.want(img, sharp ? N.img.url(x.art, 'hero') : N.img.url(x.art, 'hero', { blur: SAVER_BLUR, quality: SAVER_Q }), 0); else N.img.drop(img);
  }
  S.stop = function () {
    if (!S.on) return;
    S.on = false; act();
    U.show(el, false);
    N.img.drop(img); items = [];
    N.log('Bildschirmschoner aus');
  };
  S._tick = tick;
  N.ui.saver = S;
})(N);
