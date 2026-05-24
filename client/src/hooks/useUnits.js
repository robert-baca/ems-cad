import { useState, useCallback, useEffect } from 'react';
import { updateUnitStatus, createUnit as apiCreateUnit, editUnit as apiEditUnit, deleteUnit as apiDeleteUnit } from '../services/api';

export function useUnits() {
  const [units, setUnits] = useState([]);

  useEffect(() => {
    fetch('/api/units')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setUnits(data); })
      .catch(() => {});
  }, []);

  const handleGpsUpdate = useCallback(({ unit_id, lat, lng, timestamp }) => {
    setUnits(prev =>
      prev.map(u => u.id === unit_id
        ? { ...u, last_lat: lat, last_lng: lng, last_gps_at: timestamp || new Date().toISOString() }
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
    setUnits(prev => prev.map(u => u.id === unitId ? { ...u, status } : u));
    try { await updateUnitStatus(unitId, status); } catch {}
  }, []);

  const addUnit = useCallback(async (data) => {
    try {
      await apiCreateUnit(data);
      // socket 'unit:updated' event will add it via handleUnitUpdated
    } catch {}
  }, []);

  const editUnit = useCallback(async (unitId, data) => {
    setUnits(prev => prev.map(u => u.id === unitId ? { ...u, ...data } : u));
    try { await apiEditUnit(unitId, data); } catch {}
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

  return {
    units, setUnits,
    handleGpsUpdate, handleStatusChange, handleProfileUpdate,
    handleUnitUpdated, handleUnitRemoved,
    changeStatus, addUnit, editUnit, removeUnit, moveUnit
  };
}
