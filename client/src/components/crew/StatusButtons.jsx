import { useState } from 'react';
import { STATUS_LABELS, STATUS_COLORS } from '../../data/mockData';

const SEQUENCE = ['dispatched', 'acknowledged', 'en_route', 'on_scene', 'patient_contact', 'transporting', 'cleared'];

const ICONS = {
  acknowledged:    '👁️',
  en_route:        '🔵',
  on_scene:        '🟠',
  patient_contact: '🔴',
  transporting:    '🏥',
  cleared:         '⚪',
  available:       '🟢',
};

export default function StatusButtons({ currentStatus, onStatusChange, onUndo, loading, hasCall }) {
  const [confirmingOos, setConfirmingOos] = useState(false);
  const isOos      = currentStatus === 'out_of_service';
  const currentIdx = SEQUENCE.indexOf(currentStatus);
  // Only show the next sequential button when the unit is actually on a call
  const nextStatus = hasCall ? (SEQUENCE[currentIdx + 1] ?? null) : null;
  // A misclick otherwise has no self-service fix — only ever the next button
  // forward, no way back without radioing dispatch. This only reverts this
  // unit's own status; it deliberately doesn't touch the call's shared
  // record (that stays dispatch's call, via the Timestamps editor).
  const prevStatus = hasCall && currentIdx > 0 ? SEQUENCE[currentIdx - 1] : null;

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

      {/* Misclick fix — small and out of the way of the main action button */}
      {!isOos && prevStatus && (
        <button
          onClick={() => onUndo?.(prevStatus)}
          disabled={loading}
          className="w-full py-1.5 text-gray-500 hover:text-gray-300 text-xs font-medium transition-colors"
        >
          ↩ Wrong button? Back to {STATUS_LABELS[prevStatus]}
        </button>
      )}

      {/* OOS button — hidden when already out of service. A single un-confirmed
          tap here (including mid-call) had no safety net against a mis-tap
          taking the unit off duty; now it takes a second deliberate tap. */}
      {!isOos && (
        confirmingOos ? (
          <div className="flex gap-2">
            <button
              onClick={() => { setConfirmingOos(false); onStatusChange('out_of_service'); }}
              disabled={loading}
              className="flex-1 py-2 rounded-xl bg-red-700 hover:bg-red-600 text-white text-xs font-bold transition-colors"
            >
              {hasCall ? 'Confirm — still on this call' : 'Confirm Out of Service'}
            </button>
            <button
              onClick={() => setConfirmingOos(false)}
              disabled={loading}
              className="px-4 py-2 rounded-xl bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs font-medium transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmingOos(true)}
            disabled={loading}
            className="w-full py-2 rounded-xl bg-gray-700 hover:bg-gray-600 text-gray-500 hover:text-red-400 border border-gray-600 text-xs font-medium transition-colors"
          >
            ⛔ Out of Service
          </button>
        )
      )}
    </div>
  );
}
