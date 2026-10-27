/* N.ui.icon – Sprite-Spalten (Reihenfolge aus tools/make_assets.js / src/assets/icons.json) */
(function (N) {
  var COLS = { search: 0, home: 1, film: 2, tv: 3, star: 4, globe: 5, gear: 6, lock: 7, confirm: 8, ret: 9, backspace: 10, info: 11, person: 12, tick: 13, play: 14, pause: 15, next: 16, chapters: 17, audio: 18, more: 19, moon: 20, prev: 21, shuffle: 22, repeat: 23, repeat1: 24, note: 25, book: 26, compass: 27 };
  N.ui.ICONS = COLS;
  /* Icon-Element (32x32) erzeugen; state: 's1' (text-2), 's2' (text-1), 's3' (on-accent) oder '' (text-3, bzw. per Klasse am Elternteil) */
  N.ui.icon = function (parent, name, state, css) {
    var e = N.util.el('div', 'ic' + (state ? ' ' + state : ''), parent, css);
    e.style.backgroundPositionX = (-(COLS[name] || 0) * 32) + 'px';
    return e;
  };
  N.ui.setIcon = function (e, name) { e.style.backgroundPositionX = (-(COLS[name] || 0) * 32) + 'px'; };
  /* Avatar: Bild (PMS-Transcode des plex.tv-Avatars) oder Initiale auf Farbflaeche aus festem 8er-Satz */
  N.ui.avatarClass = function (name) {
    var s = String(name || '?'), h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffff;
    return 'av' + (h % 8);
  };
  N.ui.initial = function (name) { return String(name || '?').charAt(0).toUpperCase(); };
})(N);
