/* N.theme – Titelmelodie bei Serien (SPEC v2.2; Nutzerentscheidung M3b: Standard AUS). Einmal abspielen (keine Schleife), Start
 * 600 ms nach Seitenaufbau und nur in Tastenruhe, Lautstaerke aus der Einstellung (25/50/75/100 %), Ausblenden in ca. 1 s beim
 * Verlassen der Serie und vor jeder Wiedergabe. Ein <audio>-Element, erst bei Bedarf erzeugt; Fehler werden nur protokolliert. */
(function (N) {
  var U = N.util, au = null, startT = 0, fadeT = 0, cur = '', START = 600;
  function el() {
    if (!au) { au = document.createElement('audio'); au.preload = 'none'; au.style.display = 'none'; document.body.appendChild(au); }
    return au;
  }
  function vol() { var v = Number(N.session.settings && N.session.settings.themeVol) || 50; return U.clamp(v / 100, 0.05, 1); }
  var T = {
    on: function () { return !!(N.session.settings && N.session.settings.themeMusic); },
    /* key: Pfad aus /library/metadata/<serie> ("theme"); gleiche Serie laeuft weiter */
    play: function (key) {
      if (!T.on() || !key || typeof document === 'undefined') return;
      if (N.audio && N.audio.active()) return;           // M4: nie waehrend Musik/Hoerbuch
      var url = N.plex.url(key, { 'X-Plex-Token': N.plex.token });
      if (url === cur) return;
      T.stop(true);
      cur = url;
      startT = setTimeout(function wait() {
        startT = 0;
        if (cur !== url) return;
        if (N.idle.restFor() < START) { startT = setTimeout(wait, 200); return; }   // nicht beim schnellen Durchblaettern
        try {
          var a = el();
          if (fadeT) { clearInterval(fadeT); fadeT = 0; }
          a.volume = vol(); a.loop = false; a.src = url; a.play();
          N.log('theme start');
        } catch (e) { N.log('theme ' + e.message); }
      }, START);
    },
    /* now = sofort (z. B. vor dem Player), sonst ca. 1 s ausblenden */
    stop: function (now) {
      if (startT) { clearTimeout(startT); startT = 0; }
      cur = '';
      if (!au) return;
      if (fadeT) { clearInterval(fadeT); fadeT = 0; }
      var a = au;
      function end() { try { a.pause(); a.removeAttribute('src'); a.load(); } catch (e) {} }
      if (now || a.paused) { end(); return; }
      var step = a.volume / 8;
      fadeT = setInterval(function () {
        try { a.volume = Math.max(0, a.volume - step); } catch (e) {}
        if (a.volume <= 0.001) { clearInterval(fadeT); fadeT = 0; end(); }
      }, 120);
    },
    playing: function () { return !!cur; }
  };
  N.theme = T;
})(N);
