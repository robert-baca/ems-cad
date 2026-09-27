import { useState, useEffect, useRef } from 'react';
import { getBearing, getDistanceFt, getCardinal } from '../../lib/geo';
import { STATUS_COLORS, STATUS_LABELS } from '../../data/mockData';

// A unit whose last position is older than this isn't shown as findable --
// e.g. a phone left at the station keeps an old pin that would send someone
// to the wrong place.
const FRESH_MS = 10 * 60 * 1000;

function gpsAgeMs(u) {
  return u?.last_gps_at ? Date.now() - new Date(u.last_gps_at).getTime() : Infinity;
}

function fmtAge(ms) {
  if (!isFinite(ms)) return 'no location yet';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `updated ${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `updated ${m}m ago`;
  return `updated ${Math.floor(m / 60)}h ago`;
}

function fmtDist(ft) {
  if (ft == null) return null;
  return ft < 1000 ? `${ft} ft` : `${(ft / 5280).toFixed(2)} mi`;
}

// Rotation of the screen relative to the phone's natural (portrait) top.
// Compass headings are measured off the top of the device, so in landscape
// the arrow was off by 90° without this.
function getScreenAngle() {
  const a = window.screen?.orientation?.angle ?? window.orientation ?? 0;
  return ((Number(a) || 0) + 360) % 360;
}

// Re-renders every few seconds so "updated Xs ago" labels stay current.
function useTicker(ms) {
  const [, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN(n => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
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
function Compass({ target, onBack, units }) {
  const [heading,        setHeading]        = useState(null);
  const [myPos,          setMyPos]          = useState(null);
  const [targetPos,      setTargetPos]      = useState({
    lat: parseFloat(target.last_lat), lng: parseFloat(target.last_lng)
  });
  const [targetGpsAt,    setTargetGpsAt]    = useState(target.last_gps_at || null);
  const [staleLabel,     setStaleLabel]     = useState(null);
  const [noCompass,      setNoCompass]      = useState(false);
  const [noGps,          setNoGps]          = useState(false);
  // True when readings are coming in but none have ever been true-north-
  // anchored (deviceorientationabsolute / webkitCompassHeading) — some
  // Android browser/device combos never fire an absolute event at all, and
  // silently treating a relative, arbitrary-zero-point reading as a compass
  // heading produces an arrow that looks exactly as confident as a correct
  // one while pointing nowhere near the real direction.
  const [compassUncertain, setCompassUncertain] = useState(false);
  // iOS 13+ requires requestPermission() to be called from a user-gesture handler.
  // Start as 'needed' when the API exists so we show a tap-to-enable button first.
  const [compassPermission, setCompassPermission] = useState(
    typeof DeviceOrientationEvent?.requestPermission === 'function' ? 'needed' : 'granted'
  );
  const watchRef   = useRef(null);
  const headingRef = useRef(null);
  const staleRef   = useRef(null);
  // Unwrapped arrow angle actually rendered (can go past 360 / below 0), so
  // crossing north animates the few degrees it really moved instead of
  // CSS spinning the arrow the long way round (359° -> 1° = -358°).
  const displayAngleRef = useRef(null);
  const [screenAngle, setScreenAngle] = useState(getScreenAngle);

  useEffect(() => {
    const update = () => setScreenAngle(getScreenAngle());
    window.screen?.orientation?.addEventListener?.('change', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.screen?.orientation?.removeEventListener?.('change', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  // Own GPS via browser Geolocation
  useEffect(() => {
    if (!navigator.geolocation) { setNoGps(true); return; }
    const onPos = (pos) => {
      setMyPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      // A fix succeeding means GPS is working again -- without this, one
      // transient onErr (e.g. a few seconds of signal loss indoors) latches
      // the "GPS unavailable" message for the rest of the view even after
      // real fixes resume.
      setNoGps(false);
    };
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
      // A reading arriving at all means the sensor did come online -- without
      // this, a sensor that's merely slow to start (just past the 3s
      // no-reading timeout below) leaves noCompass latched true forever,
      // permanently disabling the arrow even once real headings are flowing.
      setNoCompass(false);
    };

    const absHandler = (e) => {
      let h = null;
      if (e.webkitCompassHeading != null) h = e.webkitCompassHeading;
      else if (e.alpha != null) h = (360 - e.alpha) % 360;
      if (h != null) { gotAbsolute = true; setCompassUncertain(false); apply(h); }
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
    const noReadingTimeout = setTimeout(() => { if (!gotReading) setNoCompass(true); }, 3000);
    // Longer grace period than the no-reading check above — this only fires
    // if readings ARE arriving but none has ever been absolute.
    const uncertainTimeout = setTimeout(() => {
      if (gotReading && !gotAbsolute) setCompassUncertain(true);
    }, 6000);

    return () => {
      window.removeEventListener('deviceorientationabsolute', absHandler, true);
      window.removeEventListener('deviceorientation',         relHandler, true);
      clearTimeout(noReadingTimeout);
      clearTimeout(uncertainTimeout);
    };
  }, [compassPermission]);

  // Target position comes straight from the app's live, socket-updated units
  // list — this used to poll GET /units every 2s on its own instead, adding
  // up to 2s of lag and redundant network traffic for a position that's
  // already arriving in real time via the normal GPS-update socket event.
  useEffect(() => {
    const found = units.find(u => u.id === target.id);
    if (found?.last_lat && found?.last_lng) {
      setTargetPos({ lat: parseFloat(found.last_lat), lng: parseFloat(found.last_lng) });
      setTargetGpsAt(found.last_gps_at || null);
    }
  }, [units, target.id]);

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

  const facing        = heading != null ? (heading + screenAngle) % 360 : null;
  const arrowAngle    = (bearing != null && facing != null) ? (bearing - facing + 360) % 360 : null;
  if (arrowAngle != null) {
    const prev = displayAngleRef.current;
    if (prev == null) {
      displayAngleRef.current = arrowAngle;
    } else {
      const prevNorm = ((prev % 360) + 360) % 360;
      const delta = ((arrowAngle - prevNorm + 540) % 360) - 180;
      displayAngleRef.current = prev + delta;
    }
  }
  const live          = units.find(u => u.id === target.id) || target;
  const liveStatus    = live.status;
  const compassActive = arrowAngle != null && !noCompass;
  const isClose       = distFt != null && distFt <= CLOSE_FT;

  return (
    <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col">
      {/* Header */}
      <div className="w-full flex items-center justify-between px-4 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-4 border-b border-gray-800 flex-shrink-0">
        <button onClick={onBack} className="text-gray-400 hover:text-white p-2 -ml-2 text-lg">← Back</button>
        <div className="text-center">
          <div className="text-white font-bold text-lg">{live.unit_number}</div>
          <div className="text-xs">
            {live.crew && <span className="text-gray-400">{live.crew} · </span>}
            <span style={{ color: STATUS_COLORS[liveStatus] || '#9ca3af' }}>{STATUS_LABELS[liveStatus] || liveStatus}</span>
          </div>
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

        {/* This phone is only giving a relative (non-true-north) heading —
            the arrow may be confidently pointing the wrong way. */}
        {compassUncertain && compassActive && (
          <div className="flex items-center gap-2 bg-amber-900/30 border border-amber-700/40 rounded-lg px-3 py-1.5">
            <div className="w-2 h-2 rounded-full bg-amber-500" />
            <span className="text-amber-400 text-xs">Compass accuracy not confirmed on this device — verify direction before walking</span>
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
            <Arrow angle={displayAngleRef.current ?? 0} active={compassActive} />
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
// `units` is already the app's live, socket-updated unit list, so a unit
// coming on shift or getting its first GPS fix after this screen opened
// shows up immediately with no re-fetch needed. Every other unit is
// selectable here with no opt-in from them — see GET /api/units on the
// server, which no longer masks crew-to-crew positions.
//
// Units with a recent position come first, nearest first. Out-of-service
// units and ones with no position in the last 10 min go in a dimmed "not
// currently trackable" section -- they used to read "GPS active" off a pin
// that could be hours old.
function Finder({ myUnit, units, onSelect, onClose }) {
  useTicker(10000);
  const others = units.filter(u => u.id !== myUnit?.id);
  const hasMe = myUnit?.last_lat && myUnit?.last_lng;
  const distTo = (u) => (hasMe && u.last_lat && u.last_lng)
    ? getDistanceFt(parseFloat(myUnit.last_lat), parseFloat(myUnit.last_lng), parseFloat(u.last_lat), parseFloat(u.last_lng))
    : null;

  const rows = others.map(u => ({ u, age: gpsAgeMs(u), dist: distTo(u) }));
  const findable = rows
    .filter(r => r.u.status !== 'out_of_service' && r.age < FRESH_MS)
    .sort((a, b) => (a.dist ?? Infinity) - (b.dist ?? Infinity));
  const others2 = rows
    .filter(r => !findable.includes(r))
    .sort((a, b) => a.u.unit_number.localeCompare(b.u.unit_number, undefined, { numeric: true }));

  const Row = ({ u, age, dist, dim }) => (
    <button key={u.id} onClick={() => onSelect(u)}
      className={`w-full flex items-center gap-4 rounded-2xl px-4 py-3.5 text-left transition-all group border ${
        dim ? 'bg-gray-900 border-gray-800 opacity-60' : 'bg-gray-800 border-green-800/60 hover:border-green-600'}`}>
      <div className={`w-10 h-10 rounded-full flex items-center justify-center border ${
        dim ? 'bg-gray-800 border-gray-700' : 'bg-green-900/60 border-green-700'}`}>
        <span className="text-lg">{dim ? '📍' : '📡'}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-white font-bold">{u.unit_number}</span>
          <span className="text-xs font-medium" style={{ color: STATUS_COLORS[u.status] || '#9ca3af' }}>
            {STATUS_LABELS[u.status] || u.status}
          </span>
        </div>
        {u.crew && <div className="text-gray-400 text-xs mt-0.5 truncate">{u.crew}</div>}
        <div className={`text-xs mt-0.5 ${dim ? 'text-gray-500' : 'text-green-500'}`}>
          {!dim && dist != null ? `${fmtDist(dist)} · ` : ''}{fmtAge(age)}
        </div>
      </div>
      <span className="text-gray-600 group-hover:text-green-400 text-xl transition-colors">›</span>
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col">
      <div className="flex items-center justify-between px-4 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-4 border-b border-gray-800">
        <button onClick={onClose} className="text-gray-400 hover:text-white p-2 -ml-2">← Back</button>
        <div className="text-white font-bold">Find a Medic</div>
        <div className="w-12" />
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {findable.length === 0 && (
          <div className="text-center py-10 text-gray-500 text-sm">
            <div className="text-4xl mb-3">📡</div>
            No other units with a current location right now.
          </div>
        )}
        {findable.map(r => <Row key={r.u.id} {...r} dim={false} />)}

        {others2.length > 0 && (
          <>
            <div className="text-gray-500 text-xs uppercase tracking-wider pt-3">
              Not currently trackable · out of service or no location in 10+ min
            </div>
            {others2.map(r => <Row key={r.u.id} {...r} dim />)}
          </>
        )}
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────
// backRef lets CrewMobile's hardware/native back button step compass ->
// unit list first, instead of closing Find a Medic outright.
export default function BeaconMode({ myUnit, units, onClose, backRef }) {
  const [view,   setView]   = useState('finder');
  const [target, setTarget] = useState(null);

  useEffect(() => {
    if (!backRef) return;
    backRef.current = () => {
      if (view === 'compass') { setView('finder'); return true; }
      return false;
    };
    return () => { backRef.current = null; };
  }, [backRef, view]);

  if (view === 'compass' && target) {
    return (
      <Compass
        target={target}
        units={units}
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
