'use strict';
/* Helfer Protokoll 2 auf allen Routen (05.11.2026), Seite der App: Merkliste, Entdecken, Details, Weitere Server und
 * Fernsehen (/live/open) gehen mit setup.json helper.sign SIGNIERT und OHNE X-Neo-Key im Klartext; Paket von vor 1.0.17 (ohne
 * Signaturschluessel) wie bisher. Signierter Text gleich in installer/neosetup/helper.py (sig_message, hier gegengeprueft).
 * Ehrliche Meldungen: App-Paket neu erstellen, Helfer aktualisieren, Uhrzeit, Docker-Bridge. */
var test = require('node:test'), assert = require('node:assert'), crypto = require('crypto'), cp = require('child_process'), path = require('path');
var H = require('./helpers/load');
var N = H.load().N, D = N.disc;
N.i18n.set('de');

var SIGN = '3c'.repeat(32), KEY = 'k0123456789abcdefXYZ', HELPER = 'http://10.0.0.5:32499';
function setup(sign) {
  var d = { schema: 1, kind: 'plexneo-setup', createdAt: '2026-11-05T10:00:00Z', server: { machineIdentifier: 'machine-0001', name: 'S', uris: ['http://10.0.0.4:32400'] },
    profiles: [{ id: 1, uuid: 'own1', title: 'Alex', kind: 'owner', token: 'T-owner-0001' }], helper: { url: HELPER, key: KEY } };
  if (sign) d.helper.sign = sign;
  var r = N.setupFile.parse(JSON.stringify(d));
  assert.ok(r.ok);
  N.session.pkg = r.cfg; N.session.profile = { uuid: 'own1', admin: true, kind: 'main', src: 'owner' }; N.session.settings = {};
  D._resetHelper();
  return r.cfg;
}
function fake(answer) {
  var seen = [], req = N.http.request;
  N.http.request = function (o, cb) {
    seen.push(o);
    if (/\/neo-helper$/.test(o.url)) cb(null, { name: 'plex-neo-helper', version: '1', watchlist: true, discover: true, features: ['sig2', 'live'] });
    else { var a = answer ? answer(o) : [null, { items: [], total: 0 }]; cb(a[0], a[1]); }
    return { abort: function () {} };
  };
  return { seen: seen, done: function () { N.http.request = req; } };
}
function want(key, method, p, h) {
  var msg = ['neo-2', method, p, h['X-Neo-Time'], h['X-Neo-Nonce'], h['X-Neo-Profile'] || '', crypto.createHash('sha256').update('').digest('hex')].join('\n');
  return crypto.createHmac('sha256', key).update(msg).digest('hex');
}

test('Protokoll 2: Merkliste signiert, kein X-Neo-Key, Signaturschluessel nicht im Paket-Objekt', function () {
  var cfg = setup(SIGN), f = fake();
  try {
    assert.ok(JSON.stringify(cfg).indexOf(SIGN) < 0, 'helper.sign nicht in N.session.pkg');
    assert.strictEqual(D.signs(), true);
    D.probeHelper(function () {});
    D.wl.list(function () {});
    var o = f.seen[f.seen.length - 1], h = o.headers;
    assert.ok(/\/watchlist\?type=all/.test(o.url));
    assert.strictEqual(h['X-Neo-Key'], undefined, 'kein Schluessel im Klartext');
    H.eq([h['X-Neo-Sv'], h['X-Neo-Profile']], ['2', 'own1']);
    assert.ok(/^\d{10}$/.test(h['X-Neo-Time']) && /^[0-9a-f]{24}$/.test(h['X-Neo-Nonce']));
    assert.strictEqual(h['X-Neo-Sig'], want(SIGN, 'GET', o.url.replace(HELPER, ''), h));
    var h2 = o.resign();                                                     // Wiederholung: neue Nonce, neu signiert
    assert.notStrictEqual(h2['X-Neo-Nonce'], h['X-Neo-Nonce']);
    D.wl.set({ guid: 'plex://movie/5eb8f25e3f398b00402fbe55' }, true, function () {});
    o = f.seen[f.seen.length - 1];
    assert.strictEqual(o.method, 'PUT');
    assert.strictEqual(o.headers['X-Neo-Sig'], want(SIGN, 'PUT', o.url.replace(HELPER, ''), o.headers));
    D.helperGet('/servers', function () {});
    assert.strictEqual(f.seen[f.seen.length - 1].headers['X-Neo-Key'], undefined);
  } finally { f.done(); }
});

test('Protokoll 2: gleicher signierter Text wie im Helfer (installer/neosetup/helper.py sig_message)', function () {
  var py = cp.execFileSync('python3', ['-I', '-c', 'import sys; sys.path.insert(0, sys.argv[1]); from neosetup.helper import sig_message; ' +
    'print(sig_message("GET", "/discover/new?type=movie&size=20", "1800000000", "ab" * 12, "own1"), end="")', path.join(__dirname, '..', 'installer')]).toString();
  assert.strictEqual(py, D.sigMsg('GET', '/discover/new?type=movie&size=20', '1800000000', 'ab'.repeat(12), 'own1', ''));
});

test('Paket von vor 1.0.17 (ohne helper.sign): wie bisher X-Neo-Key – der Helfer derselben Einrichtung hat auch keinen Signaturschluessel', function () {
  setup('');
  var f = fake();
  try {
    assert.strictEqual(D.signs(), false);
    D.probeHelper(function () {});
    D.wl.list(function () {});
    var h = f.seen[f.seen.length - 1].headers;
    assert.strictEqual(h['X-Neo-Key'], KEY); assert.ok(!('X-Neo-Sv' in h) && !('X-Neo-Sig' in h));
  } finally { f.done(); }
});

test('Ehrliche Meldungen: neues App-Paket, Helfer zu alt, Uhrzeit, Docker-Bridge – einmal als Toast, Einstellungen nennen den Schritt', function () {
  var toasts = [], show = N.ui.toast.show;
  N.ui.toast.show = function (t) { toasts.push(t); };
  try {
    [['sig_required', 401, 'resetup'], ['no_sig', 401, 'resetup'], ['key', 401, 'oldhelper'], ['time', 401, 'time'], ['nat', 403, 'nat']].forEach(function (c) {
      setup(SIGN);
      var f = fake(function () { return [{ type: 'http', status: c[1], body: { error: c[0] } }, null]; });
      try {
        D.probeHelper(function () {});
        D.wl.list(function () {});
        assert.strictEqual(D.helperProblem(), c[2], c[0]);
        assert.strictEqual(D.helperState(), 'down');
        D.helperFail({ type: 'http', status: c[1], body: { error: c[0] } });
        assert.ok(N.t('set.watchlist.' + c[2] + '.desc').indexOf('set.') !== 0, 'Text fehlt: ' + c[2]);
      } finally { f.done(); }
    });
    H.eq(toasts, ['Helfer: App-Paket bitte neu erstellen', 'Helfer: App-Paket bitte neu erstellen', 'Helfer bitte aktualisieren',
      'Helfer: Uhrzeit am Fernseher prüfen', 'Helfer: Docker mit Host-Netzwerk starten']);
    setup('');                                                               // ohne Signaturschluessel ist 401 key kein "alter Helfer"
    assert.strictEqual(D.problemOf({ type: 'http', status: 401, body: { error: 'key' } }), '');
  } finally { N.ui.toast.show = show; }
});

test('Fernsehen: /live/open signiert (ohne Profil), Schliessen nur mit dem Sitzungs-Token im Pfad', function () {
  setup(SIGN);
  var f = fake(function (o) { return /\/live\/open/.test(o.url) ? [null, { path: '/live/' + 'A'.repeat(32) + '/index.m3u8', h: 540 }] : [null, {}]; });
  try {
    D.probeHelper(function () {});
    var got = null;
    N.live.helperOpen('ard', undefined, function (e, r) { got = [e, r]; });
    var o = f.seen.filter(function (x) { return /\/live\/open/.test(x.url); })[0];
    assert.ok(o, 'live/open angefragt (' + JSON.stringify(got && got[0]) + ')');
    assert.strictEqual(o.headers['X-Neo-Key'], undefined);
    assert.strictEqual(o.headers['X-Neo-Profile'], undefined);
    assert.strictEqual(o.headers['X-Neo-Sig'], want(SIGN, 'GET', o.url.replace(HELPER, ''), o.headers));
    N.live.helperClose(HELPER + '/live/' + 'A'.repeat(32) + '/index.m3u8');
    var del = f.seen[f.seen.length - 1];
    assert.strictEqual(del.method, 'DELETE');
    assert.ok(!del.headers || !del.headers['X-Neo-Key']);
  } finally { f.done(); }
});
