import { useState, useRef, useEffect } from 'react';

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

export default function CallComments({ comments = [], onAdd, authorName = 'Dispatcher' }) {
  const [text, setText] = useState('');
  const listRef = useRef(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [comments.length]);

  const submit = () => {
    if (!text.trim()) return;
    onAdd(text.trim(), authorName);
    setText('');
  };

  return (
    <div className="flex flex-col gap-2">
      <div ref={listRef} className="space-y-1.5 max-h-40 overflow-y-auto pr-0.5">
        {comments.length === 0 ? (
          <div className="text-gray-500 text-xs italic">No messages yet</div>
        ) : (
          comments.map(c => {
            const isMe = c.author === authorName;
            return (
              <div key={c.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                <div className={`max-w-[85%] rounded-xl px-2.5 py-1.5 ${
                  isMe ? 'bg-blue-700 text-white' : 'bg-gray-600 text-gray-100'
                }`}>
                  <div className="text-xs mb-0.5 font-semibold flex gap-1.5 items-baseline">
                    <span className={isMe ? 'text-blue-200' : 'text-green-400'}>
                      {isMe ? 'You' : c.author}
                    </span>
                    {c.created_at && (
                      <span className="font-normal opacity-60">{fmtTime(c.created_at)}</span>
                    )}
                  </div>
                  <div className="text-sm leading-snug">{c.text}</div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder="Message crew…"
          className="flex-1 bg-gray-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
        />
        <button
          onClick={submit}
          disabled={!text.trim()}
          className="px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors font-medium"
        >
          Send
        </button>
      </div>
    </div>
  );
}
