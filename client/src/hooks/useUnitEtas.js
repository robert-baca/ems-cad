import { useEffect, useMemo, useState } from 'react';
import { getParkPaths } from '../services/api';
import { buildEtaGraph, estimateUnits, sortByEta } from '../lib/unitEta';

// Walkway graph, built once per page load and shared by every picker.
let graphPromise = null;
function loadGraph() {
  if (!graphPromise) {
    graphPromise = getParkPaths()
      .then(res => buildEtaGraph(res.data))
      .catch(() => { graphPromise = null; return null; });
  }
  return graphPromise;
}

// Estimated travel time from each unit to `target` ({lat,lng}), plus the
// units sorted closest-first. Units' GPS updates arrive about once a second,
// so estimates are only recomputed when some unit moves ~10 m, its status or
// type changes, or every 15s (to keep "GPS age" honest) -- not on every ping.
export function useUnitEtas(units, target) {
  const [graph, setGraph] = useState(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    loadGraph().then(g => { if (live) setGraph(g); });
    const t = setInterval(() => setTick(n => n + 1), 15000);
    return () => { live = false; clearInterval(t); };
  }, []);

  const positionKey = units
    .map(u => `${u.id}:${u.last_lat?.toFixed(4)}:${u.last_lng?.toFixed(4)}:${u.unit_type}:${u.last_gps_at ? 1 : 0}`)
    .join('|');

  const estimates = useMemo(
    () => estimateUnits(units, target, graph),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [positionKey, target?.lat, target?.lng, graph, tick]
  );

  const sorted = useMemo(() => sortByEta(units, estimates), [units, estimates]);
  return { estimates, sorted, hasTarget: !!(target && target.lat != null && target.lng != null) };
}
