/* Ansicht 'liveplayer' – Fernsehen live im Player (SPEC A20, LIVE-4/5). Gleiche Flaeche, Inseln und Bedienung wie der Video-Player
 * (views/player.js: Titel-Insel oben links, Uhr oben rechts, Bedien-Insel unten, Label unter dem Fokus, keine Ein-/Ausblend-Animation
 * ausser der Huelle .pl-osdw), aber nur, was bei Live Sinn hat:
 * - Knopfreihe ⏮ Vorheriger Sender · ⏯ Pause/Weiter · ⏭ Naechster Sender | Senderliste · Mehr. Kein Spulen, keine Kapitel, keine
 *   naechste Folge, keine Timeline/Fortschritt an den Server (der Server ist gar nicht beteiligt).
 * - Statt der Zeitleiste: laufende Sendung mit Anfang/Ende und Fortschritt, falls der Sender Programmdaten anbietet (LIVE-8),
 *   sonst nur die Marke LIVE.
 * - CH▲ (und ⏭) zum naechsten, CH▼ (und ⏮) zum vorigen Sender in der Reihenfolge der Ansicht, aus der man kam (wie beim Fernsehen); Ziffern waehlen den n-ten Sender.
 * - Pause haelt das Bild an; "Weiter" nach mehr als 30 s Pause springt zurueck an die Live-Stelle (Stream neu geoeffnet).
 * - Mehr (TOOLS): Qualitaet fuer diese Wiedergabe (Automatisch / bis 1080p / 720p / 540p) und Sleep-Timer (Blau; Standard aus der
 *   Einstellung "Sleep-Timer-Standard", "Ende des Videos" gibt es live nicht -> aus). Bildformat bleibt automatisch.
 * - Schnelles Zappen (CH▲/▼ kurz hintereinander): Name und Spinner sofort, die Adresse erst, wenn ZAP_MS Ruhe ist – nie eine
 *   Schnittstellen-Anfrage (ARD bis 36 KB JSON) je Tastendruck am Fernseher.
 * - Schmale Flaeche (iPhone/iPad hoch, nur flexible Flaeche): wie der Video-Player (N.osd.narrow) – Bild 16:9 ueber die volle Breite,
 *   Titel darueber, Bedien-Insel darunter (Reihe 1 ⏮ ⏯ ⏭, Reihe 2 Senderliste · Mehr, Sendung darunter); Zeiger-Punkte wie dort.
 * - INFO: Technik (Quelle der Adresse, Varianten, gewaehlte Variante, Bildgroesse des Players, Geosperre).
 * - Fehler vor dem ersten Bild: einmal die feste Adresse aus den Daten (falls die Schnittstelle eine andere lieferte), dann ein
 *   Fehlerblock mit ehrlichem Grund (Geosperre des Senders, Netz) und "Erneut versuchen" / "Anderer Sender".
 * Plattformneutral: N.platform.player (Orsay SEF mit "|COMPONENT=HLS", Apple AVPlayer im <video>); am Kern nur caps. */
(function (N) {
  var U = N.util, O = N.osd, L = N.liveLogic, OSD_MS = 4000, START_MS = 3000, STALL_MS = 20000, RELIVE_MS = 30000, DIGIT_MS = 1200, ZAP_MS = 400, ZAP_GAP = 1500;
  var BTNS = [{ id: 'prev', x: 480, y: 80, w: 48, h: 48 }, { id: 'pp', x: 544, y: 76, w: 64, h: 56, lg: true }, { id: 'next', x: 624, y: 80, w: 48, h: 48 },
    { id: 'list', x: 1008, y: 80, w: 48, h: 48 }, { id: 'more', x: 1072, y: 80, w: 48, h: 48 }];
  var IDS = ['prev', 'pp', 'next', 'list', 'more'];
  var LANG3 = { deu: 'de', ger: 'de', eng: 'en', fra: 'fr', fre: 'fr', nor: 'no', nob: 'nb', ita: 'it', spa: 'es', tur: 'tr', pol: 'pl', ara: 'ar' };   // ISO 639-2 -> 639-1 (Untertitel)
  /* Lagen am TV (und breit): Insel x 64, y 458, 1152 breit; Knoepfe relativ zur Insel (N.osd.hit) */
  function tvGeo() {
    var by = {};
    for (var i = 0; i < BTNS.length; i++) by[BTNS[i].id] = BTNS[i];
    return { ISX: O.ISL_X, ISY: O.ISL_Y, ISW: 1152, BAR_W: 1088, TX: 64, TY: 36, osd: { x: O.ISL_X, y: O.ISL_Y, by: by } };
  }
  /* schmal: Lagen des Video-Players (N.osd.narrow), Reihe 1 ⏮ ⏯ ⏭ mittig wie dort, Reihe 2 Senderliste · Mehr mittig darunter */
  function narGeo(S) {
    var g = O.narrow(S.w, S.h, S.cls.w === 'M', S.safe), c = Math.round(g.ISW / 2), by = {};
    for (var i = 0; i < BTNS.length; i++) {
      var b = BTNS[i], k = b.id === 'list' ? 0 : b.id === 'more' ? 1 : -1;
      by[b.id] = k < 0 ? { x: b.x - 576 + c, y: b.y, w: b.w, h: b.h } : { x: c - 56 + k * 64, y: 148, w: b.w, h: b.h };
    }
    g.osd = { x: g.ISX, y: g.ISY, by: by };
    return g;
  }
  var IC = { prev: 'prev', pp: 'pause', next: 'next', list: 'grid', more: 'more' };
  var HERR = { none: 'hNone', down: 'hDown', old: 'hOld', busy: 'hBusy', upstream: 'hUp', key: 'hKey' };   // Helfer-Fehler -> Text err.lv.<k>.text
  var status = null, probe = null;
  N.live.status = function () { return status ? status() : null; };
  /* Messlauf (src/dev/bench.js live-check): Zustand des laufenden Senders – Bild, Bildgroesse, Tonspuren, ggf. dekodierter Ton */
  N.live.probe = function () { return probe ? probe() : null; };

  N.router.define('liveplayer', function (params) {
    var s = { rail: null, wheelKeys: ['LEFT', 'RIGHT'], toastHigh: true, touchLong: false, panelFull: true };
    var hideT = 0, FADE_MS = 300;   // Blende aus: mo.out 250 ms + Reserve
    var root, vbg, osdW, top, t1, t2, clk, bot, tr, played, tm0, tm1, chn, pill, lbl, lblT, spin, spinT, sbBg, sb, bk = null;
    var btnEl = {}, ppIc = null, osd = false, osdT = 0, fb = 'pp', closed = false, errOn = false, ti = null, G = tvGeo(), NG = null, onRsz = null, dir = false;
    var sleep = { mode: 'off', at: 0, t: 0, w: 0 }, zapT = 0, lastTune = 0;
    /* Untertitel (Nutzerbefund 05.11.: am iPad liefen sie bei ARD/ZDF von selbst mit): Standard aus, Wahl unter Mehr › Untertitel,
     * nur mit caps.liveSubs (der Player des TVs 2014 waehlt keine Untertitelspuren eines HLS-Stroms); subLang merkt die Sprache der
     * gewaehlten Spur fuer weitere Sender bis zum Schliessen ('' = aus), subTry: Ticks, in denen spaet gemeldete Spuren noch gesucht werden */
    var sub = null, subT = null, subIdx = -1, subLang = '', subNm = '', subTry = 0, SUBS = !!N.platform.caps.liveSubs;
    var list = params.list || [params.id], idx = Math.max(0, list.indexOf(params.id)), ch = null, sef = null;
    var hurl = '';                                                   // Adresse der laufenden Helfer-Sitzung (LIVE-10), '' = keine
    var firstMs = 0, state = 'idle', gen = 0, t0 = 0, first = false, res = null, tried = false, stallT = 0, clkT = 0, pausedAt = 0, q = null, digits = '', digitT = 0, epgT = 0;
    function cfg() { return N.session.settings || {}; }

    s.create = function (el) {
      root = el; U.cls(root, 'pl', true);
      vbg = U.el('div', 'pl-vbg', root, 'display:none');
      sub = U.el('div', 'pl-sub', root, 'display:none'); subT = U.txt('span', '', sub, '');   // Untertitel nur auf Wunsch (Mehr)
      subLook();
      osdW = U.el('div', 'pl-osdw', root);
      top = U.el('div', 'pl-top', osdW, 'display:none');
      ti = U.el('div', 'pl-isl pl-ti', top);
      t1 = U.txt('div', 'pl-t1 ell', ti, ''); t2 = U.txt('div', 'pl-t2 ell', ti, '');
      clk = U.txt('div', 'pl-isl pl-clk', top, '');
      if (N.platform.caps.pointer === 'mouse') {
        bk = U.txt('div', 'pl-isl pl-bk', top, '‹').parentNode;
        bk.setAttribute('role', 'button'); bk.setAttribute('aria-label', N.t('pl.btn.exit'));
      }
      bot = U.el('div', 'pl-isl pl-bot', osdW, 'display:none');
      tr = U.el('div', 'pl-tr', bot, 'visibility:hidden');
      played = U.el('div', 'pl-pl', tr);
      tm0 = U.txt('div', 'pl-tm0', bot, ''); tm1 = U.txt('div', 'pl-tm1', bot, '');
      pill = U.txt('div', 'lv-pill', bot, N.t('lv.live'));
      chn = U.txt('div', 'pl-chn lv-now ell', bot, '');
      for (var i = 0; i < BTNS.length; i++) {
        var b = BTNS[i], be = U.el('div', 'pl-b' + (b.lg ? ' lg' : ''), bot, 'left:' + b.x + 'px;top:' + b.y + 'px');
        var ic = N.ui.icon(be, IC[b.id]);
        if (b.id === 'pp') ppIc = ic;
        btnEl[b.id] = be;
      }
      lbl = U.el('div', 'pl-lbl', root, 'display:none'); lblT = U.txt('span', '', lbl, '');
      spin = U.el('div', 'pl-spin', root, 'display:none');
      U.el('div', 'spinner', spin, 'left:180px;top:16px');
      spinT = U.txt('div', 'pl-spt', spin, '');
      sbBg = U.el('div', 'pl-errbg', root, 'display:none');
      sb = new N.ui.StateBlock(root);
      status = function () { return { active: !closed && !errOn && !!ch, paused: state === 'paused', item: null, calm: false, since: 0 }; };
      probe = function () {
        var el = sef && sef.el, a = el && el.webkitAudioDecodedByteCount;
        return { id: ch ? ch.id : '', state: state, err: errOn, ms: firstMs, src: res ? res.src : '', pick: res && res.pick ? res.pick.h : 0, split: !!(res && res.split),
          vres: String(sef ? sef.exec('GetVideoResolution') : ''), aud: sef ? sef.exec('GetTotalNumOfStreamID', 1) : -1, t: el ? Math.round(el.currentTime * 10) / 10 : -1,
          audBytes: typeof a === 'number' ? a : -1, muted: !!(el && el.muted), subs: subProbe(el), subIdx: subIdx, subBox: sub && sub.style.display !== 'none' ? subT.nodeValue : '' };
      };
      if (N.screen && N.screen.flex) { onRsz = function () { if (!closed) nar(); }; N.evt.on('screen:resized', onRsz); nar(); }
    };
    /* Schmaler Player an/aus (nur flexible Flaeche, wie views/player.js nar()): Lagen inline, Video-Feld fuer die Plattform */
    function nar() {
      var S = N.screen, c = S.cls, on = S.flex && c.h === 'N' && (c.w === 'K' || c.w === 'M'), g, i;
      NG = on ? narGeo(S) : null; G = NG || tvGeo(); g = NG;
      U.cls(root, 'pl-nar', on);
      function px(v) { return on ? v + 'px' : ''; }
      function at(e, x, y, w, h) { var st = e.style; st.left = px(x); if (y !== null) st.top = px(y); if (w !== undefined) st.width = px(w); if (h !== undefined) st.height = px(h); }
      at(top, on && g.TX, on && g.TY, on && g.TW, on && 152);
      ti.style.left = px(0); ti.style.top = px(80); ti.style.maxWidth = px(on && g.TW);
      at(bot, on && g.ISX, on && g.ISY, on && g.ISW, on && g.ISH);
      tr.style.width = px(on && g.BAR_W);
      pill.parentNode.style.left = on ? (Math.round(g.ISW / 2) - 40) + 'px' : '';
      at(chn.parentNode, on && 32, on && g.CHN_Y, on && g.ISW - 64);
      for (i = 0; i < BTNS.length; i++) { var b = G.osd.by[BTNS[i].id]; btnEl[BTNS[i].id].style.left = b.x + 'px'; btnEl[BTNS[i].id].style.top = b.y + 'px'; }
      lbl.style.top = px(on && g.LBL_Y);
      at(spin, on && Math.round((g.W - 400) / 2), on && g.VY + Math.round((g.VH - 112) / 2));
      at(vbg, on && 0, on && g.VY, on && g.VW, on && g.VH);
      at(sub, on && 24, null, on && g.W - 48); sub.style.bottom = px(on && g.H - g.VY - g.VH + 12);   // schmal: unten im Video-Feld (wie der Video-Player)
      S.video = on ? { x: 0, y: g.VY, w: g.VW, h: g.VH } : null;
      var sl = on ? S.safe.l : 0, iw = on ? g.W - sl - S.safe.r : 0, ew = on ? Math.min(iw - 48, 720) : 0;
      sb.fit(on ? { x: Math.round(sl + (iw - ew) / 2), w: ew, H: g.H } : null);
      if (sef && sef.relayout) sef.relayout();
      if (ch) paintNow();
      setLabel();
    }
    /* Finger/Maus (Zurueck-Knopf sichtbar, wie der Video-Player): Klasse pl-dir, solange die letzte Eingabe kein Tastendruck war */
    function dirSync() {
      var d = !!bk && N.input.mode !== 'key';
      if (d === dir) return;
      dir = d; U.cls(root, 'pl-dir', d);
      if (btnEl[fb]) U.cls(btnEl[fb], 'is-focus', osd && !d);
      setLabel();
    }
    /* Bildschirm-Punkt -> Punkt der Lagen (schmal: Flaechen-Punkte; sonst wie der Video-Player: Titel-Ebene oben, Bedien-Ebene unten) */
    function full(x, y) {
      if (NG) return { x: x, y: y };
      return O.fullPt(x, y, N.screen.stage(), N.screen.h, errOn ? 'mid' : '');
    }
    s.enter = function () {
      if (sef || closed) return;
      sef = N.platform.player.create(function (type, data) { onEvent(type, data); });
      if (sef.fake) { U.show(vbg, true); if (N.config.fakeBg) vbg.style.background = N.config.fakeBg; } else transparent(true);
      U.cls(document.body, 'in-player', true);
      N.tv.saver(false);
      tune(idx);
      var sd = cfg().sleepDefault;                                   // Sleep-Timer-Standard (P5); "Ende des Videos" gibt es live nicht
      if (sd && sd !== 'off' && sd !== 'end' && Number(sd) > 0) setSleep(Number(sd), true);
    };
    s.leave = function () { return null; };
    s.destroy = function () {
      if (!closed) shutdown();
      probe = null;
      if (onRsz) N.evt.off('screen:resized', onRsz);
      if (N.screen && N.screen.video) N.screen.video = null;   // Video-Feld des schmalen Players freigeben
      status = null;
    };
    function transparent(on) { var v = on ? 'transparent' : ''; document.body.style.background = v; document.documentElement.style.background = v; }
    function shutdown() {
      closed = true; gen++;
      clearAll();
      helperEnd();
      nowPlaying(null);
      N.platform.player.close();
      transparent(false);
      U.cls(document.body, 'in-player', false);
      N.tv.saver(true);
      N.evt.emit('playback:stopped', { rk: '', video: true, done: false, srv: '', ep: null, live: true });
    }
    function clearAll() {
      if (osdT) { clearTimeout(osdT); osdT = 0; }
      if (hideT) { clearTimeout(hideT); hideT = 0; }
      if (stallT) { clearTimeout(stallT); stallT = 0; }
      if (clkT) { clearTimeout(clkT); clkT = 0; }
      if (digitT) { clearTimeout(digitT); digitT = 0; }
      if (epgT) { clearTimeout(epgT); epgT = 0; }
      if (zapT) { clearTimeout(zapT); zapT = 0; }
      setSleep('off', true);
    }
    function close() { if (closed) return; shutdown(); N.router.back(); }
    /* Sitzung im Helfer beenden (sonst endet sie nach 60 s Leerlauf von selbst) */
    function helperEnd() { if (hurl) { N.live.helperClose(hurl); hurl = ''; } }

    /* ---------- Sender einschalten ---------- */
    function tune(i, again, zap) {
      idx = (i + list.length) % list.length;
      ch = L.channel(list[idx]);
      var g = ++gen;
      if (errOn) { errOn = false; sb.hide(); U.show(sbBg, false); if (!sef.fake) transparent(true); }
      first = false; state = 'loading'; pausedAt = 0; res = null; t0 = U.now();
      subIdx = -1; subTry = 0; subText('');
      if (!again) tried = false;
      if (!ch) { fail('gone'); return; }
      sef.exec('Stop');
      if (hurl && !N.live.viaHelper(ch)) helperEnd();                  // weg vom Helfer (z. B. zu arte); zum naechsten sep-Sender ersetzt er sie selbst
      paintTitle(); paintNow(); paintPp();
      spinner(true);
      showOsd(START_MS);
      if (zapT) { clearTimeout(zapT); zapT = 0; }
      var now = U.now(), quick = zap && now - lastTune < ZAP_GAP;
      lastTune = now;
      if (quick) { zapT = setTimeout(function () { zapT = 0; if (g === gen && !closed) open(g); }, ZAP_MS); return; }   // schnelles Zappen: erst in Ruhe oeffnen
      open(g);
    }
    function open(g) {
      N.log('live ' + ch.id + ' oeffnen');
      N.live.resolve(ch.id, q === null ? undefined : q, function (err, r) {
        if (g !== gen || closed) return;
        if (err) { fail(err.type === 'gone' ? 'gone' : err.type === 'helper' ? 'h:' + err.why : 'net'); return; }
        res = r;
        hurl = r.src === 'helper' ? r.url : '';
        N.log('live ' + ch.id + ' ' + r.src + (r.pick ? ' Variante ' + r.pick.h + 'p' : ' Master') + ' ' + r.url.split('?')[0]);
        sef.exec('InitPlayer', L.sefUrl(r.url));
        sef.exec('SetDisplayArea', 0, 0, 1280, 720, 720, 1);
        if (sef.exec('StartPlayback', 0) === -1) onEvent(6, 6);
        arm();
        nowPlaying(ch);
      });
      N.live.epgFetch([ch.id]);
      epgLater();
    }
    /* Puffern zu lange (kein erstes Bild bzw. Stillstand): wie ein Fehler behandeln */
    function arm() {
      if (stallT) clearTimeout(stallT);
      var g = gen;
      stallT = setTimeout(function () { stallT = 0; if (g === gen && !closed && (state === 'loading' || state === 'buffering')) fail(first ? 'stall' : 'start'); }, STALL_MS);
    }
    function onEvent(type, data) {
      if (closed) return;
      type = Number(type);
      switch (type) {
        case 1: case 2: case 3: case 4: case 6: fail(first ? 'stall' : 'start', type); break;
        case 8: fail('ended'); break;                                       // Live-Strom endet nicht: der Sender hat ihn abgebrochen
        case 9: subTry = subLang ? 20 : 0; subAuto(); break;                             // Spuren bekannt: gewaehlte Untertitel-Sprache weiter
        case 19: if (subIdx >= 0) subText(N.subs.clean(data)); break;      // Untertitelzeile der gewaehlten Spur ('' = leeren)
        case 11: if (state !== 'paused') { state = 'buffering'; spinner(true); arm(); } break;
        case 12: if (state === 'buffering' || state === 'loading') playing(); break;
        case 14:
          if (state === 'loading' || state === 'buffering') playing();
          if (subTry > 0 && subIdx < 0) { subTry--; subAuto(); }        // Spuren kommen bei HLS oft erst nach den Metadaten (bis ca. 10 s)
          break;
        default: break;
      }
    }
    function playing() {
      if (!first && ch) N.log('live ' + ch.id + ' Bild nach ' + (U.now() - t0) + ' ms');   // Messauftrag P7 "Fernsehen" (Startzeit, Senderwechsel)
      if (!first) firstMs = U.now() - t0;
      if (!first) tried = false;                                         // Bild laeuft (wieder): der naechste Abbruch bekommt erneut einen Versuch (TV-Test 05.11.: nach einem Helfer-Neustart fehlte er, der Fehlertext nannte dann den Sender statt des Helfers)
      state = 'playing'; first = true; spinner(false);
      if (stallT) { clearTimeout(stallT); stallT = 0; }
      paintPp();
    }
    /* Fehler: einmal die feste Adresse (Schnittstelle lieferte eine andere), sonst Fehlerblock mit Grund */
    function fail(kind, code) {
      if (closed || errOn) return;
      N.log('live ' + (ch ? ch.id : '?') + ' Fehler ' + kind + (code ? ' ' + code : ''));
      if (stallT) { clearTimeout(stallT); stallT = 0; }
      if (ch && res && res.src === 'api' && !tried) { tried = true; N.live.forget(ch.id); N.live.pin(ch.id); tune(idx, true); return; }
      if (ch && res && res.src === 'helper' && !tried) { tried = true; tune(idx, true); return; }      // Helfer: einmal mit neuer Sitzung
      helperEnd();
      if (sef) sef.exec('Stop');
      subIdx = -1; subTry = 0; subText('');                              // keine stehende Zeile ueber dem Fehlerblock (Stop meldet kein 19 mehr)
      spinner(false); hideOsd(true);
      errOn = true; state = 'error';
      transparent(false); U.show(sbBg, true);
      var geo = ch && ch.geo ? N.t('err.lv.geo', { channel: ch.name, country: N.t('live.country.' + ch.geo) }) : '';
      var hk = kind.indexOf('h:') === 0 ? HERR[kind.slice(2)] || 'hOld' : '';    // Helfer: ehrlich sagen, woran es liegt
      var text = kind === 'gone' ? N.t('err.lv.gone') : kind === 'net' ? N.t('err.lv.net') : hk ? N.t('err.lv.' + hk + '.text', { channel: ch ? ch.name : '' }) + (hk === 'hUp' && geo ? ' ' + geo : '') :
        N.t('err.lv.text') + (geo ? ' ' + geo : '');
      sb.show({ title: N.t('err.lv.title', { channel: ch ? ch.name : '' }), text: text,
        buttons: [{ id: 'retry', t: N.t('err.btn.retry') }].concat(list.length > 1 ? [{ id: 'next', t: N.t('lv.btn.other') }] : []),
        onSelect: function (id) { if (id === 'next') tune(idx + 1); else tune(idx); } });
      N.router.refreshHints();
    }

    /* ---------- Darstellung ---------- */
    function paintTitle() {
      U.setText(t1, N.t('lv.over', { region: N.live.regionName(ch.region) }));
      U.setText(t2, ch.name);
      paintClk();
    }
    function paintNow() {
      var n = N.live.now(ch), now = N.live.clockNow();
      if (n && n.now) {
        U.setText(chn, n.now.t); U.setText(tm0, N.fmt.clock(new Date(n.now.s))); U.setText(tm1, N.fmt.clock(new Date(n.now.e)));
        played.style.width = Math.round(G.BAR_W * L.progress(n.now, now)) + 'px';
        tr.style.visibility = '';
      } else { U.setText(chn, ''); U.setText(tm0, ''); U.setText(tm1, ''); tr.style.visibility = 'hidden'; }
    }
    /* laufende Sendung nach ihrem Ende neu (Programmdaten nur, wo der Sender sie anbietet); Uhr jede Minute */
    function epgLater() {
      if (epgT) clearTimeout(epgT);
      epgT = setTimeout(function () { epgT = 0; if (closed || !ch) return; N.live.epgFetch([ch.id]); if (osd) paintNow(); epgLater(); }, 60000);
    }
    function paintClk() {
      U.setText(clk, N.comfort.clock(N.clock.date(), N.config.fixedClock));   // wie der Video-Player (Bildtests: feste Uhr)
      if (clkT) clearTimeout(clkT);
      clkT = setTimeout(function () { clkT = 0; if (!closed && osd) paintClk(); }, O.minuteWait(N.clock ? N.clock.date() : new Date()));
    }
    function paintPp() { if (ppIc) N.ui.setIcon(ppIc, state === 'paused' ? 'play' : 'pause'); setLabel(); }
    function spinner(on) {
      if (on && ch) U.setText(spinT, N.t('lv.loading', { channel: ch.name }));
      U.show(spin, !!on && !errOn);
    }
    function nowPlaying(c) {
      var f = N.platform.player && N.platform.player.nowPlaying;
      if (!f) return;
      try { f(c ? { title: c.name, artist: N.live.nowText(c) || N.t('lv.live'), album: '', art: '' } : null); } catch (e) { N.log('nowPlaying ' + e.message); }
    }

    /* ---------- OSD ---------- */
    function showOsd(ms) {
      if (errOn) return;
      if (!osd) {
        osd = true;
        if (hideT) { clearTimeout(hideT); hideT = 0; }
        osdW.style.visibility = '';                                 // nach der Blende verborgen (s. hideOsd), jetzt wieder zeichnen
        if (top.style.display === 'none') { U.show(top, true); U.show(bot, true); U.raf(function () { if (osd) U.cls(osdW, 'on', true); }); }
        else U.cls(osdW, 'on', true);
        paintClk(); paintNow(); setFocus(fb, true); subLook();
        N.router.refreshHints();
      }
      if (osdT) clearTimeout(osdT);
      osdT = state === 'paused' ? 0 : setTimeout(hideOsd, ms || OSD_MS);
    }
    function hideOsd(force) {
      if (osdT) { clearTimeout(osdT); osdT = 0; }
      if (!osd) return;
      if (force !== true && N.router.hasOverlay()) { osdT = setTimeout(hideOsd, OSD_MS); return; }
      osd = false; U.cls(osdW, 'on', false); U.show(lbl, false); subLook();
      // wie im Video-Player (Nutzerbefund 07.11.): Blende endete am TV teils nicht genau bei 0 -> danach Huelle verbergen
      if (hideT) clearTimeout(hideT);
      hideT = setTimeout(function () { hideT = 0; if (!osd) osdW.style.visibility = 'hidden'; }, FADE_MS);
      if (btnEl[fb]) U.cls(btnEl[fb], 'is-focus', false);
      fb = 'pp';
      N.router.refreshHints();
    }
    function setFocus(id, force) {
      if (!force && id === fb) return;
      if (btnEl[fb]) U.cls(btnEl[fb], 'is-focus', false);
      fb = id;
      if (osd && btnEl[fb] && !dir) { N.fx.move(btnEl[fb]); U.cls(btnEl[fb], 'is-focus', true); }   // Finger/Maus: Fokus gefuehrt, nicht gezeigt (wie der Video-Player)
      setLabel();
    }
    function label(id) { return N.t(id === 'pp' ? (state === 'paused' ? 'pl.btn.play' : 'pl.btn.pause') : 'lv.btn.' + id); }
    function setLabel() {
      if (!osd) { U.show(lbl, false); return; }
      if (dir && N.input.mode === 'touch') { U.show(lbl, false); return; }   // Finger: kein Label (kein Fokus), wie der Video-Player
      var b = G.osd.by[fb] || G.osd.by.pp, tx = label(fb);
      U.setText(lblT, tx); U.show(lbl, true);
      var c = G.ISX + b.x + b.w / 2;
      lbl.style.left = Math.round(U.clamp(c, G.ISX + 32 + 150, G.ISX + G.ISW - 32 - 150) - 150) + 'px';
    }
    function btnIdx(id) { for (var i = 0; i < BTNS.length; i++) if (BTNS[i].id === id) return i; return 1; }

    /* ---------- Aktionen ---------- */
    function step(d) { if (list.length > 1) tune(idx + d, false, true); }
    function toggle() {
      if (state === 'paused') {
        if (U.now() - pausedAt > RELIVE_MS) { N.log('live: lange Pause -> zurueck an die Live-Stelle'); tune(idx, true); return; }
        sef.exec('Resume'); state = 'playing'; paintPp(); showOsd(); return;
      }
      if (state !== 'playing' && state !== 'buffering') return;
      sef.exec('Pause'); state = 'paused'; pausedAt = U.now(); paintPp(); showOsd();
    }
    function press(id) {
      if (id === 'prev') step(-1); else if (id === 'next') step(1); else if (id === 'pp') toggle();
      else if (id === 'list') channels(); else if (id === 'more') more();
    }
    /* Senderliste (Panel): alle Sender der Ansicht, aus der man kam; aktueller markiert */
    function channels() {
      var e = [];
      for (var i = 0; i < list.length; i++) { var c = L.channel(list[i]); if (c) e.push({ id: c.id, t: c.name, s: N.live.nowText(c) || N.live.regionName(c.region) }); }
      N.ui.panel.select({ title: N.t('lv.btn.list'), selected: ch ? ch.id : '', entries: e, onSelect: function (id) { var j = list.indexOf(id); if (j >= 0 && j !== idx) tune(j); } });
    }
    /* Mehr: Qualitaet fuer diese Wiedergabe (gilt fuer weitere Sender bis zum Schliessen) und Sleep-Timer */
    function more(focusId) {
      var cur = q === null ? N.live.quality() : q;
      var e = [{ id: 'quality', t: N.t('lv.q.title'), s: N.t('lv.q.' + cur) }, { id: 'sleep', t: N.t('pl.sleep'), s: sleepText() }];
      if (subCount() > 0) e.push({ id: 'subs', t: N.t('lv.sub.title'), s: subIdx >= 0 ? subName(subIdx) : N.t('set.v.off') });   // nur, wenn der Sender Spuren hat
      var fi = 0; for (var k = 0; k < e.length; k++) if (e[k].id === focusId) fi = k;
      N.ui.panel.select({ title: N.t('pl.more'), focus: fi, entries: e,
        onSelect: function (id) {
          if (id === 'sleep') sleepPanel(function () { more('sleep'); });
          else if (id === 'subs') subPanel(function () { more('subs'); });
          else quality(function () { more('quality'); });
        } });
    }
    /* ---------- Untertitel (nur Apple bzw. wo der Player Spuren meldet; am TV ohne Spuren: kein Eintrag) ---------- */
    function subCount() { var n = SUBS && sef ? Number(sef.exec('GetTotalNumOfStreamID', 4)) : 0; return n > 0 ? n : 0; }
    function subStr(cmd, i) { var l = sef ? sef.exec(cmd, 4, i) : ''; return typeof l === 'string' ? l : ''; }
    /* Sprache vereinheitlicht: Sender schreiben sie verschieden (iPad 05.11.: Das Erste "de", ZDF "deu", DW "de-DE" und "ENG") */
    function subLangOf(i) { var l = String(subStr('GetStreamLanguageInfo', i)).toLowerCase().split(/[-_]/)[0]; return LANG3[l] || l || subStr('GetStreamName', i); }
    function subKey(i) { return subLangOf(i) + '|' + subStr('GetStreamName', i); }
    /* Anzeige: Name der Spur (HLS NAME), sonst die Sprache (Deutsch/English/Norsk wie die App-Sprachen, andere als Kuerzel), sonst "Untertitel n" */
    function subName(i) {
      var nm = subStr('GetStreamName', i), l = subStr('GetStreamLanguageInfo', i) ? subLangOf(i) : '';
      return nm || (l === 'de' || l === 'en' || l === 'nb' ? N.t('lang.' + l) : l === 'no' ? N.t('lang.nb') : l) || N.t('lv.sub.track', { n: i + 1 });
    }
    function subSet(i, quiet) {
      if (!sef) return;
      if (i < 0) { sef.exec('StopSubtitle'); subIdx = -1; subLang = ''; subTry = 0; subText(''); }
      else if (sef.exec('StartSubtitle', i) === 1) { subIdx = i; subLang = subLangOf(i) || '?'; subNm = subKey(i); subText(''); }
      if (!quiet) N.ui.toast.show(N.t(subIdx >= 0 ? 'lv.sub.on' : 'lv.sub.off'), { icon: 'confirm' });
    }
    function subText(tx) { if (!sub) return; U.setText(subT, tx || ''); U.show(sub, !!tx); }
    /* Aussehen wie im Video-Player (Einstellungen Groesse, Farbe, Hintergrund, Lage); bei sichtbarer Bedien-Insel darueber (up) */
    function subLook() {
      if (!sub) return;
      var c = cfg();
      sub.className = 'pl-sub sz-' + (c.subSize || 'medium') + ' bg-' + (c.subBg || 'dim') + (c.subColor === 'yellow' ? ' yel' : '') +
        (c.subPos === 'high' ? ' hi' : '') + (osd ? ' up' : '');
    }
    /* Messlauf live-check: Untertitelspuren des <video> (Art:Modus:Cues je Spur) */
    function subProbe(el) {
      var tt = el && el.textTracks, out = [];
      for (var i = 0; tt && i < tt.length; i++) {
        var t = tt[i];
        if (t.kind !== 'subtitles' && t.kind !== 'captions') continue;
        var cu = t.cues, last = cu && cu.length ? cu[cu.length - 1] : null, ac = t.activeCues;
        out.push(t.kind.charAt(0) + ':' + (t.language || '-') + ':' + (t.label || '-') + ':' + t.mode + ':' + (cu ? cu.length : -1) +
          (last ? ' (letzter ' + Math.round(last.startTime * 10) / 10 + '-' + Math.round(last.endTime * 10) / 10 + ' "' + String(last.text || '').replace(/\s+/g, ' ').slice(0, 40) + '", aktiv ' + (ac ? ac.length : -1) + ')' : ''));
      }
      return out.join(' ');
    }
    /* weiterer Sender: zuerst dieselbe Spur (Sprache und Name, z. B. "Deutsch (SDH)"), sonst dieselbe Sprache, ohne Angaben die erste */
    function subAuto() {
      if (!subLang) return;
      var n = subCount(), i;
      if (!n) return;
      for (i = 0; i < n; i++) if (subKey(i) === subNm) { subSet(i, true); return; }
      for (i = 0; i < n; i++) if (subLangOf(i) === subLang) { subSet(i, true); return; }
      if (subLang === '?') subSet(0, true);
    }
    function subPanel(back) {
      var n = subCount(), e = [{ id: 'off', t: N.t('set.v.off') }];
      for (var i = 0; i < n; i++) e.push({ id: String(i), t: subName(i) });
      N.ui.panel.select({ title: N.t('lv.sub.title'), selected: subIdx >= 0 ? String(subIdx) : 'off', entries: e, onCancel: back,
        onSelect: function (v) { subSet(v === 'off' ? -1 : Number(v)); } });
    }
    function quality(back) {
      var cur = q === null ? N.live.quality() : q, e = [];
      for (var i = 0; i < L.QUALITY.length; i++) e.push({ id: L.QUALITY[i], t: N.t('lv.q.' + L.QUALITY[i]) });
      N.ui.panel.select({ title: N.t('lv.q.title'), selected: cur, entries: e, onCancel: back, onSelect: function (v) { if (v !== cur) { q = v; tune(idx, true); } } });
    }
    /* ---------- Sleep-Timer (Blau / Mehr): Aus · 15–90 Min.; 1 Min. vorher Hinweis, dann Ende (wie der Video-Player) ---------- */
    function setSleep(mode, quiet) {
      if (sleep.t) clearTimeout(sleep.t); if (sleep.w) clearTimeout(sleep.w);
      sleep = { mode: mode, at: 0, t: 0, w: 0 };
      if (typeof mode === 'number') {
        var ms = mode * 60000;
        sleep.at = U.now() + ms;
        sleep.t = setTimeout(function () { sleep.t = 0; close(); N.ui.toast.show(N.t('pl.toast.sleepDone'), { icon: 'info' }); }, ms);
        sleep.w = setTimeout(function () { sleep.w = 0; N.ui.toast.show(N.t('pl.toast.sleepSoon'), { icon: 'info' }); }, ms - 60000);
      }
      if (!quiet) N.ui.toast.show(mode === 'off' ? N.t('pl.toast.sleepOff') : N.t('pl.toast.sleep', { n: mode }), { icon: 'confirm' });
    }
    function sleepText() { return sleep.mode === 'off' ? N.t('set.v.off') : N.t('pl.sleep.left', { n: O.sleepLeft(sleep.at, U.now()) }); }
    function sleepPanel(back) {
      var e = [];
      for (var i = 0; i < O.SLEEP.length; i++) {
        var v = O.SLEEP[i];
        if (v === 'end') continue;                                   // live gibt es kein Ende, das der Player kennt
        e.push({ id: String(v), t: v === 'off' ? N.t('set.v.off') : N.t('pl.sleep.min', { n: v }), s: v === sleep.mode ? sleepText() : '' });
      }
      N.ui.panel.select({ title: N.t('pl.sleep'), entries: e, selected: String(sleep.mode), onCancel: back || null,
        onSelect: function (id) { setSleep(id === 'off' ? 'off' : Number(id)); } });
    }
    function info() {
      if (!ch) return;
      var lines = [], r = res, vars = r ? r.vars : [];
      lines.push(N.t('lv.info.src.' + (r ? r.src : 'data')));
      if (vars && vars.length) lines.push(N.t('lv.info.vars', { n: vars.length, max: L.maxH(vars) }));
      lines.push(r && r.src === 'helper' ? N.t('lv.info.hPick', { h: r.pick.h }) : r && r.pick ? N.t('lv.info.pick', { h: r.pick.h }) : N.t('lv.info.auto'));
      if (r && r.split && !r.pick && L.capHeight(q === null ? N.live.quality() : q)) lines.push(N.t('lv.info.split'));   // Grenze gewuenscht, aber Ton als eigene Spur
      var vr = String(sef && sef.exec('GetVideoResolution') || ''), p = vr.split('|');
      if (Number(p[0]) > 0 && Number(p[1]) > 0) lines.push(N.t('lv.info.res', { w: p[0], h: p[1] }));
      if (ch.geo) lines.push(N.t('lv.info.geo', { country: N.t('live.country.' + ch.geo) }));
      if (N.live.viaHelper(ch)) lines.push(N.t('lv.info.helper'));     // TV 2014: Bild und getrennten Ton setzt der Helfer zusammen (LIVE-10)
      if (ch.verified === false) lines.push(N.t('lv.info.untested'));   // nur aus dem Ausland recherchiert (LIVE-11): dezent sagen
      N.ui.panel.help(ch.name, lines.join('\n'));
    }
    function digit(k) {
      digits = (digits + k).slice(-2);
      if (digitT) clearTimeout(digitT);
      showOsd(); U.setText(lblT, digits); U.show(lbl, true);
      digitT = setTimeout(function () {
        digitT = 0; var n = Number(digits); digits = '';
        if (n >= 1 && n <= list.length && n - 1 !== idx) tune(n - 1, false, true); else setLabel();
      }, DIGIT_MS);
    }

    s.hints = function () {
      if (errOn) return [{ k: 'ret', t: 'hint.back' }];
      if (!osd) return [];
      return [{ k: 'blue', t: 'hint.sleep' }, { k: 'TOOLS', t: 'hint.options' }, { k: 'INFO', t: 'hint.info' }, { k: 'ret', t: 'hint.back' }];
    };
    s.onKey = function (k) {
      if (errOn) {
        if (sb.onKey(k)) return true;
        if (k === 'RETURN' || k === 'STOP') close();
        else if (k === 'CH_UP') step(1); else if (k === 'CH_DOWN') step(-1);
        return true;
      }
      dirSync();
      if (N.keys.isDigit(k)) { digit(k); return true; }
      switch (k) {
        case 'BLUE': showOsd(); sleepPanel(null); return true;
        case 'RETURN': if (osd) hideOsd(true); else close(); return true;
        case 'STOP': close(); return true;
        case 'CH_UP': step(1); showOsd(); return true;          // wie beim Fernsehen: CH▲ = naechster Sender (Nutzer 05.11.)
        case 'CH_DOWN': step(-1); showOsd(); return true;
        case 'PLAY': case 'PAUSE': toggle(); return true;
        case 'TOOLS': showOsd(); more(); return true;
        case 'INFO': info(); return true;
        case 'LEFT': case 'RIGHT':
          if (!osd) { showOsd(); return true; }
          var j = btnIdx(fb) + (k === 'LEFT' ? -1 : 1);
          if (j >= 0 && j < BTNS.length) setFocus(BTNS[j].id);
          showOsd(); return true;
        case 'UP': case 'DOWN': showOsd(); return true;
        case 'ENTER': if (!osd) { showOsd(); return true; } press(fb); if (osd) showOsd(); return true;
        case 'FF': case 'RW': showOsd(); return true;             // Live: kein Spulen
      }
      return true;
    };
    /* Zeiger/Finger: Knoepfe der Bedien-Insel, Zurueck oben links; sonst blendet ein Tipp das OSD ein/aus. Punkte wie im Video-Player
     * (Kasten -> Bildschirm -> Lagen-Raster; am TV unveraendert), Finger: kein Zeigen, das Tippen kommt als Klick */
    s.pointer = function (x, y, kind) {
      var sp = N.screen.fromStage(x, y), pt = full(sp.x, sp.y); x = pt.x; y = pt.y;
      if (errOn) return sb.pointer(x, y, kind);
      dirSync();
      if (N.input.mode === 'touch' && kind === 'move') return true;
      if (bk && dir && osd && x >= G.TX - 8 && x < G.TX + 80 && y >= G.TY - 8 && y < G.TY + 80) { if (kind === 'click') close(); return true; }
      if (osd) {
        var b = O.hit(IDS, x, y, G.osd);
        if (b) { setFocus(b); showOsd(); if (kind === 'click') press(b); return true; }
      }
      if (kind === 'click') { if (osd) hideOsd(true); else showOsd(); }
      else if (!osd && kind === 'move') showOsd();
      return true;
    };
    s.relabel = function () { if (ch) { paintTitle(); paintNow(); } U.setText(pill, N.t('lv.live')); setLabel(); };
    return s;
  });
})(N);
