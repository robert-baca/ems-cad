import { useEffect, useRef, useState } from 'react';

const COLORS = [
  { value: '#f59e0b', label: 'Amber'  },
  { value: '#ef4444', label: 'Red'    },
  { value: '#22c55e', label: 'Green'  },
  { value: '#3b82f6', label: 'Blue'   },
  { value: '#8b5cf6', label: 'Purple' },
  { value: '#ffffff', label: 'White'  },
];

export default function MapContextMenu({ position, onStartCall, onAddLocation, onClose }) {
  const ref = useRef(null);
  const [mode, setMode] = useState('menu'); // 'menu' | 'location'
  const [locName,  setLocName]  = useState('');
  const [locColor, setLocColor] = useState('#f59e0b');

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const style = {
    position: 'fixed',
    left: Math.min(position.x, window.innerWidth - 230),
    top: Math.min(position.y, window.innerHeight - 220),
    zIndex: 1000
  };

  const submitLocation = () => {
    if (!locName.trim()) return;
    onAddLocation(locName.trim(), position.lat, position.lng, locColor);
    onClose();
  };

  return (
    <div ref={ref} style={style}
      className="bg-gray-800 border border-gray-600 rounded-xl shadow-2xl overflow-hidden w-56">

      {mode === 'menu' ? (
        <>
          {/* Start call option */}
          <button
            onClick={onStartCall}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-700 text-white text-sm font-semibold transition-colors text-left border-b border-gray-700"
          >
            <span>🚨</span> Start Call Here
          </button>

          {/* Add location option */}
          <button
            onClick={() => setMode('location')}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-700 text-white text-sm font-semibold transition-colors text-left"
          >
            <span>📍</span> Add Location Here
          </button>

          <div className="px-4 pb-2.5 pt-1 text-gray-600 text-xs font-mono">
            {position.lat?.toFixed(5)}, {position.lng?.toFixed(5)}
          </div>
        </>
      ) : (
        /* Location form */
        <div className="p-3 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <button onClick={() => setMode('menu')}
              className="text-gray-400 hover:text-white text-xs">←</button>
            <span className="text-white text-sm font-semibold">📍 Add Location</span>
          </div>

          <input
            autoFocus
            type="text"
            value={locName}
            onChange={e => setLocName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitLocation(); if (e.key === 'Escape') onClose(); }}
            placeholder="Location name…"
            className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
          />

          {/* Color picker */}
          <div className="flex gap-1.5 flex-wrap">
            {COLORS.map(c => (
              <button
                key={c.value}
                onClick={() => setLocColor(c.value)}
                title={c.label}
                className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
                style={{
                  backgroundColor: c.value,
                  borderColor: locColor === c.value ? '#60a5fa' : 'transparent'
                }}
              />
            ))}
          </div>

          <div className="flex gap-2">
            <button
              onClick={submitLocation}
              disabled={!locName.trim()}
              className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg transition-colors"
            >
              Save
            </button>
            <button onClick={onClose}
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded-lg transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
