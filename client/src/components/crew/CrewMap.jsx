import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const PARK_CENTER = [-97.0648, 32.7550];
const PRIORITY_COLORS = { 1: '#ef4444', 2: '#f97316', 3: '#3b82f6' };

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

export default function CrewMap({ call, myUnit }) {
  const containerRef  = useRef(null);
  const mapRef        = useRef(null);
  const mapReadyRef   = useRef(false);
  const crewMarkerRef = useRef(null);

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const hasCall = call?.location_lat && call?.location_lng;
    const center  = hasCall ? [call.location_lng, call.location_lat] : PARK_CENTER;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      center,
      zoom: 17,
      interactive: true,
      attributionControl: false
    });
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
    });

    return () => {
      map.remove();
      mapRef.current   = null;
      mapReadyRef.current = false;
      crewMarkerRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally only runs once — call location is static after dispatch

  // Update crew dot as GPS comes in
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
  }, [myUnit?.last_lat, myUnit?.last_lng]);

  return (
    <div className="rounded-xl overflow-hidden border border-gray-600" style={{ height: 190 }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
