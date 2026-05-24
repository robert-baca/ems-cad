import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';

const UNIT_TYPES = ['ALS', 'BLS', 'Cart'];

export default function EditUnitModal({ unit, onSave, onDelete, onClose }) {
  const { user } = useAuth();
  const [unitNumber,   setUnitNumber]  = useState(unit.unit_number);
  const [unitName,     setUnitName]    = useState(unit.unit_name);
  const [unitType,     setUnitType]    = useState(unit.unit_type);
  const [deviceId,     setDeviceId]    = useState(unit.trak4_device_id || '');
  const [password,     setPassword]    = useState('');
  const [saving,      setSaving]     = useState(false);
  const [confirming,  setConfirming] = useState(false);
  const [error,       setError]      = useState('');
  const [trak4Devices, setTrak4Devices] = useState([]);

  useEffect(() => {
    fetch('/api/trak4/devices', { headers: { Authorization: `Bearer ${user?.token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.devices) setTrak4Devices(data.devices); })
      .catch(() => {});
  }, [user?.token]);

  const handleSave = async () => {
    if (!unitNumber.trim()) { setError('Unit number is required.'); return; }
    if (!unitName.trim())   { setError('Unit name is required.');   return; }
    setSaving(true);
    setError('');
    try {
      const data = {
        unit_number:      unitNumber.trim(),
        unit_name:        unitName.trim(),
        unit_type:        unitType,
        trak4_device_id:  deviceId.trim() || null
      };
      if (password) data.password = password;
      await onSave(unit.id, data);
      onClose();
    } catch {
      setError('Failed to save. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    try {
      await onDelete(unit.id);
      onClose();
    } catch {
      setError('Failed to remove unit.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-2xl w-full max-w-sm shadow-2xl border border-gray-700">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <div className="text-white font-bold">Edit Unit</div>
          <button onClick={onClose}
            className="text-gray-400 hover:text-white w-8 h-8 flex items-center justify-center rounded hover:bg-gray-700 text-xl">
            ×
          </button>
        </div>

        {/* Form */}
        {!confirming ? (
          <>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-gray-400 text-xs uppercase tracking-wider mb-1.5">Unit Number</label>
                <input
                  type="text"
                  value={unitNumber}
                  onChange={e => setUnitNumber(e.target.value)}
                  className="w-full bg-gray-700 text-white rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-gray-400 text-xs uppercase tracking-wider mb-1.5">Unit Name</label>
                <input
                  type="text"
                  value={unitName}
                  onChange={e => setUnitName(e.target.value)}
                  className="w-full bg-gray-700 text-white rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-gray-400 text-xs uppercase tracking-wider mb-1.5">Unit Type</label>
                <div className="grid grid-cols-4 gap-2">
                  {UNIT_TYPES.map(t => (
                    <button key={t} type="button" onClick={() => setUnitType(t)}
                      className={`py-2 rounded-lg text-sm font-medium transition-colors
                        ${unitType === t ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-gray-400 text-xs uppercase tracking-wider mb-1.5">
                  Trak-4 Device <span className="text-gray-600 normal-case">(GPS tracker)</span>
                </label>
                {trak4Devices.length > 0 ? (
                  <select
                    value={deviceId}
                    onChange={e => setDeviceId(e.target.value)}
                    className="w-full bg-gray-700 text-white rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
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
                    value={deviceId}
                    onChange={e => setDeviceId(e.target.value)}
                    placeholder="e.g. 185401"
                    className="w-full bg-gray-700 text-white rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500 font-mono"
                  />
                )}
                {deviceId && (
                  <p className="text-green-400 text-xs mt-1">✓ GPS tracking enabled for this unit</p>
                )}
              </div>

              <div>
                <label className="block text-gray-400 text-xs uppercase tracking-wider mb-1.5">
                  New Password <span className="text-gray-600 normal-case">(leave blank to keep current)</span>
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-gray-700 text-white rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
                />
              </div>

              {error && <p className="text-red-400 text-sm">{error}</p>}
            </div>

            <div className="px-5 py-4 border-t border-gray-700 flex gap-2">
              <button
                onClick={() => setConfirming(true)}
                className="px-3 py-2.5 bg-red-900/50 hover:bg-red-800 text-red-400 hover:text-red-300 text-sm rounded-lg transition-colors border border-red-800"
              >
                Remove
              </button>
              <button onClick={onClose}
                className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded-lg transition-colors">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white font-semibold text-sm rounded-lg transition-colors">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </>
        ) : (
          /* Confirm delete */
          <div className="p-5 space-y-4">
            <div className="text-center">
              <div className="text-3xl mb-3">⚠️</div>
              <div className="text-white font-semibold mb-1">Remove {unit.unit_number}?</div>
              <div className="text-gray-400 text-sm">
                This will permanently remove <span className="text-white">{unit.unit_name}</span> from the system. Active calls assigned to this unit will remain but become unassigned.
              </div>
            </div>
            {error && <p className="text-red-400 text-sm text-center">{error}</p>}
            <div className="flex gap-2 pt-2">
              <button onClick={() => setConfirming(false)}
                className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded-lg transition-colors">
                Cancel
              </button>
              <button onClick={handleDelete} disabled={saving}
                className="flex-1 py-2.5 bg-red-700 hover:bg-red-600 disabled:bg-red-900 text-white font-semibold text-sm rounded-lg transition-colors">
                {saving ? 'Removing…' : 'Yes, Remove'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
