import { useState } from 'react';

// Cleaning duties dispatch assigned to this unit. Collapsed to one line so
// it never crowds out the call card; tap a duty to check it off.
export default function CrewDuties({ duties, myUnitId, onToggle, busyId }) {
  const [open, setOpen] = useState(false);
  if (!duties.length) return null;

  const left = duties.filter(d => !d.done[myUnitId]).length;

  return (
    <div className="rounded-xl border border-teal-700/70 bg-teal-950/40">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-left"
      >
        <span className="text-teal-200 text-sm font-semibold">🧽 Cleaning duties</span>
        <span className="flex items-center gap-2">
          <span className={`text-xs font-bold ${left ? 'text-amber-300' : 'text-green-400'}`}>
            {left ? `${left} of ${duties.length} left` : 'All done ✓'}
          </span>
          <span className="text-gray-500 text-xs">{open ? 'Hide' : 'Show'}</span>
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-1.5">
          {duties.map(d => {
            const done = !!d.done[myUnitId];
            return (
              <button
                key={d.id}
                onClick={() => onToggle(d.id, !done)}
                disabled={busyId === d.id}
                className={`w-full flex items-start gap-3 px-3 py-3 rounded-lg text-left border transition-colors disabled:opacity-60 ${
                  done ? 'bg-gray-800/60 border-gray-700' : 'bg-gray-800 border-gray-600 active:bg-gray-700'}`}
              >
                <span className={`w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0 text-sm font-bold ${
                  done ? 'bg-green-600 border-green-500 text-white' : 'border-gray-500'}`}>
                  {done ? '✓' : ''}
                </span>
                <span className={`text-sm break-words ${done ? 'text-gray-500 line-through' : 'text-gray-100'}`}>{d.text}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
