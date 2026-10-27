/* N.idle – Nacharbeit nach Tasten (SPEC 14.5): Aufgaben laufen 160 ms nach der letzten Taste,
 * dann in rAF-Haeppchen von max. 6 ms. Gleicher Schluessel ersetzt eine wartende Aufgabe. */
(function (N) {
  var U = N.util, queue = [], timer = 0, lastKey = 0, running = false;
  var DELAY = 160, SLICE = 6;
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, DELAY);
  }
  function run() {
    timer = 0;
    if (U.now() - lastKey < DELAY) { schedule(); return; }
    if (running) return;
    running = true;
    U.raf(slice);
  }
  function slice() {
    var t0 = U.now();
    while (queue.length && U.now() - t0 < SLICE) {
      if (U.now() - lastKey < DELAY) { running = false; schedule(); return; }   // neue Taste: abbrechen, spaeter weiter
      var job = queue.shift();
      try { job.fn(); } catch (e) { if (N.diag) N.diag.error('idle ' + (job.key || ''), e); }
    }
    if (queue.length) U.raf(slice); else running = false;
  }
  N.idle = {
    touch: function () { lastKey = U.now(); if (queue.length) schedule(); },
    lastKey: function () { return lastKey; },
    restFor: function () { return U.now() - lastKey; },
    add: function (fn, key) {
      if (key) for (var i = 0; i < queue.length; i++) if (queue[i].key === key) { queue[i].fn = fn; schedule(); return; }
      queue.push({ fn: fn, key: key || null });
      schedule();
    },
    cancel: function (key) { for (var i = queue.length - 1; i >= 0; i--) if (queue[i].key === key) queue.splice(i, 1); },
    clear: function () { queue = []; }
  };
})(N);
