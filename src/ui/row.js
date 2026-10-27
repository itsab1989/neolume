/* N.ui.Row – virtualisierte Reihe mit festem Element-Pool (SPEC 5.1–5.4, 14.6).
 * - Karten werden EINMAL erzeugt (Pool 11), Positionierung per style.left = i*step, Scroll per translate3d am Streifen.
 * - Pro Fokusschritt: nur alte + neue Karte (und deren Beschriftung) umklassen, 1 Transform am Streifen,
 *   Recycling nur der Karten, die das Fenster verlassen (meist 1), Bilder ueber den Bildlader (pausiert bei Wiederholung).
 * - Beschriftung ist Geschwister der Karte (nicht skaliert). Kein innerHTML, kein z-index.
 * - P7 27.10.: im Fokusschritt nur SICHTBARE Karten befuellen, Puffer-Karten (ausserhalb des Clips) im naechsten Frame in Haeppchen
 *   (CHUNK); setModel(.., mode 2) befuellt eine verdeckte Reihe ganz in Haeppchen (Startseite: Reihe R+2). Freie Karten bleiben bis
 *   zur Wiederverwendung stehen (kein display-Wechsel), Position/Abzeichen/Fortschritt nur bei Aenderung schreiben. */
(function (N) {
  var U = N.util, R = N.RowMath, M = N.model;
  var POOL = 11, HEAD_H = 52;

  function Row(parent, opts) {
    this.opts = opts || {};
    this.el = U.el('div', 'hrow', parent);
    var head = this.head = U.el('div', 'row-head', this.el);
    if (this.opts.noHead) head.style.display = 'none';         // Folgenreihe der Seriendetails: Tab-Zeile ist der Kopf
    this.headT = document.createTextNode('');
    head.appendChild(this.headT);
    this.cntT = U.txt('span', 'cnt', head, '');
    this.clip = U.el('div', 'rclip', this.el);          // schneidet links an der Inhaltskante ab (Karten nicht unter der Rail)
    this.strip = U.el('div', 'strip', this.clip);
    this.pool = [];
    for (var i = 0; i < POOL; i++) this.pool.push(this._make());
    this.model = null; this.g = R.geom('land'); this.f = 0; this.sc = 0; this.byIdx = {}; this.focused = false; this.top = 0; this.kind = ''; this.pend = false;
  }

  Row.prototype._make = function () {
    var e = {}, s = this.strip;
    e.card = U.el('div', 'card card-land', s, 'display:none');
    e.ph = U.txt('div', 'ph', e.card, '');
    e.img = U.el('img', '', e.card);
    e.img.src = N.img.BLANK;
    e.badge = U.el('div', 'bdg', e.card);
    e.badgeT = document.createTextNode('');
    e.badge.appendChild(e.badgeT);
    e.prog = U.el('div', 'prog', e.card);
    e.progI = U.el('i', '', e.prog);
    e.cap = U.el('div', 'cap cap-land', s, 'display:none');
    e.t1 = U.txt('div', 't1', e.cap, '');
    e.t2 = U.txt('div', 't2', e.cap, '');
    e.idx = -1; e.kind = ''; e.base = 'card card-land'; e.capBase = 'cap cap-land'; e.on = false; e.foc = false; e.x = null; e.bc = 'bdg'; e.pw = -1; e.capOn = false;
    return e;
  };

  Row.prototype.setTop = function (y) { if (y !== this.top) { this.top = y; this.el.style.top = y + 'px'; } };
  Row.prototype.cardY = function () { return this.top + HEAD_H; };
  Row.prototype.count = function () { return this.model ? this.model.items.length : 0; };
  Row.prototype.item = function (i) { return this.model ? this.model.items[i] : null; };
  Row.prototype.showCaptions = function () { return this.opts.captions ? this.opts.captions(this.g.kind) : true; };

  /* neues Modell (Reihe recycelt oder erstmals befuellt); f = gemerkte Spalte; mode: siehe render (Standard 0 = alles sofort) */
  Row.prototype.setModel = function (model, f, mode) {
    var i;
    this.model = model;
    this.g = R.geom(model ? model.kind : 'land');
    this.kind = this.g.kind;          // perf2: Kartenklasse/-groesse erst beim Befuellen je Karte (_fill), nicht fuer alle 11 auf einmal
    // freigeben ohne zu verstecken: Karten werden im selben Aufruf (mode 0) bzw. in Haeppchen (mode 2) wiederverwendet –
    // kein display-Wechsel; Karten an einer Position, die neu gebraucht wird, nehmen genau diese (render: byX)
    for (i = 0; i < POOL; i++) { if (model) this._release(this.pool[i]); else this._free(this.pool[i]); }
    this.byIdx = {};
    this.f = model ? U.clamp(f || 0, 0, Math.max(0, model.items.length - 1)) : 0;
    this.sc = R.scroll(this.count(), this.f, this.g.full);
    this.relabel();
    this._jumpStrip();
    this.render(1, mode || 0);
  };
  Row.prototype.relabel = function () {
    if (!this.model || this.opts.noHead) { U.setText(this.headT, ''); U.setText(this.cntT, ''); return; }
    U.setText(this.headT, N.hubs.rowTitle(this.model));
    U.setText(this.cntT, this.model.kind === 'land' ? String(this.model.items.length) : '');
  };
  Row.prototype._scrollX = function () { return -this.sc * this.g.step; };
  Row.prototype._jumpStrip = function () {
    var s = this.strip;
    s.style.webkitTransition = 'none';
    U.tf(s, this._scrollX(), 0);
    setTimeout(function () { s.style.webkitTransition = ''; }, 60);
  };
  Row.prototype._free = function (e) { this._release(e); this._hide(e); };
  /* Karte verlaesst das Fenster: bleibt (ausserhalb des Clips) stehen, bis sie wiederverwendet oder am Ende versteckt wird */
  Row.prototype._release = function (e) {
    if (e.idx >= 0) { if (this.byIdx[e.idx] === e) delete this.byIdx[e.idx]; e.idx = -1; }
    N.img.drop(e.img, true);
    if (e.foc) { e.card.className = e.base; e.cap.className = e.capBase; e.foc = false; }
  };
  Row.prototype._hide = function (e) {
    if (e.on && e.idx < 0) { e.card.style.display = 'none'; e.on = false; N.img.drop(e.img); }
    if (e.capOn && e.idx < 0) { e.cap.style.display = 'none'; e.capOn = false; }
  };
  Row.prototype._fill = function (e, i, prio) {
    var it = this.model.items[i], g = this.g, x = i * g.step + 'px', land = g.kind === 'land', tier = g.tier || (land ? 'land' : g.kind === 'cast' ? 'cast' : 'poster');
    if (e.idx >= 0 && e.idx !== i && this.byIdx[e.idx] === e) delete this.byIdx[e.idx];
    e.idx = i; this.byIdx[i] = e;
    if (e.kind !== this.kind) {         // Reihe hat die Art gewechselt (land/poster/cast/sq): Groesse nur fuer diese Karte umstellen
      e.kind = this.kind; e.base = 'card card-' + e.kind; e.capBase = 'cap cap-' + e.kind;
      e.card.className = e.base; e.cap.className = e.capBase; e.foc = false;
      e.cap.style.top = g.capY + 'px';
    }
    if (e.x !== x) { e.x = x; e.card.style.left = x; e.cap.style.left = x; }
    var src = land ? it.still : it.thumb;
    U.setText(e.ph, it.title);
    N.img.want(e.img, src ? N.img.url(src, tier) : '', prio);
    var b = M.badge(it), bc = b.b ? 'bdg ' + b.b : 'bdg';
    if (e.bc !== bc) { e.bc = bc; e.badge.className = bc; }
    U.setText(e.badgeT, b.n);
    var p = M.progress(it), pw = p > 0 ? Math.max(4, Math.round((g.w - 20) * p)) : -1;
    if (pw !== e.pw) {
      if (pw < 0) e.prog.style.display = 'none';
      else { if (e.pw < 0) e.prog.style.display = 'block'; e.progI.style.width = pw + 'px'; }
      e.pw = pw;
    }
    if (this.showCaptions()) {
      var c = this.opts.caption ? this.opts.caption(it) : it.type === 'person' ? [it.title, it.role] : land ? M.landCaption(it) : M.posterCaption(it);
      U.setText(e.t1, c[0]); U.setText(e.t2, c[1]);
    }
    if (!e.on) { e.card.style.display = ''; e.on = true; }
    var co = this.showCaptions();
    if (e.capOn !== co) { e.cap.style.display = co ? '' : 'none'; e.capOn = co; }
    var foc = this.focused && i === this.f;
    if (foc !== e.foc) { e.card.className = foc ? e.base + ' is-focus' : e.base; e.cap.className = foc ? e.capBase + ' is-focus' : e.capBase; e.foc = foc; }
  };
  /* Fenster herstellen (fehlende Karten fuellen). prio: 0 sichtbar, 1 Puffer, 2 Vorladen (undefined = sichtbar 0, Puffer 1).
   * mode 0 = alles sofort; 1 = sichtbare sofort, Puffer im naechsten Frame; 2 = Haeppchen zu CHUNK Karten (sichtbare zuerst) */
  Row.prototype.render = function (prio, mode) {
    if (!this.model) return;
    var n = this.count(), w = R.win(n, this.sc, POOL), i, e, free = [], todo = [], nv;
    for (i = 0; i < POOL; i++) { e = this.pool[i]; if (e.idx < w.first || e.idx > w.last) { if (e.idx >= 0) this._release(e); free.push(e); } }
    var sc = this.sc, v1 = Math.min(w.last, sc + this.g.visible - 1);
    for (i = Math.max(w.first, sc); i <= v1; i++) if (!this.byIdx[i]) todo.push(i);
    nv = todo.length;
    for (i = w.first; i <= w.last; i++) if (!this.byIdx[i] && (i < sc || i > v1)) todo.push(i);
    var budget = !mode ? todo.length : mode === 1 ? nv : chunk(), byX = {}, need = {}, step = this.g.step;
    for (i = 0; i < todo.length; i++) need[todo[i] * step + 'px'] = 1;
    for (i = 0; i < free.length; i++) { e = free[i]; if (e.on && need[e.x]) byX[e.x] = e; }
    for (i = 0; i < todo.length && i < budget; i++) {
      e = byX[todo[i] * step + 'px'];                   // steht schon an dieser Stelle (nach setModel) -> genau die nehmen
      if (!e) for (var k = 0; k < free.length; k++) if (!free[k].on || !need[free[k].x] || byX[free[k].x] !== free[k]) { e = free[k]; break; }
      if (!e) e = free[0];
      if (!e) break;
      free.splice(free.indexOf(e), 1);
      if (byX[e.x] === e) delete byX[e.x];
      var vis = i < nv;
      this._fill(e, todo[i], prio === undefined ? (vis ? 0 : 1) : Math.max(prio, vis ? prio : prio + 1));
    }
    if (i < todo.length && free.length) { this._later(prio); return; }
    for (i = 0; i < free.length; i++) this._hide(free[i]);
  };
  Row.prototype._later = function (prio) {
    if (this.pend) return;
    var self = this;
    this.pend = true;
    U.raf(function () { self.pend = false; self.render(prio, 2); });     // idempotent: stellt das aktuelle Fenster her
  };
  /* Bildprioritaet der sichtbaren Karten anheben (z. B. wenn die Reihe fokussiert wird) */
  Row.prototype.boost = function () {
    var sc = this.sc;
    for (var i = sc; i < sc + this.g.visible; i++) {
      var e = this.byIdx[i], it = this.item(i);
      if (!e || !it) continue;
      var src = this.g.kind === 'land' ? it.still : it.thumb;
      if (src) N.img.want(e.img, N.img.url(src, this.g.tier || (this.g.kind === 'land' ? 'land' : this.g.kind === 'cast' ? 'cast' : 'poster')), 0);
    }
  };
  /* Fokus per Taste (Anker-Regel) */
  Row.prototype.focusCol = function (f) {
    var n = this.count();
    if (!n) return null;
    f = U.clamp(f, 0, n - 1);
    return this.focusTo(f, R.scroll(n, f, this.g.full));
  };
  /* Fokus per Zeiger: Scroll bleibt stehen */
  Row.prototype.hoverCol = function (i) { return this.focusTo(i, this.sc); };
  /* Zeiger-Pfeile: um eine Bildschirmbreite blaettern */
  Row.prototype.page = function (dir) { var p = R.page(this.count(), this.f, this.sc, this.g.full, dir); return this.focusTo(p.f, p.sc); };
  Row.prototype.canPage = function (dir) { return dir < 0 ? this.sc > 0 : this.sc < R.maxScroll(this.count(), this.g.full); };
  Row.prototype.hit = function (x) { return R.hit(this.count(), this.sc, this.g, x); };
  /* gemeinsamer Fokusschritt: nur alte + neue Karte, 1 Transform am Streifen. Rueckgabe: Ringziel */
  Row.prototype.focusTo = function (f, sc) {
    var n = this.count();
    if (!n) return null;
    var old = this.byIdx[this.f];
    var oldScroll = this._scrollX();
    this.f = f; this.sc = sc;
    this.render(undefined, 1);                         // Recycling: nur sichtbare sofort, Puffer im naechsten Frame
    var cur = this.byIdx[f];
    if (this.focused) {
      if (old && old !== cur && old.foc) { old.card.className = old.base; old.cap.className = old.capBase; old.foc = false; }
      if (cur && !cur.foc) { cur.card.className = cur.base + ' is-focus'; cur.cap.className = cur.capBase + ' is-focus'; cur.foc = true; }
    }
    var sx = this._scrollX();
    if (sx !== oldScroll) { N.fx.move(this.strip); U.tf(this.strip, sx, 0); }
    if (cur) { N.fx.move(cur.card); if (old && old !== cur) N.fx.move(old.card); }
    return this.ringPos();
  };
  Row.prototype.ringPos = function () {
    return { x: R.x(this.f, this.sc, this.g), y: this.cardY(), shape: this.g.kind };
  };
  /* Reihe bekommt/verliert den Fokus (vertikaler Wechsel) */
  Row.prototype.setFocused = function (on) {
    this.focused = on;
    var e = this.byIdx[this.f];
    if (e && e.foc !== on) {
      N.fx.move(e.card);
      e.card.className = on ? e.base + ' is-focus' : e.base; e.cap.className = on ? e.capBase + ' is-focus' : e.capBase; e.foc = on;
    }
  };
  /* Daten einer Karte geaendert (Gesehen-Status) */
  Row.prototype.refreshItem = function (i) { var e = this.byIdx[i]; if (e) this._fill(e, i, 0); };
  /* Karte entfernen/einfuegen (Ausblenden, Gelb in Weiterschauen) -> Fokus nach SPEC 6.3.1 */
  Row.prototype.removeAt = function (i) {
    this.model.items.splice(i, 1);
    var n = this.count();
    for (var k = 0; k < POOL; k++) this._free(this.pool[k]);
    this.byIdx = {};
    this.f = n ? Math.min(i, n - 1) : 0;
    this.sc = Math.min(this.sc, R.maxScroll(n, this.g.full));
    if (this.f < this.sc) this.sc = this.f;
    this.relabel(); this._jumpStrip(); this.render(0);
    return n;
  };
  Row.prototype.insertAt = function (i, item) {
    this.model.items.splice(i, 0, item);
    for (var k = 0; k < POOL; k++) this._free(this.pool[k]);
    this.byIdx = {};
    this.f = i; this.sc = R.scroll(this.count(), i, this.g.full);
    this.relabel(); this._jumpStrip(); this.render(0);
  };
  Row.prototype.clear = function () {
    for (var k = 0; k < POOL; k++) this._free(this.pool[k]);
    this.byIdx = {}; this.model = null; this.focused = false; this.relabel();
  };
  Row.prototype.setVisible = function (on) { U.vis(this.el, on); };
  /* Haeppchen-Groesse je Frame (P7 perf2: per Messlauf einstellbar, 'chunks' vergleicht Varianten am TV); FAST = waehrend Tastenwiederholung */
  Row.CHUNK = 3; Row.CHUNK_FAST = 3;
  function chunk() { return N.fx && N.fx.isFast() ? Row.CHUNK_FAST : Row.CHUNK; }
  N.ui.Row = Row;
})(N);
