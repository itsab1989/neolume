/* N.input – Eingabeart (docs/research/apple/08-touch.md 4, Entscheidung Nr. 14): 'key' (Tasten, Fernbedienung, Tastatur),
 * 'pointer' (Maus, Trackpad, Luftmaus-Zeiger) oder 'touch' (Finger). Gesetzt von App.press (Tasten), N.pointer.move (echte
 * Zeiger-Bewegung) und dem Plattform-Lader (App.input('touch') bei jeder Beruehrung).
 * Nur mit caps.focusRing === 'keys' wirkt die Art: Klasse am body (inp-key | inp-ptr | inp-touch), umgeschaltet NUR beim
 * Wechsel (nie je Tastenschritt), dazu das Ereignis 'input:mode'. CSS blendet unter .inp-touch/.inp-ptr Fokusrahmen und
 * Fokus-Vergroesserung aus und zeigt die Hinweisleiste als Knoepfe; die erste Taste schaltet auf inp-key -> Fokus wie am TV.
 * Fokus und Klassen werden auch bei Touch weiter nachgefuehrt (nur unsichtbar), darum ist "Taste nach Touch" billig.
 * Einzige Quelle der Eingabeart (auch N.pointer und views/player.js lesen N.input.mode, z. B. caps.pointer 'mouse': keine
 * Tastenkappen im Player, Finger-Ziehen). Die Art wird immer mitgefuehrt (eine Zuweisung); Klasse und Ereignis gibt es nur mit
 * focusRing 'keys' – am TV (caps.focusRing 'always') also keine Klasse, kein Ereignis, kein DOM-Zugriff. */
(function (N) {
  var CLS = { key: 'inp-key', pointer: 'inp-ptr', touch: 'inp-touch' };
  var I = { mode: 'key', on: false, swipe: false };   // swipe: gerade laeuft ein Pfeil aus einem Finger-Wisch (App.press via 'touch')
  function body() { return typeof document !== 'undefined' && document.body ? document.body : null; }
  function paint(old) {
    var b = body();
    if (!b) return;
    if (old) N.util.cls(b, CLS[old], false);
    N.util.cls(b, CLS[I.mode], true);
  }
  /* einmal beim Start (App.boot): Startart nach Geraet – Touch-Geraet 'touch', sonst 'pointer' (Mac); TV: aus */
  I.init = function () {
    var c = (N.platform && N.platform.caps) || {};
    I.on = c.focusRing === 'keys';
    I.mode = I.on ? (c.touch ? 'touch' : 'pointer') : 'key';   // TV startet mit Tasten
    if (I.on) paint(null);
  };
  /* Rueckgabe true = Art hat gewechselt */
  I.set = function (m) {
    if (m === I.mode || !CLS[m]) return false;
    var old = I.mode;
    I.mode = m;
    if (!I.on) return true;
    paint(old);
    N.evt.emit('input:mode', m);
    return true;
  };
  /* Bedienung per Finger/Maus sichtbar (Hinweis-Knoepfe, Zurueck-Knopf der Profilwahl)? Am TV immer false. */
  I.direct = function () { return I.on && I.mode !== 'key'; };
  I.CLS = CLS;
  N.input = I;
})(N);
