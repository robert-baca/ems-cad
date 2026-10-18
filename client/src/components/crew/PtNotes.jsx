import { useState, useEffect } from 'react';
import { sendPtNote, viewPtNote, updatePtNote, deletePtNote } from '../../services/api';
import LicenseScanner from './LicenseScanner';

// Patient handoff notes between medics. This is protected health
// information: it's only ever held in memory here (never localStorage or
// the offline queue), and the server limits it to the medic who sent it and
// the medic it went to -- even after the shift ends -- and deletes it 24h
// after sending.

const FIELDS = [
  { key: 'name',        label: 'Name',            placeholder: 'Last, First' },
  { key: 'dob',         label: 'DOB',             placeholder: 'MM/DD/YYYY', inputMode: 'numeric' },
  { key: 'age',         label: 'Age',             placeholder: 'e.g. 34', inputMode: 'numeric' },
  { key: 'sex',         label: 'Sex',             options: ['M', 'F', 'Other'] },
  { key: 'location',    label: 'Location',        placeholder: 'Where the patient is — e.g. Bugs Bunny Boomtown' },
  { key: 'address',     label: 'Address',         placeholder: 'Street, city, state, zip', multiline: true },
  { key: 'phone',       label: 'Phone',           placeholder: '(555) 555-5555', inputMode: 'tel' },
  { key: 'medical_hx',  label: 'Medical history', placeholder: 'e.g. HTN, DM2, asthma', multiline: true },
  { key: 'allergies',   label: 'Allergies',       placeholder: 'e.g. PCN, latex', multiline: true, quick: 'NKDA' },
  { key: 'medications', label: 'Medications',     placeholder: 'e.g. metformin, lisinopril', multiline: true },
  // One optional set of vitals, shown as a compact grid (see VitalsGrid) --
  // the keys must match PT_NOTE_FIELDS on the server.
  { key: 'vitals_time', label: 'Time taken', placeholder: 'e.g. 14:32', vital: true, now: true },
  { key: 'bp',          label: 'BP',         placeholder: '120/80',     vital: true },
  { key: 'hr',          label: 'Pulse',      placeholder: '88',         vital: true, inputMode: 'numeric' },
  { key: 'rr',          label: 'Resp',       placeholder: '16',         vital: true, inputMode: 'numeric' },
  { key: 'spo2',        label: 'SpO2 %',     placeholder: '98',         vital: true, inputMode: 'numeric' },
  { key: 'bgl',         label: 'BGL',        placeholder: '110',        vital: true, inputMode: 'numeric' },
  { key: 'gcs',         label: 'GCS',        placeholder: '15',         vital: true, inputMode: 'numeric' },
  { key: 'pain',        label: 'Pain /10',   placeholder: '0–10',       vital: true, inputMode: 'numeric' },
  { key: 'temp',        label: 'Temp °F',    placeholder: '98.6',       vital: true, inputMode: 'decimal' },
  { key: 'notes',       label: 'Other notes',     placeholder: 'Anything else the receiving medic should know', multiline: true },
];
export const VITALS = FIELDS.filter(f => f.vital);
const FIRST_VITAL = VITALS[0].key;

const nowHHMM = () => new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

// Used by Start Incident's patient-info form (ScribeTest).
export function VitalsGrid({ values, set }) {
  return (
    <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-3">
      <div className="text-gray-300 text-xs font-semibold mb-2">Vitals <span className="text-gray-500 font-normal">— optional</span></div>
      <div className="grid grid-cols-3 gap-2">
        {VITALS.map(f => (
          <div key={f.key} className={f.now ? 'col-span-3' : ''}>
            <label className="block text-gray-400 text-[11px] mb-1">{f.label}</label>
            <div className="flex gap-2">
              <input
                value={values[f.key] || ''}
                onChange={e => set(f.key, e.target.value)}
                placeholder={f.placeholder}
                inputMode={f.inputMode}
                autoComplete="off"
                className="w-full min-w-0 bg-gray-700 text-white rounded-lg px-2.5 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
              />
              {f.now && (
                <button onClick={() => set(f.key, nowHHMM())}
                  className="px-3 py-2 rounded-lg bg-gray-700 text-gray-300 text-xs font-bold">Now</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// 'saved' | 'sent' | 'received' for this medic. The server works it out per
// person (notes follow the medic, not the unit -- see PT NOTES in the
// server) and sends it as `direction`; the unit comparison is only a
// fallback for anything that arrives without it.
export function noteDirection(n, myUnit) {
  if (n.direction) return n.direction;
  const fromMe = n.from_unit_id === myUnit?.id, toMe = n.to_unit_id === myUnit?.id;
  return fromMe && toMe ? 'saved' : toMe ? 'received' : 'sent';
}

// One-line summary for the notes list, e.g. "38F at Bugs Bunny Boomtown".
export function noteSummary(fields = {}) {
  if (fields.title) return fields.title;
  const sex = fields.sex === 'M' || fields.sex === 'F' ? fields.sex : '';
  const who = `${fields.age || ''}${sex}`;
  if (who && fields.location) return `${who} at ${fields.location}`;
  return fields.location || who || fields.name || 'Patient';
}

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

// Units someone could actually receive a note on: not carts, not this unit.
// Units on this same call first, then ones with a crew logged in.
export function UnitPicker({ myUnit, units, myActiveCall, toId, onPick }) {
  const onThisCall = (u) => myActiveCall && (myActiveCall.assigned_unit_id === u.id || (myActiveCall.additional_unit_ids || []).includes(u.id));
  const recipients = units
    .filter(u => u.id !== myUnit.id && u.unit_type !== 'Cart' && u.status !== 'out_of_service')
    .sort((a, b) =>
      (onThisCall(b) - onThisCall(a)) ||
      (!!b.crew - !!a.crew) ||
      a.unit_number.localeCompare(b.unit_number, undefined, { numeric: true }));
  return (
    <>
      {recipients.length === 0 && <div className="text-gray-500 text-sm">No other units in service right now.</div>}
      {recipients.map(u => (
        <button key={u.id} onClick={() => onPick(u.id)}
          className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-left text-sm ${
            toId === u.id ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-200'}`}>
          <span className="font-semibold">{u.unit_number}{u.crew ? <span className="font-normal opacity-80"> · {u.crew}</span> : null}</span>
          {onThisCall(u) && <span className="text-xs opacity-80">on your call</span>}
        </button>
      ))}
    </>
  );
}

// Fixing a note after it was saved or sent: every field except the
// Listening report (that stays as the recording produced it). A license
// scan fills just the fields it found, same as in Start Incident.
function NoteEdit({ note, authToken, onCancel, onSaved }) {
  const [values, setValues] = useState(() => {
    const { report: _r, ...rest } = note.fields || {};
    return rest;
  });
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setValues(prev => ({ ...prev, [k]: v }));

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await updatePtNote(note.id, values, authToken);
      onSaved(res.data.fields, res.data.edited_at);
    } catch (err) {
      setError(err?.response?.status === 404 ? 'This note has expired or was removed.'
        : err?.response?.data?.error || 'Could not save — check your connection and try again');
      setSaving(false);
    }
  };

  const inputCls = 'w-full bg-gray-700 text-white rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500';
  return (
    <>
      <Header title="Edit PT Notes" onBack={onCancel} backLabel="Cancel" />
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <button onClick={() => setScanning(true)}
          className="w-full py-3 rounded-xl bg-gray-700 active:bg-gray-600 text-white text-sm font-semibold flex items-center justify-center gap-2">
          📷 Scan Driver License / ID
        </button>
        <div>
          <label className="block text-gray-400 text-xs mb-1">Title</label>
          <input value={values.title || ''} onChange={e => set('title', e.target.value.slice(0, 80))}
            placeholder="e.g. Titan — dizzy guest" autoComplete="off" className={inputCls} />
        </div>
        {FIELDS.filter(f => f.key === FIRST_VITAL || !f.vital).map(f => f.vital ? (
          <VitalsGrid key="vitals" values={values} set={set} />
        ) : (
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
              <textarea value={values[f.key] || ''} onChange={e => set(f.key, e.target.value)}
                placeholder={f.placeholder} rows={2} className={`${inputCls} resize-none`} />
            ) : (
              <input value={values[f.key] || ''} onChange={e => set(f.key, e.target.value)}
                placeholder={f.placeholder} inputMode={f.inputMode} autoComplete="off" className={inputCls} />
            )}
            {f.quick && !values[f.key] && (
              <button onClick={() => set(f.key, f.quick)} className="mt-1.5 px-3 py-1 rounded-lg bg-gray-700 text-gray-300 text-xs font-bold">{f.quick}</button>
            )}
          </div>
        ))}
        {note.fields?.report && (
          <p className="text-gray-500 text-xs">The 🎙 Listening report can't be edited — it stays as recorded.</p>
        )}
      </div>
      <div className="p-4 border-t border-gray-700 flex-shrink-0 space-y-2">
        {error && <p className="text-amber-400 text-sm text-center">{error}</p>}
        <div className="grid grid-cols-2 gap-2">
          <button onClick={onCancel} className="py-3 rounded-xl bg-gray-700 text-gray-200 font-semibold text-sm">Cancel</button>
          <button onClick={save} disabled={saving}
            className="py-3 rounded-xl bg-blue-600 active:bg-blue-700 disabled:opacity-50 text-white font-bold text-sm">
            {saving ? 'Saving…' : '✓ Save changes'}
          </button>
        </div>
      </div>
      {scanning && (
        <LicenseScanner onClose={() => setScanning(false)}
          onResult={(fields) => { setScanning(false); setValues(prev => ({ ...prev, ...fields })); }} />
      )}
    </>
  );
}

function NoteView({ note, myUnit, units, myActiveCall, onBack, onViewed, onDeleted, onSent, onUpdated, authToken, canSend }) {
  const dir = noteDirection(note, myUnit);
  const saved = dir === 'saved';
  const incoming = dir === 'received';
  const [viewError, setViewError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [picking, setPicking] = useState(false);
  const [toId, setToId] = useState('');
  const [title, setTitle] = useState(note.fields?.title || '');
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState([]); // unit numbers this was sent to from here
  const [editing, setEditing] = useState(false);

  // Sending a saved note (e.g. a Listening report) to another medic: a new
  // note with the same fields, so it shows in their Received like any other
  // and expires 24 hours from now. Only the saved note itself goes -- the
  // recording's draft screen and transcript never left this phone.
  const sendOn = async () => {
    if (!toId) { setViewError('Pick who to send it to'); return; }
    setSending(true);
    setViewError('');
    try {
      const { title: _old, ...fields } = note.fields || {};
      if (title.trim()) fields.title = title.trim();
      const res = await sendPtNote({ to_unit_id: toId, fields });
      onSent(res.data);
      setSentTo(prev => [...prev, res.data.to_unit_number]);
      setPicking(false);
      setToId('');
    } catch (err) {
      setViewError(err?.response?.data?.error || 'Could not send — check your connection and try again');
    }
    setSending(false);
  };

  // Deleting removes the note for both medics on it, not just this phone.
  const remove = async () => {
    const who = saved ? '' : incoming ? ` It will also disappear from ${note.from_unit_number}'s Sent.` : ` ${note.to_unit_number} won't be able to see it anymore.`;
    if (!window.confirm(`Delete these patient notes?${who} This can't be undone.`)) return;
    setDeleting(true);
    try {
      await deletePtNote(note.id, authToken);
      onDeleted(note.id);
    } catch (err) {
      if (err?.response?.status === 404) { onDeleted(note.id); return; } // already gone
      setViewError('Could not delete — check your connection and try again');
      setDeleting(false);
    }
  };
  // Vitals render as one card, placed where the first filled-in vital is.
  const firstFilledVital = VITALS.find(v => note.fields?.[v.key])?.key;

  useEffect(() => {
    viewPtNote(note.id, authToken)
      .then(res => onViewed(note.id, res.data?.read_at))
      .catch(err => setViewError(err?.response?.status === 404 ? 'This note has expired or was removed.' : ''));
  }, [note.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the send-on title in step with an edited title.
  useEffect(() => { setTitle(note.fields?.title || ''); }, [note.fields?.title]);

  if (editing) return (
    <NoteEdit note={note} authToken={authToken} onCancel={() => setEditing(false)}
      onSaved={(fields, editedAt) => { onUpdated(note.id, fields, editedAt); setEditing(false); }} />
  );

  return (
    <>
      <Header title="PT Notes" onBack={onBack} />
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <div className="text-gray-400 text-xs">
          {saved ? 'Saved for yourself' : incoming ? `From ${note.from_unit_number}${note.from_crew ? ` · ${note.from_crew}` : ''}` : `To ${note.to_unit_number}`}
          {' · '}{fmtTime(note.created_at)}
          {!incoming && !saved && (note.read_at ? ` · ✓ Read ${fmtTime(note.read_at)}` : ' · Not opened yet')}
          {note.edited_at && ` · Edited ${fmtTime(note.edited_at)}`}
        </div>
        {note.fields?.title && <div className="text-white text-lg font-bold break-words">{note.fields.title}</div>}
        {viewError && <p className="text-amber-400 text-sm">{viewError}</p>}
        {FIELDS.filter(f => note.fields?.[f.key] && (!f.vital || f.key === firstFilledVital)).map(f => f.vital ? (
          <div key="vitals" className="bg-gray-800 rounded-xl px-3 py-2.5 border border-gray-700">
            <div className="text-gray-400 text-[11px] uppercase tracking-wider">
              Vitals{note.fields.vitals_time ? ` · ${note.fields.vitals_time}` : ''}
            </div>
            <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 mt-1">
              {VITALS.filter(v => v.key !== 'vitals_time' && note.fields[v.key]).map(v => (
                <div key={v.key}>
                  <div className="text-gray-500 text-[11px]">{v.label}</div>
                  <div className="text-white text-base font-semibold break-words select-text">{note.fields[v.key]}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div key={f.key} className="bg-gray-800 rounded-xl px-3 py-2.5 border border-gray-700">
            <div className="text-gray-400 text-[11px] uppercase tracking-wider">{f.label}</div>
            <div className="text-white text-base whitespace-pre-wrap break-words select-text">{note.fields[f.key]}</div>
          </div>
        ))}
        {note.fields?.report && (
          <div className="bg-gray-800 rounded-xl px-3 py-2.5 border border-amber-700/60">
            <div className="text-amber-300 text-[11px] uppercase tracking-wider mb-1">🎙 Listening report</div>
            {/* Reference only -- not selectable or copyable */}
            <div className="text-white text-sm whitespace-pre-wrap break-words select-none" style={{ WebkitTouchCallout: 'none' }}
              onCopy={e => e.preventDefault()} onContextMenu={e => e.preventDefault()}>{note.fields.report}</div>
          </div>
        )}
        <p className="text-gray-500 text-[11px] pt-2">Deleted automatically 24 hours after it was sent.</p>
        {picking && (
          <div className="pt-2 space-y-1.5">
            <label className="block text-gray-400 text-xs mb-1">Title <span className="text-gray-500">— so they know which patient this is</span></label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value.slice(0, 80))}
              placeholder="e.g. Titan — dizzy guest"
              autoComplete="off"
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500 mb-2"
            />
            <label className="block text-gray-400 text-xs mb-1">Send to</label>
            <UnitPicker myUnit={myUnit} units={units} myActiveCall={myActiveCall} toId={toId}
              onPick={(id) => { setToId(id); setViewError(''); }} />
          </div>
        )}
      </div>
      <div className="p-4 border-t border-gray-700 flex-shrink-0 space-y-2">
        {sentTo.length > 0 && <p className="text-green-400 text-sm text-center">✓ Sent to {sentTo.join(', ')}</p>}
        {saved && canSend && (picking ? (
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => { setPicking(false); setToId(''); setViewError(''); }}
              className="py-3 rounded-xl bg-gray-700 text-gray-200 font-semibold text-sm">Cancel</button>
            <button onClick={sendOn} disabled={sending || !toId}
              className="py-3 rounded-xl bg-blue-600 active:bg-blue-700 disabled:opacity-50 text-white font-bold text-sm">
              {sending ? 'Sending…' : '📤 Send'}
            </button>
          </div>
        ) : (
          <button onClick={() => setPicking(true)}
            className="w-full py-3 rounded-xl bg-blue-600 active:bg-blue-700 text-white font-bold text-sm">
            📤 Send to another medic
          </button>
        ))}
        {!picking && (
          <button onClick={() => { setEditing(true); setViewError(''); }}
            className="w-full py-3 rounded-xl bg-gray-700 active:bg-gray-600 text-white font-semibold text-sm">
            ✏️ Edit / add ID info
          </button>
        )}
        <button onClick={remove} disabled={deleting}
          className="w-full py-3 rounded-xl bg-red-900/50 border border-red-700 active:bg-red-900 disabled:opacity-50 text-red-200 font-semibold text-sm">
          {deleting ? 'Deleting…' : '🗑 Delete notes'}
        </button>
      </div>
    </>
  );
}

// backRef lets CrewMobile's native back button step out of a note
// view before closing PT NOTES entirely (same pattern as BeaconMode).
// authToken: the sign-in screen's personnel-only token, when opened from there
// (no unit, so no sending). canSend defaults to true.
export default function PtNotes({ myUnit, units, myActiveCall, notes, onNoteSent, onNoteViewed, onNoteUpdated, onNoteDeleted, onClose, backRef, authToken, canSend = true }) {
  const [view, setView] = useState('list'); // list | note
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

  const inbox = notes.filter(n => noteDirection(n, myUnit) === 'received');
  const sent  = notes.filter(n => noteDirection(n, myUnit) === 'sent');
  const saved = notes.filter(n => noteDirection(n, myUnit) === 'saved');
  const lists = { inbox, sent, saved };
  const EMPTY = {
    inbox: 'No patient notes received this shift.',
    sent:  'You haven’t sent any this shift.',
    saved: 'Nothing saved — use 🚑 Start Incident and tap Save.',
  };
  const unread = inbox.filter(n => !n.read_at).length;
  const openNote = notes.find(n => n.id === openId);

  return (
    <div className="fixed inset-0 z-40 bg-gray-900 flex flex-col max-w-md mx-auto">
      {view === 'note' && openNote ? (
        <NoteView note={openNote} myUnit={myUnit} units={units} myActiveCall={myActiveCall} authToken={authToken} canSend={canSend}
          onBack={() => setView('list')} onViewed={onNoteViewed} onSent={onNoteSent} onUpdated={onNoteUpdated}
          onDeleted={(id) => { onNoteDeleted(id); setView('list'); }} />
      ) : (
        <>
          <div className="flex items-center justify-between px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3 border-b border-gray-700 flex-shrink-0">
            <span className="text-white font-bold text-base">📝 PT Notes</span>
            <button onClick={onClose}
              className="text-gray-400 hover:text-white w-11 h-11 flex items-center justify-center rounded hover:bg-gray-700 text-xl">×</button>
          </div>
          <div className="flex px-4 border-b border-gray-700 flex-shrink-0">
            {[['inbox', `Received${unread ? ` (${unread})` : ''}`], ['sent', 'Sent'], ['saved', 'Saved']].map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)}
                className={`flex-1 py-2 text-sm font-semibold border-b-2 ${tab === id ? 'border-blue-500 text-white' : 'border-transparent text-gray-400'}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {lists[tab].length === 0 && (
              <div className="text-center text-gray-500 text-sm py-10">{EMPTY[tab]}</div>
            )}
            {lists[tab].map(n => {
              const isNew = tab === 'inbox' && !n.read_at;
              return (
                <button key={n.id} onClick={() => { setOpenId(n.id); setView('note'); }}
                  className={`w-full text-left rounded-xl px-3 py-3 border ${isNew ? 'bg-blue-900/40 border-blue-600' : 'bg-gray-800 border-gray-700'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-white font-bold text-sm truncate">{noteSummary(n.fields)}</span>
                    <span className="text-gray-500 text-xs flex-shrink-0">{fmtTime(n.created_at)}</span>
                  </div>
                  <div className="text-gray-400 text-xs truncate mt-0.5">
                    {tab === 'inbox' ? `From ${n.from_unit_number}` : tab === 'sent' ? `To ${n.to_unit_number}` : 'Saved'}
                    {n.fields?.name ? ` · ${n.fields.name}` : ''}
                  </div>
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
