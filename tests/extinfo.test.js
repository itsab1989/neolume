'use strict';
/* Entdecken: Details fremder Titel (SPEC DISC-5) – Helfer-Antwort -> Modell, Zusammenfuehren zweier Quellen, Metazeile/Zeile/
 * Chips/Besetzung/INFO-Text, Ablauf: ohne Helfer bzw. mit aelterem Helfer KEINE Anfrage, sonst EINE je Titel + Sprache. */
var test = require('node:test'), assert = require('node:assert');
var H = require('./helpers/load');
var N = H.load().N, D = N.disc;
N.i18n.set('de');

var G = 'plex://movie/5d77682854f42c001f8c2c48', GS = 'plex://show/5e1622a54f2292003e912fcf';
function helperMovie() {
  return { id: '5d77682854f42c001f8c2c48', type: 'movie', guid: G, title: 'Nachtwache', year: 1978, summary: 'Eine erfundene Geschichte.',
    tagline: 'Kurz gesagt.', date: '1978-10-25', thumb: 'https://image.tmdb.org/t/p/original/x.jpg', art: 'https://metadata-static.plex.tv/5/a.jpg',
    contentRating: 'de/16', duration: 5460000, rating: 8.9, studio: 'Demo Studio', network: '', genres: ['Horror', 'Thriller', 'Drama', 'Krimi'],
    directors: ['Rita Regie', 'Bo Zwei', 'Cy Drei'], writers: ['Bo Buch'],
    cast: [{ name: 'Ann Eins', role: 'Laurie', thumb: 'https://metadata-static.plex.tv/p/1.jpg' }, { name: 'Ben Zwei', role: '', thumb: 'http://evil.example/x.jpg' }, { role: 'ohne Namen' }],
    ids: { tmdb: 948 } };
}

test('Helfer-Antwort -> Modell: nur bekannte Felder, Bilder nur https von bekannten Hosts', function () {
  var x = D.infoFromHelper(helperMovie());
  H.eq([x.src, x.sum, x.tagline, x.date, x.cr, x.dur, x.rating, x.studio], ['plex', 'Eine erfundene Geschichte.', 'Kurz gesagt.', '1978-10-25', 'de/16', 5460000, 8.9, 'Demo Studio']);
  H.eq(x.genres, ['Horror', 'Thriller', 'Drama', 'Krimi']);
  H.eq(x.cast, [{ name: 'Ann Eins', role: 'Laurie', thumb: 'https://metadata-static.plex.tv/p/1.jpg' }, { name: 'Ben Zwei', role: '', thumb: '' }]);
  assert.strictEqual(x.art, 'https://metadata-static.plex.tv/5/a.jpg');
  assert.strictEqual(D.img('javascript:alert(1)'), '');
  assert.strictEqual(D.img('https://image.tmdb.org.evil.example/x.jpg'), '');
  assert.strictEqual(D.infoFromHelper(null), null);
  var bad = D.infoFromHelper({ summary: 5, duration: -3, rating: 99, genres: 'Horror', cast: 'x', date: '1978', seasons: 'viele', continuing: 'ja' });
  H.eq([bad.sum, bad.dur, bad.rating, bad.genres, bad.cast, bad.date, bad.seasons, bad.status], ['', 0, 0, [], [], '', 0, '']);
  var sh = D.infoFromHelper({ seasons: 6, episodes: 36, continuing: true, network: 'Demo TV', lastAired: '2026-10-01' });
  H.eq([sh.seasons, sh.episodes, sh.status, sh.network, sh.lastAired], [6, 36, 'running', 'Demo TV', '2026-10-01']);
  assert.strictEqual(D.infoFromHelper({ continuing: false }).status, 'ended');
});

test('Zwei Quellen: die erste hat Vorrang, leere Felder/Listen kommen aus der zweiten', function () {
  var a = D.infoFromHelper({ summary: 'Plex-Text', genres: ['Drama'], cast: [] });
  var b = D.emptyInfo(); b.src = 'ext'; b.sum = 'TMDB-Text'; b.creators = ['Ida Idee']; b.cast = [{ name: 'C', role: '', thumb: '' }]; b.genres = ['Krimi']; b.status = 'ended';
  var m = D.mergeInfo(a, b);
  H.eq([m.src, m.sum, m.genres, m.creators, m.cast.length, m.status], ['plex+ext', 'Plex-Text', ['Drama'], ['Ida Idee'], 1, 'ended']);
  assert.strictEqual(D.mergeInfo(null, b), b);
  assert.strictEqual(D.mergeInfo(a, null), a);
  assert.strictEqual(D.mergeInfo(null, null), null);
});

test('Metazeile, Zeile unter der Beschreibung, Genre-Chips, Besetzungs-Karten', function () {
  var it = { type: 'movie', year: 1978, title: 'Nachtwache' }, x = D.infoFromHelper(helperMovie());
  assert.strictEqual(D.extMeta(it, x), '1978 · 1 Std. 31 Min. · FSK 16 · 8,9/10 · Hier nicht abspielbar');
  assert.strictEqual(D.extMeta(it, null), '1978 · Hier nicht abspielbar');                 // ohne Daten wie bisher
  assert.strictEqual(D.extMeta(it, x, 'Vorgemerkt'), '1978 · 1 Std. 31 Min. · FSK 16 · 8,9/10 · Vorgemerkt');
  assert.strictEqual(D.extLine(it, x), 'Regie: Rita Regie, Bo Zwei');
  H.eq(D.extChips(x), ['Horror', 'Thriller', 'Drama']);
  var c = D.extCast(x);
  H.eq([c.length, c[0].type, c[0].title, c[0].role, c[0].thumb], [2, 'person', 'Ann Eins', 'Laurie', 'https://metadata-static.plex.tv/p/1.jpg']);
  var sh = { type: 'show', year: 2022, title: 'Graue Pferde' }, xs = D.infoFromHelper({ seasons: 6, continuing: true, contentRating: 'TV-MA', rating: 8.7, network: 'Demo TV', duration: 3000000 });
  assert.strictEqual(D.extMeta(sh, xs), '2022 · 6 Staffeln · Läuft noch · US: TV-MA · 8,7/10 · Hier nicht abspielbar', 'US-Freigabe nie wie FSK (TV-Test 29.10.)');
  N.i18n.set('en');
  assert.strictEqual(N.fmt.rated(xs.cr), 'TV-MA', 'Englisch: US ist das eigene Land');
  assert.strictEqual(N.fmt.rated('gb/15'), 'GB: 15');
  N.i18n.set('de');
  assert.strictEqual(N.fmt.rated('gb/15'), 'GB: 15'); assert.strictEqual(N.fmt.rated('R'), 'R', 'ohne Land (alte Plex-Daten) unveraendert');
  assert.strictEqual(D.extLine(sh, xs), 'Sender: Demo TV');
  xs.creators = ['Ida Idee'];
  assert.strictEqual(D.extLine(sh, xs), 'Sender: Demo TV · Idee: Ida Idee');
  assert.strictEqual(D.extLine(it, null), '');
  N.i18n.set('en');
  try { assert.strictEqual(D.extMeta(sh, D.infoFromHelper({ seasons: 1, continuing: false })), '2022 · 1 season · Ended · Can’t be played here'); }
  finally { N.i18n.set('de'); }
});

test('INFO-Text: Leitsatz, ganze Beschreibung, Regie/Drehbuch/Studio, Genres, Datum; Hinweis der Erweiterung', function () {
  var it = { type: 'movie', year: 1978, title: 'Nachtwache' }, x = D.infoFromHelper(helperMovie());
  var t = D.extInfoText(it, x, x.sum, '');
  assert.ok(t.indexOf('Film · Nicht auf deinem Server · 1978') === 0, t);
  ['Kurz gesagt.', 'Eine erfundene Geschichte.', 'Regie: Rita Regie, Bo Zwei, Cy Drei', 'Drehbuch: Bo Buch', 'Studio: Demo Studio', 'Horror, Thriller, Drama, Krimi', 'Erschienen: 25.10.1978']
    .forEach(function (s) { assert.ok(t.indexOf(s) >= 0, s + ' fehlt in ' + t); });
  assert.ok(D.extInfoText(it, x, x.sum, 'Notiz vom 1.1.').slice(-14) === 'Notiz vom 1.1.');
  var sh = { type: 'show', year: 2022, title: 'S' }, xs = D.infoFromHelper({ seasons: 6, episodes: 36, network: 'Demo TV', date: '2022-04-01', directors: ['Folgen-Regie'] });
  var ts = D.extInfoText(sh, xs, 'Text', '');
  ['Sender: Demo TV', '6 Staffeln mit 36 Folgen', 'Erstausstrahlung: 01.04.2022'].forEach(function (s) { assert.ok(ts.indexOf(s) >= 0, s + ' fehlt in ' + ts); });
  assert.ok(ts.indexOf('Folgen-Regie') < 0, 'Serien: Regie einzelner Folgen ist keine Angabe zur Serie');
  assert.ok(D.extInfoText(it, null, 'Nur Suche', '').indexOf('Nur Suche') > 0);
});

function withHelper(features, answer, fn) {
  var req = N.http.request, seen = [], pkg = N.session.pkg;
  N.http.request = function (o, cb) {
    seen.push(o);
    if (/\/neo-helper$/.test(o.url)) cb(null, { name: 'plex-neo-helper', watchlist: true, discover: true, features: features });
    else answer(o, cb);
    return { abort: function () {} };
  };
  N.session.pkg = { helper: { url: 'http://192.0.2.5:32499', key: 'k0123456789abcdefXYZ' } };
  N.session.profile = { uuid: 'a', admin: true, kind: 'main', src: 'owner' }; N.session.settings = {};
  D._resetHelper(); D._resetInfo();
  return Promise.resolve().then(function () { return fn(seen); }).finally(function () { N.http.request = req; N.session.pkg = pkg; });
}
function details(it) { return new Promise(function (res) { D.details(it, function (err, x) { res({ err: err, x: x }); }); }); }

test('Ohne Helfer: keine Anfrage, Fehler "nohelper" (Seite zeigt den Hinweis)', function () {
  var req = N.http.request, n = 0, pkg = N.session.pkg;
  N.http.request = function () { n++; return { abort: function () {} }; };
  N.session.pkg = null; N.config.helperUrl = ''; D._resetHelper(); D._resetInfo();
  return details({ guid: G }).then(function (r) {
    assert.strictEqual(r.err.type, 'nohelper'); assert.strictEqual(r.x, null); assert.strictEqual(n, 0);
  }).finally(function () { N.http.request = req; N.session.pkg = pkg; });
});

test('Aelterer Helfer ohne "details": keine Anfrage an /details', function () {
  return withHelper(['watchlist', 'discover'], function (o, cb) { cb(null, {}); }, function (seen) {
    D.probeHelper();
    return details({ guid: G }).then(function (r) {
      assert.strictEqual(r.err.type, 'nohelper');
      assert.ok(seen.every(function (o) { return !/\/details/.test(o.url); }));
      assert.strictEqual(D.helperState(), 'ok');
    });
  });
});

test('Helfer mit "details": EINE Anfrage je Titel + Sprache, Kopfzeilen ohne Plex-Token, danach aus dem Speicher', function () {
  return withHelper(['watchlist', 'discover', 'details'], function (o, cb) { cb(null, helperMovie()); }, function (seen) {
    D.probeHelper();
    var n0 = seen.length;
    return details({ guid: G }).then(function (r) {
      assert.strictEqual(r.err, null); assert.strictEqual(r.x.sum, 'Eine erfundene Geschichte.');
      assert.strictEqual(seen.length, n0 + 1);
      var o = seen[seen.length - 1];
      assert.strictEqual(o.url, 'http://192.0.2.5:32499/details?id=5d77682854f42c001f8c2c48&lang=de');
      H.eq([o.headers['X-Neo-Profile'], o.headers['X-Neo-Key']], ['a', 'k0123456789abcdefXYZ']);
      assert.ok(!('X-Plex-Token' in o.headers));
      return details({ guid: G });
    }).then(function (r) {
      assert.strictEqual(seen.length, n0 + 1, 'zweites Oeffnen aus dem Speicher');
      assert.ok(r.x);
      N.i18n.set('en');
      return details({ guid: G });
    }).then(function () {
      N.i18n.set('de');
      assert.ok(/lang=en$/.test(seen[seen.length - 1].url));
      return details({ guid: 'plex://episode/5d77682854f42c001f8c2c48' });
    }).then(function (r) {
      assert.strictEqual(r.err.type, 'guid');
      return details({ guid: GS });
    });
  });
});

test('Helfer-Fehler: nicht erreichbar -> "down" (kein Zwischenspeichern), kaputte Antwort -> "parse"', function () {
  var mode = 'down';
  return withHelper(['details'], function (o, cb) { if (mode === 'down') cb({ type: 'network' }); else cb(null, 'kein Objekt'); }, function (seen) {
    D.probeHelper();
    return details({ guid: G }).then(function (r) {
      assert.strictEqual(r.err.type, 'network'); assert.strictEqual(D.helperState(), 'down');
      D._resetHelper(); D.probeHelper(); mode = 'parse';
      return details({ guid: G });
    }).then(function (r) { assert.strictEqual(r.err.type, 'parse'); assert.strictEqual(r.x, null); });
  });
});

test('Zusammenfuehren: Freigabe mit Land schlaegt eine US-Angabe; INFO-Text kuerzt die Beschreibung, nie die Fakten', function () {
  var a = D.infoFromHelper({ contentRating: 'R' }), b = D.emptyInfo(); b.cr = 'de/16';
  assert.strictEqual(D.mergeInfo(a, b).cr, 'de/16');
  assert.strictEqual(D.mergeInfo(D.infoFromHelper({ contentRating: 'de/12' }), b).cr, 'de/12');
  var x = D.infoFromHelper(helperMovie()), long = new Array(120).join('Sehr langer Text. ');
  var t = D.extInfoText({ type: 'movie', year: 1978, title: 'N' }, x, long, 'Hinweis der Erweiterung.');
  assert.ok(t.length <= 700, t.length);
  ['Regie: Rita Regie', 'Erschienen: 25.10.1978', 'Hinweis der Erweiterung.'].forEach(function (s) { assert.ok(t.indexOf(s) >= 0, s + ' fehlt'); });
});
