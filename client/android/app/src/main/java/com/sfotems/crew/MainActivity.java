package com.sfotems.crew;

import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.provider.Settings;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.TextView;

import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSExport;
import com.getcapacitor.PluginHandle;
import com.getcapacitor.WebViewListener;
import com.sfotems.crew.BuildConfig;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executor;

public class MainActivity extends BridgeActivity {
    // Some OEM skins bounce the host Activity through pause/resume while
    // dismissing the system biometric prompt AFTER the auth callback already
    // fired, not just during it -- a short settle delay before clearing
    // authInProgress absorbs that bounce so it doesn't immediately re-lock
    // and re-prompt right after a real, successful unlock.
    private static final long AUTH_SETTLE_MS = 500;
    private final android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());

    // Brief interruptions (a quick app-switch, a notification, glancing away
    // for a few seconds) don't need a fresh biometric prompt -- only re-lock
    // once the app's been backgrounded longer than this. 0 means "never
    // paused yet" (first launch), which always falls through to a real
    // prompt regardless of this window.
    private static final long LOCK_GRACE_MS = 60_000;
    private long pausedAtMs = 0;

    private View lockOverlay;
    private TextView lockSubtitle;
    private Button unlockButton;
    private Button openSettingsButton;
    private boolean locked = true;
    private boolean authInProgress = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GpsTrackerPlugin.class);
        // Remote WebView debugging (chrome://inspect) exposes localStorage (JWTs) and
        // live network/GPS traffic to anyone with brief physical/USB access, bypassing
        // the biometric lock entirely since inspection happens below the UI layer.
        // Only ever enable it in debug builds.
        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true);
        }
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        // Blocks screenshots/screen-recording and blanks the Recents thumbnail --
        // the app can show active-call/crew screens, so this stays on at all times,
        // not just while locked.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);

        // Pinch-zoom and the rubber-band overscroll glow read as "a website in a
        // browser" rather than an app -- every page loaded here (portal, CAD, QI,
        // inventory) shares this one WebView, so fixing it natively here once
        // covers all of them instead of needing a per-page CSS change in each repo.
        WebView webView = bridge.getWebView();
        webView.getSettings().setSupportZoom(false);
        webView.getSettings().setBuiltInZoomControls(false);
        webView.getSettings().setDisplayZoomControls(false);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);

        addBackHandler(webView);
        fixMissingPluginBridgeOnSecondaryOrigins(webView);
        showLockOverlay();
    }

    // Capacitor's own bridge injection (window.Capacitor.PluginHeaders, plus
    // the nativePromise/nativeCallback/addListener functions every plugin call
    // needs) is scoped to this app's primary configured origin (server.url =
    // sfotems.com) -- confirmed via a diagnostic dump added to the crash
    // overlay, which showed PluginHeaders as an empty array on
    // cad.sfotems.com/crew even though every plugin is registered correctly
    // natively. allowNavigation lets the WebView *load* other origins, but
    // Capacitor never re-injects its bridge for them, so every plugin call
    // made from JS running on cad.sfotems.com (GPS start/stop, location
    // permission requests, etc.) was silently doomed regardless of native-side
    // fixes. This re-injects the missing pieces by hand on any page where
    // Capacitor's own injection didn't happen, using its own JSExport so the
    // generated JS stays identical to what a correctly-injected primary origin
    // would get.
    //
    // NOTE: this list must be kept in sync with the plugins actually
    // registered (see MainActivity's manual registerPlugin call above, plus
    // whatever @capacitor/* / @capgo/* packages are npm dependencies) --
    // update it when adding or removing a native plugin.
    private static final String[] KNOWN_PLUGIN_IDS = {
        "CapacitorCookies", "WebView", "CapacitorHttp", "SystemBars",
        "GpsTracker", "BackgroundGeolocation", "Browser", "Geolocation",
        "LocalNotifications", "StatusBar", "NativeBiometric"
    };

    private void fixMissingPluginBridgeOnSecondaryOrigins(WebView webView) {
        bridge.addWebViewListener(
            new WebViewListener() {
                @Override
                public void onPageLoaded(WebView view) {
                    view.evaluateJavascript(
                        "!!(window.Capacitor && window.Capacitor.PluginHeaders && window.Capacitor.PluginHeaders.length)",
                        result -> {
                            if (!"true".equals(result)) {
                                injectPluginBridge(view);
                            }
                        }
                    );
                }
            }
        );
    }

    private void injectPluginBridge(WebView webView) {
        List<PluginHandle> handles = new ArrayList<>();
        for (String id : KNOWN_PLUGIN_IDS) {
            PluginHandle handle = bridge.getPlugin(id);
            if (handle != null) handles.add(handle);
        }
        try {
            String bridgeJS = JSExport.getBridgeJS(getApplicationContext());
            String pluginJS = JSExport.getPluginJS(handles);
            webView.evaluateJavascript(bridgeJS + "\n" + pluginJS, null);
        } catch (Exception ex) {
            android.util.Log.e("MainActivity", "Failed to inject fallback plugin bridge", ex);
        }
    }

    // Hardware/gesture back calls into window.__handleNativeBack (set by
    // CrewMobile.jsx) via a plain JS evaluation, mirroring the floating button
    // on iOS (see MainViewController.swift) -- @capacitor/app's own JS bridge
    // call (App.addListener('backButton', ...)) turned out to be unreliable
    // here: this app runs with a remote server.url (sfotems.com) as its
    // primary origin, and Capacitor only fully re-injects its native bridge
    // (window.Capacitor.PluginHeaders) for that primary origin -- cad.sfotems.com,
    // reached via allowNavigation, loads without it, so any @capacitor/app call
    // there throws "plugin is not implemented" even though it's registered
    // natively. evaluateJavascript() doesn't go through that machinery at all.
    private void addBackHandler(WebView webView) {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                webView.evaluateJavascript(
                    "window.__handleNativeBack ? window.__handleNativeBack() : false",
                    result -> {
                        if ("true".equals(result)) return;
                        if (webView.canGoBack()) {
                            webView.goBack();
                        } else {
                            moveTaskToBack(true);
                        }
                    }
                );
            }
        });
    }

    @Override
    public void onResume() {
        super.onResume();
        if (authInProgress) return;
        // onResume always follows onCreate, so locked's initial "true" value
        // alone already covers first launch here, grace period or not.
        if (!locked && withinGracePeriod()) return;
        locked = true;
        promptUnlock();
    }

    @Override
    public void onPause() {
        super.onPause();
        // Keep WebView JS running after screen turns off so socket/UI updates continue
        bridge.getWebView().onResume();
        // Record when we left, unless this pause was caused by the biometric
        // prompt itself taking focus (some OS versions/OEM skins cycle the host
        // Activity through pause/resume while the system prompt is shown) --
        // that's not a real backgrounding event and shouldn't start the clock.
        if (!authInProgress) {
            pausedAtMs = System.currentTimeMillis();
        }
    }

    private boolean withinGracePeriod() {
        return pausedAtMs != 0 && (System.currentTimeMillis() - pausedAtMs) < LOCK_GRACE_MS;
    }

    private void showLockOverlay() {
        if (lockOverlay != null) return;
        ViewGroup root = findViewById(android.R.id.content);
        lockOverlay = getLayoutInflater().inflate(R.layout.lock_overlay, root, false);
        lockSubtitle = lockOverlay.findViewById(R.id.lock_subtitle);
        unlockButton = lockOverlay.findViewById(R.id.lock_unlock_button);
        openSettingsButton = lockOverlay.findViewById(R.id.lock_open_settings_button);
        // Doubles as "Try Again" when there's no device lock at all -- re-runs the
        // canAuthenticate() check in case the user just set one up.
        unlockButton.setOnClickListener(v -> promptUnlock());
        openSettingsButton.setOnClickListener(v ->
                startActivity(new Intent(Settings.ACTION_SECURITY_SETTINGS)));
        root.addView(lockOverlay);
    }

    // Resets the overlay back to its normal "prompting" copy/buttons before each
    // promptUnlock() attempt, so a previous "no device lock" state doesn't linger
    // once a real authenticator becomes available.
    private void resetLockOverlayState() {
        if (lockSubtitle != null) lockSubtitle.setText("Locked for your protection");
        if (unlockButton != null) unlockButton.setText("Unlock");
        if (openSettingsButton != null) openSettingsButton.setVisibility(View.GONE);
    }

    // No biometric enrolled AND no device PIN/pattern/password set -- there is no
    // local auth factor at all to challenge. Stay locked and guide the user to set
    // one up rather than failing open.
    private void showNoDeviceLockState() {
        if (lockSubtitle != null) {
            lockSubtitle.setText("Set a screen lock on this device to continue");
        }
        if (unlockButton != null) unlockButton.setText("Try Again");
        if (openSettingsButton != null) openSettingsButton.setVisibility(View.VISIBLE);
    }

    private void hideLockOverlay() {
        locked = false;
        if (lockOverlay != null) {
            lockOverlay.setVisibility(View.GONE);
        }
    }

    private boolean canUseDeviceCredentialFallback() {
        KeyguardManager keyguardManager = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
        return keyguardManager != null && keyguardManager.isDeviceSecure();
    }

    private void promptUnlock() {
        if (lockOverlay != null) {
            lockOverlay.setVisibility(View.VISIBLE);
        }
        resetLockOverlayState();

        BiometricManager biometricManager = BiometricManager.from(this);
        boolean biometricAvailable = biometricManager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK)
                == BiometricManager.BIOMETRIC_SUCCESS;
        boolean deviceCredentialAvailable = canUseDeviceCredentialFallback();

        if (!biometricAvailable && !deviceCredentialAvailable) {
            // No biometrics enrolled AND no device PIN/pattern/password set -- this
            // device has no local auth factor at all to challenge. Previously this
            // failed open (hideLockOverlay()) and granted full access with zero
            // authentication -- exactly the scenario where the lock matters most
            // (e.g. a lost phone with no screen lock exposing live crew/call data).
            // Stay locked and guide the user to set a device lock instead; the
            // "Try Again"/unlock button re-runs this check.
            showNoDeviceLockState();
            return;
        }

        BiometricPrompt.PromptInfo.Builder infoBuilder = new BiometricPrompt.PromptInfo.Builder()
                .setTitle("Unlock EMS Crew")
                .setSubtitle("Authenticate to continue");

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            infoBuilder.setAllowedAuthenticators(
                    BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL);
        } else if (deviceCredentialAvailable) {
            infoBuilder.setDeviceCredentialAllowed(true);
        } else {
            infoBuilder.setNegativeButtonText("Cancel");
        }

        Executor executor = ContextCompat.getMainExecutor(this);
        BiometricPrompt prompt = new BiometricPrompt(this, executor, new BiometricPrompt.AuthenticationCallback() {
            @Override
            public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                super.onAuthenticationSucceeded(result);
                hideLockOverlay();
                handler.postDelayed(() -> authInProgress = false, AUTH_SETTLE_MS);
            }

            @Override
            public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                super.onAuthenticationError(errorCode, errString);
                // Overlay and its manual "Unlock" button stay up; no auto-retry loop.
                handler.postDelayed(() -> authInProgress = false, AUTH_SETTLE_MS);
            }

            @Override
            public void onAuthenticationFailed() {
                super.onAuthenticationFailed();
                // A single unrecognized attempt -- the system prompt stays open on
                // its own for further tries, nothing to do here.
            }
        });

        authInProgress = true;
        prompt.authenticate(infoBuilder.build());
    }
}
