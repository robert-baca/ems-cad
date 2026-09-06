import { isPathLike, lineStringsOf } from './snapToPath';

// Pulls every path-like line currently rendered on the map (walkways,
// footways, sidewalks — whatever Mapbox's basemap already has mapped for
// this area) as candidate lines. This is verified existing map data, not a
// GPS-derived guess, so callers don't need an evidence check before
// treating it as real — it just still goes through the normal admin
// review/approve queue like every other candidate source.
//
// One physical basemap trail can extract as several shorter fragments,
// since Mapbox vector tiles clip long real-world lines at tile boundaries.
// That's fine, not a bug: routeGraph.js already merges vertices across
// separately-published paths within its own tolerance, so the fragments
// reconnect into one routable corridor regardless of how many separate
// park_paths rows they end up as.
export function extractBasemapPaths(map) {
  if (!map) return [];

  const canvas = map.getCanvas();
  const feats = map.queryRenderedFeatures([[0, 0], [canvas.width, canvas.height]]);

  const lines = [];
  const seen = new Set(); // dedupes exact re-hits of the same tile feature
  feats.forEach(f => {
    if (!isPathLike(f)) return;
    const key = f.id != null ? `${f.sourceLayer || ''}:${f.id}` : null;
    if (key) {
      if (seen.has(key)) return;
      seen.add(key);
    }
    lineStringsOf(f).forEach(coordinates => {
      if (coordinates.length >= 2) lines.push({ points: coordinates, name: f.properties?.name || null });
    });
  });
  return lines;
}
