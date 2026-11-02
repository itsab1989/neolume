/* Ansicht 'login' – Anmeldung per Code (SPEC 7.1, Mockup login.html). Logik: N.LoginFlow (testbar).
 * Gruen / OK auf "Neuer Code" = neuer Code · RETURN = Beenden-Dialog · INFO = Hilfe. Poll stoppt beim Verlassen.
 * Mit caps.webLogin (Geraet mit System-Anmeldefenster, z. B. iPad/iPhone/Mac) zuerst "Mit Plex anmelden" (N.WebLoginFlow,
 * offizielle Plex-Anmeldeseite), darunter klein "Mit Code anmelden" = der Code-Weg von oben; RETURN dort fuehrt zurueck.
 * Ohne caps.webLogin (Fernseher) entsteht genau der Code-Bildschirm wie bisher. */
(function (N) {
  var U = N.util;
  N.router.define('login', function () {
    var BACK = { x: 400, y: 568, w: 160, h: 48 };   // Zurueck-Knopf (nur Finger/Maus): neben "Neuer Code" (oben steht die Marke)
    var s = {}, flow = null, main, boxes = [], validT, statT, spin, btn, sb, tick = 0, token = null;
    var WEB = !!(N.platform && N.platform.caps.webLogin && N.platform.auth), mode = WEB ? 'web' : 'code', rootEl = null;
    var web = { el: null, flow: null, btn: null, codeBtn: null, statT: null, statEl: null, spin: null, f: 0 };
    function buildCode(root) {
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
      /* Finger/Maus (Apple Nr. 26: keine Hinweisleiste): Zurueck zur Anmeldung am Geraet als echter Knopf oben links (CSS .tback, am TV nie) */
      if (WEB) U.txt('div', 'btn tback', main, '\u2039 ' + N.t('hint.back'), 'left:' + BACK.x + 'px;top:' + BACK.y + 'px;width:' + BACK.w + 'px;text-align:center;padding:0');
      var qr = U.el('div', 'qr-panel', main), qi = U.el('img', '', qr);
      qi.src = N.assetBase + 'qr.png';
      U.txt('div', 'a t-small c2', main, N.t('login.qrCaption'), 'left:808px;top:500px;width:376px;text-align:center');
    }
    /* Anmeldung direkt am Geraet: Titel, Erklaerung, grosser Knopf, Status, darunter klein der Code-Weg */
    function buildWeb(root) {
      var w = web.el = U.el('div', 'layer', root);
      var wm = U.el('div', 'wordmark', w);
      wm.appendChild(document.createTextNode(N.brand.wordmark[0]));
      U.txt('span', 'cacc', wm, N.brand.wordmark[1]);
      U.txt('div', 'a t-h1', w, N.t('login.title'), 'left:144px;top:120px;width:680px');
      U.txt('div', 'a t-body c2', w, N.t('login.web.text'), 'left:144px;top:192px;width:760px');
      U.txt('div', 'a t-body c2', w, N.t('login.web.private'), 'left:144px;top:264px;width:760px');
      // U.txt liefert den Textknoten: Knoepfe und Statuszeile brauchen das Element (Klasse, style, offsetWidth). Frueher stand
      // hier der Textknoten -> webRender warf bei "style.left" (undefined), bevor die PIN angelegt war: ewiger Ladekreis (Nr. 15)
      web.btn = U.txt('div', 'btn is-focus', w, N.t('login.btnWeb'), 'left:144px;top:352px;width:320px;padding:0;text-align:center').parentNode;
      web.spin = U.el('div', 'spinner sm', w, 'left:144px;top:432px');
      web.statT = U.txt('div', 'a t-small c2', w, '', 'left:144px;top:432px;width:760px');
      web.statEl = web.statT.parentNode;
      U.txt('div', 'a t-small c2', w, N.t('login.web.codeHint'), 'left:144px;top:520px;width:760px');
      web.codeBtn = U.txt('div', 'btn', w, N.t('login.btnCode'), 'left:144px;top:568px').parentNode;
      U.show(web.spin, false);
    }
    s.create = function (root) {
      rootEl = root;
      if (WEB) buildWeb(root); else buildCode(root);
      sb = new N.ui.StateBlock(root);
    };
    function webFocus(f) { web.f = f; U.cls(web.btn, 'is-focus', f === 0); U.cls(web.codeBtn, 'is-focus', f === 1); }
    function webRender(stt) {
      if (stt.name === 'error') { showError(stt.err || { type: 'network' }, 'retryWeb'); return; }
      U.show(web.el, true); sb.hide();
      var busy = stt.name === 'requesting' || stt.name === 'open' || stt.name === 'authorized';
      U.show(web.spin, busy);
      web.statEl.style.left = busy ? '180px' : '144px';
      var t = '';
      if (stt.name === 'requesting') t = N.t('login.web.opening');
      else if (stt.name === 'open') t = N.t('login.web.waiting');
      else if (stt.name === 'authorized') { t = N.t('login.finishing'); }
      else if (stt.notice) t = N.t('login.web.' + stt.notice);
      U.setText(web.statT, t);
      if (stt.name === 'authorized') finish(stt.token);
    }
    function webStart() {
      if (!web.flow) {
        web.flow = new N.WebLoginFlow({ api: N.auth, now: U.now, onChange: webRender,
          web: { open: function (url, cb) { N.platform.auth.web(url, cb); }, close: function () { N.platform.auth.close(); } },
          timers: { set: function (f, ms) { return setTimeout(f, ms); }, clear: function (t) { clearTimeout(t); } } });
      }
      web.flow.start();
    }
    /* Web -> Code-Weg (und zurueck mit RETURN) */
    function toCode() {
      if (web.flow) web.flow.stop();
      if (!main) buildCode(rootEl);
      mode = 'code';
      U.show(web.el, false); U.show(main, true);
      if (sb.on) sb.hide();
      startCode();
    }
    function toWeb() {
      if (flow) flow.stop();
      if (tick) clearInterval(tick);
      tick = 0;
      mode = 'web';
      U.show(main, false); U.show(web.el, true);
      if (sb.on) sb.hide();
      webRender(web.flow ? web.flow.state : { name: 'idle', notice: '' });
      webFocus(0);
      if (N.router.refreshHints) N.router.refreshHints();
    }
    function startCode() {
      if (flow) flow.stop();
      flow = new N.LoginFlow({ api: N.auth, now: U.now, onChange: render,
        timers: { set: function (f, ms) { return setTimeout(f, ms); }, clear: function (t) { clearTimeout(t); } } });
      flow.start(false);
      if (tick) clearInterval(tick);
      tick = setInterval(updateValidity, 1000);
      if (N.router.refreshHints) N.router.refreshHints();
    }
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
      if (main) U.show(main, false);
      if (web.el) U.show(web.el, false);
      sb.show({ title: tx.title, text: tx.text, buttons: [{ id: 'retry', t: N.t('err.btn.retry') }, { id: 'more', t: N.t('err.btn.learnMore') }],
        onSelect: function (id) {
          if (id === 'more') { N.ui.panel.help(N.t('help.title'), N.t('help.proxy')); return; }
          if (action === 'finish') finish(token);
          else if (action === 'retryWeb') webStart();
          else flow.start(false);
        } });
    }
    function finish(tok) {
      token = tok;
      if (flow) flow.stop();
      if (web.flow) web.flow.stop();
      N.session.completeLogin(tok, function (err, info) {
        if (err) { showError(err, 'finish'); return; }
        N.ui.toast.show(N.t('toast.signedIn', { name: info.name }), { icon: 'confirm' });
        N.app.route();
      });
    }
    s.enter = function () {
      if (mode === 'web') { webRender(web.flow ? web.flow.state : { name: 'idle', notice: '' }); webFocus(0); return; }
      if (flow) flow.stop();
      flow = new N.LoginFlow({ api: N.auth, now: U.now, onChange: render,
        timers: { set: function (f, ms) { return setTimeout(f, ms); }, clear: function (t) { clearTimeout(t); } } });
      flow.start(false);
      tick = setInterval(updateValidity, 1000);
    };
    s.leave = function () { if (flow) flow.stop(); if (web.flow) web.flow.stop(); if (tick) clearInterval(tick); tick = 0; return null; };
    s.destroy = s.leave;
    s.hints = function () {
      if (sb && sb.on) return [{ k: 'ret', t: 'hint.exit' }];
      if (mode === 'web') return [{ k: 'ret', t: 'hint.exit' }, { k: 'INFO', t: 'hint.help' }];
      if (WEB) return [{ k: 'green', t: 'hint.newCode' }, { k: 'ret', t: 'hint.back' }, { k: 'INFO', t: 'hint.help' }];
      return [{ k: 'green', t: 'hint.newCode' }, { k: 'ret', t: 'hint.exit' }, { k: 'INFO', t: 'hint.help' }];
    };
    function webKey(k) {
      if (sb.on) { if (sb.onKey(k)) return true; }
      else if (k === 'UP' || k === 'DOWN' || k === 'LEFT' || k === 'RIGHT') { webFocus(k === 'DOWN' || k === 'RIGHT' ? 1 : 0); return true; }
      else if (k === 'ENTER') { if (web.f === 1) toCode(); else webStart(); return true; }
      if (k === 'INFO') { N.ui.panel.help(N.t('help.title'), N.t('help.loginWeb')); return true; }
      if (k === 'RETURN') { N.ui.dialog.exitApp(); return true; }
      return true;
    }
    s.onKey = function (k) {
      if (mode === 'web') return webKey(k);
      if (WEB && k === 'RETURN' && !sb.on) { toWeb(); return true; }
      if (sb.on) { if (sb.onKey(k)) return true; }
      else if (k === 'GREEN' || k === 'ENTER') { flow.newCode(); return true; }
      if (k === 'INFO') { N.ui.panel.help(N.t('help.title'), N.t('help.login')); return true; }
      if (k === 'RETURN') { N.ui.dialog.exitApp(); return true; }
      return true;
    };
    s.pointer = function (x, y, kind) {
      if (sb.on) return sb.pointer(x, y, kind);
      if (mode === 'web') {
        var onWeb = N.hit.rect(144, 352, 320, 48, x, y), onCode = N.hit.rect(144, 568, web.codeBtn.offsetWidth || 240, 48, x, y);
        if (kind === 'click' && onWeb) { webFocus(0); webStart(); return true; }
        if (kind === 'click' && onCode) { webFocus(1); toCode(); return true; }
        if (kind === 'move' && (onWeb || onCode)) { webFocus(onWeb ? 0 : 1); return true; }
        return false;
      }
      if (kind === 'click' && N.hit.rect(144, 568, 240, 48, x, y)) { flow.newCode(); return true; }
      if (WEB && N.input.direct() && N.hit.rect(BACK.x, BACK.y, BACK.w, BACK.h, x, y)) { if (kind === 'click') toWeb(); return true; }
      return false;
    };
    return s;
  });
})(N);
