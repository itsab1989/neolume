/* N.clock – Wanduhr der App, korrigiert gegen die Server-Zeit (TV-Test 27.10. nachmittags: App-Uhr 07:21 statt 14:23).
 * Die Orsay-Systemuhr kann falsch gehen (keine Sendezeit ueber HDMI, Reset nach Smart-Hub-Kontowechsel). Jede Antwort, die
 * N.http ohnehin bekommt, traegt einen HTTP-"Date"-Kopf (UTC, Sekundengenau); daraus schaetzen wir die Abweichung
 * Serverzeit - TV-Uhr. Keine zusaetzlichen Anfragen (PMS-Wurzel / /:/prefs sind fuer verwaltete Profile tabu).
 * - Probe nur aus schnellen Antworten (Laufzeit <= MAX_RTT); Zeitpunkt = Mitte der Laufzeit, Date + 0,5 s (abgeschnittene Sekunde).
 * - Gleitendes Fenster der letzten WIN Proben, Median ab MIN_N Proben; angewandt nur bei |Median| > APPLY (90 s), sonst 0.
 *   Einmal angewandt, bleibt der Wert, solange sich der Median um hoechstens JITTER bewegt (Uhr springt nicht im Sekundentakt).
 * - Zeitzone: Date ist UTC; die Anzeige rechnet mit der Zone des TV (new Date(ms).getHours(), inkl. Sommerzeit). Plex liefert in
 *   den Antwortkoepfen keine Zone – steht die Zone am TV falsch, bleibt die Anzeige um volle Stunden daneben (bewusst nicht geraten).
 * - Nur fuer ANZEIGEN (Uhr, "Ende um"). Dauern/Timer rechnen weiter mit U.now() (TV-Uhr, in sich stetig); sonst wuerde ein
 *   Korrektursprung laufende Differenzen verfaelschen. Ohne lesbaren Date-Kopf (Browser/CORS) bleibt der Versatz 0. */
(function (N) {
  var U = N.util;
  var MAX_RTT = 1500, WIN = 5, MIN_N = 3, APPLY = 90000, JITTER = 2000;
  var MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  var samples = [], off = 0;

  function median(a) {
    if (!a.length) return 0;
    var s = a.slice().sort(function (x, y) { return x - y; }), h = s.length >> 1;
    return s.length % 2 ? s[h] : Math.round((s[h - 1] + s[h]) / 2);
  }
  /* "Tue, 27 Oct 2026 13:23:05 GMT" (auch RFC 850 "Tuesday, 27-Oct-26 ...") -> ms UTC, sonst NaN. Bewusst ohne Date.parse
   * (auf alten WebKits uneinheitlich). asctime-Format kommt bei Plex nicht vor. */
  function parse(s) {
    var m = /(\d{1,2})[ \-]([A-Za-z]{3})[A-Za-z]*[ \-](\d{2,4}) (\d{1,2}):(\d{2}):(\d{2})/.exec(String(s || ''));
    if (!m) return NaN;
    var mo = MON[m[2].toLowerCase()], y = Number(m[3]);
    if (mo === undefined) return NaN;
    if (y < 100) y += y < 70 ? 2000 : 1900;
    var d = Number(m[1]), h = Number(m[4]), mi = Number(m[5]), se = Number(m[6]);
    if (d < 1 || d > 31 || h > 23 || mi > 59 || se > 60) return NaN;
    return Date.UTC(y, mo, d, h, mi, se);
  }
  function decide() {
    if (samples.length < MIN_N) return;
    var m = median(samples);
    if (Math.abs(m) <= APPLY) off = 0;
    else if (!off || Math.abs(m - off) > JITTER) off = m;
  }

  var C = {
    parse: parse,
    median: median,
    /* Probe aus einer Antwort: Date-Kopf, Sendezeit t0 und Empfangszeit t1 (beide TV-Uhr, U.now()). true = verwendet */
    sample: function (dateHdr, t0, t1) {
      var srv = parse(dateHdr), rtt = t1 - t0;
      if (isNaN(srv) || !(rtt >= 0) || rtt > MAX_RTT) return false;
      samples.push(srv + 500 - (t0 + rtt / 2));
      if (samples.length > WIN) samples.shift();
      decide();
      return true;
    },
    /* angewandter Versatz in ms (0 = TV-Uhr stimmt bzw. noch unbekannt) */
    offset: function () { return off; },
    /* korrigierte Wanduhr in ms – fuer alle Uhrzeit-Anzeigen */
    now: function () { return U.now() + off; },
    date: function () { return new Date(C.now()); },
    /* Protokoll: "off=+25262s n=5" */
    info: function () { return 'off=' + (off >= 0 ? '+' : '') + Math.round(off / 1000) + 's n=' + samples.length; },
    _reset: function () { samples = []; off = 0; },
    LIMITS: { MAX_RTT: MAX_RTT, WIN: WIN, MIN_N: MIN_N, APPLY: APPLY, JITTER: JITTER }
  };
  N.clock = C;
})(N);
