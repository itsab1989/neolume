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
  var U = N.util, M = N.model, D = N.det, REST = 300, ANCHOR = 340, TMORE = 44, SEC = 248, PEEK = 580, HOLD = 2500;
  var SS_A = 276, SS_B = 300;                         // schmale Karte: Zeilen des Streifens/Serien-Balkens ueber den Reitern (Abschnitt-px)
  var PITCH = { land: 288, poster: 360, cast: 248 };
  /* Poster-Reihen (Aehnliche Titel, Sammlung) stehen beim Fokus LIFT px hoeher: Karte 264 px ab Anker + 52 endet bei 656, der Ring
   * (Karte + 8 px, Fokus-Vergroesserung 1.08) bei ~675 – ueber dem Text der Hinweisleiste (y 656). Nutzerbefund 30.10. Mit 28 px
   * endet der Ring bei ~647. Querformat (162) und Besetzung (120) passen am Anker. */
  var LIFT = 28;
  function anchorOf(kind) { return kind === 'poster' ? ANCHOR - LIFT : ANCHOR; }

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
    /* Detailkarte (caps.details 'card', N.ui.card; Nr. 9/16 – nur Touch/Maus-Plattformen, am TV nie): die Ansicht steht in der Karte,
     * die ganze Seite (Hintergrund, Info, Knoepfe, Staffeln/Folgen, Reihen) scrollt frei senkrecht (N.kinetic, kein Einrasten,
     * Nr. 18) und beginnt oben (kein Sprung zur Folge). Tasten (Tastatur) fuehren den Fokus wie am TV und rollen die Seite zum
     * Fokus. Waagerechter Zug in einer Reihe verschiebt die Reihe frei (Row px, N.kinetic, wie Startseite); ausserhalb = Router-Geste. */
    var card = !!(N.ui.card && N.ui.card.on()), NARROW = card && !!N.ui.card.peek().narrow, BTN_X = NARROW ? 144 : 352, cpage = null, cy = 0, ckin = null, cpan = null, canim = 0, cgen = 0, ceat = false, wAcc = 0, wLast = 0;
    /* Reihen in der Karte frei wie auf der Startseite (caps.scroll 'free', Nr. 18/22): Row mit px, N.kinetic.Drive je Reihe {row, d} */
    var RFREE = card && N.platform.caps.scroll === 'free', rdrv = [], epOpen = null;   // epOpen: Folge der offenen Folgen-Ebene
    if (card) s.card = true;
    var root, hero, pg, bar, btns = [], bdefs = [], btnRects = null, blbl, blblT, hideT = 0, sec = null;
    var RX = 1216, TIGHT = false, TABW = 464;          // rechte Kante von Streifen/Balken, schmale Karte, Breite der Reiter
    var tclip, tstrip, tabEls = [], tabX = [], tabV = null, tmore = [], arrowH = -1, strip, stripT, sbar, sbarT, segs = [], epRow = null, rows = [], ring, sb, bubble, bubbleT;
    var d = null, seasons = [], sIdx = 0, tabF = 0, eps = [], epsTotal = 0, epPages = {}, epWait = {}, seasonCache = new N.LRU(10), gen = 0, tasks = [];
    var zone = 'btn', bf = 0, rk = 0, off = 0, infoFor = null, infoT = 0, seasonT = 0, dead = false, away = false, dirty = false;
    /* NAV-3.2 Rueckkehr aus dem Player: gespielte Folge {s, e} (nach Autoplay die zuletzt gespielte) – Fokus und Staffel-Reiter dorthin,
     * auch wenn sie jetzt gesehen ist (TV-Test 30.10.: nach dem Ende der neuesten Folge stand der Fokus auf F1, weil keine ungesehene
     * Folge mehr da war) */
    var played = null;
    var wishS = it0.type === 'season' ? it0.s : it0.type === 'episode' ? it0.s : null, wishE = it0.type === 'episode' ? it0.e : 0;
    var jump = { digits: '', t: 0 }, bubbleTm = 0, onPlayed = null, onWatched = null, onAnime = null, epMeta = new N.LRU(30);
    var xt = null, baseSeasons = [], pmsEps = null, btnDirty = false;   // optionale Erweiterung (core/ext.js 'details:open'): Steuerobjekt
    /* TV-Befund 1.0.5: "Staffel 2" stand sofort, "Staffel 1" (nur im Katalog der Erweiterung) ploppte kurz danach davor. Meldet die
     * Erweiterung, dass ihre Staffeln noch kommen (xt.pending()), wird die Reiterzeile erst gebaut, wenn sie da sind (X.ready/X.tabs,
     * hoechstens HOLD ms); Folgen der gewaehlten (vorhandenen) Staffel laden trotzdem sofort. tabSig: zuletzt gebaute Reiter.
     * shownS/shownV: Staffel (Nummer, nur im Katalog?), deren Karten gerade in der Folgenreihe stehen */
    var tabHold = false, tabHoldT = 0, tabSig = '', shownS = null, shownV = false;

    /* Schnittstelle fuer eine optionale Erweiterung (N.ext 'details:open'): lesen + gezielt neu zeichnen, ohne Fokussprung */
    var X = {
      it: function () { return d ? d.it : it0; }, isShow: isShow, showRk: showRk, srv: srv, d: function () { return d; },
      zone: function () { return zone; }, seasons: function () { return seasons; }, season: function () { return seasons[sIdx]; },
      eps: function () { return eps; }, focusedEp: function () { return zone === 'eps' ? eps[epRow.f] : null; }, dead: function () { return dead; },
      /* Knoepfe neu (Erweiterung fuegt vor "⋯" ein): der fokussierte Knopf bleibt stehen; liegt der Fokus auf "⋯", erst beim Verlassen */
      buttons: function () { if (!d || dead) return; if (zone === 'btn' && !away && bdefs[bf] && bdefs[bf].id === 'more') btnDirty = true; else buildButtons(d.it); },
      info: function () { if (infoFor && !dead) paintInfo(infoFor); },
      tabs: function () { if (tabHold) releaseTabs(); else retab(); },
      /* Erweiterung fertig (auch ohne Ergebnis): zurueckgehaltene Reiter jetzt bauen */
      ready: function () { releaseTabs(); },
      /* aktuelle Staffel neu mischen (Daten der Erweiterung kamen spaeter oder haben sich geaendert) */
      redecorate: function () {
        if (dead || !epRow || !seasons[sIdx] || seasonT) return;   // Staffelwechsel steht noch aus: loadSeason mischt gleich selbst
        if (seasons[sIdx].virtual) { var cv = eps[epRow.f]; eps = xt.virtualEps(seasons[sIdx]); epsTotal = eps.length; allPages(epsTotal); epRow.setModel({ id: 'eps', kind: 'land', tk: 'det.row.episodes', items: eps }, U.clamp(epRow.f, 0, eps.length - 1)); }
        else {
          var f = decorate(epRow.f);
          if (!epRow.model || epRow.model.items !== eps) epRow.setModel({ id: 'eps', kind: 'land', tk: 'det.row.episodes', items: eps }, f);
          else epRow.render(0);
        }
        if (zone === 'eps') { epRow.setFocused(true); placeRing(epRing(epRow.ringPos())); infoLater(eps[epRow.f]); }
        N.idle.add(updateHints, 'det-hints');
      },
      /* eine Karte geaendert (z. B. Zustand) -> nur diese neu zeichnen */
      refreshItem: function (x) { for (var i = 0; i < eps.length; i++) if (eps[i] === x) epRow.refreshItem(i); if (infoFor === x) paintInfo(x); },
      reload: function () { if (!dead) { dirty = true; if (!away) { load(); dirty = false; } } },
      /* Karte x (z. B. ohne Datei) durch den jetzt vorhandenen Eintrag md (PMS-Metadaten) ersetzen – gleiche Stelle, kein Umbau der Reihe */
      swap: function (x, md) {
        var i = eps.indexOf(x);
        if (i < 0 || dead) return false;
        var it = M.normList([md], kinds(), d && d.lib)[0];
        if (!it) return false;
        eps[i] = it;
        if (pmsEps && pmsEps !== eps) { pmsEps.push(it); pmsEps.sort(function (a, b) { return (a.e || 0) - (b.e || 0); }); }
        if (seasons[sIdx] && seasons[sIdx].rk) seasonCache.del(seasons[sIdx].rk);
        epRow.refreshItem(i);
        if (infoFor === x) paintInfo(it);
        N.idle.add(updateHints, 'det-hints');
        return true;
      },
      /* Staffelliste neu (dd = Antwort von /library/metadata/<showRk>/children), z. B. weil eine bisher nur im Katalog
       * vorhandene Staffel jetzt auf dem Server ist: Reiter neu, dieselbe Staffel bleibt gewaehlt; war sie virtuell und ist jetzt
       * echt, werden ihre Folgen geladen (Fokus auf derselben Folgennummer, soweit vorhanden). true = Staffelliste uebernommen */
      reseason: function (dd) {
        if (dead || !epRow) return false;
        var nb = D.seasons(dd);
        if (!nb.length) return false;
        var cur = seasons[sIdx], fe = zone === 'eps' && eps[epRow.f] ? eps[epRow.f].e : undefined, ni = 0, i;
        baseSeasons = nb; applySeasons(); buildTabs();
        for (i = 0; i < seasons.length; i++) if (cur && seasons[i].index === cur.index) ni = i;
        sIdx = ni; tabF = ni; markTabs();
        if (cur && cur.virtual && seasons[ni] && !seasons[ni].virtual) loadSeason(ni, fe);
        return true;
      },
      /* Zeile unter der Beschreibung neu (Daten der Erweiterung kamen): blendet nur diese Zeile ein, der Info-Block bleibt stehen */
      note: function () { if (!dead && infoFor && infoFor.type === 'show') hero.note(noteFor(infoFor), true); },
      /* Reihe "Aehnliche Titel": die Erweiterung hat an die Liste aus xt.similar() hinten Karten angehaengt -> nur das Fenster
       * nachziehen (Fokus und Stelle bleiben); fehlt die Reihe noch, entsteht sie als letzte (darueber verschiebt sich nichts) */
      simGrown: function () { if (!dead && d) simGrow(); },
      /* eine Karte der Reihe geaendert/ersetzt (Marke, Titel jetzt auf dem Server) bzw. ohne i alle sichtbaren -> nur diese neu */
      simRefresh: function (i) { var r = simRow(); if (dead || !r) return; if (i === undefined) r.row.refreshAll(); else r.row.refreshItem(i); if (zone === 'row' && rows[rk] === r) N.idle.add(updateHints, 'det-hints'); },
      away: function () { return away; },
      hints: function () { N.idle.add(updateHints, 'det-hints'); }
    };

    /* ---------- Aufbau ---------- */
    s.create = function (el) {
      root = el;
      var host = root;                                    // Karte: alles in einer frei scrollenden Seite
      if (card) { host = cpage = U.el('div', 'cd-page', root); cpage.style.width = cardW() + 'px'; }
      /* Hintergrund, Poster links (fest, blendet in den Abschnitten aus) und Info-Block: gemeinsame Mechanik N.ui.DetHero
       * (auch Album/Hoerbuch/Kuenstler; Feedback-Regeln 3 und 11) */
      hero = new N.ui.DetHero(host, { narrow: NARROW });
      if (card) U.el('div', 'cd-bgfade', host);            // Hintergrundbild laeuft unten in die Kartenfarbe aus
      pg = U.el('div', 'pg', host);
      hero.makeInfo(host, { chips: 2, hdr: 'scrim-hdr.png' });
      if (card && !NARROW) hero.fit(cardW());               // Karte M (iPad mini hoch): Zeilen auf die Kartenbreite (am TV keine Karte)
      var i;
      bar = U.el('div', 'd-btns', pg, NARROW ? 'left:' + BTN_X + 'px;width:' + (cardW() - BTN_X - 24) + 'px' : undefined);   // schmal: ab der Inhaltskante
      blbl = U.el('div', 'blbl', pg, 'display:none'); blblT = document.createTextNode(''); blbl.appendChild(blblT);
      if (isShow) {
        sec = U.el('div', 'dsec', pg);               // Abschnitt Staffeln/Folgen: auf dem ersten Bildschirm nur angeschnitten (y 580)
        tclip = U.el('div', 'd-tclip', sec); tstrip = U.el('div', 'd-tstrip', tclip);
        tmore = [U.el('div', 'd-tmore', tclip, 'visibility:hidden'), U.el('div', 'd-tmore is-r', tclip, 'visibility:hidden')];
        tmore[0].appendChild(document.createTextNode('‹')); tmore[1].appendChild(document.createTextNode('›'));   // es gibt weitere Staffeln
        strip = new N.ui.SeasonStrip(sec, 'M', 800, 336, true);
        stripT = U.txt('div', 'd-sst t-small c2', sec, '');
        sbar = U.el('div', 'd-sbar', sec, 'display:none');
        sbarT = U.txt('div', 'd-sbt t-small c2', sec, '');   // Beschriftung "Serie: …" (TV-Befund 28.10.: sah sonst wie ein Schiebebalken aus)
        for (i = 0; i < 40; i++) { var sg = U.el('div', 'ss-seg', sbar, 'display:none'); segs.push({ el: sg, fill: U.el('i', '', sg) }); }
        epRow = new N.ui.Row(sec, { noHead: true, caption: D.epCaption, w: card ? cardW() : 0, free: RFREE });
        epRow.setTop(ANCHOR);
        /* Karte schmaler als 1280 (Apple, Klassen K/M; Nutzerbefund 03.11.: Staffelstreifen und Serien-Balken bei x 1216 lagen ausserhalb
         * der Karte): rechte Kante RX = sichtbarer Rand; Streifen/Balken samt Text ruecken in zwei Zeilen UEBER die Reiter (zwischen
         * Knoepfen und Reitern ist Platz), die Reiter bekommen die ganze Breite. Am TV/breiter Karte: RX 1216, alles wie bisher. */
        if (card) { var cg0 = N.ui.card.g; RX = Math.min(1216, cg0.cw - (cg0.cut ? 144 - cg0.cut : 64)); }
        TIGHT = RX < 1216;
        if (TIGHT) { TABW = Math.max(160, RX - 128); tclip.style.width = TABW + 'px'; U.cls(sec, 'ss-tight', true); }
      }
      if (!card) { var fade = U.el('img', 'fade', root); fade.src = N.assetBase + 'fade-bottom.png'; }
      bubble = U.el('div', 'jump', root, 'display:none'); bubbleT = document.createTextNode(''); bubble.appendChild(bubbleT);
      ring = new N.ui.Ring(card ? cpage : root);
      sb = new N.ui.StateBlock(root);
      onPlayed = function (ev) { dirty = true; if (isShow && ev && ev.ep && ev.ep.e && (!ev.ep.show || ev.ep.show === String(showRk))) played = ev.ep; };
      N.evt.on('playback:stopped', onPlayed);           // Rueckkehr aus dem Player: Fortschritt neu laden
      /* Folgen-Ebene (Karte): Gesehen dort geaendert -> nur diese Karte auffrischen (s.enter), kein neues Laden */
      onWatched = function (ev) { if (away && !(epOpen && ev && String(ev.rk) === String(epOpen.rk))) dirty = true; };
      N.evt.on('watched:changed', onWatched);
      onAnime = function () { if (infoFor && !dead) paintInfo(infoFor); };
      N.evt.on('anime:changed', onAnime);              // "Als Anime behandeln": Ueberzeile sofort anpassen
      paintInfo(it0);
      buildButtons(it0);
    };

    /* ---------- Info-Block ---------- */
    function paintInfo(x) {
      infoFor = x;
      if (x.virtual && xt && xt.seasonInfo) { var si = xt.seasonInfo(x); hero.paint(ovl(si.ov), si.title, si.meta, si.desc, { small: true, chips: [] }); return; }   // Staffel nur im Katalog
      if (x.miss && xt && xt.info) { var xi = xt.info(x); hero.paint(ovl(xi.ov), xi.title, xi.meta, xi.desc, { small: true, chips: [] }); return; }
      var ep = x.type === 'episode' && isShow;
      var media = ep ? (epMeta.get(x.rk) || {}).media : d && d.it === x ? d.media : null;
      // Spoilerschutz (P5): ungesehene Folge -> Hinweis statt Beschreibung (INFO zeigt den Text)
      hero.paint(ovl(ep ? D.overline(x) : D.overline(x, d)), ep ? N.t('det.epTitle', { e: x.e, title: x.epTitle }) : x.title,
        !ep && xt && xt.meta && xt.meta() ? N.fmt.join([D.meta(x, d), xt.meta()]) : D.meta(x, ep ? epMeta.get(x.rk) || null : d), ep ? N.comfort.summary(x) : d ? d.sum : x.sum,
        { small: ep, chips: media ? D.chips(media, vIndex(x.rk, media)) : [], note: noteFor(x) });
    }
    /* Zeile der Erweiterung unter der Beschreibung (xt.note, z. B. wann die naechste Folge kommt): nur fuer die Serie selbst */
    function noteFor(x) { return x && x.type === 'show' && xt && xt.note ? xt.note() || '' : ''; }
    /* gewaehlte bzw. automatisch passende Datei (SPEC 7.6, N.versions) */
    function vIndex(rk0, media) {
      if (!media || media.length < 2) return 0;
      return N.versions.choose(rk0, media, N.decision.verLimit((N.session.settings || {}).quality)) || 0;   // wie die Wiedergabe
    }
    /* Folgen-Info nach 300 ms Ruhe (Tasten blaettern ohne Neuzeichnen) */
    function infoLater(x) {
      if (card && N.input.mode !== 'key' && d && x !== d.it) return;   // Karte per Finger/Maus: Kopf bleibt beim Titel
      if (infoT) clearTimeout(infoT);
      infoT = setTimeout(function wait() {
        infoT = 0;
        if (N.idle.restFor() < REST) { infoT = setTimeout(wait, REST - N.idle.restFor()); return; }
        /* Platzhalter gemerkt, Folgen inzwischen geladen: die echte Folge an derselben Stelle zeigen (Audit 1.0.6) */
        if (x && x.ph && !x.miss && (zone === 'eps' || zone === 'tabs') && eps[epRow.f] && !eps[epRow.f].ph) x = eps[epRow.f];
        if (!x) return;
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
      bdefs = D.buttons(x, d); btns = []; btnRects = null; btnDirty = false;
      if (xt && xt.buttons) xt.buttons(bdefs, x);
      for (var i = 0; i < bdefs.length; i++) {
        var b = U.el('div', bdefs[i].icon ? 'btn inl ib' : 'btn inl', bar);
        if (bdefs[i].icon) N.ui.icon(b, bdefs[i].icon);
        else b.appendChild(document.createTextNode(bdefs[i].t));
        btns.push(b);
      }
      bf = Math.min(bf, btns.length - 1);
      if (zone === 'btn' && !away) { U.cls(btns[bf], 'is-focus', true); btnFit(); }
      setTimeout(measureButtons, 50);
    }
    function measureButtons() {
      if (dead) return;
      btnRects = [];
      for (var i = 0; i < btns.length; i++) btnRects.push([BTN_X + btns[i].offsetLeft, btns[i].offsetWidth]);
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
    function dimButtons(on) { if (card) on = false; U.cls(bar, 'dim', on); U.vis(bar, !on); }   // in den Abschnitten (Seite gescrollt) laegen sie unter dem Info-Block

    /* Hintergrund/Poster: N.ui.DetHero (Art 1280x720 scharf + Scrim, ohne Art Cover unscharf, ohne Bild Farbflaeche je Titel,
     * Einstellung "Hintergrundbilder" aus -> Farbflaeche; Poster-Ladefehler -> Titelkarte) */

    /* ---------- Daten ---------- */
    function track(t) { tasks.push(t); if (tasks.length > 20) tasks.shift(); return t; }
    function srvLibs() { var a = N.srv.libs(), out = []; for (var i = 0; i < a.length; i++) if (a[i].srv === srv) out.push(a[i]); return out; }
    function kinds() { var hc = N.session.homeCache(), k = N.hubs.libKinds(srv ? srvLibs() : hc && (hc.alibs || hc.libs) || []); return k; }
    function load() {
      gen++; var g = gen;
      /* Neu laden nach dem Player/Gesehen-Wechsel (dirty): s.enter setzt dirty gleich nach diesem Aufruf zurueck – die Antworten
       * kommen spaeter. TV-Test 30.10.: deshalb nahm loadSeason die Folgen aus dem 5-Min.-Zwischenspeicher (Stand VOR dem
       * Abspielen, Position 0) und "Abspielen" nach STOP begann bei 0:01 ohne Fortsetzen-Frage. re gilt fuer diesen Ladevorgang. */
      var re = dirty;
      if (re) seasonCache.clear();
      /* Erweiterung schon vor den Antworten: sie weiss so frueh wie moeglich, ob sie Staffeln ergaenzt (pending, s. tabHold) */
      if (!xt && N.ext.has('details:open')) xt = N.ext.call('details:open', X) || null;
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
        baseSeasons = D.seasons(dd);
        if (!tabSig && !tabHold && baseSeasons.length && xt && xt.pending && xt.pending()) {
          tabHold = true;
          tabWait();
          tabHoldT = setTimeout(function () { tabHoldT = 0; if (!dead) releaseTabs(); }, HOLD);
        }
        applySeasons();
        buildTabs();
        if (!seasons.length) return;
        var pl = re ? played : null; played = null;
        var keep = pl ? D.pickSeason(seasons, pl.s, null) : seasons[sIdx] && re ? sIdx : D.pickSeason(seasons, wishS, d && d.ondeck);
        selectSeason(keep, true, pl && seasons[keep] && seasons[keep].index === pl.s ? pl.e : undefined);
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
    function applySeasons() { seasons = xt && xt.seasons ? xt.seasons(baseSeasons.slice()) || baseSeasons : baseSeasons; }
    /* Reiter neu (Erweiterung hat Staffeln ergaenzt/geaendert): gewaehlte und fokussierte Staffel bleiben dieselben (gleiche Nummer) */
    function retab() {
      if (dead || !baseSeasons.length) return;
      var cur = seasons[sIdx], fi = seasons[tabF];
      applySeasons();
      sIdx = D.seasonPos(seasons, cur, sIdx); tabF = D.seasonPos(seasons, fi, tabF);
      if (D.tabSig(seasons) !== tabSig) buildTabs();
      markTabs();
    }
    /* TV-Test 29.10.: erstes Oeffnen ohne gemerkten Stand dauerte ~2,4 s (Katalog), HOLD 1 s war zu kurz – "Staffel 1" rutschte danach
     * vor "Staffel 2". Jetzt hoechstens 2,5 s; solange steht an der Stelle der Reiter ein dezenter Lade-Platzhalter (nichts darunter
     * oder daneben verschiebt sich, buildTabs ersetzt ihn). */
    function tabWait() {
      while (tstrip.firstChild) tstrip.removeChild(tstrip.firstChild);
      U.el('span', 'tab is-wait', tstrip).appendChild(document.createTextNode('…'));
    }
    function releaseTabs() {
      if (!tabHold) return;
      tabHold = false;
      if (tabHoldT) { clearTimeout(tabHoldT); tabHoldT = 0; }
      retab();
    }
    function buildTabs() {
      if (tabHold) return;                                 // Reiter kommen gleich vollstaendig (s. tabHold)
      tabSig = D.tabSig(seasons);
      while (tstrip.firstChild) tstrip.removeChild(tstrip.firstChild);
      tabEls = []; tabX = [];
      for (var i = 0; i < seasons.length; i++) {
        var t = U.el('span', seasons[i].miss ? 'tab is-miss' : 'tab', tstrip);
        t.appendChild(document.createTextNode(D.tabLabel(seasons[i])));
        tabEls.push(t);
      }
      setTimeout(function measure() {                     // Positionen EINMAL messen (Scroll-Fenster, Zeiger)
        if (dead) return;
        if (sec.style.display === 'none') { setTimeout(measure, 300); return; }   // Abschnitt gerade weggescrollt (hideAbove)
        tabX = [];
        for (var k = 0; k < tabEls.length; k++) tabX.push([tabEls[k].offsetLeft, tabEls[k].offsetWidth]);
        scrollTabs(true);
      }, 50);
    }
    function scrollTabs(jumpNow) {
      if (!tabX.length) return;
      var v = D.tabView(tabX, tabF, tabV ? tabV.o : 0, TABW, TMORE), k;
      if (jumpNow) tstrip.style.webkitTransition = 'none'; else N.fx.move(tstrip);
      U.tf(tstrip, v.shift - v.o, 0);
      for (k = 0; k < tabEls.length; k++) tabEls[k].style.visibility = k < v.first || k > v.last ? 'hidden' : '';
      U.vis(tmore[0], v.left); U.vis(tmore[1], v.right);
      if (arrowH >= 0 && !(arrowH ? v.right : v.left)) hoverArrow(-1);
      if (v.right) tmore[1].style.left = (tabX[v.last][0] + tabX[v.last][1] - v.o + v.shift + 4) + 'px';   // 4 px hinter dem letzten ganzen Reiter (Flaeche 40 px, Platz 44)
      tstrip._off = v.o - v.shift; tabV = v;
    }
    function markTabs() { for (var i = 0; i < tabEls.length; i++) { U.cls(tabEls[i], 'is-cur', i === sIdx); U.cls(tabEls[i], 'is-focus', zone === 'tabs' && arrowH < 0 && i === tabF); } }
    /* Zeiger ueber einem Pfeil ‹/› (Nutzerbefund 28.10.: sonst keine Rueckmeldung, ob man trifft): Pfeil hinterlegt wie ein
     * fokussierter Reiter, solange der Reiter-Fokus pausiert; k = 0 links, 1 rechts, -1 keiner */
    function hoverArrow(k) {
      if (k === arrowH) return;
      arrowH = k;
      if (tmore.length) { U.cls(tmore[0], 'is-hover', k === 0); U.cls(tmore[1], 'is-hover', k === 1); }
      markTabs();
    }
    function allPages(n) { epPages = {}; for (var p = 0; p * 50 < Math.max(1, n); p++) epPages[p] = 1; }
    /* Staffel waehlen: Tab sofort, Folgen/Streifen erst nach 300 ms Ruhe (SPEC 7.7) */
    function selectSeason(i, now, focusEp) {
      sIdx = i; tabF = i; markTabs(); scrollTabs(now);
      /* TV-Befund 1.0.5: unter dem Reiter "Staffel 1" (nur im Katalog) standen bis zum Wechsel noch die Bilder der Staffel 2. Ist eine
       * Katalog-Staffel beteiligt (Ziel oder gerade gezeigt), verschwinden die alten Karten sofort (eine Deckkraft am Karten-Bereich,
       * Row.setVisible); die neuen kommen wie immer nach der Ruhe. Ohne Erweiterung gibt es keine Katalog-Staffeln: unveraendert. */
      if (!now && epRow && seasons[i]) { var tv = !!seasons[i].virtual; epRow.setVisible(!(tv || shownV) || (seasons[i].index === shownS && tv === shownV)); }
      if (seasonT) clearTimeout(seasonT);
      var run = function () { seasonT = 0; if (!dead) loadSeason(i, focusEp); };
      if (now) run(); else seasonT = setTimeout(function wait() { if (N.idle.restFor() < REST) { seasonT = setTimeout(wait, REST); return; } run(); }, REST);
    }
    function seasonItem(se) { return { rk: se.rk, type: 'season', title: d ? d.it.title : it0.title, s: se.index, leaf: se.leaf, vleaf: se.vleaf, vc: 0, off: 0, dur: 0 }; }
    /* Reiter-Zone: eine Staffel, die nur im Katalog steht (Erweiterung), zeigt sich selbst im Info-Block (nicht die zuletzt gezeigte Folge) */
    function tabInfo(se) { if (zone === 'tabs' && se && se.virtual && infoT) { clearTimeout(infoT); infoT = 0; } return zone === 'tabs' && se && se.virtual && xt && xt.seasonInfo ? (paintInfo(se), true) : false; }
    function loadSeason(i, focusEp) {
      var se = seasons[i]; if (!se) return;
      shownS = se.index; shownV = !!se.virtual;
      tabInfo(se);
      if (se.virtual) { pmsEps = null; eps = xt && xt.virtualEps ? xt.virtualEps(se) : []; epsTotal = eps.length; allPages(epsTotal); showEps(focusEp); return; }   // Staffel nur im Katalog
      var c = seasonCache.get(se.rk), g = gen;
      pmsEps = null;
      if (c && U.now() - c.ts < 300000 && !dirty) { eps = c.eps; epsTotal = c.total; epPages = c.pages; showEps(focusEp); return; }
      eps = []; epPages = {}; epsTotal = se.leaf || 0;
      for (var k = 0; k < epsTotal; k++) eps.push(D.placeholder(se.index, k + 1));
      showEps(focusEp, true);
      loadEpPage(se, 0, function () { if (g === gen && seasons[sIdx] === se) showEps(focusEp); });
    }
    /* Audit 1.0.6: showEps(.., true) -> ensureEpPages startet Seite 0 ohne Rueckruf; der folgende Aufruf mit Rueckruf (loadSeason)
     * kam dann zu spaet (epPages[0] schon 1) und Folgenwahl, Mischen der Erweiterung, Info-Block und Sprung in die Folgenreihe
     * fielen aus. Rueckrufe fuer eine Seite, die gerade laedt, warten deshalb hier (je Folgenliste, epWait). */
    function loadEpPage(se, p, cb) {
      var w = epWait[p];
      if (epPages[p]) { if (cb && w && w.list === eps) w.cbs.push(cb); return; }
      epPages[p] = 1;
      var g = gen, list0 = eps;
      w = epWait[p] = { list: list0, cbs: cb ? [cb] : [] };
      track(get('/library/metadata/' + se.rk + '/children', D.seasonQuery(p * 50, 50), { timeout: 12000 }, function (err, dd) {
        if (epWait[p] === w) delete epWait[p];
        if (g !== gen || list0 !== eps) return;
        var mc = !err && dd && dd.MediaContainer;
        if (!mc) { epPages[p] = 0; return; }
        var list = M.normList(mc.Metadata || [], kinds(), mc.librarySectionID || (d && d.lib)), total = Number(mc.totalSize !== undefined ? mc.totalSize : list.length);
        if (total !== epsTotal) { epsTotal = total; while (eps.length < total) eps.push(D.placeholder(se.index, eps.length + 1)); eps.length = total; }
        for (var k = 0; k < list.length; k++) eps[p * 50 + k] = list[k];
        bgFromEpisodes();
        seasonCache.set(se.rk, { eps: eps, total: epsTotal, pages: epPages, ts: U.now() });
        if (w.cbs.length) { for (k = 0; k < w.cbs.length; k++) w.cbs[k](); } else if (epRow.model && epRow.model.items === eps) { for (k = 0; k < list.length; k++) epRow.refreshItem(p * 50 + k); paintStrip(); }
      }));
    }
    /* Serie ganz ohne Bilder: erstes Folgenbild als Hintergrund (abgedunkelt) */
    function bgFromEpisodes() {
      if (!hero.needBg || !d) return;
      for (var i = 0; i < eps.length && i < 50; i++) if (eps[i] && !eps[i].ph && eps[i].still) { hero.loadBg(eps[i].still); return; }
    }
    function showEps(focusEp, placeholders) {
      var f = placeholders ? 0 : D.pickEpisode(eps, focusEp !== undefined ? focusEp : wishE);
      if (!placeholders) f = decorate(f);
      if (!placeholders) wishE = 0;
      if (epRow.vis === false) epRow.setVisible(true);    // nach einem Wechsel mit Katalog-Staffel (selectSeason) wieder zeigen
      epRow.setModel({ id: 'eps', kind: 'land', tk: 'det.row.episodes', items: eps }, f);
      if (zone === 'eps') { epRow.setFocused(true); placeRing(epRing(epRow.ringPos())); infoLater(eps[epRow.f]); }
      else if (zone === 'tabs' && !placeholders && !tabInfo(seasons[sIdx]) && eps[epRow.f] && eps[epRow.f] !== infoFor) infoLater(eps[epRow.f]);   // Reiter: Info zur gewaehlten Staffel (auch zurueck von der Katalog-Staffel)
      paintStrip();
      ensureEpPages();
      // Karte (Nr. 16): beginnt oben bei Info und Knoepfen – kein Sprung zur Folge/Staffel (die Reihe steht trotzdem dort)
      if (!card && !placeholders && it0.type === 'episode' && zone === 'btn' && !s.entered) { s.entered = true; toEps(); }
      if (!card && !placeholders && it0.type === 'season' && zone === 'btn' && !s.entered) { s.entered = true; toTabs(); }
      N.idle.add(updateHints, 'det-hints');
    }
    /* Erweiterung mischt Karten in eine vollstaendig geladene Staffel (z. B. Folgen ohne Datei); Fokus bleibt auf derselben Folge */
    function decorate(f) {
      var se = seasons[sIdx];
      if (!xt || !xt.decorate || !se || se.virtual) return f;
      for (var i = 0; i < eps.length; i++) if (!eps[i] || (eps[i].ph && !eps[i].miss)) return f;   // noch nicht alles geladen
      var base = pmsEps && eps !== pmsEps && eps.length >= pmsEps.length ? pmsEps : eps, cur = eps[f];
      var m = xt.decorate(se, base);
      if (!m) { if (eps !== base) { eps = base; epsTotal = base.length; } pmsEps = base; return Math.max(0, base.indexOf(cur)); }
      pmsEps = base; eps = m; epsTotal = m.length; allPages(epsTotal);
      var k = m.indexOf(cur);
      return k >= 0 ? k : U.clamp(f, 0, m.length - 1);
    }
    function ensureEpPages() {
      var se = seasons[sIdx]; if (!se || !epsTotal) return;
      var f = epRow.f, a = Math.floor(Math.max(0, f - 5) / 50), b = Math.floor(Math.min(epsTotal - 1, f + 12) / 50);
      if (epRow.free) { var sc = epRow.sc; a = Math.min(a, Math.floor(Math.max(0, sc - 5) / 50)); b = Math.max(b, Math.floor(Math.min(epsTotal - 1, sc + 12) / 50)); }   // frei gerollt: auch um die sichtbaren Karten
      for (var p = a; p <= b; p++) loadEpPage(se, p);
    }
    /* Rechts neben den Reitern (SPEC DET-3), zwei Zeilen, je eigene Einstellung:
     * 1) Staffelstreifen M der gewaehlten Staffel + "{k} von {n} ungesehen" (episodeProgress). Marker: in Reitern/Folgen die
     *    fokussierte Folge, sonst (Knoepfe) die naechste Folge der Serie, falls sie in dieser Staffel liegt.
     * 2) Serien-Balken, ein Segment je Staffel + "Serie: …" (seriesProgress). Nur eine der beiden an -> sie steht allein
     *    in der Reiter-Zeile (Klasse ss-solo). Platzhalter einer Erweiterung (miss) zaehlen nicht: der Streifen zeigt nur
     *    Folgen auf dem Server (TV-Befund 28.10.: sonst "Folge 1 von 12" mit Balken statt der Felder). Nur Schreiben, kein Messen. */
    function paintStrip() {
      // ganz fehlende Staffel (Katalog der Erweiterung): kein leerer Streifen (TV-Test 29.10.: duenne Linie ohne Text)
      var st = N.session.settings || {}, se = seasons[sIdx], epOn = !!st.episodeProgress && !!se && !se.virtual, sbl = st.seriesProgress && se ? N.SeasonStrip.seriesBar(baseSeasons, se.index, TIGHT ? SW() : 0) : { mode: 'none' };   // nur Staffeln vom Server (ohne Katalog-Staffeln der Erweiterung, sonst springt die Zahl)
      var i;
      if (epOn) {
        var cur = eps[epRow.f], foc = (zone === 'eps' || zone === 'tabs') && cur && !cur.ph ? cur : null, src = D.stripSource(eps);
        var lay = N.SeasonStrip.layout({ enabled: true, size: 'M', episodes: src.full ? src.eps : null, total: se.leaf || src.n, viewed: se.vleaf,
          next: foc ? foc.e : d && d.ondeck && d.ondeck.s === se.index ? d.ondeck.e : 0, threshold: N.config.watchedThreshold, barW: TIGHT ? SW() : 0 });
        strip.render(lay);
        var x = RX - (lay.width || 0);
        strip.el.style.left = x + 'px';
        U.setText(stripT, lay.mode === 'bar' ? lay.text : N.t('ss.countUnwatched', { k: Math.max(0, (se.leaf || 0) - (se.vleaf || 0)), n: se.leaf || 0 }));
        if (TIGHT) { strip.el.style.top = (SS_A + 2) + 'px'; stripT.parentNode.style.cssText = 'left:144px;top:' + SS_A + 'px;width:' + Math.max(0, x - 16 - 144) + 'px'; }
        else stripT.parentNode.style.width = Math.max(0, x - 16 - 600) + 'px';
      } else { strip.render({ mode: 'none' }); U.setText(stripT, ''); }
      U.cls(sec, 'ss-solo', !epOn);
      U.show(sbar, sbl.mode !== 'none');
      U.setText(sbarT, N.SeasonStrip.seriesText(sbl));
      if (TIGHT) {                                      // schmale Karte: rechtsbuendig an RX, Zeile B (bzw. A, wenn der Streifen aus ist)
        var ly = epOn ? SS_B : SS_A, bw = sbl.width || SW();
        sbar.style.cssText = 'left:' + (RX - bw) + 'px;top:' + (ly + 8) + 'px;width:' + bw + 'px' + (sbl.mode === 'none' ? ';display:none' : '');
        sbarT.parentNode.style.cssText = 'left:144px;top:' + ly + 'px;width:' + Math.max(0, RX - bw - 16 - 144) + 'px;line-height:20px';
      }
      for (i = 0; i < 40; i++) {
        var sg = segs[i], dd = sbl.mode === 'segments' ? sbl.segments[i] : sbl.mode === 'single' && i === 0 ? { x: 0, w: sbl.width, fill: sbl.fill, sel: true } : null;
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
      for (i = rdrv.length - 1; i >= 0; i--) if (rdrv[i].row !== epRow) { rdrv[i].d.stop(); rdrv.splice(i, 1); }   // Antriebe der alten Reihen
      var defs = [];
      if (d.cast.length) defs.push({ id: 'cast', kind: 'cast', tk: 'det.row.cast', items: d.cast });
      if (d.extras.length) defs.push({ id: 'extras', kind: 'land', tk: 'det.row.extras', items: d.extras });
      /* optionale Erweiterung (xt.similar): darf hinten weitere Karten anhaengen, z. B. Titel ausserhalb des Servers (it.ext) */
      var sim = d.related.length ? d.related[0].items : [];
      if (xt && xt.similar) sim = xt.similar(sim) || sim;
      if (sim.length) defs.push({ id: 'similar', kind: 'poster', tk: 'det.row.similar', items: sim });
      for (i = 0; i < defs.length; i++) addRow(defs[i]);
    }
    function addRow(def) {
      var y = rows.length ? rows[rows.length - 1].top + PITCH[rows[rows.length - 1].row.model.kind] : isShow ? SEC + ANCHOR + PITCH.land : PEEK;
      var r = new N.ui.Row(pg, { captions: function () { return true; }, w: card ? cardW() : 0, free: RFREE });
      r.setModel(def, 0); r.setTop(y);
      rows.push({ row: r, top: y, id: def.id });
    }
    function simRow() { for (var i = 0; i < rows.length; i++) if (rows[i].id === 'similar') return rows[i]; return null; }
    function simGrow() {
      var r = simRow(), sim = xt && xt.similarList ? xt.similarList() : null;
      if (r) { r.row.render(2, 2); r.row.relabel(); return; }
      if (!sim || !sim.length) return;
      addRow({ id: 'similar', kind: 'poster', tk: 'det.row.similar', items: sim });
      hideAbove();
    }

    /* ---------- Zonen & Fokus ---------- */
    function placeRing(p) { if (p && !sb.on) ring.to(p.shape, p.x, p.y - off); }
    function epRing(p) { if (p) p.y += SEC; return p; }   // Folgenreihe liegt im Abschnitt (SEC tiefer)
    /* Info-Block: erster Bildschirm unten (Hero), in den Abschnitten oben (folgt dann der Folge) */
    function heroInfo(on) { if (!card) hero.hero(on); }   // Karte: Info bleibt oben auf der Seite
    function rowOff(i) { return rows[i].top - anchorOf(rows[i].row.model.kind); }
    function setOff(o) {
      if (card) { if (N.input.mode === 'key') cardTo(o, true); return; }   // Karte: Seite rollt zum Fokus (nur Tasten); off bleibt 0
      if (o !== off) { off = o; N.fx.move(pg); U.tf(pg, 0, -o); }
      hideAbove();
    }
    /* Abschnitte, die nach oben unter den Kopf geschoben sind, ausblenden (nach der Bewegung): das Kopfband laeuft nach rechts
     * aus (TV-Befund 28.10.: Bild rechts sonst unnoetig dunkel), dort darf nichts Altes durchscheinen. Keine Messung (feste Positionen). */
    /* Abschnitt (Seiten-y seiner Oberkante) liegt beim aktuellen Versatz unter dem Kopf -> ausgeblendet, fuer den Zeiger nicht da */
    function above(top) { return top - off < ANCHOR - LIFT - 24; }
    function hideAbove() {
      if (card) return;                                   // Karte: nichts liegt unter einem festen Kopf
      var b = [], i, show = [], hide = [];                // Knoepfe: dimButtons; display, weil Kinder (Pfeile) visibility setzen
      if (isShow) b.push([sec, SEC + 332]);
      for (i = 0; i < rows.length; i++) b.push([rows[i].row.el, rows[i].top]);
      for (i = 0; i < b.length; i++) (above(b[i][1]) ? hide : show).push(b[i][0]);
      if (hideT) clearTimeout(hideT);
      for (i = 0; i < show.length; i++) U.show(show[i], true);
      hideT = hide.length ? setTimeout(function () { hideT = 0; if (!dead) for (var k = 0; k < hide.length; k++) U.show(hide[k], false); }, 180) : 0;
    }
    function updateHints() { N.router.refreshHints(); }
    function leaveZone() {
      if (zone === 'btn') { U.cls(btns[bf], 'is-focus', false); U.show(blbl, false); }
      else if (zone === 'tabs') { zone = ''; markTabs(); }
      else if (zone === 'eps') epRow.setFocused(false);
      else if (zone === 'row' && rows[rk]) rows[rk].row.setFocused(false);
    }
    /* Karte auf flacher Flaeche (Mac-Fenster ab 516, Befund 03.11.: Knoepfe unten angeschnitten): so weit gerollt, dass die Knopfreihe
     * (Seite y 448–496) mit 16 Abstand ganz im Bild ist; sonst 0 */
    /* Karte auf flacher Flaeche (Befund 03.11., iPhone quer mit Tastatur: Fokus-Reihe halb unter der Hinweisleiste): Versatz o mindestens
     * so gross, dass die Reihe bis bottom (Seiten-y) mit Platz fuer die Hinweisleiste (88) im Bild ist; TV/Seite: o unveraendert */
    function fitLow(o, bottom) { return card ? Math.max(o, Math.min(cardMax(), bottom + 88 - cardH())) : o; }
    function btnOff() { return card ? Math.max(0, 512 - cardH()) : 0; }
    function btnFit() { var bo = btnOff(); if (bo && cpage && cy < bo) cardTo(bo, false); }   // erster Aufbau: Knopfreihe ins Bild
    function toBtn() {
      var bo = btnOff();
      leaveZone(); zone = 'btn'; setOff(bo); heroInfo(true); ring.hide(); dimButtons(false);
      if (N.input.mode !== 'key') btnFit();               // Finger/Maus: auch ohne Tasten einmal ins Bild
      U.cls(btns[bf], 'is-focus', true); paintLabel();
      if (d && infoFor !== d.it) infoLater(d.it);
      if (isShow) N.idle.add(function () { if (!dead) paintStrip(); }, 'det-strip');   // Marker wieder auf der naechsten Folge (nicht die zuletzt fokussierte)
      markTabs(); N.router.refreshHints();
    }
    function toTabs() {
      if (tabHold) releaseTabs();                          // Nutzer will zu den Reitern: nicht weiter warten
      if (!seasons.length) return;
      if (btnDirty && d) buildButtons(d.it);
      leaveZone(); zone = 'tabs'; setOff(SEC); heroInfo(false); ring.hide(); dimButtons(true);
      tabF = sIdx; markTabs(); scrollTabs();
      if (!tabInfo(seasons[sIdx]) && eps[epRow.f]) infoLater(eps[epRow.f]);
      N.router.refreshHints();
    }
    function toEps() {
      if (seasonT && epRow && epRow.vis === false) { clearTimeout(seasonT); seasonT = 0; loadSeason(sIdx); }   // Karten der neuen Staffel sofort
      if (!epRow || !epRow.count()) return;
      leaveZone(); zone = 'eps'; setOff(fitLow(SEC, SEC + 392 + (epRow ? epRow.g.h : 0))); heroInfo(false); dimButtons(true); markTabs();
      epRow.setFocused(true); placeRing(epRing(epRow.ringPos()));
      infoLater(eps[epRow.f]); ensureEpPages();
      N.router.refreshHints();
    }
    function toRow(i) {
      if (!rows[i]) return;
      leaveZone(); zone = 'row'; rk = i; dimButtons(true);
      setOff(fitLow(rowOff(i), rows[i].top + 52 + rows[i].row.g.capY)); heroInfo(false);
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
      if (zone === 'tabs') return seasons[sIdx] && !seasons[sIdx].virtual ? seasonItem(seasons[sIdx]) : null;
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
      else if (xt && xt.button) xt.button(id);
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
      var vs = N.versions.list(d.media), e = [], lim = N.decision.verLimit((N.session.settings || {}).quality);
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
        var em = epMeta.get(x.rk), text = U.trim(em && em.sum || x.sum, N.det.MAXI);
        N.ui.panel.help(N.t('det.epTitle', { e: x.e, title: x.epTitle }), text);
        return;
      }
      var t = D.info(x, d), al = N.anime.infoLine(x);
      if (al) t = al + '\n\n' + t;                   // Grund der Anime-Einordnung (nur wenn die Kategorie gezeigt wird)
      if (isShow && seasons.length) {
        var all = 0, seen = 0;
        for (var i = 0; i < seasons.length; i++) if (seasons[i].index !== 0) { all += seasons[i].leaf; seen += seasons[i].vleaf; }
        t = U.trim(t + '\n\n' + N.t('det.seriesInfo', { k: seen, n: all }), N.det.MAXI);
      }
      N.ui.panel.help(x.title, t);
    }
    /* Tipp auf eine Folge in der Karte (Finger/Maus): Folgen-Ebene statt Abspielen. false = TV/Tasten -> Aufrufer spielt wie immer */
    function epLevel(x) {
      if (!card || N.input.mode === 'key' || !x || x.ph || x.miss) return false;
      epOpen = x; N.theme.stop();
      N.router.push('episode', { it: x, srv: srv, rail: s.rail });
      return true;
    }
    function rowOpen(x, how) {
      if (!x) return;
      var r = rows[rk];
      if (r.id === 'cast') { N.theme.stop(); N.router.push('library', { lib: libOf(d.lib || x.lib), actor: { id: x.id, t: x.title } }); return; }
      if (r.id === 'extras') { playExtra(x); return; }
      if (x.ext) { if (!how) { N.theme.stop(); N.router.push('extdetails', { it: x, rail: s.rail }); } return; }   // Titel ausserhalb des Servers (Erweiterung): kein Abspielen
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
      /* Rot/Gruen nur, wo sie etwas tun: Knoepfe und echte Folgen (TV-Test 29.10.: auf dem Reiter einer ganz fehlenden Staffel stand
       * "Von vorne / Ton & UT"; in der Reiter-Zeile tun beide nichts) */
      var x = focusedItem(), list = zone === 'btn' || (zone === 'eps' && x) ? [{ k: 'red', t: 'hint.fromStart' }, { k: 'green', t: 'hint.tracks' }] : [];
      if (zone === 'row' && x && x.ext) return [{ k: 'OK', t: 'hint.details' }, N.disc.blueHint()];   // Karte ausserhalb des Servers: nur Details
      if (x && M.isVideo(x)) list.push({ k: 'yellow', t: M.watched(x) ? 'hint.markUnwatched' : 'hint.markWatched' });
      list.push(N.disc.blueHint());
      if (list.length < 5) list.push({ k: 'INFO', t: 'hint.details' });
      if (xt && xt.hints) list = xt.hints(zone === 'eps' ? eps[epRow.f] : null, list) || list;
      return list;
    };

    /* ---------- Lebenszyklus ---------- */
    s.enter = function (p, restore) {
      away = false;
      if (!d && !gen) { if (restore) { zone = 'btn'; } load(); return; }
      if (dirty) { load(); dirty = false; }
      else if (epOpen) afterWatched(epOpen, M.watched(epOpen));   // zurueck aus der Folgen-Ebene: Karte, Zaehler, Knoepfe
      epOpen = null;
      if (zone === 'btn') { U.cls(btns[bf], 'is-focus', true); paintLabel(); }
      else if (zone === 'eps') { epRow.setFocused(true); placeRing(epRing(epRow.ringPos())); }
      else if (zone === 'row' && rows[rk]) { rows[rk].row.setFocused(true); placeRing(rows[rk].row.ringPos()); }
      var sr = simRow();
      if (sr && xt && xt.similarList) sr.row.refreshAll();   // Marken von Erweiterungs-Karten koennen sich geaendert haben (Anfrage auf deren Seite)
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
      if (xt && xt.close) xt.close();
      for (var i = 0; i < tasks.length; i++) if (tasks[i]) tasks[i].abort();
      N.evt.off('playback:stopped', onPlayed); N.evt.off('watched:changed', onWatched); N.evt.off('anime:changed', onAnime);
      if (seasonT) clearTimeout(seasonT); if (tabHoldT) clearTimeout(tabHoldT); if (bubbleTm) clearTimeout(bubbleTm); if (jump.t) clearTimeout(jump.t);
      rowsStop(); if (epRow) epRow.clear();
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
      if (arrowH >= 0) hoverArrow(-1);                    // Taste: wieder der normale Reiter-Fokus
      if (k === 'BLUE') { N.router.push(N.disc.blueView()); return true; }
      if (zone === 'state') { if (sb.onKey(k)) return true; return k !== 'RETURN'; }
      if (k === 'RETURN') { N.router.back(); return true; }
      if (RFREE && (k === 'LEFT' || k === 'RIGHT') && unfree(zone === 'eps' ? epRow : zone === 'row' && rows[rk] ? rows[rk].row : null)) return true;   // erste Taste nach dem Wischen: nur Fokus setzen
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
          case 'ENTER': if (tabF !== sIdx) selectSeason(tabF); else toEps(); return true;   // Zeiger-Fokus auf anderem Reiter: OK waehlt ihn
          case 'YELLOW': if (!seasons[sIdx].virtual) toggleWatched(seasonItem(seasons[sIdx])); return true;
          case 'PLAY': playMain('resume'); return true;
        }
        return true;
      }
      if (zone === 'eps') {
        var f = epRow.f, e = eps[f];
        if (e && e.miss && xt && xt.key && xt.key(e, k)) return true;
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
          case 'LEFT': if (R.f > 0) { placeRing(R.focusCol(R.f - 1)); N.idle.add(updateHints, 'det-hints'); } else N.ui.rail.open(); return true;
          case 'RIGHT': if (R.f < R.count() - 1) { placeRing(R.focusCol(R.f + 1)); N.idle.add(updateHints, 'det-hints'); } return true;
          case 'ENTER': rowOpen(x); return true;
          case 'PLAY': if (x && x.ext) return true; if (rows[rk].id === 'similar' && x) play(x, 'resume'); else rowOpen(x); return true;
          case 'YELLOW': if (rows[rk].id === 'similar' && x && !x.ext) toggleWatched(x); return true;
        }
        return true;
      }
      return true;
    };

    /* ---------- Zeiger (Index-Mathe + einmal gemessene Rechtecke) ---------- */
    /* Wie Suche/Bibliothek (NAV-2, DET-9). Bisher rollte jeder Zeiger-Fokus auf einen anderen Abschnitt die Seite (toTabs/toEps/
     * toRow), und ausgeblendete Abschnitte ueber dem Kopf blieben Trefferflaechen -> Rueckkopplung Hover -> Rollen -> anderer
     * Abschnitt unter dem stehenden Punkt -> Rollen … Jetzt: Fokus ohne Rollen nur im eingerasteten Abschnitt; ein anderer, zu
     * >= 40 % sichtbarer (die Staffel-Reiter unter den Knoepfen) kommt erst nach 250 ms Verweilen bzw. per Klick herein, danach
     * Zeiger-Sperre; sonst Randzonen (ein Abschnitt je Schritt, Fokus kommt mit) oder Rad. Treffer in Seitenkoordinaten
     * (y + off); ausgeblendete Abschnitte (above) sind keine Ziele. */
    var RM = N.RowMath, TOP_CLIP = ANCHOR - LIFT - 24;
    /* Stopps der Seite: Knoepfe 0, Staffeln/Folgen SEC, je Reihe ihr Versatz (aufsteigend) */
    function secStops() {
      var a = [{ o: 0, z: 'btn' }];
      if (isShow && (seasons.length || (epRow && epRow.count()))) a.push({ o: SEC, z: 'sec' });
      for (var i = 0; i < rows.length; i++) a.push({ o: rowOff(i), z: 'row', i: i });
      return a;
    }
    function stopOffs(a) { for (var o = [], i = 0; i < a.length; i++) o.push(a[i].o); return o; }
    /* Zeigeziele (ohne Knoepfe): {z: 'tabs'|'eps'|'row', i, cy (Bildschirm-y), h, v (RowMath.secVis)} */
    function targets() {
      var out = [], top = off ? TOP_CLIP : 0, i;
      function add(z, k, blockTop, py, h, stop) { if (!above(blockTop)) out.push({ z: z, i: k, cy: py - off, h: h, v: RM.secVis(py - off, h, stop === off, top) }); }
      if (isShow && tabX.length) add('tabs', 0, SEC + 332, SEC + 332, 40, SEC);
      if (isShow && epRow.count()) add('eps', 0, SEC + 332, SEC + 392, 162, SEC);
      for (i = 0; i < rows.length; i++) add('row', i, rows[i].top, rows[i].top + 52, rows[i].row.g.h, rowOff(i));
      return out;
    }
    function ptrAt(x, y) {
      if (y >= RM.VIS) return null;
      var t = targets();
      for (var i = 0; i < t.length; i++) if (t[i].v && y >= t[i].cy && y < t[i].cy + t[i].h) return t[i].z === 'tabs' && (x < 128 || x >= 128 + TABW) ? null : t[i];
      return null;
    }
    /* Pfeil ‹/› der Reiterzeile unter x: 0 links, 1 rechts, -1 keiner */
    function tabArrow(x) {
      var v = tabV;
      if (!v) return -1;
      if (v.left && x < 128 + TMORE) return 0;
      return v.right && x >= 128 + tabX[v.last][0] + tabX[v.last][1] - v.o + v.shift ? 1 : -1;
    }
    /* Ziel im eingerasteten Abschnitt bedienen (Fokus wie die Tasten; der Versatz bleibt, also rollt nichts) */
    function ptrAct(t, x, kind) {
      var i;
      if (t.z === 'tabs') {
        var v = tabV || { first: 0, last: tabX.length - 1 }, tx = x - 128 + (tstrip._off || 0), a = tabArrow(x);
        if (a >= 0) {                                    // Pfeil: naechste Staffel
          if (zone !== 'tabs') toTabs();
          hoverArrow(a);
          if (kind === 'click') { hoverArrow(-1); i = a ? v.last + 1 : v.first - 1; if (i !== tabF) selectSeason(i); }   // danach zeigt der neue Reiter den Fokus
          return true;
        }
        for (i = v.first; i <= v.last; i++) if (tx >= tabX[i][0] && tx < tabX[i][0] + tabX[i][1]) {
          if (zone !== 'tabs') toTabs();
          /* Nutzerbefund 03.11.: Vorbeiziehen wechselte schon die Staffel (unruhig). Zeiger ueber einem Reiter = nur Fokus, erst der
           * Klick waehlt die Staffel; Klick auf die gewaehlte Staffel = zu den Folgen. Tasten (◀/▶) waehlen weiter sofort. */
          if (kind !== 'click') { if (i !== tabF) { tabF = i; markTabs(); } }
          else if (i !== sIdx) selectSeason(i);
          else toEps();
          return true;
        }
        return false;
      }
      if (t.z === 'eps') {
        var j = RFREE ? epRow.hitAny(x) : epRow.hit(x);   // frei: auch angeschnittene Karten
        if (j < 0) return false;
        if (zone !== 'eps') toEps();
        if (j !== epRow.f) { placeRing(epRing(epRow.hoverCol(j))); infoLater(eps[j]); }
        if (kind === 'click' && eps[j] && eps[j].miss && xt && xt.key) xt.key(eps[j], 'ENTER');
        else if (kind === 'click' && eps[j] && !eps[j].ph) { if (!epLevel(eps[j])) play(eps[j], 'ask'); }   // Karte per Finger/Maus: Folgen-Ebene
        return true;
      }
      var r = rows[t.i].row, h = RFREE ? r.hitAny(x) : r.hit(x);
      if (h < 0) return false;
      if (zone !== 'row' || rk !== t.i) toRow(t.i);
      if (h !== r.f) { placeRing(r.hoverCol(h)); N.idle.add(updateHints, 'det-hints'); }
      if (kind === 'click') rowOpen(r.item(h));
      return true;
    }
    /* angeschnittenen Abschnitt hereinholen (ein Schritt wie ▼/▲), Ziel unter dem Punkt fokussieren, dann Zeiger-Sperre */
    function reveal(t, x, kind) {
      N.fx.step(true);
      ptrAct(t, x, 'move');
      if (kind === 'click') ptrAct(t, x, 'click');
      N.pointer.scrolled();                             // Inhalt ist unter dem Punkt gewandert -> Sperre bis zur naechsten Bewegung
    }
    s.pointer = function (x, y, kind) {
      if (sb.on) return sb.pointer(x, y, kind);
      if (card) return cardPointer(x, y, kind);
      var py = y + off, t, i;                           // Seitenkoordinaten
      if (!off && py >= 448 && py < 496 && btnRects) {   // gescrollt: Knoepfe unsichtbar, kein Treffer unter dem Kopf
        N.pointer.holdCancel(); if (arrowH >= 0) hoverArrow(-1);
        for (i = 0; i < btnRects.length; i++) if (x >= btnRects[i][0] && x < btnRects[i][0] + btnRects[i][1]) {
          if (zone !== 'btn') toBtn();
          if (i !== bf) setBtn(i);
          if (kind === 'click') btnAct(bdefs[i].id);
          return true;
        }
        return false;
      }
      var ez = s.pointerEdge(x, y);
      if (ez) {                                         // Randzone: rollt (Verweilen/Klick), fokussiert nicht
        N.pointer.holdCancel(); if (arrowH >= 0) hoverArrow(-1);
        if (kind === 'click') s.pointerScroll(ez.d);
        return true;
      }
      t = ptrAt(x, y);
      if (arrowH >= 0 && !(t && t.z === 'tabs' && t.v === 'full' && tabArrow(x) >= 0)) hoverArrow(-1);
      if (!t) { N.pointer.holdCancel(); return false; }
      if (t.v === 'part') {                             // anderer Abschnitt: Vorbeiziehen loest nichts aus
        if (kind === 'click') { N.pointer.holdCancel(); reveal(t, x, kind); return true; }
        N.pointer.hold(function () { var c = ptrAt(N.pointer.x, N.pointer.y); if (!dead && !away && !sb.on && c && c.v === 'part' && c.z === t.z && c.i === t.i) reveal(c, N.pointer.x); });
        return true;
      }
      N.pointer.holdCancel();
      return ptrAct(t, x, kind);
    };
    /* Randzonen ueber der Inhaltsbreite: oben y 276–332 (zwischen Info-Block und Abschnitt), solange die Seite gerollt ist; unten
     * ab RowMath.secEdgeB bis 656 (ueber der Hinweisleiste), solange ein weiterer Abschnitt folgt. Pille bei x 600 (zwischen
     * Reitern und Staffelstreifen). */
    s.pointerEdge = function (x, y) {
      if (card) return null;                            // Karte: Seite scrollt frei, keine Randzonen
      if (sb.on || zone === 'state' || x < 128 || x >= 1216) return null;
      var st = stopOffs(secStops());
      if (off > 0 && y >= 276 && y < 332 && RM.secNext(st, off, -1) >= 0) return { d: -1, x: 600, y: 304 };
      if (y >= RM.secEdgeB(targets(), off ? TOP_CLIP : 0) && y < 656 && RM.secNext(st, off, 1) >= 0) return { d: 1, x: 600, y: 636 };
      return null;
    };
    /* ein Schritt = ein Abschnitt (wie ▼/▲): nach unten in Staffeln/Folgen zuerst die Reiter, nach oben zuerst die Folgen */
    s.pointerScroll = function (d) {
      var st = secStops(), k = RM.secNext(stopOffs(st), off, d), t = k >= 0 ? st[k] : null;
      if (!t) return;
      if (arrowH >= 0) hoverArrow(-1);
      if (t.z === 'btn') toBtn();
      else if (t.z === 'sec') { if (d > 0 ? seasons.length : !epRow.count()) toTabs(); else toEps(); }
      else toRow(t.i);
    };
    s.pointerSig = function () { return card ? Math.round(cy) : off; };   // Zeiger-Scroll-Sperre (N.pointer)

    /* ---------- Detailkarte: freie Seite, Treffer, Gesten (nur card) ---------- */
    function cardW() { var g = N.ui.card.g; return g ? g.cw : 1280; }
    function SW() { return Math.min(336, Math.max(96, Math.round((RX - 144) * 0.45))); }   // Balkenbreite in der schmalen Karte
    function cardH() { var g = N.ui.card.g; return g ? g.ch : 720; }
    /* Unterkante des Inhalts (Seiten-px): letzte Reihe samt Beschriftung, sonst Folgenreihe bzw. erster Bildschirm */
    function pageBottom() {
      var b = isShow && epRow ? SEC + ANCHOR + 52 + 162 + 150 : 720, i;
      for (i = 0; i < rows.length; i++) b = Math.max(b, rows[i].top + 52 + rows[i].row.g.capY + 150);   // Beschriftung + Platz ueber der Hinweisleiste
      return Math.max(b, 720);
    }
    function cardMax() { return Math.max(0, pageBottom() - cardH()); }
    function setCy(v) { cy = v; U.tf(cpage, 0, -Math.round(v * 100) / 100); ptrFollow(); }   // Bruchteile: Feder/Ausklingen ohne Treppenstufen
    /* Apple Nr. 29 (NAV-23): Inhalt wandert unter dem stehenden Maus-/Trackpad-Zeiger -> Treffer dort neu bestimmen (der Ring liegt in
     * der Seite und scrollt senkrecht von selbst mit; waagerecht setzt ihn rowDrive) */
    function ptrFollow() { if (N.input.mode === 'pointer' && N.pointer && N.pointer.follow) N.pointer.follow(); }
    function cardStop() { canim = 0; cgen++; if (ckin) ckin.stop(); }
    function cardRun() { var g = cgen; canim = 1; U.raf(function (ts) { if (g !== cgen || dead) return; if (ckin.step(N.kinetic.frameTime(ts, U.now))) setCy(ckin.pos); if (ckin.ph.length) cardRun(); else cardSettle(); }); }
    /* Ruhe (Nr. 18: kein Einrasten): bleibt, wo sie ausgelaufen ist, innerhalb der Grenzen */
    function cardSettle() { cardStop(); setCy(Math.max(0, Math.min(cardMax(), cy))); }
    /* Tasten: Fokus-Abschnitt (TV-Versatz o) in den Blick rollen */
    function cardTo(o, anim) {
      cardStop();
      var v = Math.max(0, Math.min(cardMax(), o));
      if (v === cy) return;
      cpage.style.webkitTransition = anim ? '' : 'none';   // mit Uebergang aus flex.css (.cd-page), bei Tastenwiederholung ohne
      if (anim) N.fx.move(cpage);
      setCy(v);
    }
    /* waagerechte Baender (Seiten-y): Reiter, Folgen, Reihen -> {z, i, row} oder null */
    function bandAt(py) {
      if (isShow && tabX.length && py >= SEC + 332 && py < SEC + 376) return { z: 'tabs' };
      if (isShow && epRow && epRow.count() && py >= SEC + 392 && py < SEC + 392 + epRow.g.h + 40) return { z: 'eps', row: epRow };
      for (var i = 0; i < rows.length; i++) if (py >= rows[i].top + 52 && py < rows[i].top + 52 + rows[i].row.g.capY + 40) return { z: 'row', i: i, row: rows[i].row };
      return null;
    }
    function cardPointer(x, y, kind) {
      var py = y + cy, i;
      if (kind === 'click' && (canim || ceat)) { ceat = false; cardStop(); return true; }   // Beruehrung im Auslaufen: nur anhalten
      if (py >= 448 && py < 496 && btnRects) {
        for (i = 0; i < btnRects.length; i++) if (x >= btnRects[i][0] && x < btnRects[i][0] + btnRects[i][1]) {
          if (zone !== 'btn') toBtn();
          if (i !== bf) setBtn(i);
          if (kind === 'click') btnAct(bdefs[i].id);
          return true;
        }
        return false;
      }
      var b = bandAt(py);
      if (!b) return false;
      if (b.z === 'tabs') return x >= 128 && x < 128 + TABW ? ptrAct({ z: 'tabs' }, x, kind) : false;
      return ptrAct(b.z === 'eps' ? { z: 'eps' } : { z: 'row', i: b.i }, x, kind);
    }
    /* Router (Kartengesten): ganz oben -> Ziehen nach unten schliesst; waagerecht ausserhalb einer Reihe -> zurueck */
    s.cardTop = function () { return !card || cy <= 0.5; };
    s.cardBackOk = function (x, y) { return !card || sb.on || !bandAt(y + cy); };
    /* Mac: Rad/Trackpad rollt die Seite frei (ungedrosselt; N.pointer.wheel) */
    s.wheelPx = function (dd) {
      if (!card || sb.on) return false;
      cardStop(); cpage.style.webkitTransition = 'none';
      setCy(Math.max(0, Math.min(cardMax(), cy + dd)));
      return true;
    };
    /* Rad/Trackpad in Pixeln (N.pointer.wheelPx, Inhalts-Koordinaten der Karte): senkrecht rollt die Seite frei; waagerecht ueber
     * einer Reihe rollt die Reihe frei (RFREE), sonst sammelt ein Zwei-Finger-Wisch nach rechts (dx < 0) den Weg
     * und geht ab WHEEL_BACK px eine Ebene zurueck (wie Safari, Nr. 10; auf der ersten Ebene nichts). Danach ruht der waagerechte
     * Weg WHEEL_REST ms, damit der Nachlauf derselben Geste nicht noch eine Ebene zurueckgeht. */
    s.wheel = function (x, y, dx, dy) {
      if (!card || sb.on) return false;
      if (Math.abs(dy) >= Math.abs(dx)) { wAcc = 0; return s.wheelPx(dy); }
      var now = U.now();
      var wb = bandAt(y + cy);
      if (wb && wb.row && RFREE && N.kinetic) { rowDrive(wb.row).nudge(dx); return true; }   // ueber einer Reihe: Reihe frei (wie Startseite)
      if (now - wheelBackT < WHEEL_REST || wb) return true;
      if (now - wLast > 250) wAcc = 0;
      wLast = now; wAcc += dx;
      if (wAcc < -WHEEL_BACK && N.router.cardDepth() > 1) { wAcc = 0; wheelBackT = now; N.router.back(); }
      return true;
    };
    s.pointerDown = function () {                       // Finger auf die auslaufende Seite/Reihe: anhalten, der Klick danach oeffnet nichts
      if (!card) return;
      var m = rowsStop();
      if (canim) { cardStop(); m = true; }
      if (m) ceat = true;
    };
    /* An den Anfang (App.scrollTop, Tipp ganz oben / Cmd+Pfeil hoch): Inhalt der Karte gleitet nach oben */
    s.scrollTop = function () {
      if (!card || !N.kinetic || dead || !(cy > 0.5)) return false;
      cardStop(); cpan = null;
      cpage.style.webkitTransition = 'none';
      var g = cgen;
      canim = 1;
      N.kinetic.tween(cy, 0, function (v) { if (g === cgen && !dead) setCy(v); }, function () { if (g === cgen && !dead) cardSettle(); });
      return true;
    };
    s.pan = function (e) {
      if (!card) return false;
      if (e.phase === 'start') {
        cardStop(); ceat = false;
        cpage.style.webkitTransition = 'none';
        if (sb.on) { cpan = { k: 'none' }; return true; }
        if (e.axis === 'x') {
          var b = bandAt(e.y + cy);
          if (b && b.row && RFREE && N.kinetic) {                    // Reihe folgt dem Finger (frei, Schwung, Gummiband)
            if (b.row.pend) b.row.render(1, 1);
            cpan = { k: 'rx', d: rowDrive(b.row), last: 0, b: b };
            cpan.d.grab(e.t);
            return true;
          }
          cpan = b && b.row ? { k: 'row', b: b } : { k: 'none' };    // Reiter/ausserhalb: nichts (Zurueck nimmt der Router)
          return true;
        }
        if (!N.kinetic) { cpan = { k: 'none' }; return true; }
        if (!ckin) ckin = new N.kinetic.Scroller({ snap: 0, dim: cardH() });
        ckin.setMax(cardMax(), cardH()); ckin.pos = cy; ckin.grab(e.t);
        cpan = { k: 'y', dy: 0 };
        return true;
      }
      if (!cpan) return true;
      var p = cpan;
      if (p.k === 'y') {
        var dd = -(e.dy - p.dy); p.dy = e.dy;
        if (e.phase === 'move') { ckin.move(dd, e.t); setCy(ckin.pos); return true; }
        cpan = null;
        if (e.cancel) { cardSettle(); return true; }
        ckin.up(e.t);
        if (ckin.ph.length) cardRun(); else cardSettle();
        return true;
      }
      if (p.k === 'rx') {
        var dx = -(e.dx - p.last); p.last = e.dx;                  // Finger nach links -> Lage waechst
        if (e.phase === 'move') { p.d.move(dx, e.t); return true; }
        cpan = null;
        p.d.up(e.t, e.cancel);
        return true;
      }
      if (e.phase !== 'end') return true;
      cpan = null;
      if (p.k === 'row' && !e.cancel) rowSwipe(p.b, e.dx);
      return true;
    };
    /* Antrieb einer Reihe (einmal je Reihe): Lage = Row.px, ein Transform je Frame; nach dem Auslaufen Folgen-Seiten nachladen */
    function rowDrive(r) {
      for (var i = 0; i < rdrv.length; i++) if (rdrv[i].row === r) return rdrv[i].d;
      var d = new N.kinetic.Drive({ dim: cardW(), get: function () { return r.curPx(); }, max: function () { return r.maxPx(); },
        set: function (p) {
          if (N.idle) N.idle.touch();
          r.setPx(p);
          if (N.input.mode !== 'pointer') return;
          if (r === epRow ? zone === 'eps' : zone === 'row' && rows[rk] && rows[rk].row === r) { N.fx.step(true); placeRing(r === epRow ? epRing(r.ringPos()) : r.ringPos()); }
          ptrFollow();
        },
        end: function () { if (!dead && r === epRow) ensureEpPages(); } });
      rdrv.push({ row: r, d: d });
      return d;
    }
    function rowsStop() { var m = false; for (var i = 0; i < rdrv.length; i++) if (rdrv[i].d.stop()) m = true; return m; }
    /* erste Taste nach freiem Rollen einer Reihe: Fokus an die erste ganz sichtbare Karte, Reihe zurueck ins Tastenraster */
    function unfree(r) {
      if (!r || !r.free) return false;
      rowsStop();
      r.fix(r.anchorCol());
      var p = r.ringPos();
      if (r === epRow) { placeRing(epRing(p)); infoLater(eps[epRow.f]); ensureEpPages(); } else placeRing(p);
      N.idle.add(updateHints, 'det-hints');
      return true;
    }
    /* Reihe per Wisch blaettern (nur ohne freies Scrollen: Rueckfall ohne N.kinetic): Finger nach links = weiter, Schritte nach Weg */
    function rowSwipe(b, dx) {
      var r = b.row, n = r.count(), g = r.g, k = Math.round(-dx / g.step);
      if (!k || !n) return;
      var sc = U.clamp(r.sc + k, 0, N.RowMath.maxScroll(n, g.full)), f = U.clamp(r.f + (sc - r.sc), 0, n - 1);
      if (sc === r.sc) return;
      var p = r.focusTo(f, sc);
      if (b.z === 'eps') { ensureEpPages(); if (zone === 'eps') placeRing(epRing(p)); }
      else if (zone === 'row' && rows[rk] && rows[rk].row === r) placeRing(p);
    }
    s.relabel = function () { if (d) buildButtons(d.it); if (seasons.length) buildTabs(); if (infoFor) paintInfo(infoFor); };
    return s;
  });

  /* ---------- Folgen-Ebene der Detailkarte (Apple Nr. 23, SPEC DET-11; nur caps.details 'card' + Finger/Maus) ----------
   * Tipp auf eine Folge in der Karte oeffnet diese Ebene in DERSELBEN Karte (Pfeil zurueck), statt sofort abzuspielen: Bild,
   * Ueberzeile (Serie · Staffel), Titel, Metazeile (Laufzeit, Erstausstrahlung, Rest), Beschreibung (Spoilerschutz wie die
   * Details; Tipp auf den Text bzw. INFO = ganzer Text), Knoepfe Abspielen/Fortsetzen, Von vorne, Gesehen. Am TV nie erreichbar
   * (ENTER auf einer Folge spielt wie immer). params: {it: Folge (normalisiert, dasselbe Objekt wie in der Folgenreihe), srv, rail} */
  var EP = { X: 144, Y: 104, W: 608, H: 342, TX: 784, TW: 432, BY: 478 };
  N.router.define('episode', function (params) {
    var x = params.it || {}, srv = x.srv || params.srv || '', s = { card: true, rail: params.rail || 'home' };
    /* schmale Karte (Apple, Klasse K): Bild ueber die volle Breite, Knoepfe darunter, Text darunter (TY); sonst Bild links, Text rechts */
    var cg = N.ui.card && N.ui.card.peek ? N.ui.card.peek() : null, E = EP;
    if (cg && cg.narrow) { var ew = cg.cw - 168, eh = Math.round(ew * 9 / 16); E = { X: 144, Y: 104, W: ew, H: eh, TX: 144, TW: ew, BY: 104 + eh + 32, TY: 104 + eh + 104 }; }
    var root, img, prog, progI, ovT, tiT, meT, deT, deEl, bar, btns = [], bdefs = [], rects = null, bf = 0, meta = null, dead = false, task = null, back = false;
    var onStop = null;
    function get(path, q, cb) { return N.plex.get(path, q, N.srv.o(srv, null), cb); }
    s.create = function (el) {
      root = el; U.cls(root, 'ep-lvl', true);
      var box = U.el('div', 'card ep-img', root, 'left:' + E.X + 'px;top:' + E.Y + 'px;width:' + E.W + 'px;height:' + E.H + 'px');
      var ph = U.txt('div', 'ph fb ' + N.ui.fbClass(x), box, x.epTitle || x.title || ''); ph.parentNode.style.display = x.still ? 'none' : '';
      img = U.el('img', '', box, 'width:' + E.W + 'px;height:' + E.H + 'px'); img.src = N.img.BLANK;
      if (x.still) N.img.want(img, N.img.url(x.still, 'backdrop'), 0);
      prog = U.el('div', 'prog', box); progI = U.el('i', '', prog);
      var col = U.el('div', 'ep-txt', root, 'left:' + E.TX + 'px;top:' + (E.TY || E.Y) + 'px;width:' + E.TW + 'px');
      ovT = U.txt('div', 'ep-ov t-label cacc ell', col, '');
      tiT = U.txt('div', 'ep-ti t-h1 clamp', col, '');
      meT = U.txt('div', 'ep-me t-body c2', col, '');
      deT = U.txt('div', 'ep-de t-body c2 clamp', col, ''); deEl = deT.parentNode;
      bar = U.el('div', 'ep-btns', root, 'left:' + E.X + 'px;top:' + E.BY + 'px');
      onStop = function () { back = true; };
      N.evt.on('playback:stopped', onStop);                // Rueckkehr aus dem Player: Fortschritt neu holen
      paint(); loadMeta();
    };
    function paint() {
      U.setText(ovT, N.det.overline(x));
      U.clampText(tiT, N.t('det.epTitle', { e: x.e, title: x.epTitle }));
      U.setText(meT, N.det.meta(x, meta));
      U.clampText(deT, N.comfort.summary(meta && meta.sum ? U.extend(U.extend({}, x), { sum: meta.sum }) : x));
      var p = M.progress(x);
      prog.style.display = p > 0 ? 'block' : 'none';
      if (p > 0) progI.style.width = Math.max(4, Math.round((E.W - 20) * p)) + 'px';
      buttons();
    }
    function buttons() {
      while (bar.firstChild) bar.removeChild(bar.firstChild);
      bdefs = N.det.buttons(x, null).filter(function (b) { return b.id !== 'more'; }); btns = []; rects = null;
      for (var i = 0; i < bdefs.length; i++) { var b = U.el('div', 'btn inl', bar); b.appendChild(document.createTextNode(bdefs[i].t)); btns.push(b); }
      bf = Math.min(bf, btns.length - 1);
      U.cls(btns[bf], 'is-focus', true);
      setTimeout(function () { if (dead) return; rects = []; for (var k = 0; k < btns.length; k++) rects.push([E.X + btns[k].offsetLeft, btns[k].offsetWidth]); }, 50);
    }
    /* volle Folgen-Metadaten (Beschreibung, Erstausstrahlung, aktueller Fortschritt) */
    function loadMeta() {
      if (!x.rk) return;
      if (task) task.abort();
      task = get('/library/metadata/' + x.rk, { excludeElements: 'Role,Director,Writer,Producer,Country,Genre' }, function (err, dd) {
        task = null;
        var m = !err && dd && dd.MediaContainer && dd.MediaContainer.Metadata && dd.MediaContainer.Metadata[0];
        if (!m || dead) return;
        meta = { date: String(m.originallyAvailableAt || ''), sum: String(m.summary || '') };
        var n = M.norm(m);
        if (n) { x.vc = n.vc; x.off = n.off; if (n.dur) x.dur = n.dur; }   // dasselbe Objekt wie in der Folgenreihe -> Karte stimmt beim Zurueckgehen
        paint();
      });
    }
    function setBtn(i) { U.cls(btns[bf], 'is-focus', false); bf = i; U.cls(btns[bf], 'is-focus', true); N.fx.move(btns[bf]); }
    function act(id) {
      if (id === 'play') N.details.play(x, 'resume');
      else if (id === 'start') N.details.play(x, 'start');
      else if (id === 'watched') N.watch.toggle(x, { label: x.title, changed: function () { paint(); N.router.refreshHints(); }, reverted: function () { paint(); N.router.refreshHints(); } });
    }
    function info() { var t = U.trim(meta && meta.sum || x.sum || '', N.det.MAXI); N.ui.panel.help(N.t('det.epTitle', { e: x.e, title: x.epTitle }), t); }
    s.enter = function () { if (back) { back = false; loadMeta(); } N.router.refreshHints(); };
    s.leave = function () { return null; };
    s.destroy = function () { dead = true; if (task) task.abort(); N.evt.off('playback:stopped', onStop); N.img.drop(img); };
    s.hints = function () {
      var l = [];
      if (M.progress(x) > 0) l.push({ k: 'red', t: 'hint.fromStart' });
      l.push({ k: 'yellow', t: M.watched(x) ? 'hint.markUnwatched' : 'hint.markWatched' });
      l.push({ k: 'INFO', t: 'hint.details' }, { k: 'ret', t: 'hint.back' });
      return l;
    };
    s.onKey = function (k) {
      if (k === 'RETURN') { N.router.back(); return true; }
      if (k === 'LEFT') { if (bf > 0) setBtn(bf - 1); return true; }
      if (k === 'RIGHT') { if (bf < btns.length - 1) setBtn(bf + 1); return true; }
      if (k === 'ENTER') { if (bdefs[bf]) act(bdefs[bf].id); return true; }
      if (k === 'PLAY') { act('play'); return true; }
      if (k === 'RED') { if (M.progress(x) > 0) act('start'); return true; }
      if (k === 'YELLOW') { act('watched'); return true; }
      if (k === 'INFO') { info(); return true; }
      return true;
    };
    /* Zeiger/Tippen (Inhalts-Koordinaten der Karte): Knoepfe ueber einmal gemessene Rechtecke, Beschreibung = ganzer Text */
    s.pointer = function (px, py, kind) {
      if (rects && py >= E.BY && py < E.BY + 48) {
        for (var i = 0; i < rects.length; i++) if (px >= rects[i][0] && px < rects[i][0] + rects[i][1]) {
          if (i !== bf) setBtn(i);
          if (kind === 'click') act(bdefs[i].id);
          return true;
        }
        return false;
      }
      if (kind === 'click' && px >= E.TX && px < E.TX + E.TW && py >= (E.TY || E.Y) + deEl.offsetTop && py < (E.TY || E.Y) + deEl.offsetTop + deEl.offsetHeight) { info(); return true; }
      return false;
    };
    s.pan = function () { return true; };                 // passt auf eine Kartenhoehe: Zuege nimmt der Router (zurueck, nach unten) bzw. nichts
    s.cardTop = function () { return true; };
    s.cardBackOk = function () { return true; };
    s.relabel = function () { paint(); };
    return s;
  });

  /* ---------- Einstieg (Startseite, Bibliothek, Suche) ---------- */
  var busy = 0;
  var WHEEL_BACK = 120, WHEEL_REST = 700, wheelBackT = 0;   // Detailkarte: Zwei-Finger-Zurueck am Mac [T] (s.wheel)
  N.details = {
    open: function (it) {
      if (!it) return;
      if (N.music.open(it)) return;                       // M4: Album, Kuenstler, Hoerbuch
      if (!N.model.isVideo(it)) { N.router.push('soon', { area: 'details', label: N.t('soon.music') }); return; }
      N.router.push('details', { it: it });
    },
    /* Tipp/Klick auf eine Kachel (Startseite, Mediathek) mit Detailkarte (caps.details 'card', Nr. 12/16): Film, Serie, Staffel,
     * Folge, Album, Kuenstler oeffnen die Karte – auch Weiterschauen-Kacheln (am TV spielen sie ab). true = erledigt; sonst (TV,
     * Tasten, "Alle anzeigen", fremde Titel, Sammlungen, Titel) bleibt es beim bisherigen Weg der Ansicht. */
    tap: function (it) {
      if (!it || it.all || it.ext || !N.ui.card || !N.ui.card.on() || N.input.mode === 'key') return false;
      if (!N.model.isVideo(it) && it.type !== 'album' && it.type !== 'artist') return false;
      N.details.open(it);
      return true;
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
