/* N.Loupe – Feinauswahl am Fortschrittsbalken (Nutzerauftrag 28.10., Bewertung + Variantenvergleich: docs/research/player-controls.md
 * "Feinauswahl"; SPEC PLAY-30, Darstellungen PLAY-31). Rein, ohne DOM, in Node getestet. Bleibt der Zeiger DWELL ms ruhig auf dem
 * Balken (Bewegung < STILL px, Finger auf dem Touchpad), oeffnet ein Fenster (w px) fuer +-half um die Stelle; die Zeiger-x waehlt
 * dann linear darin. Gleiche Logik fuer alle Darstellungen (Einstellung loupeStyle, STY): panel = A Lasche ueber dem Balken
 * (Standard), stretch = B Balken dehnt sich, film = D Lasche mit Vorschaubildern (1000 px). Die fruehere Form C (Feinleiste UNTER
 * dem Balken in der Insel) ist entfallen (TV-Befund 28.10.: unter dem Balken liegen Zeitzeile und Knopfreihe zu eng, der grobe
 * Zeiger traf beim Feinjustieren Knoepfe); gespeichertes 'bar' gilt als A.
 * - Fang-Band (band): offen bleibt die Feinauswahl von der Laschen-Oberkante (A/D) bzw. CORR px ueber der Balkenmitte (B) bis
 *   o.bottom = UNTER der Knopfreihe (Aufrufer). Solange sie offen ist, gehoeren alle Zeiger-Ereignisse darin ihr: Knoepfe darunter
 *   reagieren nicht (Schutzzone), ein Klick setzt das Ziel statt einen Knopf auszuloesen. Seitlich verlassen geht nur auf Hoehe
 *   des Balkens und darueber (y < o.side); in der Schutzzone haftet die Zeit an den Fensterenden, damit ein seitliches Abrutschen
 *   den Zeiger nicht offen ueber einem Knopf zuruecklaesst.
 * - Spanne: +-FRAC der Dauer, geklemmt auf [H_MIN, H_MAX]; aus, wenn der grobe Balken schon fein genug ist (< MIN_SPP ms/px).
 * - Abbildung verankert: die Ruhestelle x0 behaelt beim Oeffnen ihre Zeit t0 (kein Sprung der Anzeige), Fenster am Balken geklemmt.
 * - Hysterese HYST px (Anzeige springt nicht beim senkrechten Wandern), Kapitelgrenzen rasten innerhalb SNAP px ein.
 * - Verlassen: senkrecht aus dem Band (oben/unten), seitlich mehr als EXIT_X px ueber die Enden (nur ueber band.side), jede Taste,
 *   Klick (setzt das Ziel).
 *   Ein Sprung > JUMP px zwischen zwei Bewegungen (Finger neu aufgelegt: Punkt in der Bildmitte) verlaesst ebenfalls.
 *   Danach ist das Verweilen gesperrt, bis der Zeiger sich > STILL px bewegt (kein sofortiges Wiederoeffnen am selben Fleck).
 * opts: {timers {now, set, clear}, ok() -> darf oeffnen (Einstellung, Zeiger an, kein Sprung offen, kein Panel),
 *        live() -> Finger auf dem Touchpad (N.pointer Lebenszeichen), pos() -> {x, y} roher Zeigerpunkt,
 *        open(x, y) -> Rueckruf, wenn das Verweilen reif ist (die Ansicht ruft dann L.open(geom))} */
(function (N) {
  var K = { DWELL: 700, STILL: 8, MIN_SPP: 1000, FRAC: 0.04, H_MIN: 60000, H_MAX: 300000, EXIT_X: 24, HYST: 3, SNAP: 6, HINTS: 3, JUMP: 200, CORR: 32 };
  /* Darstellungen: w = Fensterbreite (0 = wie der Aufrufer, Video 480, Jetzt laeuft 400), tab = Hoehe der Lasche ueber der Insel
   * (A/D; 0 = keine), pad = Rand der Lasche links/rechts neben dem Fenster; film: n Bilder fw x fh mit gap Abstand (n*fw+(n-1)*gap = w) */
  var STY = { panel: { w: 0, tab: 80, pad: 16 }, stretch: { w: 0, tab: 0 },
    film: { w: 1000, tab: 162, pad: 8, n: 7, fw: 136, fh: 77, gap: 8 } };
  var STYLES = ['panel', 'stretch', 'film'], DEF = 'panel';
  /* wirksame Darstellung: unbekannt (auch das fruehere 'bar' = C) -> panel; film ohne Vorschaubilder -> panel (gleiche Lasche ohne
   * Bilder); np (Jetzt laeuft: Titel/Interpret/Kapitel ueber dem Balken, Knoepfe darunter, keine Bilder) -> immer stretch: der Balken
   * dehnt sich an Ort und Stelle, nichts wird verdeckt, nichts rueckt naeher an die Knoepfe */
  function style(pref, o) {
    var s = STY[pref] ? pref : DEF;
    if (o && o.np) return 'stretch';
    return s === 'film' && !(o && o.thumbs) ? 'panel' : s;
  }
  function width(s, base, barW) { var w = STY[s] && STY[s].w || base; return Math.min(w, barW); }
  /* Lasche (A/D) als Bildschirm-Rechteck {x, y, w, h}: Unterkante = Oberkante der Bedien-Insel (islY), seitlich pad um das Fenster */
  function tab(s, g, islY) {
    var st = STY[s];
    return st && st.tab ? { x: g.L - st.pad, y: islY - st.tab, w: g.w + 2 * st.pad, h: st.tab } : null;
  }
  /* Band (y), in dem die Feinauswahl offen bleibt: ab der Laschen-Oberkante (A/D) bzw. CORR px ueber der Balkenmitte (B) bis
   * o.bottom (unter der Knopfreihe: Schutzzone, siehe Kopf) */
  function band(s, g, o) { var t = tab(s, g, o.islY); return { top: t ? t.y : o.barY - K.CORR, bottom: o.bottom, side: o.side }; }
  function hit(a, b) { return !!(a && b && a.w > 0 && b.w > 0 && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h); }
  /* Filmstreifen: Bild k deckt x [L + k*(fw+gap), +fw]; Zeit = Mitte des Abschnitts. slot(x) = Bild unter dem Zeiger */
  function frames(g) {
    var f = STY.film, out = [];
    for (var k = 0; k < f.n; k++) { var x = g.L + k * (f.fw + f.gap); out.push({ x: x, ms: Math.round(at(g, x + f.fw / 2)) }); }
    return out;
  }
  function slot(g, x) { var f = STY.film; return clamp(Math.floor((x - g.L) / (f.fw + f.gap)), 0, f.n - 1); }
  /* B (Balken dehnt sich): stueckweise lineare Abbildung, offen -> {ra, rb (Fenster auf dem groben Balken), map(ms) -> x,
   * grp: [{x, w, s, tx, o}] links/Mitte/rechts mit Start-Transform fuer die Animation: s = scaleX, tx = translateX, o = Ursprung
   * ('0' links, '100%' rechts); von dort laeuft jede Gruppe auf "keine Transformation" = gedehnt. Gleiches Ease fuer alle -> jeder
   * Punkt wandert linear von seiner groben zu seiner gedehnten Stelle (der Kopf als eigenes Element per translate genauso). */
  function stretch(g, barX, barW) {
    var E = barX + barW, R = g.L + g.w, a = Math.max(0, g.a), b = Math.min(g.dur, g.b);
    var ra = barX + barW * a / g.dur, rb = barX + barW * b / g.dur;
    function map(ms) {
      if (ms <= a) return a > 0 ? barX + (g.L - barX) * ms / a : g.L;
      if (ms >= b) return g.dur > b ? R + (E - R) * (ms - b) / (g.dur - b) : R;
      return xOf(g, ms);
    }
    function sc(n, d) { return d > 0 ? n / d : 1; }
    return { ra: ra, rb: rb, map: map, grp: [
      { x: barX, w: g.L - barX, s: sc(ra - barX, g.L - barX), tx: 0, o: '0' },
      { x: g.L, w: g.w, s: sc(rb - ra, g.w), tx: ra - g.L, o: '0' },
      { x: R, w: E - R, s: sc(E - rb, E - R), tx: 0, o: '100%' }] };
  }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  /* halbe Spanne in ms fuer einen Balken (dur ms auf barW px); 0 = Feinauswahl lohnt nicht (kurze Titel, Musik) */
  function half(dur, barW) {
    if (!(dur > 0) || !(barW > 0) || dur / barW < K.MIN_SPP) return 0;
    return Math.min(clamp(Math.round(dur * K.FRAC), K.H_MIN, K.H_MAX), Math.floor(dur / 4));
  }
  /* Fenster: o {x (Ruhestelle), barX, barW, dur, w (Breite der Feinleiste), h (halbe Spanne)} ->
   * {L, w, a, b, x0, t0, spp (ms je px fein), dur}. Zeiten relativ zum Balken (0 … dur). */
  function geom(o) {
    var x0 = clamp(o.x, o.barX, o.barX + o.barW), t0 = o.dur * (x0 - o.barX) / o.barW, w = Math.min(o.w, o.barW);
    var L = clamp(Math.round(x0 - w / 2), o.barX, o.barX + o.barW - w), span = 2 * o.h;
    var a = t0 - (x0 - L) / w * span;
    return { L: L, w: w, a: a, b: a + span, x0: x0, t0: t0, spp: span / w, dur: o.dur };
  }
  /* Zeit zur Zeiger-x (an den Enden haftend), 0 … dur */
  function at(g, x) { var xx = clamp(x, g.L, g.L + g.w); return clamp(g.a + (xx - g.L) * g.spp, 0, g.dur); }
  function xOf(g, ms) { return g.L + (ms - g.a) / g.spp; }
  /* Teilstriche: {minor, major} in ms je nach Spanne; Liste [{x, major}] (x absolut) */
  function tickStep(span) {
    if (span <= 150000) return { minor: 10000, major: 30000 };
    if (span <= 900000) return { minor: 30000, major: 60000 };
    return { minor: 60000, major: 300000 };
  }
  function ticks(g) {
    var st = tickStep(g.b - g.a), out = [], t = Math.ceil(Math.max(0, g.a) / st.minor) * st.minor, end = Math.min(g.b, g.dur);
    for (; t <= end && out.length < 60; t += st.minor) out.push({ x: Math.round(xOf(g, t)), major: t % st.major === 0, ms: t });
    return out;
  }
  /* Kapitelgrenzen (Start ab dem 2. Kapitel) im Fenster -> [{x, ms}]; off = Versatz der Balkenzeiten (Hoerbuch-Kapitel) */
  function marks(g, chs, off) {
    var out = [];
    for (var i = 1; chs && i < chs.length; i++) {
      var t = chs[i].start - (off || 0);
      if (t > g.a && t < g.b && t > 0 && t < g.dur) out.push({ x: Math.round(xOf(g, t)), ms: t });
    }
    return out;
  }
  /* Marker-Segmente (Intro/Abspann) im Fenster -> [{x, w}] */
  function segs(g, list) {
    var out = [];
    for (var i = 0; list && i < list.length; i++) {
      var s = Math.max(g.a, list[i].startTimeOffset), e = Math.min(g.b, list[i].endTimeOffset);
      if (e > s) { var x = Math.round(xOf(g, s)); out.push({ x: x, w: Math.max(1, Math.round(xOf(g, e)) - x) }); }
    }
    return out;
  }
  /* Verlassen? band {top, bottom (y, Grenzen exklusiv), side (optional: seitlich nur fuer y < side)} -> '' | 'up' | 'down' | 'side' */
  function exit(g, x, y, band) {
    if (y < band.top) return 'up';
    if (y >= band.bottom) return 'down';
    if ((band.side === undefined || y < band.side) && (x < g.L - K.EXIT_X || x > g.L + g.w + K.EXIT_X)) return 'side';
    return '';
  }

  function Loupe(o) {
    this.o = o; this.T = o.timers;
    this.t = 0; this.px = -1e4; this.py = -1e4; this.ax = -1e4; this.ay = -1e4; this.dis = null; this.g = null; this.lx = -1e4; this.ms = -1; this.chs = null; this.coff = 0;
  }
  var P = Loupe.prototype;
  P.isOpen = function () { return !!this.g; };
  /* Zeiger auf dem Balken (grobe Vorschau): Verweilen beobachten */
  P.track = function (x, y) {
    if (this.g) return;
    if (this.dis) {                                   // nach dem Schliessen erst wieder nach deutlicher Bewegung
      if (Math.abs(x - this.dis.x) + Math.abs(y - this.dis.y) <= K.STILL) return;
      this.dis = null;
    }
    if (this.t && Math.abs(x - this.ax) + Math.abs(y - this.ay) <= K.STILL) return;   // ruht noch -> Uhr laeuft weiter
    this.ax = x; this.ay = y;
    this.arm();
  };
  P.arm = function () {
    var self = this;
    if (this.t) this.T.clear(this.t);
    this.t = this.T.set(function () { self.t = 0; self.ripe(); }, (N.config && N.config.loupeDwell) || K.DWELL);
  };
  P.ripe = function () {
    var o = this.o, p = o.pos();
    if (this.g || this.dis || !o.ok() || !o.live()) return;
    if (Math.abs(p.x - this.ax) + Math.abs(p.y - this.ay) > K.STILL) return;   // inzwischen weiter (unter der Zitterschwelle)
    o.open(p.x, p.y);
  };
  /* Zeiger verlaesst den Balken (grob) -> Uhr anhalten */
  P.leave = function () { if (this.t) { this.T.clear(this.t); this.t = 0; } };
  /* Taste, Klick, Panel …: alles abbrechen und am aktuellen Punkt sperren */
  P.cancel = function (x, y) {
    this.leave();
    var p = x === undefined ? this.o.pos() : { x: x, y: y };
    this.dis = { x: p.x, y: p.y };
    if (this.g) this.close();
  };
  /* oeffnen: g aus geom(), chs = Kapitel (Rasten), coff = Versatz (Hoerbuch: Kapitelanfang) */
  P.open = function (g, chs, coff) { this.leave(); this.g = g; this.chs = chs || null; this.coff = coff || 0; this.lx = -1e4; this.ms = -1; this.px = -1e4; return g; };
  P.close = function () { var was = !!this.g; this.g = null; this.ms = -1; return was; };
  /* Bewegung im geoeffneten Zustand: {ms, x} (Anzeige) oder {exit} */
  P.move = function (x, y, band) {
    var g = this.g;
    if (!g) return null;
    var why = exit(g, x, y, band);
    if (!why && this.px > -1e3 && Math.abs(x - this.px) + Math.abs(y - this.py) > K.JUMP) why = 'jump';   // Finger neu aufgelegt
    if (why) { this.cancel(x, y); return { exit: why }; }
    this.px = x; this.py = y;
    if (this.ms >= 0 && Math.abs(x - this.lx) < K.HYST) return { ms: this.ms, x: this.lx, same: true };
    var ms = Math.round(at(g, x) / 1000) * 1000, sx = clamp(x, g.L, g.L + g.w);
    var m = marks(g, this.chs, this.coff);
    for (var i = 0; i < m.length; i++) if (Math.abs(m[i].x - sx) <= K.SNAP) { ms = m[i].ms; sx = m[i].x; break; }   // Kapitelanfang einrasten
    this.lx = x; this.ms = ms;
    return { ms: ms, x: sx };
  };
  /* Klick im geoeffneten Zustand -> Zielzeit (und schliessen); sonst -1 */
  P.click = function (x, y, band) {
    if (!this.g) return -1;
    var r = this.move(x, y, band);
    if (!r || r.exit) return -1;
    var ms = r.ms;
    this.cancel(x, y);
    return ms;
  };

  Loupe.K = K; Loupe.half = half; Loupe.geom = geom; Loupe.at = at; Loupe.xOf = xOf; Loupe.ticks = ticks; Loupe.tickStep = tickStep;
  Loupe.marks = marks; Loupe.segs = segs; Loupe.exit = exit;
  Loupe.STY = STY; Loupe.STYLES = STYLES; Loupe.DEF = DEF; Loupe.style = style; Loupe.width = width; Loupe.tab = tab; Loupe.band = band; Loupe.hit = hit;
  Loupe.frames = frames; Loupe.slot = slot; Loupe.stretch = stretch;
  N.Loupe = Loupe;
})(N);
