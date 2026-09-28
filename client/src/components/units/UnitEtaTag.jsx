import { formatEta } from '../../lib/unitEta';

// Small "~3 min · 240 m" label for unit picker buttons. Stale or missing GPS
// is called out, so a dispatcher doesn't send someone based on where they
// were several minutes ago.
export default function UnitEtaTag({ estimate, closest = false }) {
  if (!estimate) return null;
  if (estimate.noGps) return <span className="block text-[10px] font-normal text-gray-500">no GPS</span>;
  const staleMins = estimate.gpsAgeS != null ? Math.round(estimate.gpsAgeS / 60) : null;
  return (
    <span className={`block text-[10px] font-normal ${estimate.stale ? 'text-amber-400' : closest ? 'text-green-300' : 'text-gray-400'}`}>
      {closest && !estimate.stale && '★ '}
      {formatEta(estimate)}
      {estimate.stale && ` · ⚠ GPS ${staleMins == null ? 'unknown' : `${staleMins} min old`}`}
    </span>
  );
}
