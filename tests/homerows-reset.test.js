/* "Startseite anpassen" › "Standard wiederherstellen" (SPEC HOME-4): ohne entfernbare Reihen die einfache Rueckfrage; mit
 * selbst hinzugefuegten Reihen einer (hier erfundenen, neutralen) Erweiterung drei Knoepfe – eigene Reihen behalten
 * (ausgeschaltet), alles zuruecksetzen oder Abbrechen (unten, Fokus; NAV-11). Kleine DOM-Attrappe, keine Darstellung. */
'use strict';
var test = require('node:test'), assert = require('assert');
var H = require('./helpers/load');

function setup(saved, ext) {
  var c = H.load(), N = c.N, ctx = c.ctx || c, dlg = [], toasts = [];
  function El(tag) { this.tagName = tag; this.style = {}; this.childNodes = []; this.className = ''; }
  El.prototype.appendChild = function (x) { this.childNodes.push(x); x.parentNode = this; return x; };
  ctx.document = { createElement: function (t) { return new El(t); }, createTextNode: function (t) { return { nodeValue: t }; } };
  N.i18n.set('de');
  N.session = { settings: { homeRows: saved }, homeCache: function () { return { libs: [{ id: 1, type: 'movie' }] }; }, hubCatalog: function () { return null; },
    setSetting: function (k, v) { this.settings[k] = v; } };
  N.ui.dialog = { open: function (o) { dlg.push(o); } };
  N.ui.toast = { show: function (t) { toasts.push(t); } };
  N.router.refreshHints = function () {};
  N.fx = { move: function () {} };
  if (ext) {
    /* erfundene Erweiterung: eine feste Reihe (aus) + selbst hinzugefuegte aus der gespeicherten Liste (entfernbar) */
    N.ext.on('home:avail', function () {
      var out = [{ id: 'x-demo-fixed' }], l = N.session.settings.homeRows || [];
      l.forEach(function (x) { if (/^x-demo-own/.test(x.id)) out.push({ id: x.id, rm: true }); });
      return out;
    });
    N.ext.on('home:removable', function (id) { return /^x-demo-own/.test(id) ? true : undefined; });
    N.ext.on('home:label', function (id) { return id; });
  }
  var scr = N.rowsEditor({ setting: 'homeRows', ext: true, noCatalog: true,
    keys: { title: 'set.homeRows', how: 'set.hr.how', help: 'set.hr.help', resetDesc: 'set.hr.reset.desc', resetText: 'dlg.hrReset.text' },
    avail: function () { return N.homeRows.avail([{ id: 1 }], null); }, label: function (it) { return it.id; }, val: function () { return ''; }, desc: function () { return ''; } })();
  scr.create(new El('div'));
  return { N: N, scr: scr, dlg: dlg, toasts: toasts };
}
function toReset(s) { for (var i = 0; i < 40; i++) s.scr.onKey('DOWN'); s.scr.onKey('ENTER'); }

test('Standard wiederherstellen ohne eigene Reihen: einfache Rueckfrage (wie bisher), Standard = null', function () {
  var s = setup([{ id: 'deck', on: false }, { id: 'cw', on: true }], false);
  toReset(s);
  assert.strictEqual(s.dlg.length, 1);
  H.eq([s.dlg[0].title, s.dlg[0].buttons.map(function (b) { return b.id; }), s.dlg[0].focus, !!s.dlg[0].vertical], ['Standard wiederherstellen?', ['ok', 'cancel'], 1, false]);
  s.dlg[0].onSelect('ok');
  assert.strictEqual(s.N.session.settings.homeRows, null);
});

test('Standard wiederherstellen mit eigenen Reihen: behalten (aus) / alles loeschen / Abbrechen (Fokus)', function () {
  var saved = [{ id: 'x-demo-own-1', on: true }, { id: 'deck', on: false }, { id: 'cw', on: true }, { id: 'x-demo-fixed', on: true }, { id: 'x-demo-own-2', on: true }];
  var s = setup(JSON.parse(JSON.stringify(saved)), true);
  toReset(s);
  var d = s.dlg[0];
  H.eq([d.title, d.text, d.buttons.map(function (b) { return b.t; }), d.focus, d.vertical],
    ['Standard wiederherstellen?', 'Weiterschauen, Nächste Folgen und das Neueste jeder Bibliothek kommen zurück, alles andere geht aus. Deine hinzugefügten Reihen: behalten oder löschen?',
      ['Eigene Reihen behalten (ausschalten)', 'Alles zurücksetzen (eigene Reihen löschen)', 'Abbrechen'], 2, true]);
  d.onSelect('cancel');
  H.eq(s.N.session.settings.homeRows, saved, 'Abbrechen aendert nichts');
  d.onSelect('own');
  H.eq(s.N.session.settings.homeRows, [{ id: 'cw', on: true }, { id: 'deck', on: true }, { id: 'new-1', on: true }, { id: 'x-demo-fixed', on: false },
    { id: 'x-demo-own-1', on: false }, { id: 'x-demo-own-2', on: false }], 'Standard-Reihenfolge, eigene Reihen bleiben (aus) am Ende');
  assert.strictEqual(s.toasts.pop(), 'Standard da, eigene Reihen ausgeschaltet');
  /* zweite Runde: eigene Reihen gibt es noch -> wieder drei Knoepfe; "alles" loescht sie */
  toReset(s);
  s.dlg[1].onSelect('all');
  assert.strictEqual(s.N.session.settings.homeRows, null);
  assert.strictEqual(s.toasts.pop(), 'Standard wiederhergestellt');
  toReset(s);
  H.eq(s.dlg[2].buttons.map(function (b) { return b.id; }), ['ok', 'cancel'], 'keine eigenen Reihen mehr: einfache Rueckfrage');
});
