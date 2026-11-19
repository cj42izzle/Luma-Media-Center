package io.github.cj42izzle.luma;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.net.URI;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/** Exact-episode rerun matching across ALL IPTV channel/provider IDs. */
public final class DeviceDvrRetry {
    private static final String PREF = "luma_native_guide_cache_v1";
    private static final String CACHE = "airings";
    private static final int MAX_AIRINGS = 6000;
    private static final int MAX_BYTES = 3 * 1024 * 1024;

    private DeviceDvrRetry() {}

    private static String norm(String text) {
        return String.valueOf(text == null ? "" : text).toLowerCase(Locale.ROOT)
                .replaceAll("[^\\p{L}\\p{N}]+", " ").trim().replaceAll("\\s+", " ");
    }

    public static String identity(JSONObject row) {
        if (row == null) return "";
        String title = norm(row.optString("title"));
        if (title.isEmpty()) return "";
        String ep = norm(row.optString("episode"));
        if (ep.length() >= 4) return title + "|number:" + ep;
        String subtitle = norm(row.optString("subtitle"));
        if (subtitle.length() >= 8) return title + "|subtitle:" + subtitle;
        String desc = norm(row.optString("description"));
        if (desc.length() >= 36 && !desc.equals("no description available")
                && !desc.equals("information not available")) {
            return title + "|description:" + desc;
        }
        return "";
    }

    private static boolean streamUrl(String value) {
        try {
            URI u = new URI(value);
            return u.getHost() != null && u.getRawUserInfo() == null
                    && ("https".equalsIgnoreCase(u.getScheme()) || "http".equalsIgnoreCase(u.getScheme()))
                    && value.length() <= 4096;
        } catch (Exception ignored) { return false; }
    }

    /**
     * Sanitize a supplied guide snapshot from Luma's registered IPTV providers.
     * No network requests are issued and the snapshot stays on this device.
     */
    public static synchronized int saveGuide(Context context, JSONArray rows) throws JSONException {
        JSONArray clean = new JSONArray();
        long now = System.currentTimeMillis();
        int bytes = 0;
        for (int i = 0; i < Math.min(rows.length(), 25000); i++) {
            JSONObject p = rows.optJSONObject(i);
            if (p == null || !streamUrl(p.optString("url"))) continue;
            long start = p.optLong("start"), end = p.optLong("end");
            if (start < now - 60_000 || end <= start || start > now + 14L * 24 * 3600000
                    || end - start > 240L * 60000) continue;
            JSONObject data = new JSONObject()
                    .put("id", p.optString("id", "").substring(0, Math.min(140,p.optString("id", "").length())))
                    .put("title", p.optString("title", "").substring(0, Math.min(160,p.optString("title", "").length())))
                    .put("episode", p.optString("episode", "").substring(0, Math.min(90,p.optString("episode", "").length())))
                    .put("subtitle", p.optString("subtitle", "").substring(0, Math.min(170,p.optString("subtitle", "").length())))
                    .put("description", p.optString("description", "").substring(0, Math.min(420,p.optString("description", "").length())))
                    .put("channel_id", p.optString("channel_id", ""))
                    .put("channel", p.optString("channel", "Live TV"))
                    .put("quality", p.optInt("quality", 0))
                    .put("url", p.optString("url"))
                    .put("start", start).put("end", end);
            if (identity(data).isEmpty()) continue;
            String wire = data.toString();
            if (bytes + wire.length() > MAX_BYTES || clean.length() >= MAX_AIRINGS) break;
            bytes += wire.length();
            clean.put(data);
        }
        SharedPreferences pref = context.getApplicationContext().getSharedPreferences(PREF, Context.MODE_PRIVATE);
        if (!pref.edit().putString(CACHE, clean.toString()).commit()) {
            throw new IllegalStateException("Cannot persist guide retry listings");
        }
        return clean.length();
    }

    public static synchronized JSONArray loadGuide(Context ctx) {
        try {
            return new JSONArray(ctx.getApplicationContext()
                    .getSharedPreferences(PREF, Context.MODE_PRIVATE).getString(CACHE, "[]"));
        } catch (JSONException ignored) { return new JSONArray(); }
    }

    /**
     * Search all channels; choose earliest *whole* future broadcast. A listing
     * with the same title but a different episode number cannot qualify.
     */
    public static JSONObject next(JSONObject original, JSONArray guide, JSONArray jobs, long now) {
        String target = original.optString("episode_key");
        if (target.isEmpty()) target = identity(original);
        if (target.isEmpty()) return null;
        String root = original.optString("retry_root", original.optString("id"));
        Set<String> attemptedIds = new HashSet<>();
        for (int i = 0; i < jobs.length(); i++) {
            JSONObject j = jobs.optJSONObject(i);
            if (j == null) continue;
            String recordRoot = j.optString("retry_root", j.optString("id"));
            if (root.equals(recordRoot)) attemptedIds.add(j.optString("program_id"));
        }
        JSONObject best = null;
        for (int i = 0; i < guide.length(); i++) {
            JSONObject entry = guide.optJSONObject(i);
            if (entry == null || !target.equals(identity(entry))) continue;
            if (entry.optLong("start") < now + 5000L || entry.optLong("end") <= entry.optLong("start")) continue;
            if (attemptedIds.contains(entry.optString("id"))) continue;
            if (!streamUrl(entry.optString("url"))) continue;
            if (best == null || entry.optLong("start") < best.optLong("start")
                    || (entry.optLong("start") == best.optLong("start")
                    && entry.optInt("quality") > best.optInt("quality"))) best = entry;
        }
        return best;
    }
}
