/* N.ui.tabbar – Navigation fuer schmale Flaechen (nur flexible Plattformen, N.screen.flex; 10-screens.md 6.3, SPEC NAV-24).
 * Am Fernseher (feste 1280x720-Flaeche) entsteht kein Element und nichts hiervon wirkt.
 * - Breitenklasse K (iPhone hoch, halbe iPad-Fenster): Leiste unten (N.screen.TAB_H hoch) mit Start, Mediathek, Suche,
 *   Einstellungen statt der Seitenleiste. "Mediathek" oeffnet die Bibliothek direkt, wenn es nur eine gibt, sonst die Liste der
 *   Seitenleiste (alle Bibliotheken, Profil). Der aktuelle Bereich ist hervorgehoben.
 * - Breitenklasse M (iPad hoch, Duo innen hoch, 2/3-Fenster, iPhone quer): keine feste Spalte; Menue-Knopf oben links blendet die
 *   Seitenleiste ein (wie der Rand-Wisch).
 * - R: Seitenleiste wie am TV; beides verborgen.
 * Sichtbar nur auf Bildschirmen mit Seitenleiste (N.ui.rail.attach). Zeiger/Finger: pointer(x, y, kind) in Flaechen-Koordinaten. */
(function (N) {
  var U = N.util;
  var TABS = [{ id: 'home', icon: 'home', t: 'nav.home' }, { id: 'lib', icon: 'film', t: 'nav.library' },
    { id: 'search', icon: 'search', t: 'nav.search' }, { id: 'settings', icon: 'gear', t: 'nav.settings' }];
  var MENU = 48, MENU_X = 16, MENU_Y = 16;
  var T = { el: null, menu: null, items: [], mode: '', cur: '', TABS: TABS, MENU: MENU };

  /* rein: welcher Reiter gehoert zu einem Eintrag der Seitenleiste ('home', 'search', 'settings', Bibliotheken, 'discover', 'profile') */
  T.tabOf = function (id) {
    if (!id) return '';
    if (id === 'home' || id === 'search' || id === 'settings') return id;
    if (id === 'discover' || id === 'profile') return '';
    return 'lib';
  };
  /* rein: Reiter unter x in einer Leiste der Breite w (4 gleich breite Felder) */
  T.hitTab = function (x, w) { var i = Math.floor(x / (w / TABS.length)); return i >= 0 && i < TABS.length ? i : -1; };

  T.init = function (parent) {
    if (T.el || !N.screen || !N.screen.flex) return;
    T.el = U.el('div', '', parent, 'display:none'); T.el.id = 'pn-tabs';
    for (var i = 0; i < TABS.length; i++) {
      var b = U.el('div', 'tab-i', T.el);
      b.setAttribute('role', 'button');
      N.ui.icon(b, TABS[i].icon);
      var l = U.txt('div', 'tab-l', b, N.t(TABS[i].t));
      T.items.push({ el: b, lb: l });
    }
    T.menu = U.el('div', '', parent, 'display:none'); T.menu.id = 'pn-menu';
    T.menu.setAttribute('role', 'button'); T.menu.setAttribute('aria-label', N.t('nav.menu'));
    U.el('i', '', T.menu); U.el('b', '', T.menu); U.el('s', '', T.menu);
    T.sync();
  };
  /* Klasse, Seitenleiste oder Bereich geaendert */
  T.sync = function () {
    if (!T.el) return;
    var R = N.ui.rail, att = !!(R && R.attached()), w = N.screen.cls.w;
    T.mode = !att ? '' : w === 'K' ? 'tabs' : w === 'M' ? 'menu' : '';
    U.show(T.el, T.mode === 'tabs');
    U.show(T.menu, T.mode === 'menu');
    var cur = T.tabOf(R && R.att);
    if (cur !== T.cur) {
      T.cur = cur;
      for (var i = 0; i < TABS.length; i++) U.cls(T.items[i].el, 'is-cur', TABS[i].id === cur);
    }
  };
  T.relabel = function () {
    if (!T.el) return;
    for (var i = 0; i < TABS.length; i++) T.items[i].lb.firstChild.nodeValue = N.t(TABS[i].t);
    T.menu.setAttribute('aria-label', N.t('nav.menu'));
  };
  /* ist die Seitenleiste nur einblendbar (M/K: keine Icon-Spalte, kein Aufklappen am Rand per Zeiger)? */
  T.slim = function () { return !!(T.el && N.screen.flex && N.screen.cls.w !== 'R'); };
  function libs() { var R = N.ui.rail; return R && R.allLibs ? R.allLibs() : []; }
  T.activate = function (i) {
    var t = TABS[i], R = N.ui.rail;
    if (!t) return;
    if (R && R.isOpen()) R.close(true);
    if (t.id === 'lib') {
      var l = libs();
      if (l.length === 1) { N.app.navigate(N.railRows.libId(l[0]), l[0]); return; }
      if (R) R.open();                               // Liste aller Bibliotheken (Seitenleiste als Blatt)
      return;
    }
    N.app.navigate(t.id, null);
  };
  /* Zeiger/Finger in Flaechen-Koordinaten -> true = getroffen (Klick ausgefuehrt) */
  T.pointer = function (x, y, kind) {
    if (!T.el || !T.mode) return false;
    var A = N.screen.area(true);
    if (T.mode === 'menu') {
      if (x < MENU_X - 8 || x >= MENU_X + MENU + 8 || y < MENU_Y - 8 || y >= MENU_Y + MENU + 8) return false;
      if (kind === 'click') { var R = N.ui.rail; if (R && !R.isOpen()) R.open(); }
      return true;
    }
    if (y < A.h - N.screen.TAB_H) return false;
    var i = T.hitTab(x, A.w);
    if (i >= 0 && kind === 'click') T.activate(i);
    return true;
  };
  N.ui.tabbar = T;
})(N);
