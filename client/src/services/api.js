import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 10000
});

// Attach JWT to every request
api.interceptors.request.use((config) => {
  const stored = sessionStorage.getItem('cad_user');
  if (stored) {
    const { token } = JSON.parse(stored);
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Units ──────────────────────────────────────────────────────────
export const getUnits = () => api.get('/units');
export const createUnit = (data) => api.post('/units', data);
export const updateUnitStatus = (unitId, status) =>
  api.patch(`/units/${unitId}/status`, { status });
export const editUnit = (unitId, data) => api.put(`/units/${unitId}`, data);
export const deleteUnit = (unitId) => api.delete(`/units/${unitId}`);

// ── Calls ──────────────────────────────────────────────────────────
export const getCalls = () => api.get('/calls');
export const getCall = (id) => api.get(`/calls/${id}`);
export const createCall = (data) => api.post('/calls', data);
export const assignCall = (callId, unitId) =>
  api.patch(`/calls/${callId}/assign`, { unit_id: unitId });
export const updateCallStatus = (callId, status) =>
  api.patch(`/calls/${callId}/status`, { status });
export const closeCall = (callId, disposition, close_notes) =>
  api.patch(`/calls/${callId}/status`, { status: 'closed', disposition, close_notes });
export const updateCallTimestamps = (callId, fields) =>
  api.patch(`/calls/${callId}/timestamps`, fields);
export const updateCallNarrative = (callId, narrative) =>
  api.patch(`/calls/${callId}/narrative`, { narrative });
export const addUnitToCall = (callId, unitId) =>
  api.post(`/calls/${callId}/add-unit`, { unit_id: unitId });
export const removeUnitFromCall = (callId, unitId) =>
  api.delete(`/calls/${callId}/units/${unitId}`);
export const updateCallPriority = (callId, priority) =>
  api.patch(`/calls/${callId}/priority`, { priority });
export const addMutualAid = (callId, name, unit_id, role) =>
  api.post(`/calls/${callId}/mutual-aid`, { name, unit_id, role });
export const removeMutualAid = (callId, entryId) =>
  api.delete(`/calls/${callId}/mutual-aid/${entryId}`);

// ── Auth ───────────────────────────────────────────────────────────
export const loginDispatcher = (username, password) =>
  api.post('/auth/login', { username, password, role: 'dispatcher' });
export const loginCrew = (unit_number, password) =>
  api.post('/auth/login', { username: unit_number, password, role: 'crew' });

export default api;
