/* N.ui.saver – eigener Bildschirmschoner (SPEC 7.14) + Uhrzeit im Kopf der Startseite (set.clock) + Ausloeser der
 * Willkommenskarte (SPEC 7.16.5). Ein einziger 1-s-Takt, der nur Zahlen vergleicht; DOM-Arbeit nur bei Aenderung.
 * - Faellig nach "Bildschirmschoner nach" (Aus/1/2/5/10/15/30 Min., Standard 5) ohne Taste/Zeiger; nie waehrend ein Video laeuft,
 *   in der Pause fruehestens nach 10 Min. mit "Pausiert · Serie S1 · F5".
 * - Bilder: "Schoner-Bilder aus" Bibliotheken (N.saverLib, Standard) oder Startseite (Home-Cache, 0 Anfragen); nur Titel mit
 *   echter Art, 1280x720 blur=8 quality=95 (Einstellung "Schoner-Bilder unscharf" aus: scharf). Ohne Profil nur die Uhr.
 * - Bildwechsel alle 10/20/30/60 s mit Uebergang (N.saverLogic.fx). Aufbau, alles nur waehrend der Schoner sichtbar ist:
 *   zwei gestapelte Bild-Ebenen (.scs-l Huelle: Clip + Vorhang, .scs-in: GPU-Ebene mit Bild + Abdunklung 0,35), oben der Info-Block
 *   (.scs-ov: Abdunklung scrim-saver.png + Uhr/Titel/Zeile, eine Ebene). Das naechste Bild laedt in die HINTERE Ebene (unter der
 *   deckenden vorderen) und wird dort gezeichnet (= dekodiert), BEVOR der Uebergang startet; animiert werden nur opacity und
 *   -webkit-transform. Jalousie/Kacheln: 8 bzw. 12 Teil-Ebenen mit demselben Bild als Hintergrund, nur waehrend des Uebergangs.
 * - Info-Block wechselt die Ecke nur zusammen mit dem Bild (ausblenden, Ecke, einblenden) – gegen Einbrennen.
 * - Jede Taste und jeder Zeiger-Klick beendet ihn OHNE die normale Funktion (App.onKey fragt saver.key zuerst). */
(function (N) {
  var U = N.util, C = N.comfort, SL = N.saverLogic, TICK = 1000, SAVER_BLUR = 8, SAVER_Q = 95;   // weicher Schoner (s. url)
  var ID = 'translate3d(0,0,0)', OV_FADE = 400, SETTLE = 150, TILE_SETTLE = 400;
  var S = { on: false }, root = null, timer = 0, lastAct = 0, lastMin = '', homeT0 = 0;
  var hc, hcT, el, ov, scr, ck, ti, sb, tilesEl = null, tiles = [], Ls = [], f = 0;
  var kind = '', gen = 0, cyc = 0, nextAt = 0, ready = null, busy = false, loading = false, fails = 0, lastFx = '', lastDur = 0;
  var homeItems = [], bag = null, noArt = false, force = null;

  function now() { return U.now(); }
  function settings() { return N.session && N.session.settings || null; }
  function setting(k, d) { var s = settings(); return s && s[k] !== undefined && s[k] !== null ? s[k] : d; }
  function clockOn() { var s = settings(); return !(s && s.clock === false); }
  function minutes() {
    var s = settings();
    if (!N.session || !N.session.profile) return 5;                  // Anmeldung/Profilwahl: Standard (nur Uhr)
    return s && s.screensaver !== undefined ? Number(s.screensaver) || 0 : 5;
  }
  function clockText() { return C.clock(N.clock.date(), N.config.fixedClock); }   // korrigierte Wanduhr (core/clock.js)
  function act() { lastAct = now(); }
  function rnd() { return N.config.fixedClock ? 0 : Math.random(); }   // Tests: feste Ecke/Bildfolge
  function interval() { return force ? 600000 : SL.interval(setting('saverInterval', 30)); }
  /* Stil-Helfer (nur -webkit-, wie im ganzen Projekt) */
  function tr(e, v) { e.style.webkitTransition = v; }
  function tf(e, v) { e.style.webkitTransform = v; }
  function op(e, v) { e.style.opacity = v; }
  /* Uebergang einer Ebene setzen, ohne ihren laufenden Ken-Burns-Zoom (l.kb) abzubrechen */
  function trL(l, v) { tr(l.inn, l.kb ? l.kb + (v ? ', ' + v : '') : v || 'none'); }
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
    for (var i = 0; i < 2; i++) {
      var w = U.el('div', 'scs-l', el), inn = U.el('div', 'scs-in', w), im = U.el('img', 'scs-img', inn);
      im.src = N.img.BLANK; U.el('div', 'scs-dim', inn);
      Ls.push({ w: w, inn: inn, img: im, kb: '' });
    }
    tilesEl = U.el('div', 'scs-tiles', el, 'display:none');   // Jalousie/Kacheln: Teile erst bei Bedarf
    ov = U.el('div', 'scs-ov', el);
    scr = U.el('img', 'scs-scr', ov); scr.src = N.img.BLANK;
    var blk = U.el('div', 'scs-blk', ov);
    ck = U.txt('div', 'scs-ck', blk, ''); ti = U.txt('div', 'scs-ti ell', blk, ''); sb = U.txt('div', 'scs-sb ell', blk, '');
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
      if (t !== lastMin) { lastMin = t; U.setText(hcT, t); if (S.on && SL.infoParts(setting('saverInfo', 'ambient'), clockOn()).clock) U.setText(ck, t); }
      var top = N.router.topName();
      U.show(hc, !S.on && top === 'home' && !!(N.session && N.session.profile) && clockOn());
      if (S.on) { due(); return; }
      var ps = playerState();
      var d = N.config.saverMs ? !ps.playing && rest() >= N.config.saverMs : C.saverDue(rest(), minutes(), ps);   // saverMs: nur visuelle Tests
      if (d && minutes() > 0) { S.start(ps); return; }
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

  /* ---------- Bildquelle ---------- */
  function homeNext() {
    if (!homeItems.length) return null;
    if (!bag) bag = new SL.Bag(homeItems.length, rnd);
    return homeItems[bag.next()];
  }
  /* cb({art, title, sub}|null) */
  function nextItem(cb) {
    if (kind === 'paused') { cb(homeItems[0] || null); return; }
    if (setting('saverSrc', 'libs') === 'libs' && N.saverLib) {
      N.saverLib.next(function (it) { cb(it ? { art: it.art, title: it.title || '', sub: SL.meta(it) } : homeNext()); });
      return;
    }
    cb(homeNext());
  }
  function url(x) {
    // F21: weich oder scharf (beide 1280x720 wie der Hero, ohne Skalierung). TV 27.10. nachmittags: 640x360 blur 24 gestreckt war ein
    // unkenntlicher Farbbrei mit JPEG-Bloecken -> nativ, blur 8 (ruhig, Motiv erkennbar), quality 95 (Block-Kennzahl 2,38 -> 1,15; ~150 KB)
    var sharp = settings() && settings().saverBlur === false;
    return sharp ? N.img.url(x.art, 'hero') : N.img.url(x.art, 'hero', { blur: SAVER_BLUR, quality: SAVER_Q });
  }

  /* ---------- Ablauf: laden (hintere Ebene) -> zeichnen lassen -> Uebergang -> tauschen -> naechstes laden ---------- */
  function front() { return Ls[f]; }
  function back() { return Ls[1 - f]; }
  /* Ebene in Ruhe: keine Uebergaenge, keine Verschiebung, deckend */
  function rest0(l) {
    l.kb = '';
    tr(l.inn, 'none'); tf(l.inn, ID); op(l.inn, 1);
    tr(l.w, 'none'); tf(l.w, ID);
  }
  function later(ms, fn) { var g = gen; setTimeout(function () { if (g === gen && S.on) fn(); }, ms); }
  /* zwei Frames + Pause: WebKit hat das Bild der hinteren Ebene sicher dekodiert und gezeichnet */
  function settle(ms, fn) { var g = gen; U.raf(function () { U.raf(function () { setTimeout(function () { if (g === gen && S.on) fn(); }, ms); }); }); }
  function prepare() {
    if (loading || ready || !S.on || noArt) return;
    loading = true;
    var g = gen;
    nextItem(function (x) {
      if (g !== gen) return;
      if (!x || !x.art) { loading = false; noArt = true; nextAt = Math.max(nextAt, now() + interval()); return; }   // keine Bilder: nur Uhr/Info-Block
      var b = back(), u = url(x);
      rest0(b); b.w.style.zIndex = 1;
      N.img.want(b.img, u, 0, function (ok) {
        if (g !== gen) return;
        if (!ok) { loading = false; if (++fails < 5) later(2000, prepare); return; }
        fails = 0;
        settle(SETTLE, function () { loading = false; ready = { x: x, url: u }; if (now() >= nextAt) run(); });
      });
    });
  }
  function due() {
    if (busy || now() < nextAt) return;
    if (ready) { run(); return; }
    if (loading) return;                                  // Bild kommt gleich (danach sofort der Uebergang)
    nextAt = now() + interval(); moveInfo(false, null);   // kein Bild (nur Uhr, Pause, Ladefehler): Info-Block wandert trotzdem
    if (kind === 'art' && !noArt) { fails = 0; prepare(); }
  }
  /* ---------- Uebergaenge: stage (Startzustand, Ebene noch verdeckt) -> go (Animation) -> Dauer ---------- */
  function ms(fx) { return SL.FX_MS[fx]; }
  var FXS = {
    cut: { go: function () { return 0; } },
    fade: { go: function (F, B, d) { trL(F, 'opacity ' + d + 'ms ease-in-out'); op(F.inn, 0); return d; } },
    dip: {                                                // ueber Schwarz: alt aus, dann neu ein (immer nur EINE Ebene halbtransparent)
      stage: function (F, B) { tr(B.inn, 'none'); op(B.inn, 0); },
      go: function (F, B, d) {
        var h = Math.round(d / 2);
        trL(F, 'opacity ' + h + 'ms ease-in'); op(F.inn, 0);
        tr(B.inn, 'opacity ' + h + 'ms ease-out ' + h + 'ms'); op(B.inn, 1);
        return d;
      }
    },
    zoom: kenBurns('zoom'), drift: kenBurns('drift'),
    fly: {                                                // Zoom-Durchflug: alt waechst und blendet aus, neu kommt aus 110 %
      stage: function (F, B) { tf(B.inn, 'translate3d(0,0,0) scale(1.1)'); },
      go: function (F, B, d) {
        F.kb = '';
        tr(F.inn, 'opacity ' + d + 'ms ease-in, -webkit-transform ' + d + 'ms ease-in'); op(F.inn, 0); tf(F.inn, 'translate3d(0,0,0) scale(1.15)');
        tr(B.inn, '-webkit-transform ' + d + 'ms ease-out'); tf(B.inn, ID);
        return d;
      }
    },
    curtain: {                                            // Vorhang: Huelle faehrt herein, Inhalt gegenlaeufig -> Bild steht, Kante wandert
      stage: function (F, B) {
        var x = cyc % 2 ? -1280 : 1280;
        B.w.style.zIndex = 3; tf(B.w, 'translate3d(' + x + 'px,0,0)'); tf(B.inn, 'translate3d(' + (-x) + 'px,0,0)');
      },
      go: function (F, B, d) {
        var t = '-webkit-transform ' + d + 'ms ease-in-out';
        tr(B.w, t); tr(B.inn, t); tf(B.w, ID); tf(B.inn, ID);
        return d;
      }
    },
    blinds: parts(8, 1, true), tiles: parts(4, 3, false)
  };
  /* Langsamer Zoom / Gleiten: neue Ebene bewegt sich ueber den ganzen Takt (linear), Wechsel = Ueberblenden */
  function kenBurns(k) {
    return {
      stage: function (F, B) { B.pose = SL.pose(k, cyc); tf(B.inn, B.pose.from); },
      go: function (F, B, d) {
        trL(F, 'opacity ' + d + 'ms ease-in-out'); op(F.inn, 0);
        B.kb = '-webkit-transform ' + (interval() + d + 2000) + 'ms linear';
        tr(B.inn, B.kb); tf(B.inn, B.pose.to);
        return d;
      }
    };
  }
  /* Jalousie (cols x 1, von links) bzw. Kacheln (4 x 3, zufaellig): Teile mit dem neuen Bild als Hintergrund (derselbe Cache-Eintrag
   * wie das <img> der hinteren Ebene) liegen erst UNTER der vorderen Ebene (gezeichnet), springen dann unsichtbar (opacity 0) nach
   * oben und blenden versetzt ein. Danach zeigt die hintere Ebene dasselbe Bild und die Teile verschwinden (display:none). */
  function parts(cols, rows, ordered) {
    var n = cols * rows, w = 1280 / cols, h = 720 / rows, PART = 600;
    return {
      settle: TILE_SETTLE,
      stage: function (F, B, u) {
        while (tiles.length < n) { var t = U.el('div', 'scs-tile', tilesEl); U.el('i', '', t); tiles.push(t); }
        for (var i = 0; i < tiles.length; i++) {
          var e = tiles[i], st = e.style;
          if (i >= n) { st.display = 'none'; continue; }
          var x = (i % cols) * w, y = Math.floor(i / cols) * h;
          st.display = ''; st.left = x + 'px'; st.top = y + 'px'; st.width = w + 'px'; st.height = h + 'px';
          st.backgroundImage = 'url("' + u + '")'; st.backgroundPosition = (-x) + 'px ' + (-y) + 'px';
          tr(e, 'none'); op(e, 1);
        }
        tilesEl.style.zIndex = 1; tilesEl.style.display = '';
      },
      go: function (F, B, d) {
        var del = SL.delays(n, Math.round((d - PART) / Math.max(1, n - 1)), ordered, rnd), i;
        tilesEl.style.zIndex = 3;
        for (i = 0; i < n; i++) op(tiles[i], 0);
        if (tilesEl.offsetWidth < 0) return 0;            // Stil jetzt anwenden (nur die Teile), sonst beginnt der Uebergang nicht bei 0
        for (i = 0; i < n; i++) { tr(tiles[i], 'opacity ' + PART + 'ms ease-out ' + del[i] + 'ms'); op(tiles[i], 1); }
        return d;
      }
    };
  }
  function run() {
    var r = ready;
    ready = null; busy = true; cyc++;
    var fx = force || SL.fx(setting('saverFx', 'fade'), N.fx.reduced(), rnd, lastFx), D = FXS[fx], F = front(), B = back();
    lastFx = fx;
    nextAt = now() + interval();
    if (D.stage) D.stage(F, B, r.url);
    settle(D.settle || 30, function () {
      var d = D.go(F, B, ms(fx));
      lastDur = d;
      moveInfo(fx === 'cut', r.x);
      if (d) later(d + 100, swap); else swap();
    });
  }
  /* neue Ebene wird die vordere; die alte (unsichtbar unter ihr) kommt in Ruhe */
  function swap() {
    var old = front();
    f = 1 - f;
    var nw = front();
    nw.w.style.zIndex = 2; tr(nw.w, 'none'); tf(nw.w, ID);
    old.w.style.zIndex = 1; rest0(old); N.img.drop(old.img);
    if (tilesEl && tilesEl.style.display !== 'none') { tilesEl.style.display = 'none'; for (var i = 0; i < tiles.length; i++) tiles[i].style.backgroundImage = 'none'; }
    busy = false;
    if (kind !== 'paused') prepare();
  }
  /* Info-Block: Text + Ecke; weich (ausblenden, umsetzen, einblenden) oder hart (Schnitt) */
  /* Einblendung (saverInfo): Stil-Klasse, Groesse, Abdunklung und Lage aus N.saverLogic.info; nur bei Aenderung ins DOM */
  var ovSig = '';
  function place() {
    var c = SL.info(setting('saverInfo', 'ambient'), cyc), sig = c.style + c.r + c.t;
    if (sig !== ovSig) {
      ovSig = sig;
      ov.className = 'scs-ov st-' + c.style + (c.r ? ' r' : '') + (c.t ? ' t' : '');
      ov.style.width = c.w + 'px'; ov.style.height = c.h + 'px';
      var u = c.scr ? N.assetBase + c.scr : N.img.BLANK;
      if (scr.src !== u) scr.src = u;
      U.show(scr, !!c.scr);
    }
    tf(ov, 'translate3d(' + c.x + 'px,' + c.y + 'px,0)');
  }
  function setInfo(x) {
    var p = SL.infoParts(setting('saverInfo', 'ambient'), clockOn());
    U.setText(ck, p.clock ? clockText() : ''); U.show(ck.parentNode, p.clock);   // ck/ti/sb sind Textknoten (nodeValue)
    U.show(ti.parentNode, p.title); U.show(sb.parentNode, p.title);
    if (x) { U.setText(ti, x.title || ''); U.setText(sb, x.sub || ''); }
    U.show(ov, p.any);
  }
  function moveInfo(hard, x) {
    if (hard) { place(); setInfo(x); return; }
    if (!x) cyc++;
    tr(ov, 'opacity ' + OV_FADE + 'ms ease-in-out'); op(ov, 0);
    later(OV_FADE + 50, function () { place(); setInfo(x); op(ov, 1); });
  }
  S.start = function (ps) {
    var prof = N.session && N.session.profile;
    gen++;
    kind = !prof ? 'clock' : ps && ps.paused ? 'paused' : 'art';
    homeItems = kind === 'art' ? C.saverItems(N.session.homeCache()) : [];
    bag = null; noArt = kind === 'clock'; ready = null; busy = false; loading = false; fails = 0; lastFx = '';
    if (kind === 'paused') {
      var it = ps.item || {};
      homeItems = [{ art: it.art || '', title: C.pausedText(it), sub: '' }];   // ohne Art kein Bild (kein Poster-Ersatz)
    }
    S.on = true; f = 0; cyc = N.config.fixedClock ? -1 : Math.floor(Math.random() * 4);   // run() zaehlt vor dem 1. Bild hoch (Tests: Ecke 0)
    rest0(Ls[0]); rest0(Ls[1]); Ls[0].w.style.zIndex = 2; Ls[1].w.style.zIndex = 1;
    ovSig = ''; tr(ov, 'none'); op(ov, 1); place();
    U.show(hc, false);
    U.setText(ti, ''); U.setText(sb, ''); setInfo(null);
    U.show(el, true);
    nextAt = 0;                                           // erstes Bild: sobald es da ist (aus Schwarz)
    if (!noArt) prepare(); else nextAt = now() + interval();
    N.log('Bildschirmschoner an (' + kind + ')');
  };
  S.stop = function () {
    if (!S.on) return;
    S.on = false; gen++; act();
    U.show(el, false);
    for (var i = 0; i < 2; i++) { rest0(Ls[i]); N.img.drop(Ls[i].img); }
    if (tilesEl) tilesEl.style.display = 'none';
    if (N.saverLib) N.saverLib.abort();
    homeItems = []; ready = null; busy = false; loading = false; force = null;
    N.log('Bildschirmschoner aus');
  };
  S._tick = tick;
  /* Messlauf (dev/bench.js 'saver-<fx>'): Schoner mit festem Uebergang starten; cb(go) sobald das 2. Bild bereit liegt,
   * go() startet den Uebergang sofort und liefert seine Dauer (ms) */
  S.bench = function (fx, cb) {
    S.stop(); S.start({}); force = fx;
    var g = gen, t0 = now();
    (function poll() {
      if (g !== gen || !S.on) return;
      if (ready && !busy && lastFx) { cb(function () { nextAt = 0; run(); return lastDur || ms(fx); }); return; }
      if (now() - t0 > 20000) { cb(null); return; }
      setTimeout(poll, 200);
    })();
  };
  N.ui.saver = S;
})(N);
