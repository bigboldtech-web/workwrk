"use client";

interface SparklineProps {
  /** Oldest → newest. Empty array renders an empty placeholder. */
  values: number[];
  /** Pixel dimensions of the sparkline. */
  width?: number;
  height?: number;
  /** Stroke color override. Defaults to lime if trending up, red if down, muted if flat. */
  color?: string;
  /** Show a small dot at the latest value. */
  showLastDot?: boolean;
}

/**
 * Inline trend sparkline. Pure SVG so it scales nicely on retina and
 * has zero runtime dependencies.
 *
 * Picks a color automatically based on direction unless `color` is
 * given:
 *   · last > first → lime
 *   · last < first → red
 *   · flat or single point → muted grey
 */
export function Sparkline({
  values,
  width = 80,
  height = 24,
  color,
  showLastDot = true,
}: SparklineProps) {
  if (values.length === 0) {
    return (
      <svg width={width} height={height} aria-hidden className="opacity-40">
        <line x1="2" y1={height / 2} x2={width - 2} y2={height / 2} stroke="currentColor" strokeWidth="1" strokeDasharray="2 3" />
      </svg>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padX = 2;
  const padY = 3;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const points = values.map((v, i) => {
    const x = values.length === 1 ? width / 2 : padX + (i / (values.length - 1)) * innerW;
    const y = padY + (1 - (v - min) / range) * innerH;
    return [x, y] as const;
  });

  const path = points
    .map(([x, y], i) => (i === 0 ? `M ${x.toFixed(2)} ${y.toFixed(2)}` : `L ${x.toFixed(2)} ${y.toFixed(2)}`))
    .join(" ");

  // Auto-color by direction.
  const trend = values.length >= 2 ? values[values.length - 1] - values[0] : 0;
  const stroke =
    color ??
    (trend > 0 ? "#d4ff2e" : trend < 0 ? "#ff3d8a" : "var(--muted, #6b7280)");

  const last = points[points.length - 1];

  return (
    <svg width={width} height={height} aria-hidden>
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      {showLastDot && last && (
        <circle cx={last[0]} cy={last[1]} r="2" fill={stroke} />
      )}
    </svg>
  );
}
