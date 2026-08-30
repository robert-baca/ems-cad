import Capacitor
import CoreLocation

// iOS counterpart to android/.../GpsTrackerPlugin.java + GpsTrackerService.java.
// Deliberately mirrors that architecture rather than using
// @capacitor-community/background-geolocation's addWatcher(): that plugin
// delivers updates via a JS callback tied to the currently-loaded page, which
// stops working the moment the WebView navigates to a different origin (e.g.
// checking QI/Education, which live on separate domains from cad.sfotems.com)
// -- Capacitor resets its bridge on every page load, orphaning that callback.
// This plugin instead owns its own CLLocationManager and posts location
// directly via URLSession, entirely independent of any page's JS, so it
// survives exactly the same cross-origin navigation the Android service does.
@objc(GpsTrackerPlugin)
public class GpsTrackerPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    public let identifier = "GpsTrackerPlugin"
    public let jsName = "GpsTracker"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startTracking", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopTracking", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isTracking", returnType: CAPPluginReturnPromise),
    ]

    private static let defaultsTokenKey = "GpsTrackerToken"
    private static let defaultsUrlKey = "GpsTrackerServerUrl"
    private static let defaultsActiveKey = "GpsTrackerActive"

    private let locationManager = CLLocationManager()
    private var token: String?
    private var serverUrl: String?
    private var isTracking = false

    // Same thresholds as GpsTrackerService.java's onLocation() -- keep the two
    // platforms' pin behavior on dispatch's map consistent.
    private let minDistanceM: CLLocationDistance = 5
    private let minIntervalS: TimeInterval = 0.9
    private let heartbeatS: TimeInterval = 5
    private let maxAccuracyM: CLLocationAccuracy = 50
    private let maxHeartbeatAccuracyM: CLLocationAccuracy = 300

    private var lastPost = Date.distantPast
    private var lastHeartbeat = Date.distantPast
    private var lastLocation: CLLocation?

    // Mirrors GpsTrackerService.java's offlineQueue/drainQueue: a dropped
    // post (no connectivity, server unreachable) isn't just lost -- it's
    // queued and flushed oldest-first once a later post succeeds. Capped the
    // same as Android (~100 points of backlog). Locked since didUpdateLocations
    // can fire again (spawning another Task) before a prior send/drain finishes.
    private let offlineQueueLock = NSLock()
    private var offlineQueue: [(lat: Double, lng: Double, accuracy: Double)] = []
    private let maxQueueSize = 100
    // Guards against two location updates arriving close together (only
    // minIntervalS = 0.9s apart) each spawning their own concurrent
    // send-then-drain sequence -- without this, two overlapping drains could
    // both peek the same queued point, both send it (duplicate post), then
    // both remove an entry, silently losing a different unsent point.
    private var isSendingOrDraining = false

    // Mirrors the Android watchdog: some scenarios leave CLLocationManager
    // silently not delivering further updates with no error either -- restart
    // the subscription if nothing has arrived in a while instead of the pin
    // just going stale on dispatch's map indefinitely.
    private var watchdogTimer: Timer?
    private var lastLocationReceived = Date()
    private let watchdogIntervalS: TimeInterval = 30
    private let watchdogStaleS: TimeInterval = 75

    public override func load() {
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.distanceFilter = 5
        locationManager.allowsBackgroundLocationUpdates = true
        locationManager.pausesLocationUpdatesAutomatically = false
        locationManager.showsBackgroundLocationIndicator = true

        // Resume automatically if iOS relaunched the app mid-shift (e.g. after
        // a memory-pressure kill) -- mirrors Android's BootReceiver + the
        // GpsTrackerService onStartCommand(null, ...) SharedPreferences fallback.
        let defaults = UserDefaults.standard
        if defaults.bool(forKey: GpsTrackerPlugin.defaultsActiveKey),
            let savedToken = defaults.string(forKey: GpsTrackerPlugin.defaultsTokenKey),
            let savedUrl = defaults.string(forKey: GpsTrackerPlugin.defaultsUrlKey) {
            token = savedToken
            serverUrl = savedUrl
            beginTrackingIfNeeded()
        }
    }

    @objc func startTracking(_ call: CAPPluginCall) {
        guard let newToken = call.getString("token"), let newServerUrl = call.getString("serverUrl") else {
            call.reject("Missing token or serverUrl")
            return
        }
        token = newToken
        serverUrl = newServerUrl

        let defaults = UserDefaults.standard
        defaults.set(newToken, forKey: GpsTrackerPlugin.defaultsTokenKey)
        defaults.set(newServerUrl, forKey: GpsTrackerPlugin.defaultsUrlKey)
        defaults.set(true, forKey: GpsTrackerPlugin.defaultsActiveKey)

        beginTrackingIfNeeded()
        call.resolve()
    }

    @objc func stopTracking(_ call: CAPPluginCall) {
        UserDefaults.standard.set(false, forKey: GpsTrackerPlugin.defaultsActiveKey)
        isTracking = false
        watchdogTimer?.invalidate()
        watchdogTimer = nil
        DispatchQueue.main.async {
            self.locationManager.stopUpdatingLocation()
            self.locationManager.stopMonitoringSignificantLocationChanges()
        }
        call.resolve()
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(["status": GpsTrackerPlugin.authStatusString(self.locationManager.authorizationStatus)])
        }
    }

    // Lets any page in the app (not just the crew screen) show a "tracking is
    // active" reminder -- reads the same flag startTracking()/stopTracking()
    // already maintain, so it reflects the real state regardless of which
    // origin is currently loaded.
    @objc func isTracking(_ call: CAPPluginCall) {
        call.resolve(["active": UserDefaults.standard.bool(forKey: GpsTrackerPlugin.defaultsActiveKey)])
    }

    // Idempotent by design: a repeat startTracking() call -- the JS side's
    // periodic JWT refresh calls this again with a fresh token every ~30 min,
    // and simply returning to the crew screen after navigating elsewhere in
    // the app does too -- must not register a second location subscription.
    // token/serverUrl above are updated either way; this just skips
    // re-subscribing when one is already running.
    private func beginTrackingIfNeeded() {
        guard !isTracking else { return }
        isTracking = true
        DispatchQueue.main.async {
            self.locationManager.startUpdatingLocation()
            // Backup wake mechanism for when iOS suspends the whole app process
            // (not just pauses location delivery) -- the regular watchdog below
            // can't help with that since a suspended process runs no code at
            // all, including its own Timer. Significant-change monitoring is
            // independent of the process: iOS tracks it at the OS level and
            // will relaunch this app in the background specifically to deliver
            // one, at which point load() below sees the persisted "active" flag
            // and calls this same method again to resume full-rate tracking.
            self.locationManager.startMonitoringSignificantLocationChanges()
        }
        startWatchdog()
    }

    private func startWatchdog() {
        DispatchQueue.main.async {
            self.watchdogTimer?.invalidate()
            self.watchdogTimer = Timer.scheduledTimer(withTimeInterval: self.watchdogIntervalS, repeats: true) { [weak self] _ in
                guard let self = self else { return }
                if Date().timeIntervalSince(self.lastLocationReceived) > self.watchdogStaleS {
                    self.locationManager.stopUpdatingLocation()
                    self.locationManager.startUpdatingLocation()
                }
            }
        }
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        lastLocationReceived = Date()

        let now = Date()
        if now.timeIntervalSince(lastPost) < minIntervalS { return }

        let accuracy = loc.horizontalAccuracy
        let heartbeatDue = now.timeIntervalSince(lastHeartbeat) >= heartbeatS
        let accurateEnough = accuracy < 0 || accuracy <= maxAccuracyM

        // Never post a fix this bad, heartbeat or not -- see GpsTrackerService.java.
        if accuracy > maxHeartbeatAccuracyM { return }
        if !accurateEnough && !heartbeatDue { return }

        if accurateEnough, let last = lastLocation {
            if loc.distance(from: last) < minDistanceM && !heartbeatDue { return }
        }
        lastHeartbeat = now
        lastPost = now
        lastLocation = loc

        let lat = loc.coordinate.latitude
        let lng = loc.coordinate.longitude
        Task {
            await sendOrEnqueue(lat: lat, lng: lng, accuracy: accuracy)
        }
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // CLLocationManager keeps retrying on its own; the watchdog above
        // catches a subscription that's gone truly silent.
    }

    private static func authStatusString(_ status: CLAuthorizationStatus) -> String {
        switch status {
        case .authorizedAlways: return "always"
        case .authorizedWhenInUse: return "whenInUse"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "notDetermined"
        @unknown default: return "unknown"
        }
    }

    // Single entry point for handling a fresh, filter-passed fix. Serializes
    // against any send-or-drain sequence already in flight -- if one's
    // running, this fix is just enqueued for that sequence's own drain loop
    // to pick up, rather than starting a second concurrent send/drain that
    // could race the first over the shared queue.
    private func sendOrEnqueue(lat: Double, lng: Double, accuracy: Double) async {
        offlineQueueLock.lock()
        if isSendingOrDraining {
            offlineQueue.append((lat, lng, accuracy))
            while offlineQueue.count > maxQueueSize { offlineQueue.removeFirst() }
            offlineQueueLock.unlock()
            return
        }
        isSendingOrDraining = true
        offlineQueueLock.unlock()

        let ok = await sendPoint(lat: lat, lng: lng, accuracy: accuracy)
        if ok {
            await drainQueue()
        } else {
            enqueueOffline(lat: lat, lng: lng, accuracy: accuracy)
        }

        offlineQueueLock.lock()
        isSendingOrDraining = false
        offlineQueueLock.unlock()
    }

    private func enqueueOffline(lat: Double, lng: Double, accuracy: Double) {
        offlineQueueLock.lock()
        offlineQueue.append((lat, lng, accuracy))
        while offlineQueue.count > maxQueueSize {
            offlineQueue.removeFirst()
        }
        offlineQueueLock.unlock()
    }

    // Flushes queued offline points oldest-first after connectivity returns --
    // mirrors GpsTrackerService.java's drainQueue(). Stops at the first
    // still-failing send rather than draining out of order.
    private func drainQueue() async {
        while true {
            offlineQueueLock.lock()
            let next = offlineQueue.first
            offlineQueueLock.unlock()
            guard let point = next else { return }

            let ok = await sendPoint(lat: point.lat, lng: point.lng, accuracy: point.accuracy)
            if !ok { return }

            offlineQueueLock.lock()
            if !offlineQueue.isEmpty { offlineQueue.removeFirst() }
            offlineQueueLock.unlock()
        }
    }

    // Returns whether the post actually succeeded (2xx) -- callers use this
    // to decide whether to queue the point for later instead of dropping it.
    private func sendPoint(lat: Double, lng: Double, accuracy: Double) async -> Bool {
        guard let token = token, let serverUrl = serverUrl,
            let url = URL(string: serverUrl + "/api/crew/gps") else { return false }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 8

        let body: [String: Any] = [
            "lat": lat,
            "lng": lng,
            "accuracy": accuracy,
            "gpsPermission": GpsTrackerPlugin.authStatusString(locationManager.authorizationStatus),
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else { return false }
            return (200...299).contains(httpResponse.statusCode)
        } catch {
            return false
        }
    }
}
