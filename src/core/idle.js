/* N.idle – Nacharbeit nach Tasten (SPEC 14.5): Aufgaben laufen 160 ms nach der letzten Taste,
 * dann in rAF-Haeppchen von max. 6 ms. Gleicher Schluessel ersetzt eine wartende Aufgabe. */
(function (N) {
  var U = N.util, queue = [], timer = 0, lastKey = 0, running = false;
  var DELAY = 160, SLICE = 6;
  /* Ruhezeit seit der letzten Taste. Die TV-Uhr (Date) kann zurueckspringen (Orsay stellt sie nach, s. core/clock.js): dann laege
   * lastKey in der Zukunft, die Ruhe waere negativ und alles, was auf Ruhe wartet (Bildlader, Idle-Aufgaben, Startseiten-Antwort),
   * stuende so lange still, wie der Sprung gross war (Nutzerbefund 30.10.: nach App-Neustart 15 s keine einzige Bildanfrage,
   * PMS-Protokoll). Bei einem Ruecksprung zaehlt die Ruhe deshalb ab jetzt neu; der Sprung kommt ins Protokoll. */
  function rest() {
    var n = U.now();
    if (n < lastKey) {
      if (N.diag && lastKey - n > 1000) N.diag.log('warn', 'clock jump ' + (n - lastKey) + ' ms');
      lastKey = n;
    }
    return n - lastKey;
  }
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, DELAY);
  }
  function run() {
    timer = 0;
    if (rest() < DELAY) { schedule(); return; }
    if (running) return;
    running = true;
    U.raf(slice);
  }
  function slice() {
    var t0 = U.now();
    while (queue.length && U.now() - t0 < SLICE) {
      if (rest() < DELAY) { running = false; schedule(); return; }   // neue Taste: abbrechen, spaeter weiter
      var job = queue.shift();
      try { job.fn(); } catch (e) { if (N.diag) N.diag.error('idle ' + (job.key || ''), e); }
    }
    if (queue.length) U.raf(slice); else running = false;
  }
  N.idle = {
    touch: function () { lastKey = U.now(); if (queue.length) schedule(); },
    lastKey: function () { return lastKey; },
    restFor: rest,
    add: function (fn, key) {
      if (key) for (var i = 0; i < queue.length; i++) if (queue[i].key === key) { queue[i].fn = fn; schedule(); return; }
      queue.push({ fn: fn, key: key || null });
      schedule();
    },
    cancel: function (key) { for (var i = queue.length - 1; i >= 0; i--) if (queue[i].key === key) queue.splice(i, 1); },
    clear: function () { queue = []; }
  };
})(N);
