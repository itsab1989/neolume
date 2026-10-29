/* N.session – Konto, Server, Plex-Home-Profile, aktives Profil, Einstellungen je Profil, Start-Regeln (SPEC 7.15, 14.9).
 * state.json: {v, clientId, account{token,uuid,name,thumb}, server{uri,machineId,name,token}, users[], usersTs,
 *              profiles{uuid:{serverToken}}, lastProfile, lang, pinSwitch(null=Standard), protectRemindAt, firstPicker}
 * PMS-only (setup.json im Paket, N.setupFile): S.pkg gesetzt; Konto/Server/Profile/Tokens kommen aus dem Paket und stehen nur im
 * Speicher (save() schreibt sie nicht), kein plex.tv. PIN-Profile = eigene App-PIN (N.appPin). Ohne setup.json: alter Ablauf. */
(function (N) {
  var U = N.util, ST = 'state.json', DAY = 86400000;
  /* Wiedergabe (M3): alles abschaltbar, Standardwerte nach SPEC 10.4 bzw. Nutzer (Fortsetzen fragen, Vorschaubilder an) */
  var DEFAULT_SETTINGS = { episodeProgress: true, seriesProgress: true, reduceMotion: false,
    resume: 'ask', quality: '12', directPlay: true, thumbs: true, skipIntro: 'button', skipCredits: 'button', autoNext: true, countdown: 10,
    seekArrows: 10, seekFf: 30, ffrw: 'jump', ptrLoupe: false, loupeStyle: 'panel', rememberTracks: true, audioLang: 'de', subs: 'forced', subLang: 'de', ass: 'burn', anime: false,
    aspect: 'auto', subSize: 'medium', subPos: 'low', subBg: 'dim', stillWatching: 3,
    themeMusic: false, themeVol: 50 };   // Titelmelodie (SPEC v2.2): Nutzerentscheidung M3b Standard AUS
  var S = {
    state: null, profile: null, settings: null, own: null, pkg: null, setupStale: false,
    /* pkg: geprueftes setup.json (N.setupFile.parse().cfg) oder null (Entwicklungs-Paket -> plex.tv-PIN-Anmeldung) */
    load: function (pkg) {
      var st = N.store.get(ST);
      if (!st || st.v !== 1) {
        var leg = N.store.legacy();                 // Meilenstein-1-Anmeldung uebernehmen (kein Neu-Login am TV)
        st = { v: 1, clientId: leg.clientId || U.uuid(), account: leg.token ? { token: leg.token } : null, server: null,
          users: null, usersTs: 0, profiles: {}, lastProfile: null, lang: null, pinSwitch: null, protectRemindAt: 0, firstPicker: false };
        N.store.set(ST, st);
      }
      if (!st.profiles) st.profiles = {};
      // Alte Profil-Listen (ohne rp) hielten jedes eingeschraenkte Konto fuer ein Kind -> ohne Etikett anzeigen, bald neu laden
      for (var i = 0; st.users && i < st.users.length; i++) {
        var u = st.users[i];
        if (u.rp === undefined) { u.rp = ''; if (u.kind === 'kid') u.kind = ''; st.usersTs = 0; }
      }
      S.state = st;
      N.plex.clientId = st.clientId;
      S.pkg = null; S.setupStale = false;
      if (pkg) S.usePkg(pkg);
      return st;
    },
    /* ---- PMS-only: Profile + server-gebundene Tokens aus setup.json (nur im Speicher) ---- */
    usePkg: function (cfg) {
      var st = S.state, toks = {}, owner = null;
      S.pkg = cfg;
      N.appPin.bind(cfg.server.machineId, cfg.resetPins ? cfg.createdAt || cfg.id : '');   // PINs bleiben bei neuer Einrichtung, ausser "zuruecksetzen"
      for (var i = 0; i < cfg.profiles.length; i++) {
        toks[cfg.profiles[i].uuid] = { serverToken: cfg.profiles[i].token };
        if (cfg.profiles[i].kind === 'owner') owner = cfg.profiles[i];
      }
      st.account = null;                                     // altes plex.tv-Konto-Token (Entwicklung) nicht weiter aufheben
      st.users = N.setupFile.users(cfg, N.appPin.has); st.usersTs = U.now();
      st.server = { uri: cfg.server.uris[0], machineId: cfg.server.machineId, name: cfg.server.name, token: owner ? owner.token : null };
      st.profiles = toks;
      st.firstPicker = false;
      if (st.lastProfile && !S.user(st.lastProfile)) st.lastProfile = null;
      if (cfg.clientId) N.plex.clientId = cfg.clientId;      // Tokens wurden fuer diese Client-ID ausgegeben
      S.save();
    },
    /* App-PIN gesetzt/entfernt -> Schloss-Kennzeichen der Profile neu */
    refreshPins: function () {
      var u = S.users();
      for (var i = 0; i < u.length; i++) u[i].pin = S.pkg ? N.appPin.has(u[i].uuid) : u[i].pin;
      N.evt.emit('pins:changed');
    },
    save: function () {
      if (!S.pkg) { N.store.set(ST, S.state); return; }
      var c = U.extend({}, S.state);                         // Paket-Daten (Tokens, Profile, Server) nie in den Store
      c.account = null; c.server = null; c.users = null; c.usersTs = 0; c.profiles = {};
      N.store.set(ST, c);
    },
    signedIn: function () { return !!S.pkg || !!(S.state.account && S.state.account.token); },
    ready: function () { return S.signedIn() && !!S.state.server && !!S.state.users && S.state.users.length > 0; },
    users: function () { return S.state.users || []; },
    admin: function () { var u = S.users(); for (var i = 0; i < u.length; i++) if (u[i].admin) return u[i]; return null; },
    user: function (uuid) { var u = S.users(); for (var i = 0; i < u.length; i++) if (u[i].uuid === uuid) return u[i]; return null; },
    hasRestricted: function () { var u = S.users(); for (var i = 0; i < u.length; i++) if (u[i].kind === 'kid' || u[i].kind === 'teen') return true; return false; },
    isKid: function () { return !!(S.profile && (S.profile.kind === 'kid' || S.profile.kind === 'teen')); },
    /* Konto-Aktionen (Abmelden, "Profilwechsel nur mit PIN", Server) nur im Hauptkonto-Profil – verwaltete Konten ohne
     * Kinder-Einschraenkung (z. B. Robin, Jamie) sind keine Kinder, duerfen aber das Konto des TVs nicht aendern */
    isAdmin: function () { return !!(S.profile && S.profile.admin); },
    /* "Profilwechsel nur mit PIN" (SPEC 7.15.3): Standard an, sobald eingeschraenkte Profile existieren UND das Hauptkonto eine PIN hat */
    pinSwitchAvailable: function () { var a = S.admin(); return !!(a && a.pin); },
    pinSwitchOn: function () {
      if (!S.pinSwitchAvailable() || !S.hasRestricted()) return false;
      return S.state.pinSwitch === null || S.state.pinSwitch === undefined ? true : !!S.state.pinSwitch;
    },
    /* Dialog "Erwachsenenprofile schuetzen?" (SPEC 7.15.2): eingeschraenkte Profile, Hauptkonto ohne PIN, max. 1x/Woche */
    needsProtectHint: function (now) {
      var a = S.admin();
      return !!(a && !a.pin && S.hasRestricted() && (now || U.now()) >= (S.state.protectRemindAt || 0));
    },
    /* Start-Regeln (SPEC 7.15.4). Ergebnis: {route:'login'|'setup'|'profiles'|'home', user} */
    startRoute: function () {
      if (!S.signedIn()) return { route: 'login' };
      if (!S.ready()) return { route: 'setup' };
      var users = S.users(), last = S.user(S.state.lastProfile);
      if (users.length === 1) {
        var only = users[0], tok = S.cachedToken(only);
        if (!only.pin && tok) return { route: 'home', user: only };
        return { route: 'profiles' };
      }
      if (last && (last.kind === 'kid' || last.kind === 'teen') && S.pinSwitchOn() && S.cachedToken(last)) return { route: 'home', user: last };
      // Einstellung "Startprofil" (Nutzer-Feedback-Regel 9, P5): Hauptprofil ohne PIN (Standard mit setup.json) | zuletzt genutztes (ohne PIN) | Profilwahl
      var sp = S.startProfile(), su = sp === 'last' ? last : sp === 'main' ? S.admin() : null;
      if (su && (sp === 'main' || !su.pin) && S.cachedToken(su)) return { route: 'home', user: su };
      return { route: 'profiles' };
    },
    startProfile: function () { var v = S.state && S.state.startProfile; return v === 'main' || v === 'last' || v === 'picker' ? v : S.pkg ? 'main' : 'picker'; },
    cachedToken: function (u) { var p = u && S.state.profiles[u.uuid]; return p && p.serverToken || null; },
    /* PMS meldet 401 mit dem Profil-Token: nur diesen Token verwerfen (naechste Wahl holt ihn neu), Konto bleibt angemeldet */
    dropToken: function (uuid) {
      if (S.pkg) { if (uuid) delete S.state.profiles[uuid]; S.setupStale = true; return; }   // PMS-only: Einrichtung erneut ausfuehren
      if (uuid && S.state.profiles[uuid]) { delete S.state.profiles[uuid]; S.save(); }
    },
    /* Profil aktiv schalten: Token-Regel + Caches leeren (SPEC 7.15.5) */
    activate: function (user, serverToken) {
      S.profile = user;
      S.state.lastProfile = user.uuid;
      S.state.profiles[user.uuid] = { serverToken: serverToken };   // PMS-only: nur im Speicher (save() laesst es weg)
      S.state.firstPicker = false;
      S.save();
      N.plex.setServer(S.state.server.uri, serverToken);
      if (N.img) N.img.reset();
      S.own = N.store.get('settings-' + user.uuid + '.json') || {};
      S.applyDefaults();
      N.fx.setReduced(S.settings.reduceMotion);
      // Weitere Server dieses Profils (setup.json, optional): Bibliotheken aus dem Speicher, Adressen spaeter im Hintergrund pruefen
      if (N.srv) { var pp = S.pkgProfile(user.uuid); N.srv.setProfile(pp ? pp.servers : [], user.uuid); N.srv.start(); }
      N.evt.emit('profile:changed', user);
    },
    pkgProfile: function (uuid) {
      for (var i = 0; S.pkg && i < S.pkg.profiles.length; i++) if (S.pkg.profiles[i].uuid === uuid) return S.pkg.profiles[i];
      return null;
    },
    /* Einstellungen = Standard + eigene Wahl. Gespeichert wird nur, was das Profil selbst gewaehlt hat: So folgen Ton- und
     * Untertitelsprache der Oberflaechensprache, solange das Profil nie eine gewaehlt hat (TV-Test 27.10., F12). */
    applyDefaults: function () {
      var own = S.own || {}, l = N.i18n.lang() === 'en' ? 'en' : 'de';
      // Feinauswahl: die Form C "Feinleiste" ('bar') gibt es nicht mehr (TV-Befund 28.10.) -> gespeicherte Wahl entfernen = A (Standard)
      if (own.loupeStyle === 'bar') { delete own.loupeStyle; if (S.profile) N.store.set('settings-' + S.profile.uuid + '.json', own); }
      S.settings = U.extend(U.extend(U.extend({}, DEFAULT_SETTINGS), { audioLang: l, subLang: l }), own);
      if (own.stillWatching === undefined && S.isKid()) S.settings.stillWatching = 2;   // Kinderprofile: nach 2 Folgen nachfragen (SPEC 7.10)
      // Serien-Balken war bis 28.10. an "Folgen-Fortschritt" gekoppelt: wer das ausgeschaltet hatte, sieht ihn weiter nicht
      if (own.seriesProgress === undefined && own.episodeProgress === false) S.settings.seriesProgress = false;
      if (N.comfort && S.profile) N.comfort.applyDefaults(S.settings, S.isKid());   // P5-Standardwerte auch nach Sprachwechsel
    },
    setSetting: function (key, val) {
      if (!S.profile) return;
      S.settings[key] = val;
      S.own = S.own || {}; S.own[key] = val;
      N.store.set('settings-' + S.profile.uuid + '.json', S.own);
      N.evt.emit('settings:changed', { key: key, value: val });
    },
    homeCache: function () { return S.profile ? N.store.get('cache-home-' + S.profile.uuid + '.json') : null; },
    setHomeCache: function (obj) { if (S.profile) N.store.set('cache-home-' + S.profile.uuid + '.json', obj); },
    /* Katalog der Server-Hubs fuer "Startseite anpassen": {v:1, lang, ts, alibs, hubs:[...], pl:{title}|null} */
    hubCatalog: function () { return S.profile ? N.store.get('cache-hubs-' + S.profile.uuid + '.json') : null; },
    setHubCatalog: function (obj) { if (S.profile) N.store.set('cache-hubs-' + S.profile.uuid + '.json', obj); },

    /* ---- plex.tv-Ablaeufe (nur ausserhalb des Startpfads, wenn noetig) ---- */
    /* nach erfolgreicher Code-Anmeldung: Konto, Profile, Server. cb(err, {name}) */
    completeLogin: function (token, cb) {
      S.state.account = { token: token };
      S.state.users = null; S.state.server = null; S.state.profiles = {};
      S.setup(function (err) {
        if (err) { cb(err); return; }
        S.state.firstPicker = S.users().length > 1;
        S.save();
        cb(null, { name: S.state.account.name || '' });
      });
    },
    /* Konto + Profile + Server laden (Erstanmeldung, Migration oder Profil-Liste aelter als 24 h) */
    setup: function (cb) {
      var tok = S.state.account.token;
      N.auth.user(tok, function (err, me) {
        if (err) { cb(err); return; }
        U.extend(S.state.account, { uuid: me.uuid, name: me.name, thumb: me.thumb });
        function withUsers(users) {
          S.state.users = users; S.state.usersTs = U.now();
          N.auth.resources(tok, function (err2, servers) {
            if (err2) { cb(err2); return; }
            var pick = N.auth.pickServer(servers, S.state.server && S.state.server.machineId, N.config.pmsFallback);
            if (!pick && !N.config.pmsFallback) { cb({ type: 'noserver' }); return; }   // nie relative/leere Server-Adresse
            if (!pick) pick = { name: '', machineId: '', uri: N.config.pmsFallback, token: tok };
            S.state.server = pick;
            var a = S.admin();
            // Kontoinhaber: Server-Token direkt aus den Ressourcen
            for (var i = 0; i < users.length; i++) if (users[i].uuid === me.uuid && !users[i].pin) S.state.profiles[me.uuid] = { serverToken: pick.token || tok };
            if (a && a.uuid === me.uuid && !S.state.profiles[me.uuid]) S.state.profiles[me.uuid] = { serverToken: pick.token || tok, needPin: true };
            S.save();
            cb(null);
          });
        }
        if (!me.home) { withUsers([{ id: me.id, uuid: me.uuid, name: me.name, thumb: me.thumb, admin: true, restricted: false, pin: me.pinProtected, kind: 'main' }]); return; }
        N.auth.homeUsers(tok, function (e3, users) {
          if (e3) { cb(e3); return; }
          withUsers(users.length ? users : [{ id: me.id, uuid: me.uuid, name: me.name, thumb: me.thumb, admin: true, restricted: false, pin: me.pinProtected, kind: 'main' }]);
        });
      });
    },
    /* Profil-Liste im Hintergrund auffrischen (nie blockierend, nie im Startpfad). force: bei jedem Oeffnen der Profilwahl
     * (neue PINs gelten sofort, M5), hoechstens alle 30 s; sonst max. 1x/Tag. cb(users) nur bei Erfolg. */
    _usersBusy: false, _usersTry: 0,
    refreshUsers: function (force, cb) {
      var now = U.now();
      if (S.pkg || !S.signedIn() || S._usersBusy) return;   // PMS-only: Profile kommen aus setup.json
      if (force ? now - S._usersTry < 30000 : now - (S.state.usersTs || 0) < DAY) return;
      S._usersBusy = true; S._usersTry = now;
      var acc = S.state.account.token;
      N.auth.homeUsers(acc, function (err, users) {
        S._usersBusy = false;
        if (err || !users || !users.length || !S.state.account || S.state.account.token !== acc) return;
        S.state.users = users; S.state.usersTs = U.now(); S.save();
        if (cb) cb(users);
      });
    },
    refreshUsersLater: function () { S.refreshUsers(false); },
    /* Server-Token fuer ein Profil. Ohne PIN + gecacht: kein plex.tv. cb(err, serverToken) ; err.wrongPin bei falscher PIN */
    tokenFor: function (user, pin, cb) {
      var cached = S.cachedToken(user);
      if (S.pkg) {                                           // PMS-only: Token aus dem Paket, PIN = App-PIN, kein plex.tv
        if (!cached) { cb({ type: 'setup', authExpired: true }); return null; }
        if (!user.pin) { cb(null, cached); return null; }
        N.appPin.verify(user.uuid, pin, function (ok) { if (ok) cb(null, cached); else cb({ type: 'pin', wrongPin: true }); });
        return null;
      }
      if (!user.pin && cached && !(S.state.profiles[user.uuid] || {}).needPin) { cb(null, cached); return null; }
      return N.auth.switchUser(S.state.account.token, user.uuid, pin, function (err, userToken) {
        if (err) { cb(err); return; }
        N.auth.serverTokenFor(userToken, S.state.server.machineId, function (e2, serverToken) {
          if (e2 && e2.type === 'noserver' && user.admin) { cb(null, userToken); return; }
          cb(e2, serverToken);
        });
      });
    },
    /* Hauptkonto-PIN pruefen (Profilwechsel aus Kinderprofil, SPEC 7.15.3). cb(ok, err) */
    verifyAdminPin: function (pin, cb) {
      var a = S.admin();
      if (!a) { cb(false, { type: 'noadmin' }); return; }
      if (S.pkg) { N.appPin.verify(a.uuid, pin, function (ok) { cb(ok, ok ? null : { type: 'pin', wrongPin: true }); }); return; }
      N.auth.switchUser(S.state.account.token, a.uuid, pin, function (err) { cb(!err, err); });
    },
    leaveProfile: function () { if (N.srv) N.srv.setProfile([], ''); S.profile = null; S.settings = null; S.own = null; N.plex.setServer(S.state.server ? S.state.server.uri : '', null); if (N.img) N.img.reset(); },
    signOut: function () {
      var keep = { v: 1, clientId: S.state.clientId, account: null, server: null, users: null, usersTs: 0, profiles: {},
        lastProfile: null, lang: S.state.lang, pinSwitch: null, protectRemindAt: 0, firstPicker: false };
      S.state = keep; S.profile = null; S.settings = null; S.own = null;
      if (N.srv) N.srv.setProfile([], '');
      N.store.remove('auth.json');
      S.save();
      N.plex.setServer('', null);
      if (N.img) N.img.reset();
    }
  };
  N.session = S;
})(N);
