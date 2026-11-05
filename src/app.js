/* App-Einstieg. Der Lader (loader/boot.js) ruft App.start(ctx) und leitet Tasten per App.onKey(code, event) weiter.
 * ctx: Lader-Kontext {source:'dev …'|'lokal …', log(msg), store:{read,write,probe}, …} – weitere Felder je Plattform
 * (Orsay: widgetAPI, pluginAPI, tvKey), gelesen von N.platform.init (src/platform/platform.js)
 * Startpfad (SPEC 14.3/16.1): Store lesen -> setup.json aus dem Paket (N.setupFile, PMS-only) -> Sprache -> Router-Start
 * (Login | Setup | Profilwahl | Home aus dem Cache). Mit setup.json nie plex.tv; ohne (Entwicklung) kein plex.tv, wenn die Tokens gecacht sind. */
(function (N) {
  var U = N.util, ctx = null, errs = [], root, screens, chrome, over;
  N.assetBase = '';
  /* P7: Startkosten je Schritt (eine Logzeile "start-kosten: …", Release speichert sie nicht) */
  var marks = [], markT = 0;
  function mark(name) { var t = U.now(); marks.push(name + ' ' + (t - markT)); markT = t; }

  function findAssetBase() {
    var s = document.getElementsByTagName('script');
    for (var i = s.length - 1; i >= 0; i--) {
      var src = s[i].src || '';
      var m = /^(.*\/)app(\.min)?\.js(\?.*)?$/.exec(src);
      if (m) return m[1];          // Bilder aus demselben Verzeichnis wie app.js (Dev-Server bzw. Paket)
    }
    return '';                     // lokal: relativ zum Paket
  }
  function tvLanguage() {
    var raw = '';
    try { raw = N.platform.tv.language(); } catch (e) {}
    var nav = (window.navigator && (navigator.language || navigator.userLanguage)) || '';
    N.log('lang raw tvmw=' + raw + ' nav=' + nav);
    N.i18n.sys = typeof raw === 'string' && /^[a-z]{2,3}([-_]|$)/i.test(raw) ? raw : String(nav);   // Sprach-Tag des Geraets ("de-DE"): Land fuer Fernsehen (LIVE-7)
    // TVMW liefert u. U. eine Zahl (Samsung-Enum) – dann zaehlt navigator.language; alles Unbekannte -> Deutsch
    return N.i18n.detect(typeof raw === 'string' && raw ? raw : nav);
  }
  function injectCss() {
    var st = document.createElement('style');
    st.type = 'text/css';
    var css = String(N.CSS || '').replace(/@A\//g, N.assetBase);
    if (st.styleSheet) st.styleSheet.cssText = css; else st.appendChild(document.createTextNode(css));
    document.getElementsByTagName('head')[0].appendChild(st);
  }

  var A = {
    start: function (c) {
      ctx = c || {};
      N.platform.init(ctx);
      N.screen.init();                                 // logische Flaeche: TV 1280x720, flexible Plattform W x H (Apple)
      var t0 = U.now();
      marks = []; markT = t0;
      A.source = String(ctx.source || '');
      N.diag.init(ctx.store || null, /^dev/.test(A.source), ctx.log ? function (m) { ctx.log('[neo] ' + m); } : null);
      mark('diag');
      N.assetBase = findAssetBase();
      injectCss();
      mark('css');
      root = document.getElementById('root');
      while (root.firstChild) root.removeChild(root.firstChild);
      screens = U.el('div', 'layer', root); chrome = U.el('div', 'layer', root); over = U.el('div', 'layer', root);
      over.id = 'pn-over';
      N.store.init(N.platform.store(ctx));
      N.config.apply(N.store.get('config.json'));
      mark('store');
      // Sprachtabelle (eigene Datei i18n/<lang>.js, nur die aktive) parallel zu setup.json laden: Sprache aus state.json bzw. TV
      var pre = N.store.get('state.json'), wait = 2, args = null;
      function go() { if (--wait === 0) A.boot(args[0], args[1], t0); }
      var sysLang = tvLanguage();                                       // immer: das Land daraus braucht Fernsehen (LIVE-7)
      N.i18n.load(pre && pre.lang || sysLang, function () { mark('i18n-datei'); go(); });
      N.setupFile.read(ctx, function (pkg, why) {
        mark('setup');
        var st = N.setupFile.timing();   // P7: Datei-Lesen vs. blockierter Hauptthread unterscheiden (docs/P7-TV-TEST.md)
        if (st) marks.push('(setup: io ' + st.io + ', vorab ' + st.early + ', warten ' + st.wait + ', luecke ' + st.gap + (st.show >= 0 ? ', davon onShow ' + st.show : '') + ')');
        args = [pkg, why]; go();
      });
    },
    /* zweiter Teil des Starts, sobald setup.json gelesen ist (lokale Datei, wenige ms; max. 2 s) */
    boot: function (pkg, why, t0) {
      var st = N.session.load(pkg), l = st.lang || tvLanguage();
      A.setupError = why || null;
      mark('session');
      // Sprache weicht von der Vorab-Wahl ab (altes Speicherformat) oder Datei fehlt: noch einmal laden, sonst Deutsch
      if (!N.strings[l]) { N.i18n.load(l, function (ok) { if (!ok && !N.strings.de) { N.i18n.load('de', function () { A.boot2(pkg, why, t0, st); }); return; } A.boot2(pkg, why, t0, st); }); return; }
      A.boot2(pkg, why, t0, st);
    },
    boot2: function (pkg, why, t0, st) {
      N.i18n.set(st.lang || tvLanguage());
      N.accent.apply(st.accent);                       // zuletzt genutzte Akzentfarbe vor dem ersten Bild (kein Farbsprung)
      mark('i18n');
      N.input.init();                                  // Eingabeart (caps.focusRing 'keys': Klasse am body; TV: nichts)
      N.img.decoder(chrome);                           // Vorab-Dekodieren (Runde 5): 1x1-Ebene fuer Bilder ausserhalb des Bildschirms
      N.ui.hints.init(chrome);
      N.ui.toast.init(chrome);
      N.ui.news.init(chrome);                          // HOME-13: Hinweis bei neuen Inhalten (eine dauerhafte, leere Huellen-Ebene)
      N.ui.mini.init(chrome);                          // M4: Mini-Player (Musik/Hoerbuch beim Stoebern)
      N.ui.rail.init(chrome);
      N.ui.tabbar.init(chrome);                        // nur flexible Flaeche (Apple): Leiste unten (K) bzw. Menue-Knopf (M); TV: nichts
      N.router.init(screens, over);
      N.pointer.init(root, chrome);
      N.pointer.setCursorMode(N.config.cursorMode);
      N.pointer.setEnabled(st.pointer !== false);
      N.pointer.setAccel(st.ptrAccel !== false);         // Randzonen-Rollen beschleunigen (Standard an)
      N.pointer.setEdge(st.ptrEdge !== false);           // am Rand/auf der naechsten Reihe verweilen rollt (Standard an)
      mark('chrome');
      if (N.devperf) N.devperf.init(root, ctx);         // dev/-Module fehlen im Release-Build (app.min.js)
      N.ui.saver.init(root, chrome);                  // P5: Bildschirmschoner, Uhr auf der Startseite, Willkommenskarte
      N.net.init(); N.ui.netbar.init(chrome);         // P5: Server nicht erreichbar -> Leiste + automatische Wiederholung
      mark('saver+net');
      // SUBTITLE und CH▲/CH▼ registriert der Lader nicht -> zur Laufzeit (kein Lader-Update noetig, research/player.md 7).
      // CH▲/▼: vorige/naechste Folge bzw. Kapitel im Player, Titel in Jetzt laeuft, Seiten in Listen (sonst wechselt der TV ggf. den Sender)
      N.platform.keys.register(['SUBTITLE', 'CH_UP', 'CH_DOWN']);
      // flexible Flaeche (nur Apple): Fenster gezogen / Geraet gedreht -> Seitenleiste und flexible Ansichten neu aufbauen
      if (N.screen.flex) N.evt.on('screen:resized', function () { if (N.ui.rail.el) N.ui.rail.build(); N.ui.tabbar.sync(); N.router.relayout(); });
      window.onunload = A.flush;
      window.onerror = function (msg, url, line, col, err) {
        N.diag.error('JS-Fehler ' + msg + ' @' + String(url || '').split('/').pop() + ':' + line + ':' + (col || 0), err);
        var now = U.now(); errs.push(now); while (errs.length && now - errs[0] > 10000) errs.shift();
        if (errs.length > 3) { errs = []; N.ui.toast.show(N.t('err.generic.title')); }
      };
      N.evt.on('auth:expired', function (d) { N.log('401 ' + (d && d.url ? d.url.split('?')[0] : '')); });
      N.log('start ' + N.config.version + ' src=' + ctx.source + ' lang=' + N.i18n.lang() + ' assets=' + (N.assetBase || 'lokal') +
        ' setup=' + (pkg ? 'ja (' + pkg.profiles.length + ' Profile)' : why ? 'UNGUELTIG ' + why : 'nein'));
      if (why) N.diag.log('warn', 'setup.json ungueltig: ' + why);
      if (pkg && pkg.skipped && pkg.skipped.length) N.diag.log('warn', 'setup.json: ' + pkg.skipped.length + ' Profil(e) uebersprungen: ' + pkg.skipped.join(','));
      mark('misc');
      A.route(true);
      mark('route');
      N.log('first view after ' + (U.now() - t0) + 'ms');
      N.log('start-kosten (ms): ' + marks.join(', '));
    },
    /* Start-Regeln (SPEC 7.15.4) */
    route: function (atStart) {
      if (A.setupError) { N.router.reset('start', { setupError: A.setupError }); return; }   // kaputte/neuere setup.json
      var r = N.session.startRoute();
      N.log('route ' + r.route);
      if (r.route === 'login') N.router.reset('login');
      else if (r.route === 'setup') N.router.reset('start');
      else if (r.route === 'profiles') N.router.reset('profiles', { atStart: true });
      else { N.session.activate(r.user, N.session.cachedToken(r.user)); N.router.reset('home'); }
    },
    /* Seitenleiste -> Bildschirm */
    /* -> false, wenn der Bildschirm schon offen ist (nichts zu tun; die Seitenleiste gibt dann den Fokus zurueck, F9) */
    navigate: function (id, lib) {
      var R = N.router;
      if (id === 'profile') { A.switchProfile(); return true; }
      if (id === 'home') {
        N.sections.visit('home');                    // Start = Wurzel: Verlauf der Bereiche leeren
        if (R.topName() === 'home') return false;
        while (R.topName() !== 'home' && R.depth() > 1) R.back();
        if (R.topName() !== 'home') R.reset('home');
        return true;
      }
      var name = id === 'settings' || id === 'search' || id === 'discover' || id === 'livetv' ? id : 'library';   // P4: Entdecken; LIVE-1: Fernsehen
      // sec: Bereich aus der Seitenleiste (NAV-5) – oben angekommen fuehrt RETURN ueber N.app.sectionBack weiter, nicht per Router zurueck
      var params = name !== 'library' ? { sec: 1 } : { lib: lib, sec: 1 }, tp = R.topParams();
      if (R.topName() === name && (name !== 'library' || (tp && tp.lib && lib && tp.lib.id === lib.id && (tp.lib.srv || '') === (lib.srv || '') && !tp.coll && !tp.actor))) return false;
      N.sections.visit(id);
      if (R.topName() === 'home') R.push(name, params); else R.replace(name, params);
      return true;
    },
    /* RETURN oben in einem Bereich aus der Seitenleiste (NAV-5): je nach "Zurueck aus einem Bereich" zur Startseite oder zum
     * vorherigen Bereich (N.sections); ein Bereich, der nicht mehr in der Seitenleiste steht, wird uebersprungen */
    sectionBack: function () {
      var scr = N.router.top(), rail = N.ui.rail, S = N.session;
      var to = N.sections.target(scr && scr.rail, S && S.settings, function (x) { return !!rail.entry(x); });
      var e = to !== 'home' ? rail.entry(to) : null;
      if (e) A.navigate(e.id, e.lib || null); else A.navigate('home');
    },
    /* 401 mit dem Profil-Token in einer Ansicht (Pentest P6 / Audit M8): Token verwerfen; Kinderprofil mit "Profilwechsel nur
     * mit PIN" nicht in die offene Profilwahl, sondern zur Startseite (dort fuehrt nur die Hauptkonto-PIN weiter, wie home.js) */
    authLost: function () {
      var S = N.session;
      if (S.profile) S.dropToken(S.profile.uuid);
      if (S.isKid() && S.pinSwitchOn()) { N.router.reset('home'); return; }
      N.router.reset('profiles', { atStart: true });
    },
    /* Profilwechsel; aus Kinderprofil mit "Profilwechsel nur mit PIN" erst Hauptkonto-PIN (SPEC 7.15.3) */
    switchProfile: function () {
      var S = N.session;
      function go() { N.router.push('profiles', { atStart: false }); }
      if (S.isKid() && S.pinSwitchOn()) {
        var a = S.admin();
        N.ui.pinpad.open({ key: a.uuid, name: a.name, title: N.t('kids.pinToSwitch'), verify: S.verifyAdminPin, onSuccess: go });
        return;
      }
      go();
    },
    setLang: function (l) {
      if (!N.strings[l]) {                              // Tabelle erst laden (eigene Datei); fehlt sie, bleibt die Sprache
        N.i18n.load(l, function (ok) { if (ok) A.setLang(l); else if (N.ui.toast) N.ui.toast.show(N.t('err.generic.title')); });
        return;
      }
      N.session.state.lang = l; N.session.save();
      N.i18n.set(l);
      if (N.session.settings) N.session.applyDefaults();   // Ton/UT-Sprache ohne eigene Wahl folgen der Oberflaeche (F12)
      N.router.rebuild();
      if (N.ui.saver && N.ui.saver.relabel) N.ui.saver.relabel();   // Datum der Startseiten-Uhr in der neuen Sprache
    },
    /* Beenden/EXIT/onunload: ausstehende Schreibzugriffe (Ausblenden) senden, Protokoll und Speicher sofort schreiben.
     * why 'background' (Plattform-Lader, App geht in den Hintergrund und laeuft weiter, z. B. Bild in Bild): Speicher schreiben,
     * aber die Wiedergabe nicht abschliessen (Player/Musik melden sonst "gestoppt" und nehmen keine Ereignisse mehr an) */
    flush: function (why) {
      try { N.evt.emit('app:flush', why === 'background' ? why : ''); } catch (e) {}
      N.diag.flush(); N.store.flush();
    },
    exit: function () {
      A.flush();
      N.platform.tv.exit();
    },
    onKey: function (code, ev) {
      var k = N.platform.keys.name(code, ev);
      if (!k) return;
      A.press(k);
    },
    /* Taste nach Namen (Vertrag N.Platform.KEYS) – fuer Plattformen ohne Tastencodes (Touch, Hinweisleiste, Bruecke).
     * via: Herkunft fuer die Eingabeart (N.input) – fehlt = echte Taste ('key'), 'touch'/'pointer' = Geste des Laders,
     * anderes (z. B. 'sys': Anruf pausiert) = Art bleibt */
    press: function (k, via) {
      try {
        N.input.set(via === undefined || via === null ? 'key' : via);
        if (N.ui.saver.key(k)) return;               // Schoner an: Taste beendet ihn ohne ihre Funktion (SPEC 7.14)
        if (N.devperf && N.devperf.key(k)) return;
        if (N.audio.key(k)) return;                   // M4: globale Medientasten waehrend Musik
        // Nr. 22: Pfeil aus einem Finger-Wisch (Rueckfall-Fokus-Schritte des Laders) oeffnet nie die Seitenleiste (N.ui.rail.open)
        N.input.swipe = via === 'touch' && N.keys.isNav(k);
        N.router.key(k);
      } catch (e) { N.diag.error('Taste ' + k, e); }
      N.input.swipe = false;
    },
    /* Wisch vom linken Bildschirmrand (Touch-Schicht der Plattform, Nr. 9): Seitenleiste ausklappen, wo es eine gibt (nicht ueber
     * Dialogen/Panels, nicht im Player). Rueckgabe true = offen */
    rail: function () {
      try {
        var rl = N.ui.rail;
        if (!rl || !rl.attached() || N.router.hasOverlay() || (N.ui.saver && N.ui.saver.on)) return false;
        N.input.set('touch');
        if (!rl.isOpen()) rl.open();
        return rl.isOpen();
      } catch (e) { N.diag.error('Rail', e); return false; }
    },
    /* Rand-Wisch live (Touch-Schicht, Nr. 24): {phase 'start'|'move'|'end', dx (App-px seit Start), t, cancel} -> Seitenleiste folgt
     * dem Finger (N.ui.rail.pan). Bei 'start' false = keine Leiste hier (Dialog, Player, Schoner) -> der Lader verwirft den Zug. */
    railPan: function (e) {
      try {
        var rl = N.ui.rail;
        if (!e || !rl || !rl.pan) return false;
        if (e.phase === 'start') {
          if (!rl.attached() || rl.isOpen() || N.router.hasOverlay() || (N.ui.saver && N.ui.saver.on)) return false;
          N.input.set('touch');
        }
        return rl.pan({ phase: e.phase, from: 'edge', dx: e.dx || 0, t: e.t || 0, cancel: !!e.cancel });
      } catch (er) { N.diag.error('Rail-Pan', er); return false; }
    },
    /* Eingabeart vom Lader melden (Beruehrung: 'touch'), bevor die Geste als Maus-Ereignis/Pan ankommt */
    input: function (m) { N.input.set(m); },
    /* Wischen bei caps.scroll 'free' (Lader, 08-touch.md 5): {phase:'start'|'move'|'end', axis:'x'|'y', x, y (Start, App-px),
     * dx, dy (Weg seit Start, App-px), t (ms), cancel}. -> true, wenn eine Ansicht den Zug nimmt; sonst passiert nichts */
    pan: function (e) {
      try { return N.router.pan(e); } catch (er) { N.diag.error('Pan', er); return false; }
    },
    /* An den Anfang (Lader: Tipp ganz oben, Cmd+Pfeil hoch) -> true, wenn eine Liste losrollt */
    scrollTop: function () {
      try { return N.router.scrollTop(); } catch (er) { N.diag.error('scrollTop', er); return false; }
    },
    /* Kuerzel einer Computer-Tastatur (Lader, Apple Nr. 10): 'search' | 'settings' | 'back' -> true, wenn ausgefuehrt.
     * Offene Karten/Menues schliessen sich dabei; vor der Anmeldung und im Schoner (beendet ihn nur) nichts. */
    shortcut: function (what) {
      try {
        N.input.set('key');
        if (N.ui.saver && N.ui.saver.on) { N.ui.saver.key('RETURN'); return true; }
        if (what === 'back') { N.router.key('RETURN'); return true; }
        if (/^move/.test(what)) {                                   // Sortier-Listen (NAV-27): nur die oberste Ansicht, kein Overlay/keine offene Leiste
          var top = N.router.top();
          return !!(top && top.shortcut && !N.router.hasOverlay() && !(N.ui.rail && N.ui.rail.isOpen && N.ui.rail.isOpen()) && top.shortcut(what));
        }
        if (!N.session || !N.session.profile) return false;      // Anmeldung/Profilwahl: nichts
        if (what === 'search') { N.router.closeAllOverlays(); N.app.navigate('search'); return true; }
        if (what === 'settings') { N.router.closeAllOverlays(); N.app.navigate('settings'); return true; }
        return false;
      } catch (e) { N.diag.error('Kuerzel ' + what, e); return false; }
    },
    /* Player-Befehl einer Computer-Tastatur (Lader, Apple Nr. 10): an den Player, wenn er die oberste Ansicht ist (keine Menues
     * darueber). 'active' fragt nur. -> true, wenn genommen */
    playerCmd: function (cmd, arg) {
      try {
        var t = !N.router.hasOverlay() && N.router.top();
        if (!t || !t.onCmd) return false;
        if (cmd === 'active') return true;
        N.input.set('key');
        return !!t.onCmd(cmd, arg);
      } catch (e) { N.diag.error('Player ' + cmd, e); return false; }
    },
    /* Nimmt die oberste Ansicht gerade Text an (Suche, Tastatur im Fokus)? Dann gibt der Lader Buchstaben als Text statt als Tasten */
    wantsText: function () {
      try { var t = !N.router.hasOverlay() && N.router.top(); return !!(t && t.wantsText && t.wantsText()); } catch (e) { return false; }
    },
    /* Ein getipptes Zeichen (Computer-Tastatur) an die oberste Ansicht -> true, wenn angenommen */
    text: function (ch) {
      try {
        N.input.set('key');
        var t = !N.router.hasOverlay() && N.router.top();
        return !!(t && t.onText && t.onText(ch));
      } catch (e) { N.diag.error('Text', e); return false; }
    },
    /* Rad/Trackpad bei caps.scroll 'free' (Lader): {x, y} App-Koordinaten des Zeigers, {dx, dy} Weg in App-px -> N.pointer.wheelPx */
    wheel: function (e) {
      try { return !!(e && N.pointer.wheelPx(e.x, e.y, e.dx || 0, e.dy || 0)); } catch (er) { N.diag.error('Rad', er); return false; }
    }
  };
  N.app = A;
  /* TV-Dienste fuer den Player: TV-eigener Bildschirmschoner aus waehrend der Wiedergabe, an in Pause/nach Stop (Orca).
   * Alias auf N.platform.tv.saver (Aufrufer: views/player.js, player/audio.js) */
  N.tv = { saver: function (on) { N.platform.tv.saver(on); } };
  /* Schnittstelle zum Lader */
  /* Finger-Ziehen (Touch-Schicht der Plattform, App-Koordinaten): grab(x, y) -> 'drag' | 'tap' | '' fragt nur, drag(phase, x, y)
   * fuehrt aus (N.pointer.grab/drag; Player-Balken = Scrubbing, im Player kein Wischen) */
  function grab(x, y) { try { return N.pointer.touchGrab(x, y); } catch (e) { N.diag.error('grab', e); return ''; } }
  function drag(ph, x, y) { try { return N.pointer.touchDrag(ph, x, y); } catch (e) { N.diag.error('drag ' + ph, e); return false; } }
  window.App = { start: A.start, onKey: A.onKey, press: A.press, flush: A.flush, grab: grab, drag: drag, input: A.input, pan: A.pan, wheel: A.wheel, scrollTop: A.scrollTop, rail: A.rail, railPan: A.railPan,
    shortcut: A.shortcut, wantsText: A.wantsText, text: A.text, playerCmd: A.playerCmd };
})(N);
