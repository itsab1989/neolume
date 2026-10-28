/* tools/visual.js: Szenenauswahl (--only mit Mustern) und rechnerweite Firefox-Grenze (Sperrordner) */
'use strict';
var test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path');
var V = require('../tools/visual');

test('--only: Namen und Muster', function () {
  assert.ok(V.matchAny('home', ['home']));
  assert.ok(!V.matchAny('home-en', ['home']));
  assert.ok(V.matchAny('saver-ambient-busy', ['saver-*-busy']));
  assert.ok(V.matchAny('pin', ['pi?']) && !V.matchAny('pin-wrong', ['pi?']));
  assert.ok(V.matchAny('p5-keys', ['x', 'p5-*']));
});

test('Firefox-Grenze: hoechstens max gleichzeitig, Warteschlange, verwaiste Eintraege', function (t, done) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pnvis-slot-test-'));
  fs.writeFileSync(path.join(dir, '000000000000001-999999-dead'), '');   // Prozess gibt es nicht -> wird aufgeraeumt
  var got = [], rel = [];
  for (var i = 0; i < 3; i++) (function (k) { V.slotAcquire(function (r) { got.push(k); rel.push(r); }, 2, dir); })(i);
  setTimeout(function () {
    assert.strictEqual(got.length, 2, 'zwei frei, der dritte wartet');
    assert.ok(!fs.existsSync(path.join(dir, '000000000000001-999999-dead')), 'verwaister Eintrag entfernt');
    rel[0]();
    setTimeout(function () {
      assert.strictEqual(got.length, 3, 'nach Freigabe kommt der Wartende dran');
      rel[1](); rel[2]();
      assert.deepStrictEqual(fs.readdirSync(dir), []);
      fs.rmSync(dir, { recursive: true, force: true });
      done();
    }, 800);
  }, 300);
});
