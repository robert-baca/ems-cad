import { buildRouteGraph, snapPointToGraph, MAX_ROUTE_SNAP_DIST_FT } from './routeGraph';
import { getDistanceFt } from './geo';

// Ranks units by estimated travel time to a call pin, for the dispatcher's
// unit pickers. Uses the same curated walkway network the crew navigation
// routes on, so distance follows real paths instead of cutting through rides.
// A suggestion only -- the dispatcher still chooses.
//
// One shortest-path search runs outward from the call pin, and every unit's
// distance is read off that, instead of routing each unit separately.

const FT_PER_M = 3.28084;
// ~1.4 m/s is normal walking pace; shaded down for park crowds.
export const WALK_MPS = 1.3;
// Park carts, not road speed.
export const CART_MPS = 4.5;
// Straight line → rough path distance when a unit (or the pin) is off the
// mapped network.
const OFF_NETWORK_FACTOR = 1.4;
// Older than this and the dot on the map may not be where the unit is.
export const STALE_GPS_S = 120;

export function buildEtaGraph(paths) {
  if (!Array.isArray(paths) || !paths.length) return null;
  const graph = buildRouteGraph(paths);
  return graph.nodes.size ? graph : null;
}

// Minimal binary heap of [distance, nodeId].
function heapPush(h, item) {
  h.push(item);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h[p][0] <= h[i][0]) break;
    [h[p], h[i]] = [h[i], h[p]]; i = p;
  }
}
function heapPop(h) {
  const top = h[0], last = h.pop();
  if (h.length) {
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < h.length && h[l][0] < h[m][0]) m = l;
      if (r < h.length && h[r][0] < h[m][0]) m = r;
      if (m === i) break;
      [h[m], h[i]] = [h[i], h[m]]; i = m;
    }
  }
  return top;
}

// Distances (ft) from the target's snap point to every node in the graph.
function distancesFrom(graph, snap) {
  const dist = new Map();
  const heap = [];
  const seed = (id, d) => { if (d < (dist.get(id) ?? Infinity)) { dist.set(id, d); heapPush(heap, [d, id]); } };
  seed(snap.nodeA, snap.t * snap.edgeDistFt);
  seed(snap.nodeB, (1 - snap.t) * snap.edgeDistFt);
  while (heap.length) {
    const [d, u] = heapPop(heap);
    if (d > dist.get(u)) continue;
    for (const edge of graph.adjacency.get(u) || []) seed(edge.to, d + edge.distFt);
  }
  return dist;
}

function networkDistanceFt(graph, dist, targetSnap, from) {
  const s = snapPointToGraph(graph, [from.lng, from.lat], MAX_ROUTE_SNAP_DIST_FT);
  if (!s) return null;
  let along;
  if (s.edgeId === targetSnap.edgeId) {
    along = Math.abs(s.t - targetSnap.t) * s.edgeDistFt;
  } else {
    along = Math.min(
      (dist.get(s.nodeA) ?? Infinity) + s.t * s.edgeDistFt,
      (dist.get(s.nodeB) ?? Infinity) + (1 - s.t) * s.edgeDistFt
    );
  }
  if (!Number.isFinite(along)) return null; // not connected to the pin's part of the network
  // Include the walk on/off the network at each end.
  return along + s.distFt + targetSnap.distFt;
}

// Returns { unitId: { distM, etaS, approx, gpsAgeS, stale, noGps } }.
export function estimateUnits(units, target, graph, now = Date.now()) {
  const out = {};
  if (!target || target.lat == null || target.lng == null) return out;
  const targetSnap = graph ? snapPointToGraph(graph, [target.lng, target.lat], MAX_ROUTE_SNAP_DIST_FT) : null;
  const dist = targetSnap ? distancesFrom(graph, targetSnap) : null;

  for (const u of units) {
    if (u.last_lat == null || u.last_lng == null) { out[u.id] = { noGps: true }; continue; }
    const gpsAgeS = u.last_gps_at ? Math.max(0, Math.round((now - new Date(u.last_gps_at).getTime()) / 1000)) : null;
    const from = { lat: u.last_lat, lng: u.last_lng };
    const pathFt = dist ? networkDistanceFt(graph, dist, targetSnap, from) : null;
    const approx = pathFt == null;
    const distM = approx
      ? (getDistanceFt(from.lat, from.lng, target.lat, target.lng) / FT_PER_M) * OFF_NETWORK_FACTOR
      : pathFt / FT_PER_M;
    const speed = u.unit_type === 'Cart' ? CART_MPS : WALK_MPS;
    out[u.id] = {
      distM: Math.round(distM),
      etaS: Math.round(distM / speed),
      approx,
      gpsAgeS,
      stale: gpsAgeS == null || gpsAgeS > STALE_GPS_S,
    };
  }
  return out;
}

// Fresh GPS by ETA first, then stale GPS by ETA, then no position at all.
export function sortByEta(units, estimates) {
  const rank = (u) => {
    const e = estimates[u.id];
    if (!e || e.noGps) return [2, 0];
    return [e.stale ? 1 : 0, e.etaS];
  };
  return [...units].sort((a, b) => {
    const [ga, ea] = rank(a), [gb, eb] = rank(b);
    return ga - gb || ea - eb;
  });
}

export function formatEta(e) {
  if (!e || e.noGps) return 'no GPS';
  const mins = e.etaS < 60 ? '<1 min' : `~${Math.round(e.etaS / 60)} min`;
  const dist = e.distM < 1000 ? `${e.distM} m` : `${(e.distM / 1000).toFixed(1)} km`;
  return `${mins} · ${dist}${e.approx ? ' approx' : ''}`;
}
