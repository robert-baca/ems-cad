import { useState } from 'react';

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// Park-wide broadcasts for this shift. Unread ones stay pinned at the top
// until acknowledged -- a push notification alone was the only copy before,
// so swiping it away (or never seeing it) meant the message was gone.
export default function CrewBroadcasts({ broadcasts, onAck }) {
  const [showEarlier, setShowEarlier] = useState(false);
  const unread = broadcasts.filter(b => !b.read);
  const read   = broadcasts.filter(b => b.read).slice().reverse();

  if (!broadcasts.length) return null;

  return (
    <div className="space-y-2">
      {unread.map(b => (
        <div key={b.id} className="rounded-xl border-2 border-purple-500 bg-purple-900/60 p-3">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="text-purple-200 text-xs font-bold uppercase tracking-wider">📢 Broadcast · {b.from}</div>
            <div className="text-purple-300/80 text-xs flex-shrink-0">{fmtTime(b.sent_at)}</div>
          </div>
          <div className="text-white text-sm font-semibold whitespace-pre-wrap break-words">{b.message}</div>
          <button
            onClick={() => onAck(b.id)}
            className="mt-2.5 w-full py-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 active:bg-purple-700 text-white text-sm font-bold"
          >
            Got it
          </button>
        </div>
      ))}

      {read.length > 0 && (
        <div className="rounded-xl border border-gray-700 bg-gray-800/60">
          <button
            onClick={() => setShowEarlier(v => !v)}
            className="w-full flex items-center justify-between px-3 py-2.5 text-left"
          >
            <span className="text-gray-300 text-xs font-medium">📢 Broadcasts this shift ({read.length})</span>
            <span className="text-gray-500 text-xs">{showEarlier ? 'Hide' : 'Show'}</span>
          </button>
          {showEarlier && (
            <div className="px-3 pb-3 space-y-2">
              {read.map(b => (
                <div key={b.id} className="border-t border-gray-700 pt-2">
                  <div className="text-gray-500 text-[11px]">{fmtTime(b.sent_at)} · {b.from}</div>
                  <div className="text-gray-200 text-sm whitespace-pre-wrap break-words">{b.message}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
