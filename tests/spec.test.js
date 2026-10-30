/* public/docs/SPEC.md (platform-neutral product spec) must match the code: generated blocks up to date, and every setting,
 * screen, setup.json field and helper route has a hand-written entry. Fix: `npm run spec`, then add the missing entries. */
'use strict';
var test = require('node:test'), assert = require('assert');
var spec = require('../tools/spec_gen.js');

test('SPEC.md is in sync with the code (npm run spec)', function () {
  var problems = spec.check();
  assert.deepStrictEqual(problems, [], '\n  - ' + problems.join('\n  - '));
});

test('ports.schema.json rejects bad entries; references to unknown requirement IDs are reported', function () {
  var fs = require('fs'), path = require('path'), root = path.join(__dirname, '..');
  var pub = fs.existsSync(path.join(root, 'public', 'ports.schema.json')) ? 'public/' : '';
  var sch = JSON.parse(fs.readFileSync(path.join(root, pub + 'ports.schema.json'), 'utf8')), errs = [];
  spec.validate({ ports: [{ name: 'x', brand: 'LG', models: 'C1', os: 'webOS', url: 'http://insecure', maintainer: 'a b', licence: 'MIT',
    lastVerified: '28.10.2026', features: { A1: 'yes', Z9: 'done' }, extra: 1 }] }, sch, 'ports.json', errs);
  ['too short', 'url', 'maintainer', 'lastVerified', 'A1: must be one of', 'unknown key "Z9"', 'unknown key "extra"'].forEach(function (w) {
    assert.ok(errs.some(function (e) { return e.indexOf(w) >= 0; }), 'expected an error about ' + w + ' in: ' + errs.join('; '));
  });
  // optional fields: media servers and the collection mark (set by the maintainer after the review in PORTS.md)
  errs = [];
  spec.validate({ ports: [{ name: 'Jelly TV', brand: 'LG', models: 'C1', os: 'webOS 6', url: 'https://example.org/x', maintainer: 'someone',
    licence: 'MIT', lastVerified: '2026-10-30', features: {}, mediaServers: ['jellyfin', 'kodi'], collection: 'self-tested' }] }, sch, 'ports.json', errs);
  ['mediaServers[1]: must be one of', 'collection: must be one of'].forEach(function (w) {
    assert.ok(errs.some(function (e) { return e.indexOf(w) >= 0; }), 'expected an error about ' + w + ' in: ' + errs.join('; '));
  });
  assert.strictEqual(spec.portTags({}), '');
  assert.strictEqual(spec.portTags({ mediaServers: ['plex'] }), '');
  assert.strictEqual(spec.portTags({ mediaServers: ['jellyfin', 'emby'], collection: 'community-tested' }),
    '<br>*for Jellyfin, Emby · in the collection (community-tested)*');
  assert.strictEqual(spec.portTags({ collection: 'maintainer-tested' }, true), ' <small>in the collection (maintainer-tested)</small>');
  var idx = spec.specIndex(fs.readFileSync(path.join(root, pub + 'docs/SPEC.md'), 'utf8'));
  assert.ok(idx.ids['PLAY-3'] && idx.sections.A9 && idx.anchors['a9-video-playback']);
  var p = spec.checkRefs('doc', 'see PLAY-999 and SPEC A99, [x](SPEC.md#missing); NAV-1 is fine', idx, false);
  assert.strictEqual(p.length, 3, p.join('\n'));
  // a bare dotted section number is checked too; a mention of the gen marker in the prose does not hide the text after it
  p = spec.checkRefs('doc', 'Blocks between `<!-- gen:… -->` markers.\nlist editor (A5.4), see A9.3 and C2.4.\n<!-- gen:x -->\nA77.1\n<!-- /gen:x -->\n', idx, false);
  assert.deepStrictEqual(p.map(function (x) { return /section (\S+),/.exec(x)[1]; }), ['A5.4']);
  // "X-1 … X-n" = all of them: reported when X-(n+1) exists in the same section; a range not starting at 1 is a subset
  var lastPlay = Object.keys(idx.ids).filter(function (k) { return /^PLAY-\d+$/.test(k); }).map(function (k) { return +k.slice(5); }).sort(function (a, b) { return b - a; })[0];
  p = spec.checkRefs('doc', 'PLAY-1 … PLAY-' + (lastPlay - 1) + ', PLAY-3 … PLAY-5, PLAY-1 … PLAY-' + lastPlay, idx, false);
  assert.strictEqual(p.length, 1, p.join('\n'));
  assert.ok(/misses PLAY-/.test(p[0]), p[0]);
});

test('TEST-PLAN.md covers every Part A requirement; reusable parts must exist', function () {
  var fs = require('fs'), path = require('path'), root = path.join(__dirname, '..');
  var pub = fs.existsSync(path.join(root, 'public', 'docs', 'SPEC.md')) ? 'public/' : '';
  var specText = fs.readFileSync(path.join(root, pub + 'docs/SPEC.md'), 'utf8');
  var plan = fs.readFileSync(path.join(root, pub + 'docs/TEST-PLAN.md'), 'utf8');
  var reqs = spec.specReqs(specText);
  assert.ok(reqs.length > 100 && reqs.every(function (q) { return /^A\d+$/.test(q.sec.id); }), 'Part A requirements found');
  assert.ok(reqs.some(function (q) { return q.id === 'NAV-5' && /exit dialog/.test(q.accept); }), 'acceptance criterion of NAV-5 parsed');
  assert.deepStrictEqual(spec.testPlanData(plan, specText).probs, []);
  // a removed row, a bad "who" column and an unknown ID are reported
  var broken = plan.replace(/^\| `NAV-5` \|.*\n/m, '').replace('| `NAV-6` | human |', '| `NAV-6` | robot |')
    .replace('<!-- /hand:test-steps -->', '| `ZZZ-1` | agent | x | – | y | – | – |\n<!-- /hand:test-steps -->');
  var p = spec.testPlanData(broken, specText).probs.join('\n');
  ['Requirement NAV-5', '`NAV-6`: the second column', '`ZZZ-1` refers to no requirement'].forEach(function (w) {
    assert.ok(p.indexOf(w) >= 0, 'expected "' + w + '" in:\n' + p);
  });
  // reusable parts: a path that does not exist fails the check, facts come from the code
  var g = spec.genReuse('<!-- hand:reuse -->\n| `src/core/nope.js` | a | b | c |\n| `src/core/clock.js` | a | b | c |\n<!-- /hand:reuse -->');
  assert.strictEqual(g.errs.length, 1, g.errs.join('\n'));
  assert.ok(/nope\.js/.test(g.errs[0]) && /`N\.clock`/.test(g.text));
});

test('Changed requirement text needs a review: npm run spec -- --ack <ID>', function () {
  var fs = require('fs'), path = require('path'), root = path.join(__dirname, '..');
  var pub = fs.existsSync(path.join(root, 'public', 'docs', 'SPEC.md')) ? 'public/' : '';
  var rd = function (f) { return fs.readFileSync(path.join(root, pub + f), 'utf8').replace(/\r\n/g, '\n'); };
  var specText = rd('docs/SPEC.md'), plan = rd('docs/TEST-PLAN.md'), port = rd('docs/PORTING-WITH-AI.md'), lock = rd('docs/spec-review.json');
  // the committed lock matches the current spec
  var same = spec.genReview(lock, specText, plan, port);
  assert.deepStrictEqual(same.errs, []);
  assert.strictEqual(same.text, lock);
  // NAV-1 reworded (ID unchanged) -> reported with its dependent rows; the lock keeps the old hash
  var changed = specText.replace('- **NAV-1** The app MUST be fully usable', '- **NAV-1** The app MUST be completely usable');
  assert.notStrictEqual(changed, specText);
  var r = spec.genReview(lock, changed, plan, port);
  assert.strictEqual(r.errs.length, 1, r.errs.join('\n'));
  assert.ok(/Requirement NAV-1 .*TEST-PLAN\.md.*--ack NAV-1/.test(r.errs[0]), r.errs[0]);
  assert.strictEqual(r.text, lock);
  // extra spaces / other line wrapping are no change
  assert.deepStrictEqual(spec.genReview(lock, specText.replace('- **NAV-1** The app MUST be fully usable', '- **NAV-1** The app MUST  be fully usable'), plan, port).errs, []);
  // --ack confirms it; unknown IDs are refused
  var a = spec.genReview(lock, changed, plan, port, ['NAV-1']);
  assert.deepStrictEqual(a.errs, []);
  assert.strictEqual(JSON.parse(a.text).reviewed['NAV-1'], spec.reqHash(spec.specReqs(changed).filter(function (q) { return q.id === 'NAV-1'; })[0].text));
  assert.ok(/no such requirement/.test(spec.genReview(lock, specText, plan, port, ['NOPE-1']).errs.join()));
  // a requirement named in a reusable-part row: that row is named in the message
  var r2 = spec.genReview(lock, specText.replace(/- \*\*NET-3\b/, '- **NET-3** (reworded)'), plan, port);
  assert.ok(r2.errs.some(function (e) { return /NET-3/.test(e) && /src\/net\/http\.js/.test(e); }), r2.errs.join('\n'));
  // new requirements are added without --ack, removed ones dropped
  var j = JSON.parse(lock); delete j.reviewed['NAV-2']; j.reviewed['GONE-1'] = 'x';
  var b = spec.genReview(JSON.stringify(j), specText, plan, port);
  assert.deepStrictEqual(b.errs, []);
  assert.strictEqual(b.text, lock);
});

test('One version in all version files; stale messages show both lines', function () {
  assert.deepStrictEqual(spec.versionProblems(), []);
  var d = spec.firstDiff('a\nb\nc', 'a\nB\nc');
  assert.ok(/line 2: is "b", should be "B"/.test(d), d);
  assert.ok(/should be "\(end of file\)"/.test(spec.firstDiff('a\nb', 'a')));
});

test('Starter prompt: one source in the playbook, generated copies in the READMEs and on the website', function () {
  var fs = require('fs'), path = require('path'), root = path.join(__dirname, '..');
  var pub = fs.existsSync(path.join(root, 'public', 'docs', 'SPEC.md')) ? 'public/' : '';
  var real = function (rel) { return fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n'); };
  var book = pub + 'docs/PORTING-WITH-AI.md';
  function run(edit) {
    var g = spec.generateAll(function (rel) { return rel === book ? edit(real(rel)) : real(rel); });
    var out = {};
    g.files.forEach(function (f) { out[f.rel] = f.out; });
    return { out: out, problems: g.problems.join('\n') };
  }
  // a changed prompt reaches every copy (HTML-escaped on the website)
  var r = run(function (t) { return t.replace('Work in a new folder;', 'Work in a NEW <folder>;'); });
  assert.ok(r.out[pub + 'README.md'].indexOf('Work in a NEW <folder>;') >= 0, 'README copy updated');
  assert.ok(r.out[pub + 'README.de.md'].indexOf('Work in a NEW <folder>;') >= 0, 'README.de copy updated');
  assert.ok(r.out[pub + 'docs/index.html'].indexOf('Work in a NEW &lt;folder&gt;;') >= 0, 'website copy updated and escaped');
  assert.ok(r.out[pub + 'docs/port.html'].indexOf('Work in a NEW &lt;folder&gt;;') >= 0, 'porting page copy updated');
  // a prompt without the raw link to the playbook, or without its block, is reported
  r = run(function (t) { return t.replace(/https:\/\/raw\.githubusercontent\.com\/\S*PORTING-WITH-AI\.md/, 'the playbook'); });
  assert.ok(/starter prompt must contain the raw link/.test(r.problems), r.problems);
  r = run(function (t) { return t.replace('<!-- hand:prompt -->', ''); });
  assert.ok(/starter prompt block <!-- hand:prompt -->/.test(r.problems), r.problems);
});
