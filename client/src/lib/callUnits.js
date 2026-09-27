// A backup unit that finished early and released itself from a still-open
// call (crew "Back to Available"). It stays in additional_unit_ids so the
// call's record still shows it, but it's no longer working the call.
// Mirrors isReleased() in server/src/index.js.
export function isReleased(call, unitId) {
  return (call?.released_unit_ids || []).includes(unitId);
}

// True if the unit is actively working this call (primary, or a backup
// that hasn't released itself).
export function isOnCall(call, unitId) {
  if (!call || !unitId) return false;
  if (call.assigned_unit_id === unitId) return true;
  return (call.additional_unit_ids || []).includes(unitId) && !isReleased(call, unitId);
}
