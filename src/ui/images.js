/* N.img – Bild-URLs in exakten Groessen (SPEC 2 / 15.1) und Bildlader (SPEC 14.7):
 * max. 4 Downloads gleichzeitig, max. 2 neue src pro Frame, Pause bei Tastenwiederholung und 150 ms nach der letzten Taste,
 * LRU der geladenen URLs (Treffer sofort), 1 Wiederholung nach 2 s, nie src="" (statt dessen BLANK).
 * P7 27.10. (TV: lange Frames in den ersten Schritten nach dem Laden = Dekodieren beim Scrollen):
 * - Dekodier-Sperre: Downloads laufen in ein losgeloestes Image(); das sichtbare <img> bekommt die (dann im Cache liegende) URL
 *   erst in einer Ruhephase, hoechstens SHOW_PER_FRAME (1) je Frame. WebKit dekodiert beim ersten Zeichnen -> nie mitten in einer Tastenfolge.
 * - Nach Tastenwiederholung (N.fx.isFast) gilt REST_FAST statt REST: bei 160-ms-Wiederholung kein Zuweisen zwischen zwei Tasten. */
(function (N) {
  var U = N.util;
  var BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  var TIERS = {
    poster: [176, 264], posterS: [144, 216], posterXS: [96, 144], posterQ: [120, 180], listThumb: [48, 72], land: [288, 162],
    hero: [1280, 720],            // am TV gemessen: 1280x720 schaerfer UND weniger Haenger als skaliert (PHASE1)
    square: [176, 176], squareS: [144, 144], squareXS: [96, 96], listSq: [48, 48], cover: [192, 192], coverL: [400, 400],   // M4 Musik (quadratisch)
    backdrop: [640, 360], upnext: [176, 99], chapter: [96, 54], avatar: [160, 160], avatarM: [96, 96], avatarS: [32, 32], cast: [120, 120]
  };
  var MAX_ACTIVE = 4, PER_FRAME = 2, SHOW_PER_FRAME = 1, REST = 150, REST_FAST = 250;   // perf3: 1 Dekodierung je Frame (TV: 2 Poster = 82-ms-Frame)
  var jobs = [], ready = [], active = 0, lru = new N.LRU(400), frameT = 0, paused = false, sets = 0, loads = 0;   // sets/loads: Zaehler fuer den Messlauf (P7)
  /* losgeloestes Bild fuer den Download (Tests ohne DOM: null -> direkt ins <img> wie frueher) */
  function mkPre() { return typeof Image !== 'undefined' ? new Image() : null; }
  function rest() { return N.idle ? N.idle.restFor() : 1e9; }
  function restNeed() { return N.fx && N.fx.isFast() ? REST_FAST : REST; }

  function url(path, tier, opts) {
    if (!path) return '';
    var sz = TIERS[tier] || TIERS.poster, q = { width: sz[0], height: sz[1], minSize: 1, upscale: 1, format: (opts && opts.format) || 'jpeg' };
    if (opts && opts.blur) q.blur = opts.blur;
    else if (N.comfort && N.comfort.isSpoiler(path)) q.blur = 30;   // Spoilerschutz (SPEC 5.3): ungesehene Folgen unscharf
    q.url = path;
    q['X-Plex-Token'] = (opts && opts.token) || N.plex.token || '';
    return ((opts && opts.base) || N.plex.base) + '/photo/:/transcode?' + U.qs(q);
  }

  function detach(img) { img.onload = img.onerror = null; }
  /* Download fertig (losgeloest) bzw. LRU-Treffer -> ins sichtbare <img> (zaehlt ins Dekodier-Budget) */
  function show(job) {
    var img = job.img;
    if (job.pre) { detach(job.pre); job.pre = null; }
    detach(img); img.src = job.url; img._pnUrl = job.url; img._pnJob = null; sets++;
    if (job.done) job.done(true);
  }
  function assign(job) {
    var img = job.img;
    if (lru.has(job.url)) {            // schon geladen: sofort (zaehlt ins Dekodier-Budget)
      lru.get(job.url);
      show(job);
      return;
    }
    active++;
    job.started = true;
    var pre = job.pre || (job.pre = mkPre());
    if (pre) {
      pre.onload = function () {
        detach(pre); active--; loads++; lru.set(job.url, 1);
        if (img._pnJob === job) ready.push(job); else job.pre = null;
        kick();
      };
      pre.onerror = function () {
        detach(pre); active--;
        if (img._pnJob !== job) { job.pre = null; kick(); return; }
        job.pre = null;                    // Wiederholung mit frischem Bild (gleiche src loest sonst evtl. nichts aus)
        if (!job.retried) {                // 1 Wiederholung nach 2 s
          job.retried = true; job.started = false;
          setTimeout(function () { if (img._pnJob === job) { jobs.push(job); kick(); } }, 2000);
        } else { img._pnJob = null; if (N.diag) N.diag.log('warn', 'img fail ' + job.url.split('?')[0]); if (job.done) job.done(false); }
        kick();
      };
      pre.src = job.url;
      return;
    }
    img.onload = function () {
      detach(img); active--; img._pnJob = null; lru.set(job.url, 1); loads++;
      if (job.done) job.done(true);
      kick();
    };
    img.onerror = function () {
      detach(img); active--;
      if (!job.retried) {                  // 1 Wiederholung nach 2 s
        job.retried = true; job.started = false;
        img.src = BLANK;
        setTimeout(function () { if (img._pnJob === job) { jobs.push(job); kick(); } }, 2000);
      } else { img._pnJob = null; img.src = BLANK; if (N.diag) N.diag.log('warn', 'img fail ' + job.url.split('?')[0]); if (job.done) job.done(false); }
      kick();
    };
    img._pnUrl = job.url;
    img.src = job.url;
  }
  function byPrio(a, b) { return a.prio - b.prio || a.seq - b.seq; }
  function pump() {
    frameT = 0;
    var r = rest(), need = restNeed();
    if (paused || r < need) { if (jobs.length || ready.length) frameT = setTimeout(pump, paused ? REST : need - r + 10); return; }
    var n = 0, d = 0, i;
    if (ready.length > 1) ready.sort(byPrio);
    while (ready.length && n < SHOW_PER_FRAME) { show(ready.shift()); n++; }   // fertige Downloads zuerst sichtbar machen
    jobs.sort(byPrio);
    for (i = 0; i < jobs.length && n < SHOW_PER_FRAME && d < PER_FRAME;) {      // LRU-Treffer duerfen an wartenden Downloads vorbei
      if (lru.has(jobs[i].url)) { assign(jobs.splice(i, 1)[0]); n++; }
      else if (active < MAX_ACTIVE) { assign(jobs.splice(i, 1)[0]); d++; }
      else i++;
    }
    if ((jobs.length || ready.length) && !frameT) frameT = setTimeout(function () { frameT = 0; U.raf(pump); }, ready.length || active < MAX_ACTIVE ? 16 : 60);
  }
  function kick() { if (!frameT) frameT = setTimeout(function () { frameT = 0; U.raf(pump); }, 0); }
  var seq = 0;

  N.img = {
    BLANK: BLANK, TIERS: TIERS, url: url,
    /* Bild fuer ein <img> anfordern; prio 0 sichtbar, 1 Puffer, 2 Vorladen. done(ok) optional */
    want: function (img, u, prio, done) {
      if (!u) { N.img.drop(img); if (done) done(false); return; }
      if (img._pnUrl === u && !img._pnJob) { if (done) done(true); return; }   // steht schon da
      var old = img._pnJob;
      if (old) {
        if (old.url === u) { old.prio = Math.min(old.prio, prio); old.done = done; return; }
        N.img.drop(img);
      } else if (img._pnUrl && img._pnUrl !== u) { img.src = BLANK; img._pnUrl = null; }
      var job = { img: img, url: u, prio: prio || 0, done: done, seq: seq++ };
      img._pnJob = job;
      jobs.push(job);
      kick();
    },
    /* Karte recycelt -> Auftrag verwerfen, Platzhalter. keep: altes Bild stehen lassen (Karte liegt ausserhalb des Clips und
     * bekommt gleich ein neues want -> BLANK erst dann, im selben Frame wie der neue Inhalt; gleiche URL bleibt einfach stehen) */
    drop: function (img, keep) {
      var job = img._pnJob;
      if (job) {
        var i = jobs.indexOf(job), k = ready.indexOf(job);
        if (i >= 0) jobs.splice(i, 1);
        else if (k >= 0) { ready.splice(k, 1); job.pre = null; }
        else if (job.started) {
          if (job.pre) { detach(job.pre); try { job.pre.src = BLANK; } catch (e) {} job.pre = null; }   // Download abbrechen
          else detach(img);
          active--; kick();
        }
        img._pnJob = null;
      }
      if (img._pnUrl && !keep) { img.src = BLANK; img._pnUrl = null; }
    },
    pause: function (on) { paused = !!on; if (!paused) kick(); },
    /* Profilwechsel: Warteschlange und LRU leeren (SPEC 7.15.5) */
    reset: function () {
      for (var i = 0; i < jobs.length; i++) jobs[i].img._pnJob = null;
      for (i = 0; i < ready.length; i++) ready[i].img._pnJob = null;
      jobs = []; ready = []; lru.clear();
    },
    _stats: function () { return { queued: jobs.length, ready: ready.length, active: active, cached: lru.size, sets: sets, loads: loads }; },
    _mkPre: function (f) { mkPre = f; }               // Tests: losgeloestes Bild nachbilden
  };
})(N);
