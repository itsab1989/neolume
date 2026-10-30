# Neolume – Frequently asked questions

[Deutsch](FAQ.de.md) · [Installation guide](INSTALL.md) · [Overview](../README.md)

- [Is Neolume an official Plex app?](#is-neolume-an-official-plex-app)
- [Why does Neolume exist?](#why-does-neolume-exist)
- [Which TVs does Neolume run on?](#which-tvs-does-neolume-run-on)
- [I have a newer TV – is there a Neolume for it?](#i-have-a-newer-tv--is-there-a-neolume-for-it)
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

### I have a newer TV – is there a Neolume for it?
Not a ready-made one. Neolume runs only on the Orsay platform described above. Most newer TVs (Samsung Tizen, LG webOS,
Android TV / Google TV, Fire TV, Apple TV) have the **official Plex app** in their app store – try that first.
If you would like Neolume's look and features on such a TV anyway, an **AI coding agent** can build the app for it: Neolume
comes with a product specification, a step-by-step playbook for the agent and an acceptance test plan. Start with the
prompt in the [porting playbook](PORTING-WITH-AI.md) or read [how it works](https://itsab1989.github.io/neolume/port.html).
Apps that others already built are listed as [community ports](../PORTS.md).

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
Exception: if you want the **watchlist**, the **Discover** rows from plex.tv and the details of titles that are not on
your server, the optional helper must run somewhere on
your home network (a computer or a NAS) – it can be installed to start by itself with the computer, see
[INSTALL, section 13](INSTALL.md#13-optional-the-helper-for-watchlist-and-discover).

### What is the helper, and do I need it?
Only if you want your **Plex watchlist**, the Discover rows **Trending now**, **Just released** and **Coming soon**, and
the **details of titles that are not on your server** (story, genres, runtime, cast) when you open one in Discover. Those
live on plex.tv, which the 2014 TV cannot reach (its encryption is too old). The helper is a small program on a computer or
NAS in your home network that fetches exactly these lists and details for the TV – no videos, nothing else. Everything else works
without it. You tick it in the setup program and can install it to start with your computer, with an icon in the menu bar
or next to the clock; it can be removed completely with one click. Step by step:
[INSTALL, section 13](INSTALL.md#13-optional-the-helper-for-watchlist-and-discover).

### Does Neolume need the internet?
Not for watching – only your Plex Media Server on the home network (the server itself uses the internet for posters and
metadata). The setup needs the internet once (plex.tv sign-in). Exception: the watchlist, the plex.tv rows in Discover and
the details of titles that are not on your server come from plex.tv through the optional helper on your home network (see
[INSTALL, section 13](INSTALL.md#13-optional-the-helper-for-watchlist-and-discover)).

### Does it work away from home (remote access)?
No, by design. Neolume uses your own server only through its home-network address, so your access never travels over the
internet unencrypted.

### Can I use a server that a friend shared with me?
Yes, optionally. In the setup program's **Summary**, click **Search shared servers** and tick the servers you want. Their
libraries then appear in the sidebar ("from <server>"); Search and Home stay with your own server. Two limits come from
the 2014 TV, which cannot encrypt: the friend's server must allow insecure connections (Plex: **Settings → Network → Secure
connections: Preferred**), and the connection to it goes over the internet **without encryption**. See
[INSTALL, section 14](INSTALL.md#14-optional-other-servers-shared-with-you).

### Profiles, kids profiles and PINs
- All **Plex Home** profiles chosen during setup are available. Each sees only its own libraries and keeps its own watched status.
- **Kids profiles** (Plex "little kid", "older kid", "teen") get reduced settings; you can require a PIN to leave a kids profile.
- Without plex.tv the TV cannot check your **Plex PIN**. Instead, each profile can have its own **app PIN** in Neolume.
  Only a salted hash is stored. Forgot it? The main profile can reset other PINs under **Settings → Profile & account**;
  for the main profile's own PIN, run the setup again with **Reset app PINs** ticked.

### Can I change the colours?
Yes. **Settings → Display → Accent colour** offers seven colours for the focus, buttons and progress bars: Teal
(the default), Amber, Coral, Rose, Lavender, Sky blue and Mint. The choice is saved per profile and takes effect at once.
Every colour is checked for good contrast: labels on it and the colour itself on the dark background reach at least 4.5:1.

### How do I skip forward and back, and change the skip length?
In a video, **left/right** and the on-screen **-10/+10** buttons jump by *Skip length (arrows & buttons)*; the
**fast-forward/rewind keys** jump by *Skip length (FF/rewind)* (both under **Settings → Playback**). The buttons always show
the real value, e.g. **-10 / +30** if you pick the option that jumps back less than forward. Pressing several times adds up,
holding an arrow key speeds up, and the video jumps **once** when you stop pressing – so the TV only has to reload once.
With the Smart Control, point at the progress bar to see the time (and a preview picture, if your server makes them)
before you click; after a click you can still fine-tune by swiping left/right on the touchpad before the jump happens.
**⏮ / ⏭** (and CH up/down) switch to the previous/next episode, to the previous/next chapter of a movie with chapters,
or to the previous/next video after *Play all*; they only appear when there is something to switch to. In music the
buttons use the same skip length as the arrows; audiobooks use the bigger *FF/rewind* length (30 seconds by default).

### What is "Fine scrubbing on the progress bar"?
An optional help for long movies, episodes and audiobooks when a click on the progress bar lands too far off (on a two-hour
movie, one step of the pointer is several seconds, and the pointer always wobbles a little). Turn it on under
**Settings → Playback → Fine scrubbing on the progress bar** (it needs *Pointer control*). Then point at the progress bar and
hold the pointer still for just under a second, with your finger resting on the touchpad: fine scrubbing opens for the minutes
around that spot, and the pointer now moves the time several times more finely – the target time is shown at the small
marker, and chapter starts snap into place. Click to jump there (you can still swipe to fine-tune), or move the pointer up
and away (or press RETURN) to leave. While it is open, the buttons below the bar do not react at all: if your thumb slips
down onto them, a click there still just sets the fine target – so you can't pause or open a menu by accident. It doesn't appear for short items such as music
tracks or short episodes, because the normal bar is already precise enough there. It is off by default.

You choose how it looks under **Settings → Playback → Fine scrubbing style**. All three styles work the same way and are
equally precise:
- **Panel above the bar** (default): a panel with a stretched bar grows out of the top edge of the controls (hint at the top, times below the bar). While
  it is open, subtitles move up, and whatever it would cover (such as the *Next episode* card) steps aside briefly.
- **Stretching bar**: no extra panel – the bar itself widens around the spot and the rest squeezes aside; ticks above the
  bar mark the stretched part.
- **Filmstrip**: like the panel, but with seven preview images across the whole width; the image under the pointer is
  framed and shows the target spot. It needs preview images that your server made for the video, plus the setting
  *Preview images when skipping*; without them you automatically get the panel.

In *Now playing* (music, audiobooks) the bar always stretches, because the title and chapter sit above the bar and the
buttons right below it – there is no room for an extra panel there.

Earlier test versions also had a *Fine bar* style directly **under** the progress bar. It was removed: under the bar the
times and buttons are so close together that the pointer could easily hit a button while fine-tuning. If you had picked it,
you now automatically get *Panel above the bar*.

### How do I set up the screensaver?
It has its own category: **Settings → Screensaver** (main and other adult profiles). *Screensaver after* (Off, 1, 2, 5,
10, 15 or 30 minutes; default 5) starts it when no key has been pressed; it never starts while a video plays. While it is
Off, the other screensaver settings are dimmed. They are listed here in the same order as on the TV:

| Setting | Choices (default first) | What it does |
|---|---|---|
| Screensaver overlay | Ambient · Classic · Movie poster · Lower third · Big clock · Small clock only · Off (pictures only) | How the time and title appear. Press INFO on the setting for a description of each. The position changes with every picture against burn-in. |
| Picture transition | Crossfade · Cut · Fade through black · Slow zoom · Slow drift · Zoom through · Curtain · Blinds · Tiles · Random | How the next picture appears. With *Reduced motion*, moving ones become a crossfade. |
| Change picture every | 30 · 10 · 20 · 60 seconds | How long each picture stays. |
| Screensaver pictures | Real backgrounds only · Also video stills · Posters and covers | Which kind of picture is shown. Some titles have no background picture of their own, so Plex uses a random frame from the video – often dark or blurred; *Real backgrounds only* skips those. INFO explains each choice. |
| Blur screensaver images | On · Off | Soft and calm, or sharp. |
| Screensaver pictures from | Libraries · Home screen | Libraries: random titles with background art from whole libraries, no repeats until all were shown. Home screen: only titles from there (no extra requests). |
| Screensaver libraries | Movies & TV shows · your pick | Which libraries are used (only with *Libraries* above). Music libraries show artist pictures. |
| Unwatched titles only | Off · On | Only movies and shows you haven't finished yet (only with *Libraries* above). |
| Clock only after a long time | 2 hrs · 1 hr · 4 hrs · Never | After this long, the last picture fades out and only the clock keeps moving on a black screen. Older TVs can run out of memory after many hours of constantly changing pictures and freeze; black also protects the screen from burn-in and saves power. Any key ends the screensaver as usual. |

*Show clock* applies to the screensaver too: when it is off, no overlay style shows the time. Kids profiles use the
defaults and only see pictures their own Plex account may see.

### Where does RETURN take me?
`RETURN` always goes back one step. In a section you opened from the sidebar – a library (music and audiobooks too),
Search, Discover or Settings – it first takes you to the top (the first row, the keyboard, the categories). Press it once
more and the setting **Settings → Display → Back from a section** decides: **To Home** (default) goes straight to the
Home screen; **To the previous section** works like Back in a web browser and steps back through the sections you opened,
each one only once, ending on Home. On Home, `RETURN` takes you to the first card, and from there it asks whether you want
to exit. The sidebar opens with ◀. Each profile has its own choice.

### What is the small notice about new content?
When new movies, episodes, music or audiobooks arrive on your server, a small notice fades in for a few seconds and fades
out by itself – on Home at the right under the clock, in libraries and on *Now playing* at the top right. It never needs a
button and waits while you press buttons or a menu is open. You set it under **Settings → Display**:
**New content notice** (**Exact** = default, what is new, for example "New episode" with show, season and episode;
**General** = just "New content on your server"; or **Off**), **How long the notice stays** (3, 5, 8 or 12 seconds;
default 5) and **Also while a video plays** (off by default; when on, it appears small at the top left of the video, only
while no controls are on screen). Your profile only hears about what it is allowed to see. Home and the libraries also
update the affected rows by themselves, without moving the card you have highlighted.

### What is the colourful background in my libraries? Can I turn it off?
That is the **library background** (**Settings → Display → Library background**). *Colour mood* (the default) tints the
background with soft colours of the selected title – the colours your Plex server already provides, so it costs no extra
download. *Title picture* shows that title's picture, blurred and darkened by your server; *Random picture* picks one
picture from the library each time you open it. *Off* keeps the plain dark background. **Background strength** chooses
between *Subtle* (default, darkest, text easiest to read) and *Stronger*. The background only changes after you stop on a
title for a moment, never while you scroll – so moving through the grid stays smooth. With **Background images** turned
off, *Title picture* and *Random picture* show the colour mood instead; with **Reduce motion** on, it switches without
fading.

### Why does Discover only suggest titles I don't have? Can I see everything?
With the optional [helper](INSTALL.md#13-optional-the-helper-for-watchlist-and-discover), Discover adds rows from plex.tv:
**Trending now**, **Just released** and **Coming soon** (movies and shows each). By default these rows only show titles
that are **not** on your server – Discover is meant as pure inspiration, and everything you already have is in the other
Discover rows and in your libraries anyway. To keep the rows full, Neolume asks the helper for more titles than it shows
(up to 30 per row) and checks all of them against your server in one request. If you already have everything from a list,
the row shows a short note instead of staying empty.

To see all titles again, turn off **Settings → Display → Only titles you don't have yet**. The rows then show everything,
and titles on your server are marked *On your server* and can be played right away. If you use
[servers shared with you](#can-i-use-a-server-that-a-friend-shared-with-me), a second setting, **Also check other
servers** (on by default), hides their titles too; a shared server that doesn't answer within a few seconds is skipped,
so its titles stay visible. Matching uses the Plex ID of each title, so titles in libraries that still use an old Plex
agent may not be recognised as yours.

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
- Exception, only if you tick it in the setup: **servers that someone shared with you** are reached over the internet,
  also without encryption.
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
