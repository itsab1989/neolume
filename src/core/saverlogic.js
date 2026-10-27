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
  var CORNERS = [{ x: 0, y: 720 - OV_H, r: false, t: false }, { x: 1280 - OV_W, y: 720 - OV_H, r: true, t: false },
    { x: 1280 - OV_W, y: 0, r: true, t: true }, { x: 0, y: 0, r: false, t: true }];
  /* Einblendung (Einstellung saverInfo): Behaelter w x h mit einer vorgerechneten Abdunklung (PNG, kein CSS-Verlauf/-Blur) und
   * Positionen p (x, y, r = rechtsbuendig/gespiegelt, t = oben/gespiegelt). Die Position wechselt nur mit dem Bild (Einbrennen):
   * Ecken reihum, Grosse Uhr in 4 leicht versetzten Lagen um die Mitte, Leisten unten in 4 Hoehen bzw. links/rechts. */
  function pos(x, y, r, t) { return { x: x, y: y, r: !!r, t: !!t }; }
  var INFO = {
    ambient: { w: OV_W, h: OV_H, scr: 'scrim-saver.png', p: CORNERS },
    classic: { w: OV_W, h: OV_H, scr: '', p: CORNERS },
    poster: { w: 1280, h: 340, scr: 'scrim-saver-b.png', p: [pos(0, 380), pos(0, 380, 1), pos(0, 364), pos(0, 364, 1)] },
    lower: { w: 1280, h: 340, scr: 'scrim-saver-b.png', p: [pos(0, 380), pos(0, 356), pos(0, 368), pos(0, 344)] },
    bigclock: { w: 1200, h: 600, scr: 'scrim-saver-c.png', p: [pos(40, 60), pos(76, 80), pos(40, 100), pos(4, 80)] },
    minimal: { w: 420, h: 200, scr: 'scrim-saver.png', p: [pos(0, 520), pos(860, 520, 1), pos(860, 0, 1, 1), pos(0, 0, 0, 1)] },
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
    /* Stil (unbekannt -> ambient) und Lage Nr. i -> {style, w, h, scr, x, y, r, t} */
    info: function (style, i) {
      var st = Object.prototype.hasOwnProperty.call(INFO, style) ? style : 'ambient', d = INFO[st], p = d.p[((i % d.p.length) + d.p.length) % d.p.length];
      return { style: st, w: d.w, h: d.h, scr: d.scr, x: p.x, y: p.y, r: p.r, t: p.t };
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
  /* geladene Titel (N.model-Objekte) aufnehmen: nur mit Hintergrundbild (art), je Titel einmal je Runde */
  Pool.prototype.add = function (items) {
    var add = [], i;
    for (i = 0; items && i < items.length; i++) {
      var it = items[i];
      if (!it || !it.art || this.seen[it.rk]) continue;
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
