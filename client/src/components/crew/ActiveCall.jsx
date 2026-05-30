const PRIORITY_LABELS = { 1: 'P1 — High Acuity', 2: 'P2 — Medium Acuity', 3: 'P3 — Low Acuity' };
const PRIORITY_COLORS = { 1: 'text-red-400', 2: 'text-orange-400', 3: 'text-blue-400' };

export default function ActiveCall({ call }) {
  if (!call) {
    return (
      <div className="bg-gray-800 rounded-2xl p-6 text-center border border-gray-700">
        <div className="text-4xl mb-2">✅</div>
        <div className="text-gray-300 font-semibold">No Active Call</div>
        <div className="text-gray-500 text-sm mt-1">Standing by</div>
      </div>
    );
  }

  const mapsUrl = `https://maps.apple.com/?ll=${call.location_lat},${call.location_lng}&q=EMS+Call`;
  const gmapsUrl = `https://www.google.com/maps?q=${call.location_lat},${call.location_lng}`;

  return (
    <div className="bg-gray-800 rounded-2xl overflow-hidden border border-gray-700">
      {/* Priority header bar */}
      <div className={`px-4 py-2 text-sm font-bold
        ${call.priority === 1 ? 'bg-red-600' : call.priority === 2 ? 'bg-orange-600' : 'bg-blue-700'}`}>
        🚨 ACTIVE CALL #{call.call_number} · {PRIORITY_LABELS[call.priority]}
      </div>

      <div className="p-4 space-y-3">
        {/* Type */}
        <div>
          <div className="text-gray-400 text-xs uppercase tracking-wider mb-0.5">Call Type</div>
          <div className="text-white font-bold text-lg">{call.call_type}</div>
        </div>

        {/* Location */}
        <div>
          <div className="text-gray-400 text-xs uppercase tracking-wider mb-0.5">Location</div>
          <div className="text-white font-semibold">
            {call.park_zone && <span className="text-blue-400">{call.park_zone} · </span>}
            {call.location_name}
          </div>
        </div>

        {/* Map buttons */}
        <div className="flex gap-2">
          <a
            href={mapsUrl}
            target="_blank"
            rel="noreferrer"
            className="flex-1 text-center py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg transition-colors"
          >
            🍎 Apple Maps
          </a>
          <a
            href={gmapsUrl}
            target="_blank"
            rel="noreferrer"
            className="flex-1 text-center py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg transition-colors"
          >
            🗺️ Google Maps
          </a>
        </div>

        {/* Complaint */}
        {call.chief_complaint && (
          <div>
            <div className="text-gray-400 text-xs uppercase tracking-wider mb-0.5">Chief Complaint</div>
            <div className="text-gray-200 text-sm leading-relaxed">{call.chief_complaint}</div>
          </div>
        )}

        {/* Notes */}
        {call.notes && (
          <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-lg px-3 py-2">
            <div className="text-yellow-400 text-xs font-semibold mb-0.5">NOTES</div>
            <div className="text-yellow-200 text-sm">{call.notes}</div>
          </div>
        )}
      </div>
    </div>
  );
}
