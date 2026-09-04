# YouTube Shorts catalog

FocusReels uses a shared editorial catalog, not YouTube recommendations. The app
requires no YouTube login or API key: the key is used only by the maintainer sync
job to generate a public JSON catalog.

The fallback fixture is `config/youtube-catalog.fixture.json`; insert manually verified
Shorts IDs there (or generate `config/youtube-catalog.json` with the maintainer script).
The player embeds IDs through the official YouTube IFrame API. Branding, ads and other
YouTube-controlled UI may still appear and must not be masked.

Maintainers set `YOUTUBE_API_KEY` and run the catalog scripts documented in
[docs/youtube-catalog-automation.md](youtube-catalog-automation.md). The
scheduled GitHub Actions workflow publishes the finished catalog to GitHub Pages
when its repository variable is enabled. The desktop app reads the bundled,
cached, or published catalog; it does not use `YOUTUBE_PLAYLIST_ID` or run a
per-user sync. Local feedback (likes, hides, skips and completion) is stored
locally and only changes FocusReels ordering.
