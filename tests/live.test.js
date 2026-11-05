'use strict';
/* Fernsehen (SPEC A20, LIVE-1 … LIVE-9): Regeln (N.liveLogic), Senderdaten, Schalter (aus = nichts), Seitenleiste/Startseite,
 * Adresse ueber die Schnittstelle bzw. feste Adresse, Qualitaetsgrenze, Programmdaten. Ohne echtes Netz (FakeXHR). */
var test = require('node:test'), assert = require('node:assert'), crypto = require('crypto');
var H = require('./helpers/load');

/* tv: Geraet wie der TV 2014 (caps.liveSepAudio false: getrennter Ton nur ueber den Helfer); sonst ein Player, der ihn kann */
function setup(settings, kid, tv) {
  var c = H.load(), N = c.N, fx = H.FakeXHR(function (m, u) { return c.script ? c.script(m, u) : { status: 404, body: {} }; });
  N.http._setFactory(fx.factory);
  N.session.profile = { uuid: 'aaaa1111', name: 'A', kind: kid ? 'kid' : 'main' };
  N.session.settings = settings || {};
  N.platform.caps.liveSepAudio = !tv; N.platform.caps.liveFmp4 = !tv;
  N.live._reset();
  c.fx = fx;
  return c;
}
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms || 20); }); }

test('Daten: IDs eindeutig, Pflichtfelder, Regionen bekannt, Logo-Pfade = MD5 des Commons-Dateinamens, Adressen auf erlaubten Hosts', function () {
  var N = H.load().N, D = N.liveData, L = N.liveLogic, ids = {}, regs = {};
  D.regions.forEach(function (r) { regs[r.id] = 1; });
  assert.ok(D.channels.length >= 25);
  D.channels.forEach(function (ch) {
    assert.ok(!ids[ch.id], 'doppelt ' + ch.id); ids[ch.id] = 1;
    assert.ok(/^[a-z]+-[a-z0-9-]+$/.test(ch.id), ch.id);
    assert.ok(ch.name && regs[ch.region], ch.id);
    assert.ok(/^https:\/\/[^\s]+\.m3u8(\?[^\s]*)?$/.test(ch.url), ch.id + " url");
    assert.ok(L.hostOk(ch.url, D.hosts), ch.id + ' Host nicht erlaubt');
    var m = /^([0-9a-f])\/([0-9a-f]{2})\/(.+\.svg)$/.exec(ch.logo);
    assert.ok(m, ch.id + ' logo');
    var h = crypto.createHash('md5').update(m[3]).digest('hex');
    assert.strictEqual(m[1] + '/' + m[2], h[0] + '/' + h.slice(0, 2), ch.id + ' MD5-Pfad');
    ['de', 'en', 'nb'].forEach(function (l) {                      // Geosperre und Region mit Text in jeder Sprache (LIVE-11)
      if (ch.geo) assert.ok(typeof N.strings[l]['live.country.' + ch.geo] === 'string', ch.id + ' geo ' + ch.geo + ' ohne Text ' + l);
      assert.ok(typeof N.strings[l]['live.region.' + ch.region] === 'string', ch.id + ' Region ohne Text ' + l);
    });
    assert.ok(ch.verified === undefined || ch.verified === false, ch.id + ' verified nur false (sonst weglassen)');
    assert.ok(!ch.api || ch.api.t === 'ard' || ch.api.t === 'arte', ch.id + ' api: nur bekannte Schnittstellen');
    if (ch.api) assert.ok(ch.api.t === 'ard' ? !!(ch.api.p && ch.api.id) : ch.api.t === 'arte', ch.id + ' api');
  });
  H.eq(L.regions(null, 'DE'), ['de']);                            // Standard: Region des Landes (LIVE-7)
  H.eq(L.regions(null), ['int']);                                 // Land unbekannt -> International
  H.eq(L.regions(['int', 'de', 'xx']), ['de', 'int']);            // Reihenfolge der Daten, Unbekanntes faellt weg
  assert.strictEqual(N.live.logo(L.channel('de-zdf')), 'https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c1/ZDF_logo.svg/330px-ZDF_logo.svg.png');
  /* Ton als eigene Spur (INFO "Kein Ton? …"): alle ARD-/ZDF-Stroeme, nicht arte und DW (Ton im Bildstrom, Recherche 05.11.) */
  D.channels.forEach(function (ch) {
    var sep = (ch.region === 'de' && ch.id !== 'de-arte') || ch.id === 'int-nhk-world' || ch.id === 'int-ert-world';   // gemessen 05.11.
    assert.strictEqual(!!ch.sep, sep, ch.id + ' sep');
    if (ch.fmp4) assert.ok(['int-nhk-world', 'int-ert-world', 'se-svt1'].indexOf(ch.id) >= 0, ch.id + ' fmp4');
  });
});

test('LIVE-1: aus (Standard) = nichts – kein Eintrag in Seitenleiste/Editor, keine Reihe, keine Anfrage; Kinder nie', function () {
  var c = setup({}), N = c.N;
  assert.strictEqual(N.live.allowed(), false);
  assert.ok(N.railRows.avail([], true, N.ui.rail.live()).every(function (x) { return x.id !== 'livetv'; }));
  assert.ok(N.homeRows.avail([], null).every(function (x) { return x.id !== 'tv'; }));
  assert.strictEqual(N.live.homeRow(), null);
  H.eq(N.live.channels(), []);
  N.live.epgFetch(['de-daserste']);                                                 // auch ein Aufruf darf nichts anfragen, wenn aus
  var kid = setup({ liveTv: true }, true);
  assert.strictEqual(kid.N.live.allowed(), false);
  assert.strictEqual(c.fx.log.opened.length, 0);
});

test('LIVE-1: an -> Seitenleiste mit "Fernsehen" (eingeschaltet, hinter den Bibliotheken), Startseiten-Reihe angeboten (aus)', function () {
  var N = setup({ liveTv: true }).N;
  assert.strictEqual(N.live.allowed(), true);
  var av = N.railRows.avail([{ id: 1, title: 'Filme' }], false, true);
  H.eq(av.map(function (x) { return x.id; }), ['search', 'home', 'lib-1', 'livetv']);
  H.eq(N.railRows.enabled(null, av), ['search', 'home', 'lib-1', 'livetv']);
  // gespeicherte Liste von vorher: neuer Eintrag eingeschaltet am Ende
  H.eq(N.railRows.enabled([{ id: 'home', on: true }, { id: 'search', on: false }, { id: 'lib-1', on: true }], av), ['home', 'lib-1', 'livetv']);
  var hav = N.homeRows.avail([{ id: 1, title: 'Filme' }], null);
  assert.ok(hav.some(function (x) { return x.id === 'tv' && x.def === false; }));
  assert.ok(N.homeRows.enabled(null, hav).indexOf('tv') < 0);                      // Reihe Standard aus
  H.eq(N.homeRows.parse('tv'), { group: 'live' });
});

test('LIVE-6: Reihe "Fernsehen" – Standard die Hauptprogramme, eigene Auswahl/Reihenfolge, nie im Cache, H.pick baut sie frisch', function () {
  var c = setup({ liveTv: true }), N = c.N, row = N.live.homeRow();
  H.eq(row.items.map(function (x) { return x.live; }), ['de-daserste', 'de-zdf', 'de-3sat', 'de-arte', 'de-phoenix', 'de-tagesschau24']);
  assert.strictEqual(row.kind, 'land'); assert.strictEqual(row.items[0].type, 'live'); assert.ok(row.items[0].logo);
  N.session.settings.liveHome = [{ id: 'de-arte', on: true }, { id: 'de-daserste', on: false }];
  H.eq(N.live.homeRow().items.map(function (x) { return x.live; }).slice(0, 3), ['de-arte', 'de-zdf', 'de-3sat']);
  var rows = N.hubs.buildRows({ libs: [], alibs: [], order: ['tv'] });
  assert.strictEqual(rows.length, 1); assert.ok(rows[0].live); assert.ok(!rows[0].all);   // keine Karte "Alle anzeigen"
  H.eq(N.hubs.forCache(rows), []);
  N.session.settings.liveHome = [{ id: 'de-zdf', on: true }];
  assert.strictEqual(N.hubs.pick(rows, ['tv'])[0].items[0].live, 'de-zdf');
  // Editor-Modell: store behaelt Sender ausgeschalteter Regionen an ihrer Stelle
  var L = N.liveLogic, av = L.rows.avail(L.channels(['de']));
  var st = L.rows.store([{ id: 'int-dw-en', on: true }, { id: 'de-zdf', on: true }], av, [{ id: 'de-zdf', on: false }]);
  H.eq(st.slice(0, 2), [{ id: 'int-dw-en', on: true }, { id: 'de-zdf', on: false }]);
});

test('LIVE-5: Master-Playlist – Varianten, getrennter Ton verhindert die Grenze, relative Pfade, Auswahl', function () {
  var L = H.load().N.liveLogic;
  var muxed = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3150440,RESOLUTION=1280x720\nhi/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=1789512,RESOLUTION=960x540\nmid/index.m3u8\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=716696,RESOLUTION=426x240\n/abs/low.m3u8\n#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=1,URI="x.m3u8"\n';
  var v = L.variants(muxed, 'https://cdn.example.net/live/master.m3u8?x=1');
  H.eq(v.map(function (x) { return x.h; }), [240, 540, 720]);
  assert.strictEqual(v[1].url, 'https://cdn.example.net/live/mid/index.m3u8');
  assert.strictEqual(v[0].url, 'https://cdn.example.net/abs/low.m3u8');
  assert.strictEqual(L.pick(v, 540).h, 540);
  assert.strictEqual(L.pick(v, 0), null);                          // Automatisch
  assert.strictEqual(L.pick(v, 1080), null);                       // alles darunter: Master bleibt (adaptiv)
  assert.strictEqual(L.pick(v, 100).h, 240);                       // nichts passt: kleinste
  var split = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=5491200,RESOLUTION=1280x720,AUDIO="a"\nv720.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2816000,RESOLUTION=960x540,AUDIO="a"\nv540.m3u8\n';
  assert.strictEqual(L.pick(L.variants(split, 'https://x.example/m.m3u8'), 540), null);   // Ton getrennt: keine Grenze
  H.eq(L.variants('kein m3u8', ''), []);
  assert.strictEqual(L.capHeight('720'), 720); assert.strictEqual(L.capHeight('auto'), 0); assert.strictEqual(L.capHeight('999'), 0);
});

test('LIVE-5: Adresse – Schnittstelle (feste Pfade, nur erlaubte Hosts), Rueckfall, http am Fernseher, Zwischenspeicher', async function () {
  var c = setup({ liveTv: true }), N = c.N, L = N.liveLogic, hosts = N.liveData.hosts;
  var api = { t: 'ard', p: 'daserste', id: 'X' };
  function ard(u) { return { widgets: [{ mediaCollection: { embedded: { streams: [{ media: [{ url: u }] }] } } }] }; }
  assert.strictEqual(L.apiStream(api, ard('https://daserste-live.ard-mcdn.de/a/master.m3u8'), hosts), 'https://daserste-live.ard-mcdn.de/a/master.m3u8');
  assert.strictEqual(L.apiStream(api, ard('https://evil.example.com/a/master.m3u8'), hosts), '');      // fremder Host
  assert.strictEqual(L.apiStream(api, ard('http://daserste-live.ard-mcdn.de/a/master.m3u8'), hosts), '');   // nur https
  assert.strictEqual(L.apiStream(api, { widgets: [] }, hosts), '');
  assert.strictEqual(L.apiStream({ t: 'arte' }, { data: { attributes: { streams: [{ url: 'https://artesimulcast.akamaized.net/x/index.m3u8' }] } } }, hosts), 'https://artesimulcast.akamaized.net/x/index.m3u8');
  assert.strictEqual(L.apiUrl(api, false), 'https://api.ardmediathek.de/page-gateway/pages/daserste/item/X?devicetype=pc&embedded=true');
  assert.strictEqual(L.apiUrl({ t: 'arte', lang: 'fr' }, false), 'http://api.arte.tv/api/player/v2/config/fr/LIVE');
  // Fernseher (Orsay, kein TLS 1.2): https -> http nur fuer Hosts, die das koennen
  assert.strictEqual(L.forTv('https://mcdn.br.de/x/master.m3u8', false), 'http://mcdn.br.de/x/master.m3u8');
  assert.strictEqual(L.forTv('https://artesimulcast.akamaized.net/x/index.m3u8', false), 'https://artesimulcast.akamaized.net/x/index.m3u8');
  assert.strictEqual(L.forTv('https://mcdn.br.de/x/master.m3u8', true), 'https://mcdn.br.de/x/master.m3u8');
  // Ablauf: Schnittstelle liefert -> diese Adresse (http am TV), zweites Mal aus dem Zwischenspeicher
  c.script = function (m, u) { return /ardmediathek/.test(u) ? { status: 200, body: ard('https://daserste-live.ard-mcdn.de/neu/master.m3u8') } : { status: 404, body: {} }; };
  var got = null;
  N.live.resolve('de-daserste', 'auto', function (e, r) { got = r; });
  await wait();
  assert.strictEqual(got.url, 'http://daserste-live.ard-mcdn.de/neu/master.m3u8'); assert.strictEqual(got.src, 'api');
  N.live.resolve('de-daserste', 'auto', function (e, r) { got = r; });
  await wait();
  assert.strictEqual(c.fx.log.opened.length, 1);
  // Schnittstelle scheitert -> feste Adresse; nach zwei Fehlern wird sie in dieser Sitzung nicht mehr gefragt
  c.script = function () { return { status: 500, body: {} }; };
  var n0 = c.fx.log.opened.length;
  N.live.resolve('de-kika', 'auto', function (e, r) { got = r; }); await wait(60);
  assert.strictEqual(got.src, 'data'); assert.strictEqual(got.url, 'http://kika-live.ard-mcdn.de/kika/live/hls/de/master.m3u8');
  N.live.resolve('de-hr', 'auto', function () {}); await wait(60);
  var n1 = c.fx.log.opened.length;
  N.live.resolve('de-wdr', 'auto', function (e, r) { got = r; }); await wait();
  assert.strictEqual(c.fx.log.opened.length, n1); assert.ok(n1 - n0 >= 2); assert.strictEqual(got.src, 'data');
  // ZDF: keine Schnittstelle, feste Adresse
  N.live.resolve('de-zdf', 'auto', function (e, r) { got = r; }); await wait();
  assert.strictEqual(got.url, 'http://zdf-hls-15.akamaized.net/hls/live/2016498/de/high/master.m3u8');
  assert.strictEqual(L.sefUrl('http://a/b.m3u8'), 'http://a/b.m3u8|COMPONENT=HLS');
});

test('LIVE-5: Grenze bis 540p – Variante mit Ton im Segment (DW), Master bei getrenntem Ton', async function () {
  var c = setup({ liveTv: true, liveQuality: '540' }), N = c.N, got = null;
  c.script = function (m, u) {
    if (/dwstream102/.test(u)) return { status: 200, body: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2141313,RESOLUTION=960x540\n540.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=6221313,RESOLUTION=1920x1080\n1080.m3u8\n' };
    return { status: 404, body: {} };
  };
  N.live.resolve('int-dw-en', undefined, function (e, r) { got = r; }); await wait();
  assert.strictEqual(got.pick.h, 540);
  assert.strictEqual(got.url, 'http://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/540.m3u8');
});

test('LIVE-8: Programmdaten – Adresse (http am TV), Auswertung mit Zeitzone, laeuft gerade', async function () {
  var c = setup({ liveTv: true }), N = c.N, L = N.liveLogic, ch = L.channel('de-daserste');
  assert.ok(/^http:\/\/programm-api\.ard\.de\/nownext\/api\/channel\?channel=Y3Jp/.test(L.epgUrl(ch.epg, false)));
  assert.strictEqual(L.epgUrl(L.channel('de-zdf').epg, false), '');                  // ZDF: keine offene Quelle
  assert.strictEqual(L.isoMs('2026-11-05T09:55:00+01:00'), Date.UTC(2026, 10, 5, 8, 55));
  assert.strictEqual(L.isoMs('2026-11-05T09:55:00Z'), Date.UTC(2026, 10, 5, 9, 55));
  assert.strictEqual(L.isoMs('quatsch'), 0);
  var now = Date.now(), iso = function (ms) { return new Date(ms).toISOString(); };
  c.script = function (m, u) {
    return /programm-api/.test(u) ? { status: 200, body: { events: [{ runningState: 'now', title: { short: 'Abendnachrichten' }, startDate: iso(now - 600000), endDate: iso(now + 600000) },
      { runningState: 'next', title: { short: 'Quiz' }, startDate: iso(now + 600000), endDate: iso(now + 1800000) }] } } : { status: 404, body: {} };
  };
  var ev = 0; N.evt.on('live:epg', function () { ev++; });
  N.live.epgFetch(['de-daserste', 'de-zdf']); await wait();
  assert.strictEqual(ev, 1); assert.strictEqual(N.live.nowText(ch), 'Abendnachrichten');
  assert.strictEqual(N.live.item(ch).sub, 'Abendnachrichten');
  N.live.epgFetch(['de-daserste']); await wait();
  assert.strictEqual(c.fx.log.opened.length, 1);                                    // laufende Sendung bekannt: keine neue Anfrage
  var nn = L.nowNext([{ t: 'a', s: 0, e: 10 }, { t: 'b', s: 10, e: 20 }], 5);
  assert.strictEqual(nn.now.t, 'a'); assert.strictEqual(nn.next.t, 'b');
  assert.strictEqual(L.progress({ s: 0, e: 10 }, 5), 0.5);
});

test('Bildlader: Senderlogo als PNG ohne minSize, Kasten 70 % x 60 % der Karte; logoFit legt es mittig mit Innenabstand', function () {
  var N = H.load().N;
  N.plex.base = 'http://192.0.2.10:32400'; N.plex.token = 'T';
  var u = N.img.url('https://thumb.wikimedia.org/x.png', 'landM', N.img.LOGO);
  assert.ok(/format=png/.test(u) && !/minSize/.test(u) && /width=168&height=81/.test(u), u);
  var img = { style: {}, className: '', pnLogo: [240, 135] };
  assert.ok(N.img.logoFit(img, 168, 42));                                           // breites Logo (4:1)
  assert.strictEqual(img.style.width, '240px'); assert.strictEqual(img.style.height, '135px');   // border-box: Karte, Logo = Inhalt
  assert.strictEqual(img.style.padding, '46px 36px 47px 36px'); assert.strictEqual(img.className, 'lgi');
});

/* ---------- LIVE-4 Untertitel im Live-Player (Pruefung 05.11.): Mini-DOM, Player-Attrappe mit Untertitelspuren ---------- */
function MiniDoc() {
  function El(tag) { this.tagName = tag; this.style = {}; this.childNodes = []; this.className = ''; this.textContent = ''; }
  El.prototype.appendChild = function (c) { this.childNodes.push(c); c.parentNode = this; return c; };
  El.prototype.insertBefore = function (c) { return this.appendChild(c); };
  El.prototype.removeChild = function (c) { var i = this.childNodes.indexOf(c); if (i >= 0) this.childNodes.splice(i, 1); return c; };
  El.prototype.setAttribute = function (k, v) { this[k] = v; };
  El.prototype.getAttribute = function (k) { return this[k] === undefined ? null : this[k]; };
  El.prototype.addEventListener = function () {}; El.prototype.removeEventListener = function () {};
  Object.defineProperty(El.prototype, 'firstChild', { get: function () { return this.childNodes[0] || null; } });
  return { createElement: function (t) { return new El(t); }, createTextNode: function (t) { return { nodeValue: t }; }, body: new El('body'), documentElement: new El('html') };
}
function ids(list) { return list.map(function (e) { return e.id; }).join(',').split(','); }   // Arrays aus dem vm-Kontext vergleichbar
function livePlayer(o) {
  o = o || {};
  var fs = require('fs'), path = require('path'), vm = require('vm');
  var ctx = H.load({ fakeTimers: true }), N = ctx.N, T = ctx.timers, panels = [], toasts = [], calls = [], factory = null, onEv = null;
  ctx.document = MiniDoc();
  N.i18n.set('de');
  N.session.profile = { uuid: 'aaaa1111', name: 'A', kind: 'main' };
  N.session.settings = o.settings || { liveTv: true };
  N.platform.caps.liveSubs = o.caps !== false;
  var tracks = o.tracks || [];                                  // je Sender: [{lang, name}]
  var P = { exec: function (n, a, b) {
    calls.push(n + (a !== undefined ? ' ' + a : '') + (b !== undefined ? ' ' + b : ''));
    var tr = P.tracks || [];
    if (n === 'GetTotalNumOfStreamID') return a === 4 ? tr.length : 1;
    if (n === 'GetStreamLanguageInfo') return tr[b] ? tr[b].lang : '';
    if (n === 'GetStreamName') return tr[b] ? tr[b].name : '';
    if (n === 'StartSubtitle') return tr[a] ? 1 : -1;
    return 1;
  }, close: function () {}, fake: false, el: null, tracks: [] };
  N.platform.player = { create: function (f) { onEv = f; return P; }, close: function () {} };
  N.live.resolve = function (id, q, cb) { cb(null, { src: 'data', url: 'https://example.org/' + id + '.m3u8', vars: [] }); };
  N.live.epgFetch = function () {};
  N.ui.panel.select = function (p) { panels.push(p); };
  N.ui.toast.show = function (t) { toasts.push(t); };
  N.ui.StateBlock = function () { this.show = function (x) { this.shown = x; }; this.hide = function () {}; this.fit = function () {}; this.onKey = function () { return false; }; };
  N.router.refreshHints = function () {}; N.router.hasOverlay = function () { return false; }; N.router.back = function () {};
  N.tv.saver = function () {};
  var def = N.router.define;
  N.router.define = function (n, fn) { if (n === 'liveplayer') factory = fn; };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'liveplayer.js'), 'utf8'), ctx, { filename: 'views/liveplayer.js' });
  N.router.define = def;
  var ids = ['de-daserste', 'de-zdf', 'de-arte'], scr = factory({ id: ids[0], list: ids }), root = ctx.document.createElement('div');
  scr.create(root);
  function start(i) { P.tracks = tracks[i] || []; }
  start(0);
  scr.enter();
  function box() { return root.childNodes.filter(function (c) { return /\bpl-sub\b/.test(c.className); })[0]; }
  return { N: N, T: T, P: P, scr: scr, panels: panels, toasts: toasts, calls: calls, ev: function (t, d) { onEv(t, d); }, start: start, box: box,
    boxText: function () { var b = box(); return b.style.display === 'none' ? '' : b.childNodes[0].childNodes[0].nodeValue; } };
}

test('LIVE-4 Untertitel: Standard aus, Mehr › Untertitel nur mit Spuren und caps.liveSubs; Wahl -> Box, gleiche Spur beim naechsten Sender, Aus', function () {
  var de = [{ lang: 'de', name: 'Deutsch' }, { lang: 'de', name: 'Deutsch (SDH)' }];
  var r = livePlayer({ tracks: [de, [{ lang: 'deu', name: 'Deutsch' }, { lang: 'deu', name: 'Deutsch (SDH)' }], []] });   // ZDF schreibt "deu" (iPad 05.11.)
  r.ev(9); r.ev(14, 1000);
  assert.ok(r.calls.indexOf('StartSubtitle 0') < 0 && r.calls.indexOf('StartSubtitle 1') < 0, 'nichts von selbst');
  r.ev(19, 'darf nicht erscheinen'); assert.strictEqual(r.boxText(), '', 'ohne Wahl keine Zeile');
  r.scr.onKey('TOOLS');
  var more = r.panels.pop();
  assert.deepStrictEqual(ids(more.entries), ['quality', 'sleep', 'subs']);
  assert.strictEqual(more.entries[2].s, 'Aus');
  more.onSelect('subs');
  var sp = r.panels.pop();
  assert.deepStrictEqual(sp.entries.map(function (e) { return e.t; }).join('|'), 'Aus|Deutsch|Deutsch (SDH)', 'Namen der Spuren');
  assert.strictEqual(sp.selected, 'off');
  sp.onSelect('1');
  assert.ok(r.calls.indexOf('StartSubtitle 1') >= 0); assert.strictEqual(r.toasts.pop(), 'Untertitel an');
  r.ev(19, '<i>Guten Abend</i>'); assert.strictEqual(r.boxText(), 'Guten Abend');
  assert.ok(/\bup\b/.test(r.box().className), 'Bedien-Insel sichtbar -> Box darueber');
  r.T.tick(5000); assert.ok(!/\bup\b/.test(r.box().className), 'Insel weg -> Box unten');
  // naechster Sender: dieselbe Spur (Name), Zeile des alten Senders weg
  r.calls.length = 0; r.start(1); r.scr.onKey('CH_UP'); r.T.tick(500);
  assert.strictEqual(r.boxText(), '', 'Zeile beim Senderwechsel weg');
  r.ev(9);
  assert.ok(r.calls.indexOf('StartSubtitle 1') >= 0, 'SDH-Spur wieder gewaehlt: ' + r.calls.join(','));
  // Sender ohne Untertitel: kein Eintrag unter Mehr, Sprache bleibt gemerkt
  r.calls.length = 0; r.start(2); r.scr.onKey('CH_UP'); r.T.tick(500); r.ev(9);
  r.scr.onKey('TOOLS'); assert.deepStrictEqual(ids(r.panels.pop().entries), ['quality', 'sleep']);
  // Spuren kommen erst nach den Metadaten (HLS): spaeter noch gewaehlt
  r.P.tracks = [{ lang: 'ENG', name: '' }, { lang: 'de-DE', name: '' }]; r.ev(14, 1500);   // DW: Sprache ohne Namen, Gross-/Regionsschreibung
  assert.ok(r.calls.indexOf('StartSubtitle 1') >= 0, 'spaet gemeldete Spur, Sprache de-DE = de');
  r.scr.onKey('TOOLS'); r.panels.pop().onSelect('subs');
  assert.strictEqual(r.panels.pop().entries.map(function (e) { return e.t; }).join('|'), 'Aus|English|Deutsch', 'ohne Namen: Sprache ausgeschrieben');
  r.scr.onKey('TOOLS'); r.panels.pop().onSelect('subs'); r.panels.pop().onSelect('off');
  assert.ok(r.calls.indexOf('StopSubtitle') >= 0); assert.strictEqual(r.toasts.pop(), 'Untertitel aus'); assert.strictEqual(r.boxText(), '');
});

test('LIVE-4 Untertitel: Fehler raeumt die Zeile weg; ohne caps.liveSubs (TV 2014) nie ein Eintrag, auch wenn der Player Spuren meldet', function () {
  var de = [{ lang: 'de', name: 'Deutsch' }];
  var r = livePlayer({ tracks: [de] });
  r.ev(9); r.ev(14, 1000); r.ev(12);
  r.scr.onKey('TOOLS'); r.panels.pop().onSelect('subs'); r.panels.pop().onSelect('0');
  r.ev(19, 'Zeile'); assert.strictEqual(r.boxText(), 'Zeile');
  r.ev(4);                                                       // Netz weg -> Fehlerblock (Stop meldet kein 19 mehr)
  assert.strictEqual(r.boxText(), '', 'keine stehende Zeile ueber dem Fehlerblock');
  var tv = livePlayer({ tracks: [de], caps: false });
  tv.ev(9); tv.scr.onKey('TOOLS');
  assert.deepStrictEqual(ids(tv.panels.pop().entries), ['quality', 'sleep']);
  assert.ok(tv.calls.every(function (c) { return !/Subtitle|StreamID 4|LanguageInfo|StreamName/.test(c); }), 'am TV keine Untertitel-Befehle: ' + tv.calls.join(','));
});

test('LIVE-4/LIVE-8 clockNow: fest nur im Bildtest (fixedClock + liveDemo), sonst Uhr des Servers bzw. Geraets', function () {
  var c = setup({ liveTv: true }), N = c.N;
  function real() { return N.clock ? N.clock.now() : Date.now(); }
  assert.ok(Math.abs(N.live.clockNow() - real()) < 1000, 'echter Betrieb: jetzt');
  N.config.fixedClock = '21:34';
  assert.ok(Math.abs(N.live.clockNow() - real()) < 1000, 'fixedClock allein (ohne liveDemo) aendert nichts');
  N.config.liveDemo = true;
  var f = new Date(N.live.clockNow());
  assert.deepStrictEqual([f.getHours(), f.getMinutes()], [21, 34]);
  assert.strictEqual(N.live.clockNow(), N.live.clockNow(), 'fest');
  var ch = N.live.channels()[0];                                 // Bildtest: erfundene Sender (d1 …)
  N.live.epgFetch([ch.id]);
  var n = N.live.now(ch);
  assert.ok(n && n.now && n.now.s < N.live.clockNow() && n.now.e > N.live.clockNow(), 'erfundene Sendung um die feste Uhr (Startseiten-Reihe "laeuft gerade")');
});

/* ---------- LIVE-10: Ton als eigene Spur (ARD/ZDF) am TV 2014 – ohne Helfer ausgeblendet, mit Helfer ueber den Helfer ---------- */
var HB = 'http://10.0.0.10:32499', HKEY = 'k'.repeat(32), TOKP = '/live/' + 'A'.repeat(31) + 'b/index.m3u8';
function tvHelper(settings, feats, answer) {
  var c = setup(settings || { liveTv: true }, false, true), N = c.N;
  N.session.pkg = { helper: { url: HB, key: HKEY } };
  N.disc._resetHelper();
  c.script = function (m, u) {
    if (u === HB + '/neo-helper') return feats ? { status: 200, body: { name: 'plex-neo-helper', watchlist: true, discover: true, features: feats } } : { status: 0, body: '' };
    if (u.indexOf(HB + '/live/') === 0) return answer ? answer(m, u) : { status: 200, body: { path: TOKP, idle: 60, h: 540 } };
    return { status: 404, body: {} };
  };
  return c;
}
function chIds(list) { return list.map(function (x) { return x.id || x.live; }).join(','); }

test('LIVE-10: TV 2014 ohne Helfer – Sender mit getrenntem Ton fehlen ueberall (Raster, Reihe, Editor, Zahlen), Auswahl bleibt erhalten', function () {
  var c = setup({ liveTv: true, liveRegions: ['de', 'fr', 'int'] }, false, true), N = c.N, L = N.liveLogic;
  assert.strictEqual(N.platform.caps.liveSepAudio, false);
  var shown = N.live.channels();
  assert.ok(shown.every(function (x) { return !x.sep; }), 'kein sep-Sender ohne Helfer');
  assert.ok(chIds(shown).indexOf('de-arte') >= 0 && chIds(shown).indexOf('int-dw-en') >= 0);
  var all = L.channels(N.live.regions());
  var fm = all.filter(function (x) { return x.fmp4; }).length;              // fMP4 (NHK, ERT World): am TV auch mit Helfer nicht
  assert.strictEqual(N.live.hidden(), all.length - shown.length - fm);
  assert.ok(shown.every(function (x) { return !x.fmp4; }));
  assert.ok(N.live.hidden() >= 27);                                            // Statuszeile: "27 weitere mit dem Helfer"
  assert.strictEqual(chIds(N.live.homeAvail()), chIds(shown));                 // Editor "Sender auf der Startseite"
  assert.ok(N.live.homeRow().items.every(function (x) { return !L.channel(x.live).sep; }));
  assert.strictEqual(L.count('de', false), 1); assert.strictEqual(L.count('de', true), L.count('de'));
  assert.strictEqual(N.live.viaHelper(L.channel('de-zdf')), true); assert.strictEqual(N.live.viaHelper(L.channel('de-arte')), false);
  // gespeicherte Auswahl der Reihe bleibt fuer ausgeblendete Sender erhalten (kommen mit dem Helfer an ihrer Stelle zurueck)
  var saved = [{ id: 'de-zdf', on: true }, { id: 'de-arte', on: true }];
  var st = L.rows.store(saved, N.live.homeAvail(), [{ id: 'de-arte', on: false }]);
  H.eq(st.slice(0, 2), [{ id: 'de-zdf', on: true }, { id: 'de-arte', on: false }]);
  // ein Geraet, dessen Player getrennten Ton kann (Apple): alle, nie der Helfer
  var a = setup({ liveTv: true, liveRegions: ['de', 'fr', 'int'] }), A = a.N;
  assert.strictEqual(A.live.channels().length, all.length); assert.strictEqual(A.live.hidden(), 0);
  assert.strictEqual(A.live.viaHelper(A.liveLogic.channel('de-zdf')), false);
});

test('LIVE-10: Helfer mit Faehigkeit "live" erreichbar -> alle Sender (live:avail), Wiedergabe ueber den Helfer nur mit Kanal-ID', async function () {
  var c = tvHelper({ liveTv: true, liveRegions: ["de"] }, ["watchlist", "live"]), N = c.N, ev = [], got = null, err = null;
  N.evt.on('live:avail', function (e) { ev.push(e.sep); });
  assert.strictEqual(N.live.channels().length, 1);                           // noch nicht geprueft: nur arte
  N.live.checkHelper(); await wait();
  H.eq(ev, [true]);                                                          // Bereich/Startseite laden neu
  assert.strictEqual(N.live.channels().length, N.liveLogic.count('de')); assert.strictEqual(N.live.hidden(), 0);
  N.live.resolve('de-zdf', 'auto', function (e, r) { err = e; got = r; }); await wait();
  assert.strictEqual(err, null);
  assert.strictEqual(got.url, HB + TOKP); assert.strictEqual(got.src, 'helper'); assert.strictEqual(got.pick.h, 540);
  var rq = c.fx.log.opened[c.fx.log.opened.length - 1];
  assert.strictEqual(rq.url, HB + '/live/open?ch=de-zdf&h=720');            // nur Kanal-ID und Hoehe (Automatisch = 720p), nie eine Adresse
  assert.strictEqual(rq.headers['X-Neo-Key'], HKEY);
  assert.strictEqual(N.liveLogic.sefUrl(got.url), HB + TOKP + '|COMPONENT=HLS');
  N.live.resolve('de-zdf', '720', function (e, r) { got = r; }); await wait();
  assert.ok(/&h=720$/.test(c.fx.log.opened[c.fx.log.opened.length - 1].url));   // "Qualitaet beim Fernsehen" gilt
  var n0 = c.fx.log.opened.length;
  N.live.resolve('de-arte', 'auto', function (e, r) { got = r; }); await wait();
  assert.ok(c.fx.log.opened.slice(n0).every(function (o) { return o.url.indexOf(HB) !== 0; }), 'arte ohne Helfer');
  N.live.helperClose(HB + TOKP); await wait();
  var del = c.fx.log.opened[c.fx.log.opened.length - 1];
  assert.strictEqual(del.method, 'DELETE'); assert.strictEqual(del.url, HB + '/live/' + 'A'.repeat(31) + 'b');
  // Helfer faellt aus -> Sender wieder weg
  N.disc.helperFail({ type: 'network' });
  H.eq(ev, [true, false]);
  assert.strictEqual(N.live.channels().length, 1);
});

test('LIVE-10: Helfer war weg und ist wieder da -> Oeffnen (Erneut versuchen) prueft sofort neu und spielt', async function () {
  var up = false, c = tvHelper(null, ['watchlist', 'live']), N = c.N, e = 'x', r = null, inner = c.script;
  c.script = function (m, u) { return up ? inner(m, u) : { status: 0, body: '' }; };
  N.live.checkHelper(); await wait();
  assert.strictEqual(N.disc.helperState(), 'down');
  up = true;                                                                  // Helfer laeuft wieder (keine 60 s gewartet)
  N.live.resolve('de-daserste', 'auto', function (x, y) { e = x; r = y; }); await wait(50);
  assert.strictEqual(e, null); assert.strictEqual(r && r.src, 'helper');
  up = false; N.disc.helperFail({ type: 'network' });                         // wieder weg: ehrlicher Fehler, keine Schleife
  N.live.resolve('de-daserste', 'auto', function (x) { e = x; }); await wait(50);
  assert.strictEqual(e && e.why, 'down');
});

test('LIVE-10: ehrliche Fehler – Helfer fehlt, nicht erreichbar, zu alt, ausgelastet, Sender nicht erreicht, ungueltige Antwort', async function () {
  async function why(feats, answer) {
    var c = tvHelper(null, feats, answer), N = c.N, e = null;
    N.live.checkHelper(); await wait();
    N.live.resolve('de-daserste', 'auto', function (x) { e = x; }); await wait();
    return e && e.type === 'helper' ? e.why : e;
  }
  assert.strictEqual(await why(['watchlist']), 'old');                                       // Helfer ohne "live" (aelter)
  assert.strictEqual(await why(null), 'down');                                               // eingetragen, antwortet nicht
  assert.strictEqual(await why(['live'], function () { return { status: 503, body: { error: 'busy' } }; }), 'busy');
  assert.strictEqual(await why(['live'], function () { return { status: 502, body: { error: 'upstream' } }; }), 'upstream');
  assert.strictEqual(await why(['live'], function () { return { status: 401, body: { error: 'key' } }; }), 'key');
  assert.strictEqual(await why(['live'], function () { return { status: 200, body: { path: 'http://evil.example/x.m3u8' } }; }), 'old');   // nur der feste Pfad
  assert.strictEqual(await why(['live'], function () { return { status: 200, body: { path: '/live/../../x/index.m3u8' } }; }), 'old');
  var c = setup({ liveTv: true }, false, true), e = null;                                   // kein Helfer eingetragen
  c.N.live.resolve('de-zdf', 'auto', function (x) { e = x; }); await wait();
  assert.strictEqual(e.why, 'none');
  var L = c.N.liveLogic;
  assert.strictEqual(L.helperUrl('http://10.0.0.10:32499', { path: TOKP }), HB + TOKP);
  assert.strictEqual(L.helperUrl('http://helper.example:32499', { path: TOKP }), '');      // nur IP-Adressen (wie setup.json)
  assert.strictEqual(L.helperH('auto'), 720); assert.strictEqual(L.helperH('540'), 540); assert.strictEqual(L.helperH('1080'), 1080);
  assert.strictEqual(L.helperSession(HB + '/x/index.m3u8'), '');
  assert.strictEqual(L.helperErr({ type: 'timeout' }), 'down');
});

test('LIVE-10 im Player: Sitzung des Helfers endet beim Wechsel zu einem Sender ohne Helfer und beim Schliessen; Fehlertext nennt den Helfer', function () {
  var p = livePlayer(), N = p.N, closed = [], shown = [];
  N.live.viaHelper = function (ch) { return !!ch.sep; };
  N.live.helperClose = function (u) { closed.push(u); };
  N.live.resolve = function (id, q, cb) {
    if (id === 'de-zdf') { cb({ type: 'helper', why: 'down' }); return; }
    cb(null, id === 'de-arte' ? { src: 'data', url: 'https://example.org/a.m3u8', vars: [] } : { src: 'helper', url: HB + TOKP, vars: [], pick: { h: 540 } });
  };
  p.scr.onKey('CH_UP'); p.T.tick(3000);                                    // Das Erste -> ZDF: Helfer antwortet nicht -> Fehlerblock
  assert.ok(p.calls.indexOf('Stop') >= 0);
  p.scr.onKey('CH_DOWN'); p.T.tick(3000);                                      // -> Das Erste ueber den Helfer (Sitzung offen)
  assert.strictEqual(closed.length, 0);
  p.scr.onKey('CH_DOWN'); p.T.tick(3000);                                      // -> arte (ohne Helfer): Sitzung beendet
  assert.strictEqual(closed.length, 1);
  p.scr.onKey('CH_UP'); p.T.tick(3000);                                    // -> Das Erste (Helfer) …
  p.scr.destroy();                                                           // … Schliessen beendet sie auch
  assert.strictEqual(closed.length, 2);
  assert.ok(closed.every(function (u) { return u === HB + TOKP; }), 'Sitzung beendet: ' + closed.join(','));
  assert.ok(/Helfer/.test(N.t('err.lv.hDown.text', { channel: 'ZDF' })) && shown.length === 0);
});

test('LIVE-10 im Player: nach einem erfolgreichen neuen Versuch bekommt der naechste Abbruch wieder einen (Helfer weg -> Text nennt den Helfer)', function () {
  var p = livePlayer(), N = p.N, n = 0, down = false;
  N.live.viaHelper = function (ch) { return !!ch.sep; };
  N.live.helperClose = function () {};
  N.live.resolve = function (id, q, cb) {
    if (id === 'de-daserste') n++;
    if (down) { cb({ type: 'helper', why: 'down' }); return; }
    cb(null, { src: 'helper', url: HB + TOKP, vars: [], pick: { h: 540 } });
  };
  p.scr.onKey('CH_UP'); p.T.tick(3000); p.scr.onKey('CH_DOWN'); p.T.tick(3000);   // frisch zu Das Erste (ueber den Helfer)
  var n0 = n; p.ev(14, 1000);
  p.ev(6, 6); p.T.tick(100);                                                  // Helfer neu gestartet: Sitzung weg -> neuer Versuch
  assert.strictEqual(n, n0 + 1); p.ev(14, 1000);                              // Bild wieder da
  down = true; p.ev(6, 6); p.T.tick(100);                                     // Helfer jetzt aus: wieder ein Versuch …
  assert.strictEqual(n, n0 + 2, 'zweiter Abbruch bekam keinen neuen Versuch');
});

test('LIVE-7: Standard-Region folgt dem Land des Geraets; ohne Daten fuer das Land International mit Erklaerung in INFO', function () {
  var c = setup({ liveTv: true }), N = c.N, L = N.liveLogic;
  [['de-DE', 'DE'], ['de-AT', 'AT'], ['en_GB', 'GB'], ['fr', 'FR'], ['nb-NO', 'NO'], ['de', 'DE'], ['en', ''], ['zh-Hant-TW', 'TW'], ['5', ''], ['', ''], [null, '']]
    .forEach(function (x) { assert.strictEqual(L.country(x[0]), x[1], String(x[0])); });
  H.eq(L.defaults('DE'), ['de']); H.eq(L.defaults('FR'), ['fr']); H.eq(L.defaults('ZZ'), ['int']); H.eq(L.defaults(''), ['int']);
  N.i18n.sys = 'fr-FR';
  H.eq(N.live.regions(), ['fr']); assert.strictEqual(N.live.regionNote(), '');
  N.i18n.sys = 'en-ZZ';
  H.eq(N.live.regions(), ['int']);
  assert.ok(/ZZ/.test(N.live.regionNote()), N.live.regionNote());            // "Fuer dein Land (ZZ) gibt es … noch keine Sender"
  N.i18n.sys = '';                                                           // Fernseher meldet nichts Brauchbares: App-Sprache
  N.i18n.set('de'); H.eq(N.live.regions(), ['de']);
  N.i18n.set('en'); H.eq(N.live.regions(), ['int']); assert.ok(N.live.regionNote().length > 20);
  N.session.settings.liveRegions = ['de'];                                   // eigene Wahl gilt immer, dann kein Hinweis
  H.eq(N.live.regions(), ['de']); assert.strictEqual(N.live.regionNote(), '');
});

test('LIVE-7/LIVE-10: eine neue Region nur aus Daten – App (Regionen, Standard, Sender) und Helfer-Allowlist (tools/live_data.js)', function () {
  var c = setup({ liveTv: true }, false, true), N = c.N, D = N.liveData;
  D.regions.push({ id: 'xx', countries: ['ZZ'] });                            // z. B. ein Nachbau fuer ein anderes Land
  D.hosts.push('live.example-broadcaster.test');
  D.channels.push({ id: 'xx-eins', name: 'Beispiel Eins', region: 'xx', url: 'https://live.example-broadcaster.test/eins/master.m3u8', geo: 'ZZ',
    logo: 'a/ab/Beispiel.svg', home: true, sep: true, verified: false });
  D.channels.push({ id: 'xx-zwei', name: 'Beispiel Zwei', region: 'xx', url: 'https://live.example-broadcaster.test/zwei/master.m3u8', geo: '', logo: 'a/ab/B2.svg' });
  N.i18n.sys = 'en-ZZ';
  H.eq(N.live.regions(), ['xx']); assert.strictEqual(N.live.regionNote(), '');
  assert.strictEqual(chIds(N.live.channels()), 'xx-zwei');                   // TV ohne Helfer: der sep-Sender fehlt
  assert.strictEqual(N.live.hidden(), 1);
  assert.ok(N.liveLogic.hostOk(D.channels[D.channels.length - 1].url, D.hosts));
  // Helfer: Tabelle und Allowlist kommen aus denselben Daten – kein Code fuer die neue Region
  var out = require('../tools/live_data.js').render(D);
  assert.ok(out.indexOf('"xx-eins": {"url": "https://live.example-broadcaster.test/eins/master.m3u8"}') >= 0, out);
  assert.ok(out.indexOf('"live.example-broadcaster.test"') >= 0);
  assert.ok(out.indexOf('xx-zwei') < 0);                                      // Ton im Bild: braucht den Helfer nicht
  // Review 05.11. L3: nur die Hosts der zusammengesetzten Sender, exakt (kein RTVE/NHK/arte, keine Wildcard-Domain)
  var hosts = /HOSTS = \(([^)]*)\)/.exec(out)[1];
  ['rtvelivestream.rtve.es', 'masterpl.hls.nhkworld.jp', 'artesimulcast.akamaized.net', '"ard-mcdn.de"'].forEach(function (h) { assert.ok(hosts.indexOf(h) < 0, h); });
  ['"daserste-live.ard-mcdn.de"', '"zdf-hls-15.akamaized.net"', '"live.example-broadcaster.test"'].forEach(function (h) { assert.ok(hosts.indexOf(h) >= 0, h); });
  D.channels.push({ id: 'xx-drei', name: 'Drei', region: 'xx', url: 'https://other.example.test/m.m3u8', geo: '', logo: 'a/ab/B3.svg', sep: true });
  assert.throws(function () { require('../tools/live_data.js').render(D); }, /xx-drei/);   // Host nicht in hosts: Abbruch
  D.channels.pop();
  assert.deepStrictEqual(require('../tools/live_data.js').stale(), [], 'installer/neosetup/livedata.py veraltet: npm run spec');
});

test('LIVE-10/11: fMP4-Sender (NHK World, ERT World, SVT1) nur mit caps.liveFmp4 – am TV 2014 auch mit Helfer nicht, nie ueber den Helfer', async function () {
  var c = tvHelper({ liveTv: true, liveRegions: ['int', 'se'] }, ['live']), N = c.N, L = N.liveLogic;
  N.live.checkHelper(); await wait();
  var ids = N.live.channels().map(function (x) { return x.id; });
  assert.ok(ids.indexOf('int-dw-en') >= 0 && ids.indexOf('int-nhk-world') < 0 && ids.indexOf('se-svt1') < 0, ids.join(','));
  assert.strictEqual(N.live.viaHelper(L.channel('int-nhk-world')), false);
  assert.strictEqual(N.live.hidden(), 0);                                    // der Helfer braechte hier nichts dazu
  var out = require('../tools/live_data.js').render();
  assert.ok(out.indexOf('int-nhk-world') < 0 && out.indexOf('de-zdf') >= 0);
});

/* ---------- LIVE-12: nur, was dieses Geraet spielen kann (TLS 1.2, fMP4) – TV-Befund 05.11.: 24h (RTVE) Bildfehler nach ~15 s ---------- */
test('LIVE-12: Sender nur ueber TLS 1.2 (RTVE, ORF) fehlen am TV 2014 ueberall und zaehlen nicht mit; Regionen ohne spielbaren Sender fehlen im Fenster', async function () {
  var L0;
  var c = tvHelper({ liveTv: true, liveRegions: ['es', 'at', 'se', 'int'] }, ['live']), N = c.N, L = N.liveLogic;
  L0 = L;
  assert.strictEqual(N.platform.caps.tls12, false);
  N.live.checkHelper(); await wait();
  var ids = N.live.channels().map(function (x) { return x.id; });
  ['es-24h', 'es-clan', 'at-orf3', 'se-svt1', 'int-nhk-world', 'int-ert-world'].forEach(function (id) { assert.ok(ids.indexOf(id) < 0, id + ' am TV'); });
  assert.ok(ids.indexOf('int-dw-en') >= 0 && ids.indexOf('int-arirang') >= 0, ids.join(','));
  assert.strictEqual(N.live.hidden(), 0, 'nichts davon "mit dem Helfer"');
  assert.strictEqual(chIds(N.live.homeAvail()), chIds(N.live.channels()), 'Editor der Reihe');
  var reg = N.live.regionEntries().map(function (e) { return e.id; });
  assert.strictEqual(reg.join(','), 'de,fr,dk,au,int', 'keine Region mit 0 Sendern');
  assert.ok(N.live.regionEntries().every(function (e) { return !/^0 /.test(e.s); }));
  // ohne Helfer: Deutschland bleibt (arte spielt ohne Helfer), Zahlen = jetzt spielbar
  var t = setup({ liveTv: true, liveRegions: ['de'] }, false, true).N;
  var de = t.live.regionEntries().filter(function (e) { return e.id === 'de'; })[0];
  assert.ok(de && de.s.indexOf('1 ') === 0, de && de.s);
  // Apple (TLS 1.2, fMP4): alle Regionen und alle Sender
  var a = setup({ liveTv: true, liveRegions: ['es', 'at', 'se'] }).N; a.platform.caps.tls12 = true;
  assert.strictEqual(a.live.regionEntries().length, a.liveLogic.regionIds().length);
  assert.ok(a.live.channels().some(function (x) { return x.id === 'es-24h'; }) && a.live.channels().some(function (x) { return x.id === 'at-orf3'; }));
  // Regel: tls12 nur ohne TLS-1.2-Faehigkeit, sep-Sender ueber den Helfer bleiben spielbar (der Helfer holt mit TLS 1.2)
  var x = { id: 'x', tls12: true }, y = { id: 'y', tls12: true, sep: true };
  assert.deepStrictEqual([L0.playable(x, true, true, false), L0.playable(x, true, true, true), L0.playable(x, true, true)], [false, true, true]);
  assert.deepStrictEqual([L0.playable(y, true, true, false), L0.playable(y, false, true, false)], [true, false]);
  // Daten: ein Host mit absoluten https-Varianten darf nicht als httpHosts gelten (sonst stellt forTv den Master auf http um)
  assert.ok(N.liveData.httpHosts.indexOf('rtvelivestream.rtve.es') < 0);
});
