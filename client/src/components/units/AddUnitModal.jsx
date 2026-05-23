import { useState } from 'react';

const UNIT_TYPES = ['ALS', 'BLS', 'Bike', 'Cart'];

export default function AddUnitModal({ onAdd, onClose }) {
  const [unitNumber, setUnitNumber] = useState('');
  const [unitName,   setUnitName]   = useState('');
  const [unitType,   setUnitType]   = useState('ALS');
  const [deviceId,   setDeviceId]   = useState('');
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState('');

  const handleSave = async () => {
    if (!unitNumber.trim()) { setError('Unit number is required.'); return; }
    if (!unitName.trim())   { setError('Unit name is required.');   return; }
    setSaving(true);
    setError('');
    try {
      await onAdd({
        unit_number:     unitNumber.trim(),
        unit_name:       unitName.trim(),
        unit_type:       unitType,
        trak4_device_id: deviceId.trim() || null
      });
      onClose();
    } catch {
      setError('Failed to add unit. Try again.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-2xl w-full max-w-sm shadow-2xl border border-gray-700">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <div className="text-white font-bold">Add Unit</div>
          <button onClick={onClose}
            className="text-gray-400 hover:text-white w-8 h-8 flex items-center justify-center rounded hover:bg-gray-700 text-xl">
            ×
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-gray-400 text-xs uppercase tracking-wider mb-1.5">Unit Number</label>
            <input
              type="text"
              value={unitNumber}
              onChange={e => setUnitNumber(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              placeholder="e.g. EMS-6"
              autoFocus
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
            />
          </div>

          <div>
            <label className="block text-gray-400 text-xs uppercase tracking-wider mb-1.5">Unit Name</label>
            <input
              type="text"
              value={unitName}
              onChange={e => setUnitName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              placeholder="e.g. Medic 6"
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
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
              Trak-4 Device ID <span className="text-gray-600 normal-case">(optional)</span>
            </label>
            <input
              type="text"
              value={deviceId}
              onChange={e => setDeviceId(e.target.value)}
              placeholder="e.g. T4-123456"
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500 font-mono"
            />
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>

        <div className="px-5 py-4 border-t border-gray-700 flex gap-3">
          <button onClick={onClose}
            className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded-lg transition-colors">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 py-2.5 bg-green-700 hover:bg-green-600 disabled:bg-green-900 text-white font-semibold text-sm rounded-lg transition-colors">
            {saving ? 'Adding…' : 'Add Unit'}
          </button>
        </div>
      </div>
    </div>
  );
}
