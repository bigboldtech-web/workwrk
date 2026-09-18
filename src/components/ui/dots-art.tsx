// DotsArt (design-system 5.8): the one illustration language of the product.
// A 96px drawing built from the four-dot motif in --os-line-strong, 1.5px
// line art, no fills, no colour. Four arrangements exist and no others:
//
//   row      lists, tables, inbox, people
//   grid     boards, kanban, calendar, dashboards
//   cluster  goals, KRAs, OKRs, org chart (a thin connecting line)
//   stack    docs, SOPs, policies, files (a "page": a dot and a short line)
//
// Server-safe: plain SVG, no hooks. The grey is a token, never a brand hex,
// so the brand-dot quarantine (design-system 1.6) is untouched.

export type DotsArrangement = "row" | "grid" | "cluster" | "stack";

function Dot({ cx, cy, r = 7, stroke }: { cx: number; cy: number; r?: number; stroke: string }) {
  return <circle cx={cx} cy={cy} r={r} stroke={stroke} strokeWidth={1.5} fill="none" />;
}

export function DotsArt({
  arrangement = "row",
  size = 96,
  className,
  // Outside the token layer (the root 404, which renders with no dashboard
  // stylesheet) the caller passes the written-out greys.
  stroke = "var(--os-line-strong)",
  sheet = "var(--os-surface-1)",
}: {
  arrangement?: DotsArrangement;
  size?: number;
  className?: string;
  stroke?: string;
  sheet?: string;
}) {
  const STROKE = { stroke, strokeWidth: 1.5, fill: "none" } as const;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      aria-hidden
      focusable="false"
      className={className}
      style={{ display: "block" }}
    >
      {/* The faint sheet behind the drawing. */}
      <rect x="8" y="8" width="80" height="80" rx="12" fill={sheet} />
      {arrangement === "row" ? (
        <>
          <Dot cx={24} cy={48} stroke={stroke} />
          <Dot cx={40} cy={48} stroke={stroke} />
          <Dot cx={56} cy={48} stroke={stroke} />
          <Dot cx={72} cy={48} stroke={stroke} />
        </>
      ) : null}
      {arrangement === "grid" ? (
        <>
          <Dot cx={36} cy={36} stroke={stroke} />
          <Dot cx={60} cy={36} stroke={stroke} />
          <Dot cx={36} cy={60} stroke={stroke} />
          <Dot cx={60} cy={60} stroke={stroke} />
        </>
      ) : null}
      {arrangement === "cluster" ? (
        <>
          <line x1={48} y1={31} x2={30} y2={60} strokeLinecap="round" {...STROKE} />
          <line x1={48} y1={31} x2={66} y2={60} strokeLinecap="round" {...STROKE} />
          <line x1={30} y1={60} x2={66} y2={60} strokeLinecap="round" {...STROKE} />
          <Dot cx={48} cy={30} stroke={stroke} />
          <Dot cx={30} cy={62} stroke={stroke} />
          <Dot cx={66} cy={62} stroke={stroke} />
          <Dot cx={48} cy={48} r={4} stroke={stroke} />
        </>
      ) : null}
      {arrangement === "stack" ? (
        <>
          {[28, 42, 56, 70].map((y) => (
            <g key={y}>
              <Dot cx={30} cy={y} r={5} stroke={stroke} />
              <line x1={42} y1={y} x2={68} y2={y} strokeLinecap="round" {...STROKE} />
            </g>
          ))}
        </>
      ) : null}
    </svg>
  );
}
