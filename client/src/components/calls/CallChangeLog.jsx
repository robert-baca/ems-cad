import { useEffect, useState } from 'react';
import { getCallAuditLog } from '../../services/api';

// Read-only list of after-the-fact edits to a call (timestamps, narrative,
// details, location, priority, close-out) from the server's call_audit_log:
// who changed which field, from what, to what, and when.

const FIELD_LABELS = {
  received_at: 'Received', dispatched_at: 'Dispatched', acknowledged_at: 'Acknowledged',
  en_route_at: 'En route', on_scene_at: 'On scene', patient_contact_at: 'Patient contact',
  arrived_first_aid_at: 'Arrived first aid', transporting_at: 'Transporting',
  cleared_at: 'Cleared', available_at: 'Available', closed_at: 'Closed',
  call_type: 'Call type', chief_complaint: 'Chief complaint', notes: 'Notes',
  location_name: 'Location', park_zone: 'Zone', location_lat: 'Pin latitude', location_lng: 'Pin longitude',
  priority: 'Priority', narrative: 'Narrative', status: 'Status',
  disposition: 'Disposition', close_notes: 'Close notes'
};

function fmtWhen(iso) {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// Timestamp fields read better as clock times than raw ISO strings.
function fmtValue(field, v) {
  if (v == null) return '—';
  if (field.endsWith('_at') && !isNaN(new Date(v).getTime())) {
    return new Date(v).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  return v;
}

export default function CallChangeLog({ callId }) {
  const [rows, setRows]   = useState(null); // null = loading
  const [error, setError] = useState(null);

  useEffect(() => {
    setRows(null);
    setError(null);
    getCallAuditLog(callId)
      .then(r => { if (!Array.isArray(r.data)) throw new Error(); setRows(r.data); })
      .catch(() => setError('Could not load the change log.'));
  }, [callId]);

  if (error) return <div className="text-red-400 text-xs">{error}</div>;
  if (!rows) return <div className="text-gray-500 text-xs">Loading…</div>;
  if (!rows.length) return <div className="text-gray-500 text-xs">No edits recorded for this call.</div>;

  return (
    <div className="space-y-2">
      <div className="text-gray-400 text-xs uppercase tracking-wider">Change log</div>
      {rows.map((r, i) => (
        <div key={i} className="rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-xs">
          <div className="flex justify-between gap-2 text-gray-400">
            <span className="font-semibold text-gray-200">{FIELD_LABELS[r.field] || r.field}</span>
            <span>{fmtWhen(r.at)}</span>
          </div>
          <div className="mt-1 text-gray-300 break-words">
            <span className="text-gray-500 line-through">{fmtValue(r.field, r.old_value)}</span>
            <span className="text-gray-500"> → </span>
            <span>{fmtValue(r.field, r.new_value)}</span>
          </div>
          <div className="mt-0.5 text-gray-500">by {r.changed_by || 'unknown'}</div>
        </div>
      ))}
    </div>
  );
}
