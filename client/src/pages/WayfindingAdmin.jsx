import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import { useAuth } from '../context/AuthContext';
import { useLocations } from '../hooks/useLocations';
import {
  getWayfindingTraces, getParkPaths, createParkPath, deleteParkPath,
  getWayfindingSettings, setWayfindingEnabled
} from '../services/api';
import { cleanTrace, suggestPathFromTraces } from '../lib/pathSuggest';
import { snapPointToBasemap, snapSuggestedPath } from '../lib/snapToPath';
import { generateLandmarkPairs, generateTraceHubPairs, filterAlreadyConnected, filterCoveredCorridors, TOP_N_CANDIDATES } from '../lib/candidateGen';
import { discoverCorridors } from '../lib/corridorDiscovery';
import { extractBasemapPaths } from '../lib/basemapPaths';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const PARK_CENTER = [-97.0648, 32.7550];
const EMPTY_FC = { type: 'FeatureCollection', features: [] };

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Batch candidates can be scattered anywhere in the park — pan/zoom to each
// new one as it comes up instead of leaving the admin to hunt for it.
function fitMapToPoints(map, points) {
  if (!map || !Array.isArray(points) || points.length === 0) return;
  const bounds = points.reduce((b, p) => b.extend(p), new mapboxgl.LngLatBounds(points[0], points[0]));
  map.fitBounds(bounds, { padding: 100, maxZoom: 19, duration: 600 });
}

export default function WayfindingAdmin() {
  const { user, logout } = useAuth();
  const { locations } = useLocations();
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
  const [drawPointsSnapped, setDrawPointsSnapped] = useState([]); // parallel to drawPoints — basemap-snapped or not
  const [pathName,   setPathName]   = useState('');
  const [saving,     setSaving]     = useState(false);
  const [saveError,  setSaveError]  = useState('');

  // Result tier of the last "Suggest From Data" run — drives the status badge.
  const [suggestSource, setSuggestSource] = useState(null); // 'basemap' | 'mapmatch' | 'raw' | null
  const [suggesting,    setSuggesting]    = useState(false);

  // 'idle' | 'pick-start' | 'pick-end' — picking the two endpoints for a
  // trace-evidence suggestion, which then hands off into the normal
  // drawing/review flow above so it's edited/saved the same way.
  const [suggestMode,  setSuggestMode]  = useState('idle');
  const [suggestStart, setSuggestStart] = useState(null);
  const [suggestError, setSuggestError] = useState('');

  // Batch Suggest: runs the same suggestPathFromTraces/snapSuggestedPath
  // pipeline as manual "Suggest From Data" across every candidate landmark
  // pair automatically, but still hands each result through the normal
  // drawing/review/save flow below — nothing gets published unreviewed.
  // null = not in batch mode; an array (possibly empty) = remaining queue.
  const [batchQueue, setBatchQueue] = useState(null);
  const [batchTotal, setBatchTotal] = useState(0);
  const [batchStats, setBatchStats] = useState({ approved: 0, rejected: 0, skippedNoData: 0 });

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
    clickHandlerRef.current = async (lngLat) => {
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
          setSuggestSource(null);
          setSuggestError(result.reason || 'Not enough data along that line yet.');
          return;
        }
        setSuggestError('');
        setDrawing(true);
        setPathName('');
        setSaveError('');
        setSuggesting(true);
        setSuggestSource(null);
        try {
          const snapped = await snapSuggestedPath(mapRef.current, result.points, mapboxgl.accessToken);
          setDrawPoints(snapped.points);
          setDrawPointsSnapped(snapped.flags);
          setSuggestSource(snapped.source);
        } finally {
          setSuggesting(false);
        }
        return;
      }
      if (!drawing) return;
      const { point, snapped } = snapPointToBasemap(mapRef.current, lngLat);
      setDrawPoints(prev => [...prev, point]);
      setDrawPointsSnapped(prev => [...prev, snapped]);
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
    drawMarkersRef.current = drawPoints.map(([lng, lat], i) =>
      new mapboxgl.Marker({ color: drawPointsSnapped[i] ? '#22c55e' : '#60a5fa', scale: 0.6 }).setLngLat([lng, lat]).addTo(map)
    );
  }, [drawPoints, drawPointsSnapped, mapLoaded]);

  const startDrawing  = () => { setDrawing(true); setDrawPoints([]); setDrawPointsSnapped([]); setPathName(''); setSaveError(''); setSuggestSource(null); };
  const undoLastPoint = () => { setDrawPoints(prev => prev.slice(0, -1)); setDrawPointsSnapped(prev => prev.slice(0, -1)); };
  const cancelDrawing = () => { setDrawing(false); setDrawPoints([]); setDrawPointsSnapped([]); setPathName(''); setSaveError(''); setSuggestSource(null); };

  // Returns whether the save succeeded — the manual "Save Path" button
  // ignores this, but Batch Suggest needs it to know whether to advance to
  // the next candidate or leave the error in place for a retry.
  const savePath = async () => {
    if (drawPoints.length < 2) { setSaveError('Click at least 2 points on the map first.'); return false; }
    setSaving(true);
    setSaveError('');
    try {
      const res = await createParkPath(pathName.trim() || null, drawPoints);
      setPaths(prev => [...prev, res.data]);
      cancelDrawing();
      return true;
    } catch (err) {
      setSaveError(err?.response?.data?.error || 'Failed to save path');
      return false;
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

  // Pops candidates off the front of the queue, silently skipping (just
  // counting) any 'od-pair' candidate with no real GPS evidence, and stops
  // on the first one that produces a real suggestion — populating it into
  // the exact same drawing/review state the manual "Suggest From Data" flow
  // uses. 'corridor' and 'basemap' candidates already carry a finished
  // `points` line (no origin/destination pair to test evidence against), so
  // they skip straight to snapping.
  const advanceBatch = async (queue) => {
    let remaining = queue;
    let skipped = 0;
    while (remaining.length > 0) {
      const [candidate, ...rest] = remaining;
      let points, label;

      if (candidate.kind === 'od-pair') {
        const start = [Number(candidate.a.lng), Number(candidate.a.lat)];
        const end   = [Number(candidate.b.lng), Number(candidate.b.lat)];
        const result = suggestPathFromTraces(start, end, allCleanedPoints);
        if (!result.points) {
          skipped++;
          remaining = rest;
          continue;
        }
        points = result.points;
        label = `${candidate.a.name} ↔ ${candidate.b.name}`;
      } else {
        points = candidate.points;
        label = candidate.kind === 'basemap'
          ? (candidate.name || 'Existing basemap path')
          : `Corridor (${candidate.distinctCalls} calls)`;
      }

      setBatchQueue(rest);
      if (skipped > 0) setBatchStats(s => ({ ...s, skippedNoData: s.skippedNoData + skipped }));

      fitMapToPoints(mapRef.current, points);
      setDrawing(true);
      setPathName(label);
      setSaveError('');
      setSuggestSource(null);
      setSuggesting(true);
      try {
        const snapped = await snapSuggestedPath(mapRef.current, points, mapboxgl.accessToken);
        setDrawPoints(snapped.points);
        setDrawPointsSnapped(snapped.flags);
        setSuggestSource(snapped.source);
      } finally {
        setSuggesting(false);
      }
      return;
    }

    if (skipped > 0) setBatchStats(s => ({ ...s, skippedNoData: s.skippedNoData + skipped }));
    setBatchQueue(null); // queue exhausted — nothing left to review
  };

  const startQueue = (pending, emptyMessage) => {
    if (pending.length === 0) {
      setSuggestError(emptyMessage);
      return;
    }
    setSuggestError('');
    setBatchTotal(pending.length);
    setBatchStats({ approved: 0, rejected: 0, skippedNoData: 0 });
    advanceBatch(pending);
  };

  const startBatchSuggest = () => {
    // Trace-derived hubs (real crew movement — no curation required) come
    // first, so the highest-signal, most-traveled candidates get reviewed
    // before the landmark-derived ones. This is the secondary/gap-filling
    // tool now — "Discover Corridors" below is the primary way to build out
    // the network from GPS history.
    const hubPairs = generateTraceHubPairs(cleanedByCall, locations);
    const landmarkPairs = generateLandmarkPairs(locations);
    const combined = [...hubPairs, ...landmarkPairs].map(c => ({ kind: 'od-pair', ...c })).slice(0, TOP_N_CANDIDATES);
    const pending = filterAlreadyConnected(combined, paths);
    startQueue(pending, 'No new candidates found — the network may already cover everything the current GPS history and landmarks support.');
  };

  const startCorridorDiscovery = () => {
    const corridors = discoverCorridors(cleanedByCall);
    const covered = filterCoveredCorridors(corridors, paths).slice(0, TOP_N_CANDIDATES);
    const pending = covered.map(c => ({ kind: 'corridor', ...c }));
    startQueue(pending, 'No new corridors found — try collecting more GPS history, or the network may already cover what’s there.');
  };

  const startBasemapImport = () => {
    const basemapLines = extractBasemapPaths(mapRef.current);
    const covered = filterCoveredCorridors(basemapLines, paths).slice(0, TOP_N_CANDIDATES);
    const pending = covered.map(c => ({ kind: 'basemap', ...c }));
    startQueue(pending, 'No new basemap paths found nearby — try panning/zooming the map to load more of the area first.');
  };

  const approveBatchCandidate = async () => {
    const ok = await savePath();
    if (!ok) return; // leave the error in place so the admin can retry or quit
    setBatchStats(s => ({ ...s, approved: s.approved + 1 }));
    advanceBatch(batchQueue || []);
  };

  const rejectBatchCandidate = () => {
    cancelDrawing();
    setBatchStats(s => ({ ...s, rejected: s.rejected + 1 }));
    advanceBatch(batchQueue || []);
  };

  const quitBatch = () => {
    setBatchQueue(null);
    cancelDrawing();
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

                <div className="pt-1 border-t border-gray-700" />

                <button
                  onClick={startCorridorDiscovery}
                  disabled={!traces || traces.length === 0}
                  className="w-full py-2.5 bg-teal-800 hover:bg-teal-700 disabled:opacity-40 text-white text-sm font-bold rounded-lg transition-colors"
                >
                  🗺️ Discover Corridors
                </button>
                <p className="text-gray-600 text-xs">
                  Clusters the density of every crew's GPS trace directly into real corridors — each trail crews have actually walked shows up once, most-traveled first, for you to review and approve.
                </p>
                <button
                  onClick={startBasemapImport}
                  disabled={!traces || traces.length === 0}
                  className="w-full py-2.5 bg-cyan-800 hover:bg-cyan-700 disabled:opacity-40 text-white text-sm font-bold rounded-lg transition-colors"
                >
                  🛣️ Import From Basemap
                </button>
                <p className="text-gray-600 text-xs">
                  Pulls in walkways the map already has drawn in this area, so they're part of the routable network too — still reviewed one at a time before publishing.
                </p>
                <button
                  onClick={startBatchSuggest}
                  disabled={!traces || traces.length === 0}
                  className="w-full py-2.5 bg-indigo-800 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-bold rounded-lg transition-colors"
                >
                  📋 Batch Suggest
                </button>
                <p className="text-gray-600 text-xs">
                  Suggests routes between hubs and landmarks not yet covered by a discovered corridor — useful for filling small connector gaps once the main corridors are down.
                </p>
                {(!traces || traces.length === 0) && (
                  <p className="text-amber-400 text-xs">
                    {traces === null ? 'Loading GPS trace history…' : 'No historical GPS trace data yet — these tools need past calls with GPS tracking to work from.'}
                  </p>
                )}
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
                {batchQueue !== null && (
                  <div className="bg-indigo-950/60 border border-indigo-700 rounded-lg px-3 py-2 text-xs text-indigo-200">
                    Candidate {batchTotal - batchQueue.length} of {batchTotal} · {batchStats.approved} approved · {batchStats.rejected} rejected
                    {batchStats.skippedNoData > 0 && <> · {batchStats.skippedNoData} no data yet</>}
                  </div>
                )}
                <input
                  type="text"
                  value={pathName}
                  onChange={e => setPathName(e.target.value)}
                  placeholder="Path name (optional)…"
                  className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
                />
                {suggesting && <p className="text-gray-500 text-xs">Snapping to walkways…</p>}
                {!suggesting && suggestSource && (
                  <p className="text-gray-500 text-xs">
                    {suggestSource === 'basemap' && '✓ Snapped to basemap walkways'}
                    {suggestSource === 'mapmatch' && '✓ Snapped via Map Matching'}
                    {suggestSource === 'raw' && '⚠ Using raw GPS trace — no basemap match found'}
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={undoLastPoint}
                    disabled={drawPoints.length === 0}
                    className="flex-1 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-gray-300 text-xs font-semibold rounded-lg transition-colors"
                  >
                    ↩ Undo Point
                  </button>
                  <button
                    onClick={batchQueue !== null ? rejectBatchCandidate : cancelDrawing}
                    className="flex-1 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs font-semibold rounded-lg transition-colors"
                  >
                    {batchQueue !== null ? '⏭ Reject & Skip' : '✕ Cancel'}
                  </button>
                </div>
                {saveError && <p className="text-red-400 text-xs">{saveError}</p>}
                <button
                  onClick={batchQueue !== null ? approveBatchCandidate : savePath}
                  disabled={saving || suggesting || drawPoints.length < 2}
                  className="w-full py-2 bg-green-700 hover:bg-green-600 disabled:bg-gray-600 text-white text-sm font-bold rounded-lg transition-colors"
                >
                  {saving ? 'Saving…' : (batchQueue !== null ? '✓ Approve & Save' : '✓ Save Path')}
                </button>
                {batchQueue !== null && (
                  <button
                    onClick={quitBatch}
                    className="w-full py-1.5 text-gray-500 hover:text-gray-300 text-xs transition-colors"
                  >
                    Quit Batch
                  </button>
                )}
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
