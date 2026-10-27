/* N.subs – SRT-Parser + Cue-Suche fuer externe Untertitel (SPEC 7.10: HTML-Box, Text per nodeValue). Rein. */
(function (N) {
  function ms(h, m, s, f) { return ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000 + Number((f + '00').substr(0, 3)); }
  N.subs = {
    /* SRT-Text -> [{a, b, x}] sortiert; Tags (<i>, {\an8}) entfernt */
    parse: function (txt) {
      var out = [], blocks = String(txt || '').replace(/\r/g, '').split(/\n\s*\n/);
      for (var i = 0; i < blocks.length; i++) {
        var m = /(\d+):(\d\d):(\d\d)[,.](\d{1,3})\s*-->\s*(\d+):(\d\d):(\d\d)[,.](\d{1,3})[^\n]*\n([\s\S]*)/.exec(blocks[i]);
        if (!m) continue;
        var x = m[9].replace(/<[^>]+>|\{[^}]*\}/g, '').replace(/^\s+|\s+$/g, '');
        if (x) out.push({ a: ms(m[1], m[2], m[3], m[4]), b: ms(m[5], m[6], m[7], m[8]), x: x });
      }
      out.sort(function (p, q) { return p.a - q.a; });
      return out;
    },
    /* Cue zur Zeit t (binaere Suche) -> Index oder -1 */
    cueAt: function (cues, t) {
      var lo = 0, hi = cues.length - 1, r = -1;
      while (lo <= hi) { var mid = (lo + hi) >> 1; if (cues[mid].a <= t) { r = mid; lo = mid + 1; } else hi = mid - 1; }
      return r >= 0 && t < cues[r].b ? r : -1;
    },
    /* SEF-Ereignis 19 (interne UT): Zeilenumbrueche vereinheitlichen, Tags weg */
    clean: function (s) { return String(s || '').replace(/<br\s*\/?>|\\n|\r\n|\n\r|\r/gi, '\n').replace(/<[^>]+>|\{[^}]*\}/g, '').replace(/^\s+|\s+$/g, ''); }
  };
})(N);
