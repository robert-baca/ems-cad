// Lightweight retry queue for the three crew-mobile mutating actions that can
// fail outright when the phone has no signal in a dead zone of the park:
// unit status taps, call status advances, closing a call, and chat comments
// (including the SOS backup request/cancel, which is just a comment).
//
// This is deliberately NOT a full offline-first sync engine — no conflict
// resolution, no merge logic. It is a dumb FIFO: if the request never
// reached the server (a real network failure — see the `!error.response`
// check at each call site in CrewMobile.jsx, useUnits.js and useCalls.js),
// persist it here and keep trying until it lands, in the order it was
// queued. A genuine 4xx/5xx from the server (validation error, 403, 409,
// etc.) is never queued — retrying an inherently-invalid request forever
// would be wrong, so those still surface as an inline error the crew member
// has to act on.
//
// If a "close call" action for a given call is queued and a later status
// update for that *same* call gets queued behind it (e.g. crew taps a status
// button again before noticing the call already closed), that status update
// is moot — the server will reject it once the close-call ahead of it lands.
// That rejection surfaces as a real HTTP response (`err.response` set), which
// retryOfflineQueue below treats as "permanently invalid" and drops — as
// opposed to a network failure (`err.response` unset), which stops the pass
// so the still-possibly-valid action at the head can be retried later without
// losing its place.
//
// Each queued action also snapshots the JWT active at enqueue time and
// replays under that exact token (see `token` field below and api.js's
// request interceptor, which only falls back to localStorage's current token
// when the caller hasn't already set an Authorization header) — so a shift
// handoff on the same device while actions are still queued can't replay
// under the wrong crew member's identity.

import { updateUnitStatus, updateCallStatus, closeCall as apiCloseCall, addCallComment } from '../services/api';

function getCurrentToken() {
  try { return JSON.parse(localStorage.getItem('cad_user') || 'null')?.token || null; } catch { return null; }
}

const STORAGE_KEY = 'cad_offline_action_queue';
const RETRY_INTERVAL_MS = 15000; // matches the app's existing polling-lite feel (see nowTick in CrewMobile.jsx)

function loadQueue() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveQueue(q) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(q)); } catch { /* storage full/unavailable — queue stays in-memory for this session */ }
}

let queue = loadQueue();
const listeners = new Set();

function notify() {
  listeners.forEach(fn => { try { fn(queue); } catch { /* ignore listener errors */ } });
}

// Runs each queued action's actual API call. Deliberately bypasses the
// useUnits/useCalls hooks' optimistic-update machinery — by the time a
// retry fires, the component that made the original optimistic change may
// no longer be mounted (app backgrounded/killed and reopened), and the
// eventual success is picked up the same way any other client's change
// would be: the socket broadcast the server sends once the write lands.
const RUNNERS = {
  unit_status: ({ unitId, status }, config) => updateUnitStatus(unitId, status, config),
  call_status: ({ callId, status }, config) => updateCallStatus(callId, status, config),
  close_call:  ({ callId, disposition, close_notes }, config) => apiCloseCall(callId, disposition, close_notes, config),
  comment:     ({ callId, text, author }, config) => addCallComment(callId, text, author, config),
};

/** Current queue snapshot (array of { id, type, payload, createdAt }). */
export function getOfflineQueue() {
  return queue;
}

/** Subscribe to queue changes. Returns an unsubscribe function. Calls back immediately with the current queue. */
export function subscribeOfflineQueue(fn) {
  listeners.add(fn);
  fn(queue);
  return () => listeners.delete(fn);
}

/**
 * Queue an action for retry after a genuine network failure. `id` is derived
 * from type+payload (not random) so an identical action already queued
 * (e.g. a double-tap while offline) is deduped rather than piling up.
 */
export function enqueueOfflineAction(type, payload) {
  if (!RUNNERS[type]) return; // unknown type — programmer error, not a queueable failure
  const id = `${type}:${JSON.stringify(payload)}`;
  if (queue.some(a => a.id === id)) return;
  queue = [...queue, { id, type, payload, createdAt: Date.now(), token: getCurrentToken() }];
  saveQueue(queue);
  notify();
  scheduleRetryLoop();
}

let retrying = false;

/**
 * Retry queued actions in FIFO order. Each success is removed immediately.
 * A network failure (no server response) stops this pass and leaves that
 * action — and everything queued after it — in place for the next attempt,
 * since the server isn't reachable to evaluate any of them right now. A
 * genuine server rejection (a real HTTP response — e.g. a status update for
 * a call that a close-call ahead of it already closed) means this exact
 * action can never succeed, so it's dropped and the pass continues with the
 * next one, instead of wedging every later action behind it forever.
 */
export async function retryOfflineQueue() {
  if (retrying) return;
  retrying = true;
  try {
    while (queue.length) {
      const action = queue[0];
      const run = RUNNERS[action.type];
      if (!run) {
        // Corrupt/unrecognized entry (e.g. left over from an older app
        // version's queue format) — drop just this one so it can't wedge
        // the queue forever, then keep going.
        queue = queue.slice(1);
        saveQueue(queue);
        notify();
        continue;
      }
      try {
        const config = action.token ? { headers: { Authorization: `Bearer ${action.token}` } } : undefined;
        await run(action.payload, config);
      } catch (err) {
        if (err?.response) {
          queue = queue.slice(1);
          saveQueue(queue);
          notify();
          continue; // permanently invalid — drop and keep draining the rest
        }
        break; // network failure — stop-and-keep, see doc comment above
      }
      queue = queue.slice(1);
      saveQueue(queue);
      notify();
    }
  } finally {
    retrying = false;
    if (queue.length === 0) stopRetryLoop();
  }
}

let retryTimer = null;
function scheduleRetryLoop() {
  if (retryTimer || queue.length === 0) return;
  retryTimer = setInterval(retryOfflineQueue, RETRY_INTERVAL_MS);
}
function stopRetryLoop() {
  if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => retryOfflineQueue());
  // Actions queued in a previous session (app was killed/reloaded with a
  // non-empty queue still in localStorage) need the periodic loop restarted.
  if (queue.length > 0) scheduleRetryLoop();
}
