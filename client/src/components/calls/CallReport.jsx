import { STATUS_LABELS } from '../../data/mockData';
import { STEPS } from './CallTimeline';

function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

function fmtDuration(ms) {
  if (ms == null || ms < 0) return '';
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `+${m}m ${s}s`;
}

// One row per timeline step, in order, carrying the elapsed time since the
// previous step that actually happened — mirrors CallTimeline's own step
// list so the printed record and the live editor never drift apart.
function buildTimelineRows(call) {
  let prevTime = null;
  return STEPS.map(step => {
    const iso = call[step.tsField];
    const elapsedMs = iso && prevTime ? new Date(iso) - prevTime : null;
    if (iso) prevTime = new Date(iso);
    return { label: step.label, iso, elapsedMs };
  });
}

export default function CallReport({ call, unit, additionalUnits = [], onClose }) {
  const rows = buildTimelineRows(call);
  const hasUnits = !!unit || additionalUnits.length > 0;
  const mutualAid = call.mutual_aid_agencies || [];
  const comments = call.comments || [];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 print:static print:bg-white print:p-0"
      onClick={onClose}
    >
      <div
        id="call-report-print"
        onClick={e => e.stopPropagation()}
        className="bg-white text-gray-900 w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl shadow-2xl print:max-h-none print:overflow-visible print:shadow-none print:rounded-none print:max-w-none print:w-full"
      >
        <div className="p-6 space-y-5 text-sm">
          {/* Header */}
          <div className="flex items-start justify-between border-b border-gray-300 pb-3">
            <div>
              <div className="text-xl font-bold">Incident Report — Case #{call.call_number}</div>
              <div className="text-gray-600">
                {call.call_type}{call.chief_complaint ? ` — ${call.chief_complaint}` : ''}
              </div>
            </div>
            <div className="text-right text-xs text-gray-500 flex-shrink-0 ml-3">
              <div>Priority {call.priority}</div>
              <div>{STATUS_LABELS[call.status] || call.status}</div>
            </div>
          </div>

          {/* Key facts */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            <Fact label="Location" value={call.location_name || '—'} />
            <Fact label="Park Zone" value={call.park_zone || '—'} />
            <Fact label="Received" value={fmtDateTime(call.received_at)} />
            <Fact label="Closed" value={fmtDateTime(call.closed_at)} />
            <Fact label="Disposition" value={call.disposition || '—'} />
            <Fact
              label="Response"
              value={call.response_mode === 'cart' ? 'Cart' : call.response_mode === 'foot' ? 'On Foot' : '—'}
            />
          </div>

          <Section title="Units">
            {hasUnits ? (
              <div className="space-y-1">
                {unit && (
                  <div>
                    <span className="font-semibold">{unit.unit_number}</span>
                    <span className="text-gray-500 text-xs ml-1.5">Primary{unit.crew ? ` · ${unit.crew}` : ''}</span>
                  </div>
                )}
                {additionalUnits.map(u => (
                  <div key={u.id}>
                    <span className="font-semibold">{u.unit_number}</span>
                    <span className="text-gray-500 text-xs ml-1.5">Additional{u.crew ? ` · ${u.crew}` : ''}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-gray-400">No unit assigned</div>
            )}
          </Section>

          {mutualAid.length > 0 && (
            <Section title="Mutual Aid / Outside Agencies">
              <div className="space-y-0.5">
                {mutualAid.map(a => (
                  <div key={a.id}>
                    {a.name}{a.unit_id ? ` — ${a.unit_id}` : ''}{a.role ? ` (${a.role})` : ''}
                  </div>
                ))}
              </div>
            </Section>
          )}

          <Section title="Timeline">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className="py-1 font-medium">Step</th>
                  <th className="py-1 font-medium">Time</th>
                  <th className="py-1 font-medium">Elapsed</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.label} className="border-b border-gray-100">
                    <td className={`py-1 ${r.iso ? '' : 'text-gray-400'}`}>{r.label}</td>
                    <td className={`py-1 font-mono ${r.iso ? '' : 'text-gray-400'}`}>{r.iso ? fmtDateTime(r.iso) : '—'}</td>
                    <td className="py-1 font-mono text-gray-500">{fmtDuration(r.elapsedMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="Narrative">
            <p className="whitespace-pre-wrap text-gray-800">{call.narrative || '—'}</p>
          </Section>

          {call.close_notes && (
            <Section title="Close Notes">
              <p className="whitespace-pre-wrap text-gray-800">{call.close_notes}</p>
            </Section>
          )}

          {comments.length > 0 && (
            <Section title="Comments Log">
              <div className="space-y-1">
                {comments.map((c, i) => (
                  <div key={c.id || i} className="text-xs">
                    <span className="text-gray-500">{fmtDateTime(c.created_at)}</span>{' '}
                    <span className="font-semibold">{c.author}:</span> {c.text}
                  </div>
                ))}
              </div>
            </Section>
          )}

          <div className="text-[10px] text-gray-400 pt-2 border-t border-gray-200">
            Generated {fmtDateTime(new Date().toISOString())} · SFOT EMS CAD
          </div>
        </div>

        {/* Controls — hidden on the printed page itself */}
        <div className="print:hidden flex gap-2 p-4 border-t border-gray-200 sticky bottom-0 bg-white">
          <button
            onClick={() => window.print()}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold rounded-lg transition-colors"
          >
            🖨 Print / Save as PDF
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="text-gray-500 w-16 flex-shrink-0">{label}</span>
      <span className="text-gray-900">{value}</span>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <div className="text-gray-500 text-xs uppercase tracking-wider font-semibold mb-1">{title}</div>
      {children}
    </div>
  );
}
