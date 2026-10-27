/* N.setupFile – setup.json aus dem App-Paket (vom Einrichtungsprogramm installer/plexneo_setup.py, Schema: installer/README.md).
 * Liegt im Wurzelverzeichnis des installierten Pakets neben index.html und wird beim Start per XHR (relativ, file://) gelesen.
 * Ist sie da und gueltig, arbeitet die App im Alltag NUR mit dem PMS (kein plex.tv, kein Proxy): Server-Adresse, machineId,
 * Profile mit server-gebundenem Token je Profil. Tokens bleiben im Paket und im Speicher, sie werden nie in den Store geschrieben.
 * Fehlt sie (Entwicklungs-Paket von tools/dev.py), gilt der alte Ablauf mit plex.tv-PIN-Anmeldung ueber den Proxy.
 * parse(text) -> {ok:true, cfg} | {ok:false, reason}. reason: json|kind|newer|schema|server|uri|profiles|profile|token|dup|owner|friend
 * Freigabe-Konten ausserhalb von Plex Home ("Freunde", kind 'friend' bzw. uuid 'friend-<id>') legte ein aelteres Einrichtungsprogramm
 * mit an; die App uebernimmt sie nicht mehr (Nutzerentscheidung 27.10.): uebersprungen mit Grund 'friend', Token bleibt ungenutzt.
 * App-PINs gehoeren zum Server (machineIdentifier) und bleiben bei erneuter Einrichtung erhalten; "resetAppPins": true (Kaestchen
 * "App-PINs zuruecksetzen" im Einrichtungsprogramm) loescht sie einmal je Einrichtung (createdAt), Weg bei vergessener Hauptprofil-PIN. */
(function (N) {
  var RP = { '': 1, little_kid: 1, older_kid: 1, teen: 1 }, KINDS = { owner: 1, home: 1 };
  var TOKEN = /^[A-Za-z0-9_.~\-]{8,256}$/, MID = /^[A-Za-z0-9\-]{8,128}$/, UUID = /^[A-Za-z0-9\-]{1,64}$/, CID = /^[A-Za-z0-9._\-]{1,128}$/;

  /* nur private IPv4-Adressen im Heimnetz (RFC 1918 + Link-Local, dazu Loopback = das Geraet selbst; Vorschau/Tests):
   * Tokens gehen unverschluesselt per http an den PMS, also nie an oeffentliche Adressen oder Namen */
  function lanIp(host) {
    var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (!m) return false;
    var a = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
    for (var i = 0; i < 4; i++) if (a[i] > 255) return false;
    return a[0] === 10 || a[0] === 127 || (a[0] === 172 && a[1] >= 16 && a[1] <= 31) || (a[0] === 192 && a[1] === 168) || (a[0] === 169 && a[1] === 254);
  }
  /* http://<private IPv4>[:port][/pfad] -> normiert ohne Schraegstrich am Ende, sonst null (kein https: kann der TV nicht) */
  function lanUri(u) {
    var m = typeof u === 'string' && /^http:\/\/([0-9.]+)(?::(\d{1,5}))?((?:\/[A-Za-z0-9_\-]+)*)\/?$/.exec(u);
    if (!m || !lanIp(m[1])) return null;
    var port = m[2] ? Number(m[2]) : 80;
    if (port < 1 || port > 65535) return null;
    return 'http://' + m[1] + (m[2] ? ':' + port : '') + (m[3] || '');
  }
  function str(v, max) { return typeof v === 'string' ? v.replace(/^\s+|\s+$/g, '').substring(0, max) : ''; }
  function bad(reason) { return { ok: false, reason: reason }; }

  function parse(text) {
    var d;
    try { d = typeof text === 'string' ? JSON.parse(text) : null; } catch (e) { d = null; }
    if (!d || typeof d !== 'object') return bad('json');
    if (d.kind !== 'plexneo-setup') return bad('kind');
    if (typeof d.schema === 'number' && d.schema > 1) return bad('newer');      // neueres Einrichtungsprogramm -> erneut einrichten
    if (d.schema !== 1) return bad('schema');
    var s = d.server;
    if (!s || typeof s !== 'object' || typeof s.machineIdentifier !== 'string' || !MID.test(s.machineIdentifier)) return bad('server');
    var uris = [];
    for (var i = 0; s.uris && i < s.uris.length; i++) { var lu = lanUri(s.uris[i]); if (lu && uris.indexOf(lu) < 0) uris.push(lu); }
    if (!uris.length) return bad('uri');                                       // keine (oder nur oeffentliche/https) Adressen
    if (!d.profiles || !d.profiles.length || d.profiles.length > 24) return bad('profiles');
    var profiles = [], seen = {}, owners = 0, skipped = [];
    for (i = 0; i < d.profiles.length; i++) {
      var p = d.profiles[i];
      if (p && typeof p === 'object' && (p.kind === 'friend' || (typeof p.uuid === 'string' && p.uuid.indexOf('friend-') === 0))) { skipped.push('friend'); continue; }
      // fehlerhaftes einzelnes Profil ueberspringen statt die ganze Einrichtung zu verwerfen (TV-Test 27.10.: Freund ohne uuid)
      if (!p || typeof p !== 'object' || typeof p.uuid !== 'string' || !UUID.test(p.uuid) || !KINDS[p.kind] || !str(p.title, 64)) { skipped.push('profile'); continue; }
      if (typeof p.token !== 'string' || !TOKEN.test(p.token)) { skipped.push('token'); continue; }
      if (seen[p.uuid]) { skipped.push('dup'); continue; }
      seen[p.uuid] = true;
      if (p.kind === 'owner') owners++;
      var thumb = typeof p.thumb === 'string' && /^https:\/\/[^\s"'<>]+$/.test(p.thumb) ? p.thumb : '';
      profiles.push({ id: typeof p.id === 'number' ? p.id : 0, uuid: p.uuid, title: str(p.title, 64), thumb: thumb, kind: p.kind,
        restricted: p.restricted === true, rp: RP[p.restrictionProfile] && typeof p.restrictionProfile === 'string' ? p.restrictionProfile : '', token: p.token });
    }
    if (!profiles.length) return bad(skipped[0] || 'profiles');
    if (owners > 1) return bad('owner');
    var c = d.computer, computer = null;
    if (c && typeof c === 'object' && typeof c.address === 'string' && lanIp(c.address)) {
      computer = { address: c.address, updatePort: typeof c.updatePort === 'number' && c.updatePort > 0 && c.updatePort < 65536 ? c.updatePort : 0 };
    }
    var hp = d.helper, helper = null;                                          // P4: optionaler Merkliste-Helfer (docs/research/discover.md)
    if (hp && typeof hp === 'object' && lanUri(hp.url)) helper = { url: lanUri(hp.url), key: typeof hp.key === 'string' && /^[A-Za-z0-9_\-]{16,128}$/.test(hp.key) ? hp.key : '' };
    return { ok: true, cfg: {
      schema: 1, createdAt: str(d.createdAt, 40), setupVersion: str(d.setupVersion, 20),
      clientId: typeof d.clientIdentifier === 'string' && CID.test(d.clientIdentifier) ? d.clientIdentifier : '',
      server: { machineId: s.machineIdentifier, name: str(s.name, 64), uris: uris }, profiles: profiles, computer: computer, helper: helper,
      id: str(d.createdAt, 40) + '|' + s.machineIdentifier,                    // Kennung dieser Einrichtung
      resetPins: d.resetAppPins === true,                                        // App-PINs einmal zuruecksetzen (s. oben)
      skipped: skipped                                                           // Gruende uebersprungener Profile (Protokoll)
    } };
  }

  /* Profile -> Benutzerliste wie N.auth.normUsers (kind: main/kid/teen/''), pin = App-PIN gesetzt (pinOf(uuid)) */
  function users(cfg, pinOf) {
    var out = [];
    for (var i = 0; i < cfg.profiles.length; i++) {
      var p = cfg.profiles[i], kind = p.kind === 'owner' ? 'main' : p.rp === 'teen' ? 'teen' : p.rp === 'little_kid' || p.rp === 'older_kid' ? 'kid' : '';
      out.push({ id: p.id, uuid: p.uuid, name: p.title, thumb: p.thumb, admin: p.kind === 'owner', restricted: p.restricted, rp: p.rp,
        pin: !!(pinOf && pinOf(p.uuid)), kind: kind, src: p.kind });
    }
    return out;
  }

  /* Datei lesen: ctx.setupText (Vorschau/Tests; null = keine Datei) oder XHR 'setup.json' relativ zur Paketseite.
   * cb(cfg|null, reason|null): keine Datei -> (null, null); ungueltig -> (null, reason). Nie laenger als ~2 s.
   * P7 27.10.: am TV kostete der erste Start hier 538–646 ms (spaeter ~20 ms). Die Anfrage startet deshalb schon beim Auswerten
   * von app.js (prefetch, Modul steht frueh im Manifest) und laeuft parallel zum restlichen Skript; read() haengt sich an.
   * timing: {io: Senden->Antwort, early: Vorlauf vor read(), gap: groesste Hauptthread-Luecke waehrend des Wartens,
   * show: Dauer des onShow-Blocks des Laders, falls er ins Warten fiel, sonst -1} fuers Protokoll. */
  var pre = null, timing = null, shown = null;
  function now() { return new Date().getTime(); }
  /* TV-Befund 27.10. nachmittags ("setup 506 … warten 500, luecke 500" statt 19): der Lader setzt window.onShow = registerKeys
   * (21x registKey + 3x unregistKey + SetBannerState, synchrone Plugin-Aufrufe, am TV ~500 ms). Kommt app.js schneller als das
   * onShow-Ereignis (Dev-Server ~270 ms statt ~900 ms), faellt dieser Block genau in das Warten auf setup.json. Kein Fehler der
   * App und keine Regression; damit das Protokoll es zeigt, misst eine Huelle um onShow die Dauer (Verhalten unveraendert). */
  function watchShow() {
    if (typeof window === 'undefined' || !window.Boot) return;
    var f = window.onShow;
    if (typeof f !== 'function' || f._pnWatch) return;
    var w = function () {
      var t = now();
      try { return f.apply(this, arguments); }
      finally { shown = { at: t, ms: now() - t }; try { if (N.log) N.log('onShow (Tasten registrieren) ' + shown.ms + ' ms'); } catch (e) {} }
    };
    w._pnWatch = true;
    window.onShow = w;
  }
  function xhrText(factory, fin) {
    var x, ended = false, t;
    function end(text) { if (ended) return; ended = true; clearTimeout(t); if (x) x.onreadystatechange = null; fin(text); }
    try {
      x = factory ? factory() : new XMLHttpRequest();
      t = setTimeout(function () { try { x.abort(); } catch (e) {} end(null); }, 2000);
      x.onreadystatechange = function () {
        if (x.readyState !== 4) return;
        var st = x.status;                       // file:// liefert 0 (mit Inhalt), ein Webserver 200 oder 404
        end((st === 0 || st === 200) && x.responseText ? x.responseText : null);
      };
      x.open('GET', 'setup.json', true);
      x.send(null);
    } catch (e2) { end(null); }
  }
  /* nur im TV-Paket (Lader 'Boot' + file://), nie in Vorschau/Tests */
  function prefetch() {
    if (pre || typeof window === 'undefined' || !window.Boot || typeof XMLHttpRequest === 'undefined') return;
    try { if (String(window.location.protocol) !== 'file:') return; } catch (e) { return; }
    pre = { t0: now(), t1: 0, done: false, text: null, cbs: [] };
    xhrText(null, function (text) {
      pre.t1 = now(); pre.done = true; pre.text = text;
      var l = pre.cbs; pre.cbs = [];
      for (var i = 0; i < l.length; i++) l[i](text);
    });
  }
  function read(ctx, cb, factory) {
    if (ctx && ctx.setupText !== undefined) { done(ctx.setupText); return; }
    var tr = now(), gap = 0, last = tr, hb = 0, fin = false;
    function done(text) {
      if (!text) { cb(null, null); return; }
      var r = parse(String(text));
      cb(r.ok ? r.cfg : null, r.ok ? null : r.reason);
    }
    function beat() { var t = now(); if (t - last > gap) gap = t - last; last = t; hb = setTimeout(beat, 10); }
    function got(text, t0, t1) {
      if (fin) return; fin = true;
      if (hb) clearTimeout(hb);
      var t = now(); if (t - last > gap) gap = t - last;
      timing = { io: t1 - t0, early: Math.max(0, tr - t0), gap: gap, wait: t - tr, show: shown && shown.at >= tr ? shown.ms : -1 };   // show: onShow-Block im Warten
      done(text);
    }
    if (!factory && pre) {
      if (pre.done) { got(pre.text, pre.t0, pre.t1); return; }
      hb = setTimeout(beat, 10);
      pre.cbs.push(function (text) { got(text, pre.t0, pre.t1); });
      return;
    }
    hb = setTimeout(beat, 10);
    xhrText(factory, function (text) { got(text, tr, now()); });
  }
  prefetch();
  watchShow();

  N.setupFile = { parse: parse, users: users, read: read, lanUri: lanUri, timing: function () { return timing; }, _watchShow: watchShow };
})(N);
