import { useState, useEffect } from 'react';
import { DEFAULT_LOCATIONS } from '../data/mockData';

const STORAGE_KEY = 'cad_map_locations';

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : DEFAULT_LOCATIONS;
  } catch {
    return DEFAULT_LOCATIONS;
  }
}

export function useLocations() {
  const [locations, setLocations] = useState(load);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(locations));
  }, [locations]);

  const addLocation = (name, lat, lng, color = '#f59e0b') => {
    const loc = { id: `loc-${Date.now()}`, name: name.trim(), lat, lng, color };
    setLocations(prev => [...prev, loc]);
    return loc;
  };

  const removeLocation = (id) => {
    setLocations(prev => prev.filter(l => l.id !== id));
  };

  const updateLocation = (id, changes) => {
    setLocations(prev => prev.map(l => l.id === id ? { ...l, ...changes } : l));
  };

  return { locations, addLocation, removeLocation, updateLocation };
}
