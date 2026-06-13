import { useState } from 'react';
import { STATUS_COLORS, STATUS_LABELS } from '../../data/mockData';
import EditUnitModal from './EditUnitModal';
import AddUnitModal from './AddUnitModal';

const TYPE_ICONS = { ALS: '🚑', BLS: '🚐', Cart: '🛺', Bike: '🚴' };

const TYPE_ORDER = { ALS: 0, BLS: 1, Cart: 2, Bike: 3 };
const STATUS_PRIORITY = { dispatched: 0, en_route: 0, on_scene: 0, patient_contact: 0, available: 1, cleared: 2, out_of_service: 3 };

function sortUnits(units) {
  return [...units].sort((a, b) => {
    const typeDiff = (TYPE_ORDER[a.unit_type] ?? 9) - (TYPE_ORDER[b.unit_type] ?? 9);
    if (typeDiff !== 0) return typeDiff;
    const statusDiff = (STATUS_PRIORITY[a.status] ?? 2) - (STATUS_PRIORITY[b.status] ?? 2);
    if (statusDiff !== 0) return statusDiff;
    return a.unit_number.localeCompare(b.unit_number, undefined, { numeric: true });
  });
}

const TYPE_BADGE = { ALS: 'bg-red-900/50 text-red-300', BLS: 'bg-blue-900/50 text-blue-300', Cart: 'bg-green-900/50 text-green-300' };

const ON_CALL_STATUSES = new Set(['dispatched', 'en_route', 'on_scene', 'patient_contact']);

function UnitCard({ unit, activeCall, isSelected, onClick, onHistory, onEdit, onToggleOos, onFlyTo, onClearGps }) {
  const color = STATUS_COLORS[unit.status] || '#9ca3af';
  const profile = unit.profile;
  const hasGps = unit.last_lat && unit.last_lng;
  const gpsAgeMin = hasGps && unit.last_gps_at
    ? Math.floor((Date.now() - new Date(unit.last_gps_at)) / 60000)
    : null;
  const gpsStale = gpsAgeMin !== null && gpsAgeMin >= 10;

  return (
    <div
      className={`rounded-xl border mb-1.5 transition-all overflow-hidden group
        ${isSelected
          ? 'bg-gray-700 border-blue-500'
          : 'bg-gray-750 border-gray-600 hover:bg-gray-700 hover:border-gray-500'
        }`}
      style={{ borderLeftWidth: 3, borderLeftColor: color }}
    >
      <div className="relative">
        <button onClick={onClick} className="w-full text-left px-3 pt-2.5 pb-1.5 pr-8">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm">{TYPE_ICONS[unit.unit_type] || '🚑'}</span>
            <span className="text-white font-bold text-sm">{unit.unit_number}</span>
            <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${TYPE_BADGE[unit.unit_type] || 'bg-gray-700 text-gray-400'}`}>
              {unit.unit_type}
            </span>
          </div>
          <div className="text-xs font-medium" style={{ color }}>
            {STATUS_LABELS[unit.status]}
          </div>
          {activeCall && (
            <div className="text-yellow-300 text-xs font-semibold mt-0.5 truncate">
              Case #{activeCall.call_number} · {activeCall.call_type}
            </div>
          )}
          {unit.crew || profile?.name ? (
            <div className="text-gray-400 text-xs mt-0.5 truncate">{unit.crew || profile?.name}</div>
          ) : (
            unit.unit_name && (
              <div className="text-gray-500 text-xs mt-0.5 truncate">{unit.unit_name}</div>
            )
          )}
          {unit.station && (
            <div className="text-gray-500 text-xs truncate">{unit.station}</div>
          )}
          {hasGps && gpsAgeMin !== null && (
            <div className={`text-xs mt-0.5 font-medium ${gpsStale ? 'text-orange-400' : 'text-gray-500'}`}>
              {gpsStale ? `GPS stale · ${gpsAgeMin}m ago` : `GPS · ${gpsAgeMin}m ago`}
            </div>
          )}
        </button>

        {/* Edit button on hover */}
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(unit); }}
          className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded text-gray-600 hover:text-blue-400 hover:bg-gray-600 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
          title="Edit unit"
        >
          ✏️
        </button>
      </div>

      {/* Expanded action row when selected */}
      {isSelected && (
        <div className="px-2 pb-2 flex gap-1.5 flex-wrap">
          {!ON_CALL_STATUSES.has(unit.status) && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleOos(unit); }}
              className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors
                ${unit.status === 'out_of_service'
                  ? 'bg-green-800 hover:bg-green-700 text-green-300'
                  : 'bg-gray-700 hover:bg-yellow-900 text-gray-400 hover:text-yellow-300'}`}
            >
              {unit.status === 'out_of_service' ? '✓ Back In Service' : 'Mark OOS'}
            </button>
          )}
          {unit.last_lat && unit.last_lng ? (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); onFlyTo(unit); }}
                className="flex-1 py-1.5 rounded-lg text-xs font-bold bg-gray-700 hover:bg-blue-900 text-gray-400 hover:text-blue-300 transition-colors"
              >
                📍 Go to unit
              </button>
              {!activeCall && (
                <button
                  onClick={(e) => { e.stopPropagation(); onClearGps(unit.id); }}
                  className="py-1.5 px-2 rounded-lg text-xs font-bold bg-gray-700 hover:bg-red-900 text-gray-500 hover:text-red-400 transition-colors"
                  title="Remove GPS pin from map"
                >
                  🗑
                </button>
              )}
            </>
          ) : (
            <div className="flex-1 py-1.5 rounded-lg text-xs text-center text-gray-600 bg-gray-800 border border-gray-700">
              📍 No GPS
            </div>
          )}
        </div>
      )}

      <button
        onClick={(e) => { e.stopPropagation(); onHistory(unit); }}
        className="w-full text-left px-3 pb-2 text-gray-500 hover:text-blue-400 text-xs flex items-center gap-1 transition-colors"
        title="View call history"
      >
        <span>📋</span>
        <span>Call history</span>
      </button>
    </div>
  );
}

export default function UnitPanel({ units, calls, selectedUnitId, onSelectUnit, onUnitHistory, onEditUnit, onRemoveUnit, onAddUnit, onStatusChange, onClearGps, onFlyTo, trackers = [] }) {
  const [editingUnit,  setEditingUnit]  = useState(null);
  const [showAddUnit,  setShowAddUnit]  = useState(false);

  const available = units.filter(u => u.status === 'available').length;
  const active    = units.filter(u =>
    ['dispatched', 'en_route', 'on_scene', 'patient_contact'].includes(u.status)
  ).length;
  const oos = units.filter(u => u.status === 'out_of_service').length;

  const handleSave = async (id, data) => {
    await onEditUnit?.(id, data);
  };

  const handleDelete = async (id) => {
    await onRemoveUnit?.(id);
  };

  return (
    <>
      <div className="flex flex-col w-48 bg-gray-800 border-r border-gray-700 flex-shrink-0 overflow-hidden">
        <div className="px-3 py-3 border-b border-gray-700 flex-shrink-0">
          <div className="flex items-center justify-between mb-2">
            <div className="text-white font-semibold text-sm">Units</div>
            <button
              onClick={() => setShowAddUnit(true)}
              className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white rounded-lg transition-colors"
              title="Add unit"
            >
              + Add
            </button>
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="flex justify-between text-xs">
              <span className="text-green-400">Available</span>
              <span className="text-green-400 font-bold">{available}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-orange-400">On Call</span>
              <span className="text-orange-400 font-bold">{active}</span>
            </div>
            {oos > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">OOS</span>
                <span className="text-gray-500 font-bold">{oos}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {sortUnits(units).map(unit => {
            const activeCall = calls?.find(c =>
              (c.assigned_unit_id === unit.id || (c.additional_unit_ids || []).includes(unit.id)) &&
              ON_CALL_STATUSES.has(c.status)
            );
            return (
              <UnitCard
                key={unit.id}
                unit={unit}
                activeCall={activeCall}
                isSelected={unit.id === selectedUnitId}
                onClick={() => onSelectUnit?.(unit.id === selectedUnitId ? null : unit.id)}
                onHistory={onUnitHistory}
                onEdit={setEditingUnit}
                onToggleOos={(u) => onStatusChange?.(u.id, u.status === 'out_of_service' ? 'available' : 'out_of_service')}
                onFlyTo={(u) => onFlyTo?.(u)}
                onClearGps={(id) => onClearGps?.(id)}
              />
            );
          })}
        </div>

        {/* Bulk GPS clear buttons */}
        {(() => {
          const STALE_MS = 10 * 60 * 1000;
          const now = Date.now();
          const stale = units.filter(u =>
            u.last_lat && u.last_lng && u.last_gps_at &&
            (now - new Date(u.last_gps_at).getTime()) > STALE_MS
          );
          const unassigned = units.filter(u =>
            u.last_lat && u.last_lng && !ON_CALL_STATUSES.has(u.status)
          );
          if (!stale.length && !unassigned.length) return null;
          return (
            <div className="px-2 pb-2 flex-shrink-0 border-t border-gray-700 pt-2 space-y-1">
              {stale.length > 0 && (
                <button
                  onClick={() => stale.forEach(u => onClearGps?.(u.id))}
                  className="w-full py-1.5 rounded-lg text-xs font-bold bg-gray-700 hover:bg-orange-900 text-gray-500 hover:text-orange-400 transition-colors"
                  title="Clear GPS pins that haven't updated in 10+ minutes"
                >
                  🗑 Clear stale GPS ({stale.length})
                </button>
              )}
              {unassigned.length > 0 && (
                <button
                  onClick={() => unassigned.forEach(u => onClearGps?.(u.id))}
                  className="w-full py-1.5 rounded-lg text-xs font-bold bg-gray-700 hover:bg-red-900 text-gray-500 hover:text-red-400 transition-colors"
                  title="Clear GPS pins for units not on an active call"
                >
                  🗑 Clear unassigned GPS ({unassigned.length})
                </button>
              )}
            </div>
          );
        })()}
      </div>

      {editingUnit && (
        <EditUnitModal
          unit={editingUnit}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setEditingUnit(null)}
          trackers={trackers}
        />
      )}

      {showAddUnit && (
        <AddUnitModal
          onAdd={onAddUnit}
          onClose={() => setShowAddUnit(false)}
          trackers={trackers}
        />
      )}
    </>
  );
}
