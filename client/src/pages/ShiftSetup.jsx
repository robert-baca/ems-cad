import { useState, useEffect } from 'react';

const TYPE_ICONS   = { ALS: '🚑', BLS: '🚐', Bike: '🚲', Cart: '🛺' };
const UNIT_TYPES   = ['ALS', 'BLS', 'Bike', 'Cart'];
const SHIFT_LABELS = ['Day Shift', 'Evening Shift', 'Night Shift'];
const STATIONS     = ['Station 7', 'Station 14', 'Roaming', 'Lead Medic'];

export default function ShiftSetup({ token, onShiftStarted }) {
  const [units,        setUnits]       = useState([]);
  const [shiftLabel,   setShiftLabel]  = useState('Day Shift');
  const [customLabel,  setCustomLabel] = useState('');
  const [staffing,     setStaffing]    = useState({});
  const [saving,       setSaving]      = useState(false);
  const [error,        setError]       = useState('');

  useEffect(() => {
    fetch('/api/units')
      .then(r => r.json())
      .then(data => {
        if (!Array.isArray(data)) return;
        setUnits(data);
        const initial = {};
        data.forEach(u => {
          initial[u.id] = { crew: u.crew || '', unit_type: u.unit_type, in_service: u.status !== 'out_of_service', station: u.station || '' };
        });
        setStaffing(initial);
      })
      .catch(() => {});
  }, []);

  const updateStaffing = (unit_id, field, value) => {
    setStaffing(prev => ({ ...prev, [unit_id]: { ...prev[unit_id], [field]: value } }));
  };

  const handleStart = async () => {
    const label = shiftLabel === 'Custom' ? customLabel.trim() : shiftLabel;
    if (!label) { setError('Enter a shift name.'); return; }
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
          {/* Shift label */}
          <div className="px-6 py-5 border-b border-gray-700">
            <div className="text-gray-400 text-xs uppercase tracking-wider mb-3">Shift</div>
            <div className="flex flex-wrap gap-2">
              {SHIFT_LABELS.map(l => (
                <button key={l} onClick={() => setShiftLabel(l)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors
                    ${shiftLabel === l ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                  {l}
                </button>
              ))}
              <button onClick={() => setShiftLabel('Custom')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors
                  ${shiftLabel === 'Custom' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                Custom…
              </button>
            </div>
            {shiftLabel === 'Custom' && (
              <input type="text" value={customLabel} onChange={e => setCustomLabel(e.target.value)}
                placeholder="e.g. Holiday Shift, Overtime…"
                autoFocus
                className="mt-3 w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500" />
            )}
          </div>

          {/* Unit roster */}
          <div className="px-6 py-4">
            <div className="text-gray-400 text-xs uppercase tracking-wider mb-4">Unit Roster</div>
            <div className="space-y-3">
              {units.map(u => {
                const s          = staffing[u.id] || {};
                const inService  = s.in_service ?? true;
                const activeType = s.unit_type || u.unit_type;
                return (
                  <div key={u.id}
                    className={`rounded-xl border p-4 transition-all ${inService ? 'border-gray-600 bg-gray-750' : 'border-gray-700 bg-gray-800 opacity-50'}`}>
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-xl">{TYPE_ICONS[u.unit_type] || '🚑'}</span>
                      <div className="flex-1">
                        <div className="text-white font-bold text-sm">{u.unit_number}</div>
                        <div className="text-gray-500 text-xs">{u.unit_name}</div>
                      </div>
                      {/* In-service toggle */}
                      <button onClick={() => updateStaffing(u.id, 'in_service', !inService)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors
                          ${inService ? 'bg-green-800 text-green-300' : 'bg-gray-700 text-gray-500'}`}>
                        <div className={`w-2 h-2 rounded-full ${inService ? 'bg-green-400' : 'bg-gray-600'}`} />
                        {inService ? 'In Service' : 'Out of Service'}
                      </button>
                    </div>

                    {inService && (
                      <div className="space-y-2">
                        <div className="flex gap-3 items-start">
                          {/* Crew name */}
                          <div className="flex-1">
                            <label className="block text-gray-500 text-xs mb-1">Crew / Medic</label>
                            <input
                              type="text"
                              value={s.crew || ''}
                              onChange={e => updateStaffing(u.id, 'crew', e.target.value)}
                              placeholder="Name or names…"
                              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
                            />
                          </div>
                          {/* Unit type */}
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
                        {/* Based out of */}
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
