import { useState } from 'react';
import { dutyProgress } from '../../lib/dutyProgress';
import DutyProgressList from '../duties/DutyProgressList';

const byNumber = (a, b) => a.localeCompare(b, undefined, { numeric: true });

// Admin-only: every unit's duties with checkboxes, submitted to dispatch as a
// report. Checkmarks are local until Submit and clear after a successful one.
// Stays mounted (collapsed) so a half-done check survives opening other screens.
export default function CrewDutyCheck({ duties, done = [], units, onSubmit }) {
  const [open,      setOpen]      = useState(false);
  const [view,      setView]      = useState('left'); // 'left' (crews' live checkoffs) | 'check'
  const [checked,   setChecked]   = useState(() => new Set());
  const [notes,     setNotes]     = useState('');
  const [busy,      setBusy]      = useState(false);
  const [error,     setError]     = useState('');
  const [sentAt,    setSentAt]    = useState(null);

  if (!duties.length) return null;

  // One group per assignment: "All units", or each assigned unit with its crew name.
  const groups = new Map();
  duties.forEach(d => {
    const keys = d.unit_ids.length ? d.unit_ids : ['__all'];
    keys.forEach(id => {
      if (!groups.has(id)) {
        const u = units.find(x => x.id === id);
        const label = id === '__all' ? 'All units' : u ? (u.crew ? `${u.unit_number} · ${u.crew}` : u.unit_number) : 'Removed unit';
        groups.set(id, { label, sortKey: id === '__all' ? '' : u?.unit_number || '~', items: [] });
      }
      groups.get(id).items.push(d);
    });
  });
  const sorted = [...groups.entries()].sort((a, b) => byNumber(a[1].sortKey, b[1].sortKey));

  const toggle = (id) => setChecked(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const doneCount = duties.filter(d => checked.has(d.id)).length;
  const { left } = dutyProgress(duties, done, units);

  const submit = async () => {
    setBusy(true);
    setError('');
    const err = await onSubmit([...checked].filter(id => duties.some(d => d.id === id)), notes);
    setBusy(false);
    if (err) { setError(err); return; }
    setChecked(new Set());
    setNotes('');
    setSentAt(new Date());
  };

  return (
    <div className="rounded-xl border border-indigo-700/70 bg-indigo-950/40">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-left"
      >
        <span className="text-indigo-200 text-sm font-semibold">📋 Duty check (all units)</span>
        <span className="flex items-center gap-2">
          <span className={`text-xs ${left ? 'text-amber-300' : 'text-green-400'}`}>{left ? `${left} left` : 'all done ✓'}</span>
          <span className="text-gray-500 text-xs">{open ? 'Hide' : 'Show'}</span>
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-3">
          <div className="flex gap-2">
            {[['left', "What's left"], ['check', `Inspect & report${doneCount ? ` (${doneCount}/${duties.length})` : ''}`]].map(([id, label]) => (
              <button key={id} onClick={() => setView(id)}
                className={`flex-1 py-2 rounded-lg text-xs font-semibold ${view === id ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-300 border border-gray-700'}`}>
                {label}
              </button>
            ))}
          </div>
          {view === 'left' ? (
            <DutyProgressList duties={duties} done={done} units={units} />
          ) : (<>
          {sentAt && !doneCount && (
            <div className="px-3 py-2 rounded-lg bg-green-900/50 border border-green-700 text-green-200 text-xs">
              ✅ Report sent to dispatch at {sentAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </div>
          )}
          {sorted.map(([key, g]) => (
            <div key={key} className="space-y-1.5">
              <div className="text-gray-400 text-[11px] uppercase tracking-wider">{g.label}</div>
              {g.items.map(d => {
                const on = checked.has(d.id);
                return (
                  <button
                    key={d.id}
                    onClick={() => toggle(d.id)}
                    className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left border transition-colors ${
                      on ? 'bg-gray-800/60 border-green-800' : 'bg-gray-800 border-gray-600 active:bg-gray-700'}`}
                  >
                    <span className={`w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0 text-sm font-bold ${
                      on ? 'bg-green-600 border-green-500 text-white' : 'border-gray-500'}`}>
                      {on ? '✓' : ''}
                    </span>
                    <span className="text-sm text-gray-100 break-words">{d.text}</span>
                  </button>
                );
              })}
            </div>
          ))}
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Notes (optional)"
            rows={2}
            maxLength={2000}
            // 16px text so iOS doesn't zoom the page on focus.
            className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-base outline-none focus:ring-2 focus:ring-indigo-500 placeholder-gray-500 resize-none"
          />
          {error && <div className="text-red-400 text-xs">{error}</div>}
          <button
            onClick={submit}
            disabled={busy}
            className="w-full py-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-50 text-white text-sm font-bold"
          >
            {busy ? 'Sending…' : `Submit report (${doneCount}/${duties.length} done)`}
          </button>
          </>)}
        </div>
      )}
    </div>
  );
}
