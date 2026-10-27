'use strict';
/* Smart-Control-Zeiger (TV-Test 26.10.): Drossel mit Vorderflanke, langes Druecken = TOOLS, Hinweisleiste anklickbar */
var test = require('node:test'), assert = require('node:assert');
var H = require('./helpers/load');

function setup() {
  var ctx = H.load({ fakeTimers: true }), N = ctx.N, T = ctx.timers;
  var hints = N.ui.hints;
  N.router._reset(T.now);
  N.ui.hints = { el: null, set: function () {}, refresh: function () {}, hit: function (x, y) { return y >= 650 ? 'INFO' : null; } };
  N.ui.rail = { el: null, isOpen: function () { return false; }, attached: function () { return false; } };
  var s = { keys: [], ptr: [] };
  N.router.define('x', function () {
    return { create: function () {}, onKey: function (k) { s.keys.push(k); return true; },
      pointer: function (x, y, kind) { s.ptr.push(kind + '@' + x + ',' + y); return true; } };
  });
  N.router.reset('x');
  return { N: N, T: T, s: s, realHints: hints };
}

test('Drossel: erste Bewegung sofort, dann hoechstens alle 40 ms, letzte gewinnt', function () {
  var c = setup(), T = c.T, n = 0;
  var th = new c.N.pointer.Throttle(40, function () { n++; }, { now: T.now, set: T.setTimeout, clear: T.clearTimeout });
  th.hit(); assert.strictEqual(n, 1);                         // Vorderflanke: ohne Wartezeit
  T.tick(10); th.hit(); T.tick(10); th.hit(); assert.strictEqual(n, 1);
  T.tick(20); assert.strictEqual(n, 2);                       // ein Nachlauf am Ende des 40-ms-Fensters
  T.tick(100); th.hit(); assert.strictEqual(n, 3);            // nach Ruhe wieder sofort
  th.hit(); th.cancel(); T.tick(100); assert.strictEqual(n, 3);
});

test('Langes Druecken (>= 800 ms) = TOOLS fuer das Element unter dem Punkt; der folgende Klick entfaellt', function () {
  var c = setup(), P = c.N.pointer;
  P.down(300, 400); c.T.tick(799);
  assert.deepStrictEqual(c.s.keys, []);
  c.T.tick(1);
  assert.deepStrictEqual(c.s.ptr.slice(), ['move@300,400']);
  assert.deepStrictEqual(c.s.keys.slice(), ['TOOLS']);
  P.up(); P.click(300, 400, null);
  assert.deepStrictEqual(c.s.ptr.slice(), ['move@300,400']);   // kein OK hinterher
  P.down(300, 400); c.T.tick(300); P.up(); P.click(300, 400, null);   // kurzer Druck = normaler Klick
  assert.deepStrictEqual(c.s.ptr.slice(1), ['move@300,400', 'click@300,400']);
  assert.deepStrictEqual(c.s.keys.slice(), ['TOOLS']);
});

test('Klick auf die Hinweisleiste = diese Taste (Bildschirm bekommt keinen Zeiger-Klick)', function () {
  var c = setup(), P = c.N.pointer;
  P.click(1100, 668, null);
  assert.deepStrictEqual(c.s.keys.slice(), ['INFO']);
  assert.strictEqual(c.s.ptr.length, 0);
});

test('Hinweisleiste: Treffer per Rechteck-Mathe, Farbtasten/RETURN/INFO/TOOLS abgebildet', function () {
  var c = setup(), Hh = c.realHints;
  Hh.list = [{ k: 'yellow' }, { k: 'ret' }, { k: 'TOOLS' }, { k: 'DIGITS' }];
  Hh.rects = [{ x: 700, w: 120, k: 'YELLOW' }, { x: 850, w: 100, k: 'RETURN' }, { x: 980, w: 120, k: 'TOOLS' }, { x: 1110, w: 90, k: null }];
  assert.strictEqual(Hh.hit(760, 668), 'YELLOW');
  assert.strictEqual(Hh.hit(900, 660), 'RETURN');
  assert.strictEqual(Hh.hit(1000, 690), 'TOOLS');
  assert.strictEqual(Hh.hit(1150, 668), null);                // Ziffern: keine Taste
  assert.strictEqual(Hh.hit(760, 600), null);                 // oberhalb der Leiste
});

/* TV-Befund 27.10. nachmittags: Listenansicht "scrollt wild" – Hover darf keine Rueckkopplung Fokus -> Rollen -> Hover ausloesen */
function anchored() {
  // Nachbildung der alten Listenansicht: Fokuszeile steht immer oben (y 176, Zeilen 84 hoch); Hover auf Zeile k rollt die Liste
  var ctx = H.load({ fakeTimers: true }), N = ctx.N, T = ctx.timers;
  N.router._reset(T.now);
  N.ui.hints = { el: null, set: function () {}, refresh: function () {}, hit: function () { return null; } };
  N.ui.rail = { el: null, isOpen: function () { return false; }, attached: function () { return false; } };
  var s = { r: 0, f: 0, moves: 0, scrolls: 0 };
  N.router.define('list', function () {
    return { create: function () {}, onKey: function () { return true; },
      pointer: function (x, y, kind) {
        if (kind !== 'move') return true;
        s.moves++;
        var j = s.r + Math.floor((y - 176) / 84);
        if (j !== s.f) { s.f = j; s.r = j; }               // alte Logik: Fokus wandert an den Anker -> Inhalt rollt
        return true;
      },
      pointerSig: function () { return s.r; },
      pointerEdge: function (x, y) { return y >= 632 && y < 656 ? { d: 1, x: 164, y: 644 } : null; },
      pointerScroll: function (d) { s.r += d; s.scrolls++; } };
  });
  N.router.reset('list');
  var P = N.pointer, flip = false;
  // Finger auf dem Touchpad: alle 50 ms ein Zitter-Ereignis (1 px, unter der Zitterschwelle) = Lebenszeichen
  function live(ms) {
    for (var t = 0; t < ms;) { var st = Math.min(50, ms - t); T.tick(st); t += st; P.move(P.x + (flip ? 1 : -1), P.y); flip = !flip; }
  }
  return { N: N, T: T, P: P, s: s, live: live };
}

test('Zeiger: ruhender Punkt mit Zittern rollt die Liste hoechstens einmal (Scroll-Sperre + Zitterschwelle)', function () {
  var c = anchored(), P = c.P, T = c.T, s = c.s;
  P.move(400, 430); T.tick(50);                              // Zeile 3 -> Liste rollt einmal (alte Anker-Logik)
  assert.strictEqual(s.r, 3);
  for (var i = 0; i < 60; i++) { P.move(400 + (i % 3), 430 + (i % 2) * 2); T.tick(50); }   // 3 s Zittern um wenige Pixel
  assert.strictEqual(s.r, 3, 'kein weiteres Rollen durch Zittern/stehenden Punkt');
  P.move(400, 430); P.move(400, 430); T.tick(500);           // gleiche Position (kuenstliches mousemove) -> nichts
  assert.strictEqual(s.r, 3);
});

test('Zeiger: nach einem Rollen erst wieder auswerten, wenn Zeit UND Weg erreicht sind', function () {
  var c = anchored(), P = c.P, T = c.T, s = c.s;
  P.move(400, 430); T.tick(50);
  var m = s.moves;
  P.move(400, 480); T.tick(50);                              // 50 px, aber zu frueh
  assert.strictEqual(s.moves, m);
  T.tick(P.SCROLL_COOL);
  P.move(400, 470); T.tick(50);                              // Zeit ok, aber nur 40 px von der Sperr-Stelle (400,430)
  assert.strictEqual(s.moves, m + 1);
});

test('Zeiger: kleine Bewegung unter der Zitterschwelle wird nicht ausgewertet, groessere schon', function () {
  var c = anchored(), P = c.P, T = c.T, s = c.s;
  P.move(400, 200); T.tick(50);
  var m = s.moves;
  P.move(402, 201); T.tick(50);
  assert.strictEqual(s.moves, m);
  P.move(406, 201); T.tick(50);
  assert.strictEqual(s.moves, m + 1);
});

test('Zeiger-Randzone: erst nach Verweilen, dann gedrosselt; Verlassen stoppt; Taste stoppt', function () {
  var c = anchored(), P = c.P, T = c.T, s = c.s, live = c.live;
  P.setAccel(false);                                         // gleichmaessiges Tempo (Einstellung aus)
  P.move(400, 640); live(P.EDGE_DWELL - 10);
  assert.strictEqual(s.scrolls, 0, 'nicht sofort');
  live(10);
  assert.strictEqual(s.scrolls, 1);
  live(P.EDGE_RATE * 3);
  assert.strictEqual(s.scrolls, 4, 'hoechstens ein Schritt je EDGE_RATE');
  P.x = 400; P.y = 300;                                      // Punkt verlaesst die Zone (Position wird im Schritt geprueft)
  live(P.EDGE_RATE * 3);
  assert.strictEqual(s.scrolls, 4);
  P.move(500, 645); live(P.EDGE_DWELL + 10);
  var n = s.scrolls;
  P.keyUsed(); live(P.EDGE_RATE * 3);
  assert.strictEqual(s.scrolls, n, 'Taste beendet das Rollen');
});

test('Randzone beschleunigt: 3 Schritte im 400-ms-Abstand, dann schneller bis 120 ms; Verlassen setzt zurueck', function () {
  var c = anchored(), P = c.P, T = c.T, s = c.s, live = c.live;
  var d = [];
  for (var k = 1; k <= 10; k++) d.push(P.edgeDelay(k, true));
  assert.deepStrictEqual(d, [400, 400, 320, 256, 205, 164, 131, 120, 120, 120]);
  assert.strictEqual(P.edgeDelay(1, false), 300); assert.strictEqual(P.edgeDelay(9, false), 300);
  P.setAccel(true);
  P.move(400, 640); live(400);                              // Verweilen -> Schritt 1
  assert.strictEqual(s.scrolls, 1);
  live(400); live(400);                                  // Schritte 2, 3 langsam
  assert.strictEqual(s.scrolls, 3);
  live(320 + 256 + 205);                                   // dann schneller
  assert.strictEqual(s.scrolls, 6);
  live(164 + 131 + 120 * 3);
  assert.strictEqual(s.scrolls, 11);
  P.move(400, 300); live(200);                             // Zone verlassen (Hover noch gesperrt, Rollen endet)
  assert.strictEqual(s.scrolls, 11);
  var n = s.scrolls;
  P.move(400, 645); live(399);
  assert.strictEqual(s.scrolls, n, 'nach erneutem Betreten wieder langsam (erst Verweilen)');
  live(1); live(399);
  assert.strictEqual(s.scrolls, n + 1, 'zweiter Schritt wieder nach 400 ms');
});

test('Randzone: Finger vom Touchpad (keine Roh-Ereignisse mehr, Punkt bleibt stehen) -> Rollen endet nach LIVE ms', function () {
  var c = anchored(), P = c.P, T = c.T, s = c.s;
  P.move(400, 640); c.live(P.EDGE_DWELL + 400);              // Zone, Finger liegt auf: 2 Schritte
  assert.strictEqual(s.scrolls, 2);
  T.tick(2000);                                              // Finger weg: keine Ereignisse
  assert.ok(s.scrolls <= 2 + Math.ceil(P.LIVE / 400), 'hoechstens die Schritte innerhalb der LIVE-Frist');
  var n = s.scrolls;
  T.tick(3000); assert.strictEqual(s.scrolls, n);
  P.move(400, 640); P.move(400, 640);                         // gleiche Stelle (kuenstlich, Inhalt wanderte) ist kein Lebenszeichen
  T.tick(3000); assert.strictEqual(s.scrolls, n);
});

test('Verweilen (hold): erst nach 250 ms; Taste, Klick oder neues Verweilen brechen ab', function () {
  var c = anchored(), P = c.P, T = c.T, n = 0;
  P.hold(function () { n++; }); T.tick(P.HOLD - 1); assert.strictEqual(n, 0);
  T.tick(1); assert.strictEqual(n, 1);
  P.hold(function () { n++; }); T.tick(100); P.keyUsed(); T.tick(500); assert.strictEqual(n, 1);
  P.move(300, 300); P.hold(function () { n++; }); T.tick(100); P.hold(function () { n += 10; }); T.tick(300);
  assert.strictEqual(n, 11, 'nur das letzte Verweilen');
});

test('Mausrad: hoechstens ein Schritt je 150 ms', function () {
  var c = anchored(), P = c.P, T = c.T, keys = [];
  c.N.router.key = function (k) { keys.push(k); };
  for (var i = 0; i < 10; i++) { P.wheel(1); T.tick(10); }
  assert.strictEqual(keys.length, 1);
  T.tick(150); P.wheel(-1);
  assert.deepStrictEqual(keys, ['DOWN', 'UP']);
});

/* Raster/Liste: Zeiger fokussiert "still" (Scroll-Zeile bleibt), Randzone rollt mit geklemmtem Fokus */
function gridSetup() {
  var ctx = H.load({ fakeTimers: true }), N = ctx.N;
  function Style() {}
  function El(tag) { this.tagName = tag; this.style = new Style(); this.childNodes = []; this.className = ''; this.src = ''; }
  El.prototype.appendChild = function (c) { this.childNodes.push(c); c.parentNode = this; return c; };
  ctx.document = { createElement: function (t) { return new El(t); }, createTextNode: function (t) { return { nodeValue: t }; } };
  N.plex.setServer('http://pms.local:32400', 'T');
  N.i18n.set('de');
  var items = [];
  for (var i = 0; i < 40; i++) items.push({ rk: String(i), type: 'movie', title: 'Film ' + i, thumb: '/t/' + i, year: 2000 });
  var G = N.GridMath.make('list'), g = new N.ui.Grid(ctx.document.createElement('div'));
  g.setGeom(G); g.setModel(items, items.length, 0); g.setFocused(true);
  return { N: N, G: G, g: g };
}
test('Listenansicht: Zeiger-Fokus rollt nicht; Taste rollt wie bisher; Randzone klemmt den Fokus', function () {
  var c = gridSetup(), g = c.g, G = c.G;
  assert.strictEqual(g.hitRows(), 5);
  assert.ok(G.part(), 'Liste: 6. Zeile zu 50 % sichtbar -> zeigbar'); assert.strictEqual(G.edgeB(), 604);
  var L = c.N.GridMath.make('L'), Mm = c.N.GridMath.make('M'), S = c.N.GridMath.make('S');
  assert.ok(L.part() && Mm.part() && !S.part(), 'Gross 44 %, Mittel 76 % zeigbar; Klein 22 % = Randzone');
  assert.strictEqual(L.edgeB(), 604); assert.strictEqual(S.edgeB(), 600);                                // 176 … 512 ganz sichtbar; 596 angeschnitten = Randzone
  var p = g.focusTo(G.hit(40, g.r, 400, 450), true);                 // Zeile 3 unter dem Punkt
  assert.strictEqual(g.f, 3); assert.strictEqual(g.r, 0, 'Liste bleibt stehen');
  assert.strictEqual(p.y, 176 + 3 * 84, 'Ring an der Zeile unter dem Punkt');
  assert.strictEqual(G.hit(40, g.r, 400, 450), 3, 'derselbe Eintrag bleibt unter dem Punkt -> keine Rueckkopplung');
  p = g.scrollBy(1);                                                 // Randzone unten
  assert.strictEqual(g.r, 1); assert.strictEqual(g.f, 3); assert.strictEqual(p.y, 176 + 2 * 84);
  g.scrollBy(1); g.scrollBy(1); g.scrollBy(1);                       // Fokus faellt oben heraus -> auf die erste sichtbare Zeile
  assert.strictEqual(g.r, 4); assert.strictEqual(g.f, 4); assert.strictEqual(g.ringPos().y, 176);
  g.focusTo(5);                                                      // Taste ▼: Anker-Regel wie bisher
  assert.strictEqual(g.r, 5);
  g.focusTo(20, true);                                               // ausserhalb des sichtbaren Bereichs: normal (mit Rollen)
  assert.strictEqual(g.r, 20);
  assert.ok(g.canScroll(1) && g.canScroll(-1));
  g.focusTo(39); assert.ok(!g.canScroll(1));
});

test('Zeiger-Steuerung aus: Bewegung, Randzone, Klick und Mausrad wirken nirgends', function () {
  var c = anchored(), P = c.P, T = c.T, s = c.s, keys = [];
  c.N.router.key = function (k) { keys.push(k); };
  P.move(400, 640); T.tick(100);                             // Randzone betreten, dann ausschalten
  P.setEnabled(false);
  T.tick(5000);
  assert.strictEqual(s.scrolls, 0, 'laufende Randzone endet');
  var m = s.moves;
  P.move(400, 300); P.move(500, 450); T.tick(500);
  assert.strictEqual(s.moves, m);
  P.wheel(1);
  assert.deepStrictEqual(keys, []);
  P.setEnabled(true);
  P.move(420, 330); T.tick(50);
  assert.strictEqual(s.moves, m + 1, 'wieder an: wirkt sofort');
});
