'use strict';
/* TV-Test 27.10. nachmittags (M4 Musik/Hoerbuecher, F25–F30): Titelkarten ohne Bild, Albumtitel-Ersatz, Album- vor Autorenbild,
 * Platz unter dem Mini-Player, Play/Pause-Symbol im Mini-Player, lange Bibliotheksnamen in der Seitenleiste. Mini-DOM ohne Browser. */
var test = require('node:test'), assert = require('node:assert');
var H = require('./helpers/load');

function FakeDoc() {
  function El(tag) { this.tagName = tag; this.style = {}; this.childNodes = []; this.className = ''; this.src = ''; }
  El.prototype.appendChild = function (c) { this.childNodes.push(c); c.parentNode = this; return c; };
  El.prototype.removeChild = function (c) { var i = this.childNodes.indexOf(c); if (i >= 0) this.childNodes.splice(i, 1); c.parentNode = null; return c; };
  Object.defineProperty(El.prototype, 'firstChild', { get: function () { return this.childNodes[0] || null; } });
  return { createElement: function (t) { return new El(t); }, createTextNode: function (t) { return { nodeValue: t }; } };
}
function setup() {
  var ctx = H.load({ fakeTimers: true }), N = ctx.N;
  ctx.document = FakeDoc();
  N.plex.setServer('http://pms.local:32400', 'T');
  N.i18n.set('de');
  return { ctx: ctx, N: N, T: ctx.timers };
}

test('F27: Album ohne Titel (verwaister Eintrag) -> "Ohne Titel" bzw. "Untitled"', function () {
  var N = setup().N;
  var al = N.model.norm({ ratingKey: 5, type: 'album', title: '', summary: '', index: 1, addedAt: 1 });
  assert.strictEqual(al.title, 'Ohne Titel');
  assert.strictEqual(N.model.norm({ ratingKey: 6, type: 'album', title: 'Morgenlicht' }).title, 'Morgenlicht');
  assert.strictEqual(N.model.norm({ ratingKey: 7, type: 'movie', title: '' }).title, '');      // nur Musik-Eintraege
  N.i18n.set('en');
  assert.strictEqual(N.model.norm({ ratingKey: 5, type: 'album', title: '' }).title, 'Untitled');
});

test('F30: Tracks der Albumseite nehmen das Albumcover statt des Autorenbilds; eigenes Cover zuerst', function () {
  var MU = setup().N.music;
  var d = { MediaContainer: { thumb: '/al', Metadata: [{ ratingKey: 1, type: 'track', title: 'a', grandparentThumb: '/autor' }, { ratingKey: 2, type: 'track', title: 'b', parentThumb: '/p' }] } };
  var l = MU.tracks(d, d.MediaContainer.thumb);
  assert.strictEqual(l[0].thumb, '/al'); assert.strictEqual(l[1].thumb, '/p');
  assert.strictEqual(MU.tracks(d)[0].thumb, '/autor');                                   // ohne Album-Kontext wie bisher
  assert.strictEqual(MU.tracks({ MediaContainer: { Metadata: [{ ratingKey: 3, type: 'track', title: 'c' }] } })[0].thumb, '');
});

test('F28: Titelkarte ohne Bild – Farbe fest je Titel, Track wie sein Album; Raster und Reihe ohne graues Feld', function () {
  var s = setup(), N = s.N;
  var c = N.ui.fbClass({ type: 'album', title: 'Morgenlicht 2' });
  assert.ok(/^av[0-7]$/.test(c));
  assert.strictEqual(N.ui.fbClass({ type: 'album', title: 'Morgenlicht 2' }), c);
  assert.strictEqual(N.ui.fbClass({ type: 'track', title: 'Kapitel 1', album: 'Morgenlicht 2' }), c);
  var items = [{ rk: '1', type: 'album', title: 'Morgenlicht 1', thumb: '/t/1' }, { rk: '2', type: 'album', title: 'Morgenlicht 2', thumb: '' }];
  var g = new N.ui.Grid(s.ctx.document.createElement('div'));
  g.setGeom(N.GridMath.make('L', true)); g.setModel(items, 2, 0); s.T.tick(100);
  assert.strictEqual(g.byIdx[0].phEl.className, 'ph');
  assert.strictEqual(g.byIdx[1].phEl.className, 'ph fb ' + c);
  assert.strictEqual(g.byIdx[1].ph.nodeValue, 'Morgenlicht 2');
  var r = new N.ui.Row(s.ctx.document.createElement('div'), { noHead: true, captions: function () { return true; } });
  r.setModel({ id: 'ab', kind: 'sq', items: items }, 0); s.T.tick(100);
  assert.strictEqual(r.byIdx[1].phEl.className, 'ph fb ' + c);
  r.setModel({ id: 'cast', kind: 'cast', items: [{ rk: '9', type: 'person', title: 'Jemand', thumb: '' }] }, 0); s.T.tick(100);
  assert.strictEqual(r.byIdx[0].phEl.className, 'ph');                                    // Personen bleiben rund/grau
});

test('F26: Titelliste haelt unter dem Mini-Player Platz frei – letzter Titel rollt hoeher', function () {
  var s = setup(), N = s.N, items = [];
  for (var i = 0; i < 9; i++) items.push({ rk: String(i), title: 'Lied ' + i });
  var l = new N.ui.TrackList(s.ctx.document.createElement('div'), { x: 144, y: 624, w: 992, vis: 7, row: function (x) { return { t: x ? x.title : '' }; } });
  l.setItems(items, 8);
  assert.strictEqual(l.sc, 2);                       // letzter Titel in der 7. (untersten) Zeile
  l.setRoom(2);
  assert.strictEqual(l.sc, 4);                       // jetzt in der 5. Zeile, ueber dem Mini-Player
  l.focusTo(3); assert.strictEqual(l.sc, 1);         // Anker-Regel unveraendert
  l.focusTo(8); assert.strictEqual(l.sc, 4);
  l.setRoom(0); assert.strictEqual(l.sc, 2);
});

test('F26/F28/F29: Mini-Player – Pause-Symbol beim Spielen, Play-Symbol pausiert; Farbfeld ohne Cover; Platz neben A–Z', function () {
  var s = setup(), N = s.N, doc = s.ctx.document;
  var c = { state: 'playing', t: 1000, item: { rk: '1', type: 'track', title: 'Kapitel 1', album: 'Morgenlicht 2', artist: 'Autor', thumb: '' }, book: false, ctx: null,
    dur: function () { return 60000; } };
  N.audio.core = function () { return c; }; N.audio.active = function () { return true; };
  var top = { name: 'album', scr: {} };
  N.router.topName = function () { return top.name; }; N.router.top = function () { return top.scr; };
  var vis = [];
  N.evt.on('mini:vis', function (v) { vis.push(v); });
  var M = N.ui.mini;
  M.init(doc.createElement('div'));
  M.update(true);
  function icon() { return M.ic.style.backgroundPositionX; }
  assert.strictEqual(icon(), (-N.ui.ICONS.pause * 32) + 'px');
  assert.strictEqual(M.fb.style.display, '');
  assert.strictEqual(M.fb.className, 'mini-fb ' + N.ui.fbClass(c.item));
  assert.strictEqual(M.fbT.nodeValue, 'M');
  c.state = 'paused'; N.evt.emit('audio:state', 'paused');
  assert.strictEqual(icon(), (-N.ui.ICONS.play * 32) + 'px');
  c.state = 'buffering'; N.evt.emit('audio:state', 'buffering');
  assert.strictEqual(icon(), (-N.ui.ICONS.pause * 32) + 'px');
  H.eq(vis, [true]);
  // Bibliothek: links neben der A–Z-Leiste
  top = { name: 'library', scr: { miniX: 784 } }; N.evt.emit('router:top', 'library');
  assert.strictEqual(M.x, 784); assert.strictEqual(M.el.style.left, '784px');
  top = { name: 'nowplaying', scr: {} }; N.evt.emit('router:top', 'nowplaying');
  H.eq(vis, [true, false]);
  top = { name: 'album', scr: {} }; N.evt.emit('router:top', 'album');
  assert.strictEqual(M.el.style.left, '856px');
  // mit Cover: Farbfeld weg
  c.item = { rk: '2', type: 'track', title: 'Lied', album: 'X', thumb: '/t/2' }; N.evt.emit('audio:track', c.item);
  assert.strictEqual(M.fb.style.display, 'none');
});

test('F25: lange Bibliotheksnamen zweizeilig in normaler Schrift (Klasse lb2 + clamp), kurze einzeilig', function () {
  var s = setup(), N = s.N, R = N.ui.rail;
  assert.ok(R.longLabel('Hörbücher & Hörspiele')); assert.ok(!R.longLabel('Musik'));
  R.init(s.ctx.document.createElement('div'));
  R.setData({ name: 'Alex' }, [{ id: 3, title: 'Musik', type: 'artist', kind: 'music' }, { id: 4, title: 'Hörbücher & Hörspiele', type: 'artist', kind: 'audio' }]);
  var by = {};
  R.entries.forEach(function (e) { if (e.lbT) by[e.lbT.nodeValue] = e.lbT.parentNode.className; });
  assert.strictEqual(by['Hörbücher & Hörspiele'], 'lb lb2 clamp');
  assert.strictEqual(by.Musik, 'lb');
  N.i18n.set('en'); R.relabel();
  R.entries.forEach(function (e) { if (e.t) assert.ok(/^lb( lb2 clamp)?$/.test(e.lbT.parentNode.className)); });
});
