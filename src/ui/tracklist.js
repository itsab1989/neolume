/* N.ui.TrackList – virtualisierte Titel-/Kapitelliste (M4: Album, Hoerbuch, Beliebte Titel). Zeilen 56 px, fester Pool,
 * EIN translate3d an der Liste; Fokus-Anker: ab der 3. sichtbaren Zeile bleibt der Fokus stehen und die Liste rollt.
 * Pro Fokusschritt nur alte + neue Zeile umklassen, kein innerHTML, keine Geometrie-Abfragen.
 * Zeile: Nummer (bzw. Ton-Symbol beim laufenden Titel) · Titel · Unterzeile · Dauer rechts · optional Fortschritt (Hoerbuch).
 * opts: {x, y, w, vis (sichtbare Zeilen), row(it, i) -> {n, t, s, d, p (0..1), done}}; setRoom(k): k Zeilen unten frei (Mini-Player) */
(function (N) {
  var U = N.util, H = 56;
  function TrackList(parent, opts) {
    this.o = opts; this.vis = opts.vis || 6; this.full = opts.full || this.vis; this.poolN = this.vis + 4;
    this.clip = U.el('div', 'tl-clip', parent, 'left:' + opts.x + 'px;top:' + opts.y + 'px;width:' + opts.w + 'px;height:' + (this.vis * H) + 'px');
    this.list = U.el('div', 'tl-list', this.clip);
    this.pool = []; this.items = []; this.f = 0; this.sc = 0; this.byIdx = {}; this.focused = false; this.cur = ''; this.room = 0;
    for (var i = 0; i < this.poolN; i++) {
      var e = { r: U.el('div', 'tl-row', this.list, 'display:none;width:' + opts.w + 'px') };
      e.nEl = U.el('div', 'tl-n', e.r); e.n = document.createTextNode(''); e.nEl.appendChild(e.n); e.ic = N.ui.icon(e.r, 'audio', '', 'left:8px;top:12px;display:none');
      e.t = U.txt('div', 'tl-t ell', e.r, ''); e.s = U.txt('div', 'tl-s ell', e.r, ''); e.d = U.txt('div', 'tl-d', e.r, '');
      e.p = U.el('div', 'tl-p', e.r, 'display:none'); e.pi = U.el('i', '', e.p);
      e.idx = -1; e.foc = false; e.on = false; e.playing = false;
      this.pool.push(e);
    }
  }
  var T = TrackList.prototype;
  T.count = function () { return this.items.length; };
  /* Zeilen, die Fokus bekommen duerfen: ganz sichtbar (opts.full, ueber dem Ausblend-Band) und nicht unter dem Mini-Player.
   * Die Zeile darunter wird nur angeschnitten gezeigt (TV-Befund 27.10.: Fokus dort ragte in Band und Hinweisleiste) */
  T.use = function () { return Math.max(1, Math.min(this.full, this.vis - this.room)); };
  T.item = function (i) { return this.items[i] || null; };
  /* Scroll-Index nach der Anker-Regel */
  /* Zeiger-Randzonen (TV-Befund 27.10. nachmittags): oben 32 px ueber der ersten Zeile, unten ab der ersten nicht fokussierbaren
   * (angeschnittenen) Zeile bis zur Hinweisleiste (y 656). top = Bildschirm-y der ersten sichtbaren Zeile. -> {d, x, y} | null */
  TrackList.edge = function (tl, top, x, y) {
    if (x < tl.o.x || x >= tl.o.x + tl.o.w) return null;
    var cx = tl.o.x + tl.o.w / 2, b = top + tl.use() * H;
    if (y >= top - 32 && y < top && tl.canScroll(-1)) return { d: -1, x: cx, y: top - 16 };
    if (y >= Math.min(b, 604) && y < 656 && tl.canScroll(1)) return { d: 1, x: cx, y: 628 };   // Band mind. 52 px ueber der Hinweisleiste
    return null;
  };
  TrackList.scroll = function (n, f, vis) { return Math.max(0, Math.min(f - 2, n - vis)); };
  T.setItems = function (items, f) {
    this.items = items || []; this.f = U.clamp(f || 0, 0, Math.max(0, this.items.length - 1));
    this.sc = TrackList.scroll(this.items.length, this.f, this.use());
    for (var i = 0; i < this.poolN; i++) this._free(this.pool[i]);
    this.byIdx = {};
    this.list.style.webkitTransition = 'none'; U.tf(this.list, 0, -this.sc * H);
    var l = this.list; setTimeout(function () { l.style.webkitTransition = ''; }, 60);
    this.render();
  };
  T._free = function (e) {
    if (e.idx >= 0) delete this.byIdx[e.idx];
    e.idx = -1;
    if (e.on) { e.r.style.display = 'none'; e.on = false; }
    if (e.foc) { e.r.className = 'tl-row'; e.foc = false; }
  };
  T._fill = function (e, i) {
    var it = this.items[i], v = this.o.row(it, i);
    e.idx = i; this.byIdx[i] = e;
    e.r.style.top = (i * H) + 'px';
    U.setText(e.n, v.n === undefined ? String(i + 1) : String(v.n)); U.setText(e.t, v.t || ''); U.setText(e.s, v.s || ''); U.setText(e.d, v.d || '');
    U.cls(e.r, 'two', !!v.s); U.cls(e.r, 'done', !!v.done);
    if (v.p > 0) { e.p.style.display = ''; e.pi.style.width = Math.max(4, Math.round(160 * v.p)) + 'px'; } else e.p.style.display = 'none';
    var pl = !!this.cur && it && it.rk === this.cur && v.cur !== false;
    if (pl !== e.playing) { e.playing = pl; e.ic.style.display = pl ? '' : 'none'; e.nEl.style.visibility = pl ? 'hidden' : ''; }
    if (!e.on) { e.r.style.display = ''; e.on = true; }
    var foc = this.focused && i === this.f;
    if (foc !== e.foc) { e.r.className = 'tl-row' + (v.s ? ' two' : '') + (v.done ? ' done' : '') + (foc ? ' is-focus' : ''); e.foc = foc; }
  };
  T.render = function () {
    var n = this.items.length, first = Math.max(0, this.sc - 2), last = Math.min(n - 1, first + this.poolN - 1), free = [], i, e;
    for (i = 0; i < this.poolN; i++) { e = this.pool[i]; if (e.idx < first || e.idx > last) { if (e.idx >= 0 || e.on) this._free(e); free.push(e); } }
    for (i = first; i <= last; i++) { if (this.byIdx[i]) continue; e = free.shift(); if (!e) break; this._fill(e, i); }
  };
  T.refresh = function () { for (var k in this.byIdx) this._fill(this.byIdx[k], Number(k)); };
  /* laufender Titel (rk) markieren */
  T.setCurrent = function (rk) { if (rk === this.cur) return; this.cur = rk || ''; this.refresh(); };
  /* still (Zeiger): sichtbare Zeile -> Liste bleibt stehen (keine Rueckkopplung Hover -> Rollen -> Hover) */
  T.focusTo = function (i, still) {
    var n = this.items.length;
    if (!n) return;
    i = U.clamp(i, 0, n - 1);
    var keep = still && i >= this.sc && i < this.sc + this.use();
    var old = this.byIdx[this.f], sc = keep ? this.sc : TrackList.scroll(n, i, this.use());
    this.f = i;
    if (sc !== this.sc) { this.sc = sc; this.render(); N.fx.move(this.list); U.tf(this.list, 0, -sc * H); }
    var cur = this.byIdx[i];
    if (this.focused) {
      if (old && old !== cur && old.foc) { U.cls(old.r, 'is-focus', false); old.foc = false; }
      if (cur && !cur.foc) { U.cls(cur.r, 'is-focus', true); cur.foc = true; }
    }
  };
  /* Zeiger-Randzone: eine Zeile rollen, Fokus bleibt im sichtbaren Bereich */
  T.canScroll = function (d) { var v = this.use(); return d < 0 ? this.sc > 0 : this.sc < this.items.length - v; };
  T.scrollBy = function (d) {
    var n = this.items.length, v = this.use(), sc = U.clamp(this.sc + d, 0, Math.max(0, n - v));
    if (sc === this.sc) return;
    this.sc = sc; this.render(); N.fx.move(this.list); U.tf(this.list, 0, -sc * H);
    var f = U.clamp(this.f, sc, Math.min(n - 1, sc + v - 1));
    if (f !== this.f) {
      var old = this.byIdx[this.f]; this.f = f;
      if (this.focused) { if (old && old.foc) { U.cls(old.r, 'is-focus', false); old.foc = false; } var cur = this.byIdx[f]; if (cur && !cur.foc) { U.cls(cur.r, 'is-focus', true); cur.foc = true; } }
    }
  };
  /* Platz unten frei halten (k Zeilen, z. B. unter dem Mini-Player, F26): die letzten Eintraege rollen entsprechend hoeher */
  T.setRoom = function (k) {
    if (k === this.room) return;
    this.room = k;
    var sc = TrackList.scroll(this.items.length, this.f, this.use());
    if (sc !== this.sc) { this.sc = sc; this.render(); N.fx.move(this.list); U.tf(this.list, 0, -sc * H); }
  };
  T.setFocused = function (on) {
    this.focused = on;
    var e = this.byIdx[this.f];
    if (e && e.foc !== on) { U.cls(e.r, 'is-focus', on); e.foc = on; }
  };
  /* Zeiger: y relativ zur Listen-Oberkante (Bildschirm) -> Index oder -1 */
  T.hit = function (y) {
    if (y < 0 || y >= this.vis * H) return -1;
    var i = this.sc + Math.floor(y / H);
    return i < this.items.length ? i : -1;
  };
  T.clear = function () { for (var i = 0; i < this.poolN; i++) this._free(this.pool[i]); this.items = []; this.byIdx = {}; };
  N.ui.TrackList = TrackList;
})(N);
