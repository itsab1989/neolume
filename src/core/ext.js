/* N.ext – neutrale Erweiterungspunkte fuer optionale, zur Bauzeit gewaehlte Module (brand/<id>.json "features",
 * tools/build.js). Ohne Erweiterung ist jeder Aufruf ein No-op (eine Objekt-Abfrage, kein Messwert-Einfluss).
 *   N.ext.on(name, fn)          Erweiterung meldet sich an
 *   N.ext.has(name)             gibt es einen Hoerer? (teure Vorbereitung nur dann)
 *   N.ext.call(name, a, b, c)   alle Hoerer der Reihe nach; Rueckgabe = letzter Wert ungleich undefined
 * Fehler einer Erweiterung werden protokolliert und brechen die App nie ab.
 * N.features: Liste der eingebauten Erweiterungen (Marken-Profil), leer in der Standard-Fassung. */
(function (N) {
  var H = {};
  N.features = N.features || [];
  N.ext = {
    on: function (name, fn) { (H[name] = H[name] || []).push(fn); },
    has: function (name) { return !!(H[name] && H[name].length); },
    call: function (name, a, b, c) {
      var l = H[name], r;
      if (!l) return undefined;
      for (var i = 0; i < l.length; i++) {
        try { var x = l[i](a, b, c); if (x !== undefined) r = x; } catch (e) { if (N.log) N.log('ext ' + name + ' error ' + (e && e.message)); }
      }
      return r;
    },
    /* Tests */
    _reset: function () { H = {}; }
  };
})(N);
