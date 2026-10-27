/* Ansicht 'login' – Anmeldung per Code (SPEC 7.1, Mockup login.html). Logik: N.LoginFlow (testbar).
 * Gruen / OK auf "Neuer Code" = neuer Code · RETURN = Beenden-Dialog · INFO = Hilfe. Poll stoppt beim Verlassen. */
(function (N) {
  var U = N.util;
  N.router.define('login', function () {
    var s = {}, flow = null, main, boxes = [], validT, statT, spin, btn, sb, tick = 0, token = null;
    s.create = function (root) {
      main = U.el('div', 'layer', root);
      var wm = U.el('div', 'wordmark', main);
      wm.appendChild(document.createTextNode(N.brand.wordmark[0]));
      U.txt('span', 'cacc', wm, N.brand.wordmark[1]);
      U.txt('div', 'a t-h1', main, N.t('login.title'), 'left:144px;top:120px;width:680px');
      var parts = N.t('login.step1', { link: '\u0000' }).split('\u0000');
      for (var i = 0; i < 3; i++) {
        var y = 192 + i * 48;
        U.txt('div', 'step-n', main, String(i + 1), 'top:' + y + 'px');
        var st = U.el('div', 'step-t ell', main, 'top:' + y + 'px');
        if (i === 0) {
          st.appendChild(document.createTextNode(parts[0]));
          U.txt('b', '', st, 'plex.tv/link');
          st.appendChild(document.createTextNode(parts[1] || ''));
        } else st.appendChild(document.createTextNode(N.t('login.step' + (i + 1))));
      }
      for (i = 0; i < 4; i++) boxes.push(U.txt('div', 'code-box', main, '', 'left:' + (144 + i * 104) + 'px'));
      validT = U.txt('div', 'a t-small c2', main, '', 'left:144px;top:480px;width:620px');
      spin = U.el('div', 'spinner sm', main, 'left:144px;top:520px');
      statT = U.txt('div', 'a t-small c2', main, '', 'left:180px;top:520px;width:620px');
      btn = U.el('div', 'btn is-focus', main, 'left:144px;top:568px');
      btn.appendChild(document.createTextNode(N.t('login.btnNewCode')));
      var qr = U.el('div', 'qr-panel', main), qi = U.el('img', '', qr);
      qi.src = N.assetBase + 'qr.png';
      U.txt('div', 'a t-small c2', main, N.t('login.qrCaption'), 'left:808px;top:500px;width:376px;text-align:center');
      sb = new N.ui.StateBlock(root);
    };
    function render(stt) {
      var code = stt.code || '';
      for (var i = 0; i < 4; i++) U.setText(boxes[i], code.charAt(i) || '');
      if (stt.name === 'error') { showError({ type: 'network' }, 'retryPin'); return; }
      U.show(main, true); sb.hide();
      U.show(spin, stt.name !== 'idle');
      if (stt.name === 'requesting') { U.setText(statT, N.t('login.requesting')); U.setText(validT, ''); }
      else if (stt.name === 'waiting') { U.setText(statT, stt.renewed ? N.t('login.newCodeMade') : N.t('login.waiting')); updateValidity(); }
      else if (stt.name === 'authorized') { U.setText(statT, N.t('login.finishing')); U.setText(validT, ''); finish(stt.token); }
    }
    function updateValidity() {
      if (!flow || flow.state.name !== 'waiting') return;
      U.setText(validT, N.t('login.validity', { mmss: N.fmt.mmss(flow.secondsLeft()) }));
      // "Neuer Code erstellt." nur kurz, danach wieder "wartet …"
      if (flow.state.renewed && U.now() - (flow.state.shownAt || (flow.state.shownAt = U.now())) > 4000) { flow.state.renewed = false; U.setText(statT, N.t('login.waiting')); }
    }
    function showError(err, action) {
      var tx = N.errs.texts(N.errs.kind(err, 'tv'), { server: N.errs.proxyHost() }, false);
      U.show(main, false);
      sb.show({ title: tx.title, text: tx.text, buttons: [{ id: 'retry', t: N.t('err.btn.retry') }, { id: 'more', t: N.t('err.btn.learnMore') }],
        onSelect: function (id) {
          if (id === 'more') { N.ui.panel.help(N.t('help.title'), N.t('help.proxy')); return; }
          if (action === 'finish') finish(token); else flow.start(false);
        } });
    }
    function finish(tok) {
      token = tok;
      if (flow) flow.stop();
      N.session.completeLogin(tok, function (err, info) {
        if (err) { showError(err, 'finish'); return; }
        N.ui.toast.show(N.t('toast.signedIn', { name: info.name }), { icon: 'confirm' });
        N.app.route();
      });
    }
    s.enter = function () {
      if (flow) flow.stop();
      flow = new N.LoginFlow({ api: N.auth, now: U.now, onChange: render,
        timers: { set: function (f, ms) { return setTimeout(f, ms); }, clear: function (t) { clearTimeout(t); } } });
      flow.start(false);
      tick = setInterval(updateValidity, 1000);
    };
    s.leave = function () { if (flow) flow.stop(); if (tick) clearInterval(tick); tick = 0; return null; };
    s.destroy = s.leave;
    s.hints = function () {
      if (sb && sb.on) return [{ k: 'ret', t: 'hint.exit' }];
      return [{ k: 'green', t: 'hint.newCode' }, { k: 'ret', t: 'hint.exit' }, { k: 'INFO', t: 'hint.help' }];
    };
    s.onKey = function (k) {
      if (sb.on) { if (sb.onKey(k)) return true; }
      else if (k === 'GREEN' || k === 'ENTER') { flow.newCode(); return true; }
      if (k === 'INFO') { N.ui.panel.help(N.t('help.title'), N.t('help.login')); return true; }
      if (k === 'RETURN') { N.ui.dialog.exitApp(); return true; }
      return true;
    };
    s.pointer = function (x, y, kind) {
      if (sb.on) return sb.pointer(x, y, kind);
      if (kind === 'click' && N.hit.rect(144, 568, 240, 48, x, y)) { flow.newCode(); return true; }
      return false;
    };
    return s;
  });
})(N);
