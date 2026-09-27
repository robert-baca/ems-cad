import { getDistanceFt } from './geo';
import { makeProjector, nearestOnSegmentFromOrigin } from './snapToPath';

// Turns the flat, independently-drawn list of published `park_paths` lines
// into a routable graph, so a crew member's route to a call can follow the
// trail network instead of a straight line.
//
// Junctions: nodePaths() splices paths together where they cross
// mid-segment and where a path's end stops against the side of another
// (T_JUNCTION_DIST_FT). Before that existed, only vertices that happened to
// land close together were joined, which left the published network in
// disconnected pieces and made many routes fall back to a straight line.

// Cross-path vertex merge tolerance. Tighter than snapToPath.js's
// MAX_SNAP_DIST_FT (40ft), which exists to absorb raw GPS/satellite noise —
// here we're merging vertices from already-curated, admin-approved paths
// against each other, so real junctions should coincide closely. Too loose
// risks welding two genuinely distinct, parallel trails into one false
// junction, which silently corrupts routing.
export const NODE_MERGE_DIST_FT = 25;

// How far a crew member or a call's pin may sit from the nearest published
// path and still be considered "on the network" — generous enough to cover
// being inside a building or backstage near a trail, tight enough that a
// route doesn't get fabricated from somewhere unrelated. Beyond this,
// callers fall back to the existing straight-line behavior.
export const MAX_ROUTE_SNAP_DIST_FT = 150;

function ftFromMeters(m) { return m * 3.28084; }

function isRoutablePath(p) {
  return !!p && Array.isArray(p.coordinates) && p.coordinates.length >= 2;
}

// Exported for reuse by candidateGen.js, which clusters raw trace endpoints
// the same way this clusters path vertices.
export class UnionFind {
  constructor(n) { this.parent = Array.from({ length: n }, (_, i) => i); }
  find(x) {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a, b) {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

// Builds { nodes: Map<nodeId,{lat,lng}>, adjacency: Map<nodeId, Edge[]> }.
// Edge = { id, to, distFt, geometry: [[lng,lat],[lng,lat]] } — geometry[0]
// is always the coordinate of the node this edge is filed under, geometry[1]
// the coordinate of `to`, so route reconstruction can just concatenate them.
// A multigraph: parallel edges between the same two nodes (e.g. two
// separately-drawn paths that happen to share both endpoints) are fine —
// Dijkstra doesn't care.
export function buildRouteGraph(paths, { mergeDistFt = NODE_MERGE_DIST_FT } = {}) {
  const { paths: validPaths, connectors } = nodePaths((paths || []).filter(isRoutablePath));

  // Flatten every vertex of every path, remembering each path's slice.
  const verts = [];
  const pathRanges = [];
  validPaths.forEach(p => {
    const start = verts.length;
    p.coordinates.forEach(([lng, lat]) => verts.push({ lat, lng, pathId: p.id }));
    pathRanges.push({ start, coords: p.coordinates });
  });

  // Union-find vertices from DIFFERENT paths within mergeDistFt into shared
  // junction nodes. Never merge within the same path — that would collapse
  // its own shape and destroy its edges.
  const uf = new UnionFind(verts.length);
  for (let i = 0; i < verts.length; i++) {
    for (let j = i + 1; j < verts.length; j++) {
      if (verts[i].pathId === verts[j].pathId) continue;
      const distFt = getDistanceFt(verts[i].lat, verts[i].lng, verts[j].lat, verts[j].lng);
      if (distFt <= mergeDistFt) uf.union(i, j);
    }
  }

  // Canonical node id per union-find root; node position is the centroid of
  // its cluster (used for graph topology only — edges keep each path's real
  // coordinates/weights, so a merge never distorts rendered geometry).
  const rootToNodeId = new Map();
  const clusterSums = new Map(); // nodeId -> { sumLat, sumLng, count }
  for (let i = 0; i < verts.length; i++) {
    const root = uf.find(i);
    if (!rootToNodeId.has(root)) rootToNodeId.set(root, `n${root}`);
    const nodeId = rootToNodeId.get(root);
    if (!clusterSums.has(nodeId)) clusterSums.set(nodeId, { sumLat: 0, sumLng: 0, count: 0 });
    const c = clusterSums.get(nodeId);
    c.sumLat += verts[i].lat;
    c.sumLng += verts[i].lng;
    c.count += 1;
  }

  const nodes = new Map();
  clusterSums.forEach((c, nodeId) => nodes.set(nodeId, { lat: c.sumLat / c.count, lng: c.sumLng / c.count }));

  const adjacency = new Map();
  const ensure = id => { if (!adjacency.has(id)) adjacency.set(id, []); return adjacency.get(id); };
  nodes.forEach((_, id) => ensure(id));

  let edgeSeq = 0;
  pathRanges.forEach(({ start, coords }) => {
    for (let k = 0; k < coords.length - 1; k++) {
      const nodeA = rootToNodeId.get(uf.find(start + k));
      const nodeB = rootToNodeId.get(uf.find(start + k + 1));
      if (nodeA === nodeB) continue; // degenerate zero-length edge after merging, skip
      const [lngA, latA] = coords[k];
      const [lngB, latB] = coords[k + 1];
      const distFt = getDistanceFt(latA, lngA, latB, lngB);
      const id = `e${edgeSeq++}`;
      ensure(nodeA).push({ id, to: nodeB, distFt, geometry: [[lngA, latA], [lngB, latB]] });
      ensure(nodeB).push({ id, to: nodeA, distFt, geometry: [[lngB, latB], [lngA, latA]] });
    }
  });

  // T-junction connectors from nodePaths(): a path's loose end to the point
  // added on the neighbouring path. Only needed when the gap was too big for
  // the vertex merge above to have joined them already.
  const vertexNode = new Map(); // "lng,lat" -> nodeId (first vertex seen at that exact spot)
  verts.forEach((v, i) => {
    const key = `${v.lng},${v.lat}`;
    if (!vertexNode.has(key)) vertexNode.set(key, rootToNodeId.get(uf.find(i)));
  });
  connectors.forEach(([[lngA, latA], [lngB, latB]]) => {
    const nodeA = vertexNode.get(`${lngA},${latA}`);
    const nodeB = vertexNode.get(`${lngB},${latB}`);
    if (!nodeA || !nodeB || nodeA === nodeB) return;
    const distFt = getDistanceFt(latA, lngA, latB, lngB);
    const id = `c${edgeSeq++}`;
    ensure(nodeA).push({ id, to: nodeB, distFt, geometry: [[lngA, latA], [lngB, latB]] });
    ensure(nodeB).push({ id, to: nodeA, distFt, geometry: [[lngB, latB], [lngA, latA]] });
  });

  return { nodes, adjacency };
}

// How close a path's loose end has to be to the side of another path to be
// treated as joining it (a T-junction). Hand-traced paths routinely stop a
// little short of, or overshoot, the walkway they meet.
export const T_JUNCTION_DIST_FT = 40;

// Paths are traced independently, so where two walkways cross mid-segment,
// or one ends against the side of another, they share no vertex -- and the
// vertex merge in buildRouteGraph can't join them. Left alone, that split
// the published network into disconnected islands, so many routes silently
// fell back to a straight line. This "nodes" the network first:
//  - every crossing between segments of different paths gets a vertex
//    inserted at the exact same spot on both (the merge then joins them)
//  - every path end within T_JUNCTION_DIST_FT of another path's segment
//    gets a vertex inserted on that segment, plus a connector edge to it
// Returns new path objects (inputs untouched) and the connector list.
function nodePaths(paths) {
  if (!paths.length) return { paths, connectors: [] };
  const lat0 = paths[0].coordinates[0][1];
  const lng0 = paths[0].coordinates[0][0];
  const FT_PER_DEG = 111320 * 3.28084;
  const kx = Math.cos(lat0 * Math.PI / 180) * FT_PER_DEG;
  const toXY = ([lng, lat]) => [(lng - lng0) * kx, (lat - lat0) * FT_PER_DEG];
  const toLngLat = ([x, y]) => [lng0 + x / kx, lat0 + y / FT_PER_DEG];

  const segs = []; // { p, k, a:[x,y], b:[x,y], minX.. }
  paths.forEach((path, p) => {
    const c = path.coordinates;
    for (let k = 0; k < c.length - 1; k++) {
      const a = toXY(c[k]), b = toXY(c[k + 1]);
      segs.push({ p, k, a, b,
        minX: Math.min(a[0], b[0]), maxX: Math.max(a[0], b[0]),
        minY: Math.min(a[1], b[1]), maxY: Math.max(a[1], b[1]) });
    }
  });

  // splits[p][k] = [{ t, xy }] -- points to insert inside segment k of path p
  const splits = paths.map(path => path.coordinates.map(() => []));
  const addSplit = (s, t, xy) => splits[s.p][s.k].push({ t, xy });
  const EPS = 1e-6;

  // 1. Crossings between different paths.
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    for (let j = i + 1; j < segs.length; j++) {
      const u = segs[j];
      if (u.p === s.p) continue;
      if (u.minX > s.maxX || u.maxX < s.minX || u.minY > s.maxY || u.maxY < s.minY) continue;
      const rx = s.b[0] - s.a[0], ry = s.b[1] - s.a[1];
      const qx = u.b[0] - u.a[0], qy = u.b[1] - u.a[1];
      const den = rx * qy - ry * qx;
      if (Math.abs(den) < 1e-9) continue; // parallel
      const dx = u.a[0] - s.a[0], dy = u.a[1] - s.a[1];
      const t = (dx * qy - dy * qx) / den;
      const v = (dx * ry - dy * rx) / den;
      if (t <= EPS || t >= 1 - EPS || v <= EPS || v >= 1 - EPS) continue; // endpoints handled by merge/T-junctions
      const xy = [s.a[0] + t * rx, s.a[1] + t * ry];
      addSplit(s, t, xy);
      addSplit(u, v, xy);
    }
  }

  // 2. T-junctions: each path end to the nearest segment of another path.
  const connectors = [];
  paths.forEach((path, p) => {
    const c = path.coordinates;
    [0, c.length - 1].forEach(idx => {
      const pt = toXY(c[idx]);
      let best = null;
      for (const s of segs) {
        if (s.p === p) continue;
        if (pt[0] < s.minX - T_JUNCTION_DIST_FT || pt[0] > s.maxX + T_JUNCTION_DIST_FT ||
            pt[1] < s.minY - T_JUNCTION_DIST_FT || pt[1] > s.maxY + T_JUNCTION_DIST_FT) continue;
        const rx = s.b[0] - s.a[0], ry = s.b[1] - s.a[1];
        const len2 = rx * rx + ry * ry;
        if (!len2) continue;
        const t = Math.max(0, Math.min(1, ((pt[0] - s.a[0]) * rx + (pt[1] - s.a[1]) * ry) / len2));
        const x = s.a[0] + t * rx, y = s.a[1] + t * ry;
        const d = Math.hypot(pt[0] - x, pt[1] - y);
        if (d <= T_JUNCTION_DIST_FT && (!best || d < best.d)) best = { s, t, xy: [x, y], d };
      }
      if (!best) return;
      let target;
      if (best.t <= EPS) target = paths[best.s.p].coordinates[best.s.k];
      else if (best.t >= 1 - EPS) target = paths[best.s.p].coordinates[best.s.k + 1];
      else { addSplit(best.s, best.t, best.xy); target = toLngLat(best.xy); }
      connectors.push([c[idx], target]);
    });
  });

  // 3. Rebuild each path with its inserted vertices, in order along it.
  // Inserted points use the same toLngLat() of the same xy on both paths,
  // so a crossing lands on bit-identical coordinates and merges.
  const out = paths.map((path, p) => {
    const c = path.coordinates;
    const coords = [];
    for (let k = 0; k < c.length; k++) {
      coords.push(c[k]);
      if (k < c.length - 1) {
        splits[p][k].sort((m, n) => m.t - n.t).forEach(({ xy }) => coords.push(toLngLat(xy)));
      }
    }
    return { ...path, coordinates: coords };
  });
  // Connector targets that were inserted points must match the rebuilt
  // coordinates exactly -- they do, since both came from toLngLat(xy).
  return { paths: out, connectors };
}

// Snaps an arbitrary [lng,lat] point (crew position, call location) onto the
// nearest edge in the graph. Returns null if nothing is within maxDistFt.
export function snapPointToGraph(graph, [lng, lat], maxDistFt = MAX_ROUTE_SNAP_DIST_FT) {
  const proj = makeProjector(lat, lng);
  let best = null;

  graph.adjacency.forEach((edges, nodeId) => {
    edges.forEach(edge => {
      const [aLng, aLat] = edge.geometry[0];
      const [bLng, bLat] = edge.geometry[1];
      const [ax, ay] = proj.toXY(aLat, aLng);
      const [bx, by] = proj.toXY(bLat, bLng);
      const result = nearestOnSegmentFromOrigin(ax, ay, bx, by);
      if (!best || result.distSq < best.distSq) {
        best = { ...result, nodeA: nodeId, nodeB: edge.to, edgeId: edge.id, edgeDistFt: edge.distFt, aLng, aLat, bLng, bLat };
      }
    });
  });

  if (!best) return null;
  const distFt = ftFromMeters(Math.sqrt(best.distSq));
  if (distFt > maxDistFt) return null;

  const [snapLng, snapLat] = proj.toLngLat(best.x, best.y);
  return {
    nodeA: best.nodeA, nodeB: best.nodeB, edgeId: best.edgeId, edgeDistFt: best.edgeDistFt,
    t: best.t, lng: snapLng, lat: snapLat, distFt,
    aLng: best.aLng, aLat: best.aLat, bLng: best.bLng, bLat: best.bLat
  };
}

// Splits the edge a snap landed on into two, inserting a new node at the
// snap point. Never mutates the input graph — returns a shallow-cloned one
// so the same memoized base graph can be reused for both the start and end
// snap of a single route computation.
export function insertVirtualNode(graph, snap) {
  const nodeId = `vn_${Math.random().toString(36).slice(2, 10)}`;

  const nodes = new Map(graph.nodes);
  nodes.set(nodeId, { lat: snap.lat, lng: snap.lng });

  const adjacency = new Map();
  graph.adjacency.forEach((edges, id) => adjacency.set(id, edges.slice()));
  const ensure = id => { if (!adjacency.has(id)) adjacency.set(id, []); return adjacency.get(id); };

  const dropSnappedEdge = fromId => adjacency.set(fromId, ensure(fromId).filter(e => e.id !== snap.edgeId));
  dropSnappedEdge(snap.nodeA);
  dropSnappedEdge(snap.nodeB);

  const distA = snap.t * snap.edgeDistFt;
  const distB = (1 - snap.t) * snap.edgeDistFt;
  const idA = `${snap.edgeId}_a`, idB = `${snap.edgeId}_b`;

  ensure(snap.nodeA).push({ id: idA, to: nodeId, distFt: distA, geometry: [[snap.aLng, snap.aLat], [snap.lng, snap.lat]] });
  ensure(nodeId).push({ id: idA, to: snap.nodeA, distFt: distA, geometry: [[snap.lng, snap.lat], [snap.aLng, snap.aLat]] });
  ensure(snap.nodeB).push({ id: idB, to: nodeId, distFt: distB, geometry: [[snap.bLng, snap.bLat], [snap.lng, snap.lat]] });
  ensure(nodeId).push({ id: idB, to: snap.nodeB, distFt: distB, geometry: [[snap.lng, snap.lat], [snap.bLng, snap.bLat]] });

  return { graph: { nodes, adjacency }, nodeId };
}

// Plain array-scan Dijkstra — no binary heap. The network is one theme
// park's worth of paths (dozens to low hundreds of nodes), so O(V^2) is
// trivially cheap and stays simple to read and debug.
export function findRoute(graph, startId, endId) {
  if (startId === endId) return { points: [], distFt: 0 };

  const dist = new Map();
  const prevNode = new Map();
  const prevEdge = new Map();
  const visited = new Set();
  graph.nodes.forEach((_, id) => dist.set(id, Infinity));
  dist.set(startId, 0);

  for (;;) {
    let u = null, best = Infinity;
    dist.forEach((d, id) => { if (!visited.has(id) && d < best) { best = d; u = id; } });
    if (u === null || u === endId) break;
    visited.add(u);
    (graph.adjacency.get(u) || []).forEach(edge => {
      if (visited.has(edge.to)) return;
      const alt = dist.get(u) + edge.distFt;
      if (alt < dist.get(edge.to)) {
        dist.set(edge.to, alt);
        prevNode.set(edge.to, u);
        prevEdge.set(edge.to, edge);
      }
    });
  }

  const totalDistFt = dist.get(endId);
  if (!Number.isFinite(totalDistFt)) return null; // disconnected

  const geomChunks = [];
  let cur = endId;
  while (cur !== startId) {
    const edge = prevEdge.get(cur);
    if (!edge) return null;
    geomChunks.push(edge.geometry);
    cur = prevNode.get(cur);
  }
  geomChunks.reverse();

  const points = [];
  geomChunks.forEach((geom, i) => {
    if (i === 0) points.push(geom[0]);
    points.push(geom[1]);
  });

  return { points, distFt: Math.round(totalDistFt) };
}

// Orchestrator: builds the graph, snaps both ends onto it, and finds the
// shortest path. Returns null — meaning "fall back to a straight line" —
// whenever there are no paths, either point is too far from the network, or
// the network is disconnected between them. This one function IS the
// fallback logic; callers don't need their own error handling.
export function computeRoute(paths, startLngLat, endLngLat, opts = {}) {
  if (!Array.isArray(paths) || paths.length === 0) return null;
  if (!startLngLat || !endLngLat) return null;

  const graph = buildRouteGraph(paths, opts);
  if (graph.nodes.size === 0) return null;

  const maxSnapDistFt = opts.maxSnapDistFt ?? MAX_ROUTE_SNAP_DIST_FT;

  const startSnap = snapPointToGraph(graph, startLngLat, maxSnapDistFt);
  if (!startSnap) return null;
  const { graph: g1, nodeId: startId } = insertVirtualNode(graph, startSnap);

  const endSnap = snapPointToGraph(g1, endLngLat, maxSnapDistFt);
  if (!endSnap) return null;
  const { graph: g2, nodeId: endId } = insertVirtualNode(g1, endSnap);

  return findRoute(g2, startId, endId);
}
