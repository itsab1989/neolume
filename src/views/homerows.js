/* Ansicht 'homerows' – "Startseite anpassen" (SPEC 7.3.1, 7.13): Liste aller Reihen der Startseite, je Profil gespeichert.
 * ▲▼ waehlen · OK = Reihe ein/aus · Gelb = Verschieben (dann ▲▼, OK/Gelb/RETURN = ablegen) · letzte Zeile "Standard
 * wiederherstellen". Zeilen wie 5.18 (64 hoch, Fokus = Amber-Rahmen), feste Beschreibungsflaeche, ein Listen-Container per
 * translate3d (Fokus-Anker = 3. Zeile). Weitere Reihen (Server-Hubs, Playlists) kommen aus dem Hub-Katalog: sofort aus dem
 * Speicher, im Hintergrund frisch vom Server (Titel in der App-Sprache). Speichern sofort im Speicher, Datei entprellt.
 * N.rowsEditor(C) ist die gemeinsame Fabrik: "Inspiration anpassen" (views/insprows.js) nutzt dieselbe Liste mit eigener
 * Einstellung (C.setting), eigenen Reihen (C.avail) und Texten (C.label/val/desc, C.keys). */
(function (N) {
  var U = N.util, HR = N.homeRows, X = 144, W = 736, TOP = 112, STEP = 64, VIS = 6, ANCHOR = 2, STALE = 600000;
  function editor(C) { return function () {
    var s = { rail: null, wheelKeys: ['UP', 'DOWN'] }, K = C.keys;
    var S = N.session, root, clip, list, desc, stat, els = [], items = [], f = 0, sc = 0, moving = false, cat = null, busy = null, dead = false;
    var MOD = C.model || HR;                            // Listen-Logik (view/store/move): Startseite/Inspiration N.homeRows, Seitenleiste N.railRows
    function locked(it) { return !it.reset && !!(C.locked && C.locked(it)); }   // immer an (z. B. Start in der Seitenleiste)

    function saved() { return S.settings && S.settings[C.setting] || null; }
    function vlibs() {
      var a = cat && cat.alibs, out = [], i;
      if (!a) { var hc = S.homeCache(); return hc && hc.libs || []; }
      for (i = 0; i < a.length; i++) if (a[i].type === 'movie' || a[i].type === 'show') out.push(a[i]);
      return out;
    }
    function allLibs() { return cat && cat.alibs || vlibs(); }
    function ctx() { return { cat: cat, libs: vlibs(), alibs: allLibs(), libOf: libOf, hubOf: hubOf }; }
    function avail() { return C.avail(ctx()); }
    function libOf(id) { var a = allLibs(); for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i]; return null; }
    function hubOf(id) { var h = cat && cat.hubs || []; for (var i = 0; i < h.length; i++) if (h[i].id === id) return h[i]; return null; }

    /* ---------- Texte je Reihe ---------- */
    function label(it) { return it.reset ? N.t('set.hr.reset') : C.label(it, ctx()); }
    function libName(it) { return it.reset ? '' : C.val(it, ctx()); }
    function descText(it) {
      if (moving) return N.t('set.hr.moving');
      if (it.reset) return N.t(K.resetDesc);
      return C.desc(it, ctx());
    }

    /* ---------- Aufbau ---------- */
    s.create = function (el) {
      root = el;
      U.txt('div', 'a t-h1', root, N.t(K.title), 'left:144px;top:40px;width:720px');
      clip = U.el('div', 'hr-clip', root);
      list = U.el('div', 'hr-list', clip);
      var how = U.el('div', 'hr-how', root);
      U.txt('div', 'hr-how-t', how, N.t('set.hr.how.title'));
      U.txt('div', 'hr-how-x', how, N.t(K.how));
      stat = U.txt('div', 'hr-stat', how, '');
      desc = U.txt('div', 'set-desc hr-desc', root, '');
      cat = S.hubCatalog();
      rebuild(null);
      if (!C.noCatalog) discover();                   // Seitenleiste: keine Server-Hubs noetig
    };
    /* Liste (neu) aufbauen; keepId: Fokus auf diese Reihe legen */
    function rebuild(keepId) {
      var v = MOD.view(saved(), avail()), i;
      items = [];
      for (i = 0; i < v.length; i++) items.push({ id: v[i].id, on: v[i].on });
      items.push({ id: '#reset', reset: true });
      while (els.length < items.length) els.push(mkRow(els.length));
      for (i = 0; i < els.length; i++) U.show(els[i].el, i < items.length);
      for (i = 0; i < items.length; i++) paint(i);
      var nf = 0;
      if (keepId) for (i = 0; i < items.length; i++) if (items[i].id === keepId) nf = i;
      U.cls(els[f] ? els[f].el : list, 'is-focus', false);
      setFocus(nf, true);
    }
    function mkRow(i) {
      var e = { el: U.el('div', 'set-row hr-row', list, 'top:' + (i * STEP) + 'px') };
      e.lb = U.txt('div', 'lb', e.el, '');
      e.val = U.txt('div', 'val', e.el, '');
      e.tg = U.el('div', 'toggle', e.el); U.el('i', '', e.tg);
      e.mv = U.el('div', 'mv', e.el); U.el('i', 'up', e.mv); U.el('i', 'dn', e.mv);   // CSS-Dreiecke statt ▲ ▼ (TV-Schrift, Regel 10)
      U.el('div', 'sep', e.el);
      return e;
    }
    function paint(i) {
      var it = items[i], e = els[i];
      U.setText(e.lb, label(it));
      U.setText(e.val, it.reset ? '' : locked(it) ? N.t(C.keys.always) : libName(it));
      U.show(e.tg, !it.reset && !locked(it));
      if (!it.reset) U.cls(e.tg, 'on', it.on);
      U.cls(e.el, 'off', !it.reset && !it.on);
    }
    function scrollFor(i) { return U.clamp(i - ANCHOR, 0, Math.max(0, items.length - VIS)); }
    function setFocus(i, jump) {
      if (els[f]) U.cls(els[f].el, 'is-focus', false);
      f = i;
      U.cls(els[f].el, 'is-focus', true);
      var nsc = scrollFor(f);
      if (nsc !== sc || jump) {
        sc = nsc;
        if (jump) { list.style.webkitTransition = 'none'; U.tf(list, 0, -sc * STEP); setTimeout(function () { list.style.webkitTransition = ''; }, 60); }
        else { N.fx.move(list); U.tf(list, 0, -sc * STEP); }
      }
      U.setText(desc, descText(items[f]));
    }

    /* ---------- Aenderungen ---------- */
    function save() {
      var vis = [];
      for (var i = 0; i < items.length; i++) if (!items[i].reset) vis.push({ id: items[i].id, on: items[i].on });
      S.setSetting(C.setting, MOD.store(saved(), avail(), vis));
    }
    function toggle() {
      var it = items[f];
      if (locked(it)) { N.ui.toast.show(N.t(C.keys.lockedToast), { icon: 'info' }); return; }
      it.on = !it.on; paint(f); save();
    }
    function startMove() {
      if (items[f].reset) return;
      moving = true; U.cls(els[f].el, 'is-move', true);
      U.setText(desc, descText(items[f]));
      N.router.refreshHints();
    }
    function drop() {
      moving = false; U.cls(els[f].el, 'is-move', false);
      save();
      U.setText(desc, descText(items[f]));
      N.router.refreshHints();
    }
    function step(dir) {
      var j = f + dir;
      if (j < 0 || j >= items.length - 1) return;      // "Standard wiederherstellen" bleibt unten
      MOD.move(items, f, dir);
      U.cls(els[f].el, 'is-move', false);
      paint(f); paint(j);
      setFocus(j);
      U.cls(els[f].el, 'is-move', true);
    }
    function reset() {
      N.ui.dialog.open({ title: N.t('dlg.hrReset.title'), text: N.t(K.resetText),
        buttons: [{ id: 'cancel', t: N.t('dlg.hrReset.cancel') }, { id: 'ok', t: N.t('dlg.hrReset.confirm') }], focus: 0,
        onSelect: function (id) {
          if (id !== 'ok') return;
          S.setSetting(C.setting, null);
          rebuild(null);
          N.ui.toast.show(N.t('toast.hrReset'), { icon: 'confirm' });
        } });
    }
    function activate() { if (items[f].reset) reset(); else toggle(); }

    /* ---------- Hub-Katalog vom Server (Hintergrund) ---------- */
    function setStat(key) { U.setText(stat, key ? N.t(key) : ''); }
    function discover() {
      if (cat && cat.lang === N.i18n.lang() && U.now() - (cat.ts || 0) < STALE) return;
      setStat('set.hr.loading');
      busy = N.hubs.discover(cat, function (err, c) {
        busy = null;
        if (dead) return;
        if (err) { setStat('set.hr.failed'); return; }
        setStat('');
        cat = c; S.setHubCatalog(c);
        if (moving) return;                           // nie unter dem Verschieben umbauen
        var keep = items[f] ? items[f].id : null;
        rebuild(keep);
        N.router.refreshHints();
      });
    }

    /* ---------- Lebenszyklus, Tasten, Zeiger ---------- */
    s.enter = function () { if (els[f]) U.cls(els[f].el, 'is-focus', true); };
    s.leave = function () { if (moving) drop(); return null; };
    s.destroy = function () { dead = true; if (busy) busy.abort(); };
    s.hints = function () {
      if (moving) return [{ k: 'yellow', t: 'hint.drop' }];
      var list = [];
      if (items[f] && !items[f].reset) list.push({ k: 'yellow', t: 'hint.move' });
      list.push({ k: 'ret', t: 'hint.back' }, { k: 'INFO', t: 'hint.learnMore' });
      return list;
    };
    s.onKey = function (k) {
      if (moving) {
        if (k === 'UP') step(-1);
        else if (k === 'DOWN') step(1);
        else if (k === 'ENTER' || k === 'YELLOW' || k === 'RETURN') drop();
        return true;
      }
      var n;
      if (k === 'UP' || k === 'DOWN') { n = N.nav.list(f, items.length, k, true); if (n >= 0) { setFocus(n); N.router.refreshHints(); } }
      else if (k === 'ENTER') activate();
      else if (k === 'YELLOW') startMove();
      else if (k === 'INFO') N.ui.panel.help(N.t(K.title), N.t(K.help));
      else if (k === 'RETURN') N.router.back();
      return true;
    };
    s.pointer = function (x, y, kind) {
      if (x < X || x >= X + W) return false;
      var i = N.hit.list(TOP, STEP, STEP, Math.min(VIS, items.length - sc), y);
      if (i < 0) return false;
      i += sc;
      if (moving) { if (kind === 'click') drop(); return true; }
      if (i !== f) { U.cls(els[f].el, 'is-focus', false); f = i; U.cls(els[f].el, 'is-focus', true); U.setText(desc, descText(items[f])); N.router.refreshHints(); }
      if (kind === 'click') activate();
      return true;
    };
    s.relabel = function () { for (var i = 0; i < items.length; i++) paint(i); U.setText(desc, descText(items[f])); };
    return s;
  }; }

  /* ---------- "Startseite anpassen" ---------- */
  function hubLabel(id, c) {                       // wechselnde Hubs (Genre/Person): neutraler Name statt "Top-Filme in Action" (TV-Befund P5)
    var p = HR.parse(id), h = c.hubOf(id), nk = 'set.hr.name.' + (h ? h.fam : p.type);
    if (N.i18n.has(nk)) return N.t(nk);
    return h ? h.title : id;
  }
  N.rowsEditor = editor;
  N.router.define('homerows', editor({
    setting: 'homeRows',
    keys: { title: 'set.homeRows', how: 'set.hr.how', help: 'set.hr.help', resetDesc: 'set.hr.reset.desc', resetText: 'dlg.hrReset.text' },
    avail: function (c) { return HR.avail(c.libs, c.cat); },
    label: function (it, c) {
      var p = HR.parse(it.id), lib;
      if (it.id === 'cw') return N.t('home.row.continue');
      if (it.id === 'deck') return N.t('home.row.upNext');
      if (it.id === 'ab') return N.t('mu.row.continue');   // M4
      if (p.group === 'new') { lib = c.libOf(p.lib); return N.t('home.row.newIn', { library: lib ? lib.title : '' }); }
      if (p.group === 'hub') return hubLabel(it.id, c);
      return c.cat && c.cat.pl && c.cat.pl.title && c.cat.lang === N.i18n.lang() ? c.cat.pl.title : N.t('home.row.playlists');
    },
    val: function (it, c) { var p = HR.parse(it.id), lib = p.group === 'hub' ? c.libOf(p.lib) : null; return lib ? lib.title : ''; },
    desc: function (it, c) {
      var p = HR.parse(it.id);
      if (it.id === 'ab') return N.t('mu.hr.ab.desc');   // M4
      if (it.id === 'cw' || it.id === 'deck' || it.id === 'pl') return N.t('set.hr.' + it.id + '.desc');
      var lib = c.libOf(p.lib), name = lib ? lib.title : '';
      if (p.group === 'new') return N.t('set.hr.new.desc', { library: name });
      var h = c.hubOf(it.id), key = 'set.hr.' + (h ? h.fam : '') + '.desc';
      if (!h || !N.i18n.has(key)) key = lib && (lib.kind === 'music' || lib.kind === 'audio') ? 'set.hr.music.desc' : 'set.hr.hub.desc';
      return N.t(key, { library: name });
    }
  }));

  /* ---------- "Seitenleiste anpassen" (W1): Suche, Entdecken, Start, Bibliotheken – Start immer sichtbar ---------- */
  function railLib(id) { var l = N.ui.rail.allLibs(); for (var i = 0; i < l.length; i++) if (N.railRows.libId(l[i]) === id) return l[i]; return null; }
  N.router.define('railitems', editor({
    setting: 'railItems', model: N.railRows, noCatalog: true,
    keys: { title: 'set.railItems', how: 'set.ri.how', help: 'set.ri.help', resetDesc: 'set.ri.reset.desc', resetText: 'dlg.riReset.text',
      always: 'set.ri.always', lockedToast: 'toast.riLocked' },
    avail: function () { return N.railRows.avail(N.ui.rail.allLibs(), !!(N.disc && N.disc.enabled())); },
    locked: function (it) { return !!N.railRows.LOCKED[it.id]; },
    label: function (it) {
      if (it.id === 'search' || it.id === 'discover' || it.id === 'home') return N.t('nav.' + it.id);
      var lib = railLib(it.id);
      return lib ? lib.title : it.id;
    },
    val: function (it) { var lib = railLib(it.id); return lib && lib.srv ? lib.srvName : ''; },   // Weitere Server: Herkunft rechts
    desc: function (it) {
      if (it.id === 'search' || it.id === 'discover' || it.id === 'home') return N.t('set.ri.' + it.id + '.desc');
      var lib = railLib(it.id);
      if (lib && lib.srv) return N.t('set.ri.xlib.desc', { library: lib.title, server: lib.srvName, n: N.ui.rail.MAX });
      return N.t('set.ri.lib.desc', { library: lib ? lib.title : '' });
    }
  }));
})(N);
