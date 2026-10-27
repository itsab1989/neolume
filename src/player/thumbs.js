/* N.thumbs – Vorschaubilder beim Spulen (SPEC 5.10). Nur wenn der Part indexes="sd" hat und die Einstellung an ist.
 * Weg 1 (Standard, wie Plex Web): Einzelbild-Endpunkt /library/parts/<id>/indexes/sd/<ms> ueber /photo/:/transcode in exakt
 * 240x135 – ein normales <img>, kein Binaer-XHR, kein Blob (alter WebKit 537). Bildraster 2 s (Server-Pref GenerateBIFFrameInterval).
 * Weg 2 (Rueckfall, wenn Weg 1 am TV scheitert): ganze BIF-Datei /library/parts/<id>/indexes/sd als Binaer-String
 * (overrideMimeType x-user-defined), parseBif + frame -> data:-URI. Reine Funktionen hier, in Node getestet. */
(function (N) {
  var U = N.util, B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function u32(s, o) { return ((s.charCodeAt(o) & 255) | ((s.charCodeAt(o + 1) & 255) << 8) | ((s.charCodeAt(o + 2) & 255) << 16)) + (s.charCodeAt(o + 3) & 255) * 16777216; }
  var T = {
    STEP: 2000,
    has: function (part) { return !!(part && part.indexes && String(part.indexes).indexOf('sd') >= 0); },
    snap: function (ms) { return Math.max(0, Math.round(ms / T.STEP) * T.STEP); },
    url: function (base, partId, ms, token) {
      return base + '/photo/:/transcode?' + U.qs({ width: 240, height: 135, minSize: 1, upscale: 1, format: 'jpeg',
        url: '/library/parts/' + partId + '/indexes/sd/' + T.snap(ms), 'X-Plex-Token': token });
    },
    bifUrl: function (base, partId, token) { return base + '/library/parts/' + partId + '/indexes/sd?' + U.qs({ 'X-Plex-Token': token }); },
    /* BIF (Roku-Format): Magic 89 42 49 46 0D 0A 1A 0A, Version u32 @8, Anzahl u32 @12, Abstand ms u32 @16 (0 = 1000),
     * Index ab 64: Paare (Zeitstempel, Offset), Ende-Eintrag 0xFFFFFFFF + Dateiende. -> {interval, frames:[{t, o, n}]} | null */
    parseBif: function (s) {
      if (!s || s.length < 72 || s.charCodeAt(0) !== 0x89 || s.substr(1, 3) !== 'BIF') return null;
      var n = u32(s, 12), iv = u32(s, 16) || 1000, fr = [];
      for (var i = 0; i < n; i++) {
        var p = 64 + i * 8;
        if (p + 16 > s.length) break;
        var ts = u32(s, p), o = u32(s, p + 4), o2 = u32(s, p + 12);
        if (ts === 4294967295) break;
        fr.push({ t: ts * iv, o: o, n: o2 - o });
      }
      return { interval: iv, frames: fr };
    },
    /* Index des Bilds fuer ms (letztes mit t <= ms) */
    frameAt: function (bif, ms) {
      var f = bif.frames, lo = 0, hi = f.length - 1;
      if (!f.length) return -1;
      while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (f[mid].t <= ms) lo = mid; else hi = mid - 1; }
      return lo;
    },
    /* Binaer-String -> Base64 (btoa gibt es nicht in jedem Kontext) */
    b64: function (s) {
      var out = '', i = 0, a, b, c;
      while (i < s.length) {
        a = s.charCodeAt(i++) & 255; b = i < s.length ? s.charCodeAt(i++) & 255 : -1; c = i < s.length ? s.charCodeAt(i++) & 255 : -1;
        out += B64.charAt(a >> 2) + B64.charAt(((a & 3) << 4) | (b < 0 ? 0 : b >> 4)) +
          (b < 0 ? '=' : B64.charAt(((b & 15) << 2) | (c < 0 ? 0 : c >> 6))) + (c < 0 ? '=' : B64.charAt(c & 63));
      }
      return out;
    },
    dataUri: function (s, bif, i) { var f = bif.frames[i]; return f ? 'data:image/jpeg;base64,' + T.b64(s.substr(f.o, f.n)) : ''; }
  };
  N.thumbs = T;
})(N);
