import { useState, useEffect, useRef } from 'react';

const TYPE_ICONS = { ALS: '🚑', BLS: '🚐', Cart: '🛺', Bike: '🚴' };
const TYPE_BADGE = { ALS: 'bg-red-900/50 text-red-300', BLS: 'bg-blue-900/50 text-blue-300', Cart: 'bg-green-900/50 text-green-300' };
const TYPE_ORDER = { ALS: 0, BLS: 1, Cart: 2, Bike: 3 };

function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function sortUnits(units) {
  return [...units].sort((a, b) => {
    const typeDiff = (TYPE_ORDER[a.unit_type] ?? 9) - (TYPE_ORDER[b.unit_type] ?? 9);
    if (typeDiff !== 0) return typeDiff;
    return a.unit_number.localeCompare(b.unit_number, undefined, { numeric: true });
  });
}

// ── Roster list ──────────────────────────────────────────────────────
function RosterList({ myUnit, units, onSelect, onClose }) {
  const others = sortUnits(units.filter(u => u.id !== myUnit?.id));

  return (
    <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col">
      <div className="flex items-center justify-between px-4 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-4 border-b border-gray-800">
        <button onClick={onClose} className="text-gray-400 hover:text-white p-2 -ml-2">← Back</button>
        <div className="text-white font-bold">Today's Crew</div>
        <div className="w-12" />
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {others.length === 0 ? (
          <div className="text-center py-16 text-gray-500 text-sm">
            <div className="text-4xl mb-3">🧑‍🤝‍🧑</div>
            No other units on shift right now.
          </div>
        ) : (
          others.map(u => (
            <button key={u.id} onClick={() => onSelect(u)}
              className="w-full flex items-center gap-3 bg-gray-800 border border-gray-700 hover:border-gray-500 rounded-2xl px-4 py-3 text-left transition-all group">
              <span className="text-xl flex-shrink-0">{TYPE_ICONS[u.unit_type] || '🚑'}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-white font-bold text-sm">{u.unit_number}</span>
                  {u.unit_type && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${TYPE_BADGE[u.unit_type] || 'bg-gray-700 text-gray-400'}`}>
                      {u.unit_type}
                    </span>
                  )}
                </div>
                <div className="text-gray-400 text-xs mt-0.5 truncate">{u.crew || 'No crew name on file'}</div>
              </div>
              <span className="text-gray-600 group-hover:text-blue-400 text-xl flex-shrink-0">💬</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ── Direct message thread ────────────────────────────────────────────
function DmThread({ myUnit, target, messages, onLoad, onSend, onBack }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const listRef = useRef(null);

  useEffect(() => { onLoad(target.id); }, [target.id]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages.length]);

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setSendError('');
    const err = await onSend(target.id, trimmed);
    setSending(false);
    if (err) { setSendError(err); return; }
    setText('');
  };

  return (
    <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col">
      <div className="flex items-center justify-between px-4 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-4 border-b border-gray-800 flex-shrink-0">
        <button onClick={onBack} className="text-gray-400 hover:text-white p-2 -ml-2">← Back</button>
        <div className="text-center">
          <div className="text-white font-bold text-sm">{target.unit_number}</div>
          {target.crew && <div className="text-gray-500 text-xs">{target.crew}</div>}
        </div>
        <div className="w-12" />
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto p-4 space-y-2">
        {messages.length === 0 ? (
          <div className="text-gray-500 text-xs text-center py-8">
            No messages yet — say hi 👋<br />
            <span className="text-gray-600">Only {target.unit_number} can see these — not dispatch.</span>
          </div>
        ) : (
          messages.map(m => {
            const isMe = m.from_unit_id === myUnit?.id;
            return (
              <div key={m.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                <div className={`max-w-[80%] rounded-2xl px-3 py-2 ${isMe ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-100'}`}>
                  <div className="text-xs opacity-70 mb-0.5">{fmtTime(m.created_at)}</div>
                  <div className="text-sm leading-snug">{m.text}</div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {sendError && <div className="px-4 pb-1.5 text-red-400 text-xs">{sendError}</div>}
      <div className="px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-2 flex gap-2 flex-shrink-0">
        <input
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder={`Message ${target.unit_number}…`}
          className="flex-1 bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
        />
        <button
          onClick={submit}
          disabled={!text.trim() || sending}
          className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 text-white text-sm rounded-xl transition-colors font-semibold"
        >
          {sending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────
export default function CrewRoster({ myUnit, units, messagesByUnit, onLoadThread, onSendMessage, onClose }) {
  const [target, setTarget] = useState(null);

  if (target) {
    return (
      <DmThread
        myUnit={myUnit}
        target={target}
        messages={messagesByUnit[target.id] || []}
        onLoad={onLoadThread}
        onSend={onSendMessage}
        onBack={() => setTarget(null)}
      />
    );
  }

  return (
    <RosterList
      myUnit={myUnit}
      units={units}
      onSelect={setTarget}
      onClose={onClose}
    />
  );
}
