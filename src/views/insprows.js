/* Ansicht 'insprows' – "Inspiration anpassen" (Entdecken, docs/research/discover.md "Inspiration"): welche Inspirations-Reihen der
 * leere Entdecken-Bildschirm zeigt und in welcher Reihenfolge, je Profil in settings.inspRows. Gleiche Liste wie "Startseite
 * anpassen" (N.rowsEditor): OK ein/aus, Gelb verschieben, "Standard wiederherstellen". Reihen aus N.insp.avail (Hub-Reihen nur,
 * wenn der Hub-Katalog des Servers die Familie kennt); Stufe-2-Reihen (plex.tv ueber den Helfer) erscheinen nur mit Helfer. */
(function (N) {
  N.router.define('insprows', N.rowsEditor({
    setting: 'inspRows',
    keys: { title: 'set.inspRows', how: 'set.ir.how', help: 'set.ir.help', resetDesc: 'set.ir.reset.desc', resetText: 'dlg.irReset.text' },
    avail: function (c) { return N.insp.avail(c.libs, c.cat, N.insp.helperOn()); },
    label: function (it) {
      var d = N.insp.def(it.id);
      if (d && d.genre !== undefined) return N.t('set.ir.name.genre' + (d.genre + 1));
      return d ? N.t(d.tk) : it.id;
    },
    val: function (it) { var d = N.insp.def(it.id); return d && d.list ? N.t('set.ir.val.plex') : ''; },
    desc: function (it) { return N.t('set.ir.' + it.id + '.desc'); }
  }));
})(N);
