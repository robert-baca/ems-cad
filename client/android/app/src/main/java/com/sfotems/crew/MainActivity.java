package com.sfotems.crew;

import android.app.KeyguardManager;
import android.content.Context;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebView;
import android.widget.Button;

import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

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
    private boolean locked = true;
    private boolean authInProgress = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GpsTrackerPlugin.class);
        WebView.setWebContentsDebuggingEnabled(true);
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

        showLockOverlay();
    }

    // No native floating back button here -- Android already has a real
    // hardware/gesture back button, handled in JS via App.addListener('backButton')
    // in CrewMobile.jsx. iOS has no equivalent, which is why it gets one
    // (see MainViewController.swift).
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
        Button unlockButton = lockOverlay.findViewById(R.id.lock_unlock_button);
        unlockButton.setOnClickListener(v -> promptUnlock());
        root.addView(lockOverlay);
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

        BiometricManager biometricManager = BiometricManager.from(this);
        boolean biometricAvailable = biometricManager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK)
                == BiometricManager.BIOMETRIC_SUCCESS;
        boolean deviceCredentialAvailable = canUseDeviceCredentialFallback();

        if (!biometricAvailable && !deviceCredentialAvailable) {
            // No biometrics enrolled and no screen lock set -- this device has no
            // local auth factor at all. Fail open rather than block crew-critical
            // CAD access over something outside anyone's control here.
            hideLockOverlay();
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
