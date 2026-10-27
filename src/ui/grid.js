/* N.ui.Grid – virtualisiertes Bibliotheksraster (SPEC 7.5, 14.6) mit festem Pool (Zeile −1 … +after um den Fokus).
 * - Ansichten Gross/Mittel/Klein/Liste (N.GridMath.make); der Pool waechst nur einmal auf die groesste benoetigte Zahl.
 * - Fokus-Anker: fokussierte Zeile immer bei y = 176; EIN Transform am Seiten-Container (translate3d, 150 ms).
 * - Pro Fokusschritt nur alte + neue Karte (+ Beschriftung) umklassen; Recycling nur der Karten, die das Fenster verlassen.
 * - Nicht geladene Indizes (Gesamtzahl bekannt) = Platzhalter ohne Bild; Bilder ueber den Bildlader. Kein innerHTML, kein z-index.
 * - P7 27.10. (TV: lib-S 19 Frames > 50 ms): im Fokusschritt werden nur SICHTBARE Zeilen befuellt; die neue Pufferzeile (ausserhalb
 *   des Clips) folgt in rAF-Haeppchen zu je CHUNK Karten. Freie Karten bleiben bis zur Wiederverwendung stehen (kein display-Wechsel
 *   = keine Ebene ab-/aufbauen), Positions-/Abzeichen-/Fortschrittswerte werden gemerkt und nur bei Aenderung geschrieben. */
(function (N) {
  var U = N.util, M = N.model, CLIP_Y = 164, CLIP_B = 720;

  function Grid(parent) {
    this.clip = U.el('div', 'gclip', parent);
    this.pg = U.el('div', 'gpg', this.clip);
    this.pool = [];
    this.items = []; this.n = 0; this.f = 0; this.r = 0; this.byIdx = {}; this.focused = false; this.pend = false;
    this.setGeom(N.GridMath);
  }
  /* Ansicht wechseln (nur zusammen mit setModel/clear, nie im Fokusschritt) */
  Grid.prototype.setGeom = function (G) {
    this.G = G;
    this.cardCls = 'card card-' + G.CLS; this.capCls = 'cap cap-' + G.CLS;
    this.vis = Math.max(1, Math.ceil((CLIP_B - G.Y0) / G.SY));     // Zeilen ab der Fokuszeile, die im Clip sichtbar sind
    while (this.pool.length < G.POOL) this.pool.push(this._make());
    for (var i = 0; i < this.pool.length; i++) {
      var e = this.pool[i];
      this._free(e);
      e.card.className = this.cardCls; e.cap.className = this.capCls; e.foc = false; e.x = e.y = null;
    }
    this.byIdx = {};
  };
  Grid.prototype._make = function () {
    var e = {}, s = this.pg;
    e.card = U.el('div', this.cardCls || 'card', s, 'display:none');
    e.ph = U.txt('div', 'ph', e.card, ''); e.phEl = e.ph.parentNode; e.phc = 'ph';
    e.img = U.el('img', '', e.card); e.img.src = N.img.BLANK;
    e.badge = U.el('div', 'bdg', e.card); e.badgeT = document.createTextNode(''); e.badge.appendChild(e.badgeT);
    e.prog = U.el('div', 'prog', e.card); e.progI = U.el('i', '', e.prog);
    e.cap = U.el('div', this.capCls || 'cap', s, 'display:none');
    e.t1 = U.txt('div', 't1', e.cap, ''); e.t2 = U.txt('div', 't2', e.cap, '');
    e.idx = -1; e.on = false; e.foc = false; e.it = null; e.x = e.y = null; e.bc = 'bdg'; e.pw = -1;
    return e;
  };
  /* neues Modell: n = Gesamtzahl (Platzhalter fuer nicht geladene), items = (duennes) Array, f = Fokus */
  Grid.prototype.setModel = function (items, n, f) {
    for (var i = 0; i < this.pool.length; i++) this._free(this.pool[i]);
    this.byIdx = {}; this.items = items; this.n = n;
    this.f = n ? U.clamp(f || 0, 0, n - 1) : 0; this.r = this.G.row(this.f);
    var pg = this.pg;
    pg.style.webkitTransition = 'none'; U.tf(pg, 0, this.G.offset(this.r));
    setTimeout(function () { pg.style.webkitTransition = ''; }, 60);
    this.render(0);
  };
  Grid.prototype.item = function (i) { return this.items[i] || null; };
  Grid.prototype._free = function (e) { this._release(e); this._hide(e); };
  /* Karte verlaesst das Fenster: Index/Bildauftrag/Fokus weg, bleibt aber (ausserhalb des Clips) stehen, bis sie wiederverwendet wird */
  Grid.prototype._release = function (e) {
    if (e.idx >= 0) { if (this.byIdx[e.idx] === e) delete this.byIdx[e.idx]; e.idx = -1; }
    N.img.drop(e.img, true); e.it = null;
    if (e.foc) { e.card.className = this.cardCls; e.cap.className = this.capCls; e.foc = false; }
  };
  Grid.prototype._hide = function (e) {
    if (e.on && e.idx < 0) { e.card.style.display = 'none'; e.cap.style.display = 'none'; e.on = false; N.img.drop(e.img); }
  };
  /* Beschriftung: Raster wie die Posterkarte; Liste mit Jahr · Dauer · Restzeit */
  Grid.prototype._caption = function (it) {
    if (!it) return ['', ''];
    if (this.G.size !== 'list') return M.posterCaption(it);
    if (N.music && N.music.isAudio(it)) return N.music.caption(it, true);   // M4: Interpret · Jahr bzw. Interpret · Dauer
    var p = [];
    if (it.year) p.push(it.year);
    if (it.type === 'show' && it.child) p.push(N.tn('meta.seasons', it.child));
    if (it.type === 'movie' && it.dur) p.push(N.fmt.dur(it.dur));
    if (M.progress(it) > 0) p.push(N.t('det.left', { time: N.fmt.dur(M.remaining(it)) }));
    return [it.title, N.fmt.join(p)];
  };
  Grid.prototype._fill = function (e, i, prio) {
    var G = this.G, it = this.items[i] || null, p = G.pos(i), y = p.y - CLIP_Y;
    if (e.idx >= 0 && e.idx !== i && this.byIdx[e.idx] === e) delete this.byIdx[e.idx];
    e.idx = i; this.byIdx[i] = e; e.st = false;
    if (e.x !== p.x) { e.x = p.x; e.card.style.left = p.x + 'px'; e.cap.style.left = (p.x + G.CAP_X) + 'px'; }
    if (e.y !== y) { e.y = y; e.card.style.top = y + 'px'; e.cap.style.top = (y + G.CAP_Y) + 'px'; }
    if (e.it !== it) {
      e.it = it;
      U.setText(e.ph, it && G.size !== 'list' ? it.title : '');
      var phc = it && !it.thumb ? 'ph fb ' + N.ui.fbClass(it) : 'ph';   // ohne Bild: farbige Titelkarte (F28), nie grau
      if (e.phc !== phc) { e.phc = phc; e.phEl.className = phc; }
      N.img.want(e.img, it && it.thumb ? N.img.url(it.thumb, G.TIER) : '', prio);
      var b = it ? M.badge(it) : { b: '', n: '' }, bc = b.b ? 'bdg ' + b.b : 'bdg';
      if (e.bc !== bc) { e.bc = bc; e.badge.className = bc; }
      U.setText(e.badgeT, b.n);
      var pr = it ? M.progress(it) : 0, pw = pr > 0 ? Math.max(4, Math.round((G.size === 'list' ? 200 : G.W - 20) * pr)) : -1;
      if (pw !== e.pw) {
        if (pw < 0) e.prog.style.display = 'none';
        else { if (e.pw < 0) e.prog.style.display = 'block'; e.progI.style.width = pw + 'px'; }
        e.pw = pw;
      }
      var c = this._caption(it);
      U.setText(e.t1, c[0]); U.setText(e.t2, c[1]);
    }
    if (!e.on) { e.card.style.display = ''; e.cap.style.display = ''; e.on = true; }
    var foc = this.focused && i === this.f;
    if (foc !== e.foc) { e.card.className = foc ? this.cardCls + ' is-focus' : this.cardCls; e.cap.className = foc ? this.capCls + ' is-focus' : this.capCls; e.foc = foc; }
  };
  /* Fenster herstellen; prio 0 = Fokuszeile sofort, sonst Puffer.
   * mode 0 = alles sofort; 1 = sichtbare Zeilen sofort, Puffer im naechsten Frame; 2 = Haeppchen (CHUNK Karten, sichtbare zuerst) */
  Grid.prototype.render = function (prio, mode) {
    var G = this.G, w = G.win(this.n, this.r), free = [], todo = [], i, e, nv = 0;
    for (i = 0; i < this.pool.length; i++) { e = this.pool[i]; if (e.idx < w.first || e.idx > w.last) { if (e.idx >= 0) this._release(e); free.push(e); } }
    var v0 = Math.max(w.first, this.r * G.COLS), v1 = Math.min(w.last, (this.r + this.vis) * G.COLS - 1);
    for (i = v0; i <= v1; i++) if (!this.byIdx[i] || this.byIdx[i].st) todo.push(i);
    nv = todo.length;
    for (i = w.first; i <= w.last; i++) if ((!this.byIdx[i] || this.byIdx[i].st) && (i < v0 || i > v1)) todo.push(i);
    var budget = !mode ? todo.length : mode === 1 ? nv : chunk(), stop = false;
    for (i = 0; i < todo.length && i < budget; i++) {
      e = this.byIdx[todo[i]] || free.shift();          // veraltete Karte (refresh) an ihrem Platz, sonst eine freie
      if (!e) { stop = true; break; }
      var rr = G.row(todo[i]);
      this._fill(e, todo[i], rr === this.r ? (prio || 0) : rr <= this.r + (G.size === 'list' ? 5 : 1) ? 1 : 2);
    }
    if (!stop && i < todo.length) { this._later(); return; }
    for (i = 0; i < free.length; i++) this._hide(free[i]);
  };
  Grid.prototype._later = function () {
    if (this.pend) return;
    var self = this;
    this.pend = true;
    U.raf(function () { self.pend = false; if (self.n) self.render(1, 2); });   // idempotent: stellt das aktuelle Fenster her
  };
  /* Daten fuer Indizes [a, b] angekommen bzw. geaendert -> Karten im Fenster neu befuellen: sichtbare sofort, Puffer in Haeppchen
   * (eine ankommende Seite traf sonst bis zu 3 Zeilen auf einmal – mitten in der Tastenfolge) */
  Grid.prototype.refresh = function (a, b) {
    for (var i = a; i <= b; i++) { var e = this.byIdx[i]; if (e) { e.it = undefined; e.st = true; } }
    this.render(0, 1);
  };
  /* Zeilen ab der Scroll-Zeile r, die Zeiger-Fokus bekommen duerfen (ganz ueber dem Ausblend-Band, N.GridMath.full) */
  Grid.prototype.hitRows = function () { return this.G.full(); };
  /* Fokusschritt: alte + neue Karte, ggf. EIN Transform am Seiten-Container. Rueckgabe: Ringziel (Bildschirm).
   * still (Zeiger, TV-Befund 27.10. nachmittags): liegt die Zeile im sichtbaren Bereich, bleibt die Scroll-Zeile r stehen –
   * der Fokus wandert unter den Punkt, die Liste rollt NICHT (keine Rueckkopplung Hover -> Rollen -> Hover). */
  Grid.prototype.focusTo = function (i, still) {
    if (!this.n) return null;
    i = U.clamp(i, 0, this.n - 1);
    var ri = this.G.row(i), keep = still && ri >= this.r && ri < this.r + this.hitRows();
    var old = this.byIdx[this.f], r = keep ? this.r : ri, moved = r !== this.r;
    this.f = i; this.r = r;
    if (moved) this.render(0, 1);
    var cur = this.byIdx[i];
    if (this.focused) {
      if (old && old !== cur && old.foc) { old.card.className = this.cardCls; old.cap.className = this.capCls; old.foc = false; N.fx.move(old.card); }
      if (cur && !cur.foc) { cur.card.className = this.cardCls + ' is-focus'; cur.cap.className = this.capCls + ' is-focus'; cur.foc = true; N.fx.move(cur.card); }
    }
    if (moved) { N.fx.move(this.pg); U.tf(this.pg, 0, this.G.offset(r)); }
    return this.ringPos();
  };
  /* Zeiger-Randzone: Scroll-Zeile um d verschieben, Fokus in den sichtbaren Bereich klemmen (gleiche Spalte) */
  Grid.prototype.scrollBy = function (d) {
    if (!this.n) return null;
    var G = this.G, last = G.row(this.n - 1), r = U.clamp(this.r + d, 0, last), c = G.col(this.f), fr = G.row(this.f), h = this.hitRows();
    if (r === this.r) return this.ringPos();
    if (fr < r) fr = r; else if (fr > r + h - 1) fr = r + h - 1;
    var i = Math.min(this.n - 1, fr * G.COLS + c), old = this.byIdx[this.f];
    this.f = i; this.r = r;
    this.render(0, 1);
    var cur = this.byIdx[i];
    if (this.focused) {
      if (old && old !== cur && old.foc) { old.card.className = this.cardCls; old.cap.className = this.capCls; old.foc = false; }
      if (cur && !cur.foc) { cur.card.className = this.cardCls + ' is-focus'; cur.cap.className = this.capCls + ' is-focus'; cur.foc = true; }
    }
    N.fx.move(this.pg); U.tf(this.pg, 0, G.offset(r));
    return this.ringPos();
  };
  Grid.prototype.canScroll = function (d) { return d < 0 ? this.r > 0 : this.n > 0 && this.r < this.G.row(this.n - 1); };
  Grid.prototype.ringPos = function () { var G = this.G; return { x: G.X0 + G.col(this.f) * G.SX, y: G.Y0 + (G.row(this.f) - this.r) * G.SY, shape: G.CLS, noScale: G.NO_SCALE }; };
  Grid.prototype.setFocused = function (on) {
    this.focused = on;
    var e = this.byIdx[this.f];
    if (e && e.foc !== on) { N.fx.move(e.card); e.card.className = on ? this.cardCls + ' is-focus' : this.cardCls; e.cap.className = on ? this.capCls + ' is-focus' : this.capCls; e.foc = on; }
  };
  /* Karte entfernen (Gelb unter Filter "Ungesehen", SPEC 6.3.1): Fokus auf die nachrueckende, sonst die vorherige */
  Grid.prototype.removeAt = function (i) {
    this.items.splice(i, 1); this.n = Math.max(0, this.n - 1);
    this.setModel(this.items, this.n, Math.min(i, this.n - 1));
    return this.n;
  };
  Grid.prototype.insertAt = function (i, it) {
    this.items.splice(i, 0, it); this.n++;
    this.setModel(this.items, this.n, i);
  };
  Grid.prototype.clear = function () {
    for (var i = 0; i < this.pool.length; i++) this._free(this.pool[i]);
    this.byIdx = {}; this.items = []; this.n = 0; this.f = 0; this.r = 0;
  };
  Grid.prototype.setVisible = function (on) { U.vis(this.clip, on); };
  /* Haeppchen-Groesse je Frame (P7 perf2: per Messlauf einstellbar, 'chunks' vergleicht Varianten am TV); FAST = waehrend Tastenwiederholung */
  Grid.CHUNK = 1; Grid.CHUNK_FAST = 1;   // perf3: TV 9,8,5 chunk-S1 58,8 / S3 53,5 / S9 50,1 fps
  function chunk() { return N.fx && N.fx.isFast() ? Grid.CHUNK_FAST : Grid.CHUNK; }
  N.ui.Grid = Grid;
})(N);
