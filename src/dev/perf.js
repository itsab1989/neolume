/* N.devperf – nur wenn ctx.source mit 'dev' beginnt (nie im Release):
 * - INFO,INFO (innerhalb 350 ms) blendet ein FPS-Overlay ein/aus; einzelnes INFO wird um 350 ms verzoegert weitergereicht.
 * - TOOLS,TOOLS schaltet die Zeiger-Darstellung A -> B -> System (Test am TV).
 * - Jede Folge von Fokusschritten wird gemessen (rAF nur waehrend der Folge) und per ctx.log protokolliert.
 * - P7: Messlauf N.devbench (dev/bench.js) – Ziffern 9,8,7 oder window.PN_BENCH. */
(function (N) {
  var U = N.util, on = false, el = null, txt = null, pend = {}, WIN = 350;
  var meas = null, stopT = 0, live = null;
  function raf(fn) { return U.raf(fn); }
  function startBurst() {
    if (meas) return;
    meas = { t0: U.now(), last: U.now(), frames: 0, long: 0, worst: 0, steps: 0 };
    var m = meas;
    (function tick() {
      if (meas !== m) return;
      var t = U.now(), d = t - m.last;
      if (m.frames && d > 50) m.long++;
      if (m.frames && d > m.worst) m.worst = d;
      m.frames++; m.last = t;
      raf(tick);
    })();
  }
  function endBurst() {
    stopT = 0;
    var m = meas; meas = null;
    if (!m) return;
    var ms = Math.max(1, m.last - m.t0), fps = Math.round(m.frames * 10000 / ms) / 10;
    var msg = 'fps nav: ' + fps + ' fps, >50ms: ' + m.long + ', worst ' + m.worst + 'ms, steps ' + m.steps + ', ' + ms + 'ms';
    N.log(msg);
    if (on) U.setText(txt, msg);
  }
  function toggle() {
    on = !on;
    U.show(el, on);
    U.setText(txt, on ? 'FPS: Fokusschritte ausfuehren …' : '');
    N.log('dev fps overlay ' + (on ? 'an' : 'aus'));
  }
  var D = {
    enabled: false,
    init: function (parent, ctx) {
      D.enabled = /^dev/.test(String(ctx && ctx.source || ''));
      if (!D.enabled) return;
      el = U.el('div', '', parent, 'display:none'); el.id = 'pn-dev';
      txt = U.txt('div', '', el, '');
      if (N.devbench) N.devbench.init();             // P7: Messlauf (window.PN_BENCH / Ziffern 9,8,7)
    },
    /* true = Taste verbraucht */
    key: function (k) {
      if (!D.enabled) return false;
      if (N.devbench && N.devbench.key(k)) return true;
      if (k === 'INFO' || k === 'TOOLS') {
        if (pend[k]) {
          clearTimeout(pend[k]); pend[k] = 0;
          if (k === 'INFO') toggle();
          else { var m = N.pointer.cycleCursor(); N.ui.toast.show('Zeiger-Darstellung: ' + m); N.log('dev cursor mode ' + m); }
          return true;
        }
        pend[k] = setTimeout(function () { pend[k] = 0; N.router.key(k); }, WIN);
        return true;
      }
      if (N.keys.isNav(k)) {
        startBurst();
        meas.steps++;
        if (stopT) clearTimeout(stopT);
        stopT = setTimeout(endBurst, 500);
      }
      return false;
    }
  };
  N.devperf = D;
})(N);
