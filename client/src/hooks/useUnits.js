import { useState, useCallback } from 'react';
import { MOCK_UNITS } from '../data/mockData';
import { updateUnitStatus, createUnit as apiCreateUnit, editUnit as apiEditUnit, deleteUnit as apiDeleteUnit } from '../services/api';

export function useUnits() {
  const [units, setUnits] = useState(MOCK_UNITS);

  const handleGpsUpdate = useCallback(({ unit_id, lat, lng }) => {
    setUnits(prev =>
      prev.map(u => u.id === unit_id ? { ...u, last_lat: lat, last_lng: lng } : u)
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
      prev.map(u => u.id === updated.id ? { ...u, ...updated } : u)
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
      const res = await apiCreateUnit(data);
      setUnits(prev => [...prev, res.data]);
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
