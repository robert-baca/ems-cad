import CrewMap from './CrewMap';
import { STATUS_COLORS, STATUS_LABELS } from '../../data/mockData';

const PRIORITY_LABELS = { 1: 'P1 — High Acuity', 2: 'P2 — Medium Acuity', 3: 'P3 — Low Acuity' };

function formatTime(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

export default function ActiveCall({ call, myUnit, units = [], backupRequested, onRequestBackup }) {
  if (!call) {
    return (
      <div className="bg-gray-800 rounded-2xl p-6 text-center border border-gray-700">
        <div className="text-4xl mb-2">✅</div>
        <div className="text-gray-300 font-semibold">No Active Call</div>
        <div className="text-gray-500 text-sm mt-1">Standing by</div>
      </div>
    );
  }

  // Other units on same call (exclude self)
  const partnerIds = [
    ...(call.additional_unit_ids || []),
    ...(call.assigned_unit_id && myUnit && call.assigned_unit_id !== myUnit.id ? [call.assigned_unit_id] : [])
  ];
  const partners = partnerIds
    .map(id => units.find(u => u.id === id))
    .filter(Boolean);

  // Last 3 comments, newest first
  const recentComments = [...(call.comments || [])].reverse().slice(0, 3);

  const hasLocation = call.location_lat && call.location_lng;

  return (
    <div className="bg-gray-800 rounded-2xl overflow-hidden border border-gray-700">
      {/* Priority header */}
      <div className={`px-4 py-2.5 text-sm font-bold
        ${call.priority === 1 ? 'bg-red-600' : call.priority === 2 ? 'bg-orange-600' : 'bg-blue-700'}`}>
        🚨 ACTIVE CALL #{call.call_number} · {PRIORITY_LABELS[call.priority]}
      </div>

      <div className="p-4 space-y-4">

        {/* Call type + location */}
        <div>
          <div className="text-white font-bold text-xl leading-tight">{call.call_type}</div>
          <div className="text-gray-400 text-sm mt-0.5">
            {call.park_zone && <span className="text-blue-400 font-medium">{call.park_zone} · </span>}
            {call.location_name}
          </div>
        </div>

        {/* In-park mini map */}
        {hasLocation && (
          <CrewMap call={call} myUnit={myUnit} />
        )}

        {/* Chief complaint */}
        {call.chief_complaint && (
          <div className="bg-gray-750 rounded-xl border border-gray-600 px-3 py-2.5">
            <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">Chief Complaint</div>
            <div className="text-gray-100 text-sm leading-relaxed">{call.chief_complaint}</div>
          </div>
        )}

        {/* Dispatch notes */}
        {call.notes && (
          <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-xl px-3 py-2.5">
            <div className="text-yellow-400 text-xs font-semibold mb-1">DISPATCH NOTES</div>
            <div className="text-yellow-200 text-sm leading-relaxed">{call.notes}</div>
          </div>
        )}

        {/* Call partners */}
        {partners.length > 0 && (
          <div>
            <div className="text-gray-400 text-xs uppercase tracking-wider mb-2">Also on this call</div>
            <div className="flex flex-wrap gap-2">
              {partners.map(u => (
                <div key={u.id}
                  className="flex items-center gap-1.5 bg-gray-700 rounded-full px-3 py-1.5">
                  <div className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: STATUS_COLORS[u.status] || '#9ca3af' }} />
                  <span className="text-white text-xs font-bold">{u.unit_number}</span>
                  <span className="text-gray-400 text-xs">{STATUS_LABELS[u.status] || u.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Request Backup button */}
        <button
          onClick={onRequestBackup}
          className={`w-full py-4 rounded-xl font-bold text-base transition-all active:scale-95
            ${backupRequested
              ? 'bg-green-800 border border-green-600 text-green-300'
              : 'bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-900/40'
            }`}
        >
          {backupRequested ? '✓ Backup Requested — Tap to Cancel' : '🆘 Request Backup'}
        </button>

        {/* Recent comments from dispatch */}
        {recentComments.length > 0 && (
          <div>
            <div className="text-gray-400 text-xs uppercase tracking-wider mb-2">Dispatch Updates</div>
            <div className="space-y-2">
              {recentComments.map(c => (
                <div key={c.id} className="bg-gray-750 rounded-lg border border-gray-600 px-3 py-2">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-semibold text-gray-300">{c.author}</span>
                    <span className="text-xs text-gray-500">{formatTime(c.created_at)}</span>
                  </div>
                  <div className="text-sm text-gray-200 leading-snug">{c.text}</div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
