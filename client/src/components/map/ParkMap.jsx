import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import { STATUS_COLORS } from '../../data/mockData';

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
mapboxgl.accessToken = TOKEN;

const PARK_CENTER = [-97.0648, 32.7550];
const PARK_ZOOM   = 16;

export default function ParkMap({
  units = [], calls = [], locations = [],
  onMapClick, onMapRightClick, onRemoveLocation,
  newCallPin, flyToTarget
}) {
  const containerRef      = useRef(null);
  const mapRef            = useRef(null);
  const callMarkersRef    = useRef({});
  const locationMarkersRef = useRef({});
  const newPinRef         = useRef(null);
  const mapReadyRef       = useRef(false);

  // Resize map whenever its container changes dimensions (e.g. panel collapse)
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => mapRef.current?.resize());
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Init map once
  useEffect(() => {
    if (mapRef.current) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      center: PARK_CENTER,
      zoom: PARK_ZOOM
    });
    mapRef.current = map;

    map.addControl(new mapboxgl.NavigationControl(), 'top-left');
    map.addControl(new mapboxgl.ScaleControl(), 'bottom-right');

    map.on('load', () => {
      // Unit source + layers
      map.addSource('units', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

      map.addLayer({
        id: 'units-circle', type: 'circle', source: 'units',
        paint: {
          'circle-radius': 13,
          'circle-color': ['get', 'color'],
          'circle-stroke-width': 2.5,
          'circle-stroke-color': ['get', 'stroke_color'],
          'circle-opacity': ['get', 'opacity']
        }
      });

      map.addLayer({
        id: 'units-label', type: 'symbol', source: 'units',
        layout: {
          'text-field': ['get', 'unit_number'],
          'text-size': 10,
          'text-anchor': 'top',
          'text-offset': [0, 1.4],
          'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular']
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': 'rgba(0,0,0,0.9)',
          'text-halo-width': 2
        }
      });

      // Cursor
      map.getCanvas().style.cursor = 'grab';
      map.on('mousedown', () => { map.getCanvas().style.cursor = 'grabbing'; });
      map.on('mouseup',   () => { map.getCanvas().style.cursor = 'grab'; });
      map.on('mouseenter', 'units-circle', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'units-circle', () => { map.getCanvas().style.cursor = 'grab'; });

      // Right-click → context menu
      map.on('contextmenu', (e) => {
        e.preventDefault();
        if (onMapRightClick) {
          const rect = map.getCanvas().getBoundingClientRect();
          onMapRightClick({
            lat: e.lngLat.lat,
            lng: e.lngLat.lng,
            x: rect.left + e.point.x,
            y: rect.top + e.point.y
          });
        }
      });

      mapReadyRef.current = true;
    });

    return () => { map.remove(); mapRef.current = null; mapReadyRef.current = false; };
  }, []);

  // Update unit dots
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    const source = map.getSource('units');
    if (!source) return;
    const now = Date.now();
    const features = units
      .filter(u => u.last_lat && u.last_lng)
      .map(u => {
        const ageMs = u.last_gps_at ? now - new Date(u.last_gps_at).getTime() : Infinity;
        const stale = ageMs > 10 * 60 * 1000;
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [u.last_lng, u.last_lat] },
          properties: {
            unit_id: u.id, unit_number: u.unit_number,
            color: STATUS_COLORS[u.status] || '#9ca3af',
            opacity: stale ? 0.4 : 0.95,
            stroke_color: stale ? '#6b7280' : '#ffffff'
          }
        };
      });
    source.setData({ type: 'FeatureCollection', features });
  }, [units]);

  // Update call pin markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    Object.values(callMarkersRef.current).forEach(m => m.remove());
    callMarkersRef.current = {};

    const PRIORITY_COLORS = { 1: '#ef4444', 2: '#f97316', 3: '#6366f1' };

    calls.forEach(call => {
      if (!call.location_lat || !call.location_lng) return;
      const isPending = call.status === 'pending';
      const color = PRIORITY_COLORS[call.priority] || '#ef4444';

      const el = document.createElement('div');
      el.className = 'call-pin-wrapper';
      if (isPending) {
        el.innerHTML = `
          <div class="call-pin-dot" style="background:${color};opacity:0.6;width:14px;height:14px"></div>
        `;
      } else {
        el.innerHTML = `
          <div class="call-pulse-ring" style="border-color:${color}"></div>
          <div class="call-pulse-ring ring2" style="border-color:${color}"></div>
          <div class="call-pin-dot" style="background:${color}"></div>
        `;
      }

      const popup = new mapboxgl.Popup({ offset: 20, closeButton: false })
        .setHTML(`
          <div style="background:#1f2937;color:#fff;padding:8px 10px;border-radius:8px;font-family:sans-serif;min-width:160px">
            <div style="font-weight:bold;font-size:13px">#${call.call_number} — ${call.call_type}</div>
            <div style="font-size:11px;color:#9ca3af;margin-top:2px">P${call.priority} · ${isPending ? 'PENDING — no unit' : call.status}</div>
            <div style="font-size:11px;color:#d1d5db;margin-top:4px">${call.location_name || ''}</div>
          </div>
        `);

      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([call.location_lng, call.location_lat])
        .setPopup(popup)
        .addTo(map);

      callMarkersRef.current[call.id] = marker;
    });
  }, [calls]);

  // Update custom location markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    Object.values(locationMarkersRef.current).forEach(m => m.remove());
    locationMarkersRef.current = {};

    locations.forEach(loc => {
      const el = document.createElement('div');
      el.className = 'loc-marker-wrapper';
      const labelPrefix = loc.locationType === 'permanent' ? '📌 ' : '';
      el.innerHTML = `
        <div class="loc-marker-diamond" style="background:${loc.color}"></div>
        <div class="loc-marker-label">${labelPrefix}${loc.name}</div>
        <button class="loc-delete-btn" title="Remove location">×</button>
      `;

      // Wire delete button
      const btn = el.querySelector('.loc-delete-btn');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onRemoveLocation?.(loc.id);
      });

      const marker = new mapboxgl.Marker({ element: el, anchor: 'top' })
        .setLngLat([loc.lng, loc.lat])
        .addTo(map);

      locationMarkersRef.current[loc.id] = marker;
    });
  }, [locations, onRemoveLocation]);

  // New call drop pin
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (newPinRef.current) { newPinRef.current.remove(); newPinRef.current = null; }
    if (newCallPin) {
      const el = document.createElement('div');
      el.className = 'new-call-pin-marker';
      newPinRef.current = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([newCallPin.lng, newCallPin.lat])
        .addTo(map);
    }
  }, [newCallPin]);

  // Fly to unit location
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current || !flyToTarget) return;
    map.flyTo({ center: [flyToTarget.lng, flyToTarget.lat], zoom: 19, speed: 1.4 });
  }, [flyToTarget]);

  return <div ref={containerRef} className="w-full h-full" />;
}
