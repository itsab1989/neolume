/* N.img – Bild-URLs in exakten Groessen (SPEC 2 / 15.1) und Bildlader (SPEC 14.7):
 * max. 4 Downloads gleichzeitig, max. 2 neue src pro Frame, Pause bei Tastenwiederholung und 150 ms nach der letzten Taste,
 * LRU der geladenen URLs (Treffer sofort), 1 Wiederholung nach 2 s, nie src="" (statt dessen BLANK).
 * P7 27.10. (TV: lange Frames in den ersten Schritten nach dem Laden = Dekodieren beim Scrollen):
 * - Dekodier-Sperre: Downloads laufen in ein losgeloestes Image(); das sichtbare <img> bekommt die (dann im Cache liegende) URL
 *   erst in einer Ruhephase, hoechstens SHOW_PER_FRAME (1) je Frame. WebKit dekodiert beim ersten Zeichnen -> nie mitten in einer Tastenfolge.
 * - Nach Tastenwiederholung (N.fx.isFast) gilt REST_FAST statt REST: bei 160-ms-Wiederholung kein Zuweisen zwischen zwei Tasten.
 * - Vorab-Dekodieren (Runde 5, 28.10.): Der TV-WebKit malt GPU-Ebenen ausserhalb des Bildschirms nicht (Kacheln nur im sichtbaren
 *   Bereich) -> Karten einer Reihe unter dem Bildschirmrand bzw. rechts ausserhalb des Clips werden erst beim ▼/▶ gemalt UND ihre
 *   Bilder erst dann dekodiert (home ▼: 56–75-ms-Frames ohne DOM-Aenderung). warm(urls) legt solche (schon geladenen) Bilder in
 *   Ruhe nacheinander in einen 1x1-px-Dekodierer (eigene kleine Ebene, Deckkraft 0,01): WebKit dekodiert das ganze Bild, die
 *   dekodierten Daten haengen am gemeinsamen Bild-Cache-Eintrag -> beim Aufdecken malt die Karte ohne Dekodieren.
 *   Zaehlt ins selbe Budget wie das Zuweisen (hoechstens 1 Dekodierung je Frame, nur in Ruhe). */
(function (N) {
  var U = N.util;
  var BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  var TIERS = {
    poster: [176, 264], posterS: [144, 216], posterXS: [96, 144], posterQ: [120, 180], listThumb: [48, 72], land: [288, 162],
    hero: [1280, 720],            // am TV gemessen: 1280x720 schaerfer UND weniger Haenger als skaliert (PHASE1)
    square: [176, 176], squareS: [144, 144], squareXS: [96, 96], listSq: [48, 48], cover: [192, 192], coverL: [400, 400],   // M4 Musik (quadratisch)
    saverPoster: [360, 540], saverSq: [460, 460],   // Schoner "Poster und Cover" (scharf, 1:1 gezeigt)
    backdrop: [640, 360], amb: [320, 180], upnext: [176, 99], chapter: [96, 54], avatar: [160, 160], avatarM: [96, 96], avatarS: [32, 32], cast: [120, 120]
  };
  /* Downloads gleichzeitig: 4, in laengerer Ruhe (>= 1 s ohne Taste/Zeiger, z. B. Kaltstart: Fernseher hat nach dem Beenden der App
   * keine Bilder mehr im Speicher) 6 (Nutzerbefund 30.10.: erster Start nach dem Beenden laedt Cover/Hintergruende spuerbar langsam;
   * PMS rechnet ein Poster in ~0,15 s, der Engpass ist die Warteschlange). Dekodier-Budget unveraendert (SHOW_PER_FRAME). */
  var MAX_ACTIVE = 4, MAX_IDLE = 6, IDLE_REST = 1000, PER_FRAME = 2, SHOW_PER_FRAME = 1, REST = 150, REST_FAST = 250;   // perf3: 1 Dekodierung je Frame (TV: 2 Poster = 82-ms-Frame)
  var jobs = [], ready = [], active = 0, lru = new N.LRU(400), frameT = 0, paused = false, sets = 0, loads = 0;   // sets/loads: Zaehler fuer den Messlauf (P7)
  var dec = null, warmQ = [], warmed = new N.LRU(80), warms = 0, WARM_TTL = 30000;   // Vorab-Dekodieren (s. Kopf); warmed: URL -> Zeit
  /* losgeloestes Bild fuer den Download (Tests ohne DOM: null -> direkt ins <img> wie frueher) */
  function mkPre() { return typeof Image !== 'undefined' ? new Image() : null; }
  function rest() { return N.idle ? N.idle.restFor() : 1e9; }
  function restNeed() { return N.fx && N.fx.isFast() ? REST_FAST : REST; }

  function url(path, tier, opts) {
    if (!path) return '';
    var sz = TIERS[tier] || TIERS.poster, q = { width: sz[0], height: sz[1], minSize: 1, upscale: 1, format: (opts && opts.format) || 'jpeg' };
    if (opts && opts.blur) q.blur = opts.blur;
    if (opts && opts.opacity) { q.opacity = opts.opacity; q.background = opts.background || '000000'; }   // PMS dunkelt ab (Deckkraft % ueber Farbe), geprueft 27.10.
    if (opts && opts.quality) q.quality = opts.quality;   // PMS: JPEG-Qualitaet 1..100 (Standard ~75; s. SOFT_Q)
    else if (N.comfort && N.comfort.isSpoiler(path)) q.blur = 30;   // Spoilerschutz (SPEC 5.3): ungesehene Folgen unscharf
    // Weitere Server: Pfad mit Marke '@<machineId>|<pfad>' -> Bild ueber DIESEN Server (nicht erreichbar -> kein Bild)
    var x = path.charAt(0) === '@' && N.srv ? N.srv.untag(path) : null, c = x ? N.srv.conn(x.id) : null;
    if (x && !c) return '';
    q.url = x ? x.path : path;
    q['X-Plex-Token'] = c ? c.token : (opts && opts.token) || N.plex.token || '';
    return (c ? c.base : (opts && opts.base) || N.plex.base) + '/photo/:/transcode?' + U.qs(q);
  }

  /* Vollbild-Hintergrund eines Titels (Startseiten-Hero, Detailseiten, "Jetzt laeuft"), TV-Befund 27.10. nachmittags (neu
   * hinzugefuegter Film ohne Art: Hero einfarbig). Art scharf in 1280x720 (am TV gemessen, s. TIERS.hero); ohne Art das
   * Poster/Cover (N.model: Folge -> Serienposter, Track -> Albumcover) vom PMS unscharf gerechnet, der TV blurrt nichts.
   * PMS 27.10. geprueft (read-only): blur=N wirkt (Radius in Ausgabe-Pixeln), quality=1..100 wirkt, minSize=1 schneidet NICHT zu
   * (Poster 2:3 in 1280x720 -> 1280x1850). TV-Befund Schoner: 640x360 blur 24 + 2x CSS = Farbbrei mit Bloecken/Stufen. Daher
   * nativ 1280 breit (keine CSS-Vergroesserung, mittig beschnitten), maessiger blur 12 (Stimmung erkennbar, Text ueber Scrims
   * lesbar) und quality 90: Block-Kennzahl (Kanten an 8er-Grenzen / innen) 1,64 -> 1,27, ~230 KB statt 139 KB (Standardqualitaet).
   * -> {url, soft} | null (kein Bild bzw. Einstellung "Hintergrundbilder" aus) */
  var SOFT_BLUR = 12, SOFT_Q = 90;
  function bg(art, thumb) {
    if (N.comfort && !N.comfort.backgrounds()) return null;
    if (art) return { url: url(art, 'hero'), soft: false };
    if (thumb) return { url: url(thumb, 'hero', { blur: SOFT_BLUR, quality: SOFT_Q }), soft: true };
    return null;
  }
  /* Bild (nw x nh) fuellt W x H ohne Verzerrung, mittig beschnitten -> {x, y, w, h} */
  function cover(nw, nh, W, H) {
    if (!(nw > 0 && nh > 0)) return { x: 0, y: 0, w: W, h: H };
    var k = Math.max(W / nw, H / nh), w = Math.round(nw * k), h = Math.round(nh * k);
    return { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w: w, h: h };
  }
  /* nach onload (Bild noch verdeckt): unscharfes Ersatzbild mittig auf 1280x720 legen (1:1, nur verschoben), Art auf die CSS-Groesse zurueck */
  function fit(img, soft) {
    var st = img.style;
    if (!soft || !img.naturalWidth) { st.left = st.top = st.width = st.height = ''; return; }
    var c = cover(img.naturalWidth, img.naturalHeight, 1280, 720);
    st.left = c.x + 'px'; st.top = c.y + 'px'; st.width = c.w + 'px'; st.height = c.h + 'px';
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
    if (paused || r < need) { if (jobs.length || ready.length || warmNext() >= 0) frameT = setTimeout(pump, paused ? REST : need - r + 10); return; }
    var n = 0, d = 0, i, max = r >= IDLE_REST ? MAX_IDLE : MAX_ACTIVE;
    if (ready.length > 1) ready.sort(byPrio);
    while (ready.length && n < SHOW_PER_FRAME) { show(ready.shift()); n++; }   // fertige Downloads zuerst sichtbar machen
    jobs.sort(byPrio);
    for (i = 0; i < jobs.length && n < SHOW_PER_FRAME && d < PER_FRAME;) {      // LRU-Treffer duerfen an wartenden Downloads vorbei
      if (lru.has(jobs[i].url)) { assign(jobs.splice(i, 1)[0]); n++; }
      else if (active < max) { assign(jobs.splice(i, 1)[0]); d++; }
      else i++;
    }
    if (n < SHOW_PER_FRAME && warmOne()) n++;                                     // Ruhe uebrig: ein Bild vorab dekodieren
    if ((jobs.length || ready.length || warmNext() >= 0) && !frameT) frameT = setTimeout(function () { frameT = 0; U.raf(pump); }, ready.length || active < max || !jobs.length ? 16 : 60);
  }
  /* naechster Kandidat zum Vorab-Dekodieren: geladen (LRU) und nicht kuerzlich dekodiert; nicht geladene bleiben in der Liste */
  function warmNext() {
    if (!dec) return -1;
    var now = U.now();
    for (var i = 0; i < warmQ.length; i++) {
      var u = warmQ[i], t = warmed.has(u) ? warmed.get(u) : 0;
      if (t && now - t < WARM_TTL) { warmQ.splice(i--, 1); continue; }
      if (lru.has(u)) return i;
    }
    return -1;
  }
  function warmOne() {
    var i = warmNext();
    if (i < 0) return false;
    var u = warmQ.splice(i, 1)[0];
    warmed.set(u, U.now()); warms++;
    dec.src = u;                                       // naechstes Malen der 1x1-Ebene dekodiert das ganze Bild
    return true;
  }
  function kick() { if (!frameT) frameT = setTimeout(function () { frameT = 0; U.raf(pump); }, 0); }
  var seq = 0;

  N.img = {
    BLANK: BLANK, TIERS: TIERS, url: url, bg: bg, cover: cover, fit: fit, SOFT_BLUR: SOFT_BLUR, SOFT_Q: SOFT_Q,
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
    /* Vorab-Dekodieren (s. Kopf): Dekodierer einmal anlegen (App-Start, Chrome-Ebene); warm(urls) ersetzt die Liste (wichtigste zuerst) */
    decoder: function (parent) {
      if (dec || !parent || typeof document === 'undefined') return;
      var box = U.el('div', '', parent, 'position:absolute;left:0;top:0;width:1px;height:1px;overflow:hidden;opacity:0.01;-webkit-transform:translate3d(0,0,0)');
      dec = U.el('img', '', box, 'position:absolute;left:0;top:0;width:1px;height:1px');
      dec.src = BLANK;
    },
    warm: function (urls) {
      warmQ = [];
      for (var i = 0; urls && i < urls.length; i++) if (urls[i] && warmQ.indexOf(urls[i]) < 0) warmQ.push(urls[i]);
      if (dec && warmQ.length) kick();
    },
    /* Profilwechsel: Warteschlange und LRU leeren (SPEC 7.15.5) */
    reset: function () {
      for (var i = 0; i < jobs.length; i++) jobs[i].img._pnJob = null;
      for (i = 0; i < ready.length; i++) ready[i].img._pnJob = null;
      jobs = []; ready = []; lru.clear(); warmQ = []; warmed.clear();
      if (dec) dec.src = BLANK;
    },
    _stats: function () { return { queued: jobs.length, ready: ready.length, active: active, cached: lru.size, sets: sets, loads: loads, warms: warms }; },
    _mkPre: function (f) { mkPre = f; },              // Tests: losgeloestes Bild nachbilden
    _dec: function (img) { dec = img; }                // Tests: Dekodierer ohne DOM
  };
})(N);
