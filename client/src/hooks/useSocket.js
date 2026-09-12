import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { sockUrl } from '../lib/native';

// If nothing at all has come through in this long, assume the connection is
// a silent zombie (see the staleness watchdog below) rather than waiting
// indefinitely for socket.io's own ping/pong to notice.
const STALE_MS = 2 * 60 * 1000;
const STALE_CHECK_INTERVAL_MS = 30 * 1000;

// `options.getToken` / `options.onConnect` let callers that don't authenticate
// via the normal `cad_user` localStorage entry (e.g. the public display board,
// which uses its own sessionStorage token and room) reuse this hook's
// connection-health tracking and reconnect-on-visibility handling instead of
// hand-rolling their own socket setup.
export function useSocket(handlers = {}, options = {}) {
  const socketRef = useRef(null);
  const handlersRef = useRef(handlers);
  const registeredEventsRef = useRef(new Set());
  const lastActivityRef = useRef(Date.now());
  const [isConnected, setIsConnected] = useState(false);
  handlersRef.current = handlers;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const getUser = () => {
      const stored = localStorage.getItem('cad_user');
      try { return stored ? JSON.parse(stored) : null; } catch { return null; }
    };

    socketRef.current = io(sockUrl(), {
      auth: (cb) => {
        const token = optionsRef.current.getToken ? optionsRef.current.getToken() : getUser()?.token || null;
        cb({ token });
      },
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000
    });

    const socket = socketRef.current;

    socket.on('connect', () => {
      lastActivityRef.current = Date.now();
      setIsConnected(true);
      if (optionsRef.current.onConnect) {
        optionsRef.current.onConnect(socket);
        return;
      }
      const u = getUser();
      if (u?.role === 'dispatcher') {
        socket.emit('join:dispatcher');
      } else if (u?.role === 'crew' && u?.unit_id) {
        socket.emit('join:crew', { unit_id: u.unit_id });
      }
    });

    socket.on('disconnect', () => setIsConnected(false));

    // Any inbound event at all — whether or not a caller registered a
    // handler for it — counts as proof the connection is actually carrying
    // data, not just reporting itself as connected.
    socket.onAny(() => { lastActivityRef.current = Date.now(); });

    // A socket can go silently dead (laptop sleep, a backgrounded tab, a
    // proxy that drops idle connections) without ever firing 'disconnect' —
    // ping/pong detection doesn't always catch it promptly, so isConnected
    // stays true and nothing "catches up" because no new events are
    // arriving at all. Forcing a full reconnect whenever the tab regains
    // visibility guarantees a fresh join + init:state either way, instead
    // of trusting a connection state that may already be stale.
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current.connect();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // The visibility check above never fires for a screen that stays open
    // and focused for a whole shift — a dispatcher workstation, most
    // notably — so a silently-dead connection there could sit unnoticed
    // (still showing "LIVE") until someone happens to reload the page. This
    // is an independent, coarser safety net: if literally nothing has come
    // through in STALE_MS (well past any real quiet period — GPS heartbeats
    // alone arrive every few seconds per active unit), force a fresh
    // reconnect regardless of what the socket claims its own state is.
    const staleCheck = setInterval(() => {
      if (Date.now() - lastActivityRef.current > STALE_MS && socketRef.current) {
        lastActivityRef.current = Date.now();
        socketRef.current.disconnect();
        socketRef.current.connect();
      }
    }, STALE_CHECK_INTERVAL_MS);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      clearInterval(staleCheck);
      socket.disconnect();
    };
  }, []);

  // Registers a listener for every handler key seen so far, including ones
  // that only appear in a later render (e.g. a conditionally-built handlers
  // map) — the previous version only looped over handlersRef.current once,
  // at mount, so any event name absent from that first render's handlers
  // object would never get registered even if added afterward. Each
  // registration dispatches through handlersRef.current, which is always
  // current, so re-running this is safe and idempotent (registeredEventsRef
  // guards against calling socket.on twice for the same event). Depending on
  // a sorted-keys string rather than `handlers` itself means this only
  // re-runs when the *set* of event names changes, not on every render just
  // because a caller passes a fresh inline handlers object literal each time.
  const handlerKeys = Object.keys(handlers).sort().join(',');
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    Object.keys(handlersRef.current).forEach(event => {
      if (registeredEventsRef.current.has(event)) return;
      registeredEventsRef.current.add(event);
      socket.on(event, (...args) => handlersRef.current[event]?.(...args));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handlerKeys]);

  return { socketRef, isConnected };
}
