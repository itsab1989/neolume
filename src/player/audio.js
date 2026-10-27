/* Ton-Wiedergabe (M4, docs/research/music-audiobooks.md 2): N.AudioCore = Ablauf ohne DOM (Node-Tests mit Faelschungen),
 * N.audio = Singleton fuer die App (Wiedergabe gehoert nicht in eine Ansicht: der Router wirft Ansichten weg, SEF spielt weiter).
 * - Decision GET /music/:/transcode/universal/decision (protocol=http, ohne Bitrate, B4) -> Direct Play der Datei (Part.key);
 *   SEF-Renderfehler (6) bzw. Decision-Fehler -> einmal Umwandlung start.mp3 (offset=<s>) an der Stelle; danach Fehler -> naechster Titel.
 * - SEF: Stop, InitPlayer(url) OHNE |COMPONENT=HLS, SetDisplayArea(0,0,0,0,720,1) (Orca), StartPlayback(sek) – nur echte Argumente.
 * - Warteschlange lokal (N.music.Queue): Zufall, Wiederholen; Titelwechsel = Stop + InitPlayer (nicht lueckenlos, B6); die naechste
 *   Decision wird 10 s vor dem Ende geholt.
 * - Timeline /:/timeline alle 10 s und sofort bei Pause/Stop (Hoerbuch-Position ohne Drift); Umwandlung pausiert: Ping alle 10 s;
 *   Ende: Scrobble unterhalb der Gesehen-Schwelle (wie Video). EXIT: Timeline stopped synchron.
 * - Hoerbuch: eingebettete Kapitel (M4B, includeChapters), ⏮/⏭ = Kapitel, Sleep-Timer inkl. "Ende des Kapitels" (Pause + Timeline).
 * Ereignisse (on(fn(ev, data))): track, state, time, queue, chapters, error, done, sleep. */
(function (N) {
  var U = N.util, D = N.decision, MU = N.music, TL_MS = 10000, PREFETCH_MS = 10000;
  function Core(deps) {
    this.d = deps; this.q = null; this.item = null; this.state = 'idle'; this.t = 0; this.resume = 0; this.base = 0; this.rel = false;
    this.mode = ''; this.dp = true; this.session = ''; this.loop = 0; this.fns = []; this.book = false; this.ctx = null; this.chs = [];
    this.pre = null; this.gen = 0; this.firstTick = false; this.fails = 0; this.errKind = ''; this.sleep = { mode: 'off', at: 0, t: 0, w: 0 }; this.last = null;
  }
  var P = Core.prototype;
  P.on = function (fn) { this.fns.push(fn); };
  P.emit = function (ev, data) { for (var i = 0; i < this.fns.length; i++) this.fns[i](ev, data); };
  P.log = function (m) { if (this.d.log) this.d.log('audio ' + m); };
  P.exec = function () {
    var r, args = Array.prototype.slice.call(arguments);
    try { r = this.d.sef.exec.apply(this.d.sef, args); } catch (x) { this.log(args[0] + ' wirft ' + x.message); r = -1; }
    if (args[0] !== 'GetDuration') this.log(args[0] + (args[1] !== undefined ? ' ' + String(args[1]).split('?')[0] : '') + ' -> ' + r);
    return r;
  };
  P.active = function () { return this.state !== 'idle' && this.state !== 'stopped' && this.state !== 'done'; };
  P.playing = function () { return this.state === 'playing' || this.state === 'buffering' || this.state === 'loading'; };
  P.dur = function () { return this.item && this.item.dur || 0; };
  P.setState = function (s) {
    if (this.state === s) return;
    var old = this.state; this.state = s;
    this.emit('state', s);
    if ((s === 'playing' || s === 'paused') && old !== 'loading') this.timeline();
  };

  /* ---------- Start ---------- */
  /* items: [track], start: Index, o: {book, off (ms, erster Titel), shuffle, ctx:{title, rk}} */
  P.play = function (items, start, o) {
    o = o || {};
    this.halt();
    this.q = new MU.Queue(items.slice(), start || 0);
    if (o.shuffle) this.q.setShuffle(true, this.d.rnd);
    this.book = !!o.book; this.ctx = o.ctx || null; this.fails = 0; this.errKind = ''; this.pre = null;
    this.emit('queue', this.q);
    this.startCur(o.off || 0);
  };
  P.startCur = function (off) {
    var it = this.q && this.q.cur();
    if (!it) { this.finish(); return; }
    this.gen++;
    this.item = it; this.t = off || 0; this.resume = off || 0; this.base = 0; this.rel = false; this.firstTick = false;
    this.dp = this.d.cfg && this.d.cfg.directPlay === false ? false : true;
    this.session = U.uuid(); this.chs = [];
    this.setState('loading');
    this.emit('track', it);
    if (this.book && it.chs) this.loadChapters(it);
    var pre = this.pre; this.pre = null;
    if (pre && pre.rk === it.rk && !off && pre.url) { this.session = pre.session; this.mode = pre.mode; this.open(pre.url); return; }
    this.decide();
  };
  P.loadChapters = function (it) {
    var self = this, g = this.gen;
    this.d.get('/library/metadata/' + it.rk, { includeChapters: 1, excludeElements: 'Genre,Mood,Image,UltraBlurColors,Guid' }, { timeout: 12000 }, function (err, json) {
      if (g !== self.gen) return;
      var m = !err && json && json.MediaContainer && json.MediaContainer.Metadata && json.MediaContainer.Metadata[0];
      self.chs = m ? MU.chapters(m.Chapter) : [];
      if (self.chs.length) self.emit('chapters', self.chs);
    });
  };
  /* Decision fuer Titel it (dp = Direct Play erlaubt) -> cb({mode, url}) bzw. cb(null, Fehler) */
  P.resolve = function (it, dp, offMs, session, cb) {
    var self = this, o = { rk: it.rk, session: session, clientId: this.d.clientId, token: this.d.token, dp: dp, offsetMs: 0 };
    this.d.get(MU.DECISION, MU.query(o), { timeout: 15000, retries: 1 }, function (err, json) {
      var r = D.parse(json);
      if (err || r.mode === 'error') { cb(null, err ? (err.status || err.type) : r.code + ' ' + r.text); return; }
      if (r.mode === 'direct') { cb({ mode: 'direct', url: D.directUrl(self.d.base, r.partKey, self.d.token, self.d.clientId), r: r }); return; }
      o.offsetMs = offMs;
      cb({ mode: 'transcode', url: MU.startUrl(self.d.base, o), r: r });
    });
  };
  P.decide = function () {
    var self = this, g = this.gen, it = this.item;
    this.resolve(it, this.dp, this.resume, this.session, function (res, why) {
      if (g !== self.gen) return;
      if (!res) {
        if (self.dp) { self.log('Decision ' + why + ' -> Umwandlung'); self.dp = false; self.decide(); return; }
        self.fail(why); return;
      }
      self.mode = res.mode;
      self.log('Decision ' + (res.r ? res.r.code : '') + ' ' + res.mode);
      self.open(res.url);
    });
  };
  P.open = function (url) {
    var sec = Math.floor(this.resume / 1000);
    if (this.mode === 'transcode') { this.base = Math.floor(this.resume / 1000) * 1000; sec = 0; }   // Server beginnt bei offset=
    this.exec('Stop');
    this.setState('buffering');
    this.exec('InitPlayer', url);
    this.exec('SetDisplayArea', 0, 0, 0, 0, 720, 1);   // nur Ton (Orca Player.setWindow MODE_MUSIC)
    if (this.exec('StartPlayback', sec) === -1) { this.onEvent(6, 6); return; }
    this.arm();
  };

  /* ---------- SEF-Ereignisse ---------- */
  P.onEvent = function (type, data) {
    if (!this.item || this.state === 'stopped' || this.state === 'idle') return;
    switch (Number(type)) {
      case 1: case 2: case 3: case 4: this.fail('SEF ' + type); break;
      case 6: this.renderError(data); break;
      case 8: this.ended(); break;
      case 11: if (this.state !== 'paused') this.setState('buffering'); break;
      case 12: if (this.state === 'buffering') this.setState('playing'); break;
      case 14: this.tick(Number(data) || 0); break;
      default: break;
    }
  };
  P.tick = function (ms) {
    if (this.state === 'stopped' || this.state === 'ended' || this.state === 'idle' || this.state === 'done') return;
    if (!this.firstTick && this.base) this.rel = ms < this.base / 2;   // start.mp3 mit offset: Zeit ab 0 oder Original-Zeit
    if (this.rel) ms += this.base;
    var before = this.t;
    this.t = ms;
    if (this.state === 'buffering' || this.state === 'loading') this.setState('playing');
    if (!this.firstTick) {
      this.firstTick = true; this.fails = 0; this.errKind = '';
      var self = this, want = this.resume, g = this.gen;
      // Sicherheitsnetz wie Video (Orca delayedJump): Start-Sprung griff nicht (VBR-MP3 ohne TOC) -> nachspringen, Abweichung loggen
      if (want > 10000 && this.mode === 'direct') this.d.timers.set(function () {
        if (g !== self.gen) return;
        self.log('Start Soll ' + Math.round(want / 1000) + ' s, Ist ' + Math.round(self.t / 1000) + ' s');
        if (self.t < want - 10000) self.exec('JumpForward', Math.floor((want - self.t) / 1000));
      }, 550);
    }
    this.sleepTick(before, ms);
    this.prefetch();
    this.emit('time', ms);
  };
  /* naechste Decision 10 s vor dem Ende (Titelwechsel ohne Warten) */
  P.prefetch = function () {
    var d = this.dur();
    if (!d || d - this.t > PREFETCH_MS || this.pre || !this.q || (this.sleep.mode === 'end')) return;
    var p = this.q.nextPos(true);
    if (p < 0 || p === this.q.pos) return;
    var it = this.q.itemAt(p), self = this, pre = { rk: it.rk, session: U.uuid(), url: '', mode: '' };
    this.pre = pre;
    this.resolve(it, true, 0, pre.session, function (res) { if (res && self.pre === pre) { pre.url = res.url; pre.mode = res.mode; } });
  };
  P.renderError = function (code) {
    this.log('Renderfehler ' + code + ' im Modus ' + this.mode);
    if (this.mode === 'direct' || this.dp) { this.dp = false; this.restart(this.t || this.resume); return; }
    this.fail('Render ' + code);
  };
  P.restart = function (ms) {
    this.stopTranscode();
    this.gen++; this.resume = ms; this.t = ms; this.firstTick = false; this.session = U.uuid();
    this.setState('loading');
    this.decide();
  };
  P.ended = function () {
    if (this.state === 'ended') return;
    var d = this.dur();
    if (d > 0) this.t = Math.max(this.t, d);
    this.markWatched();
    this.halt();
    if (this.item) this.item.off = 0;                   // halt() schrieb die Endzeit als lokale Stelle: Titel gilt als gehoert, nicht "noch 0 Min."
    this.setState('ended');
    if (this.sleep.mode === 'end') { this.sleepDone(); return; }
    var p = this.q ? this.q.nextPos(true) : -1;
    if (p < 0) { this.finish(); return; }
    this.q.go(p);
    this.emit('queue', this.q);
    this.startCur(this.book ? this.bookOff(this.q.cur()) : 0);
  };
  P.finish = function () { this.halt(); this.state = 'done'; this.emit('state', 'done'); this.emit('done'); };
  /* Datei am Server nicht erreichbar? SEF 1 (CONNECTION_FAILED) / 3 (STREAM_NOT_FOUND) bzw. HTTP 404 – z. B. Laufwerk am
   * Server nicht eingebunden (TV-Test 27.10., F7) */
  Core.unreachable = function (why) { return /^SEF [13]$/.test(String(why)) || String(why) === '404'; };
  P.fail = function (why) {
    this.log('Fehler ' + why);
    this.halt();
    this.fails++;
    this.errKind = Core.unreachable(why) ? 'unreach' : 'other';
    this.setState('error');
    var p = this.q ? this.q.nextPos(false) : -1;
    // Musik: nach dem ersten Fehler naechster Titel; scheitert auch der (2 in Folge), anhalten statt durch die Liste zu springen
    var skip = !this.book && p >= 0 && p !== this.q.pos && this.fails < 2;
    this.emit('error', { detail: String(why || ''), item: this.item, kind: this.errKind, stop: !skip });
    if (skip) { this.q.go(p); this.emit('queue', this.q); this.startCur(0); return; }
    this.state = 'stopped'; this.emit('state', 'stopped');
  };
  /* Hoerbuch: Titel mit gespeicherter Stelle dort fortsetzen (nicht am Ende) */
  P.bookOff = function (it) { return it && it.off > 0 && !(it.dur && it.off > it.dur - 15000) ? it.off : 0; };

  /* ---------- Steuerung ---------- */
  P.pause = function () { if (this.state !== 'playing' && this.state !== 'buffering') return; this.exec('Pause'); this.setState('paused'); };
  P.resumePlay = function () { if (this.state !== 'paused') return; this.exec('Resume'); this.setState('playing'); };
  P.toggle = function () {
    if (this.state === 'paused') this.resumePlay();
    else if (this.state === 'ended' || this.state === 'error') this.startCur(this.t);
    else this.pause();
  };
  /* Sprung auf ms: Direct Play per Jump (eine Anweisung), Umwandlung = neue Sitzung an der Stelle */
  P.seekTo = function (ms) {
    var d = this.dur();
    if (d > 0) ms = Math.min(ms, d - 2000);
    ms = Math.max(0, ms);
    var delta = ms - this.t, sec = Math.round(Math.abs(delta) / 1000);
    if (sec < 1 || !this.item) return;
    if (this.mode !== 'direct') { this.restart(ms); return; }
    var paused = this.state === 'paused', r = this.exec(delta > 0 ? 'JumpForward' : 'JumpBackward', sec);
    if (r !== 1 && r !== true) { this.restart(ms); return; }
    this.t = ms;
    if (paused) this.exec('Pause');
    this.emit('time', ms);
  };
  P.seekBy = function (ms) { this.seekTo(this.t + ms); };
  /* ⏭: Hoerbuch mit eingebetteten Kapiteln -> naechstes Kapitel; sonst naechster Titel */
  P.next = function () {
    if (!this.q) return false;
    if (this.chs.length > 1) { var k = this.chapterAt(); if (k + 1 < this.chs.length) { this.seekTo(this.chs[k + 1].start); return true; } }
    var p = this.q.nextPos(false);
    if (p < 0) return false;
    this.halt(); this.q.go(p); this.emit('queue', this.q);
    this.startCur(this.book ? this.bookOff(this.q.cur()) : 0);
    return true;
  };
  /* ⏮: nach > 3 s an den Anfang (Titel bzw. Kapitel), sonst vorheriger */
  P.prev = function () {
    if (!this.q) return;
    if (this.chs.length > 1) {
      var k = this.chapterAt(), cs = k >= 0 ? this.chs[k].start : 0;
      if (this.t - cs > 3000 || k <= 0) { this.seekTo(cs); if (k > 0 || this.t - cs > 3000) return; }
      else { this.seekTo(this.chs[k - 1].start); return; }
    }
    if (this.t > 3000) { this.seekTo(0); return; }
    var p = this.q.prevPos();
    if (p === this.q.pos) { this.seekTo(0); return; }
    this.halt(); this.q.go(p); this.emit('queue', this.q);
    this.startCur(0);
  };
  /* Titel an Position p der Warteschlange */
  P.jump = function (p, off) {
    if (!this.q || p < 0 || p >= this.q.size()) return;
    this.halt(); this.q.go(p); this.emit('queue', this.q);
    this.startCur(off !== undefined ? off : this.book ? this.bookOff(this.q.cur()) : 0);
  };
  P.setShuffle = function (on) { if (!this.q || this.book) return; this.q.setShuffle(on, this.d.rnd); this.pre = null; this.emit('queue', this.q); };
  P.cycleRepeat = function () { if (!this.q || this.book) return 'off'; var r = this.q.cycleRepeat(); this.pre = null; this.emit('queue', this.q); return r; };
  P.chapterAt = function () { return N.osd.chapterAt(this.chs, this.t); };
  /* Stop durch Nutzer (STOP, Video-Start, Profilwechsel) */
  P.stop = function (why) {
    if (this.state === 'idle' || this.state === 'stopped') return;
    this.log('Stop ' + (why || ''));
    this.setSleep('off', true);
    this.halt();
    this.state = 'stopped'; this.pre = null;
    this.emit('state', 'stopped');
  };

  /* ---------- Timeline / Ping ---------- */
  P.arm = function () {
    var self = this;
    if (this.loop) this.d.timers.clear(this.loop);
    this.loop = this.d.timers.set(function () {
      self.loop = 0;
      if (self.state === 'playing' || self.state === 'paused' || self.state === 'buffering') {
        self.timeline();
        if (self.mode === 'transcode' && self.state !== 'playing') self.ping();
        self.arm();
      }
    }, TL_MS);
  };
  P.tlQuery = function (st, time) {
    return { ratingKey: this.item.rk, key: '/library/metadata/' + this.item.rk, state: st, time: Math.round(time), duration: this.dur(),
      'X-Plex-Session-Identifier': this.session };
  };
  P.timeline = function (st) {
    if (!this.item) return;
    var s = st || (this.state === 'paused' ? 'paused' : this.state === 'buffering' ? 'buffering' : 'playing');
    this.item.off = Math.round(this.t); this.item.lv = Math.floor(this.d.timers.now() / 1000);   // lokale Kopie (Fortsetzen ohne Neuladen)
    this.d.write('GET', '/:/timeline', this.tlQuery(s, this.t), function () {});
  };
  P.ping = function () { this.d.write('GET', '/music/:/transcode/universal/ping', { session: this.session }, function () {}); };
  P.stopTranscode = function () { if (this.mode === 'transcode' && this.session) this.d.write('GET', '/music/:/transcode/universal/stop', { session: this.session }, function () {}); };
  P.markWatched = function () {
    var d = this.dur();
    if (!this.item) return;
    this.item.vc = (this.item.vc || 0) + 1; this.item.off = 0; this.item.lv = Math.floor(this.d.timers.now() / 1000);
    if (d > 0 && this.t / d >= (this.d.threshold || 0.9) && this.firstTick) return;   // PMS zaehlt selbst ueber die Timeline
    this.d.write('GET', '/:/scrobble', { identifier: 'com.plexapp.plugins.library', key: this.item.rk }, function () {});
  };
  /* laufende Wiedergabe beenden (Timeline stopped, Transcoder stop, SEF Stop) */
  P.halt = function () {
    if (this.loop) { this.d.timers.clear(this.loop); this.loop = 0; }
    this.gen++;
    var live = this.state === 'playing' || this.state === 'paused' || this.state === 'buffering' || (this.state === 'loading' && this.firstTick);
    if (live) { this.timeline('stopped'); this.item.lv = Math.floor(this.d.timers.now() / 1000); }
    this.stopTranscode();
    if (live || this.state === 'loading' || this.state === 'buffering') this.exec('Stop');
  };
  P.exitUrls = function () {
    if (!this.item || !(this.state === 'playing' || this.state === 'paused' || this.state === 'buffering')) return [];
    var b = this.d.base, tok = { 'X-Plex-Token': this.d.token, 'X-Plex-Client-Identifier': this.d.clientId };
    var out = [U.addQs(U.addQs(b + '/:/timeline', this.tlQuery('stopped', this.t)), tok)];
    if (this.mode === 'transcode') out.push(U.addQs(b + '/music/:/transcode/universal/stop', U.extend({ session: this.session }, tok)));
    return out;
  };

  /* ---------- Sleep-Timer (wie Video: Aus · Ende des Titels/Kapitels · Minuten; 1 Min. vorher Hinweis) ---------- */
  P.setSleep = function (mode, quiet) {
    var T = this.d.timers, self = this;
    if (this.sleep.t) T.clear(this.sleep.t); if (this.sleep.w) T.clear(this.sleep.w);
    this.sleep = { mode: mode, at: 0, t: 0, w: 0, ch: this.chs.length > 1 ? this.chapterAt() : -1 };
    if (typeof mode === 'number' && mode > 0) {
      var ms = mode * 60000;
      this.sleep.at = T.now() + ms;
      this.sleep.t = T.set(function () { self.sleep.t = 0; self.sleepDone(); }, ms);
      this.sleep.w = T.set(function () { self.sleep.w = 0; self.emit('sleep', 'soon'); }, ms - 60000);
    }
    if (!quiet) this.emit('sleep', mode);
  };
  /* "Ende des Kapitels" bei eingebetteten Kapiteln: Kapitelgrenze ueberschritten -> Pause */
  P.sleepTick = function (before, ms) {
    if (this.sleep.mode !== 'end' || this.chs.length < 2 || this.state !== 'playing') return;
    var k0 = N.osd.chapterAt(this.chs, before), k1 = N.osd.chapterAt(this.chs, ms);
    if (k1 > k0 && k0 >= 0 && ms - before < 5000) this.sleepDone();
  };
  P.sleepDone = function () {
    var T = this.d.timers;
    if (this.sleep.t) T.clear(this.sleep.t); if (this.sleep.w) T.clear(this.sleep.w);
    this.sleep = { mode: 'off', at: 0, t: 0, w: 0 };
    if (this.state === 'ended') {                       // Titel/Kapitel zu Ende: naechsten vormerken, Wiedergabe beendet (⏯ startet ihn)
      var p = this.q ? this.q.nextPos(true) : -1;
      if (p >= 0) { this.q.go(p); this.item = this.q.cur(); this.emit('track', this.item); }
      this.t = this.book ? this.bookOff(this.item) : 0;
      this.state = 'stopped'; this.emit('state', 'stopped'); this.emit('sleep', 'done'); return;
    }
    this.pause();
    this.emit('sleep', 'done');
  };
  N.AudioCore = Core;

  /* ---------- Singleton fuer die App ---------- */
  var core = null, onFlush = null;
  function deps() {
    return {
      sef: null, base: N.plex.base, token: N.plex.token, clientId: N.plex.clientId, threshold: N.config.watchedThreshold,
      cfg: N.session.settings || {}, log: N.log,
      timers: { now: U.now, set: function (f, ms) { return setTimeout(f, ms); }, clear: function (t) { clearTimeout(t); } },
      get: function (path, q, o, cb) { return N.plex.get(path, q, o, cb); },
      write: function (m, path, q, cb) { return N.plex.write(m, path, q, function (e, d) { cb(e, d); }); }
    };
  }
  function relay(ev, data) {
    if (ev === 'state' && (data === 'stopped' || data === 'done')) { N.sef.close(); N.evt.emit('playback:stopped', { rk: core && core.item ? core.item.rk : '' }); }   // Startseite/Details laden Fortschritt neu
    N.evt.emit('audio:' + ev, data);
  }
  function exitSync() {
    if (!core || N.config.readOnly) return;
    var urls = core.exitUrls();
    for (var i = 0; i < urls.length; i++) { try { var x = new XMLHttpRequest(); x.open('GET', urls[i], false); x.send(null); } catch (e) {} }
  }
  N.audio = {
    core: function () { return core; },
    active: function () { return !!core && core.active(); },
    /* Wiedergabe starten (ersetzt die Warteschlange). Video/Titelmusik werden vorher beendet */
    play: function (items, start, o) {
      if (!items || !items.length) return;
      if (N.theme) N.theme.stop(true);
      var c = core;
      if (c) c.stop('neu');
      core = new Core(deps());
      core.on(relay);
      var me = core;
      core.d.sef = N.sef.create(function (type, data) { if (me === core) me.onEvent(type, data); });
      if (!onFlush) { onFlush = exitSync; N.evt.on('app:flush', onFlush); }
      N.tv.saver(true);                                  // Musik: TV-Bildschirmschoner bleibt an (Orca, research 2.4)
      core.play(items, start, o);
    },
    stop: function (why) { if (core) core.stop(why); },
    /* nach Stop/Ende: aktuellen Titel erneut starten (Ende -> von vorn, sonst an der Stelle) */
    restart: function () {
      if (!core || !core.q || core.active()) return;
      var me = core, at = core.state === 'done' ? 0 : core.t;
      core.d.sef = N.sef.create(function (type, data) { if (me === core) me.onEvent(type, data); });
      if (core.state === 'done') core.q.go(0);
      core.startCur(at);
    },
    bookOff: function (it) { return Core.prototype.bookOff(it); },
    toggle: function () { if (core) core.toggle(); },
    next: function () { if (core) core.next(); },
    prev: function () { if (core) core.prev(); },
    seekBy: function (ms) { if (core) core.seekBy(ms); },
    /* globale Medientasten, bevor der Router sie bekommt (nur waehrend Musik, nicht im Video-Player/Jetzt-laeuft) */
    key: function (k) {
      if (!N.audio.active()) return false;
      var top = N.router.topName();
      if (top === 'player' || top === 'nowplaying') return false;
      if (k === 'PAUSE') { core.toggle(); return true; }
      if (k === 'STOP') { core.stop('STOP'); return true; }
      if (k === 'GREEN' && top !== 'details' && !N.router.hasOverlay()) { N.router.push('nowplaying'); return true; }
      return false;
    }
  };
})(N);
