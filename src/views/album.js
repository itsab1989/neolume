/* Ansicht 'album' – Album- und Hoerbuch-Details (M4; Feedback-Regel 3; research music-audiobooks 3.1/3.3).
 * - Erster Bildschirm (N.ui.DetHero, gleiche Mechanik wie Film/Serie): Hintergrund, quadratisches Cover links, Ueberzeile ALBUM/HOERBUCH,
 *   Titel, Metazeile (Interpret/Autor · Jahr · Titel/Kapitel · Dauer · Rest), Beschreibung, Knoepfe y 448.
 *   Album: Abspielen · Zufall · "⋯". Hoerbuch: "Fortsetzen · Kapitel 12 · 14:03" bzw. Abspielen · Von vorn · "⋯".
 * - Darunter angeschnitten (y 580) die Titel- bzw. Kapitelliste (N.ui.TrackList); ▼ gleitet hin, Info-Block oben, Cover blendet aus.
 *   Hoerbuch als eine Datei mit eingebetteten Kapiteln (M4B): Liste = Kapitel. OK spielt ab dem Titel/Kapitel (Rest = Warteschlange).
 * - Gelb (Hoerbuch): als gehoert/ungehoert markieren (Scrobble des Albums). Gruen: Jetzt laeuft (global, N.audio.key). Blau: Suche.
 * params: {it: album (normalisiert, type 'album')} */
(function (N) {
  var U = N.util, MU = N.music, F = N.fmt, MINI_ROOM = 2, PEEK = 580, LIST_Y = 624, ANCHOR_OFF = PEEK - 236;

  N.router.define('album', function (params) {
    var it0 = params.it || {}, book = MU.isBookItem(it0);
    // Weitere Server (N.srv): Album eines fremden Servers -> alle Anfragen dorthin
    var srv = it0.srv || '';
    function get(path, q, o, cb) { return N.plex.get(path, q, N.srv.o(srv, o), cb); }
    function railId(lib) { return N.railRows.libId({ id: lib, srv: srv }); }
    var s = { rail: it0.lib ? railId(it0.lib) : N.ui.rail && N.ui.rail.cur || 'home', wheelKeys: ['UP', 'DOWN'] };
    var root, hero, pg, bar, btns = [], bdefs = [], btnRects = null, blbl, blblT, headT, cntT, list, sb;
    var meta = null, tracks = [], chs = [], rows = [], kind = 'tracks', res = null, zone = 'btn', bf = 0, off = 0, gen = 0, tasks = [], dead = false, away = false;
    var onTrack = null, onMini = null, jump = { d: '', t: 0 };

    s.create = function (el) {
      root = el;
      hero = new N.ui.DetHero(root, { square: true });
      pg = U.el('div', 'pg', root);
      bar = U.el('div', 'd-btns', pg);
      blbl = U.el('div', 'blbl', pg, 'display:none'); blblT = document.createTextNode(''); blbl.appendChild(blblT);
      var hd = U.el('div', 'tl-head t-h2 ell', pg, 'top:' + PEEK + 'px');
      headT = document.createTextNode(N.t(book ? 'mu.row.chapters' : 'mu.row.tracks')); hd.appendChild(headT); cntT = U.txt('span', 'cnt', hd, '');
      list = new N.ui.TrackList(pg, { x: 144, y: LIST_Y, w: 992, vis: 7, full: 6, row: rowView });   // 7. Zeile nur angeschnitten (Band ab y 632)
      hero.makeInfo(root);
      var fade = U.el('img', 'fade', root); fade.src = N.assetBase + 'fade-bottom.png';
      sb = new N.ui.StateBlock(root);
      hero.paint(N.t(book ? 'mu.ov.book' : 'mu.ov.album'), it0.title, it0.artist || '', '');
      hero.setPoster(it0.thumb, it0.title);
      buildButtons();
      onTrack = function () { if (!dead) { var c = N.audio.core(); list.setCurrent(c && c.item ? c.item.rk : ''); } };
      N.evt.on('audio:track', onTrack); N.evt.on('audio:state', onTrack);
      onMini = function (on) { list.setRoom(on ? MINI_ROOM : 0); };   // letzte Titel/Kapitel ueber dem Mini-Player lesbar (F26)
      onMini(N.ui.mini && N.ui.mini.on); N.evt.on('mini:vis', onMini);
    };

    /* ---------- Daten ---------- */
    function track(t) { tasks.push(t); if (tasks.length > 10) tasks.shift(); return t; }
    function load() {
      gen++; var g = gen;
      track(get('/library/metadata/' + it0.rk, { excludeElements: 'Image,UltraBlurColors,Guid,Mood,Style' }, { timeout: 12000 }, function (err, d) {
        var m = !err && d && d.MediaContainer && d.MediaContainer.Metadata && d.MediaContainer.Metadata[0];
        if (g !== gen || dead) return;
        if (!m) { if (!tracks.length) onError(err); return; }
        meta = { sum: String(m.summary || ''), year: Number(m.year) || 0, artist: String(m.parentTitle || it0.artist || ''), artistRk: m.parentRatingKey ? String(m.parentRatingKey) : '',
          art: N.srv.tp(m.art || ''), thumb: N.srv.tp(m.thumb || '') || it0.thumb || '', title: String(m.title || it0.title || '') || N.t('mu.untitled'), lib: Number(m.librarySectionID) || it0.lib || 0,
          genres: [], vc: Number(m.viewCount) || 0 };
        for (var i = 0; m.Genre && i < m.Genre.length && i < 3; i++) meta.genres.push(N.fmt.genre(m.Genre[i].tag));
        if (meta.lib && s.rail !== railId(meta.lib)) { s.rail = railId(meta.lib); if (N.router.top() === s) N.ui.rail.attach(s.rail); }
        hero.loadBg(meta.art, meta.thumb);
        if (meta.thumb !== it0.thumb) hero.setPoster(meta.thumb, meta.title);
        paint();
      }));
      track(get('/library/metadata/' + it0.rk + '/children', { 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 500, excludeElements: 'Image,UltraBlurColors,Guid,Mood' }, { timeout: 12000 }, function (err, d) {
        if (g !== gen || dead) return;
        if (err) { onError(err); return; }
        tracks = MU.tracks(d, d && d.MediaContainer && N.srv.tp(d.MediaContainer.thumb) || it0.thumb);   // Cover des Albums statt Autorenbild (F30)
        if (book && tracks.length === 1 && tracks[0].chs) loadChapters(g); else build();
      }));
    }
    function loadChapters(g) {
      track(get('/library/metadata/' + tracks[0].rk, { includeChapters: 1, excludeElements: 'Image,UltraBlurColors,Guid' }, { timeout: 12000 }, function (err, d) {
        if (g !== gen || dead) return;
        var m = !err && d && d.MediaContainer && d.MediaContainer.Metadata && d.MediaContainer.Metadata[0];
        chs = m ? MU.chapters(m.Chapter) : [];
        build();
      }));
    }
    function build() {
      var bc = MU.bookChapters(tracks, chs);
      kind = book ? bc.kind : 'tracks';
      rows = kind === 'embedded' ? bc.list : tracks;
      res = book ? MU.resume(tracks) : null;
      U.setText(headT, N.t(book ? 'mu.row.chapters' : 'mu.row.tracks')); U.setText(cntT, String(rows.length));
      var f = list.f;
      if (zone !== 'list') f = book ? resIndex() : 0;
      list.setItems(rows, f);
      onTrack();
      paint();
      N.router.refreshHints();
    }
    /* Index der Fortsetzen-Stelle in der Liste */
    function resIndex() {
      if (!res) return 0;
      if (kind === 'embedded') { var k = N.osd.chapterAt(chs, res.off); return Math.max(0, k); }
      return res.i;
    }
    function onError(err) {
      var k = N.errs.kind(err, 'pms');
      if (k === 'auth' && !srv) { N.app.authLost(); return; }   // Kinderprofil-Pruefung wie Startseite (Pentest P6); weiterer Server: nie das eigene Profil
      var tx = srv ? N.srv.errText(srv, err) : k === 'server' ? { title: N.t('err.server.title'), text: N.t('lib.err.text', { server: N.session.state.server && N.session.state.server.name || '' }) } : N.errs.texts('generic', null, N.session.isKid());
      U.vis(pg, false); hero.vis(false);
      sb.show({ title: tx.title, text: tx.text, buttons: [{ id: 'retry', t: N.t('err.btn.retry') }, { id: 'back', t: N.t('err.btn.back') }],
        onSelect: function (id) { if (id === 'back') { N.router.back(); return; } sb.hide(); U.vis(pg, true); hero.vis(true); zone = 'btn'; load(); } });
      zone = 'state';
    }

    /* ---------- Darstellung ---------- */
    function metaLine() {
      var p = [], total = MU.totalDur(tracks);
      p.push(meta ? meta.artist : it0.artist || '');
      if (!book && (meta && meta.year || it0.year)) p.push(meta && meta.year || it0.year);
      if (rows.length) p.push(N.tn(book ? 'mu.chapters' : 'mu.tracks', rows.length));
      if (total) p.push(F.dur(total));
      if (book && res && res.state !== 'new' && res.state !== 'done') p.push(N.t('det.left', { time: F.dur(MU.progress(tracks, res).left) }));
      if (book && res && res.state === 'done') p.push(N.t('mu.heard'));
      return F.join(p);
    }
    function paint() {
      if (!hero.on) return;
      var de = meta ? meta.sum : '';
      if (!de && meta && meta.genres.length) de = meta.genres.join(', ');
      hero.paint(N.t(book ? 'mu.ov.book' : 'mu.ov.album'), meta ? meta.title : it0.title, metaLine(), de);
      buildButtons();
    }
    function resumeLabel() {
      if (!res || res.state === 'new' || res.state === 'done' || !tracks.length) return N.t('mu.btn.play');
      var k = resIndex(), name = kind === 'embedded' ? N.t('mu.chapterN', { n: k + 1 }) : tracks.length > 1 ? N.t('mu.chapterN', { n: res.i + 1 }) : '';
      var at = kind === 'embedded' ? res.off - (chs[k] ? chs[k].start : 0) : res.off;
      return name ? N.t('mu.btn.resumeAt', { ch: name, time: MU.clock(at) }) : N.t('mu.btn.resumeTime', { time: MU.clock(at) });
    }
    function buildButtons() {
      while (bar.firstChild) bar.removeChild(bar.firstChild);
      bdefs = [];
      if (book) {
        bdefs.push({ id: 'main', t: resumeLabel() });
        if (res && (res.state === 'resume' || res.state === 'next')) bdefs.push({ id: 'start', t: N.t('det.btn.startOver') });
      } else { bdefs.push({ id: 'main', t: N.t('mu.btn.play') }); bdefs.push({ id: 'shuffle', t: N.t('lib.shuffle') }); }
      bdefs.push({ id: 'more', t: '', icon: 'more' });
      btns = []; btnRects = null;
      for (var i = 0; i < bdefs.length; i++) {
        var b = U.el('div', bdefs[i].icon ? 'btn inl ib' : 'btn inl', bar);
        if (bdefs[i].icon) N.ui.icon(b, bdefs[i].icon); else b.appendChild(document.createTextNode(bdefs[i].t));
        btns.push(b);
      }
      bf = Math.min(bf, btns.length - 1);
      if (zone === 'btn' && !away) U.cls(btns[bf], 'is-focus', true);
      setTimeout(measure, 50);
    }
    function measure() {
      if (dead) return;
      btnRects = [];
      for (var i = 0; i < btns.length; i++) btnRects.push([352 + btns[i].offsetLeft, btns[i].offsetWidth]);
      paintLabel();
    }
    function paintLabel() {
      var on = zone === 'btn' && bdefs[bf] && bdefs[bf].icon && btnRects;
      U.show(blbl, !!on);
      if (on) { U.setText(blblT, N.t('det.btn.more')); blbl.style.left = (btnRects[bf][0] + 24 - 80) + 'px'; }
    }
    /* Zeile der Liste: {n, t, s, d, p, done} */
    function rowView(x, i) {
      if (!x) return { t: '' };
      if (kind === 'embedded') {
        var inCh = res && res.state === 'resume' && N.osd.chapterAt(chs, res.off) === i, done = res && res.off >= x.start + x.dur - 2000;
        return { n: i + 1, t: x.t, d: MU.clock(x.dur), p: inCh && x.dur ? (res.off - x.start) / x.dur : 0, done: done && !inCh, cur: false };
      }
      if (book) {
        var heard = x.vc > 0 && !x.off;
        return { n: i + 1, t: x.title, s: heard ? N.t('mu.heard') : x.off > 0 ? N.t('det.left', { time: F.dur(Math.max(0, x.dur - x.off)) }) : '', d: MU.clock(x.dur), p: MU.trackProgress(x), done: heard };
      }
      var art = meta ? meta.artist : it0.artist;
      return { n: x.idx || i + 1, t: x.title, s: x.artist && x.artist !== art ? x.artist : '', d: x.dur ? MU.clock(x.dur) : '' };
    }

    /* ---------- Zonen ---------- */
    function setOff(o) { if (o !== off) { off = o; N.fx.move(pg); U.tf(pg, 0, -o); } }
    function setBtn(i) { U.cls(btns[bf], 'is-focus', false); bf = i; U.cls(btns[bf], 'is-focus', true); N.fx.move(btns[bf]); paintLabel(); }
    function toBtn() {
      if (zone === 'list') list.setFocused(false);
      zone = 'btn'; setOff(0); hero.hero(true); U.vis(bar, true);
      U.cls(btns[bf], 'is-focus', true); paintLabel(); paint();
      N.router.refreshHints();
    }
    function toList() {
      if (!list.count()) return;
      if (zone === 'btn') { U.cls(btns[bf], 'is-focus', false); U.show(blbl, false); }
      zone = 'list'; setOff(ANCHOR_OFF); hero.hero(false); U.vis(bar, false);
      list.setFocused(true);
      N.router.refreshHints();
    }

    /* ---------- Aktionen ---------- */
    /* Warteschlange nur mit Titeln desselben Servers (der laufende Ton-Kern spricht mit genau einem Server) */
    function sameSrv() { var c = N.audio.core(); return !!c && ((c.item && c.item.srv) || '') === srv; }
    function ctx() { return { title: meta ? meta.title : it0.title, rk: it0.rk, lib: meta ? meta.lib : it0.lib, thumb: meta ? meta.thumb : it0.thumb }; }
    function playFrom(i, offMs, shuffle) {
      if (!tracks.length) return;
      if (kind === 'embedded') { N.audio.play(tracks, 0, { book: true, off: offMs || 0, ctx: ctx() }); }
      else N.audio.play(tracks, i, { book: book, off: offMs || 0, shuffle: shuffle, ctx: ctx() });
      N.router.push('nowplaying');
    }
    function playMain(fromStart) {
      if (!tracks.length) return;
      if (!book) { playFrom(0, 0, false); return; }
      if (fromStart || !res || res.state === 'done' || res.state === 'new') { playFrom(0, 0); return; }
      var t = tracks[res.i] || tracks[0];
      playFrom(res.i, MU.rewind(res.off, t.lv));
    }
    function playRow(i) {
      var x = rows[i];
      if (!x) return;
      if (kind === 'embedded') { playFrom(0, res && N.osd.chapterAt(chs, res.off) === i && res.state === 'resume' ? res.off : x.start); return; }
      playFrom(i, book ? N.audio.bookOff(x) : 0);
    }
    function btnAct(id) {
      if (id === 'main') playMain(false);
      else if (id === 'start') playMain(true);
      else if (id === 'shuffle') playFrom(Math.floor(Math.random() * tracks.length), 0, true);
      else if (id === 'more') menu();
    }
    /* Hoerbuch als gehoert/ungehoert (Gelb) – Scrobble des Albums, wie Serie (research 1.4) */
    function toggleHeard() {
      if (!book || !tracks.length) return;
      var all = res && res.state === 'done';
      N.plex.write('GET', all ? '/:/unscrobble' : '/:/scrobble', { identifier: 'com.plexapp.plugins.library', key: it0.rk }, function (err) {   // Weitere Server: who
        if (dead) return;
        if (err) { N.ui.toast.show(N.t('toast.actionFailed')); return; }
        for (var i = 0; i < tracks.length; i++) { tracks[i].vc = all ? 0 : Math.max(1, tracks[i].vc); tracks[i].off = 0; if (all) tracks[i].lv = 0; }
        N.ui.toast.show(N.t(all ? 'mu.toast.unheard' : 'mu.toast.heard'), { icon: 'confirm' });
        build();
      }, N.srv.who(srv) || undefined);
    }
    function menu() {
      var b = [], inList = zone === 'list' && rows[list.f];
      if (inList) b.push({ id: 'row', t: N.t('mu.menu.playFrom') });
      if (inList && kind !== 'embedded' && N.audio.active() && !book && sameSrv()) { b.push({ id: 'next', t: N.t('mu.menu.playNext') }); b.push({ id: 'end', t: N.t('mu.menu.addEnd') }); }
      if (book) b.push({ id: 'heard', t: N.t(res && res.state === 'done' ? 'mu.menu.unheard' : 'mu.menu.heard') });
      if (meta && meta.artistRk) b.push({ id: 'artist', t: N.t(book ? 'mu.menu.toAuthor' : 'mu.menu.toArtist') });
      b.push({ id: 'info', t: N.t('menu.info') });
      N.ui.dialog.open({ title: inList ? (rows[list.f].title || rows[list.f].t) : (meta ? meta.title : it0.title), buttons: b, vertical: true, focus: 0, top: 120,
        onSelect: function (id) {
          if (id === 'row') playRow(list.f);
          else if (id === 'next' || id === 'end') { var c = N.audio.core(); if (c && c.q) { c.q.insert([rows[list.f]], id === 'next'); c.pre = null; N.evt.emit('audio:queue', c.q); N.ui.toast.show(N.t('mu.toast.queued'), { icon: 'confirm' }); } }
          else if (id === 'heard') toggleHeard();
          else if (id === 'artist') N.router.push('artist', { it: { rk: meta.artistRk, type: 'artist', title: meta.artist, lib: meta.lib, srv: srv || undefined } });
          else showInfo();
        } });
    }
    function showInfo() { N.ui.panel.help(meta ? meta.title : it0.title, U.trim(F.join([meta ? meta.artist : '', meta && meta.year ? meta.year : '']) + '\n\n' + (meta ? meta.sum : ''), 600)); }
    function digit(k) {
      if (jump.t) clearTimeout(jump.t);
      if (jump.d.length >= 3) jump.d = '';
      jump.d += k;
      jump.t = setTimeout(function () { jump.t = 0; var nn = Number(jump.d); jump.d = ''; if (nn > 0 && zone === 'list') list.focusTo(nn - 1); }, 900);
    }

    /* ---------- Hinweise / Lebenszyklus ---------- */
    s.hints = function () {
      if (sb.on) return [{ k: 'ret', t: 'hint.back' }];
      var l = [];
      if (book) l.push({ k: 'yellow', t: res && res.state === 'done' ? 'mu.hint.unheard' : 'mu.hint.heard' });
      if (N.audio.active()) l.push({ k: 'green', t: 'mu.hint.nowPlaying' });
      l.push({ k: 'blue', t: 'hint.search' }); l.push({ k: 'INFO', t: 'hint.details' }); l.push({ k: 'TOOLS', t: 'hint.options' });
      return l;
    };
    s.enter = function () {
      away = false;
      if (!gen) { load(); return; }
      if (tracks.length) build();                       // Rueckkehr aus Jetzt-laeuft: Fortschritt aus den lokalen Tracks
      if (zone === 'btn') { U.cls(btns[bf], 'is-focus', true); paintLabel(); } else if (zone === 'list') list.setFocused(true);
      N.router.refreshHints();
    };
    s.leave = function () { away = true; return null; };
    s.destroy = function () {
      dead = true; gen++;
      for (var i = 0; i < tasks.length; i++) if (tasks[i]) tasks[i].abort();
      N.evt.off('audio:track', onTrack); N.evt.off('audio:state', onTrack); N.evt.off('mini:vis', onMini);
      if (jump.t) clearTimeout(jump.t);
      list.clear(); hero.destroy();
    };
    s.railBlur = function () { if (zone === 'btn') { U.cls(btns[bf], 'is-focus', false); U.show(blbl, false); } else if (zone === 'list') list.setFocused(false); };
    s.railFocus = function () { if (zone === 'btn') { U.cls(btns[bf], 'is-focus', true); paintLabel(); } else if (zone === 'list') list.setFocused(true); };
    s.onKey = function (k) {
      if (k === 'BLUE') { N.router.push('search'); return true; }
      if (zone === 'state') { if (sb.onKey(k)) return true; return k !== 'RETURN'; }
      if (k === 'RETURN') { if (zone === 'list') { toBtn(); return true; } N.router.back(); return true; }
      if (k === 'INFO') { showInfo(); return true; }
      if (k === 'TOOLS') { menu(); return true; }
      if (k === 'YELLOW') { toggleHeard(); return true; }
      if (zone === 'btn') {
        switch (k) {
          case 'LEFT': if (bf > 0) setBtn(bf - 1); else N.ui.rail.open(); return true;
          case 'RIGHT': if (bf < btns.length - 1) setBtn(bf + 1); return true;
          case 'DOWN': toList(); return true;
          case 'ENTER': btnAct(bdefs[bf].id); return true;
          case 'PLAY': playMain(false); return true;
          case 'RED': if (book) playMain(true); return true;
        }
        return true;
      }
      var f = list.f;
      if (N.keys.isDigit(k)) { digit(k); return true; }
      switch (k) {
        case 'UP': if (f > 0) list.focusTo(f - 1); else toBtn(); return true;
        case 'DOWN': list.focusTo(f + 1); return true;
        case 'FF': case 'CH_DOWN': list.focusTo(f + 5); return true;
        case 'RW': case 'CH_UP': list.focusTo(f - 5); return true;
        case 'LEFT': N.ui.rail.open(); return true;
        case 'ENTER': case 'PLAY': playRow(f); return true;
      }
      return true;
    };
    s.pointer = function (x, y, kind0) {
      if (sb.on) return sb.pointer(x, y, kind0);
      var py = y + off;
      if (py >= 448 && py < 496 && btnRects && zone !== 'list') {
        for (var i = 0; i < btnRects.length; i++) if (x >= btnRects[i][0] && x < btnRects[i][0] + btnRects[i][1]) {
          if (zone !== 'btn') toBtn();
          if (i !== bf) setBtn(i);
          if (kind0 === 'click') btnAct(bdefs[i].id);
          return true;
        }
        return false;
      }
      if (x >= 144 && x < 1136 && y < 656) {
        var ez = s.pointerEdge(x, y);
        if (ez) { if (kind0 === 'click') s.pointerScroll(ez.d); return true; }   // Randzone: rollt (Verweilen/Klick), fokussiert nicht
        var j = list.hit(py - LIST_Y);
        if (j < 0 || j - list.sc >= list.use()) return false;               // nur ganz sichtbare Zeilen
        if (zone !== 'list') toList();
        if (j !== list.f) { N.fx.step(true); list.focusTo(j, true); }   // still: Liste rollt nicht unter dem Punkt
        if (kind0 === 'click') playRow(j);
        return true;
      }
      return false;
    };
    s.pointerSig = function () { return off + ',' + list.sc; };   // Zeiger-Scroll-Sperre (N.pointer)
    /* Zeiger-Randzonen der Titelliste (N.ui.TrackList.edge): Streifen ueber der ersten Zeile, angeschnittene Zeile unten bis zur Hinweisleiste */
    s.pointerEdge = function (x, y) {
      if (sb.on || zone !== 'list' || x < 144 || x >= 1136) return null;
      return N.ui.TrackList.edge(list, LIST_Y - off, x, y);
    };
    s.pointerScroll = function (d) { list.scrollBy(d); };
    s.relabel = function () { paint(); list.refresh(); };
    return s;
  });

  /* ---------- Einstieg (Bibliothek, Startseite, Details-Hooks) ---------- */
  var offs = {}, busy = 0;
  /* sv: Weitere Server (N.srv) – Bibliotheken/Anfragen des fremden Servers */
  function libOf(id, sv) {
    var hc = N.session.homeCache(), l = sv ? N.srv.libs() : hc && (hc.alibs || hc.libs) || [];
    for (var i = 0; i < l.length; i++) if (l[i].id === Number(id) && (l[i].srv || '') === (sv || '')) return l[i];
    return null;
  }
  function okey(lib) { return N.srv.skey(lib.srv, lib.id); }
  function children(rk, cb, at, sv) {
    N.plex.get('/library/metadata/' + rk + '/children', { 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 500, excludeElements: 'Image,UltraBlurColors,Guid,Mood' }, N.srv.o(sv, { timeout: 12000 }), function (err, d) {
      cb(err ? [] : MU.tracks(d, d && d.MediaContainer && N.srv.tp(d.MediaContainer.thumb) || at), err);
    });
  }
  function failed() { N.ui.toast.show(N.t('toast.actionFailed')); }
  U.extend(MU, {
    /* Hoerbuch-Bibliothek? Name oder gemerktes "Store track progress" (probeLib) */
    bookLib: function (lib) { return !!lib && MU.isBookLib(lib, offs[okey(lib)]); },
    isBookItem: function (it) { var l = it && libOf(it.lib, it.srv); return l ? MU.bookLib(l) : !!(it && it.kind === 'audio'); },
    /* enableTrackOffsets einmal je Sitzung lesen (GET /library/sections/<id>/prefs) */
    probeLib: function (lib, cb) {
      if (!lib || offs[okey(lib)] !== undefined) { if (cb) cb(MU.bookLib(lib)); return; }
      N.plex.get('/library/sections/' + lib.id + '/prefs', null, N.srv.o(lib.srv), function (err, d) {
        if (!err) offs[okey(lib)] = MU.offsetsOn(d);
        if (cb) cb(MU.bookLib(lib));
      });
    },
    /* Karte oeffnen: Kuenstler/Album -> Detailseite, Track -> abspielen. false = kein Musik-Eintrag */
    open: function (it) {
      if (!MU.isAudio(it)) return false;
      if (it.type === 'artist') N.router.push('artist', { it: it });
      else if (it.type === 'album') N.router.push('album', { it: it });
      else MU.play(it);
      return true;
    },
    /* PLAY auf einer Karte: Album (Hoerbuch: fortsetzen), Kuenstler (alle Titel), Track (im Album ab diesem Titel) */
    play: function (it) {
      if (!MU.isAudio(it)) return false;
      if (U.now() - busy < 1500) return true;
      busy = U.now();
      var book = MU.isBookItem(it);
      if (it.type === 'artist') {
        N.plex.get('/library/metadata/' + it.rk + '/allLeaves', { 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 500, excludeElements: 'Image,UltraBlurColors,Guid,Mood' }, N.srv.o(it.srv, { timeout: 12000 }), function (err, d) {
          busy = 0;
          var tr = err ? [] : MU.tracks(d);
          if (!tr.length) { failed(); return; }
          N.audio.play(tr, 0, { book: book, ctx: { title: it.title, rk: it.rk, lib: it.lib } });
          N.router.push('nowplaying');
        });
        return true;
      }
      var albumRk = it.type === 'album' ? it.rk : it.albumRk;
      if (!albumRk) { busy = 0; N.audio.play([it], 0, { book: book, off: book ? it.off : 0 }); N.router.push('nowplaying'); return true; }
      children(albumRk, function (tr) {
        busy = 0;
        if (!tr.length) { failed(); return; }
        var i = 0, off = 0, k;
        if (it.type === 'track') { for (k = 0; k < tr.length; k++) if (tr[k].rk === it.rk) i = k; off = book ? MU.rewind(N.audio.bookOff(tr[i]), tr[i].lv) : 0; }   // Weiterhoeren: wie "Fortsetzen" (5 s zurueck nach > 1 h)
        else if (book) { var r = MU.resume(tr); if (r.state !== 'done') { i = r.i; off = MU.rewind(r.off, tr[i].lv); } }
        N.audio.play(tr, i, { book: book, off: off, ctx: { title: it.type === 'album' ? it.title : it.album || '', rk: albumRk, lib: it.lib, thumb: it.thumb } });
        N.router.push('nowplaying');
      }, it.thumb, it.srv);
      return true;
    },
    /* Bibliothek: Alle abspielen / Zufall (max. 200 Titel, Zufall vom Server gemischt; keine Play-Queue) */
    playLib: function (lib, shuffle) {
      var r = MU.libTracksQuery(lib.id, shuffle, 200);
      N.ui.toast.show(N.t('common.loading'));
      N.plex.get(r.path, r.q, N.srv.o(lib.srv, { timeout: 15000 }), function (err, d) {
        var tr = err ? [] : MU.tracks(d);
        if (!tr.length) { failed(); return; }
        N.ui.toast.hide();
        N.audio.play(tr, 0, { ctx: { title: lib.title, rk: '', lib: lib.id } });
        N.router.push('nowplaying');
      });
    }
  });
})(N);
