'use strict';
/* Detailkarte gleitet mit Hintergrundbild hoch (Nutzerbefund iPad/Mac 05.11., SPEC DET-21; Apple-Entscheidungen Nr. 9/16):
 * - Bild-URL sofort aus dem geoeffneten Eintrag (art/thumb), Abruf startet vor der Metadaten-Antwort, ohne 300-ms-Ruhepause;
 * - die Karte wartet kurz (N.ui.card.WAIT_MS) auf das geladene und dekodierte Bild: da -> gleitet MIT Bild hoch; langsam -> gleitet
 *   nach der Frist, das Bild blendet spaeter weich ein ("Weniger Animationen": ohne Blende);
 * - Vorladen beim Fokus/Hover (N.details.warm): nur das fokussierte, eine Anfrage zur Zeit, nicht bei Finger-Bedienung.
 * Am TV (caps.details 'page'): keine Karte, Hintergrund wie bisher erst nach der Antwort und der Ruhepause.
 * Ohne Browser: Mini-DOM, N.plex.get-Attrappe, losgeloeste Bilder als Attrappe (N.img._mkPre), kuenstliche Uhr. */
var test = require('./helpers/load').appleTest(require('node:test')), assert = require('node:assert');
var H = require('./helpers/load');

function FakeDoc() {
  function El(tag) { this.tagName = tag; this.style = {}; this.childNodes = []; this.className = ''; this.src = ''; this.offsetLeft = 0; this.offsetWidth = 100; this.offsetHeight = 40; this.scrollWidth = 100; this.clientWidth = 100; this.scrollHeight = 40; this.clientHeight = 40; }
  El.prototype.appendChild = function (c) { if (c.parentNode) c.parentNode.removeChild(c); this.childNodes.push(c); c.parentNode = this; return c; };
  El.prototype.insertBefore = function (c) { return this.appendChild(c); };
  El.prototype.removeChild = function (c) { var i = this.childNodes.indexOf(c); if (i >= 0) this.childNodes.splice(i, 1); c.parentNode = null; return c; };
  El.prototype.setAttribute = function (k, v) { this[k] = v; };
  El.prototype.getAttribute = function (k) { return this[k] === undefined ? null : this[k]; };
  El.prototype.addEventListener = function () {};
  El.prototype.removeEventListener = function () {};
  Object.defineProperty(El.prototype, 'firstChild', { get: function () { return this.childNodes[0] || null; } });
  Object.defineProperty(El.prototype, 'nextSibling', { get: function () { var p = this.parentNode, i = p ? p.childNodes.indexOf(this) : -1; return i >= 0 ? p.childNodes[i + 1] || null : null; } });
  return { createElement: function (t) { return new El(t); }, createTextNode: function (t) { return { nodeValue: t }; }, body: new El('body') };
}
function flushMicro() { return new Promise(function (r) { setImmediate(r); }); }

var IT = { rk: '7', type: 'movie', title: 'Demo-Film', lib: 3, art: '/library/metadata/7/art/1', thumb: '/library/metadata/7/thumb/1' };
function movieMeta() {
  return { MediaContainer: { librarySectionID: 3, Metadata: [{ ratingKey: '7', type: 'movie', title: 'Demo-Film', year: 2024, summary: 'Ein Film.', duration: 6000000, art: IT.art, thumb: IT.thumb }] } };
}

/* platform 'apple' (touch: iPad) oder Standard (TV) */
function setup(platform, touch) {
  var g = platform === 'apple' ? { PN_NATIVE: { hello: { caps: { touch: !!touch, tls12: true }, device: { scale: 2 } } } } : {};
  var c = H.load({ fakeTimers: true, platform: platform, globals: g }), N = c.N, T = c.timers, req = [], pres = [];
  c.document = FakeDoc();
  N.i18n.set('de');
  N.session.settings = {};
  N.session.homeCache = function () { return { libs: [{ id: 3, title: 'Filme', type: 'movie', kind: 'movie' }] }; };
  N.session.isKid = function () { return false; };
  N.plex.get = function (p, q, o, cb) { var r = { path: p, q: q || {}, o: o || {}, cb: typeof o === 'function' ? o : cb, abort: function () { r.aborted = true; } }; req.push(r); return r; };
  N.router.refreshHints = function () {};
  N.theme = { play: function () {}, stop: function () {} };
  /* losgeloestes Bild: Laden (onload) und Dekodieren (decode-Promise) per Hand */
  function Pre() { var me = this; this.src = ''; this.naturalWidth = 0; this.naturalHeight = 0; pres.push(this);
    this.decode = function () { return new Promise(function (ok) { me.ok = ok; }); };
    this.load = function () { me.naturalWidth = 2560; me.naturalHeight = 1440; if (me.onload) me.onload(); }; }
  N.img._mkPre(function () { return new Pre(); });
  var layer = c.document.createElement('div'), over = c.document.createElement('div');
  N.router.init(layer, over);
  N.router.define('base', function () { return { rail: null, onKey: function () { return false; } }; });
  N.router.push('base');
  function bgUrl() { var b = N.img.bg(IT.art, IT.thumb); return b && b.url; }
  function bgPres() { var u = bgUrl(); return pres.filter(function (p) { return p.src === u; }); }
  function meta() { return req.filter(function (r) { return r.path === '/library/metadata/7' && !r.done; }); }
  function answer(r, body) { r.done = true; r.cb(null, body); }
  return { c: c, N: N, T: T, req: req, pres: pres, bgUrl: bgUrl, bgPres: bgPres, meta: meta, answer: answer };
}
/* Hintergrund-<img> der Detailseite: erstes img.full mit Server-Bild bzw. BLANK, nicht das Scrim */
function heroBg(N) {
  var host = N.ui.card.body, out = null;
  (function walk(e) { if (out || !e || !e.childNodes) return; for (var i = 0; i < e.childNodes.length && !out; i++) { var x = e.childNodes[i]; if (x.tagName === 'img' && x.className === 'full' && !/scrim/.test(String(x.src))) out = x; else walk(x); } })(host);
  return out;
}
function sheetY(N) { var m = /translate3d\(0px,(-?\d+)px/.exec(N.ui.card.sheet.style.transform || ''); return m ? Number(m[1]) : NaN; }
function sliding(N) { return /transform \d+ms/.test(N.ui.card.sheet.style.transition || '') && sheetY(N) === 0; }

test('Detailkarte: Bild-Abruf startet sofort aus dem Eintrag (vor der Metadaten-Antwort, ohne Ruhepause), Retina-Stufe wie der Infobereich', function () {
  var a = setup('apple', true), N = a.N;
  N.details.open(IT);
  assert.strictEqual(N.router.topName(), 'details');
  assert.strictEqual(a.meta().length, 1, 'Metadaten angefragt');
  assert.strictEqual(a.bgPres().length, 1, 'Hintergrund wird schon geladen, bevor die Antwort da ist');
  assert.ok(/width=2560&height=1440/.test(a.bgUrl()), 'gleiche URL wie N.img.bg (Infobereich der Startseite): Cache-Treffer moeglich');
  a.answer(a.meta()[0], movieMeta());
  a.T.tick(1000);
  assert.strictEqual(a.bgPres().length, 1, 'gleiche Bilder nach der Antwort nicht noch einmal geladen');
});

test('Detailkarte: Bild schon da (Cache) -> Karte wartet kurz und gleitet MIT Bild hoch', async function () {
  var a = setup('apple', true), N = a.N;
  N.details.open(IT);
  assert.ok(N.ui.card.shown, 'Karte offen');
  assert.ok(sheetY(N) > 0, 'Karte steht noch unten (wartet auf das Bild)');
  assert.ok(!sliding(N));
  var p = a.bgPres()[0];
  p.load(); p.ok(); await flushMicro();
  a.T.tick(20);
  var bg = heroBg(N);
  assert.strictEqual(bg.src, a.bgUrl(), 'Bild liegt im Hintergrund-<img>');
  assert.strictEqual(bg.style.visibility, 'visible');
  assert.ok(sliding(N), 'Karte gleitet, sobald das Bild bereit ist (vor der Frist)');
  assert.ok(!bg.style.opacity || bg.style.opacity === '1', 'keine Blende: das Bild war schon beim Gleiten da');
});

test('Detailkarte: Bild langsam -> Karte gleitet nach der Frist ohne Bild, das Bild blendet spaeter weich ein', async function () {
  var a = setup('apple', true), N = a.N, W = N.ui.card.WAIT_MS;
  assert.ok(W >= 120 && W <= 180, 'Frist 120–180 ms');
  N.details.open(IT);
  a.T.tick(W - 10);
  assert.ok(!sliding(N), 'innerhalb der Frist wartet die Karte');
  a.T.tick(20);
  assert.ok(sliding(N), 'nach der Frist gleitet sie trotzdem');
  var bg = heroBg(N);
  assert.notStrictEqual(bg.style.visibility, 'visible', 'noch kein Bild');
  var p = a.bgPres()[0];
  p.load(); p.ok(); await flushMicro();
  assert.strictEqual(bg.src, a.bgUrl());
  assert.strictEqual(bg.style.visibility, 'visible');
  assert.strictEqual(bg.style.opacity, '0', 'spaetes Bild beginnt durchsichtig');
  assert.ok(/opacity \d+ms/.test(bg.style.transition || ''), 'mit Blende');
  a.T.tick(50);
  assert.strictEqual(bg.style.opacity, '1', 'blendet ein');
});

test('Detailkarte: "Weniger Animationen" -> Karte erscheint ohne Gleiten mit Bild; spaetes Bild ohne Blende', async function () {
  var a = setup('apple', true), N = a.N;
  N.fx.setReduced(true);
  N.details.open(IT);
  var p = a.bgPres()[0];
  p.load(); p.ok(); await flushMicro(); a.T.tick(20);
  assert.strictEqual(sheetY(N), 0, 'Karte steht');
  assert.ok(!/transform \d+ms/.test(N.ui.card.sheet.style.transition || ''), 'ohne Gleiten');
  assert.strictEqual(heroBg(N).style.visibility, 'visible');
  N.router.back();
  a.T.tick(500);
  var b = setup('apple', true); b.N.fx.setReduced(true);
  b.N.details.open(IT); b.T.tick(400);
  var q = b.bgPres()[0]; q.load(); q.ok(); await flushMicro();
  var bg = heroBg(b.N);
  assert.strictEqual(bg.style.visibility, 'visible');
  assert.ok(!bg.style.opacity || bg.style.opacity === '1', 'keine Blende bei weniger Animationen');
});

test('Vorladen beim Fokus/Hover: nur die fokussierte Karte, eine Anfrage zur Zeit; Finger und TV laden nicht vor', async function () {
  var a = setup('apple', false), N = a.N;
  N.input.set('pointer');
  var A = { rk: '1', type: 'movie', title: 'A', art: '/a/1', thumb: '/t/1' }, B = { rk: '2', type: 'movie', title: 'B', art: '/a/2', thumb: '/t/2' };
  var ua = N.img.bg(A.art, A.thumb).url, ub = N.img.bg(B.art, B.thumb).url;
  N.details.warm(A); a.T.tick(10); N.details.warm(B);
  a.T.tick(300);
  assert.deepStrictEqual(a.pres.map(function (p) { return p.src; }).filter(function (s) { return s === ua || s === ub; }), [ub], 'nur das zuletzt fokussierte, im Leerlauf');
  var p = a.pres[a.pres.length - 1];
  N.details.warm(B); a.T.tick(300);
  assert.strictEqual(a.pres.filter(function (x) { return x.src === ub; }).length, 1, 'laufender Abruf derselben URL: kein zweiter');
  p.load(); p.ok(); await flushMicro();
  N.details.warm(A); a.T.tick(300);
  N.details.warm(B); a.T.tick(300);
  assert.strictEqual(a.pres.filter(function (x) { return x.src === ub; }).length, 1, 'schon geladen: kein neuer Abruf');
  /* Oeffnen nach dem Vorladen: Bild im Zwischenspeicher -> die Karte bekommt es ohne Netz (nur Dekodieren) */
  var n0 = a.pres.length;
  N.details.open(B);
  var q = a.pres.slice(n0).filter(function (x) { return x.src === ub; });
  assert.strictEqual(q.length, 1, 'Karte holt das Bild (Speichertreffer)');
  // Finger: kein Vorladen (Tipp oeffnet sofort)
  var t = setup('apple', true); t.N.input.set('touch');
  t.N.details.warm(A); t.T.tick(300);
  assert.strictEqual(t.pres.length, 0, 'Finger: nichts vorgeladen');
  // TV: keine Karte, kein Vorladen
  var tv = setup();
  tv.N.details.warm(A); tv.T.tick(300);
  assert.strictEqual(tv.pres.length, 0, 'TV: nichts vorgeladen');
});

test('TV (caps.details page): keine Karte, Hintergrund wie bisher erst nach der Antwort und der Ruhepause', function () {
  var a = setup(), N = a.N;
  N.details.open(IT);
  assert.ok(!N.ui.card.el, 'keine Karte am TV');
  assert.strictEqual(a.bgPres().length, 0, 'kein vorgezogener Abruf');
  a.answer(a.meta()[0], movieMeta());
  a.T.tick(5);
  assert.strictEqual(a.pres.length, 0, 'kein losgeloestes Bild (Hintergrund direkt ins <img>, wie bisher)');
});

test('Detailkarte: Antwort mit gleichem Art, anderem Thumb -> laufender Abruf bleibt (nicht abgebrochen und neu geholt)', async function () {
  var a = setup('apple', true), N = a.N;
  N.details.open(IT);
  var mm = movieMeta(); mm.MediaContainer.Metadata[0].thumb = '/library/metadata/7/thumb/2';
  a.answer(a.meta()[0], mm);
  a.T.tick(1000);
  assert.strictEqual(a.pres.filter(function (p) { return p.src === a.bgUrl() || p.src === N.img.BLANK; }).length, 1, 'ein Abruf des Hintergrunds, keiner abgebrochen');
  var p = a.bgPres()[0];
  p.load(); p.ok(); await flushMicro();
  assert.strictEqual(heroBg(N).src, a.bgUrl(), 'Bild kommt trotzdem an');
  assert.strictEqual(heroBg(N).style.visibility, 'visible');
});
test('Detailkarte: zu, bevor das Bild kommt -> bleibt zu; naechste Karte gleitet normal', async function () {
  var a = setup('apple', true), N = a.N;
  N.details.open(IT);
  var p = a.bgPres()[0];
  N.router.back(); a.T.tick(500);
  assert.ok(!N.ui.card.shown);
  p.load(); if (p.ok) p.ok(); await flushMicro(); a.T.tick(500);
  assert.ok(!N.ui.card.shown, 'bleibt zu');
  N.details.open(IT);
  a.T.tick(200);
  assert.ok(sliding(N), 'zweite Karte gleitet');
});
