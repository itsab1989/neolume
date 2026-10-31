/* N.config – feste Werte + ueberschreibbar per Store-Datei config.json ({"proxyHost":"ip:port","pms":"http://ip:32400"}).
 * Netz-Standards sind im Repo leer: tools/build.js setzt die lokalen Werte aus local.json (git-ignoriert) ins gebaute app.js. */
(function (N) {
  var C = {
    version: '1.0.9',
    product: N.brand.name,
    platform: 'Samsung',
    platformVersion: 'Orsay 2014',
    device: 'Samsung TV',
    deviceName: N.brand.name + ' (TV)',
    proxyHost: '',                      // LAN-Proxy fuer plex.tv (TLS kann der TV nicht), aus local.json / config.json
    pmsFallback: '',                    // http://<PMS-IP>:32400, aus local.json / config.json
    watchedThreshold: 0.9,
    /* Zeiger-Darstellung: 'B' (Standard) = eigenes Amber-Pfeil-Element per translate3d, 'A' = CSS-cursor:url(pointer.png)
     * (am TV wirkungslos: Orsay zeichnet den Smart-Control-Punkt selbst, docs/research/pointer.md), 'system' = nur Systempunkt.
     * Dev: Tastenfolge TOOLS,TOOLS schaltet A -> B -> system. Ueberschreibbar in config.json {"cursor":"A"} */
    cursorMode: 'system',   // Nutzer 26.10.: nur der TV-Punkt (eigener Pfeil haengt nach, Punkt nicht ausblendbar)
    readOnly: false,
    helperUrl: '',                      // P4: optionaler Helfer fuer die Merkliste (nur Entwicklung; im Alltag setup.json "helper")
    helperKey: '',
    cropBase: 'app',
    logHost: '',                        // "Protokoll senden" (Dev-/Update-Server, tools/dev.py serve), aus local.json / config.json
    model: 'UE48H8000',              // SPEC 6.4
    /* HLS-Start (Umwandlung) – A/B-Schalter fuer den TV-Test (docs/research/player.md 3.5).
     * wait: Pause vor InitPlayer (ms). Orca wartet 1000 ms; am TV gemessen (26.10.) startet HEVC->H.264 in 2,6 s, Direct Play 1,7 s,
     * Fortsetzen mit eingebrannten UT 4,6 s – die Sekunde ist fast die Haelfte davon. Standard jetzt 300 ms, per config.json
     * {"hlsWait":1000} zurueck. {"hlsFast":true} schaltet alle Kandidaten zugleich ein; einzeln ueberschreibbar. */
    hls: { wait: 300, startBitrate: 0, offset: false, eac3: false, incomplete: false, buf: null },
    apply: function (o) {
      if (!o) return;
      if (C.validHost(o.proxyHost)) C.proxyHost = o.proxyHost;
      if (o.readOnly === true) C.readOnly = true;
      if (C.validHost(o.logHost)) C.logHost = o.logHost;
      if (o.cursor === 'A' || o.cursor === 'B' || o.cursor === 'system') C.cursorMode = o.cursor;
      if (o.sefFake === 'still') C.sefFake = 'still';                 // Vorschau/visuelle Tests: stehendes Bild
      if (Number(o.seekDelay) > 0) C.seekDelay = Number(o.seekDelay);  // nur Tests: Sammel-Sprung haelt an
      if (Number(o.fakeEndMs) > 0) C.fakeEndMs = Number(o.fakeEndMs);   // nur Bildtests (ohne SEF): Video endet ms nach dem Start (Karte am Ende mit Rueckzaehler)
      if (Number(o.ptrEdgeDwell) > 0) C.ptrEdgeDwell = Number(o.ptrEdgeDwell);   // nur Tests: Zeiger-Randzone zeigt nur die Pille
      if (/^#[0-9A-Fa-f]{6}$/.test(o.fakeBg || '')) C.fakeBg = o.fakeBg;   // nur Bildtests: Farbe des Video-Platzhalters (helles Bild, Feinauswahl)
      if (typeof o.fakeSub === 'string' && o.fakeSub.length < 120) C.fakeSub = o.fakeSub;   // nur Bildtests (stehendes Bild): feste Untertitel-Zeile
      if (o.hlsFast === true) C.hls = { wait: 0, startBitrate: 5000000, offset: true, eac3: true, incomplete: true, buf: null };
      var H = C.hls;
      if (o.hlsWait !== undefined && Number(o.hlsWait) >= 0) H.wait = Number(o.hlsWait);
      if (o.hlsStartBitrate !== undefined && Number(o.hlsStartBitrate) >= 0) H.startBitrate = Number(o.hlsStartBitrate);
      if (typeof o.hlsOffset === 'boolean') H.offset = o.hlsOffset;
      if (typeof o.hlsEac3 === 'boolean') H.eac3 = o.hlsEac3;
      if (typeof o.hlsIncomplete === 'boolean') H.incomplete = o.hlsIncomplete;
      if (o.hlsBuf && typeof o.hlsBuf === 'object') H.buf = { init: Number(o.hlsBuf.init) || 0, pending: Number(o.hlsBuf.pending) || 0, total: Number(o.hlsBuf.total) || 0 };
      if (typeof o.fixedClock === 'string' && /^\d\d:\d\d$/.test(o.fixedClock)) C.fixedClock = o.fixedClock;   // nur visuelle Tests: feste Uhr
      if (Number(o.hintMs) > 0) C.hintMs = Number(o.hintMs);         // nur Tests: Tastenhinweise "Nur kurz" blenden nach ms aus
      if (o.welcome === false) C.welcome = false;                     // nur Tests: keine Willkommenskarte
      if (Number(o.saverMs) > 0) C.saverMs = Number(o.saverMs);
      if (Number(o.newsHoldMs) > 0) C.newsHoldMs = Number(o.newsHoldMs);       // nur Bildtests: Hinweis bei neuen Inhalten fruehestens nach ms
      if (Number(o.newsShowMs) > 0) C.newsShowMs = Number(o.newsShowMs);       // nur Bildtests: Hinweis bleibt ms stehen
      if (o.newsSettleMs !== undefined && Number(o.newsSettleMs) >= 0) C.newsSettleMs = Number(o.newsSettleMs);   // nur Bildtests: Ruhe im Video vor dem Hinweis
      if (Number(o.saverIvMs) > 0) C.saverIvMs = Number(o.saverIvMs);   // nur Bildtests: Bildwechsel/Wandern der Einblendung nach ms
      if (Number(o.saverNightMs) > 0) C.saverNightMs = Number(o.saverNightMs);
      if (o.saverZOnly === true) C.saverZOnly = true;   // nur TV-Gegenprobe: Schoner-Ebenen nur per z-index stapeln (wie bis 1.0.7)   // nur Tests/TV-Langlauf (P7 C2): Nachtruhe des Schoners nach ms statt Stunden
      if (o.saverPos >= 0 && o.saverPos <= 3) C.saverPos = Math.floor(o.saverPos);   // nur Bildtests: Lage der Schoner-Einblendung (0..3)       // nur visuelle Tests: Schoner nach ms statt Minuten
      // Schnellspulen (PLAY-32): Stufen fuer den TV-Test, z. B. [2,4,8,16,32]; N.trick.speeds prueft (Vielfache von 2, 2…64), Standard 2/4/8/16
      if (Object.prototype.toString.call(o.trickSpeeds) === '[object Array]' && o.trickSpeeds.length) C.trickSpeeds = o.trickSpeeds.slice(0, 8);   // nur eine Liste (kein Text "2,4")
      if (o.cropBase === 'video' || o.cropBase === 'app') C.cropBase = o.cropBase;   // Zoom: Koordinaten fuer SetCropArea (A/B)
      if (typeof o.helperUrl === 'string' && /^http:\/\/[0-9.]+(:\d{1,5})?\/?$/.test(o.helperUrl)) C.helperUrl = o.helperUrl;   // P4: Merkliste-Helfer (Entwicklung; sonst setup.json)
      if (typeof o.helperKey === 'string' && /^[A-Za-z0-9_\-]{16,128}$/.test(o.helperKey)) C.helperKey = o.helperKey;
      if (typeof o.pms === 'string' && /^http:\/\/[A-Za-z0-9.\-]+(:\d{1,5})?\/*$/.test(o.pms)) C.pmsFallback = o.pms.replace(/\/+$/, '');
    },
    /* host[:port][/pfad] – kein Schema, keine Zugangsdaten (@), keine Query/Fragmente (Sicherheits-Review) */
    validHost: function (h) { return typeof h === 'string' && /^[A-Za-z0-9.\-]+(:\d{1,5})?(\/[A-Za-z0-9._\-\/]*)?$/.test(h); },
    proxy: function (httpsUrl) { return 'http://' + C.proxyHost + '/?url=' + encodeURIComponent(httpsUrl); }
  };
  N.config = C;
})(N);
