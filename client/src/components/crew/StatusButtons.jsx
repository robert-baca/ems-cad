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
  const isOos     = currentStatus === 'out_of_service';
  const currentIdx = SEQUENCE.indexOf(currentStatus);
  const nextStatus = SEQUENCE[currentIdx + 1] ?? null;

  return (
    <div className="bg-gray-800 rounded-2xl border border-gray-700 p-3 space-y-2">

      {isOos ? (
        /* Out of service — show big In Service button */
        <button
          onClick={() => onStatusChange('available')}
          disabled={loading}
          className="w-full py-5 rounded-xl text-white font-black text-lg tracking-wide transition-all active:scale-95 shadow-lg disabled:opacity-50"
          style={{ backgroundColor: '#16a34a' }}
        >
          ✅ In Service
        </button>
      ) : nextStatus ? (
        /* Normal flow — only show the next sequential status */
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

      {/* OOS button — hidden when already out of service */}
      {!isOos && (
        <button
          onClick={() => onStatusChange('out_of_service')}
          disabled={loading}
          className="w-full py-2 rounded-xl bg-gray-700 hover:bg-gray-600 text-gray-500 hover:text-red-400 border border-gray-600 text-xs font-medium transition-colors"
        >
          ⛔ Out of Service
        </button>
      )}
    </div>
  );
}
