import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSocket } from '../hooks/useSocket';
import ParkMap from '../components/map/ParkMap';
import { STATUS_COLORS } from '../data/mockData';

function Clock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="font-mono text-gray-300 text-sm">
      {time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </span>
  );
}

export default function DisplayBoard() {
  const navigate = useNavigate();
  const [units, setUnits] = useState([]);
  const [calls, setCalls] = useState([]);
  const [locations, setLocations] = useState([]);

  const kickToLogin = useCallback(() => {
    sessionStorage.removeItem('display_token');
    navigate('/login', { state: { forceRole: 'display' } });
  }, [navigate]);

  useEffect(() => {
    if (!sessionStorage.getItem('display_token')) kickToLogin();
  }, [kickToLogin]);

  // Routed through the shared useSocket hook (rather than a hand-rolled
  // socket.io client) so this public board gets the same connection-health
  // tracking and forced-reconnect-on-visibility guard as the dispatcher and
  // crew apps — without it, a silently-dropped connection could leave the
  // park's public display frozen on stale data while still claiming "LIVE".
  const { isConnected } = useSocket({
    'error:auth': kickToLogin,
    'init:state': ({ units: u, calls: c, locations: l }) => {
      setUnits(u);
      setCalls(c.filter(c => c.status !== 'closed'));
      if (l) setLocations(l);
    },
    // Only permanent locations ever reach this event (see POST /api/locations
    // on the server) — shift-only pins stay local to the dispatcher who
    // placed them and never broadcast.
    'location:added': (loc) => {
      setLocations(prev => prev.some(l => l.id === loc.id) ? prev : [...prev, loc]);
    },
    'location:removed': ({ id }) => {
      setLocations(prev => prev.filter(l => l.id !== id));
    },
    'unit:gps_update': ({ unit_id, lat, lng, timestamp }) => {
      setUnits(prev => prev.map(u =>
        u.id === unit_id ? { ...u, last_lat: lat, last_lng: lng, last_gps_at: timestamp } : u
      ));
    },
    'unit:status_change': ({ unit_id, status }) => {
      setUnits(prev => prev.map(u => u.id === unit_id ? { ...u, status } : u));
    },
    'unit:updated': (unit) => {
      setUnits(prev =>
        prev.some(u => u.id === unit.id)
          ? prev.map(u => u.id === unit.id ? unit : u)
          : [...prev, unit]
      );
    },
    'unit:removed': ({ unit_id }) => {
      setUnits(prev => prev.filter(u => u.id !== unit_id));
    },
    'call:created': (call) => {
      setCalls(prev => prev.some(c => c.id === call.id) ? prev : [call, ...prev]);
    },
    'call:status_change': ({ call_id, status }) => {
      setCalls(prev =>
        status === 'closed'
          ? prev.filter(c => c.id !== call_id)
          : prev.map(c => c.id === call_id ? { ...c, status } : c)
      );
    },
    'call:assigned': ({ call_id, unit_id }) => {
      setCalls(prev => prev.map(c =>
        c.id === call_id ? { ...c, assigned_unit_id: unit_id, status: 'dispatched' } : c
      ));
    },
    'call:updated': ({ call_id, changes }) => {
      setCalls(prev => prev.map(c => c.id === call_id ? { ...c, ...changes } : c));
    },
    'shift:started': ({ units: u }) => {
      setUnits(u);
      setCalls([]);
    },
    'shift:ended': ({ units: u }) => {
      setCalls([]);
      if (u) setUnits(u);
    }
  }, {
    getToken: () => sessionStorage.getItem('display_token'),
    // Join on every connect (including reconnects) so the room membership
    // survives the visibility-triggered forced reconnect in useSocket.
    onConnect: (socket) => socket.emit('join:dispatcher')
  });

  const activeCalls = calls.filter(c => c.status !== 'closed');

  const STATUS_ORDER = ['dispatched', 'en_route', 'on_scene', 'patient_contact', 'available', 'out_of_service'];
  const sortedUnits = [...units].sort((a, b) => {
    const ai = STATUS_ORDER.indexOf(a.status);
    const bi = STATUS_ORDER.indexOf(b.status);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white overflow-hidden">
      <header className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-lg">🚑</span>
          <span className="font-bold text-white tracking-wide">Six Flags EMS</span>
          <span className="text-gray-500 text-xs">Over Texas</span>
          <div className="flex items-center gap-1.5 ml-2 bg-gray-700 px-2 py-1 rounded-full">
            <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-green-400 animate-pulse' : 'bg-red-500'}`} />
            <span className={`text-xs font-medium ${isConnected ? 'text-green-400' : 'text-red-400'}`}>
              {isConnected ? 'LIVE' : 'RECONNECTING'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-gray-500 text-xs">{activeCalls.length} active call{activeCalls.length !== 1 ? 's' : ''}</span>
          <Clock />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 relative">
          <ParkMap
            units={units}
            calls={activeCalls}
            locations={locations}
          />
        </div>

        <div className="w-36 bg-gray-800 border-l border-gray-700 flex flex-col flex-shrink-0">
          <div className="px-3 py-2.5 border-b border-gray-700">
            <div className="text-gray-400 text-xs font-semibold uppercase tracking-wider">Units</div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {sortedUnits.map(u => {
              const assignedCall = activeCalls.find(c =>
                c.assigned_unit_id === u.id ||
                (c.additional_unit_ids || []).includes(u.id)
              );
              return (
                <div key={u.id} className="px-2 py-2 rounded-lg bg-gray-750 border border-gray-700">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ background: STATUS_COLORS[u.status] || '#9ca3af' }} />
                    <span className="text-white text-xs font-bold truncate">{u.unit_number}</span>
                  </div>
                  {assignedCall && (
                    <div className="mt-0.5 pl-4 text-gray-400 text-xs truncate leading-tight">
                      {assignedCall.response_mode === 'cart' ? '🛺' : '🚶'} #{assignedCall.call_number} {assignedCall.call_type}
                    </div>
                  )}
                </div>
              );
            })}
            {units.length === 0 && (
              <div className="text-gray-600 text-xs text-center mt-4">No units</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
