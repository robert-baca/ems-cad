import { useState } from 'react';
import { STATUS_LABELS, STATUS_COLORS } from '../../data/mockData';

const SEQUENCE = ['dispatched', 'acknowledged', 'en_route', 'on_scene', 'patient_contact', 'transporting', 'cleared', 'available'];

const ICONS = {
  acknowledged:    '👁️',
  en_route:        '🔵',
  on_scene:        '🟠',
  patient_contact: '🔴',
  transporting:    '🏥',
  cleared:         '⚪',
  available:       '🟢',
};

export default function StatusButtons({ currentStatus, onStatusChange, loading }) {
  const [showOther, setShowOther] = useState(false);

  const currentIdx = SEQUENCE.indexOf(currentStatus);
  const nextStatus = SEQUENCE[currentIdx + 1] ?? null;

  const otherStatuses = SEQUENCE.filter(
    s => s !== currentStatus && s !== nextStatus && s !== 'dispatched'
  );

  return (
    <div className="bg-gray-800 rounded-2xl border border-gray-700 p-3 space-y-2">

      {/* Big next-status button */}
      {nextStatus ? (
        <button
          onClick={() => onStatusChange(nextStatus)}
          disabled={loading}
          className="w-full py-5 rounded-xl text-white font-black text-lg tracking-wide transition-all active:scale-95 shadow-lg disabled:opacity-50"
          style={{ backgroundColor: STATUS_COLORS[nextStatus] }}
        >
          {ICONS[nextStatus]} {STATUS_LABELS[nextStatus]}
        </button>
      ) : (
        <div className="w-full py-4 rounded-xl text-center text-gray-500 text-sm border border-gray-700">
          No further status updates
        </div>
      )}

      {/* Jump to other statuses */}
      <div>
        <button
          onClick={() => setShowOther(v => !v)}
          className="w-full text-gray-500 hover:text-gray-300 text-xs py-1 transition-colors"
        >
          {showOther ? '▲ Hide' : '▼ Jump to other status'}
        </button>

        {showOther && (
          <div className="grid grid-cols-2 gap-1.5 mt-1.5">
            {otherStatuses.map(s => (
              <button
                key={s}
                disabled={loading}
                onClick={() => { onStatusChange(s); setShowOther(false); }}
                className="py-2.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs font-semibold border border-gray-600 transition-colors active:scale-95"
              >
                {ICONS[s]} {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* OOS */}
      <button
        onClick={() => onStatusChange('out_of_service')}
        disabled={loading}
        className="w-full py-2 rounded-xl bg-gray-700 hover:bg-gray-600 text-gray-500 hover:text-red-400 border border-gray-600 text-xs font-medium transition-colors"
      >
        ⛔ Out of Service
      </button>
    </div>
  );
}
