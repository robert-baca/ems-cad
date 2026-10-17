import { useState } from 'react';
import { dutyProgress, dutyUnitLabel, fmtDoneTime } from '../../lib/dutyProgress';

// Read-only "what's left" view: each unit's duties, unfinished first.
// Used in the dispatcher's Duties window and the admin duty check.
export default function DutyProgressList({ duties, done, units }) {
  const [showDone, setShowDone] = useState(false);
  const { rows, total, left } = dutyProgress(duties, done, units);

  if (!total) return <p className="text-gray-500 text-sm">No duties handed out yet.</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className={`text-sm font-semibold ${left ? 'text-amber-300' : 'text-green-400'}`}>
          {left ? `${left} of ${total} left` : `All ${total} done ✓`}
        </span>
        <button onClick={() => setShowDone(v => !v)} className="text-xs text-gray-400 hover:text-gray-200">
          {showDone ? 'Hide finished' : 'Show finished'}
        </button>
      </div>
      {rows.map(r => {
        const items = showDone ? r.items : r.items.filter(i => !i.done);
        return (
          <div key={r.unit.id} className="space-y-1">
            <div className="flex items-center justify-between text-[11px] uppercase tracking-wider">
              <span className="text-gray-400">{dutyUnitLabel(r.unit)}</span>
              <span className={r.left ? 'text-amber-400' : 'text-green-400'}>
                {r.left ? `${r.left} left` : 'Done ✓'}
              </span>
            </div>
            {items.map(({ duty, done: d }) => (
              <div key={duty.id}
                className={`flex items-start gap-2 rounded-lg px-3 py-1.5 text-sm ${d ? 'bg-gray-800/40 text-gray-500' : 'bg-gray-700/60 text-gray-100'}`}>
                <span className={`flex-shrink-0 ${d ? 'text-green-500' : 'text-amber-400'}`}>{d ? '✓' : '○'}</span>
                <span className={`flex-1 min-w-0 break-words ${d ? 'line-through' : ''}`}>{duty.text}</span>
                {d && <span className="text-[11px] flex-shrink-0">{d.done_by || ''} {fmtDoneTime(d.done_at)}</span>}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
