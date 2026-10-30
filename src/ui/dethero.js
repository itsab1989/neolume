/* N.ui.DetHero – erster Bildschirm einer Detailseite (Feedback-Regel 3/11), EINE Umsetzung fuer Film/Serie (views/details.js) und
 * Album/Hoerbuch/Kuenstler (M4):
 * Hintergrund (Art 1280x720 scharf + Scrim; ohne Art das Cover unscharf; ohne jedes Bild Farbflaeche je Titel), Cover fest links
 * (blendet in den Abschnitten aus), Info-Block fest (erster Bildschirm unten neben dem Cover, in den Abschnitten oben).
 * square = quadratisches Cover; scrim = andere Abdunklung (Kuenstlerseite: scrim-np.png, Fotos oft hell, F24). Elemente werden VOR dem Seiten-Container angelegt, der Info-Block (makeInfo) danach.
 * Einstellung "Hintergrundbilder" aus (N.comfort.backgrounds): kein Bild, ruhige Farbflaeche je Titel (wie ohne jedes Bild). */
(function (N) {
  var U = N.util, HERO_X = 208, HERO_Y = 188, REST = 300;
  function DetHero(root, o) {
    o = o || {};
    this.sq = !!o.square; this.on = true; this.needBg = true; this.dead = false; this.chipEls = [];
    this.bgc = U.el('div', 'full', root, 'display:none');
    this.bg = U.el('img', 'full', root); this.bg.src = N.img.BLANK; this.bg.style.visibility = 'hidden';
    var scrim = U.el('img', 'full', root); scrim.src = N.assetBase + (o.scrim || 'scrim-det.png');   // kraeftiger hinter dem Text (F5/F17; Kuenstler F24)
    this.pc = U.el('div', this.sq ? 'd-poster sq' : 'd-poster', root);
    this.poster = U.el('img', '', this.pc); this.poster.src = N.img.BLANK;
    this.pfb = U.el('div', 'd-pfb', this.pc, 'display:none'); this.pfbT = document.createTextNode(''); this.pfb.appendChild(this.pfbT);
  }
  var P = DetHero.prototype;
  /* Info-Block (nach dem Seiten-Container anlegen, damit er darueber liegt) */
  /* o.chips: Anzahl Chips unter der Beschreibung (Film/Serie: Technik; fremder Titel: Genres); o.line: kurze Textzeile hinter den
   * Chips (fremder Titel: "Regie: …" bzw. "Sender · Idee: …") */
  P.makeInfo = function (root, o) {
    // kompakter Kopf in den Abschnitten: dunkles Band unter dem Text (Feedback-Regel 11, wie details.js)
    this.hdr = U.el('img', 'dtop', root); this.hdr.src = N.assetBase + (o && o.hdr || 'fade-bottom.png');   // o.hdr: Band laeuft nach rechts aus (Filme/Serien)
    var info = this.info = U.el('div', 'dinfo', root);
    U.tf(info, HERO_X, HERO_Y);
    this.ovT = U.txt('div', 'd-ov t-label cacc ell', info, '');
    this.tiEl = U.el('div', 'd-ti t-display ell', info); this.tiT = document.createTextNode(''); this.tiEl.appendChild(this.tiT);
    this.meT = U.txt('div', 'd-me t-body c2 ell', info, '');
    this.deT = U.txt('div', 'd-de clamp t-body c2', info, '');
    var n = o && o.chips || 0, ch = n || o && o.line ? U.el('div', 'd-chips', info) : null;
    for (var i = 0; i < n; i++) { var c = U.el('span', 'chip-tech', ch, 'display:none'); c.appendChild(document.createTextNode('')); this.chipEls.push(c); }
    if (o && o.line) this.lineT = U.txt('span', 'd-chl t-small c2 ell', ch, '');
    this.chRow = ch;
    return info;
  };
  /* Zeile einer Erweiterung unter der Beschreibung (details.js X/xt.note, z. B. wann die naechste Folge kommt): eigenes Element hinter den
   * Chips, erst beim ersten Text angelegt (ohne Text: kein Element, Seite wie ohne Erweiterung). Kommt der Text spaeter (Daten der
   * Erweiterung), blendet nur diese Zeile ruhig ein – nichts verschiebt sich (der Platz der Chip-Zeile ist fest). */
  P.note = function (t, fade) {
    t = t || '';
    if (!this.chRow || (!this.noteEl && !t) || t === this.noteV) return;
    if (!this.noteEl) { this.noteEl = U.el('span', 'd-note t-small c2 ell', this.chRow); this.noteEl.appendChild(document.createTextNode('')); }
    var el = this.noteEl, fx = fade && !this.noteV && t && !N.fx.reduced();
    this.noteV = t;
    if (fx) U.cls(el, 'out', true);
    U.setText(el.firstChild, t); U.show(el, !!t);
    if (fx) U.raf(function () { U.raf(function () { U.cls(el, 'out', false); }); });
  };
  /* o: {small: Titel kleiner (Folge), chips: [Text], line: Text (nur mit makeInfo o.line), note: Zeile einer Erweiterung (P.note)} */
  P.paint = function (ov, ti, me, de, o) {
    var info = this.info, fx = !N.fx.reduced(), small = !!(o && o.small), cs = o && o.chips || [];
    if (fx) U.cls(info, 'out', true);
    if (small !== !!this.small) { this.small = small; this.tiEl.className = small ? 'd-ti t-h1 ell' : 'd-ti t-display ell'; }
    U.setText(this.ovT, ov || ''); U.setText(this.tiT, ti || ''); U.setText(this.meT, me || ''); U.clampText(this.deT, de || '');
    for (var i = 0; i < this.chipEls.length; i++) { U.show(this.chipEls[i], !!cs[i]); U.setText(this.chipEls[i].firstChild, cs[i] || ''); }
    if (this.lineT) U.setText(this.lineT, o && o.line || '');
    this.note(o && o.note);
    if (fx) U.raf(function () { U.cls(info, 'out', false); });
  };
  /* Hintergrund: Art scharf, sonst Cover unscharf (vom Server vorgerechnet). title = fuer die Farbflaeche, wenn Bilder aus sind */
  P.loadBg = function (path, thumb, title) {
    if (!path && !thumb) return;
    this.needBg = false;
    if (N.comfort && !N.comfort.backgrounds()) { this.solid(title !== undefined ? title : this.title); return; }
    var self = this, b = N.img.bg(path, thumb);    // Art scharf, sonst Cover unscharf (640 breit, blur vom Server, mittig beschnitten)
    if (!b) return;
    setTimeout(function () {
      if (self.dead) return;
      self.bg.onload = function () { self.bg.onload = null; if (!self.dead) { N.img.fit(self.bg, b.soft); U.raf(function () { self.bg.style.visibility = 'visible'; }); } };
      self.bg.src = b.url;
    }, N.idle.restFor() < REST ? REST : 0);
  };
  P.setPoster = function (thumb, title) {
    var self = this;
    this.title = title;
    U.show(this.pfb, false);
    if (!thumb) { N.img.drop(this.poster); this.fallback(title); }
    else N.img.want(this.poster, N.img.url(thumb, this.sq ? 'cover' : 'poster'), 0, function (ok) { if (!ok && !self.dead) self.fallback(title); });
    if (this.needBg && !thumb) this.solid(title);
  };
  /* ruhige Farbflaeche je Titel (kein Bild bzw. Hintergrundbilder aus); nie eine graue Flaeche (Regel 11) */
  P.solid = function (title) { this.bgc.className = 'full ' + N.ui.avatarClass(title || ''); U.show(this.bgc, true); };
  P.fallback = function (title) { this.pfb.className = 'd-pfb ' + N.ui.avatarClass(title); U.setText(this.pfbT, title || ''); U.show(this.pfb, true); };
  /* erster Bildschirm (true) oder Abschnitte (false): Info gleitet nach oben, Cover blendet aus */
  P.hero = function (on) {
    if (this.on === on) return;
    this.on = on; N.fx.move(this.info);
    U.tf(this.info, on ? HERO_X : 0, on ? HERO_Y : 0);
    U.cls(this.pc, 'out', !on);
    if (this.hdr) U.cls(this.hdr, 'on', !on);
  };
  P.vis = function (on) { U.vis(this.pc, on); U.vis(this.info, on); };
  P.destroy = function () { this.dead = true; N.img.drop(this.poster); };
  N.ui.DetHero = DetHero;
})(N);
