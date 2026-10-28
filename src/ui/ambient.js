/* N.ui.Ambient – "Hintergrund in Bibliotheken" (Einstellungen > Oberflaeche; Logik in core/ambient.js N.amb).
 * Ebenen: ZWEI feste Vollbild-<img> (1280x720, translate3d = eigene GPU-Ebene, Bild wird nur als Textur skaliert) ganz unten in
 * der Ansicht. A liegt unten und bleibt deckend, nur B blendet (Deckkraft 0 <-> 1, 400 ms, keine z-index-/DOM-Wechsel):
 *   B aus  -> neues Bild in B laden, B einblenden;   B an -> neues Bild in A (unter B, unsichtbar), B ausblenden.
 * So laeuft je Wechsel genau EINE Deckkraft-Animation und es gibt nie ein Loch zum Grund.
 * Zeitpunkt: focus() im Fokusschritt merkt nur den Titel (N.amb.Settle: Flag + hoechstens ein Timer); geladen/gewechselt wird erst
 * nach 600 ms Ruhe (gehaltene Taste: nie), und das Einblenden startet erneut nur in Ruhe (wie der Hero, allein in einem Frame).
 * Reduzierte Bewegung: CSS .rm .amb-b ohne Uebergang = sofortiger Tausch. Modus "Aus": keine Elemente/Ebenen (wie bisher).
 * o: {lib: Bibliotheks-ID, type(): Typnummer fuer /all, items(): geladene Titel (Zufallsbild in Sammlungen / bei Fehler),
 *     get: Anfrage-Funktion wie N.plex.get (Weitere Server: an DEN Server der Bibliothek; Bildpfade tragen dann die Server-Marke)} */
(function (N) {
  var U = N.util, A = N.amb;
  function Ambient(root, o) {
    var self = this;
    this.root = root; this.o = o || {}; this.els = null; this.mode = ''; this.str = ''; this.key = ''; this.it = null;
    this.bOn = false; this.gen = 0; this.dead = false; this.fadeEnd = 0; this.rnd = false; this.req = null; this.rq = 0; this.waitT = 0;
    this.settle = new A.Settle(A.REST, function () { self._apply(); });
    /* TV-Nachmessung 28.10.: das Verlaufsbild (amb.png, 4–8 ms, Spitzen bis 23 ms) wird schon in der Idle-Queue gerechnet (160 ms nach
     * der letzten Taste, eigener Frame) -> nach 600 ms Ruhe holt _apply es nur noch aus dem Speicher und setzt src */
    /* Runde 5 (TV 28.10.: amb.apply im Titelbild-Modus noch 4,4–8,6 ms = Ziel + Bild-URL (Abfrage-Zeichenkette mit Token) + src): auch
     * die URL des Titelbilds rechnet die Idle-Queue vor (self.prep); _apply prueft nur noch den Schluessel und setzt src */
    this.pre = function () { if (!self.dead && self.on() && self.mode !== 'random') self.prep = self._url(A.target(self.it, self.mode)); };
    this.prep = null;
  }
  var warmed = false;
  var P = Ambient.prototype;
  /* Einstellung lesen (beim Betreten der Ansicht; Aenderung in den Einstellungen gilt bei der Rueckkehr). true = geaendert */
  P.sync = function () {
    var st = N.session && N.session.settings, bg = !N.comfort || N.comfort.backgrounds();
    var m = A.effective(A.mode(st), bg), s = A.strength(st);
    if (m === this.mode && s === this.str) return false;
    if (m !== 'random' || this.mode !== 'random') { this.rnd = false; this.rq++; }
    this.mode = m; this.str = s; this.key = ''; this.gen++;
    U.cls(this.root, 'amb-on', m !== 'off');          // Lesbarkeits-Regeln in app.css (.amb-on …)
    if (m === 'off') { this._hide(); return true; }
    this._make();
    return true;
  };
  P.on = function () { return this.mode !== '' && this.mode !== 'off'; };
  P._make = function () {
    if (this.els) { U.show(this.els[0], true); U.show(this.els[1], true); return; }
    if (!warmed) { warmed = true; N.idle.add(A.warm, 'amb-warm'); }   // Tabellen + erster Durchlauf vorab (nicht im ersten Wechsel)
    var r = this.root, a = U.el('img', 'amb', r), b = U.el('img', 'amb amb-b', r);
    a.src = N.img.BLANK; b.src = N.img.BLANK; U.vis(a, false);
    r.insertBefore(b, r.firstChild); r.insertBefore(a, b);   // ganz unten (vor Titel, Raster, A–Z …)
    this.els = [a, b]; this.bOn = false;
  };
  P._hide = function () {
    this.settle.cancel();
    if (!this.els) return;
    var a = this.els[0], b = this.els[1];
    a.onload = a.onerror = b.onload = b.onerror = null;
    U.show(a, false); U.show(b, false); U.vis(a, false); U.cls(b, 'on', false); this.bOn = false;
  };
  /* Ansicht betreten (erstes Mal und Rueckkehr): Einstellung pruefen; Zufallsbild einmal je Oeffnen */
  P.enter = function () {
    var ch = this.sync();
    if (ch && this.it && this.mode !== 'random') this.settle.poke();
    if (this.mode === 'random' && !this.rnd) { this.rnd = true; this.it = null; this._random(); }
  };
  /* Fokus gewechselt (im Tastenpfad: nur merken) */
  P.focus = function (it) {
    if (this.mode === 'random') return;
    this.it = it;
    if (this.mode === 'mood' || this.mode === 'art') { this.settle.poke(); N.idle.add(this.pre, 'amb-pre'); }
  };
  /* Daten angekommen (Sammlung bzw. Rueckfall): Zufallsbild aus den geladenen Titeln, falls noch keins gewaehlt */
  P.data = function () {
    if (this.mode === 'random' && !this.it && !this.req && this.o.items) this._pick(this.o.items());
  };
  P._pick = function (list) {
    var n = list ? list.length : 0, start = n ? Math.floor(Math.random() * n) : 0, rot = [];
    for (var i = 0; i < n; i++) rot.push(list[(start + i) % n]);   // geladene Titel: zufaelliger Startpunkt
    this.it = A.pickRandom(rot);
    if (this.it) this.settle.poke();
  };
  /* EINE Anfrage je Oeffnen: GET …/all?sort=random (10 Titel, schlanke Felder), erster mit Art */
  P._random = function () {
    var self = this, o = this.o;
    if (!o.lib || o.coll) { this.data(); return; }
    var rq = ++this.rq;
    this.req = (o.get || N.plex.get)('/library/sections/' + o.lib + '/all', { type: o.type ? o.type() : 1, sort: 'random', 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 10,
      excludeElements: N.hubs.EXCL, excludeFields: 'summary,tagline' }, { timeout: 8000 }, function (err, d) {
      self.req = null;
      if (self.dead || rq !== self.rq) return;
      var mc = !err && d && d.MediaContainer, list = mc ? N.model.normList(mc.Metadata || [], null, o.lib, true) : [];
      if (A.pickRandom(list)) { self.it = A.pickRandom(list); self.settle.poke(); } else self.data();
    });
  };
  /* nach der Ruhe: Ziel bestimmen, ins verdeckte Bild laden */
  P._apply = function () {
    if (this.dead || !this.on() || !this.els) return;
    if (U.now() < this.fadeEnd) { this._later(this.fadeEnd - U.now() + 20); return; }   // laufende Ueberblendung abwarten
    var t = A.target(this.it, this.mode === 'random' ? 'art' : this.mode);
    if (t.key === this.key) return;
    this.key = t.key;
    var p = this.prep && this.prep.key === t.key && this.prep.str === this.str ? this.prep : this._url(t);   // meist schon im Idle gerechnet
    this.prep = null;
    var url = p.url, soft = p.soft;
    var self = this, gen = ++this.gen, img = this.bOn ? this.els[0] : this.els[1];
    img.onload = function () {
      img.onload = img.onerror = null;
      if (gen !== self.gen || self.dead) return;
      N.img.fit(img, soft);
      self._show(gen, img);
    };
    img.onerror = function () { img.onload = img.onerror = null; if (gen === self.gen) self.key = ''; };
    this._src(img, url);
  };
  /* eigener Name: das Frame-Protokoll zeigt den Anteil der src-Zuweisung ('amb.src') */
  P._src = function (img, url) { img.src = url; };
  /* Ziel -> {key, str, url, soft}: Verlaufsbild (data:-URI) bzw. Titel-/Posterbild vom Server (unscharf, abgedunkelt) bzw. Grund */
  P._url = function (t) {
    var url, soft = false, ao;
    if (t.mood) url = A.moodUrl(t.mood, this.str);
    else if (t.art || t.thumb) { ao = A.artOpts(this.str); url = N.img.url(t.art || t.thumb, 'amb', ao); soft = !t.art; }   // Poster 2:3 -> mittig beschnitten (N.img.fit)
    else url = A.baseUrl();
    return { key: t.key, str: this.str, url: url, soft: soft };
  };
  P._later = function (ms) {
    var self = this;
    if (this.waitT) clearTimeout(this.waitT);
    this.waitT = setTimeout(function () { self.waitT = 0; self._apply(); }, ms);
  };
  /* Einblenden nur in Ruhe und allein in einem Frame (Bild ist dann geladen und dekodierbar) */
  P._show = function (gen, img) {
    var self = this, rest = N.idle.restFor();
    if (gen !== this.gen || this.dead) return;
    if (rest < A.REST) { setTimeout(function () { self._show(gen, img); }, A.REST - rest + 10); return; }
    U.raf(function () {
      if (gen !== self.gen || self.dead) return;
      var a = self.els[0], b = self.els[1];
      if (img === b) { U.cls(b, 'on', true); self.bOn = true; }
      else { U.vis(a, true); U.cls(b, 'on', false); self.bOn = false; }
      self.fadeEnd = U.now() + (N.fx.reduced() ? 0 : A.FADE + 40);
    });
  };
  P.destroy = function () {
    this.dead = true; this.settle.cancel();
    if (this.waitT) { clearTimeout(this.waitT); this.waitT = 0; }
    if (this.req && this.req.abort) this.req.abort();
    this.req = null;
    if (this.els) { var a = this.els[0], b = this.els[1]; a.onload = a.onerror = b.onload = b.onerror = null; }
  };
  N.ui.Ambient = Ambient;
})(N);
