/* Einrichtungsprogramm: die Skripte der Oberflaeche muessen sich parsen lassen (Neolume-CI 05.11.: ein gerader Apostroph in
 * einem englischen Text beendete die Zeichenkette – die ganze Seite blieb leer). Prueft ui.html und die Skripte der Erweiterungen. */
var test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path'), vm = require('vm');
var ROOT = path.join(__dirname, '..', 'installer', 'neosetup');

function scripts(file) {
  var s = fs.readFileSync(file, 'utf8'), out = [], re = /<script[^>]*>([\s\S]*?)<\/script>/g, m;
  while ((m = re.exec(s))) out.push(m[1]);
  return out;
}

test('Einrichtungsprogramm: Skripte in ui.html sind gueltiges JavaScript', function () {
  var list = scripts(path.join(ROOT, 'ui.html'));
  assert.ok(list.length > 0, 'ui.html ohne <script>');
  list.forEach(function (code, i) {
    assert.doesNotThrow(function () { new vm.Script(code, { filename: 'ui.html#script' + i }); }, 'ui.html Skript ' + i);
  });
});

test('Einrichtungsprogramm: Skripte der Erweiterungen sind gueltiges JavaScript', function () {
  var dir = path.join(ROOT, 'private');
  if (!fs.existsSync(dir)) return;                       // oeffentliche Ausgabe: keine Erweiterungen
  fs.readdirSync(dir).filter(function (f) { return /\.js$/.test(f); }).forEach(function (f) {
    var code = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.doesNotThrow(function () { new vm.Script(code, { filename: f }); }, f);
  });
});
