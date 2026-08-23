import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { getBearing, getDistanceFt, getCardinal } from '../../lib/geo';
import { getParkPaths, getWayfindingSettings } from '../../services/api';

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

export default function CrewMap({ call, myUnit, locations = [] }) {
  const containerRef       = useRef(null);
  const mapRef              = useRef(null);
  const mapReadyRef         = useRef(false);
  const crewMarkerRef       = useRef(null);
  const locationMarkersRef  = useRef({});
  const navControlRef       = useRef(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [expanded,  setExpanded]  = useState(false);

  const hasCall = !!(call?.location_lat && call?.location_lng);
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

      // Fixed call location pin
      if (hasCall) {
        new mapboxgl.Marker({ element: makeCallEl(call.priority), anchor: 'center' })
          .setLngLat([call.location_lng, call.location_lat])
          .addTo(map);
      }

      // Crew GPS dot (may not exist yet)
      if (myUnit?.last_lat && myUnit?.last_lng) {
        crewMarkerRef.current = new mapboxgl.Marker({ element: makeCrewEl(), anchor: 'center' })
          .setLngLat([myUnit.last_lng, myUnit.last_lat])
          .addTo(map);
      }

      // Fit to show both points when both known
      if (hasCall && myUnit?.last_lat && myUnit?.last_lng) {
        const bounds = new mapboxgl.LngLatBounds()
          .extend([call.location_lng, call.location_lat])
          .extend([myUnit.last_lng, myUnit.last_lat]);
        map.fitBounds(bounds, { padding: 48, maxZoom: 18, animate: false });
      }

      // Dashed line from crew to the call — updated as GPS comes in below
      map.addSource('crew-line', { type: 'geojson', data: EMPTY_LINE });
      map.addLayer({
        id: 'crew-line', type: 'line', source: 'crew-line',
        layout: { 'line-cap': 'round' },
        paint: { 'line-color': '#facc15', 'line-width': 2.5, 'line-dasharray': [2, 1.5], 'line-opacity': 0.85 }
      });

      // Published wayfinding paths — added below crew-line so the dashed
      // crew→call line stays visually on top.
      map.addSource('park-paths', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'park-paths-line', type: 'line', source: 'park-paths',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#22c55e', 'line-width': 3, 'line-opacity': 0.75 }
      }, 'crew-line');

      setMapLoaded(true); // triggers the locations effect if data arrived before map loaded
    });

    return () => {
      map.remove();
      mapRef.current       = null;
      mapReadyRef.current  = false;
      crewMarkerRef.current = null;
      locationMarkersRef.current = {};
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally only runs once — call location is static after dispatch

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
    if (expanded && !navControlRef.current) {
      // bottom-right, not top-right — top-right is where the "✕ Close" button
      // sits, and Mapbox's own control there was rendering right on top of it.
      navControlRef.current = new mapboxgl.NavigationControl();
      map.addControl(navControlRef.current, 'bottom-right');
    } else if (!expanded && navControlRef.current) {
      map.removeControl(navControlRef.current);
      navControlRef.current = null;
    }
  }, [expanded, mapLoaded]);

  // Update crew dot + the line to the call as GPS comes in
  useEffect(() => {
    if (!mapReadyRef.current || !myUnit?.last_lat || !myUnit?.last_lng) return;
    const lngLat = [myUnit.last_lng, myUnit.last_lat];

    if (crewMarkerRef.current) {
      crewMarkerRef.current.setLngLat(lngLat);
    } else if (mapRef.current) {
      crewMarkerRef.current = new mapboxgl.Marker({ element: makeCrewEl(), anchor: 'center' })
        .setLngLat(lngLat)
        .addTo(mapRef.current);
    }

    const lineSource = mapRef.current?.getSource('crew-line');
    if (lineSource) {
      lineSource.setData(hasCall
        ? { type: 'Feature', geometry: { type: 'LineString', coordinates: [lngLat, [call.location_lng, call.location_lat]] } }
        : EMPTY_LINE);
    }
  }, [myUnit?.last_lat, myUnit?.last_lng, hasCall, call?.location_lng, call?.location_lat]);

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

  const hasCrewPos = !!(myUnit?.last_lat && myUnit?.last_lng);
  const distFt = hasCall && hasCrewPos
    ? getDistanceFt(myUnit.last_lat, myUnit.last_lng, call.location_lat, call.location_lng)
    : null;
  const bearing = hasCall && hasCrewPos
    ? getBearing(myUnit.last_lat, myUnit.last_lng, call.location_lat, call.location_lng)
    : null;

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

      {distFt != null && (
        <div className="absolute bottom-2 left-2 bg-black/70 backdrop-blur-sm text-white text-xs font-semibold px-2.5 py-1 rounded-full pointer-events-none select-none">
          🚩 {distFt < 1000 ? `${distFt} ft` : `${(distFt / 5280).toFixed(2)} mi`} · {getCardinal(bearing)}
        </div>
      )}

      <button
        onClick={() => setExpanded(e => !e)}
        className={expanded
          ? 'absolute right-2 top-[calc(0.5rem+env(safe-area-inset-top))] bg-black/70 hover:bg-black/85 backdrop-blur-sm text-white text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-colors'
          : 'absolute top-2 right-2 bg-black/70 hover:bg-black/85 backdrop-blur-sm text-white text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-colors'}
      >
        {expanded ? '✕ Close' : '⛶ Expand'}
      </button>
    </div>
  );
}
