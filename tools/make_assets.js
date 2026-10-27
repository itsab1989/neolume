#!/usr/bin/env node
/* erzeugt die statischen Bilder in src/assets/ (einmalig bzw. bei Aenderungen; Ergebnis wird eingecheckt).
 *   node tools/make_assets.js
 * - icons.png      PNG-Sprite (SPEC 5.21): 32-px-Raster, Spalte = Icon, Zeile = Farbzustand
 * - fade-bottom.png 1280x88 (SPEC 2: transparent bei y 632 -> deckend ab y 652)
 * - rail.png       120x720 (Rail-Hintergrund, #0E0F11 -> transparent)
 * - qr.png         264x264 QR-Code fuer https://plex.tv/link (Inhalt ist fest -> kein QR-Code zur Laufzeit)
 * - scrim.png      wird aus app/scrim.png uebernommen (am TV abgestimmte Ueberblendmaske)
 * - <pointer>[-press].png  Smart-Control-Zeiger je Marke (siehe unten; --pointers erzeugt nur diese)
 * - scrim-det.png  1280x720 Detailseiten (DetHero): scrim.png + kraeftigere Abdunklung hinter Titel/Infos/Beschreibung
 *                  (TV-Test 27.10., F5/F17: Text auf hellen Hintergruenden lesbar); eine Ebene statt zwei
 * Braucht: rsvg-convert (Homebrew librsvg) fuer den Sprite, npm-Paket qrcode.
 */
'use strict';
var fs = require('fs'), path = require('path'), zlib = require('zlib'), cp = require('child_process');
var ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'src', 'assets');
fs.mkdirSync(OUT, { recursive: true });

/* ---------- Zeiger (Smart Control): Pfeil in der Akzentfarbe der Marke, 2 px dunkle Kontur, Spitze bei (4,4) ----------
 * Je Marken-Profil (brand/*.json: pointer, accent, accentPress) <pointer>.png + <pointer>-press.png.
 * Nur die Zeiger neu erzeugen: node tools/make_assets.js --pointers */
function arrowSvg(fill) {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path d="M4 4 L4 26 L10 20.5 L14.2 29.5 L18.6 27.5 L14.4 18.6 L22 18.6 Z" ' +
    'fill="' + fill + '" stroke="#0E0F11" stroke-width="2" stroke-linejoin="round"/></svg>';
}
fs.readdirSync(path.join(ROOT, 'brand')).filter(function (f) { return /\.json$/.test(f); }).forEach(function (f) {
  var b = JSON.parse(fs.readFileSync(path.join(ROOT, 'brand', f), 'utf8'));
  [[b.pointer + '.png', b.accent], [b.pointer + '-press.png', b.accentPress]].forEach(function (p) {
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
var BG = [0x0E, 0x0F, 0x11];

/* fade-bottom: Bild beginnt bei y=632; transparent bei 0, deckend ab 20 (y=652) */
fs.writeFileSync(path.join(OUT, 'fade-bottom.png'), png(1280, 88, function (x, y) {
  var a = y >= 20 ? 255 : Math.round(255 * (y / 20) * (y / 20) * 0.6 + 255 * (y / 20) * 0.4);
  return [BG[0], BG[1], BG[2], Math.min(255, a)];
}));

/* rail: deckend links, 0.9 bei 60 %, 0 bei 100 % */
fs.writeFileSync(path.join(OUT, 'rail.png'), png(120, 720, function (x) {
  var f = x / 119, a = f <= 0.6 ? 1 - (f / 0.6) * 0.1 : 0.9 * (1 - (f - 0.6) / 0.4);
  return [BG[0], BG[1], BG[2], Math.round(255 * a)];
}));

/* ---------- Icon-Sprite ---------- */
// Formen = abgenommene Rail-/Button-Icons aus den Mockups (USER). Reihenfolge = Spalten-Index (src/ui/icons.js).
var ICONS = [
  ['search', '<circle cx="12" cy="12" r="7.5"/><path d="M17.5 17.5L24 24"/>', 's'],
  ['home', '<path d="M4 13L14 4.5 24 13v11h-7v-7h-6v7H4z"/>', 'sj'],
  ['film', '<rect x="4" y="6" width="20" height="16" rx="2"/><path d="M9 6v16M19 6v16M4 14h5M19 14h5"/>', 's'],
  ['tv', '<rect x="3" y="8" width="22" height="15" rx="2"/><path d="M10 3.5l4 4 4-4"/>', 'sj'],
  ['star', '<path d="M14 3l2.6 8.4L25 14l-8.4 2.6L14 25l-2.6-8.4L3 14l8.4-2.6z"/>', 'sj'],
  ['globe', '<circle cx="14" cy="14" r="10"/><ellipse cx="14" cy="14" rx="4.5" ry="10"/><path d="M4 14h20"/>', 's'],
  ['gear', '<circle cx="14" cy="14" r="4"/><path d="M14 3v4M14 21v4M3 14h4M21 14h4M6.2 6.2l2.8 2.8M19 19l2.8 2.8M6.2 21.8L9 19M19 9l2.8-2.8"/>', 's'],
  ['lock', '<g transform="translate(4 3)"><rect x="2" y="9" width="16" height="12" rx="2" fill="C" stroke="none"/><path d="M5.5 9V6.5a4.5 4.5 0 0 1 9 0V9"/></g>', 's'],
  ['confirm', '<path d="M6 14.5l5 5L22 8" stroke-width="2.6"/>', 'sj'],
  ['return', '<g transform="translate(6 6) scale(0.6667)"><path d="M20 5v7a4 4 0 0 1-4 4H5" stroke-width="2.6"/><path d="M9 11l-5 5 5 5" stroke-width="2.6"/></g>', 'sj'],
  ['backspace', '<path d="M10 6h14v16H10l-7-8z" stroke-width="2"/><path d="M14 11l6 6M20 11l-6 6" stroke-width="2"/>', 'sj'],
  ['info', '<circle cx="14" cy="14" r="10"/><path d="M14 13v6M14 9v0.5"/>', 's'],
  ['person', '<circle cx="14" cy="10" r="4.5"/><path d="M5 24c1.5-5 5-7 9-7s7.5 2 9 7"/>', 's'],
  ['tick', '<g transform="translate(6 6) scale(0.5714)"><path d="M6 14.5l5 5L22 8" stroke-width="4"/></g>', 'sj'],
  // Player-Knopfreihe (Mockup player-osd.html)
  ['play', '<path d="M9 5.5v17l14-8.5z" fill="C" stroke-width="1.6"/>', 'sj'],
  ['pause', '<rect x="7.5" y="5.5" width="4.5" height="17" rx="1" fill="C" stroke="none"/><rect x="16" y="5.5" width="4.5" height="17" rx="1" fill="C" stroke="none"/>', 's'],
  ['next', '<path d="M6 7v14l11-7z" fill="C" stroke-width="1.6"/><rect x="19" y="7" width="3.2" height="14" rx="1" fill="C" stroke="none"/>', 'sj'],
  ['chapters', '<path d="M6 8h16M6 14h16M6 20h10"/>', 's'],
  ['audio', '<path d="M5 11v6h4.5l5.5 4.5v-15L9.5 11z" stroke-width="2"/><path d="M18.5 10.5a5 5 0 0 1 0 7M21.5 7.5a9 9 0 0 1 0 13" stroke-width="2"/>', 'sj'],
  ['more', '<circle cx="7" cy="14" r="2.2" fill="C" stroke="none"/><circle cx="14" cy="14" r="2.2" fill="C" stroke="none"/><circle cx="21" cy="14" r="2.2" fill="C" stroke="none"/>', 's'],
  ['moon', '<path d="M20.5 17.5A8.5 8.5 0 0 1 10.5 6a8.5 8.5 0 1 0 10 11.5z" stroke-width="2"/>', 'sj'],
  // M4 Musik & Hoerbuecher (Jetzt laeuft)
  ['prev', '<path d="M22 7v14l-11-7z" fill="C" stroke-width="1.6"/><rect x="5.8" y="7" width="3.2" height="14" rx="1" fill="C" stroke="none"/>', 'sj'],
  ['shuffle', '<path d="M4 9h4.5c4 0 6.5 10 11 10H24M4 19h4.5c1.8 0 3.2-2 4.4-4.2M15.2 13.2C16.4 11 17.8 9 19.5 9H24" stroke-width="2"/><path d="M21 6l3 3-3 3M21 16l3 3-3 3" stroke-width="2"/>', 'sj'],
  ['repeat', '<path d="M5 15v-3a4 4 0 0 1 4-4h14M23 13v3a4 4 0 0 1-4 4H5" stroke-width="2"/><path d="M20 5l3 3-3 3M8 17l-3 3 3 3" stroke-width="2"/>', 'sj'],
  ['repeat1', '<path d="M5 15v-3a4 4 0 0 1 4-4h14M23 13v3a4 4 0 0 1-4 4H5" stroke-width="2"/><path d="M20 5l3 3-3 3M8 17l-3 3 3 3" stroke-width="2"/><path d="M13 12.5l1.6-1.2V17" stroke-width="1.8"/>', 'sj'],
  ['note', '<path d="M11 20V6.5l12-2.5v13" stroke-width="2"/><circle cx="8" cy="20" r="3" fill="C" stroke="none"/><circle cx="20" cy="17" r="3" fill="C" stroke="none"/>', 'sj'],
  ['book', '<path d="M14 7.5c-2.5-2-6-2.5-9-2v15c3-0.5 6.5 0 9 2 2.5-2 6-2.5 9-2v-15c-3-0.5-6.5 0-9 2zM14 7.5v15" stroke-width="2"/>', 'sj'],
  // P4 Entdecken (Seitenleiste)
  ['compass', '<circle cx="14" cy="14" r="10"/><path d="M18.6 9.4l-2.7 6.5-6.5 2.7 2.7-6.5z" stroke-width="2"/>', 'sj']
];
var COLORS = ['#858B92', '#B7BBC0', '#F2F2F2', '#141414'];   // Zeilen: text-3, text-2, text-1, on-accent
var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + (ICONS.length * 32) + '" height="' + (COLORS.length * 32) + '">';
COLORS.forEach(function (col, r) {
  ICONS.forEach(function (ic, i) {
    var body = ic[1].replace(/fill="C"/g, 'fill="' + col + '"');
    svg += '<g transform="translate(' + (i * 32 + 2) + ' ' + (r * 32 + 2) + ')" fill="none" stroke="' + col + '" stroke-width="2.2" stroke-linecap="round"' +
      (ic[2].indexOf('j') >= 0 ? ' stroke-linejoin="round"' : '') + '>' + body + '</g>';
  });
});
svg += '</svg>';
var tmp = path.join(require('os').tmpdir(), 'plexneo-icons.svg');
fs.writeFileSync(tmp, svg);
try {
  cp.execFileSync('rsvg-convert', ['-o', path.join(OUT, 'icons.png'), tmp]);
} catch (e) { console.error('rsvg-convert fehlt – icons.png nicht neu erzeugt'); }
fs.writeFileSync(path.join(OUT, 'icons.json'), JSON.stringify(ICONS.map(function (i) { return i[0]; })) + '\n');

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

/* ---------- QR ---------- */
var QR = require('qrcode');
QR.toFile(path.join(OUT, 'qr.png'), 'https://plex.tv/link', { errorCorrectionLevel: 'M', margin: 0, width: 264, color: { dark: '#0E0F11', light: '#FFFFFF' } }, function (err) {
  if (err) console.error('QR-Fehler', err);
  var scrimSrc = path.join(ROOT, 'app', 'scrim.png');
  if (!fs.existsSync(path.join(OUT, 'scrim.png')) && fs.existsSync(scrimSrc)) fs.copyFileSync(scrimSrc, path.join(OUT, 'scrim.png'));
  scrimDet();
  fs.readdirSync(OUT).forEach(function (f) { console.log(f, fs.statSync(path.join(OUT, f)).size + ' B'); });
});
