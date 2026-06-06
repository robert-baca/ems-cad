import { STATUS_LABELS, STATUS_COLORS } from '../../data/mockData';

// Buttons the crew can tap, in logical call flow order
const BUTTONS = [
  { status: 'acknowledged',   label: 'Acknowledged',   icon: '👁️' },
  { status: 'en_route',       label: 'En Route',        icon: '🔵' },
  { status: 'on_scene',       label: 'On Scene',        icon: '🟠' },
  { status: 'patient_contact', label: 'Patient Contact', icon: '🔴' },
  { status: 'transporting',   label: 'Transporting',   icon: '🏥' },
  { status: 'cleared',        label: 'Cleared',         icon: '⚪' },
  { status: 'available',      label: 'Available',       icon: '🟢' }
];

const SEQUENCE = ['dispatched', 'acknowledged', 'en_route', 'on_scene', 'patient_contact', 'transporting', 'cleared', 'available'];

export default function StatusButtons({ currentStatus, onStatusChange, loading }) {
  const currentIdx = SEQUENCE.indexOf(currentStatus);

  return (
    <div className="bg-gray-800 rounded-2xl overflow-hidden border border-gray-700">
      <div className="px-4 py-3 border-b border-gray-700">
        <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">Update Status</div>
        <div className="flex items-center gap-2">
          <div
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: STATUS_COLORS[currentStatus] || '#9ca3af' }}
          />
          <span className="text-white font-semibold">{STATUS_LABELS[currentStatus]}</span>
        </div>
      </div>

      <div className="p-3 space-y-2">
        {BUTTONS.map(({ status, label, icon }) => {
          const idx = SEQUENCE.indexOf(status);
          const isCurrent = status === currentStatus;
          const isNext = idx === currentIdx + 1;
          const isPast = idx <= currentIdx && !isCurrent;

          return (
            <button
              key={status}
              disabled={isPast || loading}
              onClick={() => !isPast && !isCurrent && onStatusChange(status)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all font-medium
                ${isCurrent
                  ? 'border-2 cursor-default opacity-100'
                  : isNext
                    ? 'text-white shadow-lg scale-[1.01]'
                    : isPast
                      ? 'opacity-30 cursor-not-allowed bg-gray-700 text-gray-500'
                      : 'bg-gray-700 hover:bg-gray-600 text-gray-300 border border-gray-600'
                }`}
              style={
                isCurrent
                  ? { borderColor: STATUS_COLORS[status], color: STATUS_COLORS[status], backgroundColor: STATUS_COLORS[status] + '22' }
                  : isNext
                    ? { backgroundColor: STATUS_COLORS[status], color: '#fff' }
                    : {}
              }
            >
              <span className="text-lg">{icon}</span>
              <div>
                <div className={isNext ? 'font-bold' : ''}>{label}</div>
                {isNext && <div className="text-xs opacity-80">Tap to update →</div>}
                {isCurrent && <div className="text-xs opacity-70">Current status</div>}
              </div>
              {isNext && <span className="ml-auto text-xl">→</span>}
            </button>
          );
        })}
      </div>

      {/* OOS button */}
      <div className="px-3 pb-3">
        <button
          onClick={() => onStatusChange('out_of_service')}
          disabled={loading}
          className="w-full py-2.5 rounded-xl bg-gray-700 hover:bg-gray-600 text-gray-400 hover:text-red-400 border border-gray-600 text-sm font-medium transition-colors"
        >
          ⛔ Out of Service
        </button>
      </div>
    </div>
  );
}
