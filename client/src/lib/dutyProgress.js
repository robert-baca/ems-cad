// Who still has which cleaning duties to do this shift, built from the
// server's duties state ({ duties, done }). Mirrors the server's
// dutyAppliesTo: an "every unit" duty skips carts and, here, units that
// aren't working this shift (out of service with no crew); a duty given to
// specific units always counts for them.

const byNumber = (a, b) => a.unit_number.localeCompare(b.unit_number, undefined, { numeric: true });

export const dutyUnitLabel = (u) => (u.crew ? `${u.unit_number} · ${u.crew}` : u.unit_number);

const isWorking = (u) => u.status !== 'out_of_service' || !!u.crew;

export function dutyUnitsFor(duty, units) {
  if (!duty.assigned) return [];
  return duty.unit_ids.length
    ? units.filter(u => duty.unit_ids.includes(u.id))
    : units.filter(u => u.unit_type !== 'Cart' && isWorking(u));
}

export function findDone(done, dutyId, unitId) {
  return (done || []).find(c => c.duty_id === dutyId && c.unit_id === unitId) || null;
}

// [{ unit, items: [{ duty, done }] , left }] sorted by unit number, plus totals.
export function dutyProgress(duties, done, units) {
  const rows = new Map();
  duties.forEach(d => {
    dutyUnitsFor(d, units).forEach(u => {
      if (!rows.has(u.id)) rows.set(u.id, { unit: u, items: [] });
      rows.get(u.id).items.push({ duty: d, done: findDone(done, d.id, u.id) });
    });
  });
  const list = [...rows.values()]
    .map(r => ({ ...r, left: r.items.filter(i => !i.done).length }))
    .sort((a, b) => byNumber(a.unit, b.unit));
  const total = list.reduce((n, r) => n + r.items.length, 0);
  const left = list.reduce((n, r) => n + r.left, 0);
  return { rows: list, total, left };
}

export function fmtDoneTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
