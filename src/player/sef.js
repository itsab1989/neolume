/* N.sef – Huelle um das SEF-Plugin "Player" (docs/research/player.md 1; Orca: Open('Player','1.000','Player'), K7).
 * create(onEvent) -> {exec(name, …), close()}. Ohne Plugin (Desktop-Vorschau, Tests) eine Faelschung, die Wiedergabe nur
 * nachspielt: laedt NIE die URL (keine Transcode-Sitzung), meldet Stream-Info, Puffer und Zeit-Ereignisse.
 * config.json {"sefFake":"still"}: Zeit laeuft nur um 1 ms je Tick (stehendes Bild fuer die visuelle Regression);
 * {"fakeEndMs":ms}: Dateiende (Ereignis 8) ms nach dem Start (Bildtests der Karte am Ende). */
(function (N) {
  var cur = null, opened = false;
  function real(el, onEvent) {
    // Open nur einmal je App-Lauf (Orca: Init einmal); Rueckgabe protokollieren (TV-Test 26.10.: InitPlayer -> -1)
    if (!opened) {
      try { var rv = el.Open('Player', '1.000', 'Player'); opened = true; N.log('sef Open -> ' + rv); } catch (e) { N.log('sef Open ' + e.message); }
    }
    el.OnEvent = function (type, data) { try { onEvent(type, data); } catch (e) { N.diag.error('sef event ' + type, e); } };
    return {
      exec: function (name, a, b, c, d, e, f) {
        var n = arguments.length;
        while (n > 1 && arguments[n - 1] === undefined) n--;   // ueberzaehlige undefined -> Execute liefert -1
        if (n <= 1) return el.Execute(name);
        if (n === 2) return el.Execute(name, a);
        if (n === 3) return el.Execute(name, a, b);
        if (n === 4) return el.Execute(name, a, b, c);
        if (n === 5) return el.Execute(name, a, b, c, d);
        if (n === 6) return el.Execute(name, a, b, c, d, e);
        return el.Execute(name, a, b, c, d, e, f);
      },
      close: function () { el.OnEvent = null; try { el.Execute('Stop'); } catch (e) {} },
      fake: false
    };
  }
  function fake(onEvent) {
    var t = 0, dur = 0, timer = 0, paused = false, still = N.config.sefFake === 'still', on = false, speed = 1;
    function loop() {
      timer = setTimeout(function () {
        if (!on) return;
        if (!paused) { t = Math.max(0, t + (still ? 1 : 500) * speed); onEvent(14, t); }   // Schnellspulen: speed x Takt
        loop();
      }, 500);
    }
    function stop() { on = false; if (timer) clearTimeout(timer); timer = 0; }
    return {
      exec: function (name, a) {
        switch (name) {
          case 'InitPlayer': stop(); speed = 1; return 1;
          case 'StartPlayback':
            t = (Number(a) || 0) * 1000; paused = false; on = true;
            setTimeout(function () { if (!on) return; onEvent(11); onEvent(9); onEvent(12); onEvent(14, t); loop(); }, 50);
            if (N.config.fakeEndMs > 0) setTimeout(function () { if (on) { stop(); onEvent(8); } }, N.config.fakeEndMs);   // nur Bildtests: Dateiende
            return 1;
          case 'Pause': paused = true; return 1;
          case 'Resume': paused = false; return 1;
          case 'Stop': stop(); return 1;
          case 'JumpForward': t += (Number(a) || 0) * 1000; return 1;
          case 'JumpBackward': t = Math.max(0, t - (Number(a) || 0) * 1000); return 1;
          case 'SetPlaybackSpeed': speed = Number(a) || 1; return 1;
          case 'GetDuration': return dur;
          default: return 1;
        }
      },
      close: stop,
      fake: true
    };
  }
  N.sef = {
    create: function (onEvent) {
      if (cur) cur.close();
      var el = typeof document !== 'undefined' && document.getElementById ? document.getElementById('pluginSef') : null;
      cur = el && el.Execute ? real(el, onEvent) : fake(onEvent);
      return cur;
    },
    close: function () { if (cur) { cur.close(); cur = null; } }
  };
})(N);
