/* Ansicht 'home' – Startseite (SPEC 5.6, 6.1–6.3, 7.3, 15; Mockup home.html).
 * - Erster Inhalt aus cache-home-<uid>.json, danach stiller Netz-Refresh (fokussierte Reihe wird nie umgebaut, 6.3.3).
 * - Max. 4 Reihen im DOM (vorherige, aktuelle, naechste, uebernaechste): Slot = Reihenindex mod 4, Recycling in der Idle-Queue.
 * - Fokus-Anker: Kartenoberkante der fokussierten Reihe immer y = 372; Seiten-Container per translate3d.
 * - Hero folgt dem Fokus nach 300 ms Ruhe; Staffelstreifen (abschaltbar) fuer angefangene Serien.
 * - Farbtasten (6.1): Rot Ausblenden (nur Weiterschauen, lokal + 6 s Rueckgaengig), Gelb Gesehen/Ungesehen, Blau Suche. */
(function (N) {
  var U = N.util, M = N.model, H = N.hubs, RM = N.RowMath;
  var HEAD_Y = 320, CARD_Y = 372, SLOTS = 4, HERO_REST = 300, TTL = 60000;
  /* Rueckkehr aus dem Player: erst nach PLAY_SETTLE laden (Timeline "stopped" ist dann beim PMS), fehlt der Titel noch in
   * Weiterschauen, die Antwort NICHT anwenden (nichts verschwindet) und nach PLAY_RETRY erneut fragen; danach gilt der Server */
  var PLAY_SETTLE = 1500, PLAY_RETRY = [2500, 5000];
  var PITCH = { land: 288, poster: 360, sq: 280 };   // sq: Musik/Hoerbuecher (quadratisch, M4)

  N.router.define('home', function () {
    var s = { rail: 'home', railReturnExits: true, wheelKeys: ['LEFT', 'RIGHT'] };
    var root, pg, ring, hero, sb, fade, cue, cueT, cueOn = false, slots = [], rows = [], tops = [], colMem = {}, R = 0;
    var slotRow = [-1, -1, -1, -1], heroT = 0, task = null, loadedAt = 0, pending = null, interacted = false;
    var undo = null, hideCommit = null, retryT = 0, retryN = 0, offline = false, pingT = 0, railOpen = false;
    var seasonCache = new N.LRU(10), stripTask = null, drawn = false;
    var skel = null, away = false, parked = null, resume = false, prepRaf = false, dead = false, onFlush = null, onSet = null, onBack = null, onPlayed = null, onScanned = null, onAnime = null, cfgDirty = false;
    var played = null, playT = 0, cueDisp = false;                     // {rk, n}: gerade gestoppter Film/Folge, auf den Weiterschauen warten soll

    /* ---------- Aufbau ---------- */
    s.create = function (el) {
      root = el;
      hero = new N.ui.Hero(root);
      pg = U.el('div', 'pg', root);
      for (var i = 0; i < SLOTS; i++) slots.push(new N.ui.Row(pg, { captions: function (kind) { return kind === 'land'; } }));
      fade = U.el('img', 'fade', root); fade.src = N.assetBase + 'fade-bottom.png';
      // HOME-11: fester "darunter geht es weiter"-Hinweis unten links (Glyphe wie .more-dn + Titel der naechsten Reihe), nur wenn
      // deren Kopf nicht im Bild ist (hohe Posterreihe); zeigen/klicken = eine Reihe tiefer. Runde 6: dauerhafte GPU-Ebene (.hmore
      // translate3d), Zeigen/Verbergen per visibility – siehe markMore
      cue = U.el('div', 'hmore', root, 'visibility:hidden');
      U.el('span', 'more-dn', cue).appendChild(document.createTextNode('›'));
      cueT = U.txt('span', 'ht', cue, '');
      ring = new N.ui.Ring(root);
      ring.prep(['poster', 'sq']);                    // Runde 7: je Form ein Ring – Formwechsel Querformat <-> Poster ohne Groessenaenderung
      sb = new N.ui.StateBlock(root);
      onFlush = function () { if (hideCommit) hideCommit.run(); };
      N.evt.on('app:flush', onFlush);                 // EXIT-Taste: ausstehendes Ausblenden sofort senden (L8)
      onSet = function (e) { if (e && e.key === 'homeRows') cfgDirty = true; if (e && /^anime/.test(e.key) && hero) hero.paintOv(); };
      onAnime = function () { if (hero) hero.paintOv(); };
      N.evt.on('anime:changed', onAnime);             // "Als Anime behandeln" (TOOLS): Ueberzeile sofort anpassen
      N.evt.on('settings:changed', onSet);            // "Startseite anpassen": beim naechsten Betreten neu ordnen + laden
      onBack = function () { if (!away && !dead && rows.length && !sb.on) heroBack(); };
      N.evt.on('overlay:closed', onBack);             // Hero nach Dialog/Menue/Bildschirmtastatur immer wiederherstellen
      N.evt.on('app:refocus', onBack);
      onPlayed = function (e) {
        loadedAt = 0; interacted = false;
        parked = null;                                // Antwort von vor/waehrend der Wiedergabe: veraltet
        if (task) { task.abort(); task = null; }
        if (playT) { clearTimeout(playT); playT = 0; }
        played = e && e.video && e.rk && !e.done && !e.srv ? { rk: e.rk, n: 0, wait: true } : null;
      };
      N.evt.on('playback:stopped', onPlayed);         // Rueckkehr aus dem Player: Weiterschauen neu laden (SPEC 6.3.2)
      onScanned = function () { loadedAt = 0; if (!away && !dead) refresh(); };
      N.evt.on('library:scanned', onScanned);         // "Mediathek aktualisieren" fertig: still neu laden
    };
    /* Hero passend zum Fokus: anderes Element -> neu setzen; gleiches -> Bild auffrischen */
    function heroBack() {
      var it = curItem();
      if (it !== hero.item) scheduleHero(0); else hero.refresh();
    }
    function cfg() { var st = N.session.settings; return st && st.homeRows || null; }
    function order() { return H.order(cfg(), s.libs || [], s.alibs || s.libs || []); }
    /* Server-Titel der Playlists-Reihe aus dem Hub-Katalog (nur in der aktuellen Sprache, sonst eigener Text) */
    function plTitle() { var c = N.session.hubCatalog(); return c && c.lang === N.i18n.lang() && c.pl ? c.pl.title : ''; }
    /* Katalog mit frischen Hub-Listen der geladenen Bibliotheken aktualisieren (Titel in der App-Sprache) */
    function updateCatalog(hubCat) {
      var c = N.session.hubCatalog(), libsDone = [], k, i;
      for (k in hubCat) libsDone.push(Number(k));
      if (!libsDone.length || !c || c.lang !== N.i18n.lang()) return;
      var hubs = [];
      for (i = 0; i < (c.hubs || []).length; i++) if (libsDone.indexOf(c.hubs[i].lib) < 0) hubs.push(c.hubs[i]);
      for (k in hubCat) hubs = hubs.concat(hubCat[k]);
      c.hubs = N.homeRows.sortCatalog(hubs, c.alibs || []);
      N.session.setHubCatalog(c);
    }
    /* Lade-Skelett (SPEC 9: nie ein leerer Bildschirm): statische Platzhalter, ohne Animation */
    function showSkel(on) {
      if (!on) { if (skel) U.show(skel, false); return; }
      if (!skel) {
        skel = U.el('div', 'skel', root);
        U.el('i', '', skel, 'left:144px;top:96px;width:200px;height:20px');
        U.el('i', '', skel, 'left:144px;top:136px;width:420px;height:40px');
        U.el('i', '', skel, 'left:144px;top:196px;width:300px;height:20px');
        U.el('i', '', skel, 'left:144px;top:' + HEAD_Y + 'px;width:240px;height:28px');
        for (var i = 0; i < 4; i++) U.el('i', '', skel, 'left:' + (144 + i * 312) + 'px;top:' + CARD_Y + 'px;width:288px;height:162px');
        U.el('i', '', skel, 'left:144px;top:' + (HEAD_Y + PITCH.land) + 'px;width:240px;height:28px');
      }
      U.show(skel, true);
    }
    function layoutTops() {
      tops = []; var y = HEAD_Y;
      for (var i = 0; i < rows.length; i++) { tops.push(y); y += PITCH[rows[i].kind] || 360; }
    }
    function slotFor(r) { return slots[r % SLOTS]; }
    /* Reihe r in ihren Slot bringen (falls dort noch eine andere liegt). lazy (P7 27.10.): verdeckte Reihe in rAF-Haeppchen fuellen;
     * sonst sind die sichtbaren Karten danach sicher da (auch wenn ein Haeppchen-Fuellen noch laeuft) */
    function ensure(r, prio, lazy) {
      if (r < 0 || r >= rows.length) return;
      var k = r % SLOTS, sl = slots[k];
      if (slotRow[k] !== r) { sl.setModel(rows[r], colMem[r] || 0, lazy ? 2 : 0); slotRow[k] = r; }
      else if (!lazy && sl.pend) sl.render(1, 1);
      sl.setTop(tops[r]);
      sl.setVisible(r >= R);
      if (prio === 0) sl.boost();
      markMore();
    }
    /* Hinweis "darunter geht es weiter" (HOME-11): nur am Kopf der angeschnittenen naechsten Reihe; an der letzten Reihe keiner.
     * Je Slot nur ein display-Wechsel, wenn er sich aendert (kein Messen im Fokusschritt).
     * Runde 6 (TV 9,8,6: die langen Frames @U32+0 79 ms / @D33+0 54 ms mit nur ~4 ms JS lagen genau bei den Wechseln Querformat <->
     * Poster = wenn der feste Hinweis unten erscheint/verschwindet): .hmore liegt ueber der Seiten-Ebene und wurde deshalb bei jedem
     * display-Wechsel als GPU-Ebene neu angelegt bzw. verworfen (Ebenenbaum neu, Flaeche in der Wurzel-Ebene neu malen – dort liegen
     * Hero-Bild + Scrim ohne eigene Ebene). Jetzt dauerhafte Ebene, Wechsel nur per visibility (malt nur die kleine Ebene).
     * cueDisp = Gegenprobe des Messlaufs (hvar-cue0: alter display-Wechsel ohne Ebene). */
    function markMore() {
      for (var k = 0; k < SLOTS; k++) slots[k].setMore(slotRow[k] >= 0 && slotRow[k] === R + 1);
      var on = !sb.on && R + 1 < rows.length && nextZone().cue;     // Kopf der naechsten Reihe nicht im Bild: fester Hinweis unten
      if (on) U.setText(cueT, H.rowTitle(rows[R + 1]));
      if (on !== cueOn) { cueOn = on; if (cueDisp) U.show(cue, on); else U.vis(cue, on); }
    }
    /* Zeiger-Zone "naechste Reihe" (RowMath.nextZone): ab ihrem Kopf, sonst ab der Unterkante der Fokus-Karten */
    function nextZone() { return RM.nextZone(tops[R + 1] - pageY(), CARD_Y + slotFor(R).g.h); }
    function recycleLater() {
      N.idle.add(function () {
        for (var r = R - 1; r <= R + 2; r++) ensure(r, r === R ? 0 : 2, r > R + 1 || r < R);
        for (var k = 0; k < SLOTS; k++) { var rr = slotRow[k]; if (rr >= 0 && (rr < R - 1 || rr > R + 2 || rr >= rows.length)) { slots[k].clear(); slotRow[k] = -1; } }
        markMore();
      }, 'home-recycle');
    }
    function pageY() { return rows.length ? tops[R] - HEAD_Y : 0; }
    function jumpPage() {
      pg.style.webkitTransition = 'none'; U.tf(pg, 0, -pageY());
      setTimeout(function () { pg.style.webkitTransition = ''; }, 60);
    }
    /* komplettes Neuzeichnen (Cache-Start, Layout-Aenderung, Profil/Sprache) */
    function renderAll() {
      showSkel(false);
      layoutTops();
      for (var k = 0; k < SLOTS; k++) { slots[k].clear(); slotRow[k] = -1; }
      markMore();
      if (!rows.length) { ring.hide(); hero.clear(); showEmpty(); return; }
      sb.hide();
      R = U.clamp(R, 0, rows.length - 1);
      for (var r = R - 1; r <= R + 2; r++) ensure(r, r === R ? 0 : 1, r > R + 1 || r < R);
      jumpPage();
      var sl = slotFor(R);
      sl.setFocused(true);
      placeRing(sl.ringPos(), true);
      scheduleHero(0);
      N.idle.add(updateHints, 'home-hints');
      N.idle.add(warm, 'home-warm');
      N.idle.add(extNear, 'home-ext');
    }
    function placeRing(p) {
      if (rows[R] && !rows[R].items.length) { ring.hide(); return; }   // Hinweis-Reihe einer Erweiterung ("Wird geladen …"): keine Karte
      if (p && !railOpen && !sb.on) ring.to(p.shape, p.x, CARD_Y);
    }
    function curItem() { var sl = slotFor(R); return rows.length ? sl.item(sl.f) : null; }

    /* ---------- Hero (300 ms Ruhe) + Staffelstreifen ---------- */
    function scheduleHero(delay) {
      if (heroT) clearTimeout(heroT);
      heroT = setTimeout(function () {
        heroT = 0;
        var rest = N.idle.restFor();
        if (rest < HERO_REST) { scheduleHero(HERO_REST - rest); return; }
        var it = curItem();
        if (it === hero.item || (!it && rows[R] && rows[R].note)) return;   // Hinweis-Reihe: Hero bleibt stehen
        var stripOn = !!(N.session.settings && N.session.settings.episodeProgress);
        hero.set(it, { stripEnabled: stripOn });
        if (it && it.type === 'episode' && stripOn && it.seasonRk) loadStrip(it);
      }, delay === undefined ? HERO_REST : delay);
    }
    function stripLayout(it, data) {
      return N.SeasonStrip.layout({ enabled: true, size: 'L', episodes: data.eps, total: data.total, viewed: data.viewed, next: it.e, threshold: N.config.watchedThreshold });
    }
    function loadStrip(it) {
      var key = it.seasonRk, c = seasonCache.get(key);
      if (c && U.now() - c.ts < 300000) { hero.setStrip(stripLayout(it, c)); return; }
      if (stripTask) stripTask.abort();
      stripTask = N.plex.get('/library/metadata/' + key + '/children', { 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 31,
        excludeElements: H.EXCL, excludeFields: 'summary' }, null, function (err, d) {
        stripTask = null;
        if (err || !d || !d.MediaContainer) return;
        var mc = d.MediaContainer, list = mc.Metadata || [], eps = [], total = Number(mc.totalSize || mc.size || list.length);
        for (var i = 0; i < list.length; i++) eps.push({ index: Number(list[i].index) || i + 1, vc: Number(list[i].viewCount) || 0, off: Number(list[i].viewOffset) || 0, dur: Number(list[i].duration) || 0 });
        function done(data) { seasonCache.set(key, data); if (hero.item === it) hero.setStrip(stripLayout(it, data)); }
        if (total <= N.SeasonStrip.MAX_CELLS) { done({ eps: eps, total: total, viewed: 0, ts: U.now() }); return; }
        // Modus B: Balken aus leafCount/viewedLeafCount der Staffel (keine 1100 Folgen laden)
        stripTask = N.plex.get('/library/metadata/' + key, { excludeElements: H.EXCL, excludeFields: 'summary' }, null, function (e2, d2) {
          stripTask = null;
          var m = !e2 && d2 && d2.MediaContainer && d2.MediaContainer.Metadata && d2.MediaContainer.Metadata[0];
          if (!m) return;
          done({ eps: null, total: Number(m.leafCount) || total, viewed: Number(m.viewedLeafCount) || 0, ts: U.now() });
        });
      });
    }

    /* ---------- Hinweisleiste (Kontextwechsel, Idle-Queue) ---------- */
    function updateHints() { N.router.refreshHints(); }
    s.hints = function () {
      if (sb.on) return sb.ids.length ? [{ k: 'ret', t: 'hint.exit' }] : [{ k: 'blue', t: 'hint.search' }, { k: 'ret', t: 'hint.exit' }];
      if (!rows.length) return [{ k: 'blue', t: 'hint.search' }];      // Lade-Skelett: keine Karten-Aktionen
      var it = curItem(), list = [];
      if (it && it.ext) return [{ k: 'OK', t: 'hint.details' }, { k: 'blue', t: 'hint.search' }];   // Erweiterungs-Karte: nur Details
      if (!it && rows[R] && rows[R].note) return [{ k: 'blue', t: 'hint.search' }];   // Hinweis-Reihe ohne Karten
      if (rows[R] && rows[R].id === 'cw') list.push({ k: 'red', t: 'hint.hide' });
      if (M.isVideo(it)) list.push({ k: 'yellow', t: M.watched(it) ? 'hint.markUnwatched' : 'hint.markWatched' });
      list.push({ k: 'blue', t: 'hint.search' });
      list.push({ k: 'INFO', t: 'hint.details' });
      if (list.length < 5) list.push({ k: 'TOOLS', t: 'hint.options' });
      return list;
    };

    /* ---------- Fokus-Schritte ---------- */
    function afterMove() { scheduleHero(); N.idle.add(updateHints, 'home-hints'); N.idle.add(warm, 'home-warm'); N.idle.add(extNear, 'home-ext'); }
    /* Reihen einer optionalen Erweiterung (N.hubs.extRow): erst laden, wenn sie in die Naehe kommen (R-1 … R+2), immer aus der
     * Idle-Queue (nie im Fokusschritt); naht der Fokus dem Ende einer geladenen Reihe, die mehr hat, die naechste Seite holen. */
    function extNear() {
      if (dead || away || !rows.length || !N.ext.has('home:want')) return;
      for (var r = Math.max(0, R - 1); r <= R + 2 && r < rows.length; r++) {
        var row = rows[r];
        if (row.ext && row.want) N.ext.call('home:want', row.id, gotExt);
      }
      var cur = rows[R], sl = slotFor(R);
      if (cur && cur.ext && cur.more && sl.model === cur && sl.f >= cur.items.length - 6) N.ext.call('home:more', cur.id, function (id) { grewExt(id); });
    }
    /* geladene Erweiterungs-Reihe an die Stelle ihres Platzhalters (gleiche Hoehe: nichts springt) */
    function gotExt(row) {
      if (dead || !row) return;
      var r = -1, i;
      for (i = 0; i < rows.length; i++) if (rows[i].id === row.id) r = i;
      if (r < 0 || rows[r] === row) return;
      if (rows[r].kind !== row.kind) row.kind = rows[r].kind;   // Hoehe bleibt (layoutTops)
      rows[r] = row;
      var k = r % SLOTS;
      if (slotRow[k] === r) {
        slots[k].setModel(row, colMem[r] || 0, r === R ? 0 : 2); slots[k].setTop(tops[r]); slots[k].setVisible(r >= R);
        if (r === R && !away) { slots[k].setFocused(true); placeRing(slots[k].ringPos()); scheduleHero(0); N.idle.add(updateHints, 'home-hints'); }
      }
      markMore();
    }
    /* weitere Seite einer Erweiterungs-Reihe: die Erweiterung hat ihr Modell schon verlaengert -> Fenster neu herstellen */
    function grewExt(id) {
      if (dead) return;
      for (var k = 0; k < SLOTS; k++) { var r = slotRow[k]; if (r >= 0 && rows[r] && rows[r].id === id) slots[k].render(2, 2); }
      if (N.pointer && N.pointer.syncArrows) N.pointer.syncArrows();
    }
    /* Vorab-Dekodieren (Runde 5, N.img.warm): Der TV malt Karten-Ebenen unter dem Bildschirmrand bzw. rechts ausserhalb des Clips
     * erst, wenn sie hereinkommen – samt Dekodieren ihrer Bilder im Frame nach ▼/▶ (56–75 ms ohne DOM-Aenderung). In Ruhe: sichtbare
     * Spalten von R+1 und R+2 (kommen mit ▼ herein) und die naechsten Karten rechts/links in R (kommen mit ▶/◀). */
    function warm() {
      if (dead || away || !rows.length) return;
      var out = [], sl, k;
      for (var r = R; r <= R + 2; r++) {
        k = r % SLOTS; sl = slots[k];
        if (r >= rows.length || slotRow[k] !== r) continue;
        if (r === R) { sl.urls(sl.sc + sl.g.visible, sl.sc + sl.g.visible + 1, out); sl.urls(sl.sc - 1, sl.sc - 1, out); }
        else sl.urls(sl.sc, sl.sc + sl.g.visible - 1, out);
      }
      N.img.warm(out);
    }
    function moveCol(f) {
      var sl = slotFor(R), p = sl.focusCol(f);
      placeRing(p); afterMove();
    }
    function moveRow(r, f) {
      if (r < 0 || r >= rows.length || r === R) return;
      var old = slotFor(R);
      colMem[R] = old.f;
      old.setFocused(false);
      var down = r > R;
      R = r;
      ensure(R, 0);                                   // meist schon da (Fenster R-1 … R+2)
      ensure(R + 1, 1);                               // angeschnittene naechste Reihe muss sofort stimmen
      if (down) slots[(R - 1 + SLOTS) % SLOTS].setVisible(false); else slotFor(R).setVisible(true);
      markMore();
      var sl = slotFor(R);
      if (f !== undefined) sl.f = f;
      sl.setFocused(true);
      N.fx.move(pg); U.tf(pg, 0, -pageY());
      placeRing(f !== undefined ? sl.hoverCol(f) : sl.ringPos());
      recycleLater();
      prepareSoon();
      afterMove();
    }
    /* Nachbarreihen (R-1 … R+2) einen Frame nach dem Schritt fuellen, nicht erst nach der Idle-Ruhe: bei Tastenwiederholung
     * (120–160 ms) waere R+1 sonst beim naechsten Schritt noch leer und wuerde IM Tastenhandler gebaut (M6) */
    function prepareSoon() {
      if (prepRaf) return;
      prepRaf = true;
      U.raf(function () {
        prepRaf = false;
        if (dead || away || !rows.length) return;
        for (var r = R - 1; r <= R + 2; r++) ensure(r, r === R ? 0 : 2, r > R + 1 || r < R);
      });
    }
    function toTop() {
      if (R === 0) { moveCol(0); return; }
      colMem = {}; colMem[0] = 0;
      slotFor(R).setFocused(false);
      R = 0;
      renderAll();
    }

    /* ---------- Aktionen ---------- */
    function soon(area) { N.router.push('soon', { area: area }); }
    function openItem(it, play) {
      if (!it) return;
      if (it.ext) { if (!N.ext.call('home:open', it)) N.router.push('extdetails', { it: it, rail: 'home' }); return; }   // Titel ausserhalb des Servers (Erweiterungs-Reihe)
      if (N.music.isAudio(it)) { if (play && N.music.play(it)) return; if (N.music.open(it)) return; }   // M4 Musik/Hoerbuecher
      if (!M.isVideo(it)) { N.router.push('soon', { area: 'details', label: N.t('soon.music') }); return; }   // Musik/Hoerbuch/Playlist
      // OK auf Weiterschauen/Naechste Folgen und PLAY auf jeder Film-/Folgenkarte spielen ab (M3); sonst Details (M3b)
      if (M.isLeaf(it) && (play || rows[R].kind === 'land')) { N.player.play(it, play === true ? 'resume' : play || 'ask'); return; }
      if (play) { N.details.play(it, 'resume'); return; }          // PLAY auf Serie: naechste Folge (SPEC 7.3)
      N.details.open(it);
    }
    function scrobble(it, watched, cb) {
      N.plex.write('GET', watched ? '/:/scrobble' : '/:/unscrobble', { identifier: 'com.plexapp.plugins.library', key: it.rk }, cb);
    }
    function snapshot(it) { return { vc: it.vc, off: it.off, vleaf: it.vleaf }; }
    function restoreSnap(it, sn) { it.vc = sn.vc; it.off = sn.off; it.vleaf = sn.vleaf; }
    function applyWatched(it, w) {
      if (M.isLeaf(it)) { it.vc = w ? Math.max(1, it.vc) : 0; it.off = 0; } else it.vleaf = w ? it.leaf : 0;
    }
    function refreshAll(it) {
      for (var k = 0; k < SLOTS; k++) {
        var sl = slots[k];
        if (slotRow[k] < 0) continue;
        for (var i = 0; i < sl.count(); i++) if (sl.item(i).rk === it.rk) sl.refreshItem(i);
      }
      N.idle.add(updateHints, 'home-hints');
    }
    /* Gelb (SPEC 6.5): Film/Folge ohne Rueckfrage + Rueckgaengig; Serie/Staffel mit Bestaetigung (Fokus Abbrechen) */
    function toggleWatched() {
      var it = curItem();
      if (!M.isVideo(it) || it.ext) return;
      if (undo && undo.kind === 'watched' && U.now() < undo.until) { var u = undo; undo = null; N.ui.toast.hide(); u.revert(); return; }
      var w = !M.watched(it);
      if (it.type === 'show' || it.type === 'season') {
        var show = it.type === 'show', key = (w ? 'dlg.mark' : 'dlg.unmark') + (show ? 'Show' : 'Season');
        N.ui.dialog.open({ title: N.t(key + '.title'), text: N.t(key + '.text', { n: it.leaf, show: it.title, s: it.s }),
          buttons: [{ id: 'cancel', t: N.t('dlg.mark.cancel') }, { id: 'ok', t: N.t('dlg.mark.confirm') }], focus: 0,
          onSelect: function (id) { if (id === 'ok') doWatched(it, w); } });
        return;
      }
      doWatched(it, w);
    }
    function doWatched(it, w) {
      var sn = snapshot(it), row = rows[R], sl = slotFor(R), idx = sl.f;
      var leaves = row.kind === 'land' && w;        // aus Weiterschauen/Naechste Folgen verschwindet die Karte (6.3.1)
      applyWatched(it, w);
      if (leaves) removeCard(idx); else refreshAll(it);
      scrobble(it, w, function (err) {
        if (err) { restoreSnap(it, sn); if (leaves) reinsert(row, idx, it); else refreshAll(it); N.ui.toast.show(N.t('toast.actionFailed')); undo = null; }
      });
      N.ui.toast.show(N.t(w ? 'toast.markedWatched' : 'toast.markedUnwatched'), { undo: true, icon: 'confirm' });
      undo = { kind: 'watched', until: U.now() + 6000, revert: function () {
        restoreSnap(it, sn);
        if (leaves) reinsert(row, idx, it); else refreshAll(it);
        scrobble(it, !w, function () {});
        N.ui.toast.show(N.t('toast.undone'));
      } };
    }
    /* Rot "Ausblenden" (SPEC 7.3, UX-M7): nur lokal, Server erst nach 6 s */
    function hideCard() {
      if (!rows[R] || rows[R].id !== 'cw') return;
      if (undo && undo.kind === 'hide' && U.now() < undo.until) { var u = undo; undo = null; N.ui.toast.hide(); u.revert(); return; }
      if (hideCommit) hideCommit.run();
      var row = rows[R], sl = slotFor(R), idx = sl.f, it = sl.item(idx);
      if (!it) return;
      removeCard(idx);
      var who = N.plex.target();                     // Token jetzt festhalten: Commit kann erst nach dem Profilwechsel laufen
      var c = { done: false, t: 0, run: function () {
        if (c.done) return; c.done = true; clearTimeout(c.t); if (hideCommit === c) hideCommit = null;
        if (!who.base || !who.token) return;
        N.plex.write('PUT', '/actions/removeFromContinueWatching', { ratingKey: it.rk }, function (err) {
          if (err) N.diag.log('warn', 'removeFromContinueWatching failed ' + (err.status || err.type));
        }, who);
      } };
      c.t = setTimeout(c.run, 6000);
      hideCommit = c;
      N.ui.toast.show(N.t('toast.hidden'), { undo: true });
      undo = { kind: 'hide', until: U.now() + 6000, revert: function () {
        c.done = true; clearTimeout(c.t); if (hideCommit === c) hideCommit = null;
        reinsert(row, idx, it); N.ui.toast.show(N.t('toast.undone'));
      } };
    }
    /* Karte entfernen; Fokus: nachrueckende Karte, sonst vorherige, leere Reihe -> naechste bzw. vorherige Reihe (6.3.1) */
    function removeCard(idx) {
      var sl = slotFor(R), left = sl.removeAt(idx);
      if (left) { placeRing(sl.ringPos()); afterMove(); return; }
      rows.splice(R, 1);
      if (R >= rows.length) R = Math.max(0, rows.length - 1);
      colMem = {}; colMem[R] = 0;
      renderAll();
    }
    function reinsert(row, idx, it) {
      var r = rows.indexOf(row);
      if (r < 0) {                                   // Reihe war leer geworden -> wieder einsetzen
        row.items = [it];
        rows.splice(Math.min(row.id === 'cw' ? 0 : 1, rows.length), 0, row);
        r = rows.indexOf(row); slotFor(R).setFocused(false); R = r; colMem = {}; colMem[r] = 0; renderAll(); return;
      }
      if (r !== R) moveRow(r);
      var sl = slotFor(R);
      sl.insertAt(Math.min(idx, sl.count()), it);
      placeRing(sl.ringPos()); afterMove();
    }
    /* "Version wählen" (SPEC 7.6/7.12): Dateien vom Server holen (nur GET), Wahl gilt in dieser Sitzung, dann abspielen */
    function chooseVersion(it) {
      N.plex.get('/library/metadata/' + it.rk, { excludeElements: H.EXCL }, { timeout: 12000 }, function (err, d) {
        var m = !err && d && d.MediaContainer && d.MediaContainer.Metadata && d.MediaContainer.Metadata[0];
        if (!m || !m.Media || !m.Media.length || N.router.top() !== s || N.router.hasOverlay()) { if (err) N.ui.toast.show(N.t('err.server.title'), { icon: 'info' }); return; }
        var vs = N.versions.list(m.Media), e = [], lim = (N.decision.QUAL[N.session.settings.quality] || N.decision.QUAL['12'])[0];
        for (var i = 0; i < vs.length; i++) e.push({ id: String(i), t: vs[i].label, s: vs[i].sub });
        N.ui.panel.select({ title: N.t('menu.version'), entries: e, selected: String(N.versions.choose(it.rk, m.Media, lim)), onSelect: function (v) {
          N.versions.set(it.rk, Number(v));
          openItem(it, 'ask');
        } });
      });
    }
    function menu() {
      var it0 = curItem(); if (!it0) return;
      if (it0.ext) { openItem(it0, false); return; }   // Titel ausserhalb des Servers: kein Menue, die Detailseite hat alles
      N.anime.ensure(it0, function () { if (curItem() === it0 && N.router.top() === s && !N.router.hasOverlay()) menuOpen(it0); });   // Einordnung fuer "Als Anime behandeln"
    }
    function menuOpen(it) {
      var b = [];
      if (M.isLeaf(it)) b.push({ id: 'play', t: N.t('menu.play') });
      if (M.isLeaf(it) && M.progress(it) > 0) b.push({ id: 'start', t: N.t('menu.fromStart') });
      if (M.isLeaf(it) && it.nv > 1) b.push({ id: 'version', t: N.t('menu.version') });
      if (M.isVideo(it)) b.push({ id: 'watched', t: N.t(M.watched(it) ? 'menu.markUnwatched' : 'menu.markWatched') });
      if (rows[R].id === 'cw') b.push({ id: 'hide', t: N.t('menu.hideContinue') });
      b = b.concat(N.anime.menuButtons(it));
      b.push({ id: 'info', t: N.t('menu.info') });
      N.ui.dialog.open({ title: it.title, buttons: b, vertical: true, focus: 0, top: 120,
        onSelect: function (id) {
          if (id === 'play') openItem(it, 'ask');
          else if (id === 'start') openItem(it, 'start');
          else if (id === 'watched') toggleWatched();
          else if (id === 'hide') hideCard();
          else if (id === 'version') chooseVersion(it);
          else if (N.anime.menuPick(id, it)) return;
          else N.details.open(it);
        } });
    }

    /* ---------- Daten ---------- */
    function libsChanged(libs) { N.ui.rail.setData(N.session.profile, libs); }
    function applyNetwork(res) {
      loadedAt = U.now();
      if (res.libs && (!s.libs || JSON.stringify(s.libs) !== JSON.stringify(res.libs))) { s.libs = res.libs; libsChanged(res.alibs || res.libs); }
      if (res.alibs) { if (s.alibs && JSON.stringify(s.alibs) !== JSON.stringify(res.alibs)) libsChanged(res.alibs); s.alibs = res.alibs; }   // M4: Rail auch mit Musik/Hoerbuechern
      if (res.hubCat) N.idle.add(function () { updateCatalog(res.hubCat); }, 'home-hubcat');
      // Teil-Fehler: Cache nicht mit Luecken ueberschreiben; naechster Versuch nach TTL
      if (!res.partial) N.session.setHomeCache({ v: 1, ts: loadedAt, libs: s.libs || [], alibs: s.alibs || [], rows: H.forCache(res.rows) });
      var nr = res.rows;
      if (!rows.length || sb.on || (!interacted && !sameAll(rows, nr))) { rows = nr; R = 0; colMem = {}; renderAll(); return; }
      if (!interacted) return;
      if (!H.sameLayout(rows, nr)) { pending = nr; return; }      // beim naechsten Betreten (6.3.3)
      for (var r = 0; r < nr.length; r++) {
        if (H.sameRow(rows[r], nr[r])) continue;
        if (r === R) { pending = pending || nr; continue; }     // fokussierte Reihe nie umbauen
        rows[r] = nr[r];
        var k = r % SLOTS;
        // P7 27.10.: nur die angeschnittene naechste Reihe sichtbar sofort, verdeckte Reihen in Haeppchen
        if (slotRow[k] === r) { slots[k].setModel(nr[r], colMem[r] || 0, r === R + 1 ? 1 : 2); slots[k].setTop(tops[r]); slots[k].setVisible(r >= R); }
      }
    }
    function sameAll(a, b) {
      if (!H.sameLayout(a, b)) return false;
      for (var i = 0; i < a.length; i++) if (!H.sameRow(a[i], b[i])) return false;
      return true;
    }
    function later(ms) {
      if (playT) clearTimeout(playT);
      playT = setTimeout(function () { playT = 0; if (dead) return; if (away) loadedAt = 0; else refresh(); }, ms);
    }
    function refresh() {
      if (task) return;
      task = H.fetch(function (err, res) {
        task = null;
        if (dead) return;
        if (away) { parked = { err: err, res: res }; return; }      // anderer Bildschirm oben: erst beim Zurueckkehren anwenden
        // P7 27.10.: Antwort mitten in einer Tastenfolge (erste Schritte nach dem Start) erst in der naechsten Ruhe anwenden
        if (rows.length && !err) N.idle.add(function () { if (!dead && !away) handle(err, res); else if (!dead) parked = { err: err, res: res }; }, 'home-net');
        else handle(err, res);
      }, { libs: s.libs, alibs: s.alibs, rows: rows, cfg: cfg(), plTitle: plTitle() });
    }
    function handle(err, res) {
      if (err) { onLoadError(err); return; }
      if (played) {                                   // Rueckkehr aus dem Player (TV-Test 28.10.): Titel nie voreilig entfernen
        if (played.n < PLAY_RETRY.length && H.stale(res.rows, played.rk, order())) { later(PLAY_RETRY[played.n++]); return; }
        played = null;
      }
      retryN = 0;
      if (offline) { offline = false; N.ui.toast.show(N.t('toast.online'), { icon: 'confirm' }); }
      applyNetwork(res);
    }
    function onLoadError(err) {
      var S = N.session, kind = N.errs.kind(err, 'pms'), kids = S.isKid();
      N.diag.log('warn', 'home load error ' + (err.status || err.type));
      if (kind === 'auth') {
        // 401 mit dem Profil-Token: nur dieses Token verwerfen und zur Profilwahl – Konto bleibt angemeldet (M3)
        if (S.profile) S.dropToken(S.profile.uuid);
        if (kids && S.pinSwitchOn()) {                // Kinderprofil: Profilwahl nur ueber die Hauptkonto-PIN
          showState(N.errs.texts('profile', null, kids), [{ id: 'switch', t: N.t('err.btn.chooseProfile') }]);
          return;
        }
        N.router.reset('profiles', { atStart: true });
        N.ui.toast.show(N.t('toast.chooseProfileAgain'));
        return;
      }
      if (rows.length) {                              // Inhalte bleiben bedienbar; still weiter versuchen
        if (!offline) { offline = true; N.ui.toast.show(N.t('toast.offline')); }
        if (retryT) clearTimeout(retryT);
        retryT = setTimeout(function () { retryT = 0; refresh(); }, 10000);
        return;
      }
      if (kind !== 'server') {                        // z. B. 404/400: kein "Server nicht erreichbar", kein Countdown
        showState(N.errs.texts('generic', null, kids), [{ id: 'retry', t: N.t('err.btn.retry') }]);
        return;
      }
      retryN = 10;
      countdown();
    }
    function countdown() {
      // ohne Servernamen (Fallback-Adresse) die IP zeigen statt leerer Anfuehrungszeichen
      var srv = N.session.state.server && N.session.state.server.name || (N.plex.base || '').replace(/^https?:\/\//, '').split(':')[0] || '?';
      var tx = N.errs.texts('server', { server: srv, n: retryN }, N.session.isKid());
      if (!sb.on) showState(tx, [{ id: 'retry', t: N.t('err.btn.retry') }]); else sb.setText(tx.text);
      if (retryT) clearTimeout(retryT);
      retryT = setTimeout(function () {
        retryT = 0;
        if (--retryN <= 0) { refresh(); return; }
        countdown();
      }, 1000);
    }
    function showState(tx, buttons) {
      showSkel(false); ring.hide(); hero.clear();
      for (var k = 0; k < SLOTS; k++) slots[k].setVisible(false);
      sb.show({ title: tx.title, text: tx.text, buttons: buttons, onSelect: function (id) {
        if (id === 'retry') { if (retryT) clearTimeout(retryT); retryT = 0; sb.hide(); if (!rows.length) showSkel(true); refresh(); }
        else if (id === 'switch') N.app.switchProfile();
      } });
      markMore();                                     // fester Hinweis unten aus
    }
    function showEmpty() {
      var kids = N.session.isKid(), p = kids ? 'empty.home.kids' : 'empty.home';
      if (!order().length) p = 'empty.homeOff';      // alle Reihen in "Startseite anpassen" ausgeschaltet
      showState({ title: N.t(p + '.title'), text: N.t(p + '.text') }, []);
    }

    /* ---------- Lebenszyklus ---------- */
    s.enter = function (params, restore) {
      var redraw = false;
      // TV-Test 28.10.: Start -> Seitenleiste -> anderer Bildschirm -> zurueck zur Startseite liess railOpen (aus railBlur) stehen,
      // der Fokusring blieb unsichtbar. Beim Betreten ist die Seitenleiste zu (activate schliesst sie vor dem Wechsel).
      railOpen = !!(N.ui.rail && N.ui.rail.isOpen && N.ui.rail.isOpen());
      if (pending) { rows = pending; pending = null; redraw = true; }
      if (cfgDirty && drawn) {                        // Reihen-Auswahl geaendert: sofort umordnen, dann frisch laden
        cfgDirty = false; rows = H.pick(rows, order()); R = 0; colMem = {}; interacted = false; loadedAt = 0; redraw = true; parked = null;
        if (task) { task.abort(); task = null; }
      }
      if (!drawn) {                                   // erstes Betreten dieser Instanz (oder Neuaufbau aus restore)
        drawn = true;
        if (restore) { R = restore.R || 0; colMem = restore.colMem || {}; }
        if (!rows.length) {
          var c = N.session.homeCache();
          if (c && c.v === 1 && c.rows) { s.libs = c.libs; s.alibs = c.alibs; rows = H.pick(c.rows, order()); libsChanged(c.alibs || c.libs || []); loadedAt = 0; }
          else libsChanged([]);
          cfgDirty = false;
        }
        redraw = rows.length > 0;
      }
      if (redraw) renderAll();
      else if (rows.length && !sb.on) {
        var sl = slotFor(R);
        if (curItem() && curItem().ext) sl.refreshItem(sl.f);    // Marke der Karte kann sich auf der Detailseite geaendert haben (Erweiterung)
        sl.setFocused(true); placeRing(sl.ringPos()); heroBack();
      }
      if (!rows.length && !sb.on) { ring.hide(); showSkel(true); }
      away = false;
      if (parked) { var pk = parked; parked = null; handle(pk.err, pk.res); }
      else if (resume) { resume = false; refresh(); }
      if (played && played.wait) { played.wait = false; later(PLAY_SETTLE); }   // nach dem Player: PMS erst kurz nachziehen lassen
      else if (!loadedAt || U.now() - loadedAt > TTL) { if (!playT) refresh(); }
      N.session.refreshUsersLater();
    };
    s.leave = function () {
      away = true;                                    // Wiederholungen/Toasts/Neuzeichnen ruhen, solange etwas anderes oben ist (L2)
      if (retryT) { clearTimeout(retryT); retryT = 0; resume = true; }
      if (heroT) { clearTimeout(heroT); heroT = 0; }
      if (playT) { clearTimeout(playT); playT = 0; loadedAt = 0; }   // Nachladen nach dem Player: beim Zurueckkehren
      if (stripTask) { stripTask.abort(); stripTask = null; }
      colMem[R] = rows.length ? slotFor(R).f : 0;
      return { R: R, colMem: U.extend({}, colMem) };
    };
    s.destroy = function () {
      dead = true;
      if (playT) { clearTimeout(playT); playT = 0; }
      if (onFlush) N.evt.off('app:flush', onFlush);
      if (onSet) N.evt.off('settings:changed', onSet);
      if (onAnime) N.evt.off('anime:changed', onAnime);
      if (onBack) { N.evt.off('overlay:closed', onBack); N.evt.off('app:refocus', onBack); }
      if (onPlayed) N.evt.off('playback:stopped', onPlayed);
      if (onScanned) N.evt.off('library:scanned', onScanned);
      if (task) task.abort(); task = null;
      if (retryT) clearTimeout(retryT);
      if (hideCommit) hideCommit.run();
      for (var k = 0; k < SLOTS; k++) slots[k].clear();
    };
    s.railBlur = function () { railOpen = true; ring.hide(); if (rows.length) slotFor(R).setFocused(false); };
    s.railFocus = function () { railOpen = false; if (sb.on) return; if (rows.length) { var sl = slotFor(R); sl.setFocused(true); placeRing(sl.ringPos()); } };

    s.onKey = function (k) {
      interacted = true;
      if (sb.on) {
        if (sb.onKey(k)) return true;
        if (k === 'LEFT') { N.ui.rail.open(); return true; }
        if (k === 'BLUE') { N.router.push('search'); return true; }
        if (k === 'RETURN') { N.ui.dialog.exitApp(); return true; }
        return true;
      }
      if (!rows.length) { if (k === 'LEFT' || k === 'RETURN') { N.ui.rail.open(); return true; } return true; }
      var sl = slotFor(R), f = sl.f, it = sl.item(f);
      switch (k) {
        case 'LEFT': if (f > 0) moveCol(f - 1); else N.ui.rail.open(); return true;
        case 'RIGHT': if (f < sl.count() - 1) moveCol(f + 1); return true;
        case 'UP': if (R > 0) moveRow(R - 1); return true;
        case 'DOWN': if (R < rows.length - 1) moveRow(R + 1); return true;
        case 'ENTER': openItem(it, false); return true;
        case 'PLAY': openItem(it, true); return true;
        case 'RED': hideCard(); return true;
        case 'YELLOW': toggleWatched(); return true;
        case 'BLUE': N.router.push('search'); return true;
        case 'INFO': if (it && it.ext) openItem(it, false); else N.details.open(it); return true;
        case 'TOOLS': menu(); return true;
        case 'FF': moveCol(Math.min(sl.count() - 1, f + 5)); return true;
        case 'RW': moveCol(Math.max(0, f - 5)); return true;
        case 'RETURN':
          if (R > 0 || f > 0) toTop(); else N.ui.rail.open();     // RETURN-Kette (6.2)
          return true;
      }
      return true;
    };

    /* ---------- Zeiger (Index-Mathe) ---------- */
    /* Naechste Reihe per Zeiger (NAV-2, HOME-11): Zone ab ihrem Kopf bzw. – wenn hohe Poster ihn aus dem Bild schieben – ab der
     * Unterkante der Fokus-Karten bis zum Bildrand (Hinweisleiste ausgenommen). Verweilen (HOLD, Einstellung "Zeiger blaettert am
     * Rand weiter") oder Klick = eine Reihe tiefer; danach Zeiger-Sperre (Seite ist unter dem Punkt gewandert). Vorbeiziehen
     * loest nichts aus. */
    function inNext(x, y) {
      if (R + 1 >= rows.length || x < 128) return false;
      if (y < nextZone().y || y >= 720) return false;
      return !(N.ui.hints && N.ui.hints.hit && N.ui.hints.hit(x, y));
    }
    function goNext(x) {
      var r = R + 1, nx = slotFor(r);
      if (r >= rows.length) return;
      var j = nx.model === rows[r] ? nx.hit(x) : -1;
      N.fx.step(true);
      moveRow(r, j >= 0 ? j : undefined);
      if (N.pointer) N.pointer.scrolled();
    }
    s.pointer = function (x, y, kind) {
      if (sb.on) return sb.pointer(x, y, kind);
      if (!rows.length) return false;
      var sl = slotFor(R);
      if (y >= CARD_Y && y < CARD_Y + sl.g.h) {
        N.pointer.holdCancel();
        var i = sl.hit(x);
        if (i < 0) return false;
        if (i !== sl.f) { placeRing(sl.hoverCol(i)); afterMove(); }
        if (kind === 'click') openItem(sl.item(i), false);
        return true;
      }
      if (!inNext(x, y)) { N.pointer.holdCancel(); return false; }
      if (kind === 'click') { N.pointer.holdCancel(); goNext(x); return true; }
      var r0 = R;
      N.pointer.hold(function () { if (!dead && !away && R === r0 && inNext(N.pointer.x, N.pointer.y)) goNext(N.pointer.x); });
      return true;
    };
    s.pointerSig = function () { return pageY(); };          // Zeiger-Scroll-Sperre (N.pointer): Reihenwechsel rollt die Seite
    s.pointerArrows = function () {
      if (!rows.length || sb.on || railOpen) return null;
      var sl = slotFor(R);
      return { y: CARD_Y, h: sl.g.h, left: sl.canPage(-1), right: sl.canPage(1) };
    };
    s.pointerPage = function (dir) {
      var sl = slotFor(R);
      if (!sl.canPage(dir)) return;
      placeRing(sl.page(dir)); afterMove();
      if (N.pointer) N.pointer.syncArrows();
    };
    /* Messlauf (dev/bench.js): gleicher Ausgangspunkt fuer jeden Lauf (TV 28.10.: home/home-hero hingen von der zuletzt fokussierten
     * Reihe ab). top() = Reihe 0, Spalte 0 (wie RETURN); row() = fokussierte Reihe; counts() = Kartenzahl je Reihe */
    s.bench = {
      top: function () { if (rows.length) toTop(); },
      row: function () { return R; },
      counts: function () { var c = []; for (var i = 0; i < rows.length; i++) c.push(rows[i].items.length); return c; },
      /* Runde 6, Gegenprobe hvar-cue0: Hinweis unten wie bis 1.0.5 per display (Klasse hcue0 am body nimmt ihm die Ebene) */
      cueDisplay: function (on) {
        cueDisp = !!on;
        U.cls(document.body, 'hcue0', cueDisp);
        if (cueDisp) { U.vis(cue, true); U.show(cue, cueOn); } else { U.show(cue, true); U.vis(cue, cueOn); }
      }
    };
    s.relabel = function () { for (var k = 0; k < SLOTS; k++) if (slotRow[k] >= 0) slots[k].relabel(); };
    return s;
  });
})(N);
