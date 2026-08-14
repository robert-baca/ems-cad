import { toRad, getDistanceFt } from './geo';

// A single bad GPS fix implying an impossible jump (phone glitch, multipath
// near a building) shouldn't turn into a spike in the trail or feed the
// suggestion algorithm. Walks a call's trace in time order and drops any
// point that would require moving faster than a golf cart could plausibly
// go from the last point that was kept — a generous bound, well above
// walking speed, that only catches genuine teleport-style glitches.
const MAX_PLAUSIBLE_SPEED_MPS = 9; // ~20 mph

export function cleanTrace(pointsSortedByTime) {
  const cleaned = [];
  let prev = null;
  for (const p of pointsSortedByTime) {
    if (prev) {
      const dtSec = (new Date(p.recorded_at) - new Date(prev.recorded_at)) / 1000;
      if (dtSec > 0) {
        const distFt = getDistanceFt(prev.lat, prev.lng, p.lat, p.lng);
        const speedMps = (distFt / 3.28084) / dtSec;
        if (speedMps > MAX_PLAUSIBLE_SPEED_MPS) continue; // drop — keep prev as the anchor
      }
    }
    cleaned.push(p);
    prev = p;
  }
  return cleaned;
}

const CORRIDOR_FT       = 60; // how far off the straight line a trace point can be and still count as evidence
const MIN_EVIDENCE_PTS  = 15; // minimum nearby real GPS points before a suggestion is trusted
const SEGMENTS          = 10; // number of bins along the line

// Projects every cleaned trace point onto the straight line between two
// clicked points, keeps only the ones within CORRIDOR_FT of it, then bends
// the line toward the average real position in each of SEGMENTS bins along
// its length. This is plain geometry (a local flat-earth projection, fine
// at this scale) — not a black box, and it says plainly when there isn't
// enough real data to trust rather than silently returning a straight line.
export function suggestPathFromTraces(start, end, cleanedPoints) {
  const [lng1, lat1] = start;
  const [lng2, lat2] = end;
  const totalDistFt = getDistanceFt(lat1, lng1, lat2, lng2);
  if (totalDistFt < 20) return { points: null, evidenceCount: 0, reason: 'Points are too close together.' };

  const latRad    = toRad((lat1 + lat2) / 2);
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos(latRad);
  const toXY = (lat, lng) => [(lng - lng1) * mPerDegLng, (lat - lat1) * mPerDegLat];

  const [ex, ey] = toXY(lat2, lng2);
  const lineLen  = Math.hypot(ex, ey);
  const ux = ex / lineLen, uy = ey / lineLen;

  const bins = Array.from({ length: SEGMENTS + 1 }, () => []);
  let evidenceCount = 0;

  cleanedPoints.forEach(p => {
    const [px, py] = toXY(p.lat, p.lng);
    const t = px * ux + py * uy;             // distance along the line
    if (t < 0 || t > lineLen) return;
    const perp   = -px * uy + py * ux;        // perpendicular offset from the line
    const perpFt = Math.abs(perp) * 3.28084;
    if (perpFt > CORRIDOR_FT) return;
    const binIdx = Math.min(SEGMENTS, Math.max(0, Math.round((t / lineLen) * SEGMENTS)));
    bins[binIdx].push(perp);
    evidenceCount++;
  });

  if (evidenceCount < MIN_EVIDENCE_PTS) {
    return { points: null, evidenceCount, reason: 'Not enough real GPS data along this line yet — try drawing by hand, or pick two points with more calls between them.' };
  }

  const points = bins.map((bin, i) => {
    const t = (i / SEGMENTS) * lineLen;
    const avgPerp = bin.length > 0 ? bin.reduce((s, v) => s + v, 0) / bin.length : 0;
    const x = t * ux - avgPerp * uy;
    const y = t * uy + avgPerp * ux;
    return [lng1 + x / mPerDegLng, lat1 + y / mPerDegLat];
  });

  return { points, evidenceCount, reason: null };
}
