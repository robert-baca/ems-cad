// How far off a basemap path line a clicked/suggested point can be and still
// snap to it — real walkway geometry, not noisy GPS, so kept tight relative
// to pathSuggest.js's CORRIDOR_FT (60ft, tuned for GPS noise instead).
const QUERY_PX_RADIUS      = 24;  // screen-px box queried around a point
const MAX_SNAP_DIST_FT     = 40;
const MIN_BASEMAP_COVERAGE = 0.6; // fraction of points that must basemap-snap before skipping Map Matching
const MAP_MATCH_MIN_CONF   = 0.3;

// Mapbox Streets v8 exposes path-like ways via `class`/`type` properties
// (e.g. class: 'path', type: 'footway') under the 'road' source-layer, but
// exact values aren't discoverable from this repo — they live in the hosted
// style. Matched permissively so a naming difference degrades to "no match"
// (falls through to raw behavior) rather than crashing.
const PATHLIKE_RE = /path|pedestrian|footway|sidewalk|steps|track|walk/i;

function toRad(d) { return d * Math.PI / 180; }
function ftFromMeters(m) { return m * 3.28084; }

// Local flat-earth projection centered on the point being snapped — same
// equirectangular approach as pathSuggest.js's toXY, just re-centered per
// call since candidate lines are only ever a few meters away.
function makeProjector(originLat, originLng) {
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos(toRad(originLat));
  return {
    toXY(lat, lng) { return [(lng - originLng) * mPerDegLng, (lat - originLat) * mPerDegLat]; },
    toLngLat(x, y) { return [originLng + x / mPerDegLng, originLat + y / mPerDegLat]; }
  };
}

// Nearest point on segment [a,b] to the origin (0,0), in local XY meters.
function nearestOnSegmentFromOrigin(ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  let t = lenSq > 0 ? -(ax * abx + ay * aby) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const x = ax + t * abx, y = ay + t * aby;
  return { x, y, distSq: x * x + y * y };
}

function lineStringsOf(feature) {
  const g = feature.geometry;
  if (!g) return [];
  if (g.type === 'LineString') return [g.coordinates];
  if (g.type === 'MultiLineString') return g.coordinates;
  return [];
}

function isPathLike(feature) {
  const props = feature.properties || {};
  return PATHLIKE_RE.test(`${props.class ?? ''} ${props.type ?? ''}`);
}

// Snaps a single [lng,lat] point to the nearest basemap road/path line
// currently rendered within QUERY_PX_RADIUS screen pixels. Synchronous and
// cheap (no network) — safe to call per-click while hand-drawing. Returns
// the original point unchanged, with snapped:false, if nothing suitable is
// within MAX_SNAP_DIST_FT.
export function snapPointToBasemap(map, lngLat) {
  if (!map) return { point: lngLat, snapped: false };
  const [lng, lat] = lngLat;

  let px, feats;
  try {
    px = map.project(lngLat);
    feats = map.queryRenderedFeatures([
      [px.x - QUERY_PX_RADIUS, px.y - QUERY_PX_RADIUS],
      [px.x + QUERY_PX_RADIUS, px.y + QUERY_PX_RADIUS]
    ]);
  } catch {
    return { point: lngLat, snapped: false };
  }

  let candidates = feats.filter(f => lineStringsOf(f).length > 0 && isPathLike(f));
  if (candidates.length === 0) {
    // Permissive fallback in case class/type values don't match PATHLIKE_RE —
    // any rendered line in the 'road' source-layer is a reasonable guess.
    candidates = feats.filter(f => lineStringsOf(f).length > 0 && f.sourceLayer === 'road');
  }
  if (candidates.length === 0) return { point: lngLat, snapped: false };

  const proj = makeProjector(lat, lng);
  let best = null;
  candidates.forEach(f => {
    lineStringsOf(f).forEach(coords => {
      for (let i = 0; i < coords.length - 1; i++) {
        const [aLng, aLat] = coords[i];
        const [bLng, bLat] = coords[i + 1];
        const [ax, ay] = proj.toXY(aLat, aLng);
        const [bx, by] = proj.toXY(bLat, bLng);
        const result = nearestOnSegmentFromOrigin(ax, ay, bx, by);
        if (!best || result.distSq < best.distSq) best = result;
      }
    });
  });

  if (!best || ftFromMeters(Math.sqrt(best.distSq)) > MAX_SNAP_DIST_FT) {
    return { point: lngLat, snapped: false };
  }
  return { point: proj.toLngLat(best.x, best.y), snapped: true };
}

// Batch form used by "Suggest From Data" — snaps every point independently.
export function snapPointsToBasemap(map, points) {
  const results = points.map(p => snapPointToBasemap(map, p));
  const coverage = results.length > 0 ? results.filter(r => r.snapped).length / results.length : 0;
  return { points: results.map(r => r.point), flags: results.map(r => r.snapped), coverage };
}

// Mapbox Map Matching API fallback — for when the basemap has no rendered
// path data nearby (e.g. an internal park walkway not in Mapbox's road
// tileset may still be findable via routing, or may not — this is a
// best-effort second try, not guaranteed). Returns null on any failure or a
// low-confidence match, so callers can fall through to raw points.
export async function matchPathViaMapboxAPI(points, accessToken) {
  if (!accessToken || points.length < 2) return null;
  const coordStr = points.map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(';');
  const url = `https://api.mapbox.com/matching/v5/mapbox/walking/${coordStr}` +
    `?geometries=geojson&overview=full&access_token=${accessToken}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const match = data?.matchings?.[0];
    if (!match || (match.confidence ?? 0) < MAP_MATCH_MIN_CONF) return null;
    const coords = match.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return null;
    return { points: coords, confidence: match.confidence };
  } catch {
    return null;
  }
}

// Orchestrator for "Suggest From Data": basemap-snap first; if enough of the
// path found real walkway geometry, use that. Otherwise try Map Matching on
// the original suggested points. Otherwise fall back to the untouched
// suggestion (pathSuggest.js's GPS-average behavior), unchanged.
export async function snapSuggestedPath(map, points, accessToken) {
  const basemap = snapPointsToBasemap(map, points);
  if (basemap.coverage >= MIN_BASEMAP_COVERAGE) {
    return { points: basemap.points, flags: basemap.flags, source: 'basemap' };
  }

  const matched = await matchPathViaMapboxAPI(points, accessToken);
  if (matched) {
    return { points: matched.points, flags: matched.points.map(() => true), source: 'mapmatch' };
  }

  return { points, flags: points.map(() => false), source: 'raw' };
}
