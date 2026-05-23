import { useState, useCallback } from 'react';
import { createCall, updateCallStatus, assignCall, closeCall as apiCloseCall, updateCallTimestamps, updateCallNarrative, addUnitToCall as apiAddUnitToCall, removeUnitFromCall as apiRemoveUnitFromCall, updateCallPriority as apiUpdatePriority, addMutualAid as apiAddMutualAid, removeMutualAid as apiRemoveMutualAid } from '../services/api';

const STATUS_TS_MAP = {
  dispatched:      'dispatched_at',
  acknowledged:    'acknowledged_at',
  en_route:        'en_route_at',
  on_scene:        'on_scene_at',
  patient_contact: 'patient_contact_at',
  cleared:         'cleared_at',
  available:       'available_at'
};

const TS_STEPS = [
  'dispatched_at', 'acknowledged_at', 'en_route_at',
  'on_scene_at', 'patient_contact_at', 'cleared_at', 'available_at'
];

export function useCalls() {
  const [calls, setCalls] = useState([]);

  const handleCallCreated      = useCallback((call) => setCalls(prev => prev.some(c => c.id === call.id) ? prev : [call, ...prev]), []);
  const handleCallUpdated      = useCallback(({ call_id, changes }) =>
    setCalls(prev => prev.map(c => c.id === call_id ? { ...c, ...changes } : c)), []);
  const handleCallStatusChange = useCallback(({ call_id, status }) =>
    setCalls(prev => prev.map(c => c.id === call_id ? { ...c, status } : c)), []);
  const handleCallAssigned     = useCallback(({ call_id, unit_id }) =>
    setCalls(prev => prev.map(c => c.id === call_id ? { ...c, assigned_unit_id: unit_id } : c)), []);

  const dispatchCall = useCallback(async (data) => {
    try {
      const res = await createCall(data);
      return res.data; // socket will add it via handleCallCreated
    } catch {
      return null;
    }
  }, []);

  // Assign a unit to a pending (or active) call
  const assignUnit = useCallback(async (callId, unitId) => {
    setCalls(prev => prev.map(c =>
      c.id === callId
        ? {
            ...c,
            assigned_unit_id: unitId,
            status: 'dispatched',
            dispatched_at: c.dispatched_at || new Date().toISOString()
          }
        : c
    ));
    try { await assignCall(callId, unitId); } catch {}
  }, []);

  const advanceStatus = useCallback(async (callId, status) => {
    const tsField = STATUS_TS_MAP[status];
    setCalls(prev => prev.map(c =>
      c.id === callId
        ? { ...c, status, ...(tsField ? { [tsField]: new Date().toISOString() } : {}) }
        : c
    ));
    try { await updateCallStatus(callId, status); } catch {}
  }, []);

  const updateTimestamp = useCallback((callId, field, isoValue) => {
    setCalls(prev => prev.map(c => c.id === callId ? { ...c, [field]: isoValue } : c));
    updateCallTimestamps(callId, { [field]: isoValue }).catch(() => {});
  }, []);

  const logTimeNow = useCallback((callId) => {
    let nextField = null;
    setCalls(prev => prev.map(c => {
      if (c.id !== callId) return c;
      nextField = TS_STEPS.find(f => !c[f]);
      if (!nextField) return c;
      return { ...c, [nextField]: new Date().toISOString() };
    }));
    if (nextField) updateCallTimestamps(callId, { [nextField]: new Date().toISOString() }).catch(() => {});
  }, []);

  const closeCall = useCallback(async (callId, disposition, close_notes) => {
    setCalls(prev => prev.map(c =>
      c.id === callId
        ? { ...c, status: 'closed', disposition, close_notes, closed_at: new Date().toISOString() }
        : c
    ));
    try { await apiCloseCall(callId, disposition, close_notes); } catch {}
  }, []);

  const addUnitToCall = useCallback(async (callId, unitId) => {
    setCalls(prev => prev.map(c =>
      c.id === callId
        ? { ...c, additional_unit_ids: [...(c.additional_unit_ids || []).filter(id => id !== unitId), unitId] }
        : c
    ));
    try { await apiAddUnitToCall(callId, unitId); } catch {}
  }, []);

  const removeUnitFromCall = useCallback(async (callId, unitId) => {
    setCalls(prev => prev.map(c =>
      c.id === callId
        ? { ...c, additional_unit_ids: (c.additional_unit_ids || []).filter(id => id !== unitId) }
        : c
    ));
    try { await apiRemoveUnitFromCall(callId, unitId); } catch {}
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

  const addComment = useCallback((callId, text, author = 'Dispatcher') => {
    const comment = { id: `cmt-${Date.now()}`, text, author, created_at: new Date().toISOString() };
    setCalls(prev => prev.map(c =>
      c.id === callId ? { ...c, comments: [...(c.comments || []), comment] } : c
    ));
  }, []);

  return {
    calls, setCalls,
    handleCallCreated, handleCallUpdated, handleCallStatusChange, handleCallAssigned,
    dispatchCall, assignUnit, advanceStatus, closeCall, updateTimestamp, logTimeNow, addComment,
    addUnitToCall, removeUnitFromCall, updatePriority, addMutualAid, removeMutualAid
  };
}
