# Changelog

All notable changes to Neolume are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [1.0.4] - 2026-10-27

### Added
- **Optional "Other servers"**: libraries of Plex servers that someone shared with you (for example a friend) can appear in
  the side menu next to your own, marked "from <server>", and can be hidden or reordered like any library. The setup
  program finds them with **Search shared servers** (only your own access; each profile only gets the servers shared with
  it), checks them over plain HTTP and explains when a server cannot work with the 2014 TV ("secure connections only").
  Libraries, details, playback, progress and "watched" go to that server; your own server works exactly as before.
  If such a server is offline, only its libraries show a message. With the optional helper, a changed internet address is
  found automatically. Note: the TV cannot encrypt, so these connections go over the internet without encryption.

### Fixed
- **Artist pages show every release**: compilations, live albums, singles & EPs, soundtracks, demos and remixes were missing
  (an artist with only a best-of showed no albums at all). They now appear in their own rows below "Albums", grouped like
  in the official Plex apps; the album count includes them.

If Neolume now finds every Oasis album for you, you're welcome to buy me a coffee on [Ko-fi](https://ko-fi.com/itsab1989) – entirely optional. ☕

## [1.0.3] - 2026-10-27

### Added
- **Screensaver, much more varied** (Settings → Interface):
  - *Screensaver pictures from*: **Libraries** (new default) shows random titles with background art from whole libraries,
    with no repeats until every title has been shown; or **Home screen** as before. *Screensaver libraries* lets you pick
    them (movies and TV shows by default; music shows artist pictures), *Unwatched titles only* is optional. The app asks
    your server for 30 titles at a time – roughly one small request every 15 minutes – and keeps nothing on disk.
    Kids profiles only ever see what their own Plex account is allowed to see.
  - *Picture transition*: Cut, Crossfade (default), Fade through black, Slow zoom, Slow drift, Zoom through, Curtain,
    Blinds, Tiles or Random. Every picture is fully loaded before the transition starts, and only GPU-friendly effects are
    used. With *Reduced motion* on, moving transitions become a crossfade.
  - *Screensaver overlay*: Ambient (new default: large clock, title and a "Movie · 2019" line on a soft shadow), Classic
    (the old box), Movie poster, Lower third, Big clock, Small clock only, or Off. The position changes with every picture
    to protect the screen from burn-in.
  - *Change picture every* 10, 20, 30 or 60 seconds, and *Screensaver after* now also offers 1 and 2 minutes.

### Changed
- **Pointer scrolling feels natural on the TV:** scrolling at the edge keeps going while you hold the remote still and
  stops about a second after you lift your finger (the TV gives no signal when the finger is lifted). Putting your finger
  back – the dot reappears in the middle of the screen – stops scrolling at once and selects nothing by accident.

If you enjoy watching your library drift by, you're welcome to buy me a coffee on [Ko-fi](https://ko-fi.com/itsab1989) – entirely optional. ☕

## [1.0.2] - 2026-10-27

### Added
- **New setting "Accent colour"** (Settings → Interface): pick the colour of the focus, buttons and progress bars from
  seven colours – Teal (default), Amber, Coral, Rose, Lavender, Sky blue and Mint – per profile, with a colour swatch in
  the list. It takes effect at once and is applied before the first screen at start, so there is no flash of the old colour.
  Every colour keeps labels on it readable (contrast at least 4.5:1). Switching costs the TV a single style update: all
  colour variants are prepared when the app is built.
- **New setting "Speed up pointer scrolling"** (Settings → Interface, under "Pointer control"): when you rest the Smart
  Control pointer at the top or bottom edge of a list, scrolling starts slowly and gets faster; turn it off for a steady pace.

### Changed
- **Titles without a background picture** (for example a movie added minutes ago) now show their poster, softly blurred by
  your server, behind the home screen, detail pages and "Now Playing" instead of a plain colour.
- **Screensaver pictures are recognisable again:** the soft mode blurs much less and loads the picture in full TV
  resolution with higher quality, so smooth colour gradients no longer show blocks. Only titles with a real background
  picture are shown.
- **Music and audiobooks:**
  - "Now Playing" and artist pages stay readable on very bright artwork.
  - Albums and audiobooks without a cover show a coloured title card instead of a grey square, in grids, home rows,
    "Now Playing" and the mini player.
  - Long library names in the side menu wrap onto two lines in the normal font size instead of shrinking.
  - The mini player no longer covers the A–Z bar or the last entry of a track or chapter list.
- **The clock follows your Plex server:** if the TV's own clock is wrong (common on TVs that only use HDMI), the clock on
  the home screen, the screensaver and every "ends at" time now show the correct time.
- **Shared (friend) accounts are no longer added as profiles;** the setup program only uses your own account and your
  Plex Home users, and never requests or stores access for other accounts. On a TV that was set up earlier, such
  profiles no longer appear in the profile picker.
- **Player controls redesigned:** nothing overlaps any more. The time line is on top, the times below it, and the buttons
  in one row; Play/Pause is now a slightly larger rounded button like −10/+10, its label sits under the focused button, and
  the colour-key hints have their own small bar at the bottom right.
- **Pointer (Smart Control touchpad) in libraries:** pointing at a row no longer makes the list run away. Rows that are
  mostly visible can be picked directly; rest the pointer in the slim band above the colour keys (or under the buttons at
  the top) to scroll. The focus ring never covers the hint bar. "Pointer control: off" now really ignores the pointer
  everywhere, and its explanation says so.

### Fixed
- The mini player showed the play symbol while music was playing (and pause while paused).
- Albums with an empty title on the server appeared as blank cards; they now read "Untitled".
- Resuming an audiobook after a long break rewound by the wrong amount when the TV clock was off.

If you enjoy picking your favourite colour, you're welcome to buy me a coffee on [Ko-fi](https://ko-fi.com/itsab1989) – entirely optional. ☕

## [1.0.1] - 2026-10-27

### Changed
- **Smoother scrolling on the TV:** library grids and the home screen now stay at about 60 frames per second while you hold an
  arrow key (measured on a UE48H8000: small grid from 47 to 60 fps, home from 55 to 62 fps). Cards and images are filled in
  small steps between frames, and captions repaint on their own.
- **Faster start:** the setup file is read while the app is still loading (about 0.6 s saved on a cold start).
- **New setting "Customize side menu":** reorder or hide Search, Discover and each library, per profile.
- Detail pages are easier to read on bright artwork; descriptions end with "…"; long library names fit the side menu.

### Fixed
- The focus ring disappeared after choosing "Home" in the side menu while already on Home.
- A shared (friend) account in the setup made the whole setup file invalid on the TV.
- "Up Next" no longer repeats movies that are already in Continue Watching.
- A clear message when a music file on the server can't be reached, instead of skipping through the queue.
- "Lower quality?" no longer appears after the short buffering caused by skipping forward.

If Neolume makes your evenings on the sofa a bit nicer, you're welcome to buy me a coffee on [Ko-fi](https://ko-fi.com/itsab1989) – entirely optional. ☕

## [1.0.0] - 2026-10-27

**The first public release.** Neolume brings a fast, modern client for your Plex Media Server to Samsung Smart TVs from 2014
(Orsay Smart Hub). A setup program for Windows, macOS and Linux signs in to Plex once and installs the app on the TV; after
that the TV talks only to your own server at home.

### Added
- **Setup program** for Windows (x64, ARM64), macOS (Apple chip, Intel), Linux (x64, ARM64), a Python `.pyz` for any system and a
  Docker image for the optional helper: Plex sign-in in the browser, server and profile choice, app package, installation via
  the TV's User App Sync with live progress.
- **Home** with Continue Watching, Up Next, Recently Added per library, background art that follows the focus and a season
  strip; rows can be turned on/off and reordered per profile.
- **Libraries** with grid, sort, filters, A–Z jump bar and view sizes, remembered per library and profile.
- **Detail pages** for movies, shows, seasons and episodes with cast, extras, similar titles and version choice; **search**.
- **Player** with Direct Play and automatic conversion by the server (HEVC, 10-bit, 4K), audio and subtitle choice remembered
  per show, skip intro/credits, next-episode countdown, chapters, sleep timer, "Still watching?" and seek thumbnails.
- **Music and audiobooks.**
- **Profiles:** Plex Home profiles with avatars, kids profiles with reduced settings, optional app PIN per profile (salted hash).
- **Discover and watchlist** through an optional helper on the home network.
- Remote control and Smart Control pointer; German and English interface.
- No ads, no tracking, no telemetry.

If Neolume gives your TV a second life and you'd like to say thanks, a coffee on [Ko-fi](https://ko-fi.com/itsab1989) is always appreciated – entirely optional. ☕

[Unreleased]: https://github.com/itsab1989/neolume/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/itsab1989/neolume/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/itsab1989/neolume/releases/tag/v1.0.0
