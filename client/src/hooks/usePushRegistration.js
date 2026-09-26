import { useEffect, useRef, useState } from 'react';
import { isNative, nativeCall, nativeListener } from '../lib/native';
import { registerPushToken, reportPushStatus } from '../services/api';

// Registers this device for real push notifications (delivered even if the
// app has been fully force-closed) -- separate from the existing
// LocalNotifications-based alerts, which only fire while this app's own
// process is still alive (see the crew:attention_ping/call:assigned_to_me
// handlers in CrewMobile.jsx). Fire-and-forget, set up once per login
// session rather than tied to component mount/unmount -- same reasoning as
// useCrewGps.js's native tracker not being torn down on unmount, since the
// registration itself (and the listener waiting on its result) has no
// reason to restart just because the crew member navigated to a different
// screen in the app.
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

    (async () => {
      try {
        const perm = await nativeCall('PushNotifications', 'requestPermissions');
        if (perm?.receive !== 'granted') {
          setPushState('denied');
          reportPushStatus('denied').catch(() => {});
          return;
        }

        // Registered before register() is called below so a registration
        // that resolves synchronously-fast can't fire before this is
        // listening for it.
        nativeListener('PushNotifications', 'registration', (result) => {
          if (!result?.value) return;
          const platform = window.Capacitor?.getPlatform?.() === 'ios' ? 'ios' : 'android';
          setPushState('on');
          registerPushToken(result.value, platform).catch(() => {});
        });
        nativeListener('PushNotifications', 'registrationError', (err) => {
          console.warn('[push] registration failed', err);
          setPushState('error');
          reportPushStatus('error', err?.error || err?.message || JSON.stringify(err)).catch(() => {});
        });

        await nativeCall('PushNotifications', 'register');
      } catch (e) {
        console.warn('[push] setup failed', e);
        setPushState('error');
        reportPushStatus('error', e?.message || String(e)).catch(() => {});
      }
    })();
  }, [enabled, token, attempt]);

  // After the user flips notifications on in Settings and comes back, try
  // again -- requestPermissions() just returns the current state without
  // re-prompting once it's been decided, so this is cheap.
  useEffect(() => {
    if (pushState !== 'denied') return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      startedRef.current = false;
      setPushState('pending');
      setAttempt(n => n + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [pushState]);

  return pushState;
}
