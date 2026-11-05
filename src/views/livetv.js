/* Ansicht 'livetv' – Bereich "Fernsehen" (SPEC A20, LIVE-1/2): Sender der eingeschalteten Regionen als Kacheln (Logo auf heller
 * Flaeche, Name + Laeuft gerade darunter), Ansichten Gross/Mittel/Klein/Liste wie die Mediathek (N.ui.Grid mit N.GridMath 'tv').
 * - Titel, Statuszeile ("12 Sender · Deutschland, Oesterreich"), Chip-Zeile y 120: Ansicht · Regionen · Sender der Startseite.
 * - OK/PLAY = Sender ansehen (views/liveplayer.js; CH▲/▼ blaettert dort in der Reihenfolge dieses Rasters). TOOLS = Optionen.
 * - Ansicht je Profil (settings.liveView), Regionen (settings.liveRegions) wirken sofort. Kinderprofile erreichen den Bereich nicht.
 * - Keine Anfrage beim Oeffnen ausser den Logos (Bildlader ueber den PMS); Programmdaten im Leerlauf (N.live.epgFetch). */
(function (N) {
  var U = N.util;
  N.router.define('livetv', function (params) {
    var A = N.screen.view();
    if (N.screen.flex && N.screen.cls.w !== 'R') A = { x: A.x, y: A.y, w: A.w, h: A.h, r: 24 };   // schmale Flaeche: Raster bis zum rechten Rand – ohne A–Z-Leiste nur der Rand wie links (iPhone hoch: 2 statt 1 Spalte Gross)
    var caps = N.platform.caps, FREE = caps.scroll === 'free', AHEAD = caps.images === 'fast' ? 3 : 0;
    var s = { rail: 'livetv', wheelKeys: ['UP', 'DOWN'], flex: true, news: 'top' };
    var root, titleT, statT, chipBar, chips = [], chipRects = null, grid, ring, sb, G, items = [], n = 0, zone = 'grid', cf = 0;
    var dead = false, railOpen = false, onEpg = null, onSet = null, onAvail = null, drv = null, pan = null, loose = false, eat = false;
    function cfg() { return N.session.settings || {}; }
    function view() { var v = cfg().liveView; return N.GridMath.VIEWS.indexOf(v) >= 0 ? v : 'L'; }
    function geom() { return N.GridMath.make(view(), 'tv', A.w === 1280 && A.h === 720 ? null : A, AHEAD); }

    s.create = function (el) {
      root = el;
      titleT = U.txt('div', 'a t-h1 ell', root, N.t('live.title'), 'left:144px;top:40px;width:' + Math.min(900, A.w - 168) + 'px');
      statT = U.txt('div', 'a t-small c2 ell', root, '', 'left:144px;top:84px;width:' + Math.min(1000, A.w - 168) + 'px');
      chipBar = U.el('div', 'lchips', root);
      grid = new N.ui.Grid(root);
      ring = new N.ui.Ring(root);
      ring.prep(['tv-l', 'tv-m', 'tv-s', 'list-tv']);
      sb = new N.ui.StateBlock(root);
      var fade = U.el('img', 'fade fade-frame', root); fade.src = N.assetBase + 'fade-frame.png';   // unteres Band wie in der Mediathek
      onEpg = function () { if (!dead) N.idle.add(relabel, 'live-epg'); };
      N.evt.on('live:epg', onEpg);
      onSet = function (e) { if (!dead && e && (e.key === 'liveRegions' || e.key === 'liveView')) N.idle.add(function () { if (!dead) load(true); }, 'live-load'); };
      N.evt.on('settings:changed', onSet);
      onAvail = function () { if (!dead) N.idle.add(function () { if (!dead) load(true); }, 'live-load'); };
      N.evt.on('live:avail', onAvail);                // Helfer erreichbar geworden bzw. weg (LIVE-10): Sender mit getrenntem Ton dazu/weg
      N.live.checkHelper();                            // Helfer eingetragen, aber noch nicht geprueft: jetzt (Ergebnis -> live:avail)
      buildChips();
      load(false);
    };
    s.enter = function (p, restore) {
      if (restore && restore.f >= 0 && n > 0) { grid.setModel(items, n, restore.f); if (zone === 'grid') { grid.setFocused(!railOpen); placeRing(grid.ringPos()); } }
      N.idle.add(epg, 'live-epg-get');
    };
    s.leave = function () { return { f: grid.f }; };
    s.destroy = function () {
      dead = true;
      N.evt.off('live:epg', onEpg); N.evt.off('settings:changed', onSet); N.evt.off('live:avail', onAvail);
      grid.clear();
    };

    /* ---------- Daten ---------- */
    function load(keep) {
      var f = keep ? grid.f : 0, chs = N.live.channels(), i;
      G = geom(); grid.setGeom(G);
      items = []; for (i = 0; i < chs.length; i++) items.push(N.live.item(chs[i]));
      n = items.length;
      paintStatus();
      if (!n) {
        grid.clear(); ring.hide(); zone = 'state';
        sb.show({ title: N.t('empty.live.title'), text: N.t(N.live.hidden() ? 'empty.live.helper' : 'empty.live.text'), buttons: [{ id: 'regions', t: N.t('live.chip.regions') }], onSelect: function () { regions(); } });
        N.router.refreshHints();
        return;
      }
      sb.hide();
      if (zone === 'state') zone = 'grid';
      grid.setModel(items, n, Math.min(f, n - 1));
      if (zone === 'grid') { grid.setFocused(!railOpen); placeRing(grid.ringPos()); }
      N.idle.add(epg, 'live-epg-get');
      N.router.refreshHints();
    }
    function epg() { if (!dead && n) N.live.epgFetch(ids()); }
    /* Laeuft gerade angekommen: Beschriftungen neu (nur Karten im Fenster, Fokus bleibt) */
    function relabel() {
      if (dead || !n) return;
      for (var i = 0; i < items.length; i++) { var ch = N.liveLogic.channel(items[i].live); if (ch) items[i] = N.live.item(ch); }
      grid.items = items; grid.refresh(0, n - 1);
    }
    function ids() { var o = []; for (var i = 0; i < items.length; i++) o.push(items[i].live); return o; }
    function regionNames() { var r = N.live.regions(), o = []; for (var i = 0; i < r.length; i++) o.push(N.live.regionName(r[i])); return o.join(', '); }
    /* "1 Sender · Deutschland · 27 weitere mit dem Helfer": am TV 2014 ohne Helfer fehlen die Sender mit getrenntem Ton (LIVE-10) */
    function paintStatus() {
      var hid = N.live.hidden();
      U.setText(statT, n ? N.tn('live.status', n, { regions: regionNames() }) + (hid ? ' · ' + N.tn('live.status.helper', hid) : '') : '');
    }

    /* ---------- Chips: Ansicht · Regionen · Sender der Startseite ---------- */
    function buildChips() {
      while (chipBar.firstChild) chipBar.removeChild(chipBar.firstChild);
      chips = [{ id: 'view', t: 'lib.chipView' }, { id: 'regions', t: 'live.chip.regions' }, { id: 'home', t: 'live.chip.home' }];
      for (var i = 0; i < chips.length; i++) { var c = U.el('span', 'chip', chipBar); c.appendChild(document.createTextNode(N.t(chips[i].t))); chips[i].el = c; }
      if (zone === 'chips') U.cls(chips[cf].el, 'is-focus', true);
      setTimeout(function () { if (dead) return; chipRects = []; for (var j = 0; j < chips.length; j++) chipRects.push([144 + chips[j].el.offsetLeft, chips[j].el.offsetWidth]); }, 50);
    }
    function chipAct(id) { if (id === 'view') views(); else if (id === 'regions') regions(); else N.router.push('livehome'); }
    function views() {
      var e = [];
      N.GridMath.VIEWS.forEach(function (v) { e.push({ id: v, t: N.t('lib.view.' + v) }); });
      N.ui.panel.select({ title: N.t('lib.chipView'), selected: view(), entries: e, onSelect: function (v) { if (v !== view()) N.session.setSetting('liveView', v); } });
    }
    /* Regionen: Mehrfachauswahl (mindestens eine bleibt an), nur die auf diesem Geraet spielbaren (N.live.regionEntries) */
    function regions() {
      var e = N.live.regionEntries();
      N.ui.panel.select({ title: N.t('live.chip.regions'), multi: true, entries: e, onDone: function (sel) {
        if (!sel.length) { N.ui.toast.show(N.t('toast.liveRegion')); return; }
        N.session.setSetting('liveRegions', sel);
      } });
    }

    /* ---------- Fokus ---------- */
    function placeRing(p) {
      if (!p || railOpen || sb.on) return;
      if (FREE && N.input.mode !== 'key' && p.y < 164) { ring.hide(); return; }
      ring.to(p.shape, p.x, p.y, p.noScale);
    }
    function afterMove() { N.idle.add(function () { N.router.refreshHints(); }, 'live-hints'); }
    function moveTo(i) { placeRing(grid.focusTo(i)); afterMove(); }
    function setChip(i) { if (chips[cf]) U.cls(chips[cf].el, 'is-focus', false); cf = U.clamp(i, 0, chips.length - 1); U.cls(chips[cf].el, 'is-focus', true); }
    function toChips() { zone = 'chips'; grid.setFocused(false); ring.hide(); cf = 0; setChip(0); N.router.refreshHints(); }
    function toGrid() { if (chips[cf]) U.cls(chips[cf].el, 'is-focus', false); zone = 'grid'; if (n > 0) { grid.setFocused(true); placeRing(grid.ringPos()); } N.router.refreshHints(); }
    function cur() { return n > 0 ? grid.item(grid.f) : null; }
    function watch(it) { if (it) N.live.play(it.live, ids()); }
    function menu() {
      var it = cur(), b = [];
      if (it && zone === 'grid') b.push({ id: 'play', t: N.t('menu.watch') });
      b.push({ id: 'view', t: N.t('lib.chipView') }, { id: 'regions', t: N.t('live.chip.regions') }, { id: 'home', t: N.t('live.chip.home') });
      N.ui.dialog.open({ title: it && zone === 'grid' ? it.title : N.t('live.title'), buttons: b, vertical: true, focus: 0, top: 120,
        onSelect: function (id) { if (id === 'play') watch(it); else chipAct(id); } });
    }
    function up() { if (params.sec) N.app.sectionBack(); else N.router.back(); }

    s.hints = function () {
      if (zone === 'state') return [{ k: 'ret', t: 'hint.back' }];
      if (zone === 'chips') return [{ k: 'OK', t: 'hint.open' }, { k: 'ret', t: 'hint.back' }];
      return [{ k: 'OK', t: 'hint.watch' }, { k: 'TOOLS', t: 'hint.options' }, { k: 'ret', t: 'hint.back' }];
    };
    s.railBlur = function () { railOpen = true; ring.hide(); grid.setFocused(false); if (zone === 'chips' && chips[cf]) U.cls(chips[cf].el, 'is-focus', false); };
    s.railFocus = function () {
      railOpen = false;
      if (zone === 'chips') { setChip(cf); return; }
      if (zone === 'grid' && n > 0) { grid.setFocused(true); placeRing(grid.ringPos()); }
    };
    s.onKey = function (k) {
      if (k === 'BLUE') { N.router.push(N.disc.blueView()); return true; }
      if (zone === 'state') {
        if (sb.onKey(k)) return true;
        if (k === 'UP') { toChips(); return true; }
        if (k === 'LEFT') { N.ui.rail.open(); return true; }
        if (k === 'RETURN') { up(); return true; }
        return true;
      }
      if (zone === 'chips') {
        switch (k) {
          case 'LEFT': if (cf > 0) setChip(cf - 1); else { U.cls(chips[cf].el, 'is-focus', false); N.ui.rail.open(); } return true;
          case 'RIGHT': if (cf < chips.length - 1) setChip(cf + 1); return true;
          case 'DOWN': if (n > 0) toGrid(); else if (sb.on) { U.cls(chips[cf].el, 'is-focus', false); zone = 'state'; } return true;
          case 'ENTER': chipAct(chips[cf].id); return true;
          case 'TOOLS': menu(); return true;
          case 'RETURN': if (n > 0) toGrid(); else up(); return true;
        }
        return true;
      }
      if (n <= 0) { if (k === 'LEFT') N.ui.rail.open(); else if (k === 'RETURN') up(); return true; }
      if (loose) { reanchor(); if (N.keys.isNav(k)) return true; }
      var f = grid.f, nx;
      switch (k) {
        case 'LEFT': if (G.col(f) > 0) moveTo(f - 1); else N.ui.rail.open(); return true;
        case 'RIGHT': nx = G.move(f, n, 'RIGHT'); if (nx >= 0) moveTo(nx); return true;
        case 'UP': nx = G.move(f, n, 'UP'); if (nx >= 0) moveTo(nx); else toChips(); return true;
        case 'DOWN': nx = G.move(f, n, 'DOWN'); if (nx >= 0) moveTo(nx); return true;
        case 'FF': case 'CH_DOWN': moveTo(G.jumpRows(f, n, 3)); return true;
        case 'RW': case 'CH_UP': moveTo(G.jumpRows(f, n, -3)); return true;
        case 'ENTER': case 'PLAY': watch(cur()); return true;
        case 'INFO': case 'TOOLS': menu(); return true;
        case 'RETURN': if (G.row(f) > 0) moveTo(G.col(f)); else up(); return true;
      }
      return true;
    };

    /* ---------- Zeiger / Finger (Index-Mathe, wie die Mediathek ohne A–Z) ---------- */
    s.pointer = function (x, y, kind) {
      if (eat) { if (kind === 'click') eat = false; return true; }
      if (sb.on && zone === 'state') return sb.pointer(x, y, kind);
      if (y >= 120 && y < 152 && chipRects) {
        for (var i = 0; i < chipRects.length; i++) if (x >= chipRects[i][0] && x < chipRects[i][0] + chipRects[i][1]) {
          if (zone !== 'chips') { zone = 'chips'; grid.setFocused(false); ring.hide(); }
          setChip(i); N.router.refreshHints();
          if (kind === 'click') chipAct(chips[i].id);
          return true;
        }
        return false;
      }
      if (n <= 0) return false;
      var j = FREE ? grid.hitAt(x, y) : G.hit(n, grid.r, x, y);
      if (j < 0) return false;
      if (zone !== 'grid') toGrid();
      if (j !== grid.f) { N.fx.step(true); placeRing(grid.focusTo(j, true)); afterMove(); }
      if (kind === 'click') watch(grid.item(j));
      return true;
    };
    /* freies Scrollen (caps.scroll 'free'): wie die Mediathek – Seite folgt dem Finger/Trackpad, erste Taste rastet ein */
    function drive() {
      if (!drv) drv = new N.kinetic.Drive({ dim: G.AH - G.Y0, get: function () { return grid.curPy(); }, max: function () { return grid.maxPy(); },
        set: function (p) { if (N.idle) N.idle.touch(); grid.setPy(p); if (N.input.mode === 'pointer' && zone === 'grid') { N.fx.step(true); placeRing(grid.ringPos()); if (N.pointer && N.pointer.follow) N.pointer.follow(); } } });
      return drv;
    }
    s.pan = function (e) {
      if (e.phase === 'start') {
        if (!FREE || !N.kinetic) return false;
        if (drv) drv.stop();
        eat = false; pan = null;
        if (e.axis !== 'y' || n <= 0 || e.y < 152) return true;
        loose = true; pan = { last: 0 }; drive().grab(e.t);
        return true;
      }
      if (!pan) return true;
      var d = -(e.dy - pan.last);
      pan.last = e.dy;
      if (e.phase === 'move') { drv.move(d, e.t); return true; }
      pan = null; drv.up(e.t, e.cancel);
      return true;
    };
    s.pointerDown = function () { if (FREE && drv && drv.stop()) eat = true; };
    s.wheel = function (x, y, dx, dy) {
      if (!FREE || !N.kinetic || n <= 0 || Math.abs(dy) < Math.abs(dx)) return false;
      eat = false; loose = true; drive().nudge(dy);
      return true;
    };
    s.scrollTop = function () { if (!FREE || !N.kinetic || n <= 0) return false; pan = null; loose = true; return drive().to(0); };
    function reanchor() {
      if (drv) drv.stop();
      loose = false; pan = null;
      if (!grid.free) return;
      if (zone !== 'grid') toGrid();
      placeRing(grid.fix(grid.anchorIdx()));
      afterMove();
    }
    s.relabel = function () { U.setText(titleT, N.t('live.title')); buildChips(); paintStatus(); };
    return s;
  });
})(N);
