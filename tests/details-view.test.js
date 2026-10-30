'use strict';
/* Detailseite einer Serie (views/details.js) ohne Browser: Mini-DOM, N.plex.get als Attrappe (Antworten per Hand, Reihenfolge
 * steuerbar), kuenstliche Uhr. Audit 1.0.6 (M1): Seite 0 der Folgen startete ohne Rueckruf (Platzhalter -> ensureEpPages), der
 * Rueckruf von loadSeason ging verloren -> keine Folgenwahl, kein Sprung in die Folgenreihe, Info-Block blieb beim Platzhalter. */
var test = require('node:test'), assert = require('node:assert');
var fs = require('fs'), path = require('path'), vm = require('vm');
var H = require('./helpers/load');

function FakeDoc() {
  function El(tag) { this.tagName = tag; this.style = {}; this.childNodes = []; this.className = ''; this.src = ''; this.offsetLeft = 0; this.offsetWidth = 100; this.offsetHeight = 40; this.scrollWidth = 100; this.clientWidth = 100; this.scrollHeight = 40; this.clientHeight = 40; }
  El.prototype.appendChild = function (c) { this.childNodes.push(c); c.parentNode = this; return c; };
  El.prototype.insertBefore = function (c) { return this.appendChild(c); };
  El.prototype.removeChild = function (c) { var i = this.childNodes.indexOf(c); if (i >= 0) this.childNodes.splice(i, 1); c.parentNode = null; return c; };
  El.prototype.setAttribute = function (k, v) { this[k] = v; };
  El.prototype.getAttribute = function (k) { return this[k] === undefined ? null : this[k]; };
  El.prototype.addEventListener = function () {};
  El.prototype.removeEventListener = function () {};
  Object.defineProperty(El.prototype, 'firstChild', { get: function () { return this.childNodes[0] || null; } });
  return { createElement: function (t) { return new El(t); }, createTextNode: function (t) { return { nodeValue: t }; }, body: new El('body') };
}

function ep(s, e, viewed) { return { ratingKey: String(100 * s + e), type: 'episode', title: 'Titel ' + e, index: e, parentIndex: s, grandparentTitle: 'Demo-Serie', grandparentRatingKey: '9', parentRatingKey: '90' + s, viewCount: viewed ? 1 : 0, duration: 1500000 }; }

function open(it0, eps2, xt) {
  var ctx = H.load({ fakeTimers: true }), N = ctx.N, T = ctx.timers, req = [], painted = [], X = null, factory = null;
  ctx.document = FakeDoc();
  N.i18n.set('de');
  N.session.settings = { episodeProgress: true, seriesProgress: true };
  N.session.homeCache = function () { return { libs: [{ id: 2, title: 'Serien', type: 'show', kind: 'show' }] }; };
  N.session.isKid = function () { return false; };
  N.plex.get = function (p, q, o, cb) { var r = { path: p, cb: cb, abort: function () {} }; req.push(r); return r; };
  N.router.refreshHints = function () {};
  N.router.top = function () { return null; };
  N.theme = { play: function () {}, stop: function () {} };
  var paint0 = N.ui.DetHero.prototype.paint;
  N.ui.DetHero.prototype.paint = function (ov, ti) { painted.push(ti); return paint0.apply(this, arguments); };
  N.ext.on('details:open', function (x) { X = x; return xt || null; });   // nur mitlesen (zone, eps, focusedEp), nichts aendern; xt: Test-Erweiterung
  var def = N.router.define;
  N.router.define = function (n, fn) { if (n === 'details') factory = fn; };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'details.js'), 'utf8'), ctx, { filename: 'views/details.js' });
  N.router.define = def;
  var scr = factory({ it: it0 });
  var root = ctx.document.createElement('div');
  scr.create(root);
  scr.enter({});
  function answer(re, body) {
    for (var i = 0; i < req.length; i++) if (!req[i].done && re.test(req[i].path)) { req[i].done = true; req[i].cb(null, body); return; }
    throw new Error('keine offene Anfrage ' + re + ': ' + req.map(function (r) { return r.path; }).join(', '));
  }
  answer(/^\/library\/metadata\/9$/, { MediaContainer: { librarySectionID: 2, Metadata: [{ ratingKey: '9', type: 'show', title: 'Demo-Serie', leafCount: 3 + eps2.length, viewedLeafCount: 2, childCount: 2 }] } });
  answer(/^\/library\/metadata\/9\/children$/, { MediaContainer: { Metadata: [
    { ratingKey: '901', type: 'season', index: 1, title: 'Staffel 1', leafCount: 3, viewedLeafCount: 3 },
    { ratingKey: '902', type: 'season', index: 2, title: 'Staffel 2', leafCount: eps2.length, viewedLeafCount: 1 }] } });
  T.tick(10);
  return { N: N, T: T, req: req, root: root, painted: painted, X: function () { return X; }, answer: answer, scr: scr,
    pages: function (rk) { return req.filter(function (r) { return r.path === '/library/metadata/' + rk + '/children'; }).length; } };
}

test('M1: Serie ueber eine Folge geoeffnet (z. B. Weiterschauen) -> Seite 0 einmal, Fokus und Info-Block auf genau dieser Folge', function () {
  var eps2 = [ep(2, 1, true), ep(2, 2), ep(2, 3), ep(2, 4)];
  var o = open({ rk: '203', type: 'episode', s: 2, e: 3, showRk: '9', title: 'Demo-Serie', lib: 2 }, eps2);
  assert.strictEqual(o.pages('902'), 1, 'Seite 0 nur einmal angefragt (laufende Anfrage wird mitbenutzt)');
  o.answer(/\/902\/children$/, { MediaContainer: { totalSize: 4, Metadata: eps2 } });
  o.T.tick(2000);
  var X = o.X();
  assert.strictEqual(X.zone(), 'eps', 'Sprung in die Folgenreihe (s.entered)');
  assert.strictEqual(X.focusedEp().e, 3, 'Fokus auf der geoeffneten Folge');
  assert.strictEqual(o.painted[o.painted.length - 1], 'Folge 3 · Titel 3', 'Info-Block zeigt die Folge, keinen Platzhalter');
});

test('M1: Serie aus der Bibliothek -> erste ungesehene Folge gewaehlt, Fokus bleibt auf den Knoepfen; Reiter zeigen die Folge der Staffel', function () {
  var eps2 = [ep(2, 1, true), ep(2, 2), ep(2, 3)];
  var o = open({ rk: '9', type: 'show', title: 'Demo-Serie', lib: 2 }, eps2);
  assert.strictEqual(o.pages('902'), 1);
  o.answer(/\/902\/children$/, { MediaContainer: { totalSize: 3, Metadata: eps2 } });
  o.T.tick(2000);
  var X = o.X();
  assert.strictEqual(X.zone(), 'btn');
  assert.ok(!X.eps()[0].ph, 'Folgen geladen');
  assert.strictEqual(o.painted[o.painted.length - 1], 'Demo-Serie');
  o.scr.onKey('DOWN'); o.T.tick(1000);
  assert.strictEqual(X.zone(), 'tabs');
  assert.strictEqual(o.painted[o.painted.length - 1], 'Folge 2 · Titel 2', 'Reiter: Info zur ersten ungesehenen Folge der gewaehlten Staffel');
});

test('Sollte 9: Reiter wechseln -> Info-Block folgt der neu gewaehlten Staffel (nicht die Folge der vorigen)', function () {
  var eps2 = [ep(2, 1, true), ep(2, 2)], eps1 = [ep(1, 1, true), ep(1, 2, true), ep(1, 3, true)];
  var o = open({ rk: '9', type: 'show', title: 'Demo-Serie', lib: 2 }, eps2);
  o.answer(/\/902\/children$/, { MediaContainer: { totalSize: 2, Metadata: eps2 } });
  o.T.tick(2000);
  o.scr.onKey('DOWN'); o.T.tick(1000);
  assert.strictEqual(o.painted[o.painted.length - 1], 'Folge 2 · Titel 2');
  o.scr.onKey('LEFT'); o.T.tick(1000);                 // Staffel 1
  o.answer(/\/901\/children$/, { MediaContainer: { totalSize: 3, Metadata: eps1 } });
  o.T.tick(1000);
  assert.strictEqual(o.X().zone(), 'tabs');
  assert.strictEqual(o.painted[o.painted.length - 1], 'Folge 1 · Titel 1', 'Info zur Staffel 1 (alles gesehen -> Folge 1)');
});

/* Zeile einer Erweiterung unter der Beschreibung (DET-3, z. B. naechste Folge): ohne Text kein Element; nur fuer die Serie selbst;
 * spaeter nachgereicht blendet nur sie ein (der Info-Block zeichnet nicht neu) */
function find(el, cls, out) { out = out || []; if (el.className && (' ' + el.className + ' ').indexOf(' ' + cls + ' ') >= 0) out.push(el); (el.childNodes || []).forEach(function (c) { find(c, cls, out); }); return out; }

test('DET-3 Zeile unter der Beschreibung: ohne Erweiterung bzw. ohne Text kein Element (Seite wie bisher)', function () {
  var o = open({ rk: '9', type: 'show', title: 'Demo-Serie', lib: 2 }, [ep(2, 1)]);
  o.T.tick(1000); o.X().note();
  H.eq(find(o.root, 'd-note').length, 0);
  var p = open({ rk: '9', type: 'show', title: 'Demo-Serie', lib: 2 }, [ep(2, 1)], { note: function () { return ''; } });
  p.T.tick(1000); p.X().note();
  H.eq(find(p.root, 'd-note').length, 0);
});

test('DET-3 Zeile unter der Beschreibung: Text der Erweiterung nur auf Serien-Ebene, nachgereicht ohne Neuzeichnen des Info-Blocks', function () {
  var txt = '', eps2 = [ep(2, 1, true), ep(2, 2)];
  var o = open({ rk: '9', type: 'show', title: 'Demo-Serie', lib: 2 }, eps2, { note: function () { return txt; } });
  o.answer(/\/902\/children$/, { MediaContainer: { totalSize: 2, Metadata: eps2 } });
  o.T.tick(1000);
  H.eq(find(o.root, 'd-note').length, 0, 'noch kein Text');
  var n = o.painted.length;
  txt = 'Nächste Folge: S2 · F3 am Do., 5. Nov.'; o.X().note(); o.T.tick(100);
  var el = find(o.root, 'd-note');
  H.eq([el.length, el[0].firstChild.nodeValue, el[0].style.display, o.painted.length], [1, txt, '', n], 'nur die Zeile, kein paint()');
  assert.ok(!/\bout\b/.test(el[0].className), 'eingeblendet');
  o.scr.onKey('DOWN'); o.T.tick(1000); o.scr.onKey('DOWN'); o.T.tick(1000);
  assert.strictEqual(o.X().zone(), 'eps');
  assert.strictEqual(el[0].style.display, 'none', 'Folge im Info-Block: keine Zeile');
});

/* TV-Test 30.10.: nach STOP begann "Abspielen" auf der Serienseite bei 0:01 ohne Fortsetzen-Frage. Ursache: s.enter setzte dirty gleich
 * nach load() zurueck, loadSeason nahm die Folgen aus dem 5-Min.-Zwischenspeicher (Position von VOR dem Abspielen). */
test('Rueckkehr aus dem Player: Folgen der Staffel frisch vom Server (nicht aus dem Zwischenspeicher), Position der Folge aktuell', function () {
  var eps2 = [ep(2, 1, true), ep(2, 2), ep(2, 3)];
  var o = open({ rk: '203', type: 'episode', s: 2, e: 3, showRk: '9', title: 'Demo-Serie', lib: 2 }, eps2);
  o.answer(/\/902\/children$/, { MediaContainer: { totalSize: 3, Metadata: eps2 } });
  o.T.tick(2000);
  assert.strictEqual(o.X().focusedEp().off || 0, 0);
  o.scr.leave();
  o.N.evt.emit('playback:stopped', { rk: '203', video: true, done: false });
  o.scr.enter({});
  o.answer(/^\/library\/metadata\/9$/, { MediaContainer: { librarySectionID: 2, Metadata: [{ ratingKey: '9', type: 'show', title: 'Demo-Serie', leafCount: 6, viewedLeafCount: 2, childCount: 2 }] } });
  o.answer(/^\/library\/metadata\/9\/children$/, { MediaContainer: { Metadata: [
    { ratingKey: '901', type: 'season', index: 1, title: 'Staffel 1', leafCount: 3, viewedLeafCount: 3 },
    { ratingKey: '902', type: 'season', index: 2, title: 'Staffel 2', leafCount: 3, viewedLeafCount: 1 }] } });
  o.T.tick(10);
  assert.strictEqual(o.pages('902'), 2, 'Folgen der Staffel neu angefragt');
  var now = eps2.map(function (x) { return JSON.parse(JSON.stringify(x)); }); now[2].viewOffset = 657000;
  o.answer(/\/902\/children$/, { MediaContainer: { totalSize: 3, Metadata: now } });
  o.T.tick(2000);
  var e3 = o.X().eps().filter(function (x) { return x.e === 3; })[0];
  assert.strictEqual(e3.off, 657000, 'Folge 3 mit der Position nach dem Stopp');
});

test('Fortsetzen: eigene Stopp-Stelle gilt, solange der Server noch eine kleinere Position nennt (hoechstens 10 Min.)', function () {
  var N = H.load().N, R = N.player.resumeAt, now = 5000000;
  var it = { rk: '203', type: 'episode', off: 0, dur: 1500000 };
  var st = { rk: '203', srv: '', off: 657000, at: now - 3000 };
  assert.strictEqual(R(it, st, now), 657000, 'Server noch 0 -> eigene Stelle');
  assert.strictEqual(R({ rk: '203', type: 'episode', off: 660000, dur: 1500000 }, st, now), 660000, 'Server weiter -> Server');
  assert.strictEqual(R(it, st, now + 700000), 0, 'nach 10 Min. gilt der Server');
  assert.strictEqual(R({ rk: '204', type: 'episode', off: 0, dur: 1500000 }, st, now), 0, 'anderer Titel');
  assert.strictEqual(R(it, { rk: '203', srv: '', off: 1450000, at: now }, now), 0, 'fast zu Ende (gesehen) -> keine Stelle');
  assert.strictEqual(R(it, null, now), 0);
});
