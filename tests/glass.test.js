'use strict';
/* Transparenz der Leisten (SPEC BG-2, Einstellung glass): Bilder (tools/make_assets.js --glass: Groesse, Hoechstwerte,
 * Lesbarkeit auf weissem Bild), Tausch zur Laufzeit (N.glass) und Platz der Einstellung. */
var test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
var H = require('./helpers/load'), eq = H.eq;
var readPng = require('../tools/visual.js').readPng, T = require('../tools/tokens.js');
var ROOT = path.join(__dirname, '..'), A = path.join(ROOT, 'src', 'assets');

function lin(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
function lumRgb(r, g, b) { return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); }
function hex(h) { return [1, 3, 5].map(function (i) { return parseInt(h.substr(i, 2), 16); }); }
var BG = hex(T.color('bg')), TEXT2 = hex(T.color('text-2'));
/* Kontrast von text-2 auf rein weissem Bild unter einer bg-Schicht mit Deckkraft a (Mischung im sRGB-Raum wie der Browser) */
function onWhite(a) {
  var c = BG.map(function (v) { return (1 - a) * 255 + a * v; });
  var l = lumRgb(c[0], c[1], c[2]), t = lumRgb(TEXT2[0], TEXT2[1], TEXT2[2]);
  return (Math.max(l, t) + 0.05) / (Math.min(l, t) + 0.05);
}
function alpha(img, x, y) { return img.px[(y * img.w + x) * 4 + 3] / 255; }
function load(n) { return readPng(path.join(A, n)); }
var BAR = 0.6;

test('Glas-Bilder: je Bild gleich gross wie das deckende, Farbe c.bg (nur der Bild-Tausch, keine neue Ebene)', function () {
  ['rail', 'fade-bottom', 'fade-frame', 'scrim', 'scrim-det', 'scrim-np'].forEach(function (n) {
    var o = load(n + '.png'), g = load(n + '-glass.png');
    eq([g.w, g.h], [o.w, o.h], n);
    assert.deepStrictEqual([g.px[0], g.px[1], g.px[2]], BG, n + ' Farbe');
  });
  assert.strictEqual(T.color('bg-60'), 'rgba(14,15,17,0.6)', 'Hoechstwert = Kasten der Uhr');
});
test('Seitenleiste: gleichmaessig 0,72 (= Boden der Startseite, kein Streifen), text-2-Symbole auf Weiss >= 3:1 auf ihrem Kern x 58..80, laeuft bei x 132 aus', function () {
  var r = load('rail-glass.png');
  assert.ok(Math.abs(alpha(r, 10, 300) - HERO) < 0.01, 'Rand ' + alpha(r, 10, 300));
  assert.ok(Math.abs(alpha(r, 70, 300) - alpha(r, 10, 300)) < 0.01, 'Symbolspalte nicht dunkler als der Rand');
  for (var x = 58; x <= 80; x++) assert.ok(onWhite(alpha(r, x, 300)) >= 3, 'x ' + x + ': ' + onWhite(alpha(r, x, 300)).toFixed(2));
  assert.ok(alpha(r, r.w - 1, 300) < 0.02 && r.w === 132, 'laeuft bei x 132 aus');
  for (x = 0; x <= 96; x++) assert.ok(Math.abs(alpha(r, x, 300) - alpha(r, 0, 300)) < 0.01, 'flach bis x 96 (Symbole x 56..88 ganz auf dem Hintergrund) bei x ' + x);
});
test('Band unten: oben transparent, dann 0,6 und zur Hinweis-Zeile hin ueber die ganze Breite so dunkel, dass text-2 auf Weiss >= 7:1 (TV-Befund, siehe unten)', function () {
  [['fade-bottom-glass.png', 632, 0], ['fade-frame-glass.png', 612, 652]].forEach(function (f) {
    var b = load(f[0]), y0 = f[1];
    assert.ok(alpha(b, 0, 0) < 0.02, f[0] + ' oben');
    if (f[2]) assert.ok(Math.abs(alpha(b, 200, f[2] - y0) - BAR) < 0.1, f[0] + ' etwa 0,6 am Ende der Kurve ' + alpha(b, 200, f[2] - y0));
    for (var x = 144; x <= 1216; x += 8) for (var y = 674; y <= 692; y += 3) {
      assert.ok(onWhite(alpha(b, x, y - y0)) >= 7, f[0] + ' ' + x + ',' + y + ': ' + onWhite(alpha(b, x, y - y0)).toFixed(2));
    }
    // eine Rampe bis zur Hinweis-Zeile, darunter flach (TV-Befund 08.11.: zweite Stufe ganz unten las sich als Streifen)
    for (var yy = 672 - y0; yy < b.h; yy++) assert.ok(Math.abs(alpha(b, 600, yy) - 0.88) <= 0.01, f[0] + ' flach unter der Hinweis-Zeile, y ' + (yy + y0) + ': ' + alpha(b, 600, yy));
    var mx = 0; for (yy = 0; yy < b.h; yy++) { var av = alpha(b, 600, yy); assert.ok(av >= mx - 0.01, f[0] + ' nie heller nach unten'); mx = Math.max(mx, av); }
  });
});
/* Gesamt-Deckkraft an (x, y): Abdunklung + Seitenleiste + Band darueber (so liegen sie in Start/Details/Album/Kuenstler) */
function stack(scrim) {
  var s = load(scrim), r = load('rail-glass.png'), b = load('fade-bottom-glass.png');
  return function (x, y) {
    var f = 1 - (1 - (x < r.w ? alpha(r, x, y) : 0)) * (1 - (y >= 632 ? alpha(b, x, y - 632) : 0));
    return 1 - (1 - f) * (1 - alpha(s, x, y));
  };
}
var TEXT3 = hex(T.color('text-3'));
function onWhiteC(a, col) {
  var c = BG.map(function (v) { return (1 - a) * 255 + a * v; });
  var l = lumRgb(c[0], c[1], c[2]), t = lumRgb(col[0], col[1], col[2]);
  return (Math.max(l, t) + 0.05) / (Math.min(l, t) + 0.05);
}
/* Wo Text ueber dem Bild steht: text-2 >= 4,5:1 und text-3 >= 3:1 auf rein weissem Bild – ausser das Original war dort selbst
 * heller; dann genau so dunkel wie das Original (Regel: nie dunkler als vorher). orig = deckendes Original. */
var NEED = (function () { for (var a = 0; a < 1; a += 0.005) if (onWhiteC(a, TEXT2) >= 4.5 && onWhiteC(a, TEXT3) >= 3) return a; return 1; })();
/* Startseite hinter Hero-Text und Reihen-Ueberschrift (Koordinator 08.11., "nach rechts nie dunkler"): Boden = das Original selbst hinter
 * der Beschreibung (scrim.png bei x 300, y 240, 0,72) – dieselbe Lesbarkeit, die das Original dort schon hat (text-2 4,0:1, text-3
 * 2,25:1 auf rein weissem Bild; auf echten Bildern deutlich mehr) */
var HERO = alpha(load('scrim.png'), 300, 240);
function legible(both, orig, rect, what, cap) {
  for (var y = rect[1]; y <= rect[3]; y += 6) for (var x = rect[0]; x <= rect[2]; x += 8) {
    var a = both(x, y), want = Math.min(cap || NEED, alpha(orig, x, y)) - 0.01;
    assert.ok(a >= want, what + ' ' + x + ',' + y + ': a ' + a.toFixed(2) + ' < ' + want.toFixed(2) + ' (text-2 ' + onWhiteC(a, TEXT2).toFixed(2) + ', text-3 ' + onWhiteC(a, TEXT3).toFixed(2) + ')');
  }
}
test('Glas-Abdunklungen nie dunkler als das Original, an keinem Pixel', function () {
  [['scrim-glass.png', 'scrim.png'], ['scrim-det-glass.png', 'scrim-det.png'], ['scrim-np-glass.png', 'scrim-np.png']].forEach(function (n) {
    var g = load(n[0]), o = load(n[1]), bad = 0, first = '';
    for (var i = 3; i < g.px.length; i += 4) if (g.px[i] > o.px[i]) { if (!bad) first = ((i - 3) / 4 % g.w) + ',' + Math.floor((i - 3) / 4 / g.w); bad++; }
    assert.strictEqual(bad, 0, n[0] + ': ' + bad + ' Pixel dunkler als ' + n[1] + ', erstes bei ' + first);
  });
});
test('Startseite: Hero-Text und Reihen (Ueberschriften, Beschriftungen) lesbar; Raender so hell wie die Leisten', function () {
  var both = stack('scrim-glass.png'), o = load('scrim.png');
  legible(both, o, [144, 72, 784, 310], 'Hero-Text', HERO);
  legible(both, o, [144, 320, 640, 356], 'Ueberschrift der Reihe', HERO);
  legible(both, o, [144, 556, 1272, 636], 'Kartenbeschriftungen + naechste Ueberschrift');
  assert.ok(Math.abs(both(10, 40) - HERO) < 0.02, 'oben links = Boden hinter dem Hero-Text ' + both(10, 40));
  assert.ok(Math.abs(both(10, 300) - both(300, 300)) < 0.02, 'Seitenleiste wie der Inhalt daneben ' + both(10, 300));
  assert.ok(both(300, 676) >= 0.87 && both(300, 676) <= 0.9, 'im Band = Boden unter der Hinweis-Zeile (0,88) ' + both(300, 676));
  assert.ok(both(1200, 100) <= 0.4, 'Bildecke oben rechts bleibt hell ' + both(1200, 100));
  // weich: von Pixel zu Pixel nie ein Sprung (keine Kastenkante)
  for (var y = 0; y < 720; y += 7) for (var x = 1; x < 1280; x++) assert.ok(Math.abs(both(x, y) - both(x - 1, y)) < 0.04, 'Kante waagerecht bei ' + x + ',' + y);
  for (x = 0; x < 1280; x += 11) for (y = 1; y < 720; y++) assert.ok(Math.abs(both(x, y) - both(x, y - 1)) < 0.04, 'Kante senkrecht bei ' + x + ',' + y);
});
test('Details/Album/Kuenstler: Info-Block, Kopf in den Abschnitten und Abschnitte lesbar; Bildecke oben rechts bleibt hell', function () {
  ['scrim-det-glass.png', 'scrim-np-glass.png'].forEach(function (n) {
    var both = stack(n), o = load(n.replace('-glass', ''));
    legible(both, o, [144, 48, 800, 244], n + ' Kopf');
    legible(both, o, [144, 224, 1000, 512], n + ' erster Bildschirm');
    legible(both, o, [144, 320, 1272, 636], n + ' Abschnitte');
  });
  assert.ok(stack('scrim-det-glass.png')(1240, 80) <= 0.5, 'Details: Bild oben rechts sichtbar');
});

/* Keine Delle: entlang einer Spalte (zum Band hin) bzw. Zeile (von der Seitenleiste zum Inhalt) faellt die Gesamt-Deckkraft nie mehr
 * als 0,03 unter das bisherige Maximum (heller Streifen ueber der Hinweisleiste, helle Spalte neben der Seitenleiste; Pruefbefund 08.11.) */
function noDip(vals, what) {
  var mx = 0;
  vals.forEach(function (v, i) { assert.ok(v >= mx - 0.03, what + ' Delle bei Schritt ' + i + ': ' + v.toFixed(2) + ' < ' + mx.toFixed(2)); if (v > mx) mx = v; });
}
test('Glas: keine helle Delle ueber der Hinweisleiste (Spalten x 110/200/400/800, y 600..700) und keine helle Spalte neben der Seitenleiste', function () {
  ['scrim-glass.png', 'scrim-det-glass.png', 'scrim-np-glass.png'].forEach(function (n) {
    var both = stack(n);
    [110, 200, 400, 800].forEach(function (x) { var v = []; for (var y = 600; y <= 700; y++) v.push(both(x, y)); noDip(v, n + ' x ' + x); });
  });
  var h = stack('scrim-glass.png'), d = stack('scrim-det-glass.png');
  [[h, 100, 'Start Hero-Text'], [h, 580, 'Start Beschriftungen'], [d, 400, 'Details erster Bildschirm'], [d, 600, 'Details Abschnitte']].forEach(function (c) {
    var v = []; for (var x = 0; x <= 160; x++) v.push(c[0](x, c[1])); noDip(v, c[2] + ' y ' + c[1]);
  });
});

/* ---------- Drei Stufen (Nutzer 08.11.): Deckend · Leicht durchscheinend (-glass-mid) · Durchscheinend (-glass) ---------- */
var BASES = ['rail', 'fade-bottom', 'fade-frame', 'scrim', 'scrim-det', 'scrim-np'];
function stackLv(scrim, sfx) {   // sfx '' = aus (Originale), '-glass-mid', '-glass'
  var s = load(scrim + sfx + '.png'), r = load('rail' + sfx + '.png'), b = load('fade-bottom' + sfx + '.png');
  return function (x, y) {
    var f = 1 - (1 - (x < r.w ? alpha(r, x, y) : 0)) * (1 - (y >= 632 ? alpha(b, x, y - 632) : 0));
    return 1 - (1 - f) * (1 - alpha(s, x, y));
  };
}
test('Stufen: je Bild gleich gross, und an jedem Pixel Durchscheinend <= Leicht <= Deckend (Original); Baender unter der Seitenleiste zusammen mit ihr', function () {
  BASES.forEach(function (n) {
    var o = load(n + '.png'), m = load(n + '-glass-mid.png'), g = load(n + '-glass.png'), bad = [], band = /^fade-/.test(n);
    eq([m.w, m.h], [o.w, o.h], n);
    for (var i = 3; i < o.px.length; i += 4) {
      var x = (i - 3) / 4 % o.w;
      var py = Math.floor((i - 3) / 4 / o.w);
      // Abdunklungen und Baender unter der Seitenleiste: Reihenfolge gilt fuer die Gesamtwirkung (Test unten), je Bild nur "nie dunkler"
      if (!band && !/^rail/.test(n) || (band && x < 132)) { if (m.px[i] > o.px[i] || g.px[i] > o.px[i]) bad.push(x + ',' + py); continue; }
      if (g.px[i] > m.px[i] || m.px[i] > o.px[i]) { bad.push((i - 3) / 4); if (bad.length > 3) break; }
    }
    assert.strictEqual(bad.length, 0, n + ': Reihenfolge verletzt bei Pixel ' + bad.slice(0, 4).join(', '));
  });
  ['scrim', 'scrim-det', 'scrim-np'].forEach(function (n) {   // Gesamtwirkung: Durchscheinend <= Leicht <= Deckend an jedem Punkt
    var C = ['', '-glass-mid', '-glass'].map(function (sfx) { return stackLv(n, sfx); });
    for (var y = 0; y < 720; y += 4) for (var x = 0; x < 1280; x += 4) {
      var c = C.map(function (f) { return f(x, y); });
      // Toleranz eine 8-Bit-Stufe (Rauschen der Bilder)
      assert.ok(c[2] <= c[1] + 0.005 && c[1] <= c[0] + 0.005, n + ' Gesamtwirkung ' + x + ',' + y + ': ' + c.map(function (v) { return v.toFixed(2); }).join(' / '));
    }
  });
  [['fade-bottom', 632], ['fade-frame', 612]].forEach(function (bb) {
    var L = ['', '-glass-mid', '-glass'].map(function (sfx) { return [load('rail' + sfx + '.png'), load(bb[0] + sfx + '.png')]; });
    for (var y = bb[1]; y < 720; y += 2) for (var x = 0; x < 132; x += 2) {
      var c = L.map(function (l) { return 1 - (1 - alpha(l[0], x, y)) * (1 - alpha(l[1], x, y - bb[1])); });
      assert.ok(c[2] <= c[1] + 0.01 && c[1] <= c[0] + 0.01, bb[0] + ' Ecke ' + x + ',' + y + ': ' + c.map(function (v) { return v.toFixed(2); }).join(' / '));
    }
  });
});
test('Stufen: Leicht liegt sichtbar zwischen Deckend und Durchscheinend (Raster ueber Seitenleiste, Band und Bild)', function () {
  ['scrim', 'scrim-det'].forEach(function (n) {
    var off = stackLv(n, ''), mid = stackLv(n, '-glass-mid'), str = stackLv(n, '-glass'), cnt = 0;
    for (var y = 20; y < 720; y += 40) for (var x = 10; x < 1280; x += 60) {
      var o = off(x, y), m = mid(x, y), s = str(x, y);
      assert.ok(m <= o + 0.01 && m >= s - 0.01, n + ' ' + x + ',' + y + ': aus ' + o.toFixed(2) + ' / leicht ' + m.toFixed(2) + ' / durch ' + s.toFixed(2));
      // links der Inhaltskante (x <= 200) ist jede Zeile flach (nach rechts nie dunkler, keine Flecken an der Leiste): dort liegt mid
      // bei der Mitte aus deckend und durchscheinend AN DER KANTE x 200 – ist das Original dort selbst kaum dunkler als strong (oben auf
      // Details), bleibt mid bei strong. Bewusst; rechts der Kante gilt die Pruefung voll.
      if (x <= 200 && off(200, y) - str(200, y) < 0.08) continue;
      if (y >= 600) continue;   // unten bestimmt das Band (Mindestwerte unter den Hinweisen, eigener Test)
      if (o - s >= 0.08) { cnt++; assert.ok(m < o - 0.02 && m > s + 0.02, n + ' ' + x + ',' + y + ' nicht dazwischen: ' + o.toFixed(2) + ' / ' + m.toFixed(2) + ' / ' + s.toFixed(2)); }
    }
    assert.ok(cnt > 40, n + ': zu wenige Punkte mit Unterschied ' + cnt);
  });
});
/* Ecke unten links (TV-Befund 08.11.: wirkte fast deckend; Nutzer: "ein durchgehender Balken"): Seitenleiste + Band + Abdunklung
 * zusammen in x 0..140 ab y 640 wie das Band daneben (x 200, +-0,02); Mediathek/Live-TV ohne Abdunklung: Leiste + Band = max(beider) */
test('Ecke unten links: alle drei Ebenen zusammen wie das Band daneben (beide Stufen; Start/Details/Kuenstler), Mediathek ohne dunkles Quadrat', function () {
  ['-glass', '-glass-mid'].forEach(function (sfx) {
    ['scrim', 'scrim-det', 'scrim-np'].forEach(function (n) {
      var c = stackLv(n, sfx);
      for (var y = 640; y < 720; y += 2) {
        var ref = c(200, y);
        for (var x = 0; x <= 140; x += 2) assert.ok(Math.abs(c(x, y) - ref) <= 0.02, n + sfx + ' ' + x + ',' + y + ': ' + c(x, y).toFixed(2) + ' statt ' + ref.toFixed(2));
      }
    });
    var r = load('rail' + sfx + '.png'), b = load('fade-frame' + sfx + '.png');
    for (var y = 612; y < 720; y += 2) {
      var band = alpha(b, 200, y - 612);
      for (var x = 0; x < 132; x += 4) {
        var rl = alpha(r, x, y), both = 1 - (1 - rl) * (1 - alpha(b, x, y - 612));
        assert.ok(both <= Math.max(rl, band) + 0.085,   // weiches Maximum (SMAX_K 0,16): hoechstens 0,08 darueber, dafuer ohne Knick
         sfx + ' fade-frame ' + x + ',' + y + ': ' + both.toFixed(2) + ' > max(' + rl.toFixed(2) + ', ' + band.toFixed(2) + ')');
      }
    }
  });
});
/* Knick an der Oberkante des Bands (Pruefbefund 08.11., Stufe mid: Steigung springt bei y ~652): zweite Differenz ueber 3 px klein */
test('Kein Knick am Band: Aenderung der Steigung (3 px) in y 620..700 hoechstens 0,015 (alle Stufen, x 0..400)', function () {
  ['scrim', 'scrim-det'].forEach(function (n) {
    ['-glass', '-glass-mid'].forEach(function (sfx) {
      var c = stackLv(n, sfx);
      for (var x = 0; x <= 400; x += 6) for (var y = 623; y <= 697; y++) {
        var d2 = Math.abs(c(x, y + 3) - 2 * c(x, y) + c(x, y - 3));
        assert.ok(d2 <= 0.015, n + sfx + ' Knick bei ' + x + ',' + y + ': ' + d2.toFixed(3));
      }
    });
  });
});
/* Keine Inseln/Flecken (TV-Befund 08.11. auf satt rotem Hero): nach rechts und nach oben wird die Abdunklung nie dunkler, ausser das
 * Original tut es dort selbst; neben der Seitenleiste in jeder Hoehe dasselbe (Schritt 2 px) */
test('Keine dunklen Inseln: nach rechts (x 144..1280) und nach oben (y 640..0) nie dunkler als das Original es zulaesst; Streifen neben der Seitenleiste gleichmaessig', function () {
  [['scrim', 'Start'], ['scrim-det', 'Details'], ['scrim-np', 'Kuenstler']].forEach(function (p) {
    var off = stackLv(p[0], '');
    ['-glass', '-glass-mid'].forEach(function (sfx) {
      var c = stackLv(p[0], sfx), w = p[1] + sfx;
      for (var y = 100; y <= 640; y += 20) for (var x = 146; x < 1280; x += 2) {
        var up = c(x, y) - c(x - 2, y), ou = Math.max(0, off(x, y) - off(x - 2, y));
        assert.ok(up <= 0.02 + ou, w + ' nach rechts dunkler bei ' + x + ',' + y + ' (+' + up.toFixed(3) + ')');
      }
      for (x = 144; x <= 900; x += 12) for (y = 638; y >= 0; y -= 2) {
        var up2 = c(x, y) - c(x, y + 2), ou2 = Math.max(0, off(x, y) - off(x, y + 2));
        assert.ok(up2 <= 0.02 + ou2, w + ' nach oben dunkler bei ' + x + ',' + y + ' (+' + up2.toFixed(3) + ')');
      }
      // Streifen neben der Leiste (x 110..200) in jeder Hoehe wie der Inhalt daneben (x 220): keine Flecken/Striche entlang der Leiste
      for (x = 110; x <= 200; x += 10) for (y = 80; y <= 620; y += 2) {
        var dv = c(x, y) - c(220, y);
        assert.ok(Math.abs(dv) <= 0.02, w + ' neben der Seitenleiste ' + x + ',' + y + ': ' + c(x, y).toFixed(2) + ' statt ' + c(220, y).toFixed(2));
      }
    });
  });
});
test('Leicht durchscheinend: Text ueber dem Bild ebenso lesbar (Start, Details, Kuenstler)', function () {
  var h = stackLv('scrim', '-glass-mid'), o = load('scrim.png');
  legible(h, o, [144, 72, 784, 310], 'mid Hero-Text', HERO);
  legible(h, o, [144, 556, 1272, 636], 'mid Beschriftungen');
  for (var y = 0; y < 720; y += 7) for (var x = 1; x < 1280; x++) assert.ok(Math.abs(h(x, y) - h(x - 1, y)) < 0.04, 'mid Kante waagerecht bei ' + x + ',' + y);
  for (x = 0; x < 1280; x += 11) for (y = 1; y < 720; y++) assert.ok(Math.abs(h(x, y) - h(x, y - 1)) < 0.04, 'mid Kante senkrecht bei ' + x + ',' + y);
  ['scrim-det', 'scrim-np'].forEach(function (n) {
    var c = stackLv(n, '-glass-mid'), oo = load(n + '.png');
    legible(c, oo, [144, 224, 1000, 512], n + ' mid erster Bildschirm');
    legible(c, oo, [144, 320, 1272, 636], n + ' mid Abschnitte');
  });
});

/* Hero-Textblock ohne Streifen (TV-Befund 08.11., KPop-Hero: dunkler Streifen hinter der Beschreibung – lag im Bild selbst, nicht in
 * der Abdunklung; diese Tests halten fest, dass die Abdunklung dort keine waagerechten Stufen hat). Gilt fuer beide Stufen und beide
 * Fassungen (mit Band 'all', ohne Band 'rail'). Waagerecht faellt schon das Original im Block deutlich ab (0,86 -> 0,45), deshalb nur
 * senkrecht; Kanten in den Spalten hoechstens so stark wie im Original selbst (scrim-det.png hat bei x 600, y ~92 eine Stufe von 0,02). */
function anyStack(scrim, sfx, rail) {
  var s = load(scrim + sfx + (rail ? '-rail' : '') + '.png'), r = load('rail' + sfx + '.png'), b = load('fade-bottom' + sfx + '.png');
  return function (x, y) {
    var f = 1 - (1 - (x < r.w ? alpha(r, x, y) : 0)) * (1 - (!rail && y >= 632 ? alpha(b, x, y - 632) : 0));
    return 1 - (1 - f) * (1 - alpha(s, x, y));
  };
}
test('Hero-Textblock: senkrecht gleichmaessig (x 144..784, y 60..316), keine waagerechten Kanten in den Spalten x 60/300/600 (y 40..340)', function () {
  var oS = load('scrim.png'), oD = load('scrim-det.png'), oN = load('scrim-np.png');
  [['scrim', oS], ['scrim-det', oD], ['scrim-np', oN]].forEach(function (p) {
    ['-glass', '-glass-mid'].forEach(function (sfx) {
      [false, true].forEach(function (rail) {
        var c = anyStack(p[0], sfx, rail), w = p[0] + sfx + (rail ? '-rail' : '');
        if (p[0] === 'scrim') for (var x = 144; x <= 784; x += 8) {
          var lo = 1, hi = 0;
          for (var y = 60; y <= 316; y += 2) { var v = c(x, y); lo = Math.min(lo, v); hi = Math.max(hi, v); }
          assert.ok(hi - lo <= 0.0205, w + ' Hero-Block x ' + x + ' schwankt ' + lo.toFixed(3) + '..' + hi.toFixed(3));
        }
        [60, 300, 600].forEach(function (x) {
          for (var y = 40; y + 6 <= 340; y++) {
            var d = Math.abs(c(x, y + 6) - c(x, y)), od = Math.abs(alpha(p[1], x, y + 6) - alpha(p[1], x, y));
            assert.ok(d <= Math.max(0.015, od + 0.002), w + ' Kante bei ' + x + ',' + y + ': ' + d.toFixed(3) + ' (Original ' + od.toFixed(3) + ')');
          }
        });
      });
    });
  });
});

/* Nach rechts nie dunkler (TV-Befund 08.11., "KPop": hell am Rand, dunkler, wieder heller = Fleck): Gesamtwirkung je Zeile y 0..719,
 * x 0..1280, Toleranz 0,01 – beide Stufen, alle Bildschirme mit Seitenleiste (Start, Details, Kuenstler; Mediathek/Live-TV ohne
 * Abdunklung, mit fade-frame) und beide Fassungen ('all' mit Band, 'rail' ohne). Unten (y 560..719, x 0..400) jede Zeile gleich
 * (Band-Oberkante eine gerade weiche Linie durch die Ecke, keine Kerbe/Dopplung); ganz unten kein Streifen (Spalten x 200/600/1000,
 * y 640..719: Steigungs-Aenderung je 3 px <= 0,01, nach einem flachen Stueck kein Anstieg). */
/* erste Stelle, an der eine Zeile nach rechts dunkler wird (x 0..200 jedes Pixel, danach jedes zweite), oder '' */
function rightDarker(f) {
  for (var y = 0; y < 720; y += 4) {
    var mn = 1;
    for (var x = 0; x < 1280; x += x < 200 ? 1 : 2) { var v = f(x, y); if (v > mn + 0.01) return x + ',' + y + ': ' + v.toFixed(3) + ' > ' + mn.toFixed(3); mn = Math.min(mn, v); }
  }
  return '';
}
test('Selbstpruefung: eine 1 px breite, um 0,03 dunklere Spalte wird erkannt (an der Leiste und im Bild)', function () {
  var f = anyStack('scrim', '-glass', false);
  [100, 150, 199, 600].forEach(function (cx) {
    var g = function (x, y) { return f(x, y) + (x === cx ? 0.03 : 0); };
    assert.ok(rightDarker(g) !== '', 'Spalte bei x ' + cx + ' nicht erkannt');
  });
  assert.strictEqual(rightDarker(f), '');
});
function frameStack(sfx) { var r = load('rail' + sfx + '.png'), b = load('fade-frame' + sfx + '.png'); return function (x, y) { return 1 - (1 - (x < r.w ? alpha(r, x, y) : 0)) * (1 - (y >= 612 ? alpha(b, x, y - 612) : 0)); }; }
test('Gesamtwirkung nach rechts nie dunkler (alle Zeilen), unten jede Zeile gleich, ganz unten kein Streifen', function () {
  var cases = [];
  ['-glass', '-glass-mid'].forEach(function (sfx) {
    ['scrim', 'scrim-det', 'scrim-np'].forEach(function (n) { cases.push([n + sfx, anyStack(n, sfx, false), true]); cases.push([n + sfx + '-rail', anyStack(n, sfx, true), false]); });
    cases.push(['fade-frame' + sfx, frameStack(sfx), false]);
  });
  cases.forEach(function (c) {
    var f = c[1];
    var bad = rightDarker(f); assert.strictEqual(bad, '', c[0] + ' nach rechts dunkler bei ' + bad);
    var x, y;
    if (!c[2]) return;   // gleiche Zeilen und Spalten ganz unten: Bildschirme mit Band und Abdunklung
    for (y = 560; y < 720; y += 2) { var lo = 1, hi = 0; for (x = 0; x <= 400; x += 2) { var w = f(x, y); lo = Math.min(lo, w); hi = Math.max(hi, w); } assert.ok(hi - lo <= 0.02, c[0] + ' Zeile ' + y + ' ungleich ' + lo.toFixed(3) + '..' + hi.toFixed(3)); }
    [200, 600, 1000].forEach(function (x) {
      for (var y = 643; y <= 716; y++) { var d2 = Math.abs(f(x, y + 3) - 2 * f(x, y) + f(x, y - 3)); assert.ok(d2 <= 0.01, c[0] + ' Knick unten bei ' + x + ',' + y + ': ' + d2.toFixed(3)); }
      var flat = 0; for (y = 641; y < 720; y++) { var dy = f(x, y) - f(x, y - 1); if (Math.abs(dy) < 0.002) flat++; else if (dy > 0.004 && flat >= 6) assert.fail(c[0] + ' Anstieg nach flachem Stueck bei ' + x + ',' + y); }
    });
  });
});

/* Hinweisleiste (y 668..696, Text ~674..692) ueber Weiss: text-2 mindestens 7:1 – berechnet waren 4,5:1 bei 0,76 genug, am TV
 * (Gamma, helleres Panel, Kamera) waren weisse Senderkacheln unter "OK Ansehen" in Live-TV und Mediathek trotzdem kaum lesbar
 * (TV-Befund 08.11.). Gilt fuer beide Stufen und beide Baender (fade-bottom: Start/Details/…, fade-frame: Mediathek/Live-TV). */
test('Hinweisleiste auf Weiss: text-2 >= 7:1 unter dem Text (beide Stufen, beide Baender), Durchscheinend >= 0,88, Leicht >= 0,94', function () {
  [['-glass', 0.88], ['-glass-mid', 0.94]].forEach(function (lv) {
    [['fade-bottom', 632], ['fade-frame', 612]].forEach(function (bb) {
      var b = load(bb[0] + lv[0] + '.png');
      for (var y = 674; y <= 696; y += 2) for (var x = 144; x <= 1216; x += 8) {
        var a = alpha(b, x, y - bb[1]);
        assert.ok(a >= lv[1] - 0.01, bb[0] + lv[0] + ' ' + x + ',' + y + ': ' + a.toFixed(3) + ' < ' + lv[1]);
        assert.ok(onWhite(a) >= 7, bb[0] + lv[0] + ' Kontrast ' + onWhite(a).toFixed(2));
      }
    });
  });
});

/* Details: ueber dem Info-Block kein Kasten (TV-Befund 08.11., ruhiges helles Bild): die Abdunklung steigt von y 0 bis zum Block lang
 * und gleichmaessig an – je 10 px hoechstens 0,03 (Spalten x 200..1100, y 0..200; alle Stufen, auch Deckend). */
test('Details: Abdunklung ueber dem Info-Block steigt sanft (je 10 px <= 0,03, alle Stufen)', function () {
  ['scrim-det', 'scrim-np'].forEach(function (n) {
    ['', '-glass-mid', '-glass'].forEach(function (sfx) {
      var c = sfx ? anyStack(n, sfx, false) : stackLv(n, '');
      for (var x = 200; x <= 1100; x += 20) for (var y = 0; y + 10 <= 200; y += 2) {
        var d = c(x, y + 10) - c(x, y);
        assert.ok(d <= 0.03, n + sfx + ' Anstieg ' + x + ',' + y + ': ' + d.toFixed(3));
        assert.ok(d >= -0.01, n + sfx + ' nach unten heller ' + x + ',' + y);
      }
    });
  });
});
/* Kopfband in den Abschnitten (scrim-hdr, gedreht, 288 px hoch, Deckkraft 0,92) ueber der Abdunklung: Kopftext lesbar, nach rechts nie
 * dunkler, Stufen-Reihenfolge, weicher unterer Auslauf (kein Kasten) */
function hdrStack(sfx) {
  var s = load('scrim-det' + sfx + '.png'), r = load('rail' + sfx + '.png'), h = load('scrim-hdr' + sfx + '.png');
  return function (x, y) {
    var hy = Math.floor((288 - 1 - y) * 88 / 288), ha = y < 288 ? 0.92 * alpha(h, 1279 - x, Math.max(0, Math.min(87, hy))) : 0;
    return 1 - (1 - (x < r.w ? alpha(r, x, y) : 0)) * (1 - ha) * (1 - alpha(s, x, y));
  };
}
test('Kopfband Details: Kopftext lesbar, nach rechts nie dunkler, Durchscheinend <= Leicht <= Deckend, weicher Auslauf unten', function () {
  var C = ['', '-glass-mid', '-glass'].map(hdrStack);
  for (var y = 40; y <= 190; y += 6) for (var x = 144; x <= 800; x += 8) {
    [1, 2].forEach(function (k) { assert.ok(onWhiteC(C[k](x, y), TEXT2) >= 4.5, 'Kopftext ' + k + ' ' + x + ',' + y + ': ' + C[k](x, y).toFixed(2)); });
  }
  for (y = 0; y < 300; y += 4) {
    for (k = 0; k < 3; k++) { var mn = 1; for (x = 0; x < 1280; x += 2) { var v = C[k](x, y); assert.ok(v <= mn + 0.01, 'Kopf ' + k + ' nach rechts dunkler ' + x + ',' + y); mn = Math.min(mn, v); } }
    for (x = 0; x < 1280; x += 16) { var c = [C[0](x, y), C[1](x, y), C[2](x, y)]; assert.ok(c[2] <= c[1] + 0.005 && c[1] <= c[0] + 0.005, 'Kopf Stufen ' + x + ',' + y + ': ' + c.map(function (q) { return q.toFixed(2); }).join('/')); }
  }
  var k;
  for (k = 1; k < 3; k++) for (x = 200; x <= 1000; x += 100) for (y = 190; y + 10 <= 300; y++) { var d = Math.abs(C[k](x, y + 10) - C[k](x, y)); assert.ok(d <= 0.09, 'Kopf ' + k + ' Kante unten ' + x + ',' + y + ': ' + d.toFixed(3)); }
});

/* Fliessende Uebergaenge ueberall (Nutzer 08.11.: "wo moeglich wirklich fliessend, besonders mit Transparenz"): zweite Differenz der
 * Gesamtwirkung (Abstand 3 px, 3x3-Mittel gegen das Rauschen der Bilder) an JEDEM zweiten Punkt, waagerecht und senkrecht, fuer alle
 * Bildschirme mit Leisten. Grenze 0,02 mit Abdunklung; Mediathek/Live-TV (Seitenleiste und Band ohne Abdunklung, zwei sich kreuzende
 * Ausläufe) 0,05 – der Auslauf der Seitenleiste allein liegt dort schon bei 0,03, Deckend bei 0,04. */
function fullStack(scr, sfx, frame) {
  var s = scr ? load(scr + sfx + '.png') : null, r = load('rail' + sfx + '.png'), b = load((frame ? 'fade-frame' : 'fade-bottom') + sfx + '.png'), y0 = frame ? 612 : 632;
  var c = new Float64Array(1280 * 720);
  for (var y = 0; y < 720; y++) for (var x = 0; x < 1280; x++) {
    var f = 1 - (1 - (x < r.w ? alpha(r, x, y) : 0)) * (1 - (y >= y0 ? alpha(b, x, y - y0) : 0));
    c[y * 1280 + x] = 1 - (1 - f) * (1 - (s ? alpha(s, x, y) : 0));
  }
  return function (x, y) { var t = 0, n = 0; for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) { var xx = x + dx, yy = y + dy; if (xx >= 0 && xx < 1280 && yy >= 0 && yy < 720) { t += c[yy * 1280 + xx]; n++; } } return t / n; };
}
test('Fliessend: zweite Differenz der Gesamtwirkung ueberall klein (alle Glas-Bildschirme, waagerecht und senkrecht)', function () {
  [['scrim', false, 0.02], ['scrim-det', false, 0.02], ['scrim-np', false, 0.02], [null, true, 0.05]].forEach(function (p) {
    ['-glass', '-glass-mid'].forEach(function (sfx) {
      var f = fullStack(p[0], sfx, p[1]), w = (p[0] || 'fade-frame') + sfx;
      for (var y = 4; y < 716; y += 2) for (var x = 4; x < 1276; x += 2) {
        var h = Math.abs(f(x - 3, y) - 2 * f(x, y) + f(x + 3, y)), v = Math.abs(f(x, y - 3) - 2 * f(x, y) + f(x, y + 3));
        assert.ok(h <= p[2] && v <= p[2], w + ' Knick bei ' + x + ',' + y + ': waagerecht ' + h.toFixed(3) + ', senkrecht ' + v.toFixed(3));
      }
    });
  });
});

/* Kopfband beim Blaettern (Pruefbefund 08.11.): Reihen laufen kurz unter dem Kopf durch – hinter dem Kopftext (x 144..800, y 40..190)
 * deckt das Band (0,92 x Bild) so wie Deckend: Durchschein hoechstens 10 % (Durchscheinend) bzw. 8,5 % (Leicht) */
test('Kopfband: hinter dem Kopftext kaum Durchschein von darunter laufenden Reihen (<= 10 % / 8,5 %)', function () {
  [['-glass', 0.90], ['-glass-mid', 0.915]].forEach(function (lv) {
    var h = load('scrim-hdr' + lv[0] + '.png');
    for (var y = 40; y <= 190; y += 5) for (var x = 144; x <= 800; x += 8) {
      var a = 0.92 * alpha(h, 1279 - x, Math.floor((287 - y) * 88 / 288));
      assert.ok(a >= lv[1], lv[0] + ' ' + x + ',' + y + ': ' + a.toFixed(3));
    }
  });
});

/* Detailseite: nach einem Neuaufbau der Reihen (Laden, Rueckkehr aus der Wiedergabe) sofort hideAbove – sonst laegen Reihen bis zur
 * naechsten Taste sichtbar unter dem (durchscheinenden) Kopfband (Pruefbefund 08.11.). Quelltext-Pruefung: jeder Aufbau endet damit. */
test('Details: buildRows blendet Reihen ueber dem Kopf sofort aus (hideAbove(true)), hideAbove kennt das sofortige Ausblenden', function () {
  var src = fs.readFileSync(path.join(ROOT, 'src', 'views', 'details.js'), 'utf8');
  var m = /function buildRows\(\) \{([\s\S]*?)\n    \}/.exec(src);
  assert.ok(m && /hideAbove\(true\);[^\n]*\s*$/.test(m[1]), 'buildRows endet mit hideAbove(true)');
  assert.ok(/function hideAbove\(now\)[\s\S]*?if \(now\) \{[^}]*U\.show\(hide\[i\], false\)/.test(src), 'hideAbove(now) blendet sofort aus');
  assert.strictEqual((src.match(/buildRows\(\);/g) || []).length >= 2, true, 'Aufbau-Wege gefunden');
});

/* Startseite: steht unten der feste Hinweis "darunter: …" (HOME-11), ist der echte Kopf der naechsten Reihe ausgeblendet – sonst schimmert
 * er durch das durchscheinende Band doppelt unter dem Hinweis (TV-Befund 08.11., TCL) */
test('Startseite: Kopf der naechsten Reihe aus, solange der Hinweis unten steht (Klasse hd-off, nur bei Wechsel)', function () {
  var src = fs.readFileSync(path.join(ROOT, 'src', 'views', 'home.js'), 'utf8'), css = fs.readFileSync(path.join(ROOT, 'src', 'css', 'app.css'), 'utf8');
  var m = /function markMore\(\) \{([\s\S]*?)\n    \}/.exec(src);
  assert.ok(m, 'markMore gefunden');
  assert.ok(/if \(on\) for \(var j = 0; j < SLOTS; j\+\+\) if \(slotRow\[j\] === R \+ 1\) nh = slots\[j\]\.head;/.test(m[1]), 'Kopf der Reihe R+1 waehrend des Hinweises');
  assert.ok(/if \(nh !== cueHead\)/.test(m[1]), 'nur bei Wechsel');
  assert.ok(/\.row-head\.hd-off \{ visibility: hidden !important; \}/.test(css), 'CSS-Klasse');
});

/* ---------- Plattform: caps.glassBars 'all' (TV) | 'rail' (nur Seitenleiste) | false ---------- */
test('caps.glassBars: Fernseher und Android TV all, Apple vorerst aus; aus = Zeile fehlt und ein gespeicherter Wert wirkt nicht', function () {
  assert.strictEqual(H.load().N.platform.caps.glassBars, 'all');
  /* Plattform-Adapter fehlen im oeffentlichen Export (android-tv, apple) -> dort nur der Kern */
  function has(id) { return fs.existsSync(path.join(ROOT, 'platforms', id, 'adapter')); }
  if (has('android-tv')) assert.strictEqual(H.load({ platform: 'android-tv' }).N.glass.mode(), 'all');
  if (has('apple')) {
    var A = H.load({ platform: 'apple' }).N;
    assert.strictEqual(A.platform.caps.glassBars, false);
    var S = A.session, old = S.settings;
    try {
      S.settings = { glass: 'strong' };
      assert.strictEqual(A.glass.avail(), false);
      A.glass.sync();
      assert.strictEqual(A.glass.on(), false, 'gespeichertes An wird auf Apple ignoriert');
    } finally { S.settings = old; }
  }
  var src = fs.readFileSync(path.join(ROOT, 'src', 'views', 'settings.js'), 'utf8');
  assert.ok(/function glassRow\(\) \{\s*if \(!N\.glass\.avail\(\)\) return null;/.test(src), 'Zeile nur mit caps.glassBars');
  var P = H.load().N.Platform, base = P.defaults();
  function errs(v) { var c = JSON.parse(JSON.stringify(base)); c.glassBars = v; return P.check({ id: 'x', caps: c }).filter(function (e) { return /glassBars/.test(e); }); }
  ['all', 'rail', false, true].forEach(function (v) { eq(errs(v), [], 'gueltig: ' + v); });
  assert.strictEqual(errs('band').length, 1, 'ungueltiger Wert wird gemeldet');
});
/* 'rail': Seitenleiste + Abdunklung links heller, rechts (x >= 480) und unten (y >= 660) genau das Original, nie dunkler, keine Inseln */
function railStack(scrim, sfx) {   // sfx '' = Original, '-glass' / '-glass-mid' = Stufe; ohne Band (Geraete ohne Band)
  var s = load(scrim + (sfx ? sfx + '-rail' : '') + '.png'), r = load('rail' + sfx + '.png');
  return function (x, y) { return 1 - (1 - (x < r.w ? alpha(r, x, y) : 0)) * (1 - alpha(s, x, y)); };
}
test('rail-Fassungen: gleich gross, nie dunkler als das Original, unten (ab y 660) genau das Original', function () {
  ['scrim', 'scrim-det', 'scrim-np'].forEach(function (n) {
    var o = load(n + '.png'), m = load(n + '-glass-mid-rail.png'), g = load(n + '-glass-rail.png');
    eq([g.w, g.h, m.w, m.h], [o.w, o.h, o.w, o.h], n);
    var bad = 0, same = 0;
    for (var i = 3; i < o.px.length; i += 4) {
      var x = (i - 3) / 4 % o.w, y = Math.floor((i - 3) / 4 / o.w);
      if (g.px[i] > o.px[i] || m.px[i] > o.px[i]) bad++;   // Reihenfolge strong <= mid: Gesamtwirkung (Test 'rail-Fassungen: links …')
      if (y >= 660 && (g.px[i] !== o.px[i] || m.px[i] !== o.px[i])) same++;   // unten wie Deckend (rechts gilt: nach rechts nie dunkler)
    }
    assert.strictEqual(bad, 0, n + ': Reihenfolge verletzt (' + bad + ')');
    assert.strictEqual(same, 0, n + ': unten nicht wie das Original (' + same + ')');
  });
});
test('rail-Fassungen: links sichtbar heller, Text lesbar, keine Inseln (nach rechts/oben), Streifen neben der Leiste gleichmaessig', function () {
  [['scrim', [[144, 72, 784, 310, HERO], [144, 556, 1272, 560]]], ['scrim-det', [[144, 224, 1000, 512], [144, 320, 1272, 560]]]].forEach(function (p) {
    var off = railStack(p[0], ''), o = load(p[0] + '.png');
    ['-glass', '-glass-mid'].forEach(function (sfx) {
      var c = railStack(p[0], sfx), w = p[0] + sfx + '-rail';
      assert.ok(c(20, 300) < off(20, 300) - 0.1, w + ': Seitenleiste nicht heller ' + c(20, 300).toFixed(2));
      p[1].forEach(function (r) { legible(c, o, r, w, r[4]); });
      for (var y = 100; y <= 640; y += 20) for (var x = 146; x < 1280; x += 2) {
        var up = c(x, y) - c(x - 2, y), ou = Math.max(0, off(x, y) - off(x - 2, y));
        assert.ok(up <= 0.02 + ou, w + ' nach rechts dunkler bei ' + x + ',' + y + ' (+' + up.toFixed(3) + ')');
      }
      for (x = 144; x <= 900; x += 12) for (y = 716; y >= 0; y -= 2) {
        var up2 = c(x, y) - c(x, y + 2), ou2 = Math.max(0, off(x, y) - off(x, y + 2));
        assert.ok(up2 <= 0.02 + ou2, w + ' nach oben dunkler bei ' + x + ',' + y + ' (+' + up2.toFixed(3) + ')');
      }
      // Streifen neben der Leiste (x 110..200) in jeder Hoehe wie der Inhalt daneben (x 220): keine Flecken/Striche entlang der Leiste
      for (x = 110; x <= 200; x += 10) for (y = 80; y <= 620; y += 2) {
        var dv = c(x, y) - c(220, y);
        assert.ok(Math.abs(dv) <= 0.02, w + ' neben der Seitenleiste ' + x + ',' + y + ': ' + c(x, y).toFixed(2) + ' statt ' + c(220, y).toFixed(2));
      }
      for (y = 0; y < 720; y += 7) for (x = 1; x < 1280; x++) assert.ok(Math.abs(c(x, y) - c(x - 1, y)) < 0.04, w + ' Kante bei ' + x + ',' + y);
      for (x = 0; x < 1280; x += 11) for (y = 1; y < 720; y++) assert.ok(Math.abs(c(x, y) - c(x, y - 1)) < 0.04, w + ' Kante senkrecht bei ' + x + ',' + y);
    });
  });
});
test('N.glass mode rail: Baender bleiben Original, Abdunklungen -rail, Seitenleiste verborgen (railShown false) = alles Original', function () {
  var R = H.load().N;
  R.platform.caps.glassBars = 'rail';
  assert.strictEqual(R.glass.mode(), 'rail');
  eq(R.glass.file('rail.png', 'strong'), 'rail-glass.png');
  eq(R.glass.file('scrim.png', 'mid'), 'scrim-glass-mid-rail.png');
  eq(R.glass.file('scrim-det.png', 'strong'), 'scrim-det-glass-rail.png');
  eq(R.glass.file('fade-bottom.png', 'strong'), 'fade-bottom.png');
  eq(R.glass.file('fade-frame.png', 'mid'), 'fade-frame.png');
  ['scrim', 'scrim-det', 'scrim-np'].forEach(function (n) { ['strong', 'mid'].forEach(function (l) { assert.ok(fs.existsSync(path.join(A, R.glass.file(n + '.png', l))), n + l); }); });
  var rc = H.load(), RN = rc.N, imgs = [];
  RN.platform.caps.glassBars = 'rail'; RN.assetBase = 'a/';
  function Img() { this.attrs = {}; this.src = ''; }
  Img.prototype.setAttribute = function (k, v) { this.attrs[k] = v; };
  Img.prototype.getAttribute = function (k) { return this.attrs[k]; };
  rc.document = { querySelectorAll: function () { return imgs; } };
  RN.glass.apply('strong');
  var sc = RN.glass.img(new Img(), 'scrim.png'), rl = RN.glass.img(new Img(), 'rail.png'), fb = RN.glass.img(new Img(), 'fade-bottom.png');
  imgs.push(sc, rl, fb);
  eq([sc.src, rl.src, fb.src], ['a/scrim-glass-rail.png', 'a/rail-glass.png', 'a/fade-bottom.png']);
  assert.strictEqual(RN.glass.railShown(false), true);
  eq([sc.src, rl.src, fb.src], ['a/scrim.png', 'a/rail.png', 'a/fade-bottom.png'], 'Leiste verborgen: alles Original');
  assert.strictEqual(RN.glass.railShown(false), false, 'gleicher Wert: kein Tausch');
  RN.glass.railShown(true);
  eq(sc.src, 'a/scrim-glass-rail.png');
});

/* ---------- Laufzeit ---------- */
var ctx = H.load(), N = ctx.N;
N.log = function () {};
test('N.glass.file: nur die verwalteten Bilder (N.glass.ASSETS) bekommen die Glas-Fassung, aus = unveraendert', function () {
  eq(N.glass.file('rail.png', true), 'rail-glass.png');
  eq(N.glass.file('scrim-det.png', true), 'scrim-det-glass.png');
  eq(N.glass.file('rail.png', false), 'rail.png');
  eq(N.glass.file('scrim-hdr.png', true), 'scrim-hdr-glass.png', 'Kopfband der Details folgt der Stufe');
  eq(N.glass.file('scrim-hdr.png', 'mid', 'rail'), 'scrim-hdr-glass-mid.png', 'auch ohne Band (rail)');
  eq(N.glass.file('scrim-saver.png', true), 'scrim-saver.png', 'andere Bilder unveraendert');
  N.glass.ASSETS.forEach(function (n) { assert.ok(fs.existsSync(path.join(A, N.glass.file(n, true))), n); });
});
test('N.glass: img merkt das Bild, Einstellung und Profilwechsel tauschen nur die gemerkten Quellen, sofort', function () {
  function Img() { this.attrs = {}; this.src = ''; }
  Img.prototype.setAttribute = function (k, v) { this.attrs[k] = v; };
  Img.prototype.getAttribute = function (k) { return this.attrs[k]; };
  var imgs = [], S = N.session, old = { settings: S.settings };
  ctx.document = { querySelectorAll: function (q) { assert.strictEqual(q, 'img[data-glass]'); return imgs.filter(function (i) { return i.attrs['data-glass']; }); } };
  N.assetBase = 'a/';
  try {
    S.settings = {};
    N.glass.sync();
    var rail = N.glass.img(new Img(), 'rail.png'), hdr = N.glass.img(new Img(), 'scrim-clock.png');   // nicht verwaltetes Bild
    imgs.push(rail, hdr);
    eq([rail.src, hdr.src], ['a/rail.png', 'a/scrim-clock.png']);
    assert.strictEqual(hdr.attrs['data-glass'], undefined);
    S.settings.glass = true;
    N.evt.emit('settings:changed', { key: 'glass', value: true });
    eq([rail.src, hdr.src], ['a/rail-glass.png', 'a/scrim-clock.png']);
    var later = N.glass.img(new Img(), 'fade-bottom.png');   // neu aufgebaute Ansicht: gleich mit Glas
    eq(later.src, 'a/fade-bottom-glass.png');
    assert.strictEqual(N.glass.apply(true), false, 'gleicher Wert: kein DOM-Zugriff');
    S.settings = {};
    N.evt.emit('profile:changed', {});
    eq(rail.src, 'a/rail.png');
  } finally { S.settings = old.settings; N.glass.apply(false); delete ctx.document; }
});
test('Einstellung: Startseite & Aussehen, direkt hinter "Stärke des Hintergrunds", vor "Uhrzeit anzeigen"; Texte in de/en/nb', function () {
  var src = fs.readFileSync(path.join(ROOT, 'src', 'views', 'settings.js'), 'utf8');
  assert.ok(/concat\(libBgRows\(\), \[glassRow\(\), toggle\('clock'\)/.test(src));
  ['de', 'en', 'nb'].forEach(function (l) {
    N.i18n.set(l);
    ['set.glass', 'set.glass.desc', 'help.glass'].forEach(function (k) { assert.ok(N.t(k) && N.t(k) !== k, l + ' ' + k); });
  });
  N.i18n.set('de');
});
