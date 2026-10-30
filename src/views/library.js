/* Ansicht 'library' – Bibliothek als Posterraster (SPEC 7.5, 9, 10.5, 15; Mockup library.html; plex-parity 3.1 Nr. 6).
 * - Titel, Statuszeile ("37 von 248 Titeln · Titel A–Z · Nur ungesehene"), Chip-Zeile y 120: Reiter Bibliothek | Sammlungen,
 *   "Sortieren & Filter" (= Rot), "Alle abspielen", "Zufall" (Play-Queue ueber den PMS).
 * - Raster: N.ui.Grid (Pool 25, Fokus-Anker y 176), Paging je 50 mit Platzhaltern, naechste Seiten 2 Zeilen vor dem Ende.
 * - Buchstaben-Register (nur Titelsortierung): 5 Positionen, ▶ aus der letzten Spalte, ▲▼ waehlt, OK springt; Ziffern = T9-Sprung.
 * - Sortierung, Filter und Reiter je Bibliothek + Profil gemerkt (N.lib). Person-Filter (aus der Besetzung) gilt nur fuer diesen Aufruf.
 * params: {lib:{id,title,type,kind}, coll:{rk,title} (Sammlung oeffnen), actor:{id,t} (Filter "mit <Person>"), view:'L'|'M'|'S'|'list' (nicht gemerkt),
 *   xtab: Reiter einer Erweiterung gleich oeffnen (Kennung; '*' = erster mit Quelle – Messlauf lib-xtab),
 *   once:{sort} (HOME-14 "Alle anzeigen" aus "Neu in …": Sortierung nur fuer diesen Besuch, ohne Filter; nichts in diesem Besuch wird
 *     gemerkt – die gemerkte Sortierung der Bibliothek bleibt, wie sie war),
 *   list:{title, src:'hub'|'cw'|'deck', key, kinds, cw, cwOn} (HOME-14: ganze Liste einer Startseiten-Reihe als Raster, EINE Anfrage
 *     mit hoechstens LIST_MAX Titeln; kein A–Z, nur der Chip "Ansicht" – Gross/Mittel/Klein/Liste nur fuer diesen Besuch),
 *   list:{title, src:'x', id} (HOME-14 "Alle anzeigen" einer Erweiterungs-Reihe: Quelle im Reiter-Protokoll von N.ext 'lib:list',
 *     waechst seitenweise wie ein Reiter mit Quelle; ohne Erweiterung leer),
 *   rail: Markierung der Seitenleiste (Standard: die Bibliothek)} */
(function (N) {
  var U = N.util, M = N.model, G = N.GridMath, L = N.lib, REST = 300;
  var REG_X = 1160, REG_Y = 168, REG_STEP = 17, LETTERS = '#ABCDEFGHIJKLMNOPQRSTUVWXYZ', LIST_MAX = 300;

  N.router.define('library', function (params) {
    var lib = params.lib || { id: 0, title: '', type: 'movie' }, coll = params.coll || null, list = params.list || null, once = params.once || null;
    // Seitenleiste markiert die Bibliothek auch in Sammlung/Personenfilter (TV-Befund 26.10.); sub: RETURN geht dort zurueck
    var sub = !!(coll || params.actor || list || once), s = { rail: params.rail || (lib.id ? N.railRows.libId(lib) : null), wheelKeys: ['UP', 'DOWN'], miniX: REG_X - 16 - 360, news: 'top' };   // news: HOME-13 Hinweis oben rechts neben dem Titel   // Mini-Player links neben A–Z (F26)
    // Weitere Server (N.srv): Bibliothek eines fremden Servers -> alle Anfragen dorthin, Ansicht-Merken mit eigenem Schluessel
    var srv = lib.srv || '', libKey = srv ? N.srv.skey(srv, lib.id) : lib.id;
    function get(path, q, o, cb) { return N.plex.get(path, q, N.srv.o(srv, o), cb); }
    var G = N.GridMath, root, titleT, statT, chipBar, chips = [], chipRects = null, grid, ring, sb, amb, regDivs = [], regCur = -1, regFoc = false, regHas = '', bubble, bubbleT, skel, fade;
    var prefs = null, items = [], n = -1, total = -1, chars = [], pages = {}, gen = 0, tasks = [], collN = -1;
    // M4 Musik/Hoerbuecher: Reiter 'lib' = Kuenstler (Musik) bzw. Buecher (Hoerbuecher), 'alt' = Alben bzw. Autoren; quadratische Karten
    var music = lib.type === 'artist', book = music && N.music.bookLib(lib);
    // Erweiterung (N.ext 'lib:tabs'/'lib:items'/'lib:status'): eigener Reiter mit fertiger Titelliste (z. B. eine Merkliste der Erweiterung), nie gemerkt.
    // Reiter mit Quelle (tab.src): Liste waechst seitenweise (src.load im Leerlauf, wenn der Fokus 2 Zeilen vor dem Ende ist), eigenes
    // Sortieren & Filter (src.tabs/pick) + Ansicht, Hinweis unter der letzten Zeile (src.end), Statuszeile (src.status), Optionen (src.menu/act)
    var xtab = '', xsrc = null, listItems = null;   // listItems: geladene HOME-14-Liste (Ansicht wechseln laedt nicht neu)
    var loadSig = '', restoreRk = null, keyed = false;   // LIB-10: Stand der Bibliothek beim Laden (N.libwatch), fokussierter Titel beim Neuladen
    var restoreF = 0, zone = 'grid', cf = 0, regCh = '', regT = 0, t9 = { d: '', c: 0, t: 0 }, bubbleTm = 0, dead = false, away = false, railOpen = false, onScanned = null;

    /* ---------- Aufbau ---------- */
    s.create = function (el) {
      root = el;
      // Hintergrund in Bibliotheken (N.ui.Ambient): Ebenen erst bei Bedarf, ganz unten; "Aus" = keine Elemente
      amb = new N.ui.Ambient(root, { lib: lib.id, coll: !!(coll || list), type: function () { return L.typeNum(qlib()); }, items: function () { return items.slice(0, G.PAGE); }, get: get });
      titleT = U.txt('div', 'a t-h1 ell', root, coll ? coll.title : list ? list.title : lib.title, 'left:144px;top:40px;width:900px');
      if (srv) U.txt('div', 'a t-label cacc ell', root, N.t('srv.libFrom', { server: lib.srvName || N.srv.name(srv) }), 'left:144px;top:16px;width:900px');   // Herkunft
      statT = U.txt('div', 'a t-small c2 ell', root, N.t('common.loading'), 'left:144px;top:84px;width:1000px');
      chipBar = U.el('div', 'lchips', root);
      grid = new N.ui.Grid(root);
      skel = U.el('div', 'skel', root);
      for (var i = 0; i < 5; i++) U.el('i', '', skel, 'left:' + (G.X0 + i * G.SX) + 'px;top:' + G.Y0 + 'px;width:176px;height:264px');
      fade = U.el('img', 'fade fade-frame', root); fade.src = N.assetBase + 'fade-frame.png';   // unter A–Z-Leiste/Sprungbuchstabe: Band ab y 612, Leiste bis 628
      /* A–Z-Leiste: vollstaendiges Alphabet sofort sichtbar (NUTZER-FEEDBACK-REGELN 1), 27 feste Elemente */
      var reg = U.el('div', 'regcol', root, 'display:none');
      for (i = 0; i < LETTERS.length; i++) {
        var re = U.el('div', 'reg', reg, 'top:' + (i * REG_STEP) + 'px');
        re.appendChild(document.createTextNode(LETTERS.charAt(i))); regDivs.push(re);
      }
      regDivs.box = reg;
      bubble = U.el('div', 'jump', root, 'display:none');
      bubbleT = document.createTextNode(''); bubble.appendChild(bubbleT);
      ring = new N.ui.Ring(root);
      sb = new N.ui.StateBlock(root);
      onScanned = function (d) { if (!dead && !srv && (!d || !d.lib || String(d.lib) === String(lib.id))) { if (away) pages = null; else reload(); } };
      N.evt.on('library:scanned', onScanned);
    };
    function mode() { return coll ? 'coll-items' : list ? (xsrc ? 'x' : 'list') : xtab ? 'x' : prefs.tab === 'coll' ? 'colls' : 'lib'; }
    /* HOME-14-Listen (auch die einer Erweiterung ohne eigenes Sortieren & Filter): nur "Ansicht", nichts wird gemerkt */
    function viewOnly() { return !!list && !xPanel(); }
    /* gemerkt wird nur in der normalen Bibliothek (nicht Sammlung, Person, "Alle anzeigen") */
    function keep() { return !coll && !params.actor && !list && !once; }
    /* Startwerte: gemerkt; "Alle anzeigen" aus "Neu in …" (once): Sortierung nur fuer diesen Besuch, ohne Filter, Reiter der Titel
     * (Musik: Alben, Hoerbuecher: Buecher – das, was die Reihe zeigt) */
    function startPrefs() {
      var p = coll || list ? L.defaults() : L.load(libKey);
      if (!once) return p;
      return N.lib.oncePrefs(p, once.sort, music, book);
    }
    /* Reiter einer Erweiterung: [{id, t (fertiger Text)}]; repaint(), sobald sich ihre Liste aendert */
    function xtabs() { return !coll && !params.actor && !list && !srv && N.ext.has('lib:tabs') ? N.ext.call('lib:tabs', lib, xRepaint) || [] : []; }
    function xRepaint() {
      if (dead || away) return;
      var has = false, l = xtabs();
      for (var i = 0; i < l.length; i++) if (l[i].id === xtab) has = true;
      if (xtab && !has) { xtab = ''; xsrc = null; reload(); return; }
      if (xsrc) { if (xsrc.restamp && n > 0) { xsrc.restamp(); grid.refresh(Math.max(0, grid.f - 10), Math.min(n - 1, grid.f + 15)); } buildChips(); paintStatus(); return; }
      if (xtab) { var f = grid.f, x = N.ext.call('lib:items', lib, xtab) || []; if (x.length !== n || zone !== 'grid') { restoreF = Math.min(f, Math.max(0, x.length - 1)); reload(true); return; } items = x; grid.setModel(items, n, f); placeRing(grid.ringPos()); }
      buildChips();
    }
    /* Bibliothek mit dem Typ der Eintraege (Musik: artist | album je Reiter) fuer N.lib */
    function qlib() {
      if (!music) return lib;
      var t = (prefs.tab === 'alt') === book ? 'artist' : 'album';
      return U.extend(U.extend({}, lib), { type: t });
    }
    function regOn() { return mode() === 'lib' && L.hasRegister(prefs) && chars.length > 0 && n > 0; }

    /* ---------- Chip-Zeile (Reiter, Sortieren & Filter, Alle abspielen, Zufall) ---------- */
    function chipDefs() {
      var d = [], xt = xtabs();
      if (!coll && !params.actor && !list && (collN > 0 || music || xt.length)) {
        d.push({ id: 'tab-lib', t: music ? (book ? 'mu.tab.books' : 'mu.tab.artists') : 'lib.tab.library', act: !xtab && prefs.tab === 'lib' });
        if (music) d.push({ id: 'tab-alt', t: book ? 'mu.tab.authors' : 'mu.tab.albums', act: !xtab && prefs.tab === 'alt' });
        if (collN > 0) d.push({ id: 'tab-coll', t: 'lib.tab.collections', act: !xtab && prefs.tab === 'coll' });
        for (var i = 0; i < xt.length; i++) d.push({ id: 'tab-x-' + xt[i].id, tx: xt[i].t, act: xtab === xt[i].id });
      }
      if (mode() === 'lib' || xPanel()) d.push({ id: 'sort', t: 'lib.chip' });
      else if (viewOnly()) d.push({ id: 'view', t: 'lib.chipView' });
      if (mode() !== 'colls' && mode() !== 'x' && mode() !== 'list' && !book) { d.push({ id: 'all', t: 'lib.playAll' }); d.push({ id: 'shuffle', t: 'lib.shuffle' }); }
      return d;
    }
    function buildChips() {
      while (chipBar.firstChild) chipBar.removeChild(chipBar.firstChild);
      chips = chipDefs(); chipRects = null;
      for (var i = 0; i < chips.length; i++) {
        var c = U.el('span', 'chip' + (chips[i].act ? ' act' : ''), chipBar);
        c.appendChild(document.createTextNode(chips[i].tx || N.t(chips[i].t)));
        chips[i].el = c;
      }
      cf = Math.min(cf, Math.max(0, chips.length - 1));
      if (zone === 'chips' && chips[cf]) U.cls(chips[cf].el, 'is-focus', true);
      setTimeout(measureChips, 50);                    // einmalige Messung fuer den Zeiger (nie im Tastenpfad)
    }
    function measureChips() {
      if (dead) return;
      chipRects = [];
      for (var i = 0; i < chips.length; i++) chipRects.push([144 + chips[i].el.offsetLeft, chips[i].el.offsetWidth]);
    }
    function chipIndex(id) { for (var i = 0; i < chips.length; i++) if (chips[i].id === id) return i; return 0; }

    /* ---------- Status ---------- */
    function paintStatus() {
      if (n < 0) { U.setText(statT, N.t('common.loading')); return; }
      if (mode() === 'colls') { U.setText(statT, N.tn('lib.status.colls', n)); return; }
      if (mode() === 'x') { U.setText(statT, (xsrc ? xsrc.status(n) : N.ext.call('lib:status', lib, xtab, n)) || ''); return; }
      if (coll || list) { U.setText(statT, N.tn('lib.status.items', n)); return; }
      U.setText(statT, L.status(n, total, prefs, qlib()) + (once ? ' · ' + N.t('lib.status.once') : ''));   // HOME-14: Sortierung nur fuer diesen Besuch
    }

    /* ---------- Daten ---------- */
    function abortAll() { for (var i = 0; i < tasks.length; i++) if (tasks[i]) tasks[i].abort(); tasks = []; }
    function track(t) { tasks.push(t); return t; }
    function pageReq(p) {
      var start = p * G.PAGE;
      if (mode() === 'lib') return L.pageQuery(qlib(), prefs, start, G.PAGE);
      var q = { 'X-Plex-Container-Start': start, 'X-Plex-Container-Size': G.PAGE, excludeElements: N.hubs.EXCL, excludeFields: 'summary,tagline' };
      return { path: coll ? '/library/collections/' + coll.rk + '/children' : '/library/sections/' + lib.id + '/collections', q: q };
    }
    function kinds() { var k = {}; k[lib.id] = lib.kind || lib.type; return k; }
    function loadPage(p) {
      if (!pages || pages[p] || mode() === 'x' || mode() === 'list') return;
      pages[p] = 1;
      var g = gen, r = pageReq(p);
      track(get(r.path, r.q, { timeout: 12000 }, function (err, d) {
        if (g !== gen || dead) return;
        var mc = !err && d && d.MediaContainer;
        if (!mc) { pages[p] = 0; if (n < 0) onError(err); else N.diag.log('warn', 'library page ' + p + ' ' + (err && (err.status || err.type))); return; }
        var list = M.normList(mc.Metadata || [], kinds(), mc.librarySectionID || (mode() === 'lib' ? lib.id : 0), true), start = p * G.PAGE, size = Number(mc.totalSize !== undefined ? mc.totalSize : list.length);
        for (var i = 0; i < list.length; i++) items[start + i] = list[i];
        if (n < 0) {
          if (restoreRk) for (var j = 0; j < list.length; j++) if (list[j] && list[j].rk === restoreRk) { restoreF = start + j; break; }
          restoreRk = null; n = size; firstPaint(); return;
        }
        grid.refresh(start, start + list.length - 1);
        if (start <= grid.f && grid.f < start + list.length) { N.idle.add(updateHints, 'lib-hints'); amb.focus(cur()); }
      }));
    }
    /* alles neu laden (Sortierung/Filter/Reiter geaendert, Rueckkehr nach Scan) */
    function reload(keepF) {
      gen++; abortAll();
      loadSig = srv ? '' : N.libwatch.sig(lib.id);
      items = []; n = -1; pages = {}; chars = []; total = -1;
      if (!keepF) restoreF = 0;
      grid.clear(); ring.hide(); sb.hide(); hideReg(); U.show(skel, true);
      if (G.size !== L.view(prefs) || !!G.square !== music) { G = N.GridMath.make(L.view(prefs), music); grid.setGeom(G); }   // Ansicht Gross/Mittel/Klein/Liste
      buildChips(); paintStatus();
      U.cls(grid.clip, 'is-ext', mode() === 'x');       // Erweiterungs-Reiter: Karten gedimmt (nicht abspielbar), per Klasse am Raster
      if (xsrc) { items = xsrc.items(); if (!items.length && xsrc.more()) { xLoad(); return; } n = items.length; firstPaint(); return; }
      if (mode() === 'x') { items = N.ext.call('lib:items', lib, xtab) || []; n = items.length; firstPaint(); return; }
      if (list) { if (list.src === 'x' || listItems) { items = listItems || []; n = items.length; firstPaint(); } else loadList(); return; }   // Erweiterung fehlt: leer
      if (srv && !N.srv.conn(srv)) U.setText(statT, N.t('srv.connecting', { server: lib.srvName || N.srv.name(srv) }));   // weiterer Server: Verbindung wird geprueft
      loadPage(0);
      var g = gen;
      if (mode() === 'lib') {
        if (L.hasRegister(prefs)) track(get('/library/sections/' + lib.id + '/firstCharacter', L.filterQuery(prefs, qlib()), null, function (err, d) {
          if (g !== gen || err) return;
          chars = L.chars(d); if (n >= 0) paintReg(true);
        }));
        if (L.hasFilter(prefs)) track(get('/library/sections/' + lib.id + '/all', { type: L.typeNum(qlib()), 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 0 }, null, function (err, d) {
          if (g !== gen || err || !d || !d.MediaContainer) return;
          total = Number(d.MediaContainer.totalSize) || 0; paintStatus();
        }));
      }
    }
    /* HOME-14: ganze Liste einer Startseiten-Reihe – EINE Anfrage (hoechstens LIST_MAX), Naechste Folgen gefiltert wie die Reihe */
    function loadList() {
      var g = gen, q = { 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': LIST_MAX, excludeElements: N.hubs.EXCL, excludeFields: 'summary,tagline' };
      var path = list.src === 'cw' ? '/hubs/continueWatching/items' : list.src === 'deck' ? '/library/onDeck' : list.key;
      track(get(path, q, { timeout: 15000 }, function (err, d) {
        if (g !== gen || dead) return;
        var mc = !err && d && d.MediaContainer;
        if (!mc) { onError(err); return; }
        items = listItems = N.hubs.listItems(list, M.normList(mc.Metadata || mc.Directory || [], list.kinds || kinds(), 0, true));
        n = items.length; firstPaint();
      }));
    }
    function firstPaint() {
      U.show(skel, false);
      paintStatus(); buildChips();
      if (!n) { showEmpty(); return; }
      grid.setModel(items, n, Math.min(restoreF, n - 1));
      if (zone === 'chips' && chips.length) { grid.setFocused(false); setChip(cf, true); }
      else { zone = 'grid'; grid.setFocused(!railOpen); placeRing(grid.ringPos()); }
      ensurePages();
      paintReg(true);
      N.idle.add(updateHints, 'lib-hints');
      amb.focus(cur()); amb.data();
      if (xsrc) grid.endNote(xEnd());
    }
    function ensurePages() { if (xsrc) { xNear(); return; } var ps = G.pagesFor(n, grid.r); for (var i = 0; i < ps.length; i++) loadPage(ps[i]); }
    /* ---------- Reiter mit Quelle (Erweiterung) ---------- */
    function xPanel() { return !!(xsrc && xsrc.tabs); }
    function xEnd() { return n > 0 && !xsrc.more() ? xsrc.end() || '' : ''; }
    /* naechste Seite: erst wenn der Fokus hoechstens 2 Zeilen vor dem Ende steht, und dann aus dem Leerlauf (nie im Fokusschritt) */
    function xNear() {
      if (!xsrc || n <= 0 || !xsrc.more() || xsrc.busy() || G.row(n - 1) - G.row(grid.f) > 2) return;
      var g = gen;
      N.idle.add(function () { if (g === gen && !dead && xsrc && !xsrc.busy()) xLoad(); }, 'lib-xmore');
    }
    function xLoad() {
      var g = gen, src = xsrc;
      src.load(function (err) {
        if (g !== gen || dead || src !== xsrc) return;
        var l = src.items();
        if (n < 0) {
          if (!l.length && err) { xError(err); return; }
          items = l; n = l.length; firstPaint(); return;
        }
        if (l.length > n) { items = l; n = l.length; grid.grow(items, n); }
        grid.endNote(xEnd()); paintStatus();
        if (!away) xNear();
      });
    }
    function xError(err) {
      var tx = xsrc.err(err);
      U.show(skel, false); ring.hide(); U.setText(statT, '');
      sb.show({ title: tx.title, text: tx.text, buttons: [{ id: 'retry', t: N.t('err.btn.retry') }], onSelect: function () { sb.hide(); reload(true); } });
      zone = 'state';
    }
    function onError(err) {
      U.show(skel, false); ring.hide();
      var kind = N.errs.kind(err, 'pms'), tx;
      if (srv) { srvError(err); return; }                 // Weitere Server: Meldung nur fuer diesen Server, eigenes Profil bleibt
      if (kind === 'auth') { N.app.authLost(); return; }   // Kinderprofil-Pruefung wie Startseite (Pentest P6)
      tx = kind === 'server' ? { title: N.t('err.server.title'), text: N.t('lib.err.text', { server: N.session.state.server && N.session.state.server.name || '' }) }
        : N.errs.texts('generic', null, N.session.isKid());
      U.setText(statT, '');
      sb.show({ title: tx.title, text: tx.text, buttons: [{ id: 'retry', t: N.t('err.btn.retry') }], onSelect: function () { sb.hide(); reload(true); } });
      zone = 'state';
    }
    /* Weitere Server: nicht erreichbar (Freund offline, Adresse gewechselt, "Sichere Verbindungen: Erforderlich") oder Zugang
     * abgelehnt (Freigabe entzogen). Erneut versuchen = alle Adressen neu pruefen (ggf. frische vom Helfer), dann neu laden. */
    function srvError(err) {
      var name = lib.srvName || N.srv.name(srv), auth = N.srv.state(srv) === 'auth' || (err && (err.status === 401 || err.status === 403));
      U.setText(statT, '');
      sb.show({ title: N.t(auth ? 'srv.err.auth.title' : 'srv.err.down.title', { server: name }), text: N.t(auth ? 'srv.err.auth.text' : 'srv.err.down.text', { server: name }),
        buttons: [{ id: 'retry', t: N.t('err.btn.retry') }],
        onSelect: function () { sb.hide(); U.setText(statT, N.t('common.loading')); N.srv.resolve(srv, true, function () { if (!dead) reload(true); }); } });
      zone = 'state';
    }
    function showEmpty() {
      ring.hide(); grid.clear(); hideReg(); amb.focus(null);
      if (xsrc) {
        var em = xsrc.empty();
        sb.show({ title: em.title, text: em.text, buttons: em.reset ? [{ id: 'reset', t: N.t('lib.filter.reset') }] : [], onSelect: function () { xsrc.reset(); restoreF = 0; reload(); } });
        zone = sb.ids.length ? 'state' : chips.length ? 'chips' : 'state';
        if (zone === 'chips') setChip(0, true);
        return;
      }
      var key = mode() === 'colls' ? 'empty.colls' : list ? 'empty.list' : L.hasFilter(prefs) && !coll ? 'empty.filter' : 'empty.library';
      sb.show({ title: N.t(key + '.title'), text: N.t(key + '.text'), buttons: key === 'empty.filter' ? [{ id: 'reset', t: N.t('lib.filter.reset') }] : [],
        onSelect: function () { resetFilter(); } });
      zone = sb.ids.length ? 'state' : chips.length ? 'chips' : 'state';
      if (zone === 'chips') setChip(0, true);
    }

    /* ---------- Register (SPEC 7.5) ---------- */
    function hideReg() { U.show(regDivs.box, false); }
    /* Buchstaben ohne Titel abgeschwaecht (einmal je Index), aktueller hervorgehoben (nur alter + neuer umgeklasst) */
    function paintReg(force) {
      if (!regOn()) { hideReg(); return; }
      var has = L.present(chars), i;
      if (has !== regHas) { regHas = has; for (i = 0; i < regDivs.length; i++) regDivs[i].className = has.indexOf(LETTERS.charAt(i)) >= 0 ? 'reg' : 'reg off'; regCur = -1; regFoc = false; }
      U.show(regDivs.box, true);
      var ch = zone === 'reg' ? regCh : L.letterAt(chars, grid.f, prefs.desc);
      if (!force && zone !== 'reg' && ch === regCh && regCur >= 0) return;
      regCh = ch;
      var k = LETTERS.indexOf(ch), foc = zone === 'reg';
      if (regCur >= 0 && (regCur !== k || regFoc !== foc)) regDivs[regCur].className = has.indexOf(LETTERS.charAt(regCur)) >= 0 ? 'reg' : 'reg off';
      if (k >= 0) regDivs[k].className = foc ? 'reg cur is-focus' : 'reg cur';
      regCur = k; regFoc = foc;
    }
    /* Anzeige nur nach 300 ms Ruhe (nicht im Tastenpfad) */
    function regLater() {
      if (regT) clearTimeout(regT);
      regT = setTimeout(function () { regT = 0; if (N.idle.restFor() < REST) { regLater(); return; } paintReg(false); }, REST);
    }
    function jumpTo(letter) {
      var j = L.jump(chars, letter, prefs.desc);
      showBubble(j.ch || letter);
      if (zone !== 'grid') toGrid();
      moveTo(Math.min(j.idx, n - 1));
      regCh = j.ch; paintReg(true);
    }
    function showBubble(t) {
      U.setText(bubbleT, t); U.show(bubble, true);
      if (bubbleTm) clearTimeout(bubbleTm);
      bubbleTm = setTimeout(function () { bubbleTm = 0; U.show(bubble, false); }, 1000);
    }
    /* Ziffern: T9-Erstbuchstabe (2 = A, 22 = B …), Mehrfachdruck innerhalb 900 ms */
    function digit(d) {
      if (!regOn()) return;
      var now = U.now();
      if (t9.d === d && now - t9.t < 900) t9.c++; else { t9.d = d; t9.c = 1; }
      t9.t = now;
      jumpTo(L.t9(d, t9.c));
    }

    /* ---------- Fokus ---------- */
    function placeRing(p) { if (p && !railOpen && !sb.on) ring.to(p.shape, p.x, p.y, p.noScale); }
    function updateHints() { N.router.refreshHints(); }
    function afterMove() { ensurePages(); regLater(); N.idle.add(updateHints, 'lib-hints'); amb.focus(cur()); }   // amb: nur merken (Wechsel nach Ruhe)
    function moveTo(i) { placeRing(grid.focusTo(i)); afterMove(); }
    function setChip(i, force) {
      if (!chips.length) return;
      if (!force && chips[cf]) U.cls(chips[cf].el, 'is-focus', false);
      cf = U.clamp(i, 0, chips.length - 1);
      U.cls(chips[cf].el, 'is-focus', true);
    }
    /* ▲ aus der ersten Reihe: auf den aktiven Reiter (TV-Test 29.10.: landete auf "Sortieren & Filter", ▶ dann auf "Alle abspielen"
     * und ein OK spielte sofort ab). Ohne Reiter: "Sortieren & Filter", sonst der erste Chip. Nie direkt "Alle abspielen". */
    function upChip() {
      for (var i = 0; i < chips.length; i++) if (chips[i].act) return i;
      for (i = 0; i < chips.length; i++) if (chips[i].id === 'sort') return i;
      return 0;
    }
    function toChips() {
      if (!chips.length) return;
      zone = 'chips'; grid.setFocused(false); ring.hide();
      setChip(upChip(), true);
      N.router.refreshHints();
    }
    function toGrid() {
      if (zone === 'chips' && chips[cf]) U.cls(chips[cf].el, 'is-focus', false);
      if (zone === 'reg') { zone = ''; }
      zone = 'grid';
      if (n > 0) { grid.setFocused(true); placeRing(grid.ringPos()); }
      paintReg(true);
      N.router.refreshHints();
    }
    function toReg() {
      zone = 'reg'; grid.setFocused(false); ring.hide();
      regCh = L.letterAt(chars, grid.f, prefs.desc);
      paintReg(true);
      N.router.refreshHints();
    }

    /* ---------- Aktionen ---------- */
    function cur() { return n > 0 ? grid.item(grid.f) : null; }
    function open(it) {
      if (!it) return;
      if (it.ext && xsrc && xsrc.open && xsrc.open(it)) return;          // Reiter mit Quelle: z. B. schon vorhandener Titel -> echte Seite
      if (it.ext) { N.router.push('extdetails', { it: it, rail: s.rail }); return; }   // Titel ausserhalb des Servers (Erweiterungs-Reiter); Marke bleibt auf der Bibliothek (TV-Test 29.10.)
      if (it.type === 'collection') { N.router.push('library', { lib: lib, coll: { rk: it.rk, title: it.title } }); return; }
      if (list && (list.src === 'cw' || list.src === 'deck') && M.isLeaf(it)) { N.player.play(it, 'ask'); return; }   // wie auf der Startseite: OK spielt ab
      if (music && N.music.open(it)) return;
      N.details.open(it);
    }
    function setPrefs(p) {
      prefs = p;
      if (keep()) L.save(libKey, prefs);
      reload();
    }
    function resetFilter() { var p = U.extend({}, prefs); p.f = { status: '' }; params.actor = null; setPrefs(p); }
    function sortEntries() {
      var out = [];
      var ss = L.sorts(qlib());
      for (var i = 0; i < ss.length; i++) {
        var d = ss[i], sel = prefs.sort === d.id;
        var t = d.id === 'title' ? N.t(sel && prefs.desc ? 'lib.sort.titleDesc' : 'lib.sort.title') : L.sortName(d, qlib());
        out.push({ id: d.id, t: t, s: sel && !d.fixed ? N.t('lib.sort.hint') : '', sel: sel });
      }
      return out;
    }
    function filterEntries() {
      var f = prefs.f || {}, out = [], i;
      for (i = 0; i < L.STATUS.length && !music; i++) out.push({ id: 'st:' + L.STATUS[i], t: N.t('lib.filter.' + (L.STATUS[i] || 'all')), sel: (f.status || '') === L.STATUS[i] });
      var ls = L.lists(qlib());
      for (i = 0; i < ls.length; i++) out.push({ id: 'ls:' + ls[i].id, t: N.t('lib.filter.' + ls[i].id), s: f[ls[i].id] ? f[ls[i].id].t : N.t('lib.filter.any'), sel: !!f[ls[i].id] });
      if (f.actor) out.push({ id: 'actor', t: N.t('lib.filter.with', { name: f.actor.t }), s: N.t('lib.filter.remove'), sel: true });
      out.push({ id: 'reset', t: N.t('lib.filter.reset') });
      return out;
    }
    function viewEntries() {
      var out = [], cur = L.view(prefs);
      var V = N.GridMath.VIEWS;
      for (var i = 0; i < V.length; i++) out.push({ id: V[i], t: N.t('lib.view.' + V[i]), sel: cur === V[i] });
      return out;
    }
    function setView(id) { var pv = U.extend({}, prefs); pv.view = id; restoreF = grid.f; prefs = pv; if (keep()) L.save(libKey, prefs); reload(true); }
    /* HOME-14-Listen: nur "Ansicht" (Gross/Mittel/Klein/Liste) wie in der Bibliothek, gilt fuer diesen Besuch */
    function viewPanel() {
      N.ui.tabPanel.open({ title: N.t('lib.chipView'), tab: 0, tabs: [{ t: N.t('lib.panel.tabView'), entries: viewEntries }], keys: { RED: function () {} },
        onPick: function (t, id) { setView(id); return true; } });
    }
    function sortFilter(tab) {
      if (viewOnly()) { viewPanel(); return; }
      if (xPanel()) { xSortFilter(tab); return; }
      if (mode() !== 'lib') return;
      N.ui.tabPanel.open({ title: N.t('lib.chip'), tab: tab || 0,
        tabs: [{ t: N.t('lib.panel.tabSort'), entries: sortEntries }, { t: N.t('lib.panel.tabFilter'), entries: filterEntries }, { t: N.t('lib.panel.tabView'), entries: viewEntries }],
        keys: { RED: function () {} },
        onPick: function (t, id) {
          if (t === 0) { setPrefs(L.pickSort(prefs, id, qlib())); return true; }
          if (t === 2) { setView(id); return true; }
          var p = U.extend({}, prefs); p.f = U.extend({}, prefs.f || {});
          if (id.indexOf('st:') === 0) { p.f.status = id.slice(3); setPrefs(p); return true; }
          if (id === 'actor') { delete p.f.actor; params.actor = null; setPrefs(p); return true; }
          if (id === 'reset') { p.f = { status: '' }; params.actor = null; setPrefs(p); return false; }
          if (id.indexOf('ls:') === 0) { pickValue(id.slice(3)); return false; }
          return false;
        } });
    }
    /* Sortieren & Filter eines Reiters mit Quelle: Reiter der Quelle + "Ansicht" (wie die Bibliothek). onPick der Quelle: true = offen
     * lassen; ctx.reload() laedt neu (Fokus auf den Anfang), ctx.reopen(t) oeffnet das Panel wieder (z. B. nach einer Werteliste) */
    function xSortFilter(tab) {
      var src = xsrc, tabs = src.tabs(), vi = tabs.length;
      var ctx = { reload: function () { if (src === xsrc && !dead) { restoreF = 0; reload(); } }, reopen: function (t) { if (src === xsrc && !dead && !away) xSortFilter(t); } };
      N.ui.tabPanel.open({ title: N.t('lib.chip'), tab: Math.min(tab || 0, vi),
        tabs: tabs.concat([{ t: N.t('lib.panel.tabView'), entries: viewEntries }]),
        keys: { RED: function () {} },
        onPick: function (t, id) {
          if (t === vi) { setView(id); return true; }
          return src.pick(t, id, ctx);
        } });
    }
    /* Werte eines Zusatzfilters vom Server (lazy), Auswahl-Panel; RETURN -> zurueck ins Filter-Panel */
    function pickValue(lid) {
      var def = null, ls = L.lists(qlib());
      for (var i = 0; i < ls.length; i++) if (ls[i].id === lid) def = ls[i];
      if (!def) return;
      get('/library/sections/' + lib.id + '/' + def.key, { type: L.typeNum(qlib()) }, null, function (err, d) {
        if (dead || away) return;
        var vals = err ? [] : L.values(d), cur0 = prefs.f && prefs.f[lid], e = [{ id: '', t: N.t('lib.filter.any') }];
        if (err) { N.ui.toast.show(N.t('toast.actionFailed')); return; }
        for (var j = 0; j < vals.length; j++) e.push({ id: vals[j].id, t: vals[j].t });
        N.ui.panel.select({ title: N.t('lib.filter.' + lid), entries: e, selected: cur0 ? cur0.id : '',
          onCancel: function () { sortFilter(1); },
          onSelect: function (v) {
            var p = U.extend({}, prefs); p.f = U.extend({}, prefs.f || {});
            if (!v) delete p.f[lid]; else for (var k = 0; k < vals.length; k++) if (vals[k].id === v) p.f[lid] = { id: v, t: vals[k].t };
            setPrefs(p);
          } });
      });
    }
    /* Alle abspielen / Zufall: Play-Queue ueber den PMS (sortiert/gefiltert wie das Raster) */
    function playAll(shuffle) {
      var mid = srv || N.session.state.server && N.session.state.server.machineId;   // Weitere Server: Queue auf DEM Server
      if (music && !coll) { N.music.playLib(lib, shuffle); return; }   // M4: lokale Warteschlange (kein Play-Queue-POST)
      if (!mid || n <= 0) return;
      var uri = coll ? 'server://' + mid + '/com.plexapp.plugins.library/library/collections/' + coll.rk + '/children' : L.queueUri(mid, lib, prefs);
      N.ui.toast.show(N.t('common.loading'));
      N.plex.pms('POST', '/playQueues', { type: 'video', uri: uri, shuffle: shuffle ? 1 : 0, continuous: 0, includeChapters: 0 }, N.srv.o(srv, { retries: 0, dedupe: false, timeout: 15000 }), function (err, d) {
        var mc = !err && d && d.MediaContainer;
        if (dead || away) return;
        if (!mc || !mc.Metadata || !mc.Metadata.length) { N.ui.toast.show(N.t('toast.actionFailed')); return; }
        N.ui.toast.hide();
        N.details.playQueue(mc);
      });
    }
    function toggleWatched() {
      var it = cur(), idx = grid.f;
      if (!it || it.ext || !M.isVideo(it)) return;
      var st = prefs.f && prefs.f.status;
      N.watch.toggle(it, {
        changed: function (x, w) {
          // Filter "Ungesehen"/"Gesehen": Karte verschwindet (SPEC 6.3.1)
          if (mode() === 'lib' && ((st === 'unwatched' && w) || (st === 'watched' && !w) || (st === 'started' && w))) {
            if (!grid.removeAt(idx)) { n = 0; showEmpty(); } else { n = grid.n; placeRing(grid.ringPos()); }
            paintStatus();
          } else grid.refresh(idx, idx);
          N.idle.add(updateHints, 'lib-hints'); amb.focus(cur());
        },
        reverted: function (x) {
          if (grid.items[idx] !== x && grid.items.indexOf(x) < 0) { sb.hide(); if (zone === 'state') zone = 'grid'; grid.setFocused(true); grid.insertAt(Math.min(idx, grid.n), x); n = grid.n; placeRing(grid.ringPos()); paintStatus(); }
          else grid.refresh(0, grid.n - 1);
          N.idle.add(updateHints, 'lib-hints');
        }
      });
    }
    function menu() {
      var it0 = zone === 'grid' ? cur() : null;
      if (!it0 || !N.anime.menuOn(it0)) { menuOpen(it0); return; }
      N.anime.ensure(it0, function () { if (cur() === it0 && N.router.top() === s && !N.router.hasOverlay()) menuOpen(it0); });   // Einordnung fuer "Als Anime behandeln"
    }
    function menuOpen(it) {
      var b = [];
      var pl = it && !it.ext;                          // Titel ausserhalb des Servers: nur "Details"
      if (pl && (M.isLeaf(it) || N.music.isAudio(it))) b.push({ id: 'play', t: N.t('menu.play') });
      if (pl && M.isLeaf(it) && M.progress(it) > 0) b.push({ id: 'start', t: N.t('menu.fromStart') });
      if (pl && M.isVideo(it)) b.push({ id: 'watched', t: N.t(M.watched(it) ? 'menu.markUnwatched' : 'menu.markWatched') });
      if (pl) b = b.concat(N.anime.menuButtons(it));
      if (it && it.ext && xsrc && xsrc.menu) b = b.concat(xsrc.menu(it));   // Reiter mit Quelle: eigene Aktionen der Erweiterung
      if (it) b.push({ id: 'info', t: N.t('menu.info') });
      if (mode() !== 'colls' && mode() !== 'x' && mode() !== 'list' && n > 0) { b.push({ id: 'all', t: N.t('lib.playAll') }); b.push({ id: 'shuffle', t: N.t('lib.shuffle') }); }
      if (mode() === 'lib' || xPanel()) b.push({ id: 'sort', t: N.t('lib.chip') });
      else if (viewOnly()) b.push({ id: 'sort', t: N.t('lib.chipView') });
      if (!coll && !list && !srv && N.session.isAdmin() && !xsrc) b.push({ id: 'scan', t: N.t('menu.scanLib') });
      if (!b.length) return;
      N.ui.dialog.open({ title: it ? it.title : (coll ? coll.title : lib.title), buttons: b, vertical: true, focus: 0, top: 120,
        onSelect: function (id) {
          if (id === 'play') N.details.play(it, 'ask');
          else if (id === 'start') N.details.play(it, 'start');
          else if (id === 'watched') toggleWatched();
          else if (id === 'info') open(it);
          else if (id === 'all') playAll(false);
          else if (id === 'shuffle') playAll(true);
          else if (id === 'sort') sortFilter(0);
          else if (id === 'scan') N.scan.start(lib.id);
          else if (xsrc && xsrc.act && xsrc.act(id, it, function () { var j = grid.items.indexOf(it); if (j >= 0 && !dead) grid.refresh(j, j); })) return;
          else N.anime.menuPick(id, it);
        } });
    }
    function chipAct(id) {
      if (id === 'sort' || id === 'view') sortFilter(0);
      else if (id === 'all') playAll(false);
      else if (id === 'shuffle') playAll(true);
      else if (id === 'tab-lib' || id === 'tab-coll' || id === 'tab-alt') {
        var t = id.slice(4), wasX = !!xtab;
        xtab = ''; xsrc = null;
        if (t !== prefs.tab) { var p = U.extend({}, prefs); p.tab = t; cf = chipIndex(id); setPrefs(p); }
        else if (wasX) { cf = chipIndex(id); restoreF = 0; reload(); }
      }
      else if (id.indexOf('tab-x-') === 0 && id.slice(6) !== xtab) {
        xtab = id.slice(6); xsrc = null;
        var xt = xtabs();
        for (var i = 0; i < xt.length; i++) if (xt[i].id === xtab) xsrc = xt[i].src || null;
        cf = chipIndex(id); restoreF = 0; reload();
      }
    }

    /* ---------- Hinweisleiste ---------- */
    s.hints = function () {
      if (sb.on && zone === 'state') return [{ k: 'blue', t: 'hint.search' }, { k: 'ret', t: 'hint.back' }];
      var it = zone === 'grid' ? cur() : null, list = [];
      if (mode() === 'lib' || xPanel()) list.push({ k: 'red', t: 'hint.sort' });
      else if (viewOnly()) list.push({ k: 'red', t: 'hint.view' });
      if (it && !it.ext && M.isVideo(it)) list.push({ k: 'yellow', t: M.watched(it) ? 'hint.markUnwatched' : 'hint.markWatched' });
      list.push({ k: 'blue', t: 'hint.search' });
      if (it) list.push({ k: 'INFO', t: 'hint.details' });
      if (list.length < 5) list.push({ k: 'TOOLS', t: 'hint.options' });
      return list;
    };

    /* ---------- Lebenszyklus ---------- */
    s.enter = function (p, restore) {
      away = false;
      amb.enter();                                     // Einstellung pruefen; Zufallsbild einmal je Oeffnen
      if (!prefs) {
        prefs = startPrefs();
        if (params.actor) { prefs = U.extend({}, prefs); prefs.tab = 'lib'; prefs.f = { status: '', actor: params.actor }; }
        if (params.view) { prefs = U.extend({}, prefs); prefs.view = params.view; }   // Messlauf (P7): Ansicht nur fuer diesen Aufruf
        if (restore) { restoreF = restore.f || 0; if (restore.prefs) prefs = restore.prefs; }
        if (!coll && !params.actor && !list) checkColls();
        if (music && !coll && !list) N.music.probeLib(lib, function (b) { if (!dead && b !== book) { book = b; if (!restore) prefs = startPrefs(); reload(true); } });
        if (list && list.src === 'x') xsrc = N.ext.has('lib:list') ? N.ext.call('lib:list', list) || null : null;   // HOME-14 Erweiterungs-Liste
        if (params.xtab && !restore) { var xl = xtabs(); for (var xi = 0; xi < xl.length && !xtab; xi++) if (xl[xi].id === params.xtab || (params.xtab === '*' && xl[xi].src)) { xtab = xl[xi].id; xsrc = xl[xi].src || null; } }
        reload(true);
        return;
      }
      if (!pages) { reload(true); return; }
      if (fresh()) return;
      if (mode() === 'x') xRepaint();                  // Rueckkehr von der Detailseite (z. B. Anfrage zurueckgezogen): Liste aus dem Speicher
      else if (N.ext.has('lib:tabs')) buildChips();    // Reiter der Erweiterung kann inzwischen da sein
      if (zone === 'grid' && n > 0) { grid.setFocused(true); placeRing(grid.ringPos()); grid.refresh(Math.max(0, grid.f - 10), Math.min(n - 1, grid.f + 15)); }
      N.router.refreshHints();
    };
    /* LIB-10: Inhalt der Bibliothek auf dem Server geaendert (N.libwatch)? Nur beim (Wieder-)Betreten, nie waehrend man darin ist:
     * Stand schon bekannt und anders -> sofort einmal neu laden (fokussierter Titel bleibt fokussiert); sonst hoechstens alle 60 s
     * eine kleine Anfrage im Leerlauf – kommt die Antwort, bevor eine Taste gedrueckt wurde, wird gleich neu geladen, sonst beim
     * naechsten Betreten. Reiter einer Erweiterung und Bibliotheken weiterer Server: unveraendert. */
    function changed() { var sg = N.libwatch.sig(lib.id); if (!loadSig && sg) loadSig = sg; return !!(loadSig && sg && sg !== loadSig); }
    function relaunch() { var it = cur(); restoreRk = it ? it.rk : null; restoreF = grid.f; reload(true); }
    function fresh() {
      if (srv || mode() === 'x' || list || n < 0) return false;
      if (changed()) { relaunch(); return true; }
      keyed = false;
      var g = gen;
      N.idle.add(function () {
        if (dead || away || g !== gen) return;
        N.libwatch.check(function () { if (!dead && !away && g === gen && !keyed && changed()) relaunch(); });
      }, 'lib-watch');
      return false;
    }
    /* Gibt es Sammlungen? (nur dann den Reiter zeigen) */
    function checkColls() {
      get('/library/sections/' + lib.id + '/collections', { 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 0 }, null, function (err, d) {
        if (dead || err || !d || !d.MediaContainer) return;
        var c = Number(d.MediaContainer.totalSize || d.MediaContainer.size) || 0;
        if (c !== collN) { collN = c; if (!c && prefs.tab === 'coll') { prefs.tab = 'lib'; reload(); } else buildChips(); }
      });
    }
    s.leave = function () {
      away = true;
      if (regT) { clearTimeout(regT); regT = 0; }
      return { f: grid.f, prefs: params.actor || once || list ? prefs : null };   // nicht gemerkte Ansicht: Stand fuer die Rueckkehr
    };
    s.destroy = function () {
      dead = true; gen++; abortAll();
      if (onScanned) N.evt.off('library:scanned', onScanned);
      if (bubbleTm) clearTimeout(bubbleTm);
      amb.destroy();
      grid.clear();
    };
    s.railBlur = function () { railOpen = true; ring.hide(); grid.setFocused(false); if (zone === 'chips' && chips[cf]) U.cls(chips[cf].el, 'is-focus', false); };
    s.railFocus = function () {
      railOpen = false;
      if (zone === 'chips') { setChip(cf, true); return; }
      if (zone === 'grid' && n > 0) { grid.setFocused(true); placeRing(grid.ringPos()); }
    };
    /* RETURN oben angekommen (NAV-5): Bereich aus der Seitenleiste -> N.app.sectionBack (Start bzw. vorheriger Bereich), Sammlung/Person -> zurueck */
    function up() { if (params.sec && !sub) N.app.sectionBack(); else N.router.back(); }

    s.onKey = function (k) {
      keyed = true;
      if (N.keys.isDigit(k)) { if (zone === 'grid' || zone === 'reg') digit(k); return true; }
      if (k === 'BLUE') { N.router.push('search'); return true; }
      if (zone === 'state') {
        if (sb.onKey(k)) return true;
        if (k === 'UP' && chips.length) { zone = 'chips'; setChip(cf, true); N.router.refreshHints(); return true; }
        if (k === 'LEFT') { if (s.rail) N.ui.rail.open(); return true; }
        if (k === 'RED') { sortFilter(0); return true; }
        if (k === 'RETURN') { up(); return true; }
        return true;
      }
      if (zone === 'chips') {
        switch (k) {
          case 'LEFT': if (cf > 0) setChip(cf - 1); else if (s.rail) { U.cls(chips[cf].el, 'is-focus', false); N.ui.rail.open(); } return true;
          case 'RIGHT': if (cf < chips.length - 1) setChip(cf + 1); return true;
          case 'DOWN': if (n > 0) toGrid(); else if (sb.on && sb.ids.length) { U.cls(chips[cf].el, 'is-focus', false); zone = 'state'; } return true;
          case 'ENTER': chipAct(chips[cf].id); return true;
          case 'RED': sortFilter(0); return true;
          case 'TOOLS': menu(); return true;
          case 'RETURN': if (n > 0) toGrid(); else up(); return true;
        }
        return true;
      }
      if (zone === 'reg') {
        switch (k) {
          case 'UP': case 'DOWN': regCh = L.regStep(chars, regCh, k === 'UP' ? -1 : 1, false); paintReg(true); return true;
          case 'ENTER': jumpTo(regCh); return true;
          case 'LEFT': case 'RETURN': toGrid(); return true;
        }
        return true;
      }
      if (n <= 0) { if (k === 'LEFT' && s.rail) N.ui.rail.open(); else if (k === 'RETURN') up(); return true; }
      var f = grid.f, it = cur(), nx;
      switch (k) {
        case 'LEFT': if (G.col(f) > 0) moveTo(f - 1); else if (s.rail) N.ui.rail.open(); return true;
        case 'RIGHT':
          nx = G.move(f, n, 'RIGHT');
          if (nx >= 0) moveTo(nx); else if (regOn()) toReg();
          return true;
        case 'UP': nx = G.move(f, n, 'UP'); if (nx >= 0) moveTo(nx); else toChips(); return true;
        case 'DOWN': nx = G.move(f, n, 'DOWN'); if (nx >= 0) moveTo(nx); return true;
        case 'FF': case 'CH_DOWN': moveTo(G.jumpRows(f, n, 3)); return true;
        case 'RW': case 'CH_UP': moveTo(G.jumpRows(f, n, -3)); return true;
        case 'ENTER': open(it); return true;
        case 'INFO': if (list && it && !it.ext && M.isLeaf(it)) N.details.open(it); else open(it); return true;   // HOME-14: INFO in Weiterschauen = Details, nicht abspielen
        case 'PLAY': if (it && !it.ext) N.details.play(it, 'resume'); return true;
        case 'RED': sortFilter(0); return true;
        case 'YELLOW': toggleWatched(); return true;
        case 'TOOLS': menu(); return true;
        case 'RETURN':
          if (G.row(f) > 0) moveTo(G.col(f));                      // RETURN-Kette (6.2): Zeile 1, gleiche Spalte
          else up();
          return true;
      }
      return true;
    };

    /* ---------- Zeiger (Index-Mathe) ---------- */
    s.pointer = function (x, y, kind) {
      keyed = true;
      if (sb.on && zone === 'state') return sb.pointer(x, y, kind);
      if (y >= 120 && y < 152 && chipRects) {
        for (var i = 0; i < chipRects.length; i++) if (x >= chipRects[i][0] && x < chipRects[i][0] + chipRects[i][1]) {
          if (zone !== 'chips') { zone = 'chips'; paintReg(true); grid.setFocused(false); ring.hide(); setChip(i, true); N.router.refreshHints(); }
          else if (i !== cf) setChip(i);
          if (kind === 'click') chipAct(chips[i].id);
          return true;
        }
        return false;
      }
      if (regOn() && x >= REG_X && x < REG_X + 56 && y >= REG_Y && y < REG_Y + LETTERS.length * REG_STEP) {
        var lt = LETTERS.charAt(Math.floor((y - REG_Y) / REG_STEP));
        if (kind === 'click' && L.present(chars).indexOf(lt) >= 0) jumpTo(lt);
        return true;
      }
      if (n <= 0) return false;
      var ez = s.pointerEdge(x, y);
      if (ez) { if (kind === 'click') s.pointerScroll(ez.d); return true; }   // Randzone: rollt (Verweilen/Klick), fokussiert nicht
      var j = G.hit(n, grid.r, x, y);
      if (j < 0) { N.pointer.holdCancel(); return false; }
      if (G.row(j) - grid.r >= grid.hitRows()) {                          // angeschnittene, aber zeigbare Zeile (G.part)
        if (kind === 'click') { reveal(j); open(grid.item(j)); return true; }
        N.pointer.hold(function () { if (!dead && G.hit(n, grid.r, N.pointer.x, N.pointer.y) === j) reveal(j); });   // ~250 ms: Vorbeiziehen loest nichts aus
        return true;
      }
      N.pointer.holdCancel();
      if (zone !== 'grid') toGrid();
      if (j !== grid.f) { N.fx.step(true); placeRing(grid.focusTo(j, true)); afterMove(); }   // still: Liste rollt nicht unter dem Punkt
      if (kind === 'click') open(grid.item(j));
      return true;
    };
    /* Zeiger-Rollen nur ueber Randzonen (TV-Befund 27.10. nachmittags): oben Streifen y 154–196 (unter den Chips, oberer Rand der
     * Fokuszeile), unten schmales Band y 604–656 ueber der Hinweisleiste (bzw. ab einer nicht zeigbaren Zeile, G.edgeB), jeweils
     * ueber der Rasterbreite; Anzeige-Pille mittig in der Zone */
    /* angeschnittene Zeile per Zeiger: EINE Zeile rollen, dann fokussieren (Ring erst jetzt, nie ueber Band/Hinweisleiste);
     * danach Zeiger-Sperre (Inhalt ist unter dem Punkt gewandert) -> keine Rueckkopplung */
    function reveal(j) {
      if (zone !== 'grid') toGrid();
      N.fx.step(true);
      grid.scrollBy(1);
      placeRing(grid.focusTo(j, true)); afterMove();
      N.pointer.scrolled();
    }
    s.pointerSig = function () { return grid.r; };
    s.pointerEdge = function (x, y) {
      if (n <= 0 || (sb.on && zone === 'state') || zone === 'reg' || railOpen) return null;
      var w = G.width(), cx = G.X0 + Math.round(w / 2);
      if (x < G.X0 || x >= G.X0 + w) return null;
      if (y >= 154 && y < G.Y0 + 20 && grid.canScroll(-1)) return { d: -1, x: cx, y: 176 };
      if (y >= G.edgeB() && y < 656 && grid.canScroll(1)) return { d: 1, x: cx, y: 628 };
      return null;
    };
    s.pointerScroll = function (d) {
      if (zone !== 'grid') toGrid();
      placeRing(grid.scrollBy(d)); afterMove();
    };
    s.relabel = function () { buildChips(); paintStatus(); };
    return s;
  });
})(N);
