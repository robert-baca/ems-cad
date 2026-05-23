import { useState, useEffect } from 'react';
import { CALL_TYPES } from '../../data/mockData';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&types=poi,address&limit=1`
    );
    const json = await res.json();
    return json.features?.[0]?.place_name || '';
  } catch {
    return '';
  }
}

export default function NewCallModal({ pin, units, onDispatch, onClose }) {
  const [form, setForm] = useState({
    call_type: '',
    chief_complaint: '',
    priority: 2,
    location_name: '',
    park_zone: '',
    assigned_unit_id: ''
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (pin) {
      reverseGeocode(pin.lat, pin.lng).then(name => {
        setForm(f => ({ ...f, location_name: name }));
      });
    }
  }, [pin]);

  const set = (field, val) => setForm(f => ({ ...f, [field]: val }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.call_type) return;
    setLoading(true);
    await onDispatch({
      ...form,
      location_lat: pin?.lat,
      location_lng: pin?.lng,
      priority: Number(form.priority)
    });
    setLoading(false);
    onClose();
  };

  const TYPE_ICONS = { ALS: '🚑', BLS: '🚐', Cart: '🛺' };

  const availableUnits = units.filter(u =>
    u.status === 'available' || u.status === 'cleared'
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-gray-800 rounded-2xl w-full max-w-md shadow-2xl border border-gray-700">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-white font-bold text-lg">🚨 New Call</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white w-8 h-8 flex items-center justify-center rounded hover:bg-gray-700 text-xl"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Pin location */}
          {pin && (
            <div className="bg-gray-700 rounded-lg px-3 py-2 flex items-center gap-2">
              <span className="text-yellow-400">📍</span>
              <div className="min-w-0">
                <div className="text-white text-xs font-mono">
                  {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}
                </div>
                {form.location_name && (
                  <div className="text-gray-400 text-xs truncate">{form.location_name}</div>
                )}
              </div>
            </div>
          )}

          {/* Location note + Zone */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-gray-400 text-xs mb-1">Location Note</label>
              <input
                type="text"
                value={form.location_name}
                onChange={e => set('location_name', e.target.value)}
                placeholder="Near Titan ride entrance"
                className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
              />
            </div>
            <div className="w-28">
              <label className="block text-gray-400 text-xs mb-1">Zone</label>
              <select
                value={form.park_zone}
                onChange={e => set('park_zone', e.target.value)}
                className="w-full bg-gray-700 text-white rounded-lg px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">—</option>
                {['Zone A', 'Zone B', 'Zone C', 'Zone D', 'Zone E'].map(z => (
                  <option key={z} value={z}>{z}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Call type */}
          <div>
            <label className="block text-gray-400 text-xs mb-1">Call Type *</label>
            <select
              required
              value={form.call_type}
              onChange={e => set('call_type', e.target.value)}
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select type…</option>
              {CALL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {/* Chief complaint */}
          <div>
            <label className="block text-gray-400 text-xs mb-1">Chief Complaint</label>
            <textarea
              value={form.chief_complaint}
              onChange={e => set('chief_complaint', e.target.value)}
              rows={2}
              placeholder="Brief description…"
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500 resize-none"
            />
          </div>

          {/* Priority */}
          <div>
            <label className="block text-gray-400 text-xs mb-2">Priority</label>
            <div className="flex gap-2">
              {[
                { val: 1, label: 'P1 Critical', color: 'bg-red-600 border-red-500' },
                { val: 2, label: 'P2 Urgent',   color: 'bg-orange-600 border-orange-500' },
                { val: 3, label: 'P3 Routine',  color: 'bg-blue-700 border-blue-500' }
              ].map(({ val, label, color }) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => set('priority', val)}
                  className={`flex-1 py-2 text-xs font-semibold rounded-lg border-2 transition-all
                    ${form.priority === val ? color + ' text-white' : 'bg-gray-700 border-gray-600 text-gray-400 hover:border-gray-500'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Assign unit */}
          <div>
            <label className="block text-gray-400 text-xs mb-1">Assign Unit</label>
            <select
              value={form.assigned_unit_id}
              onChange={e => set('assigned_unit_id', e.target.value)}
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Unassigned</option>
              {availableUnits.map(u => (
                <option key={u.id} value={u.id}>
                  {TYPE_ICONS[u.unit_type] || '🚑'} {u.unit_number} ({u.unit_type})
                </option>
              ))}
            </select>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading || !form.call_type}
            className="w-full py-3 bg-red-600 hover:bg-red-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold rounded-xl text-sm transition-colors"
          >
            {loading ? 'Dispatching…' : '🚨 DISPATCH'}
          </button>
        </form>
      </div>
    </div>
  );
}
