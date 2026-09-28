// Pure helpers for the Reports tab: durations, medians/percentiles, and the
// breakdowns it charts. All times are computed from the call's own recorded
// timestamps; a call missing either end of an interval is left out of that
// interval's stats (not counted as zero).

export function secondsBetween(a, b) {
  if (!a || !b) return null;
  const s = (new Date(b) - new Date(a)) / 1000;
  return Number.isFinite(s) && s >= 0 ? s : null;
}

export const INTERVALS = {
  dispatchToScene: { label: 'Dispatch → on scene', from: 'dispatched_at', to: 'on_scene_at' },
  receivedToScene: { label: 'Received → on scene', from: 'received_at', to: 'on_scene_at' },
  onScene:         { label: 'Time on scene',       from: 'on_scene_at', to: 'cleared_at' },
  total:           { label: 'Received → closed',   from: 'received_at', to: 'closed_at' },
};

export function interval(call, key) {
  const { from, to } = INTERVALS[key];
  return secondsBetween(call[from], call[to]);
}

export function percentile(values, p) {
  const v = values.filter(x => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const idx = (v.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return v[lo] + (v[hi] - v[lo]) * (idx - lo);
}

export function fmtDuration(s) {
  if (s == null) return '—';
  const m = Math.floor(s / 60), sec = Math.round(s % 60);
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function summarize(calls, key) {
  const vals = calls.map(c => interval(c, key)).filter(v => v != null);
  return { n: vals.length, median: percentile(vals, 0.5), p90: percentile(vals, 0.9) };
}

// Filters shared by the charts, tables and heat map.
export function applyFilters(calls, { priorities, callType, hourFrom, hourTo }) {
  return calls.filter(c => {
    if (priorities?.length && !priorities.includes(Number(c.priority))) return false;
    if (callType && c.call_type !== callType) return false;
    if (hourFrom != null && hourTo != null && c.received_at) {
      const h = new Date(c.received_at).getHours();
      const inRange = hourFrom <= hourTo ? (h >= hourFrom && h <= hourTo) : (h >= hourFrom || h <= hourTo);
      if (!inRange) return false;
    }
    return true;
  });
}

// 24 buckets by the local hour the call was received.
export function byHour(calls) {
  const buckets = Array.from({ length: 24 }, (_, hour) => ({ hour, calls: [], p1: 0, p2: 0, p3: 0 }));
  calls.forEach(c => {
    if (!c.received_at) return;
    const b = buckets[new Date(c.received_at).getHours()];
    b.calls.push(c);
    if (c.priority === 1) b.p1++; else if (c.priority === 3) b.p3++; else b.p2++;
  });
  return buckets.map(b => ({
    hour: b.hour, count: b.calls.length, p1: b.p1, p2: b.p2, p3: b.p3,
    medianResponse: percentile(b.calls.map(c => interval(c, 'dispatchToScene')), 0.5),
    responseN: b.calls.filter(c => interval(c, 'dispatchToScene') != null).length,
  }));
}

// Primary vs. backup work per unit. "Time on task" = the primary unit's
// received→available (or closed) span, summed.
export function byUnit(calls) {
  const rows = new Map();
  const row = (id, number) => {
    if (!rows.has(id)) rows.set(id, { unitId: id, unit: number || id, primary: 0, backup: 0, responses: [], taskS: 0 });
    return rows.get(id);
  };
  calls.forEach(c => {
    if (c.assigned_unit_id) {
      const r = row(c.assigned_unit_id, c.assigned_unit_number);
      r.primary++;
      const resp = interval(c, 'dispatchToScene');
      if (resp != null) r.responses.push(resp);
      const task = secondsBetween(c.received_at, c.available_at || c.closed_at);
      if (task != null) r.taskS += task;
    }
    (c.additional_unit_ids || []).forEach(id => { row(id, null).backup++; });
  });
  return [...rows.values()]
    .map(r => ({ ...r, medianResponse: percentile(r.responses, 0.5) }))
    .sort((a, b) => (b.primary + b.backup) - (a.primary + a.backup));
}

export function topCounts(calls, field, limit = 10) {
  const counts = new Map();
  calls.forEach(c => { const k = c[field] || '(none)'; counts.set(k, (counts.get(k) || 0) + 1); });
  return [...counts.entries()].map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count).slice(0, limit);
}

const CSV_FIELDS = ['call_number', 'received_at', 'dispatched_at', 'acknowledged_at', 'en_route_at', 'on_scene_at',
  'patient_contact_at', 'transporting_at', 'cleared_at', 'available_at', 'closed_at',
  'priority', 'call_type', 'disposition', 'response_mode', 'location_name', 'location_lat', 'location_lng',
  'assigned_unit_number'];

export function toCsv(calls, unitNumberById = {}) {
  const esc = v => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = [...CSV_FIELDS, 'backup_units', 'dispatch_to_scene_s', 'received_to_scene_s', 'on_scene_s', 'received_to_closed_s'];
  const lines = calls.map(c => [
    ...CSV_FIELDS.map(f => esc(c[f])),
    esc((c.additional_unit_ids || []).map(id => unitNumberById[id] || id).join(' ')),
    ...['dispatchToScene', 'receivedToScene', 'onScene', 'total'].map(k => { const v = interval(c, k); return v == null ? '' : Math.round(v); }),
  ].join(','));
  return [header.join(','), ...lines].join('\n');
}
