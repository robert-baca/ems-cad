import { useState } from 'react';

// Single-series bar chart (the title names the series, so no legend).
// Bar colour validated against the dashboard surface (#1f2937) with the
// dataviz palette checker. Every bar has a hover tooltip with the detail.
const BAR = '#3987e5';
const W = 720, H = 180, PAD_L = 36, PAD_B = 22, PAD_T = 8;

function niceMax(v) {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

export default function BarChart({ title, data, formatValue = v => v, formatTick = formatValue, emptyText = 'No data' }) {
  const [hover, setHover] = useState(null);
  const values = data.map(d => d.value ?? 0);
  const max = niceMax(Math.max(0, ...values));
  const hasData = values.some(v => v > 0);
  const plotW = W - PAD_L, plotH = H - PAD_B - PAD_T;
  const slot = plotW / data.length;
  const barW = Math.max(2, slot - 2); // 2px gap between bars
  const y = v => PAD_T + plotH - (v / max) * plotH;
  const ticks = [0, max / 2, max];

  return (
    <div className="bg-gray-900/40 rounded-xl border border-gray-700 p-3">
      <div className="text-gray-200 text-sm font-semibold mb-2">{title}</div>
      {!hasData ? (
        <div className="text-gray-500 text-xs py-8 text-center">{emptyText}</div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" onMouseLeave={() => setHover(null)}>
            {ticks.map(t => (
              <g key={t}>
                <line x1={PAD_L} x2={W} y1={y(t)} y2={y(t)} stroke="#374151" strokeWidth="1" />
                <text x={PAD_L - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="#9ca3af">{formatTick(t)}</text>
              </g>
            ))}
            {data.map((d, i) => {
              const v = d.value ?? 0;
              const x = PAD_L + i * slot + 1;
              const top = y(v);
              const h = Math.max(0, PAD_T + plotH - top);
              const r = Math.min(4, barW / 2, h);
              // Rounded top only; flat on the baseline.
              const path = h <= 0 ? '' :
                `M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${top + h} Z`;
              return (
                <g key={i} onMouseEnter={() => setHover(i)}>
                  {/* Hit target: the whole column, bigger than the bar */}
                  <rect x={PAD_L + i * slot} y={PAD_T} width={slot} height={plotH} fill="transparent" />
                  {path && <path d={path} fill={BAR} opacity={hover == null || hover === i ? 1 : 0.55} />}
                  {d.label && (i % Math.ceil(data.length / 12) === 0) && (
                    <text x={x + barW / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="#9ca3af">{d.label}</text>
                  )}
                </g>
              );
            })}
          </svg>
          {hover != null && (
            <div className="absolute top-0 pointer-events-none bg-gray-950 border border-gray-600 rounded-lg px-2.5 py-1.5 text-xs text-gray-100 shadow-lg whitespace-nowrap"
              style={{ left: `${((PAD_L + (hover + 0.5) * slot) / W) * 100}%`, transform: 'translateX(-50%)' }}>
              <div className="font-semibold">{data[hover].fullLabel || data[hover].label}</div>
              <div>{formatValue(data[hover].value ?? 0)}</div>
              {data[hover].detail && <div className="text-gray-400">{data[hover].detail}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
