/* N.saverLogic – reine Logik des Bildschirmschoners (ohne DOM, in Node getestet; tests/saver.test.js). Ansicht: ui/saver.js,
 * Bibliotheks-Quelle (Netz): plex/saverlib.js.
 * - Uebergaenge (Einstellung "Bildübergang"): nur, was am Orsay-TV fluessig laeuft = opacity und -webkit-transform auf
 *   GPU-Ebenen, Bild vorher fertig geladen und gezeichnet (Begruendung und Ebenen-Budget: docs/ARCHITEKTUR.md "Bildschirmschoner").
 *   "Reduzierte Bewegung": alles mit Bewegung (Zoom, Gleiten, Durchflug, Vorhang, Jalousie, Kacheln) -> Ueberblenden.
 * - Ken-Burns-Posen (Langsamer Zoom/Gleiten): nie ueber den Bildrand hinaus (Pruefung in den Tests).
 * - Zufallsbeutel ohne Wiederholung (Startseiten-Bilder) und Bibliotheks-Pool (Seiten in zufaelliger Reihenfolge, je Titel
 *   einmal, bis alle gezeigt sind; dann neue Runde).
 * - Ecken des Info-Blocks (Uhr, Titel, Zeile): wechseln nur zusammen mit dem Bild (gegen Einbrennen). */
(function (N) {
  var PAGE = 30, OV_W = 1000, OV_H = 460;
  /* Dauer je Uebergang (ms); cut = harter Schnitt. Reihenfolge = Reihenfolge in der Einstellung */
  var FX_MS = { cut: 0, fade: 1500, dip: 1600, zoom: 1500, drift: 1500, fly: 1400, curtain: 1600, blinds: 1500, tiles: 1600 };
  var CALM = { cut: 1, fade: 1, dip: 1 };            // ohne Bewegung: bleiben bei "Reduzierte Bewegung"
  var FX = ['cut', 'fade', 'dip', 'zoom', 'drift', 'fly', 'curtain', 'blinds', 'tiles', 'random'];
  /* Info-Block: Behaelter 1000 x 460 (Abdunklung scrim-saver.png + Text) in einer der 4 Ecken; Reihenfolge links unten,
   * rechts unten, rechts oben, links oben. r = rechtsbuendig, t = oben */
  var CORNERS = [{ x: 0, y: 720 - OV_H, r: false, t: false, ty: 0 }, { x: 1280 - OV_W, y: 720 - OV_H, r: true, t: false, ty: 0 },
    { x: 1280 - OV_W, y: 0, r: true, t: true, ty: 0 }, { x: 0, y: 0, r: false, t: true, ty: 0 }];
  /* Einblendung (Einstellung saverInfo): Behaelter w x h mit einer vorgerechneten Abdunklung (PNG, kein CSS-Verlauf/-Blur) und
   * Positionen p (x, y, r = rechtsbuendig, t = oben, ty = Text um ty px nach oben versetzt). Die Position wechselt nur mit dem Bild
   * (Einbrennen): Ecken reihum, Grosse Uhr in 4 leicht versetzten Lagen um die Mitte, Leisten unten mit 4 Text-Hoehen bzw. links/rechts.
   * Abdunklung buendig (TV-Befund 28.10.: Luecke zwischen Schatten und Bildschirmrand): Eck-Schatten liegen immer exakt in der Ecke,
   * je Ecke ein eigenes, fertig gespiegeltes Bild (scrim-saver[-br|-tr|-tl].png, keine CSS-Spiegelung); die Leisten-Abdunklung liegt
   * immer unten am Rand (y 380) – fuer das Wandern bewegt sich nur der Text (ty). edge = Raender, die die Abdunklung beruehren muss
   * (Layout-Pruefung "edge"). */
  function pos(x, y, r, t, ty) { return { x: x, y: y, r: !!r, t: !!t, ty: ty || 0 }; }
  function cornerScr(p) { return 'scrim-saver' + (p.r || p.t ? '-' + (p.t ? 't' : 'b') + (p.r ? 'r' : 'l') : '') + '.png'; }
  /* Nur kleine Uhr: eigene kleine Eck-Schatten in Anzeigegroesse 420x200 (TV-Befund 28.10. abends: das gestauchte 1000x460-Bild war ein harter Fleck) */
  function miniScr(p) { return cornerScr(p).replace('scrim-saver', 'scrim-saver-m'); }
  function cornerEdge(p) { return [p.r ? 'r' : 'l', p.t ? 't' : 'b']; }
  var BAND_EDGE = ['l', 'r', 'b'];
  var INFO = {
    ambient: { w: OV_W, h: OV_H, scr: cornerScr, edge: cornerEdge, p: CORNERS },
    classic: { w: OV_W, h: OV_H, scr: '', p: CORNERS },
    poster: { w: 1280, h: 340, scr: 'scrim-saver-b.png', edge: BAND_EDGE, p: [pos(0, 380), pos(0, 380, 1), pos(0, 380, 0, 0, 16), pos(0, 380, 1, 0, 16)] },
    lower: { w: 1280, h: 340, scr: 'scrim-saver-b.png', edge: BAND_EDGE, p: [pos(0, 380), pos(0, 380, 0, 0, 24), pos(0, 380, 0, 0, 12), pos(0, 380, 0, 0, 36)] },
    bigclock: { w: 1200, h: 600, scr: 'scrim-saver-c.png', p: [pos(40, 60), pos(76, 80), pos(40, 100), pos(4, 80)] },
    minimal: { w: 420, h: 200, scr: miniScr, edge: cornerEdge, p: [pos(0, 520), pos(860, 520, 1), pos(860, 0, 1, 1), pos(0, 0, 0, 1)] },
    off: { w: 0, h: 0, scr: '', p: [pos(0, 0)] }
  };
  /* Ken Burns: [s0, x0, y0, s1, x1, y1] (Skalierung um die Mitte, Verschiebung in px). Grenze: |x| <= (s-1)*640, |y| <= (s-1)*360 */
  var KB = {
    zoom: [[1, 0, 0, 1.08, -36, -18], [1.08, 36, 18, 1, 0, 0], [1, 0, 0, 1.08, 36, -16], [1.08, -36, 16, 1, 0, 0]],
    drift: [[1.08, -40, 0, 1.08, 40, 0], [1.08, 40, 0, 1.08, -40, 0], [1.08, 0, -22, 1.08, 0, 22], [1.08, 20, 22, 1.08, -20, -22]]
  };
  function rnd0(r) { return typeof r === 'function' ? r() : r === undefined ? Math.random() : r; }
  function shuffle(a, rnd) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rnd0(rnd) * (i + 1)); if (j > i) j = i; var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function tf(s, x, y) { return 'translate3d(' + x + 'px,' + y + 'px,0)' + (s !== 1 ? ' scale(' + s + ')' : ''); }

  var L = {
    PAGE: PAGE, OV_W: OV_W, OV_H: OV_H, FX: FX, FX_MS: FX_MS, CALM: CALM, CORNERS: CORNERS, KB: KB,
    SEC: [10, 20, 30, 60],
    TYPE: { movie: 1, show: 2, artist: 8 },
    /* Einstellung -> tatsaechlicher Uebergang. reduced: "Reduzierte Bewegung"; rnd: Zahl 0..1 oder Funktion; last: letzter (Zufall
     * wiederholt ihn nicht). Unbekannt -> Ueberblenden */
    fx: function (want, reduced, rnd, last) {
      var k;
      if (want === 'random') {
        var ok = [];
        for (k = 0; k < FX.length; k++) if (FX_MS[FX[k]] && (!reduced || CALM[FX[k]]) && FX[k] !== last) ok.push(FX[k]);
        return ok[Math.min(ok.length - 1, Math.floor(rnd0(rnd) * ok.length))];
      }
      if (!Object.prototype.hasOwnProperty.call(FX_MS, want)) return 'fade';
      return reduced && !CALM[want] ? 'fade' : want;
    },
    /* Bildwechsel alle n Sekunden -> ms (nur Werte aus SEC, sonst 30 s) */
    interval: function (sec) { var n = Number(sec); return (L.SEC.indexOf(n) >= 0 ? n : 30) * 1000; },
    corner: function (i) { return CORNERS[((i % 4) + 4) % 4]; },
    INFO: INFO, INFOS: ['ambient', 'classic', 'poster', 'lower', 'bigclock', 'minimal', 'off'],
    /* Stil (unbekannt -> ambient) und Lage Nr. i -> {style, w, h, scr, x, y, r, t, ty, edge} */
    info: function (style, i) {
      var st = Object.prototype.hasOwnProperty.call(INFO, style) ? style : 'ambient', d = INFO[st], p = d.p[((i % d.p.length) + d.p.length) % d.p.length];
      return { style: st, w: d.w, h: d.h, scr: typeof d.scr === 'function' ? d.scr(p) : d.scr, x: p.x, y: p.y, r: p.r, t: p.t, ty: p.ty || 0,
        edge: typeof d.edge === 'function' ? d.edge(p) : d.edge || [] };
    },
    /* Was zeigt der Stil? "Uhrzeit anzeigen" aus blendet die Uhr in JEDEM Stil aus; reine Uhr-Stile zeigen dann nichts */
    infoParts: function (style, clock) {
      var st = Object.prototype.hasOwnProperty.call(INFO, style) ? style : 'ambient';
      var text = st !== 'off' && st !== 'bigclock' && st !== 'minimal';
      return { clock: st !== 'off' && !!clock, title: text, any: text || (st !== 'off' && !!clock) };
    },
    /* Pose v (0..3) fuer zoom/drift -> {from, to} als -webkit-transform-Text, raw = Zahlen (Tests) */
    pose: function (kind, v) {
      var p = (KB[kind] || KB.zoom)[((v % 4) + 4) % 4];
      return { from: tf(p[0], p[1], p[2]), to: tf(p[3], p[4], p[5]), raw: p };
    },
    tf: tf,
    /* Teile je Uebergang: Jalousie 8 Streifen, Kacheln 3 x 2. TV-Befund 28.10.: Kacheln mit 4 x 3 = 12 eigenen GPU-Ebenen liefen mit
     * 48 fps und einem 156-ms-Frame -> halb so viele Ebenen/Zeichnungen (jede Kachel malt ihren Ausschnitt des Bilds einmal). */
    PARTS: { blinds: [8, 1], tiles: [3, 2] },
    /* cols x rows Teile ueber w x h (Standard 1280 x 720), Kanten auf ganzen Pixeln (keine Haarlinien bei 1280 / 3):
     * [{x, y, w, h}] Zeile fuer Zeile, luecken- und ueberlappungsfrei */
    grid: function (cols, rows, w, h) {
      var out = [], r, c, x0, y0, x1, y1;
      w = w || 1280; h = h || 720;
      for (r = 0; r < rows; r++) {
        y0 = Math.round(r * h / rows); y1 = Math.round((r + 1) * h / rows);
        for (c = 0; c < cols; c++) {
          x0 = Math.round(c * w / cols); x1 = Math.round((c + 1) * w / cols);
          out.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
        }
      }
      return out;
    },
    /* Jalousie (Streifen von links nach rechts) bzw. Kacheln (zufaellige Reihenfolge): Verzoegerung je Teil in ms */
    delays: function (n, step, ordered, rnd) {
      var o = [], i;
      for (i = 0; i < n; i++) o.push(i);
      if (!ordered) shuffle(o, rnd);
      var d = [];
      for (i = 0; i < n; i++) d[o[i]] = i * step;
      return d;
    },
    /* Zeile unter dem Titel: "Film · 2019", "Serie · S2 · F4", "Serie · 2015", "Musik" */
    meta: function (it) {
      if (!it) return '';
      var p = [];
      if (it.type === 'movie') p.push(N.t('ss.saver.movie'));
      else if (it.type === 'show' || it.type === 'episode' || it.type === 'season') p.push(N.t('ss.saver.show'));
      else if (it.type === 'artist' || it.type === 'album') p.push(N.t('ss.saver.music'));
      if (it.type === 'episode' && it.s >= 0 && it.e > 0) p.push(N.t('ss.saver.ep', { s: it.s, e: it.e }));
      else if (it.year) p.push(String(it.year));
      return p.join(' · ');
    },
    /* Bibliotheken fuer die Quelle "Bibliotheken": sel = Einstellung saverLibs (null = alle Film- und Serien-Bibliotheken),
     * libs = Bibliotheken des Profils (Home-Cache alibs/libs; Kinderprofile sehen nur ihre). Nur Film/Serie/Musik. */
    libs: function (sel, libs) {
      var out = [], i;
      for (i = 0; libs && i < libs.length; i++) {
        var l = libs[i];
        if (!L.TYPE[l.type]) continue;
        if (sel && sel.length ? sel.indexOf(Number(l.id)) >= 0 : l.type !== 'artist') out.push(l);
      }
      return out;
    },
    /* Anfrage einer Seite (bzw. size 0 = nur Anzahl) aus /library/sections/<id>/all */
    query: function (lib, start, size, unwatched) {
      var q = { type: L.TYPE[lib.type] || 1, sort: 'titleSort', 'X-Plex-Container-Start': start, 'X-Plex-Container-Size': size };
      if (size) { q.excludeElements = N.hubs ? N.hubs.EXCL : ''; q.excludeFields = 'summary,tagline'; }
      if (unwatched && lib.type === 'movie') q.unwatched = 1;
      if (unwatched && lib.type === 'show') q.unwatchedLeaves = 1;
      return q;
    },
    /* Einstellung "Bilder im Bildschirmschoner" (saverPics): art = nur echte Hintergrundbilder (Standard), stills = auch vom PMS
     * aus dem Video gezogene Standbilder, poster = Plakat/Cover scharf auf unscharfem Grund. Unbekannt -> art */
    PICS: ['art', 'stills', 'poster'],
    pics: function (v) { return L.PICS.indexOf(v) >= 0 ? v : 'art'; },
    /* Musik: Cover/Kuenstlerbild quadratisch (Groesse der Anfrage; die echte Form liefert das geladene Bild) */
    square: function (it) { return !!it && (it.type === 'artist' || it.type === 'album' || it.type === 'track'); },
    /* Standbild oder echtes Hintergrundbild? Untersuchung am echten PMS 28.10. (read-only, 539 Filme, 63 Serien, 125 Kuenstler):
     * Listen und Detailseiten zeigen fuer beide dieselbe Form (art = /library/metadata/<id>/art/<zeit>, Image type=background) –
     * unterscheidbar ist erst die Bildauswahl /library/metadata/<id>/arts: der Eintrag mit selected=true hat als ratingKey
     *   media://<h>/<hash>.bundle/Contents/Art/art1.jpg = vom PMS aus der Videodatei gezogenes Standbild (alle 60 gemessenen
     *     1280x720 bzw. 1279x720, teils mit schwarzen Balken; echte Bilder meist 1920x1080 bis 3840x2160),
     *   metadata://art/tv.plex.agents.…_<hash> (provider tmdb/gracenote/plex/fanarttv) bzw. upload://… = echte Hintergrundbilder.
     * Ohne ausgewaehlten Eintrag: nur media://-Eintraege -> Standbild, sonst unbekannt (gilt als echt).
     * artOwner: art-Pfad (ggf. mit Server-Marke '@<id>|') -> {rk, srv} oder null (keine PMS-Art -> nicht pruefbar, gilt als echt). */
    artOwner: function (art) {
      var m = /^(?:@([^|]+)\|)?\/library\/metadata\/(\d+)\/art(?:\/|$)/.exec(String(art || ''));
      return m ? { rk: m[2], srv: m[1] || '' } : null;
    },
    /* Antworttext von /arts (JSON, ungeparst – bis ~50 KB, am TV nur Zeichensuche statt JSON.parse) -> 'still' | 'real' | '' */
    artKind: function (txt) {
      if (typeof txt !== 'string' || !txt) return '';
      var i = txt.search(/"selected"\s*:\s*true/), RK = /"ratingKey"\s*:\s*"([^"]*)"/g, m, n = 0, med = 0;
      if (i >= 0) {
        var a = txt.lastIndexOf('{', i), b = txt.indexOf('}', i);
        m = /"ratingKey"\s*:\s*"([^"]*)"/.exec(txt.substring(a < 0 ? 0 : a, b < 0 ? txt.length : b));
        if (!m) return '';
        return m[1].indexOf('media:') === 0 ? 'still' : 'real';
      }
      while ((m = RK.exec(txt))) { n++; if (m[1].indexOf('media:') === 0) med++; }
      return n && med === n ? 'still' : '';
    },
    /* Modus "Poster und Cover": Groesse aus dem Seitenverhaeltnis (nw x nh; Musik meist quadratisch) und Lage passend zur
     * Einblendung Nr. i: Eck-Stile -> Poster auf der Seite gegenueber dem Text, Leisten unten -> mittig darueber, Grosse Uhr -> links neben den Ziffern, sonst mittig.
     * -> {x, y, w, h} (ganze Pixel, immer im Bild) */
    posterBox: function (style, i, nw, nh) {
      var c = L.info(style, i), st = c.style, band = st === 'poster' || st === 'lower', ar = nw > 0 && nh > 0 ? nw / nh : 2 / 3;
      var big = st === 'bigclock', H = band ? 400 : big ? 440 : 540, W = big ? 296 : 600, w, h;
      if (ar > 0.9) H = Math.round(H * 0.85);             // quadratisch (Cover/Kuenstler): etwas kleiner, wirkt sonst wuchtig
      h = H; w = Math.round(H * ar);
      if (w > W) { w = W; h = Math.round(W / ar); }
      var x = Math.round((1280 - w) / 2);
      if (st === 'ambient' || st === 'classic' || st === 'minimal') x = c.r ? 150 : 1280 - 150 - w;
      if (big) x = 96;                                     // Grosse Uhr: Ziffern ab x ~400 -> Plakat links daneben, nie darunter
      return { x: x, y: band ? 56 : Math.round((720 - h) / 2), w: w, h: h };
    },
    Bag: Bag,
    Pool: Pool
  };

  /* Zufallsbeutel: jede Nummer 0..n-1 einmal, dann neu gemischt; nie dieselbe zweimal hintereinander (auch ueber die Runde) */
  function Bag(n, rnd) { this.n = n; this.rnd = rnd; this.left = []; this.last = -1; }
  Bag.prototype.next = function () {
    if (this.n <= 0) return -1;
    if (!this.left.length) {
      for (var i = 0; i < this.n; i++) this.left.push(i);
      shuffle(this.left, this.rnd);
      if (this.n > 1 && this.left[this.left.length - 1] === this.last) { var t = this.left[0]; this.left[0] = this.last; this.left[this.left.length - 1] = t; }
    }
    this.last = this.left.pop();
    return this.last;
  };

  /* Bibliotheks-Pool: totals = [{lib, n}] (Anzahl je Bibliothek, aus einer Anfrage mit Size=0). Seiten zu PAGE Titeln in
   * zufaelliger Reihenfolge ueber alle Bibliotheken (Gewicht = Groesse), Titel einer Seite gemischt. Gezeigt = gemerkt (rk), bis
   * alle Seiten durch sind -> neue Runde. So gibt es keine Wiederholung, bis alles gezeigt ist, und je PAGE Bilder nur EINE
   * Anfrage (sort=random kann das nicht: jede Seite waere neu gewuerfelt und Wiederholungen nicht ausgeschlossen). */
  function Pool(rnd) { this.rnd = rnd; this.totals = []; this.pages = []; this.q = []; this.seen = {}; this.round = 0; this.last = ''; }
  Pool.prototype.setTotals = function (totals) { this.totals = totals || []; this.newRound(); };
  Pool.prototype.size = function () { var n = 0; for (var i = 0; i < this.totals.length; i++) n += this.totals[i].n; return n; };
  Pool.prototype.newRound = function () {
    var p = [], i, s;
    for (i = 0; i < this.totals.length; i++) for (s = 0; s < this.totals[i].n; s += PAGE) p.push({ lib: this.totals[i].lib, start: s });
    this.pages = shuffle(p, this.rnd); this.q = []; this.seen = {}; this.round++;
  };
  /* naechste zu ladende Seite oder null (Runde zu Ende) */
  Pool.prototype.nextPage = function () { return this.pages.length ? this.pages.shift() : null; };
  /* geladene Titel (N.model-Objekte) aufnehmen: nur mit Bild (need 'art' = Hintergrund, Standard; 'thumb' = Poster/Cover), je
   * Titel einmal je Runde */
  Pool.prototype.add = function (items, need) {
    var add = [], i, k = need || 'art';
    for (i = 0; items && i < items.length; i++) {
      var it = items[i];
      if (!it || !it[k] || this.seen[it.rk]) continue;
      this.seen[it.rk] = 1;
      add.push(it);
    }
    shuffle(add, this.rnd);
    if (add.length > 1 && add[add.length - 1].rk === this.last) add.unshift(add.pop());
    this.q = add.concat(this.q);
    return add.length;
  };
  /* naechster Titel (oder null: nachladen bzw. neue Runde) */
  Pool.prototype.take = function () { var it = this.q.pop() || null; if (it) this.last = it.rk; return it; };
  Pool.prototype.low = function () { return this.q.length < 3 && this.pages.length > 0; };
  Pool.prototype.done = function () { return !this.q.length && !this.pages.length; };

  N.saverLogic = L;
})(N);
