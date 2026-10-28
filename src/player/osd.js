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
    { id: 'chap', x: 944, y: 80, w: 48, h: 48 }, { id: 'tracks', x: 1008, y: 80, w: 48, h: 48 }, { id: 'more', x: 1072, y: 80, w: 48, h: 48 }
  ];
  var BY = {};
  for (var i = 0; i < BTNS.length; i++) BY[BTNS[i].id] = BTNS[i];
  var QS = ['20', '12', '8', '4'];
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
    /* sichtbare Knoepfe: f {pn: Modus aus pnMode, chap: Kapitel vorhanden} */
    visible: function (f) {
      var out = [];
      for (var i = 0; i < BTNS.length; i++) {
        var id = BTNS[i].id;
        if (((id === 'prev' || id === 'next') && !f.pn) || (id === 'chap' && !f.chap)) continue;
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
    /* Zeiger: Knopf unter (x, y) mit 8 px Toleranz (48er Knopf -> 64er Trefferflaeche), sonst null */
    hit: function (ids, x, y) {
      for (var i = 0; i < ids.length; i++) {
        var b = BY[ids[i]], bx = ISL_X + b.x, by = ISL_Y + b.y;
        if (x >= bx - 8 && x < bx + b.w + 8 && y >= by - 8 && y < by + b.h + 8) return ids[i];
      }
      return null;
    },
    center: function (id) { var b = BY[id]; return ISL_X + b.x + b.w / 2; },
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
      if (N.i18n.lang() === 'de') str = str.replace('.', ',');
      return N.t('pl.delay.val', { n: (ms > 0 ? '+' : '-') + str }) + ' ' + N.t(ms > 0 ? 'pl.delay.later' : 'pl.delay.earlier');
    },
    DELAYS: [-3000, -2000, -1000, -500, -250, 0, 250, 500, 1000, 2000, 3000],
    SLEEP: ['off', 'end', 15, 30, 60, 90],
    sleepLeft: function (at, now) { return Math.max(1, Math.ceil((at - now) / 60000)); },
    /* eine Stufe geringer; direkt abgespielt -> 8 Mbit/s (Umwandlung) */
    lower: function (q, direct) {
      if (direct) return '8';
      var i = QS.indexOf(String(q));
      return QS[Math.min(QS.length - 1, (i < 0 ? 1 : i) + 1)];
    },
    QS: QS,
    /* Mehr-Menue: st {version (Klartext, nur bei mehreren Dateien), direct, quality, aspect, subsOn, skipIntro, skipCredits, autoNext, ep, sleep (Text)} -> [{id, t, s}] */
    more: function (st) {
      var v = function (k) { return N.t('set.v.' + k); }, q = N.decision.QUAL[st.quality] || N.decision.QUAL['12'];
      var out = [{ id: 'quality', t: N.t('pl.m.quality'), s: st.direct ? N.t('pl.q.orig') : N.t('set.v.q', { n: st.quality, r: q[1] === '1920x1080' ? '1080p' : '720p' }) },
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
