/* N.subSearch – Untertitel suchen & herunterladen ueber den PMS (OpenSubtitles; Plex "Search for subtitles", docs/research/plex-parity.md 3.1).
 * - Suche (nur lesend): GET /library/metadata/<rk>/subtitles?language=<iso>&hearingImpaired=0|1&forced=0|1
 *   -> MediaContainer.Stream[] {key, codec, language, languageCode, providerTitle, score, title, forced, hearingImpaired}
 *   (Format am PMS 1.43.5 per GET geprueft, 26.10.).
 * - Herunterladen (SCHREIBT auf den Server: legt die Datei neben das Video; Plex loescht sie wieder, wenn man spaeter "Aus" oder
 *   eine andere Spur waehlt): PUT /library/metadata/<rk>/subtitles?key=<stream.key>. Wird nur nach dem Warn-Dialog aufgerufen
 *   (views/player.js) und nur im Hauptkonto. Noch NICHT gegen den echten Server getestet – Test nur mit Nutzer-OK (docs/P5-TV-TEST.md). */
(function (N) {
  var LANG = { de: 'de', en: 'en' };
  var S = {
    query: function (lang, hi, forced) { return { language: LANG[lang] || 'de', hearingImpaired: hi ? 1 : 0, forced: forced ? 1 : 0 }; },
    /* Antwort -> [{key, title, lang, score, forced, hi, provider}] nach Bewertung absteigend, ohne Eintraege ohne key */
    parse: function (json) {
      var list = json && json.MediaContainer && json.MediaContainer.Stream || [], out = [];
      for (var i = 0; i < list.length; i++) {
        var s = list[i];
        if (!s || !s.key) continue;
        out.push({ key: String(s.key), title: String(s.title || s.displayTitle || ''), lang: N.tracks ? N.tracks.langKey(s.languageCode || s.languageTag) : String(s.languageCode || ''),
          score: Number(s.score) || 0, forced: !!s.forced, hi: !!s.hearingImpaired, provider: String(s.providerTitle || ''), codec: String(s.codec || '') });
      }
      out.sort(function (a, b) { return b.score - a.score; });
      return out;
    },
    /* Unterzeile im Panel: "OpenSubtitles · nur fremdsprachige Stellen · Bewertung 91" */
    subline: function (r) {
      var p = [];
      if (r.provider) p.push(r.provider);
      if (r.forced) p.push(N.t('pl.track.forced'));
      if (r.hi) p.push(N.t('pl.track.hi'));
      if (r.score) p.push(N.t('pl.ss.score', { n: r.score }));
      return p.join(' · ');
    },
    /* Suche (lesend) */
    search: function (rk, lang, cb) {
      return N.plex.get('/library/metadata/' + rk + '/subtitles', S.query(lang, false, false), { timeout: 30000, retries: 0 }, function (err, json) {
        cb(err, err ? [] : S.parse(json));
      });
    },
    /* Herunterladen (schreibend, ueber N.plex.write -> readOnly beachtet). confirmed muss true sein (Warn-Dialog bestaetigt). */
    download: function (rk, key, confirmed, cb) {
      if (confirmed !== true) { cb({ type: 'unconfirmed', status: 0 }); return null; }
      if (N.log) N.log('Untertitel laden (PUT) rk=' + rk);
      return N.plex.write('PUT', '/library/metadata/' + rk + '/subtitles', { key: key }, cb);
    }
  };
  N.subSearch = S;
})(N);
