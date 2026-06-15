import { useState, useMemo, useCallback, useEffect } from 'react';
import { STATUS_COLORS, STATUS_LABELS, CALL_TYPES } from '../../data/mockData';
import { getShifts } from '../../services/api';
import CallSummaryModal from './CallSummaryModal';

const PRIORITY_LABELS = { 1: 'P1', 2: 'P2', 3: 'P3' };
const PRIORITY_COLORS = {
  1: 'bg-red-600 text-white',
  2: 'bg-orange-500 text-white',
  3: 'bg-blue-700 text-white'
};

function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  if (isToday) return time;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + time;
}

function durationMin(startIso, endIso) {
  if (!startIso || !endIso) return null;
  return Math.round((new Date(endIso) - new Date(startIso)) / 60000);
}

function DurationBadge({ min }) {
  if (min === null) return <span className="text-gray-500">—</span>;
  const color = min < 10 ? 'text-green-400' : min < 20 ? 'text-yellow-400' : 'text-red-400';
  return <span className={`font-mono text-xs ${color}`}>{min}m</span>;
}

function StatBox({ label, value, sub }) {
  return (
    <div className="bg-gray-700 rounded-xl px-4 py-3 text-center">
      <div className="text-white font-bold text-xl">{value}</div>
      <div className="text-gray-400 text-xs mt-0.5">{label}</div>
      {sub && <div className="text-gray-500 text-xs">{sub}</div>}
    </div>
  );
}

function fmtShiftOption(shift) {
  const date = new Date(shift.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${date} · ${shift.shift_label}`;
}

export default function CallHistory({ calls, units, onClose, loading, onRefresh }) {
  const [search,        setSearch]        = useState('');
  const [filterDate,    setFilterDate]    = useState('all');
  const [filterType,    setFilterType]    = useState('');
  const [filterPri,     setFilterPri]     = useState('');
  const [filterUnit,    setFilterUnit]    = useState('');
  const [filterStatus,  setFilterStatus]  = useState('');
  const [filterShiftId, setFilterShiftId] = useState('');
  const [selectedCall,  setSelectedCall]  = useState(null);
  const [shifts,        setShifts]        = useState([]);

  useEffect(() => {
    getShifts().then(r => setShifts(r.data)).catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    const now   = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const week  = new Date(today); week.setDate(today.getDate() - 7);
    const month = new Date(today); month.setDate(today.getDate() - 30);
    const searchLower = search.toLowerCase().replace(/^#/, '');

    return [...calls]
      .filter(c => {
        if (filterShiftId) {
          const shift = shifts.find(s => s.id === filterShiftId);
          if (shift) {
            const start = new Date(shift.started_at);
            const end   = shift.ended_at ? new Date(shift.ended_at) : new Date();
            return new Date(c.received_at) >= start && new Date(c.received_at) <= end;
          }
        }
        if (filterDate === 'today') return new Date(c.received_at) >= today;
        if (filterDate === 'week')  return new Date(c.received_at) >= week;
        if (filterDate === '30d')   return new Date(c.received_at) >= month;
        return true;
      })
      .filter(c => !search ||
        c.call_type?.toLowerCase().includes(searchLower) ||
        c.location_name?.toLowerCase().includes(searchLower) ||
        String(c.call_number).includes(searchLower)
      )
      .filter(c => !filterType   || c.call_type === filterType)
      .filter(c => !filterPri    || c.priority === Number(filterPri))
      .filter(c => !filterUnit   || c.assigned_unit_id === filterUnit || c.assigned_unit_number === filterUnit)
      .filter(c => !filterStatus || c.status === filterStatus)
      .sort((a, b) => new Date(b.received_at) - new Date(a.received_at));
  }, [calls, search, filterDate, filterShiftId, filterType, filterPri, filterUnit, filterStatus, shifts]);

  const closedFiltered = filtered.filter(c => c.status === 'closed');
  const p1Count = filtered.filter(c => c.priority === 1).length;

  const avgResponse = useMemo(() => {
    const times = closedFiltered.map(c => durationMin(c.received_at, c.on_scene_at)).filter(Boolean);
    return times.length ? Math.round(times.reduce((a, b) => a + b) / times.length) : null;
  }, [closedFiltered]);

  const avgDuration = useMemo(() => {
    const times = closedFiltered.map(c => durationMin(c.received_at, c.cleared_at)).filter(Boolean);
    return times.length ? Math.round(times.reduce((a, b) => a + b) / times.length) : null;
  }, [closedFiltered]);

  const unitOptions = useMemo(() => {
    const live = units.map(u => ({ id: u.id, label: u.unit_number }));
    const fromHistory = calls
      .filter(c => c.assigned_unit_number && !units.find(u => u.id === c.assigned_unit_id))
      .map(c => ({ id: c.assigned_unit_number, label: c.assigned_unit_number }));
    const seen = new Set();
    return [...live, ...fromHistory].filter(u => {
      if (seen.has(u.label)) return false;
      seen.add(u.label);
      return true;
    });
  }, [units, calls]);

  const clearFilters = () => {
    setSearch(''); setFilterDate('all'); setFilterType('');
    setFilterPri(''); setFilterUnit(''); setFilterStatus(''); setFilterShiftId('');
  };

  const hasFilters = search || filterType || filterPri || filterUnit || filterStatus ||
                     filterDate !== 'all' || filterShiftId;

  const exportCsv = useCallback(() => {
    const headers = [
      'Case #', 'Date/Time Received', 'Call Type', 'Priority', 'Location', 'Zone',
      'Unit', 'Status', 'Disposition', 'Close Notes', 'Narrative',
      'Response (min)', 'Scene (min)', 'Total (min)', 'Comments'
    ];
    const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = filtered.map(c => {
      const liveUnit = units.find(u => u.id === c.assigned_unit_id);
      const unitNum  = liveUnit?.unit_number || c.assigned_unit_number || '';
      const comments = (c.comments || []).map(cm => `${cm.author}: ${cm.text}`).join(' | ');
      return [
        c.call_number,
        c.received_at ? new Date(c.received_at).toLocaleString() : '',
        c.call_type || '',
        `P${c.priority}`,
        c.location_name || '',
        c.park_zone || '',
        unitNum,
        STATUS_LABELS[c.status] || c.status || '',
        c.disposition || '',
        c.close_notes || '',
        c.narrative || '',
        durationMin(c.received_at, c.on_scene_at) ?? '',
        durationMin(c.on_scene_at, c.cleared_at) ?? '',
        durationMin(c.received_at, c.cleared_at) ?? '',
        comments
      ].map(escape).join(',');
    });
    const csv  = [headers.map(h => `"${h}"`).join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `ems-calls-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filtered, units]);

  return (
    <div className="relative flex flex-col h-full bg-gray-800 border-l border-gray-700">
      {selectedCall && (
        <CallSummaryModal
          call={selectedCall}
          units={units}
          onClose={() => setSelectedCall(null)}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 flex-shrink-0">
        <div>
          <span className="text-white font-bold text-base">Call History</span>
          <span className="text-gray-400 text-xs ml-2">
            {loading ? 'Loading…' : `${filtered.length} of ${calls.length} calls (90 days)`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!loading && calls.length > 0 && (
            <button onClick={exportCsv}
              className="text-gray-400 hover:text-white text-xs px-2 py-1 rounded hover:bg-gray-700"
              title="Export filtered calls to CSV">
              ⬇ CSV
            </button>
          )}
          {onRefresh && (
            <button onClick={onRefresh} disabled={loading}
              className="text-gray-400 hover:text-white text-xs px-2 py-1 rounded hover:bg-gray-700 disabled:opacity-40"
              title="Refresh">
              ↻
            </button>
          )}
          <button onClick={onClose}
            className="text-gray-400 hover:text-white w-8 h-8 flex items-center justify-center rounded hover:bg-gray-700 text-xl">
            ×
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-gray-500 text-sm">Loading 90-day call history…</div>
        </div>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-4 gap-2 p-3 border-b border-gray-700 flex-shrink-0">
            <StatBox label="Calls"        value={filtered.length} />
            <StatBox label="Priority 1"   value={p1Count} sub="critical" />
            <StatBox label="Avg Response" value={avgResponse !== null ? `${avgResponse}m` : '—'} sub="received → scene" />
            <StatBox label="Avg Duration" value={avgDuration !== null ? `${avgDuration}m` : '—'} sub="received → cleared" />
          </div>

          {/* Search + date filter */}
          <div className="flex gap-2 px-3 pt-2.5 flex-shrink-0">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search type, location, or #case…"
              className="flex-1 bg-gray-700 text-white rounded-lg px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-blue-500 placeholder-gray-500"
            />
            <select value={filterShiftId ? '' : filterDate}
              onChange={e => { setFilterDate(e.target.value); setFilterShiftId(''); }}
              disabled={!!filterShiftId}
              className="bg-gray-700 text-white rounded-lg px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50">
              <option value="today">Today</option>
              <option value="week">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="all">All (90 days)</option>
            </select>
          </div>

          {/* Filter bar */}
          <div className="flex gap-2 px-3 py-2 border-b border-gray-700 flex-shrink-0 flex-wrap">
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              className="bg-gray-700 text-white rounded-lg px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-blue-500">
              <option value="">All Status</option>
              {['on_scene','en_route','dispatched','patient_contact','cleared','closed'].map(s => (
                <option key={s} value={s}>{STATUS_LABELS[s] || s}</option>
              ))}
            </select>
            <select value={filterPri} onChange={e => setFilterPri(e.target.value)}
              className="bg-gray-700 text-white rounded-lg px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-blue-500">
              <option value="">All Priority</option>
              <option value="1">P1 — High Acuity</option>
              <option value="2">P2 — Medium Acuity</option>
              <option value="3">P3 — Low Acuity</option>
            </select>
            <select value={filterUnit} onChange={e => setFilterUnit(e.target.value)}
              className="bg-gray-700 text-white rounded-lg px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-blue-500">
              <option value="">All Units</option>
              {unitOptions.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}
            </select>
            <select value={filterType} onChange={e => setFilterType(e.target.value)}
              className="bg-gray-700 text-white rounded-lg px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-blue-500">
              <option value="">All Types</option>
              {CALL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            {shifts.length > 0 && (
              <select value={filterShiftId} onChange={e => setFilterShiftId(e.target.value)}
                className={`bg-gray-700 text-white rounded-lg px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-blue-500
                  ${filterShiftId ? 'ring-1 ring-blue-500' : ''}`}>
                <option value="">By Shift…</option>
                {shifts.map(s => (
                  <option key={s.id} value={s.id}>{fmtShiftOption(s)}</option>
                ))}
              </select>
            )}
            {hasFilters && (
              <button onClick={clearFilters}
                className="text-xs text-blue-400 hover:text-blue-300 px-2">
                Clear filters
              </button>
            )}
          </div>

          {/* Table */}
          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="text-center text-gray-500 text-sm mt-12">No calls match filters</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-850 border-b border-gray-700">
                  <tr className="text-gray-400 text-xs">
                    <th className="text-left px-3 py-2 font-medium">#</th>
                    <th className="text-left px-2 py-2 font-medium">Type</th>
                    <th className="text-center px-2 py-2 font-medium">Pri</th>
                    <th className="text-left px-2 py-2 font-medium">Unit</th>
                    <th className="text-left px-2 py-2 font-medium">Received</th>
                    <th className="text-left px-2 py-2 font-medium">On Scene</th>
                    <th className="text-center px-2 py-2 font-medium">Resp.</th>
                    <th className="text-center px-2 py-2 font-medium">Duration</th>
                    <th className="text-left px-2 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {filtered.map(call => {
                    const liveUnit    = units.find(u => u.id === call.assigned_unit_id);
                    const unitDisplay = liveUnit?.unit_number || call.assigned_unit_number || '—';
                    const respMin     = durationMin(call.received_at, call.on_scene_at);
                    const durMin      = durationMin(call.received_at, call.cleared_at);
                    const color       = STATUS_COLORS[call.status] || '#9ca3af';
                    return (
                      <tr key={call.id}
                        onClick={() => setSelectedCall(call)}
                        className="hover:bg-gray-700 cursor-pointer transition-colors">
                        <td className="px-3 py-2.5 text-white font-bold text-xs">#{call.call_number}</td>
                        <td className="px-2 py-2.5 text-gray-200 max-w-[140px]">
                          <div className="truncate text-xs">{call.call_type}</div>
                          <div className="text-gray-500 text-xs truncate">{call.location_name}</div>
                        </td>
                        <td className="px-2 py-2.5 text-center">
                          <span className={`text-xs px-1.5 py-0.5 rounded font-bold ${PRIORITY_COLORS[call.priority]}`}>
                            {PRIORITY_LABELS[call.priority]}
                          </span>
                        </td>
                        <td className="px-2 py-2.5 text-gray-300 text-xs font-mono">{unitDisplay}</td>
                        <td className="px-2 py-2.5 text-gray-300 text-xs font-mono">{fmtDateTime(call.received_at)}</td>
                        <td className="px-2 py-2.5 text-gray-300 text-xs font-mono">{fmtDateTime(call.on_scene_at)}</td>
                        <td className="px-2 py-2.5 text-center"><DurationBadge min={respMin} /></td>
                        <td className="px-2 py-2.5 text-center"><DurationBadge min={durMin} /></td>
                        <td className="px-2 py-2.5">
                          <span className="text-xs font-medium" style={{ color }}>
                            {STATUS_LABELS[call.status] || call.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
