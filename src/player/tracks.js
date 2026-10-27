/* N.tracks – Ton-/Untertitel-Regeln (SPEC 7.11, 10.4). Reine Funktionen.
 * Reihenfolge der automatischen Wahl: (1) je Serie gemerkt  (2) Anime-Regel (JPN-Ton + DE-, sonst EN-Untertitel; nur wenn die Datei
 * beides hat – ohne japanische Spur normale Tonsprache und normaler UT-Modus, keine Anime-Untertitel)  (3) bevorzugte Tonsprache + Untertitel-Modus. Hoerfilm- (AD) und SDH-Spuren nie automatisch (UX-S7). */
(function (N) {
  var LANG = { de: ['ger', 'deu', 'de'], en: ['eng', 'en'], ja: ['jpn', 'ja'] };
  /* ISO 639-2 (B und T) -> 639-1, Schluessel der Sprachnamen 'lng.<xx>' (SPEC 7.11: Name in der App-Sprache, nie der Server-Text) */
  var ISO = { fre: 'fr', fra: 'fr', spa: 'es', ita: 'it', por: 'pt', dut: 'nl', nld: 'nl', swe: 'sv', dan: 'da', nor: 'no', nob: 'no', nno: 'no',
    fin: 'fi', pol: 'pl', rus: 'ru', tur: 'tr', cze: 'cs', ces: 'cs', hun: 'hu', gre: 'el', ell: 'el', heb: 'he', ara: 'ar', hin: 'hi',
    chi: 'zh', zho: 'zh', kor: 'ko', tha: 'th', ukr: 'uk', rum: 'ro', ron: 'ro', bul: 'bg', hrv: 'hr', srp: 'sr', slo: 'sk', slk: 'sk',
    slv: 'sl', est: 'et', lav: 'lv', lit: 'lt', ind: 'id', may: 'ms', msa: 'ms', vie: 'vi', per: 'fa', fas: 'fa', cat: 'ca', ice: 'is',
    isl: 'is', gle: 'ga', tam: 'ta', tel: 'te', fil: 'tl', tgl: 'tl', lat: 'la' };
  /* Ton-Codecs in Klartext (Markennamen, sprachunabhaengig) */
  var CODEC = { eac3: 'Dolby Digital Plus', ec3: 'Dolby Digital Plus', ac3: 'Dolby Digital', truehd: 'Dolby TrueHD', dca: 'DTS', dts: 'DTS',
    aac: 'AAC', mp3: 'MP3', mp2: 'MP2', flac: 'FLAC', opus: 'Opus', vorbis: 'Vorbis', alac: 'ALAC', pcm: 'PCM', lpcm: 'PCM' };
  var LAYOUT = { 1: 'mono', 2: 'stereo', 3: '2.1', 6: '5.1', 7: '6.1', 8: '7.1' };
  var MAXMEM = 200;
  function lc(s) { return String(s || '').toLowerCase(); }
  function isLang(code, key) { return (LANG[key] || [key]).indexOf(lc(code)) >= 0; }
  function langKey(code) {
    for (var k in LANG) if (isLang(code, k)) return k;
    var c = lc(code).split('-')[0];
    return ISO[c] || c;
  }
  function latin(s) { for (var i = 0; i < s.length; i++) if (s.charCodeAt(i) > 0xff) return false; return s.length > 0; }
  var T = {
    LANG: LANG, langKey: langKey, CODEC: CODEC,
    /* Sprachname in der App-Sprache; unbekannt: Server-Name (nur lateinische Schrift), sonst Code; ohne Code "Unbekannte Sprache" */
    langName: function (key, server) {
      if (!key || key === 'und' || key === 'xx' || key === 'zxx') return N.t('lng.und');
      if (N.i18n.has('lng.' + key)) return N.t('lng.' + key);
      return latin(String(server || '')) ? String(server) : key.toUpperCase();
    },
    /* "Dolby Digital Plus 5.1", "AAC Stereo", "Dolby TrueHD Atmos 7.1" */
    audioFormat: function (s) {
      var c = lc(s.codec), p = lc(s.profile), name = CODEC[c] || String(s.codec || '').toUpperCase();
      if ((c === 'dca' || c === 'dts') && /ma/.test(p)) name = 'DTS-HD MA';
      else if ((c === 'dca' || c === 'dts') && /hra/.test(p)) name = 'DTS-HD HRA';
      else if ((c === 'dca' || c === 'dts') && p === 'x') name = 'DTS:X';
      if (/atmos/i.test(String(s.extendedDisplayTitle || '') + ' ' + String(s.displayTitle || '') + ' ' + String(s.title || ''))) name += ' Atmos';
      var lay = lc(s.audioChannelLayout).replace(/\(.*\)$/, ''), ch = Number(s.channels) || 0, l = LAYOUT[ch] || (/^\d\.\d$/.test(lay) ? lay : '');
      if (lay === 'mono' || lay === 'stereo') l = lay;
      var tx = l === 'mono' || l === 'stereo' ? N.t('pl.ch.' + l) : l || (ch ? N.t('pl.ch.n', { n: ch }) : '');
      return name ? name + (tx ? ' ' + tx : '') : tx;
    },
    /* Hauptzeile (SPEC 7.11): Ton "Französisch · Dolby Digital Plus 5.1", Untertitel "Deutsch · nur fremdsprachige Stellen" / "Deutsch · gestaltet" */
    label: function (s, kind, key) {
      var out = [T.langName(key, s.language)];
      if (kind === 2) { var f = T.audioFormat(s); if (f) out.push(f); }
      else {
        if (s.forced) out.push(N.t('pl.track.forced'));
        else if (lc(s.codec) === 'ass' || lc(s.codec) === 'ssa') out.push(N.t('pl.track.styled'));
      }
      return out.join(' · ');
    },
    /* Unterzeile: Hoerfilm / fuer Hoergeschaedigte / Kommentar / eigener Titel (nur bei gleichen Hauptzeilen) / Einbrennen, sonst Standard */
    subline: function (x, burn) {
      var out = [];
      if (x.ad) out.push(N.t('pl.track.ad'));
      if (x.hi) out.push(N.t('pl.track.hi'));
      if (x.comm) out.push(N.t('pl.track.comm'));
      if (x.dup && x.title && !x.comm) out.push(x.title);
      if (burn) out.push(N.t('pl.track.burn'));
      if (x.def && !burn) out.push(N.t('pl.track.def'));
      return out.join(' · ');
    },
    /* Part -> {audio:[...], subs:[...]} ; idx = Position innerhalb der Spurart (SEF SetStreamID) */
    streams: function (part) {
      var out = { audio: [], subs: [] }, list = part && part.Stream || [];
      for (var i = 0; i < list.length; i++) {
        var s = list[i], t = s.streamType;
        if (t !== 2 && t !== 3) continue;
        var title = String(s.title || ''), arr = t === 2 ? out.audio : out.subs, lk = langKey(s.languageCode || s.languageTag);
        arr.push({ id: s.id, idx: arr.length, lang: lk, title: title, codec: lc(s.codec),
          label: T.label(s, t, lk), sel: !!s.selected, def: !!s['default'],
          forced: !!s.forced, hi: !!s.hearingImpaired || /\bsdh\b|h.rgesch/i.test(title),
          ad: !!s.visualImpaired || /audiodeskription|h.rfilm|descriptive|audio description|\bad\b/i.test(title),
          comm: /commentary|kommentar/i.test(title), key: s.key || '', ch: Number(s.channels) || 0, dup: false });
      }
      T.dups(out.audio); T.dups(out.subs);
      return out;
    },
    /* gleiche Hauptzeile mehrfach -> eigener Spurtitel in die Unterzeile (sonst nicht unterscheidbar) */
    dups: function (arr) {
      for (var i = 0; i < arr.length; i++) for (var j = 0; j < arr.length; j++) if (i !== j && arr[i].label === arr[j].label) arr[i].dup = true;
    },
    selected: function (arr) { for (var i = 0; i < arr.length; i++) if (arr[i].sel) return arr[i]; return null; },
    find: function (arr, fn) { for (var i = 0; i < arr.length; i++) if (fn(arr[i])) return arr[i]; return null; },
    /* cfg: {audioLang:'de'|'en'|'ja'|'server', subs:'off'|'forced'|'foreign'|'always'|'server', subLang:'de'|'en', anime:bool,
     *      animeAudio:'ja'|'de'|'same', animeSubs:'deen'|'de'|'off', animeSigns:bool, remember:bool}
     * mem: gemerkter Eintrag der Serie oder null ; ep: ist Folge. -> {a: id|null (keine Aenderung), s: id|0 (aus)|null, why} */
    choose: function (st, cfg, mem, ep) {
      var A = st.audio, S = st.subs, a = null, s = null, F = T.find, why = 'prefs', ma = null, ms;
      var curA = T.selected(A), curS = T.selected(S), memS = false;
      if (cfg.remember && mem) {
        if (mem.a !== undefined) {
          var mlA = langKey(mem.a);   // alte Eintraege ('fre') -> 'fr'
          ma = F(A, function (x) { return x.lang === mlA && x.title === mem.at; }) || F(A, function (x) { return x.lang === mlA && !x.ad; });
          if (ma) a = ma.id;
        }
        if (mem.off) { s = 0; memS = true; }
        else if (mem.s !== undefined) {
          var mlS = langKey(mem.s);
          ms = F(S, function (x) { return x.lang === mlS && x.forced === !!mem.sf && x.title === mem.st; }) ||
            F(S, function (x) { return x.lang === mlS && x.forced === !!mem.sf; });
          if (ms) { s = ms.id; memS = true; }
        }
        if (ma || memS) why = 'remember';
        // TV-Test 26.10.: nur Ton gemerkt -> Untertitel trotzdem nach Einstellung (nicht die Server-Vorauswahl uebernehmen)
        if (ma && memS) return T.norm(a, s, curA, curS, why);
      }
      if (cfg.anime && !ma && !memS) {          // cfg.anime: Regeln an UND Titel als Anime erkannt (N.anime; auch Filme)
        var an = T.anime(st, cfg);
        if (an) return T.norm(an.a, an.s, curA, curS, 'anime');
      }
      var aud = ma || curA;
      if (!ma && cfg.audioLang && cfg.audioLang !== 'server' && (!curA || curA.lang !== cfg.audioLang || curA.ad)) {
        var pa = F(A, function (x) { return x.lang === cfg.audioLang && !x.ad && x.def; }) || F(A, function (x) { return x.lang === cfg.audioLang && !x.ad; });
        if (pa) { a = pa.id; aud = pa; }
      }
      if (!memS) s = T.subPick(S, cfg, aud);
      return T.norm(a, s, curA, curS, why);
    },
    /* Anime-Regel (SPEC 10.4 set.animeAudio/animeSubs/animeSigns; P5) -> {a, s} oder null (keine Regel greift, normale Wahl).
     * Japanisch: JPN-Ton + Untertitel (DE, sonst EN | nur DE | aus); ohne passende Untertitel nur bei "aus" (sonst wie bisher keine Regel).
     * Deutsch/"Wie oben": Ton in der Sprache; bei deutschem Ton mit "Schilder-Untertitel" die Signs-&-Songs-Spur (DE, nur fremde Stellen). */
    anime: function (st, cfg) {
      var A = st.audio, S = st.subs, F = T.find, aa = cfg.animeAudio || 'ja', ms = cfg.animeSubs || 'deen';
      var full = function (l) { return function (x) { return x.lang === l && !x.forced && !x.hi && !T.signs(x); }; };
      if (aa === 'ja') {
        var ja = F(A, function (x) { return x.lang === 'ja' && !x.ad; });
        if (!ja) return null;
        if (ms === 'off') return { a: ja.id, s: 0 };
        var sub = F(S, full('de')) || (ms === 'deen' ? F(S, full('en')) : null);
        return sub ? { a: ja.id, s: sub.id } : null;
      }
      var lang = aa === 'same' ? cfg.audioLang : aa;
      if (!lang || lang === 'server') return null;
      var au = F(A, function (x) { return x.lang === lang && !x.ad && x.def; }) || F(A, function (x) { return x.lang === lang && !x.ad; });
      if (!au) return null;
      if (cfg.animeSigns && lang === 'de') {
        var sg = F(S, function (x) { return x.lang === 'de' && T.signs(x); }) || F(S, function (x) { return x.lang === 'de' && x.forced; });
        if (sg) return { a: au.id, s: sg.id };
      }
      return { a: au.id, s: T.subPick(S, cfg, au) };
    },
    /* "Signs & Songs" / "Schilder & Lieder": Spur, die nur Schilder und Liedtexte uebersetzt */
    signs: function (x) { return /\bsigns?\b|songs|schilder|lieder/i.test(x.title || ''); },
    /* Untertitel nach Einstellung -> id | 0 (aus) | null (Server-Wahl behalten, nur bei 'server').
     * Nur noetige: Forced-Spur in der Tonsprache, aber nur wenn das eine Sprache des Nutzers ist (TV-Test 26.10.:
     * Ton Franzoesisch, Server hatte "French Forced" vorgewaehlt -> franzoesische UT ohne Auswahl). Immer: Wunschsprache, sonst
     * die andere, sonst aus – nie die Server-Vorauswahl. */
    subPick: function (S, cfg, aud) {
      var F = T.find, mode = cfg.subs || 'forced';
      if (mode === 'server') return null;
      if (mode === 'forced') {
        var mine = [cfg.subLang || 'de', cfg.audioLang], fs = aud && mine.indexOf(aud.lang) >= 0 ? F(S, function (x) { return x.forced && x.lang === aud.lang; }) : null;
        return fs ? fs.id : 0;
      }
      if (mode === 'foreign') {                       // "Bei fremdsprachigem Ton" (Plex: Shown with foreign audio; P5)
        var sl = cfg.subLang || 'de';
        if (aud && aud.lang && aud.lang !== sl) {
          var fo = F(S, function (x) { return x.lang === sl && !x.forced && !x.hi && !T.signs(x); }) || F(S, function (x) { return x.lang === sl && !x.forced; });
          return fo ? fo.id : 0;
        }
        var ff = aud ? F(S, function (x) { return x.forced && x.lang === aud.lang; }) : null;   // Ton = UT-Sprache: nur noetige Stellen
        return ff ? ff.id : 0;
      }
      if (mode === 'always') {
        var want = cfg.subLang || 'de', other = want === 'de' ? 'en' : 'de';
        var ps = F(S, function (x) { return x.lang === want && !x.forced && !x.hi; }) || F(S, function (x) { return x.lang === other && !x.forced && !x.hi; });
        return ps ? ps.id : 0;
      }
      return 0;
    },
    /* nur echte Aenderungen melden */
    norm: function (a, s, curA, curS, why) {
      if (a !== null && curA && curA.id === a) a = null;
      if (s === 0 && !curS) s = null;
      else if (s !== null && s !== 0 && curS && curS.id === s) s = null;
      return { a: a, s: s, why: why };
    },
    /* Wahl merken (pure): mem = {showKey: {a, at, s, sf, st, off, t}} ; max. 200 Serien, aelteste fliegen raus */
    remember: function (mem, key, aud, sub, now) {
      if (!key) return mem;
      mem = mem || {};
      var e = mem[key] || {};
      if (aud) { e.a = aud.lang; e.at = aud.title; }
      if (sub === 0) { e.off = 1; delete e.s; }
      else if (sub) { e.off = 0; e.s = sub.lang; e.sf = sub.forced; e.st = sub.title; }
      e.t = now; mem[key] = e;
      var ks = [], k;
      for (k in mem) if (Object.prototype.hasOwnProperty.call(mem, k)) ks.push(k);
      if (ks.length > MAXMEM) {
        ks.sort(function (p, q) { return (mem[p].t || 0) - (mem[q].t || 0); });
        for (var i = 0; i < ks.length - MAXMEM; i++) delete mem[ks[i]];
      }
      return mem;
    },
    /* Wie wird der Untertitel dargestellt? hls: Wiedergabe ist eine Umwandlung (SEF-HLS hat keine UT-Spuren)
     * -> 'none' | 'sef' (eingebettet, TV-eigene Anzeige) | 'sidecar' (externe SRT, eigene Box) | 'burn' (Server zeichnet ins Bild) */
    subMode: function (sub, assMode, hls) {
      if (!sub) return 'none';
      if (N.decision.isImageSub(sub.codec)) return 'burn';
      if ((sub.codec === 'ass' || sub.codec === 'ssa') && assMode === 'burn') return 'burn';
      if (sub.key) return 'sidecar';                  // externe Datei: eigene Box, auch bei Umwandlung
      return hls ? 'burn' : 'sef';
    }
  };
  N.tracks = T;
})(N);
