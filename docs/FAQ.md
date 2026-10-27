# Neolume – Frequently asked questions

[Deutsch](FAQ.de.md) · [Installation guide](INSTALL.md) · [Overview](../README.md)

- [Is Neolume an official Plex app?](#is-neolume-an-official-plex-app)
- [Why does Neolume exist?](#why-does-neolume-exist)
- [Which TVs does Neolume run on?](#which-tvs-does-neolume-run-on)
- [What resolution does Neolume use? Does it look good on a 1080p or 4K TV?](#what-resolution-does-neolume-use-does-it-look-good-on-a-1080p-or-4k-tv)
- [Which video formats play?](#which-video-formats-play)
- [Do I need Plex Pass?](#do-i-need-plex-pass)
- [Do I need my computer all the time?](#do-i-need-my-computer-all-the-time)
- [Does Neolume need the internet?](#does-neolume-need-the-internet)
- [Does it work away from home (remote access)?](#does-it-work-away-from-home-remote-access)
- [Profiles, kids profiles and PINs](#profiles-kids-profiles-and-pins)
- [What happens to my other self-installed apps?](#what-happens-to-my-other-self-installed-apps)
- [Does it replace the old Plex app on the TV?](#does-it-replace-the-old-plex-app-on-the-tv)
- [What data does Neolume send, and where are my credentials?](#what-data-does-neolume-send-and-where-are-my-credentials)
- [Is it safe? Is the connection encrypted?](#is-it-safe-is-the-connection-encrypted)
- [How do I update or remove Neolume?](#how-do-i-update-or-remove-neolume)
- [Can I change or share Neolume?](#can-i-change-or-share-neolume)
- [How can I support the project?](#how-can-i-support-the-project)

---

### Is Neolume an official Plex app?
No. Neolume is an independent, open-source hobby project. It is **not affiliated with, endorsed or supported by Plex, Inc.**
"Plex" is a trademark of Plex, Inc. and is used only to say what Neolume works with. Plex support cannot help with Neolume –
please open an [issue](https://github.com/itsab1989/neolume/issues) instead.

### Why does Neolume exist?
Samsung TVs from 2014 can only use old encryption (TLS 1.1 and older). plex.tv stopped accepting it, so the TV's original
Plex app can no longer sign in, and it is no longer maintained. Neolume moves the sign-in to your computer (once, during
setup); afterwards the TV only talks to your own Plex Media Server on your home network, which works without modern encryption.

### Which TVs does Neolume run on?
Neolume is built for Samsung's **"Orsay" Smart TV platform** – the Smart Hub with the Maple/WebKit browser engine that
Samsung used from about **2011 to 2015**. Samsung later called it the "Legacy Platform". The year is the **fifth character**
of the European/US model number (UE/UN/UA…): **D** = 2011, **E** = 2012, **F** = 2013, **H** / **HU** = 2014, **J** / **JU** / **JS** = 2015.

| Model year | Platform | Neolume |
|---|---|---|
| **2014 – H series** (e.g. UE40H6400, UE48H8000, UE55H7000) | Orsay | ✅ **Supported.** Developed and tested on a UE48H8000. Other H models use the same platform and should work; please report your model. |
| **2014 – HU series (4K)** (e.g. UE55HU7500, UE65HU8500) | Orsay | 🟡 Should work (same platform), not tested yet. |
| **2013 – F series** (e.g. UE46F6500) | Orsay | 🟡 Untested. Older browser engine and a different developer menu; may work partly. |
| **2012 – E series** (e.g. UE40ES6300) | Orsay | 🟠 Untested and unlikely to work well: older engine, less memory, different install menu. |
| **2011 and older – D/C series** | Internet@TV / early Smart Hub | ❌ Not supported. |
| **2015 – J series that still run Orsay** (some entry-level J4xxx / J5xxx models) | Orsay | 🟡 Untested. Check the platform first (see below). |
| **2015 – J series with Tizen** (most J5500 and up, JU/JS) | Tizen | ❌ Not supported – a completely different platform. |
| **2016 and later** (K, M, N, R, T, … series) | Tizen | ❌ Not supported. Use the official Plex app from the Samsung store. |
| Non-Smart TVs | – | ❌ No apps possible. |

**Not sure whether your TV runs Orsay or Tizen?** On an Orsay TV (2014 shown here), pressing `SMART HUB` shows a bar at
the bottom with the groups **Recent** and **Featured**, and in Featured a turquoise **SAMSUNG APPS** tile that opens a screen
with **RECOMMENDED** and **MY APPS**; `MENU` → **Smart Hub** → **Samsung Account** exists. Tizen TVs have no SAMSUNG APPS
screen and no `develop` sign-in – there you will not find **IP Setting** or **Start User App Sync**.

**Practical requirement for every model:** you must be able to sign in to Smart Hub as `develop` and find **IP Setting** and
**Start User App Sync** (see the [installation guide](INSTALL.md#3-prepare-the-tv-once)). If those entries exist, Neolume
can be installed; whether everything runs smoothly depends on the model's speed and memory.

### What resolution does Neolume use? Does it look good on a 1080p or 4K TV?
Yes. The **user interface** is designed for **1280 × 720** pixels – that is the size the Orsay platform gives an app
(`config.xml` declares 1280 × 720, and every screen is laid out on that grid). The TV then **scales it to its panel**:
- **720p panels:** shown 1:1.
- **1080p panels** (most 2014 models): scaled up by the TV; text and icons were designed large and with high contrast so
  they stay crisp from the sofa.
- **4K panels (HU series):** also scaled by the TV, like every other Smart Hub app of that year.

**Video** is not limited to 720p. The TV decodes the video itself and shows it full-screen at its own resolution:
- Neolume plays **up to 1080p** directly (H.264, 8-bit).
- Higher resolutions (for example 4K files) and formats the TV cannot decode over the network are **converted by your
  Plex Media Server to 1080p H.264**. 2014 Smart Hub apps cannot play 4K streams, even on 4K TVs.

### Which video formats play?
What the TV can decode over the network plays **directly**: H.264 up to 1080p with 8-bit colour, with common audio
formats. Everything else – **HEVC/H.265, 10-bit H.264, 4K, some audio formats and picture-based subtitles** – is **converted by
your Plex Media Server** on the fly. That needs a server with enough processing power (or hardware transcoding).
The player shows on request (`INFO`) whether a title plays directly or is being converted, and why.

### Do I need Plex Pass?
No. Some extras use data that your server only creates with Plex Pass (for example **skip-intro/credits markers** and
**seek preview thumbnails**). Without Plex Pass just those extras are missing.

### Do I need my computer all the time?
No. Only for the **one-time setup** and for **updates**. Afterwards the computer can be switched off.
Exception: if you want the **watchlist** and the **Discover** rows from plex.tv, the optional helper must run somewhere on
your home network (a computer or a NAS).

### Does Neolume need the internet?
Not for watching – only your Plex Media Server on the home network (the server itself uses the internet for posters and
metadata). The setup needs the internet once (plex.tv sign-in).

### Does it work away from home (remote access)?
No, by design. Neolume only uses server addresses on your home network, so no access ever travels over the internet unencrypted.

### Profiles, kids profiles and PINs
- All **Plex Home** profiles chosen during setup are available. Each sees only its own libraries and keeps its own watched status.
- **Kids profiles** (Plex "little kid", "older kid", "teen") get reduced settings; you can require a PIN to leave a kids profile.
- Without plex.tv the TV cannot check your **Plex PIN**. Instead, each profile can have its own **app PIN** in Neolume.
  Only a salted hash is stored. Forgot it? The main profile can reset other PINs under **Settings → Profile & account**;
  for the main profile's own PIN, run the setup again with **Reset app PINs** ticked.

### What happens to my other self-installed apps?
During the sync the TV **removes every self-installed app that is not on the sync list**. That is how the TV works, not a
Neolume decision. Add your other apps in the setup program under **Advanced** before you sync. Apps from the Samsung store
are not affected.

### Does it replace the old Plex app on the TV?
No. Neolume is a separate app with its own name. A preinstalled Plex app stays as it is.

### What data does Neolume send, and where are my credentials?
- Neolume sends requests **only to your Plex Media Server** (libraries, images, playback, progress). No telemetry, no ads,
  no analytics. A diagnostic log is sent only when you ask for it, and only to a computer on your home network.
- On the TV, each profile has its **own server access** that is valid only for your server, stored in the app's storage on the TV.
  Your Plex password is not stored anywhere.
- The setup program keeps access data **only in memory** and does not write it to disk – except if you choose to keep the
  optional helper running ("Remember access on this computer"), which stores a protected file readable only by you.

### Is it safe? Is the connection encrypted?
- Between **TV and server** the connection is **not encrypted** (HTTP), because the TV cannot do modern encryption.
  It stays **inside your home network**. Use Neolume only on a network you trust.
- The **plex.tv sign-in** on your computer is encrypted (HTTPS).
- The setup page only accepts connections from your own computer; the app package is only handed to devices on your home
  network, and after the first fetch only to that TV.
- To revoke Neolume's access at any time: plex.tv → **Account** → **Authorized Devices** → remove **Neolume**.

### How do I update or remove Neolume?
- **Update:** download the new setup program, run it, and sync again – see [Updating](INSTALL.md#10-updating).
- **Remove:** see [Uninstalling](INSTALL.md#11-uninstalling).

### Can I change or share Neolume?
Yes. Neolume is released under the [MIT License](../LICENSE). If you distribute a modified version, please use a different
name and icon so nobody confuses it with this project.

### How can I support the project?
Neolume is free and stays free. Bug reports and feedback from different TV models help the most. If you would like to say
thanks, you can buy me a coffee on [Ko-fi](https://ko-fi.com/itsab1989) – entirely optional.
