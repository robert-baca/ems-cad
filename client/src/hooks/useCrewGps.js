import { useEffect, useRef } from 'react';

const STALE_MS = 3 * 60 * 1000; // send browser GPS only when Tracki hasn't pinged in 3 min

export function useCrewGps({ token, unit, enabled = true }) {
  const unitRef    = useRef(unit);
  const wakeLockRef = useRef(null);
  const watchRef   = useRef(null);

  // Keep unitRef current so the watchPosition callback always reads fresh last_gps_at
  unitRef.current = unit;

  // Re-acquire wake lock when tab becomes visible again (iOS drops it on background)
  useEffect(() => {
    const reacquire = async () => {
      if (document.visibilityState === 'visible' && 'wakeLock' in navigator) {
        try { wakeLockRef.current = await navigator.wakeLock.request('screen'); } catch {}
      }
    };
    document.addEventListener('visibilitychange', reacquire);
    return () => document.removeEventListener('visibilitychange', reacquire);
  }, []);

  useEffect(() => {
    if (!enabled || !token || !navigator.geolocation) return;

    // Keep screen on while app is active
    if ('wakeLock' in navigator) {
      navigator.wakeLock.request('screen')
        .then(lock => { wakeLockRef.current = lock; })
        .catch(() => {});
    }

    const postGps = async (lat, lng) => {
      const u = unitRef.current;
      const lastTracki = u?.last_gps_at ? new Date(u.last_gps_at).getTime() : 0;
      if (Date.now() - lastTracki < STALE_MS) return; // Tracki is healthy, stay quiet
      try {
        await fetch('/api/crew/gps', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ lat, lng })
        });
      } catch {}
    };

    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => postGps(pos.coords.latitude, pos.coords.longitude),
      null,
      { enableHighAccuracy: true, maximumAge: 10000 }
    );

    return () => {
      if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
      wakeLockRef.current?.release().catch(() => {});
    };
  }, [enabled, token]);
}
