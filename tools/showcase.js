#!/usr/bin/env node
/* Oeffentliche Screenshots mit erfundenem Showcase-Datensatz (tests/showcase/).
 *   node tools/showcase.js                     oeffentliche Marke, englisch -> public/docs/screenshots/<name>.png
 *   node tools/showcase.js --lang de           deutsche Oberflaeche  -> public/docs/screenshots/de/<name>.png
 *   node tools/showcase.js --brand private     andere Marke (Ausgabe dann docs/screenshots/), --no-build: app.min.js wie gebaut
 * Baut vorher app/app.min.js mit der gewaehlten Marke (Standard: public) – danach fuer private Pakete neu "npm run build".
 *   node tools/showcase.js --only home,player  nur diese Szenen      --out <dir> anderes Zielverzeichnis
 *   node tools/showcase.js --serve             nur den Mock starten (Port ausgeben, zum Ausprobieren im Browser)
 *   --no-optimize                              PNGs nicht verkleinern (sonst pngquant + oxipng, falls installiert: brew install pngquant oxipng)
 * Wie tools/visual.js: tools/preview.html in Firefox headless (1280x720) gegen einen lokalen Mock (PMS + plex.tv + Bilder),
 * aber mit tests/showcase/data.js (erfundene Titel, Personen, Profile) und generiertem SVG-Artwork (tests/showcase/art.js).
 * Keine Medien oder Namen des echten Servers. Braucht den Release-Build (npm run build).
 * "Weitere Server" (Szene sidebar): ein zweiter Mock auf eigenem Port spielt den freigegebenen Server eines Freundes (D.FRIEND);
 * diese Szene laeuft wie ein Paket mit setup.json (window.PN_SETUP), Profilbilder dann als https-Adressen ueber /photo/:/transcode.
 * Parallel wie npm run visual (Job-Pool runPool aus tools/visual.js): PN_VIS_JOBS Szenen gleichzeitig (Standard wie dort,
 * min(4, Kerne/4)), rechnerweit hoechstens PN_VIS_MAX Firefox (Standard 4, gemeinsame Sperre mit visual.js); jeder Worker-Prozess hat eigenen Mock (eigene Ports) und jede Szene ein frisches
 * Firefox-Profil -> gleiche Bilder wie nacheinander. Verkleinern danach einmal ueber alle Bilder. */
'use strict';
var fs = require('fs'), path = require('path'), http = require('http'), cp = require('child_process'), os = require('os');
var ROOT = path.join(__dirname, '..');
var D = require('../tests/showcase/data.js'), ART = require('../tests/showcase/art.js');
var FIREFOX = process.env.FIREFOX || '/Applications/Firefox.app/Contents/MacOS/firefox';
var args = process.argv.slice(2);
function arg(n, def) { var i = args.indexOf(n); return i >= 0 ? args[i + 1] : def; }
var LANG = arg('--lang', 'en'), ONLY = arg('--only', null), SERVE = args.indexOf('--serve') >= 0;
var WORKER = args.indexOf('--worker') >= 0, BRAND = arg('--brand', 'public'), NOBUILD = args.indexOf('--no-build') >= 0, OPTIMIZE = args.indexOf('--no-optimize') < 0;
var SHOTDIR = BRAND === 'public' ? 'public/docs/screenshots' : 'docs/screenshots';
var OUT = path.resolve(ROOT, arg('--out', LANG === 'en' ? SHOTDIR : SHOTDIR + '/' + LANG));
ONLY = ONLY ? ONLY.split(',') : null;
var DE = LANG === 'de';

/* ---------- Hilfen ---------- */
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function clean(m) { var c = clone(m); for (var k in c) if (k.charAt(0) === '_') delete c[k]; return c; }
function page(list, q) {
  var st = Number(q.get('X-Plex-Container-Start') || 0), sz = Number(q.get('X-Plex-Container-Size') || 50);
  return { MediaContainer: { size: Math.min(sz, Math.max(0, list.length - st)), totalSize: list.length, offset: st, Metadata: list.slice(st, st + sz).map(clean) } };
}
function mc(list, extra) { var o = { MediaContainer: { size: list.length, Metadata: list.map(clean) } }; for (var k in extra || {}) o.MediaContainer[k] = extra[k]; return o; }
function firstChars(list) {
  var out = [];
  list.forEach(function (m) { var c = String(m.titleSort || m.title).charAt(0).toUpperCase(); if (!/[A-Z]/.test(c)) c = '#'; if (out.length && out[out.length - 1].title === c) out[out.length - 1].size++; else out.push({ key: c, title: c, size: 1 }); });
  return { MediaContainer: { size: out.length, Directory: out } };
}
function sortBy(list, sort) {
  list = list.slice();
  if (/^addedAt|episode.addedAt/.test(sort)) list.sort(function (a, b) { return (b.addedAt || 0) - (a.addedAt || 0); });
  else list.sort(function (a, b) { var x = String(a.titleSort || a.title).toLowerCase(), y = String(b.titleSort || b.title).toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; });
  if (/:desc/.test(sort) && !/^addedAt/.test(sort)) list.reverse();
  return list;
}
function sectionOf(m) { return Number(m.librarySectionID); }

/* Tonspuren/Untertitel fuer jedes Video (englische Bezeichnungen wie vom PMS) */
function media(m) {
  var id = Number(m.ratingKey);
  return [{ id: id, width: 1920, height: 1080, aspectRatio: 1.78, videoResolution: '1080', videoCodec: 'h264', audioCodec: 'eac3', container: 'mkv', bitrate: 9000,
    Part: [{ id: id, key: '/library/parts/' + id + '/1/file.mkv', duration: m.duration, container: 'mkv', size: 4200000000, indexes: 'sd', Stream: [
      { id: 1, streamType: 1, codec: 'h264', index: 0, displayTitle: '1080p', extendedDisplayTitle: '1080p (H.264)', bitDepth: 8, default: true },
      { id: 2, streamType: 2, codec: 'eac3', index: 1, channels: 6, audioChannelLayout: '5.1(side)', languageCode: 'eng', language: 'English', displayTitle: 'English (EAC3 5.1)', extendedDisplayTitle: 'English (EAC3 5.1)', selected: true, default: true },
      { id: 3, streamType: 2, codec: 'ac3', index: 2, channels: 6, languageCode: 'ger', language: 'Deutsch', displayTitle: 'Deutsch (AC3 5.1)', extendedDisplayTitle: 'German (Deutsch AC3 5.1)' },
      { id: 4, streamType: 2, codec: 'aac', index: 3, channels: 2, languageCode: 'spa', language: 'Español', displayTitle: 'Español (AAC Stereo)', extendedDisplayTitle: 'Spanish (Español AAC Stereo)' },
      { id: 5, streamType: 2, codec: 'aac', index: 4, channels: 2, languageCode: 'eng', language: 'English', title: 'Director\'s Commentary', displayTitle: 'English (AAC Stereo)', extendedDisplayTitle: 'Director\'s Commentary (English AAC Stereo)' },
      { id: 6, streamType: 3, codec: 'srt', index: 5, languageCode: 'eng', language: 'English', displayTitle: 'English (SRT)', extendedDisplayTitle: 'English (SRT)' },
      { id: 7, streamType: 3, codec: 'srt', index: 6, languageCode: 'eng', language: 'English', title: 'SDH', hearingImpaired: true, displayTitle: 'English SDH (SRT)', extendedDisplayTitle: 'SDH (English SRT)' },
      { id: 8, streamType: 3, codec: 'srt', index: 7, languageCode: 'ger', language: 'Deutsch', displayTitle: 'Deutsch (SRT)', extendedDisplayTitle: 'German (Deutsch SRT)' },
      { id: 9, streamType: 3, codec: 'srt', index: 8, languageCode: 'fre', language: 'Français', forced: true, title: 'Forced', displayTitle: 'Français Forced (SRT)', extendedDisplayTitle: 'Forced (Français SRT)' }] }] }];
}
var CHAP = ['Arrival', 'The Old Light', 'Storm Warning', 'Into the Dark', 'Keeping Watch', 'First Light'];
function fullMeta(rk) {
  var m = D.ITEMS[rk];
  if (!m) return null;
  var x = clean(m);
  if (x.type === 'movie' || x.type === 'episode') {
    x.Media = media(x);
    if (x.type === 'movie') {
      var step = Math.floor(x.duration / CHAP.length);
      x.Chapter = CHAP.map(function (t, i) { return { tag: t, index: i + 1, startTimeOffset: i * step, endTimeOffset: (i + 1) * step, thumb: '/library/media/' + rk + '/chapterImages/' + (i + 1) }; });
      x.Extras = { size: 2, Metadata: [{ ratingKey: '8801', type: 'clip', subtype: 'trailer', extraType: 1, title: 'Trailer', thumb: '/sc/still/x' + rk + 'a', duration: 132000 },
        { ratingKey: '8802', type: 'clip', subtype: 'behindTheScenes', extraType: 5, title: 'Behind the Scenes', thumb: '/sc/still/x' + rk + 'b', duration: 640000 }] };
      x.Related = { Hub: [{ hubIdentifier: 'movie.similar', title: 'More Like This', Metadata: D.LIB[1].filter(function (o) { return o.ratingKey !== rk; }).slice(3, 13).map(clean) }] };
    }
    x.Marker = [];
  }
  if (x.type === 'show') {
    x.Related = { Hub: [{ hubIdentifier: 'tv.similar', title: 'More Like This', Metadata: D.LIB[2].filter(function (o) { return o.ratingKey !== rk; }).slice(0, 8).map(clean) }] };
    var next = (D.CHILDREN[rk] || []).map(function (s) { return D.CHILDREN[s.ratingKey]; }).reduce(function (a, b) { return a.concat(b); }, []).filter(function (e) { return !e.viewCount; })[0];
    if (next) x.OnDeck = { Metadata: [clean(next)] };
  }
  if (x.type === 'artist') {
    var al = D.CHILDREN[rk] || [];
    x.PopularLeaves = { size: 5, Metadata: (D.CHILDREN[al[0].ratingKey] || []).slice(0, 5).map(clean) };
  }
  return { MediaContainer: { size: 1, librarySectionID: x.librarySectionID, Metadata: [x] } };
}
function allLeaves(rk) {
  var out = [];
  (D.CHILDREN[rk] || []).forEach(function (c) { out = out.concat(D.CHILDREN[c.ratingKey] || []); });
  return out;
}
function libAll(id, q) {
  var t = q.get('type'), list;
  if (id === 3 || id === 4) {
    if (t === '9') list = D.ALBUMS[id];
    else if (t === '10') { list = []; D.ALBUMS[id].forEach(function (a) { list = list.concat(D.CHILDREN[a.ratingKey]); }); if (q.get('viewOffset>')) list = list.filter(function (x) { return x.viewOffset > 0; }).sort(function (a, b) { return b.lastViewedAt - a.lastViewedAt; }); return list; }
    else list = D.LIB[id];
  } else list = D.LIB[id] || [];
  if (q.get('unwatched') === '1') list = list.filter(function (m) { return m.type === 'show' ? m.viewedLeafCount < m.leafCount : !m.viewCount; });
  if (q.get('genre')) list = list.filter(function (m, k) { return k % 2 === 0; });
  return sortBy(list, String(q.get('sort') || 'titleSort:asc'));
}
function search(query) {
  var ql = String(query || '').toLowerCase();
  function has(m) { return String(m.title).toLowerCase().indexOf(ql) >= 0; }
  var mv = D.LIB[1].filter(has).slice(0, 10), sh = D.LIB[2].filter(has).slice(0, 10), ep = [];
  Object.keys(D.ITEMS).forEach(function (k) { var m = D.ITEMS[k]; if (m.type === 'episode' && has(m) && ep.length < 8) ep.push(m); });
  var ac = D.PEOPLE.filter(function (p) { return p.toLowerCase().indexOf(ql) >= 0; }).map(function (p) { var i = D.PEOPLE.indexOf(p); return { type: 'tag', id: 900 + i, tag: p, filter: 'actor=' + (900 + i), librarySectionID: 1, thumb: '/sc/person/' + i }; });
  return { MediaContainer: { size: 4, Hub: [
    { hubIdentifier: 'movie', type: 'movie', title: 'Movies', size: mv.length, Metadata: mv.map(clean) }, { hubIdentifier: 'show', type: 'show', title: 'Shows', size: sh.length, Metadata: sh.map(clean) },
    { hubIdentifier: 'episode', type: 'episode', title: 'Episodes', size: ep.length, Metadata: ep.map(clean) }, { hubIdentifier: 'actor', type: 'actor', title: 'Actors', size: ac.length, Directory: ac }] } };
}
function sguid(type, rk) { var h = Number(rk).toString(16); return 'plex://' + type + '/' + new Array(25 - h.length).join('a') + h; }
function matchesFor(q) {
  var ql = String(q.get('title') || '').toLowerCase(), movie = q.get('agent') === 'tv.plex.agents.movie', type = movie ? 'movie' : 'show', out = [];
  (movie ? D.LIB[1] : D.LIB[2]).filter(function (m) { return m.title.toLowerCase().indexOf(ql) >= 0; }).slice(0, 3)
    .forEach(function (m) { out.push({ guid: sguid(type, m.ratingKey), name: m.title, year: m.year, type: type, thumb: m.thumb }); });
  if (movie) D.EXTERNAL.forEach(function (x, i) { if (x[0].toLowerCase().indexOf(ql) >= 0 || ql.length <= 3) out.push({ guid: sguid(type, 70000 + i), name: x[0], year: x[1], type: type, summary: 'An invented title that is not on this server.', thumb: '/sc/ext/' + i }); });
  return { MediaContainer: { size: out.length, SearchResult: ql.length >= 2 ? out : [] } };
}
function byGuid(list) {
  var want = String(list || '').split(','), out = [];
  [1, 2].forEach(function (id) { D.LIB[id].forEach(function (m) { if (want.indexOf(sguid(m.type, m.ratingKey)) >= 0) { var c = clean(m); c.guid = sguid(m.type, m.ratingKey); out.push(c); } }); });
  return mc(out);
}
function playQueue(rk) {
  var a = D.ITEMS[rk], items = [clean(a)];
  if (a && a.type === 'episode') { var sib = D.CHILDREN[a.parentRatingKey] || [], i = sib.indexOf(a); if (sib[i + 1]) items.push(clean(sib[i + 1])); }
  items.forEach(function (x, k) { x.playQueueItemID = k + 1; });
  return { MediaContainer: { playQueueID: 7, playQueueSelectedItemID: 1, Metadata: items } };
}
var DECISION = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'synthetic', 'decision-direct.json'), 'utf8'));

/* ---------- Bilder ---------- */
function artFor(url) {
  var a = D.ART[url];
  if (a) return ART.svg(a.kind, JSON.parse(JSON.stringify(a.info)));
  var m;
  if ((m = /^\/sc\/person\/(\d+)$/.exec(url))) return ART.svg('person', { seed: D.PEOPLE[Number(m[1])] || url });
  if ((m = /^(?:https:\/\/avatars\.example\.com)?\/sc\/avatar\/(\w+)$/.exec(url))) return ART.svg('avatar', { seed: m[1], shape: { alex: 'mountain', sam: 'planet', jamie: 'wave', kids: 'star' }[m[1]], palette: { alex: 'sea', sam: 'dusk', jamie: 'mint', kids: 'candy' }[m[1]] });
  if ((m = /^\/sc\/still\/x(\d+)/.exec(url))) return ART.svg('still', { theme: (D.ITEMS[m[1]] || {})._theme, seed: url });
  if ((m = /^\/library\/media\/(\d+)\/chapterImages\/(\d+)/.exec(url))) return ART.svg('chapter', { theme: (D.ITEMS[m[1]] || {})._theme, seed: url });
  if ((m = /^\/library\/parts\/(\d+)\/indexes\/sd\/(\d+)/.exec(url))) return ART.svg('chapter', { theme: (D.ITEMS[m[1]] || {})._theme || 'sea', seed: 'i' + Math.floor(Number(m[2]) / 600000) });
  if (/^\/sc\/frame/.test(url)) return ART.svg('frame', { theme: 'lighthouse', seed: '100' });
  return ART.svg('still', { seed: url });
}

/* ---------- Mock-Server ---------- */
var seeds = {}, friendPort = 0;
function startServer(cb) {
  var srv = http.createServer(function (req, res) {
    var u = new URL(req.url, 'http://x'), p = u.pathname, q = u.searchParams;
    function cors() { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', '*'); res.setHeader('Access-Control-Allow-Methods', '*'); }
    function json(o, code) { cors(); res.writeHead(code || 200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); }
    if (req.method === 'OPTIONS') { cors(); res.writeHead(200); return res.end(); }
    if (p === '/log') { cors(); res.writeHead(200); return res.end(); }
    if (p === '/sleep') return setTimeout(function () { res.writeHead(200, { 'Content-Type': 'image/gif' }); res.end(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')); }, Number(q.get('ms') || 3000));
    if (p.indexOf('/seed/') === 0) { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(seeds[p.slice(6, -3)] || ''); }
    if (p.indexOf('/img/') === 0) { cors(); res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); return res.end(artFor(decodeURIComponent(p.slice(4)))); }
    if (p === '/tv/') {
      var t = new URL(q.get('url'));
      if (t.pathname === '/api/v2/pins' && req.method === 'POST') return json({ id: 1, code: 'NEO4', expiresIn: 900 }, 201);
      if (t.pathname.indexOf('/api/v2/pins/') === 0) return json({ id: 1, authToken: null });
      return json({}, 404);
    }
    var friend = p.indexOf('/friend') === 0;          // zweiter Port: Server des Freundes ("Weitere Server")
    if (!friend && p.indexOf('/pms') !== 0) { res.writeHead(404); return res.end(); }
    p = p.slice(friend ? 7 : 4);
    if (friend && p === '/identity') return json({ MediaContainer: { machineIdentifier: D.FRIEND.machineId } });
    if (friend && p === '/library/sections') return json(DE ? D.FRIEND.sectionsDe : D.FRIEND.sections);
    if (p === '/photo/:/transcode') { cors(); res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'max-age=3600' }); return res.end(artFor(q.get('url') || '')); }
    if (p === '/library/sections') return json(DE ? D.SECTIONS_DE : D.SECTIONS);
    if (p === '/hubs/continueWatching/items') return json(mc(D.CONTINUE));
    if (p === '/library/onDeck') return json(mc(D.ONDECK));
    if (/^\/hubs\/sections\/[12]$/.test(p)) return json(q.get('count') === '20' ? { MediaContainer: { size: 2, Hub: D.INSP[p.slice(-1)].map(clean) } } : { MediaContainer: { size: 0, Hub: [] } });
    if (/^\/hubs\/sections\/\d+$/.test(p)) return json({ MediaContainer: { size: 0, Hub: [] } });
    if (p === '/hubs') return json({ MediaContainer: { size: 0, Hub: [] } });
    if (p === '/hubs/home/recentlyAdded') return json(mc(D.RECENT[q.get('sectionID')] || []));
    if (p === '/video/:/transcode/universal/decision' || p === '/music/:/transcode/universal/decision') return json(DECISION);
    if (p === '/playQueues' && req.method === 'POST') return json(playQueue(new URL(q.get('uri').replace('server://', 'http://')).pathname.split('/').pop()));
    if (p === '/playlists/all') return json(mc([]));
    var ls = /^\/library\/sections\/(\d+)\/(all|firstCharacter|collections|genre|decade|resolution|collection|prefs|year|contentRating)$/.exec(p);
    if (ls) {
      var id = Number(ls[1]);
      if (ls[2] === 'all') { var pa = page(libAll(id, q), q); pa.MediaContainer.librarySectionID = id; pa.MediaContainer.Metadata.forEach(function (m) { delete m.librarySectionID; }); return json(pa); }
      if (ls[2] === 'firstCharacter') return json(firstChars(libAll(id, q)));
      if (ls[2] === 'prefs') return json({ MediaContainer: { Setting: [{ id: 'enableTrackOffsets', value: false }] } });
      if (ls[2] === 'collections') return json(page(id === 1 ? [{ ratingKey: '7701', type: 'collection', title: 'Seaside Stories', thumb: '/sc/poster/m108', childCount: 4 }] : [], q));
      if (ls[2] === 'genre') return json({ MediaContainer: { size: 4, Directory: (id === 1 ? ['Drama', 'Adventure', 'Sci-Fi', 'Comedy'] : ['Drama', 'Sci-Fi', 'Documentary', 'Family']).map(function (g, i) { return { key: String(100 + i), title: g }; }).slice(0, q.get('type') ? 4 : 1) } });
      if (ls[2] === 'decade') return json({ MediaContainer: { size: 2, Directory: [{ key: '2020', title: '2020s' }, { key: '2010', title: '2010s' }] } });
      return json({ MediaContainer: { size: 1, Directory: [{ key: '1080', title: '1080p' }] } });
    }
    if (/^\/library\/collections\/\d+\/children$/.test(p)) return json(page(D.LIB[1].slice(8, 12), q));
    if (p === '/hubs/search') return json(search(q.get('query')));
    if (/^\/library\/metadata\/\d+\/matches$/.test(p)) return setTimeout(function () { json(matchesFor(q)); }, 300);
    if (p === '/library/all' && q.get('guid')) return json(byGuid(q.get('guid')));
    var lm = /^\/library\/metadata\/(\d+)(\/children|\/allLeaves|\/related)?$/.exec(p);
    if (lm) {
      if (lm[2] === '/related') {                       // Kuenstlerseite: weitere Veroeffentlichungen als Hubs artist.albums.* (wie PMS)
        var rel = D.RELATED[lm[1]] || {};
        return json({ MediaContainer: { size: 6, Hub: ['singles', 'live', 'soundtrack', 'compilation', 'demo', 'remix'].map(function (h) {
          var l = (rel[h] || []).map(clean); return { hubIdentifier: 'artist.albums.' + h, type: 'album', size: l.length, Metadata: l }; }) } });
      }
      if (lm[2] === '/children') return json(page(D.CHILDREN[lm[1]] || [], q));
      if (lm[2] === '/allLeaves') return json(page(allLeaves(lm[1]), q));
      var fm = fullMeta(lm[1]);
      if (fm) return json(fm);
    }
    if (/^\/(:\/|actions)/.test(p)) return json({});
    return json({ MediaContainer: { size: 0 } });
  });
  var fsrv = http.createServer(function (req, res) { req.url = '/friend' + req.url; srv.emit('request', req, res); });
  srv.on('close', function () { fsrv.close(); });
  fsrv.listen(0, '127.0.0.1', function () {
    friendPort = fsrv.address().port;
    srv.listen(Number(process.env.PORT || 0), '127.0.0.1', function () { cb(srv, srv.address().port); });
  });
}

/* ---------- Seeds (Zustand wie nach der Einrichtung) ---------- */
function makeSeeds(port) {
  var base = 'http://127.0.0.1:' + port;
  var users = [{ id: 11, uuid: 'aaaa1111', name: 'Alex', thumb: '/sc/avatar/alex', admin: true, restricted: false, pin: true, kind: 'main' },
    { id: 12, uuid: 'bbbb2222', name: 'Sam', thumb: '/sc/avatar/sam', admin: false, restricted: false, pin: true, kind: '' },
    { id: 13, uuid: 'cccc3333', name: 'Jamie', thumb: '/sc/avatar/jamie', admin: false, restricted: true, pin: false, kind: 'teen' },
    { id: 14, uuid: 'dddd4444', name: 'Kids', thumb: '/sc/avatar/kids', admin: false, restricted: true, pin: false, kind: 'kid' }];
  function st(o) {
    var s = { v: 1, clientId: 'showcase', account: { token: 'ACC', uuid: 'aaaa1111', name: 'Alex' }, server: { uri: base + '/pms', machineId: 'mid', name: 'Living Room', token: 'T' },
      users: users, usersTs: Date.now(), profiles: { aaaa1111: { serverToken: 'T' }, bbbb2222: { serverToken: 'T' }, cccc3333: { serverToken: 'T' }, dddd4444: { serverToken: 'T' } },
      lastProfile: 'aaaa1111', lang: LANG, pinSwitch: false, protectRemindAt: 4102444800000, firstPicker: false, pointer: true };
    for (var k in o || {}) s[k] = o[k];
    return s;
  }
  var cfg = { readOnly: true, proxyHost: '127.0.0.1:' + port + '/tv', cursor: 'system', fixedClock: '20:15', welcome: false, sefFake: 'still', seekDelay: 600000 };
  // Player: statt der grauen Vorschau-Flaeche ein generiertes Videobild (nur Vorschau-Element .pl-vbg)
  var css = 'window.addEventListener("DOMContentLoaded",function(){var s=document.createElement("style");s.textContent=".pl-vbg{background:#000 url(' + base + '/img/sc/frame) center/cover no-repeat !important}";document.head.appendChild(s);});';
  // feste Uhrzeit 20:15 (Uhr, "Endet um" und Zeitangaben passen zusammen): Date um einen festen Versatz verschieben
  var clock = '(function(){var R=Date,t=new R();t.setHours(20,15,0,0);var off=t.getTime()-R.now();function F(){if(!arguments.length)return new R(R.now()+off);' +
    'return new (Function.prototype.bind.apply(R,[null].concat([].slice.call(arguments))))();}F.prototype=R.prototype;F.now=function(){return R.now()+off;};F.UTC=R.UTC;F.parse=R.parse;window.Date=F;})();';
  function seed(o, extra) {
    var files = { 'state.json': JSON.stringify(st(o)), 'config.json': JSON.stringify(cfg) };
    for (var k in extra || {}) files[k] = JSON.stringify(extra[k]);
    return clock + 'window.PN_SEED=' + JSON.stringify(files) + ';' + css;
  }
  // englische Oberflaeche: auch Ton/Untertitel bevorzugt Englisch (Standard der App ist Deutsch, unabhaengig von der Menuesprache)
  var prefs = DE ? null : { 'settings-aaaa1111.json': { audioLang: 'en', subLang: 'en' } };
  function withPrefs(o) { var x = {}, k, p0 = prefs ? prefs['settings-aaaa1111.json'] : {}; for (k in p0) x[k] = p0[k]; for (k in o) x[k] = o[k]; return { 'settings-aaaa1111.json': x }; }
  seeds.home = seed({ startProfile: 'main' }, prefs);
  seeds.profiles = seed({ startProfile: 'picker' });
  // Akzentfarbe (Einstellungen > Oberflaeche): Profil mit eigener Farbe (state.accent = Startbild ohne Farbsprung)
  seeds.coral = seed({ startProfile: 'main', accent: 'coral' }, withPrefs({ accent: 'coral' }));
  // Bildschirmschoner: nach 1,5 s statt Minuten (config.saverMs, nur Vorschau), Bilder aus der Filmbibliothek, Einblendung "Ambient"
  cfg.saverMs = 1500;
  seeds.saver = seed({ startProfile: 'main' }, withPrefs({ saverInfo: 'ambient', saverLibs: [1], saverFx: 'cut' }));
  delete cfg.saverMs;
  // Weitere Server: wie ein Paket mit setup.json; Alex hat Zugang zum Server "Lakeside" eines Freundes (zweiter Mock-Port)
  function av(n) { return 'https://avatars.example.com/sc/avatar/' + n; }
  var setup = { schema: 1, serversSchema: 1, kind: 'plexneo-setup', createdAt: '2026-10-26T12:00:00Z', setupVersion: '0.1.0', clientIdentifier: 'showcase',
    server: { machineIdentifier: 'showcase-home-0001', name: 'Living Room', uris: [base + '/pms'] }, computer: null,
    profiles: [{ id: 11, uuid: 'aaaa1111', title: 'Alex', thumb: av('alex'), kind: 'owner', restricted: false, restrictionProfile: '', token: 'showcase-token',
      servers: [{ machineIdentifier: D.FRIEND.machineId, name: D.FRIEND.name, uris: ['http://127.0.0.1:' + friendPort], token: 'showcase-token' }] },
      { id: 12, uuid: 'bbbb2222', title: 'Sam', thumb: av('sam'), kind: 'home', restricted: false, restrictionProfile: '', token: 'showcase-token' },
      { id: 13, uuid: 'cccc3333', title: 'Jamie', thumb: av('jamie'), kind: 'home', restricted: true, restrictionProfile: 'teen', token: 'showcase-token' },
      { id: 14, uuid: 'dddd4444', title: 'Kids', thumb: av('kids'), kind: 'home', restricted: true, restrictionProfile: 'little_kid', token: 'showcase-token' }] };
  seeds.servers = seed({ account: null, server: null, users: null, profiles: {}, startProfile: 'main' }, prefs) + 'window.PN_SETUP=' + JSON.stringify(JSON.stringify(setup)) + ';';
}

/* ---------- Szenen ---------- */
var RAIL = 'LEFT';
function down(n) { var a = []; for (var i = 0; i < n; i++) a.push('DOWN'); return a.join(','); }
var SCENES = [
  { name: 'profiles', seed: 'profiles' },
  { name: 'home', seed: 'home' },
  { name: 'sidebar', seed: 'servers', keys: 'wait3000,LEFT,DOWN,DOWN,DOWN,DOWN,DOWN' },   // mit Weitere Server: Bibliothek eines Freundes
  { name: 'library', seed: 'home', keys: 'LEFT,DOWN,ENTER,wait900,RIGHT,RIGHT,RIGHT' },                                   // Farbstimmung des Titels
  { name: 'details', seed: 'home', keys: 'INFO,wait1200' },
  { name: 'series', seed: 'home', keys: 'LEFT,DOWN,DOWN,ENTER,wait900,RIGHT,RIGHT,RIGHT,RIGHT,ENTER,wait1200,DOWN,DOWN' },
  { name: 'search', seed: 'home', keys: 'BLUE,wait600,DOWN,DOWN,ENTER,RIGHT,RIGHT,ENTER,ENTER,LEFT,ENTER,wait1500' },   // "moon"
  { name: 'discover', seed: 'home', keys: 'LEFT,UP,ENTER,wait1500' },
  { name: 'player', seed: 'home', keys: 'ENTER,ENTER,wait900,PAUSE' },
  { name: 'tracks', seed: 'home', keys: 'ENTER,ENTER,wait900,GREEN' },
  { name: 'settings', seed: 'home', keys: 'LEFT,' + down(8) + ',ENTER,DOWN,DOWN,DOWN,RIGHT' },
  { name: 'music', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,ENTER,wait900,UP,RIGHT,ENTER,wait1200,DOWN,RIGHT' },              // Alben
  { name: 'artist', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,ENTER,wait900,RIGHT,RIGHT,RIGHT,RIGHT,ENTER,wait1500,DOWN,DOWN' },   // Kuenstlerin mit Gruppen
  { name: 'accent', seed: 'coral', keys: 'LEFT,' + down(8) + ',ENTER,DOWN,DOWN,DOWN,RIGHT,' + down(5) + ',ENTER' },                // Akzentfarbe: Auswahl
  { name: 'screensaver', seed: 'saver', keys: 'wait6000' },                                                                    // Einblendung Ambient
  { name: 'audiobooks', seed: 'home', keys: 'LEFT,DOWN,DOWN,DOWN,DOWN,ENTER,wait900,RIGHT,ENTER,wait1200,DOWN' }               // Buch mit Kapiteln
];

var running = null;                                  // laufender Firefox (der Worker beendet ihn beim Abbruch)
function shot(port, sc, done) {
  var prof = fs.mkdtempSync(path.join(os.tmpdir(), 'pnshow-'));
  var keys = sc.keys ? '&keys=' + sc.keys + '&wait=2000' : '';
  var hold = 4500 + (sc.keys ? sc.keys.split(',').reduce(function (n, k) { return n + (/^wait/.test(k) ? Number(k.slice(4)) : 400); }, 0) + 2200 : 0);
  var url = 'file://' + path.join(ROOT, 'tools', 'preview.html') + '?clear=1&min=1&seed=' + encodeURIComponent('http://127.0.0.1:' + port + '/seed/' + sc.seed + '.js') +
    '&hold=' + hold + '&holdurl=' + encodeURIComponent('http://127.0.0.1:' + port + '/sleep') + keys;
  var out = path.join(OUT, sc.name + '.png');
  try { fs.unlinkSync(out); } catch (e) {}
  running = cp.execFile(FIREFOX, ['--headless', '-no-remote', '-profile', prof, '--window-size=1280,720', '--screenshot', out, url], { timeout: 90000 }, function () {
    running = null;
    try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) {}
    done(fs.existsSync(out));
  });
}

/* PNGs verkleinern: pngquant (Palette mit 256 Farben, Qualitaet 85-98 – an Verlaeufen/Unschaerfe nicht sichtbar, ~70 % kleiner;
 * schafft es die Qualitaet nicht, bleibt die Datei unveraendert) und danach oxipng (verlustfrei). Fehlt ein Werkzeug: Hinweis. */
function have(tool) { var r = cp.spawnSync(tool, ['--version'], { stdio: 'ignore' }); return !r.error; }
function optimize(files) {
  if (!OPTIMIZE || !files.length) return;
  var before = files.reduce(function (n, f) { return n + fs.statSync(f).size; }, 0);
  if (have('pngquant')) cp.spawnSync('pngquant', ['--quality', '85-98', '--speed', '1', '--strip', '--force', '--ext', '.png'].concat(files), { stdio: 'inherit' });
  else console.log('Hinweis: pngquant fehlt – Bilder bleiben gross (brew install pngquant)');
  if (have('oxipng')) cp.spawnSync('oxipng', ['-o', '4', '--strip', 'safe', '-q'].concat(files), { stdio: 'inherit' });
  var after = files.reduce(function (n, f) { return n + fs.statSync(f).size; }, 0);
  console.log('verkleinert: ' + Math.round(before / 1024) + ' KB -> ' + Math.round(after / 1024) + ' KB');
}

/* Worker-Prozess (Job-Pool aus tools/visual.js): eigener Mock-Server (Seeds mit seinem Port), eine Szene nach der anderen */
function worker() {
  startServer(function (srv, port) {
    makeSeeds(port);
    process.on('message', function (m) {
      var sc = SCENES.filter(function (s) { return s.name === m.name; })[0];
      if (!sc) return process.send({ i: m.i, ok: false });
      shot(port, sc, function (ok) { process.send({ i: m.i, ok: ok }); });
    });
    process.on('disconnect', function () { if (running) try { running.kill('SIGKILL'); } catch (e) {} srv.close(); process.exit(0); });
    process.send({ ready: true });
  });
}

function main() {
  if (WORKER) return worker();
  if (!NOBUILD && !SERVE) {                      // Release-Build mit der gewaehlten Marke (Name, Wortmarke, Texte)
    var r = cp.spawnSync(process.execPath, [path.join(ROOT, 'tools', 'build.js'), '--brand', BRAND, '--no-test'], { stdio: 'inherit' });
    if (r.status !== 0) process.exit(1);
  }
  if (!fs.existsSync(path.join(ROOT, 'app', 'app.min.js'))) { console.error('app/app.min.js fehlt – zuerst "npm run build".'); process.exit(1); }
  if (SERVE) return startServer(function (srv, port) {
    makeSeeds(port);
    console.log('Mock auf Port ' + port + '. Vorschau: file://' + path.join(ROOT, 'tools', 'preview.html') + '?clear=1&min=1&seed=' + encodeURIComponent('http://127.0.0.1:' + port + '/seed/home.js'));
  });
  if (!fs.existsSync(FIREFOX)) { console.error('Firefox nicht gefunden (' + FIREFOX + '), FIREFOX=… setzen.'); process.exit(2); }
  fs.mkdirSync(OUT, { recursive: true });
  var V = require('./visual.js');
  var scenes = SCENES.filter(function (s) { return !ONLY || ONLY.indexOf(s.name) >= 0; });
  if (!scenes.length) { console.error('Keine Szene passt zu --only ' + ONLY.join(',') + '.'); process.exit(2); }
  var jobs = Math.min(V.JOBS, scenes.length), t0 = Date.now(), W = String(scenes.length).length;
  console.log(scenes.length + ' Szene(n) · ' + jobs + ' parallel (PN_VIS_JOBS)' + (V.MAX_TOTAL > 0 ? ' · rechnerweit hoechstens ' + V.MAX_TOTAL + ' Firefox (PN_VIS_MAX)' : ''));
  process.on('SIGINT', function () { process.exit(130); });
  process.on('SIGTERM', function () { process.exit(143); });
  V.runPool({ script: __filename, args: args.filter(function (a) { return a !== '--worker'; }), jobs: jobs, names: scenes.map(function (s) { return s.name; }),
    onResult: function (m, n, secs) { console.log('[' + ('    ' + n).slice(-W) + '/' + scenes.length + '] ' + scenes[m.i].name + ' ' + (m.ok ? 'ok' : 'FEHLT') + ' (' + secs.toFixed(1) + ' s)'); },
    done: function (rs) {
      var ok = scenes.filter(function (s, i) { return rs[i].ok; }), bad = scenes.length - ok.length;
      console.log('Gerendert in ' + Math.round((Date.now() - t0) / 1000) + ' s.');
      optimize(ok.map(function (s) { return path.join(OUT, s.name + '.png'); }));           // einmal ueber alle Bilder, feste Reihenfolge
      console.log(ok.length + ' Bilder in ' + path.relative(ROOT, OUT) + '/' + (bad ? ', ' + bad + ' fehlgeschlagen' : ''));
      process.exit(bad ? 1 : 0);
    } });
}
if (require.main === module) main();
module.exports = { startServer: startServer, makeSeeds: makeSeeds, SCENES: SCENES };
