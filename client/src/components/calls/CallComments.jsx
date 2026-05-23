import { useState, useRef, useEffect } from 'react';

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit'
  });
}

export default function CallComments({ comments = [], onAdd, authorName = 'Dispatcher' }) {
  const [text, setText] = useState('');
  const listRef = useRef(null);

  // Auto-scroll to bottom when new comment added
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [comments.length]);

  const submit = () => {
    if (!text.trim()) return;
    onAdd(text.trim(), authorName);
    setText('');
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Comment list */}
      <div
        ref={listRef}
        className="space-y-2 max-h-36 overflow-y-auto pr-0.5"
      >
        {comments.length === 0 ? (
          <div className="text-gray-500 text-xs italic">No comments yet</div>
        ) : (
          comments.map(c => (
            <div key={c.id} className="bg-gray-700 rounded-lg px-3 py-2">
              <div className="flex justify-between items-center mb-0.5">
                <span className="text-blue-300 text-xs font-semibold">{c.author}</span>
                <span className="text-gray-500 text-xs">{fmtTime(c.created_at)}</span>
              </div>
              <div className="text-gray-200 text-sm leading-snug">{c.text}</div>
            </div>
          ))
        )}
      </div>

      {/* Input row */}
      <div className="flex gap-2">
        <input
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder="Add comment…"
          className="flex-1 bg-gray-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
        />
        <button
          onClick={submit}
          disabled={!text.trim()}
          className="px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors font-medium"
        >
          Add
        </button>
      </div>
    </div>
  );
}
