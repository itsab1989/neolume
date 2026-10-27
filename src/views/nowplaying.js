/* Ansicht 'nowplaying' – Jetzt laeuft (M4; research 3.2/3.3). Liest nur den Zustand von N.audio (Wiedergabe laeuft weiter, wenn
 * die Ansicht geschlossen wird). Hintergrund Art bzw. Cover unscharf + Scrim, Cover 400x400 links, rechts Ueberzeile, Titel, Interpret,
 * Album bzw. Kapitel, Fortschrittsbalken + Zeiten (max. 1x/s), Knopfreihe (Sprite-Symbole) mit Label unter dem fokussierten Knopf:
 *   Musik:    ⏮ · −10 · ⏯ · +10 · ⏭ · Zufall · Wiederholen (aus/alle/einen) · Warteschlange · Sleep-Timer
 *   Hoerbuch: Kapitel zurueck · −30 · ⏯ · +30 · Kapitel vor · Kapitel · Sleep-Timer (inkl. "Ende des Kapitels"); kein Zufall/Wiederholen
 * Tasten: OK Knopf, PLAY/PAUSE, RW/FF Sprung, CH▲▼ Titel/Kapitel, STOP beenden, Gelb Warteschlange/Kapitel, Blau Sleep-Timer,
 * RETURN zurueck zum Stoebern (Ton laeuft weiter, Mini-Player). Zeiger: alles anklickbar, Balken = Sprung. */
(function (N) {
  var U = N.util, MU = N.music, F = N.fmt, X0 = 600, BY = 488, BAR_X = 600, BAR_W = 536, BAR_Y = 404;
  N.router.define('nowplaying', function () {
    var s = { rail: N.ui.rail && N.ui.rail.cur || 'home', wheelKeys: ['LEFT', 'RIGHT'] };   // Seitenleiste sichtbar (Feedback-Regel 3)
    var root, bg, cover, cfb, cfbT, ovT, tiT, arT, alT, chT, nxT, stT, tm0, tm1, barI, lbl, lblT, btnEl = {}, ids = [], fb = 'pp', ppIc, repIc, dots = {}, timer = 0;
    var shown = { art: null, rk: null }, lastSec = -1, hs = [];
    function C() { return N.audio.core(); }
    function book() { var c = C(); return !!(c && c.book); }
    function step() { return book() ? 30000 : 10000; }

    s.create = function (el) {
      root = el;
      bg = U.el('img', 'full', root); bg.src = N.img.BLANK; bg.style.visibility = 'hidden';
      var scrim = U.el('img', 'full', root); scrim.src = N.assetBase + 'scrim-np.png';   // kraeftiger: Text rechts auch auf hellen Bildern lesbar (F24)
      var cv = U.el('div', 'np-cover', root);
      cfb = U.el('div', 'np-fb', cv, 'display:none'); cfbT = document.createTextNode(''); cfb.appendChild(cfbT);   // ohne Cover: farbige Titelkarte (F28)
      cover = U.el('img', '', cv); cover.src = N.img.BLANK;
      ovT = U.txt('div', 'np-ov t-label cacc ell', root, '');
      tiT = U.txt('div', 'np-ti t-h1', root, '');
      arT = U.txt('div', 'np-ar t-h2 c2 ell', root, '');
      alT = U.txt('div', 'np-al t-body c2 ell', root, '');
      chT = U.txt('div', 'np-ch t-body ell', root, '');
      var tr = U.el('div', 'np-bar', root); barI = U.el('i', '', tr);
      tm0 = U.txt('div', 'np-tm0', root, ''); tm1 = U.txt('div', 'np-tm1', root, '');
      stT = U.txt('div', 'np-st t-small c2 ell', root, '');
      nxT = U.txt('div', 'np-nx t-small c2 ell', root, '');
      lbl = U.el('div', 'np-lbl', root); lblT = document.createTextNode(''); lbl.appendChild(lblT);
      buildButtons();
      hs = [['audio:track', onTrack], ['audio:state', onState], ['audio:queue', onQueue], ['audio:chapters', onTrack]];
      for (var i = 0; i < hs.length; i++) N.evt.on(hs[i][0], hs[i][1]);
    };
    /* Knopfreihe je Modus (einmal je Modus aufgebaut, kein Umbau im Tastenpfad) */
    function buildButtons() {
      var want = book() ? ['prev', 'back', 'pp', 'fwd', 'next', 'chapters', 'sleep'] : ['prev', 'back', 'pp', 'fwd', 'next', 'shuffle', 'repeat', 'queue', 'sleep'];
      if (want.join() === ids.join()) return;
      for (var k in btnEl) if (btnEl[k].parentNode) btnEl[k].parentNode.removeChild(btnEl[k]);
      btnEl = {}; dots = {}; ids = want;
      var x = X0;
      for (var i = 0; i < ids.length; i++) {
        var id = ids[i], lg = id === 'pp', b = U.el('div', 'pl-b np-b' + (lg ? ' lg' : ''), root, 'left:' + x + 'px;top:' + (lg ? BY - 8 : BY) + 'px');
        b._x = x; b._w = lg ? 64 : 48;
        if (id === 'back' || id === 'fwd') U.txt('div', 'num', b, String(step() / 1000));
        else {
          var ic = N.ui.icon(b, { prev: 'prev', pp: 'pause', next: 'next', shuffle: 'shuffle', repeat: 'repeat', queue: 'chapters', chapters: 'chapters', sleep: 'moon' }[id]);
          if (id === 'pp') ppIc = ic; if (id === 'repeat') repIc = ic;
        }
        if (id === 'shuffle' || id === 'repeat' || id === 'sleep') dots[id] = U.el('i', 'np-dot', b, 'display:none');
        btnEl[id] = b;
        x += (lg ? 64 : 48) + 16;
      }
      if (ids.indexOf(fb) < 0) fb = 'pp';
      U.cls(btnEl[fb], 'is-focus', true);
      paintLabel();
    }
    function label(id) {
      var c = C(), q = c && c.q;
      switch (id) {
        case 'prev': return N.t(book() ? 'mu.b.prevCh' : 'mu.b.prev');
        case 'next': return N.t(book() ? 'mu.b.nextCh' : 'mu.b.next');
        case 'back': return N.t('mu.b.back', { n: step() / 1000 });
        case 'fwd': return N.t('mu.b.fwd', { n: step() / 1000 });
        case 'pp': return N.t(c && c.state === 'paused' ? 'mu.b.play' : 'mu.b.pause');
        case 'shuffle': return N.t(q && q.shuffle ? 'mu.b.shuffleOn' : 'mu.b.shuffleOff');
        case 'repeat': return N.t('mu.b.repeat.' + (q ? q.repeat : 'off'));
        case 'queue': return N.t('mu.b.queue');
        case 'chapters': return N.t('mu.b.chapters');
        case 'sleep': return c && c.sleep.mode !== 'off' ? sleepText() : N.t('pl.sleep');
      }
      return '';
    }
    function paintLabel() {
      var b = btnEl[fb]; if (!b) return;
      U.setText(lblT, label(fb));
      lbl.style.left = (b._x + b._w / 2 - 150) + 'px';
    }
    function setFb(id) { U.cls(btnEl[fb], 'is-focus', false); fb = id; U.cls(btnEl[fb], 'is-focus', true); N.fx.move(btnEl[fb]); paintLabel(); }
    function paintToggles() {
      var c = C(), q = c && c.q;
      if (ppIc) N.ui.setIcon(ppIc, c && (c.state === 'paused' || c.state === 'done' || c.state === 'stopped' || c.state === 'error') ? 'play' : 'pause');
      if (dots.shuffle) U.show(dots.shuffle, !!(q && q.shuffle));
      if (dots.repeat) { U.show(dots.repeat, !!(q && q.repeat !== 'off')); if (repIc) N.ui.setIcon(repIc, q && q.repeat === 'one' ? 'repeat1' : 'repeat'); }
      if (dots.sleep) U.show(dots.sleep, !!(c && c.sleep.mode !== 'off'));
      paintLabel();
    }

    /* ---------- Zustand -> Anzeige ---------- */
    function onTrack() {
      var c = C(), it = c && c.item;
      buildButtons();
      if (!it) { U.setText(tiT, N.t('mu.np.none')); return; }
      U.setText(ovT, N.t(c.book ? 'mu.np.book' : 'mu.np.music'));
      U.setText(tiT, c.book && c.ctx && c.ctx.title && c.chs.length < 2 && c.q.size() > 1 ? c.ctx.title : it.title);
      U.setText(arT, it.artist);
      U.setText(alT, c.book ? (c.q.size() > 1 ? it.title : '') : it.album);
      if (shown.rk !== it.rk) {
        shown.rk = it.rk;
        coverFb(it, !it.thumb);
        N.img.want(cover, it.thumb ? N.img.url(it.thumb, 'coverL') : '', 0, function (ok) { if (!ok && shown.rk === it.rk) coverFb(it, true); });
        var b = N.img.bg(it.art, it.thumb), url = b ? b.url : '', soft = !!(b && b.soft);   // Art scharf, sonst Albumcover unscharf; Einstellung Hintergrundbilder
        if (url !== shown.art) {
          shown.art = url; bg.style.visibility = 'hidden';
          if (url) { bg.onload = function () { bg.onload = null; N.img.fit(bg, soft); U.raf(function () { bg.style.visibility = 'visible'; }); }; bg.src = url; }
        }
      }
      lastSec = -1; tick(true); onQueue(); paintToggles();
    }
    /* Titelkarte wie auf der Albumseite: Album- bzw. Buchtitel, Farbe je Titel */
    function coverFb(it, on) {
      if (on) { cfb.className = 'np-fb ' + N.ui.fbClass(it); U.setText(cfbT, it.album || it.title || ''); }
      U.show(cfb, on);
    }
    function onState() { paintToggles(); tick(true); }
    function onQueue() {
      var c = C(), q = c && c.q, p = q ? q.nextPos(true) : -1, nx = p >= 0 && p !== q.pos ? q.itemAt(p) : null;
      U.setText(nxT, nx && !(c.book && c.chs.length > 1) ? N.t('mu.np.next', { t: nx.title + (nx.artist && !c.book ? ' · ' + nx.artist : '') }) : '');
      paintToggles();
    }
    function sleepText() {
      var c = C(), m = c ? c.sleep.mode : 'off';
      if (m === 'off') return N.t('set.v.off');
      if (m === 'end') return N.t(book() ? 'mu.sleep.endChapter' : 'mu.sleep.endTrack');
      return N.t('pl.sleep.left', { n: N.osd.sleepLeft(c.sleep.at, U.now()) });
    }
    /* Zeit/Balken max. 1x/s (SPEC 7.10) */
    function tick(force) {
      var c = C(); if (!c || !c.item) return;
      var t = c.t, d = c.dur(), sec = Math.floor(t / 1000);
      if (!force && sec === lastSec) return;
      lastSec = sec;
      var st = c.state, k = c.chs.length > 1 ? c.chapterAt() : -1;
      U.setText(stT, st === 'paused' ? N.t('mu.np.paused') : st === 'loading' || st === 'buffering' ? N.t('common.loading') : st === 'done' || (st === 'stopped' && !c.errKind) ? N.t('mu.np.ended') : st === 'error' || (st === 'stopped' && c.errKind) ? N.t(c.errKind === 'unreach' ? 'mu.err.unreach' : 'mu.err.track') : '');
      if (c.book) {
        var line = '';
        if (k >= 0) line = N.t('mu.np.chapterOf', { n: k + 1, k: c.chs.length, t: c.chs[k].t });
        else if (c.q.size() > 1) line = N.t('mu.np.chapterOf', { n: c.q.pos + 1, k: c.q.size(), t: c.item.title });
        var all = MU.totalDur(c.q.items), before = 0;
        for (var i = 0; i < c.q.pos; i++) before += c.q.itemAt(i).dur || 0;
        if (all > d) line = F.join([line, N.t('mu.np.bookLeft', { time: F.dur(Math.max(0, all - before - t)) })]);
        U.setText(chT, line);
      } else U.setText(chT, '');
      if (k >= 0) {   // eingebettete Kapitel: Balken und Zeiten im Kapitel
        var ch = c.chs[k], ce = ch.end || (c.chs[k + 1] ? c.chs[k + 1].start : d), cd = Math.max(1, ce - ch.start);
        barI.style.width = Math.round(BAR_W * U.clamp((t - ch.start) / cd, 0, 1)) + 'px';
        U.setText(tm0, MU.clock(t - ch.start)); U.setText(tm1, '-' + MU.clock(Math.max(0, ce - t)));
        return;
      }
      barI.style.width = (d ? Math.round(BAR_W * U.clamp(t / d, 0, 1)) : 0) + 'px';
      U.setText(tm0, MU.clock(t)); U.setText(tm1, d ? MU.clock(d) : '');
    }

    /* ---------- Aktionen ---------- */
    function act(id) {
      var c = C(); if (!c) return;
      switch (id) {
        case 'pp': if (c.active()) c.toggle(); else N.audio.restart(); break;
        case 'prev': c.prev(); break;
        case 'next': c.next(); break;
        case 'back': c.seekBy(-step()); tick(true); break;
        case 'fwd': c.seekBy(step()); tick(true); break;
        case 'shuffle': c.setShuffle(!(c.q && c.q.shuffle)); N.ui.toast.show(N.t(c.q.shuffle ? 'mu.b.shuffleOn' : 'mu.b.shuffleOff'), { icon: 'confirm' }); break;
        case 'repeat': var r = c.cycleRepeat(); N.ui.toast.show(N.t('mu.b.repeat.' + r), { icon: 'confirm' }); break;
        case 'queue': case 'chapters': listPanel(); break;
        case 'sleep': sleepPanel(); break;
      }
      paintToggles();
    }
    /* Warteschlange (Musik) bzw. Kapitel (Hoerbuch): OK springt */
    function listPanel() {
      var c = C(); if (!c || !c.q) return;
      var e = [], i, sel = '';
      if (c.book && c.chs.length > 1) {
        var k = c.chapterAt();
        for (i = 0; i < c.chs.length; i++) e.push({ id: 'c' + i, t: c.chs[i].t, s: MU.clock(c.chs[i].start) });
        sel = 'c' + Math.max(0, k);
      } else {
        var l = c.q.list();
        for (i = 0; i < l.length; i++) e.push({ id: 'q' + i, t: l[i].title, s: F.join([c.book ? '' : l[i].artist, l[i].dur ? MU.clock(l[i].dur) : '']) });
        sel = 'q' + c.q.pos;
      }
      N.ui.panel.select({ title: N.t(c.book ? 'mu.b.chapters' : 'mu.b.queue'), entries: e, selected: sel, onSelect: function (id) {
        var n = Number(id.slice(1));
        if (id.charAt(0) === 'c') c.seekTo(c.chs[n].start); else if (n !== c.q.pos) c.jump(n);
      } });
    }
    function sleepPanel() {
      var c = C(); if (!c) return;
      var opts = ['off', 'end', 15, 30, 45, 60, 90], e = [];
      for (var i = 0; i < opts.length; i++) {
        var v = opts[i];
        e.push({ id: String(v), t: v === 'off' ? N.t('set.v.off') : v === 'end' ? N.t(book() ? 'mu.sleep.endChapter' : 'mu.sleep.endTrack') : N.t('pl.sleep.min', { n: v }),
          s: v === c.sleep.mode && typeof v === 'number' ? sleepText() : '' });
      }
      N.ui.panel.select({ title: N.t('pl.sleep'), entries: e, selected: String(c.sleep.mode), onSelect: function (id) {
        c.setSleep(id === 'off' || id === 'end' ? id : Number(id));
        paintToggles();
      } });
    }

    s.hints = function () { return [{ k: 'yellow', t: book() ? 'mu.hint.chapters' : 'mu.hint.queue' }, { k: 'blue', t: 'hint.sleep' }, { k: 'INFO', t: 'hint.help' }, { k: 'ret', t: 'hint.back' }]; };
    s.enter = function () {
      onTrack();
      if (!timer) timer = setInterval(function () { tick(false); }, 1000);
      N.router.refreshHints();
    };
    s.railBlur = function () { U.cls(btnEl[fb], 'is-focus', false); };
    s.railFocus = function () { U.cls(btnEl[fb], 'is-focus', true); };
    s.leave = function () { if (timer) { clearInterval(timer); timer = 0; } return null; };
    s.destroy = function () {
      if (timer) { clearInterval(timer); timer = 0; }
      for (var i = 0; i < hs.length; i++) N.evt.off(hs[i][0], hs[i][1]);
      N.img.drop(cover);
    };
    s.onKey = function (k) {
      var c = C(), i = ids.indexOf(fb);
      switch (k) {
        case 'LEFT': if (i > 0) setFb(ids[i - 1]); else N.ui.rail.open(); return true;
        case 'RIGHT': if (i < ids.length - 1) setFb(ids[i + 1]); return true;
        case 'ENTER': act(fb); return true;
        case 'PLAY': case 'PAUSE': act('pp'); return true;
        case 'RW': act('back'); return true;
        case 'FF': act('fwd'); return true;
        case 'CH_UP': act('prev'); return true;
        case 'CH_DOWN': act('next'); return true;
        case 'YELLOW': listPanel(); return true;
        case 'BLUE': sleepPanel(); return true;
        case 'STOP': if (c) c.stop('STOP'); N.router.back(); return true;
        case 'INFO': N.ui.panel.help(N.t('mu.np.help.title'), N.t(book() ? 'mu.np.help.book' : 'mu.np.help.music')); return true;
        case 'RETURN': N.router.back(); return true;
      }
      return true;
    };
    s.pointer = function (x, y, kind) {
      for (var i = 0; i < ids.length; i++) {
        var b = btnEl[ids[i]], top = ids[i] === 'pp' ? BY - 8 : BY;
        if (x >= b._x && x < b._x + b._w && y >= top && y < top + b._w) { if (fb !== ids[i]) setFb(ids[i]); if (kind === 'click') act(ids[i]); return true; }
      }
      if (kind === 'click' && x >= BAR_X - 8 && x < BAR_X + BAR_W + 8 && y >= BAR_Y - 14 && y < BAR_Y + 14) {
        var c = C(); if (!c || !c.dur()) return true;
        var k = c.chs.length > 1 ? c.chapterAt() : -1, a = 0, z = c.dur();
        if (k >= 0) { a = c.chs[k].start; z = c.chs[k].end || (c.chs[k + 1] ? c.chs[k + 1].start : z); }
        c.seekTo(a + (z - a) * U.clamp((x - BAR_X) / BAR_W, 0, 1)); tick(true);
        return true;
      }
      return false;
    };
    s.relabel = function () { ids = []; buildButtons(); onTrack(); };
    return s;
  });
})(N);
