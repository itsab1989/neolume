'use strict';
/* Seitenleiste folgt dem Finger (Apple Nr. 24, SPEC NAV-18): Rand-Wisch live (App.railPan -> N.ui.rail.pan), offene Leiste per Zug nach
 * links zu (N.router.pan). Schwellen: 40 % des Wegs oder Schwung. Am TV ruft das niemand (kein Lader schickt railPan/pan). */
var test = require('node:test'), assert = require('node:assert');
var H = require('./helpers/load');

function setup() {
  var ctx = H.load({ fakeTimers: true }), N = ctx.N;
  var R = N.ui.rail, log = [];
  N.timers = ctx.timers;
  function st() { return { style: {}, className: '' }; }
  R.el = st(); R.panel = st(); R.dim = st(); R.att = 'home'; R.open_ = false;
  R.open = function () { R.open_ = true; log.push('open'); };
  R.close = function () { R.open_ = false; log.push('close'); };
  return { N: N, R: R, log: log, tf: function () { return R.panel.style.transform; }, op: function () { return R.dim.style.opacity; } };
}
function swipe(R, from, dxs, ms) {   // Zug mit gleichmaessigen Proben, Ende am letzten Weg
  var t = 0, n = dxs.length;
  R.pan({ phase: 'start', from: from, dx: dxs[0], t: 0 });
  for (var i = 1; i < n; i++) { t = ms * i / (n - 1); R.pan({ phase: 'move', from: from, dx: dxs[i], t: t }); }
  return R.pan({ phase: 'end', from: from, dx: dxs[n - 1], t: t + 200 });   // 200 ms still: kein Schwung
}

test('rein: Lage folgt dem Weg (Rand-Start = -TRAVEL, offen = 0, ganz zu = -NAV_W, begrenzt) und Loslassen-Regel (40 % oder Schwung)', function () {
  var R = setup().R, T = R.TRAVEL, W = R.NAV_W;
  assert.strictEqual(W, 320, 'Panel-Breite (l.nav-w)');
  assert.strictEqual(R.dragPos('edge', 0), -T);
  assert.strictEqual(R.dragPos('edge', 50), -T + 50);
  assert.strictEqual(R.dragPos('edge', 900), 0);
  assert.strictEqual(R.dragPos('edge', -30), -T - 30, 'zurueck ueber den Start: weiter hinaus (Icon-Spalte frei)');
  assert.strictEqual(R.dragPos('edge', -500), -W);
  assert.strictEqual(R.dragPos('open', -50), -50);
  assert.strictEqual(R.dragPos('open', -50, 1.5), -75);
  assert.strictEqual(R.dragPos('open', -250), -250, 'nicht mehr bei -TRAVEL festgehalten');
  assert.strictEqual(R.dragPos('open', -900), -W, 'ganz zu = ganz aus dem Bild');
  assert.strictEqual(R.dragPos('open', 40), 0);
  assert.strictEqual(R.dragEnd(-T + 0.4 * T, 0, 80), true, '40 % offen');
  assert.strictEqual(R.dragEnd(-T + 0.39 * T, 0, 78), false, 'darunter zu');
  assert.strictEqual(R.dragEnd(-T + 30, 0.8, 30), true, 'Schwung nach rechts oeffnet');
  assert.strictEqual(R.dragEnd(-20, -0.8, 30, 'open'), false, 'Schwung nach links schliesst');
  assert.strictEqual(R.dragEnd(-0.4 * T, 0, 80, 'open'), false, 'offen: 40 % nach links schliesst');
  assert.strictEqual(R.dragEnd(-0.39 * T, 0, 78, 'open'), true, 'darunter bleibt offen');
  assert.strictEqual(R.dragEnd(-T + 10, 2, 10), false, 'zu kurzer Zug: kein Schwung');
  assert.strictEqual(R.dragEnd(-W, 0, 300, 'open'), false, 'ganz zu bleibt zu');
});

test('rein: Verstaerkung – Finger am linken Rand = ganz zu (auch wenn er darueber hinaus geht)', function () {
  var R = setup().R, W = R.NAV_W;
  assert.strictEqual(R.dragGain(400), 1, 'rechts vom Panel: 1:1');
  assert.strictEqual(R.dragGain(320), 1);
  assert.strictEqual(R.dragGain(160), 2);
  assert.strictEqual(R.dragGain(40), 3, 'begrenzt');
  assert.strictEqual(R.dragGain(0), 3);
  [200, 250, 300, 320].forEach(function (x) {
    assert.strictEqual(R.dragPos('open', -x, R.dragGain(x)), -W, 'Finger von x ' + x + ' bis x 0');
    assert.strictEqual(R.dragPos('open', -x - 60, R.dragGain(x)), -W, 'ueber den Rand: bleibt ganz zu');
  });
});

test('rein: Tempo aus den letzten 100 ms; still vor dem Ende -> 0; Gleiten setzt mit dem Finger-Tempo fort', function () {
  var R = setup().R, s = [];
  for (var i = 0; i <= 20; i++) s.push({ t: i * 8.33, p: -i * 10 });   // 120 Hz, 1,2 px/ms nach links
  assert.ok(Math.abs(R.dragVel(s, 170) + 1.2) < 0.01, 'v = -1,2 px/ms');
  assert.strictEqual(R.dragVel(s, 167 + 81), 0, 'Finger stand still');
  assert.strictEqual(R.dragVel([{ t: 0, p: 0 }], 5), 0);
  var g = R.glide(-150, 0, 0);
  assert.ok(g.ms >= 160 && g.ms <= 300, 'Dauer nach Weg');
  assert.strictEqual(g.ease, 'cubic-bezier(0.2,0.2,0.2,1)', 'ohne Tempo: sanfter Start (Steigung 1)');
  var c = R.glide(-150, -320, -1.2);           // schliessen mit 1,2 px/ms
  var k = Number(/cubic-bezier\(0\.2,([0-9.]+),/.exec(c.ease)[1]) / 0.2;
  assert.ok(Math.abs(k - 1.2 * c.ms / 170) < 0.06, 'Anfangssteigung = Finger-Tempo (normiert)');
  var f = R.glide(-150, -320, -6);              // schneller Wurf: kuerzer, Steigung begrenzt
  assert.ok(f.ms < c.ms && f.ms >= 110);
  assert.ok(/cubic-bezier\(0\.2,1,0\.2,1\)/.test(f.ease), f.ease);
  assert.strictEqual(R.glide(0, 0, 3).ms, 0);
  var o = R.glide(-120, 0, 0.8), oc = R.glide(-200, -320, -0.8);
  assert.ok(o.ease && oc.ease, 'Oeffnen und Schliessen dieselbe Kurvenfamilie');
});

test('Rand-Wisch: Panel und Abdunklung folgen live ohne Uebergang; ueber 40 % offen (gleitet weiter), darunter hinaus', function () {
  var e = setup(), R = e.R, T = R.TRAVEL, W = R.NAV_W;
  assert.strictEqual(R.pan({ phase: 'start', from: 'edge', dx: 20, t: 0 }), true);
  assert.strictEqual(e.tf(), 'translate3d(' + (-T + 20) + 'px,0,0)');
  assert.strictEqual(R.panel.style.transition, 'none');
  assert.strictEqual(R.panel.style.visibility, 'visible');
  R.pan({ phase: 'move', from: 'edge', dx: 100, t: 50 });
  assert.strictEqual(e.tf(), 'translate3d(' + (-T + 100) + 'px,0,0)');
  assert.strictEqual(e.op(), String(100 / T));
  assert.deepStrictEqual(e.log, [], 'waehrend des Ziehens weder open noch close');
  R.pan({ phase: 'end', from: 'edge', dx: 100, t: 300 });
  assert.deepStrictEqual(e.log, ['open']);
  assert.strictEqual(e.tf(), 'translate3d(0px,0,0)', 'gleitet von der Finger-Lage auf 0');
  assert.ok(/^transform \d+ms cubic-bezier/.test(R.panel.style.transition), R.panel.style.transition);
  assert.ok(/^opacity \d+ms cubic-bezier/.test(R.dim.style.transition), 'Abdunklung gleitet mit (kein Sprung)');
  assert.strictEqual(e.op(), '1');
  e.N.timers.tick(400);
  assert.strictEqual(e.tf(), '', 'danach traegt die Klasse .open');
  assert.strictEqual(R.panel.style.transition, '');
  assert.strictEqual(R.dim.style.opacity, '');

  e = setup();
  swipe(e.R, 'edge', [12, 30, 50, 60], 300);
  assert.deepStrictEqual(e.log, [], '60 von 200 px: nicht offen');
  assert.strictEqual(e.tf(), 'translate3d(' + (-W) + 'px,0,0)', 'gleitet ganz hinaus');
  assert.strictEqual(e.R.panel.style.visibility, 'visible');
  e.N.timers.tick(400);
  assert.strictEqual(e.tf(), '');
  assert.strictEqual(e.R.panel.style.visibility, '');
});

test('Rand-Wisch mit Schwung oeffnet auch kurz; Abbruch (touchcancel) = Loslassen mit letztem Tempo; ohne Leiste nichts', function () {
  var e = setup(), R = e.R;
  R.pan({ phase: 'start', from: 'edge', dx: 12, t: 0 });
  R.pan({ phase: 'move', from: 'edge', dx: 40, t: 30 });
  R.pan({ phase: 'end', from: 'edge', dx: 60, t: 50 });
  assert.deepStrictEqual(e.log, ['open'], '28 px in 30 ms ~ 1 px/ms');
  e = setup();
  e.R.pan({ phase: 'start', from: 'edge', dx: 12, t: 0 });
  e.R.pan({ phase: 'move', from: 'edge', dx: 180, t: 100 });
  e.R.pan({ phase: 'end', from: 'edge', dx: 180, t: 120, cancel: true });
  assert.deepStrictEqual(e.log, ['open'], 'Abbruch weit offen: offen (vorher: zu)');
  e = setup();
  e.R.pan({ phase: 'start', from: 'edge', dx: 12, t: 0 });
  e.R.pan({ phase: 'move', from: 'edge', dx: 30, t: 100 });
  e.R.pan({ phase: 'end', from: 'edge', dx: 30, t: 300, cancel: true });
  assert.deepStrictEqual(e.log, [], 'Abbruch kurz: zu');
  e = setup(); e.R.att = null;
  assert.strictEqual(e.R.pan({ phase: 'start', from: 'edge', dx: 12, t: 0 }), false);
  assert.strictEqual(e.R.pan({ phase: 'move', from: 'edge', dx: 120, t: 50 }), false);
  e = setup(); e.R.open_ = true;
  assert.strictEqual(e.R.pan({ phase: 'start', from: 'edge', dx: 12, t: 0 }), false, 'schon offen: Rand-Wisch tut nichts');
});

test('offene Leiste: Zug nach links ab dem Erkennen (kein Sprung), bis ganz hinaus; ab 40 % zu; wenig Weg bleibt offen', function () {
  var e = setup(), R = e.R, W = R.NAV_W;
  R.open_ = true;
  R.pan({ phase: 'start', from: 'open', dx: -12, x: 412, t: 0 });
  assert.strictEqual(e.tf(), 'translate3d(0px,0,0)', 'Start: noch genau offen (Zitterschwelle zaehlt nicht)');
  R.pan({ phase: 'move', from: 'open', dx: -50, t: 40 });
  assert.strictEqual(e.tf(), 'translate3d(-38px,0,0)');
  R.pan({ phase: 'end', from: 'open', dx: -100, t: 400 });
  assert.deepStrictEqual(e.log, ['close'], '88 von 200 px ab dem Erkennen');
  assert.strictEqual(e.tf(), 'translate3d(' + (-W) + 'px,0,0)', 'gleitet ganz hinaus');
  assert.strictEqual(R.panel.style.visibility, 'visible', 'waehrend des Hinausgleitens sichtbar');
  assert.strictEqual(e.op(), '0');
  e = setup(); e.R.open_ = true;
  e.R.pan({ phase: 'start', from: 'open', dx: -12, x: 412, t: 0 });
  [-30, -40].forEach(function (d, i) { e.R.pan({ phase: 'move', from: 'open', dx: d, t: 150 * (i + 1) }); });
  e.R.pan({ phase: 'end', from: 'open', dx: -40, t: 500 });
  assert.deepStrictEqual(e.log, [], '28 von 200 px: bleibt offen');
  assert.strictEqual(e.tf(), 'translate3d(0px,0,0)', 'gleitet zurueck auf 0');
});

test('offene Leiste: Finger von x 250 ueber den linken Rand hinaus (x < 0, Koordinate klemmt), dann touchcancel -> ganz zu, kein Sprung', function () {
  var e = setup(), R = e.R, W = R.NAV_W, pos = [], t = 0;
  R.open_ = true;
  function p() { return Number(/translate3d\((-?\d+)px/.exec(e.tf())[1]); }
  R.pan({ phase: 'start', from: 'open', dx: -11, x: 250, t: 0 }); pos.push(p());
  for (var x = 239; x >= -40; x -= 9) {          // 120 Hz, ~1 px/ms; ab x 0 klemmt die Koordinate (dx bleibt)
    t += 8.33;
    R.pan({ phase: 'move', from: 'open', dx: Math.max(x, 0) - 250, t: t }); pos.push(p());
  }
  for (var i = 1; i < pos.length; i++) {
    assert.ok(pos[i] <= pos[i - 1], 'nur nach links');
    assert.ok(pos[i - 1] - pos[i] <= 16, 'kein Sprung (' + pos[i - 1] + ' -> ' + pos[i] + ')');
  }
  assert.strictEqual(pos[pos.length - 1], -W, 'Finger am Rand: ganz zu');
  R.pan({ phase: 'end', from: 'open', dx: -250, t: t + 4, cancel: true });
  assert.deepStrictEqual(e.log, ['close'], 'Abbruch = Loslassen');
  assert.strictEqual(e.tf(), '', 'schon ganz hinaus: nichts mehr zu gleiten, Klasse uebernimmt (unsichtbar)');
  assert.strictEqual(R.panel.style.visibility, '');
});

test('Router: offene Leiste nimmt waagerechte Zuege (rail.pan from open), senkrechte ohne Wirkung; zu = Ansicht wie immer', function () {
  var e = setup(), N = e.N, R = e.R, got = [], scrPans = [];
  R.pan = function (p) { got.push(p.from + ':' + p.phase + '@' + p.dx); return true; };
  R.isOpen = function () { return R.open_; };
  N.router.define('v', function () { return { pan: function (p) { scrPans.push(p.phase); return true; } }; });
  N.router.push('v', {});
  R.open_ = true;
  assert.strictEqual(N.router.pan({ phase: 'start', axis: 'x', x: 400, y: 300, dx: -12, dy: 0, t: 0 }), true);
  N.router.pan({ phase: 'move', axis: 'x', x: 400, y: 300, dx: -60, dy: 0, t: 20 });
  N.router.pan({ phase: 'end', axis: 'x', x: 400, y: 300, dx: -90, dy: 0, t: 40 });
  assert.deepStrictEqual(got, ['open:start@-12', 'open:move@-60', 'open:end@-90']);
  assert.strictEqual(N.router.pan({ phase: 'start', axis: 'y', x: 400, y: 300, dx: 0, dy: 20, t: 0 }), true, 'senkrecht: angenommen, nichts');
  N.router.pan({ phase: 'end', axis: 'y', x: 400, y: 300, dx: 0, dy: 40, t: 20 });
  assert.strictEqual(got.length, 3);
  assert.deepStrictEqual(scrPans, [], 'die Ansicht darunter bekommt nichts');
  R.open_ = false;
  N.router.pan({ phase: 'start', axis: 'x', x: 400, y: 300, dx: -12, dy: 0, t: 0 });
  assert.deepStrictEqual(scrPans, ['start']);
});
