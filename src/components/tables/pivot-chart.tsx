"use client";

// PivotChart — a dependency-free SVG chart of a pivot result. Bar (grouped),
// line, or pie. Categories are the pivot's row groups; series are its columns
// (or a single "Total" series when there is no column field). Pure render from
// the same computePivot output the table uses, so table and chart never drift.

import type { PivotResult } from "@/lib/sheet-pivot";

export type ChartType = "bar" | "line" | "pie";

const PALETTE = ["#0073EA", "#00C875", "#FDAB3D", "#E2445C", "#A25DDC", "#00D2D2", "#FF7575", "#7E5EF2"];

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (mag * m >= v) return mag * m;
  return mag * 10;
}
function fmt(n: number): string {
  const r = Math.round(n * 1e4) / 1e4;
  if (Math.abs(r) >= 1000) return r.toLocaleString();
  return String(r);
}

export function PivotChart({ result, type, height = 340 }: { result: PivotResult; type: ChartType; height?: number }) {
  const categories = result.rows.map((r) => r.key);
  const seriesNames = result.columns.length > 0 ? result.columns : ["Total"];
  // values[c][s] = category c, series s.
  const values = result.rows.map((r) => (result.columns.length > 0 ? r.cells : [r.total]));

  if (categories.length === 0 || seriesNames.length === 0) {
    return <div className="h-full flex items-center justify-center text-[13px] text-zinc-400">Nothing to chart yet.</div>;
  }

  const legend = (
    <div className="flex flex-wrap gap-x-4 gap-y-1 justify-center mt-3">
      {seriesNames.map((s, i) => (
        <span key={s} className="inline-flex items-center gap-1.5 text-[12px] text-zinc-600">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
          {s}
        </span>
      ))}
    </div>
  );

  if (type === "pie") {
    // Pie charts one series — the first (single series is the common case).
    const slices = categories.map((cat, i) => ({ label: cat, value: Math.max(0, values[i][0] ?? 0) }));
    const total = slices.reduce((a, b) => a + b.value, 0);
    const R = Math.min(height, 300) / 2 - 10;
    const cx = R + 10;
    const cy = R + 10;
    let acc = 0;
    const paths = slices.map((s, i) => {
      const frac = total > 0 ? s.value / total : 0;
      const a0 = acc * 2 * Math.PI - Math.PI / 2;
      acc += frac;
      const a1 = acc * 2 * Math.PI - Math.PI / 2;
      const large = frac > 0.5 ? 1 : 0;
      const x0 = cx + R * Math.cos(a0);
      const y0 = cy + R * Math.sin(a0);
      const x1 = cx + R * Math.cos(a1);
      const y1 = cy + R * Math.sin(a1);
      const d = frac >= 1
        ? `M ${cx} ${cy - R} A ${R} ${R} 0 1 1 ${cx - 0.01} ${cy - R} Z`
        : `M ${cx} ${cy} L ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} Z`;
      return <path key={i} d={d} fill={PALETTE[i % PALETTE.length]} stroke="#fff" strokeWidth={1.5} />;
    });
    return (
      <div>
        <svg width="100%" height={height} viewBox={`0 0 ${(R + 10) * 2} ${(R + 10) * 2}`} preserveAspectRatio="xMidYMid meet">
          {paths}
        </svg>
        <div className="flex flex-wrap gap-x-4 gap-y-1 justify-center mt-2">
          {slices.map((s, i) => (
            <span key={s.label} className="inline-flex items-center gap-1.5 text-[12px] text-zinc-600">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
              {s.label} · {fmt(s.value)}
            </span>
          ))}
        </div>
      </div>
    );
  }

  // Bar / line: shared Cartesian frame.
  const W = 720;
  const H = height;
  const padL = 52;
  const padR = 16;
  const padT = 12;
  const padB = 46;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  let maxV = 0;
  let minV = 0;
  for (const row of values) for (const v of row) { if (v > maxV) maxV = v; if (v < minV) minV = v; }
  const top = niceMax(maxV);
  const bottom = minV < 0 ? -niceMax(-minV) : 0;
  const span = top - bottom || 1;
  const yOf = (v: number) => padT + plotH - ((v - bottom) / span) * plotH;
  const zeroY = yOf(0);

  const catW = plotW / categories.length;
  const ticks = 4;
  const gridLines = Array.from({ length: ticks + 1 }, (_, i) => bottom + (span * i) / ticks);

  return (
    <div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        {/* Y grid + labels */}
        {gridLines.map((gv, i) => {
          const y = yOf(gv);
          return (
            <g key={i}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#eee" strokeWidth={1} />
              <text x={padL - 8} y={y + 3} textAnchor="end" fontSize={11} fill="#a1a1aa">{fmt(gv)}</text>
            </g>
          );
        })}
        {/* Category labels */}
        {categories.map((cat, ci) => (
          <text key={ci} x={padL + catW * ci + catW / 2} y={H - padB + 16} textAnchor="middle" fontSize={11} fill="#71717a">
            {cat.length > 12 ? cat.slice(0, 11) + "…" : cat}
          </text>
        ))}

        {type === "bar" ? (
          // Grouped bars: each category holds one bar per series.
          categories.map((_, ci) => {
            const groupPad = catW * 0.18;
            const inner = catW - groupPad * 2;
            const bw = inner / seriesNames.length;
            return seriesNames.map((_, si) => {
              const v = values[ci][si] ?? 0;
              const x = padL + catW * ci + groupPad + bw * si;
              const y = v >= 0 ? yOf(v) : zeroY;
              const h = Math.abs(zeroY - yOf(v));
              return <rect key={`${ci}-${si}`} x={x} y={y} width={Math.max(1, bw - 2)} height={Math.max(0, h)} rx={1.5} fill={PALETTE[si % PALETTE.length]} />;
            });
          })
        ) : (
          // Lines: one polyline per series, points centred in each category.
          seriesNames.map((_, si) => {
            const pts = categories.map((_, ci) => {
              const x = padL + catW * ci + catW / 2;
              const y = yOf(values[ci][si] ?? 0);
              return `${x},${y}`;
            });
            const color = PALETTE[si % PALETTE.length];
            return (
              <g key={si}>
                <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {pts.map((p, ci) => {
                  const [x, y] = p.split(",");
                  return <circle key={ci} cx={x} cy={y} r={2.5} fill={color} />;
                })}
              </g>
            );
          })
        )}

        {/* Zero baseline when there are negatives */}
        {bottom < 0 ? <line x1={padL} y1={zeroY} x2={W - padR} y2={zeroY} stroke="#d4d4d8" strokeWidth={1} /> : null}
      </svg>
      {result.columns.length > 0 ? legend : null}
    </div>
  );
}
