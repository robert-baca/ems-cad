// Six Flags Over Texas — zone polygons (stub coordinates, drop in real coords later)
export const PARK_ZONES = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'Zone A — Main Gate', color: '#3b82f6' },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-97.0705, 32.7530],
          [-97.0660, 32.7530],
          [-97.0660, 32.7545],
          [-97.0705, 32.7545],
          [-97.0705, 32.7530]
        ]]
      }
    },
    {
      type: 'Feature',
      properties: { name: 'Zone B — Mid Park', color: '#8b5cf6' },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-97.0660, 32.7545],
          [-97.0615, 32.7545],
          [-97.0615, 32.7560],
          [-97.0660, 32.7560],
          [-97.0660, 32.7545]
        ]]
      }
    },
    {
      type: 'Feature',
      properties: { name: 'Zone C — Ride Country', color: '#10b981' },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-97.0705, 32.7545],
          [-97.0660, 32.7545],
          [-97.0660, 32.7562],
          [-97.0705, 32.7562],
          [-97.0705, 32.7545]
        ]]
      }
    },
    {
      type: 'Feature',
      properties: { name: 'Zone D — Back Lot / Waterpark', color: '#f59e0b' },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-97.0660, 32.7560],
          [-97.0615, 32.7560],
          [-97.0615, 32.7575],
          [-97.0660, 32.7575],
          [-97.0660, 32.7560]
        ]]
      }
    },
    {
      type: 'Feature',
      properties: { name: 'Zone E — Parking / Perimeter', color: '#ec4899' },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-97.0720, 32.7525],
          [-97.0600, 32.7525],
          [-97.0600, 32.7530],
          [-97.0720, 32.7530],
          [-97.0720, 32.7525]
        ]]
      }
    }
  ]
};
