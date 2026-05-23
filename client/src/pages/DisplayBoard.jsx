import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
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

  useEffect(() => {
    if (!sessionStorage.getItem('display_authed')) {
      navigate('/login');
      return;
    }

    const socket = io(window.location.origin);

    socket.emit('join:dispatcher');

    socket.on('init:state', ({ units: u, calls: c }) => {
      setUnits(u);
      setCalls(c.filter(c => c.status !== 'closed'));
    });

    socket.on('unit:gps_update', ({ unit_id, lat, lng, timestamp }) => {
      setUnits(prev => prev.map(u =>
        u.id === unit_id ? { ...u, last_lat: lat, last_lng: lng, last_gps_at: timestamp } : u
      ));
    });

    socket.on('unit:status_change', ({ unit_id, status }) => {
      setUnits(prev => prev.map(u => u.id === unit_id ? { ...u, status } : u));
    });

    socket.on('unit:updated', (unit) => {
      setUnits(prev =>
        prev.some(u => u.id === unit.id)
          ? prev.map(u => u.id === unit.id ? unit : u)
          : [...prev, unit]
      );
    });

    socket.on('unit:removed', ({ unit_id }) => {
      setUnits(prev => prev.filter(u => u.id !== unit_id));
    });

    socket.on('call:created', (call) => {
      setCalls(prev => prev.some(c => c.id === call.id) ? prev : [call, ...prev]);
    });

    socket.on('call:status_change', ({ call_id, status }) => {
      setCalls(prev =>
        status === 'closed'
          ? prev.filter(c => c.id !== call_id)
          : prev.map(c => c.id === call_id ? { ...c, status } : c)
      );
    });

    socket.on('call:assigned', ({ call_id, unit_id }) => {
      setCalls(prev => prev.map(c =>
        c.id === call_id ? { ...c, assigned_unit_id: unit_id, status: 'dispatched' } : c
      ));
    });

    socket.on('shift:started', ({ units: u }) => {
      setUnits(u);
      setCalls([]);
    });

    return () => socket.disconnect();
  }, [navigate]);

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
            <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
            <span className="text-green-400 text-xs font-medium">LIVE</span>
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
            locations={[]}
          />
        </div>

        <div className="w-36 bg-gray-800 border-l border-gray-700 flex flex-col flex-shrink-0">
          <div className="px-3 py-2.5 border-b border-gray-700">
            <div className="text-gray-400 text-xs font-semibold uppercase tracking-wider">Units</div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {sortedUnits.map(u => (
              <div key={u.id} className="flex items-center gap-2 px-2 py-2 rounded-lg bg-gray-750 border border-gray-700">
                <div
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ background: STATUS_COLORS[u.status] || '#9ca3af' }}
                />
                <span className="text-white text-xs font-bold truncate">{u.unit_number}</span>
              </div>
            ))}
            {units.length === 0 && (
              <div className="text-gray-600 text-xs text-center mt-4">No units</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
