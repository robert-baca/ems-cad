import CrewMap from './CrewMap';
import { STATUS_COLORS, STATUS_LABELS } from '../../data/mockData';

const PRIORITY_LABELS = { 1: 'P1 — High Acuity', 2: 'P2 — Medium Acuity', 3: 'P3 — Low Acuity' };


export default function ActiveCall({ call, myUnit, units = [], isCompleted = false, onDismiss }) {
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

  const hasLocation = call.location_lat && call.location_lng;

  return (
    <div className="bg-gray-800 rounded-2xl overflow-hidden border border-gray-700">
      {/* Header */}
      <div className={`px-4 py-2.5 text-sm font-bold flex items-center justify-between
        ${isCompleted ? 'bg-gray-700' : call.priority === 1 ? 'bg-red-600' : call.priority === 2 ? 'bg-orange-600' : 'bg-blue-700'}`}>
        <span>{isCompleted ? '✅ CALL CLEARED' : '🚨 ACTIVE CALL'} #{call.call_number}{!isCompleted && ` · ${PRIORITY_LABELS[call.priority]}`}</span>
        {isCompleted && (
          <button
            onClick={onDismiss}
            className="text-gray-400 hover:text-white text-xs bg-gray-600 hover:bg-gray-500 px-2 py-0.5 rounded transition-colors"
          >
            Dismiss
          </button>
        )}
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


      </div>
    </div>
  );
}
