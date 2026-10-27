/* N.util – kleine Helfer ohne DOM-Abhaengigkeit beim Laden. */
(function (N) {
  if (!Function.prototype.bind) {
    Function.prototype.bind = function (ctx) {
      var fn = this, args = Array.prototype.slice.call(arguments, 1);
      return function () { return fn.apply(ctx, args.concat(Array.prototype.slice.call(arguments))); };
    };
  }
  var U = {};
  U.now = function () { return new Date().getTime(); };
  U.extend = function (dst, src) { for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) dst[k] = src[k]; return dst; };
  U.clamp = function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; };
  U.isArray = function (a) { return Object.prototype.toString.call(a) === '[object Array]'; };
  U.pad2 = function (n) { return n < 10 ? '0' + n : '' + n; };
  /* Query-String aus Objekt (undefined/null werden ausgelassen, Reihenfolge = Einfuegereihenfolge) */
  U.qs = function (obj) {
    var out = [], k;
    for (k in obj) if (Object.prototype.hasOwnProperty.call(obj, k) && obj[k] !== undefined && obj[k] !== null) out.push(encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]));
    return out.join('&');
  };
  U.addQs = function (url, obj) { var q = U.qs(obj || {}); return q ? url + (url.indexOf('?') >= 0 ? '&' : '?') + q : url; };
  U.uuid = function () {
    var s = '', i;
    for (i = 0; i < 16; i++) s += Math.floor(Math.random() * 16).toString(16);
    return 'plexneo-' + U.now().toString(36) + '-' + s;
  };
  U.trim = function (s, max) { s = String(s || ''); return s.length > max ? s.substring(0, max - 1) + '…' : s; };
  U.parse = function (text) { if (!text) return null; try { return JSON.parse(text); } catch (e) { return null; } };
  U.each = function (arr, fn) { for (var i = 0; arr && i < arr.length; i++) fn(arr[i], i); };

  /* ---- DOM-Helfer (nur zur Laufzeit im Browser benutzt) ---- */
  U.el = function (tag, cls, parent, css) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (css) e.style.cssText = css;
    if (parent) parent.appendChild(e);
    return e;
  };
  /* Element mit EINEM Textknoten; liefert den Textknoten (Aenderung spaeter nur per nodeValue) */
  U.txt = function (tag, cls, parent, text, css) {
    var e = U.el(tag, cls, parent, css), t = document.createTextNode(text || '');
    e.appendChild(t);
    return t;
  };
  U.setText = function (node, s) { s = s === undefined || s === null ? '' : String(s); if (node.nodeValue !== s) node.nodeValue = s; };
  /* Mehrzeiliger Text mit "…" am Ende (TV-Test 27.10., F13): CSS -webkit-line-clamp (Klasse .clamp), sonst einmal je Text in JS
   * kuerzen (Wortgrenzen, Halbierungssuche). Nur beim Setzen eines neuen Textes aufrufen, nie im Fokusschritt. */
  U.clampCss = (function () { try { return document.documentElement.style.webkitLineClamp !== undefined; } catch (e) { return true; } })();
  U.clampText = function (node, s) {
    s = s === undefined || s === null ? '' : String(s);
    U.setText(node, s);
    var el = node.parentNode;
    if (U.clampCss || !el || !s) return;
    var maxH = el.offsetHeight;
    if (!maxH || el.scrollHeight <= maxH + 1) return;
    var words = s.split(' '), lo = 0, hi = words.length - 1;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      node.nodeValue = words.slice(0, mid).join(' ') + ' \u2026';
      if (el.scrollHeight <= maxH + 1) lo = mid; else hi = mid - 1;
    }
    node.nodeValue = words.slice(0, lo).join(' ').replace(/[\s,;:.\-\u2013]+$/, '') + ' \u2026';
  };
  U.hasCls = function (el, c) { return (' ' + el.className + ' ').indexOf(' ' + c + ' ') >= 0; };
  U.cls = function (el, c, on) {
    var has = U.hasCls(el, c);
    if (on && !has) el.className = el.className ? el.className + ' ' + c : c;
    else if (!on && has) el.className = (' ' + el.className + ' ').replace(' ' + c + ' ', ' ').replace(/^\s+|\s+$/g, '');
  };
  U.show = function (el, on) { var v = on ? '' : 'none'; if (el.style.display !== v) el.style.display = v; };
  U.vis = function (el, on) { var v = on ? 'visible' : 'hidden'; if (el.style.visibility !== v) el.style.visibility = v; };
  U.tf = function (el, x, y, extra) { el.style.webkitTransform = 'translate3d(' + x + 'px,' + y + 'px,0)' + (extra || ''); };
  var raf = typeof window !== 'undefined' && (window.requestAnimationFrame || window.webkitRequestAnimationFrame);
  U.raf = function (fn) { return raf ? raf.call(window, fn) : setTimeout(fn, 16); };
  N.util = U;
})(N);
