/* Ansicht 'details' – Film- und Seriendetails (SPEC 7.6–7.7, 5.20, 6.1, 6.5, 15; Mockup show-details.html; plex-parity 3.2 Nr. 8).
 * - Info-Block x 144: Ueberzeile (Amber), Titel, Metazeile, Beschreibung (2 Zeilen), Technik-Chips, Buttons y 260
 *   (Fortsetzen/Abspielen, Von vorne, Trailer, Gesehen, "⋯"). Hintergrund 640x360 blur=24 + Scrim, ohne translate3d.
 * - Serie: Staffel-Reiter y 332 (scrollendes Fenster, Specials zuletzt), Staffelstreifen M + Zaehltext + Serien-Balken (abschaltbar
 *   ueber "Folgen-Fortschritt anzeigen"), Folgenreihe y 392 (Seiten je 50, Platzhalter, Ziffern = Folge Nr., FF/RW ±5, CH ±25).
 *   Info-Block folgt der fokussierten Folge nach 300 ms Ruhe, Buttons dann gedimmt.
 * - Darunter Reihen Besetzung (OK = Bibliothek "mit <Person>"), Extras (OK spielt), Aehnliche Titel; Seite scrollt per translate3d.
 * - Farbtasten: Rot Von vorne, Gruen Ton & UT (gemerkt je Serie bzw. Film, gilt beim naechsten Start), Gelb Gesehen, Blau Suche.
 * - Titelmelodie (Einstellung, Standard aus): einmal, ausgeblendet beim Verlassen und vor der Wiedergabe.
 * params: {it: normalisiertes Item (movie|show|season|episode)} */
(function (N) {
  var U = N.util, M = N.model, D = N.det, REST = 300, ANCHOR = 340, SEC = 248, PEEK = 580;
  var PITCH = { land: 288, poster: 360, cast: 248 };

  N.router.define('details', function (params) {
    var it0 = params.it || {}, isShow = it0.type === 'show' || it0.type === 'season' || it0.type === 'episode';
    var showRk = it0.type === 'show' ? it0.rk : it0.showRk || it0.rk;
    // Seitenleiste auch hier (Nutzer-Feedback 26.10.: links nicht leer, LEFT aus der ersten Spalte erreicht sie); markiert die Bibliothek
    // ohne Bibliothek am Eintrag: bisherige Markierung halten, nach dem Laden die Bibliothek der Metadaten (TV-Befund 26.10.)
    // Weitere Server (N.srv): Titel eines fremden Servers -> alle Anfragen dorthin, Herkunft in der Ueberzeile
    var srv = it0.srv || '';
    function get(path, q, o, cb) { return N.plex.get(path, q, N.srv.o(srv, o), cb); }
    function railId(lib) { return N.railRows.libId({ id: lib, srv: srv }); }
    function ovl(t) { return srv ? t + ' · ' + N.srv.name(srv) : t; }
    function ak(k) { return N.srv.skey(srv, k); }          // Anime-Signale: Schluessel je Server
    var s = { rail: it0.lib ? railId(it0.lib) : N.ui.rail && N.ui.rail.cur || 'home', wheelKeys: ['LEFT', 'RIGHT'] };
    var root, hero, pg, bar, btns = [], bdefs = [], btnRects = null, blbl, blblT;
    var tclip, tstrip, tabEls = [], tabX = [], strip, stripT, sbar, segs = [], epRow = null, rows = [], ring, sb, bubble, bubbleT;
    var d = null, seasons = [], sIdx = 0, tabF = 0, eps = [], epsTotal = 0, epPages = {}, seasonCache = new N.LRU(10), gen = 0, tasks = [];
    var zone = 'btn', bf = 0, rk = 0, off = 0, infoFor = null, infoT = 0, seasonT = 0, dead = false, away = false, dirty = false;
    var wishS = it0.type === 'season' ? it0.s : it0.type === 'episode' ? it0.s : null, wishE = it0.type === 'episode' ? it0.e : 0;
    var jump = { digits: '', t: 0 }, bubbleTm = 0, onPlayed = null, onWatched = null, onAnime = null, epMeta = new N.LRU(30);

    /* ---------- Aufbau ---------- */
    s.create = function (el) {
      root = el;
      /* Hintergrund, Poster links (fest, blendet in den Abschnitten aus) und Info-Block: gemeinsame Mechanik N.ui.DetHero
       * (auch Album/Hoerbuch/Kuenstler; Feedback-Regeln 3 und 11) */
      hero = new N.ui.DetHero(root);
      pg = U.el('div', 'pg', root);
      hero.makeInfo(root, { chips: 2 });
      var i;
      bar = U.el('div', 'd-btns', pg);
      blbl = U.el('div', 'blbl', pg, 'display:none'); blblT = document.createTextNode(''); blbl.appendChild(blblT);
      if (isShow) {
        var sec = U.el('div', 'dsec', pg);               // Abschnitt Staffeln/Folgen: auf dem ersten Bildschirm nur angeschnitten (y 580)
        tclip = U.el('div', 'd-tclip', sec); tstrip = U.el('div', 'd-tstrip', tclip);
        strip = new N.ui.SeasonStrip(sec, 'M', 800, 336, true);
        stripT = U.txt('div', 'd-sst t-small c2', sec, '');
        sbar = U.el('div', 'd-sbar', sec, 'display:none');
        for (i = 0; i < 40; i++) { var sg = U.el('div', 'ss-seg', sbar, 'display:none'); segs.push({ el: sg, fill: U.el('i', '', sg) }); }
        epRow = new N.ui.Row(sec, { noHead: true, caption: D.epCaption });
        epRow.setTop(ANCHOR);
      }
      var fade = U.el('img', 'fade', root); fade.src = N.assetBase + 'fade-bottom.png';
      bubble = U.el('div', 'jump', root, 'display:none'); bubbleT = document.createTextNode(''); bubble.appendChild(bubbleT);
      ring = new N.ui.Ring(root);
      sb = new N.ui.StateBlock(root);
      onPlayed = function () { dirty = true; };
      N.evt.on('playback:stopped', onPlayed);           // Rueckkehr aus dem Player: Fortschritt neu laden
      onWatched = function () { if (away) dirty = true; };
      N.evt.on('watched:changed', onWatched);
      onAnime = function () { if (infoFor && !dead) paintInfo(infoFor); };
      N.evt.on('anime:changed', onAnime);              // "Als Anime behandeln": Ueberzeile sofort anpassen
      paintInfo(it0);
      buildButtons(it0);
    };

    /* ---------- Info-Block ---------- */
    function paintInfo(x) {
      infoFor = x;
      var ep = x.type === 'episode' && isShow;
      var media = ep ? (epMeta.get(x.rk) || {}).media : d && d.it === x ? d.media : null;
      // Spoilerschutz (P5): ungesehene Folge -> Hinweis statt Beschreibung (INFO zeigt den Text)
      hero.paint(ovl(ep ? D.overline(x) : D.overline(x, d)), ep ? N.t('det.epTitle', { e: x.e, title: x.epTitle }) : x.title,
        D.meta(x, ep ? epMeta.get(x.rk) || null : d), ep ? N.comfort.summary(x) : d ? d.sum : x.sum,
        { small: ep, chips: media ? D.chips(media, vIndex(x.rk, media)) : [] });
    }
    /* gewaehlte bzw. automatisch passende Datei (SPEC 7.6, N.versions) */
    function vIndex(rk0, media) {
      if (!media || media.length < 2) return 0;
      var q = N.decision.QUAL[(N.session.settings || {}).quality] || N.decision.QUAL['12'];
      return N.versions.choose(rk0, media, q[0]) || 0;
    }
    /* Folgen-Info nach 300 ms Ruhe (Tasten blaettern ohne Neuzeichnen) */
    function infoLater(x) {
      if (infoT) clearTimeout(infoT);
      infoT = setTimeout(function wait() {
        infoT = 0;
        if (N.idle.restFor() < REST) { infoT = setTimeout(wait, REST - N.idle.restFor()); return; }
        if (x !== infoFor) paintInfo(x);
        if (x.type === 'episode' && !x.ph) { paintStrip(); prefetchEp(x); }
      }, REST);
    }
    /* Folgen-Metadaten (Chips, Erstausstrahlung, Spuren) im Voraus (LRU 30, Player nutzt sie nicht doppelt) */
    function prefetchEp(x) {
      if (!x.rk || epMeta.get(x.rk)) return;
      var g = gen;
      track(get('/library/metadata/' + x.rk, { includeMarkers: 1, excludeElements: 'Role,Director,Writer,Producer,Country,Genre' }, null, function (err, dd) {
        var m = !err && dd && dd.MediaContainer && dd.MediaContainer.Metadata && dd.MediaContainer.Metadata[0];
        if (!m || g !== gen) return;
        if (x.showRk) N.anime.noteAudio(ak(x.showRk), N.anime.jaAudio(m.Media));   // Serien-Metadaten haben keine Spuren
        epMeta.set(x.rk, { media: m.Media || [], date: String(m.originallyAvailableAt || ''), sum: String(m.summary || ''), genres: [], directors: [], writers: [] });
        if (infoFor === x) paintInfo(x);
      }));
    }

    /* ---------- Buttons ---------- */
    function buildButtons(x) {
      while (bar.firstChild) bar.removeChild(bar.firstChild);
      bdefs = D.buttons(x, d); btns = []; btnRects = null;
      for (var i = 0; i < bdefs.length; i++) {
        var b = U.el('div', bdefs[i].icon ? 'btn inl ib' : 'btn inl', bar);
        if (bdefs[i].icon) N.ui.icon(b, bdefs[i].icon);
        else b.appendChild(document.createTextNode(bdefs[i].t));
        btns.push(b);
      }
      bf = Math.min(bf, btns.length - 1);
      if (zone === 'btn' && !away) U.cls(btns[bf], 'is-focus', true);
      setTimeout(measureButtons, 50);
    }
    function measureButtons() {
      if (dead) return;
      btnRects = [];
      for (var i = 0; i < btns.length; i++) btnRects.push([352 + btns[i].offsetLeft, btns[i].offsetWidth]);
      paintLabel();
    }
    /* Label ueber dem fokussierten Icon-Button (SPEC 5.22): ein Element, left + nodeValue */
    function paintLabel() {
      var on = zone === 'btn' && bdefs[bf] && bdefs[bf].icon && btnRects;
      U.show(blbl, !!on);
      if (on) { U.setText(blblT, N.t('det.btn.more')); blbl.style.left = (btnRects[bf][0] + 24 - 80) + 'px'; }
    }
    function setBtn(i) {
      U.cls(btns[bf], 'is-focus', false); bf = i; U.cls(btns[bf], 'is-focus', true);
      N.fx.move(btns[bf]); paintLabel();
    }
    function dimButtons(on) { U.cls(bar, 'dim', on); U.vis(bar, !on); }   // in den Abschnitten (Seite gescrollt) laegen sie unter dem Info-Block

    /* Hintergrund/Poster: N.ui.DetHero (Art 1280x720 scharf + Scrim, ohne Art Cover unscharf, ohne Bild Farbflaeche je Titel,
     * Einstellung "Hintergrundbilder" aus -> Farbflaeche; Poster-Ladefehler -> Titelkarte) */

    /* ---------- Daten ---------- */
    function track(t) { tasks.push(t); if (tasks.length > 20) tasks.shift(); return t; }
    function srvLibs() { var a = N.srv.libs(), out = []; for (var i = 0; i < a.length; i++) if (a[i].srv === srv) out.push(a[i]); return out; }
    function kinds() { var hc = N.session.homeCache(), k = N.hubs.libKinds(srv ? srvLibs() : hc && (hc.alibs || hc.libs) || []); return k; }
    function load() {
      gen++; var g = gen;
      var mrk = isShow ? showRk : it0.rk;
      track(get('/library/metadata/' + mrk, D.query(isShow ? 'show' : 'movie'), { timeout: 12000 }, function (err, dd) {
        if (g !== gen || dead) return;
        var m = !err && dd && dd.MediaContainer && dd.MediaContainer.Metadata && dd.MediaContainer.Metadata[0];
        if (!m) { onError(err); return; }
        N.anime.learn(ak(mrk), m);                        // Anime je Titel: Signale aus den vollen Detaildaten (Genres ungekuerzt)
        d = D.parse(m, kinds());
        if (!d.lib) d.lib = Number(dd.MediaContainer.librarySectionID) || it0.lib || 0;
        if (!isShow || zone === 'btn') paintInfo(d.it);
        buildButtons(d.it);
        if (d.lib && s.rail !== railId(d.lib)) { s.rail = railId(d.lib); if (N.router.top() === s) N.ui.rail.attach(s.rail); }
        hero.loadBg(d.it.art || it0.art, d.it.thumb || it0.thumb, d.it.title);
        hero.setPoster(d.it.thumb || it0.thumb, d.it.title);   // ohne jedes Bild: Farbflaeche, bis ein Folgenbild kommt
        if (hero.needBg) bgFromEpisodes();
        buildRows();
        if (isShow) N.theme.play(d.theme);
        N.idle.add(updateHints, 'det-hints');
      }));
      if (isShow) track(get('/library/metadata/' + showRk + '/children', { excludeElements: N.hubs.EXCL }, { timeout: 12000 }, function (err, dd) {
        if (g !== gen || dead) return;
        if (err) { N.diag.log('warn', 'seasons ' + (err.status || err.type)); return; }
        seasons = D.seasons(dd);
        buildTabs();
        if (!seasons.length) return;
        var keep = seasons[sIdx] && dirty ? sIdx : D.pickSeason(seasons, wishS, d && d.ondeck);
        selectSeason(keep, true);
      }));
    }
    function onError(err) {
      var kind = N.errs.kind(err, 'pms'), sn = srv ? N.srv.name(srv) : '';
      if (kind === 'auth' && !srv) { N.app.authLost(); return; }   // Kinderprofil-Pruefung wie Startseite (Pentest P6)
      ring.hide();
      var auth = srv && (kind === 'auth' || N.srv.state(srv) === 'auth');   // Weitere Server: Meldung nur fuer diesen Server
      var tx = auth ? { title: N.t('srv.err.auth.title', { server: sn }), text: N.t('srv.err.auth.text', { server: sn }) }
        : srv && kind === 'server' ? { title: N.t('srv.err.down.title', { server: sn }), text: N.t('srv.err.down.text', { server: sn }) }
        : kind === 'server' ? { title: N.t('err.server.title'), text: N.t('lib.err.text', { server: N.session.state.server && N.session.state.server.name || '' }) } : N.errs.texts('generic', null, N.session.isKid());
      // TV-Test 1.0.4: Info-Block (Titel, Metazeile) mit ausblenden – sonst lag die Meldung transparent ueber dem Titel
      U.vis(pg, false); hero.vis(false);
      sb.show({ title: tx.title, text: tx.text, buttons: [{ id: 'retry', t: N.t('err.btn.retry') }, { id: 'back', t: N.t('err.btn.back') }],
        onSelect: function (id) {
          if (id === 'back') { N.router.back(); return; }
          sb.hide(); U.vis(pg, true); hero.vis(true); zone = 'btn';
          if (srv) N.srv.resolve(srv, true, function () { if (!dead) load(); }); else load();   // weiterer Server: Adressen neu pruefen
        } });
      zone = 'state';
    }

    /* ---------- Staffeln ---------- */
    function buildTabs() {
      while (tstrip.firstChild) tstrip.removeChild(tstrip.firstChild);
      tabEls = []; tabX = [];
      for (var i = 0; i < seasons.length; i++) {
        var t = U.el('span', 'tab', tstrip);
        t.appendChild(document.createTextNode(D.tabLabel(seasons[i])));
        tabEls.push(t);
      }
      setTimeout(function () {                            // Positionen EINMAL messen (Scroll-Fenster, Zeiger)
        if (dead) return;
        tabX = [];
        for (var k = 0; k < tabEls.length; k++) tabX.push([tabEls[k].offsetLeft, tabEls[k].offsetWidth]);
        scrollTabs(true);
      }, 50);
    }
    function scrollTabs(jumpNow) {
      if (!tabX.length) return;
      var o = D.tabOffset(tabX, tabF, tstrip._off || 0, 464);
      if (jumpNow) tstrip.style.webkitTransition = 'none'; else N.fx.move(tstrip);
      U.tf(tstrip, -o, 0);
      tstrip._off = o;
    }
    function markTabs() { for (var i = 0; i < tabEls.length; i++) { U.cls(tabEls[i], 'is-cur', i === sIdx); U.cls(tabEls[i], 'is-focus', zone === 'tabs' && i === tabF); } }
    /* Staffel waehlen: Tab sofort, Folgen/Streifen erst nach 300 ms Ruhe (SPEC 7.7) */
    function selectSeason(i, now, focusEp) {
      sIdx = i; tabF = i; markTabs(); scrollTabs(now);
      if (seasonT) clearTimeout(seasonT);
      var run = function () { seasonT = 0; if (!dead) loadSeason(i, focusEp); };
      if (now) run(); else seasonT = setTimeout(function wait() { if (N.idle.restFor() < REST) { seasonT = setTimeout(wait, REST); return; } run(); }, REST);
    }
    function seasonItem(se) { return { rk: se.rk, type: 'season', title: d ? d.it.title : it0.title, s: se.index, leaf: se.leaf, vleaf: se.vleaf, vc: 0, off: 0, dur: 0 }; }
    function loadSeason(i, focusEp) {
      var se = seasons[i]; if (!se) return;
      var c = seasonCache.get(se.rk), g = gen;
      if (c && U.now() - c.ts < 300000 && !dirty) { eps = c.eps; epsTotal = c.total; epPages = c.pages; showEps(focusEp); return; }
      eps = []; epPages = {}; epsTotal = se.leaf || 0;
      for (var k = 0; k < epsTotal; k++) eps.push(D.placeholder(se.index, k + 1));
      showEps(focusEp, true);
      loadEpPage(se, 0, function () { if (g === gen && seasons[sIdx] === se) showEps(focusEp); });
    }
    function loadEpPage(se, p, cb) {
      if (epPages[p]) return;
      epPages[p] = 1;
      var g = gen, list0 = eps;
      track(get('/library/metadata/' + se.rk + '/children', D.seasonQuery(p * 50, 50), { timeout: 12000 }, function (err, dd) {
        if (g !== gen || list0 !== eps) return;
        var mc = !err && dd && dd.MediaContainer;
        if (!mc) { epPages[p] = 0; return; }
        var list = M.normList(mc.Metadata || [], kinds(), mc.librarySectionID || (d && d.lib)), total = Number(mc.totalSize !== undefined ? mc.totalSize : list.length);
        if (total !== epsTotal) { epsTotal = total; while (eps.length < total) eps.push(D.placeholder(se.index, eps.length + 1)); eps.length = total; }
        for (var k = 0; k < list.length; k++) eps[p * 50 + k] = list[k];
        bgFromEpisodes();
        seasonCache.set(se.rk, { eps: eps, total: epsTotal, pages: epPages, ts: U.now() });
        if (cb) cb(); else if (epRow.model && epRow.model.items === eps) { for (k = 0; k < list.length; k++) epRow.refreshItem(p * 50 + k); paintStrip(); }
      }));
    }
    /* Serie ganz ohne Bilder: erstes Folgenbild als Hintergrund (abgedunkelt) */
    function bgFromEpisodes() {
      if (!hero.needBg || !d) return;
      for (var i = 0; i < eps.length && i < 50; i++) if (eps[i] && !eps[i].ph && eps[i].still) { hero.loadBg(eps[i].still); return; }
    }
    function showEps(focusEp, placeholders) {
      var f = placeholders ? 0 : D.pickEpisode(eps, focusEp !== undefined ? focusEp : wishE);
      if (!placeholders) wishE = 0;
      epRow.setModel({ id: 'eps', kind: 'land', tk: 'det.row.episodes', items: eps }, f);
      if (zone === 'eps') { epRow.setFocused(true); placeRing(epRing(epRow.ringPos())); infoLater(eps[epRow.f]); }
      paintStrip();
      ensureEpPages();
      if (!placeholders && it0.type === 'episode' && zone === 'btn' && !s.entered) { s.entered = true; toEps(); }
      if (!placeholders && it0.type === 'season' && zone === 'btn' && !s.entered) { s.entered = true; toTabs(); }
      N.idle.add(updateHints, 'det-hints');
    }
    function ensureEpPages() {
      var se = seasons[sIdx]; if (!se || !epsTotal) return;
      var f = epRow.f, a = Math.floor(Math.max(0, f - 5) / 50), b = Math.floor(Math.min(epsTotal - 1, f + 12) / 50);
      for (var p = a; p <= b; p++) loadEpPage(se, p);
    }
    /* Staffelstreifen M (gewaehlte Staffel, Marker = fokussierte Folge) + Zaehltext + Serien-Balken (SPEC 5.20) */
    function paintStrip() {
      var on = !!(N.session.settings && N.session.settings.episodeProgress), se = seasons[sIdx];
      if (!on || !se) { strip.render({ mode: 'none' }); U.setText(stripT, ''); U.show(sbar, false); return; }
      var foc = zone === 'eps' || zone === 'tabs' ? eps[epRow.f] : null, loaded = D.stripEps(eps);
      var full = loaded.length === epsTotal && epsTotal > 0;
      var lay = N.SeasonStrip.layout({ enabled: true, size: 'M', episodes: full ? loaded : null, total: se.leaf || epsTotal, viewed: se.vleaf,
        next: foc && !foc.ph ? foc.e : d && d.ondeck && d.ondeck.s === se.index ? d.ondeck.e : 0, threshold: N.config.watchedThreshold });
      strip.render(lay);
      var x = 1216 - (lay.width || 0);
      strip.el.style.left = x + 'px';
      var txt = lay.mode === 'bar' ? lay.text : N.t('ss.countUnwatched', { k: Math.max(0, (se.leaf || 0) - (se.vleaf || 0)), n: se.leaf || 0 });
      U.setText(stripT, txt);
      stripT.parentNode.style.width = Math.max(0, x - 16 - 600) + 'px';
      var sbl = N.SeasonStrip.seriesBar(seasons, se.index);
      U.show(sbar, sbl.mode !== 'none');
      for (var i = 0; i < 40; i++) {
        var sg = segs[i], dd = sbl.mode === 'segments' ? sbl.segments[i] : sbl.mode === 'single' && i === 0 ? { x: 0, w: 416, fill: sbl.fill, sel: false } : null;
        U.show(sg.el, !!dd);
        if (!dd) continue;
        sg.el.className = dd.sel ? 'ss-seg sel' : 'ss-seg';
        sg.el.style.left = dd.x + 'px'; sg.el.style.width = dd.w + 'px'; sg.fill.style.width = dd.fill + 'px';
      }
    }

    /* ---------- Reihen unter dem Info-Block ---------- */
    function libOf(id) {
      var hc = N.session.homeCache(), libs = srv ? srvLibs() : hc && hc.libs || [];
      for (var i = 0; i < libs.length; i++) if (libs[i].id === id) return libs[i];
      return { id: id, title: '', type: isShow ? 'show' : 'movie', kind: isShow ? 'show' : 'movie', srv: srv || undefined, srvName: srv ? N.srv.name(srv) : undefined };
    }
    function buildRows() {
      for (var i = 0; i < rows.length; i++) { rows[i].row.clear(); if (rows[i].row.el.parentNode) rows[i].row.el.parentNode.removeChild(rows[i].row.el); }
      rows = [];
      var defs = [];
      if (d.cast.length) defs.push({ id: 'cast', kind: 'cast', tk: 'det.row.cast', items: d.cast });
      if (d.extras.length) defs.push({ id: 'extras', kind: 'land', tk: 'det.row.extras', items: d.extras });
      if (d.related.length) defs.push({ id: 'similar', kind: 'poster', tk: 'det.row.similar', items: d.related[0].items });
      var y = isShow ? SEC + ANCHOR + PITCH.land : PEEK;
      for (i = 0; i < defs.length; i++) {
        var r = new N.ui.Row(pg, { captions: function () { return true; } });
        r.setModel(defs[i], 0); r.setTop(y);
        rows.push({ row: r, top: y, id: defs[i].id });
        y += PITCH[defs[i].kind];
      }
    }

    /* ---------- Zonen & Fokus ---------- */
    function placeRing(p) { if (p && !sb.on) ring.to(p.shape, p.x, p.y - off); }
    function epRing(p) { if (p) p.y += SEC; return p; }   // Folgenreihe liegt im Abschnitt (SEC tiefer)
    /* Info-Block: erster Bildschirm unten (Hero), in den Abschnitten oben (folgt dann der Folge) */
    function heroInfo(on) { hero.hero(on); }
    function setOff(o) { if (o !== off) { off = o; N.fx.move(pg); U.tf(pg, 0, -o); } }
    function updateHints() { N.router.refreshHints(); }
    function leaveZone() {
      if (zone === 'btn') { U.cls(btns[bf], 'is-focus', false); U.show(blbl, false); }
      else if (zone === 'tabs') { zone = ''; markTabs(); }
      else if (zone === 'eps') epRow.setFocused(false);
      else if (zone === 'row' && rows[rk]) rows[rk].row.setFocused(false);
    }
    function toBtn() {
      leaveZone(); zone = 'btn'; setOff(0); heroInfo(true); ring.hide(); dimButtons(false);
      U.cls(btns[bf], 'is-focus', true); paintLabel();
      if (d && infoFor !== d.it) infoLater(d.it);
      markTabs(); N.router.refreshHints();
    }
    function toTabs() {
      if (!seasons.length) return;
      leaveZone(); zone = 'tabs'; setOff(SEC); heroInfo(false); ring.hide(); dimButtons(true);
      tabF = sIdx; markTabs(); scrollTabs();
      if (eps[epRow.f]) infoLater(eps[epRow.f]);
      N.router.refreshHints();
    }
    function toEps() {
      if (!epRow || !epRow.count()) return;
      leaveZone(); zone = 'eps'; setOff(SEC); heroInfo(false); dimButtons(true); markTabs();
      epRow.setFocused(true); placeRing(epRing(epRow.ringPos()));
      infoLater(eps[epRow.f]); ensureEpPages();
      N.router.refreshHints();
    }
    function toRow(i) {
      if (!rows[i]) return;
      leaveZone(); zone = 'row'; rk = i; dimButtons(true);
      setOff(rows[i].top - ANCHOR); heroInfo(false);
      rows[i].row.setFocused(true); rows[i].row.boost(); placeRing(rows[i].row.ringPos());
      if (d && infoFor !== d.it && !isShow) infoLater(d.it);
      N.router.refreshHints();
    }
    function down() {
      if (zone === 'btn') { if (isShow && seasons.length) toTabs(); else if (isShow && epRow.count()) toEps(); else toRow(0); }
      else if (zone === 'tabs') toEps();
      else if (zone === 'eps') toRow(0);
      else if (zone === 'row') toRow(rk + 1);
    }
    function up() {
      if (zone === 'tabs') toBtn();
      else if (zone === 'eps') { if (seasons.length) toTabs(); else toBtn(); }
      else if (zone === 'row') { if (rk > 0) toRow(rk - 1); else if (isShow && epRow.count()) toEps(); else toBtn(); }
    }
    function moveEp(f) {
      var p = epRing(epRow.focusCol(U.clamp(f, 0, epRow.count() - 1)));
      placeRing(p); infoLater(eps[epRow.f]); ensureEpPages(); N.idle.add(updateHints, 'det-hints');
    }

    /* ---------- Aktionen ---------- */
    function focusedItem() {
      if (zone === 'eps') { var e = eps[epRow.f]; return e && !e.ph ? e : null; }
      if (zone === 'tabs') return seasons[sIdx] ? seasonItem(seasons[sIdx]) : null;
      if (zone === 'row') { var r = rows[rk]; return r ? r.row.item(r.row.f) : null; }
      return d ? d.it : it0;
    }
    function play(x, how) { N.theme.stop(true); N.details.play(x, how); }
    /* Hauptaktion: Film abspielen bzw. naechste Folge der Serie */
    function playMain(how) {
      if (!d) return;
      if (!isShow) { play(d.it, how); return; }
      if (d.ondeck) { play(d.ondeck, how); return; }
      play(d.it, how);
    }
    function btnAct(id) {
      if (id === 'play') playMain('resume');
      else if (id === 'start') playMain('start');
      else if (id === 'trailer' && d && d.trailer) playExtra(d.trailer);
      else if (id === 'watched') toggleWatched(d ? d.it : null);
      else if (id === 'more') menu();
    }
    function playExtra(x) {
      var p = U.extend({}, x); p.type = 'movie'; p.off = 0; p.vc = 0;   // Extras/Trailer: wie ein Film abspielen (eigene Datei)
      play(p, 'start');
    }
    function toggleWatched(x) {
      if (!x || !M.isVideo(x)) return;
      N.watch.toggle(x, { label: d ? d.it.title : '', changed: function (y, w) { afterWatched(y, w); }, reverted: function (y) { afterWatched(y, M.watched(y)); } });
    }
    /* Darstellung nach Gesehen-Aenderung: Folge -> Karte + Staffel-Zahlen; Staffel/Serie -> alle betroffenen Folgen */
    function afterWatched(x, w) {
      var i, se;
      if (x.type === 'episode') {
        se = seasons[sIdx];
        if (se) se.vleaf = 0;
        for (i = 0; i < eps.length; i++) if (eps[i] && se && !eps[i].ph && M.watched(eps[i])) se.vleaf++;
        for (i = 0; i < eps.length; i++) if (eps[i] === x) epRow.refreshItem(i);
      } else if (x.type === 'season' || x.type === 'show') {
        for (i = 0; i < seasons.length; i++) if (x.type === 'show' || seasons[i].rk === x.rk) {
          seasons[i].vleaf = w ? seasons[i].leaf : 0;
          var c = seasonCache.get(seasons[i].rk), list = seasons[i] === seasons[sIdx] ? eps : c ? c.eps : [];
          for (var k = 0; k < list.length; k++) if (list[k] && !list[k].ph) N.watch.apply(list[k], w);
        }
        for (i = 0; i < eps.length; i++) epRow.refreshItem(i);
      }
      if (x === (d && d.it) || x.type === 'movie') buildButtons(d ? d.it : x);
      if (isShow && d) { d.it.vleaf = 0; for (i = 0; i < seasons.length; i++) if (seasons[i].index !== 0) d.it.vleaf += seasons[i].vleaf; buildButtons(d.it); }
      if (infoFor) paintInfo(infoFor);
      paintStrip();
      N.idle.add(updateHints, 'det-hints');
    }
    /* Ton & Untertitel (SPEC 7.6: Panel vor dem Start): Spuren der Datei; Wahl gemerkt je Serie bzw. je Film -> Player beim Start */
    function tracksPanel(tab) {
      var x = zone === 'eps' && eps[epRow.f] && !eps[epRow.f].ph ? eps[epRow.f] : isShow ? (d && d.ondeck) : d && d.it;
      if (!x) return;
      var key = N.srv.skey(srv, x.type === 'episode' ? x.showRk : 'm' + x.rk);   // Weitere Server: eigener Schluessel
      function withMedia(media) {
        var mi = vIndex(x.rk, media), md = media && (media[mi] || media[0]), part = md && md.Part && md.Part[0];
        if (!part) { N.ui.toast.show(N.t('det.noTracks')); return; }
        var T = N.tracks.streams(part), mem = (N.store.get(memFile()) || {})[key], st = N.session.settings || {};
        var an = N.anime.rulesOn() && N.anime.is(x, { ja: N.anime.jaTracks(T) });   // Anime-Wiedergaberegeln nur fuer erkannte Anime
        var pick = N.tracks.choose(T, { audioLang: st.audioLang, subs: st.subs, subLang: st.subLang, anime: an, animeAudio: st.animeAudio, animeSubs: st.animeSubs,
          animeSigns: st.animeSigns, remember: true }, mem || null, x.type === 'episode');
        if (pick.a) for (var i = 0; i < T.audio.length; i++) T.audio[i].sel = T.audio[i].id === pick.a;
        if (pick.s !== null) for (i = 0; i < T.subs.length; i++) T.subs[i].sel = T.subs[i].id === pick.s;
        N.ui.tracks.open({ tracks: T, tab: tab, hls: false, ass: st.ass, onPick: function (kind, id) {
          var arr = kind === 'a' ? T.audio : T.subs;
          for (var j = 0; j < arr.length; j++) arr[j].sel = arr[j].id === id;
          var all = N.tracks.remember(N.store.get(memFile()) || {}, key, N.tracks.selected(T.audio), N.tracks.selected(T.subs) || 0, U.now());
          N.store.set(memFile(), all);
          N.ui.toast.show(N.t(x.type === 'episode' ? 'pl.toast.remembered' : 'det.toast.tracks'), { icon: 'confirm' });
        } });
      }
      if (!isShow && d && d.media.length) { withMedia(d.media); return; }
      var em = epMeta.get(x.rk);
      if (em) { withMedia(em.media); return; }
      get('/library/metadata/' + x.rk, { excludeElements: 'Role,Director,Writer,Producer,Country,Genre' }, null, function (err, dd) {
        var m = !err && dd && dd.MediaContainer && dd.MediaContainer.Metadata && dd.MediaContainer.Metadata[0];
        if (!m || dead || away) { if (err) N.ui.toast.show(N.t('toast.actionFailed')); return; }
        withMedia(m.Media || []);
      });
    }
    function memFile() { return 'tracks-' + (N.session.profile ? N.session.profile.uuid : 'x') + '.json'; }
    function chooseVersion() {
      if (!d || d.media.length < 2) return;
      var vs = N.versions.list(d.media), e = [], lim = (N.decision.QUAL[(N.session.settings || {}).quality] || N.decision.QUAL['12'])[0];
      for (var i = 0; i < vs.length; i++) e.push({ id: String(i), t: vs[i].label, s: vs[i].sub });
      N.ui.panel.select({ title: N.t('menu.version'), entries: e, selected: String(N.versions.choose(d.it.rk, d.media, lim)), onSelect: function (v) {
        N.versions.set(d.it.rk, Number(v)); paintInfo(d.it);
      } });
    }
    function menu() {
      var x = focusedItem(), b = [];
      if (zone === 'eps' && x) { b.push({ id: 'play', t: N.t('menu.play') }); if (M.progress(x) > 0) b.push({ id: 'start', t: N.t('menu.fromStart') }); }
      if (x && M.isVideo(x)) b.push({ id: 'watched', t: N.t(M.watched(x) ? 'menu.markUnwatched' : 'menu.markWatched') });
      if (zone !== 'row' && zone !== 'tabs') b.push({ id: 'tracks', t: N.t(isShow && zone === 'btn' ? 'det.menu.tracksShow' : 'det.menu.tracks') });
      if (!isShow && zone === 'btn' && d && d.media.length > 1) b.push({ id: 'version', t: N.t('menu.version') });
      if (zone === 'btn' && d) b = b.concat(N.anime.menuButtons(d.it));   // gilt fuer die ganze Serie bzw. den Film
      b.push({ id: 'info', t: N.t('menu.info') });
      N.ui.dialog.open({ title: x ? (x.type === 'episode' ? N.t('det.epTitle', { e: x.e, title: x.epTitle }) : x.title) : '', buttons: b, vertical: true, focus: 0, top: 120,
        onSelect: function (id) {
          if (id === 'play') play(x, 'ask');
          else if (id === 'start') play(x, 'start');
          else if (id === 'watched') toggleWatched(x);
          else if (id === 'tracks') tracksPanel('a');
          else if (id === 'version') chooseVersion();
          else if (N.anime.menuPick(id, d.it)) return;
          else showInfo();
        } });
    }
    function showInfo() {
      var x = zone === 'eps' && eps[epRow.f] && !eps[epRow.f].ph ? eps[epRow.f] : d ? d.it : it0;
      if (x.type === 'episode') {
        var em = epMeta.get(x.rk), text = U.trim(em && em.sum || x.sum, 600);
        N.ui.panel.help(N.t('det.epTitle', { e: x.e, title: x.epTitle }), text);
        return;
      }
      var t = D.info(x, d), al = N.anime.infoLine(x);
      if (al) t = al + '\n\n' + t;                   // Grund der Anime-Einordnung (nur wenn die Kategorie gezeigt wird)
      if (isShow && seasons.length) {
        var all = 0, seen = 0;
        for (var i = 0; i < seasons.length; i++) if (seasons[i].index !== 0) { all += seasons[i].leaf; seen += seasons[i].vleaf; }
        t = U.trim(t + '\n\n' + N.t('det.seriesInfo', { k: seen, n: all }), 600);
      }
      N.ui.panel.help(x.title, t);
    }
    function rowOpen(x, how) {
      if (!x) return;
      var r = rows[rk];
      if (r.id === 'cast') { N.theme.stop(); N.router.push('library', { lib: libOf(d.lib || x.lib), actor: { id: x.id, t: x.title } }); return; }
      if (r.id === 'extras') { playExtra(x); return; }
      if (how) { play(x, how); return; }
      N.details.open(x);
    }
    /* Ziffern in der Folgenreihe: Folge Nr. (Blase "Folge 51_", Sprung 900 ms nach der letzten Ziffer) */
    function epDigit(k) {
      if (jump.t) clearTimeout(jump.t);
      if (jump.digits.length >= 4) jump.digits = '';
      jump.digits += k;
      U.setText(bubbleT, N.t('jump.episode', { digits: jump.digits })); U.show(bubble, true);
      jump.t = setTimeout(function () {
        jump.t = 0; var nn = Number(jump.digits); jump.digits = ''; U.show(bubble, false);
        if (nn > 0 && zone === 'eps') moveEp(D.epIndex(eps, epsTotal, nn));
      }, 900);
    }

    /* ---------- Hinweisleiste ---------- */
    s.hints = function () {
      if (sb.on) return [{ k: 'ret', t: 'hint.back' }];
      var x = focusedItem(), list = [{ k: 'red', t: 'hint.fromStart' }, { k: 'green', t: 'hint.tracks' }];
      if (zone === 'row') list = [];
      if (x && M.isVideo(x)) list.push({ k: 'yellow', t: M.watched(x) ? 'hint.markUnwatched' : 'hint.markWatched' });
      list.push({ k: 'blue', t: 'hint.search' });
      if (list.length < 5) list.push({ k: 'INFO', t: 'hint.details' });
      return list;
    };

    /* ---------- Lebenszyklus ---------- */
    s.enter = function (p, restore) {
      away = false;
      if (!d && !gen) { if (restore) { zone = 'btn'; } load(); return; }
      if (dirty) { load(); dirty = false; }
      if (zone === 'btn') { U.cls(btns[bf], 'is-focus', true); paintLabel(); }
      else if (zone === 'eps') { epRow.setFocused(true); placeRing(epRing(epRow.ringPos())); }
      else if (zone === 'row' && rows[rk]) { rows[rk].row.setFocused(true); placeRing(rows[rk].row.ringPos()); }
      if (d && isShow) N.theme.play(d.theme);
      N.router.refreshHints();
    };
    s.leave = function () {
      away = true; N.theme.stop();
      if (infoT) { clearTimeout(infoT); infoT = 0; }
      return { zone: zone };
    };
    s.destroy = function () {
      dead = true; gen++;
      for (var i = 0; i < tasks.length; i++) if (tasks[i]) tasks[i].abort();
      N.evt.off('playback:stopped', onPlayed); N.evt.off('watched:changed', onWatched); N.evt.off('anime:changed', onAnime);
      if (seasonT) clearTimeout(seasonT); if (bubbleTm) clearTimeout(bubbleTm); if (jump.t) clearTimeout(jump.t);
      if (epRow) epRow.clear();
      for (i = 0; i < rows.length; i++) rows[i].row.clear();
      N.theme.stop();
      hero.destroy();
    };

    /* Seitenleiste: Fokus/Ring weg, beim Zurueckkommen die Zone wieder herstellen */
    s.railBlur = function () {
      ring.hide(); U.show(blbl, false);
      if (zone === 'btn') U.cls(btns[bf], 'is-focus', false);
      else if (zone === 'eps') epRow.setFocused(false);
      else if (zone === 'row' && rows[rk]) rows[rk].row.setFocused(false);
      else if (zone === 'tabs') { var z = zone; zone = ''; markTabs(); zone = z; }
    };
    s.railFocus = function () {
      var z = zone; zone = '';
      if (z === 'eps') toEps(); else if (z === 'row') toRow(rk); else if (z === 'tabs') toTabs(); else if (z === 'btn') toBtn(); else zone = z;
    };
    s.onKey = function (k) {
      if (k === 'BLUE') { N.router.push('search'); return true; }
      if (zone === 'state') { if (sb.onKey(k)) return true; return k !== 'RETURN'; }
      if (k === 'RETURN') { N.router.back(); return true; }
      if (k === 'DOWN') { down(); return true; }
      if (k === 'UP') { up(); return true; }
      if (k === 'GREEN' || k === 'SUBTITLE') { if (zone !== 'row' && zone !== 'tabs') tracksPanel(k === 'SUBTITLE' ? 's' : 'a'); return true; }
      if (k === 'INFO') { if (zone === 'row') { var rx = rows[rk].row.item(rows[rk].row.f); if (rows[rk].id === 'similar') rowOpen(rx); } else showInfo(); return true; }
      if (k === 'TOOLS') { if (zone === 'row') return true; menu(); return true; }
      if (zone === 'btn') {
        switch (k) {
          case 'LEFT': if (bf > 0) setBtn(bf - 1); else N.ui.rail.open(); return true;
          case 'RIGHT': if (bf < btns.length - 1) setBtn(bf + 1); return true;
          case 'ENTER': btnAct(bdefs[bf].id); return true;
          case 'PLAY': playMain('resume'); return true;
          case 'RED': playMain('start'); return true;
          case 'YELLOW': toggleWatched(d ? d.it : null); return true;
        }
        return true;
      }
      if (zone === 'tabs') {
        switch (k) {
          case 'LEFT': if (tabF > 0) selectSeason(tabF - 1); else N.ui.rail.open(); return true;
          case 'RIGHT': if (tabF < seasons.length - 1) selectSeason(tabF + 1); return true;
          case 'ENTER': toEps(); return true;
          case 'YELLOW': toggleWatched(seasonItem(seasons[sIdx])); return true;
          case 'PLAY': playMain('resume'); return true;
        }
        return true;
      }
      if (zone === 'eps') {
        var f = epRow.f, e = eps[f];
        if (N.keys.isDigit(k)) { epDigit(k); return true; }
        switch (k) {
          case 'LEFT': if (f > 0) moveEp(f - 1); else N.ui.rail.open(); return true;
          case 'RIGHT': if (f < epRow.count() - 1) moveEp(f + 1); return true;
          case 'FF': moveEp(f + 5); return true;
          case 'RW': moveEp(f - 5); return true;
          case 'CH_DOWN': moveEp(f + 25); return true;
          case 'CH_UP': moveEp(f - 25); return true;
          case 'ENTER': if (e && !e.ph) play(e, 'ask'); return true;
          case 'PLAY': if (e && !e.ph) play(e, 'resume'); return true;
          case 'RED': if (e && !e.ph) play(e, 'start'); return true;
          case 'YELLOW': if (e && !e.ph) toggleWatched(e); return true;
        }
        return true;
      }
      if (zone === 'row') {
        var R = rows[rk].row, x = R.item(R.f);
        switch (k) {
          case 'LEFT': if (R.f > 0) placeRing(R.focusCol(R.f - 1)); else N.ui.rail.open(); return true;
          case 'RIGHT': if (R.f < R.count() - 1) placeRing(R.focusCol(R.f + 1)); return true;
          case 'ENTER': rowOpen(x); return true;
          case 'PLAY': if (rows[rk].id === 'similar' && x) play(x, 'resume'); else rowOpen(x); return true;
          case 'YELLOW': if (rows[rk].id === 'similar') toggleWatched(x); return true;
        }
        return true;
      }
      return true;
    };

    /* ---------- Zeiger (Index-Mathe + einmal gemessene Rechtecke) ---------- */
    s.pointer = function (x, y, kind) {
      if (sb.on) return sb.pointer(x, y, kind);
      var py = y + off;                                   // Seitenkoordinaten
      if (!off && py >= 448 && py < 496 && btnRects) {   // gescrollt: Knoepfe unsichtbar, kein Treffer unter dem Kopf
        for (var i = 0; i < btnRects.length; i++) if (x >= btnRects[i][0] && x < btnRects[i][0] + btnRects[i][1]) {
          if (zone !== 'btn') toBtn();
          if (i !== bf) setBtn(i);
          if (kind === 'click') btnAct(bdefs[i].id);
          return true;
        }
        return false;
      }
      if (isShow && py >= SEC + 332 && py < SEC + 372 && x >= 128 && x < 592 && tabX.length) {
        var tx = x - 128 + (tstrip._off || 0);
        for (i = 0; i < tabX.length; i++) if (tx >= tabX[i][0] && tx < tabX[i][0] + tabX[i][1]) {
          if (zone !== 'tabs') toTabs();
          if (i !== tabF) selectSeason(i);
          if (kind === 'click') toEps();
          return true;
        }
        return false;
      }
      if (isShow && epRow.count() && py >= SEC + 392 && py < SEC + 392 + 162) {
        var j = epRow.hit(x);
        if (j < 0) return false;
        if (zone !== 'eps') toEps();
        if (j !== epRow.f) { placeRing(epRing(epRow.hoverCol(j))); infoLater(eps[j]); }
        if (kind === 'click' && eps[j] && !eps[j].ph) play(eps[j], 'ask');
        return true;
      }
      for (i = 0; i < rows.length; i++) {
        var r = rows[i].row, cy = rows[i].top + 52;
        if (py >= cy && py < cy + r.g.h && y < 632) {
          var h = r.hit(x);
          if (h < 0) return false;
          if (zone !== 'row' || rk !== i) toRow(i);
          if (h !== r.f) placeRing(r.hoverCol(h));
          if (kind === 'click') rowOpen(r.item(h));
          return true;
        }
      }
      return false;
    };
    s.pointerSig = function () { return off; };             // Zeiger-Scroll-Sperre (N.pointer)
    s.relabel = function () { if (d) buildButtons(d.it); if (seasons.length) buildTabs(); if (infoFor) paintInfo(infoFor); };
    return s;
  });

  /* ---------- Einstieg (Startseite, Bibliothek, Suche) ---------- */
  var busy = 0;
  N.details = {
    open: function (it) {
      if (!it) return;
      if (N.music.open(it)) return;                       // M4: Album, Kuenstler, Hoerbuch
      if (!N.model.isVideo(it)) { N.router.push('soon', { area: 'details', label: N.t('soon.music') }); return; }
      N.router.push('details', { it: it });
    },
    /* Abspielen: Film/Folge direkt (Player-Regeln); Serie/Staffel = naechste ungesehene Folge (OnDeck), sonst die erste (SPEC 7.3) */
    play: function (it, how) {
      if (!it) return;
      N.theme.stop(true);
      if (N.music.play(it)) return;                       // M4: Musik/Hoerbuch -> N.audio
      if (N.model.isLeaf(it)) { N.player.play(it, how); return; }
      if (!N.model.isVideo(it) || U.now() - busy < 1500) return;
      busy = U.now();
      var path = it.type === 'show' ? '/library/metadata/' + it.rk : '/library/metadata/' + it.rk + '/children';
      N.plex.get(path, it.type === 'show' ? { includeOnDeck: 1, excludeElements: N.hubs.EXCL } : { excludeElements: N.hubs.EXCL }, N.srv.o(it.srv), function (err, d) {   // Weitere Server: it.srv
        busy = 0;
        var mc = !err && d && d.MediaContainer, list = mc && mc.Metadata || [], ep = null, i;
        if (it.type === 'show' && list[0] && list[0].OnDeck && list[0].OnDeck.Metadata) ep = N.model.norm(list[0].OnDeck.Metadata);
        if (!ep && it.type === 'season') {
          for (i = 0; i < list.length && !ep; i++) if (list[i].type === 'episode' && !N.model.watched(N.model.norm(list[i]))) ep = N.model.norm(list[i]);
          if (!ep && list[0]) ep = N.model.norm(list[0]);
        }
        if (ep) { N.player.play(ep, 'resume'); return; }
        if (it.type === 'show' && !err) {                  // alles gesehen bzw. nie angefangen: erste Folge der Serie
          N.plex.get('/library/metadata/' + it.rk + '/allLeaves', { 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 1 }, N.srv.o(it.srv), function (e2, d2) {
            var m = !e2 && d2 && d2.MediaContainer && d2.MediaContainer.Metadata && d2.MediaContainer.Metadata[0];
            if (m) N.player.play(N.model.norm(m), 'start'); else N.ui.toast.show(N.t('toast.actionFailed'));
          });
          return;
        }
        N.ui.toast.show(N.t('toast.actionFailed'));
      });
    },
    /* Alle abspielen / Zufall: fertige Play-Queue (MediaContainer) an den Player */
    playQueue: function (mc) {
      var items = [], cur = 0;
      for (var i = 0; i < mc.Metadata.length; i++) {
        var x = mc.Metadata[i], it = N.model.norm(x);
        it.pqi = x.playQueueItemID;
        if (String(x.playQueueItemID) === String(mc.playQueueSelectedItemID)) cur = i;
        items.push(it);
      }
      if (!items.length) return;
      N.theme.stop(true);
      if (N.audio) N.audio.stop('video');                 // M4: Video stoppt Musik
      N.router.push('player', { it: items[cur], off: 0, queue: { id: mc.playQueueID, items: items, idx: cur } });
    }
  };
})(N);
