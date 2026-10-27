/* Lader (ES5, Samsung Orsay 2014).
 * Aufgaben: Samsung-APIs initialisieren, Tasten registrieren, dauerhaften Speicher
 * bereitstellen, App-Code laden (Entwicklungs-/Update-Server, sonst lokale Kopie).
 */
var Boot = (function () {
  // DEV_HOST wird von tools/dev.py gesetzt: leer = normale Version (nur lokaler Code, kein Warten),
  // IP = Entwicklungs-Version (Code + Logs vom Mac, mit kurzer Wartezeit und lokalem Rueckfall).
  var DEV_HOST = '';
  var APP_URL = 'http://' + DEV_HOST + ':8090/app.js';
  var LOG_URL = 'http://' + DEV_HOST + ':8099/log';
  var DEV_TIMEOUT = 1500;
  var STORE_DIR = 'plexneo';                // fester, versionsunabhaengiger Pfad
  var widgetAPI = null, pluginAPI = null, tvKey = null;
  var logBuf = [], logBusy = false, logTimer = 0;

  function now() { return new Date().getTime(); }

  function flushLog() {
    logTimer = 0;
    if (logBusy || !logBuf.length) return;
    var body = logBuf.splice(0, 200).join('\n'), x;
    try {
      x = new XMLHttpRequest();
      logBusy = true;
      var t = setTimeout(function () { try { x.abort(); } catch (e) {} logBusy = false; }, 3000);
      x.onreadystatechange = function () {
        if (x.readyState === 4) { clearTimeout(t); logBusy = false; if (logBuf.length) schedule(); }
      };
      x.open('POST', LOG_URL, true);
      x.setRequestHeader('Content-Type', 'text/plain');
      x.send(body);
    } catch (e) { logBusy = false; }
  }
  function schedule() { if (!logTimer) logTimer = setTimeout(flushLog, 500); }
  function log(msg) {
    if (!DEV_HOST) return;                  // normale Version: keine Logs ins Netz
    if (logBuf.length > 1000) logBuf.shift();
    logBuf.push(now() + ' ' + msg);
    schedule();
  }

  /* ---------- dauerhafter Speicher ---------- */
  var Store = {
    fs: null,
    init: function () {
      try {
        this.fs = new FileSystem();
        if (!this.fs.isValidCommonPath(STORE_DIR)) this.fs.createCommonDir(STORE_DIR);
      } catch (e) { log('store init error ' + e.message); this.fs = null; }
    },
    read: function (name) {
      var v = null, f;
      if (this.fs) {
        try {
          f = this.fs.openCommonFile(STORE_DIR + '/' + name, 'r');
          if (f) { v = f.readAll(); this.fs.closeCommonFile(f); }
        } catch (e) { log('store read error ' + name + ' ' + e.message); }
      }
      if (v === null || v === undefined || v === '') {
        try { v = window.localStorage ? localStorage.getItem('plexneo.' + name) : null; } catch (e2) { v = null; }
      }
      return v;
    },
    write: function (name, text) {
      var ok = false, f;
      if (this.fs) {
        try {
          f = this.fs.openCommonFile(STORE_DIR + '/' + name, 'w');
          if (f) { f.writeAll(text); this.fs.closeCommonFile(f); ok = true; }
        } catch (e) { log('store write error ' + name + ' ' + e.message); }
      }
      try { if (window.localStorage) localStorage.setItem('plexneo.' + name, text); } catch (e2) {}
      return ok;
    },
    /* Testhilfe: Quelle einzeln pruefen */
    probe: function (name) {
      var r = { file: null, local: null }, f;
      try {
        f = this.fs && this.fs.openCommonFile(STORE_DIR + '/' + name, 'r');
        if (f) { r.file = f.readAll(); this.fs.closeCommonFile(f); }
      } catch (e) {}
      try { r.local = window.localStorage ? localStorage.getItem('plexneo.' + name) : null; } catch (e2) {}
      return r;
    }
  };

  /* ---------- App laden ---------- */
  function loadScript(url, timeoutMs, done) {
    var s = document.createElement('script'), finished = false;
    function fin(ok) { if (finished) return; finished = true; done(ok); }
    var t = setTimeout(function () { fin(false); }, timeoutMs);
    s.type = 'text/javascript';
    s.onload = function () { clearTimeout(t); fin(!!window.App); };
    s.onerror = function () { clearTimeout(t); fin(false); };
    s.src = url;
    document.getElementsByTagName('head')[0].appendChild(s);
  }

  function startApp(source) {
    log('app source: ' + source);
    if (window.App && App.start) {
      try { App.start({ source: source, log: log, store: Store, widgetAPI: widgetAPI, pluginAPI: pluginAPI, tvKey: tvKey }); }
      catch (e) { log('App.start error ' + e.message); }
    }
  }

  function registerKeys() {
    try {
      var keys = ['KEY_RED', 'KEY_GREEN', 'KEY_YELLOW', 'KEY_BLUE', 'KEY_PLAY', 'KEY_PAUSE', 'KEY_STOP', 'KEY_FF', 'KEY_RW',
        'KEY_INFO', 'KEY_TOOLS', 'KEY_0', 'KEY_1', 'KEY_2', 'KEY_3', 'KEY_4', 'KEY_5', 'KEY_6', 'KEY_7', 'KEY_8', 'KEY_9'];
      for (var i = 0; i < keys.length; i++) if (tvKey[keys[i]] !== undefined) pluginAPI.registKey(tvKey[keys[i]]);
      // Lautstaerke & Mute dem TV ueberlassen
      pluginAPI.unregistKey(tvKey.KEY_VOL_UP); pluginAPI.unregistKey(tvKey.KEY_VOL_DOWN); pluginAPI.unregistKey(tvKey.KEY_MUTE);
      var nn = document.getElementById('pluginObjectNNavi'); if (nn && nn.SetBannerState) nn.SetBannerState(1);
      log('keys registered');
    } catch (e) { log('registerKeys error ' + e.message); }
  }

  return {
    log: log,
    store: Store,
    onload: function () {
      try {
        widgetAPI = new Common.API.Widget();
        pluginAPI = new Common.API.Plugin();
        tvKey = new Common.API.TVKeyValue();
      } catch (e) { log('Samsung API error ' + e.message); }
      window.onShow = registerKeys;
      try { widgetAPI.sendReadyEvent(); } catch (e2) {}
      document.getElementById('anchor').focus();
      log('boot ' + (navigator.userAgent || ''));
      Store.init();
      var started = now();
      function local() { loadScript('app.js', 3000, function (ok2) { startApp(ok2 ? 'lokal ' + (now() - started) + 'ms' : 'FEHLT'); }); }
      if (!DEV_HOST) { local(); return; }   // normale Version: sofort lokal starten
      loadScript(APP_URL + '?t=' + started, DEV_TIMEOUT, function (ok) {
        if (ok) { startApp('dev ' + (now() - started) + 'ms'); return; }
        local();
      });
    },
    onKey: function () {
      var e = window.event, code = e ? e.keyCode : 0;
      if (tvKey && code === tvKey.KEY_RETURN) { try { widgetAPI.blockNavigation(e); } catch (x) {} }
      if (tvKey && code === tvKey.KEY_EXIT) {           // App beenden lassen; vorher Speicher/Ausblenden der App sichern
        log('exit');
        if (window.App && App.flush) { try { App.flush(); } catch (err0) { log('flush error ' + err0.message); } }
        flushLog(); return;
      }
      if (window.App && App.onKey) { try { App.onKey(code, e); } catch (err) { log('onKey error ' + err.message); } }
    },
    exit: function () { try { widgetAPI.sendReturnEvent(); } catch (e) {} }
  };
})();
