# Third-party components

Audit of the public tree, 2026-10-27. In short: **everything that runs on the TV is Neolume's own code and artwork.**
No third-party code, fonts or libraries are installed on the TV.

## 1. Installed on the TV

| Component | Where | License | Notes |
|---|---|---|---|
| Neolume source | `src/`, `loader/` | MIT ([LICENSE](LICENSE)) | Own code. SHA-256 / PBKDF2 in `src/core/apppin.js` implemented from FIPS 180-4 / RFC 8018, no copied code. |
| UI images | `src/assets/*.png` (icon sprite, pointer, gradients, scrim) | MIT | Drawn by `tools/make_assets.js` from own SVG paths and formulas, or made for this project. No icon library. |
| QR code image | `src/assets/qr.png` | MIT (output) | Generated at build time with `qrcode` (MIT). Encodes `plex.tv/link`. |
| App icon | `loader-icons/original/` | MIT | Own design (focus ring around a poster card). No Plex or Samsung marks. |
| Fonts | – | – | None bundled. The app uses the TV's built-in font. |

## 2. Build, test and setup tools (not installed on the TV)

| Component | License | Use |
|---|---|---|
| acorn, acorn-walk | MIT | ES5 check in `tools/build.js` |
| terser | BSD-2-Clause | Minifies the app at build time |
| qrcode and its dependencies (pngjs, dijkstrajs, yargs, …) | MIT / ISC | Generates `qr.png` (`npm run assets`) |
| Python 3 standard library | PSF License | Setup program (`installer/`) and `tools/dev.py` use only the standard library |
| librsvg `rsvg-convert` | LGPL-2.1+ | Called as an external program by `tools/make_assets.js`; not distributed |
| Firefox (headless) | MPL-2.0 | Visual tests (`tools/visual.js`); not distributed |

Run `npx license-checker --summary` for the full list of npm development dependencies.

## 3. Services and platforms

| Item | Notes |
|---|---|
| Plex Media Server API, plex.tv API | Used through their public HTTP interfaces. No Plex code is included. Endpoint behaviour was checked against public documentation and the BSD-3-Clause python-plexapi project (reference only, no code copied). |
| Samsung Orsay platform (widget APIs, SEF "Player" plugin, User App Sync) | Platform APIs of the TV. No Samsung SDK files are included. Some source comments describe how the TV platform or the legacy official TV app behave (timings, call order); they are observations, not copied code. |

## 4. Trademarks

"Plex", "Plex Media Server" and "Plex Pass" are trademarks of Plex, Inc. "Samsung", "Smart Hub" and "Tizen" are trademarks of
their owners. Neolume is not affiliated with or endorsed by them; the names are used only to describe compatibility.
