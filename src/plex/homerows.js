/* N.homeRows – "Startseite anpassen" (SPEC 7.3.1): welche Reihen in welcher Reihenfolge, je Profil in settings.homeRows.
 * Reine Logik ohne DOM/Netz. Reihen-Schluessel sind stabil und sprachneutral:
 *   'cw' Weiterschauen · 'deck' Naechste Folgen · 'new-<lib>' Neu in Bibliothek (Standard an)
 *   'hub-<lib>-<typ>' Server-Hub aus /hubs/sections/<lib> (z. B. hub-1-movie.topunwatched) · 'pl' Playlists (Standard aus)
 * Gespeichert: [{id, on}] in Nutzer-Reihenfolge (null = Standard). Reihen, die (gerade) nicht verfuegbar sind, bleiben mit
 * ihrer Position gespeichert; neu auftauchende Standard-Reihen (z. B. neue Bibliothek) kommen hinter ihren Vorgaenger in der
 * Standard-Reihenfolge, neue Zusatz-Reihen (aus) ans Ende. */
(function (N) {
  var MAX_SAVED = 120;
  /* Hub-Familien, die nicht angeboten werden: doppeln Weiterschauen/Neu bzw. sind auf dem TV nicht nutzbar */
  var SKIP = { 'movie.inprogress': 1, 'tv.inprogress': 1, 'movie.recentlyadded': 1, 'tv.recentlyadded': 1, 'music.videos.new': 1, 'music.touring': 1 };
  var HR = {
    /* Familie und stabiler Typ eines Hubs. Sammlungen (curated) behalten ihre Nummer, wechselnde Hubs (Genre, Person)
     * nur die Familie: 'movie.genre.1.143' -> movie.genre, 'movie.curated.1.1' -> movie.curated.1 */
    hubType: function (h, lib) {
      var ident = String(h.hubIdentifier || ''), fam = String(h.context || '').replace(/^hub\./, ''), parts, i;
      if (!fam) {
        parts = ident.split('.');
        for (i = parts.length - 1; i >= 0; i--) if (/^\d+$/.test(parts[i])) parts.pop(); else break;
        fam = parts.join('.');
      }
      var type = fam;
      if (/\.curated$/.test(fam) && ident.indexOf(fam + '.') === 0) {
        parts = ident.slice(fam.length + 1).split('.');
        if (parts[0] === String(lib)) parts.shift();
        if (parts.length && parts[0]) type = fam + '.' + parts.join('.');
      }
      return { fam: fam, type: type };
    },
    /* /hubs/sections/<lib> -> Katalog-Eintraege [{id, lib, type, fam, title, it}] (it = Element-Typ des Hubs) */
    hubsOf: function (json, lib) {
      var hubs = json && json.MediaContainer && json.MediaContainer.Hub || [], out = [], seen = {};
      for (var i = 0; i < hubs.length; i++) {
        var h = hubs[i], t = HR.hubType(h, lib);
        if (!t.fam || SKIP[t.fam] || h.type === 'clip' || h.type === 'photo') continue;
        var id = 'hub-' + lib + '-' + t.type;
        if (seen[id]) continue;
        seen[id] = 1;
        out.push({ id: id, lib: lib, type: t.type, fam: t.fam, title: String(h.title || ''), it: String(h.type || '') });
      }
      return out;
    },
    /* Katalog nach Bibliotheks-Reihenfolge sortieren (innerhalb einer Bibliothek: Reihenfolge des Servers) */
    sortCatalog: function (hubs, alibs) {
      var rank = {}, i;
      for (i = 0; alibs && i < alibs.length; i++) rank[alibs[i].id] = i;
      var tagged = [];
      for (i = 0; i < hubs.length; i++) tagged.push({ h: hubs[i], r: rank[hubs[i].lib] === undefined ? 999 : rank[hubs[i].lib], i: i });
      tagged.sort(function (a, b) { return a.r - b.r || a.i - b.i; });
      var out = [];
      for (i = 0; i < tagged.length; i++) out.push(tagged[i].h);
      return out;
    },
    /* Hub aus einer Antwort zu einer Reihen-id finden (Rohdaten) */
    findHub: function (json, id, lib) {
      var hubs = json && json.MediaContainer && json.MediaContainer.Hub || [];
      for (var i = 0; i < hubs.length; i++) if ('hub-' + lib + '-' + HR.hubType(hubs[i], lib).type === id) return hubs[i];
      return null;
    },
    parse: function (id) {
      var m = /^hub-(\d+)-(.+)$/.exec(id);
      if (m) return { group: 'hub', lib: Number(m[1]), type: m[2] };
      m = /^new-(\d+)$/.exec(id);
      if (m) return { group: 'new', lib: Number(m[1]) };
      return { group: id === 'pl' ? 'pl' : 'base' };   // 'ab' = Weiterhoeren (M4) ist eine Grundreihe
    },
    /* verfuegbare Reihen in Standard-Reihenfolge: libs = Film/Serien-Bibliotheken, cat = Katalog {hubs:[...], pl:{title}} */
    avail: function (libs, cat) {
      var out = [{ id: 'cw', def: true }, { id: 'deck', def: true }], i, al = cat && cat.alibs || [];
      for (i = 0; i < al.length; i++) if (al[i].kind === 'audio') { out.push({ id: 'ab', def: true }); break; }   // M4: Weiterhoeren (nur mit Hoerbuch-Bibliothek)
      for (i = 0; libs && i < libs.length; i++) out.push({ id: 'new-' + libs[i].id, def: true });
      var hubs = cat && cat.hubs || [];
      for (i = 0; i < hubs.length; i++) out.push({ id: hubs[i].id, def: false });
      if (cat && cat.pl) out.push({ id: 'pl', def: false });
      return out;
    },
    /* Gespeicherte + verfuegbare Reihen -> volle Liste [{id, on, avail}] (gespeicherte Reihenfolge, neue eingefuegt) */
    merge: function (saved, avail) {
      var out = [], pos = {}, am = {}, i, k;
      for (i = 0; i < avail.length; i++) am[avail[i].id] = avail[i];
      for (i = 0; saved && i < saved.length; i++) {
        var s = saved[i];
        if (!s || typeof s.id !== 'string' || pos[s.id] !== undefined) continue;
        pos[s.id] = out.length;
        out.push({ id: s.id, on: !!s.on, avail: !!am[s.id] });
      }
      for (i = 0; i < avail.length; i++) {
        var a = avail[i];
        if (pos[a.id] !== undefined) continue;
        var at = a.def ? -1 : out.length;              // neue Zusatz-Reihen (aus) ans Ende, Standard-Reihen an ihre Stelle
        for (k = i - 1; k >= 0 && at < 0; k--) if (pos[avail[k].id] !== undefined) at = indexOf(out, avail[k].id) + 1;
        for (k = i + 1; k < avail.length && at < 0; k++) if (pos[avail[k].id] !== undefined) at = indexOf(out, avail[k].id);
        if (at < 0) at = out.length;
        out.splice(at, 0, { id: a.id, on: a.def, avail: true });
        pos[a.id] = at;
      }
      return out;
    },
    /* sichtbare Liste der Einstellungen (nur verfuegbare) */
    view: function (saved, avail) {
      var m = HR.merge(saved, avail), out = [];
      for (var i = 0; i < m.length; i++) if (m[i].avail) out.push({ id: m[i].id, on: m[i].on });
      return out;
    },
    /* eingeschaltete Reihen-ids in Anzeige-Reihenfolge */
    enabled: function (saved, avail) {
      var v = HR.view(saved, avail), out = [];
      for (var i = 0; i < v.length; i++) if (v[i].on) out.push(v[i].id);
      return out;
    },
    isOn: function (saved, id, def) {
      for (var i = 0; saved && i < saved.length; i++) if (saved[i] && saved[i].id === id) return !!saved[i].on;
      return def;
    },
    /* Sichtbare Liste zurueck in die gespeicherte Liste schreiben: nicht verfuegbare Eintraege behalten ihre Stelle */
    store: function (saved, avail, visible) {
      var m = HR.merge(saved, avail), out = [], j = 0;
      for (var i = 0; i < m.length; i++) {
        if (m[i].avail) { if (j < visible.length) out.push({ id: visible[j].id, on: !!visible[j].on }); j++; }
        else out.push({ id: m[i].id, on: m[i].on });
      }
      for (; j < visible.length; j++) out.push({ id: visible[j].id, on: !!visible[j].on });
      return out.length > MAX_SAVED ? out.slice(0, MAX_SAVED) : out;
    },
    /* Eintrag i um dir (-1/+1) verschieben; Rueckgabe neuer Index */
    move: function (list, i, dir) {
      var j = i + dir;
      if (j < 0 || j >= list.length) return i;
      var t = list[i]; list[i] = list[j]; list[j] = t;
      return j;
    },
    /* Startseite: verfuegbar sind Grundreihen, Neu je Film/Serien-Bibliothek und eingeschaltete Hubs, deren Bibliothek
     * es noch gibt (welche Hubs der Server liefert, zeigt erst die Antwort) */
    homeAvail: function (saved, libs, alibs) {
      var have = {}, i, hubs = [], pl = false;
      for (i = 0; alibs && i < alibs.length; i++) have[alibs[i].id] = 1;
      for (i = 0; saved && i < saved.length; i++) {
        var s = saved[i];
        if (!s || !s.on) continue;
        var p = HR.parse(s.id);
        if (p.group === 'hub' && have[p.lib]) hubs.push({ id: s.id });
        else if (p.group === 'pl') pl = true;
      }
      return HR.avail(libs, { hubs: hubs, pl: pl, alibs: alibs });
    }
  };
  function indexOf(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return i; return -1; }
  N.homeRows = HR;

  /* N.railRows – "Seitenleiste anpassen" (Nutzerwunsch W1, TV-Test 27.10.): Eintraege der Seitenleiste umsortieren und
   * ausblenden, je Profil in settings.railItems [{id, on}] (null = Standard). Eintraege: 'search', 'discover' (nur wenn
   * Entdecken an ist), 'home' (immer sichtbar, aber verschiebbar), 'lib-<id>' je Bibliothek. Profil oben und Einstellungen
   * unten stehen fest und sind nicht Teil der Liste. Neue Bibliotheken erscheinen eingeschaltet am Ende; was gerade nicht
   * verfuegbar ist (Entdecken aus, Bibliothek weg), behaelt seine gespeicherte Stelle. Gleiche Schnittstelle wie N.homeRows
   * (view/store/move) fuer den gemeinsamen Listen-Editor (views/homerows.js). */
  var RR = {
    LOCKED: { home: 1 },
    avail: function (libs, disc) {
      var out = [{ id: 'search', def: true }];
      if (disc) out.push({ id: 'discover', def: true });
      out.push({ id: 'home', def: true });
      for (var i = 0; libs && i < libs.length; i++) out.push({ id: 'lib-' + libs[i].id, def: true });
      return out;
    },
    merge: function (saved, avail) {
      var out = [], seen = {}, am = {}, i;
      for (i = 0; i < avail.length; i++) am[avail[i].id] = 1;
      for (i = 0; saved && i < saved.length; i++) {
        var x = saved[i];
        if (!x || typeof x.id !== 'string' || seen[x.id]) continue;
        seen[x.id] = 1;
        out.push({ id: x.id, on: !!x.on || !!RR.LOCKED[x.id], avail: !!am[x.id] });
      }
      for (i = 0; i < avail.length; i++) if (!seen[avail[i].id]) out.push({ id: avail[i].id, on: true, avail: true });   // neu: an, ans Ende
      return out;
    },
    view: function (saved, avail) {
      var m = RR.merge(saved, avail), out = [];
      for (var i = 0; i < m.length; i++) if (m[i].avail) out.push({ id: m[i].id, on: m[i].on });
      return out;
    },
    enabled: function (saved, avail) {
      var v = RR.view(saved, avail), out = [];
      for (var i = 0; i < v.length; i++) if (v[i].on) out.push(v[i].id);
      return out;
    },
    store: function (saved, avail, visible) {
      var m = RR.merge(saved, avail), out = [], j = 0, i;
      for (i = 0; i < m.length; i++) {
        if (m[i].avail) { if (j < visible.length) out.push({ id: visible[j].id, on: !!visible[j].on || !!RR.LOCKED[visible[j].id] }); j++; }
        else out.push({ id: m[i].id, on: m[i].on });
      }
      for (; j < visible.length; j++) out.push({ id: visible[j].id, on: !!visible[j].on || !!RR.LOCKED[visible[j].id] });
      return out.length > MAX_SAVED ? out.slice(0, MAX_SAVED) : out;
    },
    move: HR.move
  };
  N.railRows = RR;
})(N);
