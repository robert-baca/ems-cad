import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { getCallGpsTrack } from '../../services/api';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const PARK_CENTER = [-97.0648, 32.7550];
const COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#f43f5e', '#a855f7', '#06b6d4'];

export default function GpsTrackTab({ call }) {
  const containerRef = useRef(null);
  const mapRef       = useRef(null);
  const [points,  setPoints]  = useState(null); // null = loading
  const [error,   setError]   = useState(null);

  useEffect(() => {
    setPoints(null);
    setError(null);
    getCallGpsTrack(call.id)
      .then(r => setPoints(r.data))
      .catch(e => setError(e.message));
  }, [call.id]);

  // Build/rebuild map whenever points arrive
  useEffect(() => {
    if (!points || !containerRef.current) return;

    // Clean up any previous map instance
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }

    const center = (call.location_lat && call.location_lng)
      ? [call.location_lng, call.location_lat]
      : PARK_CENTER;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      center,
      zoom: 17,
    });
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

    map.on('load', () => {
      const byUnit = {};
      points.forEach(p => {
        const key = p.unit_number || p.unit_id;
        if (!byUnit[key]) byUnit[key] = [];
        byUnit[key].push([parseFloat(p.lng), parseFloat(p.lat)]);
      });

      const unitKeys = Object.keys(byUnit);
      const bounds   = new mapboxgl.LngLatBounds();

      unitKeys.forEach((key, i) => {
        const coords = byUnit[key];
        const color  = COLORS[i % COLORS.length];

        map.addSource(`track-${i}`, {
          type: 'geojson',
          data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } }
        });
        map.addLayer({
          id: `track-line-${i}`, type: 'line', source: `track-${i}`,
          paint: { 'line-color': color, 'line-width': 3, 'line-opacity': 0.85 }
        });

        coords.forEach(c => bounds.extend(c));

        // Start dot
        new mapboxgl.Marker({ color: '#22c55e', scale: 0.7 })
          .setLngLat(coords[0])
          .setPopup(new mapboxgl.Popup({ offset: 8 }).setText(`${key} — dispatched`))
          .addTo(map);

        // End dot
        new mapboxgl.Marker({ color, scale: 0.7 })
          .setLngLat(coords[coords.length - 1])
          .setPopup(new mapboxgl.Popup({ offset: 8 }).setText(`${key} — last ping`))
          .addTo(map);
      });

      // Call location pin
      if (call.location_lat && call.location_lng) {
        new mapboxgl.Marker({ color: '#ef4444' })
          .setLngLat([call.location_lng, call.location_lat])
          .setPopup(new mapboxgl.Popup({ offset: 8 }).setText(call.location_name || 'Incident'))
          .addTo(map);
        bounds.extend([call.location_lng, call.location_lat]);
      }

      if (points.length > 0) {
        map.fitBounds(bounds, { padding: 40, maxZoom: 18, duration: 0 });
      }
    });

    return () => { map.remove(); mapRef.current = null; };
  }, [points, call.location_lat, call.location_lng, call.location_name]);

  if (error) return (
    <div className="text-red-400 text-sm py-6 text-center">{error}</div>
  );

  if (points === null) return (
    <div className="text-gray-500 text-sm py-8 text-center">Loading GPS track…</div>
  );

  if (points.length === 0) return (
    <div className="text-center py-8 space-y-1">
      <div className="text-gray-400 text-sm">No GPS track for this call</div>
      <div className="text-gray-600 text-xs">GPS history is recorded while a unit is actively on a call</div>
    </div>
  );

  const byUnit = {};
  points.forEach(p => {
    const key = p.unit_number || p.unit_id;
    if (!byUnit[key]) byUnit[key] = [];
    byUnit[key].push(p);
  });
  const unitKeys = Object.keys(byUnit);

  const start = new Date(points[0].recorded_at);
  const end   = new Date(points[points.length - 1].recorded_at);
  const durMs = end - start;
  const durMin = Math.round(durMs / 60000);

  return (
    <div className="space-y-3">
      {/* Legend */}
      <div className="flex flex-wrap gap-3">
        {unitKeys.map((key, i) => (
          <div key={key} className="flex items-center gap-1.5 text-xs text-gray-300">
            <div className="w-4 h-1.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
            <span className="font-medium">{key}</span>
            <span className="text-gray-500">({byUnit[key].length} pts)</span>
          </div>
        ))}
        <div className="ml-auto flex items-center gap-1.5 text-xs text-gray-500">
          <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
          <span>Dispatch</span>
          <div className="w-2.5 h-2.5 rounded-full bg-red-500 ml-2" />
          <span>Incident</span>
        </div>
      </div>

      {/* Map */}
      <div ref={containerRef} className="w-full rounded-xl overflow-hidden" style={{ height: '280px' }} />

      {/* Stats */}
      <div className="text-xs text-gray-500 flex justify-between">
        <span>{points.length} GPS points · {unitKeys.length} unit{unitKeys.length !== 1 ? 's' : ''}</span>
        <span>
          {start.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
          {' → '}
          {end.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
          {durMin > 0 && ` (${durMin} min)`}
        </span>
      </div>
    </div>
  );
}
