import { useState } from 'react';

// Cleaning duties dispatch handed to this unit; the crew taps each one off
// as they finish it (dispatch sees what's left live). Collapsed to one line
// so it never crowds out the call card.
export default function CrewDuties({ duties, done, onToggle }) {
  const [open,    setOpen]    = useState(false);
  const [pending, setPending] = useState(null); // duty id being saved
  const [error,   setError]   = useState('');
  if (!duties.length) return null;

  const isDone = (id) => done.some(c => c.duty_id === id);
  const left = duties.filter(d => !isDone(d.id)).length;

  const toggle = async (d) => {
    if (pending) return;
    setPending(d.id);
    setError('');
    const err = await onToggle(d.id, !isDone(d.id));
    setPending(null);
    if (err) setError(err);
  };

  return (
    <div className="rounded-xl border border-teal-700/70 bg-teal-950/40">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-left"
      >
        <span className="text-teal-200 text-sm font-semibold">
          🧽 Cleaning duties {left ? `(${left} left)` : '— all done ✓'}
        </span>
        <span className="text-gray-500 text-xs">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <ul className="px-3 pb-3 space-y-1.5">
          {duties.map(d => {
            const on = isDone(d.id);
            return (
              <li key={d.id}>
                <button
                  onClick={() => toggle(d)}
                  disabled={pending === d.id}
                  className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left border transition-colors disabled:opacity-60 ${
                    on ? 'bg-gray-800/60 border-green-800' : 'bg-gray-800 border-gray-700 active:bg-gray-700'}`}
                >
                  <span className={`w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0 text-sm font-bold ${
                    on ? 'bg-green-600 border-green-500 text-white' : 'border-gray-500'}`}>
                    {on ? '✓' : ''}
                  </span>
                  <span className={`text-sm break-words ${on ? 'text-gray-500 line-through' : 'text-gray-100'}`}>{d.text}</span>
                </button>
              </li>
            );
          })}
          {error && <li className="text-red-400 text-xs px-1">{error}</li>}
        </ul>
      )}
    </div>
  );
}
