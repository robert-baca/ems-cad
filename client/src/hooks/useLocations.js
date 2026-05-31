import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';

export function useLocations() {
  const { user } = useAuth();
  const [permanent, setPermanent] = useState([]);
  const [shift,     setShift]     = useState([]);

  // Load permanent locations from DB on mount
  useEffect(() => {
    if (!user?.token) return;
    fetch('/api/locations', { headers: { Authorization: `Bearer ${user.token}` } })
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setPermanent(data); })
      .catch(() => {});
  }, [user?.token]);

  const locations = [
    ...permanent.map(l => ({ ...l, locationType: 'permanent' })),
    ...shift.map(l =>     ({ ...l, locationType: 'shift'     }))
  ];

  const addLocation = useCallback(async (name, lat, lng, color = '#f59e0b', locationType = 'shift') => {
    if (locationType === 'permanent') {
      try {
        const res = await fetch('/api/locations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user?.token}` },
          body: JSON.stringify({ name, lat, lng, color, location_type: 'permanent' })
        });
        const loc = await res.json();
        if (res.ok) setPermanent(prev => [...prev, loc]);
      } catch {}
    } else {
      const loc = { id: `loc-${Date.now()}`, name: name.trim(), lat, lng, color, location_type: 'shift' };
      setShift(prev => [...prev, loc]);
    }
  }, [user?.token]);

  const removeLocation = useCallback(async (id) => {
    const isPermanent = permanent.some(l => l.id === id);
    setPermanent(prev => prev.filter(l => l.id !== id));
    setShift(prev =>     prev.filter(l => l.id !== id));
    if (isPermanent) {
      fetch(`/api/locations/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${user?.token}` }
      }).catch(() => {});
    }
  }, [permanent, user?.token]);

  const clearShiftLocations = useCallback(() => setShift([]), []);

  // Called from init:state to seed permanent locations from server
  const setPermLocations = useCallback((locs) => {
    if (Array.isArray(locs)) setPermanent(locs);
  }, []);

  return { locations, addLocation, removeLocation, clearShiftLocations, setPermLocations };
}
