import { useState, useEffect } from 'react';
import { apiBase } from '../lib/native';

const TYPE_ICONS  = { ALS: '🚑', BLS: '🚐', Cart: '🛺' };
const TYPE_ORDER  = { ALS: 0, BLS: 1, Cart: 2 };
const UNIT_TYPES  = ['ALS', 'BLS', 'Cart'];
const STATIONS    = ['Station 7', 'Station 14', 'Roaming'];
const TIME_PRESETS = [
  { label: 'Day  07–15',  start: '07:00', end: '15:00' },
  { label: 'Eve  15–23',  start: '15:00', end: '23:00' },
  { label: 'Night 23–07', start: '23:00', end: '07:00' },
];

export default function ShiftSetup({ token, onShiftStarted, onViewHistory }) {
  const [units,    setUnits]    = useState([]);
  const [startTime, setStartTime] = useState('07:00');
  const [endTime,   setEndTime]   = useState('15:00');
  const [staffing,  setStaffing]  = useState({});
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');
  const [uncrewedWarning, setUncrewedWarning] = useState(null); // list of unit numbers needing confirmation

  // GPS tracker edit state — only one unit open at a time
  const [editingGpsId, setEditingGpsId] = useState(null);

  // Add unit inline form
  const [addingUnit, setAddingUnit] = useState(false);
  const [newNumber,  setNewNumber]  = useState('');
  const [newType,    setNewType]    = useState('ALS');
  const [addError,   setAddError]   = useState('');
  const [addSaving,  setAddSaving]  = useState(false);

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
            tracki_device_id: u.tracki_device_id || '',
          };
        });
        setStaffing(initial);
      })
      .catch(() => {});
  }, [token]);

  const updateStaffing = (unit_id, field, value) =>
    setStaffing(prev => ({ ...prev, [unit_id]: { ...prev[unit_id], [field]: value } }));

  const handleDeviceChange = async (unit_id, device_id) => {
    updateStaffing(unit_id, 'tracki_device_id', device_id);
    await fetch(`${apiBase()}/units/${unit_id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ tracki_device_id: device_id || null })
    }).catch(() => {});
  };

  const setAllInService = () =>
    setStaffing(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(id => { next[id] = { ...next[id], in_service: true }; });
      return next;
    });

  const handleAddUnit = async () => {
    if (!newNumber.trim()) { setAddError('Enter a unit number.'); return; }
    setAddSaving(true);
    setAddError('');
    try {
      const res = await fetch(`${apiBase()}/units`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ unit_number: newNumber.trim(), unit_name: newNumber.trim(), unit_type: newType })
      });
      const unit = await res.json();
      if (!res.ok) throw new Error(unit.error || 'Failed to add unit');
      setUnits(prev => [...prev, unit]);
      setStaffing(prev => ({ ...prev, [unit.id]: { crew: '', unit_type: newType, in_service: true, station: '', tracki_device_id: '' } }));
      setNewNumber('');
      setNewType('ALS');
      setAddingUnit(false);
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
    const label = `${startTime} – ${endTime || '?'}`;
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
    if (!startTime) { setError('Enter a start time.'); return; }
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

  // Sort: ALS → BLS → Cart, then alphabetically by unit number
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

          {/* Shift times */}
          <div className="px-6 py-5 border-b border-gray-700">
            <div className="text-gray-400 text-xs uppercase tracking-wider mb-3">Shift Hours</div>

            {/* Presets */}
            <div className="flex gap-2 mb-3">
              {TIME_PRESETS.map(p => (
                <button
                  key={p.label}
                  onClick={() => { setStartTime(p.start); setEndTime(p.end); }}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-lg border-2 transition-all
                    ${startTime === p.start && endTime === p.end
                      ? 'bg-blue-700 border-blue-500 text-white'
                      : 'bg-gray-700 border-gray-600 text-gray-400 hover:border-gray-400 hover:text-gray-200'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="block text-gray-500 text-xs mb-1">Start Time</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={e => { setStartTime(e.target.value); }}
                  className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="text-gray-500 text-sm mt-4">–</div>
              <div className="flex-1">
                <label className="block text-gray-500 text-xs mb-1">End Time</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={e => setEndTime(e.target.value)}
                  className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

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
                    title="Mark all units as In Service"
                  >
                    ✓ All In Service
                  </button>
                )}
                <button
                  onClick={() => { setAddingUnit(true); setAddError(''); }}
                  className="text-xs px-3 py-1.5 bg-green-800 hover:bg-green-700 text-green-300 rounded-lg font-medium transition-colors"
                >
                  + Add Unit
                </button>
              </div>
            </div>

            {/* Inline add unit form */}
            {addingUnit && (
              <div className="mb-4 rounded-xl border border-green-700 bg-gray-750 p-4">
                <div className="text-green-400 text-xs font-semibold uppercase tracking-wider mb-3">New Unit</div>
                <div className="flex gap-3 items-end">
                  <div className="flex-1">
                    <label className="block text-gray-500 text-xs mb-1">Unit Number</label>
                    <input
                      type="text"
                      value={newNumber}
                      onChange={e => setNewNumber(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleAddUnit(); if (e.key === 'Escape') setAddingUnit(false); }}
                      placeholder="e.g. Medic 1, Cart 1"
                      autoFocus
                      className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-500 placeholder-gray-500"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-500 text-xs mb-1">Type</label>
                    <div className="flex gap-1">
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
                  </div>
                </div>
                {addError && <p className="text-red-400 text-xs mt-2">{addError}</p>}
                <div className="flex gap-2 mt-3">
                  <button onClick={() => { setAddingUnit(false); setNewNumber(''); setAddError(''); }}
                    className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded-lg transition-colors">
                    Cancel
                  </button>
                  <button onClick={handleAddUnit} disabled={addSaving}
                    className="flex-1 py-2 bg-green-700 hover:bg-green-600 disabled:bg-green-900 text-white font-semibold text-sm rounded-lg transition-colors">
                    {addSaving ? 'Adding…' : 'Add'}
                  </button>
                </div>
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

                    {/* Unit header row */}
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

                    {/* Editable fields — only when in service */}
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

                        {/* GPS Tracker — collapsed unless opened */}
                        {editingGpsId === u.id ? (
                          <div className="flex gap-2 items-end">
                            <div className="flex-1">
                              <label className="block text-gray-500 text-xs mb-1">GPS Device ID</label>
                              <input
                                autoFocus
                                type="text"
                                value={s.tracki_device_id || ''}
                                onChange={e => updateStaffing(u.id, 'tracki_device_id', e.target.value)}
                                onBlur={e => handleDeviceChange(u.id, e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') { handleDeviceChange(u.id, s.tracki_device_id || ''); setEditingGpsId(null); } }}
                                placeholder="Tracki IMEI / Device ID"
                                className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500 font-mono"
                              />
                            </div>
                            <button
                              onClick={() => { handleDeviceChange(u.id, s.tracki_device_id || ''); setEditingGpsId(null); }}
                              className="py-2 px-3 bg-blue-700 hover:bg-blue-600 text-white text-xs font-semibold rounded-lg transition-colors flex-shrink-0">
                              Done
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setEditingGpsId(u.id)}
                            className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-300 transition-colors group"
                          >
                            <span>📡</span>
                            <span>
                              {s.tracki_device_id
                                ? <span className="font-mono text-gray-400">{s.tracki_device_id}</span>
                                : <span className="text-gray-600 group-hover:text-gray-400">Set GPS tracker…</span>
                              }
                            </span>
                            <span className="text-gray-700 group-hover:text-gray-500 text-[10px]">✏</span>
                          </button>
                        )}
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

            {/* Inline uncrewed warning — replaces window.confirm */}
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
