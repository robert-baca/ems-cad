import { getBearing, getDistanceFt } from './geo';

// Turn-by-turn for the crew map's navigation view, worked out from the
// walking route's own geometry (walkways have no names, so it's "turn
// left in 80 ft", not "turn left onto X").

// Direction changes smaller than this are just the walkway curving.
const TURN_MIN_DEG = 35;
// Short wiggles in hand-traced paths shouldn't read as turns: a vertex's
// turn angle is measured between points at least this far either side.
const LOOK_FT = 20;
// Within this of the pin, you've arrived (GPS in the park is ~5-15 m).
export const ARRIVE_FT = 40;

function turnDelta(inBearing, outBearing) {
  let d = outBearing - inBearing;
  while (d > 180) d -= 360;
  while (d <= -180) d += 360;
  return d; // + right, - left
}

function describe(delta) {
  const a = Math.abs(delta);
  const side = delta > 0 ? 'right' : 'left';
  if (a >= 135) return { kind: `sharp-${side}`, text: `Sharp ${side}`, arrow: delta > 0 ? '↱' : '↰' };
  if (a >= 60) return { kind: side, text: `Turn ${side}`, arrow: delta > 0 ? '↱' : '↰' };
  return { kind: `slight-${side}`, text: `Bear ${side}`, arrow: delta > 0 ? '↗' : '↖' };
}

// points: route [[lng,lat],...] starting at (or near) the medic. pos: {lat,lng}.
// Returns { arrived, remainingFt, next: { text, arrow, distFt } | null }.
export function nextManeuver(points, pos) {
  if (!points || points.length < 2 || !pos) return null;
  const pts = points.map(([lng, lat]) => ({ lat, lng }));

  // Where along the route is the medic? Nearest vertex is plenty at walking
  // scale -- vertices are a few metres apart once the route is noded.
  let at = 0, best = Infinity;
  pts.forEach((p, i) => {
    const d = getDistanceFt(pos.lat, pos.lng, p.lat, p.lng);
    if (d < best) { best = d; at = i; }
  });

  // Cumulative distance from the medic along the route to each vertex ahead.
  const along = new Array(pts.length).fill(0);
  along[at] = best;
  for (let i = at + 1; i < pts.length; i++) {
    along[i] = along[i - 1] + getDistanceFt(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng);
  }
  const remainingFt = Math.round(along[pts.length - 1]);
  if (remainingFt <= ARRIVE_FT) return { arrived: true, remainingFt, next: null };

  // Point roughly `ft` behind/ahead of vertex i along the route.
  const walk = (i, dir, ft) => {
    let acc = 0, j = i;
    while (j + dir >= 0 && j + dir < pts.length) {
      acc += getDistanceFt(pts[j].lat, pts[j].lng, pts[j + dir].lat, pts[j + dir].lng);
      j += dir;
      if (acc >= ft) break;
    }
    return pts[j];
  };

  for (let i = Math.max(at, 1); i < pts.length - 1; i++) {
    const before = walk(i, -1, LOOK_FT), after = walk(i, +1, LOOK_FT);
    if (before === pts[i] || after === pts[i]) continue;
    const delta = turnDelta(
      getBearing(before.lat, before.lng, pts[i].lat, pts[i].lng),
      getBearing(pts[i].lat, pts[i].lng, after.lat, after.lng)
    );
    if (Math.abs(delta) >= TURN_MIN_DEG) {
      // The same bend is seen from several neighbouring vertices; use the
      // sharpest one within the next LOOK_FT -- that's the actual corner, so
      // both the arrow and the distance match the turn.
      let bestDelta = delta, bestAt = i;
      for (let k = i + 1; k < pts.length - 1 && along[k] - along[i] <= LOOK_FT; k++) {
        const b = walk(k, -1, LOOK_FT), a = walk(k, +1, LOOK_FT);
        if (b === pts[k] || a === pts[k]) continue;
        const d = turnDelta(getBearing(b.lat, b.lng, pts[k].lat, pts[k].lng), getBearing(pts[k].lat, pts[k].lng, a.lat, a.lng));
        if (Math.abs(d) > Math.abs(bestDelta)) { bestDelta = d; bestAt = k; }
      }
      return { arrived: false, remainingFt, next: { ...describe(bestDelta), distFt: Math.round(along[bestAt]) } };
    }
  }
  return { arrived: false, remainingFt, next: { text: 'Continue to the pin', arrow: '↑', distFt: remainingFt } };
}

// Initial heading along the route from `pos` -- used for the camera before
// the compass or GPS course has a reading.
export function routeHeading(points, pos) {
  if (!points || points.length < 2 || !pos) return null;
  for (const [lng, lat] of points) {
    if (getDistanceFt(pos.lat, pos.lng, lat, lng) >= 15) return getBearing(pos.lat, pos.lng, lat, lng);
  }
  const [lng, lat] = points[points.length - 1];
  return getBearing(pos.lat, pos.lng, lat, lng);
}
