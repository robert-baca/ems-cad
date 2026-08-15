package com.sfotems.crew;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.PowerManager;
import androidx.core.content.ContextCompat;

// Shared by GpsTrackerPlugin (on-demand JS query) and GpsTrackerService
// (included with every GPS post) so both report the exact same thing.
//
// Android's foreground-service model doesn't have iOS's "While Using vs
// Always" split, but manufacturer battery managers (Samsung, Xiaomi, etc.)
// killing the service despite it being a proper foreground service is the
// real-world equivalent failure mode — this is what the "Unrestricted
// Battery" onboarding step is meant to fix, and this reports whether it
// actually got set.
final class GpsPermissionStatus {
    private GpsPermissionStatus() {}

    static String get(Context ctx) {
        boolean hasPermission = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
        if (!hasPermission) return "no_permission";

        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        boolean ignoringBatteryOptimizations = pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName());
        return ignoringBatteryOptimizations ? "ok" : "battery_restricted";
    }
}
