import { STATUS_COLORS, STATUS_LABELS } from '../../data/mockData';

const PRIORITY_LABELS = { 1: 'P1 · Critical', 2: 'P2 · Urgent', 3: 'P3 · Routine' };
const PRIORITY_COLORS = { 1: 'bg-red-500', 2: 'bg-orange-500', 3: 'bg-blue-500' };

function elapsedMin(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}

export default function CallCard({ call, unit, isSelected, onClick }) {
  const elapsed = elapsedMin(call.received_at);
  const statusColor = STATUS_COLORS[call.status] || '#9ca3af';

  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-xl p-3 mb-2 transition-all border
        ${isSelected
          ? 'bg-gray-700 border-blue-500'
          : 'bg-gray-750 border-gray-600 hover:bg-gray-700 hover:border-gray-500'
        }`}
      style={{ borderLeftWidth: 4, borderLeftColor: statusColor }}
    >
      {/* Top row */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="text-white font-bold text-sm">Case #{call.call_number}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium text-white ${PRIORITY_COLORS[call.priority]}`}>
            {PRIORITY_LABELS[call.priority]}
          </span>
        </div>
        {elapsed !== null && (
          <span className="text-gray-400 text-xs">{elapsed}m ago</span>
        )}
      </div>

      {/* Call type */}
      <div className="text-white font-semibold text-sm leading-tight mb-1">{call.call_type}</div>

      {/* Location */}
      <div className="text-gray-400 text-xs mb-2">
        {call.park_zone && <span className="text-blue-400 font-medium">{call.park_zone} · </span>}
        {call.location_name}
      </div>

      {/* Bottom row */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium" style={{ color: statusColor }}>
          ● {STATUS_LABELS[call.status]}
        </span>
        {unit && (
          <span className="text-gray-400 text-xs bg-gray-600 px-2 py-0.5 rounded">
            {unit.unit_number}
          </span>
        )}
      </div>
    </button>
  );
}
