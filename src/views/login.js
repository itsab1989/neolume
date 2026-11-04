/* Ansicht 'login' – Anmeldung per Code (SPEC 7.1, Mockup login.html). Logik: N.LoginFlow (testbar).
 * Gruen / OK auf "Neuer Code" = neuer Code · RETURN = Beenden-Dialog · INFO = Hilfe. Poll stoppt beim Verlassen.
 * Mit caps.webLogin (Geraet mit System-Anmeldefenster, z. B. iPad/iPhone/Mac) zuerst "Mit Plex anmelden" (N.WebLoginFlow,
 * offizielle Plex-Anmeldeseite), darunter klein "Mit Code anmelden" = der Code-Weg von oben; RETURN dort fuehrt zurueck.
 * Ohne caps.webLogin (Fernseher) entsteht genau der Code-Bildschirm wie bisher.
 * Flexible Flaeche (nur Apple, 10-screens.md 7): breit (R·N) der TV-Bildschirm im Kasten; schmal oder flach (K/M, F) steht die
 * Ansicht 1:1 in der Flaeche (Klasse lg-fx, flex.css) und ordnet sich neu (lay): eine Spalte untereinander (hoch), Code-Weg flach
 * in zwei Spalten (links Schritte und Code, rechts Marke und QR-Code). Texte umbrechen, Abstaende nach gemessener Hoehe; Zeiger-
 * Treffer nach den gesetzten Lagen. Beim Drehen ohne Neuaufbau (screen:resized -> lay), die Anmeldung laeuft weiter. */
(function (N) {
  var U = N.util;
  N.router.define('login', function () {
    var BACK = { x: 400, y: 568, w: 160, h: 48 };   // Zurueck-Knopf (nur Finger/Maus): neben "Neuer Code" (oben steht die Marke)
    var s = {}, flow = null, main, boxes = [], validT, statT, spin, btn, sb, tick = 0, token = null;
    var WEB = !!(N.platform && N.platform.caps.webLogin && N.platform.auth), mode = WEB ? 'web' : 'code', rootEl = null;
    var web = { el: null, flow: null, btn: null, codeBtn: null, statT: null, statEl: null, spin: null, f: 0, ls: [], sx: 144 };
    var FXS = !!(N.screen && N.screen.flex), NAR = false, onRsz = null, ce = {};   // ce: Elemente des Code-Wegs fuer lay()
    function tvHit() { return { nc: { x: 144, y: 568, w: 240 }, bk: BACK, web: { x: 144, y: 352, w: 320 }, code: { x: 144, y: 568 } }; }
    var HIT = tvHit();                                   // Zeiger-Treffer der Knoepfe (TV-Lagen; schmal aus lay)
    function buildCode(root) {
      main = U.el('div', 'layer', root);
      var wm = ce.wm = U.el('div', 'wordmark', main);
      wm.appendChild(document.createTextNode(N.brand.wordmark[0]));
      U.txt('span', 'cacc', wm, N.brand.wordmark[1]);
      ce.ti = U.txt('div', 'a t-h1', main, N.t('login.title'), 'left:144px;top:120px;width:680px').parentNode;
      ce.sn = []; ce.st = [];
      var parts = N.t('login.step1', { link: '\u0000' }).split('\u0000');
      for (var i = 0; i < 3; i++) {
        var y = 192 + i * 48;
        ce.sn.push(U.txt('div', 'step-n', main, String(i + 1), 'top:' + y + 'px').parentNode);
        var st = U.el('div', 'step-t ell', main, 'top:' + y + 'px');
        ce.st.push(st);
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
      if (WEB) ce.bk = U.txt('div', 'btn tback', main, '\u2039 ' + N.t('hint.back'), 'left:' + BACK.x + 'px;top:' + BACK.y + 'px;width:' + BACK.w + 'px;text-align:center;padding:0').parentNode;
      var qr = ce.qr = U.el('div', 'qr-panel', main), qi = ce.qi = U.el('img', '', qr);
      qi.src = N.assetBase + 'qr.png';
      ce.qc = U.txt('div', 'a t-small c2', main, N.t('login.qrCaption'), 'left:808px;top:500px;width:376px;text-align:center').parentNode;
      if (NAR) lay(true);
    }
    /* Anmeldung direkt am Geraet: Titel, Erklaerung, grosser Knopf, Status, darunter klein der Code-Weg */
    function buildWeb(root) {
      var w = web.el = U.el('div', 'layer', root);
      var wm = U.el('div', 'wordmark', w);
      wm.appendChild(document.createTextNode(N.brand.wordmark[0]));
      U.txt('span', 'cacc', wm, N.brand.wordmark[1]);
      var ls = web.ls = [wm];
      ls.push(U.txt('div', 'a t-h1', w, N.t('login.title'), 'left:144px;top:120px;width:680px').parentNode);
      ls.push(U.txt('div', 'a t-body c2', w, N.t('login.web.text'), 'left:144px;top:192px;width:760px').parentNode);
      ls.push(U.txt('div', 'a t-body c2', w, N.t('login.web.private'), 'left:144px;top:264px;width:760px').parentNode);
      // U.txt liefert den Textknoten: Knoepfe und Statuszeile brauchen das Element (Klasse, style, offsetWidth). Frueher stand
      // hier der Textknoten -> webRender warf bei "style.left" (undefined), bevor die PIN angelegt war: ewiger Ladekreis (Nr. 15)
      web.btn = U.txt('div', 'btn is-focus', w, N.t('login.btnWeb'), 'left:144px;top:352px;width:320px;padding:0;text-align:center').parentNode;
      web.spin = U.el('div', 'spinner sm', w, 'left:144px;top:432px');
      web.statT = U.txt('div', 'a t-small c2', w, '', 'left:144px;top:432px;width:760px');
      web.statEl = web.statT.parentNode;
      web.hint = U.txt('div', 'a t-small c2', w, N.t('login.web.codeHint'), 'left:144px;top:520px;width:760px').parentNode;
      web.codeBtn = U.txt('div', 'btn', w, N.t('login.btnCode'), 'left:144px;top:568px').parentNode;
      U.show(web.spin, false);
      if (NAR) lay(true);
    }
    /* ---- Anordnung auf der flexiblen Flaeche (nur Apple; am TV nie aufgerufen) ---- */
    function at(e, x, y, w) { var st = e.style; st.left = x + 'px'; st.top = y + 'px'; if (w !== undefined) st.width = w + 'px'; }
    function hOf(e, d) { return e.offsetHeight || d; }
    /* Hoehen messen geht nur sichtbar: Ebene kurz einblenden (im selben Takt, nichts wird dazwischen gemalt) */
    function measured(layer, fn) { if (!layer) return; var d = layer.style.display; layer.style.display = ''; fn(); layer.style.display = d; }
    /* again: nur neu anordnen (gerade angelegte Ebene), ohne Klassenwechsel */
    function lay(again) {
      var S = N.screen, c = S.cls, nar = !(c.w === 'R' && c.h === 'N');
      if (!rootEl || !FXS) return;
      if (!again && nar !== NAR) {
        NAR = nar; U.cls(rootEl, 'lg-fx', nar);
        if (!nar) {                                       // zurueck zur TV-Anordnung: Ebenen mit TV-Lagen neu anlegen
          var hm = !!main, hw = !!web.el;
          if (main) { rootEl.removeChild(main); main = null; boxes = []; }
          if (web.el) { rootEl.removeChild(web.el); web.el = null; }
          HIT = tvHit(); web.sx = 144;
          if (hw) buildWeb(rootEl);
          if (hm) buildCode(rootEl);
          sb.fit(null);
          shown();
          return;
        }
      }
      if (!NAR) return;
      // sichere Raender (N.screen.safe): Anordnung in der sicheren Flaeche, flex.css (sa-side) verschiebt die Ebene um --sl/--st
      var W = S.w - S.safe.l - S.safe.r, H = S.h - S.safe.t - S.safe.b, m = W < 800 ? 24 : 48, cw = Math.min(W - 2 * m, 720), x = Math.round((W - cw) / 2);
      sb.fit({ x: x, w: cw, H: H });
      if (web.el) measured(web.el, function () { layWeb(H, x, cw); });
      if (main) measured(main, function () { layCode(W, H, m); });
    }
    /* Web-Weg: eine Spalte (Marke, Titel, zwei Absaetze, Knopf, Status, Hinweis, Code-Knopf), senkrecht mittig */
    function layWeb(H, x, cw) {
      var ls = web.ls, y = 0, i, ys = [], gap = [24, 16, 16, 32];
      for (i = 0; i < ls.length; i++) { if (i) ls[i].style.width = cw + 'px'; ys.push(y); y += hOf(ls[i], 40) + gap[i]; }
      var yb = y, ys2 = yb + 48 + 24, yh = ys2 + 32 + 32;
      web.hint.style.width = cw + 'px';
      var yc = yh + hOf(web.hint, 28) + 16, total = yc + 48, y0 = Math.max(24, Math.round((H - total) / 2));
      for (i = 0; i < ls.length; i++) at(ls[i], x, y0 + ys[i]);
      var bw = Math.min(cw, 400);
      at(web.btn, x, y0 + yb, bw);
      at(web.spin, x, y0 + ys2);
      web.sx = x;
      web.statEl.style.top = (y0 + ys2) + 'px'; web.statEl.style.width = (cw - 36) + 'px';
      web.statEl.style.left = (x + (web.spin.style.display === 'none' ? 0 : 36)) + 'px';
      at(web.hint, x, y0 + yh, cw);
      at(web.codeBtn, x, y0 + yc);
      HIT.web = { x: x, y: y0 + yb, w: bw }; HIT.code = { x: x, y: y0 + yc };
    }
    /* Code-Weg: hoch eine Spalte (Marke, Titel, Schritte, Code, Gueltigkeit, Status, Knoepfe, darunter der QR-Code so gross, wie Platz
     * bleibt); flach (H < 720) zwei Spalten, sobald links mindestens 400 breit bleiben (QR mindestens 200): links Titel bis Knoepfe,
     * rechts Marke, QR-Code und Unterschrift. Befund 03.11. (Strang G): Mac-Fenster 1024 x 600 = Flaeche ~892 x 523 – eine Spalte
     * war dort zu hoch, "Neuer Code" lag unter der Fensterkante (vorher erst ab 900 breit zweispaltig) */
    function layCode(W, H, m, cmp) {
      /* cmp (kompakt, nur zweispaltig): passt die linke Spalte nicht in die Hoehe (Mac-Fenster 960 x 540 / 1024 x 600), zweiter Lauf
       * mit 24 Rand, kleinerem Titel, QR 200 und der Statuszeile rechts unter dem QR-Code */
      if (!cmp) ce.ti.className = 'a t-h1';
      var two = H < 720 && W - 2 * m - 200 - 64 >= 400, qs = 312, cw, x, y = 0, i, P = {};
      if (two) { qs = cmp ? 200 : Math.max(200, Math.min(312, H - 2 * m - 56 - 12 - 52)); cw = Math.min(620, W - 2 * m - qs - 64); x = m + Math.max(0, Math.round((W - 2 * m - qs - 64 - cw) / 2)); }
      else { cw = Math.min(W - 2 * m, 620); x = Math.round((W - cw) / 2); }
      ce.ti.style.width = cw + 'px';
      if (!two) { P.wm = y; y += 56; }
      P.ti = y; y += hOf(ce.ti, 56) + 16;
      P.st = [];
      for (i = 0; i < 3; i++) { ce.st[i].style.width = (cw - 48) + 'px'; P.st.push(y); y += Math.max(32, hOf(ce.st[i], 32)) + (two ? 12 : 16); }
      P.cb = y + 8; y = P.cb + 112 + 16;
      var vt = validT.parentNode, vv = validT.nodeValue; vt.style.width = cw + 'px';
      U.setText(validT, N.t('login.validity', { mmss: '15:00' }));   // Hoehe mit dem echten Text messen (kommt erst mit dem Code)
      P.vt = y; y += Math.max(28, hOf(vt, 28)) + 12;
      U.setText(validT, vv);
      if (!cmp) { P.ss = y; y += 32 + 16; }
      P.bt = y; y += 48;
      var colH = y, qy = 0;
      if (two && !cmp && colH > H - 2 * m) { ce.ti.className = 'a t-h2'; layCode(W, H, 24, true); return; }
      if (!two) { y += 32; qs = Math.max(160, Math.min(312, H - 2 * m - y - 52)); qy = y; y += qs + 12 + 40; }
      var total = two ? colH : y, y0 = Math.max(m, Math.round((H - total) / 2));
      if (!two) at(ce.wm, x, y0 + P.wm);
      at(ce.ti, x, y0 + P.ti, cw);
      for (i = 0; i < 3; i++) { at(ce.sn[i], x, y0 + P.st[i]); at(ce.st[i], x + 48, y0 + P.st[i], cw - 48); }
      var bw = Math.min(104, Math.floor((cw + 16) / 4));
      for (i = 0; i < 4; i++) at(boxes[i].parentNode, x + i * bw, y0 + P.cb, bw - 16);
      at(vt, x, y0 + P.vt, cw);
      if (!cmp) { at(spin, x, y0 + P.ss); at(statT.parentNode, x + 36, y0 + P.ss, cw - 36); }
      at(btn, x, y0 + P.bt);
      HIT.nc = { x: x, y: y0 + P.bt, w: btn.offsetWidth || 240 };
      if (ce.bk) { var bx = x + (btn.offsetWidth || 240) + 16; at(ce.bk, bx, y0 + P.bt); HIT.bk = { x: bx, y: y0 + P.bt, w: BACK.w, h: BACK.h }; }
      var qx, qyy;
      if (two) { qx = W - m - qs; qyy = Math.max(m, Math.round((H - (56 + qs + 12 + 52)) / 2)); at(ce.wm, qx, qyy); qyy += 56; }
      else { qx = Math.round((W - qs) / 2); qyy = y0 + qy; }
      var qst = ce.qr.style; qst.left = qx + 'px'; qst.top = qyy + 'px'; qst.width = qst.height = qs + 'px';
      var ist = ce.qi.style, pad = Math.round(qs * 24 / 312); ist.left = ist.top = pad + 'px'; ist.width = ist.height = (qs - 2 * pad) + 'px';
      at(ce.qc, two ? qx - 32 : x, qyy + qs + 12, two ? qs + 64 : cw);
      if (cmp) { var sy = qyy + qs + 12 + 52; at(spin, qx - 32, sy); at(statT.parentNode, qx + 4, sy, qs + 28); }   // kompakt: Status rechts
    }
    function shown() {                                   // nach Neuaufbau: sichtbare Ebene und Zustand wie vorher
      if (web.el) U.show(web.el, mode === 'web' && !sb.on);
      if (main) U.show(main, mode === 'code' && !sb.on);
      if (sb.on) return;
      if (mode === 'web' && web.el) { webRender(web.flow ? web.flow.state : { name: 'idle', notice: '' }); webFocus(web.f); }
      else if (main && flow) { render(flow.state); updateValidity(); }
    }
    s.create = function (root) {
      rootEl = root;
      if (WEB) buildWeb(root); else buildCode(root);
      sb = new N.ui.StateBlock(root);
      if (FXS) { lay(); onRsz = function () { lay(); }; N.evt.on('screen:resized', onRsz); }
    };
    function webFocus(f) { web.f = f; U.cls(web.btn, 'is-focus', f === 0); U.cls(web.codeBtn, 'is-focus', f === 1); }
    function webRender(stt) {
      if (stt.name === 'error') { showError(stt.err || { type: 'network' }, 'retryWeb'); return; }
      U.show(web.el, true); sb.hide();
      var busy = stt.name === 'requesting' || stt.name === 'open' || stt.name === 'authorized';
      U.show(web.spin, busy);
      web.statEl.style.left = (web.sx + (busy ? 36 : 0)) + 'px';
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
    s.destroy = function () { s.leave(); if (onRsz) N.evt.off('screen:resized', onRsz); onRsz = null; };
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
      if (NAR) { var fp = N.screen.fromStage(x, y); x = fp.x - N.screen.safe.l; y = fp.y - N.screen.safe.t; }   // schmal: 1:1 in der Flaeche (nicht im Kasten), um die Raender versetzt
      if (sb.on) return sb.pointer(x, y, kind);
      if (mode === 'web') {
        var onWeb = N.hit.rect(HIT.web.x, HIT.web.y, HIT.web.w, 48, x, y), onCode = N.hit.rect(HIT.code.x, HIT.code.y, web.codeBtn.offsetWidth || 240, 48, x, y);
        if (kind === 'click' && onWeb) { webFocus(0); webStart(); return true; }
        if (kind === 'click' && onCode) { webFocus(1); toCode(); return true; }
        if (kind === 'move' && (onWeb || onCode)) { webFocus(onWeb ? 0 : 1); return true; }
        return false;
      }
      if (kind === 'click' && N.hit.rect(HIT.nc.x, HIT.nc.y, HIT.nc.w, 48, x, y)) { flow.newCode(); return true; }
      if (WEB && N.input.direct() && N.hit.rect(HIT.bk.x, HIT.bk.y, HIT.bk.w, HIT.bk.h, x, y)) { if (kind === 'click') toWeb(); return true; }
      return false;
    };
    return s;
  });
})(N);
