/* Ansicht 'artist' – Kuenstler bzw. Autor (M4; Feedback-Regel 3; research 3.1).
 * Erster Bildschirm (N.ui.DetHero): Hintergrund (Art), Bild quadratisch, Name, "12 Alben", Biografie, Knoepfe Abspielen · Zufall · "⋯".
 * Darunter angeschnitten (y 580) die Reihe Alben/Buecher (quadratische Karten, N.ui.Row 'sq'), dann "Beliebte Titel" (PopularLeaves).
 * params: {it: {rk, type:'artist', title, thumb, lib}} */
(function (N) {
  var U = N.util, M = N.model, MU = N.music, F = N.fmt, PEEK = 580, POP_Y = PEEK + 316;

  N.router.define('artist', function (params) {
    var it0 = params.it || {}, book = MU.isBookItem(it0);
    var s = { rail: it0.lib ? 'lib-' + it0.lib : N.ui.rail && N.ui.rail.cur || 'home', wheelKeys: ['LEFT', 'RIGHT'] };
    var root, hero, pg, bar, btns = [], bdefs = [], btnRects = null, row, popHead, pop, ring, sb;
    var meta = null, albums = [], popular = [], zone = 'btn', bf = 0, off = 0, gen = 0, tasks = [], dead = false, away = false, onTrack = null;

    s.create = function (el) {
      root = el;
      hero = new N.ui.DetHero(root, { square: true });
      pg = U.el('div', 'pg', root);
      bar = U.el('div', 'd-btns', pg);
      row = new N.ui.Row(pg, { captions: function () { return true; } });
      row.setTop(PEEK);
      popHead = U.el('div', 'tl-head t-h2 ell', pg, 'top:' + POP_Y + 'px;display:none'); popHead.appendChild(document.createTextNode(''));
      pop = new N.ui.TrackList(pg, { x: 144, y: POP_Y + 44, w: 992, vis: 7, row: popRow });
      hero.makeInfo(root);
      var fade = U.el('img', 'fade', root); fade.src = N.assetBase + 'fade-bottom.png';
      ring = new N.ui.Ring(root);
      sb = new N.ui.StateBlock(root);
      hero.paint(N.t(book ? 'mu.ov.author' : 'mu.ov.artist'), it0.title, '', '');
      hero.setPoster(it0.thumb, it0.title);
      buildButtons();
      onTrack = function () { if (!dead) { var c = N.audio.core(); pop.setCurrent(c && c.item ? c.item.rk : ''); } };
      N.evt.on('audio:track', onTrack);
    };
    function track(t) { tasks.push(t); return t; }
    function kinds() { var hc = N.session.homeCache(); return N.hubs.libKinds(hc && (hc.alibs || hc.libs) || []); }
    function load() {
      gen++; var g = gen;
      track(N.plex.get('/library/metadata/' + it0.rk, { includePopularLeaves: 1, excludeElements: 'Image,UltraBlurColors,Guid,Similar,Location' }, { timeout: 12000 }, function (err, d) {
        var m = !err && d && d.MediaContainer && d.MediaContainer.Metadata && d.MediaContainer.Metadata[0];
        if (g !== gen || dead) return;
        if (!m) { onError(err); return; }
        meta = { title: String(m.title || it0.title || ''), sum: String(m.summary || ''), art: m.art || '', thumb: m.thumb || it0.thumb || '', lib: Number(m.librarySectionID) || it0.lib || 0 };
        popular = MU.tracks({ MediaContainer: m.PopularLeaves || {} }).slice(0, 10);
        if (meta.lib && s.rail !== 'lib-' + meta.lib) { s.rail = 'lib-' + meta.lib; if (N.router.top() === s) N.ui.rail.attach(s.rail); }
        hero.loadBg(meta.art, meta.thumb);
        if (meta.thumb !== it0.thumb) hero.setPoster(meta.thumb, meta.title);
        U.setText(popHead.firstChild, N.t('mu.row.popular'));
        U.show(popHead, popular.length > 0);
        pop.setItems(popular, 0); onTrack();
        paint();
      }));
      track(N.plex.get('/library/metadata/' + it0.rk + '/children', { excludeElements: N.hubs.EXCL }, { timeout: 12000 }, function (err, d) {
        if (g !== gen || dead || err) return;
        var mc = d && d.MediaContainer;
        albums = M.normList(mc && mc.Metadata || [], kinds(), mc && mc.librarySectionID || it0.lib);
        for (var i = 0; i < albums.length; i++) if (!albums[i].artist) albums[i].artist = albums[i].year ? String(albums[i].year) : '';
        row.setModel({ id: 'albums', kind: 'sq', tk: book ? 'mu.row.books' : 'mu.row.albums', items: albums }, 0);
        paint();
      }));
    }
    function onError(err) {
      var k = N.errs.kind(err, 'pms');
      if (k === 'auth') { N.app.authLost(); return; }   // Kinderprofil-Pruefung wie Startseite (Pentest P6)
      var tx = k === 'server' ? { title: N.t('err.server.title'), text: N.t('lib.err.text', { server: N.session.state.server && N.session.state.server.name || '' }) } : N.errs.texts('generic', null, N.session.isKid());
      U.vis(pg, false); hero.vis(false);
      sb.show({ title: tx.title, text: tx.text, buttons: [{ id: 'retry', t: N.t('err.btn.retry') }, { id: 'back', t: N.t('err.btn.back') }],
        onSelect: function (id) { if (id === 'back') { N.router.back(); return; } sb.hide(); U.vis(pg, true); hero.vis(true); zone = 'btn'; load(); } });
      zone = 'state';
    }
    function paint() {
      if (!hero.on) return;
      var p = [];
      if (albums.length) p.push(N.tn(book ? 'mu.books' : 'mu.albums', albums.length));
      hero.paint(N.t(book ? 'mu.ov.author' : 'mu.ov.artist'), meta ? meta.title : it0.title, F.join(p), meta ? meta.sum : '');
    }
    function buildButtons() {
      while (bar.firstChild) bar.removeChild(bar.firstChild);
      bdefs = [{ id: 'play', t: N.t('mu.btn.play') }];
      if (!book) bdefs.push({ id: 'shuffle', t: N.t('lib.shuffle') });
      bdefs.push({ id: 'more', t: '', icon: 'more' });
      btns = []; btnRects = null;
      for (var i = 0; i < bdefs.length; i++) {
        var b = U.el('div', bdefs[i].icon ? 'btn inl ib' : 'btn inl', bar);
        if (bdefs[i].icon) N.ui.icon(b, bdefs[i].icon); else b.appendChild(document.createTextNode(bdefs[i].t));
        btns.push(b);
      }
      if (zone === 'btn') U.cls(btns[bf], 'is-focus', true);
      setTimeout(function () { if (dead) return; btnRects = []; for (var k = 0; k < btns.length; k++) btnRects.push([352 + btns[k].offsetLeft, btns[k].offsetWidth]); }, 50);
    }
    function popRow(x, i) { return x ? { n: i + 1, t: x.title, s: x.album, d: x.dur ? MU.clock(x.dur) : '' } : { t: '' }; }

    /* ---------- Zonen ---------- */
    function setOff(o) { if (o !== off) { off = o; N.fx.move(pg); U.tf(pg, 0, -o); } }
    function placeRing(p) { if (p) ring.to(p.shape, p.x, p.y - off); }
    function leave() {
      if (zone === 'btn') U.cls(btns[bf], 'is-focus', false);
      else if (zone === 'row') { row.setFocused(false); ring.hide(); }
      else if (zone === 'pop') pop.setFocused(false);
    }
    function to(z) {
      if (z === 'row' && !row.count()) z = popular.length ? 'pop' : 'btn';
      if (z === 'pop' && !popular.length) return;
      leave(); zone = z;
      if (z === 'btn') { setOff(0); hero.hero(true); U.vis(bar, true); U.cls(btns[bf], 'is-focus', true); paint(); }
      else if (z === 'row') { setOff(PEEK - 236); hero.hero(false); U.vis(bar, false); row.setFocused(true); row.boost(); placeRing(row.ringPos()); }
      else { setOff(POP_Y - 236); hero.hero(false); U.vis(bar, false); pop.setFocused(true); }
      N.router.refreshHints();
    }
    function setBtn(i) { U.cls(btns[bf], 'is-focus', false); bf = i; U.cls(btns[bf], 'is-focus', true); N.fx.move(btns[bf]); }
    function playAll() { MU.play({ rk: it0.rk, type: 'artist', title: meta ? meta.title : it0.title, lib: meta ? meta.lib : it0.lib }); }
    function playPop(i) {
      if (!popular.length) return;
      N.audio.play(popular, i, { ctx: { title: N.t('mu.row.popular'), rk: it0.rk, lib: it0.lib } });
      N.router.push('nowplaying');
    }
    function btnAct(id) {
      if (id === 'play') playAll(false);
      else if (id === 'shuffle') shuffleAll();
      else if (id === 'more') N.ui.panel.help(meta ? meta.title : it0.title, U.trim(meta ? meta.sum : '', 600) || N.t('mu.noBio'));
    }
    /* Zufall ueber alle Titel des Kuenstlers (lokal gemischt) */
    function shuffleAll() {
      N.plex.get('/library/metadata/' + it0.rk + '/allLeaves', { 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 500, excludeElements: 'Image,UltraBlurColors,Guid,Mood' }, { timeout: 12000 }, function (err, d) {
        var tr = err ? [] : MU.tracks(d);
        if (dead || !tr.length) { if (err) N.ui.toast.show(N.t('toast.actionFailed')); return; }
        N.audio.play(tr, Math.floor(Math.random() * tr.length), { shuffle: true, ctx: { title: meta ? meta.title : it0.title, rk: it0.rk, lib: it0.lib } });
        N.router.push('nowplaying');
      });
    }

    s.hints = function () {
      if (sb.on) return [{ k: 'ret', t: 'hint.back' }];
      var l = [];
      if (N.audio.active()) l.push({ k: 'green', t: 'mu.hint.nowPlaying' });
      l.push({ k: 'blue', t: 'hint.search' }); l.push({ k: 'INFO', t: 'hint.details' });
      return l;
    };
    s.enter = function () {
      away = false;
      if (!gen) { load(); return; }
      if (zone === 'btn') U.cls(btns[bf], 'is-focus', true); else if (zone === 'row') { row.setFocused(true); placeRing(row.ringPos()); } else if (zone === 'pop') pop.setFocused(true);
      N.router.refreshHints();
    };
    s.leave = function () { away = true; return null; };
    s.destroy = function () {
      dead = true; gen++;
      for (var i = 0; i < tasks.length; i++) if (tasks[i]) tasks[i].abort();
      N.evt.off('audio:track', onTrack);
      row.clear(); pop.clear(); hero.destroy();
    };
    s.railBlur = function () { leave(); };
    s.railFocus = function () { var z = zone; zone = ''; if (z === 'btn') { zone = 'btn'; U.cls(btns[bf], 'is-focus', true); } else to(z); };
    s.onKey = function (k) {
      if (k === 'BLUE') { N.router.push('search'); return true; }
      if (zone === 'state') { if (sb.onKey(k)) return true; return k !== 'RETURN'; }
      if (k === 'RETURN') { if (zone !== 'btn') { to('btn'); return true; } N.router.back(); return true; }
      if (k === 'INFO') { if (zone === 'row') { var a = row.item(row.f); if (a) MU.open(a); } else btnAct('more'); return true; }
      if (zone === 'btn') {
        switch (k) {
          case 'LEFT': if (bf > 0) setBtn(bf - 1); else N.ui.rail.open(); return true;
          case 'RIGHT': if (bf < btns.length - 1) setBtn(bf + 1); return true;
          case 'DOWN': to('row'); return true;
          case 'ENTER': btnAct(bdefs[bf].id); return true;
          case 'PLAY': playAll(false); return true;
        }
        return true;
      }
      if (zone === 'row') {
        switch (k) {
          case 'LEFT': if (row.f > 0) placeRing(row.focusCol(row.f - 1)); else N.ui.rail.open(); return true;
          case 'RIGHT': if (row.f < row.count() - 1) placeRing(row.focusCol(row.f + 1)); return true;
          case 'UP': to('btn'); return true;
          case 'DOWN': to('pop'); return true;
          case 'ENTER': MU.open(row.item(row.f)); return true;
          case 'PLAY': MU.play(row.item(row.f)); return true;
        }
        return true;
      }
      var f = pop.f;
      switch (k) {
        case 'UP': if (f > 0) pop.focusTo(f - 1); else to('row'); return true;
        case 'DOWN': pop.focusTo(f + 1); return true;
        case 'LEFT': N.ui.rail.open(); return true;
        case 'ENTER': case 'PLAY': playPop(f); return true;
      }
      return true;
    };
    s.pointer = function (x, y, kind) {
      if (sb.on) return sb.pointer(x, y, kind);
      var py = y + off, i;
      if (zone === 'btn' && py >= 448 && py < 496 && btnRects) {
        for (i = 0; i < btnRects.length; i++) if (x >= btnRects[i][0] && x < btnRects[i][0] + btnRects[i][1]) { if (i !== bf) setBtn(i); if (kind === 'click') btnAct(bdefs[i].id); return true; }
        return false;
      }
      var cy = PEEK + 52;
      if (row.count() && py >= cy && py < cy + 176 && y < 632) {
        var h = row.hit(x); if (h < 0) return false;
        if (zone !== 'row') to('row');
        if (h !== row.f) placeRing(row.hoverCol(h));
        if (kind === 'click') MU.open(row.item(h));
        return true;
      }
      if (popular.length && x >= 144 && x < 1136 && y < 632) {
        var j = pop.hit(py - POP_Y - 44); if (j < 0) return false;
        if (zone !== 'pop') to('pop');
        if (j !== pop.f) pop.focusTo(j);
        if (kind === 'click') playPop(j);
        return true;
      }
      return false;
    };
    s.relabel = function () { paint(); buildButtons(); row.relabel(); };
    return s;
  });
})(N);
