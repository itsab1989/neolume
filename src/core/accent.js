/* N.accent – Akzentfarbe waehlbar (Einstellungen > Oberflaeche > Akzentfarbe), je Profil gespeichert (settings.accent).
 * Kosten zur Laufzeit: genau EINE Klasse am <html> (ac-<id>). tools/build.js erzeugt aus jeder CSS-Regel mit @accent@/@pointer@
 * je Palettenfarbe eine Variante ".ac-<id> <selektor>{...}"; die Standardfarbe der Marke (N.brand.accent) bleibt die
 * unbeschriftete Grundregel und braucht keine Klasse. Kein CSS-Text zur Laufzeit, keine Inline-Farben.
 * PALETTE ist die einzige Quelle der Farben (Build, make_assets.js, Tests). Jede Farbe erfuellt (tests/accent.test.js):
 * dunkle Schrift #141414 darauf >= 4.5:1 (Knopf-Beschriftung, Icons Zeile "on-accent") und sie selbst >= 4.5:1 auf #121316
 * (Akzent als Schriftfarbe, Fokusrahmen). Die Standardfarbe einer Marke kommt aus brand/<id>.json ("accent") und ersetzt den
 * Palettenwert ihrer Farbe (accentId) – so steht die Markenfarbe der privaten Fassung nur in deren Markenprofil. */
(function (N) {
  var PALETTE = [
    ['amber', '#F2A93B'], ['coral', '#FF7A5C'], ['rose', '#F78FB3'], ['violet', '#A78BFA'],
    ['blue', '#5AA9FF'], ['teal', '#2EC4B6'], ['green', '#5CCB7A']
  ];
  var RE = /(^|\s)ac-[a-z]+/g, cur = null;
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
      if (typeof document === 'undefined' || !document.documentElement) return true;
      var h = document.documentElement, c = String(h.className || '').replace(RE, ''), k = A.cls(id);
      h.className = (k ? c + ' ' + k : c).replace(/^\s+|\s+$/g, '');
      return true;
    },
    /* Farbe des aktiven Profils anwenden und fuer den naechsten Start merken (Startbild/Profilwahl ohne Farbsprung) */
    sync: function () {
      var S = N.session, id = A.of(S && S.settings ? S.settings.accent : S && S.state ? S.state.accent : null);
      A.apply(id);
      if (S && S.state && S.settings && S.state.accent !== id) { S.state.accent = id; S.save(); }
    }
  };
  if (N.evt) {
    N.evt.on('profile:changed', function () { A.sync(); });
    N.evt.on('settings:changed', function (d) { if (d && d.key === 'accent') A.sync(); });
  }
  N.accent = A;
})(N);
