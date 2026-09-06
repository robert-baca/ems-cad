import { getDistanceFt, getBearing, toRad } from './geo';
import { makeProjector } from './snapToPath';
import { UnionFind } from './routeGraph';

// Discovers real walkway corridors directly from the density of everywhere
// crews have actually walked, independent of any particular origin/
// destination pair — unlike candidateGen.js's hub-pair suggestion, which
// re-derives the same physical corridor once per pair that happens to use
// it (a "Station -> Ride A" and "Station -> Ride B" trip both retrace the
// same first stretch out of the station). Each real corridor should surface
// here exactly once.
//
// Deliberately doesn't touch pathSuggest.js: the "bin along an axis, average
// the perpendicular offset" centerline technique below mirrors what
// suggestPathFromTraces already does, but is reimplemented locally rather
// than extracted into a shared helper — refactoring a small, already-live,
// already-approved-in-production function for reuse isn't worth the
// regression risk here.

// Below this, a GPS fix pair's heading is noise, not a real direction —
// well under typical consumer GPS jitter. Above this, the pair likely spans
// a GPS gap or a turn and can't be trusted as "one straight heading."
export const MIN_SEGMENT_LEN_FT = 8;
export const MAX_SEGMENT_LEN_FT = 150;

// How close (in position) and how aligned (in heading) two micro-segments
// from possibly-different calls need to be to count as the same physical
// corridor. Heading is compared mod 180 so a crew walking either direction
// on the same trail still merges into one bundle.
export const CLUSTER_DIST_FT = 40;
export const CLUSTER_HEADING_DEG = 25;

// A bundle needs both real depth (segment count) and real breadth (distinct
// calls) before it's trusted as a corridor — segment count alone lets one
// call's noisy loitering pass, call count alone lets a few calls that each
// barely brush an intersection pass.
export const MIN_BUNDLE_SEGMENTS = 15;
export const MIN_BUNDLE_CALLS = 3;
export const MIN_BUNDLE_LENGTH_FT = 30;

// How far a point can be off the bundle's principal axis and still count
// toward its centerline — same role as pathSuggest.js's CORRIDOR_FT.
const CORRIDOR_FT = 60;

// Bin count scales with a bundle's own discovered length (it has no clicked
// endpoints to fix an extent ahead of time), clamped to a sane range.
const BIN_TARGET_FT = 40, MIN_BINS = 4, MAX_BINS = 30;

// Breaks every call's already-cleaned trace into consecutive-point-pair
// micro-segments — no resampling/interpolation needed, cleanTrace already
// removed GPS glitches upstream.
export function buildMicroSegments(cleanedByCall) {
  const segments = [];
  Object.entries(cleanedByCall || {}).forEach(([callId, pts]) => {
    for (let i = 0; i < (pts?.length || 0) - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const lengthFt = getDistanceFt(a.lat, a.lng, b.lat, b.lng);
      if (lengthFt < MIN_SEGMENT_LEN_FT || lengthFt > MAX_SEGMENT_LEN_FT) continue;
      segments.push({
        aLat: a.lat, aLng: a.lng, bLat: b.lat, bLng: b.lng,
        midLat: (a.lat + b.lat) / 2, midLng: (a.lng + b.lng) / 2,
        heading: getBearing(a.lat, a.lng, b.lat, b.lng),
        lengthFt, callId
      });
    }
  });
  return segments;
}

// Angular difference treating a heading and its opposite (heading+180) as
// identical — folds both the 0/360 wrap and the "same trail, other
// direction" case into one comparison, 0-90.
function headingDiffMod180(h1, h2) {
  const d = Math.abs(h1 - h2) % 180;
  return d > 90 ? 180 - d : d;
}

// Grid-hashed union-find over all micro-segments from every call combined.
// Naive O(n^2) comparison won't hold up as a season of GPS history
// accumulates, so segment midpoints are bucketed into cells sized exactly
// CLUSTER_DIST_FT — the standard grid-proximity-search guarantee that any
// two points within the threshold land in the same or an adjacent cell —
// and only the 3x3 neighborhood is ever compared, keeping this roughly
// linear in segment count.
export function clusterMicroSegments(segments) {
  if (segments.length === 0) return [];

  let sumLat = 0, sumLng = 0;
  segments.forEach(s => { sumLat += s.midLat; sumLng += s.midLng; });
  const proj = makeProjector(sumLat / segments.length, sumLng / segments.length);
  const cellSizeM = CLUSTER_DIST_FT / 3.28084;

  const xy = segments.map(s => proj.toXY(s.midLat, s.midLng));
  const grid = new Map();
  xy.forEach(([x, y], i) => {
    const key = `${Math.floor(x / cellSizeM)}_${Math.floor(y / cellSizeM)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  });

  const uf = new UnionFind(segments.length);
  xy.forEach(([x, y], i) => {
    const cx = Math.floor(x / cellSizeM), cy = Math.floor(y / cellSizeM);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = grid.get(`${cx + dx}_${cy + dy}`);
        if (!bucket) continue;
        bucket.forEach(j => {
          if (j <= i) return; // each unordered pair evaluated exactly once
          const distFt = Math.hypot(x - xy[j][0], y - xy[j][1]) * 3.28084;
          if (distFt > CLUSTER_DIST_FT) return;
          if (headingDiffMod180(segments[i].heading, segments[j].heading) > CLUSTER_HEADING_DEG) return;
          uf.union(i, j);
        });
      }
    }
  });

  const rootToBundle = new Map();
  segments.forEach((s, i) => {
    const root = uf.find(i);
    if (!rootToBundle.has(root)) rootToBundle.set(root, []);
    rootToBundle.get(root).push(s);
  });
  return Array.from(rootToBundle.values()).map(segs => ({ segments: segs }));
}

// Length-weighted circular mean of headings mod 180 (the "doubling angle"
// trick: doubling folds a heading and its opposite onto the same angle, so
// averaging as vectors then halving gives the correct axial mean) — long
// straight runs outvote short noisy ones.
function principalHeadingMod180(segments) {
  let sx = 0, sy = 0;
  segments.forEach(s => {
    const rad = toRad(s.heading * 2);
    sx += s.lengthFt * Math.cos(rad);
    sy += s.lengthFt * Math.sin(rad);
  });
  return ((Math.atan2(sy, sx) * 180 / Math.PI + 360) % 360) / 2;
}

// Builds a centerline for one bundle: find its principal heading, project
// every point in it onto that axis (the bundle's own extent along the axis
// defines the corridor's length — no clicked endpoints), then bin-and-
// average the perpendicular offset, same technique pathSuggest.js's
// suggestPathFromTraces already uses. Returns null if there isn't enough
// real geometry to trust after projecting.
export function computeBundleCenterline(bundle) {
  const segs = bundle.segments;
  const originLat = segs.reduce((s, x) => s + (x.aLat + x.bLat) / 2, 0) / segs.length;
  const originLng = segs.reduce((s, x) => s + (x.aLng + x.bLng) / 2, 0) / segs.length;
  const proj = makeProjector(originLat, originLng);

  const heading = principalHeadingMod180(segs);
  const rad = toRad(heading);
  const ux = Math.sin(rad), uy = Math.cos(rad); // compass bearing -> (east,north) unit vector

  const rawPoints = [];
  segs.forEach(s => { rawPoints.push({ lat: s.aLat, lng: s.aLng }, { lat: s.bLat, lng: s.bLng }); });

  let axisMin = Infinity, axisMax = -Infinity;
  rawPoints.forEach(p => {
    const [px, py] = proj.toXY(p.lat, p.lng);
    const t = px * ux + py * uy;
    if (t < axisMin) axisMin = t;
    if (t > axisMax) axisMax = t;
  });
  const axisLenM = axisMax - axisMin;
  const axisLenFt = axisLenM * 3.28084;
  if (axisLenFt < MIN_BUNDLE_LENGTH_FT) return null;

  const bins = Math.min(MAX_BINS, Math.max(MIN_BINS, Math.round(axisLenFt / BIN_TARGET_FT)));
  const buckets = Array.from({ length: bins + 1 }, () => []);
  let evidenceCount = 0;
  rawPoints.forEach(p => {
    const [px, py] = proj.toXY(p.lat, p.lng);
    const t = px * ux + py * uy - axisMin;
    const perp = -px * uy + py * ux;
    if (Math.abs(perp) * 3.28084 > CORRIDOR_FT) return;
    const binIdx = Math.min(bins, Math.max(0, Math.round((t / axisLenM) * bins)));
    buckets[binIdx].push(perp);
    evidenceCount++;
  });
  if (evidenceCount < MIN_BUNDLE_SEGMENTS) return null;

  const points = buckets.map((bucket, i) => {
    const t = axisMin + (i / bins) * axisLenM;
    const avgPerp = bucket.length > 0 ? bucket.reduce((s, v) => s + v, 0) / bucket.length : 0;
    return proj.toLngLat(t * ux - avgPerp * uy, t * uy + avgPerp * ux);
  });

  return {
    points,
    distinctCalls: new Set(segs.map(s => s.callId)).size,
    segmentCount: segs.length
  };
}

// Orchestrator: every real corridor crews have walked, most-traveled first.
export function discoverCorridors(cleanedByCall) {
  const bundles = clusterMicroSegments(buildMicroSegments(cleanedByCall));

  const results = [];
  bundles.forEach(bundle => {
    const distinctCalls = new Set(bundle.segments.map(s => s.callId)).size;
    if (bundle.segments.length < MIN_BUNDLE_SEGMENTS || distinctCalls < MIN_BUNDLE_CALLS) return;
    const centerline = computeBundleCenterline(bundle);
    if (centerline) results.push(centerline);
  });

  return results.sort((p, q) => q.distinctCalls - p.distinctCalls || q.segmentCount - p.segmentCount);
}
