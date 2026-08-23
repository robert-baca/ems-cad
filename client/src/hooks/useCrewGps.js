import { useEffect, useRef, useState } from 'react';
import { registerPlugin, Capacitor } from '@capacitor/core';
import { apiBase, PROD_URL } from '../lib/native';

const STALE_MS = 3 * 60 * 1000;

const isNative = () => !!(window.Capacitor?.isNativePlatform?.());

// Android only — custom foreground service (client/android/.../GpsTrackerPlugin.java).
// There is no iOS implementation of this plugin.
let _tracker = null;
function getTracker() {
  if (!_tracker) _tracker = registerPlugin('GpsTracker');
  return _tracker;
}

// iOS background tracking (real native impl compiled in — see CapApp-SPM/Package.swift
// and the NSLocationAlways*/UIBackgroundModes entries in Info.plist). Also used on both
// platforms just for the settings deep link.
let _bgGeo = null;
function getBackgroundGeolocation() {
  if (!_bgGeo) _bgGeo = registerPlugin('BackgroundGeolocation');
  return _bgGeo;
}

// iOS-only custom plugin (client/ios/App/App/LocationAuthPlugin.swift) — the only way
// to tell "While Using" apart from "Always", since neither @capacitor/geolocation nor
// the background-geolocation plugin expose that distinction to JS. Reported alongside
// every GPS post so dispatch can see which phones are stuck at While Using (GPS drops
// the moment the screen locks) without having to check each one by hand.
let _locationAuth = null;
function getLocationAuth() {
  if (!_locationAuth) _locationAuth = registerPlugin('LocationAuth');
  return _locationAuth;
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

      const postGpsJs = async (lat, lng, accuracy) => {
        try {
          let gpsPermission;
          try {
            if (Capacitor.getPlatform() === 'ios') {
              gpsPermission = (await withTimeout(getLocationAuth().getStatus(), 3000)).status;
            } else {
              gpsPermission = (await withTimeout(getTracker().getStatus(), 3000)).status;
            }
          } catch {}
          await fetch(`${apiBase()}/crew/gps`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ lat, lng, accuracy, gpsPermission })
          });
        } catch {}
      };

      let cancelled = false;
      let stationaryIntervalId = null;
      const platform = Capacitor.getPlatform();

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

      // iOS: no native GpsTracker service exists, so use the real background-geolocation
      // plugin (CLLocationManager-backed — keeps posting after the app backgrounds/screen locks).
      const startIosTracking = async () => {
        const bgGeo = getBackgroundGeolocation();
        const opts = {
          backgroundMessage:  'EMS Crew GPS is active.',
          backgroundTitle:    'EMS Crew Tracking',
          requestPermissions: true,
          stale:              true,
          // 5m, not 0 — sub-5m jitter gets thrown away by the accuracy/movement
          // filtering in cb() below anyway, so letting CoreLocation filter it
          // out before ever waking the JS bridge saves battery for free. Safe
          // specifically because the "still alive while stationary" signal
          // below comes from the independent 30s poll, not from this watcher's
          // callback cadence, so there's no heartbeat trade-off from this.
          distanceFilter:     5,
        };
        const HEARTBEAT_MS = 5000;
        // Matches the Android tracker's watchdog: some iOS scenarios (a
        // CoreLocation glitch, the OS quietly deprioritizing the app) can stop
        // the watcher from ever calling back again with no error either —
        // silent, not a thrown exception. Recorded on every callback,
        // success or error, since either proves the pipe itself is still
        // alive; only true silence means it's actually stuck.
        const WATCHDOG_STALE_MS = 75000;
        let lastPostMs = 0;
        let lastCallbackMs = Date.now();
        const cb = (location, error) => {
          lastCallbackMs = Date.now();
          if (cancelled) return;
          if (error) {
            if (error.code === 'NOT_AUTHORIZED') setBgPermNeeded(true);
            return;
          }
          setBgPermNeeded(false);
          if (!location) return;
          // Matches the Android tracker's accuracy filter — near large structures
          // (e.g. walking to a call through the park's rides) a degraded fix used
          // to be dropped unconditionally, which meant NO fix got through for as
          // long as the unit stayed in a bad-accuracy zone — freezing the pin for
          // the whole response instead of just being less precise. A heartbeat
          // fallback still lets a degraded fix through periodically so the pin
          // keeps moving.
          //
          // But a fix can also be bad in a different way: with no GPS at all
          // (e.g. indoors in a station building), the OS can fall back to
          // network/cell-tower positioning that's off by hundreds of meters to
          // miles. That's worse than a stale pin — it confidently shows dispatch
          // the wrong location. MAX_HEARTBEAT_ACCURACY_M rejects those even on
          // the heartbeat; only MAX_ACCURACY_M is waived for it.
          const MAX_ACCURACY_M = 50;
          const MAX_HEARTBEAT_ACCURACY_M = 300;
          if (location.accuracy != null && location.accuracy > MAX_HEARTBEAT_ACCURACY_M) return;
          const accurateEnough = location.accuracy == null || location.accuracy <= MAX_ACCURACY_M;
          const heartbeatDue = Date.now() - lastPostMs >= HEARTBEAT_MS;
          if (!accurateEnough && !heartbeatDue) return;
          lastPostMs = Date.now();
          postGpsJs(location.latitude, location.longitude, location.accuracy);
        };

        // Service binding can be async right after launch — retry a few times before giving up.
        for (let attempt = 0; attempt < 8; attempt++) {
          if (cancelled) return;
          try {
            const id = await bgGeo.addWatcher(opts, cb);
            if (cancelled) { bgGeo.removeWatcher({ id }).catch(() => {}); return; }
            watchIdRef.current = id;
            setGpsStatus('background GPS active');

            // CoreLocation's continuous watcher can go quiet indefinitely once the
            // phone is stationary (screen locked, sitting at a post) — there's no
            // OS-level guarantee of a periodic callback the way Android's foreground
            // service has a timed heartbeat. If dispatch clears a stale pin while
            // the phone genuinely isn't moving, nothing would ever post again. Poll
            // for a one-shot fix on an interval as a backstop.
            stationaryIntervalId = setInterval(async () => {
              if (cancelled) return;
              // Watchdog: the watcher itself has gone completely silent (no
              // callback at all, success or error) for too long — re-register
              // it from scratch rather than just leaning on the one-shot
              // backstop below, so continuous tracking actually resumes
              // instead of limping along on 30s polls indefinitely.
              if (Date.now() - lastCallbackMs > WATCHDOG_STALE_MS) {
                try {
                  await bgGeo.removeWatcher({ id: watchIdRef.current }).catch(() => {});
                  if (cancelled) return;
                  const newId = await bgGeo.addWatcher(opts, cb);
                  if (cancelled) { bgGeo.removeWatcher({ id: newId }).catch(() => {}); return; }
                  watchIdRef.current = newId;
                  lastCallbackMs = Date.now();
                } catch {}
              }
              try {
                const { Geolocation } = await import('@capacitor/geolocation');
                const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 10000 });
                if (cancelled || !pos) return;
                // Same wildly-inaccurate-fix guard as the main watcher above —
                // a low-accuracy request makes this more likely, not less.
                if (pos.coords.accuracy != null && pos.coords.accuracy > 300) return;
                postGpsJs(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
              } catch {}
            }, 30000);
            return;
          } catch (e) {
            if (attempt < 7) await new Promise(r => setTimeout(r, 500));
          }
        }
        if (!cancelled) await startForegroundFallback();
      };

      // Android: native foreground service posts GPS directly without JS involvement.
      const startAndroidTracking = async () => {
        try {
          const { Geolocation } = await import('@capacitor/geolocation');
          const status = await Geolocation.requestPermissions({ permissions: ['location'] });
          if (!cancelled) setBgPermNeeded(status.location !== 'granted');
        } catch {}
        if (cancelled) return;
        try {
          const { LocalNotifications } = await import('@capacitor/local-notifications');
          await LocalNotifications.requestPermissions();
        } catch {}
        if (cancelled) return;

        try {
          await getTracker().startTracking({ token, serverUrl: PROD_URL });
          if (!cancelled) setGpsStatus('native service running');
        } catch (e) {
          if (!cancelled) await startForegroundFallback();
        }
      };

      if (platform === 'ios') {
        startIosTracking();
      } else {
        startAndroidTracking();
      }

      return () => {
        cancelled = true;
        if (stationaryIntervalId) clearInterval(stationaryIntervalId);
        const id = watchIdRef.current;

        if (platform === 'ios') {
          if (id && !(typeof id === 'string' && id.startsWith('geo:'))) {
            getBackgroundGeolocation().removeWatcher({ id }).catch(() => {});
          }
        } else {
          try { getTracker().stopTracking(); } catch {}
        }

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
