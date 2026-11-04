/* N.i18n – Sprachwahl, N.t(key, params), N.tn(key, n, params) (SPEC 10.0).
 * Kein stiller Fallback: fehlende Schluessel sind ein Build-Fehler; zur Laufzeit wird der Schluessel selbst angezeigt.
 * Plattform-Texte (optional N.platform.texts(lang, mode), SPEC NAV-26): einzelne Schluessel mit Geraete- bzw. Bedien-Wortlaut
 * ueberlagern (z. B. Apple: "Return" statt "OK", "dieser Mac" statt "dieser Fernseher"); mode = N.input.mode. Die Tabelle
 * wird nur beim Wechsel von Sprache oder Eingabeart neu geholt. Fernseher: keine Funktion -> genau wie bisher. */
(function (N) {
  var lang = 'de', table = null, warned = {}, ovl = null, ovlSig = null, pending = {};
  N.strings = N.strings || {};
  function overlay() {
    var p = N.platform, f = p && p.texts;
    if (!f) return null;
    var m = (N.input && N.input.mode) || '', sig = lang + ':' + m;
    if (sig !== ovlSig) { ovlSig = sig; ovl = f(lang, m) || null; }
    return ovl;
  }
  function fill(s, p) {
    if (!p && s.indexOf('{app}') < 0) return s;
    p = p || {};
    return s.replace(/\{(\w+)\}/g, function (m, k) {
      if (k === 'app' && p[k] === undefined) return N.brand ? N.brand.name : m;   // App-Name aus dem Marken-Profil
      return p[k] === undefined || p[k] === null ? m : String(p[k]);
    });
  }
  function raw(key) {
    var o = overlay(), v = o && o[key] !== undefined ? o[key] : table ? table[key] : undefined;
    if (v === undefined) {
      if (!warned[key] && N.log) { warned[key] = 1; N.log('i18n missing ' + lang + ':' + key); }
      return key;
    }
    return v;
  }
  N.t = function (key, params) {
    var v = raw(key);
    if (typeof v !== 'string') v = v.other;
    return fill(v, params);
  };
  N.tn = function (key, n, params) {
    var v = raw(key), p = N.util.extend({ n: n }, params || {});
    if (typeof v === 'string') return fill(v, p);
    return fill(n === 1 ? v.one : v.other, p);
  };
  N.i18n = {
    langs: ['de', 'en', 'nb'],                       // Reihenfolge = Sprachwahl in den Einstellungen (Primaersprache zuerst)
    lang: function () { return lang; },
    has: function (key) { return !!table && table[key] !== undefined; },
    set: function (l) {
      if (!N.strings[l]) l = 'de';
      lang = l; table = N.strings[l] || null;
    },
    /* Sprachtabellen liegen im Paket als eigene Dateien i18n/<lang>.js neben app.js (Build, TV-Leistung 03.11.: nur die aktive
     * Sprache wird geparst). load(l, cb): Tabelle per <script> nachladen, falls noch nicht da -> cb(ok, l). Ohne document
     * (Node-Tests: alle Tabellen aus dem Manifest) sofort. Mehrere Anfragen derselben Sprache teilen sich eine Ladung. */
    file: function (l) { return (N.assetBase || '') + 'i18n/' + l + '.js'; },
    load: function (l, cb) {
      if (N.i18n.langs.indexOf(l) < 0) l = 'de';
      if (N.strings[l]) { cb(true, l); return; }
      if (pending[l]) { pending[l].push(cb); return; }
      var d = typeof document !== 'undefined' ? document : null, t = 0, s;
      pending[l] = [cb];
      function fin(ok) {
        var list = pending[l];
        if (!list) return;
        delete pending[l]; if (t) clearTimeout(t);
        if (N.log) N.log('i18n ' + l + (ok && N.strings[l] ? ' geladen' : ' FEHLT (' + N.i18n.file(l) + ')'));
        for (var i = 0; i < list.length; i++) list[i](!!(ok && N.strings[l]), l);
      }
      if (!d || !d.createElement) { fin(false); return; }
      s = d.createElement('script');
      s.type = 'text/javascript';
      s.onload = function () { fin(true); };
      s.onerror = function () { fin(false); };
      t = setTimeout(function () { fin(false); }, 4000);
      s.src = N.i18n.file(l);
      (d.getElementsByTagName('head')[0] || d.documentElement).appendChild(s);
    },
    /* X-Plex-Language (Hub-Titel des Servers) und language= der Plex-Agenten; Norwegisch wie die Plex-Agenten: nb-NO (Bokmaal) */
    plexLanguage: function () { return lang === 'en' ? 'en-US' : lang === 'nb' ? 'nb-NO' : 'de-DE'; },
    /* Sprache fuer TMDB-Daten (Titel, Beschreibungen von Erweiterungen): TMDB fuehrt norwegische Texte fast nur unter 'no'
     * (nicht 'nb'), daher 'no' (Nutzerwunsch 03.11., 00-entscheidungen) */
    tmdbLanguage: function () { return lang === 'nb' ? 'no' : lang; },
    /* Land der App-Sprache: Altersfreigaben ("de/12"), Streaming-Region, Kino-Termine */
    country: function () { return lang === 'en' ? 'us' : lang === 'nb' ? 'no' : 'de'; },
    /* TV-/Systemsprache: Deutsch -> de, Englisch -> en, Norwegisch (Bokmaal, Nynorsk, "Norsk") -> nb, alles andere -> de
     * (SPEC 7.16.1). raw kann ein Locale-String ('de-DE', 'en_GB', 'nb-NO', 'ger', 'nor') oder ein Plugin-Wert sein. */
    detect: function (raw) {
      var s = String(raw === undefined || raw === null ? '' : raw).toLowerCase();
      if (/^(en|eng)([-_].*)?$/.test(s)) return 'en';
      if (/^(nb|no|nn|nob|nno|nor)([-_].*)?$/.test(s)) return 'nb';
      return 'de';
    }
  };
  N.i18n.set('de');
})(N);
