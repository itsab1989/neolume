/* N.trick – Schnellspulen im SEF-Trick-Modus (SPEC PLAY-32; docs/research/player.md 1.4). Rein, ohne DOM, in Node getestet.
 * EINE Geschwindigkeits-Skala wie Orca (Player.playbackSpeeds): -max … -4 -2 · 1 · 2 4 … max. ▶▶ (FF) geht eine Stufe nach rechts,
 * ◀◀ (RW) eine nach links: aus 8x vor wird 4x, 2x, dann 1x (normal), dann 2x zurueck. SetPlaybackSpeed kann nur Vielfache von 2,
 * ohne Ton, nur Direct Play. Stufen datengetrieben: config.json {"trickSpeeds":[2,4,8,16,32]} (TV-Test), Standard 2/4/8/16 –
 * genau die Werte, die Orca am selben Fernseher benutzt. Lehnt das SEF eine Stufe ab, kappt die Wiedergabe die Skala in dieser
 * Richtung (cap), statt sie erneut anzubieten. */
(function (N) {
  var DEF = [2, 4, 8, 16];
  var T = {
    DEF: DEF,
    /* gueltige Stufen (Betraege): ganze Vielfache von 2 zwischen 2 und 64, aufsteigend, ohne Doppel; leer/ungueltig -> DEF */
    speeds: function (list) {
      var out = [];
      if (Object.prototype.toString.call(list) === '[object Array]') for (var i = 0; i < list.length; i++) {
        if (typeof list[i] !== 'number') continue;          // nur Zahlen ("8" oder ein Text "2,4,8" gelten nicht)
        var n = Math.abs(list[i]);
        if (n >= 2 && n <= 64 && n % 2 === 0 && out.indexOf(n) < 0) out.push(n);
      }
      if (!out.length) return DEF.slice();
      return out.sort(function (a, b) { return a - b; });
    },
    /* Skala mit Kappung cap {f, b} (groesster erlaubter Betrag vor/zurueck; 0 = Richtung geht nicht): [-16, …, -2, 1, 2, …, 16] */
    scale: function (sp, cap) {
      var s = [1], i;
      for (i = 0; i < sp.length; i++) {
        if (!cap || sp[i] <= cap.f) s.push(sp[i]);
        if (!cap || sp[i] <= cap.b) s.unshift(-sp[i]);
      }
      return s;
    },
    /* naechste Geschwindigkeit: cur (1 = normal), dir +1 (FF) / -1 (RW). Gleich cur = Anschlag (schneller geht es nicht) */
    next: function (cur, dir, sp, cap) {
      var s = T.scale(sp, cap), i = s.indexOf(cur);
      if (i < 0) i = s.indexOf(1);
      i += dir > 0 ? 1 : -1;
      if (i < 0) i = 0; else if (i >= s.length) i = s.length - 1;
      return s[i];
    },
    /* Stufe unter einer abgelehnten (Betrag): letzte kleinere der Liste, sonst 0 (Richtung geht gar nicht) */
    below: function (sp, n) {
      var a = Math.abs(n), r = 0;
      for (var i = 0; i < sp.length; i++) if (sp[i] < a) r = sp[i];
      return r;
    },
    /* Rand erreicht? 'start': zurueck und der naechste Zeit-Takt (ca. 0,5 s, also speed x 0,5 s Film) laege vor dem Anfang;
     * 'end': vor und nur noch so viel Film uebrig – dann normal weiter, das Ende laeuft wie immer (Countdown, naechste Folge) */
    edge: function (speed, ms, dur) {
      if (speed < 0) return ms <= Math.max(1000, -speed * 600) ? 'start' : '';
      if (speed > 1 && dur > 0) return ms >= dur - Math.max(3000, speed * 600) ? 'end' : '';
      return '';
    },
    /* Anzeige "8×" (× ist im Schrift-Subset, Latin-1) */
    label: function (speed) { return Math.abs(speed) + '×'; }
  };
  N.trick = T;
})(N);
