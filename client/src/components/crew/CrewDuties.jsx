import { useState } from 'react';

// Cleaning duties dispatch posted for this unit -- read-only. Collapsed to
// one line so it never crowds out the call card.
export default function CrewDuties({ duties }) {
  const [open, setOpen] = useState(false);
  if (!duties.length) return null;

  return (
    <div className="rounded-xl border border-teal-700/70 bg-teal-950/40">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-left"
      >
        <span className="text-teal-200 text-sm font-semibold">🧽 Cleaning duties ({duties.length})</span>
        <span className="text-gray-500 text-xs">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <ul className="px-3 pb-3 space-y-1.5">
          {duties.map(d => (
            <li key={d.id} className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-700">
              <span className="text-teal-400 flex-shrink-0">•</span>
              <span className="text-gray-100 text-sm break-words">{d.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
