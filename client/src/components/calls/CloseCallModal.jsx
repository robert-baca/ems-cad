import { useState } from 'react';

const DISPOSITIONS = [
  { id: 'transported',     label: 'Transported to Hospital',       icon: '🏥' },
  { id: 'treated_refused', label: 'Treated / Refused Transport',   icon: '🩺' },
  { id: 'refused_care',    label: 'Patient Refused Care',          icon: '🚫' },
  { id: 'no_patient',      label: 'No Patient Found',              icon: '🔍' },
  { id: 'cancelled',       label: 'Cancelled / False Alarm',       icon: '❌' },
  { id: 'standby',         label: 'Standby / No Treatment Needed', icon: '✅' },
  { id: 'doa',             label: 'Patient DOA',                   icon: '🕯️' },
  { id: 'transferred',     label: 'Transferred to Other Agency',   icon: '🔄' },
];

export default function CloseCallModal({ call, onConfirm, onClose }) {
  const [disposition, setDisposition] = useState('');
  const [comment,     setComment]     = useState('');
  const [closing,     setClosing]     = useState(false);
  const [error,       setError]       = useState('');

  const handleClose = async () => {
    if (!disposition)       { setError('Select a closing disposition.'); return; }
    setClosing(true);
    setError('');
    try {
      await onConfirm(call.id, disposition, comment.trim());
    } catch {
      setError('Failed to close call. Try again.');
      setClosing(false);
    }
  };

  const chosen = DISPOSITIONS.find(d => d.id === disposition);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-2xl w-full max-w-sm shadow-2xl border border-gray-700">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
          <div>
            <div className="text-white font-bold">Close Call #{call.call_number}</div>
            <div className="text-gray-400 text-xs">{call.call_type} · P{call.priority}</div>
          </div>
          <button onClick={onClose}
            className="text-gray-400 hover:text-white w-8 h-8 flex items-center justify-center rounded hover:bg-gray-700 text-xl">
            ×
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Closing comment — required, shown first */}
          <div>
            <label className="block text-gray-300 text-xs uppercase tracking-wider mb-1.5 font-semibold">
              Closing Comment <span className="text-gray-500 normal-case font-normal">(optional)</span>
            </label>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="e.g. Transported to JPS, pt stable, GCS 15…"
              rows={3}
              autoFocus
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500 resize-none"
            />
          </div>

          {/* Disposition */}
          <div>
            <div className="text-gray-400 text-xs uppercase tracking-wider mb-2">
              Disposition <span className="text-red-400">*</span>
            </div>
            <div className="grid grid-cols-1 gap-1.5">
              {DISPOSITIONS.map(d => (
                <button
                  key={d.id}
                  onClick={() => { setDisposition(d.id); setError(''); }}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg text-left text-sm transition-colors
                    ${disposition === d.id
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                >
                  <span className="text-base">{d.icon}</span>
                  <span className="font-medium">{d.label}</span>
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-700 flex gap-3">
          <button onClick={onClose}
            className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded-lg transition-colors">
            Cancel
          </button>
          <button onClick={handleClose} disabled={closing}
            className="flex-1 py-2.5 bg-red-700 hover:bg-red-600 disabled:bg-red-900 text-white font-semibold text-sm rounded-lg transition-colors">
            {closing ? 'Closing…' : chosen ? `Close — ${chosen.icon}` : 'Close Call'}
          </button>
        </div>
      </div>
    </div>
  );
}
