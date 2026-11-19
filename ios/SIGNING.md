# Make Luma installable on an iPhone

**What works:** Luma's native source and unsigned iOS preview compile. The native app can request authorized HTTP and HTTPS IPTV channels and XMLTV directly, and use Apple's built-in player. No M3U or EPG file import is part of native setup.

**What still requires Apple:** iPhones only install apps with valid Apple code signing and provisioning. GitHub cannot manufacture an Apple signing identity, register your iPhone, sign on your behalf, or install the app remotely. Never send your Apple credentials, certificate/private key, or IPTV password in ChatGPT.

## Option 1: Install for free with a Mac

Use Xcode and a free Apple Personal Team. Generate the project in this repo's `ios` folder with `xcodegen generate`, open `LumaIOS.xcodeproj` in Xcode, select your Apple Account under **Signing & Capabilities**, connect your iPhone, and choose **Run**. Xcode provisions and signs a personal development build automatically. Apple's Personal Team profiles generally expire after seven days and need reprovisioning. Safari-saved IPTV credentials do not transfer into WKWebView, so sign in to your IPTV service **once inside the native app**.

## Option 2: Build a signed IPA using GitHub

The new [Build signed Luma iPhone app workflow](../.github/workflows/ios-signed.yml) can build a properly signed IPA for a **registered iPhone** using your own Apple certificate and provisioning profile. It is manual-only by design, to avoid accidentally consuming macOS runner minutes or producing an empty/unsigned artifact.

Store these four required values in **Repository Settings → Secrets and variables → Actions → New repository secret**:

| Secret name | Value |
|---|---|
| `LUMA_IOS_P12_BASE64` | Base64-encoded iOS signing certificate and private key exported as a `.p12` file |
| `LUMA_IOS_P12_PASSWORD` | Password for that `.p12` |
| `LUMA_IOS_PROFILE_BASE64` | Base64-encoded development/Ad Hoc `.mobileprovision` including your registered iPhone |
| `LUMA_IOS_TEAM_ID` | Your 10-character Apple Team ID |

The provisioning profile must match bundle ID `io.github.cj42izzle.luma.ios`. The workflow checks its Team ID, application identifier, registered-device list and embedded profile, then verifies code signing before uploading an IPA artifact. It cannot generate any of the four inputs. No IPTV account data is embedded into the app or GitHub workflow.

After the secrets are configured, open **Actions → Build signed Luma iPhone app → Run workflow**. A successful run uploads **Luma-iOS-SIGNED-registered-device**. Install only on a device included in the provisioning profile, using an Apple-supported installation method (Xcode / Apple Configurator or appropriate device deployment tooling). This is not a TestFlight release.

### Limitations that can't be bypassed in website code

- **Safari HTTP:** The GitHub Pages site runs on HTTPS and cannot directly fetch an HTTP-only IPTV feed or play mixed-content HTTP video. A signed native iPhone build uses its own HTTP networking instead, but must first be installed.
- **Video decoding and Dolby:** Apple AVPlayer can only decode supported formats and tracks on the connected device. HDR/Dolby Vision/Dolby Atmos cannot be created from ordinary media or forced by switching players.
- **DRM/provider restrictions:** Access rights and DRM must come from an authorized provider. This project contains no DRM bypass.
- **Recording with the device off:** A powered-off phone cannot record. The optional always-on Luma recorder runs separately on hardware with storage and power; a streaming-only phone app cannot replace that server.
- **Private information:** Do not put IPTV credentials into GitHub issues, repository secrets intended for signing, screenshots, or public links. Use Luma's own device-local account form.
