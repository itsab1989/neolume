/* N.sections – "Zurueck aus einem Bereich" (SPEC NAV-5, Nutzerentscheid 29.10.): Bereiche = Bildschirme, die die Seitenleiste
 * direkt oeffnet (Bibliotheken inkl. Musik/Hoerbuecher, Suche, Entdecken, Einstellungen). Steht man dort ganz oben, fuehrt RETURN
 *   'home' (Standard): zur Startseite
 *   'prev': zum zuletzt geoeffneten anderen Bereich (Verlauf: jeder Bereich hoechstens einmal, neuester vorn, erneutes Oeffnen
 *           holt ihn nach vorn; der verlassene Bereich faellt heraus; verschwundene Bereiche werden uebersprungen; leer -> Start).
 * Kennung eines Bereichs = Eintrag der Seitenleiste (Bibliothek: 'lib-<id>' bzw. 'xlib-<server>-<id>' = Bibliotheks-ID).
 * Start leert den Verlauf (von dort fuehrt RETURN ohnehin zum Beenden-Dialog), ebenso jeder Profilwechsel.
 * Die Regeln (H) sind rein und getestet (tests/sections.test.js). */
(function (N) {
  var H = {
    /* Verlauf nach dem Oeffnen von id (neue Liste) */
    visit: function (list, id) {
      var o = [id];
      for (var i = 0; i < list.length; i++) if (list[i] !== id) o.push(list[i]);
      return o;
    },
    /* RETURN aus Bereich cur -> { to: Bereich | 'home', list: Verlauf danach (ohne cur und ohne verschwundene) } */
    back: function (list, cur, exists) {
      var rest = [];
      for (var i = 0; i < list.length; i++) if (list[i] !== cur && (!exists || exists(list[i]))) rest.push(list[i]);
      return { to: rest.length ? rest[0] : 'home', list: rest };
    },
    /* Einstellung des Profils; fehlend/unbekannt = Standard 'home' */
    mode: function (settings) { return settings && settings.sectionBack === 'prev' ? 'prev' : 'home'; }
  };
  var hist = [];
  N.sections = {
    H: H,
    MODES: ['home', 'prev'],
    visit: function (id) { if (id === 'home') hist = []; else hist = H.visit(hist, id); },
    reset: function () { hist = []; },
    list: function () { return hist.slice(); },
    /* Ziel fuer RETURN aus Bereich cur (Verlauf wird entsprechend gekuerzt); exists(id) -> steht der Bereich noch in der Seitenleiste? */
    target: function (cur, settings, exists) {
      if (H.mode(settings) !== 'prev') return 'home';
      var r = H.back(hist, cur, exists);
      hist = r.list;
      return r.to;
    }
  };
  N.evt.on('profile:changed', function () { hist = []; });
})(N);
