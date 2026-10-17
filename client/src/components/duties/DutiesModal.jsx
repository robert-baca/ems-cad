import { useState, useEffect, useMemo } from 'react';
import { setDutiesEnabled, addDuty, deleteDuty, getDutyReports, setDutyAssignment } from '../../services/api';
import { dutyProgress, dutyUnitsFor, dutyUnitLabel, findDone } from '../../lib/dutyProgress';
import DutyProgressList from './DutyProgressList';

function fmtWhen(iso) {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

function ReportCard({ r }) {
  const [open, setOpen] = useState(false);
  const done = r.items.filter(i => i.checked).length;
  const allDone = done === r.items.length;
  const unitsLabel = (i) => i.units.map(u => u.crew ? `${u.unit_number} · ${u.crew}` : u.unit_number).join(', ');
  return (
    <div className="rounded-lg bg-gray-700/60 px-3 py-2">
      <button onClick={() => setOpen(v => !v)} className="w-full text-left">
        <div className="flex items-center justify-between gap-2">
          <span className="text-gray-400 text-[11px]">{fmtWhen(r.submitted_at)}</span>
          <span className={`text-[11px] font-bold ${allDone ? 'text-green-400' : 'text-amber-400'}`}>Done {done}/{r.items.length}</span>
        </div>
        <div className="text-gray-100 text-sm">
          {r.submitted_by || 'Unknown'}{r.submitted_unit ? <span className="text-gray-400"> ({r.submitted_unit})</span> : null}
        </div>
        {!open && r.notes && <div className="text-gray-400 text-xs truncate mt-0.5">📝 {r.notes}</div>}
      </button>
      {open && (
        <div className="mt-1.5 pt-1.5 border-t border-gray-600 space-y-1">
          {r.items.map(i => (
            <div key={i.duty_id} className={`text-xs ${i.checked ? 'text-green-400/90' : 'text-amber-400/90'}`}>
              {i.checked ? '✓' : '✗'} {i.text} <span className="text-gray-500">— {unitsLabel(i)}</span>
            </div>
          ))}
          {r.notes && <div className="text-gray-300 text-xs whitespace-pre-wrap break-words pt-1">📝 {r.notes}</div>}
        </div>
      )}
    </div>
  );
}

// Duty checks submitted by admins from the crew app, last 90 days.
// liveReports are ones that arrived over the socket while the dashboard was open.
function ReportsTab({ liveReports }) {
  const [reports, setReports] = useState(null);
  const [error,   setError]   = useState('');
  useEffect(() => {
    getDutyReports()
      .then(res => setReports(Array.isArray(res.data) ? res.data : []))
      .catch(err => setError(err?.response?.data?.error || 'Could not load reports'));
  }, []);
  const merged = useMemo(() => {
    const byId = new Map((reports || []).map(r => [r.id, r]));
    liveReports.forEach(r => byId.set(r.id, r));
    return [...byId.values()].sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
  }, [reports, liveReports]);

  if (error) return <p className="text-red-400 text-sm">{error}</p>;
  if (reports === null) return <p className="text-gray-500 text-sm">Loading…</p>;
  if (!merged.length) return <p className="text-gray-500 text-sm">No duty reports yet. Admins submit them from the crew app.</p>;
  return <div className="space-y-2">{merged.map(r => <ReportCard key={r.id} r={r} />)}</div>;
}

const byNumber = (a, b) => a.unit_number.localeCompare(b.unit_number, undefined, { numeric: true });

// Inline picker under a "to hand out" duty. Each unit shows how many duties
// it already has, so work can be spread evenly.
function AssignPicker({ units, loadByUnit, busy, onAssign, onCancel }) {
  const [allUnits, setAllUnits] = useState(false);
  const [picked,   setPicked]   = useState([]);
  const toggle = (id) => { setAllUnits(false); setPicked(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]); };
  const sorted = units.slice().sort(byNumber);
  const ready = allUnits || picked.length > 0;
  return (
    <div className="mt-2 pt-2 border-t border-gray-600 space-y-2">
      <div className="flex flex-wrap gap-1.5">
        <button onClick={() => { setAllUnits(v => !v); setPicked([]); }}
          className={`px-2.5 py-1 rounded-full text-xs border font-semibold ${allUnits
            ? 'bg-blue-700 border-blue-500 text-white' : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'}`}>
          All units
        </button>
        {sorted.map(u => (
          <button key={u.id} onClick={() => toggle(u.id)}
            className={`px-2.5 py-1 rounded-full text-xs border ${picked.includes(u.id)
              ? 'bg-blue-700 border-blue-500 text-white' : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'}`}>
            {dutyUnitLabel(u)}
            <span className="ml-1 text-[10px] opacity-70">({loadByUnit.get(u.id) || 0})</span>
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <button onClick={onCancel}
          className="flex-1 py-1.5 rounded-lg text-xs font-semibold bg-gray-700 text-gray-300 hover:bg-gray-600">
          Cancel
        </button>
        <button onClick={() => onAssign(allUnits ? [] : picked)} disabled={busy || !ready}
          className="flex-1 py-1.5 rounded-lg text-xs font-semibold bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-40">
          Assign
        </button>
      </div>
      <p className="text-[10px] text-gray-500">(n) = duties that unit already has this shift</p>
    </div>
  );
}

export default function DutiesModal({ enabled, duties, done = [], units, liveReports = [], initialTab = 'duties', onClose }) {
  const [tab,       setTab]       = useState(initialTab);
  const [text,      setText]      = useState('');
  const [assigning, setAssigning] = useState(null); // duty id with the picker open
  const [busy,      setBusy]      = useState(false);
  const [error,     setError]     = useState('');

  const run = async (fn, fallback) => {
    setBusy(true);
    setError('');
    try { await fn(); return true; }
    catch (err) { setError(err?.response?.data?.error || fallback); return false; }
    finally { setBusy(false); }
  };

  const handleAdd = async () => {
    const trimmed = text.trim();
    if (!trimmed) { setError('Enter a duty.'); return; }
    if (await run(() => addDuty(trimmed, [], false), 'Could not add duty — try again')) setText('');
  };

  const handleDelete = (d) => {
    if (!window.confirm(`Remove "${d.text}" from the list?`)) return;
    run(() => deleteDuty(d.id), 'Could not remove duty — try again');
  };

  const handleAssign = async (d, unitIds) => {
    if (await run(() => setDutyAssignment(d.id, true, unitIds), 'Could not assign — try again')) setAssigning(null);
  };

  const handleUnassign = (d) => run(() => setDutyAssignment(d.id, false), 'Could not move it back — try again');

  const toHandOut = duties.filter(d => !d.assigned);
  const handedOut = duties.filter(d => d.assigned);
  const loadByUnit = useMemo(() => {
    const m = new Map();
    handedOut.forEach(d => dutyUnitsFor(d, units).forEach(u => m.set(u.id, (m.get(u.id) || 0) + 1)));
    return m;
  }, [handedOut, units]);
  const progress = dutyProgress(duties, done, units);

  const targetLabel = (d) => d.unit_ids.length
    ? units.filter(u => d.unit_ids.includes(u.id)).sort(byNumber).map(dutyUnitLabel).join(', ') || 'Removed unit'
    : 'All units';
  const doneCount = (d) => {
    const targets = dutyUnitsFor(d, units);
    return `${targets.filter(u => findDone(done, d.id, u.id)).length}/${targets.length} done`;
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-2xl w-full max-w-md shadow-2xl border border-gray-700">
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <div>
            <div className="text-white font-bold">🧽 Cleaning Duties</div>
            <div className="text-gray-400 text-xs">Shown in the crew app while turned on</div>
          </div>
          <button onClick={onClose}
            className="text-gray-400 hover:text-white w-8 h-8 flex items-center justify-center rounded hover:bg-gray-700 text-xl">
            ×
          </button>
        </div>
        <div className="flex px-5 border-b border-gray-700">
          {[
            ['duties', toHandOut.length ? `Hand out (${toHandOut.length})` : 'Hand out'],
            ['left', progress.total ? `What's left (${progress.left})` : "What's left"],
            ['reports', 'Reports'],
          ].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex-1 py-2 text-xs font-semibold border-b-2 transition-colors ${
                tab === id ? 'border-teal-500 text-white' : 'border-transparent text-gray-400 hover:text-gray-200'}`}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'reports' ? (
          <div className="p-5 max-h-[70vh] overflow-y-auto"><ReportsTab liveReports={liveReports} /></div>
        ) : tab === 'left' ? (
          <div className="p-5 max-h-[70vh] overflow-y-auto">
            <DutyProgressList duties={duties} done={done} units={units} />
          </div>
        ) : (
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="flex items-center justify-between rounded-xl px-4 py-2.5 bg-gray-900/50 border border-gray-700">
            <div className="pr-3">
              <div className="text-sm font-medium text-gray-200">Show duties in the crew app</div>
              <div className="text-[11px] text-gray-500">{enabled ? 'On — crews can see their duties' : 'Off — hidden from crews'}</div>
            </div>
            <button
              onClick={() => run(() => setDutiesEnabled(!enabled), 'Could not save — try again')}
              disabled={busy}
              aria-label="Toggle duties in the crew app"
              className={`relative w-11 h-6 rounded-full flex-shrink-0 transition-colors disabled:opacity-50 ${enabled ? 'bg-green-600' : 'bg-gray-600'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${enabled ? 'translate-x-5' : ''}`} />
            </button>
          </div>

          <div className="space-y-2">
            <label className="block text-gray-300 text-xs uppercase tracking-wider font-semibold">Add a duty</label>
            <input
              value={text}
              onChange={e => { setText(e.target.value); setError(''); }}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
              placeholder="e.g. Wipe down the cart and restock gloves"
              maxLength={300}
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
            />
            <button onClick={handleAdd} disabled={busy}
              className="w-full py-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white font-semibold text-sm rounded-lg">
              + Add to list
            </button>
            {error && <p className="text-red-400 text-sm">{error}</p>}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs uppercase tracking-wider">
              <span className="text-amber-300 font-semibold">To hand out ({toHandOut.length})</span>
              <span className="text-gray-500 normal-case tracking-normal text-[11px]">Goes back here every new shift</span>
            </div>
            {toHandOut.length ? toHandOut.map(d => (
              <div key={d.id} className="rounded-lg bg-gray-700/60 border border-amber-800/50 px-3 py-2">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0 text-gray-100 text-sm break-words pt-0.5">{d.text}</div>
                  {assigning !== d.id && (
                    <button onClick={() => { setAssigning(d.id); setError(''); }} disabled={busy}
                      className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-700 hover:bg-blue-600 text-white flex-shrink-0">
                      Assign
                    </button>
                  )}
                  <button onClick={() => handleDelete(d)} disabled={busy} title="Remove from the list"
                    className="text-gray-500 hover:text-red-400 w-7 h-7 flex items-center justify-center rounded hover:bg-gray-600 flex-shrink-0">
                    🗑
                  </button>
                </div>
                {assigning === d.id && (
                  <AssignPicker units={units} loadByUnit={loadByUnit} busy={busy}
                    onAssign={(ids) => handleAssign(d, ids)} onCancel={() => setAssigning(null)} />
                )}
              </div>
            )) : (
              <p className="text-gray-500 text-sm">{duties.length ? 'Everything is handed out ✓' : 'No duties yet — add one above.'}</p>
            )}
          </div>

          {handedOut.length > 0 && (
            <div className="space-y-2">
              <div className="text-gray-400 text-xs uppercase tracking-wider">Handed out ({handedOut.length})</div>
              {handedOut.map(d => (
                <div key={d.id} className="flex items-start gap-2 rounded-lg bg-gray-700/60 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-gray-100 text-sm break-words">{d.text}</div>
                    <div className="text-gray-400 text-[11px] break-words mt-0.5">
                      {targetLabel(d)} · <span className="text-gray-300">{doneCount(d)}</span>
                    </div>
                  </div>
                  <button onClick={() => handleUnassign(d)} disabled={busy} title="Move back to 'To hand out'"
                    className="text-gray-500 hover:text-amber-300 w-7 h-7 flex items-center justify-center rounded hover:bg-gray-600 flex-shrink-0">
                    ↩
                  </button>
                  <button onClick={() => handleDelete(d)} disabled={busy} title="Remove from the list"
                    className="text-gray-500 hover:text-red-400 w-7 h-7 flex items-center justify-center rounded hover:bg-gray-600 flex-shrink-0">
                    🗑
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        )}

        <div className="px-5 py-4 border-t border-gray-700">
          <button onClick={onClose}
            className="w-full py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded-lg transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
