package com.sfotems.crew;

import android.app.KeyguardManager;
import android.content.Context;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.TextView;

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

        addBackButton(webView);
        // Added after the back button so it draws on top and fully blocks it
        // while locked -- otherwise the button would poke through the lock
        // screen and let someone navigate before authenticating.
        showLockOverlay();
    }

    // Every page loaded here (portal, CAD, QI, credentials) shares this one
    // WebView, so one native back button covers all of them instead of
    // needing a per-site JS back button added separately in each repo.
    private void addBackButton(WebView webView) {
        ViewGroup root = findViewById(android.R.id.content);
        float density = getResources().getDisplayMetrics().density;

        TextView backButton = new TextView(this);
        backButton.setText("‹");
        backButton.setTextColor(0xFFFFFFFF);
        backButton.setTextSize(24);
        backButton.setGravity(Gravity.CENTER);
        backButton.setElevation(12f);
        backButton.setVisibility(View.GONE);

        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.OVAL);
        bg.setColor(0xCC1F2937);
        backButton.setBackground(bg);

        int sizePx = (int) (44 * density);
        int marginPx = (int) (20 * density);
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(sizePx, sizePx);
        params.gravity = Gravity.BOTTOM | Gravity.START;
        params.setMargins(marginPx, marginPx, marginPx, marginPx);
        backButton.setLayoutParams(params);

        backButton.setOnClickListener(v -> {
            if (webView.canGoBack()) webView.goBack();
        });
        root.addView(backButton);

        // WebView has no canGoBack-changed callback, and replacing Capacitor's
        // own WebViewClient to hook navigation risks breaking its URL/redirect
        // handling -- a light poll is the safe way to keep visibility in sync.
        Runnable poll = new Runnable() {
            @Override
            public void run() {
                backButton.setVisibility(webView.canGoBack() ? View.VISIBLE : View.GONE);
                handler.postDelayed(this, 400);
            }
        };
        handler.post(poll);
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
