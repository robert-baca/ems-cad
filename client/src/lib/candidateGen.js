import { getDistanceFt } from './geo';
import { buildRouteGraph, snapPointToGraph, insertVirtualNode, findRoute, UnionFind } from './routeGraph';

// How far apart two trace endpoints (a crew's GPS position at the very
// start or end of a call) can be and still count as "the same place" — the
// same station, ride, or first-aid post visited across many different
// calls. Looser than routeGraph.js's NODE_MERGE_DIST_FT (25ft) since these
// are raw, uncurated GPS fixes, not admin-approved path vertices.
export const HUB_MERGE_DIST_FT = 60;

const MIN_HUB_PAIR_DIST_FT = 20; // mirrors suggestPathFromTraces's own floor

// Labels a hub with a nearby known landmark's name when one exists, since
// "Hub 3 ↔ Hub 7" means nothing to an admin reviewing candidates — falls
// back to rounded coordinates when no landmark is that close.
function labelHub(hub, locations, maxDistFt = 80) {
  let best = null;
  (locations || []).forEach(l => {
    if (l.lat == null || l.lng == null) return;
    const d = getDistanceFt(hub.lat, hub.lng, Number(l.lat), Number(l.lng));
    if (d <= maxDistFt && (!best || d < best.d)) best = { name: l.name, d };
  });
  return best ? best.name : `Trail hub (${hub.lat.toFixed(5)}, ${hub.lng.toFixed(5)})`;
}

// Turns "everywhere a crew's GPS trace actually started or ended" into
// candidate route pairs — no landmark curation required. Clusters every
// call's cleaned-trace start/end point into hubs, then pairs up any two
// hubs a real historical trip actually connected, most-traveled first.
// This is the primary candidate source: unlike generateLandmarkPairs below,
// it needs nothing curated by an admin — just call history that already
// has GPS tracking on it.
export function generateTraceHubPairs(cleanedByCall, locations, { hubMergeDistFt = HUB_MERGE_DIST_FT } = {}) {
  const endpoints = [];
  const callRanges = [];
  Object.values(cleanedByCall || {}).forEach(pts => {
    if (!pts || pts.length < 2) return;
    const startIdx = endpoints.length;
    endpoints.push({ lat: pts[0].lat, lng: pts[0].lng });
    const endIdx = endpoints.length;
    endpoints.push({ lat: pts[pts.length - 1].lat, lng: pts[pts.length - 1].lng });
    callRanges.push({ startIdx, endIdx });
  });
  if (endpoints.length === 0) return [];

  const uf = new UnionFind(endpoints.length);
  for (let i = 0; i < endpoints.length; i++) {
    for (let j = i + 1; j < endpoints.length; j++) {
      if (getDistanceFt(endpoints[i].lat, endpoints[i].lng, endpoints[j].lat, endpoints[j].lng) <= hubMergeDistFt) {
        uf.union(i, j);
      }
    }
  }

  const rootToHubId = new Map();
  const hubSums = new Map();
  for (let i = 0; i < endpoints.length; i++) {
    const root = uf.find(i);
    if (!rootToHubId.has(root)) rootToHubId.set(root, `h${root}`);
    const hubId = rootToHubId.get(root);
    if (!hubSums.has(hubId)) hubSums.set(hubId, { sumLat: 0, sumLng: 0, count: 0 });
    const s = hubSums.get(hubId);
    s.sumLat += endpoints[i].lat;
    s.sumLng += endpoints[i].lng;
    s.count += 1;
  }
  const hubs = new Map();
  hubSums.forEach((s, id) => hubs.set(id, { lat: s.sumLat / s.count, lng: s.sumLng / s.count }));

  const pairs = new Map();
  callRanges.forEach(({ startIdx, endIdx }) => {
    const hubA = rootToHubId.get(uf.find(startIdx));
    const hubB = rootToHubId.get(uf.find(endIdx));
    if (hubA === hubB) return; // this trip's start/end merged into one hub — degenerate, skip
    const key = hubA < hubB ? `${hubA}|${hubB}` : `${hubB}|${hubA}`;
    if (!pairs.has(key)) {
      const posA = hubs.get(hubA), posB = hubs.get(hubB);
      const distFt = getDistanceFt(posA.lat, posA.lng, posB.lat, posB.lng);
      if (distFt < MIN_HUB_PAIR_DIST_FT) return;
      pairs.set(key, {
        a: { lat: posA.lat, lng: posA.lng, name: labelHub(posA, locations) },
        b: { lat: posB.lat, lng: posB.lng, name: labelHub(posB, locations) },
        distFt,
        tripCount: 0
      });
    }
    pairs.get(key).tripCount += 1;
  });

  // Most-traveled first — these are the real "main paths," highest-signal
  // candidates for the admin to review.
  return Array.from(pairs.values()).sort((p, q) => q.tripCount - p.tripCount || p.distFt - q.distFt);
}

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
