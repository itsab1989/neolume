/* N.avatars – Profilbilder zwischenspeichern (PROF-11, Entscheidung Nr. 19; Recherche docs/research/avatar-cache.md).
 * Profilwahl, PIN-Dialog und Seitenleiste zeigen beim Start sofort das gespeicherte Bild (data:-URL aus avatars.json) statt
 * auf den Bild-Umrechner des PMS (bzw. plex.tv) zu warten; ohne gespeichertes Bild laeuft alles wie bisher (N.img.want mit
 * der Server-URL, Initiale darunter).
 * Speichern/Auffrischen nie im Startpfad: fruehestens LATER ms nach dem Anzeigen, dann ueber N.idle (Tastenruhe), je Bild
 * eine Anfrage nacheinander (nie mehrere gleichzeitig). Holt die Bytes derselben URL per XHR (Antwort als arraybuffer, sonst
 * Binaer-Text), Base64 -> data:-URL. Geschrieben wird nur bei Aenderung (N.store entprellt >= 2 s Ruhe).
 * Auffrischen: Bild-Adresse des Profils (thumb, plex.tv haengt bei neuem Bild ?c=<Zeit> an) geaendert -> sofort im
 * Hintergrund holen, das neue Bild ersetzt das alte im selben Bildschirm; sonst hoechstens alle REFRESH ms pruefen.
 * Grenzen: ein Bild <= MAX_ENTRY Zeichen (data:-URL), alles <= MAX_TOTAL, <= MAX_COUNT Eintraege; aelteste fallen zuerst.
 * Kaputte Daten (kein data:image, Bild laesst sich nicht dekodieren) -> Eintrag weg, Server-URL bzw. Initiale.
 * Plattform-Naht: N.platform.net.imageData(url, cb(err, dataUrl)) ersetzt das Holen (z. B. Apple: plex.tv-Bilder ohne CORS
 * ueber das Geraete-Netz); fehlt sie (Orsay), holt das Modul selbst per XHR. */
(function (N) {
  var U = N.util;
  var FILE = 'avatars.json', MAX_ENTRY = 24000, MAX_TOTAL = 200000, MAX_COUNT = 48;
  var LATER = 3000, REFRESH = 7 * 86400000, TIMEOUT = 8000;
  var data = null, queue = [], busy = false, gen = 0;
  var xhrFactory = function () { return new XMLHttpRequest(); };

  function valid(e) {
    return e && typeof e === 'object' && typeof e.t === 'string' && typeof e.d === 'string' && e.d.length <= MAX_ENTRY &&
      e.d.indexOf('data:image/') === 0 && e.d.indexOf(';base64,') > 0 && typeof e.at === 'number';
  }
  /* avatars.json einmal lesen (synchron, klein); ungueltige Eintraege fallen still weg */
  function load() {
    if (data) return data;
    var raw = null;
    try { raw = N.store.get(FILE); } catch (e) { raw = null; }
    data = { v: 1, e: {} };
    if (raw && typeof raw === 'object' && raw.e && typeof raw.e === 'object') {
      for (var k in raw.e) if (Object.prototype.hasOwnProperty.call(raw.e, k) && valid(raw.e[k])) data.e[k] = raw.e[k];
    }
    return data;
  }
  function save() { N.store.set(FILE, data); }
  function keyOf(uuid, tier) { return String(uuid) + '|' + tier; }

  /* Groessenbegrenzung: aelteste (at) zuerst raus, bis Anzahl und Summe passen; keep bleibt */
  function trim(keep) {
    var e = data.e, keys = [], total = 0, k;
    for (k in e) if (Object.prototype.hasOwnProperty.call(e, k)) { keys.push(k); total += e[k].d.length; }
    keys.sort(function (a, b) { return e[a].at - e[b].at; });
    for (var i = 0; i < keys.length && (total > MAX_TOTAL || keys.length - i > MAX_COUNT); i++) {
      if (keys[i] === keep) continue;
      total -= e[keys[i]].d.length; delete e[keys[i]];
    }
  }

  /* Base64 ohne btoa (ES5, fester Ablauf, im Test pruefbar) */
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function b64(bytes, n) {
    var out = [], i, a, b, c;
    for (i = 0; i + 2 < n; i += 3) {
      a = bytes(i); b = bytes(i + 1); c = bytes(i + 2);
      out.push(B64.charAt(a >> 2) + B64.charAt(((a & 3) << 4) | (b >> 4)) + B64.charAt(((b & 15) << 2) | (c >> 6)) + B64.charAt(c & 63));
    }
    if (n - i === 1) { a = bytes(i); out.push(B64.charAt(a >> 2) + B64.charAt((a & 3) << 4) + '=='); }
    else if (n - i === 2) { a = bytes(i); b = bytes(i + 1); out.push(B64.charAt(a >> 2) + B64.charAt(((a & 3) << 4) | (b >> 4)) + B64.charAt((b & 15) << 2) + '='); }
    return out.join('');
  }
  function mimeOf(ct) {
    var m = /^\s*(image\/[a-z0-9.+-]+)/i.exec(ct || '');
    return m ? m[1].toLowerCase() : '';
  }
  /* TV-Weg: XHR auf dieselbe Bild-URL; arraybuffer (WebKit 537 kennt XHR2), sonst Binaer-Text (x-user-defined) */
  function xhrData(url, cb) {
    var x, fin = false, t, ab = false;
    function end(err, d) { if (fin) return; fin = true; clearTimeout(t); try { x.onreadystatechange = null; } catch (e0) {} cb(err, d); }
    try {
      x = xhrFactory();
      x.open('GET', url, true);
      if (typeof ArrayBuffer !== 'undefined' && typeof Uint8Array !== 'undefined' && 'responseType' in x) {
        try { x.responseType = 'arraybuffer'; ab = x.responseType === 'arraybuffer'; } catch (e1) { ab = false; }
      }
      if (!ab && x.overrideMimeType) x.overrideMimeType('text/plain; charset=x-user-defined');
      x.onreadystatechange = function () {
        if (x.readyState !== 4) return;
        if (x.status !== 200) { end({ type: 'http', status: x.status }); return; }
        var ct = null, d = null, mime;
        try { ct = x.getResponseHeader ? x.getResponseHeader('Content-Type') : null; } catch (eh) { ct = null; }
        mime = ct ? mimeOf(ct) : 'image/jpeg';             // Kopf nicht lesbar: PMS liefert JPEG (format=jpeg)
        if (!mime) { end({ type: 'type' }); return; }      // Fehlerseite o. ae. statt Bild
        try {
          if (ab) {
            var u8 = x.response ? new Uint8Array(x.response) : null;
            if (u8 && u8.length) d = b64(function (i) { return u8[i]; }, u8.length);
          } else {
            var s = x.responseText || '';
            if (s.length) d = b64(function (i) { return s.charCodeAt(i) & 255; }, s.length);
          }
        } catch (ed) { d = null; }
        if (!d) { end({ type: 'empty' }); return; }
        end(null, 'data:' + mime + ';base64,' + d);
      };
      t = setTimeout(function () { try { x.abort(); } catch (ea) {} end({ type: 'timeout' }); }, TIMEOUT);
      x.send(null);
    } catch (e) { end({ type: 'network' }); }
  }
  function fetchData(url, cb) {
    var P = N.platform;
    if (P && P.net && typeof P.net.imageData === 'function') { P.net.imageData(url, cb); return; }
    xhrData(url, cb);
  }

  /* Warteschlange: eine Anfrage zur Zeit, jede erst in Tastenruhe (N.idle) */
  function pump() {
    if (busy || !queue.length) return;
    var job = queue.shift();
    busy = true;
    var g = gen;
    N.idle.add(function () {
      if (g !== gen) { busy = false; pump(); return; }
      fetchData(job.url, function (err, d) {
        busy = false;
        if (g === gen) settle(job, err, d);
        pump();
      });
    }, 'avatar-fetch');
  }
  function later(job) {
    for (var i = 0; i < queue.length; i++) if (queue[i].key === job.key) { queue[i] = job; return; }
    var g = gen;
    setTimeout(function () { if (g !== gen) return; queue.push(job); pump(); }, LATER);
  }
  /* Ergebnis: nur bei Aenderung speichern; neues Bild ersetzt das gezeigte (gleiches <img>, gleiche Position) */
  function settle(job, err, d) {
    if (err || !d) { if (N.diag) N.diag.log('info', 'avatar fetch ' + (err ? err.type + (err.status ? ' ' + err.status : '') : 'empty')); return; }
    load();
    var e = data.e[job.key], now = U.now();
    if (d.length > MAX_ENTRY || d.indexOf('data:image/') !== 0) {
      if (e && e.t !== job.thumb) { delete data.e[job.key]; save(); }   // zu gross/kein Bild: altes (veraltetes) nicht weiter zeigen
      return;
    }
    if (e && e.d === d) {                              // gleiches Bild: nur Adresse/Pruefzeit nachtragen
      if (e.t !== job.thumb || now - e.at >= REFRESH) { e.t = job.thumb; e.at = now; save(); }
      return;
    }
    data.e[job.key] = { t: job.thumb, d: d, at: now };
    trim(job.key);
    save();
    var img = job.img;
    if (img && img._pnAvKey === job.key && e && img._pnUrl === e.d) N.img.want(img, d, 1);   // gezeigtes altes Bild ersetzen
  }

  var A = {
    /* Bild fuer ein <img> (src schon BLANK, Initiale darunter): o = {uuid, thumb, tier, url (Server-URL wie bisher), prio} */
    show: function (img, o) {
      if (!img || !o || !o.thumb) return;
      var key = keyOf(o.uuid, o.tier), e = o.uuid ? load().e[key] : null, prio = o.prio || 0, url = o.url || '';
      img._pnAvKey = key;
      if (!o.uuid) { if (url) N.img.want(img, url, prio); return; }
      var job = { key: key, thumb: o.thumb, url: url, img: img };
      if (e) {
        N.img.want(img, e.d, prio, function (ok) {
          if (ok || img._pnAvKey !== key) return;
          if (load().e[key] === e) { delete data.e[key]; save(); }       // laesst sich nicht dekodieren -> weg, Server-Bild
          if (url) N.img.want(img, url, prio, function (ok2) { if (ok2) later(job); });
        });
        if (url && (e.t !== o.thumb || U.now() - e.at >= REFRESH)) later(job);
        return;
      }
      if (!url) return;
      N.img.want(img, url, prio, function (ok) { if (ok) later(job); });
    },
    /* Abmelden: gespeicherte Bilder dieses Kontos loeschen, laufende Auftraege verwerfen */
    clear: function () {
      gen++; queue = []; busy = false;
      data = { v: 1, e: {} };
      N.idle.cancel('avatar-fetch');
      if (N.store.get(FILE)) N.store.remove(FILE);
    },
    MAX_ENTRY: MAX_ENTRY, MAX_TOTAL: MAX_TOTAL, MAX_COUNT: MAX_COUNT, LATER: LATER, REFRESH: REFRESH,
    _b64: b64,
    _xhr: function (f) { xhrFactory = f; },             // Tests: XHR nachbilden
    _reset: function () { data = null; queue = []; busy = false; gen++; },
    _state: function () { return { queued: queue.length, busy: busy, entries: data ? Object.keys(data.e).length : 0 }; }
  };
  N.avatars = A;
})(N);
