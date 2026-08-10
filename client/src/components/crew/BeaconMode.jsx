import { useState, useEffect, useRef } from 'react';
import { apiBase } from '../../lib/native';

// ── Math helpers ────────────────────────────────────────────────────
function toRad(d) { return d * Math.PI / 180; }

function getBearing(lat1, lon1, lat2, lon2) {
  const dLon = toRad(lon2 - lon1);
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const y = Math.sin(dLon) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

function getDistanceFt(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  const meters = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return Math.round(meters * 3.28084);
}

function getCardinal(bearing) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(bearing / 45) % 8];
}

// EMA with wrap-around — alpha=0.2 balances smoothness vs responsiveness
function smoothAngle(prev, next, alpha = 0.2) {
  if (prev === null) return next;
  let diff = next - prev;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return (prev + alpha * diff + 360) % 360;
}

function formatStale(ts) {
  if (!ts) return null;
  const secs = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (secs < 15) return null;
  if (secs < 60) return `${secs}s ago`;
  return `${Math.floor(secs / 60)}m ago`;
}

const CLOSE_FT = 75; // GPS accuracy in crowds is ~10-30m; within 75ft means you're basically there

// ── Arrow SVG ────────────────────────────────────────────────────────
function Arrow({ angle, active }) {
  return (
    <div
      style={{
        transform: `rotate(${angle ?? 0}deg)`,
        transition: active ? 'transform 300ms ease-out' : 'none',
      }}
    >
      <svg width="220" height="220" viewBox="0 0 220 220">
        <defs>
          <linearGradient id="arrowGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4ade80" />
            <stop offset="100%" stopColor="#15803d" />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        {/* Arrow head */}
        <polygon
          points="110,12 148,120 110,98 72,120"
          fill={active ? 'url(#arrowGrad)' : '#4b5563'}
          stroke={active ? '#16a34a' : '#374151'}
          strokeWidth="2"
          strokeLinejoin="round"
          filter={active ? 'url(#glow)' : undefined}
        />
        {/* Arrow tail */}
        <rect x="96" y="98" width="28" height="72" rx="6"
          fill={active ? '#16a34a' : '#374151'} />
        {/* Tail notch */}
        <polygon
          points="110,208 96,170 124,170"
          fill={active ? '#15803d' : '#1f2937'}
        />
      </svg>
    </div>
  );
}

// ── "You're close" pulse ──────────────────────────────────────────────
function ClosePulse({ unitNumber }) {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative flex items-center justify-center">
        <div className="absolute w-48 h-48 rounded-full bg-green-500/20 animate-ping" />
        <div className="absolute w-36 h-36 rounded-full bg-green-500/30 animate-ping"
          style={{ animationDelay: '150ms' }} />
        <div className="w-24 h-24 rounded-full bg-green-500/40 border-2 border-green-400 flex items-center justify-center">
          <span className="text-4xl">📡</span>
        </div>
      </div>
      <div className="text-green-400 font-black text-2xl tracking-wide">YOU'RE CLOSE</div>
      <div className="text-gray-400 text-sm text-center">
        {unitNumber} is within 75 feet<br />
        Look around — GPS can't get more precise
      </div>
    </div>
  );
}

// ── Compass view ─────────────────────────────────────────────────────
function Compass({ target, onBack, token }) {
  const [heading,        setHeading]        = useState(null);
  const [myPos,          setMyPos]          = useState(null);
  const [targetPos,      setTargetPos]      = useState({
    lat: parseFloat(target.last_lat), lng: parseFloat(target.last_lng)
  });
  const [targetGpsAt,    setTargetGpsAt]    = useState(target.last_gps_at || null);
  const [staleLabel,     setStaleLabel]     = useState(null);
  const [noCompass,      setNoCompass]      = useState(false);
  const [noGps,          setNoGps]          = useState(false);
  // iOS 13+ requires requestPermission() to be called from a user-gesture handler.
  // Start as 'needed' when the API exists so we show a tap-to-enable button first.
  const [compassPermission, setCompassPermission] = useState(
    typeof DeviceOrientationEvent?.requestPermission === 'function' ? 'needed' : 'granted'
  );
  const pollRef    = useRef(null);
  const watchRef   = useRef(null);
  const headingRef = useRef(null);
  const staleRef   = useRef(null);

  // Own GPS via browser Geolocation
  useEffect(() => {
    if (!navigator.geolocation) { setNoGps(true); return; }
    const onPos = (pos) => setMyPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    const onErr = () => setNoGps(true);
    watchRef.current = navigator.geolocation.watchPosition(onPos, onErr, {
      enableHighAccuracy: true, maximumAge: 2000, timeout: 10000
    });
    return () => { if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current); };
  }, []);

  const requestCompassPermission = async () => {
    try {
      const s = await DeviceOrientationEvent.requestPermission();
      setCompassPermission(s === 'granted' ? 'granted' : 'denied');
      if (s !== 'granted') setNoCompass(true);
    } catch {
      setCompassPermission('denied');
      setNoCompass(true);
    }
  };

  // Device compass — only attach listeners after permission is confirmed granted
  useEffect(() => {
    if (compassPermission !== 'granted') return;

    let gotAbsolute = false;
    let gotReading  = false;

    const apply = (raw) => {
      headingRef.current = smoothAngle(headingRef.current, raw);
      gotReading = true;
      setHeading(headingRef.current);
    };

    const absHandler = (e) => {
      let h = null;
      if (e.webkitCompassHeading != null) h = e.webkitCompassHeading;
      else if (e.alpha != null) h = (360 - e.alpha) % 360;
      if (h != null) { gotAbsolute = true; apply(h); }
    };

    const relHandler = (e) => {
      if (gotAbsolute) return;
      let h = null;
      if (e.webkitCompassHeading != null) h = e.webkitCompassHeading;
      else if (e.alpha != null) h = (360 - e.alpha) % 360;
      if (h != null) apply(h);
    };

    window.addEventListener('deviceorientationabsolute', absHandler, true);
    window.addEventListener('deviceorientation',         relHandler, true);
    const timeout = setTimeout(() => { if (!gotReading) setNoCompass(true); }, 3000);

    return () => {
      window.removeEventListener('deviceorientationabsolute', absHandler, true);
      window.removeEventListener('deviceorientation',         relHandler, true);
      clearTimeout(timeout);
    };
  }, [compassPermission]);

  // Poll target position every 2s
  useEffect(() => {
    const refresh = async () => {
      try {
        const res  = await fetch(`${apiBase()}/units`, { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        const found = data.find(u => u.id === target.id);
        if (found?.last_lat && found?.last_lng) {
          setTargetPos({ lat: parseFloat(found.last_lat), lng: parseFloat(found.last_lng) });
          setTargetGpsAt(found.last_gps_at || null);
        }
      } catch {}
    };
    refresh();
    pollRef.current = setInterval(refresh, 2000);
    return () => clearInterval(pollRef.current);
  }, [target.id, token]);

  // Stale label ticker — recalculate every 5s
  useEffect(() => {
    const tick = () => setStaleLabel(formatStale(targetGpsAt));
    tick();
    staleRef.current = setInterval(tick, 5000);
    return () => clearInterval(staleRef.current);
  }, [targetGpsAt]);

  const hasMyPos     = !!myPos;
  const hasTargetPos = !isNaN(targetPos.lat) && !isNaN(targetPos.lng);
  const hasPos       = hasMyPos && hasTargetPos;

  const bearing  = hasPos ? getBearing(myPos.lat, myPos.lng, targetPos.lat, targetPos.lng) : null;
  const distFt   = hasPos ? getDistanceFt(myPos.lat, myPos.lng, targetPos.lat, targetPos.lng) : null;
  const cardinal = bearing != null ? getCardinal(bearing) : null;

  const arrowAngle    = (bearing != null && heading != null) ? (bearing - heading + 360) % 360 : null;
  const compassActive = arrowAngle != null && !noCompass;
  const isClose       = distFt != null && distFt <= CLOSE_FT;

  return (
    <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col">
      {/* Header */}
      <div className="w-full flex items-center justify-between px-4 pt-6 pb-4 border-b border-gray-800 flex-shrink-0">
        <button onClick={onBack} className="text-gray-400 hover:text-white p-2 -ml-2 text-lg">← Back</button>
        <div className="text-center">
          <div className="text-white font-bold text-lg">{target.unit_number}</div>
          <div className="text-gray-500 text-xs">{target.crew || 'Beacon active'}</div>
        </div>
        <div className="w-16" />
      </div>

      {/* Body */}
      <div className="flex-1 flex flex-col items-center justify-center gap-5 px-6">

        {/* iOS compass permission prompt */}
        {compassPermission === 'needed' && (
          <div className="flex flex-col items-center gap-3">
            <div className="text-gray-300 text-sm text-center">
              Tap to enable the compass sensor
            </div>
            <button
              onClick={requestCompassPermission}
              className="px-6 py-3 bg-green-700 hover:bg-green-600 text-white font-bold rounded-2xl text-sm transition-colors"
            >
              Enable Compass
            </button>
          </div>
        )}

        {/* Status messages */}
        {compassPermission !== 'needed' && noCompass ? (
          <div className="text-amber-400 text-sm text-center bg-amber-900/30 border border-amber-700/50 rounded-xl px-4 py-2">
            No compass sensor on this device
          </div>
        ) : noGps ? (
          <div className="text-amber-400 text-sm text-center bg-amber-900/30 border border-amber-700/50 rounded-xl px-4 py-2">
            GPS unavailable on this device
          </div>
        ) : !hasMyPos ? (
          <div className="text-amber-400 text-sm text-center bg-amber-900/30 border border-amber-700/50 rounded-xl px-4 py-2">
            Waiting for your GPS fix…
          </div>
        ) : !hasTargetPos ? (
          <div className="text-amber-400 text-sm text-center bg-amber-900/30 border border-amber-700/50 rounded-xl px-4 py-2">
            Waiting for {target.unit_number}'s GPS…
          </div>
        ) : heading == null && !noCompass ? (
          <div className="text-gray-400 text-sm text-center">
            Hold phone flat and move it to calibrate…
          </div>
        ) : null}

        {/* Stale GPS warning */}
        {staleLabel && (
          <div className="flex items-center gap-2 bg-amber-900/30 border border-amber-700/40 rounded-lg px-3 py-1.5">
            <div className="w-2 h-2 rounded-full bg-amber-500" />
            <span className="text-amber-400 text-xs">{target.unit_number} GPS updated {staleLabel}</span>
          </div>
        )}

        {/* Cardinal direction */}
        {compassActive && !isClose && (
          <div className="text-white font-black text-5xl tracking-widest">{cardinal}</div>
        )}

        {/* Main indicator: close pulse or compass arrow */}
        {isClose ? (
          <ClosePulse unitNumber={target.unit_number} />
        ) : (
          <div className="relative flex items-center justify-center">
            <div
              className={`absolute rounded-full ${compassActive ? 'bg-green-500/10' : 'bg-gray-700/15'}`}
              style={{ width: 280, height: 280 }}
            />
            <Arrow angle={arrowAngle ?? 0} active={compassActive} />
          </div>
        )}

        {/* Distance */}
        {distFt != null && !isClose && (
          <div className="text-center">
            <div className="text-white font-black text-5xl tabular-nums">
              {distFt < 1000 ? distFt : `${(distFt / 5280).toFixed(2)} mi`}
            </div>
            <div className="text-gray-500 text-sm mt-1">
              {distFt < 1000 ? 'feet away' : 'miles away'}
            </div>
          </div>
        )}

        {/* Instructions */}
        {compassActive && !isClose && (
          <div className="text-gray-600 text-xs text-center">
            Point the top of your phone in the direction the arrow shows
          </div>
        )}

        {!noCompass && heading == null && (
          <div className="text-gray-600 text-xs text-center">
            Tip: draw a figure-8 in the air to calibrate
          </div>
        )}
      </div>
    </div>
  );
}

// ── Finder (unit picker) ──────────────────────────────────────────────
function Finder({ myUnit, units, onSelect, onClose }) {
  const [liveUnits, setLiveUnits] = useState(units);
  const token = JSON.parse(localStorage.getItem('cad_user') || '{}').token;

  useEffect(() => {
    fetch(`${apiBase()}/units`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setLiveUnits(data); })
      .catch(() => {});
  }, [token]);

  const beaconing = liveUnits.filter(u => u.beacon_active && u.id !== myUnit?.id);

  return (
    <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col">
      <div className="flex items-center justify-between px-4 pt-6 pb-4 border-b border-gray-800">
        <button onClick={onClose} className="text-gray-400 hover:text-white p-2 -ml-2">← Back</button>
        <div className="text-white font-bold">Find a Medic</div>
        <div className="w-12" />
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {beaconing.length === 0 ? (
          <div className="text-center py-16 text-gray-500 text-sm">
            <div className="text-4xl mb-3">📡</div>
            No units are beaconing right now.<br />
            Ask the other medic to turn on their beacon first.
          </div>
        ) : (
          beaconing.map(u => (
            <button key={u.id} onClick={() => onSelect(u)}
              className="w-full flex items-center gap-4 bg-gray-800 border border-green-800/60 hover:border-green-600 rounded-2xl px-4 py-4 text-left transition-all group">
              <div className="w-10 h-10 rounded-full bg-green-900/60 border border-green-700 flex items-center justify-center">
                <span className="text-green-400 text-lg">📡</span>
              </div>
              <div className="flex-1">
                <div className="text-white font-bold">{u.unit_number}</div>
                {u.crew && <div className="text-gray-400 text-xs mt-0.5">{u.crew}</div>}
                {(u.last_lat && u.last_lng) ? (
                  <div className="text-green-500 text-xs mt-0.5">GPS active</div>
                ) : (
                  <div className="text-amber-500 text-xs mt-0.5">Waiting for GPS…</div>
                )}
              </div>
              <span className="text-gray-600 group-hover:text-green-400 text-xl transition-colors">›</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────
export default function BeaconMode({ myUnit, units, token, beaconActive, onToggleBeacon, onClose }) {
  const [view,   setView]   = useState('finder');
  const [target, setTarget] = useState(null);

  if (view === 'compass' && target) {
    return (
      <Compass
        target={target}
        token={token}
        onBack={() => setView('finder')}
      />
    );
  }

  return (
    <Finder
      myUnit={myUnit}
      units={units}
      onSelect={u => { setTarget(u); setView('compass'); }}
      onClose={onClose}
    />
  );
}
