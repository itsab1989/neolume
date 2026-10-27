/* App-Einstieg. Der Lader (loader/boot.js) ruft App.start(ctx) und leitet Tasten per App.onKey(code, event) weiter.
 * ctx: {source:'dev …'|'lokal …', log(msg), store:{read,write,probe}, widgetAPI, pluginAPI, tvKey}
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
    try { var tv = document.getElementById('pluginObjectTVMW'); if (tv && tv.GetLanguage) raw = tv.GetLanguage(); } catch (e) {}
    var nav = (window.navigator && (navigator.language || navigator.userLanguage)) || '';
    N.log('lang raw tvmw=' + raw + ' nav=' + nav);
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
      N.store.init(ctx.store || { read: function () { return null; }, write: function () {} });
      N.config.apply(N.store.get('config.json'));
      mark('store');
      N.setupFile.read(ctx, function (pkg, why) {
        mark('setup');
        var st = N.setupFile.timing();   // P7: Datei-Lesen vs. blockierter Hauptthread unterscheiden (docs/P7-TV-TEST.md)
        if (st) marks.push('(setup: io ' + st.io + ', vorab ' + st.early + ', warten ' + st.wait + ', luecke ' + st.gap + (st.show >= 0 ? ', davon onShow ' + st.show : '') + ')');
        A.boot(pkg, why, t0);
      });
    },
    /* zweiter Teil des Starts, sobald setup.json gelesen ist (lokale Datei, wenige ms; max. 2 s) */
    boot: function (pkg, why, t0) {
      var st = N.session.load(pkg);
      A.setupError = why || null;
      mark('session');
      N.i18n.set(st.lang || tvLanguage());
      N.accent.apply(st.accent);                       // zuletzt genutzte Akzentfarbe vor dem ersten Bild (kein Farbsprung)
      mark('i18n');
      N.ui.hints.init(chrome);
      N.ui.toast.init(chrome);
      N.ui.mini.init(chrome);                          // M4: Mini-Player (Musik/Hoerbuch beim Stoebern)
      N.ui.rail.init(chrome);
      N.router.init(screens, over);
      N.pointer.init(root, chrome);
      N.pointer.setCursorMode(N.config.cursorMode);
      N.pointer.setEnabled(st.pointer !== false);
      N.pointer.setAccel(st.ptrAccel !== false);         // Randzonen-Rollen beschleunigen (Standard an)
      mark('chrome');
      if (N.devperf) N.devperf.init(root, ctx);         // dev/-Module fehlen im Release-Build (app.min.js)
      N.ui.saver.init(root, chrome);                  // P5: Bildschirmschoner, Uhr auf der Startseite, Willkommenskarte
      N.net.init(); N.ui.netbar.init(chrome);         // P5: Server nicht erreichbar -> Leiste + automatische Wiederholung
      mark('saver+net');
      // SUBTITLE-Taste registriert der Lader nicht -> zur Laufzeit (kein Lader-Update noetig, research 7)
      try { if (ctx.pluginAPI && ctx.tvKey && ctx.tvKey.KEY_SUBTITLE !== undefined) ctx.pluginAPI.registKey(ctx.tvKey.KEY_SUBTITLE); } catch (e0) { N.log('registKey SUBTITLE ' + e0.message); }
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
        if (R.topName() === 'home') return false;
        while (R.topName() !== 'home' && R.depth() > 1) R.back();
        if (R.topName() !== 'home') R.reset('home');
        return true;
      }
      var name = id === 'settings' || id === 'search' || id === 'discover' ? id : 'library';   // P4: Entdecken
      var params = name !== 'library' ? {} : { lib: lib }, tp = R.topParams();
      if (R.topName() === name && (name !== 'library' || (tp && tp.lib && lib && tp.lib.id === lib.id && (tp.lib.srv || '') === (lib.srv || '') && !tp.coll && !tp.actor))) return false;
      if (R.topName() === 'home') R.push(name, params); else R.replace(name, params);
      return true;
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
      N.session.state.lang = l; N.session.save();
      N.i18n.set(l);
      if (N.session.settings) N.session.applyDefaults();   // Ton/UT-Sprache ohne eigene Wahl folgen der Oberflaeche (F12)
      N.router.rebuild();
    },
    /* Beenden/EXIT/onunload: ausstehende Schreibzugriffe (Ausblenden) senden, Protokoll und Speicher sofort schreiben */
    flush: function () {
      try { N.evt.emit('app:flush'); } catch (e) {}
      N.diag.flush(); N.store.flush();
    },
    exit: function () {
      A.flush();
      try { if (ctx.widgetAPI) ctx.widgetAPI.sendReturnEvent(); } catch (e) { N.log('exit ' + e.message); }
    },
    onKey: function (code) {
      var k = N.keys.name(code);
      if (!k) return;
      try {
        if (N.ui.saver.key(k)) return;               // Schoner an: Taste beendet ihn ohne ihre Funktion (SPEC 7.14)
        if (N.devperf && N.devperf.key(k)) return;
        if (N.audio.key(k)) return;                   // M4: globale Medientasten waehrend Musik
        N.router.key(k);
      } catch (e) { N.diag.error('Taste ' + k, e); }
    }
  };
  N.app = A;
  /* TV-Dienste fuer den Player: TV-eigener Bildschirmschoner aus waehrend der Wiedergabe, an in Pause/nach Stop (Orca) */
  N.tv = {
    saver: function (on) {
      try { var p = ctx && ctx.pluginAPI; if (!p) return; if (on) p.setOnScreenSaver(); else p.setOffScreenSaver(); } catch (e) { N.log('saver ' + e.message); }
    }
  };
  /* Schnittstelle zum Lader */
  window.App = { start: A.start, onKey: A.onKey, flush: A.flush };
})(N);
