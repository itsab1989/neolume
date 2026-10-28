/* N.fmt – Zahlen, Zeiten, Staffel/Folge in beiden Sprachen (SPEC 10.1 Regel 8). Reine Funktionen. */
(function (N) {
  var U = N.util;
  /* Haeufige Genre-Tags von Plex/TMDB/TVDB in beiden Sprachen (TV-Test 27.10., F22: "FILM · ADVENTURE" bei deutscher
   * Oberflaeche, weil die Bibliothek englische Metadaten hat). Unbekannte Tags bleiben, wie der Server sie liefert. */
  var GENRES = [['Action', 'Action'], ['Adventure', 'Abenteuer'], ['Animation', 'Animation'], ['Biography', 'Biografie'],
    ['Comedy', 'Komödie'], ['Crime', 'Krimi'], ['Documentary', 'Dokumentarfilm'], ['Drama', 'Drama'], ['Family', 'Familie'],
    ['Fantasy', 'Fantasy'], ['History', 'Historie'], ['Horror', 'Horror'], ['Music', 'Musik'], ['Musical', 'Musical'],
    ['Mystery', 'Mystery'], ['Romance', 'Liebesfilm'], ['Science Fiction', 'Science-Fiction'], ['Sci-Fi', 'Science-Fiction'],
    ['Thriller', 'Thriller'], ['War', 'Kriegsfilm'], ['Western', 'Western'], ['Action & Adventure', 'Action & Abenteuer'],
    ['Sci-Fi & Fantasy', 'Sci-Fi & Fantasy'], ['War & Politics', 'Krieg & Politik'], ['Kids', 'Kinder'], ['Children', 'Kinder'],
    ['News', 'Nachrichten'], ['Reality', 'Reality-TV'], ['Talk', 'Talkshow'], ['Soap', 'Seifenoper'], ['Sport', 'Sport'],
    ['Suspense', 'Spannung'], ['Short', 'Kurzfilm'], ['TV Movie', 'TV-Film'], ['Mini-Series', 'Miniserie'],
    ['Game Show', 'Spielshow'], ['Food', 'Kochen'], ['Travel', 'Reisen'], ['Home and Garden', 'Haus & Garten'],
    ['Martial Arts', 'Kampfsport'], ['Film-Noir', 'Film noir'], ['Anime', 'Anime'], ['Erotic', 'Erotik']];
  var G_DE = {}, G_EN = {};
  (function () { for (var i = 0; i < GENRES.length; i++) { G_DE[GENRES[i][0].toLowerCase()] = GENRES[i][1]; if (!G_EN[GENRES[i][1].toLowerCase()]) G_EN[GENRES[i][1].toLowerCase()] = GENRES[i][0]; } })();
  var F = {
    /* Genre-Tag in der App-Sprache (bekannte Tags), sonst unveraendert */
    genre: function (t) {
      var k = String(t || '').toLowerCase(), m = N.i18n.lang() === 'en' ? G_EN : G_DE;
      return m[k] || String(t || '');
    },
    /* Dauer in ms -> "24 Min." / "1 Std. 2 Min." (gerundet auf Minuten, mind. 1 Min.) */
    dur: function (ms) {
      var m = Math.max(1, Math.round((ms || 0) / 60000)), h = Math.floor(m / 60);
      m = m % 60;
      if (!h) return N.t('fmt.min', { n: m });
      if (!m) return N.t('fmt.hr', { h: h });
      return N.t('fmt.hrMin', { h: h, m: m });
    },
    /* Uhrzeit "21:58" (24 h, beide Sprachen) */
    clock: function (date) { return U.pad2(date.getHours()) + ':' + U.pad2(date.getMinutes()); },
    /* kurzes Datum mit Wochentag: "Mi., 28. Okt." / "Wed 28 Oct" (Namen aus fmt.wd / fmt.mon, kommagetrennt) */
    dateShort: function (date) {
      return N.t('fmt.dateShort', { wd: N.t('fmt.wd').split(',')[date.getDay()], d: date.getDate(), m: N.t('fmt.mon').split(',')[date.getMonth()] });
    },
    mmss: function (sec) { sec = Math.max(0, Math.floor(sec)); return Math.floor(sec / 60) + ':' + U.pad2(sec % 60); },
    /* Bewertung "8,9/10" / "8.9/10" (kein ★: fehlt in der TV-Schrift, NUTZER-FEEDBACK-REGELN 10) */
    rating: function (r) {
      if (r === undefined || r === null || r === '') return '';
      return N.t('fmt.rating', { n: (Math.round(Number(r) * 10) / 10).toFixed(1).replace('.', N.t('fmt.decimal')) });
    },
    /* Altersfreigabe: "de/12" -> "FSK 12", sonst Rohwert ("TV-14") */
    rated: function (cr) {
      if (!cr) return '';
      var m = /^de\/(\d+)$/.exec(cr);
      if (m) return N.t('meta.fsk', { n: m[1] });
      return cr.replace(/^[a-z]{2}\//, '');
    },
    /* Teile mit " · " verbinden, leere weglassen */
    join: function (parts) {
      var out = [];
      for (var i = 0; i < parts.length; i++) if (parts[i] !== undefined && parts[i] !== null && parts[i] !== '') out.push(parts[i]);
      return out.join(' · ');
    }
  };
  N.fmt = F;
})(N);
