import { useState, useEffect, useRef } from 'react';
import { apiBase } from '../lib/native';

const TYPE_ICONS  = { ALS: '🚑', BLS: '🚐', Cart: '🛺' };
const TYPE_ORDER  = { ALS: 0, BLS: 1, Cart: 2 };
const UNIT_TYPES  = ['ALS', 'BLS', 'Cart'];
const STATIONS    = ['Station 7', 'Station 14', 'Roaming'];

const UNIT_PRESETS = [
  { key: 'Medic', base: 'Medic', type: 'ALS'  },
  { key: 'Cart',  base: 'Cart',  type: 'Cart'  },
  { key: '555',   base: '555',   type: 'ALS'   },
  { key: 'Other', base: '',      type: 'ALS'   },
];

function nextUnitNumber(base, units) {
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escaped}\\s*(\\d+)?$`, 'i');
  const nums = units
    .map(u => { const m = u.unit_number.trim().match(pattern); return m ? (parseInt(m[1]) || 1) : null; })
    .filter(n => n !== null);
  return nums.length === 0 ? `${base} 1` : `${base} ${Math.max(...nums) + 1}`;
}

export default function ShiftSetup({ token, onShiftStarted, onViewHistory }) {
  const [units,    setUnits]    = useState([]);
  const [staffing,  setStaffing]  = useState({});
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');
  const [uncrewedWarning, setUncrewedWarning] = useState(null);

  // Add unit state
  const [addingUnit, setAddingUnit] = useState(false);
  const [newPreset,  setNewPreset]  = useState(null); // null | preset key
  const [newNumber,  setNewNumber]  = useState('');
  const [newType,    setNewType]    = useState('ALS');
  const [newCrew,    setNewCrew]    = useState('');
  const [addError,   setAddError]   = useState('');
  const [addSaving,  setAddSaving]  = useState(false);
  const nameInputRef = useRef(null);

  useEffect(() => {
    fetch(`${apiBase()}/units`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => {
        if (!Array.isArray(data)) return;
        setUnits(data);
        const initial = {};
        data.forEach(u => {
          initial[u.id] = {
            crew:             u.crew            || '',
            unit_type:        u.unit_type,
            in_service:       u.status !== 'out_of_service',
            station:          u.station         || '',
          };
        });
        setStaffing(initial);
      })
      .catch(() => {});
  }, [token]);

  const updateStaffing = (unit_id, field, value) =>
    setStaffing(prev => ({ ...prev, [unit_id]: { ...prev[unit_id], [field]: value } }));

  const setAllInService = () =>
    setStaffing(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(id => { next[id] = { ...next[id], in_service: true }; });
      return next;
    });

  const selectPreset = (preset) => {
    setNewPreset(preset.key);
    if (preset.key === 'Other') {
      setNewNumber('');
      setNewType('ALS');
    } else {
      setNewNumber(nextUnitNumber(preset.base, units));
      setNewType(preset.type);
    }
    setNewCrew('');
    setAddError('');
    setTimeout(() => nameInputRef.current?.focus(), 50);
  };

  const cancelAdd = () => {
    setAddingUnit(false);
    setNewPreset(null);
    setNewNumber('');
    setNewCrew('');
    setAddError('');
  };

  const handleAddUnit = async () => {
    const unitNumber = newNumber.trim();
    if (!unitNumber) { setAddError('Enter a unit number.'); return; }
    setAddSaving(true);
    setAddError('');
    try {
      const res = await fetch(`${apiBase()}/units`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ unit_number: unitNumber, unit_name: unitNumber, unit_type: newType })
      });
      const unit = await res.json();
      if (!res.ok) throw new Error(unit.error || 'Failed to add unit');
      setUnits(prev => [...prev, unit]);
      setStaffing(prev => ({
        ...prev,
        [unit.id]: { crew: newCrew.trim(), unit_type: newType, in_service: true, station: '' }
      }));
      cancelAdd();
    } catch (err) {
      setAddError(err.message);
    } finally {
      setAddSaving(false);
    }
  };

  const handleRemoveUnit = (unit_id) => {
    setUnits(prev => prev.filter(u => u.id !== unit_id));
    setStaffing(prev => { const next = { ...prev }; delete next[unit_id]; return next; });
    fetch(`${apiBase()}/units/${unit_id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    }).catch(() => {});
  };

  const doStart = async () => {
    setUncrewedWarning(null);
    setSaving(true);
    setError('');
    try {
      const unit_staffing = units.map(u => ({
        unit_id:    u.id,
        crew:       staffing[u.id]?.crew || '',
        unit_type:  staffing[u.id]?.unit_type || u.unit_type,
        in_service: staffing[u.id]?.in_service ?? true,
        station:    staffing[u.id]?.station || ''
      }));
      const label = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      const res  = await fetch(`${apiBase()}/shift/start`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ shift_label: label, unit_staffing })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start shift');
      onShiftStarted(data.shift, data.units);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleStart = () => {
    const uncrewed = units.filter(u => {
      const s = staffing[u.id];
      return (s?.in_service ?? true) && (s?.unit_type || u.unit_type) !== 'Cart' && !s?.crew?.trim();
    });
    if (uncrewed.length > 0) {
      setUncrewedWarning(uncrewed.map(u => u.unit_number));
    } else {
      doStart();
    }
  };

  const sortedUnits = [...units].sort((a, b) => {
    const ta = staffing[a.id]?.unit_type || a.unit_type;
    const tb = staffing[b.id]?.unit_type || b.unit_type;
    if ((TYPE_ORDER[ta] ?? 99) !== (TYPE_ORDER[tb] ?? 99))
      return (TYPE_ORDER[ta] ?? 99) - (TYPE_ORDER[tb] ?? 99);
    return a.unit_number.localeCompare(b.unit_number, undefined, { numeric: true });
  });

  const inServiceCount  = units.filter(u => staffing[u.id]?.in_service ?? true).length;
  const outServiceCount = units.length - inServiceCount;
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="fixed inset-0 bg-gray-900 z-50 overflow-y-auto">
      <div className="w-full max-w-2xl mx-auto py-8 px-4">

        {/* Header */}
        <div className="text-center mb-6 relative">
          {onViewHistory && (
            <button
              onClick={onViewHistory}
              className="absolute right-0 top-0 flex items-center gap-1.5 text-xs px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-600 rounded-lg transition-colors"
            >
              📋 Call History
            </button>
          )}
          <div className="text-4xl mb-2">🚑</div>
          <h1 className="text-2xl font-bold text-white">Start Shift</h1>
          <p className="text-gray-400 text-sm mt-1">{today}</p>
        </div>

        <div className="bg-gray-800 rounded-2xl border border-gray-700 overflow-hidden">

          {/* Unit roster */}
          <div className="px-6 py-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="text-gray-400 text-xs uppercase tracking-wider">Unit Roster</div>
                {units.length > 0 && (
                  <span className="text-gray-500 text-xs">
                    {inServiceCount} in service{outServiceCount > 0 ? `, ${outServiceCount} out` : ''}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {outServiceCount > 0 && (
                  <button
                    onClick={setAllInService}
                    className="text-xs px-2.5 py-1.5 bg-green-900/60 hover:bg-green-800/60 text-green-300 border border-green-700 rounded-lg transition-colors"
                  >
                    ✓ All In Service
                  </button>
                )}
                {!addingUnit && (
                  <button
                    onClick={() => { setAddingUnit(true); setNewPreset(null); setAddError(''); }}
                    className="text-xs px-3 py-1.5 bg-green-800 hover:bg-green-700 text-green-300 rounded-lg font-medium transition-colors"
                  >
                    + Add Unit
                  </button>
                )}
              </div>
            </div>

            {/* Add unit panel */}
            {addingUnit && (
              <div className="mb-4 rounded-xl border border-green-700 bg-gray-750 p-4">
                {/* Step 1: preset picker */}
                {!newPreset && (
                  <>
                    <div className="text-green-400 text-xs font-semibold uppercase tracking-wider mb-3">What type of unit?</div>
                    <div className="grid grid-cols-4 gap-2">
                      {UNIT_PRESETS.map(p => (
                        <button
                          key={p.key}
                          onClick={() => selectPreset(p)}
                          className="py-3 rounded-xl bg-gray-700 hover:bg-gray-600 border border-gray-600 hover:border-green-600 text-white font-bold text-sm transition-all"
                        >
                          {p.key === 'Medic' ? '🚑' : p.key === 'Cart' ? '🛺' : p.key === '555' ? '🚒' : '➕'}
                          <div className="text-xs mt-1">{p.key}</div>
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={cancelAdd}
                      className="w-full mt-3 py-2 text-gray-500 hover:text-gray-300 text-sm transition-colors"
                    >
                      Cancel
                    </button>
                  </>
                )}

                {/* Step 2: name + confirm */}
                {newPreset && (
                  <>
                    <div className="flex items-center gap-2 mb-3">
                      <button onClick={() => { setNewPreset(null); setAddError(''); }}
                        className="text-gray-500 hover:text-gray-300 text-sm transition-colors">←</button>
                      <div className="text-green-400 text-xs font-semibold uppercase tracking-wider">
                        {newPreset === 'Other' ? 'New Unit' : `Adding ${newNumber}`}
                      </div>
                    </div>

                    <div className="space-y-3">
                      {/* Unit number — editable for every preset, not just Other, so
                          e.g. a Cart can be named "Dash" or "Big Red" instead of
                          being stuck with the auto-suggested "Cart N". */}
                      <div>
                        <label className="block text-gray-500 text-xs mb-1">Unit Number</label>
                        <div className="flex gap-2 items-center">
                          <input
                            type="text"
                            value={newNumber}
                            onChange={e => setNewNumber(e.target.value)}
                            placeholder="e.g. Medic 3, Dash"
                            autoFocus={newPreset === 'Other' || newType === 'Cart'}
                            className="flex-1 bg-gray-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-500 placeholder-gray-500"
                          />
                          {newPreset === 'Other' && (
                            <div className="flex gap-1 flex-shrink-0">
                              {UNIT_TYPES.map(t => (
                                <button key={t} onClick={() => setNewType(t)}
                                  className={`px-2.5 py-2 rounded-lg text-xs font-bold transition-colors
                                    ${newType === t
                                      ? (t === 'ALS' ? 'bg-red-600 text-white' : t === 'BLS' ? 'bg-blue-600 text-white' : 'bg-green-700 text-white')
                                      : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}>
                                  {t}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Medic name — skip for Cart */}
                      {newType !== 'Cart' && (
                        <div>
                          <label className="block text-gray-500 text-xs mb-1">Medic Name</label>
                          <input
                            ref={nameInputRef}
                            type="text"
                            value={newCrew}
                            onChange={e => setNewCrew(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleAddUnit(); if (e.key === 'Escape') cancelAdd(); }}
                            placeholder="Who's on this unit?"
                            autoFocus={newPreset !== 'Other'}
                            className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-500 placeholder-gray-500"
                          />
                        </div>
                      )}
                    </div>

                    {addError && <p className="text-red-400 text-xs mt-2">{addError}</p>}

                    <div className="flex gap-2 mt-3">
                      <button onClick={cancelAdd}
                        className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded-lg transition-colors">
                        Cancel
                      </button>
                      <button onClick={handleAddUnit} disabled={addSaving}
                        className="flex-1 py-2 bg-green-700 hover:bg-green-600 disabled:bg-green-900 text-white font-semibold text-sm rounded-lg transition-colors">
                        {addSaving ? 'Adding…' : 'Add'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {units.length === 0 && !addingUnit && (
              <div className="text-center py-8 text-gray-500 text-sm">
                No units yet — click <span className="text-green-400 font-medium">+ Add Unit</span> to build your roster
              </div>
            )}

            <div className="space-y-3">
              {sortedUnits.map(u => {
                const s          = staffing[u.id] || {};
                const inService  = s.in_service ?? true;
                const activeType = s.unit_type || u.unit_type;
                const isCart     = activeType === 'Cart';
                return (
                  <div key={u.id}
                    className={`rounded-xl border transition-all ${inService ? 'border-gray-600 bg-gray-750' : 'border-gray-700 bg-gray-800/50'}`}>

                    <div className="flex items-center gap-3 p-4">
                      <span className="text-xl flex-shrink-0">{TYPE_ICONS[activeType] || '🚑'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-white font-bold text-sm">{u.unit_number}</div>
                        {!inService && (
                          <div className="text-gray-600 text-xs">Out of service</div>
                        )}
                      </div>
                      <button
                        onClick={() => updateStaffing(u.id, 'in_service', !inService)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors flex-shrink-0
                          ${inService ? 'bg-green-800 text-green-300' : 'bg-gray-700 text-gray-500 hover:bg-gray-600 hover:text-gray-300'}`}>
                        <div className={`w-2 h-2 rounded-full ${inService ? 'bg-green-400' : 'bg-gray-600'}`} />
                        {inService ? 'In Service' : 'Out of Service'}
                      </button>
                      <button
                        onClick={() => handleRemoveUnit(u.id)}
                        className="text-gray-600 hover:text-red-400 text-lg leading-none transition-colors flex-shrink-0"
                        title="Remove unit">
                        ×
                      </button>
                    </div>

                    {inService && (
                      <div className="px-4 pb-4 space-y-3 border-t border-gray-700 pt-3">
                        <div className="flex gap-3 items-start">
                          {!isCart && (
                            <div className="flex-1">
                              <label className="block text-gray-500 text-xs mb-1">Medic Name</label>
                              <input
                                type="text"
                                value={s.crew || ''}
                                onChange={e => updateStaffing(u.id, 'crew', e.target.value)}
                                placeholder="Medic name…"
                                className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
                              />
                            </div>
                          )}
                          <div className="flex-shrink-0">
                            <label className="block text-gray-500 text-xs mb-1">Level</label>
                            <div className="flex gap-1">
                              {UNIT_TYPES.map(t => (
                                <button key={t} onClick={() => updateStaffing(u.id, 'unit_type', t)}
                                  className={`px-2.5 py-2 rounded-lg text-xs font-bold transition-colors
                                    ${activeType === t
                                      ? (t === 'ALS' ? 'bg-red-600 text-white' : t === 'BLS' ? 'bg-blue-600 text-white' : 'bg-green-700 text-white')
                                      : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}>
                                  {t}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div>
                          <label className="block text-gray-500 text-xs mb-1">Based out of</label>
                          <div className="flex gap-1 flex-wrap">
                            {STATIONS.map(st => (
                              <button key={st}
                                onClick={() => updateStaffing(u.id, 'station', s.station === st ? '' : st)}
                                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors
                                  ${s.station === st
                                    ? 'bg-indigo-600 text-white'
                                    : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}>
                                {st}
                              </button>
                            ))}
                          </div>
                        </div>

                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-5 border-t border-gray-700">
            {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

            {uncrewedWarning && (
              <div className="mb-4 rounded-xl border border-yellow-700 bg-yellow-900/20 p-4">
                <div className="text-yellow-300 font-semibold text-sm mb-1">⚠ Some units have no medic assigned</div>
                <div className="text-yellow-400/80 text-xs mb-3">
                  {uncrewedWarning.join(', ')} {uncrewedWarning.length === 1 ? 'has' : 'have'} no medic name set.
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setUncrewedWarning(null)}
                    className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded-lg transition-colors"
                  >
                    Go Back
                  </button>
                  <button
                    onClick={doStart}
                    disabled={saving}
                    className="flex-1 py-2 bg-yellow-700 hover:bg-yellow-600 disabled:bg-yellow-900 text-white font-semibold text-sm rounded-lg transition-colors"
                  >
                    {saving ? 'Starting…' : 'Start Anyway'}
                  </button>
                </div>
              </div>
            )}

            {!uncrewedWarning && (
              <button
                onClick={handleStart}
                disabled={saving}
                className="w-full py-3.5 bg-green-700 hover:bg-green-600 disabled:bg-green-900 text-white font-bold text-lg rounded-xl transition-colors"
              >
                {saving ? 'Starting shift…' : `▶ Start Shift — ${inServiceCount} unit${inServiceCount !== 1 ? 's' : ''} in service`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
