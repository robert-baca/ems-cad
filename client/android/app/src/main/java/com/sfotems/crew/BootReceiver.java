package com.sfotems.crew;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.util.Log;

import androidx.core.content.ContextCompat;

public class BootReceiver extends BroadcastReceiver {
    private static final String TAG = "BootReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;

        SharedPreferences prefs = context.getSharedPreferences("GpsTracker", Context.MODE_PRIVATE);
        if (!prefs.getBoolean("active", false)) return;

        String token     = prefs.getString("token", null);
        String serverUrl = prefs.getString("serverUrl", null);
        if (token == null || serverUrl == null) return;

        // Android's auto-reset-unused-permissions can revoke ACCESS_FINE_LOCATION
        // between shifts. GpsTrackerService.startGps() silently swallows the
        // resulting SecurityException, so starting the service anyway would show
        // the persistent "GPS is active" foreground notification while no fix is
        // ever posted -- misleading the crew member into thinking they're tracked
        // when they're not. Skip starting it instead.
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "Skipping GPS service restart after boot: ACCESS_FINE_LOCATION not granted");
            return;
        }

        Intent serviceIntent = new Intent(context, GpsTrackerService.class);
        serviceIntent.putExtra(GpsTrackerService.EXTRA_TOKEN, token);
        serviceIntent.putExtra(GpsTrackerService.EXTRA_URL, serverUrl);
        context.startForegroundService(serviceIntent);
    }
}
