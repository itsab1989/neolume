/* Ansicht 'homerows' – "Startseite anpassen" (SPEC 7.3.1, 7.13): Liste aller Reihen der Startseite, je Profil gespeichert.
 * ▲▼ waehlen · OK = Reihe ein/aus · Gelb = Verschieben (dann ▲▼, OK/Gelb/RETURN = ablegen) · letzte Zeile "Standard
 * wiederherstellen". Zeilen wie 5.18 (64 hoch, Fokus = Amber-Rahmen), feste Beschreibungsflaeche, ein Listen-Container per
 * translate3d (Fokus-Anker = 3. Zeile). Weitere Reihen (Server-Hubs, Playlists) kommen aus dem Hub-Katalog: sofort aus dem
 * Speicher, im Hintergrund frisch vom Server (Titel in der App-Sprache). Speichern sofort im Speicher, Datei entprellt.
 * N.rowsEditor(C) ist die gemeinsame Fabrik: "Inspiration anpassen" (views/insprows.js) nutzt dieselbe Liste mit eigener
 * Einstellung (C.setting), eigenen Reihen (C.avail) und Texten (C.label/val/desc, C.keys).
 * Optionale Erweiterungen (nur "Startseite anpassen", C.ext): zusaetzliche Eintraege unten ("Reihe hinzufuegen …", N.ext
 * 'home:adders' / 'home:add') und entfernbare Reihen (Rot, N.ext 'home:removable', mit Rueckfrage).
 * Finger/Maus (caps.scroll 'free'): die Liste scrollt frei unter dem Finger (N.ui.freeList: Schwung, Gummiband, kein Einrasten),
 * Wischen aendert den Fokus nicht, Tipp schaltet; beim Verschieben bleibt Wischen hoch/runter = ein Platz je Schritt (Nr. 26).
 * Griff (NAV-27, nur Finger/Maus: N.screen.flex mit caps.touch bzw. caps.pointer 'mouse'; am TV gibt es ihn nicht): jede verschieb-
 * bare Zeile hat rechts einen Griff; ihn ziehen (Finger ueber App.grab/App.drag, Maus mit gedrueckter Taste) hebt die Zeile an, sie
 * folgt dem Finger, die anderen ruecken weich nach (nur transform), am Listenrand rollt die Liste selbst, Loslassen legt ab (Tick je
 * Platzwechsel mit caps.haptic). Weit seitlich daneben = Abbruch. Tipp auf den Griff, langes Druecken bzw. Rechtsklick: Menue "Nach
 * oben / Nach unten / Ganz nach oben / Ganz nach unten". Tastatur: Cmd+Pfeil hoch/runter, mit Umschalt ganz nach oben/unten. */
(function (N) {
  var U = N.util, HR = N.homeRows, TOP = 112, STEP = 64, ANCHOR = 2, STALE = 600000;
  function editor(C) { return function () {
    var s = { rail: null, wheelKeys: ['UP', 'DOWN'], toastLow: true, backBtn: true }, K = C.keys;   // backBtn: Finger/Maus ohne Hinweisleiste (Nr. 26)   // Toast unter der Beschreibung (.hr-desc bis y 608, NAV-10)
    var S = N.session, root, clip, list, desc, stat, els = [], items = [], f = 0, sc = 0, moving = false, cat = null, busy = null, dead = false, more = null, fl = null;
    var MOD = C.model || HR;
    /* Lage (TV: Liste x 144 … 880, 6 Zeilen, "So geht's" rechts bei x 912). Flexible Flaeche schmal oder flach (Nachbefund G 03.11.:
     * im verkleinerten Kasten war die Schrift am iPhone winzig): Ansicht 1:1 in der Flaeche (scr.flex), Liste ueber die Breite bis 24
     * vor den Rand, so viele Zeilen wie in die Hoehe passen (Zeile 64 = 44 pt am iPhone), "So geht's" rechts daneben ab 960 Breite,
     * sonst unter der Liste; Ueberschrift rechts neben dem Zurueck-Knopf. Breit und hoch (R·N) wie am TV im Kasten. */
    var VA = N.screen.view(), FX = N.screen.flex && (VA.w < 1264 || VA.h < 720), X = 144, W = 736, VIS = 6, TX = 144, HOW = null;
    if (N.screen.flex) s.reflow = true;                 // ob flexibel, haengt von der Flaeche ab (N.router.relayout)
    if (FX) {
      var side = VA.w >= 960, sf = N.screen.safe, sb = N.screen.nav() !== 'tabs' ? sf.b : 0, HH = side ? 0 : 192;
      s.flex = true;
      TX = Math.max(144, Math.max(64, sf.l + 16) + 48 + 16 - VA.x);   // Zurueck-Knopf (N.ui.hints.BACK) in Flaechen-px bei 64/40
      W = side ? VA.w - 168 - 320 : VA.w - 168;
      VIS = Math.max(3, Math.floor((VA.h - TOP - 24 - sb - HH) / STEP));
      HOW = side ? { x: X + W + 32, y: TOP, w: 288 } : { x: X + 24, y: TOP + VIS * STEP + 24, w: W - 48, below: true };   // unten: buendig mit den Zeilentexten
    }
    var caps = N.platform.caps, GRIP = N.screen.flex && (!!caps.touch || caps.pointer === 'mouse'), dg = null, hap = null, GZ = 64;   // Griff-Zone rechts in der Zeile                            // Listen-Logik (view/store/move): Startseite/Inspiration N.homeRows, Seitenleiste N.railRows
    function locked(it) { return !it.reset && !!(C.locked && C.locked(it)); }   // immer an (z. B. Start in der Seitenleiste)

    function saved() { return S.settings && S.settings[C.setting] || null; }
    function vlibs() {
      var a = cat && cat.alibs, out = [], i;
      if (!a) { var hc = S.homeCache(); return hc && hc.libs || []; }
      for (i = 0; i < a.length; i++) if (a[i].type === 'movie' || a[i].type === 'show') out.push(a[i]);
      return out;
    }
    function allLibs() { return cat && cat.alibs || vlibs(); }
    function ctx() { return { cat: cat, libs: vlibs(), alibs: allLibs(), libOf: libOf, hubOf: hubOf }; }
    function avail() { return C.avail(ctx()); }
    function libOf(id) { var a = allLibs(); for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i]; return null; }
    function hubOf(id) { var h = cat && cat.hubs || []; for (var i = 0; i < h.length; i++) if (h[i].id === id) return h[i]; return null; }

    /* ---------- Texte je Reihe ---------- */
    function label(it) { return it.reset ? N.t('set.hr.reset') : it.add ? it.add.t : C.label(it, ctx()); }
    function libName(it) { return it.reset || it.add ? '' : C.val(it, ctx()); }
    function special(it) { return !!(it && (it.reset || it.add)); }
    function removable(it) { return !!(C.ext && it && !special(it) && N.ext.has('home:removable') && N.ext.call('home:removable', it.id)); }
    function descText(it) {
      if (moving) return N.t(N.input.direct() ? 'set.hr.movingTouch' : 'set.hr.moving');
      if (it.reset) return N.t(K.resetDesc);
      if (it.add) return it.add.d;
      return C.desc(it, ctx());
    }

    /* ---------- Aufbau ---------- */
    s.create = function (el) {
      root = el;
      U.txt('div', 'a t-h1' + (FX ? ' ell' : ''), root, N.t(K.title), FX ? 'left:' + TX + 'px;top:40px;width:' + (X + W - TX) + 'px' : 'left:144px;top:40px;width:720px');
      clip = U.el('div', 'hr-clip', root, FX ? 'left:' + X + 'px;width:' + W + 'px;height:' + (VIS * STEP) + 'px' : undefined);
      list = U.el('div', 'hr-list', clip, FX ? 'width:' + W + 'px' : undefined);
      fl = N.ui.freeList({ el: list, max: maxPx, dim: VIS * STEP,
        hit: function (x, y) { return !moving && !dg && x >= X && x < X + W + 16 && y >= TOP && y < TOP + VIS * STEP; },
        onSet: function (p) { more.set(p > 0.5, p < maxPx() - 0.5); } });
      var how = U.el('div', 'hr-how', root, HOW ? 'left:' + HOW.x + 'px;top:' + HOW.y + 'px;width:' + HOW.w + 'px' : undefined);
      U.txt('div', 'hr-how-t', how, N.t('set.hr.how.title'));
      U.txt('div', 'hr-how-x', how, N.t(K.how));
      stat = U.txt('div', 'hr-stat', how, '');
      desc = U.txt('div', 'set-desc hr-desc', root, '', FX ? 'left:' + X + 'px;top:' + (TOP + VIS * STEP + 16) + 'px;width:' + (W - 48) + 'px' : undefined);   // nur mit Tasten sichtbar
      var mx = X + Math.round(W / 2) - 10;
      more = N.ui.more(root, 'left:' + mx + 'px;top:84px', 'left:' + mx + 'px;top:' + (TOP + VIS * STEP + 2) + 'px');   // Mehr-Hinweis (NAV-11) wie in den Einstellungen
      cat = S.hubCatalog();
      rebuild(null);
      if (HOW && HOW.below) how.style.top = (TOP + Math.min(VIS, items.length) * STEP + 24) + 'px';   // kurze Liste: direkt darunter
      if (!C.noCatalog) discover();                   // Seitenleiste: keine Server-Hubs noetig
    };
    /* Liste (neu) aufbauen; keepId: Fokus auf diese Reihe legen */
    function rebuild(keepId) {
      var v = MOD.view(saved(), avail()), i;
      items = [];
      for (i = 0; i < v.length; i++) items.push({ id: v[i].id, on: v[i].on });
      var adds = C.ext && N.ext.has('home:adders') ? N.ext.call('home:adders') || [] : [];
      for (i = 0; i < adds.length; i++) if (adds[i] && adds[i].id) items.push({ id: '#add-' + adds[i].id, add: adds[i] });
      items.push({ id: '#reset', reset: true });
      while (els.length < items.length) els.push(mkRow(els.length));
      for (i = 0; i < els.length; i++) U.show(els[i].el, i < items.length);
      for (i = 0; i < items.length; i++) paint(i);
      var nf = 0;
      if (keepId) for (i = 0; i < items.length; i++) if (items[i].id === keepId) nf = i;
      U.cls(els[f] ? els[f].el : list, 'is-focus', false);
      setFocus(nf, true);
    }
    /* TV-Test 29.10.: nach Hinzufuegen/Entfernen/Zuruecksetzen blieb die Hinweisleiste der alten Zeile stehen (neue Reihe ohne
     * "Entfernen/Verschieben", nach dem Entfernen "A Entfernen" auf einer eingebauten Reihe). Sofort und nach dem Schliessen
     * eines Assistenten/Dialogs (der danach seine eigene Leiste abraeumt) neu */
    function hintsNow() { N.router.refreshHints(); N.idle.add(function () { if (!dead) N.router.refreshHints(); }, 'hr-hints'); }
    function mkRow(i) {
      var e = { el: U.el('div', 'set-row hr-row', list, 'top:' + (i * STEP) + 'px' + (FX ? ';width:' + W + 'px' : '')) };
      e.lb = U.txt('div', 'lb' + (FX ? ' ell' : ''), e.el, '', FX ? 'width:' + (W < 640 ? W - 230 : 400) + 'px' : undefined);
      e.val = U.txt('div', 'val', e.el, '', FX && W < 640 ? 'display:none' : undefined);   // schmal: Bibliothek steht in der ⓘ-Blase
      e.tg = U.el('div', 'toggle', e.el); U.el('i', '', e.tg);
      e.mv = U.el('div', 'mv', e.el); U.el('i', 'up', e.mv); U.el('i', 'dn', e.mv);   // CSS-Dreiecke statt ▲ ▼ (TV-Schrift, Regel 10)
      U.el('div', 'sep', e.el);
      e.tip = N.ui.infotip.icon(e.el);                 // Finger/Maus: ⓘ statt Beschreibungsflaeche (Nr. 28; am TV null)
      if (e.tip) U.cls(e.el, 'itr', true);
      if (GRIP) { e.gp = U.el('div', 'hr-grip', e.el); U.el('i', '', e.gp); U.el('i', '', e.gp); U.el('i', '', e.gp); U.cls(e.el, 'hgr', true); }   // NAV-27
      return e;
    }
    function paint(i) {
      var it = items[i], e = els[i];
      U.setText(e.lb, label(it));
      U.setText(e.val, special(it) ? '' : locked(it) ? N.t(C.keys.always) : libName(it));
      U.show(e.tg, !special(it) && !locked(it));
      if (!special(it)) U.cls(e.tg, 'on', it.on);
      U.cls(e.el, 'off', !special(it) && !it.on);
      if (e.gp) U.show(e.gp, !special(it));
    }
    function scrollFor(i) { return U.clamp(i - ANCHOR, 0, Math.max(0, items.length - VIS)); }
    function maxPx() { return Math.max(0, items.length - VIS) * STEP; }
    function scPx() { return fl.free ? fl.px : sc * STEP; }   // aktuelle Lage der Liste (frei gescrollt oder nach Tasten)
    function setFocus(i, jump) {
      if (els[f]) U.cls(els[f].el, 'is-focus', false);
      f = i;
      U.cls(els[f].el, 'is-focus', true);
      var nsc = scrollFor(f);
      if (fl.keys()) jump = true;                       // nach freiem Scrollen: sofort auf ganze Zeilen (wie die Einstellungen)
      if (nsc !== sc || jump) {
        sc = nsc;
        if (jump) { list.style.webkitTransition = 'none'; U.tf(list, 0, -sc * STEP); setTimeout(function () { list.style.webkitTransition = ''; }, 60); }
        else { N.fx.move(list); U.tf(list, 0, -sc * STEP); }
      }
      fl.sync(sc * STEP);
      more.set(sc > 0, sc + VIS < items.length);
      U.setText(desc, descText(items[f]));
    }

    /* ---------- Aenderungen ---------- */
    function save() {
      var vis = [];
      for (var i = 0; i < items.length; i++) if (!special(items[i])) vis.push({ id: items[i].id, on: items[i].on });
      S.setSetting(C.setting, MOD.store(saved(), avail(), vis));
    }
    function toggle() {
      var it = items[f];
      if (locked(it)) { N.ui.toast.show(N.t(C.keys.lockedToast), { icon: 'info' }); return; }
      it.on = !it.on; paint(f); save();
    }
    function startMove() {
      if (special(items[f])) return;
      moving = true; U.cls(els[f].el, 'is-move', true);
      U.setText(desc, descText(items[f]));
      N.router.refreshHints();
    }
    function drop() {
      moving = false; U.cls(els[f].el, 'is-move', false);
      save();
      U.setText(desc, descText(items[f]));
      N.router.refreshHints();
    }
    function step(dir) {
      var j = f + dir;
      if (j < 0 || j >= nRows()) return;               // "Reihe hinzufuegen …" und "Standard wiederherstellen" bleiben unten
      MOD.move(items, f, dir);
      U.cls(els[f].el, 'is-move', false);
      paint(f); paint(j);
      setFocus(j);
      U.cls(els[f].el, 'is-move', true);
    }
    /* "Standard wiederherstellen": gibt es selbst hinzugefuegte (entfernbare) Reihen einer Erweiterung, fragt der Dialog, was mit
     * ihnen geschieht – behalten (ausgeschaltet, am Ende) oder loeschen; Fokus auf "Abbrechen". Sonst die einfache Rueckfrage. */
    function reset() {
      var own = false, i;
      for (i = 0; i < items.length; i++) if (removable(items[i])) own = true;
      if (own) {
        N.ui.dialog.open({ title: N.t('dlg.hrReset.title'), text: N.t('dlg.hrResetOwn.text'), vertical: true, focus: 2,
          buttons: [{ id: 'own', t: N.t('dlg.hrResetOwn.keep') }, { id: 'all', t: N.t('dlg.hrResetOwn.all') }, { id: 'cancel', t: N.t('dlg.hrReset.cancel') }],
          onSelect: function (id) {
            if (dead || (id !== 'own' && id !== 'all')) return;
            if (id === 'all') S.setSetting(C.setting, null);
            else { var av = avail(); S.setSetting(C.setting, MOD.store(null, av, MOD.view(null, av))); }   // Standard, eigene Reihen aus am Ende
            rebuild(null); hintsNow();
            N.ui.toast.show(N.t(id === 'all' ? 'toast.hrReset' : 'toast.hrResetKeep'), { icon: 'confirm' });
          } });
        return;
      }
      N.ui.dialog.open({ title: N.t('dlg.hrReset.title'), text: N.t(K.resetText),
        buttons: [{ id: 'ok', t: N.t('dlg.hrReset.confirm') }, { id: 'cancel', t: N.t('dlg.hrReset.cancel') }], focus: 1,
        onSelect: function (id) {
          if (id !== 'ok') return;
          S.setSetting(C.setting, null);
          rebuild(null); hintsNow();
          N.ui.toast.show(N.t('toast.hrReset'), { icon: 'confirm' });
        } });
    }
    function activate() { if (items[f].reset) reset(); else if (items[f].add) addRow(items[f].add); else toggle(); }
    function nRows() { var n = 0; for (var i = 0; i < items.length; i++) if (!special(items[i])) n++; return n; }
    /* Erweiterung: Reihe hinzufuegen (Assistent der Erweiterung) -> eingeschaltet ans Ende der Reihen, Fokus darauf; gibt es sie
     * schon, nur einschalten */
    function addRow(a) {
      N.ext.call('home:add', a.id, function (id) {
        if (dead || !id || !/^x-/.test(id)) return;
        var had = false, vis = [], i;
        for (i = 0; i < items.length; i++) if (!special(items[i])) { if (items[i].id === id) { items[i].on = true; had = true; } vis.push({ id: items[i].id, on: items[i].on }); }
        var sv = MOD.store(saved(), avail(), vis);       // Standard (null) erst ausschreiben, dann anhaengen
        if (!had) sv.push({ id: id, on: true });
        S.setSetting(C.setting, sv);
        rebuild(id); hintsNow();
        N.ui.toast.show(N.t(had ? 'toast.hrOn' : 'toast.hrAdded'), { icon: 'confirm' });
      });
    }
    /* Langes Druecken bzw. TOOLS (Finger/Maus haben keine Hinweisleiste, Nr. 26): Verschieben/Entfernen als Menue */
    function actions() {
      var it = items[f], b = [], n = nRows();
      if (!it || special(it)) return;
      if (!GRIP || N.input.mode === 'key') b.push({ id: 'move', t: N.t('hint.move') });
      if (GRIP) {                                       // NAV-27: Barrierefreiheit ohne Ziehen (am TV nie)
        if (f > 0) b.push({ id: 'up', t: N.t('set.hr.mv.up') });
        if (f < n - 1) b.push({ id: 'down', t: N.t('set.hr.mv.down') });
        if (f > 1) b.push({ id: 'top', t: N.t('set.hr.mv.top') });
        if (f < n - 2) b.push({ id: 'bottom', t: N.t('set.hr.mv.bottom') });
      }
      if (removable(it)) b.push({ id: 'remove', t: N.t('hint.removeRow') });
      if (!b.length) return;
      N.ui.dialog.open({ title: label(it), buttons: b, vertical: true, focus: 0, top: 120,
        onSelect: function (id) { if (dead) return; if (id === 'move') startMove(); else if (id === 'remove') removeRow(); else if (MV[id]) jumpRow(id, false); } });
    }
    /* ---------- Verschieben ohne Gelb (NAV-27): Menue und Cmd+Pfeil ---------- */
    var MV = { up: 1, down: 1, top: 1, bottom: 1 };
    /* Zeile f nach oben/unten bzw. ganz nach oben/unten; keys: Fokus mit Tasten-Lage (Cmd+Pfeil), sonst Lage bleibt (Menue) */
    function jumpRow(what, keys) {
      var n = nRows(), j = what === 'up' ? f - 1 : what === 'down' ? f + 1 : what === 'top' ? 0 : n - 1;
      if (special(items[f]) || j < 0 || j >= n || j === f) return false;
      place(f, j, keys);
      return true;
    }
    /* Eintrag i auf Platz j, Zeilen dazwischen neu beschriftet, Fokus auf j, speichern */
    function place(i, j, keys) {
      HR.moveTo(items, i, j);
      for (var k = Math.min(i, j); k <= Math.max(i, j); k++) paint(k);
      if (keys) { setFocus(j); N.router.refreshHints(); }
      else { U.cls(els[f].el, 'is-focus', false); f = j; U.cls(els[f].el, 'is-focus', true); U.setText(desc, descText(items[f])); }
      save();
    }
    /* ---------- Ziehen am Griff (NAV-27) ---------- */
    function stagePt(x, y) {                          // Flaeche -> Ansicht (flexibel: Inhaltskante verschoben; sonst Kasten 1280x720)
      if (FX) return { x: x - N.screen.view().x, y: y };
      var g = N.screen.stage(); return { x: (x - g.x) / g.k, y: (y - g.y) / g.k };
    }
    function rowAt(y) { if (y < TOP || y >= TOP + VIS * STEP) return -1; var i = Math.floor((y - TOP + scPx()) / STEP); return i >= 0 && i < items.length ? i : -1; }
    function onGrip(x, y) { var i = rowAt(y); return GRIP && !moving && !dg && i >= 0 && !special(items[i]) && x >= X + W - GZ && x < X + W + 24 ? i : -1; }
    function shiftRows(i, j) {
      for (var k = 0; k < nRows(); k++) if (k !== i) { var d = HR.dragShift(k, i, j, STEP), e = els[k]; if (d !== (e.dsh || 0)) { e.dsh = d; U.tf(e.el, 0, d); } }
    }
    function dragUpdate() {
      var away = HR.dragAway(dg.x, X, W, 160), dy = dg.y - dg.y0 + scPx() - dg.p0, j = away ? dg.i : HR.dragTo(dg.i, dy, STEP, nRows());
      dg.away = away;
      var el = els[dg.i].el, t = away ? 'translate3d(0,0,0)' : 'translate3d(0,' + Math.round(dy) + 'px,0) scale(1.02)';
      el.style.webkitTransform = el.style.transform = t;
      if (j !== dg.j) { if (hap && !away) hap.select(); dg.j = j; shiftRows(dg.i, j); }
    }
    function dragTick(ts) {
      if (!dg) return;
      var v = dg.away ? 0 : HR.dragAuto(dg.y, TOP, VIS * STEP, 48, 0.9);
      if (!v) { dg.raf = false; return; }
      var dt = dg.ts ? Math.min(34, ts - dg.ts) : 16, p = U.clamp(scPx() + v * dt, 0, maxPx());
      dg.ts = ts;
      if (p !== scPx()) { fl.set(p); more.set(p > 0.5, p < maxPx() - 0.5); dragUpdate(); }
      U.raf(dragTick);
    }
    function dragEnd(ok) {
      var z = dg, k;
      dg = null; hap = null;
      U.cls(list, 'hr-drag', false); U.cls(els[z.i].el, 'is-lift', false); els[z.i].el.removeAttribute('data-layout-ok');
      list.style.webkitTransition = 'none';
      for (k = 0; k < els.length; k++) if (els[k].dsh || k === z.i) { els[k].dsh = 0; els[k].el.style.webkitTransform = els[k].el.style.transform = ''; }
      if (ok && !z.away && z.j !== z.i) place(z.i, z.j, false);
      else if (ok && !z.away && !z.moved) actions();   // Tipp auf den Griff ohne Ziehen: Menue
      fl.settle();
    }
    s.pointerGrab = function (x, y) { var p = stagePt(x, y); return onGrip(p.x, p.y) >= 0 ? 'drag' : ''; };
    s.pointerDrag = function (ph, x, y) {
      var p = stagePt(x, y);
      if (ph === 'start') {
        var i = onGrip(p.x, p.y);
        if (i < 0) return false;
        fl.stop(); if (!fl.free) { fl.sync(sc * STEP); fl._loose(); }
        if (i !== f) { U.cls(els[f].el, 'is-focus', false); f = i; U.cls(els[f].el, 'is-focus', true); U.setText(desc, descText(items[f])); }
        dg = { i: i, j: i, y0: p.y, p0: scPx(), x: p.x, y: p.y, away: false, moved: false, raf: false, ts: 0 };
        hap = N.input.mode === 'touch' && N.platform.haptic ? N.platform.haptic : null;
        if (hap) hap.prepare();
        U.cls(list, 'hr-drag', true); U.cls(els[i].el, 'is-lift', true);
        els[i].el.setAttribute('data-layout-ok', 'button,overlap');   // bewusst: angehobene Zeile liegt waehrend des Zugs ueber den anderen
        return true;
      }
      if (!dg) return false;
      if (ph === 'move') {
        dg.x = p.x; dg.y = p.y;
        if (Math.abs(p.y - dg.y0) > 6) dg.moved = true;
        dragUpdate();
        if (!dg.raf && HR.dragAuto(dg.y, TOP, VIS * STEP, 48, 0.9)) { dg.raf = true; dg.ts = 0; U.raf(dragTick); }
        return true;
      }
      if (ph === 'end') { dg.x = p.x; dg.y = p.y; dragUpdate(); }
      dragEnd(ph === 'end');
      return true;
    };
    /* Tastatur (Lader: Cmd+Pfeil, App.shortcut 'moveUp' …): nur ausserhalb des Gelb-Verschiebens und ohne Zug */
    s.shortcut = function (what) {
      if (!GRIP || moving || dg) return false;
      var m = { moveUp: 'up', moveDown: 'down', moveTop: 'top', moveBottom: 'bottom' }[what];
      return !!m && jumpRow(m, true);
    };
    /* Erweiterung: hinzugefuegte Reihe entfernen (Rot, Rueckfrage mit Fokus auf "Behalten") */
    function removeRow() {
      var it = items[f];
      if (!removable(it)) return;
      N.ui.dialog.open({ title: N.t('dlg.hrRemove.title'), text: N.t('dlg.hrRemove.text', { row: label(it) }),
        buttons: [{ id: 'ok', t: N.t('dlg.hrRemove.confirm') }, { id: 'keep', t: N.t('dlg.hrRemove.keep') }], focus: 1,
        onSelect: function (id) {
          if (id !== 'ok' || dead) return;
          var out = [], l = saved() || MOD.view(null, avail()), i;
          for (i = 0; i < l.length; i++) if (l[i] && l[i].id !== it.id) out.push({ id: l[i].id, on: !!l[i].on });
          S.setSetting(C.setting, out);
          var next = items[f + 1] && !special(items[f + 1]) ? items[f + 1].id : items[f - 1] ? items[f - 1].id : null;
          rebuild(next); hintsNow();
          N.ui.toast.show(N.t('toast.hrRemoved'), { icon: 'confirm' });
        } });
    }

    /* ---------- Hub-Katalog vom Server (Hintergrund) ---------- */
    function setStat(key) { U.setText(stat, key ? N.t(key) : ''); }
    function discover() {
      if (cat && cat.lang === N.i18n.lang() && U.now() - (cat.ts || 0) < STALE) return;
      setStat('set.hr.loading');
      busy = N.hubs.discover(cat, function (err, c) {
        busy = null;
        if (dead) return;
        if (err) { setStat('set.hr.failed'); return; }
        setStat('');
        cat = c; S.setHubCatalog(c);
        if (moving) return;                           // nie unter dem Verschieben umbauen
        var keep = items[f] ? items[f].id : null;
        rebuild(keep);
        N.router.refreshHints();
      });
    }

    /* ---------- Lebenszyklus, Tasten, Zeiger ---------- */
    s.enter = function (p, r) {                      // r: Stand vor dem Neuaufbau (Drehen/Fenster, N.router.relayout)
      if (r && r.id && items[f] && items[f].id !== r.id) rebuild(r.id);
      if (els[f]) U.cls(els[f].el, 'is-focus', true);
    };
    s.leave = function () { if (dg) dragEnd(false); if (moving) drop(); return items[f] ? { id: items[f].id } : null; };
    s.destroy = function () { dead = true; if (busy) busy.abort(); };
    s.hints = function () {
      if (moving) return [{ k: 'yellow', t: 'hint.drop' }];
      var list = [];
      if (removable(items[f])) list.push({ k: 'red', t: 'hint.removeRow' });
      if (items[f] && !special(items[f])) list.push({ k: 'yellow', t: 'hint.move' });
      list.push({ k: 'ret', t: 'hint.back' }, { k: 'INFO', t: 'hint.learnMore' });
      return list;
    };
    s.onKey = function (k) {
      if (moving) {
        if (k === 'UP') step(-1);
        else if (k === 'DOWN') step(1);
        else if (k === 'ENTER' || k === 'YELLOW' || k === 'RETURN') drop();
        return true;
      }
      var n;
      if (k === 'UP' || k === 'DOWN') { n = N.nav.list(f, items.length, k, true); if (n >= 0) { setFocus(n); N.router.refreshHints(); } }
      else if (k === 'ENTER') activate();
      else if (k === 'YELLOW') startMove();
      else if (k === 'RED') removeRow();
      else if (k === 'TOOLS') actions();
      else if (k === 'INFO') N.ui.panel.help(N.t(K.title), N.t(K.help));
      else if (k === 'RETURN') N.router.back();
      return true;
    };
    /* Finger/Trackpad: frei scrollen (N.ui.freeList); beim Verschieben nicht (false -> Wischen = ein Platz je Schritt) */
    s.scrollTop = function () { return fl.top(); };   // An den Anfang (App.scrollTop, Tipp ganz oben / Cmd+Pfeil hoch)
    s.pan = function (e) { if (dg) return true; return fl.pan(e) || (e.phase === 'start' && !moving); };   // kurze Liste/daneben: annehmen, nichts tun
    s.wheel = function (x, y, dx, dy) { return fl.wheel(x, y, dy); };
    s.pointerDown = function () { fl.down(); };
    /* Finger/Maus (Nr. 28): Treffer auf dem ⓘ (x 824–896, volle Zeilenhoehe) oeffnet nur die Info-Blase mit dem Text der Zeile */
    s.pointer = function (x, y, kind) {
      if (fl.eat(kind)) return true;                    // Tipp in den Schwung: nur anhalten
      var tip = N.ui.infotip.on() && !moving;
      if (x < X || x >= X + W + (tip ? 16 : 0)) { N.ui.infotip.hover(null); return false; }
      var i;
      if (fl.free) i = fl.idx(y, TOP, STEP, items.length, VIS);   // frei gescrollt: auch angeschnittene Zeilen
      else { i = N.hit.list(TOP, STEP, STEP, Math.min(VIS, items.length - sc), y); if (i >= 0) i += sc; }
      if (i < 0) { N.ui.infotip.hover(null); return false; }
      if (moving) { if (kind === 'click') drop(); return true; }
      if (i !== f) { U.cls(els[f].el, 'is-focus', false); f = i; U.cls(els[f].el, 'is-focus', true); U.setText(desc, descText(items[f])); N.router.refreshHints(); }
      if (GRIP && x >= X + W - GZ && !special(items[i])) return true;   // Griff: nur Ziehen (Tipp = Menue ueber pointerDrag)
      if (tip && els[i].tip && x >= X + W - 56 - (GRIP ? GZ - 8 : 0)) {
        N.ui.infotip.hover(els[i].tip);
        if (kind === 'click') N.ui.infotip.open({ title: label(items[i]), text: descText(items[i]), x: X + W - 32 - (GRIP ? 56 : 0), y: TOP + i * STEP - scPx() + 32, flex: FX, el: els[i].tip });
        return true;
      }
      N.ui.infotip.hover(null);
      if (x >= X + W) return true;
      if (kind === 'click') activate();
      return true;
    };
    s.relabel = function () { for (var i = 0; i < items.length; i++) paint(i); U.setText(desc, descText(items[f])); };
    return s;
  }; }

  /* ---------- "Startseite anpassen" ---------- */
  function hubLabel(id, c) {                       // wechselnde Hubs (Genre/Person): neutraler Name statt "Top-Filme in Action" (TV-Befund P5)
    var p = HR.parse(id), h = c.hubOf(id), nk = 'set.hr.name.' + (h ? h.fam : p.type);
    if (N.i18n.has(nk)) return N.t(nk);
    return h ? h.title : id;
  }
  N.rowsEditor = editor;
  N.router.define('homerows', editor({
    setting: 'homeRows', ext: true,
    keys: { title: 'set.homeRows', how: 'set.hr.how', help: 'set.hr.help', resetDesc: 'set.hr.reset.desc', resetText: 'dlg.hrReset.text' },
    avail: function (c) { return HR.avail(c.libs, c.cat); },
    label: function (it, c) {
      var p = HR.parse(it.id), lib;
      if (it.id === 'cw') return N.t('home.row.continue');
      if (it.id === 'deck') return N.t('home.row.upNext');
      if (it.id === 'ab') return N.t('mu.row.continue');   // M4
      if (p.group === 'new') { lib = c.libOf(p.lib); return N.t('home.row.newIn', { library: lib ? lib.title : '' }); }
      if (p.group === 'hub') return hubLabel(it.id, c);
      if (p.group === 'ext') return N.ext.call('home:label', it.id) || it.id;   // Reihe einer Erweiterung
      if (p.group === 'live') return N.t('live.row');  // Fernsehen (LIVE-6)
      return c.cat && c.cat.pl && c.cat.pl.title && c.cat.lang === N.i18n.lang() ? c.cat.pl.title : N.t('home.row.playlists');
    },
    val: function (it, c) {
      var p = HR.parse(it.id), lib = p.group === 'hub' ? c.libOf(p.lib) : null;
      if (p.group === 'ext') return N.ext.call('home:val', it.id) || '';
      return lib ? lib.title : '';
    },
    desc: function (it, c) {
      var p = HR.parse(it.id);
      if (p.group === 'ext') return N.ext.call('home:desc', it.id) || '';
      if (p.group === 'live') return N.t('set.hr.tv.desc');
      if (it.id === 'ab') return N.t('mu.hr.ab.desc');   // M4
      if (it.id === 'cw' || it.id === 'deck' || it.id === 'pl') return N.t('set.hr.' + it.id + '.desc');
      var lib = c.libOf(p.lib), name = lib ? lib.title : '';
      if (p.group === 'new') return N.t('set.hr.new.desc', { library: name });
      var h = c.hubOf(it.id), key = 'set.hr.' + (h ? h.fam : '') + '.desc';
      if (!h || !N.i18n.has(key)) key = lib && (lib.kind === 'music' || lib.kind === 'audio') ? 'set.hr.music.desc' : 'set.hr.hub.desc';
      return N.t(key, { library: name });
    }
  }));

  /* ---------- "Seitenleiste anpassen" (W1): Suche, Entdecken, Start, Bibliotheken – Start immer sichtbar ---------- */
  function railLib(id) { var l = N.ui.rail.allLibs(); for (var i = 0; i < l.length; i++) if (N.railRows.libId(l[i]) === id) return l[i]; return null; }
  N.router.define('railitems', editor({
    setting: 'railItems', model: N.railRows, noCatalog: true,
    keys: { title: 'set.railItems', how: 'set.ri.how', help: 'set.ri.help', resetDesc: 'set.ri.reset.desc', resetText: 'dlg.riReset.text',
      always: 'set.ri.always', lockedToast: 'toast.riLocked' },
    avail: function () { return N.railRows.avail(N.ui.rail.allLibs(), !!(N.disc && N.disc.enabled()), N.ui.rail.live()); },
    locked: function (it) { return !!N.railRows.LOCKED[it.id]; },
    label: function (it) {
      if (it.id === 'search' || it.id === 'discover' || it.id === 'home') return N.t('nav.' + it.id);
      if (it.id === 'livetv') return N.t('nav.live');
      var lib = railLib(it.id);
      return lib ? lib.title : it.id;
    },
    val: function (it) { var lib = railLib(it.id); return lib && lib.srv ? lib.srvName : ''; },   // Weitere Server: Herkunft rechts
    desc: function (it) {
      if (it.id === 'search' || it.id === 'discover' || it.id === 'home' || it.id === 'livetv') return N.t('set.ri.' + it.id + '.desc');
      var lib = railLib(it.id);
      if (lib && lib.srv) return N.t('set.ri.xlib.desc', { library: lib.title, server: lib.srvName, n: N.ui.rail.MAX });
      return N.t('set.ri.lib.desc', { library: lib ? lib.title : '' });
    }
  }));

  /* ---------- "Fernsehsender auf der Startseite" (SPEC LIVE-6): welche Sender in der Reihe "Fernsehen" stehen und in welcher
   * Reihenfolge – gleiche Liste wie "Startseite anpassen" (OK an/aus, Gelb verschieben, Standard unten). Sender der eingeschalteten
   * Regionen; Standard: die Hauptprogramme (Daten: home). Erreichbar ueber Einstellungen, den Bereich Fernsehen und die Reihe (TOOLS). */
  N.router.define('livehome', editor({
    setting: 'liveHome', model: N.liveLogic.rows, noCatalog: true,
    keys: { title: 'set.liveHome', how: 'set.lh.how', help: 'set.lh.help', resetDesc: 'set.lh.reset.desc', resetText: 'dlg.lhReset.text' },
    avail: function () { return N.live.homeAvail(); },
    label: function (it) { var c = N.liveLogic.channel(it.id); return c ? c.name : it.id; },
    val: function (it) { var c = N.liveLogic.channel(it.id); return c ? N.live.regionName(c.region) : ''; },
    desc: function (it) {
      var c = N.liveLogic.channel(it.id);
      if (!c) return '';
      return N.t(c.geo ? 'set.lh.ch.geo.desc' : 'set.lh.ch.desc', { channel: c.name, region: N.live.regionName(c.region), country: c.geo ? N.t('live.country.' + c.geo) : '' });
    }
  }));
})(N);
