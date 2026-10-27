/* N.errs – EINE Abbildung Fehlerklasse -> Texte (SPEC 10.5, 14.12). Kinderprofil: Zusatz "Bitte frag einen Erwachsenen." (7.15.6) */
(function (N) {
  var ADULT = { server: 1, proxy: 1, auth: 1, profile: 1 };
  var E = {
    /* where: 'pms' | 'tv' (plex.tv ueber Proxy) */
    kind: function (err, where) {
      if (!err) return 'generic';
      if (err.status === 401) return 'auth';
      if (where === 'tv') return 'proxy';
      if (err.type === 'network' || err.type === 'timeout' || (err.type === 'http' && err.status >= 500)) return 'server';
      return 'generic';
    },
    /* -> {title, text} ; p: {server, n} */
    texts: function (kind, p, kids) {
      p = p || {};
      var text = N.t('err.' + kind + '.text', { server: p.server || '', n: p.n === undefined ? '' : p.n });
      if (kids && ADULT[kind]) text += ' ' + N.t('kids.askAdult');
      return { title: N.t('err.' + kind + '.title'), text: text };
    },
    proxyHost: function () { return N.config.proxyHost.split(':')[0]; }
  };
  N.errs = E;
})(N);
