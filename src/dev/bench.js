/* N.devbench – app-interner Messlauf (P7, docs/P7-TV-TEST.md). Nur im Entwicklungs-Build (dev/ fehlt in app.min.js) und nur bei
 * ctx.source = dev… (N.devperf.enabled). Die Netzwerk-Fernbedienung verschluckt schnelle Tastenfolgen (TV-BEFUNDE) -> die App
 * drueckt die Tasten selbst (N.router.key im festen Takt) und misst per rAF.
 * Start: Ziffernfolge 9,8,7 auf der Fernbedienung (je < 4 s Abstand) | window.PN_BENCH = 'all' | 'home,lib,leak' (tools/dev.py serve
 * --bench …, Vorschau &bench=…). RETURN/EXIT bricht ab. Ergebnis: je Szenario eine Zeile "bench <name>: …" im Protokoll (ctx.log).
 * Szenarien: home, home-hero, lib-L/M/S/list, details-movie, details-show, search, player-osd (readOnly erzwungen, keine
 * Fortschritts-/Spur-Schreibzugriffe), leak (Details Film/Serie, Bibliothek, Suche, Einstellungen, Musik, Player je Runde
 * oeffnen/schliessen, Standard 10 Runden, 'leak:20'; nur auf Wunsch: 'leak' bzw. 'all,leak'). */
(function (N) {
  var U = N.util, BM = N.benchMath, GAP = 160, SEQ = ['9', '8', '7'], SEQ_MS = 4000;
  var run = null, seq = 0, seqT = 0, tm = null;

  function R() { return N.router; }
  function log(m) { N.log(m); }
  function heap() { try { var p = window.performance; return p && p.memory ? p.memory.usedJSHeapSize : 0; } catch (e) { return 0; } }
  function domCount() { return document.getElementsByTagName('*').length; }
  function imgN() { var s = N.img._stats(); return (s.sets || 0) + (s.loads || 0); }

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
    var t = pnow(); R().key(k); var d = pnow() - t, l = flushT();
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
    F.cur = {}; F.js = 0; F.mut = 0; F.top = []; F.topJs = []; F.n = 0; F.sum = 0; F.sumJs = 0; F.sumMut = 0; F.last = 0; F.img = imgN(); F.undo = [];
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
    wrap('hints', N.router, 'refreshHints');
    wrap('ring', N.ui.Ring && N.ui.Ring.prototype, 'to');
    wrap('img.want', N.img, 'want');
    var sT = W.setTimeout, raf = U.raf;
    F.sT = sT; F.raf = raf;
    W.setTimeout = function (f, ms) { return sT.call(W, typeof f === 'function' ? F.wrapFn('timer', f) : f, ms); };
    U.raf = function (f) { return raf.call(U, F.wrapFn('raf', f)); };
    F.undo.push(function () { W.setTimeout = sT; U.raf = raf; });
  }
  Frames.prototype.key = function (k) { this.wrapFn('key ' + k, function () { R().key(k); })(); };
  Frames.prototype.tick = function (t) {
    var F = this;
    if (F.mo && F.mo.takeRecords) F.mut += F.mo.takeRecords().length;
    if (F.last) {
      var d = t - F.last, im = imgN(), fr = { d: d, js: F.js, mut: F.mut, img: im - F.img, w: F.cur };
      F.n++; F.sum += d; F.sumJs += F.js; F.sumMut += F.mut; F.img = im;
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
        o += ' [' + r(fr.d) + 'ms js ' + r(fr.js) + ' mut ' + fr.mut + (fr.img ? ' img ' + fr.img : '') + (parts.length ? ': ' + parts.join(', ') : '') + ']';
      }
      return o;
    }
    var out = 'frames ' + name + ': n ' + F.n + ', avg ' + r(F.sum / n) + 'ms (js ' + r(F.sumJs / n) + ', rest ' + r((F.sum - F.sumJs) / n) + '), mut/frame ' + r(F.sumMut / n) + ' | longest:';
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
      if (wk) wk.key(keys[i++]); else if (fs) fs.key(keys[i++]); else R().key(keys[i++]);
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
  S.home = function (done, label) { home(); later(2500, function () { measure(label || 'home', BM.keys('R12 D R8 D R8 U U D'), GAP, done); }); };
  S['home-hero'] = function (done) { home(); later(1500, function () { measure('home-hero', BM.keys('R8'), 450, done); }); };
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
    [1, 3, 9].forEach(function (c) {
      var G = N.ui.Grid, Rw = N.ui.Row, old;
      variant('chunk-' + v + c, 'lib-' + v,
        function () { old = [G.CHUNK, G.CHUNK_FAST, Rw.CHUNK, Rw.CHUNK_FAST]; G.CHUNK = G.CHUNK_FAST = Rw.CHUNK = Rw.CHUNK_FAST = c; },
        function () { G.CHUNK = old[0]; G.CHUNK_FAST = old[1]; Rw.CHUNK = old[2]; Rw.CHUNK_FAST = old[3]; });
    });
  });
  /* perf2: Beschriftungen als eigene GPU-Ebene (Klasse capl am body): Text-Aenderung malt dann nur die kleine Ebene neu statt des
   * grossen Seiten-Containers – kostet dafuer mehr Ebenen. 'capl' = lib-S/M/L + home mit dieser Variante */
  ['lib-S', 'lib-M', 'lib-L', 'home'].forEach(function (b) {
    variant('capl-' + b.replace('lib-', ''), b, function () { U.cls(document.body, 'capl', true); }, function () { U.cls(document.body, 'capl', false); });
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
  var NAMES = ['home', 'home-hero', 'lib-L', 'lib-M', 'lib-S', 'lib-list', 'details-movie', 'details-show', 'search', 'player-osd', 'leak'].concat(CHUNKS);

  function waitHome(my, tries, fn) {
    if (run !== my || my.stop) return;
    if (R().topName() === 'home' && (N.ui.rail.libs || []).length) { fn(); return; }
    if (tries <= 0) { log('bench: Startseite nicht bereit – Abbruch'); run = null; return; }
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
      if (N.ui.toast) N.ui.toast.show('Messlauf: ' + list.length + ' Szenarien');
      waitHome(my, 60, function () {
        (function next() {
          if (run !== my || my.stop) return;
          if (my.i >= my.list.length) { log('bench done in ' + Math.round((U.now() - my.t0) / 1000) + 's'); run = null; home(); return; }
          var name = my.list[my.i++];
          try { S[name](next); } catch (e) { log('bench ' + name + ' Fehler ' + e.message); next(); }
        })();
      });
    },
    stop: function () { if (!run) return; run.stop = true; run = null; log('bench abgebrochen'); },
    /* echte Tasten: waehrend des Laufs nur RETURN/EXIT (Abbruch); sonst Ziffernfolge 9,8,7 erkennen. true = verbraucht */
    key: function (k) {
      if (run) { if (k === 'RETURN') B.stop(); return true; }
      // perf2: dritte Ziffer waehlt den Lauf: 7 = alles (wie bisher), 6 = home,lib mit Frame-Protokoll, 5 = Varianten chunk/capl mit Frame-Protokoll
      var LAST = { '7': 'all', '6': 'home,lib,frames', '5': 'chunk,capl,frames' };
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
