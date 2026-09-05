import { useState, useCallback, useEffect } from 'react';
import { getUnits, updateUnitStatus, createUnit as apiCreateUnit, editUnit as apiEditUnit, deleteUnit as apiDeleteUnit, clearUnitGps as apiClearGps } from '../services/api';

export function useUnits() {
  const [units, setUnits] = useState([]);

  useEffect(() => {
    getUnits()
      .then(res => { if (Array.isArray(res.data)) setUnits(res.data); })
      .catch(() => {});
  }, []);

  const handleGpsUpdate = useCallback(({ unit_id, lat, lng, timestamp }) => {
    setUnits(prev =>
      prev.map(u => u.id === unit_id
        // Nullish checks, not truthiness — `lat && ...` would treat a valid
        // lat of exactly 0 as absent and null out last_gps_at.
        ? { ...u, last_lat: lat ?? null, last_lng: lng ?? null, last_gps_at: (lat != null && timestamp != null) ? timestamp : (lat != null ? new Date().toISOString() : null) }
        : u)
    );
  }, []);

  const handleStatusChange = useCallback(({ unit_id, status }) => {
    setUnits(prev =>
      prev.map(u => u.id === unit_id ? { ...u, status } : u)
    );
  }, []);

  const handleProfileUpdate = useCallback(({ unit_id, profile }) => {
    setUnits(prev =>
      prev.map(u => u.id === unit_id ? { ...u, profile } : u)
    );
  }, []);

  const handleUnitUpdated = useCallback((updated) => {
    setUnits(prev =>
      prev.some(u => u.id === updated.id)
        ? prev.map(u => u.id === updated.id ? { ...u, ...updated } : u)
        : [...prev, updated]
    );
  }, []);

  const handleUnitRemoved = useCallback(({ unit_id }) => {
    setUnits(prev => prev.filter(u => u.id !== unit_id));
  }, []);

  const changeStatus = useCallback(async (unitId, status) => {
    let snapshot = null;
    setUnits(prev => {
      snapshot = prev.find(u => u.id === unitId) || null;
      return prev.map(u => u.id === unitId ? { ...u, status } : u);
    });
    try {
      await updateUnitStatus(unitId, status);
      return null;
    } catch (err) {
      // This is the crew's own status button (CrewMobile.jsx) as well as the
      // dispatcher's per-unit override — silently swallowing a failed write
      // here left a crew member's phone showing a status the server, and
      // every dispatcher's board, never actually received, with nothing to
      // ever correct it. Roll back and report the failure like every other
      // mutating action in this app already does.
      // Only the status field is rolled back — restoring the whole snapshot
      // would also clobber e.g. a GPS ping or profile edit that arrived via
      // socket while this request was in flight.
      if (snapshot) setUnits(prev => prev.map(u => u.id === unitId ? { ...u, status: snapshot.status } : u));
      return err?.response?.data?.error || 'Failed to update status';
    }
  }, []);

  const addUnit = useCallback(async (data) => {
    // Let the caller (AddUnitModal) catch failures — e.g. a duplicate unit_number
    // rejected by the server — so it can show an error instead of closing silently.
    await apiCreateUnit(data);
    // socket 'unit:updated' event will add it via handleUnitUpdated
  }, []);

  const editUnit = useCallback(async (unitId, data) => {
    let snapshot = null;
    setUnits(prev => {
      snapshot = prev.find(u => u.id === unitId) || null;
      return prev.map(u => u.id === unitId ? { ...u, ...data } : u);
    });
    try {
      await apiEditUnit(unitId, data);
    } catch (err) {
      // Field-scoped rollback — only revert the keys this edit actually
      // touched, not the whole record (see changeStatus's catch above).
      if (snapshot) {
        const fields = Object.keys(data);
        setUnits(prev => prev.map(u => u.id === unitId
          ? { ...u, ...Object.fromEntries(fields.map(f => [f, snapshot[f]])) }
          : u));
      }
      throw err;
    }
  }, []);

  const removeUnit = useCallback(async (unitId) => {
    setUnits(prev => prev.filter(u => u.id !== unitId));
    try { await apiDeleteUnit(unitId); } catch {}
  }, []);

  const moveUnit = useCallback((unitId, lat, lng) => {
    setUnits(prev =>
      prev.map(u => u.id === unitId ? { ...u, last_lat: lat, last_lng: lng } : u)
    );
  }, []);

  const clearGps = useCallback(async (unitId) => {
    setUnits(prev =>
      prev.map(u => u.id === unitId ? { ...u, last_lat: null, last_lng: null, last_gps_at: null } : u)
    );
    try { await apiClearGps(unitId); } catch {}
  }, []);

  return {
    units, setUnits,
    handleGpsUpdate, handleStatusChange, handleProfileUpdate,
    handleUnitUpdated, handleUnitRemoved,
    changeStatus, addUnit, editUnit, removeUnit, moveUnit, clearGps
  };
}
