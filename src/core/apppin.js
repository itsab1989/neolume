/* N.sha256 / N.appPin – eigene App-PIN je Profil (Nutzerentscheidung 26.10., SPEC 5.16), nur mit setup.json (PMS-only).
 * Gespeichert wird nur eine gesalzene Pruefsumme: PBKDF2-HMAC-SHA256 (ES5, hier implementiert), 16 Byte Zufalls-Salz je Profil,
 * ITER = 1000 Runden (Desktop ~1 ms mit JIT, ~27 ms ohne JIT; TV-Schaetzung <= 150 ms, am TV messen).
 * Datei pins.json im Store: {v:1, setup:<machineIdentifier des PMS>, reset:<createdAt der letzten Ruecksetzung>, p:{uuid:{s:salzHex, h:hashHex, i:iter}}}.
 * Gehoert zum Server, nicht zur einzelnen Einrichtung (Nutzerentscheidung 26.10. abends): erneutes Einrichten BEHAELT die PINs.
 * setup.json mit "resetAppPins": true (Kaestchen im Einrichtungsprogramm) loescht sie genau einmal je Einrichtung (Weg bei vergessener
 * Hauptprofil-PIN); danach gesetzte PINs bleiben. Alte Dateien (setup = "createdAt|machineId") gelten weiter.
 * Die Plex-PIN wird nie abgefragt oder gespeichert. Fehlversuche/Sperre: N.PinLogic. */
(function (N) {
  /* ---------- SHA-256 (FIPS 180-4) auf 32-Bit-Woertern ---------- */
  var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
    0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
    0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70,
    0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  var IV = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  var W = new Array(64);
  /* ein 64-Byte-Block (16 Woerter ab blk[off]) in den Zustand h (8 Woerter) -> neuer Zustand (neues Array) */
  function compress(h, blk, off) {
    var i, a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], k = h[7], t1, t2, x, y;
    for (i = 0; i < 16; i++) W[i] = blk[off + i] | 0;
    for (i = 16; i < 64; i++) {
      x = W[i - 15]; y = W[i - 2];
      W[i] = (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10)) +
        W[i - 7] + W[i - 16] | 0;
    }
    for (i = 0; i < 64; i++) {
      t1 = k + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + K[i] + W[i] | 0;
      t2 = (((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c)) | 0;
      k = g; g = f; f = e; e = d + t1 | 0; d = c; c = b; b = a; a = t1 + t2 | 0;
    }
    return [h[0] + a | 0, h[1] + b | 0, h[2] + c | 0, h[3] + d | 0, h[4] + e | 0, h[5] + f | 0, h[6] + g | 0, h[7] + k | 0];
  }
  /* Bytes (Array 0..255) mit Padding fertig hashen; prefix = schon verarbeitete Bytes (HMAC: 64) */
  function finish(h, bytes, prefix) {
    var n = bytes.length, total = n + prefix, words = [], i, len = ((n + 9 + 63) >> 6) << 4;
    for (i = 0; i < len; i++) words[i] = 0;
    for (i = 0; i < n; i++) words[i >> 2] |= bytes[i] << (24 - (i & 3) * 8);
    words[n >> 2] |= 0x80 << (24 - (n & 3) * 8);
    words[len - 1] = total * 8;                                         // < 2^32 Bit genuegt hier
    words[len - 2] = Math.floor(total / 0x20000000);
    for (i = 0; i < len; i += 16) h = compress(h, words, i);
    return h;
  }
  function utf8(s) {
    var b = [], i, c, u = unescape(encodeURIComponent(String(s)));
    for (i = 0; i < u.length; i++) { c = u.charCodeAt(i); b.push(c & 255); }
    return b;
  }
  function hexToBytes(hx) { var b = []; for (var i = 0; i + 1 < hx.length; i += 2) b.push(parseInt(hx.substr(i, 2), 16)); return b; }
  function wordsToHex(w) { var s = '', i, v; for (i = 0; i < w.length; i++) { v = (w[i] >>> 0).toString(16); s += '00000000'.substring(v.length) + v; } return s; }
  function sha256(bytes) { return wordsToHex(finish(IV, typeof bytes === 'string' ? utf8(bytes) : bytes, 0)); }

  /* PBKDF2-HMAC-SHA256, Ausgabe 32 Byte (ein Block). Innerer/aeusserer Zustand vorberechnet -> 2 Kompressionen je Runde. */
  function pbkdf2(pwBytes, saltBytes, iter) {
    var key = pwBytes, i, j, ip = [], op = [], kw = [];
    if (key.length > 64) key = hexToBytes(sha256(key));
    for (i = 0; i < 16; i++) kw[i] = 0;
    for (i = 0; i < key.length; i++) kw[i >> 2] |= key[i] << (24 - (i & 3) * 8);
    for (i = 0; i < 16; i++) { ip[i] = kw[i] ^ 0x36363636; op[i] = kw[i] ^ 0x5c5c5c5c; }
    var hi = compress(IV, ip, 0), ho = compress(IV, op, 0);
    var u = finish(hi, saltBytes.concat([0, 0, 0, 1]), 64);
    u = finish(ho, wordsBytes(u), 64);
    var out = u.slice(0), blk = [0, 0, 0, 0, 0, 0, 0, 0, 0x80000000, 0, 0, 0, 0, 0, 0, (64 + 32) * 8];
    for (i = 1; i < iter; i++) {
      for (j = 0; j < 8; j++) blk[j] = u[j];
      u = compress(hi, blk, 0);
      for (j = 0; j < 8; j++) blk[j] = u[j];
      u = compress(ho, blk, 0);
      for (j = 0; j < 8; j++) out[j] ^= u[j];
    }
    return wordsToHex(out);
  }
  function wordsBytes(w) { var b = []; for (var i = 0; i < w.length; i++) b.push((w[i] >>> 24) & 255, (w[i] >>> 16) & 255, (w[i] >>> 8) & 255, w[i] & 255); return b; }
  N.sha256 = { hex: sha256, pbkdf2: function (pw, saltHex, iter) { return pbkdf2(utf8(pw), hexToBytes(saltHex), iter); } };

  /* ---------- App-PIN je Profil ---------- */
  var FILE = 'pins.json', ITER = 1000, setupId = '';
  function randomHex(n) {
    var s = '', i, b = null;
    try { if (window.crypto && window.crypto.getRandomValues) { b = new Uint8Array(n); window.crypto.getRandomValues(b); } } catch (e) { b = null; }
    for (i = 0; i < n; i++) {
      var v = b ? b[i] : Math.floor(Math.random() * 256) ^ (new Date().getTime() >> (i % 8)) & 255;
      s += (v < 16 ? '0' : '') + (v & 255).toString(16);
    }
    return s;
  }
  /* gehoert die Datei zu diesem Server? (auch altes Format "createdAt|machineId") */
  function mine(d) { return typeof d.setup === 'string' && (d.setup === setupId || d.setup.split('|').pop() === setupId); }
  function data() {
    var d = N.store.get(FILE);
    if (!d || d.v !== 1 || !mine(d) || !d.p || typeof d.p !== 'object') return { v: 1, setup: setupId, reset: '', p: {} };
    d.setup = setupId;                                                    // altes Format beim naechsten Schreiben angleichen
    return d;
  }
  function valid(pin) { return typeof pin === 'string' && /^\d{4}$/.test(pin); }
  var P = {
    ITER: ITER,
    /* Server festlegen (N.session beim Laden der setup.json). resetMark = createdAt, wenn die Einrichtung "App-PINs zuruecksetzen"
     * verlangt: einmalig alle PINs loeschen (gemerkt in reset, damit spaeter gesetzte PINs beim naechsten Start bleiben). -> true = geloescht */
    bind: function (machineId, resetMark) {
      setupId = String(machineId || '');
      if (!resetMark) return false;
      var d = data();
      if (d.reset === resetMark) return false;
      N.store.set(FILE, { v: 1, setup: setupId, reset: String(resetMark), p: {} });
      return true;
    },
    /* pins.json unlesbar -> geschlossen scheitern: jedes Profil gilt als geschuetzt, keine PIN passt, nichts wird
     * ueberschrieben. Ausweg: Einrichtung mit "App-PINs zuruecksetzen" (bind schreibt die Datei neu). Pentest P16. */
    broken: function () { return !!(N.store.corrupt && N.store.corrupt(FILE)); },
    has: function (uuid) { if (P.broken()) return !!uuid; var e = data().p[uuid]; return !!(e && e.h && e.s); },
    count: function (uuids) { var n = 0; for (var i = 0; i < uuids.length; i++) if (P.has(uuids[i])) n++; return n; },
    hash: function (pin, saltHex, iter) { return N.sha256.pbkdf2(pin, saltHex, iter || ITER); },
    /* asynchron (Spinner sichtbar, Pruefung nie im Tastenpfad): cb(ok) */
    set: function (uuid, pin, cb) {
      if (!valid(pin) || !uuid || P.broken()) { if (cb) cb(false); return; }
      setTimeout(function () {
        var d = data(), s = randomHex(16), before = d.p[uuid];
        d.p[uuid] = { s: s, h: P.hash(pin, s, ITER), i: ITER };
        N.store.set(FILE, d);
        // sofort schreiben; "PIN gespeichert" nur, wenn die Datei wirklich geschrieben ist (Audit H2). Sonst alte PIN zurueck.
        var ok = N.store.flushFile ? N.store.flushFile(FILE) : true;
        if (!ok) { if (before) d.p[uuid] = before; else delete d.p[uuid]; N.store.set(FILE, d); }
        if (cb) cb(ok);
      }, 30);
    },
    /* -> true = entfernt und geschrieben (Audit H2: Meldung erst nach erfolgreichem Schreiben) */
    remove: function (uuid) {
      if (P.broken()) return false;
      var d = data(), before = d.p[uuid];
      if (!before) return true;
      delete d.p[uuid]; N.store.set(FILE, d);
      if (!N.store.flushFile || N.store.flushFile(FILE)) return true;
      d.p[uuid] = before; N.store.set(FILE, d);
      return false;
    },
    verify: function (uuid, pin, cb) {
      setTimeout(function () {
        var e = P.broken() ? null : data().p[uuid];
        cb(!!(e && valid(pin) && P.hash(pin, e.s, e.i || ITER) === e.h));
      }, 30);
    }
  };
  N.appPin = P;
})(N);
