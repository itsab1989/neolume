/* N.SeekAcc – Sprung-Sammelfenster (SPEC 7.10, TECH-R5): wiederholte ◀▶/◀◀▶▶ sammeln ein Ziel, das sofort auf dem Balken steht
 * ("+2:30 → 41:12"); EIN Sprung 600 ms nach dem letzten Druck. Halten beschleunigt (nach 1 s x3, nach 3 s x6).
 * timers: {now, set, clear} (Tests: kuenstliche Zeit). onCommit(targetMs, deltaMs). */
(function (N) {
  var GAP = 450;
  function SeekAcc(onCommit, timers, delay) {
    this.on = onCommit; this.T = timers; this.delay = delay || 600;
    this.base = -1; this.target = -1; this.t = 0; this.first = 0; this.lastP = 0;
  }
  var P = SeekAcc.prototype;
  P.active = function () { return this.base >= 0; };
  P.clamp = function (v, dur) { var hi = dur > 0 ? Math.max(0, dur - 5000) : v; return v < 0 ? 0 : v > hi ? hi : v; };
  /* Schritt (ms, negativ = zurueck); accel: Pfeiltasten beschleunigen beim Halten */
  P.press = function (step, cur, dur, accel) {
    var now = this.T.now();
    if (this.base < 0) { this.base = cur; this.target = cur; this.first = now; }
    else if (now - this.lastP > GAP) this.first = now;
    this.lastP = now;
    var held = now - this.first, mul = accel ? (held >= 3000 ? 6 : held >= 1000 ? 3 : 1) : 1;
    this.target = this.clamp(this.target + step * mul, dur);
    this.arm();
    return this.state();
  };
  /* absolutes Ziel (Ziffern, Zeiger-Klick): sofort oder ueber das Fenster */
  P.set = function (abs, cur, dur, now) {
    if (this.base < 0) this.base = cur;
    this.target = this.clamp(abs, dur);
    if (now) { this.commit(); return { target: abs, delta: 0 }; }
    this.arm();
    return this.state();
  };
  P.state = function () { return { target: this.target, delta: this.target - this.base }; };
  P.arm = function () {
    var self = this;
    if (this.t) this.T.clear(this.t);
    this.t = this.T.set(function () { self.t = 0; self.commit(); }, this.delay);
  };
  P.commit = function () {
    if (this.t) { this.T.clear(this.t); this.t = 0; }
    if (this.base < 0) return;
    var tg = this.target, d = tg - this.base;
    this.base = -1; this.target = -1;
    this.on(tg, d);
  };
  P.cancel = function () { if (this.t) this.T.clear(this.t); this.t = 0; this.base = -1; this.target = -1; };
  N.SeekAcc = SeekAcc;
})(N);
