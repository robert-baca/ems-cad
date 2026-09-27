import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { getBearing, getDistanceFt, getCardinal } from '../../lib/geo';
import { getParkPaths, getWayfindingSettings } from '../../services/api';
import { useRoute } from '../../hooks/useRoute';
import { nextManeuver, routeHeading, ARRIVE_FT } from '../../lib/navGuide';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const PARK_CENTER = [-97.0648, 32.7550];
const PRIORITY_COLORS = { 1: '#ef4444', 2: '#f97316', 3: '#3b82f6' };

// Dispatcher-entered location names are rendered via innerHTML for marker
// styling — escape them so they can't inject markup.
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function makeCallEl(priority) {
  const el = document.createElement('div');
  const color = PRIORITY_COLORS[priority] || '#ef4444';
  Object.assign(el.style, {
    width: '20px', height: '20px', borderRadius: '50%',
    backgroundColor: color, border: '2.5px solid white',
    boxShadow: `0 0 0 4px ${color}55`
  });
  return el;
}

function makeCrewEl() {
  const el = document.createElement('div');
  Object.assign(el.style, {
    width: '14px', height: '14px', borderRadius: '50%',
    backgroundColor: '#3b82f6', border: '2px solid white',
    boxShadow: '0 0 0 3px rgba(59,130,246,0.45)'
  });
  return el;
}

const EMPTY_LINE = { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } };

// Bearing toward the first route waypoint at least ~15ft ahead of the crew's
// position — a cheap "which way to head next" signal without building a
// full turn-by-turn instruction stack.
function nextWaypointBearing(points, fromLat, fromLng) {
  if (!points || points.length < 2) return null;
  for (const [lng, lat] of points) {
    if (getDistanceFt(fromLat, fromLng, lat, lng) >= 15) return getBearing(fromLat, fromLng, lat, lng);
  }
  const [lng, lat] = points[points.length - 1];
  return getBearing(fromLat, fromLng, lat, lng);
}

// Heading from a deviceorientation event, true-north where the phone gives
// it (iOS webkitCompassHeading, Android absolute alpha), corrected for the
// screen being turned sideways. Same approach as BeaconMode's compass.
function eventHeading(e) {
  let h = null;
  if (e.webkitCompassHeading != null) h = e.webkitCompassHeading;
  else if (e.absolute && e.alpha != null) h = (360 - e.alpha) % 360;
  if (h == null) return null;
  const screenAngle = Number(window.screen?.orientation?.angle ?? window.orientation ?? 0) || 0;
  return (h + screenAngle + 360) % 360;
}

function smoothAngle(prev, next, alpha = 0.25) {
  if (prev == null) return next;
  let d = next - prev;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return (prev + alpha * d + 360) % 360;
}

export default function CrewMap({ call, myUnit, locations = [] }) {
  const containerRef       = useRef(null);
  const mapRef              = useRef(null);
  const mapReadyRef         = useRef(false);
  const crewMarkerRef       = useRef(null);
  const callMarkerRef       = useRef(null);
  const locationMarkersRef  = useRef({});
  const navControlRef       = useRef(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [expanded,  setExpanded]  = useState(false);

  const hasCall = !!(call?.location_lat && call?.location_lng);
  // Navigation view (▶ Start): full-screen, tilted, heading-up camera that
  // follows the medic along the route. It reads the phone's OWN live GPS
  // (~1/s, unfiltered) instead of the server copy, which only updates every
  // ~5s and holds still until you've moved ~25 m -- far too jumpy to follow.
  const [navMode,    setNavMode]    = useState(false);
  const [navPos,     setNavPos]     = useState(null); // { lat, lng, course, speed }
  const [navHeading, setNavHeading] = useState(null); // compass, degrees
  const navHeadingRef = useRef(null);
  const lastCamRef    = useRef(0);

  const crewLat = navMode && navPos ? navPos.lat : (myUnit?.last_lat ?? null);
  const crewLng = navMode && navPos ? navPos.lng : (myUnit?.last_lng ?? null);
  const hasCrewPos = !!(crewLat && crewLng);
  const [mapFailed, setMapFailed] = useState(false);

  const [paths, setPaths] = useState([]);
  const [pathsEnabled, setPathsEnabled] = useState(false);

  // Published wayfinding paths, if the admin has turned them on for crews.
  useEffect(() => {
    Promise.all([getWayfindingSettings(), getParkPaths()])
      .then(([s, p]) => {
        setPathsEnabled(!!s.data.enabled);
        if (Array.isArray(p.data)) setPaths(p.data);
      })
      .catch(() => {}); // fail quiet — same pattern as the locations effect below
  }, []);

  // Route the crew's live position to the call through the published trail
  // network — null when routing isn't possible, so the effect below falls
  // back to a straight line exactly as it did before this existed.
  const { route, why: routeWhy } = useRoute(
    paths, pathsEnabled,
    hasCrewPos ? [crewLng, crewLat] : null,
    hasCall ? [call.location_lng, call.location_lat] : null
  );

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    // A missing/invalid Mapbox token throws from inside this effect, which
    // React's error boundaries don't catch (effects run outside the render
    // phase) — left unguarded, this took down GPS tracking along with it,
    // since it's the first map the crew app ever creates and only happens
    // the moment a call goes active. Fail to a plain "unavailable" state
    // instead of letting it become an uncaught, app-wide JS error.
    if (!mapboxgl.accessToken) {
      setMapFailed(true);
      return;
    }

    const center = hasCall ? [call.location_lng, call.location_lat] : PARK_CENTER;

    let map;
    try {
      map = new mapboxgl.Map({
        container: containerRef.current,
        style: 'mapbox://styles/mapbox/satellite-streets-v12',
        center,
        zoom: 17,
        interactive: true,
        attributionControl: false
      });
    } catch (e) {
      console.error('[CrewMap] init failed', e);
      setMapFailed(true);
      return;
    }
    mapRef.current = map;

    map.on('load', () => {
      mapReadyRef.current = true;

      // Call location pin — kept up to date by the effect below if a
      // dispatcher repositions it mid-call.
      if (hasCall) {
        callMarkerRef.current = new mapboxgl.Marker({ element: makeCallEl(call.priority), anchor: 'center' })
          .setLngLat([call.location_lng, call.location_lat])
          .addTo(map);
      }

      // Crew GPS dot (may not exist yet)
      if (crewLat && crewLng) {
        crewMarkerRef.current = new mapboxgl.Marker({ element: makeCrewEl(), anchor: 'center' })
          .setLngLat([crewLng, crewLat])
          .addTo(map);
      }

      // Fit to show both points when both known
      if (hasCall && crewLat && crewLng) {
        const bounds = new mapboxgl.LngLatBounds()
          .extend([call.location_lng, call.location_lat])
          .extend([crewLng, crewLat]);
        map.fitBounds(bounds, { padding: 48, maxZoom: 18, animate: false });
      }

      // Line from crew to the call — updated as GPS comes in below. When a
      // walking route exists it's drawn bold (white casing + blue) so it's
      // the one thing that stands out; with no route it's a thin dashed
      // straight line (see the route-style effect further down).
      map.addSource('crew-line', { type: 'geojson', data: EMPTY_LINE });
      map.addLayer({
        id: 'crew-line-casing', type: 'line', source: 'crew-line',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0 }
      });
      map.addLayer({
        id: 'crew-line', type: 'line', source: 'crew-line',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#facc15', 'line-width': 2.5, 'line-dasharray': [2, 1.5], 'line-opacity': 0.85 }
      });

      // Published wayfinding paths — added below crew-line so the dashed
      // crew→call line stays visually on top.
      map.addSource('park-paths', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'park-paths-line', type: 'line', source: 'park-paths',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#22c55e', 'line-width': 2, 'line-opacity': 0.35 }
      }, 'crew-line-casing');

      setMapLoaded(true); // triggers the locations effect if data arrived before map loaded
    });

    return () => {
      map.remove();
      mapRef.current       = null;
      mapReadyRef.current  = false;
      crewMarkerRef.current = null;
      callMarkerRef.current = null;
      locationMarkersRef.current = {};
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // init only runs once; the call pin's position is kept live by the effect below

  // Resize the map when its container size changes (e.g. full-screen expand/collapse)
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => mapRef.current?.resize());
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Pan/zoom controls only make sense with the room a full-screen view gives
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    if (expanded && !navMode && !navControlRef.current) {
      // bottom-right, not top-right — top-right is where the "✕ Close" button
      // sits, and Mapbox's own control there was rendering right on top of it.
      navControlRef.current = new mapboxgl.NavigationControl();
      map.addControl(navControlRef.current, 'bottom-right');
    } else if ((!expanded || navMode) && navControlRef.current) {
      map.removeControl(navControlRef.current);
      navControlRef.current = null;
    }
  }, [expanded, navMode, mapLoaded]);

  // Update crew dot + the line to the call as GPS comes in
  useEffect(() => {
    if (!mapReadyRef.current || !crewLat || !crewLng) return;
    const lngLat = [crewLng, crewLat];

    if (crewMarkerRef.current) {
      crewMarkerRef.current.setLngLat(lngLat);
    } else if (mapRef.current) {
      crewMarkerRef.current = new mapboxgl.Marker({ element: makeCrewEl(), anchor: 'center' })
        .setLngLat(lngLat)
        .addTo(mapRef.current);
    }

    const lineSource = mapRef.current?.getSource('crew-line');
    if (lineSource) {
      if (!hasCall) {
        lineSource.setData(EMPTY_LINE);
      } else if (route?.points?.length >= 2) {
        lineSource.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: route.points } });
      } else {
        lineSource.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [lngLat, [call.location_lng, call.location_lat]] } });
      }
    }
  }, [crewLat, crewLng, hasCall, call?.location_lng, call?.location_lat, route]);

  // A dispatcher can reposition a call's pin mid-call (see CallDetail's
  // "reposition pin" action) — keep the marker in sync instead of only
  // placing it once at map init.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;

    if (!hasCall) {
      callMarkerRef.current?.remove();
      callMarkerRef.current = null;
      return;
    }

    const lngLat = [call.location_lng, call.location_lat];
    if (callMarkerRef.current) {
      callMarkerRef.current.setLngLat(lngLat);
    } else {
      callMarkerRef.current = new mapboxgl.Marker({ element: makeCallEl(call.priority), anchor: 'center' })
        .setLngLat(lngLat)
        .addTo(map);
    }
  }, [hasCall, call?.location_lat, call?.location_lng, call?.priority, mapLoaded]);

  // Landmark markers — incremental add/remove, same pattern ParkMap.jsx uses,
  // minus the delete button (read-only for crew).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;

    const currentIds = new Set(locations.map(l => l.id));

    Object.keys(locationMarkersRef.current).forEach(id => {
      if (!currentIds.has(id)) {
        locationMarkersRef.current[id].remove();
        delete locationMarkersRef.current[id];
      }
    });

    locations.forEach(loc => {
      if (locationMarkersRef.current[loc.id]) return;
      const el = document.createElement('div');
      el.className = 'loc-marker-anchor';
      el.innerHTML = `
        <div class="loc-marker-diamond" style="background:${escapeHtml(loc.color)}"></div>
        <div class="loc-marker-label">📌 ${escapeHtml(loc.name)}</div>
      `;
      locationMarkersRef.current[loc.id] = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([loc.lng, loc.lat])
        .addTo(map);
    });
  }, [locations, mapLoaded]);

  // Push published paths into the map once loaded — empty when not enabled.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    const features = pathsEnabled
      ? paths.map(p => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: p.coordinates }, properties: { id: p.id } }))
      : [];
    map.getSource('park-paths')?.setData({ type: 'FeatureCollection', features });
  }, [paths, pathsEnabled, mapLoaded]);

  // A route is the thing to follow: bold blue with a white edge, and the
  // rest of the walkway network faded right back so it doesn't compete.
  // No route: the old thin dashed straight line, network a bit more visible
  // so the crew can still pick their own way.
  const hasRoute = !!(route?.points?.length >= 2);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current || !map.getLayer('crew-line')) return;
    if (hasRoute) {
      map.setPaintProperty('crew-line', 'line-color', '#2563eb');
      map.setPaintProperty('crew-line', 'line-width', 6);
      map.setPaintProperty('crew-line', 'line-dasharray', [1, 0]);
      map.setPaintProperty('crew-line', 'line-opacity', 1);
      map.setPaintProperty('crew-line-casing', 'line-opacity', 0.9);
      map.setPaintProperty('park-paths-line', 'line-opacity', 0.18);
    } else {
      map.setPaintProperty('crew-line', 'line-color', '#facc15');
      map.setPaintProperty('crew-line', 'line-width', 2.5);
      map.setPaintProperty('crew-line', 'line-dasharray', [2, 1.5]);
      map.setPaintProperty('crew-line', 'line-opacity', 0.85);
      map.setPaintProperty('crew-line-casing', 'line-opacity', 0);
      map.setPaintProperty('park-paths-line', 'line-opacity', 0.35);
    }
  }, [hasRoute, mapLoaded]);

  // Live GPS + compass while navigating.
  useEffect(() => {
    if (!navMode) return;
    let watchId = null;
    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        pos => setNavPos({ lat: pos.coords.latitude, lng: pos.coords.longitude, course: pos.coords.heading, speed: pos.coords.speed }),
        () => {},
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
      );
    }
    const onOrient = (e) => {
      const h = eventHeading(e);
      if (h == null) return;
      navHeadingRef.current = smoothAngle(navHeadingRef.current, h);
      setNavHeading(navHeadingRef.current);
    };
    window.addEventListener('deviceorientationabsolute', onOrient, true);
    window.addEventListener('deviceorientation', onOrient, true);
    // Keep the screen on while navigating, where the phone allows it.
    let wakeLock = null;
    navigator.wakeLock?.request?.('screen').then(l => { wakeLock = l; }).catch(() => {});
    return () => {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      window.removeEventListener('deviceorientationabsolute', onOrient, true);
      window.removeEventListener('deviceorientation', onOrient, true);
      wakeLock?.release?.().catch(() => {});
      navHeadingRef.current = null;
      setNavHeading(null);
      setNavPos(null);
    };
  }, [navMode]);

  // Which way the camera faces: compass if the phone has one, else the
  // direction of travel from GPS while walking, else along the route.
  const camHeading = navMode
    ? (navHeading ?? ((navPos?.speed ?? 0) > 0.7 && navPos?.course != null && !isNaN(navPos.course)
        ? navPos.course
        : routeHeading(route?.points, hasCrewPos ? { lat: Number(crewLat), lng: Number(crewLng) } : null)))
    : null;

  // Third-person follow camera: tilted, heading-up, medic in the lower part
  // of the screen so the route ahead fills the view. Throttled so compass
  // jitter doesn't make it swim.
  useEffect(() => {
    const map = mapRef.current;
    if (!navMode || !map || !mapReadyRef.current || !hasCrewPos) return;
    const now = Date.now();
    if (now - lastCamRef.current < 250) return;
    lastCamRef.current = now;
    const h = map.getContainer().clientHeight || 600;
    map.easeTo({
      center: [Number(crewLng), Number(crewLat)],
      bearing: camHeading ?? map.getBearing(),
      pitch: 60,
      zoom: 19,
      padding: { top: Math.round(h * 0.45), bottom: 0, left: 0, right: 0 },
      duration: 400,
      essential: true,
    });
  }, [navMode, crewLat, crewLng, camHeading, hasCrewPos]);

  const startNav = async () => {
    // iOS only allows compass access from a tap -- this is that tap.
    try {
      if (typeof DeviceOrientationEvent?.requestPermission === 'function') await DeviceOrientationEvent.requestPermission();
    } catch { /* no compass: camera falls back to walking direction */ }
    setExpanded(true);
    setNavMode(true);
  };

  const endNav = () => {
    setNavMode(false);
    const map = mapRef.current;
    if (map) map.easeTo({ pitch: 0, bearing: 0, zoom: 17, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 600 });
  };

  const maneuver = navMode && route?.points && hasCrewPos
    ? nextManeuver(route.points, { lat: Number(crewLat), lng: Number(crewLng) })
    : null;
  const straightFt = navMode && hasCrewPos && hasCall
    ? getDistanceFt(Number(crewLat), Number(crewLng), call.location_lat, call.location_lng) : null;
  const arrived = navMode && (maneuver?.arrived || (straightFt != null && straightFt <= ARRIVE_FT));

  const distFt = route
    ? route.distFt
    : (hasCall && hasCrewPos ? getDistanceFt(crewLat, crewLng, call.location_lat, call.location_lng) : null);
  const bearing = route
    ? (hasCrewPos ? nextWaypointBearing(route.points, crewLat, crewLng) : null)
    : (hasCall && hasCrewPos ? getBearing(crewLat, crewLng, call.location_lat, call.location_lng) : null);

  return (
    <div
      className={expanded
        ? 'fixed inset-0 z-50 bg-gray-950'
        : 'relative rounded-xl overflow-hidden border border-gray-600'}
      style={expanded ? undefined : { height: 190 }}
    >
      {mapFailed ? (
        <div className="w-full h-full flex items-center justify-center bg-gray-800 text-gray-500 text-xs px-4 text-center">
          Map unavailable
        </div>
      ) : (
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      )}

      {navMode && (
        <div className="absolute left-2 right-2 top-[calc(0.5rem+env(safe-area-inset-top))] rounded-2xl bg-green-700/95 text-white px-4 py-3 shadow-xl pointer-events-none">
          {arrived ? (
            <div className="text-lg font-black">🏁 You've arrived — look for the call</div>
          ) : maneuver?.next ? (
            <div className="flex items-center gap-3">
              <span className="text-4xl leading-none">{maneuver.next.arrow}</span>
              <div>
                <div className="text-lg font-black leading-tight">{maneuver.next.text}</div>
                <div className="text-green-100 text-sm">in {maneuver.next.distFt} ft</div>
              </div>
            </div>
          ) : (
            <div className="text-base font-bold">
              {hasCrewPos ? '↑ Head toward the pin — no walking route here' : 'Finding your location…'}
            </div>
          )}
        </div>
      )}

      {navMode && (
        <div className="absolute left-2 right-2 bottom-[calc(0.5rem+env(safe-area-inset-bottom))] flex items-center gap-2">
          <div className="flex-1 bg-black/75 backdrop-blur-sm text-white text-sm font-semibold px-3 py-2.5 rounded-xl">
            {(maneuver?.remainingFt ?? distFt) != null
              ? `${maneuver?.remainingFt ?? distFt} ft to go`
              : 'Locating…'}
          </div>
          <button onClick={endNav}
            className="bg-red-700 active:bg-red-800 text-white text-sm font-bold px-4 py-2.5 rounded-xl">
            ✕ End
          </button>
        </div>
      )}

      {!navMode && hasCall && (
        <button
          onClick={startNav}
          className="absolute top-[calc(0.5rem+env(safe-area-inset-top))] left-2 bg-green-600 active:bg-green-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-lg"
        >
          ▶ Start
        </button>
      )}

      {!navMode && distFt != null && (
        <div className="absolute bottom-2 left-2 max-w-[85%] bg-black/70 backdrop-blur-sm text-white text-xs font-semibold px-2.5 py-1 rounded-2xl pointer-events-none select-none">
          <div>{route ? '🥾' : '🚩'} {distFt < 1000 ? `${distFt} ft` : `${(distFt / 5280).toFixed(2)} mi`} · {getCardinal(bearing)}</div>
          {/* Why there's only a straight line -- so it can be fixed (trace a
              walkway there) rather than just looking broken. */}
          {!route && routeWhy && (
            <div className="text-amber-300 font-normal text-[11px] leading-tight mt-0.5">
              {{
                'off': 'Walking routes are turned off',
                'no-paths': 'Walking routes still loading…',
                'start-off': `No route: you're ${routeWhy.offFt} ft from a mapped walkway`,
                'pin-off': `No route: the call pin is ${routeWhy.offFt} ft from a mapped walkway`,
                'disconnected': 'No route: walkways here aren\u2019t connected',
              }[routeWhy.reason] || ''}
            </div>
          )}
        </div>
      )}

      {!navMode && <button
        onClick={() => setExpanded(e => !e)}
        className={expanded
          ? 'absolute right-2 top-[calc(0.5rem+env(safe-area-inset-top))] bg-black/70 hover:bg-black/85 backdrop-blur-sm text-white text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-colors'
          : 'absolute top-2 right-2 bg-black/70 hover:bg-black/85 backdrop-blur-sm text-white text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-colors'}
      >
        {expanded ? '✕ Close' : '⛶ Expand'}
      </button>}
    </div>
  );
}
