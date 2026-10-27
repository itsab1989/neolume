# Neolume Setup – setup program

Neolume is a Plex app for 2014 Samsung Smart TVs (Orsay, e.g. H series). Those TVs cannot talk to plex.tv any more
(their encryption is too old). **This small program does the Plex part once, on your computer**, and puts the app
with everything it needs onto the TV. Afterwards the TV only talks to your own Plex Media Server.

> Kurz auf Deutsch: Passende Datei unten herunterladen, doppelklicken (Linux: im Terminal starten), die Seite im
> Browser führt durch alles – auf Wunsch auf Deutsch (Knopf „DE“ oben rechts). Beenden: Knopf „Programm beenden“.

Status: tested with mocked plex.tv/Plex server, in a real browser and on the real home network (server discovery);
**not yet tested end-to-end with a real plex.tv account and a TV** (see `docs/P2-TV-TEST.md`).

Contents: [Download](#1-download) · [Start](#2-start) · [What happens](#3-what-the-program-does) · [Stop & uninstall](#4-stop-and-uninstall)
· [Privacy](#5-privacy-what-is-sent-where) · [Optional helper](#6-optional-helper-watchlist--trends) · [NAS / Docker](#7-nas-docker-synology)
· [Troubleshooting](#8-troubleshooting) · [setup.json](#setupjson-schema-v1) · [Developers](#developers)

## 1. Download
Open the project's **Releases** page on GitHub and download **one** file for the computer you use for the setup
(any computer in the same home network as the TV and the Plex server):

| Your computer | File |
|---|---|
| Windows PC (almost all) | `neolume-setup-windows-x64.exe` |
| Windows on ARM (Snapdragon laptops, Surface Pro X) | `neolume-setup-windows-arm64.exe` |
| Mac with Apple chip (M1, M2, M3, M4 …) | `neolume-setup-macos-arm64.zip` |
| Mac with Intel chip | `neolume-setup-macos-x64.zip` |
| Linux PC | `neolume-setup-linux-x64` |
| Raspberry Pi 4/5 (64-bit OS) or other ARM64 Linux | `neolume-setup-linux-arm64` |
| Anything with Python 3.8 or newer installed | `neolume-setup.pyz` |

Not sure which Mac? Apple menu → *About This Mac* → "Chip: Apple …" = Apple chip, "Processor: Intel …" = Intel.
Not sure on Windows? *Settings → System → About → System type*: "x64-based" = x64, "ARM-based" = ARM.

Nothing is installed: it is one file, you start it when you need it. Optional check of the download: compare with
`SHA256SUMS` (`shasum -a 256 <file>` on Mac/Linux, `certutil -hashfile <file> SHA256` on Windows).

## 2. Start
You need: the computer, TV and Plex server in the **same home network** (not guest Wi-Fi, no VPN), and you are the
**owner** of the Plex server.

**Windows:** double-click the `.exe`. Windows SmartScreen may say *"Windows protected your PC"* because the program is
not signed by a paid certificate: click **More info → Run anyway**. When the Windows firewall asks, allow access for
**private networks** (otherwise the TV cannot fetch the app). A black window opens and stays open – that is the program;
your browser opens the setup page.

**Mac:** double-click the `.zip`, then double-click `neolume-setup`. The first time macOS refuses unsigned programs:
- macOS 15 (Sequoia) and newer: click **Done**, open *System Settings → Privacy & Security*, scroll down to
  *"neolume-setup" was blocked* → **Open Anyway**, confirm with your password, start it again.
- macOS 14 and older: right-click (Ctrl-click) `neolume-setup` → **Open** → **Open**.
- Terminal alternative: `xattr -d com.apple.quarantine ~/Downloads/neolume-setup` and start it again.

A Terminal window opens (that is the program) and your browser opens the setup page. Allow incoming connections if
macOS asks.

**Linux:** in a terminal (the TV fetches the app from port 80, which needs administrator rights on Linux):
```sh
chmod +x neolume-setup-linux-x64
sudo ./neolume-setup-linux-x64
```
Then open the address it prints (`http://127.0.0.1:32480/`) in your browser.

**.pyz (any OS with Python 3.8+):** `python3 neolume-setup.pyz` (Windows: `py neolume-setup.pyz`; Linux with `sudo`).

The setup page only works on this computer (`http://127.0.0.1:32480/`). Starting the program a second time just opens
the page of the running one. There is no configuration file to edit.

## 3. What the program does
The page guides you through six steps (English or German, button at the top right):

1. **Sign in with Plex** – a Plex window opens; sign in there and click *Allow*. Or use a code on plex.tv/link
   (works on a phone, too). Your Plex password is only ever typed on plex.tv.
2. **Choose your server** – found through your Plex account and automatically on your home network (Plex "GDM"
   discovery). Only a home network address (`http://…:32400`) is used.
3. **Choose profiles** – your Plex Home profiles; each one sees only its libraries on the TV and keeps its own watch
   state. Profiles without access: share the server with them in Plex (*Settings → Users & Sharing*), then *Back* and
   choose the server again.
   **Important if you have other user apps on the TV**: the TV **removes every user app that is not
   on the list** when it syncs. Add the `.zip` of each other app under *Advanced* (one path per line). Under *Advanced*
   you can also enter the TV's IP address so that only the TV may fetch the app.
4. **Summary → "Create app package".** Options: *Reset app PINs* (only if you forgot the main profile's PIN in the app:
   all app PINs are deleted once; otherwise they are kept) and *Set up the helper* (see section 6).
5. **To the TV** – keep the page open and follow the steps shown (Samsung 2014):
   1. Once: `MENU` → **Smart Hub** → **Samsung Account** → **Sign in** → user **`develop`** (password usually fills in, otherwise `any`).
   2. Press **SMART HUB** → open **SAMSUNG APPS**.
   3. Go to any app and **hold OK for about 5 seconds** → a menu appears.
   4. **IP Setting** → enter the computer address shown large on the page.
   5. Open the menu again (hold OK) → **Start User App Sync** → press OK **once**.
   6. The page shows "TV … fetched Neolume.zip". "Neolume" appears under **MY APPS** (otherwise close and reopen Smart Hub).
6. **Done** – click *"Clear access data from memory and finish"*, then **Quit program**.

Run it again when a profile is added, you share a library with a new profile, change your Plex password or use
"Sign out of all devices" – the app on the TV then says "run the setup on the computer again". App PINs are kept.

**Update server (optional, last step):** delivers new app versions to the TV while the program runs (port 32499, home
network only, no access data inside).

## 4. Stop and uninstall
- **Stop:** button **Quit program** at the bottom of the page, or close the black/Terminal window, or `Ctrl+C` in it.
  Everything stops: setup page, the TV sync server (port 80), update server and helper.
- **Uninstall:** delete the downloaded file. If you ticked *"Remember settings"* or set up the helper with
  *"Remember access"*, also delete the settings folder:
  - Windows: `%APPDATA%\NeolumeSetup` (paste into the Explorer address bar)
  - Mac: `~/Library/Application Support/NeolumeSetup` (Finder → *Go → Go to Folder…*)
  - Linux: `~/.config/NeolumeSetup` (with `sudo` it is `/root/.config/NeolumeSetup`)
- **Revoke access:** plex.tv → *Account → Authorized Devices* → remove "Neolume" (and "Neolume Helper").
  The TV app then asks for a new setup.
- **Remove the app from the TV:** on the TV, like any other app (or sync again without it).

## 5. Privacy: what is sent where
The program has **no telemetry, no update check and no own server**. It talks only to:

| To | What | When |
|---|---|---|
| **plex.tv** (HTTPS, certificate checked, fixed `https://plex.tv/api/…` addresses only) | sign-in code; then with your sign-in: your account name and avatar, server list, Plex Home profiles, per-profile server access. With the helper: one "switch profile" request per Home profile without a Plex PIN | during the setup |
| **discover.provider.plex.tv** (HTTPS) | only with the optional helper: watchlist and the three Discover lists, per profile | while the helper runs |
| **your Plex server** (home network, HTTP) | `/identity` (no token) and `/library/sections` once per profile token (read only, to count libraries) | during the setup |
| **home network broadcast** (UDP 32414) | "where is a Plex server?" (Plex GDM) | during the setup |
| **your TV** | the app package incl. `setup.json` with the per-profile **server** tokens (no plex.tv account token, no password, no e-mail) | when the TV fetches it |
| your browser | the setup page; avatars are loaded from plex.tv | |

What is stored: by default **nothing on disk** – tokens live in memory and are gone when you quit.
*"Remember settings"* stores only language, the program's device ID, paths of other TV apps and the TV address
(`settings.json`). The optional helper with *"Remember access"* stores the helper key and the plex.tv access of the
chosen profiles in `helper.json`, readable only by your user. Setup page: reachable only from this computer, every
action needs a random per-start key (blocks other websites), host name checked. Sync/update/helper servers: home
network addresses only, fixed list of files/functions, no folders.

## 6. Optional helper (watchlist & trends)
Without the helper everything works with your Plex server. Only the **Plex watchlist** and the Discover rows
**"Trending", "New releases", "Coming soon"** come from plex.tv – the helper fetches them for the TV.

- **Turn on:** in the *Summary* tick **Set up the helper** → *Create app package* → sync to the TV as usual → on the last
  page click **Start helper**. It runs as long as the program runs; the TV hides the watchlist while it is off.
- **Profiles:** the owner and Plex Home profiles **without** a Plex PIN (the PIN is never asked for or stored).
- **Run it permanently:** keep *"Remember access on this computer"* ticked (under *Advanced*, default on), then start
  only the helper with `--helper` (no browser, no sign-in):
  - Windows: Task Scheduler → *Create Basic Task* → "When I log on" → *Start a program* → the `.exe`, argument `--helper`.
  - Mac: *System Settings → General → Login Items* does not take arguments, so create
    `~/Library/LaunchAgents/de.neolume.helper.plist` (Label `de.neolume.helper`, ProgramArguments = full path to
    `neolume-setup`, `--helper`; RunAtLoad and KeepAlive true) and run `launchctl load -w ~/Library/LaunchAgents/de.neolume.helper.plist`.
  - Linux: systemd user unit with `ExecStart=/path/to/neolume-setup-linux-x64 --helper` (no `sudo` needed for the
    helper), `systemctl --user enable --now neolume-helper`, `loginctl enable-linger $USER`. If the setup ran with
    `sudo`, `helper.json` is in `/root/.config/NeolumeSetup/`: copy it to `~/.config/NeolumeSetup/`, `chown` it to
    yourself and keep it `chmod 600`.
  - NAS: see section 7.
- **Security:** the helper is not a proxy – the TV can only call a few fixed functions, each mapped to one fixed plex.tv
  address (`design/reviews/helper-security.md`); home network only (with a TV address under *Advanced*: only the TV),
  only with the key from `setup.json`, rate-limited, never forwards plex.tv tokens to the TV.
  **Never forward port 32499 in your router.**

## 7. NAS (Docker, Synology)
The Docker image runs **only the helper** (the setup itself always runs on a computer with a browser).
1. On a computer: run the setup, tick *Set up the helper*; under *Advanced* enter the **NAS IP address** and keep
   *Remember access*. Create the package and sync it to the TV.
2. Copy `helper.json` from the settings folder (section 4) to a NAS folder, e.g. `/volume1/docker/neolume/`.
3. Start the container – **host networking is required** (the helper must see the TV's real address):
   ```sh
   docker run -d --name neolume-helper --restart=unless-stopped --net=host \
     --user "$(id -u):$(id -g)" -v /volume1/docker/neolume:/data:ro ghcr.io/itsab1989/neolume-setup:latest
   ```
   Image for `linux/amd64`, `linux/arm64` and `linux/arm/v7` (older 32-bit ARM Synology models). Port `32499/tcp`,
   volume `/data` (read-only). Without `helper.json` the container waits and logs "no helper set up".
   After replacing `helper.json` (new setup), restart the container.
4. Do not also start the helper on the computer.

**Synology Container Manager (DSM 7.2+):** *Container Manager → Project → Create*, path `/volume1/docker/neolume`,
source *Create docker-compose.yml* and paste [`docker-compose.yml`](docker-compose.yml). Set `user:` to your user and
group id (SSH: `id`; e.g. `1026:100`) – the container must be able to read `helper.json` (or make the file readable for
that user in File Station). Keep `network_mode: host`. Older DSM ("Docker" package): *Registry* → search
`ghcr.io/itsab1989/neolume-setup` → *Launch* → *Advanced settings* → *Network*: "Use the same network as Docker Host",
*Volume*: add folder `docker/neolume` mounted at `/data` (read-only).

## 8. Troubleshooting
| Message / problem | Fix |
|---|---|
| Windows: "Windows protected your PC" | *More info → Run anyway* (unsigned program). |
| Mac: "cannot be opened" / "developer cannot be verified" | Section 2 (*Open Anyway* in *Privacy & Security*). |
| "Port 80 may not be opened" | Linux: start with `sudo`. Mac/Windows: allow the firewall prompt. |
| "The port is already in use" | Another web server uses port 80 (e.g. IIS, Skype, another copy of this program) – stop it. |
| "No connection to plex.tv" | Is this computer online? Firewall/proxy blocking `plex.tv`? |
| "The server does not answer on your network" | Plex server running? Computer on the same network (no guest Wi-Fi/VPN)? |
| Server list empty | Is the Plex server signed in with *your* account (Plex → Settings → General)? |
| TV fetches nothing | *IP Setting* on the TV = the address shown? Firewall allowed (private network)? "Unlock" if another device fetched first. |
| Another user app disappeared from the TV | It was not on the list: add it under *Advanced*, create the package again, sync again. |
| The page says "The program does not answer any more" | The program window was closed – start it again. |
---

## setup.json schema (v1)

The package `Neolume.zip` contains the release app (same layout as `tools/dev.py build --release`: loader files and `icon/` at the root,
`app.js` + images at the root; `boot.js` with empty `DEV_HOST`) **plus `setup.json` at the root**. The app reads it at start
(`src/core/setupfile.js`; invalid files are rejected, see `tests/p2-setup.test.js`). Example (placeholders):

```json
{
 "schema": 1,
 "kind": "plexneo-setup",
 "createdAt": "2026-10-26T12:00:00Z",
 "setupVersion": "0.1.0",
 "clientIdentifier": "plexneo-0123456789abcdef0123",
 "server": {
  "machineIdentifier": "<PMS machineIdentifier>",
  "name": "Home Server",
  "uris": ["http://<PMS-IP>:32400"]
 },
 "profiles": [
  {"id": 1, "uuid": "<uuid>", "title": "Owner", "thumb": "https://plex.tv/users/<uuid>/avatar?c=…",
   "kind": "owner", "restricted": false, "restrictionProfile": "", "token": "<server token>"},
  {"id": 2, "uuid": "<uuid>", "title": "Kid", "thumb": "", "kind": "home", "restricted": true,
   "restrictionProfile": "little_kid", "token": "<server token>"}
 ],
 "computer": {"address": "<COMPUTER-IP>", "updatePort": 32499}
}
```

| Field | Meaning |
|---|---|
| `schema` | Integer, currently `1`. The app must ignore files with an unknown higher schema (and say "run setup again"). |
| `kind` | Always `plexneo-setup`. |
| `createdAt` | UTC time of the setup (ISO 8601, `Z`). |
| `setupVersion` | Version of the setup program. |
| `clientIdentifier` | `X-Plex-Client-Identifier` the tokens were issued for; the app should send the same value to the PMS. |
| `server.machineIdentifier` | PMS identity. If no URI answers, the app may scan its /24 on port 32400 and compare `GET /identity` (no token). |
| `server.uris` | Plain-HTTP LAN addresses, best first (first one verified via `/identity` during setup). Never public addresses. |
| `profiles[]` | Profiles chosen in the setup, in display order. `kind`: `owner` / `home` / `friend`. `token`: **server-bound token for this PMS only** (from `/api/v2/resources` for the owner, from `shared_servers` for the others). Use as `X-Plex-Token` against `server.uris` only. `thumb`: https avatar on plex.tv (load via `PMS /photo/:/transcode?url=…`), may be empty. `restrictionProfile`: `little_kid` / `older_kid` / `teen` / `""`. |
| `resetAppPins` | Optional, only present as `true` when "Reset app PINs" was ticked. The app then deletes all app PINs once for this setup (remembered by `createdAt`). Without it, app PINs are kept across setups of the same server (`machineIdentifier`). |
| `helper` | Optional, only when "Set up the helper" was ticked: `{"url": "http://<private IPv4>:32499", "key": "<random, 32 chars>"}`. The app sends `key` as `X-Neo-Key` and the profile uuid as `X-Neo-Profile` to the fixed helper routes; **no plex.tv token** is in `setup.json` or ever sent to the TV. Without it the app makes no helper request. |
| `computer` | LAN address of the computer that ran the setup and the port of the optional update server (`GET /neo-helper`, `/update/manifest.json` `{name, version, size, sha256, app}`, `/update/app.js`). `null` if unknown. |

No account password, no Plex PINs, no e-mail addresses. Profile protection uses the app's own PIN per profile (set on the TV, salted hash only).
A 401 from the PMS for a profile token → the app shows "run setup on the computer again".

---

## Developers

```
installer/
  plexneo_setup.py        launcher (adds installer/ to sys.path)
  build.py                build: payload, .pyz, PyInstaller binary, SHA256SUMS (see BUILD.md)
  smoke_test.py           start a built artifact, load page + embedded app, quit
  BUILD.md                how releases are built (GitHub Actions, Docker, APP_SLUG)
  Dockerfile, docker-compose.yml, .dockerignore   helper-only image for a NAS
  neosetup/
    app.py                CLI + start (UI on 127.0.0.1:32480, browser opens; second start reuses the running one)
    wizard.py             state machine; public_state() never contains tokens
    webui.py, ui.html     local UI (Host/Origin/CSRF checks, CSP with nonce, no innerHTML), "Quit" button
    plextv.py             plex.tv: PIN, user, resources, home users, shared_servers (fixed https paths only)
    netutil.py            GDM discovery, LAN address choice, read-only PMS probes (/identity, /library/sections)
    package.py            release package + setup.json + widgetlist.xml (in memory)
    lanserver.py          sync (port 80) + update (32499) servers: allow-list, LAN-only, lock to first TV
    helper.py             optional helper on port 32499: fixed TV routes -> fixed plex.tv URLs (allow-list), store (0600), rate limit
    settings.py           optional settings file without tokens (folder overridable with PLEXNEO_SETUP_DIR)
    payload/app.zip       embedded TV app + payload/brand.json (built by build.py payload; git-ignored)
```

Run from the checkout: `python3 installer/plexneo_setup.py` (needs `npm run build` first; uses `app/app.min.js`).
Options: `--brand ID` (brand profile, `brand/README.md`), `--base <widgetId>.zip`, `--repo DIR`, `--icon w4|w3|original`, `--extra [ID=]PATH.zip` (repeatable), `--port 32480`,
`--update-port 32499`, `--no-browser`, `--helper` (only the helper, from the saved helper file), `--helper-file PATH`,
`--wait` (with `--helper`: wait for the file), `--version`. App source order: `--base` → `--repo` →
embedded `neosetup/payload/app.zip` → this checkout. Whatever the source, `DEV_HOST` is forced empty and
`bench.js`/`proto.js` are dropped.

Tests (offline, plex.tv/PMS/GDM mocked): `python3 -m unittest discover -s tests/installer`;
browser test: `node tests/installer/e2e/ui_e2e.js` (headless Firefox). Building and releasing: [BUILD.md](BUILD.md).
