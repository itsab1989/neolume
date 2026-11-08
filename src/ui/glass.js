/* N.glass – Einstellung "Transparenz der Leisten" (SPEC BG-2, settings.glass, je Profil, Standard deckend; Nutzerwunsch 08.11.):
 * Seitenleiste und Band unten lassen das Bild dahinter durchscheinen wie der Kasten der Uhr (c.bg-60). Drei Stufen (Nutzer am TV
 * 08.11.): 'off' = deckend wie bisher (Standard) · 'mid' = leicht durchscheinend (*-glass-mid.png) · 'strong' = durchscheinend
 * (*-glass.png). Frueher gespeichertes true (eine Stufe) = 'strong'. Umsetzung ohne neue Ebene und ohne CSS-Verlauf: dieselben
 * <img>-Elemente bekommen statt rail.png, fade-bottom.png, fade-frame.png, scrim.png, scrim-det.png, scrim-np.png die gleich grossen
 * Fassungen der Stufe (tools/make_assets.js --glass). Die Bilder merken ihren Grundnamen im Attribut data-glass; ein Wechsel der
 * Einstellung tauscht nur deren src (einmal Dekodieren, nie im Tastenpfad). Ansichten im Stapel (display:none) sind im DOM und werden
 * mitgetauscht; zerstoerte Ansichten bauen sich mit dem aktuellen Wert neu auf – daher keine Liste, die Elemente festhaelt.
 * Kopfband der Detailseiten (scrim-hdr.png) folgt der Stufe: weggerollte Abschnitte sind in Ruhe ausgeblendet (details.js hideAbove).
 * Bewusst NICHT durchscheinend: Band der Suche
 * (einfarbiger Grund, darunter nur angeschnittene Karten) und Jetzt laeuft (ohne Seitenleiste).
 * caps.glassBars (src/platform/platform.js): 'all' = Seitenleiste + Band (TV), 'rail' = nur Seitenleiste und Abdunklung links daneben,
 * unten wie Deckend (Geraete ohne Band; Haken railShown fuer Layouts ohne Leiste), false = nicht angeboten. */
(function (N) {
  var ATTR = 'data-glass', ASSETS = ['rail.png', 'fade-bottom.png', 'fade-frame.png', 'scrim.png', 'scrim-det.png', 'scrim-np.png', 'scrim-hdr.png'];
  var LEVELS = ['off', 'mid', 'strong'], SFX = { mid: '-glass-mid', strong: '-glass' };
  var cur = 'off', railVis = true;
  function has(name) { for (var i = 0; i < ASSETS.length; i++) if (ASSETS[i] === name) return true; return false; }
  function swapAll() {
    if (typeof document === 'undefined' || !document.querySelectorAll) return;
    var l = document.querySelectorAll('img[' + ATTR + ']');
    for (var i = 0; i < l.length; i++) l[i].src = N.assetBase + G.file(l[i].getAttribute(ATTR), cur);
  }
  var G = {
    ASSETS: ASSETS,
    LEVELS: LEVELS,
    /* gespeicherter Wert -> Stufe (rein): true (frueher eine Stufe) = 'strong', unbekannt/fehlend/false = 'off' */
    level: function (v) { return v === true ? 'strong' : LEVELS.indexOf(v) >= 0 ? v : 'off'; },
    /* caps.glassBars -> 'all' | 'rail' | false (true = 'all') */
    mode: function () {
      var c = N.platform && N.platform.caps ? N.platform.caps.glassBars : 'all';
      return c === true || c === undefined || c === 'all' ? 'all' : c === 'rail' ? 'rail' : false;
    },
    current: function () { return cur; },
    on: function () { return cur !== 'off'; },
    /* Dateiname fuer die Stufe lv (rein): bekannte Bilder -> Fassung der Stufe, alles andere unveraendert.
     * mode 'rail': nur die Seitenleiste und die Abdunklungen (deren *-rail-Fassung: links heller, unten wie das Original); die Baender
     * bleiben Original. Seitenleiste verborgen (railShown(false)): alles Original. */
    file: function (name, lv, mode) {
      lv = G.level(lv); mode = mode === undefined ? G.mode() : mode;
      if (lv === 'off' || !has(name) || !mode) return name;
      if (mode === 'rail') {
        if (!railVis || /^fade-/.test(name)) return name;
        return name.replace(/\.png$/, SFX[lv] + (name === 'rail.png' || name === 'scrim-hdr.png' ? '' : '-rail') + '.png');
      }
      return name.replace(/\.png$/, SFX[lv] + '.png');
    },
    /* <img> mit einem Leisten-/Abdunklungsbild versehen (statt el.src = N.assetBase + name) */
    img: function (el, name) {
      el.src = N.assetBase + G.file(name, cur);
      if (has(name) && el.setAttribute) el.setAttribute(ATTR, name);
      return el;
    },
    /* Stufe anwenden: nur bei Wechsel alle gemerkten Bilder tauschen; true = gewechselt */
    apply: function (v) {
      v = G.level(v);
      if (v === cur) return false;
      cur = v;
      swapAll();
      return true;
    },
    /* Plattform-Haken fuer caps.glassBars 'rail': ist die Seitenleiste in einem Layout verborgen, gelten die Originalbilder (kein
     * aufgehellter Streifen ohne Leiste); true = wieder sichtbar. Nur bei Wechsel ein Bild-Tausch, nie im Tastenpfad aufrufen. */
    railShown: function (v) {
      v = v !== false;
      if (v === railVis) return false;
      railVis = v;
      if (G.mode() === 'rail' && cur !== 'off') swapAll();
      return true;
    },
    /* nur mit caps.glassBars 'all' oder 'rail'; sonst bleibt ein gespeicherter Wert wirkungslos */
    avail: function () { return G.mode() !== false; },
    sync: function () { var S = N.session; return G.apply(G.avail() && S && S.settings ? S.settings.glass : 'off'); }
  };
  if (N.evt) {
    N.evt.on('profile:changed', function () { G.sync(); });
    N.evt.on('settings:changed', function (d) { if (d && d.key === 'glass') G.sync(); });
  }
  N.glass = G;
})(N);
