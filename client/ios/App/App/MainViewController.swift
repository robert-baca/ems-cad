import Capacitor

// Capacitor iOS only auto-registers plugins listed in capacitor.config.json,
// which is generated from npm packages — a local plugin compiled directly
// into the app target (GpsTrackerPlugin.swift) needs to be registered by
// hand here, the iOS equivalent of MainActivity.java's registerPlugin() call
// on Android. Main.storyboard's root view controller is set to this class
// instead of the default CAPBridgeViewController so this actually runs.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(GpsTrackerPlugin())
    }
}
