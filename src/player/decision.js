/* N.decision – Decision-Anfrage, Profil-Ergaenzung, Wiedergabe-URL und Rueckfall-Kette (docs/research/player.md Abschn. 3,
 * Korrekturen K1/K2/K4 + K8). Reine Funktionen, in Node getestet.
 * K8 (26.10., GET gegen PMS 1.43.5): mit hasMDE=1 liefert der Decision-Endpunkt NUR die Bandbreiten-Entscheidung (mdeDecisionCode)
 * und ignoriert X-Plex-Client-Profile-Extra -> HEVC kaeme als Direct Play. Deshalb nie hasMDE senden. */
(function (N) {
  var U = N.util;
  function lim(codec, name, v) { return 'add-limitation(scope=videoCodec&scopeName=' + codec + '&type=upperBound&name=' + name + '&value=' + v + '&isRequired=false)'; }
  /* Grenzen je Codec aus N.platform.caps.codecs: false = nie direkt (Breite <= 0), true = ohne Grenzen, sonst Bittiefe/Level/Maße */
  function limits(codec, c, out) {
    if (c === false) { out.push(lim(codec, 'video.width', 0)); return; }
    if (!c || c === true) return;
    if (c.maxBitDepth > 0) out.push(lim(codec, 'video.bitDepth', c.maxBitDepth));
    if (c.maxLevel > 0) out.push(lim(codec, 'video.level', c.maxLevel));
    if (c.maxWidth > 0) out.push(lim(codec, 'video.width', c.maxWidth));
    if (c.maxHeight > 0) out.push(lim(codec, 'video.height', c.maxHeight));
  }
  /* caps.codecs -> X-Plex-Client-Profile-Extra; Reihenfolge fest: hevc, h264, Spurwahl (K4), Untertitel-Ziel. Orsay-Standard
   * (HEVC nie direkt, Handbuch H8000 S. 223; H.264 nur 8 Bit, <= L4.1, <= 1920x1088) ergibt zeichengleich den Text vor P1. */
  function extraFor(codecs) {
    var c = codecs || {}, out = [];
    limits('hevc', c.hevc === undefined ? false : c.hevc, out);
    limits('h264', c.h264, out);
    if (c.streamSelection) out.push('add-settings(DirectPlayStreamSelection=true)');
    if (c.subtitleTarget) out.push('add-transcode-target(type=subtitleProfile&context=all&protocol=http&container=' + c.subtitleTarget + '&subtitleCodec=' + c.subtitleTarget + ')');
    return out.join('+');
  }
  var EXTRA = extraFor(N.platform.caps.codecs);
  /* Qualitaet NUR fuer die Umwandlung (K2): kbit/s + Aufloesung */
  var QUAL = { '80': [80000, '3840x2160'], '40': [40000, '3840x2160'], '20': [20000, '1920x1080'], '12': [12000, '1920x1080'], '8': [8000, '1280x720'], '4': [4000, '1280x720'] };
  /* Stufen ueber 1080p (Apple Nr. 5, SPEC PLAY-37): 4K nur, wenn das Geraet es dekodiert (caps.codecs.maxResolution >= 3840x2160;
   * der TV 2014 nicht). 'orig' = "Original (ohne Grenze)": keine Bitratengrenze in der Decision (Direct Play/Stream, wenn die Datei
   * passt); muss der Server trotzdem umwandeln (Format), dann mit der hoechsten Stufe des Geraets (D.origCap) – nie unbegrenzt. */
  var ORIG = 'orig', ORDER = ['80', '40', '20', '12', '8', '4'];
  function px(r) { var m = /^(\d+)x(\d+)$/.exec(String(r || '')); return m ? [Number(m[1]), Number(m[2])] : [0, 0]; }
  function fits(r) { var a = px(r), b = px(N.platform.caps.codecs.maxResolution); return a[0] <= b[0] && a[1] <= b[1]; }
  /* Zahlen-Stufen dieses Geraets, hoechste zuerst (TV: 20, 12, 8, 4) */
  function nums() { var o = []; for (var i = 0; i < ORDER.length; i++) if (fits(QUAL[ORDER[i]][1])) o.push(ORDER[i]); return o; }
  /* wirksame Stufe einer gespeicherten Einstellung: Original | Stufe des Geraets; eine bekannte Stufe ueber dem Geraet (z. B. 4K-Wert
   * eines anderen Geraets am TV) = hoechste Stufe des Geraets; unbekannt = def */
  function eff(k, def) { k = String(k); if (k === ORIG) return ORIG; if (QUAL[k]) return fits(QUAL[k][1]) ? k : nums()[0]; return def; }
  /* Grenze einer Stufe auf diesem Geraet: [kbit/s, Aufloesung] | null (Original) | def (unbekannt) */
  function step(k, def, tab) { var e = eff(k, ''); return e === ORIG ? null : e ? (tab || QUAL)[e] : def; }
  function lower(a, b) { return !a ? b : !b ? a : b[0] < a[0] ? b : a; }   // niedrigere Grenze; bei gleicher Bitrate die erste
  /* Ueber das Internet (o.wan: Weitere Server; eigener Server unterwegs, Ansicht player) und ueber Mobilfunk (o.cell): Obergrenze
   * schon in der Decision (der Server wandelt dann nur um, wenn die Datei darueber liegt). Einstellungen "Qualitaet ueber das
   * Internet" (o.qWan, Standard 8 = REMOTE wie seit TV-Test 1.0.4) und "Qualitaet ueber Mobilfunk" (o.qCell, Standard 4); es gilt
   * die niedrigste Grenze (auch "beim Umwandeln"); 8 Mbit/s uebers Internet mit 1080p wie bisher. */
  var REMOTE = [8000, '1920x1080'];
  var QWAN = { '80': QUAL['80'], '40': QUAL['40'], '20': QUAL['20'], '12': QUAL['12'], '8': REMOTE, '4': QUAL['4'] };
  var IMG_SUBS = { pgs: 1, hdmv_pgs: 1, vobsub: 1, dvd_subtitle: 1, dvb_subtitle: 1, dvdsub: 1 };
  /* A/B (config hlsEac3): EAC3/AC3 im HLS unveraendert durchreichen statt nach AC3 umzuwandeln (GET-Decision 90546: Ton "copy") */
  var EAC3 = 'add-transcode-target-audio-codec(type=videoProfile&context=streaming&protocol=hls&audioCodec=eac3)';
  /* P5 "Mehrkanal-Ton durchreichen" aus: hoechstens 2 Kanaele. Per GET-Decision gegen PMS 1.43.5 geprueft (26.10., nur lesend):
   * 5.1-AC3 -> Ton "transcode" AC3 2 Kanaele, Video "copy" (Direct Stream statt Direct Play). audioBoost wird angenommen (200),
   * wirkt laut Plex nur, wenn der Ton umgewandelt wird – Wirkung am TV hoeren (docs/P5-TV-TEST.md). */
  var STEREO = 'add-limitation(scope=videoAudioCodec&scopeName=*&type=upperBound&name=audio.channels&value=2&isRequired=false)';
  var D = {
    EXTRA: EXTRA, extraFor: extraFor, QUAL: QUAL, QWAN: QWAN, REMOTE: REMOTE, EAC3: EAC3, STEREO: STEREO, ORIG: ORIG,
    nums: nums,
    /* Werte der Einstellungen "Qualitaet beim Umwandeln/ueber das Internet/ueber Mobilfunk": Original zuerst, dann die Zahlen-Stufen */
    steps: function () { return [ORIG].concat(nums()); },
    /* hoechste Zahlen-Stufe des Geraets (TV '20', 4K-Geraet '80'): Umwandeln bei "Original" */
    top: function () { return nums()[0]; },
    /* wirksame Stufe einer gespeicherten Einstellung ('orig' | Stufe des Geraets; zu hoch -> hoechste, unbekannt -> def, Standard '12') */
    eff: function (k, def) { return eff(k, def || '12'); },
    /* darf das Video unveraendert in den HLS-Strom (Direct Stream)? hevc nur, wenn das Geraet es direkt spielt und HLS es traegt
     * (caps.codecs.hevcStream !== false; Apple: HEVC im HLS braucht fMP4), h264 ausser bei false, andere Codecs nie */
    copyOk: function (vc) {
      var c = N.platform.caps.codecs; vc = String(vc || '').toLowerCase();
      return vc === 'hevc' ? !!c.hevc && c.hevcStream !== false : vc === 'h264' ? c.h264 !== false : false;
    },
    /* Grenze beim Umwandeln mit "Original": hoechste Stufe des Geraets; ist der Quell-Codec (vc, falls bekannt) hier nicht direkt
     * moeglich, wandelt der Server das ganze Bild neu – dann hoechstens 20 Mbit/s · 1080p (4K-HEVC -> 4K-H.264 mit 80 Mbit/s
     * waere die teuerste Umwandlung, PLAY-37). TV: hoechste Stufe ist ohnehin 20. */
    origCap: function (vc) { var t = QUAL[D.top()]; return vc && !D.copyOk(vc) ? lower(t, QUAL['20']) : t; },
    /* Bitratengrenze fuer die Versionswahl (N.versions.choose): wie beim Umwandeln, ohne Netz (Detailseite = Wiedergabe) */
    verLimit: function (quality) { return D.cap({ quality: quality })[0]; },
    /* Aufloesung als Kurztext: 4K | 1080p | 720p */
    resText: function (r) { var h = px(r)[1]; return h >= 2160 ? '4K' : h >= 1080 ? '1080p' : '720p'; },
    /* Klartext einer Stufe ("12 Mbit/s · 1080p", "Original (ohne Grenze)"); tab = Tabelle (QUAL bzw. QWAN, Standard QUAL) */
    label: function (k, tab) {
      if (String(k) === ORIG) return N.t('set.v.qOrig');
      var q = (tab || QUAL)[k] || QUAL[k] || QUAL['12'];
      return N.t('set.v.q', { n: q[0] / 1000, r: D.resText(q[1]) });
    },
    /* o: {rk, mediaIndex, partIndex, session, clientId, token, dp, ds, subs:'none'|'burn', quality:'12', offsetSec, transcode,
     *     stereo (P5: Mehrkanal nicht durchreichen), boost (P5: audioBoost 100–300, nur bei Ton-Umwandlung wirksam),
     *     wan + qWan (ueber das Internet), cell + qCell (ueber Mobilfunk), vcodec (Quell-Codec, fuer Original beim Umwandeln)}
     * Reihenfolge stabil (Tests). Token als Query: SEF kann keine Header setzen. */
    query: function (o) {
      var C = N.config, q = {
        path: '/library/metadata/' + o.rk, mediaIndex: o.mediaIndex || 0, partIndex: o.partIndex || 0, protocol: 'hls',
        fastSeek: 1, copyts: 1, location: o.wan ? 'wan' : 'lan', directPlay: o.dp ? 1 : 0, directStream: o.ds ? 1 : 0, directStreamAudio: 1,
        videoResolution: N.platform.caps.codecs.maxResolution, subtitles: o.subs || 'none', audioBoost: o.boost > 100 ? o.boost : 100, offset: o.offsetSec || 0,
        session: o.session, 'X-Plex-Session-Identifier': o.session, 'X-Plex-Client-Identifier': o.clientId,
        'X-Plex-Product': C.product, 'X-Plex-Version': C.version, 'X-Plex-Platform': C.platform, 'X-Plex-Device': C.device,
        'X-Plex-Client-Profile-Extra': EXTRA, 'X-Plex-Token': o.token
      }, H = C.hls || {};
      if (H.eac3) q['X-Plex-Client-Profile-Extra'] = EXTRA + '+' + EAC3;
      if (o.stereo) q['X-Plex-Client-Profile-Extra'] += '+' + STEREO;
      if (H.incomplete) q['X-Plex-Incomplete-Segments'] = 1;
      // Bitratengrenze nur, wenn das Video wirklich umgewandelt wird (K2) – bzw. uebers Internet/Mobilfunk, solange dort eine Grenze gilt
      var qq = o.transcode ? D.cap(o) : o.wan || o.cell ? D.limit(o) : null;
      if (qq) { q.maxVideoBitrate = qq[0]; q.videoResolution = qq[1]; }
      return q;
    },
    /* Grenze im Internet/Mobilfunk VOR der Umwandlung (Decision): niedrigste der Zahlen-Grenzen "ueber das Internet" (wan) und
     * "ueber Mobilfunk" (cell), dazu "beim Umwandeln" (gilt fuer das, was der Server dann umwandelt); bei gleicher Bitrate bleibt die
     * erste (8 beim Umwandeln = 720p wie bisher). Steht Internet bzw. Mobilfunk auf Original, gilt dort keine Grenze -> null
     * (Decision ohne maxVideoBitrate wie im Heimnetz, K2) */
    limit: function (o) {
      var w = null;
      if (o.wan) w = lower(w, step(o.qWan, REMOTE, QWAN));
      if (o.cell) w = lower(w, step(o.qCell, QUAL['4'], QWAN));
      return w ? lower(step(o.quality, QUAL['12']), w) : null;
    },
    /* wirksame Grenze beim Umwandeln [kbit/s, Aufloesung], immer endlich: "beim Umwandeln" (Original = D.origCap(o.vcodec)),
     * darunter ggf. Internet und Mobilfunk */
    cap: function (o) {
      var qq = step(o.quality, QUAL['12']) || D.origCap(o.vcodec);
      return o.wan || o.cell ? lower(qq, D.limit(U.extend(U.extend({}, o), { quality: ORIG }))) : qq;
    },
    decisionUrl: function (base, o) { return base + '/video/:/transcode/universal/decision?' + U.qs(D.query(o)); },
    startUrl: function (base, o) {
      var sb = N.config.hls && N.config.hls.startBitrate;
      return base + '/video/:/transcode/universal/start.m3u8?' + U.qs(D.query(o)) + '|COMPONENT=HLS' + (sb ? '|STARTBITRATE=' + sb : '');
    },
    directUrl: function (base, partKey, token, clientId) { return base + partKey + '?' + U.qs({ 'X-Plex-Token': token, 'X-Plex-Client-Identifier': clientId }); },
    /* Decision-Antwort -> {mode:'direct'|'stream'|'transcode'|'error', code, text, partKey, video, audio, sub, reason} */
    parse: function (json) {
      var mc = json && json.MediaContainer, r = { mode: 'error', code: 0, text: '', partKey: '', video: '', audio: '', sub: '', vcodec: '', reason: '' };
      if (!mc) return r;
      r.code = Number(mc.generalDecisionCode) || 0;
      r.text = mc.generalDecisionText || mc.transcodeDecisionText || '';
      r.reason = mc.directPlayDecisionCode && Number(mc.directPlayDecisionCode) !== 1000 ? (mc.directPlayDecisionText || '') : '';
      var m = mc.Metadata && mc.Metadata[0], md = m && m.Media && m.Media[0], p = md && md.Part && md.Part[0];
      if (!p || r.code >= 2000) return r;
      for (var i = 0; p.Stream && i < p.Stream.length; i++) {
        var s = p.Stream[i], d = s.decision || (p.decision === 'directplay' ? 'directplay' : '');
        if (s.streamType === 1 && !r.video) { r.video = d; r.vcodec = s.codec || ''; }
        else if (s.streamType === 2 && !r.audio) r.audio = d;
        else if (s.streamType === 3 && !r.sub) r.sub = d;
      }
      if (p.decision === 'directplay') { r.mode = 'direct'; r.partKey = p.key || ''; }
      else if (p.decision === 'transcode' || p.decision === 'copy') r.mode = r.video === 'copy' ? 'stream' : 'transcode';
      if (r.mode === 'direct' && !r.partKey) r.mode = 'error';
      return r;
    },
    /* Rueckfall-Kette (Nutzer: direct play -> direct stream -> transcode). att: {dp, ds} ; failed: Modus, der scheiterte */
    fallback: function (att, failed) {
      if (failed === 'direct') return { dp: false, ds: true };
      if (failed === 'stream') return { dp: false, ds: false };
      return null;
    },
    /* Klartext-Schluessel fuer Statuszeile/INFO (SPEC 10.7) */
    modeKey: function (r, subBurn) {
      if (r.mode === 'direct') return 'pl.mode.direct';
      if (r.mode === 'stream') return r.audio === 'transcode' ? 'pl.mode.audio' : 'pl.mode.stream';
      if (subBurn && r.video === 'transcode' && r.vcodec === 'h264' && !/hevc|bitDepth|level|width|height/i.test(r.reason)) return 'pl.mode.subs';
      if (/hevc/i.test(r.reason) || /limitation applies: \d+ > 0/.test(r.reason)) return 'pl.mode.hevc';
      if (/bitDepth/i.test(r.reason)) return 'pl.mode.10bit';
      return 'pl.mode.transcode';
    },
    isImageSub: function (codec) { return !!IMG_SUBS[String(codec || '').toLowerCase()]; },
    /* Fehlerart fuer den Fehlerbildschirm (SPEC 10.5) */
    errKind: function (err, r) {
      if (err) {
        if (err.status === 401 || err.status === 403) return 'notAllowed';
        if (err.status === 404) return 'fileMissing';
        if (err.status === 503) return 'busy';
        if (err.type === 'network' || err.type === 'timeout' || err.status >= 500) return 'server';
        return 'playback';
      }
      if (r && (r.code === 2000 || /not found|missing/i.test(r.text))) return 'fileMissing';
      return 'playback';
    }
  };
  N.decision = D;
})(N);
