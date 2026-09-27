import { useState, useEffect } from 'react';
import CrewMap from './CrewMap';
import { getDistanceFt } from '../../lib/geo';

function fmtDist(ft) {
  if (ft == null) return '';
  return ft < 1000 ? `${ft} ft` : `${(ft / 5280).toFixed(2)} mi`;
}

// Wayfinder without a call: pick a saved location (ride, station…) and the
// map routes this medic there along the published walking paths — the same
// routing the call map uses, just aimed at a chosen spot instead of a call.
// backRef lets the native back button step map -> list first.
export default function CrewNavigate({ myUnit, locations, onClose, backRef }) {
  const [query, setQuery] = useState('');
  const [dest, setDest] = useState(null);

  useEffect(() => {
    if (!backRef) return;
    backRef.current = () => {
      if (dest) { setDest(null); return true; }
      return false;
    };
    return () => { backRef.current = null; };
  }, [backRef, dest]);

  if (dest) {
    return (
      <CrewMap
        call={{ id: `nav-${dest.id}`, location_lat: dest.lat, location_lng: dest.lng, priority: 3, location_name: dest.name }}
        myUnit={myUnit}
        locations={locations}
        title={dest.name}
        onExit={() => setDest(null)}
      />
    );
  }

  const hasMe = myUnit?.last_lat && myUnit?.last_lng;
  const q = query.trim().toLowerCase();
  const rows = locations
    .filter(l => !q || l.name.toLowerCase().includes(q))
    .map(l => ({ l, dist: hasMe ? getDistanceFt(parseFloat(myUnit.last_lat), parseFloat(myUnit.last_lng), l.lat, l.lng) : null }))
    .sort((a, b) => (a.dist ?? Infinity) - (b.dist ?? Infinity) || a.l.name.localeCompare(b.l.name));

  return (
    <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col">
      <div className="flex items-center justify-between px-4 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-4 border-b border-gray-800">
        <button onClick={onClose} className="text-gray-400 hover:text-white p-2 -ml-2">← Back</button>
        <div className="text-white font-bold">Navigate to…</div>
        <div className="w-12" />
      </div>
      <div className="p-4 pb-2">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search rides and places"
          autoComplete="off"
          className="w-full bg-gray-800 text-white rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
        />
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
        {locations.length === 0 && (
          <div className="text-center text-gray-500 text-sm py-10">
            No saved locations yet — dispatch adds them from the map.
          </div>
        )}
        {locations.length > 0 && rows.length === 0 && (
          <div className="text-center text-gray-500 text-sm py-10">No match for “{query}”.</div>
        )}
        {rows.map(({ l, dist }) => (
          <button key={l.id} onClick={() => setDest(l)}
            className="w-full flex items-center gap-3 bg-gray-800 border border-gray-700 hover:border-blue-600 rounded-2xl px-4 py-3.5 text-left">
            <span className="text-lg">📌</span>
            <span className="flex-1 text-white font-semibold">{l.name}</span>
            {dist != null && <span className="text-gray-400 text-xs">{fmtDist(dist)}</span>}
            <span className="text-gray-600 text-xl">›</span>
          </button>
        ))}
      </div>
    </div>
  );
}
