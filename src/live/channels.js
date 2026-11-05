/* N.liveData – Senderliste fuer "Fernsehen" (SPEC A20/LIVE-11, Quellen und Pruefung: docs/research/live-tv.md, Stand 05.11.2026).
 * REINE DATEN: ein Nachbau ergaenzt hier die Sender seines Landes (Pruefliste SPEC LIVE-11); kein Code je Land, auch nicht im Helfer
 * (dessen Kanaltabelle und Host-Allowlist erzeugt tools/live_data.js aus diesen Feldern).
 * Nur oeffentlich-rechtliche bzw. oeffentlich finanzierte Sender, die ihr Programm selbst frei, ohne Anmeldung und ohne Kopierschutz
 * (DRM) im Netz zeigen; nur Adressen, die der Sender in seinem eigenen Player benutzt (nie inoffizielle IPTV-Listen). Eine Geosperre
 * ist kein Ausschluss (Feld geo, die App erklaert sie beim Fehler). Weggelassen (Begruendung je Sender: live-tv.md 12): ORF 1/2/SPORT+
 * (DRM), SRG (keine Adresse ausserhalb CH, Hinweise auf DRM), France TV und Rai News 24 (AES-128 + Token), RTVE La 1/La 2 (FairPlay),
 * BBC/ITV/Channel 4/S4C/VRT/RTBF/RTE (Anmeldung), NPO (DRM), France 24 (Web nur YouTube), RTP, CT, TVP, RTV SLO (nur mit kurzlebigem
 * Token aus der Seite bzw. einer eigenen Schnittstelle – Kandidaten fuer einen Schnittstellen-Typ), RT/CGTN/Press TV/TRT World
 * (Staatssender), DW Deutsch (seit 01.01.2024 eingestellt).
 * Regionen: {id, countries: [ISO-3166-Laender, deren Geraete sie als Standard bekommen], fallback: true (nur "International": Land ohne
 * Daten oder unbekannt), geo: true (manche Sender nur im Land)}; Name in den Texten live.region.<id>.
 * Felder je Sender:
 *   id        stabil, nie wiederverwenden (gespeicherte Auswahl liveHome)
 *   name      wie der Sender sich nennt          region  Region (regions[].id)
 *   url       feste HLS-Adresse (Master-Playlist) = Rueckfall, wenn die Schnittstelle nichts liefert bzw. nicht erreichbar ist
 *   api       offizielle Schnittstelle, die die aktuelle Adresse liefert: {t: 'ard', p: Partner, id: Item-ID der ARD-Mediathek}
 *             bzw. {t: 'arte', lang} (N.liveLogic.apiUrl/apiStream)
 *   epg       Programmdaten ("Laeuft gerade"): {t: 'ard', id} = programm-api.ard.de nownext (frei, CORS *, auch ueber http)
 *   geo       Geosperre laut Sender ('' = keine bekannt): Laendercode bzw. Gruppe mit Text live.country.<geo> (DE, DACH, DEFR, AT …)
 *   sep       Ton als eigene Spur neben dem Bild (EXT-X-MEDIA TYPE=AUDIO mit URI, Bildstuecke ohne Ton; alle ARD/ZDF ausser arte):
 *             der Player des TVs 2014 kann das nicht (TV-Test 05.11.) -> dort nur ueber den Helfer (caps.liveSepAudio, SPEC LIVE-10)
 *   fmp4      Stuecke als fragmentiertes MP4 (EXT-X-MAP): nur mit caps.liveFmp4 (Apple), der Helfer setzt nur MPEG-TS zusammen
 *   tls12     true = Adressen nur ueber TLS >= 1.2 (Host bzw. die Varianten der Master-Playlist; tools/live_tls.js prueft): am TV 2014
 *             (caps.tls12 false) nicht spielbar und nicht angeboten, ausser als sep-Sender ueber den Helfer (SPEC LIVE-12)
 *   verified  false = nur von ausserhalb des Landes recherchiert (bis zur Geosperre geprueft); INFO sagt "nicht von uns getestet".
 *             Ein Nachbau im Land prueft und loescht das Feld (bzw. nimmt den Sender heraus)
 *   home      Standard der Reihe "Fernsehen" auf der Startseite (Hauptprogramme)
 *   logo      Wikimedia Commons: '<a>/<ab>/<Datei>' (a/ab = MD5 des Dateinamens, tests/live.test.js prueft; Lizenz in live-tv.md 4/12,
 *             bevorzugt "PD-textlogo"; Marken nur zur Kennzeichnung); geladen als PNG-Vorschau
 *             in logoW Breite (nur Standardbreiten der Commons-Vorschau: 330), ueber den PMS (N.img.url mit logo)
 * hosts: erlaubte Hosts fuer Adressen (feste, aus einer Schnittstelle, im Helfer jeder Abruf); httpHosts: Hosts, deren Playlists auch ueber http ohne Umleitung
 * kommen und relative Pfade benutzen (Fernseher ohne TLS 1.2: Adresse wird auf http umgestellt). */
(function (N) {
  var ARD = function (p, id) { return { t: 'ard', p: p, id: id }; }, EPG = function (id) { return { t: 'ard', id: id }; };
  var I = {
    erste: 'Y3JpZDovL2Rhc2Vyc3RlLmRlL2xpdmUvY2xpcC9hYmNhMDdhMy0zNDc2LTQ4NTEtYjE2Mi1mZGU4ZjY0NmQ0YzQ',
    sat: 'Y3JpZDovLzNzYXQuZGUvTGl2ZXN0cmVhbS0zc2F0', arte: 'Y3JpZDovL2FydGUuZGUvTGl2ZXN0cmVhbS1BUlRF', kika: 'Y3JpZDovL2tpa2EuZGUvTGl2ZXN0cmVhbS1LaUth',
    phoenix: 'Y3JpZDovL3dkci5kZS9CZWl0cmFnLTE3YTg4ZDdmLWI5NTAtNDcyNy05M2E0LWE3NzI3YjkxNjVkZQ',
    ts24: 'Y3JpZDovL2Rhc2Vyc3RlLmRlL3RhZ2Vzc2NoYXUvbGl2ZXN0cmVhbQ', one: 'Y3JpZDovL3dkci5kZS9CZWl0cmFnLTFlNjA0YWFlLTViODctNGMzNC04ZDhmLTg4OWI1ZjE2ZDU3Mw',
    alpha: 'Y3JpZDovL2JyLmRlL0xpdmVzdHJlYW0tQVJELUFscGhh', brs: 'Y3JpZDovL2JyLmRlL0xpdmVzdHJlYW0tQlItU8O8ZA', brn: 'Y3JpZDovL2JyLmRlL0xpdmVzdHJlYW0tQlItTm9yZA',
    hr: 'Y3JpZDovL2hyLmRlL0xpdmVzdHJlYW0tSFI', mdrsn: 'Y3JpZDovL21kci5kZS9MaXZlc3RyZWFtLU1EUi1TYWNoc2Vu',
    mdrst: 'Y3JpZDovL21kci5kZS9MaXZlc3RyZWFtLU1EUi1TYWNoc2VuLUFuaGFsdA', mdrth: 'Y3JpZDovL21kci5kZS9MaXZlc3RyZWFtLU1EUi1UaMO8cmluZ2Vu',
    ndrhh: 'Y3JpZDovL25kci5kZS9MaXZlc3RyZWFtLU5EUi1IYW1idXJn', ndrnds: 'Y3JpZDovL25kci5kZS9MaXZlc3RyZWFtLU5EUi1OaWVkZXJzYWNoc2Vu',
    ndrsh: 'Y3JpZDovL25kci5kZS9MaXZlc3RyZWFtLU5EUi1TY2hsZXN3aWctSG9sc3RlaW4', ndrmv: 'Y3JpZDovL25kci5kZS9MaXZlc3RyZWFtLU5EUi1NZWNrbGVuYnVyZy1Wb3Jwb21tZXJu',
    rb: 'Y3JpZDovL3JhZGlvYnJlbWVuLmRlL3JhZGlvX2JyZW1lbl9saXZlc3RyZWFt',
    rbbb: 'Y3JpZDovL3JiYi1vbmxpbmUuZGUvcmJiZmVybnNlaGVuL2xpdmVfYmVybGluL3NlbmRlcGxhdHotLS1saXZlc3RyZWFtLS0tYmVybGluLS0taGxzMQ',
    rbbbb: 'Y3JpZDovL3JiYi1vbmxpbmUuZGUvcmJiZmVybnNlaGVuL2xpdmVfYnJhbmRlbmJ1cmcvc2VuZGVwbGF0ei0tLWxpdmVzdHJlYW0tLS1icmFuZGVuYnVyZy0tLWhsczE',
    sr: 'Y3JpZDovL3NyLW9ubGluZS5kZS8yODQ4NjAvbGl2ZXN0cmVhbQ', swrbw: 'Y3JpZDovL3N3ci5kZS8xMzQ4MTA0Mg', swrrp: 'Y3JpZDovL3N3ci5kZS8xMzQ4MTIzMA',
    wdr: 'Y3JpZDovL3dkci5kZS9CZWl0cmFnLTNkYTY2NGRlLTE4YzItNDY1MC1hNGZmLTRmNjQxNDcyMDcyYg'
  };
  function ard(id, name, p, key, url, logo, geo, home) {
    return { id: id, name: name, region: 'de', url: url, api: ARD(p, I[key]), epg: EPG(I[key]), geo: geo || '', logo: logo, home: !!home, sep: key !== 'arte' };
  }
  var ZH = 'https://zdf-hls-1', ZL = '.akamaized.net/hls/live/';
  N.liveData = {
    v: 1, logoW: 330,
    regions: [{ id: 'de', countries: ['DE'] }, { id: 'fr', countries: ['FR'], geo: true }, { id: 'at', countries: ['AT'], geo: true },
      { id: 'dk', countries: ['DK'], geo: true }, { id: 'es', countries: ['ES'], geo: true }, { id: 'se', countries: ['SE'], geo: true },
      { id: 'au', countries: ['AU'] }, { id: 'int', fallback: true }],
    hosts: ['ard-mcdn.de', 'mcdn-one.ard.de', 'mcdn.br.de', 'mcdn.ndr.de', 'mcdn.swr.de', 'rbhlslive.akamaized.net', 'zdf-hls-15.akamaized.net',
      'zdf-hls-16.akamaized.net', 'zdf-hls-17.akamaized.net', 'zdf-hls-18.akamaized.net', 'zdf-hls-19.akamaized.net', 'artesimulcast.akamaized.net',
      'arteliveext.akamaized.net', 'artelivezdf.akamaized.net', 'dwamdstream102.akamaized.net',
      'orf3.mdn.ors.at', 'drlivedr1hls.akamaized.net', 'drlivedr2hls.akamaized.net', 'drlivedrrhls.akamaized.net', 'drlivedrtvahls.akamaized.net',
      'rtvelivestream.rtve.es', 'svt-live-channel.akamaized.net', 'abc-news-dmd-streams-1.akamaized.net', 'masterpl.hls.nhkworld.jp',
      'ert-ucdn.broadpeak-aas.com', 'amdlive-ch01-g-ctnd-com.akamaized.net'],
    httpHosts: ['ard-mcdn.de', 'mcdn-one.ard.de', 'mcdn.br.de', 'mcdn.ndr.de', 'mcdn.swr.de', 'rbhlslive.akamaized.net', 'zdf-hls-15.akamaized.net',
      'zdf-hls-16.akamaized.net', 'zdf-hls-17.akamaized.net', 'zdf-hls-18.akamaized.net', 'zdf-hls-19.akamaized.net', 'dwamdstream102.akamaized.net',
      'amdlive-ch01-g-ctnd-com.akamaized.net'],
    channels: [
      ard('de-daserste', 'Das Erste', 'daserste', 'erste', 'https://daserste-live.ard-mcdn.de/daserste/live/hls/de/master.m3u8', 'c/ca/Das_Erste_2014.svg', 'DE', true),
      { id: 'de-zdf', name: 'ZDF', region: 'de', url: ZH + '5' + ZL + '2016498/de/high/master.m3u8', geo: 'DE', logo: 'c/c1/ZDF_logo.svg', home: true, sep: true },
      ard('de-3sat', '3sat', '3sat', 'sat', ZH + '8' + ZL + '2016501/dach/high/master.m3u8', '8/81/3sat_2019.svg', 'DACH', true),
      ard('de-arte', 'arte', 'arte', 'arte', 'https://artesimulcast.akamaized.net/hls/live/2030993/artelive_de/index.m3u8', 'e/ee/Arte_Logo_2026.svg', 'DEFR', true),
      ard('de-phoenix', 'phoenix', 'phoenix', 'phoenix', ZH + '9' + ZL + '2016502/de/high/master.m3u8', '4/43/Phoenix-logo-2018.svg', 'DE', true),
      ard('de-tagesschau24', 'tagesschau24', 'tagesschau24', 'ts24', 'https://tagesschau-live.ard-mcdn.de/tagesschau/live/hls/de/master.m3u8', '2/24/Tagesschau24-2012.svg', '', true),
      { id: 'de-zdfneo', name: 'ZDFneo', region: 'de', url: ZH + '6' + ZL + '2016499/de/high/master.m3u8', geo: 'DE', logo: '8/8c/ZDFneo2017_Logo.svg', sep: true },
      { id: 'de-zdfinfo', name: 'ZDFinfo', region: 'de', url: ZH + '7' + ZL + '2016500/de/high/master.m3u8', geo: 'DE', logo: '3/34/ZDFinfo_2011.svg', sep: true },
      ard('de-kika', 'KiKA', 'kika', 'kika', 'https://kika-live.ard-mcdn.de/kika/live/hls/de/master.m3u8', 'e/ef/KIKA-Logo.svg', 'DE'),
      ard('de-one', 'ONE', 'one', 'one', 'https://mcdn-one.ard.de/ardone/hls/master.m3u8', '3/3d/One_2022.svg', 'DE'),
      ard('de-alpha', 'ARD alpha', 'alpha', 'alpha', 'https://mcdn.br.de/br/fs/ard_alpha/hls/de/master.m3u8', '6/66/ARD-alpha_logo_2019-01-07.svg'),
      ard('de-br-sued', 'BR Fernsehen Süd', 'br', 'brs', 'https://mcdn.br.de/br/fs/bfs_sued/hls/de/master.m3u8', '5/51/Logo_Bayerischer_Rundfunk_2024.svg'),
      ard('de-br-nord', 'BR Fernsehen Nord', 'br', 'brn', 'https://mcdn.br.de/br/fs/bfs_nord/hls/de/master.m3u8', '5/51/Logo_Bayerischer_Rundfunk_2024.svg'),
      ard('de-hr', 'hr-fernsehen', 'hr', 'hr', 'https://hr-live.ard-mcdn.de/hr/live/hls/de/master.m3u8', 'e/ea/HR-Fernsehen_Logo_2023.svg'),
      ard('de-mdr-sn', 'MDR Sachsen', 'mdr', 'mdrsn', 'https://mdr-live.ard-mcdn.de/mdr/live/hls/de/master.m3u8', '6/61/MDR_Logo_2017.svg', 'DE'),
      ard('de-mdr-st', 'MDR Sachsen-Anhalt', 'mdr', 'mdrst', 'https://mdr-live.ard-mcdn.de/mdr/sa/hls/de/master.m3u8', '6/61/MDR_Logo_2017.svg', 'DE'),
      ard('de-mdr-th', 'MDR Thüringen', 'mdr', 'mdrth', 'https://mdr-live.ard-mcdn.de/mdr/th/hls/de/master.m3u8', '6/61/MDR_Logo_2017.svg', 'DE'),
      ard('de-ndr-hh', 'NDR Hamburg', 'ndr', 'ndrhh', 'https://mcdn.ndr.de/ndr/hls/ndr_fs/ndr_hh/master.m3u8', 'e/e9/Logo_NDR_Fernsehen_2017.svg', 'DE'),
      ard('de-ndr-nds', 'NDR Niedersachsen', 'ndr', 'ndrnds', 'https://mcdn.ndr.de/ndr/hls/ndr_fs/ndr_nds/master.m3u8', 'e/e9/Logo_NDR_Fernsehen_2017.svg', 'DE'),
      ard('de-ndr-sh', 'NDR Schleswig-Holstein', 'ndr', 'ndrsh', 'https://mcdn.ndr.de/ndr/hls/ndr_fs/ndr_sh/master.m3u8', 'e/e9/Logo_NDR_Fernsehen_2017.svg', 'DE'),
      ard('de-ndr-mv', 'NDR Mecklenburg-Vorpommern', 'ndr', 'ndrmv', 'https://mcdn.ndr.de/ndr/hls/ndr_fs/ndr_mv/master.m3u8', 'e/e9/Logo_NDR_Fernsehen_2017.svg', 'DE'),
      ard('de-radiobremen', 'Radio Bremen', 'radiobremen', 'rb', 'https://rbhlslive.akamaized.net/hls/live/2020435/rbfs/master.m3u8', '7/73/Logo_Radio_Bremen_TV.svg'),
      ard('de-rbb-berlin', 'rbb Berlin', 'rbb', 'rbbb', 'https://rbb-live.ard-mcdn.de/rbb/berlin/hls/de/master.m3u8', 'e/ec/Rbb_Fernsehen_Logo_2017.08.svg', 'DE'),
      ard('de-rbb-brandenburg', 'rbb Brandenburg', 'rbb', 'rbbbb', 'https://rbb-live.ard-mcdn.de/rbb/brandenburg/hls/de/master.m3u8', 'e/ec/Rbb_Fernsehen_Logo_2017.08.svg', 'DE'),
      ard('de-sr', 'SR Fernsehen', 'sr', 'sr', 'https://sr-live.ard-mcdn.de/sr/live/hls/de/master.m3u8', '9/9c/SR_Fernsehen_Logo_2023.svg'),
      ard('de-swr-bw', 'SWR Baden-Württemberg', 'swr', 'swrbw', 'https://mcdn.swr.de/swr/swrbwd/master.m3u8', '2/26/SWR_Logo_2023.svg'),
      ard('de-swr-rp', 'SWR Rheinland-Pfalz', 'swr', 'swrrp', 'https://mcdn.swr.de/swr/swrrpd/master.m3u8', '2/26/SWR_Logo_2023.svg'),
      ard('de-wdr', 'WDR', 'wdr', 'wdr', 'https://wdr-live.ard-mcdn.de/wdr/live/hls/de/master.m3u8', 'b/b3/Wdr_fernsehen_logo_2016.svg'),
      { id: 'fr-arte', name: 'arte (français)', region: 'fr', url: 'https://artesimulcast.akamaized.net/hls/live/2031003/artelive_fr/index.m3u8',
        api: { t: 'arte', lang: 'fr' }, geo: 'DEFR', logo: 'e/ee/Arte_Logo_2026.svg', home: true },
      /* Weitere Laender (Recherche 05.11., live-tv.md 12): verified false = von Deutschland aus nur bis zur Geosperre pruefbar */
      { id: 'at-orf3', name: 'ORF III', region: 'at', url: 'https://orf3.mdn.ors.at/orf/orf3/qxa/manifest.m3u8', geo: 'AT',
        logo: 'e/ed/ORF_III_Logo_Monochrom.svg', home: true, tls12: true, verified: false },
      { id: 'dk-dr1', name: 'DR1', region: 'dk', url: 'https://drlivedr1hls.akamaized.net/hls/live/2113625/drlivedr1/master.m3u8', geo: 'DK',
        logo: 'f/ff/DR1_Logo_2020.svg', home: true, verified: false },
      { id: 'dk-dr2', name: 'DR2', region: 'dk', url: 'https://drlivedr2hls.akamaized.net/hls/live/2113623/drlivedr2/master.m3u8', geo: 'DK',
        logo: 'b/b5/DR2_Logo_2020.svg', verified: false },
      { id: 'dk-ramasjang', name: 'DR Ramasjang', region: 'dk', url: 'https://drlivedrrhls.akamaized.net/hls/live/2113621/drlivedrr/master.m3u8', geo: 'DK',
        logo: '3/3a/DR_Ramasjang_Logo_2020.svg', verified: false },
      { id: 'dk-drtv', name: 'DRTV', region: 'dk', url: 'https://drlivedrtvahls.akamaized.net/hls/live/2113613/drlivedrtva/master.m3u8', geo: 'DK',
        logo: '5/5f/DR_TV_logo.svg', verified: false },
      { id: 'es-24h', name: '24h', region: 'es', url: 'https://rtvelivestream.rtve.es/rtvesec/24h/24h_main_dvr.m3u8', geo: '',
        logo: '4/4c/24h_2026.svg', home: true, tls12: true },
      { id: 'es-clan', name: 'Clan', region: 'es', url: 'https://rtvelivestream.rtve.es/rtvesec/clan/clan_main_dvr.m3u8', geo: 'ES',
        logo: '6/63/Clan_2026.svg', tls12: true, verified: false },
      { id: 'se-svt1', name: 'SVT1', region: 'se', url: 'https://svt-live-channel.akamaized.net/l4/se/svt1/master-fmp4.m3u8?format=hls&defaultSubLang=1',
        geo: 'SE', logo: '1/1b/SVT1_logo_2016.svg', home: true, fmp4: true, verified: false },
      { id: 'au-abc-news', name: 'ABC News', region: 'au', url: 'https://abc-news-dmd-streams-1.akamaized.net/out/v1/abc83881886746b0802dc3e7ca2bc792/index.m3u8',
        geo: '', logo: 'a/a4/ABC_News_(2017).svg', home: true },
      { id: 'int-dw-en', name: 'DW English', region: 'int', url: 'https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8',
        geo: '', logo: '7/75/Deutsche_Welle_symbol_2012.svg', home: true },
      { id: 'int-nhk-world', name: 'NHK World-Japan', region: 'int', url: 'https://masterpl.hls.nhkworld.jp/hls/w/live/master_nocc.m3u8',
        geo: '', logo: '8/8d/NHK_World-Japan_TV.svg', home: true, sep: true, fmp4: true, tls12: true },
      { id: 'int-ert-world', name: 'ERT World', region: 'int', url: 'https://ert-ucdn.broadpeak-aas.com/bpk-tv/ERTCosmos/default/index.m3u8',
        geo: '', logo: '2/2c/ERT_World_Logo_2020.svg', sep: true, fmp4: true, tls12: true },
      { id: 'int-arirang', name: 'Arirang TV', region: 'int', url: 'https://amdlive-ch01-g-ctnd-com.akamaized.net/arirang_1gch/smil:arirang_1gch.smil/playlist.m3u8',
        geo: '', logo: '4/42/Arirang-TV-Logo.svg', home: true }
    ]
  };
  /* Bildtests (config.json liveDemo): erfundene Sender ohne echte Adressen, Logos sind Ersatzbilder des Mocks */
  function demo(id, name, region, home) { return { id: id, name: name, region: region, url: 'http://127.0.0.1/demo/' + id + '.m3u8', geo: '', logo: 'd/de/Demo_' + id + '.svg', home: !!home, epg: { t: 'demo' } }; }
  N.liveDemo = {
    v: 1, logoW: 330, hosts: [], httpHosts: [], country: 'DE',       // Bildtests: festes Land (Standard Deutschland wie bisher)
    regions: [{ id: 'de', countries: ['DE'] }, { id: 'fr', countries: ['FR'], geo: true }, { id: 'int', fallback: true }],
    channels: [demo('d1', 'Kanal Eins', 'de', true), demo('d2', 'Zweite Welle', 'de', true), demo('d3', 'Kulturkanal', 'de', true), demo('d4', 'Nachrichten 24', 'de', true),
      demo('d5', 'Wissen plus', 'de'), demo('d6', 'Regional Nord', 'de'), demo('d7', 'Regional Süd', 'de'), demo('d8', 'Kinderkanal', 'de'), demo('d9', 'Doku-Kanal', 'de'),
      demo('d10', 'Kultur (français)', 'fr', true), demo('d11', 'World News', 'int', true)],
    demoEpg: ['Abendnachrichten', 'Der Leuchtturm', 'Quiz am Abend', 'Tiere im Wald', 'Konzert im Park', 'Wetter und Verkehr', 'Die lange Nacht der Sterne']
  };
})(N);
