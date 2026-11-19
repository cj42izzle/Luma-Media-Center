package io.github.cj42izzle.luma;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.net.URI;
import java.util.UUID;

/** Durable, owner-controlled on-device DVR jobs. No remote server is necessary. */
public final class DeviceDvrStore {
    private static final String PREF = "luma_native_dvr_v1";
    private static final String JOBS = "jobs";
    private static final String FOLDER = "folder";
    private static final int MAX_JOBS = 400;

    private DeviceDvrStore() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREF, Context.MODE_PRIVATE);
    }

    public static synchronized String folder(Context ctx) {
        return prefs(ctx).getString(FOLDER, "");
    }

    public static synchronized void setFolder(Context ctx, Uri selected) {
        prefs(ctx).edit().putString(FOLDER, selected == null ? "" : selected.toString()).commit();
    }

    private static JSONArray read(Context ctx) {
        try {
            return new JSONArray(prefs(ctx).getString(JOBS, "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    private static void write(Context ctx, JSONArray data) {
        if (!prefs(ctx).edit().putString(JOBS, data.toString()).commit()) {
            throw new IllegalStateException("Device DVR storage is not writable");
        }
    }

    private static JSONObject findIn(JSONArray records, String id) {
        for (int i = 0; i < records.length(); i++) {
            JSONObject row = records.optJSONObject(i);
            if (row != null && id.equals(row.optString("id"))) return row;
        }
        return null;
    }

    public static synchronized JSONObject get(Context ctx, String id) {
        JSONObject row = findIn(read(ctx), id);
        if (row == null) return null;
        try { return new JSONObject(row.toString()); }
        catch (JSONException ignored) { return null; }
    }

    public static synchronized JSONObject list(Context ctx) throws JSONException {
        JSONArray raw = read(ctx), clean = new JSONArray();
        for (int i = 0; i < raw.length(); i++) {
            JSONObject record = raw.optJSONObject(i);
            if (record == null) continue;
            // Never return credential-bearing playlist URLs to the guide history.
            JSONObject visible = new JSONObject();
            for (String k : new String[]{"id", "title", "channel", "episode", "subtitle", "start", "end", "status", "file", "error", "retry_pending", "retry_root", "retry_attempt", "retry_job_id", "processing", "saved_bytes", "episode_key", "program_id"}) {
                if (record.has(k)) visible.put(k, record.opt(k));
            }
            clean.put(visible);
        }
        return new JSONObject().put("ok", true).put("jobs", clean)
                .put("folder_selected", !folder(ctx).isEmpty())
                .put("storage", folder(ctx).isEmpty() ? "Movies/Luma Recordings" : "Chosen device folder");
    }

    public static synchronized JSONObject schedule(Context ctx, JSONObject request) throws Exception {
        String url = request.optString("url", "").trim();
        URI parsed = new URI(url);
        String scheme = parsed.getScheme();
        if ((!"https".equalsIgnoreCase(scheme) && !"http".equalsIgnoreCase(scheme))
                || parsed.getHost() == null || parsed.getRawUserInfo() != null || url.length() > 4096) {
            throw new IllegalArgumentException("A valid HTTP(S) IPTV stream is required");
        }
        long now = System.currentTimeMillis();
        long start = request.optLong("start", now);
        long end = request.optLong("end", start + 60 * 60 * 1000L);
        if (start < now - 60_000L) start = now;
        if (start > now + 14L * 24 * 60 * 60 * 1000) {
            throw new IllegalArgumentException("Native DVR can schedule up to 14 days ahead");
        }
        if (end <= now || end <= start || end - start > 240L * 60_000L) {
            throw new IllegalArgumentException("Native recording duration must be 1–240 minutes");
        }
        JSONArray jobs = read(ctx);
        if (jobs.length() >= MAX_JOBS) throw new IllegalArgumentException("Device recording queue is full");
        String title = request.optString("title", "TV Recording").trim();
        String channel = request.optString("channel", "Live TV").trim();
        String id = UUID.randomUUID().toString();
        JSONObject job = new JSONObject()
                .put("id", id)
                .put("title", title.isEmpty() ? "TV Recording" : title.substring(0, Math.min(title.length(), 150)))
                .put("channel", channel.substring(0, Math.min(channel.length(), 100)))
                .put("episode", request.optString("episode", "").substring(0, Math.min(request.optString("episode", "").length(), 80)))
                .put("url", url).put("start", start).put("end", end)
                .put("subtitle", request.optString("subtitle", ""))
                .put("description", request.optString("description", ""))
                .put("program_id", request.optString("program_id", ""))
                .put("status", "scheduled").put("file", "").put("error", "")
                .put("processing", "pending").put("retry_pending", false)
                .put("retry_attempt", request.optInt("retry_attempt", 0));
        String sourceId = request.optString("retry_root", "");
        if (!sourceId.isEmpty()) job.put("retry_root", sourceId);
        String strongIdentity = DeviceDvrRetry.identity(job);
        if (!strongIdentity.isEmpty()) job.put("episode_key", strongIdentity);
        jobs.put(job);
        write(ctx, jobs);
        String timing = scheduleAlarm(ctx, job);
        return new JSONObject().put("ok", true).put("id", id)
                .put("start", start).put("end", end).put("timing", timing);
    }

    private static PendingIntent alarmIntent(Context ctx, String id) {
        Intent intent = new Intent(ctx, DeviceDvrAlarmReceiver.class);
        intent.setAction("io.github.cj42izzle.luma.DVR_START");
        intent.setData(Uri.parse("luma-dvr://recording/" + id));
        return PendingIntent.getBroadcast(ctx, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    public static String scheduleAlarm(Context ctx, JSONObject job) {
        long start = job.optLong("start");
        String id = job.optString("id");
        AlarmManager alarm = (AlarmManager)ctx.getSystemService(Context.ALARM_SERVICE);
        if (alarm == null) throw new IllegalStateException("Alarm service unavailable");
        PendingIntent pending = alarmIntent(ctx, id);
        long at = Math.max(System.currentTimeMillis() + 250L, start);
        try {
            if (Build.VERSION.SDK_INT < 31 || alarm.canScheduleExactAlarms()) {
                if (Build.VERSION.SDK_INT >= 23) alarm.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
                else alarm.setExact(AlarmManager.RTC_WAKEUP, at, pending);
                return "exact";
            }
        } catch (SecurityException ignored) {
            // Some Android TV devices disallow exact alarms. Schedule best-effort.
        }
        if (Build.VERSION.SDK_INT >= 23) alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
        else alarm.set(AlarmManager.RTC_WAKEUP, at, pending);
        return "approximate";
    }

    public static synchronized void change(Context ctx, String id, String status, String file, String error) {
        JSONArray jobs = read(ctx);
        JSONObject row = findIn(jobs, id);
        if (row == null) return;
        try {
            row.put("status", status);
            if (file != null) row.put("file", file);
            if (error != null) row.put("error", error);
            write(ctx, jobs);
        } catch (JSONException ignored) {}
    }

    public static synchronized void processing(Context ctx, String id, String state, long saved, String updatedFile) {
        JSONArray jobs = read(ctx);
        JSONObject job = findIn(jobs, id);
        if (job == null) return;
        try {
            job.put("processing", state);
            if (saved > 0) job.put("saved_bytes", saved);
            if (updatedFile != null && !updatedFile.isEmpty()) job.put("file", updatedFile);
            write(ctx, jobs);
        } catch (JSONException ignored) {}
    }

    /** Called whenever the browser refreshes guide listings or a capture fails.
     * Source names and IPTV URLs are kept exclusively in private app storage.
     */
    public static synchronized int syncGuide(Context ctx, JSONArray guide) throws JSONException {
        int count = DeviceDvrRetry.saveGuide(ctx, guide);
        queueRetries(ctx);
        return count;
    }

    /**
     * Search every cached EPG channel and every connected IPTV provider.
     * No same-channel or same-day restriction; require an exact episode key.
     */
    public static synchronized void queueRetries(Context ctx) {
        JSONArray jobs = read(ctx), guide = DeviceDvrRetry.loadGuide(ctx);
        long now = System.currentTimeMillis();
        java.util.HashSet<String> roots = new java.util.HashSet<>();
        for (int i = 0; i < jobs.length(); i++) {
            JSONObject job = jobs.optJSONObject(i);
            if (job == null) continue;
            roots.add(job.optString("retry_root", job.optString("id")));
        }
        for (String root : roots) {
            JSONObject source = findIn(jobs, root);
            if (source == null) continue;
            JSONObject latestBad = null;
            boolean queued = false, completed = false;
            int attempts = 0;
            for (int i = 0; i < jobs.length(); i++) {
                JSONObject job = jobs.optJSONObject(i);
                if (job == null || !root.equals(job.optString("retry_root", job.optString("id")))) continue;
                attempts++;
                String status = job.optString("status");
                if (status.equals("complete")) completed = true;
                if (status.equals("scheduled") || status.equals("recording")) queued = true;
                if (status.equals("failed") || status.equals("partial")
                        || status.equals("missed") || status.equals("interrupted")) latestBad = job;
            }
            if (queued || completed || latestBad == null || attempts > 5) continue;
            if (source.optString("episode_key").isEmpty()) continue; // Refuse uncertain episode guesses.
            JSONObject candidate = DeviceDvrRetry.next(source, guide, jobs, now);
            if (candidate == null) {
                try { source.put("retry_pending", true); } catch (JSONException ignored) {}
                write(ctx, jobs);
                continue;
            }
            try {
                JSONObject req = new JSONObject()
                        .put("url", candidate.getString("url"))
                        .put("title", candidate.getString("title"))
                        .put("channel", candidate.getString("channel"))
                        .put("episode", candidate.optString("episode"))
                        .put("subtitle", candidate.optString("subtitle"))
                        .put("description", candidate.optString("description"))
                        .put("program_id", candidate.optString("id"))
                        .put("retry_root", root).put("retry_attempt", attempts)
                        .put("start", candidate.getLong("start")).put("end", candidate.getLong("end"));
                JSONObject created = schedule(ctx, req);
                jobs = read(ctx);
                source = findIn(jobs, root);
                if (source != null) {
                    source.put("retry_pending", false);
                    source.put("retry_job_id", created.optString("id"));
                    write(ctx, jobs);
                }
            } catch (Exception ignored) {
                // Preserve the failed original. A later guide sync can reattempt.
            }
        }
    }

    public static synchronized JSONObject cancel(Context ctx, String id) throws JSONException {
        JSONArray jobs = read(ctx);
        JSONObject row = findIn(jobs, id);
        if (row == null) throw new IllegalArgumentException("Recording not found");
        String status = row.optString("status");
        if (!status.equals("scheduled") && !status.equals("recording")) {
            throw new IllegalArgumentException("Only scheduled or active recordings can be cancelled");
        }
        row.put("status", "cancelled");
        write(ctx, jobs);
        AlarmManager alarm = (AlarmManager)ctx.getSystemService(Context.ALARM_SERVICE);
        if (alarm != null) alarm.cancel(alarmIntent(ctx, id));
        return new JSONObject().put("ok", true).put("id", id);
    }

    /** Re-arm future alarms on permission grants or app resume without changing active jobs. */
    public static synchronized void reschedulePending(Context ctx) {
        JSONArray jobs = read(ctx);
        long now = System.currentTimeMillis();
        boolean changed = false;
        for (int i = 0; i < jobs.length(); i++) {
            JSONObject job = jobs.optJSONObject(i);
            if (job == null || !"scheduled".equals(job.optString("status"))) continue;
            if (job.optLong("end") <= now) {
                try { job.put("status", "missed"); } catch (JSONException ignored) {}
                changed = true;
            } else {
                try { scheduleAlarm(ctx, job); } catch (RuntimeException ignored) {
                    // Keep the saved recording for a subsequent permission change.
                }
            }
        }
        if (changed) write(ctx, jobs);
        queueRetries(ctx);
    }

    public static synchronized void rescheduleAfterBoot(Context ctx) {
        JSONArray jobs = read(ctx);
        long now = System.currentTimeMillis();
        boolean dirty = false;
        for (int i = 0; i < jobs.length(); i++) {
            JSONObject job = jobs.optJSONObject(i);
            if (job == null) continue;
            String status = job.optString("status");
            if (status.equals("recording")) {
                try { job.put("status", "interrupted"); } catch (JSONException ignored) {}
                dirty = true;
            } else if (status.equals("scheduled") && job.optLong("end") <= now) {
                try { job.put("status", "missed"); } catch (JSONException ignored) {}
                dirty = true;
            } else if (status.equals("scheduled")) {
                try { scheduleAlarm(ctx, job); } catch (Exception ignored) {}
            }
        }
        if (dirty) write(ctx, jobs);
        queueRetries(ctx);
    }
}
