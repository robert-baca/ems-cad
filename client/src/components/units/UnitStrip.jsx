import UnitBadge from './UnitBadge';
import { STATUS_COLORS } from '../../data/mockData';

export default function UnitStrip({ units, selectedUnitId, onSelectUnit }) {
  const available = units.filter(u => u.status === 'available').length;
  const active = units.filter(u =>
    ['dispatched', 'en_route', 'on_scene', 'patient_contact'].includes(u.status)
  ).length;

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-gray-800 border-t border-gray-700 min-h-[52px]">
      {/* Summary counts */}
      <div className="flex-shrink-0 flex gap-3 text-xs pr-3 border-r border-gray-700">
        <span className="text-green-400 font-medium">{available} avail</span>
        <span className="text-orange-400 font-medium">{active} active</span>
        <span className="text-gray-500">{units.length} total</span>
      </div>

      {/* Scrollable badges */}
      <div className="flex gap-2 overflow-x-auto unit-strip-scroll pb-0.5 flex-1">
        {units.map(unit => (
          <UnitBadge
            key={unit.id}
            unit={unit}
            isSelected={unit.id === selectedUnitId}
            onClick={() => onSelectUnit?.(unit.id === selectedUnitId ? null : unit.id)}
          />
        ))}
      </div>
    </div>
  );
}
