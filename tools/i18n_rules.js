/* Gemeinsame i18n-Regeln fuer Build und Tests (SPEC 10.0/10.2/4): Zeichengrenzen je Schluessel, erlaubte Zeichen. */
'use strict';
// Font-Subset: Basic Latin + Latin-1 + Sonderzeichen (SPEC 4). ” (U+201D) ergaenzt: noetig fuer englische “…” (SPEC 10.1 EN 9).
// Ohne → ← ▲ ▼ ◀ ▶ − ★ ✓ ⌫ ↩: fehlen in der TV-Schrift (NUTZER-FEEDBACK-REGELN 10, TV-Befund 26.10.)
var EXTRA = '–—„“”‚‘’…·×‹›';
var BANNED = '→←▲▼◀▶−★✓⌫↩☆✔✕⏎';
function allowedChar(ch) { var c = ch.charCodeAt(0); return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || EXTRA.indexOf(ch) >= 0; }
var RULES = [
  [/^hint\./, 14], [/^toast\./, 40], [/^nav\./, 15],
  [/^dlg\..*\.title$/, 32], [/^dlg\..*\.text$/, 160], [/^dlg\..*\.(confirm|cancel)$/, 18], [/^kids\.protect\.(ok|later)$/, 18],
  [/^kids\.protect\.title$/, 32], [/^kids\.protect\.text$/, 160],
  [/^err\.btn\./, 18], [/^login\.btn/, 18], [/^err\..*\.title$/, 40], [/^err\..*\.text$/, 200],
  [/^empty\..*\.title$/, 40], [/^empty\..*\.text$/, 200],
  [/^set\.cat\.[a-z]+$/, 18], [/^set\..*\.(desc|disabled)$/, 160], [/^set\.(on|off)$/, 18], [/^set\.[a-zA-Z]+$/, 34],
  [/^home\.row\./, 32], [/^home\.overline\./, 40], [/^prof\.sub\./, 14], [/^prof\.pin\.title$/, 32], [/^card\.sub\./, 30],
  [/^ss\./, 24], [/^menu\./, 34], [/^help\./, 600], [/^lang\./, 18], [/^soon\.title$/, 40], [/^soon\.text$/, 200]
];
function limitFor(key) { for (var i = 0; i < RULES.length; i++) if (RULES[i][0].test(key)) return RULES[i][1]; return 0; }
function placeholders(s) { var m = String(s).match(/\{\w+\}/g) || []; return m.slice().sort().join(','); }
function forms(v) { return typeof v === 'string' ? [v] : [v.one, v.other]; }
/* -> Liste von Fehlermeldungen */
function check(de, en) {
  var errs = [], k;
  for (k in de) if (!(k in en)) errs.push('EN fehlt: ' + k);
  for (k in en) if (!(k in de)) errs.push('DE fehlt: ' + k);
  for (k in de) {
    if (!(k in en)) continue;
    var a = de[k], b = en[k];
    if (typeof a !== typeof b) { errs.push('Typ (Mehrzahl) ungleich: ' + k); continue; }
    if (typeof a === 'object' && (!a.one || !a.other || !b.one || !b.other)) errs.push('Mehrzahl braucht one+other: ' + k);
    var fa = forms(a), fb = forms(b);
    if (placeholders(fa.join(' ')) !== placeholders(fb.join(' '))) errs.push('Platzhalter ungleich: ' + k);
    var lim = limitFor(k);
    [['de', fa], ['en', fb]].forEach(function (p) {
      p[1].forEach(function (s) {
        var plain = String(s).replace(/\{\w+\}/g, '');
        if (lim && plain.length > lim) errs.push('Zu lang (' + p[0] + ' ' + plain.length + '>' + lim + '): ' + k);
        for (var i = 0; i < s.length; i++) if (!allowedChar(s[i])) errs.push('Zeichen nicht im Font-Subset (' + p[0] + ' U+' + s.charCodeAt(i).toString(16) + '): ' + k);
      });
    });
  }
  return errs;
}
module.exports = { check: check, limitFor: limitFor, allowedChar: allowedChar, BANNED: BANNED };
