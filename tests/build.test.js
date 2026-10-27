'use strict';
var test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
var B = require('../tools/build');

test('ES5-Gate: gebautes app.js ist ES5 ohne verbotene APIs', function () {
  var code = fs.readFileSync(path.join(__dirname, '..', 'app', 'app.js'), 'utf8');
  assert.deepStrictEqual(B.es5Errors(code), []);
  assert.ok(!/[^\x00-\x7e]/.test(code), 'nur ASCII (Orsay liest JS als Latin-1)');
  assert.ok(/window\.App = /.test(code));
});
test('P7: app.min.js (Release) ist ES5, ASCII, ohne dev/-Module und kleiner', function () {
  var dir = path.join(__dirname, '..', 'app'), f = path.join(dir, 'app.min.js');
  if (!fs.existsSync(f)) return;                       // build --no-min
  var min = fs.readFileSync(f, 'utf8'), full = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
  assert.deepStrictEqual(B.es5Errors(min), []);
  assert.ok(!/[^\x00-\x7e]/.test(min), 'nur ASCII');
  assert.ok(/window\.App=/.test(min));
  assert.ok(!/N\.devperf=|N\.devbench=/.test(min), 'keine Entwicklungs-Module im Release');
  assert.ok(min.length < full.length * 0.8);
});
test('P7: Minifizierung bleibt ES5 (keine ES2015-Ausgabe) und behaelt globale Namen', async function () {
  var src = 'var N = N || {}; (function (N) { var langerName = { "class": 1, default: 2 }; N.x = function (a, b) { return a ? langerName["class"] + b : langerName.default; }; })(N); window.App = { x: N.x };';
  var out = await B.minify(src);
  assert.deepStrictEqual(B.es5Errors(out), []);
  assert.ok(/var N=N\|\|\{\}/.test(out));
  assert.ok(/window\.App=/.test(out));
  assert.ok(!/=>|\blet\b|\bconst\b|`/.test(out));
});
test('ES5-Gate schlaegt bei ES6 an', function () {
  assert.ok(B.es5Errors('let a = 1;').length);
  assert.ok(B.es5Errors('var f = () => 1;').length);
  assert.ok(B.es5Errors('var p = new Promise(function () {});').length);
  assert.ok(B.es5Errors('var o = Object.assign({}, {});').length);
  assert.ok(B.es5Errors('"abc".startsWith("a");').length);
  assert.deepStrictEqual(B.es5Errors('var a = [1].indexOf(1); var b = { fill: 1 }; b.fill = 2;'), []);
});
test('CSS-Gate: Verbote und Mindestschrift 16 px', function () {
  assert.deepStrictEqual(B.cssErrors('.a{font-size:16px;-webkit-transform:none}'), []);
  assert.ok(B.cssErrors('.a{font-size:14px}').length);
  assert.ok(B.cssErrors('.a{background:linear-gradient(red,blue)}').length);
  assert.ok(B.cssErrors('.a{box-shadow:0 0 1px red}').length);
  assert.ok(B.cssErrors('.a{display:flex}').length);
  assert.ok(B.cssErrors('.a{width:calc(1px + 2px)}').length);
  assert.ok(B.cssErrors('.a{transform:none}').length);
});
test('Nicht-ASCII wird zu \\uXXXX', function () {
  assert.strictEqual(B.escapeNonAscii("'Lädt …'"), "'L\\u00e4dt \\u2026'");
});

test('Visueller Vergleich: gleich, Abweichung, Maske, PNG-Roundtrip', function () {
  var V = require('../tools/visual');
  function img(w, h, fill) { var px = Buffer.alloc(w * h * 4, fill); return { w: w, h: h, px: px }; }
  var a = img(10, 10, 100), b = img(10, 10, 100);
  assert.strictEqual(V.compare(a, b).diff, 0);
  b.px[(5 * 10 + 5) * 4] = 200;
  assert.strictEqual(V.compare(a, b).diff, 1);
  assert.strictEqual(V.compare(a, b, [[4, 4, 3, 3]]).diff, 0);
  assert.strictEqual(V.compare(a, img(9, 10, 100)).diff, -1);
  var tmp = require('os').tmpdir() + '/pn-vis-test.png';
  fs.writeFileSync(tmp, V.solidPng(3, 2, [10, 20, 30]));
  var r = V.readPng(tmp);
  assert.strictEqual(r.w, 3); assert.deepStrictEqual([r.px[0], r.px[1], r.px[2], r.px[3]], [10, 20, 30, 255]);
});
