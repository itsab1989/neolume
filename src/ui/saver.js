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
 *   -webkit-transform. Jalousie/Kacheln: 8 bzw. 6 Teil-Ebenen mit demselben Bild als Hintergrund (einmal angelegt, sonst unsichtbar).
 * - Info-Block wechselt die Ecke nur zusammen mit dem Bild (ausblenden, Ecke, mit dem neuen Bild einblenden) – gegen Einbrennen.
 * - Jede Taste und jeder Zeiger-Klick beendet ihn OHNE die normale Funktion (App.onKey fragt saver.key zuerst). */
(function (N) {
  var U = N.util, C = N.comfort, SL = N.saverLogic, TICK = 1000, SAVER_BLUR = 8, SAVER_Q = 95;   // weicher Schoner (s. url)
  var ID = 'translate3d(0,0,0)', OV_FADE = 400, SETTLE = 150, TILE_SETTLE = 400, INFO_SETTLE = 100, CLEAN_MS = 400, PREP_MS = 1500;
  var S = { on: false }, root = null, timer = 0, lastAct = 0, lastMin = '', homeT0 = 0;
  var blk, hc, hcT, hcS, hcD, hcSt = '', hcDay = '', el, ov, scr, ck, ti, sb, tilesEl = null, tiles = [], Ls = [], f = 0;
  var kind = '', gen = 0, cyc = 0, nextAt = 0, ready = null, busy = false, loading = false, fails = 0, lastFx = '', lastDur = 0;
  var homeItems = [], bag = null, noArt = false, force = null, onGo = null;

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
  /* Datum zur Uhr ("Mi., 28. Okt."); Bildtests mit fester Uhr: festes Datum (28.10.2026) */
  function dateText() { return N.fmt.dateShort(N.config.fixedClock ? new Date(2026, 9, 28, 12) : N.clock.date()); }
  function hcStyle() {
    var st = C.clockStyle(settings());
    if (st === hcSt) return;
    hcSt = st; hc.className = 'hclock cs-' + st;
    /* je Stil ein eigener, auf seinen Text abgestimmter Schatten (TV-Test 28.10.); Kasten: kein Schatten-Bild laden */
    var u = st === 'box' ? N.img.BLANK : N.assetBase + (st === 'free' ? 'scrim-clock.png' : 'scrim-clock-' + st + '.png');
    if (hcS.src !== u) hcS.src = u;
  }
  function hcDate() { if (hcSt !== 'date') return; var d = dateText(); if (d !== hcDay) { hcDay = d; U.setText(hcD, d); } }
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
  var swallowT = 0;                                                  // Klick, dessen mousedown den Schoner beendet hat
  function swallow(e) { if (e.stopPropagation) e.stopPropagation(); if (e.preventDefault) e.preventDefault(); }
  function onPointer(e) {
    if (N.pointer && N.pointer.enabled && !N.pointer.enabled()) return;   // Zeiger-Steuerung aus: Zeiger wirkt nirgends (auch nicht hier)
    act();
    // Review 1.0.5: der click NACH dem beendenden mousedown darf nicht den Titel unter dem Zeiger oeffnen/abspielen
    if (!S.on && e.type === 'click' && swallowT && now() - swallowT < 1000) { swallowT = 0; swallow(e); return; }
    if (!S.on) return;
    if (e.type === 'mousemove') { swallow(e); return; }               // nur Bewegung: Schoner bleibt; dahinter nichts fokussieren/rollen
    if (e.type === 'mousedown') swallowT = now();
    S.stop();
    swallow(e);
  }
  N.evt.on('settings:changed', function (e) { if (hc && e && e.key === 'clockStyle') { hcStyle(); hcDay = ''; hcDate(); } });
  N.evt.on('profile:changed', function () { if (hc) { hcStyle(); hcDay = ''; hcDate(); } });
  S.relabel = function () { if (hc) { hcDay = ''; hcDate(); } };   // Sprachwechsel: Datum neu
  S.init = function (rootEl, chrome) {
    root = rootEl;
    /* Uhr der Startseite: Stil aus "Uhr auf der Startseite" (settings.clockStyle, N.comfort.CLOCK_STYLES). Freie Stile liegen auf
     * einem eigenen, sehr weichen Eckschatten (scrim-clock[-date|-small].png, je Stil) – kein Kasten, trotzdem auf hellen Bildern lesbar. */
    hc = U.el('div', 'hclock', chrome, 'display:none');
    hcS = U.el('img', 'hc-scr', hc); hcS.src = N.img.BLANK;
    hcT = U.txt('div', 'hc-t', hc, ''); hcD = U.txt('div', 'hc-d', hc, '');
    hcStyle(); hcDate();
    el = U.el('div', 'scs', root, 'display:none');
    for (var i = 0; i < 2; i++) {
      var w = U.el('div', 'scs-l', el), inn = U.el('div', 'scs-in', w), im = U.el('img', 'scs-img', inn);
      im.src = N.img.BLANK; U.el('div', 'scs-dim', inn);
      var pst = U.el('img', 'scs-pst', inn, 'display:none'); pst.src = N.img.BLANK;   // "Poster und Cover": Plakat scharf ueber dem Grund
      Ls.push({ w: w, inn: inn, img: im, pst: pst, kb: '', pm: false });
    }
    tilesEl = U.el('div', 'scs-tiles', el, 'display:none');   // Jalousie/Kacheln: Teile erst bei Bedarf
    ov = U.el('div', 'scs-ov', el);
    scr = U.el('img', 'scs-scr', ov); scr.src = N.img.BLANK;
    blk = U.el('div', 'scs-blk', ov);
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
      if (t !== lastMin) { lastMin = t; U.setText(hcT, t); hcDate(); if (S.on && SL.infoParts(setting('saverInfo', 'ambient'), clockOn()).clock) U.setText(ck, t); }
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
  function pics() { return SL.pics(setting('saverPics', 'art')); }
  /* naechster Titel der Quelle: cb({art, thumb, sq, title, sub}|null) */
  function srcNext(cb) {
    if (setting('saverSrc', 'libs') === 'libs' && N.saverLib) {
      N.saverLib.next(function (it) { cb(it ? { art: it.art, thumb: it.thumb || '', sq: SL.square(it), title: it.title || '', sub: SL.meta(it) } : homeNext()); });
      return;
    }
    cb(homeNext());
  }
  /* Einstellung "Bilder im Bildschirmschoner" (SPEC SAV-5): Poster -> Plakat-Bild (pm); Nur echte Hintergrundbilder -> Standbilder
   * (N.saverArt) ueberspringen. Hoechstens MAX_SKIP Standbilder hintereinander, dann das Plakat des ersten (nie ein schwarzer
   * Schoner; nur in Bibliotheken ganz ohne echte Hintergrundbilder). cb({art|pm, …}|null) */
  var MAX_SKIP = 12;
  function asPoster(x) { return x && x.thumb ? { pm: true, thumb: x.thumb, sq: x.sq, art: x.art, title: x.title, sub: x.sub } : x; }
  function nextItem(cb) {
    if (kind === 'paused') { cb(homeItems[0] || null); return; }
    var mode = pics(), g = gen, skipped = 0, first = null;
    (function one() {
      srcNext(function (x) {
        if (g !== gen) return;
        if (!x) { cb(asPoster(first)); return; }
        if (mode === 'poster') { cb(asPoster(x)); return; }
        if (mode === 'stills' || !N.saverArt) { cb(x); return; }
        N.saverArt.kind(x.art, function (k) {
          if (g !== gen) return;
          if (k !== 'still') { cb(x); return; }
          if (!first) first = x;
          if (++skipped >= MAX_SKIP) { cb(asPoster(first)); return; }
          one();
        });
      });
    })();
  }
  function url(x) {
    // F21: weich oder scharf (beide 1280x720 wie der Hero, ohne Skalierung). TV 27.10. nachmittags: 640x360 blur 24 gestreckt war ein
    // unkenntlicher Farbbrei mit JPEG-Bloecken -> nativ, blur 8 (ruhig, Motiv erkennbar), quality 95 (Block-Kennzahl 2,38 -> 1,15; ~150 KB)
    if (x.pm) return N.img.url(x.thumb, x.sq ? 'saverSq' : 'saverPoster', { quality: SAVER_Q });
    var sharp = settings() && settings().saverBlur === false;
    return sharp ? N.img.url(x.art, 'hero') : N.img.url(x.art, 'hero', { blur: SAVER_BLUR, quality: SAVER_Q });
  }
  /* Grund hinter dem Plakat: dasselbe Bild 640 breit (Poster 640x960), stark unscharf und vom PMS abgedunkelt (opacity 35 ueber
   * Schwarz -> keine eigene Abdunklungs-Ebene), 2x vergroessert (bei so starker Unschaerfe unsichtbar; halb so viel zu dekodieren
   * wie 1280 breit). Hoechstens 89 von 255 -> Text (auch text-soft) ohne Abdunklung der Einblendung >= 4,5:1; deshalb blendet
   * place() bei Plakat-Bildern die Abdunklung der Einblendung aus: sie laege sonst halb ueber dem Plakat (Review 28.10.). */
  var PM_BG = 35;
  function bgUrl(x) { return N.img.url(x.thumb, 'backdrop', { blur: 24, opacity: PM_BG, background: '000000', quality: SAVER_Q }); }
  function px(n) { return n + 'px'; }
  function box(e, b) { var s = e.style; s.left = px(b.x); s.top = px(b.y); s.width = px(b.w); s.height = px(b.h); }
  /* Ebene l fuer Bild x einrichten (nach dem Laden, Ebene noch verdeckt) -> Zusammensetzung {bg, p} fuer Jalousie/Kacheln oder null */
  function compose(l, x) {
    var s = l.img.style;
    if (!x.pm) {
      if (l.pm) { l.pm = false; l.inn.className = 'scs-in'; s.left = s.top = s.width = s.height = ''; U.show(l.pst, false); }
      return null;
    }
    var nw = l.img.naturalWidth || 640, nh = l.img.naturalHeight || (x.sq ? 640 : 960), c = N.img.cover(nw * 2, nh * 2, 1280, 720);
    var p = SL.posterBox(setting('saverInfo', 'ambient'), cyc + 1, l.pst.naturalWidth || (x.sq ? 1 : 2), l.pst.naturalHeight || (x.sq ? 1 : 3));
    box(l.img, c); box(l.pst, p);
    if (!l.pm) { l.pm = true; l.inn.className = 'scs-in pm'; U.show(l.pst, true); }
    return { bg: { u: l.img._pnUrl, x: c.x, y: c.y, w: c.w, h: c.h }, p: { u: l.pst._pnUrl, x: p.x, y: p.y, w: p.w, h: p.h } };
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
      if (!x || !(x.pm ? x.thumb : x.art)) { loading = false; noArt = true; nextAt = Math.max(nextAt, now() + interval()); return; }   // keine Bilder: nur Uhr/Info-Block
      var b = back(), u = url(x), bu = x.pm ? bgUrl(x) : '';
      rest0(b); b.w.style.zIndex = 1;
      /* Poster: erst der Grund (ins grosse <img>), dann das Plakat; beide fertig, bevor die Ebene gezeichnet wird */
      N.img.want(b.img, x.pm ? bu : u, 0, function (ok) {
        if (g !== gen) return;
        if (!ok) { loading = false; if (++fails < 5) later(2000, prepare); return; }
        if (!x.pm) { if (b.pst._pnUrl) N.img.drop(b.pst); done(); return; }
        N.img.want(b.pst, u, 0, function (ok2) {
          if (g !== gen) return;
          if (!ok2) { loading = false; if (++fails < 5) later(2000, prepare); return; }
          done();
        });
      });
      function done() {
        fails = 0;
        var comp = compose(b, x);
        settle(SETTLE, function () { loading = false; ready = { x: x, url: u, comp: comp }; if (now() >= nextAt) run(); });
      }
    });
  }
  function due() {
    if (busy || now() < nextAt) return;
    if (ready) { run(); return; }
    if (loading) return;                                  // Bild kommt gleich (danach sofort der Uebergang)
    nextAt = now() + interval(); moveInfo();   // kein Bild (nur Uhr, Pause, Ladefehler): Info-Block wandert trotzdem
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
    blinds: parts(SL.PARTS.blinds, true), tiles: parts(SL.PARTS.tiles, false)
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
  /* Jalousie (8 x 1, von links) bzw. Kacheln (3 x 2, zufaellig; SL.PARTS): Teile mit dem neuen Bild als Hintergrund (derselbe Cache-Eintrag
   * wie das <img> der hinteren Ebene) blenden versetzt ueber der vorderen Ebene ein. Danach zeigt die hintere Ebene dasselbe Bild.
   * Teile werden beim Start des Schoners EINMAL angelegt (preParts) und bleiben eigene Ebenen; die Huelle liegt fest ueber der vorderen
   * Ebene (z-index 3).
   * TV-Nachmessung 28.10. (5700037): Kacheln 3 / Jalousie 4 Frames > 50 ms. Der Startframe kostete trotz vorab angelegter Teile 78–85 ms
   * (JS 13–17 ms): (1) die Teile lagen zum Zeichnen geparkt AUSSERHALB des Bildes (translate3d -2000 px) – WebKit malt ausserhalb des
   * sichtbaren Bereichs offenbar nichts vor, also wurden alle Teile erst im Startframe gemalt; (2) offsetWidth im Startframe erzwang
   * Stil + Layout. Jetzt: stage legt die Teile IM Bild an, aber mit Deckkraft 0 (unsichtbar, die Ebenen werden in der Ruhezeit davor
   * gemalt); go setzt nur Uebergang + Deckkraft 1 (der Zustand 0 ist seit >= 400 ms festgeschrieben, kein erzwungenes Layout). */
  /* Teile fuer cols x rows anlegen/legen (im Bild, unsichtbar); u = Bild (leer: nur Ebenen vorbereiten, schwarz) */
  /* comp (Poster und Cover): zwei Hintergruende je Teil – Plakat (scharf, an seiner Stelle) ueber dem abgedunkelten Grund, ohne
   * Abdunklungs-Ebene (Klasse pm) -> nach dem Uebergang zeigt die Ebene darunter exakt dasselbe */
  function layTiles(cr, u, comp) {
    var R = SL.grid(cr[0], cr[1]), n = R.length, i;
    while (tiles.length < n) { var t = U.el('div', 'scs-tile', tilesEl); U.el('i', '', t); tiles.push(t); }
    tf(tilesEl, ID); tilesEl.style.zIndex = 3; tilesEl.style.display = '';
    var pm = !!(u && comp), cls = pm ? 'scs-tiles pm' : 'scs-tiles';
    if (u && tilesEl.className !== cls) tilesEl.className = cls;
    for (i = 0; i < tiles.length; i++) {
      var e = tiles[i], st = e.style;
      if (i >= n) { st.display = 'none'; continue; }
      var g = R[i];
      st.display = ''; st.left = g.x + 'px'; st.top = g.y + 'px'; st.width = g.w + 'px'; st.height = g.h + 'px';
      if (pm) {
        var P = comp.p, B = comp.bg, sz = P.w + 'px ' + P.h + 'px, ' + B.w + 'px ' + B.h + 'px';
        st.backgroundImage = 'url("' + P.u + '"), url("' + B.u + '")';
        st.backgroundPosition = (P.x - g.x) + 'px ' + (P.y - g.y) + 'px, ' + (B.x - g.x) + 'px ' + (B.y - g.y) + 'px';
        st.webkitBackgroundSize = sz; st.backgroundSize = sz;
      } else if (u) {
        st.backgroundImage = 'url("' + u + '")'; st.backgroundPosition = (-g.x) + 'px ' + (-g.y) + 'px';
        st.webkitBackgroundSize = st.backgroundSize = '';   // CSS: 1280x720
      }
      tr(e, 'none'); op(e, 0);
    }
  }
  /* nach dem Uebergang: Teile unsichtbar (die neue vordere Ebene zeigt dasselbe Bild darunter -> kein sichtbarer Unterschied) */
  function hideTiles() {
    if (!tilesEl || tilesEl.style.display === 'none') return;
    for (var i = 0; i < tiles.length; i++) if (tiles[i].style.opacity !== '0') { tr(tiles[i], 'none'); op(tiles[i], 0); }
  }
  /* Uebergang mit Teilen eingestellt (Jalousie, Kacheln; Zufall: Kacheln): Ebenen vorab anlegen */
  function preParts(fx) {
    if (fx === 'tiles' || fx === 'blinds' || fx === 'random') layTiles(SL.PARTS[fx === 'blinds' ? 'blinds' : 'tiles'], '');
  }
  function parts(cr, ordered) {
    var n = cr[0] * cr[1], PART = 600;
    return {
      settle: TILE_SETTLE,
      stage: function (F, B, u, comp) { layTiles(cr, u, comp); },
      go: function (F, B, d) {
        var del = SL.delays(n, Math.round((d - PART) / Math.max(1, n - 1)), ordered, rnd), i;
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
    /* TV-Nachmessung 28.10.: der Info-Block wurde MITTEN im Bilduebergang umgesetzt (Text + Lage neu = Ebene neu malen, 47–78 ms).
     * Jetzt (ausser Schnitt): stage -> Info-Block ausblenden -> unsichtbar umsetzen und malen lassen, waehrend sich nichts bewegt ->
     * Uebergang + Info-Block blendet gleichzeitig wieder ein. Schnitt: wie bisher alles in einem Frame (dort bewegt sich nichts). */
    var hard = fx === 'cut';
    if (D.stage) D.stage(F, B, r.url, r.comp);
    settle(D.settle || 30, function () {
      if (hard) { go(); return; }
      tr(ov, 'opacity ' + OV_FADE + 'ms ease-in-out'); op(ov, 0);
      later(OV_FADE + 50, function () { pmNow = !!r.x.pm; place(); setInfo(r.x); settle(INFO_SETTLE, go); });
    });
    function go() {
      var d = D.go(F, B, ms(fx));
      lastDur = d;
      if (hard) { pmNow = !!r.x.pm; place(); setInfo(r.x); } else op(ov, 1);
      if (onGo) { var h = onGo; onGo = null; h(d); }   // Messlauf: Beginn des sichtbaren Uebergangs
      if (d) later(d + 100, swap); else swap();
    }
  }
  /* neue Ebene wird die vordere; die alte (unsichtbar unter ihr) kommt in Ruhe.
   * TV-Nachmessung 28.10.: Tausch, Zuruecksetzen der alten Ebene, Bild freigeben, Teile weg UND das Laden des naechsten Bilds lagen in
   * einem Frame direkt nach dem Uebergang (63–66 ms), das Dekodieren des naechsten Bilds (1280x720, 70–90 ms) kurz danach. Jetzt in
   * Stufen: Tausch (nur z-index) -> 400 ms -> alte Ebene zuruecksetzen/freigeben, Teile unsichtbar -> 1,5 s -> naechstes Bild laden. */
  function swap() {
    var old = front();
    f = 1 - f;
    var nw = front();
    nw.w.style.zIndex = 2; tr(nw.w, 'none'); tf(nw.w, ID);
    old.w.style.zIndex = 1;
    busy = false;
    later(CLEAN_MS, function () {
      if (old === front()) return;                         // inzwischen erneut getauscht (sehr kurzer Takt)
      rest0(old); N.img.drop(old.img); N.img.drop(old.pst); hideTiles();
      if (kind !== 'paused') later(PREP_MS, prepare);
    });
  }
  /* Info-Block: Text + Ecke; mit Bildwechsel in run (vor dem Uebergang umgesetzt, Schnitt: im selben Frame) */
  /* Einblendung (saverInfo): Stil-Klasse, Groesse, Abdunklung und Lage aus N.saverLogic.info; nur bei Aenderung ins DOM */
  var ovSig = '', pmNow = false;   // pmNow: aktuelles Bild ist ein Plakat (Poster und Cover) -> Einblendung ohne Abdunklung
  function place() {
    var c = SL.info(setting('saverInfo', 'ambient'), cyc), sig = c.style + c.r + c.t + c.ty + pmNow, dark = !!c.scr && !pmNow;
    if (sig !== ovSig) {
      ovSig = sig;
      ov.className = 'scs-ov st-' + c.style + (c.r ? ' r' : '') + (c.t ? ' t' : '');
      ov.style.width = c.w + 'px'; ov.style.height = c.h + 'px';
      var u = dark ? N.assetBase + c.scr : N.img.BLANK;
      if (scr.src !== u) scr.src = u;
      U.show(scr, dark);
      scr.setAttribute('data-layout-edge', c.edge.join(','));   // Abdunklung buendig am Rand (nur fuer die Layout-Pruefung)
      blk.style.webkitTransform = c.ty ? 'translate(0,' + -c.ty + 'px)' : '';   // Leisten: nur der Text wandert, die Abdunklung bleibt unten
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
  /* ohne Bildwechsel (nur Uhr, Pause, Ladefehler): ausblenden, umsetzen, einblenden (mit Bild: run) */
  function moveInfo() {
    cyc++;
    tr(ov, 'opacity ' + OV_FADE + 'ms ease-in-out'); op(ov, 0);
    later(OV_FADE + 50, function () { place(); setInfo(null); op(ov, 1); });
  }
  S.start = function (ps) {
    var prof = N.session && N.session.profile;
    gen++;
    kind = !prof ? 'clock' : ps && ps.paused ? 'paused' : 'art';
    homeItems = kind === 'art' ? C.saverItems(N.session.homeCache(), 0, pics() === 'poster' ? 'thumb' : 'art') : [];
    bag = null; noArt = kind === 'clock'; ready = null; busy = false; loading = false; fails = 0; lastFx = '';
    if (kind === 'paused') {
      var it = ps.item || {};
      homeItems = [{ art: it.art || '', title: C.pausedText(it), sub: '' }];   // ohne Art kein Bild (kein Poster-Ersatz)
    }
    S.on = true; f = 0; cyc = N.config.saverPos !== undefined ? N.config.saverPos - 1 : N.config.fixedClock ? -1 : Math.floor(Math.random() * 4);   // run() zaehlt vor dem 1. Bild hoch (Tests: Ecke 0 bzw. saverPos)
    rest0(Ls[0]); rest0(Ls[1]); Ls[0].w.style.zIndex = 2; Ls[1].w.style.zIndex = 1;
    ovSig = ''; pmNow = false; tr(ov, 'none'); op(ov, 1); place();
    U.show(hc, false);
    U.setText(ti, ''); U.setText(sb, ''); setInfo(null);
    U.show(el, true);
    if (kind === 'art') preParts(setting('saverFx', 'fade'));   // Teile-Ebenen jetzt (Schwarz), nicht im 1. Uebergang
    nextAt = 0;                                           // erstes Bild: sobald es da ist (aus Schwarz)
    if (!noArt) prepare(); else nextAt = now() + interval();
    N.log('Bildschirmschoner an (' + kind + ')');
  };
  S.stop = function () {
    if (!S.on) return;
    S.on = false; gen++; act();
    U.show(el, false);
    for (var i = 0; i < 2; i++) { rest0(Ls[i]); N.img.drop(Ls[i].img); N.img.drop(Ls[i].pst); }
    if (tilesEl) { tilesEl.style.display = 'none'; for (i = 0; i < tiles.length; i++) tiles[i].style.backgroundImage = 'none'; }   // Speicher frei
    if (N.saverLib) N.saverLib.abort();
    if (N.saverArt) N.saverArt.abort();
    homeItems = []; ready = null; busy = false; loading = false; force = null; onGo = null;
    N.log('Bildschirmschoner aus');
  };
  S._tick = tick; S._pointer = onPointer; S._nextItem = nextItem;   // Tests
  /* Messlauf (dev/bench.js 'saver-<fx>'): Schoner mit festem Uebergang starten; cb(go) sobald das 2. Bild bereit liegt,
   * go() startet den Uebergang sofort und liefert seine Dauer (ms) */
  S.bench = function (fx, cb) {
    S.stop(); S.start({}); force = fx; preParts(fx);
    var g = gen, t0 = now();
    (function poll() {
      if (g !== gen || !S.on) return;
      /* go(started): startet sofort (Vorbereitung: stage, Info-Block umsetzen), started(d) beim Beginn des sichtbaren Uebergangs */
      if (ready && !busy && lastFx) { cb(function (started) { nextAt = 0; onGo = started || null; run(); }); return; }
      if (now() - t0 > 20000) { cb(null); return; }
      setTimeout(poll, 200);
    })();
  };
  N.ui.saver = S;
})(N);
