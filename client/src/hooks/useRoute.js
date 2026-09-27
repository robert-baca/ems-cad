import { useEffect, useMemo, useRef, useState } from 'react';
import { buildRouteGraph, snapPointToGraph, insertVirtualNode, findRoute } from '../lib/routeGraph';
import { getDistanceFt } from '../lib/geo';

// GPS noise alone is typically 10-30ft — recomputing the route on every tick
// would jitter the line and waste battery for no visible benefit. Only
// reroute once the crew has actually moved far enough to plausibly change
// the best path, or the call itself moves.
const REROUTE_THRESHOLD_FT = 50;

// Routes the crew's live position to the call through the published trail
// network, returning { points, distFt } or null when no route is possible
// (paths off/empty, either point too far from the network, or the network
// doesn't connect them) — callers should fall back to a straight line on null.
// Returns { route, why }: `why` says, when there's no route, what stopped
// it -- shown on the crew map so a straight-line fallback isn't a mystery:
// 'off' (wayfinding disabled), 'no-paths', 'no-gps', 'no-pin',
// 'start-off' / 'pin-off' (more than MAX_ROUTE_SNAP_DIST_FT from any
// walkway, with the distance in `offFt`), 'disconnected'.
export function useRoute(paths, pathsEnabled, crewLngLat, callLngLat) {
  // Coerce: a string coordinate would turn later arithmetic into string
  // concatenation and silently kill routing.
  const num = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const crewLng = num(crewLngLat?.[0]);
  const crewLat = num(crewLngLat?.[1]);
  const callLng = num(callLngLat?.[0]);
  const callLat = num(callLngLat?.[1]);

  // The graph only needs rebuilding when the published network changes —
  // it's the relatively expensive step, so it's kept separate from the
  // cheaper per-position snap+Dijkstra below.
  const graph = useMemo(() => (pathsEnabled ? buildRouteGraph(paths) : null), [paths, pathsEnabled]);

  const [route, setRoute] = useState(null);
  const [why, setWhy] = useState(null); // { reason, offFt? } when route is null
  const lastRef = useRef(null); // { graph, crewLng, crewLat, callLng, callLat }

  useEffect(() => {
    if (!graph || !graph.nodes.size || crewLng == null || crewLat == null || callLng == null || callLat == null) {
      setRoute(null);
      setWhy({ reason: !pathsEnabled ? 'off' : !graph || !graph.nodes.size ? 'no-paths' : crewLng == null || crewLat == null ? 'no-gps' : 'no-pin' });
      lastRef.current = null;
      return;
    }

    const last = lastRef.current;
    const graphChanged = !last || last.graph !== graph;
    const callMoved = !last || last.callLng !== callLng || last.callLat !== callLat;
    const crewMovedFt = (last && !graphChanged) ? getDistanceFt(last.crewLat, last.crewLng, crewLat, crewLng) : Infinity;

    if (!graphChanged && !callMoved && crewMovedFt < REROUTE_THRESHOLD_FT) return;
    lastRef.current = { graph, crewLng, crewLat, callLng, callLat };

    const offBy = pt => Math.round(snapPointToGraph(graph, pt, Infinity)?.distFt ?? 0);
    const startSnap = snapPointToGraph(graph, [crewLng, crewLat]);
    if (!startSnap) { setRoute(null); setWhy({ reason: 'start-off', offFt: offBy([crewLng, crewLat]) }); return; }
    const { graph: g1, nodeId: startId } = insertVirtualNode(graph, startSnap);

    const endSnap = snapPointToGraph(g1, [callLng, callLat]);
    if (!endSnap) { setRoute(null); setWhy({ reason: 'pin-off', offFt: offBy([callLng, callLat]) }); return; }
    const { graph: g2, nodeId: endId } = insertVirtualNode(g1, endSnap);

    // findRoute only covers path-to-path; add the walk from the crew's real
    // position onto the network and from the network to the actual pin.
    // Without these legs (up to MAX_ROUTE_SNAP_DIST_FT each) the distance
    // could read shorter than the straight line, and the drawn line stopped
    // short of both the crew dot and the destination.
    const r = findRoute(g2, startId, endId);
    setRoute(r ? {
      points: [[crewLng, crewLat], ...r.points, [callLng, callLat]],
      distFt: Math.round(r.distFt + startSnap.distFt + endSnap.distFt),
    } : null);
    setWhy(r ? null : { reason: 'disconnected' });
  }, [graph, pathsEnabled, crewLng, crewLat, callLng, callLat]);

  return { route, why };
}
