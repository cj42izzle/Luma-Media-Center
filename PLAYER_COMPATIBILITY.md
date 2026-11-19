# Luma Player — verified compatibility and remaining work

Luma's design borrows general playback concepts from video-library applications such as Infuse, but is independently implemented. It does not contain Infuse artwork, proprietary code, licensed decoder binaries, DRM circumvention, or its server connectors. A passing build is not a verified playback test on a user's IPTV service.

| Platform | Current playback route | HTTP IPTV | Player features | Unresolved limitations |
| --- | --- | --- | --- | --- |
| Safari / iPhone Home Screen web app | HTML5 native HLS/video | Not accessible from the HTTPS page | Speed, double-tap/swipe gestures, local SRT/VTT subtitles, chapter seek when metadata exists, bookmarks, fit/zoom, AirPlay/PiP when supported | Cannot make HTTP mixed content accessible or background-record while locked; MKV/DTS/TrueHD often unsupported |
| Chrome/Firefox/Edge on desktop | HTML5 native media | HTTPS-only from the Luma website | Browser player controls, user-chosen local videos, captions, queues, bookmarks | Supported formats depend on the browser and OS; no integrated SMB/NFS decoder |
| Android TV, Android phone, Android tablet (native APK preview) | Media3/ExoPlayer | Native HTTP(S) playlist/EPG reader and direct media playback | HLS, TS, compatible MP4/MKV, hardware HDR/Dolby where supported, multiple available audio/text tracks, speed, zoom, repeat, local Files picker and bounded adjacent-channel surf queue | Device codecs/licensing and stream protection vary; not tested against all IPTV providers |
| iPhone/iPad native Luma **source project** | AVPlayer/AVPlayerViewController | Native URLSession HTTP(S) playlist/EPG reader | Native playback, Apple Files/iCloud document picker, adjacent-channel navigation, AirPlay, PiP, system audio/subtitle options, supported HDR/Dolby formats | Requires Apple code signing and installation, currently only a successful unsigned Simulator compile; AVPlayer is **not** a universal MKV/DTS decoder |
| Apple TV / tvOS | Website accessible in some contexts; no dedicated signed tvOS client | Not verified | No dedicated native Luma player shipping | A tvOS-native implementation and signed build are still needed |
| Mac / Windows / Linux | Browser version | HTTPS-only in website | Browser feature set and local-file picker | Dedicated desktop/native decoder for HTTP and unsupported media containers not yet built |
| Apple Vision | No dedicated visionOS build | Not verified | None claimed | Requires new project, UI, testing and distribution |

## What is implemented

- Fast forward/rewind with configurable skip times, optional mobile touch gestures (double tap and swipe), adjustable speed, playback controls, fullscreen, video-only brightness, zoom and fit.
- Native HLS and supported audio/video selection. Hardware tracks are identified where exposed, not fabricated.
- Local SRT/VTT subtitle file loading in the browser, with timing offsets and font scale where the renderer permits it.
- Chapter navigation **when real chapter metadata exists**. Intro/credits skipping uses explicit timing or chapter markers and is hidden without credible markers.
- On-device bookmarks, progress/resume for browser playback, optional queue controls and an in-session sleep timer.
- Native Android IPTV source loading, local-media selection, available audio/subtitle track selection, playback speed and aspect controls.
- Native iPhone/iPad source project using Apple AVPlayer, Apple Files/iCloud Drive picker and optional previous/next IPTV channel buttons (requires Apple signing and a real-device installation to use).
- A bounded IPTV channel queue on Android native, iOS source and the browser player; it never transmits an entire account playlist to a native player activity.

## Not implemented or not verified

Infuse's broadest file format and lossless multichannel codec coverage, exact Dolby Vision profiles, all Dolby/DTS passthrough combinations, dedicated SMB/NFS/FTP/WebDAV/Plex/Emby/Jellyfin/cloud connectors, cloud cross-device progress, full automatic IntroDB matching, subtitle marketplace downloads, AI upscaling, reliable locked-iPhone IPTV DVR and native builds on every operating system are **not complete**. A third-party IPTV channel may also lack a compatible video/audio track regardless of the player.

Adding all supported media formats would require device-specific decoders, licensing review and actual playback tests on representative hardware. Avoid claiming guaranteed Dolby Vision/Atmos until decoded track, output chain and display are confirmed.

## Build and deployment checks

The GitHub Actions **Luma Website Checks** job verifies JavaScript modules, the standalone page and regression tests. **Android TV APK Preview** compiles the Android/TV shell and replaces the development preview release. **Luma iPhone Native Player Check** compiles an unsigned iOS Simulator build; it does not publish an installable iPhone app. See workflow results in GitHub for the specific commit before making availability claims.


**Smart skip:** Browser playback adds chapter/explicit timing recognition for recap, intro and end credits; device-confirmed season-specific timing reuse; optional auto-skip and manual buttons. Auto-segmenting unknown media by audio/video fingerprint is not implemented. Native Android Media3 and iOS AVPlayer source now contain skip overlays for trusted timing markers received from the web catalog. The Android APK compile passed; the iOS workflow and real-device playback still require verification. Native players cannot magically detect unlabeled scenes from visual/audio content.
