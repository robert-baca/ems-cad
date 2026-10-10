import { useState, useEffect, useRef } from 'react';
import { processScribe, sendScribeFeedback, sendPtNote } from '../../services/api';
import { startWavRecorder } from '../../lib/wavRecorder';

// Ambient listening pilot, phase 0: role-play only. Records the encounter in
// the phone's browser, sends it to the server for transcription, and shows a
// reference summary (not a written chart) where every item carries the quote
// it came from -- the medic reads it while writing their own chart. Like
// PT Notes, the recording, transcript and draft are only held in memory
// here -- leaving this screen throws them away.

const MAX_MS = 30 * 60 * 1000;

const PATIENT_FIELDS = [
  ['name', 'Name'], ['dob', 'DOB'], ['age', 'Age'], ['sex', 'Sex'], ['location', 'Location'],
  ['address', 'Address'], ['phone', 'Phone'], ['medical_hx', 'Medical history'],
  ['allergies', 'Allergies'], ['medications', 'Medications'],
];
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

function Quote({ item }) {
  if (!item?.evidence) return <div className="text-amber-400 text-[11px] mt-1">⚠ No quote — check this against what was said</div>;
  return (
    <div className={`text-[11px] mt-1 italic ${item.verified ? 'text-gray-500' : 'text-amber-400'}`}>
      {!item.verified && '⚠ Quote not found in the transcript — check this. '}
      “{item.evidence}”{item.heard_at ? ` · ${item.heard_at}` : ''}
    </div>
  );
}

function EditableRow({ label, item, value, onChange }) {
  return (
    <div className="bg-gray-800 rounded-xl px-3 py-2.5 border border-gray-700">
      <div className="text-gray-400 text-[11px] uppercase tracking-wider mb-1">{label}</div>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        autoComplete="off"
        className="w-full bg-gray-700 text-white rounded-lg px-2.5 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
      />
      <Quote item={item} />
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

export default function ScribeTest({ myUnit, onNoteSent, onClose, backRef }) {
  const [view, setView] = useState('intro'); // intro | recording | processing | review | error
  const [rolePlay, setRolePlay] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [paused, setPaused] = useState(false);
  const [interrupted, setInterrupted] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // { session_id, phrases, draft, error }
  const [tab, setTab] = useState('draft');
  const [edits, setEdits] = useState({});
  const [vitalsIdx, setVitalsIdx] = useState(-1);
  const [rating, setRating] = useState('');
  const [criticalErrors, setCriticalErrors] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const recRef = useRef(null);
  const segmentsRef = useRef([]);
  const wavRef = useRef(null);
  const wakeRef = useRef(null);

  const busy = view === 'recording' || view === 'processing' || (view === 'review' && !saved);
  const confirmClose = () => !busy || window.confirm('Throw away this recording and draft?');

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
      const res = await processScribe(wavRef.current.blob, segmentsRef.current, wavRef.current.seconds);
      const data = res.data;
      setResult(data);
      setEdits(Object.fromEntries([
        ...PATIENT_FIELDS.map(([k]) => [`patient.${k}`, data.draft?.patient?.[k]?.value || '']),
        ['chief_complaint', data.draft?.chief_complaint?.value || ''],
        ...HISTORY_FIELDS.map(([k]) => [`history.${k}`, data.draft?.history?.[k]?.value || '']),
      ]));
      setVitalsIdx((data.draft?.vitals?.length || 0) - 1);
      setTab(data.draft ? 'draft' : 'transcript');
      setView('review');
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not reach the server — check your signal and try again');
      setView('error');
    }
  };

  const stop = async () => {
    const rec = recRef.current;
    if (!rec) return;
    recRef.current = null;
    const seconds = rec.durationMs() / 1000;
    const blob = await rec.stop();
    wakeRef.current?.release?.().catch(() => {});
    if (seconds < 3) { setError('That recording was too short.'); setView('intro'); return; }
    wavRef.current = { blob, seconds };
    upload();
  };

  const draft = result?.draft;
  const original = (path) => {
    const [a, b] = path.split('.');
    return (b ? draft?.[a]?.[b]?.value : draft?.[a]?.value) || '';
  };
  const fieldsEdited = () => Object.keys(edits).filter(k => edits[k] !== original(k)).length;

  const timelineText = () => (draft?.timeline || []).map(e => `${e.time || '--:--'} ${e.event}`).join('\n');

  // The whole summary as plain text, for reading next to the chart.
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
    if (draft?.timeline?.length) out.push('TIMELINE', timelineText(), '');
    if (draft?.missing?.length) out.push('NOT COVERED', ...draft.missing.map(m => `- ${m}`));
    return out.join('\n').trim();
  };

  const sendFeedback = (savedToPtNotes) =>
    sendScribeFeedback(result.session_id, {
      rating, critical_errors: criticalErrors, fields_edited: fieldsEdited(), saved_to_pt_notes: savedToPtNotes,
    }).catch(() => {});

  const saveToPtNotes = async () => {
    const fields = {};
    for (const [k] of PATIENT_FIELDS) if (edits[`patient.${k}`]?.trim()) fields[k] = edits[`patient.${k}`].trim();
    const v = draft?.vitals?.[vitalsIdx];
    if (v) {
      if (v.time) fields.vitals_time = v.time;
      for (const k of Object.keys(VITAL_LABELS)) if (v[k]) fields[k] = v[k];
    }
    if (draft?.timeline?.length) fields.notes = timelineText().slice(0, 2000);
    if (!Object.keys(fields).length) { setError('Nothing to save yet'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await sendPtNote({ to_unit_id: myUnit.id, fields });
      onNoteSent(res.data);
      await sendFeedback(true);
      setSaved(true);
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not save — try again');
    }
    setSaving(false);
  };

  const finish = async () => {
    if (!saved) await sendFeedback(false);
    onClose();
  };

  const copyReport = async () => {
    try { await navigator.clipboard.writeText(reportText()); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { setError('Copy failed — select the text and copy it by hand'); }
  };

  const roleOf = (speaker) => {
    const r = draft?.speakers?.find(s => s.speaker === speaker)?.role;
    return r ? ROLE_LABELS[r] : null;
  };

  const header = (
    <div className="flex items-center justify-between px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3 border-b border-gray-700 flex-shrink-0">
      <span className="text-white font-bold text-base">🎙 Listen <span className="text-amber-400 text-xs font-semibold">TEST</span></span>
      <button onClick={() => { if (confirmClose()) onClose(); }}
        className="text-gray-400 hover:text-white w-11 h-11 flex items-center justify-center rounded hover:bg-gray-700 text-xl">×</button>
    </div>
  );

  return (
    <div className="fixed inset-0 z-40 bg-gray-900 flex flex-col max-w-md mx-auto">
      {header}

      {view === 'intro' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="bg-amber-900/40 border border-amber-600 rounded-xl p-3 text-amber-200 text-sm">
            <b>Test mode — role-play only.</b> Don't use this on real patients yet. It's for trying the listening
            tool on practice scenarios so we can measure how accurate it is.
          </div>
          <div className="text-gray-300 text-sm space-y-2">
            <p>How it works: tap Start, run the scenario normally, then tap Stop. You'll get a report to reference
              while you write your chart — patient info, vitals, treatments and a timeline, each with the words it was
              taken from so you can check it. It doesn't write the chart for you.</p>
            <ul className="list-disc pl-5 space-y-1 text-gray-400">
              <li>Keep the screen on and the phone face-up between you and the "patient". If the screen turns off, recording pauses.</li>
              <li>Say vitals and treatments out loud: "BP 128 over 84, pulse 92", "giving 324 of aspirin by mouth".</li>
              <li>Pause any time. Nothing is saved anywhere until you choose to.</li>
            </ul>
          </div>
          <label className="flex items-start gap-3 bg-gray-800 rounded-xl p-3 border border-gray-700">
            <input type="checkbox" checked={rolePlay} onChange={e => setRolePlay(e.target.checked)} className="mt-1 w-5 h-5" />
            <span className="text-white text-sm">This is a training role-play, not a real patient.</span>
          </label>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button onClick={start} disabled={!rolePlay}
            className="w-full py-4 rounded-xl bg-red-600 active:bg-red-700 disabled:opacity-40 text-white font-bold">
            ● Start listening
          </button>
        </div>
      )}

      {view === 'recording' && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
          <div className={`flex items-center gap-2 text-sm font-semibold ${paused ? 'text-gray-400' : 'text-red-400'}`}>
            <span className={`w-3 h-3 rounded-full ${paused ? 'bg-gray-500' : 'bg-red-500 animate-pulse'}`} />
            {paused ? 'Paused' : 'Listening'}
          </div>
          <div className="text-white text-6xl font-mono tabular-nums">{fmtClock(elapsed)}</div>
          <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full bg-green-500 transition-[width] duration-100" style={{ width: `${Math.min(100, level * 140)}%` }} />
          </div>
          {interrupted && (
            <p className="text-amber-400 text-sm text-center">Recording paused because the screen turned off or another app took the microphone. Tap Resume to keep going.</p>
          )}
          {elapsed > MAX_MS - 2 * 60 * 1000 && <p className="text-amber-400 text-sm">Stops automatically at 30 minutes.</p>}
          <div className="w-full grid grid-cols-2 gap-3">
            <button onClick={togglePause} className="py-4 rounded-xl bg-gray-700 active:bg-gray-600 text-white font-bold">
              {paused ? '▶ Resume' : '❚❚ Pause'}
            </button>
            <button onClick={stop} className="py-4 rounded-xl bg-blue-600 active:bg-blue-700 text-white font-bold">
              ■ Stop & draft
            </button>
          </div>
        </div>
      )}

      {view === 'processing' && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 gap-3 text-center">
          <div className="w-10 h-10 border-4 border-gray-600 border-t-blue-500 rounded-full animate-spin" />
          <div className="text-white font-semibold">Transcribing and drafting…</div>
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
          <div className="flex px-4 border-b border-gray-700 flex-shrink-0">
            {[['draft', 'Draft'], ['transcript', 'Transcript']].map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)}
                className={`flex-1 py-2 text-sm font-semibold border-b-2 ${tab === id ? 'border-blue-500 text-white' : 'border-transparent text-gray-400'}`}>
                {label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {result.error && <p className="text-amber-400 text-sm">{result.error}</p>}

            {tab === 'transcript' && result.phrases.map((p, i) => (
              <div key={i} className="text-sm">
                <span className="text-gray-500 text-xs font-mono">{p.time} </span>
                <span className="text-blue-300 text-xs font-semibold">{p.speaker}{roleOf(p.speaker) ? ` (${roleOf(p.speaker)})` : ''}: </span>
                <span className="text-gray-200 select-text">{p.text}</span>
              </div>
            ))}

            {tab === 'draft' && draft && (
              <>
                <p className="text-gray-400 text-xs">
                  Check every item against the quote under it. ⚠ means the quote isn't in the transcript word for word — check that one by ear.
                </p>

                {draft.missing?.length > 0 && (
                  <div className="bg-amber-900/30 border border-amber-700 rounded-xl p-3">
                    <div className="text-amber-300 text-xs font-bold uppercase tracking-wider mb-1">Not covered</div>
                    <ul className="list-disc pl-5 text-amber-100 text-sm space-y-0.5">
                      {draft.missing.map((m, i) => <li key={i}>{m}</li>)}
                    </ul>
                  </div>
                )}

                <Section title="Patient">
                  {PATIENT_FIELDS.filter(([k]) => draft.patient?.[k]?.value).map(([k, label]) => (
                    <EditableRow key={k} label={label} item={draft.patient[k]} value={edits[`patient.${k}`]}
                      onChange={v => setEdits(e => ({ ...e, [`patient.${k}`]: v }))} />
                  ))}
                  {!PATIENT_FIELDS.some(([k]) => draft.patient?.[k]?.value) && <p className="text-gray-500 text-sm">Nothing picked up.</p>}
                </Section>

                <Section title="Complaint & history">
                  {draft.chief_complaint?.value && (
                    <EditableRow label="Chief complaint" item={draft.chief_complaint} value={edits.chief_complaint}
                      onChange={v => setEdits(e => ({ ...e, chief_complaint: v }))} />
                  )}
                  {HISTORY_FIELDS.filter(([k]) => draft.history?.[k]?.value).map(([k, label]) => (
                    <EditableRow key={k} label={label} item={draft.history[k]} value={edits[`history.${k}`]}
                      onChange={v => setEdits(e => ({ ...e, [`history.${k}`]: v }))} />
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
                      {vitalsIdx === i && <div className="text-blue-300 text-[11px] mt-1">This set goes into PT Notes</div>}
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

                <button onClick={copyReport} className="w-full py-2.5 rounded-xl bg-gray-700 text-gray-200 text-sm font-semibold">
                  {copied ? '✓ Copied' : '📋 Copy report'}
                </button>
              </>
            )}

            {/* Pilot rating -- required before finishing, it's the point of the test */}
            <div className="bg-gray-800 rounded-xl p-3 border border-gray-700 space-y-3 mt-4">
              <div className="text-white text-sm font-semibold">How good was this draft?</div>
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
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
          </div>

          <div className="p-4 border-t border-gray-700 flex-shrink-0 space-y-2">
            {draft && !saved && (
              <button onClick={saveToPtNotes} disabled={!rating || saving}
                className="w-full py-3.5 rounded-xl bg-blue-600 active:bg-blue-700 disabled:opacity-40 text-white font-bold text-sm">
                {saving ? 'Saving…' : '💾 Save to my PT Notes'}
              </button>
            )}
            {saved && <p className="text-green-400 text-sm text-center">✓ Saved to PT Notes → Saved</p>}
            <button onClick={finish} disabled={!rating}
              className="w-full py-3 rounded-xl bg-gray-700 disabled:opacity-40 text-gray-200 font-semibold text-sm">
              {rating ? 'Done' : 'Rate the draft to finish'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
