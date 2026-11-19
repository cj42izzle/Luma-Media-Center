package io.github.cj42izzle.luma;

import android.net.Uri;
import android.webkit.JavascriptInterface;
import org.json.JSONException;
import org.json.JSONObject;

import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;

/**
 * Native DVR methods callable only with the unpredictable token injected into
 * Luma's trusted top-level page. No recorder credentials leave the TV.
 */
public final class DeviceDvrBridge {
    private final TvActivity activity;
    private final String token;

    DeviceDvrBridge(TvActivity activity, String token) {
        this.activity = activity;
        this.token = token;
    }

    private boolean authorized(String provided) {
        return activity.isTrustedPage() && MessageDigest.isEqual(
                token.getBytes(StandardCharsets.UTF_8),
                String.valueOf(provided).getBytes(StandardCharsets.UTF_8));
    }

    private String error(String message) {
        try { return new JSONObject().put("ok", false).put("error", message).toString(); }
        catch (JSONException ignored) { return "{\"ok\":false,\"error\":\"Unavailable\"}"; }
    }

    @JavascriptInterface public String status(String key) {
        if (!authorized(key)) return error("Native recording is unavailable on this page");
        try {
            JSONObject state = DeviceDvrStore.list(activity);
            state.put("native", true);
            state.put("max_minutes", 240);
            state.put("always_on", "Device must remain powered on; background scheduling may be delayed by Android");
            return state.toString();
        } catch (Exception e) {
            return error("Could not read device recording storage");
        }
    }

    @JavascriptInterface public String list(String key) {
        if (!authorized(key)) return error("Unauthorized DVR access");
        try { return DeviceDvrStore.list(activity).toString(); }
        catch (Exception e) { return error("Cannot read DVR history"); }
    }

    @JavascriptInterface public String schedule(String key, String request) {
        if (!authorized(key)) return error("Unauthorized DVR access");
        try {
            if (request == null || request.length() > 10000) return error("Invalid recording request");
            return DeviceDvrStore.schedule(activity, new JSONObject(request)).toString();
        } catch (Exception e) {
            return error(e instanceof IllegalArgumentException ? String.valueOf(e.getMessage())
                    : "Could not schedule native device recording");
        }
    }

    @JavascriptInterface public String cancel(String key, String id) {
        if (!authorized(key)) return error("Unauthorized DVR access");
        try { return DeviceDvrStore.cancel(activity, id).toString(); }
        catch (Exception e) { return error(e instanceof IllegalArgumentException
                ? String.valueOf(e.getMessage()) : "Could not cancel recording"); }
    }

    @JavascriptInterface public String chooseFolder(String key) {
        if (!authorized(key)) return error("Unauthorized DVR access");
        try {
            activity.runOnUiThread(activity::launchDvrFolderPicker);
            return new JSONObject().put("ok", true).put("pending", true).toString();
        } catch (Exception e) {
            return error("Cannot open device storage picker");
        }
    }

    @JavascriptInterface public String open(String key, String id) {
        if (!authorized(key)) return error("Unauthorized DVR access");
        JSONObject job = DeviceDvrStore.get(activity, id);
        if (job == null) return error("Recording not found");
        String uri = job.optString("file", "");
        if (!uri.startsWith("content://")) return error("Open this file in your device's Files app");
        activity.runOnUiThread(() -> activity.openRecordedFile(Uri.parse(uri)));
        try { return new JSONObject().put("ok", true).toString(); }
        catch (JSONException ignored) { return error("Unable to open recording"); }
    }
}
