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
// Known edge case, deliberately not solved here: if a "close call" action
// for a given call is queued and a later status update for that *same*
// call gets queued behind it (e.g. crew taps a status button again before
// noticing the call already closed), that status update is moot — the
// server will likely reject it once the close-call ahead of it lands. Since
// this queue stops-and-keeps on the first failure rather than dropping or
// reordering, a permanently-invalid queued action like that would sit at
// the head of the queue and block everything queued after it (for any
// call/unit) from ever being retried. Not handled — flagging it here for
// whoever revisits this.
//
// Also not handled: a queued action replays with whatever JWT is in
// localStorage at retry time, not the one active when it was queued. If the
// crew member logs out and a different person logs into the same device
// before the queue drains, a stale queued action would replay under the new
// session's identity. Unlikely in practice (shift handoffs don't usually
// happen mid-dead-zone), not worth the complexity of snapshotting tokens.

import { updateUnitStatus, updateCallStatus, closeCall as apiCloseCall, addCallComment } from '../services/api';

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
  unit_status: ({ unitId, status }) => updateUnitStatus(unitId, status),
  call_status: ({ callId, status }) => updateCallStatus(callId, status),
  close_call:  ({ callId, disposition, close_notes }) => apiCloseCall(callId, disposition, close_notes),
  comment:     ({ callId, text, author }) => addCallComment(callId, text, author),
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
  queue = [...queue, { id, type, payload, createdAt: Date.now() }];
  saveQueue(queue);
  notify();
  scheduleRetryLoop();
}

let retrying = false;

/**
 * Retry queued actions in FIFO order. Each success is removed immediately;
 * the first failure (network or server) stops this pass and leaves it —
 * and everything queued after it — in place for the next attempt. Never
 * reorders, never drops a failed action.
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
        await run(action.payload);
      } catch {
        break; // stop-and-keep — see module comment above for why
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
