import Capacitor
import WebKit

// Capacitor iOS only auto-registers plugins listed in capacitor.config.json,
// which is generated from npm packages — a local plugin compiled directly
// into the app target (GpsTrackerPlugin.swift) needs to be registered by
// hand here, the iOS equivalent of MainActivity.java's registerPlugin() call
// on Android. Main.storyboard's root view controller is set to this class
// instead of the default CAPBridgeViewController so this actually runs.
class MainViewController: CAPBridgeViewController {
    private var backButton: UIButton?

    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(GpsTrackerPlugin())
    }

    // capacitorDidLoad() fires before the WebView is added to the view
    // hierarchy (per CAPBridgeViewController's own doc comment) -- adding the
    // button there meant the WebView, added afterward in viewDidLoad(), was
    // stacked on top and covered it completely. viewDidAppear() runs after
    // loadWebView() has already added it, so the button reliably ends up on
    // top. Guarded to run once even though viewDidAppear can fire again
    // (e.g. returning from background).
    override open func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        addBackButton()
    }

    // Every page loaded here (portal, CAD, QI, credentials) shares this one
    // WebView, so one native back button covers all of them — iOS has no
    // hardware back button the way Android does, and per-site JS back
    // buttons would need adding separately in every one of those repos.
    private func addBackButton() {
        guard backButton == nil, self.webView != nil else { return }

        let button = UIButton(type: .system)
        button.setTitle("‹", for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: 28, weight: .semibold)
        button.setTitleColor(.white, for: .normal)
        button.backgroundColor = UIColor.black.withAlphaComponent(0.55)
        button.layer.cornerRadius = 22
        button.translatesAutoresizingMaskIntoConstraints = false
        // Always visible rather than tied to webView.canGoBack -- closing an
        // in-app overlay via window.__handleNativeBack (e.g. CrewMobile's
        // disposition/case-summary/case-history/beacon views) doesn't depend
        // on WebView navigation history at all, since those are local React
        // state, not real navigations. Hiding based on canGoBack meant the
        // button could disappear exactly when it was needed to back out of
        // one of those screens. An occasional no-op tap is a much smaller
        // problem than a button that's invisible when it's actually needed.
        button.addTarget(self, action: #selector(goBackTapped), for: .touchUpInside)

        view.addSubview(button)
        NSLayoutConstraint.activate([
            button.widthAnchor.constraint(equalToConstant: 44),
            button.heightAnchor.constraint(equalToConstant: 44),
            button.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            button.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: 16),
        ])
        backButton = button
    }

    @objc private func goBackTapped() {
        guard let webView = self.webView else { return }
        // Some screens (e.g. CrewMobile's disposition/case-summary/case-history/
        // beacon views) are local component state, not real navigations -- plain
        // WebView history has no idea they're "open" and can't close them. Pages
        // that need that can expose window.__handleNativeBack to intercept first;
        // everything else falls through to normal WebView back navigation.
        webView.evaluateJavaScript("window.__handleNativeBack ? window.__handleNativeBack() : false") { result, _ in
            if (result as? Bool) == true { return }
            if webView.canGoBack { webView.goBack() }
        }
    }
}
