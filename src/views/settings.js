/* Ansicht 'settings' – Einstellungen (SPEC 5.18, 7.13, 10.4; Mockup settings.html):
 * Zeilen immer 64 hoch, Fokus = surface-3 + 3-px-Amber-Rahmen, feste Beschreibungsflaeche (nodeValue, ohne Animation).
 * Kategorien: Wiedergabe (M3, alle Player-Optionen, auch fuer Kinderprofile), Oberflaeche, Profil & Konto (Konto-Aktionen nur
 * Hauptkonto, SPEC 7.15.1), Diagnose, Hilfe & Info. Mehr als 6 Zeilen: EIN Listen-Container scrollt per translate3d (Anker 3. Zeile). ◀ von jeder Zeile -> Kategorie; RETURN: Zeile -> Kategorie -> Seitenleiste.
 * Listen oeffnen das Auswahl-Panel (keine Wertaenderung per ◀▶). Speichern entprellt ueber N.store. */
(function (N) {
  var U = N.util, CAT_Y = 112, CAT_STEP = 56, ROW_Y = 112, ROW_STEP = 64, MAXROWS = 6;
  N.router.define('settings', function () {
    var s = { rail: 'settings', wheelKeys: ['UP', 'DOWN'] };
    var cats = [], catEls = [], rowEls = [], desc, zone = 'cat', c = 0, r = 0, list = null, off = 0;
    function st() { return N.session; }
    /* Zahl der eingeschalteten Reihen (aus Einstellung + bekannten Bibliotheken/Katalog) */
    function homeCount() {
      var S = st(), c = S.hubCatalog(), hc = S.homeCache(), libs = hc && hc.libs || [];
      return N.homeRows.enabled(S.settings && S.settings.homeRows || null, N.homeRows.avail(libs, c)).length;
    }
    /* Auswahlzeile: Wert aus den Einstellungen, OK oeffnet das Auswahl-Panel. opts: [wert, text, farbfeld (optional, .sw-<id>)] */
    function choice(id, opts, label) {
      var S = st();
      function cur() { var v = S.settings ? S.settings[id] : null; for (var i = 0; i < opts.length; i++) if (String(opts[i][0]) === String(v)) return opts[i]; return opts[0]; }
      return { id: id, type: 'list', label: 'set.' + id, desc: 'set.' + id + '.desc', val: function () { return cur()[1]; },
        sw: opts[0][2] ? function () { return cur()[2]; } : null,
        open: function () {
          var e = []; for (var i = 0; i < opts.length; i++) e.push({ id: String(opts[i][0]), t: opts[i][1], sw: opts[i][2] });
          N.ui.panel.select({ title: N.t('set.' + id), selected: String(cur()[0]), entries: e, onSelect: function (v) {
            for (var j = 0; j < opts.length; j++) if (String(opts[j][0]) === v) S.setSetting(id, opts[j][0]);
            paintAll();
          } });
        } };
    }
    function toggle(id) {
      var S = st();
      return { id: id, type: 'toggle', label: 'set.' + id, desc: 'set.' + id + '.desc',
        get: function () { return !!(S.settings && S.settings[id]); }, set: function (v) { S.setSetting(id, v); } };
    }
    function v(key) { return N.t('set.v.' + key); }
    function vals(keys) { var o = []; for (var i = 0; i < keys.length; i++) o.push([keys[i], v(keys[i])]); return o; }
    function secs(list) { var o = []; for (var i = 0; i < list.length; i++) o.push([list[i], N.t('set.v.sec', { n: list[i] })]); return o; }
    function stills() { var o = []; N.osd.STILL.forEach(function (n) { o.push([n, n ? N.tn('set.v.afterEp', n) : v('off')]); }); return o; }
    function quals() { var o = [], q = N.decision.QUAL; ['20', '12', '8', '4'].forEach(function (k) { o.push([k, N.t('set.v.q', { n: k, r: q[k][1] === '1920x1080' ? '1080p' : '720p' })]); }); return o; }
    function playRows() {
      return [choice('resume', vals(['ask', 'resume', 'start'])), choice('resumeRewind', rewinds()), choice('quality', quals()), toggle('directPlay'),
        toggle('passthrough'), boostRow(), toggle('thumbs'),
        choice('skipIntro', vals(['off', 'button', 'auto'])), choice('skipCredits', vals(['off', 'button', 'auto'])), toggle('autoNext'),
        choice('countdown', secs([5, 8, 10, 15, 20, 30])), choice('stillWatching', stills()), choice('stillTime', hours()), choice('sleepDefault', sleeps()),
        toggle('lowerOffer'), choice('seekArrows', secs([5, 10, 15, 30])), choice('seekFf', secs([10, 30, 60])),
        choice('aspect', [['auto', v('auto')], ['orig', v('orig')], ['fill', v('fill')], ['43', v('a43')], ['zoom', v('zoom')]])];
    }
    /* ===== P5 Einstellungen & Komfort (SPEC 10.4): Ton & Untertitel, Anime, Oberflaeche, Hilfe & Info ===== */
    function rewinds() { var o = []; N.comfort.REWIND.forEach(function (n) { o.push([n, n ? N.t('set.v.sec', { n: n }) : v('off')]); }); return o; }
    function hours() { var o = []; N.comfort.STILL_H.forEach(function (n) { o.push([n, n ? N.tn('set.v.afterH', n) : v('off')]); }); return o; }
    function sleeps() { return [['off', v('off')], ['end', v('sleepEnd')], [30, N.t('set.v.min', { n: 30 })], [60, N.t('set.v.min', { n: 60 })]]; }
    function boostRow() {
      var r = choice('audioBoost', [[100, v('off')], [150, v('boostS')], [200, v('boostM')], [300, v('boostL')]]);
      r.disabled = function () { var S = st(); return !(S.settings && S.settings.passthrough === false); };
      r.ddesc = 'set.audioBoost.disabled';
      return r;
    }
    function delays() { var o = []; N.osd.DELAYS.forEach(function (ms) { o.push([ms, N.osd.delayText(ms)]); }); return o; }
    function subsRows() {
      return [toggle('rememberTracks'), choice('audioLang', vals(['de', 'en', 'ja', 'server'])), choice('subs', vals(['off', 'forced', 'foreign', 'always', 'server'])),
        choice('subLang', vals(['de', 'en'])), choice('ass', vals(['burn', 'text'])), choice('subSize', vals(['small', 'medium', 'large', 'xl'])),
        choice('subColor', vals(['white', 'yellow'])), choice('subBg', vals(['dim', 'solid', 'none'])), choice('subPos', vals(['low', 'high'])), choice('subDelay', delays())];
    }
    /* Anime (docs/TODO.md "Anime-Erkennung"): Erkennung je Titel (normal/streng/aus) -> "als eigene Kategorie zeigen" (Ueberzeile, INFO)
     * und "Anime-Wiedergaberegeln" (Ton/UT) unabhaengig voneinander; Erkennung "aus" dimmt beide. Feinere Regeln gedimmt, solange die
     * Wiedergaberegeln aus sind. */
    function animeRows() {
      var S = st();
      function off() { return !!(S.settings && S.settings.animeDetect === 'off'); }
      function dimOff(r) { r.disabled = off; r.ddesc = 'set.animeDetect.off.desc'; return r; }
      function dim(r) {
        r.disabled = function () { return off() || !(S.settings && S.settings.anime); };
        r.ddesc = function () { return off() ? 'set.animeDetect.off.desc' : 'set.anime.off.desc'; };
        return r;
      }
      var det = choice('animeDetect', vals(['normal', 'strict', 'off'])), show = dimOff(toggle('animeShow')), rules = dimOff(toggle('anime'));
      return [det, show, rules, dim(choice('animeAudio', vals(['ja', 'de', 'same']))), dim(choice('animeSubs', vals(['deen', 'de', 'off']))),
        dim(toggle('animeSigns'))];
    }
    /* Akzentfarbe (N.accent): Palette mit Farbfeld, Standardfarbe der Marke zuerst; wirkt sofort (settings:changed) */
    function accentRow() {
      var o = [], ids = N.accent.ids(), b = N.accent.base();
      for (var i = 0; i < ids.length; i++) o.push([ids[i], v('ac_' + ids[i]), ids[i]]);
      for (i = 0; i < o.length; i++) if (o[i][0] === b) o.unshift(o.splice(i, 1)[0]);   // Standard zuerst
      return choice('accent', o);
    }
    function displayRows(S) {
      var out = [toggle('backgrounds'), toggle('spoiler'), toggle('clock')];
      if (!S.isKid()) out = out.concat(discRows());   // P4 Entdecken + Merkliste (Kinderprofile: nicht vorhanden)
      if (!S.isKid()) out.push(choice('screensaver', [[0, v('off')]].concat(N.comfort.SAVER_MIN.slice(1).map(function (n) { return [n, N.t('set.v.min', { n: n })]; }))));
      if (!S.isKid()) out.push(toggle('saverBlur'));   // F21: Bilder des Schoners unscharf (Standard) oder scharf
      return out;
    }
    /* P4 (docs/research/discover.md): Entdecken an/aus (Standard: an im Hauptprofil). Merkliste nur mit Helfer; ohne Helfer eine
     * Wertzeile "Nicht eingerichtet", deren Satz erklaert, wie man sie einschaltet – sonst ist die Merkliste nirgends sichtbar. */
    function discRows() {
      var S = st(), D = N.disc;
      var d = { id: 'discover', type: 'toggle', label: 'set.discover', desc: 'set.discover.desc',
        get: function () { return D.enabled(); }, set: function (x) { S.setSetting('discover', x); } };
      /* Inspiration anpassen (Entdecken vor der Eingabe, N.insp): gleiche Liste wie "Startseite anpassen" */
      var ir = { id: 'insprows', type: 'action', label: 'set.inspRows', desc: 'set.inspRows.desc', disabled: function () { return !D.enabled(); }, ddesc: 'set.inspRows.off.desc',
        val: function () { return N.tn('set.inspRows.val', inspCount()); }, run: function () { N.router.push('insprows'); } };
      if (!D.helper()) return [d, { id: 'watchlist', type: 'value', label: 'set.watchlist', desc: 'set.watchlist.none.desc', val: function () { return v('notSetUp'); } }, ir];
      D.probeHelper(function () { paintAll(); });
      return [d, { id: 'watchlist', type: 'toggle', label: 'set.watchlist', desc: 'set.watchlist.desc',
        get: function () { return D.watchlistOn(); }, set: function (x) { S.setSetting('watchlist', x); },
        disabled: function () { return D.helperState() === 'down' || !D.enabled(); },
        ddesc: function () { return D.helperState() === 'down' ? 'set.watchlist.down.desc' : 'set.watchlist.off.desc'; } }, ir];
    }
    function inspCount() {
      var S = st(), hc = S.homeCache();
      return N.insp.enabled(S.settings && S.settings.inspRows || null, hc && hc.libs || [], S.hubCatalog(), N.insp.helperOn()).length;
    }
    function helpRows() {
      function act(id, run) { return { id: id, type: 'action', label: 'set.' + id, desc: 'set.' + id + '.desc', run: run }; }
      return [act('keys', function () { N.router.push('keys'); }), act('welcome', function () { N.helpUi.welcome(false); }),
        act('testConn', function () { N.helpUi.connTest(); }),
        { id: 'ver', type: 'value', label: 'set.version', desc: 'set.version.desc', val: function () { return N.config.version; } },
        act('about', function () { N.helpUi.about(); }), act('licenses', function () { N.helpUi.licenses(); })];
    }
    /* Startprofil: Einstellung des Fernsehers (state.json), nicht je Profil */
    function startRow() {
      var S = st();
      function opts() { var a = S.admin(); return [['main', N.t('set.v.startMain', { name: a ? a.name : '' })], ['last', v('startLast')], ['picker', v('startPicker')]]; }
      function cur() { var o = opts(), c = S.startProfile(); for (var i = 0; i < o.length; i++) if (o[i][0] === c) return o[i]; return o[0]; }
      return { id: 'startProfile', type: 'list', label: 'set.startProfile', desc: 'set.startProfile.desc', val: function () { return cur()[1]; },
        open: function () {
          var o = opts(), e = [];
          for (var i = 0; i < o.length; i++) e.push({ id: o[i][0], t: o[i][1] });
          N.ui.panel.select({ title: N.t('set.startProfile'), selected: cur()[0], entries: e, onSelect: function (id) { S.state.startProfile = id; S.save(); paintAll(); } });
        } };
    }
    /* ===== Ende P5 ===== */
    function scanRow() {
      return { id: 'scan', type: 'action', label: 'set.scan', desc: 'set.scan.desc', run: function () {
        var S = st(), hc = S.homeCache(), libs = hc && (hc.alibs || hc.libs) || [], e = [{ id: 'all', t: N.t('set.scan.all') }];
        for (var i = 0; i < libs.length; i++) e.push({ id: String(libs[i].id), t: libs[i].title });
        N.ui.panel.select({ title: N.t('set.scan'), selected: '', entries: e, onSelect: function (id) { N.scan.start(id === 'all' ? null : id); } });
      } };
    }
    function defs() {
      var S = st(), list = [{ id: 'play', rows: playRows() }];
      list.push({ id: 'display', rows: [
        { id: 'lang', type: 'list', label: 'set.language', desc: 'set.language.desc', val: function () { return N.t('lang.' + N.i18n.lang()); },
          open: function () {
            N.ui.panel.select({ title: N.t('set.language'), selected: N.i18n.lang(),
              entries: [{ id: 'de', t: N.t('lang.de') }, { id: 'en', t: N.t('lang.en') }],
              onSelect: function (l) { if (l !== N.i18n.lang()) N.app.setLang(l); } });
          } },
        { id: 'ep', type: 'toggle', label: 'set.episodeProgress', desc: 'set.episodeProgress.desc',
          get: function () { return !!(S.settings && S.settings.episodeProgress); }, set: function (v) { S.setSetting('episodeProgress', v); } },
        choice('libView', [['L', N.t('lib.view.L')], ['M', N.t('lib.view.M')], ['S', N.t('lib.view.S')], ['list', N.t('lib.view.list')]]),   // Bibliotheksansicht (Feedback-Regel 2)
        toggle('themeMusic'),                         // Titelmelodie (SPEC v2.2, M3b: Standard aus)
        choice('themeVol', [[25, N.t('set.v.pct', { n: 25 })], [50, N.t('set.v.pct', { n: 50 })], [75, N.t('set.v.pct', { n: 75 })], [100, N.t('set.v.pct', { n: 100 })]]),
        { id: 'rm', type: 'toggle', label: 'set.reduceMotion', desc: 'set.reduceMotion.desc',
          get: function () { return !!(S.settings && S.settings.reduceMotion); }, set: function (v) { S.setSetting('reduceMotion', v); N.fx.setReduced(v); } },
        { id: 'ptr', type: 'toggle', label: 'set.pointer', desc: 'set.pointer.desc',
          get: function () { return S.state.pointer !== false; }, set: function (v) { S.state.pointer = v; S.save(); N.pointer.setEnabled(v); } },
        // TV-Befund 27.10. nachmittags: Randzonen-Rollen erst langsam, dann schneller; nur mit Zeiger-Steuerung (sonst ausgegraut)
        { id: 'ptracc', type: 'toggle', label: 'set.ptrAccel', desc: 'set.ptrAccel.desc', ddesc: 'set.ptrAccel.off.desc',
          disabled: function () { return S.state.pointer === false; },
          get: function () { return S.state.ptrAccel !== false; }, set: function (v) { S.state.ptrAccel = v; S.save(); N.pointer.setAccel(v); } }
      ] });
      // "Startseite anpassen" (SPEC 7.3.1) – nicht in Kinderprofilen (7.13)
      if (!S.isKid()) list[1].rows.splice(1, 0, { id: 'homerows', type: 'action', label: 'set.homeRows', desc: 'set.homeRows.desc',
        val: function () { return N.tn('set.homeRows.val', homeCount()); }, run: function () { N.router.push('homerows'); } },
        // W1 "Seitenleiste anpassen": Eintraege umsortieren/ausblenden (Start + Einstellungen bleiben), gleiche Liste wie oben
        { id: 'railitems', type: 'action', label: 'set.railItems', desc: 'set.railItems.desc',
          val: function () { return N.tn('set.railItems.val', N.ui.rail.order().length); }, run: function () { N.router.push('railitems'); } });
      list[1].rows.splice(S.isKid() ? 1 : 3, 0, accentRow());   // Akzentfarbe hinter Sprache bzw. "Seitenleiste anpassen"
      // P5: Oberflaeche ergaenzen, "Ton & Untertitel" und "Anime" als eigene Kategorien hinter "Wiedergabe" (SPEC 10.4)
      list[1].rows = list[1].rows.concat(displayRows(S));
      list.splice(1, 0, { id: 'subs', rows: subsRows() }, { id: 'anime', rows: animeRows() });
      // Konto-Aktionen (PIN-Schalter, Server, Abmelden) nur im Hauptkonto-Profil; andere Erwachsene sehen nur "Profil wechseln"
      var acc = [{ id: 'switch', type: 'action', label: 'set.switchProfile', desc: 'set.switchProfile.desc', run: function () { N.app.switchProfile(); } }];
      if (S.pkg) N.pinSettings.rows(acc, paintAll);   // P2: eigene App-PIN je Profil (nur mit setup.json, views/pinsettings.js)
      if (S.isAdmin()) acc.push(
        { id: 'pinsw', type: 'toggle', label: 'set.pinSwitch', desc: S.pkg ? 'set.pinSwitch.app.desc' : 'set.pinSwitch.desc', disabled: function () { return !S.pinSwitchAvailable() || !S.hasRestricted(); },
          ddesc: function () { if (S.pkg && !S.pinSwitchAvailable()) return 'set.pinSwitch.app.disabled'; return S.pinSwitchAvailable() ? 'set.pinSwitch.noKids.disabled' : 'set.pinSwitch.disabled'; },
          get: function () { return S.pinSwitchOn(); }, set: function (v) { S.state.pinSwitch = v; S.save(); } },
        scanRow(),
        { id: 'server', type: 'value', label: 'set.server', desc: 'set.server.desc', val: function () { return S.state.server ? S.state.server.name : ''; } },
        { id: 'out', type: 'action', label: 'set.signOut', desc: 'set.signOut.desc', run: function () {
          N.ui.dialog.open({ title: N.t('dlg.account.title'), text: N.t('dlg.account.text'),
            buttons: [{ id: 'cancel', t: N.t('dlg.account.cancel') }, { id: 'out', t: N.t('dlg.account.confirm') }], focus: 0,
            onSelect: function (id) { if (id === 'out') { N.session.signOut(); N.router.reset('login'); } } });
        } });
      if (S.pkg) {                                    // P2 (setup.json): kein plex.tv-Konto zum Abmelden; statt dessen Hinweis zur Einrichtung
        for (var ai = acc.length - 1; ai >= 0; ai--) if (acc[ai].id === 'out') acc.splice(ai, 1);
        if (S.isAdmin()) acc.push(N.pinSettings.setupRow());
      }
      if (!S.isKid()) list.push({ id: 'account', rows: acc, desc: S.pkg ? 'set.cat.account.app.desc' : null });
      if (!S.isKid()) list.push({ id: 'diag', rows: [
        { id: 'logsend', type: 'action', label: 'set.diagSend', desc: 'set.diagSend.desc', run: function () {
          N.diag.send(function (ok) { N.ui.toast.show(N.t(ok ? 'toast.logSent' : 'toast.logFailed'), { icon: ok ? 'confirm' : 'info' }); });
        } },
        { id: 'logclear', type: 'action', label: 'set.diagClear', desc: 'set.diagClear.desc', run: function () {
          N.diag.clear(); N.ui.toast.show(N.t('toast.logCleared'), { icon: 'confirm' });
        } }
      ] });
      if (S.isAdmin() && !S.isKid()) acc.push(startRow());   // P5: Startprofil (Nutzer-Feedback-Regel 9), gilt fuer diesen Fernseher
      list.push({ id: 'help', rows: helpRows() });
      return list;
    }
    s.create = function (root) {
      cats = defs();
      U.txt('div', 'a t-h1', root, N.t('set.title'), 'left:144px;top:40px;width:900px');
      for (var i = 0; i < cats.length; i++) {
        var ce = U.el('div', 'set-cat', root, 'top:' + (CAT_Y + i * CAT_STEP) + 'px');
        U.el('span', 'bar', ce);
        ce.appendChild(document.createTextNode(N.t('set.cat.' + cats[i].id)));
        catEls.push(ce);
      }
      var clip = U.el('div', 'set-clip', root);
      list = U.el('div', 'set-list', clip);
      for (i = 0; i < maxRows(); i++) {
        var re = { el: U.el('div', 'set-row', list, 'display:none;top:' + (i * ROW_STEP) + 'px') };
        re.lb = U.txt('div', 'lb', re.el, '');
        re.val = U.txt('div', 'val', re.el, '');
        re.tg = U.el('div', 'toggle', re.el); U.el('i', '', re.tg);
        re.sw = U.el('span', 'sw', re.el);              // Farbfeld (nur Zeilen mit sw, z. B. Akzentfarbe)
        U.el('div', 'sep', re.el);
        rowEls.push(re);
      }
      desc = U.txt('div', 'set-desc', root, '');
    };
    function rowsOf() { return cats[c].rows; }
    function maxRows() { var n = 0; for (var i = 0; i < cats.length; i++) n = Math.max(n, cats[i].rows.length); return n; }
    function paintAll() { for (var k = 0; k < rowEls.length; k++) paintRow(k); if (zone === 'row') setDesc(); }
    /* Liste scrollen: Fokus-Anker = 3. Zeile, nie ueber das Ende hinaus */
    function scrollTo(i) {
      var o = Math.max(0, Math.min(i - 2, rowsOf().length - MAXROWS));
      if (o !== off) { off = o; N.fx.move(list); U.tf(list, 0, -off * ROW_STEP); }
    }
    function paintRow(i) {
      var d = rowsOf()[i], re = rowEls[i];
      if (!d) { U.show(re.el, false); return; }
      U.show(re.el, true);
      U.setText(re.lb, N.t(d.label));
      U.show(re.tg, d.type === 'toggle');
      if (d.type === 'toggle') U.cls(re.tg, 'on', d.get());
      U.setText(re.val, d.type === 'toggle' ? '' : (d.val ? d.val() : ''));
      var sw = d.sw ? d.sw() : '';
      if (re.swc !== sw) { re.swc = sw; re.sw.className = sw ? 'sw sw-' + sw : 'sw'; U.cls(re.el, 'has-sw', !!sw); }
      U.cls(re.el, 'dis', !!(d.disabled && d.disabled()));
    }
    function showCat(i) {
      U.cls(catEls[c], 'is-cur', false);
      c = i;
      U.cls(catEls[c], 'is-cur', true);
      for (var k = 0; k < rowEls.length; k++) paintRow(k);
      off = -1; scrollTo(0);
    }
    function setDesc() {
      if (zone === 'cat') { U.setText(desc, N.t(cats[c].desc || 'set.cat.' + cats[c].id + '.desc')); return; }
      var d = rowsOf()[r];
      U.setText(desc, N.t(descKey(d)));
    }
    function descKey(d) { return d.disabled && d.disabled() && d.ddesc ? (typeof d.ddesc === 'function' ? d.ddesc() : d.ddesc) : d.desc; }
    function focusCat(i) {
      if (zone === 'row') U.cls(rowEls[r].el, 'is-focus', false);
      U.cls(catEls[c], 'is-focus', false);
      if (i !== c) showCat(i);
      zone = 'cat';
      U.cls(catEls[c], 'is-focus', true);
      setDesc();
    }
    function focusRow(i, still) {
      if (zone === 'cat') U.cls(catEls[c], 'is-focus', false); else U.cls(rowEls[r].el, 'is-focus', false);
      zone = 'row'; r = i;
      if (!still) scrollTo(r);                        // Zeiger: Liste laeuft nicht unter dem Punkt weg
      U.cls(rowEls[r].el, 'is-focus', true);
      setDesc();
    }
    function activate() {
      var d = rowsOf()[r];
      if (d.disabled && d.disabled()) return;
      if (d.type === 'toggle') { d.set(!d.get()); paintAll(); setDesc(); }   // alle Zeilen: abhaengige (z. B. Zeiger-Scrollen) aendern ihren Zustand
      else if (d.type === 'list') d.open();
      else if (d.type === 'action') d.run();
    }
    s.enter = function (params, restore) {
      var rc = restore ? Math.min(restore.c || 0, cats.length - 1) : 0;
      c = rc; for (var i = 0; i < catEls.length; i++) U.cls(catEls[i], 'is-cur', i === c);
      for (i = 0; i < rowEls.length; i++) paintRow(i);
      off = -1; scrollTo(restore && restore.zone === 'row' ? restore.r || 0 : 0);
      if (restore && restore.zone === 'row' && rowsOf()[restore.r]) { zone = 'cat'; focusRow(restore.r); } else { zone = 'cat'; focusCat(c); }
    };
    s.leave = function () { return { c: c, zone: zone, r: r }; };
    s.railBlur = function () { if (zone === 'cat') U.cls(catEls[c], 'is-focus', false); else U.cls(rowEls[r].el, 'is-focus', false); };
    s.railFocus = function () { if (zone === 'cat') U.cls(catEls[c], 'is-focus', true); else U.cls(rowEls[r].el, 'is-focus', true); };
    s.hints = function () { return [{ k: 'ret', t: 'hint.back' }, { k: 'INFO', t: 'hint.learnMore' }]; };
    s.onKey = function (k) {
      var n;
      if (zone === 'cat') {
        if (k === 'UP' || k === 'DOWN') { n = N.nav.list(c, cats.length, k, true); if (n >= 0) focusCat(n); }
        else if (k === 'RIGHT' || k === 'ENTER') focusRow(0);
        else if (k === 'LEFT' || k === 'RETURN') N.ui.rail.open();
        else if (k === 'INFO') N.ui.panel.help(N.t('set.cat.' + cats[c].id), N.t('set.cat.' + cats[c].id + '.desc'));
        return true;
      }
      if (k === 'UP' || k === 'DOWN') { n = N.nav.list(r, rowsOf().length, k, true); if (n >= 0) focusRow(n); }
      else if (k === 'LEFT' || k === 'RETURN') focusCat(c);
      else if (k === 'ENTER') activate();
      else if (k === 'INFO') { var d = rowsOf()[r]; N.ui.panel.help(N.t(d.label), N.t(descKey(d))); }
      return true;
    };
    /* Zeiger: Kategorien und Zeilen per Index-Mathe */
    s.pointer = function (x, y, kind) {
      var i;
      if (x >= 144 && x < 424) {
        i = N.hit.list(CAT_Y, CAT_STEP, 48, cats.length, y);
        if (i < 0) return false;
        if (zone !== 'cat' || i !== c) focusCat(i);
        return true;
      }
      if (x >= 464 && x < 1200) {
        i = N.hit.list(ROW_Y, ROW_STEP, 64, Math.min(MAXROWS, rowsOf().length - off), y);
        if (i < 0) return false;
        i += off;
        if (zone !== 'row' || i !== r) focusRow(i, true);
        if (kind === 'click') activate();
        return true;
      }
      return false;
    };
    return s;
  });
})(N);
