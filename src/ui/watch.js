/* N.watch – Gesehen/Ungesehen fuer Bibliothek, Details und Suche (SPEC 6.5, wie auf der Startseite):
 * Film/Folge ohne Rueckfrage + Toast "· Gelb: rückgängig" (6 s); Staffel/Serie immer mit Bestaetigung (Fokus Abbrechen).
 * Schreiben ueber N.plex.write (/:/scrobble bzw. /:/unscrobble; readOnly unterdrueckt). Ein Rueckgaengig-Fenster app-weit. */
(function (N) {
  var U = N.util, M = N.model, undo = null;
  function snapshot(it) { return { vc: it.vc, off: it.off, vleaf: it.vleaf }; }
  function restore(it, sn) { it.vc = sn.vc; it.off = sn.off; it.vleaf = sn.vleaf; }
  function apply(it, w) { if (M.isLeaf(it)) { it.vc = w ? Math.max(1, it.vc) : 0; it.off = 0; } else it.vleaf = w ? it.leaf : 0; }
  function scrobble(it, w, cb) { N.plex.write('GET', w ? '/:/scrobble' : '/:/unscrobble', { identifier: 'com.plexapp.plugins.library', key: it.rk }, cb, it.srv ? N.srv.who(it.srv) : undefined); }   // Weitere Server: auf DEM Server
  var W = {
    apply: apply,
    /* o: {changed(it, w) – Darstellung aktualisieren, reverted(it) – nach Fehler/Rueckgaengig, label (Dialog-Titel der Serie)} */
    toggle: function (it, o) {
      o = o || {};
      if (!M.isVideo(it)) return false;
      if (undo && U.now() < undo.until) { var u = undo; undo = null; N.ui.toast.hide(); u.revert(); return true; }
      var w = !M.watched(it);
      if (it.type === 'show' || it.type === 'season') {
        var show = it.type === 'show', key = (w ? 'dlg.mark' : 'dlg.unmark') + (show ? 'Show' : 'Season');
        N.ui.dialog.open({ title: N.t(key + '.title'), text: N.t(key + '.text', { n: it.leaf, show: o.label || it.title, s: it.s }),
          buttons: [{ id: 'cancel', t: N.t('dlg.mark.cancel') }, { id: 'ok', t: N.t('dlg.mark.confirm') }], focus: 0,
          onSelect: function (id) { if (id === 'ok') W.set(it, w, o); } });
        return true;
      }
      W.set(it, w, o);
      return true;
    },
    set: function (it, w, o) {
      var sn = snapshot(it);
      apply(it, w);
      if (o.changed) o.changed(it, w);
      scrobble(it, w, function (err) {
        if (!err) { N.evt.emit('watched:changed', { rk: it.rk, w: w }); return; }
        restore(it, sn); if (o.reverted) o.reverted(it); undo = null;
        N.ui.toast.show(N.t('toast.actionFailed'));
      });
      N.ui.toast.show(N.t(w ? 'toast.markedWatched' : 'toast.markedUnwatched'), { undo: true, icon: 'confirm' });
      undo = { until: U.now() + 6000, revert: function () {
        restore(it, sn); if (o.reverted) o.reverted(it);
        scrobble(it, !w, function () {});
        N.ui.toast.show(N.t('toast.undone'));
      } };
    },
    pending: function () { return !!(undo && U.now() < undo.until); },
    reset: function () { undo = null; }
  };
  N.watch = W;
})(N);
