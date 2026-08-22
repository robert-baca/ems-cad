import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { sockUrl } from '../lib/native';

export function useSocket(handlers = {}) {
  const socketRef = useRef(null);
  const handlersRef = useRef(handlers);
  const [isConnected, setIsConnected] = useState(false);
  handlersRef.current = handlers;

  useEffect(() => {
    const getUser = () => {
      const stored = localStorage.getItem('cad_user');
      try { return stored ? JSON.parse(stored) : null; } catch { return null; }
    };

    socketRef.current = io(sockUrl(), {
      auth: (cb) => { const u = getUser(); cb({ token: u?.token || null }); },
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000
    });

    const socket = socketRef.current;

    socket.on('connect', () => {
      setIsConnected(true);
      const u = getUser();
      if (u?.role === 'dispatcher') {
        socket.emit('join:dispatcher');
      } else if (u?.role === 'crew' && u?.unit_id) {
        socket.emit('join:crew', { unit_id: u.unit_id });
      }
    });

    socket.on('disconnect', () => setIsConnected(false));

    Object.keys(handlersRef.current).forEach(event => {
      socket.on(event, (...args) => handlersRef.current[event]?.(...args));
    });

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

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      socket.disconnect();
    };
  }, []);

  return { socketRef, isConnected };
}
