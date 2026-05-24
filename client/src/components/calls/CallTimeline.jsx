import { useState } from 'react';

const STEPS = [
  { label: 'Received',           tsField: 'received_at' },
  { label: 'Dispatched',         tsField: 'dispatched_at' },
  { label: 'Acknowledged',       tsField: 'acknowledged_at' },
  { label: 'En Route',           tsField: 'en_route_at' },
  { label: 'On Scene',           tsField: 'on_scene_at' },
  { label: 'Patient Contact',    tsField: 'patient_contact_at' },
  { label: 'Arrived at First Aid', tsField: 'arrived_first_aid_at' },
  { label: 'Transporting',       tsField: 'transporting_at' },
  { label: 'Cleared',            tsField: 'cleared_at' },
  { label: 'Available',          tsField: 'available_at' }
];

function fmtTime(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

// Parse "HH:MM" or "HH:MM:SS" entered by user → ISO string (today's date)
function parseManualTime(str) {
  const parts = str.trim().split(':').map(Number);
  if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return null;
  const d = new Date();
  d.setHours(parts[0], parts[1], parts[2] || 0, 0);
  return d.toISOString();
}

function TimeRow({ step, ts, isLast, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState('');
  const done = !!ts;

  const startEdit = () => {
    setInputVal(ts ? fmtTime(ts).replace(/ AM| PM/i, '') : '');
    setEditing(true);
  };

  const commit = () => {
    if (inputVal.trim()) {
      const iso = parseManualTime(inputVal);
      if (iso) onUpdate(step.tsField, iso);
    }
    setEditing(false);
  };

  const handleKey = (e) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') setEditing(false);
  };

  return (
    <div className="flex items-start gap-3 group">
      {/* Dot + connector */}
      <div className="flex flex-col items-center flex-shrink-0">
        <div className={`w-4 h-4 rounded-full mt-0.5 flex items-center justify-center
          ${done ? 'bg-green-500' : 'bg-gray-600 border border-gray-500'}`}>
          {done && (
            <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" viewBox="0 0 12 12">
              <path d="M2 6l3 3 5-5" />
            </svg>
          )}
        </div>
        {!isLast && <div className={`w-0.5 h-5 mt-0.5 ${done ? 'bg-green-500' : 'bg-gray-600'}`} />}
      </div>

      {/* Label + time */}
      <div className="flex justify-between items-center w-full pb-1 min-w-0">
        <span className={`text-sm ${done ? 'text-gray-200' : 'text-gray-500'}`}>
          {step.label}
        </span>

        {editing ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              type="text"
              value={inputVal}
              onChange={e => setInputVal(e.target.value)}
              onBlur={commit}
              onKeyDown={handleKey}
              placeholder="HH:MM"
              className="w-20 bg-gray-700 text-white text-xs font-mono rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-blue-500 border border-blue-500"
            />
            <button onClick={commit}
              className="text-green-400 hover:text-green-300 text-xs">✓</button>
            <button onClick={() => setEditing(false)}
              className="text-gray-500 hover:text-gray-300 text-xs">✕</button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className={`text-xs font-mono ${done ? 'text-green-400' : 'text-gray-600'}`}>
              {ts ? fmtTime(ts) : '—'}
            </span>
            <button
              onClick={startEdit}
              className="text-gray-600 hover:text-blue-400 text-xs transition-colors"
              title="Edit time"
            >
              ✏️
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function CallTimeline({ call, onTimestampUpdate }) {
  return (
    <div className="space-y-0.5">
      {STEPS.map((step, i) => (
        <TimeRow
          key={step.tsField}
          step={step}
          ts={call[step.tsField]}
          isLast={i === STEPS.length - 1}
          onUpdate={(field, iso) => onTimestampUpdate?.(field, iso)}
        />
      ))}
    </div>
  );
}
