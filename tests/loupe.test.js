'use strict';
/* Feinauswahl am Fortschrittsbalken (N.Loupe, SPEC PLAY-30): Spanne/Klemmen, verankerte Abbildung, Hysterese, Rasten an
 * Kapitelgrenzen, Verweilen (Ruhe, Lebenszeichen, Sperre nach dem Schliessen), Verlassen, Abhaengigkeit der Einstellung */
var test = require('node:test'), assert = require('node:assert');
var H = require('./helpers/load');

var BAR = { x: 96, w: 1088 }, BAND = { top: 453, bottom: 530 }, MIN = 60000, HOUR = 3600000;
function L() { return H.load({ fakeTimers: true }); }

test('Spanne: +-4 % der Dauer, geklemmt auf 1–5 Min.; aus, wenn der grobe Balken schon fein genug ist', function () {
  var Lp = L().N.Loupe;
  assert.strictEqual(Lp.half(2 * HOUR, BAR.w), 288000);          // 2-h-Film: +-4:48
  assert.strictEqual(Lp.half(4 * HOUR, BAR.w), 300000);          // lang: hoechstens +-5 Min.
  assert.strictEqual(Lp.half(20 * MIN, BAR.w), 60000);           // 20-Min.-Folge: mindestens +-1 Min.
  assert.strictEqual(Lp.half(15 * MIN, BAR.w), 0);               // < 1 s je Pixel: grober Balken reicht
  assert.strictEqual(Lp.half(4 * MIN, 536), 0);                  // Musiktitel in Jetzt laeuft: aus
  assert.strictEqual(Lp.half(10 * MIN, 536), 60000);             // langer Titel / Hoerbuch-Kapitel: an
  assert.strictEqual(Lp.half(0, BAR.w), 0);
});

test('Abbildung: Ruhestelle behaelt ihre Zeit (kein Sprung), linear im Fenster, Fenster am Balken geklemmt', function () {
  var Lp = L().N.Loupe, d = 2 * HOUR, h = Lp.half(d, BAR.w);
  [96, 120, 300, 640, 1000, 1170, 1184].forEach(function (x) {
    var g = Lp.geom({ x: x, barX: BAR.x, barW: BAR.w, dur: d, w: 480, h: h });
    assert.ok(Math.abs(Lp.at(g, x) - d * (x - 96) / 1088) < 1, 'x ' + x);   // Anzeige springt beim Oeffnen nicht
    assert.ok(g.L >= 96 && g.L + g.w <= 1184, 'Fenster im Balken bei x ' + x);
    assert.ok(Lp.at(g, g.L) >= 0 && Lp.at(g, g.L + g.w) <= d);
  });
  var g = Lp.geom({ x: 640, barX: 96, barW: 1088, dur: d, w: 480, h: h });
  assert.strictEqual(g.L, 400);
  assert.strictEqual(g.spp, 1200);                                 // 1,2 s je Pixel statt 6,6 s
  assert.strictEqual(Lp.at(g, 640 + 100) - Lp.at(g, 640), 120000); // 100 px = 2 Min.
  assert.strictEqual(Lp.at(g, 2000), Lp.at(g, g.L + g.w));         // ueber das Ende hinaus: haftet am Ende
  var e = Lp.geom({ x: 100, barX: 96, barW: 1088, dur: d, w: 480, h: h });
  assert.strictEqual(e.L, 96);
});

test('Genauigkeit: Zittern +-8 px -> 2-h-Film unter +-10 s (grob: +-53 s), 45-Min.-Folge unter +-4 s', function () {
  var Lp = L().N.Loupe;
  function err(d) { var g = Lp.geom({ x: 640, barX: 96, barW: 1088, dur: d, w: 480, h: Lp.half(d, 1088) }); return (Lp.at(g, 648) - Lp.at(g, 640)) / 1000; }
  assert.ok(err(2 * HOUR) <= 10);
  assert.ok(err(45 * MIN) <= 4);
  assert.ok(2 * HOUR / 1088 * 8 / 1000 > 50);
});

test('Teilstriche je Spanne, Kapitelgrenzen und Marker im Fenster', function () {
  var Lp = L().N.Loupe, g = Lp.geom({ x: 640, barX: 96, barW: 1088, dur: 2 * HOUR, w: 480, h: 288000 });
  var t = Lp.ticks(g), maj = t.filter(function (k) { return k.major; });
  H.eq(Lp.tickStep(576000), { minor: 30000, major: 60000 });
  H.eq(Lp.tickStep(120000), { minor: 10000, major: 30000 });
  assert.ok(t.length >= 18 && t.length <= 21);
  assert.ok(maj.length >= 9 && maj.length <= 10);
  t.forEach(function (k) { assert.ok(k.x >= g.L && k.x <= g.L + g.w); });
  var chs = [{ start: 0 }, { start: g.t0 + 60000 }, { start: g.t0 + 20 * MIN }];
  var m = Lp.marks(g, chs);
  assert.strictEqual(m.length, 1);
  assert.strictEqual(m[0].x, 690);
  var sg = Lp.segs(g, [{ startTimeOffset: g.t0 - 30000, endTimeOffset: g.t0 + 30000 }, { startTimeOffset: 0, endTimeOffset: 1000 }]);
  H.eq(sg, [{ x: 615, w: 50 }]);
});

test('Hysterese (3 px), Sekunden, Einrasten an einer Kapitelgrenze (6 px)', function () {
  var N = L().N, Lp = N.Loupe, lp = new Lp({ timers: { now: Date.now, set: function () { return 1; }, clear: function () {} }, ok: function () { return true; }, live: function () { return true; }, pos: function () { return { x: 0, y: 0 }; }, open: function () {} });
  var g = Lp.geom({ x: 640, barX: 96, barW: 1088, dur: 2 * HOUR, w: 480, h: 288000 });
  lp.open(g, [{ start: 0 }, { start: g.t0 + 120000 }]);
  var a = lp.move(640, 486, BAND);
  assert.strictEqual(a.ms % 1000, 0);
  assert.strictEqual(lp.move(642, 470, BAND).ms, a.ms);           // senkrecht gewandert, 2 px seitlich: Anzeige bleibt
  assert.notStrictEqual(lp.move(644, 486, BAND).ms, a.ms);
  var s = lp.move(744, 486, BAND);                                 // Kapitelgrenze bei x 740 (+2 Min.)
  assert.strictEqual(s.ms, g.t0 + 120000); assert.strictEqual(s.x, 740);
  assert.notStrictEqual(lp.move(760, 486, BAND).ms, g.t0 + 120000);
});

function rig(o) {
  var ctx = L(), N = ctx.N, T = ctx.timers, st = { ok: true, live: true, p: { x: 640, y: 486 }, opened: 0 };
  var lp = new N.Loupe({ timers: { now: T.now, set: T.setTimeout, clear: T.clearTimeout }, ok: function () { return st.ok; }, live: function () { return st.live; },
    pos: function () { return st.p; }, open: function (x, y) { st.opened++; lp.open(N.Loupe.geom({ x: x, barX: 96, barW: 1088, dur: 2 * HOUR, w: 480, h: 288000 })); } });
  function at(x, y) { st.p = { x: x, y: y }; lp.track(x, y); }
  return { N: N, T: T, st: st, lp: lp, at: at };
}

test('Verweilen: 700 ms ruhig (< 8 px) oeffnet; Wandern am Balken nie', function () {
  var r = rig();
  r.at(640, 486); r.T.tick(400); r.at(645, 488); r.T.tick(299);    // 7 px: zaehlt als Ruhe
  assert.strictEqual(r.st.opened, 0);
  r.T.tick(1); assert.strictEqual(r.st.opened, 1); assert.ok(r.lp.isOpen());
  var w = rig();
  for (var i = 0; i < 40; i++) { w.at(200 + i * 12, 486); w.T.tick(100); }   // langsames Entlangfahren (120 px/s)
  assert.strictEqual(w.st.opened, 0);
  w.T.tick(700); assert.strictEqual(w.st.opened, 1);               // erst beim Anhalten
});

test('Verweilen: kein Oeffnen ohne Finger auf dem Touchpad, bei gesperrter Lage, nach Verlassen des Balkens', function () {
  var r = rig();
  r.st.live = false; r.at(640, 486); r.T.tick(800); assert.strictEqual(r.st.opened, 0);   // Punkt steht nur noch (Finger weg)
  var k = rig(); k.st.ok = false; k.at(640, 486); k.T.tick(800); assert.strictEqual(k.st.opened, 0);   // Einstellung aus / Sprung offen / Panel
  var l = rig(); l.at(640, 486); l.T.tick(300); l.lp.leave(); l.T.tick(800); assert.strictEqual(l.st.opened, 0);
  var m = rig(); m.at(640, 486); m.T.tick(300); m.st.p = { x: 660, y: 486 }; m.T.tick(500); assert.strictEqual(m.st.opened, 0);   // unter der Zitterschwelle weitergewandert
});

test('Taste/Klick sperren das Verweilen bis zu einer deutlichen Bewegung', function () {
  var r = rig();
  r.at(640, 486); r.T.tick(300); r.lp.cancel(); r.T.tick(1000);
  assert.strictEqual(r.st.opened, 0);
  r.at(644, 486); r.T.tick(1000); assert.strictEqual(r.st.opened, 0);   // nur Zittern: bleibt gesperrt
  r.at(660, 486); r.T.tick(700); assert.strictEqual(r.st.opened, 1);
});

test('Verlassen: oben/unten aus dem Band, seitlich > 24 px, Klick setzt das Ziel; danach kein Wiederoeffnen am selben Fleck', function () {
  var r = rig(); r.at(640, 486); r.T.tick(700);
  H.eq(r.lp.move(640, 452, BAND), { exit: 'up' });
  assert.ok(!r.lp.isOpen());
  r.at(640, 452); r.T.tick(2000); assert.strictEqual(r.st.opened, 1);    // ruht dort weiter: kein neues Oeffnen
  var d = rig(); d.at(640, 486); d.T.tick(700); assert.strictEqual(d.lp.move(640, 530, BAND).exit, 'down');   // Knopfreihe
  var s = rig(); s.at(640, 486); s.T.tick(700);
  assert.ok(s.lp.move(900, 486, BAND).ms > 0);                     // 20 px hinter dem Ende: haftet
  assert.strictEqual(s.lp.move(905, 486, BAND).exit, 'side');
  var c = rig(); c.at(640, 486); c.T.tick(700);
  var ms = c.lp.click(700, 490, BAND);
  assert.strictEqual(ms, Math.round(c.N.Loupe.at(c.lp.g || c.N.Loupe.geom({ x: 640, barX: 96, barW: 1088, dur: 2 * HOUR, w: 480, h: 288000 }), 700) / 1000) * 1000);
  assert.ok(!c.lp.isOpen());
  c.at(700, 490); c.T.tick(2000); assert.strictEqual(c.st.opened, 1);
  // Wiederauflegen des Fingers: der TV setzt den Punkt in die Bildmitte (640, 360) -> liegt ueber dem Band -> zu
  var t = rig(); t.at(640, 486); t.T.tick(700); assert.strictEqual(t.lp.move(640, 360, BAND).exit, 'up');
});

test('Schutzzone: Band bis unter die Knopfreihe, dort kein seitliches Verlassen; Klick in der Knopfreihe setzt das feine Ziel', function () {
  // Video: Balken y 485 (Treffer 469–501), Zeiten 500–526, Knopfreihe-Treffer 530–594, Insel-Unterkante 638 (TV-Befund 28.10.)
  var G = { top: 453, bottom: 638, side: 501 };
  var r = rig(); r.at(640, 486); r.T.tick(700);
  [494, 506, 530, 560, 594, 637].forEach(function (y) { assert.ok(!r.lp.move(640 + (y % 3), y, G).exit, 'bleibt offen bei y ' + y); });
  for (var x = 660; x < 950; x += 40) r.lp.move(x, 560, G);
  assert.ok(r.lp.move(950, 560, G).ms > 0, 'in der Knopfreihe seitlich ueber das Fensterende: haftet, schliesst nicht');
  assert.ok(r.lp.isOpen());
  assert.strictEqual(r.lp.move(950, 500, G).exit, 'side');          // auf Balkenhoehe: seitlich raus wie gewohnt
  var d = rig(); d.at(640, 486); d.T.tick(700);
  assert.strictEqual(d.lp.move(640, 638, G).exit, 'down');           // erst unter der Insel
  var c = rig(); c.at(640, 486); c.T.tick(700);
  var ms = c.lp.click(700, 562, G);                                 // Klick mitten auf der Knopfreihe
  assert.ok(ms > 0, 'setzt das Ziel statt einen Knopf auszuloesen');
  // Zittern +-8 px um die Balkenmitte und senkrechtes Abrutschen um bis zu 32 px nach oben schliessen nie (Fang-Korridor B)
  var j = rig(); j.at(640, 486); j.T.tick(700);
  for (var k = -8; k <= 8; k += 2) assert.ok(!j.lp.move(640 + k, 485 + k, G).exit);
  assert.ok(!j.lp.move(640, 453, G).exit); assert.strictEqual(j.lp.move(640, 452, G).exit, 'up');
  assert.strictEqual(L().N.Loupe.K.CORR, 32);
});

test('Einstellung: Feinauswahl in Wiedergabe, Standard aus, ohne Zeiger-Steuerung ausgegraut (mit Erklaerung), INFO-Hilfe', function () {
  var fs = require('fs'), path = require('path'), vm = require('vm');
  var ctx = H.load(), N = ctx.N, src = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'settings.js'), 'utf8');
  src = src.replace('    s.create = function (root) {', '    s.__defs = defs;\n    s.create = function (root) {');
  var factory = null, def = N.router.define;
  N.router.define = function (n, f) { if (n === 'settings') factory = f; };
  vm.runInContext(src, ctx);
  N.router.define = def;
  N.ui.rail = N.ui.rail || {}; N.ui.rail.order = function () { return []; };
  N.disc = { enabled: function () { return false; }, helper: function () { return ''; }, helperState: function () { return 'down'; }, watchlistOn: function () { return false; }, probeHelper: function () {} };
  N.srv = { has: function () { return false; }, list: function () { return []; } };
  N.appPin = { has: function () { return false; }, count: function () { return 0; } };
  var state = { pointer: true, users: [] }, settings = { ptrLoupe: false };
  N.session = { settings: settings, state: state, pkg: null, profile: { uuid: 'x', kind: 'main', admin: true }, isKid: function () { return false; }, isAdmin: function () { return true; },
    homeCache: function () { return { libs: [] }; }, hubCatalog: function () { return null; }, users: function () { return []; }, admin: function () { return null; },
    startProfile: function () { return 'last'; }, pinSwitchAvailable: function () { return false; }, hasRestricted: function () { return false; }, pinSwitchOn: function () { return false; },
    setSetting: function (k, v) { settings[k] = v; }, save: function () {} };
  var row = null;
  factory().__defs().forEach(function (c) { c.rows.forEach(function (r) { if (r.id === 'ptrLoupe') { row = r; row.cat = c.id; } }); });
  assert.ok(row, 'Zeile ptrLoupe fehlt');
  assert.strictEqual(row.cat, 'play');
  assert.strictEqual(row.get(), false);
  assert.strictEqual(row.disabled(), false);
  state.pointer = false;
  assert.strictEqual(row.disabled(), true);
  assert.strictEqual(row.ddesc, 'set.ptrLoupe.off.desc');
  assert.strictEqual(row.help, 'help.ptrLoupe');
  row.set(true); assert.strictEqual(settings.ptrLoupe, true);
});

/* ---------- Darstellungen (SPEC PLAY-31): eine Logik, drei Ansichten (C Feinleiste unter dem Balken entfallen) ---------- */
test('Darstellung: unbekannt und frueheres "bar" (C) -> Panel (A), Filmstreifen ohne Vorschaubilder -> Panel, Jetzt laeuft immer B', function () {
  var Lp = L().N.Loupe;
  H.eq(Lp.STYLES, ['panel', 'stretch', 'film']);
  assert.strictEqual(Lp.DEF, 'panel');
  assert.strictEqual(Lp.style(undefined, {}), 'panel');
  assert.strictEqual(Lp.style('bar', { thumbs: true }), 'panel');      // gespeicherte Feinleiste (entfallen) -> A
  assert.strictEqual(Lp.style('xyz', { thumbs: true }), 'panel');
  assert.strictEqual(Lp.style('panel', {}), 'panel');
  assert.strictEqual(Lp.style('stretch', { thumbs: false }), 'stretch');
  assert.strictEqual(Lp.style('film', { thumbs: true }), 'film');
  assert.strictEqual(Lp.style('film', { thumbs: false }), 'panel');
  [undefined, 'bar', 'panel', 'stretch', 'film'].forEach(function (s) { assert.strictEqual(Lp.style(s, { thumbs: true, np: true }), 'stretch'); });
  assert.strictEqual(Lp.STY.bar, undefined);
  assert.strictEqual(Lp.width('stretch', 480, 1088), 480); assert.strictEqual(Lp.width('panel', 480, 1088), 480);
  assert.strictEqual(Lp.width('film', 480, 1088), 1000); assert.strictEqual(Lp.width('film', 400, 536), 536);
  var F = Lp.STY.film; assert.strictEqual(F.n * F.fw + (F.n - 1) * F.gap, F.w);   // Bilder decken genau das Fenster
});

test('Lasche (A/D): Unterkante = Inselkante (beruehrt, ueberlappt nicht), Band ab Laschen-Oberkante, Kollisionstest', function () {
  var Lp = L().N.Loupe, d = 2 * HOUR, h = Lp.half(d, BAR.w), O = { barY: 485, islY: 458, bottom: 638, side: 501 };
  [96, 640, 1184].forEach(function (x) {
    ['panel', 'film'].forEach(function (s) {
      var g = Lp.geom({ x: x, barX: 96, barW: 1088, dur: d, w: Lp.width(s, 480, 1088), h: h }), t = Lp.tab(s, g, 458);
      assert.strictEqual(t.y + t.h, 458, s + ' beruehrt die Insel');
      assert.ok(t.x >= 64 && t.x + t.w <= 1216, s + ' innerhalb der Insel bei x ' + x);
      H.eq(Lp.band(s, g, O), { top: t.y, bottom: 638, side: 501 });
    });
  });
  var g = Lp.geom({ x: 640, barX: 96, barW: 1088, dur: d, w: 480, h: h });
  assert.strictEqual(Lp.tab('stretch', g, 458), null);
  H.eq(Lp.band('stretch', g, O), { top: 453, bottom: 638, side: 501 });   // B: 32 px ueber der Balkenmitte
  var a = Lp.tab('panel', g, 458);                                     // 384 … 896 x 378 … 458
  assert.ok(Lp.hit(a, { x: 816, y: 214, w: 400, h: 232 }));            // Countdown-Karte (bis y 446) ragt hinein
  assert.ok(!Lp.hit(a, { x: 1019, y: 398, w: 197, h: 48 }));           // Skip-Knopf rechts daneben: bleibt
  assert.ok(!Lp.hit(a, { x: 0, y: 0, w: 0, h: 0 }));                   // unsichtbar (0 breit): nie
});

test('Filmstreifen: Bild unter dem Zeiger = Abschnitt, Bildzeit = Abschnittsmitte', function () {
  var Lp = L().N.Loupe, d = 2 * HOUR, g = Lp.geom({ x: 700, barX: 96, barW: 1088, dur: d, w: 1000, h: Lp.half(d, 1088) }), F = Lp.STY.film;
  var fr = Lp.frames(g);
  assert.strictEqual(fr.length, 7);
  fr.forEach(function (f, k) {
    assert.strictEqual(Lp.slot(g, f.x), k); assert.strictEqual(Lp.slot(g, f.x + F.fw - 1), k);
    assert.ok(Math.abs(f.ms - Lp.at(g, f.x + F.fw / 2)) <= 1);
  });
  assert.strictEqual(Lp.slot(g, g.L - 50), 0); assert.strictEqual(Lp.slot(g, g.L + g.w + 50), 6);
  assert.ok(g.spp < 600, 'feiner als die 480-px-Leiste');
});

test('Balken dehnt sich: stueckweise linear, Fenster gedehnt, Start-Transforms bilden auf die grobe Lage ab', function () {
  var Lp = L().N.Loupe, d = 2 * HOUR, g = Lp.geom({ x: 700, barX: 96, barW: 1088, dur: d, w: 480, h: Lp.half(d, 1088) });
  var z = Lp.stretch(g, 96, 1088);
  assert.strictEqual(z.map(0), 96); assert.strictEqual(Math.round(z.map(d)), 1184);
  assert.ok(Math.abs(z.map(g.a) - g.L) < 0.5 && Math.abs(z.map(g.b) - (g.L + g.w)) < 0.5);
  assert.ok(Math.abs(z.map(g.t0) - g.x0) < 0.5, 'Ruhestelle bleibt, wo sie war');
  for (var t = 0, last = -1; t <= d; t += 60000) { var x = z.map(t); assert.ok(x >= last); last = x; }   // monoton
  // Start-Transform: Endlage -> grobe Lage (links Ursprung links, rechts Ursprung rechts)
  function back(gr, xf) { return gr.o === '0' ? gr.x + gr.tx + (xf - gr.x) * gr.s : gr.x + gr.w - (gr.x + gr.w - xf) * gr.s; }
  [[0, 600000], [1, g.t0], [2, 6800000]].forEach(function (p) {
    var gr = z.grp[p[0]], coarse = 96 + 1088 * p[1] / d;
    assert.ok(Math.abs(back(gr, z.map(p[1])) - coarse) < 0.5, 'Gruppe ' + p[0]);
  });
  var e = Lp.stretch(Lp.geom({ x: 96, barX: 96, barW: 1088, dur: d, w: 480, h: Lp.half(d, 1088) }), 96, 1088);
  assert.strictEqual(e.grp[0].w, 0);                                    // am Balkenanfang: keine linke Gruppe
});

test('Verlassen: Sprung > 200 px zwischen zwei Bewegungen (Finger neu aufgelegt) schliesst auch innerhalb einer hohen Lasche', function () {
  var band = { top: 296, bottom: 530 };                                 // Filmstreifen: Band ab y 296 – die Bildmitte liegt darin
  var r = rig(); r.at(640, 486); r.T.tick(700);
  assert.ok(!r.lp.move(650, 480, band).exit);
  assert.ok(!r.lp.move(700, 400, band).exit);                           // in die Lasche hinein: bleibt offen
  var s = rig(); s.at(640, 486); s.T.tick(700);
  assert.ok(!s.lp.move(900, 486, band).exit);
  assert.strictEqual(s.lp.move(640, 360, band).exit, 'jump');
  assert.ok(!s.lp.isOpen());
});

test('Einstellung: Darstellung der Feinauswahl – drei Formen mit Unterzeile, Standard Panel, gedimmt ohne Zeiger bzw. Feinauswahl', function () {
  var fs = require('fs'), path = require('path'), vm = require('vm');
  var ctx = H.load(), N = ctx.N, src = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'settings.js'), 'utf8');
  src = src.replace('    s.create = function (root) {', '    s.__defs = defs;\n    s.create = function (root) {');
  var factory = null, def = N.router.define;
  N.router.define = function (n, f) { if (n === 'settings') factory = f; };
  vm.runInContext(src, ctx);
  N.router.define = def;
  N.ui.rail = N.ui.rail || {}; N.ui.rail.order = function () { return []; };
  N.disc = { enabled: function () { return false; }, helper: function () { return ''; }, helperState: function () { return 'down'; }, watchlistOn: function () { return false; }, probeHelper: function () {} };
  N.srv = { has: function () { return false; }, list: function () { return []; } };
  N.appPin = { has: function () { return false; }, count: function () { return 0; } };
  var state = { pointer: true, users: [] }, settings = { ptrLoupe: false };
  N.session = { settings: settings, state: state, pkg: null, profile: { uuid: 'x', kind: 'main', admin: true }, isKid: function () { return false; }, isAdmin: function () { return true; },
    homeCache: function () { return { libs: [] }; }, hubCatalog: function () { return null; }, users: function () { return []; }, admin: function () { return null; },
    startProfile: function () { return 'last'; }, pinSwitchAvailable: function () { return false; }, hasRestricted: function () { return false; }, pinSwitchOn: function () { return false; },
    setSetting: function (k, v) { settings[k] = v; }, save: function () {} };
  var row = null, ids = [];
  factory().__defs().forEach(function (c) { c.rows.forEach(function (r) { if (c.id === 'play') ids.push(r.id); if (r.id === 'loupeStyle') row = r; }); });
  assert.ok(row, 'Zeile loupeStyle fehlt');
  assert.strictEqual(ids.indexOf('loupeStyle'), ids.indexOf('ptrLoupe') + 1);   // direkt unter dem Schalter
  assert.strictEqual(row.val(), N.t('set.v.lpPanel'));                          // ohne gespeicherten Wert: Panel (A)
  settings.loupeStyle = 'bar'; assert.strictEqual(row.val(), N.t('set.v.lpPanel'));   // entfallene Feinleiste: zeigt A
  delete settings.loupeStyle;
  assert.strictEqual(row.disabled(), true); assert.strictEqual(row.ddesc(), 'set.loupeStyle.off.desc');
  settings.ptrLoupe = true; assert.strictEqual(row.disabled(), false);
  state.pointer = false; assert.strictEqual(row.disabled(), true); assert.strictEqual(row.ddesc(), 'set.ptrLoupe.off.desc');
  assert.strictEqual(row.help, 'help.loupeStyle');
  assert.strictEqual(N.t('set.v.lpBar'), 'set.v.lpBar');                       // Text der Feinleiste entfernt
  ['lpPanel', 'lpStretch', 'lpFilm'].forEach(function (k) {
    assert.ok(N.t('set.v.' + k + '.s').length <= 38, 'Unterzeile passt in das Auswahl-Panel: ' + k);
  });
});
