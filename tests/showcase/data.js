'use strict';
/* Showcase-Datensatz fuer die oeffentlichen Screenshots (tools/showcase.js).
 * Alles erfunden: Titel, Personen, Kuenstler, Autoren, Profile. Keine Medien des echten Servers, keine echten Namen.
 * Bilder: Pfade /sc/<art>/<key> – der Mock rendert sie mit tests/showcase/art.js (SVG). */

var T0 = 1760000000;   // addedAt-Basis

/* ---------- Filme (Bibliothek 1) ---------- */
// [Titel, Jahr, Thema, Genre, Bewertung, Freigabe, Minuten, Kurzbeschreibung]
var MOVIES = [
  ['The Keeper of Wren Point', 2024, 'lighthouse', 'Drama', 8.4, 'PG-13', 118, 'When the last automated beacon on the northern coast fails, a retired keeper and her estranged granddaughter spend one stormy winter keeping the light alive – and uncovering what the sea took from their family.'],
  ['Northern Static', 2023, 'static', 'Sci-Fi', 7.6, 'PG-13', 104, 'A late-night radio host starts receiving calls from listeners who claim to live thirty years in the future.'],
  ['Moons of Paper Street', 2022, 'moon', 'Comedy', 7.1, 'PG', 96, 'Two rival origami artists are forced to share a tiny studio in the week before the city lantern festival.'],
  ['The Glass Orchard', 2024, 'orchard', 'Drama', 7.9, 'PG', 112, 'Three siblings return to their late father\'s orchard and find a greenhouse full of letters he never sent.'],
  ['Kestrel Run', 2021, 'bird', 'Adventure', 7.3, 'PG', 101, 'A young falconer races across the highlands to return an injured kestrel before the first snow.'],
  ['The Clockmaker\'s Winter', 2020, 'clock', 'Fantasy', 7.8, 'PG', 109, 'In a town where every clock has stopped, an apprentice discovers why time refuses to move on.'],
  ['Copperline Motel', 2023, 'motel', 'Thriller', 6.9, 'R', 98, 'Eleven guests, one broken neon sign and a night clerk who knows far more than she lets on.'],
  ['A Map of Quiet Places', 2022, 'map', 'Documentary', 8.1, 'G', 88, 'A cartographer sets out to chart the last places on Earth without human noise.'],
  ['Saltwater Hymn', 2019, 'sea', 'Romance', 7.0, 'PG-13', 107, 'A choir director and a fisherman find common ground in a village that sings to the tide.'],
  ['Ember Road', 2024, 'fire', 'Action', 7.2, 'R', 116, 'A wildfire crew has twelve hours to clear the only road out of a valley.'],
  ['Hollow Pines', 2021, 'forest', 'Mystery', 7.4, 'PG-13', 102, 'A park ranger investigates footprints that lead into the forest – and never come back out.'],
  ['The Cartographer\'s Error', 2018, 'map', 'Adventure', 7.0, 'PG', 111, 'One misdrawn island sends an expedition on a voyage nobody planned.'],
  ['Signal at Dawn', 2025, 'space', 'Sci-Fi', 8.0, 'PG-13', 121, 'An observatory crew decodes a message that seems to answer a question nobody asked.'],
  ['Small Hours on Delmar Street', 2020, 'city', 'Drama', 7.5, 'PG-13', 99, 'One night, five apartments, and the neighbours who finally knock on each other\'s doors.'],
  ['The Fifth Lantern', 2023, 'night', 'Fantasy', 7.7, 'PG', 105, 'A lantern lighter\'s daughter follows a light that appears on no map of the old town.'],
  ['Orbit of Strangers', 2022, 'space', 'Sci-Fi', 6.8, 'PG-13', 113, 'Seven passengers wake up on a shuttle with no pilot and no memory of boarding.'],
  ['Midnight at the Marigold', 2019, 'city', 'Comedy', 7.1, 'PG-13', 94, 'A failing jazz club gets one last chance when a mysterious pianist walks in.'],
  ['Driftwood Crown', 2024, 'sea', 'Family', 7.3, 'G', 92, 'Two kids build a kingdom out of driftwood – and have to defend it against the autumn storms.'],
  ['Under the Amber Bridge', 2021, 'bridge', 'Romance', 7.2, 'PG-13', 103, 'Every evening at seven, two strangers cross the same bridge in opposite directions.'],
  ['Starlight Freight', 2023, 'train', 'Adventure', 7.6, 'PG', 110, 'A night train carrying a mysterious cargo crosses the continent in a single legendary run.'],
  ['The Quiet Mechanic', 2020, 'rain', 'Thriller', 7.0, 'R', 100, 'A mechanic with a talent for silence is hired to fix a car that should not exist.'],
  ['Three Days of Fog', 2018, 'fog', 'Mystery', 6.7, 'PG-13', 97, 'A ferry is stranded in fog for three days – and someone on board does not want it to clear.'],
  ['Nine Paper Kites', 2022, 'kids', 'Family', 7.9, 'G', 90, 'A grandfather and his granddaughter enter the windiest kite contest on the coast.'],
  ['Wolfmoon Diner', 2021, 'moon', 'Comedy', 6.9, 'PG-13', 95, 'The night shift at a highway diner gets very strange when the full moon rises.'],
  ['The Ninth Archive', 2025, 'clock', 'Thriller', 7.4, 'PG-13', 119, 'A librarian finds a sealed room whose catalogue lists books that have not been written yet.'],
  ['Sunline', 2019, 'sun', 'Drama', 7.3, 'PG', 108, 'A solar-car team from a small college attempts to cross the desert in four days.'],
  ['Dunes of Halveth', 2024, 'desert', 'Adventure', 7.5, 'PG-13', 125, 'A caravan guide must lead a stubborn scholar to a city that moves with the sand.'],
  ['Garden of Second Chances', 2023, 'garden', 'Romance', 7.0, 'PG', 101, 'A florist and a retired botanist bring an abandoned community garden back to life.'],
  ['Riverlight', 2020, 'river', 'Drama', 7.6, 'PG', 106, 'A family runs the last ferry crossing on a river that is about to get its first bridge.'],
  ['Snowline Express', 2022, 'snow', 'Family', 7.2, 'G', 93, 'A mountain railway, a lost dog and the snowiest Christmas Eve in fifty years.']
];
var PEOPLE = ['Ada Marlowe', 'Theo Brannigan', 'Iris Calloway', 'Jonah Vantreese', 'Lena Okonkwo-Hart', 'Rafael Quintero', 'Mei Lindqvist', 'Oskar Halloway',
  'Priya Ravensworth', 'Elliot Faircloud', 'Noor Castellane', 'Marcus Delacourt', 'Hana Westerby', 'Silas Montrose', 'Clara Ashdown', 'Felix Okabe'];
var DIRECTORS = ['Rosalind Achterberg', 'Tomas Wilkerby', 'Yara Delmonte', 'Gideon Fairweather', 'Sunniva Holt', 'Ansel Brookmere'];
var STUDIOS = ['Lanternfish Pictures', 'Northwind Studios', 'Paper Crane Films', 'Bluehour Productions'];

/* ---------- Serien (Bibliothek 2) ---------- */
// [Titel, Jahr, Thema, Genre, Freigabe, Staffeln, Folgen je Staffel, Beschreibung, Folgentitel...]
var SHOWS = [
  ['Merrow Harbor', 2022, 'lighthouse', 'Crime', 'TV-14', 3, 8, 'A small harbour town, a new police chief from the city and a lighthouse that keeps switching itself on at night.',
    ['The New Chief', 'Low Tide', 'Anchors', 'The Night Ferry', 'Fog Warning', 'Salt and Rust', 'Breakwater', 'Lights Out']],
  ['Atlas of Small Things', 2023, 'map', 'Documentary', 'TV-G', 2, 8, 'A gentle documentary series about the tiny worlds hiding in plain sight – moss forests, puddle oceans and teacup storms.',
    ['Moss Forests', 'Puddle Oceans', 'The Ant Highway', 'Teacup Storms', 'Seeds on the Wind', 'Night Shift', 'Frost Ferns', 'Small Giants']],
  ['Static Bloom', 2024, 'static', 'Sci-Fi', 'TV-14', 2, 8, 'After a solar storm, a city wakes up to find every screen showing the same flower – and it is growing.',
    ['First Light', 'Petals', 'Interference', 'The Gardener', 'Pollen', 'Broadcast', 'Root System', 'Full Bloom']],
  ['Lantern Bay', 2021, 'sea', 'Drama', 'TV-PG', 4, 10, 'Three generations run a seaside inn that has never once closed its doors.',
    ['Welcome Back', 'The Long Table', 'Storm Season', 'Old Friends', 'The Inn Book', 'Tidewater', 'A Room for the Night', 'Shoreline', 'Regulars', 'Last Call']],
  ['Moonpaper Academy', 2023, 'kids', 'Animation', 'TV-Y7', 2, 10, 'At a school for young paper-folders, every crane can fly – if you fold it with the right wish.',
    ['First Fold', 'The Crane Race', 'Paper Dragons', 'Rainy Day', 'The Library Kite', 'Folding Night', 'Lost Star', 'The Big Exam', 'Winter Paper', 'Moon Festival']],
  ['Vela Station', 2022, 'space', 'Sci-Fi', 'TV-14', 3, 8, 'Night shift on a research station at the edge of the solar system – where the quiet is the dangerous part.',
    ['Handover', 'Dead Air', 'Docking', 'Ice Core', 'Relay', 'The Visitor', 'Blackout', 'Dawn Shift']],
  ['The Weatherwatchers', 2020, 'rain', 'Comedy', 'TV-PG', 3, 8, 'The most unreliable weather team in the country tries to predict a once-in-a-century storm.',
    ['Partly Cloudy', 'High Pressure', 'Cold Front', 'Hail Mary', 'Drizzle', 'Heatwave', 'Forecast', 'The Big One']],
  ['Rookery Lane', 2019, 'city', 'Drama', 'TV-14', 2, 8, 'Neighbours, secrets and one very nosy crow on the quietest street in town.',
    ['Moving Day', 'The Hedge', 'Block Party', 'Lost and Found', 'The Crow', 'Fences', 'Open House', 'Rookery']],
  ['Driftline', 2024, 'river', 'Thriller', 'TV-MA', 1, 8, 'A river pilot finds a boat drifting with its engine running and nobody on board.',
    ['Current', 'Upstream', 'The Lock', 'Silt', 'Bends', 'Undertow', 'The Weir', 'Estuary']],
  ['The Inventors\' Guild', 2021, 'clock', 'Family', 'TV-G', 2, 8, 'Four kids, one workshop and an inventions fair that will decide the future of their town.',
    ['Spare Parts', 'Gears', 'The Blueprint', 'Sparks', 'Test Run', 'Rivals', 'The Fair', 'Patent Pending']],
  ['Saltmarsh', 2023, 'fog', 'Mystery', 'TV-14', 1, 8, 'A birdwatcher on a lonely marsh records a sound that no bird should make.',
    ['Reeds', 'The Hide', 'Mudflats', 'Low Water', 'Nightjar', 'Mist', 'The Recording', 'High Tide']],
  ['Small Plot Heroes', 2022, 'garden', 'Reality', 'TV-G', 3, 8, 'Amateur gardeners transform tiny city plots in a single weekend.',
    ['Balcony Jungle', 'Rooftop Roses', 'The Shed', 'Vertical Veg', 'Pond Life', 'Wildflowers', 'Night Garden', 'Grand Final']]
];

/* ---------- Musik (Bibliothek 3) ---------- */
var ARTISTS = [
  ['Velvet Kites', 'Dream Pop', ['Glasshouse Weather', 'Slow Satellites']], ['Mira Solano', 'Singer-Songwriter', ['Paper Rivers', 'Kitchen Light']],
  ['Northbound Echo', 'Indie Rock', ['Cold Harbour', 'Wires & Wildflowers']], ['The Copper Sparrows', 'Folk', ['Hedgerow Songs', 'Hedgerow Hymns']],
  ['Juno Halloway', 'Jazz', ['Blue Room Sessions', 'Late Lamp Lounge']], ['Lowlight District', 'Electronic', ['Neon Rain', 'Night Transit']],
  ['Amber Hollow', 'Americana', ['Dust & Daylight', 'Porchlight Psalms']], ['Cosmo Drift', 'Synthwave', ['Orbit Café', 'Starfield Drive']],
  ['Saffron Tide', 'Soul', ['Honey Hour', 'Sweet Static']], ['Glasshouse Choir', 'Classical', ['Winter Canticles', 'Quiet Rooms']],
  ['Pale Harbour', 'Ambient', ['Tidal Hours', 'Seafog']], ['The Midweek Owls', 'Indie Pop', ['Tuesday Lights', 'Bicycle Weather']]
];
var SONGS = ['Opening Hours', 'Weather Vane', 'Little Lighthouse', 'Northern Lines', 'Paper Planes at Night', 'Glass Ceiling Sky', 'Slow Dance in the Kitchen',
  'Static Hearts', 'Coastline', 'The Long Way Home', 'Lamps on the Water', 'Late Train', 'Copper Moon', 'Sunday Satellites', 'Fold Me a Star', 'Last Ferry'];

/* ---------- Hoerbuecher (Bibliothek 4) ---------- */
var AUTHORS = [
  ['Eleanor Whitlock', [['The House on Wren Hill', 'lighthouse'], ['A Season of Small Fires', 'fire']]],
  ['Tobias Renwick', [['The Salt Road Letters', 'desert'], ['Clockwork Harvest', 'clock']]],
  ['Marguerite Vance', [['The Long Quiet', 'snow']]],
  ['Dev Anand Castellan', [['Notes from the Edge of the Map', 'map'], ['The Orchard Keeper\'s Almanac', 'orchard']]],
  ['Hollis Grey', [['Starlight & Sawdust', 'space']]]
];
var CHAPTERS = ['Prologue', 'The Letter', 'Arrival', 'The Old House', 'A Door in the Garden', 'Lamplight', 'What the River Said', 'The Visitor', 'Winter Comes',
  'The Map Room', 'Crossing', 'Small Hours', 'The Bell', 'Homecoming', 'Epilogue'];

var EPSUM = ['Old secrets surface when a storm cuts the town off for a night.', 'An unexpected guest arrives with a warning nobody wants to hear.',
  'Everyone has a different story about what happened at the pier – and none of them add up.', 'A small mistake at work snowballs into the longest day of the year.',
  'An old friendship is put to the test when a long-lost letter turns up.', 'A power cut brings the whole street together, whether they like it or not.',
  'A visitor from the city asks too many questions about the old map.', 'The team has one night to fix what went wrong – and the clock is ticking.',
  'A birthday surprise goes sideways in the most spectacular way.', 'Two rivals are forced to work together after an accident on the coast road.'];

/* ---------- Aufbau ---------- */
function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
var ITEMS = {}, CHILDREN = {}, ART = {}, LIB = { 1: [], 2: [], 3: [], 4: [] }, ALBUMS = { 3: [], 4: [] };
function art(path, kind, info) { ART[path] = { kind: kind, info: info }; return path; }

MOVIES.forEach(function (m, i) {
  var rk = String(100 + i), roles = [];
  for (var k = 0; k < 8; k++) roles.push({ id: 900 + (i * 3 + k) % PEOPLE.length, tag: PEOPLE[(i * 3 + k) % PEOPLE.length], role: ['Mara', 'Captain Reyes', 'Tom Ashby', 'Dr. Ilse Varn', 'June', 'The Stranger', 'Ollie', 'Narrator'][k], thumb: art('/sc/person/' + ((i * 3 + k) % PEOPLE.length), 'person', { seed: PEOPLE[(i * 3 + k) % PEOPLE.length] }) });
  var it = { ratingKey: rk, key: '/library/metadata/' + rk, type: 'movie', title: m[0], titleSort: m[0].replace(/^(The|A) /, ''), year: m[1], librarySectionID: 1, librarySectionTitle: 'Movies',
    thumb: art('/sc/poster/m' + rk, 'poster', { title: m[0], theme: m[2], seed: rk, credit: 'DIRECTED BY ' + DIRECTORS[i % DIRECTORS.length].toUpperCase() }),
    art: art('/sc/art/m' + rk, 'backdrop', { theme: m[2], seed: rk }), duration: m[6] * 60000, audienceRating: m[4], contentRating: m[5], summary: m[7],
    tagline: '', studio: STUDIOS[i % STUDIOS.length], addedAt: T0 + (30 - i) * 86400, originallyAvailableAt: m[1] + '-0' + (1 + i % 9) + '-1' + (i % 9),
    viewCount: i % 4 === 3 ? 1 : 0, Genre: [{ id: 100 + i % 7, tag: m[3] }], Director: [{ id: 70 + i % DIRECTORS.length, tag: DIRECTORS[i % DIRECTORS.length] }], Role: roles,
    _theme: m[2] };
  ITEMS[rk] = it; LIB[1].push(it);
});

SHOWS.forEach(function (s, i) {
  var rk = String(300 + i * 10), seasons = [], leaf = 0, vleaf = 0;
  var show = { ratingKey: rk, key: '/library/metadata/' + rk + '/children', type: 'show', title: s[0], titleSort: s[0].replace(/^(The) /, ''), year: s[1], librarySectionID: 2, librarySectionTitle: 'TV Shows',
    thumb: art('/sc/poster/s' + rk, 'poster', { title: s[0], theme: s[2], seed: rk, sub: 'A new series', credit: 'NEW EPISODES EVERY FRIDAY' }), art: art('/sc/art/s' + rk, 'backdrop', { theme: s[2], seed: rk }),
    contentRating: s[4], audienceRating: (7 + (i * 37 % 20) / 10), summary: s[7], childCount: s[5], studio: STUDIOS[(i + 1) % STUDIOS.length], addedAt: T0 + (20 - i) * 86400,
    Genre: [{ id: 200 + i % 5, tag: s[3] }], Role: [], _theme: s[2] };
  for (var k = 0; k < 8; k++) show.Role.push({ id: 900 + (i * 5 + k) % PEOPLE.length, tag: PEOPLE[(i * 5 + k) % PEOPLE.length], role: ['Chief Nora Vale', 'Ben Harlow', 'Edie', 'Captain Moss', 'Rosa', 'Kit', 'Father Abel', 'Narrator'][k], thumb: '/sc/person/' + ((i * 5 + k) % PEOPLE.length) });
  for (var sn = 1; sn <= s[5]; sn++) {
    var srk = String(Number(rk) + sn), eps = [];
    for (var e = 1; e <= s[6]; e++) {
      var erk = String(Number(rk) * 100 + sn * 20 + e), watched = sn < s[5] - 0 && (sn === 1 || i % 3 === 0) ? 1 : 0;
      if (i === 0) watched = sn === 1 || (sn === 2 && e < 4) ? 1 : 0;          // Harbor Lights: S2E4 angefangen
      var ep = { ratingKey: erk, key: '/library/metadata/' + erk, type: 'episode', title: s[8][(e - 1 + (sn - 1) * 3) % s[8].length] + (sn > 1 ? '' : ''), index: e, parentIndex: sn,
        parentRatingKey: srk, grandparentRatingKey: rk, grandparentTitle: s[0], parentTitle: 'Season ' + sn, librarySectionID: 2, librarySectionTitle: 'TV Shows', contentRating: s[4],
        summary: EPSUM[(e * 3 + sn * 5 + i) % EPSUM.length],
        thumb: art('/sc/still/' + erk, 'still', { theme: s[2], seed: erk }), grandparentThumb: show.thumb, grandparentArt: show.art, art: show.art,
        duration: (s[3] === 'Animation' ? 22 : 44) * 60000 + e * 30000, year: s[1] + sn - 1, originallyAvailableAt: (s[1] + sn - 1) + '-0' + (1 + e % 9) + '-1' + (e % 9),
        addedAt: T0 + (sn * 20 + e) * 3600 + i * 7, viewCount: watched };
      if (i === 0 && sn === 2 && e === 4) ep.viewOffset = 1500000;
      ITEMS[erk] = ep; eps.push(ep); leaf++; vleaf += watched;
    }
    var season = { ratingKey: srk, key: '/library/metadata/' + srk + '/children', type: 'season', title: 'Season ' + sn, index: sn, parentRatingKey: rk, parentTitle: s[0],
      thumb: show.thumb, parentThumb: show.thumb, art: show.art, librarySectionID: 2, leafCount: eps.length, viewedLeafCount: eps.filter(function (x) { return x.viewCount; }).length };
    ITEMS[srk] = season; CHILDREN[srk] = eps; seasons.push(season);
  }
  show.leafCount = leaf; show.viewedLeafCount = vleaf;
  ITEMS[rk] = show; CHILDREN[rk] = seasons; LIB[2].push(show);
});

function audioLib(sec, list, isBook) {
  var aIdx = 0;
  list.forEach(function (a, i) {
    var rk = String((isBook ? 650 : 600) + i), name = a[0];
    var artist = { ratingKey: rk, key: '/library/metadata/' + rk + '/children', type: 'artist', title: name, titleSort: name.replace(/^The /, ''), librarySectionID: sec,
      thumb: art('/sc/' + (isBook ? 'author' : 'artist') + '/' + rk, 'person', { seed: name + 'x' }), art: art('/sc/art/ar' + rk, 'backdrop', { theme: isBook ? a[1][0][1] : ['sea', 'night', 'city', 'forest', 'moon', 'motel', 'desert', 'space', 'sun', 'snow', 'fog', 'garden'][i % 12], seed: rk }),
      addedAt: T0 + i * 100, summary: isBook ? name + ' writes quiet, luminous novels about places and the people who refuse to leave them.' : name + ' is a ' + a[1].toLowerCase() + ' act known for warm arrangements and late-night melodies.',
      Genre: [{ tag: isBook ? 'Fiction' : a[1] }] };
    ITEMS[rk] = artist; LIB[sec].push(artist);
    var albums = [];
    (isBook ? a[1] : a[2]).forEach(function (al, j) {
      var title = isBook ? al[0] : al, theme = isBook ? al[1] : Object.keys(require('./art').THEMES)[(i * 2 + j) % 25];
      var ark = String((isBook ? 750 : 700) + aIdx), n = isBook ? 12 + (aIdx % 3) : 9 + (aIdx % 3), tracks = [];
      var album = { ratingKey: ark, key: '/library/metadata/' + ark + '/children', type: 'album', title: title, titleSort: title.replace(/^(The|A) /, ''), parentTitle: name, parentRatingKey: rk,
        year: 2015 + (aIdx * 3) % 10, librarySectionID: sec, thumb: art('/sc/' + (isBook ? 'book' : 'album') + '/' + ark, isBook ? 'book' : 'album', { title: title, sub: name, theme: theme, seed: ark }),
        art: artist.art, parentThumb: artist.thumb, addedAt: T0 + aIdx * 500, summary: isBook ? 'Unabridged. Read by ' + PEOPLE[(aIdx + 4) % PEOPLE.length] + '.' : 'The ' + (j ? 'second' : 'debut') + ' album by ' + name + '.',
        Genre: [{ tag: isBook ? 'Fiction' : a[1] }], leafCount: n };
      for (var t = 1; t <= n; t++) {
        var trk = String((isBook ? 90000 : 80000) + aIdx * 40 + t), dur = isBook ? 1500000 + (t * 97 % 13) * 60000 : 170000 + (t * 53 % 9) * 17000;
        var tr = { ratingKey: trk, key: '/library/metadata/' + trk, type: 'track', title: isBook ? CHAPTERS[(t - 1) % CHAPTERS.length] : SONGS[(t * 3 + aIdx) % SONGS.length], index: t, parentIndex: 1,
          parentTitle: title, parentRatingKey: ark, grandparentTitle: name, grandparentRatingKey: rk, parentThumb: album.thumb, thumb: album.thumb, grandparentThumb: artist.thumb, librarySectionID: sec, duration: dur,
          addedAt: album.addedAt,
          Media: [{ audioCodec: isBook ? 'aac' : 'mp3', container: isBook ? 'm4a' : 'mp3', Part: [{ id: Number(trk), key: '/library/parts/' + trk + '/1/file.' + (isBook ? 'm4a' : 'mp3'), duration: dur }] }] };
        if (isBook && aIdx === 0 && t < 5) { tr.viewCount = 1; tr.lastViewedAt = T0 + 1000 + t; }
        if (isBook && aIdx === 0 && t === 5) { tr.viewOffset = 900000; tr.lastViewedAt = T0 + 9000; }
        if (isBook && aIdx === 3 && t === 2) { tr.viewOffset = 400000; tr.lastViewedAt = T0 + 5000; }
        if (isBook && aIdx === 3 && t === 1) { tr.viewCount = 1; tr.lastViewedAt = T0 + 4000; }
        ITEMS[trk] = tr; tracks.push(tr);
      }
      ITEMS[ark] = album; CHILDREN[ark] = tracks; albums.push(album); ALBUMS[sec].push(album); aIdx++;
    });
    CHILDREN[rk] = albums;
  });
}
audioLib(3, ARTISTS, false);
audioLib(4, AUTHORS.map(function (a) { return [a[0], a[1]]; }), true);

var SECTIONS = { MediaContainer: { size: 4, Directory: [
  { key: '1', type: 'movie', title: 'Movies', agent: 'tv.plex.agents.movie', language: 'en-US', hidden: 0 },
  { key: '2', type: 'show', title: 'TV Shows', agent: 'tv.plex.agents.series', language: 'en-US', hidden: 0 },
  { key: '3', type: 'artist', title: 'Music', agent: 'tv.plex.agents.music', hidden: 0 },
  { key: '4', type: 'artist', title: 'Audiobooks', agent: 'tv.plex.agents.music', hidden: 0 }] } };
var SECTIONS_DE = JSON.parse(JSON.stringify(SECTIONS));
['Filme', 'Serien', 'Musik', 'Hörbücher'].forEach(function (t, i) { SECTIONS_DE.MediaContainer.Directory[i].title = t; });

function ep(showIdx, s, e) { return ITEMS[String((300 + showIdx * 10) * 100 + s * 20 + e)]; }
function withOffset(it, off) { var c = JSON.parse(JSON.stringify(it)); c.viewOffset = off; return c; }
var CONTINUE = [withOffset(ITEMS['100'], 2900000), ep(0, 2, 4), withOffset(ITEMS['112'], 5200000), withOffset(ep(5, 1, 6), 900000), withOffset(ITEMS['106'], 3100000)];
var ONDECK = [ep(0, 2, 4), ep(1, 2, 3), ep(3, 1, 2), ep(4, 1, 5), ep(6, 2, 1), ep(2, 1, 7)];
var RECENT = {
  1: LIB[1].slice().sort(function (a, b) { return b.addedAt - a.addedAt; }).slice(0, 14),
  2: [ep(2, 2, 3), ep(2, 2, 2), ITEMS['380'], ep(9, 1, 8), ITEMS['390'], ITEMS['410'], ITEMS['340'], ep(7, 2, 8), ITEMS['350'], ITEMS['360']]
};
/* Server-Hubs (Startseite / Entdecken-Inspiration) */
function hub(id, ctx, type, title, list) { return { hubIdentifier: id, context: 'hub.' + ctx, type: type, title: title, size: list.length, Metadata: list }; }
function pickRk(arr) { return arr.map(function (r) { return ITEMS[String(r)]; }); }
var INSP = {
  1: [hub('movie.topunwatched.1', 'movie.topunwatched', 'movie', 'Top Unwatched', pickRk([112, 101, 104, 114, 125, 109, 128, 102, 108, 116])),
    hub('movie.recentlyreleased.1', 'movie.recentlyreleased', 'movie', 'Recently Released', pickRk([126, 112, 124, 117, 109, 100, 127, 106]))],
  2: [hub('tv.startwatching.2', 'tv.startwatching', 'show', 'Start Watching', pickRk([350, 360, 370, 380, 390, 400])),
    hub('tv.rediscover.2', 'tv.rediscover', 'show', 'Rediscover', pickRk([330, 320, 410])),
    hub('tv.toprated.2', 'tv.toprated', 'show', 'Top Rated', pickRk([310, 300, 340, 320, 390, 350, 370]))]
};
/* Entdecken: Titel, die NICHT auf dem Server liegen (ebenfalls erfunden) */
var EXTERNAL = [
  ['The Paper Navigator', 2025, 'map'], ['Harvest Lamplight', 2024, 'garden'], ['The Lamplighter\'s Code', 2023, 'night'], ['Tidecaller', 2025, 'sea'],
  ['The Last Observatory', 2022, 'space'], ['Halfway to Juniper', 2024, 'desert']
];
EXTERNAL.forEach(function (x, i) { art('/sc/ext/' + i, 'poster', { title: x[0], theme: x[2], seed: 'ext' + i, credit: 'COMING SOON' }); });

module.exports = { ITEMS: ITEMS, CHILDREN: CHILDREN, ART: ART, LIB: LIB, ALBUMS: ALBUMS, SECTIONS: SECTIONS, SECTIONS_DE: SECTIONS_DE, CONTINUE: CONTINUE, ONDECK: ONDECK,
  RECENT: RECENT, INSP: INSP, EXTERNAL: EXTERNAL, PEOPLE: PEOPLE, art: art, slug: slug };
