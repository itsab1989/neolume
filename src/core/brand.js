/* N.brand – Marken-Profil (Name, Wortmarke). Standard = oeffentliches Profil; tools/build.js setzt danach das gewaehlte
 * Profil aus brand/<id>.json ein (siehe brand/README.md). Texte nutzen {app} (N.t setzt den Namen automatisch ein).
 * accent = Palettenfarbe (N.accent), die die Marke als Standard nimmt (brand/<id>.json "accentId"). */
(function (N) {
  N.brand = { id: 'public', name: 'Neolume', wordmark: ['Neo', 'lume'], accent: 'teal' };
})(N);
