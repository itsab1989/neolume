/* N.live – "Fernsehen" (SPEC A20, docs/research/live-tv.md): Livestreams oeffentlich-rechtlicher Sender, die ihr Programm selbst
 * frei und ohne Anmeldung im Netz zeigen. Kein IPTV, keine fremden Listen: nur Adressen, die der Sender in seinem eigenen Player
 * benutzt (Daten src/live/channels.js), auf Geraeten mit TLS 1.2 frisch ueber die offizielle Schnittstelle des Senders.
 * - Bereich "Fernsehen" (views/livetv.js) und Reihe "Fernsehen" der Startseite (N.hubs.buildRows 'tv'); Wiedergabe views/liveplayer.js.
 * - Senderlogos: Wikimedia Commons (PNG-Vorschau der Datei), geladen wie fremde Plakate ueber den Bild-Umrechner des PMS
 *   (/photo/:/transcode, exakte Groesse, kein TLS am Fernseher noetig) – nie in die App eingebaut.
 * - Zwischenspeicher: aufgeloeste Adresse je Sender 6 h (Speicher), Varianten der Master-Playlist 6 h, "Laeuft gerade" bis zum Ende
 *   der Sendung (hoechstens 30 min). Nichts davon im Tastenpfad; Anfragen erst beim Abspielen bzw. im Leerlauf.
 * - Kinderprofile: kein Fernsehen (Programme sind nicht nach Alter gefiltert, PRIN-8). */
(function (N) {
  var U = N.util, L = N.liveLogic, TTL = 6 * 3600000, EPG_MAX = 1800000;
  var streams = {}, masters = {}, epg = {}, epgBusy = {}, apiDead = {};
  function S() { return N.session; }
  function st() { var s = S(); return s && s.settings || {}; }
  function tls() { return !!(N.platform && N.platform.caps && N.platform.caps.tls12); }
  function native() { return N.platform && N.platform.net && N.platform.net.native || undefined; }
  /* Ton als eigene Spur (sep): kann der Player des Geraets das selbst (caps.liveSepAudio, Apple)? Sonst nur ueber den Helfer */
  function sepCap() { return !!(N.platform && N.platform.caps && N.platform.caps.liveSepAudio); }
  function fmp4Cap() { return !!(N.platform && N.platform.caps && N.platform.caps.liveFmp4); }
  function helperLive() { return !!(N.disc && N.disc.helperHas && N.disc.helperHas('live')); }
  var lastSep = null;
  var LV = {
    /* Fernsehen in diesem Profil an (Einstellung "Fernsehen", Standard aus; Erwachsene; Daten vorhanden). Aus = nichts davon: kein
     * Eintrag in der Seitenleiste und ihrem Editor, keine Reihe, keine Anfrage, kein Zeitgeber (SPEC LIVE-1) */
    on: function () { return st().liveTv === true; },
    allowed: function () { var s = S(); return !!(s && s.profile && L.allowed(s.isKid()) && LV.on() && L.data().channels.length); },
    regions: function () { return L.regions(st().liveRegions || null, LV.country()); },
    /* Land des Geraets (LIVE-7): Sprach-Tag des Systems bzw. Fernsehers (N.i18n.sys, z. B. "de-DE"), sonst die App-Sprache (Deutsch ->
     * Deutschland, Norwegisch -> Norwegen, Englisch -> unbekannt); Bildtests: Land der Demodaten. Plex meldet dem Geraet kein Land. */
    country: function () {
      var d = L.data(), I = N.i18n || {};
      return d.country || L.country(I.sys || '') || L.country(I.lang ? I.lang() : '');     // ohne Land im Tag: das der App-Sprache (de -> DE)
    },
    /* Hinweis fuer INFO, wenn der Standard der Rueckfall ist (fuer das Land gibt es keine Sender in den Daten) und nichts gewaehlt ist; sonst '' */
    regionNote: function () {
      if (st().liveRegions && st().liveRegions.length) return '';
      var c = LV.country();
      if (!L.noRegion(c)) return '';
      return c ? N.t('live.noRegion', { country: c }) : N.t('live.noCountry');
    },
    /* sep-Sender spielbar (SPEC LIVE-10): Player kann getrennten Ton, oder der Helfer ist erreichbar und kann 'live' */
    sepOk: function () { return sepCap() || helperLive(); },
    /* dieser Sender laeuft ueber den Helfer (nur sep-Sender auf Geraeten ohne caps.liveSepAudio) */
    viaHelper: function (ch) { return L.viaHelper(ch, sepCap()); },
    /* spielbare Sender der eingeschalteten Regionen; ohne Helfer fehlen am TV 2014 die mit getrenntem Ton (ARD/ZDF) */
    channels: function () { return LV.allowed() ? L.playableOnly(L.channels(LV.regions()), LV.sepOk(), fmp4Cap(), tls()) : []; },
    /* Zahl der Sender einer Region, die dieses Geraet (jetzt) spielen kann */
    /* Region im Regionen-Fenster anbieten (LIVE-12: keine "0 Sender" fuer Regionen, die dieses Geraet gar nicht spielen kann) */
    regionUsable: function (region) { return L.regionUsable(region, fmp4Cap(), tls()); },
    count: function (region) { return L.count(region, LV.sepOk(), fmp4Cap(), tls()); },
    /* wie viele Sender der eingeschalteten Regionen nur mit dem Helfer gehen (Statuszeile, INFO); 0 mit Helfer bzw. auf Apple */
    hidden: function () { return LV.allowed() ? L.helperOnly(L.channels(LV.regions()), LV.sepOk(), fmp4Cap(), tls()) : 0; },
    /* Helfer konfiguriert, aber noch nicht geprueft: einmal pruefen (3 s), Ergebnis kommt als N.evt 'live:avail' */
    checkHelper: function () { if (!sepCap() && N.disc && N.disc.helper && N.disc.helper() && N.disc.helperState() === 'unknown') N.disc.probeHelper(); },
    /* Startseiten-Reihe: Liste fuer den Editor (alle Sender der eingeschalteten Regionen) und die eingeschalteten in Reihenfolge */
    homeAvail: function () { return L.rows.avail(LV.channels()); },
    homeIds: function () { return L.rows.enabled(st().liveHome || null, LV.homeAvail()); },
    quality: function () { var q = String(st().liveQuality || 'auto'); return L.QUALITY.indexOf(q) >= 0 ? q : 'auto'; },
    /* Logo-Adresse (Commons-Vorschau als PNG, https; thumb.wikimedia.org: upload.wikimedia.org drosselte im Test mit 429); der Bildlader holt sie ueber den PMS (N.img.url mit it.logo) */
    logo: function (ch) {
      var f = ch && ch.logo, w = L.data().logoW || 330;
      if (!f) return '';
      var name = f.slice(f.lastIndexOf('/') + 1);
      return 'https://thumb.wikimedia.org/wikipedia/commons/thumb/' + f + '/' + w + 'px-' + name + (/\.svg$/i.test(name) ? '.png' : '');
    },
    /* Karte eines Senders (Reihe der Startseite, Raster im Bereich): Logo als Querformat-Bild, Name + "Laeuft gerade" als Beschriftung */
    item: function (ch) {
      var lg = LV.logo(ch), nn = LV.nowText(ch);
      return { rk: 'live:' + ch.id, type: 'live', live: ch.id, logo: !!lg, title: ch.name, still: lg, thumb: lg, art: '',
        sum: nn || LV.regionName(ch.region), sub: nn, vc: 0, off: 0, dur: 0, leaf: 0, vleaf: 0, child: 0, lib: 0, kind: '' };
    },
    regionName: function (id) { return N.t('live.region.' + id); },
    /* Eintraege des Regionen-Fensters (Bereich und Einstellungen): nur Regionen, die dieses Geraet spielen kann (LIVE-12);
     * Unterzeile = Zahl der jetzt spielbaren Sender + Hinweis auf Geosperre */
    regionEntries: function () {
      var cur = LV.regions(), on = {}, all = L.regionIds(), e = [], i;
      for (i = 0; i < cur.length; i++) on[cur[i]] = 1;
      for (i = 0; i < all.length; i++) {
        if (!LV.regionUsable(all[i])) continue;
        var r = L.region(all[i]);
        e.push({ id: all[i], t: LV.regionName(all[i]), on: !!on[all[i]], s: N.tn('live.region.n', LV.count(all[i])) + (r && r.geo ? ' · ' + N.t('live.region.geo') : '') });
      }
      return e;
    },
    /* Reihe "Fernsehen" der Startseite (N.hubs.buildRows) oder null (aus, keine Sender) */
    homeRow: function () {
      if (!LV.allowed()) return null;
      var ids = LV.homeIds(), items = [];
      for (var i = 0; i < ids.length; i++) { var ch = L.channel(ids[i]); if (ch) items.push(LV.item(ch)); }
      return items.length ? { id: 'tv', kind: 'land', tk: 'live.row', tp: null, items: items, live: true } : null;
    },

    /* ---------- Stream-Adresse ---------- */
    /* cb(err, {url (Master oder gewaehlte Variante), master, vars [], pick, src 'api'|'data'}) – Qualitaet aus der Einstellung bzw. q */
    resolve: function (id, q, cb) {
      var ch = L.channel(id);
      if (!ch) { cb({ type: 'gone' }); return; }
      if (LV.viaHelper(ch)) { LV.helperOpen(id, q, cb); return; }     // TV 2014 + getrennter Ton: Bild und Ton setzt der Helfer zusammen
      var T = tls(), p = L.plan(ch, T, apiDead[ch.api ? ch.api.t : ''] > 1), now = U.now(), c = streams[id];
      if (L.fresh(c, now, TTL)) { variants(c.url, c.src); return; }
      if (!p.api) { variants(p.url, 'data'); return; }
      // Fernseher ohne TLS 1.2: kurze Frist; scheitert die Schnittstelle zweimal, gilt in dieser Sitzung gleich die feste Adresse
      N.http.request({ url: L.apiUrl(p.api, T), timeout: T ? 8000 : 4000, retries: 0, xhr: native() }, function (err, json) {
        var u = !err && L.apiStream(p.api, json, L.data().hosts);
        if (u) { u = L.forTv(u, T); streams[id] = { url: u, at: U.now(), src: 'api' }; }
        else { apiDead[p.api.t] = (apiDead[p.api.t] || 0) + 1; N.log('live api ' + id + ' ' + (err ? err.type + ' ' + err.status : 'ohne Adresse') + ' -> feste Adresse'); }
        variants(u || p.url, u ? 'api' : 'data');
      });
      function variants(url, src) {
        var cap = L.capHeight(q === undefined ? LV.quality() : q), m = masters[url];
        if (!url) { cb({ type: 'nourl' }); return; }
        if (!cap) { cb(null, { url: url, master: url, vars: m ? m.vars : [], pick: null, src: src }); return; }
        if (m && L.fresh(m, U.now(), TTL)) { done(m.vars); return; }
        // Obergrenze: Master-Playlist lesen und die passende Variante waehlen (am Fernseher nur ueber http moeglich)
        if (!tls() && /^https:/i.test(url)) { done([]); return; }
        N.http.request({ url: url, json: false, timeout: 6000, retries: 0, xhr: tls() ? native() : undefined }, function (err, txt) {
          var v = err ? [] : L.variants(txt, url);
          if (v.length) masters[url] = { vars: v, at: U.now() };
          done(v);
        });
        function done(vars) { var pk = L.pick(vars, cap); cb(null, { url: pk ? L.forTv(pk.url, tls()) : url, master: url, vars: vars, pick: pk, src: src, split: !!(vars.length && vars[0].aud) }); }
      }
    },
    /* ---------- ueber den Helfer (SPEC LIVE-10) ----------
     * Am TV 2014 kann der Player Bild und getrennten Ton nicht zusammen abspielen (SEF-Ereignis 6). Der Helfer holt beides beim Sender
     * und liefert einen Strom mit Bild und Ton. Die App schickt nur die Kanal-ID und die Hoehe (nie eine Adresse); zurueck kommt ein
     * Pfad mit kurzlebigem Token (der Player kann keine Kopfzeilen setzen). cb(err {type:'helper', why}, {url, src:'helper', h}) */
    helperOpen: function (id, q, cb, again) {
      var D = N.disc, base = D && D.helper ? D.helper() : '', h = L.helperH(q === undefined ? LV.quality() : q);
      if (!base) { cb({ type: 'helper', why: 'none' }); return; }
      if (!helperLive() && D.helperState() !== 'ok' && !again) {               // als weg bzw. ungeprueft bekannt: jetzt neu pruefen (3 s), dann weiter
        D.probeHelper(function () { LV.helperOpen(id, q, cb, true); }, true); return;
      }
      if (!helperLive()) { cb({ type: 'helper', why: D.helperState() === 'down' ? 'down' : 'old' }); return; }
      var path = L.helperOpenPath(id, h);
      N.http.request({ url: base + path, timeout: 12000, retries: 0, no401: true, dedupe: false,
        headers: D.helperHeaders('GET', path, '') }, function (err, d) {             // signiert (Protokoll 2), kein Profil
        var why = err ? L.helperErr(err) : '', u = err ? '' : L.helperUrl(base, d);
        if (err && (why === 'down' || D.problemOf(err))) D.helperFail(err);        // ehrliche Meldung (z. B. App-Paket neu erstellen)
        if (!u) { N.log('live helfer ' + id + ' ' + (err ? (err.status || err.type) + ' ' + (err.body && err.body.error || '') : 'Antwort ungueltig')); cb({ type: 'helper', why: why || 'old' }); return; }
        cb(null, { url: u, master: u, vars: [], pick: { h: Number(d.h) || h }, src: 'helper', split: false });
      });
    },
    /* Sitzung im Helfer beenden (Senderwechsel weg vom Helfer, Schliessen); ohne Antwort abwarten. url = Adresse aus helperOpen */
    helperClose: function (url) {
      var s = L.helperSession(url), D = N.disc;
      if (!s || !D) return;
      N.http.request({ url: s, method: 'DELETE', timeout: 3000, retries: 0, no401: true, dedupe: false }, function () {});   // das Sitzungs-Token im Pfad ist der Schluessel (an diesen Client gebunden)
    },
    /* Varianten der Master-Playlist fuer INFO (nur wenn schon gelesen) */
    vars: function (url) { var m = masters[url]; return m ? m.vars : []; },
    /* aufgeloeste Adresse verwerfen (Wiedergabe scheiterte: beim naechsten Mal frisch bzw. feste Adresse) */
    forget: function (id) { delete streams[id]; },
    /* feste Adresse aus den Daten fuer diese Sitzung festhalten (die der Schnittstelle spielte nicht) */
    pin: function (id) { var ch = L.channel(id), p = L.plan(ch, tls()); if (p.url) streams[id] = { url: p.url, at: U.now(), src: 'data' }; },

    /* ---------- Laeuft gerade ----------
     * Programmdaten nur, wo der Sender sie offen anbietet (Daten: epg); sonst nichts. nowText(ch) liest nur den Zwischenspeicher. */
    now: function (ch) {
      var e = ch && epg[ch.id];
      if (!e) return null;
      var nn = L.nowNext(e.list, clockNow());
      return nn.now ? nn : null;
    },
    nowText: function (ch) { var n = LV.now(ch); return n && n.now ? n.now.t : ''; },
    /* Programmdaten fuer diese Sender holen, falls alt (im Leerlauf aufrufen); fertig -> N.evt 'live:epg' */
    epgFetch: function (ids) {
      if (!LV.allowed()) return;                       // aus: keine Anfrage (LIVE-1)
      if (N.config.liveDemo) { demoEpg(ids); return; }
      for (var i = 0; ids && i < ids.length; i++) one(L.channel(ids[i]));
      function one(ch) {
        if (!ch || !ch.epg || epgBusy[ch.id]) return;
        var e = epg[ch.id], now = clockNow();
        if (e && now - e.at < EPG_MAX && L.nowNext(e.list, now).now) return;
        var u = L.epgUrl(ch.epg, tls());                 // ARD programm-api: am Fernseher ueber http (dort ohne Umleitung)
        if (!u) return;
        epgBusy[ch.id] = true;
        N.http.request({ url: u, timeout: 8000, retries: 0, xhr: native() }, function (err, json) {
          epgBusy[ch.id] = false;
          var list = err ? null : L.epgParse(ch.epg, json);
          if (!list) return;
          epg[ch.id] = { list: list, at: clockNow() };
          N.evt.emit('live:epg', { id: ch.id });
        });
      }
    },
    /* Abspielen: Player fuer Sender id, CH▲/▼ blaettert durch list (Reihenfolge der Ansicht, aus der man kommt) */
    play: function (id, list) { N.router.push('liveplayer', { id: id, list: list && list.length ? list : [id] }); },
    _reset: function () { streams = {}; masters = {}; epg = {}; epgBusy = {}; apiDead = {}; lastSep = null; }
  };
  /* Helfer erreichbar geworden bzw. weg: aendert sich, welche Sender spielbar sind, -> 'live:avail' (Bereich und Reihe neu) */
  function helperChanged() {
    var now = LV.sepOk(), was = lastSep === null ? sepCap() : lastSep;   // vor der ersten Pruefung: ohne Helfer
    lastSep = now;
    if (was !== now && LV.allowed()) N.evt.emit('live:avail', { sep: now });
  }
  N.evt.on('helper:state', helperChanged);
  N.evt.on('helper:down', helperChanged);
  /* Jetzt (ms): Uhr des Servers bzw. des Geraets; im Bildtest (feste Uhr fixedClock) ein fester Zeitpunkt an dieser Uhrzeit –
   * sonst wanderten Sendezeiten und Fortschritt der Live-Szenen mit der echten Uhr (Befund 05.11.) */
  function clockNow() {
    var fc = N.config.fixedClock && /^(\d\d):(\d\d)$/.exec(N.config.fixedClock);
    if (fc && N.config.liveDemo) return new Date(2026, 9, 28, Number(fc[1]), Number(fc[2])).getTime();
    return N.clock ? N.clock.now() : U.now();
  }
  LV.clockNow = clockNow;
  /* Bildtests (config.json liveDemo): erfundene Sendungen um die feste Uhrzeit, kein Netz */
  function demoEpg(ids) {
    var now = clockNow(), names = L.data().demoEpg || [], t0 = now - 1200000;
    for (var i = 0; ids && i < ids.length; i++) {
      var nm = names[i % Math.max(1, names.length)];
      if (nm) epg[ids[i]] = { list: [{ t: nm, s: t0 - i * 300000, e: t0 + 3000000 }], at: now };
    }
    N.evt.emit('live:epg', { id: '' });
  }
  N.live = LV;
})(N);
