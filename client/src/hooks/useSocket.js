import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

export function useSocket(handlers = {}) {
  const socketRef = useRef(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const stored = sessionStorage.getItem('cad_user');
    const u = stored ? JSON.parse(stored) : null;
    const token = u?.token || null;

    socketRef.current = io('', {
      auth: { token },
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000
    });

    const socket = socketRef.current;

    socket.on('connect', () => {
      if (u?.role === 'dispatcher') {
        socket.emit('join:dispatcher');
      } else if (u?.role === 'crew' && u?.unit_id) {
        socket.emit('join:crew', { unit_id: u.unit_id });
      }
    });

    Object.keys(handlersRef.current).forEach(event => {
      socket.on(event, (...args) => handlersRef.current[event]?.(...args));
    });

    return () => { socket.disconnect(); };
  }, []);

  return socketRef;
}
