'use strict';
/* DET-13 (Nutzerbefund iPad 05.11.): Detailseite eines Titels von einem weiteren Server (N.srv) – erst die schlanken Metadaten,
 * Seite sofort; Extras/Aehnliche Titel danach im Leerlauf, hoechstens eine Wiederholung; Fehler beim Nachladen -> Seite bleibt.
 * Eigener Server: unveraendert EINE Anfrage (TV-neutral), nur ohne Kapitel/Marker (braucht die Seite nicht). Ohne Browser:
 * Mini-DOM, N.plex.get als Attrappe, kuenstliche Uhr. */
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

var FRIEND = 'aaaa1111bbbb2222cccc3333dddd4444eeee5555';
function movieMeta() {
  return { MediaContainer: { librarySectionID: 3, Metadata: [{ ratingKey: '7', type: 'movie', title: 'Demo-Film', year: 2024, summary: 'Ein Film.', duration: 6000000,
    Role: [{ id: 1, tag: 'Erika Beispiel', role: 'Heldin' }, { id: 2, tag: 'Max Muster', role: 'Freund' }] }] } };
}
function moreMeta() {
  return { MediaContainer: { Metadata: [{ ratingKey: '7', type: 'movie', title: 'Demo-Film',
    Extras: { Metadata: [{ ratingKey: '70', type: 'clip', subtype: 'trailer', extraType: 1, title: 'Trailer', duration: 120000 }] },
    Related: { Hub: [{ hubIdentifier: 'movie.similar', title: 'Aehnliche', Metadata: [{ ratingKey: '8', type: 'movie', title: 'Anderer Film' }, { ratingKey: '9', type: 'movie', title: 'Dritter Film' }] }] } }] } };
}

function open(srv) {
  var ctx = H.load({ fakeTimers: true }), N = ctx.N, T = ctx.timers, req = [], painted = [], X = null, factory = null, warns = [];
  ctx.document = FakeDoc();
  N.i18n.set('de');
  N.session.settings = {};
  N.session.homeCache = function () { return { libs: [{ id: 3, title: 'Filme', type: 'movie', kind: 'movie' }] }; };
  N.session.isKid = function () { return false; };
  N.plex.get = function (p, q, o, cb) { var r = { path: p, q: q || {}, o: o || {}, cb: cb, abort: function () { r.aborted = true; } }; req.push(r); return r; };
  N.router.refreshHints = function () {};
  N.router.top = function () { return null; };
  N.theme = { play: function () {}, stop: function () {} };
  var dl = N.diag.log;
  N.diag.log = function (lv, m) { if (lv === 'warn') warns.push(m); return dl.apply(this, arguments); };
  var paint0 = N.ui.DetHero.prototype.paint;
  N.ui.DetHero.prototype.paint = function (ov, ti) { painted.push(ti); return paint0.apply(this, arguments); };
  N.ext.on('details:open', function (x) { X = x; return null; });
  var def = N.router.define;
  N.router.define = function (n, fn) { if (n === 'details') factory = fn; };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'details.js'), 'utf8'), ctx, { filename: 'views/details.js' });
  N.router.define = def;
  var it0 = { rk: '7', type: 'movie', title: 'Demo-Film', lib: 3 };
  if (srv) it0.srv = FRIEND;
  var scr = factory({ it: it0 });
  var root = ctx.document.createElement('div');
  scr.create(root);
  scr.enter({});
  function open7() { return req.filter(function (r) { return r.path === '/library/metadata/7' && !r.done; }); }
  function answer(r, err, body) { r.done = true; r.cb(err, body); }
  return { N: N, T: T, req: req, painted: painted, X: function () { return X; }, scr: scr, open7: open7, answer: answer, warns: warns,
    btnIds: function () { var b = [], d = X.d(); N.det.buttons(d.it, d).forEach(function (x) { b.push(x.id); }); return b; } };
}

test('DET-13: weiterer Server -> erste Anfrage schlank (ohne Extras/Aehnliche/Kapitel/Marker), Seite steht sofort', function () {
  var o = open(true);
  var r = o.open7();
  assert.strictEqual(r.length, 1, 'genau eine Anfrage beim Oeffnen');
  ['includeRelated', 'includeExtras', 'includeChapters', 'includeMarkers'].forEach(function (k) { assert.ok(!r[0].q[k], k + ' nicht in der ersten Anfrage'); });
  assert.strictEqual(r[0].o.srv, FRIEND, 'Anfrage an den weiteren Server');
  o.answer(r[0], null, movieMeta());
  var X = o.X();
  assert.ok(X.d(), 'Detail-Modell steht');
  assert.strictEqual(o.painted[o.painted.length - 1], 'Demo-Film', 'Kopf gezeichnet');
  assert.strictEqual(X.d().cast.length, 2, 'Besetzung aus der schlanken Antwort');
  assert.deepStrictEqual(o.btnIds(), ['play', 'watched', 'more'], 'noch kein Trailer-Knopf');
  assert.strictEqual(X.rowIds().join(), 'cast', 'nur die Besetzung (Extras/Aehnliche kommen nach)');
});

test('DET-13: Extras/Aehnliche kommen spaeter im Leerlauf (hoechstens 1 Wiederholung) – Trailer-Knopf und Reihen erscheinen, Fokus bleibt', function () {
  var o = open(true);
  o.answer(o.open7()[0], null, movieMeta());
  var X = o.X();
  o.scr.onKey('RIGHT');                                   // Fokus auf "Gesehen"
  o.T.tick(2000);
  var more = o.open7();
  assert.strictEqual(more.length, 1, 'Nachlade-Anfrage im Leerlauf');
  assert.ok(more[0].q.includeRelated && more[0].q.includeExtras, 'Nachlade-Anfrage holt Extras + Aehnliche');
  assert.strictEqual(more[0].o.retries, 1, 'hoechstens eine Wiederholung');
  assert.strictEqual(more[0].o.srv, FRIEND);
  o.answer(more[0], null, moreMeta());
  assert.ok(X.d().trailer, 'Trailer uebernommen');
  assert.strictEqual(X.d().related[0].items.length, 2, 'Aehnliche Titel uebernommen');
  assert.deepStrictEqual(o.btnIds(), ['play', 'trailer', 'watched', 'more'], 'Trailer-Knopf jetzt da');
  assert.strictEqual(X.zone(), 'btn');
  var did = [];
  o.N.watch.toggle = function (x) { did.push('watched:' + x.rk); };
  o.N.player = { play: function (x) { did.push('play:' + x.rk); } };
  o.scr.onKey('ENTER');                                   // derselbe Knopf "Gesehen" ist fokussiert -> Gesehen-Umschalten, kein Trailer
  assert.deepStrictEqual(did, ['watched:7'], 'Fokus blieb auf "Gesehen" (nicht auf den neuen Trailer gerutscht)');
  // Reihen: nach unten erreichbar (Besetzung, Extras, Aehnliche)
  o.scr.onKey('DOWN'); o.scr.onKey('DOWN'); o.scr.onKey('DOWN');
  assert.strictEqual(X.zone(), 'row');
});

test('DET-13: Nachladen scheitert -> Seite bleibt brauchbar (keine Meldung, Besetzung bleibt), Warnung im Protokoll', function () {
  var o = open(true);
  o.answer(o.open7()[0], null, movieMeta());
  o.T.tick(2000);
  o.answer(o.open7()[0], { type: 'timeout', status: 0 }, null);
  var X = o.X();
  assert.strictEqual(X.zone(), 'btn', 'keine Fehlerseite');
  assert.ok(X.d() && X.d().cast.length === 2, 'Seite bleibt');
  assert.deepStrictEqual(o.btnIds(), ['play', 'watched', 'more']);
  assert.ok(o.warns.some(function (w) { return /det more timeout/.test(w); }), 'Warnung protokolliert');
  o.T.tick(30000);
  assert.strictEqual(o.open7().length, 0, 'keine weitere Anfrage von der Seite selbst');
});

test('DET-13: Fokus in der Besetzung, wenn Extras nachkommen -> Reihe/Fokus bleiben; Extras + Aehnliche stehen darunter', function () {
  var o = open(true);
  o.answer(o.open7()[0], null, movieMeta());
  var X = o.X();
  o.scr.onKey('DOWN');                                    // Besetzung
  o.scr.onKey('RIGHT');
  assert.strictEqual(X.zone(), 'row');
  o.T.tick(2000);
  o.answer(o.open7()[0], null, moreMeta());
  o.T.tick(500);
  assert.strictEqual(X.rowFocus(), 'cast:1', 'Fokus bleibt auf derselben Karte der Besetzung');
  assert.strictEqual(X.rowIds().join(), 'cast,extras,similar', 'Extras + Aehnliche darunter eingesetzt');
  o.scr.onKey('DOWN');
  assert.strictEqual(X.rowFocus(), 'extras:0');
  o.scr.onKey('DOWN');
  assert.strictEqual(X.rowFocus(), 'similar:0');
});

test('DET-13: eigener Server -> weiter EINE Anfrage mit Extras/Aehnlichen, ohne Kapitel/Marker; keine Nachlade-Anfrage', function () {
  var o = open(false);
  var r = o.open7();
  assert.strictEqual(r.length, 1);
  assert.ok(r[0].q.includeRelated && r[0].q.includeExtras, 'Extras + Aehnliche in derselben Anfrage (TV unveraendert)');
  assert.ok(!r[0].q.includeChapters && !r[0].q.includeMarkers, 'Kapitel/Marker holt nur der Player');
  var full = movieMeta(); full.MediaContainer.Metadata[0].Extras = moreMeta().MediaContainer.Metadata[0].Extras;
  o.answer(r[0], null, full);
  o.T.tick(5000);
  assert.strictEqual(o.open7().length, 0, 'keine zweite Anfrage');
  assert.deepStrictEqual(o.btnIds(), ['play', 'trailer', 'watched', 'more']);
});

test('DET-13: Neu laden (z. B. nach dem Player) -> Extras/Aehnliche bleiben stehen, bis die neue Nachlade-Antwort da ist', function () {
  var o = open(true);
  o.answer(o.open7()[0], null, movieMeta());
  o.T.tick(2000);
  o.answer(o.open7()[0], null, moreMeta());
  var X = o.X();
  assert.strictEqual(X.rowIds().join(), 'cast,extras,similar');
  X.reload();
  o.answer(o.open7()[0], null, movieMeta());               // schlanke Antwort ohne Extras
  assert.strictEqual(X.rowIds().join(), 'cast,extras,similar', 'Reihen bleiben');
  assert.ok(X.d().trailer, 'Trailer-Knopf bleibt');
  o.T.tick(2000);
  o.answer(o.open7()[0], null, moreMeta());
  assert.strictEqual(X.rowIds().join(), 'cast,extras,similar');
});
