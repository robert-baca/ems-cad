import { useEffect, useRef, useState } from 'react';

// A button that only fires after being held down for `holdMs`, with a fill
// bar showing progress -- so a pocket bump or a stray tap can't trigger it.
// Letting go early cancels.
export default function HoldButton({ holdMs = 2000, onHold, disabled = false, className = '', fillClassName = 'bg-white/30', children }) {
  const [progress, setProgress] = useState(0);
  const startRef = useRef(null);
  const rafRef = useRef(null);
  const firedRef = useRef(false);

  const stop = () => {
    cancelAnimationFrame(rafRef.current);
    startRef.current = null;
    setProgress(0);
  };

  const tick = () => {
    if (startRef.current == null) return;
    const p = Math.min(1, (performance.now() - startRef.current) / holdMs);
    setProgress(p);
    if (p >= 1) {
      if (!firedRef.current) {
        firedRef.current = true;
        try { navigator.vibrate?.(200); } catch {}
        onHold?.();
      }
      stop();
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  };

  const start = (e) => {
    if (disabled) return;
    e.preventDefault();
    firedRef.current = false;
    startRef.current = performance.now();
    rafRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={e => e.preventDefault()}
      className={`relative overflow-hidden select-none touch-none ${className}`}
      style={{ WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
    >
      <span className={`absolute inset-y-0 left-0 ${fillClassName}`} style={{ width: `${progress * 100}%` }} />
      <span className="relative">{children}</span>
    </button>
  );
}
