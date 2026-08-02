package com.sfotems.crew;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;

        SharedPreferences prefs = context.getSharedPreferences("GpsTracker", Context.MODE_PRIVATE);
        if (!prefs.getBoolean("active", false)) return;

        String token     = prefs.getString("token", null);
        String serverUrl = prefs.getString("serverUrl", null);
        if (token == null || serverUrl == null) return;

        Intent serviceIntent = new Intent(context, GpsTrackerService.class);
        serviceIntent.putExtra(GpsTrackerService.EXTRA_TOKEN, token);
        serviceIntent.putExtra(GpsTrackerService.EXTRA_URL, serverUrl);
        context.startForegroundService(serviceIntent);
    }
}
