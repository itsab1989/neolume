# Brand profiles / Marken-Profile

Branding is a build-time setting. One JSON file per profile:

| Key | Meaning |
|---|---|
| `name` | App name shown on the TV (widget name, run title, all UI texts via `{app}`, `X-Plex-Product`) |
| `widgetId` | TV app id and package file name (`<widgetId>.zip`). Never change it for an installed edition – the TV would treat it as a new app (and the sync removes the old one). |
| `slug` | Lower-case prefix of the setup program's release files and Docker image (`<slug>-setup-…`, `ghcr.io/<owner>/<slug>-setup`) |
| `repo` | GitHub repository (`owner/name`) for issue links |
| `wordmark` | Two parts of the wordmark on the start/sign-in screen; the second part is drawn in the accent colour |
| `description` | Widget description in `config.xml` |
| `accent`, `accentPress` | Default accent colour of the UI (focus, buttons, progress; `@accent@` in `src/css/app.css`) and the pressed pointer colour. Dark text `#141414` must reach ≥ 4.5:1 on it, and it ≥ 4.5:1 on `#121316`. |
| `accentId` | Palette entry (`src/core/accent.js`: amber, coral, rose, violet, blue, teal, green) that `accent` stands for. Users can pick any palette colour in *Settings → Interface → Accent colour*; `tools/build.js` writes one `.ac-<id>` variant per other colour for every `@accent@`/`@pointer@` rule, the brand colour stays the unscoped base. `accent` replaces the palette value of this entry. |
| `softLight`, `softDark` | Tinted note background of the setup page (light / dark mode), matching the accent |
| `pointer` | Base name of the Smart Control pointer images in `src/assets/` (`<pointer>.png`, `<pointer>-press.png`, drawn by `tools/make_assets.js` in `accent`/`accentPress`). The other palette colours use `pointer-<id>.png` / `pointer-<id>-press.png`. |
| `icons` | Icon sets from `loader-icons/` this brand may use; `defaultIcon` is used without `--icon` |
| `extraApps` | Other user apps that must stay in the TV's sync list (`local.json` `extraApps` overrides) |

Selection (same rule in `tools/build.js` and `tools/dev.py`): `--brand <id>` / env `BRAND` → `local.json` `"brand"` →
`private` if `brand/private.json` exists → `public`.
Run `npm run build` and `python3 tools/dev.py build` with the same brand (dev.py checks it).
The defaults inside `src/core/brand.js` are the public brand (used by unit tests).

Die öffentliche Fassung (`tools/export_public.sh`) enthält nur `public.json`.
