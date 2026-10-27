/* N.ui.mini – Mini-Player beim Stoebern (M4, research 3.2): Leiste unten rechts ueber der Hinweisleiste (Cover 48, Titel,
 * Interpret, duenner Balken, Taste B = Jetzt laeuft). Sichtbar, solange N.audio aktiv ist und weder Jetzt-laeuft noch der Video-Player
 * oben liegt. Aktualisierung hoechstens 1x/s und nur in Tastenruhe (keine DOM-Arbeit im Tastenpfad). Klick = Jetzt laeuft.
 * Ausserdem globale Hinweise zur Ton-Wiedergabe (Sleep-Timer, Fehler) und Stop beim Profilwechsel (Token gehoert zum Profil). */
(function (N) {
  var U = N.util, MU = N.music, X = 856, Y = 572, W = 360, H = 64, HIDE = { nowplaying: 1, player: 1, login: 1, profiles: 1, start: 1 };
  var M = { el: null, on: false, rk: '', timer: 0, w: -1 };
  M.init = function (parent) {
    var e = M.el = U.el('div', 'mini', parent, 'display:none');
    M.img = U.el('img', '', e); M.img.src = N.img.BLANK;
    M.t1 = U.txt('div', 'mini-t1 ell', e, ''); M.t2 = U.txt('div', 'mini-t2 ell', e, '');
    M.ic = N.ui.icon(e, 'pause', 's1', 'left:252px;top:16px');
    var k = U.el('span', 'k k-green mini-k', e); k.appendChild(document.createTextNode('B'));
    M.bar = U.el('i', '', U.el('div', 'mini-bar', e));
    N.evt.on('audio:track', function () { M.rk = ''; M.update(true); });
    N.evt.on('audio:state', function () { M.update(true); });
    N.evt.on('router:top', function () { M.update(false); });   // Ansichtswechsel: sofort ein-/ausblenden (nicht erst nach 1 s)
    N.evt.on('profile:changed', function () { if (N.audio.active()) N.audio.stop('Profilwechsel'); });   // Rueckfall (Token gehoert zum Profil)
    N.evt.on('audio:sleep', function (v) {
      if (v === 'soon') N.ui.toast.show(N.t('pl.toast.sleepSoon'), { icon: 'info' });
      else if (v === 'done') N.ui.toast.show(N.t('mu.toast.sleepDone'), { icon: 'info' });
      else N.ui.toast.show(v === 'off' ? N.t('pl.toast.sleepOff') : v === 'end' ? N.t('mu.toast.sleepEnd') : N.t('pl.toast.sleep', { n: v }), { icon: 'confirm' });
    });
    N.evt.on('audio:error', function (d) {
      N.diag.log('warn', 'audio Fehler ' + (d && d.detail));
      var un = d && d.kind === 'unreach';
      if (un && d.stop) {                                // Laufwerk am Server weg (PMS 404): klar sagen statt Titel durchzuspringen (F7)
        N.ui.toast.hide();
        N.ui.dialog.open({ title: N.t('dlg.muUnreach.title'), text: N.t('dlg.muUnreach.text'), buttons: [{ id: 'ok', t: N.t('dlg.muUnreach.confirm') }] });
        return;
      }
      N.ui.toast.show(N.t(un ? 'mu.toast.unreachNext' : 'mu.err.track'), { icon: 'info' });
    });
  };
  M.arm = function () { if (!M.timer) M.timer = setInterval(function () { M.update(false); }, 1000); };
  /* Sichtbarkeit + Inhalt; force = Titel/Zustand geaendert */
  M.update = function (force) {
    if (!M.el) return;
    var c = N.audio.core(), top = N.router.topName(), act = N.audio.active();
    if (act && top === 'profiles') { N.audio.stop('Profilwechsel'); act = false; }
    var show = act && !HIDE[top];
    if (show !== M.on) { M.on = show; U.show(M.el, show); force = true; }
    if (!show) { if (M.timer) { clearInterval(M.timer); M.timer = 0; } return; }   // Takt nur, solange sichtbar
    M.arm();
    if (!force && N.idle.restFor() < 300) return;
    var it = c.item;
    if (it && it.rk !== M.rk) {
      M.rk = it.rk;
      U.setText(M.t1, it.title); U.setText(M.t2, c.book && c.ctx && c.ctx.title ? c.ctx.title : it.artist);
      N.img.want(M.img, it.thumb ? N.img.url(it.thumb, 'listSq') : '', 1);
    }
    N.ui.setIcon(M.ic, c.state === 'paused' ? 'pause' : 'play');
    var d = c.dur(), w = d ? Math.round(W * U.clamp(c.t / d, 0, 1)) : 0;
    if (w !== M.w) { M.w = w; M.bar.style.width = w + 'px'; }
  };
  M.pointer = function (x, y, kind) {
    if (!M.on || x < X || x >= X + W || y < Y || y >= Y + H) return false;
    if (kind === 'click') N.router.push('nowplaying');
    return true;
  };
  N.ui.mini = M;
})(N);
