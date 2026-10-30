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
 * - Jede Taste und jeder Zeiger-Klick beendet ihn OHNE die normale Funktion (App.onKey fragt saver.key zuerst).
 * - Nachtruhe (SAV-6, Nutzer-Befund 29.10.: nach ~8 h Schoner und einem Tastendruck war der TV komplett eingefroren, nicht einmal
 *   die Ein/Aus-Taste ging – vermutlich nativer Speicher des Orsay-Browsers, ~1000 dekodierte 1280x720-Bilder + je eine /arts-Anfrage):
 *   nach "Nach langer Zeit nur noch die Uhr" (Standard 2 Std.) keine Bilder mehr, beide Ebenen und die Teile freigegeben, nur die
 *   Uhr wandert auf Schwarz. Alle 30 Min. eine warn-Zeile ins Protokoll (Release speichert nur warn/error) -> ein Haengenbleiben laesst
 *   sich spaeter datieren. */
(function (N) {
  var U = N.util, C = N.comfort, SL = N.saverLogic, TICK = 1000, SAVER_BLUR = 8, SAVER_Q = 95;   // weicher Schoner (s. url)
  var ID = 'translate3d(0,0,0)', OV_FADE = 400, SETTLE = 150, TILE_SETTLE = 400, INFO_SETTLE = 100, CLEAN_MS = 400, PREP_MS = 1500;
  var S = { on: false }, root = null, timer = 0, lastAct = 0, lastMin = '', homeT0 = 0;
  var blk, hc, hcT, hcS, hcD, hcSt = '', hcDay = '', el, ov, scr, ck, ti, sb, tilesEl = null, tiles = [], Ls = [], f = 0;
  var kind = '', gen = 0, cyc = 0, nextAt = 0, ready = null, busy = false, loading = false, fails = 0, lastFx = '', lastDur = 0, hadPic = false;   // hadPic: schon ein Bild gezeigt (erstes kommt aus Schwarz)
  var homeItems = [], bag = null, noArt = false, force = null, onGo = null;
  /* Nachtruhe + Herzschlag (SAV-6): t0 = Start dieser Schoner-Sitzung, shown = gezeigte Bilder, hbAt = naechste Protokollzeile */
  var night = false, t0 = 0, shown = 0, hbAt = 0, HB_MS = 1800000, NIGHT_FADE = 1500;
  /* Waechter (TV-Test 30.10.: nach ~12 Min. stand ein Bild 50 Min. lang, Info-Block wanderte nicht mehr; im Simulator lief dieselbe Logik
   * 60 Min. weiter -> am TV kam ein Rueckruf nie an: Frame-/Zeitgeber-, Bild- oder Netz-Ereignis). step/stepAt = letzter Fortschritt in
   * prepare/run; haengt busy oder loading laenger als stuckMs ohne Fortschritt, protokolliert der Takt den Schritt (warn "saver stuck …")
   * und setzt den Ablauf zurueck (gen++ verwirft spaete Rueckrufe), das stehende Bild bleibt. mvTok: Info-Wandern ohne Bild (moveInfo)
   * wird abgebrochen, sobald ein Bildwechsel beginnt (sonst blendete es den alten Titel ueber dem neuen Bild wieder ein). */
  var step = '', stepAt = 0, mvTok = 0, stucks = 0;
  /* cleaning: Aufraeum-Stufe von swap steht noch aus (CLEAN_MS). Sie gibt die hintere Ebene frei (N.img.drop verwirft einen laufenden
   * Ladeauftrag OHNE Rueckruf) -> so lange kein prepare (TV-Test 30.10., 3-s-Takt: due lud schon in die Ebene, die Aufraeum-Stufe
   * verwarf den Auftrag, loading blieb fuer immer stehen = "saver stuck img"). */
  var cleaning = false;
  function mark(st) { step = st; stepAt = now(); }
  function stuckMs() { return Math.max(120000, interval() * 2 + 15000); }

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
  function interval() { return force ? 600000 : N.config.saverIvMs || SL.interval(setting('saverInterval', 30)); }   // saverIvMs: nur Bildtests
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
      var psh = U.el('img', 'scs-psh', inn, 'display:none'); psh.src = N.img.BLANK;   // "Poster und Cover": weicher Schatten unter dem Plakat
      var pst = U.el('img', 'scs-pst', inn, 'display:none'); pst.src = N.img.BLANK;   // ... Plakat scharf ueber dem Grund
      Ls.push({ w: w, inn: inn, img: im, psh: psh, pst: pst, kb: '', pm: false });
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
      if (t !== lastMin) { lastMin = t; U.setText(hcT, t); hcDate(); if (S.on && SL.infoParts(setting('saverInfo', 'ambient'), clockOn(), night).clock) U.setText(ck, t); }
      var top = N.router.topName();
      U.show(hc, !S.on && top === 'home' && !!(N.session && N.session.profile) && clockOn());
      if (S.on) { beat(); due(); return; }
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
    if (kind === 'paused') { pausedItem(cb); return; }
    var mode = pics(), g = gen, skipped = 0, first = null;
    (function one() {
      srcNext(function (x) {
        if (g !== gen) return;
        if (!x) { cb(asPoster(first)); return; }
        if (mode === 'poster') { cb(asPoster(x)); return; }
        if (mode === 'stills' || !N.saverArt) { cb(x); return; }
        mark('arts');
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
  /* Pause-Schoner: der pausierte Titel nach "Bilder im Bildschirmschoner" (SL.pausedPic; Standbild-Pruefung wie im Schoner, eine
   * Anfrage beim Start der Pause-Ansicht) */
  function pausedItem(cb) {
    var x = homeItems[0] || null, g = gen;
    if (!x) { cb(null); return; }
    (function pick(k) {
      var p = SL.pausedPic(pics(), !!x.art, !!x.thumb, N.saverArt ? k : '');
      if (p === 'check') { N.saverArt.kind(x.art, function (k2) { if (g === gen) pick(k2 || ''); }); return; }
      cb(p === 'poster' ? asPoster(x) : p === 'art' ? x : null);
    })();
  }
  function pausedList(p) { var it = p || {}; return [{ art: it.art || '', thumb: it.thumb || '', sq: SL.square(it), title: C.pausedText(p), sub: '' }]; }
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
    if (!x.pm) { plain(l); return null; }
    var nw = l.img.naturalWidth || 640, nh = l.img.naturalHeight || (x.sq ? 640 : 960), c = N.img.cover(nw * 2, nh * 2, 1280, 720);
    box(l.img, c);
    l.sq = !!x.sq;
    var pp = posterAt(l, cyc + 1);
    if (!l.pm) { l.pm = true; l.inn.className = 'scs-in pm'; U.show(l.pst, true); U.show(l.psh, true); }
    return { bg: { u: l.img._pnUrl, x: c.x, y: c.y, w: c.w, h: c.h }, p: { u: l.pst._pnUrl, x: pp.p.x, y: pp.p.y, w: pp.p.w, h: pp.p.h },
      sh: { u: pp.su, x: pp.sh.x, y: pp.sh.y, w: pp.sh.w, h: pp.sh.h }, ck: pp.ck };
  }
  /* Ebene l wieder ohne Plakat (normales Vollbild) */
  function plain(l) {
    var s = l.img.style;
    if (l.pm) { l.pm = false; l.inn.className = 'scs-in'; s.left = s.top = s.width = s.height = ''; U.show(l.pst, false); U.show(l.psh, false); }
  }
  /* Plakat + Schatten der Ebene l fuer Lage n setzen (compose; moveInfo beim Pause-Schoner: Einblendung wandert, das Plakat mit) */
  function posterAt(l, n) {
    var st = setting('saverInfo', 'ambient'), pw = l.pst.naturalWidth || (l.sq ? 1 : 2), ph = l.pst.naturalHeight || (l.sq ? 1 : 3);
    var p = SL.posterBox(st, n, pw, ph), sh = SL.shadowBox(p), su = N.assetBase + sh.f;
    box(l.pst, p); box(l.psh, sh);
    if (l.psh.getAttribute('src') !== su) l.psh.src = su;   // statisches Bild (12 KB, beim Start vorgeladen); dekodiert, waehrend die Ebene verdeckt ist
    return { p: p, sh: sh, su: su, ck: st === 'bigclock' ? SL.bigGroup(n, pw, ph).ck : null };
  }

  /* ---------- Ablauf: laden (hintere Ebene) -> zeichnen lassen -> Uebergang -> tauschen -> naechstes laden ---------- */
  function front() { return Ls[f]; }
  function back() { return Ls[1 - f]; }
  /* Ebene in Ruhe: keine Uebergaenge, keine Verschiebung, deckend */
  function rest0(l) {
    l.kb = '';
    tr(l.inn, 'none'); tf(l.inn, ID); op(l.inn, 1);
    tr(l.w, 'none'); tf(l.w, ID);
    if (l.pst.style.opacity !== '') { tr(l.pst, 'none'); tr(l.psh, 'none'); l.pst.style.opacity = l.psh.style.opacity = ''; }   // nach moveInfo (Plakat-Lage)
  }
  function later(ms, fn) { var g = gen; setTimeout(function () { if (g === gen && S.on) fn(); }, ms); }
  /* zwei Frames + Pause: WebKit hat das Bild der hinteren Ebene sicher dekodiert und gezeichnet */
  function settle(ms, fn) { var g = gen; U.raf(function () { U.raf(function () { setTimeout(function () { if (g === gen && S.on) fn(); }, ms); }); }); }
  function prepare() {
    if (loading || ready || !S.on || noArt || cleaning) return;
    loading = true; mark('item');
    var g = gen;
    nextItem(function (x) {
      if (g !== gen) return;
      mark('img');
      if (!x || !(x.pm ? x.thumb : x.art)) { loading = false; noArt = true; nextAt = Math.max(nextAt, now() + interval()); return; }   // keine Bilder: nur Uhr/Info-Block
      var b = back(), u = url(x), bu = x.pm ? bgUrl(x) : '';
      rest0(b); b.w.style.zIndex = 1;
      /* Poster: erst der Grund (ins grosse <img>), dann das Plakat; beide fertig, bevor die Ebene gezeichnet wird */
      N.img.want(b.img, x.pm ? bu : u, 0, function (ok) {
        if (g !== gen) return;
        if (!ok) { loading = false; if (++fails < 5) later(2000, prepare); return; }
        if (!x.pm) { if (b.pst._pnUrl) N.img.drop(b.pst); done(); return; }
        mark('pst');
        N.img.want(b.pst, u, 0, function (ok2) {
          if (g !== gen) return;
          if (!ok2) { loading = false; if (++fails < 5) later(2000, prepare); return; }
          done();
        });
      });
      function done() {
        fails = 0; mark('draw');
        var comp = compose(b, x);
        settle(SETTLE, function () { loading = false; mark('ready'); ready = { x: x, url: u, comp: comp }; if (now() >= nextAt) run(); });
      }
    });
  }
  function due() {
    if ((busy || loading) && now() - stepAt > stuckMs()) unstick();
    if (!busy && nightDue()) { goNight(); return; }      // nie mitten im Uebergang (busy: stage bis swap)
    if (busy || cleaning || now() < nextAt) return;
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
        var P = comp.p, H = comp.sh, B = comp.bg, sz = P.w + 'px ' + P.h + 'px, ' + H.w + 'px ' + H.h + 'px, ' + B.w + 'px ' + B.h + 'px';
        st.backgroundImage = 'url("' + P.u + '"), url("' + H.u + '"), url("' + B.u + '")';
        st.backgroundPosition = (P.x - g.x) + 'px ' + (P.y - g.y) + 'px, ' + (H.x - g.x) + 'px ' + (H.y - g.y) + 'px, ' + (B.x - g.x) + 'px ' + (B.y - g.y) + 'px';
        st.webkitBackgroundSize = sz; st.backgroundSize = sz;
      } else if (u) {
        st.backgroundImage = 'url("' + u + '")'; st.backgroundPosition = (-g.x) + 'px ' + (-g.y) + 'px';
        st.webkitBackgroundSize = st.backgroundSize = '';   // CSS: 1280x720
      }
      tr(e, 'none'); op(e, 0);
    }
  }
  /* nach dem Uebergang: Teile unsichtbar (die neue vordere Ebene zeigt dasselbe Bild darunter -> kein sichtbarer Unterschied) und
   * ohne Bild (SAV-6): sonst hielten die verdeckten Teile das vorige Bild bis zum naechsten Jalousie-/Kachel-Uebergang fest (bei
   * Zufaellig oft viele Bilder lang). Laeuft in der Aufraeum-Stufe von swap (CLEAN_MS nach dem Uebergang, nichts bewegt sich); das
   * naechste stage setzt das neue Bild ohnehin, im go-Frame aendert sich dadurch nichts. */
  function hideTiles() {
    if (!tilesEl || tilesEl.style.display === 'none') return;
    for (var i = 0; i < tiles.length; i++) {
      var st = tiles[i].style;
      if (st.opacity !== '0') { tr(tiles[i], 'none'); op(tiles[i], 0); }
      if (st.backgroundImage && st.backgroundImage !== 'none') st.backgroundImage = 'none';
    }
  }
  /* Teile ganz weg und ohne Bild (Ende, Nachtruhe) */
  function clearTiles() {
    if (!tilesEl) return;
    tilesEl.style.display = 'none';
    for (var i = 0; i < tiles.length; i++) tiles[i].style.backgroundImage = 'none';
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
    ready = null; busy = true; cyc++; shown++; mvTok++; mark('stage');
    var fx = force || SL.fx(setting('saverFx', 'fade'), N.fx.reduced(), rnd, lastFx), D = FXS[fx], F = front(), B = back();
    lastFx = fx;
    nextAt = now() + interval();
    /* TV-Nachmessung 28.10.: der Info-Block wurde MITTEN im Bilduebergang umgesetzt (Text + Lage neu = Ebene neu malen, 47–78 ms).
     * Jetzt (ausser Schnitt): stage -> Info-Block ausblenden -> unsichtbar umsetzen und malen lassen, waehrend sich nichts bewegt ->
     * Uebergang -> erst wenn das neue Bild steht, blendet der Info-Block wieder ein (SL.infoIn; TV-Test 29.10.: neuer Titel stand
     * sonst kurz ueber dem alten Bild). Schnitt: wie bisher alles in einem Frame (dort bewegt sich nichts). */
    var hard = fx === 'cut';
    if (D.stage) D.stage(F, B, r.url, r.comp);
    settle(D.settle || 30, function () {
      if (hard) { go(); return; }
      mark('info');
      tr(ov, 'opacity ' + OV_FADE + 'ms ease-in-out'); op(ov, 0);
      later(OV_FADE + 50, function () { pmSet(r); place(); setInfo(r.x); settle(INFO_SETTLE, go); });
    });
    function go() {
      mark('fx');
      var d = D.go(F, B, ms(fx));
      lastDur = d;
      if (hard) { pmSet(r); place(); setInfo(r.x); }
      else { var w = SL.infoIn(fx, d, !hadPic); if (w) later(w, function () { op(ov, 1); }); else op(ov, 1); }   // neuer Titel erst ueber dem neuen Bild
      hadPic = true;
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
    busy = false; cleaning = true; mark('swap');
    later(CLEAN_MS, function () {
      cleaning = false;
      if (old === front()) return;                         // inzwischen erneut getauscht (sehr kurzer Takt)
      rest0(old); N.img.drop(old.img); N.img.drop(old.pst); hideTiles();
      if (kind !== 'paused') later(PREP_MS, prepare);
    });
  }
  /* Info-Block: Text + Ecke; mit Bildwechsel in run (vor dem Uebergang umgesetzt, Schnitt: im selben Frame) */
  /* Einblendung (saverInfo): Stil-Klasse, Groesse, Abdunklung und Lage aus N.saverLogic.info; nur bei Aenderung ins DOM */
  var ovSig = '', pmNow = false, pmCk = null;   // pmNow: aktuelles Bild ist ein Plakat (Poster und Cover) -> Einblendung ohne Abdunklung
  /* pmCk: Grosse Uhr + Plakat – Uhr-Platz {x, w} der Gruppe (SL.bigGroup, Bildschirm-x): die Uhr steht dann neben dem Plakat statt mittig */
  function pmSet(r) { pmNow = !!r.x.pm; pmCk = pmNow && r.comp && r.comp.ck || null; }
  function place() {
    var c = SL.info(setting('saverInfo', 'ambient'), cyc), ck0 = pmCk && c.style === 'bigclock' ? pmCk : null, dark = !!c.scr && !pmNow && !night;   // Nachtruhe: Schwarz, keine Abdunklung noetig
    var sig = c.style + c.r + c.t + c.ty + pmNow + night + (ck0 ? ck0.x - c.x : '');
    if (sig !== ovSig) {
      ovSig = sig;
      ov.className = 'scs-ov st-' + c.style + (c.r ? ' r' : '') + (c.t ? ' t' : '');
      ov.style.width = c.w + 'px'; ov.style.height = c.h + 'px';
      var u = dark ? N.assetBase + c.scr : N.img.BLANK;
      if (scr.src !== u) scr.src = u;
      U.show(scr, dark);
      scr.setAttribute('data-layout-edge', c.edge.join(','));   // Abdunklung buendig am Rand (nur fuer die Layout-Pruefung)
      blk.style.webkitTransform = c.ty ? 'translate(0,' + -c.ty + 'px)' : '';   // Leisten: nur der Text wandert, die Abdunklung bleibt unten
      blk.style.left = ck0 ? ck0.x - c.x + 'px' : ''; blk.style.width = ck0 ? ck0.w + 'px' : '';   // Grosse Uhr + Plakat: Uhr-Platz der Gruppe
      blk.style.right = ck0 ? 'auto' : '';
    }
    tf(ov, 'translate3d(' + c.x + 'px,' + c.y + 'px,0)');
  }
  function setInfo(x) {
    var p = SL.infoParts(setting('saverInfo', 'ambient'), clockOn(), night);
    U.setText(ck, p.clock ? clockText() : ''); U.show(ck.parentNode, p.clock);   // ck/ti/sb sind Textknoten (nodeValue)
    U.show(ti.parentNode, p.title); U.show(sb.parentNode, p.title);
    if (x) { U.setText(ti, x.title || ''); U.setText(sb, x.sub || ''); }
    U.show(ov, p.any);
  }
  /* ohne Bildwechsel (nur Uhr, Pause, Ladefehler): ausblenden, umsetzen, einblenden (mit Bild: run) */
  /* Plakat-Bild (Pause-Schoner, Ladefehler): Plakat und Schatten gehoeren zur Einblendung (Gruppe, SL.posterBox gegenueber dem
   * Text) -> sie blenden mit aus, wechseln die Lage und blenden mit wieder ein (Audit 1.0.6: sonst Text ueber dem Plakat) */
  function moveInfo() {
    cyc++;
    var l = front(), pm = pmNow && l.pm, fx = 'opacity ' + OV_FADE + 'ms ease-in-out', tok = ++mvTok;
    tr(ov, fx); op(ov, 0);
    if (pm) { tr(l.pst, fx); tr(l.psh, fx); op(l.pst, 0); op(l.psh, 0); }
    later(OV_FADE + 50, function () {
      if (tok !== mvTok) return;                          // inzwischen beginnt ein Bildwechsel (run): der setzt Titel und Lage selbst
      if (pm && l.pm) { var pp = posterAt(l, cyc); pmCk = pp.ck; op(l.pst, 1); op(l.psh, 1); }
      place(); setInfo(null); op(ov, 1);
    });
  }
  /* ---------- Nachtruhe + Herzschlag (SAV-6) ---------- */
  function nightMs() { return N.config.saverNightMs || SL.night(setting('saverNight', 120)); }   // saverNightMs: Tests/TV-Langlauf
  function nightDue() { var lim = kind === 'art' && !night ? nightMs() : 0; return lim > 0 && now() - t0 >= lim; }
  function runInfo() {
    var s = N.img && N.img._stats ? N.img._stats() : {};
    return Math.round((now() - t0) / 60000) + ' min, ' + shown + ' pics' + (night ? ', night' : '') + ', img q' + s.queued + ' r' + s.ready +
      ' a' + s.active + ' lru ' + s.cached + ' sets ' + s.sets + ' loads ' + s.loads + ', step ' + step + ' ' + Math.round((now() - stepAt) / 1000) + 's' +
      (stucks ? ', stuck ' + stucks : '');
  }
  function warn(m) { if (N.diag) N.diag.log('warn', 'saver ' + m + ' ' + runInfo()); }
  /* Waechter: haengender Schritt -> Protokoll + zurueck in Ruhe. Haengt der Uebergang selbst (fx), liegt die neue Ebene schon sichtbar
   * oben -> wie swap tauschen; davor (stage/info) ist die hintere Ebene noch verdeckt -> die vordere bleibt. */
  function unstick() {
    stucks++;
    warn('stuck ' + step + ' ' + Math.round((now() - stepAt) / 1000) + 's' + (busy ? ' busy' : '') + (loading ? ' loading' : '') + ' #' + stucks);
    gen++;
    if (N.saverLib) N.saverLib.abort();
    if (N.saverArt) N.saverArt.abort();
    if (busy && step === 'fx') { f = 1 - f; front().w.style.zIndex = 2; back().w.style.zIndex = 1; }
    var B = back();
    B.w.style.zIndex = 1; N.img.drop(B.img); N.img.drop(B.pst); rest0(B); hideTiles();
    busy = false; loading = false; cleaning = false; ready = null; fails = 0; mvTok++;
    tr(ov, 'none'); op(ov, 1);
    nextAt = now(); mark('unstuck');
  }
  function beat() { if (now() < hbAt) return; hbAt = now() + HB_MS; warn('heartbeat'); }
  /* Ab jetzt nur noch die Uhr: wie Schoner ohne Bilder (kind 'clock': noArt, kein prepare). gen++ verwirft alles, was noch laeuft
   * (Laden der hinteren Ebene, Bibliotheks-/Standbild-Anfragen, Aufraeum-Stufe von swap) – nur ein laufender Uebergang (busy) wird
   * abgewartet (due). Das Bild blendet ueber NIGHT_FADE nach Schwarz aus (nur opacity der vorderen GPU-Ebene, wie "Ueberblenden");
   * danach beide Ebenen freigeben und der Info-Block kommt ohne Titel/Zeile an der naechsten Stelle wieder (wandert dann per moveInfo). */
  function goNight() {
    night = true; noArt = true; gen++; ready = null; loading = false; cleaning = false; fails = 0;
    if (N.saverLib) N.saverLib.abort();
    if (N.saverArt) N.saverArt.abort();
    var F = front(), B = back(), fx = 'opacity ' + OV_FADE + 'ms ease-in-out';
    N.img.drop(B.img); N.img.drop(B.pst); rest0(B); plain(B);   // hintere Ebene liegt verdeckt unter der vorderen
    clearTiles();                                         // (kurz nach einem Teile-Uebergang zeigen sie dasselbe Bild wie die vordere Ebene)
    nextAt = now() + NIGHT_FADE + OV_FADE + interval();
    tr(ov, fx); op(ov, 0);
    trL(F, 'opacity ' + NIGHT_FADE + 'ms ease-in-out'); op(F.inn, 0);
    later(NIGHT_FADE + 100, function () {
      N.img.drop(F.img); N.img.drop(F.pst); rest0(F); plain(F);
      for (var i = 0; i < 2; i++) Ls[i].psh.src = N.img.BLANK;
      pmNow = false; pmCk = null; cyc++;
      U.setText(ti, ''); U.setText(sb, ''); place(); setInfo(null); op(ov, 1);
    });
    warn('night');
  }
  S.start = function (ps) {
    var prof = N.session && N.session.profile;
    gen++;
    kind = !prof ? 'clock' : ps && ps.paused ? 'paused' : 'art';
    homeItems = kind === 'art' ? C.saverItems(N.session.homeCache(), 0, pics() === 'poster' ? 'thumb' : 'art') : [];
    bag = null; noArt = kind === 'clock'; ready = null; busy = false; loading = false; cleaning = false; fails = 0; lastFx = ''; hadPic = false;
    night = false; t0 = now(); shown = 0; hbAt = t0 + HB_MS; stucks = 0; mvTok++; mark('start');
    if (kind === 'paused') {
      homeItems = pausedList(ps.item);
    }
    S.on = true; f = 0; cyc = N.config.saverPos !== undefined ? N.config.saverPos - 1 : N.config.fixedClock ? -1 : Math.floor(Math.random() * 4);   // run() zaehlt vor dem 1. Bild hoch (Tests: Ecke 0 bzw. saverPos)
    rest0(Ls[0]); rest0(Ls[1]); Ls[0].w.style.zIndex = 2; Ls[1].w.style.zIndex = 1;
    ovSig = ''; pmNow = false; pmCk = null; tr(ov, 'none'); op(ov, 1); place();
    U.show(hc, false);
    U.setText(ti, ''); U.setText(sb, ''); setInfo(null);
    U.show(el, true);
    if (kind === 'art') preParts(setting('saverFx', 'fade'));   // Teile-Ebenen jetzt (Schwarz), nicht im 1. Uebergang
    if (kind !== 'clock') for (var i = 0; i < 2; i++) Ls[i].psh.src = N.assetBase + SL.SHADOW.tall.f;   // Plakat-Schatten vorladen (unsichtbar)
    nextAt = 0;                                           // erstes Bild: sobald es da ist (aus Schwarz)
    if (!noArt) prepare(); else nextAt = now() + interval();
    N.log('Bildschirmschoner an (' + kind + ')');
  };
  S.stop = function () {
    if (!S.on) return;
    if (now() - t0 >= HB_MS) warn('end');               // langer Lauf: Ende mit Zeitstempel ins Protokoll (Haengenbleiben datierbar)
    S.on = false; gen++; act();
    U.show(el, false);
    for (var i = 0; i < 2; i++) { rest0(Ls[i]); plain(Ls[i]); N.img.drop(Ls[i].img); N.img.drop(Ls[i].pst); Ls[i].psh.src = N.img.BLANK; }
    clearTiles();                                         // Speicher frei
    if (N.saverLib) N.saverLib.abort();
    if (N.saverArt) N.saverArt.abort();
    homeItems = []; ready = null; busy = false; loading = false; cleaning = false; force = null; onGo = null;
    N.log('Bildschirmschoner aus');
  };
  S._tick = tick; S._pointer = onPointer; S._nextItem = nextItem;   // Tests
  S._state = function () { return { busy: busy, loading: loading, step: step, stucks: stucks }; };   // Tests (Waechter)
  S._night = function () { return night; }; S._tiles = function () { return tiles; };   // Tests (SAV-6)
  S._pausedNext = function (it, cb) { kind = 'paused'; homeItems = pausedList(it); nextItem(cb); };   // Tests (Schoner aus)
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
