import { getQuickCallTypes, saveQuickCallTypes } from '../services/api';

// Quick call types are shared by every dispatcher workstation (server
// setting). They used to be per-browser in localStorage under this key --
// the first load after the move copies that old list up if the server has
// never had one, so nobody loses theirs.
const LEGACY_KEY = 'ems_cad_quick_types';

function legacyList() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LEGACY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

export async function loadQuickTypes() {
  const res = await getQuickCallTypes();
  if (Array.isArray(res.data?.types)) return res.data.types;
  const legacy = legacyList();
  if (!legacy.length) return [];
  try {
    const saved = await saveQuickCallTypes(legacy);
    localStorage.removeItem(LEGACY_KEY);
    return saved.data.types;
  } catch {
    // Overwatch can't save; just show the local list.
    return legacy;
  }
}

export async function storeQuickTypes(types) {
  const res = await saveQuickCallTypes(types);
  return res.data.types;
}
