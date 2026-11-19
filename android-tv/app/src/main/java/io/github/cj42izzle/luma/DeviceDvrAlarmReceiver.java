package io.github.cj42izzle.luma;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import org.json.JSONObject;

/** Wakes the native recorder for schedules, including after reboot. */
public final class DeviceDvrAlarmReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            DeviceDvrStore.rescheduleAfterBoot(context);
            return;
        }
        if (!"io.github.cj42izzle.luma.DVR_START".equals(intent.getAction()) || intent.getData() == null) return;
        String id = intent.getData().getLastPathSegment();
        JSONObject job = DeviceDvrStore.get(context, id);
        if (job == null || !"scheduled".equals(job.optString("status"))
                || job.optLong("end") <= System.currentTimeMillis()) return;
        Intent start = new Intent(context, DeviceDvrService.class)
                .setAction("io.github.cj42izzle.luma.RECORD").putExtra("job_id", id);
        try {
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(start);
            else context.startService(start);
        } catch (RuntimeException e) {
            DeviceDvrStore.change(context, id, "failed", null, "Android blocked starting the recording");
        }
    }
}
