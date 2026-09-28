import { useState } from 'react';

function fmtTime(iso) {
  return iso ? new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
}

// Dispatcher view of one open panic-button emergency. Acknowledge stops the
// siren and tells the medic help is coming; Resolve closes it and needs a
// short note (it's the permanent record).
export default function EmergencyBanner({ emergency: e, unit, canAct, onAck, onResolve, onLocate }) {
  const [resolving, setResolving] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (fn) => {
    setBusy(true); setError('');
    const err = await fn();
    setBusy(false);
    if (err) setError(err);
    return !err;
  };

  const gpsAgeS = unit?.last_gps_at ? Math.round((Date.now() - new Date(unit.last_gps_at).getTime()) / 1000) : null;

  return (
    <div className={`px-4 py-3 border-b-4 border-red-300 flex-shrink-0 ${e.acknowledged_at ? 'bg-red-800' : 'bg-red-600 animate-pulse'}`}>
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-3xl flex-shrink-0">🚨</span>
        <div className="flex-1 min-w-0">
          <div className="text-white font-black text-base tracking-wide">
            CREW EMERGENCY — {e.unit_number}{e.crew_name ? ` (${e.crew_name})` : ''}
          </div>
          <div className="text-red-100 text-xs">
            Pressed at {fmtTime(e.started_at)}
            {e.acknowledged_at && ` · acknowledged ${fmtTime(e.acknowledged_at)} by ${e.acknowledged_by || 'dispatch'}`}
            {gpsAgeS != null && ` · position ${gpsAgeS < 60 ? `${gpsAgeS}s` : `${Math.round(gpsAgeS / 60)} min`} old`}
          </div>
        </div>
        <button onClick={onLocate}
          className="flex-shrink-0 px-3 py-1.5 bg-white/90 text-red-800 font-bold text-xs rounded-lg hover:bg-white">
          📍 Show on map
        </button>
        {canAct && !e.acknowledged_at && (
          <button onClick={() => run(onAck)} disabled={busy}
            className="flex-shrink-0 px-4 py-1.5 bg-white text-red-700 font-black text-sm rounded-lg hover:bg-red-50 disabled:opacity-60">
            ACKNOWLEDGE
          </button>
        )}
        {canAct && !resolving && (
          <button onClick={() => setResolving(true)}
            className="flex-shrink-0 px-3 py-1.5 bg-red-950/60 border border-red-200 text-white font-bold text-xs rounded-lg hover:bg-red-950">
            Resolve…
          </button>
        )}
      </div>
      {resolving && (
        <div className="mt-2 flex gap-2">
          <input autoFocus value={note} onChange={ev => setNote(ev.target.value)}
            onKeyDown={ev => ev.key === 'Enter' && note.trim() && run(() => onResolve(note.trim()))}
            placeholder="How was it resolved? (required)"
            className="flex-1 bg-red-950/70 text-white rounded-lg px-3 py-1.5 text-sm outline-none placeholder-red-300/60 focus:ring-2 focus:ring-white" />
          <button onClick={() => run(() => onResolve(note.trim()))} disabled={!note.trim() || busy}
            className="px-3 py-1.5 bg-white text-red-800 font-bold text-xs rounded-lg disabled:opacity-50">
            Resolve
          </button>
          <button onClick={() => { setResolving(false); setNote(''); }}
            className="px-2 text-red-100 text-xs">Cancel</button>
        </div>
      )}
      {error && <div className="mt-1 text-white text-xs font-semibold">⚠ {error}</div>}
    </div>
  );
}
