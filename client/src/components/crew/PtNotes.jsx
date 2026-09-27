import { useState, useEffect } from 'react';
import { sendPtNote, viewPtNote } from '../../services/api';
import LicenseScanner from './LicenseScanner';

// Patient handoff notes between medics. This is protected health
// information: it's only ever held in memory here (never localStorage or
// the offline queue), and the server limits it to the sending and
// receiving unit and deletes it 48h after sending.

const FIELDS = [
  { key: 'name',        label: 'Name',            placeholder: 'Last, First' },
  { key: 'dob',         label: 'DOB',             placeholder: 'MM/DD/YYYY', inputMode: 'numeric' },
  { key: 'age',         label: 'Age',             placeholder: 'e.g. 34', inputMode: 'numeric' },
  { key: 'sex',         label: 'Sex',             options: ['M', 'F', 'Other'] },
  { key: 'address',     label: 'Address',         placeholder: 'Street, city, state, zip', multiline: true },
  { key: 'phone',       label: 'Phone',           placeholder: '(555) 555-5555', inputMode: 'tel' },
  { key: 'medical_hx',  label: 'Medical history', placeholder: 'e.g. HTN, DM2, asthma', multiline: true },
  { key: 'allergies',   label: 'Allergies',       placeholder: 'e.g. PCN, latex', multiline: true, quick: 'NKDA' },
  { key: 'medications', label: 'Medications',     placeholder: 'e.g. metformin, lisinopril', multiline: true },
  { key: 'notes',       label: 'Other notes',     placeholder: 'Anything else the receiving medic should know', multiline: true },
];

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function Header({ title, onBack, backLabel = '← Back' }) {
  return (
    <div className="flex items-center justify-between px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3 border-b border-gray-700 flex-shrink-0">
      <button onClick={onBack} className="text-gray-400 hover:text-white p-2 -ml-2 text-sm">{backLabel}</button>
      <span className="text-white font-bold text-base">{title}</span>
      <div className="w-14" />
    </div>
  );
}

function Compose({ myUnit, units, myActiveCall, onSent, onCancel }) {
  const [values, setValues] = useState({});
  const [toId, setToId] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scannedKeys, setScannedKeys] = useState([]); // fields filled from a license, for the check-it hint

  // Units someone could actually receive it on: not carts, not this unit.
  // Units on this same call first, then ones with a crew logged in.
  const onThisCall = (u) => myActiveCall && (myActiveCall.assigned_unit_id === u.id || (myActiveCall.additional_unit_ids || []).includes(u.id));
  const recipients = units
    .filter(u => u.id !== myUnit.id && u.unit_type !== 'Cart' && u.status !== 'out_of_service')
    .sort((a, b) =>
      (onThisCall(b) - onThisCall(a)) ||
      (!!b.crew - !!a.crew) ||
      a.unit_number.localeCompare(b.unit_number, undefined, { numeric: true }));

  const set = (k, v) => { setValues(prev => ({ ...prev, [k]: v })); setError(''); };
  const filled = Object.values(values).some(v => v && v.trim());

  const send = async () => {
    if (!toId) { setError('Pick who to send it to'); return; }
    if (!filled) { setError('Fill in at least one field'); return; }
    setSending(true);
    setError('');
    try {
      const res = await sendPtNote({ to_unit_id: toId, fields: values });
      onSent(res.data);
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not send — check your connection and try again');
      setSending(false);
    }
  };

  return (
    <>
      <Header title="New PT Notes" onBack={onCancel} backLabel="Cancel" />
      {scanning && (
        <LicenseScanner
          onClose={() => setScanning(false)}
          onResult={(fields) => {
            // Scanned values replace what's there for those fields only;
            // anything typed into the others (allergies, hx…) is kept.
            setValues(prev => ({ ...prev, ...fields }));
            setScannedKeys(Object.keys(fields));
            setScanning(false);
            setError('');
          }}
        />
      )}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <button onClick={() => setScanning(true)}
          className="w-full py-3 rounded-xl bg-gray-700 active:bg-gray-600 text-white text-sm font-semibold flex items-center justify-center gap-2">
          📷 Scan Driver License / ID
        </button>
        {scannedKeys.length > 0 && (
          <p className="text-green-400 text-xs">✓ Filled from the license — check it matches the patient before sending.</p>
        )}
        {FIELDS.map(f => (
          <div key={f.key}>
            <label className="block text-gray-400 text-xs mb-1">{f.label}</label>
            {f.options ? (
              <div className="flex gap-2">
                {f.options.map(o => (
                  <button key={o} onClick={() => set(f.key, values[f.key] === o ? '' : o)}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-semibold ${values[f.key] === o ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300'}`}>
                    {o}
                  </button>
                ))}
              </div>
            ) : f.multiline ? (
              <div className="flex gap-2 items-start">
                <textarea
                  value={values[f.key] || ''}
                  onChange={e => set(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  rows={2}
                  className="flex-1 bg-gray-700 text-white rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500 resize-none"
                />
                {f.quick && (
                  <button onClick={() => set(f.key, f.quick)}
                    className="px-3 py-2 rounded-lg bg-gray-700 text-gray-300 text-xs font-bold">{f.quick}</button>
                )}
              </div>
            ) : (
              <input
                value={values[f.key] || ''}
                onChange={e => set(f.key, e.target.value)}
                placeholder={f.placeholder}
                inputMode={f.inputMode}
                autoComplete="off"
                className="w-full bg-gray-700 text-white rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
              />
            )}
          </div>
        ))}

        <div className="pt-2">
          <label className="block text-gray-400 text-xs mb-1">Send to</label>
          <div className="space-y-1.5">
            {recipients.length === 0 && <div className="text-gray-500 text-sm">No other units in service right now.</div>}
            {recipients.map(u => (
              <button key={u.id} onClick={() => { setToId(u.id); setError(''); }}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-left text-sm ${
                  toId === u.id ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-200'}`}>
                <span className="font-semibold">{u.unit_number}{u.crew ? <span className="font-normal opacity-80"> · {u.crew}</span> : null}</span>
                {onThisCall(u) && <span className="text-xs opacity-80">on your call</span>}
              </button>
            ))}
          </div>
        </div>

        <p className="text-gray-500 text-[11px]">
          Patient info — only you and the medic you send it to can see it. Deleted automatically after 48 hours. Don't screenshot it.
        </p>
        {error && <p className="text-red-400 text-sm">{error}</p>}
      </div>
      <div className="p-4 border-t border-gray-700 flex-shrink-0">
        <button onClick={send} disabled={sending}
          className="w-full py-3.5 rounded-xl bg-blue-600 active:bg-blue-700 disabled:opacity-50 text-white font-bold text-sm">
          {sending ? 'Sending…' : '📤 Send PT Notes'}
        </button>
      </div>
    </>
  );
}

function NoteView({ note, myUnit, onBack, onViewed }) {
  const incoming = note.to_unit_id === myUnit.id;
  const [viewError, setViewError] = useState('');

  useEffect(() => {
    viewPtNote(note.id)
      .then(res => onViewed(note.id, res.data?.read_at))
      .catch(err => setViewError(err?.response?.status === 404 ? 'This note has expired or was removed.' : ''));
  }, [note.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Header title="PT Notes" onBack={onBack} />
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <div className="text-gray-400 text-xs">
          {incoming ? `From ${note.from_unit_number}${note.from_crew ? ` · ${note.from_crew}` : ''}` : `To ${note.to_unit_number}`}
          {' · '}{fmtTime(note.created_at)}
          {!incoming && (note.read_at ? ` · ✓ Read ${fmtTime(note.read_at)}` : ' · Not opened yet')}
        </div>
        {viewError && <p className="text-amber-400 text-sm">{viewError}</p>}
        {FIELDS.filter(f => note.fields?.[f.key]).map(f => (
          <div key={f.key} className="bg-gray-800 rounded-xl px-3 py-2.5 border border-gray-700">
            <div className="text-gray-400 text-[11px] uppercase tracking-wider">{f.label}</div>
            <div className="text-white text-base whitespace-pre-wrap break-words select-text">{note.fields[f.key]}</div>
          </div>
        ))}
        <p className="text-gray-500 text-[11px] pt-2">Deleted automatically 48 hours after it was sent.</p>
      </div>
    </>
  );
}

// backRef lets CrewMobile's native back button step out of a note/compose
// view before closing PT NOTES entirely (same pattern as BeaconMode).
export default function PtNotes({ myUnit, units, myActiveCall, notes, onNoteSent, onNoteViewed, onClose, backRef }) {
  const [view, setView] = useState('list'); // list | compose | note
  const [tab, setTab] = useState('inbox');
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    if (!backRef) return;
    backRef.current = () => {
      if (view !== 'list') { setView('list'); return true; }
      return false;
    };
    return () => { backRef.current = null; };
  }, [backRef, view]);

  const inbox = notes.filter(n => n.to_unit_id === myUnit.id);
  const sent  = notes.filter(n => n.from_unit_id === myUnit.id);
  const unread = inbox.filter(n => !n.read_at).length;
  const openNote = notes.find(n => n.id === openId);

  return (
    <div className="fixed inset-0 z-40 bg-gray-900 flex flex-col max-w-md mx-auto">
      {view === 'compose' ? (
        <Compose
          myUnit={myUnit}
          units={units}
          myActiveCall={myActiveCall}
          onCancel={() => setView('list')}
          onSent={(note) => { onNoteSent(note); setTab('sent'); setView('list'); }}
        />
      ) : view === 'note' && openNote ? (
        <NoteView note={openNote} myUnit={myUnit} onBack={() => setView('list')} onViewed={onNoteViewed} />
      ) : (
        <>
          <div className="flex items-center justify-between px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3 border-b border-gray-700 flex-shrink-0">
            <span className="text-white font-bold text-base">📝 PT Notes</span>
            <button onClick={onClose}
              className="text-gray-400 hover:text-white w-11 h-11 flex items-center justify-center rounded hover:bg-gray-700 text-xl">×</button>
          </div>
          <div className="p-4 flex-shrink-0">
            <button onClick={() => setView('compose')}
              className="w-full py-3.5 rounded-xl bg-blue-600 active:bg-blue-700 text-white font-bold text-sm">
              ＋ New PT Notes
            </button>
          </div>
          <div className="flex px-4 border-b border-gray-700 flex-shrink-0">
            {[['inbox', `Received${unread ? ` (${unread})` : ''}`], ['sent', 'Sent']].map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)}
                className={`flex-1 py-2 text-sm font-semibold border-b-2 ${tab === id ? 'border-blue-500 text-white' : 'border-transparent text-gray-400'}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {(tab === 'inbox' ? inbox : sent).length === 0 && (
              <div className="text-center text-gray-500 text-sm py-10">
                {tab === 'inbox' ? 'No patient notes received this shift.' : 'You haven’t sent any this shift.'}
              </div>
            )}
            {(tab === 'inbox' ? inbox : sent).map(n => {
              const isNew = tab === 'inbox' && !n.read_at;
              return (
                <button key={n.id} onClick={() => { setOpenId(n.id); setView('note'); }}
                  className={`w-full text-left rounded-xl px-3 py-3 border ${isNew ? 'bg-blue-900/40 border-blue-600' : 'bg-gray-800 border-gray-700'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-white font-semibold text-sm">
                      {tab === 'inbox' ? `From ${n.from_unit_number}` : `To ${n.to_unit_number}`}
                    </span>
                    <span className="text-gray-500 text-xs flex-shrink-0">{fmtTime(n.created_at)}</span>
                  </div>
                  <div className="text-gray-300 text-sm truncate mt-0.5">{n.fields?.name || 'Patient'}{n.fields?.age ? `, ${n.fields.age}` : ''}</div>
                  <div className="text-xs mt-0.5">
                    {isNew
                      ? <span className="text-blue-300 font-semibold">New — tap to open</span>
                      : tab === 'sent'
                        ? (n.read_at ? <span className="text-green-400">✓ Opened {fmtTime(n.read_at)}</span> : <span className="text-gray-500">Not opened yet</span>)
                        : null}
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
