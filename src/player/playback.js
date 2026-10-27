/* N.Playback – Ablaufsteuerung einer Wiedergabe (SPEC 14.10, docs/research/player.md 3–5). Ohne DOM; alle Aussenkontakte
 * ueber deps (Tests mit Faelschungen, keine echten Sitzungen):
 *   deps.sef      {exec(name, a, b, …) -> Rueckgabe}         (N.sef.create)
 *   deps.get      (path, query, opts, cb)  PMS-GET           deps.write (method, path, query, cb)  schreibend (readOnly beachtet)
 *   deps.timers   {now, set, clear}         deps.base / token / clientId   deps.cfg (Einstellungen)   deps.mem(showRk) -> gemerkte Spuren
 * Zustaende: resolving -> buffering <-> playing <-> paused -> ended | stopped | error.
 * Ereignisse (on(fn(ev, data))): meta, state, time, buffer, sub, ended, error, tracks. */
(function (N) {
  var U = N.util, D = N.decision, TR = N.tracks, TL_MS = 10000;
  function Playback(deps, item) {
    this.d = deps; this.item = item; this.state = 'idle'; this.t = item.off || 0; this.resume = item.off || 0;
    this.meta = null; this.r = null; this.hls = false; this.att = { dp: deps.cfg.directPlay !== false, ds: true };
    this.fns = []; this.loop = 0; this.session = ''; this.sub = null; this.subMode = 'none'; this.firstTick = false; this.dead = false;
    this.aspect = deps.cfg.aspect || 'auto'; this.base = 0; this.rel = false; this.t0 = 0; this.cropped = null;
    this.queueItem = item.pqi || null; this.queueId = item.pqId || null;
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
    var o = { rk: M.rk, mediaIndex: M.mi, session: this.session, clientId: this.d.clientId, token: this.d.token, dp: this.att.dp && !burn, ds: this.att.ds, subs: burn ? 'burn' : 'none', quality: c.quality,
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
      case 1: case 2: case 3: this.fail(type === 2 ? 'notAllowed' : type === 3 ? 'fileMissing' : 'server', 'SEF ' + type); break;
      case 4: this.fail('server', 'Netz weg'); break;
      case 6: this.renderError(data); break;
      case 8: this.ended(); break;
      case 9: this.streamReady(); break;
      case 11: if (this.state !== 'paused') this.setState('buffering'); break;
      case 12: if (this.state === 'buffering') this.setState('playing'); break;
      case 13: this.emit('buffer', Number(data) || 0); break;
      case 7: break;
      case 14: this.tick(Number(data) || 0); break;
      case 19: if (this.subMode === 'sef' && this.sub) this.emit('sub', N.subs.clean(data)); break;   // UT aus: SEF-Text verwerfen
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
    this.emit('time', ms);
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
  P.pause = function () { if (this.state !== 'playing' && this.state !== 'buffering') return; this.exec('Pause'); this.setState('paused'); };
  P.play = function () { if (this.state !== 'paused') return; this.exec('Resume'); this.setState('playing'); };
  P.toggle = function () { if (this.state === 'paused') this.play(); else this.pause(); };
  /* Sprung auf ms: primaer Jump (auch HLS, K3); Rueckgabe != 1 bei HLS -> Sitzung an der Stelle neu starten */
  P.seek = function (ms) {
    var dur = this.dur(); if (dur > 0) ms = Math.min(ms, dur - 3000);
    ms = Math.max(0, ms);
    var delta = ms - this.t, sec = Math.round(Math.abs(delta) / 1000);
    if (sec < 1) return;
    var r = this.exec(delta > 0 ? 'JumpForward' : 'JumpBackward', sec), paused = this.state === 'paused';
    if (r !== 1 && r !== true && this.hls) { this.restart(ms); return; }
    this.t = ms;
    if (paused) this.exec('Pause');                  // Orca: nach Sprung in der Pause erneut pausieren
    this.emit('time', ms);
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
