/* N.Platform – Vertrag der Plattform-Schicht (docs/ARCHITEKTUR.md, docs/research/apple/01-platform.md). Im Manifest direkt
 * hinter core/ext.js (vor core/config.js: config.js liest N.platform.info beim Laden; der Adapter folgt unmittelbar).
 * Eine Plattform (zur Bauzeit gewaehlt: tools/build.js --platform <id>, Standard
 * samsung-orsay) meldet sich mit N.Platform.use(adapter) an; danach ist N.platform das gepruefte Objekt mit allen Feldern:
 *   id, info{platform, platformVersion, device, short, model}   X-Plex-Kopfzeilen, deviceName "<Marke> (<short>)", Protokollkopf
 *   init(ctx)                                              einmal in App.start, vor N.store.init (ctx vom Lader)
 *   keys{name(code, ev), cap{…}, register(names)}           Tastencode -> Tastenname, Tastenkappen, Laufzeit-Registrierung
 *   store(ctx) -> {read, write, probe}                      Speicher-Backend (synchron, wie heute ctx.store)
 *   player{create(onEvent) -> {exec, close, fake}, close(), surface}   Form wie N.sef; optional nowPlaying({title, artist, album, art} | null):
 *                                                           "Wird gespielt" des Geraets (SPEC NAV-26)
 *   tv{saver(on), exit(), language()}                       Geraete-Dienste
 *   screen{toApp(x, y) -> {x, y}, size()}                    Bildschirm- -> App-Koordinaten (Zeiger/Touch); size() -> {w, h}
 *                                                           logische App-Flaeche, nur mit caps.screen.flex (sonst 1280x720);
 *                                                           optional safe {t, r, b, l}: sichere Raender darin (N.screen.safe).
 *                                                           Groessenwechsel meldet die Plattform als N.evt 'screen:changed' {w, h}
 *   caps{…}                                                 Faehigkeiten, an denen der Kern verzweigt (nie am Plattformnamen)
 *   texts(lang, mode)                                       optional: {schluessel: text} ueberlagert N.t fuer dieses Geraet und
 *                                                           die Eingabeart mode ('key' | 'pointer' | 'touch'), z. B. Tasten- und
 *                                                           Geraetenamen (SPEC NAV-26); nur vorhandene Schluessel, gleiche Platzhalter
 *   net{plexTv(httpsUrl) -> url, factory, kind(), native}   Netz-Faehigkeiten; native (optional, sonst null): XHR-Fabrik fuer
 *                                                           Dienste ohne CORS (z. B. Erweiterungen) ueber das Geraet; Kopfzeile
 *                                                           X-Api-Key "pn-secret:<dienst>" setzt dort den Schluessel ein
 *   secret{set, copy, has, remove, clear}                   optional (mit caps.secureStore): Schluessel im sicheren Speicher (nie lesbar),
 *                                                           je (args, cb(err{code}|null, data)); sonst null
 *   haptic{prepare(), select()}                             nur mit caps.haptic: Auswahl-Tick (prepare beim Auflegen, select je Wechsel,
 *                                                           ohne Rueckmeldung, ohne Taptic still); sonst null
 *   auth{web(url, cb), close()}                             nur mit caps.webLogin: Plex-Anmeldeseite im System-Anmeldefenster;
 *                                                           cb(err{code}, {closed, reason: 'cancelled'|'closed'}); sonst null
 * Fehlt ein Pflichtfeld, wirft use() (Bau-/Testfehler, nie still). Fehlende caps-Felder bekommen den Orsay-Wert (alles aus),
 * damit eine neue Plattform nur einschaltet, was sie kann. */
(function (N) {
  var KEYS = ['ENTER', 'RETURN', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'RED', 'GREEN', 'YELLOW', 'BLUE', 'INFO', 'TOOLS',
    'PLAY', 'PAUSE', 'STOP', 'FF', 'RW', 'CH_UP', 'CH_DOWN', 'SUBTITLE', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  var CAPS = ['EXIT', 'DIGITS', 'ENTER', 'INFO', 'TOOLS'];
  /* Standard = heutiges Verhalten des Fernsehers (2014). Jede Abweichung schaltet einen Weg im Kern um (Tabelle im Dokument). */
  function defaults() {
    return {
      tls12: false,            // HTTPS mit TLS >= 1.2: plex.tv direkt, plex.direct-Verbindungen, externe HTTPS-Adressen
      touch: false,            // Touch: Gesten-Schicht, Zurueck-Knopf, kein Verweilen/Randzonen-Rollen des Zeigers
      textInput: false,        // System-Tastatur ueber ein echtes <input> (sonst Ziffernblock/Hex-Block am Bildschirm)
      pip: false,              // Bild in Bild
      secureStore: false,      // Geheimnisse (Tokens, Schluessel) in sicherem Speicher statt in Dateien
      backgroundAudio: false,  // Musik laeuft weiter, wenn die App im Hintergrund ist
      setupFile: true,         // setup.json aus dem App-Paket lesen (Einrichtungsprogramm)
      helper: true,            // Helfer im Heimnetz moeglich (Merkliste, Weitere Server, Anfragen)
      cellular: false,         // Geraet hat Mobilfunk: Zeile "Qualitaet ueber Mobilfunk", Grenze bei Netz ueber Mobilfunk (net.path)
      haptic: false,           // Auswahl-Tick am Finger (N.platform.haptic), z. B. je Buchstabe beim Ziehen ueber die A–Z-Leiste (LIB-12)
      webLogin: false,         // Anmeldung direkt am Geraet auf app.plex.tv (System-Anmeldefenster, N.platform.auth) statt Code
      saverDefault: 5,         // Standard des App-Bildschirmschoners in Minuten (0 = aus); gilt nur, solange das Profil ihn nicht selbst gesetzt hat
      exit: true,              // die App kann sich selbst beenden (Beenden-Dialog, Hinweis "Beenden"); iOS/iPadOS/macOS-Apps nicht
      hintBar: true,           // Hinweisleiste mit Tastenkappen; false = nie, auch nicht mit Tasten (Computer: Mac, Nutzer 03.11.):
                               // Tasten unter Hilfe › Tastenbelegung, Optionen per Rechtsklick (caps.pointer 'mouse'), keine Zeile "Tastenhinweise"
      focusRing: 'always',     // 'always' = Fokus immer sichtbar (TV) | 'keys' = nur nach Tasten; Finger/Maus ohne Rahmen (N.input)
      scroll: 'focus',         // 'focus' = Inhalt folgt dem Fokus (Tasten, Wischen = Schritte) | 'free' = Wischen verschiebt frei (App.pan)
      details: 'page',         // 'page' = Detailansicht als ganze Seite (TV) | 'card' = Karte von unten ueber der abgedunkelten Ansicht,
                               // tiefere Ebenen in der Karte, X/Pfeil oben links, Ziehen nach unten schliesst (N.ui.card, Nr. 9/16)
      home: 'hero',            // Startseite: 'hero' = Infobereich oben (TV) | 'tiles' = nur Kachelreihen ab oben, alle Reihen sichtbar
      homeHero: false,         // nur mit home 'tiles': Einstellung "Infobereich auf der Startseite" – Infobereich wie am TV ueber frei
                               // scrollenden Reihen, wenn Zeiger/Tasten bedienen und die Flaeche hoch genug ist (HOME-18)
      cardTap: 'ok',           // Tipper/Klick auf eine Startseiten-Kachel: 'ok' = wie OK (TV) | 'details' = Details oeffnen
      images: 'tv',            // Bildlader: 'tv' = TV-Regeln (4 Downloads, Pausen nach Tasten, 1 Bild je Frame, Groesse = App-Pixel)
                               // | 'fast' = schnelles Geraet (mehr gleichzeitig, keine Pausen, Vorrat voraus, Stufe x screen.scale)
      pointer: 'remote',       // Zeiger: 'remote' = Zeiger der TV-Fernbedienung (Farbtasten in der Hand: Tastenkappen bleiben,
                               // Touchpad-Druck = Klick, langer Druck = TOOLS) | 'mouse' = Maus/Trackpad/Finger (keine Tastenkappen
                               // bei Zeiger-/Touch-Bedienung, Ziehen auf dem Player-Balken = Scrubbing)
      trick: 'sef',            // Schnellspulen: 'sef' = Trick-Modus des Players, 'seek' = Spruenge, 'none'
      subsEmbedded: 'sef',     // eingebettete Text-UT: 'sef' (Player zeigt sie, Ereignis 19) | 'vtt' (Textspur) | 'burn'
      codecs: {                // Direktwiedergabe; daraus entsteht X-Plex-Client-Profile-Extra (N.decision)
        hevc: false,
        // hevcStream: false = HEVC nur Direct Play, nie kopiert in den HLS-Strom (Apple: HLS-HEVC braucht fMP4) -> Umwandlung;
        // fehlt = wie hevc (N.decision.copyOk, N.Playback.decide)
        h264: { maxBitDepth: 8, maxLevel: 41, maxWidth: 1920, maxHeight: 1088 },
        maxResolution: '1920x1080',
        streamSelection: true, // Tonspur im Direct Play am Geraet waehlen (DirectPlayStreamSelection)
        subtitleTarget: 'srt'  // externe Untertitel als SRT anfordern
      },
      // App-Raster 1280x720; scale = Pixel je App-Pixel. flex: logische Flaeche W x H >= 1280x720 fuellt den Bildschirm
      // (Apple, 08-touch.md 8b); w/h sind dann die Mindestgroesse (Querformat 1280x720), die aktuelle liefert screen.size() (N.screen)
      screen: { w: 1280, h: 720, scale: 1, safe: { t: 0, r: 0, b: 0, l: 0 }, flex: false }
    };
  }
  function isFn(f) { return typeof f === 'function'; }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function mergeCaps(c) {
    var d = defaults(), k;
    c = c || {};
    for (k in c) if (has(c, k)) d[k] = c[k];
    var cd = defaults().codecs;                       // codecs/screen feldweise ergaenzen
    for (k in cd) if (has(cd, k) && !has(d.codecs, k)) d.codecs[k] = cd[k];
    var sd = defaults().screen;
    for (k in sd) if (has(sd, k) && !has(d.screen, k)) d.screen[k] = sd[k];
    return d;
  }
  /* Vertrag pruefen -> Liste der Fehler (leer = ok). Rein, getestet. */
  function check(p) {
    var e = [];
    if (!p || typeof p !== 'object') return ['Plattform fehlt'];
    if (typeof p.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.id)) e.push('id fehlt oder ungueltig');
    var i = p.info || {};
    ['platform', 'platformVersion', 'device', 'short'].forEach(function (k) { if (typeof i[k] !== 'string' || !i[k]) e.push('info.' + k + ' fehlt'); });
    if (!isFn(p.init)) e.push('init(ctx) fehlt');
    if (!p.keys || !isFn(p.keys.name)) e.push('keys.name(code, ev) fehlt');
    if (p.keys && !isFn(p.keys.register)) e.push('keys.register(names) fehlt');
    if (p.keys) CAPS.forEach(function (k) { if (!p.keys.cap || typeof p.keys.cap[k] !== 'string') e.push('keys.cap.' + k + ' fehlt'); });
    if (!isFn(p.store)) e.push('store(ctx) fehlt');
    if (!p.player || !isFn(p.player.create) || !isFn(p.player.close)) e.push('player.create/close fehlt');
    if (p.player && p.player.surface !== 'plane' && p.player.surface !== 'element') e.push('player.surface muss plane|element sein');
    if (!p.tv || !isFn(p.tv.saver) || !isFn(p.tv.exit) || !isFn(p.tv.language)) e.push('tv.saver/exit/language fehlt');
    if (!p.screen || !isFn(p.screen.toApp)) e.push('screen.toApp fehlt');
    if (!p.net || !isFn(p.net.plexTv) || !isFn(p.net.kind)) e.push('net.plexTv/kind fehlt');
    if (p.net && p.net.factory !== null && p.net.factory !== undefined && !isFn(p.net.factory)) e.push('net.factory muss Funktion oder null sein');
    if (p.texts !== undefined && p.texts !== null && !isFn(p.texts)) e.push('texts muss Funktion sein');
    var c = mergeCaps(p.caps);
    ['tls12', 'touch', 'textInput', 'pip', 'secureStore', 'backgroundAudio', 'setupFile', 'helper', 'webLogin', 'cellular', 'haptic', 'exit', 'hintBar', 'homeHero'].forEach(function (k) {
      if (typeof c[k] !== 'boolean') e.push('caps.' + k + ' muss true/false sein');
    });
    if (['sef', 'seek', 'none'].indexOf(c.trick) < 0) e.push('caps.trick ungueltig');
    if (['remote', 'mouse'].indexOf(c.pointer) < 0) e.push('caps.pointer muss remote|mouse sein');
    if (!(typeof c.saverDefault === 'number' && c.saverDefault >= 0)) e.push('caps.saverDefault muss Minuten >= 0 sein');
    if (['sef', 'vtt', 'burn'].indexOf(c.subsEmbedded) < 0) e.push('caps.subsEmbedded ungueltig');
    if (['always', 'keys'].indexOf(c.focusRing) < 0) e.push('caps.focusRing muss always|keys sein');
    if (['focus', 'free'].indexOf(c.scroll) < 0) e.push('caps.scroll muss focus|free sein');
    if (['page', 'card'].indexOf(c.details) < 0) e.push('caps.details muss page|card sein');
    if (['hero', 'tiles'].indexOf(c.home) < 0) e.push('caps.home muss hero|tiles sein');
    if (c.homeHero === true && c.home !== 'tiles') e.push('caps.homeHero nur mit caps.home tiles');
    if (['ok', 'details'].indexOf(c.cardTap) < 0) e.push('caps.cardTap muss ok|details sein');
    if (['tv', 'fast'].indexOf(c.images) < 0) e.push('caps.images muss tv|fast sein');
    if (typeof c.screen.flex !== 'boolean') e.push('caps.screen.flex muss true/false sein');
    else if (c.screen.flex) {
      // w/h = Mindestgroesse der logischen Flaeche (Querformat 1280x720; Hochformat spaeter schmaler, Nr. 16)
      if (!(c.screen.scale > 0) || !(c.screen.w >= 360) || !(c.screen.h >= 360)) e.push('caps.screen: flexible Mindestflaeche >= 360x360, scale > 0');
      if (!p.screen || !isFn(p.screen.size)) e.push('caps.screen.flex braucht screen.size()');
    } else if (!(c.screen.scale > 0) || c.screen.w !== 1280 || c.screen.h !== 720) e.push('caps.screen: App-Raster 1280x720, scale > 0');
    if (!c.tls12 && c.setupFile === false) e.push('ohne TLS 1.2 braucht die Plattform setup.json (caps.setupFile)');
    if (c.secureStore && !c.tls12) e.push('caps.secureStore ohne tls12 ist nicht vorgesehen');
    if (p.auth && (!isFn(p.auth.web) || !isFn(p.auth.close))) e.push('auth.web/close fehlt');
    if (c.webLogin === true && !p.auth) e.push('caps.webLogin braucht auth.web/close');
    if (c.haptic === true && (!p.haptic || !isFn(p.haptic.prepare) || !isFn(p.haptic.select))) e.push('caps.haptic braucht haptic.prepare/select');
    if (c.webLogin === true && !c.tls12) e.push('caps.webLogin ohne tls12 ist nicht vorgesehen');
    if (p.net && p.net.native !== null && p.net.native !== undefined && !isFn(p.net.native)) e.push('net.native muss Funktion oder null sein');
    if (p.secret && ['set', 'copy', 'has', 'remove', 'clear'].some(function (k) { return !isFn(p.secret[k]); })) e.push('secret.set/copy/has/remove/clear fehlt');
    return e;
  }
  N.Platform = {
    KEYS: KEYS,
    defaults: defaults,
    caps: mergeCaps,
    check: check,
    /* Anmeldung der zur Bauzeit gewaehlten Plattform; wirft bei Vertragsfehlern */
    use: function (p) {
      var e = check(p);
      if (e.length) throw new Error('N.platform ' + (p && p.id) + ': ' + e.join('; '));
      p.caps = mergeCaps(p.caps);
      if (p.net.factory === undefined) p.net.factory = null;
      if (p.net.native === undefined) p.net.native = null;
      if (!p.auth) p.auth = null;
      if (!p.secret) p.secret = null;
      if (!p.caps.haptic || !p.haptic) p.haptic = null;   // Kern fragt nur N.platform.haptic (null = kein Tick)
      N.platform = p;
      return p;
    }
  };
})(N);
