import { useEffect, useRef, useState } from 'react';
import { registerPlugin } from '@capacitor/core';
import { apiBase, PROD_URL } from '../lib/native';

const STALE_MS = 3 * 60 * 1000;

const isNative = () => !!(window.Capacitor?.isNativePlatform?.());

let _tracker = null;
function getTracker() {
  if (!_tracker) _tracker = registerPlugin('GpsTracker');
  return _tracker;
}

// Already an installed+synced native dependency (see package.json / capacitor.plugins.json)
// even though nothing else in the app calls it — its only job here is the settings deep link.
let _bgGeo = null;
function getBackgroundGeolocation() {
  if (!_bgGeo) _bgGeo = registerPlugin('BackgroundGeolocation');
  return _bgGeo;
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
      const postGpsJs = async (lat, lng) => {
        try {
          await fetch(`${apiBase()}/crew/gps`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ lat, lng })
          });
        } catch {}
      };

      let cancelled = false;

      const startTracking = async () => {
        // Request permissions
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

        // Start native foreground service — posts GPS directly without JS involvement
        try {
          await getTracker().startTracking({ token, serverUrl: PROD_URL });
          if (!cancelled) setGpsStatus('native service running');
        } catch (e) {
          if (cancelled) return;
          // Fall back to JS watchPosition if native service fails
          setGpsStatus('falling back to foreground GPS...');
          try {
            const { Geolocation } = await import('@capacitor/geolocation');
            const id = await Geolocation.watchPosition(
              { enableHighAccuracy: true },
              (pos) => { if (pos && !cancelled) postGpsJs(pos.coords.latitude, pos.coords.longitude); }
            );
            if (cancelled) {
              import('@capacitor/geolocation').then(({ Geolocation: G }) => G.clearWatch({ id }).catch(() => {})).catch(() => {});
              return;
            }
            watchIdRef.current = `geo:${id}`;
            setGpsStatus('foreground GPS active');
          } catch (e2) {
            if (!cancelled) setGpsStatus(`GPS unavailable: ${e2.message}`);
          }
        }
      };

      startTracking();

      return () => {
        cancelled = true;
        // Always stop the native service
        try { getTracker().stopTracking(); } catch {}
        // Stop JS fallback if it was used
        const id = watchIdRef.current;
        if (id && typeof id === 'string' && id.startsWith('geo:')) {
          import('@capacitor/geolocation').then(({ Geolocation }) => {
            Geolocation.clearWatch({ id: id.slice(4) }).catch(() => {});
          }).catch(() => {});
          watchIdRef.current = null;
        }
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
