import { useState } from 'react';
import { STATUS_COLORS, STATUS_LABELS } from '../../data/mockData';
import EditUnitModal from './EditUnitModal';

const TYPE_ICONS = { ALS: '🚑', BLS: '🚐', Bike: '🚲', Cart: '🛺' };

const CERT_COLORS = {
  'Paramedic': '#f87171',
  'AEMT': '#fb923c',
  'EMT-B': '#60a5fa',
  'First Responder': '#4ade80'
};

function UnitCard({ unit, isSelected, onClick, onHistory, onEdit }) {
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
          {unit.crew || profile?.name ? (
            <div className="text-gray-400 text-xs mt-0.5 truncate">{unit.crew || profile?.name}</div>
          ) : (
            unit.unit_name && (
              <div className="text-gray-500 text-xs mt-0.5 truncate">{unit.unit_name}</div>
            )
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

        {/* Edit button — appears on hover */}
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(unit); }}
          className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded text-gray-600 hover:text-blue-400 hover:bg-gray-600 opacity-0 group-hover:opacity-100 transition-opacity text-xs"
          title="Edit unit"
        >
          ✏️
        </button>
      </div>

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

export default function UnitPanel({ units, selectedUnitId, onSelectUnit, onUnitHistory, onEditUnit, onRemoveUnit }) {
  const [editingUnit, setEditingUnit] = useState(null);

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
          <div className="text-white font-semibold text-sm mb-2">Units</div>
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
          {units.map(unit => (
            <UnitCard
              key={unit.id}
              unit={unit}
              isSelected={unit.id === selectedUnitId}
              onClick={() => onSelectUnit?.(unit.id === selectedUnitId ? null : unit.id)}
              onHistory={onUnitHistory}
              onEdit={setEditingUnit}
            />
          ))}
        </div>
      </div>

      {editingUnit && (
        <EditUnitModal
          unit={editingUnit}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setEditingUnit(null)}
        />
      )}
    </>
  );
}
