import { useMemo } from 'react';
import { STATUS_COLORS, STATUS_LABELS } from '../../data/mockData';

const TYPE_ICONS = { ALS: '🚑', BLS: '🚐', Bike: '🚲', Cart: '🛺' };

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function durMin(a, b) {
  if (!a || !b) return null;
  return Math.round((new Date(b) - new Date(a)) / 60000);
}

const PRI_COLORS = { 1: 'text-red-400', 2: 'text-orange-400', 3: 'text-blue-400' };

export default function UnitHistoryModal({ unit, calls, onClose }) {
  const unitCalls = useMemo(() =>
    [...calls]
      .filter(c => c.assigned_unit_id === unit.id)
      .sort((a, b) => new Date(b.received_at) - new Date(a.received_at)),
    [calls, unit.id]
  );

  const closedCalls = unitCalls.filter(c => c.status === 'closed');
  const avgResp = useMemo(() => {
    const times = closedCalls.map(c => durMin(c.received_at, c.on_scene_at)).filter(Boolean);
    return times.length ? Math.round(times.reduce((a, b) => a + b) / times.length) : null;
  }, [closedCalls]);

  const color = STATUS_COLORS[unit.status] || '#9ca3af';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-gray-800 rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl border border-gray-700">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{TYPE_ICONS[unit.unit_type] || '🚑'}</span>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-white font-bold text-lg">{unit.unit_number}</span>
                <span className="text-gray-400 text-sm">{unit.unit_name}</span>
                <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{ color, backgroundColor: color + '22' }}>
                  {STATUS_LABELS[unit.status]}
                </span>
              </div>
              <div className="text-gray-400 text-xs mt-0.5">
                {unit.unit_type} · {unitCalls.length} calls today
                {avgResp !== null && ` · Avg response ${avgResp}m`}
              </div>
            </div>
          </div>
          <button onClick={onClose}
            className="text-gray-400 hover:text-white w-9 h-9 flex items-center justify-center rounded-lg hover:bg-gray-700 text-xl">
            ×
          </button>
        </div>

        {/* Stats */}
        {unitCalls.length > 0 && (
          <div className="grid grid-cols-3 gap-3 px-5 py-3 border-b border-gray-700 flex-shrink-0">
            <Stat label="Total Calls" value={unitCalls.length} />
            <Stat label="Completed"   value={closedCalls.length} />
            <Stat label="Avg Response" value={avgResp !== null ? `${avgResp}m` : '—'} />
          </div>
        )}

        {/* Call list */}
        <div className="flex-1 overflow-y-auto">
          {unitCalls.length === 0 ? (
            <div className="text-center text-gray-500 py-12">
              <div className="text-3xl mb-2">📋</div>
              No calls assigned today
            </div>
          ) : (
            <div className="divide-y divide-gray-700">
              {unitCalls.map(call => {
                const resp = durMin(call.received_at, call.on_scene_at);
                const total = durMin(call.received_at, call.cleared_at);
                const callColor = STATUS_COLORS[call.status] || '#9ca3af';

                return (
                  <div key={call.id} className="px-5 py-3.5 hover:bg-gray-700/50 transition-colors">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-white font-bold text-sm">#{call.call_number}</span>
                          <span className={`text-xs font-semibold ${PRI_COLORS[call.priority]}`}>
                            P{call.priority}
                          </span>
                          <span className="text-xs font-medium" style={{ color: callColor }}>
                            {STATUS_LABELS[call.status]}
                          </span>
                        </div>
                        <div className="text-gray-200 text-sm font-medium">{call.call_type}</div>
                        <div className="text-gray-400 text-xs mt-0.5 truncate">{call.location_name}</div>
                        {call.chief_complaint && (
                          <div className="text-gray-500 text-xs mt-1 truncate italic">
                            "{call.chief_complaint}"
                          </div>
                        )}
                        {call.comments?.length > 0 && (
                          <div className="text-blue-400 text-xs mt-1">
                            💬 {call.comments.length} comment{call.comments.length !== 1 ? 's' : ''}
                          </div>
                        )}
                      </div>

                      {/* Time column */}
                      <div className="text-right flex-shrink-0 space-y-1 text-xs font-mono">
                        <div className="text-gray-400">{fmtTime(call.received_at)}</div>
                        {call.on_scene_at && (
                          <div className="text-orange-400">
                            On Scene {fmtTime(call.on_scene_at)}
                          </div>
                        )}
                        {call.cleared_at && (
                          <div className="text-gray-500">
                            Cleared {fmtTime(call.cleared_at)}
                          </div>
                        )}
                        <div className="flex gap-3 justify-end mt-1">
                          {resp !== null && (
                            <span className={resp < 10 ? 'text-green-400' : resp < 20 ? 'text-yellow-400' : 'text-red-400'}>
                              Resp {resp}m
                            </span>
                          )}
                          {total !== null && (
                            <span className="text-gray-500">Total {total}m</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="text-center">
      <div className="text-white font-bold text-lg">{value}</div>
      <div className="text-gray-400 text-xs">{label}</div>
    </div>
  );
}
