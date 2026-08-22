import axios from 'axios';
import { apiBase } from '../lib/native';

const api = axios.create({
  baseURL: apiBase(),
  timeout: 10000
});

// Attach JWT to every request
api.interceptors.request.use((config) => {
  const stored = localStorage.getItem('cad_user');
  if (stored) {
    try {
      const { token } = JSON.parse(stored);
      if (token) config.headers.Authorization = `Bearer ${token}`;
    } catch { localStorage.removeItem('cad_user'); }
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
export const clearUnitGps = (unitId) => api.delete(`/units/${unitId}/gps`);
export const toggleUnitBeacon  = (unitId, active) => api.patch(`/units/${unitId}/beacon`,   { active });
export const setCrewGpsSharing = (enabled) => api.patch('/crew/gps-sharing', { enabled });

// ── Calls ──────────────────────────────────────────────────────────
export const getCalls = () => api.get('/calls');
export const getCall = (id) => api.get(`/calls/${id}`);
export const getCallHistory = () => api.get('/calls/history');
export const getMyCallHistory = () => api.get('/crew/calls/history');
export const getShifts = () => api.get('/shifts');
export const createCall = (data) => api.post('/calls', data);
export const assignCall = (callId, unitId, initialStatus) =>
  api.patch(`/calls/${callId}/assign`, { unit_id: unitId, initial_status: initialStatus });
export const updateCallStatus = (callId, status) =>
  api.patch(`/calls/${callId}/status`, { status });
export const closeCall = (callId, disposition, close_notes) =>
  api.patch(`/calls/${callId}/status`, { status: 'closed', disposition, close_notes });
export const updateCallTimestamps = (callId, fields) =>
  api.patch(`/calls/${callId}/timestamps`, fields);
export const updateCallNarrative = (callId, narrative) =>
  api.patch(`/calls/${callId}/narrative`, { narrative });
export const updateCallLocation = (callId, data) =>
  api.patch(`/calls/${callId}/location`, data);
export const addUnitToCall = (callId, unitId, initialStatus = 'dispatched') =>
  api.post(`/calls/${callId}/add-unit`, { unit_id: unitId, initial_status: initialStatus });
export const removeUnitFromCall = (callId, unitId) =>
  api.delete(`/calls/${callId}/units/${unitId}`);
export const updateCallPriority = (callId, priority) =>
  api.patch(`/calls/${callId}/priority`, { priority });
export const updateCallDetails = (callId, data) =>
  api.patch(`/calls/${callId}/details`, data);
export const addMutualAid = (callId, name, unit_id, role) =>
  api.post(`/calls/${callId}/mutual-aid`, { name, unit_id, role });
export const removeMutualAid = (callId, entryId) =>
  api.delete(`/calls/${callId}/mutual-aid/${entryId}`);
export const addCallComment = (callId, text, author) =>
  api.post(`/calls/${callId}/comments`, { text, author });
export const getCallGpsTrack = (callId) => api.get(`/calls/${callId}/gps-track`);

// ── Wayfinding path curation (admin-only) ────────────────────────────
export const getWayfindingTraces  = () => api.get('/wayfinding/traces');
export const getParkPaths         = () => api.get('/park-paths');
export const createParkPath       = (name, coordinates) => api.post('/park-paths', { name, coordinates });
export const deleteParkPath       = (id) => api.delete(`/park-paths/${id}`);
export const getWayfindingSettings = () => api.get('/wayfinding/settings');
export const setWayfindingEnabled  = (enabled) => api.put('/wayfinding/settings', { enabled });

// ── Auth ───────────────────────────────────────────────────────────
export const loginDispatcher = (username, password) =>
  api.post('/auth/login', { username, password, role: 'dispatcher' });
export const loginCrew = (unit_number, password) =>
  api.post('/auth/login', { username: unit_number, password, role: 'crew' });
export const refreshToken = () => api.post('/auth/refresh');

// Redirect to login when token expires or is invalid
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('cad_user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
