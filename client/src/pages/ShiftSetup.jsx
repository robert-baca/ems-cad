import { useState, useEffect } from 'react';

const TYPE_ICONS = { ALS: '🚑', BLS: '🚐', Cart: '🛺' };
const UNIT_TYPES = ['ALS', 'BLS', 'Cart'];
const STATIONS   = ['Station 7', 'Station 14', 'Roaming'];

export default function ShiftSetup({ token, onShiftStarted }) {
  const [units,        setUnits]       = useState([]);
  const [startTime,    setStartTime]   = useState('07:00');
  const [endTime,      setEndTime]     = useState('15:00');
  const [staffing,     setStaffing]    = useState({});
  const [saving,       setSaving]      = useState(false);
  const [error,        setError]       = useState('');
  const [trak4Devices, setTrak4Devices] = useState([]);

  // Add unit inline form
  const [addingUnit,  setAddingUnit]  = useState(false);
  const [newNumber,   setNewNumber]   = useState('');
  const [newType,     setNewType]     = useState('ALS');
  const [addError,    setAddError]    = useState('');
  const [addSaving,   setAddSaving]   = useState(false);

  useEffect(() => {
    fetch('/api/units')
      .then(r => r.json())
      .then(data => {
        if (!Array.isArray(data)) return;
        setUnits(data);
        const initial = {};
        data.forEach(u => {
          initial[u.id] = { crew: u.crew || '', unit_type: u.unit_type, in_service: u.status !== 'out_of_service', station: u.station || '', trak4_device_id: u.trak4_device_id || '' };
        });
        setStaffing(initial);
      })
      .catch(() => {});

    fetch('/api/trak4/devices', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.devices) setTrak4Devices(data.devices); })
      .catch(() => {});
  }, [token]);

  const handleDeviceChange = async (unit_id, device_id) => {
    updateStaffing(unit_id, 'trak4_device_id', device_id);
    await fetch(`/api/units/${unit_id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ trak4_device_id: device_id || null })
    }).catch(() => {});
  };

  const updateStaffing = (unit_id, field, value) => {
    setStaffing(prev => ({ ...prev, [unit_id]: { ...prev[unit_id], [field]: value } }));
  };

  const handleAddUnit = async () => {
    if (!newNumber.trim()) { setAddError('Enter a unit number.'); return; }
    setAddSaving(true);
    setAddError('');
    try {
      const res = await fetch('/api/units', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ unit_number: newNumber.trim(), unit_name: newNumber.trim(), unit_type: newType })
      });
      const unit = await res.json();
      if (!res.ok) throw new Error(unit.error || 'Failed to add unit');
      setUnits(prev => [...prev, unit]);
      setStaffing(prev => ({ ...prev, [unit.id]: { crew: '', unit_type: newType, in_service: true, station: '' } }));
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
  };

  const handleStart = async () => {
    if (!startTime) { setError('Enter a start time.'); return; }
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
      const res  = await fetch('/api/shift/start', {
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

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="fixed inset-0 bg-gray-900 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="text-4xl mb-2">🚑</div>
          <h1 className="text-2xl font-bold text-white">Start Shift</h1>
          <p className="text-gray-400 text-sm mt-1">{today}</p>
        </div>

        <div className="bg-gray-800 rounded-2xl border border-gray-700 overflow-hidden">
          {/* Shift times */}
          <div className="px-6 py-5 border-b border-gray-700">
            <div className="text-gray-400 text-xs uppercase tracking-wider mb-3">Shift Hours</div>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="block text-gray-500 text-xs mb-1">Start Time</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={e => setStartTime(e.target.value)}
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
            <div className="flex items-center justify-between mb-4">
              <div className="text-gray-400 text-xs uppercase tracking-wider">Unit Roster</div>
              <button
                onClick={() => { setAddingUnit(true); setAddError(''); }}
                className="text-xs px-3 py-1.5 bg-green-800 hover:bg-green-700 text-green-300 rounded-lg font-medium transition-colors"
              >
                + Add Unit
              </button>
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
              {units.map(u => {
                const s          = staffing[u.id] || {};
                const inService  = s.in_service ?? true;
                const activeType = s.unit_type || u.unit_type;
                return (
                  <div key={u.id}
                    className={`rounded-xl border p-4 transition-all ${inService ? 'border-gray-600 bg-gray-750' : 'border-gray-700 bg-gray-800 opacity-50'}`}>
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-xl">{TYPE_ICONS[activeType] || '🚑'}</span>
                      <div className="flex-1">
                        <div className="text-white font-bold text-sm">{u.unit_number}</div>
                      </div>
                      <button onClick={() => updateStaffing(u.id, 'in_service', !inService)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors
                          ${inService ? 'bg-green-800 text-green-300' : 'bg-gray-700 text-gray-500'}`}>
                        <div className={`w-2 h-2 rounded-full ${inService ? 'bg-green-400' : 'bg-gray-600'}`} />
                        {inService ? 'In Service' : 'Out of Service'}
                      </button>
                      <button onClick={() => handleRemoveUnit(u.id)}
                        className="text-gray-600 hover:text-red-400 text-lg leading-none transition-colors"
                        title="Remove unit">
                        ×
                      </button>
                    </div>

                    {inService && (
                      <div className="space-y-2">
                        <div className="flex gap-3 items-start">
                          {activeType !== 'Cart' && (
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
                          <div>
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
                              <button key={st} onClick={() => updateStaffing(u.id, 'station', s.station === st ? '' : st)}
                                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors
                                  ${s.station === st
                                    ? 'bg-indigo-600 text-white'
                                    : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}>
                                {st}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className="block text-gray-500 text-xs mb-1">GPS Tracker</label>
                          {trak4Devices.length > 0 ? (
                            <select
                              value={s.trak4_device_id || ''}
                              onChange={e => handleDeviceChange(u.id, e.target.value)}
                              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                            >
                              <option value="">— None —</option>
                              {trak4Devices.map(d => (
                                <option key={d.device_id} value={d.device_id}>
                                  {d.label} ({d.device_id})
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type="text"
                              value={s.trak4_device_id || ''}
                              onChange={e => handleDeviceChange(u.id, e.target.value)}
                              placeholder="Device ID (e.g. 185401)"
                              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500 font-mono"
                            />
                          )}
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
            <button onClick={handleStart} disabled={saving}
              className="w-full py-3.5 bg-green-700 hover:bg-green-600 disabled:bg-green-900 text-white font-bold text-lg rounded-xl transition-colors">
              {saving ? 'Starting shift…' : '▶ Start Shift'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
