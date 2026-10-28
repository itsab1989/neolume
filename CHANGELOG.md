# Changelog

All notable changes to Neolume are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.5] - 2026-10-28

### Added
- **Choose which pictures the screensaver shows.** When a movie or show has no designed background picture, Plex takes a
  single frame from the video instead – a *video still*. It shows a random moment, often dark, blurred or with black bars,
  and rarely looks nice on a big screen. The screensaver now skips these by default (**Real backgrounds only**). The new
  setting **Settings → Display → Screensaver pictures** also offers **Also video stills** (the previous behaviour) and
  **Posters and covers**: the movie poster or music cover shown sharp on a soft, dark version of itself, placed so the clock
  and title never cover it – with every transition and overlay style. If a library has almost nothing but stills, the
  screensaver shows the poster instead, so it never stays black. Tip: in Plex Web, the edit dialog of a movie (pencil icon) lets
  you pick one of the real background pictures Plex has found for it.
- **Discover: details of titles that are not on your server.** Opening such a title now shows what it is about (two lines,
  INFO for the whole text), runtime or number of seasons, whether a show is still running, age rating, rating, genres, the
  director or network and a cast row with photos – the same layout as your own titles, just without Play. The data comes
  from the Plex catalogue through the optional helper (one request per title, kept in memory). If neither the helper nor
  your server has a description, the page shows a short note in its place – for example what the helper would add, or that
  it isn't answering right now. **Update the helper** to get this.
- **Previous/next buttons in the video player.** ⏮ and ⏭ now sit symmetrically around the skip buttons and switch to the
  previous/next **episode**, the previous/next **chapter** of a movie with chapters (⏮ first goes back to the start of the
  current chapter, like a DVD player; every jump lands exactly on the chapter start), or the previous/next video after
  *Play all*. They only appear when there is something to switch to and are dimmed at the first/last one. **CH up/down**
  do the same. Skipping to the next episode by hand no longer marks the current one as watched; your position is kept.
- **Pointer preview on the progress bar.** With the Smart Control, pointing at the bar shows the time there (and the preview
  picture, if available); a click sets the target like the skip keys, and the video jumps once after a moment – swipe
  left/right on the touchpad in between to fine-tune. In *Now playing*, pointing at the bar also shows the time under the
  pointer.
- **Fine scrubbing on the progress bar (optional, off by default).** For long movies, episodes and audiobooks: hold the
  pointer still on the progress bar for just under a second and the pointer moves the time several times more finely
  around that spot – so you land much closer to the spot you want instead of up to a minute off. Click to jump, move up and
  away or press RETURN to leave; chapter starts snap into place. While it is open, the buttons below the bar don't react,
  so a slipping thumb can't pause the video or open a menu by accident. Turn it on under **Settings → Playback → Fine
  scrubbing on the progress bar** (needs **Pointer control**). **Fine scrubbing style** offers three looks that work the
  same way and are equally precise: *Panel above the bar* (default; grows out of the top edge of the controls, subtitles
  move up and only what it would cover steps aside), *Stretching bar* (the bar itself widens around the spot, with a short
  animation that shows the stretch) and *Filmstrip* (seven preview images across the width – the one under the pointer
  shows the target; without preview images from your server you get the panel). Two soft lines lead from the spot on the
  bar to the enlarged part, so you can see at once what is magnified. Nothing overlaps: the panel and filmstrip attach to
  the controls instead of sitting on top of them. *Now playing* always uses the stretching bar, because text sits above
  its bar and the buttons right below.
- **Skip lengths you can read.** The -/+ buttons always show the real skip length, in videos *and* music. New options
  **-10 / +30 sec** (in **Skip length (arrows & buttons)**) and **-15 / +30 sec** (in **Skip length (FF/rewind)**) jump
  back less than forward. The setting formerly called *Skip length (arrow keys)* is now **Skip length (arrows & buttons)**,
  because the on-screen buttons have always used it.
- **Discover suggests only titles you don't have yet.** The plex.tv rows in Discover (*Trending now*, *Just released*,
  *Coming soon* – they need the optional helper) now hide movies and shows that are already on your server, so Discover is
  pure inspiration; what you already own stays in the other Discover rows and your libraries. To keep the rows full,
  Neolume asks the helper for up to 30 titles per row (instead of 20) and checks them against your server in one request.
  If you already have everything from a list, the row shows a friendly note instead of disappearing. New setting
  **Settings → Display → Only titles you don't have yet** (on by default) – turn it off to see all titles again, with the
  ones you own marked *On your server*. With servers shared with you, **Also check other servers** (on by default) hides
  their titles too; a shared server that doesn't answer within a few seconds is skipped, so its titles stay visible.
- **New setting "Library background"** (Settings → Display): libraries no longer have to be plain grey. *Colour mood*
  (the new default) tints the background with soft colours of the selected title, taken from the colours your Plex server
  already sends with each library page (no extra download). *Title picture* shows the selected title's picture, blurred and
  darkened by the server (a small 320×180 image of about 2–5 KB); *Random picture* picks one picture from the library each
  time you open it. *Off* keeps the plain background. A second setting, **Background strength**, offers *Subtle* (default)
  and *Stronger*. The background only changes after you rest on a title for about half a second – never while you hold an
  arrow key – and cross-fades gently (instantly with *Reduce motion*). The colour mood is worked out in quiet moments from a
  tiny 16 × 9 picture (it looks the same, because the TV smooths it out), so a change costs the 2014 TVs very little and
  doesn't make them stutter. Text, lists, the A–Z bar and the focus stay readable even on very bright or very colourful
  titles. If *Background images* is off, *Title picture* and *Random picture* show the colour mood instead.
- **Choose how the home screen clock looks.** New setting **Settings → Display → Home screen clock**: *In a box* (default:
  the time in a semi-transparent dark box, readable on any picture), *Large and free* (larger, fine digits on a soft shadow
  in the corner), *With date* (like *Large and free*, with the weekday and date below) and *Small and subtle* (small digits
  that distract the least). Videos and the screensaver keep their own clock. INFO on the setting explains each style.
- **Button hints: always, briefly or off.** New setting **Settings → Display → Button hints** for the bar at the bottom
  right that shows what the colour buttons, INFO and TOOLS do: *Always* (default), *Briefly* (it appears when a screen or
  menu opens and after you press one of these buttons, then fades out after about 4 seconds) or *Off* (also hides the small
  bar in a paused video). The buttons work the same either way. So that nothing can only be found through the bar,
  **Settings → Help & info → Remote control keys** now has its own page for **Music & audiobooks** and also lists the
  yellow button in Settings.
- **Install the optional helper permanently – and remove it again with one click.** In the setup program, the helper card
  has a new button **Install helper permanently**: it copies the program to a fixed place and starts the helper
  automatically whenever you log in (Mac: LaunchAgent, Windows: per-user autostart, Linux: systemd user service), without
  administrator rights. The installed helper picks up a new setup by itself and, when its port is busy, waits and tries
  again instead of giving up. On Windows it starts at login without any window or taskbar button: installing also places
  `neolume-helper.exe` next to the program copy – the same program, marked for Windows as a windowed program – while
  `neolume-setup.exe` stays the normal program for the Command Prompt (Windows asks the firewall question once for the new
  file). The `.pyz` likewise starts without a console window (it uses `pythonw.exe`), and its program copy keeps the `.pyz`
  name. If you install over SSH while nobody is logged in at the screen, the helper runs without an icon for now, and the
  autostart at your next login replaces it with one that shows the icon.
- **An icon for the helper.** On Mac and Windows a small icon in the menu bar / notification area shows whether the helper
  is running, whether plex.tv is reachable and when the TV last asked, with **Pause**, **Open setup program …**, **What
  does the helper do?**, **Quit helper** and **Remove helper …**; it can be hidden. **Remove helper …** (also
  `--uninstall-helper`) stops it and deletes the autostart entry, the program copy, its log and settings, the access file
  and the folders that are then empty (on Windows right after the helper has quit), removes the helper's own plex.tv
  device entry if there is one, and lists what was removed and what is left. Until you create the app package again
  without the helper, the TV briefly shows "Neolume helper not reachable" when it looks for the watchlist and Discover rows.
- **Helper commands for computers without a screen**, such as an always-on Mac over SSH: `--install-helper`,
  `--helper-status`, `--uninstall-helper`, and on a Mac `sudo … --install-helper --at-boot` to run without a login. They
  answer in German on a German computer – also over SSH (on a Mac the system language is read from your settings).
  `--helper-status` also shows the helper's name in the system and whether its icon is visible. On Windows, characters the
  console cannot show are replaced by plain ones ("->", '"'), and anything that ends a background start is written to
  `helper.log`. The setup page and the guide
  ([INSTALL, section 13](docs/INSTALL.md#13-optional-the-helper-for-watchlist-and-discover)) explain in plain words what
  the helper fetches (only the watchlist, the Discover rows and the details of titles that are not on your server), why
  the TV needs it and what it never does.
- **The installed helper has its own name and icon in the system** – "Neolume Helper" (German: "Neolume Helfer"),
  taken from the app's name, so you can recognise it at a glance. On a Mac it is started through a tiny app
  (`Neolume Helper.app` next to the program copy), so the "Background Items Added" notice and **System Settings → General →
  Login Items & Extensions** show that name and a TV icon instead of "python3" or a bare file name. On Windows the autostart
  is a shortcut "Neolume Helper" in the Startup folder; Task Manager → **Startup apps**, Settings → Apps → Startup, the
  process list and the firewall question show the description of the Windows program, **"Neolume Setup & Helper"** with
  the publisher "Neolume", and the helper's TV icon instead of the generic program icon (for the `.pyz` they show
  "Python"). Older autostart entries are replaced automatically.
- **A small hint that Home goes on below.** Under the cards, the heading of the next row now ends with a quiet arrow
  pointing down – the same arrow you know from the season tabs. It moves along as you go down and disappears on the last
  row, so you can see at a glance whether there is more to discover. Clicking it with the pointer moves one row down.
- **Season tabs show when more seasons follow.** With many seasons, a tab that would be cut off is hidden, and a ‹ or ›
  arrow at the edge shows that there are more; clicking it selects the next hidden season. The arrows light up like a tab
  when you point at them and are large enough to hit easily.
- **Season boxes and series bar can be switched separately.** On a show's page, the line of small boxes (one per episode of
  the selected season) and the bar below it (the whole series, one section per season) each have their own setting:
  *Show episode progress* and the new **Show series progress** (Settings → Display). If you had switched episode progress
  off before, the series bar stays off too until you change it.

### Changed
- **Softer shadow behind the screensaver clock and text.** On bright pictures the dark area behind the clock used to show as
  a dark "egg" or blob with a visible edge. It is now a soft shadow that follows the text and fades out gently, only as dark
  as needed to keep the clock and title easy to read. *Small clock only* got its own small, matching shadow.
- **One look for all players.** Music and audiobooks now use the same button family as videos: the same square-rounded
  Play button, -/+ buttons with a sign (music used to show "10" twice), the same focus label below the button and larger
  pointer targets. Repeated skips in music and audiobooks are collected and jump once, like in videos. The rewind/fast-forward
  keys in music now use **Skip length (FF/rewind)**, like in videos; audiobook buttons use it too (30 seconds by default).
- **Smoother ▼ and ▶ on the home screen.** While you rest on a row, the app now quietly prepares the pictures of the rows
  below and of the next cards to the right, one per frame, so the next step doesn't have to unpack them first. Moving the
  pointer now counts as activity like a key: background work and saving wait until the pointer rests, so fine scrubbing and
  pointing stay fluid (the big home picture also changes only once the pointer rests).
- **The series bar no longer looks like a scrollbar.** On a show's page the long bar under the season boxes now has a label
  ("Series: 30 of 42 unwatched"), is thinner and calmer, and shows each season as its own small section – the selected
  season a little brighter. With only one season it is left out, because it would just repeat the boxes.
- Plainer wording: "not an open proxy" is now "does not pass on requests for anyone else".

### Fixed
- **The mark under the season boxes follows you.** It points to the episode you are on – or, up at the buttons, the next
  one to watch.
- **Home: the highlight is back after a trip through the sidebar.** Going from Home to another screen through the sidebar
  and back to Home (or back with Return) left Home without its highlight frame until you pressed a key that moved it.
- **Continue watching keeps the video you just stopped.** Right after you stopped a video, your Plex server sometimes still
  left it out of *Continue watching*, so it vanished from Home until you opened Home again. Home now gives the server a
  moment, and if the video is still missing it keeps the row as it was and asks again a little later – the video stays and
  moves to the front with its new progress.
- **Discover: "Your watchlist" updates right away.** When you add or remove a title on its details page and go back, the
  watchlist row now changes at once – before, it only changed after you closed and reopened Discover.
- **Discover: smoother ▼ and ▲ between rows.** Moving to another row caused a noticeable hitch on 2014 TVs: the row coming
  into view was built all at once, and the highlight frame made the TV re-measure the whole screen when it reappeared (for
  example when you moved from your recent searches down into a Discover row). Neolume now reuses the existing row and
  fills it one card at a time, and the highlight frame reappears without that extra work.
- **Screensaver "Tiles" and "Blinds" run smoothly.** *Tiles* now uses six large tiles (3 × 2) instead of twelve, which
  halves the work for the TV, and both transitions prepare their parts once when the screensaver starts instead of
  rebuilding them at every picture change – the stutter right at the start of a transition is gone.
- **The screensaver no longer gets stuck on one picture** when your server takes a while to send the next ones, and the
  click that ends the screensaver no longer opens or plays the title that happens to be under the pointer.
- **Artist pages: "Try again" works properly.** After an error, a trip to the sidebar no longer loses the error message,
  and **Try again** brings the page header and buttons back.
- **Other servers: switching profiles while Neolume is still checking them** no longer leaves their libraries waiting
  forever.

If ⏭ saves you a fumble for the next episode, you're welcome to buy me a coffee on [Ko-fi](https://ko-fi.com/itsab1989) – entirely optional. ☕

## [1.0.4] - 2026-10-27

### Added
- **Optional "Other servers"**: libraries of Plex servers that someone shared with you (for example a friend) can appear in
  the sidebar next to your own, marked "from <server>", and can be hidden or reordered like any library
  (**Settings → Display → Customize sidebar**). The setup program finds them with **Search shared servers** in its
  **Summary** (only your own access; each profile only gets the servers shared with it), checks each one from your
  computer without encryption (plain HTTP, the way the TV connects) and explains when a server cannot work with the 2014
  TV ("secure connections only"). Libraries, details, playback, progress and "watched" go to that server; your own server
  works exactly as before. If such a server is offline, only its libraries show a message. With the optional helper, a
  changed internet address is found automatically. **Settings → Profile & account → Other servers** shows how many of them are
  reachable. Note: the TV cannot encrypt, so these connections go over the internet without encryption – only tick a
  server if you are fine with that.

### Fixed
- **Artist pages show every release**: compilations, live albums, singles & EPs, soundtracks, demos and remixes were missing
  (an artist with only a best-of showed no albums at all). They now appear in their own rows below "Albums", grouped like
  in the official Plex apps; the album count includes them.

If Neolume now finds every album of your favourite band for you, you're welcome to buy me a coffee on [Ko-fi](https://ko-fi.com/itsab1989) – entirely optional. ☕

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

[Unreleased]: https://github.com/itsab1989/neolume/compare/v1.0.5...HEAD
[1.0.5]: https://github.com/itsab1989/neolume/compare/v1.0.4...v1.0.5
[1.0.1]: https://github.com/itsab1989/neolume/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/itsab1989/neolume/releases/tag/v1.0.0
