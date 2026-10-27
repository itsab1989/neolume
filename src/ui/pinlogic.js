/* N.PinLogic – PIN-Eingabe ohne DOM (SPEC 5.16): 4 Ziffern, Auto-Pruefung, falsche PIN -> Punkte rot bis zur naechsten Eingabe,
 * 5 Fehlversuche -> 30 s Sperre mit Countdown. Die PIN wird nie gespeichert.
 * Fehlversuche und Sperre liegen je o.key (Profil-uuid) im Speicher AUSSERHALB des Dialogs -> Schliessen/Neu-Oeffnen setzt sie
 * nicht zurueck. Nach destroy() (Abbrechen waehrend der Pruefung) wird ein spaetes Ergebnis verworfen (zaehlt aber als Fehlversuch).
 * o: {key, verify(pin, cb(ok, err)), timers:{set,clear}, now(), onChange(state), onSuccess(pin)} */
(function (N) {
  var LOCKS = {};
  function PinLogic(o) {
    this.o = o; this.len = o.length || 4; this.maxTries = o.maxTries || 5; this.lockMs = o.lockMs || 30000;
    this.m = o.key ? (LOCKS[o.key] = LOCKS[o.key] || { tries: 0, lockedUntil: 0 }) : { tries: 0, lockedUntil: 0 };
    this.s = { digits: '', wrong: false, busy: false, tries: this.m.tries, lockedUntil: this.m.lockedUntil, lockLeft: 0, error: null, ok: false };
    this.tick = 0; this.dead = false;
    if (this.s.lockedUntil && this.locked()) this._countdown(); else this.s.lockedUntil = 0;
  }
  PinLogic.prototype._sync = function () { this.m.tries = this.s.tries; this.m.lockedUntil = this.s.lockedUntil; };
  /* Fehlversuch zaehlen (auch nach destroy) */
  PinLogic.prototype._fail = function () {
    var s = this.s, m = this.m;
    if (this.dead) {                                  // Dialog zu: nur die gemeinsame Zaehlung fortschreiben
      m.tries++;
      if (m.tries >= this.maxTries) { m.lockedUntil = this.o.now() + this.lockMs; m.tries = 0; }
      return;
    }
    s.wrong = true; s.tries++;
    if (s.tries >= this.maxTries) { s.lockedUntil = this.o.now() + this.lockMs; s.tries = 0; this._sync(); this._countdown(); }
    else this._sync();
  };
  PinLogic.prototype._emit = function () { if (this.o.onChange) this.o.onChange(this.s); };
  PinLogic.prototype.locked = function () { return this.s.lockedUntil > this.o.now(); };
  PinLogic.prototype.input = function (d) {
    var s = this.s;
    if (s.busy || s.ok || this.locked()) return;
    if (s.wrong || s.error) { s.digits = ''; s.wrong = false; s.error = null; }
    if (s.digits.length >= this.len) return;
    s.digits += d;
    this._emit();
    if (s.digits.length === this.len) this.submit();
  };
  PinLogic.prototype.del = function () {
    var s = this.s;
    if (s.busy || s.ok || this.locked()) return;
    if (s.wrong || s.error) { s.digits = ''; s.wrong = false; s.error = null; }
    else s.digits = s.digits.substring(0, s.digits.length - 1);
    this._emit();
  };
  PinLogic.prototype.submit = function () {
    var self = this, s = this.s;
    if (s.busy || s.ok || this.locked() || s.digits.length !== this.len) return;
    s.busy = true; this._emit();
    var pin = s.digits;
    this.o.verify(pin, function (ok, err) {
      if (!ok && (!err || err.wrongPin)) { self._fail(); if (self.dead) return; }
      if (self.dead) return;                          // abgebrochen: Ergebnis verwerfen (kein Profilwechsel)
      s.busy = false;
      if (ok) { s.ok = true; s.tries = 0; self._sync(); self._emit(); if (self.o.onSuccess) self.o.onSuccess(pin); return; }
      if (err && !err.wrongPin) { s.error = err; self._emit(); return; }      // Netz, abgelaufene Anmeldung o. ae.: kein Fehlversuch
      self._emit();
    });
  };
  PinLogic.prototype._countdown = function () {
    var self = this, s = this.s;
    s.lockLeft = Math.ceil((s.lockedUntil - this.o.now()) / 1000);
    if (s.lockLeft <= 0) { s.lockLeft = 0; s.lockedUntil = 0; s.wrong = false; s.digits = ''; this._sync(); this._emit(); return; }
    this.tick = this.o.timers.set(function () { self._countdown(); self._emit(); }, 1000);
  };
  PinLogic.prototype.destroy = function () { this.dead = true; if (this.tick) this.o.timers.clear(this.tick); this.tick = 0; };
  PinLogic._locks = LOCKS;                            // Tests
  N.PinLogic = PinLogic;
})(N);
