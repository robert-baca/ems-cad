import { getDistanceFt } from './geo';
import { buildRouteGraph, snapPointToGraph, insertVirtualNode, findRoute } from './routeGraph';

// How far apart two landmarks can be and still be considered a plausible
// walking-path candidate. A straight line through a building or lake simply
// won't have real GPS evidence nearby and gets rejected downstream by
// suggestPathFromTraces's own evidence check — no extra geographic
// reasoning needed here.
export const MAX_CANDIDATE_DIST_FT = 1500;

// Soft cap on queue size — fine at "dozens of landmarks" scale.
export const TOP_N_CANDIDATES = 150;

// Every unique pair of permanent landmarks within maxDistFt, nearest-first
// (closer pairs are more likely to be genuinely adjacent walkways, so the
// admin burns through the highest-signal candidates first).
export function generateLandmarkPairs(locations, { maxDistFt = MAX_CANDIDATE_DIST_FT, limit = TOP_N_CANDIDATES } = {}) {
  const landmarks = (locations || []).filter(l => l.locationType === 'permanent' && l.lat != null && l.lng != null);

  const pairs = [];
  for (let i = 0; i < landmarks.length; i++) {
    for (let j = i + 1; j < landmarks.length; j++) {
      const a = landmarks[i], b = landmarks[j];
      const distFt = getDistanceFt(Number(a.lat), Number(a.lng), Number(b.lat), Number(b.lng));
      if (distFt <= maxDistFt) pairs.push({ a, b, distFt });
    }
  }
  pairs.sort((p, q) => p.distFt - q.distFt);
  return pairs.slice(0, limit);
}

// Drops any candidate a route already connects through the published
// network (via any chain of paths, not just a single direct one) — the
// batch queue should only ever surface genuine gaps.
export function filterAlreadyConnected(candidates, paths) {
  if (!Array.isArray(paths) || paths.length === 0) return candidates;
  const graph = buildRouteGraph(paths);

  return candidates.filter(({ a, b }) => {
    const startSnap = snapPointToGraph(graph, [Number(a.lng), Number(a.lat)]);
    if (!startSnap) return true; // not near the network at all — can't be "already connected"
    const { graph: g1, nodeId: startId } = insertVirtualNode(graph, startSnap);

    const endSnap = snapPointToGraph(g1, [Number(b.lng), Number(b.lat)]);
    if (!endSnap) return true;
    const { graph: g2, nodeId: endId } = insertVirtualNode(g1, endSnap);

    return !findRoute(g2, startId, endId);
  });
}
