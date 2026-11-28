// A goal quarter's label as the instants it spans (pen test 2026-11-28,
// V-62): My OKRs matched goals on the exact label, so a goal with dates and
// no label never showed in its quarter.
//
// Pure module.

/** "Q4 2026" as the instants it spans (UTC), or null for anything else. */
export function quarterRange(label: string): { start: Date; end: Date } | null {
  const m = /^Q([1-4]) (\d{4})$/.exec(label.trim());
  if (!m) return null;
  const q = Number(m[1]);
  const y = Number(m[2]);
  return { start: new Date(Date.UTC(y, (q - 1) * 3, 1)), end: new Date(Date.UTC(y, q * 3, 1)) };
}
