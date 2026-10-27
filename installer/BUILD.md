# Building and releasing the setup program

This is for maintainers. Users read [README.md](README.md).

The setup program is pure Python 3 standard library (`installer/neosetup/`). A release ships it in three forms:

| Artifact | Built on | Contents |
|---|---|---|
| `<slug>-setup-windows-x64.exe` | `windows-latest` | PyInstaller one-file binary (Python inside) |
| `<slug>-setup-windows-arm64.exe` | `windows-11-arm` | same, native ARM64 |
| `<slug>-setup-macos-arm64.zip` | `macos-15` | zip with one binary `<slug>-setup` (zip keeps the executable bit) |
| `<slug>-setup-macos-x64.zip` | `macos-15-intel` | same, Intel |
| `<slug>-setup-linux-x64` | `ubuntu-22.04` | one-file binary (glibc 2.35+, so it also runs on Debian 12 / Raspberry Pi OS 12) |
| `<slug>-setup-linux-arm64` | `ubuntu-22.04-arm` | same, ARM64 |
| `<slug>-setup.pyz` | `ubuntu-22.04` | zipapp, runs with any Python 3.8+ (`python3 <slug>-setup.pyz`) |
| `SHA256SUMS` | | `sha256sum -c SHA256SUMS` format |
| `ghcr.io/<owner>/<slug>-setup:<version>` and `:latest` | `ubuntu-latest` + QEMU | helper-only image, `linux/amd64`, `linux/arm64`, `linux/arm/v7` |

Every form embeds the same TV app package (`neosetup/payload/app.zip`, the minified release build, plus
`neosetup/payload/brand.json`, the brand it was built with). The Docker
image does not need it: it runs only the optional helper.

## The name: brand profile
Artifact and image names, the app name and the repo link come from the **brand profile** (`brand/<id>.json`, keys
`slug`, `name`, `repo`, `widgetId`; see `brand/README.md`). Selection: `--brand` / env `BRAND` → `local.json` `"brand"` →
`private` if `brand/private.json` exists → `public`. Each edition builds `<slug>-setup-…` and `ghcr.io/<owner>/<slug>-setup` with its own slug (the public export contains
only `public.json`).
- CI: job `prepare` runs `installer/build.py brand` and hands `slug`/`appname`/`repo` to the other jobs
  (Docker labels via build args `APP_NAME`, `APP_REPO`). Env `APP_SLUG` still overrides the slug for local builds.
- Build the app and the payload with the **same** brand (`BRAND=public npm run build`, `installer/build.py payload --brand public`);
  the payload step refuses an `app.min.js` built for another brand.
- Per-user settings folder: `<name without spaces>Setup` (`NeolumeSetup` for the private brand, so existing
  `settings.json`/`helper.json` keep working; `NeolumeSetup` for the public one).

## Release
1. `main` is green (workflows `test` and `setup-tests`).
2. Optional: the release text footer in `.github/release-footer.md` (appended under the generated download table).
3. Tag and push: `git tag v0.3.0 && git push origin v0.3.0`. A tag with `-` (e.g. `v0.3.0-rc.1`) becomes a pre-release,
   and its image gets no `latest` tag.
4. Workflow `release-setup` (about 15 min) runs:
   - `prepare`: `npm ci`, `npm run build` (gates + minified app), installer unit tests, payload, `.pyz`, smoke test of
     the `.pyz` with Python 3.12 and 3.8;
   - `binaries` (6 runners): checks the runner CPU, PyInstaller (pinned version), smoke test of the binary;
   - `docker`: builds amd64, starts it with a dummy `helper.json` (`/neo-helper` must answer, `/watchlist` without
     key must give 401, user must be 65534), then builds all three platforms and pushes `<version>` + `latest`;
   - `release`: `SHA256SUMS`, release notes, creates the GitHub release (or replaces its files when re-run).
5. The version comes from the tag (`v0.3.0` → `0.3.0`); the build stamps it into `neosetup/__init__.py` of the CI
   checkout only (`--version`), nothing is committed.

Manual run (`Actions → release-setup → Run workflow`): on a **tag** it re-publishes that release; on a **branch** it
builds and smoke-tests everything (version `0.0.0-dev.<sha>` or the given input) and only attaches the files to the
workflow run. Nothing is published from branches. Only the automatic `GITHUB_TOKEN` is used.

## Building locally
```sh
npm ci && npm run build                     # TV app: app/app.min.js (no local.json in the checkout => no LAN values baked in)
python3 installer/build.py payload          # -> installer/neosetup/payload/app.zip + brand.json (git-ignored)
python3 installer/build.py pyz              # -> dist-setup/neolume-setup.pyz
python3 -m pip install pyinstaller          # or pipx; then run build.py with THAT interpreter:
python3 installer/build.py exe              # -> dist-setup/neolume-setup-<os>-<cpu>[.exe|.zip] for this machine only
python3 installer/build.py sums             # -> dist-setup/SHA256SUMS
python3 installer/smoke_test.py dist-setup/neolume-setup-linux-x64          # or: python3 installer/smoke_test.py python3 dist-setup/neolume-setup.pyz
```
PyInstaller cannot cross-compile: each OS/CPU binary is built on that OS/CPU. **Build release artifacts in a clean
checkout** (CI does): `npm run build` bakes values from a developer's `local.json` (PMS/proxy addresses) into
`app/app.js` and `app/app.min.js`, and they would end up in the payload.

The smoke test starts the artifact on free ports (never port 80), loads the page, starts the update server (this
proves the embedded app loads), fetches its manifest and presses "Quit". It contacts neither plex.tv nor a Plex server.

## Tests
```sh
python3 -m unittest discover -s tests/installer        # unit + HTTP integration tests, offline (plex.tv/PMS/GDM mocked)
node tests/installer/e2e/ui_e2e.js [--shots DIR]        # real page in headless Firefox (WebDriver BiDi), mocked backends
```
`tests/installer/helpers.py` points `PLEXNEO_SETUP_DIR` to a temp folder, so tests never read or delete a real
`settings.json`/`helper.json`. Workflow `setup-tests` runs the unit tests on Linux (Python 3.8, 3.12, 3.13), Windows and
macOS, plus the `.pyz` smoke test, the browser test and hadolint.

## Docker image
- Context `installer/` (`.dockerignore` keeps only `plexneo_setup.py` and `neosetup/` without payload).
- `python:3.12-alpine`, runs as `65534:65534`, `PYTHONDONTWRITEBYTECODE`, entrypoint `plexneo_setup.py`,
  default command `--helper --wait --helper-file /data/helper.json` (waits for the file instead of crash-looping).
- Port `32499/tcp` (helper), volume `/data` (read-only is enough), **host networking required** (the helper's LAN and
  TV-address checks need the TV's real source address; on a bridge network every request would come from the bridge).
- Healthcheck: `GET http://127.0.0.1:32499/neo-helper` every 60 s (it is "unhealthy" while waiting for `helper.json`).
- Lint: `hadolint installer/Dockerfile` (clean). Local build: `docker build -t neolume-setup installer/`.

## Code signing (not done)
The binaries are unsigned. macOS: PyInstaller signs ad hoc (required on Apple silicon), but without a Developer ID and
notarization Gatekeeper blocks the first start of a downloaded file; Windows SmartScreen warns for unknown publishers.
README.md tells users how to proceed. Signing would need an Apple Developer ID (+ `notarytool`) and a Windows
code-signing certificate stored as repository secrets.

## Known risks
- Runner images: `macos-15-intel` is GitHub's last Intel macOS image and `ubuntu-22.04` will be retired eventually;
  when they go, switch macOS x64 to a universal2 build and Linux to `ubuntu-24.04` (needs glibc 2.39 on the user side)
  or a manylinux container.
- `windows-11-arm` + PyInstaller is newer than the other targets; if that job fails the others still publish
  (`fail-fast: false`), but the release job waits for all binaries.
- Antivirus programs sometimes flag unsigned PyInstaller one-file executables (false positives). The `.pyz` is the
  fallback for users with Python.
