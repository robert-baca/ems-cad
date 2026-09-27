import { useState } from 'react';

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// One sent broadcast with its read receipts. "Expected" is every unit that
// was in service when it went out; a unit that logged in later and read it
// still counts as read.
function BroadcastReceipt({ b, units }) {
  const [open, setOpen] = useState(false);
  const name = (id) => units.find(u => u.id === id)?.unit_number || b.reads?.[id]?.unit_number || id;
  const reads = b.reads || {};
  const readIds = Object.keys(reads);
  const expected = b.target_unit_ids || [];
  const notYet = expected.filter(id => !reads[id]).map(name).sort((a, b2) => a.localeCompare(b2, undefined, { numeric: true }));
  const total = new Set([...expected, ...readIds]).size;
  const allRead = notYet.length === 0 && total > 0;
  return (
    <div className="rounded-lg bg-gray-700/60 px-3 py-2">
      <button onClick={() => setOpen(v => !v)} className="w-full text-left">
        <div className="flex items-center justify-between gap-2">
          <span className="text-gray-400 text-[11px]">{fmtTime(b.sent_at)} · {b.from_name}</span>
          <span className={`text-[11px] font-bold ${allRead ? 'text-green-400' : 'text-amber-400'}`}>
            Read {readIds.length}/{total}
          </span>
        </div>
        <div className="text-gray-100 text-sm truncate">{b.message}</div>
        {notYet.length > 0 && (
          <div className="text-amber-400/90 text-[11px] mt-0.5 truncate">Not yet: {notYet.join(', ')}</div>
        )}
      </button>
      {open && (
        <div className="mt-1.5 pt-1.5 border-t border-gray-600 space-y-0.5">
          <div className="text-gray-300 text-xs whitespace-pre-wrap break-words mb-1">{b.message}</div>
          {readIds
            .sort((x, y) => reads[x].at.localeCompare(reads[y].at))
            .map(id => (
              <div key={id} className="text-green-400/90 text-[11px]">✓ {name(id)} · {fmtTime(reads[id].at)}</div>
            ))}
          {notYet.map(n => (
            <div key={n} className="text-amber-400/90 text-[11px]">… {n}</div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function BroadcastModal({ onSend, onClose, broadcasts = [], units = [] }) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error,   setError]   = useState('');
  const [result,  setResult]  = useState(null);

  const handleSend = async () => {
    const trimmed = message.trim();
    if (!trimmed) { setError('Enter a message to send.'); return; }
    setSending(true);
    setError('');
    try {
      const res = await onSend(trimmed);
      setResult(res);
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to send. Try again.');
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-2xl w-full max-w-sm shadow-2xl border border-gray-700">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <div>
            <div className="text-white font-bold">📢 Park-Wide Broadcast</div>
            <div className="text-gray-400 text-xs">Pushes to every crew member's phone (carts excluded)</div>
          </div>
          <button onClick={onClose}
            className="text-gray-400 hover:text-white w-8 h-8 flex items-center justify-center rounded hover:bg-gray-700 text-xl">
            ×
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {result ? (
            <div className="text-center py-4">
              <div className="text-3xl mb-2">✅</div>
              <div className="text-white font-semibold">Sent</div>
              <div className="text-gray-400 text-sm mt-1">
                Delivered to {result.sent} of {result.targeted} crew device{result.targeted === 1 ? '' : 's'} with the app installed
              </div>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-gray-300 text-xs uppercase tracking-wider mb-1.5 font-semibold">
                  Message
                </label>
                <textarea
                  value={message}
                  onChange={e => { setMessage(e.target.value); setError(''); }}
                  placeholder="e.g. Severe weather — all units seek shelter now"
                  rows={3}
                  autoFocus
                  maxLength={200}
                  className="w-full bg-gray-700 text-white rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500 resize-none"
                />
              </div>
              {error && <p className="text-red-400 text-sm">{error}</p>}
              <p className="text-gray-500 text-xs">
                Every crew member except carts gets an immediate buzz + notification, even if their app is closed.
                It also stays pinned in their app until they tap Got it.
              </p>
            </>
          )}

          {broadcasts.length > 0 && (
            <div className="space-y-2 pt-1">
              <div className="text-gray-400 text-xs uppercase tracking-wider">Sent this shift · tap for details</div>
              {broadcasts.slice().reverse().map(b => (
                <BroadcastReceipt key={b.id} b={b} units={units} />
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-700 flex gap-3">
          <button onClick={onClose}
            className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded-lg transition-colors">
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button onClick={handleSend} disabled={sending}
              className="flex-1 py-2.5 bg-purple-700 hover:bg-purple-600 disabled:bg-purple-900 text-white font-semibold text-sm rounded-lg transition-colors">
              {sending ? 'Sending…' : '📢 Send to All Crew'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
