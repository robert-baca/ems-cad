import { useState, useEffect, useRef } from 'react';
import { processScribe, sendScribeFeedback, sendPtNote } from '../../services/api';
import { startWavRecorder } from '../../lib/wavRecorder';
import LicenseScanner from './LicenseScanner';
import { UnitPicker } from './PtNotes';

// Start Incident (ambient listening beta). One flow: the medic enters or
// scans the patient's demographics, gets consent, records the encounter, and
// gets one combined report -- their demographics plus what the recording
// picked up (history, vitals, treatments, timeline), each AI item with the
// quote it came from. It's a reference for writing the chart, not the chart.
//
// The typed/scanned demographics never go to the server or Azure; they're
// merged with the AI's results here on the phone. The recording, transcript
// and draft live only in memory -- leaving this screen throws them away
// unless the medic saves or sends the report as a PT note (8-hour purge).

const MAX_MS = 30 * 60 * 1000;

const DEMO_FIELDS = [
  ['name', 'Name', 'Last, First'], ['dob', 'DOB', 'MM/DD/YYYY'], ['age', 'Age', 'e.g. 34'], ['sex', 'Sex'],
  ['location', 'Location', 'Where in the park'], ['phone', 'Phone', '(555) 555-5555'], ['address', 'Address', 'Street, city, state, zip'],
];
const PATIENT_FIELDS = [
  ...DEMO_FIELDS.map(([k, l]) => [k, l]),
  ['medical_hx', 'Medical history'], ['allergies', 'Allergies'], ['medications', 'Medications'],
];
const SEXES = ['M', 'F', 'Other'];
const HISTORY_FIELDS = [
  ['onset', 'Onset'], ['provocation', 'Provocation'], ['quality', 'Quality'], ['radiation', 'Radiation'],
  ['severity', 'Severity'], ['time_course', 'Time'], ['last_oral_intake', 'Last oral intake'],
  ['events_leading_up', 'Events leading up'],
];
const VITAL_LABELS = { bp: 'BP', hr: 'HR', rr: 'RR', spo2: 'SpO2', bgl: 'BGL', gcs: 'GCS', pain: 'Pain', temp: 'Temp' };
const ROLE_LABELS = { medic: 'medic', patient: 'patient', family_or_bystander: 'family/bystander', other_provider: 'other provider', unknown: '?' };

const fmtClock = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function ageFromDob(dob) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(dob.trim());
  if (!m) return '';
  const d = new Date(+m[3], +m[1] - 1, +m[2]);
  if (isNaN(d) || d > new Date()) return '';
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  if (now < new Date(now.getFullYear(), d.getMonth(), d.getDate())) age--;
  return age >= 0 && age < 130 ? String(age) : '';
}

const inputCls = 'w-full bg-gray-700 text-white rounded-lg px-2.5 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500';

function Quote({ item }) {
  if (!item?.evidence) return <div className="text-amber-400 text-[11px] mt-1">⚠ No quote — check this against what was said</div>;
  return (
    <div className={`text-[11px] mt-1 italic ${item.verified ? 'text-gray-500' : 'text-amber-400'}`}>
      {!item.verified && '⚠ Quote not found in the transcript — check this. '}
      “{item.evidence}”{item.heard_at ? ` · ${item.heard_at}` : ''}
    </div>
  );
}

// source: 'you' (typed/edited by the medic), 'id' (license scan), or
// undefined (from the recording -- show its quote).
function EditableRow({ label, item, value, source, onChange }) {
  return (
    <div className="bg-gray-800 rounded-xl px-3 py-2.5 border border-gray-700">
      <div className="text-gray-400 text-[11px] uppercase tracking-wider mb-1">{label}</div>
      <input value={value} onChange={e => onChange(e.target.value)} autoComplete="off" className={inputCls} />
      {source === 'id' && value && <div className="text-green-400 text-[11px] mt-1">From ID scan</div>}
      {source === 'you' && value && <div className="text-gray-500 text-[11px] mt-1">Entered by you</div>}
      {!source && item?.value && <Quote item={item} />}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="space-y-2">
      <div className="text-gray-300 text-xs font-bold uppercase tracking-wider pt-2">{title}</div>
      {children}
    </div>
  );
}

export default function ScribeTest({ myUnit, units, myActiveCall, onNoteSent, onClose, backRef }) {
  const [view, setView] = useState('demos'); // demos | recording | processing | review | error
  const [title, setTitle] = useState('');
  const [demos, setDemos] = useState({});
  const [demoSource, setDemoSource] = useState({}); // key -> 'you' | 'id'
  const [scanning, setScanning] = useState(false);
  const [consent, setConsent] = useState(''); // 'patient' | 'guardian' -- set by the Start button tapped
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [paused, setPaused] = useState(false);
  const [interrupted, setInterrupted] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // { session_id, phrases, draft, error }
  const [tab, setTab] = useState('draft');
  const [edits, setEdits] = useState({});
  const [sources, setSources] = useState({}); // review field -> 'you' | 'id'
  const [vitalsIdx, setVitalsIdx] = useState(-1);
  const [rating, setRating] = useState('');
  const [criticalErrors, setCriticalErrors] = useState(0);
  const [delivering, setDelivering] = useState(false);
  const [savedToMe, setSavedToMe] = useState(false);
  const [sentTo, setSentTo] = useState([]);
  const [picking, setPicking] = useState(false);
  const [toId, setToId] = useState('');

  const recRef = useRef(null);
  const segmentsRef = useRef([]);
  const wavRef = useRef(null);
  const wakeRef = useRef(null);

  const delivered = savedToMe || sentTo.length > 0;
  const hasDemos = !!title.trim() || Object.values(demos).some(v => v?.trim());
  const busy = view === 'demos' ? hasDemos
    : view === 'review' ? !delivered : true;
  const confirmClose = () => !busy || window.confirm('Throw away this incident? Nothing has been saved.');

  useEffect(() => {
    if (!backRef) return;
    backRef.current = () => (confirmClose() ? false : true);
    return () => { backRef.current = null; };
  });

  // Timer + 30-minute cap while recording.
  useEffect(() => {
    if (view !== 'recording') return;
    const id = setInterval(() => {
      const ms = recRef.current?.durationMs() || 0;
      setElapsed(ms);
      if (ms >= MAX_MS) stop();
    }, 500);
    return () => clearInterval(id);
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  // The browser stops feeding audio when the screen turns off or the app goes
  // to the background, so pause cleanly and say so instead of leaving a gap.
  useEffect(() => {
    if (view !== 'recording') return;
    const onVis = () => {
      if (document.visibilityState === 'hidden' && !paused) { recRef.current?.pause(); setPaused(true); setInterrupted(true); }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [view, paused]);

  // Release the mic and wake lock if the screen is closed mid-recording.
  useEffect(() => () => { recRef.current?.stop().catch(() => {}); wakeRef.current?.release?.().catch(() => {}); }, []);

  // ── Demographics (before recording) ──
  const setDemo = (k, v) => {
    setDemos(prev => {
      const next = { ...prev, [k]: v };
      if (k === 'dob' && !prev.age?.trim()) next.age = ageFromDob(v);
      return next;
    });
    setDemoSource(prev => ({ ...prev, [k]: 'you' }));
  };

  // A scan fills just the fields it found and replaces what's there for those.
  const applyScan = (fields) => {
    setScanning(false);
    if (view === 'review') {
      setEdits(prev => ({ ...prev, ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [`patient.${k}`, v])) }));
      setSources(prev => ({ ...prev, ...Object.fromEntries(Object.keys(fields).map(k => [`patient.${k}`, 'id'])) }));
    } else {
      setDemos(prev => ({ ...prev, ...fields }));
      setDemoSource(prev => ({ ...prev, ...Object.fromEntries(Object.keys(fields).map(k => [k, 'id'])) }));
    }
  };

  // ── Recording ──
  const requestWakeLock = async () => {
    try { wakeRef.current = await navigator.wakeLock?.request('screen'); } catch { /* unsupported -- the tip covers it */ }
  };

  const start = async () => {
    setError('');
    try {
      recRef.current = await startWavRecorder({
        onLevel: setLevel,
        onInterrupted: () => { recRef.current?.pause(); setPaused(true); setInterrupted(true); },
      });
    } catch (err) {
      setError(err?.name === 'NotAllowedError'
        ? 'Microphone access was blocked. Allow the microphone for this site in your browser settings, then try again.'
        : 'Could not start the microphone on this phone.');
      return;
    }
    segmentsRef.current = [{ a: 0, t: Date.now() }];
    setElapsed(0); setPaused(false); setInterrupted(false);
    setView('recording');
    requestWakeLock();
  };

  const startWith = (who) => { setConsent(who); start(); };

  const togglePause = async () => {
    if (paused) {
      segmentsRef.current.push({ a: recRef.current.durationMs(), t: Date.now() });
      await recRef.current.resume();
      setPaused(false); setInterrupted(false);
      requestWakeLock();
    } else {
      recRef.current.pause();
      setPaused(true);
    }
  };

  const upload = async () => {
    setView('processing');
    setError('');
    try {
      const res = await processScribe(wavRef.current.blob, segmentsRef.current, wavRef.current.seconds, consent);
      const data = res.data;
      setResult(data);
      // What the medic entered or scanned wins over what the recording heard.
      const ai = (k) => data.draft?.patient?.[k]?.value || '';
      setEdits(Object.fromEntries([
        ...PATIENT_FIELDS.map(([k]) => [`patient.${k}`, demos[k]?.trim() || ai(k)]),
        ['chief_complaint', data.draft?.chief_complaint?.value || ''],
        ...HISTORY_FIELDS.map(([k]) => [`history.${k}`, data.draft?.history?.[k]?.value || '']),
      ]));
      setSources(Object.fromEntries(PATIENT_FIELDS
        .filter(([k]) => demos[k]?.trim())
        .map(([k]) => [`patient.${k}`, demoSource[k] || 'you'])));
      setVitalsIdx((data.draft?.vitals?.length || 0) - 1);
      setTab(data.draft ? 'draft' : 'transcript');
      setView('review');
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not reach the server — check your signal and try again');
      setView('error');
    }
  };

  // No recording at all (medic's choice, no consent, critical call): the
  // report is just what they entered, saved/sent like any PT note.
  const skipRecording = () => {
    setResult({ session_id: null, phrases: [], draft: null });
    setEdits(Object.fromEntries(PATIENT_FIELDS.map(([k]) => [`patient.${k}`, demos[k]?.trim() || ''])));
    setSources(Object.fromEntries(PATIENT_FIELDS
      .filter(([k]) => demos[k]?.trim())
      .map(([k]) => [`patient.${k}`, demoSource[k] || 'you'])));
    setTab('draft');
    setError('');
    setView('review');
  };

  // Patient changed their mind (or the call turned critical): the audio never
  // leaves the phone.
  const discard = async () => {
    if (!window.confirm('Throw away this recording? Nothing will be sent.')) return;
    const rec = recRef.current;
    recRef.current = null;
    await rec?.stop().catch(() => {});
    wakeRef.current?.release?.().catch(() => {});
    onClose();
  };

  const stop = async () => {
    const rec = recRef.current;
    if (!rec) return;
    recRef.current = null;
    const seconds = rec.durationMs() / 1000;
    const blob = await rec.stop();
    wakeRef.current?.release?.().catch(() => {});
    if (seconds < 3) { setError('That recording was too short.'); setView('demos'); return; }
    wavRef.current = { blob, seconds };
    upload();
  };

  // ── Report ──
  const draft = result?.draft;
  const setEdit = (k, v) => {
    setEdits(e => ({ ...e, [k]: v }));
    setSources(s => ({ ...s, [k]: 'you' }));
  };
  const original = (path) => {
    const [a, b] = path.split('.');
    return (b ? draft?.[a]?.[b]?.value : draft?.[a]?.value) || '';
  };
  // Only counts changes to what the recording produced -- demographics typed
  // before recording aren't corrections of the AI.
  const fieldsEdited = () => Object.keys(edits)
    .filter(k => original(k) && edits[k] !== original(k)).length;

  // The whole report as plain text, saved with the PT note for reference.
  const reportText = () => {
    const out = [];
    const rows = (pairs, prefix) => pairs
      .filter(([k]) => edits[`${prefix}.${k}`]?.trim())
      .map(([k, label]) => `${label}: ${edits[`${prefix}.${k}`].trim()}`);
    const patient = rows(PATIENT_FIELDS, 'patient');
    if (patient.length) out.push('PATIENT', ...patient, '');
    const hx = [
      ...(edits.chief_complaint?.trim() ? [`Chief complaint: ${edits.chief_complaint.trim()}`] : []),
      ...rows(HISTORY_FIELDS, 'history'),
    ];
    if (hx.length) out.push('COMPLAINT & HISTORY', ...hx, '');
    if (draft?.vitals?.length) out.push('VITALS', ...draft.vitals.map(v =>
      `${v.time || '--:--'} ${Object.entries(VITAL_LABELS).filter(([k]) => v[k]).map(([k, l]) => `${l} ${v[k]}`).join(', ')}`), '');
    if (draft?.interventions?.length) out.push('TREATMENTS', ...draft.interventions.map(t => `${t.time || '--:--'} ${t.description}`), '');
    if (draft?.pertinent_negatives?.length) out.push('PERTINENT NEGATIVES', ...draft.pertinent_negatives.map(n => n.finding), '');
    if (draft?.timeline?.length) out.push('TIMELINE', ...draft.timeline.map(e => `${e.time || '--:--'} ${e.event}`), '');
    if (draft?.missing?.length) out.push('NOT COVERED', ...draft.missing.map(m => `- ${m}`));
    return out.join('\n').trim();
  };

  const buildFields = () => {
    const fields = {};
    if (title.trim()) fields.title = title.trim().slice(0, 80);
    for (const [k] of PATIENT_FIELDS) if (edits[`patient.${k}`]?.trim()) fields[k] = edits[`patient.${k}`].trim();
    const v = draft?.vitals?.[vitalsIdx];
    if (v) {
      if (v.time) fields.vitals_time = v.time;
      for (const k of Object.keys(VITAL_LABELS)) if (v[k]) fields[k] = v[k];
    }
    // The whole report rides along so the note has everything; it's purged
    // with the rest of the note after 8 hours.
    // (Without a recording the fields already say everything.)
    const report = recorded ? reportText() : '';
    if (report) fields.report = report.slice(0, 10000);
    return fields;
  };

  // Only reports built from a recording get rated -- that's what the beta measures.
  const recorded = !!result?.session_id;
  const canDeliver = !recorded || !!rating;

  const sendFeedback = async (wasDelivered) => recorded &&
    sendScribeFeedback(result.session_id, {
      rating, critical_errors: criticalErrors, fields_edited: fieldsEdited(), saved_to_pt_notes: wasDelivered,
    }).catch(() => {});

  // Save to this unit (PT Notes → Saved) or send to another unit (their
  // Received) -- same PT note either way.
  const deliver = async (unitId) => {
    const fields = buildFields();
    if (!Object.keys(fields).length) { setError('Nothing to save yet'); return; }
    setDelivering(true);
    setError('');
    try {
      const res = await sendPtNote({ to_unit_id: unitId, fields });
      onNoteSent(res.data);
      if (unitId === myUnit.id) setSavedToMe(true);
      else { setSentTo(prev => [...prev, res.data.to_unit_number]); setPicking(false); setToId(''); }
      await sendFeedback(true);
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not send — try again');
    }
    setDelivering(false);
  };

  const finish = async () => {
    if (!delivered) await sendFeedback(false);
    onClose();
  };

  const roleOf = (speaker) => {
    const r = draft?.speakers?.find(s => s.speaker === speaker)?.role;
    return r ? ROLE_LABELS[r] : null;
  };

  const header = (
    <div className="flex items-center justify-between px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3 border-b border-gray-700 flex-shrink-0">
      <span className="text-white font-bold text-base">🚑 Incident <span className="text-amber-400 text-xs font-semibold">BETA</span></span>
      <button onClick={() => { if (confirmClose()) onClose(); }}
        className="text-gray-400 hover:text-white w-11 h-11 flex items-center justify-center rounded hover:bg-gray-700 text-xl">×</button>
    </div>
  );

  const scanButton = (
    <button onClick={() => setScanning(true)}
      className="w-full py-3 rounded-xl bg-gray-700 active:bg-gray-600 text-white text-sm font-semibold flex items-center justify-center gap-2">
      📷 Scan Driver License / ID
    </button>
  );

  // Same form before and during recording -- one set of values.
  const demoForm = (
    <>
      <div>
        <label className="block text-gray-400 text-xs mb-1">Incident title</label>
        <input value={title} onChange={e => setTitle(e.target.value.slice(0, 80))} placeholder="e.g. Titan — dizzy guest"
          autoComplete="off" className={inputCls} />
      </div>
      {scanButton}
      {Object.values(demoSource).includes('id') && (
        <p className="text-green-400 text-xs">✓ Filled from the ID — check it matches the patient.</p>
      )}
      {DEMO_FIELDS.map(([k, label, placeholder]) => (
        <div key={k}>
          <label className="block text-gray-400 text-xs mb-1">{label}</label>
          {k === 'sex' ? (
            <div className="flex gap-2">
              {SEXES.map(o => (
                <button key={o} onClick={() => setDemo('sex', demos.sex === o ? '' : o)}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-semibold ${demos.sex === o ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300'}`}>
                  {o}
                </button>
              ))}
            </div>
          ) : (
            <input value={demos[k] || ''} onChange={e => setDemo(k, e.target.value)} placeholder={placeholder}
              inputMode={k === 'age' || k === 'dob' ? 'numeric' : k === 'phone' ? 'tel' : undefined}
              autoComplete="off" className={inputCls} />
          )}
        </div>
      ))}
      <p className="text-gray-500 text-[11px]">What you enter here stays on your phone — only the recording is sent to be transcribed.</p>
    </>
  );

  return (
    <div className="fixed inset-0 z-40 bg-gray-900 flex flex-col max-w-md mx-auto">
      {header}
      {scanning && <LicenseScanner onClose={() => setScanning(false)} onResult={applyScan} />}

      {view === 'demos' && (
        <>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className="text-white text-sm font-semibold">Patient info <span className="text-gray-500 font-normal">— optional, you can also fill it in while recording</span></div>
            {demoForm}
          </div>
          {/* One tap records who agreed and starts recording -- consent is
              still required for every recording, just without its own screen. */}
          <div className="p-4 border-t border-gray-700 flex-shrink-0 space-y-2">
            <p className="text-gray-300 text-xs">
              Ask: <i>"I use a voice tool to help with my notes — it doesn't keep the recording. Okay?"</i>
              <span className="text-gray-500"> Don't record if they say no, a minor has no guardian there, they're altered, or it's critical.</span>
            </p>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => startWith('patient')}
                className="py-3.5 rounded-xl bg-red-600 active:bg-red-700 text-white font-bold text-sm">
                ● Start — patient agreed
              </button>
              <button onClick={() => startWith('guardian')}
                className="py-3.5 rounded-xl bg-red-600 active:bg-red-700 text-white font-bold text-sm">
                ● Start — guardian agreed
              </button>
            </div>
            <button onClick={skipRecording}
              className="w-full py-2.5 rounded-xl bg-gray-700 active:bg-gray-600 text-gray-200 font-semibold text-sm">
              Don't record — just save/send this info
            </button>
          </div>
        </>
      )}

      {/* Recording: a compact control bar on top, the patient-info form
          underneath so demographics can be filled in or scanned while talking. */}
      {view === 'recording' && (
        <>
          <div className="px-4 py-3 border-b border-gray-700 flex-shrink-0 space-y-2 bg-gray-900">
            <div className="flex items-center gap-3">
              <span className={`w-3 h-3 rounded-full flex-shrink-0 ${paused ? 'bg-gray-500' : 'bg-red-500 animate-pulse'}`} />
              <span className={`text-sm font-semibold ${paused ? 'text-gray-400' : 'text-red-400'}`}>{paused ? 'Paused' : 'Recording'}</span>
              <span className="text-white text-2xl font-mono tabular-nums ml-auto">{fmtClock(elapsed)}</span>
            </div>
            <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full bg-green-500 transition-[width] duration-100" style={{ width: `${Math.min(100, level * 140)}%` }} />
            </div>
            {interrupted && (
              <p className="text-amber-400 text-xs">Paused because the screen turned off or another app took the microphone. Tap Resume to keep going.</p>
            )}
            {elapsed > MAX_MS - 2 * 60 * 1000 && <p className="text-amber-400 text-xs">Stops automatically at 30 minutes.</p>}
            <div className="grid grid-cols-3 gap-2">
              <button onClick={togglePause} className="py-3 rounded-xl bg-gray-700 active:bg-gray-600 text-white text-sm font-bold">
                {paused ? '▶ Resume' : '❚❚ Pause'}
              </button>
              <button onClick={stop} className="py-3 rounded-xl bg-blue-600 active:bg-blue-700 text-white text-sm font-bold">
                ■ Stop & report
              </button>
              <button onClick={discard} className="py-3 rounded-xl border border-red-700 text-red-300 text-sm font-semibold">
                ✕ Throw away
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className="text-white text-sm font-semibold">Patient info <span className="text-gray-500 font-normal">— fill in while you talk, or skip</span></div>
            {demoForm}
          </div>
        </>
      )}

      {view === 'processing' && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-3 text-center">
          <div className="w-10 h-10 border-4 border-gray-600 border-t-blue-500 rounded-full animate-spin" />
          <div className="text-white font-semibold">Building the report…</div>
          <div className="text-gray-400 text-sm">Usually under a minute. Keep this screen open.</div>
        </div>
      )}

      {view === 'error' && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-4 text-center">
          <p className="text-red-400">{error}</p>
          <button onClick={upload} className="w-full py-3.5 rounded-xl bg-blue-600 text-white font-bold">Try again</button>
          <button onClick={onClose} className="w-full py-3 rounded-xl bg-gray-700 text-gray-200 font-semibold">Throw it away</button>
        </div>
      )}

      {view === 'review' && result && (
        <>
          {recorded && <div className="flex px-4 border-b border-gray-700 flex-shrink-0">
            {[['draft', 'Report'], ['transcript', 'Transcript']].map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)}
                className={`flex-1 py-2 text-sm font-semibold border-b-2 ${tab === id ? 'border-blue-500 text-white' : 'border-transparent text-gray-400'}`}>
                {label}
              </button>
            ))}
          </div>}

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {result.error && <p className="text-amber-400 text-sm">{result.error}</p>}

            {tab === 'transcript' && result.phrases.map((p, i) => (
              <div key={i} className="text-sm">
                <span className="text-gray-500 text-xs font-mono">{p.time} </span>
                <span className="text-blue-300 text-xs font-semibold">{p.speaker}{roleOf(p.speaker) ? ` (${roleOf(p.speaker)})` : ''}: </span>
                <span className="text-gray-200 select-none" style={{ WebkitTouchCallout: 'none' }}>{p.text}</span>
              </div>
            ))}

            {tab === 'draft' && (
              <>
                {recorded ? (
                  <p className="text-gray-400 text-xs">
                    Check every item against the quote under it. ⚠ means the quote isn't in the transcript word for word — check that one by ear.
                  </p>
                ) : (
                  <p className="text-gray-400 text-xs">No recording — fill in what you need, then save or send it. Any field can be left blank.</p>
                )}

                <div>
                  <label className="block text-gray-400 text-xs mb-1">Incident title</label>
                  <input value={title} onChange={e => setTitle(e.target.value.slice(0, 80))} placeholder="e.g. Titan — dizzy guest"
                    autoComplete="off" className={inputCls} />
                </div>

                {draft?.missing?.length > 0 && (
                  <div className="bg-amber-900/30 border border-amber-700 rounded-xl p-3">
                    <div className="text-amber-300 text-xs font-bold uppercase tracking-wider mb-1">Not covered</div>
                    <ul className="list-disc pl-5 text-amber-100 text-sm space-y-0.5">
                      {draft.missing.map((m, i) => <li key={i}>{m}</li>)}
                    </ul>
                  </div>
                )}

                <Section title="Patient">
                  {scanButton}
                  {PATIENT_FIELDS.map(([k, label]) => (
                    <EditableRow key={k} label={label} item={draft?.patient?.[k]} value={edits[`patient.${k}`] || ''}
                      source={sources[`patient.${k}`]} onChange={v => setEdit(`patient.${k}`, v)} />
                  ))}
                </Section>

                {draft && (
                  <>
                    <Section title="Complaint & history">
                      {draft.chief_complaint?.value && (
                        <EditableRow label="Chief complaint" item={draft.chief_complaint} value={edits.chief_complaint}
                          source={sources.chief_complaint} onChange={v => setEdit('chief_complaint', v)} />
                      )}
                      {HISTORY_FIELDS.filter(([k]) => draft.history?.[k]?.value).map(([k, label]) => (
                        <EditableRow key={k} label={label} item={draft.history[k]} value={edits[`history.${k}`]}
                          source={sources[`history.${k}`]} onChange={v => setEdit(`history.${k}`, v)} />
                      ))}
                    </Section>

                    <Section title="Vitals">
                      {!draft.vitals?.length && <p className="text-gray-500 text-sm">No vitals were said out loud.</p>}
                      {draft.vitals?.map((v, i) => (
                        <button key={i} onClick={() => setVitalsIdx(i)}
                          className={`w-full text-left rounded-xl px-3 py-2.5 border ${vitalsIdx === i ? 'bg-blue-900/40 border-blue-600' : 'bg-gray-800 border-gray-700'}`}>
                          <div className="text-white text-sm">
                            <span className="text-gray-400">{v.time || '—'} · </span>
                            {Object.entries(VITAL_LABELS).filter(([k]) => v[k]).map(([k, l]) => `${l} ${v[k]}`).join(' · ')}
                          </div>
                          <Quote item={v} />
                          {vitalsIdx === i && <div className="text-blue-300 text-[11px] mt-1">This set goes in the PT note's vitals (all sets are in the report)</div>}
                        </button>
                      ))}
                    </Section>

                    {draft.interventions?.length > 0 && (
                      <Section title="Treatments">
                        {draft.interventions.map((t, i) => (
                          <div key={i} className="bg-gray-800 rounded-xl px-3 py-2.5 border border-gray-700">
                            <div className="text-white text-sm"><span className="text-gray-400">{t.time || '—'} · </span>{t.description}</div>
                            <Quote item={t} />
                          </div>
                        ))}
                      </Section>
                    )}

                    {draft.pertinent_negatives?.length > 0 && (
                      <Section title="Pertinent negatives">
                        {draft.pertinent_negatives.map((n, i) => (
                          <div key={i} className="bg-gray-800 rounded-xl px-3 py-2.5 border border-gray-700">
                            <div className="text-white text-sm">{n.finding}</div>
                            <Quote item={n} />
                          </div>
                        ))}
                      </Section>
                    )}

                    {draft.timeline?.length > 0 && (
                      <Section title="Timeline">
                        {draft.timeline.map((e, i) => (
                          <div key={i} className="bg-gray-800 rounded-xl px-3 py-2.5 border border-gray-700">
                            <div className="text-white text-sm"><span className="text-gray-400">{e.time || '—'} · </span>{e.event}</div>
                            <Quote item={e} />
                          </div>
                        ))}
                      </Section>
                    )}
                  </>
                )}
              </>
            )}

            {/* Pilot rating -- required before saving/sending a recorded report, it's the point of the beta */}
            {recorded && <div className="bg-gray-800 rounded-xl p-3 border border-gray-700 space-y-3 mt-4">
              <div className="text-white text-sm font-semibold">How good was this report?</div>
              <div className="grid grid-cols-3 gap-2">
                {[['good', 'Good'], ['minor', 'Minor fixes'], ['major', 'Major errors']].map(([id, label]) => (
                  <button key={id} onClick={() => setRating(id)}
                    className={`py-2.5 rounded-lg text-sm font-semibold ${rating === id ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300'}`}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-gray-300 text-sm">Dangerous mistakes <span className="text-gray-500 text-xs">(e.g. a "denies" turned into a "has", wrong drug or dose)</span></span>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => setCriticalErrors(n => Math.max(0, n - 1))} className="w-9 h-9 rounded-lg bg-gray-700 text-white font-bold">−</button>
                  <span className="text-white font-bold w-6 text-center">{criticalErrors}</span>
                  <button onClick={() => setCriticalErrors(n => n + 1)} className="w-9 h-9 rounded-lg bg-gray-700 text-white font-bold">+</button>
                </div>
              </div>
            </div>}

            {picking && (
              <div className="space-y-1.5">
                <label className="block text-gray-400 text-xs mb-1">Send to</label>
                <UnitPicker myUnit={myUnit} units={units} myActiveCall={myActiveCall} toId={toId}
                  onPick={(id) => { setToId(id); setError(''); }} />
              </div>
            )}
            {error && <p className="text-red-400 text-sm">{error}</p>}
          </div>

          <div className="p-4 border-t border-gray-700 flex-shrink-0 space-y-2">
            {savedToMe && <p className="text-green-400 text-sm text-center">✓ Saved to PT Notes → Saved</p>}
            {sentTo.length > 0 && <p className="text-green-400 text-sm text-center">✓ Sent to {sentTo.join(', ')}</p>}
            {!canDeliver && <p className="text-gray-400 text-xs text-center">Rate the report to save or send it</p>}
            {picking ? (
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => { setPicking(false); setToId(''); }}
                  className="py-3 rounded-xl bg-gray-700 text-gray-200 font-semibold text-sm">Cancel</button>
                <button onClick={() => deliver(toId)} disabled={!toId || delivering}
                  className="py-3 rounded-xl bg-blue-600 active:bg-blue-700 disabled:opacity-40 text-white font-bold text-sm">
                  {delivering ? 'Sending…' : '📤 Send'}
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => deliver(myUnit.id)} disabled={!canDeliver || delivering || savedToMe}
                  className="py-3 rounded-xl bg-blue-600 active:bg-blue-700 disabled:opacity-40 text-white font-bold text-sm">
                  {savedToMe ? '✓ Saved' : '💾 Save to me'}
                </button>
                <button onClick={() => setPicking(true)} disabled={!canDeliver || delivering}
                  className="py-3 rounded-xl bg-blue-600 active:bg-blue-700 disabled:opacity-40 text-white font-bold text-sm">
                  📤 Send to medic
                </button>
              </div>
            )}
            <button onClick={finish} disabled={!canDeliver}
              className="w-full py-3 rounded-xl bg-gray-700 disabled:opacity-40 text-gray-200 font-semibold text-sm">
              {delivered ? 'Done' : canDeliver ? 'Done without saving' : 'Rate the report to finish'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
