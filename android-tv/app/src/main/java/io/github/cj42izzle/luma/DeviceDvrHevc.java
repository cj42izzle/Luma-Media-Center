package io.github.cj42izzle.luma;

import android.content.Context;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;

import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.transformer.Composition;
import androidx.media3.transformer.EditedMediaItem;
import androidx.media3.transformer.ExportException;
import androidx.media3.transformer.ExportResult;
import androidx.media3.transformer.Transformer;

import java.io.File;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Best-effort *device hardware* HEVC encoding. Not the desktop libx265
 * software library: output is the same H.265/HEVC video format when available.
 * Original TS/MP4 must remain untouched until service validates and publishes
 * the compact version. Source is only an authorised, already-captured file.
 */
public final class DeviceDvrHevc {
    private DeviceDvrHevc() {}

    public static boolean hasEncoder() {
        try {
            for (MediaCodecInfo codec : new MediaCodecList(MediaCodecList.REGULAR_CODECS).getCodecInfos()) {
                if (!codec.isEncoder()) continue;
                for (String mime : codec.getSupportedTypes()) {
                    if ("video/hevc".equalsIgnoreCase(mime)) return true;
                }
            }
        } catch (RuntimeException ignored) {}
        return false;
    }

    /** Duration from the exported video; return zero rather than inventing time. */
    public static long videoDurationMs(Context ctx, Uri uri) {
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        try {
            retriever.setDataSource(ctx, uri);
            String value = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            return Math.max(0, Long.parseLong(value == null ? "0" : value));
        } catch (Exception ignored) {
            return 0;
        } finally {
            try { retriever.release(); } catch (Exception ignored) {}
        }
    }

    private static boolean isActualHevc(File path) {
        MediaExtractor reader = new MediaExtractor();
        try {
            reader.setDataSource(path.getAbsolutePath());
            for (int i = 0; i < reader.getTrackCount(); i++) {
                MediaFormat info = reader.getTrackFormat(i);
                if ("video/hevc".equalsIgnoreCase(info.getString(MediaFormat.KEY_MIME))) return true;
            }
        } catch (Exception ignored) {
            return false;
        } finally {
            try { reader.release(); } catch (Exception ignored) {}
        }
        return false;
    }

    /**
     * Run the asynchronous Media3 export on Android's main thread but wait on
     * the *service worker* thread. Callers must not call from the UI thread.
     * A single export at a time prevents saturating low-power TV encoders.
     */
    public static synchronized File transcode(Context ctx, Uri input, long expectedMs) {
        if (!hasEncoder()) return null;
        File root = ctx.getExternalCacheDir();
        if (root == null) root = ctx.getCacheDir();
        File temp = new File(root, "luma-hevc-" + System.nanoTime() + ".mp4");
        final Handler main = new Handler(Looper.getMainLooper());
        final CountDownLatch done = new CountDownLatch(1);
        final AtomicBoolean good = new AtomicBoolean(false);
        final AtomicReference<Transformer> transformerRef = new AtomicReference<>();
        main.post(() -> {
            try {
                Transformer transformer = new Transformer.Builder(ctx)
                    .setVideoMimeType(MimeTypes.VIDEO_H265)
                    .addListener(new Transformer.Listener() {
                        @Override public void onCompleted(Composition composition, ExportResult result) {
                            good.set(true);
                            done.countDown();
                        }
                        @Override public void onError(Composition composition, ExportResult result,
                                                      ExportException exception) {
                            good.set(false);
                            done.countDown();
                        }
                    }).build();
                transformerRef.set(transformer);
                transformer.start(new EditedMediaItem.Builder(MediaItem.fromUri(input)).build(),
                                  temp.getAbsolutePath());
            } catch (RuntimeException e) {
                done.countDown();
            }
        });
        try {
            long budget = Math.max(300, Math.min(7200, expectedMs / 1000 * 5));
            if (!done.await(budget, TimeUnit.SECONDS)) {
                Transformer converter = transformerRef.get();
                if (converter != null) main.post(converter::cancel);
                good.set(false);
            }
            if (!good.get() || !temp.isFile() || temp.length() < 8192
                    || !isActualHevc(temp)) return null;
            // A completed Transformer result may still have a shorter timeline:
            // reject truncated HEVC outputs, preserving the raw original.
            long actual = videoDurationMs(ctx, Uri.fromFile(temp));
            if (actual <= 0 || actual < expectedMs * 0.965) return null;
            return temp;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return null;
        } finally {
            if (!good.get()) temp.delete();
        }
    }
}
