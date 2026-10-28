/* Ansicht 'search' – Suche (SPEC 5.14, 7.9, 6.2, 15; Mockup search.html).
 * - Suchfeld x 144, y 48 (T9-Kandidat unterstrichen, Cursor Amber), Hinweis y 112, Bildschirmtastatur ab y 152 (abc/123, breite Tasten).
 * - T9 ueber die Zifferntasten (immer aktiv): Mehrfachdruck innerhalb 900 ms wechselt den Buchstaben, Blase ueber dem Feld.
 * - Anfrage 400 ms nach der letzten Eingabe ab 2 Zeichen (/hubs/search, laufende wird abgebrochen, LRU 20).
 * - Ergebnisse x 560–1216 als Reihen je Gruppe (Serien, Filme, Folgen, Personen, Sammlungen); EIN translate3d am Ergebnis-Container.
 * - Leer: "Zuletzt gesucht" (je Profil, max. 6) + "Vorschlaege" aus dem Home-Cache (0 Anfragen).
 * - RETURN: Ergebnisse -> letzte Taste; Tastatur -> Seitenleiste (Eingabe bleibt). Rot = Alles loeschen. Zeiger: alles anklickbar.
 * P4 "Entdecken" (mode 'discover', docs/research/discover.md) ist DIESELBE Ansicht mit anderer Datenquelle (N.disc.search):
 * Gruppen "Auf deinem Server – abspielen" / "Nicht auf deinem Server · Filme|Serien", eigene "Zuletzt gesucht"-Liste, OK auf
 * fremdem Titel -> 'extdetails'; leer: Merkliste (nur mit Helfer) + Inspirations-Reihen (N.insp, "Inspiration anpassen"),
 * ohne beides ein erklaerender Text. Tippen ersetzt die Reihen durch Ergebnisse, Leeren holt sie zurueck (aus dem Speicher).
 * Kein Abspielen/Gesehen fuer fremde Titel.
 * Reihen-Slots: 5 N.ui.Row im Wechsel (Gruppe i -> Slot i mod 5), belegt nur das Fenster g-1 .. g+3 (wie die Startseite);
 * Nachladen des Fensters in der Idle-Queue, nie im Tastenpfad. */
(function (N) {
  var U = N.util, M = N.model, S = N.srch, RES_X = 416, HEAD_Y = 48, PITCH = { posterQ: 316, landS: 308, castS: 260, note: 168 };   // note: Hinweis-Reihe (Kopf + bis zu 3 Zeilen)   // >= 24 px Luft zwischen Gruppen
  var NS = 5;                                          // Reihen-Slots (Fenster g-1 .. g+3)

  function view(kind) { return function () {   // kind: 'search' | 'discover' (nicht "mode": so heisst unten die Tastatur-Ebene)
    var D = kind === 'discover', PFX = D ? 'disc' : 'search', DELAY = D ? N.disc.DELAY : S.DELAY;
    var s = { rail: kind, wheelKeys: ['LEFT', 'RIGHT'] };
    var root, qT, candEl, candT, caret, bubble, bubbleEls = [], keys = [], keyEls = [], rows = [], mode = 'abc', pos = { r: 0, c: 0, col: 0 };
    var resPg, slots = [], groups = [], tops = [], g = 0, recentEl, recentEls = [], recentHeadT, stateT, stateX, tipT;
    var q = '', t9 = new S.T9(), t9T = 0, reqT = 0, task = null, cache = new N.LRU(20), shownQ = null, zone = 'kbd', rf = 0, ring, off = 0, dead = false, sugg = [], wlTask = null;
    var slotGroup = [], colMem = {}, emptyY = HEAD_Y, emptyRec = 0, wlGroup = null, inspIds = [], inspRows = {}, inspTask = null, pendingEmpty = false, onWl = null, wlDirty = false;   // colMem: Spalte je Gruppen-id

    /* ---------- Aufbau ---------- */
    s.create = function (el) {
      root = el;
      var f = U.el('div', 'sfield', root);
      N.ui.icon(f, D ? 'compass' : 'search');
      var qe = U.el('div', 'q', f);
      qT = document.createTextNode(''); qe.appendChild(qT);
      candEl = U.el('u', '', qe); candT = document.createTextNode(''); candEl.appendChild(candT);
      caret = U.el('span', 'caret', qe);
      bubble = U.el('div', 't9b', root, 'display:none');
      for (var i = 0; i < 4; i++) { var b = U.el('span', '', bubble); b.appendChild(document.createTextNode('')); bubbleEls.push(b); }
      U.txt('div', 'a t-small c2', root, N.t(D ? 'disc.hint' : 'search.hint'), 'left:144px;top:112px;width:400px');
      buildKeys();
      resPg = U.el('div', 'sres', U.el('div', 'sclip', root));   // Clip ab y 52: vorherige Gruppe verschwindet beim Scrollen ganz
      recentEl = U.el('div', 'srecent', resPg);
      recentHeadT = U.txt('div', 'row-head', recentEl, N.t('search.recent'), 'left:0;top:0');
      for (i = 0; i < S.MAX_RECENT; i++) { var c = U.el('div', 'chip', recentEl, 'position:absolute;left:0;top:' + (52 + i * 44) + 'px;display:none'); c.appendChild(document.createTextNode('')); recentEls.push(c); }
      stateT = U.txt('div', 'a t-h2', root, '', 'left:560px;top:48px;width:656px');
      stateX = U.txt('div', 'a t-body c2', root, '', 'left:560px;top:96px;width:620px');
      tipT = U.txt('div', 'a t-small c2', root, '', 'left:560px;top:180px;width:620px');
      for (i = 0; i < NS; i++) { slots.push(new N.ui.Row(resPg, { caption: S.caption })); slotGroup.push(-1); }
      // Naechste Reihe nur angeschnitten (Bilder, ohne Untertitel): Tastenleiste unten rechts ueberdeckt nichts (TV-Test 27.10., F8)
      var fade = U.el('img', 'fade s-fade', root); fade.src = N.assetBase + 'fade-bottom.png';
      U.el('div', 's-fadebg', root);
      ring = new N.ui.Ring(root);
      if (D) {                                        // Merkliste auf einer Detailseite geaendert: Reihe ohne Anfrage anpassen,
        onWl = function (e) {                         // sichtbar beim Zurueckkehren (enter)
          if (!e || !e.it || dead) return;
          var items = N.disc.wl.apply(wlGroup ? wlGroup.items : [], e.it, e.on);
          wlGroup = items.length ? { id: 'wl', tk: 'disc.group.watchlist', kind: 'posterQ', items: items } : null;
          wlDirty = true;
        };
        N.evt.on('watchlist:changed', onWl);
      }
    };
    function buildKeys() {
      for (var i = 0; i < keyEls.length; i++) if (keyEls[i].parentNode) keyEls[i].parentNode.removeChild(keyEls[i]);
      keyEls = []; keys = []; rows = S.layout(mode);
      for (var r = 0; r < rows.length; r++) {
        var line = [];
        for (var c = 0; c < rows[r].length; c++) {
          var k = rows[r][c], e = U.el('div', k.w > S.KW ? (k.act === 'del' ? 'key wide del' : 'key wide') : 'key', root, 'left:' + k.x + 'px;top:' + k.y + 'px');
          if (k.act === 'del') N.ui.icon(e, 'backspace');   // Sprite statt U+232B (fehlt in der TV-Schrift, TV-Befund 26.10.)
          e.appendChild(document.createTextNode(k.k || N.t(k.act === 'space' ? 'search.key.space' : k.act === 'del' ? 'search.key.delete' : mode === 'num' ? 'search.key.abc' : 'search.key.num')));
          keyEls.push(e); line.push(e);
        }
        keys.push(line);
      }
      pos.r = Math.min(pos.r, rows.length - 1); pos.c = Math.min(pos.c, rows[pos.r].length - 1);
      if (zone === 'kbd') U.cls(keys[pos.r][pos.c], 'is-focus', true);
    }

    /* ---------- Eingabe ---------- */
    function paintField() {
      U.setText(qT, q);
      var c = t9.active() ? t9.pending() : '';
      U.setText(candT, c === ' ' ? ' ' : c);
    }
    function changed() {
      paintField();
      if (reqT) clearTimeout(reqT);
      reqT = setTimeout(function () { reqT = 0; run(); }, DELAY);
      N.router.refreshHints();
    }
    function commitT9() { if (t9T) { clearTimeout(t9T); t9T = 0; } var c = t9.flush(); U.show(bubble, false); if (c) q += c; }
    function type(ch) { commitT9(); if (q.length < 60) q += ch; changed(); }
    function del() { if (t9.active()) { t9.flush(); U.show(bubble, false); if (t9T) { clearTimeout(t9T); t9T = 0; } } else q = q.slice(0, -1); changed(); }
    function clearAll() { t9.flush(); U.show(bubble, false); q = ''; changed(); if (zone !== 'kbd') toKbd(); }
    function digit(d) {
      if (q.length >= 60) return;                          // gleiche Grenze wie die Bildschirmtastatur
      var r = t9.press(d, U.now());
      if (r.commit) q += r.commit;
      U.show(bubble, true);
      for (var i = 0; i < 4; i++) {
        var L = r.letters.charAt(i);
        U.show(bubbleEls[i], !!L); U.setText(bubbleEls[i].firstChild, L === ' ' ? '_' : L);
        U.cls(bubbleEls[i], 'on', i === r.idx);
      }
      if (t9T) clearTimeout(t9T);
      t9T = setTimeout(function () { t9T = 0; commitT9(); changed(); }, S.T9MS);
      changed();
    }
    function keyAct(k) {
      if (k.k) type(k.k);
      else if (k.act === 'space') type(' ');
      else if (k.act === 'del') del();
      else { U.cls(keys[pos.r][pos.c], 'is-focus', false); mode = mode === 'num' ? 'abc' : 'num'; pos = { r: S.layout(mode).length - 1, c: 0, col: 0 }; buildKeys(); }
    }

    /* ---------- Anfrage + Ergebnisse ---------- */
    function full() { return q + (t9.active() ? t9.pending() : ''); }
    function run() {
      var qq = S.query(full());
      if (task) { task.abort(); task = null; }
      if (!qq) { showEmpty(); return; }
      if (inspTask) { inspTask.abort(); inspTask = null; }   // Tippen: Inspiration gibt die Verbindungen fuer die Suche frei
      var c = cache.get(qq.toLowerCase());
      if (c) { showGroups(c, qq); return; }
      showState(N.t(D ? 'disc.running' : 'search.running'), D ? N.t('disc.running.text') : '', '');
      if (D) {
        var hc = N.session.homeCache();
        task = N.disc.search(qq, hc && hc.libs || N.ui.rail.libs || [], kinds(),   // ohne Home-Cache: Bibliotheken der Seitenleiste
           function (gs, info) {
          task = null;
          if (dead) return;
          if (info.local === 'fail' && (info.ext === 'fail' || info.ext === 'none')) { showState(N.t('err.server.title'), N.t('lib.err.text', { server: N.session.state.server && N.session.state.server.name || '' }), ''); return; }
          if (info.cache) cache.set(qq.toLowerCase(), gs);          // unvollstaendig (Zeitlimit, Rechte) -> beim naechsten Mal neu fragen
          if (S.query(full()) !== qq) return;
          if (info.ext === 'fail' && gs.length) N.ui.toast.show(N.t('toast.discExt'), { icon: 'info' });
          showGroups(gs, qq, info.ext === 'fail' || info.ext === 'none' ? 'disc.extFail.text' : '');
        });
        return;
      }
      task = N.plex.get('/hubs/search', { query: qq, limit: 10, includeCollections: 1, excludeElements: N.hubs.EXCL }, { timeout: 10000 }, function (err, d) {
        task = null;
        if (dead) return;
        if (err) { showState(N.t('err.server.title'), N.t('lib.err.text', { server: N.session.state.server && N.session.state.server.name || '' }), ''); return; }
        var gs = S.group(d, kinds());
        cache.set(qq.toLowerCase(), gs);
        if (S.query(full()) === qq) showGroups(gs, qq);
      });
    }
    function kinds() { var hc = N.session.homeCache(); return N.hubs.libKinds(hc && (hc.alibs || hc.libs) || []); }
    function showState(t, x, tip) {
      clearRows(); U.show(recentEl, false);
      U.setText(stateT, t); U.setText(stateX, x); U.setText(tipT, tip);
    }
    function clearRows() { if (zone === 'res' || zone === 'recent') toKbd(); for (var i = 0; i < slots.length; i++) { slots[i].clear(); slots[i].setVisible(false); slotGroup[i] = -1; } groups = []; colMem = {}; pendingEmpty = false; }   // Ziffern-Eingabe aus "Zuletzt gesucht": Fokus nicht auf versteckter Liste lassen
    /* Leerer Zustand: Zuletzt gesucht + Vorschlaege */
    function showEmpty() {
      shownQ = null;
      showState('', '', '');
      var rec = S.recent(PFX);
      U.show(recentEl, rec.length > 0);
      for (var i = 0; i < S.MAX_RECENT; i++) { U.show(recentEls[i], !!rec[i]); U.setText(recentEls[i].firstChild, rec[i] || ''); }
      if (D) { discEmpty(rec); return; }
      sugg = S.suggestions(N.session.homeCache());
      if (sugg.length) {
        var y = rec.length ? HEAD_Y + 52 + rec.length * 44 + 16 : HEAD_Y;
        groups = [{ id: 'sugg', tk: 'search.suggestions', kind: 'posterQ', items: sugg }];
        layout([rec.length ? y : HEAD_Y]);
      }
    }
    /* Entdecken leer: unter "Zuletzt gesucht" die Merkliste (nur mit Helfer) und die Inspirations-Reihen (N.insp). Jede Reihe
     * erscheint, sobald sie da ist (Idle-Queue); bekannte Reihen sofort aus dem Speicher. Ohne Reihen und ohne Verlauf: Text. */
    function discEmpty(rec) {
      emptyY = rec.length ? HEAD_Y + 52 + rec.length * 44 + 16 : HEAD_Y;
      emptyRec = rec.length;
      wlGroup = null;
      startInsp();
      if (N.disc.helper()) N.disc.probeHelper(function () { if (!dead && shownQ === null && !S.query(full()) && N.insp.helperOn()) startInsp(); });
      if (!N.disc.watchlistOn()) return;
      if (wlTask) wlTask.abort();
      wlTask = N.disc.wl.listMarked(kinds(), function (err, items) {
        wlTask = null;
        if (dead) return;
        if (err) { if (err.helper === 'down') N.disc.downToast(); return; }   // "Helfer nicht erreichbar" (einmal je Ausfall)
        wlGroup = items.length ? { id: 'wl', tk: 'disc.group.watchlist', kind: 'posterQ', items: items } : null;
        N.idle.add(composeEmpty, 'disc-insp');
        /* optionale Erweiterung: Zustand je Karte der Merkliste nachtragen (z. B. Marke/Fortschritt einer Anfrage); sie ruft repaint()
         * im Leerlauf, dann werden nur die belegten Karten dieser Reihe neu beschriftet */
        if (wlGroup && N.ext.has('disc:wlrow')) {
          var grp = wlGroup;
          N.ext.call('disc:wlrow', grp.items, function () { if (!dead) N.idle.add(function () { if (!dead) refreshGroup(grp); }, 'disc-wlrow'); });
        }
      });
    }
    /* Rueckkehr mit geaenderter Merkliste und Fokus in den Reihen: die Reihen jetzt neu zusammensetzen (nicht erst, wenn der Fokus
     * die Reihen verlaesst); der Fokus bleibt auf derselben Reihe (per id), in der Merkliste auf derselben Spalte bzw. der naechsten */
    function wlRefocus() {
      var id = groups[g] && groups[g].id, gs = [], i;
      if (wlGroup) gs.push(wlGroup);
      xRows(gs);
      for (i = 0; i < inspIds.length; i++) { var r = inspRows[inspIds[i]]; if (r && r.items && (r.items.length || r.note)) gs.push(r); }
      if (!gs.length) { toKbd(); composeEmpty(); return; }
      var ng = -1;
      for (i = 0; i < gs.length; i++) if (gs[i].id === id) ng = i;
      if (ng < 0 || !gs[ng].items.length) ng = 0;
      if (hasSlot(g)) { colMem[groups[g].id] = slotOf(g).f; slotOf(g).setFocused(false); }
      zone = 'kbd';                                   // composeEmpty baut ohne Warten um ...
      composeEmpty();
      if (!canFocus(ng)) ng = nextG(-1, 1);
      if (ng < 0) { toKbd(); return; }
      toGroup(ng);                                    // ... und der Fokus kommt auf die (verschobene) Reihe zurueck
    }
    /* optionale Erweiterung (N.ext 'disc:rows'): eigene Reihen hinter der Merkliste (z. B. Titel, die bald kommen). Sie liefert
     * dieselben Gruppen-Objekte, solange sich nichts aendert, und ruft repaint() erst, wenn neue Daten da sind */
    function xRows(gs) {
      if (!N.ext.has('disc:rows')) return;
      var l = N.ext.call('disc:rows', function () { if (!dead) N.idle.add(composeEmpty, 'disc-insp'); }) || [];
      for (var i = 0; i < l.length; i++) if (l[i] && l[i].items && l[i].items.length) gs.push(l[i]);
    }
    function refreshGroup(grp) {
      for (var i = 0; i < groups.length; i++) if (groups[i] === grp && hasSlot(i)) {
        var sl = slotOf(i);
        for (var k in sl.byIdx) if (Object.prototype.hasOwnProperty.call(sl.byIdx, k)) sl.refreshItem(Number(k));
      }
    }
    function inspLibs() { var hc = N.session.homeCache(); return hc && hc.libs || N.ui.rail.libs || []; }
    function startInsp() {
      var libs = inspLibs(), st = N.session.settings, c = N.insp.cached(libs), need = [], i;
      inspIds = N.insp.enabled(st && st.inspRows || null, libs, N.session.hubCatalog(), N.insp.helperOn());
      for (i = 0; i < inspIds.length; i++) {
        var id = inspIds[i];
        if (c[id]) inspRows[id] = c[id].row;
        if (!c[id] || !c[id].fresh) need.push(id);
      }
      composeEmpty();
      if (!need.length || inspTask) return;
      inspTask = N.insp.load(need, libs, kinds(), function (id, row, err) {
        if (err && !row && inspRows[id]) return;          // Fehler: alte Reihe bleibt stehen
        inspRows[id] = row;
        N.idle.add(composeEmpty, 'disc-insp');
      }, function () { inspTask = null; });
    }
    /* leere Ansicht aus Merkliste + eingeschalteten Inspirations-Reihen zusammensetzen. Steht der Fokus in den Reihen und
     * wuerde sich oberhalb/an der fokussierten Reihe etwas aendern, wartet der Umbau bis der Fokus zurueck ist. */
    function composeEmpty() {
      if (dead || shownQ !== null || S.query(full())) return;
      var gs = [], i;
      if (wlGroup) gs.push(wlGroup);
      xRows(gs);
      for (i = 0; i < inspIds.length; i++) { var r = inspRows[inspIds[i]]; if (r && r.items && (r.items.length || r.note)) gs.push(r); }
      if (zone === 'res') {
        for (i = 0; i <= g; i++) if (gs[i] !== groups[i]) { pendingEmpty = true; return; }
      }
      pendingEmpty = false;
      var none = !emptyRec && !gs.length;
      U.setText(stateT, none ? N.t('disc.empty.title') : ''); U.setText(stateX, none ? N.t('disc.empty.text') : '');
      var y = emptyY, ys = [];
      for (i = 0; i < gs.length; i++) { ys.push(y); y += PITCH[gs[i].kind] || 316; }
      groups = gs; tops = ys;
      if (zone !== 'res') g = Math.min(g, Math.max(0, gs.length - 1));
      ensureWin(zone === 'res' ? g : 0);
      if (zone === 'res') placeRing(slotOf(g).ringPos());
    }
    function showGroups(gs, qq, noneKey) {   // noneKey: Entdecken ohne Suche ausserhalb (Fehler/keine Film-/Serienbibliothek) -> ehrlicher Satz
      shownQ = qq;
      if (!gs.length) { showState(N.t('empty.search.title', { q: qq }), N.t(noneKey || (D ? 'disc.none.text' : 'empty.search.text')), N.t(D ? 'disc.tip' : 'search.tip')); return; }
      showState('', '', '');
      groups = gs;
      var y = HEAD_Y, ys = [];
      for (var i = 0; i < gs.length; i++) { ys.push(y); y += PITCH[gs[i].kind] || 316; }
      layout(ys);
    }
    function layout(ys) {
      tops = ys; colMem = {};
      for (var i = 0; i < slots.length; i++) { slots[i].clear(); slots[i].setVisible(false); slotGroup[i] = -1; }
      g = Math.min(g, Math.max(0, groups.length - 1));
      ensureWin(0);
      setOff(0, true);
    }
    /* Slots fuer das Fenster um Gruppe c belegen (Gruppe i -> Slot i mod NS); unveraenderte Reihen werden nicht neu gebaut */
    function slotOf(i) { return slots[i % NS]; }
    function hasSlot(i) { return i >= 0 && slotGroup[i % NS] === i && !!groups[i]; }
    /* Fokus verlaesst die Reihen (Ansicht springt nach oben): oberes Fenster in der Idle-Queue belegen */
    function topWin() { if (g > 1) N.idle.add(function () { if (!dead && zone !== 'res') ensureWin(0); }, 'search-win'); }
    /* TV-Test 28.10. (Entdecken: ein Frame von 59–182 ms je ▼): die neu ins Fenster kommende Reihe wurde mit allen 11 Karten auf
     * einmal befuellt, und ihr Slot vorher erst geleert (11x display:none) und gleich wieder gezeigt. Jetzt wie die Startseite:
     * ein Slot, der im selben Durchgang eine neue Gruppe bekommt, wird nicht geleert (setModel verwendet die Karten weiter);
     * befuellt wird nur die fokussierte Reihe sofort, die angeschnittene darunter sichtbar sofort/Puffer im naechsten Frame
     * (mode 1), alle weiteren (verdeckt) in Haeppchen zu einer Karte je Frame (mode 2). */
    function ensureWin(c) {
      var lo = Math.max(0, c - 1), hi = Math.min(groups.length - 1, c + NS - 2), k, i;
      for (k = 0; k < NS; k++) {
        var gi = slotGroup[k], ni = lo + ((k - lo % NS) + NS) % NS;   // Gruppe, die dieser Slot im Fenster bekommt
        if (gi >= 0 && (gi < lo || gi > hi || !groups[gi])) {
          if (slots[k].model) colMem[slots[k].model.id] = slots[k].f;
          if (ni <= hi && groups[ni]) { slotGroup[k] = -1; continue; }   // wird gleich neu belegt: nicht leeren/verstecken
          slots[k].clear(); slots[k].setVisible(false); slotGroup[k] = -1;
        }
      }
      for (i = lo; i <= hi; i++) {
        var sl = slotOf(i);
        if (slotGroup[i % NS] !== i || sl.model !== groups[i]) {
          if (sl.model && slotGroup[i % NS] >= 0) colMem[sl.model.id] = sl.f;
          sl.focused = false;                         // recycelter Slot (nicht geleert): alter Fokus gilt nicht mehr
          sl.setModel(groups[i], colMem[groups[i].id] || 0, i === c ? 0 : i === c + 1 ? 1 : 2); slotGroup[i % NS] = i;
          if (zone === 'res' && i === g) sl.setFocused(true);
        }
        sl.setTop(tops[i]); sl.setVisible(true);
      }
    }
    function setOff(o, now) {
      if (o === off && !now) return;
      off = o;
      if (now) { resPg.style.webkitTransition = 'none'; U.tf(resPg, 0, -o); setTimeout(function () { resPg.style.webkitTransition = ''; }, 60); }
      else { N.fx.move(resPg); U.tf(resPg, 0, -o); }
    }

    /* ---------- Fokus ---------- */
    function placeRing(p) { if (p) ring.to(p.shape, p.x + RES_X, p.y - off); }
    function setKey(p) { U.cls(keys[pos.r][pos.c], 'is-focus', false); pos = p; U.cls(keys[pos.r][pos.c], 'is-focus', true); N.fx.move(keys[pos.r][pos.c]); }
    function toKbd() {
      if (zone === 'res' && hasSlot(g)) slotOf(g).setFocused(false);
      if (zone === 'recent') U.cls(recentEls[rf], 'is-focus', false);
      zone = 'kbd'; ring.hide(); setOff(0);
      U.cls(keys[pos.r][pos.c], 'is-focus', true);
      if (pendingEmpty) N.idle.add(composeEmpty, 'disc-insp');
      topWin();
      N.router.refreshHints();
    }
    function hasRecent() { return !shownQ && S.recent(PFX).length > 0 && recentEl.style.display !== 'none'; }
    function toResults() {
      if (hasRecent()) { toRecent(0); return; }
      var f = nextG(-1, 1);
      if (f >= 0) toGroup(f);
    }
    /* Hinweis-Reihen (kind 'note', keine Karten) sind nur Text: der Fokus springt darueber hinweg */
    function canFocus(i) { return !!(groups[i] && groups[i].items.length); }
    function nextG(from, dir) { for (var i = from + dir; i >= 0 && i < groups.length; i += dir) if (canFocus(i)) return i; return -1; }
    function toRecent(i) {
      if (zone === 'kbd') U.cls(keys[pos.r][pos.c], 'is-focus', false);
      if (zone === 'res' && hasSlot(g)) slotOf(g).setFocused(false);
      if (zone === 'recent') U.cls(recentEls[rf], 'is-focus', false);
      zone = 'recent'; rf = i; ring.hide(); setOff(0);
      U.cls(recentEls[rf], 'is-focus', true);
      if (pendingEmpty) N.idle.add(composeEmpty, 'disc-insp');
      topWin();
      N.router.refreshHints();
    }
    function toGroup(i) {
      if (!groups[i]) return;
      if (zone === 'kbd') U.cls(keys[pos.r][pos.c], 'is-focus', false);
      if (zone === 'recent') U.cls(recentEls[rf], 'is-focus', false);
      if (zone === 'res' && hasSlot(g)) slotOf(g).setFocused(false);
      if (!hasSlot(i)) ensureWin(i);                  // Sprung ausserhalb des Fensters (selten): sofort belegen
      zone = 'res'; g = i;
      setOff(Math.max(0, tops[i] - HEAD_Y));
      slotOf(g).setFocused(true); slotOf(g).boost();
      placeRing(slotOf(g).ringPos());
      N.idle.add(function () { N.router.refreshHints(); }, 'search-hints');
      N.idle.add(function () { if (!dead && zone === 'res') ensureWin(g); }, 'search-win');
    }
    function curItem() { return zone === 'res' && hasSlot(g) ? slotOf(g).item(slotOf(g).f) : null; }
    function open(it, how) {
      if (!it) return;
      if (shownQ) S.remember(shownQ, PFX);
      if (it.ext) { N.router.push('extdetails', { it: it }); return; }
      if (it.type === 'person') { N.router.push('library', { lib: libOf(it.lib), actor: { id: it.id, t: it.title, key: it.filter } }); return; }
      if (it.type === 'collection') { N.router.push('library', { lib: libOf(it.lib), coll: { rk: it.rk, title: it.title } }); return; }
      if (how) { N.details.play(it, how); return; }
      N.details.open(it);
    }
    function libOf(id) {
      var hc = N.session.homeCache(), libs = hc && hc.libs || [];
      for (var i = 0; i < libs.length; i++) if (libs[i].id === id) return libs[i];
      return libs[0] || { id: id, title: '', type: 'movie' };
    }

    /* ---------- Hinweisleiste ---------- */
    s.hints = function () {
      var list = [{ k: 'red', t: 'hint.clearAll' }, { k: 'DIGITS', t: 'hint.type' }], it = curItem();
      if (it && M.isVideo(it) && !it.ext) list.push({ k: 'yellow', t: M.watched(it) ? 'hint.markUnwatched' : 'hint.markWatched' });
      return list;
    };

    /* ---------- Lebenszyklus ---------- */
    s.enter = function (p) {
      dead = false;
      if (p && p.q && !q && shownQ === null) { q = String(p.q).slice(0, 60); changed(); }   // Messlauf (P7): Suchbegriff vorgeben
      if (shownQ === null && !q) {
        if (D && zone === 'res' && groups.length) { if (wlDirty) wlRefocus(); startInsp(); }   // zurueck aus einer Detailseite: Fokus in den Reihen bleibt, Reihen nur auffrischen
        else showEmpty();
        wlDirty = false;
      }
      if (zone === 'kbd') U.cls(keys[pos.r][pos.c], 'is-focus', true);
      else if (zone === 'res' && hasSlot(g)) { slotOf(g).refreshItem(slotOf(g).f); placeRing(slotOf(g).ringPos()); }
      N.router.refreshHints();
    };
    s.leave = function () { if (t9T) { clearTimeout(t9T); t9T = 0; commitT9(); paintField(); } return null; };
    s.destroy = function () {
      dead = true;
      if (task) task.abort();
      if (wlTask) wlTask.abort();
      if (inspTask) inspTask.abort();
      if (onWl) N.evt.off('watchlist:changed', onWl);
      if (reqT) clearTimeout(reqT); if (t9T) clearTimeout(t9T);
      for (var i = 0; i < slots.length; i++) slots[i].clear();
    };
    s.railBlur = function () { ring.hide(); if (zone === 'kbd') U.cls(keys[pos.r][pos.c], 'is-focus', false); };
    s.railFocus = function () { if (zone === 'kbd') U.cls(keys[pos.r][pos.c], 'is-focus', true); };
    s.railReturnHome = true;

    s.onKey = function (k) {
      if (N.keys.isDigit(k)) { digit(k); return true; }
      if (k === 'RED') { clearAll(); return true; }
      if (zone === 'kbd') {
        var p;
        switch (k) {
          case 'LEFT': p = S.move(rows, pos, 'LEFT'); if (p) setKey(p); else N.ui.rail.open(); return true;
          case 'RIGHT': p = S.move(rows, pos, 'RIGHT'); if (p) setKey(p); else toResults(); return true;
          case 'UP': case 'DOWN': p = S.move(rows, pos, k); if (p) setKey(p); return true;
          case 'ENTER': keyAct(rows[pos.r][pos.c]); return true;
          case 'TOOLS': clearAll(); return true;
          case 'RETURN': N.ui.rail.open(); return true;
        }
        return true;
      }
      if (zone === 'recent') {
        var rec = S.recent(PFX);
        switch (k) {
          case 'UP': if (rf > 0) toRecent(rf - 1); return true;
          case 'DOWN': if (rf < rec.length - 1) toRecent(rf + 1); else if (nextG(-1, 1) >= 0) toGroup(nextG(-1, 1)); return true;
          case 'LEFT': case 'RETURN': toKbd(); return true;
          case 'ENTER': commitT9(); q = rec[rf] || ''; toKbd(); changed(); return true;
        }
        return true;
      }
      var R = slotOf(g), it = curItem();
      switch (k) {
        case 'LEFT': if (R.f > 0) placeRing(R.focusCol(R.f - 1)); else toKbd(); N.idle.add(function () { N.router.refreshHints(); }, 'search-hints'); return true;
        case 'RIGHT': if (R.f < R.count() - 1) placeRing(R.focusCol(R.f + 1)); N.idle.add(function () { N.router.refreshHints(); }, 'search-hints'); return true;
        case 'UP': if (nextG(g, -1) >= 0) toGroup(nextG(g, -1)); else if (hasRecent()) toRecent(S.recent(PFX).length - 1); return true;
        case 'DOWN': if (nextG(g, 1) >= 0) toGroup(nextG(g, 1)); return true;
        case 'ENTER': case 'INFO': open(it); return true;
        case 'PLAY': if (it && M.isVideo(it) && !it.ext) open(it, 'resume'); return true;
        case 'YELLOW':
          if (it && M.isVideo(it) && !it.ext) N.watch.toggle(it, { changed: function () { R.refreshItem(R.f); N.router.refreshHints(); }, reverted: function () { R.refreshItem(R.f); N.router.refreshHints(); } });
          return true;
        case 'RETURN': toKbd(); return true;
      }
      return true;
    };

    /* ---------- Zeiger ---------- */
    s.pointer = function (x, y, kind) {
      var p = S.hitKey(rows, x, y);
      if (p) {
        if (zone !== 'kbd') toKbd();
        if (p.r !== pos.r || p.c !== pos.c) setKey(p);
        if (kind === 'click') keyAct(rows[p.r][p.c]);
        return true;
      }
      if (x < 560) return false;
      if (hasRecent() && y >= HEAD_Y + 52 && y < HEAD_Y + 52 + S.recent(PFX).length * 44) {
        var i = Math.floor((y - HEAD_Y - 52) / 44);
        if (zone !== 'recent' || i !== rf) toRecent(i);
        if (kind === 'click') { commitT9(); q = S.recent(PFX)[i] || ''; toKbd(); changed(); }
        return true;
      }
      for (var gi = 0; gi < groups.length; gi++) {
        if (!hasSlot(gi)) continue;
        var R = slotOf(gi), cy = tops[gi] + 52 - off;
        if (y >= cy && y < cy + R.g.h && y < 632) {
          var h = R.hit(x - RES_X);
          if (h < 0) return false;
          if (zone !== 'res' || g !== gi) toGroup(gi);
          if (h !== R.f) placeRing(R.hoverCol(h));
          if (kind === 'click') open(R.item(h));
          return true;
        }
      }
      return false;
    };
    s.pointerSig = function () { return off; };             // Zeiger-Scroll-Sperre (N.pointer)
    s.relabel = function () { buildKeys(); U.setText(recentHeadT, N.t('search.recent')); for (var i = 0; i < slots.length; i++) if (slots[i].model) slots[i].relabel(); };
    return s;
  }; }
  N.router.define('search', view('search'));
  N.router.define('discover', view('discover'));
})(N);
