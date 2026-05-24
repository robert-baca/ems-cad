import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useUnits } from '../hooks/useUnits';
import { useCalls } from '../hooks/useCalls';
import { useLocations } from '../hooks/useLocations';
import { useSocket } from '../hooks/useSocket';
import ParkMap from '../components/map/ParkMap';
import MapContextMenu from '../components/map/MapContextMenu';
import UnitPanel from '../components/units/UnitPanel';
import UnitHistoryModal from '../components/units/UnitHistoryModal';
import CallCard from '../components/calls/CallCard';
import CallDetail from '../components/calls/CallDetail';
import CallHistory from '../components/calls/CallHistory';
import NewCallModal from '../components/calls/NewCallModal';
import ShiftSetup from './ShiftSetup';
import ShiftSummaryModal from '../components/shift/ShiftSummaryModal';

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

export default function DispatcherDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const {
    units, setUnits,
    handleGpsUpdate, handleStatusChange, handleProfileUpdate,
    handleUnitUpdated, handleUnitRemoved,
    addUnit, editUnit, removeUnit, changeStatus, clearGps
  } = useUnits();
  const {
    calls, setCalls,
    handleCallCreated, handleCallUpdated, handleCallStatusChange, handleCallAssigned,
    dispatchCall, assignUnit, closeCall, updateTimestamp, logTimeNow, addComment,
    addUnitToCall, removeUnitFromCall, updatePriority, addMutualAid, removeMutualAid
  } = useCalls();
  const { locations, addLocation, removeLocation, clearShiftLocations, setPermLocations } = useLocations();

  const [currentShift,      setCurrentShift]      = useState(undefined); // undefined = loading
  const [shiftSummary,      setShiftSummary]       = useState(null);
  const [endingShift,       setEndingShift]        = useState(false);
  const [selectedCallId,    setSelectedCallId]     = useState(null);
  const [selectedUnitId,    setSelectedUnitId]     = useState(null);
  const [newCallPin,        setNewCallPin]          = useState(null);
  const [showNewCallModal,  setShowNewCallModal]   = useState(false);
  const [contextMenu,       setContextMenu]         = useState(null);
  const [showHistory,       setShowHistory]         = useState(false);
  const [historyUnit,       setHistoryUnit]         = useState(null);
  const [flyToTarget,       setFlyToTarget]         = useState(null);
  const [unknownGpsDevice,  setUnknownGpsDevice]   = useState(null);
  const [splitParentId,     setSplitParentId]       = useState(null);

  // Load current shift on mount
  useEffect(() => {
    if (!user?.token) { setCurrentShift(null); return; }
    fetch('/api/shift/current', { headers: { Authorization: `Bearer ${user.token}` } })
      .then(r => r.json())
      .then(data => setCurrentShift(data || null))
      .catch(() => setCurrentShift(null));
  }, [user?.token]);

  useSocket({
    'init:state':          ({ units: u, calls: c, locations: l }) => { setUnits(u); setCalls(c); if (l) setPermLocations(l); },
    'unit:gps_update':     handleGpsUpdate,
    'unit:status_change':  handleStatusChange,
    'unit:profile_update': handleProfileUpdate,
    'unit:updated':        handleUnitUpdated,
    'unit:removed':        handleUnitRemoved,
    'call:created':        handleCallCreated,
    'call:updated':        handleCallUpdated,
    'call:status_change':  handleCallStatusChange,
    'call:assigned':       handleCallAssigned,
    'shift:started':       ({ shift, units: u }) => { setCurrentShift(shift); if (setUnits) setUnits(u); },
    'shift:ended':         ({ units: u, ...summary }) => { setShiftSummary(summary); setCurrentShift(null); setCalls([]); if (u) setUnits(u); },
    'gps:unknown_device':  ({ device_id }) => setUnknownGpsDevice(device_id)
  });

  const handleShiftStarted = (shift, updatedUnits) => {
    setCurrentShift(shift);
    if (setUnits && updatedUnits) setUnits(updatedUnits);
  };

  const handleEndShift = async () => {
    if (!window.confirm('End shift and generate the day summary?')) return;
    setEndingShift(true);
    try {
      const res  = await fetch('/api/shift/end', {
        method:  'POST',
        headers: { Authorization: `Bearer ${user.token}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setShiftSummary(data);
      setCurrentShift(null);
      clearShiftLocations();
    } catch (err) {
      alert('Failed to end shift: ' + err.message);
    } finally {
      setEndingShift(false);
    }
  };

  const selectedCall = calls.find(c => c.id === selectedCallId) || null;
  const selectedUnit = selectedCall
    ? units.find(u => u.id === selectedCall.assigned_unit_id) || null
    : null;
  const parentCall = selectedCall?.parent_call_id
    ? calls.find(c => c.id === selectedCall.parent_call_id) || null
    : null;
  const subCases = selectedCall
    ? calls.filter(c => c.parent_call_id === selectedCall.id)
    : [];
  const activeCalls  = calls.filter(c => c.status !== 'closed');
  const pendingCount = activeCalls.filter(c => c.status === 'pending').length;

  const handleMapClick = ({ lat, lng }) => {
    setContextMenu(null);
    setNewCallPin({ lat, lng });
    setShowNewCallModal(true);
  };

  const handleMapRightClick = ({ lat, lng, x, y }) => {
    setContextMenu({ lat, lng, x, y });
  };

  const handleContextStartCall = () => {
    setNewCallPin({ lat: contextMenu.lat, lng: contextMenu.lng });
    setContextMenu(null);
    setShowNewCallModal(true);
  };

  const handleContextAddLocation = (name, lat, lng, color, locationType) => {
    addLocation(name, lat, lng, color, locationType);
  };

  const handleSplitCall = (parentCall) => {
    setSplitParentId(parentCall.id);
    setNewCallPin({ lat: parentCall.location_lat, lng: parentCall.location_lng });
    setShowNewCallModal(true);
  };

  const handleDispatch = async (data) => {
    const payload = splitParentId ? { ...data, parent_call_id: splitParentId } : data;
    setSplitParentId(null);
    const call = await dispatchCall(payload);
    setNewCallPin(null);
    if (call) { setSelectedCallId(call.id); setShowHistory(false); }
  };

  const handleHistorySelectCall = (callId) => {
    setSelectedCallId(callId);
    setShowHistory(false);
  };

  // Still checking for shift
  if (currentShift === undefined) {
    return (
      <div className="flex h-screen bg-gray-900 items-center justify-center">
        <div className="text-gray-400 text-sm">Loading shift…</div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col h-screen bg-gray-900 text-white overflow-hidden"
      onClick={() => contextMenu && setContextMenu(null)}
    >
      {/* ── Header ────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-4 py-2.5 bg-gray-800 border-b border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xl">🚑</span>
          <div>
            <span className="font-bold text-white tracking-wide">Six Flags EMS CAD</span>
            <span className="text-gray-500 text-xs ml-2">Over Texas</span>
          </div>
          <div className="flex items-center gap-1.5 ml-2 bg-gray-700 px-2 py-1 rounded-full">
            <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
            <span className="text-green-400 text-xs font-medium">LIVE</span>
          </div>
          {currentShift && (
            <div className="text-gray-500 text-xs border border-gray-700 px-2 py-1 rounded-full">
              {currentShift.shift_label}
            </div>
          )}
          {pendingCount > 0 && (
            <div className="flex items-center gap-1.5 bg-indigo-900/60 border border-indigo-600 px-2 py-1 rounded-full">
              <div className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-pulse" />
              <span className="text-indigo-300 text-xs font-medium">{pendingCount} pending</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <Clock />
          <button
            onClick={() => { setShowHistory(h => !h); setSelectedCallId(null); }}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors
              ${showHistory ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white'}`}
          >
            📋 Call History
          </button>
          {currentShift ? (
            <button
              onClick={handleEndShift}
              disabled={endingShift}
              className="text-xs px-3 py-1.5 rounded-lg font-medium bg-red-800 hover:bg-red-700 text-red-200 transition-colors disabled:opacity-50"
            >
              {endingShift ? 'Ending…' : '⏹ End Shift'}
            </button>
          ) : (
            <button
              onClick={() => setCurrentShift(null)}
              className="text-xs px-3 py-1.5 rounded-lg font-medium bg-green-800 hover:bg-green-700 text-green-200 transition-colors"
            >
              ▶ Start Shift
            </button>
          )}
          <span className="text-gray-400 text-sm">👤 {user?.name || user?.username}</span>
          <button
            onClick={() => { logout(); navigate('/login'); }}
            className="text-gray-500 hover:text-white text-xs px-2 py-1 rounded hover:bg-gray-700 transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* ── GPS unknown device banner ─────────────────────────── */}
      {unknownGpsDevice && (
        <div className="flex items-center justify-between px-4 py-2 bg-yellow-900/60 border-b border-yellow-700 text-yellow-200 text-xs flex-shrink-0">
          <span>📡 Unknown GPS device ID: <span className="font-mono font-bold">{unknownGpsDevice}</span> — paste this into Edit Unit → Trak-4 Device ID</span>
          <button onClick={() => setUnknownGpsDevice(null)} className="ml-4 text-yellow-400 hover:text-white">✕</button>
        </div>
      )}

      {/* ── Body ─────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left: Unit panel */}
        <UnitPanel
          units={units}
          calls={activeCalls}
          selectedUnitId={selectedUnitId}
          onSelectUnit={setSelectedUnitId}
          onUnitHistory={(unit) => setHistoryUnit(unit)}
          onAddUnit={addUnit}
          onEditUnit={editUnit}
          onRemoveUnit={removeUnit}
          onStatusChange={changeStatus}
          onClearGps={clearGps}
          onFlyTo={(unit) => setFlyToTarget({ lat: unit.last_lat, lng: unit.last_lng, _t: Date.now() })}
        />

        {/* Center: Map */}
        <div className="flex-1 relative">
          <ParkMap
            units={units}
            calls={activeCalls}
            locations={locations}
            onMapClick={handleMapClick}
            onMapRightClick={handleMapRightClick}
            onRemoveLocation={removeLocation}
            newCallPin={newCallPin}
            flyToTarget={flyToTarget}
          />
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur-sm text-white text-xs px-3 py-1.5 rounded-full pointer-events-none select-none">
            Drag to pan · Right-click → new call or add location
          </div>
        </div>

        {/* Right: Active calls OR History */}
        {showHistory ? (
          <div className="w-[640px] flex-shrink-0">
            <CallHistory
              calls={calls}
              units={units}
              onClose={() => setShowHistory(false)}
              onSelectCall={handleHistorySelectCall}
            />
          </div>
        ) : (
          <div className="w-80 flex flex-col bg-gray-800 border-l border-gray-700 flex-shrink-0">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 flex-shrink-0">
              <span className="text-white font-semibold">Active Calls</span>
              <div className="flex items-center gap-2">
                {pendingCount > 0 && (
                  <span className="bg-indigo-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                    {pendingCount} pending
                  </span>
                )}
                <span className="bg-red-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                  {activeCalls.length}
                </span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {activeCalls.length === 0 ? (
                <div className="text-center text-gray-500 text-sm mt-8">
                  <div className="text-3xl mb-2">✅</div>No active calls
                </div>
              ) : (
                activeCalls.map(call => (
                  <CallCard
                    key={call.id}
                    call={call}
                    unit={units.find(u => u.id === call.assigned_unit_id)}
                    isSelected={call.id === selectedCallId}
                    onClick={() => setSelectedCallId(call.id === selectedCallId ? null : call.id)}
                  />
                ))
              )}
            </div>
          </div>
        )}

        {/* Far right: Call detail */}
        {selectedCall && (
          <div className="w-72 flex-shrink-0">
            <CallDetail
              call={selectedCall}
              unit={selectedUnit}
              units={units}
              authorName={user?.name || user?.username || 'Dispatcher'}
              onClose={() => setSelectedCallId(null)}
              onTimestampUpdate={updateTimestamp}
              onLogTime={logTimeNow}
              onAddComment={addComment}
              onAssignUnit={assignUnit}
              onAddUnit={addUnitToCall}
              onRemoveUnit={removeUnitFromCall}
              onSplitCall={handleSplitCall}
              onCloseCall={closeCall}
              parentCall={parentCall}
              subCases={subCases}
              onUpdatePriority={updatePriority}
              onAddMutualAid={addMutualAid}
              onRemoveMutualAid={removeMutualAid}
            />
          </div>
        )}
      </div>

      {/* Modals */}
      {showNewCallModal && (
        <NewCallModal
          pin={newCallPin}
          units={units}
          onDispatch={handleDispatch}
          onClose={() => { setShowNewCallModal(false); setNewCallPin(null); setSplitParentId(null); }}
          parentCallNumber={splitParentId ? calls.find(c => c.id === splitParentId)?.call_number : null}
        />
      )}

      {contextMenu && (
        <MapContextMenu
          position={contextMenu}
          onStartCall={handleContextStartCall}
          onAddLocation={handleContextAddLocation}
          onClose={() => setContextMenu(null)}
        />
      )}

      {historyUnit && (
        <UnitHistoryModal
          unit={historyUnit}
          calls={calls}
          onClose={() => setHistoryUnit(null)}
        />
      )}

      {/* Shift setup — shown when no active shift */}
      {currentShift === null && !shiftSummary && (
        <ShiftSetup
          token={user?.token}
          onShiftStarted={handleShiftStarted}
        />
      )}

      {/* End-of-shift summary */}
      {shiftSummary && (
        <ShiftSummaryModal
          summary={shiftSummary}
          onClose={() => { setShiftSummary(null); logout(); navigate('/login'); }}
        />
      )}
    </div>
  );
}
