/* N.liveLogic – reine Regeln fuer "Fernsehen" (SPEC A20, docs/research/live-tv.md): Regionen, Senderlisten, Auswahl der
 * Startseiten-Reihe, Aufloesung der Stream-Adresse (Antworten der offiziellen Sender-Schnittstellen), HLS-Varianten fuer die
 * Qualitaets-Obergrenze, "Laeuft gerade". Ohne DOM und ohne Netz, in Node getestet (tests/live.test.js).
 * Daten: N.liveData (src/live/channels.js) {regions: [{id, …}], channels: [{id, name, region, url, http, api, geo, logo, home, epg}]}.
 * Einstellungen je Profil: liveRegions [id] (null = Standard), liveHome [{id, on}] (null = Standard), liveQuality 'auto'|'1080'|'720'|'540'. */
(function (N) {
  var MAX_SAVED = 120;
  var QUALITY = ['auto', '1080', '720', '540'];
  /* Sprache ohne Land -> Land, in dem sie Amtssprache mit den meisten Sprechern ist (nur fuer den Standard der Regionen, LIVE-7) */
  var LANG_LAND = { de: 'DE', deu: 'DE', ger: 'DE', fr: 'FR', fra: 'FR', fre: 'FR', nb: 'NO', no: 'NO', nn: 'NO', nob: 'NO', nor: 'NO', it: 'IT', es: 'ES',
    nl: 'NL', da: 'DK', sv: 'SE', fi: 'FI', pl: 'PL', cs: 'CZ', pt: 'PT', ja: 'JP' };
  /* Senderdaten; Bildtests (config.json liveDemo) nehmen den erfundenen Satz N.liveDemo (kein Netz, feste Namen) */
  function data() { return (N.config && N.config.liveDemo && N.liveDemo) || N.liveData || { regions: [], channels: [] }; }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  var L = {
    QUALITY: QUALITY,
    data: data,
    /* Regionen in fester Reihenfolge (Daten) */
    regionIds: function () { var r = data().regions, o = []; for (var i = 0; i < r.length; i++) o.push(r[i].id); return o; },
    region: function (id) { var r = data().regions; for (var i = 0; i < r.length; i++) if (r[i].id === id) return r[i]; return null; },
    /* eingeschaltete Regionen (Reihenfolge der Daten): gespeichert, sonst der Standard fuer das Land (defaults); unbekannte fallen weg */
    regions: function (saved, country) {
      var all = L.regionIds(), o = [], on = {}, i, d = saved && saved.length ? saved : L.defaults(country);
      for (i = 0; i < d.length; i++) on[d[i]] = 1;
      for (i = 0; i < all.length; i++) if (on[all[i]]) o.push(all[i]);
      return o;
    },
    /* Standard-Regionen (LIVE-7): die Regionen, deren countries das Land des Geraets nennen; gibt es keine (Land ohne Daten oder
     * unbekannt), die Rueckfall-Regionen (fallback: true, "International"). -> [id] */
    defaults: function (country) {
      var r = data().regions, o = [], f = [], c = String(country || '').toUpperCase();
      for (var i = 0; i < r.length; i++) {
        if (c && r[i].countries && r[i].countries.indexOf(c) >= 0) o.push(r[i].id);
        if (r[i].fallback) f.push(r[i].id);
      }
      return o.length ? o : f;
    },
    /* Gilt der Rueckfall (fuer dieses Land gibt es keine Region in den Daten)? -> INFO erklaert es */
    noRegion: function (country) {
      var r = data().regions, c = String(country || '').toUpperCase();
      for (var i = 0; c && i < r.length; i++) if (r[i].countries && r[i].countries.indexOf(c) >= 0) return false;
      return true;
    },
    /* Land (ISO 3166, gross) aus dem Sprach-Tag des Geraets ("de-AT" -> AT, "en_GB" -> GB, "deu-DE"); nur Sprache -> deren Hauptland
     * (de -> DE, fr -> FR, nb/no/nn -> NO); Englisch allein und Unbekanntes -> '' (Land unbekannt, Rueckfall). Ziffern (Samsung-Enum) -> '' */
    country: function (tag) {
      var m = /^([a-z]{2,3})(?:[-_](?:[a-z]{4}[-_])?([a-z]{2}))?(?:[-_.@].*)?$/i.exec(String(tag || ''));
      if (!m) return '';
      if (m[2]) return m[2].toUpperCase();
      return LANG_LAND[m[1].toLowerCase()] || '';
    },
    channel: function (id) { var c = data().channels; for (var i = 0; i < c.length; i++) if (c[i].id === id) return c[i]; return null; },
    /* Sender der eingeschalteten Regionen in Daten-Reihenfolge (Region fuer Region) */
    channels: function (regions) {
      var c = data().channels, o = [], i, j;
      for (j = 0; regions && j < regions.length; j++) for (i = 0; i < c.length; i++) if (c[i].region === regions[j]) o.push(c[i]);
      return o;
    },
    /* Anzahl Sender je Region (fuer die Unterzeile im Regionen-Panel); sepOk/fmp4Ok false = nur die, die das Geraet spielen kann
     * (s. playable; ohne Angabe: alle) */
    count: function (region, sepOk, fmp4Ok, tlsOk) {
      var c = data().channels, n = 0;
      for (var i = 0; i < c.length; i++) if (c[i].region === region && L.playable(c[i], sepOk !== false, fmp4Ok !== false, tlsOk !== false)) n++;
      return n;
    },
    /* Region auf diesem Geraet anbieten? Nur, wenn mindestens ein Sender spielbar ist oder mit dem Helfer wuerde (LIVE-12: am TV 2014
     * z. B. Spanien und Oesterreich nur TLS 1.2, Schweden nur fMP4 -> nicht im Regionen-Fenster statt "0 Sender") */
    regionUsable: function (region, fmp4Ok, tlsOk) { return L.count(region, true, fmp4Ok, tlsOk) > 0; },

    /* ---------- Ton als eigene Spur (sep, ARD/ZDF; SPEC LIVE-10) ----------
     * Spielbar ist ein Sender, wenn sein Ton im Bildstrom liegt oder etwas den getrennten Ton dazunimmt: der Player des Geraets
     * (caps.liveSepAudio, z. B. Apple) oder der Helfer im Heimnetz (Faehigkeit 'live': setzt Bild und Ton zu einem Strom zusammen).
     * Ohne beides fehlt der Sender ueberall (Raster, Reihe, Editor, Zappen) – ein Sender ohne Ton waere schlimmer als keiner. */
    /* fmp4: Stuecke als fragmentiertes MP4 (EXT-X-MAP; NHK World, ERT World, SVT) – das kann nur ein Player mit caps.liveFmp4,
     * der Helfer setzt nur MPEG-TS zusammen (fmp4Ok undefined = ja, fuer reine Logik-Aufrufe);
     * tls12: Adressen nur ueber TLS >= 1.2 (LIVE-12, RTVE, ORF): ohne caps.tls12 nicht spielbar, ausser ein sep-Sender ueber den Helfer
     * (der holt mit Python, TLS 1.2); tlsOk undefined = ja. Diese Sender zaehlen nirgends mit, auch nicht in "x weitere mit dem Helfer" */
    playable: function (ch, sepOk, fmp4Ok, tlsOk) {
      return !!ch && (!ch.sep || !!sepOk) && (!ch.fmp4 || fmp4Ok !== false) && (!ch.tls12 || tlsOk !== false || (!!ch.sep && !!sepOk));
    },
    /* nur die spielbaren (Reihenfolge bleibt) */
    playableOnly: function (chs, sepOk, fmp4Ok, tlsOk) { var o = []; for (var i = 0; chs && i < chs.length; i++) if (L.playable(chs[i], sepOk, fmp4Ok, tlsOk)) o.push(chs[i]); return o; },
    /* wie viele davon erst der Helfer spielbar machte (getrennter Ton in MPEG-TS) */
    helperOnly: function (chs, sepOk, fmp4Ok, tlsOk) {
      var n = 0;
      for (var i = 0; !sepOk && chs && i < chs.length; i++) if (chs[i].sep && !L.playable(chs[i], false, fmp4Ok, tlsOk) && L.playable(chs[i], true, fmp4Ok, tlsOk)) n++;
      return n;
    },
    /* ueber den Helfer abspielen? Nur sep-Sender und nur, wenn der Player des Geraets den getrennten Ton nicht selbst kann */
    viaHelper: function (ch, sepCap) { return !!(ch && ch.sep && !ch.fmp4 && !sepCap); },
    /* Hoehe fuer den Helfer: die Grenze aus "Qualitaet beim Fernsehen", bei "Automatisch" 720p (eine einzelne Variante ist noetig, weil
     * der Helfer genau ein Bild mit genau einem Ton zusammensetzt). TV-Test 05.11.: 540p, 720p und 1080p liefen am TV 2014 je 5 min
     * ohne Aussetzer (Helfer ~2,5 % CPU); 720p50 liegt sicher unter H.264 Level 4.1 (caps.codecs), ob 1080p50 alle Bilder zeigt,
     * war nicht messbar -> 1080p nur auf Wunsch */
    HELPER_H: 720,
    helperH: function (q) { return L.capHeight(q) || L.HELPER_H; },
    /* Route zum Oeffnen einer Sitzung: nur die Kanal-ID (nie eine Adresse) und die Hoehe */
    helperOpenPath: function (id, h) { return '/live/open?ch=' + encodeURIComponent(String(id || '')) + '&h=' + (Number(h) || L.HELPER_H); },
    /* Antwort des Helfers -> Adresse fuer den Player ('' = unbrauchbar): nur der feste Pfad mit Sitzungs-Token, an die Helfer-Adresse */
    helperUrl: function (base, ans) {
      var p = ans && typeof ans.path === 'string' ? ans.path : '';
      if (!/^\/live\/[A-Za-z0-9_-]{32}\/index\.m3u8$/.test(p) || !/^http:\/\/[0-9.]+(:\d{1,5})?$/.test(String(base || ''))) return '';
      return base + p;
    },
    /* Sitzungs-Pfad (DELETE beim Schliessen/Senderwechsel) aus der Player-Adresse */
    helperSession: function (url) { var m = /^(http:\/\/[0-9.]+(?::\d{1,5})?\/live\/[A-Za-z0-9_-]{32})\/index\.m3u8$/.exec(String(url || '')); return m ? m[1] : ''; },
    /* Fehler einer Helfer-Anfrage -> Art fuer den Fehlertext: down (nicht erreichbar), old (kann das nicht), busy, upstream, key */
    helperErr: function (err) {
      if (!err) return '';
      if (err.type === 'nohelper') return 'none';
      if (err.type === 'network' || err.type === 'timeout') return 'down';
      if (err.status === 503) return 'busy';
      if (err.status === 401) return 'key';
      if (err.status >= 500) return 'upstream';
      return 'old';                                              // 404/400: der Helfer kennt den Sender (noch) nicht – aelter als die App
    },
    /* Qualitaets-Obergrenze: Einstellung -> Hoehe in Pixeln (0 = Automatisch) */
    capHeight: function (q) { return QUALITY.indexOf(String(q)) > 0 ? Number(q) : 0; },

    /* ---------- Startseiten-Reihe "Fernsehen": welche Sender in welcher Reihenfolge (gleiche Schnittstelle wie N.railRows) ----------
     * avail(channels) -> [{id, def}] (def = Sender mit home: true, z. B. die Hauptprogramme). Gespeichert: [{id, on}]; neue Sender
     * erscheinen mit ihrem Standard am Ende; Sender einer gerade ausgeschalteten Region behalten ihre Stelle (unsichtbar). */
    rows: {
      avail: function (chs) { var o = []; for (var i = 0; chs && i < chs.length; i++) o.push({ id: chs[i].id, def: !!chs[i].home }); return o; },
      merge: function (saved, avail) {
        var out = [], seen = {}, am = {}, i;
        for (i = 0; i < avail.length; i++) am[avail[i].id] = avail[i];
        for (i = 0; saved && i < saved.length; i++) {
          var x = saved[i];
          if (!x || typeof x.id !== 'string' || seen[x.id]) continue;
          seen[x.id] = 1;
          out.push({ id: x.id, on: !!x.on, avail: !!am[x.id] });
        }
        for (i = 0; i < avail.length; i++) if (!seen[avail[i].id]) out.push({ id: avail[i].id, on: !!avail[i].def, avail: true });
        return out;
      },
      view: function (saved, avail) {
        var m = L.rows.merge(saved, avail), out = [];
        for (var i = 0; i < m.length; i++) if (m[i].avail) out.push({ id: m[i].id, on: m[i].on });
        return out;
      },
      enabled: function (saved, avail) {
        var v = L.rows.view(saved, avail), out = [];
        for (var i = 0; i < v.length; i++) if (v[i].on) out.push(v[i].id);
        return out;
      },
      store: function (saved, avail, visible) {
        var m = L.rows.merge(saved, avail), out = [], j = 0, i;
        for (i = 0; i < m.length; i++) {
          if (m[i].avail) { if (j < visible.length) out.push({ id: visible[j].id, on: !!visible[j].on }); j++; }
          else out.push({ id: m[i].id, on: m[i].on });
        }
        for (; j < visible.length; j++) out.push({ id: visible[j].id, on: !!visible[j].on });
        return out.length > MAX_SAVED ? out.slice(0, MAX_SAVED) : out;
      },
      move: function (list, i, dir) {
        var j = i + dir;
        if (j < 0 || j >= list.length) return i;
        var t = list[i]; list[i] = list[j]; list[j] = t;
        return j;
      }
    },

    /* ---------- Stream-Adresse ----------
     * Reihenfolge (plan): offizielle Schnittstelle des Senders (ARD-Mediathek nimmt auch TLS 1.0 an, arte auch http – deshalb auch am
     * Fernseher 2014 versucht; scheitert sie, gilt fuer diese Sitzung die feste Adresse: apiDead), dann die feste Adresse aus den
     * Daten. Ohne TLS 1.2 (caps.tls12 false) wird eine https-Adresse auf http umgestellt, wenn ihr Host das ohne Umleitung liefert
     * (Daten: httpHosts) – der Player des Fernsehers kann kein modernes TLS. -> {api: {t, …} | null, url} */
    plan: function (ch, tls12, apiDead) {
      if (!ch) return { api: null, url: '' };
      return { api: ch.api && !apiDead ? ch.api : null, url: L.forTv(ch.url || '', tls12) };
    },
    /* https -> http fuer Hosts, die das ohne Umleitung koennen (nur ohne TLS 1.2) */
    forTv: function (url, tls12) {
      if (tls12 || !/^https:\/\//i.test(url) || !L.hostOk(url, data().httpHosts)) return url;
      return 'http://' + url.slice(8);
    },
    /* Adresse der Schnittstelle zu einem Sender oder '' */
    apiUrl: function (api, tls12) {
      if (!api || !api.t) return '';
      if (api.t === 'ard') return 'https://api.ardmediathek.de/page-gateway/pages/' + encodeURIComponent(String(api.p || 'ard')) + '/item/' + encodeURIComponent(String(api.id || '')) + '?devicetype=pc&embedded=true';
      if (api.t === 'arte') return (tls12 ? 'https' : 'http') + '://api.arte.tv/api/player/v2/config/' + encodeURIComponent(String(api.lang || 'de')) + '/LIVE';
      return '';
    },
    /* Antwort der Schnittstelle -> HLS-Adresse ('' = nichts Brauchbares; dann gilt die feste Adresse). Feste Pfade je Schnittstelle
     * (ARD: widgets[0].mediaCollection.embedded.streams[0].media[0].url; arte: data.attributes.streams[0].url), nur https-Adressen auf
     * .m3u8 und nur Hosts der Sender bzw. ihrer Auslieferer (Daten: hosts) – eine geaenderte Antwort fuehrt nie zu einer fremden Adresse. */
    apiStream: function (api, json, hosts) {
      var u = '';
      try {
        if (api && api.t === 'ard') u = json.widgets[0].mediaCollection.embedded.streams[0].media[0].url;
        else if (api && api.t === 'arte') u = json.data.attributes.streams[0].url;
      } catch (e) { u = ''; }
      u = typeof u === 'string' ? u : '';
      return /^https:\/\/[^\s"'<>]+\.m3u8(\?[^\s"'<>]*)?$/i.test(u) && L.hostOk(u, hosts) ? u : '';
    },
    /* Host der Adresse endet auf einen der erlaubten (".akamaized.net" usw.) */
    hostOk: function (url, hosts) {
      var m = /^https?:\/\/([^\/:?#]+)/i.exec(String(url || ''));
      if (!m || !hosts || !hosts.length) return false;
      var h = m[1].toLowerCase();
      for (var i = 0; i < hosts.length; i++) { var x = String(hosts[i]).toLowerCase(); if (h === x || h.slice(-(x.length + 1)) === '.' + x) return true; }
      return false;
    },

    /* ---------- HLS-Master-Playlist ----------
     * text -> [{bw, w, h, url}] (absolute Adressen, nach Hoehe dann Bandbreite aufsteigend). Nur #EXT-X-STREAM-INF mit folgender
     * Adresszeile; Audio-/Untertitel-Renditions (#EXT-X-MEDIA) und I-Frame-Listen zaehlen nicht. */
    variants: function (text, base) {
      var lines = String(text || '').split(/\r?\n/), out = [], i;
      if (!/^#EXTM3U/.test(lines[0] || '')) return out;
      for (i = 0; i < lines.length; i++) {
        var l = lines[i];
        if (l.indexOf('#EXT-X-STREAM-INF:') !== 0) continue;
        var a = l.slice(18), bw = /(?:^|,)BANDWIDTH=(\d+)/.exec(a), res = /(?:^|,)RESOLUTION=(\d+)x(\d+)/.exec(a), u = '';
        for (var j = i + 1; j < lines.length; j++) { var t = lines[j].replace(/^\s+|\s+$/g, ''); if (!t) continue; if (t.charAt(0) !== '#') u = t; break; }
        if (!u) continue;
        out.push({ bw: bw ? Number(bw[1]) : 0, w: res ? Number(res[1]) : 0, h: res ? Number(res[2]) : 0, url: L.abs(u, base), aud: /(?:^|,)AUDIO="/.test(a) });
      }
      out.sort(function (a, b) { return a.h - b.h || a.bw - b.bw; });
      return out;
    },
    /* relative Adresse gegen die Adresse der Playlist aufloesen */
    abs: function (u, base) {
      if (/^https?:\/\//i.test(u)) return u;
      var b = String(base || ''), q = b.indexOf('?');
      if (q >= 0) b = b.slice(0, q);
      if (u.charAt(0) === '/') { var m = /^(https?:\/\/[^\/]+)/i.exec(b); return m ? m[1] + u : u; }
      return b.slice(0, b.lastIndexOf('/') + 1) + u;
    },
    /* Obergrenze capH (Pixel-Hoehe, 0 = Automatisch) -> Variante oder null (= Master-Playlist: der Player waehlt selbst).
     * Hoechste Variante mit h <= capH (bei gleicher Hoehe die mit der hoechsten Bandbreite); keine passt -> die kleinste.
     * Keine Grenze moeglich (null): ohne Aufloesungs-Angaben, wenn alles unter der Grenze liegt, und wenn der Ton als eigene Spur
     * neben dem Bild liegt (AUDIO-Gruppe, ARD/ZDF): eine einzelne Bild-Playlist haette dann keinen Ton. */
    pick: function (vars, capH) {
      if (!(capH > 0) || !vars || vars.length < 2) return null;
      var best = null, i;
      for (i = 0; i < vars.length; i++) if (!vars[i].h || vars[i].aud) return null;
      if (vars[vars.length - 1].h <= capH) return null;           // alles liegt unter der Grenze: Master behalten (Player bleibt adaptiv)
      for (i = 0; i < vars.length; i++) if (vars[i].h <= capH && (!best || vars[i].h > best.h || (vars[i].h === best.h && vars[i].bw > best.bw))) best = vars[i];
      return best || vars[0];
    },
    /* Hoechste Hoehe der Varianten (INFO: "bis 1080p") */
    maxH: function (vars) { var m = 0; for (var i = 0; vars && i < vars.length; i++) if (vars[i].h > m) m = vars[i].h; return m; },
    /* SEF-Zusatz fuer HLS (wie N.decision.startUrl); Apple schneidet ab "|" ab */
    sefUrl: function (url) { return url ? url + '|COMPONENT=HLS' : ''; },

    /* ---------- Laeuft gerade (EPG) ----------
     * Programmdaten nur aus offenen Quellen der Sender: ARD programm-api (nownext; frei, CORS *, auch ueber http ohne Umleitung –
     * deshalb auch am Fernseher 2014). epg {t: 'ard', id} -> Adresse */
    epgUrl: function (epg, tls12) {
      if (!epg || epg.t !== 'ard' || !epg.id) return '';
      return (tls12 ? 'https' : 'http') + '://programm-api.ard.de/nownext/api/channel?channel=' + encodeURIComponent(epg.id) + '&pastHours=0&futureEvents=1';
    },
    /* Antwort -> [{t, s, e}] (hoechstens 4, Titel gekuerzt) oder null */
    epgParse: function (epg, json) {
      var ev = json && json.events, out = [];
      if (!epg || epg.t !== 'ard' || !ev || !ev.length) return null;
      for (var i = 0; i < ev.length && out.length < 4; i++) {
        var x = ev[i], t = x && x.title && (x.title.short || x.title.long), s0 = L.isoMs(x && x.startDate), e0 = L.isoMs(x && x.endDate);
        if (typeof t === 'string' && t && s0 && e0 > s0) out.push({ t: t.length > 80 ? t.slice(0, 79) + '…' : t, s: s0, e: e0 });
      }
      return out.length ? out : null;
    },
    /* "2026-11-05T09:55:00+01:00" -> ms (eigener Parser: Date.parse alter WebKit-Versionen kennt den Versatz nicht sicher) */
    isoMs: function (v) {
      var m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d))?(?:\.\d+)?(Z|([+-])(\d\d):?(\d\d))?$/.exec(String(v || ''));
      if (!m) return 0;
      var t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
      if (m[8]) t -= (m[8] === '-' ? -1 : 1) * (+m[9] * 60 + +m[10]) * 60000;
      return t;
    },
    /* Liste [{t: Titel, s: Start ms, e: Ende ms}] + Zeit -> {now, next} (Eintraege oder null) */
    nowNext: function (list, now) {
      var cur = null, nx = null;
      for (var i = 0; list && i < list.length; i++) {
        var x = list[i];
        if (!x || !(x.s < x.e)) continue;
        if (x.s <= now && now < x.e) cur = x;
        else if (x.s >= now && (!nx || x.s < nx.s)) nx = x;
      }
      return { now: cur, next: nx };
    },
    /* Fortschritt der laufenden Sendung 0..1 */
    progress: function (x, now) { return x && x.e > x.s ? Math.max(0, Math.min(1, (now - x.s) / (x.e - x.s))) : 0; },
    /* Fernsehen in diesem Profil? Kinderprofile nie (SPEC LIVE-1: Programme sind nicht nach Alter gefiltert) */
    allowed: function (kid) { return !kid; },
    /* Cache-Eintrag noch gueltig? */
    fresh: function (e, now, ttl) { return !!(e && e.at && now - e.at < ttl); }
  };
  N.liveLogic = L;
})(N);
