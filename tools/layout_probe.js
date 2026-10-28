/* Layout-Pruefung im Browser (nur Werkzeug, nicht Teil des TV-Pakets) – laeuft in tools/preview.html, wenn &probe=<URL> gesetzt ist.
 * Wird direkt vor dem Kopflos-Screenshot aufgerufen (onload des Halte-Bildes) und untersucht das sichtbare DOM:
 *   overlap  Text zweier verschiedener Elemente ueberlappt sich (beide an der Stelle sichtbar, nicht verdeckt)
 *   clip     Text wird abgeschnitten: Element mit overflow:hidden ist zu klein (ohne "…"/line-clamp) oder ragt aus einem
 *            abschneidenden Vorfahren heraus, obwohl das Element selbst darin liegt
 *   button   Text liegt ueber einem Bedienelement (Knopf, Karte, Eintrag), zu dem er nicht gehoert
 *   offscreen Text laeuft ueber den Bildschirmrand (1280 x 720)
 *   safe     Text ragt in den Titel-Sicherheitsrand (64 / 36 px)
 *   panel    zwei sichtbare Flaechen (Hintergrundfarbe) derselben Ebene ueberlappen sich teilweise (keine liegt ganz in der
 *            anderen; Overlays mit eigenem z-index wie Dialog/Panel/Leiste liegen bewusst ueber dem Inhalt)
 *   edge     eine Flaeche mit data-layout-edge="l,r,t,b" (z. B. Abdunklung des Bildschirmschoners) reicht nicht bis an diese
 *            Bildschirmraender (Luecke zwischen Abdunklung und Rand; nach allen Transformationen gemessen)
 *   notice   ein sichtbarer Hinweis, der nichts verdecken darf (Toast #pn-toast, sonst data-layout-notice), liegt ueber Text,
 *            der ohne ihn zu sehen waere (Toasts liegen ueber allem, gehoeren aber an eine freie Stelle)
 * Ergebnis: JSON per synchronem POST an &probe (tools/visual.js sammelt es ein und wertet es mit tools/layoutcheck.js aus).
 * Toleranz 2 px. Elemente mit data-layout-ok (optional: Liste der Arten, z. B. "overlap,safe") samt Inhalt werden uebersprungen.
 * Kein ES5-Zwang (laeuft nur in Firefox), aber im Stil der App gehalten. */
(function () {
  'use strict';
  var TOL = 2, W = 1280, H = 720, SX = 64, SY = 36;
  var NOTICE = '#pn-toast, [data-layout-notice]';
  var INTERACTIVE = '.btn,.card,.card-list,.card-list-sq,.chip,.key,.pkey,.ni,.np-b,.pe,.pl-b,.pl-skip,.prof,.set-cat,.set-row,.tab,.tl-row,.del,.ib';
  var csCache = [], opCache = [];

  function cs(e) { if (!e.__lcCs) { e.__lcCs = getComputedStyle(e); csCache.push(e); } return e.__lcCs; }
  function alpha(c) { var m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return c === 'transparent' ? 0 : 1; var p = m[1].split(/[ ,/]+/).filter(Boolean); return p.length > 3 ? parseFloat(p[3]) : 1; }
  function opacity(e) {                                  // effektive Deckkraft (inkl. Vorfahren)
    if (e.__lcOp !== undefined) return e.__lcOp;
    var s = cs(e), o = parseFloat(s.opacity); if (isNaN(o)) o = 1;
    if (s.visibility === 'hidden' || s.visibility === 'collapse') o = 0;
    var p = e.parentElement; e.__lcOp = p ? o * opacity(p) : o; opCache.push(e); return e.__lcOp;
  }
  function okAttr(e, type) {                             // data-layout-ok am Element oder einem Vorfahren
    for (; e && e.getAttribute; e = e.parentElement) {
      var v = e.getAttribute('data-layout-ok');
      if (v !== null) { if (!v || v.split(/[ ,]+/).indexOf(type) >= 0) return true; }
    }
    return false;
  }
  function path(e) {
    var out = [];
    for (; e && e.tagName && e.id !== 'root' && e !== document.body; e = e.parentElement) {
      var s = e.tagName.toLowerCase() + (e.id ? '#' + e.id : '');
      var cl = (typeof e.className === 'string' ? e.className : '').trim();
      if (cl) s += '.' + cl.split(/\s+/).join('.');
      out.unshift(s);
    }
    return out.join(' > ');
  }
  function R(l, t, r, b) { return { l: l, t: t, r: r, b: b }; }
  function rr(b) { return R(b.left, b.top, b.right, b.bottom); }
  function isect(a, b) { return R(Math.max(a.l, b.l), Math.max(a.t, b.t), Math.min(a.r, b.r), Math.min(a.b, b.b)); }
  function w(a) { return a.r - a.l; }
  function h(a) { return a.b - a.t; }
  function empty(a) { return w(a) <= 0.5 || h(a) <= 0.5; }
  function within(inner, outer, tol) { return inner.l >= outer.l - tol && inner.t >= outer.t - tol && inner.r <= outer.r + tol && inner.b <= outer.b + tol; }
  function unionR(a, b) { return a ? R(Math.min(a.l, b.l), Math.min(a.t, b.t), Math.max(a.r, b.r), Math.max(a.b, b.b)) : b; }
  function box(a) { return [Math.round(a.l), Math.round(a.t), Math.round(w(a)), Math.round(h(a))]; }

  /* Ist e Containing Block fuer ein absolut/fest positioniertes Kind? */
  function isCB(s, kind) {
    var tf = (s.transform && s.transform !== 'none') || (s.filter && s.filter !== 'none') || (s.perspective && s.perspective !== 'none');
    return kind === 'fixed' ? !!tf : tf || s.position !== 'static';
  }
  /* sichtbarer Ausschnitt fuer den Inhalt von e: Schnitt aller wirklich abschneidenden Vorfahren (overflow != visible).
   * Beruecksichtigt, dass absolut positionierte Elemente nur vom Containing Block und dessen Vorfahren beschnitten werden.
   * -> {r: Ausschnitt ohne Bildschirm, el: engstes abschneidendes Element} */
  function clipOf(e) {
    var c = R(-1e6, -1e6, 1e6, 1e6), el = null, skip = null, first = true;
    for (var a = e; a && a !== document.documentElement && a !== document.body; a = a.parentElement) {
      var s = cs(a);
      if (!first && skip) { if (isCB(s, skip)) skip = null; }
      if ((first || !skip) && a.id !== 'root') {
        var ox = s.overflowX !== 'visible', oy = s.overflowY !== 'visible';
        if (ox || oy) {
          var b = rr(a.getBoundingClientRect()), n = R(ox ? b.l : c.l, oy ? b.t : c.t, ox ? b.r : c.r, oy ? b.b : c.b), c2 = isect(c, n);
          if (c2.l !== c.l || c2.t !== c.t || c2.r !== c.r || c2.b !== c.b) { if (!el || w(c2) * h(c2) < w(c) * h(c)) el = a; }
          c = c2;
        }
      }
      if (s.position === 'absolute' && (!skip || skip === 'abs')) skip = 'abs';
      else if (s.position === 'fixed') skip = 'fixed';
      first = false;
    }
    return { r: c, el: el };
  }
  /* bewusst gekuerzt: "…" (text-overflow) oder line-clamp an e oder einem Vorfahren bis einschliesslich stop */
  function ellipsized(e, stop) {
    for (var a = e; a && a !== document.body; a = a.parentElement) {
      var s = cs(a), lc = s.webkitLineClamp || s.getPropertyValue('-webkit-line-clamp');
      if (s.textOverflow === 'ellipsis' || (lc && lc !== 'none')) return true;
      if (a === stop) break;
    }
    return false;
  }
  function occluder(e) {                                 // deckt e das darunterliegende ab?
    var s = cs(e), op = opacity(e);
    if (op < 0.85) return false;
    if (e.tagName === 'IMG' || e.tagName === 'CANVAS' || e.tagName === 'VIDEO') return true;
    if (alpha(s.backgroundColor) >= 0.85) return true;
    return /url\(/.test(s.backgroundImage || '');
  }
  /* ist der Inhalt von owner am Punkt x,y zu sehen (nicht von einer deckenden Flaeche ueberlagert)? */
  function shownAt(owner, x, y, skip) {          // skip: diese Flaeche samt Inhalt nicht als Abdeckung zaehlen
    var st = document.elementsFromPoint(x, y);
    for (var i = 0; i < st.length; i++) {
      var e = st[i];
      if (e === owner || e.contains(owner)) return true;
      if (owner.contains(e) || (skip && skip.contains(e))) continue;
      if (occluder(e)) return false;
    }
    return true;
  }
  function shownIn(owner, r, skip) {                     // Mitte und Viertelpunkte des Bereichs
    var cx = (r.l + r.r) / 2, cy = (r.t + r.b) / 2;
    return shownAt(owner, cx, cy, skip) || shownAt(owner, (r.l * 3 + r.r) / 4, cy, skip) || shownAt(owner, (r.l + r.r * 3) / 4, cy, skip);
  }

  /* Range-Rechtecke umfassen den ganzen Schriftkasten (ca. 1,2 em) – die Buchstaben selbst sind niedriger. Auf 0,95 em
   * (Oberlaenge bis Unterlaenge) mittig kuerzen, sonst "ueberlappen" eng gesetzte Zeilen (A–Z-Leiste), die sich nie beruehren. */
  function inkH(o) {
    var fs = parseFloat(cs(o).fontSize) || 16, ih = fs * 0.95;
    return function (q) { var d = (h(q) - ih) / 2; return d > 0 ? R(q.l, q.t + d, q.r, q.b - d) : q; };
  }
  /* Ebene: naechster Vorfahre (oder e selbst) mit eigenem z-index (Dialog, Panel, Leiste) bzw. der Bildschirm unter #root.
   * Flaechen verschiedener Ebenen liegen bewusst uebereinander (Overlay ueber Inhalt). */
  function layerOf(e) {
    for (var a = e; a && a.parentElement; a = a.parentElement) {
      if (a.parentElement.id === 'root' || a.parentElement === document.body) return a;
      var s = cs(a);
      if (s.zIndex !== 'auto' && s.position !== 'static') return a;
    }
    return a;
  }
  /* Karte und Beschriftung sind Geschwister (div.card + div.cap): die Beschriftung gehoert zur Karte daneben */
  function capOf(card, o) {
    for (var a = o; a && a !== document.body; a = a.parentElement) if (/(^| )cap( |$)/.test(a.className) && a.parentElement === card.parentElement) return true;
    return false;
  }

  function collect() {
    var root = document.getElementById('root') || document.body, items = [], byOwner = [];
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false), n, range = document.createRange();
    while ((n = tw.nextNode())) {
      if (!/\S/.test(n.nodeValue)) continue;
      var o = n.parentElement;
      if (!o || /^(SCRIPT|STYLE)$/.test(o.tagName)) continue;
      if (opacity(o) < 0.1 || alpha(cs(o).color) < 0.1) continue;
      range.selectNodeContents(n);
      var rs = range.getClientRects(), raw = [], ink = inkH(o);
      for (var i = 0; i < rs.length; i++) { var q = rr(rs[i]); if (!empty(q)) raw.push(ink(q)); }
      if (!raw.length) continue;
      var it = byOwner.indexOf(o) >= 0 ? items[byOwner.indexOf(o)] : null;
      if (!it) {
        var cl = clipOf(o);
        it = { o: o, raw: [], vis: [], clip: cl.r, clipEl: cl.el, text: '' };
        items.push(it); byOwner.push(o);
      }
      it.text += n.nodeValue.replace(/\s+/g, ' ');
      raw.forEach(function (q) {
        it.raw.push(q);
        var v = isect(isect(q, it.clip), R(0, 0, W, H));
        if (!empty(v)) it.vis.push(v);
      });
    }
    return items.filter(function (it) { return it.vis.length; });
  }
  function info(it, r) { return { p: path(it.o), s: it.text.trim().slice(0, 60), r: box(r || it.vis.reduce(function (a, b) { return unionR(a, b); }, null)) }; }
  function elInfo(e) { var t = (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60); return { p: path(e), s: t, r: box(rr(e.getBoundingClientRect())) }; }

  function run() {
    var t0 = Date.now(), out = [], items, pe = document.createElement('style');
    pe.textContent = '*{pointer-events:auto!important}';          // elementsFromPoint soll alles sehen
    document.head.appendChild(pe);
    try {
      items = collect();
      var scr = R(0, 0, W, H), i, j, k, m;
      /* overlap */
      for (i = 0; i < items.length; i++) for (j = i + 1; j < items.length; j++) {
        var A = items[i], B = items[j], hit = null;
        for (k = 0; k < A.vis.length; k++) for (m = 0; m < B.vis.length; m++) {
          var x = isect(A.vis[k], B.vis[m]);
          if (w(x) > TOL && h(x) > TOL) hit = unionR(hit, x);
        }
        if (!hit || okAttr(A.o, 'overlap') || okAttr(B.o, 'overlap')) continue;
        if (!shownIn(A.o, hit) || !shownIn(B.o, hit)) continue;
        out.push({ t: 'overlap', a: info(A), b: info(B), r: box(hit) });
      }
      /* clip */
      items.forEach(function (it) {
        var o = it.o, s = cs(o), d = null;
        if (okAttr(o, 'clip')) return;
        var ox = s.overflowX !== 'visible', oy = s.overflowY !== 'visible';
        if (!ellipsized(o, o)) {
          if (ox && o.scrollWidth > o.clientWidth + 1 && o.clientWidth > 0) d = 'breiter als sein Kasten (' + o.scrollWidth + ' > ' + o.clientWidth + ' px), ohne "…"';
          else if (oy && o.scrollHeight > o.clientHeight + TOL && o.clientHeight > 0) d = 'hoeher als sein Kasten (' + o.scrollHeight + ' > ' + o.clientHeight + ' px), ohne line-clamp';
        }
        if (!d && it.clipEl && it.clipEl !== o) {
          var ob = rr(o.getBoundingClientRect());
          for (k = 0; k < it.raw.length && !d; k++) {
            var q = it.raw[k], c = it.clip;
            var cut = q.l < c.l - TOL || q.r > c.r + TOL || q.t < c.t - TOL || q.b > c.b + TOL;
            if (cut && within(ob, c, TOL) && !ellipsized(o, it.clipEl)) d = 'ragt aus ' + path(it.clipEl).split(' > ').pop() + ' heraus und wird abgeschnitten';
          }
        }
        if (d && shownIn(o, it.vis[0])) out.push({ t: 'clip', a: info(it), r: info(it).r, d: d });
      });
      /* button */
      var ia = Array.prototype.slice.call(document.querySelectorAll(INTERACTIVE)).filter(function (e) { return opacity(e) >= 0.1; });
      ia.forEach(function (e) {
        var eb = rr(e.getBoundingClientRect()), cl = clipOf(e).r;
        eb = isect(isect(eb, cl), scr);
        if (empty(eb) || okAttr(e, 'button')) return;
        items.forEach(function (it) {
          if (e.contains(it.o) || it.o.contains(e) || capOf(e, it.o) || okAttr(it.o, 'button')) return;
          var hit = null;
          it.vis.forEach(function (q) { var x = isect(q, eb); if (w(x) > TOL && h(x) > TOL) hit = unionR(hit, x); });
          if (!hit || !shownIn(it.o, hit) || !shownIn(e, hit)) return;
          out.push({ t: 'button', a: info(it), b: elInfo(e), r: box(hit) });
        });
      });
      /* offscreen + safe */
      function crosses(e, side) {
        var b = rr(e.getBoundingClientRect());
        return side === 'l' ? b.l < -TOL : side === 'r' ? b.r > W + TOL : side === 't' ? b.t < -TOL : b.b > H + TOL;
      }
      function bleeds(o, side) {                         // Reihe laeuft bewusst ueber den Rand (Vorfahre ragt selbst hinaus)
        for (var a = o.parentElement; a && a.id !== 'root' && a !== document.body; a = a.parentElement) if (crosses(a, side)) return true;
        return false;
      }
      items.forEach(function (it) {
        var o = it.o, ob = rr(o.getBoundingClientRect()), done = false;
        ['l', 'r', 't', 'b'].forEach(function (side) {
          if (done) return;
          var vis = it.raw.map(function (q) { return isect(q, it.clip); }).filter(function (q) { return !empty(q); });
          var over = vis.some(function (q) { return side === 'l' ? q.l < -TOL : side === 'r' ? q.r > W + TOL : side === 't' ? q.t < -TOL : q.b > H + TOL; });
          if (over && !okAttr(o, 'offscreen') && (within(ob, scr, TOL) || !bleeds(o, side)) && shownIn(o, it.vis[0])) {
            out.push({ t: 'offscreen', a: info(it), r: info(it).r, d: { l: 'links', r: 'rechts', t: 'oben', b: 'unten' }[side] }); done = true; return;
          }
          if (over) { done = true; return; }
          var into = it.vis.some(function (q) { return side === 'l' ? q.l < SX - TOL : side === 'r' ? q.r > W - SX + TOL : side === 't' ? q.t < SY - TOL : q.b > H - SY + TOL; });
          if (into && !okAttr(o, 'safe') && !bleeds(o, side) && !crosses(o, side) && shownIn(o, it.vis[0])) {
            out.push({ t: 'safe', a: info(it), r: info(it).r, d: { l: 'links (64 px)', r: 'rechts (64 px)', t: 'oben (36 px)', b: 'unten (36 px)' }[side] }); done = true;
          }
        });
      });
      /* panel */
      var panels = [], all = root().getElementsByTagName('*');
      for (i = 0; i < all.length; i++) {
        var e = all[i], s = cs(e);
        if (s.display === 'none' || alpha(s.backgroundColor) < 0.5 || opacity(e) < 0.5 || okAttr(e, 'panel')) continue;
        var b = rr(e.getBoundingClientRect());
        if (w(b) < 24 || h(b) < 16) continue;
        var v = isect(isect(b, clipOf(e).r), scr);
        if (empty(v)) continue;
        panels.push({ e: e, b: b, v: v, ly: layerOf(e) });
      }
      for (i = 0; i < panels.length; i++) for (j = i + 1; j < panels.length; j++) {
        var P = panels[i], Q = panels[j];
        if (P.e.contains(Q.e) || Q.e.contains(P.e) || P.ly !== Q.ly) continue;
        var x2 = isect(P.v, Q.v);
        if (w(x2) <= TOL || h(x2) <= TOL) continue;
        if (within(P.b, Q.b, TOL) || within(Q.b, P.b, TOL)) continue;   // ganz drin = gewollte Ebene (Abzeichen, Dialog)
        if (!shownIn(P.e, P.v) || !shownIn(Q.e, Q.v)) continue;           // eine ist ganz verdeckt
        out.push({ t: 'panel', a: elInfo(P.e), b: elInfo(Q.e), r: box(x2) });
      }
      /* notice: Toast/Hinweis ueber Text, der ohne ihn sichtbar waere */
      var nts = document.querySelectorAll(NOTICE);
      for (i = 0; i < nts.length; i++) {
        var nt = nts[i], ns = cs(nt);
        if (ns.display === 'none' || opacity(nt) < 0.5 || okAttr(nt, 'notice')) continue;
        var nb = isect(rr(nt.getBoundingClientRect()), scr);
        if (empty(nb)) continue;
        items.forEach(function (it) {
          if (nt.contains(it.o) || it.o.contains(nt) || okAttr(it.o, 'notice')) return;
          var hit = null;
          it.vis.forEach(function (q) { var x = isect(q, nb); if (w(x) > TOL && h(x) > TOL) hit = unionR(hit, x); });
          if (!hit || !shownIn(it.o, hit, nt)) return;
          out.push({ t: 'notice', a: info(it), b: elInfo(nt), r: box(hit) });
        });
      }
      /* edge: markierte Flaechen muessen die genannten Raender erreichen (sichtbar, Deckkraft > 0) */
      var eds = root().querySelectorAll('[data-layout-edge]');
      for (i = 0; i < eds.length; i++) {
        var ee = eds[i];
        if (cs(ee).display === 'none' || opacity(ee) < 0.05 || okAttr(ee, 'edge')) continue;
        var eb2 = rr(ee.getBoundingClientRect()), gap = [];
        if (empty(eb2)) continue;
        ee.getAttribute('data-layout-edge').split(/[ ,]+/).forEach(function (sd) {
          var g = sd === 'l' ? eb2.l : sd === 'r' ? W - eb2.r : sd === 't' ? eb2.t : sd === 'b' ? H - eb2.b : 0;
          if (g > 0.5) gap.push({ l: 'links', r: 'rechts', t: 'oben', b: 'unten' }[sd] + ' ' + Math.round(g) + ' px');
        });
        if (gap.length) out.push({ t: 'edge', a: elInfo(ee), r: box(eb2), d: 'Luecke zum Rand: ' + gap.join(', ') });
      }
    } finally {
      pe.parentNode.removeChild(pe);
      csCache.forEach(function (e) { delete e.__lcCs; });
      opCache.forEach(function (e) { delete e.__lcOp; });
      csCache = []; opCache = [];
    }
    return { v: out, n: items.length, ms: Date.now() - t0 };
  }
  function root() { return document.getElementById('root') || document.body; }

  window.PN_PROBE_RUN = run;
  window.PN_PROBE = function () {
    var q = window.PN_Q || {}, res;
    try { res = run(); } catch (e) { res = { err: String(e && e.stack || e) }; }
    if (!q.probe) return res;
    try { var x = new XMLHttpRequest(); x.open('POST', q.probe, false); x.send(JSON.stringify(res)); } catch (e2) { /* Bericht fehlt -> visual.js meldet es */ }
    return res;
  };
})();
