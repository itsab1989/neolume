#!/usr/bin/env node
/* erzeugt die statischen Bilder in src/assets/ (einmalig bzw. bei Aenderungen; Ergebnis wird eingecheckt).
 *   node tools/make_assets.js
 * - icons.png      PNG-Sprite (SPEC 5.21): 32-px-Raster, Spalte = Icon, Zeile = Farbzustand (Quelle design/icons/*.svg, + icons.svg/.json)
 * - fade-bottom.png 1280x88 (SPEC 2: transparent bei y 632 -> deckend ab y 652; Start, Details, Suche, Album, Kuenstler, DetHero-Kopfband)
 * - fade-frame.png 1280x108 Band unten der Mediathek (transparent bei y 612 -> deckend ab y 652, smoothstep ueber 40 px = rail.png)
 * - rail.png       132x720 Seitenleiste (deckend c.bg bis x 96 -> smootherstep auf 0 bei x 132; Nutzer am TV 08.11.: Symbole x 56..88
 *                  zusammen ein Rahmen mit weicher Ecke unten links, siehe "Rahmen links + unten")
 * - scrim-hdr.png  1280x88 Kopfband Film/Serie in den Abschnitten: wie fade-bottom, nach rechts auf 30 % auslaufend
 * - all-grid.png   48x48 Raster-Symbol der Karte "Alle anzeigen" (HOME-14), Form aus design/icons/grid.svg, Farbe c.text-1
 * - qr.png         264x264 QR-Code fuer https://plex.tv/link (Inhalt ist fest -> kein QR-Code zur Laufzeit)
 * - scrim.png      wird aus app/scrim.png uebernommen (am TV abgestimmte Ueberblendmaske)
 * - <pointer>[-press].png  Smart-Control-Zeiger je Marke und pointer-<id>[-press].png je Akzentfarbe der Palette
 *                  (src/core/accent.js; siehe unten; --pointers erzeugt nur diese). Einziges Bild in der Akzentfarbe:
 *                  icons.png, rail.png, fade/scrims und qr.png sind farbneutral (Icons auf dem Akzent: Zeile on-accent).
 * - scrim-det.png  1280x720 Detailseiten (DetHero): scrim.png + kraeftigere Abdunklung hinter Titel/Infos/Beschreibung
 *                  (TV-Test 27.10., F5/F17: Text auf hellen Hintergruenden lesbar); eine Ebene statt zwei
 * - scrim-np.png   1280x720 Jetzt laeuft + Kuenstlerseite: scrim-det.png + gleichmaessige Abdunklung (F24: weisse Fotos hinter weissem Text)
 *                  Nur die Scrims neu erzeugen: node tools/make_assets.js --scrims
 * - scrim-saver*.png Bildschirmschoner-Einblendungen (siehe saverScrims; Eck-Schatten je Ecke fertig gespiegelt); nur diese: node tools/make_assets.js --saver
 * - saver-shadow[-sq].png Schatten unter dem Plakat im Schoner-Modus "Poster und Cover" (entsteht mit den Schoner-Scrims)
 * - scrim-clock.png weicher Eckschatten hinter der Startseiten-Uhr ohne Kasten (entsteht mit den Schoner-Scrims)
 * - *-glass[-mid][-rail].png Fassungen der Stufen von rail, fade-bottom, fade-frame, scrim, scrim-det, scrim-np (SPEC BG-2, gleiche
 *                  Groesse); nur diese: node tools/make_assets.js --glass
 * Braucht: rsvg-convert (Homebrew librsvg) fuer den Sprite, npm-Paket qrcode.
 */
'use strict';
var fs = require('fs'), path = require('path'), zlib = require('zlib'), cp = require('child_process');
var ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'src', 'assets');
var T = require('./tokens.js'), BG_HEX = T.color('bg'), QR_LIGHT = T.color('white');   // Farben aus design/tokens.json
fs.mkdirSync(OUT, { recursive: true });

/* ---------- Zeiger (Smart Control): Pfeil in der Akzentfarbe, 2 px dunkle Kontur, Spitze bei (4,4) ----------
 * Je Palettenfarbe pointer-<id>.png + pointer-<id>-press.png (gedrueckt: 30 % zu Weiss aufgehellt), danach je Marken-Profil
 * (brand/*.json: pointer, accent, accentPress) <pointer>.png + <pointer>-press.png fuer ihre Standardfarbe (ueberschreibt
 * gleichnamige Palettenbilder, z. B. pointer-teal).
 * Nur die Zeiger neu erzeugen: node tools/make_assets.js --pointers */
function arrowSvg(fill) {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path d="M4 4 L4 26 L10 20.5 L14.2 29.5 L18.6 27.5 L14.4 18.6 L22 18.6 Z" ' +
    'fill="' + fill + '" stroke="' + BG_HEX + '" stroke-width="2" stroke-linejoin="round"/></svg>';
}
function lighten(hex, f) {
  return '#' + [1, 3, 5].map(function (i) { var v = parseInt(hex.substr(i, 2), 16); return ('0' + Math.round(v + (255 - v) * f).toString(16)).slice(-2); }).join('').toUpperCase();
}
var ptrs = [];
T.palette().forEach(function (p) { ptrs.push(['pointer-' + p.id, p.color, lighten(p.color, 0.3)]); });
fs.readdirSync(path.join(ROOT, 'brand')).filter(function (f) { return /\.json$/.test(f); }).forEach(function (f) {
  var b = JSON.parse(fs.readFileSync(path.join(ROOT, 'brand', f), 'utf8'));
  ptrs.push([b.pointer, b.accent, b.accentPress]);
});
/* ---------- all-grid.png: Raster-Symbol der Karte "Alle anzeigen" (HOME-14) in 48 x 48 (nur die vier Quadrate, ohne Rand) ----------
 * TV-Test 30.10.: das 32er Sprite-Symbol (sichtbar 18 px) wirkte aus 3 m klein und leer; hochskaliert waere es unscharf. Gleiche
 * Form wie design/icons/grid.svg, Farbe Token c.text-1. Nur dieses: node tools/make_assets.js --allgrid */
function allGrid() {
  var svg = T.allGridSvg();
  var t = path.join(require('os').tmpdir(), 'neo-all-grid.svg');
  fs.writeFileSync(t, svg);
  try { cp.execFileSync('rsvg-convert', ['-o', path.join(OUT, 'all-grid.png'), t]); } catch (e) { console.error('rsvg-convert fehlt – all-grid.png'); }
}
if (process.argv.indexOf('--allgrid') >= 0) { allGrid(); process.exit(0); }
var ONLY_GLASS = process.argv.indexOf('--glass') >= 0;   // --glass schreibt nur die sechs *-glass.png (keine Zeiger, kein Raster-Symbol)
if (process.argv.indexOf('--saver') < 0 && !ONLY_GLASS) allGrid();
if (process.argv.indexOf('--saver') < 0 && !ONLY_GLASS) ptrs.forEach(function (b) {
  [[b[0] + '.png', b[1]], [b[0] + '-press.png', b[2]]].forEach(function (p) {
    var t = path.join(require('os').tmpdir(), 'neo-' + p[0] + '.svg');
    fs.writeFileSync(t, arrowSvg(p[1]));
    try { cp.execFileSync('rsvg-convert', ['-o', path.join(OUT, p[0]), t]); } catch (e) { console.error('rsvg-convert fehlt – ' + p[0]); }
  });
});
if (process.argv.indexOf('--pointers') >= 0) process.exit(0);

/* ---------- minimaler PNG-Encoder (RGBA) ---------- */
var CRC = (function () { var t = [], c, n, k; for (n = 0; n < 256; n++) { c = n; for (k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { var c = 0xFFFFFFFF; for (var i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function chunk(type, data) {
  var len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  var td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  var crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, pixel) {   // pixel(x,y) -> [r,g,b,a]
  var raw = Buffer.alloc((w * 4 + 1) * h), o = 0;
  for (var y = 0; y < h; y++) { raw[o++] = 0; for (var x = 0; x < w; x++) { var p = pixel(x, y); raw[o++] = p[0]; raw[o++] = p[1]; raw[o++] = p[2]; raw[o++] = p[3]; } }
  var ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
var BG = [1, 3, 5].map(function (i) { return parseInt(BG_HEX.substr(i, 2), 16); });   // Token c.bg

if (process.argv.indexOf('--scrims') >= 0) { scrimDet(); scrimNp(); saverScrims(); process.exit(0); }
if (process.argv.indexOf('--saver') >= 0) { saverScrims(); process.exit(0); }

/* ---------- Bildschirmschoner: Abdunklungen der Einblendungen (core/saverlogic.js INFO), schwarz mit weichem Alpha ----------
 * Zusammen mit der Bild-Abdunklung 0,35 bleibt weisser Text auch auf weissen Bildern lesbar (Ziel Kontrast >= 4,5:1:
 * Hintergrund <= ~110 von 255 -> Alpha >= ~0,3 hinter jedem Text; hier 0,55-0,78). Kein CSS-Verlauf, kein Blur (Orsay).
 * - scrim-saver.png   1000x460 Ecke links unten (Ambient, Minimal; andere Ecken per scale(-1,1)/(1,-1) gespiegelt)
 * - scrim-saver-b.png 1280x520 Band unten (Filmplakat, Untertitel-Leiste)
 * - scrim-saver-c.png 1200x600 weiche Ellipse (Grosse Uhr) */
/* TV-Befund 28.10. abends ("auf hellem Grund wirkt der Verlauf hinter der Uhr wenig anmutig"): die alten Formen – Ellipse um die
 * Bildecke mit Plateau 0,8 bis r 0,55, dann smoothstep; Ellipse 0,66 um die grosse Uhr – zeichneten sich auf hellen Bildern als
 * dunkles "Ei" mit sichtbarer Schulter ab (smoothstep: Kruemmung springt an beiden Enden -> Mach-Band), Minimal nahm das Eckbild
 * 1000x460 gestaucht auf 420x200 (harter Fleck). Erster Versuch "Kern + Hof" (Abstand zum Textblock) wirkte wie ein weiches
 * Rechteck/eine Stufe -> verworfen. Neu ("weicher Schatten"):
 * - Feld = Summe weniger Gauss-Glocken, die auf dem Text liegen (Ecke: eine um die Uhr in der Ecke, eine laengliche entlang Titel
 *   und Zeile; Grosse Uhr: eine laengliche ueber den Ziffern; Nur kleine Uhr: eine kleine um die Uhr). alpha = peak * (1 - e^(-k*Feld)):
 *   ueber dem Text satt, nach aussen wie ein echter Schatten auslaufend – ueberall glatt (keine Schulter, keine Kante, keine Ecke).
 * - Wo das Bild nicht am Bildschirmrand liegt, laeuft der Rest der Glocke in den letzten 'win' px per smootherstep sicher auf 0
 *   (dort ist alpha schon < 0,06 -> unsichtbar), damit nie eine Bildkante sichtbar wird.
 * - Alpha mit +-1/2 LSB Rauschen (ign) gegen Banding auf dem 8-Bit-Panel.
 * - Deckkraft nur so viel wie noetig: weisses Bild nach saver-dim 0,35 = 166 -> Text text-1 braucht a >= 0,34, text-soft (Zeile,
 *   Uhr im Filmplakat) a >= 0,45 fuer 4,5:1 (vorher bis 0,8 – wirkte als dunkle Wolke). tests/saver.test.js prueft die Deckkraft
 *   der fertigen Bilder an den Textstellen. Glocken: [Mitte x, Mitte y, Halbachse x, Halbachse y] (Ecke: ab der Bildecke, y nach oben). */
function scrimCfg() { return {   // als Funktion: --saver laeuft oben, bevor var-Zuweisungen hier ausgefuehrt sind
  minimal: { w: 420, h: 200, peak: 0.66, k: 3, win: 60, g: [[110, 72, 170, 78]] },                        // Nur kleine Uhr
  clock: { w: 1200, h: 600, peak: 0.62, k: 2, win: 90, g: [[480, 300, 230, 135], [720, 300, 230, 135]] },   // Grosse Uhr: zwei Glocken = flacher, kein Ei
  band: { w: 1280, h: 520, peak: 0.5, y1: 310 }                                                               // Leisten unten (s. scrimBand)
}; }
function smoother(t) { t = Math.max(0, Math.min(1, t)); return t * t * t * (t * (t * 6 - 15) + 10); }
/* Deckkraft an (x, y) aus den Glocken; edges: Raender, an denen das Bild NICHT am Bildschirmrand liegt ({l,r,t,b}: true) */
function scrimSoft(c, x, y, edges) {
  var f = 0, i;
  for (i = 0; i < c.g.length; i++) { var g = c.g[i], u = (x - g[0]) / g[2], v = (y - g[1]) / g[3]; f += Math.exp(-(u * u + v * v)); }
  var w = 1;
  if (edges.l) w *= smoother(x / c.win); if (edges.r) w *= smoother((c.w - x) / c.win);
  if (edges.t) w *= smoother(y / c.win); if (edges.b) w *= smoother((c.h - y) / c.win);
  return c.peak * (1 - Math.exp(-c.k * f)) * w;
}
/* Ambient (SAV-4): weicher Fleck um Uhr und Text, auf allen Seiten ausgeblendet, mit Abstand zum Bildschirmrand (Nutzerbefund 06.11.) –
 * Form, Werte und 9-Teile-Zusammensetzung siehe src/core/saverlogic.js AMB/ambPieces/ambField (von dort gelesen, eine Quelle).
 * Sprites scrim-saver-a{s,e}[-r].png und scrim-saver-af.png, Alpha mit +-1/2 Stufe Rauschen. */
function ambScrims(out) {
  var N0 = {}; new Function('N', fs.readFileSync(path.join(ROOT, 'src', 'core', 'saverlogic.js'), 'utf8'))(N0);
  var L = N0.saverLogic;
  ['s', 'f', 'e', 't'].forEach(function (c) {
    (c === 'f' ? [false] : [false, true]).forEach(function (r) {
      var S = L.ambSize(c);
      out(L.ambImg(c, r), S[0], S[1], function (x, y) { return L.ambField(c, r, x, y); });
    });
  });
}
/* Ecke unten links: x ab der Ecke nach rechts, yb ab der Unterkante nach oben; aussen liegen rechts (x = w) und oben (yb = h) */
function scrimCorner(c, x, yb) { return scrimSoft(c, x, yb, { r: 1, b: 1 }); }
function scrimClock(c, x, y) { return scrimSoft(c, x, y, { l: 1, r: 1, t: 1, b: 1 }); }
/* Band unten (Filmplakat, Untertitel-Leiste). TODO nach 1.0.5 ("die Abdunklung beginnt sichtbar oben am Band"): bis 1.0.5 340 hoch,
 * smootherstep ueber 215 px auf 0,74 – auf hellen Bildern stieg die Helligkeit (L*) dort um bis zu 0,44 je Pixel, der Beginn bei
 * y ~410 las sich als Kante. Jetzt 520 hoch (ab y 200), dieselbe Kurve ueber 310 px auf 0,5: halb so steil, Kruemmung ~1/3 –
 * der Beginn verliert sich im Bild. 0,5 reicht: Zeile/Uhr text-soft brauchen auf weissem Bild >= 0,45, Titel text-1 >= 0,34;
 * der Text beginnt fruehestens bei y 504 (Band-y 304), dort ist die Kurve schon bei 0,5 (Test tests/saver.test.js). */
function scrimBand(c, y) { return c.peak * smoother(y / c.y1); }
function saverScrims() {
  var SAVER_SCRIM = scrimCfg();
  function out(name, w, h, alpha) {
    fs.writeFileSync(path.join(OUT, name), png(w, h, function (x, y) {
      var a = 255 * alpha(x + 0.5, y + 0.5);
      return [0, 0, 0, a <= 0 ? 0 : Math.max(0, Math.min(255, Math.floor(a + ign(x, y))))];
    }));
  }
  /* Je Ecke ein fertig gespiegeltes Bild (unten links = ohne Zusatz, -br/-tr/-tl): keine CSS-Spiegelung (TV-Befund 28.10.: Luecke
   * zwischen Schatten und Rand in manchen Ecken). Minimal: eigene, kleine Bilder (-m…) in Anzeigegroesse 420x200 */
  ambScrims(out);
  [['minimal', 'scrim-saver-m']].forEach(function (k) {
    var c = SAVER_SCRIM[k[0]], W = c.w, H = c.h;
    out(k[1] + '.png', W, H, function (x, y) { return scrimCorner(c, x, H - y); });
    out(k[1] + '-br.png', W, H, function (x, y) { return scrimCorner(c, W - x, H - y); });
    out(k[1] + '-tr.png', W, H, function (x, y) { return scrimCorner(c, W - x, y); });
    out(k[1] + '-tl.png', W, H, function (x, y) { return scrimCorner(c, x, y); });
  });
  out('scrim-saver-b.png', SAVER_SCRIM.band.w, SAVER_SCRIM.band.h, function (x, y) { return scrimBand(SAVER_SCRIM.band, y); });
  posterShadows(out);
  clockScrims();
  out('scrim-saver-c.png', 1200, 600, function (x, y) { return scrimClock(SAVER_SCRIM.clock, x, y); });
}

/* ---------- Schatten unter dem Plakat ("Poster und Cover", core/saverlogic.js SHADOW/shadowBox) ----------
 * TODO nach 1.0.5: das Plakat lag flach auf dem Grund. Kein box-shadow/Blur am Orsay -> vorgerechnetes PNG hinter dem Plakat, auf
 * das echte Plakat gestreckt. Form: Abstand d ausserhalb eines Rechtecks (Plakat 6 px eingerueckt, 6 px nach unten versetzt),
 * alpha = peak * (1 - smootherstep(d / R))^2 – faellt schon AM Plakatrand ab (erster Versuch mit Plateau bis an den Rand wirkte
 * wie ein dicker schwarzer Rahmen), unten am kraeftigsten, nach aussen lang und weich, Steigung 0 am Ende (kein Rand);
 * R = Rand - Versatz, damit es vor jeder Bildkante 0 ist. Der Grund ist hoechstens
 * 89/255 hell (PM_BG) – der Schatten ist dort als Tiefe sichtbar, aber nie ein schwarzer Kasten. Schwarz = Token c.black. */
function posterShadows(out) {
  var OY = 6, IN = 6, PEAK = 0.5;
  [['saver-shadow.png', 300, 450, 40], ['saver-shadow-sq.png', 380, 380, 40]].forEach(function (d) {
    var pw = d[1], ph = d[2], m = d[3], R = m - OY, x0 = m + IN, x1 = m + pw - IN, y0 = m + IN + OY, y1 = m + ph - IN + OY;
    out(d[0], pw + 2 * m, ph + 2 * m, function (x, y) {
      var dx = Math.max(x0 - x, 0, x - x1), dy = Math.max(y0 - y, 0, y - y1), g = 1 - smoother(Math.sqrt(dx * dx + dy * dy) / R);
      return PEAK * g * g;
    });
  });
}

/* ---------- Startseiten-Uhr ohne Kasten (settings.clockStyle free/date/small): je Stil ein eigener Eckschatten ----------
 * TV-Test 28.10.: "Mit Datum" sah gut aus, mit demselben Schatten wirkte "Gross und frei" zu hart (dunkle Wolke unter den
 * Ziffern, nichts darin) und "Klein und dezent" wie ein Fleck. Deshalb je Stil ein Bild, in den Massen von "Mit Datum"
 * (Referenz, unveraendert): Ellipse um die Uhr, waagerecht gestreckt, bis in die Ecke oben rechts; Hoehe/Breite folgen dem
 * Textblock des Stils. Verlauf a = peak * (1 - smoothstep(r))^2: laeuft mit ~(1-r)^4 aus, Steigung 0 am Ende, kein sichtbarer Rand.
 * Alpha mit +-1/2 LSB Rauschen (interleaved gradient noise) gegen Stufen auf dem 8-Bit-Panel.
 * Bild in Anzeigegroesse (keine CSS-Skalierung), rechts und oben buendig mit der Bildschirmecke (CSS .hc-scr right/top).
 * Deckkraft: kleinste, bei der die Schrift auf rein weissem Bild (mit scrim.png 0,25 oben rechts) Kontrast >= 3:1 behaelt
 * (Ziffern text-1, Datum/kleine Uhr text-soft); "Mit Datum" bleibt bei 0,6 (Datumszeile damit genau 3:1).
 * Werte je Bild: Mitte cx/cy und Halbachsen rx/ry in Bildschirm-Koordinaten
 * (ryt: Halbachse nach oben, falls anders – reicht dann weich bis an die Oberkante), peak */
function clockScrims() {
  var CLOCK_SCRIMS = {
    'scrim-clock-date.png': { cx: 1190, cy: 60, rx: 390, ry: 160, peak: 0.6 },    // Mit Datum: Ziffern + Datum y 41..96 (Referenz)
    'scrim-clock.png': { cx: 1190, cy: 54, rx: 360, ry: 112, peak: 0.42 },        // Gross und frei: Ziffern y 41..72
    'scrim-clock-small.png': { cx: 1205, cy: 50, rx: 220, ry: 60, ryt: 110, peak: 0.56 }      // Klein und dezent: y 45..60
  };
  function SS(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }   // smoothstep wie bisher (Referenz "Mit Datum")
  function ign(x, y) { var v = 52.9829189 * ((0.06711056 * x + 0.00583715 * y) % 1); return v - Math.floor(v); }   // [0,1)
  Object.keys(CLOCK_SCRIMS).forEach(function (name) {
    var c = CLOCK_SCRIMS[name], ox = Math.max(0, c.cx - c.rx), w = 1280 - ox, h = c.cy + c.ry;
    fs.writeFileSync(path.join(OUT, name), png(w, h, function (px, py) {
      var dx = (ox + px + 0.5 - c.cx) / c.rx, dy = (py + 0.5 - c.cy) / (py + 0.5 < c.cy && c.ryt || c.ry), g = 1 - SS(Math.sqrt(dx * dx + dy * dy));
      return [0, 0, 0, Math.max(0, Math.min(255, Math.floor(255 * c.peak * g * g + ign(px, py))))];
    }));
  });
}

/* ---------- Rahmen links + unten (TV-Befund 28.10.: auf buntem Mediathek-Hintergrund waren Seitenleiste und Band unten
 * verschieden kraeftig, die Ecke unten links wirkte hart) ----------
 * rail.png und fade-frame.png (Band unten der Mediathek, library.js) teilen EINE Kurve: deckend c.bg, dann auf FRAME_L px
 * per smoothstep (Steigung 0 an beiden Enden -> keine Kante/Machsche Linie) auf 0. Beide Ebenen liegen uebereinander (gleiche Farbe), die Ecke ergibt sich damit
 * von selbst als 1-(1-a)(1-b): runde Hoehenlinien, kein Knick – kein eigenes Eckbild noetig, keine zusaetzliche Ebene.
 * Alpha mit +-1/2 LSB Rauschen gegen Stufen auf dem 8-Bit-Panel. */
var FRAME_L = 40;
function frameA(d, x, y) {   // d = Abstand von der Innenkante (0 = transparent) in px
  var t = Math.max(0, Math.min(1, (d + 0.5) / FRAME_L)), a = t * t * (3 - 2 * t);
  return Math.max(0, Math.min(255, Math.floor(255 * a + (t > 0 && t < 1 ? ign(x, y) : 0.5))));
}
function ign(x, y) { var v = 52.9829189 * ((0.06711056 * x + 0.00583715 * y) % 1); return v - Math.floor(v); }   // [0,1)

/* ---------- Transparenz der Leisten (SPEC BG-2, Einstellung "glass", Standard deckend; Nutzerwunsch 08.11.) ----------
 * Je Bild Fassungen in GLEICHER Groesse (N.glass tauscht nur die Quelle, keine zusaetzliche Ebene): *-glass (Durchscheinend),
 * *-glass-mid (Leicht durchscheinend), fuer die Abdunklungen zusaetzlich *-rail (caps.glassBars 'rail', ohne Band).
 * Hauptregel (TV-Befunde 08.11.): die Gesamtwirkung aus Seitenleiste + Band + Abdunklung wird nach rechts nie dunkler (je Zeile,
 * Toleranz 0,01) – eine hellere Leiste neben dunklerem Text las sich als Fleck; unten (ab y 560) ist jede Zeile ueber x 0..400
 * gleich (Ecke ohne Kerbe/Dopplung). tests/glass.test.js prueft das samt Kontrasten.
 * - Seitenleiste: flach (Durchscheinend 0,72 = Boden hinter dem Hero-Text; Leicht = GLASS.railMid), Kante wie rail.png.
 * - Band: EINE weiche Rampe ab der Oberkante bis zur Hinweis-Zeile (0,76), darunter flach (eine zweite Stufe im Sicherheitsrand
 *   las sich als dunkler Streifen).
 * - Abdunklungen: aus scrim.png / scrim-det.png / scrim-np.png abgeleitet, an keinem Pixel dunkler; Ziel je Zeile flach vom
 *   Bildschirmrand (Boden F(y)), rechts dem Original folgend; G = 1 - (1 - Ziel) / (1 - Leisten).
 * Nur diese Bilder neu erzeugen: node tools/make_assets.js --glass */
var GLASS = {
  bar: Number(/,\s*([\d.]+)\)$/.exec(T.color('bg-60'))[1]),   // 0.6 aus dem Token c.bg-60
  rail: 0.72,                                                   // Seitenleiste (Symbole x 58..86): = Boden der Startseite hinter dem Hero-Text (nach rechts nie dunkler)
  hint: 0.88, hintEnd: 672                                       // Band (TV 08.11.: weisse Senderkacheln unter "OK Ansehen" kaum lesbar, 0,76 zu wenig): EINE weiche Rampe von der Oberkante bis zur Hinweis-Zeile (top 668, Text
                                                                // y ~674..692) auf 0,88, darunter flach (keine zweite Stufe, kein Streifen ganz unten)
};
function ramp(v, a, b) { var t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); }
function dither(a, x, y) { return Math.max(0, Math.min(255, Math.floor(255 * a + (a > 0 && a < 1 ? ign(x, y) : 0.5)))); }
function frameS(d) { var t = Math.max(0, Math.min(1, (d + 0.5) / FRAME_L)); return t * t * (3 - 2 * t); }   // Kurve von frameA ohne Rauschen
/* Deckkraft der Glas-Leisten in Bildschirm-Koordinaten (sx, sy) */
/* Seitenleiste (Nutzer am TV 08.11.: Fade zu kurz, Hintergrund deckte die Symbole x 56..88 nicht ganz): flach bis x 96 (8 px hinter
 * den Symbolen), dann smootherstep ueber 36 px auf 0 bei x 132. Nicht weiter: der Fokusrahmen der ersten Karte liegt bei x 123..128
 * (Rahmen unter der Leiste: Querformat-Karten am aeussersten Pixel bis ~9 % dunkler, Plakate < 1 %), fokussierte Karten beginnen bei x 132, Karten bei x 144. */
var RAIL_W = 132, RAIL_FLAT = 96;
function railS(sx) { if (sx >= RAIL_W) return 0; var t = Math.max(0, Math.min(1, (RAIL_W - sx - 0.5) / (RAIL_W - RAIL_FLAT))); return t * t * t * (t * (t * 6 - 15) + 10); }
function glassRail(sx) { return railS(sx) * GLASS.rail; }
function glassBand(sy, top) {   // Band ab y top: eine smoothstep-Rampe bis y 672 auf GLASS.hint (0,88), darunter flach (TV-Befund 08.11.: zweite Stufe
  // unten im Sicherheitsrand las sich als dunkler Streifen; Knick zwischen zwei Rampen ebenso)
  return sy < top ? 0 : GLASS.hint * ramp(sy, top, GLASS.hintEnd);
}
function glassBottom(sx, sy) { return glassBand(sy, 632); }
/* Lesbarkeit ueber dem Bild (Koordinator 08.11.: Kartenbeschriftungen text-3 auf aufgehelltem Hero ~2:1): wo Text steht, mindestens
 * GLASS.text (auf rein weissem Bild text-2 >= 4,5:1, text-3 >= 3:1; tests/glass.test.js).
 * EIN zusammenhaengendes Feld wie die Form des Originals (TV-Befund 08.11. auf satt rotem Hero: "dunkle Flecken zwischendrin" –
 * getrennte weiche Inseln je Textflaeche und je Zeile verschiedene Werte neben der Seitenleiste): jede Textflaeche reicht von der
 * Inhaltskante nach links bis zur Seitenleiste und nach unten bis ins Band; nach rechts und nach oben laeuft sie weich aus
 * (smoothstep ueber GLASS.soft px). Vereinigt per max -> nach rechts und nach oben nie dunkler werdend, keine Inseln, und neben der
 * Seitenleiste in jeder Hoehe dasselbe. Links laeuft der Boden gleichmaessig von der Seitenleiste (0,65 am Bildschirmrand) zum Text
 * (0,82 ab x 144), ohne helle Spalte. Ausserhalb bleiben Seitenleiste, Band und die Bildecke oben rechts so hell wie vorher. */
GLASS.text = 0.82; GLASS.soft = 260;
var TEXT_HOME = [[784, 60],               // Hero-Text (.hero-txt: Overline, Titel, Meta 640 px bis x 784) und darunter Ueberschriften
  [1280, 556]];                           // Beschriftungen der Karten + Ueberschrift der naechsten Reihe (ganze Breite)
var TEXT_DET = [[800, 40], [1000, 200], [1280, 300]];   // Kopf in den Abschnitten · erster Bildschirm · Abschnitte
function textP(areas, x, y) {             // areas: je [rechte Kante, obere Kante]; links bis x 0, unten bis ins Band
  var m = 0;
  for (var i = 0; i < areas.length; i++) {
    var a = areas[i], v = (1 - ramp(x, a[0], a[0] + GLASS.soft)) * ramp(y, a[1] - GLASS.soft, a[1]);
    if (v > m) m = v;
  }
  var lo = GLASS.rail + (GLASS.text - GLASS.rail) * ramp(x, 16, 144);
  return lo * m;
}
/* Zusatz von scrim-det: nach oben lang und gleichmaessig auslaufend (Nutzer am TV 08.11., ruhiges helles Bild: der steile Anstieg y 40..210
 * las sich als Oberkante eines dunklen Kastens hinter dem Info-Block) – von y 0 bis y 230 (Oberkante des Info-Blocks auf dem ersten
 * Bildschirm, Ueberzeile ab y ~240) fast linear mit weichen Enden (Steigung hoechstens 1,25 x Mittel); darunter unveraendert. */
function easeLin(t, e) { t = Math.max(0, Math.min(1, t)); var k = 1 / (1 - e); return t < e ? k * t * t / (2 * e) : t > 1 - e ? 1 - k * (1 - t) * (1 - t) / (2 * e) : k * (t - e / 2); }
function detE(x, y) { return 0.65 * (1 - ramp(x, 860, 1240)) * easeLin(y / 230, 0.2) * (1 - ramp(y, 560, 700)); }
/* Zwei Stufen (Nutzer 08.11. am TV: "so wie jetzt, so wie vorher und irgendwas dazwischen"): strong = *-glass.png (Durchscheinend),
 * mid = *-glass-mid.png (Leicht durchscheinend). mid liegt bei Seitenleiste und Band genau auf halbem Weg zwischen deckend und strong;
 * die Abdunklung wird so gewaehlt, dass die Gesamtwirkung (Abdunklung + Leisten) die Mitte zwischen aus und strong trifft. Je Bild gilt
 * strong <= mid <= Original (tests/glass.test.js).
 * Ecke unten links (TV-Befund 08.11.: wirkte fast deckend): Seitenleiste und Band liegen dort uebereinander und dunkelten doppelt ab.
 * Das Band wird unter der Seitenleiste (x < RAIL_W = 132) so viel schwaecher, dass beide zusammen genau max(Seitenleiste, Band) ergeben –
 * dieselbe Staerke wie das Band daneben und die Leiste darueber, ohne dunkles Quadrat (Start, Details, Mediathek, Live-TV, Album,
 * Kuenstler: ueberall liegt das Band unter der Seitenleiste). */
var GLASS_LV = { strong: { sfx: '-glass', k: 1 }, mid: { sfx: '-glass-mid', k: 0.5 } };
function offRail(sx) { return railS(sx); }                         // rail.png ohne Rauschen
function offBottom(sy) { var y = sy - 632; return y < 0 ? 0 : y >= 20 ? 1 : (y / 20) * (y / 20) * 0.6 + (y / 20) * 0.4; }   // fade-bottom.png
function offFrame(sy) { return sy < 612 ? 0 : frameS(sy - 612); }                          // fade-frame.png
/* Seitenleiste je Stufe: dieselbe Form wie rail.png, flach bis x 96 (railS); strong = GLASS.rail (0,72 = Boden hinter dem Hero-Text), mid =
 * GLASS.railMid (Mitte aus diesem Boden und dem Hellsten des Originals an der Leistenkante) – so ist die Leiste nie dunkler als die
 * Abdunklung daneben (sonst Stufe an der Leistenkante bzw. Strich hinter den Symbolen, TV-Befund 08.11.) */
function lvRail(lv, sx) { return railS(sx) * (lv.k < 1 ? GLASS.railMid : GLASS.rail); }
/* Bezug "deckend" fuer die Zwischenstufe: fade-bottom.png steigt in 20 px auf und knickt bei y 652 (Steigung 0,08 -> 0) – halb
 * uebernommen war das in der Stufe mid ein sichtbarer Knick (Pruefbefund 08.11.). Deshalb weich ueber 40 px (smoothstep, nie dunkler
 * als fade-bottom.png, nie heller als die Glas-Fassung). */
function offBottomS(sy) { return Math.max(glassBand(sy, 632), ramp(sy, 632, 672)); }
function lvBandU(lv, sy, frame) {                                                            // Band ohne Eck-Ausgleich
  var o = frame ? offFrame(sy) : lv.k < 1 ? offBottomS(sy) : offBottom(sy), g = frame ? glassBand(sy, 612) : glassBand(sy, 632);
  return o + (g - o) * lv.k;
}
function lvBand(lv, sx, sy, frame) {                                                         // mit Eck-Ausgleich unter der Seitenleiste
  var u = lvBandU(lv, sy, frame), r = lvRail(lv, sx);
  if (sx >= RAIL_W || r <= 0) return u;
  if (r >= 1) return 0;
  // weiches Maximum statt max (Nutzer 08.11.: "Uebergaenge wirklich fliessend"): max gab entlang der Diagonale r = u einen Knick
  // (Mediathek, Live-TV); smax ist ueberall glatt und liegt hoechstens SMAX_K / 2 (0,08) ueber max – in der Ecke eine weiche, leicht
  // dunklere Rundung statt einer Knicklinie
  // nur das Band der Mediathek/Live-TV (ohne Abdunklung darueber); auf Start/Details gleicht die Abdunklung die Ecke ohnehin aus
  return Math.max(0, 1 - (1 - (frame ? smax(r, u) : Math.max(r, u))) / (1 - r));
}
var SMAX_K = 0.16;
// Rundung nur dort, wo beide da sind (k^2 ~ a*b): ist eine Ebene 0, ist smax genau die andere – kein Anheben an Band-Oberkante/Leistenrand
function smax(a, b) { var k2 = SMAX_K * SMAX_K * Math.min(1, 16 * a * b); return Math.min(1, (a + b + Math.sqrt((a - b) * (a - b) + k2)) / 2); }
function lvFrameF(lv, sx, sy) { return 1 - (1 - lvRail(lv, sx)) * (1 - lvBand(lv, sx, sy, false)); }   // Leisten ueber Hero/Details
function glassAssets() {
  var V = require('./visual.js');
  (function () {   // GLASS.railMid aus scrim.png: (Hellstes bei x 200, y 0..480, + Boden 0,72) / 2
    var p = path.join(OUT, 'scrim.png'); if (!fs.existsSync(p)) { GLASS.railMid = 0.8; return; }
    var S = V.readPng(p), mn = 1; for (var y = 0; y <= 480; y += 2) mn = Math.min(mn, S.px[(y * S.w + 200) * 4 + 3] / 255);
    GLASS.railMid = (mn + S.px[(240 * S.w + 300) * 4 + 3] / 255) / 2;
  })();
  Object.keys(GLASS_LV).forEach(function (k) {
    var lv = GLASS_LV[k];
    fs.writeFileSync(path.join(OUT, 'rail' + lv.sfx + '.png'), png(RAIL_W, 720, function (x, y) { return [BG[0], BG[1], BG[2], dither(lvRail(lv, x), x, y)]; }));
    fs.writeFileSync(path.join(OUT, 'fade-bottom' + lv.sfx + '.png'), png(1280, 88, function (x, y) {
      // nie dunkler als fade-bottom.png; unter der Seitenleiste gilt die Stufen-Reihenfolge fuer Leiste + Band zusammen (Eck-Ausgleich)
      var b = dither(lvBand(lv, x, y + 632, false), x, y);
      if (lv.k < 1) b = Math.min(Math.round(255 * offBottom(y + 632)), b);
      return [BG[0], BG[1], BG[2], b];
    }));
    fs.writeFileSync(path.join(OUT, 'fade-frame' + lv.sfx + '.png'), png(1280, 108, function (x, y) {
      return [BG[0], BG[1], BG[2], dither(lvBand(lv, x, y + 612, true), x, y)];
    }));
  });
  /* Regel (Koordinator 08.11.): nie dunkler als das Original, an keinem Pixel. Gesamtwirkung C = 1 - (1 - Leisten) * (1 - Abdunklung);
   * zuerst das Ziel T fuer die Gesamtwirkung je Stufe, daraus Abdunklung G = 1 - (1 - T) / (1 - Leisten) (Leisten schon dunkler -> 0).
   * Nach rechts nie dunkler werdend (TV-Befund 08.11., "KPop": hinter dem Hero-Titel erst hell am Rand, dann dunkler, dann wieder heller
   * = Fleck): T haengt links nur von y ab und folgt rechts dem Original –
   *   strong: T = min(Original, F(y)) mit einem Boden F je Bildschirm, der nur von y abhaengt (in x konstant, also ab dem Bildschirmrand
   *     flach, auch unter der Seitenleiste); da das Original nach rechts nie dunkler wird, wird es auch T nicht.
   *   mid:    T = Mitte aus deckend (Original unter den deckenden Leisten; Band weich, offBottomS) und strong – beide nach rechts nie
   *     dunkler, also auch die Mitte.
   * Ecke unten links (Nutzer 08.11.: "ein durchgehender Balken"): ab y 640 ist T in x 0..200 dasselbe wie bei x 200 (Uebergang
   * y 615..640), so ergibt Seitenleiste + Band + Abdunklung dort genau das Band daneben – keine hellere Ecke, kein Bogen. */
  function cornerFlat(T, W, H) {
    for (var y = 600; y < H; y++) {
      var w = ramp(y, 615, 640);
      if (w <= 0) continue;
      var ref = T[y * W + 200];
      for (var x = 0; x < 200; x++) T[y * W + x] = w * ref + (1 - w) * T[y * W + x];
    }
  }
  function scrimG(base, floor) {
    var src = path.join(OUT, base + '.png');
    if (!fs.existsSync(src)) return;
    var S = V.readPng(src), W = S.w, H = S.h, x, y;
    function at(x, y) { return S.px[(y * W + x) * 4 + 3]; }
    var Ts = new Float64Array(W * H), Tm = new Float64Array(W * H), strong = Buffer.alloc(W * H);
    for (y = 0; y < H; y++) { var F = floor(y); for (x = 0; x < W; x++) Ts[y * W + x] = Math.min(at(x, y) / 255, F); }
    var Ts0 = Float64Array.from(Ts);                               // ohne Eck-Ausgleich (fuer die Fassung ohne Band, *-rail)
    /* zum Band hin weich auf dessen Wert (GLASS.hint) statt per max: Gesamtwirkung T + (max(T, Band) - T) * Rampe des Bands – kein
     * Knick dort, wo das Band den Boden kreuzt (bei 0,88 sonst sichtbar), und nie heller als das Band */
    // lang und weich (smootherstep y 560..672): auf Start/Details wirkte der kurze Anstieg ab y 632 wie eine harte Schnittkante an den
    // Karten der naechsten Reihe (TV-Befund 08.11., "Extras"); die Abdunklung liegt ohnehin ueber dem ganzen Bild, kostet nichts extra
    for (y = 560; y < H; y++) { var tb = Math.min(1, (y - 560) / (GLASS.hintEnd - 560)), bs = tb * tb * tb * (tb * (tb * 6 - 15) + 10); for (x = 0; x < W; x++) { var t0 = Ts[y * W + x]; Ts[y * W + x] = t0 + (Math.max(t0, GLASS.hint) - t0) * bs; } }
    cornerFlat(Ts, W, H);
    function cOffAt(x, y) { return 1 - (1 - offRail(x)) * (1 - offBottomS(y)) * (1 - at(x, y) / 255); }
    /* mid nie heller als strong (max mit Ts; oben links auf Details lag das Original bei x 200 knapp unter dem Boden 0,82).
     * mid je Zeile von x 0 bis 200 flach: hoechstens die Mitte aus Boden und Original bei x 200 in dieser Zeile – unter und neben der
     * Leiste also genau wie der Inhalt daneben (sonst Flecken/Strich entlang der Leiste); min mit einem nur von y abhaengigen Wert bleibt
     * nach rechts nie dunkler werdend. Die Seitenleiste selbst (GLASS.railMid) ist nie dunkler als das Hellste davon. */
    /* unten mindestens so dunkel wie das Band der Stufe mid ganz unten ((1 + GLASS.hint) / 2 = 0,94), weich ueber y 480..620 (smootherstep):
     * dann liegt das Band ganz unter der Abdunklung, Zeilen ab y 560 sind ueber die ganze Breite gleich (Ecke ohne Kerbe/Dopplung) und
     * es gibt keinen Knick, wo das Band die Abdunklung kreuzen wuerde */
    var bandMid = (1 + GLASS.hint) / 2;
    function smoother(t) { t = Math.max(0, Math.min(1, t)); return t * t * t * (t * (t * 6 - 15) + 10); }
    for (y = 0; y < H; y++) { var Fm = (cOffAt(200, y) + floor(y)) / 2, bm = bandMid * smoother((y - 480) / 140); for (x = 0; x < W; x++) Tm[y * W + x] = Math.max(bm, Ts[y * W + x], Math.min(Fm, (cOffAt(x, y) + Ts[y * W + x]) / 2)); }
    var Tm0 = new Float64Array(W * H);                              // fuer *-rail: Mitte ohne Band (das gibt es dort nicht)
    for (y = 0; y < H; y++) { var Fm0 = (at(200, y) / 255 + floor(y)) / 2; for (x = 0; x < W; x++) Tm0[y * W + x] = Math.max(Ts0[y * W + x], Math.min(Fm0, (1 - (1 - offRail(x)) * (1 - at(x, y) / 255) + Ts0[y * W + x]) / 2)); }
    cornerFlat(Tm, W, H);
    fs.writeFileSync(path.join(OUT, base + '-glass.png'), png(W, H, function (x, y) {
      var f = lvFrameF(GLASS_LV.strong, x, y), b = Math.min(at(x, y), dither(Math.max(0, 1 - (1 - Ts[y * W + x]) / (1 - f)), x, y));
      strong[y * W + x] = b;
      return [BG[0], BG[1], BG[2], b];
    }));
    fs.writeFileSync(path.join(OUT, base + '-glass-mid.png'), png(W, H, function (x, y) {
      var f = lvFrameF(GLASS_LV.mid, x, y), sb = strong[y * W + x];
      var b = f >= 1 ? sb : dither(Math.max(0, 1 - (1 - Tm[y * W + x]) / (1 - f)), x, y);
      // Reihenfolge strong <= mid <= deckend gilt fuer die Gesamtwirkung (Leisten + Abdunklung), nicht je Bild: die Leisten sind in mid
      // dunkler, die Abdunklung darunter darf dann heller sein (eine Klammer je Bild gab eine Stufe an der Ecke, Pruefbefund 08.11.)
      return [BG[0], BG[1], BG[2], Math.min(at(x, y), b)];
    }));
    /* caps.glassBars 'rail' (Geraete ohne Band unten): Seitenleiste und Abdunklung wie oben, nach unten (y 560..660) weich zurueck zum
     * Original, unten genau wie Deckend. Gewicht nur von y abhaengig, damit es nach rechts nie dunkler wird: T_r = o - w(y) (o - T_Stufe);
     * Abdunklung unter der Glas-Seitenleiste allein: G = 1 - (1 - T_r) / (1 - Leiste); nie dunkler als das Original, strong <= mid. */
    var strongR = Buffer.alloc(W * H);
    [['strong', Ts0, '-glass-rail'], ['mid', Tm0, '-glass-mid-rail']].forEach(function (lvp) {
      var lv = GLASS_LV[lvp[0]], T0 = lvp[1];
      fs.writeFileSync(path.join(OUT, base + lvp[2] + '.png'), png(W, H, function (x, y) {
        var ob = at(x, y), o = ob / 255, w = 1 - ramp(y, 560, 660);
        var t = o - w * (o - Math.min(o, T0[y * W + x])), r = lvRail(lv, x);
        var b = r >= 1 ? ob : Math.min(ob, dither(Math.max(0, 1 - (1 - t) / (1 - r)), x, y));
        if (w <= 0) b = ob;
        // Reihenfolge strong <= mid gilt fuer die Gesamtwirkung (Leiste + Abdunklung), nicht je Bild
        return [BG[0], BG[1], BG[2], b];
      }));
    });
  }
  /* Boeden je Bildschirm (nur von y abhaengig): Startseite hinter Hero-Text, Ueberschrift und darunter so dunkel wie das Original selbst
   * hinter der Beschreibung (bei x 300, y 240: 0,72 – dieselbe Lesbarkeit wie bisher dort), zu den Kartenbeschriftungen hin weich
   * (smootherstep y 376..556) auf GLASS.text (0,82: text-2 >= 4,5:1, text-3 >= 3:1 auf Weiss); Details/Album/Kuenstler ueberall
   * GLASS.text (das Original ist hinter Titel/Infos/Beschreibung selbst 0,8..0,9). */
  var heroF = (function () { var p = path.join(OUT, 'scrim.png'); if (!fs.existsSync(p)) return 0.72; var S = V.readPng(p); return S.px[(240 * S.w + 300) * 4 + 3] / 255; })();
  GLASS.hero = heroF;
  function smoother(t) { t = Math.max(0, Math.min(1, t)); return t * t * t * (t * (t * 6 - 15) + 10); }
  scrimG('scrim', function (y) { return heroF + (GLASS.text - heroF) * smoother((y - 376) / 180); });
  scrimG('scrim-det', function () { return GLASS.text; });
  scrimG('scrim-np', function () { return GLASS.text; });
  /* Kopfband der Detailseiten in den Abschnitten (scrim-hdr.png, um 180 Grad gedreht und auf 288 px gestreckt, Deckkraft 0,92). In Ruhe
   * liegt unter dem Kopf nichts (details.js hideAbove), beim Blaettern laufen Reihen aber ~180 ms (bei Tastenwiederholung laenger) unter
   * ihm durch (Pruefbefund 08.11.): hinter dem Kopftext (x bis 800, Bildschirm-y bis 190) deshalb so deckend wie das Original (Durchschein
   * <= 8 %, kein Flackern), aussen weicher: unten smootherstep auf 0 bei y 288 (Bild-y 0..30 statt 0..20), rechts ab x 800 zusaetzlich
   * bis x 1100 auf die Stufe (Durchscheinend 0,70, Leicht 0,85) – dort steht kein Text. Nie dunkler als scrim-hdr.png. */
  [['-glass', 0.70], ['-glass-mid', 0.85]].forEach(function (lv) {
    fs.writeFileSync(path.join(OUT, 'scrim-hdr' + lv[0] + '.png'), png(1280, 88, function (x, y) {
      var tv = Math.min(1, y / 30), v = tv * tv * tv * (tv * (tv * 6 - 15) + 10);
      var t = Math.max(0, Math.min(1, (1279 - x - 780) / 460)), h = 1 - 0.7 * t * t * (3 - 2 * t);
      var tr = Math.max(0, Math.min(1, (1279 - x - 800) / 300)), sr = tr * tr * tr * (tr * (tr * 6 - 15) + 10), g = 1 - (1 - lv[1]) * sr;
      var o = (y >= 20 ? 1 : (y / 20) * (y / 20) * 0.6 + (y / 20) * 0.4) * h;
      return [BG[0], BG[1], BG[2], Math.min(Math.round(255 * o), dither(v * h * g, x, y))];
    }));
  });
}
if (process.argv.indexOf('--glass') >= 0) { glassAssets(); process.exit(0); }

/* fade-frame: 1280x108, Bild beginnt bei y=612; transparent oben -> deckend ab y 652 (Hinweisleiste, Reihen laufen darunter aus).
 * Nur in der Mediathek: dort reicht der (bunte) Hintergrund bis unten. Start/Details/Suche behalten fade-bottom (kurz, ab y 632):
 * deren unterste Reihe/Fortschrittsbalken reichen bis y ~650, und unten links dunkelt dort scrim.png ohnehin ab. */
fs.writeFileSync(path.join(OUT, 'fade-frame.png'), png(1280, 108, function (x, y) {
  return [BG[0], BG[1], BG[2], frameA(y, x, y)];
}));
/* rail: 132x720, deckend bis x 96 (Symbole x 56..88 ganz auf c.bg), dann smootherstep auf 0 bei x 132 (railS) */
fs.writeFileSync(path.join(OUT, 'rail.png'), png(RAIL_W, 720, function (x, y) {
  return [BG[0], BG[1], BG[2], dither(railS(x), x, y)];
}));
/* fade-bottom: Bild beginnt bei y=632; transparent bei 0, deckend ab 20 (y=652) */
fs.writeFileSync(path.join(OUT, 'fade-bottom.png'), png(1280, 88, function (x, y) {
  var a = y >= 20 ? 255 : Math.round(255 * (y / 20) * (y / 20) * 0.6 + 255 * (y / 20) * 0.4);
  return [BG[0], BG[1], BG[2], Math.min(255, a)];
}));

/* scrim-hdr: Kopfband der Film-/Serien-Detailseite in den Abschnitten (DetHero o.hdr, wie fade-bottom um 180° gedreht: y=0 hier = unten, x=0 = rechts).
 * Kraeftig hinter dem Text (links bis x 780), nach rechts weich auf 30 % – rechts steht kein Text (TV-Befund 28.10.: Bild sonst
 * zu dunkel). Weggescrollte Abschnitte blendet die Seite aus, das Band muss sie nicht mehr verdecken. */
fs.writeFileSync(path.join(OUT, 'scrim-hdr.png'), png(1280, 88, function (x, y) {
  var v = y >= 20 ? 1 : (y / 20) * (y / 20) * 0.6 + (y / 20) * 0.4;
  var t = Math.max(0, Math.min(1, (1279 - x - 780) / 460)), h = 1 - 0.7 * t * t * (3 - 2 * t);
  return [BG[0], BG[1], BG[2], Math.round(255 * v * h)];
}));

/* ---------- Icon-Sprite ----------
 * Quelle: design/icons/<name>.svg (je Symbol eine Datei, 28er viewBox, Farbe currentColor), Spalten-Reihenfolge
 * design/icons/order.json (nur anhaengen), Zeilen-Farben = design/tokens.json icons.rows (Farb-Tokens). Formen = abgenommene
 * Rail-/Button-Icons aus den Mockups (USER). Neues Symbol: SVG anlegen, Namen in order.json anhaengen, dieses Skript und
 * node tools/design_doc.js --write ausfuehren (src/ui/icons.js COLS und design/README.md werden erzeugt).
 * src/assets/icons.svg ist der erzeugte Vektor-Sprite (Eingabe fuer rsvg-convert; Test prueft, dass er aktuell ist). */
var svg = T.spriteSvg();
fs.writeFileSync(path.join(OUT, 'icons.svg'), svg + '\n');
var tmp = path.join(require('os').tmpdir(), 'plexneo-icons.svg');
fs.writeFileSync(tmp, svg);
try {
  cp.execFileSync('rsvg-convert', ['-o', path.join(OUT, 'icons.png'), tmp]);
} catch (e) { console.error('rsvg-convert fehlt – icons.png nicht neu erzeugt'); }
fs.writeFileSync(path.join(OUT, 'icons.json'), JSON.stringify(T.order()) + '\n');

/* ---------- scrim-det: Text-Bereich der Detailseiten zusaetzlich abdunkeln ----------
 * Zusatz e(x,y) = 0.65 im Textbereich (x <= 860, y 210..560), weich auslaufend bis x 1240 bzw. y 40 und 700;
 * Ergebnis-Deckkraft = 1 - (1 - scrim) * (1 - e): mindestens ca. 0.75 hinter jedem Text, rechts bleibt das Bild sichtbar. */
function scrimDet() {
  var src = path.join(OUT, 'scrim.png');
  if (!fs.existsSync(src)) return;
  var S = require('./visual.js').readPng(src);
  fs.writeFileSync(path.join(OUT, 'scrim-det.png'), png(S.w, S.h, function (x, y) {
    var o = (y * S.w + x) * 4, a = S.px[o + 3] / 255, e = detE(x, y);
    return [S.px[o], S.px[o + 1], S.px[o + 2], Math.round(255 * (1 - (1 - a) * (1 - e)))];
  }));
}

/* ---------- scrim-np: zusaetzlich ueberall 0.45 (Text rechts in Jetzt laeuft, Kuenstler-Fotos), eine Ebene ----------
 * Ergebnis mindestens ca. 0.6 hinter jedem Text; das Bild bleibt als Stimmung sichtbar. */
function scrimNp() {
  var src = path.join(OUT, 'scrim-det.png');
  if (!fs.existsSync(src)) return;
  var S = require('./visual.js').readPng(src);
  fs.writeFileSync(path.join(OUT, 'scrim-np.png'), png(S.w, S.h, function (x, y) {
    var o = (y * S.w + x) * 4, a = S.px[o + 3] / 255;
    return [S.px[o], S.px[o + 1], S.px[o + 2], Math.round(255 * (1 - (1 - a) * 0.55))];
  }));
}

/* ---------- QR ---------- */
var QR = require('qrcode');
QR.toFile(path.join(OUT, 'qr.png'), 'https://plex.tv/link', { errorCorrectionLevel: 'M', margin: 0, width: 264, color: { dark: BG_HEX, light: QR_LIGHT } }, function (err) {
  if (err) console.error('QR-Fehler', err);
  var scrimSrc = path.join(ROOT, 'app', 'scrim.png');
  if (!fs.existsSync(path.join(OUT, 'scrim.png')) && fs.existsSync(scrimSrc)) fs.copyFileSync(scrimSrc, path.join(OUT, 'scrim.png'));
  scrimDet(); scrimNp(); saverScrims(); glassAssets();
  fs.readdirSync(OUT).forEach(function (f) { console.log(f, fs.statSync(path.join(OUT, f)).size + ' B'); });
});
