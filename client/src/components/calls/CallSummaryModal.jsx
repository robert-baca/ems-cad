import { STATUS_COLORS, STATUS_LABELS } from '../../data/mockData';

const PRIORITY_LABELS = { 1: 'P1 — High Acuity', 2: 'P2 — Medium Acuity', 3: 'P3 — Low Acuity' };
const PRIORITY_COLORS = { 1: 'text-red-400', 2: 'text-orange-400', 3: 'text-blue-400' };

const TS_STEPS = [
  { label: 'Received',             field: 'received_at' },
  { label: 'Dispatched',           field: 'dispatched_at' },
  { label: 'Acknowledged',         field: 'acknowledged_at' },
  { label: 'En Route',             field: 'en_route_at' },
  { label: 'On Scene',             field: 'on_scene_at' },
  { label: 'Patient Contact',      field: 'patient_contact_at' },
  { label: 'Transporting',         field: 'transporting_at' },
  { label: 'Arrived at First Aid', field: 'arrived_first_aid_at' },
  { label: 'Cleared',              field: 'cleared_at' },
  { label: 'Available',            field: 'available_at' },
];

function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function durationStr(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const mins = Math.round((new Date(endIso) - new Date(startIso)) / 60000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function Row({ label, value }) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex gap-2">
      <span className="text-gray-500 text-xs w-24 flex-shrink-0 pt-0.5">{label}</span>
      <span className="text-gray-200 text-sm leading-snug">{value}</span>
    </div>
  );
}

function StatBox({ label, value }) {
  return (
    <div className="bg-gray-700 rounded-xl px-3 py-2.5 text-center">
      <div className="text-white font-bold text-xl">{value}</div>
      <div className="text-gray-400 text-xs mt-0.5">{label}</div>
    </div>
  );
}

function ReadOnlyTimeline({ call }) {
  return (
    <div className="space-y-1">
      {TS_STEPS.map((step, i) => {
        const ts = call[step.field];
        const isLast = i === TS_STEPS.length - 1;
        return (
          <div key={step.field} className="flex items-start gap-3">
            <div className="flex flex-col items-center flex-shrink-0">
              <div className={`w-3.5 h-3.5 rounded-full mt-0.5 flex items-center justify-center
                ${ts ? 'bg-green-500' : 'bg-gray-600 border border-gray-500'}`}>
                {ts && (
                  <svg className="w-2 h-2 text-white" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" viewBox="0 0 12 12">
                    <path d="M2 6l3 3 5-5" />
                  </svg>
                )}
              </div>
              {!isLast && <div className={`w-0.5 h-4 mt-0.5 ${ts ? 'bg-green-500' : 'bg-gray-600'}`} />}
            </div>
            <div className="flex justify-between w-full pb-0.5">
              <span className={`text-sm ${ts ? 'text-gray-200' : 'text-gray-600'}`}>{step.label}</span>
              <span className={`text-xs font-mono ${ts ? 'text-green-400' : 'text-gray-700'}`}>
                {fmtTime(ts)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function CallSummaryModal({ call, units, onClose }) {
  if (!call) return null;

  const liveUnit    = units.find(u => u.id === call.assigned_unit_id);
  const unitDisplay = liveUnit?.unit_number || call.assigned_unit_number || '—';
  const statusColor = STATUS_COLORS[call.status] || '#9ca3af';

  const responseTime    = durationStr(call.received_at, call.on_scene_at);
  const totalDuration   = durationStr(call.received_at, call.closed_at || call.cleared_at);
  const sceneTime       = durationStr(call.on_scene_at, call.cleared_at);

  const additionalUnits = (call.additional_unit_ids || [])
    .map(id => units.find(u => u.id === id))
    .filter(Boolean);

  const hasStats = responseTime || totalDuration || sceneTime;

  return (
    <div className="absolute inset-0 z-20 bg-black/70 flex items-start justify-center overflow-y-auto p-4">
      <div className="bg-gray-800 rounded-2xl border border-gray-600 w-full max-w-lg shadow-2xl my-auto">

        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-700">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-white font-bold text-lg">Case #{call.call_number}</span>
              <span className={`text-sm font-semibold ${PRIORITY_COLORS[call.priority] || 'text-gray-400'}`}>
                {PRIORITY_LABELS[call.priority] || `P${call.priority}`}
              </span>
            </div>
            <div className="text-gray-300 text-sm mt-0.5">{call.call_type}</div>
            <div className="text-gray-500 text-xs mt-1">{fmtDateTime(call.received_at)}</div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0 ml-4">
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full"
              style={{ color: statusColor, background: statusColor + '22' }}>
              {STATUS_LABELS[call.status] || call.status}
            </span>
            <button onClick={onClose}
              className="text-gray-400 hover:text-white w-8 h-8 flex items-center justify-center rounded hover:bg-gray-700 text-xl">
              ×
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">

          {/* Quick stats */}
          {hasStats && (
            <div className={`grid gap-2 ${[responseTime, sceneTime, totalDuration].filter(Boolean).length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
              {responseTime  && <StatBox label="Response time"  value={responseTime} />}
              {sceneTime     && <StatBox label="Scene time"     value={sceneTime} />}
              {totalDuration && <StatBox label="Total duration" value={totalDuration} />}
            </div>
          )}

          {/* Call info */}
          <div className="bg-gray-700 rounded-xl p-3 space-y-1.5">
            <div className="text-gray-400 text-xs uppercase tracking-wider mb-2">Call Info</div>
            <Row label="Location"  value={call.location_name} />
            <Row label="Zone"      value={call.park_zone} />
            <Row label="Complaint" value={call.chief_complaint} />
            <Row label="Response"  value={
              call.response_mode === 'cart' ? '🛺 Cart' :
              call.response_mode === 'foot' ? '🚶 On Foot' :
              call.response_mode || null
            } />
            <Row label="Notes"     value={call.notes} />
          </div>

          {/* Units */}
          <div className="bg-gray-700 rounded-xl p-3 space-y-2">
            <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">Units</div>
            <div className="flex items-center gap-2">
              <span className="text-white font-semibold text-sm">{unitDisplay}</span>
              <span className="text-gray-500 text-xs bg-gray-600 px-1.5 py-0.5 rounded">Primary</span>
            </div>
            {additionalUnits.map(u => (
              <div key={u.id} className="flex items-center gap-2">
                <span className="text-gray-300 font-medium text-sm">{u.unit_number}</span>
                <span className="text-gray-500 text-xs bg-gray-600 px-1.5 py-0.5 rounded">Additional</span>
              </div>
            ))}
            {(call.mutual_aid_agencies || []).map(a => (
              <div key={a.id} className="flex items-center gap-2 flex-wrap">
                <span className="text-gray-300 font-medium text-sm">{a.name}</span>
                {a.unit_id && <span className="text-gray-400 text-xs">{a.unit_id}</span>}
                <span className="text-gray-500 text-xs bg-gray-600 px-1.5 py-0.5 rounded">
                  {a.role || 'Mutual Aid'}
                </span>
              </div>
            ))}
          </div>

          {/* Outcome */}
          {(call.disposition || call.close_notes) && (
            <div className="bg-gray-700 rounded-xl p-3 space-y-2">
              <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">Outcome</div>
              {call.disposition && (
                <span className="inline-block bg-gray-600 text-gray-100 text-sm font-medium px-3 py-1 rounded-lg">
                  {call.disposition}
                </span>
              )}
              {call.close_notes && (
                <p className="text-gray-300 text-sm leading-relaxed">{call.close_notes}</p>
              )}
            </div>
          )}

          {/* Narrative */}
          {call.narrative && (
            <div className="bg-gray-700 rounded-xl p-3">
              <div className="text-gray-400 text-xs uppercase tracking-wider mb-2">Narrative</div>
              <p className="text-gray-200 text-sm leading-relaxed whitespace-pre-wrap">{call.narrative}</p>
            </div>
          )}

          {/* Timeline */}
          <div className="bg-gray-700 rounded-xl p-3">
            <div className="text-gray-400 text-xs uppercase tracking-wider mb-3">Timeline</div>
            <ReadOnlyTimeline call={call} />
          </div>

          {/* Comments */}
          {(call.comments || []).length > 0 && (
            <div className="bg-gray-700 rounded-xl p-3">
              <div className="text-gray-400 text-xs uppercase tracking-wider mb-3">
                Comments ({call.comments.length})
              </div>
              <div className="space-y-2">
                {call.comments.map(c => (
                  <div key={c.id} className="bg-gray-600 rounded-lg px-3 py-2">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-blue-300 text-xs font-semibold">{c.author}</span>
                      <span className="text-gray-500 text-xs font-mono">{fmtTime(c.created_at)}</span>
                    </div>
                    <p className="text-gray-200 text-sm">{c.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
