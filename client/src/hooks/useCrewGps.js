import { useEffect, useRef } from 'react';

const STALE_MS = 3 * 60 * 1000; // web-only: browser GPS fires only when Traccar hasn't pinged in 3 min

const isNative = () => !!(window.Capacitor?.isNativePlatform?.());

export function useCrewGps({ token, unit, enabled = true }) {
  const unitRef    = useRef(unit);
  const wakeLockRef = useRef(null);
  const watchRef   = useRef(null);

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
        await fetch('/api/crew/gps', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ lat, lng })
        });
      } catch {}
    };

    if (isNative()) {
      // ── Native Android app: Capacitor GPS, always send, no Traccar needed ──
      let watchId = null;
      (async () => {
        try {
          const { Geolocation } = await import('@capacitor/geolocation');
          await Geolocation.requestPermissions({ permissions: ['location', 'coarseLocation'] });
          watchId = await Geolocation.watchPosition(
            { enableHighAccuracy: true, timeout: 15000 },
            (pos, err) => {
              if (pos) postGps(pos.coords.latitude, pos.coords.longitude);
            }
          );
          watchRef.current = watchId;
        } catch (e) {
          console.error('[gps] Capacitor geolocation error:', e);
        }
      })();
      return () => {
        if (watchRef.current !== null) {
          import('@capacitor/geolocation').then(({ Geolocation }) => {
            Geolocation.clearWatch({ id: watchRef.current });
          }).catch(() => {});
        }
      };
    } else {
      // ── Web browser: fallback GPS, only fires when Traccar hasn't pinged in 3 min ──
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

      watchRef.current = navigator.geolocation.watchPosition(
        (pos) => postIfStale(pos.coords.latitude, pos.coords.longitude),
        null,
        { enableHighAccuracy: true, maximumAge: 10000 }
      );

      return () => {
        if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
        wakeLockRef.current?.release().catch(() => {});
      };
    }
  }, [enabled, token]);
}
