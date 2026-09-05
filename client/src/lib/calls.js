// A call is "pending" (no unit assigned yet) exactly while its status is
// 'pending' — a call only reaches assigned_unit_id === null before its first
// assignment, at which point status flips off 'pending' too. This used to be
// checked two different ways (status vs. assigned_unit_id) in CallCard.jsx
// and CallDetail.jsx, kept in sync only by a comment in each asking
// maintainers to update the other — pulled into one place to remove that risk.
export function isCallPending(call) {
  return call.status === 'pending';
}
