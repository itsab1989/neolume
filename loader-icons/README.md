# App icons / App-Symbole

| Set | Description | Brand |
|---|---|---|
| `original` | Focus ring around a poster card / Fokusrahmen um eine Posterkarte | `public` (default). Own artwork, no third-party marks. |
| `w4` | Amber chevron above a curved TV edge | `private` (default) – **never published** |
| `w3` | "neo" wordmark with amber chevron | `private` – **never published** |

Which sets a brand may use and its default: `brand/<id>.json` (`icons`, `defaultIcon`).
Choose one: `python3 tools/dev.py build --icon w3` (or `"icon": "w3"` in `local.json`).
`tools/export_public.sh` removes every set except `original` from the public tree.
