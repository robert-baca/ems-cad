import axios from 'axios';
import { apiBase } from '../lib/native';
import { stopCrewGpsTracking } from '../hooks/useCrewGps';

const api = axios.create({
  baseURL: apiBase(),
  timeout: 10000
});

// Attach JWT to every request — unless the caller already set one explicitly
// (the offline action queue does this to replay a retried action under the
// token that was active when it was queued, not whatever's in localStorage
// by the time the retry fires).
api.interceptors.request.use((config) => {
  if (config.headers.Authorization) return config;
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
export const updateUnitStatus = (unitId, status, config) =>
  api.patch(`/units/${unitId}/status`, { status }, config);
export const editUnit = (unitId, data) => api.put(`/units/${unitId}`, data);
export const updateUnitProfile = (unitId, profile) => api.put(`/units/${unitId}/profile`, profile);
export const deleteUnit = (unitId) => api.delete(`/units/${unitId}`);
export const clearUnitGps = (unitId) => api.delete(`/units/${unitId}/gps`);
export const setCrewGpsSharing = (enabled) => api.patch('/crew/gps-sharing', { enabled });

// ── Crew direct messages ──────────────────────────────────────────
export const getCrewMessages  = (unitId) => api.get(`/crew/messages/${unitId}`);
export const sendCrewMessage  = (toUnitId, text) => api.post('/crew/messages', { to_unit_id: toUnitId, text });

// ── Calls ──────────────────────────────────────────────────────────
export const getCalls = () => api.get('/calls');
export const getCall = (id) => api.get(`/calls/${id}`);
export const getCallHistory = () => api.get('/calls/history');
export const getMyCallHistory = () => api.get('/crew/calls/history');
export const getShifts = () => api.get('/shifts');
export const createCall = (data) => api.post('/calls', data);
export const assignCall = (callId, unitId, initialStatus, additionalUnitIds) =>
  api.patch(`/calls/${callId}/assign`, { unit_id: unitId, initial_status: initialStatus, additional_unit_ids: additionalUnitIds });
export const updateCallStatus = (callId, status, config) =>
  api.patch(`/calls/${callId}/status`, { status }, config);
export const closeCall = (callId, disposition, close_notes, config) =>
  api.patch(`/calls/${callId}/status`, { status: 'closed', disposition, close_notes }, config);
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
export const addCallComment = (callId, text, author, config) =>
  api.post(`/calls/${callId}/comments`, { text, author }, config);
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
export const refreshToken = () => api.post('/auth/refresh');
// Revokes this exact token server-side immediately, rather than leaving it
// valid for the rest of its 30-day lifetime after we merely forget it locally.
export const logoutRequest = () => api.post('/auth/logout');
export const changePassword = (currentPassword, newPassword) =>
  api.post('/auth/change-password', { currentPassword, newPassword });

// Redirect to login when token expires or is invalid
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // An involuntary token invalidation (admin-forced logout, secret
      // rotation, clock skew) must stop the native GPS tracker the same way
      // every other logout path does (see CrewMobile.jsx) — otherwise the
      // Android/iOS foreground service keeps running and posting to
      // /api/crew/gps with a dead token indefinitely, since it's independent
      // of this JS layer once started.
      stopCrewGpsTracking();
      localStorage.removeItem('cad_user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
