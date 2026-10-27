#!/usr/bin/env node
/* Messlauf am Desktop (P7): startet den Mock aus tools/visual.js, oeffnet tools/preview.html in Firefox headless mit
 * &src=dev&bench=<szenarien> und sammelt die Protokollzeilen (POST an den Mock). Ohne Netz, ohne Geheimnisse.
 * Desktop-FPS sagen nichts ueber den TV – der Lauf prueft, dass alle Szenarien laufen, und liefert Leck-/Start-Zahlen.
 *   node tools/bench.js [all|home,lib,leak:20 …]   (Standard: all,leak; Build: app/app.js, da dev/-Module noetig)
 *   node tools/bench.js --start [--min]          nur Startzeit (Auswerten des Skripts + start-kosten), --min = app.min.js
 * P7 27.10.: haengt immer ',work' an (Arbeit je Fokusschritt: JS, Stil+Layout, DOM-Aenderungen – Vergleichsmass vorher/nachher);
 *   Firefox-Profil mit voller Timer-Aufloesung (privacy.reduceTimerPrecision aus). --no-work = ohne. */
'use strict';
var fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
var V = require('./visual');
var ROOT = path.join(__dirname, '..');
var FIREFOX = process.env.FIREFOX || '/Applications/Firefox.app/Contents/MacOS/firefox';
var args = process.argv.slice(2), spec = args.filter(function (a) { return a.charAt(0) !== '-'; })[0] || 'all,leak';
var MIN = args.indexOf('--min') >= 0;    // Release-Build (keine dev/-Module -> nur Startzeit)
var START = MIN || args.indexOf('--start') >= 0;   // nur Startzeit messen (Auswertung 'preview eval' + 'start-kosten')
if (args.indexOf('--no-work') < 0 && !/(^|,)work(,|$)/.test(spec)) spec += ',work';

V.startServer(function (srv, port, sink) {
  V.makeSeeds(port);
  var prof = fs.mkdtempSync(path.join(os.tmpdir(), 'pnbench-')), out = path.join(prof, 'shot.png'), lines = [], done = false;
  fs.writeFileSync(path.join(prof, 'user.js'), 'user_pref("privacy.reduceTimerPrecision", false);\nuser_pref("privacy.resistFingerprinting", false);\n');
  var url = 'file://' + path.join(ROOT, 'tools', 'preview.html') + '?clear=1&src=dev&seed=' + encodeURIComponent('http://127.0.0.1:' + port + '/seed/play.js') +
    '&hold=600000&holdurl=' + encodeURIComponent('http://127.0.0.1:' + port + '/sleep') + '&logurl=' + encodeURIComponent('http://127.0.0.1:' + port + '/log') +
    (MIN ? '&min=1' : '') + (START ? '' : '&bench=' + encodeURIComponent(spec));
  var ff = cp.spawn(FIREFOX, ['--headless', '-no-remote', '-profile', prof, '--window-size=1280,720', '--screenshot', out, url], { stdio: 'ignore' });
  var guard = setTimeout(function () { finish('Zeitlimit'); }, 15 * 60000);
  sink.on = function (l) {
    lines.push(l);
    if (/(^| )(start |first view|start-kosten|preview eval)|bench |frames /.test(l)) console.log(l.replace(/^\[neo\] \S+ /, ''));
    if (/bench (done|abgebrochen)|Startseite nicht bereit|keine Szenarien/.test(l) || (START && /start-kosten/.test(l))) setTimeout(function () { finish(''); }, 500);
  };
  function finish(why) {
    if (done) return; done = true; clearTimeout(guard);
    try { ff.kill('SIGKILL'); } catch (e) {}
    srv.close();
    setTimeout(function () { try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) {} }, 500);
    if (why) { console.error('Abbruch: ' + why); process.exit(1); }
    var bad = lines.filter(function (l) { return /VERDACHT|Fehler|JS-Fehler/.test(l); });
    if (bad.length) { console.error('\n' + bad.length + ' Auffaelligkeit(en):\n' + bad.join('\n')); process.exit(1); }
    process.exit(0);
  }
});
