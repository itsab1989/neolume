#!/usr/bin/env node
/* erzeugt die statischen Bilder in src/assets/ (einmalig bzw. bei Aenderungen; Ergebnis wird eingecheckt).
 *   node tools/make_assets.js
 * - icons.png      PNG-Sprite (SPEC 5.21): 32-px-Raster, Spalte = Icon, Zeile = Farbzustand (Quelle design/icons/*.svg, + icons.svg/.json)
 * - fade-bottom.png 1280x88 (SPEC 2: transparent bei y 632 -> deckend ab y 652; Start, Details, Suche, Album, Kuenstler, DetHero-Kopfband)
 * - fade-frame.png 1280x108 Band unten der Mediathek (transparent bei y 612 -> deckend ab y 652, smoothstep ueber 40 px = rail.png)
 * - rail.png       120x720 Seitenleiste (deckend c.bg bis x 80 -> transparent bei x 120, dieselbe Kurve wie fade-frame:
 *                  zusammen ein Rahmen mit weicher Ecke unten links, siehe "Rahmen links + unten")
 * - scrim-hdr.png  1280x88 Kopfband Film/Serie in den Abschnitten: wie fade-bottom, nach rechts auf 30 % auslaufend
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
if (process.argv.indexOf('--saver') < 0) ptrs.forEach(function (b) {
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
  corner: { w: 1000, h: 460, peak: 0.7, k: 2.5, win: 90, g: [[0, 0, 420, 230], [420, 60, 300, 150]] },     // Ambient (Ecke unten links)
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
  [['corner', 'scrim-saver'], ['minimal', 'scrim-saver-m']].forEach(function (k) {
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
/* fade-frame: 1280x108, Bild beginnt bei y=612; transparent oben -> deckend ab y 652 (Hinweisleiste, Reihen laufen darunter aus).
 * Nur in der Mediathek: dort reicht der (bunte) Hintergrund bis unten. Start/Details/Suche behalten fade-bottom (kurz, ab y 632):
 * deren unterste Reihe/Fortschrittsbalken reichen bis y ~650, und unten links dunkelt dort scrim.png ohnehin ab. */
fs.writeFileSync(path.join(OUT, 'fade-frame.png'), png(1280, 108, function (x, y) {
  return [BG[0], BG[1], BG[2], frameA(y, x, y)];
}));
/* rail: 120x720, deckend bis x 80 (Symbole x 58..86 auf vollem c.bg), dann auf 40 px wie fade-frame auf 0 bei x 120 */
fs.writeFileSync(path.join(OUT, 'rail.png'), png(120, 720, function (x, y) {
  return [BG[0], BG[1], BG[2], frameA(119 - x, x, y)];
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
  function ramp(v, a, b) { var t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); }
  fs.writeFileSync(path.join(OUT, 'scrim-det.png'), png(S.w, S.h, function (x, y) {
    var o = (y * S.w + x) * 4, a = S.px[o + 3] / 255;
    var e = 0.65 * (1 - ramp(x, 860, 1240)) * ramp(y, 40, 210) * (1 - ramp(y, 560, 700));
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
  scrimDet(); scrimNp(); saverScrims();
  fs.readdirSync(OUT).forEach(function (f) { console.log(f, fs.statSync(path.join(OUT, f)).size + ' B'); });
});
