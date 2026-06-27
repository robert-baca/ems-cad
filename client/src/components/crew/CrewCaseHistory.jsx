import { useState, useEffect } from 'react';
import { getMyCallHistory } from '../../services/api';
import { STATUS_COLORS, STATUS_LABELS } from '../../data/mockData';
import CallSummaryModal from '../calls/CallSummaryModal';

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function durationMin(startIso, endIso) {
  if (!startIso || !endIso) return null;
  return Math.round((new Date(endIso) - new Date(startIso)) / 60000);
}

export default function CrewCaseHistory({ units, onClose }) {
  const [calls,        setCalls]        = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [selectedCall, setSelectedCall] = useState(null);

  useEffect(() => {
    getMyCallHistory()
      .then(r => setCalls(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="fixed inset-0 z-40 bg-gray-900 flex flex-col max-w-md mx-auto">
      {selectedCall && (
        <CallSummaryModal call={selectedCall} units={units} onClose={() => setSelectedCall(null)} />
      )}

      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 flex-shrink-0">
        <span className="text-white font-bold text-base">My Cases</span>
        <button onClick={onClose}
          className="text-gray-400 hover:text-white w-8 h-8 flex items-center justify-center rounded hover:bg-gray-700 text-xl">
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading ? (
          <div className="text-gray-500 text-sm text-center mt-8">Loading…</div>
        ) : calls.length === 0 ? (
          <div className="text-gray-500 text-sm text-center mt-8">No cases yet</div>
        ) : (
          calls.map(call => {
            const respMin = durationMin(call.received_at, call.on_scene_at);
            const durMin  = durationMin(call.received_at, call.cleared_at || call.closed_at);
            const color   = STATUS_COLORS[call.status] || '#9ca3af';
            return (
              <button
                key={call.id}
                onClick={() => setSelectedCall(call)}
                className="w-full text-left bg-gray-800 rounded-xl border border-gray-700 px-3 py-2.5 active:bg-gray-700 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-white font-bold text-sm truncate">
                    #{call.call_number} · {call.call_type}
                  </span>
                  <span className="text-xs font-medium flex-shrink-0" style={{ color }}>
                    {STATUS_LABELS[call.status] || call.status}
                  </span>
                </div>
                <div className="text-gray-500 text-xs mt-0.5">{fmtDate(call.received_at)}</div>
                <div className="flex gap-3 text-xs mt-1 text-gray-400">
                  {respMin !== null && <span>Response {respMin}m</span>}
                  {durMin !== null && <span>Duration {durMin}m</span>}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
