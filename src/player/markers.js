/* N.Markers – Skip-Intro/-Abspann und Countdown zur naechsten Folge (SPEC 7.10).
 * Rein (keine Zeitgeber): tick(t, ctx) wird 1x je Zeit-Ereignis gerufen und liefert, was die Ansicht zeigen soll.
 * Schutz: erst nach 2 fortlaufenden Ticks (kein Sprung), nicht waehrend des Fortsetzen-Sprungs (t < resume - 5 s),
 * Sprungziel = Marker-Ende, max. 3 s vor Dateiende (damit Ende/Up-Next laufen). Button max. 15 s, Auto: 5 s "Intro ansehen".
 * cfg: {intro:'off'|'button'|'auto', credits:'off'|'button'|'auto', autoNext:bool, cd:Sek.} */
(function (N) {
  var BTN_MS = 15000, WATCH_MS = 5000;
  function Markers(list, cfg) {
    this.cfg = cfg; this.m = []; this.last = -1; this.cnt = 0; this.cdStart = -1; this.cancelled = false; this.watch = null;
    for (var i = 0; list && i < list.length; i++) {
      var x = list[i], t = String(x.type || '').toLowerCase(), s = Number(x.startTimeOffset) || 0, e = Number(x.endTimeOffset) || 0;
      if ((t === 'intro' || t === 'credits') && e > s) this.m.push({ type: t, start: s, end: e, fin: x['final'] === true || x['final'] === 1 || x['final'] === '1', done: false, shownAt: -1 });
    }
    this.lastC = null;
    for (i = 0; i < this.m.length; i++) if (this.m[i].type === 'credits' && this.m[i].fin) this.lastC = this.m[i];
    if (!this.lastC) for (i = 0; i < this.m.length; i++) if (this.m[i].type === 'credits' && (!this.lastC || this.m[i].start > this.lastC.start)) this.lastC = this.m[i];
  }
  var P = Markers.prototype;
  /* ctx: {dur, playing, hasNext, last (letzte Folge), resume (ms)} -> {btn:null|'intro'|'credits'|'next'|'watch', marker, cd:-1|Sek., skipTo:-1|ms, next:bool, last:bool} */
  P.tick = function (t, ctx) {
    var out = { btn: null, marker: null, cd: -1, skipTo: -1, next: false, last: false }, c = this.cfg;
    if (this.last >= 0 && t > this.last && t - this.last < 3000) this.cnt++; else this.cnt = 0;
    this.last = t;
    if (!ctx.playing) { this.cnt = 0; return out; }
    if (this.watch && t < this.watch.until && t >= this.watch.from) { out.btn = 'watch'; out.marker = this.watch.m; }
    else this.watch = null;
    if (this.cnt < 2 || (ctx.resume > 0 && t < ctx.resume - 5000)) return out;
    var lastC = this.lastC, N0 = c.autoNext && ctx.hasNext && !this.cancelled ? (c.cd || 0) : 0;
    if (N0 > 0 && ctx.dur > 0) {
      var ws = lastC ? lastC.start : ctx.dur - N0 * 1000 - 2000;
      if (t >= ws) {
        if (this.cdStart < 0 || t < this.cdStart) this.cdStart = t;
        var left = Math.ceil((this.cdStart + N0 * 1000 - t) / 1000);
        if (left <= 0) { out.next = true; return out; }
        out.cd = left; return out;
      }
      this.cdStart = -1;
    }
    // letzte Folge der Serie (Play-Queue ohne naechsten Eintrag): Karte "Das war die letzte Folge" statt Countdown (SPEC 7.10)
    if (!N0 && c.autoNext && ctx.last && !this.cancelled && ctx.dur > 0 && t >= (lastC ? lastC.start : ctx.dur - (c.cd || 10) * 1000 - 2000)) { out.last = true; return out; }
    var nextOnCredits = !!(c.autoNext && ctx.hasNext && !this.cancelled);
    for (var i = 0; i < this.m.length; i++) {
      var m = this.m[i];
      if (m.done) continue;
      if (t >= m.end) { m.done = true; continue; }
      if (t < m.start || t >= m.end - 3000) continue;
      var mode = m.type === 'intro' ? c.intro : c.credits;
      if (mode === 'auto' && !(m === lastC && nextOnCredits)) {
        out.skipTo = this.target(m, ctx.dur); out.marker = m; m.done = true; this.cnt = 0;
        if (m.type === 'intro') this.watch = { m: m, from: out.skipTo - 2000, until: out.skipTo + WATCH_MS };
        out.btn = null; return out;
      }
      if (mode !== 'button' && !(m === lastC && nextOnCredits && mode !== 'off')) return out;
      if (m.shownAt < 0) m.shownAt = t;
      if (t < m.shownAt + BTN_MS) { out.btn = m === lastC && nextOnCredits ? 'next' : m.type; out.marker = m; return out; }
      m.done = true;
    }
    return out;
  };
  P.target = function (m, dur) { var tg = m.end; if (dur > 0 && tg > dur - 3000) tg = dur - 3000; return tg; };
  /* Button gedrueckt -> Sprungziel (ms) */
  P.skip = function (m, dur) { m.done = true; this.cnt = 0; return this.target(m, dur); };
  /* "Intro ansehen": zurueck an den Markerstart, Marker bleibt erledigt (kein erneuter Auto-Sprung) */
  P.watchStart = function () { var w = this.watch; this.watch = null; this.cnt = 0; return w ? w.m.start : -1; };
  P.cancelCountdown = function () { this.cancelled = true; this.cdStart = -1; };
  P.seeked = function () { this.cnt = 0; this.cdStart = -1; };
  /* Echtes Dateiende (PLAY-18): was jetzt passiert. o: {sleepEnd, autoNext, hasNext, last, cancelled} ->
   * 'sleep' (Sleep-Timer "Ende der Folge"), 'next' (naechster Eintrag), 'card' (Karte "Das war die letzte Folge" kurz mit
   * Rueckzaehler, danach zurueck) oder 'close' (sofort zurueck: Film, Autoplay aus, Karte vorher weggedrueckt).
   * Nie bleibt der Player auf dem fertigen Video stehen (TV-Befund 1.0.6). */
  Markers.endAction = function (o) {
    if (o.sleepEnd) return 'sleep';
    if (o.autoNext && o.hasNext) return 'next';
    if (o.autoNext && o.last && !o.cancelled) return 'card';
    return 'close';
  };
  /* Wartezeit der Karte am echten Ende in Sekunden: die Einstellung "Wartezeit vor naechster Folge", sonst 10 s */
  Markers.endWait = function (cd) { var n = Number(cd); return n > 0 ? Math.round(n) : 10; };
  N.Markers = Markers;
})(N);
