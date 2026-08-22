import { useState, useCallback, useEffect } from 'react';
import CallTimeline from './CallTimeline';
import CallComments from './CallComments';
import CloseCallModal from './CloseCallModal';
import GpsTrackTab from './GpsTrackTab';
import { STATUS_COLORS, STATUS_LABELS, VALID_UNIT_STATUSES, CALL_TYPES } from '../../data/mockData';
import { updateCallNarrative, updateCallLocation, updateCallDetails } from '../../services/api';

const PRIORITY_COLORS = { 1: 'text-red-400', 2: 'text-orange-400', 3: 'text-blue-400' };

const TS_SEQUENCE = [
  'dispatched_at', 'acknowledged_at', 'en_route_at',
  'on_scene_at', 'patient_contact_at', 'transporting_at', 'arrived_first_aid_at',
  'cleared_at', 'available_at'
];
// Where each call status sits in TS_SEQUENCE — used to start the "what's
// next" search from the call's actual current progress, not from the
// beginning. A call can legitimately skip logging some earlier steps (e.g.
// crew jumped straight to Patient Contact without a separate Acknowledged
// press), leaving that earlier field permanently null — scanning from the
// start would then offer that already-passed step as "next" and, if
// clicked, would regress the call's status backward.
const STATUS_TO_TS = {
  dispatched: 'dispatched_at', acknowledged: 'acknowledged_at', en_route: 'en_route_at',
  on_scene: 'on_scene_at', patient_contact: 'patient_contact_at',
  transporting: 'transporting_at', cleared: 'cleared_at', available: 'available_at'
};
const TS_LABELS = {
  dispatched_at:       'Dispatched',       acknowledged_at:      'Acknowledged',
  en_route_at:         'En Route',         on_scene_at:          'On Scene',
  patient_contact_at:  'Patient Contact',  arrived_first_aid_at: 'Arrived at First Aid',
  transporting_at:     'Transporting',     cleared_at:           'Cleared',
  available_at:        'Available'
};

function LiveClock() {
  const [t, setT] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return t.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function CallDetail({
  call, unit, units = [], authorName = 'Dispatcher',
  onClose, onTimestampUpdate, onLogTime, onAddComment, onAssignUnit, onCloseCall, onAddUnit,
  onRemoveUnit, onSplitCall, parentCall, subCases = [], onUpdatePriority, onAddMutualAid, onRemoveMutualAid,
  onChangeUnitStatus, onRepositionPin
}) {
  const [tab, setTab]                   = useState('detail');
  const [assigningUnit, setAssigningUnit] = useState(false);
  const [addingUnit,    setAddingUnit]    = useState(false);
  const [selectedUnitId, setSelectedUnitId] = useState('');
  const [reassignStatus, setReassignStatus] = useState('dispatched');
  const [addUnitId,      setAddUnitId]      = useState('');
  const [addUnitStatus,  setAddUnitStatus]  = useState('dispatched');
  const [assignSubmitting, setAssignSubmitting] = useState(false);
  const [assignError,      setAssignError]      = useState('');
  const [addUnitSubmitting, setAddUnitSubmitting] = useState(false);
  const [addUnitError,      setAddUnitError]      = useState('');
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [narrative, setNarrative]         = useState(call.narrative || '');
  const [addingAid,       setAddingAid]       = useState(false);
  const [aidName,         setAidName]         = useState('');
  const [aidUnit,         setAidUnit]         = useState('');
  const [aidRole,         setAidRole]         = useState('');
  const [editingLocation, setEditingLocation] = useState(false);
  const [locName,         setLocName]         = useState('');
  const [editingDetails,  setEditingDetails]  = useState(false);
  const [detailType,      setDetailType]      = useState('');
  const [detailComplaint, setDetailComplaint] = useState('');
  const [editingUnitStatusId, setEditingUnitStatusId] = useState(null);
  const [removingUnitId,  setRemovingUnitId]  = useState(null);
  const clock = LiveClock();

  // Reset to detail tab when selected call changes
  useEffect(() => {
    setTab('detail');
    setAssigningUnit(false);
    setAddingUnit(false);
    setSelectedUnitId('');
    setReassignStatus('dispatched');
    setAddUnitId('');
    setAddUnitStatus('dispatched');
    setAssignSubmitting(false);
    setAssignError('');
    setAddUnitSubmitting(false);
    setAddUnitError('');
    setShowCloseModal(false);
    setNarrative(call.narrative || '');
    setAddingAid(false);
    setAidName(''); setAidUnit(''); setAidRole('');
    setEditingLocation(false);
    setEditingDetails(false);
    setEditingUnitStatusId(null);
    setRemovingUnitId(null);
  }, [call.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleNarrativeBlur = useCallback(() => {
    updateCallNarrative(call.id, narrative).catch(() => {});
  }, [call.id, narrative]);

  if (!call) return null;

  const statusColor = STATUS_COLORS[call.status] || '#9ca3af';
  const currentTsIdx = TS_SEQUENCE.indexOf(STATUS_TO_TS[call.status]);
  const nextTsField = TS_SEQUENCE.slice(currentTsIdx + 1).find(f => !call[f]);
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
  // A cart is a ride to the scene, never the lead unit — only for picking the
  // call's primary. Adding one as a backup/additional unit is still fine and
  // uses availableUnits directly.
  const primaryEligibleUnits = availableUnits.filter(u => u.unit_type !== 'Cart');

  const handleAssign = async () => {
    if (!selectedUnitId || assignSubmitting) return;
    setAssignSubmitting(true);
    setAssignError('');
    // Only a mid-call swap needs a starting status — a first-time assignment
    // (call still pending) always starts fresh at 'dispatched' server-side.
    const err = await onAssignUnit?.(call.id, selectedUnitId, isPending ? undefined : reassignStatus);
    setAssignSubmitting(false);
    if (err) { setAssignError(err); return; }
    setAssigningUnit(false);
    setSelectedUnitId('');
    setReassignStatus('dispatched');
  };

  const handleAddUnit = async () => {
    if (!addUnitId || addUnitSubmitting) return;
    setAddUnitSubmitting(true);
    setAddUnitError('');
    const err = await onAddUnit?.(call.id, addUnitId, addUnitStatus);
    setAddUnitSubmitting(false);
    if (err) { setAddUnitError(err); return; }
    setAddingUnit(false);
    setAddUnitId('');
    setAddUnitStatus('dispatched');
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

      {/* Log Time Now quick bar — shown whenever there's a next timestamp to fill */}
      {nextTsField && !isPending && (
        <div className="px-4 py-2 bg-green-900/30 border-b border-green-800/40 flex items-center justify-between flex-shrink-0">
          <span className="text-green-300 text-xs font-medium">Next: {nextTsLabel}</span>
          <button
            onClick={() => onLogTime?.(call.id)}
            className="text-xs px-3 py-1 bg-green-700 hover:bg-green-600 text-white font-bold rounded-lg transition-colors"
          >
            ⏱ Log Now
          </button>
        </div>
      )}

      {/* Assign unit banner — shown when no unit is assigned */}
      {isPending && (
        <div className="px-4 py-3 bg-indigo-900/40 border-b border-indigo-700/50 flex-shrink-0">
          <div className="text-indigo-300 text-xs font-semibold uppercase tracking-wider mb-2">
            ⚠ No unit assigned
          </div>
          {assigningUnit ? (
            <div className="space-y-2">
              {primaryEligibleUnits.length === 0 ? (
                <div className="text-gray-500 text-xs py-1">No available units</div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {primaryEligibleUnits.map(u => (
                    <button key={u.id} type="button"
                      onClick={() => setSelectedUnitId(id => id === u.id ? '' : u.id)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border-2 transition-all
                        ${selectedUnitId === u.id
                          ? 'bg-indigo-600 border-indigo-400 text-white'
                          : 'bg-gray-700 border-gray-500 text-gray-300 hover:border-gray-400'}`}>
                      {TYPE_ICONS[u.unit_type] || '🚑'} {u.unit_number}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={handleAssign}
                  disabled={!selectedUnitId || assignSubmitting}
                  className="flex-1 py-1.5 bg-green-700 hover:bg-green-600 disabled:bg-gray-600 text-white text-xs font-bold rounded-lg transition-colors"
                >
                  {assignSubmitting ? 'Dispatching…' : 'Dispatch'}
                </button>
                <button
                  onClick={() => { setAssigningUnit(false); setSelectedUnitId(''); setAssignError(''); }}
                  className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded-lg transition-colors"
                >
                  ✕
                </button>
              </div>
              {assignError && <p className="text-red-400 text-xs">{assignError}</p>}
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
          { id: 'comments', label: `Comments${commentCount ? ` (${commentCount})` : ''}` },
          { id: 'gpstrack', label: 'GPS Track' }
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
              {editingDetails ? (
                <div className="space-y-2">
                  <div>
                    <label className="block text-gray-500 text-xs mb-1">Call Type</label>
                    <select
                      autoFocus
                      value={detailType}
                      onChange={e => setDetailType(e.target.value)}
                      className="w-full bg-gray-600 text-white rounded-lg px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="">— Select call type —</option>
                      {CALL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-gray-500 text-xs mb-1">Chief Complaint</label>
                    <input
                      type="text"
                      value={detailComplaint}
                      onChange={e => setDetailComplaint(e.target.value)}
                      className="w-full bg-gray-600 text-white rounded-lg px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        await updateCallDetails(call.id, { call_type: detailType, chief_complaint: detailComplaint }).catch(() => {});
                        setEditingDetails(false);
                      }}
                      className="flex-1 py-1.5 bg-blue-700 hover:bg-blue-600 text-white text-xs font-bold rounded-lg transition-colors"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingDetails(false)}
                      className="flex-1 py-1.5 bg-gray-600 hover:bg-gray-500 text-gray-300 text-xs rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between">
                  <div className="space-y-1 flex-1">
                    <Row label="Type"      value={call.call_type} />
                    <Row label="Complaint" value={call.chief_complaint || '—'} />
                  </div>
                  <button
                    onClick={() => { setDetailType(call.call_type || ''); setDetailComplaint(call.chief_complaint || ''); setEditingDetails(true); }}
                    className="text-gray-600 hover:text-blue-400 text-xs transition-colors ml-2 flex-shrink-0"
                    title="Edit call type / complaint"
                  >
                    ✏️
                  </button>
                </div>
              )}
              {editingLocation ? (
                <div className="space-y-2 pt-1">
                  <div>
                    <label className="block text-gray-500 text-xs mb-1">Location</label>
                    <input
                      autoFocus
                      type="text"
                      value={locName}
                      onChange={e => setLocName(e.target.value)}
                      className="w-full bg-gray-600 text-white rounded-lg px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        await updateCallLocation(call.id, { location_name: locName }).catch(() => {});
                        setEditingLocation(false);
                      }}
                      className="flex-1 py-1.5 bg-blue-700 hover:bg-blue-600 text-white text-xs font-bold rounded-lg transition-colors"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingLocation(false)}
                      className="flex-1 py-1.5 bg-gray-600 hover:bg-gray-500 text-gray-300 text-xs rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Row label="Location" value={call.location_name || '—'} />
                  </div>
                  <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                    {onRepositionPin && (
                      <button
                        onClick={() => onRepositionPin(call.id)}
                        className="text-gray-600 hover:text-blue-400 text-xs transition-colors"
                        title="Reposition pin on map"
                      >
                        📍
                      </button>
                    )}
                    <button
                      onClick={() => { setLocName(call.location_name || ''); setEditingLocation(true); }}
                      className="text-gray-600 hover:text-blue-400 text-xs transition-colors"
                      title="Edit location"
                    >
                      ✏️
                    </button>
                  </div>
                </div>
              )}
              {call.response_mode && <Row label="Response" value={call.response_mode === 'cart' ? '🛺 Cart' : '🚶 On Foot'} />}
              {call.notes && <Row label="Notes" value={call.notes} />}
            </div>

            {/* Priority toggle */}
            <div className="bg-gray-700 rounded-xl p-3 space-y-2">
              <div className="text-gray-400 text-xs uppercase tracking-wider">Priority</div>
              <div className="flex gap-2">
                {[
                  { val: 1, label: 'P1 High Acuity',    active: 'bg-red-600 text-white', inactive: 'bg-gray-600 text-gray-400 hover:bg-gray-500' },
                  { val: 2, label: 'P2 Medium Acuity', active: 'bg-orange-600 text-white', inactive: 'bg-gray-600 text-gray-400 hover:bg-gray-500' },
                  { val: 3, label: 'P3 Low Acuity',    active: 'bg-blue-700 text-white', inactive: 'bg-gray-600 text-gray-400 hover:bg-gray-500' }
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
                <div className="flex items-center justify-between">
                  <div className="text-gray-400 text-xs uppercase tracking-wider">Reassign Unit</div>
                  <button onClick={() => { setAssigningUnit(false); setSelectedUnitId(''); }}
                    className="text-gray-500 hover:text-gray-300 text-sm leading-none">✕</button>
                </div>
                {units.filter(u => (u.status === 'available' || u.status === 'cleared') && u.unit_type !== 'Cart').length === 0 ? (
                  <div className="text-gray-500 text-xs py-1">No available units</div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {units.filter(u => (u.status === 'available' || u.status === 'cleared') && u.unit_type !== 'Cart').map(u => (
                      <button key={u.id} type="button"
                        onClick={() => setSelectedUnitId(id => id === u.id ? '' : u.id)}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border-2 transition-all
                          ${selectedUnitId === u.id
                            ? 'bg-green-700 border-green-400 text-white'
                            : 'bg-gray-600 border-gray-500 text-gray-300 hover:border-gray-400'}`}>
                        {TYPE_ICONS[u.unit_type] || '🚑'} {u.unit_number}
                      </button>
                    ))}
                  </div>
                )}
                {selectedUnitId && (
                  <div>
                    <div className="text-gray-500 text-xs mb-1">Starting status — where is this unit actually at?</div>
                    <div className="flex gap-1.5">
                      {['dispatched', 'en_route', 'on_scene'].map(s => (
                        <button key={s} type="button"
                          onClick={() => setReassignStatus(s)}
                          className={`flex-1 py-1 rounded-lg text-xs font-semibold transition-colors
                            ${reassignStatus === s ? 'text-white' : 'bg-gray-600 text-gray-400 hover:bg-gray-500'}`}
                          style={reassignStatus === s ? { backgroundColor: STATUS_COLORS[s] } : undefined}>
                          {STATUS_LABELS[s]}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <button onClick={handleAssign} disabled={!selectedUnitId || assignSubmitting}
                  className="w-full py-1.5 bg-green-700 hover:bg-green-600 disabled:bg-gray-600 text-white text-xs font-bold rounded-lg transition-colors">
                  {assignSubmitting ? 'Reassigning…' : 'Reassign'}
                </button>
                {assignError && <p className="text-red-400 text-xs">{assignError}</p>}
              </div>
            )}

            {/* Additional units */}
            {additionalUnits.length > 0 && (
              <div className="bg-gray-700 rounded-xl p-3 space-y-1.5">
                <div className="text-gray-400 text-xs uppercase tracking-wider">Additional Units</div>
                {additionalUnits.map(u => {
                  const addedAt = (call.additional_units_added_at || {})[u.id];
                  return (
                    <div key={u.id} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-white text-sm font-semibold">{u.unit_number}</span>
                          <span className="text-gray-400 text-xs ml-2">{u.unit_type}</span>
                          {addedAt && (
                            <div className="text-gray-500 text-xs">
                              Added {new Date(addedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setEditingUnitStatusId(editingUnitStatusId === u.id ? null : u.id)}
                            title="Click to change this unit's status"
                            className="text-xs font-medium px-2 py-0.5 rounded-full hover:ring-1 hover:ring-white/30 transition-all"
                            style={{ color: STATUS_COLORS[u.status], background: STATUS_COLORS[u.status] + '22' }}
                          >
                            {STATUS_LABELS[u.status]}
                          </button>
                          {removingUnitId === u.id ? (
                            <div className="flex items-center gap-1">
                              <span className="text-red-400 text-xs">Remove?</span>
                              <button
                                onClick={() => { onRemoveUnit?.(call.id, u.id); setRemovingUnitId(null); }}
                                className="text-xs px-1.5 py-0.5 bg-red-700 hover:bg-red-600 text-white rounded transition-colors"
                              >
                                Yes
                              </button>
                              <button
                                onClick={() => setRemovingUnitId(null)}
                                className="text-xs px-1.5 py-0.5 bg-gray-600 hover:bg-gray-500 text-gray-300 rounded transition-colors"
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setRemovingUnitId(u.id)}
                              title="Remove from call"
                              className="text-gray-600 hover:text-red-400 text-sm transition-colors leading-none"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>
                      {editingUnitStatusId === u.id && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {VALID_UNIT_STATUSES.map(s => (
                            <button
                              key={s}
                              onClick={() => { onChangeUnitStatus?.(u.id, s); setEditingUnitStatusId(null); }}
                              className={`px-2 py-0.5 text-xs font-semibold rounded-lg transition-colors
                                ${s === u.status ? 'text-white' : 'bg-gray-600 text-gray-300 hover:bg-gray-500'}`}
                              style={s === u.status ? { backgroundColor: STATUS_COLORS[s] } : undefined}
                            >
                              {STATUS_LABELS[s]}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
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
                <div className="flex items-center justify-between">
                  <div className="text-gray-400 text-xs uppercase tracking-wider">Add Unit</div>
                  <button onClick={() => { setAddingUnit(false); setAddUnitId(''); setAddUnitStatus('dispatched'); setAddUnitError(''); }}
                    className="text-gray-500 hover:text-gray-300 text-sm leading-none">✕</button>
                </div>
                {availableUnits.length === 0 ? (
                  <div className="text-gray-500 text-xs py-1">No available units</div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {availableUnits.map(u => (
                      <button key={u.id} type="button"
                        onClick={() => setAddUnitId(id => id === u.id ? '' : u.id)}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border-2 transition-all
                          ${addUnitId === u.id
                            ? 'bg-blue-700 border-blue-400 text-white'
                            : 'bg-gray-600 border-gray-500 text-gray-300 hover:border-gray-400'}`}>
                        {TYPE_ICONS[u.unit_type] || '🚑'} {u.unit_number}
                      </button>
                    ))}
                  </div>
                )}
                <div>
                  <div className="text-gray-500 text-xs mb-1">Starting status</div>
                  <div className="flex gap-1.5">
                    {['dispatched', 'en_route', 'on_scene'].map(s => (
                      <button key={s} type="button"
                        onClick={() => setAddUnitStatus(s)}
                        className={`flex-1 py-1 rounded-lg text-xs font-semibold transition-colors
                          ${addUnitStatus === s ? 'text-white' : 'bg-gray-600 text-gray-400 hover:bg-gray-500'}`}
                        style={addUnitStatus === s ? { backgroundColor: STATUS_COLORS[s] } : undefined}>
                        {STATUS_LABELS[s]}
                      </button>
                    ))}
                  </div>
                </div>
                <button onClick={handleAddUnit} disabled={!addUnitId || addUnitSubmitting}
                  className="w-full py-1.5 bg-blue-700 hover:bg-blue-600 disabled:bg-gray-600 text-white text-xs font-bold rounded-lg transition-colors">
                  {addUnitSubmitting ? 'Adding…' : 'Add to Call'}
                </button>
                {addUnitError && <p className="text-red-400 text-xs">{addUnitError}</p>}
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

          </>
        )}

        {tab === 'timeline' && (
          <>
            <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">
              Timestamps <span className="text-gray-600 normal-case">(hover row to edit)</span>
            </div>
            <CallTimeline
              call={call}
              units={units}
              onTimestampUpdate={(field, iso) => onTimestampUpdate?.(call.id, field, iso)}
            />
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

        {tab === 'gpstrack' && (
          <GpsTrackTab call={call} />
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
          onClick={() => {
            const openSubs = subCases.filter(c => c.status !== 'closed');
            if (openSubs.length > 0) {
              if (!window.confirm(`This case has ${openSubs.length} open sub-case${openSubs.length > 1 ? 's' : ''} (${openSubs.map(c => `#${c.call_number}`).join(', ')}). Close anyway?`)) return;
            }
            setShowCloseModal(true);
          }}
          className="flex-1 py-2 text-sm bg-red-700 hover:bg-red-600 text-white rounded-lg transition-colors font-semibold"
        >
          Close Case
        </button>
      </div>

      {showCloseModal && (
        <CloseCallModal
          call={call}
          onConfirm={async (id, disposition, notes) => {
            const err = await onCloseCall?.(id, disposition, notes);
            if (err) throw new Error(err);
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
