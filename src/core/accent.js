/* N.accent – Akzentfarbe waehlbar (Einstellungen > Oberflaeche > Akzentfarbe), je Profil gespeichert (settings.accent).
 * Kosten zur Laufzeit: genau EINE Klasse am <html> (ac-<id>). tools/build.js erzeugt aus jeder CSS-Regel mit @accent@/@pointer@
 * je Palettenfarbe eine Variante ".ac-<id> <selektor>{...}"; die Standardfarbe der Marke (N.brand.accent) bleibt die
 * unbeschriftete Grundregel und braucht keine Klasse. Kein CSS-Text zur Laufzeit, keine Inline-Farben.
 * Quelle der Farben ist design/tokens.json (Gruppe accent; Build, make_assets.js und Tests lesen dort), PALETTE unten ist daraus
 * erzeugt (Test prueft Gleichstand). Jede Farbe erfuellt (tests/accent.test.js):
 * dunkle Schrift #141414 darauf >= 4.5:1 (Knopf-Beschriftung, Icons Zeile "on-accent") und sie selbst >= 4.5:1 auf #121316
 * (Akzent als Schriftfarbe, Fokusrahmen). Die Standardfarbe einer Marke kommt aus brand/<id>.json ("accent") und ersetzt den
 * Palettenwert ihrer Farbe (accentId) – so steht die Markenfarbe der privaten Fassung nur in deren Markenprofil. */
(function (N) {
  /* gen:palette – erzeugt aus design/tokens.json (Gruppe accent) von tools/design_doc.js --write; nicht von Hand aendern */
  var PALETTE = [
    ['amber', '#F2A93B'], ['coral', '#FF7A5C'], ['rose', '#F78FB3'], ['violet', '#A78BFA'],
    ['blue', '#5AA9FF'], ['teal', '#2EC4B6'], ['green', '#5CCB7A'], ['gray', '#A9AFB8']
  ];
  /* /gen:palette */
  var RE = /(^|\s)ac-[a-z]+/g, BRE = /(^|\s)bd-[a-z]+/g, cur = null, bcur = null, LIGHT = 'light';
  /* Klasse am <html> tauschen (re = Muster der alten Klasse, k = neue oder '') – eine Stil-Neuberechnung, nur bei Wechsel */
  function swap(re, k) {
    if (typeof document === 'undefined' || !document.documentElement) return;
    var h = document.documentElement, c = String(h.className || '').replace(re, '');
    h.className = (k ? c + ' ' + k : c).replace(/^\s+|\s+$/g, '');
  }
  var A = {
    PALETTE: PALETTE,
    ids: function () { var o = []; for (var i = 0; i < PALETTE.length; i++) o.push(PALETTE[i][0]); return o; },
    valid: function (id) { for (var i = 0; i < PALETTE.length; i++) if (PALETTE[i][0] === id) return true; return false; },
    base: function () { return N.brand && N.brand.accent || 'teal'; },
    /* gespeicherter Wert -> gueltige Farbe (unbekannt/alt -> Standard der Marke) */
    of: function (id) { return A.valid(id) ? id : A.base(); },
    /* Klasse fuer eine Farbe: '' fuer die Standardfarbe (Grundregeln), sonst 'ac-<id>' */
    cls: function (id) { id = A.of(id); return id === A.base() ? '' : 'ac-' + id; },
    current: function () { return cur || A.base(); },
    /* Farbe anwenden: nur bei Wechsel die Klasse am <html> tauschen (eine Stil-Neuberechnung) */
    apply: function (id) {
      id = A.of(id);
      if (id === cur) return false;
      cur = id;
      swap(RE, A.cls(id));
      return true;
    },
    /* Farbe der Markierungen auf Kacheln (SPEC ACC-2, Einstellung badgeColor): 'light' = Hellgrau (c.text-1, Standard, keine
     * Klasse) oder eine Palettenfarbe -> Klasse bd-<id> am <html> (tools/build.js badgeCss); Markenfarbe = Wert der Marke */
    LIGHT: LIGHT,
    badgeIds: function () { return [LIGHT].concat(A.ids()); },
    badgeOf: function (id) { return A.valid(id) ? id : LIGHT; },
    badgeCls: function (id) { id = A.badgeOf(id); return id === LIGHT ? '' : 'bd-' + id; },
    applyBadge: function (id) {
      id = A.badgeOf(id);
      if (id === bcur) return false;
      bcur = id;
      swap(BRE, A.badgeCls(id));
      return true;
    },
    /* Farbe des aktiven Profils anwenden und fuer den naechsten Start merken (Startbild/Profilwahl ohne Farbsprung) */
    sync: function () {
      var S = N.session, id = A.of(S && S.settings ? S.settings.accent : S && S.state ? S.state.accent : null);
      A.apply(id);
      if (S && S.state && S.settings && S.state.accent !== id) { S.state.accent = id; S.save(); }
      A.applyBadge(S && S.settings ? S.settings.badgeColor : null);
    }
  };
  if (N.evt) {
    N.evt.on('profile:changed', function () { A.sync(); });
    N.evt.on('settings:changed', function (d) { if (d && (d.key === 'accent' || d.key === 'badgeColor')) A.sync(); });
  }
  N.accent = A;
})(N);
