/* N.versions – Versionswahl bei mehreren Dateien je Titel (SPEC 7.6 UX-S6): Klartext je Version, automatische Wahl
 * (1080p H.264 8 Bit > 720p H.264 8 Bit > andere H.264 > HEVC > Rest; innerhalb gleich: hoechste Bitrate <= Qualitaetsgrenze),
 * Wahl des Nutzers gilt je Titel fuer diese Sitzung (nur im Speicher). Index = mediaIndex der Decision. Rein bis auf N.t. */
(function (N) {
  var VC = { h264: 'H.264', avc1: 'H.264', hevc: 'HEVC', h265: 'HEVC', mpeg4: 'MPEG-4', mpeg2video: 'MPEG-2', vc1: 'VC-1', av1: 'AV1', vp9: 'VP9' };
  var mem = {};
  function lc(s) { return String(s || '').toLowerCase(); }
  function num(v) { return Number(v) || 0; }
  /* Videospur der ersten Part (nur in vollen Metadaten vorhanden) */
  function vstream(md) {
    var p = md.Part && md.Part[0], l = p && p.Stream || [];
    for (var i = 0; i < l.length; i++) if (l[i].streamType === 1) return l[i];
    return null;
  }
  function resText(md) {
    var r = lc(md.videoResolution), h = num(md.height);
    if (r === '4k' || h > 1600) return '4K';
    if (/^\d+$/.test(r)) return r + 'p';
    if (r === 'sd') return 'SD';
    return h ? h + 'p' : '';
  }
  /* japanische Tonspur in einer Version (Anime-Wiedergaberegeln: diese Version bevorzugen) */
  function hasJa(md) {
    for (var i = 0; md.Part && i < md.Part.length; i++) {
      var l = md.Part[i].Stream || [];
      for (var k = 0; k < l.length; k++) if (l[k].streamType === 2 && /^(jpn|ja)$/i.test(String(l[k].languageCode || ''))) return true;
    }
    return false;
  }
  function size(md) { var t = 0; for (var i = 0; md.Part && i < md.Part.length; i++) t += num(md.Part[i].size); return t; }
  function sizeText(b) {
    if (!b) return '';
    if (b >= 1e9) return N.t('pl.ver.gb', { n: (Math.round(b / 1e8) / 10).toFixed(1).replace('.', N.t('fmt.decimal')) });
    return N.t('pl.ver.mb', { n: Math.max(1, Math.round(b / 1e6)) });
  }
  var V = {
    /* Media[] -> [{i, res, vc, depth, br, size, dur, direct, label, sub}] */
    list: function (media) {
      var out = [], durs = {}, nd = 0;
      for (var i = 0; media && i < media.length; i++) {
        var md = media[i], vs = vstream(md), vc = lc(md.videoCodec), depth = num(vs && vs.bitDepth) || 8, w = num(md.width), h = num(md.height);
        var direct = vc === 'h264' && depth <= 8 && w <= 1920 && h <= 1088 && !(num(vs && vs.level) > 41);
        var v = { i: i, ja: hasJa(md), res: resText(md), vc: vc, depth: depth, h: h, br: num(md.bitrate), size: size(md), dur: num(md.duration), direct: direct };
        var parts = [v.res, (VC[vc] || vc.toUpperCase()) + (depth > 8 ? ' ' + N.t('pl.ver.bit', { n: depth }) : ''), sizeText(v.size)], lab = [];
        for (var k = 0; k < parts.length; k++) if (parts[k]) lab.push(parts[k]);
        v.label = lab.join(' · ');
        if (!durs[Math.round(v.dur / 60000)]) { durs[Math.round(v.dur / 60000)] = 1; nd++; }
        out.push(v);
      }
      for (i = 0; i < out.length; i++) {
        var s = [N.t(out[i].direct ? 'pl.ver.direct' : 'pl.ver.convert')];
        if (nd > 1 && out[i].dur) s.push(N.fmt.dur(out[i].dur));     // unterschiedlich lang (z. B. Kinofassung/Extended)
        out[i].sub = s.join(' · ');
      }
      return out;
    },
    /* Rang nach SPEC 7.6 (kleiner = besser) */
    rank: function (v) {
      if (v.vc === 'h264' && v.depth <= 8 && v.h > 720 && v.h <= 1088) return 0;
      if (v.vc === 'h264' && v.depth <= 8 && v.h <= 720 && v.h > 480) return 1;
      if (v.vc === 'h264') return 2;
      if (v.vc === 'hevc' || v.vc === 'h265') return 3;
      return 4;
    },
    /* automatische Wahl: Index; limit = kbit/s der Qualitaetsstufe (0 = ohne Grenze) */
    auto: function (list, limit) {
      var best = -1;
      for (var i = 0; list && i < list.length; i++) {
        if (best < 0) { best = i; continue; }
        var a = list[i], b = list[best], ra = V.rank(a), rb = V.rank(b);
        if (ra !== rb) { if (ra < rb) best = i; continue; }
        var ia = !limit || a.br <= limit, ib = !limit || b.br <= limit;
        if (ia !== ib) { if (ia) best = i; continue; }
        if (ia ? a.br > b.br : a.br < b.br) best = i;            // unter der Grenze: hoechste, darueber: niedrigste
      }
      return best < 0 ? 0 : best;
    },
    /* Wahl fuer rk: gemerkte (gueltige) Wahl, sonst automatisch. preferJa (Anime-Wiedergaberegeln an, Titel ist Anime): unter den
     * Versionen mit japanischer Tonspur automatisch waehlen; hat keine eine, die normale Wahl */
    choose: function (rk, media, limit, preferJa) {
      var n = media ? media.length : 0, m = mem[rk];
      if (m !== undefined && m >= 0 && m < n) return m;
      if (n < 2) return 0;
      var all = V.list(media), sub = [];
      if (preferJa) for (var i = 0; i < all.length; i++) if (all[i].ja) sub.push(all[i]);
      if (sub.length && sub.length < all.length) return sub[V.auto(sub, limit)].i;
      return V.auto(all, limit);
    },
    /* irgendeine Version mit japanischer Tonspur? */
    anyJa: function (media) { for (var i = 0; media && i < media.length; i++) if (hasJa(media[i])) return true; return false; },
    get: function (rk) { return mem[rk]; },
    set: function (rk, i) { mem[rk] = i; },
    reset: function () { mem = {}; }
  };
  N.versions = V;
  if (N.evt) N.evt.on('profile:changed', V.reset);
})(N);
