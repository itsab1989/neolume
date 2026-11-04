/* N.keys – Tastennamen und Tastenkappen (SPEC 5.11). Die Codes kennt die Plattform (N.platform.keys, z. B.
 * platforms/samsung-orsay/adapter/platform.js); der Adapter ist im Manifest vor diesem Modul geladen. */
(function (N) {
  N.keys = {
    name: function (code, ev) { return N.platform.keys.name(code, ev); },
    isNav: function (k) { return k === 'UP' || k === 'DOWN' || k === 'LEFT' || k === 'RIGHT'; },
    isDigit: function (k) { return k !== null && k.length === 1 && k >= '0' && k <= '9'; },
    /* Tastenkappen: aufgedruckter Text, nie uebersetzt */
    cap: N.platform.keys.cap,
    /* Kappe als Text fuer Hilfe/Hinweisleiste; "@schluessel" = Text je Sprache und Eingabeart (Apple, NAV-26); sonst null */
    label: function (k) {
      var c = N.platform.keys.cap, v = c && c[k];
      if (typeof v !== 'string') return null;
      return v.charAt(0) === '@' ? N.t(v.slice(1)) : v;
    }
  };
})(N);
