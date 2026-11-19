# Make Luma installable on an iPhone

**What works:** Luma's native source and unsigned iOS preview compile. The native app can request authorized HTTP and HTTPS IPTV channels and XMLTV directly, and use Apple's built-in player. No M3U or EPG file import is part of native setup.

**What still requires Apple:** iPhones only install apps with valid Apple code signing and provisioning. GitHub cannot manufacture an Apple signing identity, register your iPhone, sign on your behalf, or install the app remotely. Never send your Apple credentials, certificate/private key, or IPTV password in ChatGPT.

## Option 1: Install for free with a Mac

Use Xcode and a free Apple Personal Team. Generate the project in this repo's `ios` folder with `xcodegen generate`, open `LumaIOS.xcodeproj` in Xcode, select your Apple Account under **Signing & Capabilities**, connect your iPhone, and choose **Run**. Xcode provisions and signs a personal development build automatically. Apple's Personal Team profiles generally expire after seven days and need reprovisioning. Safari-saved IPTV credentials do not transfer into WKWebView, so sign in to your IPTV service **once inside the native app**.

## Option 2: Install with Windows, no Mac or subscription (third-party signing)

This route uses the **unsigned iPhone-device IPA**, not an iOS Simulator build.
It still requires a free Apple Account and a physical computer, but does not
require Xcode or the paid Apple Developer Program.

1. Open **GitHub Actions → Luma iPhone Native Player Check**. Select a completed
   run in which both **Compile unsigned iPhone device preview** and
   **Upload unsigned native source preview** succeeded. Older simulator-only
   runs, including run 44482644095, are not suitable for device installation.
2. Under **Artifacts**, download **Luma-iOS-UNSIGNED-preview** (if it is present
   and unexpired). Unzip the downloaded artifact to obtain
   `LumaIOS-unsigned.ipa`. A GitHub Actions artifact ZIP is **not** itself
   the .ipa to select, and the IPA is not installable without signing.
3. On a Windows PC, use a reputable signing/sideload utility such as
   [Sideloadly](https://sideloadly.io/) (third-party, not affiliated with
   Luma or Apple). Follow its current Windows installation prerequisites.
   Connect and trust the iPhone by USB, select the .ipa and the iPhone,
   and use your **own free Apple Account** to let the utility provision,
   sign and install a personal-device build. Enable **Developer Mode** in
   iOS Settings → Privacy & Security if prompted, then restart/confirm.
4. Launch the Luma icon and configure your *authorized* IPTV provider
   inside the native app. Test a permitted HTTP playlist, HLS channel,
   channel switching, and a supported VOD stream on the actual device.
5. Free Apple provisioning lasts **seven days**. Re-sign/reinstall or use
   the utility's supported refresh process before expiration, keeping the
   same bundle identifier if possible to preserve local app data.

**Privacy warning:** A third-party signer may have access to Apple Account
authentication material. Decide whether to trust the vendor; do not share
your password, 2FA codes, provisioning profile, or certificate with Luma,
ChatGPT, a repository issue, or anyone offering a remote signing service.
This option is *not* a substitute for Apple's signing/provisioning rules.

Alternatives: [AltStore Classic](https://faq.altstore.io/altstore-classic/your-altstore)
also supports free-account sideloading with a computer and seven-day
refreshes; Xcode on a Mac is preferable if available because signing
stays within Apple's tooling. An iPhone alone cannot install this
unsigned GitHub artifact as a normal US personal-device app.

## Option 3: Build a signed IPA using GitHub

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
