# Luma native iPhone player (source preview)

This is a **native iOS app source project**, not an App Store app or a signed installable IPA. It wraps the same Luma website in `WKWebView`, uses native `URLSession` to request an authorized Xtream M3U/XMLTV feed over HTTP or HTTPS, and sends actual media playback to Apple `AVPlayerViewController`. The native client is necessary because the Safari-hosted HTTPS website cannot fetch plaintext HTTP IPTV.

## Playing IPTV

1. After this source is compiled and installed as a signed iOS app, open its Live TV → Connections page and enter your service in the app. Safari's saved accounts do not automatically move into WKWebView storage.
2. Press Connect & Load Everything. The trusted native bridge calls Xtream's live channel API (with M3U fallback) and the provider's XMLTV EPG automatically. Movie/series catalogs and individual episode listings load through the corresponding provider APIs. No manual M3U or XMLTV download is required.
3. Select a channel. The Luma internal player routes the direct HTTP(S) stream into AVPlayer, with system playback controls, AirPlay and supported Picture in Picture.

Luma does not include a Dolby decoder or force streams to be Dolby. `AVPlayer` uses Apple's supplied decode/render and audio routing pipeline. **Dolby Vision** works when the iPhone and the media variant are supported. **Dolby Digital (AC-3)** and **Dolby Digital Plus (E-AC-3)**, including **Dolby Atmos** on suitable Apple equipment and encoded streams, follow platform audio capabilities. Channel listings must contain the right encoded tracks. A TS stream or incompatible encoding may still fail and require transcoding by the provider.

## Build / install

In the `ios` directory, `xcodegen generate` produces `LumaIOS.xcodeproj`. Open it in Xcode, choose an Apple signing team and your real bundle identifier, select an attached iPhone, and build. GitHub's Luma iPhone Native Player Check action compiles the iOS simulator and unsigned iPhone device build, and uploads an unsigned preview IPA. This artifact is **not installable until it has been signed** using an Apple provisioning profile; the GitHub Actions upload alone cannot install Luma. Distributing a signed application through TestFlight/App Store or an authorized sideloading path requires the relevant Apple provisioning and signing steps. A Mac/Xcode or an appropriately configured signing/distribution pipeline is required.

## Security boundaries

`Info.plist` deliberately sets `NSAllowsArbitraryLoads` to support user-supplied HTTP playlist requests through `URLSession` and AVFoundation. This is a broad App Transport Security exception, less safe than HTTPS, and may require App Store justification. Native bridge access is limited to the trusted, top-level Luma website, with URI and response-size validation. Do not log or publish Xtream credentials. Users should prefer HTTPS whenever the provider supports it.

The website's native-bridge handler is not available inside ordinary Safari. It cannot be emulated with JavaScript, a GitHub Pages service worker, or a Dolby codec library. Recording an HTTP IPTV stream unattended while the iPhone is locked is **not included** in this player preview and is subject to native iOS recording/background-execution limits.


## In-app chapter skip controls
The iOS Luma source receives trusted, explicitly labeled/confirmed intro, recap and credits times from the website catalog and displays contextual buttons within its own AVPlayerViewController overlay. Automatic skip obeys Luma's web-player setting. It does **not** infer scene boundaries from video fingerprints or guess fixed lengths. This source requires an Apple-signed installation, and actual on-device playback/skip compatibility has not been verified.

Native IPTV guide transfer uses bounded 25 MB responses, chunked into smaller messages for WebKit; provider credentials are still sent directly from the Luma app to the user's selected provider. An unsigned IPA is only a build artifact. Never distribute a signed IPA with an embedded private IPTV credential.

A failed raw MPEG-TS Xtream live channel is retried once as HLS on the **same** URL/host with only the file extension changed. The fallback does not bypass provider authentication, Apple codec support, or DRM.
