import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useUnits } from '../hooks/useUnits';
import { useCalls } from '../hooks/useCalls';
import { useLocations } from '../hooks/useLocations';
import { useSocket } from '../hooks/useSocket';
import { useCrewGps, stopCrewGpsTracking } from '../hooks/useCrewGps';
import { useCrewNotifications } from '../hooks/useCrewNotifications';
import ActiveCall from '../components/crew/ActiveCall';
import StatusButtons from '../components/crew/StatusButtons';
import CrewCaseHistory from '../components/crew/CrewCaseHistory';
import ErrorBoundary from '../components/ErrorBoundary';
import CallSummaryModal from '../components/calls/CallSummaryModal';
import NativeSetupModal from '../components/crew/NativeSetupModal';
import BeaconMode from '../components/crew/BeaconMode';
import { toggleUnitBeacon, setCrewGpsSharing } from '../services/api';
import { STATUS_COLORS, STATUS_LABELS } from '../data/mockData';

const NON_TRANSPORT_DISPOSITIONS = [
  { id: 'treated_refused', label: 'Treated / Refused Transport', icon: '🩺' },
  { id: 'refused_care',    label: 'Patient Refused Care',         icon: '🚫' },
  { id: 'no_patient',      label: 'No Patient Found (UTL)',       icon: '🔍' },
  { id: 'cancelled',       label: 'Cancelled / False Alarm',      icon: '❌' },
  { id: 'standby',         label: 'No Treatment Needed',          icon: '✅' },
  { id: 'doa',             label: 'Patient DOA',                  icon: '🕯️' },
];

function CrewDisposition({ call, onClose, onConfirm }) {
  const [chosen, setChosen] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!chosen) return;
    setSubmitting(true);
    try { await onConfirm(call.id, chosen, notes.trim()); } finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-end" onClick={onClose}>
      <div
        className="w-full bg-gray-800 rounded-t-2xl p-4 space-y-3 max-h-[80vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <div className="text-white font-bold text-base">Non-Transport Disposition</div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl w-8 h-8 flex items-center justify-center leading-none">×</button>
        </div>

        <div className="space-y-2">
          {NON_TRANSPORT_DISPOSITIONS.map(d => (
            <button
              key={d.id}
              onClick={() => setChosen(d.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left text-sm font-medium transition-colors
                ${chosen === d.id ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-200 active:bg-gray-600'}`}
            >
              <span className="text-lg">{d.icon}</span>
              <span>{d.label}</span>
            </button>
          ))}
        </div>

        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Notes (optional)…"
          rows={2}
          className="w-full bg-gray-700 text-white rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500 resize-none"
        />

        <button
          onClick={submit}
          disabled={!chosen || submitting}
          className="w-full py-3.5 rounded-xl bg-red-700 active:bg-red-800 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold text-sm transition-colors"
        >
          {submitting ? 'Closing…' : 'Close Call'}
        </button>
      </div>
    </div>
  );
}

function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function CrewChat({ call, myUnit, onSend }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const listRef = useRef(null);
  const comments = call.comments || [];
  const isCompleted = call.status === 'closed';

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [comments.length]);

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setSendError('');
    const err = await onSend(trimmed);
    setSending(false);
    if (err) { setSendError(err); return; }
    setText('');
  };

  return (
    <div className="bg-gray-800 rounded-2xl border border-gray-700 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-700 text-sm font-semibold text-gray-300 flex items-center gap-2">
        <span>💬 Dispatch Chat</span>
        {comments.length > 0 && (
          <span className="text-gray-500 font-normal text-xs">({comments.length})</span>
        )}
      </div>

      <div ref={listRef} className="px-3 py-3 space-y-2 max-h-52 overflow-y-auto">
        {comments.length === 0 ? (
          <div className="text-gray-500 text-xs text-center py-3">No messages yet</div>
        ) : (
          comments.map(c => {
            const isMe = c.author === myUnit.unit_number;
            return (
              <div key={c.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 ${
                  isMe ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-100'
                }`}>
                  <div className="text-xs opacity-70 mb-0.5">
                    {isMe ? 'You' : c.author}
                    {c.created_at && ` · ${fmtTime(c.created_at)}`}
                  </div>
                  <div className="text-sm leading-snug">{c.text}</div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {sendError && (
        <div className="px-3 pb-1.5 text-red-400 text-xs">{sendError}</div>
      )}
      <div className="px-3 pb-3 flex gap-2">
        <input
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder={isCompleted ? 'Add late note…' : 'Message dispatch…'}
          className="flex-1 bg-gray-700 text-white rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-500"
        />
        <button
          onClick={submit}
          disabled={!text.trim() || sending}
          className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 text-white text-sm rounded-xl transition-colors font-semibold"
        >
          {sending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}

export default function CrewMobile() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const { units, setUnits, handleGpsUpdate, handleStatusChange, changeStatus, handleUnitUpdated } = useUnits();
  const {
    calls, setCalls,
    handleCallCreated, handleCallUpdated, handleCallStatusChange, handleCommentAdded,
    advanceStatus, addComment, closeCall
  } = useCalls();
  // Only permanent landmarks are shown to crew — shift-scoped pins are more likely
  // a dispatcher's today-only staging note than a durable park landmark.
  const { locations } = useLocations();
  const landmarkLocations = locations.filter(l => l.locationType === 'permanent');

  const [statusLoading,    setStatusLoading]    = useState(false);
  const [statusError,      setStatusError]      = useState(null);
  const [backupSubmitting, setBackupSubmitting] = useState(false);
  const [backupError,      setBackupError]      = useState('');
  const [lastActiveCallId, setLastActiveCallId] = useState(null);
  const [dismissedCallId,  setDismissedCallId]  = useState(null);
  const [showDisposition,  setShowDisposition]  = useState(false);
  const [shiftEnded,       setShiftEnded]       = useState(false);
  const [showCaseSummary,  setShowCaseSummary]  = useState(false);
  const [showCaseHistory,  setShowCaseHistory]  = useState(false);
  const [showBeacon,       setShowBeacon]       = useState(false);
  const isNative = !!(window.Capacitor?.isNativePlatform?.());
  const { scheduleNotif } = useCrewNotifications();
  const [showNativeSetup,  setShowNativeSetup]  = useState(
    isNative && !localStorage.getItem('native_setup_done')
  );

  const myUnit = units.find(u =>
    u.id === user?.unit_id || u.unit_number === user?.unit_number
  ) || null;

  // Non-closed call — drives status buttons and SOS
  const myActiveCall = calls.find(c => {
    if (c.status === 'closed') return false;
    if (!myUnit) return false;
    return c.assigned_unit_id === myUnit.id ||
      (c.additional_unit_ids || []).includes(myUnit.id);
  }) || null;

  // Track the last active call ID so we can still show info after dispatch closes it
  useEffect(() => {
    if (myActiveCall) setLastActiveCallId(myActiveCall.id);
  }, [myActiveCall?.id]);

  // Reset when unit changes (new shift)
  useEffect(() => {
    setLastActiveCallId(null);
    setDismissedCallId(null);
  }, [myUnit?.id]);

  // The call to display: active first, then the recently-closed one until the crew dismisses it
  const myLastCall = lastActiveCallId && lastActiveCallId !== dismissedCallId
    ? (calls.find(c => c.id === lastActiveCallId) || null)
    : null;
  const myCall = myActiveCall || myLastCall;
  const callIsCompleted = !myActiveCall && !!myLastCall;

  // Derived from the call's own comment history, not local state — a local
  // flag reset to false on every app restart even if a request was already
  // sent and dispatch already saw it, making it look like nothing had been
  // sent (and inviting a duplicate request) after any app kill/reopen.
  const backupRequested = !!(() => {
    if (!myActiveCall || !myUnit) return false;
    const mine = (myActiveCall.comments || [])
      .filter(c => c.author === myUnit.unit_number &&
        (c.text?.startsWith('🆘 BACKUP REQUESTED') || c.text?.startsWith('✅ Backup no longer needed')))
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    return mine[mine.length - 1]?.text.startsWith('🆘 BACKUP REQUESTED');
  })();

  // Stale token: unit found by unit_number but ID doesn't match. Force re-login.
  useEffect(() => {
    if (!units.length) return;
    if (myUnit && user?.unit_id && myUnit.id !== user.unit_id) {
      stopCrewGpsTracking();
      logout();
      navigate('/login');
    }
  }, [myUnit?.id, user?.unit_id, units.length]);

  // Reset backup button transient state when active call changes
  useEffect(() => {
    setBackupSubmitting(false);
    setBackupError('');
  }, [myActiveCall?.id]);

  // GPS is on by default for the whole shift — this is the crew's own opt-out.
  // Local state rather than reading myUnit.gps_sharing_disabled directly:
  // the server only broadcasts this change to dispatchers, not back to the
  // crew socket, so this device wouldn't see its own change reflected otherwise.
  const [gpsSharingEnabled, setGpsSharingEnabled] = useState(true);
  const [gpsSharingBusy,    setGpsSharingBusy]    = useState(false);

  const handleToggleGpsSharing = async () => {
    const next = !gpsSharingEnabled;
    setGpsSharingBusy(true);
    setGpsSharingEnabled(next);
    // The native tracker is no longer stopped implicitly when this flips
    // `enabled` to false (see useCrewGps.js) -- turning sharing off has to
    // explicitly stop it, or the phone would keep running the tracker and
    // draining battery even though dispatch no longer sees the pin.
    if (!next) stopCrewGpsTracking();
    try {
      await setCrewGpsSharing(next);
    } catch {
      setGpsSharingEnabled(!next);
    }
    setGpsSharingBusy(false);
  };

  // Held off while the one-time setup screen is up — its own "Grant Location" step
  // already drives the permission request; letting this hook fire at the same time
  // races it and can cause iOS to drop or reorder the While-Using/Always dialogs.
  const { bgPermNeeded, openGpsSettings, gpsStatus } = useCrewGps({
    token: user?.token,
    unit: myUnit,
    enabled: !!myUnit && !showNativeSetup && gpsSharingEnabled,
  });

  // Hardware/gesture back on Android and the floating back button on iOS both
  // call into window.__handleNativeBack natively (MainActivity.java /
  // MainViewController.swift) instead of going through @capacitor/app's JS
  // bridge. That bridge call turned out to be unreliable on this screen: this
  // app runs with a remote server.url (sfotems.com) as its primary origin, and
  // Capacitor only fully re-injects its native bridge (window.Capacitor.
  // PluginHeaders) for that primary origin -- cad.sfotems.com, reached via
  // allowNavigation, loads without it, so any @capacitor/app call here throws
  // "plugin is not implemented" even though the plugin is registered natively.
  // A plain evaluateJavascript() call doesn't go through that machinery at all,
  // so it works regardless. Close whichever full-screen overlay is open first;
  // otherwise step back through WebView history. A ref (kept fresh every
  // render) avoids the native call reading stale state.
  const closeTopOverlayRef = useRef(null);
  closeTopOverlayRef.current = () => {
    if (showDisposition)  { setShowDisposition(false); return true; }
    if (showCaseSummary)  { setShowCaseSummary(false); return true; }
    if (showCaseHistory)  { setShowCaseHistory(false); return true; }
    if (showBeacon)       { setShowBeacon(false); return true; }
    return false;
  };

  useEffect(() => {
    if (!isNative) return;
    window.__handleNativeBack = () => closeTopOverlayRef.current?.() || false;
    return () => { delete window.__handleNativeBack; };
  }, [isNative]);

  // Status taps and chat messages just failed silently with an inline error
  // if the network dropped, with nothing ambient telling the crew member
  // they're offline in the first place. GPS already has its own native-layer
  // offline queue; this is just a heads-up for everything else.
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  useEffect(() => {
    const goOnline  = () => setIsOffline(false);
    const goOffline = () => setIsOffline(true);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  useSocket({
    'unit:gps_update':     handleGpsUpdate,
    'unit:status_change':  handleStatusChange,
    'unit:updated':        handleUnitUpdated,
    'call:created':        handleCallCreated,
    'call:updated':        handleCallUpdated,
    'call:status_change':  handleCallStatusChange,
    'call:assigned_to_me': (call) => {
      handleCallCreated(call);
      scheduleNotif(
        `📡 New Call — Case #${call.call_number}`,
        `${call.call_type} · ${call.location_name || 'Unknown location'}`
      );
    },
    'call:comment_added':  handleCommentAdded,
    'shift:ended':         () => { setUnits([]); setCalls([]); setShiftEnded(true); }
  });

  const handleStatusTap = async (status) => {
    if (!myUnit) return;
    setStatusLoading(true);
    setStatusError(null);
    try {
      const err = await changeStatus(myUnit.id, status);
      if (err) { setStatusError(err); return; }
      // Any unit tied to the call (primary or additional) can push the call's
      // own status/timeline forward — the server already allows this and
      // guards it forward-only, so a backup unit's real progress isn't stuck
      // behind the primary's own button presses. The one exception is
      // cleared/available: only the primary drives the call to a close-out
      // status, so a backup unit finishing early can't flip the whole call
      // (and yank the primary back to available) while it's still active.
      if (myActiveCall) {
        const isPrimary = myActiveCall.assigned_unit_id === myUnit.id;
        if (isPrimary || !['cleared', 'available'].includes(status)) {
          const callErr = await advanceStatus(myActiveCall.id, status);
          if (callErr) setStatusError(callErr);
        }
      }
    } catch {
      setStatusError('Status update failed — try again');
    } finally {
      setStatusLoading(false);
    }
  };

  // Fixes a misclick on just this unit's own status — deliberately never
  // touches the call's shared record (that's dispatch's Timestamps editor),
  // since backing up a multi-unit call's own status could yank a different
  // unit's genuinely-further-along progress backward with it.
  const handleUndoStatus = async (prevStatus) => {
    if (!myUnit) return;
    setStatusLoading(true);
    setStatusError(null);
    try {
      const err = await changeStatus(myUnit.id, prevStatus);
      if (err) setStatusError(err);
    } catch {
      setStatusError('Status update failed — try again');
    } finally {
      setStatusLoading(false);
    }
  };

  // backupRequested itself is derived from the call's comments (set by the
  // server echo), never set optimistically here — a false "Backup Requested"
  // is worse than no request at all (dispatch never sees it, but the crew
  // member thinks help is coming).
  const handleRequestBackup = useCallback(async () => {
    if (!myActiveCall || !myUnit || backupSubmitting) return;
    const next = !backupRequested;
    const text = next
      ? `🆘 BACKUP REQUESTED — ${myUnit.unit_number}`
      : `✅ Backup no longer needed — ${myUnit.unit_number}`;
    setBackupSubmitting(true);
    setBackupError('');
    const err = await addComment(myActiveCall.id, text, myUnit.unit_number);
    setBackupSubmitting(false);
    if (err) {
      setBackupError(next ? 'Backup request failed to send — tap to try again' : 'Failed to cancel — tap to try again');
    }
  }, [backupRequested, backupSubmitting, myActiveCall, myUnit, addComment]);

  const beaconActive   = !!myUnit?.beacon_active;
  const othersBeaconing = units.some(u => u.beacon_active && u.id !== myUnit?.id);

  const handleToggleBeacon = async () => {
    if (!myUnit) return;
    const next = !beaconActive;
    setUnits(prev => prev.map(u => u.id === myUnit.id ? { ...u, beacon_active: next } : u));
    try { await toggleUnitBeacon(myUnit.id, next); }
    catch { setUnits(prev => prev.map(u => u.id === myUnit.id ? { ...u, beacon_active: beaconActive } : u)); }
  };

  // window.open() inside a Capacitor native WebView is unreliable — it can
  // silently no-op instead of opening a real browser tab. @capacitor/browser
  // is the supported way to hand an external link off to the system browser.
  const openProtocols = async () => {
    const url = 'https://sfotems.com/protocols';
    if (isNative) {
      try {
        const { Browser } = await import('@capacitor/browser');
        await Browser.open({ url });
        return;
      } catch {}
    }
    window.open(url, '_blank');
  };

  // Ticks every 10s so the GPS staleness check below re-evaluates even with
  // no new props coming in — otherwise a dead tracker just keeps showing
  // whatever color it last rendered, silently, with nothing on this screen
  // to tell the crew member their own GPS stopped (matches the watchdog's
  // ~75-105s recovery window, so this should light up before or right as
  // that kicks in rather than long after).
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 10000);
    return () => clearInterval(t);
  }, []);
  const GPS_STALE_MS = 90000;
  const gpsAgeMs = myUnit?.last_gps_at ? nowTick - new Date(myUnit.last_gps_at).getTime() : null;
  const gpsStale = gpsAgeMs != null && gpsAgeMs > GPS_STALE_MS;

  const unitColor = STATUS_COLORS[myUnit?.status] || '#9ca3af';

  if (!myUnit) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-6 text-center max-w-md mx-auto">
        <div className="text-5xl mb-4">{shiftEnded ? '🏁' : '🚑'}</div>
        <div className="text-white font-bold text-lg mb-1">
          {shiftEnded ? 'Shift Ended' : 'No Active Shift'}
        </div>
        <div className="text-gray-400 text-sm mb-6">
          {shiftEnded
            ? 'Dispatch has ended the shift. Sign out and back in when the next shift begins.'
            : 'Waiting for dispatch to start the shift. Check back soon.'}
        </div>
        <div className="text-gray-600 text-xs mb-8">Logged in as {user?.unit_number}</div>
        <button
          onClick={() => { stopCrewGpsTracking(); logout(); navigate('/login'); }}
          className="text-gray-500 hover:text-white text-xs px-3 py-1.5 rounded hover:bg-gray-700 transition-colors border border-gray-700"
        >
          Sign out
        </button>
      </div>
    );
  }

  if (showNativeSetup) {
    return <NativeSetupModal onDone={() => setShowNativeSetup(false)} />;
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col max-w-md mx-auto">

      {/* Offline banner — status taps/chat will fail until this clears */}
      {isOffline && (
        <div className="bg-gray-950 border-b border-gray-700 px-4 py-2 flex items-center gap-2">
          <span className="text-gray-400 text-sm flex-shrink-0">📡</span>
          <span className="text-gray-400 text-xs">No connection — status updates and messages won't send until reconnected</span>
        </div>
      )}

      {/* Background GPS permission banner */}
      {bgPermNeeded && (
        <div className="bg-amber-900/80 border-b border-amber-600 px-4 py-3 flex items-center gap-3">
          <span className="text-amber-400 text-xl flex-shrink-0">⚠️</span>
          <div className="flex-1 min-w-0">
            <div className="text-amber-200 font-semibold text-sm">GPS needs background access</div>
            <div className="text-amber-300/80 text-xs mt-0.5">Set location to "Allow all the time" so tracking works with screen off.</div>
          </div>
          <button
            onClick={openGpsSettings}
            className="flex-shrink-0 bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs px-3 py-1.5 rounded-lg transition-colors"
          >
            Fix Now
          </button>
        </div>
      )}

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
          <button
            onClick={() => { stopCrewGpsTracking(); logout(); navigate('/login'); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-900/40 hover:bg-red-700 border border-red-700/60 hover:border-red-500 text-red-400 hover:text-white text-xs font-semibold transition-colors"
          >
            <span>⏹</span> End Tracking
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
          {isNative ? (
            // Always reachable, not gated behind bgPermNeeded — that flag only ever
            // fires on outright denial, never on the far more common "stuck at While
            // Using instead of Always" case, which produces no error at all.
            <button
              onClick={openGpsSettings}
              className="ml-auto flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/20 hover:bg-black/35 transition-colors"
            >
              <div className={`w-1.5 h-1.5 rounded-full ${gpsStale ? 'bg-amber-400' : myUnit.last_gps_at ? 'bg-green-400' : 'bg-gray-500'}`} />
              <span className={`text-xs ${gpsStale ? 'text-amber-400' : myUnit.last_gps_at ? 'text-green-400' : 'text-gray-400'}`}>
                {gpsStale ? 'GPS stale' : 'GPS'}
              </span>
              <span className="text-gray-400 text-xs">⚙️</span>
            </button>
          ) : (
            myUnit.last_gps_at && (
              <div className="ml-auto flex items-center gap-1">
                <div className={`w-1.5 h-1.5 rounded-full ${gpsStale ? 'bg-amber-400' : 'bg-green-400'}`} />
                <span className={`text-xs ${gpsStale ? 'text-amber-400' : 'text-green-400'}`}>{gpsStale ? 'GPS stale' : 'GPS'}</span>
              </div>
            )
          )}
        </div>

        {/* GPS sharing opt-out — on by default for the whole shift */}
        <div className="mt-2 flex items-center justify-between rounded-xl px-4 py-2 bg-gray-900/50 border border-gray-700">
          <div className="pr-3">
            <div className="text-xs font-medium text-gray-300">Share my location with dispatch</div>
            <div className="text-[10px] text-gray-500">Tracked continuously while on shift unless turned off</div>
          </div>
          <button
            onClick={handleToggleGpsSharing}
            disabled={gpsSharingBusy}
            aria-label="Toggle GPS sharing"
            className={`relative w-11 h-6 rounded-full flex-shrink-0 transition-colors disabled:opacity-50 ${
              gpsSharingEnabled ? 'bg-green-600' : 'bg-gray-600'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                gpsSharingEnabled ? 'translate-x-5' : ''
              }`}
            />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {statusError && (
          <div className="px-3 py-2 rounded-xl bg-red-900/60 border border-red-700 text-red-200 text-sm flex items-center gap-2">
            <span>⚠️</span>
            <span className="flex-1">{statusError}</span>
            <button onClick={() => setStatusError(null)} className="text-red-400 hover:text-white text-lg leading-none">×</button>
          </div>
        )}

        <ActiveCall
          call={myCall}
          myUnit={myUnit}
          units={units}
          isCompleted={callIsCompleted}
          onDismiss={() => setDismissedCallId(myCall?.id)}
          locations={landmarkLocations}
        />

        {callIsCompleted && myCall && (
          <button
            onClick={() => setShowCaseSummary(true)}
            className="w-full py-3 rounded-2xl bg-gray-800 border border-gray-700 text-gray-300 active:bg-gray-700 text-sm font-semibold transition-colors flex items-center justify-center gap-2"
          >
            📊 View Case Summary (Times for Chart)
          </button>
        )}

        {myCall && (
          <CrewChat
            call={myCall}
            myUnit={myUnit}
            onSend={(text) => addComment(myCall.id, text, myUnit.unit_number)}
          />
        )}

        {myUnit && (
          <StatusButtons
            currentStatus={myUnit.status}
            onStatusChange={handleStatusTap}
            onUndo={handleUndoStatus}
            loading={statusLoading}
            hasCall={!!myActiveCall}
          />
        )}

        {myActiveCall && (
          <button
            onClick={() => setShowDisposition(true)}
            className="w-full py-3 rounded-2xl bg-gray-800 border border-gray-700 text-gray-400 active:bg-gray-700 text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            📋 Non-Transport Disposition
          </button>
        )}

        <button
          onClick={() => setShowCaseHistory(true)}
          className="w-full py-3 rounded-2xl bg-gray-800 border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 text-sm font-medium transition-colors flex items-center justify-center gap-2"
        >
          📁 My Cases
        </button>

        {/* Beacon row */}
        <div className="flex gap-2">
          <button
            onClick={handleToggleBeacon}
            className={`flex-1 py-3 rounded-2xl border text-sm font-semibold transition-all flex items-center justify-center gap-2
              ${beaconActive
                ? 'bg-green-900/60 border-green-600 text-green-300 shadow-[0_0_12px_rgba(34,197,94,0.3)]'
                : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500 hover:text-white'}`}
          >
            🔦 {beaconActive ? 'Beacon ON' : 'Beacon'}
          </button>
          {othersBeaconing && (
            <button
              onClick={() => setShowBeacon(true)}
              className="flex-1 py-3 rounded-2xl bg-blue-900/50 border border-blue-700 text-blue-300 hover:bg-blue-800/60 text-sm font-semibold transition-all flex items-center justify-center gap-2"
            >
              🧭 Find Medic
            </button>
          )}
        </div>

        <button
          onClick={openProtocols}
          className="w-full py-3 rounded-2xl bg-gray-800 border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 text-sm font-medium transition-colors flex items-center justify-center gap-2"
        >
          📖 Protocols
        </button>
      </div>

      {showCaseSummary && myCall && (
        <ErrorBoundary onClose={() => setShowCaseSummary(false)}>
          <CallSummaryModal
            call={myCall}
            units={units}
            onClose={() => setShowCaseSummary(false)}
          />
        </ErrorBoundary>
      )}

      {showCaseHistory && (
        <ErrorBoundary onClose={() => setShowCaseHistory(false)}>
          <CrewCaseHistory
            units={units}
            onClose={() => setShowCaseHistory(false)}
          />
        </ErrorBoundary>
      )}

      {showBeacon && (
        <BeaconMode
          myUnit={myUnit}
          units={units}
          beaconActive={beaconActive}
          onToggleBeacon={handleToggleBeacon}
          onClose={() => setShowBeacon(false)}
        />
      )}

      {showDisposition && myActiveCall && (
        <CrewDisposition
          call={myActiveCall}
          onClose={() => setShowDisposition(false)}
          onConfirm={async (callId, disposition, notes) => {
            const err = await closeCall(callId, disposition, notes);
            if (err) { setStatusError(err); return; }
            setShowDisposition(false);
          }}
        />
      )}

      {/* SOS button — fixed to bottom, only when on an active (non-closed) call */}
      {myActiveCall && (
        <div className="flex-shrink-0 p-3 border-t border-gray-700 bg-gray-900 space-y-1.5">
          {backupError && (
            <div className="text-red-400 text-xs text-center font-medium">{backupError}</div>
          )}
          <button
            onClick={handleRequestBackup}
            disabled={backupSubmitting}
            className={`w-full py-4 rounded-xl font-black text-base tracking-wide transition-all active:scale-95 disabled:opacity-60
              ${backupRequested
                ? 'bg-green-800 border border-green-600 text-green-300'
                : 'bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-900/50'
              }`}
          >
            {backupSubmitting
              ? (backupRequested ? 'Cancelling…' : 'Sending…')
              : backupRequested ? '✓ Backup Requested — Tap to Cancel' : '🆘 Request Backup'}
          </button>
        </div>
      )}
    </div>
  );
}
