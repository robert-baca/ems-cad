package com.sfotems.crew;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import com.getcapacitor.JSObject;
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

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("status", GpsPermissionStatus.get(getContext()));
        call.resolve(ret);
    }

    // Lets any page in the app (not just the crew screen) show a "tracking is
    // active" reminder -- reads the same flag startTracking()/stopTracking()
    // already maintain, so it reflects the real state regardless of which
    // origin is currently loaded.
    @PluginMethod
    public void isTracking(PluginCall call) {
        boolean active = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getBoolean("active", false);
        JSObject ret = new JSObject();
        ret.put("active", active);
        call.resolve(ret);
    }
}
