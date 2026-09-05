import UIKit

// Full-screen opaque view that blocks all interaction with the app underneath
// while locked -- mirrors android/.../res/layout/lock_overlay.xml (same
// colors/copy for visual parity) plus MainActivity.java's showLockOverlay()/
// resetLockOverlayState()/showNoDeviceLockState(). This is added directly to
// the window rather than as a subview of MainViewController's own view: that
// controller's view IS the WKWebView itself (CAPBridgeViewController.loadView()
// does `view = webView`, see MainViewController's addBackButton() comment), so
// anything meant to sit visually on top of all page content -- and above the
// window-level back button -- has to attach to the window instead.
class LockOverlayView: UIView {
    private let titleLabel = UILabel()
    private let subtitleLabel = UILabel()
    private let settingsHintLabel = UILabel()
    private let actionButton = UIButton(type: .system)

    var onActionTapped: (() -> Void)?

    override init(frame: CGRect) {
        super.init(frame: frame)

        backgroundColor = UIColor(red: 17 / 255, green: 24 / 255, blue: 39 / 255, alpha: 1) // #111827
        isUserInteractionEnabled = true // blocks taps from reaching the WebView beneath, same intent as clickable/focusable on the Android layout

        titleLabel.text = "Six Flags EMS CAD"
        titleLabel.textColor = UIColor(red: 249 / 255, green: 250 / 255, blue: 251 / 255, alpha: 1) // #F9FAFB
        titleLabel.font = .systemFont(ofSize: 20, weight: .bold)
        titleLabel.textAlignment = .center

        subtitleLabel.textColor = UIColor(red: 156 / 255, green: 163 / 255, blue: 175 / 255, alpha: 1) // #9CA3AF
        subtitleLabel.font = .systemFont(ofSize: 14)
        subtitleLabel.textAlignment = .center
        subtitleLabel.numberOfLines = 0

        // Only ever shown in the no-auth-factor state -- there's no iOS API to
        // deep-link into Settings > Face ID & Passcode the way Android's
        // Settings.ACTION_SECURITY_SETTINGS intent does (openSettingsURLString
        // only opens this app's own settings page), so this is plain
        // instructional text rather than a button, unlike the Android layout's
        // "Open Security Settings" button.
        settingsHintLabel.textColor = UIColor(red: 156 / 255, green: 163 / 255, blue: 175 / 255, alpha: 1)
        settingsHintLabel.font = .systemFont(ofSize: 13)
        settingsHintLabel.textAlignment = .center
        settingsHintLabel.numberOfLines = 0
        settingsHintLabel.text = "Go to Settings \u{2192} Face ID & Passcode to set a device passcode"
        settingsHintLabel.isHidden = true

        actionButton.setTitleColor(.white, for: .normal)
        actionButton.titleLabel?.font = .systemFont(ofSize: 16, weight: .semibold)
        actionButton.backgroundColor = UIColor(red: 22 / 255, green: 163 / 255, blue: 74 / 255, alpha: 1) // #16A34A
        actionButton.layer.cornerRadius = 8
        actionButton.contentEdgeInsets = UIEdgeInsets(top: 12, left: 24, bottom: 12, right: 24)
        actionButton.addTarget(self, action: #selector(actionTapped), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [titleLabel, subtitleLabel, settingsHintLabel, actionButton])
        stack.axis = .vertical
        stack.spacing = 14
        stack.alignment = .center
        stack.setCustomSpacing(28, after: subtitleLabel)
        stack.translatesAutoresizingMaskIntoConstraints = false

        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerYAnchor.constraint(equalTo: centerYAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor, constant: 32),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -32),
            stack.centerXAnchor.constraint(equalTo: centerXAnchor),
        ])

        showPrompting()
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    @objc private func actionTapped() {
        onActionTapped?()
    }

    // Default/reset state before each promptUnlock() attempt -- mirrors
    // MainActivity.java's resetLockOverlayState(), so a previous "no device
    // lock" state doesn't linger once a real authenticator becomes available.
    func showPrompting() {
        subtitleLabel.text = "Locked for your protection"
        settingsHintLabel.isHidden = true
        actionButton.setTitle("Unlock", for: .normal)
        setContentHidden(false)
    }

    // No biometric enrolled AND no device passcode set at all -- mirrors
    // MainActivity.java's showNoDeviceLockState(): stay locked and guide the
    // user instead of failing open, which was a real (already-fixed) bug on
    // Android.
    func showNoAuthFactorState() {
        subtitleLabel.text = "Set a screen lock on this device to continue"
        settingsHintLabel.isHidden = false
        actionButton.setTitle("Try Again", for: .normal)
        setContentHidden(false)
    }

    // Used only while backgrounding an already-unlocked app, purely to keep
    // sensitive content out of the app-switcher snapshot iOS takes right
    // after sceneWillResignActive -- not an actual lock state, so none of the
    // prompt copy/button belongs on screen for it.
    func showBlankForSnapshot() {
        setContentHidden(true)
    }

    private func setContentHidden(_ hidden: Bool) {
        titleLabel.isHidden = hidden
        subtitleLabel.isHidden = hidden
        actionButton.isHidden = hidden
        if hidden { settingsHintLabel.isHidden = true }
    }
}
