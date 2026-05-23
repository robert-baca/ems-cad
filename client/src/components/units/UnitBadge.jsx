import { STATUS_COLORS, STATUS_LABELS } from '../../data/mockData';

const TYPE_ICONS = { ALS: '🚑', BLS: '🚐', Bike: '🚲', Cart: '🛺' };

export default function UnitBadge({ unit, isSelected, onClick }) {
  const color = STATUS_COLORS[unit.status] || '#9ca3af';

  return (
    <button
      onClick={onClick}
      className={`flex-shrink-0 flex items-center gap-2.5 px-3 py-2 rounded-xl border transition-all
        ${isSelected
          ? 'bg-gray-600 border-blue-400'
          : 'bg-gray-700 border-gray-600 hover:bg-gray-650 hover:border-gray-500'
        }`}
    >
      {/* Status dot */}
      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />

      {/* Icon + number */}
      <div className="flex items-center gap-1">
        <span className="text-sm">{TYPE_ICONS[unit.unit_type] || '🚑'}</span>
        <span className="text-white font-bold text-sm">{unit.unit_number}</span>
      </div>

      {/* Status label */}
      <span className="text-xs" style={{ color }}>
        {STATUS_LABELS[unit.status]}
      </span>
    </button>
  );
}
