package com.sfotems.crew;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import androidx.core.app.NotificationCompat;

// Fired by an AlarmManager alarm that GpsTrackerService reschedules further into
// the future on every successful GPS post (see scheduleStaleWarning() there). As
// long as posts keep succeeding, this alarm keeps getting pushed back before it
// ever fires. If something silently stops tracking -- the process gets killed by
// an app update install, a crash, permission getting revoked, or a long dead
// zone -- nothing reschedules it, and it fires on its own to tell the crew
// member directly, on their own phone, instead of relying on a dispatcher
// happening to notice the "GPS stale" badge on the dashboard.
public class GpsStaleWarningReceiver extends BroadcastReceiver {
    static final String CHANNEL_ID = "ems_gps_stale";
    private static final int NOTIF_ID = 1002;

    @Override
    public void onReceive(Context context, Intent intent) {
        NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID, "GPS Tracking Stopped", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Alerts if GPS tracking silently stops");
        context.getSystemService(NotificationManager.class).createNotificationChannel(ch);

        Notification notif = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setContentTitle("GPS Tracking Stopped")
                .setContentText("Your location hasn't updated in a while. Please reopen the EMS Crew app.")
                .setSmallIcon(android.R.drawable.ic_dialog_alert)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .build();
        context.getSystemService(NotificationManager.class).notify(NOTIF_ID, notif);
    }
}
