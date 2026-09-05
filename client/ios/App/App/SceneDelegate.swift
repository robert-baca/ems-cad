import UIKit
import Capacitor
import LocalAuthentication

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    // Brief interruptions (a quick app-switch, a notification, glancing away
    // for a few seconds) don't need a fresh biometric prompt -- only re-lock
    // once the app's been backgrounded longer than this. Same 60s window as
    // Android's MainActivity.LOCK_GRACE_MS. nil pausedAt means "never
    // backgrounded yet" (first launch), which always falls through to a real
    // prompt regardless of this window.
    private let lockGraceInterval: TimeInterval = 60
    private var pausedAt: Date?

    private var lockOverlay: LockOverlayView?
    // Mirrors MainActivity.java's `locked` field, defaulting to true so first
    // launch is always locked.
    private var locked = true
    // Guards against the system Face ID / passcode sheet itself bouncing this
    // scene through resign/become-active (seen as an OEM quirk on Android;
    // guarding here too rather than assuming iOS never does it) -- that's not
    // a real backgrounding event and shouldn't start the grace-period clock
    // or trigger a second concurrent prompt.
    private var authInProgress = false

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = MainViewController()
        window?.makeKeyAndVisible()

        // Show the overlay opaque from the very first frame -- otherwise
        // there'd be a brief flash of the WebView's content before
        // sceneDidBecomeActive fires and starts the real biometric prompt.
        ensureOverlayExists()
        showOverlay()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        if authInProgress { return }
        // sceneDidBecomeActive always follows willConnectTo, so locked's
        // initial "true" value alone already covers first launch here, grace
        // period or not (mirrors MainActivity.onResume's equivalent comment).
        if !locked && withinGracePeriod() {
            lockOverlay?.isHidden = true
            return
        }
        locked = true
        ensureOverlayExists()
        promptUnlock()
    }

    func sceneWillResignActive(_ scene: UIScene) {
        if !authInProgress {
            pausedAt = Date()
        }
        // iOS snapshots the current view hierarchy right after this call for
        // the app-switcher card -- there's no FLAG_SECURE equivalent on iOS to
        // block that outright (see MainActivity.java's FLAG_SECURE comment for
        // the Android side of this), so the best available equivalent is to
        // cover sensitive content before the snapshot is taken. If we're
        // already locked, the overlay is already up and doing this; if not,
        // show a blank cover now and let sceneDidBecomeActive decide whether
        // to remove it (grace period still valid) or turn it into a real
        // unlock prompt.
        ensureOverlayExists()
        if !locked {
            lockOverlay?.showBlankForSnapshot()
        }
        showOverlay()
    }

    private func withinGracePeriod() -> Bool {
        guard let pausedAt = pausedAt else { return false }
        return Date().timeIntervalSince(pausedAt) < lockGraceInterval
    }

    private func ensureOverlayExists() {
        guard lockOverlay == nil, let window = window else { return }
        let overlay = LockOverlayView(frame: window.bounds)
        overlay.translatesAutoresizingMaskIntoConstraints = false
        overlay.onActionTapped = { [weak self] in self?.promptUnlock() }
        overlay.isHidden = true
        window.addSubview(overlay)
        NSLayoutConstraint.activate([
            overlay.topAnchor.constraint(equalTo: window.topAnchor),
            overlay.bottomAnchor.constraint(equalTo: window.bottomAnchor),
            overlay.leadingAnchor.constraint(equalTo: window.leadingAnchor),
            overlay.trailingAnchor.constraint(equalTo: window.trailingAnchor),
        ])
        lockOverlay = overlay
    }

    // Also re-asserts front-most z-order: MainViewController's back button is
    // added to this same window (see its addBackButton() comment) on its own
    // viewDidAppear timing, which isn't guaranteed to run before this, so
    // without this the overlay could end up covered by the button instead of
    // the other way around.
    private func showOverlay() {
        guard let overlay = lockOverlay, let window = window else { return }
        window.bringSubviewToFront(overlay)
        overlay.isHidden = false
    }

    private func promptUnlock() {
        showOverlay()
        lockOverlay?.showPrompting()

        let context = LAContext()
        // .deviceOwnerAuthentication already falls back to the device passcode
        // automatically on iOS if biometrics aren't available/enrolled --
        // unlike Android, where biometric and device-credential are separate
        // Authenticators flags that have to be combined explicitly. The error
        // detail isn't needed: any failure here means "no factor available",
        // which is the one case we branch on below.
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) else {
            // No biometric enrolled AND no device passcode set at all -- there
            // is no local auth factor here to challenge. Stay locked and guide
            // the user instead of granting access, mirroring
            // MainActivity.java's showNoDeviceLockState(): the old Android
            // behavior silently failed open in exactly this case, which is a
            // real (already-fixed) security bug, not something to reintroduce
            // here. The overlay's "Try Again" button re-runs this check.
            lockOverlay?.showNoAuthFactorState()
            return
        }

        authInProgress = true
        context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Authenticate to continue") { [weak self] success, _ in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.authInProgress = false
                if success {
                    self.locked = false
                    self.lockOverlay?.isHidden = true
                }
                // Failure/cancellation: overlay and its "Unlock" button stay
                // up, no auto-retry loop -- mirrors
                // BiometricPrompt.AuthenticationCallback.onAuthenticationError
                // on the Android side.
            }
        }
    }
}
