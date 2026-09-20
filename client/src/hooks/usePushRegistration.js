import { useEffect, useRef } from 'react';
import { isNative, nativeCall, nativeListener } from '../lib/native';
import { registerPushToken } from '../services/api';

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
export function usePushRegistration({ token, enabled = true }) {
  const startedRef = useRef(false);

  useEffect(() => {
    if (!enabled || !token || !isNative() || startedRef.current) return;
    startedRef.current = true;

    (async () => {
      try {
        const perm = await nativeCall('PushNotifications', 'requestPermissions');
        if (perm?.receive !== 'granted') return;

        // Registered before register() is called below so a registration
        // that resolves synchronously-fast can't fire before this is
        // listening for it.
        nativeListener('PushNotifications', 'registration', (result) => {
          if (!result?.value) return;
          const platform = window.Capacitor?.getPlatform?.() === 'ios' ? 'ios' : 'android';
          registerPushToken(result.value, platform).catch(() => {});
        });
        nativeListener('PushNotifications', 'registrationError', (err) => {
          console.warn('[push] registration failed', err);
        });

        await nativeCall('PushNotifications', 'register');
      } catch (e) {
        console.warn('[push] setup failed', e);
      }
    })();
  }, [enabled, token]);
}
