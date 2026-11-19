package io.github.cj42izzle.luma;

import android.content.Intent;
import android.net.Uri;
import android.webkit.JavascriptInterface;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** Trusted-Luma-only bridge from the site to native ExoPlayer playback.
 *  A random per-session token prevents arbitrary iframes from launching streams.
 *  It does not intercept IPTV accounts or write credentials to logs.
 */
public final class NativePlayerBridge {
    private final TvActivity activity;
    private final String token;

    NativePlayerBridge(TvActivity activity, String token) {
        this.activity = activity;
        this.token = token;
    }
    private String response(boolean ok, String detail) {
        try { return new JSONObject().put("ok", ok).put("error", detail).toString(); }
        catch(Exception ignored){return "{\"ok\":false}";}
    }
    @JavascriptInterface
    public String play(String key, String url, String title) {
        if (!activity.isTrustedPage() || key == null
                || !MessageDigest.isEqual(key.getBytes(StandardCharsets.UTF_8),
                      token.getBytes(StandardCharsets.UTF_8))) {
            return response(false, "Only the trusted Luma website can open its native player");
        }
        if (url == null || url.length() > 6000) return response(false, "Invalid stream URL");
        Uri uri;
        try { uri = Uri.parse(url); }
        catch (Exception ignored) { return response(false, "Invalid stream URL"); }
        String scheme = uri.getScheme();
        if (scheme == null || !(scheme.equalsIgnoreCase("https") || scheme.equalsIgnoreCase("http"))
                || uri.getHost() == null || uri.getHost().isEmpty()
                || uri.getUserInfo() != null) return response(false, "Only HTTP(S) media streams can be opened");
        final String label = title == null ? "Luma Live TV" : title.substring(0, Math.min(title.length(), 160));
        activity.runOnUiThread(() -> {
            Intent intent = new Intent(activity, NativePlayerActivity.class);
            intent.putExtra(NativePlayerActivity.EXTRA_URL, url);
            intent.putExtra(NativePlayerActivity.EXTRA_TITLE, label);
            activity.startActivity(intent);
        });
        return response(true, "");
    }
}
