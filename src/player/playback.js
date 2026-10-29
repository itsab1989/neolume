/* N.Playback – Ablaufsteuerung einer Wiedergabe (SPEC 14.10, docs/research/player.md 3–5). Ohne DOM; alle Aussenkontakte
 * ueber deps (Tests mit Faelschungen, keine echten Sitzungen):
 *   deps.sef      {exec(name, a, b, …) -> Rueckgabe}         (N.sef.create)
 *   deps.get      (path, query, opts, cb)  PMS-GET           deps.write (method, path, query, cb)  schreibend (readOnly beachtet)
 *   deps.timers   {now, set, clear}         deps.base / token / clientId   deps.cfg (Einstellungen)   deps.mem(showRk) -> gemerkte Spuren
 * Zustaende: resolving -> buffering <-> playing <-> paused -> ended | stopped | error. Schnellspulen (PLAY-32): speed != 1 bei
 * Zustand 'playing' (Trick-Modus des SEF, nur Direct Play), siehe trick()/normal().
 * Ereignisse (on(fn(ev, data))): meta, state, time, buffer, sub, ended, error, tracks, speed, trickEdge. */
(function (N) {
  var U = N.util, D = N.decision, TR = N.tracks, TL_MS = 10000;
  function Playback(deps, item) {
    this.d = deps; this.item = item; this.state = 'idle'; this.t = item.off || 0; this.resume = item.off || 0;
    this.meta = null; this.r = null; this.hls = false; this.att = { dp: deps.cfg.directPlay !== false && !deps.wan, ds: true };   // weiterer Server uebers Internet: gleich HLS (Direct Stream/Umwandlung)
    this.fns = []; this.loop = 0; this.session = ''; this.sub = null; this.subMode = 'none'; this.firstTick = false; this.dead = false;
    this.aspect = deps.cfg.aspect || 'auto'; this.base = 0; this.rel = false; this.t0 = 0; this.cropped = null;
    this.queueItem = item.pqi || null; this.queueId = item.pqId || null;
    this.speed = 1; this.cap = null; this.refused = null; this.revAt = 0;   // Schnellspulen: aktuelle Geschwindigkeit, Kappung abgelehnter Stufen {f, b}
  }
  var P = Playback.prototype;
  P.on = function (fn) { this.fns.push(fn); };
  P.emit = function (ev, data) { for (var i = 0; i < this.fns.length; i++) this.fns[i](ev, data); };
  P.log = function (m) { if (N.log) N.log('player ' + m); };
  P.setState = function (s) {
    if (this.state === s) return;
    var old = this.state; this.state = s;
    this.emit('state', s);
    if ((s === 'playing' || s === 'paused' || s === 'buffering') && old !== 'resolving') this.timeline();
  };
  P.exec = function (name, a, b, c, dd, e, f) {
    var r;
    // nur echte Argumente weiterreichen: SEF lehnt ueberzaehlige undefined-Parameter mit -1 ab (TV-Test 26.10.)
    var args = Array.prototype.slice.call(arguments);
    try { r = this.d.sef.exec.apply(this.d.sef, args); } catch (x) { this.log(name + ' wirft ' + x.message); r = -1; }
    if (name !== 'GetDuration') this.log(name + (a !== undefined ? ' ' + String(a).split('?')[0] : '') + ' -> ' + r);
    return r;
  };
  P.dur = function () { return this.meta && this.meta.dur || 0; };
  /* Zeitstempel fuer die Startzeit-Messung (TV-Log: "Zeit <was> +1234 ms" ab Start bzw. Neustart) */
  P.mark = function (what) { this.log('Zeit ' + what + ' +' + (this.d.timers.now() - this.t0) + ' ms'); };
  P.hlsCfg = function () { return (N.config && N.config.hls) || {}; };

  /* ---------- Start ---------- */
  P.start = function () {
    var self = this;
    this.t0 = this.d.timers.now();
    this.setState('resolving');
    this.d.get('/library/metadata/' + this.item.rk, { includeMarkers: 1, includeChapters: 1 }, { timeout: 12000 }, function (err, json) {
      if (self.dead) return;
      var m = json && json.MediaContainer && json.MediaContainer.Metadata && json.MediaContainer.Metadata[0];
      if (err || !m) { self.fail(D.errKind(err || { status: 404 }), err ? (err.status || err.type) : 'meta'); return; }
      var lim = (D.QUAL[self.d.cfg.quality] || D.QUAL['12'])[0];
      // Anime-Wiedergaberegeln: Version mit japanischer Tonspur bevorzugen (sonst normale Versionswahl)
      var c = self.d.cfg, info = { type: m.type, rk: String(m.ratingKey), showRk: m.grandparentRatingKey ? String(m.grandparentRatingKey) : '', lib: Number(m.librarySectionID) || 0 };
      var preferJa = !!c.anime && !!self.d.isAnime && self.d.isAnime(info, N.versions.anyJa(m.Media));
      self.meta = Playback.meta(m, N.versions.choose(self.item.rk, m.Media, lim, preferJa));
      if (!self.meta.part) { self.fail('fileMissing', 'kein Part'); return; }
      self.emit('meta', self.meta);
      self.autoTracks(function () { self.decide(); });
    });
  };
  /* Metadaten -> schlankes Objekt (rein, getestet); mi = gewaehlte Version (Media-Index, Standard 0) */
  Playback.meta = function (m, mi) {
    mi = mi > 0 && m.Media && mi < m.Media.length ? mi : 0;
    var md = m.Media && m.Media[mi], part = md && md.Part && md.Part[0];
    var ar = Number(md && md.aspectRatio) || (md && md.width && md.height ? md.width / md.height : 16 / 9);
    return { rk: String(m.ratingKey), type: m.type, title: m.title || '', show: m.grandparentTitle || '', showRk: m.grandparentRatingKey ? String(m.grandparentRatingKey) : '',
      s: Number(m.parentIndex) || 0, e: Number(m.index) || 0, dur: Number(part && part.duration) || Number(m.duration) || 0, lib: Number(m.librarySectionID) || 0,
      part: part || null, partId: part ? part.id : 0, parts: md && md.Part ? md.Part.length : 0, ar: ar, markers: m.Marker || [], thumb: m.thumb || '',
      tracks: TR.streams(part), vcodec: md && md.videoCodec || '', acodec: md && md.audioCodec || '', container: md && md.container || '',
      res: md && md.videoResolution || '', bitrate: Number(md && md.bitrate) || 0, vw: Number(md && md.width) || 0, vh: Number(md && md.height) || 0,
      chapters: N.osd ? N.osd.chapters(m.Chapter) : [], mi: mi, versions: m.Media && m.Media.length > 1 ? N.versions.list(m.Media) : [] };
  };
  /* automatische Spurwahl vor der Decision (PUT /library/parts, muss vorher fertig sein – Patch X21) */
  P.autoTracks = function (done) {
    var c = this.d.cfg, M = this.meta;
    // P5: nur bei Titeln, die als Anime erkannt sind (N.anime, set.animeDetect); ohne japanische Spur greift die Regel nicht (normale Wahl)
    var anime = !!c.anime && (!this.d.isAnime || this.d.isAnime(M, N.anime ? N.anime.jaTracks(M.tracks) : false));
    var ch = TR.choose(M.tracks, { audioLang: c.audioLang, subs: c.subs, subLang: c.subLang, anime: anime, animeAudio: c.animeAudio, animeSubs: c.animeSubs,
      animeSigns: c.animeSigns, remember: c.rememberTracks },
      c.rememberTracks && this.d.mem ? this.d.mem(M.showRk) : null, M.type === 'episode');
    this.log('Spuren ' + ch.why + ' a=' + ch.a + ' s=' + ch.s);
    this.applyTracks(ch.a, ch.s, done);
  };
  /* a: id|null, s: id|0|null -> Server-Auswahl setzen und lokal markieren */
  P.applyTracks = function (a, s, done) {
    var M = this.meta, q = { allParts: 1 }, i, T = M.tracks;
    if (a === null && s === null) { this.pickSub(); done(); return; }
    if (a !== null) { q.audioStreamID = a; for (i = 0; i < T.audio.length; i++) T.audio[i].sel = T.audio[i].id === a; }
    if (s !== null) { q.subtitleStreamID = s || 0; for (i = 0; i < T.subs.length; i++) T.subs[i].sel = T.subs[i].id === s; }
    this.pickSub();
    this.emit('tracks', T);
    this.d.write('PUT', '/library/parts/' + M.partId, q, function () { done(); });
  };
  P.pickSub = function () { this.sub = TR.selected(this.meta.tracks.subs); };
  /* Wahl im Panel waehrend der Wiedergabe. kind 'a' | 's', id (Untertitel 0 = aus). Direct Play: lokal umschalten; Umwandlung
   * oder Wechsel von/zu eingebrannten UT: Sitzung an der Stelle neu starten. */
  P.changeTrack = function (kind, id) {
    var self = this, T = this.meta.tracks, old = this.subMode;
    this.applyTracks(kind === 'a' ? id : null, kind === 's' ? id : null, function () {
      if (self.dead) return;
      var now = TR.subMode(self.sub, self.d.cfg.ass, self.hls);
      if (kind === 'a') {
        if (self.hls) self.restart(self.t); else self.exec('SetStreamID', 1, TR.selected(T.audio).idx);
        return;
      }
      if (old === 'burn' || now === 'burn') { self.restart(self.t); return; }
      if (old === 'sef') self.exec('StopSubtitle');
      self.subMode = now;
      if (now === 'sef') { self.exec('StartSubtitle', self.sub.idx); self.exec('SetStreamID', 4, self.sub.idx); }
      self.emit('subs', now);
    });
  };
  P.decide = function () {
    var self = this, c = this.d.cfg, M = this.meta;
    this.session = U.uuid();
    var burn = TR.subMode(this.sub, c.ass, false) === 'burn';
    var o = { rk: M.rk, mediaIndex: M.mi, session: this.session, clientId: this.d.clientId, token: this.d.token, wan: !!this.d.wan, dp: this.att.dp && !burn, ds: this.att.ds, subs: burn ? 'burn' : 'none', quality: c.quality,
      stereo: c.passthrough === false, boost: c.passthrough === false ? Number(c.audioBoost) || 100 : 100 };
    this.setState('resolving');
    this.d.get('/video/:/transcode/universal/decision', D.query(o), { timeout: 15000, retries: 1 }, function (err, json) {
      if (self.dead) return;
      var r = D.parse(json);
      self.r = r;
      if (err || r.mode === 'error') { self.fail(D.errKind(err, r), err ? (err.status || err.type) : r.code + ' ' + r.text); return; }
      self.hls = r.mode !== 'direct'; self.base = 0;
      self.subMode = TR.subMode(self.sub, c.ass, self.hls);
      var url;
      if (!self.hls) url = D.directUrl(self.d.base, r.partKey, self.d.token, self.d.clientId);
      else {
        o.dp = false; o.subs = self.subMode === 'burn' ? 'burn' : 'none';
        o.transcode = r.mode === 'transcode' || o.subs === 'burn';
        // A/B hlsOffset: Server beginnt an der Fortsetzen-Stelle (offset=), SEF startet bei 0; Zeitbasis klaert der erste Tick
        self.base = self.hlsCfg().offset ? Math.floor(self.resume / 1000) * 1000 : 0;
        o.offsetSec = self.base / 1000;
        url = D.startUrl(self.d.base, o);
      }
      self.log('Decision ' + r.code + ' ' + r.mode + ' ' + r.reason);
      self.mark('Decision fertig');
      self.emit('decision', r);
      self.open(url);
    });
  };
  P.open = function (url) {
    var self = this, H = this.hlsCfg(), sec = Math.floor(this.resume / 1000);
    if (this.hls && this.base) sec = 0;
    this.rel = false;
    this.slow();                                     // neuer Datenstrom (Rueckfall, Neustart): das SEF beginnt mit 1x
    this.exec('Stop');
    this.firstTick = false; this.buffered = false;
    this.setState('buffering');
    function go() {
      if (self.dead) return;
      self.log('InitPlayer ' + url.split('?')[0] + (url.indexOf('|') > 0 ? ' ' + url.slice(url.indexOf('|')) : ''));
      self.mark('InitPlayer');
      self.exec('InitPlayer', url);
      self.applyArea();
      // A/B hlsBuf (KB): Puffergroessen wie Orca Player.setBuffer – nach InitPlayer, vor StartPlayback
      var b = self.hls && H.buf;
      if (b && b.init > 0) self.exec('SetInitialBufferSize', b.init * 1024);
      if (b && b.pending > 0) self.exec('SetPendingBufferSize', b.pending * 1024);
      if (b && b.total > 0) self.exec('SetTotalBufferSize', b.total * 1024);
      self.mark('StartPlayback');
      if (self.exec('StartPlayback', sec) === -1) self.onEvent(6, 6);
    }
    // kurze Pause, damit der Transcoder erste Segmente hat (Orca: 1 s; Standard 300 ms, config.json hlsWait)
    var w = H.wait === undefined ? 300 : H.wait;
    if (this.hls && w > 0) this.d.timers.set(go, w); else go();
    this.arm();
  };
  /* Untertitel-Verzoegerung (Mehr-Menue): SEF-intern per SetSubtitleSync, externe SRT verschiebt die Ansicht selbst */
  P.setSubDelay = function (ms) { this.d.cfg.subDelay = ms; if (this.subMode === 'sef' && this.sub) this.exec('SetSubtitleSync', ms); };
  /* Bildformat (Mehr-Menue): 'auto' | 'orig' | 'fill' | '43' | 'zoom'. Flaeche per SetDisplayArea, Zoom zusaetzlich SetCropArea. */
  P.setAspect = function (mode) { this.aspect = mode; if (this.state !== 'resolving' && this.state !== 'idle') this.applyArea(); };
  P.applyArea = function () {
    var M = this.meta, mode = this.aspect || 'auto', vw = M.vw, vh = M.vh;
    if (mode === 'orig' || (mode === 'zoom' && N.config.cropBase === 'video')) {
      var r = String(this.exec('GetVideoResolution') || ''), p = r.split('|');   // "w|h" oder -1
      if (Number(p[0]) > 0 && Number(p[1]) > 0) { vw = Number(p[0]); vh = Number(p[1]); }
    }
    var R = Playback.rects(mode, M.ar, vw, vh, N.config.cropBase);
    this.exec('SetDisplayArea', R.area[0], R.area[1], R.area[2], R.area[3], 720, 1);
    if (R.crop) { this.exec('SetCropArea', R.crop[0], R.crop[1], R.crop[2], R.crop[3]); this.cropped = R.full; }
    else if (this.cropped) { this.exec('SetCropArea', this.cropped[0], this.cropped[1], this.cropped[2], this.cropped[3]); this.cropped = null; }
  };
  /* rein: Flaeche (1280x720-Raster) + Zuschnitt. Zuschnitt-Koordinaten: 'app' = Orca-Raster 960x540 (Protoplayer.SetCropArea
   * rechnet App-Pixel x0,75), 'video' = Pixel der Quelle. full = Zuschnitt "alles" zum Zuruecksetzen. */
  Playback.rects = function (mode, ar, vw, vh, base) {
    if (!(ar > 0)) ar = vw > 0 && vh > 0 ? vw / vh : 16 / 9;
    var W = 16 / 9, fw = base === 'video' && vw > 0 ? vw : 960, fh = base === 'video' && vh > 0 ? vh : 540, out = { area: null, crop: null, full: [0, 0, fw, fh] };
    if (mode === 'orig') out.area = Playback.area(vw > 0 && vh > 0 ? vw / vh : ar);
    else if (mode === 'fill') out.area = [0, 0, 1280, 720];
    else if (mode === '43') out.area = Playback.area(4 / 3);
    else if (mode === 'zoom') {
      out.area = [0, 0, 1280, 720];
      var cx = 1, cy = 1;                                   // Anteil der Quelle, der sichtbar bleibt
      if (ar > W * 1.02) cx = W / ar; else if (ar < W / 1.02) cy = ar / W; else { cx = 0.75; cy = 0.75; }   // 16:9 mit Balken im Bild: 4/3 vergroessern
      var w = Math.round(fw * cx), h = Math.round(fh * cy);
      out.crop = [Math.round((fw - w) / 2), Math.round((fh - h) / 2), w, h];
    } else out.area = Playback.area(ar);
    return out;
  };
  /* Bildflaeche im 1280x720-Raster (Letterbox, Orca) */
  Playback.area = function (ar) {
    if (!(ar > 0)) ar = 16 / 9;
    if (ar >= 16 / 9) { var h = Math.ceil(1280 / ar); return [0, Math.floor((720 - h) / 2), 1280, h]; }
    var w = Math.ceil(720 * ar); return [Math.floor((1280 - w) / 2), 0, w, 720];
  };

  /* ---------- SEF-Ereignisse (docs/research/player.md 1.2) ---------- */
  P.onEvent = function (type, data) {
    if (this.dead) return;
    type = Number(type);
    if (type === 7 || type === 9 || type === 11 || type === 12) this.mark('SEF ' + ({ 7: 'Bild startet', 9: 'Stream-Info', 11: 'Puffern', 12: 'Puffer voll' })[type]);
    switch (type) {
      case 1: if (this.d.wan && !this.firstTick && D.fallback(this.att, this.r ? this.r.mode : 'direct')) { this.renderError('SEF 1 (fern)'); break; }   // uebers Internet: erst Rueckfall-Kette
      /* falls through */
      case 2: case 3: this.fail(type === 2 ? 'notAllowed' : type === 3 ? 'fileMissing' : 'server', 'SEF ' + type); break;
      case 4: this.fail('server', 'Netz weg'); break;
      case 6: this.renderError(data); break;
      /* Ende-Ereignis beim ZURUECKspulen (Anfang erreicht, manche Dateien melden dann "fertig"): wie der Anfang, nicht wie das Ende –
       * kein Gesehen, keine naechste Folge (Audit 1.0.6). Die Datei laeuft ab 0:00 neu an. TV-Test 29.10.: das Ereignis kann auch
       * erst ~1 s NACH dem Ruecksetzen auf 1x kommen (aus -16x bis 0:00) – deshalb gilt eine Schonfrist (revEnd). */
      case 8: if (this.revEnd()) { this.log('Ende-Ereignis beim/kurz nach dem Zurueckspulen = Anfang ' + this.t); this.slow(); this.revAt = 0; this.restart(0); this.emit('trickEdge', 'start'); break; } this.ended(); break;
      case 9: this.streamReady(); break;
      case 11:
        if (this.speed !== 1) { this.log('Puffern beim Schnellspulen'); break; }   // Trick-Modus laeuft weiter: kein Zustandswechsel, keine Puffer-Timeline
        if (this.state !== 'paused') this.setState('buffering');
        break;
      case 12: if (this.state === 'buffering') this.setState('playing'); break;
      case 13: this.emit('buffer', Number(data) || 0); break;
      case 7: break;
      case 14: this.tick(Number(data) || 0); break;
      case 19: if (this.subMode === 'sef' && this.sub && this.speed === 1) this.emit('sub', N.subs.clean(data)); break;   // UT aus / Schnellspulen: SEF-Text verwerfen
      default: this.log('SEF-Ereignis ' + type + ' ' + data);
    }
  };
  P.tick = function (ms) {
    if (this.state === 'ended' || this.state === 'stopped' || this.state === 'error') return;
    // offset-Start: meldet das SEF die Zeit ab Playlist-Beginn (statt Original-Zeit, copyts), Basis addieren
    if (!this.firstTick && this.base) { this.rel = ms < this.base / 2; this.log('Zeitbasis ' + (this.rel ? 'relativ' : 'absolut') + ' ' + ms); }
    if (this.rel) ms += this.base;
    this.t = ms;
    if (this.state === 'buffering' || this.state === 'resolving') this.setState('playing');
    if (!this.firstTick) {
      this.firstTick = true;
      this.mark('erste Zeit');
      var self = this, want = this.resume;
      // Sicherheitsnetz (Orca delayedJump): 550 ms nach dem ersten Tick, falls der Start-Sprung nicht gegriffen hat
      if (want > 10000) this.d.timers.set(function () { if (!self.dead && self.t < want - 10000) self.exec('JumpForward', Math.floor((want - self.t) / 1000)); }, 550);
    }
    if (this.speed !== 1) this.trickEdge(ms);
    this.emit('time', this.t);
  };
  P.streamReady = function () {
    var T = this.meta.tracks, a = TR.selected(T.audio);
    // Direct Play: Tonspur lokal setzen (DirectPlayStreamSelection, K4); Index = Position unter den Tonspuren
    if (!this.hls && a && a.idx > 0) this.exec('SetStreamID', 1, a.idx);
    if (this.subMode === 'sef' && this.sub) { this.exec('SetSubtitleSync', this.d.cfg.subDelay || 0); this.exec('StartSubtitle', this.sub.idx); this.exec('SetStreamID', 4, this.sub.idx); }
    this.emit('subs', this.subMode);
  };
  /* Bild-/Tonfehler: Rueckfall direct -> direct stream -> transcode, danach Fehlerbildschirm */
  P.renderError = function (code) {
    var mode = this.r ? this.r.mode : 'direct', next = D.fallback(this.att, mode);
    this.log('Renderfehler ' + code + ' im Modus ' + mode);
    if (!next) { this.fail('playback', 'Render ' + code); return; }
    this.att = next;
    this.emit('fallback', mode);
    this.restart(this.t || this.resume);
  };
  /* Neustart an Position ms (Rueckfall, Spurwechsel bei Umwandlung, Qualitaet) */
  P.restart = function (ms, att) {
    if (att) this.att = att;
    this.stopTranscode();
    this.resume = ms; this.t = ms;
    this.t0 = this.d.timers.now();
    this.decide();
  };

  /* ---------- Steuerung ---------- */
  P.pause = function () { if (this.state !== 'playing' && this.state !== 'buffering') return; this.normal(true); this.exec('Pause'); this.setState('paused'); };
  P.play = function () { if (this.state !== 'paused') return; this.exec('Resume'); this.setState('playing'); };
  P.toggle = function () { if (this.state === 'paused') this.play(); else this.pause(); };
  /* Sprung auf ms: primaer Jump (auch HLS, K3); Rueckgabe != 1 bei HLS -> Sitzung an der Stelle neu starten */
  P.seek = function (ms) {
    var dur = this.dur(); if (dur > 0) ms = Math.min(ms, dur - 3000);
    ms = Math.max(0, ms);
    this.normal(true);                               // ein Sprung beendet das Schnellspulen
    var delta = ms - this.t, sec = Math.round(Math.abs(delta) / 1000);
    // rueckwaerts nie weiter als bis 0:00 springen (aufgerundet: aus 5,6 s wurde JumpBackward 6 – vor den Anfang, TV-Test 29.10.)
    if (delta < 0) sec = Math.min(sec, Math.floor(this.t / 1000));
    if (sec < 1) { if (ms === 0 && this.t > 0) { this.t = 0; this.emit('time', 0); } return; }
    var r = this.exec(delta > 0 ? 'JumpForward' : 'JumpBackward', sec), paused = this.state === 'paused';
    if (r !== 1 && r !== true && this.hls) { this.restart(ms); return; }
    this.t = ms;
    if (paused) this.exec('Pause');                  // Orca: nach Sprung in der Pause erneut pausieren
    this.emit('time', ms);
  };

  /* ---------- Schnellspulen (PLAY-32, N.trick): SetPlaybackSpeed im Trick-Modus, nur Direct Play, ohne Ton ----------
   * dir +1 (FF) / -1 (RW) -> {ok, speed, why}: why 'hls' (umgewandelt/HLS: das SEF kann es dort nicht), 'state' (laedt noch o. ae.),
   * 'max' (Anschlag), 'retry' (SEF lehnt diese Stufe zum ersten Mal ab: nichts gekappt), 'refused' (lehnt sie zum zweiten Mal ab:
   * Skala gekappt, die bisherige bleibt), 'off' (Richtung geht gar nicht).
   * Aus der Pause heraus: erst weiter (Resume), dann spulen. Die Timeline meldet waehrend des Spulens 'playing' mit der Position. */
  P.trick = function (dir) {
    if (this.hls) return { ok: false, speed: this.speed, why: 'hls' };
    if (this.state !== 'playing' && this.state !== 'paused') return { ok: false, speed: this.speed, why: 'state' };
    var TK = N.trick, sp = TK.speeds(N.config && N.config.trickSpeeds);
    if (!this.cap) this.cap = { f: sp[sp.length - 1], b: sp[sp.length - 1] };
    if (this.speed === 1 && (dir > 0 ? this.cap.f : this.cap.b) === 0) return { ok: false, speed: 1, why: 'off' };
    var nx = TK.next(this.speed, dir, sp, this.cap);
    if (nx === this.speed) return { ok: true, speed: nx, why: 'max' };
    if (this.state === 'paused') { this.exec('Resume'); this.setState('playing'); }
    if (nx === 1) { this.normal(); return { ok: true, speed: 1, why: '' }; }
    var r = this.exec('SetPlaybackSpeed', nx);
    if (r !== 1 && r !== true) {
      /* Audit 1.0.6: eine einzelne Ablehnung (z. B. gerade am Puffern) kappte die Skala fuer das ganze Video. Erst die zweite
       * Ablehnung derselben Stufe kappt; die erste meldet 'retry' (die Ansicht springt dann einmal, wenn noch nichts laeuft) */
      this.refused = this.refused || {};
      if (!this.refused[nx]) { this.refused[nx] = 1; this.log('Schnellspulen ' + nx + ' abgelehnt (1. Mal)'); return { ok: false, speed: this.speed, why: 'retry' }; }
      var lim = TK.below(sp, nx);
      if (nx > 0) this.cap.f = lim; else this.cap.b = lim;
      this.log('Schnellspulen ' + nx + ' abgelehnt, Grenze ' + (nx > 0 ? '+' : '-') + lim);
      if (this.speed === 1) return { ok: false, speed: 1, why: lim ? 'refused' : 'off' };
      return { ok: false, speed: this.speed, why: 'refused' };
    }
    this.speed = nx;
    this.emit('speed', nx);
    return { ok: true, speed: nx, why: '' };
  };
  /* zurueck auf 1x an der aktuellen Stelle (PLAY/OK, Pause, Sprung, Rand). quiet: keine eigene Timeline (Pause/Sprung melden selbst) */
  P.normal = function (quiet) {
    if (this.speed === 1) return false;
    this.revMark();
    this.exec('SetPlaybackSpeed', 1);
    this.speed = 1;
    this.emit('speed', 1);
    if (!quiet && this.state === 'playing') this.timeline();
    return true;
  };
  /* ohne SEF-Aufruf zuruecksetzen (Stop, neuer Datenstrom, Fehler): das SEF beginnt danach ohnehin mit 1x */
  P.slow = function () { if (this.speed === 1) return; this.revMark(); this.speed = 1; this.emit('speed', 1); };
  /* Schonfrist nach dem Zurueckspulen (TV-Test 29.10.: aus -16x bis 0:00 kam das SEF-Ende-Ereignis 1,1 s nach SetPlaybackSpeed 1
   * und beendete das Video als gesehen). Waehrend REV_MS nach dem Ende des Rueckwaerts-Spulens zaehlt ein Ende-Ereignis nur dann
   * als echtes Ende, wenn die Position wirklich am Ende steht (dur - END_MS); sonst ist es der Anfang. */
  var REV_MS = 4000, END_MS = 10000;
  P.revMark = function () { if (this.speed < 0) this.revAt = this.d.timers.now(); };
  P.revEnd = function () {
    if (this.speed < 0) return true;
    if (!this.revAt || this.d.timers.now() - this.revAt > REV_MS) return false;
    var d = this.dur();
    return !(d > 0 && this.t >= d - END_MS);
  };
  /* Rand: zurueck am Anfang -> 1x ab 0:00; vor kurz vor dem Ende -> 1x, das Ende laeuft wie gewohnt (Countdown, naechste Folge) */
  P.trickEdge = function (ms) {
    var e = N.trick.edge(this.speed, ms, this.dur());
    if (!e) return;
    this.log('Schnellspulen am ' + (e === 'start' ? 'Anfang' : 'Ende') + ' ' + ms);
    if (e === 'start') { this.normal(true); if (ms >= 1000) this.seek(0); this.timeline(); }
    else this.normal();
    this.emit('trickEdge', e);
  };

  /* ---------- Timeline / Ping (alle 10 s, bei Zustandswechsel) ---------- */
  P.arm = function () {
    var self = this;
    if (this.loop) this.d.timers.clear(this.loop);
    this.loop = this.d.timers.set(function () {
      self.loop = 0;
      if (self.dead) return;
      if (self.state === 'playing' || self.state === 'paused' || self.state === 'buffering') self.timeline();
      if (self.hls && (self.state === 'paused' || self.state === 'buffering')) self.ping();
      self.arm();
    }, TL_MS);
  };
  P.tlQuery = function (st, time) {
    var q = { ratingKey: this.item.rk, key: '/library/metadata/' + this.item.rk, state: st, time: Math.round(time), duration: this.dur(),
      'X-Plex-Session-Identifier': this.session };
    if (this.queueItem) { q.playQueueItemID = this.queueItem; q.containerKey = '/playQueues/' + this.queueId; }
    return q;
  };
  P.timeline = function (st) {
    var s = st || (this.state === 'paused' ? 'paused' : this.state === 'buffering' ? 'buffering' : 'playing');
    var self = this;
    this.d.write('GET', '/:/timeline', this.tlQuery(s, this.t), function (err, txt) {
      // Server hat den Stream beendet (terminationCode in der Antwort)
      var j = typeof txt === 'string' ? U.parse(txt) : txt, mc = j && j.MediaContainer;
      if (mc && mc.terminationCode && !self.dead) { self.emit('terminated', mc.terminationText || ''); self.stop('terminated'); }
    });
  };
  P.ping = function () { this.d.write('GET', '/video/:/transcode/universal/ping', { session: this.session }, function () {}); };
  P.stopTranscode = function () { if (this.hls && this.session) this.d.write('GET', '/video/:/transcode/universal/stop', { session: this.session }, function () {}); };
  /* Ende/Stop: Gesehen-Status. PMS markiert ab der Schwelle selbst ueber die Timeline; darunter (Up-Next, Ende einer
   * Umwandlung ohne letzten Tick) per scrobble (research 5) */
  P.markWatched = function () {
    var d = this.dur();
    if (d > 0 && this.t / d >= (this.d.threshold || 0.9)) return false;
    this.d.write('GET', '/:/scrobble', { identifier: 'com.plexapp.plugins.library', key: this.item.rk }, function () {});
    return true;
  };
  P.halt = function (st, time) {
    if (this.loop) { this.d.timers.clear(this.loop); this.loop = 0; }
    this.slow();
    this.timeline(st === 'ended' ? 'stopped' : 'stopped');
    this.stopTranscode();
    this.exec('Stop');
  };
  P.ended = function () {
    if (this.state === 'ended' || this.state === 'stopped') return;
    var d = this.dur();
    if (d > 0) this.t = Math.max(this.t, d);
    this.halt('ended');
    this.setState('ended');
    this.emit('ended');
  };
  /* Stop durch Nutzer/Folgewechsel; next: Folge wird gleich gewechselt (vorher gesehen setzen) */
  P.stop = function (why) {
    if (this.dead) return;
    if (why === 'next') this.markWatched();
    if (this.state !== 'ended' && this.state !== 'stopped' && this.state !== 'error' && this.state !== 'idle') this.halt('stopped');
    this.dead = true;
    this.state = 'stopped';
  };
  P.fail = function (kind, detail) {
    this.log('Fehler ' + kind + ' ' + detail);
    if (this.loop) { this.d.timers.clear(this.loop); this.loop = 0; }
    this.slow();
    if (this.state !== 'resolving') { this.timeline('stopped'); this.stopTranscode(); this.exec('Stop'); }
    this.setState('error');
    this.emit('error', { kind: kind, detail: String(detail || ''), r: this.r });
  };
  /* EXIT: Adressen fuer synchrone Abschluss-Anfragen (Timeline stopped, Transcoder stop) */
  P.exitUrls = function () {
    if (this.dead || this.state === 'idle' || this.state === 'error' || this.state === 'ended') return [];
    var b = this.d.base, tok = { 'X-Plex-Token': this.d.token, 'X-Plex-Client-Identifier': this.d.clientId }, out = [U.addQs(U.addQs(b + '/:/timeline', this.tlQuery('stopped', this.t)), tok)];
    if (this.hls) out.push(U.addQs(b + '/video/:/transcode/universal/stop', U.extend({ session: this.session }, tok)));
    return out;
  };
  N.Playback = Playback;
})(N);
