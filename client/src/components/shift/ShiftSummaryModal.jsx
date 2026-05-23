const DISPOSITION_LABELS = {
  transported:     'Transported to Hospital',
  treated_refused: 'Treated / Refused Transport',
  refused_care:    'Patient Refused Care',
  no_patient:      'No Patient Found',
  cancelled:       'Cancelled / False Alarm',
  standby:         'Standby / No Treatment',
  doa:             'Patient DOA',
  transferred:     'Transferred to Agency'
};

function fmt(min) {
  if (min == null) return '—';
  const m = Math.floor(min), s = Math.round((min - m) * 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function fmtDuration(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function Stat({ label, value, sub, color }) {
  return (
    <div className="bg-gray-700 rounded-xl p-4 text-center">
      <div className={`text-3xl font-bold ${color || 'text-white'}`}>{value}</div>
      <div className="text-gray-400 text-xs mt-1">{label}</div>
      {sub && <div className="text-gray-500 text-xs mt-0.5">{sub}</div>}
    </div>
  );
}

function printReport(summary, startDate, endDate, unitEntries, typeEntries, dispEntries) {
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><title>Shift Report — ${summary.shift_label}</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 32px; color: #111; max-width: 700px; margin: 0 auto; }
    h1 { font-size: 22px; margin-bottom: 4px; }
    .sub { color: #555; font-size: 13px; margin-bottom: 24px; }
    .stats { display: grid; grid-template-columns: repeat(4,1fr); gap: 12px; margin-bottom: 24px; }
    .stat { border: 1px solid #ddd; border-radius: 8px; padding: 12px; text-align: center; }
    .stat .val { font-size: 24px; font-weight: bold; }
    .stat .lbl { font-size: 11px; color: #666; margin-top: 2px; }
    .section { margin-bottom: 20px; }
    .section h3 { font-size: 13px; text-transform: uppercase; letter-spacing: .05em; color: #888; border-bottom: 1px solid #eee; padding-bottom: 4px; margin-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    td, th { padding: 6px 8px; text-align: left; border-bottom: 1px solid #eee; }
    th { font-weight: 600; color: #555; font-size: 11px; text-transform: uppercase; }
    @media print { body { padding: 16px; } }
  </style></head><body>
  <h1>Shift Report</h1>
  <div class="sub">${summary.shift_label} &nbsp;·&nbsp; ${startDate} → ${endDate} &nbsp;·&nbsp; Duration: ${fmtDuration(summary.duration_minutes)} &nbsp;·&nbsp; Started by: ${summary.started_by}</div>
  <div class="stats">
    <div class="stat"><div class="val">${summary.total_calls}</div><div class="lbl">Total Calls</div></div>
    <div class="stat"><div class="val">${summary.by_priority?.[1] ?? 0}</div><div class="lbl">Priority 1</div></div>
    <div class="stat"><div class="val">${fmt(summary.avg_response_minutes)}</div><div class="lbl">Avg Response</div></div>
    <div class="stat"><div class="val">${fmt(summary.avg_scene_minutes)}</div><div class="lbl">Avg Scene Time</div></div>
  </div>
  ${unitEntries.length ? `<div class="section"><h3>Calls by Unit</h3><table><tr><th>Unit</th><th>Calls</th></tr>${unitEntries.map(([u,c]) => `<tr><td>${u}</td><td>${c}</td></tr>`).join('')}</table></div>` : ''}
  ${typeEntries.length ? `<div class="section"><h3>Call Types</h3><table><tr><th>Type</th><th>Count</th></tr>${typeEntries.map(([t,c]) => `<tr><td>${t}</td><td>${c}</td></tr>`).join('')}</table></div>` : ''}
  ${dispEntries.length ? `<div class="section"><h3>Dispositions</h3><table><tr><th>Disposition</th><th>Count</th></tr>${dispEntries.map(([d,c]) => `<tr><td>${DISPOSITION_LABELS[d] || d}</td><td>${c}</td></tr>`).join('')}</table></div>` : ''}
  <script>window.onload = () => { window.print(); }</script></body></html>`);
  win.document.close();
}

export default function ShiftSummaryModal({ summary, onClose }) {
  if (!summary) return null;

  const startDate = new Date(summary.started_at).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
  const endDate = summary.ended_at
    ? new Date(summary.ended_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    : '—';

  const unitEntries = Object.entries(summary.by_unit || {}).sort((a, b) => b[1] - a[1]);
  const typeEntries = Object.entries(summary.by_type || {}).sort((a, b) => b[1] - a[1]);
  const dispEntries = Object.entries(summary.by_disposition || {}).sort((a, b) => b[1] - a[1]);

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-gray-800 rounded-2xl w-full max-w-2xl border border-gray-700 shadow-2xl my-4">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-gray-700">
          <div>
            <div className="text-white font-bold text-xl">Shift Summary</div>
            <div className="text-gray-400 text-sm mt-0.5">{summary.shift_label} · {startDate} → {endDate}</div>
            <div className="text-gray-500 text-xs mt-0.5">Duration: {fmtDuration(summary.duration_minutes)} · Started by: {summary.started_by}</div>
          </div>
          <button onClick={onClose}
            className="text-gray-400 hover:text-white w-9 h-9 flex items-center justify-center rounded-lg hover:bg-gray-700 text-xl flex-shrink-0">
            ×
          </button>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto max-h-[70vh]">
          {/* Top stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Total Calls"      value={summary.total_calls}             color="text-white" />
            <Stat label="Priority 1"       value={summary.by_priority?.[1] ?? 0}   color="text-red-400" />
            <Stat label="Priority 2"       value={summary.by_priority?.[2] ?? 0}   color="text-orange-400" />
            <Stat label="Priority 3"       value={summary.by_priority?.[3] ?? 0}   color="text-blue-400" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Stat label="Avg Response Time"
              value={fmt(summary.avg_response_minutes)}
              sub="dispatch → on scene"
              color="text-green-400" />
            <Stat label="Avg Scene Time"
              value={fmt(summary.avg_scene_minutes)}
              sub="on scene → cleared"
              color="text-yellow-400" />
          </div>

          {/* By unit */}
          {unitEntries.length > 0 && (
            <div>
              <div className="text-gray-400 text-xs uppercase tracking-wider mb-2">Calls by Unit</div>
              <div className="space-y-1.5">
                {unitEntries.map(([unit, count]) => (
                  <div key={unit} className="flex items-center gap-3">
                    <span className="text-white text-sm font-bold w-16 flex-shrink-0">{unit}</span>
                    <div className="flex-1 bg-gray-700 rounded-full h-2">
                      <div className="bg-blue-500 h-2 rounded-full"
                        style={{ width: `${Math.round(count / summary.total_calls * 100)}%` }} />
                    </div>
                    <span className="text-gray-300 text-sm font-bold w-6 text-right">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* By call type */}
          {typeEntries.length > 0 && (
            <div>
              <div className="text-gray-400 text-xs uppercase tracking-wider mb-2">Call Types</div>
              <div className="space-y-1.5">
                {typeEntries.map(([type, count]) => (
                  <div key={type} className="flex items-center gap-3">
                    <span className="text-gray-300 text-sm flex-1 truncate">{type}</span>
                    <span className="text-white text-sm font-bold">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Dispositions */}
          {dispEntries.length > 0 && (
            <div>
              <div className="text-gray-400 text-xs uppercase tracking-wider mb-2">Dispositions</div>
              <div className="space-y-1.5">
                {dispEntries.map(([disp, count]) => (
                  <div key={disp} className="flex items-center gap-3">
                    <span className="text-gray-300 text-sm flex-1">{DISPOSITION_LABELS[disp] || disp}</span>
                    <span className="text-white text-sm font-bold">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {summary.total_calls === 0 && (
            <div className="text-center text-gray-500 py-6">No calls this shift.</div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-700 flex gap-3">
          <button onClick={() => printReport(summary, startDate, endDate, unitEntries, typeEntries, dispEntries)}
            className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm rounded-lg transition-colors font-medium">
            🖨️ Print Report
          </button>
          <button onClick={onClose}
            className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors font-semibold">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
