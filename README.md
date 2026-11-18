# Luma Media Center

Luma is a Netflix-inspired **original personal media-center web app**, hosted free on GitHub Pages.

## Open on your iPhone
Visit https://cj42izzle.github.io/Luma-Media-Center/ in Safari. Tap Share → Add to Home Screen. The website version also works on Android browsers and desktops. It is **not a native Apple TV app**.

## What's implemented
- Cinematic home layout, original logo, responsive browsing and search
- Built-in normalized metadata library using TVmaze / Apple listings without a key, with optional TMDB discovery
- Release Radar: new and upcoming titles, reported theatrical releases, on-air TV, trending titles, regional subscription-provider discovery with TMDB configured
- Watchlist, watched flags, continue watching, personal HTTP video URLs, and local backup
- Install unlimited Stremio add-ons individually; batch-install up to 25 URLs at a time
- Disable/remove/test add-ons, browse compatible add-on catalogs and request stream lists by media ID
- Offer stream handoff to Infuse and VidHub via their published x-callback URL schemes, plus in-browser playback for supported files
- GitHub Actions JavaScript syntax and asset checks

## Watchlist sources and account connections (Build 26)
Luma has separate **On Device**, **Trakt**, and **Simkl** watchlist views under **Watchlist**. Switching the selected source never overwrites the other lists. The On Device list stores title snapshots in local browser storage, and **Settings → Export backup** produces a JSON backup you can save to **Files → iCloud Drive** (and restore from any device manually).

For the simpler setup, open **Settings → Connect your watchlists → Connect with Code** for Trakt or Simkl. Luma displays an activation code; visit the official approval link, enter/confirm the code, and return to Luma. The app checks automatically at the provider-required interval; on an iPhone use **Check Connection** after returning if background tabs were suspended. **Luma still requires one registered public app client ID per provider**, configured once under **One-time app setup**. This is an app-level requirement, not a password or client secret. Trakt requires registering an app and a JavaScript CORS origin (`https://cj42izzle.github.io`) and Simkl requires an AUTH V2 app. If the provider blocks cross-origin calls, a compatible backend/native client would be needed. Existing OAuth PKCE browser login remains in Advanced setup. Never publish an OAuth client secret.

Press **Connect with Code** to receive an activation code and grant account access. Trakt uses Authorization Code with PKCE; Simkl uses AUTH V2 with PKCE. The app requests and displays personal watchlists, and the active list is also used for the followed-series calendar. Login requires user authorization; a GitHub commit alone does not connect anyone's account. Some API endpoints can be blocked by provider CORS or limits; Luma displays these errors and preserves locally saved data.

The browser version intentionally **does not automatically push local watch history, ratings, or watchlists into Trakt or Simkl**. It reads the selected cloud watchlist separately, so users are protected from accidental overwrites. It also does not synchronize external-player progress. Real automatic two-way synchronization and iCloud CloudKit require further development and server/native capabilities. GitHub Pages does not provide an iCloud container.

OAuth access and refresh tokens are saved in local browser storage for persistent logins. Only use Luma on devices you trust. Browser storage is not the same as OS-secured native keychain storage; do not place OAuth tokens, secrets, or backups in GitHub source.

## Stremio add-on requirements
Open **Add-ons**, paste a public **HTTPS URL ending in /manifest.json**, and install. Catalog/meta/stream requests follow the Stremio protocol. The browser can only access add-ons that enable CORS and accept requests directly from GitHub Pages. Some add-ons require configuration, and stream-only add-ons show results when an IMDb ID is available for a selected title. The app does not resolve torrent infohashes, play DRM media, host a proxy, or bypass source permissions.

**Security:** Manifest URLs sometimes contain tokens. They are stored in local browser storage; do not share configured URLs or browser backups.

## Metadata accuracy
Luma maintains a normalized browser-side catalog and a time-limited TMDB cache; it does not manufacture media release information. **Real-time theatrical showtimes are not included**. A TMDB `now_playing` feed indicates a theatrical-release listing, not proof a film is on screen in your specific theater today. Provider listings indicate catalog availability in the selected country, not guaranteed entitlement or working playback. For the fullest release and streaming discovery, configure your own TMDB **read-only API credential** in Settings. Credentials stored in a static browser app are visible to the local user; never enter secret backend credentials or administrative tokens.

TV data: TVmaze. Optional movie/TV information: TMDB; this product uses the TMDB API but is not endorsed or certified by TMDB. Streaming provider information surfaced via TMDB is powered by JustWatch.

## External players
Infuse: `infuse://x-callback-url/play`
VidHub: `open-vidhub://x-callback-url/play`

Both publish official support for direct video URL handoff. iPhone app/browser restrictions, player installation, codec support, source access, and callback handling determine whether handoff actually plays. The current **static website does not process returning external-player playback callbacks**, so watched progress from Infuse or VidHub is not automatically synchronized back into Luma.

## Not yet implemented
Native tvOS, native Android/Android TV packaging, automatic iCloud/CloudKit synchronization, Trakt/Simkl two-way playback scrobbling, user-managed server-side metadata database, universal stream compatibility, and authoritative current cinema showtimes. The app is a functioning browser prototype with additional features under active development, not a fully verified Stremio replacement.

## Development
All app code is static and in this repository. GitHub Actions runs syntax and asset checks on every push. Changes to these web files are published by GitHub Pages after deployment.
