import { useState, useCallback, useRef } from 'react';
import { createCall, updateCallStatus, assignCall, closeCall as apiCloseCall, updateCallTimestamps, updateCallNarrative, updateCallLocation, addUnitToCall as apiAddUnitToCall, removeUnitFromCall as apiRemoveUnitFromCall, updateCallPriority as apiUpdatePriority, addMutualAid as apiAddMutualAid, removeMutualAid as apiRemoveMutualAid, addCallComment as apiAddComment } from '../services/api';

const STATUS_TS_MAP = {
  dispatched:      'dispatched_at',
  acknowledged:    'acknowledged_at',
  en_route:        'en_route_at',
  on_scene:        'on_scene_at',
  patient_contact: 'patient_contact_at',
  transporting:    'transporting_at',
  cleared:         'cleared_at',
  available:       'available_at'
};

// Reverse: timestamp field → call status (only fields that map directly to a status)
const TS_STATUS_MAP = {
  dispatched_at:      'dispatched',
  acknowledged_at:    'acknowledged',
  en_route_at:        'en_route',
  on_scene_at:        'on_scene',
  patient_contact_at: 'patient_contact',
  transporting_at:    'transporting',
  cleared_at:         'cleared',
  available_at:       'available'
};

const TS_STEPS = [
  'dispatched_at', 'acknowledged_at', 'en_route_at',
  'on_scene_at', 'patient_contact_at', 'transporting_at', 'arrived_first_aid_at',
  'cleared_at', 'available_at'
];

// Mirrors server's STATUS_SEQUENCE/isForwardStatusChange (server/src/index.js)
// so the local optimistic unit update below can't move a unit backward —
// same one-directional rule the server enforces for its own unit sync.
const UNIT_STATUS_SEQUENCE = ['dispatched', 'acknowledged', 'en_route', 'on_scene', 'patient_contact', 'transporting', 'cleared'];
function isForwardUnitStatus(fromStatus, toStatus) {
  const fromIdx = UNIT_STATUS_SEQUENCE.indexOf(fromStatus);
  const toIdx = UNIT_STATUS_SEQUENCE.indexOf(toStatus);
  if (fromIdx === -1 || toIdx === -1) return true;
  return toIdx >= fromIdx;
}

// setUnits is optional (CrewMobile calls useCalls() without it) — when
// provided, a call-level status advance also optimistically bumps the
// primary + co-dispatched units' status in the shared units state, the same
// way the server's own sync does. Without this, the call's status (and
// anything reading it) updates instantly from local state while the unit's
// status — read from a separate units array that only updates once the
// server's unit:status_change event round-trips back — sits stale until
// whatever event happens to arrive next, which reads as the unit panel
// getting "stuck" on the previous status.
export function useCalls(setUnits) {
  const [calls, setCalls] = useState([]);
  const loggingRef = useRef(new Set()); // tracks in-flight logTimeNow calls per callId

  // Returns a { unitId: previousStatus } snapshot of whatever it actually
  // changed, so a failed server write can be rolled back precisely instead
  // of leaving the optimistic guess stranded — see revertUnits/logTimeNow.
  const syncUnitsForward = useCallback((call, newStatus) => {
    if (!setUnits || !call) return null;
    const unitIds = [...new Set([call.assigned_unit_id, ...(call.co_unit_ids || []), ...(call.additional_unit_ids || [])])].filter(Boolean);
    if (!unitIds.length) return null;
    let snapshot = null;
    setUnits(prev => {
      snapshot = {};
      return prev.map(u => {
        if (unitIds.includes(u.id) && isForwardUnitStatus(u.status, newStatus)) {
          snapshot[u.id] = u.status;
          return { ...u, status: newStatus };
        }
        return u;
      });
    });
    return snapshot;
  }, [setUnits]);

  const revertUnits = useCallback((snapshot) => {
    if (!setUnits || !snapshot || !Object.keys(snapshot).length) return;
    setUnits(prev => prev.map(u => Object.prototype.hasOwnProperty.call(snapshot, u.id) ? { ...u, status: snapshot[u.id] } : u));
  }, [setUnits]);

  const handleCallCreated      = useCallback((call) => setCalls(prev => prev.some(c => c.id === call.id) ? prev : [call, ...prev]), []);
  const handleCallUpdated      = useCallback(({ call_id, changes }) =>
    setCalls(prev => prev.map(c => c.id === call_id ? { ...c, ...changes } : c)), []);
  const handleCallStatusChange = useCallback(({ call_id, status, ...timestamps }) =>
    setCalls(prev => prev.map(c => c.id === call_id ? { ...c, status, ...timestamps } : c)), []);
  const handleCallAssigned     = useCallback(({ call_id, unit_id }) =>
    setCalls(prev => prev.map(c => c.id === call_id ? { ...c, assigned_unit_id: unit_id } : c)), []);

  const dispatchCall = useCallback(async (data) => {
    try {
      const res = await createCall(data);
      return res.data; // socket will add it via handleCallCreated
    } catch (err) {
      // Surface the server's actual reason (e.g. 403 Forbidden, 409 unit
      // already on a call) instead of a generic message that only fits
      // real network failures.
      return { error: err?.response?.data?.error || 'Failed to dispatch — check connection and try again.' };
    }
  }, []);

  // Assign a unit to a pending (or active) call. Mirrors the server's own
  // rule (server/src/index.js, PATCH /api/calls/:id/assign): only a
  // first-time assignment bumps the call to 'dispatched' — swapping a unit
  // mid-call (e.g. while en route) must leave the call's status alone.
  const assignUnit = useCallback(async (callId, unitId) => {
    let snapshot = null;
    setCalls(prev => {
      snapshot = prev.find(c => c.id === callId) || null;
      return prev.map(c =>
        c.id === callId
          ? {
              ...c,
              assigned_unit_id: unitId,
              status: c.status === 'pending' ? 'dispatched' : c.status,
              dispatched_at: c.dispatched_at || new Date().toISOString()
            }
          : c
      );
    });
    try {
      await assignCall(callId, unitId);
      return null;
    } catch (err) {
      if (snapshot) setCalls(prev => prev.map(c => c.id === callId ? snapshot : c));
      return err?.response?.data?.error || 'Failed to assign unit';
    }
  }, []);

  const advanceStatus = useCallback(async (callId, status) => {
    const tsField = STATUS_TS_MAP[status];
    let snapshot = null;
    let callForSync = null;
    setCalls(prev => {
      snapshot = prev.find(c => c.id === callId) || null;
      return prev.map(c => {
        if (c.id !== callId) return c;
        callForSync = { ...c, status, ...(tsField ? { [tsField]: new Date().toISOString() } : {}) };
        return callForSync;
      });
    });
    syncUnitsForward(callForSync, status);
    try {
      await updateCallStatus(callId, status);
      return null;
    } catch (err) {
      if (snapshot) setCalls(prev => prev.map(c => c.id === callId ? snapshot : c));
      return err?.response?.data?.error || 'Status update failed';
    }
  }, [syncUnitsForward]);

  const updateTimestamp = useCallback((callId, field, isoValue) => {
    setCalls(prev => prev.map(c => c.id === callId ? { ...c, [field]: isoValue } : c));
    updateCallTimestamps(callId, { [field]: isoValue }).catch(() => {});
  }, []);

  const logTimeNow = useCallback((callId) => {
    if (loggingRef.current.has(callId)) return;
    loggingRef.current.add(callId);
    const now = new Date().toISOString();
    let nextField = null;
    let callSnapshot = null;
    let callForSync = null;
    setCalls(prev => prev.map(c => {
      if (c.id !== callId) return c;
      callSnapshot = c;
      // Start the search after the call's current status, not from the
      // beginning — a call can legitimately reach its current status without
      // every earlier milestone having been logged (e.g. crew jumped
      // straight to Patient Contact), leaving that earlier field null
      // forever. Scanning from the start would offer that already-passed
      // step as "next" and log it, regressing the call's status backward.
      const currentIdx = TS_STEPS.indexOf(STATUS_TS_MAP[c.status]);
      nextField = TS_STEPS.slice(currentIdx + 1).find(f => !c[f]);
      if (!nextField) return c;
      const newStatus = TS_STATUS_MAP[nextField];
      callForSync = { ...c, [nextField]: now, ...(newStatus ? { status: newStatus } : {}) };
      return callForSync;
    }));
    if (nextField) {
      const newStatus = TS_STATUS_MAP[nextField];
      const unitsSnapshot = newStatus ? syncUnitsForward(callForSync, newStatus) : null;
      // Both requests must land, or the optimistic call/unit state rolls back
      // to what it was before this click — otherwise a silently-failed write
      // (previously swallowed by .catch(() => {})) left the call's status
      // permanently stuck ahead of the units' real status, with nothing to
      // ever pull it back except the next successful Log Now overwriting it.
      Promise.all([
        updateCallTimestamps(callId, { [nextField]: now }),
        newStatus ? updateCallStatus(callId, newStatus) : Promise.resolve()
      ]).catch(() => {
        setCalls(prev => prev.map(c => c.id === callId ? callSnapshot : c));
        revertUnits(unitsSnapshot);
      });
    }
    setTimeout(() => loggingRef.current.delete(callId), 1000);
  }, [syncUnitsForward, revertUnits]);

  const closeCall = useCallback(async (callId, disposition, close_notes) => {
    let snapshot = null;
    setCalls(prev => {
      snapshot = prev.find(c => c.id === callId) || null;
      return prev.map(c =>
        c.id === callId
          ? { ...c, status: 'closed', disposition, close_notes, closed_at: new Date().toISOString() }
          : c
      );
    });
    try {
      await apiCloseCall(callId, disposition, close_notes);
      return null;
    } catch (err) {
      if (snapshot) setCalls(prev => prev.map(c => c.id === callId ? snapshot : c));
      return err?.response?.data?.error || 'Failed to close call';
    }
  }, []);

  const addUnitToCall = useCallback(async (callId, unitId, initialStatus = 'dispatched') => {
    let snapshot = null;
    setCalls(prev => {
      snapshot = prev.find(c => c.id === callId) || null;
      return prev.map(c =>
        c.id === callId
          ? { ...c, additional_unit_ids: [...(c.additional_unit_ids || []).filter(id => id !== unitId), unitId] }
          : c
      );
    });
    try {
      await apiAddUnitToCall(callId, unitId, initialStatus);
      return null;
    } catch (err) {
      if (snapshot) setCalls(prev => prev.map(c => c.id === callId ? snapshot : c));
      return err?.response?.data?.error || 'Failed to add unit';
    }
  }, []);

  const removeUnitFromCall = useCallback(async (callId, unitId) => {
    setCalls(prev => prev.map(c =>
      c.id === callId
        ? { ...c, additional_unit_ids: (c.additional_unit_ids || []).filter(id => id !== unitId) }
        : c
    ));
    try { await apiRemoveUnitFromCall(callId, unitId); } catch {}
  }, []);

  const updateCallLocationPin = useCallback(async (callId, lat, lng) => {
    setCalls(prev => prev.map(c => c.id === callId ? { ...c, location_lat: lat, location_lng: lng } : c));
    try { await updateCallLocation(callId, { location_lat: lat, location_lng: lng }); } catch {}
  }, []);

  const updatePriority = useCallback(async (callId, priority) => {
    setCalls(prev => prev.map(c => c.id === callId ? { ...c, priority } : c));
    try { await apiUpdatePriority(callId, priority); } catch {}
  }, []);

  const addMutualAid = useCallback(async (callId, name, unit_id, role) => {
    try {
      const res = await apiAddMutualAid(callId, name, unit_id, role);
      setCalls(prev => prev.map(c =>
        c.id === callId ? { ...c, mutual_aid_agencies: [...(c.mutual_aid_agencies || []), res.data] } : c
      ));
    } catch {}
  }, []);

  const removeMutualAid = useCallback(async (callId, entryId) => {
    setCalls(prev => prev.map(c =>
      c.id === callId
        ? { ...c, mutual_aid_agencies: (c.mutual_aid_agencies || []).filter(e => e.id !== entryId) }
        : c
    ));
    try { await apiRemoveMutualAid(callId, entryId); } catch {}
  }, []);

  const handleCommentAdded = useCallback(({ call_id, comment }) => {
    setCalls(prev => prev.map(c =>
      c.id === call_id ? { ...c, comments: [...(c.comments || []), comment] } : c
    ));
  }, []);

  const addComment = useCallback(async (callId, text, author = 'Dispatcher') => {
    try {
      await apiAddComment(callId, text, author);
      // server emits 'call:comment_added' which handleCommentAdded will pick up
      return null;
    } catch (err) {
      return err?.response?.data?.error || 'Failed to send';
    }
  }, []);

  return {
    calls, setCalls,
    handleCallCreated, handleCallUpdated, handleCallStatusChange, handleCallAssigned,
    handleCommentAdded,
    dispatchCall, assignUnit, advanceStatus, closeCall, updateTimestamp, logTimeNow, addComment,
    addUnitToCall, removeUnitFromCall, updatePriority, updateCallLocationPin, addMutualAid, removeMutualAid
  };
}
