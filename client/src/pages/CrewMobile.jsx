import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useUnits } from '../hooks/useUnits';
import { useCalls } from '../hooks/useCalls';
import { useSocket } from '../hooks/useSocket';
import { useCrewGps } from '../hooks/useCrewGps';
import ActiveCall from '../components/crew/ActiveCall';
import StatusButtons from '../components/crew/StatusButtons';
import { STATUS_COLORS, STATUS_LABELS } from '../data/mockData';

export default function CrewMobile() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const { units, setUnits, handleGpsUpdate, handleStatusChange, changeStatus, handleUnitUpdated } = useUnits();
  const { calls, setCalls, handleCallCreated, handleCallUpdated, handleCallStatusChange, handleCommentAdded, advanceStatus } = useCalls();

  const [statusLoading,   setStatusLoading]   = useState(false);
  const [backupRequested, setBackupRequested] = useState(false);

  const myUnit = units.find(u =>
    u.id === user?.unit_id || u.unit_number === user?.unit_number
  ) || null;

  const myCall = calls.find(c => {
    if (c.status === 'closed') return false;
    if (!myUnit) return false;
    return c.assigned_unit_id === myUnit.id ||
      (c.additional_unit_ids || []).includes(myUnit.id);
  }) || null;

  // Stale token: unit found by unit_number but ID doesn't match. Force re-login.
  useEffect(() => {
    if (!units.length) return;
    if (myUnit && user?.unit_id && myUnit.id !== user.unit_id) {
      logout();
      navigate('/login');
    }
  }, [myUnit?.id, user?.unit_id, units.length]);

  // Reset backup button when call changes
  useEffect(() => {
    setBackupRequested(false);
  }, [myCall?.id]);

  // Browser GPS fallback (only fires when Tracki is stale > 3 min)
  useCrewGps({ token: user?.token, unit: myUnit, enabled: !!myUnit });

  useSocket({
    'unit:gps_update':     handleGpsUpdate,
    'unit:status_change':  handleStatusChange,
    'unit:updated':        handleUnitUpdated,
    'call:created':        handleCallCreated,
    'call:updated':        handleCallUpdated,
    'call:status_change':  handleCallStatusChange,
    'call:assigned_to_me': handleCallCreated,
    'call:comment_added':  handleCommentAdded,
    'shift:ended':         () => { setUnits([]); setCalls([]); }
  });

  const handleStatusTap = async (status) => {
    if (!myUnit) return;
    setStatusLoading(true);
    try {
      await changeStatus(myUnit.id, status);
      if (myCall) await advanceStatus(myCall.id, status);
    } finally {
      setStatusLoading(false);
    }
  };

  const handleRequestBackup = useCallback(async () => {
    if (!myCall || !myUnit) return;
    const next = !backupRequested;
    setBackupRequested(next);
    const text = next
      ? `🆘 BACKUP REQUESTED — ${myUnit.unit_number}`
      : `✅ Backup no longer needed — ${myUnit.unit_number}`;
    try {
      await fetch(`/api/calls/${myCall.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user?.token}` },
        body: JSON.stringify({ text })
      });
    } catch {}
  }, [backupRequested, myCall, myUnit, user?.token]);

  const unitColor = STATUS_COLORS[myUnit?.status] || '#9ca3af';

  if (!myUnit) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-6 text-center max-w-md mx-auto">
        <div className="text-5xl mb-4">🚑</div>
        <div className="text-white font-bold text-lg mb-1">No Active Shift</div>
        <div className="text-gray-400 text-sm mb-6">
          Waiting for dispatch to start the shift. Check back soon.
        </div>
        <div className="text-gray-600 text-xs mb-8">Logged in as {user?.unit_number}</div>
        <button
          onClick={() => { logout(); navigate('/login'); }}
          className="text-gray-500 hover:text-white text-xs px-3 py-1.5 rounded hover:bg-gray-700 transition-colors border border-gray-700"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col max-w-md mx-auto">
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 px-4 py-3 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">🚑</span>
            <div>
              <div className="font-bold text-white">{myUnit.unit_number}</div>
              <div className="text-gray-400 text-xs">{myUnit.unit_type}</div>
            </div>
          </div>
          <button onClick={() => { logout(); navigate('/login'); }}
            className="text-gray-500 hover:text-white text-xs px-2 py-1 rounded hover:bg-gray-700 transition-colors">
            Sign out
          </button>
        </div>

        {/* Status banner */}
        <div className="rounded-xl px-4 py-2.5 flex items-center gap-3"
          style={{ backgroundColor: unitColor + '22', borderColor: unitColor, borderWidth: 1 }}>
          <div className="w-3 h-3 rounded-full flex-shrink-0 animate-pulse"
            style={{ backgroundColor: unitColor }} />
          <div>
            <div className="text-xs text-gray-400 uppercase tracking-wider">Current Status</div>
            <div className="font-bold text-sm" style={{ color: unitColor }}>
              {STATUS_LABELS[myUnit.status] || 'Unknown'}
            </div>
          </div>
          {myUnit.last_gps_at && (
            <div className="ml-auto flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
              <span className="text-green-400 text-xs">GPS</span>
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <ActiveCall
          call={myCall}
          myUnit={myUnit}
          units={units}
        />

        {myUnit && (
          <StatusButtons
            currentStatus={myUnit.status}
            onStatusChange={handleStatusTap}
            loading={statusLoading}
          />
        )}

        <button
          onClick={() => window.open('https://sfotems.com/protocols', '_blank')}
          className="w-full py-3 rounded-2xl bg-gray-800 border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 text-sm font-medium transition-colors flex items-center justify-center gap-2"
        >
          📖 Protocols
        </button>
      </div>

      {/* SOS button — fixed to bottom, only when on an active call */}
      {myCall && (
        <div className="flex-shrink-0 p-3 border-t border-gray-700 bg-gray-900">
          <button
            onClick={handleRequestBackup}
            className={`w-full py-4 rounded-xl font-black text-base tracking-wide transition-all active:scale-95
              ${backupRequested
                ? 'bg-green-800 border border-green-600 text-green-300'
                : 'bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-900/50'
              }`}
          >
            {backupRequested ? '✓ Backup Requested — Tap to Cancel' : '🆘 Request Backup'}
          </button>
        </div>
      )}
    </div>
  );
}
