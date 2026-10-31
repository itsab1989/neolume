/* NAV-11 Knopf-Reihenfolge in JEDEM Dialog und jeder Zustandsbox der App (ohne Erweiterungen; die pruefen ihre eigenen):
 * Hauptaktion links bzw. oben, Abbrechen/Behalten/Zurueck/Spaeter/Schliessen rechts bzw. unten. Fokus: loeschende oder
 * verlassende Rueckfragen auf der sicheren Option (letzter Knopf), harmlose auf der Hauptaktion (erster Knopf).
 * Statisch aus dem Quelltext (tests/helpers/dialogs.js) – ein neuer Dialog faellt hier auf, bevor er auf dem Fernseher landet. */
'use strict';
var test = require('node:test'), assert = require('assert'), path = require('path');
var D = require('./helpers/dialogs');
var ROOT = path.join(__dirname, '..'), SRC = path.join(ROOT, 'src');

/* Hauptaktionen, die etwas loeschen, abmelden, die App verlassen oder viel auf einmal aendern -> Fokus auf die sichere Option */
var SAFE = {
  'dlg.exit.confirm': 1,          // App beenden
  'dlg.mark.confirm': 1,          // ganze Serie/Staffel als (un)gesehen markieren
  'dlg.hrReset.confirm': 1,       // Startseite: Standard wiederherstellen
  'dlg.hrResetOwn.keep': 1,       // ... mit eigenen Reihen (drei Knoepfe)
  'dlg.hrRemove.confirm': 1,      // hinzugefuegte Reihe entfernen
  'dlg.pinRemove.confirm': 1,     // App-PIN entfernen
  'dlg.account.confirm': 1,       // abmelden
  'dlg.recentClear.confirm': 1    // Suchverlauf leeren
};
/* bewusst harmlos, obwohl der Name anders klingt */
var NOT_RISKY = {};
/* zur Laufzeit gebaute Knopflisten (Kontextmenues ohne Abbrechen-Knopf, Fehlerbox der Startseite mit genau einem Knopf) */
var DYN = ['src/views/album.js', 'src/views/details.js', 'src/views/home.js', 'src/views/library.js'];

function pub() {
  var r = D.scan(SRC, ROOT);
  r.lit = r.lit.filter(function (d) { return !/^src\/private\//.test(d.file); });
  r.dyn = r.dyn.filter(function (d) { return !/^src\/private\//.test(d.file); });
  return r;
}

test('NAV-11: jede Dialog-/Zustandsbox-Definition haelt Reihenfolge und Fokus ein', function () {
  var r = pub(), bad = [];
  assert.ok(r.lit.length >= 25, 'Scanner findet die Dialoge (' + r.lit.length + ')');
  r.lit.forEach(function (d) { var m = D.check(d, SAFE); if (m) bad.push(m); });
  assert.deepStrictEqual(bad, []);
});

test('NAV-11: Hauptaktionen, die nach Loeschen/Verlassen klingen, stehen in SAFE (Fokus auf der sicheren Option)', function () {
  var miss = [];
  pub().lit.forEach(function (d) {
    var k = d.keys[0];
    if (d.ids.length > 1 && k && D.RISKY.test(k) && !SAFE[k] && !NOT_RISKY[k]) miss.push(d.file + ':' + d.line + ' ' + k);
  });
  assert.deepStrictEqual(miss, []);
});

test('NAV-11: zur Laufzeit gebaute Knopflisten sind bekannt (neue bitte ansehen und hier eintragen)', function () {
  var files = {};
  pub().dyn.forEach(function (d) { files[d.file] = 1; });
  assert.deepStrictEqual(Object.keys(files).sort(), DYN);
});

test('NAV-11: Beispiele – Beenden, Anmelden, Wiedergabefehler', function () {
  var byKey = {}, all = pub().lit;
  all.forEach(function (d) { byKey[d.keys[0] + '|' + d.file] = d; });
  var ex = byKey['dlg.exit.confirm|src/ui/dialog.js'];
  assert.deepStrictEqual([ex.ids, ex.focus], [['exit', 'cancel'], 1], 'Beenden links, Abbrechen rechts mit Fokus');
  var si = byKey['err.btn.signIn|src/views/profiles.js'];
  assert.deepStrictEqual([si.ids, si.focus], [['in', 'cancel'], 0], 'Anmelden links mit Fokus');
  var pe = all.filter(function (d) { return d.file === 'src/views/player.js' && d.ids.indexOf('back') >= 0; })[0];
  assert.deepStrictEqual(pe.ids, ['retry', 'back'], 'Wiedergabefehler: Nochmal links, Zurueck rechts');
});
