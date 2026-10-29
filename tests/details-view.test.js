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

function open(it0, eps2) {
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
  N.ext.on('details:open', function (x) { X = x; return null; });   // nur mitlesen (zone, eps, focusedEp), nichts aendern
  var def = N.router.define;
  N.router.define = function (n, fn) { if (n === 'details') factory = fn; };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'details.js'), 'utf8'), ctx, { filename: 'views/details.js' });
  N.router.define = def;
  var scr = factory({ it: it0 });
  scr.create(ctx.document.createElement('div'));
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
  return { N: N, T: T, req: req, painted: painted, X: function () { return X; }, answer: answer, scr: scr,
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
