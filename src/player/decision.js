/* N.decision – Decision-Anfrage, Profil-Ergaenzung, Wiedergabe-URL und Rueckfall-Kette (docs/research/player.md Abschn. 3,
 * Korrekturen K1/K2/K4 + K8). Reine Funktionen, in Node getestet.
 * K8 (26.10., GET gegen PMS 1.43.5): mit hasMDE=1 liefert der Decision-Endpunkt NUR die Bandbreiten-Entscheidung (mdeDecisionCode)
 * und ignoriert X-Plex-Client-Profile-Extra -> HEVC kaeme als Direct Play. Deshalb nie hasMDE senden. */
(function (N) {
  var U = N.util;
  function lim(codec, name, v) { return 'add-limitation(scope=videoCodec&scopeName=' + codec + '&type=upperBound&name=' + name + '&value=' + v + '&isRequired=false)'; }
  /* HEVC nie direkt (Handbuch H8000 S. 223), H.264 nur 8 Bit, <= L4.1, <= 1920x1088; Tonspurwahl im Direct Play (K4) */
  var EXTRA = [lim('hevc', 'video.width', 0), lim('h264', 'video.bitDepth', 8), lim('h264', 'video.level', 41),
    lim('h264', 'video.width', 1920), lim('h264', 'video.height', 1088), 'add-settings(DirectPlayStreamSelection=true)',
    'add-transcode-target(type=subtitleProfile&context=all&protocol=http&container=srt&subtitleCodec=srt)'].join('+');
  /* Qualitaet NUR fuer die Umwandlung (K2): kbit/s + Aufloesung */
  var QUAL = { '20': [20000, '1920x1080'], '12': [12000, '1920x1080'], '8': [8000, '1280x720'], '4': [4000, '1280x720'] };
  /* Weitere Server uebers Internet (TV-Test 1.0.4: Direct Play einer MKV scheiterte sofort mit SEF 1): Obergrenze 8 Mbit/s 1080p,
   * schon in der Decision (der Server wandelt dann nur um, wenn die Datei darueber liegt); niedrigere Einstellung gilt weiter */
  var REMOTE = [8000, '1920x1080'];
  var IMG_SUBS = { pgs: 1, hdmv_pgs: 1, vobsub: 1, dvd_subtitle: 1, dvb_subtitle: 1, dvdsub: 1 };
  /* A/B (config hlsEac3): EAC3/AC3 im HLS unveraendert durchreichen statt nach AC3 umzuwandeln (GET-Decision 90546: Ton "copy") */
  var EAC3 = 'add-transcode-target-audio-codec(type=videoProfile&context=streaming&protocol=hls&audioCodec=eac3)';
  /* P5 "Mehrkanal-Ton durchreichen" aus: hoechstens 2 Kanaele. Per GET-Decision gegen PMS 1.43.5 geprueft (26.10., nur lesend):
   * 5.1-AC3 -> Ton "transcode" AC3 2 Kanaele, Video "copy" (Direct Stream statt Direct Play). audioBoost wird angenommen (200),
   * wirkt laut Plex nur, wenn der Ton umgewandelt wird – Wirkung am TV hoeren (docs/P5-TV-TEST.md). */
  var STEREO = 'add-limitation(scope=videoAudioCodec&scopeName=*&type=upperBound&name=audio.channels&value=2&isRequired=false)';
  var D = {
    EXTRA: EXTRA, QUAL: QUAL, REMOTE: REMOTE, EAC3: EAC3, STEREO: STEREO,
    /* o: {rk, mediaIndex, partIndex, session, clientId, token, dp, ds, subs:'none'|'burn', quality:'12', offsetSec, transcode,
     *     stereo (P5: Mehrkanal nicht durchreichen), boost (P5: audioBoost 100–300, nur bei Ton-Umwandlung wirksam)}
     * Reihenfolge stabil (Tests). Token als Query: SEF kann keine Header setzen. */
    query: function (o) {
      var C = N.config, q = {
        path: '/library/metadata/' + o.rk, mediaIndex: o.mediaIndex || 0, partIndex: o.partIndex || 0, protocol: 'hls',
        fastSeek: 1, copyts: 1, location: o.wan ? 'wan' : 'lan', directPlay: o.dp ? 1 : 0, directStream: o.ds ? 1 : 0, directStreamAudio: 1,
        videoResolution: '1920x1080', subtitles: o.subs || 'none', audioBoost: o.boost > 100 ? o.boost : 100, offset: o.offsetSec || 0,
        session: o.session, 'X-Plex-Session-Identifier': o.session, 'X-Plex-Client-Identifier': o.clientId,
        'X-Plex-Product': C.product, 'X-Plex-Version': C.version, 'X-Plex-Platform': C.platform, 'X-Plex-Device': C.device,
        'X-Plex-Client-Profile-Extra': EXTRA, 'X-Plex-Token': o.token
      }, H = C.hls || {};
      if (H.eac3) q['X-Plex-Client-Profile-Extra'] = EXTRA + '+' + EAC3;
      if (o.stereo) q['X-Plex-Client-Profile-Extra'] += '+' + STEREO;
      if (H.incomplete) q['X-Plex-Incomplete-Segments'] = 1;
      if (o.transcode || o.wan) {                     // Bitratengrenze nur, wenn das Video wirklich umgewandelt wird (K2) – bzw. uebers Internet immer
        var qq = QUAL[o.quality] || QUAL['12'];
        if (o.wan && qq[0] > REMOTE[0]) qq = REMOTE;
        q.maxVideoBitrate = qq[0]; q.videoResolution = qq[1];
      }
      return q;
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
