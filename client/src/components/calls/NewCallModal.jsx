import { useState } from 'react';
import { CALL_TYPES } from '../../data/mockData';

const TYPE_ICONS = { ALS: '🚑', BLS: '🚐', Cart: '🛺' };

const QUICK_TYPES = [
  'Cardiac Arrest', 'Chest Pain', 'Trauma', 'Syncope / Fainting',
  'Heat Illness', 'Laceration', 'Altered Mental Status', 'Allergic Reaction'
];

export default function NewCallModal({ pin, units, onDispatch, onClose, parentCallNumber }) {
  const [form, setForm] = useState({
    call_type:      '',
    chief_complaint: '',
    priority:       2,
    location_name:  '',
    response_mode:  'foot'   // 'foot' | 'cart'
  });
  const [selectedUnitIds, setSelectedUnitIds] = useState([]);  // all assigned units
  const [selectedCartId,  setSelectedCartId]  = useState('');  // cart picked when response_mode=cart
  const [loading, setLoading] = useState(false);

  const set = (field, val) => setForm(f => ({ ...f, [field]: val }));

  const availableUnits = units.filter(u => u.status === 'available' || u.status === 'cleared');
  const cartUnits      = availableUnits.filter(u => u.unit_type === 'Cart');
  const medicUnits     = availableUnits.filter(u => u.unit_type !== 'Cart');

  const toggleUnit = (id) => {
    setSelectedUnitIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.call_type) return;

    // Build unit assignment: if cart mode, the cart is primary; otherwise first medic selected
    let assigned_unit_id     = '';
    let additional_unit_ids  = [];

    if (form.response_mode === 'cart' && selectedCartId) {
      assigned_unit_id    = selectedCartId;
      additional_unit_ids = selectedUnitIds;  // any extra medics tagged along
    } else {
      const [first, ...rest] = selectedUnitIds;
      assigned_unit_id    = first || '';
      additional_unit_ids = rest;
    }

    setLoading(true);
    await onDispatch({
      ...form,
      assigned_unit_id,
      additional_unit_ids,
      location_lat: pin?.lat,
      location_lng: pin?.lng,
      priority:     Number(form.priority)
    });
    setLoading(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-gray-800 rounded-2xl w-full max-w-md shadow-2xl border border-gray-700 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-gray-700 flex-shrink-0">
          <h2 className="text-white font-bold text-lg">🚨 New Case</h2>
          <button onClick={onClose}
            className="text-gray-400 hover:text-white w-8 h-8 flex items-center justify-center rounded hover:bg-gray-700 text-xl">
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4 overflow-y-auto flex-1">
          {/* Parent case banner */}
          {parentCallNumber && (
            <div className="bg-blue-900/50 border border-blue-700 rounded-lg px-3 py-2 flex items-center gap-2">
              <span className="text-blue-300 text-xs font-semibold">🔗 Sub-case of Case #{parentCallNumber}</span>
            </div>
          )}

          {/* Pin location */}
          {pin && (
            <div className="bg-gray-700 rounded-lg px-3 py-2 flex items-center gap-2">
              <span className="text-yellow-400">📍</span>
              <span className="text-white text-xs font-mono">
                {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}
              </span>
            </div>
          )}

          {/* Location */}
          <div>
            <label className="block text-gray-400 text-xs mb-1">Location</label>
            <input
              type="text"
              value={form.location_name}
              onChange={e => set('location_name', e.target.value)}
              placeholder="e.g. Near Titan ride entrance…"
              autoFocus
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
            />
          </div>

          {/* Call type */}
          <div>
            <label className="block text-gray-400 text-xs mb-1.5">Call Type *</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {QUICK_TYPES.map(t => (
                <button key={t} type="button" onClick={() => set('call_type', t)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all
                    ${form.call_type === t
                      ? 'bg-red-700 border-red-500 text-white'
                      : 'bg-gray-700 border-gray-600 text-gray-300 hover:border-gray-400'}`}>
                  {t}
                </button>
              ))}
            </div>
            <select
              required
              value={form.call_type}
              onChange={e => set('call_type', e.target.value)}
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Other type…</option>
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
                <button key={val} type="button" onClick={() => set('priority', val)}
                  className={`flex-1 py-2 text-xs font-semibold rounded-lg border-2 transition-all
                    ${form.priority === val ? color + ' text-white' : 'bg-gray-700 border-gray-600 text-gray-400 hover:border-gray-500'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Response mode */}
          <div>
            <label className="block text-gray-400 text-xs mb-2">Response Mode</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => { set('response_mode', 'foot'); setSelectedCartId(''); }}
                className={`flex-1 py-2 text-xs font-semibold rounded-lg border-2 transition-all
                  ${form.response_mode === 'foot'
                    ? 'bg-green-700 border-green-500 text-white'
                    : 'bg-gray-700 border-gray-600 text-gray-400 hover:border-gray-500'}`}>
                🚶 On Foot
              </button>
              <button type="button" onClick={() => set('response_mode', 'cart')}
                className={`flex-1 py-2 text-xs font-semibold rounded-lg border-2 transition-all
                  ${form.response_mode === 'cart'
                    ? 'bg-yellow-700 border-yellow-500 text-white'
                    : 'bg-gray-700 border-gray-600 text-gray-400 hover:border-gray-500'}`}>
                🛺 Taking a Cart
              </button>
            </div>
          </div>

          {/* Cart selector — only when cart mode */}
          {form.response_mode === 'cart' && (
            <div>
              <label className="block text-gray-400 text-xs mb-1">Which Cart?</label>
              {cartUnits.length === 0 ? (
                <div className="bg-gray-700 rounded-lg px-3 py-2 text-yellow-400 text-xs">
                  No carts currently available
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {cartUnits.map(u => (
                    <button key={u.id} type="button"
                      onClick={() => setSelectedCartId(id => id === u.id ? '' : u.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border-2 transition-all
                        ${selectedCartId === u.id
                          ? 'bg-yellow-700 border-yellow-400 text-white'
                          : 'bg-gray-700 border-gray-600 text-gray-300 hover:border-gray-400'}`}>
                      🛺 {u.unit_number}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Unit assignment — multi-select toggle buttons */}
          <div>
            <label className="block text-gray-400 text-xs mb-1">
              {form.response_mode === 'cart' ? 'Assign Medics (optional)' : 'Assign Units'}
            </label>
            {medicUnits.length === 0 ? (
              <div className="bg-gray-700 rounded-lg px-3 py-2 text-gray-500 text-xs">
                No medic units available
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {medicUnits.map(u => (
                  <button key={u.id} type="button"
                    onClick={() => toggleUnit(u.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border-2 transition-all
                      ${selectedUnitIds.includes(u.id)
                        ? 'bg-blue-700 border-blue-400 text-white'
                        : 'bg-gray-700 border-gray-600 text-gray-300 hover:border-gray-400'}`}>
                    {TYPE_ICONS[u.unit_type] || '🚑'} {u.unit_number}
                  </button>
                ))}
              </div>
            )}
            {selectedUnitIds.length > 0 && (
              <p className="text-gray-500 text-xs mt-1">
                {selectedUnitIds.length} medic{selectedUnitIds.length > 1 ? 's' : ''} selected
              </p>
            )}
          </div>

          {/* Submit */}
          <button type="submit" disabled={loading || !form.call_type}
            className="w-full py-3 bg-red-600 hover:bg-red-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold rounded-xl text-sm transition-colors">
            {loading ? 'Dispatching…' : '🚨 DISPATCH'}
          </button>
        </form>
      </div>
    </div>
  );
}
