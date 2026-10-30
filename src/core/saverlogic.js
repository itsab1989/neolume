/* N.saverLogic – reine Logik des Bildschirmschoners (ohne DOM, in Node getestet; tests/saver.test.js). Ansicht: ui/saver.js,
 * Bibliotheks-Quelle (Netz): plex/saverlib.js.
 * - Uebergaenge (Einstellung "Bildübergang"): nur, was am Orsay-TV fluessig laeuft = opacity und -webkit-transform auf
 *   GPU-Ebenen, Bild vorher fertig geladen und gezeichnet (Begruendung und Ebenen-Budget: docs/ARCHITEKTUR.md "Bildschirmschoner").
 *   "Reduzierte Bewegung": alles mit Bewegung (Zoom, Gleiten, Durchflug, Vorhang, Jalousie, Kacheln) -> Ueberblenden.
 * - Ken-Burns-Posen (Langsamer Zoom/Gleiten): nie ueber den Bildrand hinaus (Pruefung in den Tests).
 * - Zufallsbeutel ohne Wiederholung (Startseiten-Bilder) und Bibliotheks-Pool (Seiten in zufaelliger Reihenfolge, Titel
 *   mehrerer Seiten/Bibliotheken gemischt, je Titel einmal, bis alle gezeigt sind; dann neue Runde).
 * - Ecken des Info-Blocks (Uhr, Titel, Zeile): wechseln nur zusammen mit dem Bild (gegen Einbrennen). */
(function (N) {
  var PAGE = 30, MIX = 3, OV_W = 1000, OV_H = 460;
  /* Dauer je Uebergang (ms); cut = harter Schnitt. Reihenfolge = Reihenfolge in der Einstellung */
  var FX_MS = { cut: 0, fade: 1500, dip: 1600, zoom: 1500, drift: 1500, fly: 1400, curtain: 1600, blinds: 1500, tiles: 1600 };
  var CALM = { cut: 1, fade: 1, dip: 1 };            // ohne Bewegung: bleiben bei "Reduzierte Bewegung"
  var FX = ['cut', 'fade', 'dip', 'zoom', 'drift', 'fly', 'curtain', 'blinds', 'tiles', 'random'];
  /* Info-Block: Behaelter 1000 x 460 (Abdunklung scrim-saver.png + Text) in einer der 4 Ecken; Reihenfolge links unten,
   * rechts unten, rechts oben, links oben. r = rechtsbuendig, t = oben */
  var CORNERS = [{ x: 0, y: 720 - OV_H, r: false, t: false, ty: 0 }, { x: 1280 - OV_W, y: 720 - OV_H, r: true, t: false, ty: 0 },
    { x: 1280 - OV_W, y: 0, r: true, t: true, ty: 0 }, { x: 0, y: 0, r: false, t: true, ty: 0 }];
  /* Einblendung (Einstellung saverInfo): Behaelter w x h mit einer vorgerechneten Abdunklung (PNG, kein CSS-Verlauf/-Blur) und
   * Positionen p (x, y, r = rechtsbuendig, t = oben, ty = Text um ty px nach oben versetzt). Die Position wechselt nur mit dem Bild
   * (Einbrennen): Ecken reihum, Grosse Uhr in 4 leicht versetzten Lagen um die Mitte, Leisten unten mit 4 Text-Hoehen bzw. links/rechts.
   * Abdunklung buendig (TV-Befund 28.10.: Luecke zwischen Schatten und Bildschirmrand): Eck-Schatten liegen immer exakt in der Ecke,
   * je Ecke ein eigenes, fertig gespiegeltes Bild (scrim-saver[-br|-tr|-tl].png, keine CSS-Spiegelung); die Leisten-Abdunklung liegt
   * immer unten am Rand (y BAND_Y) – fuer das Wandern bewegt sich nur der Text (ty). edge = Raender, die die Abdunklung beruehren muss
   * (Layout-Pruefung "edge").
   * Band unten (Filmplakat, Untertitel-Leiste): 1280 x 520 ab y 200 (bis 1.0.5: 340 hoch ab y 380, Rampe 215 px auf 0,74 – der Beginn
   * der Abdunklung war auf hellen Bildern als Kante sichtbar). Jetzt laeuft sie ueber 310 px sanft auf nur 0,5 (genau so viel, wie
   * Zeile und Uhr in text-soft auf weissem Bild fuer 4,5:1 brauchen); siehe tools/make_assets.js scrimBand. */
  function pos(x, y, r, t, ty) { return { x: x, y: y, r: !!r, t: !!t, ty: ty || 0 }; }
  function cornerScr(p) { return 'scrim-saver' + (p.r || p.t ? '-' + (p.t ? 't' : 'b') + (p.r ? 'r' : 'l') : '') + '.png'; }
  /* Nur kleine Uhr: eigene kleine Eck-Schatten in Anzeigegroesse 420x200 (TV-Befund 28.10. abends: das gestauchte 1000x460-Bild war ein harter Fleck) */
  function miniScr(p) { return cornerScr(p).replace('scrim-saver', 'scrim-saver-m'); }
  function cornerEdge(p) { return [p.r ? 'r' : 'l', p.t ? 't' : 'b']; }
  var BAND_EDGE = ['l', 'r', 'b'], BAND_H = 520, BAND_Y = 720 - BAND_H;
  var INFO = {
    ambient: { w: OV_W, h: OV_H, scr: cornerScr, edge: cornerEdge, p: CORNERS },
    classic: { w: OV_W, h: OV_H, scr: '', p: CORNERS },
    poster: { w: 1280, h: BAND_H, scr: 'scrim-saver-b.png', edge: BAND_EDGE, p: [pos(0, BAND_Y), pos(0, BAND_Y, 1), pos(0, BAND_Y, 0, 0, 16), pos(0, BAND_Y, 1, 0, 16)] },
    lower: { w: 1280, h: BAND_H, scr: 'scrim-saver-b.png', edge: BAND_EDGE, p: [pos(0, BAND_Y), pos(0, BAND_Y, 0, 0, 24), pos(0, BAND_Y, 0, 0, 12), pos(0, BAND_Y, 0, 0, 36)] },
    bigclock: { w: 1200, h: 600, scr: 'scrim-saver-c.png', p: [pos(40, 60), pos(76, 80), pos(40, 100), pos(4, 80)] },
    minimal: { w: 420, h: 200, scr: miniScr, edge: cornerEdge, p: [pos(0, 520), pos(860, 520, 1), pos(860, 0, 1, 1), pos(0, 0, 0, 1)] },
    off: { w: 0, h: 0, scr: '', p: [pos(0, 0)] }
  };
  /* Ken Burns: [s0, x0, y0, s1, x1, y1] (Skalierung um die Mitte, Verschiebung in px). Grenze: |x| <= (s-1)*640, |y| <= (s-1)*360 */
  var KB = {
    zoom: [[1, 0, 0, 1.08, -36, -18], [1.08, 36, 18, 1, 0, 0], [1, 0, 0, 1.08, 36, -16], [1.08, -36, 16, 1, 0, 0]],
    drift: [[1.08, -40, 0, 1.08, 40, 0], [1.08, 40, 0, 1.08, -40, 0], [1.08, 0, -22, 1.08, 0, 22], [1.08, 20, 22, 1.08, -20, -22]]
  };
  function rnd0(r) { return typeof r === 'function' ? r() : r === undefined ? Math.random() : r; }
  function shuffle(a, rnd) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rnd0(rnd) * (i + 1)); if (j > i) j = i; var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function tf(s, x, y) { return 'translate3d(' + x + 'px,' + y + 'px,0)' + (s !== 1 ? ' scale(' + s + ')' : ''); }

  var L = {
    PAGE: PAGE, MIX: MIX, OV_W: OV_W, OV_H: OV_H, FX: FX, FX_MS: FX_MS, CALM: CALM, CORNERS: CORNERS, KB: KB,
    SEC: [10, 20, 30, 60],
    TYPE: { movie: 1, show: 2, artist: 8 },
    /* Einstellung -> tatsaechlicher Uebergang. reduced: "Reduzierte Bewegung"; rnd: Zahl 0..1 oder Funktion; last: letzter (Zufall
     * wiederholt ihn nicht). Unbekannt -> Ueberblenden */
    fx: function (want, reduced, rnd, last) {
      var k;
      if (want === 'random') {
        var ok = [];
        for (k = 0; k < FX.length; k++) if (FX_MS[FX[k]] && (!reduced || CALM[FX[k]]) && FX[k] !== last) ok.push(FX[k]);
        return ok[Math.min(ok.length - 1, Math.floor(rnd0(rnd) * ok.length))];
      }
      if (!Object.prototype.hasOwnProperty.call(FX_MS, want)) return 'fade';
      return reduced && !CALM[want] ? 'fade' : want;
    },
    /* Bildwechsel alle n Sekunden -> ms (nur Werte aus SEC, sonst 30 s) */
    /* Wann blendet der Info-Block mit dem NEUEN Titel wieder ein (ms nach Beginn des Bilduebergangs)? Schnitt: im selben Frame
     * (Bild und Text wechseln zusammen). Sonst erst, wenn das neue Bild ganz steht (TV-Test 29.10.: ein Kamerabild zeigte den neuen
     * Titel noch ueber dem alten Bild, weil der Text gleichzeitig mit dem Uebergang einblendete). Erstes Bild (aus Schwarz, kein altes
     * Bild darunter): sofort. */
    infoIn: function (fx, d, first) { return first || fx === 'cut' || !(d > 0) ? 0 : d; },
    interval: function (sec) { var n = Number(sec); return (L.SEC.indexOf(n) >= 0 ? n : 30) * 1000; },
    /* "Nach langer Zeit nur noch die Uhr" (SAV-6, Nutzer-Befund 29.10.: TV nach ~8 h Schoner eingefroren): Minuten im Schoner, nach
     * denen er keine Bilder mehr wechselt (0 = Nie). Nur Werte aus NIGHT, sonst 120 (Standard). -> ms (0 = nie) */
    NIGHT: [60, 120, 240, 0],
    night: function (min) {
      var n = typeof min === 'number' || (typeof min === 'string' && min !== '') ? Number(min) : NaN;   // null/''/false sind nicht "Nie"
      return (L.NIGHT.indexOf(n) >= 0 ? n : 120) * 60000;
    },
    corner: function (i) { return CORNERS[((i % 4) + 4) % 4]; },
    INFO: INFO, INFOS: ['ambient', 'classic', 'poster', 'lower', 'bigclock', 'minimal', 'off'],
    /* Stil (unbekannt -> ambient) und Lage Nr. i -> {style, w, h, scr, x, y, r, t, ty, edge} */
    info: function (style, i) {
      var st = Object.prototype.hasOwnProperty.call(INFO, style) ? style : 'ambient', d = INFO[st], p = d.p[((i % d.p.length) + d.p.length) % d.p.length];
      return { style: st, w: d.w, h: d.h, scr: typeof d.scr === 'function' ? d.scr(p) : d.scr, x: p.x, y: p.y, r: p.r, t: p.t, ty: p.ty || 0,
        edge: typeof d.edge === 'function' ? d.edge(p) : d.edge || [] };
    },
    /* Was zeigt der Stil? "Uhrzeit anzeigen" aus blendet die Uhr in JEDEM Stil aus; reine Uhr-Stile zeigen dann nichts */
    /* night: Nachtruhe (SAV-6) – nur noch die Uhr, kein Titel/keine Zeile (ohne Uhr: ganz schwarz) */
    infoParts: function (style, clock, night) {
      var st = Object.prototype.hasOwnProperty.call(INFO, style) ? style : 'ambient';
      var text = !night && st !== 'off' && st !== 'bigclock' && st !== 'minimal';
      return { clock: st !== 'off' && !!clock, title: text, any: text || (st !== 'off' && !!clock) };
    },
    /* Pose v (0..3) fuer zoom/drift -> {from, to} als -webkit-transform-Text, raw = Zahlen (Tests) */
    pose: function (kind, v) {
      var p = (KB[kind] || KB.zoom)[((v % 4) + 4) % 4];
      return { from: tf(p[0], p[1], p[2]), to: tf(p[3], p[4], p[5]), raw: p };
    },
    tf: tf,
    /* Teile je Uebergang: Jalousie 8 Streifen, Kacheln 3 x 2. TV-Befund 28.10.: Kacheln mit 4 x 3 = 12 eigenen GPU-Ebenen liefen mit
     * 48 fps und einem 156-ms-Frame -> halb so viele Ebenen/Zeichnungen (jede Kachel malt ihren Ausschnitt des Bilds einmal). */
    PARTS: { blinds: [8, 1], tiles: [3, 2] },
    /* cols x rows Teile ueber w x h (Standard 1280 x 720), Kanten auf ganzen Pixeln (keine Haarlinien bei 1280 / 3):
     * [{x, y, w, h}] Zeile fuer Zeile, luecken- und ueberlappungsfrei */
    grid: function (cols, rows, w, h) {
      var out = [], r, c, x0, y0, x1, y1;
      w = w || 1280; h = h || 720;
      for (r = 0; r < rows; r++) {
        y0 = Math.round(r * h / rows); y1 = Math.round((r + 1) * h / rows);
        for (c = 0; c < cols; c++) {
          x0 = Math.round(c * w / cols); x1 = Math.round((c + 1) * w / cols);
          out.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
        }
      }
      return out;
    },
    /* Jalousie (Streifen von links nach rechts) bzw. Kacheln (zufaellige Reihenfolge): Verzoegerung je Teil in ms */
    delays: function (n, step, ordered, rnd) {
      var o = [], i;
      for (i = 0; i < n; i++) o.push(i);
      if (!ordered) shuffle(o, rnd);
      var d = [];
      for (i = 0; i < n; i++) d[o[i]] = i * step;
      return d;
    },
    /* Zeile unter dem Titel: "Film · 2019", "Serie · S2 · F4", "Serie · 2015", "Musik" */
    meta: function (it) {
      if (!it) return '';
      var p = [];
      if (it.type === 'movie') p.push(N.t('ss.saver.movie'));
      else if (it.type === 'show' || it.type === 'episode' || it.type === 'season') p.push(N.t('ss.saver.show'));
      else if (it.type === 'artist' || it.type === 'album') p.push(N.t('ss.saver.music'));
      if (it.type === 'episode' && it.s >= 0 && it.e > 0) p.push(N.t('ss.saver.ep', { s: it.s, e: it.e }));
      else if (it.year) p.push(String(it.year));
      return p.join(' · ');
    },
    /* Bibliotheken fuer die Quelle "Bibliotheken": sel = Einstellung saverLibs (null = alle Film- und Serien-Bibliotheken),
     * libs = Bibliotheken des Profils (Home-Cache alibs/libs; Kinderprofile sehen nur ihre). Nur Film/Serie/Musik. */
    libs: function (sel, libs) {
      var out = [], i;
      for (i = 0; libs && i < libs.length; i++) {
        var l = libs[i];
        if (!L.TYPE[l.type]) continue;
        if (sel && sel.length ? sel.indexOf(Number(l.id)) >= 0 : l.type !== 'artist') out.push(l);
      }
      return out;
    },
    /* Anfrage einer Seite (bzw. size 0 = nur Anzahl) aus /library/sections/<id>/all */
    query: function (lib, start, size, unwatched) {
      var q = { type: L.TYPE[lib.type] || 1, sort: 'titleSort', 'X-Plex-Container-Start': start, 'X-Plex-Container-Size': size };
      if (size) { q.excludeElements = N.hubs ? N.hubs.EXCL : ''; q.excludeFields = 'summary,tagline'; }
      if (unwatched && lib.type === 'movie') q.unwatched = 1;
      if (unwatched && lib.type === 'show') q.unwatchedLeaves = 1;
      return q;
    },
    /* Einstellung "Bilder im Bildschirmschoner" (saverPics): art = nur echte Hintergrundbilder (Standard), stills = auch vom PMS
     * aus dem Video gezogene Standbilder, poster = Plakat/Cover scharf auf unscharfem Grund. Unbekannt -> art */
    PICS: ['art', 'stills', 'poster'],
    pics: function (v) { return L.PICS.indexOf(v) >= 0 ? v : 'art'; },
    /* Musik: Cover/Kuenstlerbild quadratisch (Groesse der Anfrage; die echte Form liefert das geladene Bild) */
    square: function (it) { return !!it && (it.type === 'artist' || it.type === 'album' || it.type === 'track'); },
    /* Standbild oder echtes Hintergrundbild? Untersuchung am echten PMS 28.10. (read-only, 539 Filme, 63 Serien, 125 Kuenstler):
     * Listen und Detailseiten zeigen fuer beide dieselbe Form (art = /library/metadata/<id>/art/<zeit>, Image type=background) –
     * unterscheidbar ist erst die Bildauswahl /library/metadata/<id>/arts: der Eintrag mit selected=true hat als ratingKey
     *   media://<h>/<hash>.bundle/Contents/Art/art1.jpg = vom PMS aus der Videodatei gezogenes Standbild (alle 60 gemessenen
     *     1280x720 bzw. 1279x720, teils mit schwarzen Balken; echte Bilder meist 1920x1080 bis 3840x2160),
     *   metadata://art/tv.plex.agents.…_<hash> (provider tmdb/gracenote/plex/fanarttv) bzw. upload://… = echte Hintergrundbilder.
     * Ohne ausgewaehlten Eintrag: nur media://-Eintraege -> Standbild, sonst unbekannt (gilt als echt).
     * artOwner: art-Pfad (ggf. mit Server-Marke '@<id>|') -> {rk, srv} oder null (keine PMS-Art -> nicht pruefbar, gilt als echt). */
    artOwner: function (art) {
      var m = /^(?:@([^|]+)\|)?\/library\/metadata\/(\d+)\/art(?:\/|$)/.exec(String(art || ''));
      return m ? { rk: m[2], srv: m[1] || '' } : null;
    },
    /* Antworttext von /arts (JSON, ungeparst – bis ~50 KB, am TV nur Zeichensuche statt JSON.parse) -> 'still' | 'real' | '' */
    artKind: function (txt) {
      if (typeof txt !== 'string' || !txt) return '';
      var i = txt.search(/"selected"\s*:\s*true/), RK = /"ratingKey"\s*:\s*"([^"]*)"/g, m, n = 0, med = 0;
      if (i >= 0) {
        var a = txt.lastIndexOf('{', i), b = txt.indexOf('}', i);
        m = /"ratingKey"\s*:\s*"([^"]*)"/.exec(txt.substring(a < 0 ? 0 : a, b < 0 ? txt.length : b));
        if (!m) return '';
        return m[1].indexOf('media:') === 0 ? 'still' : 'real';
      }
      while ((m = RK.exec(txt))) { n++; if (m[1].indexOf('media:') === 0) med++; }
      return n && med === n ? 'still' : '';
    },
    /* Modus "Poster und Cover": Groesse aus dem Seitenverhaeltnis (nw x nh; Musik meist quadratisch) und Lage passend zur
     * Einblendung Nr. i: Eck-Stile -> Poster auf der Seite gegenueber dem Text, Leisten unten -> mittig darueber, Grosse Uhr -> Gruppe
     * mit der Uhr (bigGroup), sonst mittig. -> {x, y, w, h} (ganze Pixel, immer im Bild) */
    posterBox: function (style, i, nw, nh) {
      var c = L.info(style, i), st = c.style, band = st === 'poster' || st === 'lower', ar = nw > 0 && nh > 0 ? nw / nh : 2 / 3;
      if (st === 'bigclock') return L.bigGroup(i, nw, nh).p;
      var H = band ? 400 : 540, W = 600, w, h;
      if (ar > 0.9) H = Math.round(H * 0.85);             // quadratisch (Cover/Kuenstler): etwas kleiner, wirkt sonst wuchtig
      h = H; w = Math.round(H * ar);
      if (w > W) { w = W; h = Math.round(W / ar); }
      var x = Math.round((1280 - w) / 2);
      if (st === 'ambient' || st === 'classic' || st === 'minimal') x = c.r ? 150 : 1280 - 150 - w;
      return { x: x, y: band ? 56 : Math.round((720 - h) / 2), w: w, h: h };
    },
    /* Grosse Uhr + Poster (TODO nach 1.0.5: Plakat links + Uhr wirkten nicht als Gruppe): Plakat und Uhr bilden EINE Gruppe, die als
     * Ganzes waagerecht mittig steht – Plakat links, CK_GAP Abstand, dann ein fester Uhr-Platz CK_W (Ziffern darin mittig; sichtbarer Abstand zur
     * ersten Ziffer so ~70–80 px, etwa ein Viertel der Plakatbreite). Fest statt
     * gemessen: die Uhr ist immer HH:MM (24 h, in jeder Sprache gleich), CK_W = breiteste Zeit "00:00" in Inter 180/300 (~420 px) +
     * Reserve fuer die breitere TV-Systemschrift; so springt die Gruppe nicht jede Minute und es gibt kein Messen (Layout) zur Laufzeit.
     * Senkrecht: Plakat-Mitte = Ziffern-Mitte (Zeilenmitte der Uhr: Einblendung y + 300). Die 4 Lagen gegen Einbrennen verschieben die
     * ganze Gruppe (dx = x - 40, Uhr-Mitte = y + 300). -> {p: {x, y, w, h}, ck: {x, w}} in Bildschirm-Koordinaten */
    CK_W: 440, CK_GAP: 56,
    bigGroup: function (i, nw, nh) {
      var c = L.info('bigclock', i), ar = nw > 0 && nh > 0 ? nw / nh : 2 / 3, H = 440, W = 296, w, h;
      if (ar > 0.9) H = Math.round(H * 0.85);
      h = H; w = Math.round(H * ar);
      if (w > W) { w = W; h = Math.round(W / ar); }
      var x = Math.round((1280 - (w + L.CK_GAP + L.CK_W)) / 2) + c.x - 40, cy = c.y + 300;
      return { p: { x: x, y: Math.round(cy - h / 2), w: w, h: h }, ck: { x: x + w + L.CK_GAP, w: L.CK_W } };
    },
    /* Schatten unter dem Plakat (TODO nach 1.0.5: Plakat ohne Tiefe): vorgerechnetes PNG (tools/make_assets.js posterShadows), weich,
     * leicht nach unten versetzt; kein CSS-Schatten/-Blur (Orsay). Das Bild ist fuer ein Plakat pw x ph mit Rand m gerechnet und wird
     * auf das echte Plakat gestreckt (Rand mitgestreckt; Hochformat und quadratisch je ein eigenes Bild, damit die Streckung klein bleibt).
     * p = Plakat {x, y, w, h} -> {f: Datei, x, y, w, h} */
    SHADOW: { tall: { f: 'saver-shadow.png', pw: 300, ph: 450, m: 40 }, sq: { f: 'saver-shadow-sq.png', pw: 380, ph: 380, m: 40 } },
    shadowBox: function (p) {
      var s = p.w / p.h > 0.9 ? L.SHADOW.sq : L.SHADOW.tall, sx = p.w / s.pw, sy = p.h / s.ph;
      return { f: s.f, x: Math.round(p.x - s.m * sx), y: Math.round(p.y - s.m * sy), w: Math.round((s.pw + 2 * s.m) * sx), h: Math.round((s.ph + 2 * s.m) * sy) };
    },
    /* Pause-Schoner (ein Bild: der pausierte Titel) nach "Bilder im Bildschirmschoner": mode (pics), hasArt/hasThumb (Hintergrund-
     * bild/Plakat vorhanden), kind = Ergebnis der Standbild-Pruefung (undefined = noch nicht geprueft, '' = unbekannt -> gilt als echt).
     * -> 'art' (Hintergrundbild), 'poster' (Poster-Darstellung), 'check' (erst pruefen) oder '' (kein Bild, nur Text/Uhr).
     * Poster und Cover: Plakat. Nur echte Hintergrundbilder: ist das Hintergrundbild ein Standbild, zeigt der Pause-Schoner das Plakat
     * (wie der Schoner, der nach 12 Standbildern das Plakat nimmt); ohne Plakat bleibt das Standbild (nie schwarz). Auch Standbilder:
     * Hintergrundbild. Ohne Hintergrundbild in jedem Modus das Plakat (es gibt keinen anderen Titel, den man stattdessen zeigen koennte). */
    pausedPic: function (mode, hasArt, hasThumb, kind) {
      mode = L.pics(mode);
      if (!hasArt || (mode === 'poster' && hasThumb)) return hasThumb ? 'poster' : '';
      if (mode !== 'art' || !hasThumb) return 'art';
      if (kind === undefined) return 'check';
      return kind === 'still' ? 'poster' : 'art';
    },
    Bag: Bag,
    Pool: Pool
  };

  /* Zufallsbeutel: jede Nummer 0..n-1 einmal, dann neu gemischt; nie dieselbe zweimal hintereinander (auch ueber die Runde) */
  function Bag(n, rnd) { this.n = n; this.rnd = rnd; this.left = []; this.last = -1; }
  Bag.prototype.next = function () {
    if (this.n <= 0) return -1;
    if (!this.left.length) {
      for (var i = 0; i < this.n; i++) this.left.push(i);
      shuffle(this.left, this.rnd);
      if (this.n > 1 && this.left[this.left.length - 1] === this.last) { var t = this.left[0]; this.left[0] = this.last; this.left[this.left.length - 1] = t; }
    }
    this.last = this.left.pop();
    return this.last;
  };

  /* Bibliotheks-Pool: totals = [{lib, n}] (Anzahl je Bibliothek, aus einer Anfrage mit Size=0). Jede Bibliothek hat ihren eigenen
   * Vorrat: Seiten zu PAGE Titeln in zufaelliger Reihenfolge, gezeigt = gemerkt (rk), bis alle Seiten DIESER Bibliothek durch sind ->
   * neue Runde nur fuer sie. So gibt es keine Wiederholung innerhalb einer Bibliothek, bis sie ganz gezeigt ist, und je PAGE Bilder
   * nur EINE Anfrage (sort=random kann das nicht: jede Seite waere neu gewuerfelt und Wiederholungen nicht ausgeschlossen).
   * Mischen (Nutzerwunsch 30.10.: Filme UND Serien bunt gemischt, nicht alphabetisch): die Bibliotheken kommen reihum dran, je
   * Durchgang in zufaelliger Reihenfolge (Bag: nie dieselbe zweimal hintereinander) – unabhaengig von ihrer Groesse (540 Filme
   * neben 64 Serien: trotzdem jedes zweite Bild eine Serie; die kleine Bibliothek beginnt eben frueher eine neue Runde). Innerhalb
   * einer Bibliothek haelt der Vorrat Titel aus bis zu MIX Seiten; jede neue Seite wird gemischt und zufaellig zwischen den Vorrat
   * gestreut (eine Seite allein waeren 30 alphabetisch benachbarte Titel). Kosten: zu Beginn bis zu MIX Seiten je Bibliothek
   * (nacheinander, je Bildwechsel eine), danach eine je PAGE Bilder einer Bibliothek. */
  function Pool(rnd) { this.rnd = rnd; this.totals = []; this.libs = []; this.bag = null; this.pend = null; this.lastB = null; this.round = 0; this.last = ''; }
  Pool.prototype.setTotals = function (totals) { this.totals = totals || []; this.newRound(); };
  Pool.prototype.size = function () { var n = 0; for (var i = 0; i < this.totals.length; i++) n += this.totals[i].n; return n; };
  /* neue Runde fuer alle Bibliotheken (Auswahl neu) */
  Pool.prototype.newRound = function () {
    this.libs = [];
    for (var i = 0; i < this.totals.length; i++) {
      var b = { lib: this.totals[i].lib, n: this.totals[i].n, q: [], seen: {}, pages: [], round: 0 };
      this.renew(b); this.libs.push(b);
    }
    this.bag = new Bag(this.libs.length, this.rnd); this.pend = null; this.lastB = null; this.round++;
  };
  /* neue Runde fuer EINE Bibliothek: alle ihre Seiten neu gemischt, Gemerktes vergessen */
  Pool.prototype.renew = function (b) {
    var p = [];
    for (var s = 0; s < b.n; s += PAGE) p.push(s);
    if (b.round && !b.got) b.dead = true;                  // eine ganze Runde ohne ein Bild: nie wieder anfragen (Anfrage-Budget)
    b.pages = shuffle(p, this.rnd); b.seen = {}; b.round++; b.got = 0;
  };
  function wants(b) { return !b.dead && b.q.length < (MIX - 1) * PAGE && (b.pages.length > 0 || !b.q.length); }
  /* naechste zu ladende Seite {lib, start} oder null: die Bibliothek mit dem kleinsten Vorrat, die Nachschub braucht; ist sie ganz
   * gezeigt (Vorrat leer, keine Seite mehr), beginnt sie eine neue eigene Runde */
  Pool.prototype.nextPage = function () {
    var best = null, i, b;
    for (i = 0; i < this.libs.length; i++) { b = this.libs[i]; if (wants(b) && (!best || b.q.length < best.q.length)) best = b; }
    if (!best) return null;
    if (!best.pages.length) this.renew(best);
    if (!best.pages.length) return null;
    this.pend = best;
    return { lib: best.lib, start: best.pages.shift() };
  };
  function libOf(P, lib) {
    for (var i = 0; i < P.libs.length; i++) if (P.libs[i].lib === lib || (P.libs[i].lib && P.libs[i].lib.id === lib.id)) return P.libs[i];
    return null;
  }
  /* geladene Titel (N.model-Objekte) der zuletzt angefragten Seite (oder der Bibliothek lib) aufnehmen: nur mit Bild (need 'art' =
   * Hintergrund, Standard; 'thumb' = Poster/Cover), je Titel einmal je Runde der Bibliothek; gemischt in deren Vorrat gestreut
   * (take() nimmt vom Ende) */
  Pool.prototype.add = function (items, need, lib) {
    var b = (lib && libOf(this, lib)) || this.pend || this.libs[0];
    if (!b) return 0;
    var add = [], i, k = need || 'art';
    for (i = 0; items && i < items.length; i++) {
      var it = items[i];
      if (!it || !it[k] || b.seen[it.rk]) continue;
      b.seen[it.rk] = 1;
      add.push(it);
    }
    shuffle(add, this.rnd);
    var old = b.q, out = [], a = 0, c = 0;
    while (a < old.length || c < add.length) {
      var na = old.length - a, nb = add.length - c;
      if (!nb || (na && rnd0(this.rnd) * (na + nb) < na)) out.push(old[a++]); else out.push(add[c++]);
    }
    var n = out.length;
    if (n > 1 && out[n - 1].rk === this.last) { var t = out[n - 1]; out[n - 1] = out[0]; out[0] = t; }   // nie zweimal hintereinander (Rundenwechsel)
    b.q = out; b.got += add.length;
    return add.length;
  };
  /* Titel im Vorrat (alle Bibliotheken) */
  Pool.prototype.count = function () { var n = 0; for (var i = 0; i < this.libs.length; i++) n += this.libs[i].q.length; return n; };
  /* naechster Titel (oder null: nachladen): reihum, je Durchgang zufaellige Reihenfolge; eine Bibliothek ohne Vorrat (Nachschub
   * laeuft noch) wird diesmal uebersprungen. same: Ersatz fuer einen verworfenen Titel (Standbild, "Nur echte Hintergrundbilder")
   * aus DERSELBEN Bibliothek – sonst bekaeme die andere Bibliothek den Platz (TV-Test 30.10.: viele Filme mit Standbild -> 7 Serien
   * hintereinander) */
  Pool.prototype.take = function (same) {
    if (!this.count()) return null;
    var b = same && this.lastB && this.lastB.q.length ? this.lastB : null;
    for (var k = 0; !b && k < this.libs.length * 2 + 1; k++) {
      b = this.libs[this.bag.next()];
      if (b && !b.q.length) b = null;
    }
    if (!b) return null;
    var it = b.q.pop(); this.last = it.rk; this.lastB = b;
    return it;
  };
  /* Nachschub, solange eine Bibliothek weniger als MIX - 1 Seiten haelt (und Seiten uebrig hat) oder ganz gezeigt ist */
  Pool.prototype.low = function () { for (var i = 0; i < this.libs.length; i++) if (wants(this.libs[i])) return true; return false; };
  /* nichts da und nichts zu laden: nur ohne Titel (sonst beginnt jede Bibliothek selbst eine neue Runde) */
  Pool.prototype.done = function () { return !this.count() && !this.size(); };

  N.saverLogic = L;
})(N);
