import { useEffect, useRef, useState } from 'react';
import { registerPlugin } from '@capacitor/core';
import { apiBase } from '../lib/native';

const STALE_MS = 3 * 60 * 1000;

const isNative = () => !!(window.Capacitor?.isNativePlatform?.());

let _bgGeo = null;
function getBgGeo() {
  if (!_bgGeo) _bgGeo = registerPlugin('BackgroundGeolocation');
  return _bgGeo;
}

export function useCrewGps({ token, unit, enabled = true }) {
  const unitRef        = useRef(unit);
  const wakeLockRef    = useRef(null);
  const watchIdRef     = useRef(null);
  const [bgPermNeeded, setBgPermNeeded] = useState(false);

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

    const postGps = async (lat, lng) => {
      try {
        await fetch(`${apiBase()}/crew/gps`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ lat, lng })
        });
      } catch {}
    };

    if (isNative()) {
      let cancelled = false;

      const startGps = async () => {
        // Request notification permission (Android 13+)
        try {
          const { LocalNotifications } = await import('@capacitor/local-notifications');
          await LocalNotifications.requestPermissions();
        } catch {}

        // Retry addWatcher — service binding is async and may not be ready immediately
        const bgGeo = getBgGeo();
        const opts = {
          backgroundMessage:  'EMS Crew GPS is active.',
          backgroundTitle:    'EMS Crew Tracking',
          requestPermissions: true,
          stale:              true,
          distanceFilter:     0,
        };
        const cb = (location, error) => {
          if (error) {
            if (error.code === 'NOT_AUTHORIZED') setBgPermNeeded(true);
            return;
          }
          setBgPermNeeded(false);
          if (location) postGps(location.latitude, location.longitude);
        };

        for (let attempt = 0; attempt < 8; attempt++) {
          if (cancelled) return;
          try {
            const id = await bgGeo.addWatcher(opts, cb);
            watchIdRef.current = id;
            return; // success
          } catch (e) {
            if (attempt < 7) await new Promise(r => setTimeout(r, 500));
          }
        }

        // Background geolocation failed — fall back to foreground-only geolocation
        try {
          const { Geolocation } = await import('@capacitor/geolocation');
          await Geolocation.requestPermissions({ permissions: ['location'] });
          const id = await Geolocation.watchPosition(
            { enableHighAccuracy: true },
            (pos) => { if (pos) postGps(pos.coords.latitude, pos.coords.longitude); }
          );
          watchIdRef.current = `geo:${id}`;
        } catch (e) {
          console.error('[gps] all GPS methods failed:', e);
        }
      };

      startGps();

      return () => {
        cancelled = true;
        const id = watchIdRef.current;
        if (id) {
          if (typeof id === 'string' && id.startsWith('geo:')) {
            import('@capacitor/geolocation').then(({ Geolocation }) => {
              Geolocation.clearWatch({ id: id.slice(4) }).catch(() => {});
            }).catch(() => {});
          } else {
            getBgGeo().removeWatcher({ id }).catch(() => {});
          }
          watchIdRef.current = null;
        }
      };
    } else {
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
        postGps(lat, lng);
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
    if (isNative()) getBgGeo().openSettings().catch(() => {});
  };

  return { bgPermNeeded, openGpsSettings };
}
