import { useEffect, useMemo, useState } from 'react';
import { getReportCalls } from '../../services/api';
import BarChart from './BarChart';
import {
  INTERVALS, summarize, fmtDuration, applyFilters, byHour, byUnit, topCounts, interval, toCsv
} from '../../lib/reportStats';

const PRESETS = [
  { id: 'today', label: 'Today' },
  { id: '7d',    label: 'Last 7 days' },
  { id: '30d',   label: 'Last 30 days' },
  { id: 'year',  label: 'This year' },
  { id: 'custom', label: 'Custom' },
];

function rangeFor(preset, customFrom, customTo) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(startOfToday.getTime() + 86400000);
  switch (preset) {
    case 'today': return [startOfToday, tomorrow];
    case '7d':    return [new Date(startOfToday.getTime() - 6 * 86400000), tomorrow];
    case '30d':   return [new Date(startOfToday.getTime() - 29 * 86400000), tomorrow];
    case 'year':  return [new Date(now.getFullYear(), 0, 1), tomorrow];
    default: {
      const f = customFrom ? new Date(`${customFrom}T00:00`) : startOfToday;
      const t = customTo ? new Date(new Date(`${customTo}T00:00`).getTime() + 86400000) : tomorrow;
      return [f, t];
    }
  }
}

const hourLabel = h => `${((h + 11) % 12) + 1}${h < 12 ? 'a' : 'p'}`;
const toDateInput = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function Stat({ label, value, sub }) {
  return (
    <div className="bg-gray-900/40 rounded-xl border border-gray-700 px-3 py-2.5">
      <div className="text-gray-400 text-[11px] uppercase tracking-wider">{label}</div>
      <div className="text-white text-xl font-bold mt-0.5">{value}</div>
      {sub && <div className="text-gray-500 text-xs">{sub}</div>}
    </div>
  );
}

function TopList({ title, rows }) {
  const max = Math.max(1, ...rows.map(r => r.count));
  return (
    <div className="bg-gray-900/40 rounded-xl border border-gray-700 p-3">
      <div className="text-gray-200 text-sm font-semibold mb-2">{title}</div>
      {rows.length === 0 ? <div className="text-gray-500 text-xs">No data</div> : (
        <div className="space-y-1.5">
          {rows.map(r => (
            <div key={r.label} className="text-xs">
              <div className="flex justify-between text-gray-300"><span className="truncate pr-2">{r.label}</span><span>{r.count}</span></div>
              <div className="h-1.5 bg-gray-800 rounded-full mt-0.5">
                <div className="h-1.5 rounded-full bg-[#3987e5]" style={{ width: `${(r.count / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ReportsModal({ units = [], onClose, onShowHeatmap }) {
  const [preset, setPreset] = useState('7d');
  const [customFrom, setCustomFrom] = useState(toDateInput(new Date(Date.now() - 6 * 86400000)));
  const [customTo, setCustomTo] = useState(toDateInput(new Date()));
  const [priorities, setPriorities] = useState([]);
  const [callType, setCallType] = useState('');
  const [hourFrom, setHourFrom] = useState('');
  const [hourTo, setHourTo] = useState('');
  const [outlierMin, setOutlierMin] = useState(8);
  const [raw, setRaw] = useState(null);
  const [error, setError] = useState('');

  const [from, to] = useMemo(() => rangeFor(preset, customFrom, customTo), [preset, customFrom, customTo]);

  useEffect(() => {
    setRaw(null); setError('');
    getReportCalls(from.toISOString(), to.toISOString())
      .then(res => { if (!Array.isArray(res.data)) throw new Error(); setRaw(res.data); })
      .catch(err => setError(err.response?.data?.error || 'Could not load report data.'));
  }, [from.getTime(), to.getTime()]);

  const filters = {
    priorities, callType,
    hourFrom: hourFrom === '' ? null : Number(hourFrom),
    hourTo: hourTo === '' ? null : Number(hourTo),
  };
  const calls = useMemo(() => raw ? applyFilters(raw, filters) : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [raw, priorities.join(), callType, hourFrom, hourTo]);

  const callTypes = useMemo(() => [...new Set((raw || []).map(c => c.call_type).filter(Boolean))].sort(), [raw]);
  const unitNumberById = useMemo(() => Object.fromEntries(units.map(u => [u.id, u.unit_number])), [units]);
  const hours = useMemo(() => byHour(calls), [calls]);
  const unitRows = useMemo(() => byUnit(calls).map(r => ({ ...r, unit: unitNumberById[r.unitId] || r.unit })), [calls, unitNumberById]);
  const stats = useMemo(() => Object.fromEntries(Object.keys(INTERVALS).map(k => [k, summarize(calls, k)])), [calls]);
  const outliers = useMemo(() => calls
    .map(c => ({ c, s: interval(c, 'dispatchToScene') }))
    .filter(x => x.s != null && x.s > outlierMin * 60)
    .sort((a, b) => b.s - a.s), [calls, outlierMin]);

  const rangeLabel = `${from.toLocaleDateString()} – ${new Date(to.getTime() - 1).toLocaleDateString()}`;

  const exportCsv = () => {
    const blob = new Blob([toCsv(calls, unitNumberById)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cad-calls-${toDateInput(from)}-to-${toDateInput(new Date(to.getTime() - 1))}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const togglePriority = p => setPriorities(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);
  const chip = active => `px-2.5 py-1 rounded-lg text-xs font-semibold border ${active ? 'bg-blue-600 border-blue-400 text-white' : 'bg-gray-700 border-gray-600 text-gray-300 hover:border-gray-400'}`;
  const hourOptions = Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-gray-800 rounded-2xl border border-gray-700 w-full max-w-6xl max-h-[94vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700 flex-shrink-0">
          <div>
            <div className="text-white font-bold">📊 Reports</div>
            <div className="text-gray-500 text-xs">{rangeLabel} · {raw ? `${calls.length} call${calls.length === 1 ? '' : 's'}` : 'loading…'}</div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => onShowHeatmap({ calls, label: rangeLabel })} disabled={!calls.length}
              className="px-3 py-1.5 bg-orange-700 hover:bg-orange-600 disabled:opacity-40 text-white text-xs font-bold rounded-lg">
              🔥 Show as heat map
            </button>
            <button onClick={exportCsv} disabled={!calls.length}
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-gray-100 text-xs font-bold rounded-lg">
              ⬇ Export CSV
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-white w-8 h-8 text-xl rounded hover:bg-gray-700">×</button>
          </div>
        </div>

        {/* Filters: one row above everything they apply to */}
        <div className="px-5 py-2.5 border-b border-gray-700 flex flex-wrap items-center gap-2 flex-shrink-0">
          {PRESETS.map(p => <button key={p.id} onClick={() => setPreset(p.id)} className={chip(preset === p.id)}>{p.label}</button>)}
          {preset === 'custom' && (<>
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="bg-gray-700 text-white text-xs rounded-lg px-2 py-1" />
            <span className="text-gray-500 text-xs">to</span>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="bg-gray-700 text-white text-xs rounded-lg px-2 py-1" />
          </>)}
          <span className="w-px h-5 bg-gray-700 mx-1" />
          {[1, 2, 3].map(p => <button key={p} onClick={() => togglePriority(p)} className={chip(priorities.includes(p))}>P{p}</button>)}
          <select value={callType} onChange={e => setCallType(e.target.value)} className="bg-gray-700 text-white text-xs rounded-lg px-2 py-1">
            <option value="">All call types</option>
            {callTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <span className="text-gray-500 text-xs">Hours</span>
          <select value={hourFrom} onChange={e => setHourFrom(e.target.value)} className="bg-gray-700 text-white text-xs rounded-lg px-2 py-1">
            <option value="">any</option>{hourOptions}
          </select>
          <span className="text-gray-500 text-xs">–</span>
          <select value={hourTo} onChange={e => setHourTo(e.target.value)} className="bg-gray-700 text-white text-xs rounded-lg px-2 py-1">
            <option value="">any</option>{hourOptions}
          </select>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="text-red-400 text-sm">{error}</div>}
          {!raw && !error && <div className="text-gray-500 text-sm">Loading…</div>}
          {raw && (<>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <Stat label="Calls" value={calls.length} sub={`${calls.filter(c => c.priority === 1).length} P1 · ${calls.filter(c => c.priority === 2).length} P2 · ${calls.filter(c => c.priority === 3).length} P3`} />
              {Object.entries(INTERVALS).map(([k, def]) => (
                <Stat key={k} label={def.label}
                  value={fmtDuration(stats[k].median)}
                  sub={stats[k].n ? `median · slowest 10%: ${fmtDuration(stats[k].p90)}+ · n=${stats[k].n}` : 'no timed calls'} />
              ))}
            </div>

            <div className="grid lg:grid-cols-2 gap-3">
              <BarChart
                title="Calls by hour received"
                data={hours.map(h => ({ label: hourLabel(h.hour), fullLabel: `${hourLabel(h.hour)} hour`, value: h.count, detail: `P1 ${h.p1} · P2 ${h.p2} · P3 ${h.p3}` }))}
                formatValue={v => `${Math.round(v)} call${Math.round(v) === 1 ? '' : 's'}`}
                formatTick={v => Math.round(v)}
              />
              <BarChart
                title="Median dispatch → on scene, by hour"
                data={hours.map(h => ({ label: hourLabel(h.hour), fullLabel: `${hourLabel(h.hour)} hour`, value: h.medianResponse, detail: h.responseN ? `${h.responseN} timed call${h.responseN === 1 ? '' : 's'}` : 'no timed calls' }))}
                formatValue={v => fmtDuration(v)}
                formatTick={v => `${Math.round(v / 60)}m`}
                emptyText="No calls with both dispatch and on-scene times"
              />
            </div>

            <div className="bg-gray-900/40 rounded-xl border border-gray-700 p-3">
              <div className="text-gray-200 text-sm font-semibold mb-2">By unit</div>
              <table className="w-full text-xs">
                <thead className="text-gray-400 text-left">
                  <tr><th className="py-1 font-medium">Unit</th><th className="font-medium text-right">As primary</th><th className="font-medium text-right">As backup</th><th className="font-medium text-right">Median response (primary)</th><th className="font-medium text-right">Time on task (primary)</th></tr>
                </thead>
                <tbody className="text-gray-200">
                  {unitRows.map(r => (
                    <tr key={r.unitId} className="border-t border-gray-800">
                      <td className="py-1">{r.unit}</td>
                      <td className="text-right">{r.primary}</td>
                      <td className="text-right">{r.backup}</td>
                      <td className="text-right">{fmtDuration(r.medianResponse)}</td>
                      <td className="text-right">{fmtDuration(r.taskS || null)}</td>
                    </tr>
                  ))}
                  {!unitRows.length && <tr><td colSpan={5} className="py-2 text-gray-500">No data</td></tr>}
                </tbody>
              </table>
            </div>

            <div className="grid lg:grid-cols-2 gap-3">
              <TopList title="Top call types" rows={topCounts(calls, 'call_type')} />
              <TopList title="Dispositions" rows={topCounts(calls, 'disposition')} />
            </div>

            <div className="bg-gray-900/40 rounded-xl border border-gray-700 p-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="text-gray-200 text-sm font-semibold">Slow responses</div>
                <span className="text-gray-500 text-xs">dispatch → on scene over</span>
                <input type="number" min={1} max={60} value={outlierMin} onChange={e => setOutlierMin(Math.max(1, Number(e.target.value) || 1))}
                  className="w-14 bg-gray-700 text-white text-xs rounded px-1.5 py-0.5" />
                <span className="text-gray-500 text-xs">min · {outliers.length} call{outliers.length === 1 ? '' : 's'}</span>
              </div>
              {outliers.length === 0 ? <div className="text-gray-500 text-xs">None</div> : (
                <table className="w-full text-xs">
                  <thead className="text-gray-400 text-left"><tr><th className="py-1 font-medium">Case</th><th className="font-medium">Received</th><th className="font-medium">Type</th><th className="font-medium">Location</th><th className="font-medium">Unit</th><th className="font-medium text-right">Response</th></tr></thead>
                  <tbody className="text-gray-200">
                    {outliers.slice(0, 50).map(({ c, s }) => (
                      <tr key={c.id} className="border-t border-gray-800">
                        <td className="py-1">#{c.call_number}</td>
                        <td>{new Date(c.received_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                        <td>{c.call_type}</td>
                        <td className="truncate max-w-[14rem]">{c.location_name || '—'}</td>
                        <td>{c.assigned_unit_number || unitNumberById[c.assigned_unit_id] || '—'}</td>
                        <td className="text-right font-semibold">{fmtDuration(s)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="text-gray-600 text-[11px] mt-2">Open a case from Call History to see its full timeline and change log.</div>
            </div>
          </>)}
        </div>
      </div>
    </div>
  );
}
