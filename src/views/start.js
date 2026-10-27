/* Ansicht 'start' – Startbild (Wortmarke) waehrend einmaliger plex.tv-Schritte (Migration/Erstanmeldung:
 * Konto, Profile, Server). Fehler -> err.proxy / err.auth mit "Erneut versuchen".
 * params.setupError: setup.json im Paket ist kaputt oder zu neu -> nur Hinweis "Einrichtung erneut ausfuehren" (kein plex.tv). */
(function (N) {
  var U = N.util;
  N.router.define('start', function (params) {
    var s = {}, sb, st, spin, task = null;
    s.create = function (root) {
      var wm = U.el('div', 'splash-wm', root);
      wm.appendChild(document.createTextNode(N.brand.wordmark[0]));
      U.txt('span', 'cacc', wm, N.brand.wordmark[1]);
      spin = U.el('div', 'spinner', root, 'left:620px;top:440px');
      st = U.txt('div', 'splash-st t-small c2', root, '');
      sb = new N.ui.StateBlock(root);
    };
    function run() {
      sb.hide(); U.show(spin, true); U.setText(st, N.t('common.connecting'));
      N.session.setup(function (err) {
        if (err) {
          U.show(spin, false); U.setText(st, '');
          var kind = N.errs.kind(err, 'tv'), tx = N.errs.texts(kind, { server: N.errs.proxyHost() }, false);
          sb.show({ title: tx.title, text: tx.text,
            buttons: kind === 'auth' ? [{ id: 'login', t: N.t('err.btn.signIn') }] : [{ id: 'retry', t: N.t('err.btn.retry') }, { id: 'more', t: N.t('err.btn.learnMore') }],
            onSelect: function (id) {
              if (id === 'retry') run();
              else if (id === 'more') N.ui.panel.help(N.t('help.title'), N.t('help.proxy'));
              else { N.session.signOut(); N.router.reset('login'); }
            } });
          return;
        }
        N.app.route();
      });
    }
    function setupBroken() {
      U.show(spin, false); U.setText(st, '');
      sb.show({ title: N.t('err.setupBad.title'), text: N.t('err.setupBad.text'), buttons: [{ id: 'exit', t: N.t('err.btn.exit') }],
        onSelect: function () { N.ui.dialog.exitApp(); } });
    }
    s.enter = function () { if (params && params.setupError) setupBroken(); else run(); };
    s.hints = function () { return sb && sb.on ? [{ k: 'ret', t: 'hint.exit' }] : []; };
    s.onKey = function (k) {
      if (sb.onKey(k)) return true;
      if (k === 'RETURN') { N.ui.dialog.exitApp(); return true; }
      return true;
    };
    s.pointer = function (x, y, kind) { return sb.pointer(x, y, kind); };
    return s;
  });
})(N);
