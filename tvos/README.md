# Luma native Apple TV foundation

This is an **unsigned tvOS 17+ SwiftUI source project**, not a published Apple TV application or an IPA. It provides native Siri Remote focus navigation, source-backed CineMeta/AniList metadata, independent per-viewer on-device Watchlist, Favorites and marked-watched titles, a native AVPlayer player, and an HTTPS M3U playlist connection stored in the tvOS Keychain.

## Build with Xcode

On a Mac with Xcode and XcodeGen, run `cd tvos && xcodegen generate`. Open `LumaTV.xcodeproj`, select your Apple development team and bundle identifier, then run on an Apple TV device or simulator. Code signing and installation on a physical Apple TV require an appropriate Apple setup; those steps are **not completed by committing this source**. The project is not submitted to the App Store or signed here.

## Source and feature limitations

The public catalogs contain **metadata only**, not promised playback streams. The native Live TV screen accepts only an **HTTPS playlist address**, with M3U channels pointing to authorized HTTPS streams. Apple AVPlayer determines whether individual formats/codecs play; MPEG-TS-only or other unsupported streams may fail. Full XMLTV guide data, account logins, native DVR, add-on streams, anime season mapping, external player return events, and bidirectional Watchlist/episode history sync with the existing web/Android TV app are **not implemented in this foundation**.

Up to eight local viewer profiles can be selected on Apple TV. Watchlist, Favorites and marked-watched states are separate per viewer, while the catalog and playlist connection are shared. Profiles are not password-protected. These states are and stored locally on Apple TV, not automatically synced or silently merged into the web app or connected accounts. Luma does not provide IPTV subscriptions or bypass content protections. Do not put private tokens in code or source control.
