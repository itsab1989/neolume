#!/bin/sh
# Builds the clean public tree of Neolume from this (private) repository.
#
#   PRIVACY_DENYLIST_FILE=/path/to/denylist.txt sh tools/export_public.sh OUT_DIR [GIT_REF]
#
# - Allowlist approach: only the paths listed below are exported, taken from the COMMITTED state of GIT_REF
#   (default HEAD) via `git archive` – uncommitted files, local.json, logs, dist/, node_modules, .secrets and
#   private icon sets can never slip in.
# - Internal German developer notes (status, TODO, TV test protocols, research, design reviews, server notes …)
#   are not on the allowlist and therefore never exported.
# - Afterwards tools/privacy_scan.sh runs over OUT_DIR; the export fails if it finds anything.
# - From design/ only the brand-neutral design system is exported (tokens.json, icons/, generated README.md); brand
#   accent colours live only in brand/<id>.json (tests/design.test.js checks that none leaks into design/).
# - The public brand is the only one exported (brand/public.json, loader-icons/original); build and setup
#   program therefore default to it in the public tree.
# - The public repository is published with fresh history from OUT_DIR (commands are printed at the end).
set -eu
OUT="${1:?usage: tools/export_public.sh OUT_DIR [GIT_REF]}"
REF="${2:-HEAD}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ---- allowlist (paths relative to the repo root) ----
ALLOW="
package.json
package-lock.json
local.example.json
.gitignore
.gitattributes
.github/workflows/test.yml
.github/workflows/setup-tests.yml
.github/workflows/release-setup.yml
src
app
loader
loader-icons/README.md
loader-icons/original
brand/README.md
brand/public.json
tools/build.js
tools/dev.py
tools/make_assets.js
tools/tokens.js
tools/design_doc.js
tools/tokenize_css.js
design/tokens.json
design/icons
design/README.md
tools/i18n_rules.js
tools/spec_gen.js
tools/visual.js
tools/bench.js
tools/preview.html
tools/layout_probe.js
tools/layoutcheck.js
tools/layout_allow.json
tools/layout_selftest.html
tools/privacy_scan.sh
tools/export_public.sh
tools/hooks
installer
tests/helpers
tests/synthetic
tests/installer
tests/showcase
tools/showcase.js
tools/install_figures.py
"
# tests/visual/baseline is NOT exported: the private baselines are rendered with the private brand. In the public tree
# create them with `BRAND=public npm run build && npm run visual:approve` (local only, needs Firefox).
# public/ is an overlay: its content lands at the ROOT of the public tree (README.md, LICENSE, CHANGELOG.md,
# THIRD-PARTY.md, .github/release-footer.md, .github/FUNDING.yml, docs/ = GitHub Pages site + guides).
OVERLAY=public
# ---- never exported, even if a path above would contain it ----
# optional extensions of the private edition (brand "features", see tools/build.js) live in */private/ folders: never exported
DENY_PATHS="logs dist node_modules .secrets tests/fixtures app/app.js app/app.min.js app/bench.js app/proto.js src/private installer/neosetup/private tests/private tools/private design/private"
DENY_NAMES="local.json *.log .DS_Store"

if [ -e "$OUT" ] && [ -n "$(ls -A "$OUT" 2>/dev/null)" ]; then
  echo "export: $OUT exists and is not empty – choose a new directory" >&2; exit 1
fi
mkdir -p "$OUT"

cd "$ROOT"
PATHS=""
for p in $ALLOW; do
  if git cat-file -e "$REF:$p" 2>/dev/null; then PATHS="$PATHS $p"; else echo "export: note – $p not in $REF (skipped)"; fi
done
# unit tests at the top of tests/ (tests/*.test.js), without local-fixture tests
for t in $(git ls-tree --name-only "$REF" tests/ | grep '\.test\.js$' | grep -v 'fixtures-local'); do PATHS="$PATHS $t"; done

# shellcheck disable=SC2086
git archive --format=tar "$REF" -- $PATHS | tar -x -C "$OUT"
git cat-file -e "$REF:$OVERLAY" 2>/dev/null || { echo "export: $OVERLAY/ missing in $REF" >&2; exit 1; }
git archive --format=tar "$REF" -- "$OVERLAY" | tar -x -C "$OUT" --strip-components=1

for p in $DENY_PATHS; do rm -rf "${OUT:?}/$p"; done
# hard stop: no folder named "private" may reach the public tree (extension code, its tests and tools)
LEAK="$(find "$OUT" -type d -name private -print)"
if [ -n "$LEAK" ]; then echo "export: private folder(s) in the public tree – aborting:" >&2; echo "$LEAK" >&2; exit 1; fi
for n in $DENY_NAMES; do find "$OUT" -name "$n" -exec rm -f {} +; done
# Docs/config of the setup program are written for the brand of THIS repo. Rewrite their names to the public brand
# (mapping derived from brand/*.json at $REF; code needs no rewrite, it reads the brand profile).
git show "$REF:brand/public.json" > "$OUT/.brand-public.json"
if git cat-file -e "$REF:brand/private.json" 2>/dev/null; then git show "$REF:brand/private.json" > "$OUT/.brand-private.json"; fi
python3 -I - "$OUT" <<'PY'
import json, os, re, sys
out = sys.argv[1]
pub = json.load(open(os.path.join(out, '.brand-public.json'), encoding='utf-8'))
pp = os.path.join(out, '.brand-private.json')
if os.path.exists(pp):
    prv = json.load(open(pp, encoding='utf-8'))
    pairs = [
        (prv['name'] + ' ', pub['name'] + ' '), (prv['name'].upper(), pub['name'].upper()),
        (prv['name'].replace(' ', '') + 'Setup', pub['name'].replace(' ', '') + 'Setup'),
        (prv['widgetId'] + '.zip', pub['widgetId'] + '.zip'),
        ('github.com/' + prv['repo'], 'github.com/' + pub['repo']), (prv['repo'] + '/', pub['repo'] + '/'),
        (prv['slug'] + '-setup', pub['slug'] + '-setup'), (prv['slug'] + '-helper', pub['slug'] + '-helper'),
        ('docker/' + prv['slug'], 'docker/' + pub['slug']), ('.' + prv['slug'] + '.helper', '.' + pub['slug'] + '.helper'),
        (prv['name'], pub['name']),
    ]
    keep = ['"kind": "' + prv['slug'] + '-setup"', 'Always `' + prv['slug'] + '-setup`']   # setup.json protocol constant
    for rel in ('installer/README.md', 'installer/BUILD.md', 'installer/docker-compose.yml', 'installer/Dockerfile'):
        p = os.path.join(out, rel)
        if not os.path.exists(p): continue
        s = open(p, encoding='utf-8').read()
        for i, k in enumerate(keep): s = s.replace(k, '\0KEEP%d\0' % i)
        for a, b in pairs: s = s.replace(a, b)
        for i, k in enumerate(keep): s = s.replace('\0KEEP%d\0' % i, k)
        open(p, 'w', encoding='utf-8').write(s)
    for d in ('src/assets', 'app'):                       # pointer images of the private brand (its accent colour)
        for n in (prv['pointer'] + '.png', prv['pointer'] + '-press.png'):
            if prv['pointer'] != pub['pointer'] and os.path.exists(os.path.join(out, d, n)): os.remove(os.path.join(out, d, n))
    os.remove(pp)
os.remove(os.path.join(out, '.brand-public.json'))
PY

# the private build/dev package of the app must not contain private icon sets
for d in "$OUT"/loader-icons/*; do
  [ -d "$d" ] && [ "$(basename "$d")" != original ] && { echo "export: removing non-public icon set $(basename "$d")"; rm -rf "$d"; }
done

# screenshots: list missing ones (README references them)
for s in home profiles sidebar library details series search discover player tracks settings music artist audiobooks screensaver accent; do
  [ -f "$OUT/docs/screenshots/$s.png" ] || echo "export: WARNING – docs/screenshots/$s.png missing (README shows a broken image)"
done

# website structured data: softwareVersion follows package.json
VER="$(sed -n 's/^  "version": "\([^"]*\)".*/\1/p' "$OUT/package.json" | head -1)"
[ -n "$VER" ] && [ -f "$OUT/docs/index.html" ] && sed -i.bak "s/\"softwareVersion\": \"[^\"]*\"/\"softwareVersion\": \"$VER\"/" "$OUT/docs/index.html" && rm -f "$OUT/docs/index.html.bak"

echo "export: $(find "$OUT" -type f | wc -l | tr -d ' ') files written to $OUT"
sh "$OUT/tools/privacy_scan.sh" "$OUT"

cat <<EOF

Next steps (fresh history, nothing from the private history is published):
  cd "$OUT" && git init -b main && git add -A && git commit -m "Neolume 1.0.0"
  gh repo create itsab1989/neolume --public --source . --push --description "Unofficial client for Plex Media Server on 2014 Samsung Smart TVs (Orsay)"
EOF
