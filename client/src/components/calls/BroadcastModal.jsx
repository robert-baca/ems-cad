import { useState } from 'react';

export default function BroadcastModal({ onSend, onClose }) {
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
            <div className="text-gray-400 text-xs">Pushes to every crew member's phone</div>
          </div>
          <button onClick={onClose}
            className="text-gray-400 hover:text-white w-8 h-8 flex items-center justify-center rounded hover:bg-gray-700 text-xl">
            ×
          </button>
        </div>

        <div className="p-5 space-y-4">
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
                Every crew member gets an immediate buzz + notification, even if their app is closed.
              </p>
            </>
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
