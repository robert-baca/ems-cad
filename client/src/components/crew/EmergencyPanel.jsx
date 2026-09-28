import HoldButton from './HoldButton';
import { getDistanceFt } from '../../lib/geo';

function fmtTime(iso) {
  return iso ? new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '';
}

// Crew panic button + any colleague's open emergency.
//  - idle:     "hold 2s for emergency"
//  - queued:   pressed with no signal -- NOT sent yet, retrying, use the radio
//  - active:   sent; shows whether dispatch has acknowledged; hold to cancel
//  - others:   a colleague's emergency, with distance and a Find button
export default function EmergencyPanel({ myUnit, units, myEmergency, queued, otherEmergencies, onTrigger, onCancel, onFind, busy, error }) {
  const others = otherEmergencies.map(e => {
    const u = units.find(x => x.id === e.unit_id);
    const lat = u?.last_lat ?? e.lat, lng = u?.last_lng ?? e.lng;
    const distM = lat != null && myUnit?.last_lat != null
      ? Math.round(getDistanceFt(myUnit.last_lat, myUnit.last_lng, lat, lng) / 3.28084)
      : null;
    return { e, distM };
  });

  return (
    <div className="space-y-2">
      {others.map(({ e, distM }) => (
        <div key={e.id} className="rounded-2xl bg-red-700 border-2 border-red-400 px-4 py-3 flex items-center gap-3 animate-pulse">
          <span className="text-2xl">🚨</span>
          <div className="flex-1 min-w-0">
            <div className="text-white font-black text-sm">{e.unit_number}{e.crew_name ? ` (${e.crew_name})` : ''} EMERGENCY</div>
            <div className="text-red-100 text-xs">
              {distM != null ? `~${distM} m from you · ` : ''}
              {e.acknowledged_at ? 'Dispatch is handling it' : 'Waiting for dispatch'}
            </div>
          </div>
          <button onClick={() => onFind(e.unit_id)}
            className="flex-shrink-0 px-3 py-2 rounded-xl bg-white text-red-700 font-black text-sm">
            🧭 Find
          </button>
        </div>
      ))}

      {myEmergency ? (
        <div className="rounded-2xl bg-red-800 border-2 border-red-400 px-4 py-3 space-y-2">
          <div className="text-white font-black text-base">🚨 EMERGENCY ACTIVE</div>
          <div className="text-red-100 text-sm">
            {myEmergency.acknowledged_at
              ? `✅ Dispatch acknowledged at ${fmtTime(myEmergency.acknowledged_at)} — help is on the way`
              : 'Dispatch and the nearest crews have been alerted. Waiting for dispatch…'}
          </div>
          <div className="text-red-200/80 text-xs">📍 Your location is being shared until this is resolved, even if you turned sharing off.</div>
          <HoldButton onHold={onCancel} disabled={busy}
            className="w-full py-3 rounded-xl bg-gray-900/60 border border-red-300 text-white text-sm font-bold"
            fillClassName="bg-green-600">
            {busy ? 'Cancelling…' : "Hold 2s — I'm OK, cancel"}
          </HoldButton>
        </div>
      ) : queued ? (
        <div className="rounded-2xl bg-amber-900/80 border-2 border-amber-400 px-4 py-3 text-center">
          <div className="text-amber-100 font-black text-sm">⚠ EMERGENCY NOT SENT YET — NO SIGNAL</div>
          <div className="text-amber-200 text-xs mt-0.5">Retrying every few seconds. USE YOUR RADIO NOW.</div>
        </div>
      ) : (
        <HoldButton onHold={onTrigger} disabled={busy}
          className="w-full py-3.5 rounded-2xl bg-red-950 border-2 border-red-700 text-red-200 text-sm font-black tracking-wide"
          fillClassName="bg-red-600">
          {busy ? 'Sending…' : '🚨 HOLD 2s FOR EMERGENCY'}
        </HoldButton>
      )}
      {error && <div className="text-red-400 text-xs text-center font-medium">{error}</div>}
    </div>
  );
}
