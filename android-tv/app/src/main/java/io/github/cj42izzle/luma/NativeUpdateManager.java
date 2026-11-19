package io.github.cj42izzle.luma;

import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Trusted GitHub-release updater for the installed Luma Android TV APK.
 * No silent installs, no custom APK hosts, no private signing keys in source.
 * Android always retains final control over permission and installation.
 */
public final class NativeUpdateManager {
    private static final String APK_URL =
            "https://github.com/cj42izzle/Luma-Media-Center/releases/download/android-tv-preview/Luma-AndroidTV-Preview.apk";
    private static final String MANIFEST_URL =
            "https://github.com/cj42izzle/Luma-Media-Center/releases/download/android-tv-preview/Luma-AndroidTV-Update.json";
    private static final long MAX_APK_BYTES = 80L * 1024L * 1024L;
    private static final long CHECK_INTERVAL_MS = 60L * 60L * 1000L;
    private static final long REMIND_INTERVAL_MS = 24L * CHECK_INTERVAL_MS;

    private final TvActivity activity;
    private final String token;
    private final ExecutorService executor = Executors.newSingleThreadExecutor(r -> {
        Thread thread = new Thread(r, "Luma-Android-Updater");
        thread.setDaemon(true);
        return thread;
    });
    private final AtomicBoolean checking = new AtomicBoolean(false);
    private final AtomicBoolean downloading = new AtomicBoolean(false);
    private final SharedPreferences settings;
    private File pendingPackage;

    NativeUpdateManager(TvActivity activity, String token) {
        this.activity = activity;
        this.token = token;
        this.settings = activity.getSharedPreferences("luma.native.update", 0);
    }

    @JavascriptInterface
    public void check(String supplied) {
        if (!activity.isTrustedPage() || supplied == null ||
                !MessageDigest.isEqual(token.getBytes(StandardCharsets.UTF_8),
                        supplied.getBytes(StandardCharsets.UTF_8))) return;
        activity.runOnUiThread(() -> checkForUpdates(true));
    }

    private boolean isAlive() {
        return !activity.isFinishing() && !activity.isDestroyed();
    }

    private void toast(String message) {
        activity.runOnUiThread(() -> {
            if (isAlive()) Toast.makeText(activity, message, Toast.LENGTH_LONG).show();
        });
    }

    void onResume() {
        if (pendingPackage != null && canRequestInstalls()) {
            File ready = pendingPackage;
            pendingPackage = null;
            launchInstaller(ready);
        }
        checkForUpdates(false);
    }

    void checkForUpdates(boolean manual) {
        long now = System.currentTimeMillis();
        if (!manual && now - settings.getLong("lastAttemptMs", 0) < CHECK_INTERVAL_MS) return;
        if (!checking.compareAndSet(false, true)) {
            if (manual) toast("Luma is already checking for an update.");
            return;
        }
        settings.edit().putLong("lastAttemptMs", now).apply();
        executor.execute(() -> {
            try {
                Release release = fetchRelease();
                if (release.versionCode <= installedVersionCode()) {
                    if (manual) toast("Luma is running the newest published Android TV APK.");
                } else {
                    long sincePrompt = now - settings.getLong("lastPromptMs", 0);
                    int lastVersion = settings.getInt("lastPromptVersion", 0);
                    if (manual || release.versionCode != lastVersion ||
                            sincePrompt > REMIND_INTERVAL_MS) {
                        activity.runOnUiThread(() -> promptDownload(release));
                    }
                }
            } catch (Exception ignored) {
                if (manual) toast("Unable to check GitHub for Luma updates. Check the TV connection and retry.");
            } finally {
                checking.set(false);
            }
        });
    }

    private long installedVersionCode() throws Exception {
        android.content.pm.PackageInfo info =
                activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0);
        return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
    }

    private static final class Release {
        final int versionCode;
        final String versionName;
        final String sha256;
        final String signing;
        Release(int versionCode, String versionName, String sha256, String signing) {
            this.versionCode = versionCode;
            this.versionName = versionName;
            this.sha256 = sha256;
            this.signing = signing;
        }
    }

    private Release fetchRelease() throws Exception {
        HttpURLConnection connection = openTrusted(MANIFEST_URL);
        try (InputStream in = connection.getInputStream();
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[2048];
            int size;
            while ((size = in.read(buffer)) >= 0) {
                if (out.size() + size > 8192) throw new IOException("Update manifest too large");
                out.write(buffer, 0, size);
            }
            JSONObject data = new JSONObject(out.toString(StandardCharsets.UTF_8.name()));
            int code = data.optInt("version_code", 0);
            String sha = data.optString("sha256", "").toLowerCase(Locale.ROOT);
            String url = data.optString("apk_url", "");
            String name = data.optString("version_name", "").replaceAll("[^a-zA-Z0-9._-]", "");
            String signing = data.optString("signing", "preview-debug");
            if (code < 1 || !sha.matches("[0-9a-f]{64}") ||
                    !APK_URL.equals(url) || name.isEmpty() || name.length() > 60 ||
                    !("stable".equals(signing) || "preview-debug".equals(signing)))
                throw new IOException("Invalid Luma update manifest");
            return new Release(code, name, sha, signing);
        } finally {
            connection.disconnect();
        }
    }

    private static boolean isTrustedDownloadHost(URL url) {
        String host = url.getHost().toLowerCase(Locale.ROOT);
        return "https".equalsIgnoreCase(url.getProtocol()) &&
                ("github.com".equals(host) || host.endsWith(".githubusercontent.com"));
    }

    private static HttpURLConnection openTrusted(String raw) throws IOException {
        URL url = new URL(raw);
        for (int redirects = 0; redirects <= 6; redirects++) {
            if (!isTrustedDownloadHost(url)) throw new IOException("Untrusted update host");
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(25000);
            connection.setRequestProperty("User-Agent", "LumaAndroidTV-Updater");
            connection.setRequestProperty("Accept-Encoding", "identity");
            int status = connection.getResponseCode();
            if (status == 301 || status == 302 || status == 303 ||
                    status == 307 || status == 308) {
                String target = connection.getHeaderField("Location");
                connection.disconnect();
                if (target == null) throw new IOException("Missing update redirect");
                url = new URL(url, target);
                continue;
            }
            if (status != 200) {
                connection.disconnect();
                throw new IOException("Update download unavailable");
            }
            return connection;
        }
        throw new IOException("Too many update redirects");
    }

    private void promptDownload(Release release) {
        if (!isAlive()) return;
        settings.edit().putLong("lastPromptMs", System.currentTimeMillis())
                .putInt("lastPromptVersion", release.versionCode).apply();
        String note = "Version " + release.versionName + " is available. "
                + "Luma will download and verify the official GitHub APK, "
                + "then Android will ask you to approve installation.";
        if ("preview-debug".equals(release.signing)) {
            note += "\n\nThis preview may use a different signing certificate than your "
                    + "current installation. If Android refuses the update, export "
                    + "your Luma backup before uninstalling the older app.";
        }
        new AlertDialog.Builder(activity)
                .setTitle("Luma Android TV update")
                .setMessage(note)
                .setNegativeButton("Later", (dialog, which) -> {})
                .setPositiveButton("Download update", (dialog, which) -> download(release))
                .show();
    }

    private void download(Release release) {
        if (!downloading.compareAndSet(false, true)) {
            toast("A Luma update is already downloading.");
            return;
        }
        toast("Downloading the verified Luma Android TV update…");
        executor.execute(() -> {
            File part = null;
            try {
                File directory = new File(activity.getCacheDir(), "updates");
                if (!directory.isDirectory() && !directory.mkdirs())
                    throw new IOException("Cannot create update storage");
                part = new File(directory, "luma-update.part");
                File ready = new File(directory, "luma-update.apk");
                HttpURLConnection connection = openTrusted(APK_URL);
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                long bytes = 0;
                try {
                    if (connection.getContentLengthLong() > MAX_APK_BYTES)
                        throw new IOException("APK is too large");
                    try (InputStream input = connection.getInputStream();
                         FileOutputStream output = new FileOutputStream(part)) {
                        byte[] buffer = new byte[32768];
                        int size;
                        while ((size = input.read(buffer)) >= 0) {
                            bytes += size;
                            if (bytes > MAX_APK_BYTES) throw new IOException("APK limit exceeded");
                            digest.update(buffer, 0, size);
                            output.write(buffer, 0, size);
                        }
                    }
                } finally {
                    connection.disconnect();
                }
                StringBuilder hash = new StringBuilder();
                for (byte value : digest.digest())
                    hash.append(String.format(Locale.ROOT, "%02x", value & 0xff));
                if (bytes < 10000 || !release.sha256.equals(hash.toString()))
                    throw new IOException("Downloaded APK did not match the official release checksum");
                if (ready.exists() && !ready.delete())
                    throw new IOException("Cannot replace previous downloaded APK");
                if (!part.renameTo(ready))
                    throw new IOException("Cannot prepare downloaded APK");
                activity.runOnUiThread(() -> {
                    if (isAlive()) promptInstall(ready, release);
                });
            } catch (Exception ignored) {
                if (part != null) part.delete();
                toast("Luma couldn't verify or install this update. Your existing app is unchanged.");
            } finally {
                downloading.set(false);
            }
        });
    }

    private boolean canRequestInstalls() {
        return Build.VERSION.SDK_INT < 26 ||
                activity.getPackageManager().canRequestPackageInstalls();
    }

    private void promptInstall(File ready, Release release) {
        if (!isAlive()) return;
        new AlertDialog.Builder(activity)
                .setTitle("Verified APK ready")
                .setMessage("Downloaded and SHA-256 verified Luma " + release.versionName
                        + ". Android will ask for installation approval and check the app signature.")
                .setPositiveButton("Open Android installer", (dialog, which) -> launchInstaller(ready))
                .setNegativeButton("Not now", (dialog, which) -> {})
                .show();
    }

    private void launchInstaller(File apk) {
        if (!isAlive() || !apk.exists()) return;
        if (!canRequestInstalls()) {
            pendingPackage = apk;
            try {
                Intent settingsIntent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + activity.getPackageName()));
                activity.startActivity(settingsIntent);
                toast("Allow installs from Luma, then return to finish the update.");
            } catch (Exception ignored) {
                toast("Android has blocked APK installation on this TV.");
            }
            return;
        }
        try {
            Uri contentUri = FileProvider.getUriForFile(activity,
                    activity.getPackageName() + ".updates", apk);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(contentUri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            activity.startActivity(intent);
        } catch (Exception ignored) {
            toast("Android could not open the package installer. You can use the direct APK download instead.");
        }
    }

    void shutdown() {
        executor.shutdownNow();
    }
}
