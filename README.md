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


## One-login IPTV in Luma (native-first)

The **installed native Luma app** connects directly to the IPTV service over HTTP or HTTPS with its own network reader and built-in video player. Add an Xtream account once under Live TV → Connections: Luma requests live channels (Xtream live API with M3U fallback), obtains XMLTV guide data from the provider's default guide endpoint, and requests the available movie and series libraries. An individual series episode list loads when a series is opened. All of this stays inside Luma; supported content plays with the native player, without opening VLC or Infuse.

The website at GitHub Pages still runs inside Safari and cannot directly fetch an HTTP-only IPTV service. Its saved HTTP login is not a verified connection. Only a browser-compatible HTTPS provider can connect automatically on the website. The native iPhone source compiles in Apple's simulator, but **the user must obtain a signed, installed iPhone build** before the native capabilities will be available. GitHub cannot silently install an app onto an iPhone. IPTV content codecs and service support can vary, so full native playback is not guaranteed for every channel or file.

## Luma Cinema Player — native-first HDR and Dolby audio

See [platform compatibility and Infuse benchmark coverage](PLAYER_COMPATIBILITY.md). Luma is not a copy of Infuse, and web/native codec capabilities are not interchangeable.



The internal **Luma Cinema Player** now opens Live TV channels, movies and individual TV episodes, with TV-friendly and touch controls, native HLS playback, audio/subtitle selection where the browser exposes tracks, AirPlay, fullscreen, Picture in Picture, live jump, and local episode watch progress. It reports browser decoder capabilities only as informational signals — these are not a claim that the source is currently Dolby Vision or Dolby Atmos.

- **Android TV:** The native APK now has a Media3/ExoPlayer full-screen player, launched by a trusted Luma bridge. It can attempt authorized HTTP and HTTPS live channel URLs without browser mixed-content restrictions, and use hardware decoders/audio outputs for compatible HEVC/Dolby Vision, AC-3, E-AC-3 and Atmos (E-AC-3 JOC) media. Hardware, content and audio output all matter. The preview APK is still a test build.
- **iPhone (native source preview):** The `ios/` XcodeGen project hosts Luma in WKWebView, fetches owner-supplied HTTP/HTTPS Xtream M3U/XMLTV using native URLSession, and plays the selected stream in AVPlayerViewController. Apple handles supported HDR/Dolby rendering automatically. It has passed an unsigned iOS Simulator compilation workflow. **This source is not installed on an iPhone by GitHub Pages**; an Apple-signed app and authorized installation/distribution remain necessary. See [native iPhone player build notes](ios/README.md).
- **iPhone (Safari / Home Screen web app):** The web player works only for URLs the browser may load and formats it can decode. HTTP-only services require an installed Luma native app (iOS must be signed); Luma does not launch VLC as the normal IPTV viewing flow. Streaming Dolby tracks requires content correctly encoded for that device; an ordinary stream cannot be made Dolby Vision/Atmos by switching players.

No external CORS relay, IPTV service, paid codec subscription, or DRM bypass is included. The playback engine does not record a stream while an iPhone is locked; that remains separate from native iOS background/DVR engineering.

## Live TV: IPTV + guide + DVR (owner supplied sources)

Luma has a **Live TV** page with a three-hour interactive channel grid, programme descriptions, a search covering channel and show titles, preferred same-show quality matching, and category filters with channel pagination. Enter an **authorized M3U playlist** and, optionally, an **XMLTV guide URL** under **Live TV → Connections & sources**. Luma is not an IPTV provider and does not supply channels or copyrighted streams. An XMLTV feed from your authorized service is generally sufficient; a paid TV-guide API is not required just to populate this guide. Some feeds do not permit browser access, in which case use the optional DVR companion.

**HTTP Xtream on iPhone / Safari:** Luma now allows **Save HTTP IPTV to iPhone** without claiming that the account has been verified. The saved service offers **Get playlist file** and **Import M3U into Luma** for guide browsing; in-app HTTP playback requires a signed Luma native app. The HTTPS website **cannot fetch or play plaintext HTTP IPTV internally**. A dedicated *signed* native iOS build can use its HTTP playlist reader and AVPlayer, but the iPhone source is currently an unsigned simulator-tested project, **not an installed iPhone app**. If your provider offers an HTTPS HLS endpoint that allows browser access, use that for web playback. No PC or NAS is needed just to save the account; a separate always-on DVR server is needed for recordings when playback devices are off. Do not post or commit IPTV usernames, passwords or playlist URLs that contain them.


The **optional always-on DVR** is in [recorder/README.md](recorder/README.md). It must be hosted on a machine that remains powered, has network access, and stores files on a writable drive. A TV box that is completely shut down cannot record. Connect the companion's publicly trusted HTTPS endpoint and its secret access token in Luma. The guide lets you schedule one programme, record a channel manually for 30–240 minutes, and create these series rules: *confirmed new only*, *each unique episode, even a rerun*, or *every airing*. Unique-episode recognition prioritizes episode number and can fall back to sufficiently detailed episode title/description. A description never proves a premiere; guide quality and recording rights vary. Completed recorder files can be downloaded to the viewing device where browser file-saving is supported.

### Install Android TV preview with Downloader

The current APK is permanently hosted at [Luma Android TV preview APK](https://github.com/cj42izzle/Luma-Media-Center/releases/download/android-tv-preview/Luma-AndroidTV-Preview.apk). Downloader's **numeric short codes must be issued by AFTVnews** at [go.aftvnews.com](https://go.aftvnews.com/): paste the public APK URL, complete the site's verification, and copy the generated number into Downloader on your TV. Do not enter a made-up code; the APK URL alone is also accepted in Downloader. The preview launches the live Luma website so updated Live TV features appear without rebuilding the Android shell.


## On-device Android TV recording

The Luma Android TV preview includes a local DVR service. From Live TV choose a channel or programme and select **Record on this device**. You can schedule directly to the TV box without connecting a separate server. Its Android foreground service uses scheduled alarms and writes to **Movies/Luma Recordings** or a folder picked on your device. A device that's completely powered off cannot record; powered standby/background operation depends on Android's power-management policy. Some schedules will run approximately rather than exactly when Android denies exact-alarm access. Recordings support direct MPEG-TS or standard unencrypted HLS MPEG-TS; DRM, encrypted HLS and fragmented-MP4 HLS are unsupported. At most two simultaneous recordings and up to 240 minutes per recording. The local series option schedules matching episodes already in the loaded guide; refresh later EPG dates to extend it. The optional always-on server remains available for ongoing unattended series discovery.


### Sleep-mode local DVR (Android TV)

Luma native DVR can capture live TV when the display is off **as long as the Android TV box remains powered on**. A user-scheduled programme uses a wake-up alarm with exact/allow-while-idle timing when Android permits it to start a foreground recording service. Only while capturing does the app hold a bounded CPU partial wake lock and a Wi-Fi lock; both are released after recording. Alarms are rearmed following reboot, app update, permission grants and app resume. In Live TV → My DVR → Record while the TV sleeps, check alarm and battery settings.

Device setup: allow **Alarms & reminders** when offered, and review manufacturer restrictions on background activity or low-power standby. TV display off is fine; do not cut power to the Android TV box. Some manufacturers block Wi-Fi/network access in deep standby even with wake locks. Android 15+ also limits background dataSync foreground services to six hours total per 24-hour period. Verify with a short sleep-mode recording before relying on it. This is best-effort, not a guarantee on all hardware.


## Space-saving HEVC and automatic exact-episode recovery

**Android TV, no server:** Luma captures the original file before compression. The DVR checks recording start time, media duration, playable video, and incomplete HLS segments. On devices with a supported HEVC encoder, it then attempts to create a smaller H.265 MP4 using Android's Media3 hardware pipeline. The original stays intact if conversion fails, loses duration, or does not save space. This is H.265/HEVC output, not the desktop software library called x265.

**Optional recorder companion:** FFmpeg uses its real libx265 encoder after verifying the raw capture. The raw TS file remains until a smaller and complete HEVC MP4 has been verified and recorded in the saved history.

**Reruns across every channel/provider:** An incomplete or failed episode searches all the IPTV channels and services represented in the loaded EPG, including a repeat on another channel later that same day. The episode must match by season/episode number, or by strong specific subtitle/description metadata. No ambiguous replacement is accepted. Retries have their own linked history entries and are capped to avoid loops. On Android TV, the multi-channel EPG cache permits background retry scheduling while the screen is off. If a later rerun is not yet in the cache, Luma will look again when the app loads fresh EPG listings. The optional always-on recorder companion can request guide updates about every five minutes while an episode is awaiting a retry.

Neither system can guarantee complete output when the IPTV feed itself is unavailable or corrupted, guide data does not identify an episode, storage is exhausted, or Android suspends network access. Validate with a short real-device test before relying on unattended recordings.


### Smart episode skips

Luma's browser player recognizes **recap**, **intro** and **credits** when a stream supplies explicit chapters or episode timing information. It also has an in-player **Smart skip training** panel: mark the start and end of an intro or recap (or start of credits) once for a show and season, then Luma reuses those local timings for episodes of that season. Verified segments auto-skip by default; turn this off in Playback options to keep manual skip buttons. Unlabeled segments are *not* guessed from silence, fixed time offsets or subtitles. Native Android Media3 and iOS AVPlayer source now receive verified skip metadata and implement skip controls. Android compilation has passed; native iOS compilation and physical-device behavior are not yet verified. Unlabeled scenes are not automatically detected.


Completed recorder files now have **Watch in Luma** in the DVR list, using a short-lived, recording-specific playback URL with HTTP range/seek support; **Save to device** remains an option. The recorder requires its own running HTTPS host and access token. This does not make background DVR possible when the only device is powered off.


### iPhone Safari: when the guide shows zero channels
A saved HTTP IPTV account is **not a connected playlist**. Luma now shows direct recovery controls on the Guide screen: import a provider M3U saved in Files, open the provider's own playlist download, test an HTTPS endpoint on the same host (standard port only), or enter a separately supplied HTTPS address. The HTTPS address is used only after a valid M3U is retrieved; no unknown proxy or invented provider URL is used. Once channels exist, the guide can import a matching XMLTV file separately, including via Live TV → Connections. Safari still cannot play HTTP video or fetch HTTP XMLTV from the secure website; a signed native iOS Luma app or a provider-supported HTTPS feed is required. The mobile guide search/category/action toolbar is styled to avoid field overlap.

In native Luma, an unsuccessful IPTV connection now offers Retry automatic connection instead of manual playlist or guide imports. Browser-only file import remains available exclusively as a Safari fallback.

Native provider parsing now supports larger M3U channel groups and scans XMLTV programme nodes across the returned guide, rather than truncating the raw first 28,000 programme elements before checking broadcast dates. A bounded match cap still protects memory use on smaller devices.

The Safari build now automatically checks a saved HTTP provider for a working HTTPS endpoint on the **same hostname, standard HTTPS port**. It verifies an actual channel list before using that endpoint and leaves the original login/server untouched on failure. This cannot make HTTP-only streams playable in Safari.


### Reliability repairs

Parallel live-provider and XMLTV fetches prevent one offline IPTV service from blanking a working provider. Luma now accepts BOM-prefixed M3U files, reads Xtream channel category labels, and appends large XMLTV result collections without relying on an oversized JavaScript argument spread. The native iPhone player also retries a failed direct Xtream MPEG-TS **live** URL as HLS (`.m3u8`) only on the exact same server and credential path, once; playback is still limited by provider support and Apple hardware codecs. These changes do not override Safari's HTTP restriction or Apple's signing rules.

### Simplified IPTV connection screen (November 19, 2026)
Live TV and Guide now show one concise card when a service is saved but no channels have connected: service name, connection status, an automatic retry and account settings. The duplicate full-page error, repeated guide heading, M3U download buttons and technical HTTPS controls are no longer displayed as the primary experience. Advanced M3U/XMLTV imports remain under Connections for owners who specifically need them. A Safari user with HTTP-only IPTV is told that native iOS signing/installation is still required; the website cannot bypass iOS or browser security.


### Expanded free movie, television, and anime discovery

Luma now adds AniList (public GraphQL anime metadata) and Stremio's official Cinemeta movie/series metadata alongside TVmaze, Apple Movies and optional TMDB. Anime loads 50 entries when both initial AniList pages return data, rather than depending on the few TVmaze listings tagged Anime. Movie and series collections load actual public metadata and have sequential pagination; type-specific **Load more anime/movies/TV shows** fetches the next provider page. Typing at least three characters into a catalog's search field searches the relevant remote catalog after a short debounce, so searches are not limited to titles cached on the device. AniList is currently subject to a stricter 30-request/minute degraded API quota, so Luma limits requests; if one provider is unavailable, others still populate. The new catalog provides metadata and artwork, not a guarantee that streaming links exist. It does not generate fictitious titles or require additional subscriptions.

The main Luma search now also queries the expanded Cinemeta and AniList catalogs, not only the initial TVmaze/iTunes or TMDB results. Catalog-filter searches and global searches both use remote lookups without requiring users to configure an API key.


### Luma Theater navigation, Live TV guide and DVR overhaul (November 19, 2026)

The Luma user interface is now TV-first: **Home, Live TV, Guide, Recordings, Movies, TV Shows, Anime, My List and My Library** form the primary sidebar. All existing discovery and account tools remain under **More to explore** and Settings. New `theater.css` provides a consistent original cinematic poster/backdrop experience, readable TV remote focus indicators, responsive mobile layout, scrollable broadcast grid, sticky channels and time header, animated rail feedback, and reduced-motion support. The Live TV screen prioritizes Watch live and TV Guide with real channel cards even when EPG data is absent. The Guide includes a live programme spotlight, category filters, favorites, a time scrubber and a Record button on each programme. The DVR has separate Upcoming, Recorded and Series rules views. One-tap programme recording uses the existing Android TV device recorder or authenticated external DVR; if neither is connected, Luma opens programme details and explains what's needed rather than falsely claiming it recorded. This redesign never substitutes fabricated guide programmes, stream URLs or recordings.


### Luma Prime personalized home (November 19, 2026)

The TV-first Home prioritizes Resume Watching from real playback progress, DVR Recordings from actual jobs (connected recorder and native Android TV), New Movies and New TV Shows with dated metadata, verified S01E01 series premieres from the TV schedule, and separate local/national news from the CORS-enabled GDELT DOC 2.0 API. Local news defaults to Reno, NV in this installation and can be changed on the Home screen without sharing exact location. If the news API is unavailable, Home provides direct publisher links rather than invented headlines. New dates and recordings are never synthesized. Navigation shortcuts open Live TV, Guide, DVR, Calendar and Anime. The Luma Prime design improves artwork, page hierarchy, guide readability, programme-recording buttons, DVR tabs and TV remote focus. Metadata cannot guarantee stream playback; HTTP-only IPTV in Safari still requires a native installed app or a permitted HTTPS provider. A powered-off recording device cannot record without an always-on DVR host.

**When a provider XMLTV guide fails:** Luma's native/authorized Xtream connection can now request the provider's `get_short_epg` API for visible channels in bounded parallel batches. It uses source timestamps and base64-decoded titles, marks no show as a confirmed premiere without guide evidence, and does not invent schedules. Requests are throttled per channel. This is a fallback, not a replacement for a complete XMLTV guide, and does not circumvent Safari's HTTP-only connection restrictions.
