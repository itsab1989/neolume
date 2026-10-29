/* Ansicht 'extdetails' – Detailseite eines Titels, der NICHT auf dem eigenen Server liegt (P4 Entdecken, docs/research/discover.md).
 * Gleiche Mechanik wie Film/Serie (N.ui.DetHero, Feedback-Regel 3/11): Hintergrund (Art des Plex-Katalogs scharf, sonst Poster
 * unscharf vom Server), Poster-Karte links, Ueberzeile "Film · Nicht auf deinem Server", Titel, Metazeile
 * "1978 · 1 Std. 31 Min. · R · 8,9/10 · Hier nicht abspielbar" (Serie: Staffeln + "Läuft noch"/"Abgeschlossen"), Beschreibung
 * (2 Zeilen mit "…", INFO = ganz), Genre-Chips + Zeile "Regie: …" bzw. "Sender · Idee: …", darunter die Reihe Besetzung.
 * KEIN Abspielen-Knopf. Knoepfe: mit Helfer "Auf die Merkliste" / "Von der Merkliste entfernen", sonst nur "Zurueck".
 * Daten (SPEC DISC-5): EINE Anfrage je Titel an den Helfer (GET /details, Plex-Katalog; N.disc.details, zwischengespeichert);
 * eine optionale Erweiterung (N.ext 'extdetails:open') kann ueber X.addInfo weitere Daten liefern – der
 * Plex-Katalog hat Vorrang, die Erweiterung fuellt Luecken. Ohne Helfer: nur was die PMS-Suche liefert (Jahr, Art,
 * Beschreibung) und – nur wenn die Beschreibung fehlt – ein freundlicher Hinweis, was der Helfer bringen wuerde.
 * Bilder (Besetzung, Art) sind https-Adressen; der Fernseher laedt sie ueber den Foto-Umrechner des PMS (N.img.url), verzoegert.
 * params: {it: fremder Eintrag aus N.disc (ext:true, guid, title, year, sum, thumb, type), rail (optional, Standard 'discover')} */
(function (N) {
  var U = N.util, D = N.disc, PEEK = 580, ANCHOR = 340;

  N.router.define('extdetails', function (params) {
    var it = params.it || {}, s = { rail: params.rail || 'discover', wheelKeys: ['LEFT', 'RIGHT'] };   // rail: von der Startseite 'home'
    var root, hero, pg, bar, row = null, ring, btns = [], bdefs = [], btnRects = null, bf = 0, dead = false, task = null, dtask = null, busy = false, xt = null;
    /* TV-Befund 28.10.: Knopfreihe sprang (eine Erweiterung setzte spaeter einen Knopf davor, Fokus wechselte) und die
     * Freigabe wechselte von der US- auf die deutsche Angabe. Meldet eine Erweiterung, dass ihr Stand noch kommt (xt.pending()), werden die Knoepfe
     * erst gebaut, wenn er da ist (hoechstens HOLD ms), und die Altersfreigabe erst gezeigt, wenn ihre Daten da sind (gleiche Frist). */
    var HOLD = 2500, holdBtn = false, holdCr = false, holdT = 0;
    var zone = 'btn', off = 0, px = null, sx = null, x = null, hstate = 'loading', bgDone = false, castN = 0;
    /* Schnittstelle fuer eine optionale Erweiterung (N.ext 'extdetails:open'): Knoepfe/Texte neu zeichnen, Daten ergaenzen */
    var X = {
      it: it, buttons: function () { if (!dead) buildButtons(); }, paint: function () { if (!dead) paint(); }, dead: function () { return dead; },
      /* weitere Daten im Modell von N.disc (emptyInfo); fuellt nur, was der Plex-Katalog nicht hat */
      addInfo: function (m) { if (dead) return; holdCr = false; if (m) sx = m; apply(); },
      info: function () { return x; }
    };

    s.create = function (el) {
      root = el;
      hero = new N.ui.DetHero(root);
      pg = U.el('div', 'pg', root);
      bar = U.el('div', 'd-btns', pg);
      hero.makeInfo(root, { chips: 3, line: true });
      hero.setPoster(it.thumb, it.title);
      var fade = U.el('img', 'fade', root); fade.src = N.assetBase + 'fade-bottom.png';
      ring = new N.ui.Ring(root);
      if (N.ext.has('extdetails:open')) xt = N.ext.call('extdetails:open', X) || null;
      holdBtn = !!(xt && xt.pending && xt.pending()); holdCr = !!(xt && xt.infoPending && xt.infoPending());
      if (holdBtn || holdCr) holdT = setTimeout(function () { holdT = 0; if (dead) return; var b = holdBtn; holdBtn = holdCr = false; paint(); if (b) buildButtons(); }, HOLD);
      paint();
      buildButtons();
      if (D.watchlistOn() && D.guidOk(it.guid)) task = D.wl.state(it, function () { task = null; if (!dead) buildButtons(); });
      load();
    };
    /* Helfer pruefen (einmal je Start, meist schon geschehen) -> Details holen; ohne Helfer sofort Rueckfall */
    function load() {
      D.probeHelper(function () {
        if (dead) return;
        dtask = D.details(it, function (err, info) {
          dtask = null;
          if (dead) return;
          px = info || null;
          hstate = info ? 'ok' : !D.helper() ? 'none' : err && err.type === 'nohelper' ? (D.helperState() === 'ok' ? 'old' : 'down') : err && (err.type === 'network' || err.type === 'timeout') ? 'down' : 'fail';
          apply();
          if (!bgDone) { bgDone = true; hero.loadBg(x && x.art || it.art || '', it.thumb || x && x.thumb || '', it.title); }   // ein Hintergrund: Art, sonst Poster unscharf
        });
      });
    }
    /* Quellen zusammenfuehren, Poster/Besetzung nachziehen, neu zeichnen */
    function apply() {
      x = D.mergeInfo(px, sx);
      if (!it.thumb && x && x.thumb) { it.thumb = x.thumb; hero.setPoster(x.thumb, it.title); }
      paint();
      buildRow();
    }
    function sumText() {
      var t = x && x.sum || it.sum || '';
      if (t || hstate === 'loading') return t;
      if (hstate === 'none') return N.t('disc.det.noHelper');
      if (hstate === 'old') return N.t('disc.det.oldHelper');
      if (hstate === 'down') return N.t('disc.det.helperDown');
      return N.t('disc.det.nosum');
    }
    function paint() {
      var o = xt && xt.paint ? xt.paint() : null;              // Erweiterung: eigener Zustand in Ueberzeile/Metazeile
      var xm = x && (holdCr || (o && o.noStatus)) ? U.extend(U.extend({}, x), holdCr ? { cr: '' } : {}) : x;   // Freigabe erst, wenn alle Quellen da sind
      if (xm && o && o.noStatus) xm.status = '';                // Erweiterung sagt selbst, ob die Serie laeuft (kein doppelter Stand)
      hero.paint(o && o.ov || D.overline(it), it.title, D.extMeta(it, xm, o && o.meta || undefined), sumText(), { chips: D.extChips(x), line: D.extLine(it, x) });
    }
    function buildRow() {
      var items = D.extCast(x);
      if (items.length === castN) return;                       // nur bei neuer/anderer Besetzung (eine Quelle kam spaeter)
      castN = items.length;
      if (row) { if (zone === 'row') toBtn(); row.clear(); if (row.el.parentNode) row.el.parentNode.removeChild(row.el); row = null; }
      if (!items.length) return;
      row = new N.ui.Row(pg, { captions: function () { return true; } });
      row.setModel({ id: 'cast', kind: 'cast', tk: 'det.row.cast', items: items }, 0);
      row.setTop(PEEK);
    }
    function buildButtons() {
      while (bar.firstChild) bar.removeChild(bar.firstChild);
      bdefs = []; btns = [];
      if (holdBtn && xt && xt.pending && xt.pending()) { btnRects = null; U.el('div', 'spinner sm d-wait', bar); return; }   // Stand der Erweiterung kommt gleich: noch keine Knoepfe, dafuer ein kleiner Lade-Kreis (sonst wirkt die Seite eingefroren)
      if (holdBtn) { holdBtn = false; if (!holdCr && holdT) { clearTimeout(holdT); holdT = 0; } }
      if (D.watchlistOn() && D.guidOk(it.guid)) bdefs.push({ id: 'wl', t: (xt && xt.wlLabel && xt.wlLabel(D.wl.has(it))) || N.t(D.wl.has(it) ? 'disc.wl.remove' : 'disc.wl.add') });   // Erweiterung: eigener Text
      bdefs.push({ id: 'back', t: N.t('err.btn.back') });
      if (xt && xt.buttons) xt.buttons(bdefs);
      btns = []; btnRects = null;
      for (var i = 0; i < bdefs.length; i++) { var b = U.el('div', 'btn inl', bar); b.appendChild(document.createTextNode(bdefs[i].t)); btns.push(b); }
      bf = Math.min(bf, btns.length - 1);
      if (zone === 'btn' && !N.ui.rail.isOpen()) U.cls(btns[bf], 'is-focus', true);
      setTimeout(function () { if (dead) return; btnRects = []; for (var k = 0; k < btns.length; k++) btnRects.push([352 + btns[k].offsetLeft, btns[k].offsetWidth]); }, 50);
    }
    function setBtn(i) { U.cls(btns[bf], 'is-focus', false); bf = i; U.cls(btns[bf], 'is-focus', true); N.fx.move(btns[bf]); }
    function act(id) {
      if (id === 'back') { N.router.back(); return; }
      if (id !== 'wl') { if (xt && xt.button) xt.button(id); return; }
      if (busy) return;
      var on = !D.wl.has(it);
      busy = true;
      task = D.wl.set(it, on, function (err) {
        busy = false; task = null;
        if (dead) return;
        if (err) { if (err.helper === 'down') { N.disc.downToast(true); buildButtons(); } else N.ui.toast.show(N.t('toast.wlFail'), { icon: 'info' }); return; }
        N.ui.toast.show(xt && xt.wlToast && xt.wlToast(on) || N.t(on ? 'toast.wlAdded' : 'toast.wlRemoved'), { icon: 'confirm' });   // Erweiterung: eigener Text
        buildButtons();
      });
    }
    function info() {
      var note = xt && xt.infoNote ? xt.infoNote() : '';         // Erweiterung: kurzer Hinweis unter der Beschreibung
      var o = xt && xt.paint ? xt.paint() : null;               // Erweiterung: Stand (z. B. "Film · Bald da") statt "Nicht auf deinem Server"
      N.ui.panel.help(it.title, D.extInfoText(it, x, sumText(), note, o ? { ov: o.ov, state: o.meta } : null), 700);
    }

    /* ---------- Zonen: Knoepfe | Besetzung (Seite rollt wie bei eigenen Titeln) ---------- */
    function placeRing(p) { if (p) ring.to(p.shape, p.x, p.y - off); }
    function setOff(o) { if (o !== off) { off = o; N.fx.move(pg); U.tf(pg, 0, -o); } }
    function dim(on) { U.cls(bar, 'dim', on); U.vis(bar, !on); }
    function toBtn() {
      if (zone === 'row' && row) row.setFocused(false);
      zone = 'btn'; setOff(0); hero.hero(true); ring.hide(); dim(false);
      if (btns[bf]) U.cls(btns[bf], 'is-focus', true);
      N.router.refreshHints();
    }
    function toRow() {
      if (!row || !row.count()) return;
      if (zone === 'btn' && btns[bf]) U.cls(btns[bf], 'is-focus', false);
      zone = 'row'; dim(true); setOff(PEEK - ANCHOR); hero.hero(false);
      row.setFocused(true); row.boost(); placeRing(row.ringPos());
      N.router.refreshHints();
    }

    s.hints = function () { return [{ k: 'ret', t: 'hint.back' }, { k: 'INFO', t: 'hint.details' }]; };
    s.enter = function () { if (N.ui.rail.isOpen()) return; if (zone === 'row' && row) { row.setFocused(true); placeRing(row.ringPos()); } else if (btns[bf]) U.cls(btns[bf], 'is-focus', true); N.router.refreshHints(); };
    s.leave = function () { return null; };
    s.destroy = function () { dead = true; if (holdT) clearTimeout(holdT); if (xt && xt.close) xt.close(); if (task) task.abort(); if (dtask) dtask.abort(); if (row) row.clear(); hero.destroy(); };
    s.railBlur = function () { ring.hide(); if (zone === 'row' && row) row.setFocused(false); else if (btns[bf]) U.cls(btns[bf], 'is-focus', false); };
    s.railFocus = function () { if (zone === 'row' && row) { row.setFocused(true); placeRing(row.ringPos()); } else if (btns[bf]) U.cls(btns[bf], 'is-focus', true); };
    s.onKey = function (k) {
      switch (k) {
        case 'INFO': info(); return true;
        case 'RETURN': N.router.back(); return true;
        case 'BLUE': N.router.push('search'); return true;
        case 'DOWN': if (zone === 'btn') toRow(); return true;
        case 'UP': if (zone === 'row') toBtn(); return true;
      }
      if (zone === 'row') {
        if (k === 'LEFT') { if (row.f > 0) placeRing(row.focusCol(row.f - 1)); else N.ui.rail.open(); }
        else if (k === 'RIGHT' && row.f < row.count() - 1) placeRing(row.focusCol(row.f + 1));
        return true;
      }
      switch (k) {
        case 'LEFT': if (bf > 0) setBtn(bf - 1); else N.ui.rail.open(); return true;
        case 'RIGHT': if (bf < btns.length - 1) setBtn(bf + 1); return true;
        case 'ENTER': if (bdefs[bf]) act(bdefs[bf].id); return true;
      }
      return true;
    };
    s.pointer = function (px0, y, kind) {
      var py = y + off, i;
      if (!off && py >= 448 && py < 496 && btnRects) {
        for (i = 0; i < btnRects.length; i++) if (px0 >= btnRects[i][0] && px0 < btnRects[i][0] + btnRects[i][1]) {
          if (zone !== 'btn') toBtn();
          if (i !== bf) setBtn(i);
          if (kind === 'click') act(bdefs[i].id);
          return true;
        }
        return false;
      }
      var ez = s.pointerEdge(px0, y);
      if (ez) { if (kind === 'click') s.pointerScroll(ez.d); return true; }   // Randzone: rollt (Verweilen/Klick), fokussiert nicht
      /* Besetzung nur, wenn ihr Abschnitt eingerastet ist (NAV-2, DET-9): unter den Knoepfen lugt nur ihr Kopf herein (Karten ab
       * y 632) – frueher rollte schon das Zeigen dorthin die Seite. Hin und zurueck ueber die Randzonen bzw. per Klick. */
      if (row && N.RowMath.secVis(PEEK + 52 - off, row.g.h, off === PEEK - ANCHOR, off ? ANCHOR - 24 : 0) === 'full' && py >= PEEK + 52 && py < PEEK + 52 + row.g.h && y < N.RowMath.VIS) {
        var h = row.hit(px0);
        if (h < 0) return false;
        if (zone !== 'row') toRow();
        if (h !== row.f) placeRing(row.hoverCol(h));
        return true;
      }
      return false;
    };
    s.pointerSig = function () { return off; };             // Zeiger-Scroll-Sperre (N.pointer)
    /* Randzonen wie bei eigenen Titeln (details.js): oben y 276–332 zurueck zu den Knoepfen, unten ab 604 bis 656 zur Besetzung */
    s.pointerEdge = function (px0, y) {
      if (px0 < 128 || px0 >= 1216) return null;
      if (off > 0 && y >= 276 && y < 332) return { d: -1, x: 600, y: 304 };
      if (!off && row && row.count() && y >= N.RowMath.EDGE_B && y < 656) return { d: 1, x: 600, y: 636 };
      return null;
    };
    s.pointerScroll = function (d) { if (d > 0) toRow(); else toBtn(); };
    s.relabel = function () { paint(); buildButtons(); if (row) row.relabel(); };
    return s;
  });
})(N);
