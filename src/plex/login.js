/* N.LoginFlow – Zustandsmaschine der Code-Anmeldung (SPEC 7.1), ohne DOM, testbar.
 * deps: {api:{createPin(cb), checkPin(id, cb)}, timers:{set(fn,ms), clear(t)}, now(), onChange(state)}
 * Zustaende: idle -> requesting -> waiting(code, expiresAt) -> authorized(token) | error(kind)
 * Ablauf des Codes => automatisch neuer Code (state.renewed = true -> Statuszeile "Neuer Code erstellt."). */
(function (N) {
  var POLL = 2000, MAX_POLL_FAILS = 8;
  function LoginFlow(deps) {
    this.d = deps;
    this.state = { name: 'idle' };
    this.pollT = 0; this.task = null; this.gen = 0; this.fails = 0; this.pin = null;
  }
  LoginFlow.prototype._set = function (s) { this.state = s; if (this.d.onChange) this.d.onChange(s); };
  LoginFlow.prototype.start = function (renewed) {
    var self = this, gen = ++this.gen;
    this._stopTimers();
    this.fails = 0;
    this._set({ name: 'requesting', renewed: !!renewed });
    this.task = this.d.api.createPin(function (err, pin) {
      self.task = null;
      if (gen !== self.gen) return;
      if (err) { self._set({ name: 'error', kind: err.type === 'http' && err.status < 500 && err.status !== 502 ? 'plex' : 'proxy', err: err }); return; }
      self.pin = pin;
      self._set({ name: 'waiting', code: pin.code, expiresAt: self.d.now() + pin.expiresIn * 1000, renewed: !!renewed });
      self._schedule(gen);
    });
  };
  LoginFlow.prototype._schedule = function (gen) {
    var self = this;
    this.pollT = this.d.timers.set(function () { self.pollT = 0; self._poll(gen); }, POLL);
  };
  LoginFlow.prototype._poll = function (gen) {
    var self = this;
    if (gen !== this.gen || this.state.name !== 'waiting') return;
    if (this.d.now() >= this.state.expiresAt) { this.start(true); return; }
    this.task = this.d.api.checkPin(this.pin.id, function (err, token) {
      self.task = null;
      if (gen !== self.gen) return;
      if (err) {
        // 404 = Code abgelaufen/entfernt -> neuer Code; sonst kurz weiter versuchen
        if (err.type === 'http' && err.status === 404) { self.start(true); return; }
        if (++self.fails >= MAX_POLL_FAILS) { self._set({ name: 'error', kind: 'proxy', err: err }); return; }
      } else self.fails = 0;
      if (token) { self._set({ name: 'authorized', token: token }); return; }
      self._schedule(gen);
    });
  };
  LoginFlow.prototype.secondsLeft = function () {
    if (this.state.name !== 'waiting') return 0;
    return Math.max(0, Math.ceil((this.state.expiresAt - this.d.now()) / 1000));
  };
  LoginFlow.prototype.newCode = function () { this.start(true); };
  LoginFlow.prototype._stopTimers = function () {
    if (this.pollT) { this.d.timers.clear(this.pollT); this.pollT = 0; }
    if (this.task && this.task.abort) { this.task.abort(); this.task = null; }
  };
  LoginFlow.prototype.stop = function () { this.gen++; this._stopTimers(); };
  N.LoginFlow = LoginFlow;
})(N);
