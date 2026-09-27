import { useEffect, useMemo, useRef, useState } from 'react';

// "Nobody's volunteering" wheel: spins through the available medics and
// adds the winner to the call. Purely a picker -- the actual assign/add goes
// through the same onPick handler the normal unit buttons use.

const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f43f5e', '#84cc16', '#a855f7'];
const SPIN_MS = 5200;
const SIZE = 320;           // px, wheel diameter
const R = SIZE / 2;

const nameOf = (u) => u.crew?.trim() || u.unit_number;

function slicePath(i, n) {
  const a0 = (i / n) * 2 * Math.PI - Math.PI / 2;
  const a1 = ((i + 1) / n) * 2 * Math.PI - Math.PI / 2;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const x0 = R + R * Math.cos(a0), y0 = R + R * Math.sin(a0);
  const x1 = R + R * Math.cos(a1), y1 = R + R * Math.sin(a1);
  return `M${R},${R} L${x0},${y0} A${R},${R} 0 ${large} 1 ${x1},${y1} Z`;
}

function Wheel({ entries, rotation, spinning }) {
  const n = entries.length;
  const fontSize = n <= 6 ? 15 : n <= 10 ? 13 : 11;
  return (
    <div className="relative" style={{ width: SIZE, height: SIZE }}>
      {/* Pointer at the top */}
      <div className="absolute left-1/2 -top-3 -translate-x-1/2 z-10"
        style={{ width: 0, height: 0, borderLeft: '14px solid transparent', borderRight: '14px solid transparent', borderTop: '26px solid #ffffff', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.6))' }} />
      <svg width={SIZE} height={SIZE}
        style={{
          transform: `rotate(${rotation}deg)`,
          transition: spinning ? `transform ${SPIN_MS}ms cubic-bezier(0.12, 0.8, 0.12, 1)` : 'none',
        }}>
        {n === 1 ? (
          <circle cx={R} cy={R} r={R} fill={COLORS[0]} />
        ) : entries.map((u, i) => (
          <path key={u.id} d={slicePath(i, n)} fill={COLORS[i % COLORS.length]} stroke="#111827" strokeWidth="2" />
        ))}
        {entries.map((u, i) => {
          const mid = ((i + 0.5) / n) * 360; // degrees clockwise from top
          const label = nameOf(u);
          return (
            <g key={u.id} transform={`rotate(${mid} ${R} ${R})`}>
              <text x={R} y={R - R * 0.58} textAnchor="middle" dominantBaseline="middle"
                fill="#ffffff" fontSize={fontSize} fontWeight="800"
                style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.45)', strokeWidth: 3 }}
                transform={`rotate(90 ${R} ${R - R * 0.58})`}>
                {label.length > 14 ? `${label.slice(0, 13)}…` : label}
              </text>
            </g>
          );
        })}
        <circle cx={R} cy={R} r={22} fill="#111827" stroke="#ffffff" strokeWidth="3" />
      </svg>
    </div>
  );
}

// candidates: units that could be added (already filtered to available,
// non-cart). onPick(unit) -> error string or null. mode: 'assign' | 'add'.
export default function SpinWheel({ candidates, callNumber, mode, onPick, onClose }) {
  const [excluded, setExcluded] = useState(() => new Set());
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [winner, setWinner]     = useState(null);
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState('');
  const [added, setAdded]       = useState([]); // unit_numbers added this session
  // The wheel's slices are frozen while it spins, so a unit changing status
  // mid-spin can't reshuffle the slices under the pointer.
  const [frozen, setFrozen]     = useState(null);
  const timerRef = useRef(null);
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const live = useMemo(() => candidates.filter(u => !excluded.has(u.id)), [candidates, excluded]);
  const entries = frozen || live;

  const spin = () => {
    if (spinning || live.length === 0) return;
    setWinner(null);
    setError('');
    const list = live;
    const n = list.length;
    const k = Math.floor(Math.random() * n);
    const seg = 360 / n;
    // Land somewhere inside the winning slice, not always dead centre.
    const within = seg * (0.2 + Math.random() * 0.6);
    const target = (360 - (k * seg + within)) % 360;
    const current = ((rotation % 360) + 360) % 360;
    const extra = 360 * (5 + Math.floor(Math.random() * 3));
    setFrozen(list);
    setSpinning(true);
    setRotation(rotation + extra + ((target - current + 360) % 360));
    timerRef.current = setTimeout(() => {
      setSpinning(false);
      setWinner(list[k]);
    }, SPIN_MS + 100);
  };

  const accept = async () => {
    if (!winner || busy) return;
    setBusy(true);
    setError('');
    const err = await onPick(winner);
    setBusy(false);
    if (err) { setError(err); return; }
    setAdded(prev => [...prev, winner.unit_number]);
    // Winner drops off the wheel (it's no longer available anyway).
    setExcluded(prev => new Set(prev).add(winner.id));
    setWinner(null);
    setFrozen(null);
  };

  const toggle = (id) => {
    if (spinning) return;
    setWinner(null);
    setFrozen(null);
    setExcluded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const verb = mode === 'assign' && added.length === 0 ? 'Dispatch' : 'Add to Call';

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4" onClick={() => !spinning && onClose()}>
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg max-h-[95vh] overflow-y-auto p-5"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-white font-black text-lg">🎡 Spin for Case #{callNumber}</div>
            <div className="text-gray-400 text-xs">Nobody volunteering? Let the wheel decide.</div>
          </div>
          <button onClick={onClose} disabled={spinning}
            className="text-gray-400 hover:text-white w-8 h-8 flex items-center justify-center rounded hover:bg-gray-800 text-xl disabled:opacity-40">×</button>
        </div>

        {entries.length === 0 ? (
          <div className="text-center text-gray-400 text-sm py-12">
            {candidates.length === 0 ? 'No available medics to spin for.' : 'Everyone is off the wheel — tap names below to add them back.'}
          </div>
        ) : (
          <div className="flex justify-center py-3">
            <Wheel entries={entries} rotation={rotation} spinning={spinning} />
          </div>
        )}

        {winner ? (
          <div className="mt-2 rounded-xl bg-gradient-to-r from-yellow-500 to-orange-500 p-4 text-center">
            <div className="text-black/70 text-xs font-bold uppercase tracking-wider">The wheel has spoken</div>
            <div className="text-black text-2xl font-black">🎉 {nameOf(winner)}</div>
            {winner.crew && <div className="text-black/80 text-sm font-semibold">{winner.unit_number}</div>}
            <div className="flex gap-2 mt-3">
              <button onClick={accept} disabled={busy}
                className="flex-1 py-2.5 rounded-lg bg-black text-white font-bold text-sm disabled:opacity-60">
                {busy ? 'Working…' : `✅ ${verb}`}
              </button>
              <button onClick={spin} disabled={busy}
                className="px-4 py-2.5 rounded-lg bg-white/80 text-black font-bold text-sm">
                🔄 Re-spin
              </button>
            </div>
            {error && <div className="text-red-900 text-xs font-semibold mt-2">{error}</div>}
          </div>
        ) : (
          <button onClick={spin} disabled={spinning || live.length === 0}
            className="w-full mt-2 py-3 rounded-xl bg-gradient-to-r from-pink-600 to-purple-600 hover:brightness-110 disabled:opacity-50 text-white text-lg font-black">
            {spinning ? 'Spinning…' : '🎡 SPIN'}
          </button>
        )}

        {added.length > 0 && (
          <div className="text-green-400 text-xs text-center mt-2">Added: {added.join(', ')} — spin again for another</div>
        )}

        {candidates.length > 0 && (
          <div className="mt-4">
            <div className="text-gray-500 text-[11px] uppercase tracking-wider mb-1.5">On the wheel — tap to take someone off</div>
            <div className="flex flex-wrap gap-1.5">
              {candidates.map(u => {
                const off = excluded.has(u.id);
                return (
                  <button key={u.id} onClick={() => toggle(u.id)} disabled={spinning}
                    className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
                      off ? 'bg-gray-800 border-gray-700 text-gray-500 line-through' : 'bg-gray-700 border-gray-500 text-white'}`}>
                    {nameOf(u)}{u.crew ? ` · ${u.unit_number}` : ''}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
