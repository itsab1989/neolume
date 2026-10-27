/* N.evt – globaler Ereignisbus (watched:changed, auth:expired, net:offline/online, lang:changed, profile:changed …) */
(function (N) {
  var map = {};
  N.evt = {
    on: function (name, fn) { (map[name] = map[name] || []).push(fn); },
    off: function (name, fn) { var l = map[name] || [], i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); },
    emit: function (name, data) {
      var l = (map[name] || []).slice();
      for (var i = 0; i < l.length; i++) { try { l[i](data); } catch (e) { if (N.log) N.log('evt ' + name + ' error ' + e.message); } }
    },
    clear: function () { map = {}; },
    /* Anzahl angemeldeter Hoerer (P7 Leck-Test) */
    count: function () { var n = 0; for (var k in map) if (Object.prototype.hasOwnProperty.call(map, k)) n += map[k].length; return n; }
  };
})(N);
