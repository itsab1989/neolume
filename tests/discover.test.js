'use strict';
/* P4 Entdecken (docs/research/discover.md): matches-Antwort, Abgleich per Plex-GUID/Titel+Jahr, Gruppen, Ablauf mit EINEM
 * GUID-Abgleich, Schalter je Profil, Merkliste ohne Helfer vollstaendig aus (keine Anfrage), setup.json "helper". */
var test = require('node:test'), assert = require('node:assert');
var H = require('./helpers/load');
var N = H.load().N, D = N.disc;
N.i18n.set('de');

var G1 = 'plex://movie/5eb8f25e3f398b00402fbe55', G2 = 'plex://movie/61d5833cf81c1be53a737fcc', G3 = 'plex://show/5d9c086c46115600200aa2fe';
function matches(list) { return { MediaContainer: { size: list.length, SearchResult: list } }; }
function prof(o) { N.session.profile = o; N.session.settings = {}; }
function lib(rk, type, title, year, guid) { return { ratingKey: rk, type: type, title: title, year: year, guid: guid, librarySectionID: type === 'movie' ? 1 : 2 }; }

test('matches-Antwort: nur gueltige Plex-GUIDs des Typs, dedupliziert, schlanke Eintraege', function () {
  var r = D.parseMatches(matches([
    { guid: G1, name: 'Mickey 17', year: 2025, summary: 'Mickey Barnes …', thumb: 'https://images.plex.tv/photo?url=x', type: 'movie' },
    { guid: G1, name: 'Mickey 17 (doppelt)', type: 'movie' },
    { guid: G2, name: 'MICKEY #7', type: 'movie' },
    { guid: G3, name: 'Falscher Typ', type: 'show' },
    { guid: 'com.plexapp.agents.imdb://tt1', name: 'Alt-Agent', type: 'movie' },
    { guid: 'plex://movie/abc', name: 'kurz', type: 'movie' },
    { guid: 'plex://movie/5eb8f25e3f398b00402fbe56', type: 'movie' },                       // ohne Namen
    { guid: 'plex://movie/5eb8f25e3f398b00402fbe57', name: 'Bild', thumb: 'javascript:alert(1)' }
  ]), 'movie');
  H.eq(r.map(function (x) { return x.title; }), ['Mickey 17', 'MICKEY #7', 'Bild']);
  var a = r[0];
  H.eq([a.ext, a.type, a.rk, a.year, a.thumb.indexOf('https://images.plex.tv'), a.vc, a.off], [true, 'movie', 'x5eb8f25e3f398b00402fbe55', 2025, 0, 0, 0]);
  assert.strictEqual(r[1].year, 0);
  assert.strictEqual(r[2].thumb, '');                                     // nur http(s)-Bilder
  H.eq(D.parseMatches(null, 'movie'), []);
  H.eq(D.parseMatches({ MediaContainer: { size: 0 } }, 'show'), []);
});

test('GUID-Liste fuer /library/all: eindeutig, nur gueltige, max. 30, komma-getrennt', function () {
  var ext = [{ guid: G1 }, { guid: G1 }, { guid: G3 }, { guid: 'x' }];
  assert.strictEqual(D.guidParam(ext), G1 + ',' + G3);
  var many = []; for (var i = 0; i < 40; i++) many.push({ guid: 'plex://movie/aaaaaaaaaaaaaaaaaa' + (0x100000 + i).toString(16) });
  assert.strictEqual(D.guidParam(many).split(',').length, 30);
  assert.strictEqual(D.hexOf(G3), '5d9c086c46115600200aa2fe');
  assert.strictEqual(D.hexOf('plex://episode/5d9c086c46115600200aa2fe'), '');
});

test('Abgleich: GUID auf dem Server -> nur oben; fremde getrennt nach Film/Serie; Server-Treffer dedupliziert', function () {
  var local = D.localList({ MediaContainer: { Hub: [
    { type: 'movie', Metadata: [lib('10', 'movie', 'Mickey 17', 2025, G1)] },
    { type: 'episode', Metadata: [{ ratingKey: '99', type: 'episode', title: 'Folge' }] },
    { type: 'show', Metadata: [lib('20', 'show', 'Severance', 2022, G3)] }
  ] } }, {});
  H.eq(local.map(function (e) { return e.it.rk; }), ['10', '20']);       // Folgen u. a. gehoeren nicht zu Entdecken
  var found = D.localList({ MediaContainer: { Metadata: [lib('10', 'movie', 'Mickey 17', 2025, G1)] } }, {});
  var em = D.parseMatches(matches([{ guid: G1, name: 'Mickey 17', year: 2025 }, { guid: G2, name: 'MICKEY #7' }]), 'movie');
  var es = D.parseMatches(matches([{ guid: G3, name: 'Severance', year: 2022 }, { guid: 'plex://show/5d9c086c46115600200aa2ff', name: 'Norsemen', year: 2016 }]), 'show');
  var g = D.group(local, found, em, es);
  H.eq(g.map(function (x) { return x.id; }), ['server', 'extMovies', 'extShows']);
  H.eq(g[0].items.map(function (x) { return x.rk; }), ['10', '20']);
  H.eq(g[1].items.map(function (x) { return x.title; }), ['MICKEY #7']);
  H.eq(g[2].items.map(function (x) { return x.title; }), ['Norsemen']);
  assert.ok(g[1].items.every(function (x) { return x.ext; }));
  assert.ok(g[0].items.every(function (x) { return !x.ext; }));
  H.eq([N.t(g[0].tk), N.t(g[1].tk), N.t(g[2].tk)], ['Auf deinem Server – abspielen', 'Nicht auf deinem Server · Filme', 'Nicht auf deinem Server · Serien']);
});

test('Abgleich: per GUID gefunden (anderer Titel, z. B. deutsch) zaehlt als "auf dem Server"', function () {
  var found = D.localList({ MediaContainer: { Metadata: [lib('11', 'movie', 'Das Boot (deutsch)', 1981, G2)] } }, {});
  var em = D.parseMatches(matches([{ guid: G2, name: 'The Boat', year: 1981 }]), 'movie');
  var g = D.group([], found, em, []);
  H.eq(g.map(function (x) { return x.id; }), ['server']);
  assert.strictEqual(g[0].items[0].title, 'Das Boot (deutsch)');
});

test('Abgleich Alt-Agent (keine plex://-GUID): Titel + Jahr + Typ, sonst getrennt', function () {
  var local = D.localList({ MediaContainer: { Metadata: [lib('30', 'movie', 'Alien: Romulus', 2024, 'com.plexapp.agents.imdb://tt18412256?lang=de')] } }, {});
  var em = D.parseMatches(matches([
    { guid: G1, name: 'Alien - Romulus', year: 2024 },          // gleicher Titel ohne Satzzeichen + Jahr -> auf dem Server
    { guid: G2, name: 'Alien: Romulus', year: 2025 }            // anderes Jahr -> fremd
  ]), 'movie');
  var es = D.parseMatches(matches([{ guid: G3, name: 'Alien: Romulus', year: 2024 }]), 'show');   // anderer Typ -> fremd
  var g = D.group(local, [], em, es);
  H.eq(g[1].items.map(function (x) { return x.guid; }), [G2]);
  H.eq(g[2].items.map(function (x) { return x.guid; }), [G3]);
  // Bibliothek MIT plex://-GUID: Titelgleichheit allein reicht NICHT (anderer Film gleichen Namens)
  var l2 = D.localList({ MediaContainer: { Metadata: [lib('31', 'movie', 'Severance', 2006, 'plex://movie/aaaaaaaaaaaaaaaaaaaaaaaa')] } }, {});
  var e2 = D.parseMatches(matches([{ guid: G1, name: 'Severance', year: 2006 }]), 'movie');
  H.eq(D.group(l2, [], e2, []).map(function (x) { return x.id; }), ['server', 'extMovies']);
});

test('Gruppen: leere fehlen, nur fremde -> keine Server-Gruppe; nichts -> []', function () {
  H.eq(D.group([], [], [], []), []);
  var em = D.parseMatches(matches([{ guid: G2, name: 'MICKEY #7' }]), 'movie');
  H.eq(D.group([], [], em, []).map(function (x) { return x.id; }), ['extMovies']);
  assert.strictEqual(D.caption(em[0])[1], 'Film');
  H.eq(N.model.badge(em[0]), { b: '', n: '' });                       // kein Ungesehen-Eck auf fremden Titeln
  assert.strictEqual(N.model.progress(em[0]), 0);
  assert.strictEqual(D.overline(em[0]), 'Film · Nicht auf deinem Server');
});

test('Ablauf: lokale Suche + 2x matches parallel, danach EIN /library/all?guid=a,b; keine Schreibzugriffe', function () {
  var calls = [], plex = N.plex.get;
  D._resetAnchors(); prof({ uuid: 'p1', admin: true, kind: 'main' });
  N.plex.get = function (path, q, o, cb) {
    calls.push({ path: path, q: q });
    var d;
    if (path === '/library/sections/1/all') d = { MediaContainer: { Metadata: [{ ratingKey: '500' }] } };
    else if (path === '/library/sections/2/all') d = { MediaContainer: { Metadata: [{ ratingKey: '600' }] } };
    else if (path === '/hubs/search') d = { MediaContainer: { Hub: [{ type: 'movie', Metadata: [lib('10', 'movie', 'Mickey 17', 2025, G1)] }] } };
    else if (path === '/library/metadata/500/matches') d = matches([{ guid: G1, name: 'Mickey 17', year: 2025 }, { guid: G2, name: 'MICKEY #7' }]);
    else if (path === '/library/metadata/600/matches') d = matches([{ guid: G3, name: 'Mickey Mouse Clubhouse', year: 2006 }]);
    else if (path === '/library/all') d = { MediaContainer: { Metadata: [lib('20', 'show', 'Micky Maus Wunderhaus', 2006, G3)] } };
    cb(null, d);
    return { abort: function () {} };
  };
  var out = null;
  try {
    D.search('mickey', [{ id: 1, type: 'movie' }, { id: 2, type: 'show' }, { id: 3, type: 'artist' }], {}, function (g, info) { out = { g: g, info: info }; });
  } finally { N.plex.get = plex; }
  assert.ok(out);
  H.eq(out.info, { ext: 'ok', local: 'ok', cache: true });
  H.eq(out.g.map(function (x) { return x.id; }), ['server', 'extMovies']);
  H.eq(out.g[0].items.map(function (x) { return x.rk; }), ['10', '20']);
  H.eq(out.g[1].items.map(function (x) { return x.title; }), ['MICKEY #7']);
  var m = calls.filter(function (c) { return /matches$/.test(c.path); });
  H.eq(m.map(function (c) { return [c.q.agent, c.q.manual, c.q.title, c.q.language]; }), [['tv.plex.agents.movie', 1, 'mickey', 'de-DE'], ['tv.plex.agents.series', 1, 'mickey', 'de-DE']]);
  var all = calls.filter(function (c) { return c.path === '/library/all'; });
  assert.strictEqual(all.length, 1);
  H.eq(all[0].q.guid.split(','), [G1, G2, G3]);
  // Anker bleiben je Profil gemerkt: zweite Suche fragt die Bibliotheken nicht erneut
  calls = []; N.plex.get = function (path, q, o, cb) { calls.push({ path: path }); cb(null, { MediaContainer: {} }); return { abort: function () {} }; };
  try { D.search('xy', [{ id: 1, type: 'movie' }, { id: 2, type: 'show' }], {}, function () {}); } finally { N.plex.get = plex; }
  assert.ok(!calls.some(function (c) { return /^\/library\/sections\//.test(c.path); }));
});

test('Ablauf: matches verweigert (403) -> nur Server-Treffer, info.ext "fail"; ohne Film/Serien-Bibliothek "none"', function () {
  var plex = N.plex.get, out = null;
  D._resetAnchors(); prof({ uuid: 'p2', admin: false, kind: '' });
  N.plex.get = function (path, q, o, cb) {
    if (/matches$/.test(path)) cb({ type: 'http', status: 403 });
    else if (path === '/hubs/search') cb(null, { MediaContainer: { Hub: [{ type: 'show', Metadata: [lib('20', 'show', 'Severance', 2022, G3)] }] } });
    else cb(null, { MediaContainer: { Metadata: [{ ratingKey: '7' }] } });
    return { abort: function () {} };
  };
  try { D.search('sev', [{ id: 1, type: 'movie' }, { id: 2, type: 'show' }], {}, function (g, info) { out = { g: g, info: info }; }); } finally { N.plex.get = plex; }
  H.eq(out.info.ext, 'fail');
  H.eq(out.g.map(function (x) { return x.id; }), ['server']);
  D._resetAnchors(); out = null;
  N.plex.get = function (path, q, o, cb) { cb(null, { MediaContainer: {} }); return { abort: function () {} }; };
  try { D.search('sev', [{ id: 3, type: 'artist' }], {}, function (g, info) { out = info; }); } finally { N.plex.get = plex; }
  H.eq(out.ext, 'none');
});

test('Review P4: Teilfehler / GUID-Abgleich fehlgeschlagen / Anker geloescht (404) / nowatch', function () {
  var plex = N.plex.get, out = null, opts = [];
  // Filme laufen ins Zeitlimit, Serien ok -> 'part', nicht zwischenspeichern; matches mit nowatch (kein falsches "offline")
  D._resetAnchors(); prof({ uuid: 'r1', admin: true, kind: 'main' });
  N.plex.get = function (path, q, o, cb) {
    if (/matches$/.test(path)) { opts.push(o); if (/\/500\//.test(path)) cb({ type: 'timeout', status: 0 }); else cb(null, matches([{ guid: G3, name: 'Mickey Mouse Clubhouse', year: 2006 }])); }
    else if (path === '/library/sections/1/all') cb(null, { MediaContainer: { Metadata: [{ ratingKey: '500' }] } });
    else if (path === '/library/sections/2/all') cb(null, { MediaContainer: { Metadata: [{ ratingKey: '600' }] } });
    else cb(null, { MediaContainer: {} });
    return { abort: function () {} };
  };
  try { D.search('mi', [{ id: 1, type: 'movie' }, { id: 2, type: 'show' }], {}, function (g, info) { out = { g: g, info: info }; }); } finally { N.plex.get = plex; }
  H.eq([out.info.ext, out.info.cache], ['part', false]);
  H.eq(out.g.map(function (x) { return x.id; }), ['extShows']);
  assert.ok(opts.length === 2 && opts.every(function (o) { return o.nowatch === true; }));
  // GUID-Abgleich schlaegt fehl -> fremde Treffer fallen weg (ungeprueft koennten eigene Titel "nicht auf deinem Server" heissen)
  out = null;
  N.plex.get = function (path, q, o, cb) {
    if (/matches$/.test(path)) cb(null, matches([{ guid: G1, name: 'Mickey 17', year: 2025 }]));
    else if (path === '/library/all') cb({ type: 'timeout', status: 0 });
    else cb(null, { MediaContainer: {} });
    return { abort: function () {} };
  };
  try { D.search('mi', [{ id: 1, type: 'movie' }, { id: 2, type: 'show' }], {}, function (g, info) { out = { g: g, info: info }; }); } finally { N.plex.get = plex; }
  H.eq([out.info.ext, out.info.cache, out.g.length], ['fail', false, 0]);
  // Anker geloescht: matches 404 -> Anker neu ermitteln, genau ein zweiter Versuch
  var n404 = 0, secs = 0; out = null; D._resetAnchors();
  N.plex.get = function (path, q, o, cb) {
    if (path === '/library/metadata/500/matches') { n404++; cb({ type: 'http', status: 404 }); }
    else if (path === '/library/metadata/501/matches') cb(null, matches([{ guid: G2, name: 'MICKEY #7' }]));
    else if (path === '/library/sections/1/all') { secs++; cb(null, { MediaContainer: { Metadata: [{ ratingKey: secs === 1 ? '500' : '501' }] } }); }
    else if (/matches$/.test(path)) cb({ type: 'http', status: 404 });
    else cb(null, { MediaContainer: {} });
    return { abort: function () {} };
  };
  try { D.search('mi', [{ id: 1, type: 'movie' }], {}, function (g, info) { out = { g: g, info: info }; }); } finally { N.plex.get = plex; }
  H.eq([n404, secs, out.info.ext], [1, 2, 'ok']);
  H.eq(out.g.map(function (x) { return x.id; }), ['extMovies']);
});

test('Schalter: an im Hauptprofil, aus in anderen Profilen, nie in Kinderprofilen; Einstellung gewinnt', function () {
  prof({ uuid: 'a', admin: true, kind: 'main' }); assert.strictEqual(D.enabled(), true);
  N.session.settings.discover = false; assert.strictEqual(D.enabled(), false);
  prof({ uuid: 'b', admin: false, kind: '' }); assert.strictEqual(D.enabled(), false);
  N.session.settings.discover = true; assert.strictEqual(D.enabled(), true);
  prof({ uuid: 'c', admin: false, kind: 'kid' }); N.session.settings.discover = true; assert.strictEqual(D.enabled(), false);
  prof({ uuid: 'd', admin: false, kind: 'teen' }); N.session.settings.discover = true; assert.strictEqual(D.enabled(), false);
});

test('Merkliste ohne Helfer: komplett aus, keine einzige Anfrage (auch nicht probeHelper/list/set)', function () {
  var req = N.http.request, n = 0, pkg = N.session.pkg;
  N.http.request = function () { n++; return { abort: function () {} }; };
  try {
    N.session.pkg = null; N.config.helperUrl = ''; D._resetHelper();
    prof({ uuid: 'a', admin: true, kind: 'main' });
    assert.strictEqual(D.helper(), '');
    assert.strictEqual(D.watchlistOn(), false);
    assert.strictEqual(D.helperState(), 'none');
    D.probeHelper();
    var e1 = null, e2 = null;
    D.wl.list(function (err) { e1 = err; });
    D.wl.set({ guid: G1 }, true, function (err) { e2 = err; });
    assert.strictEqual(n, 0);
    return new Promise(function (res) { setTimeout(function () { H.eq([e1.type, e2.type], ['nohelper', 'nohelper']); res(); }, 5); });
  } finally { N.http.request = req; N.session.pkg = pkg; }
});

test('Merkliste mit Helfer: Erkennung /neo-helper, Kopfzeilen ohne Token, aus bei Kind/Freund/Schalter aus', function () {
  var req = N.http.request, seen = [], pkg = N.session.pkg;
  N.http.request = function (o, cb) {
    seen.push(o);
    if (/\/neo-helper$/.test(o.url)) cb(null, { name: 'plex-neo-helper', version: '1', watchlist: true });
    else if (/\/watchlist\?/.test(o.url)) cb(null, { items: [{ guid: G1, title: 'Mickey 17', year: 2025, type: 'movie' }, { guid: 'bad', title: 'x' }] });
    else cb(null, {});
    return { abort: function () {} };
  };
  try {
    N.session.pkg = { helper: { url: 'http://192.0.2.5:32499', key: 'k0123456789abcdefXYZ' } }; D._resetHelper();
    prof({ uuid: 'a', admin: true, kind: 'main', src: 'owner' });
    assert.strictEqual(D.helper(), 'http://192.0.2.5:32499');
    assert.strictEqual(D.helperState(), 'unknown');
    var ok = null; D.probeHelper(function (v) { ok = v; });
    assert.strictEqual(ok, true); assert.strictEqual(D.helperState(), 'ok');
    assert.strictEqual(D.watchlistOn(), true);
    var items = null; D.wl.list(function (err, l) { items = l; });
    H.eq(items.map(function (x) { return [x.title, x.ext, x.wl]; }), [['Mickey 17', true, true]]);
    assert.ok(D.wl.has({ guid: G1 }));
    var h = seen[seen.length - 1].headers;
    H.eq([h['X-Neo-Profile'], h['X-Neo-Key']], ['a', 'k0123456789abcdefXYZ']);
    assert.ok(!('X-Plex-Token' in h), 'nie ein Plex-Token an den Helfer');
    D.wl.set({ guid: G1 }, false, function () {});
    var last = seen[seen.length - 1];
    H.eq([last.method, last.url], ['DELETE', 'http://192.0.2.5:32499/watchlist/5eb8f25e3f398b00402fbe55']);
    assert.ok(!D.wl.has({ guid: G1 }));
    N.session.settings.watchlist = false; assert.strictEqual(D.watchlistOn(), false);
    prof({ uuid: 'k', admin: false, kind: 'kid' }); assert.strictEqual(D.watchlistOn(), false);
    prof({ uuid: 'f', admin: false, kind: '', src: 'friend' }); assert.strictEqual(D.watchlistOn(), false);
    // Helfer antwortet nicht -> ausgeblendet
    D._resetHelper(); prof({ uuid: 'a', admin: true, kind: 'main' });
    N.http.request = function (o, cb) { cb({ type: 'timeout', status: 0 }); return { abort: function () {} }; };
    D.probeHelper(); assert.strictEqual(D.helperState(), 'down'); assert.strictEqual(D.watchlistOn(), false);
  } finally { N.http.request = req; N.session.pkg = pkg; D._resetHelper(); }
});

test('setup.json "helper": nur http:// + private IPv4, Schluessel optional; config.json helperUrl gleich streng', function () {
  function cfg(helper) {
    var d = { kind: 'plexneo-setup', schema: 1, server: { machineIdentifier: 'abcdef123456', uris: ['http://172.16.5.2:32400'] },
      profiles: [{ uuid: 'u1', title: 'A', kind: 'owner', token: 'tok12345678' }] };
    if (helper !== undefined) d.helper = helper;
    var r = N.setupFile.parse(JSON.stringify(d)); assert.ok(r.ok); return r.cfg.helper;
  }
  assert.strictEqual(cfg(), null);
  H.eq(cfg({ url: 'http://172.16.5.3:32499/' }), { url: 'http://172.16.5.3:32499', key: '' });
  H.eq(cfg({ url: 'http://10.0.0.2:32499', key: 'abcdefghijklmnop' }), { url: 'http://10.0.0.2:32499', key: 'abcdefghijklmnop' });
  assert.strictEqual(cfg({ url: 'https://172.16.5.3:32499' }), null);
  assert.strictEqual(cfg({ url: 'http://8.8.8.8:32499' }), null);
  assert.strictEqual(cfg({ url: 'http://helper.example:32499' }), null);
  assert.strictEqual(cfg({ url: 'http://172.16.5.3:32499', key: 'kurz' }).key, '');
  var pkg = N.session.pkg; N.session.pkg = null;
  try {
    N.config.apply({ helperUrl: 'http://8.8.8.8:1' }); assert.strictEqual(D.helper(), '');
    N.config.apply({ helperUrl: 'http://192.0.2.9:32499' });
    assert.strictEqual(D.helper(), '');                                   // 192.0.2.x ist keine private Adresse
    N.config.apply({ helperUrl: 'http://192.168.0.9:32499' }); assert.strictEqual(D.helper(), 'http://192.168.0.9:32499');
  } finally { N.config.helperUrl = ''; N.session.pkg = pkg; }
});

test('Seitenleiste: Entdecken unter der Suche, Bibliotheken ruecken nach und bleiben ueber den Einstellungen', function () {
  var R = N.ui.rail, RR = N.railRows, libs = [{ id: 1 }, { id: 2 }, { id: 3 }];
  H.eq(RR.enabled(null, RR.avail(libs, false)), ['search', 'home', 'lib-1', 'lib-2', 'lib-3']);
  H.eq(RR.enabled(null, RR.avail(libs, true)), ['search', 'discover', 'home', 'lib-1', 'lib-2', 'lib-3']);
  H.eq(R.layoutY(6), { y0: 112, step: 56 });                          // Suche 112, Entdecken 168, Start 224, Bibliotheken ab 280
  var L = R.layoutY(10);                                              // Suche, Entdecken, Start + 7 Bibliotheken
  assert.ok(L.y0 + 9 * L.step + 48 <= 636, 'letzter Eintrag endet vor den Einstellungen (y 636)');
  assert.ok(L.step >= 48);
});

/* ---------- Helfer (installer/neosetup/helper.py): Erkennung, Ausfall, Profil ohne Merkliste ---------- */
function withHttp(fn, body) {
  var req = N.http.request, pkg = N.session.pkg, seen = [], toast = N.ui.toast.show, toasts = [];
  N.http.request = function (o, cb) { seen.push(o); fn(o, cb); return { abort: function () {} }; };
  N.ui.toast.show = function (t) { toasts.push(t); };
  try { body(seen, toasts); } finally { N.http.request = req; N.session.pkg = pkg; N.ui.toast.show = toast; D._resetHelper(); D.RETRY = 60000; }
}
var PKG = { helper: { url: 'http://192.168.7.30:32499', key: 'k0123456789abcdefXYZ' }, computer: { address: '192.168.7.31', updatePort: 32499 },
  server: { uris: ['http://192.168.7.32:32400', 'http://8.8.8.8:32400'] } };

test('Helfer-Erkennung: nur Adressen aus setup.json (Helfer, Einrichtungs-Computer, PMS-Rechner), feste Port-Probe, kein Scan', function () {
  N.session.pkg = PKG; D._resetHelper();
  H.eq(D.helperCands(), ['http://192.168.7.30:32499', 'http://192.168.7.31:32499', 'http://192.168.7.32:32499']);   // oeffentliche Adresse fehlt
  N.session.pkg = { computer: PKG.computer, server: PKG.server };
  H.eq(D.helperCands(), []);                                                   // ohne eingetragenen Helfer: keine Probe
  withHttp(function (o, cb) {
    if (o.url === 'http://192.168.7.32:32499/neo-helper') cb(null, { name: 'plex-neo-helper', watchlist: true, discover: true });
    else cb({ type: 'timeout', status: 0 });
  }, function (seen) {
    N.session.pkg = PKG; D._resetHelper(); prof({ uuid: 'a', admin: true, kind: 'main', src: 'owner' });
    var ok = null; D.probeHelper(function (v) { ok = v; });
    assert.strictEqual(ok, true);
    H.eq(seen.map(function (o) { return o.url; }), ['http://192.168.7.30:32499/neo-helper', 'http://192.168.7.31:32499/neo-helper', 'http://192.168.7.32:32499/neo-helper']);
    assert.strictEqual(D.helper(), 'http://192.168.7.32:32499');                // gefundene Adresse wird genutzt
    seen.forEach(function (o) { assert.ok(!o.headers['X-Neo-Key'] && !o.headers['X-Plex-Token'], 'Probe ohne Schluessel/Token'); });
    D.wl.list(function () {});
    assert.strictEqual(seen[seen.length - 1].url.indexOf('http://192.168.7.32:32499/watchlist?'), 0);
  });
});

test('Helfer faellt aus: "nicht erreichbar" (Merkliste + Stufe 2 weg, ein Toast), nach RETRY neue Probe', function () {
  var up = true;
  withHttp(function (o, cb) {
    if (!up) { cb({ type: 'network', status: 0 }); return; }
    if (/neo-helper$/.test(o.url)) cb(null, { name: 'plex-neo-helper', watchlist: true, discover: true }); else cb(null, { items: [] });
  }, function (seen, toasts) {
    N.session.pkg = { helper: PKG.helper }; D._resetHelper(); prof({ uuid: 'a', admin: true, kind: 'main', src: 'owner' });
    D.probeHelper();
    assert.strictEqual(D.helperState(), 'ok'); assert.strictEqual(D.watchlistOn(), true); assert.strictEqual(D.discoverOn(), true);
    up = false;
    var e = null; D.wl.list(function (err) { e = err; });
    assert.strictEqual(e.helper, 'down');
    assert.strictEqual(D.helperState(), 'down'); assert.strictEqual(D.watchlistOn(), false); assert.strictEqual(D.discoverOn(), false);
    D.downToast(); D.downToast();
    H.eq(toasts, ['Helfer von Neolume nicht erreichbar']);                          // einmal je Ausfall
    var n = seen.length; D.probeHelper();
    assert.strictEqual(seen.length, n, 'vor Ablauf von RETRY keine neue Probe');
    D.RETRY = -1; up = true; D.probeHelper();
    assert.strictEqual(D.helperState(), 'ok');
    D.downToast(); assert.strictEqual(toasts.length, 2);                        // nach Erholung wieder ein Hinweis moeglich
  });
});

test('Helfer kennt das Profil nicht (404 profile, z. B. Plex-PIN): Merkliste nur fuer dieses Profil aus; HTTP-Fehler != Ausfall', function () {
  withHttp(function (o, cb) {
    if (/neo-helper$/.test(o.url)) cb(null, { name: 'plex-neo-helper', watchlist: true });
    else if (o.headers['X-Neo-Profile'] === 'kid2') cb({ type: 'http', status: 404, body: { error: 'profile' } });
    else cb({ type: 'http', status: 502, body: { error: 'plex_auth' } });
  }, function () {
    N.session.pkg = { helper: PKG.helper }; D._resetHelper();
    prof({ uuid: 'kid2', admin: false, kind: '', src: 'home' }); D.probeHelper();
    assert.strictEqual(D.watchlistOn(), true);
    var e = null; D.wl.list(function (err) { e = err; });
    assert.strictEqual(e.helper, 'profile'); assert.strictEqual(D.watchlistOn(), false);
    prof({ uuid: 'a', admin: true, kind: 'main', src: 'owner' }); assert.strictEqual(D.watchlistOn(), true);
    D.wl.set({ guid: G1 }, true, function (err) { e = err; });
    H.eq([e.status, e.helper, D.helperState()], [502, '', 'ok']);               // plex.tv-Fehler: Toast "Merkliste gerade nicht erreichbar", Helfer bleibt
  });
});

test('setup.json vom Einrichtungsprogramm: helper {url, key} wird angenommen (Schluessel wie secrets.token_urlsafe(24))', function () {
  var d = { kind: 'plexneo-setup', schema: 1, server: { machineIdentifier: 'abcdef123456', uris: ['http://10.0.0.20:32400'] },
    profiles: [{ uuid: 'u1', title: 'A', kind: 'owner', token: 'tok12345678' }], computer: { address: '10.0.0.10', updatePort: 32499 },
    helper: { url: 'http://10.0.0.10:32499', key: 'Zk3-_Q9xYp0aB1cD2eF3gH4iJ5kL6mN7' } };
  var r = N.setupFile.parse(JSON.stringify(d));
  assert.ok(r.ok);
  H.eq(r.cfg.helper, { url: 'http://10.0.0.10:32499', key: 'Zk3-_Q9xYp0aB1cD2eF3gH4iJ5kL6mN7' });
});

test('Reihe "Deine Merkliste": EIN GUID-Abgleich am PMS, eigene Titel abspielbar markiert, Abgleich-Fehler -> keine Reihe', function () {
  var plex = N.plex.get, q = [], fail = false;
  N.plex.get = function (path, query, opts, cb) {
    q.push([path, query.guid]);
    if (fail) cb({ type: 'http', status: 500 });
    else cb(null, { MediaContainer: { Metadata: [lib('42', 'movie', 'Mickey 17', 2025, G1)] } });
    return { abort: function () {} };
  };
  try {
    withHttp(function (o, cb) {
      if (/neo-helper$/.test(o.url)) cb(null, { name: 'plex-neo-helper', watchlist: true });
      else cb(null, { items: [{ guid: G1, title: 'Mickey 17', year: 2025 }, { guid: G3, title: 'Fremde Serie', year: 2024 }], total: 2 });
    }, function () {
      N.session.pkg = { helper: PKG.helper }; D._resetHelper(); prof({ uuid: 'a', admin: true, kind: 'main', src: 'owner' }); D.probeHelper();
      var out = null; D.wl.listMarked({}, function (err, l) { out = l; });
      H.eq(q, [['/library/all', G1 + ',' + G3]]);
      H.eq(out.map(function (x) { return [x.title, !!x.ext, x.mark, x.wl]; }),
        [['Mickey 17', false, 'disc.onServer', true], ['Fremde Serie', true, 'disc.notOnServer', true]]);
      assert.strictEqual(out[0].rk, '42');
      fail = true; D.wl.listMarked({}, function (err, l) { out = [err && err.status, l.length]; });
      H.eq(out, [500, 0]);
    });
  } finally { N.plex.get = plex; }
});
