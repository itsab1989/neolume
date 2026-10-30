/* N.libwatch – bemerkt, dass sich der Inhalt einer Bibliothek auf dem Server geaendert hat (SPEC HOME-12, LIB-10).
 * Signal des PMS selbst: /library/sections nennt je Bibliothek "contentChangedAt" (Zaehler, steigt bei jedem neuen, geaenderten
 * oder entfernten Titel; aeltere Server ohne das Feld: "updatedAt"). Kein eigenes Durchsuchen, keine grossen Listen.
 * - note(json): jede Antwort von /library/sections (auch die der Startseite, kostet nichts extra) gleicht die Stände ab; hat sich
 *   eine Bibliothek geaendert, kommt das Ereignis 'library:changed' {libs: ['2', …]}. Die erste Antwort je Server/Profil legt nur
 *   den Ausgangsstand fest.
 * - check(cb, maxAge): selbst nachsehen (eine kleine Anfrage), wenn der letzte Stand aelter als maxAge ist (Standard 60 s).
 * - want(fn): Bildschirme/Erweiterungen melden, ob sie Aenderungen gerade brauchen (Startseite oben, offene eigene Anfragen). Nur
 *   dann sieht ein Takt alle EVERY ms nach – nie waehrend ein Video laeuft, nie im Bildschirmschoner, nur in der Idle-Queue (nach
 *   Tastenruhe), nie zwei Anfragen gleichzeitig. */
(function (N) {
  var U = N.util, known = null, types = {}, where = '', lastAt = 0, waiting = null, wants = [], timer = 0;
  function key() { var s = N.session; return (N.plex && N.plex.base || '') + '|' + (s && s.profile ? s.profile.uuid : ''); }
  function sync() { var k = key(); if (k !== where) { where = k; known = null; types = {}; lastAt = 0; } }
  function wanted() { for (var i = 0; i < wants.length; i++) { try { if (wants[i]()) return true; } catch (e) { /* weiter */ } } return false; }
  function plan() { if (timer) clearTimeout(timer); timer = setTimeout(tick, W.EVERY); if (timer && timer.unref) timer.unref(); }   // unref: nur Node (Tests)
  function tick() {
    timer = 0;
    if (wanted() && W.quiet()) N.idle.add(function () { if (W.quiet()) W.check(null, W.EVERY - 5000); }, 'libwatch');
    if (wants.length) plan();
  }
  var W = {
    EVERY: 120000, MIN_AGE: 60000,
    /* /library/sections -> {Bibliothek: Stand} (rein) */
    sigs: function (json) {
      var l = json && json.MediaContainer && json.MediaContainer.Directory || [], o = {};
      for (var i = 0; i < l.length; i++) {
        var d = l[i];
        if (!d || d.key === undefined || d.key === null) continue;
        o[String(d.key)] = d.contentChangedAt !== undefined && d.contentChangedAt !== null ? 'c' + d.contentChangedAt : 'u' + (d.updatedAt || 0);
      }
      return o;
    },
    /* geaenderte Bibliotheken zwischen zwei Staenden (rein); ohne alten Stand: keine (Ausgangsstand); neue Bibliothek = geaendert */
    diff: function (a, b) {
      var out = [];
      if (!a || !b) return out;
      for (var k in b) if (a[k] !== b[k]) out.push(k);
      return out;
    },
    note: function (json) {
      sync();
      var s = W.sigs(json), ch = W.diff(known, s), l = json && json.MediaContainer && json.MediaContainer.Directory || [];
      for (var i = 0; i < l.length; i++) if (l[i] && l[i].key !== undefined) types[String(l[i].key)] = String(l[i].type || '');
      known = s; lastAt = U.now();
      if (ch.length) { if (N.log) N.log('libwatch geaendert: ' + ch.join(',')); N.evt.emit('library:changed', { libs: ch }); }
      N.evt.emit('library:seen', { dirs: l });         // HOME-13 (N.newWatch): eigener, gemerkter Stand je Bibliothek
      return ch;
    },
    /* Art einer Bibliothek ('movie' | 'show' | 'artist' …, '' = unbekannt) */
    type: function (id) { return types[String(id)] || ''; },
    /* letzter bekannter Stand einer Bibliothek ('' = unbekannt) */
    sig: function (id) { sync(); return known ? known[String(id)] || '' : ''; },
    age: function () { sync(); return lastAt ? U.now() - lastAt : Infinity; },
    check: function (cb, maxAge) {
      if (W.age() < (maxAge === undefined || maxAge === null ? W.MIN_AGE : maxAge) || !N.plex || !N.plex.base) { if (cb) cb(null); return; }
      if (waiting) { if (cb) waiting.push(cb); return; }
      waiting = cb ? [cb] : [];
      N.plex.get('/library/sections', null, { timeout: 10000, retries: 0 }, function (err, d) {
        var l = waiting; waiting = null;
        if (!err) W.note(d);
        for (var i = 0; i < l.length; i++) l[i](err || null);
      });
    },
    /* jetzt nachsehen erlaubt? kein Video, kein Bildschirmschoner, Profil aktiv */
    quiet: function () {
      if (!N.session || !N.session.profile) return false;
      var st = N.player && N.player.status ? N.player.status() : null;
      if (st && st.active) return false;
      if (N.router && N.router.topName && N.router.topName() === 'player') return false;
      return !(N.ui && N.ui.saver && N.ui.saver.on);
    },
    /* moechte gerade jemand Aenderungen sehen? (N.newWatch: Nachsehen im Video nur dann) */
    wanted: function () { return wanted(); },
    want: function (fn) { if (wants.indexOf(fn) < 0) wants.push(fn); if (!timer) plan(); },
    unwant: function (fn) { var i = wants.indexOf(fn); if (i >= 0) wants.splice(i, 1); if (!wants.length && timer) { clearTimeout(timer); timer = 0; } },
    _reset: function () { known = null; types = {}; where = ''; lastAt = 0; waiting = null; wants = []; if (timer) clearTimeout(timer); timer = 0; }
  };
  N.libwatch = W;
})(N);
