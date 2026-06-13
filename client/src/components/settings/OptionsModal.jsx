import { useState, useEffect } from 'react';

const STORAGE_KEY = 'ems_cad_quick_types';

export function loadQuickTypes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveQuickTypes(types) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(types));
}

export default function OptionsModal({
  onClose,
  locations = [], onRemoveLocation,
  trackers = [], onAddTracker, onUpdateTracker, onDeleteTracker
}) {
  const [quickTypes, setQuickTypes] = useState([]);
  const [input,      setInput]      = useState('');
  const [error,      setError]      = useState('');

  // Tracker editing state: { [trackerId]: device_id string }
  const [editDeviceIds, setEditDeviceIds] = useState({});
  // Tracker save status: { [trackerId]: 'saved' | null }
  const [savedFlags, setSavedFlags] = useState({});
  // Add tracker inline form
  const [newTrackerName, setNewTrackerName] = useState('');
  const [showAddTracker, setShowAddTracker] = useState(false);
  const [trackerError, setTrackerError]     = useState('');

  useEffect(() => {
    setQuickTypes(loadQuickTypes());
  }, []);

  // Sync editDeviceIds when trackers list changes
  useEffect(() => {
    setEditDeviceIds(prev => {
      const next = {};
      trackers.forEach(t => {
        next[t.id] = t.id in prev ? prev[t.id] : (t.device_id || '');
      });
      return next;
    });
  }, [trackers]);

  const handleAdd = () => {
    const val = input.trim();
    if (!val) { setError('Enter a call type label.'); return; }
    if (quickTypes.includes(val)) { setError('Already in the list.'); return; }
    const updated = [...quickTypes, val];
    setQuickTypes(updated);
    saveQuickTypes(updated);
    setInput('');
    setError('');
  };

  const handleRemove = (type) => {
    const updated = quickTypes.filter(t => t !== type);
    setQuickTypes(updated);
    saveQuickTypes(updated);
  };

  const handleReorder = (index, dir) => {
    const updated = [...quickTypes];
    const swap = index + dir;
    if (swap < 0 || swap >= updated.length) return;
    [updated[index], updated[swap]] = [updated[swap], updated[index]];
    setQuickTypes(updated);
    saveQuickTypes(updated);
  };

  const permanentPins = locations.filter(l => l.locationType === 'permanent' || l.location_type === 'permanent');

  const handleSaveTracker = async (tracker) => {
    const device_id = editDeviceIds[tracker.id]?.trim() || null;
    await onUpdateTracker?.(tracker.id, { device_id });
    setSavedFlags(prev => ({ ...prev, [tracker.id]: 'saved' }));
    setTimeout(() => setSavedFlags(prev => ({ ...prev, [tracker.id]: null })), 1500);
  };

  const handleAddTracker = async () => {
    const name = newTrackerName.trim();
    if (!name) { setTrackerError('Enter a name.'); return; }
    if (trackers.some(t => t.name.toLowerCase() === name.toLowerCase())) {
      setTrackerError('A tracker with that name already exists.');
      return;
    }
    await onAddTracker?.(name, null);
    setNewTrackerName('');
    setShowAddTracker(false);
    setTrackerError('');
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-2xl w-full max-w-sm shadow-2xl border border-gray-700 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 flex-shrink-0">
          <div className="text-white font-bold">⚙ Options</div>
          <button onClick={onClose}
            className="text-gray-400 hover:text-white w-8 h-8 flex items-center justify-center rounded hover:bg-gray-700 text-xl">
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">

          {/* ── GPS Trackers ── */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="text-gray-300 text-sm font-semibold">GPS Trackers</div>
              <button
                onClick={() => { setShowAddTracker(v => !v); setTrackerError(''); }}
                className="text-blue-400 hover:text-blue-300 text-xs font-semibold transition-colors"
              >
                {showAddTracker ? 'Cancel' : '+ Add Tracker'}
              </button>
            </div>
            <div className="text-gray-500 text-xs mb-3">
              Name a tracker once, enter its IMEI, then assign it to any unit.
            </div>

            {showAddTracker && (
              <div className="flex gap-2 mb-3">
                <input
                  type="text"
                  value={newTrackerName}
                  onChange={e => { setNewTrackerName(e.target.value); setTrackerError(''); }}
                  onKeyDown={e => e.key === 'Enter' && handleAddTracker()}
                  placeholder="e.g. Tracker 1"
                  className="flex-1 bg-gray-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
                />
                <button onClick={handleAddTracker}
                  className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg transition-colors">
                  Add
                </button>
              </div>
            )}
            {trackerError && <p className="text-red-400 text-xs mb-2">{trackerError}</p>}

            {trackers.length === 0 ? (
              <div className="text-gray-600 text-xs italic">No trackers yet — add one above.</div>
            ) : (
              <div className="space-y-2">
                {trackers.map(t => (
                  <div key={t.id} className="bg-gray-700 rounded-lg px-3 py-2 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-white text-sm font-semibold">📡 {t.name}</span>
                      <button
                        onClick={() => onDeleteTracker?.(t.id)}
                        className="text-gray-600 hover:text-red-400 text-lg leading-none transition-colors"
                        title="Remove tracker"
                      >
                        ×
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={editDeviceIds[t.id] ?? ''}
                        onChange={e => setEditDeviceIds(prev => ({ ...prev, [t.id]: e.target.value }))}
                        onKeyDown={e => e.key === 'Enter' && handleSaveTracker(t)}
                        placeholder="IMEI / Device ID"
                        className="flex-1 bg-gray-600 text-white rounded-lg px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500 font-mono"
                      />
                      <button
                        onClick={() => handleSaveTracker(t)}
                        className="px-2.5 py-1.5 bg-gray-600 hover:bg-blue-600 text-gray-300 hover:text-white text-xs font-semibold rounded-lg transition-colors"
                      >
                        {savedFlags[t.id] === 'saved' ? '✓' : 'Save'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Quick call type pills ── */}
          <div>
            <div className="text-gray-300 text-sm font-semibold mb-1">Quick Call Type Buttons</div>
            <div className="text-gray-500 text-xs mb-3">
              These appear as one-tap pills when creating a new call.
            </div>

            {quickTypes.length === 0 ? (
              <div className="text-gray-600 text-xs italic mb-3">No quick types set yet.</div>
            ) : (
              <div className="space-y-1.5 mb-3">
                {quickTypes.map((t, i) => (
                  <div key={t} className="flex items-center gap-2 bg-gray-700 rounded-lg px-3 py-2">
                    <span className="flex-1 text-white text-sm">{t}</span>
                    <button onClick={() => handleReorder(i, -1)} disabled={i === 0}
                      className="text-gray-500 hover:text-gray-300 disabled:opacity-30 text-xs px-1">↑</button>
                    <button onClick={() => handleReorder(i, 1)} disabled={i === quickTypes.length - 1}
                      className="text-gray-500 hover:text-gray-300 disabled:opacity-30 text-xs px-1">↓</button>
                    <button onClick={() => handleRemove(t)}
                      className="text-gray-600 hover:text-red-400 text-lg leading-none ml-1">×</button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={e => { setInput(e.target.value); setError(''); }}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                placeholder="e.g. Heat Illness, Laceration…"
                className="flex-1 bg-gray-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
              />
              <button onClick={handleAdd}
                className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg transition-colors">
                Add
              </button>
            </div>
            {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
          </div>

          {/* ── Permanent map pins ── */}
          <div>
            <div className="text-gray-300 text-sm font-semibold mb-1">Permanent Map Pins</div>
            <div className="text-gray-500 text-xs mb-3">
              These pins stay on the map across all shifts.
            </div>

            {permanentPins.length === 0 ? (
              <div className="text-gray-600 text-xs italic">
                No permanent pins yet — right-click the map and choose "Add Permanent Location".
              </div>
            ) : (
              <div className="space-y-1.5">
                {permanentPins.map(loc => (
                  <div key={loc.id} className="flex items-center gap-2.5 bg-gray-700 rounded-lg px-3 py-2">
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: loc.color || '#6366f1' }} />
                    <span className="flex-1 text-white text-sm truncate">{loc.name}</span>
                    <button
                      onClick={() => onRemoveLocation?.(loc.id)}
                      className="text-gray-600 hover:text-red-400 text-lg leading-none transition-colors"
                      title="Remove pin"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

        <div className="px-5 py-4 border-t border-gray-700 flex-shrink-0">
          <button onClick={onClose}
            className="w-full py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded-lg transition-colors">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
