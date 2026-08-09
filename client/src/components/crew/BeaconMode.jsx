import { useState, useEffect, useRef, useCallback } from 'react';
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

// ── Arrow SVG ────────────────────────────────────────────────────────
function Arrow({ angle, active }) {
  return (
    <div
      className="transition-transform"
      style={{
        transform: `rotate(${angle ?? 0}deg)`,
        transitionDuration: active ? '200ms' : '0ms',
        transitionTimingFunction: 'ease-out',
      }}
    >
      <svg width="160" height="160" viewBox="0 0 160 160">
        <defs>
          <linearGradient id="arrowGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22c55e" />
            <stop offset="100%" stopColor="#15803d" />
          </linearGradient>
        </defs>
        {/* Arrow shape: triangle body pointing up */}
        <polygon
          points="80,10 110,90 80,72 50,90"
          fill={active ? 'url(#arrowGrad)' : '#6b7280'}
          stroke={active ? '#16a34a' : '#4b5563'}
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {/* Arrow tail */}
        <rect x="70" y="72" width="20" height="50" rx="4"
          fill={active ? '#16a34a' : '#4b5563'} />
      </svg>
    </div>
  );
}

// Smooth compass heading using exponential moving average with wrap-around handling
function smoothHeading(prev, next, alpha = 0.15) {
  if (prev === null) return next;
  let diff = next - prev;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return (prev + alpha * diff + 360) % 360;
}

// ── Compass view ─────────────────────────────────────────────────────
function Compass({ target, onBack, token }) {
  const [heading,   setHeading]   = useState(null);
  const [myPos,     setMyPos]     = useState(null);
  const [targetPos, setTargetPos] = useState({
    lat: parseFloat(target.last_lat), lng: parseFloat(target.last_lng)
  });
  const [noCompass,  setNoCompass]  = useState(false);
  const [noGps,      setNoGps]      = useState(false);
  const pollRef    = useRef(null);
  const watchRef   = useRef(null);
  const headingRef = useRef(null); // raw smoothed heading for EMA

  // Own position via Geolocation API (fresh, independent of server)
  useEffect(() => {
    if (!navigator.geolocation) { setNoGps(true); return; }
    const onPos = (pos) => setMyPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    const onErr = () => setNoGps(true);
    watchRef.current = navigator.geolocation.watchPosition(onPos, onErr, { enableHighAccuracy: true, maximumAge: 3000 });
    return () => { if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current); };
  }, []);

  // Device compass — prefer absolute, fall back to relative only if absolute never fires
  useEffect(() => {
    let gotAbsolute = false;
    let gotReading  = false;

    const applyHeading = (raw) => {
      headingRef.current = smoothHeading(headingRef.current, raw);
      gotReading = true;
      setHeading(Math.round(headingRef.current));
    };

    const absoluteHandler = (e) => {
      let h = null;
      if (e.webkitCompassHeading != null) h = e.webkitCompassHeading;
      else if (e.alpha != null) h = (360 - e.alpha) % 360;
      if (h != null) { gotAbsolute = true; applyHeading(h); }
    };

    const relativeHandler = (e) => {
      if (gotAbsolute) return; // absolute is firing — ignore relative
      let h = null;
      if (e.webkitCompassHeading != null) h = e.webkitCompassHeading;
      else if (e.alpha != null) h = (360 - e.alpha) % 360;
      if (h != null) applyHeading(h);
    };

    // Request iOS 13+ permission
    if (typeof DeviceOrientationEvent?.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission()
        .then(s => { if (s !== 'granted') setNoCompass(true); })
        .catch(() => setNoCompass(true));
    }

    window.addEventListener('deviceorientationabsolute', absoluteHandler, true);
    window.addEventListener('deviceorientation', relativeHandler, true);

    const timeout = setTimeout(() => { if (!gotReading) setNoCompass(true); }, 3000);

    return () => {
      window.removeEventListener('deviceorientationabsolute', absoluteHandler, true);
      window.removeEventListener('deviceorientation', relativeHandler, true);
      clearTimeout(timeout);
    };
  }, []);

  // Poll target unit position every 2 seconds
  useEffect(() => {
    const refresh = async () => {
      try {
        const res = await fetch(`${apiBase()}/units`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        const found = data.find(u => u.id === target.id);
        if (found?.last_lat && found?.last_lng) {
          setTargetPos({ lat: parseFloat(found.last_lat), lng: parseFloat(found.last_lng) });
        }
      } catch {}
    };
    pollRef.current = setInterval(refresh, 2000);
    return () => clearInterval(pollRef.current);
  }, [target.id, token]);

  const hasMyPos     = !!myPos;
  const hasTargetPos = !isNaN(targetPos.lat) && !isNaN(targetPos.lng);
  const hasPos       = hasMyPos && hasTargetPos;

  const bearing = hasPos ? getBearing(myPos.lat, myPos.lng, targetPos.lat, targetPos.lng) : null;
  const distFt  = hasPos ? getDistanceFt(myPos.lat, myPos.lng, targetPos.lat, targetPos.lng) : null;

  const arrowAngle = (bearing != null && heading != null)
    ? (bearing - heading + 360) % 360
    : null;

  const compassActive = arrowAngle != null && !noCompass;

  return (
    <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col items-center">
      {/* Header */}
      <div className="w-full flex items-center justify-between px-4 pt-safe pt-6 pb-4 border-b border-gray-800">
        <button onClick={onBack} className="text-gray-400 hover:text-white p-2 -ml-2">
          ← Back
        </button>
        <div className="text-center">
          <div className="text-white font-bold">{target.unit_number}</div>
          <div className="text-gray-500 text-xs">
            {target.crew ? target.crew : 'Beacon active'}
          </div>
        </div>
        <div className="w-12" />
      </div>

      {/* Compass area */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6">

        {/* Status badge */}
        {noCompass ? (
          <div className="text-amber-400 text-sm text-center bg-amber-900/30 border border-amber-700/50 rounded-xl px-4 py-2">
            No compass sensor detected on this device
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
        ) : heading == null ? (
          <div className="text-gray-400 text-sm text-center">Point your phone level and move it to calibrate…</div>
        ) : null}

        {/* Arrow */}
        <div className="relative flex items-center justify-center">
          <div className={`absolute inset-0 rounded-full ${compassActive ? 'bg-green-500/10' : 'bg-gray-700/20'}`}
            style={{ width: 220, height: 220, margin: 'auto' }} />
          <Arrow angle={arrowAngle ?? 0} active={compassActive} />
        </div>

        {/* Distance */}
        {distFt != null && (
          <div className="text-center">
            <div className="text-white font-bold text-5xl tabular-nums">
              {distFt < 1000 ? distFt : `${(distFt / 5280).toFixed(2)} mi`}
            </div>
            <div className="text-gray-500 text-sm mt-1">
              {distFt < 1000 ? 'feet away' : 'miles away'}
            </div>
          </div>
        )}

        {compassActive && (
          <div className="text-gray-600 text-xs text-center">
            Point the top of your phone in the direction the arrow shows
          </div>
        )}

        {/* Calibration hint */}
        {!noCompass && heading == null && (
          <div className="text-gray-600 text-xs text-center">
            Tip: draw a figure-8 in the air to calibrate the compass
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

  // Refresh on open to get latest beacon states
  useEffect(() => {
    fetch(`${apiBase()}/units`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setLiveUnits(data); })
      .catch(() => {});
  }, [token]);

  const beaconing = liveUnits.filter(u => u.beacon_active && u.id !== myUnit?.id);

  return (
    <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col">
      <div className="flex items-center justify-between px-4 pt-safe pt-6 pb-4 border-b border-gray-800">
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
              className="w-full flex items-center gap-4 bg-gray-800 hover:bg-gray-750 border border-green-800/60 hover:border-green-600 rounded-2xl px-4 py-4 text-left transition-all group">
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
  const [view,   setView]   = useState('finder'); // 'finder' | 'compass'
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
