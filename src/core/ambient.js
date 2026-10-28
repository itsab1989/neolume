/* N.amb – reine Logik fuer "Hintergrund in Bibliotheken" (ohne DOM, in Node getestet: tests/ambient.test.js).
 * Modi (Einstellung libBg): off = schlichtes Grau wie bisher · mood = Farbstimmung (Standard) · art = Titelbild · random = Zufallsbild.
 * Staerke (libBgStrength): soft = Dezent (Standard) · strong = Kraeftiger.
 * - Farbstimmung: PMS liefert je Titel Metadata.UltraBlurColors {topLeft, topRight, bottomRight, bottomLeft} (am PMS 1.43 geprueft:
 *   kommt in /library/sections/<id>/all auch MIT excludeElements=UltraBlurColors mit, keine Zusatzanfrage). Daraus rechnet die App
 *   ein winziges PNG (W x H = 16 x 9 Pixel, 4-Ecken-Verlauf, schon abgedunkelt) als data:-URI – 0 Anfragen, ~0,7 KB; die GPU skaliert es auf
 *   1280x720 (weich durch bilineare Filterung, Zwischenwerte sind schon im Bild, also auch ohne Filter nur sanfte Stufen).
 * - Abdunkeln: Farbe mit dem App-Grund #0E0F11 mischen und die Helligkeit (relative Luminanz) deckeln -> Beschriftungen, Listen,
 *   Chips und A–Z bleiben lesbar. Titel-/Zufallsbild: der PMS rechnet blur + Abdunklung (opacity/background) in ein 320x180-JPEG.
 * - Settle: Entprellung OHNE Arbeit im Fokusschritt (poke setzt nur ein Flag; EIN Timer prueft N.idle.restFor()). */
(function (N) {
  var MODES = ['off', 'mood', 'art', 'random'], STRENGTHS = ['soft', 'strong'];
  var BASE = [14, 15, 17];                              // App-Grund #0E0F11 (app.css .scr)
  /* mix: Anteil der Titelfarbe gegen den Grund; lmax: Obergrenze der relativen Luminanz (Grund ~0,005; Zweitzeile #858B92 ~0,25:
   * 0,022 -> Kontrast >= 4:1, 0,045 -> >= 3:1); op/blur: Titel-/Zufallsbild vom Server (Deckkraft in % ueber #0E0F11, Radius;
   * fast weisses Bild: 16 % -> ~#333 bzw. 26 % -> ~#4A4A4A, Bildtests amb-art-*) */
  var LOOK = { soft: { mix: 0.6, lmax: 0.022, op: 16, blur: 18 }, strong: { mix: 0.85, lmax: 0.045, op: 26, blur: 16 } };
  /* Groesse des Verlaufsbilds (16:9). TV-Test 28.10. (Nachmessung): amb.apply noch 4,7–20 ms, davon amb.png 6–19 ms – das PNG-Rechnen
   * dominiert (img.src einer data:-URI ist der kleine Rest). 16x9 statt 32x18 = ein Viertel der Pixel/Bytes (CRC, Adler, Base64);
   * die Farben sind abgedunkelt und liegen eng beieinander (benachbarte Pixel unterscheiden sich um 1–3 Stufen), die GPU skaliert
   * weich hoch -> sichtbar gleich (Bildtests amb-*). */
  var W = 16, H = 9;
  var memo = N.LRU ? new N.LRU(48) : null, baseU = '';  // gleiche Farben -> gleiche URI (zurueck zu einem Titel kostet nichts)

  /* lin: Tabelle fuer ganze Werte 0..255 (mixc/hex liefern nur solche; gleiche Zahlen wie Math.pow, aber 256x statt je Aufruf) */
  var LIN = null;
  function linf(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function lin(c) {
    if (!LIN) { LIN = []; for (var i = 0; i < 256; i++) LIN[i] = linf(i); }
    return (c | 0) === c && c >= 0 && c < 256 ? LIN[c] : linf(c);
  }
  function lum(rgb) { return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]); }
  function mixc(a, b, t) { return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)]; }

  /* ---------- PNG (RGB, 8 Bit, unkomprimierter Deflate-Block) als data:-URI ----------
   * TV-Befund 28.10.: amb.apply 18–23 ms je Wechsel, fast alles hier. Darum: Bytes direkt in EIN wiederverwendetes Feld (kein
   * push/concat), Adler-32 und CRC in je einer Schleife, Tabellen einmal; der Kopf (Signatur, IHDR, IDAT-Laenge/-Typ, zlib-Kopf) ist
   * je Groesse fest -> bei 16x9 genau 48 Bytes = 64 Base64-Zeichen, einmal gerechnet; Base64 ueber eine 12-Bit-Tabelle (2 Zeichen
   * je Zugriff). Ausgabe Byte fuer Byte wie vorher (tests/ambient.test.js vergleicht mit der alten, einfachen Fassung). */
  var CRC = null, B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', B12 = null, LAY = {};
  function tables() {
    CRC = [];
    for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; }
    B12 = [];
    for (n = 0; n < 4096; n++) B12[n] = B64.charAt(n >> 6) + B64.charAt(n & 63);
  }
  function crc32(b, s, e) { var c = 0xFFFFFFFF; for (var i = s; i < e; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function put32(o, p, v) { o[p] = (v >>> 24) & 255; o[p + 1] = (v >>> 16) & 255; o[p + 2] = (v >>> 8) & 255; o[p + 3] = v & 255; }
  /* Base64 von o[s..e); s muss ein Vielfaches von 3 ab Anfang der Datei sein */
  function b64(o, s, e) {
    var out = '', i, n;
    for (i = s; i + 2 < e; i += 3) { n = (o[i] << 16) | (o[i + 1] << 8) | o[i + 2]; out += B12[n >> 12] + B12[n & 4095]; }
    if (e - i === 1) { n = o[i] << 16; out += B12[n >> 12] + '=='; }
    else if (e - i === 2) { n = (o[i] << 16) | (o[i + 1] << 8); out += B12[n >> 12] + B64.charAt((n >> 6) & 63) + '='; }
    return out;
  }
  /* feste Teile je Groesse: Feld (wird wiederverwendet), Lage der Rohdaten, Base64 des festen Kopfs */
  function layout(w, h) {
    var k = w + 'x' + h, L = LAY[k];
    if (L) return L;
    var n = (w * 3 + 1) * h, o = [], p = 0, i;
    var head = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82];   // Signatur, IHDR-Laenge 13, 'IHDR'
    for (i = 0; i < head.length; i++) o[p++] = head[i];
    put32(o, p, w); put32(o, p + 4, h); p += 8;
    o[p++] = 8; o[p++] = 2; o[p++] = 0; o[p++] = 0; o[p++] = 0;
    put32(o, p, crc32(o, 12, p)); p += 4;
    put32(o, p, n + 11); p += 4;                                                    // IDAT-Laenge: zlib-Kopf 7 + Rohdaten + Adler 4
    var ti = p;
    o[p++] = 73; o[p++] = 68; o[p++] = 65; o[p++] = 84;                            // 'IDAT'
    o[p++] = 0x78; o[p++] = 0x01; o[p++] = 0x01; o[p++] = n & 255; o[p++] = n >> 8; o[p++] = ~n & 255; o[p++] = (~n >> 8) & 255;   // ein gespeicherter Block (< 64 KB)
    var raw = p, end = raw + n + 8;                                                 // + Adler + CRC
    var tail = [0, 0, 0, 0, 73, 69, 78, 68, 0xAE, 0x42, 0x60, 0x82];              // IEND (leer, CRC fest)
    for (i = 0; i < raw + n; i++) if (o[i] === undefined) o[i] = 0;               // dichtes Feld
    for (i = 0; i < tail.length; i++) o[end + i] = tail[i];
    var hb = raw - raw % 3;                                                         // Kopf-Bytes, die ganze Base64-Gruppen bilden
    var c0 = 0xFFFFFFFF;                                                            // CRC-Zwischenstand nach 'IDAT' + zlib-Kopf
    for (i = ti; i < raw; i++) c0 = CRC[(c0 ^ o[i]) & 255] ^ (c0 >>> 8);
    L = LAY[k] = { o: o, ti: ti, raw: raw, n: n, len: end + tail.length, hb: hb, h64: b64(o, 0, hb), c0: c0 };
    return L;
  }
  /* Rohdaten stehen im Feld (L.o ab L.raw); a/b = Adler-32-Summen, c = CRC-Zwischenstand bis Ende der Rohdaten (beides schon beim
   * Schreiben der Pixel mitgerechnet: EIN Durchlauf) -> Adler + CRC eintragen, Base64 */
  function finish(L, a, b, c) {
    var o = L.o, e = L.raw + L.n, i;
    put32(o, e, ((b << 16) | a) >>> 0);
    for (i = e; i < e + 4; i++) c = CRC[(c ^ o[i]) & 255] ^ (c >>> 8);
    put32(o, e + 4, (c ^ 0xFFFFFFFF) >>> 0);
    return 'data:image/png;base64,' + L.h64 + b64(o, L.hb, L.len);
  }
  /* px: Zeilen ohne Filterbyte, je Pixel r,g,b (Laenge w*h*3). Adler modulo erst je Zeile (Summen bleiben weit unter 2^53). */
  function png(w, h, px) {
    if (!CRC) tables();
    var L = layout(w, h), o = L.o, p = L.raw, s = w * 3, x, y, q = 0, a = 1, b = 0, c = L.c0, v;
    for (y = 0; y < h; y++) {
      o[p++] = 0; b += a; c = CRC[c & 255] ^ (c >>> 8);                           // Filterbyte 0
      for (x = 0; x < s; x++) { v = o[p++] = px[q++]; a += v; b += a; c = CRC[(c ^ v) & 255] ^ (c >>> 8); }
      a %= 65521; b %= 65521;
    }
    return finish(L, a, b, c);
  }
  /* weiche Uebergaenge (smoothstep) zwischen den Ecken; Gewichte je Groesse einmal */
  var SS = {};
  function ss(t) { return t * t * (3 - 2 * t); }
  function weights(n) {
    var r = SS[n];
    if (r) return r;
    r = SS[n] = [];
    for (var i = 0; i < n; i++) r[i] = ss(n > 1 ? i / (n - 1) : 0);
    return r;
  }
  /* 4 Ecken (tl, tr, br, bl) -> je Spalte und Kanal oben + (unten - oben); Pixel = oben + Differenz * v (gleiche Rechnung wie frueher) */
  function cols(cs, w) {
    var U = weights(w), top = [], dif = [], x, k, j = 0, u, t;
    for (x = 0; x < w; x++) {
      u = U[x];
      for (k = 0; k < 3; k++, j++) { t = cs[0][k] + (cs[1][k] - cs[0][k]) * u; top[j] = t; dif[j] = cs[3][k] + (cs[2][k] - cs[3][k]) * u - t; }
    }
    return [top, dif];
  }
  /* Verlauf direkt ins PNG-Feld (ohne Zwischenliste), Adler + CRC im selben Durchlauf.
   * Runden: (x + 0.5) | 0 statt Math.round (kein Funktionsaufruf je Byte). Fuer x >= 1 exakt gleich (x + 0.5 wird nur bei
   * x < 0,5 ungenau); die abgedunkelten Farben liegen immer >= ~5 (Mischung mit dem Grund #0E0F11), Test vergleicht mit Math.round. */
  function gradPng(cs, w, h) {
    if (!CRC) tables();
    var L = layout(w, h), o = L.o, p = L.raw, V = weights(h), cc = cols(cs, w), top = cc[0], dif = cc[1], s = w * 3, y, j, v, x;
    var a = 1, b = 0, c = L.c0;
    for (y = 0; y < h; y++) {
      v = V[y]; o[p++] = 0; b += a; c = CRC[c & 255] ^ (c >>> 8);
      for (j = 0; j < s; j++) { x = o[p++] = (top[j] + dif[j] * v + 0.5) | 0; a += x; b += a; c = CRC[(c ^ x) & 255] ^ (c >>> 8); }
      a %= 65521; b %= 65521;
    }
    return finish(L, a, b, c);
  }

  var A = {
    MODES: MODES, STRENGTHS: STRENGTHS, LOOK: LOOK, BASE: BASE, W: W, H: H, REST: 600, FADE: 400,
    lum: lum, png: png,
    /* Einstellungen -> gueltiger Modus/Staerke (unbekannte bzw. fehlende Werte: Standard) */
    mode: function (st) { var m = st && st.libBg; return MODES.indexOf(m) >= 0 ? m : 'mood'; },
    strength: function (st) { var s = st && st.libBgStrength; return STRENGTHS.indexOf(s) >= 0 ? s : 'soft'; },
    /* "Hintergrundbilder" aus -> Titel-/Zufallsbild fallen auf die Farbstimmung zurueck (Farben sind kein Bild des Titels) */
    effective: function (mode, backgrounds) { return !backgrounds && (mode === 'art' || mode === 'random') ? 'mood' : mode; },
    /* '#A1B2C3' | 'a1b2c3' | 'abc' -> [r, g, b] | null */
    hex: function (s) {
      var m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(s === undefined || s === null ? '' : s).replace(/^\s+|\s+$/g, ''));
      if (!m) return null;
      var h = m[1];
      if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    },
    /* UltraBlurColors (Objekt bzw. [Objekt]) -> 24 Hex-Zeichen (oben links, oben rechts, unten rechts, unten links) | '' */
    pack: function (u) {
      if (u && u.length !== undefined && typeof u !== 'string') u = u[0];
      if (!u || typeof u !== 'object') return '';
      var k = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'], out = '';
      for (var i = 0; i < 4; i++) {
        var c = A.hex(u[k[i]]);
        if (!c) return '';
        out += ((1 << 24) | (c[0] << 16) | (c[1] << 8) | c[2]).toString(16).slice(1);
      }
      return out;
    },
    unpack: function (s) {
      if (!/^[0-9a-f]{24}$/i.test(String(s || ''))) return null;
      return [A.hex(s.slice(0, 6)), A.hex(s.slice(6, 12)), A.hex(s.slice(12, 18)), A.hex(s.slice(18, 24))];
    },
    /* Titelfarbe abdunkeln: mit dem Grund mischen, dann Luminanz auf lmax deckeln (Farbton bleibt, nur dunkler) */
    shade: function (rgb, strength) {
      var L = LOOK[strength] || LOOK.soft, c = mixc(BASE, rgb, L.mix);
      if (lum(c) <= L.lmax) return c;
      var lo = 0, hi = 1, t;
      for (var i = 0; i < 12; i++) { t = (lo + hi) / 2; if (lum(mixc(BASE, c, t)) > L.lmax) hi = t; else lo = t; }
      return mixc(BASE, c, lo);
    },
    /* 4 Ecken (tl, tr, br, bl) -> Pixel w x h; weiche Uebergaenge (smoothstep) zwischen den Ecken */
    pixels: function (cs, w, h) {
      var px = [], V = weights(h), c = cols(cs, w), y, j;
      for (y = 0; y < h; y++) for (j = 0; j < w * 3; j++) px.push(Math.round(c[0][j] + c[1][j] * V[y]));
      return px;
    },
    /* gepackte Farben + Staerke -> data:-URI des Verlaufs ('' = keine Farben); ohne Farben: '' (Aufrufer zeigt den Grund) */
    moodUrl: function (packed, strength) {
      var cs = A.unpack(packed);
      if (!cs) return '';
      var key = packed + strength;
      if (memo && memo.has(key)) return memo.get(key);
      for (var i = 0; i < 4; i++) cs[i] = A.shade(cs[i], strength);
      var u = gradPng(cs, W, H);
      if (memo) memo.set(key, u);
      return u;
    },
    /* Vorwaermen (Idle, beim Betreten einer Bibliothek mit Farbstimmung/Titelbild). TV-Nachmessung 28.10. (5700037): amb.png sonst
     * 4–8 ms, aber Spitzen 12,5/23,5 ms – der erste Aufruf baut CRC-Tabelle (2048 Schleifen), Base64-Tabelle (4096 Zeichenketten),
     * Luminanz-Tabelle (256x Math.pow), PNG-Kopf und Gewichte und laeuft zum ersten Mal durch die Schleifen (WebKit: Code kalt).
     * Ein Probelauf mit Testfarben (nicht im Speicher) erledigt das vorab; danach kostet ein Wechsel nur noch Pixel + Pruefsummen. */
    warm: function () {
      if (!CRC) tables();
      var cs = [[40, 30, 90], [200, 40, 60], [0, 120, 90], [250, 200, 0]];
      for (var i = 0; i < 4; i++) cs[i] = A.shade(cs[i], 'soft');
      gradPng(cs, W, H);
      return true;
    },
    /* ruhige Grundflaeche (Titel ohne Farben/Bild): 1 Pixel #0E0F11, gleiche Ueberblendung wie jedes andere Bild */
    baseUrl: function () { return baseU || (baseU = png(1, 1, BASE)); },
    /* Server-Parameter fuer Titel-/Zufallsbild (N.img.url opts): unscharf + abgedunkelt vom PMS, kleines JPEG */
    artOpts: function (strength) {
      var L = LOOK[strength] || LOOK.soft;
      return { blur: L.blur, opacity: L.op, background: '0E0F11', quality: 90 };
    },
    /* Ziel fuer einen Titel: {key, mood} | {key, art} | {key, thumb} | {key:'base'}.
     * art-Modus: Art -> sonst Farben -> sonst Poster (unscharf; nie ein Spoiler-Vorschaubild). mood: nur Farben. */
    target: function (it, mode) {
      if (!it) return { key: 'base' };
      if (mode === 'art' || mode === 'random') {
        if (it.art) return { key: 'a:' + it.art, art: it.art };
        if (it.ub) return { key: 'm:' + it.ub, mood: it.ub };
        if (it.thumb && !(N.comfort && N.comfort.isSpoiler(it.thumb))) return { key: 't:' + it.thumb, thumb: it.thumb };
        return { key: 'base' };
      }
      return it.ub ? { key: 'm:' + it.ub, mood: it.ub } : { key: 'base' };
    },
    /* Zufallsbild: aus einer Liste (z. B. sort=random vom Server) den ersten Titel mit Art, sonst mit Farben/Poster */
    pickRandom: function (list) {
      var i;
      for (i = 0; list && i < list.length; i++) if (list[i] && list[i].art) return list[i];
      for (i = 0; list && i < list.length; i++) if (list[i] && (list[i].ub || list[i].thumb)) return list[i];
      return null;
    },
    Settle: Settle
  };

  /* Entprellung: poke() im Fokusschritt setzt nur ein Flag (Timer laeuft hoechstens einmal); fire() erst, wenn seit der letzten
   * Taste/Zeigerbewegung >= ms vergangen sind (gehaltene Taste: nie). rest() = ms seit der letzten Eingabe (N.idle.restFor). */
  function Settle(ms, fire, rest) {
    this.ms = ms; this.fire = fire; this.rest = rest || function () { return N.idle.restFor(); };
    this.t = 0; this.want = false;
  }
  Settle.prototype.poke = function () { this.want = true; if (!this.t) this._arm(this.ms); };
  Settle.prototype._arm = function (d) { var s = this; this.t = setTimeout(function () { s.t = 0; s._check(); }, Math.max(10, d)); };
  Settle.prototype._check = function () {
    if (!this.want) return;
    var r = this.rest();
    if (r < this.ms) { this._arm(this.ms - r + 10); return; }
    this.want = false;
    this.fire();
  };
  Settle.prototype.cancel = function () { this.want = false; if (this.t) { clearTimeout(this.t); this.t = 0; } };
  N.amb = A;
})(N);
