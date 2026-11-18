# Luma Media Center

Luma is an **original cinematic personal media-center web app**, hosted free on GitHub Pages.

## Open on your iPhone
Visit https://cj42izzle.github.io/Luma-Media-Center/ in Safari. Tap Share → Add to Home Screen. The website version also works on Android browsers and desktops. It is **not a native Apple TV app**.

## What's implemented
- Cinematic home layout, original logo, responsive browsing and search
- Built-in normalized metadata library using TVmaze / Apple listings without a key, with optional TMDB discovery
- Release Radar: new and upcoming titles, reported theatrical releases, on-air TV, trending titles, regional subscription-provider discovery with TMDB configured
- Watchlist, watched flags, continue watching, personal HTTP video URLs, and local backup
- Install unlimited Luma add-ons individually; batch-install up to 25 URLs at a time
- Disable/remove/test add-ons, browse compatible add-on catalogs and request stream lists by media ID
- Offer stream handoff to Infuse and VidHub via their published x-callback URL schemes, plus in-browser playback for supported files
- GitHub Actions JavaScript syntax and asset checks

## Watchlist sources and account connections (Build 26)
Luma has separate **On Device**, **Trakt**, and **Simkl** watchlist views under **Watchlist**. Switching the selected source never overwrites the other lists. The On Device list stores title snapshots in local browser storage, and **Settings → Export backup** produces a JSON backup you can save to **Files → iCloud Drive** (and restore from any device manually).

Open **Settings → Connect your watchlists → Connect Trakt** or **Connect Simkl** to use the provider's official consent page. Trakt also offers **Use activation code** as an optional alternative. Simkl's device/PIN method is available only after a **separate device-type public client ID** is registered and configured; Simkl AUTH V2 uses different client registrations for browser versus device clients. The ordinary browser sign-in needs only the browser-type client ID.

**Required one-time setup:** The site owner must register a public client ID for each provider and configure it in `PUBLIC_APP_IDS` in `accounts.js`, or enter a public ID into advanced settings in their own browser. This is a public application identifier, not a password or client secret. Trakt requires registration and correct callback/origin configuration; Simkl requires its applicable public browser application configuration. API access may be blocked by provider permissions, rate limits or browser CORS even when the UI checks pass. Never embed a client secret.

**Watchlists:** On Device, Trakt and Simkl retain separate data. Watchlist includes search, source/type/status filters, 24-title pages, and optional **Browse all libraries together**. Combined browsing is read-only: no lists are merged or synchronized, and unconnected services cannot be accessed. Simkl's read-only scope is requested where supported. Completed and dropped titles remain viewable in their own Simkl library but are excluded from followed-show calendar entries.

The browser version intentionally **does not automatically push local watch history, ratings, or watchlists into Trakt or Simkl**. It reads the selected cloud watchlist separately, so users are protected from accidental overwrites. It also does not synchronize external-player progress. Real automatic two-way synchronization and iCloud CloudKit require further development and server/native capabilities. GitHub Pages does not provide an iCloud container.

OAuth access and refresh tokens are saved in local browser storage for persistent logins. Only use Luma on devices you trust. Browser storage is not the same as OS-secured native keychain storage; do not place OAuth tokens, secrets, or backups in GitHub source.

## Browsing catalogs and your library (review build)
- **Catalogs** in the navigation offers 24-title pages with title search, type and genre filters, and sorting. Browse uses the available metadata feed; the main search bar can request new titles from the configured metadata services. Sorting or filtering does not modify saved records.
- **My Library** shows locally saved watchlist titles, watched titles, titles with playback progress, and personal media in one place. It uses previously saved title snapshots when the live catalog changes, and provides collection, type, title and sort controls. Episode-level progress is mapped back to its series for Continue Watching where the parent title can be identified.
- **Add-ons → Browse add-on titles** can search feeds that declare catalog `search`, filter already loaded titles locally by title, type, provider and genre, and request additional pages from feeds declaring `skip`. Pages are loaded in controlled batches, with 24 tiles per display page. Add-on feeds are progressively discovered. Compatible required genre parameters can be selected; unknown required parameters and browser CORS restrictions are reported in source diagnostics. Results are not an exhaustive provider library.
- These views do **not** perform cloud writeback or modify separate Trakt and Simkl lists. **Import backup** validates the file, previews counts, and offers a safe merge before any replace operation. Personal media supports editing, removal, optional collections and poster art. Browser local storage still holds the on-device library, preferences and installed add-ons.

## Luma add-on requirements and independent branding
Open **Add-ons**, paste a public **HTTPS URL ending in /manifest.json**, and install. Catalog/meta/stream requests follow the compatible third-party manifest protocol. The browser can only access add-ons that enable CORS and accept requests directly from GitHub Pages. Some add-ons require configuration, and stream-only add-ons show results when an IMDb ID is available for a selected title. The app does not resolve torrent infohashes, play DRM media, host a proxy, or bypass source permissions.

**Independent branding:** Luma Add-ons and Luma Catalogs are labels for Luma's own browsing interface, not names of or endorsements by any other app. The implementation supports third-party manifest formats but is not affiliated with the services that publish them. Check third-party usage terms, trademarks and licensing before distributing bundled media, logos or add-on code.

**Security:** Manifest URLs sometimes contain tokens. They are stored in local browser storage; do not share configured URLs or browser backups.

## Metadata accuracy
Luma maintains a normalized browser-side catalog and a time-limited TMDB cache; it does not manufacture media release information. **Real-time theatrical showtimes are not included**. A TMDB `now_playing` feed indicates a theatrical-release listing, not proof a film is on screen in your specific theater today. Provider listings indicate catalog availability in the selected country, not guaranteed entitlement or working playback. For the fullest release and streaming discovery, configure your own TMDB **read-only API credential** in Settings. Credentials stored in a static browser app are visible to the local user; never enter secret backend credentials or administrative tokens.

TV data: TVmaze. Optional movie/TV information: TMDB; this product uses the TMDB API but is not endorsed or certified by TMDB. Streaming provider information surfaced via TMDB is powered by JustWatch.

## External players
Infuse: `infuse://x-callback-url/play`
VidHub: `open-vidhub://x-callback-url/play`

Both publish official support for direct video URL handoff. iPhone app/browser restrictions, player installation, codec support, source access, and callback handling determine whether handoff actually plays. The current **static website does not process returning external-player playback callbacks**, so watched progress from Infuse or VidHub is not automatically synchronized back into Luma.

## Not yet implemented
Native tvOS, native Android/Android TV packaging, automatic iCloud/CloudKit synchronization, Trakt/Simkl two-way playback scrobbling, user-managed server-side metadata database, universal stream compatibility, and authoritative current cinema showtimes. The app is a functioning browser prototype with additional features under active development, not a fully verified native media center.

## Development
All app code is static and in this repository. GitHub Actions runs syntax and asset checks on every push. Changes to these web files are published by GitHub Pages after deployment.
