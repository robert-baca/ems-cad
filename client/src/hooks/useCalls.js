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
  const [calls, setCalls] = useState(MOCK_ALL_CALLS);

  const handleCallCreated      = useCallback((call) => setCalls(prev => [call, ...prev]), []);
  const handleCallUpdated      = useCallback(({ call_id, changes }) =>
    setCalls(prev => prev.map(c => c.id === call_id ? { ...c, ...changes } : c)), []);
  const handleCallStatusChange = useCallback(({ call_id, status }) =>
    setCalls(prev => prev.map(c => c.id === call_id ? { ...c, status } : c)), []);
  const handleCallAssigned     = useCallback(({ call_id, unit_id }) =>
    setCalls(prev => prev.map(c => c.id === call_id ? { ...c, assigned_unit_id: unit_id } : c)), []);

  const dispatchCall = useCallback(async (data) => {
    const hasUnit = !!data.assigned_unit_id;
    const optimistic = {
      id: `call-${Date.now()}`,
      call_number: 44 + Math.floor(Math.random() * 50),
      status: hasUnit ? 'dispatched' : 'pending',
      received_at: new Date().toISOString(),
      dispatched_at: hasUnit ? new Date().toISOString() : null,
      acknowledged_at: null, en_route_at: null, on_scene_at: null,
      patient_contact_at: null, cleared_at: null, available_at: null,
      comments: [],
      ...data
    };
    setCalls(prev => [optimistic, ...prev]);
    try { await createCall(data); } catch {}
    return optimistic;
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
    await apiCloseCall(callId, disposition, close_notes);
  }, []);

  const addComment = useCallback((callId, text, author = 'Dispatcher') => {
    const comment = { id: `cmt-${Date.now()}`, text, author, created_at: new Date().toISOString() };
    setCalls(prev => prev.map(c =>
      c.id === callId ? { ...c, comments: [...(c.comments || []), comment] } : c
    ));
  }, []);

  return {
    calls,
    handleCallCreated, handleCallUpdated, handleCallStatusChange, handleCallAssigned,
    dispatchCall, assignUnit, advanceStatus, closeCall, updateTimestamp, logTimeNow, addComment
  };
}
