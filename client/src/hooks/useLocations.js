import { useState, useEffect } from 'react';

const PERM_KEY  = 'cad_locations_permanent';

function loadPermanent() {
  try { return JSON.parse(localStorage.getItem(PERM_KEY) || '[]'); }
  catch { return []; }
}

export function useLocations() {
  const [permanent, setPermanent] = useState(loadPermanent);
  const [shift,     setShift]     = useState([]);

  useEffect(() => {
    localStorage.setItem(PERM_KEY, JSON.stringify(permanent));
  }, [permanent]);

  const locations = [
    ...permanent.map(l => ({ ...l, locationType: 'permanent' })),
    ...shift.map(l =>     ({ ...l, locationType: 'shift'     }))
  ];

  const addLocation = (name, lat, lng, color = '#f59e0b', locationType = 'shift') => {
    const loc = { id: `loc-${Date.now()}`, name: name.trim(), lat, lng, color };
    if (locationType === 'permanent') {
      setPermanent(prev => [...prev, loc]);
    } else {
      setShift(prev => [...prev, loc]);
    }
  };

  const removeLocation = (id) => {
    setPermanent(prev => prev.filter(l => l.id !== id));
    setShift(prev =>     prev.filter(l => l.id !== id));
  };

  const clearShiftLocations = () => setShift([]);

  return { locations, addLocation, removeLocation, clearShiftLocations };
}
