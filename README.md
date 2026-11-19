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

## Live Build 30 — cinematic discovery and episode selection
- **Episodes in TV show detail pages:** opening a TMDB series loads the first available season's episodes automatically. Season selectors load individual seasons; episode cards show available still images, air dates, runtime, descriptions and local progress. For TVmaze shows, Luma uses its season/episode list; titles from other sources can also resolve a sufficiently exact TVmaze match (IMDb ID or title plus year).
- **Select an episode:** selecting an episode requests that episode's playback sources through the installed compatible add-ons. Only stream results with direct HTTP(S) URLs can be opened by a supported player; results without direct URLs are displayed as unavailable instead of falsely promising playback.
- **Visual discovery:** featured artwork is rendered as a real image element with a fallback background. The feature has previous/next controls; home rails show more series, movies, animation, genres, ratings, release information and local watchlist activity. An image is shown only when a metadata source actually provides a usable image URL.
- **Luma Add-ons:** compatible manifests can be updated in place using Refresh. Stream-only manifests without a catalog array are accepted. Playback results show file quality, provider, tags, and a collapsible technical filename. Failed providers appear in compact diagnostics without hiding successful links. Identical URLs with identical labels are deduplicated; different direct links are preserved.
- **Important:** Luma cannot repair a third-party server outage, remove access restrictions, bypass CORS, guarantee a stream is available, or provide artwork where the upstream metadata has none. Trakt and Simkl connection setup remains separate and still requires legitimate provider application credentials.

## Live Build 31 — interactive collections and verified streaming categories
- Every Luma **home media row title and See all button** opens its own full-screen collection. The Release Radar rails also link to matching collections. These pages provide category artwork, genre and movie/series filters, title search, sorting, and on-demand provider-backed pages where available.
- **Streaming** navigation includes premium-looking descriptive service tiles for **Netflix, HBO Max, Disney+, Hulu and Prime Video**. Service names are descriptive references to independent third-party catalogs; Luma uses original graphics and is not affiliated with or endorsed by those services.
- **Correct country-specific provider listings:** With a TMDB read-only credential configured, Luma resolves current provider IDs from TMDB's regional movie/TV provider lists and uses provider ID, country and subscription type filters for discovery. Every displayed platform title is checked separately against its movie/TV regional subscription (flatrate) list. A rental, purchase, ad-only or unrelated provider listing is not sufficient. Failed verification requests omit uncertain results rather than claiming the title is present.
- **Country and pagination:** Platform category pages allow United States, United Kingdom, Canada and Australia selections, filter by movie/series and genre, and request further reported titles. Results are cached briefly in memory and may change; this is provider-reported metadata, not proof that an account can play the title.
- **No fabricated service catalogs:** Without a configured TMDB read-only key, Luma shows the service directory and a Settings prompt, not guessed Netflix/HBO Max lists. Users can still browse the general no-key TV/movie catalogs. Provider discovery relies on TMDB/JustWatch metadata, which can be delayed or incomplete.
- **Data privacy:** Selecting a collection does not modify installed add-ons, personal media links, saved watchlists, Trakt or Simkl accounts.

## Live Build 32 — expanded streaming networks and deep catalog filtering
- **25 streaming services:** Netflix, HBO Max, Disney+, Hulu, Prime Video, Apple TV+, Paramount+, Peacock, Crunchyroll, STARZ, AMC+, discovery+, BritBox, Shudder, MGM+, MUBI, Criterion Channel, Acorn TV, Rakuten Viki, Tubi, Pluto TV, The Roku Channel, Plex, Kanopy, and Hoopla. Streaming-service names identify independent third-party services, not partnerships or endorsements.
- **Correct content types:** Subscription services use `flatrate` offers; Tubi, Pluto TV, The Roku Channel, Plex, Kanopy and Hoopla use `ads` and/or `free` offers. Library-card labels distinguish those conditions. Some free services require library eligibility or other conditions.
- **Deeper catalogs:** The first load and each Load More action fetch additional provider discovery pages, with one source used for movies and another for TV series. When the provider has multiple valid subscription tiers, their identifiers are combined without accidentally adding unrelated marketplace channels. Confirmed titles still undergo their own country-specific offer check.
- **Real filters:** Title search makes separate TMDB search requests for movies and TV, with each result independently checked for provider availability. Genre, language, release year, content type and sorting are sent to source-backed discovery wherever supported. Filtering is not limited to the first titles already visible; use Load More to explore further. Providers can enforce rate limits or return incomplete metadata.
- **Accurate limitations:** A public TMDB read-only credential is still needed for service catalogs. The app does not scrape or reproduce entire private company libraries, claim account playback rights, or fabricate provider listings. Source metadata can be delayed and catalog completeness cannot be guaranteed. The site does not store third-party API data centrally.

## Live Build 33 — accurate cinema premieres
- **Coming to cinemas** shows new movies with a verified, *future* first limited/wide theatrical release in the selected country. **In cinemas** shows recently released new movies with their first local theatrical date within the past 28 days. These are release listings, **not** proof of theater showtimes, screen availability, tickets, or subscription access.
- Luma now uses TMDB's region-filtered theatrical discover query with release types **2 (limited theatrical)** and **3 (theatrical)**, a 120-day upcoming window, and a recent-original-release guard. Each candidate movie's metadata and country-specific release history are checked independently. A re-release of an old film, digital/TV release, foreign-country date, or title without sufficient verification is omitted.
- The live Release Radar, home cinema rows, and clicked **Coming to cinemas** / **In cinemas** categories use the same verified source, not arbitrary future movie dates or unrelated TV-series releases. Cinema cards show their reported regional premiere dates. Cached cinema feeds use a new version and refresh at most hourly, with expired dates removed at display time.
- Future theatrical titles are **only available with a valid TMDB read-only API credential** in Luma Settings. Without sufficient data Luma shows an explanatory empty state instead of inventing upcoming films. Older restored movies remain available in general catalogs and personal libraries—they are excluded only from new cinema listings.

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


## Install Luma on iPhone and Android TV

On **iPhone**, open [Luma Media Center](https://cj42izzle.github.io/Luma-Media-Center/) in **Safari** (not an in-app browser). Choose **Share → Add to Home Screen**, keep **Open as Web App** on, and tap **Add**. The Home Screen icon opens the same Luma site after each update. Refresh when you want the newest content. Each device has its own browser storage for watchlists and settings.

On **Android TV**, download the preview APK from the [Luma Android TV release](https://github.com/cj42izzle/Luma-Media-Center/releases/tag/android-tv-preview), transfer it to your box, and use the installer. You may need to allow app installation from the file manager. The preview opens this same live site with `?tv=1` and D-pad navigation. It requires internet and a working system WebView. Video codecs, protected DRM playback, external players, and installed browsers vary by box.


### Luma visual identity

The updated neon Luma emblem is shared by the website, app manifest, iPhone Home Screen shortcut, and Android TV preview branding. Original-language and English-dub card badges can be independently hidden under **Settings → Card labels**.


## Live TV: IPTV + guide + DVR (owner supplied sources)

Luma has a **Live TV** page with a three-hour interactive channel grid, programme descriptions, a search covering channel and show titles, preferred same-show quality matching, and category filters with channel pagination. Enter an **authorized M3U playlist** and, optionally, an **XMLTV guide URL** under **Live TV → Connections & sources**. Luma is not an IPTV provider and does not supply channels or copyrighted streams. An XMLTV feed from your authorized service is generally sufficient; a paid TV-guide API is not required just to populate this guide. Some feeds do not permit browser access, in which case use the optional DVR companion.

The **optional always-on DVR** is in [recorder/README.md](recorder/README.md). It must be hosted on a machine that remains powered, has network access, and stores files on a writable drive. A TV box that is completely shut down cannot record. Connect the companion's publicly trusted HTTPS endpoint and its secret access token in Luma. The guide lets you schedule one programme, record a channel manually for 30–240 minutes, and create these series rules: *confirmed new only*, *each unique episode, even a rerun*, or *every airing*. Unique-episode recognition prioritizes episode number and can fall back to sufficiently detailed episode title/description. A description never proves a premiere; guide quality and recording rights vary. Completed recorder files can be downloaded to the viewing device where browser file-saving is supported.

### Install Android TV preview with Downloader

The current APK is permanently hosted at [Luma Android TV preview APK](https://github.com/cj42izzle/Luma-Media-Center/releases/download/android-tv-preview/Luma-AndroidTV-Preview.apk). Downloader's **numeric short codes must be issued by AFTVnews** at [go.aftvnews.com](https://go.aftvnews.com/): paste the public APK URL, complete the site's verification, and copy the generated number into Downloader on your TV. Do not enter a made-up code; the APK URL alone is also accepted in Downloader. The preview launches the live Luma website so updated Live TV features appear without rebuilding the Android shell.
