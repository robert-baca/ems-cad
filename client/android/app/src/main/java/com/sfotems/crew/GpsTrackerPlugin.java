package com.sfotems.crew;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "GpsTracker")
public class GpsTrackerPlugin extends Plugin {

    private static final String PREFS = "GpsTracker";

    @PluginMethod
    public void startTracking(PluginCall call) {
        String token     = call.getString("token", "");
        String serverUrl = call.getString("serverUrl", "");

        // Persist so BootReceiver can restart the service after a reboot
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString("token", token)
                .putString("serverUrl", serverUrl)
                .putBoolean("active", true)
                .apply();

        Intent intent = new Intent(getContext(), GpsTrackerService.class);
        intent.putExtra(GpsTrackerService.EXTRA_TOKEN, token);
        intent.putExtra(GpsTrackerService.EXTRA_URL, serverUrl);
        getContext().startForegroundService(intent);

        call.resolve();
    }

    @PluginMethod
    public void stopTracking(PluginCall call) {
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putBoolean("active", false)
                .apply();

        getContext().stopService(new Intent(getContext(), GpsTrackerService.class));
        call.resolve();
    }
}
