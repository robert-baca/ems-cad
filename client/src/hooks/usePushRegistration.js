import { useEffect, useRef, useState } from 'react';
import { isNative, nativeCall, nativeListener } from '../lib/native';
import { registerPushToken, reportPushStatus, unregisterPushToken } from '../services/api';

// This phone's current push token, so logout can unregister exactly it.
let currentPushToken = null;

// Call on crew logout, before the auth token is cleared.
export function unregisterPush() {
  if (!currentPushToken) return Promise.resolve();
  const t = currentPushToken;
  currentPushToken = null;
  // Capped so a dead connection can't hold up logging out.
  return Promise.race([
    unregisterPushToken(t).catch(() => {}),
    new Promise(resolve => setTimeout(resolve, 3000)),
  ]);
}

// Forget the token locally without telling the server -- for when the unit
// itself was deleted, so there's nothing left server-side to clear.
export function forgetPushToken() {
  currentPushToken = null;
}

// An app build without working push support (e.g. an old build missing the
// native plugin or its AppDelegate hooks) can accept register() and then
// never answer at all -- neither 'registration' nor 'registrationError'.
// Treat silence as a failure so it shows up instead of staying invisible.
const REGISTRATION_TIMEOUT_MS = 20 * 1000;

// The native 'registration'/'registrationError' listeners can't be removed
// individually (nativeListener has no matching remove), so they're added
// once per app session and forward to whichever hook instance is currently
// mounted. Adding them per mount stacked another pair on every login, each
// firing its own token POST.
let listenersAdded = false;
let activeHandlers = null; // { onToken, onError } of the mounted hook, or null

function ensureListeners() {
  if (listenersAdded) return;
  listenersAdded = true;
  nativeListener('PushNotifications', 'registration', (result) => {
    if (result?.value) activeHandlers?.onToken(result.value);
  });
  nativeListener('PushNotifications', 'registrationError', (err) => {
    console.warn('[push] registration failed', err);
    activeHandlers?.onError(err?.error || err?.message || JSON.stringify(err));
  });
}

// Registers this device for real push notifications (delivered even if the
// app has been fully force-closed) -- separate from the existing
// LocalNotifications-based alerts, which only fire while this app's own
// process is still alive (see the crew:attention_ping/call:assigned_to_me
// handlers in CrewMobile.jsx). Runs once per login (CrewMobile mount), and
// again when retrying after a denial/failure.
//
// Returns the outcome so the crew screen can show it: 'pending' (not tried
// yet / waiting on the OS), 'on', 'denied' (notifications turned off for
// this app), or 'error' (the OS refused to register -- e.g. an iOS build
// missing the push entitlement). Failures are also reported to the server
// so dispatch can see them on the unit card.
export function usePushRegistration({ token, enabled = true }) {
  const startedRef = useRef(false);
  const [pushState, setPushState] = useState('pending');
  const [attempt,   setAttempt]   = useState(0);

  useEffect(() => {
    if (!enabled || !token || !isNative() || startedRef.current) return;
    startedRef.current = true;

    // Everything below is scoped to this run: once it's torn down (logout,
    // or a retry starting), a late answer or the timeout must not touch
    // state or report anything -- the timeout used to fire after logout and
    // send a push-status report with no login attached.
    let live = true;
    let answered = false;
    let timeout = null;

    const settle = () => { answered = true; clearTimeout(timeout); };
    const fail = (message) => {
      if (!live || answered) return;
      settle();
      setPushState('error');
      reportPushStatus('error', message).catch(() => {});
    };

    activeHandlers = {
      onToken: (value) => {
        if (!live) return;
        settle();
        currentPushToken = value;
        const platform = window.Capacitor?.getPlatform?.() === 'ios' ? 'ios' : 'android';
        setPushState('on');
        registerPushToken(value, platform).catch(() => {});
      },
      onError: fail,
    };

    (async () => {
      try {
        const perm = await nativeCall('PushNotifications', 'requestPermissions');
        if (!live) return;
        if (perm?.receive !== 'granted') {
          setPushState('denied');
          reportPushStatus('denied').catch(() => {});
          return;
        }
        // Server pushes target this channel by id (see server push.js); if
        // it doesn't exist on the phone -- setup modal skipped, app
        // reinstalled -- Android silently files them under "Miscellaneous"
        // with no heads-up or strong vibration. Re-creating is a no-op.
        if (window.Capacitor?.getPlatform?.() === 'android') {
          const { createNotifChannel } = await import('./useCrewNotifications');
          await createNotifChannel();
        }
        // Listening before register() so a fast answer can't be missed.
        ensureListeners();
        timeout = setTimeout(
          () => fail("No response from the phone's push service after 20s — app build may be out of date"),
          REGISTRATION_TIMEOUT_MS
        );
        await nativeCall('PushNotifications', 'register');
      } catch (e) {
        console.warn('[push] setup failed', e);
        fail(e?.message || String(e));
      }
    })();

    return () => {
      live = false;
      clearTimeout(timeout);
      if (activeHandlers?.onError === fail) activeHandlers = null;
      startedRef.current = false;
    };
  }, [enabled, token, attempt]);

  // Retry when the app comes back to the foreground after a denial (they
  // may have just turned notifications on in Settings) or a failure (e.g.
  // a timeout on bad signal at startup). requestPermissions() just returns
  // the current state without re-prompting once it's been decided, so this
  // is cheap.
  useEffect(() => {
    if (pushState !== 'denied' && pushState !== 'error') return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      setPushState('pending');
      setAttempt(n => n + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [pushState]);

  return pushState;
}
