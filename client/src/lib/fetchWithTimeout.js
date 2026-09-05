// Wraps fetch() with an AbortController-based timeout so a bare fetch can
// never hang indefinitely — e.g. a crew phone in a dead-signal area of the
// park. Mirrors the 10s timeout already built into the shared axios `api`
// instance (services/api.js) for the handful of call sites that can't go
// through that instance (pre-auth login screens, and native fallback posts
// that must avoid importing services/api.js — see api.js's 401 interceptor
// for why that import direction is reserved).
export async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Request timed out — check your connection and try again.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
