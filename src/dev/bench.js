/* N.devbench – app-interner Messlauf (P7, docs/P7-TV-TEST.md). Nur im Entwicklungs-Build (dev/ fehlt in app.min.js) und nur bei
 * ctx.source = dev… (N.devperf.enabled). Die Netzwerk-Fernbedienung verschluckt schnelle Tastenfolgen (TV-BEFUNDE) -> die App
 * drueckt die Tasten selbst (N.router.key im festen Takt) und misst per rAF.
 * Start: Ziffernfolge 9,8,7 auf der Fernbedienung (je < 4 s Abstand) | window.PN_BENCH = 'all' | 'home,lib,leak' (tools/dev.py serve
 * --bench …, Vorschau &bench=…). RETURN/EXIT bricht ab. Ergebnis: je Szenario eine Zeile "bench <name>: …" im Protokoll (ctx.log).
 * Szenarien: home, home-hero, lib-L/M/S/list, details-movie, details-show, search, discover, player-osd (readOnly erzwungen, keine
 * Fortschritts-/Spur-Schreibzugriffe), loupe (Feinauswahl am Balken: Zeiger ruht -> oeffnet, Hin-und-her im 40-ms-Takt, nach oben weg;
 * nur mit Zeiger-Steuerung, Einstellung waehrend des Laufs an; Darstellung A Lasche = Standard, frueher 'loupe-panel'),
 * loupe-stretch / loupe-film (dasselbe in den anderen Darstellungen, SPEC PLAY-31; film misst nur mit Vorschaubildern des ersten Films den Filmstreifen, sonst das Panel), leak (Details Film/Serie, Bibliothek, Suche, Einstellungen, Musik, Player je Runde
 * oeffnen/schliessen, Standard 10 Runden, 'leak:20'; nur auf Wunsch: 'leak' bzw. 'all,leak'), saver-<uebergang> (nur auf Wunsch:
 * 'saver' bzw. Ziffern 9,8,4 = alle Uebergaenge mit Frame-Protokoll). */
(function (N) {
  var U = N.util, BM = N.benchMath, GAP = 160, SEQ = ['9', '8', '7'], SEQ_MS = 4000;
  var run = null, seq = 0, seqT = 0, tm = null;

  function R() { return N.router; }
  /* Schritt eines Laufs: Tastenname oder Funktion (Zeiger-Szenarien, z. B. 'loupe': N.pointer.move wie die echte Smart Control) */
  function press(k) { if (typeof k === 'function') k(); else R().key(k); }
  function log(m) { N.log(m); }
  function heap() { try { var p = window.performance; return p && p.memory ? p.memory.usedJSHeapSize : 0; } catch (e) { return 0; } }
  function domCount() { return document.getElementsByTagName('*').length; }
  function imgN() { var s = N.img._stats(); return (s.sets || 0) + (s.loads || 0); }
  function decN() { return N.img._stats().warms || 0; }   // Runde 5: Vorab-Dekodierungen (N.img.warm) – im Frame-Protokoll 'dec'

  /* Timer-Buchhaltung fuer den Leck-Test (erst ab Start des Laufs, Wrapper bleiben danach aktiv) */
  function trackTimers() {
    if (tm) return;
    var W = window, sT = W.setTimeout, cT = W.clearTimeout, sI = W.setInterval, cI = W.clearInterval;
    tm = { to: {}, toN: 0, iv: {}, ivN: 0 };
    W.setTimeout = function (f, ms) {
      var id = sT.call(W, function () { if (tm.to[id]) { delete tm.to[id]; tm.toN--; } if (typeof f === 'function') f(); }, ms);
      tm.to[id] = 1; tm.toN++; return id;
    };
    W.clearTimeout = function (id) { if (tm.to[id]) { delete tm.to[id]; tm.toN--; } return cT.call(W, id); };
    W.setInterval = function (f, ms) { var id = sI.call(W, f, ms); tm.iv[id] = 1; tm.ivN++; return id; };
    W.clearInterval = function (id) { if (tm.iv[id]) { delete tm.iv[id]; tm.ivN--; } return cI.call(W, id); };
  }
  function snap() {
    return { dom: domCount(), evt: N.evt.count(), iv: tm ? tm.ivN : 0, to: tm ? tm.toN : 0, img: N.img._stats(), heap: heap(), depth: R().depth() };
  }

  /* ---------- Ablauf ---------- */
  function later(ms, fn) {
    var my = run;
    setTimeout(function () { if (run === my && !my.stop) fn(); }, ms);
  }
  /* P7 27.10.: Arbeit je Schritt messen ('work' im Spec; tools/bench.js setzt es immer). Zaehlt DOM-Aenderungen (MutationObserver),
   * misst Tastenhandler, danach laufende Timer/rAF-Rueckrufe und erzwingt nach jedem Stil+Layout (offsetWidth), um es zuzuordnen. */
  var pnow = window.performance && window.performance.now ? function () { return window.performance.now(); } : U.now;
  function flushT() { var t = pnow(); return document.body.offsetWidth >= 0 ? pnow() - t : 0; }
  function Work() {
    var w = this, MO = window.MutationObserver || window.WebKitMutationObserver;
    w.s = { js: 0, async: 0, sl: 0, mut: 0, cls: 0, sty: 0, txt: 0, src: 0, node: 0, srcRep: 0, maxTask: 0, key: 0, keyMax: 0, mutKey: 0, mutMax: 0 };
    w.on = true;
    w.mo = MO ? new MO(function (l) { w.count(l); }) : null;
    if (w.mo) w.mo.observe(document.body, { subtree: true, attributes: true, characterData: true, childList: true });
    var W = window, sT = W.setTimeout, raf = U.raf;
    w.sT = sT; w.raf = raf;
    function timed(f) {
      return function () {
        if (!w.on) { f.apply(this, arguments); return; }
        var t = pnow(); f.apply(this, arguments); var d = pnow() - t, l = flushT();
        w.s.async += d; w.s.sl += l; if (d + l > w.s.maxTask) w.s.maxTask = d + l;
        w.take(false);
      };
    }
    W.setTimeout = function (f, ms) { return sT.call(W, typeof f === 'function' ? timed(f) : f, ms); };
    U.raf = function (f) { return raf.call(U, timed(f)); };
  }
  /* Aenderungen dieses Rueckrufs sofort abholen -> je Aufgabe zaehlen (mutMax ~ Arbeit des teuersten Frames) */
  Work.prototype.take = function (isKey) {
    if (!this.mo || !this.mo.takeRecords) return;
    var s = this.s, before = s.mut;
    this.count(this.mo.takeRecords());
    var n = s.mut - before;
    if (isKey) s.mutKey += n;
    if (n > s.mutMax) s.mutMax = n;
  };
  Work.prototype.count = function (l) {
    var s = this.s, rep = N.idle.restFor() < 200;
    for (var i = 0; i < l.length; i++) {
      var r = l[i];
      s.mut++;
      if (r.type === 'characterData') s.txt++;
      else if (r.type === 'childList') s.node += r.addedNodes.length + r.removedNodes.length;
      else if (r.attributeName === 'class') s.cls++;
      else if (r.attributeName === 'style') s.sty++;
      else if (r.attributeName === 'src') { s.src++; if (rep && String(r.target.src).indexOf('data:') !== 0) s.srcRep++; }
    }
  };
  Work.prototype.key = function (k) {
    var s = this.s;
    this.take(false);
    var t = pnow(); press(k); var d = pnow() - t, l = flushT();
    this.take(true);
    s.js += d; s.sl += l; s.key += d + l;
    if (d + l > s.maxTask) s.maxTask = d + l;
    if (d + l > s.keyMax) s.keyMax = d + l;
  };
  Work.prototype.end = function () {
    this.on = false;
    if (this.mo) { this.count(this.mo.takeRecords ? this.mo.takeRecords() : []); this.mo.disconnect(); }
    window.setTimeout = this.sT; U.raf = this.raf;
    return this.s;
  };

  /* perf2: Frame-Protokoll ('frames' im Spec) – OHNE erzwungenes Layout, also auch fuer fps-Laeufe am TV brauchbar.
   * Je Frame-Intervall (rAF zu rAF): JS-Zeit je Quelle (Taste, Raster/Reihe, Hero, Hinweise, Idle, uebrige Timer/rAF), DOM-Aenderungen,
   * Bildzuweisungen. Rest = Intervall - JS ~ Stil/Layout/Malen/Compositing des Browsers. Ausgabe: Mittel + die 5 laengsten Frames. */
  function Frames() {
    var F = this, MO = window.MutationObserver || window.WebKitMutationObserver, W = window;
    F.cur = {}; F.js = 0; F.mut = 0; F.top = []; F.topJs = []; F.n = 0; F.sum = 0; F.sumJs = 0; F.sumMut = 0; F.last = 0; F.img = imgN(); F.dec = decN(); F.dec0 = F.dec; F.undo = [];
    F.kn = 0; F.kl = ''; F.since = 0;                   // TV 28.10.: letzte Taste (#Nummer) + Frames seither -> lange Frames einem Schritt zuordnen
    F.mo = MO ? new MO(function (l) { F.mut += l.length; }) : null;
    if (F.mo) F.mo.observe(document.body, { subtree: true, attributes: true, characterData: true, childList: true });
    F.depth = 0;
    F.add = function (lb, d) { F.cur[lb] = (F.cur[lb] || 0) + d; };
    F.wrapFn = function (lb, f) {
      return function () {
        var t = pnow(); F.depth++;
        try { return f.apply(this, arguments); } finally { F.depth--; var d = pnow() - t; F.add(lb, d); if (!F.depth) F.js += d; }
      };
    };
    function wrap(lb, o, k) { if (!o || typeof o[k] !== 'function') return; var f = o[k]; o[k] = F.wrapFn(lb, f); F.undo.push(function () { o[k] = f; }); }
    wrap('Grid.render', N.ui.Grid && N.ui.Grid.prototype, 'render');
    wrap('Grid.focus', N.ui.Grid && N.ui.Grid.prototype, 'focusTo');
    wrap('Row.render', N.ui.Row && N.ui.Row.prototype, 'render');
    wrap('Row.setModel', N.ui.Row && N.ui.Row.prototype, 'setModel');
    wrap('Hero.set', N.ui.Hero && N.ui.Hero.prototype, 'set');
    wrap('Hero.swap', N.ui.Hero && N.ui.Hero.prototype, '_swap');      // Hero-Bild sichtbar (1280x720 dekodieren + malen)
    wrap('Row.vis', N.ui.Row && N.ui.Row.prototype, 'setVisible');
    wrap('hints', N.router, 'refreshHints');
    wrap('ring', N.ui.Ring && N.ui.Ring.prototype, 'to');
    wrap('img.want', N.img, 'want');
    wrap('amb.apply', N.ui.Ambient && N.ui.Ambient.prototype, '_apply');   // Hintergrund in Bibliotheken: Ziel + PNG/URL + src
    wrap('amb.show', N.ui.Ambient && N.ui.Ambient.prototype, '_show');
    wrap('amb.png', N.amb, 'moodUrl');   // Anteil des Verlaufsbilds an amb.apply (Rest = img.src/Bild-URL)
    wrap('amb.src', N.ui.Ambient && N.ui.Ambient.prototype, '_src');   // Runde 5: davon die src-Zuweisung allein
    // Runde 5: Feinauswahl (Ziffern 9,8,1) und Schreiben (Dev-Protokoll ruht waehrend des Laufs; taucht es auf, ist es ein Fehler)
    var LV = N.ui.LoupeView && N.ui.LoupeView.prototype;
    wrap('Loupe.show', LV, 'show'); wrap('Loupe.point', LV, 'point'); wrap('Loupe.hide', LV, 'hide');
    wrap('Loupe.frames', LV, 'loadFrames'); wrap('Loupe.exact', LV, 'exact'); wrap('Loupe.played', LV, 'played');
    wrap('diag.flush', N.diag, 'flush'); wrap('store.flush', N.store, 'flush');
    var sT = W.setTimeout, raf = U.raf;
    F.sT = sT; F.raf = raf;
    /* perf3: teure Timer/rAF (>= 4 ms) zusaetzlich mit Code-Anfang benennen, damit man sie im Quelltext findet */
    function named(lb, f) {
      var w = F.wrapFn(lb, f);
      return function () {
        var t = pnow(); w.apply(this, arguments); var d = pnow() - t;
        if (d >= 4) { var src = String(f).replace(/\s+/g, ' '); F.add(lb + '<' + src.slice(src.indexOf('{') + 1, src.indexOf('{') + 45) + '>', d); }
      };
    }
    W.setTimeout = function (f, ms) { return sT.call(W, typeof f === 'function' ? named('timer', f) : f, ms); };
    U.raf = function (f) { return raf.call(U, named('raf', f)); };
    F.undo.push(function () { W.setTimeout = sT; U.raf = raf; });
  }
  Frames.prototype.key = function (k) {
    this.kn++; this.kl = typeof k === 'function' ? 'ptr' : String(k).charAt(0); this.since = 0;
    this.wrapFn(typeof k === 'function' ? 'ptr' : 'key ' + k, function () { press(k); })();
  };
  Frames.prototype.tick = function (t) {
    var F = this;
    if (F.mo && F.mo.takeRecords) F.mut += F.mo.takeRecords().length;
    if (F.last) {
      var d = t - F.last, im = imgN(), dc = decN(), fr = { d: d, js: F.js, mut: F.mut, img: im - F.img, dec: dc - F.dec, w: F.cur, k: F.kn ? F.kl + F.kn + '+' + F.since : '' };
      F.since++;
      F.n++; F.sum += d; F.sumJs += F.js; F.sumMut += F.mut; F.img = im; F.dec = dc;
      F.top.push(fr); F.top.sort(function (a, b) { return b.d - a.d; }); if (F.top.length > 5) F.top.pop();
      F.topJs.push(fr); F.topJs.sort(function (a, b) { return b.js - a.js; }); if (F.topJs.length > 3) F.topJs.pop();
    }
    F.last = t; F.cur = {}; F.js = 0; F.mut = 0;
  };
  Frames.prototype.end = function (name) {
    var F = this, r = function (v) { return Math.round(v * 10) / 10; }, n = Math.max(1, F.n);
    for (var i = F.undo.length - 1; i >= 0; i--) F.undo[i]();
    if (F.mo) F.mo.disconnect();
    function fmt(list) {
      var o = '';
      for (var i = 0; i < list.length; i++) {
        var fr = list[i], parts = [], ks = [];
        for (var k in fr.w) ks.push(k);
        ks.sort(function (a, b) { return fr.w[b] - fr.w[a]; });
        for (var j = 0; j < ks.length && j < 5; j++) if (fr.w[ks[j]] >= 0.05) parts.push(ks[j] + ' ' + r(fr.w[ks[j]]));
        o += ' [' + r(fr.d) + 'ms' + (fr.k ? ' @' + fr.k : '') + ' js ' + r(fr.js) + ' mut ' + fr.mut + (fr.img ? ' img ' + fr.img : '') + (fr.dec ? ' dec ' + fr.dec : '') + (parts.length ? ': ' + parts.join(', ') : '') + ']';
      }
      return o;
    }
    var out = 'frames ' + name + ': n ' + F.n + ', avg ' + r(F.sum / n) + 'ms (js ' + r(F.sumJs / n) + ', rest ' + r((F.sum - F.sumJs) / n) + '), mut/frame ' + r(F.sumMut / n) + ', dec ' + (F.dec - F.dec0) + ' | longest:';
    out += fmt(F.top) + ' | most js:' + fmt(F.topJs);
    return out;
  };

  function measure(name, keys, gap, done) {
    var my = run, m = new BM.Meter(), m2 = new BM.Meter(), on2 = true, i = 0, on = true, wk = my.work ? new Work() : null, fs = my.frames && !wk ? new Frames() : null;
    var sT = wk ? wk.sT : fs ? fs.sT : setTimeout, raf = wk ? wk.raf : fs ? fs.raf : U.raf;
    (function tick() { if (!on || run !== my) return; var t = U.now(); m.frame(t, imgN()); if (on2) m2.frame(t, imgN()); if (fs) fs.tick(fs && pnow !== U.now ? pnow() : t); raf.call(U, tick); })();
    function stop() { on = false; if (wk) wk.end(); if (fs) fs.end(name); }
    (function step() {
      if (run !== my || my.stop) { stop(); return; }
      if (i >= keys.length) {
        sT.call(window, function () { on2 = false; }, gap);   // perf2: zweite Wertung nur bis Tastenende (+1 Takt), ohne Ruhe-Arbeit (Hero, A–Z)
        sT.call(window, function () {
          if (run !== my || my.stop) { stop(); return; }
          on = false;
          var ws = wk ? wk.end() : null;
          var r2 = m2.result();
          log(BM.line(name, m.result(), { steps: keys.length, heap: heap(), dom: domCount() }) + ' | keys only: ' + r2.fps + ' fps, >50ms ' + r2.long + ', worst ' + r2.worst + 'ms' +
            (ws ? BM.workLine(ws, keys.length) : ''));
          if (fs) log(fs.end(name));
          done();
        }, 600);
        return;
      }
      if (wk) wk.key(keys[i++]); else if (fs) fs.key(keys[i++]); else press(keys[i++]);
      sT.call(window, step, gap);
    })();
  }
  function home() {
    R().closeAllOverlays();
    if (N.ui.rail.isOpen()) N.ui.rail.close(true);
    N.app.navigate('home');
  }
  function lib(type) {
    var l = N.ui.rail.libs || [];
    for (var i = 0; i < l.length; i++) if (l[i].type === type) return l[i];
    return null;
  }
  /* erstes Element einer Bibliothek (GET, lesend) */
  function first(type, cb) {
    var lb = lib(type);
    if (!lb) { cb(null); return; }
    N.plex.get('/library/sections/' + lb.id + '/all', { type: type === 'show' ? 2 : 1, sort: 'titleSort', 'X-Plex-Container-Start': 0, 'X-Plex-Container-Size': 1 }, null,
      function (err, d) { var l2 = !err && d && d.MediaContainer ? N.model.normList(d.MediaContainer.Metadata || [], null, lb.id) : []; cb(l2[0] || null); });
  }
  function skip(name, why, done) { log('bench ' + name + ': uebersprungen (' + why + ')'); done(); }

  /* name -> function(done) */
  var S = {};
  /* Runde 5 (TV 28.10.): Startseite bisher ab der zuletzt fokussierten Reihe – aus der letzten Reihe waren die ▼ wirkungslos (1 statt
   * 4 lange Frames), home-hero lief je nach Reihe ganz ohne Hero-Wechsel (66 fps) oder mit 8 (52,9 fps). Jetzt fester Ausgangspunkt. */
  function homeBench() { var t = R().top(); return R().topName() === 'home' && t && t.bench ? t.bench : null; }
  S.home = function (done, label) {
    home();
    later(300, function () {
      var hb = homeBench();
      if (hb) { hb.top(); log('bench ' + (label || 'home') + ' start: Reihe 0, Karten je Reihe ' + hb.counts().join('/')); }
      later(2500, function () { measure(label || 'home', BM.keys('R12 D R8 D R8 U U D'), GAP, done); });
    });
  };
  /* home-hero: erste Reihe mit >= 9 Karten (sonst die laengste), damit jeder der 8 Schritte den Hero wirklich wechselt */
  S['home-hero'] = function (done) {
    home();
    later(300, function () {
      var hb = homeBench(), c = hb ? hb.counts() : [], r = -1, i;
      for (i = 0; i < c.length && r < 0; i++) if (c[i] >= 9) r = i;
      if (r < 0) for (i = 0; i < c.length; i++) if (r < 0 || c[i] > c[r]) r = i;
      if (hb) hb.top();
      var n = Math.max(0, r);
      (function down() {
        if (n-- > 0) { later(400, function () { R().key('DOWN'); down(); }); return; }
        if (hb) log('bench home-hero start: Reihe ' + hb.row() + ' (' + (c[hb.row()] || 0) + ' Karten)');
        later(2500, function () { measure('home-hero', BM.keys('R8'), 450, done); });
      })();
    });
  };
  ['L', 'M', 'S', 'list'].forEach(function (v) {
    S['lib-' + v] = function (done, label) {
      var lb = lib('movie') || lib('show');
      if (!lb) { skip('lib-' + v, 'keine Bibliothek', done); return; }
      home(); R().push('library', { lib: lb, view: v });
      later(3000, function () { measure(label || 'lib-' + v, BM.keys('R3 D12 R U6 D12'), GAP, function () { R().back(); later(800, done); }); });
    };
  });
  /* perf2: Haeppchen-Groesse am TV vergleichen ('chunks' = Klein/Mittel mit 1, 3, 9 Karten je Frame; nicht in 'all') */
  var CHUNKS = [];
  function variant(nm, base, on, off) {
    CHUNKS.push(nm);
    S[nm] = function (done) { on(); S[base](function () { off(); done(); }, nm); };
  }
  ['S', 'M'].forEach(function (v) {
    [1, 2, 3].forEach(function (c) {
      var G = N.ui.Grid, Rw = N.ui.Row, old;
      variant('chunk-' + v + c, 'lib-' + v,
        function () { old = [G.CHUNK, G.CHUNK_FAST, Rw.CHUNK, Rw.CHUNK_FAST]; G.CHUNK = G.CHUNK_FAST = Rw.CHUNK = Rw.CHUNK_FAST = c; },
        function () { G.CHUNK = old[0]; G.CHUNK_FAST = old[1]; Rw.CHUNK = old[2]; Rw.CHUNK_FAST = old[3]; });
    });
  });
  /* perf3: Beschriftungen sind Standard eigene GPU-Ebenen; Gegenprobe 'nocapl' = ohne (Klasse nocapl am body, Stand perf2) */
  ['lib-S', 'lib-M', 'lib-L', 'home'].forEach(function (b) {
    variant('nocapl-' + b.replace('lib-', ''), b, function () { U.cls(document.body, 'nocapl', true); }, function () { U.cls(document.body, 'nocapl', false); });
  });
  /* Hintergrund in Bibliotheken (ui/ambient.js): Raster mit Hintergrund Aus/Farbstimmung/Titelbild (Kosten der Ebenen beim Scrollen,
   * Wechsel erst nach 600 ms Ruhe -> im 160-ms-Takt nie) und amb-fade-* mit 900 ms Takt (jeder Schritt loest nach 600 ms Ruhe einen
   * Wechsel samt 400-ms-Ueberblendung aus; die naechste Taste faellt in die Blende). Einstellung nur im Speicher, danach zurueck. */
  function ambVariant(nm, base, mode, str) {
    var old;
    variant(nm, base, function () { var st = N.session.settings || {}; old = [st.libBg, st.libBgStrength]; st.libBg = mode; st.libBgStrength = str || 'soft'; },
      function () { var st = N.session.settings || {}; st.libBg = old[0]; st.libBgStrength = old[1]; });
  }
  ['M', 'S', 'list'].forEach(function (v) { ['off', 'mood', 'art'].forEach(function (m) { ambVariant('amb-' + m + '-' + v, 'lib-' + v, m); }); });
  ['mood', 'art'].forEach(function (m) {
    S['ambfade-' + m] = function (done, label) {
      var lb = lib('movie') || lib('show');
      if (!lb) { skip(label, 'keine Bibliothek', done); return; }
      home(); R().push('library', { lib: lb, view: 'M' });
      later(3000, function () { measure(label, BM.keys('R4 D R4 D L4'), 900, function () { R().back(); later(800, done); }); });
    };
    ambVariant('amb-fade-' + m, 'ambfade-' + m, m);
  });
  ['movie', 'show'].forEach(function (t) {
    S['details-' + t] = function (done) {
      first(t, function (it) {
        if (!it) { skip('details-' + t, 'kein Titel', done); return; }
        home(); R().push('details', { it: it });
        later(3000, function () { measure('details-' + t, BM.keys('D5 R6 D2 R4 U9'), GAP, function () { R().back(); later(800, done); }); });
      });
    };
  });
  S.search = function (done) {
    first('movie', function (it) {
      var w = it ? String(it.title || '').split(' ')[0].slice(0, 4) : 'a';
      home(); R().push('search', { q: w.length >= 2 ? w : 'the' });
      later(3000, function () { measure('search', BM.keys('R10 D3 R6 U3 D3'), GAP, function () { R().back(); later(800, done); }); });
    });
  };
  /* TV-Test 28.10.: Entdecken leer (Merkliste + Inspirations-Reihen), Tastatur -> Reihen, dann ▼/▲ ueber die Reihen */
  S.discover = function (done) {
    if (!N.disc || !N.disc.enabled()) { skip('discover', 'Entdecken aus', done); return; }
    home(); R().push('discover');
    later(5000, function () { measure('discover', BM.keys('R10 D6 U3 D3'), GAP, function () { R().back(); later(800, done); }); });
  };
  S['player-osd'] = function (done) {
    first('movie', function (it) {
      if (!it) { skip('player-osd', 'kein Film', done); return; }
      var ro = N.config.readOnly;
      N.config.readOnly = true;                       // keine Timeline/Spurwahl an den Server
      home(); N.player.open(it, 0);
      later(6000, function () {
        measure('player-osd', BM.keys('U R4 L4 R4 L4 R4 L4'), 250, function () {
          if (R().topName() === 'player') R().key('STOP');
          later(1500, function () { N.config.readOnly = ro; done(); });
        });
      });
    });
  };
  /* Feinauswahl (SPEC PLAY-30): Smart-Control-Zeiger nachgestellt (N.pointer.move im 40-ms-Takt = Drossel des Zeigers): auf den Balken,
   * 1 s ruhig mit kleinsten Bewegungen (Finger auf dem Touchpad) -> oeffnet nach 700 ms, dann 2x quer durch das Fenster (10 px je Schritt),
   * nach oben weg (y 250: ueber jeder Lasche); zweimal. Misst fps/lange Frames und (work/frames) die Arbeit je Zeigerschritt. */
  function loupeSteps() {
    var out = [], i, x;
    function mv(px, py) { out.push(function () { N.pointer.move(px, py); }); }
    for (var round = 0; round < 2; round++) {
      mv(640, 300); mv(700, 486);
      for (i = 0; i < 25; i++) mv(700 + (i % 2), 486);
      for (x = 700; x <= 880; x += 10) mv(x, 486 + (x % 20 ? 0 : 8));
      for (x = 880; x >= 420; x -= 10) mv(x, 494);
      for (x = 420; x <= 700; x += 10) mv(x, 486);
      mv(700, 250);
    }
    return out;
  }
  function loupeRun(name, style) {
    return function (done) {
      if (!N.pointer.enabled()) { skip(name, 'Zeiger-Steuerung aus', done); return; }
      first('movie', function (it) {
        if (!it) { skip(name, 'kein Film', done); return; }
        var ro = N.config.readOnly, st = N.session.settings || {}, old = st.ptrLoupe, oldS = st.loupeStyle;
        N.config.readOnly = true; st.ptrLoupe = true; st.loupeStyle = style;   // nur im Speicher, danach zurueck
        home(); N.player.open(it, 0);
        later(6000, function () {
          measure(name, loupeSteps(), 40, function () {
            st.ptrLoupe = old; st.loupeStyle = oldS;
            if (R().topName() === 'player') R().key('STOP');
            later(1500, function () { N.config.readOnly = ro; done(); });
          });
        });
      });
    };
  }
  S.loupe = loupeRun('loupe', 'panel');
  S['loupe-stretch'] = loupeRun('loupe-stretch', 'stretch');
  S['loupe-film'] = loupeRun('loupe-film', 'film');
  /* Langzeit: Ansichten wiederholt oeffnen/schliessen; Schnappschuss nach einer Aufwaermrunde und am Ende */
  S.leak = function (done) {
    var CYC = run.cycles || 10, c = 0, before = null, mv = null, sh = null;
    var steps = [
      function (n) { if (mv) R().push('details', { it: mv }); later(1500, function () { if (mv) R().back(); later(400, n); }); },
      function (n) { if (sh) R().push('details', { it: sh }); later(1500, function () { if (sh) R().back(); later(400, n); }); },
      function (n) { var lb = lib('movie') || lib('show'); if (lb) R().push('library', { lib: lb }); later(1800, function () { if (lb) R().key('DOWN'); later(300, function () { if (lb) R().back(); later(400, n); }); }); },
      function (n) { R().push('search', { q: mv ? String(mv.title).slice(0, 3) : 'ab' }); later(1500, function () { R().back(); later(400, n); }); },
      function (n) { R().push('settings', {}); later(900, function () { R().back(); later(400, n); }); },
      function (n) { var lb = lib('artist'); if (lb) R().push('library', { lib: lb }); later(1500, function () { if (lb) R().back(); later(400, n); }); },
      function (n) {                                         // Player (readOnly erzwungen) oeffnen und mit STOP schliessen
        if (!mv) { n(); return; }
        var ro = N.config.readOnly; N.config.readOnly = true;
        N.player.open(mv, 0);
        later(3000, function () { if (R().topName() === 'player') R().key('STOP'); later(1200, function () { N.config.readOnly = ro; n(); }); });
      }
    ];
    function cycle(n) {
      var k = 0;
      (function next() { if (k >= steps.length) { n(); return; } steps[k++](next); })();
    }
    first('movie', function (a) { mv = a; first('show', function (b) {
      sh = b; home();
      later(1500, function () {
        cycle(function () {                                  // Aufwaermrunde (Caches, LRU fuellen)
          later(1500, function () {
            before = snap();
            (function loop() {
              if (c++ >= CYC) {
                later(2500, function () { var r = BM.leaks(before, snap(), CYC); if (r.ok) log(r.line); else N.diag.log('warn', r.line); done(); });
                return;
              }
              cycle(loop);
            })();
          });
        });
      });
    }); });
  };
  /* Bildschirmschoner ('saver' = alle Uebergaenge, 'saver-zoom' = einer; nicht in 'all'): Schoner mit festem Uebergang ueber der
   * Startseite (realistisch: deren Ebenen werden mit zusammengesetzt), warten bis das 2. Bild geladen und gezeichnet ist, dann fps
   * waehrend des Uebergangs (+ Vorbereitung); bei Zoom/Gleiten zusaetzlich 3 s Dauerbewegung ('saver-zoom-hold'). */
  function measureFor(name, ms, done) {
    var my = run, m = new BM.Meter(), on = true, fs = my.frames ? new Frames() : null, raf = fs ? fs.raf : U.raf, sT = fs ? fs.sT : setTimeout;
    (function tick() { if (!on || run !== my) return; var t = U.now(); m.frame(t, imgN()); if (fs) fs.tick(pnow !== U.now ? pnow() : t); raf.call(U, tick); })();
    sT.call(window, function () {
      on = false;
      if (run !== my || my.stop) { if (fs) fs.end(name); return; }
      log(BM.line(name, m.result(), { steps: 0, heap: heap(), dom: domCount() }));
      if (fs) log(fs.end(name));
      done();
    }, ms);
  }
  /* Schoner-Uebergang: Wertung von go() (Vorbereitung: Teile anlegen, Info-Block ausblenden + umsetzen) bis 900 ms nach dem Uebergang
   * (Tausch, Aufraeumen) und getrennt '| transition only' = nur der sichtbare Uebergang (Beginn bis Ende, Schnitt: 1 Frame danach) */
  function measureSaver(name, go, done) {
    var my = run, m = new BM.Meter(), m2 = null, r2 = null, on = true, fs = my.frames ? new Frames() : null, raf = fs ? fs.raf : U.raf, sT = fs ? fs.sT : setTimeout;
    (function tick() {
      if (!on || run !== my) return;
      var t = U.now(), im = imgN();
      m.frame(t, im); if (m2) m2.frame(t, im);
      if (fs) fs.tick(pnow !== U.now ? pnow() : t);
      raf.call(U, tick);
    })();
    var guard = sT.call(window, function () { finish(); }, 8000);   // Uebergang begann nie (Schoner beendet) -> trotzdem weiter
    function finish() {
      if (!on) return;
      on = false;
      if (run !== my || my.stop) { if (fs) fs.end(name); return; }
      var t = r2 || (m2 ? m2.result() : null);
      log(BM.line(name, m.result(), { steps: 0, heap: heap(), dom: domCount() }) +
        (t ? ' | transition only: ' + t.fps + ' fps, >50ms ' + t.long + ', worst ' + t.worst + 'ms' : ' | transition only: n/a'));
      if (fs) log(fs.end(name));
      done();
    }
    go(function (d) {
      clearTimeout(guard);
      m2 = new BM.Meter();
      sT.call(window, function () { r2 = m2.result(); m2 = null; }, Math.max(d, 50));
      sT.call(window, finish, d + 900);
    });
  }
  var SAVERS = [];
  N.saverLogic.FX.forEach(function (fx) {
    if (fx === 'random') return;
    SAVERS.push('saver-' + fx);
    S['saver-' + fx] = function (done) {
      var Sv = N.ui.saver;
      function end() { Sv.stop(); later(800, done); }
      home();
      later(1500, function () {
        Sv.bench(fx, function (go) {
          if (!go) { log('bench saver-' + fx + ': uebersprungen (kein Bild)'); end(); return; }
          measureSaver('saver-' + fx, go, function () {
            if (fx === 'zoom' || fx === 'drift') measureFor('saver-' + fx + '-hold', 3000, end); else end();
          });
        });
      });
    };
  });
  var NAMES = ['home', 'home-hero', 'lib-L', 'lib-M', 'lib-S', 'lib-list', 'details-movie', 'details-show', 'search', 'discover', 'player-osd', 'loupe', 'loupe-stretch', 'loupe-film', 'leak'].concat(CHUNKS, SAVERS);

  function waitHome(my, tries, fn) {
    if (run !== my || my.stop) return;
    if (R().topName() === 'home' && (N.ui.rail.libs || []).length) { fn(); return; }
    if (tries <= 0) { log('bench: Startseite nicht bereit – Abbruch'); run = null; N.diag.hold = false; return; }
    setTimeout(function () { waitHome(my, tries - 1, fn); }, 500);
  }
  var B = {
    running: function () { return !!run; },
    start: function (spec) {
      if (run) return;
      var list = BM.pick(spec, NAMES), cyc = /(^|,)leak:(\d+)/.exec(String(spec || ''));
      if (!list.length) { log('bench: keine Szenarien fuer "' + spec + '"'); return; }
      trackTimers();
      run = { list: list, i: 0, t0: U.now(), cycles: cyc ? Number(cyc[2]) : 10, work: /(^|,)\s*work\s*(,|$)/.test(String(spec || '')),
        frames: /(^|,)\s*frames\s*(,|$)/.test(String(spec || '')) };
      var my = run;
      log('bench start: ' + list.join(','));
      N.diag.hold = true;                              // Dev-Protokoll erst nach dem Lauf in die Datei (core/log.js)
      if (N.ui.toast) N.ui.toast.show('Messlauf: ' + list.length + ' Szenarien');
      waitHome(my, 60, function () {
        (function next() {
          if (run !== my || my.stop) return;
          if (my.i >= my.list.length) { log('bench done in ' + Math.round((U.now() - my.t0) / 1000) + 's'); run = null; N.diag.hold = false; home(); return; }
          var name = my.list[my.i++];
          try { S[name](next); } catch (e) { log('bench ' + name + ' Fehler ' + e.message); next(); }
        })();
      });
    },
    stop: function () { if (!run) return; run.stop = true; run = null; N.diag.hold = false; log('bench abgebrochen'); },
    /* echte Tasten: waehrend des Laufs nur RETURN/EXIT (Abbruch); sonst Ziffernfolge 9,8,7 erkennen. true = verbraucht */
    key: function (k) {
      if (run) { if (k === 'RETURN') B.stop(); return true; }
      // perf2: dritte Ziffer waehlt den Lauf: 7 = alles (wie bisher), 6 = home,lib mit Frame-Protokoll, 5 = Varianten chunk (1/2/3) und nocapl mit Frame-Protokoll,
      // 4 = Bildschirmschoner, 3 = Hintergrund in Bibliotheken (amb-off/mood/art je Ansicht M/S/Liste, amb-fade-mood/art) mit Frame-Protokoll
      // 2 = Entdecken (▼ ueber Merkliste/Inspirations-Reihen) mit Frame-Protokoll
      // 1 = Feinauswahl (loupe, loupe-stretch, loupe-film; Video mit Ton) mit Frame-Protokoll
      var LAST = { '7': 'all', '6': 'home,lib,frames', '5': 'chunk,nocapl,frames', '4': 'saver,frames', '3': 'amb,frames', '2': 'discover,frames', '1': 'loupe,frames' };   // 4: Bildschirmschoner-Uebergaenge, 3: Hintergrund in Bibliotheken
      if (seq === SEQ.length - 1 && LAST[k] && U.now() - seqT < SEQ_MS) { seq = 0; B.start(LAST[k]); return true; }
      if (k === SEQ[seq] && (seq === 0 || U.now() - seqT < SEQ_MS)) { seq++; seqT = U.now(); if (seq === SEQ.length) { seq = 0; B.start('all'); return true; } }
      else seq = k === SEQ[0] ? 1 : 0;
      if (seq) seqT = U.now();
      return false;
    },
    /* aus N.devperf.init: automatischer Start (window.PN_BENCH) */
    init: function () {
      var spec = window.PN_BENCH;
      if (spec) setTimeout(function () { B.start(String(spec)); }, 1500);
    },
    _scenarios: NAMES
  };
  N.devbench = B;
})(N);
