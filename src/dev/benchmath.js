/* N.benchMath – reine Logik des app-internen Messlaufs (P7, nur Entwicklungs-Build; Node-Tests tests/bench.test.js).
 * - keys('R12 D2 U') -> ['RIGHT' x12, 'DOWN', 'DOWN', 'UP'] (Tastenskript der Szenarien)
 * - Meter: Frame-Zeiten aus rAF -> fps, Frames > 50 ms, schlimmster Frame, Bild-Haenger (langer Frame, waehrend dessen ein Bild
 *   zugewiesen/fertig geladen wurde = Dekodieren im Hauptthread)
 * - line(): eine Log-Zeile je Szenario; leaks(): Vergleich zweier Schnappschuesse nach wiederholtem Oeffnen/Schliessen */
(function (N) {
  var LONG = 50, KEYS = { R: 'RIGHT', L: 'LEFT', U: 'UP', D: 'DOWN', E: 'ENTER', B: 'RETURN' };
  function Meter() { this.frames = 0; this.long = 0; this.worst = 0; this.stall = 0; this.t0 = 0; this.last = 0; this.img = null; }
  /* t: Zeitstempel des Frames (ms), img: Zaehler der Bildereignisse (Zuweisungen + Ladeende) */
  Meter.prototype.frame = function (t, img) {
    if (this.frames) {
      var d = t - this.last;
      if (d > LONG) { this.long++; if (img !== this.img) this.stall++; }
      if (d > this.worst) this.worst = d;
    } else this.t0 = t;
    this.frames++; this.last = t; this.img = img;
  };
  Meter.prototype.result = function () {
    var ms = this.last - this.t0;
    return { fps: ms > 0 ? Math.round((this.frames - 1) * 10000 / ms) / 10 : 0, long: this.long, worst: this.worst, stall: this.stall, ms: ms, frames: this.frames };
  };
  function mb(b) { return b > 0 ? Math.round(b / 104857.6) / 10 + 'MB' : 'n/a'; }
  var BM = {
    LONG: LONG,
    Meter: Meter,
    keys: function (script) {
      var out = [], parts = String(script || '').split(/\s+/);
      for (var i = 0; i < parts.length; i++) {
        var m = /^([RLUDEB])(\d*)$/.exec(parts[i]);
        if (!m) continue;
        for (var n = m[2] ? Number(m[2]) : 1; n > 0; n--) out.push(KEYS[m[1]]);
      }
      return out;
    },
    /* 'all' | 'home,lib' -> Liste bekannter Szenario-Namen (Praefix-Treffer: 'lib' = alle lib-*) */
    pick: function (spec, names) {
      var want = String(spec || 'all').split(','), out = [];
      for (var i = 0; i < names.length; i++) {
        for (var j = 0; j < want.length; j++) {
          var w = want[j].replace(/^\s+|\s+$/g, '').replace(/:\d+$/, '');
          if (w === 'all' ? names[i] !== 'leak' && names[i].indexOf('chunk-') !== 0 && names[i].indexOf('nocapl-') !== 0 : names[i] === w || names[i].indexOf(w + '-') === 0) { out.push(names[i]); break; }
        }
      }
      return out;
    },
    line: function (name, r, extra) {
      return 'bench ' + name + ': ' + r.fps + ' fps, >50ms ' + r.long + ', worst ' + r.worst + 'ms, imgStall ' + r.stall +
        ', steps ' + (extra.steps || 0) + ', ' + r.ms + 'ms, heap ' + mb(extra.heap) + ', dom ' + (extra.dom || 0);
    },
    /* P7 27.10.: Arbeit je Fokusschritt (Ersatzmass, wo FPS nichts sagen, z. B. Desktop): w = Summen ueber den Lauf, steps = Tasten.
     * js = Tastenhandler, async = Timer/rAF danach, sl = Stil+Layout (erzwungen nach jedem Handler), mut = DOM-Aenderungen
     * (cls Klasse, sty style-Attribut, txt Text, src Bildquelle, node Knoten), srcRep = Bildzuweisungen waehrend der Tastenfolge,
     * key = Tastenhandler inkl. Stil+Layout (= Arbeit im Frame der Taste), mutKey = DOM-Aenderungen im Tastenhandler je Schritt, mutMax = meiste Aenderungen in einem Rueckruf, maxTask = teuerster einzelne Rueckruf (Handler bzw. Timer/rAF inkl. Stil+Layout) ~ laengster Frame */
    workLine: function (w, steps) {
      var n = Math.max(1, steps), f = function (v) { return Math.round(v * 100 / n) / 100; };
      return ' | work/step: key ' + f(w.key) + 'ms (max ' + Math.round(w.keyMax * 10) / 10 + '), js ' + f(w.js) + 'ms, async ' + f(w.async) + 'ms, style+layout ' + f(w.sl) + 'ms, mut ' + f(w.mut) +
        ' (cls ' + f(w.cls) + ', style ' + f(w.sty) + ', text ' + f(w.txt) + ', src ' + f(w.src) + ', nodes ' + f(w.node) + '), srcRep ' + f(w.srcRep) +
        ', maxTask ' + Math.round(w.maxTask * 10) / 10 + 'ms, mutKey ' + f(w.mutKey || 0) + ', mutMax ' + (w.mutMax || 0);
    },
    /* a, b: {dom, evt, iv, to, img:{queued, active, cached}, heap, depth}; cycles: Anzahl Durchlaeufe -> {ok, line} */
    leaks: function (a, b, cycles) {
      var bad = [], d = function (k) { return (b[k] || 0) - (a[k] || 0); };
      if (d('dom') > 50) bad.push('DOM +' + d('dom'));
      if (d('evt') > 0) bad.push('Ereignis-Hoerer +' + d('evt'));
      if (d('iv') > 0) bad.push('Intervalle +' + d('iv'));
      if (d('to') > 3) bad.push('Timer +' + d('to'));
      if (b.img && b.img.cached > 400) bad.push('Bild-LRU ' + b.img.cached + ' > 400');
      if (b.img && b.img.active < 0) bad.push('Bild-Downloads negativ');
      if (a.heap > 0 && b.heap - a.heap > 8 * 1048576) bad.push('Heap +' + mb(b.heap - a.heap));
      if (d('depth') !== 0) bad.push('Stapel ' + a.depth + '->' + b.depth);
      var line = 'bench leak (' + cycles + ' Runden): dom ' + a.dom + '->' + b.dom + ', evt ' + a.evt + '->' + b.evt + ', intervals ' + a.iv + '->' + b.iv +
        ', timeouts ' + a.to + '->' + b.to + ', img lru ' + (b.img ? b.img.cached : '?') + '/400 queued ' + (b.img ? b.img.queued : '?') +
        ', heap ' + mb(a.heap) + '->' + mb(b.heap) + ' => ' + (bad.length ? 'VERDACHT: ' + bad.join('; ') : 'ok');
      return { ok: !bad.length, line: line, bad: bad };
    }
  };
  N.benchMath = BM;
})(N);
