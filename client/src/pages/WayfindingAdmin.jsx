import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import { useAuth } from '../context/AuthContext';
import {
  getWayfindingTraces, getParkPaths, createParkPath, deleteParkPath,
  getWayfindingSettings, setWayfindingEnabled
} from '../services/api';
import { cleanTrace, suggestPathFromTraces } from '../lib/pathSuggest';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const PARK_CENTER = [-97.0648, 32.7550];
const EMPTY_FC = { type: 'FeatureCollection', features: [] };

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function WayfindingAdmin() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const containerRef  = useRef(null);
  const mapRef         = useRef(null);
  const mapReadyRef    = useRef(false);
  const drawMarkersRef = useRef([]);
  const clickHandlerRef = useRef(() => {});

  const [mapLoaded,  setMapLoaded]  = useState(false);
  const [traces,     setTraces]     = useState(null); // null = loading
  const [paths,      setPaths]      = useState([]);
  const [enabled,    setEnabled]    = useState(false);
  const [loadError,  setLoadError]  = useState('');
  const [togglingEnabled, setTogglingEnabled] = useState(false);

  const [drawing,    setDrawing]    = useState(false);
  const [drawPoints, setDrawPoints] = useState([]);
  const [pathName,   setPathName]   = useState('');
  const [saving,     setSaving]     = useState(false);
  const [saveError,  setSaveError]  = useState('');

  // 'idle' | 'pick-start' | 'pick-end' — picking the two endpoints for a
  // trace-evidence suggestion, which then hands off into the normal
  // drawing/review flow above so it's edited/saved the same way.
  const [suggestMode,  setSuggestMode]  = useState('idle');
  const [suggestStart, setSuggestStart] = useState(null);
  const [suggestError, setSuggestError] = useState('');

  // Only an SSO'd admin (role: wayfinding_admin, minted only when access_role
  // === 'admin' on sfotems.com) can be here — everyone else gets bounced.
  useEffect(() => {
    if (user && user.role !== 'wayfinding_admin') {
      navigate('/login', { replace: true });
    }
  }, [user, navigate]);

  useEffect(() => {
    Promise.all([getWayfindingTraces(), getParkPaths(), getWayfindingSettings()])
      .then(([t, p, s]) => {
        setTraces(t.data);
        setPaths(p.data);
        setEnabled(!!s.data.enabled);
      })
      .catch(err => setLoadError(err?.response?.data?.error || 'Failed to load wayfinding data'));
  }, []);

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      center: PARK_CENTER,
      zoom: 16
    });
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl(), 'top-left');

    // Dispatches through a ref so the listener never needs to be re-attached
    // as drawing/drawPoints state changes.
    map.on('click', (e) => clickHandlerRef.current([e.lngLat.lng, e.lngLat.lat]));

    map.on('load', () => {
      mapReadyRef.current = true;

      map.addSource('traces', { type: 'geojson', data: EMPTY_FC });
      map.addLayer({
        id: 'traces-line', type: 'line', source: 'traces',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#fbbf24', 'line-width': 2, 'line-opacity': 0.25 }
      });

      map.addSource('paths', { type: 'geojson', data: EMPTY_FC });
      map.addLayer({
        id: 'paths-line', type: 'line', source: 'paths',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#22c55e', 'line-width': 3, 'line-opacity': 0.9 }
      });

      map.addSource('draw-line', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } } });
      map.addLayer({
        id: 'draw-line-layer', type: 'line', source: 'draw-line',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#60a5fa', 'line-width': 3, 'line-dasharray': [1.5, 1] }
      });

      setMapLoaded(true);
    });

    return () => { map.remove(); mapRef.current = null; mapReadyRef.current = false; };
  }, []);

  // Group by call, sort by time, and drop GPS-glitch points (implausible
  // speed jumps) before anything renders or feeds the suggestion algorithm —
  // memoized since this walks up to 20k points and shouldn't re-run on every
  // unrelated re-render (e.g. typing a path name).
  const cleanedByCall = useMemo(() => {
    if (!traces) return {};
    const byCall = {};
    traces.forEach(p => {
      if (!byCall[p.call_id]) byCall[p.call_id] = [];
      byCall[p.call_id].push(p);
    });
    const result = {};
    Object.entries(byCall).forEach(([callId, pts]) => {
      const sorted = [...pts]
        .sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at))
        .map(p => ({ lat: parseFloat(p.lat), lng: parseFloat(p.lng), recorded_at: p.recorded_at }));
      result[callId] = cleanTrace(sorted);
    });
    return result;
  }, [traces]);

  const allCleanedPoints = useMemo(() => Object.values(cleanedByCall).flat(), [cleanedByCall]);

  // Keep the click dispatcher pointed at the latest drawing/suggest state.
  // Picking the two suggest endpoints hands off into the normal drawing/review
  // flow — the suggested line is edited/saved exactly like a hand-drawn one.
  useEffect(() => {
    clickHandlerRef.current = (lngLat) => {
      if (suggestMode === 'pick-start') {
        setSuggestStart(lngLat);
        setSuggestMode('pick-end');
        return;
      }
      if (suggestMode === 'pick-end') {
        const result = suggestPathFromTraces(suggestStart, lngLat, allCleanedPoints);
        setSuggestMode('idle');
        setSuggestStart(null);
        if (!result.points) {
          setSuggestError(result.reason || 'Not enough data along that line yet.');
          return;
        }
        setSuggestError('');
        setDrawing(true);
        setDrawPoints(result.points);
        setPathName('');
        setSaveError('');
        return;
      }
      if (!drawing) return;
      setDrawPoints(prev => [...prev, lngLat]);
    };
  }, [drawing, suggestMode, suggestStart, allCleanedPoints]);

  // Render every historical call's cleaned GPS trace, overlaid — busy real
  // paths visually stand out where enough calls have happened near them.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    const features = Object.entries(cleanedByCall).map(([callId, pts]) => {
      const coords = pts.map(p => [p.lng, p.lat]);
      return coords.length >= 2
        ? { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: { call_id: callId } }
        : null;
    }).filter(Boolean);
    map.getSource('traces')?.setData({ type: 'FeatureCollection', features });
  }, [cleanedByCall, mapLoaded]);

  // Render published paths
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    const features = paths.map(p => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: p.coordinates },
      properties: { id: p.id, name: p.name }
    }));
    map.getSource('paths')?.setData({ type: 'FeatureCollection', features });
  }, [paths, mapLoaded]);

  // Render the in-progress drawn line + point markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    map.getSource('draw-line')?.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: drawPoints } });

    drawMarkersRef.current.forEach(m => m.remove());
    drawMarkersRef.current = drawPoints.map(([lng, lat]) =>
      new mapboxgl.Marker({ color: '#60a5fa', scale: 0.6 }).setLngLat([lng, lat]).addTo(map)
    );
  }, [drawPoints, mapLoaded]);

  const startDrawing  = () => { setDrawing(true); setDrawPoints([]); setPathName(''); setSaveError(''); };
  const undoLastPoint = () => setDrawPoints(prev => prev.slice(0, -1));
  const cancelDrawing = () => { setDrawing(false); setDrawPoints([]); setPathName(''); setSaveError(''); };

  const savePath = async () => {
    if (drawPoints.length < 2) { setSaveError('Click at least 2 points on the map first.'); return; }
    setSaving(true);
    setSaveError('');
    try {
      const res = await createParkPath(pathName.trim() || null, drawPoints);
      setPaths(prev => [...prev, res.data]);
      cancelDrawing();
    } catch (err) {
      setSaveError(err?.response?.data?.error || 'Failed to save path');
    } finally {
      setSaving(false);
    }
  };

  const removePath = async (id) => {
    setPaths(prev => prev.filter(p => p.id !== id));
    try { await deleteParkPath(id); } catch {}
  };

  const startSuggesting = () => {
    setSuggestMode('pick-start');
    setSuggestStart(null);
    setSuggestError('');
  };
  const cancelSuggesting = () => {
    setSuggestMode('idle');
    setSuggestStart(null);
  };

  const toggleEnabled = async () => {
    const next = !enabled;
    setTogglingEnabled(true);
    try {
      await setWayfindingEnabled(next);
      setEnabled(next);
    } catch {} finally {
      setTogglingEnabled(false);
    }
  };

  const uniqueCalls = traces ? new Set(traces.map(t => t.call_id)).size : 0;
  const totalPoints = traces ? traces.length : 0;
  const oldestPoint  = traces && traces.length > 0 ? traces[traces.length - 1].recorded_at : null;
  const newestPoint  = traces && traces.length > 0 ? traces[0].recorded_at : null;

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white overflow-hidden">
      <header className="flex items-center justify-between px-4 py-2.5 bg-gray-800 border-b border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xl">🧭</span>
          <span className="font-bold text-white tracking-wide">Wayfinding — Path Data Review</span>
          <span className="text-gray-500 text-xs ml-2">Admin only</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-gray-400 text-sm">👤 {user?.name}</span>
          <button
            onClick={() => { logout(); navigate('/login'); }}
            className="text-gray-500 hover:text-white text-xs px-2 py-1 rounded hover:bg-gray-700 transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Map */}
        <div className="flex-1 relative">
          <div ref={containerRef} className="w-full h-full" />
          {drawing && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-blue-900/80 border border-blue-600 backdrop-blur-sm text-blue-100 text-xs px-3 py-1.5 rounded-full pointer-events-none select-none">
              Click the map to add points · {drawPoints.length} point{drawPoints.length !== 1 ? 's' : ''}
            </div>
          )}
          {suggestMode === 'pick-start' && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-purple-900/80 border border-purple-600 backdrop-blur-sm text-purple-100 text-xs px-3 py-1.5 rounded-full pointer-events-none select-none">
              🪄 Click where the path should start
            </div>
          )}
          {suggestMode === 'pick-end' && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-purple-900/80 border border-purple-600 backdrop-blur-sm text-purple-100 text-xs px-3 py-1.5 rounded-full pointer-events-none select-none">
              🪄 Now click where it should end
            </div>
          )}
        </div>

        {/* Side panel */}
        <div className="w-80 flex flex-col bg-gray-800 border-l border-gray-700 flex-shrink-0 overflow-y-auto">
          {loadError && (
            <div className="m-3 px-3 py-2 rounded-lg bg-red-900/60 border border-red-700 text-red-200 text-xs">
              {loadError}
            </div>
          )}

          {/* Progress */}
          <div className="p-4 border-b border-gray-700">
            <div className="text-gray-400 text-xs uppercase tracking-wider mb-2">Data Collected</div>
            {traces === null ? (
              <div className="text-gray-500 text-sm">Loading…</div>
            ) : (
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-gray-400">Tracked calls</span><span className="text-white font-semibold">{uniqueCalls}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">GPS points</span><span className="text-white font-semibold">{totalPoints.toLocaleString()}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Since</span><span className="text-white font-semibold">{fmtDate(oldestPoint)}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Latest</span><span className="text-white font-semibold">{fmtDate(newestPoint)}</span></div>
              </div>
            )}
          </div>

          {/* Draw path */}
          <div className="p-4 border-b border-gray-700 space-y-2">
            <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">Trace a Path</div>
            {suggestError && <p className="text-amber-400 text-xs">{suggestError}</p>}
            {!drawing && suggestMode === 'idle' && (
              <div className="space-y-2">
                <button
                  onClick={startDrawing}
                  className="w-full py-2.5 bg-blue-700 hover:bg-blue-600 text-white text-sm font-bold rounded-lg transition-colors"
                >
                  ✏️ Draw New Path
                </button>
                <button
                  onClick={startSuggesting}
                  disabled={!traces || traces.length === 0}
                  className="w-full py-2.5 bg-purple-800 hover:bg-purple-700 disabled:opacity-40 text-white text-sm font-bold rounded-lg transition-colors"
                >
                  🪄 Suggest From Data
                </button>
                <p className="text-gray-600 text-xs">
                  Pick a start and end point — if there's enough real GPS evidence nearby, a candidate line is drawn for you to review and adjust before saving.
                </p>
              </div>
            )}
            {!drawing && suggestMode !== 'idle' && (
              <button
                onClick={cancelSuggesting}
                className="w-full py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs font-semibold rounded-lg transition-colors"
              >
                ✕ Cancel Suggestion
              </button>
            )}
            {drawing && (
              <div className="space-y-2">
                <input
                  type="text"
                  value={pathName}
                  onChange={e => setPathName(e.target.value)}
                  placeholder="Path name (optional)…"
                  className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
                />
                <div className="flex gap-2">
                  <button
                    onClick={undoLastPoint}
                    disabled={drawPoints.length === 0}
                    className="flex-1 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-gray-300 text-xs font-semibold rounded-lg transition-colors"
                  >
                    ↩ Undo Point
                  </button>
                  <button
                    onClick={cancelDrawing}
                    className="flex-1 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs font-semibold rounded-lg transition-colors"
                  >
                    ✕ Cancel
                  </button>
                </div>
                {saveError && <p className="text-red-400 text-xs">{saveError}</p>}
                <button
                  onClick={savePath}
                  disabled={saving || drawPoints.length < 2}
                  className="w-full py-2 bg-green-700 hover:bg-green-600 disabled:bg-gray-600 text-white text-sm font-bold rounded-lg transition-colors"
                >
                  {saving ? 'Saving…' : '✓ Save Path'}
                </button>
              </div>
            )}
          </div>

          {/* Published paths */}
          <div className="p-4 border-b border-gray-700 flex-1">
            <div className="text-gray-400 text-xs uppercase tracking-wider mb-2">
              Published Paths ({paths.length})
            </div>
            {paths.length === 0 ? (
              <div className="text-gray-500 text-xs">None traced yet</div>
            ) : (
              <div className="space-y-1.5">
                {paths.map(p => (
                  <div key={p.id} className="flex items-center justify-between bg-gray-750 border border-gray-700 rounded-lg px-3 py-2">
                    <span className="text-white text-sm truncate">{p.name || 'Unnamed path'}</span>
                    <button
                      onClick={() => removePath(p.id)}
                      className="text-gray-500 hover:text-red-400 text-xs flex-shrink-0 ml-2 transition-colors"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Global switch */}
          <div className="p-4">
            <div className="text-gray-400 text-xs uppercase tracking-wider mb-2">Crew Visibility</div>
            <button
              onClick={toggleEnabled}
              disabled={togglingEnabled}
              className={`w-full py-3 rounded-xl text-sm font-bold transition-colors disabled:opacity-50
                ${enabled
                  ? 'bg-green-800 border border-green-600 text-green-300'
                  : 'bg-gray-700 border border-gray-600 text-gray-400'}`}
            >
              {enabled ? '✓ Live for crews — tap to turn off' : 'Off — tap to make live for crews'}
            </button>
            <p className="text-gray-600 text-xs mt-2">
              This is the one switch that makes published paths visible to crews for beta testing.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
