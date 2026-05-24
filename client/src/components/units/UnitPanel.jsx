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

const CERT_COLORS = {
  'Paramedic': '#f87171',
  'AEMT': '#fb923c',
  'EMT-B': '#60a5fa',
  'First Responder': '#4ade80'
};

const ON_CALL_STATUSES = new Set(['dispatched', 'en_route', 'on_scene', 'patient_contact']);

function UnitCard({ unit, activeCall, isSelected, onClick, onHistory, onEdit, onToggleOos, onFlyTo, onClearGps }) {
  const color = STATUS_COLORS[unit.status] || '#9ca3af';
  const profile = unit.profile;

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
            {profile?.cert_level && (
              <span className="text-xs font-bold" style={{ color: CERT_COLORS[profile.cert_level] || '#9ca3af' }}>
                {profile.cert_level === 'First Responder' ? 'FR' : profile.cert_level}
              </span>
            )}
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
          {profile?.certifications?.length > 0 && (
            <div className="flex flex-wrap gap-0.5 mt-1">
              {profile.certifications.map(c => (
                <span key={c} className="text-xs bg-gray-600 text-gray-300 px-1 py-0.5 rounded font-bold leading-none">
                  {c}
                </span>
              ))}
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

export default function UnitPanel({ units, calls, selectedUnitId, onSelectUnit, onUnitHistory, onEditUnit, onRemoveUnit, onAddUnit, onStatusChange, onClearGps, onFlyTo }) {
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

        {/* Bulk clear unassigned GPS pins */}
        {units.some(u => u.last_lat && u.last_lng && !ON_CALL_STATUSES.has(u.status)) && (
          <div className="px-2 pb-2 flex-shrink-0 border-t border-gray-700 pt-2">
            <button
              onClick={() => {
                units
                  .filter(u => u.last_lat && u.last_lng && !ON_CALL_STATUSES.has(u.status))
                  .forEach(u => onClearGps?.(u.id));
              }}
              className="w-full py-1.5 rounded-lg text-xs font-bold bg-gray-700 hover:bg-red-900 text-gray-500 hover:text-red-400 transition-colors"
              title="Remove all GPS pins for units not on an active call"
            >
              🗑 Clear unassigned GPS
            </button>
          </div>
        )}
      </div>

      {editingUnit && (
        <EditUnitModal
          unit={editingUnit}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setEditingUnit(null)}
        />
      )}

      {showAddUnit && (
        <AddUnitModal
          onAdd={onAddUnit}
          onClose={() => setShowAddUnit(false)}
        />
      )}
    </>
  );
}
