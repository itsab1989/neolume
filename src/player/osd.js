/* N.osd – reine OSD-Logik des Players (SPEC 7.10–7.12): Knopfreihe (Lage, sichtbare Knoepfe, ◀▶-Navigation, Zeiger-Treffer,
 * Label-Mitte), Kapitel zur Zeit, Mehr-Menue-Eintraege, Sleep-Timer-Rest, Untertitel-Verzoegerung als Text, Qualitaetsstufen.
 * Ohne DOM, in Node getestet. Koordinaten absolut im 1280x720-Raster. */
(function (N) {
  var ISL_X = 64, ISL_Y = 458, ISL_H = 180;
  var CH_EARLY = 2000;                                  // ms vor einem Kapitelanfang, die schon zu ihm zaehlen (prev/nextChapter)
  /* Bedien-Insel x 64, y 458, 1152 x 180 (TV-Befund 27.10. nachmittags: nichts ueberlappt mehr). Zeilen (Insel-y):
   * Balken 24 (Mitte 27) · Zeiten 42–68 · Knopfreihe 80–128 (Mitte 104; Play/Pause 64 x 56 eckig-rund bei 76) · Fokus-Label 140–166.
   * Farbtasten-Hinweise (Pause) stehen ausserhalb der Insel an der Stelle der Hinweisleiste (y 650). Mitte x = 640 */
  /* Knopfreihe (Nutzerauftrag 28.10.): Mitte ⏮ · −x · ⏯ · +x · ⏭ symmetrisch um x 640 (wie Jetzt laeuft); ⏮/⏭ nur paarweise und nur,
   * wenn es etwas zu wechseln gibt (Folgen, Videos einer Warteschlange, Kapitel). Raster 64 (48er Knopf + 16 Luecke). */
  var BTNS = [
    { id: 'prev', x: 416, y: 80, w: 48, h: 48 },
    { id: 'back', x: 480, y: 80, w: 48, h: 48 }, { id: 'pp', x: 544, y: 76, w: 64, h: 56 }, { id: 'fwd', x: 624, y: 80, w: 48, h: 48 }, { id: 'next', x: 688, y: 80, w: 48, h: 48 },
    { id: 'pip', x: 880, y: 80, w: 48, h: 48 },                          // Bild in Bild: nur mit caps.pip (nicht am TV, SPEC PLAY-35)
    { id: 'chap', x: 944, y: 80, w: 48, h: 48 }, { id: 'tracks', x: 1008, y: 80, w: 48, h: 48 }, { id: 'more', x: 1072, y: 80, w: 48, h: 48 }
  ];
  var BY = {};
  for (var i = 0; i < BTNS.length; i++) BY[BTNS[i].id] = BTNS[i];
  /* Sprungweite aus einer Einstellung: Zahl (10) oder "zurueck/vor" ("10/30"); Ergebnis in Sekunden, ungueltig -> def */
  function steps(v, def) {
    var m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(String(v === undefined || v === null ? '' : v));
    if (m && Number(m[1]) > 0 && Number(m[2]) > 0) return { b: Number(m[1]), f: Number(m[2]) };
    var n = Number(v);
    return n > 0 ? { b: n, f: n } : { b: def, f: def };
  }
  var O = {
    BTNS: BTNS, ISL_X: ISL_X, ISL_Y: ISL_Y, ISL_H: ISL_H, BAR_Y: ISL_Y + 27, LBL_Y: ISL_Y + 140,
    btn: function (id) { return BY[id]; },
    /* Player auf voller Flaeche (flexible Flaeche, Apple Nr. 17; Lage per flex.css): Bildschirm-Punkt (W x H) -> Punkt im 1280x720-
     * Raster, in dem die Ansicht rechnet. o = Lage des Kastens (N.screen.off()), h = Hoehe H. how '': obere Haelfte = Titel-Ebene
     * (an der Oberkante, ab dem linken Rand) -> (x, y), untere Haelfte = Bedien-Ebene (an der Unterkante, waagerecht im Kasten)
     * -> (x - o.x, y - 2 o.y); 'low' immer Bedien-Ebene (Ziehen am Balken); 'mid' = Mitte (Laden, Verbindung unterbrochen, Fehler:
     * im Kasten) -> (x - o.x, y - o.y). o.k < 1 (N.screen.stage(), Flaeche schmaler/flacher als der Kasten): der ganze Player steht
     * verkleinert im Kasten -> ((x - o.x) / k, (y - o.y) / k). Am TV o = 0/0: unveraendert. */
    fullPt: function (x, y, o, h, how) {
      if (o && o.k > 0 && o.k < 1) return { x: (x - o.x) / o.k, y: (y - o.y) / o.k };   // verkleinerter Kasten (schmale Flaeche): alles darin
      if (!o || (!o.x && !o.y)) return { x: x, y: y };
      if (how === 'mid') return { x: x - o.x, y: y - o.y };
      if (how === 'low' || y >= h / 2) return { x: x - o.x, y: y - 2 * o.y };
      return { x: x, y: y };
    },
    steps: steps,
    /* Aufschrift der Sprungknoepfe: ['-10', '+30'] (ASCII-Minus: U+2212 fehlt in der TV-Schrift, Regel 10) */
    stepNums: function (st) { return ['-' + st.b, '+' + st.f]; },
    /* Was wechseln ⏮/⏭? f {type, qLen, chapters (Anzahl)}: 'ep' Folgen (nur Folgen, auch wenn sie Kapitel haben) ·
     * 'chap' Kapitel (ab 2 Kapiteln, keine Folge) · 'item' Videos einer Warteschlange ("Alle abspielen") · '' keine Knoepfe */
    pnMode: function (f) {
      var q = (f.qLen || 0) > 1;
      if (f.type === 'episode') return q ? 'ep' : '';
      if ((f.chapters || 0) > 1) return 'chap';
      return q ? 'item' : '';
    },
    /* sind ⏮/⏭ gerade bedienbar? f {mode, qIdx, qLen, chs, ms}. Kapitel: ⏮ geht immer (Kapitelanfang bzw. Anfang), ⏭ bis zum letzten */
    pnState: function (f) {
      if (f.mode === 'ep' || f.mode === 'item') return { prev: f.qIdx > 0, next: f.qIdx < f.qLen - 1 };
      if (f.mode === 'chap') return { prev: true, next: O.chapterAt(f.chs, f.ms) < f.chs.length - 1 };
      return { prev: false, next: false };
    },
    /* Ziel von ⏮ im Kapitel-Modus (wie DVD-Spieler/Jetzt laeuft): mehr als 3 s im Kapitel -> dessen Anfang, sonst das vorige */
    /* TV-Test 28.10.: der Sprung (ganze Sekunden, Position des TV hinkt bis 1 s nach) landet bis ~1,5 s VOR dem Kapitelanfang ->
     * bis CH_EARLY vor einem Anfang zaehlt schon als dieses Kapitel (sonst uebersprang ⏮ ein Kapitel bzw. ⏭ wiederholte eins) */
    prevChapter: function (chs, ms) {
      var k = O.chapterAt(chs, ms + CH_EARLY);
      if (k < 0) return 0;
      return ms - chs[k].start > 3000 || k === 0 ? chs[k].start : chs[k - 1].start;
    },
    nextChapter: function (chs, ms) { var k = O.chapterAt(chs, ms + CH_EARLY); return chs && k + 1 < chs.length ? chs[k + 1].start : -1; },
    /* Label-Schluessel fuer ⏮/⏭ je Modus */
    pnLabel: function (mode, id) { return 'pl.btn.' + id + ({ ep: 'Ep', chap: 'Ch', item: 'Item' }[mode] || 'Ep'); },
    /* sichtbare Knoepfe: f {pn: Modus aus pnMode, chap: Kapitel vorhanden, pip: Bild in Bild moeglich (caps.pip)} */
    visible: function (f) {
      var out = [];
      for (var i = 0; i < BTNS.length; i++) {
        var id = BTNS[i].id;
        if (((id === 'prev' || id === 'next') && !f.pn) || (id === 'chap' && !f.chap) || (id === 'pip' && !f.pip)) continue;
        out.push(id);
      }
      return out;
    },
    /* bedienbare Knoepfe: sichtbare ohne die gerade gesperrten ⏮/⏭ (st aus pnState) – nur sie bekommen Fokus und Zeiger-Treffer */
    usable: function (vis, st) {
      var out = [];
      for (var i = 0; i < vis.length; i++) if (!(vis[i] === 'prev' && !st.prev) && !(vis[i] === 'next' && !st.next)) out.push(vis[i]);
      return out;
    },
    /* ◀▶ zwischen den sichtbaren Knoepfen, ohne Umlauf; fehlt der aktuelle (ausgeblendet) -> Play/Pause */
    nav: function (ids, cur, key) {
      var i = ids.indexOf(cur);
      if (i < 0) return ids.indexOf('pp') >= 0 ? 'pp' : ids[0];
      if (key === 'LEFT' && i > 0) return ids[i - 1];
      if (key === 'RIGHT' && i < ids.length - 1) return ids[i + 1];
      return cur;
    },
    /* Zeiger: Knopf unter (x, y) mit 8 px Toleranz (48er Knopf -> 64er Trefferflaeche), sonst null.
     * g (optional): andere Lage der Insel und Knoepfe {x, y, by: {id: {x, y, w, h}}} (schmaler Player, O.narrow); ohne g die TV-Lagen */
    hit: function (ids, x, y, g) {
      var ox = g ? g.x : ISL_X, oy = g ? g.y : ISL_Y, L = g ? g.by : BY;
      for (var i = 0; i < ids.length; i++) {
        var b = L[ids[i]], bx = ox + b.x, by = oy + b.y;
        if (x >= bx - 8 && x < bx + b.w + 8 && y >= by - 8 && y < by + b.h + 8) return ids[i];
      }
      return null;
    },
    center: function (id, g) { var b = (g ? g.by : BY)[id]; return (g ? g.x : ISL_X) + b.x + b.w / 2; },
    /* Schmaler Player (nur flexible Flaeche, Apple: iPhone hoch K·N, iPad hoch M·N; Nr. 17, 10-screens.md 7) – rein, getestet.
     * W x H = Flaeche. Oben Zurueck-Knopf + Uhr (Zeile 72), darunter die Titel-Insel; Video 16:9 ueber die volle Breite (K: unter dem
     * Titel, M: senkrecht mittig); Bedien-Insel darunter (K) bzw. am unteren Rand (M) ueber die Breite: Balken, Zeiten, Reihe 1 = Mitte
     * (⏮ −x ⏯ +x ⏭), Reihe 2 = rechte Gruppe (Bild in Bild, Kapitel, Ton & UT, Mehr), Label, Kapitelname. -> Lagen in Flaechen-px */
    /* sf (optional): sichere Raender {t, r, b, l} (N.screen.safe; iPhone: Dynamic Island, Duo: Rand seitlich) – Inseln und Knoepfe
     * innerhalb, das Video weiter ueber die volle Breite */
    narrow: function (W, H, wide, sf) {
      var f = sf || {}, st = f.t > 0 ? f.t : 0, sr = f.r > 0 ? f.r : 0, sb = f.b > 0 ? f.b : 0, sl = f.l > 0 ? f.l : 0, IW = W - sl - sr;
      var m = 24, g = { W: W, H: H, TX: sl + m, TY: st + (wide ? 32 : 16), TW: IW - 2 * m, ISX: sl + m, ISW: IW - 2 * m, ISH: 276, VW: W, VH: Math.round(W * 9 / 16) };
      g.VY = wide ? Math.max(g.TY + 168, Math.round((H - g.VH) / 2)) : g.TY + 168;
      g.ISY = wide ? Math.max(g.VY + g.VH + 16, H - sb - g.ISH - 32) : g.VY + g.VH + 16;
      g.BAR_X = g.ISX + 32; g.BAR_W = g.ISW - 64; g.BAR_Y = g.ISY + 27; g.LBL_Y = g.ISY + 204; g.CHN_Y = 236;
      g.MH_Y = g.ISY + g.ISH + 8; g.SKIP_Y = g.VY + g.VH - 64; g.SKX1 = W - sr - m; g.SKX0 = g.SKX1 - 360; g.CX = Math.round(sl + IW / 2); g.SR = sr;
      var c = Math.round(g.ISW / 2), by = {}, r2 = { pip: 0, chap: 1, tracks: 2, more: 3 };
      for (var i = 0; i < BTNS.length; i++) {
        var b = BTNS[i], k = r2[b.id];
        by[b.id] = k === undefined ? { x: b.x - 576 + c, y: b.y, w: b.w, h: b.h } : { x: c - 120 + k * 64, y: 148, w: b.w, h: b.h };   // Mitte der TV-Reihe = 576
      }
      g.osd = { x: g.ISX, y: g.ISY, by: by };
      var below = g.ISY + g.ISH + 16;                      // Karten (Countdown, letzte Folge): unter der Insel, sonst unten rechts im Video
      g.UPX = W - sr - m - 400; g.CBY = below + 232 + 16 <= H - sb ? below + 168 : g.VY + g.VH - 8 - 64;
      g.LOX = Math.round(sl + (IW - 480) / 2); g.LOY = Math.round(st + (H - st - sb - 192) / 2);
      return g;
    },
    /* Reihe 2 des schmalen Players mittig ueber die sichtbaren Knoepfe (vis = O.visible …); aendert g.osd.by */
    narrowRow: function (g, vis) {
      var r = [], ids = ['pip', 'chap', 'tracks', 'more'], i;
      for (i = 0; i < ids.length; i++) if (vis.indexOf(ids[i]) >= 0) r.push(ids[i]);
      var x0 = Math.round(g.ISW / 2 - (r.length * 64 - 16) / 2);
      for (i = 0; i < r.length; i++) g.osd.by[r[i]].x = x0 + i * 64;
    },
    /* Kapitel aus den Metadaten: [{n, t, start, end, thumb}] */
    chapters: function (list) {
      var out = [];
      for (var i = 0; list && i < list.length; i++) {
        var c = list[i];
        out.push({ n: Number(c.index) || i + 1, t: String(c.tag || c.title || ''), start: Number(c.startTimeOffset) || 0, end: Number(c.endTimeOffset) || 0, thumb: c.thumb || '' });
      }
      out.sort(function (a, b) { return a.start - b.start; });
      return out;
    },
    /* Kapitelname: Server-Titel, generische ("Chapter 3", "Kapitel 3", nur Zahl) -> "Kapitel 3" in der App-Sprache */
    chapterNamed: function (c) { return !!c.t && !/^(chapter|kapitel|chapitre|cap[ií]tulo|capitolo)?\s*\d+$/i.test(c.t); },
    chapterTitle: function (c, i) { return O.chapterNamed(c) ? c.t : N.t('pl.chapterN', { n: i + 1 }); },
    /* Eintraege der Kapitelliste: [{id, t, s (Startzeit), img (Pfad oder '')}] und Index des laufenden Kapitels */
    chapterList: function (chs, ms, hms) {
      var e = [], cur = O.chapterAt(chs, ms);
      for (var i = 0; chs && i < chs.length; i++) e.push({ id: String(i), t: O.chapterTitle(chs[i], i), s: hms(chs[i].start), img: chs[i].thumb });
      return { entries: e, cur: cur };
    },
    chapterAt: function (chs, ms) {
      var k = -1;
      for (var i = 0; chs && i < chs.length; i++) if (ms >= chs[i].start) k = i;
      return k;
    },
    /* Untertitel-Verzoegerung (ms) -> "+0,5 Sek. später" / "Keine"; Komma je Sprache */
    delayText: function (ms) {
      if (!ms) return N.t('pl.delay.zero');
      var str = String(Math.abs(ms) / 1000);
      str = str.replace('.', N.t('fmt.decimal'));
      return N.t('pl.delay.val', { n: (ms > 0 ? '+' : '-') + str }) + ' ' + N.t(ms > 0 ? 'pl.delay.later' : 'pl.delay.earlier');
    },
    DELAYS: [-3000, -2000, -1000, -500, -250, 0, 250, 500, 1000, 2000, 3000],
    SLEEP: ['off', 'end', 15, 30, 60, 90],
    /* Pause: Wartezeit bis kurz nach der naechsten Minutengrenze (Uhr + "Ende um" einmal je Minute neu, TV-Test 29.10.) */
    minuteWait: function (d) { return 60000 - (d.getSeconds() * 1000 + d.getMilliseconds()) + 50; },
    sleepLeft: function (at, now) { return Math.max(1, Math.ceil((at - now) / 60000)); },
    /* eine Stufe geringer (Stufen des Geraets, N.decision.nums); direkt abgespielt -> 8 Mbit/s (Umwandlung); Original wandelt mit
     * der hoechsten Stufe um -> die naechste darunter; zu hohe Stufe (4K am TV) = hoechste, unbekannte = 12 (N.decision.eff) */
    lower: function (q, direct) {
      if (direct) return '8';
      var D = N.decision, QS = D.nums(), e = D.eff(q), i = e === D.ORIG ? 0 : QS.indexOf(e);
      return QS[Math.min(QS.length - 1, i + 1)];
    },
    /* Mehr-Menue: st {version (Klartext, nur bei mehreren Dateien), direct, quality, aspect, subsOn, skipIntro, skipCredits, autoNext, ep, sleep (Text)} -> [{id, t, s}] */
    more: function (st) {
      var v = function (k) { return N.t('set.v.' + k); }, D = N.decision, q = D.eff(st.quality);
      var out = [{ id: 'quality', t: N.t('pl.m.quality'), s: st.direct ? N.t('set.v.qOrig') : D.label(q === D.ORIG ? D.top() : q) },
        { id: 'aspect', t: N.t('pl.m.aspect'), s: v(st.aspect === '43' ? 'a43' : st.aspect || 'auto') }];
      if (st.version) out.unshift({ id: 'version', t: N.t('pl.m.version'), s: st.version });   // nur bei mehreren Dateien
      if (st.subsOn) out.push({ id: 'subs', t: N.t('pl.m.subs'), s: v(st.subSize || 'medium') + ' · ' + v(st.subBg || 'dim') });
      if (st.subSearch) out.push({ id: 'subsearch', t: N.t('pl.m.subSearch'), s: N.t('pl.m.subSearch.s') });   // P5, nur Hauptkonto
      if (st.markers) {
        out.push({ id: 'skipIntro', t: N.t('pl.m.skipIntro'), s: v(st.skipIntro || 'button') });
        out.push({ id: 'skipCredits', t: N.t('pl.m.skipCredits'), s: v(st.skipCredits || 'button') });
      }
      if (st.ep) out.push({ id: 'autoNext', t: N.t('pl.m.autoNext'), s: N.t(st.autoNext ? 'set.on' : 'set.off') });
      out.push({ id: 'sleep', t: N.t('pl.m.sleep'), s: st.sleep });
      out.push({ id: 'problem', t: N.t('pl.m.problem'), s: '' });
      return out;
    }
  };
  /* "Schaust du noch?" (SPEC 7.10): zaehlt Folgen, die ohne Eingabe nacheinander zu Ende liefen. limit 0 = aus.
   * advance(letzte Eingabe, jetzt) beim automatischen Wechsel zur naechsten Folge -> true = vorher nachfragen. */
  /* P5: zusaetzlich nach Zeit (hours, wie Plex "Passout Protection"): seit der letzten Eingabe bzw. dem Start mindestens so lange */
  function Still(limit, now, hours) { this.limit = Number(limit) || 0; this.n = 0; this.mark = now || 0; this.t0 = now || 0; this.ms = (Number(hours) || 0) * 3600000; }
  Still.prototype.advance = function (lastInput, now) {
    if (lastInput > this.mark) this.n = 0;           // seit dem letzten Wechsel wurde etwas gedrueckt
    this.n++; this.mark = now;
    var long = this.ms > 0 && now - Math.max(lastInput || 0, this.t0) >= this.ms;
    this.why = this.limit > 0 && this.n >= this.limit ? 'eps' : long ? 'time' : '';
    return !!this.why;
  };
  Still.prototype.reset = function (now) { this.n = 0; this.mark = now; this.t0 = now; };
  O.Still = Still;
  O.STILL = [0, 2, 3, 5];
  N.osd = O;
})(N);
