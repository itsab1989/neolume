/* N.store – JSON-Dateien ueber den Loader-Speicher (ctx.store: Common-Dir + localStorage).
 * In-Memory mit Dirty-Flag; Schreiben entprellt >= 2 s im Leerlauf (nie im Tastenpfad), sofort bei onunload (SPEC 14.9). */
(function (N) {
  var U = N.util, backend = null, cache = {}, dirty = {}, bad = {}, timer = 0, DELAY = 2000, fails = 0;
  /* Datei vorhanden, aber kein gueltiges JSON (z. B. Strom weg beim Schreiben): Kopie aus localStorage versuchen (probe);
   * bleibt sie unlesbar, merkt bad[name] das (Pentest: pins.json durfte nicht still als "keine PINs" gelten). */
  function read(name) {
    if (Object.prototype.hasOwnProperty.call(cache, name)) return cache[name];
    var v = null, raw = null;
    try { raw = backend ? backend.read(name) : null; v = U.parse(raw); } catch (e) { v = null; }
    if (v === null && raw && raw !== 'null') {
      try { var pr = backend.probe && backend.probe(name); v = pr ? U.parse(pr.local) : null; } catch (e2) { v = null; }
      if (v === null) bad[name] = true;
    }
    cache[name] = v;
    return v;
  }
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      timer = 0;
      if (N.idle && N.idle.restFor() < DELAY) { schedule(); return; }   // Nutzer drueckt noch Tasten
      S.flush();
    }, DELAY);
  }
  var S = {
    init: function (b) { backend = b; cache = {}; dirty = {}; bad = {}; fails = 0; DELAY = 2000; },
    get: function (name) { return read(name); },
    /* true = Datei existiert, ist aber (auch in der localStorage-Kopie) unlesbar; bis zum naechsten set() */
    corrupt: function (name) { read(name); return !!bad[name]; },
    set: function (name, obj) { cache[name] = obj; dirty[name] = true; bad[name] = false; schedule(); },
    remove: function (name) { S.set(name, null); },
    isDirty: function () { for (var k in dirty) if (dirty[k]) return true; return false; },
    /* Schreibfehler (Pentest-Audit H2): Ausnahme oder write() === false bei vorhandenem Dateisystem (ohne Dateisystem, z. B.
     * Vorschau, gilt localStorage als Erfolg) -> Datei bleibt "dirty" und wird mit wachsendem Abstand erneut versucht. */
    flush: function () {
      if (timer) { clearTimeout(timer); timer = 0; }
      var failed = false;
      for (var k in dirty) if (dirty[k] && !S.flushFile(k)) failed = true;
      if (failed) { fails++; DELAY = Math.min(60000, 2000 * Math.pow(2, fails)); schedule(); } else { fails = 0; DELAY = 2000; }
    },
    /* eine Datei sofort schreiben -> true = liegt auf der Platte (z. B. pins.json: "PIN gespeichert" erst danach) */
    flushFile: function (k) {
      if (!dirty[k]) return true;
      var ok;
      try { ok = backend.write(k, JSON.stringify(cache[k] === undefined ? null : cache[k])); }
      catch (e) { ok = false; if (N.log) N.log('store write ' + k + ' ' + e.message); }
      if (ok === false && !backend.fs) ok = true;
      if (ok !== false) { dirty[k] = false; return true; }
      if (N.log) N.log('store write failed ' + k);
      return false;
    },
    /* Migration aus Meilenstein 1 (bench.js): device.json {id} + auth.json {token} */
    legacy: function () {
      var dev = read('device.json'), auth = read('auth.json');
      return { clientId: dev && dev.id ? dev.id : null, token: auth && auth.token ? auth.token : null };
    }
  };
  N.store = S;
})(N);
