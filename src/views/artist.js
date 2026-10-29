/* Ansicht 'artist' – Kuenstler bzw. Autor (M4; Feedback-Regel 3; research 3.1).
 * Erster Bildschirm (N.ui.DetHero): Hintergrund (Art), Bild quadratisch, Name, "12 Alben", Biografie, Knoepfe Abspielen · Zufall · "⋯".
 * Darunter angeschnitten (y 580) die Reihen Alben · Singles & EPs · Live-Alben · Soundtracks · Kompilationen · Demos · Remixe
 * (quadratische Karten, N.ui.Row 'sq'; nur nicht-leere, wie die offiziellen Apps: /children + /related, N.music.albumGroups),
 * Hoerbuecher in EINER Reihe; dann "Beliebte Titel" (PopularLeaves).
 * params: {it: {rk, type:'artist', title, thumb, lib}} */
(function (N) {
  var U = N.util, M = N.model, MU = N.music, F = N.fmt, MINI_ROOM = 2, PEEK = 580, ROW_H = 316;

  N.router.define('artist', function (params) {
    var it0 = params.it || {}, book = MU.isBookItem(it0);
    // Weitere Server (N.srv): Kuenstler eines fremden Servers -> alle Anfragen dorthin
    var srv = it0.srv || '';
    function get(path, q, o, cb) { return N.plex.get(path, q, N.srv.o(srv, o), cb); }
    function railId(lib) { return N.railRows.libId({ id: lib, srv: srv }); }
    var s = { rail: it0.lib ? railId(it0.lib) : N.ui.rail && N.ui.rail.cur || 'home', wheelKeys: ['LEFT', 'RIGHT'] };
    var root, hero, pg, bar, btns = [], bdefs = [], btnRects = null, rows = [], ri = 0, groups = [], popY = PEEK + ROW_H, popHead, pop, ring, sb;
    var meta = null, popular = [], zone = 'btn', bf = 0, off = 0, gen = 0, tasks = [], dead = false, away = false, onTrack = null, onMini = null;

    s.create = function (el) {
      root = el;
      hero = new N.ui.DetHero(root, { square: true, scrim: 'scrim-np.png' });   // Kuenstlerfotos oft hell (F24)
      pg = U.el('div', 'pg', root);
      bar = U.el('div', 'd-btns', pg);
      rowAt(0);
      popHead = U.el('div', 'tl-head t-h2 ell', pg, 'top:' + popY + 'px;display:none'); popHead.appendChild(document.createTextNode(''));
      pop = new N.ui.TrackList(pg, { x: 144, y: popY + 44, w: 992, vis: 7, full: 6, row: popRow });   // 7. Zeile nur angeschnitten
      hero.makeInfo(root);
      var fade = U.el('img', 'fade', root); fade.src = N.assetBase + 'fade-bottom.png';
      ring = new N.ui.Ring(root);
      sb = new N.ui.StateBlock(root);
      hero.paint(N.t(book ? 'mu.ov.author' : 'mu.ov.artist'), it0.title, '', '');
      hero.setPoster(it0.thumb, it0.title);
      buildButtons();
      onTrack = function () { if (!dead) { var c = N.audio.core(); pop.setCurrent(c && c.item ? c.item.rk : ''); } };
      N.evt.on('audio:track', onTrack);
      onMini = function (on) { pop.setRoom(on ? MINI_ROOM : 0); };   // letzte Titel ueber dem Mini-Player lesbar (F26)
      onMini(N.ui.mini && N.ui.mini.on); N.evt.on('mini:vis', onMini);
    };
    function track(t) { tasks.push(t); return t; }
    function rowAt(k) {
      while (rows.length <= k) { var r = new N.ui.Row(pg, { captions: function () { return true; } }); r.setTop(PEEK + rows.length * ROW_H); rows.push(r); }
      return rows[k];
    }
    function rowsN() { return Math.max(1, groups.length); }
    /* Reihen oberhalb von 'from' ausblenden: sie laegen sonst unter der festen Kopfzeile (Name, Biografie) */
    function showRows(from) { for (var k = 0; k < rows.length; k++) rows[k].setVisible(k >= from && k < rowsN()); }
    /* Reihen neu belegen (Alben zuerst aus /children, dann ergaenzt um /related); Fokus bleibt auf derselben Gruppe */
    function setGroups(gs) {
      var curId = zone === 'row' && groups[ri] ? groups[ri].id : '', k;
      if (zone === 'row') { rows[ri].setFocused(false); ring.hide(); }
      groups = gs;
      for (k = 0; k < rowsN(); k++) {
        var gr = groups[k] || { id: 'albums', tk: book ? 'mu.row.books' : 'mu.row.albums', items: [] }, r = rowAt(k);
        r.setModel({ id: gr.id, kind: 'sq', tk: gr.tk, items: gr.items }, r.model && r.model.id === gr.id ? r.f : 0);
      }
      for (; k < rows.length; k++) rows[k].clear();
      showRows(zone === 'row' ? ri : zone === 'pop' ? rowsN() - 1 : 0);
      popY = PEEK + rowsN() * ROW_H;
      popHead.style.top = popY + 'px'; pop.clip.style.top = (popY + 44) + 'px';
      if (zone === 'row') {
        var ni = 0;
        for (k = 0; k < groups.length; k++) if (groups[k].id === curId) ni = k;
        zone = ''; to('row', ni);
      } else if (zone === 'pop') setOff(popY - 236);
      paint();
    }
    function kinds() { var hc = N.session.homeCache(); return N.hubs.libKinds(srv ? N.srv.libs() : hc && (hc.alibs || hc.libs) || []); }
    function load() {
      gen++; var g = gen;
      track(get('/library/metadata/' + it0.rk, { includePopularLeaves: 1, excludeElements: 'Image,UltraBlurColors,Guid,Similar,Location' }, { timeout: 12000 }, function (err, d) {
        var m = !err && d && d.MediaContainer && d.MediaContainer.Metadata && d.MediaContainer.Metadata[0];
        if (g !== gen || dead) return;
        if (!m) { onError(err); return; }
        meta = { title: String(m.title || it0.title || ''), sum: String(m.summary || ''), art: N.srv.tp(m.art || ''), thumb: N.srv.tp(m.thumb || '') || it0.thumb || '', lib: Number(m.librarySectionID) || it0.lib || 0 };
        popular = MU.tracks({ MediaContainer: m.PopularLeaves || {} }).slice(0, 10);
        if (meta.lib && s.rail !== railId(meta.lib)) { s.rail = railId(meta.lib); if (N.router.top() === s) N.ui.rail.attach(s.rail); }
        hero.loadBg(meta.art, meta.thumb);
        if (meta.thumb !== it0.thumb) hero.setPoster(meta.thumb, meta.title);
        U.setText(popHead.firstChild, N.t('mu.row.popular'));
        U.show(popHead, popular.length > 0);
        pop.setItems(popular, 0); onTrack();
        paint();
      }));
      // Alben: /children liefert nur "normale" Alben (ohne Singles/EPs, Live, Soundtracks, Kompilationen …, Live-Befund 27.10.),
      // die uebrigen Gruppen kommen aus /related (Hubs artist.albums.*); ohne diese Hubs (aeltere PMS, Fehler) Rueckfall auf die
      // Abschnitts-Abfrage type=9&artist.id – was /children fehlt, steht dann unter "Weitere Alben"
      var main = [], hubs = null, rest = null, lib = it0.lib || 0;
      function norm(list) {
        var a = M.normList(list || [], kinds(), lib);
        for (var i = 0; i < a.length; i++) if (!a[i].artist) a[i].artist = a[i].year ? String(a[i].year) : '';
        return a;
      }
      function regroup() { setGroups(MU.albumGroups(main, hubs, rest, book)); }
      track(get('/library/metadata/' + it0.rk + '/children', { excludeElements: N.hubs.EXCL }, { timeout: 12000 }, function (err, d) {
        if (g !== gen || dead || err) return;
        var mc = d && d.MediaContainer;
        lib = mc && mc.librarySectionID || lib;
        main = norm(mc && mc.Metadata);
        regroup();
      }));
      track(get('/library/metadata/' + it0.rk + '/related', { count: 100, excludeElements: N.hubs.EXCL }, { timeout: 12000 }, function (err, d) {
        if (g !== gen || dead) return;
        var h = err ? null : MU.albumHubs(d), k;
        if (h) { hubs = {}; for (k in h) hubs[k] = norm(h[k]); regroup(); return; }
        var sec = lib || meta && meta.lib;
        if (!sec) return;
        track(get('/library/sections/' + sec + '/all', { type: 9, 'artist.id': it0.rk, sort: 'year:desc', excludeElements: N.hubs.EXCL }, { timeout: 12000 }, function (e2, d2) {
          if (g !== gen || dead || e2) return;
          rest = norm(d2 && d2.MediaContainer && d2.MediaContainer.Metadata);
          regroup();
        }));
      }));
    }
    function onError(err) {
      var k = N.errs.kind(err, 'pms');
      if (k === 'auth' && !srv) { N.app.authLost(); return; }   // Kinderprofil-Pruefung wie Startseite (Pentest P6); weiterer Server: nie das eigene Profil
      var tx = srv ? N.srv.errText(srv, err) : k === 'server' ? { title: N.t('err.server.title'), text: N.t('lib.err.text', { server: N.session.state.server && N.session.state.server.name || '' }) } : N.errs.texts('generic', null, N.session.isKid());
      U.vis(pg, false); hero.vis(false);
      sb.show({ title: tx.title, text: tx.text, buttons: [{ id: 'retry', t: N.t('err.btn.retry') }, { id: 'back', t: N.t('err.btn.back') }],
        onSelect: function (id) { if (id === 'back') { N.router.back(); return; } sb.hide(); U.vis(pg, true); hero.vis(true); to('btn'); load(); } });   // to: Kopf/Knoepfe wieder sichtbar (Review 1.0.5)
      zone = 'state';
    }
    function paint() {
      if (!hero.on) return;
      var p = [];
      var n = MU.groupCount(groups);
      if (n) p.push(N.tn(book ? 'mu.books' : 'mu.albums', n));
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
      else if (zone === 'row') { rows[ri].setFocused(false); ring.hide(); }
      else if (zone === 'pop') pop.setFocused(false);
    }
    /* k = Reihe (Zone 'row'; ohne k die zuletzt fokussierte) */
    function to(z, k) {
      var nr = k === undefined ? ri : k;
      if (z === 'row' && !(rows[nr] && rows[nr].count())) z = popular.length ? 'pop' : 'btn';
      if (z === 'pop' && !popular.length) return;
      leave(); zone = z;
      showRows(z === 'row' ? nr : z === 'pop' ? rowsN() - 1 : 0);
      if (z === 'btn') { setOff(0); hero.hero(true); U.vis(bar, true); U.cls(btns[bf], 'is-focus', true); paint(); }
      else if (z === 'row') { ri = nr; var r = rows[ri]; setOff(r.top - 236); hero.hero(false); U.vis(bar, false); r.setFocused(true); r.boost(); placeRing(r.ringPos()); }
      else { setOff(popY - 236); hero.hero(false); U.vis(bar, false); pop.setFocused(true); }
      N.router.refreshHints();
    }
    function setBtn(i) { U.cls(btns[bf], 'is-focus', false); bf = i; U.cls(btns[bf], 'is-focus', true); N.fx.move(btns[bf]); }
    function playAll() { MU.play({ rk: it0.rk, type: 'artist', title: meta ? meta.title : it0.title, lib: meta ? meta.lib : it0.lib, srv: srv || undefined }); }
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
      get('/library/metadata/' + it0.rk + '/allLeaves', { 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 500, excludeElements: 'Image,UltraBlurColors,Guid,Mood' }, { timeout: 12000 }, function (err, d) {
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
      if (zone === 'btn') U.cls(btns[bf], 'is-focus', true); else if (zone === 'row') { rows[ri].setFocused(true); placeRing(rows[ri].ringPos()); } else if (zone === 'pop') pop.setFocused(true);
      N.router.refreshHints();
    };
    s.leave = function () { away = true; return null; };
    s.destroy = function () {
      dead = true; gen++;
      for (var i = 0; i < tasks.length; i++) if (tasks[i]) tasks[i].abort();
      N.evt.off('audio:track', onTrack); N.evt.off('mini:vis', onMini);
      for (i = 0; i < rows.length; i++) rows[i].clear();
      pop.clear(); hero.destroy();
    };
    s.railBlur = function () { leave(); };
    s.railFocus = function () { var z = zone; if (z === 'state') return; zone = '';   // Fehlermeldung bleibt fokussiert (Review 1.0.5)
      if (z === 'btn') { zone = 'btn'; U.cls(btns[bf], 'is-focus', true); } else to(z); };
    s.onKey = function (k) {
      if (k === 'BLUE') { N.router.push('search'); return true; }
      if (zone === 'state') { if (sb.onKey(k)) return true; return k !== 'RETURN'; }
      if (k === 'RETURN') { if (zone !== 'btn') { to('btn'); return true; } N.router.back(); return true; }
      if (k === 'INFO') { if (zone === 'row') { var a = rows[ri].item(rows[ri].f); if (a) MU.open(a); } else btnAct('more'); return true; }
      if (zone === 'btn') {
        switch (k) {
          case 'LEFT': if (bf > 0) setBtn(bf - 1); else N.ui.rail.open(); return true;
          case 'RIGHT': if (bf < btns.length - 1) setBtn(bf + 1); return true;
          case 'DOWN': to('row', 0); return true;
          case 'ENTER': btnAct(bdefs[bf].id); return true;
          case 'PLAY': playAll(false); return true;
        }
        return true;
      }
      if (zone === 'row') {
        var row = rows[ri];
        switch (k) {
          case 'LEFT': if (row.f > 0) placeRing(row.focusCol(row.f - 1)); else N.ui.rail.open(); return true;
          case 'RIGHT': if (row.f < row.count() - 1) placeRing(row.focusCol(row.f + 1)); return true;
          case 'UP': if (ri > 0) to('row', ri - 1); else to('btn'); return true;
          case 'DOWN': if (ri < rowsN() - 1) to('row', ri + 1); else to('pop'); return true;
          case 'ENTER': MU.open(row.item(row.f)); return true;
          case 'PLAY': MU.play(row.item(row.f)); return true;
        }
        return true;
      }
      var f = pop.f;
      switch (k) {
        case 'UP': if (f > 0) pop.focusTo(f - 1); else to('row', rowsN() - 1); return true;
        case 'DOWN': pop.focusTo(f + 1); return true;
        case 'LEFT': N.ui.rail.open(); return true;
        case 'ENTER': case 'PLAY': playPop(f); return true;
      }
      return true;
    };
    /* Zeiger wie auf den Film-/Seriendetails (NAV-2, DET-9): Fokus ohne Rollen nur im eingerasteten Abschnitt (Reihe bzw. Beliebte
     * Titel); ein anderer, zu >= 40 % sichtbarer (erste Zeile von "Beliebte Titel" unter der letzten Reihe) kommt nach 250 ms
     * Verweilen bzw. per Klick herein, danach Zeiger-Sperre; sonst Randzonen. Frueher rollte schon das Zeigen auf eine andere
     * Reihe die Seite, und ausgeblendete Reihen ueber dem Kopf (showRows) blieben Trefferflaechen -> Rueckkopplung. */
    var RM = N.RowMath, SEC_TOP = 236;
    function clipTop() { return off ? SEC_TOP : 0; }
    /* Stopps der Seite (aufsteigend): Knoepfe, je Reihe mit Inhalt, Beliebte Titel */
    function stops() {
      var a = [{ o: 0, z: 'btn' }];
      for (var i = 0; i < rowsN(); i++) if (rows[i].count()) a.push({ o: rows[i].top - SEC_TOP, z: 'row', i: i });
      if (popular.length) a.push({ o: popY - SEC_TOP, z: 'pop' });
      return a;
    }
    /* Ziel unter dem Punkt: {z: 'row', i | z: 'pop', j, v: RowMath.secVis} */
    function ptrAt(x, y) {
      if (y >= RM.VIS) return null;
      var py = y + off, i, v;
      for (i = 0; i < rowsN(); i++) {
        var r = rows[i], cy = r.top + 52 - off;
        if (!r.count() || y < cy || y >= cy + 176) continue;
        v = RM.secVis(cy, 176, r.top - SEC_TOP === off, clipTop());
        return v && r.hit(x) >= 0 ? { z: 'row', i: i, v: v } : null;
      }
      if (!popular.length || x < 144 || x >= 1136) return null;
      var anch = popY - SEC_TOP === off, j = pop.hit(py - popY - 44);
      if (j < 0 || (anch && j - pop.sc >= pop.use())) return null;          // eingerastet: nur ganz sichtbare Zeilen
      v = RM.secVis(popY + 44 + (j - pop.sc) * 56 - off, 56, anch, clipTop());
      return v ? { z: 'pop', j: j, v: v } : null;
    }
    function ptrAct(t, x, kind) {
      if (t.z === 'pop') {
        if (zone !== 'pop') to('pop');
        if (t.j !== pop.f) pop.focusTo(t.j, true);            // still: Liste rollt nicht unter dem Punkt
        if (kind === 'click') playPop(t.j);
        return true;
      }
      var r = rows[t.i], h = r.hit(x);
      if (h < 0) return false;
      if (zone !== 'row' || ri !== t.i) to('row', t.i);
      if (h !== r.f) placeRing(r.hoverCol(h));
      if (kind === 'click') MU.open(r.item(h));
      return true;
    }
    function reveal(t, x, kind) {
      N.fx.step(true);
      ptrAct(t, x, kind === 'click' ? 'click' : 'move');
      N.pointer.scrolled();                                 // Inhalt ist unter dem Punkt gewandert -> Sperre bis zur naechsten Bewegung
    }
    s.pointer = function (x, y, kind) {
      if (sb.on) return sb.pointer(x, y, kind);
      var py = y + off, i, t;
      if (zone === 'btn' && py >= 448 && py < 496 && btnRects) {
        N.pointer.holdCancel();
        for (i = 0; i < btnRects.length; i++) if (x >= btnRects[i][0] && x < btnRects[i][0] + btnRects[i][1]) { if (i !== bf) setBtn(i); if (kind === 'click') btnAct(bdefs[i].id); return true; }
        return false;
      }
      var ez = s.pointerEdge(x, y);
      if (ez) { N.pointer.holdCancel(); if (kind === 'click') s.pointerScroll(ez.d); return true; }   // Randzone: rollt, fokussiert nicht
      t = ptrAt(x, y);
      if (!t) { N.pointer.holdCancel(); return false; }
      if (t.v === 'part') {                                 // anderer Abschnitt: Vorbeiziehen loest nichts aus
        if (kind === 'click') { N.pointer.holdCancel(); reveal(t, x, kind); return true; }
        N.pointer.hold(function () { var c = ptrAt(N.pointer.x, N.pointer.y); if (!dead && !away && !sb.on && c && c.v === 'part' && c.z === t.z && c.i === t.i) reveal(c, N.pointer.x); });
        return true;
      }
      N.pointer.holdCancel();
      return ptrAct(t, x, kind);
    };
    s.pointerSig = function () { return off + ',' + pop.sc; };   // Zeiger-Scroll-Sperre (N.pointer)
    /* Randzonen: in "Beliebte Titel" die der Liste (N.ui.TrackList.edge, wie auf der Albumseite), ganz oben zurueck zur letzten
     * Reihe; sonst oben y 248–280 (ueber dem Abschnitt, solange gerollt) und unten ab RowMath.secEdgeB bis 656 je ein Abschnitt */
    s.pointerEdge = function (x, y) {
      if (sb.on || x < 144 || x >= 1136) return null;
      if (zone === 'pop') {
        var top = popY + 44 - off, e = N.ui.TrackList.edge(pop, top, x, y);
        return e || (y >= top - 32 && y < top ? { d: -1, x: 640, y: top - 16 } : null);
      }
      var st = stops(), o = [], b = [], i;
      for (i = 0; i < st.length; i++) o.push(st[i].o);
      if (off > 0 && y >= SEC_TOP + 12 && y < SEC_TOP + 44) return { d: -1, x: 640, y: SEC_TOP + 28 };
      for (i = 0; i < rowsN(); i++) if (rows[i].count()) b.push({ cy: rows[i].top + 52 - off, h: 176 });
      if (popular.length) b.push({ cy: popY + 44 - off, h: 56 });
      if (RM.secNext(o, off, 1) >= 0 && y >= RM.secEdgeB(b, clipTop()) && y < 656) return { d: 1, x: 640, y: 628 };
      return null;
    };
    /* ein Schritt: in "Beliebte Titel" die Liste, sonst ein Abschnitt (wie ▼/▲) */
    s.pointerScroll = function (d) {
      if (zone === 'pop' && pop.canScroll(d)) { pop.scrollBy(d); return; }
      var st = stops(), o = [], k, i;
      for (i = 0; i < st.length; i++) o.push(st[i].o);
      k = RM.secNext(o, off, d);
      if (k >= 0) to(st[k].z, st[k].i);
    };
    s.relabel = function () { paint(); buildButtons(); for (var i = 0; i < rows.length; i++) rows[i].relabel(); };
    return s;
  });
})(N);
