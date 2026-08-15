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
      const postGpsJs = async (lat, lng) => {
        try {
          let gpsPermission;
          if (Capacitor.getPlatform() === 'ios') {
            try { gpsPermission = (await getLocationAuth().getStatus()).status; } catch {}
          }
          await fetch(`${apiBase()}/crew/gps`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ lat, lng, gpsPermission })
          });
        } catch {}
      };

      let cancelled = false;
      const platform = Capacitor.getPlatform();

      const startForegroundFallback = async () => {
        setGpsStatus('falling back to foreground GPS...');
        try {
          const { Geolocation } = await import('@capacitor/geolocation');
          const id = await Geolocation.watchPosition(
            { enableHighAccuracy: true },
            (pos) => { if (pos && !cancelled) postGpsJs(pos.coords.latitude, pos.coords.longitude); }
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
          distanceFilter:     0,
        };
        const cb = (location, error) => {
          if (cancelled) return;
          if (error) {
            if (error.code === 'NOT_AUTHORIZED') setBgPermNeeded(true);
            return;
          }
          setBgPermNeeded(false);
          if (!location) return;
          // Matches the Android tracker's accuracy filter — near large structures
          // a degraded fix can otherwise get posted just as trustingly as a good
          // one, freezing the pin while still refreshing "last seen."
          if (location.accuracy != null && location.accuracy > 50) return;
          postGpsJs(location.latitude, location.longitude);
        };

        // Service binding can be async right after launch — retry a few times before giving up.
        for (let attempt = 0; attempt < 8; attempt++) {
          if (cancelled) return;
          try {
            const id = await bgGeo.addWatcher(opts, cb);
            if (cancelled) { bgGeo.removeWatcher({ id }).catch(() => {}); return; }
            watchIdRef.current = id;
            setGpsStatus('background GPS active');
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
