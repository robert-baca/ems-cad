package com.sfotems.crew;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.location.Location;
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

    private FusedLocationProviderClient fusedClient;
    private LocationCallback            locationCallback;

    private String token;
    private String serverUrl;

    private long   lastPostMs      = 0;
    private long   lastHeartbeatMs = 0;
    private double lastLat         = Double.NaN;
    private double lastLng         = Double.NaN;

    private final LinkedList<double[]> offlineQueue = new LinkedList<>();

    private PowerManager.WakeLock wakeLock;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            token     = intent.getStringExtra(EXTRA_TOKEN);
            serverUrl = intent.getStringExtra(EXTRA_URL);
        }

        createChannel();
        Notification notif = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("EMS Crew Tracking")
                .setContentText("GPS is active")
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setOngoing(true)
                .build();
        startForeground(NOTIF_ID, notif);

        acquireWakeLock();
        startGps();
        return START_STICKY;
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
    private void startGps() {
        fusedClient = LocationServices.getFusedLocationProviderClient(this);

        LocationRequest request = new LocationRequest.Builder(1_000L)
                .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
                .setMinUpdateIntervalMillis(500L)
                .build();

        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(@NonNull LocationResult result) {
                Location loc = result.getLastLocation();
                if (loc != null) onLocation(loc);
            }
        };

        try {
            fusedClient.requestLocationUpdates(request, locationCallback, Looper.getMainLooper());
        } catch (SecurityException ignored) {}
    }

    private void onLocation(Location loc) {
        if (loc.hasAccuracy() && loc.getAccuracy() > MAX_ACCURACY_M) return;

        long now = System.currentTimeMillis();
        if (now - lastPostMs < MIN_INTERVAL_MS) return;

        boolean heartbeatDue = (now - lastHeartbeatMs) >= HEARTBEAT_MS;
        if (!Double.isNaN(lastLat)) {
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
        new Thread(() -> {
            boolean ok = sendPoint(lat, lng);
            if (ok) {
                drainQueue();
            } else {
                synchronized (offlineQueue) {
                    offlineQueue.addLast(new double[]{lat, lng});
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
            if (!sendPoint(pt[0], pt[1])) return; // still offline, stop trying
            synchronized (offlineQueue) {
                offlineQueue.pollFirst();
            }
        }
    }

    private boolean sendPoint(double lat, double lng) {
        if (token == null || serverUrl == null) return false;
        final String gpsPermission = GpsPermissionStatus.get(getApplicationContext());
        final String body     = "{\"lat\":" + lat + ",\"lng\":" + lng + ",\"gpsPermission\":\"" + gpsPermission + "\"}";
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
        if (fusedClient != null && locationCallback != null) {
            fusedClient.removeLocationUpdates(locationCallback);
        }
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
