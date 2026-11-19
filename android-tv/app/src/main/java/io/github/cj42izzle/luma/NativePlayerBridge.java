package io.github.cj42izzle.luma;

import android.content.Intent;
import android.net.Uri;
import android.webkit.JavascriptInterface;
import org.json.JSONObject;
import org.json.JSONArray;
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
    public String openFile(String key) {
        if (!activity.isTrustedPage() || key == null
                || !MessageDigest.isEqual(key.getBytes(StandardCharsets.UTF_8),
                      token.getBytes(StandardCharsets.UTF_8))) {
            return response(false, "Only the trusted Luma website can open device video files");
        }
        activity.runOnUiThread(activity::launchNativeMediaPicker);
        return response(true, "");
    }

    /** Deliver a bounded IPTV channel list to ExoPlayer. The selected channel
     * must match the indexed item, and all streams must be HTTP(S) URLs.
     * Sensitive stream URLs stay inside this app's private intent.
     */
    @JavascriptInterface
    public String playQueue(String key, String url, String title, String json, int current) {
        if (!activity.isTrustedPage() || key == null ||
            !MessageDigest.isEqual(key.getBytes(StandardCharsets.UTF_8),
                    token.getBytes(StandardCharsets.UTF_8))) {
            return response(false, "Native player access denied");
        }
        if (url == null || json == null || json.length() > 110000)
            return response(false, "Invalid IPTV queue");
        try {
            JSONArray items = new JSONArray(json);
            if (items.length() < 2 || items.length() > 41 || current < 0 || current >= items.length())
                return response(false, "Choose a channel from the valid playlist");
            for (int i = 0; i < items.length(); i++) {
                JSONObject item = items.getJSONObject(i);
                String stream = item.optString("url", "");
                Uri uri = Uri.parse(stream);
                String scheme = uri.getScheme();
                if (stream.length() > 6000 || scheme == null ||
                    !(scheme.equalsIgnoreCase("https") || scheme.equalsIgnoreCase("http")) ||
                    uri.getHost() == null || uri.getHost().isEmpty() || uri.getUserInfo() != null)
                    return response(false, "Unsupported channel URL");
            }
            if (!url.equals(items.getJSONObject(current).optString("url", "")))
                return response(false, "Selected channel does not match this queue");
            final String label = title == null ? "Luma Live TV" :
                title.substring(0, Math.min(title.length(), 160));
            activity.runOnUiThread(() -> {
                Intent intent = new Intent(activity, NativePlayerActivity.class);
                intent.putExtra(NativePlayerActivity.EXTRA_URL, url);
                intent.putExtra(NativePlayerActivity.EXTRA_TITLE, label);
                intent.putExtra(NativePlayerActivity.EXTRA_QUEUE, json);
                intent.putExtra(NativePlayerActivity.EXTRA_INDEX, current);
                activity.startActivity(intent);
            });
            return response(true, "");
        } catch (Exception error) {
            return response(false, "Invalid IPTV playlist");
        }
    }

    @JavascriptInterface
    public String play(String key, String url, String title) {
        return playWithSkips(key, url, title, "");
    }

    /** Skip hints are numeric chapter or user-confirmed times, never guessed media ranges. */
    @JavascriptInterface
    public String playWithSkips(String key, String url, String title, String skipJson) {
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
        if (skipJson != null && skipJson.length() > 2500) return response(false, "Skip metadata too large");
        final String safeSkips = skipJson == null ? "" : skipJson;
        final String label = title == null ? "Luma Live TV" : title.substring(0, Math.min(title.length(), 160));
        activity.runOnUiThread(() -> {
            Intent intent = new Intent(activity, NativePlayerActivity.class);
            intent.putExtra(NativePlayerActivity.EXTRA_URL, url);
            intent.putExtra(NativePlayerActivity.EXTRA_TITLE, label);
            intent.putExtra(NativePlayerActivity.EXTRA_SKIP, safeSkips);
            activity.startActivity(intent);
        });
        return response(true, "");
    }
}
