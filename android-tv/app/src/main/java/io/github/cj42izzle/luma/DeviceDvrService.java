package io.github.cj42izzle.luma;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Environment;
import android.os.IBinder;
import android.os.PowerManager;
import android.provider.DocumentsContract;
import android.provider.MediaStore;

import org.json.JSONObject;
import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Background local recorder for directly accessible user-provided HTTP(S)
 * MPEG-TS and standard unencrypted HLS/TS streams. No server, transcoder or
 * proprietary IPTV service is needed. This does not bypass DRM.
 */
public final class DeviceDvrService extends Service {
    private static final String NOTIFICATION_CHANNEL = "luma_dvr";
    private static final int NOTIFICATION_ID = 8763;
    private final ExecutorService workers = Executors.newFixedThreadPool(2);
    private final AtomicInteger active = new AtomicInteger(0);

    @Override public IBinder onBind(Intent intent) { return null; }

    private void foreground() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(NOTIFICATION_CHANNEL,
                    "Luma DVR recordings", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Recording authorised TV streams to device storage");
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, NOTIFICATION_CHANNEL)
                : new Notification.Builder(this);
        Notification note = builder.setContentTitle("Luma DVR recording")
                .setContentText("Saving live television to this device")
                .setSmallIcon(android.R.drawable.stat_sys_download)
                .setOngoing(true).build();
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else startForeground(NOTIFICATION_ID, note);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String id = intent == null ? "" : intent.getStringExtra("job_id");
        if (id == null || id.isEmpty()) {
            stopSelfResult(startId);
            return START_NOT_STICKY;
        }
        JSONObject job = DeviceDvrStore.get(this, id);
        if (job == null || !"scheduled".equals(job.optString("status"))) {
            stopSelfResult(startId);
            return START_NOT_STICKY;
        }
        try { foreground(); }
        catch (RuntimeException e) {
            DeviceDvrStore.change(this, id, "failed", null, "Unable to start foreground recording");
            stopSelfResult(startId);
            return START_NOT_STICKY;
        }
        if (active.incrementAndGet() > 2) {
            active.decrementAndGet();
            DeviceDvrStore.change(this, id, "failed", null, "This device supports two simultaneous recordings");
            return START_NOT_STICKY;
        }
        workers.execute(() -> {
            try { record(job); }
            finally {
                if (active.decrementAndGet() == 0) stopSelf();
            }
        });
        return START_NOT_STICKY;
    }

    private static boolean validStream(URL url) {
        String proto = url.getProtocol().toLowerCase(Locale.ROOT);
        return (proto.equals("https") || proto.equals("http")) && !url.getHost().isEmpty()
                && url.getUserInfo() == null;
    }

    private static HttpURLConnection open(URL url) throws Exception {
        if (!validStream(url)) throw new IllegalArgumentException("Unsupported stream URL");
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(20000);
        connection.setInstanceFollowRedirects(true);
        connection.setRequestProperty("User-Agent", "LumaDVR/1.0");
        connection.setRequestProperty("Accept", "*/*");
        int status = connection.getResponseCode();
        if (status < 200 || status >= 300) {
            connection.disconnect();
            throw new IllegalStateException("IPTV source rejected stream access");
        }
        return connection;
    }

    private static final class Destination {
        Uri uri;
        File file;
        OutputStream stream;
        long bytes;
        long mediaDurationMs;
        boolean incompleteSegment;
        void close() {
            try { if (stream != null) stream.close(); } catch (Exception ignored) {}
        }
    }

    private Destination createDestination(String name, boolean mp4) throws Exception {
        String title = name.replaceAll("[^\\p{L}\\p{N}_. -]+", "_").trim();
        if (title.isEmpty()) title = "Luma Recording";
        if (title.length() > 75) title = title.substring(0, 75);
        String filename = title + " - " + System.currentTimeMillis() + (mp4 ? ".mp4" : ".ts");
        String mime = mp4 ? "video/mp4" : "video/mp2t";
        Destination out = new Destination();
        String picked = DeviceDvrStore.folder(this);
        ContentResolver resolver = getContentResolver();
        if (!picked.isEmpty() && Build.VERSION.SDK_INT >= 21) {
            Uri tree = Uri.parse(picked);
            Uri parent = DocumentsContract.buildDocumentUriUsingTree(
                    tree, DocumentsContract.getTreeDocumentId(tree));
            out.uri = DocumentsContract.createDocument(resolver, parent, mime, filename);
            if (out.uri == null) throw new IllegalStateException("Selected folder is not writable");
            out.stream = resolver.openOutputStream(out.uri, "w");
        } else if (Build.VERSION.SDK_INT >= 29) {
            ContentValues fields = new ContentValues();
            fields.put(MediaStore.Video.Media.DISPLAY_NAME, filename);
            fields.put(MediaStore.Video.Media.MIME_TYPE, mime);
            fields.put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/Luma Recordings");
            fields.put(MediaStore.Video.Media.IS_PENDING, 1);
            out.uri = resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, fields);
            if (out.uri == null) throw new IllegalStateException("Device storage not available");
            out.stream = resolver.openOutputStream(out.uri, "w");
        } else {
            File root = getExternalFilesDir(Environment.DIRECTORY_MOVIES);
            if (root == null) root = getFilesDir();
            File sub = new File(root, "Luma Recordings");
            if (!sub.isDirectory() && !sub.mkdirs()) throw new IllegalStateException("Unable to create DVR folder");
            out.file = new File(sub, filename);
            out.stream = new FileOutputStream(out.file);
        }
        if (out.stream == null) throw new IllegalStateException("Cannot open recording output");
        return out;
    }

    private void finishDestination(Destination out) {
        if (out == null) return;
        out.close();
        if (out.uri != null && Build.VERSION.SDK_INT >= 29) {
            try {
                ContentValues update = new ContentValues();
                update.put(MediaStore.Video.Media.IS_PENDING, 0);
                getContentResolver().update(out.uri, update, null, null);
            } catch (Exception ignored) {}
        }
    }

    private void discardDestination(Destination out) {
        if (out == null) return;
        out.close();
        try {
            if (out.uri != null) getContentResolver().delete(out.uri, null, null);
            else if (out.file != null) out.file.delete();
        } catch (Exception ignored) {}
    }

    private Uri fileUri(Destination out) {
        return out.uri != null ? out.uri : Uri.fromFile(out.file);
    }

    private String fileName(Destination out) {
        return out.uri != null ? out.uri.toString() : out.file.getAbsolutePath();
    }

    private void convertToHevc(JSONObject job, Destination captured, long verifiedMs) {
        String id = job.optString("id");
        if (!DeviceDvrStore.hevcPreferred(this) || !DeviceDvrHevc.hasEncoder()) {
            DeviceDvrStore.processing(this, id, "original_kept", 0, null);
            return;
        }
        DeviceDvrStore.processing(this, id, "encoding", 0, null);
        File tmp = DeviceDvrHevc.transcode(this, fileUri(captured), verifiedMs);
        if (tmp == null || !tmp.isFile() || tmp.length() >= captured.bytes) {
            if (tmp != null) tmp.delete();
            DeviceDvrStore.processing(this, id, "hevc_failed_original_kept", 0, null);
            return;
        }
        Destination compact = null;
        boolean committed = false;
        try {
            compact = createDestination(job.optString("title"), true);
            try (InputStream input = new BufferedInputStream(new FileInputStream(tmp))) {
                byte[] buffer = new byte[65536];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    compact.stream.write(buffer, 0, read);
                    compact.bytes += read;
                }
            }
            finishDestination(compact);
            long outputMs = DeviceDvrHevc.videoDurationMs(this, fileUri(compact));
            if (outputMs <= 0 || outputMs < verifiedMs * 0.985
                    || compact.bytes >= captured.bytes) {
                throw new IllegalStateException("Compressed file is incomplete or not smaller");
            }
            DeviceDvrStore.processing(this, id, "hevc_complete",
                    captured.bytes - compact.bytes, fileName(compact));
            JSONObject persisted = DeviceDvrStore.get(this, id);
            if (persisted != null && fileName(compact).equals(persisted.optString("file"))) {
                committed = true;
                discardDestination(captured);
            }
        } catch (Exception ignored) {
            DeviceDvrStore.processing(this, id, "hevc_failed_original_kept", 0, null);
        } finally {
            tmp.delete();
            if (!committed) discardDestination(compact);
        }
    }

    private void removeEmpty(Destination out) {
        if (out == null || out.bytes > 0) return;
        try {
            if (out.uri != null) getContentResolver().delete(out.uri, null, null);
            else if (out.file != null) out.file.delete();
        } catch (Exception ignored) {}
    }

    private boolean keepRecording(JSONObject job) {
        if (System.currentTimeMillis() >= job.optLong("end")) return false;
        JSONObject latest = DeviceDvrStore.get(this, job.optString("id"));
        return latest != null && !"cancelled".equals(latest.optString("status"));
    }

    private long copySegment(HttpURLConnection c, OutputStream output, JSONObject job) throws Exception {
        long count = 0;
        try (InputStream input = new BufferedInputStream(c.getInputStream())) {
            byte[] buffer = new byte[64 * 1024];
            int n;
            while (keepRecording(job) && (n = input.read(buffer)) != -1) {
                output.write(buffer, 0, n);
                count += n;
            }
        } finally {
            c.disconnect();
        }
        return count;
    }

    private static String playlistText(HttpURLConnection conn) throws Exception {
        try (InputStream stream = conn.getInputStream();
             ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            byte[] part = new byte[8192];
            int size;
            while ((size = stream.read(part)) >= 0) {
                bytes.write(part, 0, size);
                if (bytes.size() > 1024 * 1024) throw new IllegalArgumentException("HLS guide exceeds safety limit");
            }
            return bytes.toString(StandardCharsets.UTF_8.name());
        } finally {
            conn.disconnect();
        }
    }

    private static final class Segment {
        final URL url;
        final long durationMs;
        Segment(URL url, long durationMs) { this.url = url; this.durationMs = durationMs; }
    }

    private static final class Playlist {
        URL variant;
        final List<Segment> segments = new ArrayList<>();
        long targetMs = 3500L;
        boolean ended;
    }

    private static Playlist parsePlaylist(URL base, String text) throws Exception {
        if (!text.trim().startsWith("#EXTM3U")) throw new IllegalArgumentException("Not an HLS playlist");
        Playlist parsed = new Playlist();
        String[] lines = text.split("\\r?\\n");
        boolean expectVariant = false;
        long bestBandwidth = -1, proposedBandwidth = 0, pendingSegmentDuration = 0;
        for (String raw : lines) {
            String item = raw.trim();
            if (item.isEmpty()) continue;
            if (item.startsWith("#EXT-X-KEY") || item.startsWith("#EXT-X-SESSION-KEY")) {
                throw new IllegalArgumentException("Encrypted or DRM-protected HLS is unsupported");
            }
            if (item.startsWith("#EXT-X-MAP") || item.startsWith("#EXT-X-BYTERANGE")) {
                throw new IllegalArgumentException("Fragmented MP4 or byte-range HLS requires another player");
            }
            if (item.startsWith("#EXT-X-TARGETDURATION:")) {
                try { parsed.targetMs = Math.max(1000, Math.min(15000,
                        Long.parseLong(item.substring(item.indexOf(':') + 1).trim()) * 1000)); }
                catch (NumberFormatException ignored) {}
            }
            if (item.startsWith("#EXTINF:")) {
                try {
                    String secs = item.substring(8).split(",", 2)[0].trim();
                    pendingSegmentDuration = Math.max(0L, Math.min(300000L,
                            (long)(Double.parseDouble(secs) * 1000)));
                } catch (NumberFormatException ignored) { pendingSegmentDuration = 0; }
            }
            if (item.startsWith("#EXT-X-ENDLIST")) parsed.ended = true;
            if (item.startsWith("#EXT-X-STREAM-INF")) {
                expectVariant = true;
                java.util.regex.Matcher m = java.util.regex.Pattern.compile("BANDWIDTH=(\\d+)").matcher(item);
                proposedBandwidth = m.find() ? Long.parseLong(m.group(1)) : 0;
                continue;
            }
            if (item.startsWith("#")) continue;
            URL uri = new URL(base, item);
            if (!validStream(uri)) continue;
            if (expectVariant) {
                if (proposedBandwidth >= bestBandwidth) {
                    parsed.variant = uri;
                    bestBandwidth = proposedBandwidth;
                }
                expectVariant = false;
            } else { parsed.segments.add(new Segment(uri, pendingSegmentDuration)); pendingSegmentDuration = 0; }
        }
        return parsed;
    }

    private long recordHls(URL source, String initial, Destination out, JSONObject job) throws Exception {
        URL playlistUrl = source;
        String first = initial;
        LinkedHashSet<String> seen = new LinkedHashSet<>();
        int idleChecks = 0;
        while (keepRecording(job)) {
            String text = first != null ? first : playlistText(open(playlistUrl));
            first = null;
            Playlist playlist = parsePlaylist(playlistUrl, text);
            if (playlist.variant != null) {
                playlistUrl = playlist.variant;
                continue;
            }
            int fresh = 0;
            for (Segment segment : playlist.segments) {
                String key = segment.url.toExternalForm();
                if (seen.contains(key)) continue;
                seen.add(key);
                if (seen.size() > 12000) {
                    // Bound memory use on very long channel recordings.
                    String eldest = seen.iterator().next();
                    seen.remove(eldest);
                }
                HttpURLConnection chunk = open(segment.url);
                String type = String.valueOf(chunk.getContentType()).toLowerCase(Locale.ROOT);
                if (type.contains("mpegurl") || type.contains("mp4")) {
                    chunk.disconnect();
                    throw new IllegalArgumentException("Segment is not MPEG-TS");
                }
                long declaredBytes = chunk.getContentLengthLong();
                long copied = copySegment(chunk, out.stream, job);
                out.bytes += copied;
                if (declaredBytes > 0 && copied < declaredBytes) {
                    out.incompleteSegment = true;
                } else if (copied > 0) {
                    out.mediaDurationMs += segment.durationMs;
                }
                fresh++;
                if (!keepRecording(job)) break;
            }
            if (playlist.ended) break;
            if (fresh == 0 && ++idleChecks > 30) throw new IllegalStateException("HLS guide stopped updating");
            if (fresh > 0) idleChecks = 0;
            if (!keepRecording(job)) break;
            Thread.sleep(playlist.targetMs);
        }
        return out.bytes;
    }

    private void record(JSONObject job) {
        String id = job.optString("id"), url = job.optString("url");
        final long startedAtMs = System.currentTimeMillis();
        PowerManager.WakeLock lock = null;
        WifiManager.WifiLock networkLock = null;
        Destination out = null;
        HttpURLConnection firstConnection = null;
        try {
            DeviceDvrStore.change(this, id, "recording", null, null);
            PowerManager pm = (PowerManager)getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                lock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Luma:DVR");
                lock.acquire(245L * 60_000L);
            }
            // Only hold a Wi-Fi lock while capturing; never while waiting for a
            // future airing. Deep Doze and vendor standby can still block Wi-Fi.
            WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wifi != null) {
                try {
                    networkLock = wifi.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "Luma:DVR:WiFi");
                    networkLock.setReferenceCounted(false);
                    networkLock.acquire();
                } catch (RuntimeException ignored) {
                    networkLock = null;
                }
            }
            URL stream = new URL(url);
            firstConnection = open(stream);
            String content = String.valueOf(firstConnection.getContentType()).toLowerCase(Locale.ROOT);
            boolean namedHls = stream.getPath().toLowerCase(Locale.ROOT).endsWith(".m3u8");
            if (namedHls || content.contains("mpegurl") || content.contains("m3u8")
                    || content.contains("application/x-mpegurl")) {
                String playlist = playlistText(firstConnection);
                firstConnection = null;
                out = createDestination(job.optString("title"), false);
                recordHls(stream, playlist, out, job);
            } else {
                InputStream streamIn = new BufferedInputStream(firstConnection.getInputStream());
                streamIn.mark(24);
                byte[] mark = new byte[8];
                int head = streamIn.read(mark);
                streamIn.reset();
                if (head == 8 && new String(mark, StandardCharsets.US_ASCII).startsWith("#EXTM3U")) {
                    String manifest;
                    try (InputStream src = streamIn; ByteArrayOutputStream buf = new ByteArrayOutputStream()) {
                        byte[] block = new byte[8192];int n;
                        while ((n = src.read(block)) != -1 && buf.size() < 1024*1024) buf.write(block,0,n);
                        manifest=buf.toString(StandardCharsets.UTF_8.name());
                    }
                    firstConnection.disconnect();
                    firstConnection = null;
                    out = createDestination(job.optString("title"), false);
                    recordHls(stream, manifest, out, job);
                } else {
                    out = createDestination(job.optString("title"), content.contains("video/mp4") || stream.getPath().toLowerCase(Locale.ROOT).endsWith(".mp4"));
                    try (InputStream src = streamIn) {
                        byte[] buffer = new byte[64*1024];
                        int n;
                        while (keepRecording(job) && (n = src.read(buffer)) != -1) {
                            out.stream.write(buffer,0,n);
                            out.bytes += n;
                        }
                    }
                    firstConnection.disconnect();
                    firstConnection = null;
                }
            }
            finishDestination(out); // Close file before checking metadata or converting.
            JSONObject current = DeviceDvrStore.get(this, id);
            if (current != null && "cancelled".equals(current.optString("status"))) return;
            if (out == null || out.bytes < 8192) {
                DeviceDvrStore.change(this, id, "failed", null, "No usable media was recorded");
                DeviceDvrStore.queueRetries(this);
                return;
            }
            final long expectedMs = Math.max(1L, job.optLong("end") - job.optLong("start"));
            final long startDelay = Math.max(0, startedAtMs - job.optLong("start"));
            final long mediaMs = out.mediaDurationMs > 0 ? out.mediaDurationMs
                    : DeviceDvrHevc.videoDurationMs(this, fileUri(out));
            if (startDelay > Math.max(15000L, (long)(expectedMs * 0.015))) {
                DeviceDvrStore.change(this, id, "partial", fileName(out),
                        "Capture started late; looking for a complete rerun");
                DeviceDvrStore.queueRetries(this);
                return;
            }
            if (out.incompleteSegment || mediaMs <= 0 || mediaMs < expectedMs * 0.99 - 10000L) {
                DeviceDvrStore.change(this, id, "partial", fileName(out),
                        "Duration not verified or recording was truncated; retrying exact episode");
                DeviceDvrStore.queueRetries(this);
                return;
            }
            DeviceDvrStore.change(this, id, "complete", fileName(out), "");
            // Transcode *after* the entire recording has been verified. Keep
            // original until a smaller, verified HEVC MP4 is published.
            convertToHevc(job, out, mediaMs);
        } catch (Exception err) {
            JSONObject current = DeviceDvrStore.get(this,id);
            if (current == null || !"cancelled".equals(current.optString("status"))) {
                finishDestination(out);
                DeviceDvrStore.change(this,id,out!=null&&out.bytes>0?"partial":"failed",
                        out!=null&&out.bytes>0?fileName(out):null,
                        "Stream stopped or device ran out of media; searching for exact episode rerun");
                DeviceDvrStore.queueRetries(this);
            }
        } finally {
            if (firstConnection != null) firstConnection.disconnect();
            finishDestination(out);
            removeEmpty(out);
            if (networkLock != null && networkLock.isHeld()) networkLock.release();
            if (lock != null && lock.isHeld()) lock.release();
        }
    }

    @Override public void onDestroy() {
        workers.shutdownNow();
        super.onDestroy();
    }
}
