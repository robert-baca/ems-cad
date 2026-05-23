import { useState, useCallback } from 'react';
import { MOCK_ALL_CALLS } from '../data/mockData';
import { createCall, updateCallStatus, assignCall, closeCall as apiCloseCall } from '../services/api';

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
  }, []);

  const logTimeNow = useCallback((callId) => {
    setCalls(prev => prev.map(c => {
      if (c.id !== callId) return c;
      const nextField = TS_STEPS.find(f => !c[f]);
      if (!nextField) return c;
      return { ...c, [nextField]: new Date().toISOString() };
    }));
  }, []);

  const closeCall = useCallback(async (callId, disposition, close_notes) => {
    setCalls(prev => prev.map(c =>
      c.id === callId
        ? { ...c, status: 'closed', disposition, close_notes, closed_at: new Date().toISOString() }
        : c
    ));
    try { await apiCloseCall(callId, disposition, close_notes); } catch {}
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
    dispatchCall, assignUnit, advanceStatus, closeCall, updateTimestamp, logTimeNow, addComment
  };
}
