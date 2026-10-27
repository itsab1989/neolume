# Installing Neolume – step by step

[Deutsche Fassung](INSTALL.de.md) · [FAQ](FAQ.md) · [Back to the overview](../README.md)

This guide is written for people **without any technical background**. Follow it from top to bottom; every button on the
remote and every menu on the TV is named. Plan about **20 minutes** the first time.

> **How to read this guide**
> - `THIS` means a **button on the remote** (for example `MENU`, `OK`, `RETURN`, `SMART HUB`).
> - **This** means a **word on the screen** that you select.
> - → means "then choose".
> - The TV's menus follow the TV's language. The English names are given here; on a German TV the German name is in brackets.
>   A few entries (**IP Setting**, **Start User App Sync**) are always in English.
> - A step marked *(to be verified)* has not yet been checked word for word on a real TV in that language. If what you see
>   differs, please tell us in an [issue](https://github.com/itsab1989/neolume/issues) so we can fix the guide.

## Contents

1. [What you need](#1-what-you-need)
2. [How it works (in one minute)](#2-how-it-works-in-one-minute)
3. [Prepare the TV (once)](#3-prepare-the-tv-once)
4. [Download and start the setup program](#4-download-and-start-the-setup-program)
5. [Sign in, choose server and profiles](#5-sign-in-choose-server-and-profiles)
6. [Build the app package](#6-build-the-app-package)
7. [Send the app to the TV](#7-send-the-app-to-the-tv)
8. [What success looks like](#8-what-success-looks-like)
9. [First start on the TV](#9-first-start-on-the-tv)
10. [Updating](#10-updating)
11. [Uninstalling](#11-uninstalling)
12. [Troubleshooting](#12-troubleshooting)
13. [Optional: the helper for Watchlist and Discover](#13-optional-the-helper-for-watchlist-and-discover)

---

## 1. What you need

- ✅ A **Samsung Smart TV from 2014** with Smart Hub. Neolume is developed on a **UE48H8000**.
  - Where is the model number? On the sticker on the **back of the TV**, or on the TV: `MENU` → **Support** →
    **Contact Samsung** (Unterstützung → Samsung kontaktieren). This screen shows the **Model Code** and the **Software Version**.
  - The **fifth character** tells the year: **H** = 2014 (for example UE48**H**8000, UE55**HU**7500). See the
    [FAQ](FAQ.md#which-tvs-does-neolume-run-on) for other years.
- ✅ The TV is **connected to your home network** (Wi-Fi or cable).
- ✅ A **Plex Media Server** that is running on the **same home network**, and **you are its owner**.
- ✅ Your **Plex account** (e-mail and password, or Google/Apple sign-in).
- ✅ A **computer** (Windows, Mac or Linux) on the **same home network** – not on a guest Wi-Fi, and with any VPN switched off.
- ✅ The TV **remote**. The standard remote is easiest; the Smart Control (touchpad remote) also works.

## 2. How it works (in one minute)

Samsung no longer accepts new apps for 2014 TVs in its store. But every Samsung TV of that time has an official
**developer mode** for installing your own apps:

1. On the TV you sign in to Smart Hub with the special user **`develop`**.
2. You tell the TV the **address of your computer** (**IP Setting**).
3. You press **Start User App Sync**. The TV then downloads a list of apps and the app package from your computer.

The **setup program** on your computer does the rest: it signs you in to Plex once, fetches access for your profiles,
builds the app package and hands it to the TV.

> ⚠️ **Important:** during the sync the TV **removes every self-installed app that is not on the list.** Apps from the
> Samsung store (Netflix, YouTube, …) are **not** affected. If you have other self-installed apps, see
> [step 5.4](#54-other-self-installed-apps-advanced).

## 3. Prepare the TV (once)

You only do this once. The TV remembers it, even after switching off.

### 3.1 Check that the TV is online
1. Press `MENU`.
2. Choose **Network** (Netzwerk) → **Network Status** (Netzwerkstatus).
3. It should say that the TV is connected. If not, connect it first under **Network** → **Network Settings**.
4. Press `RETURN` (or `EXIT`) to leave the menu.

### 3.2 Sign in as the user "develop"
1. Press `MENU`.
   *Smart Control:* press `MORE` and choose **Menu** on the screen *(to be verified)*.
2. Choose **Smart Hub** → **Samsung Account** (Samsung-Konto).
   - If you are signed in, the list starts with **Log out** and the bottom right corner shows *My Account: …*.
     If it already says *My Account: develop*, you are done – skip to [step 3.3](#33-open-the-samsung-apps-screen).
     If another account is signed in, choose **Log out** first.
3. Choose the sign-in entry (German menu: **Anmeld.**). A list of the accounts on this TV appears.
4. **`develop` is in the list:** select it and choose **Log In** (Anmelden). **No password is needed.**
5. **`develop` is not in the list yet:** add it by typing **`develop`** (all lower case) as the ID with the on-screen
   keyboard. The password usually fills in by itself; if it stays empty, type **`any`** *(first-time creation on a TV
   that never had `develop` – to be verified; some TVs reportedly expect `111111`)*. Then choose **Log In**.

You stay signed in as `develop`, even after switching off. Store apps keep working.
Without the `develop` sign-in, the entries **IP Setting** and **Start User App Sync** (step 7) do not exist.

### 3.3 Open the SAMSUNG APPS screen
1. Press `SMART HUB` (the colourful button in the middle of the remote).
2. A bar appears at the bottom of the screen with the groups **Recent** and **Featured**. In **Featured**, select the
   turquoise **SAMSUNG APPS** tile (next to *Multimedia* and *Tutorial*) and press `OK`.
3. The SAMSUNG APPS screen opens. It has the sections **RECOMMENDED** and **MY APPS** (German menu: EMPFOHLEN /
   EIGENE APPS); further down are *Most Popular*, *What's New* and *Categories*.

Leave the TV on this screen and go to your computer.

## 4. Download and start the setup program

### 4.1 Download
Open the **[latest release](https://github.com/itsab1989/neolume/releases/latest)** on your computer. Under **Assets**, download
the file for your computer:

| Your computer | File |
|---|---|
| Windows 10/11, normal PC or laptop | `neolume-setup-windows-x64.exe` |
| Windows on an ARM device (Surface Pro X, Snapdragon laptops) | `neolume-setup-windows-arm64.exe` |
| Mac with Apple chip (M1, M2, M3, M4 …) | `neolume-setup-macos-arm64.zip` |
| Mac with Intel chip | `neolume-setup-macos-x64.zip` |
| Linux PC | `neolume-setup-linux-x64` |
| Linux on ARM (e.g. Raspberry Pi 4/5 with 64-bit system) | `neolume-setup-linux-arm64` |
| Anything else with Python 3.8 or newer | `neolume-setup.pyz` |

Not sure which Mac? Apple menu → **About This Mac**: "Chip: Apple …" = Apple chip, "Processor: Intel …" = Intel.
Not sure which Windows? **Settings → System → About → System type**: "x64-based" = x64, "ARM-based" = ARM.

### 4.2 Start it

**Windows**
1. Open your **Downloads** folder and **double-click** `neolume-setup-windows-x64.exe`.
2. If a blue window says **"Windows protected your PC"**: click **More info** → **Run anyway**.
   (The program is not signed with a paid certificate; that is why Windows asks.)
3. If **Windows Security** asks whether to allow network access: tick **Private networks** and click **Allow access**.
   Without this the TV cannot reach your computer.
4. A black window opens and your browser shows the setup page. **Keep the black window open** until you are finished.

**Mac**
1. Open your **Downloads** folder and **double-click** the `.zip` file. A file called `neolume-setup` appears.
2. **Double-click** `neolume-setup`. The first time, macOS refuses programs from unknown developers
   (the program is not notarised by Apple):
   - **macOS 15 (Sequoia) and newer:** click **Done**, open **System Settings → Privacy & Security**, scroll down to
     *"neolume-setup" was blocked* → **Open Anyway**, confirm with your password, then double-click it again.
   - **macOS 14 and older:** right-click (or `Ctrl`-click) `neolume-setup` → **Open** → **Open**.
   - Terminal alternative: `xattr -d com.apple.quarantine ~/Downloads/neolume-setup`, then double-click it again.
3. A Terminal window opens (that is the program) and your browser shows the setup page.
   If macOS asks **"Do you want the application to accept incoming network connections?"**: click **Allow**.
4. **Keep the Terminal window open** until you are finished. To stop the program later, click **Quit** on the setup page.

**Linux**
1. Open a terminal in the folder with the download and run:
   ```sh
   chmod +x neolume-setup-linux-x64
   sudo ./neolume-setup-linux-x64
   ```
   (`sudo` is needed because the TV always fetches apps on port 80. Use `neolume-setup-linux-arm64` on ARM.)
2. If you use a firewall: allow port 80 while you install, e.g. `sudo ufw allow 80/tcp`.

**Python version (`.pyz`, any system)**
- Mac/Linux: `python3 neolume-setup.pyz` (Linux: `sudo python3 neolume-setup.pyz`).
- Windows: `py neolume-setup.pyz` in the Command Prompt (Python from python.org, with "Add python.exe to PATH" ticked).

If the browser does not open by itself, open **http://127.0.0.1:32480/** yourself.

## 5. Sign in, choose server and profiles

The setup page is available in English and German (switch at the top).

### 5.1 Sign in with Plex
1. Click **Sign in with Plex**.
2. A plex.tv window opens. Sign in as usual and click **Allow**.
3. The setup page continues by itself.

No pop-up? Use **Use a code on plex.tv/link** instead: open `plex.tv/link` on any device (your phone works too), sign in and
type the code shown on the setup page.

You type your Plex password **only on plex.tv** – never into Neolume.

### 5.2 Choose your server
Your servers are listed. **Click your server.** It should show **found on your network**.
If it is not found, see [Server not found](#server-not-found).

### 5.3 Check the profiles
All profiles of your Plex Home are listed and ticked. Each profile gets its own access to your server – with its own
libraries and its own watched status.
- A profile shows **no access**? In Plex (web app), open **Settings → Users & Sharing**, share your server with that
  profile, then click **Back** on the setup page and choose the server again.

### 5.4 Other self-installed apps (Advanced)
Open **Advanced** only if one of these applies:
- **You use other self-installed apps** on the TV (not from the Samsung store). Enter the path of each app's `.zip` file,
  one per line. **Otherwise the TV deletes them during the sync.**
- You want that **only your TV** may fetch the app: enter the TV's IP address. You find it on the TV under `MENU` →
  **Network** → **Network Status** → **IP Settings** *(to be verified)*.

## 6. Build the app package

1. Check the **Summary**. Optional extras there: **Other servers** (servers that someone shared with you, see
   [section 14](#14-optional-other-servers-shared-with-you)) and the **helper** ([section 13](#13-optional-the-helper-for-watchlist-and-discover)).
   Both are off unless you tick them.
2. Click **Create app package**.
3. The page now shows **your computer's address in large digits** (for example `192.168.1.20`) and waits for the TV.
   Write it down – you need it in the next step.

## 7. Send the app to the TV

Go back to the TV. You should still be on the **SAMSUNG APPS** screen from [step 3.3](#33-open-the-samsung-apps-screen).

### 7.1 Tell the TV your computer's address (IP Setting)
1. With the arrow buttons, move to **any app tile** (for example a preinstalled app).
2. **Press and hold `OK` for about 5–6 seconds** until a menu appears. Its entries are **Move**, **Delete**,
   **Delete Multiple**, **View Details**, **Change View**, **Lock/Unlock**, **Update apps**, **IP Setting** and
   **Start User App Sync** (German menu: Verschieben, Entfernen, Mehr löschen, Details anzeigen, Ansicht ändern,
   Sperren/Sperre aus, Apps aktualisieren – the last two entries stay in English).
   No menu? Make sure the focus is really on an app tile and that you are signed in as `develop` ([step 3.2](#32-sign-in-as-the-user-develop)).
3. Choose **IP Setting** and press `OK`. The dialog **Develop IP Setting** opens with **four empty boxes** and an **OK** button.
   > ⚠️ The TV **never shows the address it has stored** – the boxes are always empty, even if an address is saved.
   > **Do not confirm the empty dialog with OK**: that can erase the stored address. Either type the full address again,
   > or leave with `RETURN`.
4. Type the address from the setup page with the **number buttons**, one block per box. Move to the next box with
   **`►` (right arrow)** if the TV does not jump on by itself *(automatic jump to be verified)*; go back with **`◄`** to
   correct a digit.
5. Select **OK** and press `OK`.

You only need to do this again if your computer's address changes.

### 7.2 Start the sync
1. Again **hold `OK` for about 5 seconds** on an app tile.
2. Choose **Start User App Sync** and press `OK`.
3. The message **"User Apps Sync is requested"** appears (in English, also on a German TV). Press `OK` **once only**.
   If the menu is still open afterwards and an entry such as **Move** looks active, press `RETURN` – that is harmless.
4. Wait. The TV first fetches the app list, then the app; this usually takes **20–30 seconds**.

## 8. What success looks like

- **On the setup page** you see, one after the other: *"TV … fetched widgetlist.xml"* and *"TV … fetched the app package"*.
- **On the TV**, **Neolume** appears under **MY APPS** (EIGENE APPS) with its icon – a highlighted poster card with a play symbol.
  Not there? Close Smart Hub (`SMART HUB` or `EXIT`) and open it again, or switch the TV off and on with the remote.
- Other self-installed apps that you entered in [step 5.4](#54-other-self-installed-apps-advanced) are still there.

Then click **The app is on the TV** → **Clear access data from memory and finish** on the setup page, close the browser tab
and close the black/Terminal window (or press `Ctrl` + `C` in it).

## 9. First start on the TV

1. In **MY APPS**, select **Neolume** and press `OK`.
2. Neolume opens directly in the **main profile** (the owner). To switch, open the side menu with `◄` and select your
   avatar at the top. Under **Settings → Profile & account → Start profile** you can choose to start with the **profile picker** instead.
3. On the first start Neolume asks whether adult profiles should be protected with an **app PIN**. This PIN only applies to
   Neolume on this TV; your Plex PIN is not used. You can also choose **Remind me later**.
4. Home loads Continue Watching, Up Next and what is new in your libraries.
5. A short card shows how to use the remote. You can open it again under **Settings** → **Help & info**.

From now on Neolume talks **only to your server**. Your computer can stay off; the internet is not needed for watching
(your server still uses the internet for posters and metadata).

**Remote cheat sheet**
| Button | What it does |
|---|---|
| Arrow buttons, `OK` | Move, select |
| `RETURN` | Back (on Home: open the side menu, then *Exit*) |
| `PLAY` / `PAUSE` / `STOP` | Playback |
| `◄◄` / `►►` | Skip back / forward (in lists: jump several items) |
| `TOOLS` | Options for the focused item ("More" menu in the player) |
| `INFO` | Information / help for the current screen |
| `A` red / `B` green / `C` yellow / `D` blue | Shown at the bottom of each screen (for example yellow = mark as watched, blue = search) |
| Number buttons | Jump to a letter in a library (like phone typing) |

## 10. Updating

1. Download the new version of the setup program ([step 4](#4-download-and-start-the-setup-program)).
2. Start it and repeat steps 5 to 7. **IP Setting** is only needed if your computer's address changed.
3. The sync replaces Neolume – no second app appears. Your settings and app PINs in Neolume are kept.

Run the setup again also when you **add a profile**, **share your server with a new profile**, **change your Plex password**
or use **Sign out of all devices** on plex.tv. Neolume tells you when this is needed ("Run the setup on the computer again").

## 11. Uninstalling

1. Press `SMART HUB` → open **SAMSUNG APPS** → move to **Neolume**.
2. **Hold `OK` for about 5–6 seconds** → **Delete** (Entfernen) → confirm *(wording of the confirmation to be verified)*.
3. On plex.tv, open **Account** → **Authorized Devices** and remove the **Neolume** entry. This cancels the access.
4. Optional: remove shares in Plex that you created only for Neolume.
5. Optional: sign out of `develop` on the TV: `MENU` → **Smart Hub** → **Samsung Account** → **Log out**.

Nothing in the TV's firmware or system is changed by Neolume.

## 12. Troubleshooting

### The menu with "IP Setting" / "Start User App Sync" does not appear
- Are you signed in as **`develop`**? ([step 3.2](#32-sign-in-as-the-user-develop)) Only then do these entries exist.
- Are you in the **SAMSUNG APPS** screen, with the focus on an app tile under **MY APPS** (not on a category)?
- **Hold `OK` long enough** (5–6 seconds) instead of pressing it several times.

### The sync runs, but no app appears
- Did the setup page report *"fetched widgetlist.xml"*?
  - **No** → the TV cannot reach your computer. See the next section.
  - **Yes, but not the app package** → start the sync again. If it keeps failing, click **Create app package** again.
  - **Both yes** → close and reopen Smart Hub, or switch the TV off and on. Look in **MY APPS**, not only in the small bar.
- Is the address under **IP Setting** exactly the one shown on the setup page? The dialog never shows the stored address,
  so simply type it again (all four boxes) and select **OK** – and never confirm the empty dialog.

### The TV cannot reach the computer
- **Firewall:** your computer must accept incoming connections on **port 80**.
  - Windows: **Windows Security** → **Firewall & network protection** → **Allow an app through firewall** → allow the setup
    program for **Private**. Your network must be set to **Private**, not "Public" (*Settings → Network & Internet → Properties*).
  - Mac: **System Settings** → **Network** → **Firewall** → **Options** → set the setup program to **Allow incoming connections**.
  - Linux: for example `sudo ufw allow 80/tcp` while you install.
- **Port 80 in use:** if the setup page says the port is busy, another web server is running (or the setup program twice).
  Close it and try again.
- **Same network:** computer and TV must be on the same home network – no guest Wi-Fi, no VPN, no separate "IoT" network.
  Some routers isolate Wi-Fi devices from each other ("client isolation" / "AP isolation") – switch that off in the router.
- **Locked to the first TV:** after the first fetch the setup program only serves that device. If a different device fetched
  first, click **Unlock** on the setup page.

### Other self-installed apps disappeared after the sync
That is how the TV's sync works: it **removes every self-installed app that is not on the list**. Add the `.zip` files of
**all** apps you want under **Advanced** ([step 5.4](#54-other-self-installed-apps-advanced)), create the package again and
sync again. You may have to sign in to those apps again.

### Server not found
- Is your Plex Media Server running? On the computer, open `http://<server address>:32400/web` in the browser.
- Is the computer on the same network as the server?
- Neolume only uses home-network addresses. A server that is only reachable over the internet is not supported.

### "Windows protected your PC" / macOS says the app "cannot be opened"
The setup program is not signed with a paid certificate. Windows: **More info** → **Run anyway**. Mac: **System Settings**
→ **Privacy & Security** → **Open Anyway** (details in [step 4.2](#42-start-it)).

### Why not HTTPS?
The TV only supports old encryption (TLS 1.1 and older); plex.tv requires TLS 1.2 or newer. That is why the computer does
the sign-in, and the TV talks to your server **over HTTP inside your home network**. This cannot be changed on the TV. Use
Neolume only on a home network you trust.

### Neolume says "Run the setup on the computer again"
An access became invalid (new Plex password, "Sign out of all devices", changed share). Repeat steps 4 to 7.

### I forgot the app PIN
The main profile can change or remove every profile's PIN under **Settings** → **Profile & account** → **PINs of all profiles**.
Forgot the **main profile's** PIN? Run the setup again, tick **Reset app PINs** in the summary and install again.

### Resetting Smart Hub – last resort
**Reset Smart Hub** (Smart Hub zurücksetzen, under `MENU` → **Smart Hub** → **Reset Smart Hub**) deletes **all**
self-installed apps with their data and signs `develop` out. Afterwards repeat step 3.2 and steps 4 to 7. A factory reset
has the same effect (and more).

### Older TVs (2012/2013, E/F series)
Not tested, and the developer menu is different. Reported path: `SMART HUB` → red button `A` (log in) → `develop`
(password possibly `111111`) → `TOOLS` → **Settings** → **Development** → **Server IP** → **User Application Synchronization**
*(to be verified)*.

Still stuck? [Open an issue](https://github.com/itsab1989/neolume/issues) with your TV model, what you see on the TV and
what the setup page says.

## 13. Optional: the helper for Watchlist and Discover

Everything in Neolume works with your Plex Media Server alone. Only your **Plex watchlist** and the Discover rows
**Trending**, **New releases** and **Coming soon** live on plex.tv, which the TV cannot reach. The optional **helper**
fetches exactly these lists for the TV. It is part of the setup program.

1. On the setup page, in the **Summary**, tick **Set up the helper**, then **Create app package** and install as usual.
2. Click **Start helper** at the bottom of the page. The helper runs as long as the setup program is open.
3. On the TV: **Settings** → **Display** → **Watchlist**. If the helper is not running it says "helper not reachable"
   and tries again after a minute.

**Keep it running permanently (optional)** on an always-on computer or a NAS:
- **Computer:** start the setup program with `--helper` (for example `neolume-setup-windows-x64.exe --helper`) from your
  system's autostart.
- **NAS / Docker (for example Synology Container Manager):** set the helper up once on a computer (tick
  *Remember access on this computer* and enter the NAS address under *Advanced*), copy the file `helper.json` to a folder on
  the NAS (for example `/volume1/docker/neolume/`), then run:
  ```sh
  docker run -d --name neolume-helper --restart unless-stopped --net=host \
    -v /volume1/docker/neolume:/data:ro ghcr.io/itsab1989/neolume-setup --helper --helper-file /data/helper.json
  ```
  (`--net=host` lets the helper see the TV's real address.) Do not also run the helper on your computer.

The watchlist is available for the owner and for Plex Home profiles **without** a Plex PIN. The helper is not an open
proxy: it only answers devices on your home network and only fetches a fixed list of plex.tv pages.
**Never forward port 32499 in your router.**

## 14. Optional: other servers (shared with you)

Has someone shared their Plex server with you, for example a friend? Neolume can show that server's libraries **in addition to
your own server** – off by default.

1. On the setup page, in the **Summary**, click **Search shared servers**. The program looks at the servers that were shared
   with each chosen profile (only your own access – it never asks for anyone else's password or token) and checks each one
   from your computer.
2. Tick the servers you want and click **Create app package**, then install as usual. Each profile only gets the servers
   that were shared with **that** profile.
3. On the TV the libraries appear in the side menu with a small "from <server>" line. You can hide or move them under
   **Settings → Interface → Customize side menu**. Search and Home stay with your own server.

What the status next to a server means:
- **reachable** – fine, the TV can use it.
- **secure connections only** – the server requires encrypted connections, which the 2014 TV cannot do. The owner can set
  **Settings → Network → Secure connections** to **Preferred** in Plex; then search again.
- **not reachable right now** – the server may be off, or it is only reachable through the Plex relay (which needs
  encryption, so the TV cannot use it). You can still add it; the app tries again later.

> ⚠️ The TV cannot encrypt. The connection to a shared server therefore goes **over the internet without encryption**, and
> the access to that server could be read on the way. Your own server stays on your home network as before. Only tick a
> server if you are fine with that.

If the shared server's internet address changes, the optional [helper](#13-optional-the-helper-for-watchlist-and-discover)
finds the new one automatically; without the helper, run the setup again. If a shared server is not reachable, only its
libraries show a message – everything else keeps working.
