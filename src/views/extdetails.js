/* Ansicht 'extdetails' – Detailseite eines Titels, der NICHT auf dem eigenen Server liegt (P4 Entdecken, docs/research/discover.md).
 * Gleiche Mechanik wie Film/Serie (N.ui.DetHero, Feedback-Regel 3/11): Hintergrund = Poster vom Server unscharf vorgerechnet
 * (kein Art-Bild verfuegbar), Poster-Karte links, Ueberzeile "Film · Nicht auf deinem Server", Titel, "2025 · hier nicht
 * abspielbar", Beschreibung. KEIN Abspielen-Knopf. Besetzung liefert der PMS fuer fremde Titel nicht -> kein Abschnitt darunter.
 * Knoepfe: mit Helfer "Auf die Merkliste" / "Von der Merkliste entfernen", sonst nur "Zurueck". INFO = ganze Beschreibung.
 * params: {it: fremder Eintrag aus N.disc (ext:true, guid, title, year, sum, thumb, type)} */
(function (N) {
  var U = N.util, F = N.fmt, D = N.disc;

  N.router.define('extdetails', function (params) {
    var it = params.it || {}, s = { rail: 'discover', wheelKeys: ['LEFT', 'RIGHT'] };
    var hero, bar, btns = [], bdefs = [], btnRects = null, bf = 0, dead = false, task = null, busy = false;

    s.create = function (root) {
      hero = new N.ui.DetHero(root);
      var pg = U.el('div', 'pg', root);
      bar = U.el('div', 'd-btns', pg);
      hero.makeInfo(root);
      hero.setPoster(it.thumb, it.title);
      hero.loadBg('', it.thumb, it.title);           // ohne Art: Poster unscharf (blur vom Server), ohne Poster Farbflaeche
      paint();
      buildButtons();
      if (D.watchlistOn()) task = D.wl.state(it, function () { task = null; if (!dead) buildButtons(); });
    };
    function paint() {
      hero.paint(D.overline(it), it.title, F.join([it.year || '', N.t('disc.det.note')]), it.sum || N.t('disc.det.nosum'));
    }
    function buildButtons() {
      while (bar.firstChild) bar.removeChild(bar.firstChild);
      bdefs = [];
      if (D.watchlistOn()) bdefs.push({ id: 'wl', t: N.t(D.wl.has(it) ? 'disc.wl.remove' : 'disc.wl.add') });
      bdefs.push({ id: 'back', t: N.t('err.btn.back') });
      btns = []; btnRects = null;
      for (var i = 0; i < bdefs.length; i++) { var b = U.el('div', 'btn inl', bar); b.appendChild(document.createTextNode(bdefs[i].t)); btns.push(b); }
      bf = Math.min(bf, btns.length - 1);
      if (!N.ui.rail.isOpen()) U.cls(btns[bf], 'is-focus', true);
      setTimeout(function () { if (dead) return; btnRects = []; for (var k = 0; k < btns.length; k++) btnRects.push([352 + btns[k].offsetLeft, btns[k].offsetWidth]); }, 50);
    }
    function setBtn(i) { U.cls(btns[bf], 'is-focus', false); bf = i; U.cls(btns[bf], 'is-focus', true); N.fx.move(btns[bf]); }
    function act(id) {
      if (id === 'back') { N.router.back(); return; }
      if (id !== 'wl' || busy) return;
      var on = !D.wl.has(it);
      busy = true;
      task = D.wl.set(it, on, function (err) {
        busy = false; task = null;
        if (dead) return;
        if (err) { if (err.helper === 'down') { N.disc.downToast(true); buildButtons(); } else N.ui.toast.show(N.t('toast.wlFail'), { icon: 'info' }); return; }
        N.ui.toast.show(N.t(on ? 'toast.wlAdded' : 'toast.wlRemoved'), { icon: 'confirm' });
        buildButtons();
      });
    }
    function info() { N.ui.panel.help(it.title, U.trim(F.join([D.overline(it), it.year || '']) + '\n\n' + (it.sum || N.t('disc.det.nosum')), 700)); }

    s.hints = function () { return [{ k: 'ret', t: 'hint.back' }, { k: 'INFO', t: 'hint.details' }]; };
    s.enter = function () { if (btns[bf] && !N.ui.rail.isOpen()) U.cls(btns[bf], 'is-focus', true); N.router.refreshHints(); };
    s.leave = function () { return null; };
    s.destroy = function () { dead = true; if (task) task.abort(); hero.destroy(); };
    s.railBlur = function () { if (btns[bf]) U.cls(btns[bf], 'is-focus', false); };
    s.railFocus = function () { if (btns[bf]) U.cls(btns[bf], 'is-focus', true); };
    s.onKey = function (k) {
      switch (k) {
        case 'LEFT': if (bf > 0) setBtn(bf - 1); else N.ui.rail.open(); return true;
        case 'RIGHT': if (bf < btns.length - 1) setBtn(bf + 1); return true;
        case 'ENTER': act(bdefs[bf].id); return true;
        case 'INFO': info(); return true;
        case 'RETURN': N.router.back(); return true;
        case 'BLUE': N.router.push('search'); return true;
      }
      return true;
    };
    s.pointer = function (x, y, kind) {
      if (y < 448 || y >= 496 || !btnRects) return false;
      for (var i = 0; i < btnRects.length; i++) if (x >= btnRects[i][0] && x < btnRects[i][0] + btnRects[i][1]) {
        if (i !== bf) setBtn(i);
        if (kind === 'click') act(bdefs[i].id);
        return true;
      }
      return false;
    };
    s.relabel = function () { paint(); buildButtons(); };
    return s;
  });
})(N);
