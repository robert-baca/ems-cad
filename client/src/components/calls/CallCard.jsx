import { memo } from 'react';
import { STATUS_COLORS, STATUS_LABELS } from '../../data/mockData';

const PRIORITY_LABELS = { 1: 'P1 · High Acuity', 2: 'P2 · Medium Acuity', 3: 'P3 · Low Acuity' };
const PRIORITY_COLORS = { 1: 'bg-red-500', 2: 'bg-orange-500', 3: 'bg-blue-500' };
const RESPONSE_ICONS  = { foot: '🚶', cart: '🛺' };

function elapsedMin(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}

function CallCard({ call, unit, isSelected, onClick }) {
  const elapsed     = elapsedMin(call.received_at);
  const statusColor = STATUS_COLORS[call.status] || '#9ca3af';
  const isPending   = call.status === 'pending';
  const isStale     = isPending && elapsed !== null && elapsed >= 5;
  const extraUnits  = (call.additional_unit_ids || []).length;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-xl p-3 mb-2 transition-all border
        ${isSelected
          ? 'bg-gray-700 border-blue-500'
          : isStale
            ? 'bg-red-950/40 border-red-500 animate-pulse'
            : 'bg-gray-750 border-gray-600 hover:bg-gray-700 hover:border-gray-500'
        }`}
      style={{ borderLeftWidth: 4, borderLeftColor: isStale ? '#ef4444' : statusColor }}
    >
      {/* Top row */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-white font-bold text-sm">Case #{call.call_number}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium text-white ${PRIORITY_COLORS[call.priority]}`}>
            {PRIORITY_LABELS[call.priority]}
          </span>
          {call.response_mode && RESPONSE_ICONS[call.response_mode] && (
            <span title={call.response_mode === 'cart' ? 'Taking a cart' : 'On foot'}>
              {RESPONSE_ICONS[call.response_mode]}
            </span>
          )}
        </div>
        {elapsed !== null && (
          <span className={`text-xs ${isStale ? 'text-red-400 font-bold' : 'text-gray-400'}`}>
            {elapsed}m {isStale ? '⚠' : 'ago'}
          </span>
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
        <span className="text-xs font-medium" style={{ color: isStale ? '#ef4444' : statusColor }}>
          ● {isStale ? 'UNASSIGNED — NO UNIT' : STATUS_LABELS[call.status]}
        </span>
        <div className="flex items-center gap-1.5">
          {extraUnits > 0 && (
            <span className="text-gray-400 text-xs bg-gray-600 px-1.5 py-0.5 rounded">
              +{extraUnits}
            </span>
          )}
          {unit && (
            <span className="text-gray-400 text-xs bg-gray-600 px-2 py-0.5 rounded">
              {unit.unit_number}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

export default memo(CallCard, (prev, next) =>
  prev.call === next.call &&
  prev.unit === next.unit &&
  prev.isSelected === next.isSelected
);
