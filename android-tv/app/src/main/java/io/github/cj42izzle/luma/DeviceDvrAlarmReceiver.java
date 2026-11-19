package io.github.cj42izzle.luma;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.app.AlarmManager;
import org.json.JSONObject;

/** Wakes the native recorder for schedules, including after reboot. */
public final class DeviceDvrAlarmReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action)
                || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            DeviceDvrStore.rescheduleAfterBoot(context);
            return;
        }
        if (Build.VERSION.SDK_INT >= 31
                && AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED.equals(action)) {
            AlarmManager alarm = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (alarm != null && alarm.canScheduleExactAlarms()) {
                DeviceDvrStore.reschedulePending(context);
            }
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
