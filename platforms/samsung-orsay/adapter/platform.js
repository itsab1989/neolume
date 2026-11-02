/* N.platform fuer Samsung Orsay 2014 (Standard-Plattform; Vertrag src/platform/platform.js, docs/research/apple/01-platform.md).
 * Der heutige Orsay-Code hinter N.platform, OHNE Verhaltensaenderung: jede Funktion ist eine woertliche Kopie der heutigen
 * Stelle (Quelle je Feld im Kommentar) bzw. reicht an das heutige Modul weiter (N.sef, N.config.proxy). Verweise auf N.sef und
 * N.config erst beim Aufruf, damit die Lade-Reihenfolge im Manifest keine Rolle spielt. Die Tasten-Tabelle ist die einzige
 * Quelle der Orsay-Codes (src/core/keys.js kennt nur Namen; tests/platform.test.js haelt die verifizierten Werte fest). */
(function (N) {
  var ctx = {};
  /* Samsung-Orsay-Tastencodes (am TV verifiziert, docs/PHASE1-ERGEBNISSE.md; bis P1 C4 in src/core/keys.js) */
  var CODES = {
    29443: 'ENTER', 88: 'RETURN', 29460: 'UP', 29461: 'DOWN', 4: 'LEFT', 5: 'RIGHT',
    108: 'RED', 20: 'GREEN', 21: 'YELLOW', 22: 'BLUE', 31: 'INFO', 75: 'TOOLS',
    71: 'PLAY', 74: 'PAUSE', 70: 'STOP', 72: 'FF', 69: 'RW', 68: 'CH_UP', 65: 'CH_DOWN', 652: 'SUBTITLE',
    17: '0', 101: '1', 98: '2', 6: '3', 8: '4', 9: '5', 10: '6', 12: '7', 13: '8', 14: '9'
  };
  function log(m) { if (N.log) N.log(m); }
  N.Platform.use({
    id: 'samsung-orsay',
    /* heute src/core/config.js Zeile 7–10 und 23; short = Klammer in deviceName ("<Marke> (TV)") */
    info: { platform: 'Samsung', platformVersion: 'Orsay 2014', device: 'Samsung TV', short: 'TV', model: 'UE48H8000' },
    init: function (c) { ctx = c || {}; },
    keys: {
      name: function (code) { return CODES[code] || null; },
      /* Tastenkappen (SPEC 5.11), von N.keys.cap uebernommen */
      cap: { INFO: 'INFO', TOOLS: 'TOOLS', EXIT: 'EXIT', DIGITS: '0–9', ENTER: 'OK' },
      /* heute src/app.js Zeile 89–91: SUBTITLE/CH▲/CH▼ registriert der Lader nicht -> zur Laufzeit */
      register: function (names) {
        for (var i = 0; i < names.length; i++) {
          var k = 'KEY_' + names[i];
          try { if (ctx.pluginAPI && ctx.tvKey && ctx.tvKey[k] !== undefined) ctx.pluginAPI.registKey(ctx.tvKey[k]); } catch (e0) { log('registKey ' + k + ' ' + e0.message); }
        }
      },
      CODES: CODES                                         // nur Tests/Werkzeuge (tools/preview.html bildet Tastatur darauf ab)
    },
    /* heute src/app.js Zeile 52: Lader-Speicher (Common-Dir + localStorage, loader/boot.js Zeile 43–85) */
    store: function (c) { return (c && c.store) || { read: function () { return null; }, write: function () {} }; },
    player: {
      create: function (onEvent) { return N.sef.create(onEvent); },   // sef.js (dieser Ordner)
      close: function () { N.sef.close(); },
      surface: 'plane'                                     // Video liegt HINTER der Seite (Hintergrund transparent, views/player.js 199)
    },
    tv: {
      /* heute src/app.js Zeile 195–199 */
      saver: function (on) {
        try { var p = ctx && ctx.pluginAPI; if (!p) return; if (on) p.setOnScreenSaver(); else p.setOffScreenSaver(); } catch (e) { log('saver ' + e.message); }
      },
      /* heute src/app.js Zeile 180 (A.flush() davor bleibt in App.exit) */
      exit: function () { try { if (ctx.widgetAPI) ctx.widgetAPI.sendReturnEvent(); } catch (e) { log('exit ' + e.message); } },
      /* heute src/app.js Zeile 22–23: Rohwert der TV-Sprache (TVMW), '' wenn keiner; navigator-Rueckfall bleibt in app.js */
      language: function () {
        var raw = '';
        try { var tv = typeof document !== 'undefined' && document.getElementById('pluginObjectTVMW'); if (tv && tv.GetLanguage) raw = tv.GetLanguage(); } catch (e) {}
        return raw;
      }
    },
    screen: { toApp: function (x, y) { return { x: x, y: y }; } },   // 1280x720 nativ (loader/index.html, widget.info)
    caps: {},                                              // alles Standard (N.Platform.defaults = Fernseher 2014)
    net: {
      plexTv: function (httpsUrl) { return N.config.proxy(httpsUrl); },   // heute src/plex/client.js Zeile 79 (LAN-TLS-Proxy)
      factory: null,                                       // XMLHttpRequest wie heute (src/net/http.js Zeile 9)
      kind: function () { return 'lan'; }
    }
  });
})(N);
