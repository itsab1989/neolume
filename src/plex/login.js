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

  /* N.WebLoginFlow – Anmeldung direkt am Geraet (caps.webLogin, z. B. iPad/iPhone/Mac): starke PIN anlegen, offizielle
   * Plex-Anmeldeseite im System-Anmeldefenster oeffnen (deps.web, in der Ansicht die Plattform-Funktion auth.web), PIN im Hintergrund abfragen wie LoginFlow;
   * sobald authToken da ist, Fenster schliessen. Das Passwort sieht die App nie.
   * deps: {api:{createPin(cb, strong), checkPin(id, cb), webUrl(code)}, web:{open(url, cb(err, {reason})), close()}, timers, now, onChange}
   * Zustaende: idle(notice: ''|'cancelled'|'expired'|'failed') -> requesting -> open(expiresAt) -> authorized(token) | error(kind) */
  function WebLoginFlow(deps) {
    this.d = deps;
    this.state = { name: 'idle', notice: '' };
    this.pollT = 0; this.task = null; this.gen = 0; this.fails = 0; this.pin = null; this.winOpen = false;
  }
  WebLoginFlow.prototype._set = LoginFlow.prototype._set;
  WebLoginFlow.prototype._stopTimers = LoginFlow.prototype._stopTimers;
  WebLoginFlow.prototype._schedule = LoginFlow.prototype._schedule;
  WebLoginFlow.prototype._closeWin = function () { if (this.winOpen) { this.winOpen = false; this.d.web.close(); } };
  WebLoginFlow.prototype._end = function (s) { this._stopTimers(); this._closeWin(); this._set(s); };
  WebLoginFlow.prototype.start = function () {
    var self = this, gen = ++this.gen;
    this._stopTimers();
    this._closeWin();
    this.fails = 0;
    this._set({ name: 'requesting' });
    this.task = this.d.api.createPin(function (err, pin) {
      self.task = null;
      if (gen !== self.gen) return;
      if (err) { self._set({ name: 'error', kind: err.type === 'http' && err.status < 500 && err.status !== 502 ? 'plex' : 'proxy', err: err }); return; }
      self.pin = pin;
      self._set({ name: 'open', expiresAt: self.d.now() + pin.expiresIn * 1000 });
      self.winOpen = true;
      // Wirft die Plattform (Bruecke fehlt o. ae.), sichtbar enden statt mit ewigem Ladekreis (iPad 02.11., Nr. 15)
      try { self._open(gen); } catch (ex) { self.winOpen = false; self._end({ name: 'idle', notice: 'failed', code: 'exception' }); return; }
      self._schedule(gen);
    }, true);
  };
  WebLoginFlow.prototype._open = function (gen) {
    var self = this;
    this.d.web.open(this.d.api.webUrl(this.pin.code), function (e, data) {
      if (gen !== self.gen) return;
      self.winOpen = false;
      if (self.state.name !== 'open') return;                           // schon angemeldet/abgelaufen (Fenster von uns zu)
      if (e) { self._end({ name: 'idle', notice: 'failed', code: e.code || '' }); return; }
      if (data && data.reason === 'closed') return;
      // Nutzer hat das Fenster geschlossen: einmal sofort nachsehen (Anmeldung kann kurz vorher fertig geworden sein)
      self._stopTimers();
      self._poll(gen, true);
    });
  };
  WebLoginFlow.prototype._poll = function (gen, last) {
    var self = this;
    if (gen !== this.gen || this.state.name !== 'open') return;
    if (this.d.now() >= this.state.expiresAt) { this._end({ name: 'idle', notice: 'expired' }); return; }
    this.task = this.d.api.checkPin(this.pin.id, function (err, token) {
      self.task = null;
      if (gen !== self.gen || self.state.name !== 'open') return;
      if (token) { self._end({ name: 'authorized', token: token }); return; }
      if (err && err.type === 'http' && err.status === 404) { self._end({ name: 'idle', notice: 'expired' }); return; }
      if (last) { self._end({ name: 'idle', notice: 'cancelled' }); return; }
      if (err) { if (++self.fails >= MAX_POLL_FAILS) { self._end({ name: 'error', kind: 'proxy', err: err }); return; } }
      else self.fails = 0;
      self._schedule(gen);
    });
  };
  WebLoginFlow.prototype.stop = function () { this.gen++; this._stopTimers(); this._closeWin(); };
  N.WebLoginFlow = WebLoginFlow;
})(N);
