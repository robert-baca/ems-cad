import { useEffect, useRef, useState } from 'react';
import { registerPlugin } from '@capacitor/core';
import { apiBase, PROD_URL, nativeCall } from '../lib/native';

const STALE_MS = 3 * 60 * 1000;

const isNative = () => !!(window.Capacitor?.isNativePlatform?.());

// Custom native plugin, one implementation per platform (Android:
// client/android/.../GpsTrackerPlugin.java + GpsTrackerService.java; iOS:
// client/ios/App/App/GpsTrackerPlugin.swift), same JS-facing shape on both
// (startTracking/stopTracking/getStatus). Each owns its own OS-level location
// subscription and posts directly via native HTTP, independent of any page's
// JS — deliberately NOT built on a JS-callback-based watcher, since that
// stops working the moment the WebView navigates to a different origin (e.g.
// checking QI/Education, which live on separate domains from cad.sfotems.com)
// and Capacitor resets its bridge on every page load either way.
//
// Deliberately NOT using @capacitor/core's registerPlugin() proxy here.
// Confirmed via a live diagnostic dump on a real device: window.Capacitor.
// Plugins includes "GpsTracker" (the JS-side proxy object exists), but
// window.Capacitor.PluginHeaders never gets an entry for it, on iOS,
// permanently, regardless of page/origin -- registerPlugin()'s proxy checks
// PluginHeaders on every call and throws "plugin is not implemented" since
// it never finds one, even though the plugin is registered and working
// natively (confirmed via GpsTrackerPlugin's own NSLog output). Calling
// window.Capacitor.nativePromise() directly bypasses that check entirely --
// it's the same low-level dispatch registerPlugin()'s proxy would have used
// anyway, just without the broken PluginHeaders lookup gating it.
function callGpsTracker(method, options = {}) {
  return window.Capacitor.nativePromise('GpsTracker', method, options);
}

// Used only for the "open location settings" deep link (openGpsSettings below) —
// unrelated to which plugin actually tracks location on either platform.
let _bgGeo = null;
function getBackgroundGeolocation() {
  if (!_bgGeo) _bgGeo = registerPlugin('BackgroundGeolocation');
  return _bgGeo;
}

// Stops the native tracker. Deliberately NOT called from this hook's effect
// cleanup (see below) — call this explicitly from the real "stop" moments
// (End Tracking, Sign out, opting out of GPS sharing).
export function stopCrewGpsTracking() {
  if (!isNative()) return;
  try { callGpsTracker('stopTracking'); } catch {}
}

export function useCrewGps({ token, unit, enabled = true }) {
  const unitRef     = useRef(unit);
  const wakeLockRef = useRef(null);
  const watchIdRef  = useRef(null);
  const [bgPermNeeded, setBgPermNeeded] = useState(false);
  const [gpsStatus,    setGpsStatus]    = useState('idle');

  unitRef.current = unit;

  // Re-acquire wake lock when tab becomes visible again (web only)
  useEffect(() => {
    if (isNative()) return;
    const reacquire = async () => {
      if (document.visibilityState === 'visible' && 'wakeLock' in navigator) {
        try { wakeLockRef.current = await navigator.wakeLock.request('screen'); } catch {}
      }
    };
    document.addEventListener('visibilitychange', reacquire);
    return () => document.removeEventListener('visibilitychange', reacquire);
  }, []);

  useEffect(() => {
    if (!enabled || !token) return;

    if (isNative()) {
      // A hung native call here must never block the actual GPS post below —
      // this is a nice-to-have status report, not something worth freezing
      // tracking over. Races it against a timeout instead of a bare await.
      const withTimeout = (promise, ms) =>
        Promise.race([
          promise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
        ]);

      // Only used by the rare foreground-fallback path below (the native
      // plugin call itself throwing) — the normal path posts natively with
      // no JS involved at all, on both platforms.
      const postGpsJs = async (lat, lng, accuracy) => {
        try {
          let gpsPermission;
          try {
            gpsPermission = (await withTimeout(callGpsTracker('getStatus'), 3000)).status;
          } catch {}
          await fetch(`${apiBase()}/crew/gps`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ lat, lng, accuracy, gpsPermission })
          });
        } catch {}
      };

      let cancelled = false;

      const startForegroundFallback = async () => {
        setGpsStatus('falling back to foreground GPS...');
        try {
          const { Geolocation } = await import('@capacitor/geolocation');
          const id = await Geolocation.watchPosition(
            { enableHighAccuracy: true },
            (pos) => { if (pos && !cancelled) postGpsJs(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy); }
          );
          if (cancelled) {
            Geolocation.clearWatch({ id }).catch(() => {});
            return;
          }
          watchIdRef.current = `geo:${id}`;
          setGpsStatus('foreground GPS active');
        } catch (e2) {
          if (!cancelled) setGpsStatus(`GPS unavailable: ${e2.message}`);
        }
      };

      // Same custom native plugin on both platforms (GpsTracker — Android:
      // GpsTrackerPlugin.java/GpsTrackerService.java, iOS: GpsTrackerPlugin.swift).
      // Each owns its own OS-level location subscription and posts directly via
      // native HTTP, independent of this page's JS, so tracking survives
      // navigating away to check QI/Education/Admin/etc. and back. Deliberately
      // no cleanup-based stop here (see stopCrewGpsTracking, called explicitly
      // from CrewMobile's End Tracking / Sign out / GPS-sharing-opt-out) — both
      // native implementations guard startTracking() to be a safe no-op if
      // already running, so this effect re-running (e.g. on a 30-minute JWT
      // refresh, or simply remounting after other in-app navigation) never
      // duplicates the location subscription.
      const startTracking = async () => {
        try {
          const status = await nativeCall('Geolocation', 'requestPermissions', { permissions: ['location'] });
          if (!cancelled) setBgPermNeeded(status.location !== 'granted');
        } catch {}
        if (cancelled) return;
        try {
          await nativeCall('LocalNotifications', 'requestPermissions');
        } catch {}
        if (cancelled) return;

        try {
          await callGpsTracker('startTracking', { token, serverUrl: PROD_URL });
          if (!cancelled) setGpsStatus('native tracker running');
        } catch (e) {
          if (!cancelled) await startForegroundFallback();
        }
      };

      startTracking();

      // Live permission-loss detection: the check inside startTracking() only
      // reflects state at mount. Re-polling means revoking location access
      // mid-shift (or Android re-enabling battery restrictions) still surfaces
      // the "needs background access" banner, instead of GPS silently going
      // stale with no on-screen indication anything's wrong. Each platform's
      // getStatus() reports a different shape (Android: no_permission/ok/
      // battery_restricted; iOS: always/whenInUse/denied/etc) so what counts
      // as "needs attention" is interpreted per platform.
      const permissionPollId = setInterval(async () => {
        try {
          const { status } = await withTimeout(callGpsTracker('getStatus'), 3000);
          if (cancelled) return;
          const isIos = window.Capacitor?.getPlatform?.() === 'ios';
          setBgPermNeeded(isIos ? status !== 'always' : status !== 'ok');
        } catch {}
      }, 60000);

      return () => {
        cancelled = true;
        clearInterval(permissionPollId);
        // Only ever cleans up the rare foreground-fallback watch (which is
        // JS-callback-based and wouldn't survive cross-origin navigation
        // anyway) — the native tracker itself is untouched here by design.
        const id = watchIdRef.current;
        if (id && typeof id === 'string' && id.startsWith('geo:')) {
          import('@capacitor/geolocation').then(({ Geolocation }) => {
            Geolocation.clearWatch({ id: id.slice(4) }).catch(() => {});
          }).catch(() => {});
        }
        watchIdRef.current = null;
      };
    } else {
      // Web path — browser geolocation + screen wake lock
      if (!navigator.geolocation) return;

      if ('wakeLock' in navigator) {
        navigator.wakeLock.request('screen')
          .then(lock => { wakeLockRef.current = lock; })
          .catch(() => {});
      }

      const postIfStale = (lat, lng) => {
        const u = unitRef.current;
        const lastGps = u?.last_gps_at ? new Date(u.last_gps_at).getTime() : 0;
        if (Date.now() - lastGps < STALE_MS) return;
        fetch('/api/crew/gps', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ lat, lng })
        }).catch(() => {});
      };

      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => postIfStale(pos.coords.latitude, pos.coords.longitude),
        null,
        { enableHighAccuracy: true, maximumAge: 10000 }
      );

      return () => {
        if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
        wakeLockRef.current?.release().catch(() => {});
      };
    }
  }, [enabled, token]);

  const openGpsSettings = () => {
    if (!isNative()) return;
    getBackgroundGeolocation().openSettings().catch(e => console.warn('[gps] openSettings failed', e));
  };

  return { bgPermNeeded, openGpsSettings, gpsStatus };
}
