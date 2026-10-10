import { useState } from 'react';
import { setDutiesEnabled, addDuty, deleteDuty, resetDuties } from '../../services/api';

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

const byNumber = (a, b) => a.unit_number.localeCompare(b.unit_number, undefined, { numeric: true });

// Units a duty is expected from: the ones picked, or (for "All units")
// every non-cart unit in service right now -- plus anyone who already
// checked it off, so a unit going out of service doesn't hide its checkmark.
function expectedUnits(d, units) {
  const picked = d.unit_ids.length
    ? units.filter(u => d.unit_ids.includes(u.id))
    : units.filter(u => u.unit_type !== 'Cart' && (u.status !== 'out_of_service' || d.done[u.id]));
  return picked.slice().sort(byNumber);
}

function DutyRow({ d, units, onDelete }) {
  const [open, setOpen] = useState(false);
  const expected = expectedUnits(d, units);
  const doneCount = expected.filter(u => d.done[u.id]).length;
  const allDone = expected.length > 0 && doneCount === expected.length;
  const target = d.unit_ids.length ? expected.map(u => u.unit_number).join(', ') || 'Removed unit' : 'All units';
  return (
    <div className="rounded-lg bg-gray-700/60 px-3 py-2">
      <div className="flex items-start gap-2">
        <button onClick={() => setOpen(v => !v)} className="flex-1 min-w-0 text-left">
          <div className="text-gray-100 text-sm break-words">{d.text}</div>
          <div className="flex items-center justify-between gap-2 mt-0.5">
            <span className="text-gray-400 text-[11px] truncate">{target}</span>
            <span className={`text-[11px] font-bold flex-shrink-0 ${allDone ? 'text-green-400' : 'text-amber-400'}`}>
              Done {doneCount}/{expected.length}
            </span>
          </div>
        </button>
        <button onClick={() => onDelete(d)} title="Remove this duty"
          className="text-gray-500 hover:text-red-400 w-7 h-7 flex items-center justify-center rounded hover:bg-gray-600 flex-shrink-0">
          🗑
        </button>
      </div>
      {open && (
        <div className="mt-1.5 pt-1.5 border-t border-gray-600 space-y-0.5">
          {expected.map(u => d.done[u.id] ? (
            <div key={u.id} className="text-green-400/90 text-[11px]">
              ✓ {u.unit_number} · {fmtTime(d.done[u.id].at)}{d.done[u.id].by ? ` · ${d.done[u.id].by}` : ''}
            </div>
          ) : (
            <div key={u.id} className="text-amber-400/90 text-[11px]">… {u.unit_number} — not done</div>
          ))}
          {!expected.length && <div className="text-gray-500 text-[11px]">No units in service for this duty</div>}
        </div>
      )}
    </div>
  );
}

export default function DutiesModal({ enabled, duties, units, onClose }) {
  const [text,     setText]     = useState('');
  const [allUnits, setAllUnits] = useState(true);
  const [picked,   setPicked]   = useState([]);
  const [busy,     setBusy]     = useState(false);
  const [error,    setError]    = useState('');

  const run = async (fn, fallback) => {
    setBusy(true);
    setError('');
    try { await fn(); return true; }
    catch (err) { setError(err?.response?.data?.error || fallback); return false; }
    finally { setBusy(false); }
  };

  const handleAdd = async () => {
    const trimmed = text.trim();
    if (!trimmed) { setError('Enter a duty.'); return; }
    if (!allUnits && !picked.length) { setError('Pick at least one unit, or choose All units.'); return; }
    if (await run(() => addDuty(trimmed, allUnits ? [] : picked), 'Could not add duty — try again')) setText('');
  };

  const handleDelete = (d) => {
    if (!window.confirm(`Remove "${d.text}"?`)) return;
    run(() => deleteDuty(d.id), 'Could not remove duty — try again');
  };

  const handleReset = () => {
    if (!window.confirm('Uncheck every duty for every unit? (This also happens automatically when a shift starts.)')) return;
    run(() => resetDuties(), 'Could not reset — try again');
  };

  const togglePick = (id) => setPicked(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const anyDone = duties.some(d => Object.keys(d.done).length);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-2xl w-full max-w-md shadow-2xl border border-gray-700">
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-gray-700">
          <div>
            <div className="text-white font-bold">🧽 Cleaning Duties</div>
            <div className="text-gray-400 text-xs">Crews see and check off their own in the app</div>
          </div>
          <button onClick={onClose}
            className="text-gray-400 hover:text-white w-8 h-8 flex items-center justify-center rounded hover:bg-gray-700 text-xl">
            ×
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="flex items-center justify-between rounded-xl px-4 py-2.5 bg-gray-900/50 border border-gray-700">
            <div className="pr-3">
              <div className="text-sm font-medium text-gray-200">Show duties in the crew app</div>
              <div className="text-[11px] text-gray-500">{enabled ? 'On — crews can see their duties' : 'Off — hidden from crews'}</div>
            </div>
            <button
              onClick={() => run(() => setDutiesEnabled(!enabled), 'Could not save — try again')}
              disabled={busy}
              aria-label="Toggle duties in the crew app"
              className={`relative w-11 h-6 rounded-full flex-shrink-0 transition-colors disabled:opacity-50 ${enabled ? 'bg-green-600' : 'bg-gray-600'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${enabled ? 'translate-x-5' : ''}`} />
            </button>
          </div>

          <div className="space-y-2">
            <label className="block text-gray-300 text-xs uppercase tracking-wider font-semibold">Add a duty</label>
            <input
              value={text}
              onChange={e => { setText(e.target.value); setError(''); }}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
              placeholder="e.g. Wipe down the cart and restock gloves"
              maxLength={300}
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
            />
            <div className="flex gap-2">
              <button onClick={() => setAllUnits(true)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold ${allUnits ? 'bg-blue-700 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                All units
              </button>
              <button onClick={() => setAllUnits(false)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold ${!allUnits ? 'bg-blue-700 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                Pick units
              </button>
            </div>
            {!allUnits && (
              <div className="flex flex-wrap gap-1.5">
                {units.slice().sort(byNumber).map(u => (
                  <button key={u.id} onClick={() => togglePick(u.id)}
                    className={`px-2.5 py-1 rounded-full text-xs border ${picked.includes(u.id)
                      ? 'bg-blue-700 border-blue-500 text-white' : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'}`}>
                    {u.unit_number}
                  </button>
                ))}
              </div>
            )}
            <button onClick={handleAdd} disabled={busy}
              className="w-full py-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white font-semibold text-sm rounded-lg">
              + Add Duty
            </button>
            {error && <p className="text-red-400 text-sm">{error}</p>}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-gray-400 text-xs uppercase tracking-wider">Duties · tap for who's done</div>
              {anyDone && (
                <button onClick={handleReset} disabled={busy} className="text-xs text-gray-400 hover:text-white underline">
                  Uncheck all
                </button>
              )}
            </div>
            {duties.length
              ? duties.map(d => <DutyRow key={d.id} d={d} units={units} onDelete={handleDelete} />)
              : <p className="text-gray-500 text-sm">No duties yet.</p>}
          </div>
        </div>

        <div className="px-5 py-4 border-t border-gray-700">
          <button onClick={onClose}
            className="w-full py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded-lg transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
