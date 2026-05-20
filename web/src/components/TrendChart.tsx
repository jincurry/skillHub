import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TrendPoint } from '../api/types';

interface Props {
  data: TrendPoint[];
  height?: number;
  color?: string;
  label?: string; // tooltip prefix, e.g. "激活"
}

/**
 * TrendChart renders an area-line chart for a 30-day activation series.
 *
 * Design notes:
 * - Pure SVG with `preserveAspectRatio="none"` on the path layer so the
 *   chart stretches edge-to-edge inside its container without us having to
 *   measure the wrapper.
 * - The hover layer is a separate full-width transparent rect that maps the
 *   mouse X to the nearest data index — cheaper than per-point hitboxes and
 *   feels much more like a finance ticker.
 * - X-axis ticks are placed every ~5 days to avoid label overlap.
 * - All bookkeeping (min/max/normalised points) is memoised so re-renders
 *   from hover state don't recompute the path.
 */
export function TrendChart({ data, height = 200, color = 'var(--primary)', label = '激活' }: Props) {
  const { i18n } = useTranslation();
  const isEnglish = (i18n.resolvedLanguage ?? i18n.language ?? '').startsWith('en');
  const displayLabel = isEnglish && label === '激活' ? 'Activations' : label;
  // Internal pixel coordinate space. The SVG is later stretched via
  // preserveAspectRatio so this is purely virtual.
  const VIEW_W = 600;
  const VIEW_H = height;
  const PAD_LEFT = 40;
  const PAD_RIGHT = 12;
  const PAD_TOP = 14;
  const PAD_BOTTOM = 28;
  const plotW = VIEW_W - PAD_LEFT - PAD_RIGHT;
  const plotH = VIEW_H - PAD_TOP - PAD_BOTTOM;

  const [hover, setHover] = useState<number | null>(null);

  const { points, areaPath, linePath, yMax, total, avg, yTicks } = useMemo(() => {
    if (data.length === 0) {
      return { points: [], areaPath: '', linePath: '', yMax: 0, total: 0, avg: 0, yTicks: [] as number[] };
    }
    const values = data.map((d) => d.activations);
    const max = Math.max(...values, 1);
    // Round the y-axis ceiling to a friendlier number (10 / 50 / 100 / 500...)
    // so tick labels look stable across reloads.
    const niceMax = niceCeiling(max);
    const xStep = plotW / Math.max(1, data.length - 1);
    const points = data.map((d, i) => ({
      x: PAD_LEFT + i * xStep,
      y: PAD_TOP + plotH - (d.activations / niceMax) * plotH,
      v: d.activations,
      day: d.day,
    }));
    const linePath = points
      .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
      .join(' ');
    const areaPath = `${linePath} L ${points[points.length - 1].x} ${PAD_TOP + plotH} L ${points[0].x} ${PAD_TOP + plotH} Z`;
    const total = values.reduce((a, b) => a + b, 0);
    const avg = total / values.length;
    // Three horizontal grid ticks at 0 / 50% / 100%.
    const yTicks = [0, niceMax / 2, niceMax].map((v) => Math.round(v));
    return { points, areaPath, linePath, yMax: niceMax, total, avg, yTicks };
  }, [data, PAD_LEFT, PAD_TOP, plotW, plotH]);

  // Pick ~6 x-axis labels evenly across the range so they don't overlap.
  const xTickIndices = useMemo(() => {
    const want = 6;
    if (data.length <= want) return data.map((_, i) => i);
    const step = (data.length - 1) / (want - 1);
    return Array.from({ length: want }, (_, i) => Math.round(i * step));
  }, [data.length]);

  if (data.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-faint)', fontSize: 12 }}>
        {isEnglish ? 'No data yet' : '暂无数据'}
      </div>
    );
  }

  const hoverPoint = hover != null ? points[hover] : null;
  const gradId = 'trend-grad';

  function onMouseMove(e: React.MouseEvent<SVGRectElement>) {
    const rect = (e.target as SVGRectElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = x / rect.width;
    const idx = Math.max(0, Math.min(data.length - 1, Math.round(ratio * (data.length - 1))));
    setHover(idx);
  }

  return (
    <div style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height, display: 'block' }}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Y-axis horizontal grid + labels */}
        {yTicks.map((v) => {
          const y = PAD_TOP + plotH - (v / yMax) * plotH;
          return (
            <g key={v}>
              <line
                x1={PAD_LEFT}
                x2={VIEW_W - PAD_RIGHT}
                y1={y}
                y2={y}
                stroke="var(--border)"
                strokeDasharray={v === 0 ? '0' : '3 3'}
                strokeWidth="0.8"
              />
              <text
                x={PAD_LEFT - 6}
                y={y + 3.5}
                textAnchor="end"
                fontSize="10"
                fontFamily="'JetBrains Mono', monospace"
                fill="var(--text-faint)"
              >{v}</text>
            </g>
          );
        })}

        {/* Area + line */}
        <path d={areaPath} fill={`url(#${gradId})`} />
        <path d={linePath} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />

        {/* X-axis day labels */}
        {xTickIndices.map((idx) => {
          const p = points[idx];
          if (!p) return null;
          return (
            <text
              key={idx}
              x={p.x}
              y={VIEW_H - 8}
              textAnchor="middle"
              fontSize="10"
              fontFamily="'JetBrains Mono', monospace"
              fill="var(--text-faint)"
            >{formatDay(p.day)}</text>
          );
        })}

        {/* Hover crosshair + dot */}
        {hoverPoint && (
          <>
            <line
              x1={hoverPoint.x}
              x2={hoverPoint.x}
              y1={PAD_TOP}
              y2={PAD_TOP + plotH}
              stroke={color}
              strokeWidth="0.8"
              strokeDasharray="3 3"
              opacity="0.6"
            />
            <circle cx={hoverPoint.x} cy={hoverPoint.y} r="4" fill="var(--bg)" stroke={color} strokeWidth="1.8" />
          </>
        )}

        {/* Hover capture layer — wide enough to feel snappy. */}
        <rect
          x={PAD_LEFT}
          y={PAD_TOP}
          width={plotW}
          height={plotH}
          fill="transparent"
          onMouseMove={onMouseMove}
          onMouseLeave={() => setHover(null)}
          style={{ cursor: 'crosshair' }}
        />
      </svg>

      {/* HTML tooltip overlay — positioned via CSS percentage, not SVG, so
          font rendering stays crisp regardless of the SVG stretch. */}
      {hoverPoint && (
        <div
          style={{
            position: 'absolute',
            left: `${(hoverPoint.x / VIEW_W) * 100}%`,
            top: 0,
            transform: 'translate(-50%, -100%)',
            pointerEvents: 'none',
            background: 'var(--bg-soft)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 11.5,
            whiteSpace: 'nowrap',
            boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
            zIndex: 1,
          }}
        >
          <div style={{ color: 'var(--text-subtle)', fontSize: 10.5, fontFamily: "'JetBrains Mono', monospace" }}>
            {hoverPoint.day}
          </div>
          <div style={{ marginTop: 2, fontWeight: 600 }}>
            {displayLabel} <span className="num" style={{ color: 'var(--text)' }}>{hoverPoint.v.toLocaleString()}</span>
          </div>
        </div>
      )}

      {/* Caption row below the chart with totals. */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        marginTop: 8, fontSize: 11.5, color: 'var(--text-subtle)',
      }}>
        <span>{isEnglish ? '30-day total' : '30 天合计'} <span className="num" style={{ fontWeight: 600, color: 'var(--text)' }}>{total.toLocaleString()}</span></span>
        <span>{isEnglish ? 'Daily avg' : '日均'} <span className="num" style={{ fontWeight: 600, color: 'var(--text)' }}>{Math.round(avg).toLocaleString()}</span></span>
      </div>
    </div>
  );
}

// niceCeiling rounds up to a tidy axis ceiling: 1, 2, 5 × 10^n. Keeps the
// y-axis label set readable across orders of magnitude.
function niceCeiling(max: number): number {
  if (max <= 0) return 1;
  const exp = Math.floor(Math.log10(max));
  const base = Math.pow(10, exp);
  const m = max / base;
  let factor: number;
  if (m <= 1) factor = 1;
  else if (m <= 2) factor = 2;
  else if (m <= 5) factor = 5;
  else factor = 10;
  return factor * base;
}

// formatDay turns "2026-05-11" into "05/11" for compact axis labels.
function formatDay(iso: string): string {
  const m = iso.match(/^\d{4}-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}/${m[2]}` : iso;
}
