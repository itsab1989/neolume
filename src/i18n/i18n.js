/* N.i18n – Sprachwahl, N.t(key, params), N.tn(key, n, params) (SPEC 10.0).
 * Kein stiller Fallback: fehlende Schluessel sind ein Build-Fehler; zur Laufzeit wird der Schluessel selbst angezeigt. */
(function (N) {
  var lang = 'de', table = null, warned = {};
  function fill(s, p) {
    if (!p && s.indexOf('{app}') < 0) return s;
    p = p || {};
    return s.replace(/\{(\w+)\}/g, function (m, k) {
      if (k === 'app' && p[k] === undefined) return N.brand ? N.brand.name : m;   // App-Name aus dem Marken-Profil
      return p[k] === undefined || p[k] === null ? m : String(p[k]);
    });
  }
  function raw(key) {
    var v = table && table[key];
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
    langs: ['de', 'en'],
    lang: function () { return lang; },
    has: function (key) { return !!table && table[key] !== undefined; },
    set: function (l) {
      if (!N.strings[l]) l = 'de';
      lang = l; table = N.strings[l];
    },
    plexLanguage: function () { return lang === 'en' ? 'en-US' : 'de-DE'; },
    /* TV-Sprache: Deutsch -> de, Englisch -> en, alles andere -> de (SPEC 7.16.1).
     * raw kann ein Locale-String ('de-DE', 'en_GB', 'ger') oder ein Plugin-Wert sein. */
    detect: function (raw) {
      var s = String(raw === undefined || raw === null ? '' : raw).toLowerCase();
      if (/^(en|eng)([-_].*)?$/.test(s)) return 'en';
      return 'de';
    }
  };
  N.i18n.set('de');
})(N);
