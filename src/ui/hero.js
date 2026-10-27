/* N.ui.Hero – Hero-Bereich der Startseite (SPEC 5.6):
 * 2 feste <img> im Wechsel (1280x720, am TV gemessen; ohne Art das Poster unscharf vom Server) + EIN Scrim-PNG, beide ohne translate3d.
 * Textblock als Dauer-Ebene, Wechsel nach 300 ms Fokus-Ruhe (Aufrufer), Opacity 0 -> 1 in 120 ms.
 * Tausch-Gate: Bild laedt ins versteckte <img>; sichtbar wird es nur, wenn seit >= 300 ms keine Taste kam, allein in einem Frame. */
(function (N) {
  var U = N.util, M = N.model, REST = 300;
  function Hero(parent) {
    this.imgs = [U.el('img', 'hero-img', parent), U.el('img', 'hero-img', parent)];
    this.imgs[0].src = N.img.BLANK; this.imgs[1].src = N.img.BLANK;
    this.cur = -1; this.url = ''; this.gen = 0; this.retryT = 0;
    var scrim = U.el('img', 'full', parent);
    scrim.src = N.assetBase + 'scrim.png';
    var t = this.txt = U.el('div', 'hero-txt', parent);
    this.ov = U.txt('div', 'hero-ov t-label cacc ell', t, '');
    this.ti = U.txt('div', 'hero-ti t-display ell', t, '');
    this.me = U.txt('div', 'hero-me t-body c2 ell', t, '');
    this.deEl = U.el('div', 'hero-de clamp t-body c2', t);
    this.de = document.createTextNode(''); this.deEl.appendChild(this.de);
    this.strip = new N.ui.SeasonStrip(t, 'L', 0, 252);
    this.ep = U.txt('div', 'hero-ep t-small c1 ell', t, '');
    this.mp = U.el('div', 'hero-mp', t, 'display:none');
    this.mpI = U.el('i', '', this.mp);
    this.mt = U.txt('div', 'hero-mt t-small c1 ell', t, '');
    this.item = null;
  }
  /* Text + Bild fuer ein Item setzen (Aufruf erst nach 300 ms Ruhe). opts: {stripEnabled} */
  Hero.prototype.set = function (it, opts) {
    this.item = it;
    var t = this.txt;
    if (!N.fx.reduced()) U.cls(t, 'out', true);
    this.paintOv();
    var self = this, A = N.anime;
    // Anime je Titel (Ueberzeile "Serie · Anime"): Detail-Signale einmal je Titel nachladen (erst nach der Hero-Ruhe, LRU in N.anime)
    if (it && A && A.showCat() && A.relevant(it) && !A.cached(it)) A.ensure(it, function () { if (self.item === it) self.paintOv(); });
    U.setText(this.ti, it ? it.title : '');
    U.setText(this.me, it ? this.meta(it) : '');
    var series = it && (it.type === 'episode');
    var prog = it ? M.progress(it) : 0;
    var stripOn = series && opts && opts.stripEnabled;
    U.cls(this.deEl, 'l2', !!series);
    U.clampText(this.de, it ? (N.comfort ? N.comfort.summary(it) : it.sum) : '');   // Spoilerschutz: Hinweis statt Folgen-Text
    // Folgenzeile (Serie in Arbeit) bzw. Film-Fortschritt
    if (series) {
      U.setText(this.ep, N.t('home.hero.progress', { s: it.s, e: it.e, title: it.epTitle, time: N.fmt.dur(M.remaining(it)) }));
      U.show(this.mp, false); U.setText(this.mt, '');
    } else if (it && it.type === 'movie' && prog > 0) {
      U.setText(this.ep, '');
      U.show(this.mp, true); this.mpI.style.width = Math.round(160 * prog) + 'px';
      U.setText(this.mt, N.t('home.hero.movieLeft', { time: N.fmt.dur(M.remaining(it)), clock: N.fmt.clock(new Date(N.clock.now() + M.remaining(it))) }));
    } else { U.setText(this.ep, ''); U.show(this.mp, false); U.setText(this.mt, ''); }
    if (!stripOn) this.strip.render({ mode: 'none' });
    if (U.hasCls(t, 'out')) U.raf(function () { U.cls(t, 'out', false); });
    this.load(it);
  };
  Hero.prototype.paintOv = function () { U.setText(this.ov, this.item ? M.overline(this.item) : ''); };
  Hero.prototype.setStrip = function (lay) { this.strip.render(lay); };
  Hero.prototype.meta = function (it) {
    var parts = [];
    if (it.nNew > 1) parts.push(N.tn('card.sub.newEpisodes', it.nNew));   // "Neu in": mehrere neue Folgen einer Serie
    if (it.artist) parts.push(it.artist);
    if (it.year) parts.push(it.year);
    if (it.type === 'movie' && it.dur) parts.push(N.fmt.dur(it.dur));
    if (it.type === 'show' && it.child) parts.push(N.tn('meta.seasons', it.child));
    if (it.type === 'season' && it.leaf) parts.push(N.tn('meta.episodes', it.leaf));
    parts.push(N.fmt.rated(it.cr));
    if (it.rating) parts.push(N.fmt.rating(it.rating));
    return N.fmt.join(parts);
  };
  /* Hintergrund: Art scharf, ohne Art Poster/Cover unscharf vom Server (N.img.bg); Hintergrundbilder aus: einfarbig */
  Hero.prototype.load = function (it) {
    var self = this, b = it ? N.img.bg(it.art, it.thumb) : null;
    var url = b ? b.url : '', soft = !!(b && b.soft);
    if (url === this.url) return;
    this.url = url;
    var gen = ++this.gen;
    if (this.retryT) { clearTimeout(this.retryT); this.retryT = 0; }
    if (!url) { if (this.cur >= 0) { U.vis(this.imgs[this.cur], false); this.cur = -1; } return; }
    var next = this.imgs[this.cur === 0 ? 1 : 0];
    next.onload = function () {
      next.onload = next.onerror = null;
      if (gen !== self.gen) return;
      N.img.fit(next, soft);                 // im verdeckten Puffer: unscharfes Poster mittig beschneiden bzw. Art zuruecksetzen
      self._trySwap(gen, next);
    };
    next.onerror = function () { next.onload = next.onerror = null; };
    // Gleiche URL im verdeckten Puffer (z. B. Titel zuvor schon gezeigt): kein neues onload -> direkt tauschen (TV-Befund 26.10.)
    if (next.src === url && next.complete && next.naturalWidth) { next.onload = next.onerror = null; N.img.fit(next, soft); this._trySwap(gen, next); return; }
    next.src = url;
  };
  Hero.prototype._trySwap = function (gen, next) {
    var self = this, rest = N.idle.restFor();
    if (gen !== this.gen) return;
    if (rest < REST) { this.retryT = setTimeout(function () { self.retryT = 0; self._trySwap(gen, next); }, REST - rest + 10); return; }
    U.raf(function () {
      if (gen !== self.gen || N.idle.restFor() < REST) { if (gen === self.gen) self._trySwap(gen, next); return; }
      var old = self.cur >= 0 ? self.imgs[self.cur] : null;
      U.vis(next, true);
      if (old && old !== next) U.vis(old, false);
      self.cur = self.imgs[0] === next ? 0 : 1;
    });
  };
  /* Bild wiederherstellen (nach Overlay, Bildschirmtastatur, Fokus-Rueckkehr): Orsay-WebKit zeichnet das nicht
   * zusammengesetzte Hero-<img> nach dem Entfernen einer Vollbild-Ebene teils nicht neu bzw. verwirft das dekodierte Bild.
   * Sichtbares Bild einen Frame lang mit Deckkraft 0,99 zeichnen (erzwingt Neuzeichnen ohne Flackern); ist es leer, neu laden. */
  Hero.prototype.refresh = function () {
    var self = this, img = this.cur >= 0 ? this.imgs[this.cur] : null;
    if (!this.url) return;
    if (!img || !img.complete || !img.naturalWidth) { this.url = ''; this.load(this.item); return; }   // laeuft noch bzw. verworfen
    var gen = this.gen;
    U.vis(img, true);
    img.style.opacity = '0.99';
    U.raf(function () { img.style.opacity = ''; if (gen === self.gen && self.imgs[self.cur] === img) U.vis(img, true); });
  };
  Hero.prototype.clear = function () { this.set(null); };
  N.ui.Hero = Hero;
})(N);
