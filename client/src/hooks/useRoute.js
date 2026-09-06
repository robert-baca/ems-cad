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
export function useRoute(paths, pathsEnabled, crewLngLat, callLngLat) {
  const crewLng = crewLngLat?.[0] ?? null;
  const crewLat = crewLngLat?.[1] ?? null;
  const callLng = callLngLat?.[0] ?? null;
  const callLat = callLngLat?.[1] ?? null;

  // The graph only needs rebuilding when the published network changes —
  // it's the relatively expensive step, so it's kept separate from the
  // cheaper per-position snap+Dijkstra below.
  const graph = useMemo(() => (pathsEnabled ? buildRouteGraph(paths) : null), [paths, pathsEnabled]);

  const [route, setRoute] = useState(null);
  const lastRef = useRef(null); // { graph, crewLng, crewLat, callLng, callLat }

  useEffect(() => {
    if (!graph || crewLng == null || crewLat == null || callLng == null || callLat == null) {
      setRoute(null);
      lastRef.current = null;
      return;
    }

    const last = lastRef.current;
    const graphChanged = !last || last.graph !== graph;
    const callMoved = !last || last.callLng !== callLng || last.callLat !== callLat;
    const crewMovedFt = (last && !graphChanged) ? getDistanceFt(last.crewLat, last.crewLng, crewLat, crewLng) : Infinity;

    if (!graphChanged && !callMoved && crewMovedFt < REROUTE_THRESHOLD_FT) return;
    lastRef.current = { graph, crewLng, crewLat, callLng, callLat };

    const startSnap = snapPointToGraph(graph, [crewLng, crewLat]);
    if (!startSnap) { setRoute(null); return; }
    const { graph: g1, nodeId: startId } = insertVirtualNode(graph, startSnap);

    const endSnap = snapPointToGraph(g1, [callLng, callLat]);
    if (!endSnap) { setRoute(null); return; }
    const { graph: g2, nodeId: endId } = insertVirtualNode(g1, endSnap);

    setRoute(findRoute(g2, startId, endId));
  }, [graph, crewLng, crewLat, callLng, callLat]);

  return route;
}
