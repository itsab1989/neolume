/* N.diag – Diagnose-Protokoll (Nutzer-Anforderung M2):
 * - Ringpuffer (500 Eintraege) im Speicher; dauerhaft rotierend in plexneo/log-a.txt und log-b.txt (je max. 64 KB,
 *   bei voll wird die andere Datei geleert und weiterbeschrieben -> waechst nie).
 * - Stufen error/warn/info/debug. Release: nur warn+error dauerhaft; Dev: alles dauerhaft + an ctx.log.
 * - Zeile: ISO-Zeit, Bildschirm, Stufe, Text. Token, PINs und plex.tv-Codes werden VOR dem Speichern geschwaerzt.
 * - Schreiben verzoegert (Idle, >= 3 s), nie im Tastenpfad. */
(function (N) {
  var U = N.util, RING = 500, MAX = 65536, LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
  var D = {
    ring: [], dev: false, sink: null, backend: null, files: { a: '', b: '' }, cur: 'a', pending: [], timer: 0, loaded: false,
    /* reine Funktion: Geheimnisse schwaerzen */
    /* auch URL-kodiert (Proxy-URL ?url=https%3A…%3Fpin%3D1234%26X-Plex-Token%3D…): Trenner %3D / %3A, Grenze %3F / %26 / %22 */
    redact: function (s) {
      var SEP = '((?:%22)?(?:%3D|%3A)(?:%22)?|["\']?\\s*[:=]\\s*["\']?)', PRE = '(^|%3F|%26|%22|%2C|[^A-Za-z0-9_])';
      return String(s)
        .replace(new RegExp('(X-Plex-Token|accessToken|authToken|authenticationToken|token)' + SEP + '[^&"\'\\s,;}%]+', 'gi'), '$1$2***')
        .replace(new RegExp(PRE + '(pin)' + SEP + '[^&"\'\\s,;}%]+', 'gi'), '$1$2$3***')
        .replace(new RegExp(PRE + '(code)' + SEP + '[A-Za-z0-9]{4,8}(?![A-Za-z0-9])', 'gi'), '$1$2$3***')
        // oeffentliche IPv4-Adressen (weitere Server uebers Internet) nie ins Protokoll; Heimnetz-Adressen bleiben (Fehlersuche)
        .replace(/(^|[^0-9.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![0-9.])/g, function (m, pre, a, b) {
          a = Number(a); b = Number(b);
          var lan = a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 192 && b === 0) || a === 0;
          return lan ? m : pre + '<fern>';
        });
    },
    /* reine Funktion: Zeilen an die aktuelle Datei haengen, bei Ueberlauf rotieren. Rueckgabe {files, cur, wrote:[...]} */
    append: function (files, cur, lines, max) {
      max = max || MAX;
      var out = { a: files.a, b: files.b }, c = cur, wrote = {};
      for (var i = 0; i < lines.length; i++) {
        var l = lines[i] + '\n';
        if (l.length > max) l = l.substring(0, max - 2) + '…\n';
        if (out[c].length + l.length > max) { c = c === 'a' ? 'b' : 'a'; out[c] = ''; }
        out[c] += l; wrote[c] = 1;
      }
      return { files: out, cur: c, wrote: wrote };
    },
    init: function (backend, dev, sink) {
      D.backend = backend; D.dev = !!dev; D.sink = sink || null;
      try {
        D.files.a = backend && backend.read('log-a.txt') || '';
        D.files.b = backend && backend.read('log-b.txt') || '';
        var meta = U.parse(backend && backend.read('log.json'));
        D.cur = meta && (meta.cur === 'b') ? 'b' : 'a';
      } catch (e) { D.files = { a: '', b: '' }; }
      D.loaded = true;
    },
    line: function (level, msg) {
      var screen = '-';
      try { screen = N.router && N.router.topName() || '-'; } catch (e) {}
      return new Date(U.now()).toISOString() + ' ' + screen + ' ' + level.toUpperCase() + ' ' + D.redact(msg);
    },
    log: function (level, msg) {
      if (!LEVELS.hasOwnProperty(level)) level = 'info';
      var l = D.line(level, msg);
      D.ring.push(l);
      if (D.ring.length > RING) D.ring.shift();
      if (D.dev && D.sink) { try { D.sink(l); } catch (e) {} }
      if (D.dev || LEVELS[level] <= LEVELS.warn) { D.pending.push(l); D.schedule(); }
      return l;
    },
    error: function (msg, err) {
      var st = err && err.stack ? ' | ' + String(err.stack).split('\n').slice(0, 4).join(' / ') : '';
      return D.log('error', msg + (err && err.message ? ': ' + err.message : '') + st);
    },
    schedule: function () {
      if (D.timer || !D.backend) return;
      D.timer = setTimeout(function () {
        D.timer = 0;
        if (N.idle) N.idle.add(D.flush, 'diag-flush'); else D.flush();
      }, 3000);
    },
    flush: function () {
      if (!D.pending.length || !D.backend) return;
      var r = D.append(D.files, D.cur, D.pending);
      D.pending = [];
      D.files = r.files;
      try {
        for (var k in r.wrote) D.backend.write('log-' + k + '.txt', D.files[k]);
        if (r.cur !== D.cur) { D.cur = r.cur; D.backend.write('log.json', JSON.stringify({ cur: D.cur })); }
      } catch (e) {}
    },
    /* gesamter Text: aeltere Datei, aktuelle Datei, noch nicht geschriebene Zeilen */
    dump: function () {
      var other = D.cur === 'a' ? 'b' : 'a';
      return D.files[other] + D.files[D.cur] + (D.pending.length ? D.pending.join('\n') + '\n' : '');
    },
    clear: function () {
      D.ring = []; D.pending = []; D.files = { a: '', b: '' }; D.cur = 'a';
      if (D.backend) { try { D.backend.write('log-a.txt', ''); D.backend.write('log-b.txt', ''); D.backend.write('log.json', '{"cur":"a"}'); } catch (e) {} }
    },
    /* "Protokoll senden": nur auf ausdruecklichen Wunsch, POST an den konfigurierten Dev-/Update-Server */
    send: function (cb) {
      D.flush();
      var head = '# ' + N.config.product + ' ' + N.config.version + ' | ' + N.config.device + ' ' + (N.config.model || '') + ' | ' + new Date(U.now()).toISOString() +
        (N.clock ? ' | clock ' + N.clock.info() : '') + ' | lang=' + (N.i18n ? N.i18n.lang() : '') + ' | src=' + (N.app && N.app.source ? N.app.source : '');
      var body = head + '\n' + D.redact(D.dump() || D.ring.join('\n'));
      if (!N.config.validHost(N.config.logHost)) { cb(false, { type: 'config' }); return null; }   // nur an den konfigurierten Host
      return N.http.request({ method: 'POST', url: 'http://' + N.config.logHost + '/log', body: body, json: false, retries: 0, timeout: 10000,
        headers: { 'Content-Type': 'text/plain' } }, function (err) { cb(!err, err); });
    }
  };
  N.diag = D;
  N.log = function (m) { D.log('info', m); };
})(N);
