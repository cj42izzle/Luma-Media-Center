# Luma Android TV APK — install, updates and signing

## Install on NVIDIA Shield TV / Android TV

Download the current actual APK here:

https://github.com/cj42izzle/Luma-Media-Center/releases/download/android-tv-preview/Luma-AndroidTV-Preview.apk

Installer page: https://cj42izzle.github.io/Luma-Media-Center/install.html

Do not enter the main GitHub Pages website address as an APK or Downloader code; that opens the **web app**, not a native Android package. A Downloader numeric code has to be generated separately for the **direct APK URL** on https://go.aftvnews.com/ and may require completing a captcha. No numeric code is claimed until generated and verified. The downloaded file must end in `.apk` and Android must show the package installer. Install from a trusted source and enable "Install unknown apps" for the specific installer if Android asks.

Open Luma from **Shield → Apps**, not from Downloader's in-app browser. Open **Live TV → Connections** and add an IPTV account *inside this app*. Safari, Downloader browser, and Android WebView do not automatically share the same saved provider logins.

## What updates automatically

The installed Android TV APK is a native Java/WebView shell plus a Media3 player, an HTTP(S) playlist/guide reader, and local DVR code. It loads the current GitHub Pages website at launch with **no-cache** mode. Therefore HTML/JavaScript, the Home screen, categories, guide UI and website fixes published to GitHub Pages are fetched again next launch. Use **Refresh Luma** in the installed app for an on-demand web reload. It does not reset stored IPTV accounts.

**Native** code changes (Java, Android manifest, Media3 player, DVR service, security) require a new APK. Android cannot silently install a sideloaded update without the user's operating-system approval. Changes cannot be made to the signed native package solely by updating the hosted website.

## Stable update identity (one-time, no paid service required)

The public repository MUST NOT contain any Android signing private key, keystore or private password. For future native APKs to install **over** the currently installed app while preserving its sandbox, the application ID, signing certificate, and increasing `versionCode` must match Android's update rules.

The owner can configure **all four** repository GitHub Actions encrypted secrets in **Settings → Secrets and variables → Actions**:

- `LUMA_ANDROID_KEYSTORE_B64`: base64 bytes of a securely generated release PKCS12/JKS signing keystore.
- `LUMA_ANDROID_KEYSTORE_PASSWORD`: the keystore password.
- `LUMA_ANDROID_KEY_ALIAS`: key alias.
- `LUMA_ANDROID_KEY_PASSWORD`: private key password.

Create the key once on a trusted computer, store an offline backup, and use a long validity (at least 25 years). **Do not send any of these values to ChatGPT or commit them.** The GitHub Action restores the key on its isolated main-branch runner and builds `app-release.apk` in place of the temporary debug-signed APK. PRs do not use signing secrets. The public release retains the same permanent download URL, and release notes identify whether stable signing was actually used.

If no key has been configured, builds still work and the APK is published as a **debug-signed preview**. An ephemeral GitHub Actions debug key can change between builds, which means upgrades may be refused. If moving from an older debug APK to a stable signed build, one final uninstall/reinstall is generally necessary; first export your locally stored Luma backup because Android may erase app data on uninstall. Once installed using a stable owner key, later builds signed with the **same key** and an incremented versionCode can replace the app via the Android package installer without clearing its data.

## Provider and compatibility limits

The native Android IPTV reader fetches authorized HTTP(S) Xtream/M3U and XMLTV endpoints directly, avoiding browser CORS and HTTPS mixed-content restrictions. It does **not** bypass subscription, provider authentication, DRM, geo-restrictions, or codec/track limitations. Live channels, guide rows and VOD counts depend on upstream provider responses. Missing or excessive counts require inspection with an authorized test provider—never report success based only on a passing compile.

A fully powered-off Shield cannot record on its own. Device-standby recording requires power/network/storage permissions, a compatible unencrypted stream, and real-device verification. True device-off DVR requires another always-on recording host.


## Built-in update checker (versionCode 7+)

The installed Android TV app now offers **Check APK updates** in the header and checks the official GitHub release periodically. If a newer native version is published, Luma asks before downloading. It downloads only through trusted HTTPS GitHub infrastructure, checks SHA-256 against the release update manifest, and hands the APK to Android's standard package installer. The user must approve installation and Android enforces package signatures; Luma does not silently install apps.

GitHub Actions publishes Luma-AndroidTV-Update.json alongside the APK only after the native build succeeds. The native version code must increase for in-app upgrades to appear. Website changes continue loading without replacing the installed APK. A preview signed with an incompatible ephemeral debug certificate cannot overwrite an older app. Owner-managed stable signing secrets described above remain a one-time requirement for reliable in-place native updates.

**Connection health:** Live TV → Connections now displays actual channels and programme entries loaded, per-source counts, channels with upcoming guide coverage, invalid or unassigned entries, and source errors. Refresh & audit bypasses the two-minute channel cache. All counts depend on the owner's actual IPTV feed; fixture tests do not prove full provider access.

## One-time owner setup from iPhone — NO PASTING

The GitHub connection in ChatGPT cannot create repository Actions secrets, so your
private Android signing key must be created from your own GitHub account. You do
not need to paste commands into a terminal or enter a keystore password in ChatGPT.

1. On your iPhone, open **[Create Luma Codespace](https://codespaces.new/cj42izzle/Luma-Media-Center?quickstart=1)** in Safari and sign in to GitHub. Choose **main**. Request Desktop Website if mobile controls are missing.
2. Once the web editor opens, tap the top-left **≡** menu, then choose **Terminal → Run Task...** and select **Luma: One-time owner signing setup (NO PASTE)**. You can alternatively choose **Terminal → Run Build Task** because this is the project's default build task. No command needs to be typed.
3. If the task needs more repository permissions, it will start a **GitHub device authorization**. It may show a short code to enter at **https://github.com/login/device** in Safari. Complete GitHub's approval using your account. Do not share the code with ChatGPT.
4. The task generates a private signing password. Save that password separately in your iPhone **Passwords** app. When the terminal asks if you saved it, type **YES** and press Enter.
5. In the editor's **Explorer** open **.luma-private/luma-tv-release.p12**. Use the file's context menu **Download** to save it to your own **Files / iCloud Drive**. Keep the private signing key backed up for future app updates. After verifying the downloaded file exists, type **YES** and press Enter in the terminal. The setup intentionally stops before uploading any secrets if this backup hasn't been confirmed.
6. The task encrypts and configures all four GitHub **Actions** secrets in your repository and requests the next owner-signed Android TV APK build. Check **[Android TV APK builds](https://github.com/cj42izzle/Luma-Media-Center/actions/workflows/android-tv-apk.yml)** and verify the new release notes say **stable signing key**. Never publish your keystore or password.

**If you already created a Codespace before this task was added:** create a new Codespace from **main**, or update your existing one to the latest main branch, so the new Run Task menu entry appears.

**Important:** These are **Actions** secrets, not Codespaces secrets. GitHub does not make Codespaces secrets available to Actions.

**Migration backup limitation:** Luma's current Settings → Download backup includes watchlists, progress, and local library metadata, but **not IPTV provider account credentials or on-device DVR recordings**. Before uninstalling the old debug APK, record your provider address and login securely in your password manager and separately preserve any recordings you want to keep.

**First install only:** An old preview built with an ephemeral debug signing certificate cannot be replaced by an APK signed with this new owner key. Back up device-local Luma settings, uninstall the old preview, then install the freshly owner-signed APK. That is the *last migration install*. Later APKs signed with the same key and higher version codes can update in place through Android's installer approval. Web UI changes continue appearing on launch without an APK replacement.

The release workflow now stamps each official main-branch APK with a unique, monotonically increasing version code, so future native changes can be recognized without manually editing the version. Never share the keystore or its password. Once the private key has been backed up, delete the temporary Codespace if it is no longer needed.
