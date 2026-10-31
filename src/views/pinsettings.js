/* N.pinSettings – eigene App-PIN je Profil in Einstellungen › Profil & Konto (nur PMS-only, setup.json; Nutzerentscheidung 26.10.).
 * - „PIN für dieses Profil“: jedes Nicht-Kinderprofil setzt seine eigene PIN; Ändern/Entfernen erst nach Eingabe der aktuellen PIN
 *   (Sperre 5 Versuche / 30 s je Profil, gemeinsam mit der Profilwahl ueber N.PinLogic key = uuid).
 * - „PINs aller Profile“ (nur Hauptprofil): fuer jedes andere Profil festlegen/aendern/entfernen ohne dessen alte PIN.
 * - Neue PIN zweimal eingeben; gespeichert wird nur die gesalzene Pruefsumme (N.appPin). Die Plex-PIN wird nie abgefragt. */
(function (N) {
  function S() { return N.session; }
  function toast(key) { N.ui.toast.show(N.t(key), { icon: 'confirm' }); }

  /* neue PIN zweimal eingeben -> speichern */
  function setNew(u, done) {
    N.ui.pinpad.open({ key: null, uuid: u.uuid, name: u.name, title: N.t('prof.pin.new', { name: u.name }), help: N.t('prof.pin.appHelp'),
      verify: function (pin, cb) { cb(true); },
      onSuccess: function (first) {
        N.ui.pinpad.open({ key: null, uuid: u.uuid, name: u.name, title: N.t('prof.pin.repeat'), help: N.t('prof.pin.appHelp'), wrongText: N.t('prof.pin.mismatch'),
          verify: function (pin, cb) {
            if (pin !== first) { cb(false); return; }
            N.appPin.set(u.uuid, pin, function (ok) { cb(ok, ok ? null : { type: 'store' }); });
          },
          onSuccess: function () { S().refreshPins(); toast('toast.pinSaved'); if (done) done(); } });
      } });
  }
  function remove(u, done) {
    N.ui.dialog.open({ title: N.t('dlg.pinRemove.title'), text: N.t('dlg.pinRemove.text', { name: u.name }),
      buttons: [{ id: 'rm', t: N.t('dlg.pinRemove.confirm') }, { id: 'cancel', t: N.t('dlg.pinRemove.cancel') }], focus: 1,
      onSelect: function (id) {
        if (id !== 'rm') return;
        if (!N.appPin.remove(u.uuid)) { N.ui.toast.show(N.t('toast.actionFailed'), { icon: 'info' }); return; }
        S().refreshPins(); toast('toast.pinRemoved'); if (done) done();
      } });
  }
  /* Profil mit PIN: Aendern / Entfernen; ohne PIN: gleich festlegen */
  function manage(u, done) {
    if (!N.appPin.has(u.uuid)) { setNew(u, done); return; }
    N.ui.panel.select({ title: u.name, selected: '', entries: [{ id: 'change', t: N.t('menu.pinChange') }, { id: 'remove', t: N.t('menu.pinRemove') }],
      onSelect: function (id) { if (id === 'change') setNew(u, done); else remove(u, done); } });
  }
  /* eigenes Profil: vorhandene PIN erst bestaetigen */
  function own(u, done) {
    if (!N.appPin.has(u.uuid)) { setNew(u, done); return; }
    N.ui.pinpad.open({ key: u.uuid, name: u.name, title: N.t('prof.pin.current', { name: u.name }), help: N.t('prof.pin.appHelp'), helpKey: 'help.pin.app',
      verify: function (pin, cb) { N.appPin.verify(u.uuid, pin, function (ok) { cb(ok); }); },
      onSuccess: function () { manage(u, done); } });
  }
  function all(done) {
    var users = S().users(), e = [];
    for (var i = 0; i < users.length; i++) e.push({ id: users[i].uuid, t: users[i].name, s: N.t(N.appPin.has(users[i].uuid) ? 'set.v.withPin' : 'set.v.noPin') });
    N.ui.panel.select({ title: N.t('set.appPins'), selected: '', entries: e, onSelect: function (uuid) {
      var u = S().user(uuid);
      if (!u) return;
      if (S().profile && u.uuid === S().profile.uuid) own(u, done); else manage(u, done);
    } });
  }
  function day(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return '';
    return N.i18n.lang() === 'de' ? m[3] + '.' + m[2] + '.' + m[1] : m[1] + '-' + m[2] + '-' + m[3];
  }

  N.pinSettings = {
    /* Zeilen an die Kategorie „Profil & Konto“ anhaengen (nur S().pkg). repaint() zeichnet die Werte neu. */
    rows: function (acc, repaint) {
      var me = S().profile;
      if (!me) return;
      acc.push({ id: 'apppin', type: 'action', label: 'set.appPin', desc: 'set.appPin.desc',
        val: function () { return N.t(N.appPin.has(me.uuid) ? 'set.on' : 'set.off'); }, run: function () { own(me, repaint); } });
      if (S().isAdmin()) acc.push({ id: 'apppins', type: 'action', label: 'set.appPins', desc: 'set.appPins.desc',
        val: function () {
          var u = S().users(), ids = [];
          for (var i = 0; i < u.length; i++) ids.push(u[i].uuid);
          return N.t('set.appPins.val', { n: N.appPin.count(ids), m: ids.length });
        }, run: function () { all(repaint); } });
    },
    setupRow: function () {
      return { id: 'setup', type: 'value', label: 'set.setup', desc: 'set.setup.desc', val: function () { return day(S().pkg && S().pkg.createdAt); } };
    },
    _day: day
  };
})(N);
