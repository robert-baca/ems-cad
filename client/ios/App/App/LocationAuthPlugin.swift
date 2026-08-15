import Capacitor
import CoreLocation

// Exposes the phone's actual CLLocationManager authorization tier to JS.
// @capacitor/geolocation's checkPermissions() collapses "when in use" and
// "always" into the same "granted" status, and the background-geolocation
// community plugin has no status-check method at all — this is the only way
// to tell the two apart from the web layer, which dispatch needs in order to
// see which crew phones are still stuck at "While Using" (GPS drops the
// moment the screen locks) instead of "Always."
@objc(LocationAuthPlugin)
public class LocationAuthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LocationAuthPlugin"
    public let jsName = "LocationAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise)
    ]

    // CLLocationManager is documented to require the main thread/run loop.
    // Capacitor dispatches plugin calls on a background queue by default —
    // creating/reading it there was a likely cause of calls hanging instead
    // of resolving, which (unhandled upstream) could stall a whole GPS post.
    @objc func getStatus(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let status = CLLocationManager().authorizationStatus
            let value: String
            switch status {
            case .authorizedAlways: value = "always"
            case .authorizedWhenInUse: value = "whenInUse"
            case .denied: value = "denied"
            case .restricted: value = "restricted"
            case .notDetermined: value = "notDetermined"
            @unknown default: value = "unknown"
            }
            call.resolve(["status": value])
        }
    }
}
