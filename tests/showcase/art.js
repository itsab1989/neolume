'use strict';
/* Showcase-Artwork (oeffentliche Screenshots, tools/showcase.js).
 * Erzeugt deterministisch SVG-Bilder fuer erfundene Titel: Poster 2:3, Hintergruende 16:9, Folgenbilder, Albumcover,
 * Hoerbuchcover, Profilbilder, Personenbilder und ein Videobild fuer den Player. Keine echten Logos, keine Fotos.
 * svg(kind, info) – kind: poster|backdrop|still|frame|album|book|avatar|person|chapter
 *                   info: {title, sub, seed, theme, credit}  (theme waehlt die Szene, seed die Variation) */

var PALETTES = {
  dusk:   ['#1b1340', '#4a2a6b', '#c0546d', '#f29e6b', '#ffd9a0'],
  sea:    ['#06263b', '#0f4c6b', '#2f8aa3', '#8fd0d2', '#f4efd8'],
  ember:  ['#1a0b0b', '#5c1a1b', '#b5382b', '#ee8a3c', '#ffd57e'],
  forest: ['#0d1f17', '#1f4a33', '#3e7d4f', '#a7c77d', '#f1ecc8'],
  ice:    ['#0b1a2e', '#24476e', '#5f8fc0', '#b8d8f0', '#f5fbff'],
  neon:   ['#0c0820', '#2a0f4a', '#7b1fa2', '#ff4f9a', '#4ff0ff'],
  sand:   ['#2b1d12', '#6b4a2b', '#c08a4f', '#e8c48e', '#fbf0da'],
  mint:   ['#0f2a2a', '#1d5c58', '#3fa38f', '#9fe0c2', '#f3fff6'],
  rose:   ['#2a0f1f', '#6b1f45', '#c2507a', '#f2a3b8', '#fff0f3'],
  gold:   ['#14110a', '#3d3216', '#8a6d26', '#d9b44a', '#fff4c8'],
  storm:  ['#0e1116', '#252c38', '#4b5a70', '#93a4b8', '#e6edf5'],
  candy:  ['#1d1b3a', '#3f3d8f', '#f25f5c', '#ffe066', '#70c1b3']
};
var THEMES = {           // Szene + Palette je Stichwort
  lighthouse: ['lighthouse', 'sea'], sea: ['waves', 'sea'], static: ['stripes', 'neon'], moon: ['moon', 'dusk'], orchard: ['trees', 'forest'],
  motel: ['city', 'neon'], city: ['city', 'dusk'], map: ['contours', 'sand'], fire: ['mountains', 'ember'], snow: ['mountains', 'ice'],
  space: ['orbits', 'neon'], clock: ['rings', 'gold'], forest: ['trees', 'forest'], desert: ['dunes', 'sand'], rain: ['rain', 'storm'],
  kids: ['bubbles', 'candy'], train: ['rails', 'dusk'], garden: ['flowers', 'rose'], river: ['waves', 'mint'], night: ['moon', 'storm'],
  sun: ['mountains', 'dusk'], fog: ['mountains', 'storm'], bridge: ['bridge', 'dusk'], bird: ['birds', 'ice'], music: ['rings', 'candy']
};

function rng(seed) {
  var h = 2166136261 >>> 0;
  for (var i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return function () { h += 0x6D2B79F5; var t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function wrap(text, max) {
  var words = String(text).split(/\s+/), lines = [], cur = '';
  words.forEach(function (w) { if (cur && (cur + ' ' + w).length > max) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; });
  if (cur) lines.push(cur);
  return lines;
}
function pick(r, a) { return a[Math.floor(r() * a.length) % a.length]; }

/* ---------- Szenen (Koordinaten im Rechteck w x h) ---------- */
function sky(id, p, w, h) {
  return '<defs><linearGradient id="' + id + 'sk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + p[0] + '"/><stop offset=".55" stop-color="' + p[1] + '"/>' +
    '<stop offset="1" stop-color="' + p[2] + '"/></linearGradient><radialGradient id="' + id + 'gl" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="' + p[4] + '" stop-opacity=".9"/>' +
    '<stop offset="1" stop-color="' + p[4] + '" stop-opacity="0"/></radialGradient></defs><rect width="' + w + '" height="' + h + '" fill="url(#' + id + 'sk)"/>';
}
function ridge(r, w, h, y0, amp, n, fill, op) {
  var d = 'M0 ' + h + ' L0 ' + y0, step = w / n;
  for (var i = 1; i <= n; i++) d += ' L' + (i * step).toFixed(1) + ' ' + (y0 - amp * (0.3 + r() * 0.9) * (i % 2 ? 1 : 0.35)).toFixed(1);
  return '<path d="' + d + ' L' + w + ' ' + h + ' Z" fill="' + fill + '"' + (op ? ' opacity="' + op + '"' : '') + '/>';
}
function wave(w, h, y0, amp, len, ph, fill, op) {
  var d = 'M0 ' + h + ' L0 ' + y0;
  for (var x = 0; x <= w; x += 8) d += ' L' + x + ' ' + (y0 + Math.sin(x / len + ph) * amp).toFixed(1);
  return '<path d="' + d + ' L' + w + ' ' + h + ' Z" fill="' + fill + '"' + (op ? ' opacity="' + op + '"' : '') + '/>';
}
function stars(r, w, h, n, col) {
  var s = '';
  for (var i = 0; i < n; i++) s += '<circle cx="' + (r() * w).toFixed(1) + '" cy="' + (r() * h * 0.55).toFixed(1) + '" r="' + (0.6 + r() * 1.6).toFixed(1) + '" fill="' + col + '" opacity="' + (0.4 + r() * 0.6).toFixed(2) + '"/>';
  return s;
}
function scene(name, p, r, w, h, id, right) {
  var s = sky(id, p, w, h), m = Math.min(w, h), i, x, y, cx = right ? w * 0.72 : w / 2;
  var sunX = right ? w * (0.62 + r() * 0.22) : w * (0.25 + r() * 0.5), sunY = h * (0.22 + r() * 0.2), sunR = m * (right ? 0.08 + r() * 0.05 : 0.12 + r() * 0.08);
  function glow(cx, cy, rr) { return '<circle cx="' + cx + '" cy="' + cy + '" r="' + rr * 2.4 + '" fill="url(#' + id + 'gl)" opacity=".55"/><circle cx="' + cx + '" cy="' + cy + '" r="' + rr + '" fill="' + p[4] + '"/>'; }
  switch (name) {
    case 'lighthouse':
      s += stars(r, w, h, 40, p[4]) + '<circle cx="' + sunX + '" cy="' + sunY + '" r="' + sunR * 0.6 + '" fill="' + p[4] + '" opacity=".85"/>';
      x = right ? w * (0.78 + r() * 0.1) : w * (0.55 + r() * 0.2); y = h * 0.62;
      if (right) {          // Hintergruende: unten liegen die Reihen der App darueber -> nur Meer, Mond und ein ferner Lichtkegel
        s += '<polygon points="' + x + ',' + h * 0.5 + ' ' + (x - w * 1.2) + ',' + h * 0.3 + ' ' + (x - w * 1.2) + ',' + h * 0.6 + '" fill="' + p[4] + '" opacity=".1"/>';
        s += '<circle cx="' + x + '" cy="' + h * 0.5 + '" r="' + m * 0.05 + '" fill="url(#' + id + 'gl)"/>' + ridge(r, w, h, h * 0.56, h * 0.06, 6, p[0]);
        for (i = 0; i < 3; i++) s += wave(w, h, h * (0.62 + i * 0.08), h * 0.012, w / (8 + i * 3), r() * 6, p[1 + (i % 2)], 0.85);
        break;
      }
      s += '<polygon points="' + x + ',' + (y - h * 0.02) + ' ' + (x - w * 1.2) + ',' + (y - h * 0.22) + ' ' + (x - w * 1.2) + ',' + (y + h * 0.08) + '" fill="' + p[4] + '" opacity=".16"/>';
      s += ridge(r, w, h, h * 0.72, h * 0.08, 5, p[0]);
      s += '<rect x="' + (x - m * 0.035) + '" y="' + (y) + '" width="' + m * 0.07 + '" height="' + h * 0.14 + '" fill="' + p[4] + '"/>';
      s += '<rect x="' + (x - m * 0.035) + '" y="' + (y + h * 0.045) + '" width="' + m * 0.07 + '" height="' + h * 0.025 + '" fill="' + p[2] + '"/>';
      s += '<rect x="' + (x - m * 0.025) + '" y="' + (y - h * 0.035) + '" width="' + m * 0.05 + '" height="' + h * 0.035 + '" fill="' + p[3] + '"/><circle cx="' + x + '" cy="' + (y - h * 0.018) + '" r="' + m * 0.04 + '" fill="url(#' + id + 'gl)"/>';
      for (i = 0; i < 3; i++) s += wave(w, h, h * (0.8 + i * 0.06), h * 0.012, w / (8 + i * 3), r() * 6, p[1 + (i % 2)], 0.85);
      break;
    case 'waves':
      s += glow(sunX, sunY, sunR);
      for (i = 0; i < 5; i++) s += wave(w, h, h * (0.55 + i * 0.09), h * (0.02 + r() * 0.025), w / (5 + r() * 6), r() * 6, p[i % 2 ? 2 : 1], 0.65 + i * 0.07);
      break;
    case 'moon':
      s += stars(r, w, h, 70, p[4]) + '<circle cx="' + sunX + '" cy="' + sunY + '" r="' + sunR + '" fill="' + p[4] + '"/><circle cx="' + (sunX + sunR * 0.4) + '" cy="' + (sunY - sunR * 0.15) + '" r="' + sunR * 0.92 + '" fill="' + p[1] + '"/>';
      s += ridge(r, w, h, h * 0.75, h * 0.12, 9, p[0], 0.9) + ridge(r, w, h, h * 0.85, h * 0.08, 14, '#000', 0.55);
      break;
    case 'stripes':
      for (i = 0; i < 18; i++) { y = r() * h; s += '<rect x="0" y="' + y.toFixed(1) + '" width="' + w + '" height="' + (1 + r() * h * 0.02).toFixed(1) + '" fill="' + pick(r, p.slice(2)) + '" opacity="' + (0.3 + r() * 0.6).toFixed(2) + '"/>'; }
      s += '<circle cx="' + cx + '" cy="' + h * 0.42 + '" r="' + m * 0.28 + '" fill="none" stroke="' + p[4] + '" stroke-width="' + m * 0.02 + '"/><circle cx="' + cx + '" cy="' + h * 0.42 + '" r="' + m * 0.18 + '" fill="' + p[3] + '" opacity=".85"/>';
      break;
    case 'trees':
      s += glow(sunX, sunY, sunR * 0.8);
      for (i = 0; i < 3; i++) {
        var base = h * (0.62 + i * 0.12), col = p[2 - i] || p[0];
        for (x = -20; x < w + 20; x += m * (0.06 + r() * 0.05)) { var th = h * (0.12 + r() * 0.12); s += '<polygon points="' + x + ',' + (base - th) + ' ' + (x - m * 0.05) + ',' + base + ' ' + (x + m * 0.05) + ',' + base + '" fill="' + col + '"/>'; }
        s += '<rect x="0" y="' + base + '" width="' + w + '" height="' + (h - base) + '" fill="' + col + '"/>';
      }
      break;
    case 'city':
      s += glow(sunX, sunY * 1.3, sunR);
      for (i = 0; i < 2; i++) for (x = 0; x < w;) {
        var bw = m * (0.06 + r() * 0.1), bh = h * (0.18 + r() * 0.3) * (i ? 0.7 : 1), by = h - bh - h * 0.06 * (1 - i);
        s += '<rect x="' + x.toFixed(1) + '" y="' + by.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + bh.toFixed(1) + '" fill="' + (i ? p[0] : p[1]) + '"/>';
        for (var wy = by + 8; wy < h - 10; wy += m * 0.035) for (var wx = x + 5; wx < x + bw - 6; wx += m * 0.03) if (r() > 0.55) s += '<rect x="' + wx.toFixed(1) + '" y="' + wy.toFixed(1) + '" width="' + (m * 0.012).toFixed(1) + '" height="' + (m * 0.016).toFixed(1) + '" fill="' + pick(r, [p[3], p[4]]) + '" opacity=".85"/>';
        x += bw + m * 0.01;
      }
      break;
    case 'contours':
      for (i = 0; i < 14; i++) s += '<ellipse cx="' + (right ? w * 0.72 : w * 0.55) + '" cy="' + h * 0.45 + '" rx="' + (m * 0.06 * i + 10) + '" ry="' + (m * 0.045 * i + 8) + '" fill="none" stroke="' + p[3 + (i % 2)] + '" stroke-width="2" opacity=".55" transform="rotate(' + (i * 4) + ' ' + (right ? w * 0.72 : w * 0.55) + ' ' + h * 0.45 + ')"/>';
      s += '<path d="M' + w * 0.1 + ' ' + h * 0.8 + ' C ' + w * 0.3 + ' ' + h * 0.4 + ', ' + w * 0.6 + ' ' + h * 0.9 + ', ' + w * 0.9 + ' ' + h * 0.25 + '" fill="none" stroke="' + p[2] + '" stroke-width="' + m * 0.012 + '" stroke-dasharray="' + m * 0.03 + ' ' + m * 0.02 + '"/>';
      s += '<circle cx="' + w * 0.9 + '" cy="' + h * 0.25 + '" r="' + m * 0.025 + '" fill="' + p[2] + '"/>';
      break;
    case 'orbits':
      s += stars(r, w, h, 90, p[4]);
      for (i = 1; i < 6; i++) s += '<ellipse cx="' + cx + '" cy="' + h * 0.45 + '" rx="' + m * 0.09 * i + '" ry="' + m * 0.035 * i + '" fill="none" stroke="' + p[4] + '" stroke-opacity=".35"/>';
      s += glow(cx, h * 0.45, m * 0.08);
      for (i = 1; i < 5; i++) { var a = r() * 6.28; s += '<circle cx="' + (cx + Math.cos(a) * m * 0.09 * i) + '" cy="' + (h * 0.45 + Math.sin(a) * m * 0.035 * i) + '" r="' + m * (0.012 + r() * 0.02) + '" fill="' + pick(r, p.slice(2)) + '"/>'; }
      break;
    case 'rings':
      for (i = 9; i > 0; i--) s += '<circle cx="' + cx + '" cy="' + h * 0.45 + '" r="' + m * 0.05 * i + '" fill="' + p[i % 5] + '" opacity=".9"/>';
      for (i = 0; i < 12; i++) { var an = i / 12 * 6.283; s += '<line x1="' + (cx + Math.cos(an) * m * 0.3) + '" y1="' + (h * 0.45 + Math.sin(an) * m * 0.3) + '" x2="' + (cx + Math.cos(an) * m * 0.38) + '" y2="' + (h * 0.45 + Math.sin(an) * m * 0.38) + '" stroke="' + p[4] + '" stroke-width="' + m * 0.012 + '"/>'; }
      break;
    case 'dunes':
      s += glow(sunX, sunY, sunR);
      for (i = 0; i < 4; i++) s += wave(w, h, h * (0.58 + i * 0.1), h * 0.05, w / (2 + r() * 2), r() * 6, p[3 - i] || p[0]);
      break;
    case 'rain':
      s += ridge(r, w, h, h * 0.7, h * 0.15, 7, p[1]);
      for (i = 0; i < 120; i++) { x = r() * w; y = r() * h; s += '<line x1="' + x.toFixed(1) + '" y1="' + y.toFixed(1) + '" x2="' + (x - 6).toFixed(1) + '" y2="' + (y + m * 0.05).toFixed(1) + '" stroke="' + p[4] + '" stroke-opacity=".35" stroke-width="1.5"/>'; }
      s += '<rect x="' + w * 0.6 + '" y="' + h * 0.55 + '" width="' + m * 0.05 + '" height="' + m * 0.05 + '" fill="' + p[3] + '" opacity=".9"/>';
      break;
    case 'bubbles':
      for (i = 0; i < 26; i++) s += '<circle cx="' + (r() * w).toFixed(1) + '" cy="' + (r() * h).toFixed(1) + '" r="' + (m * (0.03 + r() * 0.12)).toFixed(1) + '" fill="' + pick(r, p.slice(2)) + '" opacity="' + (0.55 + r() * 0.4).toFixed(2) + '"/>';
      s += wave(w, h, h * 0.8, h * 0.03, w / 6, 1, p[1]);
      break;
    case 'rails':
      s += glow(w / 2, h * 0.5, sunR);
      s += '<polygon points="' + w * 0.47 + ',' + h * 0.55 + ' ' + w * 0.53 + ',' + h * 0.55 + ' ' + w * 0.95 + ',' + h + ' ' + w * 0.05 + ',' + h + '" fill="' + p[0] + '"/>';
      for (i = 0; i < 10; i++) { y = h * 0.55 + Math.pow(i / 10, 1.8) * h * 0.45; var hw = (y - h * 0.55) / (h * 0.45) * w * 0.42 + w * 0.03; s += '<rect x="' + (w / 2 - hw) + '" y="' + y + '" width="' + hw * 2 + '" height="' + (2 + i * 1.2) + '" fill="' + p[2] + '" opacity=".7"/>'; }
      s += ridge(r, w, h * 0.58, h * 0.5, h * 0.06, 12, p[1], 0.9);
      break;
    case 'flowers':
      for (i = 0; i < 14; i++) {
        x = r() * w; y = h * (0.35 + r() * 0.6); var fr = m * (0.03 + r() * 0.05), fc = pick(r, p.slice(2));
        for (var k = 0; k < 6; k++) { var fa = k / 6 * 6.283; s += '<ellipse cx="' + (x + Math.cos(fa) * fr) + '" cy="' + (y + Math.sin(fa) * fr) + '" rx="' + fr * 0.7 + '" ry="' + fr * 0.4 + '" fill="' + fc + '" opacity=".85" transform="rotate(' + (fa * 57.3) + ' ' + (x + Math.cos(fa) * fr) + ' ' + (y + Math.sin(fa) * fr) + ')"/>'; }
        s += '<circle cx="' + x + '" cy="' + y + '" r="' + fr * 0.45 + '" fill="' + p[4] + '"/>';
      }
      break;
    case 'bridge':
      s += glow(sunX, sunY, sunR) + wave(w, h, h * 0.75, h * 0.01, w / 10, 0, p[1]);
      s += '<path d="M0 ' + h * 0.62 + ' Q ' + w / 2 + ' ' + h * 0.25 + ' ' + w + ' ' + h * 0.62 + '" fill="none" stroke="' + p[0] + '" stroke-width="' + m * 0.025 + '"/>';
      s += '<rect x="0" y="' + h * 0.62 + '" width="' + w + '" height="' + m * 0.025 + '" fill="' + p[0] + '"/>';
      for (i = 1; i < 12; i++) { x = i * w / 12; var yy = h * 0.62 - (1 - Math.pow((x - w / 2) / (w / 2), 2)) * h * 0.185; s += '<line x1="' + x + '" y1="' + yy + '" x2="' + x + '" y2="' + h * 0.62 + '" stroke="' + p[0] + '" stroke-width="2"/>'; }
      break;
    case 'birds':
      s += glow(sunX, sunY, sunR) + ridge(r, w, h, h * 0.8, h * 0.1, 10, p[1]);
      for (i = 0; i < 9; i++) { x = w * (0.2 + r() * 0.6); y = h * (0.2 + r() * 0.35); var bs = m * (0.02 + r() * 0.03); s += '<path d="M' + (x - bs) + ' ' + y + ' Q ' + (x - bs / 2) + ' ' + (y - bs / 2) + ' ' + x + ' ' + y + ' Q ' + (x + bs / 2) + ' ' + (y - bs / 2) + ' ' + (x + bs) + ' ' + y + '" fill="none" stroke="' + p[0] + '" stroke-width="' + Math.max(2, bs * 0.18) + '"/>'; }
      break;
    default:          // mountains
      s += glow(sunX, sunY, sunR);
      for (i = 0; i < 4; i++) s += ridge(r, w, h, h * (0.5 + i * 0.12), h * (0.22 - i * 0.03), 6 + i * 3, i === 3 ? p[0] : p[Math.max(0, 3 - i)], i ? 0.95 : 0.7);
  }
  return s;
}
function themeOf(info, r) {
  var t = THEMES[info.theme] || null;
  if (!t) { var keys = Object.keys(THEMES); t = THEMES[keys[Math.floor(r() * keys.length)]]; }
  var p = PALETTES[info.palette || t[1]];
  return { scene: info.scene || t[0], p: p };
}
var FONTS = ["Futura, 'Avenir Next', sans-serif", "Didot, 'Bodoni 72', serif", "'Gill Sans', 'Avenir Next', sans-serif", "Baskerville, Georgia, serif", "Rockwell, Georgia, serif", "'Avenir Next Condensed', 'Avenir Next', sans-serif"];

function doc(w, h, body) { return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' + body + '</svg>'; }
function text(x, y, size, fill, font, str, extra) {
  return '<text x="' + x + '" y="' + y + '" font-family="' + esc(font) + '" font-size="' + size + '" fill="' + fill + '" ' + (extra || '') + '>' + esc(str) + '</text>';
}

function poster(info) {
  var r = rng('p' + info.seed), t = themeOf(info, r), W = 400, H = 600, font = info.font !== undefined ? FONTS[info.font] : pick(r, FONTS), upper = /Futura|Gill|Condensed|Rockwell/.test(font);
  var title = upper ? String(info.title).toUpperCase() : info.title, lines = wrap(title, upper ? 12 : 14), size = lines.length > 2 ? 40 : lines.length > 1 ? 48 : 56;
  var longest = Math.max.apply(null, lines.map(function (l) { return l.length; })), cw = upper ? (/Rockwell|Futura/.test(font) ? 0.74 : 0.64) : (/Didot|Rockwell/.test(font) ? 0.6 : 0.52);
  size = Math.min(size, Math.floor(W * 0.86 / (longest * cw)));
  var body = scene(t.scene, t.p, r, W, H, 'p') + '<rect y="' + H * 0.55 + '" width="' + W + '" height="' + H * 0.45 + '" fill="url(#pfade)"/>';
  body = '<defs><linearGradient id="pfade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".78"/></linearGradient></defs>' + body;
  var y = H - 70 - (lines.length - 1) * size * 1.02;
  lines.forEach(function (l, i) { body += text(W / 2, y + i * size * 1.02, size, '#fff', font, l, 'text-anchor="middle" font-weight="' + (upper ? 600 : 400) + '" letter-spacing="' + (upper ? 2 : 0) + '"'); });
  if (info.sub) body += text(W / 2, 46, 15, 'rgba(255,255,255,.85)', "'Avenir Next', sans-serif", String(info.sub).toUpperCase(), 'text-anchor="middle" letter-spacing="4" font-weight="500"');
  body += text(W / 2, H - 28, 11, 'rgba(255,255,255,.6)', "'Avenir Next Condensed', 'Avenir Next', sans-serif", info.credit || 'A SHOWCASE PICTURE', 'text-anchor="middle" letter-spacing="2"');
  return doc(W, H, body);
}
function wide(info, salt, w, h, right) { var r = rng(salt + info.seed), t = themeOf(info, r); return doc(w, h, scene(info.sceneOverride || t.scene, t.p, r, w, h, 'w', right)); }
function square(info, book) {
  var r = rng((book ? 'b' : 'a') + info.seed), t = themeOf(info, r), S = 500, body = '';
  if (book) {
    var p = t.p, font = pick(r, ["Baskerville, Georgia, serif", "Didot, serif", "Georgia, serif"]);
    body += '<rect width="' + S + '" height="' + S + '" fill="' + p[1] + '"/>';
    body += '<g opacity=".9">' + scene(t.scene, p, r, S, S * 0.52, 'b') + '</g>';
    body += '<rect x="0" y="' + S * 0.52 + '" width="' + S + '" height="' + S * 0.48 + '" fill="' + p[0] + '"/><rect x="24" y="24" width="' + (S - 48) + '" height="' + (S - 48) + '" fill="none" stroke="' + p[4] + '" stroke-opacity=".6" stroke-width="2"/>';
    var lines = wrap(info.title, 18), sz = lines.length > 2 ? 34 : 40, y0 = S * 0.52 + 62;
    lines.forEach(function (l, i) { body += text(S / 2, y0 + i * sz * 1.1, sz, p[4], font, l, 'text-anchor="middle"'); });
    body += '<line x1="' + (S / 2 - 40) + '" y1="' + (y0 + lines.length * sz * 1.1 - 10) + '" x2="' + (S / 2 + 40) + '" y2="' + (y0 + lines.length * sz * 1.1 - 10) + '" stroke="' + p[3] + '" stroke-width="2"/>';
    body += text(S / 2, S - 54, 20, p[3], "'Avenir Next', sans-serif", String(info.sub || '').toUpperCase(), 'text-anchor="middle" letter-spacing="3"');
    return doc(S, S, body);
  }
  var pp = t.p, kind = Math.floor(r() * 4);
  body += '<rect width="' + S + '" height="' + S + '" fill="' + pp[kind === 3 ? 4 : 0] + '"/>';
  if (kind === 0) { for (var i = 0; i < 7; i++) body += '<circle cx="' + (r() * S) + '" cy="' + (r() * S) + '" r="' + (40 + r() * 160) + '" fill="' + pick(r, pp.slice(1)) + '" opacity=".75" style="mix-blend-mode:screen"/>'; }
  else if (kind === 1) { for (var j = 0; j < 10; j++) body += '<rect x="0" y="' + j * 50 + '" width="' + S + '" height="50" fill="' + pp[j % 5] + '" transform="skewY(' + (r() * 10 - 5).toFixed(1) + ')"/>'; }
  else if (kind === 2) body += scene(t.scene, pp, r, S, S, 'a');
  else { for (var k = 0; k < 4; k++) for (var l = 0; l < 4; l++) { var c = pick(r, pp.slice(0, 4)); body += (r() > 0.5 ? '<circle cx="' + (k * 125 + 62.5) + '" cy="' + (l * 125 + 62.5) + '" r="55" fill="' + c + '"/>' : '<rect x="' + (k * 125 + 8) + '" y="' + (l * 125 + 8) + '" width="109" height="109" fill="' + c + '"/>'); } }
  var dark = kind === 3 ? pp[0] : '#fff';
  body += '<rect x="0" y="' + (S - 110) + '" width="' + S + '" height="110" fill="' + (kind === 3 ? pp[4] : '#000') + '" opacity="' + (kind === 3 ? 0.92 : 0.45) + '"/>';
  body += text(30, S - 62, 34, dark, "'Avenir Next', sans-serif", info.title, 'font-weight="700"') + text(30, S - 26, 20, dark, "'Avenir Next', sans-serif", String(info.sub || '').toUpperCase(), 'letter-spacing="3" opacity=".8"');
  return doc(S, S, body);
}
function avatar(info) {
  var r = rng('v' + info.seed), p = PALETTES[info.palette || pick(r, Object.keys(PALETTES))], S = 320, body = '';
  body += '<defs><linearGradient id="vg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + p[3] + '"/><stop offset="1" stop-color="' + p[1] + '"/></linearGradient></defs><rect width="' + S + '" height="' + S + '" fill="url(#vg)"/>';
  var shape = info.shape || 'planet';
  if (shape === 'planet') body += '<circle cx="160" cy="165" r="78" fill="' + p[4] + '"/><ellipse cx="160" cy="165" rx="130" ry="30" fill="none" stroke="' + p[0] + '" stroke-width="12" transform="rotate(-18 160 165)"/><circle cx="235" cy="85" r="10" fill="' + p[4] + '"/>';
  else if (shape === 'mountain') body += '<circle cx="215" cy="105" r="36" fill="' + p[4] + '"/><polygon points="40,260 140,120 210,220 245,175 300,260" fill="' + p[0] + '"/><polygon points="140,120 120,150 160,150" fill="' + p[4] + '"/>';
  else if (shape === 'star') { var d = ''; for (var i = 0; i < 10; i++) { var a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? 44 : 104; d += (i ? 'L' : 'M') + (160 + Math.cos(a) * rr).toFixed(1) + ' ' + (168 + Math.sin(a) * rr).toFixed(1); } body += '<path d="' + d + 'Z" fill="' + p[4] + '" stroke="' + p[0] + '" stroke-width="8" stroke-linejoin="round"/><circle cx="140" cy="160" r="8" fill="' + p[0] + '"/><circle cx="180" cy="160" r="8" fill="' + p[0] + '"/><path d="M140 186 Q160 202 180 186" stroke="' + p[0] + '" stroke-width="6" fill="none" stroke-linecap="round"/>'; }
  else body += '<path d="M60 230 Q160 40 260 230 Z" fill="' + p[4] + '"/><path d="M100 230 Q160 110 220 230 Z" fill="' + p[0] + '" opacity=".6"/>';
  return doc(S, S, body);
}
function person(info) {
  var r = rng('h' + info.seed), p = PALETTES[pick(r, ['storm', 'sand', 'dusk', 'mint', 'rose', 'ice', 'gold'])], S = 240;
  var skin = pick(r, ['#f1c9a5', '#d9a77f', '#b07b55', '#8a5a3b', '#e7b98f', '#6b4428']), hair = pick(r, ['#2b1d14', '#5a3b22', '#a0703f', '#d8b36a', '#1a1a1a', '#7a7a7a']);
  var body = '<defs><radialGradient id="hg" cx=".5" cy=".35" r=".8"><stop offset="0" stop-color="' + p[3] + '"/><stop offset="1" stop-color="' + p[1] + '"/></radialGradient></defs><rect width="' + S + '" height="' + S + '" fill="url(#hg)"/>';
  body += '<path d="M30 240 Q40 170 120 165 Q200 170 210 240 Z" fill="' + p[0] + '"/>';
  body += '<rect x="104" y="138" width="32" height="34" fill="' + skin + '"/><ellipse cx="120" cy="108" rx="44" ry="52" fill="' + skin + '"/>';
  var style = Math.floor(r() * 3);
  if (style === 0) body += '<path d="M74 104 Q76 52 120 52 Q166 52 166 104 Q150 76 120 74 Q92 76 74 104 Z" fill="' + hair + '"/>';
  else if (style === 1) body += '<path d="M70 150 Q60 50 120 50 Q182 50 170 150 Q166 96 150 80 Q120 70 92 82 Q76 100 70 150 Z" fill="' + hair + '"/>';
  else body += '<path d="M76 92 Q84 56 120 56 Q158 56 164 92 Q140 70 120 70 Q98 70 76 92 Z" fill="' + hair + '"/>';
  body += '<circle cx="104" cy="110" r="4" fill="#2a1d16"/><circle cx="136" cy="110" r="4" fill="#2a1d16"/><path d="M108 134 Q120 142 132 134" stroke="#7a4a3a" stroke-width="3" fill="none" stroke-linecap="round"/>';
  return doc(S, S, body);
}

/* Folgenbilder: gleiche Palette wie die Serie, aber wechselnde Szenen (sonst sieht jede Folge gleich aus) */
var STILL_SCENES = ['mountains', 'waves', 'moon', 'trees', 'city', 'rain', 'bridge', 'birds', 'dunes', 'rails'];
function stillInfo(info) {
  var t = THEMES[info.theme] || THEMES.sea, r = rng('st' + info.seed), o = {};
  for (var k in info) o[k] = info[k];
  o.palette = info.palette || t[1];
  o.sceneOverride = r() < 0.3 ? t[0] : STILL_SCENES[Math.floor(r() * STILL_SCENES.length)];
  return o;
}
function svg(kind, info) {
  info = info || {}; info.seed = String(info.seed || info.title || kind);
  switch (kind) {
    case 'poster': return poster(info);
    case 'backdrop': return wide(info, 'w', 1600, 900, true);
    case 'still': return wide(stillInfo(info), 's', 640, 360);
    case 'frame': return wide(info, 'f', 1280, 720, false);
    case 'chapter': return wide(info, 'c', 320, 180);
    case 'album': return square(info, false);
    case 'book': return square(info, true);
    case 'avatar': return avatar(info);
    case 'person': return person(info);
  }
  return doc(16, 16, '<rect width="16" height="16" fill="#333"/>');
}
module.exports = { svg: svg, THEMES: THEMES, PALETTES: PALETTES };
