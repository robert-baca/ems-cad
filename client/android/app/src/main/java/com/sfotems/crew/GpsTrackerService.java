package com.sfotems.crew;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.location.Location;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.LinkedList;

public class GpsTrackerService extends Service {

    static final String CHANNEL_ID  = "ems_gps";
    static final String EXTRA_TOKEN = "token";
    static final String EXTRA_URL   = "serverUrl";
    static final int    NOTIF_ID    = 1001;

    private static final float MIN_DISTANCE_M  = 5f;
    private static final long  MIN_INTERVAL_MS = 900L;
    // Force-post on this interval even while stationary. This is also the worst-case
    // delay before a dispatcher sees a position after toggling tracking on, since the
    // server doesn't push anything itself — it just waits for the phone's next post.
    private static final long  HEARTBEAT_MS    = 5_000L;
    private static final int   MAX_QUEUE       = 100; // ~100 seconds of offline points
    // Raw GPS near rides/structures can report a low-accuracy fix that barely
    // moves fix-to-fix even while someone's actually walking — this drops
    // those instead of posting a "position" that isn't trustworthy.
    private static final float MAX_ACCURACY_M  = 50f;
    // Even the heartbeat override below must not post a fix worse than this.
    // Indoors with no GPS at all (e.g. inside a station building), Android
    // can fall back to cell-tower/network positioning that's off by hundreds
    // of meters to miles — showing dispatch a confident, wildly wrong
    // position is worse than a stale-but-accurate pin. Genuine near-structure
    // GPS degradation is normally well under this; only network-only
    // fallback fixes get this bad.
    private static final float MAX_HEARTBEAT_ACCURACY_M = 300f;

    // Some OEM battery managers (Samsung/Xiaomi/etc.) silently stop delivering
    // location callbacks to a foreground service without actually killing the
    // service or triggering onDestroy/a START_STICKY restart — Android gives
    // no broadcast for this, so periodically checking for a stale callback and
    // just re-registering is the only way to recover without the crew member
    // noticing a frozen pin and manually reopening the app.
    private static final long WATCHDOG_INTERVAL_MS = 30_000L;
    private static final long WATCHDOG_STALE_MS     = 75_000L;

    private FusedLocationProviderClient fusedClient;
    private LocationCallback            locationCallback;

    private String token;
    private String serverUrl;

    private long   lastPostMs             = 0;
    private long   lastHeartbeatMs        = 0;
    private long   lastLocationReceivedMs = 0;
    private double lastLat                = Double.NaN;
    private double lastLng                = Double.NaN;

    private final LinkedList<double[]> offlineQueue = new LinkedList<>();

    private PowerManager.WakeLock wakeLock;
    private Handler  watchdogHandler;
    private Runnable watchdogRunnable;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            token     = intent.getStringExtra(EXTRA_TOKEN);
            serverUrl = intent.getStringExtra(EXTRA_URL);
        }

        // Android restarts a killed START_STICKY service (e.g. after an OS low-memory
        // kill) by calling onStartCommand(null, ...) — no Intent, no extras. Without
        // this fallback, the restarted service silently drops every GPS post forever
        // (sendPoint() refuses to run with a null token/serverUrl), looking exactly
        // like tracking permanently stopped with no way to self-recover. The plugin
        // already persists these on startTracking() for the boot-restart case; reuse
        // that here too.
        if (token == null || serverUrl == null) {
            android.content.SharedPreferences prefs =
                    getSharedPreferences("GpsTracker", MODE_PRIVATE);
            token     = prefs.getString("token", null);
            serverUrl = prefs.getString("serverUrl", null);
        }

        createChannel();
        Notification notif = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("EMS Crew Tracking")
                .setContentText("GPS is active")
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setOngoing(true)
                .build();
        startForeground(NOTIF_ID, notif);

        // Idempotent: a repeat startTracking() call (the JS side's periodic JWT
        // refresh calls it again with a fresh token every ~30 min, and simply
        // returning to the crew screen after navigating elsewhere in the app
        // does too, now that tracking is no longer stopped on unmount) must not
        // register a second location subscription -- token/serverUrl above are
        // still updated either way, this just skips re-subscribing when one is
        // already running, avoiding duplicate callbacks and duplicate posts.
        if (fusedClient == null || locationCallback == null) {
            acquireWakeLock();
            startGps();
            startWatchdog();
        }
        return START_STICKY;
    }

    // Guards against duplicate loops if onStartCommand fires again (e.g. the
    // null-Intent restart case above) while one is already scheduled.
    private void startWatchdog() {
        if (watchdogHandler != null) return;
        watchdogHandler = new Handler(Looper.getMainLooper());
        watchdogRunnable = () -> {
            long now = System.currentTimeMillis();
            if (lastLocationReceivedMs != 0 && now - lastLocationReceivedMs > WATCHDOG_STALE_MS) {
                restartLocationUpdates();
            }
            watchdogHandler.postDelayed(watchdogRunnable, WATCHDOG_INTERVAL_MS);
        };
        watchdogHandler.postDelayed(watchdogRunnable, WATCHDOG_INTERVAL_MS);
    }

    private void restartLocationUpdates() {
        try {
            if (fusedClient != null && locationCallback != null) {
                fusedClient.removeLocationUpdates(locationCallback);
            }
        } catch (Exception ignored) {}
        // Must null this out before re-subscribing: if permission has been
        // revoked since the last successful subscription, startGps() below
        // will throw and leave locationCallback untouched. Without clearing
        // it first, it would still point at the callback just removed above
        // (non-null) -- onStartCommand()'s idempotency guard checks exactly
        // this field, so a stale non-null reference here would make it think
        // tracking is still fine and never retry again (e.g. on the next
        // ~30-min JWT refresh), even after permission is re-granted.
        locationCallback = null;
        acquireWakeLock();
        startGps();
    }

    // Without this, the CPU can suspend once the screen locks — the foreground
    // service keeps running but stops actually receiving location callbacks,
    // which looked like GPS tracking briefly working then going silent. A long
    // timeout is a safety net in case stopTracking() is ever missed; it's
    // renewed on every shift start anyway.
    private void acquireWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) return;
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "EMSCrew:GpsTrackerWakeLock");
        wakeLock.acquire(12 * 60 * 60 * 1000L /* 12 hours */);
    }

    private void createChannel() {
        NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID, "GPS Tracking", NotificationManager.IMPORTANCE_LOW);
        ch.setDescription("Keeps crew GPS running in the background");
        getSystemService(NotificationManager.class).createNotificationChannel(ch);
    }

    // Fused location blends GPS with WiFi/cell/sensor data via Google Play
    // Services, which holds up far better than raw GPS_PROVIDER near rides and
    // large structures that cause GPS multipath/obstruction — that was the
    // source of fixes that kept posting on schedule without ever reflecting
    // real movement.
    //
    // Requested at 2.5s/1.5s rather than 1s/0.5s — MIN_INTERVAL_MS, HEARTBEAT_MS,
    // and MIN_DISTANCE_M below already throttle actual posts to roughly this
    // cadence or slower, so the tighter request was just burning battery
    // polling the GPS chip for fixes that got thrown away before ever being
    // sent. Same PRIORITY_HIGH_ACCURACY, same posted cadence to dispatch —
    // only the chip's idle time between reads changes.
    private void startGps() {
        fusedClient = LocationServices.getFusedLocationProviderClient(this);

        LocationRequest request = new LocationRequest.Builder(2_500L)
                .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
                .setMinUpdateIntervalMillis(1_500L)
                .build();

        LocationCallback callback = new LocationCallback() {
            @Override
            public void onLocationResult(@NonNull LocationResult result) {
                Location loc = result.getLastLocation();
                if (loc != null) onLocation(loc);
            }
        };

        try {
            fusedClient.requestLocationUpdates(request, callback, Looper.getMainLooper());
            // Only assign this on success -- onStartCommand's idempotency guard
            // checks locationCallback == null to decide whether to retry
            // startGps(). If permission isn't granted yet and this throws,
            // leaving it null lets the next onStartCommand (e.g. the ~30-min
            // JWT refresh) retry instead of being permanently skipped.
            locationCallback = callback;
        } catch (SecurityException ignored) {}
    }

    private void onLocation(Location loc) {
        long now = System.currentTimeMillis();
        // Recorded unconditionally, even on a fix the filters below end up
        // dropping — the watchdog only cares whether callbacks are still
        // arriving at all, not whether they're passing the accuracy/movement
        // checks.
        lastLocationReceivedMs = now;
        if (now - lastPostMs < MIN_INTERVAL_MS) return;

        float   accuracy      = loc.hasAccuracy() ? loc.getAccuracy() : -1f;
        boolean heartbeatDue   = (now - lastHeartbeatMs) >= HEARTBEAT_MS;
        boolean accurateEnough = accuracy < 0 || accuracy <= MAX_ACCURACY_M;

        // Never post a fix this bad, heartbeat or not — see MAX_HEARTBEAT_ACCURACY_M.
        if (accuracy > MAX_HEARTBEAT_ACCURACY_M) return;

        // A degraded fix (common near the park's large steel structures/rides —
        // exactly where units walk while responding to a call) used to be dropped
        // unconditionally, which meant a unit stuck in a bad-accuracy zone stopped
        // posting *at all* until it cleared the obstruction — looking frozen on
        // dispatch's map for the whole response instead of just less precise.
        // Only suppress it between heartbeats now; the heartbeat always gets through.
        if (!accurateEnough && !heartbeatDue) return;

        // Movement-distance dedup only makes sense with a trustworthy fix — skip it
        // for degraded ones so a heartbeat-forced post isn't blocked by a bogus
        // "hasn't moved" reading computed from an inaccurate position.
        if (accurateEnough && !Double.isNaN(lastLat)) {
            float[] result = new float[1];
            Location.distanceBetween(lastLat, lastLng, loc.getLatitude(), loc.getLongitude(), result);
            if (result[0] < MIN_DISTANCE_M && !heartbeatDue) return;
        }
        // Reset on every post, not just heartbeat-triggered ones — otherwise
        // a burst of movement posts never refreshes this, and the heartbeat
        // fires again moments later even though a point was just sent.
        lastHeartbeatMs = now;

        lastPostMs = now;
        lastLat    = loc.getLatitude();
        lastLng    = loc.getLongitude();

        final double lat = lastLat;
        final double lng = lastLng;
        final float  acc = accuracy;
        new Thread(() -> {
            boolean ok = sendPoint(lat, lng, acc);
            if (ok) {
                drainQueue();
            } else {
                synchronized (offlineQueue) {
                    offlineQueue.addLast(new double[]{lat, lng, acc});
                    while (offlineQueue.size() > MAX_QUEUE) offlineQueue.removeFirst();
                }
            }
        }).start();
    }

    // Flush queued offline points oldest-first after connection is restored
    private void drainQueue() {
        while (true) {
            double[] pt;
            synchronized (offlineQueue) {
                pt = offlineQueue.peekFirst();
            }
            if (pt == null) return;
            if (!sendPoint(pt[0], pt[1], (float) pt[2])) return; // still offline, stop trying
            synchronized (offlineQueue) {
                offlineQueue.pollFirst();
            }
        }
    }

    private boolean sendPoint(double lat, double lng, float accuracy) {
        if (token == null || serverUrl == null) return false;
        final String gpsPermission = GpsPermissionStatus.get(getApplicationContext());
        final String body     = "{\"lat\":" + lat + ",\"lng\":" + lng + ",\"accuracy\":" + accuracy + ",\"gpsPermission\":\"" + gpsPermission + "\"}";
        final String endpoint = serverUrl + "/api/crew/gps";
        try {
            HttpURLConnection conn = (HttpURLConnection) new URL(endpoint).openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Authorization", "Bearer " + token);
            conn.setDoOutput(true);
            conn.setConnectTimeout(8_000);
            conn.setReadTimeout(8_000);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(body.getBytes(StandardCharsets.UTF_8));
            }
            int code = conn.getResponseCode();
            conn.disconnect();
            return code >= 200 && code < 300;
        } catch (Exception e) {
            return false;
        }
    }

    @Override
    public void onDestroy() {
        if (watchdogHandler != null && watchdogRunnable != null) {
            watchdogHandler.removeCallbacks(watchdogRunnable);
        }
        if (fusedClient != null && locationCallback != null) {
            fusedClient.removeLocationUpdates(locationCallback);
        }
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
