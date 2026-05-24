import { useState, useCallback } from 'react';
import CallTimeline from './CallTimeline';
import CallComments from './CallComments';
import CloseCallModal from './CloseCallModal';
import { STATUS_COLORS, STATUS_LABELS } from '../../data/mockData';
import { updateCallNarrative } from '../../services/api';

const PRIORITY_COLORS = { 1: 'text-red-400', 2: 'text-orange-400', 3: 'text-blue-400' };

const TS_SEQUENCE = [
  'dispatched_at', 'acknowledged_at', 'en_route_at',
  'on_scene_at', 'patient_contact_at', 'arrived_first_aid_at', 'transporting_at',
  'cleared_at', 'available_at'
];
const TS_LABELS = {
  dispatched_at:       'Dispatched',       acknowledged_at:      'Acknowledged',
  en_route_at:         'En Route',         on_scene_at:          'On Scene',
  patient_contact_at:  'Patient Contact',  arrived_first_aid_at: 'Arrived at First Aid',
  transporting_at:     'Transporting',     cleared_at:           'Cleared',
  available_at:        'Available'
};

function LiveClock() {
  const [t, setT] = useState(() => new Date());
  useState(() => {
    const id = setInterval(() => setT(new Date()), 1000);
    return () => clearInterval(id);
  });
  return t.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function CallDetail({
  call, unit, units = [], authorName = 'Dispatcher',
  onClose, onTimestampUpdate, onLogTime, onAddComment, onAssignUnit, onCloseCall, onAddUnit,
  onRemoveUnit, onSplitCall, parentCall, subCases = [], onUpdatePriority, onAddMutualAid, onRemoveMutualAid
}) {
  const [tab, setTab]                   = useState('detail');
  const [assigningUnit, setAssigningUnit] = useState(false);
  const [addingUnit,    setAddingUnit]    = useState(false);
  const [selectedUnitId, setSelectedUnitId] = useState('');
  const [addUnitId,      setAddUnitId]      = useState('');
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [narrative, setNarrative]         = useState(call.narrative || '');
  const [addingAid,     setAddingAid]     = useState(false);
  const [aidName,       setAidName]       = useState('');
  const [aidUnit,       setAidUnit]       = useState('');
  const [aidRole,       setAidRole]       = useState('');
  const clock = LiveClock();

  const handleNarrativeBlur = useCallback(() => {
    updateCallNarrative(call.id, narrative).catch(() => {});
  }, [call.id, narrative]);

  if (!call) return null;

  const statusColor = STATUS_COLORS[call.status] || '#9ca3af';
  const nextTsField = TS_SEQUENCE.find(f => !call[f]);
  const nextTsLabel = nextTsField ? TS_LABELS[nextTsField] : null;
  const commentCount = call.comments?.length || 0;
  const isPending = !call.assigned_unit_id;

  const TYPE_ICONS = { ALS: '🚑', BLS: '🚐', Cart: '🛺' };

  const additionalUnits = (call.additional_unit_ids || [])
    .map(id => units.find(u => u.id === id))
    .filter(Boolean);

  const availableUnits = units.filter(u =>
    (u.status === 'available' || u.status === 'cleared') &&
    u.id !== call.assigned_unit_id &&
    !(call.additional_unit_ids || []).includes(u.id)
  );

  const handleAssign = () => {
    if (!selectedUnitId) return;
    onAssignUnit?.(call.id, selectedUnitId);
    setAssigningUnit(false);
    setSelectedUnitId('');
  };

  const handleAddUnit = () => {
    if (!addUnitId) return;
    onAddUnit?.(call.id, addUnitId);
    setAddingUnit(false);
    setAddUnitId('');
  };

  return (
    <div className="flex flex-col h-full bg-gray-800 border-l border-gray-700">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 flex-shrink-0">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-bold text-base">Case #{call.call_number}</span>
            <span className={`text-sm font-semibold ${PRIORITY_COLORS[call.priority]}`}>
              P{call.priority}
            </span>
            {isPending && (
              <span className="text-xs bg-indigo-600 text-white px-1.5 py-0.5 rounded font-bold">
                PENDING
              </span>
            )}
            {parentCall && (
              <span className="text-xs bg-gray-600 text-gray-300 px-1.5 py-0.5 rounded">
                Sub-case of #{parentCall.call_number}
              </span>
            )}
          </div>
          <div className="text-gray-400 text-xs mt-0.5">{call.call_type}</div>
          {subCases.length > 0 && (
            <div className="text-xs text-blue-400 mt-0.5">
              Sub-cases: {subCases.map(c => `#${c.call_number}`).join(', ')}
            </div>
          )}
        </div>
        <button onClick={onClose}
          className="text-gray-400 hover:text-white w-8 h-8 flex items-center justify-center rounded hover:bg-gray-700 text-xl">
          ×
        </button>
      </div>

      {/* Assign unit banner — shown when no unit is assigned */}
      {isPending && (
        <div className="px-4 py-3 bg-indigo-900/40 border-b border-indigo-700/50 flex-shrink-0">
          <div className="text-indigo-300 text-xs font-semibold uppercase tracking-wider mb-2">
            ⚠ No unit assigned
          </div>
          {assigningUnit ? (
            <div className="flex gap-2">
              <select
                autoFocus
                value={selectedUnitId}
                onChange={e => setSelectedUnitId(e.target.value)}
                className="flex-1 bg-gray-700 text-white rounded-lg px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select unit…</option>
                {availableUnits.map(u => (
                  <option key={u.id} value={u.id}>
                    {TYPE_ICONS[u.unit_type] || '🚑'} {u.unit_number} ({u.unit_type})
                  </option>
                ))}
                {availableUnits.length === 0 && (
                  <option disabled>No available units</option>
                )}
              </select>
              <button
                onClick={handleAssign}
                disabled={!selectedUnitId}
                className="px-3 py-1.5 bg-green-700 hover:bg-green-600 disabled:bg-gray-600 text-white text-xs font-bold rounded-lg transition-colors"
              >
                Dispatch
              </button>
              <button
                onClick={() => { setAssigningUnit(false); setSelectedUnitId(''); }}
                className="px-2 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded-lg transition-colors"
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              onClick={() => setAssigningUnit(true)}
              className="w-full py-2 bg-indigo-700 hover:bg-indigo-600 text-white text-sm font-bold rounded-lg transition-colors"
            >
              Assign Unit →
            </button>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-gray-700 flex-shrink-0">
        {[
          { id: 'detail',   label: 'Detail' },
          { id: 'timeline', label: 'Timeline' },
          { id: 'comments', label: `Comments${commentCount ? ` (${commentCount})` : ''}` }
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex-1 py-2 text-xs font-medium transition-colors
              ${tab === t.id
                ? 'text-blue-400 border-b-2 border-blue-400 bg-gray-700/40'
                : 'text-gray-500 hover:text-gray-300'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">

        {tab === 'detail' && (
          <>
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: statusColor }} />
              <span className="text-sm font-medium" style={{ color: statusColor }}>
                {STATUS_LABELS[call.status]}
              </span>
            </div>

            <div className="bg-gray-700 rounded-xl p-3 space-y-2">
              <Row label="Type"      value={call.call_type} />
              <Row label="Complaint" value={call.chief_complaint || '—'} />
              <Row label="Location"  value={call.location_name || '—'} />
              <Row label="Zone"      value={call.park_zone || '—'} />
              {call.response_mode && <Row label="Response" value={call.response_mode === 'cart' ? '🛺 Cart' : '🚶 On Foot'} />}
              {call.notes && <Row label="Notes" value={call.notes} />}
            </div>

            {/* Priority toggle */}
            <div className="bg-gray-700 rounded-xl p-3 space-y-2">
              <div className="text-gray-400 text-xs uppercase tracking-wider">Priority</div>
              <div className="flex gap-2">
                {[
                  { val: 1, label: 'P1 Critical', active: 'bg-red-600 text-white', inactive: 'bg-gray-600 text-gray-400 hover:bg-gray-500' },
                  { val: 2, label: 'P2 Urgent',   active: 'bg-orange-600 text-white', inactive: 'bg-gray-600 text-gray-400 hover:bg-gray-500' },
                  { val: 3, label: 'P3 Routine',  active: 'bg-blue-700 text-white', inactive: 'bg-gray-600 text-gray-400 hover:bg-gray-500' }
                ].map(({ val, label, active, inactive }) => (
                  <button key={val} type="button"
                    onClick={() => call.priority !== val && onUpdatePriority?.(call.id, val)}
                    className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors
                      ${call.priority === val ? active : inactive}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Assigned unit info */}
            {unit && !assigningUnit && (
              <div className="bg-gray-700 rounded-xl p-3 flex items-center justify-between">
                <div>
                  <div className="text-white font-semibold">{unit.unit_number}</div>
                  <div className="text-gray-400 text-xs">{unit.unit_name} · {unit.unit_type}</div>
                </div>
                <div>
                  <div className="text-xs font-medium px-2 py-1 rounded-full"
                    style={{ color: STATUS_COLORS[unit.status], background: STATUS_COLORS[unit.status] + '22' }}>
                    {STATUS_LABELS[unit.status]}
                  </div>
                  <button
                    onClick={() => setAssigningUnit(true)}
                    className="text-gray-500 hover:text-blue-400 text-xs mt-1 block text-center transition-colors"
                  >
                    change
                  </button>
                </div>
              </div>
            )}

            {/* Reassign unit — shown when change is clicked on an already-assigned call */}
            {unit && assigningUnit && (
              <div className="bg-gray-700 rounded-xl p-3 space-y-2">
                <div className="text-gray-400 text-xs uppercase tracking-wider">Reassign Unit</div>
                <div className="flex gap-2">
                  <select
                    autoFocus
                    value={selectedUnitId}
                    onChange={e => setSelectedUnitId(e.target.value)}
                    className="flex-1 bg-gray-600 text-white rounded-lg px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select unit…</option>
                    {units.filter(u => u.status === 'available' || u.status === 'cleared').map(u => (
                      <option key={u.id} value={u.id}>
                        {TYPE_ICONS[u.unit_type] || '🚑'} {u.unit_number} ({u.unit_type})
                      </option>
                    ))}
                    {units.filter(u => u.status === 'available' || u.status === 'cleared').length === 0 && <option disabled>No available units</option>}
                  </select>
                  <button onClick={handleAssign} disabled={!selectedUnitId}
                    className="px-3 py-1.5 bg-green-700 hover:bg-green-600 disabled:bg-gray-600 text-white text-xs font-bold rounded-lg transition-colors">
                    Reassign
                  </button>
                  <button onClick={() => { setAssigningUnit(false); setSelectedUnitId(''); }}
                    className="px-2 py-1.5 bg-gray-600 hover:bg-gray-500 text-gray-300 text-xs rounded-lg transition-colors">
                    ✕
                  </button>
                </div>
              </div>
            )}

            {/* Additional units */}
            {additionalUnits.length > 0 && (
              <div className="bg-gray-700 rounded-xl p-3 space-y-1.5">
                <div className="text-gray-400 text-xs uppercase tracking-wider">Additional Units</div>
                {additionalUnits.map(u => (
                  <div key={u.id} className="flex items-center justify-between">
                    <div>
                      <span className="text-white text-sm font-semibold">{u.unit_number}</span>
                      <span className="text-gray-400 text-xs ml-2">{u.unit_type}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-xs font-medium px-2 py-0.5 rounded-full"
                        style={{ color: STATUS_COLORS[u.status], background: STATUS_COLORS[u.status] + '22' }}>
                        {STATUS_LABELS[u.status]}
                      </div>
                      <button
                        onClick={() => onRemoveUnit?.(call.id, u.id)}
                        title="Remove from call"
                        className="text-gray-600 hover:text-red-400 text-sm transition-colors leading-none"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add Unit button / form */}
            {!addingUnit ? (
              <button onClick={() => setAddingUnit(true)}
                className="w-full py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white text-xs font-semibold rounded-lg transition-colors border border-gray-600 border-dashed">
                + Add Unit to Call
              </button>
            ) : (
              <div className="bg-gray-700 rounded-xl p-3 space-y-2">
                <div className="text-gray-400 text-xs uppercase tracking-wider">Add Unit</div>
                <div className="flex gap-2">
                  <select autoFocus value={addUnitId} onChange={e => setAddUnitId(e.target.value)}
                    className="flex-1 bg-gray-600 text-white rounded-lg px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">Select unit…</option>
                    {availableUnits.map(u => (
                      <option key={u.id} value={u.id}>
                        {TYPE_ICONS[u.unit_type] || '🚑'} {u.unit_number} ({u.unit_type})
                      </option>
                    ))}
                    {availableUnits.length === 0 && <option disabled>No available units</option>}
                  </select>
                  <button onClick={handleAddUnit} disabled={!addUnitId}
                    className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:bg-gray-600 text-white text-xs font-bold rounded-lg transition-colors">
                    Add
                  </button>
                  <button onClick={() => { setAddingUnit(false); setAddUnitId(''); }}
                    className="px-2 py-1.5 bg-gray-600 hover:bg-gray-500 text-gray-300 text-xs rounded-lg transition-colors">
                    ✕
                  </button>
                </div>
              </div>
            )}

            {/* Narrative */}
            <div className="bg-gray-700 rounded-xl p-3 space-y-1.5">
              <div className="text-gray-400 text-xs uppercase tracking-wider">Narrative</div>
              <textarea
                value={narrative}
                onChange={e => setNarrative(e.target.value)}
                onBlur={handleNarrativeBlur}
                placeholder="Incident narrative…"
                rows={4}
                className="w-full bg-gray-600 text-gray-100 text-sm rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500 resize-none"
              />
              <p className="text-gray-600 text-xs">Auto-saves when you click away</p>
            </div>

            {/* Mutual Aid */}
            <div className="bg-gray-700 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-gray-400 text-xs uppercase tracking-wider">Mutual Aid / Outside Agency</div>
                {!addingAid && (
                  <button onClick={() => setAddingAid(true)}
                    className="text-blue-400 hover:text-blue-300 text-xs transition-colors">+ Add</button>
                )}
              </div>
              {(call.mutual_aid_agencies || []).map(a => (
                <div key={a.id} className="flex items-center justify-between text-sm">
                  <div>
                    <span className="text-white font-medium">{a.name}</span>
                    {a.unit_id && <span className="text-gray-400 text-xs ml-1">· {a.unit_id}</span>}
                    {a.role   && <span className="text-gray-500 text-xs ml-1">({a.role})</span>}
                  </div>
                  <button onClick={() => onRemoveMutualAid?.(call.id, a.id)}
                    className="text-gray-600 hover:text-red-400 text-xs transition-colors ml-2">✕</button>
                </div>
              ))}
              {(call.mutual_aid_agencies || []).length === 0 && !addingAid && (
                <div className="text-gray-600 text-xs">None logged</div>
              )}
              {addingAid && (
                <div className="space-y-1.5 pt-1">
                  <input autoFocus value={aidName} onChange={e => setAidName(e.target.value)}
                    placeholder="Agency name (e.g. MedStar)"
                    className="w-full bg-gray-600 text-white rounded-lg px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500" />
                  <div className="flex gap-1.5">
                    <input value={aidUnit} onChange={e => setAidUnit(e.target.value)}
                      placeholder="Unit ID (e.g. Medic 42)"
                      className="flex-1 bg-gray-600 text-white rounded-lg px-2.5 py-1.5 text-xs outline-none focus:ring-1 focus:ring-blue-500 placeholder-gray-500" />
                    <input value={aidRole} onChange={e => setAidRole(e.target.value)}
                      placeholder="Role (Transport…)"
                      className="flex-1 bg-gray-600 text-white rounded-lg px-2.5 py-1.5 text-xs outline-none focus:ring-1 focus:ring-blue-500 placeholder-gray-500" />
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => {
                        if (!aidName.trim()) return;
                        onAddMutualAid?.(call.id, aidName.trim(), aidUnit.trim(), aidRole.trim());
                        setAidName(''); setAidUnit(''); setAidRole(''); setAddingAid(false);
                      }}
                      disabled={!aidName.trim()}
                      className="flex-1 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:bg-gray-600 text-white text-xs font-bold rounded-lg transition-colors">
                      Log Agency
                    </button>
                    <button onClick={() => { setAddingAid(false); setAidName(''); setAidUnit(''); setAidRole(''); }}
                      className="px-3 py-1.5 bg-gray-600 hover:bg-gray-500 text-gray-300 text-xs rounded-lg transition-colors">
                      ✕
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Log Time */}
            <div className="bg-gray-700 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-gray-400 text-xs uppercase tracking-wider">Log Time</span>
                <span className="text-gray-300 text-xs font-mono">{clock}</span>
              </div>
              <button
                onClick={() => onLogTime?.(call.id)}
                disabled={!nextTsField}
                className="w-full py-2.5 bg-green-700 hover:bg-green-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
              >
                ⏱ {nextTsLabel ? `LOG TIME — ${nextTsLabel}` : 'All times logged'}
              </button>
              {nextTsLabel && (
                <p className="text-gray-500 text-xs text-center">
                  Stamps current time to <span className="text-gray-300">{nextTsLabel}</span>
                </p>
              )}
            </div>
          </>
        )}

        {tab === 'timeline' && (
          <>
            <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">
              Timestamps <span className="text-gray-600 normal-case">(hover row to edit)</span>
            </div>
            <CallTimeline
              call={call}
              onTimestampUpdate={(field, iso) => onTimestampUpdate?.(call.id, field, iso)}
            />
            <button
              onClick={() => onLogTime?.(call.id)}
              disabled={!nextTsField}
              className="w-full py-2 bg-green-700 hover:bg-green-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold rounded-lg text-sm transition-colors flex items-center justify-center gap-2 mt-2"
            >
              ⏱ {nextTsLabel ? `LOG TIME — ${nextTsLabel}` : 'All times logged'}
            </button>
          </>
        )}

        {tab === 'comments' && (
          <>
            <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">Comments</div>
            <CallComments
              comments={call.comments || []}
              onAdd={(text, author) => onAddComment?.(call.id, text, author)}
              authorName={authorName}
            />
          </>
        )}
      </div>

      {/* Actions */}
      <div className="p-4 border-t border-gray-700 flex gap-2 flex-shrink-0">
        <button
          onClick={() => onSplitCall?.(call)}
          title="Create a new case linked to this one (second patient)"
          className="flex-1 py-2 text-sm bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg transition-colors font-semibold"
        >
          🧑‍⚕️ New Patient
        </button>
        <button
          onClick={() => setShowCloseModal(true)}
          className="flex-1 py-2 text-sm bg-red-700 hover:bg-red-600 text-white rounded-lg transition-colors font-semibold"
        >
          Close Case
        </button>
      </div>

      {showCloseModal && (
        <CloseCallModal
          call={call}
          onConfirm={async (id, disposition, notes) => {
            await onCloseCall?.(id, disposition, notes);
            setShowCloseModal(false);
            onClose?.();
          }}
          onClose={() => setShowCloseModal(false)}
        />
      )}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex gap-2">
      <span className="text-gray-500 text-xs w-20 flex-shrink-0 pt-0.5">{label}</span>
      <span className="text-gray-200 text-sm leading-snug">{value}</span>
    </div>
  );
}
