'use strict';
/* Weiterhoeren und Mini-Player mit Finger/Maus (Nutzerbefund iPad 05.11., DET-10, MUS-7) ohne Browser: Mini-DOM, kuenstliche Uhr.
 * - Apple (caps.cardTap 'details'): Tipp (Finger) bzw. Klick (Maus) auf eine Weiterhoeren-Kachel oeffnet sofort die Karte des Buchs
 *   (Album-Eintrag, "Fortsetzen" zuerst) statt abzuspielen; Tasten (OK) setzen wie am TV sofort fort.
 * - TV (samsung-orsay): OK auf Weiterhoeren unveraendert (N.music.open -> Fortsetzen), keine Karte.
 * - Mini-Player: Trefferflaeche dort, wo die Leiste steht (flexibel unten statt fest y 572); Apple: Schliessen beendet die
 *   Wiedergabe, Play/Pause schaltet um, Rest oeffnet Jetzt laeuft; TV: ganze Leiste = Jetzt laeuft, kein Schliessen-Knopf. */
var test = require('node:test'), assert = require('node:assert');
var fs = require('fs'), path = require('path'), vm = require('vm');
var H = require('./helpers/load');
var atest = H.appleTest(test);

function FakeDoc() {
  function El(tag) { this.tagName = tag; this.style = {}; this.childNodes = []; this.className = ''; this.src = ''; }
  El.prototype.appendChild = function (c) { this.childNodes.push(c); c.parentNode = this; return c; };
  El.prototype.insertBefore = function (c) { return this.appendChild(c); };
  El.prototype.removeChild = function (c) { var i = this.childNodes.indexOf(c); if (i >= 0) this.childNodes.splice(i, 1); c.parentNode = null; return c; };
  El.prototype.setAttribute = function (k, v) { this[k] = v; };
  El.prototype.addEventListener = function () {};
  Object.defineProperty(El.prototype, 'firstChild', { get: function () { return this.childNodes[0] || null; } });
  return { createElement: function (t) { return new El(t); }, createTextNode: function (t) { return { nodeValue: t }; }, body: new El('body') };
}
function track(n) {
  return { rk: 't' + n, type: 'track', lib: 7, title: 'Kapitel ' + n, artist: 'Demo-Autorin', album: 'Demo-Hoerspiel ' + n, albumRk: 'b' + n, artistRk: 'a1',
    dur: 600000, off: 120000, vc: 0, lv: 1000 - n, thumb: '/t/b' + n, art: '', year: 2020, vleaf: 0, leaf: 0, child: 0 };
}
function movie(rk) { return { rk: rk, type: 'movie', title: 'Demo ' + rk, thumb: '/t/' + rk, still: '/s/' + rk, art: '/a/' + rk, vc: 0, off: 0, dur: 0, leaf: 1, vleaf: 0 }; }

/* Startseite mit Reihe "Weiterhoeren" oben. o: {platform, mode ('touch'|'pointer'|'key')} */
function home(o) {
  o = o || {};
  var c = H.load({ fakeTimers: true, platform: o.platform || 'apple' }), N = c.N, T = c.timers, frames = [], log = [];
  c.document = FakeDoc();
  N.util.raf = function (f) { frames.push(f); return frames.length; };
  N.i18n.set('de');
  N.input.on = true; N.input.mode = o.mode || 'touch';
  N.ui.Hero = function () {};
  N.ui.Hero.prototype = { set: function () {}, clear: function () {}, refresh: function () {}, setStrip: function () {}, paintOv: function () {} };
  N.ui.Ambient = function () {};
  N.ui.Ambient.prototype = { enter: function () {}, focus: function () {}, data: function () {}, destroy: function () {} };
  N.ui.Ring = function () {};
  N.ui.Ring.prototype = { prep: function () {}, to: function () {}, hide: function () {} };
  N.ui.StateBlock = function () {};
  N.ui.StateBlock.prototype = { show: function () {}, hide: function () {}, setText: function () {} };
  N.ui.rail = { setData: function () {}, isOpen: function () { return false; }, open: function () {} };
  N.router.refreshHints = function () {};
  N.details = { open: function (it) { log.push(['details', it]); }, play: function () {} };
  N.music.open = function (it) { log.push(['music.open', it]); return true; };
  N.music.play = function (it) { log.push(['music.play', it]); return true; };
  N.player.play = function (it) { log.push(['player', it]); };
  N.img.warm = function () {};
  var libs = [{ id: 1, type: 'movie', title: 'Filme', kind: 'movie', loc: [] }];
  var ab = { id: 'ab', kind: 'sq', tk: 'mu.row.continue', tp: null, items: N.music.continueCards([track(1), track(2), track(3)]) };
  var mv = { id: 'm', kind: 'poster', tk: 'home.row.newIn', tp: { library: 'Filme' }, items: [movie('m0'), movie('m1'), movie('m2')] };
  var rows = [ab, mv], cache = { v: 1, libs: libs, alibs: libs, rows: rows };
  N.session = { profile: { uuid: 'p1' }, settings: { homeRows: rows.map(function (r) { return { id: r.id, on: true }; }) }, homeCache: function () { return cache; }, setHomeCache: function () {},
    hubCatalog: function () { return null; }, setHubCatalog: function () {}, refreshUsersLater: function () {}, isKid: function () { return false; } };
  N.hubs.fetch = function () { return { abort: function () {} }; };
  N.hubs.order = function () { return rows.map(function (r) { return r.id; }); };
  N.hubs.pick = function (r) { return r; };
  var defs = {}, real = N.router.define;
  N.router.define = function (n, f) { defs[n] = f; };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'home.js'), 'utf8'), c, { filename: 'views/home.js' });
  N.router.define = real;
  var s = defs.home({}), root = c.document.createElement('div');
  s.create(root); s.enter({}, null);
  for (var i = 0; i < 40 && frames.length; i++) { T.tick(16); frames.shift()(); }
  return { N: N, T: T, s: s, log: log, ab: ab };
}

test('listenAlbum: Weiterhoeren-Karte -> Album-Eintrag des Buchs; andere Titel und Track ohne Album -> null', function () {
  var N = H.load({}).N;
  var card = N.music.continueCards([track(4)])[0], a = N.music.listenAlbum(card);
  assert.deepStrictEqual([a.rk, a.type, a.kind, a.title, a.artist, a.lib, a.thumb], ['b4', 'album', 'audio', 'Demo-Hoerspiel 4', 'Demo-Autorin', 7, '/t/b4']);
  assert.strictEqual(N.music.listenAlbum(track(4)), null, 'normaler Musiktitel (ohne kind audio) bleibt beim Abspielen');
  var lone = N.music.continueCards([track(5)])[0]; lone.albumRk = '';
  assert.strictEqual(N.music.listenAlbum(lone), null, 'ohne Album: kein Ziel fuer eine Karte');
  assert.strictEqual(N.music.listenAlbum(movie('x')), null);
});

atest('Apple, Finger: ein Tipp auf Weiterhoeren oeffnet sofort die Karte des Buchs (kein Fokus-Schritt, kein Abspielen)', function () {
  var a = home({ mode: 'touch' }), x = 144 + 20, y = 88 + 52 + 60;
  a.s.pointer(x, y, 'click');                                       // Tipp ohne vorherige Bewegung: ein Schritt
  assert.strictEqual(a.log.length, 1, JSON.stringify(a.log));
  assert.strictEqual(a.log[0][0], 'details');
  assert.deepStrictEqual([a.log[0][1].rk, a.log[0][1].type], ['b1', 'album']);
  // zweite Kachel ebenso direkt
  a.s.pointer(x + 200, y, 'move'); a.s.pointer(x + 200, y, 'click');
  assert.deepStrictEqual(a.log.map(function (l) { return l[0] + ':' + l[1].rk; }), ['details:b1', 'details:b2']);
});

atest('Apple, Maus/Trackpad: Klick auf Weiterhoeren oeffnet die Karte wie bei Filmen und Serien', function () {
  var a = home({ mode: 'pointer' }), x = 144 + 20, y = 88 + 52 + 60;
  a.s.pointer(x, y, 'move'); a.s.pointer(x, y, 'click');
  assert.deepStrictEqual(a.log.map(function (l) { return l[0] + ':' + l[1].rk; }), ['details:b1']);
});

atest('Apple, Tasten: OK auf Weiterhoeren setzt sofort fort wie am TV; PLAY ebenso', function () {
  var a = home({ mode: 'key' });
  a.s.onKey('ENTER');
  a.s.onKey('PLAY');
  assert.deepStrictEqual(a.log.map(function (l) { return l[0] + ':' + l[1].rk; }), ['music.open:t1', 'music.play:t1']);
});

test('TV: OK auf Weiterhoeren unveraendert (N.music.open mit dem Track = Fortsetzen), keine Karte; Faehigkeit cardTap ok', function () {
  var a = home({ platform: 'samsung-orsay', mode: 'key' });
  assert.strictEqual(a.N.platform.caps.cardTap, 'ok');
  assert.strictEqual(a.N.platform.caps.details, 'page');
  a.s.onKey('ENTER');
  a.s.onKey('PLAY');
  assert.deepStrictEqual(a.log.map(function (l) { return l[0] + ':' + l[1].rk; }), ['music.open:t1', 'music.play:t1']);
  assert.strictEqual(a.log[0][1].type, 'track');
  // Zeiger der Smart-Fernbedienung: Klick wie OK (kein Kartenweg)
  a.log.length = 0;
  if (a.s.pointer) { a.s.pointer(144 + 20, 320 + 52 + 60, 'click'); a.log.forEach(function (l) { assert.notStrictEqual(l[0], 'details'); }); }
});

/* Mini-Player: o {platform, flex: {w, h}, top (CSS-Lage der Leiste, flexibel)} */
function mini(o) {
  o = o || {};
  var ctx = H.load({ fakeTimers: true, platform: o.platform || 'apple' }), N = ctx.N, calls = [];
  ctx.document = FakeDoc();
  N.i18n.set('de');
  if (o.flex) {
    N.platform.caps.screen.flex = true;
    N.platform.screen.size = function () { return { w: o.flex.w, h: o.flex.h }; };
    N.screen.init();
  }
  var c = { state: 'playing', t: 1000, item: { rk: '1', type: 'track', title: 'Kapitel 1', album: 'Demo-Hoerspiel', artist: 'Demo-Autorin', thumb: '' }, book: true, ctx: null,
    dur: function () { return 60000; } };
  var act = true;
  N.audio.core = function () { return c; }; N.audio.active = function () { return act; };
  N.audio.stop = function (w) { calls.push('stop'); act = false; c.state = 'stopped'; };
  N.audio.toggle = function () { calls.push('toggle'); c.state = c.state === 'paused' ? 'playing' : 'paused'; };
  N.audio.restart = function () { calls.push('restart'); };
  N.router.topName = function () { return 'home'; }; N.router.top = function () { return {}; };
  N.router.push = function (n) { calls.push('push:' + n); };
  var M = N.ui.mini;
  M.init(ctx.document.createElement('div'));
  if (o.flex) { M.el.offsetLeft = 856; M.el.offsetTop = o.top; M.el.offsetHeight = 64; M.el.offsetWidth = 360; }
  M.update(true);
  return { N: N, M: M, calls: calls };
}

atest('Apple-Mini-Player: Treffer dort, wo er steht (unten), Schliessen beendet, Play/Pause schaltet, Rest oeffnet Jetzt laeuft', function () {
  var a = mini({ flex: { w: 1366, h: 1024 }, top: 1024 - 84 - 64 });   // iPad quer: flex.css bottom 84
  var M = a.M, Y = 1024 - 84 - 64;
  assert.ok(M.on && M.btns, 'sichtbar, mit eigenen Knoepfen');
  assert.ok(M.xb, 'Schliessen-Knopf vorhanden');
  assert.strictEqual(M.pointer(900, 572 + 20, 'click'), false, 'alte feste Lage (y 572) trifft nichts mehr');
  assert.deepStrictEqual(a.calls, []);
  assert.strictEqual(M.pointer(856 + 100, Y + 30, 'click'), true);
  assert.deepStrictEqual(a.calls, ['push:nowplaying'], 'Tipp auf Titel/Cover: Jetzt laeuft');
  assert.strictEqual(M.pointer(856 + 266, Y + 2, 'click'), true);
  assert.deepStrictEqual(a.calls.slice(1), ['toggle'], 'Play/Pause (ganze Hoehe)');
  assert.strictEqual(M.ic.style.backgroundPositionX, (-a.N.ui.ICONS.play * 32) + 'px', 'pausiert: Symbol Play');
  assert.strictEqual(M.pointer(856 + 300, Y + 62, 'click'), true);
  assert.deepStrictEqual(a.calls.slice(2), ['stop'], 'Schliessen beendet die Wiedergabe');
  assert.strictEqual(M.on, false, 'Leiste geht sofort zu');
  assert.strictEqual(M.pointer(856 + 300, Y + 30, 'click'), false, 'danach kein Treffer mehr');
});

atest('Apple: Mini-Player-Feld geht vor der Detailkarte (liegt sichtbar darueber)', function () {
  var a = mini({ flex: { w: 1366, h: 1024 }, top: 876 }), N = a.N, cardHits = 0;
  N.router.cardFrame = function () { return { x: 0, y: 32, w: 1366, h: 992, k: 1 }; };
  N.ui.card = { hit: function () { cardHits++; return 'in'; }, on: function () { return true; } };
  N.router.top = function () { return { pointer: function () { cardHits++; return true; } }; };
  // ueber P.click (oeffentlicher Weg wie Finger/Maus): Bewegung + Klick
  N.pointer.click(856 + 330, 876 + 30, null);
  assert.ok(a.calls.indexOf('stop') >= 0, 'Schliessen ueber der Karte beendet: ' + a.calls);
  assert.strictEqual(cardHits, 0, 'Karte bekommt den Tipp nicht');
});

test('TV-Mini-Player unveraendert: feste Lage y 572, ganze Leiste = Jetzt laeuft, kein Schliessen-Knopf, B-Kappe sichtbar', function () {
  var a = mini({ platform: 'samsung-orsay' }), M = a.M;
  assert.strictEqual(M.btns, false);
  assert.strictEqual(M.xb, undefined);
  assert.strictEqual(M.pointer(856 + 330, 572 + 30, 'click'), true);
  assert.strictEqual(M.pointer(856 + 266, 572 + 30, 'click'), true);
  assert.deepStrictEqual(a.calls, ['push:nowplaying', 'push:nowplaying'], 'auch rechts: Jetzt laeuft, nie Stopp');
  assert.strictEqual(M.pointer(856 + 100, 900, 'click'), false);
});

/* Jetzt laeuft mit Knopf "Beenden" (MUS-6; Smart-Touch-Fernbedienung ohne STOP-Taste, Nutzerwunsch 05.11.). o: {platform, book, mode} */
function np(o) {
  o = o || {};
  var ctx = H.load({ fakeTimers: true, platform: o.platform || 'samsung-orsay' }), N = ctx.N, calls = [];
  ctx.document = FakeDoc();
  N.i18n.set('de');
  N.input.on = true; N.input.mode = o.mode || 'key';
  var items = [{ rk: '1', type: 'track', title: 'Kapitel 1', album: 'Demo-Hoerspiel', artist: 'Demo-Autorin', thumb: '', dur: 60000 }, { rk: '2', type: 'track', title: 'Kapitel 2', dur: 60000 }];
  var c = { state: 'playing', t: 1000, item: items[0], book: !!o.book, ctx: null, chs: [], sleep: { mode: 'off' }, errKind: '',
    q: { pos: 0, items: items, shuffle: false, repeat: 'off', size: function () { return 2; }, nextPos: function () { return 1; }, itemAt: function (i) { return items[i]; } },
    dur: function () { return 60000; }, active: function () { return c.state !== 'stopped'; }, chapterAt: function () { return -1; },
    stop: function (w) { calls.push('stop:' + w); c.state = 'stopped'; }, toggle: function () { calls.push('toggle'); }, seekTo: function () {} };
  N.audio.core = function () { return c; }; N.audio.active = function () { return c.active(); };
  N.router.back = function () { calls.push('back'); };
  N.router.refreshHints = function () {};
  N.ui.rail = { cur: 'home', open: function () { calls.push('rail'); }, isOpen: function () { return false; } };
  N.img.want = function () {}; N.img.drop = function () {};
  var defs = {}, real = N.router.define;
  N.router.define = function (n, f) { defs[n] = f; };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'nowplaying.js'), 'utf8'), ctx, { filename: 'views/nowplaying.js' });
  N.router.define = real;
  var s = defs.nowplaying({}), root = ctx.document.createElement('div');
  s.create(root); s.enter({}, null);
  function all(el, k, out) { out = out || []; if ((' ' + el.className + ' ').indexOf(' ' + k + ' ') >= 0) out.push(el); (el.childNodes || []).forEach(function (x) { if (x.childNodes) all(x, k, out); }); return out; }
  return { N: N, s: s, calls: calls, btns: all(root, 'np-b'), lbl: all(root, 'np-lbl')[0] };
}

test('TV Jetzt laeuft: "Beenden" ganz rechts (Musik und Hoerbuch), OK beendet wie STOP und geht zurueck; Reihe in der sicheren Flaeche', function () {
  [false, true].forEach(function (book) {
    var a = np({ book: book }), last = a.btns[a.btns.length - 1], N = a.N;
    assert.strictEqual(a.btns.length, book ? 8 : 10, (book ? 'Hoerbuch' : 'Musik') + ': ein Knopf dazu');
    assert.strictEqual(last.childNodes[0].style.backgroundPositionX, (-N.ui.ICONS.stop * 32) + 'px', 'Symbol Stopp (Quadrat)');
    assert.ok(last._x + last._w <= 1216, 'rechts in der sicheren Flaeche: ' + (last._x + last._w));
    assert.strictEqual(a.btns[0]._x, 600, 'Reihe beginnt wie immer bei x 600');
    if (book) assert.strictEqual(a.btns[1]._x, 600 + 48 + 16, 'Hoerbuch: Luecke 16 wie bisher');
    for (var i = 0; i < a.btns.length; i++) a.s.onKey('RIGHT');
    assert.ok(/is-focus/.test(last.className), 'Fokus erreicht "Beenden"');
    assert.strictEqual(a.lbl.childNodes[0].childNodes[0].nodeValue, 'Beenden');
    assert.deepStrictEqual(a.calls, []);
    a.s.onKey('ENTER');
    assert.deepStrictEqual(a.calls, ['stop:STOP', 'back'], 'wie die STOP-Taste');
  });
  var k = np();
  k.s.onKey('STOP');
  assert.deepStrictEqual(k.calls, ['stop:STOP', 'back'], 'STOP-Taste unveraendert');
  var p = np();
  p.s.onKey('ENTER');
  assert.deepStrictEqual(p.calls, ['toggle'], 'Fokus startet auf Play/Pause wie bisher');
});

atest('Apple Jetzt laeuft: Tipp/Klick auf "Beenden" beendet die Wiedergabe und geht zurueck', function () {
  ['touch', 'pointer'].forEach(function (mode) {
    var a = np({ platform: 'apple', mode: mode }), last = a.btns[a.btns.length - 1];
    assert.strictEqual(a.s.pointer(last._x + 24, last._y + 24, 'click'), true);
    assert.deepStrictEqual(a.calls, ['stop:STOP', 'back'], mode);
  });
});

atest('Apple-Mini-Player: im schmalen Fenster (iPhone hochkant) nie ueber den rechten Rand (vorher fest left 856)', function () {
  var a = mini({ flex: { w: 390, h: 844 }, top: 844 - 84 - 64 }), M = a.M, vw = a.N.screen.view().w;
  var left = parseInt(M.el.style.left, 10);
  assert.ok(left + 360 <= vw, 'rechte Kante ' + (left + 360) + ' <= Breite ' + vw);
  assert.ok(left >= 16, 'links nicht abgeschnitten: ' + left);
});
