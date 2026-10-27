# Changelog

All notable changes to Neolume are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/itsab1989/neolume/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/itsab1989/neolume/releases/tag/v1.0.0
